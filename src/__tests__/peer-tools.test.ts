// Tests for peer-tools: findSessionFromDb (pure DB read seam) and the
// askPeerTool.execute integration path with a mock SDK client.
//
// findSessionFromDb is runtime-agnostic (both adapters honor {readonly:true});
// askPeerTool.execute is exercised under vitest-node (single runtime fine — the
// tool's DB access is delegated through the driver/adapter, which the parity
// suite already pins).

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import {
  askPeerTool,
  findSessionFromDb,
  recordAgentSession,
  clearAgentSessions,
  resetPeerConsultations,
  setSdkClient,
} from "../tools/peer-tools.js"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import { peerConsultationCap } from "../workflow/profiles.js"
import type { SuccessResponse } from "../utils/responses.js"

const FIXTURES = join(import.meta.dirname, "__test_fixtures__", "peer-tools")

function freshDir(name: string): string {
  return join(FIXTURES, name)
}

// Match the context shape the plugin runtime passes to tool.execute (see
// verification.test.ts / discussion-tools.test.ts for the established shape).
function makeContext(directory: string, sessionID: string) {
  return {
    sessionID,
    messageID: "test-msg",
    agent: "test",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

async function seedStateWithAnalysis(
  directory: string,
  sessionId: string,
  agentId: string,
  agentName = "Specialist"
): Promise<void> {
  const state = createInitialState(directory)
  state.currentPhase = "DISCUSSION"
  state.discussion.analyses = [
    {
      agentId,
      agentName,
      content: "analysis body",
      turn: 1,
      timestamp: new Date().toISOString(),
    },
  ]
  await saveState(directory, state, sessionId)
}

describe("findSessionFromDb", () => {
  afterEach(async () => {
    await fs.rm(FIXTURES, { recursive: true, force: true }).catch(() => {})
  })

  it("returns the most recent session_id for an exact agent_id match", async () => {
    const dir = freshDir("exact")
    await fs.mkdir(join(dir, ".mesa"), { recursive: true })
    await seedStateWithAnalysis(dir, "session-xyz", "backend-architect")

    const sid = findSessionFromDb(dir, "backend-architect")
    expect(sid).toBe("session-xyz")
  })

  it("falls back to suffix match when no exact agent_id exists", async () => {
    const dir = freshDir("suffix")
    await fs.mkdir(join(dir, ".mesa"), { recursive: true })
    // Stored agent_id is the fully-qualified persona id; query uses the short suffix.
    await seedStateWithAnalysis(dir, "session-long", "software-development-backend-architect")

    const sid = findSessionFromDb(dir, "backend-architect")
    expect(sid).toBe("session-long")
  })

  it("returns null when the agent has registered no analysis", async () => {
    const dir = freshDir("none")
    await fs.mkdir(join(dir, ".mesa"), { recursive: true })
    await seedStateWithAnalysis(dir, "session-a", "some-other-agent")

    const sid = findSessionFromDb(dir, "backend-architect")
    expect(sid).toBeNull()
  })

  it("opens the DB read-only — no state.db file is created for a missing DB", async () => {
    // This ties directly to the node adapter's readonly→readOnly normalization:
    // a WRITABLE open of a non-existent path would CREATE the file (node default
    // is readWriteCreate). A read-only open throws and leaves the filesystem
    // untouched. We assert the file is NOT created, proving readonly was honored.
    const dir = freshDir("readonly")
    await fs.mkdir(join(dir, ".mesa"), { recursive: true })
    const dbPath = join(dir, ".mesa", "state.db")
    await fs.rm(dbPath, { force: true })

    const sid = findSessionFromDb(dir, "any-agent")
    expect(sid).toBeNull()
    // No file created → readonly open (a writable open would have materialized it).
    await expect(fs.access(dbPath)).rejects.toThrow()
  })
})

describe("askPeerTool.execute (integration, mock SDK client)", () => {
  const callerId = "caller-specialist"
  const callerSession = "caller-session-1"
  const peerId = "peer-specialist"
  const peerSession = "peer-session-1"

  let statusCalls = 0
  let promptCalls = 0

  function installMockClient(peerBusy = false): void {
    statusCalls = 0
    promptCalls = 0
    const client = {
      session: {
        status: async () => {
          statusCalls++
          return {
            data: {
              [peerSession]: { type: peerBusy ? "busy" : "idle" },
            },
          }
        },
        prompt: async () => {
          promptCalls++
          return {
            data: {
              parts: [{ type: "text", text: "peer answer" }],
            },
          }
        },
      },
    }
    setSdkClient(client)
  }

  beforeEach(async () => {
    clearAgentSessions() // resets both agentSessions and peerConsultations
    recordAgentSession(peerId, peerSession)
    recordAgentSession(callerId, callerSession)
  })

  afterEach(async () => {
    setSdkClient(null)
    clearAgentSessions()
    resetPeerConsultations()
    closeStorage(FIXTURES)
    await fs.rm(FIXTURES, { recursive: true, force: true }).catch(() => {})
  })

  async function seedDiscussion(directory: string, rigor: "standard" | "deep" = "standard"): Promise<void> {
    await fs.mkdir(join(directory, ".mesa"), { recursive: true })
    const state = createInitialState(directory)
    state.currentPhase = "DISCUSSION"
    state.discussion.rigor = rigor
    state.discussion.currentTurn = 1 // stable turn so the cap accumulates across calls
    await saveState(directory, state, callerSession)
  }

  it("consults an idle peer and returns the peer's answer text", async () => {
    const dir = freshDir("ok")
    await seedDiscussion(dir)
    installMockClient(false)

    const result = (await askPeerTool.execute(
      { peer_id: peerId, question: "what is the contract?" },
      makeContext(dir, callerSession)
    )) as SuccessResponse

    expect(result.title).toContain(peerId)
    expect(result.output).toContain("peer answer")
    // status check + prompt both invoked on the success path.
    expect(statusCalls).toBe(1)
    expect(promptCalls).toBe(1)
  })

  it("refuses to consult a busy peer (deadlock prevention)", async () => {
    const dir = freshDir("busy")
    await seedDiscussion(dir)
    installMockClient(true) // peer busy

    const result = (await askPeerTool.execute(
      { peer_id: peerId, question: "hi?" },
      makeContext(dir, callerSession)
    )) as unknown as string

    expect(typeof result).toBe("string")
    expect(result).toContain("busy")
    // Blocked BEFORE prompt — prompt must not be called.
    expect(promptCalls).toBe(0)
  })

  it("respects the D6 per-turn consultation cap (standard → 2)", async () => {
    const dir = freshDir("cap")
    await seedDiscussion(dir, "standard")
    installMockClient(false)

    // Confirm the cap the tool will enforce.
    expect(peerConsultationCap("standard")).toBe(2)

    const call = () =>
      askPeerTool.execute(
        { peer_id: peerId, question: "q?" },
        makeContext(dir, callerSession)
      )

    // 1st + 2nd: succeed.
    const r1 = (await call()) as SuccessResponse
    const r2 = (await call()) as SuccessResponse
    expect(r1.output).toContain("peer answer")
    expect(r2.output).toContain("peer answer")
    expect(promptCalls).toBe(2)

    // 3rd: blocked by the cap, returns an error string, does NOT hit prompt.
    const r3 = (await call()) as unknown as string
    expect(typeof r3).toBe("string")
    expect(r3).toContain("cap")
    expect(promptCalls).toBe(2) // unchanged — blocked before prompt
  })

  it("does not apply the cap under the 'deep' profile (unlimited)", async () => {
    const dir = freshDir("deep")
    await seedDiscussion(dir, "deep")
    installMockClient(false)

    expect(peerConsultationCap("deep")).toBe(Infinity)

    // Three consultations all succeed past the standard cap of 2.
    for (let i = 0; i < 3; i++) {
      const r = (await askPeerTool.execute(
        { peer_id: peerId, question: `q${i}?` },
        makeContext(dir, callerSession)
      )) as SuccessResponse
      expect(r.output).toContain("peer answer")
    }
    expect(promptCalls).toBe(3)
  })

  it("errors when the SDK client is unavailable", async () => {
    const dir = freshDir("noclient")
    await seedDiscussion(dir)
    setSdkClient(null)

    const result = (await askPeerTool.execute(
      { peer_id: peerId, question: "q?" },
      makeContext(dir, callerSession)
    )) as unknown as string

    expect(typeof result).toBe("string")
    expect(result).toContain("SDK client")
  })
})
