if (!process.versions?.bun) {
  throw new Error("Mesa plugin requires Bun runtime (bun:sqlite)")
}

import { Database } from "bun:sqlite"
import { mkdirSync, existsSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { hostname } from "node:os"
import { z, ZodError } from "zod"
import type { DiscussionState } from "./types"
import { PLUGIN_STATE_DIR, CURRENT_STATE_VERSION, createInitialState } from "./config"

// ---------------------------------------------------------------------------
// Zod schemas (kept for JSON migration validation + future granular writers)
// ---------------------------------------------------------------------------

const DiscussionPhaseEnum = z.enum([
  "PLANNING",
  "ANALYSIS",
  "CONSENSUS",
  "DOCUMENTATION",
  "APPROVAL",
  "EXECUTION",
  "PAUSED",
  "CANCELLED",
])

const BriefingStatusEnum = z.enum(["draft", "approved", "delivered"])
const SpecialistStatusEnum = z.enum(["proposed", "summoned", "active", "dismissed", "delegated"])
const SpecificationStatusEnum = z.enum(["pending", "draft", "approved", "rejected"])
const ConsensusVoteEnum = z.union([z.literal(0), z.literal(1), z.literal(2)])

const AnalysisEntrySchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  content: z.string(),
  turn: z.number(),
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
  }),
  specification: z.object({
    path: z.string().nullable(),
    status: SpecificationStatusEnum,
  }),
  phases: z.array(z.string()).default(["PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION"]),
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
  briefing_path TEXT,
  briefing_status TEXT NOT NULL DEFAULT 'draft',
  briefing_slug TEXT,
  discussion_topic TEXT DEFAULT '',
  discussion_current_turn INTEGER DEFAULT 0,
  discussion_max_turns INTEGER DEFAULT 2,
  discussion_consensus_round INTEGER DEFAULT 0,
  discussion_debate_needed INTEGER DEFAULT 0,
  specification_path TEXT,
  specification_status TEXT DEFAULT 'pending',
  phases TEXT DEFAULT '["PLANNING","ANALYSIS","CONSENSUS","DOCUMENTATION","APPROVAL","EXECUTION"]',
  state_version INTEGER DEFAULT 1,
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
  UNIQUE(workspace_id, agent_id, turn)
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
  briefing_path TEXT,
  briefing_status TEXT NOT NULL DEFAULT 'draft',
  briefing_slug TEXT,
  discussion_topic TEXT DEFAULT '',
  discussion_current_turn INTEGER DEFAULT 0,
  discussion_max_turns INTEGER DEFAULT 2,
  discussion_consensus_round INTEGER DEFAULT 0,
  discussion_debate_needed INTEGER DEFAULT 0,
  specification_path TEXT,
  specification_status TEXT DEFAULT 'pending',
  phases TEXT DEFAULT '["PLANNING","ANALYSIS","CONSENSUS","DOCUMENTATION","APPROVAL","EXECUTION"]',
  state_version INTEGER DEFAULT 1,
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
  UNIQUE(workspace_id, session_id, agent_id, turn)
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

export function getSessionId(directory: string): string | undefined {
  const canonicalDir = join(directory, PLUGIN_STATE_DIR)
  return activeSessions.get(canonicalDir)?.sessionId
}

const HEARTBEAT_INTERVAL_MS = 15_000
const HEARTBEAT_STALE_THRESHOLD_MS = 90_000

function isSessionAlive(session: { pid: number; hostname: string; last_heartbeat: string }): boolean {
  let pidAlive = false
  try {
    process.kill(session.pid, 0)
    pidAlive = true
  } catch {
    pidAlive = false
  }

  const elapsed = Date.now() - new Date(session.last_heartbeat).getTime()
  const heartbeatAlive = elapsed < HEARTBEAT_STALE_THRESHOLD_MS

  return pidAlive || heartbeatAlive
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

function migrateFromJson(directory: string, db: Database): void {
  const jsonPath = join(directory, PLUGIN_STATE_DIR, "state.json")
  if (!existsSync(jsonPath)) return

  const raw = readFileSync(jsonPath, "utf-8")
  const state = DiscussionStateSchema.parse(JSON.parse(raw)) as DiscussionState

  const wsId = state.workspaceId

  db.run(
    `INSERT OR REPLACE INTO mesa_state (
      workspace_id, current_phase, previous_phase,
      briefing_path, briefing_status, briefing_slug,
      discussion_topic, discussion_current_turn, discussion_max_turns,
      discussion_consensus_round, discussion_debate_needed,
      specification_path, specification_status,
      phases, state_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      wsId, state.currentPhase, state.previousPhase,
      state.briefing.path, state.briefing.status, state.briefing.slug,
      state.discussion.topic, state.discussion.currentTurn, state.discussion.maxTurns,
      state.discussion.consensusRound, state.discussion.debateNeeded ? 1 : 0,
      state.specification.path, state.specification.status,
      JSON.stringify(state.phases), state.stateVersion, state.createdAt, state.updatedAt,
    ]
  )

  insertChildRows(db, wsId, state)

  renameSync(jsonPath, jsonPath + ".v1.bak")
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function getDb(directory: string): Database {
  const stateDir = join(directory, PLUGIN_STATE_DIR)
  mkdirSync(stateDir, { recursive: true })

  const dbPath = join(stateDir, "state.db")
  const db = new Database(dbPath, { create: true })

  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA synchronous = NORMAL")

  db.exec(SCHEMA_SQL)

  migrateFromJson(directory, db)

  return db
}

function insertChildRows(db: Database, wsId: string, state: DiscussionState): void {
  for (let i = 0; i < state.team.length; i++) {
    const m = state.team[i]
    db.run(
      "INSERT INTO mesa_team (workspace_id, persona_id, name, division, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      [wsId, m.personaId, m.name, m.division, m.status, i]
    )
  }

  for (const a of state.discussion.analyses) {
    db.run(
      "INSERT INTO mesa_analyses (workspace_id, agent_id, agent_name, content, turn, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      [wsId, a.agentId, a.agentName, a.content, a.turn, a.timestamp]
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

function insertSessionChildRows(db: Database, wsId: string, sessionId: string, state: DiscussionState): void {
  for (let i = 0; i < state.team.length; i++) {
    const m = state.team[i]
    db.run(
      "INSERT INTO mesa_session_team (workspace_id, session_id, persona_id, name, division, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [wsId, sessionId, m.personaId, m.name, m.division, m.status, i]
    )
  }

  for (const a of state.discussion.analyses) {
    db.run(
      "INSERT INTO mesa_session_analyses (workspace_id, session_id, agent_id, agent_name, content, turn, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [wsId, sessionId, a.agentId, a.agentName, a.content, a.turn, a.timestamp]
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

function loadSessionState(db: Database, wsId: string, sessionId: string): DiscussionState | null {
  const row = db
    .query("SELECT * FROM mesa_session_state WHERE workspace_id = ? AND session_id = ?")
    .get(wsId, sessionId) as Record<string, unknown> | null

  if (!row) return null

  const team = db
    .query("SELECT persona_id, name, division, status FROM mesa_session_team WHERE workspace_id = ? AND session_id = ? ORDER BY sort_order")
    .all(wsId, sessionId) as Array<{ persona_id: string; name: string; division: string; status: string }>

  const analyses = db
    .query("SELECT agent_id, agent_name, content, turn, timestamp FROM mesa_session_analyses WHERE workspace_id = ? AND session_id = ? ORDER BY turn")
    .all(wsId, sessionId) as Array<{ agent_id: string; agent_name: string; content: string; turn: number; timestamp: string }>

  const votes = db
    .query("SELECT agent_id, agent_name, vote, reason, round FROM mesa_session_votes WHERE workspace_id = ? AND session_id = ? ORDER BY round")
    .all(wsId, sessionId) as Array<{ agent_id: string; agent_name: string; vote: number; reason: string; round: number }>

  const participants = db
    .query("SELECT persona_id FROM mesa_session_participants WHERE workspace_id = ? AND session_id = ? ORDER BY sort_order")
    .all(wsId, sessionId) as Array<{ persona_id: string }>

  return rowToState(row, team, analyses, votes, participants)
}

function rowToState(
  row: Record<string, unknown>,
  team: Array<{ persona_id: string; name: string; division: string; status: string }>,
  analyses: Array<{ agent_id: string; agent_name: string; content: string; turn: number; timestamp: string }>,
  votes: Array<{ agent_id: string; agent_name: string; vote: number; reason: string; round: number }>,
  participants: Array<{ persona_id: string }>
): DiscussionState {
  return {
    workspaceId: row.workspace_id as string,
    currentPhase: row.current_phase as string as DiscussionState["currentPhase"],
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
      analyses: analyses.map((a) => ({
        agentId: a.agent_id,
        agentName: a.agent_name,
        content: a.content,
        turn: a.turn,
        timestamp: a.timestamp,
      })),
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
    },
    specification: {
      path: row.specification_path as string | null,
      status: row.specification_status as DiscussionState["specification"]["status"],
    },
    phases: JSON.parse((row.phases as string) || '["PLANNING","ANALYSIS","CONSENSUS","DOCUMENTATION","APPROVAL","EXECUTION"]'),
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

export async function loadState(directory: string): Promise<DiscussionState> {
  await initSession(directory)
  const sessionId = getSessionId(directory)

  const db = getDb(directory)
  try {
    // Try to load session-scoped state first
    if (sessionId) {
      const sessionState = loadSessionState(db, directory, sessionId)
      if (sessionState) return sessionState
    }

    // Fall back to unscoped state (backward compatibility)
    const row = db
      .query("SELECT * FROM mesa_state WHERE workspace_id = ?")
      .get(directory) as Record<string, unknown> | null

    if (!row) {
      return createInitialState(directory)
    }

    if ((row.state_version as number) !== CURRENT_STATE_VERSION) {
      console.warn(
        `[Mesa] State version mismatch: db=${row.state_version}, current=${CURRENT_STATE_VERSION}. ` +
        `Migration may be needed.`
      )
    }

    const team = db
      .query("SELECT persona_id, name, division, status FROM mesa_team WHERE workspace_id = ? ORDER BY sort_order")
      .all(directory) as Array<{ persona_id: string; name: string; division: string; status: string }>

    const analyses = db
      .query("SELECT agent_id, agent_name, content, turn, timestamp FROM mesa_analyses WHERE workspace_id = ? ORDER BY turn")
      .all(directory) as Array<{ agent_id: string; agent_name: string; content: string; turn: number; timestamp: string }>

    const votes = db
      .query("SELECT agent_id, agent_name, vote, reason, round FROM mesa_votes WHERE workspace_id = ? ORDER BY round")
      .all(directory) as Array<{ agent_id: string; agent_name: string; vote: number; reason: string; round: number }>

    const participants = db
      .query("SELECT persona_id FROM mesa_participants WHERE workspace_id = ? ORDER BY sort_order")
      .all(directory) as Array<{ persona_id: string }>

    return rowToState(row, team, analyses, votes, participants)
  } finally {
    db.close()
  }
}

export async function saveState(directory: string, state: DiscussionState): Promise<void> {
  await initSession(directory)
  const sessionId = getSessionId(directory)

  state.updatedAt = new Date().toISOString()

  const db = getDb(directory)
  try {
    const save = db.transaction(() => {
      // ALWAYS save to unscoped tables (backward compatibility)
      db.run(
        `INSERT OR REPLACE INTO mesa_state (
          workspace_id, current_phase, previous_phase,
          briefing_path, briefing_status, briefing_slug,
          discussion_topic, discussion_current_turn, discussion_max_turns,
          discussion_consensus_round, discussion_debate_needed,
          specification_path, specification_status,
          phases, state_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          state.workspaceId, state.currentPhase, state.previousPhase,
          state.briefing.path, state.briefing.status, state.briefing.slug,
          state.discussion.topic, state.discussion.currentTurn, state.discussion.maxTurns,
          state.discussion.consensusRound, state.discussion.debateNeeded ? 1 : 0,
          state.specification.path, state.specification.status,
          JSON.stringify(state.phases), state.stateVersion, state.createdAt, state.updatedAt,
        ]
      )

      db.run("DELETE FROM mesa_team WHERE workspace_id = ?", [state.workspaceId])
      db.run("DELETE FROM mesa_analyses WHERE workspace_id = ?", [state.workspaceId])
      db.run("DELETE FROM mesa_votes WHERE workspace_id = ?", [state.workspaceId])
      db.run("DELETE FROM mesa_participants WHERE workspace_id = ?", [state.workspaceId])

      insertChildRows(db, state.workspaceId, state)

      // ALSO save to scoped tables if we have a sessionId
      if (sessionId) {
        db.run(
          `INSERT OR REPLACE INTO mesa_session_state (
            workspace_id, session_id, current_phase, previous_phase,
            briefing_path, briefing_status, briefing_slug,
            discussion_topic, discussion_current_turn, discussion_max_turns,
            discussion_consensus_round, discussion_debate_needed,
            specification_path, specification_status,
            phases, state_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            state.workspaceId, sessionId, state.currentPhase, state.previousPhase,
            state.briefing.path, state.briefing.status, state.briefing.slug,
            state.discussion.topic, state.discussion.currentTurn, state.discussion.maxTurns,
            state.discussion.consensusRound, state.discussion.debateNeeded ? 1 : 0,
            state.specification.path, state.specification.status,
            JSON.stringify(state.phases), state.stateVersion, state.createdAt, state.updatedAt,
          ]
        )

        db.run("DELETE FROM mesa_session_team WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
        db.run("DELETE FROM mesa_session_analyses WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
        db.run("DELETE FROM mesa_session_votes WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])
        db.run("DELETE FROM mesa_session_participants WHERE workspace_id = ? AND session_id = ?", [state.workspaceId, sessionId])

        insertSessionChildRows(db, state.workspaceId, sessionId, state)
      }

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
