import type { DiscussionState } from "../types.js"

/**
 * Plan-gate instruction (spec D4/D9) — single source of truth for the
 * "no approved plan" recovery guidance, surfaced by mesa_status (ambient)
 * and open_round (hard precondition).
 *
 * Returns null when the plan is approved. Otherwise distinguishes:
 *  - LEGACY session (v14/v15-migrated: rounds[] contains a "legacy-*" round):
 *    the workflow was approved under the OLD pipeline — silently adopting a
 *    synthesized plan would violate the plan gate retroactively. The Manager
 *    must synthesize the plan mapping and present it to the human.
 *  - FRESH session: the Manager writes the plan before the first round (gate 0).
 */
export function planGateInstruction(state: DiscussionState): string | null {
  if (state.plan?.status === "approved") return null

  const isLegacy = state.rounds.some((r) => r.id.startsWith("legacy-"))

  if (isLegacy) {
    return [
      "LEGACY SESSION — no approved plan.",
      "This session was migrated from the old pipeline; its workflow was approved under rules that no longer exist.",
      "Before any open_round: synthesize a workflow-plan.md mapping existing artifacts (rounds, analyses, deliverables) to the remaining steps,",
      "present it to the human as a plan gate, and record the approval via record_decision type:\"gate\" target:\"plan\".",
    ].join("\n")
  }

  return [
    "No approved workflow plan.",
    "Before any open_round: write workflow-plan.md in the session folder, present it to the human (gate 0),",
    "and record the approval via record_decision type:\"gate\" target:\"plan\".",
  ].join("\n")
}
