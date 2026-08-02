/**
 * Phase/mode state machine deleted (spec D6 — guards are now data
 * preconditions enforced inside each tool). Only the observability header
 * survives: `currentPhase` remains a coarse DISPLAY value, and nothing may
 * gate on it.
 */

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
