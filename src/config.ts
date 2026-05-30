export const PLUGIN_VERSION = "0.1.0"

export const PLUGIN_STATE_DIR = ".mesa"

export const DEFAULT_MAX_TURNS = 2

export type DiscussionPhase =
  | "PLANNING"
  | "ANALYSIS"
  | "CONSENSUS"
  | "DOCUMENTATION"
  | "APPROVAL"
  | "EXECUTION"
  | "PAUSED"
  | "CANCELLED"

export type ConsensusVote = 0 | 1 | 2

export type BriefingStatus = "draft" | "approved" | "delivered"

export type SpecialistStatus = "proposed" | "summoned" | "active" | "dismissed"

export interface AnalysisEntry {
  agentId: string
  agentName: string
  content: string
  turn: number
  timestamp: string
}

export interface ConsensusVoteEntry {
  agentId: string
  agentName: string
  vote: ConsensusVote
  reason: string
  round: number
}

export interface SpecialistEntry {
  personaId: string
  name: string
  division: string
  status: SpecialistStatus
}

export interface DiscussionState {
  workspaceId: string
  currentPhase: DiscussionPhase
  briefing: {
    path: string | null
    status: BriefingStatus
    slug: string | null
  }
  team: SpecialistEntry[]
  discussion: {
    topic: string
    currentTurn: number
    maxTurns: number
    analyses: AnalysisEntry[]
    votes: ConsensusVoteEntry[]
    consensusRound: number
  }
  specification: {
    path: string | null
    status: "pending" | "draft" | "approved" | "rejected"
  }
  createdAt: string
  updatedAt: string
}

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
    createdAt: now,
    updatedAt: now,
  }
}
