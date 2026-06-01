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

export const PLUGIN_VERSION = "0.1.0"

export const PLUGIN_STATE_DIR = ".mesa"

export const DEFAULT_MAX_TURNS = 2

export const CURRENT_STATE_VERSION = 1

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
    },
    specification: { path: null, status: "pending" },
    phases: ["PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION"],
    createdAt: now,
    updatedAt: now,
    stateVersion: 1,
    previousPhase: null,
  }
}
