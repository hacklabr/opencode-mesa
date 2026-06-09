import { Database } from "bun:sqlite"
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { PLUGIN_STATE_DIR } from "../config"
import type { PhaseContextRecord, StateRepository } from "./state-repository"
import { PhaseContextSchema } from "./state-repository"

export class SqliteStateRepository implements StateRepository {
  private db: Database

  constructor(directory: string) {
    const stateDir = join(directory, PLUGIN_STATE_DIR)
    mkdirSync(stateDir, { recursive: true })
    const dbPath = join(stateDir, "state.db")
    this.db = new Database(dbPath, { create: true })
    this.db.run("PRAGMA foreign_keys = ON")
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA busy_timeout = 5000")
    this.db.run("PRAGMA synchronous = NORMAL")
    this.ensureTables()
  }

  private ensureTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS mesa_phase_context (
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        context_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, session_id, phase)
      )
    `)
  }

  async getPhaseContext(
    workspaceId: string,
    sessionId: string,
    phase: string
  ): Promise<PhaseContextRecord | null> {
    const row = this.db
      .query(
        "SELECT * FROM mesa_phase_context WHERE workspace_id = ? AND session_id = ? AND phase = ?"
      )
      .get(workspaceId, sessionId, phase) as Record<string, unknown> | null

    if (!row) return null

    const parsed = PhaseContextSchema.safeParse({
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      phase: row.phase,
      context: JSON.parse(row.context_json as string),
      schemaVersion: row.schema_version,
      updatedAt: row.updated_at,
    })

    if (!parsed.success) return null
    return parsed.data
  }

  async savePhaseContext(record: PhaseContextRecord): Promise<void> {
    const validated = PhaseContextSchema.parse(record)
    this.db.run(
      `INSERT OR REPLACE INTO mesa_phase_context (
        workspace_id, session_id, phase, context_json, schema_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        validated.workspaceId,
        validated.sessionId,
        validated.phase,
        JSON.stringify(validated.context),
        validated.schemaVersion,
        validated.updatedAt,
      ]
    )
  }

  async deletePhaseContext(
    workspaceId: string,
    sessionId: string,
    phase: string
  ): Promise<void> {
    this.db.run(
      "DELETE FROM mesa_phase_context WHERE workspace_id = ? AND session_id = ? AND phase = ?",
      [workspaceId, sessionId, phase]
    )
  }

  async listPhaseContexts(
    workspaceId: string,
    sessionId: string
  ): Promise<PhaseContextRecord[]> {
    const rows = this.db
      .query(
        "SELECT * FROM mesa_phase_context WHERE workspace_id = ? AND session_id = ? ORDER BY updated_at"
      )
      .all(workspaceId, sessionId) as Array<Record<string, unknown>>

    const results: PhaseContextRecord[] = []
    for (const row of rows) {
      const parsed = PhaseContextSchema.safeParse({
        workspaceId: row.workspace_id,
        sessionId: row.session_id,
        phase: row.phase,
        context: JSON.parse(row.context_json as string),
        schemaVersion: row.schema_version,
        updatedAt: row.updated_at,
      })
      if (parsed.success) {
        results.push(parsed.data)
      }
    }
    return results
  }

  close(): void {
    this.db.close()
  }
}
