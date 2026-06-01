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

export interface PhaseHeaderOptions {
  topic?: string
  currentTurn?: number
  maxTurns?: number
  participants?: string[]
  analysesCount?: number
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
  return parts.join(" | ")
}
