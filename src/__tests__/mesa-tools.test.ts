import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { saveState } from "../state"
import { createInitialState, PLUGIN_VERSION } from "../config"
import { mesaStatusTool } from "../tools/mesa-tools"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "mesa-tools")

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

describe("mesa_status tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("returns status with version, phase, briefing, team for valid state", async () => {
    const state = createInitialState(TEST_DIR)
    state.team = [
      { personaId: "test-agent", name: "Test", division: "test", status: "summoned" },
    ]
    state.discussion.analyses = [
      { agentId: "a", agentName: "A", content: "c", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    const result = await mesaStatusTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Mesa Status")
    const output = (result as { output: string }).output
    expect(output).toContain(`v${PLUGIN_VERSION}`)
    expect(output).toContain("PLANNING")
    expect(output).toContain("Team: 1 specialists")
    expect(output).toContain("Analyses: 1")

    const metadata = (result as { metadata: Record<string, unknown> }).metadata
    expect(metadata.version).toBe(PLUGIN_VERSION)
    expect(metadata.teamSize).toBe(1)
    expect(metadata.analysesCount).toBe(1)
  })

  test("handles missing state file gracefully (creates initial state)", async () => {
    const stateDir = join(TEST_DIR, ".mesa")
    await fs.rm(stateDir, { recursive: true, force: true })
    await fs.mkdir(stateDir, { recursive: true })

    const result = await mesaStatusTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Mesa Status")
    const output = (result as { output: string }).output
    expect(output).toContain(`v${PLUGIN_VERSION}`)
    expect(output).toContain("PLANNING")
    expect(output).toContain("Team: 0 specialists")
  })

  test("returns correct vote count after consensus", async () => {
    const state = createInitialState(TEST_DIR)
    state.discussion.votes = [
      { agentId: "a", agentName: "A", vote: 1, reason: "ok", round: 1 },
      { agentId: "b", agentName: "B", vote: 0, reason: "no", round: 1 },
    ]
    await saveState(TEST_DIR, state)

    const result = await mesaStatusTool.execute({}, makeContext())
    const output = (result as { output: string }).output
    expect(output).toContain("Votes: 2")
  })
})
