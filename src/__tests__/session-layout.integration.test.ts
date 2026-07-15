import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import {
  createBriefingTool,
  approveBriefingTool,
  deliverBriefingTool,
} from "../tools/briefing-tools.js"
import {
  openAnalysisRoundTool,
  registerAnalysisTool,
  generateSpecificationTool,
  generateSpecificationOverviewTool,
} from "../tools/discussion-tools.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "session-layout")

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

/**
 * Recursively list all files under a directory, returning paths relative
 * to that directory.
 */
async function listFiles(dir: string, base: string = dir): Promise<string[]> {
  let results: string[] = []
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results = results.concat(await listFiles(fullPath, base))
    } else {
      results.push(fullPath.slice(base.length + 1))
    }
  }
  return results
}

describe("session layout integration — full workflow", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("briefing lands in sessions/{folder}/briefing.md", async () => {
    await createBriefingTool.execute(
      { slug: "layout-test", title: "Layout Test", content: "# Briefing\n\nContent." },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.path).not.toBeNull()
    expect(state.briefing.path).toContain("sessions")
    expect(state.briefing.path).toContain("layout-test")
    expect(state.briefing.path!.endsWith("briefing.md")).toBe(true)

    // Verify the file exists at the stored relative path
    const absPath = join(TEST_DIR, state.briefing.path!)
    const content = await fs.readFile(absPath, "utf-8")
    expect(content).toContain("# Briefing")

    // Verify state.sessionFolder is set
    expect(state.sessionFolder).not.toBeNull()
    expect(state.sessionFolder).toContain("sessions")
  })

  test("approve and deliver preserve session folder path", async () => {
    await createBriefingTool.execute(
      { slug: "deliver-layout", title: "Deliver", content: "# Content" },
      makeContext()
    )
    await approveBriefingTool.execute({}, makeContext())
    await deliverBriefingTool.execute({}, makeContext())

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.status).toBe("delivered")
    expect(state.briefing.path).toContain("sessions")
    expect(state.currentPhase).toBe("PLANNING")
  })

  test("no legacy artifacts at .mesa root or legacy dirs after briefing", async () => {
    await createBriefingTool.execute(
      { slug: "clean-layout", title: "Clean", content: "# Content" },
      makeContext()
    )

    // There should be NO briefing-current-*.md at the .mesa root (M4)
    const mesaEntries = await fs.readdir(join(TEST_DIR, ".mesa"))
    const rootFiles = mesaEntries.filter((f) => f.endsWith(".md"))
    expect(rootFiles.length).toBe(0)

    // There should be NO .mesa/briefings/ directory
    const briefingsExists = await fs
      .access(join(TEST_DIR, ".mesa", "briefings"))
      .then(() => true).catch(() => false)
    expect(briefingsExists).toBe(false)

    // There should be NO .mesa/specifications/ directory
    const specsExists = await fs
      .access(join(TEST_DIR, ".mesa", "specifications"))
      .then(() => true).catch(() => false)
    expect(specsExists).toBe(false)
  })

  test("briefing-for-discussion lands in session folder (not root)", async () => {
    const { createInitialState } = await import("../config.js")
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "PLANNING"
    state.team = [
      { personaId: "eng-1", name: "Engineer", division: "engineering", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    await openAnalysisRoundTool.execute(
      {
        topic: "Test Topic",
        participants: ["eng-1"],
        briefing_content: "## Briefing for analysis",
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.sessionFolder).not.toBeNull()

    // The briefing-for-discussion file should be inside the session folder
    const bfdPath = join(TEST_DIR, loaded.sessionFolder!, "briefing-for-discussion.md")
    const content = await fs.readFile(bfdPath, "utf-8")
    expect(content).toBe("## Briefing for analysis")

    // It should NOT be at the .mesa root
    const mesaEntries = await fs.readdir(join(TEST_DIR, ".mesa"))
    const rootBfdFiles = mesaEntries.filter((f) => f.startsWith("briefing-for-discussion"))
    expect(rootBfdFiles.length).toBe(0)
  })

  test("specification lands in session folder with fixed name", async () => {
    const { createInitialState } = await import("../config.js")
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.consensusRound = 1
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "ok", round: 1 },
    ]
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    state.discussion.analyses = [
      { agentId: "a", agentName: "Alice", content: "Analysis", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state, "test-session")

    const result = await generateSpecificationTool.execute(
      { content: "## Spec\n\nContent.", topic: "Test" },
      makeContext()
    )

    const metadata = (result as { metadata?: { path: string } }).metadata
    expect(metadata?.path).toContain("sessions")
    expect(metadata?.path).toContain("specification.md")
    // NOT the old spec-{random}.md pattern
    expect(metadata?.path).not.toMatch(/spec-[a-f0-9]+\.md$/)

    // Verify the file exists
    const specAbs = join(TEST_DIR, metadata!.path)
    const content = await fs.readFile(specAbs, "utf-8")
    expect(content).toContain("Specification: Test")
  })

  test("overview lands in session folder with fixed name", async () => {
    const { createInitialState } = await import("../config.js")
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.consensusRound = 1
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "ok", round: 1 },
    ]
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    await generateSpecificationTool.execute(
      { content: "## Spec\n\nContent.", topic: "Overview Test" },
      makeContext()
    )

    const result = await generateSpecificationOverviewTool.execute(
      { content: "## Overview\n\nHuman-friendly summary.", topic: "Overview Test" },
      makeContext()
    )

    const metadata = (result as { metadata?: { overviewPath: string } }).metadata
    expect(metadata?.overviewPath).toContain("sessions")
    expect(metadata?.overviewPath).toContain("overview.md")

    // Verify the file exists
    const overviewAbs = join(TEST_DIR, metadata!.overviewPath)
    const content = await fs.readFile(overviewAbs, "utf-8")
    expect(content).toContain("Overview: Overview Test")
  })

  test("all artifacts co-located in a single session folder", async () => {
    const { createInitialState } = await import("../config.js")
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.consensusRound = 1
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "ok", round: 1 },
    ]
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    state.discussion.analyses = [
      { agentId: "a", agentName: "Alice", content: "Analysis content", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state, "test-session")

    // Generate spec + overview
    await generateSpecificationTool.execute(
      { content: "## Spec\n\nContent.", topic: "Co-located" },
      makeContext()
    )
    await generateSpecificationOverviewTool.execute(
      { content: "## Overview\n\nSummary.", topic: "Co-located" },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.sessionFolder).not.toBeNull()
    const folder = loaded.sessionFolder!

    // All three artifacts should be in the SAME session folder
    expect(loaded.specification.path).toContain(folder)
    expect(loaded.specification.overviewPath).toContain(folder)

    // Verify the files exist in the folder
    const filesInFolder = await listFiles(join(TEST_DIR, folder))
    expect(filesInFolder).toContain("specification.md")
    expect(filesInFolder).toContain("overview.md")
  })

  test("analysis files land in sessions/{folder}/analyses/turn1/", async () => {
    const { createInitialState } = await import("../config.js")
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.currentTurn = 1
    state.team = [
      { personaId: "backend-arch", name: "Backend", division: "eng", status: "summoned" },
    ]
    state.discussion.participants = ["backend-arch"]
    await saveState(TEST_DIR, state, "test-session")

    await registerAnalysisTool.execute(
      {
        agent_id: "backend-arch",
        agent_name: "Backend Architect",
        content: "My analysis",
        turn: 1,
      },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.sessionFolder).not.toBeNull()

    // The analysis file path should be in the session folder
    const analyses = loaded.discussion.analyses
    expect(analyses.length).toBe(1)

    const filePath = analyses[0].filePath
    expect(filePath).not.toBeNull()
    expect(filePath).toContain("sessions")
    expect(filePath).toContain("analyses")
    expect(filePath).toContain("turn1")
    expect(filePath).toContain("backend-arch.md")

    // Verify the file exists
    const abs = join(TEST_DIR, filePath!)
    const content = await fs.readFile(abs, "utf-8")
    expect(content).toContain("My analysis")
  })

  test("full workflow: all artifacts in single session folder, no legacy pollution", async () => {
    // Step 1: Create briefing
    await createBriefingTool.execute(
      { slug: "full-flow", title: "Full Flow", content: "# Full Flow Briefing" },
      makeContext()
    )

    // Step 2: Approve + deliver
    await approveBriefingTool.execute({}, makeContext())
    await deliverBriefingTool.execute({}, makeContext())

    // Step 3: Set up DISCUSSION phase for analysis + spec generation
    const state1 = await loadState(TEST_DIR, "test-session")
    state1.currentPhase = "DISCUSSION"
    state1.discussion.consensusRound = 1
    state1.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "ok", round: 1 },
    ]
    state1.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    state1.discussion.analyses = [
      { agentId: "a", agentName: "Alice", content: "Good analysis", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state1, "test-session")

    // Step 4: Generate specification
    await generateSpecificationTool.execute(
      { content: "## Spec\n\nFull flow spec.", topic: "Full Flow" },
      makeContext()
    )

    // Step 5: Generate overview
    await generateSpecificationOverviewTool.execute(
      { content: "## Overview\n\nFull flow overview.", topic: "Full Flow" },
      makeContext()
    )

    // Final verification: all artifacts co-located, no legacy pollution
    const final = await loadState(TEST_DIR, "test-session")
    const folder = final.sessionFolder!
    // Strip the .mesa/ prefix since allFiles is relative to .mesa/
    const folderRel = folder.replace(/^\.mesa\//, "")

    // List all files under .mesa/
    const allFiles = await listFiles(join(TEST_DIR, ".mesa"))

    // Every artifact file should be under sessions/{folder}/
    const artifactFiles = allFiles.filter((f) => f.endsWith(".md"))
    for (const f of artifactFiles) {
      expect(f.startsWith(folderRel) || f.startsWith("_archive")).toBe(true)
    }

    // No legacy directory structures
    expect(allFiles.some((f) => f.startsWith("briefings/"))).toBe(false)
    expect(allFiles.some((f) => f.startsWith("specifications/spec-"))).toBe(false)

    // The session folder contains all key artifacts
    const sessionFiles = await listFiles(join(TEST_DIR, folder))
    expect(sessionFiles).toContain("briefing.md")
    expect(sessionFiles).toContain("specification.md")
    expect(sessionFiles).toContain("overview.md")
  })
})
