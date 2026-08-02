import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import { proposeTeamTool, summonTeamTool } from "../tools/manager-tools.js"
import type { DiscussionState } from "../types.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "manager-tools")

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

function seedWithApprovedBriefing(mutate?: (s: DiscussionState) => void): DiscussionState {
  const state = createInitialState(TEST_DIR)
  state.briefing.status = "approved"
  if (mutate) mutate(state)
  return state
}

describe("propose_team tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("proposes valid specialists against an approved briefing", async () => {
    await saveState(TEST_DIR, seedWithApprovedBriefing(), "test-session")

    const result = await proposeTeamTool.execute(
      {
        specialists: [
          {
            personaId: "software-development-backend-architect",
            name: "Backend Architect",
            division: "software-development",
            justification: "Need architecture review",
          },
        ],
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Team Proposal — Awaiting Human Approval")
    const output = (result as { output: string }).output
    expect(output).toContain("Backend Architect")
    expect(output).toContain("Need architecture review")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.team.length).toBe(1)
    expect(loaded.team[0].status).toBe("proposed")
    expect(loaded.team[0].personaId).toBe("software-development-backend-architect")
  })

  test("returns error for invalid persona ID", async () => {
    await saveState(TEST_DIR, seedWithApprovedBriefing(), "test-session")

    const result = await proposeTeamTool.execute(
      {
        specialists: [
          {
            personaId: "nonexistent-persona-12345",
            name: "Ghost",
            division: "void",
            justification: "testing",
          },
        ],
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("nonexistent-persona-12345")
  })

  test("requires an approved briefing (data precondition, not phase)", async () => {
    const state = createInitialState(TEST_DIR) // briefing: draft
    await saveState(TEST_DIR, state, "test-session")

    const result = await proposeTeamTool.execute(
      {
        specialists: [
          {
            personaId: "engineering-backend-architect",
            name: "Backend Architect",
            division: "engineering",
            justification: "test",
          },
        ],
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("approved briefing")
    expect(result).toContain("approve_briefing")
  })
})

describe("summon_team tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("successfully summons proposed team", async () => {
    const state = seedWithApprovedBriefing((s) => {
      s.team = [
        { personaId: "eng-1", name: "Eng One", division: "engineering", status: "proposed" },
        { personaId: "prod-1", name: "Prod One", division: "product", status: "proposed" },
      ]
    })
    await saveState(TEST_DIR, state, "test-session")

    const result = await summonTeamTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Team Summoned")
    const output = (result as { output: string }).output
    expect(output).toContain("2 specialists summoned")
    expect(output).toContain("Eng One")
    expect(output).toContain("Prod One")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.team.every((t) => t.status === "summoned")).toBe(true)
  })

  test("returns error when no proposed team exists", async () => {
    await saveState(TEST_DIR, seedWithApprovedBriefing(), "test-session")

    const result = await summonTeamTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("No proposed specialists found")
  })

  test("requires an approved briefing", async () => {
    const state = createInitialState(TEST_DIR)
    state.team = [
      { personaId: "eng-1", name: "Eng", division: "engineering", status: "proposed" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    const result = await summonTeamTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("approved briefing")
  })
})
