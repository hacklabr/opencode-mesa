import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { DiscussionState } from "./config"
import { PLUGIN_STATE_DIR } from "./config"
import { createInitialState } from "./config"

const STATE_FILENAME = "state.json"

export async function getWorkspaceStateDir(directory: string): Promise<string> {
  const stateDir = join(directory, PLUGIN_STATE_DIR)
  await fs.mkdir(stateDir, { recursive: true })
  return stateDir
}

export async function getStatePath(directory: string): Promise<string> {
  const stateDir = await getWorkspaceStateDir(directory)
  return join(stateDir, STATE_FILENAME)
}

export async function loadState(directory: string): Promise<DiscussionState> {
  const statePath = await getStatePath(directory)
  try {
    const raw = await fs.readFile(statePath, "utf-8")
    const parsed = JSON.parse(raw) as DiscussionState
    return parsed
  } catch {
    return createInitialState(directory)
  }
}

export async function saveState(directory: string, state: DiscussionState): Promise<void> {
  const statePath = await getStatePath(directory)
  state.updatedAt = new Date().toISOString()
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8")
}
