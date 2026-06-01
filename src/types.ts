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

export type SpecialistStatus = "proposed" | "summoned" | "active" | "dismissed" | "delegated"

export type SpecificationStatus = "pending" | "draft" | "approved" | "rejected"

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
    participants: string[]
    debateNeeded: boolean
  }
  specification: {
    path: string | null
    status: SpecificationStatus
  }
  phases: string[]
  createdAt: string
  updatedAt: string
  stateVersion: number
  previousPhase: DiscussionPhase | null
}
