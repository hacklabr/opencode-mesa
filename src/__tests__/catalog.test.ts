import { describe, expect, test } from "vitest"
import { parsePersonaFile, loadCatalogFromDirectory } from "../catalog/loader"
import { promises as fs } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "catalog", "agency-agents")

describe("catalog parser", () => {
  test("parses a persona file with full frontmatter", () => {
    const raw = `---
name: Backend Architect
description: Senior backend architect specializing in scalable system design
color: blue
emoji: 🏗️
vibe: Designs the systems that hold everything up
tools: WebFetch, Read, Write
---

# Backend Architect Agent

You are a senior backend architect.`

    const persona = parsePersonaFile(raw, "engineering-backend-architect.md", "engineering")
    expect(persona.id).toBe("engineering-backend-architect")
    expect(persona.name).toBe("Backend Architect")
    expect(persona.description).toBe("Senior backend architect specializing in scalable system design")
    expect(persona.color).toBe("blue")
    expect(persona.emoji).toBe("🏗️")
    expect(persona.vibe).toBe("Designs the systems that hold everything up")
    expect(persona.tools).toEqual(["WebFetch", "Read", "Write"])
    expect(persona.systemPrompt).toContain("senior backend architect")
  })

  test("parses a persona file without optional fields", () => {
    const raw = `---
name: Minimal Agent
description: A minimal test agent
---

# Minimal

System prompt body here.`

    const persona = parsePersonaFile(raw, "test-minimal.md", "testing")
    expect(persona.id).toBe("test-minimal")
    expect(persona.name).toBe("Minimal Agent")
    expect(persona.emoji).toBe("")
    expect(persona.tools).toEqual([])
    expect(persona.systemPrompt).toContain("System prompt body")
  })

  test("handles file without frontmatter gracefully", () => {
    const raw = `# No Frontmatter

Just plain content here.`

    const persona = parsePersonaFile(raw, "no-frontmatter.md", "test")
    expect(persona.id).toBe("no-frontmatter")
    expect(persona.name).toBe("no-frontmatter")
    expect(persona.systemPrompt).toContain("Just plain content")
  })
})

describe("catalog loader", () => {
  test("loads all personas from embedded catalog", async () => {
    const { personas, summary } = await loadCatalogFromDirectory(CATALOG_DIR)
    expect(personas.length).toBeGreaterThan(0)
    expect(summary.totalPersonas).toBe(personas.length)
    expect(summary.divisions.length).toBeGreaterThan(0)
  })

  test("each persona has required fields", async () => {
    const { personas } = await loadCatalogFromDirectory(CATALOG_DIR)
    for (const p of personas) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.division).toBeTruthy()
      expect(p.systemPrompt.length).toBeGreaterThan(10)
    }
  })

  test("personas are grouped by division", async () => {
    const { summary } = await loadCatalogFromDirectory(CATALOG_DIR)
    const totalFromDivisions = Object.values(summary.personasPerDivision).reduce(
      (sum, count) => sum + count,
      0
    )
    expect(totalFromDivisions).toBe(summary.totalPersonas)
  })

  test("engineering division has multiple personas", async () => {
    const { personas } = await loadCatalogFromDirectory(CATALOG_DIR)
    const engineers = personas.filter((p) => p.division === "engineering")
    expect(engineers.length).toBeGreaterThan(10)
  })
})
