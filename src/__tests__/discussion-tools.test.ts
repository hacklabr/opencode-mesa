import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { saveState } from "../state"
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
    expect(loaded.currentPhase).toBe("ANALYSIS")
    expect(loaded.discussion.topic).toBe("System Architecture")
    expect(loaded.discussion.maxTurns).toBe(3)
    expect(loaded.discussion.currentTurn).toBe(1)
    expect(loaded.discussion.analyses).toEqual([])
  })

  test("resets specification state on open", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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

    const file = await fs.readFile(
      join(TEST_DIR, ".mesa", "briefing-for-discussion.md"),
      "utf-8"
    )
    expect(file).toBe("## Briefing for analysis")
  })
})

describe("register_analysis tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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
    await saveState(TEST_DIR, state)

    const result = await generateSpecificationTool.execute(
      {
        sections: [
          { specialist_name: "Alice", specialist_id: "a", content: "## Backend\n\nUse microservices." },
        ],
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
    expect(specFile).toContain("Alice")
    expect(specFile).toContain("microservices")
    expect(specFile).toContain("AGREE")

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
    expect(loaded.currentPhase).toBe("APPROVAL")
    expect(loaded.specification.status).toBe("draft")
  })

  test("returns error from invalid phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await generateSpecificationTool.execute(
      {
        sections: [{ specialist_name: "A", specialist_id: "a", content: "c" }],
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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

    const loaded = JSON.parse(
      await fs.readFile(join(TEST_DIR, ".mesa", "state.json"), "utf-8")
    )
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
