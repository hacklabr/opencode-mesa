import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { PLUGIN_STATE_DIR } from "../config"

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
