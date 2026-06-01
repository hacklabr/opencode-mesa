import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises"
import { join, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CATALOG_DIR = join(ROOT, "src", "catalog", "agency-agents")
const DEFAULT_outputDir = join(ROOT, ".opencode", "agents")
const PRIMARY_outputDir = join(ROOT, "src", "agents")
const outputDir = process.argv[2] || DEFAULT_outputDir

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { data: {}, body: raw }
  const data = {}
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (key === "tools" && typeof value === "string" && value.includes(",")) {
      data[key] = value.split(",").map((t) => t.trim())
    } else {
      data[key] = value
    }
  }
  return { data, body: match[2].trim() }
}

function sanitizeId(filename) {
  return basename(filename, ".md")
}

async function loadCatalogPersonas() {
  const personas = []
  const entries = await readdir(CATALOG_DIR, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    if (["examples", "scripts"].includes(entry.name)) continue
    const divisionDir = join(CATALOG_DIR, entry.name)
    const files = await readdir(divisionDir)
    for (const file of files.filter((f) => f.endsWith(".md"))) {
      const raw = await readFile(join(divisionDir, file), "utf-8")
      const { data, body } = parseFrontmatter(raw)
      if (!data.description) continue
      personas.push({
        id: sanitizeId(file),
        name: data.name || sanitizeId(file),
        description: data.description,
        division: entry.name,
        emoji: data.emoji || "",
        systemPrompt: body,
      })
    }
  }
  return personas
}

async function writePrimaryAgents() {
  const agents = [
    {
      filename: "briefing-writer.md",
      name: "Briefing Writer",
      description:
        "Briefing Writer - Conducts structured discovery sessions to produce professional briefings",
      mode: "primary",
      sourceFile: join(PRIMARY_outputDir, "briefing-writer.md"),
    },
    {
      filename: "gestor.md",
      name: "Gestor",
      description:
        "Gestor - Orchestrates specialist teams for structured discussion and specification",
      mode: "primary",
      sourceFile: join(PRIMARY_outputDir, "gestor.md"),
    },
  ]

  const generated = []
  for (const agent of agents) {
    const promptBody = await readFile(agent.sourceFile, "utf-8")
    const content = [
      "---",
      `description: ${agent.description}`,
      `mode: ${agent.mode}`,
      "---",
      "",
      promptBody.trim(),
      "",
    ].join("\n")

    const outPath = join(outputDir, agent.filename)
    await writeFile(outPath, content, "utf-8")
    generated.push(agent.name)
  }
  return generated
}

async function writeSubagents(personas) {
  const subagentsDir = join(outputDir, "mesa")
  await mkdir(subagentsDir, { recursive: true })

  const generated = []
  for (const persona of personas) {
    const description = persona.emoji
      ? `${persona.emoji} ${persona.description}`
      : persona.description

    const frontmatter = [
      "---",
      `description: ${description}`,
      "mode: subagent",
      "hidden: true",
      "permission:",
      "  edit: allow",
      "  write: allow",
      "  bash: allow",
      "  task:",
      '    "*": deny',
      "---",
      "",
    ].join("\n")

    const body =
      persona.systemPrompt || `You are ${persona.name}. ${persona.description}`

    const content = frontmatter + body + "\n"
    const outPath = join(subagentsDir, `${persona.id}.md`)
    await writeFile(outPath, content, "utf-8")
    generated.push(persona.id)
  }
  return generated
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  const primaries = await writePrimaryAgents()
  console.log(`Primary agents: ${primaries.join(", ")}`)

  const personas = await loadCatalogPersonas()
  const subagents = await writeSubagents(personas)
  console.log(`Subagents generated: ${subagents.length} in mesa/ (hidden, mode: subagent)`)

  console.log(`\nOutput: ${outputDir}`)
  console.log("Restart opencode to load the new agents.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
