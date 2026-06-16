import { tool } from "@opencode-ai/plugin/tool"
import { PLUGIN_VERSION } from "../config"
import { loadState } from "../state"
import { successResponse, errorResponse } from "../utils/responses"

export const mesaStatusTool = tool({
  description: "Returns the current status and version of the Mesa plugin.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)

      const updated = new Date(state.updatedAt).toLocaleString()
      const summary = [
        `Mesa v${PLUGIN_VERSION} | Phase: ${state.currentPhase} | Updated: ${updated}`,
        `Briefing: ${state.briefing.status} | Team: ${state.team.length} specialists | Analyses: ${state.discussion.analyses.length} | Votes: ${state.discussion.votes.length}`,
        `Specification: ${state.specification.status}`,
      ].join("\n")

      return successResponse("Mesa Status", summary, {
        version: PLUGIN_VERSION,
        phase: state.currentPhase,
        briefingStatus: state.briefing.status,
        teamSize: state.team.length,
        analysesCount: state.discussion.analyses.length,
        votesCount: state.discussion.votes.length,
        specificationStatus: state.specification.status,
        updatedAt: state.updatedAt,
      })
    } catch (err) {
      return errorResponse(`Error loading Mesa status: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
