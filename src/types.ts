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

export type AnalysisKind = "full" | "delta"

export type AnalysisTurnType = "analysis" | "discussion"

export interface AnalysisEntry {
  agentId: string
  agentName: string
  content: string              // FULL content — never truncated
  filePath?: string | null     // canonical .md path (null/undefined = legacy inline-only)
  kind?: AnalysisKind          // default "full" via migration
  turn: number
  turnType?: AnalysisTurnType  // discriminator: analysis vs discussion
  round?: number               // discussion round (turnType="discussion" only)
  positionInTurn?: number      // speaking order (turnType="discussion" only)
  respondsTo?: string          // optional, discussion only
  tensionsRaised?: string[]    // optional, discussion only
  sessionResumed?: boolean     // memory-integrity audit flag
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
    mode: "analysis" | "debate"  // current discussion mode
    maxConsensusRounds: number   // circuit breaker for CONSENSUS↔ANALYSIS loop
  }
  specification: {
    path: string | null
    status: SpecificationStatus
  }
  appendices: string[]
  phases: string[]
  createdAt: string
  updatedAt: string
  stateVersion: number
  previousPhase: DiscussionPhase | null
}
