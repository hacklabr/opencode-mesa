/**
 * Phase enum collapsed 8→4 (spec-4dcc492f, Decision 3).
 * Since the v15 kernel cleanup (spec D6) this is a coarse DISPLAY value only —
 * no tool may gate on it. Guards are data preconditions enforced per tool.
 */
export type DiscussionPhase =
  | "PLANNING"
  | "DISCUSSION"
  | "SPECIFICATION"
  | "EXECUTION"

/**
 * Orthogonal lifecycle status (spec-4dcc492f, Decision 3).
 * The ONLY global mutation guard: tools reject mutations when not "active".
 */
export type DiscussionStatus = "active" | "paused" | "cancelled"

export type BriefingStatus = "draft" | "approved" | "delivered"

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
  roundId?: string             // v14: FK to Round.id (spec D2). Absent on legacy rows until backfilled.
  positionInTurn?: number      // speaking order (turnType="discussion" only)
  respondsTo?: string          // optional, discussion only
  tensionsRaised?: string[]    // optional, discussion only
  sessionResumed?: boolean     // memory-integrity audit flag
  registeredByManager?: boolean // true when Manager registered on behalf of specialist
  timestamp: string
}

// ---------------------------------------------------------------------------
// State v14 (spec D2/D4) — round primitive, deliverables, plan pointer.
// ---------------------------------------------------------------------------

export type RoundStatus = "open" | "closed"

export type RoundDecision =
  | "converged"
  | "converged-with-open-tensions"
  | "escalated"

/**
 * Outcome recorded when a round closes (spec D3). The Manager tabulates
 * declared positions; it never infers them. `positions` maps agentId → the
 * verbatim POSITION declared in the specialist's final artifact.
 */
export interface RoundOutcome {
  decision: RoundDecision
  summary: string
  tensions: string[]
  evidencePaths: string[]
  positions: Record<string, string>
}

/**
 * Universal discussion primitive (spec D2). Journey workshop, phase analysis,
 * conflict resolution — all become rounds with different labels/topics.
 * `rounds[]` is the execution TRACE: it records executed rounds, never the
 * planned graph (the plan lives in workflow-plan.md, spec D4).
 */
export interface Round {
  id: string                   // "r1", "r2", ... — "legacy-round-1" for v14 backfill
  topic: string
  participants: string[]       // ⊆ team (hard error at open)
  status: RoundStatus
  openedAt: string
  closedAt?: string
  outcome?: RoundOutcome
}

export type DeliverableStatus = "draft" | "approved" | "rejected"

/**
 * Generalizes specification/appendices/journeys (spec D2). `kind` is
 * open-ended ("specification", "overview", "appendix", "journeys", ...).
 */
export interface Deliverable {
  path: string                 // canonical, inside sessionFolder (K2)
  kind: string
  status: DeliverableStatus
  provenance: { roundIds: string[] }
}

/**
 * Pointer to the workflow plan document (spec D4, layer 2 — FATO).
 * The plan text itself lives in workflow-plan.md (layer 1 — INTENÇÃO);
 * the state stores only this resumable, data-checkable pointer.
 */
export interface PlanPointer {
  path: string
  version: number
  status: "draft" | "approved"
  approvedAt?: string
}

export interface SpecialistEntry {
  personaId: string
  name: string
  division: string
  status: SpecialistStatus
}

export interface DiscussionState {
  workspaceId: string
  currentPhase: DiscussionPhase   // DISPLAY only — nothing gates on it (spec D6)
  status: DiscussionStatus
  briefing: {
    path: string | null
    status: BriefingStatus
    slug: string | null
    metadata: BriefingMetadata | null
  }
  team: SpecialistEntry[]
  discussion: {
    topic: string
    currentTurn: number
    maxTurns: number
    analyses: AnalysisEntry[]
    participants: string[]
  }
  // --- State v14 (spec D2/D4) ---
  rounds: Round[]
  deliverables: Deliverable[]
  plan: PlanPointer | null
  /**
   * Session-scoped folder path (relative to workspace) where all artifacts for
   * this session live. Populated lazily on first tool invocation that needs it
   * (spec-6886df4f, TD4). Null until resolveSessionInput() has been called.
   */
  sessionFolder: string | null
  createdAt: string
  updatedAt: string
  stateVersion: number
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
  synced_at: string | null
}
