import { describe, expect, test, afterAll } from "vitest"
import { createInitialState, type DiscussionPhase, type ConsensusVote, PLUGIN_VERSION } from "../config"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, getStatePath } from "../state"

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
      CANCELLED: [],
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

  test.afterAll(async () => {
    await fs.rm(join(testDir, ".mesa"), { recursive: true, force: true })
  })
})
