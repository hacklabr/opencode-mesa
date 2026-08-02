import type { Plugin } from "@opencode-ai/plugin"
import { mesaStatusTool } from "./tools/mesa-tools.js"
import { listSpecialistsTool, getSpecialistTool } from "./tools/catalog-tools.js"
import { createBriefingTool, approveBriefingTool, importBriefingTool } from "./tools/briefing-tools.js"
import { proposeTeamTool, summonTeamTool } from "./tools/manager-tools.js"
import {
  registerAnalysisTool,
  getPeerAnalysesTool,
  pauseDiscussionTool,
  resumeDiscussionTool,
  cancelDiscussionTool,
} from "./tools/discussion-tools.js"
import { openRoundTool, closeRoundTool } from "./tools/round-tools.js"
import { recordDecisionTool, produceDeliverableTool, approveDeliverableTool } from "./tools/decision-tools.js"
import { checkForUpdate } from "./updater/checker.js"
import { mesaCheckUpdateTool, mesaUpdateTool } from "./tools/update-tools.js"
import { askPeerTool, setSdkClient } from "./tools/peer-tools.js"
import { memoryStoreTool, memoryRecallTool, memoryForgetTool } from "./tools/memory-tools.js"
import { openDatabase } from "./db/driver.js"
import { PLUGIN_STATE_DIR } from "./config.js"
import { setStateSdkClient } from "./state.js"
import { buildSpecialistPrompt, type TaskToolArgs } from "./workflow/specialist-injection.js"
import { join } from "node:path"

export const mesa: Plugin = async (input) => {
  setSdkClient(input.client)
  setStateSdkClient(input.client)

  // Fire-and-forget update check — populates cache for tools
  checkForUpdate().catch(() => {})

  return {
    tool: {
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
    },

    "tool.execute.before": async (toolInput, output) => {
      if (toolInput.tool !== "task") return

      const args = output.args as TaskToolArgs | undefined
      if (!args) return

      try {
        const injected = await buildSpecialistPrompt(args)
        if (injected !== null) {
          args.prompt = injected
        }
      } catch {
        // Persona injection is best-effort — never block the task call
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      const mesaContext = [
        "<mesa-plugin>",
        "## MANDATORY RULE — DO NOT VIOLATE",
        "",
        "You have access to the Mesa plugin — a structured workflow for producing",
        "high-quality specifications through multi-specialist AI discussion.",
        "",
        "### IF you are the briefing-writer or manager agent:",
        "You are ALREADY part of the Mesa workflow. Do your job directly.",
        "Do NOT redirect the user to another agent or suggest switching.",
        "",
        "### IF you are any other agent and the user wants ANY of the following,",
        "### you MUST redirect to the Mesa workflow:",
        "- Create a project briefing or scope document",
        "- Analyze a project, codebase, or product and produce improvement suggestions",
        "- Generate a specification, technical document, or improvement plan",
        "- Start a discussion with specialists or a team of agents",
        "- Any request that involves structured analysis before implementation",
        "",
        "### WHAT you MUST do (non-Mesa agents only):",
        "1. Tell the user: \"This requires the Mesa workflow.\"",
        "2. Suggest the user switch to the `briefing-writer` agent by typing: `/agent briefing-writer`",
        "   - Or use the command: `/briefing` to start the workflow automatically.",
        "3. NEVER attempt to produce specifications, improvement plans, or analysis documents",
        "   by yourself. ALWAYS delegate to the Mesa workflow.",
        "",
        "### WHY this exists:",
        "The Mesa workflow ensures that multiple AI specialists analyze, debate, and reach",
        "consensus before producing any specification. Bypassing it produces lower quality output.",
        "",
        "### EXCEPTION: Only skip the Mesa workflow if the user explicitly says",
        "\"do it yourself\" or \"skip the discussion table\".",
        "",
        "Available Mesa agents:",
        "- `briefing-writer`: Conducts structured discovery to create professional briefings.",
        "- `manager`: Orchestrates specialist teams, manages discussion rounds and specifications.",
        "",
        "To start: user types `/agent briefing-writer` or `/briefing`.",
        "</mesa-plugin>",
      ].join("\n")

      output.system.push(mesaContext)

      // Memory hint — inject count of project memories (non-critical, skip on failure)
      try {
        const dbPath = join(input.directory, PLUGIN_STATE_DIR, "state.db")
        const memDb = openDatabase(dbPath, { readonly: true })
        try {
          const row = memDb
            .query("SELECT COUNT(*) as count FROM mesa_memory WHERE workspace_id = ? AND status = 'active'")
            .get(input.directory) as { count: number } | null
          if (row && row.count > 0) {
            output.system.push(
              `<mesa-memory-hint>${row.count} project memories stored. Use memory_recall to retrieve relevant ones.</mesa-memory-hint>`
            )
          }
        } finally {
          memDb.close()
        }
      } catch {
        // Silently skip — memory hint is non-critical
      }
    },

    "tool.definition": async (toolDefInput, output) => {
      const mesaTools = [
      "mesa_status", "list_specialists", "get_specialist",
      "create_briefing", "approve_briefing", "import_briefing",
      "propose_team", "summon_team",
      "open_round", "register_analysis", "get_peer_analyses", "close_round",
      "record_decision", "produce_deliverable", "approve_deliverable",
      "ask_peer",
      "pause_discussion", "resume_discussion", "cancel_discussion",
      "memory_store", "memory_recall", "memory_forget",
      "mesa_check_update", "mesa_update",
      ]

      if (mesaTools.includes(toolDefInput.toolID)) {
        output.description = output.description.replace(
          "$",
          "\n\nIMPORTANT: This tool is part of the Mesa structured workflow. It should be used by the `manager` or `briefing-writer` agents, not by the default agent directly."
        )
      }
    },
  }
}

export default mesa
