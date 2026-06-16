import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage, getSessionId } from "../state"
import { createInitialState } from "../config"
import {
  openAnalysisRoundTool,
  registerAnalysisTool,
  requestConsensusTool,
  generateSpecificationTool,
  approveSpecificationTool,
  pauseDiscussionTool,
  resumeDiscussionTool,
  cancelDiscussionTool,
} from "../tools/discussion-tools"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "discussion-tools")

function makeContext() {
  return {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "test",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("open_analysis_round tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully opens analysis round from PLANNING", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    const result = await openAnalysisRoundTool.execute(
      {
        topic: "System Architecture",
        participants: ["eng-1"],
        max_turns: 3,
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Round Opened")
    const output = (result as { output: string }).output
    expect(output).toContain("System Architecture")
    expect(output).toContain("Engineer")
    expect(output).toContain("ANALYSIS")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("ANALYSIS")
    expect(loaded.discussion.topic).toBe("System Architecture")
    expect(loaded.discussion.maxTurns).toBe(3)
    expect(loaded.discussion.currentTurn).toBe(1)
    expect(loaded.discussion.analyses).toEqual([])
  })

  test("resets specification state on open", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.specification = { path: "/old/spec.md", status: "draft" }
    state.discussion.votes = [
      { agentId: "a", agentName: "A", vote: 1, reason: "ok", round: 1 },
    ]
    await saveState(TEST_DIR, state)

    await openAnalysisRoundTool.execute(
      {
        topic: "New Topic",
        participants: ["eng-1"],
        force: true,
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR)
    expect(loaded.specification.path).toBeNull()
    expect(loaded.specification.status).toBe("pending")
    expect(loaded.discussion.votes).toEqual([])
    expect(loaded.discussion.consensusRound).toBe(0)
  })

  test("returns error when not in PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "CONSENSUS"
    await saveState(TEST_DIR, state)

    const result = await openAnalysisRoundTool.execute(
      { topic: "Test", participants: ["eng-1"] },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("CONSENSUS")
  })

  test("warns when existing analyses exist without force", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.discussion.analyses = [
      { agentId: "a", agentName: "A", content: "c", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await openAnalysisRoundTool.execute(
      { topic: "Test", participants: ["eng-1"] },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("existing analyses")
  })

  test("writes briefing content to file when provided", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Eng", division: "eng", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    await openAnalysisRoundTool.execute(
      {
        topic: "Test",
        participants: ["eng-1"],
        briefing_content: "## Briefing for analysis",
      },
      makeContext()
    )

    const sessionId = getSessionId(TEST_DIR)
    const file = await fs.readFile(
      join(TEST_DIR, ".mesa", `briefing-for-discussion-${sessionId}.md`),
      "utf-8"
    )
    expect(file).toBe("## Briefing for analysis")
  })

  test("rejects unknown participants not in team (BUG-08)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    const result = await openAnalysisRoundTool.execute(
      {
        topic: "Test",
        participants: ["eng-1", "unknown-agent"],
      },
      makeContext()
    )

    expect(result).toContain("Unknown participants")
    expect(result).toContain("unknown-agent")
  })

  test("stores participants in state (BUG-03)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
      { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    await openAnalysisRoundTool.execute(
      {
        topic: "Test Participants",
        participants: ["eng-1", "design-1"],
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.participants).toEqual(["eng-1", "design-1"])
  })
})

describe("register_analysis tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully registers analysis in ANALYSIS phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "I recommend microservices.",
        turn: 1,
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")
    const output = (result as { output: string }).output
    expect(output).toContain("turn 1")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses.length).toBe(1)
    expect(loaded.discussion.analyses[0].agentId).toBe("eng-1")
    expect(loaded.discussion.analyses[0].content).toBe("I recommend microservices.")
  })

  test("rejects duplicate analysis (same agent + turn)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "First", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "Duplicate", turn: 1 },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("already registered")
  })

  test("returns error when not in ANALYSIS phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "Analysis", turn: 1 },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("PLANNING")
  })
})

describe("request_consensus tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("reaches consensus with all AGREE votes", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    await saveState(TEST_DIR, state)

    const result = await requestConsensusTool.execute(
      {
        votes: [
          { agent_id: "a", agent_name: "Alice", vote: 1, reason: "Looks good" },
          { agent_id: "b", agent_name: "Bob", vote: 2, reason: "Mostly agree" },
        ],
        round: 1,
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Consensus Reached")
    const output = (result as { output: string }).output
    expect(output).toContain("All specialists agree")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("CONSENSUS")
    expect(loaded.discussion.consensusRound).toBe(1)
    expect(loaded.discussion.votes.length).toBe(2)
  })

  test("detects disagreement and returns debate message", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    await saveState(TEST_DIR, state)

    const result = await requestConsensusTool.execute(
      {
        votes: [
          { agent_id: "a", agent_name: "Alice", vote: 1, reason: "Agree" },
          { agent_id: "b", agent_name: "Bob", vote: 0, reason: "Disagree strongly" },
        ],
        round: 1,
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Consensus Not Reached — Debate Required")
    const output = (result as { output: string }).output
    expect(output).toContain("debate round is needed")
    expect(output).toContain("Bob")
  })

  test("rejects duplicate vote in same round", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "ok", round: 1 },
    ]
    await saveState(TEST_DIR, state)

    const result = await requestConsensusTool.execute(
      {
        votes: [{ agent_id: "a", agent_name: "Alice", vote: 1, reason: "dup" }],
        round: 1,
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Vote already registered")
  })

  test("returns error when not in ANALYSIS phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await requestConsensusTool.execute(
      {
        votes: [{ agent_id: "a", agent_name: "A", vote: 1, reason: "ok" }],
        round: 1,
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("PLANNING")
  })
})

describe("generate_specification tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("generates specification from CONSENSUS phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "CONSENSUS"
    state.discussion.consensusRound = 1
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "Agree", round: 1 },
    ]
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    state.discussion.analyses = [
      { agentId: "a", agentName: "Alice", content: "Analysis content", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await generateSpecificationTool.execute(
      {
        content: "## Executive Summary\n\nBuild a microservices-based system.\n\n## Technical Decisions\n\nUse microservices architecture for scalability.",
        topic: "System Design",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Specification Generated")
    const output = (result as { output: string }).output
    expect(output).toContain("awaiting human approval")

    const metadata = (result as { metadata?: { path: string } }).metadata
    expect(metadata?.path).toBeTruthy()

    const specFile = await fs.readFile(metadata!.path, "utf-8")
    expect(specFile).toContain("System Design")
    expect(specFile).toContain("microservices")
    expect(specFile).toContain("Executive Summary")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("APPROVAL")
    expect(loaded.specification.status).toBe("draft")

    // Verify analyses were saved separately
    const analysesDir = metadata!.path.replace("spec-", "analyses-").replace(".md", "")
    const analysisFiles = await fs.readdir(analysesDir)
    expect(analysisFiles.length).toBe(1)
    const analysisContent = await fs.readFile(join(analysesDir, analysisFiles[0]), "utf-8")
    expect(analysisContent).toContain("Analysis: Alice")
    expect(analysisContent).toContain("Analysis content")
  })

  test("returns error from invalid phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await generateSpecificationTool.execute(
      {
        content: "Test content",
        topic: "Test",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid transition")
  })
})

describe("approve_specification tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("approves specification and moves to EXECUTION", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "APPROVAL"
    state.specification = { path: "/spec.md", status: "draft" }
    await saveState(TEST_DIR, state)

    const result = await approveSpecificationTool.execute(
      { approved: true },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Specification Approved")
    const output = (result as { output: string }).output
    expect(output).toContain("EXECUTION")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("EXECUTION")
    expect(loaded.specification.status).toBe("approved")
  })

  test("rejects specification and returns to DOCUMENTATION", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "APPROVAL"
    state.specification = { path: "/spec.md", status: "draft" }
    await saveState(TEST_DIR, state)

    const result = await approveSpecificationTool.execute(
      { approved: false, feedback: "Needs more detail" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Specification Rejected")
    const output = (result as { output: string }).output
    expect(output).toContain("DOCUMENTATION")
    expect(output).toContain("Needs more detail")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("DOCUMENTATION")
    expect(loaded.specification.status).toBe("rejected")
  })

  test("returns error when not in APPROVAL phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await approveSpecificationTool.execute(
      { approved: true },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid transition")
  })
})

describe("pause_discussion tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully pauses from ANALYSIS", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    await saveState(TEST_DIR, state)

    const result = await pauseDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Paused")
    const output = (result as { output: string }).output
    expect(output).toContain("ANALYSIS")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("PAUSED")
    expect(loaded.previousPhase).toBe("ANALYSIS")
  })

  test("returns error when already PAUSED", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PAUSED"
    await saveState(TEST_DIR, state)

    const result = await pauseDiscussionTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid transition")
  })
})

describe("resume_discussion tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully resumes to previous phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PAUSED"
    state.previousPhase = "ANALYSIS"
    await saveState(TEST_DIR, state)

    const result = await resumeDiscussionTool.execute(
      { target_phase: "ANALYSIS" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Discussion Resumed")
    const output = (result as { output: string }).output
    expect(output).toContain("ANALYSIS")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("ANALYSIS")
    expect(loaded.previousPhase).toBeNull()
  })

  test("warns when resuming to different phase than paused from", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PAUSED"
    state.previousPhase = "ANALYSIS"
    await saveState(TEST_DIR, state)

    const result = await resumeDiscussionTool.execute(
      { target_phase: "CONSENSUS" },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("Warning")
    expect(output).toContain("ANALYSIS")
    expect(output).toContain("CONSENSUS")
  })

  test("returns error when not PAUSED", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    await saveState(TEST_DIR, state)

    const result = await resumeDiscussionTool.execute(
      { target_phase: "ANALYSIS" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("not paused")
  })

  test("returns error for invalid target phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PAUSED"
    await saveState(TEST_DIR, state)

    const result = await resumeDiscussionTool.execute(
      { target_phase: "INVALID_PHASE" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid phase")
  })
})

describe("cancel_discussion tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully cancels from ANALYSIS and clears data", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "a", agentName: "A", content: "c", turn: 1, timestamp: new Date().toISOString() },
    ]
    state.discussion.votes = [
      { agentId: "a", agentName: "A", vote: 1, reason: "ok", round: 1 },
    ]
    state.discussion.currentTurn = 2
    await saveState(TEST_DIR, state)

    const result = await cancelDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Cancelled")
    const output = (result as { output: string }).output
    expect(output).toContain("CANCELLED")
    expect(output).toContain("analysis data cleared")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("CANCELLED")
    expect(loaded.discussion.analyses).toEqual([])
    expect(loaded.discussion.votes).toEqual([])
    expect(loaded.discussion.currentTurn).toBe(0)
  })

  test("returns error when already CANCELLED", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "CANCELLED"
    await saveState(TEST_DIR, state)

    const result = await cancelDiscussionTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid transition")
    expect(result).toContain("CANCELLED")
  })

  test("can cancel from PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await cancelDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Cancelled")
  })
})

describe("register_analysis validation gates", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
      { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
    ]
    state.discussion.topic = "Test Topic"
    state.discussion.maxTurns = 2
    state.discussion.participants = ["eng-1", "design-1"]
    // Seed under the same session ID the tool uses (makeContext → "test-session")
    await saveState(TEST_DIR, state, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("rejects non-participant (BUG-05)", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "unknown-agent",
        agent_name: "Unknown",
        content: "Test analysis",
        turn: 1,
      },
      makeContext()
    )

    expect(result).toContain("not a participant")
  })

  test("rejects analysis turn exceeding hardMaxTurns ceiling (Tier 1)", async () => {
    // Use "light" profile where hardMaxTurns=2 so turn 3 exceeds the hard ceiling.
    const state = await loadState(TEST_DIR, "test-session")
    state.discussion.rigor = "light"
    await saveState(TEST_DIR, state, "test-session")

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Test analysis",
        turn: 3,
      },
      makeContext()
    )

    expect(result).toContain("exceeds hard ceiling")
  })

  test("discussion turns are not blocked by analysis maxTurns (D4 bug fix)", async () => {
    // maxTurns=2 but a discussion turn at turn 3 must NOT be rejected by it.
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Consensus position",
        turn: 3,
        turn_type: "discussion",
        round: 1,
      },
      makeContext()
    )

    const output = (result as { title?: string }).title
    expect(output).toBe("Analysis Registered: Engineer")
  })

  test("discussion turn beyond maxConsensusRounds is rejected (D4)", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Debate position",
        turn: 1,
        turn_type: "discussion",
        round: 5, // exceeds maxConsensusRounds (2)
      },
      makeContext()
    )

    expect(result).toContain("exceeds maxConsensusRounds")
  })

  test("analysis turn beyond profileTurns requires a reason (D2 deviation)", async () => {
    // standard profile: profileTurns=2, so turn 3 is a deviation needing a reason.
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Extra turn analysis",
        turn: 3,
      },
      makeContext()
    )

    expect(result).toContain("profileTurns")
    expect(result).toContain("reason")
  })

  test("analysis turn beyond profileTurns with reason is accepted and counted (D2)", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Extra turn analysis with justification",
        turn: 3,
        reason: "Unresolved tension between security and performance requires a third pass.",
      },
      makeContext()
    )

    expect((result as { title?: string }).title).toBe("Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.deviations).toBe(1)
  })

  test("deviation rate cap (>3/session) triggers human escalation (D2)", async () => {
    // Pre-seed deviations at the cap threshold.
    const state = await loadState(TEST_DIR, "test-session")
    state.discussion.deviations = 3
    await saveState(TEST_DIR, state, "test-session")

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "One deviation too many",
        turn: 3,
        reason: "Yet another extra turn.",
      },
      makeContext()
    )

    expect(result).toContain("rate cap")
  })

  test("rejects turn less than 1 (BUG-01)", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Test analysis",
        turn: 0,
      },
      makeContext()
    )

    expect(result).toContain("Turn must be 1 or greater")
  })

  test("matches agent ID by suffix (BUG-13)", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "1",  // suffix of "eng-1"
        agent_name: "Engineer",
        content: "Test analysis content here",
        turn: 1,
      },
      makeContext()
    )

    const output = (result as { title: string }).title
    expect(output).toContain("Analysis Registered")

    // Verify stored with full ID
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.analyses[0].agentId).toBe("eng-1")
  })

  test("shows content preview in response (BUG-20)", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "This is a detailed analysis that should be previewed in the response for human observability",
        turn: 1,
      },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("Analysis Preview")
    expect(output).toContain("detailed analysis")
  })

  test("shows next-step hint when turn incomplete", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Test",
        turn: 1,
      },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("Next: Register analysis from the next specialist")
  })

  test("shows turn complete hint when all analysts done", async () => {
    // Register first analyst
    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "First analysis",
        turn: 1,
      },
      makeContext()
    )

    // Register second analyst
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "design-1",
        agent_name: "Designer",
        content: "Second analysis",
        turn: 1,
      },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("Turn 1 complete")
  })
})

describe("request_consensus validation gates", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("blocks consensus when analyses incomplete (BUG-04)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
      { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.maxTurns = 2
    state.discussion.participants = ["eng-1", "design-1"]
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Analysis 1", turn: 1, timestamp: new Date().toISOString() },
      { agentId: "design-1", agentName: "Designer", content: "Analysis 2", turn: 1, timestamp: new Date().toISOString() },
      // Only eng-1 has turn 2 — design-1 is missing
      { agentId: "eng-1", agentName: "Engineer", content: "Analysis 1 turn 2", turn: 2, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await requestConsensusTool.execute(
      {
        votes: [
          { agent_id: "eng-1", agent_name: "Engineer", vote: 1, reason: "OK" },
          { agent_id: "design-1", agent_name: "Designer", vote: 1, reason: "OK" },
        ],
        round: 1,
      },
      makeContext()
    )

    expect(result).toContain("Not all analyses complete")
    expect(result).toContain("Designer")
  })

  test("blocks consensus from non-participant voters (BUG-05)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.maxTurns = 1
    state.discussion.participants = ["eng-1"]
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Analysis", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await requestConsensusTool.execute(
      {
        votes: [
          { agent_id: "eng-1", agent_name: "Engineer", vote: 1, reason: "OK" },
          { agent_id: "intruder", agent_name: "Intruder", vote: 1, reason: "Hacking" },
        ],
        round: 1,
      },
      makeContext()
    )

    expect(result).toContain("not a participant")
    expect(result).toContain("Intruder")
  })

  test("allows consensus when all analyses complete for all turns", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
      { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.maxTurns = 2
    state.discussion.participants = ["eng-1", "design-1"]
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "T1", turn: 1, timestamp: new Date().toISOString() },
      { agentId: "design-1", agentName: "Designer", content: "T1", turn: 1, timestamp: new Date().toISOString() },
      { agentId: "eng-1", agentName: "Engineer", content: "T2", turn: 2, timestamp: new Date().toISOString() },
      { agentId: "design-1", agentName: "Designer", content: "T2", turn: 2, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await requestConsensusTool.execute(
      {
        votes: [
          { agent_id: "eng-1", agent_name: "Engineer", vote: 1, reason: "I agree with the approach" },
          { agent_id: "design-1", agent_name: "Designer", vote: 2, reason: "Agree with UX reservations" },
        ],
        round: 1,
      },
      makeContext()
    )

    const output = (result as { title: string }).title
    expect(output).toContain("Consensus")
  })
})

describe("generate_specification budget enforcement", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("rejects section exceeding 8k chars", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "CONSENSUS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.participants = ["eng-1"]
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Analysis", turn: 1, timestamp: new Date().toISOString() },
    ]
    state.discussion.votes = [
      { agentId: "eng-1", agentName: "Engineer", vote: 1, reason: "OK", round: 1 },
    ]
    state.discussion.consensusRound = 1
    await saveState(TEST_DIR, state)

    const longContent = "x".repeat(400001)
    const result = await generateSpecificationTool.execute(
      {
        content: longContent,
        topic: "Test Spec",
      },
      makeContext()
    )

    expect(result).toContain("exceeds total budget")

    // Verify phase reverted to CONSENSUS
    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("CONSENSUS")
  })

  test("rejects total document exceeding 400k chars", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "CONSENSUS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.participants = ["eng-1"]
    state.discussion.consensusRound = 1
    await saveState(TEST_DIR, state)

    const bigContent = "x".repeat(400001)
    const result = await generateSpecificationTool.execute(
      {
        content: bigContent,
        topic: "Big Spec",
      },
      makeContext()
    )

    expect(result).toContain("exceeds total budget")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("CONSENSUS")
  })

  test("accepts sections within budget", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "CONSENSUS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.participants = ["eng-1"]
    state.discussion.consensusRound = 1
    await saveState(TEST_DIR, state)

    const result = await generateSpecificationTool.execute(
      {
        content: "## Context\nTest content\n## Decision\nWe decided X\n## Implementation\nDo Y\n## Risks\nNone",
        topic: "Good Spec",
      },
      makeContext()
    )

    const output = (result as { title: string }).title
    expect(output).toContain("Specification Generated")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("APPROVAL")
  })
})
