import type { Plugin } from "@opencode-ai/plugin"
import { mesaStatusTool } from "./tools/mesa-tools"
import { listSpecialistsTool, getSpecialistTool } from "./tools/catalog-tools"
import { createBriefingTool, approveBriefingTool, deliverBriefingTool, importBriefingTool } from "./tools/briefing-tools"
import {
  analyzeBriefingTool,
  proposeTeamTool,
  summonTeamTool,
  delegateTaskTool,
  definePhasesTool,
} from "./tools/manager-tools"
import {
  openAnalysisRoundTool,
  registerAnalysisTool,
  requestConsensusTool,
  generateSpecificationTool,
  approveSpecificationTool,
  pauseDiscussionTool,
  resumeDiscussionTool,
  cancelDiscussionTool,
} from "./tools/discussion-tools"

export const mesa: Plugin = async () => {
  return {
    tool: {
      mesa_status: mesaStatusTool,
      list_specialists: listSpecialistsTool,
      get_specialist: getSpecialistTool,
      create_briefing: createBriefingTool,
      approve_briefing: approveBriefingTool,
      deliver_briefing: deliverBriefingTool,
      import_briefing: importBriefingTool,
      analyze_briefing: analyzeBriefingTool,
      propose_team: proposeTeamTool,
      summon_team: summonTeamTool,
      delegate_task: delegateTaskTool,
      define_phases: definePhasesTool,
      open_analysis_round: openAnalysisRoundTool,
      register_analysis: registerAnalysisTool,
      request_consensus: requestConsensusTool,
      generate_specification: generateSpecificationTool,
      approve_specification: approveSpecificationTool,
      pause_discussion: pauseDiscussionTool,
      resume_discussion: resumeDiscussionTool,
      cancel_discussion: cancelDiscussionTool,
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
    },

    "tool.definition": async (input, output) => {
      const mesaTools = [
        "mesa_status", "list_specialists", "get_specialist",
        "create_briefing", "approve_briefing", "deliver_briefing", "import_briefing",
        "analyze_briefing", "propose_team", "summon_team",
        "delegate_task", "define_phases",
        "open_analysis_round", "register_analysis", "request_consensus",
        "generate_specification", "approve_specification",
        "pause_discussion", "resume_discussion", "cancel_discussion",
      ]

      if (mesaTools.includes(input.toolID)) {
        output.description = output.description.replace(
          "$",
          "\n\nIMPORTANT: This tool is part of the Mesa structured workflow. It should be used by the `manager` or `briefing-writer` agents, not by the default agent directly."
        )
      }
    },
  }
}

export default mesa
