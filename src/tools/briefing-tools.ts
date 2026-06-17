import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState, getSessionId } from "../state"
import { join, resolve } from "node:path"
import { promises as fs } from "node:fs"
import { PLUGIN_STATE_DIR } from "../config"
import { logAction } from "../audit"
import { formatPhaseHeader } from "../workflow/transitions"
import { isValidSlug } from "../utils/slug"
import { successResponse, errorResponse } from "../utils/responses"
import { ValidationError } from "../errors"

export const createBriefingTool = tool({
  description:
    "Creates and saves a new briefing document in the workspace. The briefing is stored in the .mesa directory.",
  args: {
    slug: tool.schema
      .string()
      .describe(
        "URL-friendly identifier for the briefing (e.g. 'ecommerce-platform'). NEVER use generic names."
      ),
    title: tool.schema.string().describe("The briefing title"),
    content: tool.schema.string().describe("The full briefing content in Markdown"),
  },
  async execute(args, context) {
    try {
      if (!isValidSlug(args.slug)) {
        throw new ValidationError("Invalid slug. Use lowercase letters, numbers, and hyphens only.")
      }

      if (!args.content || !args.content.trim()) {
        throw new ValidationError("Briefing content cannot be empty.")
      }

      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR, "briefings")
      await fs.mkdir(briefingsDir, { recursive: true })

      const filePath = join(briefingsDir, `briefing-${args.slug}.md`)
      if (!resolve(filePath).startsWith(resolve(briefingsDir))) {
        throw new ValidationError("Invalid slug — path traversal detected.")
      }
      const now = new Date().toISOString()

      const frontmatter = [
        "---",
        `title: "${args.title.replace(/"/g, '\\"')}"`,
        `slug: "${args.slug}"`,
        `date: "${now}"`,
        "status: draft",
        "---",
        "",
      ].join("\n")

      await fs.writeFile(filePath, frontmatter + args.content, "utf-8")

      const state = await loadState(context.directory, context.sessionID)
      state.briefing.path = filePath
      state.briefing.slug = args.slug
      state.briefing.status = "draft"
      await saveState(context.directory, state, context.sessionID)

      return successResponse(
        "Briefing Created",
        `${formatPhaseHeader(state.currentPhase)}\n\nBriefing saved to ${filePath}`,
        { slug: args.slug, path: filePath }
      )
    } catch (err) {
      return errorResponse(`Error creating briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const approveBriefingTool = tool({
  description:
    "Marks the current briefing as approved and updates the state. Must be called after human approval.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      if (!state.briefing.path) {
        return errorResponse("No briefing found. Create a briefing first.")
      }

      state.briefing.status = "approved"

      const filePath = state.briefing.path
      let content = await fs.readFile(filePath, "utf-8")
      const updated = content.replace(/status:\s*['"]?draft['"]?/g, "status: approved")
      if (updated === content) {
        return errorResponse("Briefing file does not contain 'status: draft'. It may have already been approved or the frontmatter is malformed.")
      }
      content = updated
      await fs.writeFile(filePath, content, "utf-8")

      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "briefing_approved", state.currentPhase, { slug: state.briefing.slug })

      return successResponse(
        "Briefing Approved",
        `${formatPhaseHeader(state.currentPhase)}\n\nBriefing "${state.briefing.slug}" approved. Ready for delivery to Manager.`
      )
    } catch (err) {
      return errorResponse(`Error approving briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const importBriefingTool = tool({
  description:
    "Imports an existing briefing file into the Mesa workflow. Use when the user provides a briefing directly instead of going through the briefing-writer. Treats the file as pre-approved and sets phase to PLANNING. Can be called from any phase to restart with a new briefing.",
  args: {
    file_path: tool.schema.string().describe("Absolute path to the existing briefing file"),
    slug: tool.schema.string().describe("URL-friendly identifier for the briefing (lowercase, numbers, hyphens only)"),
    title: tool.schema.string().optional().describe("Title for the briefing (defaults to filename)"),
  },
  async execute(args, context) {
    try {
      if (!isValidSlug(args.slug)) {
        throw new ValidationError("Invalid slug. Use lowercase letters, numbers, and hyphens only.")
      }

      try {
        await fs.access(args.file_path)
      } catch {
        return errorResponse(`File not found: ${args.file_path}`)
      }

      const content = await fs.readFile(args.file_path, "utf-8")
      if (!content.trim()) {
        return errorResponse("Briefing file is empty.")
      }

      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR, "briefings")
      await fs.mkdir(briefingsDir, { recursive: true })

      const destPath = join(briefingsDir, `briefing-${args.slug}.md`)

      if (!destPath.startsWith(briefingsDir)) {
        return errorResponse("Invalid path detected.")
      }

      try {
        await fs.access(destPath)
        return errorResponse(`Briefing with slug "${args.slug}" already exists. Use a different slug or delete the existing one.`)
      } catch {
        // File doesn't exist, proceed
      }

      await fs.copyFile(args.file_path, destPath)

      const state = await loadState(context.directory, context.sessionID)

      state.briefing = {
        path: destPath,
        status: "approved",
        slug: args.slug,
      }

      state.currentPhase = "PLANNING"
      state.team = []
      state.discussion = {
        ...state.discussion,
        analyses: [],
        votes: [],
        currentTurn: 0,
        consensusRound: 0,
      }
      state.specification = {
        path: null,
        overviewPath: null,
        status: "pending",
      }
      state.previousPhase = null

      await saveState(context.directory, state, context.sessionID)

      return successResponse(
        "Briefing Imported",
        `${formatPhaseHeader(state.currentPhase)}\n\nExisting briefing imported from ${args.file_path}.\n\nSlug: ${args.slug}\nStatus: approved (pre-approved)\nPhase: PLANNING\n\nThe workflow has been reset. The Manager can now analyze the briefing and propose a team.`
      )
    } catch (err) {
      return errorResponse(`Error importing briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const deliverBriefingTool = tool({
  description:
    "Delivers the approved briefing to the Manager. Updates the state phase to PLANNING and copies the briefing content.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      if (state.briefing.status !== "approved") {
        return errorResponse("Briefing must be approved before delivery. Use approve_briefing first.")
      }
      if (!state.briefing.path) {
        return errorResponse("No briefing path found.")
      }

      const sessionId = getSessionId(context.directory, context.sessionID)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }
      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR)
      const deliveryPath = join(briefingsDir, `briefing-current-${sessionId}.md`)
      const content = await fs.readFile(state.briefing.path, "utf-8")
      await fs.writeFile(deliveryPath, content, "utf-8")

      state.currentPhase = "PLANNING"
      state.briefing.status = "delivered"
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "briefing_delivered", state.currentPhase, { slug: state.briefing.slug })

      return successResponse(
        "Briefing Delivered to Manager",
        `${formatPhaseHeader(state.currentPhase)}\n\nBriefing delivered to ${deliveryPath}. To continue, switch to the Manager agent by typing \`/agent manager\` and ask it to analyze the briefing and propose a team.`,
        { deliveryPath }
      )
    } catch (err) {
      return errorResponse(`Error delivering briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
