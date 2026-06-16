import { tool } from "@opencode-ai/plugin"
import { successResponse, errorResponse } from "../utils/responses"

// Module-level SDK client reference (set from index.ts)
let sdkClient: unknown = null

// Track OpenCode session IDs for each specialist — populated when they call register_analysis
// This enables ask_peer to resume the peer's REAL session (contamination is a feature)
const agentSessions = new Map<string, string>() // agentId → opencodeSessionId

export function setSdkClient(client: unknown): void {
  sdkClient = client
}

export function recordAgentSession(agentId: string, sessionID: string): void {
  agentSessions.set(agentId, sessionID)
}

export function getAgentSession(agentId: string): string | undefined {
  return agentSessions.get(agentId)
}

export const askPeerTool = tool({
  description:
    "Ask a peer specialist a direct question during the sequential consensus turn. " +
    "The peer will receive your question and respond. " +
    "Use this to clarify ambiguities, challenge positions, or request elaboration. " +
    "Be targeted — do not ask vague questions.",

  args: {
    peer_id: tool.schema
      .string()
      .describe("The persona ID of the peer to consult (e.g., 'software-development-backend-architect')"),
    question: tool.schema
      .string()
      .describe("The question to ask the peer. Be specific and concise."),
  },

  async execute(args, context) {
    const { peer_id, question } = args

    if (!sdkClient) {
      return errorResponse("SDK client not available. Peer consultation requires the plugin to be fully initialized.")
    }

    try {
      const client = sdkClient as {
        session: {
          prompt: (opts: {
            path: { id: string }
            body: {
              agent?: string
              parts: Array<{ type: string; text: string }>
              tools?: Record<string, boolean>
            }
          }) => Promise<{ data?: unknown }>
        }
      }

      // Look up the peer's EXISTING session — this is critical for contamination.
      // The question will be added to the peer's session history. When the Manager
      // later resumes the peer via task(task_id="mesa-..."), the peer remembers
      // being asked this question. Contamination is a desired feature.
      const peerSessionId = agentSessions.get(peer_id)

      let promptResult

      if (peerSessionId) {
        // Identify the caller by reverse-looking up their session ID in the Map
        let callerName = "a peer specialist"
        for (const [agentId, sessId] of agentSessions) {
          if (sessId === context.sessionID) {
            callerName = agentId
            break
          }
        }

        // Prefix the question so the peer knows WHO is asking
        const contextualizedQuestion =
          `[Peer consultation from ${callerName}]\n\n${question}`

        // CONTAMINATION PATH: resume the peer's real session
        promptResult = await client.session.prompt({
          path: { id: peerSessionId },
          body: {
            parts: [{ type: "text", text: contextualizedQuestion }],
            tools: {
              task: false,
              delegate_task: false,
              open_analysis_round: false,
              request_consensus: false,
              generate_specification: false,
            },
          },
        })
      } else {
        // FALLBACK: peer hasn't registered an analysis yet (no session tracked).
        // Return an error explaining the requirement.
        return errorResponse(
          `Peer ${peer_id} has no active session tracked. The peer must have called register_analysis at least once for their session to be available for consultation.`
        )
      }

      // Extract the response text from the prompt result
      // SessionPromptResponses[200] = { info: AssistantMessage, parts: Array<Part> }
      let responseText = "(no response)"
      const data = promptResult.data as {
        info?: unknown
        parts?: Array<{ type: string; text?: string }>
      } | undefined

      if (data?.parts) {
        const textParts = data.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
        if (textParts.length > 0) {
          responseText = textParts.join("\n")
        }
      }

      return successResponse(
        `Peer consultation with ${peer_id}`,
        responseText,
        { peerId: peer_id, peerSessionId, callerSession: context.sessionID }
      )
    } catch (e: unknown) {
      const err = e as Error
      return errorResponse(`Peer consultation failed: ${err.message}`)
    }
  },
})
