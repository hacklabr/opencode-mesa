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

  test("appends global instructions to generated subagents", async () => {
    const outputDir = join(tempBase, "agents")
    const catalogDir = join(tempBase, "catalog")
    const globalFile = join(tempBase, "global.md")

    await fs.mkdir(join(catalogDir, "engineering"), { recursive: true })
    await fs.writeFile(
      join(catalogDir, "engineering", "test-engineer.md"),
      `---
name: Test Engineer
description: A test engineer
emoji: 🧪
---

# Test Engineer

You are a test engineer.`,
      "utf-8"
    )

    await fs.writeFile(globalFile, "Global parallel execution rule.", "utf-8")

    await execFileAsync("node", [SCRIPT_PATH, outputDir, catalogDir, globalFile])

    const generatedPath = join(outputDir, "mesa", "test-engineer.md")
    const generated = await fs.readFile(generatedPath, "utf-8")

    expect(generated).toContain("mode: subagent")
    expect(generated).toContain("You are a test engineer.")
    expect(generated).toContain("Global parallel execution rule.")
  })

  test("generates primary agents from src/agents", async () => {
    const outputDir = join(tempBase, "agents")
    const catalogDir = join(tempBase, "catalog")
    const globalFile = join(tempBase, "global.md")

    await fs.mkdir(join(catalogDir, "engineering"), { recursive: true })
    await fs.writeFile(
      join(catalogDir, "engineering", "test-engineer.md"),
      `---
name: Test Engineer
description: A test engineer
---

Body.`,
      "utf-8"
    )
    await fs.writeFile(globalFile, "", "utf-8")

    await execFileAsync("node", [SCRIPT_PATH, outputDir, catalogDir, globalFile])

    const managerPath = join(outputDir, "manager.md")
    const briefingWriterPath = join(outputDir, "briefing-writer.md")

    expect(await fs.readFile(managerPath, "utf-8")).toContain("Manager")
    expect(await fs.readFile(briefingWriterPath, "utf-8")).toContain("Briefing Writer")
  })
})
