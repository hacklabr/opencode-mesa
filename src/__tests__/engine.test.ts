import { describe, expect, test } from "vitest"
import { canTransition } from "../tools/gestor-tools"
import type { DiscussionPhase } from "../config"

describe("state machine transitions", () => {
  const validTransitions: Record<DiscussionPhase, DiscussionPhase[]> = {
    PLANNING: ["ANALYSIS", "PAUSED", "CANCELLED"],
    ANALYSIS: ["CONSENSUS", "PAUSED", "CANCELLED"],
    CONSENSUS: ["DOCUMENTATION", "ANALYSIS", "PAUSED", "CANCELLED"],
    DOCUMENTATION: ["APPROVAL", "PAUSED", "CANCELLED"],
    APPROVAL: ["EXECUTION", "DOCUMENTATION", "PAUSED", "CANCELLED"],
    EXECUTION: ["PLANNING", "PAUSED", "CANCELLED"],
    PAUSED: ["PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION", "CANCELLED"],
    CANCELLED: [],
  }

  const allPhases: DiscussionPhase[] = [
    "PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION",
    "APPROVAL", "EXECUTION", "PAUSED", "CANCELLED",
  ]

  test("valid transitions are accepted", () => {
    for (const [from, targets] of Object.entries(validTransitions)) {
      for (const to of targets) {
        expect(canTransition(from as DiscussionPhase, to)).toBe(true)
      }
    }
  })

  test("invalid transitions are rejected", () => {
    for (const from of allPhases) {
      const allowed = new Set(validTransitions[from])
      for (const to of allPhases) {
        if (from === to) continue
        if (!allowed.has(to)) {
          expect(canTransition(from, to)).toBe(false)
        }
      }
    }
  })

  test("CANCELLED allows no transitions", () => {
    for (const to of allPhases) {
      expect(canTransition("CANCELLED", to)).toBe(false)
    }
  })

  test("PAUSED can resume to any active phase", () => {
    const activePhases: DiscussionPhase[] = [
      "PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION",
    ]
    for (const phase of activePhases) {
      expect(canTransition("PAUSED", phase)).toBe(true)
    }
  })

  test("happy path: PLANNING through EXECUTION", () => {
    const path: DiscussionPhase[] = [
      "PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION",
    ]
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true)
    }
  })

  test("APPROVAL rejection goes back to DOCUMENTATION", () => {
    expect(canTransition("APPROVAL", "DOCUMENTATION")).toBe(true)
  })

  test("CONSENSUS disagreement goes back to ANALYSIS", () => {
    expect(canTransition("CONSENSUS", "ANALYSIS")).toBe(true)
  })
})
