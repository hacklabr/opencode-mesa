import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)

const SCRIPT_PATH = fileURLToPath(new URL("../setup/generate-agents.js", import.meta.url))

describe("generate-agents script", () => {
  let tempBase: string

  beforeEach(async () => {
    tempBase = join(tmpdir(), `mesa-generate-agents-${Date.now()}`)
    await fs.mkdir(tempBase, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tempBase, { recursive: true, force: true })
  })

  test("generates a single clean specialist subagent with empty body", async () => {
    const outputDir = join(tempBase, "agents")

    await execFileAsync("node", [SCRIPT_PATH, outputDir])

    const generatedPath = join(outputDir, "mesa", "specialist.md")
    const generated = await fs.readFile(generatedPath, "utf-8")

    expect(generated).toContain("mode: subagent")
    expect(generated).toContain("hidden: true")
    expect(generated).toContain("task: deny")

    // Body must be empty — the persona prompt is injected by the plugin
    // at delegation time, not baked into the file.
    const body = generated.split(/^---$/m)[2]
    expect(body.trim()).toBe("")

    // No per-persona files are generated
    const mesaDir = await fs.readdir(join(outputDir, "mesa"))
    expect(mesaDir).toEqual(["specialist.md"])
  })

  test("removes stale per-persona subagent files on regeneration", async () => {
    const outputDir = join(tempBase, "agents")
    const mesaDir = join(outputDir, "mesa")
    await fs.mkdir(mesaDir, { recursive: true })
    await fs.writeFile(join(mesaDir, "engineering-backend-architect.md"), "stale", "utf-8")

    await execFileAsync("node", [SCRIPT_PATH, outputDir])

    const remaining = await fs.readdir(mesaDir)
    expect(remaining).toEqual(["specialist.md"])
  })

  test("generates primary agents from src/agents", async () => {
    const outputDir = join(tempBase, "agents")

    await execFileAsync("node", [SCRIPT_PATH, outputDir])

    const managerPath = join(outputDir, "manager.md")
    const briefingWriterPath = join(outputDir, "briefing-writer.md")

    expect(await fs.readFile(managerPath, "utf-8")).toContain("Manager")
    expect(await fs.readFile(briefingWriterPath, "utf-8")).toContain("Briefing Writer")
  })
})
