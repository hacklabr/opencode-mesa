import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DEFAULT_outputDir = join(ROOT, ".opencode", "agents")
const PRIMARY_outputDir = join(ROOT, "src", "agents")

const outputDir = process.argv[2] || DEFAULT_outputDir

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
      filename: "manager.md",
      name: "Manager",
      description:
        "Manager - Orchestrates specialist teams for structured discussion and specification",
      mode: "primary",
      sourceFile: join(PRIMARY_outputDir, "manager.md"),
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

async function writeSpecialistSubagent() {
  const subagentsDir = join(outputDir, "mesa")
  await rm(subagentsDir, { recursive: true, force: true })
  await mkdir(subagentsDir, { recursive: true })

  // Single clean subagent. The persona system prompt is NOT baked here —
  // the plugin injects it into the delegation prompt at runtime via the
  // tool.execute.before hook (V1 `task` / V2 `subagent`), keyed by the
  // resume id ("mesa-{personaId}" or an inline <specialist-persona> block).
  //
  // Frontmatter carries BOTH permission formats so the same file works on
  // OpenCode V1 (map form `permission`) and V2 (ruleset list `permissions`;
  // bash -> shell, task -> subagent).
  const content = [
    "---",
    "description: Mesa specialist - clean subagent that receives the specialist persona prompt injected by the opencode-mesa plugin at delegation time",
    "mode: subagent",
    "hidden: true",
    "permission:",
    "  edit: allow",
    "  write: allow",
    "  bash: allow",
    "  task: deny",
    "permissions:",
    "  - action: edit",
    "    resource: \"*\"",
    "    effect: allow",
    "  - action: shell",
    "    resource: \"*\"",
    "    effect: allow",
    "  - action: subagent",
    "    resource: \"*\"",
    "    effect: deny",
    "---",
    "",
    "",
  ].join("\n")

  await writeFile(join(subagentsDir, "specialist.md"), content, "utf-8")
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  const primaries = await writePrimaryAgents()
  console.log(`Primary agents: ${primaries.join(", ")}`)

  await writeSpecialistSubagent()
  console.log("Subagent generated: mesa/specialist (hidden, mode: subagent, empty body)")

  console.log(`\nOutput: ${outputDir}`)
  console.log("Restart opencode to load the new agents.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
