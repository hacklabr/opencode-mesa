import { tool } from "@opencode-ai/plugin"
import { successResponse, errorResponse } from "../utils/responses"
import { loadState } from "../state"

// Module-level SDK client reference (set from index.ts)
let sdkClient: unknown = null

export function setSdkClient(client: unknown): void {
  sdkClient = client
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
          create: (opts: {
            body?: { title?: string }
            query?: { directory?: string }
          }) => Promise<{ data?: { id: string } }>
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

      // Create a new session for this consultation
      const sessionResult = await client.session.create({
        body: { title: `Peer consultation: ${peer_id}` },
        query: { directory: context.directory },
      })

      if (!sessionResult.data?.id) {
        return errorResponse("Failed to create consultation session.")
      }

      const sessionId = sessionResult.data.id

      // Send the question to the peer agent in this session
      // The peer will have access to their analysis files via FS-first storage
      const promptResult = await client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: `mesa/${peer_id}`,
          parts: [{ type: "text", text: question }],
          // Restrict tools — the peer should only read files and answer, not orchestrate
          tools: {
            task: false,
            delegate_task: false,
            open_analysis_round: false,
            request_consensus: false,
            generate_specification: false,
          },
        },
      })

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
        { peerId: peer_id, sessionId, callerSession: context.sessionID }
      )
    } catch (e: unknown) {
      const err = e as Error
      return errorResponse(`Peer consultation failed: ${err.message}`)
    }
  },
})
