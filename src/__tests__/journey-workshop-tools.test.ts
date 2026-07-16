import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import {
  detectUserJourneysTool,
  configureJourneyWorkshopTool,
  openJourneyWorkshopRoundTool,
  completeJourneyWorkshopTool,
} from "../tools/journey-workshop-tools.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "journey-workshop-tools")

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

async function setupBriefing(filename: string, content: string): Promise<string> {
  const briefingDir = join(TEST_DIR, ".mesa", "sessions", "202607161200_1234_test", "briefing.md")
  await fs.mkdir(join(briefingDir, ".."), { recursive: true })
  await fs.writeFile(briefingDir, content, "utf-8")
  return ".mesa/sessions/202607161200_1234_test/briefing.md"
}

describe("complete_journey_workshop tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("transitions DISCUSSION to PLANNING after completing workshop", async () => {
    const briefingPath = await setupBriefing(
      "briefing.md",
      "# Personal Finance AI\n\nBuild a finance app."
    )

    const journeysPath = join(TEST_DIR, ".mesa", "sessions", "202607161200_1234_test", "journeys.md")
    await fs.writeFile(journeysPath, "## User Journey\n\nUser logs in.", "utf-8")

    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.briefing.path = briefingPath
    state.briefing.status = "approved"
    state.briefing.slug = "personal-finance-ai"
    state.journeyWorkshop.status = "in_progress"
    state.sessionFolder = ".mesa/sessions/202607161200_1234_test"
    await saveState(TEST_DIR, state, "test-session")

    const result = await completeJourneyWorkshopTool.execute(
      { journeys_file_path: ".mesa/sessions/202607161200_1234_test/journeys.md" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Journey Workshop Completed")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("PLANNING")
    expect(loaded.journeyWorkshop.status).toBe("completed")

    const enrichedBriefing = await fs.readFile(join(TEST_DIR, briefingPath), "utf-8")
    expect(enrichedBriefing).toContain("# User Journeys (defined in design-thinking workshop)")
    expect(enrichedBriefing).toContain("User logs in")
  })

  test("keeps PLANNING phase when already in PLANNING", async () => {
    const briefingPath = await setupBriefing("briefing.md", "# Test\n\nContent.")
    const journeysPath = join(TEST_DIR, ".mesa", "sessions", "202607161200_1234_test", "journeys.md")
    await fs.writeFile(journeysPath, "## Journey", "utf-8")

    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.path = briefingPath
    state.briefing.status = "approved"
    state.briefing.slug = "test"
    state.journeyWorkshop.status = "in_progress"
    state.sessionFolder = ".mesa/sessions/202607161200_1234_test"
    await saveState(TEST_DIR, state, "test-session")

    const result = await completeJourneyWorkshopTool.execute(
      { journeys_file_path: ".mesa/sessions/202607161200_1234_test/journeys.md" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Journey Workshop Completed")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("PLANNING")
  })
})

describe("open_journey_workshop_round tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("includes propose_team and summon_team instructions in output", async () => {
    const briefingPath = await setupBriefing(
      "briefing.md",
      "# App\n\nJourney: user onboarding flow with categories and tags."
    )

    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.path = briefingPath
    state.briefing.status = "approved"
    state.briefing.slug = "app"
    state.journeyWorkshop.status = "needed"
    state.sessionFolder = ".mesa/sessions/202607161200_1234_test"
    await saveState(TEST_DIR, state, "test-session")

    const result = await openJourneyWorkshopRoundTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Journey Workshop Round Ready")
    const output = (result as { output: string }).output
    expect(output).toContain("propose_team")
    expect(output).toContain("summon_team")
    expect(output).toContain("open_analysis_round")
  })

  test("workshop briefing references original briefing by path, not truncated content", async () => {
    const longContent = "# App\n\n" + "Journey: user onboarding flow with categories and tags. ".repeat(100)
    const briefingPath = await setupBriefing("briefing.md", longContent)

    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.briefing.path = briefingPath
    state.briefing.status = "approved"
    state.briefing.slug = "app"
    state.journeyWorkshop.status = "needed"
    state.sessionFolder = ".mesa/sessions/202607161200_1234_test"
    await saveState(TEST_DIR, state, "test-session")

    const result = await openJourneyWorkshopRoundTool.execute({}, makeContext())
    const relativePath = (result as { metadata?: { workshopBriefingPath: string } }).metadata?.workshopBriefingPath
    expect(relativePath).toBeDefined()

    const workshopContent = await fs.readFile(join(TEST_DIR, relativePath!), "utf-8")
    expect(workshopContent).toContain("Read the full approved briefing at:")
    expect(workshopContent).toContain(briefingPath)
    expect(workshopContent).not.toContain(longContent.slice(0, 4000))
  })
})
