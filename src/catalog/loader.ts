import { promises as fs } from "node:fs"
import { join, basename } from "node:path"
import type { Persona, CatalogSummary } from "./types.js"

export type { Persona, CatalogSummary }

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { data: {}, body: raw }
  }

  const frontmatterStr = match[1]
  const body = match[2].trim()

  const data: Record<string, unknown> = {}
  for (const line of frontmatterStr.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value: string = line.slice(colonIdx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    if (key === "tools" && typeof value === "string" && value.includes(",")) {
      data[key] = value.split(",").map((t) => t.trim())
    } else {
      data[key] = value
    }
  }

  return { data, body }
}

function filenameToId(filename: string): string {
  return basename(filename, ".md")
}

export function parsePersonaFile(
  raw: string,
  filename: string,
  division: string,
  source: "embedded" | "custom" = "embedded"
): Persona {
  const { data, body } = parseFrontmatter(raw)

  return {
    id: filenameToId(filename),
    source,
    division,
    name: String(data.name ?? filenameToId(filename)),
    description: String(data.description ?? ""),
    emoji: String(data.emoji ?? ""),
    color: String(data.color ?? ""),
    vibe: String(data.vibe ?? ""),
    tools: Array.isArray(data.tools) ? (data.tools as string[]) : [],
    systemPrompt: body,
  }
}

export async function loadCatalogFromDirectory(
  catalogRoot: string
): Promise<{ personas: Persona[]; summary: CatalogSummary }> {
  const personas: Persona[] = []
  const divisions: string[] = []

  const entries = await fs.readdir(catalogRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith(".")) continue

    const divisionDir = join(catalogRoot, entry.name)
    const divisionFiles = await fs.readdir(divisionDir)
    const mdFiles = divisionFiles.filter((f) => f.endsWith(".md"))

    for (const mdFile of mdFiles) {
      const filePath = join(divisionDir, mdFile)
      try {
        const raw = await fs.readFile(filePath, "utf-8")
        const persona = parsePersonaFile(raw, mdFile, entry.name, "embedded")
        personas.push(persona)
      } catch {
        // skip unreadable files
      }
    }

    if (mdFiles.length > 0) {
      divisions.push(entry.name)
    }
  }

  const personasPerDivision: Record<string, number> = {}
  for (const p of personas) {
    personasPerDivision[p.division] = (personasPerDivision[p.division] ?? 0) + 1
  }

  return {
    personas,
    summary: {
      totalPersonas: personas.length,
      divisions,
      personasPerDivision,
    },
  }
}
