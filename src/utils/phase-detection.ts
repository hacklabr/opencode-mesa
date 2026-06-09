import { isValidSlug } from "./slug"

export interface ExecutionPhase {
  index: number
  name: string
  slug: string
  description: string | null
}

/**
 * Lightweight YAML frontmatter parser supporting flat key:value pairs
 * and simple lists. Does not handle nested objects or complex YAML.
 */
function parse_yaml_frontmatter(text: string): Record<string, unknown> | null {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!match) return null

  const yaml = match[1]
  const result: Record<string, unknown> = {}
  const lines = yaml.split("\n")
  let currentKey: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const listMatch = trimmed.match(/^- (.+)$/)
    if (listMatch && currentKey) {
      const arr = result[currentKey]
      if (Array.isArray(arr)) {
        arr.push(listMatch[1].trim())
      }
      continue
    }

    const keyValueMatch = trimmed.match(/^(\w+):\s*(.*)$/)
    if (keyValueMatch) {
      currentKey = keyValueMatch[1]
      const value = keyValueMatch[2].trim()
      if (!value) {
        result[currentKey] = []
        continue
      }
      if (value.startsWith("[") && value.endsWith("]")) {
        try {
          result[currentKey] = JSON.parse(value.replace(/'/g, '"'))
          continue
        } catch {
          // fall through to string
        }
      }
      result[currentKey] = value
      continue
    }

    currentKey = null
  }

  return result
}

function detect_from_frontmatter(specText: string): ExecutionPhase[] | null {
  const fm = parse_yaml_frontmatter(specText)
  if (!fm) return null

  const plan = fm.execution_plan
  if (!plan) return null

  if (Array.isArray(plan)) {
    return plan.map((item, idx) => {
      if (typeof item === "string") {
        return {
          index: idx + 1,
          name: item,
          slug: slugify(item),
          description: null,
        }
      }
      if (typeof item === "object" && item !== null) {
        const record = item as Record<string, unknown>
        const name = String(record.name ?? record.title ?? "Unnamed")
        const description = record.description ? String(record.description) : null
        return {
          index: idx + 1,
          name,
          slug: slugify(name),
          description,
        }
      }
      return {
        index: idx + 1,
        name: String(item),
        slug: slugify(String(item)),
        description: null,
      }
    })
  }

  if (typeof plan === "string") {
    const items = plan
      .split(/,|\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (items.length === 0) return null
    return items.map((item, idx) => ({
      index: idx + 1,
      name: item,
      slug: slugify(item),
      description: null,
    }))
  }

  return null
}

function detect_from_headings(specText: string): ExecutionPhase[] | null {
  const phases: ExecutionPhase[] = []

  // Pattern 1: #{2,4} Phase/Fase N <sep> Name
  const phaseHeadingRegex = /^#{2,4}\s*(?:Phase|Fase)\s+(\d+)[\s:—–.)\-]+(.+)$/gim
  let match: RegExpExecArray | null
  while ((match = phaseHeadingRegex.exec(specText)) !== null) {
    const index = parseInt(match[1], 10)
    const name = match[2].trim()
    phases.push({ index, name, slug: slugify(name), description: null })
  }
  if (phases.length > 0) {
    return phases.sort((a, b) => a.index - b.index)
  }

  // Pattern 2: ## Execution Plan / Plano de Execução section
  const execPlanRegex = /##\s*(?:Execution\s*Plan|Plano\s+de\s+Execu[cç][aã]o|Plano\s+de\s+Implementa[cç][aã]o)\s*\n([\s\S]*?)(?:\n##(?!\#)|\n---|$)/i
  const execPlanMatch = execPlanRegex.exec(specText)
  if (execPlanMatch) {
    const content = execPlanMatch[1]
    const listRegex = /^(\d+)[.\)]\s+(.+)$/gm
    const listPhases: ExecutionPhase[] = []
    while ((match = listRegex.exec(content)) !== null) {
      const index = parseInt(match[1], 10)
      const name = match[2].trim()
      listPhases.push({ index, name, slug: slugify(name), description: null })
    }
    if (listPhases.length > 0) {
      return listPhases.sort((a, b) => a.index - b.index)
    }

    // Numbered headings without keyword (e.g., ### 0. Preparação)
    const numHeadingRegex = /^#{2,4}\s*(\d+)[\s:—–.)\-]+(.+)$/gim
    const numPhases: ExecutionPhase[] = []
    while ((match = numHeadingRegex.exec(content)) !== null) {
      const index = parseInt(match[1], 10)
      const name = match[2].trim()
      numPhases.push({ index, name, slug: slugify(name), description: null })
    }
    if (numPhases.length > 0) {
      return numPhases.sort((a, b) => a.index - b.index)
    }
  }

  return null
}

/**
 * Tier 3 fallback: aggressive heuristic for ambiguous cases.
 * In a future enhancement this could delegate to a lightweight LLM call.
 */
function detect_from_heuristics(specText: string): ExecutionPhase[] | null {
  const lines = specText.split("\n")
  const phases: ExecutionPhase[] = []
  const seen = new Set<string>()

  // Look for "Phase N" in headings or bold lines
  for (const line of lines) {
    const match = line.match(
      /^(?:#{1,3}\s+|\*\*)?.*?\b(?:[Pp]hase|[Ff]ase)\s+(\d+)\b[:\s—–\-]*(.+?)(?:\*\*)?$/
    )
    if (match) {
      const index = parseInt(match[1], 10)
      const name = match[2].trim().replace(/[:\s—–\-*]+$/, "")
      const key = `${index}:${name}`
      if (!seen.has(key)) {
        seen.add(key)
        phases.push({ index, name, slug: slugify(name), description: null })
      }
    }
  }
  if (phases.length > 0) {
    return phases.sort((a, b) => a.index - b.index)
  }

  // Look for "Step/Etapa N" patterns
  for (const line of lines) {
    const match = line.match(
      /^(?:#{1,3}\s+|\*\*)?.*?\b(?:[Ss]tep|[Ee]tapa)\s+(\d+)\b[:\s—–\-]*(.+?)(?:\*\*)?$/
    )
    if (match) {
      const index = parseInt(match[1], 10)
      const name = match[2].trim().replace(/[:\s—–\-*]+$/, "")
      const key = `${index}:${name}`
      if (!seen.has(key)) {
        seen.add(key)
        phases.push({ index, name, slug: slugify(name), description: null })
      }
    }
  }
  if (phases.length > 0) {
    return phases.sort((a, b) => a.index - b.index)
  }

  return null
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
  return slug || "unnamed"
}

/**
 * Three-tier phase detection:
 * 1. YAML frontmatter execution_plan
 * 2. Markdown heading / list heuristics
 * 3. Aggressive heuristic fallback
 *
 * Returns null when no execution plan is detected.
 */
export function detect_execution_phases(specText: string): ExecutionPhase[] | null {
  const fromFm = detect_from_frontmatter(specText)
  if (fromFm && fromFm.length > 0) return fromFm

  const fromHeadings = detect_from_headings(specText)
  if (fromHeadings && fromHeadings.length > 0) return fromHeadings

  const fromHeuristics = detect_from_heuristics(specText)
  if (fromHeuristics && fromHeuristics.length > 0) return fromHeuristics

  return null
}

/**
 * Returns false for analysis-only specs that do not contain an execution plan.
 */
export function is_phase_analysis_applicable(specText: string): boolean {
  const lower = specText.toLowerCase()

  const analysisOnlyKeywords = [
    "audit report",
    "relatório de auditoria",
    "recommendations",
    "assessment only",
    "análise apenas",
    "analysis only",
    "no implementation",
    "sem implementação",
  ]
  for (const kw of analysisOnlyKeywords) {
    if (lower.includes(kw)) return false
  }

  const hasExecutionPlan = /execution\s*plan|implementation\s*plan|project\s*plan|plano\s+de\s+execu[cç][aã]o|plano\s+de\s+implementa[cç][aã]o/i.test(specText)
  const hasPhases = detect_execution_phases(specText) !== null

  return hasExecutionPlan || hasPhases
}

/**
 * Parse human phase selection input.
 * Supports: "all" / "todas", "none" / "nenhuma", comma-separated numbers,
 * and ranges like "1-3".
 *
 * Returns an Error instance for invalid input.
 */
export function parse_phase_selection(input: string, maxPhases: number): number[] | Error {
  const trimmed = input.trim().toLowerCase()

  if (trimmed === "all" || trimmed === "todas") {
    return Array.from({ length: maxPhases }, (_, i) => i + 1)
  }

  if (trimmed === "none" || trimmed === "nenhuma") {
    return []
  }

  const indices = new Set<number>()
  const parts = trimmed.split(",")

  for (const part of parts) {
    const clean = part.trim()
    if (!clean) continue

    const rangeMatch = clean.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (start < 1 || end > maxPhases || start > end || !/^\d+$/.test(rangeMatch[1]) || !/^\d+$/.test(rangeMatch[2])) {
        return new Error(`Invalid range "${clean}". Must be within 1-${maxPhases} and start <= end.`)
      }
      for (let i = start; i <= end; i++) indices.add(i)
      continue
    }

    if (!/^\d+$/.test(clean)) {
      return new Error(`Invalid phase selection "${clean}". Must be a number between 1 and ${maxPhases}.`)
    }

    const num = parseInt(clean, 10)
    if (num < 1 || num > maxPhases) {
      return new Error(`Invalid phase selection "${clean}". Must be a number between 1 and ${maxPhases}.`)
    }
    indices.add(num)
  }

  return Array.from(indices).sort((a, b) => a - b)
}
