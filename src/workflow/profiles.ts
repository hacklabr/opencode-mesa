/**
 * Rigor profiles and analysis-mode governance (spec-4dcc492f, Decisions 1, 2, 5).
 *
 * Tier model:
 * - Tier 1 hard invariants (hardMaxTurns ceiling) — code-enforced, no override.
 * - Tier 2 profile defaults (profileTurns soft bound) — tool-level, selectable at team assembly.
 * - Tier 3 deviations — Manager-initiated, bounded by the deviation rate cap.
 *
 * Turn 1 is ALWAYS parallel regardless of analysisMode (independence / anti-anchoring invariant).
 */

export type RigorProfile = "light" | "standard" | "deep"

export type AnalysisMode = "parallel" | "sequential" | "hybrid"

export interface ProfileConfig {
  /** Tier 2 soft bound — Manager may extend beyond this with a logged reason. */
  profileTurns: number
  /** Tier 1 hard ceiling — non-raisable without human authorization. */
  hardMaxTurns: number
  /** Whether a consensus vote is required before specification. */
  votingRequired: boolean
  /** Whether a mandatory debate round is required on disagreement. */
  debateRequired: boolean
}

export const RIGOR_PROFILES: Record<RigorProfile, ProfileConfig> = {
  light: { profileTurns: 1, hardMaxTurns: 2, votingRequired: false, debateRequired: false },
  standard: { profileTurns: 2, hardMaxTurns: 5, votingRequired: true, debateRequired: false },
  deep: { profileTurns: 3, hardMaxTurns: 7, votingRequired: true, debateRequired: true },
}

export const DEFAULT_RIGOR: RigorProfile = "standard"
export const DEFAULT_ANALYSIS_MODE: AnalysisMode = "parallel"

/**
 * Maximum allowed procedural deviations per session (Tier 3 rate cap).
 * Exceeding this triggers human re-selection of the profile.
 */
export const DEVIATION_RATE_CAP = 3

export function getProfile(rigor: RigorProfile): ProfileConfig {
  const config = RIGOR_PROFILES[rigor]
  if (!config) {
    throw new Error(`Unknown rigor profile: ${rigor}`)
  }
  return config
}

/**
 * Per-turn ask_peer consultation cap by rigor profile.
 * `standard`: 2 consultations per specialist per turn.
 * `deep`: unlimited (NaN sentinel means "no cap").
 * `light`: not applicable (single turn, no sequential phase).
 */
export function peerConsultationCap(rigor: RigorProfile): number {
  if (rigor === "deep") return Number.POSITIVE_INFINITY
  return 2
}
