// Migration v14 → v15 tests (spec D5/D6/D9).
//
// Covers: (1) legacy votes tables are exported to the audit log BEFORE being
// dropped, (2) the analyses UNIQUE constraint is recreated to include
// round_id (multi-round registration), (3) idempotency.

import { describe, expect, test, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState, PLUGIN_STATE_DIR } from "../config.js"
import { openDatabase } from "../db/driver.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "state-migration-v15")
const SESSION_ID = "test-session"

/** Create a legacy votes table with rows, bypassing getDb (no migrations). */
function seedLegacyVotes(table: "mesa_votes" | "mesa_session_votes"): void {
  const dbPath = join(TEST_DIR, PLUGIN_STATE_DIR, "state.db")
  const db = openDatabase(dbPath)
  try {
    if (table === "mesa_session_votes") {
      db.exec(`CREATE TABLE IF NOT EXISTS mesa_session_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT,
        vote INTEGER CHECK(vote IN (0,1,2)),
        reason TEXT,
        round INTEGER,
        UNIQUE(workspace_id, session_id, agent_id, round)
      )`)
      db.run(
        "INSERT INTO mesa_session_votes (workspace_id, session_id, agent_id, agent_name, vote, reason, round) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [TEST_DIR, SESSION_ID, "eng-1", "Engineer", 1, "looks good", 1]
      )
      db.run(
        "INSERT INTO mesa_session_votes (workspace_id, session_id, agent_id, agent_name, vote, reason, round) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [TEST_DIR, SESSION_ID, "design-1", "Designer", 0, "disagree on persistence", 1]
      )
    } else {
      db.exec(`CREATE TABLE IF NOT EXISTS mesa_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT,
        vote INTEGER CHECK(vote IN (0,1,2)),
        reason TEXT,
        round INTEGER,
        UNIQUE(workspace_id, agent_id, round)
      )`)
      db.run(
        "INSERT INTO mesa_votes (workspace_id, agent_id, agent_name, vote, reason, round) VALUES (?, ?, ?, ?, ?, ?)",
        [TEST_DIR, "eng-1", "Engineer", 2, "agree with reservations", 1]
      )
    }
  } finally {
    db.close()
  }
}

function tableExists(table: string): boolean {
  const dbPath = join(TEST_DIR, PLUGIN_STATE_DIR, "state.db")
  const db = openDatabase(dbPath, { readonly: true })
  try {
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
    return row !== null && row !== undefined
  } finally {
    db.close()
  }
}

async function readAuditLog(): Promise<Array<Record<string, unknown>>> {
  const logPath = join(TEST_DIR, PLUGIN_STATE_DIR, "audit.log")
  try {
    const content = await fs.readFile(logPath, "utf-8")
    return content.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

afterEach(async () => {
  closeStorage(TEST_DIR)
  await fs.rm(TEST_DIR, { recursive: true, force: true })
})

describe("v15 — votes export and drop", () => {
  test("exports mesa_session_votes rows to the audit log, then drops the table", async () => {
    await fs.mkdir(join(TEST_DIR, PLUGIN_STATE_DIR), { recursive: true })
    await saveState(TEST_DIR, createInitialState(TEST_DIR), SESSION_ID)
    seedLegacyVotes("mesa_session_votes")

    // Trigger the migration.
    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, SESSION_ID)

    expect(tableExists("mesa_session_votes")).toBe(false)

    const entries = await readAuditLog()
    const exported = entries.filter((e) => e.action === "vote_exported")
    expect(exported).toHaveLength(2)
    const agents = exported.map((e) => (e.details as { agent_id: string }).agent_id).sort()
    expect(agents).toEqual(["design-1", "eng-1"])
    const disagree = exported.find(
      (e) => (e.details as { agent_id: string }).agent_id === "design-1"
    )
    expect((disagree!.details as { reason: string }).reason).toBe("disagree on persistence")
  })

  test("exports mesa_votes rows to the audit log, then drops the table", async () => {
    await fs.mkdir(join(TEST_DIR, PLUGIN_STATE_DIR), { recursive: true })
    await saveState(TEST_DIR, createInitialState(TEST_DIR), SESSION_ID)
    seedLegacyVotes("mesa_votes")

    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, SESSION_ID)

    expect(tableExists("mesa_votes")).toBe(false)

    const entries = await readAuditLog()
    const exported = entries.filter((e) => e.action === "vote_exported")
    expect(exported).toHaveLength(1)
    expect((exported[0].details as { vote: number }).vote).toBe(2)
  })

  test("fresh databases never see the votes tables (and nothing is exported)", async () => {
    await fs.mkdir(join(TEST_DIR, PLUGIN_STATE_DIR), { recursive: true })
    await saveState(TEST_DIR, createInitialState(TEST_DIR), SESSION_ID)

    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, SESSION_ID)

    expect(tableExists("mesa_votes")).toBe(false)
    expect(tableExists("mesa_session_votes")).toBe(false)
    const entries = await readAuditLog()
    expect(entries.filter((e) => e.action === "vote_exported")).toHaveLength(0)
  })
})

describe("v15 — analyses UNIQUE constraint includes round_id", () => {
  test("same agent + turn + turn_type persists in two different rounds", async () => {
    await fs.mkdir(join(TEST_DIR, PLUGIN_STATE_DIR), { recursive: true })
    const state = createInitialState(TEST_DIR)
    state.discussion.analyses = [
      { agentId: "eng-1", agentName: "Engineer", content: "r1 turn1", turn: 1, timestamp: new Date().toISOString(), roundId: "r1" },
      { agentId: "eng-1", agentName: "Engineer", content: "r2 turn1", turn: 1, timestamp: new Date().toISOString(), roundId: "r2" },
    ]
    await saveState(TEST_DIR, state, SESSION_ID)

    closeStorage(TEST_DIR)
    const loaded = await loadState(TEST_DIR, SESSION_ID)

    // Both rows survive a delete+reinsert cycle → constraint includes round_id.
    expect(loaded.discussion.analyses).toHaveLength(2)
    const byRound = loaded.discussion.analyses.map((a) => a.roundId).sort()
    expect(byRound).toEqual(["r1", "r2"])
  })
})

describe("v15 — idempotency", () => {
  test("running the migration twice is a no-op (single export, stable state)", async () => {
    await fs.mkdir(join(TEST_DIR, PLUGIN_STATE_DIR), { recursive: true })
    await saveState(TEST_DIR, createInitialState(TEST_DIR), SESSION_ID)
    seedLegacyVotes("mesa_session_votes")

    closeStorage(TEST_DIR)
    const first = await loadState(TEST_DIR, SESSION_ID)

    closeStorage(TEST_DIR)
    const second = await loadState(TEST_DIR, SESSION_ID)

    expect(second.rounds).toEqual(first.rounds)
    expect(second.deliverables).toEqual(first.deliverables)

    // Export happened exactly once (tables were dropped on the first pass).
    const entries = await readAuditLog()
    expect(entries.filter((e) => e.action === "vote_exported")).toHaveLength(2)
  })
})
