import { tool } from "@opencode-ai/plugin/tool"
import { PLUGIN_VERSION } from "../config.js"
import { loadState } from "../state.js"
import { successResponse, errorResponse } from "../utils/responses.js"

export const mesaStatusTool = tool({
  description: "Returns the current status and version of the Mesa plugin.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)

      const updated = new Date(state.updatedAt).toLocaleString()
      const openRound = state.rounds.find((r) => r.status === "open")
      const summary = [
        `Mesa v${PLUGIN_VERSION} | Status: ${state.status} | Updated: ${updated}`,
        `Briefing: ${state.briefing.status} | Team: ${state.team.length} specialists | Analyses: ${state.discussion.analyses.length}`,
        `Rounds: ${state.rounds.length} (${openRound ? `open: ${openRound.id}` : "none open"}) | Deliverables: ${state.deliverables.length} | Plan: ${state.plan ? `v${state.plan.version} ${state.plan.status}` : "none"}`,
      ].join("\n")

      return successResponse("Mesa Status", summary, {
        version: PLUGIN_VERSION,
        status: state.status,
        briefingStatus: state.briefing.status,
        teamSize: state.team.length,
        analysesCount: state.discussion.analyses.length,
        roundsCount: state.rounds.length,
        openRoundId: openRound?.id ?? null,
        deliverablesCount: state.deliverables.length,
        plan: state.plan,
        updatedAt: state.updatedAt,
      })
    } catch (err) {
      return errorResponse(`Error loading Mesa status: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
