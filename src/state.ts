import { rename, unlink, writeFile, readFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import { z, ZodError } from "zod"
import type { DiscussionState } from "./types"
import { PLUGIN_STATE_DIR, CURRENT_STATE_VERSION } from "./config"
import { createInitialState } from "./config"

const STATE_FILENAME = "state.json"

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

async function cleanupOrphanedTmpFiles(stateDir: string): Promise<void> {
  try {
    const entries = await readdir(stateDir)
    for (const entry of entries) {
      if (entry.endsWith(".tmp")) {
        try {
          await unlink(join(stateDir, entry))
        } catch {
          // ignore individual cleanup failures
        }
      }
    }
  } catch {
    // directory may not exist yet
  }
}

export async function getWorkspaceStateDir(directory: string): Promise<string> {
  const stateDir = join(directory, PLUGIN_STATE_DIR)
  await mkdir(stateDir, { recursive: true })
  return stateDir
}

export async function getStatePath(directory: string): Promise<string> {
  const stateDir = await getWorkspaceStateDir(directory)
  return join(stateDir, STATE_FILENAME)
}

export async function loadState(directory: string): Promise<DiscussionState> {
  const stateDir = await getWorkspaceStateDir(directory)
  await cleanupOrphanedTmpFiles(stateDir)

  const statePath = join(stateDir, STATE_FILENAME)
  const bakPath = statePath + ".bak"
  try {
    const raw = await readFile(statePath, "utf-8")
    const parsed = JSON.parse(raw)
    const state = DiscussionStateSchema.parse(parsed) as DiscussionState

    if (state.stateVersion !== CURRENT_STATE_VERSION) {
      console.warn(
        `[Mesa] State version mismatch: file=${state.stateVersion}, current=${CURRENT_STATE_VERSION}. ` +
        `Migration may be needed.`
      )
    }

    return state
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return createInitialState(directory)
    }
    if (err instanceof ZodError) {
      try {
        const bakRaw = await readFile(bakPath, "utf-8")
        const bakParsed = JSON.parse(bakRaw)
        return DiscussionStateSchema.parse(bakParsed) as DiscussionState
      } catch {
        const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        throw new Error(
          `Mesa state file is corrupted (validation failed): ${statePath}. ` +
            `Issues: ${issues}. ` +
            `A backup may exist at ${bakPath}.`
        )
      }
    }
    throw new Error(
      `Mesa state file is corrupted and cannot be parsed: ${statePath}. ` +
        `A backup may exist at ${bakPath}. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export async function saveState(directory: string, state: DiscussionState): Promise<void> {
  const statePath = await getStatePath(directory)
  const tmpPath = statePath + ".tmp"
  const bakPath = statePath + ".bak"
  state.updatedAt = new Date().toISOString()

  try {
    await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8")
  } catch (err) {
    try { await unlink(tmpPath) } catch { /* ignore cleanup failure */ }
    throw err
  }

  try {
    await rename(statePath, bakPath)
  } catch (err) {
    if (!(err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
      try { await unlink(tmpPath) } catch { /* ignore cleanup failure */ }
      throw err
    }
  }

  await rename(tmpPath, statePath)
}
