import type { DiscussionPhase, DiscussionState } from "../types"

export const ALL_PHASES: DiscussionPhase[] = [
  "PLANNING",
  "ANALYSIS",
  "CONSENSUS",
  "DOCUMENTATION",
  "APPROVAL",
  "EXECUTION",
  "PAUSED",
  "CANCELLED",
]

export const VALID_TRANSITIONS: Record<DiscussionPhase, DiscussionPhase[]> = {
  PLANNING: ["ANALYSIS", "PAUSED", "CANCELLED"],
  ANALYSIS: ["CONSENSUS", "PAUSED", "CANCELLED"],
  CONSENSUS: ["DOCUMENTATION", "ANALYSIS", "PAUSED", "CANCELLED"],
  DOCUMENTATION: ["APPROVAL", "PAUSED", "CANCELLED"],
  APPROVAL: ["EXECUTION", "DOCUMENTATION", "PAUSED", "CANCELLED"],
  EXECUTION: ["PLANNING", "PAUSED", "CANCELLED"],
  PAUSED: ["PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION", "CANCELLED"],
  CANCELLED: ["PLANNING"],
}

export function canTransition(from: DiscussionPhase, to: DiscussionPhase): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function requirePhase(
  state: DiscussionState,
  ...allowed: DiscussionPhase[]
): string | null {
  if (!allowed.includes(state.currentPhase)) {
    return `Operation not allowed in ${state.currentPhase} phase. Required: ${allowed.join(" or ")}.`
  }
  return null
}

export function formatPhaseHeader(phase: string): string {
  return `[Mesa · Phase: ${phase}]`
}
