import { tool } from "@opencode-ai/plugin"
import { successResponse, errorResponse } from "../utils/responses"

// Module-level SDK client reference (set from index.ts)
let sdkClient: unknown = null

export function setSdkClient(client: unknown): void {
  sdkClient = client
}

export function recordAgentSession(_agentId: string, _sessionID: string): void {}
export function getAgentSession(_agentId: string): string | undefined { return undefined }
export function clearAgentSessions(): void {}

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

      // The Manager invokes specialists with task_id="mesa-{personaId}".
      // OpenCode embeds the task_id in the session ID: ses_{random}_mesa-{personaId}
      // We search session.list() for a session whose ID contains the task_id pattern.
      const taskSlug = `mesa-${peer_id}`
      const listResult = await client.session.list({
        query: { directory: context.directory },
      })

      const sessions = listResult.data ?? []
      // Find the peer's session — match by task_id embedded in session ID
      // Sort by most recent (sessions are returned in order, last = most recent)
      const peerSession = sessions
        .filter((s) => s.id.includes(taskSlug))
        .pop() // most recent matching session

      if (!peerSession) {
        return errorResponse(
          `No active session found for peer ${peer_id}. ` +
          `The Manager must have invoked this specialist at least once via task(task_id="mesa-${peer_id}"). ` +
          `Looked for session ID containing: ${taskSlug}`
        )
      }

      // Prefix question so the peer knows who is asking
      const contextualizedQuestion =
        `[Peer consultation]\n\n${question}`

      // Send the question to the peer's REAL session — this is the contamination path.
      // The question enters the peer's session history. The peer remembers their previous
      // analyses (Turn 1, Turn 2, etc.) AND this question. When the Manager later resumes
      // the peer via task(task_id="mesa-{peer_id}"), the peer remembers everything.
      const promptResult = await client.session.prompt({
        path: { id: peerSession.id },
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
        { peerId: peer_id, peerSessionId: peerSession.id, callerSession: context.sessionID }
      )
    } catch (e: unknown) {
      const err = e as Error
      return errorResponse(`Peer consultation failed: ${err.message}`)
    }
  },
})
