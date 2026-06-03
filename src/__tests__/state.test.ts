import { describe, expect, test, afterAll, afterEach } from "vitest"
import { createInitialState, PLUGIN_VERSION } from "../config"
import type { DiscussionPhase } from "../types"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { loadState, saveState, getStatePath, closeStorage, getSessionId } from "../state"

describe("config", () => {
  test("PLUGIN_VERSION is semver format", () => {
    const semver = /^\d+\.\d+\.\d+$/
    expect(PLUGIN_VERSION).toMatch(semver)
  })

  test("createInitialState returns valid state", () => {
    const state = createInitialState("ws-123")
    expect(state.workspaceId).toBe("ws-123")
    expect(state.currentPhase).toBe("PLANNING")
    expect(state.briefing.status).toBe("draft")
    expect(state.briefing.path).toBeNull()
    expect(state.team).toEqual([])
    expect(state.discussion.analyses).toEqual([])
    expect(state.discussion.votes).toEqual([])
    expect(state.discussion.currentTurn).toBe(0)
    expect(state.specification.status).toBe("pending")
    expect(state.createdAt).toBeDefined()
    expect(state.updatedAt).toBeDefined()
  })

  const VALID_PHASES: DiscussionPhase[] = [
    "PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION",
    "APPROVAL", "EXECUTION", "PAUSED", "CANCELLED",
  ]

  test("all phases are covered", () => {
    const transitions: Record<DiscussionPhase, DiscussionPhase[]> = {
      PLANNING: ["ANALYSIS", "PAUSED", "CANCELLED"],
      ANALYSIS: ["CONSENSUS", "PAUSED", "CANCELLED"],
      CONSENSUS: ["DOCUMENTATION", "ANALYSIS", "PAUSED", "CANCELLED"],
      DOCUMENTATION: ["APPROVAL", "PAUSED", "CANCELLED"],
      APPROVAL: ["EXECUTION", "DOCUMENTATION", "PAUSED", "CANCELLED"],
      EXECUTION: ["PLANNING", "PAUSED", "CANCELLED"],
      PAUSED: ["PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION", "CANCELLED"],
      CANCELLED: ["PLANNING"],
    }

    for (const phase of VALID_PHASES) {
      expect(transitions[phase]).toBeDefined()
      for (const target of transitions[phase]) {
        expect(VALID_PHASES).toContain(target)
      }
    }
  })
})

describe("state persistence", () => {
  const testDir = join(import.meta.dirname, "__test_fixtures__")

  afterEach(() => {
    closeStorage(testDir)
  })

  test("loadState returns initial state when no file exists", async () => {
    const state = await loadState(testDir)
    expect(state.currentPhase).toBe("PLANNING")
    expect(state.briefing.status).toBe("draft")
  })

  test("saveState and loadState roundtrip", async () => {
    const state = await loadState(testDir)
    state.briefing.status = "approved"
    state.briefing.path = "briefings/test.md"
    state.briefing.slug = "test"

    await saveState(testDir, state)

    const loaded = await loadState(testDir)
    expect(loaded.briefing.status).toBe("approved")
    expect(loaded.briefing.path).toBe("briefings/test.md")
    expect(loaded.briefing.slug).toBe("test")
    expect(loaded.updatedAt).toBeTruthy()
  })

  test("saveState updates updatedAt", async () => {
    const state = await loadState(testDir)
    const oldUpdated = state.updatedAt

    await new Promise((r) => setTimeout(r, 10))
    await saveState(testDir, state)

    const loaded = await loadState(testDir)
    expect(new Date(loaded.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(oldUpdated).getTime()
    )
  })

  afterAll(async () => {
    closeStorage(testDir)
    await fs.rm(join(testDir, ".mesa"), { recursive: true, force: true })
  })

  test("two sessions in same workspace have independent state", async () => {
    // Session A: create and save with ANALYSIS phase
    const stateA = await loadState(testDir)
    stateA.currentPhase = "ANALYSIS"
    await saveState(testDir, stateA)
    const sessionAId = getSessionId(testDir)
    expect(sessionAId).toBeDefined()

    closeStorage(testDir)

    // Session B: create and save with CONSENSUS phase
    const stateB = await loadState(testDir)
    stateB.currentPhase = "CONSENSUS"
    await saveState(testDir, stateB)
    const sessionBId = getSessionId(testDir)
    expect(sessionBId).toBeDefined()
    expect(sessionBId).not.toBe(sessionAId)

    closeStorage(testDir)

    // Verify both sessions persisted independently in scoped tables
    const dbPath = await getStatePath(testDir)
    const db = new Database(dbPath, { readonly: true })
    try {
      const rowA = db
        .query("SELECT current_phase FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
        .get(testDir, sessionAId) as { current_phase: string } | null
      expect(rowA?.current_phase).toBe("ANALYSIS")

      const rowB = db
        .query("SELECT current_phase FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
        .get(testDir, sessionBId) as { current_phase: string } | null
      expect(rowB?.current_phase).toBe("CONSENSUS")

      // Verify unscoped table has the latest state (dual-write)
      const rowUnscoped = db
        .query("SELECT current_phase FROM mesa_state WHERE workspace_id = ?")
        .get(testDir) as { current_phase: string } | null
      expect(rowUnscoped?.current_phase).toBe("CONSENSUS")
    } finally {
      db.close()
    }

    // Verify loadState falls back to unscoped when no scoped state for current session
    const stateC = await loadState(testDir)
    expect(stateC.currentPhase).toBe("CONSENSUS") // from unscoped fallback
    closeStorage(testDir)
  })
})
