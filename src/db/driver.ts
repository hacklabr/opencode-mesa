// Insurance: if a bundler is ever added to the build, it MUST mark
// `bun:sqlite` and `node:sqlite` as external (they are runtime-only specifiers,
// resolved by the host runtime, never by a bundler-style module resolver).
//
// This is the ONLY module that references `bun:sqlite` / `node:sqlite`.
// The specifiers appear exclusively inside runtime-guarded top-level
// `await import()` calls so Node never statically resolves `bun:` (which would
// throw ERR_UNSUPPORTED_ESM_URL_SCHEME at load time). `openDatabase()` is
// SYNCHRONOUS for consumers: the driver ctor is resolved once via top-level
// await at module load, then `openDatabase` constructs directly.

import type { IDatabase, DbOpenOptions } from "./types.js"

// Re-export so consumers can `import { openDatabase, type IDatabase } from "./db/driver.js"`.
export type { IDatabase, DbOpenOptions } from "./types.js"

let open: (path: string, opts?: DbOpenOptions) => IDatabase

if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
  // Bun runtime — delegate to the thin bun:sqlite pass-through adapter.
  const m = await import("bun:sqlite")
  const { BunDatabase } = await import("./bun-adapter.js")
  // Cast through `unknown`: the ambient `bun:sqlite` declaration's `transaction`
  // return type predates and mismatches the real directly-callable
  // `immediate(...)` convention (verified empirically). The adapter's own
  // structural ctor type describes the correct runtime behavior.
  const Ctor = m.Database as unknown as ConstructorParameters<typeof BunDatabase>[0]
  open = (path, opts) => new BunDatabase(Ctor, path, opts)
} else {
  // Node runtime — delegate to the node:sqlite parity adapter.
  const m = await import("node:sqlite")
  const { NodeDatabase } = await import("./node-adapter.js")
  // Cast through `unknown` to the adapter's expected ctor type: node:sqlite's
  // options shape (`{ readOnly }`) differs from our normalized DbOpenOptions;
  // the adapter performs the casing normalization.
  const Ctor = m.DatabaseSync as unknown as ConstructorParameters<typeof NodeDatabase>[0]
  open = (path, opts) => new NodeDatabase(Ctor, path, opts)
}

export function openDatabase(path: string, opts?: DbOpenOptions): IDatabase {
  return open(path, opts)
}
