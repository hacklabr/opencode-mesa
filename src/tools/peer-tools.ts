import { tool } from "@opencode-ai/plugin"
import { successResponse, errorResponse } from "../utils/responses"
import { loadState } from "../state"
import { peerConsultationCap, type RigorProfile } from "../workflow/profiles"

// Module-level SDK client reference (set from index.ts)
let sdkClient: unknown = null

// Map: agentId → opencodeSessionId
// Populated when a specialist calls register_analysis from their OWN session.
// This is the single source of truth used by BOTH ask_peer AND the Manager
// (via getAgentSession) to know which session to resume for each specialist.
const agentSessions = new Map<string, string>()

// D6 (ask_peer governance): per-turn consultation rate cap.
// Map<callerAgentId, Map<turn, count>> — prevents N×N mesh explosion.
const peerConsultations = new Map<string, Map<number, number>>()

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
  peerConsultations.clear()
}

/** Reset the per-turn consultation counters (used on new analysis round). */
export function resetPeerConsultations(): void {
  peerConsultations.clear()
}

/** Reverse-lookup the caller's agentId from its opencode session ID. */
function findCallerAgentId(sessionId: string): string | undefined {
  for (const [agentId, sid] of agentSessions) {
    if (sid === sessionId) return agentId
  }
  return undefined
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
          status: (opts?: {
            query?: { directory?: string }
          }) => Promise<{ data?: Record<string, { type: string }> }>
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
      const peerSessionId = getAgentSession(peer_id)

      if (!peerSessionId) {
        return errorResponse(
          `Peer ${peer_id} has not registered an analysis in the current round yet. ` +
          `The peer must call register_analysis from their own session first, which registers ` +
          `their session ID for consultation. Wait for the peer to register, then try again.`
        )
      }

      // DEADLOCK PREVENTION: Check if the peer's session is busy before sending.
      // During parallel turns, specialists are mid-analysis and cannot respond.
      // Calling ask_peer on a busy peer would block indefinitely (deadlock if
      // both specialists call ask_peer on each other simultaneously).
      try {
        const statusResult = await client.session.status({
          query: { directory: context.directory },
        })
        const peerStatus = statusResult.data?.[peerSessionId]
        if (peerStatus && peerStatus.type === "busy") {
          return errorResponse(
            `Peer ${peer_id} is currently busy (session status: ${peerStatus.type}). ` +
            `Peer consultation is only available during sequential turns when the peer is idle. ` +
            `Wait for the Manager to initiate the consensus turn before consulting peers.`
          )
        }
      } catch {
        // Status check failed — proceed anyway (best-effort, don't block on status)
      }

      // D6: per-turn consultation rate cap (profile-gated).
      // `standard`: max 2 consultations per specialist per turn.
      // `deep`: unlimited. `light`: not applicable (single turn).
      const state = await loadState(context.directory, context.sessionID)
      const rigor: RigorProfile = state.discussion.rigor ?? "standard"
      const currentTurn = state.discussion.currentTurn ?? 0

      if (rigor !== "deep") {
        const cap = peerConsultationCap(rigor)
        const callerKey = (context.sessionID && findCallerAgentId(context.sessionID)) || context.sessionID || "unknown"
        const turnCounts = peerConsultations.get(callerKey) ?? new Map<number, number>()
        const used = turnCounts.get(currentTurn) ?? 0
        if (used >= cap) {
          return errorResponse(
            `Per-turn consultation cap reached: ${used}/${cap} consultations for ${callerKey} in turn ${currentTurn} ` +
            `("${rigor}" profile). Use the "deep" profile or escalate to the human for additional consultations.`
          )
        }
        turnCounts.set(currentTurn, used + 1)
        peerConsultations.set(callerKey, turnCounts)
      }

      // Identify the caller via reverse-lookup in agentSessions
      const callerId = findCallerAgentId(context.sessionID) || "a peer specialist"

      // Send the question to the peer's REAL session — contamination path.
      // The question enters the peer's session history alongside their Turn 1, Turn 2, etc.
      // When the Manager resumes the peer, they remember everything INCLUDING this question.
      const promptResult = await client.session.prompt({
        path: { id: peerSessionId },
        body: {
          parts: [{ type: "text", text: `[Peer consultation from ${callerId}]\n\n${question}` }],
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
