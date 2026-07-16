/**
 * Phase enum collapsed 8→4 (spec-4dcc492f, Decision 3).
 * PAUSED/CANCELLED lifted into the orthogonal `status` field.
 */
export type DiscussionPhase =
  | "PLANNING"
  | "DISCUSSION"
  | "SPECIFICATION"
  | "EXECUTION"

/**
 * Orthogonal lifecycle status (spec-4dcc492f, Decision 3).
 * Decoupled from phase so pause/cancel no longer consume phase values.
 */
export type DiscussionStatus = "active" | "paused" | "cancelled"

/**
 * Sub-state within the DISCUSSION phase (spec-4dcc492f, Decision 3, Requirement 3).
 * Forward-only transitions: analysis → debate → voting.
 */
export type DiscussionMode = "analysis" | "debate" | "voting"

export type ConsensusVote = 0 | 1 | 2

export type BriefingStatus = "draft" | "approved" | "delivered"

export type JourneyWorkshopStatus =
  | "not_started"
  | "pending_human_decision"
  | "needed"
  | "in_progress"
  | "completed"
  | "skipped"

export type JourneyWorkshopMode = "guided" | "automatic"

export interface JourneyWorkshop {
  status: JourneyWorkshopStatus
  mode?: JourneyWorkshopMode | null
  detectedAt: string
  signals: string[]
  suggestedJourneys: string[]
  confidence: "high" | "medium" | "low"
  briefingPath?: string | null
  journeysFilePath?: string | null
  observations?: string
}

/**
 * Two-bucket scope classification (spec-fb0ba2d7, Decision 1).
 * Binary classifier with composite-default on ambiguity (asymmetric cost).
 */
export type ScopeMagnitude = "simple" | "composite"

/**
 * Non-technical dimension taxonomy (spec-fb0ba2d7, Decision 4).
 * Used for specialist division matching in team assembly.
 */
export type ScopeDimension =
  | "technical"
  | "human-social"
  | "cultural"
  | "political"
  | "economic"
  | "educational"
  | "behavioral"

/**
 * Adaptive scope metadata produced by the briefing-writer (spec-fb0ba2d7, Decision 5).
 * Null for legacy/imported briefings before the classifier runs.
 */
export interface BriefingMetadata {
  scopeMagnitude: ScopeMagnitude
  classificationReason: string
  subAreas?: string[]
  nonTechnicalDimensions: ScopeDimension[]
  nonTechnicalFlag: boolean
}

export type SpecialistStatus = "proposed" | "summoned" | "active" | "dismissed" | "delegated"

export type SpecificationStatus = "pending" | "draft" | "approved" | "rejected"

export type AnalysisKind = "full" | "delta"

export type AnalysisTurnType = "analysis" | "discussion"

/**
 * Governance profile controlling ceremony level (spec-4dcc492f, Decision 1).
 * Selected at team assembly with human confirmation.
 */
export type RigorProfile = "light" | "standard" | "deep"

/**
 * Turn topology for Turn 2+ analysis (spec-4dcc492f, Decision 5).
 * Turn 1 is ALWAYS parallel regardless of this value.
 */
export type AnalysisMode = "parallel" | "sequential" | "hybrid"

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
  registeredByManager?: boolean // true when Manager registered on behalf of specialist
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

export interface DiscussionProgress {
  currentTurn: number
  completedParticipants: string[]
  activeProfile: string
  deviations: number
}

export interface DiscussionState {
  workspaceId: string
  currentPhase: DiscussionPhase
  status: DiscussionStatus
  briefing: {
    path: string | null
    status: BriefingStatus
    slug: string | null
    metadata: BriefingMetadata | null
  }
  journeyWorkshop: JourneyWorkshop
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
    mode: DiscussionMode
    maxConsensusRounds: number   // circuit breaker for CONSENSUS↔ANALYSIS loop
    // --- Governance fields (spec-4dcc492f) ---
    rigor: RigorProfile          // Tier 2 profile (default "standard")
    analysisMode: AnalysisMode   // Turn 2+ topology (default "parallel")
    deviations: number           // Tier 3 deviation counter (default 0)
    // --- Observability (spec-4dcc492f, Decision 3, Requirement 1) ---
    progress: DiscussionProgress
  }
  specification: {
    path: string | null
    overviewPath: string | null
    status: SpecificationStatus
  }
  appendices: string[]
  phases: string[]
  /**
   * Session-scoped folder path (relative to workspace) where all artifacts for
   * this session live. Populated lazily on first tool invocation that needs it
   * (spec-6886df4f, TD4). Null until resolveSessionInput() has been called.
   */
  sessionFolder: string | null
  createdAt: string
  updatedAt: string
  stateVersion: number
  previousPhase: DiscussionPhase | null
}

// Memory system types
export type MemoryCategory = 'lesson' | 'observation' | 'preference' | 'architecture' | 'pitfall' | 'convention'
export type MemoryScope = 'project' | 'global'
export type MemoryStatus = 'active' | 'deleted'

export interface MemoryEntry {
  id: number
  workspace_id: string
  scope: MemoryScope
  category: MemoryCategory
  content: string
  source_agent: string
  source_session: string | null
  access_count: number
  last_accessed: string | null
  relevance_score: number
  expires_at: string | null
  status: MemoryStatus
  content_hash: string
  created_at: string
  updated_at: string
}
