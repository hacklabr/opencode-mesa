// Characterization tests for the installer deployment logic.
//
// install.sh is shell and cannot run under vitest, so its decision logic is
// mirrored here as pure helpers (parseOcMajor, resolveStrategy, isNodeVersionAtLeast)
// and compared against the reference behavior. The portable parts of the
// strategy (src/setup/add-plugin.cjs, src/setup/remove-plugin.cjs) are exercised
// for real as child processes against temp config files.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"

const SETUP_DIR = join(import.meta.dirname, "..", "setup")
const NODE_BIN = process.execPath

function runSetup(script: string, ...args: string[]): void {
  execFileSync(NODE_BIN, [join(SETUP_DIR, script), ...args])
}

// --- Pure helpers mirroring install.sh logic (lines 92-97, 62-68) ---

// Equivalent of: OC_MAJOR="$(printf '%s' "$OC_VERSION" | grep -oE '[0-9]+' | head -1 || true)"
export function parseOcMajor(version: string | null | undefined): number | null {
  if (!version) return null
  const match = version.match(/\d+/)
  return match ? Number(match[0]) : null
}

// Equivalent of the OC_V2 branch: major >= 2 → V2; known 1.x → V1; absent → both.
export type Strategy = "v2" | "v1" | "both"

export function resolveStrategy(version: string | null | undefined): Strategy {
  const major = parseOcMajor(version)
  if (major === null) return "both"
  return major >= 2 ? "v2" : "v1"
}

// Equivalent of the sort -V comparison against 22.5.
export function isNodeVersionAtLeast(version: string, minimum: string): boolean {
  const parse = (v: string) => v.split(".").map((p) => Number(p) || 0)
  const [majA, minA] = parse(version)
  const [majB, minB] = parse(minimum)
  if (majA !== majB) return majA > majB
  return minA >= minB
}

// --- Fixtures ---

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mesa-installer-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function configPath(name: string): string {
  return join(tmpDir, name)
}

async function readConfig(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(configPath(name), "utf-8"))
}

describe("installer: OpenCode version parsing (install.sh decision matrix)", () => {
  it("parses major from plain and prefixed versions", () => {
    expect(parseOcMajor("2.1.0")).toBe(2)
    expect(parseOcMajor("v1.4.2")).toBe(1)
    expect(parseOcMajor("opencode 10.0.1")).toBe(10)
  })

  it("returns null when the version is absent or has no digits", () => {
    expect(parseOcMajor(undefined)).toBeNull()
    expect(parseOcMajor("")).toBeNull()
    expect(parseOcMajor("unknown")).toBeNull()
  })

  it("OC major >= 2 resolves to the V2 strategy", () => {
    expect(resolveStrategy("2.0.0")).toBe("v2")
    expect(resolveStrategy("3.1.4")).toBe("v2")
  })

  it("OC major < 2 resolves to the V1 strategy", () => {
    expect(resolveStrategy("1.9.9")).toBe("v1")
  })

  it("undetectable version deploys both mechanisms", () => {
    expect(resolveStrategy("")).toBe("both")
    expect(resolveStrategy("no output")).toBe("both")
  })
})

describe("installer: Node version gate (install.sh lines 62-68)", () => {
  it("accepts Node >= 22.5", () => {
    expect(isNodeVersionAtLeast("22.5.0", "22.5")).toBe(true)
    expect(isNodeVersionAtLeast("23.1.0", "22.5")).toBe(true)
    expect(isNodeVersionAtLeast("22.6.3", "22.5")).toBe(true)
  })

  it("rejects Node < 22.5 (error path)", () => {
    expect(isNodeVersionAtLeast("22.4.9", "22.5")).toBe(false)
    expect(isNodeVersionAtLeast("20.11.1", "22.5")).toBe(false)
    expect(isNodeVersionAtLeast("0", "22.5")).toBe(false)
  })
})

describe("installer: add-plugin.cjs (portable strategy execution)", () => {
  it("creates the config file when missing (V1 legacy key)", async () => {
    const cfg = configPath("created.json")
    runSetup("add-plugin.cjs", cfg, "file:///opt/opencode-mesa/dist/index.js", "plugin")
    const json = await readConfig("created.json")
    expect(json.plugin).toEqual(["file:///opt/opencode-mesa/dist/index.js"])
  })

  it("appends to the legacy plugin key for V1 hosts", async () => {
    const cfg = configPath("v1.json")
    await fs.writeFile(
      cfg,
      JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["file:///other"] }, null, 2),
    )
    runSetup("add-plugin.cjs", cfg, "file:///opt/opencode-mesa/dist/index.js", "plugin")
    const json = await readConfig("v1.json")
    expect(json.plugin).toEqual(["file:///other", "file:///opt/opencode-mesa/dist/index.js"])
  })

  it("replaces stale mesa entries instead of duplicating", async () => {
    const cfg = configPath("dup.json")
    await fs.writeFile(cfg, JSON.stringify({ plugin: ["file:///opt/old/opencode-mesa/dist/index.js"] }, null, 2))
    runSetup("add-plugin.cjs", cfg, "file:///opt/new/opencode-mesa/dist/index.js", "plugin")
    const json = await readConfig("dup.json")
    expect(json.plugin).toEqual(["file:///opt/new/opencode-mesa/dist/index.js"])
  })

  it("when targeting V2 (plugins), removes mesa entries from the legacy plugin key", async () => {
    const cfg = configPath("v2-cleanup.json")
    await fs.writeFile(
      cfg,
      JSON.stringify({ plugin: ["file:///opt/opencode-mesa/dist/index.js", "file:///other"] }, null, 2),
    )
    runSetup("add-plugin.cjs", cfg, "file:///opt/opencode-mesa/dist/index.js", "plugins")
    const json = await readConfig("v2-cleanup.json")
    expect(json.plugins).toEqual(["file:///opt/opencode-mesa/dist/index.js"])
    expect(json.plugin).toEqual(["file:///other"])
  })

  it("drops the legacy key entirely when it becomes empty", async () => {
    const cfg = configPath("v2-empty-legacy.json")
    await fs.writeFile(cfg, JSON.stringify({ plugin: ["file:///opt/opencode-mesa/dist/index.js"] }, null, 2))
    runSetup("add-plugin.cjs", cfg, "file:///opt/opencode-mesa/dist/index.js", "plugins")
    const json = await readConfig("v2-empty-legacy.json")
    expect(json.plugins).toEqual(["file:///opt/opencode-mesa/dist/index.js"])
    expect(json.plugin).toBeUndefined()
  })

  it("fails with a non-zero exit when arguments are missing", () => {
    expect(() => runSetup("add-plugin.cjs")).toThrow()
  })
})

describe("installer: remove-plugin.cjs (V2 legacy-key cleanup)", () => {
  it("removes mesa entries from both keys and deletes emptied keys", async () => {
    const cfg = configPath("remove.json")
    await fs.writeFile(
      cfg,
      JSON.stringify(
        { plugin: ["file:///opt/opencode-mesa/dist/index.js"], plugins: ["file:///opt/opencode-mesa/dist/index.js", "file:///keep"] },
        null,
        2,
      ),
    )
    runSetup("remove-plugin.cjs", cfg)
    const json = await readConfig("remove.json")
    expect(json.plugin).toBeUndefined()
    expect(json.plugins).toEqual(["file:///keep"])
  })

  it("exits cleanly when the config file does not exist", () => {
    expect(() => runSetup("remove-plugin.cjs", configPath("missing.json"))).not.toThrow()
  })

  it("leaves the file untouched when no mesa entries exist", async () => {
    const cfg = configPath("noop.json")
    const original = JSON.stringify({ plugins: ["file:///other"] }, null, 2)
    await fs.writeFile(cfg, original)
    runSetup("remove-plugin.cjs", cfg)
    expect(await fs.readFile(cfg, "utf-8")).toBe(original)
  })
})
