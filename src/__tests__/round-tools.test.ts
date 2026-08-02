// Tests for the kernel round tools (spec D2/D3/D6): open_round and close_round.
//
// Covers every data precondition, the POSITION lexical gate (including the
// longest-alternative-first regex ordering), the registeredByManager
// exclusion, the disagree-vs-converged veto, both override paths, and the
// register_analysis roundId assignment.

import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import { openRoundTool, closeRoundTool } from "../tools/round-tools.js"
import { registerAnalysisTool } from "../tools/discussion-tools.js"
import type { DiscussionState, Round } from "../types.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "round-tools")
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

/** State that satisfies every open_round precondition. */
function readyState(mutate?: (s: DiscussionState) => void): DiscussionState {
  const state = createInitialState(TEST_DIR)
  // Deliberately NOT "PLANNING": kernel tools are phase-independent (D6).
  state.currentPhase = "EXECUTION"
  state.briefing = { path: ".mesa/x/briefing.md", status: "approved", slug: "x", metadata: null }
  state.team = [
    { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
  ]
  state.plan = { path: ".mesa/x/workflow-plan.md", version: 1, status: "approved" }
  if (mutate) mutate(state)
  return state
}

function openRound(mutate?: (r: Round) => void): Round {
  const round: Round = {
    id: "r1",
    topic: "Legacy topic",
    participants: ["eng-1", "design-1"],
    status: "open",
    openedAt: new Date().toISOString(),
  }
  if (mutate) mutate(round)
  return round
}

/** Seed an analysis file on disk + entry in state for a given round. */
async function seedAnalysis(
  state: DiscussionState,
  agentId: string,
  roundId: string,
  opts: { position?: string; registeredByManager?: boolean; noFile?: boolean } = {}
): Promise<void> {
  const rel = `.mesa/analyses/${roundId}/${agentId}.md`
  if (!opts.noFile) {
    const abs = join(TEST_DIR, rel)
    await fs.mkdir(join(abs, ".."), { recursive: true })
    await fs.writeFile(
      abs,
      `# Analysis by ${agentId}\n\nBody.\n\n${opts.position ? `POSITION: ${opts.position}` : "no position here"}\n`,
      "utf-8"
    )
  }
  state.discussion.analyses.push({
    agentId,
    agentName: agentId,
    content: "body",
    filePath: opts.noFile ? null : rel,
    turn: 1,
    timestamp: new Date().toISOString(),
    roundId,
    registeredByManager: opts.registeredByManager ?? false,
  })
}

beforeEach(async () => {
  await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
})

afterEach(async () => {
  closeStorage(TEST_DIR)
  await fs.rm(TEST_DIR, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// open_round preconditions
// ---------------------------------------------------------------------------

describe("open_round", () => {
  test("rejects when briefing is not approved (recovery names approve_briefing)", async () => {
    await saveState(TEST_DIR, readyState((s) => { s.briefing.status = "draft" }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain("approved briefing")
    expect(result as string).toContain("approve_briefing")
  })

  test("rejects when no team member is summoned (recovery names summon_team)", async () => {
    await saveState(TEST_DIR, readyState((s) => {
      s.team = [{ personaId: "eng-1", name: "E", division: "eng", status: "proposed" }]
    }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain("summoned team")
    expect(result as string).toContain("summon_team")
  })

  test("rejects when the workflow plan is not approved (recovery names record_decision gate)", async () => {
    await saveState(TEST_DIR, readyState((s) => { s.plan = null }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain("approved workflow plan")
    expect(result as string).toContain('record_decision type:"gate" target:"plan"')
  })

  test("rejects when plan is still draft", async () => {
    await saveState(TEST_DIR, readyState((s) => {
      s.plan = { path: ".mesa/x/workflow-plan.md", version: 1, status: "draft" }
    }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain("approved workflow plan")
  })

  test("plan-gate refusal distinguishes a LEGACY migrated session (synthesize + present)", async () => {
    await saveState(TEST_DIR, readyState((s) => {
      s.plan = null
      s.rounds = [
        {
          id: "legacy-round-1",
          topic: "Legacy discussion",
          participants: ["eng-1"],
          status: "closed",
          openedAt: new Date().toISOString(),
          closedAt: new Date().toISOString(),
        },
      ]
    }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain("LEGACY SESSION")
    expect(result as string).toContain("synthesize a workflow-plan.md")
    expect(result as string).toContain('record_decision type:"gate" target:"plan"')
  })

  test("rejects when another round is still open (names the open round)", async () => {
    await saveState(TEST_DIR, readyState((s) => { s.rounds = [openRound()] }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain('"r1"')
    expect(result as string).toContain("close_round")
  })

  test("rejects at the session round budget (circuit breaker)", async () => {
    await saveState(TEST_DIR, readyState((s) => {
      s.rounds = Array.from({ length: 12 }, (_, i) => ({
        id: `r${i + 1}`,
        topic: `t${i}`,
        participants: ["eng-1"],
        status: "closed" as const,
        openedAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
      }))
    }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain("12/12")
    expect(result as string).toContain("circuit breaker")
  })

  test("rejects participants outside the team (hard error, lists roster)", async () => {
    await saveState(TEST_DIR, readyState(), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1", "outsider-1"] }, makeContext()
    )
    expect(result as string).toContain("outsider-1")
    expect(result as string).toContain("not in the summoned team")
    expect(result as string).toContain("eng-1")
  })

  test("rejects when session status is paused (global mutation guard)", async () => {
    await saveState(TEST_DIR, readyState((s) => { s.status = "paused" }), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"] }, makeContext()
    )
    expect(result as string).toContain('status is "paused"')
  })

  test("opens a round when all preconditions are met (phase-independent: seeded in EXECUTION)", async () => {
    await saveState(TEST_DIR, readyState(), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "Architecture", participants: ["eng-1", "design-1"] }, makeContext()
    )
    expect(result).toHaveProperty("title", "Round Opened: r1")

    const loaded = await loadState(TEST_DIR, SESSION_ID)
    expect(loaded.rounds).toHaveLength(1)
    expect(loaded.rounds[0].status).toBe("open")
    expect(loaded.rounds[0].topic).toBe("Architecture")
    expect(loaded.rounds[0].participants).toEqual(["eng-1", "design-1"])
  })

  test("writes the optional briefing file into the session folder", async () => {
    await saveState(TEST_DIR, readyState(), SESSION_ID)
    const result = await openRoundTool.execute(
      { topic: "T", participants: ["eng-1"], briefing_content: "## Enriched briefing" },
      makeContext()
    ) as { metadata?: { briefingFilePath?: string } }

    const loaded = await loadState(TEST_DIR, SESSION_ID)
    const file = await fs.readFile(
      join(TEST_DIR, loaded.sessionFolder!, "briefing-for-discussion.md"),
      "utf-8"
    )
    expect(file).toBe("## Enriched briefing")
  })
})

// ---------------------------------------------------------------------------
// close_round preconditions + POSITION gate
// ---------------------------------------------------------------------------

describe("close_round", () => {
  const baseArgs = {
    decision: "converged" as const,
    summary: "All aligned.",
    tensions: [] as string[],
    evidencePaths: [".mesa/analyses/r1/eng-1.md", ".mesa/analyses/r1/design-1.md"],
  }

  async function seedWithOpenRound(
    seedAnalyses?: (s: DiscussionState) => Promise<void>
  ): Promise<void> {
    const state = readyState((s) => { s.rounds = [openRound()] })
    if (seedAnalyses) await seedAnalyses(state)
    await saveState(TEST_DIR, state, SESSION_ID)
  }

  test("rejects when no round is open", async () => {
    await saveState(TEST_DIR, readyState(), SESSION_ID)
    const result = await closeRoundTool.execute(baseArgs, makeContext())
    expect(result as string).toContain("No open round")
  })

  test("rejects empty evidencePaths — even with humanOverride", async () => {
    await seedWithOpenRound()
    const result = await closeRoundTool.execute(
      { ...baseArgs, evidencePaths: [], humanOverride: true },
      makeContext()
    )
    expect(result as string).toContain("evidencePaths")
    expect(result as string).toContain("rubber-stamping")
  })

  test("completeness gate: participant without a POSITION block is named", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "r1", { position: "agree" })
      await seedAnalysis(s, "design-1", "r1") // no POSITION in file
    })
    const result = await closeRoundTool.execute(baseArgs, makeContext())
    expect(result as string).toContain("POSITION missing")
    expect(result as string).toContain("design-1")
    expect(result as string).not.toContain("eng-1,")
  })

  test("completeness gate: analysis from a DIFFERENT round does not count", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "legacy-round-1", { position: "agree" })
      await seedAnalysis(s, "design-1", "r1", { position: "agree" })
    })
    const result = await closeRoundTool.execute(baseArgs, makeContext())
    expect(result as string).toContain("eng-1")
  })

  test("completeness gate: registeredByManager entries do not count as declared positions", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "r1", { position: "agree" })
      await seedAnalysis(s, "design-1", "r1", { position: "agree", registeredByManager: true })
    })
    const result = await closeRoundTool.execute(baseArgs, makeContext())
    expect(result as string).toContain("registered_by_manager")
    expect(result as string).toContain("design-1")
  })

  test("closes when all participants declared positions — extracts positions map verbatim", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "r1", { position: "agree" })
      await seedAnalysis(s, "design-1", "r1", { position: "agree-with-reservations" })
    })
    const result = await closeRoundTool.execute(baseArgs, makeContext())
    expect(result).toHaveProperty("title", "Round Closed: r1 — converged")

    const loaded = await loadState(TEST_DIR, SESSION_ID)
    const round = loaded.rounds[0]
    expect(round.status).toBe("closed")
    expect(round.closedAt).toBeTruthy()
    expect(round.outcome!.decision).toBe("converged")
    // Regex must capture the FULL "agree-with-reservations", not "agree".
    expect(round.outcome!.positions).toEqual({
      "eng-1": "agree",
      "design-1": "agree-with-reservations",
    })
    expect(round.outcome!.evidencePaths).toEqual(baseArgs.evidencePaths)
  })

  test("declared disagree vetoes decision 'converged' — names dissenter and the three legal moves", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "r1", { position: "agree" })
      await seedAnalysis(s, "design-1", "r1", { position: "disagree" })
    })
    const result = await closeRoundTool.execute(baseArgs, makeContext())
    expect(result as string).toContain("vetoed")
    expect(result as string).toContain("design-1")
    expect(result as string).toContain("subset round")
    expect(result as string).toContain("converged-with-open-tensions")
    expect(result as string).toContain("escalated")

    // Round stays open after the refusal.
    const loaded = await loadState(TEST_DIR, SESSION_ID)
    expect(loaded.rounds[0].status).toBe("open")
  })

  test("disagree + converged-with-open-tensions closes, with warning when tensions[] is empty", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "r1", { position: "agree" })
      await seedAnalysis(s, "design-1", "r1", { position: "disagree" })
    })
    const result = await closeRoundTool.execute(
      { ...baseArgs, decision: "converged-with-open-tensions" },
      makeContext()
    )
    expect(result).toHaveProperty("title", "Round Closed: r1 — converged-with-open-tensions")
    expect((result as { output: string }).output).toContain("tensions[] is empty")
  })

  test("humanOverride bypasses the completeness gate and is audit-recorded", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "r1", { position: "agree" })
      // design-1 never registered — override closes anyway.
    })
    const result = await closeRoundTool.execute(
      { ...baseArgs, humanOverride: true },
      makeContext()
    )
    expect(result).toHaveProperty("title", "Round Closed: r1 — converged")

    const auditLog = await fs.readFile(join(TEST_DIR, ".mesa", "audit.log"), "utf-8")
    const entries = auditLog.trim().split("\n").map((l) => JSON.parse(l))
    const closeEntry = entries.find((e) => e.action === "round_closed")
    expect(closeEntry).toBeTruthy()
    expect(closeEntry.details.humanOverride).toBe(true)
    expect(closeEntry.planVersion).toBe(1)
  })

  test("escalated closes without requiring convergence", async () => {
    await seedWithOpenRound(async (s) => {
      await seedAnalysis(s, "eng-1", "r1", { position: "agree" })
      await seedAnalysis(s, "design-1", "r1", { position: "disagree" })
    })
    const result = await closeRoundTool.execute(
      { ...baseArgs, decision: "escalated", tensions: ["persistência: event-sourcing vs CRUD"] },
      makeContext()
    )
    expect(result).toHaveProperty("title", "Round Closed: r1 — escalated")
  })

  test("rejects when session status is cancelled (global mutation guard)", async () => {
    const state = readyState((s) => {
      s.rounds = [openRound()]
      s.status = "cancelled"
    })
    await saveState(TEST_DIR, state, SESSION_ID)
    const result = await closeRoundTool.execute(baseArgs, makeContext())
    expect(result as string).toContain('status is "cancelled"')
  })
})

// ---------------------------------------------------------------------------
// register_analysis — roundId assignment from the open round (additive)
// ---------------------------------------------------------------------------

describe("register_analysis roundId assignment", () => {
  test("assigns the open round's id to new analyses", async () => {
    const state = readyState((s) => {
      s.currentPhase = "DISCUSSION"
      s.rounds = [openRound()]
    })
    await saveState(TEST_DIR, state, SESSION_ID)

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "body", turn: 1 },
      makeContext()
    )
    expect(result).toHaveProperty("title")

    const loaded = await loadState(TEST_DIR, SESSION_ID)
    expect(loaded.discussion.analyses).toHaveLength(1)
    expect(loaded.discussion.analyses[0].roundId).toBe("r1")
  })

  test("rejects registration when no round is open (v15: open round is a hard precondition)", async () => {
    const state = readyState((s) => {
      s.currentPhase = "DISCUSSION"
      s.plan = null
    })
    await saveState(TEST_DIR, state, SESSION_ID)

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "body", turn: 1 },
      makeContext()
    )

    expect(result as string).toContain("No open round")
  })
})
