import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState, getSessionId } from "../state.js"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { PLUGIN_STATE_DIR } from "../config.js"
import { requirePhase, formatPhaseHeader } from "../workflow/transitions.js"
import { logAction } from "../audit.js"
import { successResponse, errorResponse } from "../utils/responses.js"
import { detectUserJourneys } from "../utils/journey-detection.js"
import { PhaseError, MesaError } from "../errors.js"
import type { JourneyWorkshop, JourneyWorkshopMode } from "../types.js"

const DESIGN_THINKING_PARTICIPANTS = [
  "design-ux-researcher",
  "design-ui-designer",
  "design-ux-architect",
  "product-manager",
]

/**
 * Builds a design-thinking briefing focused on user journeys, derived from the
 * original approved briefing. The goal is to give specialists a clear scope for
 * defining/refactoring journeys without re-analyzing implementation details.
 */
function buildJourneyWorkshopBriefing(
  originalTitle: string,
  originalContent: string,
  detection: Pick<JourneyWorkshop, "signals" | "suggestedJourneys" | "confidence" | "observations" >
): string {
  const signalsList = detection.signals.map((s) => `- ${s}`).join("\n") || "- (none)"
  const suggestedList = detection.suggestedJourneys.map((j) => `- ${j}`).join("\n") || "- (none)"

  return [
    `# Design Thinking Workshop: User Journeys — ${originalTitle}`,
    "",
    "## Objective",
    "",
    "Define or refactor the user journeys that are required before the implementation analysis begins. " +
      "This workshop produces concrete journey artifacts that will be appended to the original briefing.",
    "",
    "## Original Briefing Context",
    "",
    "```",
    originalContent.slice(0, 4000),
    "```",
    "",
    "## Detection Signals",
    "",
    signalsList,
    "",
    "## Suggested Journeys to Explore",
    "",
    suggestedList,
    "",
    "## Workshop Questions",
    "",
    "1. Who are the primary users/personas for each journey?",
    "2. What is the trigger that starts each journey?",
    "3. What are the key steps (happy path) from start to completion?",
    "4. What are the main branch conditions, error states, and edge cases?",
    "5. What existing journeys need to be refactored vs. created from scratch?",
    "6. What are the success criteria and observable outcomes for each journey?",
    "7. What inputs/outputs, notifications, or integrations touch each journey?",
    "",
    "## Expected Output",
    "",
    "A markdown document containing:",
    "- One section per journey",
    "- Persona, trigger, steps, branches, error handling, success criteria",
    "- Open questions or decisions that still need human input",
    "",
    detection.observations ? `## Human Observations\n\n${detection.observations}` : "",
  ].join("\n")
}

export const detectUserJourneysTool = tool({
  description:
    "Reads the current approved briefing and detects whether user journeys need to be created or refactored. " +
    "If signals are found, asks the human whether to run a design-thinking workshop before implementation analysis.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      if (!state.briefing.path) {
        return errorResponse("No briefing found. A briefing must be created and delivered first.")
      }

      const content = await fs.readFile(state.briefing.path, "utf-8")
      const detection = detectUserJourneys(content)

      const now = new Date().toISOString()
      state.journeyWorkshop = {
        ...state.journeyWorkshop,
        status: detection.hasUserJourneys ? "pending_human_decision" : "not_started",
        detectedAt: now,
        signals: detection.signals,
        suggestedJourneys: detection.suggestedJourneys,
        confidence: detection.confidence,
      }
      await saveState(context.directory, state, context.sessionID)

      if (!detection.hasUserJourneys) {
        return successResponse(
          "No User Journeys Detected",
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            "",
            "Scanning the briefing did not find strong signals that user journeys need to be created or refactored.",
            "",
            "Proceed with team assembly and implementation analysis as usual.",
          ].join("\n"),
          { confidence: detection.confidence, signals: detection.signals }
        )
      }

      const confidenceLabel = detection.confidence.toUpperCase()
      const signalList = detection.signals.map((s, i) => `  ${i + 1}. ${s}`).join("\n")
      const suggestedList = detection.suggestedJourneys.map((j, i) => `  ${i + 1}. ${j}`).join("\n")

      return successResponse(
        "User Journeys Detected — Human Decision Required",
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          "",
          `**Confidence:** ${confidenceLabel}`,
          "",
          "The briefing contains signals that user journeys should be defined or refactored before implementation analysis:",
          "",
          signalList,
          "",
          "**Suggested journeys to explore:**",
          "",
          suggestedList || "  (none extracted)",
          "",
          "**Ask the human:**",
          "",
          "This scope appears to involve user journeys. Would you like to run a design-thinking workshop first to define/refactor the journeys, before assembling the implementation team?",
          "",
          "[Y] Yes — run the journey workshop (call `configure_journey_workshop` with mode='guided' or mode='automatic').",
          "[N] No — skip the workshop and proceed directly to implementation analysis (call `configure_journey_workshop` with mode='skip').",
        ].join("\n"),
        { confidence: detection.confidence, signals: detection.signals, suggestedJourneys: detection.suggestedJourneys }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error detecting user journeys: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const configureJourneyWorkshopTool = tool({
  description:
    "Configures the user-journey design-thinking workshop after the human decides whether to run it. " +
    "Use mode='skip' to bypass the workshop, or 'guided'/'automatic' to configure it.",
  args: {
    mode: tool.schema
      .enum(["guided", "automatic", "skip"])
      .describe("Workshop mode: 'guided' asks human questions first, 'automatic' runs immediately, 'skip' bypasses it"),
    observations: tool.schema
      .string()
      .optional()
      .describe("Free-form observations from the human to tailor the workshop briefing"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      if (state.journeyWorkshop.status !== "pending_human_decision" &&
          state.journeyWorkshop.status !== "not_started" &&
          state.journeyWorkshop.status !== "needed") {
        return errorResponse(
          `Journey workshop is in state "${state.journeyWorkshop.status}" and cannot be reconfigured. ` +
          "Run detect_user_journeys first if you want to re-evaluate."
        )
      }

      if (args.mode === "skip") {
        state.journeyWorkshop.status = "skipped"
        state.journeyWorkshop.observations = args.observations
        await saveState(context.directory, state, context.sessionID)
        await logAction(context.directory, "journey_workshop_skipped", state.currentPhase, {
          confidence: state.journeyWorkshop.confidence,
        })

        return successResponse(
          "Journey Workshop Skipped",
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            "",
            "The user-journey workshop was skipped by human decision.",
            "",
            "Proceed with team assembly and implementation analysis as usual.",
          ].join("\n")
        )
      }

      state.journeyWorkshop.status = "needed"
      state.journeyWorkshop.mode = args.mode as JourneyWorkshopMode
      state.journeyWorkshop.observations = args.observations
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "journey_workshop_configured", state.currentPhase, {
        mode: args.mode,
        confidence: state.journeyWorkshop.confidence,
      })

      if (args.mode === "guided") {
        return successResponse(
          "Journey Workshop Configured — Guided Mode",
          [
            `${formatPhaseHeader(state.currentPhase)}`,
            "",
            "**Mode:** Guided",
            "",
            "Ask the human these tailoring questions before opening the workshop:",
            "",
            "1. Are there specific user personas we should prioritize?",
            "2. Are there journeys that are already well-defined and should NOT be redesigned?",
            "3. What is the primary pain point or opportunity driving the journey work?",
            "4. Should the workshop focus on creating new journeys, refactoring existing ones, or both?",
            "",
            "Record the answers in `observations` and then call `open_journey_workshop_round`.",
          ].join("\n")
        )
      }

      return successResponse(
        "Journey Workshop Configured — Automatic Mode",
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          "",
          "**Mode:** Automatic",
          "",
          "Call `open_journey_workshop_round` to start the design-thinking workshop immediately.",
        ].join("\n")
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error configuring journey workshop: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const openJourneyWorkshopRoundTool = tool({
  description:
    "Opens a structured design-thinking workshop round focused on defining/refactoring user journeys. " +
    "Produces a workshop briefing file and instructions for the Manager to run the round with design specialists.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      if (state.journeyWorkshop.status !== "needed" && state.journeyWorkshop.status !== "in_progress") {
        return errorResponse(
          `Journey workshop must be configured first (status is "${state.journeyWorkshop.status}"). ` +
          "Call detect_user_journeys, then configure_journey_workshop."
        )
      }

      if (!state.briefing.path) {
        return errorResponse("No briefing found. A briefing must be created and delivered first.")
      }

      const sessionId = getSessionId(context.directory, context.sessionID)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }

      const originalContent = await fs.readFile(state.briefing.path, "utf-8")
      const titleMatch = originalContent.match(/^#\s+(.+)$/m)
      const originalTitle = titleMatch?.[1] ?? state.briefing.slug ?? "Project"

      const workshopBriefing = buildJourneyWorkshopBriefing(originalTitle, originalContent, {
        signals: state.journeyWorkshop.signals,
        suggestedJourneys: state.journeyWorkshop.suggestedJourneys,
        confidence: state.journeyWorkshop.confidence,
        observations: state.journeyWorkshop.observations,
      })

      const workshopBriefingPath = join(
        context.directory,
        PLUGIN_STATE_DIR,
        "briefings",
        `journey-workshop-${sessionId}.md`
      )
      await fs.mkdir(join(workshopBriefingPath, ".."), { recursive: true })
      await fs.writeFile(workshopBriefingPath, workshopBriefing, "utf-8")

      state.journeyWorkshop.status = "in_progress"
      state.journeyWorkshop.briefingPath = workshopBriefingPath
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "journey_workshop_opened", state.currentPhase, {
        briefingPath: workshopBriefingPath,
      })

      const participantList = DESIGN_THINKING_PARTICIPANTS.map(
        (id, i) => `  ${i + 1}. **${id}** (subagent_type="mesa/${id}", task_id="mesa-${id}")`
      ).join("\n")

      const relativePath = workshopBriefingPath.replace(context.directory + "/", "")

      return successResponse(
        "Journey Workshop Round Ready",
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          "",
          `**Workshop briefing:** ${relativePath}`,
          "",
          "The workshop briefing has been generated. Now open a standard analysis round with the following design-thinking specialists:",
          "",
          participantList,
          "",
          "## Next step",
          "",
          `Call \`open_analysis_round\` with:\n- topic: "User Journey Design Thinking Workshop"\n- participants: ${JSON.stringify(DESIGN_THINKING_PARTICIPANTS)}\n- max_turns: 2\n- briefing_content: (read the full content of ${relativePath})`,
          "",
          "After the round reaches consensus, produce a journeys document and call `complete_journey_workshop` with its path.",
        ].join("\n"),
        { workshopBriefingPath, recommendedParticipants: DESIGN_THINKING_PARTICIPANTS }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error opening journey workshop round: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const completeJourneyWorkshopTool = tool({
  description:
    "Completes the user-journey design-thinking workshop. Appends the defined journeys to the original briefing, " +
    "updates the journey workshop status to completed, and returns instructions to proceed with implementation analysis.",
  args: {
    journeys_file_path: tool.schema
      .string()
      .describe("Workspace-relative path to the markdown file containing the defined user journeys"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const phaseError = requirePhase(state, "PLANNING", "DISCUSSION")
      if (phaseError) throw new PhaseError(phaseError)

      if (state.journeyWorkshop.status !== "in_progress" && state.journeyWorkshop.status !== "needed") {
        return errorResponse(
          `Cannot complete journey workshop from status "${state.journeyWorkshop.status}". ` +
          "Open the workshop round first with open_journey_workshop_round."
        )
      }

      if (!state.briefing.path) {
        return errorResponse("No briefing found.")
      }

      const journeysAbsPath = join(context.directory, args.journeys_file_path)
      const resolvedJourneysPath = await fs.realpath(journeysAbsPath).catch(() => null)
      if (!resolvedJourneysPath || !resolvedJourneysPath.startsWith(await fs.realpath(context.directory))) {
        return errorResponse("Invalid journeys_file_path: path must be inside the workspace.")
      }

      let journeysContent: string
      try {
        journeysContent = await fs.readFile(journeysAbsPath, "utf-8")
      } catch {
        return errorResponse(`Could not read journeys file: ${args.journeys_file_path}`)
      }

      if (!journeysContent.trim()) {
        return errorResponse("Journeys file is empty.")
      }

      // Append journeys to the original briefing
      const originalContent = await fs.readFile(state.briefing.path, "utf-8")
      const separator = [
        "",
        "---",
        "",
        "# User Journeys (defined in design-thinking workshop)",
        "",
      ].join("\n")
      const updatedBriefing = originalContent + separator + journeysContent
      await fs.writeFile(state.briefing.path, updatedBriefing, "utf-8")

      state.journeyWorkshop.status = "completed"
      state.journeyWorkshop.journeysFilePath = args.journeys_file_path
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "journey_workshop_completed", state.currentPhase, {
        journeysFilePath: args.journeys_file_path,
      })

      return successResponse(
        "Journey Workshop Completed",
        [
          `${formatPhaseHeader(state.currentPhase)}`,
          "",
          `Journeys appended to the original briefing: ${state.briefing.path}`,
          "",
          "The design-thinking workshop is complete. The original briefing now includes the defined user journeys.",
          "",
          "**Next steps:**",
          "1. If you are currently in DISCUSSION phase after the workshop round, call `analyze_briefing` again to see the enriched briefing.",
          "2. Propose an implementation team with `propose_team`.",
          "3. Continue the Mesa workflow normally (summon team, define phases, open analysis round for implementation).",
        ].join("\n"),
        { journeysFilePath: args.journeys_file_path, briefingPath: state.briefing.path }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error completing journey workshop: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
