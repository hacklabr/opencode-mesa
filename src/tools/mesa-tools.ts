import { tool } from "@opencode-ai/plugin/tool"
import { PLUGIN_VERSION } from "../config.js"
import { loadState, getSessionId, getDb } from "../state.js"
import { successResponse, errorResponse } from "../utils/responses.js"
import { planGateInstruction } from "../utils/plan-gate.js"
import {
  ensureSessionInput,
  buildSessionFolderPath,
} from "../utils/paths.js"

export const mesaStatusTool = tool({
  description: "Returns the current status and version of the Mesa plugin.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)

      const updated = new Date(state.updatedAt).toLocaleString()
      const openRound = state.rounds.find((r) => r.status === "open")
      const planGate = planGateInstruction(state)

      // Resolve the canonical, session-scoped plan path so the Manager knows
      // exactly where to write workflow-plan.md before gate 0. The session hash
      // in the folder name isolates concurrent sessions.
      let planPath = state.plan?.path ?? null
      let sessionFolder = state.sessionFolder ?? null
      try {
        const sessionId = getSessionId(context.directory, context.sessionID)
        if (sessionId) {
          const input = await ensureSessionInput(context.directory, state, sessionId, getDb)
          sessionFolder = state.sessionFolder ?? buildSessionFolderPath(input)
          if (!planPath) planPath = `${sessionFolder}/workflow-plan.md`
        }
      } catch {
        // Path resolution is best-effort in status; never block the report.
      }

      const summary = [
        `Mesa v${PLUGIN_VERSION} | Status: ${state.status} | Updated: ${updated}`,
        `Briefing: ${state.briefing.status} | Team: ${state.team.length} specialists | Analyses: ${state.discussion.analyses.length}`,
        `Rounds: ${state.rounds.length} (${openRound ? `open: ${openRound.id}` : "none open"}) | Deliverables: ${state.deliverables.length} | Plan: ${state.plan ? `v${state.plan.version} ${state.plan.status}` : "none"}`,
        ...(planPath ? [`Session folder: ${sessionFolder}`, `Plan path: ${planPath}`] : []),
        ...(planGate ? [``, `!!! ACTION REQUIRED !!!`, planGate] : []),
      ].join("\n")

      return successResponse("Mesa Status", summary, {
        version: PLUGIN_VERSION,
        status: state.status,
        phase: state.currentPhase,
        briefingStatus: state.briefing.status,
        teamSize: state.team.length,
        analysesCount: state.discussion.analyses.length,
        roundsCount: state.rounds.length,
        openRoundId: openRound?.id ?? null,
        deliverablesCount: state.deliverables.length,
        plan: state.plan,
        planPath,
        sessionFolder,
        planGateRequired: planGate !== null,
        legacySession: planGate !== null && state.rounds.some((r) => r.id.startsWith("legacy-")),
        updatedAt: state.updatedAt,
      })
    } catch (err) {
      return errorResponse(`Error loading Mesa status: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
