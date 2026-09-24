import { openDatabase, type IDatabase } from "./db/driver.js"
import { mkdirSync, existsSync, readFileSync, renameSync, readdirSync, rmdirSync, appendFileSync } from "node:fs"
import { join, dirname, basename, isAbsolute } from "node:path"
import { hostname } from "node:os"
import { z, ZodError } from "zod"
import type { DiscussionState, AnalysisEntry, AnalysisKind, AnalysisTurnType, Round, Deliverable, PlanPointer } from "./types.js"
import { PLUGIN_STATE_DIR, CURRENT_STATE_VERSION, createInitialState } from "./config.js"
import { buildSessionFolderPath } from "./utils/paths.js"
import { reconcileMemories, purgeStaleMemoryFiles } from "./tools/memory-sync.js"
import { isV2Context } from "./utils/host.js"

// SDK client for parent session lookup (set from index.ts). Works with both
// hosts: V1 SDK clients and V2 plugin contexts.
type SessionGetter = (sessionId: string) => Promise<{ parentID?: string } | null>
let sessionGetter: SessionGetter | null = null

export function setStateSdkClient(client: unknown): void {
  if (isV2Context(client)) {
    const ctx = client as unknown as {
      session: { get: (input: { sessionID: string }) => Promise<{ parentID?: string } | undefined> }
    }
    if (typeof ctx.session?.get === "function") {
      sessionGetter = async (sessionId: string) => {
        try {
          return (await ctx.session.get({ sessionID: sessionId })) ?? null
        } catch {
          return null
        }
      }
    }
    return
  }

  const c = client as {
    session?: {
      get?: (opts: { path: { id: string } }) => Promise<{ data?: { parentID?: string } | null }>
    }
  } | null
  if (c?.session?.get) {
    sessionGetter = async (sessionId: string) => {
      try {
        const result = await c.session!.get!({ path: { id: sessionId } })
        return result?.data ?? null
      } catch {
        return null
      }
    }
  }
}

// Walk up the parent chain to find a session that has discussion state
export async function findRootSessionId(db: IDatabase, directory: string, sessionId: string): Promise<string | null> {
  // Only real OpenCode session IDs (ses_...) can be looked up via the SDK.
  // Test/placeholder IDs like "dummy" or "test-session" must short-circuit
  // to avoid SDK validation errors (e.g. "Expected a string starting with 'ses_',
  // got 'dummy'").
  if (!sessionId.startsWith("ses_")) return null

  let currentId = sessionId
  const visited = new Set<string>([sessionId]) // prevent cycles

  for (let i = 0; i < 10; i++) { // max depth 10
    if (!sessionGetter) break

    const sessionInfo = await sessionGetter(currentId)
    if (!sessionInfo?.parentID) break

    const parentId = sessionInfo.parentID
    if (visited.has(parentId)) break // cycle detected
    visited.add(parentId)

    // Check if parent has discussion state
    const hasState = db
      .query("SELECT session_id FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
      .get(directory, parentId)

    if (hasState) return parentId

    // Keep walking up
    currentId = parentId
  }

  return null
}

// ---------------------------------------------------------------------------
// Zod schemas (kept for JSON migration validation + future granular writers)
// ---------------------------------------------------------------------------

const DiscussionPhaseEnum = z.enum([
  "PLANNING",
  "DISCUSSION",
  "SPECIFICATION",
  "EXECUTION",
])

const DiscussionStatusEnum = z.enum(["active", "paused", "cancelled"])

const BriefingStatusEnum = z.enum(["draft", "approved", "delivered"])
const ScopeMagnitudeEnum = z.enum(["simple", "composite"])
const ScopeDimensionEnum = z.enum([
  "technical",
  "human-social",
  "cultural",
  "political",
  "economic",
  "educational",
  "behavioral",
])

const BriefingMetadataSchema = z.object({
  scopeMagnitude: ScopeMagnitudeEnum,
  classificationReason: z.string(),
  subAreas: z.array(z.string()).optional(),
  nonTechnicalDimensions: z.array(ScopeDimensionEnum),
  nonTechnicalFlag: z.boolean(),
})
const SpecialistStatusEnum = z.enum(["proposed", "summoned", "active", "dismissed", "delegated"])

const AnalysisTurnTypeEnum = z.enum(["analysis", "discussion"])

const AnalysisEntrySchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  content: z.string(),
  filePath: z.string().nullable().default(null),
  kind: z.enum(["full", "delta"]).default("full"),
  turn: z.number(),
  turnType: AnalysisTurnTypeEnum.default("analysis"),
  round: z.number().optional(),
  roundId: z.string().optional(),
  positionInTurn: z.number().optional(),
  respondsTo: z.string().optional(),
  tensionsRaised: z.array(z.string()).optional(),
  registeredByManager: z.boolean().optional(),
  sessionResumed: z.boolean().optional(),
  timestamp: z.string(),
})

// v14 (spec D2/D4) — round primitive, deliverables, plan pointer
const RoundOutcomeSchema = z.object({
  decision: z.enum(["converged", "converged-with-open-tensions", "escalated"]),
  summary: z.string(),
  tensions: z.array(z.string()).default([]),
  evidencePaths: z.array(z.string()).default([]),
  positions: z.record(z.string(), z.string()).default({}),
})
const RoundSchema = z.object({
  id: z.string(),
  topic: z.string(),
  participants: z.array(z.string()).default([]),
  status: z.enum(["open", "closed"]),
  openedAt: z.string(),
  closedAt: z.string().optional(),
  outcome: RoundOutcomeSchema.optional(),
})
const DeliverableSchema = z.object({
  path: z.string(),
  kind: z.string(),
  status: z.enum(["draft", "approved", "rejected"]),
  provenance: z.object({ roundIds: z.array(z.string()).default([]) }),
})
const PlanPointerSchema = z.object({
  path: z.string(),
  version: z.number(),
  status: z.enum(["draft", "approved"]),
  approvedAt: z.string().optional(),
})

const SpecialistEntrySchema = z.object({
  personaId: z.string(),
  name: z.string(),
  division: z.string(),
  status: SpecialistStatusEnum,
})

export const DiscussionStateSchema = z.object({
  workspaceId: z.string(),
  currentPhase: DiscussionPhaseEnum,
  status: DiscussionStatusEnum.default("active"),
  briefing: z.object({
    path: z.string().nullable(),
    status: BriefingStatusEnum,
    slug: z.string().nullable(),
    metadata: BriefingMetadataSchema.nullable().default(null),
  }),
  team: z.array(SpecialistEntrySchema),
  discussion: z.object({
    topic: z.string(),
    currentTurn: z.number(),
    maxTurns: z.number(),
    analyses: z.array(AnalysisEntrySchema),
    participants: z.array(z.string()).default([]),
  }),
  // v14 (spec D2/D4) — defaults keep legacy JSON states loadable
  rounds: z.array(RoundSchema).default([]),
  deliverables: z.array(DeliverableSchema).default([]),
  plan: PlanPointerSchema.nullable().default(null),
  sessionFolder: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  stateVersion: z.number().default(1),
})

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mesa_state (
  workspace_id TEXT PRIMARY KEY,
  current_phase TEXT NOT NULL DEFAULT 'PLANNING',
  previous_phase TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  briefing_path TEXT,
  briefing_status TEXT NOT NULL DEFAULT 'draft',
  briefing_slug TEXT,
  briefing_metadata TEXT,
  discussion_topic TEXT DEFAULT '',
  discussion_current_turn INTEGER DEFAULT 0,
  discussion_max_turns INTEGER DEFAULT 2,
  discussion_consensus_round INTEGER DEFAULT 0,
  discussion_debate_needed INTEGER DEFAULT 0,
  discussion_progress TEXT DEFAULT '{}',
  specification_path TEXT,
  specification_overview_path TEXT,
  specification_status TEXT DEFAULT 'pending',
  phases TEXT DEFAULT '["PLANNING","DISCUSSION","SPECIFICATION","EXECUTION"]',
  appendices TEXT DEFAULT '[]',
  journey_workshop TEXT DEFAULT '{"status":"not_started","detectedAt":"","signals":[],"suggestedJourneys":[],"confidence":"low"}',
  rigor TEXT DEFAULT 'standard',
  analysis_mode TEXT DEFAULT 'parallel',
  deviations INTEGER DEFAULT 0,
  rounds TEXT DEFAULT '[]',
  deliverables TEXT DEFAULT '[]',
  plan TEXT DEFAULT NULL,
  state_version INTEGER DEFAULT 5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mesa_team (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES mesa_state(workspace_id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL,
  name TEXT,
  division TEXT,
  status TEXT DEFAULT 'proposed',
  sort_order INTEGER DEFAULT 0,
  UNIQUE(workspace_id, persona_id)
);

CREATE TABLE IF NOT EXISTS mesa_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES mesa_state(workspace_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  content TEXT,
  turn INTEGER,
  timestamp TEXT,
  file_path TEXT,
  kind TEXT DEFAULT 'full',
  turn_type TEXT DEFAULT 'analysis',
  round INTEGER,
  round_id TEXT,
  position_in_turn INTEGER,
  responds_to TEXT,
  tensions_raised TEXT,
  session_resumed INTEGER,
  registered_by_manager INTEGER DEFAULT 0,
  UNIQUE(workspace_id, agent_id, turn, turn_type)
);
CREATE INDEX IF NOT EXISTS idx_analyses_turn ON mesa_analyses(workspace_id, turn);

CREATE TABLE IF NOT EXISTS mesa_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES mesa_state(workspace_id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(workspace_id, persona_id)
);

CREATE TABLE IF NOT EXISTS mesa_session (
  session_id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_heartbeat TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

-- Scoped session tables (multi-session support)
CREATE TABLE IF NOT EXISTS mesa_session_state (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  current_phase TEXT NOT NULL DEFAULT 'PLANNING',
  previous_phase TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  briefing_path TEXT,
  briefing_status TEXT NOT NULL DEFAULT 'draft',
  briefing_slug TEXT,
  briefing_metadata TEXT,
  discussion_topic TEXT DEFAULT '',
  discussion_current_turn INTEGER DEFAULT 0,
  discussion_max_turns INTEGER DEFAULT 2,
  discussion_consensus_round INTEGER DEFAULT 0,
  discussion_debate_needed INTEGER DEFAULT 0,
  discussion_progress TEXT DEFAULT '{}',
  specification_path TEXT,
  specification_overview_path TEXT,
  specification_status TEXT DEFAULT 'pending',
  phases TEXT DEFAULT '["PLANNING","DISCUSSION","SPECIFICATION","EXECUTION"]',
  appendices TEXT DEFAULT '[]',
  journey_workshop TEXT DEFAULT '{"status":"not_started","detectedAt":"","signals":[],"suggestedJourneys":[],"confidence":"low"}',
  rigor TEXT DEFAULT 'standard',
  analysis_mode TEXT DEFAULT 'parallel',
  deviations INTEGER DEFAULT 0,
  rounds TEXT DEFAULT '[]',
  deliverables TEXT DEFAULT '[]',
  plan TEXT DEFAULT NULL,
  session_folder TEXT,
  state_version INTEGER DEFAULT 5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);

CREATE TABLE IF NOT EXISTS mesa_session_team (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  name TEXT,
  division TEXT,
  status TEXT DEFAULT 'proposed',
  sort_order INTEGER DEFAULT 0,
  UNIQUE(workspace_id, session_id, persona_id)
);

CREATE TABLE IF NOT EXISTS mesa_session_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  content TEXT,
  turn INTEGER,
  timestamp TEXT,
  file_path TEXT,
  kind TEXT DEFAULT 'full',
  turn_type TEXT DEFAULT 'analysis',
  round INTEGER,
  round_id TEXT,
  position_in_turn INTEGER,
  responds_to TEXT,
  tensions_raised TEXT,
  session_resumed INTEGER,
  registered_by_manager INTEGER DEFAULT 0,
  UNIQUE(workspace_id, session_id, agent_id, turn, turn_type)
);
CREATE INDEX IF NOT EXISTS idx_session_analyses_turn ON mesa_session_analyses(workspace_id, session_id, turn);

CREATE TABLE IF NOT EXISTS mesa_session_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(workspace_id, session_id, persona_id)
);

CREATE TABLE IF NOT EXISTS mesa_phase_context (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  context_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, session_id, phase)
);
`

// ---------------------------------------------------------------------------
// Session management (per-directory)
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId: string
  directory: string
  timer: ReturnType<typeof setInterval> | null
}

const activeSessions = new Map<string, SessionState>()
const sessionLocks = new Map<string, Promise<string>>()

export function getSessionId(directory: string, opencodeSessionId?: string): string | undefined {
  if (opencodeSessionId) return opencodeSessionId
  const canonicalDir = join(directory, PLUGIN_STATE_DIR)
  return activeSessions.get(canonicalDir)?.sessionId
}

const HEARTBEAT_INTERVAL_MS = 15_000
const HEARTBEAT_STALE_THRESHOLD_MS = 90_000

function isSessionAlive(session: { pid: number; hostname: string; last_heartbeat: string }): boolean {
  // Heartbeat-only check — PID check is unreliable due to OS PID recycling.
  // A recycled PID belonging to an unrelated process would cause indefinite lockout.
  const elapsed = Date.now() - new Date(session.last_heartbeat).getTime()
  return elapsed < HEARTBEAT_STALE_THRESHOLD_MS
}

function updateHeartbeat(directory: string, sessionId: string): void {
  const db = getDb(directory)
  try {
    db.run(
      "UPDATE mesa_session SET last_heartbeat = ? WHERE session_id = ?",
      [new Date().toISOString(), sessionId]
    )
  } finally {
    db.close()
  }
}

function endSession(session: SessionState): void {
  const db = getDb(session.directory)
  try {
    db.run(
      "UPDATE mesa_session SET status = 'ending' WHERE session_id = ?",
      [session.sessionId]
    )
  } finally {
    db.close()
  }

  if (session.timer) {
    clearInterval(session.timer)
    session.timer = null
  }
}

async function initSession(directory: string): Promise<string> {
  const canonicalDir = join(directory, PLUGIN_STATE_DIR)
  const existing = activeSessions.get(canonicalDir)
  if (existing) return existing.sessionId

  const pending = sessionLocks.get(canonicalDir)
  if (pending) return pending

  const promise = (async () => {
    const db = getDb(directory)
    try {
      const tx = db.transaction(() => {
        const activeSessionsRows = db
          .query("SELECT session_id, pid, hostname, last_heartbeat FROM mesa_session WHERE status = 'active'")
          .all() as Array<{ session_id: string; pid: number; hostname: string; last_heartbeat: string }>

        for (const session of activeSessionsRows) {
          if (isSessionAlive(session)) {
            throw new Error(
              `Another Mesa session is active (session=${session.session_id}, pid=${session.pid}). ` +
              `Only one session per workspace is allowed.`
            )
          }
          db.run("UPDATE mesa_session SET status = 'superseded' WHERE session_id = ?", [session.session_id])
        }

        const sessionId = crypto.randomUUID()
        const now = new Date().toISOString()
        db.run(
          "INSERT INTO mesa_session (session_id, pid, hostname, started_at, last_heartbeat, status) VALUES (?, ?, ?, ?, ?, 'active')",
          [sessionId, process.pid, hostname(), now, now]
        )
        return sessionId
      })

      const sid = tx() as string

      const sessionState: SessionState = {
        sessionId: sid,
        directory,
        timer: setInterval(() => {
          try {
            updateHeartbeat(directory, sid)
          } catch {
            // heartbeat failures are non-fatal
          }
        }, HEARTBEAT_INTERVAL_MS),
      }

      if (sessionState.timer && typeof sessionState.timer === "object" && "unref" in sessionState.timer) {
        sessionState.timer.unref()
      }

      activeSessions.set(canonicalDir, sessionState)
      return sid
    } finally {
      db.close()
    }
  })()

  sessionLocks.set(canonicalDir, promise)

  try {
    return await promise
  } finally {
    sessionLocks.delete(canonicalDir)
  }
}

// ---------------------------------------------------------------------------
// JSON migration
// ---------------------------------------------------------------------------

function migrateFromJson(directory: string, db: IDatabase): void {
  const jsonPath = join(directory, PLUGIN_STATE_DIR, "state.json")
  if (!existsSync(jsonPath)) return

  const raw = readFileSync(jsonPath, "utf-8")
  const state = DiscussionStateSchema.parse(JSON.parse(raw)) as DiscussionState

  const wsId = state.workspaceId

  db.run(
    `INSERT OR REPLACE INTO mesa_state (
      workspace_id, current_phase, status,
      briefing_path, briefing_status, briefing_slug, briefing_metadata,
      discussion_topic, discussion_current_turn, discussion_max_turns,
      rounds, deliverables, plan,
      state_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      wsId, state.currentPhase, state.status ?? "active",
      state.briefing.path, state.briefing.status, state.briefing.slug,
      JSON.stringify(state.briefing.metadata ?? null),
      state.discussion.topic, state.discussion.currentTurn, state.discussion.maxTurns,
      JSON.stringify(state.rounds ?? []), JSON.stringify(state.deliverables ?? []),
      state.plan ? JSON.stringify(state.plan) : null,
      state.stateVersion, state.createdAt, state.updatedAt,
    ]
  )

  insertChildRows(db, wsId, state)

  renameSync(jsonPath, jsonPath + ".v1.bak")
}

function migrate_v1_to_v2(db: IDatabase): void {
  const tx = db.transaction(() => {
    // Create phase context sidecar table (idempotent)
    db.run(`
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

    // Add appendices column to mesa_state if not exists
    try {
      db.run("ALTER TABLE mesa_state ADD COLUMN appendices TEXT DEFAULT '[]'")
    } catch (e: unknown) {
      const err = e as Error
      if (!err.message.includes("duplicate column name")) throw e
    }

    // Add appendices column to mesa_session_state if not exists
    try {
      db.run("ALTER TABLE mesa_session_state ADD COLUMN appendices TEXT DEFAULT '[]'")
    } catch (e: unknown) {
      const err = e as Error
      if (!err.message.includes("duplicate column name")) throw e
    }

    // Bump state version for existing rows
    db.run("UPDATE mesa_state SET state_version = 2 WHERE state_version = 1")
    db.run("UPDATE mesa_session_state SET state_version = 2 WHERE state_version = 1")
  })
  tx()
}

function migrate_v2_to_v3(db: IDatabase): void {
  const tx = db.transaction(() => {
    const analysisCols: Array<[string, string]> = [
      ["file_path", "TEXT"],
      ["kind", "TEXT DEFAULT 'full'"],
      ["turn_type", "TEXT DEFAULT 'analysis'"],
      ["round", "INTEGER"],
      ["position_in_turn", "INTEGER"],
      ["responds_to", "TEXT"],
      ["tensions_raised", "TEXT"],
      ["session_resumed", "INTEGER"],
    ]

    // Add new analysis columns to both unscoped and session-scoped tables
    for (const table of ["mesa_analyses", "mesa_session_analyses"]) {
      for (const [col, def] of analysisCols) {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
        } catch (e: unknown) {
          const err = e as Error
          if (!err.message.includes("duplicate column name")) throw e
        }
      }
    }

    // Add mode + max_consensus_rounds to state tables
    const stateCols: Array<[string, string]> = [
      ["discussion_mode", "TEXT DEFAULT 'analysis'"],
      ["discussion_max_consensus_rounds", "INTEGER DEFAULT 2"],
    ]
    for (const table of ["mesa_state", "mesa_session_state"]) {
      for (const [col, def] of stateCols) {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
        } catch (e: unknown) {
          const err = e as Error
          if (!err.message.includes("duplicate column name")) throw e
        }
      }
    }

    // Bump state version
    db.run("UPDATE mesa_state SET state_version = 3 WHERE state_version = 2")
    db.run("UPDATE mesa_session_state SET state_version = 3 WHERE state_version = 2")
  })
  tx()
}

function migrate_v3_to_v4(db: IDatabase): void {
  const tx = db.transaction(() => {
    // Governance columns (spec-4dcc492f): rigor, analysis_mode, deviations
    const stateCols: Array<[string, string]> = [
      ["rigor", "TEXT DEFAULT 'standard'"],
      ["analysis_mode", "TEXT DEFAULT 'parallel'"],
      ["deviations", "INTEGER DEFAULT 0"],
    ]
    for (const table of ["mesa_state", "mesa_session_state"]) {
      for (const [col, def] of stateCols) {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
        } catch (e: unknown) {
          const err = e as Error
          if (!err.message.includes("duplicate column name")) throw e
        }
      }
    }

    // Bump state version
    db.run("UPDATE mesa_state SET state_version = 4 WHERE state_version = 3")
    db.run("UPDATE mesa_session_state SET state_version = 4 WHERE state_version = 3")
  })
  tx()
}

/**
 * v4 → v5: Phase enum collapse 8→4 (spec-4dcc492f, Decision 3).
 *
 * PAUSED/CANCELLED lifted into the orthogonal `status` field; ANALYSIS/CONSENSUS
 * merged into DISCUSSION (sub-state lives in discussion.mode); DOCUMENTATION/APPROVAL
 * merged into SPECIFICATION. Adds `status` and `discussion_progress` columns and
 * rewrites stored phase values + the `phases` config array.
 */
function migrate_v4_to_v5(db: IDatabase): void {
  const tx = db.transaction(() => {
    // 1. Add the new orthogonal columns to both state tables.
    for (const table of ["mesa_state", "mesa_session_state"]) {
      for (const [col, def] of [
        ["status", "TEXT NOT NULL DEFAULT 'active'"],
        ["discussion_progress", "TEXT DEFAULT '{}'"],
      ] as Array<[string, string]>) {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
        } catch (e: unknown) {
          const err = e as Error
          if (!err.message.includes("duplicate column name")) throw e
        }
      }
    }

    // 2. PAUSED/CANCELLED → orthogonal status. The phase they displaced is
    //    recovered from previous_phase (set on pause); fall back to PLANNING.
    for (const table of ["mesa_state", "mesa_session_state"]) {
      db.run(
        `UPDATE ${table} SET status = 'paused',
          current_phase = COALESCE(previous_phase, 'PLANNING')
         WHERE current_phase = 'PAUSED'`
      )
      db.run(
        `UPDATE ${table} SET status = 'cancelled',
          current_phase = COALESCE(previous_phase, 'PLANNING')
         WHERE current_phase = 'CANCELLED'`
      )
    }

    // 3. Carry CONSENSUS semantics into discussion.mode BEFORE merging the phase.
    //    A row still in CONSENSUS was mid-vote, so its sub-state becomes "voting".
    for (const table of ["mesa_state", "mesa_session_state"]) {
      db.run(
        `UPDATE ${table} SET discussion_mode = 'voting' WHERE current_phase = 'CONSENSUS'`
      )
    }

    // 4. Merge the phases per the collapse mapping.
    for (const table of ["mesa_state", "mesa_session_state"]) {
      db.run(
        `UPDATE ${table} SET current_phase = 'DISCUSSION'
         WHERE current_phase IN ('ANALYSIS', 'CONSENSUS')`
      )
      db.run(
        `UPDATE ${table} SET current_phase = 'SPECIFICATION'
         WHERE current_phase IN ('DOCUMENTATION', 'APPROVAL')`
      )
      // previous_phase may also hold legacy values.
      db.run(
        `UPDATE ${table} SET previous_phase = 'DISCUSSION'
         WHERE previous_phase IN ('ANALYSIS', 'CONSENSUS')`
      )
      db.run(
        `UPDATE ${table} SET previous_phase = 'SPECIFICATION'
         WHERE previous_phase IN ('DOCUMENTATION', 'APPROVAL')`
      )
      db.run(
        `UPDATE ${table} SET previous_phase = NULL
         WHERE previous_phase IN ('PAUSED', 'CANCELLED')`
      )
    }

    // 5. Rewrite the `phases` config array. Only rows still carrying the legacy
    //    default (contains "ANALYSIS") are reset — user customizations are kept.
    for (const table of ["mesa_state", "mesa_session_state"]) {
      db.run(
        `UPDATE ${table} SET phases = '["PLANNING","DISCUSSION","SPECIFICATION","EXECUTION"]'
         WHERE phases LIKE '%ANALYSIS%'`
      )
    }

    // 6. Bump state version.
    db.run("UPDATE mesa_state SET state_version = 5 WHERE state_version = 4")
    db.run("UPDATE mesa_session_state SET state_version = 5 WHERE state_version = 4")
  })
  tx()
}

function migrate_v5_to_v6(db: IDatabase): void {
  // Recreate analyses tables with turn_type in UNIQUE constraint.
  // SQLite cannot ALTER constraints — must use table recreation pattern.
  const tx = db.transaction(() => {
    for (const table of ["mesa_analyses", "mesa_session_analyses"]) {
      // Check if the table exists and has the old constraint.
      // Idempotency: if turn_type already exists, the migration already ran.
      const tableInfo = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (tableInfo.length === 0) continue
      if (tableInfo.some((col) => col.name === "turn_type")) continue

      const isScoped = table === "mesa_session_analyses"
      const cols = isScoped
        ? "id, workspace_id, session_id, agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, position_in_turn, responds_to, tensions_raised, session_resumed"
        : "id, workspace_id, agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, position_in_turn, responds_to, tensions_raised, session_resumed"

      // Fill NULL turn_type for existing rows
      db.run(`UPDATE ${table} SET turn_type = 'analysis' WHERE turn_type IS NULL`)

      const tempName = `${table}__v6_new`
      db.exec(`DROP TABLE IF EXISTS ${tempName}`)

      if (isScoped) {
        db.exec(`CREATE TABLE ${tempName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          agent_name TEXT,
          content TEXT,
          turn INTEGER,
          timestamp TEXT,
          file_path TEXT,
          kind TEXT DEFAULT 'full',
          turn_type TEXT DEFAULT 'analysis',
          round INTEGER,
          position_in_turn INTEGER,
          responds_to TEXT,
          tensions_raised TEXT,
          session_resumed INTEGER,
          UNIQUE(workspace_id, session_id, agent_id, turn, turn_type)
        )`)
      } else {
        db.exec(`CREATE TABLE ${tempName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          agent_name TEXT,
          content TEXT,
          turn INTEGER,
          timestamp TEXT,
          file_path TEXT,
          kind TEXT DEFAULT 'full',
          turn_type TEXT DEFAULT 'analysis',
          round INTEGER,
          position_in_turn INTEGER,
          responds_to TEXT,
          tensions_raised TEXT,
          session_resumed INTEGER,
          UNIQUE(workspace_id, agent_id, turn, turn_type)
        )`)
      }

      db.run(`INSERT INTO ${tempName} (${cols}) SELECT ${cols} FROM ${table}`)
      db.exec(`DROP TABLE ${table}`)
      db.exec(`ALTER TABLE ${tempName} RENAME TO ${table}`)

      // Recreate index
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_turn ON ${table}(workspace_id, turn)`)
    }

    db.run("UPDATE mesa_state SET state_version = 6 WHERE state_version = 5")
    db.run("UPDATE mesa_session_state SET state_version = 6 WHERE state_version = 5")
  })
  tx()
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function migrate_v6_to_v7(db: IDatabase): void {
  const tx = db.transaction(() => {
    for (const table of ["mesa_state", "mesa_session_state"]) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN specification_overview_path TEXT`)
      } catch (e: unknown) {
        const err = e as Error
        if (!err.message.includes("duplicate column name")) throw e
      }
    }

    db.run("UPDATE mesa_state SET state_version = 7 WHERE state_version = 6")
    db.run("UPDATE mesa_session_state SET state_version = 7 WHERE state_version = 6")
  })
  tx()
}

/**
 * v7 → v8: Briefing metadata for adaptive scope calibration (spec-fb0ba2d7, Decision 5).
 *
 * Adds `briefing_metadata` as a JSON-encoded TEXT column to both state tables,
 * mirroring the `discussion_progress` pattern. Existing rows get NULL (no metadata)
 * — legacy briefings load with `metadata: null`, treated as composite-default by
 * downstream consumers.
 */
function migrate_v7_to_v8(db: IDatabase): void {
  const tx = db.transaction(() => {
    for (const table of ["mesa_state", "mesa_session_state"]) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN briefing_metadata TEXT`)
      } catch (e: unknown) {
        const err = e as Error
        if (!err.message.includes("duplicate column name")) throw e
      }
    }

    db.run("UPDATE mesa_state SET state_version = 8 WHERE state_version = 7")
    db.run("UPDATE mesa_session_state SET state_version = 8 WHERE state_version = 7")
  })
  tx()
}

/**
 * v8 → v9: Memory system table (spec-7ba9841f, D2).
 *
 * Creates the `mesa_memory` table for cross-session knowledge persistence.
 * Follows the established pattern: idempotent CREATE TABLE, indexes, and
 * state_version bump on both state tables.
 */
function migrate_v8_to_v9(db: IDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mesa_memory (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id    TEXT NOT NULL,
      scope           TEXT NOT NULL DEFAULT 'project'
                       CHECK(scope IN ('project', 'global')),
      category        TEXT NOT NULL DEFAULT 'observation'
                       CHECK(category IN (
                         'lesson', 'observation', 'preference',
                         'architecture', 'pitfall', 'convention'
                       )),
      content         TEXT NOT NULL,
      source_agent    TEXT NOT NULL,
      source_session  TEXT,
      access_count    INTEGER NOT NULL DEFAULT 0,
      last_accessed   TEXT,
      relevance_score REAL DEFAULT 1.0,
      expires_at      TEXT,
      status          TEXT NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active', 'deleted')),
      content_hash    TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      UNIQUE(workspace_id, scope, category, source_agent, content_hash)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_workspace_active ON mesa_memory(workspace_id, status, category, relevance_score DESC)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_access_rank ON mesa_memory(workspace_id, access_count DESC, updated_at DESC)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_source_agent ON mesa_memory(source_agent, workspace_id)`)
}

/**
 * v9 → v10: User journey design-thinking workshop gate.
 *
 * Adds `journey_workshop` as a JSON-encoded TEXT column to both state tables.
 * Existing rows get a default "not_started" workshop so the Manager can run
 * the detection gate on legacy discussions.
 */
function migrate_v9_to_v10(db: IDatabase): void {
  const tx = db.transaction(() => {
    const defaultWorkshop = JSON.stringify({
      status: "not_started",
      detectedAt: new Date().toISOString(),
      signals: [],
      suggestedJourneys: [],
      confidence: "low",
    })
    for (const table of ["mesa_state", "mesa_session_state"]) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN journey_workshop TEXT DEFAULT '${defaultWorkshop.replace(/'/g, "''")}'`)
      } catch (e: unknown) {
        const err = e as Error
        if (!err.message.includes("duplicate column name")) throw e
      }
      db.run(`UPDATE ${table} SET journey_workshop = COALESCE(journey_workshop, '${defaultWorkshop.replace(/'/g, "''")}') WHERE journey_workshop IS NULL`)
    }

    db.run("UPDATE mesa_state SET state_version = 10 WHERE state_version = 9")
    db.run("UPDATE mesa_session_state SET state_version = 10 WHERE state_version = 9")
  })
  tx()
}

/**
 * v10 → v11: Session-scoped folder layout (spec-6886df4f).
 *
 * Adds the `session_folder` TEXT column to `mesa_session_state` so the
 * computed folder path can be cached after the first resolution. This is
 * a schema-only step — the accompanying file relocation runs immediately
 * after in `migrateFiles_v10_to_v11` (TD5).
 */
function migrate_v10_to_v11(db: IDatabase): void {
  const tx = db.transaction(() => {
    // Only the session-scoped table needs session_folder — mesa_state is
    // legacy/unscoped and not part of the new layout.
    try {
      db.run(`ALTER TABLE mesa_session_state ADD COLUMN session_folder TEXT`)
    } catch (e: unknown) {
      const err = e as Error
      if (!err.message.includes("duplicate column name")) throw e
    }

    db.run("UPDATE mesa_session_state SET state_version = 11 WHERE state_version = 10")
  })
  tx()
}

/**
 * v11 → v12: adds registered_by_manager flag to mesa_analyses.
 *
 * When a specialist fails to self-register, the Manager may record the
 * analysis on its behalf. This column flags those fallback entries so
 * ask_peer does not route questions to the Manager session instead of the
 * specialist session.
 */
function migrate_v11_to_v12(db: IDatabase): void {
  const tx = db.transaction(() => {
    for (const table of ["mesa_analyses", "mesa_session_analyses"]) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN registered_by_manager INTEGER DEFAULT 0`)
      } catch (e: unknown) {
        const err = e as Error
        if (!err.message.includes("duplicate column name")) throw e
      }
    }

    db.run("UPDATE mesa_state SET state_version = 12 WHERE state_version = 11")
    db.run("UPDATE mesa_session_state SET state_version = 12 WHERE state_version = 11")
  })
  tx()
}

/**
 * v12 → v13: Memory replica sync (project-scope Markdown files).
 *
 * Adds `synced_at` TEXT column to `mesa_memory` for observability of the
 * bidirectional reconciliation between SQLite and `.mesa/memories/` Markdown
 * files. Creates a covering index for the new project-scope dedup query that
 * ignores `source_agent`.
 */
function migrate_v12_to_v13(db: IDatabase): void {
  try {
    db.run("ALTER TABLE mesa_memory ADD COLUMN synced_at TEXT")
  } catch (e: unknown) {
    const err = e as Error
    if (!err.message.includes("duplicate column name")) throw e
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_project_dedup ON mesa_memory(workspace_id, scope, category, content_hash)")
}

/**
 * v13 → v14: Round primitive + deliverables + plan pointer (spec D2/D4/D9).
 *
 * ADDITIVE and IDEMPOTENT. Adds `rounds`/`deliverables`/`plan` JSON columns
 * to both state tables and `round_id` to both analyses tables, then backfills:
 *  - sessions with legacy analyses get a synthetic closed round
 *    `legacy-round-1` (participants from the participants table, topic from
 *    discussion_topic), and their analyses get round_id backfilled;
 *  - sessions with a legacy specification_path get a Deliverable
 *    (kind "specification"; legacy status "pending" maps to "draft").
 *
 * Legacy fields (discussion_*, specification_*, journey_workshop, appendices,
 * phases) are NOT dropped — their consumers die in Phase 2. Re-running is a
 * no-op: backfill only touches rows whose rounds/deliverables are still empty.
 *
 * TODO(Phase 2/5): mesa_votes / mesa_session_votes outlive this migration
 * because their consumer (request_consensus) only dies in Phase 2. The drop
 * plan: (1) export all vote rows to the audit log as `votes_exported` entries
 * (preserves the deliberation trail), (2) DROP both tables, (3) remove the
 * votes fields from DiscussionState + insert/load helpers. Do NOT drop the
 * tables before the export ships — votes are the only record of legacy
 * consensus outcomes.
 *
 * KNOWN LIMITATION (pre-v11 rows only): this backfill runs BEFORE
 * migrateFiles_v10_to_v11 in the getDb pipeline, so for the tiny set of
 * sessions that never went through the v10→v11 file relocation AND whose
 * spec file still exists, deliverable.path captures the PRE-relocation
 * location (the file is then moved to {sessionFolder}/specification.md).
 * Sessions already at v11+ (session_folder set — the common case) are
 * unaffected. The legacy specification_path column remains readable as the
 * authoritative reference until Phase 2, and Phase 5 cleanup should reconcile
 * any stale deliverable.path for pre-v11 rows.
 */
function migrate_v13_to_v14(db: IDatabase): void {
  const tx = db.transaction(() => {
    // 1. Additive columns (idempotent duplicate-column pattern).
    for (const table of ["mesa_state", "mesa_session_state"]) {
      for (const [col, def] of [
        ["rounds", "TEXT DEFAULT '[]'"],
        ["deliverables", "TEXT DEFAULT '[]'"],
        ["plan", "TEXT DEFAULT NULL"],
      ] as Array<[string, string]>) {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
        } catch (e: unknown) {
          const err = e as Error
          if (!err.message.includes("duplicate column name")) throw e
        }
      }
    }
    for (const table of ["mesa_analyses", "mesa_session_analyses"]) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN round_id TEXT`)
      } catch (e: unknown) {
        const err = e as Error
        if (!err.message.includes("duplicate column name")) throw e
      }
    }

    // 2. Backfill rounds + deliverables for legacy sessions.
    backfillV14(db, false) // unscoped legacy tables
    backfillV14(db, true)  // session-scoped tables (the live ones)

    // 3. Bump state version. Existing rows may sit at 12 (v12→v13 did not
    //    bump state tables), so cover any value below 14.
    db.run("UPDATE mesa_state SET state_version = 14 WHERE state_version < 14")
    db.run("UPDATE mesa_session_state SET state_version = 14 WHERE state_version < 14")
  })
  tx()
}

const LEGACY_ROUND_ID = "legacy-round-1"

/**
 * Per-table backfill for migrate_v13_to_v14. `scoped` selects the
 * session-scoped tables (live) vs the unscoped legacy tables (JSON-migration
 * path). Idempotent: rows with non-empty rounds/deliverables are skipped.
 */
function backfillV14(db: IDatabase, scoped: boolean): void {
  const stateTable = scoped ? "mesa_session_state" : "mesa_state"
  const analysesTable = scoped ? "mesa_session_analyses" : "mesa_analyses"
  const participantsTable = scoped ? "mesa_session_participants" : "mesa_participants"
  const scopeCols = scoped ? "workspace_id, session_id" : "workspace_id"

  const rows = db
    .query(`SELECT ${scopeCols}, discussion_topic, specification_path, specification_status, rounds, deliverables, created_at, updated_at FROM ${stateTable}`)
    .all() as Array<Record<string, unknown>>

  for (const row of rows) {
    const wsId = row.workspace_id as string
    const sid = scoped ? (row.session_id as string) : null
    const whereScope = scoped
      ? "workspace_id = ? AND session_id = ?"
      : "workspace_id = ?"
    const scopeArgs: string[] = scoped ? [wsId, sid!] : [wsId]

    // --- rounds backfill ---
    const roundsRaw = (row.rounds as string | null) ?? "[]"
    if (roundsRaw === "[]") {
      const analysisCount = db
        .query(`SELECT COUNT(*) AS c FROM ${analysesTable} WHERE ${whereScope}`)
        .get(...scopeArgs) as { c: number }

      if (analysisCount.c > 0) {
        const participants = (
          db
            .query(`SELECT persona_id FROM ${participantsTable} WHERE ${whereScope} ORDER BY sort_order`)
            .all(...scopeArgs) as Array<{ persona_id: string }>
        ).map((p) => p.persona_id)

        const legacyRound: Round = {
          id: LEGACY_ROUND_ID,
          topic: (row.discussion_topic as string) || "Legacy discussion",
          participants,
          status: "closed",
          openedAt: row.created_at as string,
          closedAt: row.updated_at as string,
        }

        db.run(
          `UPDATE ${stateTable} SET rounds = ? WHERE ${whereScope}`,
          [JSON.stringify([legacyRound]), ...scopeArgs]
        )
        db.run(
          `UPDATE ${analysesTable} SET round_id = ? WHERE ${whereScope} AND round_id IS NULL`,
          [LEGACY_ROUND_ID, ...scopeArgs]
        )
      }
    }

    // --- deliverables backfill ---
    const deliverablesRaw = (row.deliverables as string | null) ?? "[]"
    const specPath = row.specification_path as string | null
    if (deliverablesRaw === "[]" && specPath) {
      const specStatus = row.specification_status as string | null
      const status: Deliverable["status"] =
        specStatus === "approved" ? "approved" : specStatus === "rejected" ? "rejected" : "draft"

      // Provenance: every round recorded for this session (post-backfill).
      const roundsJson = (db
        .query(`SELECT rounds FROM ${stateTable} WHERE ${whereScope}`)
        .get(...scopeArgs) as { rounds: string | null }).rounds ?? "[]"
      let roundIds: string[] = []
      try {
        const parsed = JSON.parse(roundsJson) as Array<{ id: string }>
        if (Array.isArray(parsed)) roundIds = parsed.map((r) => r.id)
      } catch {
        // malformed rounds JSON — leave provenance empty
      }

      const deliverable: Deliverable = {
        path: specPath,
        kind: "specification",
        status,
        provenance: { roundIds },
      }
      db.run(
        `UPDATE ${stateTable} SET deliverables = ? WHERE ${whereScope}`,
        [JSON.stringify([deliverable]), ...scopeArgs]
      )
    }
  }
}

/**
 * v14 → v15: kernel cleanup (spec D5/D6/D9).
 *
 * 1. VOTES EXPORT + DROP: mesa_votes / mesa_session_votes rows are exported
 *    to `.mesa/audit.log` as `vote_exported` entries (preserves the
 *    deliberation trail) BEFORE the tables are dropped. The votes' consumer
 *    (request_consensus) died with the recipe-tool purge.
 * 2. ANALYSES UNIQUE CONSTRAINT: recreated to include round_id —
 *    `UNIQUE(..., agent_id, turn, turn_type)` made multi-round registration
 *    impossible (same agent + turn 1 in r1 and r2 collided). NULL round_id
 *    backfilled to 'legacy-round-1' first so the constraint is meaningful.
 * 3. Version bump → 15.
 *
 * Idempotent: votes export only runs when the tables still exist; the
 * analyses recreation is detected via the table SQL containing the new
 * constraint; both are no-ops on re-run.
 */
function migrate_v14_to_v15(db: IDatabase, directory: string): void {
  const tx = db.transaction(() => {
    // 1. Votes: export then drop.
    for (const table of ["mesa_votes", "mesa_session_votes"]) {
      const exists = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table)
      if (!exists) continue

      const rows = db.query(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
      if (rows.length > 0) {
        const logPath = join(directory, PLUGIN_STATE_DIR, "audit.log")
        for (const row of rows) {
          appendFileSync(
            logPath,
            JSON.stringify({
              timestamp: new Date().toISOString(),
              action: "vote_exported",
              phase: "MIGRATION",
              details: row,
            }) + "\n",
            "utf-8"
          )
        }
      }
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }

    // 2. Analyses: recreate with round_id in the UNIQUE constraint.
    for (const table of ["mesa_analyses", "mesa_session_analyses"]) {
      const sqlRow = db
        .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { sql: string } | null
      if (!sqlRow) continue
      if (sqlRow.sql.includes("turn_type, round_id")) continue // already migrated

      // Ensure round_id exists (v14 added it; defensive for odd histories).
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN round_id TEXT`)
      } catch (e: unknown) {
        const err = e as Error
        if (!err.message.includes("duplicate column name")) throw e
      }
      db.run(`UPDATE ${table} SET round_id = 'legacy-round-1' WHERE round_id IS NULL`)

      const isScoped = table === "mesa_session_analyses"
      const scopedCols = isScoped ? "session_id TEXT NOT NULL," : ""
      const uniqueCols = isScoped
        ? "UNIQUE(workspace_id, session_id, agent_id, turn, turn_type, round_id)"
        : "UNIQUE(workspace_id, agent_id, turn, turn_type, round_id)"
      const allCols =
        "id, workspace_id, " + (isScoped ? "session_id, " : "") +
        "agent_id, agent_name, content, turn, timestamp, file_path, kind, " +
        "turn_type, round, round_id, position_in_turn, responds_to, " +
        "tensions_raised, session_resumed, registered_by_manager"

      const tempName = `${table}__v15_new`
      db.exec(`DROP TABLE IF EXISTS ${tempName}`)
      db.exec(`CREATE TABLE ${tempName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        ${scopedCols}
        agent_id TEXT NOT NULL,
        agent_name TEXT,
        content TEXT,
        turn INTEGER,
        timestamp TEXT,
        file_path TEXT,
        kind TEXT DEFAULT 'full',
        turn_type TEXT DEFAULT 'analysis',
        round INTEGER,
        round_id TEXT,
        position_in_turn INTEGER,
        responds_to TEXT,
        tensions_raised TEXT,
        session_resumed INTEGER,
        registered_by_manager INTEGER DEFAULT 0,
        ${uniqueCols}
      )`)

      db.run(`INSERT INTO ${tempName} (${allCols}) SELECT ${allCols} FROM ${table}`)
      db.exec(`DROP TABLE ${table}`)
      db.exec(`ALTER TABLE ${tempName} RENAME TO ${table}`)
      db.exec(
        isScoped
          ? `CREATE INDEX IF NOT EXISTS idx_session_analyses_turn ON ${table}(workspace_id, session_id, turn)`
          : `CREATE INDEX IF NOT EXISTS idx_analyses_turn ON ${table}(workspace_id, turn)`
      )
    }

    // 3. Version bump.
    db.run("UPDATE mesa_state SET state_version = 15 WHERE state_version < 15")
    db.run("UPDATE mesa_session_state SET state_version = 15 WHERE state_version < 15")
  })
  tx()
}

/**
 * v10 → v11 file relocation (spec-6886df4f, TD5).
 *
 * Moves session artifacts from the legacy scattered layout into the
 * session-scoped folder structure (`.mesa/sessions/{folder}/`). Runs
 * AFTER the `migrate_v10_to_v11` schema migration (which adds the
 * `session_folder` column) and BEFORE `migrateFromJson`.
 *
 * IDEMPOTENCY: the per-session checkpoint skips any session whose
 * `briefing.md` already exists in the computed target folder. Each
 * artifact move is also individually idempotent (target-exists check).
 * Re-running the migrator is a safe no-op.
 *
 * Legacy directories (`.mesa/briefings/`, `.mesa/specifications/`,
 * `.mesa/especificacoes/`, flat `analyses/turn{N}/`, root
 * `briefing-current-*.md`, etc.) are moved to `.mesa/_archive/` after
 * all sessions have been migrated.
 *
 * All errors are logged to stderr and swallowed — a missing source file
 * MUST NOT abort the migration. The DB path columns are updated to
 * workspace-RELATIVE paths (e.g. `.mesa/sessions/{folder}/briefing.md`).
 */
function migrateFiles_v10_to_v11(directory: string, db: IDatabase): void {
  const rows = db
    .query(
      "SELECT session_id, briefing_slug, briefing_path, specification_path, " +
      "specification_overview_path, appendices, session_folder, created_at " +
      "FROM mesa_session_state WHERE workspace_id = ?"
    )
    .all(directory) as Array<{
      session_id: string
      briefing_slug: string | null
      briefing_path: string | null
      specification_path: string | null
      specification_overview_path: string | null
      appendices: string | null
      session_folder: string | null
      created_at: string
    }>

  // If there are no sessions in the DB, skip everything. This prevents
  // the migrator from archiving files that test fixtures (or the current
  // session) are still actively writing to legacy locations.
  if (rows.length === 0) {
    return
  }

  // Migrate each session that hasn't been processed yet (session_folder
  // is null). Sessions with session_folder already set are skipped.
  let migratedCount = 0
  for (const row of rows) {
    if (row.session_folder !== null) continue
    try {
      migrateSessionArtifacts(directory, db, row)
      migratedCount++
    } catch (e) {
      console.error(
        `[Mesa migration] Failed to migrate session ${row.session_id}:`,
        (e as Error).message
      )
    }
  }

  // Mark this directory as having had migration run in this process.
  // This prevents archival from running in the same process that did
  // the initial migration. Archival is deferred to the NEXT process
  // start (e.g., next time the workspace is opened), ensuring files
  // the current process is actively using are not archived prematurely.
  if (migratedCount > 0) {
    migratedInProcess.add(directory)
  }

  // Only archive legacy structures when:
  // 1. No migration was performed in THIS process for this directory
  //    (initial migration was completed on a previous process start), AND
  // 2. Archival hasn't already run for this directory in this process.
  if (
    !migratedInProcess.has(directory) &&
    !archivedDirectories.has(directory)
  ) {
    archivedDirectories.add(directory)
    try {
      archiveLegacyStructures(directory)
    } catch (e) {
      console.error(
        "[Mesa migration] Legacy archival failed:",
        (e as Error).message
      )
    }
  }
}

/**
 * Directories that had at least one session migrated in this process.
 * Prevents archival from running in the same process — archival is
 * deferred to the next process start.
 */
const migratedInProcess = new Set<string>()

/**
 * Directories that have already been archived in this process.
 * Prevents the archival from running on every getDb() call.
 */
const archivedDirectories = new Set<string>()

/**
 * Resolve `mesa_session.started_at` for a session, falling back to the
 * state row's `created_at` when the session row is missing (e.g. JSON
 * migration path). Decision M2: started_at is authoritative.
 */
function resolveStartedAt(db: IDatabase, sessionId: string, fallback: string): string {
  const row = db
    .query("SELECT started_at FROM mesa_session WHERE session_id = ?")
    .get(sessionId) as { started_at: string } | null
  return row?.started_at ?? fallback
}

/**
 * Extract the 8-hex master spec ID from a legacy specification path
 * like `.../specifications/spec-1764227a.md`. Returns null when the
 * path doesn't match the legacy pattern (already migrated, or absent).
 */
function extractMasterSpecId(specPath: string | null): string | null {
  if (!specPath) return null
  const m = specPath.match(/spec-([a-f0-9]{8})\.md$/)
  return m ? m[1] : null
}

/**
 * Move a single artifact file (briefing/spec/overview) from its legacy
 * location to `{targetFolder}/{targetName}`. Returns the path that
 * should be stored in the DB after migration.
 *
 * Behavior:
 *  - sourcePath is null      → return null (nothing to migrate)
 *  - target already exists   → return relative target (idempotent)
 *  - source exists           → atomic rename, return relative target
 *  - neither exists          → return null (file is gone, no path to store)
 *
 * Returning null for a missing file keeps the state clean: consumers
 * read `state.briefing.path === null` as "no briefing file" rather than
 * trying to open a stale path. The session is still marked as migrated
 * via `session_folder` so the migrator does not retry on every DB open.
 *
 * Source may be stored as ABSOLUTE or RELATIVE — both are resolved
 * against `directory`.
 */
function migrateArtifactFile(
  directory: string,
  targetFolder: string,
  targetName: string,
  sourcePath: string | null
): string | null {
  if (!sourcePath) return null

  const targetRel = join(targetFolder, targetName)
  const targetAbs = join(directory, targetRel)

  if (existsSync(targetAbs)) {
    return targetRel
  }

  const sourceAbs = isAbsolute(sourcePath) ? sourcePath : join(directory, sourcePath)

  if (existsSync(sourceAbs)) {
    try {
      renameSync(sourceAbs, targetAbs)
    } catch (e) {
      console.error(
        `[Mesa migration] rename failed for ${targetName}: ${sourceAbs} → ${targetAbs}:`,
        (e as Error).message
      )
      return sourcePath
    }
    return targetRel
  }

  console.log(
    `[Mesa migration] Source not found for ${targetName}: ${sourceAbs} (setting path to null)`
  )
  return null
}

/**
 * Move all analysis files for a session into the session folder.
 *
 * The legacy layout used inconsistent directory naming:
 *  - UUID sessions:     `.mesa/analyses/{sessionId}/turn{N}/{personaId}.md`
 *  - `ses_` sessions:   `.mesa/analyses/ses_{short}_{personaId}/turn{N}/{personaId}.md`
 *                       (one dir per persona — does NOT match session_id)
 *
 * To handle both, we iterate per-row over `mesa_session_analyses`,
 * extract the subpath after `{analyses}/{dirName}/` (e.g.
 * `turn1/persona.md`), and relocate the file to
 * `{targetFolder}/analyses/{subpath}`. The `file_path` column is
 * rewritten to the new relative path.
 */
function migrateAnalyses(
  directory: string,
  db: IDatabase,
  sessionId: string,
  targetFolder: string
): void {
  const rows = db
    .query(
      "SELECT id, file_path FROM mesa_session_analyses " +
      "WHERE workspace_id = ? AND session_id = ? AND file_path IS NOT NULL"
    )
    .all(directory, sessionId) as Array<{ id: number; file_path: string }>

  for (const row of rows) {
    const sourceAbs = isAbsolute(row.file_path)
      ? row.file_path
      : join(directory, row.file_path)

    // Extract the subpath after the `analyses/{dirName}/` segment.
    // We split on the literal "/analyses/" marker — works for both
    // absolute and relative stored paths regardless of OS separator
    // because Mesa always writes "/"-delimited relative paths.
    const marker = "/analyses/"
    const idx = row.file_path.indexOf(marker)
    if (idx < 0) {
      // Path doesn't contain the analyses marker — already migrated
      // or unknown layout. Skip silently.
      continue
    }

    const afterMarker = row.file_path.slice(idx + marker.length)
    // afterMarker = "{dirName}/{rest}" — drop the first segment.
    const slashIdx = afterMarker.indexOf("/")
    if (slashIdx < 0) {
      // Loose file directly under analyses/ (no dirName). Keep as-is.
      continue
    }
    const subpath = afterMarker.slice(slashIdx + 1) // e.g. "turn1/persona.md"

    const targetRel = join(targetFolder, "analyses", subpath)
    const targetAbs = join(directory, targetRel)

    if (!existsSync(targetAbs)) {
      if (existsSync(sourceAbs)) {
        try {
          mkdirSync(dirname(targetAbs), { recursive: true })
          renameSync(sourceAbs, targetAbs)
        } catch (e) {
          console.error(
            `[Mesa migration] analyses rename failed: ${sourceAbs} → ${targetAbs}:`,
            (e as Error).message
          )
          continue
        }
      } else {
        console.log(
          `[Mesa migration] analyses source not found: ${sourceAbs} (setting path to null)`
        )
        // File is gone — clear the reference so consumers don't try to
        // open a stale path. The analysis content is still recoverable
        // from the `content` column if it was stored there.
        db.run(
          "UPDATE mesa_session_analyses SET file_path = NULL WHERE id = ?",
          [row.id]
        )
        continue
      }
    }

    // Rewrite the stored path to the new relative location.
    db.run(
      "UPDATE mesa_session_analyses SET file_path = ? WHERE id = ?",
      [targetRel, row.id]
    )
  }
}

/**
 * Move appendix files for a session into the session folder and rewrite
 * the `appendices` JSON array from legacy basenames to workspace-relative
 * paths.
 *
 * Legacy basename format: `appendix-{masterSpecId}-{phaseSlug}-{uuid}.md`
 * New basename format:    `appendix-{phaseSlug}-{uuid}.md`
 *
 * The `masterSpecId` prefix is stripped (TD2: appendices are
 * session-scoped, not spec-scoped). When `masterSpecId` cannot be
 * resolved (no spec path), the basename is preserved as-is.
 */
function migrateAppendices(
  directory: string,
  targetFolder: string,
  appendicesJson: string | null,
  masterSpecId: string | null
): string[] {
  let entries: string[] = []
  if (appendicesJson) {
    try {
      const parsed = JSON.parse(appendicesJson)
      if (Array.isArray(parsed)) entries = parsed.filter((e) => typeof e === "string")
    } catch {
      // malformed JSON — nothing to migrate
      return []
    }
  }

  if (entries.length === 0) return []

  const legacyDir = join(directory, PLUGIN_STATE_DIR, "specifications", "appendices")
  const targetRelDir = join(targetFolder, "appendices")
  const targetAbsDir = join(directory, targetRelDir)
  const result: string[] = []

  for (const entry of entries) {
    // Legacy entries are basenames; defensive: take basename of any path.
    const oldBasename = basename(entry)

    // Compute the new basename by stripping the `{masterSpecId}-` segment.
    let newBasename = oldBasename
    if (masterSpecId) {
      const prefix = `appendix-${masterSpecId}-`
      if (oldBasename.startsWith(prefix)) {
        newBasename = `appendix-${oldBasename.slice(prefix.length)}`
      }
    }

    const targetRel = join(targetRelDir, newBasename)
    const targetAbs = join(directory, targetRel)
    const sourceAbs = join(legacyDir, oldBasename)

    if (!existsSync(targetAbs)) {
      if (existsSync(sourceAbs)) {
        try {
          mkdirSync(targetAbsDir, { recursive: true })
          renameSync(sourceAbs, targetAbs)
        } catch (e) {
          console.error(
            `[Mesa migration] appendix rename failed: ${sourceAbs} → ${targetAbs}:`,
            (e as Error).message
          )
          // Preserve the original entry so the reference isn't lost.
          result.push(entry)
          continue
        }
      } else {
        console.log(
          `[Mesa migration] appendix source not found: ${sourceAbs} (skipping)`
        )
        // File is gone — do not include it in the migrated appendix list.
        continue
      }
    }

    result.push(targetRel)
  }

  return result
}

/**
 * Migrate all artifacts for a single session row.
 */
function migrateSessionArtifacts(
  directory: string,
  db: IDatabase,
  row: {
    session_id: string
    briefing_slug: string | null
    briefing_path: string | null
    specification_path: string | null
    specification_overview_path: string | null
    appendices: string | null
    session_folder: string | null
    created_at: string
  }
): void {
  const createdAt = resolveStartedAt(db, row.session_id, row.created_at)
  const input = {
    createdAt,
    sessionId: row.session_id,
    slug: row.briefing_slug ?? "untitled",
  }
  const targetFolder = buildSessionFolderPath(input)

  // Idempotency checkpoint 1: session already processed on a previous run.
  // The session_folder column is set atomically at the end of migration.
  if (row.session_folder !== null) {
    return
  }

  // Idempotency checkpoint 2: target briefing.md exists (partial recovery
  // from a crash mid-migration). Mark the session as processed and exit.
  const checkpoint = join(directory, targetFolder, "briefing.md")
  if (existsSync(checkpoint)) {
    db.run(
      "UPDATE mesa_session_state SET session_folder = ? " +
      "WHERE workspace_id = ? AND session_id = ?",
      [targetFolder, directory, row.session_id]
    )
    return
  }

  mkdirSync(join(directory, targetFolder), { recursive: true })

  const newBriefingPath = migrateArtifactFile(
    directory, targetFolder, "briefing.md", row.briefing_path
  )
  const newSpecPath = migrateArtifactFile(
    directory, targetFolder, "specification.md", row.specification_path
  )
  const newOverviewPath = migrateArtifactFile(
    directory, targetFolder, "overview.md", row.specification_overview_path
  )

  migrateAnalyses(directory, db, row.session_id, targetFolder)

  const masterSpecId = extractMasterSpecId(row.specification_path)
  const newAppendices = migrateAppendices(
    directory, targetFolder, row.appendices, masterSpecId
  )

  db.run(
    "UPDATE mesa_session_state SET " +
    "session_folder = ?, briefing_path = ?, specification_path = ?, " +
    "specification_overview_path = ?, appendices = ? " +
    "WHERE workspace_id = ? AND session_id = ?",
    [
      targetFolder,
      newBriefingPath,
      newSpecPath,
      newOverviewPath,
      JSON.stringify(newAppendices),
      directory,
      row.session_id,
    ]
  )
}

/**
 * Recursively move the contents of `sourceDir` into `targetDir`,
 * merging with any existing target. Empty source directories are
 * removed after their contents are relocated.
 *
 * Used for the `_archive/` relocation of legacy structures. Each
 * individual file move is atomic (rename); a mid-archive crash leaves
 * the source dir with whatever wasn't moved yet, so re-running is safe.
 */
function moveDirContents(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir)) return
  mkdirSync(targetDir, { recursive: true })

  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
  try {
    entries = readdirSync(sourceDir, { withFileTypes: true }) as unknown as Array<{
      name: string
      isDirectory: () => boolean
      isFile: () => boolean
    }>
  } catch {
    return
  }

  for (const entry of entries) {
    const src = join(sourceDir, entry.name)
    const dst = join(targetDir, entry.name)

    if (existsSync(dst)) {
      if (entry.isDirectory()) {
        moveDirContents(src, dst)
      }
      // Files: skip when target exists (idempotent — first-write-wins).
    } else {
      try {
        renameSync(src, dst)
      } catch (e) {
        console.error(
          `[Mesa migration] moveDirContents rename failed: ${src} → ${dst}:`,
          (e as Error).message
        )
      }
    }
  }

  // Best-effort rmdir — non-recursive, only succeeds when source is empty.
  try {
    rmdirSync(sourceDir)
  } catch {
    // Source not empty (some moves failed) — leave in place.
  }
}

/**
 * Move legacy, non-session-scoped structures into `.mesa/_archive/`.
 *
 * Runs AFTER all session artifacts have been migrated. Anything left in
 * the legacy directories at this point is either:
 *  - orphaned (no matching session in DB)
 *  - a legacy layout we no longer write to
 *
 * All of it goes to `_archive/` so the workspace root stays clean
 * without losing data.
 */
function archiveLegacyStructures(directory: string): void {
  const mesaDir = join(directory, PLUGIN_STATE_DIR)
  const archiveDir = join(mesaDir, "_archive")
  mkdirSync(archiveDir, { recursive: true })

  // 1. `.mesa/especificacoes/` → `_archive/especificacoes/`  (PT legacy)
  moveDirContents(
    join(mesaDir, "especificacoes"),
    join(archiveDir, "especificacoes")
  )

  // 2. `.mesa/specifications/analyses-*/` → `_archive/specifications-analyses-{short}/`
  const specsDir = join(mesaDir, "specifications")
  if (existsSync(specsDir)) {
    let specEntries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      specEntries = readdirSync(specsDir, { withFileTypes: true }) as unknown as Array<{
        name: string
        isDirectory: () => boolean
        isFile: () => boolean
      }>
    } catch {
      specEntries = []
    }

    for (const entry of specEntries) {
      if (entry.isDirectory() && entry.name.startsWith("analyses-")) {
        const shortHash = entry.name.slice("analyses-".length)
        moveDirContents(
          join(specsDir, entry.name),
          join(archiveDir, `specifications-analyses-${shortHash}`)
        )
      }
    }
  }

  // 3. `.mesa/analyses/{turn1,turn2,turn3,consensus,ask_peer}/` + loose `.md` files
  //    → `_archive/analyses-flat/`  (flat, non-session-scoped legacy)
  const analysesDir = join(mesaDir, "analyses")
  const flatTarget = join(archiveDir, "analyses-flat")
  if (existsSync(analysesDir)) {
    const flatNames = ["turn1", "turn2", "turn3", "turn4", "consensus", "ask_peer"]
    let analysesEntries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      analysesEntries = readdirSync(analysesDir, { withFileTypes: true }) as unknown as Array<{
        name: string
        isDirectory: () => boolean
        isFile: () => boolean
      }>
    } catch {
      analysesEntries = []
    }

    for (const entry of analysesEntries) {
      if (entry.isDirectory() && flatNames.includes(entry.name)) {
        moveDirContents(
          join(analysesDir, entry.name),
          join(flatTarget, entry.name)
        )
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        mkdirSync(flatTarget, { recursive: true })
        try {
          renameSync(
            join(analysesDir, entry.name),
            join(flatTarget, entry.name)
          )
        } catch (e) {
          console.error(
            `[Mesa migration] failed to archive loose analyses file ${entry.name}:`,
            (e as Error).message
          )
        }
      }
    }

    // Best-effort cleanup of now-empty session directories under analyses/.
    // Session-scoped dirs that were per-row migrated above may be empty now.
    let remaining: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      remaining = readdirSync(analysesDir, { withFileTypes: true }) as unknown as Array<{
        name: string
        isDirectory: () => boolean
        isFile: () => boolean
      }>
    } catch {
      remaining = []
    }
    for (const entry of remaining) {
      if (entry.isDirectory()) {
        const subDir = join(analysesDir, entry.name)
        try {
          rmdirSync(subDir, { recursive: true })
        } catch {
          // Not empty — leave in place. (Orphaned analyses for unknown sessions.)
        }
      }
    }

    // If analyses/ itself is now empty, remove it.
    try {
      rmdirSync(analysesDir)
    } catch {
      // Not empty — leave in place.
    }
  }

  // 4 & 5. Root pollution: `briefing-current-*.md`, `briefing-for-discussion-*.md`
  //        → `_archive/root-files/`
  const rootFilesTarget = join(archiveDir, "root-files")
  let mesaEntries: Array<{ name: string; isFile: () => boolean }>
  try {
    mesaEntries = readdirSync(mesaDir, { withFileTypes: true }) as unknown as Array<{
      name: string
      isFile: () => boolean
    }>
  } catch {
    mesaEntries = []
  }

  const rootPrefixes = ["briefing-current-", "briefing-for-discussion-"]
  const rootFiles = mesaEntries
    .filter((e) => e.isFile() && rootPrefixes.some((p) => e.name.startsWith(p)))
    .map((e) => e.name)

  if (rootFiles.length > 0) {
    mkdirSync(rootFilesTarget, { recursive: true })
    for (const name of rootFiles) {
      try {
        renameSync(join(mesaDir, name), join(rootFilesTarget, name))
      } catch (e) {
        console.error(
          `[Mesa migration] failed to archive root file ${name}:`,
          (e as Error).message
        )
      }
    }
  }

  // 6. `.mesa/briefings/` (remaining) → `_archive/briefings/`
  moveDirContents(
    join(mesaDir, "briefings"),
    join(archiveDir, "briefings")
  )

  // 7. `.mesa/specifications/` (remaining) → `_archive/specifications/`
  moveDirContents(
    specsDir,
    join(archiveDir, "specifications")
  )
}

/**
 * Maintenance sweep for the memory system (spec-7ba9841f, D6 + D7).
 *
 * Runs at DB open (session init). Two operations:
 * 1. Hard-purge soft-deleted entries older than 7 days.
 * 2. Mark TTL-expired entries as deleted (they get purged next sweep).
 *
 * Non-critical — failures are silently swallowed.
 */
function maintenanceSweep(db: IDatabase): void {
  try {
    db.run("DELETE FROM mesa_memory WHERE status = 'deleted' AND updated_at < datetime('now', '-7 days')")
    db.run("UPDATE mesa_memory SET status = 'deleted', updated_at = datetime('now') WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND status = 'active'")
  } catch {
    // Non-critical — skip on failure
  }
}

export function getDb(directory: string): IDatabase {
  const stateDir = join(directory, PLUGIN_STATE_DIR)
  mkdirSync(stateDir, { recursive: true })

  const dbPath = join(stateDir, "state.db")
  const db = openDatabase(dbPath, { create: true })

  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA synchronous = NORMAL")

  db.exec(SCHEMA_SQL)

  // Migrate schema before data so JSON migration can use new columns
  migrate_v1_to_v2(db)
  migrate_v2_to_v3(db)
  migrate_v3_to_v4(db)
  migrate_v4_to_v5(db)
  migrate_v5_to_v6(db)
  migrate_v6_to_v7(db)
  migrate_v7_to_v8(db)
  migrate_v8_to_v9(db)
  migrate_v9_to_v10(db)
  migrate_v10_to_v11(db)
  migrate_v11_to_v12(db)
  migrate_v12_to_v13(db)
  migrate_v13_to_v14(db)
  migrate_v14_to_v15(db, directory)
  // File relocation (spec-6886df4f, TD5) — runs after schema migrations
  // (so the session_folder column exists) but before migrateFromJson
  // (so JSON-imported rows also get their files relocated on next open).
  migrateFiles_v10_to_v11(directory, db)
  migrateFromJson(directory, db)

  reconcileMemories(directory, db)
  maintenanceSweep(db)
  purgeStaleMemoryFiles(directory, db)

  return db
}

function insertChildRows(db: IDatabase, wsId: string, state: DiscussionState): void {
  for (let i = 0; i < state.team.length; i++) {
    const m = state.team[i]
    db.run(
      "INSERT INTO mesa_team (workspace_id, persona_id, name, division, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      [wsId, m.personaId, m.name, m.division, m.status, i]
    )
  }

  for (const a of state.discussion.analyses) {
    db.run(
      `INSERT INTO mesa_analyses (workspace_id, agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, round_id, position_in_turn, responds_to, tensions_raised, session_resumed, registered_by_manager)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [wsId, a.agentId, a.agentName, a.content, a.turn, a.timestamp,
       a.filePath ?? null, a.kind ?? "full", a.turnType ?? "analysis",
       a.round ?? null, a.roundId ?? null, a.positionInTurn ?? null,
       a.respondsTo ?? null,
       a.tensionsRaised ? JSON.stringify(a.tensionsRaised) : null,
       a.sessionResumed ? 1 : 0,
       a.registeredByManager ? 1 : 0]
    )
  }

  for (let i = 0; i < state.discussion.participants.length; i++) {
    db.run(
      "INSERT INTO mesa_participants (workspace_id, persona_id, sort_order) VALUES (?, ?, ?)",
      [wsId, state.discussion.participants[i], i]
    )
  }
}

function insertSessionChildRows(db: IDatabase, wsId: string, sessionId: string, state: DiscussionState): void {
  for (let i = 0; i < state.team.length; i++) {
    const m = state.team[i]
    db.run(
      "INSERT INTO mesa_session_team (workspace_id, session_id, persona_id, name, division, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [wsId, sessionId, m.personaId, m.name, m.division, m.status, i]
    )
  }

  for (const a of state.discussion.analyses) {
    const sr = a.sessionResumed ? 1 : 0
    db.run(
      `INSERT INTO mesa_session_analyses (workspace_id, session_id, agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, round_id, position_in_turn, responds_to, tensions_raised, session_resumed, registered_by_manager)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [wsId, sessionId, a.agentId, a.agentName, a.content, a.turn, a.timestamp,
       a.filePath ?? null, a.kind ?? "full", a.turnType ?? "analysis",
       a.round ?? null, a.roundId ?? null, a.positionInTurn ?? null,
       a.respondsTo ?? null,
       a.tensionsRaised ? JSON.stringify(a.tensionsRaised) : null,
       sr,
       a.registeredByManager ? 1 : 0]
    )
  }

  for (let i = 0; i < state.discussion.participants.length; i++) {
    db.run(
      "INSERT INTO mesa_session_participants (workspace_id, session_id, persona_id, sort_order) VALUES (?, ?, ?, ?)",
      [wsId, sessionId, state.discussion.participants[i], i]
    )
  }
}

function loadSessionState(db: IDatabase, wsId: string, sessionId: string): DiscussionState | null {
  const row = db
    .query("SELECT * FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
    .get(wsId, sessionId) as Record<string, unknown> | null

  if (!row) return null

  const team = db
    .query("SELECT persona_id, name, division, status FROM mesa_session_team WHERE workspace_id = ? AND session_id = ? ORDER BY sort_order")
    .all(wsId, sessionId) as Array<{ persona_id: string; name: string; division: string; status: string }>

  const analyses = db
    .query("SELECT agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, round_id, position_in_turn, responds_to, tensions_raised, session_resumed, registered_by_manager FROM mesa_session_analyses WHERE workspace_id = ? AND session_id = ? ORDER BY turn")
    .all(wsId, sessionId) as Array<Record<string, unknown>>

  const participants = db
    .query("SELECT persona_id FROM mesa_session_participants WHERE workspace_id = ? AND session_id = ? ORDER BY sort_order")
    .all(wsId, sessionId) as Array<{ persona_id: string }>

  return rowToState(row, team, analyses, participants)
}

type AnalysisRow = Record<string, unknown>

function mapAnalysisRow(a: AnalysisRow): AnalysisEntry {
  let tensionsRaised: string[] | undefined
  const raw = a.tensions_raised as string | null
  if (raw) {
    try { tensionsRaised = JSON.parse(raw) } catch { /* leave undefined */ }
  }
  return {
    agentId: a.agent_id as string,
    agentName: a.agent_name as string,
    content: a.content as string,
    filePath: (a.file_path as string | null) ?? null,
    kind: ((a.kind as string) || "full") as AnalysisKind,
    turn: a.turn as number,
    turnType: ((a.turn_type as string) || "analysis") as AnalysisTurnType,
    round: a.round != null ? (a.round as number) : undefined,
    roundId: (a.round_id as string | null) ?? undefined,
    positionInTurn: a.position_in_turn != null ? (a.position_in_turn as number) : undefined,
    respondsTo: (a.responds_to as string | undefined) ?? undefined,
    tensionsRaised,
    sessionResumed: a.session_resumed != null ? !!a.session_resumed : undefined,
    registeredByManager: a.registered_by_manager != null ? !!a.registered_by_manager : undefined,
    timestamp: a.timestamp as string,
  }
}

function rowToState(
  row: Record<string, unknown>,
  team: Array<{ persona_id: string; name: string; division: string; status: string }>,
  analyses: Array<AnalysisRow>,
  participants: Array<{ persona_id: string }>
): DiscussionState {
  // briefing.metadata may be absent on legacy rows; parse defensively.
  let metadata: DiscussionState["briefing"]["metadata"] = null
  const rawMetadata = row.briefing_metadata as string | undefined
  if (rawMetadata) {
    try {
      metadata = JSON.parse(rawMetadata) as DiscussionState["briefing"]["metadata"]
    } catch {
      // keep null on malformed JSON
    }
  }

  // v14 fields may be absent on legacy rows; parse defensively.
  let rounds: Round[] = []
  try {
    const parsed = JSON.parse((row.rounds as string) || "[]")
    if (Array.isArray(parsed)) rounds = parsed
  } catch {
    // keep [] on malformed JSON
  }

  let deliverables: Deliverable[] = []
  try {
    const parsed = JSON.parse((row.deliverables as string) || "[]")
    if (Array.isArray(parsed)) deliverables = parsed
  } catch {
    // keep [] on malformed JSON
  }

  let plan: PlanPointer | null = null
  const rawPlan = row.plan as string | null | undefined
  if (rawPlan) {
    try {
      plan = JSON.parse(rawPlan) as PlanPointer
    } catch {
      // keep null on malformed JSON
    }
  }

  return {
    workspaceId: row.workspace_id as string,
    currentPhase: row.current_phase as string as DiscussionState["currentPhase"],
    status: ((row.status as string) || "active") as DiscussionState["status"],
    briefing: {
      path: row.briefing_path as string | null,
      status: row.briefing_status as DiscussionState["briefing"]["status"],
      slug: row.briefing_slug as string | null,
      metadata,
    },
    team: team.map((t) => ({
      personaId: t.persona_id,
      name: t.name,
      division: t.division,
      status: t.status as DiscussionState["team"][number]["status"],
    })),
    discussion: {
      topic: (row.discussion_topic as string) || "",
      currentTurn: (row.discussion_current_turn as number) ?? 0,
      maxTurns: (row.discussion_max_turns as number) ?? 2,
      analyses: analyses.map(mapAnalysisRow),
      participants: participants.map((p) => p.persona_id),
    },
    rounds,
    deliverables,
    plan,
    sessionFolder: (row.session_folder as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    stateVersion: (row.state_version as number) ?? 1,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getWorkspaceStateDir(directory: string): Promise<string> {
  const stateDir = join(directory, PLUGIN_STATE_DIR)
  mkdirSync(stateDir, { recursive: true })
  return stateDir
}

export async function getStatePath(directory: string): Promise<string> {
  const stateDir = await getWorkspaceStateDir(directory)
  return join(stateDir, "state.db")
}

// Ensure a session exists in mesa_session table (without full initSession overhead)
// Used when opencodeSessionId is provided directly to loadState/saveState
function isValidSessionId(sessionId: string): boolean {
  // Real OpenCode session IDs start with "ses_". Mesa-initiated sessions use
  // UUIDs. Placeholder/test IDs (e.g. "dummy", "test-session") should not be
  // inserted into mesa_session because they can block real session creation
  // and trigger SDK validation errors.
  return (
    sessionId.startsWith("ses_") ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)
  )
}

function ensureSession(directory: string, sessionId: string): void {
  if (!isValidSessionId(sessionId)) return

  const db = getDb(directory)
  try {
    const existing = db
      .query("SELECT session_id FROM mesa_session WHERE session_id = ?")
      .get(sessionId) as { session_id: string } | null

    if (!existing) {
      const now = new Date().toISOString()
      db.run(
        "INSERT INTO mesa_session (session_id, pid, hostname, started_at, last_heartbeat, status) VALUES (?, ?, ?, ?, ?, 'active')",
        [sessionId, process.pid, hostname(), now, now]
      )
    } else {
      // Update heartbeat
      db.run(
        "UPDATE mesa_session SET last_heartbeat = ?, status = 'active' WHERE session_id = ?",
        [new Date().toISOString(), sessionId]
      )
    }
  } finally {
    db.close()
  }
}

export async function loadState(directory: string, opencodeSessionId?: string): Promise<DiscussionState> {
  let sessionId: string | undefined
  if (opencodeSessionId) {
    sessionId = opencodeSessionId
    ensureSession(directory, opencodeSessionId)
  } else {
    await initSession(directory)
    sessionId = getSessionId(directory)
  }

  const db = getDb(directory)
  try {
    // 1. Try to load from THIS session
    if (sessionId) {
      const sessionState = loadSessionState(db, directory, sessionId)
      if (sessionState) return sessionState
    }

    // 2. ROOT SESSION via parentID: If this session has no state (e.g., a
    //    specialist subagent), walk up the parent chain via SDK to find the
    //    Manager session that owns the discussion state.
    if (sessionId) {
      const rootSessionId = await findRootSessionId(db, directory, sessionId)
      if (rootSessionId) {
        const rootState = loadSessionState(db, directory, rootSessionId)
        if (rootState) return rootState
      }
    }

    // 3. No state found — return fresh initial state
    return createInitialState(directory)
  } finally {
    db.close()
  }
}

export async function saveState(directory: string, state: DiscussionState, opencodeSessionId?: string): Promise<void> {
  let sessionId: string | undefined
  if (opencodeSessionId) {
    sessionId = opencodeSessionId
    ensureSession(directory, opencodeSessionId)
  } else {
    await initSession(directory)
    sessionId = getSessionId(directory)
  }

  // ROOT SESSION RESOLUTION: If this session has no state of its own,
  // walk up the parent chain to find the Manager session that owns the
  // discussion state. Write there so all participants share state.
  if (opencodeSessionId) {
    const db0 = getDb(directory)
    try {
      const hasOwnState = db0
        .query("SELECT session_id FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
        .get(directory, opencodeSessionId)

      if (!hasOwnState) {
        const rootSessionId = await findRootSessionId(db0, directory, opencodeSessionId)
        if (rootSessionId) {
          sessionId = rootSessionId
        }
      }
    } finally {
      db0.close()
    }
  }

  state.updatedAt = new Date().toISOString()

  const db = getDb(directory)
  try {
    const save = db.transaction(() => {
      // Save to session-scoped tables ONLY
      // (previously also dual-wrote to unscoped mesa_state, causing cross-session contamination)
      if (!sessionId) {
        throw new Error("[Mesa] Cannot save state without a session ID")
      }

      db.run(
        `INSERT OR REPLACE INTO mesa_session_state (
          workspace_id, session_id, current_phase, status,
          briefing_path, briefing_status, briefing_slug, briefing_metadata,
          discussion_topic, discussion_current_turn, discussion_max_turns,
          rounds, deliverables, plan,
          session_folder,
          state_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          state.workspaceId, sessionId, state.currentPhase, state.status ?? "active",
          state.briefing.path, state.briefing.status, state.briefing.slug,
          JSON.stringify(state.briefing.metadata ?? null),
          state.discussion.topic, state.discussion.currentTurn, state.discussion.maxTurns,
          JSON.stringify(state.rounds ?? []), JSON.stringify(state.deliverables ?? []),
          state.plan ? JSON.stringify(state.plan) : null,
          state.sessionFolder ?? null,
          state.stateVersion, state.createdAt, state.updatedAt,
        ]
      )

      db.run("DELETE FROM mesa_session_team WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
      db.run("DELETE FROM mesa_session_analyses WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
      db.run("DELETE FROM mesa_session_participants WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])

      insertSessionChildRows(db, state.workspaceId, sessionId, state)

      // Piggyback heartbeat
      const canonicalDir = join(directory, PLUGIN_STATE_DIR)
      const session = activeSessions.get(canonicalDir)
      if (session) {
        db.run(
          "UPDATE mesa_session SET last_heartbeat = ? WHERE session_id = ? AND status = 'active'",
          [new Date().toISOString(), session.sessionId]
        )
      }
    })

    save.immediate()
  } finally {
    db.close()
  }
}

/**
 * Close any open sessions and release timers. Useful for test cleanup.
 */
export function closeStorage(directory?: string): void {
  if (directory) {
    const canonicalDir = join(directory, PLUGIN_STATE_DIR)
    const session = activeSessions.get(canonicalDir)
    if (session) {
      try {
        endSession(session)
      } catch {
        // best effort
      }
      activeSessions.delete(canonicalDir)
    }
  } else {
    for (const [, session] of activeSessions) {
      try {
        endSession(session)
      } catch {
        // best effort
      }
    }
    activeSessions.clear()
  }
}
