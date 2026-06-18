// Pure-runtime smoke test for the built Mesa plugin (dist/index.js).
//
// Proves the four cache-bypass invariants that CI must guarantee:
//   1. dist/index.js IMPORTS under the host runtime (regression test for the
//      NodeNext/.js-extension fix — previously ERR_MODULE_NOT_FOUND).
//   2. The `mesa(input)` plugin factory returns its tool map.
//   3. Executing mesa_status creates `.mesa/state.db` via the runtime-agnostic
//      SQLite driver (the BLOCKER-fixed proof) AND reports the initial phase.
//
// Designed to run IDENTICALLY under `node scripts/smoke.mjs <dir>` and
// `bun scripts/smoke.mjs <dir>`. Uses only Node-compatible stdlib so it never
// imports a runtime-only specifier itself — the driver's own runtime guard
// inside dist/ is what is being exercised.
//
// Exit codes: 0 on success (prints "SMOKE OK (<runtime>)"),
//             1 on any failure (prints "SMOKE FAIL: <reason>" to stderr).

import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const tmpDir = process.argv[2]
if (!tmpDir) {
  console.error("SMOKE FAIL: missing tmp dir argument (usage: smoke.mjs <tmp-dir>)")
  process.exit(1)
}

// Resolve the BUILT bundle relative to this script's location — never hardcode
// an absolute path so the script stays portable across machines and CI runners.
const here = dirname(fileURLToPath(import.meta.url))
const distPath = join(here, "..", "dist", "index.js")

// Detect host runtime for the success banner only (no behavior branches).
const runtime = typeof globalThis.Bun !== "undefined" ? "bun" : "node"

function fail(reason) {
  console.error(`SMOKE FAIL: ${reason}`)
  process.exit(1)
}

// ---- Assertion 1: import resolves (reaching this line means it succeeded) ----
// A rejection here is caught and reported as an import failure.
let mod
try {
  mod = await import(distPath)
} catch (err) {
  fail(`import dist/index.js threw under ${runtime}: ${err && err.code ? err.code : (err && err.message ? err.message : String(err))}`)
}

const { mesa } = mod
if (typeof mesa !== "function") {
  fail(`expected \`mesa\` plugin factory to be a function, got ${typeof mesa}`)
}

// ---- Assertion 2: factory returns the tool map with mesa_status ----
let plugin
try {
  plugin = await mesa({ client: {}, directory: tmpDir })
} catch (err) {
  fail(`mesa() factory threw: ${err && err.message ? err.message : String(err)}`)
}

const mesaStatus = plugin?.tool?.mesa_status
if (!mesaStatus || typeof mesaStatus.execute !== "function") {
  fail(`plugin.tool.mesa_status missing or non-executable (got ${typeof mesaStatus})`)
}

// ---- Assertion 3: execution creates state.db and reports the initial phase ----
let result
try {
  result = await mesaStatus.execute({}, { directory: tmpDir })
} catch (err) {
  fail(`mesa_status.execute threw: ${err && err.message ? err.message : String(err)}`)
}

// 3a: runtime-agnostic driver materialized the SQLite database file.
const dbPath = join(tmpDir, ".mesa", "state.db")
if (!existsSync(dbPath)) {
  fail(`expected state.db at ${dbPath} after mesa_status.execute (driver did not create it under ${runtime})`)
}

// 3b: result indicates the fresh initial state. The real return shape (verified
// against src/tools/mesa-tools.ts) is { title, output, metadata: { phase, ... } }.
// Accept either the structured metadata.phase or, as a resilient fallback, the
// phase string embedded in `output` (so the assertion survives minor reshapes).
const phase =
  (result && typeof result === "object" && result.metadata && typeof result.metadata.phase === "string")
    ? result.metadata.phase
    : (typeof result === "object" && result && typeof result.output === "string")
      ? (result.output.match(/Phase:\s*(\w+)/) || [])[1]
      : undefined

if (phase !== "PLANNING") {
  const got = typeof result === "object" && result
    ? JSON.stringify(result).slice(0, 300)
    : String(result).slice(0, 300)
  fail(`expected initial phase "PLANNING", got ${phase ? `"${phase}"` : "<unparsed>"} (result=${got})`)
}

console.log(`SMOKE OK (${runtime})`)
