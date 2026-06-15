import type { Plugin } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import { mesaStatusTool } from "./tools/mesa-tools"
import { listSpecialistsTool, getSpecialistTool } from "./tools/catalog-tools"
import { createBriefingTool, approveBriefingTool, deliverBriefingTool, importBriefingTool } from "./tools/briefing-tools"
import {
  analyzeBriefingTool,
  proposeTeamTool,
  summonTeamTool,
  delegateTaskTool,
  definePhasesTool,
  checkExecutionPhasesTool,
  selectPhasesForAnalysisTool,
  configurePhaseObservationTool,
  verifyImplementationTool,
} from "./tools/manager-tools"
import {
  openAnalysisRoundTool,
  registerAnalysisTool,
  getPeerAnalysesTool,
  requestConsensusTool,
  generateSpecificationTool,
  approveSpecificationTool,
  pauseDiscussionTool,
  resumeDiscussionTool,
  cancelDiscussionTool,
} from "./tools/discussion-tools"
import {
  detectPhasesTool,
  openPhaseAnalysisRoundTool,
  requestPhaseConsensusTool,
  generatePhaseAppendixTool,
} from "./tools/phase-analysis-tools"
import { checkForUpdate } from "./updater/checker"
import { mesaCheckUpdateTool, mesaUpdateTool } from "./tools/update-tools"
import { loadState, getSessionId } from "./state"
import { logAction } from "./audit"
import { buildAskPeerPath } from "./utils/paths"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { PLUGIN_STATE_DIR } from "./config"

// P1-T7: Capture SDK client for session.status() checks in permission.ask hook
let opencodeClient: OpencodeClient | null = null

export function getOpencodeClient(): OpencodeClient | null {
  return opencodeClient
}

// P1-T9: Recursion guard — tracks active task calls between sessions
const activeTaskCalls = new Map<string, Set<string>>() // callerSessionId → Set<calleePersonaId>

export const mesa: Plugin = async (input) => {
  // P1-T7: Capture the SDK client (non-optional for permission.ask hook)
  opencodeClient = input.client

  // Fire-and-forget update check — populates cache for tools
  checkForUpdate().catch(() => {})

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
      check_execution_phases: checkExecutionPhasesTool,
      select_phases_for_analysis: selectPhasesForAnalysisTool,
      configure_phase_observation: configurePhaseObservationTool,
      verify_implementation: verifyImplementationTool,
      open_analysis_round: openAnalysisRoundTool,
      register_analysis: registerAnalysisTool,
      get_peer_analyses: getPeerAnalysesTool,
      request_consensus: requestConsensusTool,
      generate_specification: generateSpecificationTool,
      approve_specification: approveSpecificationTool,
      pause_discussion: pauseDiscussionTool,
      resume_discussion: resumeDiscussionTool,
      cancel_discussion: cancelDiscussionTool,
      detect_phases: detectPhasesTool,
      open_phase_analysis_round: openPhaseAnalysisRoundTool,
      request_phase_consensus: requestPhaseConsensusTool,
      generate_phase_appendix: generatePhaseAppendixTool,
      mesa_check_update: mesaCheckUpdateTool,
      mesa_update: mesaUpdateTool,
    },

    // P1-T9: permission.ask hook — gate task calls between specialists
    "permission.ask": async (permissionInput, output) => {
      // Only gate task permission checks
      if (permissionInput.type !== "task") return

      const pattern = Array.isArray(permissionInput.pattern)
        ? permissionInput.pattern[0]
        : permissionInput.pattern

      // Only gate mesa/* patterns (non-mesa is already denied by frontmatter)
      if (!pattern || !pattern.startsWith("mesa/")) return

      try {
        // Load Mesa state to check phase and mode
        const directory = (permissionInput.metadata?.directory as string) || input.directory
        const state = await loadState(directory)

        // Gate 1: Only during ANALYSIS phase
        if (state.currentPhase !== "ANALYSIS") {
          output.status = "deny"
          return
        }

        // Gate 2: Only during debate/discussion mode (sequential turns)
        if (state.discussion.mode !== "debate") {
          output.status = "deny"
          return
        }

        // Gate 3: Recursion prevention — check if callee is currently asking caller
        const calleePersonaId = pattern.replace(/^mesa\//, "")
        const callerSessionId = permissionInput.sessionID

        // Check if the reverse edge exists (callee → caller)
        for (const [_callerSession, callees] of activeTaskCalls) {
          if (callees.has(calleePersonaId)) {
            // The callee has an active call to someone — check if it's circular
            // Simple heuristic: if this session is already a callee in any active call, deny
            const isAlreadyCallee = Array.from(activeTaskCalls.values()).some(
              (set) => set.has(calleePersonaId)
            )
            if (isAlreadyCallee) {
              output.status = "deny"
              return
            }
          }
        }

        // Gate 4: Busy check via SDK client — verify target session is idle
        if (opencodeClient) {
          try {
            const statusResult = await opencodeClient.session.status({
              query: { directory },
            })
            if (statusResult.data) {
              // Check all sessions for busy status
              for (const [sessId, sessStatus] of Object.entries(statusResult.data)) {
                if (sessStatus.type === "busy") {
                  // If the caller itself is busy (responding to a task call), deny nested calls
                  if (sessId === callerSessionId) {
                    output.status = "deny"
                    return
                  }
                }
              }
            }
          } catch {
            // Status check failed — fail-safe deny
            output.status = "deny"
            return
          }
        }

        // All gates passed — allow the call
        output.status = "allow"

        // Track the active call for recursion prevention
        const callerCallees = activeTaskCalls.get(callerSessionId) ?? new Set<string>()
        callerCallees.add(calleePersonaId)
        activeTaskCalls.set(callerSessionId, callerCallees)
      } catch {
        // Fail-safe: deny on any error
        output.status = "deny"
      }
    },

    // P1-T10: tool.execute.after hook — audit logging of task exchanges
    "tool.execute.after": async (toolInput, toolOutput) => {
      // Only log task calls to mesa/* agents
      if (toolInput.tool !== "task") return

      const args = toolInput.args as Record<string, unknown> | undefined
      if (!args?.subagent_type) return

      const subagentType = String(args.subagent_type)
      if (!subagentType.startsWith("mesa/")) return

      try {
        const calleePersonaId = subagentType.replace(/^mesa\//, "")
        const directory = input.directory

        // Clear the active call from the recursion guard
        const callerCallees = activeTaskCalls.get(toolInput.sessionID)
        if (callerCallees) {
          callerCallees.delete(calleePersonaId)
          if (callerCallees.size === 0) {
            activeTaskCalls.delete(toolInput.sessionID)
          }
        }

        // Load state to get sessionId for path construction
        const state = await loadState(directory)
        const mesaSessionId = getSessionId(directory)
        if (!mesaSessionId) return

        // Save exchange to audit trail
        const exchangeId = randomUUID().slice(0, 8)
        const exchangeRelPath = buildAskPeerPath(
          mesaSessionId,
          toolInput.sessionID.slice(0, 8),
          calleePersonaId,
          exchangeId
        )
        const exchangeAbsPath = join(directory, exchangeRelPath)
        const exchangeDir = join(exchangeAbsPath, "..")
        await fs.mkdir(exchangeDir, { recursive: true })

        const promptText = (args.prompt as string) || "(no prompt captured)"
        const responseText = (toolOutput.output || "").slice(0, 5000)

        await fs.writeFile(exchangeAbsPath, [
          `# Peer Consultation via task`,
          ``,
          `**Caller Session:** ${toolInput.sessionID}`,
          `**Peer:** ${calleePersonaId}`,
          `**Timestamp:** ${new Date().toISOString()}`,
          `**Mesa Phase:** ${state.currentPhase}`,
          `**Discussion Mode:** ${state.discussion.mode}`,
          ``,
          `## Question`,
          ``,
          promptText,
          ``,
          `## Response`,
          ``,
          responseText,
        ].join("\n"), "utf-8")

        await logAction(directory, "peer_task_completed", state.currentPhase, {
          callerSession: toolInput.sessionID,
          peer: calleePersonaId,
          exchangeFile: exchangeRelPath,
        })
      } catch {
        // Audit logging is best-effort — never fail the tool call
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
    },

    "tool.definition": async (toolDefInput, output) => {
      const mesaTools = [
      "mesa_status", "list_specialists", "get_specialist",
      "create_briefing", "approve_briefing", "deliver_briefing", "import_briefing",
      "analyze_briefing", "propose_team", "summon_team",
      "delegate_task", "define_phases",
      "check_execution_phases", "select_phases_for_analysis", "configure_phase_observation",
      "verify_implementation",
      "open_analysis_round", "register_analysis", "get_peer_analyses", "request_consensus",
      "generate_specification", "approve_specification",
      "pause_discussion", "resume_discussion", "cancel_discussion",
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
