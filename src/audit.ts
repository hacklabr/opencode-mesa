import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { PLUGIN_STATE_DIR } from "./config"

export interface AuditEntry {
  timestamp: string
  action: string
  phase: string
  actor?: string
  details?: Record<string, unknown>
}

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
