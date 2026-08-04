import { join, resolve, relative, isAbsolute } from "node:path"
import { mkdirSync } from "node:fs"
import { PLUGIN_STATE_DIR } from "../config.js"
import type { IDatabase } from "../db/driver.js"
import type { DiscussionState } from "../types.js"

// ---------------------------------------------------------------------------
// Session-scoped folder architecture (spec-6886df4f)
// ---------------------------------------------------------------------------

/**
 * Input contract for building session-scoped paths.
 * `createdAt` is the ISO timestamp from mesa_session.started_at.
 * `sessionId` is the full session ID (UUID or ses_...).
 * `slug` is the briefing slug (will be sanitized).
 */
export interface SessionFolderInput {
  createdAt: string
  sessionId: string
  slug: string
}

/**
 * Strip the `ses_` prefix (if any) and take the first 4 hex chars of the
 * remaining ID. Falls back to "xxxx" when no hex is found.
 *
 * Decision M1 (spec-6886df4f): short form is `d19d`, not `ses_d19d`, to keep
 * the folder name to 3 clean segments.
 */
export function shortSessionId(sessionId: string): string {
  const stripped = sessionId.replace(/^ses_/, "")
  const hexPart = stripped.replace(/[^a-f0-9]/g, "").slice(0, 4)
  return hexPart || "xxxx"
}

/**
 * Sanitize a briefing slug for use in a filesystem folder name.
 * Lowercases, strips accents, replaces non-alphanumeric runs with `-`,
 * caps at 50 chars, and falls back to "untitled" when empty.
 */
export function sanitizeSlugForFs(slug: string): string {
  const sanitized = slug
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
  return sanitized || "untitled"
}

/**
 * Pure function. No I/O, no side effects, no randomness.
 * Returns a workspace-RELATIVE path:
 *   .mesa/sessions/{YYYYMMDDHHmm}_{4hex}_{sanitized-slug}
 *
 * Decision M2 (spec-6886df4f): timestamp comes from mesa_session.started_at,
 * which is stable across resumes.
 *
 * @example
 *   buildSessionFolderPath({
 *     createdAt: "2026-07-13T15:34:00.000Z",
 *     sessionId: "ses_d19dbe71-...",
 *     slug: "Analise Segurança",
 *   })
 *   // → ".mesa/sessions/202607131534_d19d_analise-seguranca"
 */
export function buildSessionFolderPath(input: SessionFolderInput): string {
  const ts = new Date(input.createdAt)
  // Format as YYYYMMDDHHmm in UTC for stable, sort-friendly folder names.
  const pad = (n: number) => String(n).padStart(2, "0")
  const tsStr =
    `${ts.getUTCFullYear()}${pad(ts.getUTCMonth() + 1)}${pad(ts.getUTCDate())}` +
    `${pad(ts.getUTCHours())}${pad(ts.getUTCMinutes())}`
  const short = shortSessionId(input.sessionId)
  const slug = sanitizeSlugForFs(input.slug)
  const folderName = `${tsStr}_${short}_${slug}`
  return join(PLUGIN_STATE_DIR, "sessions", folderName)
}

// ---------------------------------------------------------------------------
// Delegating constructors — all session-scoped artifacts
// ---------------------------------------------------------------------------

/**
 * Build the canonical briefing path inside the session folder.
 * Returns a workspace-relative path: `.mesa/sessions/{folder}/briefing.md`
 */
export function buildBriefingPath(input: SessionFolderInput): string {
  return join(buildSessionFolderPath(input), "briefing.md")
}

/**
 * Build the canonical specification path inside the session folder.
 * Returns a workspace-relative path: `.mesa/sessions/{folder}/specification.md`
 *
 * Decision P5 (spec-6886df4f): fixed filename `specification.md` replaces the
 * non-deterministic `spec-{randomUUID().slice(0,8)}.md`.
 */
export function buildSpecificationPath(input: SessionFolderInput): string {
  return join(buildSessionFolderPath(input), "specification.md")
}

/**
 * Build the canonical overview path inside the session folder.
 * Returns a workspace-relative path: `.mesa/sessions/{folder}/overview.md`
 */
export function buildOverviewPath(input: SessionFolderInput): string {
  return join(buildSessionFolderPath(input), "overview.md")
}

/**
 * Build the canonical workflow-plan path inside the session folder.
 * Returns a workspace-relative path: `.mesa/sessions/{folder}/workflow-plan.md`
 *
 * The plan path is OWNED by the plugin (never supplied by the agent), so that
 * concurrent sessions never collide on a shared `.mesa/workflow-plan.md`.
 * Mirrors buildBriefingPath / buildSpecificationPath (spec-6886df4f, K2).
 */
export function buildPlanPath(input: SessionFolderInput): string {
  return join(buildSessionFolderPath(input), "workflow-plan.md")
}

/**
 * Build a session-scoped analysis file path.
 *
 * Format:
 *   .mesa/sessions/{folder}/analyses/turn{N}/{personaId}.md
 *
 * Returns a workspace-relative path (NOT absolute).
 */
export function buildAnalysisPath(
  input: SessionFolderInput,
  turn: number,
  personaId: string
): string {
  return join(
    buildSessionFolderPath(input),
    "analyses",
    `turn${turn}`,
    `${personaId}.md`
  )
}

/**
 * Build a session-scoped discussion-round analysis path.
 *
 * Format:
 *   .mesa/sessions/{folder}/analyses/discussion-r{R}/{personaId}.md
 */
export function buildDiscussionPath(
  input: SessionFolderInput,
  round: number,
  personaId: string
): string {
  return join(
    buildSessionFolderPath(input),
    "analyses",
    `discussion-r${round}`,
    `${personaId}.md`
  )
}

/**
 * Build a session-scoped ask_peer exchange path.
 *
 * Format:
 *   .mesa/sessions/{folder}/analyses/ask_peer/{caller}_{callee}_{id}.md
 */
export function buildAskPeerPath(
  input: SessionFolderInput,
  callerId: string,
  calleeId: string,
  exchangeId: string
): string {
  return join(
    buildSessionFolderPath(input),
    "analyses",
    "ask_peer",
    `${callerId}_${calleeId}_${exchangeId}.md`
  )
}

/**
 * Build the canonical appendix path inside the session folder.
 *
 * Decision (spec-6886df4f, TD2): `masterSpecId` is dropped — appendices are
 * now session-scoped, not spec-scoped. The phase slug + short UUID is enough
 * to disambiguate.
 *
 * Format:
 *   .mesa/sessions/{folder}/appendices/appendix-{phaseSlug}-{uuid}.md
 */
export function getAppendixPath(
  input: SessionFolderInput,
  phaseSlug: string,
  shortUuid: string
): string {
  return join(
    buildSessionFolderPath(input),
    "appendices",
    `appendix-${phaseSlug}-${shortUuid}.md`
  )
}

/**
 * Build the phase-analysis draft directory path inside the session folder.
 * Decision M3 (spec-6886df4f): phase analysis is inherently session-scoped.
 *
 * Format:
 *   .mesa/sessions/{folder}/phase-analysis/{phaseId}
 */
export function getPhaseAnalysisDraftPath(
  input: SessionFolderInput,
  phaseId: string
): string {
  return join(buildSessionFolderPath(input), "phase-analysis", phaseId)
}

// ---------------------------------------------------------------------------
// Path resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a stored (possibly relative) path against the workspace directory.
 * If the stored path is already absolute, it is returned as-is. Otherwise the
 * workspace directory is prepended.
 *
 * Decision TD3 (spec-6886df4f): paths in state.db are stored RELATIVE to the
 * workspace (e.g. `.mesa/sessions/{folder}/briefing.md`). Every I/O site that
 * reads a path from state must prepend `context.directory` via this helper.
 */
export function resolveAbsolutePath(workspaceDir: string, storedPath: string): string {
  return isAbsolute(storedPath) ? storedPath : join(workspaceDir, storedPath)
}

/**
 * Resolve the SessionFolderInput for the current session by querying
 * mesa_session.started_at and combining it with state.briefing.slug.
 *
 * Decision M2 + TD7 (spec-6886df4f): started_at is authoritative; the slug
 * defaults to "untitled" when no briefing has been created yet.
 */
export async function resolveSessionInput(
  directory: string,
  state: DiscussionState,
  sessionId: string,
  getDb: (dir: string) => IDatabase
): Promise<SessionFolderInput> {
  const db = getDb(directory)
  try {
    const row = db
      .query("SELECT started_at FROM mesa_session WHERE session_id = ?")
      .get(sessionId) as { started_at: string } | null
    const createdAt = row?.started_at ?? state.createdAt
    const slug = state.briefing.slug ?? "untitled"
    return { createdAt, sessionId, slug }
  } finally {
    db.close()
  }
}

/**
 * Convenience wrapper: resolve SessionFolderInput AND cache the computed
 * folder path on state.sessionFolder (idempotent). Tools should call this
 * once per invocation to get the input for all path constructors.
 *
 * Note: the caller is responsible for persisting state if sessionFolder was
 * newly set (most tools already saveState at the end of execution).
 */
export async function ensureSessionInput(
  directory: string,
  state: DiscussionState,
  sessionId: string,
  getDb: (dir: string) => IDatabase
): Promise<SessionFolderInput> {
  const input = await resolveSessionInput(directory, state, sessionId, getDb)
  if (!state.sessionFolder) {
    state.sessionFolder = buildSessionFolderPath(input)
  }
  return input
}

// ---------------------------------------------------------------------------
// Generic helpers (unchanged)
// ---------------------------------------------------------------------------

export function ensureMesaDir(workspaceRoot: string): string {
  const mesaDir = join(workspaceRoot, PLUGIN_STATE_DIR)
  mkdirSync(mesaDir, { recursive: true })
  return mesaDir
}

/**
 * Validate that a path is within the workspace directory.
 * Rejects path traversal (..) and absolute paths.
 * Returns the resolved path if valid, or null if invalid.
 */
export function validateWorkspacePath(
  workspaceDir: string,
  inputPath: string
): { valid: true; resolved: string } | { valid: false; error: string } {
  const resolved = resolve(workspaceDir, inputPath)
  const rel = relative(workspaceDir, resolved)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      valid: false,
      error: `Path must be within workspace: ${inputPath}`,
    }
  }
  return { valid: true, resolved }
}
