import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Persona prompt denylist (spec D9 Phase 2 / T10).
 *
 * Asserts that src/agents/*.md contains ZERO references to tools that die or are
 * renamed per spec D5 (mesa-flexible-workflow). A persona referencing a dead tool
 * breaks silently: the model attempts the call and gets "unknown tool".
 *
 * Green NOW for briefing-writer.md and specialist-global-instructions.md (audited
 * in T10). manager.md is test.todo — it carries 30+ references by design until the
 * T11 v4 rewrite lands (Phase 3 flips it green-by-design).
 */

const AGENTS_DIR = join(import.meta.dirname, "..", "agents")

/** Tools removed per spec D5 ("Morrem") — must not be referenced by any persona. */
const DEAD_TOOLS = [
  // journey workshop (4)
  "detect_user_journeys",
  "configure_journey_workshop",
  "open_journey_workshop_round",
  "complete_journey_workshop",
  // phase analysis (4)
  "detect_phases",
  "open_phase_analysis_round",
  "request_phase_consensus",
  "generate_phase_appendix",
  // phase gate (3)
  "check_execution_phases",
  "select_phases_for_analysis",
  "configure_phase_observation",
  // consensus + specification recipes (absorbed by close_round / produce_deliverable / approve_deliverable)
  "request_consensus",
  "generate_specification",
  "generate_specification_overview",
  "approve_specification",
  // pipeline recipes
  "verify_implementation",
  "define_phases",
  "delegate_task",
  "replan_implementation_team",
  "analyze_briefing",
  "deliver_briefing",
] as const

/** Renamed per spec D5 — personas must reference the NEW name, never the old one. */
const RENAMED_TOOLS = ["open_analysis_round"] as const

const DENYLIST = [...DEAD_TOOLS, ...RENAMED_TOOLS]

function referencesOf(file: string): string[] {
  const content = readFileSync(join(AGENTS_DIR, file), "utf-8")
  return DENYLIST.filter((name) => new RegExp(`\\b${name}\\b`).test(content))
}

describe("persona tool denylist (spec D5 dead/renamed tools)", () => {
  test("briefing-writer.md references zero dead/renamed tools", () => {
    expect(referencesOf("briefing-writer.md")).toEqual([])
  })

  test("specialist-global-instructions.md references zero dead/renamed tools", () => {
    expect(referencesOf("specialist-global-instructions.md")).toEqual([])
  })

  test.todo(
    "manager.md references zero dead/renamed tools — flips green with the T11 v4 rewrite " +
      "(current v3 carries journey/phase-gate/consensus/specification references by design)"
  )
})
