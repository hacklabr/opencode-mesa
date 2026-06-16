import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

export type {
  DiscussionPhase,
  ConsensusVote,
  BriefingStatus,
  SpecialistStatus,
  SpecificationStatus,
  AnalysisEntry,
  ConsensusVoteEntry,
  SpecialistEntry,
  DiscussionState,
} from "./types"

const __dirname = dirname(fileURLToPath(import.meta.url))

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"))
    return pkg.version
  } catch {
    return "0.0.0-unknown"
  }
}

export const PLUGIN_VERSION = readVersion()

export const PLUGIN_STATE_DIR = ".mesa"

export const DEFAULT_MAX_TURNS = 2

export const CURRENT_STATE_VERSION = 4

import type { DiscussionState } from "./types"

export function createInitialState(workspaceId: string): DiscussionState {
  const now = new Date().toISOString()
  return {
    workspaceId,
    currentPhase: "PLANNING",
    briefing: { path: null, status: "draft", slug: null },
    team: [],
    discussion: {
      topic: "",
      currentTurn: 0,
      maxTurns: DEFAULT_MAX_TURNS,
      analyses: [],
      votes: [],
      consensusRound: 0,
      participants: [],
      debateNeeded: false,
      mode: "analysis",
      maxConsensusRounds: 2,
      // Governance defaults (spec-4dcc492f)
      rigor: "standard",
      analysisMode: "parallel",
      deviations: 0,
    },
    specification: { path: null, status: "pending" },
    appendices: [],
    phases: ["PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION"],
    createdAt: now,
    updatedAt: now,
    stateVersion: CURRENT_STATE_VERSION,
    previousPhase: null,
  }
}
