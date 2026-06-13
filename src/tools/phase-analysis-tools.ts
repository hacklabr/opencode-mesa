import { tool } from "@opencode-ai/plugin/tool"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { loadState, saveState, getSessionId } from "../state"
import { SqliteStateRepository } from "../repositories/sqlite-state-repository"
import { FsArtifactRepository } from "../repositories/fs-artifact-repository"
import type { StateRepository } from "../repositories/state-repository"
import type { ArtifactRepository } from "../repositories/artifact-repository"
import {
  detect_execution_phases,
  is_phase_analysis_applicable,
  slugify,
  type ExecutionPhase,
} from "../utils/phase-detection"
import { getAppendixPath, getPhaseAnalysisDraftPath } from "../utils/paths"
import { successResponse, errorResponse } from "../utils/responses"
import { logAction } from "../audit"
import { MesaError } from "../errors"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makePhaseId(phaseIndex: number, phaseName: string): string {
  return `phase-${phaseIndex}-${slugify(phaseName)}`
}

interface AppendixInput {
  phaseName: string
  phaseSlug: string
  phaseIndex: number
  masterSpecFileName: string
  appendixId: string
  mode: string
  specialists: string[]
  phaseScope: string
  miniDiscoveryContext: string | null
  specialistAnalysesSummary: string
  consensusOutcome: string
  technicalDecisions: string
  revisedExecutionPlan: string
  deltaFromMaster: string
  generatedAt: string
}

function buildAppendixContent(input: AppendixInput): string {
  const specialistsYaml =
    input.specialists.length > 0
      ? input.specialists.map((s) => `  - "${s}"`).join("\n")
      : '  - "none"'

  const miniDiscoverySection = input.miniDiscoveryContext
    ? `## Mini-Discovery Context\n\n${input.miniDiscoveryContext}\n`
    : ""

  return `---
title: "Phase Appendix: ${input.phaseName}"
master_spec: "${input.masterSpecFileName}"
phase_slug: "${input.phaseSlug}"
phase_index: ${input.phaseIndex}
appendix_id: "${input.appendixId}"
generated_at: "${input.generatedAt}"
mode: "${input.mode}"
specialists:
${specialistsYaml}
status: "approved"
---

# Phase Appendix: ${input.phaseName}

**Override Rule:** This document supersedes the master specification for Phase ${input.phaseIndex} only.

## Phase Scope

${input.phaseScope}

${miniDiscoverySection}## Specialist Analyses Summary

${input.specialistAnalysesSummary}

## Consensus Outcome

${input.consensusOutcome}

## Technical Decisions

${input.technicalDecisions}

## Revised Execution Plan

${input.revisedExecutionPlan}

## Delta from Master Spec

${input.deltaFromMaster}
`
}

// ---------------------------------------------------------------------------
// Tool 1: detect_phases
// ---------------------------------------------------------------------------

export const detectPhasesTool = tool({
  description:
    "Reads the approved master specification and detects execution phases. Returns a list of phases or indicates that phase analysis is not applicable.",
  args: {
    spec_path: tool.schema
      .string()
      .optional()
      .describe("Path to the master spec. If omitted, uses state.specification.path"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const specPath = args.spec_path
        ? join(context.directory, args.spec_path)
        : state.specification.path

      if (!specPath) {
        return errorResponse(
          "No master specification found. Generate and approve a specification first."
        )
      }

      const artifacts: ArtifactRepository = new FsArtifactRepository()
      const specText = await artifacts.readFile(specPath)

      if (!is_phase_analysis_applicable(specText)) {
        return successResponse(
          "Phase Analysis Not Applicable",
          "This specification appears to be analysis-only or lacks an execution plan. Proceeding directly to implementation.",
          { applicable: false, phases: null }
        )
      }

      const phases = detect_execution_phases(specText)
      if (!phases || phases.length === 0) {
        return successResponse(
          "No Phases Detected",
          "No execution phases were detected in the master specification. Proceeding directly to implementation.",
          { applicable: true, phases: null }
        )
      }

      const phaseList = phases
        .map((p: ExecutionPhase) => `  ${p.index}. ${p.name} (slug: ${p.slug})`)
        .join("\n")

      return successResponse(
        "Phases Detected",
        [`Detected ${phases.length} execution phase(s):`, "", phaseList].join("\n"),
        { applicable: true, phases }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error detecting phases: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})

// ---------------------------------------------------------------------------
// Tool 2: open_phase_analysis_round
// ---------------------------------------------------------------------------

export const openPhaseAnalysisRoundTool = tool({
  description:
    "Opens a structured analysis round for a single execution phase. Stores phase context in the sidecar and prepares the draft directory.",
  args: {
    phase_index: tool.schema.number().describe("1-based phase index"),
    phase_name: tool.schema.string().describe("Human-readable phase name"),
    briefing_content: tool.schema
      .string()
      .optional()
      .describe("Mini-briefing or observations for this phase"),
    observations: tool.schema
      .string()
      .optional()
      .describe("Human observations / free-form context for guided mode"),
    mode: tool.schema
      .union([tool.schema.literal("observed"), tool.schema.literal("auto")])
      .describe("Analysis mode: observed (guided) or auto"),
    specialists: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Specialist persona IDs for this phase"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const sessionId = getSessionId(context.directory)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }

      if (state.currentPhase !== "EXECUTION") {
        return errorResponse(
          `Phase analysis can only be opened during EXECUTION phase. Current: ${state.currentPhase}`
        )
      }

      const phaseId = makePhaseId(args.phase_index, args.phase_name)
      const draftDirRel = getPhaseAnalysisDraftPath(phaseId)
      const draftDirAbs = join(context.directory, draftDirRel)

      const artifacts: ArtifactRepository = new FsArtifactRepository()
      await artifacts.ensureDirectory(draftDirAbs)

      if (args.briefing_content) {
        const briefingPath = join(draftDirAbs, "mini-briefing.md")
        await artifacts.writeFile(briefingPath, args.briefing_content)
      }

      const stateRepo: StateRepository = new SqliteStateRepository(context.directory)
      try {
        const now = new Date().toISOString()
        await stateRepo.savePhaseContext({
          workspaceId: context.directory,
          sessionId,
          phase: phaseId,
          context: {
            phaseIndex: args.phase_index,
            phaseName: args.phase_name,
            phaseSlug: slugify(args.phase_name),
            mode: args.mode,
            observations: args.observations ?? null,
            specialists: args.specialists ?? [],
            status: "analysis_opened",
            openedAt: now,
            draftDir: draftDirAbs,
          },
          schemaVersion: 1,
          updatedAt: now,
        })
      } finally {
        stateRepo.close()
      }

      await logAction(context.directory, "phase_analysis_opened", state.currentPhase, {
        phaseId,
        phaseName: args.phase_name,
        mode: args.mode,
      })

      const lines = [
        `Phase ${args.phase_index}: ${args.phase_name}`,
        `Mode: ${args.mode}`,
        `Draft directory: ${draftDirRel}`,
      ]
      if (args.observations) lines.push("\nObservations recorded.")
      if (args.briefing_content)
        lines.push(`Mini-briefing saved to: ${join(draftDirRel, "mini-briefing.md")}`)
      if (args.specialists && args.specialists.length > 0) {
        lines.push("", "### Specialist Sessions")
        lines.push("Use `task_id=\"mesa-{personaId}\"` when invoking each specialist to resume their named session.")
        lines.push("If the task tool returns a `ses_...` ID, save it and reuse it in subsequent turns.")
        for (const s of args.specialists) {
          lines.push(`  ${s}: task(subagent_type="mesa/${s}", task_id="mesa-${s}", prompt="...", description="...")`)
        }
      }
      lines.push("", "Next: Register analyses, then request_phase_consensus.")

      return successResponse(
        `Phase Analysis Opened: ${args.phase_name}`,
        lines.join("\n"),
        { phaseId, draftDir: draftDirRel }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error opening phase analysis: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})

// ---------------------------------------------------------------------------
// Tool 3: request_phase_consensus
// ---------------------------------------------------------------------------

export const requestPhaseConsensusTool = tool({
  description:
    "Records consensus votes for a phase analysis in the phase context sidecar.",
  args: {
    phase_index: tool.schema.number().describe("1-based phase index"),
    phase_name: tool.schema.string().describe("Phase name for identification"),
    votes: tool.schema
      .array(
        tool.schema.object({
          agent_id: tool.schema.string(),
          agent_name: tool.schema.string(),
          vote: tool.schema.union([
            tool.schema.literal(0),
            tool.schema.literal(1),
            tool.schema.literal(2),
          ]),
          reason: tool.schema.string(),
        })
      )
      .describe("Array of votes: 0=DISAGREE, 1=AGREE, 2=AGREE_WITH_RESERVATIONS"),
    round: tool.schema.number().describe("Consensus round number (1 for first round)"),
    consensus_reached: tool.schema.boolean().describe("Whether consensus was reached"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const sessionId = getSessionId(context.directory)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }

      const phaseId = makePhaseId(args.phase_index, args.phase_name)
      const stateRepo: StateRepository = new SqliteStateRepository(context.directory)

      let existingContext: Record<string, unknown> | null = null
      let existingSchemaVersion = 1
      try {
        const record = await stateRepo.getPhaseContext(context.directory, sessionId, phaseId)
        if (!record) {
          return errorResponse(
            `No phase analysis found for ${args.phase_name}. Open it first with open_phase_analysis_round.`
          )
        }
        existingContext = record.context as Record<string, unknown>
        existingSchemaVersion = record.schemaVersion
      } finally {
        stateRepo.close()
      }

      const now = new Date().toISOString()
      const updatedContext: Record<string, unknown> = {
        ...existingContext,
        votes: args.votes,
        consensusRound: args.round,
        consensusReached: args.consensus_reached,
        status: args.consensus_reached ? "consensus_reached" : "debate_needed",
        updatedAt: now,
      }

      const stateRepo2: StateRepository = new SqliteStateRepository(context.directory)
      try {
        await stateRepo2.savePhaseContext({
          workspaceId: context.directory,
          sessionId,
          phase: phaseId,
          context: updatedContext,
          schemaVersion: existingSchemaVersion,
          updatedAt: now,
        })
      } finally {
        stateRepo2.close()
      }

      await logAction(context.directory, "phase_consensus_recorded", state.currentPhase, {
        phaseId,
        consensusReached: args.consensus_reached,
        round: args.round,
      })

      const voteSummary = args.votes
        .map((v) => {
          const label =
            v.vote === 0 ? "DISAGREE" : v.vote === 1 ? "AGREE" : "AGREE_WITH_RESERVATIONS"
          return `  ${v.agent_name}: ${label} — ${v.reason}`
        })
        .join("\n")

      if (args.consensus_reached) {
        return successResponse(
          "Phase Consensus Reached",
          `Consensus reached for Phase ${args.phase_index}: ${args.phase_name}\n\nVotes:\n${voteSummary}\n\nProceed to generate_phase_appendix.`,
          { phaseId, consensusReached: true }
        )
      }

      return successResponse(
        "Phase Consensus Not Reached",
        `Consensus not reached for Phase ${args.phase_index}: ${args.phase_name}\n\nVotes:\n${voteSummary}\n\nA debate round may be needed.`,
        { phaseId, consensusReached: false }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error recording phase consensus: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})

// ---------------------------------------------------------------------------
// Tool 4: generate_phase_appendix
// ---------------------------------------------------------------------------

export const generatePhaseAppendixTool = tool({
  description:
    "Generates a canonical appendix file from phase consensus and promotes the draft. Updates the master state with the appendix reference.",
  args: {
    phase_index: tool.schema.number().describe("1-based phase index"),
    phase_name: tool.schema.string().describe("Phase name"),
    phase_scope: tool.schema.string().describe("Phase scope description"),
    specialist_analyses_summary: tool.schema.string().describe("Summary of specialist analyses"),
    consensus_outcome: tool.schema.string().describe("Consensus outcome text"),
    technical_decisions: tool.schema.string().describe("Technical decisions made"),
    revised_execution_plan: tool.schema.string().describe("Revised execution plan for this phase"),
    delta_from_master: tool.schema
      .string()
      .describe("Delta from master specification — mandatory"),
    mini_discovery_context: tool.schema
      .string()
      .optional()
      .describe("Mini-discovery context (if observed mode)"),
    specialists: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("List of specialists involved"),
    mode: tool.schema
      .union([tool.schema.literal("observed"), tool.schema.literal("auto")])
      .describe("Mode used for this phase analysis"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const sessionId = getSessionId(context.directory)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }

      if (!state.specification.path) {
        return errorResponse("No approved master specification found.")
      }

      const masterSpecFileName =
        state.specification.path.split("/").pop() ?? "unknown.md"
      const masterSpecId = masterSpecFileName.replace(/^spec-/, "").replace(/\.md$/, "")

      const phaseSlug = slugify(args.phase_name)
      const phaseId = makePhaseId(args.phase_index, args.phase_name)
      const shortUuid = randomUUID().slice(0, 8)
      const appendixId = `app-${shortUuid}`

      // Load phase context to verify it exists
      const stateRepo: StateRepository = new SqliteStateRepository(context.directory)
      let phaseContextRecord: Awaited<
        ReturnType<StateRepository["getPhaseContext"]>
      > | null = null
      try {
        phaseContextRecord = await stateRepo.getPhaseContext(
          context.directory,
          sessionId,
          phaseId
        )
      } finally {
        stateRepo.close()
      }

      if (!phaseContextRecord) {
        return errorResponse(
          `No phase analysis context found for ${args.phase_name}. Open the phase analysis first.`
        )
      }

      const artifacts: ArtifactRepository = new FsArtifactRepository()

      const appendixContent = buildAppendixContent({
        phaseName: args.phase_name,
        phaseSlug,
        phaseIndex: args.phase_index,
        masterSpecFileName,
        appendixId,
        mode: args.mode,
        specialists: args.specialists ?? [],
        phaseScope: args.phase_scope,
        miniDiscoveryContext: args.mini_discovery_context ?? null,
        specialistAnalysesSummary: args.specialist_analyses_summary,
        consensusOutcome: args.consensus_outcome,
        technicalDecisions: args.technical_decisions,
        revisedExecutionPlan: args.revised_execution_plan,
        deltaFromMaster: args.delta_from_master,
        generatedAt: new Date().toISOString(),
      })

      // Atomic write: temp file then rename
      const canonicalRel = getAppendixPath(masterSpecId, phaseSlug, shortUuid)
      const canonicalAbs = join(context.directory, canonicalRel)
      const tempPath = `${canonicalAbs}.tmp`

      await artifacts.writeFile(tempPath, appendixContent)
      await fs.rename(tempPath, canonicalAbs)

      // Update state appendices
      const appendixRef = `appendix-${masterSpecId}-${phaseSlug}-${shortUuid}.md`
      if (!state.appendices.includes(appendixRef)) {
        state.appendices.push(appendixRef)
      }
      await saveState(context.directory, state)

      // Update phase context
      const now = new Date().toISOString()
      const stateRepo2: StateRepository = new SqliteStateRepository(context.directory)
      try {
        await stateRepo2.savePhaseContext({
          workspaceId: context.directory,
          sessionId,
          phase: phaseId,
          context: {
            ...phaseContextRecord.context,
            status: "approved",
            appendixPath: canonicalAbs,
            appendixId,
            approvedAt: now,
          },
          schemaVersion: phaseContextRecord.schemaVersion,
          updatedAt: now,
        })
      } finally {
        stateRepo2.close()
      }

      await logAction(context.directory, "phase_appendix_generated", state.currentPhase, {
        phaseId,
        appendixPath: canonicalAbs,
        appendixId,
      })

      return successResponse(
        "Phase Appendix Generated",
        [
          `Appendix for Phase ${args.phase_index}: ${args.phase_name}`,
          `Canonical path: ${canonicalRel}`,
          `Appendix ID: ${appendixId}`,
          "",
          "This appendix is now the authoritative specification for this phase.",
        ].join("\n"),
        { appendixPath: canonicalAbs, appendixId }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error generating phase appendix: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})
