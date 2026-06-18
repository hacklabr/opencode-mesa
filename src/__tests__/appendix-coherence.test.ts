import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import { generatePhaseAppendixTool, openPhaseAnalysisRoundTool } from "../tools/phase-analysis-tools.js"
import { SqliteStateRepository } from "../repositories/sqlite-state-repository.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "appendix-coherence")

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

async function setupExecutionState() {
  const state = await loadState(TEST_DIR, "test-session")
  state.currentPhase = "EXECUTION"
  state.specification.path = join(TEST_DIR, ".mesa", "specifications", "spec-master.md")
  state.specification.status = "approved"
  await saveState(TEST_DIR, state, "test-session")
  return state
}

async function generateAppendix(phaseName: string, phaseIndex: number) {
  // Phase analysis round must be opened before generating appendix
  await openPhaseAnalysisRoundTool.execute(
    {
      phase_index: phaseIndex,
      phase_name: phaseName,
      mode: "auto",
      specialists: ["test-specialist"],
    },
    makeContext()
  )

  const result = await generatePhaseAppendixTool.execute(
    {
      phase_index: phaseIndex,
      phase_name: phaseName,
      phase_scope: `Scope for ${phaseName}`,
      specialist_analyses_summary: "Summary",
      consensus_outcome: "Agreed",
      technical_decisions: "Decision",
      revised_execution_plan: "Plan",
      delta_from_master: "Delta",
      mode: "auto",
      specialists: ["test-specialist"],
    },
    makeContext()
  )
  return result
}

describe("appendix coherence", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa", "specifications", "appendices"), { recursive: true })
    await fs.mkdir(join(TEST_DIR, ".mesa", "briefings"), { recursive: true })
    await fs.writeFile(
      join(TEST_DIR, ".mesa", "specifications", "spec-master.md"),
      "# Master Spec\n\nContent",
      "utf-8"
    )
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  describe("orphan detection", () => {
    test("detects appendix files not referenced in state", async () => {
      await setupExecutionState()

      // Create an appendix file directly without updating state
      const orphanPath = join(
        TEST_DIR,
        ".mesa",
        "specifications",
        "appendices",
        "appendix-master-orphan-12345678.md"
      )
      await fs.writeFile(
        orphanPath,
        "---\nmaster_spec: \"spec-master.md\"\n---\n\n# Orphan Appendix",
        "utf-8"
      )

      const state = await loadState(TEST_DIR, "test-session")
      const appendicesDir = join(TEST_DIR, ".mesa", "specifications", "appendices")

      // List all appendix files
      const files = await fs.readdir(appendicesDir)
      const appendixFiles = files.filter((f) => f.startsWith("appendix-") && f.endsWith(".md"))

      // Find orphans: files not referenced in state.appendices
      const referencedBasenames = new Set(state.appendices.map((a) => a.split("/").pop()))
      const orphans = appendixFiles.filter(
        (f) => !referencedBasenames.has(f)
      )

      expect(orphans).toHaveLength(1)
      expect(orphans[0]).toContain("orphan")
    })

    test("no orphans when all files are referenced", async () => {
      await setupExecutionState()
      await generateAppendix("Backend", 1)

      const state = await loadState(TEST_DIR, "test-session")
      const appendicesDir = join(TEST_DIR, ".mesa", "specifications", "appendices")
      const files = await fs.readdir(appendicesDir)
      const appendixFiles = files.filter((f) => f.startsWith("appendix-") && f.endsWith(".md"))

      const referencedBasenames = new Set(state.appendices.map((a) => a.split("/").pop()))
      const orphans = appendixFiles.filter(
        (f) => !referencedBasenames.has(f)
      )

      expect(orphans).toHaveLength(0)
    })
  })

  describe("bidirectional links", () => {
    test("state references appendix and appendix references master spec", async () => {
      await setupExecutionState()
      const result = await generateAppendix("Frontend", 1)

      const state = await loadState(TEST_DIR, "test-session")
      expect(state.appendices.length).toBeGreaterThan(0)

      // Verify state references the appendix
      const appendixRef = state.appendices[0]
      expect(appendixRef).toBeDefined()

      // Verify appendix file exists
      const appendixPath = join(TEST_DIR, ".mesa", "specifications", "appendices", appendixRef.split("/").pop()!)
      const content = await fs.readFile(appendixPath, "utf-8")

      // Verify appendix references the master spec (bidirectional link)
      expect(content).toContain("master_spec:")
      expect(content).toContain("spec-master.md")

      // Verify appendix has phase metadata linking back
      expect(content).toContain("phase_slug:")
      expect(content).toContain("frontend")
      expect(content).toContain("phase_index: 1")
    })

    test("phase context links to appendix and vice versa", async () => {
      await setupExecutionState()

      // Generate appendix
      const result = await generateAppendix("Database", 1)
      const metadata = (result as { metadata?: Record<string, unknown> }).metadata
      const appendixPath = metadata?.appendixPath as string
      const appendixId = metadata?.appendixId as string

      // Load phase context from SQLite
      const sessionId = (await import("../state.js")).getSessionId(TEST_DIR, "test-session")
      if (sessionId) {
        const repo = new SqliteStateRepository(TEST_DIR)
        const contextRecord = await repo.getPhaseContext(TEST_DIR, sessionId, "phase-1-database")
        expect(contextRecord).not.toBeNull()

        // Verify context links to appendix
        const ctx = contextRecord!.context as Record<string, unknown>
        expect(ctx.appendixPath).toBe(appendixPath)
        expect(ctx.appendixId).toBe(appendixId)
        expect(ctx.status).toBe("approved")

        // Verify appendix file links back to state via master_spec
        const content = await fs.readFile(appendixPath, "utf-8")
        expect(content).toContain("master_spec:")

        repo.close()
      }
    })
  })

  describe("immutability", () => {
    test("modifying loaded state appendices does not affect stored state until save", async () => {
      await setupExecutionState()
      await generateAppendix("API Design", 1)

      // Load state and mutate appendices
      const state1 = await loadState(TEST_DIR, "test-session")
      const originalLength = state1.appendices.length
      expect(originalLength).toBeGreaterThan(0)

      state1.appendices.push("fake-appendix.md")

      // Reload without saving - should not have the fake appendix
      const state2 = await loadState(TEST_DIR, "test-session")
      expect(state2.appendices).toHaveLength(originalLength)
      expect(state2.appendices).not.toContain("fake-appendix.md")

      // Now save the mutated state
      await saveState(TEST_DIR, state1, "test-session")

      // Reload - should now have the fake appendix
      const state3 = await loadState(TEST_DIR, "test-session")
      expect(state3.appendices).toContain("fake-appendix.md")
    })

    test("appendix files are atomically written and not corrupted", async () => {
      await setupExecutionState()

      const result = await generateAppendix("Auth Layer", 1)
      const metadata = (result as { metadata?: Record<string, unknown> }).metadata
      const appendixPath = metadata?.appendixPath as string

      // Verify no temp file remains
      const tempPath = `${appendixPath}.tmp`
      const tempExists = await fs
        .access(tempPath)
        .then(() => true)
        .catch(() => false)
      expect(tempExists).toBe(false)

      // Verify file is complete and valid
      const content = await fs.readFile(appendixPath, "utf-8")
      expect(content).toContain("---")
      expect(content).toContain("status: \"approved\"")
      expect(content).toContain("Override Rule:")
    })

    test("regenerating appendix for same phase creates new entry without duplicates", async () => {
      await setupExecutionState()

      // Generate first appendix
      await generateAppendix("Core Module", 1)
      const state1 = await loadState(TEST_DIR, "test-session")
      const count1 = state1.appendices.length

      // Generate second appendix for same phase
      await generateAppendix("Core Module", 1)
      const state2 = await loadState(TEST_DIR, "test-session")
      const count2 = state2.appendices.length

      // Should have 2 entries (different appendix files)
      expect(count2).toBe(count1 + 1)

      // Each reference should be unique
      const uniqueAppendices = new Set(state2.appendices)
      expect(uniqueAppendices.size).toBe(state2.appendices.length)
    })
  })
})
