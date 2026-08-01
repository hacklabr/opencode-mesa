import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage, setStateSdkClient } from "../state.js"
import { createInitialState } from "../config.js"
import {
  openAnalysisRoundTool,
  registerAnalysisTool,
  requestConsensusTool,
  generateSpecificationTool,
  approveSpecificationTool,
  pauseDiscussionTool,
  resumeDiscussionTool,
  cancelDiscussionTool,
} from "../tools/discussion-tools.js"
import {
  askPeerTool,
  recordAgentSession,
  getAgentSession,
  clearAgentSessions,
  setSdkClient,
} from "../tools/peer-tools.js"

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
    setSdkClient(null)
    clearAgentSessions()
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully opens analysis round from PLANNING", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

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
    expect(output).toContain("DISCUSSION")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("DISCUSSION")
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
    state.specification = { path: "/old/spec.md", overviewPath: null, status: "draft" }
    state.discussion.votes = [
      { agentId: "a", agentName: "A", vote: 1, reason: "ok", round: 1 },
    ]
    await saveState(TEST_DIR, state, "test-session")

    await openAnalysisRoundTool.execute(
      {
        topic: "New Topic",
        participants: ["eng-1"],
        force: true,
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.specification.path).toBeNull()
    expect(loaded.specification.status).toBe("pending")
    expect(loaded.discussion.votes).toEqual([])
    expect(loaded.discussion.consensusRound).toBe(0)
  })

  test("returns error when not in PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

    const result = await openAnalysisRoundTool.execute(
      { topic: "Test", participants: ["eng-1"] },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("DISCUSSION")
  })

  test("warns when existing analyses exist without force", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.discussion.analyses = [
      { agentId: "a", agentName: "A", content: "c", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state, "test-session")

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
    await saveState(TEST_DIR, state, "test-session")

    await openAnalysisRoundTool.execute(
      {
        topic: "Test",
        participants: ["eng-1"],
        briefing_content: "## Briefing for analysis",
      },
      makeContext()
    )

    // Decision M5 (spec-6886df4f): briefing-for-discussion is now inside
    // the session folder, not at the .mesa root.
    const loaded = await loadState(TEST_DIR, "test-session")
    const file = await fs.readFile(
      join(TEST_DIR, loaded.sessionFolder!, "briefing-for-discussion.md"),
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
    await saveState(TEST_DIR, state, "test-session")

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
    await saveState(TEST_DIR, state, "test-session")

    await openAnalysisRoundTool.execute(
      {
        topic: "Test Participants",
        participants: ["eng-1", "design-1"],
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.participants).toEqual(["eng-1", "design-1"])
  })

  test("preserves agent session mappings across rounds — ask_peer still routes after a second round (D10.1)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    // Specialist self-registered from their own session during round 1.
    recordAgentSession("eng-1", "ses_eng-1")

    await openAnalysisRoundTool.execute(
      { topic: "Round 1", participants: ["eng-1"] },
      makeContext()
    )

    // Return to PLANNING so the legacy phase guard allows a second round.
    const afterR1 = await loadState(TEST_DIR, "test-session")
    afterR1.currentPhase = "PLANNING"
    await saveState(TEST_DIR, afterR1, "test-session")

    await openAnalysisRoundTool.execute(
      { topic: "Round 2", participants: ["eng-1"], force: true },
      makeContext()
    )

    // The session mapping must survive the second round open.
    expect(getAgentSession("eng-1")).toBe("ses_eng-1")

    // And a consultation after the second round must route to that session.
    let promptedSessionId: string | null = null
    setSdkClient({
      session: {
        status: async () => ({ data: { "ses_eng-1": { type: "idle" } } }),
        prompt: async (opts: { path: { id: string } }) => {
          promptedSessionId = opts.path.id
          return { data: { parts: [{ type: "text", text: "peer answer" }] } }
        },
      },
    })

    const result = await askPeerTool.execute(
      { peer_id: "eng-1", question: "still there?" },
      makeContext()
    )

    expect(promptedSessionId).toBe("ses_eng-1")
    expect((result as { output: string }).output).toContain("peer answer")
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
    state.currentPhase = "DISCUSSION"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

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

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.analyses.length).toBe(1)
    expect(loaded.discussion.analyses[0].agentId).toBe("eng-1")
    expect(loaded.discussion.analyses[0].content).toBe("I recommend microservices.")
  })

  test("rejects duplicate analysis (same agent + turn)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "First", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state, "test-session")

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
    await saveState(TEST_DIR, state, "test-session")

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "Analysis", turn: 1 },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("PLANNING")
  })

  test("uses session_id parameter to store analysis in Manager's session folder", async () => {
    const managerSessionId = "manager-session"
    const subagentSessionId = "subagent-session"

    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.briefing.status = "approved"
    state.briefing.slug = "manager-project"
    state.sessionFolder = ".mesa/sessions/202607151200_1234_manager-project"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.participants = ["eng-1"]
    await saveState(TEST_DIR, state, managerSessionId)

    // Register analysis as if called by a subagent (different context.sessionID)
    // but with session_id pointing to the Manager's session.
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Analysis from subagent.",
        turn: 1,
        session_id: managerSessionId,
      },
      { ...makeContext(), sessionID: subagentSessionId }
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR, managerSessionId)
    expect(loaded.discussion.analyses.length).toBe(1)
    const filePath = loaded.discussion.analyses[0].filePath
    expect(filePath).toMatch(
      /\.mesa\/sessions\/[0-9]{12}_[0-9a-f]{4}_manager-project\/analyses\/turn1\/eng-1\.md$/
    )

    const fileExists = await fs
      .access(join(TEST_DIR, filePath!))
      .then(() => true)
      .catch(() => false)
    expect(fileExists).toBe(true)

    const sessionsDir = join(TEST_DIR, ".mesa", "sessions")
    const sessionFolders = await fs.readdir(sessionsDir)
    expect(sessionFolders.length).toBe(1)
  })

  test("resolves Manager session automatically from subagent parent chain", async () => {
    const managerSessionId = "ses_manager_session_auto"
    const subagentSessionId = "ses_subagent_session_auto"

    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.briefing.status = "approved"
    state.briefing.slug = "auto-project"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.participants = ["eng-1"]
    await saveState(TEST_DIR, state, managerSessionId)

    // Mock the SDK parent-session lookup so the subagent resolves to the Manager.
    setStateSdkClient({
      session: {
        get: async ({ path }: { path: { id: string } }) => {
          if (path.id === subagentSessionId) {
            return { data: { parentID: managerSessionId } }
          }
          return { data: null }
        },
      },
    })

    // Register analysis as a subagent WITHOUT passing session_id.
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Analysis via automatic root resolution.",
        turn: 1,
      },
      { ...makeContext(), sessionID: subagentSessionId }
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    // The analysis must be stored in the Manager's session folder.
    const loaded = await loadState(TEST_DIR, managerSessionId)
    expect(loaded.discussion.analyses.length).toBe(1)
    expect(loaded.discussion.analyses[0].filePath).toMatch(
      /\.mesa\/sessions\/[0-9]{12}_[0-9a-f]{4}_auto-project\/analyses\/turn1\/eng-1\.md$/
    )

    const sessionsDir = join(TEST_DIR, ".mesa", "sessions")
    const sessionFolders = await fs.readdir(sessionsDir)
    expect(sessionFolders.length).toBe(1)

    // Reset SDK client so other tests are not affected.
    setStateSdkClient(null)
  })

  test("registered_by_manager flag records fallback registration without capturing session", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.participants = ["eng-1"]
    await saveState(TEST_DIR, state, "test-session")

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Manager-registered fallback content.",
        turn: 1,
        registered_by_manager: true,
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.analyses.length).toBe(1)
    expect(loaded.discussion.analyses[0].registeredByManager).toBe(true)
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
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

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

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("DISCUSSION")
    expect(loaded.discussion.consensusRound).toBe(1)
    expect(loaded.discussion.votes.length).toBe(2)
  })

  test("detects disagreement and returns debate message", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

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
    state.currentPhase = "DISCUSSION"
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "ok", round: 1 },
    ]
    await saveState(TEST_DIR, state, "test-session")

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
    await saveState(TEST_DIR, state, "test-session")

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
    state.currentPhase = "DISCUSSION"
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
    await saveState(TEST_DIR, state, "test-session")

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

    // metadata.path is workspace-relative (spec-6886df4f, TD3).
    // Prepend TEST_DIR for filesystem I/O.
    const specFile = await fs.readFile(join(TEST_DIR, metadata!.path), "utf-8")
    expect(specFile).toContain("System Design")
    expect(specFile).toContain("microservices")
    expect(specFile).toContain("Executive Summary")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("SPECIFICATION")
    expect(loaded.specification.status).toBe("draft")
  })

  test("returns error from invalid phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state, "test-session")

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
    state.currentPhase = "SPECIFICATION"
    state.specification = { path: "/spec.md", overviewPath: "/overview.md", status: "draft" }
    await saveState(TEST_DIR, state, "test-session")

    const result = await approveSpecificationTool.execute(
      { approved: true },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Specification Approved")
    const output = (result as { output: string }).output
    expect(output).toContain("EXECUTION")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("EXECUTION")
    expect(loaded.specification.status).toBe("approved")
  })

  test("rejects specification and returns to DOCUMENTATION", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "SPECIFICATION"
    state.specification = { path: "/spec.md", overviewPath: null, status: "draft" }
    await saveState(TEST_DIR, state, "test-session")

    const result = await approveSpecificationTool.execute(
      { approved: false, feedback: "Needs more detail" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Specification Rejected")
    const output = (result as { output: string }).output
    expect(output).toContain("SPECIFICATION")
    expect(output).toContain("Needs more detail")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("SPECIFICATION")
    expect(loaded.specification.status).toBe("rejected")
  })

  test("returns error when not in APPROVAL phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state, "test-session")

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
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

    const result = await pauseDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Paused")
    const output = (result as { output: string }).output
    expect(output).toContain("DISCUSSION")

    const loaded = await loadState(TEST_DIR, "test-session")
    // Pause sets the orthogonal `status` field; the phase is preserved for resume.
    expect(loaded.status).toBe("paused")
    expect(loaded.currentPhase).toBe("DISCUSSION")
    expect(loaded.previousPhase).toBe("DISCUSSION")
  })

  test("pausing when already paused is idempotent (status-based, not phase-transition)", async () => {
    const state = createInitialState(TEST_DIR)
    state.status = "paused"
    state.currentPhase = "DISCUSSION"
    state.previousPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

    const result = await pauseDiscussionTool.execute({}, makeContext())

    // The status-based model has no invalid PAUSED→PAUSED transition; pause is idempotent.
    expect(result).toHaveProperty("title", "Discussion Paused")
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("paused")
    expect(loaded.currentPhase).toBe("DISCUSSION")
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
    state.currentPhase = "PAUSED" as any
    state.previousPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

    const result = await resumeDiscussionTool.execute(
      { target_phase: "DISCUSSION" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Discussion Resumed")
    const output = (result as { output: string }).output
    expect(output).toContain("DISCUSSION")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("DISCUSSION")
    expect(loaded.previousPhase).toBeNull()
  })

  test("resumes to an explicitly requested phase different from the paused one", async () => {
    const state = createInitialState(TEST_DIR)
    state.status = "paused"
    state.currentPhase = "DISCUSSION"
    state.previousPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

    // Request a different valid phase than the one we paused from.
    const result = await resumeDiscussionTool.execute(
      { target_phase: "SPECIFICATION" },
      makeContext()
    )

    // The status-based resume has no "different phase" warning; it honours the request.
    expect(result).toHaveProperty("title", "Discussion Resumed")
    const output = (result as { output: string }).output
    expect(output).toContain("SPECIFICATION")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("active")
    expect(loaded.currentPhase).toBe("SPECIFICATION")
    expect(loaded.previousPhase).toBeNull()
  })

  test("returns error when not PAUSED", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

    const result = await resumeDiscussionTool.execute(
      { target_phase: "DISCUSSION" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("not paused")
  })

  test("returns error for invalid target phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PAUSED" as any
    await saveState(TEST_DIR, state, "test-session")

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
    state.currentPhase = "DISCUSSION"
    state.discussion.analyses = [
      { agentId: "a", agentName: "A", content: "c", turn: 1, timestamp: new Date().toISOString() },
    ]
    state.discussion.votes = [
      { agentId: "a", agentName: "A", vote: 1, reason: "ok", round: 1 },
    ]
    state.discussion.currentTurn = 2
    await saveState(TEST_DIR, state, "test-session")

    const result = await cancelDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Cancelled")
    const output = (result as { output: string }).output
    expect(output).toContain("cancelled")
    expect(output).toContain("analysis data cleared")

    const loaded = await loadState(TEST_DIR, "test-session")
    // Cancel sets the orthogonal `status` field; the phase is kept for audit.
    expect(loaded.status).toBe("cancelled")
    expect(loaded.currentPhase).toBe("DISCUSSION")
    expect(loaded.discussion.analyses).toEqual([])
    expect(loaded.discussion.votes).toEqual([])
    expect(loaded.discussion.currentTurn).toBe(0)
  })

  test("cancelling when already cancelled is idempotent (status-based, not phase-transition)", async () => {
    const state = createInitialState(TEST_DIR)
    state.status = "cancelled"
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state, "test-session")

    const result = await cancelDiscussionTool.execute({}, makeContext())

    // The status-based model has no invalid CANCELLED→CANCELLED transition; cancel is idempotent.
    expect(result).toHaveProperty("title", "Discussion Cancelled")
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("cancelled")
  })

  test("can cancel from PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state, "test-session")

    const result = await cancelDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Cancelled")
  })
})

describe("register_analysis validation gates", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
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
    state.currentPhase = "DISCUSSION"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
      { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.maxTurns = 2
    state.discussion.participants = ["eng-1", "design-1"]
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Analysis 1", turn: 1, timestamp: new Date().toISOString() },
      { agentId: "eng-1", agentName: "Engineer", content: "Analysis 1 turn 2", turn: 2, timestamp: new Date().toISOString() },
      // design-1 has registered NO analysis at all — the relaxed completeness gate
      // (spec-4dcc492f) only requires each participant to have ≥1 analysis, so this
      // is the condition that now triggers the BUG-04 block.
    ]
    await saveState(TEST_DIR, state, "test-session")

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

    expect(result).toContain("Not all participants have registered analyses")
    expect(result).toContain("Designer")
  })

  test("blocks consensus from non-participant voters (BUG-05)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.maxTurns = 1
    state.discussion.participants = ["eng-1"]
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Analysis", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state, "test-session")

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
    state.currentPhase = "DISCUSSION"
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
    await saveState(TEST_DIR, state, "test-session")

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
    state.currentPhase = "DISCUSSION"
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
    await saveState(TEST_DIR, state, "test-session")

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
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("DISCUSSION")
  })

  test("rejects total document exceeding 400k chars", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.participants = ["eng-1"]
    state.discussion.consensusRound = 1
    await saveState(TEST_DIR, state, "test-session")

    const bigContent = "x".repeat(400001)
    const result = await generateSpecificationTool.execute(
      {
        content: bigContent,
        topic: "Big Spec",
      },
      makeContext()
    )

    expect(result).toContain("exceeds total budget")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("DISCUSSION")
  })

  test("accepts sections within budget", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.topic = "Test"
    state.discussion.participants = ["eng-1"]
    state.discussion.consensusRound = 1
    await saveState(TEST_DIR, state, "test-session")

    const result = await generateSpecificationTool.execute(
      {
        content: "## Context\nTest content\n## Decision\nWe decided X\n## Implementation\nDo Y\n## Risks\nNone",
        topic: "Good Spec",
      },
      makeContext()
    )

    const output = (result as { title: string }).title
    expect(output).toContain("Specification Generated")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("SPECIFICATION")
  })
})
