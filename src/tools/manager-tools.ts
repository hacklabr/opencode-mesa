import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState } from "../state.js"
import type { SpecialistEntry, SpecialistStatus } from "../types.js"
import { getPersonaById } from "./catalog-tools.js"
import { logAction } from "../audit.js"
import { formatPhaseHeader } from "../workflow/transitions.js"
import { successResponse, errorResponse } from "../utils/responses.js"
import { MesaError } from "../errors.js"

/**
 * Team tools (kernel, spec D5). Data preconditions only (spec D6) — no phase
 * gating. `currentPhase` is set as a coarse display value where meaningful.
 */

function statusGuard(state: { status: string }): string | null {
  if (state.status !== "active") {
    return `Operation not allowed when discussion status is "${state.status}". Resume the discussion before proceeding.`
  }
  return null
}

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

      const statusError = statusGuard(state)
      if (statusError) throw new MesaError(statusError, "INACTIVE_SESSION")

      // Data precondition (D6): the team is proposed against an approved briefing.
      if (state.briefing.status !== "approved" && state.briefing.status !== "delivered") {
        return errorResponse(
          `propose_team requires an approved briefing (current status: "${state.briefing.status}"). ` +
          `Path: create_briefing → present to the human → approve_briefing.`
        )
      }

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

      const statusError = statusGuard(state)
      if (statusError) throw new MesaError(statusError, "INACTIVE_SESSION")

      if (state.briefing.status !== "approved" && state.briefing.status !== "delivered") {
        return errorResponse(
          `summon_team requires an approved briefing (current status: "${state.briefing.status}"). ` +
          `Path: create_briefing → present to the human → approve_briefing.`
        )
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
