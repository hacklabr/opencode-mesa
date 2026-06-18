// node:sqlite (DatabaseSync) parity adapter.
//
// EMPIRICAL FINDING (Node v26.2.0, verified 2026-06-17):
//   - `{ readonly: true }`  (lowercase) is SILENTLY IGNORED → opens WRITABLE.
//   - `{ readOnly: true }`  (camelCase) is honored            → opens READ-ONLY.
//   - `{ readOnly: true }` on a non-existent file throws "unable to open
//     database file" (correct: cannot create a file in read-only mode).
// We normalize the bun-style `{ readonly: true }` that peer-tools/state.test
// pass into Node's expected `{ readOnly: true }` casing.
//
// `{ create: true }` is a no-op under Node (readWriteCreate is the default).

import type { IDatabase, IStatement, ITransaction, RunResult, DbOpenOptions } from "./types.js"

// Test-only SQL capture (parity assertion for BEGIN IMMEDIATE / ROLLBACK).
// No-op in production: the capture array stays null unless a test explicitly
// enables it via __beginSqlCapture(). The hook exists so the parity suite can
// assert which transaction-control statements were emitted deterministically
// (concurrency-timing-based assertions would be flaky).
let __emittedSqlCapture: string[] | null = null
export function __beginSqlCapture(): void {
  __emittedSqlCapture = []
}
export function __getEmittedSql(): string[] {
  return __emittedSqlCapture ?? []
}
export function __endSqlCapture(): void {
  __emittedSqlCapture = null
}

type NodeStatement = {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

type NodeDbInstance = {
  exec(sql: string): void
  prepare(sql: string): NodeStatement
  close(): void
}

type NodeDatabaseCtor = new (path: string, opts?: { readOnly?: boolean }) => NodeDbInstance

export class NodeDatabase implements IDatabase {
  private db: NodeDbInstance
  private statements = new Map<string, IStatement>()
  private inTransaction = false

  constructor(Ctor: NodeDatabaseCtor, path: string, opts?: DbOpenOptions) {
    const nodeOpts: { readOnly?: boolean } = {}
    if (opts?.readonly) {
      nodeOpts.readOnly = true
    }
    // When readonly is absent, Node opens read-write-create by default (matches bun).
    this.db = new Ctor(path, nodeOpts)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params?: unknown[]): RunResult {
    // No statement cache for run() — matches bun (bun's run() prepares each call).
    return this.db.prepare(sql).run(...(params ?? []))
  }

  query<T = unknown>(sql: string): IStatement<T> {
    // Cache by SQL string — matches bun's db.query() caching contract.
    const cached = this.statements.get(sql) as IStatement<T> | undefined
    if (cached) return cached

    const stmt = this.db.prepare(sql)
    // Node's StatementSync.get() returns the row or undefined; bun returns T | null.
    // Coerce undefined → null for parity.
    const wrapper: IStatement<T> = {
      get: (...params: unknown[]): T | null => (stmt.get(...params) ?? null) as T | null,
      all: (...params: unknown[]): T[] => stmt.all(...params) as T[],
    }
    this.statements.set(sql, wrapper as IStatement)
    return wrapper
  }

  transaction<T extends (...args: any[]) => any>(fn: T): ITransaction<T> {
    // Emulation: node:sqlite has no native transaction primitive.
    const run = (args: Parameters<T>, beginSql: string): ReturnType<T> => {
      if (this.inTransaction) {
        throw new Error("nested transactions not supported by node adapter")
      }
      this.db.exec(beginSql)
      if (__emittedSqlCapture) __emittedSqlCapture.push(beginSql)
      this.inTransaction = true
      try {
        const r = fn(...args) as ReturnType<T>
        this.db.exec("COMMIT")
        if (__emittedSqlCapture) __emittedSqlCapture.push("COMMIT")
        this.inTransaction = false
        return r
      } catch (e) {
        // ROLLBACK is best-effort: the connection may already be broken.
        // Swallow its error and re-throw the original — matches bun.
        try {
          this.db.exec("ROLLBACK")
        } catch {
          // intentionally empty
        }
        if (__emittedSqlCapture) __emittedSqlCapture.push("ROLLBACK")
        this.inTransaction = false
        throw e
      }
    }

    const tx = ((...args: Parameters<T>): ReturnType<T> => run(args, "BEGIN")) as ITransaction<T>
    // `.immediate` MUST emit BEGIN IMMEDIATE (not BEGIN/DEFERRED) — load-bearing
    // for concurrency under WAL with busy_timeout.
    tx.immediate = (...args: Parameters<T>): ReturnType<T> => run(args, "BEGIN IMMEDIATE")
    return tx
  }

  close(): void {
    this.db.close()
  }
}
