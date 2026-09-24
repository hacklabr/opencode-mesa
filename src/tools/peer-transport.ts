import { isV2Context } from "../utils/host.js"
import { isSessionBusy } from "./peer-busy.js"

/**
 * Host-agnostic transport for ask_peer. The V1 and V2 plugin APIs expose
 * very different session surfaces, so the peer consultation mechanics live
 * behind one interface with two implementations:
 *
 * - V1: `client.session.status()` busy check + synchronous
 *   `client.session.prompt()` that returns the peer's reply parts.
 * - V2: event-stream busy tracking + `session.prompt()` → `session.wait()`
 *   → `session.context()` to collect the peer's reply.
 */

export interface PeerPromptInput {
  sessionId: string
  text: string
  directory: string
}

export interface PeerTransport {
  isBusy(sessionId: string): Promise<boolean | null>
  promptPeer(input: PeerPromptInput): Promise<{ responseText: string }>
}

// ---------------------------------------------------------------------------
// V1 transport
// ---------------------------------------------------------------------------

/** Orchestration surface denied in the peer's continuation turn (V1 only —
 *  V2 hosts get the same effect from the mesa/specialist agent permissions). */
const V1_PEER_TOOL_DENYLIST: Record<string, boolean> = {
  task: false,
  open_round: false,
  close_round: false,
  record_decision: false,
  produce_deliverable: false,
  approve_deliverable: false,
}

interface V1SessionClient {
  status: (opts?: { query?: { directory?: string } }) => Promise<{
    data?: Record<string, { type: string }>
  }>
  prompt: (opts: {
    path: { id: string }
    body: {
      parts: Array<{ type: string; text: string }>
      tools?: Record<string, boolean>
    }
  }) => Promise<{ data?: unknown }>
}

export function createV1PeerTransport(client: V1SessionClient, directory: string): PeerTransport {
  return {
    async isBusy(sessionId) {
      try {
        const statusResult = await client.status({ query: { directory } })
        const status = statusResult.data?.[sessionId]
        return status ? status.type === "busy" : null
      } catch {
        return null
      }
    },

    async promptPeer({ sessionId, text }) {
      const promptResult = await client.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text }], tools: { ...V1_PEER_TOOL_DENYLIST } },
      })
      const data = promptResult.data as {
        parts?: Array<{ type: string; text?: string }>
      } | undefined

      let responseText = "(no response)"
      if (data?.parts) {
        const textParts = data.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
        if (textParts.length > 0) responseText = textParts.join("\n")
      }
      return { responseText }
    },
  }
}

// ---------------------------------------------------------------------------
// V2 transport
// ---------------------------------------------------------------------------

const PEER_PROMPT_TIMEOUT_MS = 15 * 60 * 1000

interface V2SessionApi {
  prompt(input: { sessionID: string; text: string }): Promise<unknown>
  wait(input: { sessionID: string }): Promise<void>
  context(input: { sessionID: string }): Promise<readonly unknown[]>
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function extractLastAssistantText(messages: readonly unknown[]): string {
  let last = ""
  for (const message of messages) {
    const msg = message as {
      type?: string
      role?: string
      info?: { type?: string; role?: string }
      parts?: ReadonlyArray<{ type: string; text?: string }>
    }
    const kind = msg.type ?? msg.role ?? msg.info?.type ?? msg.info?.role
    if (kind !== "assistant") continue
    const text = (msg.parts ?? [])
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("\n")
    if (text.trim().length > 0) last = text
  }
  return last
}

export function createV2PeerTransport(session: V2SessionApi): PeerTransport {
  return {
    async isBusy(sessionId) {
      return isSessionBusy(sessionId)
    },

    async promptPeer({ sessionId, text }) {
      await session.prompt({ sessionID: sessionId, text })
      await withTimeout(
        session.wait({ sessionID: sessionId }),
        PEER_PROMPT_TIMEOUT_MS,
        `Peer consultation timed out after ${PEER_PROMPT_TIMEOUT_MS / 1000}s waiting for the peer's session to finish.`
      )
      const messages = await session.context({ sessionID: sessionId })
      const responseText = extractLastAssistantText(messages)
      return { responseText: responseText || "(no response)" }
    },
  }
}

// ---------------------------------------------------------------------------
// Transport selection
// ---------------------------------------------------------------------------

let transport: PeerTransport | null = null

/** Set from each host's plugin entrypoint; picks the matching transport.
 *  Unrecognized clients reset the transport to null. */
export function setSdkClient(client: unknown, directory = ""): void {
  transport = null
  if (isV2Context(client)) {
    transport = createV2PeerTransport(
      (client as unknown as { session: V2SessionApi }).session
    )
  } else if (client && typeof client === "object" && "session" in client) {
    const c = client as { session: Partial<V1SessionClient> }
    if (typeof c.session.status === "function" && typeof c.session.prompt === "function") {
      transport = createV1PeerTransport(c.session as V1SessionClient, directory)
    }
  }
}

export function getPeerTransport(): PeerTransport | null {
  return transport
}

export function resetPeerTransport(): void {
  transport = null
}
