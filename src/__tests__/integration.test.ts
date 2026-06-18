import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { loadState, saveState } from "../state.js"
import { createInitialState } from "../config.js"
import type { DiscussionState } from "../types.js"
import { canTransition } from "../workflow/transitions.js"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { PLUGIN_STATE_DIR } from "../config.js"

const TEST_DIR = join(import.meta.dirname, "__e2e_fixtures__")

async function setupTestWorkspace(): Promise<DiscussionState> {
  const state = createInitialState(TEST_DIR)
  await saveState(TEST_DIR, state)
  return state
}

describe("full workflow integration", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, PLUGIN_STATE_DIR), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(join(TEST_DIR, PLUGIN_STATE_DIR), { recursive: true, force: true })
  })

  test("complete happy path: briefing → team → analysis → consensus → spec → approval", async () => {
    // Step 1: Initial state
    const state = await setupTestWorkspace()
    expect(state.currentPhase).toBe("PLANNING")
    expect(state.briefing.status).toBe("draft")

    // Step 2: Create briefing
    state.briefing.path = join(TEST_DIR, PLUGIN_STATE_DIR, "briefings", "briefing-test.md")
    state.briefing.slug = "test-project"
    state.briefing.status = "draft"
    await fs.mkdir(join(TEST_DIR, PLUGIN_STATE_DIR, "briefings"), { recursive: true })
    await fs.writeFile(state.briefing.path, "---\nstatus: draft\n---\n# Test Briefing\n\nContent here.", "utf-8")
    await saveState(TEST_DIR, state)

    // Step 3: Approve briefing
    state.briefing.status = "approved"
    await saveState(TEST_DIR, state)
    let loaded = await loadState(TEST_DIR)
    expect(loaded.briefing.status).toBe("approved")

    // Step 4: Deliver briefing → transitions to PLANNING
    state.currentPhase = "PLANNING"
    await saveState(TEST_DIR, state)
    loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("PLANNING")

    // Step 5: Propose team
    state.team = [
      { personaId: "engineering-backend-architect", name: "Backend Architect", division: "engineering", status: "proposed" },
      { personaId: "product-product-manager", name: "Product Manager", division: "product", status: "proposed" },
    ]
    await saveState(TEST_DIR, state)
    loaded = await loadState(TEST_DIR)
    expect(loaded.team.length).toBe(2)
    expect(loaded.team.every((t) => t.status === "proposed")).toBe(true)

    // Step 6: Summon team (after human approval)
    for (const member of state.team) {
      member.status = "summoned"
    }
    await saveState(TEST_DIR, state)

    // Step 7: Open analysis round
    expect(canTransition("PLANNING", "DISCUSSION")).toBe(true)
    state.currentPhase = "DISCUSSION"
    state.discussion.topic = "Test Project Architecture"
    state.discussion.currentTurn = 1
    state.discussion.maxTurns = 2
    state.discussion.analyses = []
    await saveState(TEST_DIR, state)

    // Step 8: Register analyses
    state.discussion.analyses.push(
      {
        agentId: "engineering-backend-architect",
        agentName: "Backend Architect",
        content: "I recommend microservices architecture...",
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        agentId: "product-product-manager",
        agentName: "Product Manager",
        content: "From a product perspective, we should prioritize...",
        turn: 1,
        timestamp: new Date().toISOString(),
      }
    )
    await saveState(TEST_DIR, state)
    loaded = await loadState(TEST_DIR)
    expect(loaded.discussion.analyses.length).toBe(2)

    // Step 9: Request consensus
    // Consensus now lives WITHIN the DISCUSSION phase (spec-4dcc492f, Decision 3)
    // via discussion.mode → "voting"; there is no DISCUSSION→DISCUSSION phase transition.
    state.currentPhase = "DISCUSSION"
    state.discussion.consensusRound = 1
    state.discussion.votes = [
      { agentId: "engineering-backend-architect", agentName: "Backend Architect", vote: 1, reason: "Agree with the approach", round: 1 },
      { agentId: "product-product-manager", agentName: "Product Manager", vote: 2, reason: "Agree but suggest timeline adjustment", round: 1 },
    ]
    await saveState(TEST_DIR, state)

    // Step 10: Generate specification
    expect(canTransition("DISCUSSION", "SPECIFICATION")).toBe(true)
    state.currentPhase = "SPECIFICATION"
    const specsDir = join(TEST_DIR, PLUGIN_STATE_DIR, "specifications")
    await fs.mkdir(specsDir, { recursive: true })
    const specPath = join(specsDir, "spec-test.md")
    await fs.writeFile(specPath, "# Specification: Test Project\n\nContent...", "utf-8")
    state.specification.path = specPath
    state.specification.status = "draft"
    await saveState(TEST_DIR, state)

    // Step 11: Specification stays in SPECIFICATION (draft→approval is a status
    // change, not a phase self-transition, per the collapsed 8→4 phase model).
    state.currentPhase = "SPECIFICATION"
    await saveState(TEST_DIR, state)

    // Step 12: Approve specification
    expect(canTransition("SPECIFICATION", "EXECUTION")).toBe(true)
    state.currentPhase = "EXECUTION"
    state.specification.status = "approved"
    await saveState(TEST_DIR, state)

    // Final verification
    loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("EXECUTION")
    expect(loaded.specification.status).toBe("approved")
    expect(loaded.discussion.analyses.length).toBe(2)
    expect(loaded.discussion.votes.length).toBe(2)
    expect(loaded.team.every((t) => t.status === "summoned")).toBe(true)
  })

  test("specification rejection returns to DOCUMENTATION", async () => {
    const state = await setupTestWorkspace()
    state.currentPhase = "SPECIFICATION"
    state.specification.status = "draft"
    await saveState(TEST_DIR, state)

    // Rejection is a status change within SPECIFICATION (DOCUMENTATION/APPROVAL were
    // merged into SPECIFICATION). The SPECIFICATION→DISCUSSION back-edge remains for re-work.
    state.currentPhase = "SPECIFICATION"
    state.specification.status = "rejected"
    await saveState(TEST_DIR, state)

    const loaded = await loadState(TEST_DIR)
    expect(loaded.currentPhase).toBe("SPECIFICATION")
    expect(loaded.specification.status).toBe("rejected")
  })

  test("pause and resume preserves state", async () => {
    const state = await setupTestWorkspace()
    state.currentPhase = "DISCUSSION"
    state.discussion.analyses = [
      { agentId: "test", agentName: "Test", content: "Partial analysis", turn: 1, timestamp: new Date().toISOString() },
    ]
    await saveState(TEST_DIR, state)

    // Pause sets the orthogonal `status` field; the phase is preserved for resume.
    state.status = "paused"
    state.previousPhase = state.currentPhase
    await saveState(TEST_DIR, state)

    let loaded = await loadState(TEST_DIR)
    expect(loaded.status).toBe("paused")
    expect(loaded.currentPhase).toBe("DISCUSSION")
    expect(loaded.discussion.analyses.length).toBe(1)

    // Resume restores active status; the phase is unchanged.
    loaded.status = "active"
    loaded.previousPhase = null
    await saveState(TEST_DIR, loaded)

    loaded = await loadState(TEST_DIR)
    expect(loaded.status).toBe("active")
    expect(loaded.currentPhase).toBe("DISCUSSION")
    expect(loaded.discussion.analyses.length).toBe(1)
  })

  test("cancel clears analysis data", async () => {
    const state = await setupTestWorkspace()
    state.currentPhase = "DISCUSSION"
    state.discussion.analyses = [
      { agentId: "test", agentName: "Test", content: "Analysis", turn: 1, timestamp: new Date().toISOString() },
    ]
    state.discussion.votes = [
      { agentId: "test", agentName: "Test", vote: 1, reason: "ok", round: 1 },
    ]
    await saveState(TEST_DIR, state)

    // Cancel sets the orthogonal `status` field and clears discussion data; the
    // phase is kept for audit (CANCELLED is no longer a phase).
    state.status = "cancelled"
    state.discussion.analyses = []
    state.discussion.votes = []
    state.discussion.currentTurn = 0
    await saveState(TEST_DIR, state)

    const loaded = await loadState(TEST_DIR)
    expect(loaded.status).toBe("cancelled")
    expect(loaded.currentPhase).toBe("DISCUSSION")
    expect(loaded.discussion.analyses.length).toBe(0)
  })

  test("state survives reload", async () => {
    const state = await setupTestWorkspace()
    state.briefing.status = "approved"
    state.currentPhase = "DISCUSSION"
    state.team = [
      { personaId: "test-agent", name: "Test Agent", division: "testing", status: "summoned" },
    ]
    state.discussion.topic = "Reliability Test"
    await saveState(TEST_DIR, state)

    const reloaded = await loadState(TEST_DIR)
    expect(reloaded.briefing.status).toBe("approved")
    expect(reloaded.currentPhase).toBe("DISCUSSION")
    expect(reloaded.team[0].personaId).toBe("test-agent")
    expect(reloaded.discussion.topic).toBe("Reliability Test")
  })
})
