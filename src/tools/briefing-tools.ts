import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState } from "../state"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { PLUGIN_STATE_DIR } from "../config"

export const criarBriefingTool = tool({
  description:
    "Creates and saves a new briefing document in the workspace. The briefing is stored in the mesa-de-discussao directory.",
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
      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR, "briefings")
      await fs.mkdir(briefingsDir, { recursive: true })

      const filePath = join(briefingsDir, `briefing-${args.slug}.md`)
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

export const aprovarBriefingTool = tool({
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
      content = content.replace("status: draft", "status: approved")
      await fs.writeFile(filePath, content, "utf-8")

      await saveState(context.directory, state)

      return {
        title: "Briefing Approved",
        output: `Briefing "${state.briefing.slug}" approved. Ready for delivery to Gestor.`,
      }
    } catch (err) {
      return `Error approving briefing: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const entregarBriefingTool = tool({
  description:
    "Delivers the approved briefing to the Gestor. Updates the state phase to PLANNING and copies the briefing content.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)
      if (state.briefing.status !== "approved") {
        return "Error: Briefing must be approved before delivery. Use aprovar_briefing first."
      }
      if (!state.briefing.path) {
        return "Error: No briefing path found."
      }

      const briefingsDir = join(context.directory, PLUGIN_STATE_DIR)
      const deliveryPath = join(briefingsDir, "briefing-atual.md")
      const content = await fs.readFile(state.briefing.path, "utf-8")
      await fs.writeFile(deliveryPath, content, "utf-8")

      state.currentPhase = "PLANNING"
      await saveState(context.directory, state)

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
