import type { DiscussionPhase, DiscussionState, DiscussionMode } from "../types.js"

/**
 * Phase enum collapsed 8→4 (spec-4dcc492f, Decision 3).
 * PAUSED/CANCELLED are handled by the orthogonal `status` field, not phases.
 */
export const ALL_PHASES: DiscussionPhase[] = [
  "PLANNING",
  "DISCUSSION",
  "SPECIFICATION",
  "EXECUTION",
]

/**
 * Valid phase transitions (spec-4dcc492f, Decision 3).
 * Back-edges preserve re-analysis and spec-rejection semantics.
 */
export const VALID_TRANSITIONS: Record<DiscussionPhase, DiscussionPhase[]> = {
  PLANNING: ["DISCUSSION"],
  DISCUSSION: ["SPECIFICATION", "PLANNING"],
  SPECIFICATION: ["EXECUTION", "DISCUSSION"],
  EXECUTION: ["PLANNING"],
}

export function canTransition(from: DiscussionPhase, to: DiscussionPhase): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Phase guard — also enforces that the discussion status is "active".
 * Paused or cancelled discussions reject all phase-gated operations.
 */
export function requirePhase(
  state: DiscussionState,
  ...allowed: DiscussionPhase[]
): string | null {
  if (state.status !== "active") {
    return `Operation not allowed when discussion status is "${state.status}". Resume the discussion before proceeding.`
  }
  if (!allowed.includes(state.currentPhase)) {
    return `Operation not allowed in ${state.currentPhase} phase. Required: ${allowed.join(" or ")}.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Discussion mode transition discipline (spec-4dcc492f, Decision 3, Req 3)
// ---------------------------------------------------------------------------

/**
 * Mode transitions within the DISCUSSION phase (spec-4dcc492f, Decision 3, Req 3).
 * Main flow is forward-only: analysis → debate → voting.
 * The voting → debate back-edge preserves the disagreement-resolution path
 * (vote fails → debate round → re-vote). Re-analysis uses the phase-level
 * DISCUSSION → PLANNING back-edge instead.
 */
export const VALID_MODE_TRANSITIONS: Record<DiscussionMode, DiscussionMode[]> = {
  analysis: ["debate", "voting"],
  debate: ["voting"],
  voting: ["debate"],
}

export function canTransitionMode(from: DiscussionMode, to: DiscussionMode): boolean {
  return VALID_MODE_TRANSITIONS[from]?.includes(to) ?? false
}

export function requireMode(
  state: DiscussionState,
  ...allowed: DiscussionMode[]
): string | null {
  if (!allowed.includes(state.discussion.mode)) {
    return `Operation not allowed in discussion mode "${state.discussion.mode}". Required: ${allowed.join(" or ")}.`
  }
  return null
}

export interface PhaseHeaderOptions {
  topic?: string
  currentTurn?: number
  maxTurns?: number
  participants?: string[]
  analysesCount?: number
  mode?: DiscussionMode
}

export function formatPhaseHeader(
  phase: string,
  options?: PhaseHeaderOptions
): string {
  const base = `[Mesa · Phase: ${phase}]`
  if (!options) return base

  const parts = [base]
  if (options.topic) parts.push(`Topic: ${options.topic}`)
  if (options.currentTurn && options.maxTurns) {
    parts.push(`Turn: ${options.currentTurn}/${options.maxTurns}`)
  }
  if (options.participants && options.participants.length > 0 && options.analysesCount !== undefined) {
    parts.push(`Progress: ${options.analysesCount}/${options.participants.length}`)
  }
  if (options.mode) {
    parts.push(`Mode: ${options.mode}`)
  }
  return parts.join(" | ")
}
