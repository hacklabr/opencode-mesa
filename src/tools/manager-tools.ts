import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState } from "../state"
import type { DiscussionPhase, SpecialistEntry, SpecialistStatus } from "../types"
import { getPersonaById } from "./catalog-tools"
import { logAction } from "../audit"
import { canTransition, requirePhase, formatPhaseHeader, ALL_PHASES } from "../workflow/transitions"
import { promises as fs } from "node:fs"
import { successResponse, errorResponse } from "../utils/responses"
import { PhaseError, MesaError } from "../errors"

export const analyzeBriefingTool = tool({
  description:
    "Reads the current approved briefing and returns its content for analysis by the Manager.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)
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
      const state = await loadState(context.directory)
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
      await saveState(context.directory, state)

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
      const state = await loadState(context.directory)
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

      await saveState(context.directory, state)
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

export const delegateTaskTool = tool({
  description:
    "Defines a task for a specialist. Records the delegation in Mesa state and returns instructions to invoke the specialist via the task tool.",
  args: {
    personaId: tool.schema.string().describe("The specialist persona ID (also the subagent_type for the task tool)"),
    task: tool.schema.string().describe("Clear description of the task to delegate"),
    context_info: tool.schema
      .string()
      .optional()
      .describe("Additional context (briefing excerpt, code reference, etc.)"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
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
        const { listSpecialistsTool } = await import("./catalog-tools")
        const term = args.personaId.toLowerCase()
        return errorResponse(
          `Specialist "${args.personaId}" not found in the current team or catalog.\n\n` +
          `Current team members:\n${teamMembers || "  (none)"}\n\n` +
          `Use list_specialists to browse available specialists, or check for close matches.`
        )
      }

      const promptParts = [
        `## Task from Manager`,
        ``,
        `### Task`,
        args.task,
      ]

      if (args.context_info) {
        promptParts.push(``, `### Context`, args.context_info)
      }

      await saveState(context.directory, state)

      return successResponse(
        `Task ready for ${specialist.name}`,
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          ``,
          `Task defined for **${specialist.name}** (${args.personaId}).`,
          ``,
          `Now invoke the specialist using the **task** tool:`,
          `\`task(subagent_type="mesa/${args.personaId}", prompt="...", description="...")\``,
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
      .describe("Ordered array of phase names (e.g. ['PLANNING', 'ANALYSIS', 'CONSENSUS'])"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const validPhases: DiscussionPhase[] = [
        "PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION",
      ]

      const invalid = args.phases.filter((p) => !validPhases.includes(p as DiscussionPhase))
      if (invalid.length > 0) {
        return errorResponse(`Invalid phases: ${invalid.join(", ")}. Valid: ${validPhases.join(", ")}`)
      }

      state.phases = args.phases
      await saveState(context.directory, state)

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
