import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage, getSessionId } from "../state.js"
import { createInitialState } from "../config.js"
import { verifyImplementationTool } from "../tools/manager-tools.js"
import { SqliteStateRepository } from "../repositories/sqlite-state-repository.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "verification")

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
      return response as unknown as void
    },
  }
}

function getSid(): string {
  // Tools operate on the session ID passed via the tool context (make_human_context
  // uses "test-session"). getSessionId with that ID returns it directly.
  const sid = getSessionId(TEST_DIR, "test-session")
  if (!sid) throw new Error("No active session")
  return sid
}

describe("verify_implementation", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true })
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "EXECUTION"
    state.specification.status = "approved"
    state.specification.path = join(TEST_DIR, ".mesa", "spec-test.md")
    await saveState(TEST_DIR, state, "test-session")
    await fs.writeFile(state.specification.path, "# Test Spec")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {})
  })

  test("passed verification records in sidecar and returns success", async () => {
    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Foundation",
        task_description: "Set up project scaffolding",
        acceptance_criteria: ["Directory structure created", "Config files present"],
        result: "passed",
        gaps: [],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const output = result as { title: string; output: string }
    expect(output.title).toContain("Verification Passed")
    expect(output.output).toContain("Foundation")

    const state = await loadState(TEST_DIR, "test-session")
    const repo = new SqliteStateRepository(TEST_DIR)
    const ctx = await repo.getPhaseContext(state.workspaceId, getSid(), "verification-foundation")
    expect(ctx).not.toBeNull()
    expect(ctx!.context).toHaveProperty("result", "passed")
    expect(ctx!.context).toHaveProperty("status", "verified")
    repo.close()
  })

  test("passed with non-empty gaps is rejected", async () => {
    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Foundation",
        task_description: "Set up project scaffolding",
        acceptance_criteria: ["Directory structure created"],
        result: "passed",
        gaps: ["Missing config file"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    expect(result).toContain("Error")
    expect(result).toContain("passed")
  })

  test("failed with empty gaps is rejected", async () => {
    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Foundation",
        task_description: "Set up project scaffolding",
        acceptance_criteria: ["Directory structure created"],
        result: "failed",
        gaps: [],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    expect(result).toContain("Error")
    expect(result).toContain("failed")
  })

  test("failed without human_decision presents gaps and asks for decision", async () => {
    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Core Tools",
        task_description: "Implement phase detection tools",
        acceptance_criteria: ["4 tools registered", "All tests pass"],
        result: "failed",
        gaps: ["Missing generate_phase_appendix tool"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const output = result as { title: string; output: string }
    expect(output.title).toContain("Verification Failed")
    expect(output.output).toContain("Missing generate_phase_appendix tool")
    expect(output.output).toContain("Human decision required")
    expect(output.output).toContain("[A] Accept")
    expect(output.output).toContain("[C] Correct")

    const state = await loadState(TEST_DIR, "test-session")
    const repo = new SqliteStateRepository(TEST_DIR)
    const ctx = await repo.getPhaseContext(state.workspaceId, getSid(), "verification-core-tools")
    expect(ctx!.context).toHaveProperty("status", "pending_human_decision")
    repo.close()
  })

  test("failed with human_decision='accepted' registers tech debt", async () => {
    await verifyImplementationTool.execute(
      {
        phase_name: "Core Tools",
        task_description: "Implement tools",
        acceptance_criteria: ["4 tools registered"],
        result: "failed",
        gaps: ["Missing tool X"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Core Tools",
        task_description: "Implement tools",
        acceptance_criteria: ["4 tools registered"],
        result: "failed",
        gaps: ["Missing tool X"],
        qa_specialist_id: "qa-engineer",
        human_decision: "accepted" as const,
        accepted_gaps: ["Missing tool X"],
      },
      make_human_context()
    )

    const output = result as { title: string; output: string }
    expect(output.title).toContain("Tech Debt")
    expect(output.output).toContain("Missing tool X")

    const state = await loadState(TEST_DIR, "test-session")
    const repo = new SqliteStateRepository(TEST_DIR)
    const ctx = await repo.getPhaseContext(state.workspaceId, getSid(), "verification-core-tools")
    expect(ctx!.context).toHaveProperty("status", "accepted_as_debt")
    expect(ctx!.context).toHaveProperty("humanDecision", "accepted")
    repo.close()
  })

  test("failed with human_decision='correct' returns correction instructions", async () => {
    await verifyImplementationTool.execute(
      {
        phase_name: "Foundation",
        task_description: "Setup",
        acceptance_criteria: ["Dirs created"],
        result: "failed",
        gaps: ["Missing src/ dir"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Foundation",
        task_description: "Setup",
        acceptance_criteria: ["Dirs created"],
        result: "failed",
        gaps: ["Missing src/ dir"],
        qa_specialist_id: "qa-engineer",
        human_decision: "correct" as const,
      },
      make_human_context()
    )

    const output = result as { title: string; output: string }
    expect(output.title).toContain("Correction Required")
    expect(output.output).toContain("Missing src/ dir")
    expect(output.output).toContain("delegate_task")

    const state = await loadState(TEST_DIR, "test-session")
    const repo = new SqliteStateRepository(TEST_DIR)
    const ctx = await repo.getPhaseContext(state.workspaceId, getSid(), "verification-foundation")
    expect(ctx!.context).toHaveProperty("status", "correction_pending")
    repo.close()
  })

  test("rejects when not in EXECUTION phase", async () => {
    const state = await loadState(TEST_DIR, "test-session")
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state, "test-session")

    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Foundation",
        task_description: "Setup",
        acceptance_criteria: ["test"],
        result: "passed",
        gaps: [],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    expect(result).toContain("Error")
    expect(result).toContain("EXECUTION")
  })

  test("multiple verifications for different phases coexist in sidecar", async () => {
    await verifyImplementationTool.execute(
      {
        phase_name: "Phase A",
        task_description: "Task A",
        acceptance_criteria: ["Criterion A"],
        result: "passed",
        gaps: [],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    await verifyImplementationTool.execute(
      {
        phase_name: "Phase B",
        task_description: "Task B",
        acceptance_criteria: ["Criterion B1", "Criterion B2"],
        result: "failed",
        gaps: ["Criterion B2 not met"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const state = await loadState(TEST_DIR, "test-session")
    const repo = new SqliteStateRepository(TEST_DIR)
    const all = await repo.listPhaseContexts(state.workspaceId, getSid())
    const phaseA = all.find((c) => c.phase === "verification-phase-a")
    const phaseB = all.find((c) => c.phase === "verification-phase-b")
    expect(phaseA).toBeDefined()
    expect(phaseB).toBeDefined()
    expect(phaseA!.context).toHaveProperty("status", "verified")
    expect(phaseB!.context).toHaveProperty("status", "pending_human_decision")
    repo.close()
  })

  test("re-verification after correction marks as verified", async () => {
    await verifyImplementationTool.execute(
      {
        phase_name: "Testing",
        task_description: "Write tests",
        acceptance_criteria: ["90% coverage"],
        result: "failed",
        gaps: ["Only 75% coverage"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    await verifyImplementationTool.execute(
      {
        phase_name: "Testing",
        task_description: "Write tests",
        acceptance_criteria: ["90% coverage"],
        result: "failed",
        gaps: ["Only 75% coverage"],
        qa_specialist_id: "qa-engineer",
        human_decision: "correct" as const,
      },
      make_human_context()
    )

    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Testing",
        task_description: "Write tests (corrected)",
        acceptance_criteria: ["90% coverage"],
        result: "passed",
        gaps: [],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const output = result as { title: string; output: string }
    expect(output.title).toContain("Verification Passed")

    const state = await loadState(TEST_DIR, "test-session")
    const repo = new SqliteStateRepository(TEST_DIR)
    const ctx = await repo.getPhaseContext(state.workspaceId, getSid(), "verification-testing")
    expect(ctx!.context).toHaveProperty("status", "verified")
    repo.close()
  })

  test("accepted_gaps defaults to all gaps when not provided", async () => {
    await verifyImplementationTool.execute(
      {
        phase_name: "Cleanup",
        task_description: "Final cleanup",
        acceptance_criteria: ["No console.log"],
        result: "failed",
        gaps: ["2 console.log remaining"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Cleanup",
        task_description: "Final cleanup",
        acceptance_criteria: ["No console.log"],
        result: "failed",
        gaps: ["2 console.log remaining"],
        qa_specialist_id: "qa-engineer",
        human_decision: "accepted" as const,
      },
      make_human_context()
    )

    const output = result as { title: string; output: string }
    expect(output.title).toContain("Tech Debt")

    const state = await loadState(TEST_DIR, "test-session")
    const repo = new SqliteStateRepository(TEST_DIR)
    const ctx = await repo.getPhaseContext(state.workspaceId, getSid(), "verification-cleanup")
    expect(ctx!.context).toHaveProperty("acceptedGaps")
    expect((ctx!.context as Record<string, unknown>).acceptedGaps).toEqual(["2 console.log remaining"])
    repo.close()
  })

  test("passed verification includes criteria count in output", async () => {
    const result = await verifyImplementationTool.execute(
      {
        phase_name: "API Layer",
        task_description: "Build REST endpoints",
        acceptance_criteria: ["CRUD endpoints", "Validation", "Error handling"],
        result: "passed",
        gaps: [],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const output = result as { output: string }
    expect(output.output).toContain("3 acceptance criteria met")
  })

  test("multiple gaps are numbered correctly in failed output", async () => {
    const result = await verifyImplementationTool.execute(
      {
        phase_name: "Full Stack",
        task_description: "Complete feature",
        acceptance_criteria: ["Frontend done", "Backend done", "Tests pass", "Docs written"],
        result: "failed",
        gaps: ["Frontend incomplete", "Missing tests", "No documentation"],
        qa_specialist_id: "qa-engineer",
      },
      make_human_context()
    )

    const output = result as { output: string }
    expect(output.output).toContain("1. Frontend incomplete")
    expect(output.output).toContain("2. Missing tests")
    expect(output.output).toContain("3. No documentation")
  })
})
