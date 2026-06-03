declare module "bun:sqlite" {
  interface Statement<T = unknown> {
    run(...params: unknown[]): RunResult
    get(...params: unknown[]): T | null
    all(...params: unknown[]): T[]
  }

  interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  interface Transaction<T extends (...args: unknown[]) => unknown> {
    (...args: Parameters<T>): ReturnType<T>
    immediate(): (...args: Parameters<T>) => ReturnType<T>
  }

  class Database {
    constructor(path: string, options?: { create?: boolean; readonly?: boolean })
    exec(sql: string): void
    run(sql: string, params?: unknown[]): RunResult
    query<T = unknown>(sql: string): Statement<T>
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): Transaction<T>
    close(): void
  }
}
