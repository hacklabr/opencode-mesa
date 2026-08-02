// E2E integration test for the ask_peer flow — the most fragile invariant of
// the flexible-workflow redesign (spec Phase 0 characterization test).
//
// Flow under test (kernel model):
//   open_round → register_analysis (session capture via recordAgentSession)
//   → ask_peer (routing + busy-check + tool lockdown) → peer session resume
//   (a SECOND round must not break routing — the session map survives).

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { openRoundTool, closeRoundTool } from "../tools/round-tools.js"
import { registerAnalysisTool } from "../tools/discussion-tools.js"
import {
  askPeerTool,
  clearAgentSessions,
  resetPeerConsultations,
  setSdkClient,
} from "../tools/peer-tools.js"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import type { SuccessResponse } from "../utils/responses.js"

const FIXTURES = join(import.meta.dirname, "__test_fixtures__", "ask-peer-e2e")

const MANAGER_SESSION = "manager-session-1"
const PEER_ID = "peer-specialist"
const PEER_NAME = "Peer Specialist"
const PEER_SESSION = "peer-session-1"
const CALLER_ID = "caller-specialist"
const CALLER_NAME = "Caller Specialist"
const CALLER_SESSION = "caller-session-1"

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

interface CapturedPrompt {
  path: { id: string }
  body: {
    parts: Array<{ type: string; text: string }>
    tools?: Record<string, boolean>
  }
}

let statusCalls: number
let promptCalls: number
let lastPrompt: CapturedPrompt | null

function installMockClient(peerBusy = false): void {
  statusCalls = 0
  promptCalls = 0
  lastPrompt = null
  const client = {
    session: {
      status: async () => {
        statusCalls++
        return {
          data: {
            [PEER_SESSION]: { type: peerBusy ? "busy" : "idle" },
            [MANAGER_SESSION]: { type: "idle" },
          },
        }
      },
      prompt: async (opts: CapturedPrompt) => {
        promptCalls++
        lastPrompt = opts
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

/** Seed a Manager-owned state satisfying every open_round precondition. */
async function seedManagerState(directory: string): Promise<void> {
  const state = createInitialState(directory)
  state.briefing = { path: ".mesa/x/briefing.md", status: "approved", slug: "x", metadata: null }
  state.plan = { path: ".mesa/x/workflow-plan.md", version: 1, status: "approved" }
  state.team = [
    { personaId: PEER_ID, name: PEER_NAME, division: "test", status: "summoned" },
    { personaId: CALLER_ID, name: CALLER_NAME, division: "test", status: "summoned" },
  ]
  await saveState(directory, state, MANAGER_SESSION)
}

async function openRound(directory: string, topic: string): Promise<void> {
  const result = await openRoundTool.execute(
    { topic, participants: [PEER_ID, CALLER_ID] },
    makeContext(directory, MANAGER_SESSION)
  )
  if (typeof result === "string") {
    throw new Error(`open_round failed: ${result}`)
  }
}

async function closeOpenRound(directory: string): Promise<void> {
  const result = await closeRoundTool.execute(
    {
      decision: "converged",
      summary: "done",
      tensions: [],
      evidencePaths: [".mesa/analyses/r1/x.md"],
      humanOverride: true,
    },
    makeContext(directory, MANAGER_SESSION)
  )
  if (typeof result === "string") {
    throw new Error(`close_round failed: ${result}`)
  }
}

/**
 * Specialist self-registration. The specialist calls from its OWN session
 * (context.sessionID = specialist session → session capture) and targets the
 * Manager's state via the documented session_id override.
 */
async function selfRegister(
  directory: string,
  agentId: string,
  agentName: string,
  specialistSession: string,
  turn = 1
): Promise<void> {
  const result = await registerAnalysisTool.execute(
    {
      agent_id: agentId,
      agent_name: agentName,
      content: `${agentName} analysis, turn ${turn}`,
      turn,
      session_id: MANAGER_SESSION,
    },
    makeContext(directory, specialistSession)
  )
  if (typeof result === "string") {
    throw new Error(`register_analysis failed for ${agentId}: ${result}`)
  }
}

async function consult(directory: string, question = "what is the contract?") {
  return askPeerTool.execute(
    { peer_id: PEER_ID, question },
    makeContext(directory, CALLER_SESSION)
  )
}

describe("ask_peer e2e — register → capture → consult → resume", () => {
  beforeEach(async () => {
    clearAgentSessions()
    resetPeerConsultations()
    await fs.mkdir(join(FIXTURES, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    setSdkClient(null)
    clearAgentSessions()
    resetPeerConsultations()
    closeStorage(FIXTURES)
    await fs.rm(FIXTURES, { recursive: true, force: true }).catch(() => {})
  })

  it("1. self-registration captures the session and a consult routes to it", async () => {
    const dir = FIXTURES
    await seedManagerState(dir)
    await openRound(dir, "Round 1")
    await selfRegister(dir, PEER_ID, PEER_NAME, PEER_SESSION)
    await selfRegister(dir, CALLER_ID, CALLER_NAME, CALLER_SESSION)
    installMockClient(false)

    const result = (await consult(dir)) as SuccessResponse

    expect(result.title).toContain(PEER_ID)
    expect(result.output).toContain("peer answer")
    expect(statusCalls).toBe(1)
    expect(promptCalls).toBe(1)

    // Routing: the question must land in the PEER's own session — the one
    // captured at self-registration — never the Manager's.
    expect(lastPrompt).not.toBeNull()
    expect(lastPrompt!.path.id).toBe(PEER_SESSION)

    // Contamination-as-feature: the question enters the peer's history
    // attributed to the caller.
    expect(lastPrompt!.body.parts[0].text).toContain(`[Peer consultation from ${CALLER_ID}]`)

    // Least privilege: orchestration tools are locked down in the
    // consulted session.
    expect(lastPrompt!.body.tools?.task).toBe(false)
    expect(lastPrompt!.body.tools?.open_round).toBe(false)
    expect(lastPrompt!.body.tools?.close_round).toBe(false)
    expect(lastPrompt!.body.tools?.record_decision).toBe(false)
  })

  it("2. consulting a busy peer returns the busy error without prompting", async () => {
    const dir = FIXTURES
    await seedManagerState(dir)
    await openRound(dir, "Round 1")
    await selfRegister(dir, PEER_ID, PEER_NAME, PEER_SESSION)
    await selfRegister(dir, CALLER_ID, CALLER_NAME, CALLER_SESSION)
    installMockClient(true) // peer busy

    const result = (await consult(dir)) as unknown as string

    expect(typeof result).toBe("string")
    expect(result).toContain("busy")
    // Deadlock prevention: blocked BEFORE the prompt call.
    expect(promptCalls).toBe(0)
  })

  it("3. consulting a peer that never self-registered fails cleanly", async () => {
    const dir = FIXTURES
    await seedManagerState(dir)
    await openRound(dir, "Round 1")
    // Only the caller registers; the peer never does — no session capture,
    // no SQLite rows for the peer.
    await selfRegister(dir, CALLER_ID, CALLER_NAME, CALLER_SESSION)
    installMockClient(false)

    const result = (await consult(dir)) as unknown as string

    expect(typeof result).toBe("string")
    expect(result).toContain("has not registered an analysis")
    // Clean failure: no status check against a phantom session, no prompt.
    expect(promptCalls).toBe(0)
  })

  it("4. routing survives a SECOND round (multi-round resume)", async () => {
    const dir = FIXTURES
    await seedManagerState(dir)
    await openRound(dir, "Round 1")
    await selfRegister(dir, PEER_ID, PEER_NAME, PEER_SESSION)
    await selfRegister(dir, CALLER_ID, CALLER_NAME, CALLER_SESSION)
    await closeOpenRound(dir)
    await openRound(dir, "Round 2 — conflict subset")

    // The peer has NOT re-registered in round 2. A consult now must still
    // route to the peer's captured session (task_id sessions are stable
    // across rounds — the session map must NOT be cleared between rounds).
    installMockClient(false)
    const result = (await consult(dir)) as SuccessResponse

    expect(result.output).toContain("peer answer")
    expect(promptCalls).toBe(1)
    expect(lastPrompt).not.toBeNull()
    // THE assertion: routing targets the peer's session, not the Manager's
    // (contamination) and not a clean-but-wrong "not registered" error.
    expect(lastPrompt!.path.id).toBe(PEER_SESSION)
  })
})
