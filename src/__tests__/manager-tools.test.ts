import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state"
import { createInitialState } from "../config"
import {
  analyzeBriefingTool,
  proposeTeamTool,
  summonTeamTool,
  delegateTaskTool,
  definePhasesTool,
} from "../tools/manager-tools"

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

describe("analyze_briefing tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("returns briefing content with valid briefing in PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.path = join(TEST_DIR, ".mesa", "briefings", "test.md")
    state.briefing.slug = "test"
    state.briefing.status = "approved"
    await fs.mkdir(join(TEST_DIR, ".mesa", "briefings"), { recursive: true })
    await fs.writeFile(state.briefing.path, "# Test Briefing\n\nContent here.", "utf-8")
    await saveState(TEST_DIR, state)

    const result = await analyzeBriefingTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Briefing Analysis")
    const output = (result as { output: string }).output
    expect(output).toContain("Test Briefing")
    expect(output).toContain("Content here.")
  })

  test("returns error when no briefing found", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.path = null
    await saveState(TEST_DIR, state)

    const result = await analyzeBriefingTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("No briefing found")
  })

  test("returns error when not in PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state)

    const result = await analyzeBriefingTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("DISCUSSION")
  })
})

describe("propose_team tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("proposes valid specialists in PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await proposeTeamTool.execute(
      {
        specialists: [
          {
            personaId: "engineering-backend-architect",
            name: "Backend Architect",
            division: "engineering",
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

    const loaded = await loadState(TEST_DIR)
    expect(loaded.team.length).toBe(1)
    expect(loaded.team[0].status).toBe("proposed")
    expect(loaded.team[0].personaId).toBe("engineering-backend-architect")
  })

  test("returns error for invalid persona ID", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

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

  test("returns error when not in PLANNING phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    await saveState(TEST_DIR, state)

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
    expect(result).toContain("DISCUSSION")
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
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.status = "delivered"
    state.team = [
      { personaId: "eng-1", name: "Eng One", division: "engineering", status: "proposed" },
      { personaId: "prod-1", name: "Prod One", division: "product", status: "proposed" },
    ]
    await saveState(TEST_DIR, state)

    const result = await summonTeamTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Team Summoned")
    const output = (result as { output: string }).output
    expect(output).toContain("2 specialists summoned")
    expect(output).toContain("Eng One")
    expect(output).toContain("Prod One")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.team.every((t) => t.status === "summoned")).toBe(true)
  })

  test("returns error when no proposed team exists", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.status = "delivered"
    state.team = []
    await saveState(TEST_DIR, state)

    const result = await summonTeamTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("No proposed specialists found")
  })

  test("returns error when briefing not approved or delivered", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.status = "draft"
    state.team = [
      { personaId: "eng-1", name: "Eng", division: "engineering", status: "proposed" },
    ]
    await saveState(TEST_DIR, state)

    const result = await summonTeamTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("approved or delivered")
  })
})

describe("delegate_task tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("delegates task to specialist in team during EXECUTION phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "EXECUTION"
    state.team = [
      { personaId: "engineering-backend-architect", name: "Backend Architect", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state)

    const result = await delegateTaskTool.execute(
      {
        personaId: "engineering-backend-architect",
        task: "Review the database schema",
        context_info: "See docs/schema.md",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title")
    expect((result as { title: string }).title).toContain("Backend Architect")
    const output = (result as { output: string }).output
    expect(output).toContain("Review the database schema")
    expect(output).toContain("docs/schema.md")
  })

  test("adds specialist from catalog if not in team (catalog fallback)", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "EXECUTION"
    state.team = []
    await saveState(TEST_DIR, state)

    const result = await delegateTaskTool.execute(
      {
        personaId: "engineering-backend-architect",
        task: "Do something",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title")
    const output = (result as { output: string }).output
    expect(output).toContain("Do something")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.team.length).toBe(1)
    expect(loaded.team[0].personaId).toBe("engineering-backend-architect")
    expect(loaded.team[0].status).toBe("delegated")
  })

  test("returns error for non-existent specialist not in catalog", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "EXECUTION"
    state.team = []
    await saveState(TEST_DIR, state)

    const result = await delegateTaskTool.execute(
      {
        personaId: "totally-nonexistent-specialist-xyz",
        task: "Do something",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("not found")
  })

  test("returns error when not in EXECUTION phase", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)

    const result = await delegateTaskTool.execute(
      { personaId: "eng-1", task: "task" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("not allowed in PLANNING")
  })
})

describe("define_phases tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("defines valid phases", async () => {
    const state = createInitialState(TEST_DIR)
    await saveState(TEST_DIR, state)

    const result = await definePhasesTool.execute(
      { phases: ["PLANNING", "DISCUSSION", "DISCUSSION"] },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Workflow Phases Defined")
    const output = (result as { output: string }).output
    expect(output).toContain("PLANNING → ANALYSIS → CONSENSUS")

    const loaded = await loadState(TEST_DIR)
    expect(loaded.phases).toEqual(["PLANNING", "DISCUSSION", "DISCUSSION"])
  })

  test("returns error for invalid phase names", async () => {
    const state = createInitialState(TEST_DIR)
    await saveState(TEST_DIR, state)

    const result = await definePhasesTool.execute(
      { phases: ["PLANNING", "INVALID_PHASE", "ANOTHER_BAD"] },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("INVALID_PHASE")
    expect(result).toContain("ANOTHER_BAD")
  })

  test("accepts all six valid active phases", async () => {
    const state = createInitialState(TEST_DIR)
    await saveState(TEST_DIR, state)

    const result = await definePhasesTool.execute(
      { phases: ["PLANNING", "DISCUSSION", "DISCUSSION", "SPECIFICATION", "SPECIFICATION", "EXECUTION"] },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Workflow Phases Defined")
  })
})
