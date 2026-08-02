import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage, setStateSdkClient } from "../state.js"
import { createInitialState } from "../config.js"
import {
  registerAnalysisTool,
  getPeerAnalysesTool,
  pauseDiscussionTool,
  resumeDiscussionTool,
  cancelDiscussionTool,
} from "../tools/discussion-tools.js"
import type { DiscussionState, Round } from "../types.js"

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

function openRound(participants: string[], id = "r1"): Round {
  return {
    id,
    topic: "Test Topic",
    participants,
    status: "open",
    openedAt: new Date().toISOString(),
  }
}

/** State with a summoned team and an open kernel round (register_analysis precondition). */
function stateWithOpenRound(
  participants: string[] = ["eng-1"],
  mutate?: (s: DiscussionState) => void
): DiscussionState {
  const state = createInitialState(TEST_DIR)
  state.team = participants.map((id) => ({
    personaId: id,
    name: id,
    division: "test",
    status: "summoned" as const,
  }))
  state.discussion.topic = "Test Topic"
  state.discussion.participants = participants
  state.rounds = [openRound(participants)]
  if (mutate) mutate(state)
  return state
}

describe("register_analysis tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully registers analysis into the open round", async () => {
    await saveState(TEST_DIR, stateWithOpenRound(), "test-session")

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
    expect(output).toContain("round r1")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.analyses.length).toBe(1)
    expect(loaded.discussion.analyses[0].agentId).toBe("eng-1")
    expect(loaded.discussion.analyses[0].roundId).toBe("r1")
    expect(loaded.discussion.analyses[0].content).toBe("I recommend microservices.")
  })

  test("rejects registration when no round is open", async () => {
    const state = createInitialState(TEST_DIR)
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "Analysis", turn: 1 },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("No open round")
    expect(result).toContain("open_round")
  })

  test("rejects duplicate analysis (same agent + turn + round)", async () => {
    await saveState(TEST_DIR, stateWithOpenRound(["eng-1"], (s) => {
      s.discussion.analyses = [
        { agentId: "eng-1", agentName: "Engineer", content: "First", turn: 1, timestamp: new Date().toISOString(), roundId: "r1" },
      ]
    }), "test-session")

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "Duplicate", turn: 1 },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("already registered")
  })

  test("same agent + turn is allowed in a DIFFERENT round (multi-round dedup scoping)", async () => {
    await saveState(TEST_DIR, stateWithOpenRound(["eng-1"], (s) => {
      // Closed r1 with the agent's turn-1 analysis; r2 is open.
      s.rounds = [
        { ...openRound(["eng-1"], "r1"), status: "closed", closedAt: new Date().toISOString() },
        openRound(["eng-1"], "r2"),
      ]
      s.discussion.analyses = [
        { agentId: "eng-1", agentName: "Engineer", content: "First", turn: 1, timestamp: new Date().toISOString(), roundId: "r1" },
      ]
    }), "test-session")

    const result = await registerAnalysisTool.execute(
      { agent_id: "eng-1", agent_name: "Engineer", content: "Round 2 analysis", turn: 1 },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.analyses.length).toBe(2)
    expect(loaded.discussion.analyses[1].roundId).toBe("r2")
  })

  test("uses session_id parameter to store analysis in Manager's session folder", async () => {
    const managerSessionId = "manager-session"
    const subagentSessionId = "subagent-session"

    const state = stateWithOpenRound(["eng-1"], (s) => {
      s.briefing.status = "approved"
      s.briefing.slug = "manager-project"
      s.sessionFolder = ".mesa/sessions/202607151200_1234_manager-project"
    })
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

    const state = stateWithOpenRound(["eng-1"], (s) => {
      s.briefing.status = "approved"
      s.briefing.slug = "auto-project"
    })
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
    await saveState(TEST_DIR, stateWithOpenRound(), "test-session")

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

describe("register_analysis validation gates", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await saveState(TEST_DIR, stateWithOpenRound(["eng-1", "design-1"]), "test-session")
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
    const state = await loadState(TEST_DIR, "test-session")
    state.rounds[0].participants = ["software-development-backend-architect"]
    state.discussion.participants = ["software-development-backend-architect"]
    await saveState(TEST_DIR, state, "test-session")

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "backend-architect",
        agent_name: "Backend Architect",
        content: "Suffix match test",
        turn: 1,
      },
      makeContext()
    )

    expect(result).toHaveProperty("title")
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.discussion.analyses[0].agentId).toBe("software-development-backend-architect")
  })

  test("rejects delta without a prior full for the same agent", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Delta content",
        turn: 1,
        kind: "delta",
      },
      makeContext()
    )

    expect(result).toContain("prior full analysis")
  })

  test("accepts delta when a full exists for the same agent", async () => {
    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Full content",
        turn: 1,
      },
      makeContext()
    )

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Delta content",
        turn: 2,
        kind: "delta",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Analysis Registered: Engineer")
  })

  test("rejects file_path with path traversal", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Traversal",
        turn: 1,
        file_path: "../../etc/passwd",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).not.toContain("Operation not allowed")
  })

  test("enforces the per-round analysis budget (circuit breaker)", async () => {
    const state = await loadState(TEST_DIR, "test-session")
    state.discussion.analyses = Array.from({ length: 40 }, (_, i) => ({
      agentId: "eng-1",
      agentName: "Engineer",
      content: `a${i}`,
      turn: i + 1,
      timestamp: new Date().toISOString(),
      roundId: "r1",
    }))
    await saveState(TEST_DIR, state, "test-session")

    const result = await registerAnalysisTool.execute(
      {
        agent_id: "design-1",
        agent_name: "Designer",
        content: "one too many",
        turn: 1,
      },
      makeContext()
    )

    expect(result).toContain("budget exhausted")
    expect(result).toContain("40/40")
  })

  test("shows content preview in response (BUG-20)", async () => {
    const longContent = "x".repeat(400)
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: longContent,
        turn: 1,
      },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("...")
    expect(output.length).toBeLessThan(longContent.length + 600)
  })

  test("shows next-step hint when round incomplete", async () => {
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Analysis",
        turn: 1,
      },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("Next: Register analysis from the next participant")
  })

  test("shows close_round hint when all participants registered", async () => {
    await registerAnalysisTool.execute(
      {
        agent_id: "eng-1",
        agent_name: "Engineer",
        content: "Analysis",
        turn: 1,
      },
      makeContext()
    )
    const result = await registerAnalysisTool.execute(
      {
        agent_id: "design-1",
        agent_name: "Designer",
        content: "Analysis",
        turn: 1,
      },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("close_round")
  })
})

describe("get_peer_analyses tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await saveState(TEST_DIR, stateWithOpenRound(["eng-1", "design-1"], (s) => {
      s.discussion.analyses = [
        { agentId: "eng-1", agentName: "Engineer", content: "r1 analysis", turn: 1, timestamp: new Date().toISOString(), roundId: "r1" },
        { agentId: "design-1", agentName: "Designer", content: "old analysis", turn: 1, timestamp: new Date().toISOString(), roundId: "legacy-round-1" },
      ]
    }), "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("defaults to the open round when one exists", async () => {
    const result = await getPeerAnalysesTool.execute({}, makeContext())
    const metadata = (result as { metadata?: { analyses?: Array<{ roundId?: string }> } }).metadata
    expect(metadata?.analyses?.length).toBe(1)
    expect(metadata?.analyses?.[0].roundId).toBe("r1")
  })

  test("round_id filter selects an explicit round", async () => {
    const result = await getPeerAnalysesTool.execute({ round_id: "legacy-round-1" }, makeContext())
    const metadata = (result as { metadata?: { analyses?: Array<{ agentId: string }> } }).metadata
    expect(metadata?.analyses?.length).toBe(1)
    expect(metadata?.analyses?.[0].agentId).toBe("design-1")
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

  test("pauses an active session (status field only)", async () => {
    await saveState(TEST_DIR, createInitialState(TEST_DIR), "test-session")

    const result = await pauseDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Paused")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("paused")
  })

  test("pausing when already paused is idempotent", async () => {
    const state = createInitialState(TEST_DIR)
    state.status = "paused"
    await saveState(TEST_DIR, state, "test-session")

    const result = await pauseDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Paused")
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("paused")
  })

  test("refuses to pause a cancelled session", async () => {
    const state = createInitialState(TEST_DIR)
    state.status = "cancelled"
    await saveState(TEST_DIR, state, "test-session")

    const result = await pauseDiscussionTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("cancelled")
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

  test("resumes a paused session to active", async () => {
    const state = createInitialState(TEST_DIR)
    state.status = "paused"
    await saveState(TEST_DIR, state, "test-session")

    const result = await resumeDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Resumed")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("active")
  })

  test("returns error when not paused", async () => {
    await saveState(TEST_DIR, createInitialState(TEST_DIR), "test-session")

    const result = await resumeDiscussionTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("not paused")
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

  test("cancels and clears analysis data", async () => {
    const state = createInitialState(TEST_DIR)
    state.discussion.analyses = [
      { agentId: "a", agentName: "A", content: "c", turn: 1, timestamp: new Date().toISOString() },
    ]
    state.discussion.currentTurn = 2
    await saveState(TEST_DIR, state, "test-session")

    const result = await cancelDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Cancelled")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("cancelled")
    expect(loaded.discussion.analyses).toEqual([])
    expect(loaded.discussion.currentTurn).toBe(0)
  })

  test("cancelling when already cancelled is idempotent", async () => {
    const state = createInitialState(TEST_DIR)
    state.status = "cancelled"
    await saveState(TEST_DIR, state, "test-session")

    const result = await cancelDiscussionTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Discussion Cancelled")
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.status).toBe("cancelled")
  })
})
