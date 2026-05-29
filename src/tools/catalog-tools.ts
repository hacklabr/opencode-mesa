import { tool } from "@opencode-ai/plugin/tool"
import { loadCatalogFromDirectory, type Persona, type CatalogSummary } from "../catalog/loader"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

let cachedPersonas: Persona[] | null = null
let cachedSummary: CatalogSummary | null = null

async function getCatalogDir(): Promise<string> {
  return join(dirname(fileURLToPath(import.meta.url)), "catalog", "agency-agents")
}

async function loadCatalog() {
  if (cachedPersonas) return { personas: cachedPersonas, summary: cachedSummary! }
  const catalogDir = await getCatalogDir()
  const result = await loadCatalogFromDirectory(catalogDir)
  cachedPersonas = result.personas
  cachedSummary = result.summary
  return result
}

export const listarEspecialistasTool = tool({
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

      return {
        title: "Available Specialists",
        output: JSON.stringify(
          {
            totalAvailable: filtered.length,
            divisions: args.division
              ? [args.division]
              : summary.divisions,
            personas: filtered.map((p) => ({
              id: p.id,
              name: p.name,
              division: p.division,
              emoji: p.emoji,
              description: p.description.slice(0, 200),
            })),
          },
          null,
          2
        ),
      }
    } catch (err) {
      return `Error loading catalog: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const obterEspecialistaTool = tool({
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
        return `Specialist not found: ${args.id}`
      }

      return {
        title: `Specialist: ${persona.name}`,
        output: JSON.stringify(persona, null, 2),
      }
    } catch (err) {
      return `Error loading specialist: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export function clearCatalogCache(): void {
  cachedPersonas = null
  cachedSummary = null
}
