import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state"
import { createInitialState } from "../config"
import {
  registerAnalysisTool,
  getPeerAnalysesTool,
} from "../tools/discussion-tools"
import {
  buildAnalysisPath,
  buildDiscussionPath,
  buildAskPeerPath,
  validateWorkspacePath,
} from "../utils/paths"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "phase1-tests")

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

// ---------------------------------------------------------------------------
// P1-T16a: buildAnalysisPath — session-scoped path generation
// ---------------------------------------------------------------------------

describe("buildAnalysisPath", () => {
  test("generates correct turn path with session-scoping", () => {
    const path = buildAnalysisPath("ses-abc-123", 1, "backend-architect")
    expect(path).toBe(join(".mesa", "analyses", "ses-abc-123", "turn1", "backend-architect.md"))
  })

  test("generates turn 2 path correctly", () => {
    const path = buildAnalysisPath("ses-abc-123", 2, "frontend-architect")
    expect(path).toBe(join(".mesa", "analyses", "ses-abc-123", "turn2", "frontend-architect.md"))
  })

  test("uses full personaId without slugification", () => {
    const path = buildAnalysisPath("ses-123", 1, "software-development-backend-architect")
    expect(path).toContain("software-development-backend-architect.md")
  })

  test("different sessions produce different paths", () => {
    const path1 = buildAnalysisPath("ses-A", 1, "arch")
    const path2 = buildAnalysisPath("ses-B", 1, "arch")
    expect(path1).not.toBe(path2)
    expect(path1).toContain("ses-A")
    expect(path2).toContain("ses-B")
  })
})

describe("buildDiscussionPath", () => {
  test("generates discussion round path", () => {
    const path = buildDiscussionPath("ses-abc", 1, "architect")
    expect(path).toBe(join(".mesa", "analyses", "ses-abc", "discussion-r1", "architect.md"))
  })

  test("round 2 produces different path", () => {
    const path1 = buildDiscussionPath("ses-abc", 1, "architect")
    const path2 = buildDiscussionPath("ses-abc", 2, "architect")
    expect(path1).toContain("discussion-r1")
    expect(path2).toContain("discussion-r2")
  })
})

describe("buildAskPeerPath", () => {
  test("generates ask_peer exchange path", () => {
    const path = buildAskPeerPath("ses-abc", "caller-1", "callee-2", "ex-xyz")
    expect(path).toBe(join(".mesa", "analyses", "ses-abc", "ask_peer", "caller-1_callee-2_ex-xyz.md"))
  })
})

// ---------------------------------------------------------------------------
// P1-T16b: validateWorkspacePath — path-traversal prevention
// ---------------------------------------------------------------------------

describe("validateWorkspacePath", () => {
  const WORKSPACE = "/home/user/project"

  test("accepts a valid path within workspace", () => {
    const result = validateWorkspacePath(WORKSPACE, ".mesa/analyses/turn1/arch.md")
    expect(result.valid).toBe(true)
  })

  test("rejects path traversal with ..", () => {
    const result = validateWorkspacePath(WORKSPACE, "../../../etc/passwd")
    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toContain("within workspace")
  })

  test("rejects path traversal with nested ..", () => {
    const result = validateWorkspacePath(WORKSPACE, ".mesa/../../etc/shadow")
    expect(result.valid).toBe(false)
  })

  test("rejects absolute path", () => {
    const result = validateWorkspacePath(WORKSPACE, "/etc/passwd")
    expect(result.valid).toBe(false)
  })

  test("accepts deeply nested valid path", () => {
    const result = validateWorkspacePath(WORKSPACE, ".mesa/analyses/ses-abc/turn1/backend-architect.md")
    expect(result.valid).toBe(true)
  })

  test("accepts path that stays within workspace via .. that resolves inside", () => {
    // .mesa/../.mesa/valid resolves to .mesa/valid — still within workspace
    const result = validateWorkspacePath(WORKSPACE, ".mesa/../.mesa/valid.md")
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P1-T16c: register_analysis with new params (kind, filePath, turnType)
// ---------------------------------------------------------------------------

describe("register_analysis extended params", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("accepts file_path and stores it in state", async () => {
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
        content: "Full analysis content",
        turn: 1,
        file_path: ".mesa/analyses/ses-1/turn1/eng-1.md",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses[0].filePath).toBe(".mesa/analyses/ses-1/turn1/eng-1.md")
  })

  test("accepts kind='full' explicitly", async () => {
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
        content: "Full analysis",
        turn: 1,
        kind: "full",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses[0].kind).toBe("full")
  })

  test("defaults kind to 'full' when omitted", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Analysis without kind",
        turn: 1,
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses[0].kind).toBe("full")
  })

  test("defaults turnType to 'analysis' when omitted", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Analysis",
        turn: 1,
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses[0].turnType).toBe("analysis")
  })

  test("accepts turnType='discussion' with round and positionInTurn", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.mode = "debate"
    state.discussion.maxTurns = 5
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    // Need a prior full analysis for the agent
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Full", turn: 1, kind: "full", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Discussion contribution",
        turn: 3,
        kind: "full",
        turn_type: "discussion",
        round: 1,
        position_in_turn: 2,
        responds_to: "design-1",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR)
    const discussionEntry = loaded.discussion.analyses.find(a => a.turnType === "discussion")
    expect(discussionEntry).toBeDefined()
    expect(discussionEntry!.turnType).toBe("discussion")
    expect(discussionEntry!.round).toBe(1)
    expect(discussionEntry!.positionInTurn).toBe(2)
    expect(discussionEntry!.respondsTo).toBe("design-1")
  })

  test("stores sessionResumed flag", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Resumed session analysis",
        turn: 1,
        session_resumed: true,
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses[0].sessionResumed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P1-T16d: Delta validation gate
// ---------------------------------------------------------------------------

describe("delta validation gate", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("rejects delta without prior full for same agent", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.maxTurns = 3
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Delta without base",
        turn: 1,
        kind: "delta",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Cannot register delta without a prior full")
  })

  test("accepts delta when a prior full exists for same agent", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.maxTurns = 3
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Full analysis", turn: 1, kind: "full", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Delta: I refine my position on X",
        turn: 2,
        kind: "delta",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses).toHaveLength(2)
    expect(loaded.discussion.analyses[1].kind).toBe("delta")
  })

  test("rejects delta when prior full exists for DIFFERENT agent", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.maxTurns = 3
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
      { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
    ]
    state.discussion.analyses = [
      { agentId: "design-1", agentName: "Designer", content: "Full", turn: 1, kind: "full", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Delta",
        turn: 2,
        kind: "delta",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Cannot register delta without a prior full")
  })
})

// ---------------------------------------------------------------------------
// P1-T16e: Path-traversal validation in register_analysis
// ---------------------------------------------------------------------------

describe("path-traversal validation in register_analysis", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("rejects file_path with .. traversal", async () => {
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
        content: "Malicious analysis",
        turn: 1,
        file_path: "../../../etc/cron.d/backdoor",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Path must be within workspace")
  })

  test("rejects absolute file_path", async () => {
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
        content: "Bad path",
        turn: 1,
        file_path: "/etc/passwd",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Path must be within workspace")
  })

  test("accepts valid file_path within .mesa/", async () => {
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
        content: "Good analysis",
        turn: 1,
        file_path: ".mesa/analyses/ses-1/turn1/eng-1.md",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")
  })
})

// ---------------------------------------------------------------------------
// P1-T16f: get_peer_analyses tool
// ---------------------------------------------------------------------------

describe("get_peer_analyses tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("returns all analyses when no filter", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Eng turn 1", turn: 1, kind: "full", filePath: ".mesa/analyses/ses/turn1/eng-1.md", timestamp: new Date().toISOString() },
      { agentId: "design-1", agentName: "Designer", content: "Design turn 1", turn: 1, kind: "full", filePath: ".mesa/analyses/ses/turn1/design-1.md", timestamp: new Date().toISOString() },
      { agentId: "eng-1", agentName: "Engineer", content: "Eng delta", turn: 2, kind: "delta", filePath: ".mesa/analyses/ses/turn2/eng-1.md", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await getPeerAnalysesTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Peer Analyses")
    const metadata = (result as { metadata?: { count: number } }).metadata
    expect(metadata?.count).toBe(3)
  })

  test("filters by turn number", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Turn 1", turn: 1, kind: "full", timestamp: new Date().toISOString() },
      { agentId: "eng-1", agentName: "Engineer", content: "Turn 2", turn: 2, kind: "delta", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await getPeerAnalysesTool.execute({ turn: 2 }, makeContext())

    const metadata = (result as { metadata?: { count: number } }).metadata
    expect(metadata?.count).toBe(1)
  })

  test("filters by agent_id", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Eng", turn: 1, kind: "full", timestamp: new Date().toISOString() },
      { agentId: "design-1", agentName: "Designer", content: "Design", turn: 1, kind: "full", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await getPeerAnalysesTool.execute({ agent_id: "eng-1" }, makeContext())

    const metadata = (result as { metadata?: { count: number } }).metadata
    expect(metadata?.count).toBe(1)
  })

  test("returns filePath in results", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "With file", turn: 1, kind: "full", filePath: ".mesa/analyses/ses/turn1/eng-1.md", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await getPeerAnalysesTool.execute({}, makeContext())
    const metadata = (result as { metadata?: { analyses: Array<{ filePath: string | null }> } }).metadata
    expect(metadata?.analyses[0].filePath).toBe(".mesa/analyses/ses/turn1/eng-1.md")
  })

  test("flags missing files with reconciled=true", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "Missing file", turn: 1, kind: "full", filePath: ".mesa/analyses/ses/turn1/nonexistent.md", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await getPeerAnalysesTool.execute({}, makeContext())
    const output = (result as { output: string }).output
    expect(output).toContain("⚠️")
    expect(output).toContain("missing")
  })

  test("returns empty when no analyses exist", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    await saveState(TEST_DIR, state)

    const result = await getPeerAnalysesTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Peer Analyses")
    const metadata = (result as { metadata?: { count: number } }).metadata
    expect(metadata?.count).toBe(0)
  })

  test("returns contentPreview (first 300 chars)", async () => {
    const longContent = "x".repeat(500)
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: longContent, turn: 1, kind: "full", timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await getPeerAnalysesTool.execute({}, makeContext())
    const metadata = (result as { metadata?: { analyses: Array<{ contentPreview: string }> } }).metadata
    expect(metadata?.analyses[0].contentPreview.length).toBeLessThanOrEqual(303) // 300 + "..."
    expect(metadata?.analyses[0].contentPreview).toContain("...")
  })
})

// ---------------------------------------------------------------------------
// P1-T16g: Schema migration v3 — new fields with defaults
// ---------------------------------------------------------------------------

describe("schema migration v3", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("createInitialState includes mode and maxConsensusRounds", () => {
    const state = createInitialState(TEST_DIR)
    expect(state.discussion.mode).toBe("analysis")
    expect(state.discussion.maxConsensusRounds).toBe(2)
  })

  test("saveState and loadState roundtrips new fields", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.mode = "debate"
    state.discussion.maxConsensusRounds = 3
    state.discussion.analyses = [
      {
        agentId: "eng-1",
        agentName: "Engineer",
        content: "Full analysis with all fields",
        filePath: ".mesa/analyses/ses/turn1/eng-1.md",
        kind: "full",
        turn: 1,
        turnType: "analysis",
        timestamp: new Date().toISOString(),
      },
    ]
    await saveState(TEST_DIR, state)

    const loaded = await loadState(TEST_DIR)

    expect(loaded.discussion.mode).toBe("debate")
    expect(loaded.discussion.maxConsensusRounds).toBe(3)
    expect(loaded.discussion.analyses[0].filePath).toBe(".mesa/analyses/ses/turn1/eng-1.md")
    expect(loaded.discussion.analyses[0].kind).toBe("full")
    expect(loaded.discussion.analyses[0].turnType).toBe("analysis")
  })

  test("legacy entries without new fields get defaults on load", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    // Simulate a legacy entry without kind/turnType/filePath
    state.discussion.analyses = [
      {
        agentId: "legacy-1",
        agentName: "Legacy",
        content: "Old entry without new fields",
        turn: 1,
        timestamp: new Date().toISOString(),
      },
    ]
    await saveState(TEST_DIR, state)

    const loaded = await loadState(TEST_DIR)

    expect(loaded.discussion.analyses[0].kind).toBe("full")
    expect(loaded.discussion.analyses[0].turnType).toBe("analysis")
    expect(loaded.discussion.analyses[0].filePath).toBeNull()
  })

  test("tensionsRaised array roundtrips through SQLite", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.analyses = [
      {
        agentId: "eng-1",
        agentName: "Engineer",
        content: "Analysis with tensions",
        turn: 1,
        kind: "full",
        turnType: "discussion",
        tensionsRaised: ["API design conflict", "Data ownership disagreement"],
        timestamp: new Date().toISOString(),
      },
    ]
    await saveState(TEST_DIR, state)

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses[0].tensionsRaised).toEqual([
      "API design conflict",
      "Data ownership disagreement",
    ])
  })

  test("stateVersion is 3 after migration", async () => {
    const state = createInitialState(TEST_DIR)
    await saveState(TEST_DIR, state)

    const loaded = await loadState(TEST_DIR)
    expect(loaded.stateVersion).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// P1-T17: Integration test — full flow Turn 1 → Turn 2 → get_peer → traversal
// ---------------------------------------------------------------------------

describe("P1-T17: integration flow", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("full flow: turn 1 full → turn 2 delta → get_peer_analyses", async () => {
    // Setup
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.maxTurns = 2
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
      { personaId: "design-1", name: "Designer", division: "design", status: "summoned" },
    ]
    state.discussion.participants = ["eng-1", "design-1"]
    await saveState(TEST_DIR, state)

    // Turn 1: Register full analyses with file paths
    const t1eng = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Full backend analysis: recommend PostgreSQL with read replicas.",
        turn: 1,
        kind: "full",
        file_path: ".mesa/analyses/ses-1/turn1/eng-1.md",
      },
      makeContext()
    )
    expect(t1eng).toHaveProperty("title", "Analysis Registered: Engineer")

    const t1design = await registerAnalysisTool.execute(
      {
        agent_id: "design-1",
        agent_name: "Designer",
        content: "Full design analysis: recommend component-based UI architecture.",
        turn: 1,
        kind: "full",
        file_path: ".mesa/analyses/ses-1/turn1/design-1.md",
      },
      makeContext()
    )
    expect(t1design).toHaveProperty("title", "Analysis Registered: Designer")

    // Verify get_peer_analyses returns both turn-1 analyses
    const peersT1 = await getPeerAnalysesTool.execute({ turn: 1 }, makeContext())
    const peersT1Meta = (peersT1 as { metadata?: { count: number; analyses: Array<{ kind: string; filePath: string | null }> } }).metadata
    expect(peersT1Meta?.count).toBe(2)
    expect(peersT1Meta?.analyses.every(a => a.kind === "full")).toBe(true)
    expect(peersT1Meta?.analyses.every(a => a.filePath !== null)).toBe(true)

    // Turn 2: Register deltas (should pass — full exists for each agent)
    const t2eng = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Delta: After reading Designer's analysis, I agree on component approach but maintain PostgreSQL recommendation.",
        turn: 2,
        kind: "delta",
        file_path: ".mesa/analyses/ses-1/turn2/eng-1.md",
      },
      makeContext()
    )
    expect(t2eng).toHaveProperty("title", "Analysis Registered: Engineer")

    const t2design = await registerAnalysisTool.execute(
      {
        agent_id: "design-1",
        agent_name: "Designer",
        content: "Delta: Concur with backend on API contract, refine component boundaries.",
        turn: 2,
        kind: "delta",
        file_path: ".mesa/analyses/ses-1/turn2/design-1.md",
      },
      makeContext()
    )
    expect(t2design).toHaveProperty("title", "Analysis Registered: Designer")

    // Verify get_peer_analyses returns all 4 analyses across both turns
    const peersAll = await getPeerAnalysesTool.execute({}, makeContext())
    const peersAllMeta = (peersAll as { metadata?: { count: number } }).metadata
    expect(peersAllMeta?.count).toBe(4)

    // Verify turn-2 are deltas
    const peersT2 = await getPeerAnalysesTool.execute({ turn: 2 }, makeContext())
    const peersT2Meta = (peersT2 as { metadata?: { analyses: Array<{ kind: string }> } }).metadata
    expect(peersT2Meta?.analyses.every(a => a.kind === "delta")).toBe(true)

    // Verify persisted state
    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses).toHaveLength(4)
    expect(loaded.discussion.analyses.filter(a => a.kind === "full")).toHaveLength(2)
    expect(loaded.discussion.analyses.filter(a => a.kind === "delta")).toHaveLength(2)
  })

  test("delta without prior full is rejected in flow", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.maxTurns = 3
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.participants = ["eng-1"]
    await saveState(TEST_DIR, state)

    // Try delta on turn 1 without any prior full
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Orphan delta",
        turn: 1,
        kind: "delta",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Cannot register delta without a prior full")
  })

  test("path traversal rejected during full flow", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.participants = ["eng-1"]
    await saveState(TEST_DIR, state)

    // Normal full analysis first
    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Base analysis",
        turn: 1,
        kind: "full",
      },
      makeContext()
    )

    // Attempt delta with malicious file_path
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Delta with bad path",
        turn: 2,
        kind: "delta",
        file_path: "../../../etc/cron.d/payload",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Path must be within workspace")

    // Verify state was NOT modified
    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses).toHaveLength(1) // only the full from turn 1
  })

  test("full flow with escape hatch: delta → full override", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "ANALYSIS"
    state.discussion.maxTurns = 3
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    state.discussion.participants = ["eng-1"]
    await saveState(TEST_DIR, state)

    // Turn 1: full
    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Original position",
        turn: 1,
        kind: "full",
      },
      makeContext()
    )

    // Turn 2: full (escape hatch — specialist fundamentally revising)
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Complete revision: I now disagree with my turn 1 analysis entirely.",
        turn: 2,
        kind: "full", // explicit full override
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses).toHaveLength(2)
    expect(loaded.discussion.analyses.every(a => a.kind === "full")).toBe(true)
  })
})
