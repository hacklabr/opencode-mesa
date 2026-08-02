// Migration v13 → v14 tests (spec D2/D4/D9).
//
// Covers: legacy backfill mapping (synthetic `legacy-round-1` from
// discussion.analyses; deliverable from the legacy specification_path
// COLUMN), idempotency (running the migration on every getDb must be a
// no-op after the first pass), and the v14 field round-trip through
// saveState/loadState.
//
// Post-v15 note: `specification` no longer exists on DiscussionState, so
// legacy rows are simulated by writing the specification_path/status
// columns directly via SQL (they remain in the DB schema as legacy
// columns — only the in-memory field was removed).

import { describe, expect, test, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState, CURRENT_STATE_VERSION, PLUGIN_STATE_DIR } from "../config.js"
import { openDatabase } from "../db/driver.js"
import type { DiscussionState } from "../types.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "state-migration-v14")
const SESSION_ID = "test-session"

/** Seed a legacy session: analyses/participants via saveState, spec via SQL. */
async function seedLegacy(opts: {
  analyses?: boolean
  specStatus?: "approved" | "pending" | null
}): Promise<void> {
  const state = createInitialState(TEST_DIR)
  state.currentPhase = "DISCUSSION"
  // Non-null sessionFolder models the common production case (sessions already
  // through the v10→v11 relocation), so migrateFiles skips the seeded row and
  // the v14 backfill is exercised in isolation.
  state.sessionFolder = ".mesa/sessions/202607131534_test_legacy"
  state.discussion.topic = "Legacy topic"
  if (opts.analyses !== false) {
    state.discussion.participants = ["eng-1", "design-1"]
    state.discussion.analyses = [
      {
        agentId: "eng-1",
        agentName: "Engineer",
        content: "analysis 1",
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        agentId: "design-1",
        agentName: "Designer",
        content: "analysis 2",
        turn: 1,
        timestamp: new Date().toISOString(),
      },
    ]
  }
  await saveState(TEST_DIR, state, SESSION_ID)

  if (opts.specStatus) {
    const dbPath = join(TEST_DIR, PLUGIN_STATE_DIR, "state.db")
    const db = openDatabase(dbPath)
    try {
      db.run(
        "UPDATE mesa_session_state SET specification_path = ?, specification_status = ? WHERE session_id = ?",
        [".mesa/sessions/legacy/spec.md", opts.specStatus, SESSION_ID]
      )
    } finally {
      db.close()
    }
  }
}

afterEach(async () => {
  closeStorage(TEST_DIR)
  await fs.rm(TEST_DIR, { recursive: true, force: true })
})

describe("v14 backfill — legacy mapping", () => {
  test("synthesizes legacy-round-1 from discussion.analyses and maps the specification to a deliverable", async () => {
    await seedLegacy({ specStatus: "approved" })

    // Force a fresh DB open so the migration pass runs over the seeded row.
    closeStorage(TEST_DIR)
    const loaded = await loadState(TEST_DIR, SESSION_ID)

    // rounds backfill
    expect(loaded.rounds).toHaveLength(1)
    const round = loaded.rounds[0]
    expect(round.id).toBe("legacy-round-1")
    expect(round.status).toBe("closed")
    expect(round.topic).toBe("Legacy topic")
    expect(round.participants).toEqual(["eng-1", "design-1"])
    expect(round.openedAt).toBeTruthy()
    expect(round.closedAt).toBeTruthy()

    // analyses carry the synthetic round id
    expect(loaded.discussion.analyses).toHaveLength(2)
    for (const a of loaded.discussion.analyses) {
      expect(a.roundId).toBe("legacy-round-1")
    }

    // deliverables backfill
    expect(loaded.deliverables).toHaveLength(1)
    const d = loaded.deliverables[0]
    expect(d.path).toBe(".mesa/sessions/legacy/spec.md")
    expect(d.kind).toBe("specification")
    expect(d.status).toBe("approved")
    expect(d.provenance.roundIds).toEqual(["legacy-round-1"])

    // plan pointer untouched
    expect(loaded.plan).toBeNull()

    // version bumped
    expect(loaded.stateVersion).toBe(CURRENT_STATE_VERSION)
  })

  test("legacy specification status 'pending' maps to deliverable 'draft'", async () => {
    await seedLegacy({ specStatus: "pending" })

    closeStorage(TEST_DIR)
    const loaded = await loadState(TEST_DIR, SESSION_ID)

    expect(loaded.deliverables).toHaveLength(1)
    expect(loaded.deliverables[0].status).toBe("draft")
  })

  test("deliverable without analyses gets empty provenance (no synthetic round)", async () => {
    await seedLegacy({ analyses: false, specStatus: "approved" })

    closeStorage(TEST_DIR)
    const loaded = await loadState(TEST_DIR, SESSION_ID)

    expect(loaded.rounds).toEqual([])
    expect(loaded.deliverables).toHaveLength(1)
    expect(loaded.deliverables[0].provenance.roundIds).toEqual([])
  })

  test("session with neither analyses nor specification stays empty", async () => {
    await seedLegacy({ analyses: false, specStatus: null })

    closeStorage(TEST_DIR)
    const loaded = await loadState(TEST_DIR, SESSION_ID)

    expect(loaded.rounds).toEqual([])
    expect(loaded.deliverables).toEqual([])
    expect(loaded.plan).toBeNull()
    expect(loaded.stateVersion).toBe(CURRENT_STATE_VERSION)
  })
})

describe("v14 backfill — idempotency", () => {
  test("running the migration repeatedly produces identical results (no duplicated rounds/deliverables)", async () => {
    await seedLegacy({ specStatus: "approved" })

    closeStorage(TEST_DIR)
    const first = await loadState(TEST_DIR, SESSION_ID)

    closeStorage(TEST_DIR)
    const second = await loadState(TEST_DIR, SESSION_ID)

    closeStorage(TEST_DIR)
    const third = await loadState(TEST_DIR, SESSION_ID)

    expect(second.rounds).toEqual(first.rounds)
    expect(third.rounds).toEqual(first.rounds)
    expect(second.deliverables).toEqual(first.deliverables)
    expect(third.deliverables).toEqual(first.deliverables)
    expect(third.rounds).toHaveLength(1)
    expect(third.deliverables).toHaveLength(1)
  })
})

describe("v14 fields — save/load round-trip", () => {
  test("rounds, deliverables and plan persist through saveState/loadState untouched", async () => {
    const state = createInitialState(TEST_DIR)
    state.sessionFolder = ".mesa/sessions/202607131534_test_legacy"
    state.rounds = [
      {
        id: "r1",
        topic: "Designed round",
        participants: ["eng-1"],
        status: "open",
        openedAt: new Date().toISOString(),
      },
    ]
    state.deliverables = [
      {
        path: ".mesa/sessions/x/outline.md",
        kind: "outline",
        status: "draft",
        provenance: { roundIds: ["r1"] },
      },
    ]
    state.plan = {
      path: ".mesa/sessions/x/workflow-plan.md",
      version: 2,
      status: "approved",
      approvedAt: new Date().toISOString(),
    }
    await saveState(TEST_DIR, state, SESSION_ID)

    closeStorage(TEST_DIR)
    const loaded = await loadState(TEST_DIR, SESSION_ID)

    // The migration must NOT overwrite explicitly-set v14 fields.
    expect(loaded.rounds).toHaveLength(1)
    expect(loaded.rounds[0].id).toBe("r1")
    expect(loaded.rounds[0].status).toBe("open")
    expect(loaded.deliverables).toHaveLength(1)
    expect(loaded.deliverables[0].kind).toBe("outline")
    expect(loaded.plan).not.toBeNull()
    expect(loaded.plan!.version).toBe(2)
    expect(loaded.plan!.status).toBe("approved")
  })

  test("createInitialState ships v14 defaults at CURRENT_STATE_VERSION", () => {
    const state = createInitialState(TEST_DIR)
    expect(state.rounds).toEqual([])
    expect(state.deliverables).toEqual([])
    expect(state.plan).toBeNull()
    expect(state.stateVersion).toBe(CURRENT_STATE_VERSION)
    expect(CURRENT_STATE_VERSION).toBe(15)
  })
})
