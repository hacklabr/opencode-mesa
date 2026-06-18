import { openDatabase, type IDatabase } from "./db/driver.js"
import { mkdirSync, existsSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { hostname } from "node:os"
import { z, ZodError } from "zod"
import type { DiscussionState, AnalysisEntry, AnalysisKind, AnalysisTurnType, DiscussionMode } from "./types.js"
import { PLUGIN_STATE_DIR, CURRENT_STATE_VERSION, createInitialState } from "./config.js"

// SDK client for parent session lookup (set from index.ts)
type SessionGetter = (sessionId: string) => Promise<{ parentID?: string } | null>
let sessionGetter: SessionGetter | null = null

export function setStateSdkClient(client: unknown): void {
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
async function findRootSessionId(db: IDatabase, directory: string, sessionId: string): Promise<string | null> {
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
const DiscussionModeEnum = z.enum(["analysis", "debate", "voting"])

const BriefingStatusEnum = z.enum(["draft", "approved", "delivered"])
const SpecialistStatusEnum = z.enum(["proposed", "summoned", "active", "dismissed", "delegated"])
const SpecificationStatusEnum = z.enum(["pending", "draft", "approved", "rejected"])
const ConsensusVoteEnum = z.union([z.literal(0), z.literal(1), z.literal(2)])

const AnalysisTurnTypeEnum = z.enum(["analysis", "discussion"])
const RigorProfileEnum = z.enum(["light", "standard", "deep"])
const AnalysisModeEnum = z.enum(["parallel", "sequential", "hybrid"])

const DiscussionProgressSchema = z.object({
  currentTurn: z.number().default(0),
  completedParticipants: z.array(z.string()).default([]),
  activeProfile: z.string().default("standard"),
  deviations: z.number().default(0),
})

const AnalysisEntrySchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  content: z.string(),
  filePath: z.string().nullable().default(null),
  kind: z.enum(["full", "delta"]).default("full"),
  turn: z.number(),
  turnType: AnalysisTurnTypeEnum.default("analysis"),
  round: z.number().optional(),
  positionInTurn: z.number().optional(),
  respondsTo: z.string().optional(),
  tensionsRaised: z.array(z.string()).optional(),
  sessionResumed: z.boolean().optional(),
  timestamp: z.string(),
})

const ConsensusVoteEntrySchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  vote: ConsensusVoteEnum,
  reason: z.string(),
  round: z.number(),
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
  }),
  team: z.array(SpecialistEntrySchema),
  discussion: z.object({
    topic: z.string(),
    currentTurn: z.number(),
    maxTurns: z.number(),
    analyses: z.array(AnalysisEntrySchema),
    votes: z.array(ConsensusVoteEntrySchema),
    consensusRound: z.number(),
    participants: z.array(z.string()).default([]),
    debateNeeded: z.boolean().default(false),
    mode: DiscussionModeEnum.default("analysis"),
    maxConsensusRounds: z.number().default(2),
    // Governance fields (spec-4dcc492f) — defaults ensure backward-compat on load
    rigor: RigorProfileEnum.default("standard"),
    analysisMode: AnalysisModeEnum.default("parallel"),
    deviations: z.number().default(0),
    // Observability (spec-4dcc492f, Decision 3, Requirement 1)
    progress: DiscussionProgressSchema.default({
      currentTurn: 0,
      completedParticipants: [],
      activeProfile: "standard",
      deviations: 0,
    }),
  }),
  specification: z.object({
    path: z.string().nullable(),
    overviewPath: z.string().nullable().default(null),
    status: SpecificationStatusEnum,
  }),
  appendices: z.array(z.string()).default([]),
  phases: z.array(z.string()).default(["PLANNING", "DISCUSSION", "SPECIFICATION", "EXECUTION"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  stateVersion: z.number().default(1),
  previousPhase: DiscussionPhaseEnum.nullable().default(null),
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
  rigor TEXT DEFAULT 'standard',
  analysis_mode TEXT DEFAULT 'parallel',
  deviations INTEGER DEFAULT 0,
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
  position_in_turn INTEGER,
  responds_to TEXT,
  tensions_raised TEXT,
  session_resumed INTEGER,
  UNIQUE(workspace_id, agent_id, turn, turn_type)
);
CREATE INDEX IF NOT EXISTS idx_analyses_turn ON mesa_analyses(workspace_id, turn);

CREATE TABLE IF NOT EXISTS mesa_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES mesa_state(workspace_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  vote INTEGER CHECK(vote IN (0,1,2)),
  reason TEXT,
  round INTEGER,
  UNIQUE(workspace_id, agent_id, round)
);
CREATE INDEX IF NOT EXISTS idx_votes_round ON mesa_votes(workspace_id, round);

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
  rigor TEXT DEFAULT 'standard',
  analysis_mode TEXT DEFAULT 'parallel',
  deviations INTEGER DEFAULT 0,
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
  position_in_turn INTEGER,
  responds_to TEXT,
  tensions_raised TEXT,
  session_resumed INTEGER,
  UNIQUE(workspace_id, session_id, agent_id, turn, turn_type)
);
CREATE INDEX IF NOT EXISTS idx_session_analyses_turn ON mesa_session_analyses(workspace_id, session_id, turn);

CREATE TABLE IF NOT EXISTS mesa_session_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  vote INTEGER CHECK(vote IN (0,1,2)),
  reason TEXT,
  round INTEGER,
  UNIQUE(workspace_id, session_id, agent_id, round)
);
CREATE INDEX IF NOT EXISTS idx_session_votes_round ON mesa_session_votes(workspace_id, session_id, round);

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
      workspace_id, current_phase, previous_phase, status,
      briefing_path, briefing_status, briefing_slug,
      discussion_topic, discussion_current_turn, discussion_max_turns,
      discussion_consensus_round, discussion_debate_needed, discussion_progress,
      discussion_mode, discussion_max_consensus_rounds,
      specification_path, specification_overview_path, specification_status,
      phases, appendices,
      rigor, analysis_mode, deviations,
      state_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      wsId, state.currentPhase, state.previousPhase, state.status ?? "active",
      state.briefing.path, state.briefing.status, state.briefing.slug,
      state.discussion.topic, state.discussion.currentTurn, state.discussion.maxTurns,
      state.discussion.consensusRound, state.discussion.debateNeeded ? 1 : 0,
      JSON.stringify(state.discussion.progress ?? { currentTurn: 0, completedParticipants: [], activeProfile: "standard", deviations: 0 }),
      state.discussion.mode ?? "analysis", state.discussion.maxConsensusRounds ?? 2,
      state.specification.path, state.specification.overviewPath, state.specification.status,
      JSON.stringify(state.phases), JSON.stringify(state.appendices),
      state.discussion.rigor ?? "standard",
      state.discussion.analysisMode ?? "parallel",
      state.discussion.deviations ?? 0,
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
      // Check if the table exists and has the old constraint
      const tableInfo = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (tableInfo.length === 0) continue

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

function getDb(directory: string): IDatabase {
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
  migrateFromJson(directory, db)

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
      `INSERT INTO mesa_analyses (workspace_id, agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, position_in_turn, responds_to, tensions_raised, session_resumed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [wsId, a.agentId, a.agentName, a.content, a.turn, a.timestamp,
       a.filePath ?? null, a.kind ?? "full", a.turnType ?? "analysis",
       a.round ?? null, a.positionInTurn ?? null,
       a.respondsTo ?? null,
       a.tensionsRaised ? JSON.stringify(a.tensionsRaised) : null,
       a.sessionResumed ? 1 : 0]
    )
  }

  for (const v of state.discussion.votes) {
    db.run(
      "INSERT INTO mesa_votes (workspace_id, agent_id, agent_name, vote, reason, round) VALUES (?, ?, ?, ?, ?, ?)",
      [wsId, v.agentId, v.agentName, v.vote, v.reason, v.round]
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
    db.run(
      `INSERT INTO mesa_session_analyses (workspace_id, session_id, agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, position_in_turn, responds_to, tensions_raised, session_resumed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [wsId, sessionId, a.agentId, a.agentName, a.content, a.turn, a.timestamp,
       a.filePath ?? null, a.kind ?? "full", a.turnType ?? "analysis",
       a.round ?? null, a.positionInTurn ?? null,
       a.respondsTo ?? null,
       a.tensionsRaised ? JSON.stringify(a.tensionsRaised) : null,
       a.sessionResumed ? 1 : 0]
    )
  }

  for (const v of state.discussion.votes) {
    db.run(
      "INSERT INTO mesa_session_votes (workspace_id, session_id, agent_id, agent_name, vote, reason, round) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [wsId, sessionId, v.agentId, v.agentName, v.vote, v.reason, v.round]
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
    .query("SELECT agent_id, agent_name, content, turn, timestamp, file_path, kind, turn_type, round, position_in_turn, responds_to, tensions_raised, session_resumed FROM mesa_session_analyses WHERE workspace_id = ? AND session_id = ? ORDER BY turn")
    .all(wsId, sessionId) as Array<Record<string, unknown>>

  const votes = db
    .query("SELECT agent_id, agent_name, vote, reason, round FROM mesa_session_votes WHERE workspace_id = ? AND session_id = ? ORDER BY round")
    .all(wsId, sessionId) as Array<{ agent_id: string; agent_name: string; vote: number; reason: string; round: number }>

  const participants = db
    .query("SELECT persona_id FROM mesa_session_participants WHERE workspace_id = ? AND session_id = ? ORDER BY sort_order")
    .all(wsId, sessionId) as Array<{ persona_id: string }>

  return rowToState(row, team, analyses, votes, participants)
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
    positionInTurn: a.position_in_turn != null ? (a.position_in_turn as number) : undefined,
    respondsTo: (a.responds_to as string | undefined) ?? undefined,
    tensionsRaised,
    sessionResumed: a.session_resumed != null ? !!a.session_resumed : undefined,
    timestamp: a.timestamp as string,
  }
}

function rowToState(
  row: Record<string, unknown>,
  team: Array<{ persona_id: string; name: string; division: string; status: string }>,
  analyses: Array<AnalysisRow>,
  votes: Array<{ agent_id: string; agent_name: string; vote: number; reason: string; round: number }>,
  participants: Array<{ persona_id: string }>
): DiscussionState {
  // discussion.progress may be absent on legacy rows; parse defensively.
  let progress: DiscussionState["discussion"]["progress"] = {
    currentTurn: 0,
    completedParticipants: [],
    activeProfile: "standard",
    deviations: 0,
  }
  const rawProgress = row.discussion_progress as string | undefined
  if (rawProgress) {
    try {
      const parsed = JSON.parse(rawProgress) as Partial<DiscussionState["discussion"]["progress"]>
      progress = {
        currentTurn: typeof parsed.currentTurn === "number" ? parsed.currentTurn : 0,
        completedParticipants: Array.isArray(parsed.completedParticipants) ? parsed.completedParticipants : [],
        activeProfile: typeof parsed.activeProfile === "string" ? parsed.activeProfile : "standard",
        deviations: typeof parsed.deviations === "number" ? parsed.deviations : 0,
      }
    } catch {
      // keep defaults on malformed JSON
    }
  }

  return {
    workspaceId: row.workspace_id as string,
    currentPhase: row.current_phase as string as DiscussionState["currentPhase"],
    status: ((row.status as string) || "active") as DiscussionState["status"],
    previousPhase: (row.previous_phase as string | null) as DiscussionState["previousPhase"],
    briefing: {
      path: row.briefing_path as string | null,
      status: row.briefing_status as DiscussionState["briefing"]["status"],
      slug: row.briefing_slug as string | null,
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
      votes: votes.map((v) => ({
        agentId: v.agent_id,
        agentName: v.agent_name,
        vote: v.vote as 0 | 1 | 2,
        reason: v.reason,
        round: v.round,
      })),
      consensusRound: (row.discussion_consensus_round as number) ?? 0,
      participants: participants.map((p) => p.persona_id),
      debateNeeded: !!(row.discussion_debate_needed as number),
      mode: ((row.discussion_mode as string) || "analysis") as DiscussionMode,
      maxConsensusRounds: (row.discussion_max_consensus_rounds as number) ?? 2,
      rigor: ((row.rigor as string) || "standard") as DiscussionState["discussion"]["rigor"],
      analysisMode: ((row.analysis_mode as string) || "parallel") as DiscussionState["discussion"]["analysisMode"],
      deviations: (row.deviations as number) ?? 0,
      progress,
    },
    specification: {
      path: row.specification_path as string | null,
      overviewPath: row.specification_overview_path as string | null,
      status: row.specification_status as DiscussionState["specification"]["status"],
    },
    appendices: JSON.parse((row.appendices as string) || '[]'),
    phases: JSON.parse((row.phases as string) || '["PLANNING","DISCUSSION","SPECIFICATION","EXECUTION"]'),
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
function ensureSession(directory: string, sessionId: string): void {
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
          workspace_id, session_id, current_phase, previous_phase, status,
          briefing_path, briefing_status, briefing_slug,
          discussion_topic, discussion_current_turn, discussion_max_turns,
          discussion_consensus_round, discussion_debate_needed, discussion_progress,
          discussion_mode, discussion_max_consensus_rounds,
          specification_path, specification_overview_path, specification_status,
          phases, appendices,
          rigor, analysis_mode, deviations,
          state_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          state.workspaceId, sessionId, state.currentPhase, state.previousPhase, state.status ?? "active",
          state.briefing.path, state.briefing.status, state.briefing.slug,
          state.discussion.topic, state.discussion.currentTurn, state.discussion.maxTurns,
          state.discussion.consensusRound, state.discussion.debateNeeded ? 1 : 0,
          JSON.stringify(state.discussion.progress ?? { currentTurn: 0, completedParticipants: [], activeProfile: "standard", deviations: 0 }),
          state.discussion.mode ?? "analysis", state.discussion.maxConsensusRounds ?? 2,
          state.specification.path, state.specification.overviewPath, state.specification.status,
          JSON.stringify(state.phases), JSON.stringify(state.appendices),
          state.discussion.rigor ?? "standard",
          state.discussion.analysisMode ?? "parallel",
          state.discussion.deviations ?? 0,
          state.stateVersion, state.createdAt, state.updatedAt,
        ]
      )

      db.run("DELETE FROM mesa_session_team WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
      db.run("DELETE FROM mesa_session_analyses WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
      db.run("DELETE FROM mesa_session_votes WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
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
