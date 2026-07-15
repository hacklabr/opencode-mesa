import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { PLUGIN_STATE_DIR } from "./config.js"

export interface AuditEntry {
  timestamp: string
  action: string
  phase: string
  actor?: string
  details?: Record<string, unknown>
}

/**
 * Append an audit entry to the global audit log.
 *
 * Decision M8 (spec-6886df4f): the audit log is consolidated to a single
 * `.mesa/audit.log` file. The previous per-session `audit-{sessionId}.log`
 * scheme fragmented the audit trail and made it hard to reconstruct
 * cross-session event sequences. One workspace → one audit log.
 */
export async function logAction(
  directory: string,
  action: string,
  phase: string,
  details?: Record<string, unknown>
): Promise<void> {
  const logDir = join(directory, PLUGIN_STATE_DIR)
  await mkdir(logDir, { recursive: true })

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    phase,
    ...(details ? { details } : {}),
  }

  const logPath = join(logDir, "audit.log")
  await appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8")
}
