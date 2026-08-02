// Characterization tests — the SURVIVING guard after the v15 kernel cleanup
// (spec D5/D6). The phase/mode state machine (requirePhase/requireMode,
// VALID_TRANSITIONS, 18 call sites) was deleted; these tests pin the one
// guard that survives: the orthogonal status=="active" mutation guard,
// enforced as a data precondition inside each mutating tool.
//
// Historical note: this file previously froze all 18 requirePhase/requireMode
// call sites (see git history). Those behaviors were intentionally deleted,
// not drifted — the deletion was the point of the redesign.

import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import type { DiscussionStatus, DiscussionState } from "../types.js"
import { openRoundTool, closeRoundTool } from "../tools/round-tools.js"
import { registerAnalysisTool } from "../tools/discussion-tools.js"
import { proposeTeamTool, summonTeamTool } from "../tools/manager-tools.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "guard-characterization")
const SESSION_ID = "test-session"

function makeContext() {
  return {
    sessionID: SESSION_ID,
    messageID: "test-msg",
    agent: "test",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

function readyState(status: DiscussionStatus): DiscussionState {
  const state = createInitialState(TEST_DIR)
  state.status = status
  state.briefing = { path: ".mesa/x/briefing.md", status: "approved", slug: "x", metadata: null }
  state.team = [
    { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
  ]
  state.plan = { path: ".mesa/x/workflow-plan.md", version: 1, status: "approved" }
  state.rounds = [
    {
      id: "r1",
      topic: "T",
      participants: ["eng-1"],
      status: "open",
      openedAt: new Date().toISOString(),
    },
  ]
  return state
}

async function seed(status: DiscussionStatus): Promise<void> {
  await saveState(TEST_DIR, readyState(status), SESSION_ID)
}

function expectStatusError(result: unknown, status: DiscussionStatus) {
  expect(typeof result).toBe("string")
  expect(result as string).toContain(
    `Operation not allowed when discussion status is "${status}"`
  )
}

beforeEach(async () => {
  await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
})

afterEach(async () => {
  closeStorage(TEST_DIR)
  await fs.rm(TEST_DIR, { recursive: true, force: true })
})

describe("surviving guard: status!=='active' rejects all mutations", () => {
  test("open_round rejects when paused", async () => {
    await seed("paused")
    const result = await openRoundTool.execute(
      { topic: "T2", participants: ["eng-1"] },
      makeContext()
    )
    expectStatusError(result, "paused")
  })

  test("open_round rejects when cancelled", async () => {
    await seed("cancelled")
    const result = await openRoundTool.execute(
      { topic: "T2", participants: ["eng-1"] },
      makeContext()
    )
    expectStatusError(result, "cancelled")
  })

  test("close_round rejects when paused", async () => {
    await seed("paused")
    const result = await closeRoundTool.execute(
      {
        decision: "converged",
        summary: "s",
        tensions: [],
        evidencePaths: [".mesa/analyses/r1/eng-1.md"],
      },
      makeContext()
    )
    expectStatusError(result, "paused")
  })

  test("register_analysis rejects when paused", async () => {
    await seed("paused")
    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "c", turn: 1 },
      makeContext()
    )
    expectStatusError(result, "paused")
  })

  test("propose_team rejects when cancelled", async () => {
    await seed("cancelled")
    const result = await proposeTeamTool.execute(
      {
        specialists: [
          { personaId: "x", name: "X", division: "d", justification: "j" },
        ],
      },
      makeContext()
    )
    expectStatusError(result, "cancelled")
  })

  test("summon_team rejects when paused", async () => {
    await seed("paused")
    const result = await summonTeamTool.execute({}, makeContext())
    expectStatusError(result, "paused")
  })

  test("active status passes the guard on every mutating tool", async () => {
    await seed("active")
    // Each of these must NOT fail with the status error (they may fail on
    // their own data preconditions — that is fine and expected).
    const results = [
      await openRoundTool.execute({ topic: "T2", participants: ["eng-1"] }, makeContext()),
      await closeRoundTool.execute(
        { decision: "converged", summary: "s", tensions: [], evidencePaths: ["e.md"] },
        makeContext()
      ),
      await registerAnalysisTool.execute(
        { agent_id: "eng-1", agent_name: "Engineer", content: "c", turn: 1 },
        makeContext()
      ),
    ]
    for (const result of results) {
      const text = typeof result === "string" ? result : JSON.stringify(result)
      expect(text).not.toContain("Operation not allowed when discussion status")
    }
  })
})
