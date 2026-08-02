import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import {
  createBriefingTool,
  approveBriefingTool,
} from "../tools/briefing-tools.js"
import { openRoundTool, closeRoundTool } from "../tools/round-tools.js"
import { registerAnalysisTool } from "../tools/discussion-tools.js"
import { produceDeliverableTool } from "../tools/decision-tools.js"
import type { DiscussionState } from "../types.js"

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

/** State satisfying every open_round precondition. */
function readyState(participants: string[] = ["eng-1"]): DiscussionState {
  const state = createInitialState(TEST_DIR)
  state.briefing = { path: ".mesa/x/briefing.md", status: "approved", slug: "layout", metadata: null }
  state.plan = { path: ".mesa/x/workflow-plan.md", version: 1, status: "approved" }
  state.team = participants.map((id) => ({
    personaId: id,
    name: id,
    division: "test",
    status: "summoned" as const,
  }))
  return state
}

/** Run a full round: open → register all participants → close (override). */
async function runRound(participants: string[]): Promise<void> {
  await openRoundTool.execute({ topic: "Layout round", participants }, makeContext())
  for (const id of participants) {
    await registerAnalysisTool.execute(
      { agent_id: id, agent_name: id, content: `Analysis by ${id}`, turn: 1 },
      makeContext()
    )
  }
  await closeRoundTool.execute(
    {
      decision: "converged",
      summary: "done",
      tensions: [],
      evidencePaths: participants.map((id) => `.mesa/analyses/r1/${id}.md`),
      humanOverride: true,
    },
    makeContext()
  )
}

describe("session layout integration — kernel workflow", () => {
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

  test("approve preserves session folder path (single delivery step)", async () => {
    await createBriefingTool.execute(
      { slug: "deliver-layout", title: "Deliver", content: "# Content" },
      makeContext()
    )
    await approveBriefingTool.execute({}, makeContext())

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.status).toBe("approved")
    expect(state.briefing.path).toContain("sessions")
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
    await saveState(TEST_DIR, readyState(), "test-session")

    await openRoundTool.execute(
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

  test("deliverable lands in session folder with canonical name", async () => {
    await saveState(TEST_DIR, readyState(), "test-session")
    await runRound(["eng-1"])

    const result = await produceDeliverableTool.execute(
      { kind: "specification", topic: "Test", content: "## Spec\n\nContent." },
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

    // Registered in state with provenance
    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.deliverables).toHaveLength(1)
    expect(loaded.deliverables[0].status).toBe("draft")
    expect(loaded.deliverables[0].provenance.roundIds).toContain("r1")
  })

  test("overview deliverable lands in session folder with canonical name", async () => {
    await saveState(TEST_DIR, readyState(), "test-session")
    await runRound(["eng-1"])

    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Overview Test", content: "## Spec\n\nContent." },
      makeContext()
    )
    const result = await produceDeliverableTool.execute(
      { kind: "overview", topic: "Overview Test", content: "## Overview\n\nHuman-friendly summary." },
      makeContext()
    )

    const metadata = (result as { metadata?: { path: string } }).metadata
    expect(metadata?.path).toContain("sessions")
    expect(metadata?.path).toContain("overview.md")

    const overviewAbs = join(TEST_DIR, metadata!.path)
    const content = await fs.readFile(overviewAbs, "utf-8")
    expect(content).toContain("Overview: Overview Test")
  })

  test("all artifacts co-located in a single session folder", async () => {
    await saveState(TEST_DIR, readyState(), "test-session")
    await runRound(["eng-1"])

    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Co-located", content: "## Spec\n\nContent." },
      makeContext()
    )
    await produceDeliverableTool.execute(
      { kind: "overview", topic: "Co-located", content: "## Overview\n\nSummary." },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR, "test-session")
    const folder = loaded.sessionFolder!

    // All artifacts should be in the SAME session folder
    for (const d of loaded.deliverables) {
      expect(d.path).toContain(folder)
    }

    const filesInFolder = await listFiles(join(TEST_DIR, folder))
    expect(filesInFolder).toContain("specification.md")
    expect(filesInFolder).toContain("overview.md")
  })

  test("analysis files land in sessions/{folder}/analyses/turn1/", async () => {
    await saveState(TEST_DIR, readyState(["backend-arch"]), "test-session")
    await openRoundTool.execute(
      { topic: "T", participants: ["backend-arch"] },
      makeContext()
    )

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

  test("full kernel workflow: all artifacts in single session folder, no legacy pollution", async () => {
    // Step 1: Create + approve briefing (single delivery step)
    await createBriefingTool.execute(
      { slug: "full-flow", title: "Full Flow", content: "# Full Flow Briefing" },
      makeContext()
    )
    await approveBriefingTool.execute({}, makeContext())

    // Step 2: Plan approved (gate 0) + team, then run a round
    const state = await loadState(TEST_DIR, "test-session")
    state.plan = { path: `${state.sessionFolder}/workflow-plan.md`, version: 1, status: "approved" }
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")
    await runRound(["a"])

    // Step 3: Produce deliverables
    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Full Flow", content: "## Spec\n\nFull flow spec." },
      makeContext()
    )
    await produceDeliverableTool.execute(
      { kind: "overview", topic: "Full Flow", content: "## Overview\n\nFull flow overview." },
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
