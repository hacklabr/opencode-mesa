// Tests for the kernel decision/deliverable tools (spec D3/D4/D6).
// Covers: data preconditions (never requirePhase), plan pointer side effects,
// override audit marking, provenance roundIds, and approve_deliverable as the
// only path to "approved".

import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join, dirname } from "node:path"
import {
  recordDecisionTool,
  produceDeliverableTool,
  approveDeliverableTool,
} from "../tools/decision-tools.js"
import { loadState, saveState, closeStorage, getDb } from "../state.js"
import { createInitialState } from "../config.js"
import { resolveSessionInput, buildPlanPath } from "../utils/paths.js"
import type { DiscussionState } from "../types.js"
import type { SuccessResponse } from "../utils/responses.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "decision-tools")
const SESSION = "test-session"

function makeContext() {
  return {
    sessionID: SESSION,
    messageID: "test-msg",
    agent: "test",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

async function seed(mutate?: (state: DiscussionState) => void): Promise<DiscussionState> {
  const state = createInitialState(TEST_DIR)
  mutate?.(state)
  await saveState(TEST_DIR, state, SESSION)
  return state
}

/** Seed one closed round (r1, with analysis) and one open round (r2, without). */
async function seedWithRounds(): Promise<void> {
  await seed((state) => {
    state.rounds = [
      {
        id: "r1",
        topic: "Round 1",
        participants: ["agent-a"],
        status: "closed",
        openedAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
      },
      {
        id: "r2",
        topic: "Round 2",
        participants: ["agent-a"],
        status: "open",
        openedAt: new Date().toISOString(),
      },
    ]
    state.discussion.analyses = [
      {
        agentId: "agent-a",
        agentName: "Agent A",
        content: "Analysis body\n\nPOSITION: agree — looks right",
        turn: 1,
        roundId: "r1",
        timestamp: new Date().toISOString(),
      },
    ]
  })
}

interface AuditLine {
  action: string
  planVersion?: number
  details?: Record<string, unknown>
}

async function readAudit(): Promise<AuditLine[]> {
  const content = await fs.readFile(join(TEST_DIR, ".mesa", "audit.log"), "utf-8")
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditLine)
}

/** Write a stub workflow-plan.md at the canonical session-scoped path. */
async function writeCanonicalPlan(session = SESSION): Promise<string> {
  const state = await loadState(TEST_DIR, session)
  const input = await resolveSessionInput(TEST_DIR, state, session, getDb)
  const rel = buildPlanPath(input)
  const abs = join(TEST_DIR, rel)
  await fs.mkdir(dirname(abs), { recursive: true })
  await fs.writeFile(abs, "# Workflow Plan\n")
  return rel
}

describe("record_decision", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {})
  })

  test("rejects when session status is not active (global guard)", async () => {
    await seed((s) => {
      s.status = "paused"
    })
    const result = await recordDecisionTool.execute(
      { type: "note", reason: "hello" },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("paused")
  })

  test("gate on plan sets AND approves the plan pointer at the canonical session-scoped path (gate 0)", async () => {
    await seed()
    const planRel = await writeCanonicalPlan()
    const result = (await recordDecisionTool.execute(
      {
        type: "gate",
        target: "plan",
        reason: "Human approved the workflow plan at gate 0",
      },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toContain("gate")
    const state = await loadState(TEST_DIR, SESSION)
    expect(state.plan).not.toBeNull()
    expect(state.plan!.path).toBe(planRel)
    expect(state.plan!.path).toContain(state.sessionFolder!)
    expect(state.plan!.path).toMatch(/workflow-plan\.md$/)
    expect(state.plan!.version).toBe(1)
    expect(state.plan!.status).toBe("approved")
    expect(state.plan!.approvedAt).toBeDefined()

    const audit = await readAudit()
    const entry = audit.find((e) => e.action === "decision_recorded")
    expect(entry).toBeDefined()
    expect(entry!.planVersion).toBe(1)
    expect(entry!.details).toMatchObject({ type: "gate", target: "plan" })
  })

  test("gate ignores a caller-supplied payload.path — the plugin owns the session-scoped path", async () => {
    await seed()
    await writeCanonicalPlan()
    const result = (await recordDecisionTool.execute(
      {
        type: "gate",
        target: "plan",
        reason: "Human approved",
        payload: { path: ".mesa/workflow-plan.md" }, // must be ignored, not trusted
      },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toContain("gate")
    const state = await loadState(TEST_DIR, SESSION)
    expect(state.plan!.path).toContain(state.sessionFolder!)
    expect(state.plan!.path).not.toBe(".mesa/workflow-plan.md")
  })

  test("gate fails when the plan file is missing at the canonical location (recovery guidance)", async () => {
    await seed()
    const result = await recordDecisionTool.execute(
      { type: "gate", target: "plan", reason: "forgot to write the file" },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("workflow-plan.md not found")
    expect(result as string).toContain("sessions")
    const state = await loadState(TEST_DIR, SESSION)
    expect(state.plan).toBeNull()
  })

  test("concurrent sessions get DIFFERENT plan paths (session-hash isolation)", async () => {
    await seed()
    const planA = await writeCanonicalPlan(SESSION)
    await recordDecisionTool.execute(
      { type: "gate", target: "plan", reason: "session A gate" },
      { ...makeContext(), sessionID: SESSION }
    )
    const stateA = await loadState(TEST_DIR, SESSION)
    expect(stateA.plan!.path).toBe(planA)

    // A second session in the same workspace must resolve its own folder.
    const seedB = createInitialState(TEST_DIR)
    await saveState(TEST_DIR, seedB, "test-session-b")
    const planB = await writeCanonicalPlan("test-session-b")
    await recordDecisionTool.execute(
      { type: "gate", target: "plan", reason: "session B gate" },
      { ...makeContext(), sessionID: "test-session-b" }
    )
    const stateB = await loadState(TEST_DIR, "test-session-b")
    expect(stateB.plan!.path).toBe(planB)
    expect(planA).not.toBe(planB)
  })

  test("plan-amendment bumps the version and keeps status; audit carries new planVersion", async () => {
    await seed()
    await writeCanonicalPlan()
    await recordDecisionTool.execute(
      {
        type: "gate",
        target: "plan",
        reason: "gate 0",
      },
      makeContext()
    )

    const result = (await recordDecisionTool.execute(
      {
        type: "plan-amendment",
        target: "plan",
        reason: "Added a conflict round for the persistency tension",
        payload: { version: 2 },
      },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toContain("plan-amendment")
    const state = await loadState(TEST_DIR, SESSION)
    expect(state.plan!.version).toBe(2)
    expect(state.plan!.status).toBe("approved")

    const audit = await readAudit()
    const entries = audit.filter((e) => e.action === "decision_recorded")
    expect(entries.length).toBe(2)
    expect(entries[1].planVersion).toBe(2)
  })

  test("plan-amendment without an existing plan fails", async () => {
    await seed()
    const result = await recordDecisionTool.execute(
      { type: "plan-amendment", target: "plan", reason: "no plan yet" },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("No plan exists")
  })

  test("plan-amendment that does not increase the version fails (anti silent-replanning)", async () => {
    await seed()
    await writeCanonicalPlan()
    await recordDecisionTool.execute(
      {
        type: "gate",
        target: "plan",
        reason: "gate 0",
      },
      makeContext()
    )
    const result = await recordDecisionTool.execute(
      { type: "plan-amendment", target: "plan", reason: "same version", payload: { version: 1 } },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("must increase the version")
  })

  test("override on a draft plan force-approves it with explicit override marking in audit", async () => {
    await seed((s) => {
      s.plan = { path: ".mesa/sessions/x/workflow-plan.md", version: 1, status: "draft" }
    })

    const result = (await recordDecisionTool.execute(
      {
        type: "override",
        target: "plan",
        reason: "Human authorized skipping gate 0 for this trivial scope",
      },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toContain("override")
    const state = await loadState(TEST_DIR, SESSION)
    expect(state.plan!.status).toBe("approved")
    expect(state.plan!.version).toBe(1)

    const audit = await readAudit()
    const entry = audit.find((e) => e.action === "decision_recorded")
    expect(entry).toBeDefined()
    expect(entry!.details).toMatchObject({ type: "override", override: true })
    expect(entry!.planVersion).toBe(1)
  })

  test("delegation and note types are audit-only (no state mutation)", async () => {
    await seed()
    const result = (await recordDecisionTool.execute(
      {
        type: "delegation",
        target: "engineering-backend-architect",
        reason: "Delegated API contract design",
        payload: { taskId: "ses_abc" },
      },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toContain("delegation")
    const state = await loadState(TEST_DIR, SESSION)
    expect(state.plan).toBeNull()
    expect(state.deliverables.length).toBe(0)

    const audit = await readAudit()
    const entry = audit.find((e) => e.action === "decision_recorded")
    expect(entry).toBeDefined()
    expect(entry!.details).toMatchObject({ type: "delegation", target: "engineering-backend-architect" })
    // No plan → no planVersion on the entry.
    expect(entry!.planVersion).toBeUndefined()
  })
})

describe("produce_deliverable", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {})
  })

  test("rejects when no closed round with analysis exists (data precondition)", async () => {
    await seed()
    const result = await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "# Spec" },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("no closed round")
    expect(result as string).toContain("humanOverride")
  })

  test("rejects when the closed round has NO analysis linked to it", async () => {
    await seed((s) => {
      s.rounds = [
        {
          id: "r1",
          topic: "Round 1",
          participants: ["agent-a"],
          status: "closed",
          openedAt: new Date().toISOString(),
          closedAt: new Date().toISOString(),
        },
      ]
      // Analysis exists but belongs to no closed round.
      s.discussion.analyses = [
        {
          agentId: "agent-a",
          agentName: "Agent A",
          content: "orphan",
          turn: 1,
          roundId: "r9",
          timestamp: new Date().toISOString(),
        },
      ]
    })
    const result = await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "# Spec" },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("no closed round")
  })

  test("writes the canonical file and registers a draft with provenance from CLOSED rounds only", async () => {
    await seedWithRounds()
    const result = (await produceDeliverableTool.execute(
      { kind: "specification", topic: "Flexibilização", content: "# Spec body" },
      makeContext()
    )) as SuccessResponse

    const state = await loadState(TEST_DIR, SESSION)
    expect(state.deliverables.length).toBe(1)
    const d = state.deliverables[0]
    expect(d.kind).toBe("specification")
    expect(d.status).toBe("draft") // never approved at produce time
    expect(d.path).toContain("specification.md")
    expect(d.path).toContain(state.sessionFolder!)
    // Provenance: only r1 (closed); r2 is open and must NOT appear.
    expect(d.provenance.roundIds).toEqual(["r1"])

    const content = await fs.readFile(join(TEST_DIR, d.path), "utf-8")
    expect(content).toContain("# Specification: Flexibilização")
    expect(content).toContain("# Spec body")

    const audit = await readAudit()
    const entry = audit.find((e) => e.action === "deliverable_produced")
    expect(entry).toBeDefined()
    expect(entry!.details).toMatchObject({ kind: "specification" })
    expect((entry!.details as { override?: boolean }).override).toBeUndefined()
  })

  test("humanOverride bypasses the precondition and is marked in audit", async () => {
    await seed()
    const result = (await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "# Spec", humanOverride: true },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toContain("Deliverable Produced")
    const audit = await readAudit()
    const entry = audit.find((e) => e.action === "deliverable_produced")
    expect(entry).toBeDefined()
    expect((entry!.details as { override?: boolean }).override).toBe(true)
  })

  test("kind determines the canonical path (overview / journeys / appendix / other)", async () => {
    await seedWithRounds()
    const kinds = [
      { kind: "overview", expectPath: "overview.md" },
      { kind: "journeys", expectPath: "journeys.md" },
      { kind: "appendix", expectPath: "appendices/appendix-phase-2-deep-dive-" },
      { kind: "other", expectPath: "deliverables/risk-register.md" },
    ] as const

    for (const { kind, expectPath } of kinds) {
      const result = (await produceDeliverableTool.execute(
        { kind, topic: kind === "appendix" ? "Phase 2 deep dive" : "Risk register", content: `# ${kind}` },
        makeContext()
      )) as SuccessResponse
      expect(result.title).toContain("Deliverable Produced")
      expect((result.metadata as { path: string }).path).toContain(expectPath)
    }

    const state = await loadState(TEST_DIR, SESSION)
    expect(state.deliverables.length).toBe(4)
  })

  test("refuses to overwrite an APPROVED deliverable at the same path", async () => {
    await seedWithRounds()
    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v1" },
      makeContext()
    )
    const state = await loadState(TEST_DIR, SESSION)
    const path = state.deliverables[0].path
    await approveDeliverableTool.execute({ path, approved: true }, makeContext())

    const result = await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v2" },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("approved deliverable already exists")

    const content = await fs.readFile(join(TEST_DIR, path), "utf-8")
    expect(content).toContain("v1")
  })

  test("a rejected deliverable may be re-produced as a new draft", async () => {
    await seedWithRounds()
    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v1" },
      makeContext()
    )
    const state = await loadState(TEST_DIR, SESSION)
    await approveDeliverableTool.execute(
      { path: state.deliverables[0].path, approved: false, feedback: "too thin" },
      makeContext()
    )

    const result = (await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v2 — expanded" },
      makeContext()
    )) as SuccessResponse
    expect(result.title).toContain("Deliverable Produced")

    const reloaded = await loadState(TEST_DIR, SESSION)
    expect(reloaded.deliverables[0].status).toBe("draft")
    const content = await fs.readFile(join(TEST_DIR, reloaded.deliverables[0].path), "utf-8")
    expect(content).toContain("v2 — expanded")
  })
})

describe("approve_deliverable", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {})
  })

  test("rejects when no deliverable exists at the path", async () => {
    await seed()
    const result = await approveDeliverableTool.execute(
      { path: ".mesa/sessions/x/specification.md", approved: true },
      makeContext()
    )
    expect(typeof result).toBe("string")
    expect(result as string).toContain("No deliverable registered")
  })

  test("rejects when the deliverable is not draft", async () => {
    await seedWithRounds()
    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v1" },
      makeContext()
    )
    const state = await loadState(TEST_DIR, SESSION)
    const path = state.deliverables[0].path
    await approveDeliverableTool.execute({ path, approved: true }, makeContext())

    const result = await approveDeliverableTool.execute({ path, approved: true }, makeContext())
    expect(typeof result).toBe("string")
    expect(result as string).toContain("already")
  })

  test("approves a draft deliverable and audits with planVersion", async () => {
    await seedWithRounds()
    // Establish a plan so planVersion flows into the audit entry.
    await writeCanonicalPlan()
    await recordDecisionTool.execute(
      {
        type: "gate",
        target: "plan",
        reason: "gate 0",
      },
      makeContext()
    )
    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v1" },
      makeContext()
    )
    const state = await loadState(TEST_DIR, SESSION)
    const path = state.deliverables[0].path

    const result = (await approveDeliverableTool.execute(
      { path, approved: true },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toBe("Deliverable Approved")
    const reloaded = await loadState(TEST_DIR, SESSION)
    expect(reloaded.deliverables[0].status).toBe("approved")

    const audit = await readAudit()
    const entry = audit.find((e) => e.action === "deliverable_approved")
    expect(entry).toBeDefined()
    expect(entry!.planVersion).toBe(1)
  })

  test("rejects with feedback recorded", async () => {
    await seedWithRounds()
    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v1" },
      makeContext()
    )
    const state = await loadState(TEST_DIR, SESSION)
    const path = state.deliverables[0].path

    const result = (await approveDeliverableTool.execute(
      { path, approved: false, feedback: "missing risk section" },
      makeContext()
    )) as SuccessResponse

    expect(result.title).toBe("Deliverable Rejected")
    const reloaded = await loadState(TEST_DIR, SESSION)
    expect(reloaded.deliverables[0].status).toBe("rejected")

    const audit = await readAudit()
    const entry = audit.find((e) => e.action === "deliverable_rejected")
    expect(entry).toBeDefined()
    expect(entry!.details).toMatchObject({ feedback: "missing risk section" })
  })

  test("approve_deliverable is the ONLY path to approved (produce never approves)", async () => {
    await seedWithRounds()
    await produceDeliverableTool.execute(
      { kind: "specification", topic: "Spec", content: "v1" },
      makeContext()
    )
    const state = await loadState(TEST_DIR, SESSION)
    expect(state.deliverables[0].status).toBe("draft")
    // No tool call other than approve_deliverable can flip this — asserted
    // structurally by the produce tests above (status hardcoded "draft").
  })
})
