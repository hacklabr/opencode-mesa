import { describe, expect, test } from "vitest"
import { parse_phase_selection } from "../utils/phase-detection"

describe("parse_phase_selection edge cases", () => {
  test("handles extra whitespace around inputs", () => {
    expect(parse_phase_selection("  all  ", 5)).toEqual([1, 2, 3, 4, 5])
    expect(parse_phase_selection("  1 ,  3  , 5  ", 5)).toEqual([1, 3, 5])
    expect(parse_phase_selection("  1 - 3  ", 5)).toEqual([1, 2, 3])
  })

  test("handles single number", () => {
    expect(parse_phase_selection("2", 5)).toEqual([2])
  })

  test("handles all numbers individually", () => {
    expect(parse_phase_selection("1, 2, 3, 4, 5", 5)).toEqual([1, 2, 3, 4, 5])
  })

  test("handles entire range as single range", () => {
    expect(parse_phase_selection("1-5", 5)).toEqual([1, 2, 3, 4, 5])
  })

  test("handles overlapping ranges", () => {
    expect(parse_phase_selection("1-3, 2-4", 5)).toEqual([1, 2, 3, 4])
  })

  test("handles identical start and end in range", () => {
    expect(parse_phase_selection("3-3", 5)).toEqual([3])
  })

  test("handles large maxPhases", () => {
    expect(parse_phase_selection("all", 100)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1)
    )
  })

  test("returns error for negative numbers", () => {
    const result = parse_phase_selection("-1", 5)
    expect(result).toBeInstanceOf(Error)
  })

  test("returns error for decimal numbers", () => {
    const result = parse_phase_selection("1.5", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid phase selection")
  })

  test("returns empty array for empty string", () => {
    const result = parse_phase_selection("", 5)
    expect(result).toEqual([])
  })

  test("returns empty array for only whitespace", () => {
    const result = parse_phase_selection("   ", 5)
    expect(result).toEqual([])
  })

  test("returns error for mixed valid and invalid", () => {
    const result = parse_phase_selection("1, abc, 3", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid phase selection")
  })

  test("returns error when range start exceeds maxPhases", () => {
    const result = parse_phase_selection("10-12", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid range")
  })

  test("returns error when single number exceeds maxPhases", () => {
    const result = parse_phase_selection("99", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid phase selection")
  })

  test("handles complex mixed selection", () => {
    expect(parse_phase_selection("1, 3-5, 2", 5)).toEqual([1, 2, 3, 4, 5])
  })

  test("sorts results in ascending order", () => {
    expect(parse_phase_selection("5, 1, 3", 5)).toEqual([1, 3, 5])
  })

  test("handles maxPhases of 1", () => {
    expect(parse_phase_selection("all", 1)).toEqual([1])
    expect(parse_phase_selection("1", 1)).toEqual([1])
    const result = parse_phase_selection("2", 1)
    expect(result).toBeInstanceOf(Error)
  })
})
