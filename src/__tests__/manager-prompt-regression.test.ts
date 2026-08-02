import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Manager behavioral regression suite — v4 ACCEPTANCE (T11/T12).
 * (Frozen as a pre-v4 baseline in Phase 0; flipped to v4 assertions in Phase 3.)
 *
 * Two layers:
 *  (A) Structural assertions against the CURRENT src/agents/manager.md — green NOW,
 *      they pin the mechanisms that must SURVIVE the rewrite (FS-first, hard boundaries,
 *      self-registration, recorded negatives, consensus evidence).
 *  (B) Plan-shape validator (workflow-plan.md fixtures) — the machine-checkable core of
 *      the v4 Workflow Invariants. Green NOW because the validator is harness code;
 *      PROMOTE the validator to src/workflow/ in Phase 3 when open_round/record_decision land.
 *
 * v4 features the current prompt LACKS are registered as test.todo — they flip
 * green-by-design in Phase 3 when the v4 prompt ships. Case IDs (C1–C10) match
 * .mesa/sessions/202608012203_040c_mesa-flexible-workflow/manager-eval-cases.md.
 */

const MANAGER_MD = readFileSync(join(import.meta.dirname, "..", "agents", "manager.md"), "utf-8")

// ---------------------------------------------------------------------------
// Layer B — workflow-plan.md shape validator (v4 harness, promote in Phase 3)
// ---------------------------------------------------------------------------

const INVARIANT_KEYS = [
  "independence",
  "adversarial-pass",
  "human-gate",
  "traceability",
  "recorded-negative",
  "deviation-log",
] as const

interface ParsedRound {
  index: number
  name: string
  mode: "parallel" | "sequential" | null
  independent: boolean
}

interface PlanValidation {
  ok: boolean
  violations: string[]
}

/**
 * Validates the machine-checkable subset of the v4 Workflow Invariants against a
 * workflow-plan.md document. Expected plan shape (enforced by the v4 prompt):
 *
 *   ## Workflow Plan: <scope>
 *   - Deliverable: <artifact>
 *   - Scope class: software | research | strategy | other
 *   - Rounds:
 *     1. <name> — mode: parallel — independent: yes
 *     2. <name> — mode: sequential — independent: no
 *   - Gates:
 *     - Gate 1: approve plan
 *   - Invariant check:
 *     - independence: ok
 *     - adversarial-pass: N/A — <reason, REQUIRED when N/A>
 */
function validateWorkflowPlan(markdown: string): PlanValidation {
  const violations: string[] = []
  const lines = markdown.split("\n")

  const rounds: ParsedRound[] = []
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\.\s+(.+)$/)
    if (!m) continue
    const body = m[2]
    const name = body.split("—")[0].trim()
    const mode = body.match(/mode:\s*(parallel|sequential)/i)?.[1]?.toLowerCase() as
      | "parallel"
      | "sequential"
      | undefined
    const independent = !/independent:\s*no/i.test(body)
    rounds.push({ index: Number(m[1]), name, mode: mode ?? null, independent })
  }

  const gates = lines.filter((l) => /^\s*-\s*gate\b/i.test(l))

  const invariantEntries = new Map<string, { status: "ok" | "na"; reason: string | null }>()
  for (const line of lines) {
    const m = line.match(/^\s*-\s*([a-z-]+):\s*(ok|n\/a)\b\s*(?:—\s*(.+))?$/i)
    if (!m) continue
    invariantEntries.set(m[1].toLowerCase(), {
      status: m[2].toLowerCase() === "ok" ? "ok" : "na",
      reason: m[3]?.trim() || null,
    })
  }

  // Invariant 1 — independence before contamination: round 1 must be independent,
  // and no cross-review round may precede the first independent round.
  if (rounds.length === 0) {
    violations.push("plan has no rounds")
  } else {
    const firstIndependent = rounds.findIndex((r) => r.independent)
    if (firstIndependent === -1) violations.push("no independent round declared")
    if (firstIndependent > 0)
      violations.push(`round ${rounds[0].index} ("${rounds[0].name}") reviews peers before any independent round`)
  }

  // Invariant 3 — at least one human gate.
  if (gates.length === 0) violations.push("no human gate declared")

  // Invariant self-check block: all six keys present; every N/A needs a recorded reason.
  for (const key of INVARIANT_KEYS) {
    const entry = invariantEntries.get(key)
    if (!entry) {
      violations.push(`invariant check missing key: ${key}`)
      continue
    }
    if (entry.status === "na" && !entry.reason)
      violations.push(`invariant "${key}" marked N/A without a recorded reason`)
  }

  return { ok: violations.length === 0, violations }
}

// --- Fixtures ---------------------------------------------------------------

const VALID_SIMPLE_PLAN = `## Workflow Plan: Fix README typo
- Deliverable: corrected README.md
- Scope class: software
- Rounds:
  1. solo-fix — mode: parallel — independent: yes
- Gates:
  - Gate 1: human approves the diff
- Invariant check:
  - independence: ok
  - adversarial-pass: N/A — trivial scope, recorded negative
  - human-gate: ok
  - traceability: ok
  - recorded-negative: ok
  - deviation-log: ok
`

const VALID_COMPOSITE_PLAN = `## Workflow Plan: Orders API platform
- Deliverable: specification + implementation
- Scope class: software
- Rounds:
  1. independent-analysis — mode: parallel — independent: yes
  2. delta-review — mode: parallel — independent: no
  3. conflict-resolution — mode: sequential — independent: no
- Gates:
  - Gate 1: approve workflow plan
  - Gate 2: approve final specification
- Invariant check:
  - independence: ok
  - adversarial-pass: ok
  - human-gate: ok
  - traceability: ok
  - recorded-negative: ok
  - deviation-log: ok
`

const INVALID_REVIEW_FIRST = VALID_COMPOSITE_PLAN.replace(
  "1. independent-analysis — mode: parallel — independent: yes\n  2. delta-review — mode: parallel — independent: no",
  "1. delta-review — mode: parallel — independent: no\n  2. independent-analysis — mode: parallel — independent: yes"
)

const INVALID_NO_GATE = VALID_SIMPLE_PLAN.replace("- Gates:\n  - Gate 1: human approves the diff\n", "")

const INVALID_MISSING_INVARIANT = VALID_SIMPLE_PLAN.replace("  - traceability: ok\n", "")

const INVALID_NA_WITHOUT_REASON = VALID_SIMPLE_PLAN.replace(
  "  - adversarial-pass: N/A — trivial scope, recorded negative",
  "  - adversarial-pass: N/A"
)

// ---------------------------------------------------------------------------
// Layer B tests — plan-shape validator (green NOW; harness for v4)
// ---------------------------------------------------------------------------

describe("workflow-plan validator (v4 invariant self-check harness)", () => {
  test("accepts a valid simple-scope plan (C1 shape)", () => {
    const result = validateWorkflowPlan(VALID_SIMPLE_PLAN)
    expect(result.violations).toEqual([])
    expect(result.ok).toBe(true)
  })

  test("accepts a valid composite-scope plan (C2 shape)", () => {
    expect(validateWorkflowPlan(VALID_COMPOSITE_PLAN).ok).toBe(true)
  })

  test("rejects cross-review before any independent round (independence invariant)", () => {
    const result = validateWorkflowPlan(INVALID_REVIEW_FIRST)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes("before any independent round"))).toBe(true)
  })

  test("rejects a plan with no human gate", () => {
    const result = validateWorkflowPlan(INVALID_NO_GATE)
    expect(result.ok).toBe(false)
    expect(result.violations).toContain("no human gate declared")
  })

  test("rejects an incomplete invariant self-check (C6)", () => {
    const result = validateWorkflowPlan(INVALID_MISSING_INVARIANT)
    expect(result.ok).toBe(false)
    expect(result.violations).toContain("invariant check missing key: traceability")
  })

  test("rejects an unexplained N/A in the invariant self-check (permissive-drift tripwire)", () => {
    const result = validateWorkflowPlan(INVALID_NA_WITHOUT_REASON)
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('invariant "adversarial-pass" marked N/A without a recorded reason')
  })
})

// ---------------------------------------------------------------------------
// Layer A — structural baseline against CURRENT manager.md (must stay green
// through the v4 rewrite: these pin the mechanisms that survive)
// ---------------------------------------------------------------------------

describe("manager.md — surviving-mechanism baseline (green NOW, must NOT regress in v4)", () => {
  test("FS-first rule: file paths, never inline/summarize peer content", () => {
    expect(MANAGER_MD).toMatch(/file paths?, never (inline|summar)/i)
    expect(MANAGER_MD).toMatch(/never inline/i)
  })

  test("hard boundaries section exists with no-self-implementation rule", () => {
    expect(MANAGER_MD).toMatch(/## Hard Boundaries/)
    expect(MANAGER_MD).toMatch(/No self-implementation/i)
    expect(MANAGER_MD).toMatch(/No skipping the human gate/i)
  })

  test("specialist self-registration via register_analysis is mandatory (ask_peer capture)", () => {
    expect(MANAGER_MD).toMatch(/register_analysis/)
    expect(MANAGER_MD).toMatch(/registered_by_manager/)
  })

  test("delegation mechanics: inline persona primary + ses_ resumption documented", () => {
    expect(MANAGER_MD).toMatch(/<specialist-persona/)
    expect(MANAGER_MD).toMatch(/task_id:"ses_\.\.\."/)
    expect(MANAGER_MD).toMatch(/resumes the existing session/i)
    expect(MANAGER_MD).toMatch(/mesa-\{personaId\}/) // legacy slug path documented
  })

  test("ask_peer sequential-topology rule survives", () => {
    expect(MANAGER_MD).toMatch(/ask_peer/)
    expect(MANAGER_MD).toMatch(/sequential/i)
  })

  test("C5 — recorded-negative pattern exists (currently scoped to the non-technical scan)", () => {
    expect(MANAGER_MD).toMatch(/Recording the negative is REQUIRED/i)
  })

  test("C1 — simple-scope guidance exists (scopeMagnitude drives ceremony level)", () => {
    expect(MANAGER_MD).toMatch(/scopeMagnitude|scope magnitude/i)
    expect(MANAGER_MD).toMatch(/simple/i)
  })

  test("C2 — composite software scope: independent turn + delta review + verification guidance", () => {
    expect(MANAGER_MD).toMatch(/Turn 1 is ALWAYS parallel/i)
    expect(MANAGER_MD).toMatch(/kind:\s*"delta"|`delta`/i)
    expect(MANAGER_MD).toMatch(/Verification/)
  })

  test("C7-baseline — consensus decisions require substantive grounding (declared positions + cited evidence)", () => {
    expect(MANAGER_MD).toMatch(/POSITION:/)
    expect(MANAGER_MD).toMatch(/close_round/)
    expect(MANAGER_MD).toMatch(/evidencePaths/)
  })
})

// ---------------------------------------------------------------------------
// v4 acceptance (T11/T12) — real assertions against the v4 prompt.
// ---------------------------------------------------------------------------

describe("manager.md v4 — workflow-design cases (C1–C6 acceptance)", () => {
  test("C3 — prompt contains a non-software workflow exemplar and scopes Implementation/Verification to code deliverables", () => {
    expect(MANAGER_MD).toMatch(/Academic article|systematic review|PRISMA/i)
    expect(MANAGER_MD).toMatch(/ONLY when the deliverable is executable code/i)
    expect(MANAGER_MD).toMatch(/No Implementation phase/i)
    expect(MANAGER_MD).toMatch(/No Verification phase/i)
  })

  test("C4 — prompt instructs delegating workflow design to a domain specialist with invariant re-validation", () => {
    expect(MANAGER_MD).toMatch(/delegate the workflow design/i)
    expect(MANAGER_MD).toMatch(/re-run the invariant self-check/i)
    expect(MANAGER_MD).toMatch(/record_decision type:"delegation"/)
  })

  test("C5-v4 — recorded negatives generalized: plan shape has mandatory Skipped lines with reasons", () => {
    expect(MANAGER_MD).toMatch(/- Skipped:/)
    expect(MANAGER_MD).toMatch(/every `Skipped:` line must carry a reason/i)
  })

  test("C6 — workflow-plan.md with the 6-invariant self-check presented at gate 0", () => {
    expect(MANAGER_MD).toMatch(/workflow-plan\.md/)
    expect(MANAGER_MD).toMatch(/- Invariant check:/)
    for (const key of [
      "independence",
      "adversarial-pass",
      "human-gate",
      "traceability",
      "recorded-negative",
      "deviation-log",
    ]) {
      expect(MANAGER_MD).toContain(`- ${key}:`)
    }
    expect(MANAGER_MD).toMatch(/Gate 0/)
    expect(MANAGER_MD).toMatch(/record_decision[\s\S]{0,80}type:"gate"[\s\S]{0,80}target:"plan"/)
  })
})

describe("manager.md v4 — consensus cases (C7–C10 acceptance)", () => {
  test("C7 — close-round language: unanimous agree → converged as tally, not domain judgment", () => {
    expect(MANAGER_MD).toMatch(/WHETHER the round converged/i)
    expect(MANAGER_MD).toMatch(/never decide WHO IS RIGHT/i)
    expect(MANAGER_MD).toMatch(/tallying, not judging/i)
  })

  test("C8 — a declared disagree vetoes converged; subset round or escalation mandated", () => {
    expect(MANAGER_MD).toMatch(/NEVER declare convergence/i)
    expect(MANAGER_MD).toMatch(/disagree vetoes/i)
    expect(MANAGER_MD).toMatch(/Subset round/i)
    expect(MANAGER_MD).toMatch(/escalated/i)
  })

  test("C9 — domain-level reservations block convergence; reservations copied verbatim", () => {
    expect(MANAGER_MD).toMatch(/VERBATIM/)
    expect(MANAGER_MD).toMatch(/domain-level/i)
    expect(MANAGER_MD).toMatch(/process-level/i)
  })

  test("C10 — close_round requires cited evidence; evidence-free decisions named a violation", () => {
    expect(MANAGER_MD).toMatch(/evidencePaths/)
    expect(MANAGER_MD).toMatch(/A decision without cited evidence is not a decision/i)
  })
})

describe("manager.md v4 — T12 exemplar fidelity", () => {
  const softwareExemplar = MANAGER_MD.split("### Exemplar 1")[1]?.split("### Exemplar 2")[0] ?? ""

  test("software exemplar exists and reproduces the classic pipeline stages in order", () => {
    expect(softwareExemplar.length).toBeGreaterThan(0)
    expect(softwareExemplar).toMatch(
      /briefing[\s\S]*?team[\s\S]*?parallel[\s\S]*?sequential[\s\S]*?specification[\s\S]*?implementation[\s\S]*?verification/i
    )
  })

  test("software exemplar satisfies all 6 invariants explicitly", () => {
    for (const key of [
      "independence",
      "adversarial-pass",
      "human-gate",
      "traceability",
      "recorded-negative",
      "deviation-log",
    ]) {
      expect(softwareExemplar).toContain(`- ${key}: ok`)
    }
  })

  test("academic exemplar is LAST (recency) and free of software pipeline stages in its plan", () => {
    const academicIdx = MANAGER_MD.search(/### Exemplar 3/i)
    const delegatedIdx = MANAGER_MD.search(/### Exemplar 2/i)
    const softwareIdx = MANAGER_MD.search(/### Exemplar 1/i)
    expect(academicIdx).toBeGreaterThan(delegatedIdx)
    expect(delegatedIdx).toBeGreaterThan(softwareIdx)
    const academic = MANAGER_MD.slice(academicIdx)
    const planBody = academic.split("- Skipped:")[0]
    expect(planBody).not.toMatch(/mode:.*implementation/i)
  })
})
