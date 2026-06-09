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

    test("detects Portuguese Fase N headings with colon", () => {
      const text = `# Especificação

## Fase 1: Planejamento

Detalhes...

## Fase 2: Análise

Detalhes...

## Fase 3: Implementação

Detalhes...
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0]).toEqual({
        index: 1,
        name: "Planejamento",
        slug: "planejamento",
        description: null,
      })
      expect(phases![2]).toEqual({
        index: 3,
        name: "Implementação",
        slug: "implementa-o",
        description: null,
      })
    })

    test("detects Portuguese Fase N headings with em dash", () => {
      const text = `# Especificação

## Fase 0 — Preparação

## Fase 1 — Bug Fixes — Tokens Faltantes
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Preparação")
      expect(phases![1].name).toBe("Bug Fixes — Tokens Faltantes")
    })

    test("detects h3 and h4 heading levels", () => {
      const text = `# Spec

### Phase 0: Preparation

Details...

#### Phase 1: Build

Details...
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0]).toEqual({
        index: 0,
        name: "Preparation",
        slug: "preparation",
        description: null,
      })
      expect(phases![1]).toEqual({
        index: 1,
        name: "Build",
        slug: "build",
        description: null,
      })
    })

    test("detects headings with dot separator", () => {
      const text = `# Spec

## Phase 1. Setup

## Phase 2. Build
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Setup")
      expect(phases![1].name).toBe("Build")
    })

    test("detects headings with hyphen separator", () => {
      const text = `# Spec

## Phase 1 - Setup

## Phase 2 - Build
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Setup")
      expect(phases![1].name).toBe("Build")
    })

    test("detects numbered headings without keyword under Execution Plan", () => {
      const text = `# Spec

## Execution Plan

### 0. Preparação

### 1. Implementação

### 2. Deploy

## Other Section
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Preparação")
      expect(phases![1].name).toBe("Implementação")
      expect(phases![2].name).toBe("Deploy")
    })

    test("detects numbered headings with em dash under Plano de Execução", () => {
      const text = `# Especificação

## Plano de Execução

### 0 — Preparação

### 1 — Desenvolvimento

## Outra Seção
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Preparação")
      expect(phases![1].name).toBe("Desenvolvimento")
    })

    test("detects numbered list under Plano de Implementação", () => {
      const text = `# Especificação

## Plano de Implementação

1. Configurar ambiente
2. Desenvolver funcionalidades
3. Implantar em produção

## Outra Seção
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Configurar ambiente")
      expect(phases![1].name).toBe("Desenvolver funcionalidades")
      expect(phases![2].name).toBe("Implantar em produção")
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

    test("detects Fase N in bold lines", () => {
      const text = `# Especificação

**Fase 1: Descoberta**

Algum texto...

**Fase 2: Design**

Mais texto...
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Descoberta")
      expect(phases![1].name).toBe("Design")
    })

    test("detects Etapa N patterns", () => {
      const text = `# Especificação

**Etapa 1: Inicializar**

**Etapa 2: Processar**

**Etapa 3: Finalizar**
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Inicializar")
      expect(phases![1].name).toBe("Processar")
      expect(phases![2].name).toBe("Finalizar")
    })

    test("detects Fase N in headings with em dash", () => {
      const text = `# Especificação

### Fase 1 — Planejamento

### Fase 2 — Execução
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(2)
      expect(phases![0].name).toBe("Planejamento")
      expect(phases![1].name).toBe("Execução")
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

    test("handles mixed English/Portuguese spec", () => {
      const text = `# Specification

## Fase 1: Bug Fixes — Tokens Faltantes

### Phase 2: Performance Improvements

## Fase 3: Final Polish
`
      const phases = detect_execution_phases(text)
      expect(phases).not.toBeNull()
      expect(phases).toHaveLength(3)
      expect(phases![0].name).toBe("Bug Fixes — Tokens Faltantes")
      expect(phases![1].name).toBe("Performance Improvements")
      expect(phases![2].name).toBe("Final Polish")
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

  test("returns false for Portuguese analysis-only keywords", () => {
    expect(is_phase_analysis_applicable("Este é um relatório de auditoria")).toBe(false)
    expect(is_phase_analysis_applicable("Análise apenas deste sistema")).toBe(false)
    expect(is_phase_analysis_applicable("Sem implementação necessária")).toBe(false)
  })

  test("returns true for Plano de Execução section", () => {
    expect(
      is_phase_analysis_applicable("# Spec\n\n## Plano de Execução\n\n1. Construir\n2. Implantar")
    ).toBe(true)
  })

  test("returns true for Plano de Implementação section", () => {
    expect(
      is_phase_analysis_applicable("# Spec\n\n## Plano de Implementação\n\nPassos...")
    ).toBe(true)
  })

  test("returns true for Portuguese Fase headings", () => {
    expect(
      is_phase_analysis_applicable("# Spec\n\n## Fase 1: Setup\n\n## Fase 2: Build")
    ).toBe(true)
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
