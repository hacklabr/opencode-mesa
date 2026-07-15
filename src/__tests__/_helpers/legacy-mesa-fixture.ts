import { promises as fs } from "node:fs"
import { join, dirname } from "node:path"
import { openDatabase, type IDatabase } from "../../db/driver.js"

/**
 * Builds a synthetic legacy .mesa/ directory for migration testing.
 *
 * Creates the pre-refactor layout:
 *   .mesa/
 *     state.db  (with a v10 session row pointing to legacy paths)
 *     briefings/briefing-{slug}.md
 *     specifications/spec-{8hex}.md
 *     specifications/overview-{8hex}.md
 *     specifications/appendices/appendix-{masterSpecId}-{phaseSlug}-{uuid}.md
 *     analyses/{sessionId}/turn1/{personaId}.md
 *
 * Returns the test directory and the session details.
 */
export interface LegacySession {
  sessionId: string
  slug: string
  createdAt: string
  startedAt: string
  briefingContent: string
  specContent: string
  overviewContent: string
  masterSpecId: string
  appendixBasename: string
  phaseSlug: string
  shortUuid: string
}

export async function createLegacyMesaStructure(
  testDir: string,
  overrides?: Partial<LegacySession>
): Promise<LegacySession & { db: IDatabase }> {
  const defaults: LegacySession = {
    sessionId: "ses_a1b2c3d4e5f6",
    slug: "legacy-project",
    createdAt: "2026-06-01T10:00:00.000Z",
    startedAt: "2026-06-01T10:00:00.000Z",
    briefingContent: "# Legacy Briefing\n\nOld content.",
    specContent: "# Legacy Spec\n\nMicroservices architecture.",
    overviewContent: "# Legacy Overview\n\nHuman summary.",
    masterSpecId: "aabbccdd",
    appendixBasename: "appendix-aabbccdd-phase-1-eeff0011.md",
    phaseSlug: "phase-1",
    shortUuid: "eeff0011",
  }
  const session = { ...defaults, ...overrides }
  const mesaDir = join(testDir, ".mesa")

  // Ensure .mesa directory exists
  await fs.mkdir(mesaDir, { recursive: true })

  // Create legacy briefings/
  await fs.mkdir(join(mesaDir, "briefings"), { recursive: true })
  const briefingPath = join(mesaDir, "briefings", `briefing-${session.slug}.md`)
  await fs.writeFile(briefingPath, session.briefingContent, "utf-8")

  // Create legacy specifications/
  await fs.mkdir(join(mesaDir, "specifications"), { recursive: true })
  const specPath = join(mesaDir, "specifications", `spec-${session.masterSpecId}.md`)
  await fs.writeFile(specPath, session.specContent, "utf-8")

  const overviewPath = join(mesaDir, "specifications", `overview-${session.masterSpecId}.md`)
  await fs.writeFile(overviewPath, session.overviewContent, "utf-8")

  // Create legacy specifications/appendices/
  await fs.mkdir(join(mesaDir, "specifications", "appendices"), { recursive: true })
  const appendixPath = join(mesaDir, "specifications", "appendices", session.appendixBasename)
  await fs.writeFile(
    appendixPath,
    `---\nmaster_spec: "spec-${session.masterSpecId}.md"\n---\n\n# Phase Appendix`,
    "utf-8"
  )

  // Create legacy analyses/{sessionId}/turn1/
  await fs.mkdir(join(mesaDir, "analyses", session.sessionId, "turn1"), { recursive: true })
  await fs.writeFile(
    join(mesaDir, "analyses", session.sessionId, "turn1", "backend-architect.md"),
    "Analysis content",
    "utf-8"
  )

  // Create a state.db at v10 with a session row pointing to legacy paths
  const dbPath = join(mesaDir, "state.db")
  const db = openDatabase(dbPath, { create: true })

  // Create the v10-era mesa_session table
  db.exec(`
    CREATE TABLE IF NOT EXISTS mesa_session (
      session_id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      hostname TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `)

  db.run(
    "INSERT INTO mesa_session (session_id, pid, hostname, started_at, last_heartbeat, status) VALUES (?, ?, ?, ?, ?, 'active')",
    [session.sessionId, process.pid, "test-host", session.startedAt, session.startedAt]
  )

  // Create v10-era mesa_session_state (no session_folder column)
  db.exec(`
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
      journey_workshop TEXT,
      rigor TEXT DEFAULT 'standard',
      analysis_mode TEXT DEFAULT 'parallel',
      deviations INTEGER DEFAULT 0,
      state_version INTEGER DEFAULT 5,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, session_id)
    )
  `)

  // Insert a row at state_version 10 with legacy paths
  // Use ABSOLUTE paths to simulate pre-refactor storage
  const absBriefingPath = join(testDir, ".mesa", "briefings", `briefing-${session.slug}.md`)
  const absSpecPath = join(testDir, ".mesa", "specifications", `spec-${session.masterSpecId}.md`)
  const absOverviewPath = join(testDir, ".mesa", "specifications", `overview-${session.masterSpecId}.md`)
  const appendicesJson = JSON.stringify([session.appendixBasename])

  db.run(
    `INSERT INTO mesa_session_state (
      workspace_id, session_id, current_phase, status,
      briefing_path, briefing_status, briefing_slug,
      specification_path, specification_overview_path, specification_status,
      appendices, state_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      testDir, session.sessionId, "EXECUTION", "active",
      absBriefingPath, "approved", session.slug,
      absSpecPath, absOverviewPath, "approved",
      appendicesJson, 10, session.createdAt, session.createdAt,
    ]
  )

  // Create mesa_session_analyses with legacy file_path
  db.exec(`
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
    )
  `)

  const legacyAnalysisPath = join(
    ".mesa", "analyses", session.sessionId, "turn1", "backend-architect.md"
  )
  db.run(
    `INSERT INTO mesa_session_analyses (workspace_id, session_id, agent_id, agent_name, content, turn, timestamp, file_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [testDir, session.sessionId, "backend-architect", "Backend Architect", "Analysis", 1, session.createdAt, legacyAnalysisPath]
  )

  return { ...session, db }
}
