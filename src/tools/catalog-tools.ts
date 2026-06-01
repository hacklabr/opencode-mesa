import { tool } from "@opencode-ai/plugin/tool"
import { loadCatalogFromDirectory, type Persona, type CatalogSummary } from "../catalog/loader"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { formatPhaseHeader } from "../workflow/transitions"
import { successResponse, errorResponse } from "../utils/responses"

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CATALOG_DIR = join(PLUGIN_ROOT, "catalog", "agency-agents")

let cachedPersonas: Persona[] | null = null
let cachedSummary: CatalogSummary | null = null

async function loadCatalog() {
  if (cachedPersonas && cachedSummary) return { personas: cachedPersonas, summary: cachedSummary }
  const result = await loadCatalogFromDirectory(CATALOG_DIR)
  cachedPersonas = result.personas
  cachedSummary = result.summary
  return result
}

export const listSpecialistsTool = tool({
  description:
    "Lists available specialist personas from the agency-agents catalog. Optionally filter by division or search term.",
  args: {
    division: tool.schema
      .string()
      .optional()
      .describe("Filter by division name (e.g. 'engineering', 'product', 'design')"),
    search: tool.schema
      .string()
      .optional()
      .describe("Search term to filter by name or description"),
    page: tool.schema
      .number()
      .optional()
      .describe("Page number (1-based, default: 1)"),
    page_size: tool.schema
      .number()
      .optional()
      .describe("Page size (default: 20, max: 100)"),
  },
  async execute(args) {
    try {
      const { personas, summary } = await loadCatalog()

      let filtered = personas
      if (args.division) {
        const div = args.division.toLowerCase()
        filtered = filtered.filter((p) => p.division.toLowerCase().includes(div))
      }
      if (args.search) {
        const term = args.search.toLowerCase()
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(term) ||
            p.description.toLowerCase().includes(term) ||
            p.id.toLowerCase().includes(term)
        )
      }

      const pageSize = Math.min(Math.max(args.page_size ?? 20, 1), 100)
      const page = Math.max(args.page ?? 1, 1)
      const total = filtered.length
      const start = (page - 1) * pageSize
      const end = Math.min(start + pageSize, total)
      const pageItems = filtered.slice(start, end)

      const divisionLabel = args.division ? `'${args.division}'` : "all"
      const header = `Showing ${total > 0 ? start + 1 : 0}-${end} of ${total} specialists in division ${divisionLabel}`

      const tableRows = pageItems.map((p) =>
        `| ${p.emoji || "—"} | ${p.name} | \`${p.id}\` | ${p.division} |`
      )

      const table = [
        `| Emoji | Name | ID | Division |`,
        `|-------|------|----|----------|`,
        ...tableRows,
      ].join("\n")

      const output = [
        formatPhaseHeader("catalog"),
        ``,
        header,
        ``,
        table,
      ].join("\n")

      return successResponse("Available Specialists", output, {
        total,
        page,
        pageSize,
        divisionFilter: args.division ?? null,
      })
    } catch (err) {
      return errorResponse(`Error loading catalog: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const getSpecialistTool = tool({
  description:
    "Returns the full details and system prompt of a specific specialist persona by its ID.",
  args: {
    id: tool.schema.string().describe("The persona ID (e.g. 'engineering-backend-architect')"),
  },
  async execute(args) {
    try {
      const { personas } = await loadCatalog()
      const persona = personas.find((p) => p.id === args.id)
      if (!persona) {
        return errorResponse(
          `Specialist not found: ${args.id}\n\nUse list_specialists to browse available specialists.`
        )
      }

      return successResponse(
        `Specialist: ${persona.name}`,
        `${formatPhaseHeader("catalog")}\n\n${JSON.stringify(persona, null, 2)}`
      )
    } catch (err) {
      return errorResponse(`Error loading specialist: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export async function getPersonaById(personaId: string): Promise<Persona | null> {
  const { personas } = await loadCatalog()
  return personas.find((p) => p.id === personaId) ?? null
}

export function clearCatalogCache(): void {
  cachedPersonas = null
  cachedSummary = null
}
