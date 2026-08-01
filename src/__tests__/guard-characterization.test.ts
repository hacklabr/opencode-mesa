// Characterization tests — freeze the CURRENT behavior of every
// requirePhase/requireMode guard call site BEFORE the Phase 1 redesign
// deletes them (spec: flexibilização do Mesa, Fase 0).
//
// These tests are intentionally pinned to the legacy semantics. When the
// state machine is replaced by data-based preconditions, this file is
// expected to change wholesale — it exists so the deletion is a conscious,
// reviewable diff rather than a silent behavioral drift.
//
// Exact guard call sites (18 total — the "~21" from the analysis counted
// grep matches including import lines and the two definitions in
// src/workflow/transitions.ts):
//
//   src/tools/journey-workshop-tools.ts
//     L91   detectUserJourneysTool          requirePhase(PLANNING)
//     L179  configureJourneyWorkshopTool    requirePhase(PLANNING)
//     L265  openJourneyWorkshopRoundTool    requirePhase(PLANNING)
//     L373  completeJourneyWorkshopTool     requirePhase(PLANNING, DISCUSSION)
//   src/tools/manager-tools.ts
//     L23   analyzeBriefingTool             requirePhase(PLANNING)
//     L68   proposeTeamTool                 requirePhase(PLANNING) [+ EXECUTION extra hint]
//     L121  summonTeamTool                  requirePhase(PLANNING)
//     L229  delegateTaskTool                requirePhase(EXECUTION)
//     L375  checkExecutionPhasesTool        requirePhase(EXECUTION)
//     L448  selectPhasesForAnalysisTool     requirePhase(EXECUTION)
//     L534  configurePhaseObservationTool   requirePhase(EXECUTION)
//     L662  verifyImplementationTool        requirePhase(EXECUTION)
//     L902  replanImplementationTeamTool    requirePhase(EXECUTION)
//   src/tools/discussion-tools.ts
//     L78   openAnalysisRoundTool           requirePhase(PLANNING)
//     L303  registerAnalysisTool            requirePhase(DISCUSSION, EXECUTION)
//     L669  requestConsensusTool            requirePhase(DISCUSSION, EXECUTION)
//     L723  requestConsensusTool            requireMode(analysis, debate)
//     L816  generateSpecificationOverviewTool requirePhase(SPECIFICATION)
//
// Guard error formats being frozen (src/workflow/transitions.ts):
//   phase:  "Operation not allowed in {PHASE} phase. Required: {A} or {B}."
//   mode:   'Operation not allowed in discussion mode "{MODE}". Required: {A} or {B}.'
//   status: 'Operation not allowed when discussion status is "{STATUS}". Resume...'
// requirePhase ALSO enforces status=="active" (paused/cancelled reject all
// phase-gated operations) — characterized in the last describe block.

import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import type { DiscussionPhase, DiscussionStatus, DiscussionState } from "../types.js"
import {
  detectUserJourneysTool,
  configureJourneyWorkshopTool,
  openJourneyWorkshopRoundTool,
  completeJourneyWorkshopTool,
} from "../tools/journey-workshop-tools.js"
import {
  analyzeBriefingTool,
  proposeTeamTool,
  summonTeamTool,
  delegateTaskTool,
  checkExecutionPhasesTool,
  selectPhasesForAnalysisTool,
  configurePhaseObservationTool,
  verifyImplementationTool,
  replanImplementationTeamTool,
} from "../tools/manager-tools.js"
import {
  openAnalysisRoundTool,
  registerAnalysisTool,
  requestConsensusTool,
  generateSpecificationOverviewTool,
} from "../tools/discussion-tools.js"

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

async function seed(
  phase: DiscussionPhase,
  mutate?: (state: DiscussionState) => void
): Promise<void> {
  const state = createInitialState(TEST_DIR)
  state.currentPhase = phase
  if (mutate) mutate(state)
  await saveState(TEST_DIR, state, SESSION_ID)
}

function expectPhaseError(result: unknown, from: DiscussionPhase, required: string) {
  expect(typeof result).toBe("string")
  expect(result as string).toContain(
    `Operation not allowed in ${from} phase. Required: ${required}.`
  )
}

function expectStatusError(result: unknown, status: DiscussionStatus) {
  expect(typeof result).toBe("string")
  expect(result as string).toContain(
    `Operation not allowed when discussion status is "${status}"`
  )
}

function expectGuardPassed(result: unknown) {
  const text = typeof result === "string" ? result : JSON.stringify(result)
  expect(text).not.toContain("Operation not allowed")
}

beforeEach(async () => {
  await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
})

afterEach(async () => {
  closeStorage(TEST_DIR)
  await fs.rm(TEST_DIR, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// journey-workshop-tools.ts — 4 call sites
// ---------------------------------------------------------------------------

describe("guard: detect_user_journeys (journey-workshop-tools.ts:91 — PLANNING)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await detectUserJourneysTool.execute({}, makeContext())
    expectPhaseError(result, "DISCUSSION", "PLANNING")
  })

  test("passes the guard from PLANNING (fails later: no briefing)", async () => {
    await seed("PLANNING")
    const result = await detectUserJourneysTool.execute({}, makeContext())
    expectGuardPassed(result)
    expect(result as string).toContain("No briefing found")
  })
})

describe("guard: configure_journey_workshop (journey-workshop-tools.ts:179 — PLANNING)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await configureJourneyWorkshopTool.execute({ mode: "skip" }, makeContext())
    expectPhaseError(result, "DISCUSSION", "PLANNING")
  })

  test("passes the guard from PLANNING (mode=skip succeeds)", async () => {
    await seed("PLANNING")
    const result = await configureJourneyWorkshopTool.execute({ mode: "skip" }, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Journey Workshop Skipped")
  })
})

describe("guard: open_journey_workshop_round (journey-workshop-tools.ts:265 — PLANNING)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await openJourneyWorkshopRoundTool.execute({}, makeContext())
    expectPhaseError(result, "DISCUSSION", "PLANNING")
  })

  test("passes the guard from PLANNING (fails later: workshop not configured)", async () => {
    await seed("PLANNING")
    const result = await openJourneyWorkshopRoundTool.execute({}, makeContext())
    expectGuardPassed(result)
    expect(result as string).toContain("must be configured first")
  })
})

describe("guard: complete_journey_workshop (journey-workshop-tools.ts:373 — PLANNING | DISCUSSION)", () => {
  test("rejects from EXECUTION", async () => {
    await seed("EXECUTION")
    const result = await completeJourneyWorkshopTool.execute(
      { journeys_file_path: "journeys.md" },
      makeContext()
    )
    expectPhaseError(result, "EXECUTION", "PLANNING or DISCUSSION")
  })

  test("passes the guard from PLANNING (fails later: workshop not in progress)", async () => {
    await seed("PLANNING")
    const result = await completeJourneyWorkshopTool.execute(
      { journeys_file_path: "journeys.md" },
      makeContext()
    )
    expectGuardPassed(result)
    expect(result as string).toContain("Cannot complete journey workshop")
  })

  test("passes the guard from DISCUSSION (second allowed phase)", async () => {
    await seed("DISCUSSION")
    const result = await completeJourneyWorkshopTool.execute(
      { journeys_file_path: "journeys.md" },
      makeContext()
    )
    expectGuardPassed(result)
    expect(result as string).toContain("Cannot complete journey workshop")
  })
})

// ---------------------------------------------------------------------------
// manager-tools.ts — 9 call sites
// ---------------------------------------------------------------------------

describe("guard: analyze_briefing (manager-tools.ts:23 — PLANNING)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await analyzeBriefingTool.execute({}, makeContext())
    expectPhaseError(result, "DISCUSSION", "PLANNING")
  })

  test("passes the guard from PLANNING (fails later: no briefing)", async () => {
    await seed("PLANNING")
    const result = await analyzeBriefingTool.execute({}, makeContext())
    expectGuardPassed(result)
    expect(result as string).toContain("No briefing found")
  })
})

describe("guard: propose_team (manager-tools.ts:68 — PLANNING)", () => {
  const specialists = [
    { personaId: "nonexistent-persona", name: "X", division: "engineering", justification: "y" },
  ]

  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await proposeTeamTool.execute({ specialists }, makeContext())
    expectPhaseError(result, "DISCUSSION", "PLANNING")
  })

  test("rejects from EXECUTION with the replan hint appended (frozen extra behavior)", async () => {
    await seed("EXECUTION")
    const result = await proposeTeamTool.execute({ specialists }, makeContext())
    expectPhaseError(result, "EXECUTION", "PLANNING")
    // propose_team is the only guard site that decorates the phase error.
    expect(result as string).toContain("replan_implementation_team")
  })

  test("passes the guard from PLANNING (fails later: persona not in catalog)", async () => {
    await seed("PLANNING")
    const result = await proposeTeamTool.execute({ specialists }, makeContext())
    expectGuardPassed(result)
    expect(result as string).toContain("Invalid specialist IDs")
  })
})

describe("guard: summon_team (manager-tools.ts:121 — PLANNING)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await summonTeamTool.execute({}, makeContext())
    expectPhaseError(result, "DISCUSSION", "PLANNING")
  })

  test("passes the guard from PLANNING (fails later: briefing not approved)", async () => {
    await seed("PLANNING")
    const result = await summonTeamTool.execute({}, makeContext())
    expectGuardPassed(result)
    expect(result as string).toContain("Briefing must be approved")
  })
})

describe("guard: delegate_task (manager-tools.ts:229 — EXECUTION)", () => {
  test("rejects from PLANNING", async () => {
    await seed("PLANNING")
    const result = await delegateTaskTool.execute(
      { personaId: "nonexistent-persona", task: "do something" },
      makeContext()
    )
    expectPhaseError(result, "PLANNING", "EXECUTION")
  })

  test("passes the guard from EXECUTION (fails later: specialist unknown)", async () => {
    await seed("EXECUTION")
    const result = await delegateTaskTool.execute(
      { personaId: "nonexistent-persona", task: "do something" },
      makeContext()
    )
    expectGuardPassed(result)
    expect(result as string).toContain("not found in the current team or catalog")
  })
})

describe("guard: check_execution_phases (manager-tools.ts:375 — EXECUTION)", () => {
  test("rejects from SPECIFICATION", async () => {
    await seed("SPECIFICATION")
    const result = await checkExecutionPhasesTool.execute({}, makeContext())
    expectPhaseError(result, "SPECIFICATION", "EXECUTION")
  })

  test("passes the guard from EXECUTION (fails later: no approved spec)", async () => {
    await seed("EXECUTION")
    const result = await checkExecutionPhasesTool.execute({}, makeContext())
    expectGuardPassed(result)
    expect(result as string).toContain("No approved specification found")
  })
})

describe("guard: select_phases_for_analysis (manager-tools.ts:448 — EXECUTION)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await selectPhasesForAnalysisTool.execute(
      { selection: "none", phase_count: 3 },
      makeContext()
    )
    expectPhaseError(result, "DISCUSSION", "EXECUTION")
  })

  test("passes the guard from EXECUTION (selection 'none' succeeds)", async () => {
    await seed("EXECUTION")
    const result = await selectPhasesForAnalysisTool.execute(
      { selection: "none", phase_count: 3 },
      makeContext()
    )
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Phase Analysis Skipped")
  })
})

describe("guard: configure_phase_observation (manager-tools.ts:534 — EXECUTION)", () => {
  test("rejects from PLANNING", async () => {
    await seed("PLANNING")
    const result = await configurePhaseObservationTool.execute(
      { mode: "automatic", phase_name: "Phase 1" },
      makeContext()
    )
    expectPhaseError(result, "PLANNING", "EXECUTION")
  })

  test("passes the guard from EXECUTION (automatic mode succeeds)", async () => {
    await seed("EXECUTION")
    const result = await configurePhaseObservationTool.execute(
      { mode: "automatic", phase_name: "Phase 1" },
      makeContext()
    )
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Automatic Mode Configured")
  })
})

describe("guard: verify_implementation (manager-tools.ts:662 — EXECUTION)", () => {
  const baseArgs = {
    phase_name: "Phase 1",
    task_description: "did the thing",
    acceptance_criteria: ["works"],
    result: "passed" as const,
    gaps: ["non-empty gaps contradict passed"],
    qa_specialist_id: "qa-1",
  }

  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await verifyImplementationTool.execute(baseArgs, makeContext())
    expectPhaseError(result, "DISCUSSION", "EXECUTION")
  })

  test("passes the guard from EXECUTION (fails later: passed-with-gaps validation)", async () => {
    await seed("EXECUTION")
    const result = await verifyImplementationTool.execute(baseArgs, makeContext())
    expectGuardPassed(result)
    expect(result as string).toContain("result is 'passed' but gaps list is non-empty")
  })
})

describe("guard: replan_implementation_team (manager-tools.ts:902 — EXECUTION)", () => {
  test("rejects from PLANNING", async () => {
    await seed("PLANNING")
    const result = await replanImplementationTeamTool.execute({ reason: "swap team" }, makeContext())
    expectPhaseError(result, "PLANNING", "EXECUTION")
  })

  test("passes the guard from EXECUTION (succeeds, resets to PLANNING)", async () => {
    await seed("EXECUTION")
    const result = await replanImplementationTeamTool.execute({ reason: "swap team" }, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Implementation Team Replan — Ready for New Team Proposal")
    const loaded = await loadState(TEST_DIR, SESSION_ID)
    expect(loaded.currentPhase).toBe("PLANNING")
  })
})

// ---------------------------------------------------------------------------
// discussion-tools.ts — 5 call sites
// ---------------------------------------------------------------------------

describe("guard: open_analysis_round (discussion-tools.ts:78 — PLANNING)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await openAnalysisRoundTool.execute(
      { topic: "T", participants: [] },
      makeContext()
    )
    expectPhaseError(result, "DISCUSSION", "PLANNING")
  })

  test("passes the guard from PLANNING (round opens)", async () => {
    await seed("PLANNING")
    const result = await openAnalysisRoundTool.execute(
      { topic: "T", participants: [] },
      makeContext()
    )
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Analysis Round Opened")
  })
})

describe("guard: register_analysis (discussion-tools.ts:303 — DISCUSSION | EXECUTION)", () => {
  const analysis = { agent_id: "eng-1", agent_name: "Engineer", content: "body", turn: 1 }

  test("rejects from PLANNING", async () => {
    await seed("PLANNING")
    const result = await registerAnalysisTool.execute(analysis, makeContext())
    expectPhaseError(result, "PLANNING", "DISCUSSION or EXECUTION")
  })

  test("passes the guard from DISCUSSION (analysis registers)", async () => {
    await seed("DISCUSSION")
    const result = await registerAnalysisTool.execute(analysis, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title")
  })

  test("passes the guard from EXECUTION (second allowed phase)", async () => {
    await seed("EXECUTION")
    const result = await registerAnalysisTool.execute(analysis, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title")
  })
})

describe("guard: request_consensus phase (discussion-tools.ts:669 — DISCUSSION | EXECUTION)", () => {
  const votes = [{ agent_id: "eng-1", agent_name: "Engineer", vote: 1 as const, reason: "ok" }]

  test("rejects from PLANNING", async () => {
    await seed("PLANNING")
    const result = await requestConsensusTool.execute({ votes, round: 1 }, makeContext())
    expectPhaseError(result, "PLANNING", "DISCUSSION or EXECUTION")
  })

  test("passes the guard from DISCUSSION (consensus registers)", async () => {
    await seed("DISCUSSION")
    const result = await requestConsensusTool.execute({ votes, round: 1 }, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Consensus Reached")
  })

  test("passes the guard from EXECUTION (second allowed phase)", async () => {
    await seed("EXECUTION")
    const result = await requestConsensusTool.execute({ votes, round: 1 }, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Consensus Reached")
  })
})

describe("guard: request_consensus mode (discussion-tools.ts:723 — requireMode analysis | debate)", () => {
  const votes = [{ agent_id: "eng-1", agent_name: "Engineer", vote: 1 as const, reason: "ok" }]

  test('rejects from mode "voting" (re-vote without debate back-edge)', async () => {
    await seed("DISCUSSION", (s) => {
      s.discussion.mode = "voting"
    })
    const result = await requestConsensusTool.execute({ votes, round: 1 }, makeContext())
    expect(typeof result).toBe("string")
    expect(result as string).toContain(
      'Operation not allowed in discussion mode "voting". Required: analysis or debate.'
    )
  })

  test('passes from mode "analysis"', async () => {
    await seed("DISCUSSION", (s) => {
      s.discussion.mode = "analysis"
    })
    const result = await requestConsensusTool.execute({ votes, round: 1 }, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Consensus Reached")
  })

  test('passes from mode "debate" (second allowed mode)', async () => {
    await seed("DISCUSSION", (s) => {
      s.discussion.mode = "debate"
    })
    const result = await requestConsensusTool.execute({ votes, round: 1 }, makeContext())
    expectGuardPassed(result)
    expect(result).toHaveProperty("title", "Consensus Reached")
  })
})

describe("guard: generate_specification_overview (discussion-tools.ts:816 — SPECIFICATION)", () => {
  test("rejects from DISCUSSION", async () => {
    await seed("DISCUSSION")
    const result = await generateSpecificationOverviewTool.execute(
      { content: "# Overview", topic: "T" },
      makeContext()
    )
    expectPhaseError(result, "DISCUSSION", "SPECIFICATION")
  })

  test("passes the guard from SPECIFICATION (fails later: no draft spec)", async () => {
    await seed("SPECIFICATION")
    const result = await generateSpecificationOverviewTool.execute(
      { content: "# Overview", topic: "T" },
      makeContext()
    )
    expectGuardPassed(result)
    expect(result as string).toContain("No draft specification found")
  })
})

// ---------------------------------------------------------------------------
// Orthogonal status enforcement (transitions.ts:37 — requirePhase rejects
// any phase-gated call when status is "paused" or "cancelled", regardless
// of the current phase being otherwise correct).
// ---------------------------------------------------------------------------

describe("guard: status enforcement (requirePhase status!=='active' check)", () => {
  test("paused status rejects a PLANNING-gated tool even in PLANNING phase", async () => {
    await seed("PLANNING", (s) => {
      s.status = "paused"
    })
    const result = await analyzeBriefingTool.execute({}, makeContext())
    expectStatusError(result, "paused")
  })

  test("cancelled status rejects a PLANNING-gated tool even in PLANNING phase", async () => {
    await seed("PLANNING", (s) => {
      s.status = "cancelled"
    })
    const result = await openAnalysisRoundTool.execute(
      { topic: "T", participants: [] },
      makeContext()
    )
    expectStatusError(result, "cancelled")
  })

  test("paused status rejects an EXECUTION-gated tool even in EXECUTION phase", async () => {
    await seed("EXECUTION", (s) => {
      s.status = "paused"
    })
    const result = await delegateTaskTool.execute(
      { personaId: "nonexistent-persona", task: "do something" },
      makeContext()
    )
    expectStatusError(result, "paused")
  })
})
