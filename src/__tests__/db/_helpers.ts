// Shared helpers for the DB adapter parity suite.
// Each test gets an isolated temp DB file (test-data isolation per the
// Turn 2 reservation) so no test depends on another's side effects.

import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { rmSync } from "node:fs"

/** A unique tmp path for a state DB (no sidecar files exist yet). */
export function tmpDbPath(): string {
  const rand = randomBytes(6).toString("hex")
  return join(tmpdir(), `mesa-parity-${rand}.db`)
}

/**
 * Remove a DB file plus any WAL/SHM/journal sidecars SQLite may have created.
 * Never throws — safe to call in afterEach even if nothing was written.
 */
export function cleanupDb(path: string): void {
  for (const ext of ["", "-wal", "-shm", "-journal"]) {
    rmSync(path + ext, { force: true })
  }
}
