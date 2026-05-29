import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { PLUGIN_VERSION } from "../config"
import { loadState } from "../state"

export const mesaStatusTool = tool({
  description: "Returns the current status and version of the Mesa de Discussao plugin.",
  args: {},
  async execute(_args, context) {
    const state = await loadState(context.directory)
    return {
      title: "Mesa de Discussao Status",
      output: JSON.stringify(
        {
          version: PLUGIN_VERSION,
          phase: state.currentPhase,
          briefingStatus: state.briefing.status,
          teamSize: state.team.length,
          analysesCount: state.discussion.analyses.length,
          votesCount: state.discussion.votes.length,
          specificationStatus: state.specification.status,
          updatedAt: state.updatedAt,
        },
        null,
        2
      ),
    }
  },
})
