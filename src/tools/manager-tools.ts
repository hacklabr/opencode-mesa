import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState, getSessionId } from "../state.js"
import type { DiscussionPhase, SpecialistEntry, SpecialistStatus } from "../types.js"
import { getPersonaById } from "./catalog-tools.js"
import { logAction } from "../audit.js"
import { canTransition, requirePhase, formatPhaseHeader, ALL_PHASES } from "../workflow/transitions.js"
import { promises as fs } from "node:fs"
import { successResponse, errorResponse } from "../utils/responses.js"
import { PhaseError, MesaError } from "../errors.js"
import { build_mini_briefing_questions } from "../utils/mini-briefing.js"
import { detect_execution_phases, parse_phase_selection, slugify } from "../utils/phase-detection.js"
import { SqliteStateRepository } from "../repositories/sqlite-state-repository.js"
import { join } from "node:path"
import { PLUGIN_STATE_DIR } from "../config.js"

export const analyzeBriefingTool = tool({
  description:
    "Reads the current approved briefing and returns its content for analysis by the Manager.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      if (!state.briefing.path) {
        return errorResponse("No briefing found. A briefing must be created and delivered first.")
      }

      const content = await fs.readFile(state.briefing.path, "utf-8")

      return successResponse(
        "Briefing Analysis",
        `${formatPhaseHeader(state.currentPhase)}\n\n${content}`,
        {
          slug: state.briefing.slug,
          status: state.briefing.status,
          phase: state.currentPhase,
        }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error reading briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const proposeTeamTool = tool({
  description:
    "Proposes a team of specialists for the current project. Saves the proposal to state for human approval.",
  args: {
    specialists: tool.schema
      .array(
        tool.schema.object({
          personaId: tool.schema.string().describe("Specialist persona ID from the catalog"),
          name: tool.schema.string().describe("Specialist display name"),
          division: tool.schema.string().describe("Specialist division"),
          justification: tool.schema.string().describe("Why this specialist is needed"),
        })
      )
      .describe("Array of proposed specialists with justifications"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      const invalidIds: string[] = []
      for (const s of args.specialists) {
        const persona = await getPersonaById(s.personaId)
        if (!persona) invalidIds.push(s.personaId)
      }
      if (invalidIds.length > 0) {
        return errorResponse(`Invalid specialist IDs not found in catalog: ${invalidIds.join(", ")}`)
      }

      const team: SpecialistEntry[] = args.specialists.map((s) => ({
        personaId: s.personaId,
        name: s.name,
        division: s.division,
        status: "proposed" as SpecialistStatus,
      }))

      state.team = team
      await saveState(context.directory, state, context.sessionID)

      const proposalTable = args.specialists
        .map(
          (s, i) =>
            `${i + 1}. **${s.name}** (${s.personaId}) — ${s.division}\n   Justification: ${s.justification}`
        )
        .join("\n\n")

      return successResponse(
        "Team Proposal — Awaiting Human Approval",
        `${formatPhaseHeader(state.currentPhase)}\n\nThe following team has been proposed:\n\n${proposalTable}\n\n**IMPORTANT**: This team requires explicit human approval before summoning. Present this proposal to the human and wait for confirmation.`,
        { teamSize: team.length }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error proposing team: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const summonTeamTool = tool({
  description:
    "Summons the proposed team after human approval. Marks each specialist as summoned in the state.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      if (state.briefing.status !== "approved" && state.briefing.status !== "delivered") {
        return errorResponse("Briefing must be approved or delivered before summoning a team.")
      }

      const proposed = state.team.filter((s) => s.status === "proposed")
      if (proposed.length === 0) {
        return errorResponse("No proposed specialists found. Use propose_team first.")
      }

      for (const member of state.team) {
        if (member.status === "proposed") {
          member.status = "summoned"
        }
      }

      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "team_summoned", state.currentPhase, { count: state.team.filter(s => s.status === "summoned").length })

      const summonedList = state.team
        .filter((s) => s.status === "summoned")
        .map((s) => `  - ${s.name} (${s.personaId}) — ${s.division}`)
        .join("\n")

      return successResponse(
        "Team Summoned",
        `${formatPhaseHeader(state.currentPhase)}\n\n${state.team.filter((s) => s.status === "summoned").length} specialists summoned:\n${summonedList}\n\nTeam is ready for discussion rounds.`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error summoning team: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

/**
 * Looks for an approved appendix that matches the given phase name.
 * Checks state.appendices first, then scans the appendices directory.
 */
async function findPhaseAppendix(
  directory: string,
  stateAppendices: string[],
  phaseName: string
): Promise<string | null> {
  const phaseSlug = phaseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  if (!phaseSlug) return null

  // Check state appendices first
  for (const appendixPath of stateAppendices) {
    const basename = appendixPath.split("/").pop() || ""
    if (basename.toLowerCase().includes(phaseSlug)) {
      return appendixPath
    }
  }

  // Fall back to scanning the appendices directory
  const appendicesDir = join(directory, PLUGIN_STATE_DIR, "specifications", "appendices")
  try {
    const entries = await fs.readdir(appendicesDir)
    for (const entry of entries) {
      if (entry.endsWith(".md") && entry.toLowerCase().includes(phaseSlug)) {
        return join(appendicesDir, entry)
      }
    }
  } catch {
    // Directory may not exist yet
  }

  return null
}

export const delegateTaskTool = tool({
  description:
    "Defines a task for a specialist. Records the delegation in Mesa state and returns instructions to invoke the specialist via the task tool. When a phase appendix exists, it is used as the authoritative specification for that phase.",
  args: {
    personaId: tool.schema.string().describe("The specialist persona ID (also the subagent_type for the task tool)"),
    task: tool.schema.string().describe("Clear description of the task to delegate"),
    context_info: tool.schema
      .string()
      .optional()
      .describe("Additional context (briefing excerpt, code reference, etc.)"),
    phase_name: tool.schema
      .string()
      .optional()
      .describe("Optional phase name for appendix lookup. If a matching approved appendix exists, it becomes the authoritative context for this task."),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "EXECUTION")
      if (phaseError) throw new PhaseError(phaseError)

      let specialist = state.team.find((s) => s.personaId === args.personaId)

      if (!specialist) {
        const persona = await getPersonaById(args.personaId)
        if (persona) {
          specialist = {
            personaId: persona.id,
            name: persona.name,
            division: persona.division,
            status: "delegated" as SpecialistStatus,
          }
          state.team.push(specialist)
        }
      }

      if (!specialist) {
        const teamMembers = state.team.map((s) => `  - ${s.personaId} (${s.name})`).join("\n")
        const { listSpecialistsTool } = await import("./catalog-tools.js")
        const term = args.personaId.toLowerCase()
        return errorResponse(
          `Specialist "${args.personaId}" not found in the current team or catalog.\n\n` +
          `Current team members:\n${teamMembers || "  (none)"}\n\n` +
          `Use list_specialists to browse available specialists, or check for close matches.`
        )
      }

      // Appendix preference: if phase_name is provided and a matching appendix exists,
      // prepend it to the context so the specialist uses the appendix as authority.
      let effectiveContext = args.context_info
      if (args.phase_name) {
        const appendixPath = await findPhaseAppendix(
          context.directory,
          state.appendices,
          args.phase_name
        )
        if (appendixPath) {
          const appendixNote = `**Phase Appendix (authoritative for "${args.phase_name}"):** ${appendixPath}`
          effectiveContext = effectiveContext
            ? `${appendixNote}\n\n**Additional Context:**\n${effectiveContext}`
            : appendixNote
        }
      }

      const promptParts = [
        `## Task from Manager`,
        ``,
        `### Task`,
        args.task,
      ]

      if (effectiveContext) {
        promptParts.push(``, `### Context`, effectiveContext)
      }

      await saveState(context.directory, state, context.sessionID)

      return successResponse(
        `Task ready for ${specialist.name}`,
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          ``,
          `Task defined for **${specialist.name}** (${args.personaId}).`,
          ``,
          `Now invoke the specialist using the **task** tool:`,
          `\`task(subagent_type="mesa/${args.personaId}", task_id="mesa-${args.personaId}", prompt="...", description="...")\``,
          ``,
          `Using \`task_id="mesa-${args.personaId}"\` creates a named session that persists across turns. If the specialist was invoked before in this session, they resume with full context.`,
          `If the task tool returns a \`ses_...\` ID instead of accepting the slug, save that ID and reuse it as task_id in subsequent invocations to preserve memory.`,
          ``,
          `### Prompt content for the specialist:`,
          promptParts.join("\n"),
        ].join("\n"),
        { personaId: args.personaId }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error delegating task: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const definePhasesTool = tool({
  description:
    "Defines the workflow phases for the current project. Transitions the state accordingly.",
  args: {
    phases: tool.schema
      .array(tool.schema.string())
      .describe("Ordered array of phase names. Valid values: PLANNING, DISCUSSION, SPECIFICATION, EXECUTION. Example: ['PLANNING', 'DISCUSSION', 'SPECIFICATION', 'EXECUTION']"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const validPhases: DiscussionPhase[] = [
        "PLANNING", "DISCUSSION", "SPECIFICATION", "EXECUTION",
      ]

      const invalid = args.phases.filter((p) => !validPhases.includes(p as DiscussionPhase))
      if (invalid.length > 0) {
        return errorResponse(`Invalid phases: ${invalid.join(", ")}. Valid: ${validPhases.join(", ")}`)
      }

      state.phases = args.phases
      await saveState(context.directory, state, context.sessionID)

      return successResponse(
        "Workflow Phases Defined",
        `${formatPhaseHeader(state.currentPhase)}\n\nPhases: ${args.phases.join(" → ")}\n\nCurrent phase: ${state.currentPhase}`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error defining phases: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

// ---------------------------------------------------------------------------
// Phase Analysis Orchestration Tools (Phase 3)
// ---------------------------------------------------------------------------

export const checkExecutionPhasesTool = tool({
  description:
    "Checks the approved master specification for an execution plan with phases. Returns a choice prompt for the human: proceed directly to implementation, or deep-dive selected phases. Returns a bypass message if no execution plan is detected.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "EXECUTION")
      if (phaseError) throw new PhaseError(phaseError)

      if (state.specification.status !== "approved" || !state.specification.path) {
        return errorResponse(
          "No approved specification found. Approve a specification first using approve_specification."
        )
      }

      const content = await fs.readFile(state.specification.path, "utf-8")
      const phases = detect_execution_phases(content)

      if (!phases || phases.length === 0) {
        return successResponse(
          "No Execution Plan Detected",
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            ``,
            `No execution plan with phases detected in the approved specification.`,
            `The specification appears to be analysis-only or lacks a structured execution plan.`,
            ``,
            `Proceed directly to implementation delegation.`,
          ].join("\n")
        )
      }

      const phaseList = phases
        .map((p) => `  ${p.index}. ${p.name}`)
        .join("\n")

      const output = [
        `${formatPhaseHeader(state.currentPhase)}`,
        ``,
        `The master specification has been approved. It contains an execution plan with ${phases.length} phase(s).`,
        ``,
        phaseList,
        ``,
        `[1] Proceed to implementation — delegate all phases based on the master spec.`,
        `[2] Deep-dive selected phases — open structured analysis rounds for phases that need further exploration.`,
        ``,
        `Tip: Choose [2] if any phase involves uncertain technical decisions, complex integration, or significant architectural changes.`,
      ].join("\n")

      return successResponse(
        "Execution Plan Detected",
        output,
        { phaseCount: phases.length, phases }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error checking execution phases: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})

export const selectPhasesForAnalysisTool = tool({
  description:
    "Selects phases for deep-dive analysis after the human chooses option [2]. Parses selection strings like '1, 3, 5', 'all', or 'none'. Stores the selection in the phase context sidecar.",
  args: {
    selection: tool.schema
      .string()
      .describe("Phase selection: 'all', 'none', or comma-separated indices like '1, 3, 5' or ranges like '1-3'"),
    phase_count: tool.schema
      .number()
      .describe("Total number of phases available (from check_execution_phases)"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "EXECUTION")
      if (phaseError) throw new PhaseError(phaseError)

      const selected = parse_phase_selection(args.selection, args.phase_count)
      if (selected instanceof Error) {
        return errorResponse(selected.message)
      }

      if (selected.length === 0) {
        return successResponse(
          "Phase Analysis Skipped",
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            ``,
            `No phases selected for deep-dive analysis.`,
            `Proceed directly to implementation delegation.`,
          ].join("\n")
        )
      }

      // Persist selection to phase context sidecar
      const sessionId = getSessionId(context.directory, context.sessionID)
      if (sessionId) {
        const repo = new SqliteStateRepository(context.directory)
        await repo.savePhaseContext({
          workspaceId: state.workspaceId,
          sessionId,
          phase: "phase-selection",
          context: { selectedIndices: selected, totalPhases: args.phase_count },
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
        })
        repo.close()
      }

      const selectionText = selected
        .map((i: number) => `  ${i}. Phase ${i}`)
        .join("\n")

      const output = [
        `${formatPhaseHeader(state.currentPhase)}`,
        ``,
        `Selected ${selected.length} phase(s) for deep-dive analysis:`,
        selectionText,
        ``,
        `Choose the observation mode:`,
        `[1] Guided — 2-4 questions per phase before analysis begins`,
        `[2] Automatic — run phase analysis immediately with no additional human input`,
      ].join("\n")

      return successResponse(
        "Phases Selected",
        output,
        { selectedIndices: selected, totalPhases: args.phase_count }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error selecting phases: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})

export const configurePhaseObservationTool = tool({
  description:
    "Configures the observation mode for a phase analysis round and persists mini-briefing context. In guided mode, returns 4 targeted questions for the human. In automatic mode, records that the phase should proceed without additional input.",
  args: {
    mode: tool.schema
      .enum(["guided", "automatic"])
      .describe("Observation mode: 'guided' asks questions first; 'automatic' runs immediately"),
    phase_name: tool.schema
      .string()
      .describe("Name of the phase being configured"),
    observations: tool.schema
      .string()
      .optional()
      .describe("Free-form observations from the human (guided mode only)"),
    master_spec_context: tool.schema
      .string()
      .optional()
      .describe("Relevant excerpt from the master specification for question tailoring"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "EXECUTION")
      if (phaseError) throw new PhaseError(phaseError)

      const sessionId = getSessionId(context.directory, context.sessionID)
      const now = new Date().toISOString()

      if (args.mode === "guided") {
        const questions = build_mini_briefing_questions(
          args.phase_name,
          args.master_spec_context || ""
        )

        const output = [
          `${formatPhaseHeader(state.currentPhase)}`,
          ``,
          `**Phase:** ${args.phase_name}`,
          `**Mode:** Guided`,
          ``,
          `Observations recorded:`,
          args.observations || "(none)",
          ``,
          `## Suggested Questions`,
          ``,
          ...questions.map((q, i) => `${i + 1}. ${q}`),
          ``,
          `Ask the human these questions and record their answers before proceeding to open the phase analysis round.`,
        ].join("\n")

        // Persist to phase context sidecar
        if (sessionId) {
          const repo = new SqliteStateRepository(context.directory)
          await repo.savePhaseContext({
            workspaceId: state.workspaceId,
            sessionId,
            phase: args.phase_name,
            context: {
              mode: args.mode,
              observations: args.observations || "",
              questions,
              masterSpecContext: args.master_spec_context || "",
            },
            schemaVersion: 1,
            updatedAt: now,
          })
          repo.close()
        }

        return successResponse(
          "Guided Observation Configured",
          output,
          { phase: args.phase_name, mode: args.mode, questions }
        )
      }

      // Automatic mode
      if (sessionId) {
        const repo = new SqliteStateRepository(context.directory)
        await repo.savePhaseContext({
          workspaceId: state.workspaceId,
          sessionId,
          phase: args.phase_name,
          context: {
            mode: args.mode,
            observations: "",
            questions: [],
            masterSpecContext: args.master_spec_context || "",
          },
          schemaVersion: 1,
          updatedAt: now,
        })
        repo.close()
      }

      return successResponse(
        "Automatic Mode Configured",
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          ``,
          `**Phase:** ${args.phase_name}`,
          `**Mode:** Automatic`,
          ``,
          `Phase analysis will proceed without additional human input.`,
          `Call \`open_phase_analysis_round\` to begin the analysis for this phase.`,
        ].join("\n")
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error configuring observation mode: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})

export const verifyImplementationTool = tool({
  description:
    "Records the result of verifying implementation against acceptance criteria. When result is 'failed', presents gaps to the human for decision (accept as tech debt or correct). When result is 'passed', marks the phase/task as verified. Must be called during EXECUTION phase.",
  args: {
    phase_name: tool.schema
      .string()
      .describe("Name of the phase being verified"),
    task_description: tool.schema
      .string()
      .describe("Description of what was implemented"),
    acceptance_criteria: tool.schema
      .array(tool.schema.string())
      .describe("List of acceptance criteria checked during verification"),
    result: tool.schema
      .enum(["passed", "failed"])
      .describe("Verification result: 'passed' if all criteria met, 'failed' if gaps found"),
    gaps: tool.schema
      .array(tool.schema.string())
      .describe("List of unmet acceptance criteria (empty if passed)"),
    qa_specialist_id: tool.schema
      .string()
      .describe("Persona ID of the QA specialist who performed the verification"),
    human_decision: tool.schema
      .enum(["accepted", "correct"])
      .optional()
      .describe("Human decision for failed verification: 'accepted' (register as tech debt) or 'correct' (open analysis and fix)"),
    accepted_gaps: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Gaps the human accepted as tech debt (subset of gaps)"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "EXECUTION")
      if (phaseError) throw new PhaseError(phaseError)

      const sessionId = getSessionId(context.directory, context.sessionID)
      const verificationKey = `verification-${slugify(args.phase_name)}`
      const now = new Date().toISOString()

      if (args.result === "passed" && args.gaps.length > 0) {
        return errorResponse(
          "Invalid verification: result is 'passed' but gaps list is non-empty. " +
          "A passing verification must have an empty gaps array."
        )
      }

      if (args.result === "failed" && args.gaps.length === 0) {
        return errorResponse(
          "Invalid verification: result is 'failed' but no gaps specified. " +
          "A failing verification must include at least one gap."
        )
      }

      if (args.result === "passed") {
        if (sessionId) {
          const repo = new SqliteStateRepository(context.directory)
          await repo.savePhaseContext({
            workspaceId: state.workspaceId,
            sessionId,
            phase: verificationKey,
            context: {
              phaseName: args.phase_name,
              taskDescription: args.task_description,
              criteria: args.acceptance_criteria,
              result: "passed",
              gaps: [],
              qaSpecialistId: args.qa_specialist_id,
              verifiedAt: now,
              status: "verified",
            },
            schemaVersion: 1,
            updatedAt: now,
          })
          repo.close()
        }

        await logAction(context.directory, "verify_implementation", state.currentPhase, {
          phase: args.phase_name,
          result: "passed",
          criteriaCount: args.acceptance_criteria.length,
          qaSpecialistId: args.qa_specialist_id,
        })

        return successResponse(
          `Verification Passed — ${args.phase_name}`,
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            ``,
            `**Phase:** ${args.phase_name}`,
            `All ${args.acceptance_criteria.length} acceptance criteria met.`,
            `Phase/task marked as verified.`,
          ].join("\n"),
          { phase: args.phase_name, result: "passed" }
        )
      }

      // result === "failed"
      if (!args.human_decision) {
        if (sessionId) {
          const repo = new SqliteStateRepository(context.directory)
          await repo.savePhaseContext({
            workspaceId: state.workspaceId,
            sessionId,
            phase: verificationKey,
            context: {
              phaseName: args.phase_name,
              taskDescription: args.task_description,
              criteria: args.acceptance_criteria,
              result: "failed",
              gaps: args.gaps,
              qaSpecialistId: args.qa_specialist_id,
              verifiedAt: now,
              status: "pending_human_decision",
            },
            schemaVersion: 1,
            updatedAt: now,
          })
          repo.close()
        }

        const gapLines = args.gaps
          .map((g, i) => `  ${i + 1}. ${g}`)
          .join("\n")

        await logAction(context.directory, "verify_implementation", state.currentPhase, {
          phase: args.phase_name,
          result: "failed",
          gapCount: args.gaps.length,
          status: "pending_human_decision",
        })

        return successResponse(
          `Verification Failed — ${args.phase_name}`,
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            ``,
            `${args.gaps.length} gap(s) found:`,
            gapLines,
            ``,
            `**Human decision required.** Present the gaps and ask:`,
            `[A] Accept — Register these gaps as tech debt for future work.`,
            `[C] Correct — Open analysis for each gap and delegate corrections.`,
            ``,
            `Call verify_implementation again with human_decision='accepted' or 'correct'.`,
          ].join("\n"),
          { phase: args.phase_name, result: "failed", gapCount: args.gaps.length }
        )
      }

      // human_decision is defined
      if (args.human_decision === "accepted") {
        if (sessionId) {
          const repo = new SqliteStateRepository(context.directory)
          await repo.savePhaseContext({
            workspaceId: state.workspaceId,
            sessionId,
            phase: verificationKey,
            context: {
              phaseName: args.phase_name,
              taskDescription: args.task_description,
              criteria: args.acceptance_criteria,
              result: "failed",
              gaps: args.gaps,
              qaSpecialistId: args.qa_specialist_id,
              verifiedAt: now,
              status: "accepted_as_debt",
              humanDecision: "accepted",
              acceptedGaps: args.accepted_gaps ?? args.gaps,
              decidedAt: now,
            },
            schemaVersion: 1,
            updatedAt: now,
          })
          repo.close()
        }

        const acceptedList = (args.accepted_gaps ?? args.gaps)
          .map((g, i) => `  ${i + 1}. ${g}`)
          .join("\n")

        await logAction(context.directory, "verify_implementation", state.currentPhase, {
          phase: args.phase_name,
          result: "failed",
          humanDecision: "accepted",
          acceptedGapCount: (args.accepted_gaps ?? args.gaps).length,
        })

        return successResponse(
          `Gaps Accepted as Tech Debt — ${args.phase_name}`,
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            ``,
            `${(args.accepted_gaps ?? args.gaps).length} gap(s) registered for future work:`,
            acceptedList,
            `Proceeding to next task/phase.`,
          ].join("\n"),
          { phase: args.phase_name, humanDecision: "accepted" }
        )
      }

      // human_decision === "correct"
      if (sessionId) {
        const repo = new SqliteStateRepository(context.directory)
        await repo.savePhaseContext({
          workspaceId: state.workspaceId,
          sessionId,
          phase: verificationKey,
          context: {
            phaseName: args.phase_name,
            taskDescription: args.task_description,
            criteria: args.acceptance_criteria,
            result: "failed",
            gaps: args.gaps,
            qaSpecialistId: args.qa_specialist_id,
            verifiedAt: now,
            status: "correction_pending",
            humanDecision: "correct",
            decidedAt: now,
          },
          schemaVersion: 1,
          updatedAt: now,
        })
        repo.close()
      }

      const correctionList = args.gaps
        .map((g, i) => `  ${i + 1}. ${g}`)
        .join("\n")

      await logAction(context.directory, "verify_implementation", state.currentPhase, {
        phase: args.phase_name,
        result: "failed",
        humanDecision: "correct",
        gapCount: args.gaps.length,
      })

      return successResponse(
        `Correction Required — ${args.phase_name}`,
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          ``,
          `${args.gaps.length} gap(s) need correction:`,
          correctionList,
          ``,
          `**Next steps:**`,
          `1. For each gap, use open_phase_analysis_round (or open_analysis_round) to analyze the root cause.`,
          `2. Delegate corrections via delegate_task.`,
          `3. After corrections are applied, run verify_implementation again to re-verify.`,
        ].join("\n"),
        { phase: args.phase_name, humanDecision: "correct" }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(
        `Error recording verification: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  },
})
