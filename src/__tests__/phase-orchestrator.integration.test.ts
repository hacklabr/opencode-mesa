import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import {
  checkExecutionPhasesTool,
  selectPhasesForAnalysisTool,
  configurePhaseObservationTool,
} from "../tools/manager-tools.js"
import {
  detectPhasesTool,
  openPhaseAnalysisRoundTool,
  generatePhaseAppendixTool,
} from "../tools/phase-analysis-tools.js"
import { SqliteStateRepository } from "../repositories/sqlite-state-repository.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "phase-orchestrator")

function make_human_context(responses: string[] = []) {
  let index = 0
  return {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "test",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async (_input?: unknown) => {
      const response = responses[index++]
      if (response === undefined) {
        throw new Error(`No more mock responses available (asked for ${index}th response)`)
      }
      // Return response cast to void to satisfy ToolContext type
      return response as unknown as void
    },
  }
}

async function setupApprovedSpec(content: string, fileName = "spec-test.md") {
  const specsDir = join(TEST_DIR, ".mesa", "specifications")
  await fs.mkdir(specsDir, { recursive: true })
  const specPath = join(specsDir, fileName)
  await fs.writeFile(specPath, content, "utf-8")

  const state = await loadState(TEST_DIR, "test-session")
  state.currentPhase = "EXECUTION"
  state.specification.path = specPath
  state.specification.status = "approved"
  await saveState(TEST_DIR, state, "test-session")
  return specPath
}

describe("phase orchestrator integration", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  describe("direct implementation path (bypass phase analysis)", () => {
    test("check_execution_phases detects phases and select_phases with 'none' skips analysis", async () => {
      await setupApprovedSpec(`# Specification

## Execution Plan

1. Setup
2. Build
3. Deploy
`)

      const checkResult = await checkExecutionPhasesTool.execute({}, make_human_context())
      expect(checkResult).toHaveProperty("title", "Execution Plan Detected")
      const checkOutput = (checkResult as { output: string }).output
      expect(checkOutput).toContain("3 phase(s)")

      const selectResult = await selectPhasesForAnalysisTool.execute(
        { selection: "none", phase_count: 3 },
        make_human_context()
      )
      expect(selectResult).toHaveProperty("title", "Phase Analysis Skipped")
      const selectOutput = (selectResult as { output: string }).output
      expect(selectOutput).toContain("No phases selected")
    })
  })

  describe("all phases automatic", () => {
    test("selects all phases and configures automatic mode", async () => {
      await setupApprovedSpec(`# Specification

## Execution Plan

1. Planning
2. Development
3. Testing
`)

      const checkResult = await checkExecutionPhasesTool.execute({}, make_human_context())
      expect(checkResult).toHaveProperty("title", "Execution Plan Detected")

      const selectResult = await selectPhasesForAnalysisTool.execute(
        { selection: "all", phase_count: 3 },
        make_human_context()
      )
      expect(selectResult).toHaveProperty("title", "Phases Selected")
      const selectOutput = (selectResult as { output: string }).output
      expect(selectOutput).toContain("3 phase(s)")

      const configResult = await configurePhaseObservationTool.execute(
        {
          mode: "automatic",
          phase_name: "Planning",
          master_spec_context: "Plan the project architecture",
        },
        make_human_context()
      )
      expect(configResult).toHaveProperty("title", "Automatic Mode Configured")
      const configOutput = (configResult as { output: string }).output
      expect(configOutput).toContain("Automatic")
      expect(configOutput).toContain("Planning")
    })
  })

  describe("partial selection with observations", () => {
    test("selects subset of phases and configures guided mode with observations", async () => {
      await setupApprovedSpec(`# Specification

## Execution Plan

1. Setup
2. Build
3. Test
4. Deploy
`)

      const checkResult = await checkExecutionPhasesTool.execute({}, make_human_context())
      expect(checkResult).toHaveProperty("title", "Execution Plan Detected")

      const selectResult = await selectPhasesForAnalysisTool.execute(
        { selection: "2, 4", phase_count: 4 },
        make_human_context()
      )
      expect(selectResult).toHaveProperty("title", "Phases Selected")
      const metadata = (selectResult as { metadata?: Record<string, unknown> }).metadata
      expect(metadata?.selectedIndices).toEqual([2, 4])

      const configResult = await configurePhaseObservationTool.execute(
        {
          mode: "guided",
          phase_name: "Build",
          observations: "We need to use React for the frontend",
          master_spec_context: "Build the user interface",
        },
        make_human_context()
      )
      expect(configResult).toHaveProperty("title", "Guided Observation Configured")
      const configOutput = (configResult as { output: string }).output
      expect(configOutput).toContain("Guided")
      expect(configOutput).toContain("React")
      expect(configOutput).toContain("Suggested Questions")
    })
  })

  describe("no phases in spec → bypass", () => {
    test("detectPhasesTool returns not applicable for spec without execution plan", async () => {
      await setupApprovedSpec(`# Specification

This is an analysis document without phases.
`)

      const result = await detectPhasesTool.execute({}, make_human_context())
      expect(result).toHaveProperty("title", "Phase Analysis Not Applicable")
      const metadata = (result as { metadata?: Record<string, unknown> }).metadata
      expect(metadata?.applicable).toBe(false)
    })

    test("check_execution_phases returns bypass when no phases detected", async () => {
      await setupApprovedSpec(`# Specification

Just some requirements.
`)

      const result = await checkExecutionPhasesTool.execute({}, make_human_context())
      expect(result).toHaveProperty("title", "No Execution Plan Detected")
      const output = (result as { output: string }).output
      expect(output).toContain("No execution plan")
    })
  })

  describe("analysis-only spec → bypass", () => {
    test("detectPhasesTool returns not applicable for audit report", async () => {
      await setupApprovedSpec(`# Audit Report

## Recommendations

1. Fix security issues
2. Improve performance

This is an assessment only document.
`)

      const result = await detectPhasesTool.execute({}, make_human_context())
      expect(result).toHaveProperty("title", "Phase Analysis Not Applicable")
      const metadata = (result as { metadata?: Record<string, unknown> }).metadata
      expect(metadata?.applicable).toBe(false)
    })

    test("check_execution_phases bypasses analysis-only specs", async () => {
      await setupApprovedSpec(`# Security Assessment

This document contains recommendations only.
No implementation is planned.
`)

      const result = await checkExecutionPhasesTool.execute({}, make_human_context())
      expect(result).toHaveProperty("title", "No Execution Plan Detected")
    })
  })

  describe("full phase analysis roundtrip", () => {
    test("open phase analysis, generate appendix, and verify state", async () => {
      await setupApprovedSpec(`# Specification

## Execution Plan

1. Backend API
2. Frontend UI
`)

      const state = await loadState(TEST_DIR, "test-session")
      state.currentPhase = "EXECUTION"
      await saveState(TEST_DIR, state, "test-session")

      // Open phase analysis round
      const openResult = await openPhaseAnalysisRoundTool.execute(
        {
          phase_index: 1,
          phase_name: "Backend API",
          mode: "auto",
          specialists: ["engineering-backend-architect"],
        },
        make_human_context()
      )
      expect(openResult).toHaveProperty("title", "Phase Analysis Opened: Backend API")

      // Generate appendix
      const appendixResult = await generatePhaseAppendixTool.execute(
        {
          phase_index: 1,
          phase_name: "Backend API",
          phase_scope: "Build REST API with authentication",
          specialist_analyses_summary: "Use PostgreSQL and Fastify",
          consensus_outcome: "Team agreed on Fastify",
          technical_decisions: "Fastify + PostgreSQL + JWT",
          revised_execution_plan: "Week 1: Setup, Week 2: API",
          delta_from_master: "Added JWT auth requirement",
          mode: "auto",
          specialists: ["engineering-backend-architect"],
        },
        make_human_context()
      )
      expect(appendixResult).toHaveProperty("title", "Phase Appendix Generated")

      // Verify state has appendix reference
      const loadedState = await loadState(TEST_DIR, "test-session")
      expect(loadedState.appendices.length).toBeGreaterThan(0)

      // Verify appendix file was created
      const metadata = (appendixResult as { metadata?: Record<string, unknown> }).metadata
      const appendixPath = metadata?.appendixPath as string
      expect(appendixPath).toBeDefined()
      const appendixContent = await fs.readFile(appendixPath, "utf-8")
      expect(appendixContent).toContain("Phase Appendix: Backend API")
      expect(appendixContent).toContain("Fastify + PostgreSQL + JWT")
      expect(appendixContent).toContain("appendix_id")

      // Verify phase context was updated
      const sessionId = (await import("../state.js")).getSessionId(TEST_DIR, "test-session")
      if (sessionId) {
        const repo = new SqliteStateRepository(TEST_DIR)
        const contextRecord = await repo.getPhaseContext(TEST_DIR, sessionId, "phase-1-backend-api")
        expect(contextRecord).not.toBeNull()
        const ctx = contextRecord!.context as Record<string, unknown>
        expect(ctx.status).toBe("approved")
        expect(ctx.appendixId).toBeDefined()
        repo.close()
      }
    })
  })

  describe("detect phases from spec_path argument", () => {
    test("uses explicit spec_path when provided", async () => {
      const specsDir = join(TEST_DIR, ".mesa", "specifications")
      await fs.mkdir(specsDir, { recursive: true })
      const customPath = join(specsDir, "custom-spec.md")
      await fs.writeFile(
        customPath,
        `# Custom Spec

## Execution Plan

1. Alpha
2. Beta
`,
        "utf-8"
      )

      const state = await loadState(TEST_DIR, "test-session")
      state.currentPhase = "EXECUTION"
      state.specification.path = null
      state.specification.status = "approved"
      await saveState(TEST_DIR, state, "test-session")

      const result = await detectPhasesTool.execute(
        { spec_path: ".mesa/specifications/custom-spec.md" },
        make_human_context()
      )
      expect(result).toHaveProperty("title", "Phases Detected")
      const metadata = (result as { metadata?: Record<string, unknown> }).metadata
      expect(metadata?.phases).toHaveLength(2)
    })
  })
})
