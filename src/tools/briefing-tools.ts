import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState } from "../state"
import { join, resolve } from "node:path"
import { promises as fs } from "node:fs"
import { PLUGIN_STATE_DIR } from "../config"
import { logAction } from "../audit"

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
      const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
      if (!VALID_SLUG.test(args.slug)) {
        return "Error: Invalid slug. Use lowercase letters, numbers, and hyphens only."
      }

      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR, "briefings")
      await fs.mkdir(briefingsDir, { recursive: true })

      const filePath = join(briefingsDir, `briefing-${args.slug}.md`)
      if (!resolve(filePath).startsWith(resolve(briefingsDir))) {
        return "Error: Invalid slug — path traversal detected."
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

      const state = await loadState(context.directory)
      state.briefing.path = filePath
      state.briefing.slug = args.slug
      state.briefing.status = "draft"
      await saveState(context.directory, state)

      return {
        title: "Briefing Created",
        output: `Briefing saved to ${filePath}`,
        metadata: { slug: args.slug, path: filePath },
      }
    } catch (err) {
      return `Error creating briefing: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const approveBriefingTool = tool({
  description:
    "Marks the current briefing as approved and updates the state. Must be called after human approval.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)
      if (!state.briefing.path) {
        return "Error: No briefing found. Create a briefing first."
      }

      state.briefing.status = "approved"

      const filePath = state.briefing.path
      let content = await fs.readFile(filePath, "utf-8")
      const updated = content.replace(/status:\s*['"]?draft['"]?/g, "status: approved")
      if (updated === content) {
        return "Error: Briefing file does not contain 'status: draft'. It may have already been approved or the frontmatter is malformed."
      }
      content = updated
      await fs.writeFile(filePath, content, "utf-8")

      await saveState(context.directory, state)
      await logAction(context.directory, "briefing_approved", state.currentPhase, { slug: state.briefing.slug })

      return {
        title: "Briefing Approved",
        output: `Briefing "${state.briefing.slug}" approved. Ready for delivery to Gestor.`,
      }
    } catch (err) {
      return `Error approving briefing: ${err instanceof Error ? err.message : String(err)}`
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
      const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
      if (!VALID_SLUG.test(args.slug)) {
        return "Error: Invalid slug. Use lowercase letters, numbers, and hyphens only."
      }

      try {
        await fs.access(args.file_path)
      } catch {
        return `Error: File not found: ${args.file_path}`
      }

      const content = await fs.readFile(args.file_path, "utf-8")
      if (!content.trim()) {
        return "Error: Briefing file is empty."
      }

      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR, "briefings")
      await fs.mkdir(briefingsDir, { recursive: true })

      const destPath = join(briefingsDir, `briefing-${args.slug}.md`)

      if (!destPath.startsWith(briefingsDir)) {
        return "Error: Invalid path detected."
      }

      try {
        await fs.access(destPath)
        return `Error: Briefing with slug "${args.slug}" already exists. Use a different slug or delete the existing one.`
      } catch {
        // File doesn't exist, proceed
      }

      await fs.copyFile(args.file_path, destPath)

      const state = await loadState(context.directory)

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
        status: "pending",
      }
      state.previousPhase = null

      await saveState(context.directory, state)

      return {
        title: "Briefing Imported",
        output: `Existing briefing imported from ${args.file_path}.\n\nSlug: ${args.slug}\nStatus: approved (pre-approved)\nPhase: PLANNING\n\nThe workflow has been reset. The Gestor can now analyze the briefing and propose a team.`,
      }
    } catch (err) {
      return `Error importing briefing: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const deliverBriefingTool = tool({
  description:
    "Delivers the approved briefing to the Gestor. Updates the state phase to PLANNING and copies the briefing content.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)
      if (state.briefing.status !== "approved") {
        return "Error: Briefing must be approved before delivery. Use approve_briefing first."
      }
      if (!state.briefing.path) {
        return "Error: No briefing path found."
      }

      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR)
      const deliveryPath = join(briefingsDir, "briefing-atual.md")
      const content = await fs.readFile(state.briefing.path, "utf-8")
      await fs.writeFile(deliveryPath, content, "utf-8")

      state.currentPhase = "PLANNING"
      state.briefing.status = "delivered"
      await saveState(context.directory, state)
      await logAction(context.directory, "briefing_delivered", state.currentPhase, { slug: state.briefing.slug })

      return {
        title: "Briefing Delivered to Gestor",
        output: `Briefing delivered to ${deliveryPath}. The Gestor should now analyze it and propose a team.`,
        metadata: { deliveryPath },
      }
    } catch (err) {
      return `Error delivering briefing: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
