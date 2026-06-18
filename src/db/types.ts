// Runtime-agnostic database interfaces.
// Pure types only — do NOT import bun:sqlite or node:sqlite here.
// This is the authoritative contract both adapters satisfy and that
// all consumers (state.ts, sqlite-state-repository.ts, peer-tools.ts)
// depend on. Replaces the former src/bun-sqlite.d.ts.

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface IStatement<T = unknown> {
  get(...params: unknown[]): T | null
  all(...params: unknown[]): T[]
}

export interface ITransaction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T>
  immediate(...args: Parameters<T>): ReturnType<T>
}

export interface IDatabase {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): RunResult
  query<T = unknown>(sql: string): IStatement<T>
  transaction<T extends (...args: any[]) => any>(fn: T): ITransaction<T>
  close(): void
}

export type DbOpenOptions = { create?: boolean; readonly?: boolean }
