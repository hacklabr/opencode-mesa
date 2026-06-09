import { describe, expect, test } from "vitest"
import {
  detect_execution_phases,
  is_phase_analysis_applicable,
  parse_phase_selection,
  slugify,
} from "../utils/phase-detection"

describe("detect_execution_phases", () => {
  test("returns null for empty text", () => {
    expect(detect_execution_phases("")).toBeNull()
  })

  test("returns null for text without phases", () => {
    expect(detect_execution_phases("# Hello\n\nThis is just a document.")).toBeNull()
  })

  describe("YAML frontmatter parsing", () => {
    test("detects phases from frontmatter array", () => {
      const text = `---
execution_plan:
  - Planning
  - Analysis
  - Implementation
---

# Spec

Content here.
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0]).toEqual({
        index: 1,
        name: "Planning",
        slug: "planning",
        description: null,
      })
      expect(phases![2]).toEqual({
        index: 3,
        name: "Implementation",
        slug: "implementation",
        description: null,
      })
    })

    test("detects phases from frontmatter JSON array", () => {
      const text = `---
execution_plan: ['Design', 'Build', 'Test']
---

# Spec
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Design")
      expect(phases![1].name).toBe("Build")
      expect(phases![2].name).toBe("Test")
    })

    test("detects phases from frontmatter object array as strings (lightweight parser)", () => {
      // The lightweight YAML parser treats list items literally (quotes included).
      const text = `---
execution_plan:
  - Phase One
  - Phase Two
---

# Spec
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Phase One")
      expect(phases![1].name).toBe("Phase Two")
    })

    test("detects phases from frontmatter string", () => {
      const text = `---
execution_plan: Setup, Development, Deployment
---

# Spec
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Setup")
      expect(phases![1].name).toBe("Development")
      expect(phases![2].name).toBe("Deployment")
    })

    test("returns null when frontmatter has no execution_plan", () => {
      const text = `---
title: "My Spec"
---

# Spec
`
      expect(detect_execution_phases(text)).toBeNull()
    })
  })

  describe("Markdown heading heuristics", () => {
    test("detects phases from ## Phase N: Name headings", () => {
      const text = `# Spec

## Phase 1: Planning

Details...

## Phase 2: Analysis

Details...

## Phase 3: Implementation

Details...
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0]).toEqual({
        index: 1,
        name: "Planning",
        slug: "planning",
        description: null,
      })
      expect(phases![1]).toEqual({
        index: 2,
        name: "Analysis",
        slug: "analysis",
        description: null,
      })
    })

    test("detects phases from Execution Plan section with numbered list", () => {
      const text = `# Spec

## Execution Plan

1. Setup environment
2. Build core features
3. Deploy to production

## Other Section
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Setup environment")
      expect(phases![1].name).toBe("Build core features")
      expect(phases![2].name).toBe("Deploy to production")
    })

    test("handles parenthesized list items", () => {
      const text = `# Spec

## Execution Plan

1) First step
2) Second step
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("First step")
      expect(phases![1].name).toBe("Second step")
    })
  })

  describe("Aggressive heuristic fallback", () => {
    test("detects Phase N in bold lines", () => {
      const text = `# Spec

**Phase 1: Discovery**

Some text...

**Phase 2: Design**

More text...
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Discovery")
      expect(phases![1].name).toBe("Design")
    })

    test("detects Step N patterns", () => {
      const text = `# Spec

**Step 1: Initialize**

**Step 2: Process**

**Step 3: Finalize**
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Initialize")
      expect(phases![1].name).toBe("Process")
      expect(phases![2].name).toBe("Finalize")
    })

    test("deduplicates repeated phase references", () => {
      const text = `# Spec

**Phase 1: Setup**

**Phase 1: Setup**

**Phase 2: Build**
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Setup")
      expect(phases![1].name).toBe("Build")
    })
  })

  describe("priority order", () => {
    test("prefers frontmatter over headings", () => {
      const text = `---
execution_plan:
  - Frontmatter Phase
---

# Spec

## Phase 1: Heading Phase
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(1)
      expect(phases![0].name).toBe("Frontmatter Phase")
    })

    test("prefers headings over heuristics", () => {
      const text = `# Spec

## Phase 1: Structured Phase

**Phase 2: Heuristic Phase**
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(1)
      expect(phases![0].name).toBe("Structured Phase")
    })
  })
})

describe("is_phase_analysis_applicable", () => {
  test("returns false for analysis-only keywords", () => {
    expect(is_phase_analysis_applicable("This is an audit report")).toBe(false)
    expect(is_phase_analysis_applicable("Here are our recommendations")).toBe(false)
    expect(is_phase_analysis_applicable("Assessment only document")).toBe(false)
    expect(is_phase_analysis_applicable("Analysis only, no implementation")).toBe(false)
    expect(is_phase_analysis_applicable("No implementation required")).toBe(false)
  })

  test("returns true for specs with execution plan", () => {
    expect(
      is_phase_analysis_applicable("# Spec\n\n## Execution Plan\n\n1. Build\n2. Deploy")
    ).toBe(true)
  })

  test("returns true for specs with implementation plan", () => {
    expect(
      is_phase_analysis_applicable("# Spec\n\n## Implementation Plan\n\nSteps...")
    ).toBe(true)
  })

  test("returns true for specs with project plan", () => {
    expect(
      is_phase_analysis_applicable("# Spec\n\n## Project Plan\n\nSteps...")
    ).toBe(true)
  })

  test("returns true for specs with detected phases", () => {
    expect(
      is_phase_analysis_applicable("# Spec\n\n## Phase 1: Setup\n\n## Phase 2: Build")
    ).toBe(true)
  })

  test("returns false for plain text without execution indicators", () => {
    expect(
      is_phase_analysis_applicable("# Architecture Review\n\nThis document reviews the current architecture.")
    ).toBe(false)
  })
})

describe("parse_phase_selection", () => {
  test('returns all indices for "all"', () => {
    expect(parse_phase_selection("all", 5)).toEqual([1, 2, 3, 4, 5])
  })

  test('returns all indices for "todas"', () => {
    expect(parse_phase_selection("todas", 3)).toEqual([1, 2, 3])
  })

  test('returns empty array for "none"', () => {
    expect(parse_phase_selection("none", 5)).toEqual([])
  })

  test('returns empty array for "nenhuma"', () => {
    expect(parse_phase_selection("nenhuma", 5)).toEqual([])
  })

  test("parses comma-separated numbers", () => {
    expect(parse_phase_selection("1, 3, 5", 5)).toEqual([1, 3, 5])
  })

  test("parses ranges", () => {
    expect(parse_phase_selection("1-3", 5)).toEqual([1, 2, 3])
  })

  test("parses mixed commas and ranges", () => {
    expect(parse_phase_selection("1, 3-5", 5)).toEqual([1, 3, 4, 5])
  })

  test("deduplicates overlapping selections", () => {
    expect(parse_phase_selection("1-3, 2", 5)).toEqual([1, 2, 3])
  })

  test("returns error for out-of-bounds selection", () => {
    const result = parse_phase_selection("6", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid phase selection")
  })

  test("returns error for out-of-bounds range", () => {
    const result = parse_phase_selection("1-6", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid range")
  })

  test("returns error for invalid range start > end", () => {
    const result = parse_phase_selection("5-1", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid range")
  })

  test("returns error for non-numeric input", () => {
    const result = parse_phase_selection("abc", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid phase selection")
  })

  test("returns error for zero index", () => {
    const result = parse_phase_selection("0", 5)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("Invalid phase selection")
  })
})

describe("slugify", () => {
  test("converts to lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world")
  })

  test("replaces special characters with hyphens", () => {
    expect(slugify("Hello@World#Test")).toBe("hello-world-test")
  })

  test("trims leading and trailing hyphens", () => {
    expect(slugify("-Hello World-")).toBe("hello-world")
  })

  test("collapses multiple hyphens", () => {
    expect(slugify("Hello   World")).toBe("hello-world")
  })

  test("returns unnamed for empty string", () => {
    expect(slugify("")).toBe("unnamed")
  })

  test("returns unnamed for special-only string", () => {
    expect(slugify("!@#$%")).toBe("unnamed")
  })
})
