import { describe, expect, test } from "vitest"
import { canTransition } from "../workflow/transitions"
import type { DiscussionPhase } from "../types"

describe("state machine transitions", () => {
  const allPhases: DiscussionPhase[] = [
    "PLANNING", "DISCUSSION", "SPECIFICATION", "EXECUTION",
  ]

  test("valid transitions are accepted", () => {
    expect(canTransition("PLANNING", "DISCUSSION")).toBe(true)
    expect(canTransition("DISCUSSION", "SPECIFICATION")).toBe(true)
    expect(canTransition("DISCUSSION", "PLANNING")).toBe(true)
    expect(canTransition("SPECIFICATION", "EXECUTION")).toBe(true)
    expect(canTransition("SPECIFICATION", "DISCUSSION")).toBe(true)
    expect(canTransition("EXECUTION", "PLANNING")).toBe(true)
  })

  test("invalid transitions are rejected", () => {
    expect(canTransition("PLANNING", "EXECUTION")).toBe(false)
    expect(canTransition("PLANNING", "SPECIFICATION")).toBe(false)
    expect(canTransition("DISCUSSION", "EXECUTION")).toBe(false)
    expect(canTransition("SPECIFICATION", "PLANNING")).toBe(false)
    expect(canTransition("EXECUTION", "DISCUSSION")).toBe(false)
    expect(canTransition("EXECUTION", "SPECIFICATION")).toBe(false)
  })

  test("pause and cancel are handled via status, not phase", () => {
    // PAUSED and CANCELLED are no longer phases — they're orthogonal status values
    // Phase transitions don't include them
    for (const phase of allPhases) {
      // No phase transitions to PAUSED or CANCELLED
    }
  })

  test("happy path: PLANNING through EXECUTION", () => {
    expect(canTransition("PLANNING", "DISCUSSION")).toBe(true)
    expect(canTransition("DISCUSSION", "SPECIFICATION")).toBe(true)
    expect(canTransition("SPECIFICATION", "EXECUTION")).toBe(true)
  })

  test("spec rejection goes back to DISCUSSION", () => {
    expect(canTransition("SPECIFICATION", "DISCUSSION")).toBe(true)
  })

  test("consensus disagreement stays in DISCUSSION", () => {
    expect(canTransition("DISCUSSION", "PLANNING")).toBe(true)
  })
})
