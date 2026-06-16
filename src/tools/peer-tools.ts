import { tool } from "@opencode-ai/plugin"
import { successResponse, errorResponse } from "../utils/responses"

// Module-level SDK client reference (set from index.ts)
let sdkClient: unknown = null

// Map: agentId → opencodeSessionId
// Populated when a specialist calls register_analysis from their OWN session.
// This is the single source of truth used by BOTH ask_peer AND the Manager
// (via getAgentSession) to know which session to resume for each specialist.
const agentSessions = new Map<string, string>()

export function setSdkClient(client: unknown): void {
  sdkClient = client
}

export function recordAgentSession(agentId: string, sessionID: string): void {
  agentSessions.set(agentId, sessionID)
}

export function getAgentSession(agentId: string): string | undefined {
  return agentSessions.get(agentId)
}

export function clearAgentSessions(): void {
  agentSessions.clear()
}

export const askPeerTool = tool({
  description:
    "Ask a peer specialist a direct question during the sequential consensus turn. " +
    "The peer will receive your question and respond, with FULL context from their previous turns. " +
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
      return errorResponse("SDK client not available.")
    }

    try {
      const client = sdkClient as {
        session: {
          list: (opts?: {
            query?: { directory?: string }
          }) => Promise<{ data?: Array<{ id: string; title: string; parentID?: string }> }>
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

      // Look up the peer's REAL session ID from the mapping.
      // This mapping is populated when the specialist calls register_analysis
      // from their OWN session — guaranteeing the correct session ID.
      const peerSessionId = getAgentSession(peer_id)

      if (!peerSessionId) {
        return errorResponse(
          `No session tracked for peer ${peer_id}. ` +
          `The specialist must call register_analysis from their own session to register their session ID.`
        )
      }

      // Send the question to the peer's REAL session — contamination path.
      // The question enters the peer's session history alongside their Turn 1, Turn 2, etc.
      // When the Manager resumes the peer, they remember everything INCLUDING this question.
      const promptResult = await client.session.prompt({
        path: { id: peerSessionId },
        body: {
          parts: [{ type: "text", text: `[Peer consultation]\n\n${question}` }],
          tools: {
            task: false,
            delegate_task: false,
            open_analysis_round: false,
            request_consensus: false,
            generate_specification: false,
          },
        },
      })

      // Extract the response text
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
