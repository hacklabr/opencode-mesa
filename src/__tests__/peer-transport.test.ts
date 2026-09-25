import { describe, expect, test } from "vitest"
import {
  createV2PeerTransport,
  setSdkClient,
  getPeerTransport,
  resetPeerTransport,
} from "../tools/peer-transport.js"
import { trackSessionEvent, isSessionBusy, resetBusyTracker } from "../tools/peer-busy.js"

describe("session busy tracker", () => {
  test("unknown session reports null (best-effort)", () => {
    resetBusyTracker()
    expect(isSessionBusy("ses_unknown")).toBeNull()
  })

  test("tracks execution.started as busy and session.idle as idle", () => {
    resetBusyTracker()
    trackSessionEvent({ type: "session.execution.started", data: { sessionID: "ses_a" } })
    expect(isSessionBusy("ses_a")).toBe(true)
    trackSessionEvent({ type: "session.idle", data: { sessionID: "ses_a" } })
    expect(isSessionBusy("ses_a")).toBe(false)
  })

  test("execution failures also mark the session idle", () => {
    resetBusyTracker()
    trackSessionEvent({ type: "session.execution.started", data: { sessionID: "ses_b" } })
    trackSessionEvent({ type: "session.execution.failed", data: { sessionID: "ses_b" } })
    expect(isSessionBusy("ses_b")).toBe(false)
  })

  test("ignores events without a session id", () => {
    resetBusyTracker()
    trackSessionEvent({ type: "session.execution.started" })
    trackSessionEvent({ type: "session.idle", data: {} })
    expect(isSessionBusy("ses_c")).toBeNull()
  })
})

describe("createV2PeerTransport", () => {
  test("promptPeer: prompt -> wait -> context, extracting the LAST assistant text", async () => {
    const calls: string[] = []
    const session = {
      prompt: async (input: { sessionID: string; text: string }) => {
        calls.push(`prompt:${input.sessionID}`)
      },
      wait: async (input: { sessionID: string }) => {
        calls.push(`wait:${input.sessionID}`)
      },
      context: async (input: { sessionID: string }) => {
        expect(input.sessionID).toBe("ses_peer")
        return [
          { type: "user", parts: [{ type: "text", text: "question" }] },
          { type: "assistant", parts: [{ type: "text", text: "older answer" }] },
          { type: "assistant", parts: [{ type: "reasoning", text: "thinking..." }, { type: "text", text: "final peer answer" }] },
        ]
      },
    }

    const transport = createV2PeerTransport(session)
    const { responseText } = await transport.promptPeer({
      sessionId: "ses_peer",
      text: "[Peer consultation] q?",
      directory: "/tmp",
    })

    expect(calls).toEqual(["prompt:ses_peer", "wait:ses_peer"])
    expect(responseText).toBe("final peer answer")
  })

  test("falls back to (no response) when no assistant text exists", async () => {
    const session = {
      prompt: async () => {},
      wait: async () => {},
      context: async () => [{ type: "user", parts: [{ type: "text", text: "q" }] }],
    }
    const transport = createV2PeerTransport(session)
    const { responseText } = await transport.promptPeer({ sessionId: "ses_x", text: "q", directory: "/tmp" })
    expect(responseText).toBe("(no response)")
  })

  test("isBusy consults the tracker", async () => {
    resetBusyTracker()
    const session = { prompt: async () => {}, wait: async () => {}, context: async () => [] }
    const transport = createV2PeerTransport(session)

    expect(await transport.isBusy("ses_z")).toBeNull()
    trackSessionEvent({ type: "session.execution.started", data: { sessionID: "ses_z" } })
    expect(await transport.isBusy("ses_z")).toBe(true)
  })
})

describe("setSdkClient transport selection", () => {
  test("installs the V2 transport for a plugin context", async () => {
    const prompted: unknown[] = []
    const ctx = {
      location: { directory: "/tmp/v2" },
      tool: { transform: async () => ({ dispose: async () => {} }), hook: async () => ({ dispose: async () => {} }) },
      session: {
        prompt: async (i: unknown) => prompted.push(i),
        wait: async () => {},
        context: async () => [{ type: "assistant", parts: [{ type: "text", text: "v2 answer" }] }],
      },
    }
    setSdkClient(ctx)

    const transport = getPeerTransport()!
    const { responseText } = await transport.promptPeer({ sessionId: "ses_p", text: "q", directory: "/tmp" })
    expect(responseText).toBe("v2 answer")
    expect(prompted).toEqual([{ sessionID: "ses_p", text: "q" }])
    resetPeerTransport()
  })

  test("installs the V1 transport for a V1 SDK client (path/body shapes)", async () => {
    const prompts: unknown[] = []
    const client = {
      session: {
        status: async () => ({ data: { ses_peer: { type: "idle" } } }),
        prompt: async (i: unknown) => {
          prompts.push(i)
          return { data: { parts: [{ type: "text", text: "v1 answer" }] } }
        },
      },
    }
    setSdkClient(client, "/tmp/v1")

    const transport = getPeerTransport()!
    expect(await transport.isBusy("ses_peer")).toBe(false)

    const { responseText } = await transport.promptPeer({ sessionId: "ses_peer", text: "q", directory: "/tmp" })
    expect(responseText).toBe("v1 answer")
    expect(prompts[0]).toMatchObject({ path: { id: "ses_peer" }, body: { tools: { task: false } } })
    resetPeerTransport()
  })

  test("invalid clients reset the transport to null", () => {
    setSdkClient(null)
    expect(getPeerTransport()).toBeNull()
  })
})
