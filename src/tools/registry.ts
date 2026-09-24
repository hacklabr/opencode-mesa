import type { ToolDefinition } from "@opencode-ai/plugin/tool"
import { mesaStatusTool } from "./mesa-tools.js"
import { listSpecialistsTool, getSpecialistTool } from "./catalog-tools.js"
import { createBriefingTool, approveBriefingTool, importBriefingTool } from "./briefing-tools.js"
import { proposeTeamTool, summonTeamTool } from "./manager-tools.js"
import {
  registerAnalysisTool,
  getPeerAnalysesTool,
  pauseDiscussionTool,
  resumeDiscussionTool,
  cancelDiscussionTool,
} from "./discussion-tools.js"
import { openRoundTool, closeRoundTool } from "./round-tools.js"
import { recordDecisionTool, produceDeliverableTool, approveDeliverableTool } from "./decision-tools.js"
import { mesaCheckUpdateTool, mesaUpdateTool } from "./update-tools.js"
import { askPeerTool } from "./peer-tools.js"
import { memoryStoreTool, memoryRecallTool, memoryForgetTool } from "./memory-tools.js"

/**
 * Single source of truth for every Mesa tool, in V1 definition shape
 * (`{description, args: ZodRawShape, execute}`). Both hosts build their
 * registrations from this map:
 * - V1: passed through as the `tool` hook map.
 * - V2: `src/v2/tool-adapter.ts` converts each entry to a V2 `editor.add`
 *   definition (JSON Schema input + context/result adaptation).
 */
export const mesaTools: Record<string, ToolDefinition> = {
  mesa_status: mesaStatusTool,
  list_specialists: listSpecialistsTool,
  get_specialist: getSpecialistTool,
  create_briefing: createBriefingTool,
  approve_briefing: approveBriefingTool,
  import_briefing: importBriefingTool,
  propose_team: proposeTeamTool,
  summon_team: summonTeamTool,
  open_round: openRoundTool,
  register_analysis: registerAnalysisTool,
  get_peer_analyses: getPeerAnalysesTool,
  close_round: closeRoundTool,
  record_decision: recordDecisionTool,
  produce_deliverable: produceDeliverableTool,
  approve_deliverable: approveDeliverableTool,
  ask_peer: askPeerTool,
  pause_discussion: pauseDiscussionTool,
  resume_discussion: resumeDiscussionTool,
  cancel_discussion: cancelDiscussionTool,
  memory_store: memoryStoreTool,
  memory_recall: memoryRecallTool,
  memory_forget: memoryForgetTool,
  mesa_check_update: mesaCheckUpdateTool,
  mesa_update: mesaUpdateTool,
}
