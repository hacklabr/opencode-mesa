import { join, resolve, relative, isAbsolute } from "node:path"
import { mkdirSync } from "node:fs"
import { PLUGIN_STATE_DIR } from "../config.js"

export function getAppendixPath(
  masterSpecId: string,
  phaseSlug: string,
  shortUuid: string
): string {
  return join(
    PLUGIN_STATE_DIR,
    "specifications",
    "appendices",
    `appendix-${masterSpecId}-${phaseSlug}-${shortUuid}.md`
  )
}

export function getPhaseAnalysisDraftPath(phaseId: string): string {
  return join(PLUGIN_STATE_DIR, "phase-analysis", phaseId)
}

export function ensureMesaDir(workspaceRoot: string): string {
  const mesaDir = join(workspaceRoot, PLUGIN_STATE_DIR)
  mkdirSync(mesaDir, { recursive: true })
  return mesaDir
}

/**
 * Build a session-scoped analysis file path.
 *
 * Formats:
 *   .mesa/analyses/{sessionId}/turn{N}/{personaId}.md
 *   .mesa/analyses/{sessionId}/discussion-r{R}/{personaId}.md
 *   .mesa/analyses/{sessionId}/ask_peer/{caller}_{callee}_{exchangeId}.md
 *
 * Returns a workspace-relative path (NOT absolute).
 */
export function buildAnalysisPath(
  sessionId: string,
  turn: number,
  personaId: string
): string {
  return join(
    PLUGIN_STATE_DIR,
    "analyses",
    sessionId,
    `turn${turn}`,
    `${personaId}.md`
  )
}

/**
 * Build a session-scoped discussion-round analysis path.
 */
export function buildDiscussionPath(
  sessionId: string,
  round: number,
  personaId: string
): string {
  return join(
    PLUGIN_STATE_DIR,
    "analyses",
    sessionId,
    `discussion-r${round}`,
    `${personaId}.md`
  )
}

/**
 * Build a session-scoped ask_peer exchange path.
 */
export function buildAskPeerPath(
  sessionId: string,
  callerId: string,
  calleeId: string,
  exchangeId: string
): string {
  return join(
    PLUGIN_STATE_DIR,
    "analyses",
    sessionId,
    "ask_peer",
    `${callerId}_${calleeId}_${exchangeId}.md`
  )
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
