import { describe, expect, test, afterAll, afterEach } from "vitest"
import { createInitialState, PLUGIN_VERSION } from "../config.js"
import type { DiscussionPhase } from "../types.js"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { openDatabase } from "../db/driver.js"
import { loadState, saveState, getStatePath, closeStorage, getSessionId } from "../state.js"

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

  // Phase enum collapsed 8→4 (spec-4dcc492f, Decision 3). PAUSED/CANCELLED are no
  // longer phases — they live on the orthogonal `status` field (see transitions.ts).
  const VALID_PHASES: DiscussionPhase[] = [
    "PLANNING", "DISCUSSION", "SPECIFICATION", "EXECUTION",
  ]

  test("all phases are covered", () => {
    const transitions: Record<DiscussionPhase, DiscussionPhase[]> = {
      PLANNING: ["DISCUSSION"],
      DISCUSSION: ["SPECIFICATION", "PLANNING"],
      SPECIFICATION: ["EXECUTION", "DISCUSSION"],
      EXECUTION: ["PLANNING"],
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
    stateA.currentPhase = "DISCUSSION"
    await saveState(testDir, stateA)
    const sessionAId = getSessionId(testDir)
    expect(sessionAId).toBeDefined()

    closeStorage(testDir)

    // Session B: create and save with CONSENSUS phase
    const stateB = await loadState(testDir)
    stateB.currentPhase = "DISCUSSION"
    await saveState(testDir, stateB)
    const sessionBId = getSessionId(testDir)
    expect(sessionBId).toBeDefined()
    expect(sessionBId).not.toBe(sessionAId)

    closeStorage(testDir)

    // Verify both sessions persisted independently in scoped tables
    const dbPath = await getStatePath(testDir)
    const db = openDatabase(dbPath, { readonly: true })
    try {
      const rowA = db
        .query("SELECT current_phase FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
        .get(testDir, sessionAId) as { current_phase: string } | null
      expect(rowA?.current_phase).toBe("DISCUSSION")

      const rowB = db
        .query("SELECT current_phase FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
        .get(testDir, sessionBId) as { current_phase: string } | null
      expect(rowB?.current_phase).toBe("DISCUSSION")
    } finally {
      db.close()
    }

    // Regression guard for session-isolation fix (commit c18a0805):
    // dual-write to the unscoped mesa_state table was removed, so a new
    // session with no scoped state of its own (and no parent) must receive a
    // FRESH initial state rather than falling back to stale unscoped data.
    const stateC = await loadState(testDir)
    expect(stateC.currentPhase).toBe("PLANNING")
    closeStorage(testDir)
  })
})
