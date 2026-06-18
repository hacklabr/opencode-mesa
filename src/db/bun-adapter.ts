// Thin pass-through adapter for bun:sqlite.
// Bun's Database already matches the IDatabase contract, so this is mostly
// delegation. The adapter exists so the driver never leaks bun-specific types
// to consumers and so both adapters share a uniform construction signature
// `(ctor, path, opts)`.

import type { IDatabase, IStatement, ITransaction, RunResult, DbOpenOptions } from "./types.js"

type BunDatabaseCtor = new (path: string, opts?: DbOpenOptions) => {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): RunResult
  query<T = unknown>(sql: string): IStatement<T>
  transaction<T extends (...args: any[]) => any>(fn: T): ITransaction<T>
  close(): void
}

export class BunDatabase implements IDatabase {
  private db: InstanceType<BunDatabaseCtor>

  constructor(Ctor: BunDatabaseCtor, path: string, opts?: DbOpenOptions) {
    // Bun accepts { create, readonly } as-is.
    this.db = new Ctor(path, opts)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params?: unknown[]): RunResult {
    // Normalize undefined → []: bun:sqlite treats an explicit `undefined` 2nd
    // argument as 1 binding value, erroring on parameter-less statements
    // (e.g. `PRAGMA foreign_keys = ON`) with "expected 0 values, received 1".
    // Mirrors the node adapter's `...(params ?? [])` normalization.
    return this.db.run(sql, params ?? [])
  }

  query<T = unknown>(sql: string): IStatement<T> {
    return this.db.query<T>(sql)
  }

  transaction<T extends (...args: any[]) => any>(fn: T): ITransaction<T> {
    // Bun already provides tx.immediate — no emulation needed.
    return this.db.transaction(fn)
  }

  close(): void {
    this.db.close()
  }
}
