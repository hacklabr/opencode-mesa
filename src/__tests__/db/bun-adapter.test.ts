// Parity tests for the bun:sqlite pass-through adapter.
//
// RUNNER EXPECTATION: this file imports `bun:sqlite`, which ONLY resolves under
// the Bun runtime. Under vitest-node the dynamic import would throw
// ERR_UNSUPPORTED_ESM_URL_SCHEME, so the entire suite is `describe.skip`-ed when
// `globalThis.Bun` is undefined. Run this file with:
//     bun run vitest src/__tests__/db/bun-adapter.test.ts
//
// The parity-critical assertions (the ones that pin the emulation) live in
// node-adapter.test.ts. This file confirms BunDatabase — which is a thin
// delegation to bun's native implementation — exhibits the same 13 behaviors.
// Three deliberate divergences from the node file are called out inline:
//   #6  BEGIN IMMEDIATE is native to bun; the SQL-sink hook is node-only, so we
//       assert the immediate() interface exists and runs.
//   #8  bun SUPPORTS nested transactions (savepoints) — the node adapter REJECTS
//       them. Both files document this divergence.

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { BunDatabase } from "../../db/bun-adapter.js"
import { tmpDbPath, cleanupDb } from "./_helpers.js"

const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
const maybe = IS_BUN ? describe : describe.skip

// Reference the adapter's expected constructor type without exporting a duplicate.
type BunCtor = ConstructorParameters<typeof BunDatabase>[0]

let Database: BunCtor | undefined
const openDbs: BunDatabase[] = []
const openPaths: string[] = []

function mkBunDb(opts?: { readonly?: boolean; create?: boolean }): BunDatabase {
  if (!Database) throw new Error("bun:sqlite Database not loaded (not running under Bun)")
  const path = tmpDbPath()
  openPaths.push(path)
  const db = new BunDatabase(Database, path, opts)
  openDbs.push(db)
  return db
}

maybe("BunDatabase parity (13 behaviors)", () => {
  beforeAll(async () => {
    // Reached only when IS_BUN (the suite is skipped otherwise). Cast through
    // `unknown` to the adapter's structural ctor type — same bridge driver.ts
    // uses, since bun:sqlite's real Database class differs in minor type
    // details from the adapter's hand-written contract.
    const m = await import("bun:sqlite")
    Database = (m as unknown as { Database: BunCtor }).Database
  })

  afterAll(() => {
    for (const db of openDbs) {
      try {
        db.close()
      } catch {
        // already closed by the test itself
      }
    }
    openDbs.length = 0
    for (const p of openPaths) cleanupDb(p)
    openPaths.length = 0
  })

  // 1. run — INSERT then SELECT roundtrip; assert {changes, lastInsertRowid}.
  it("run() returns RunResult shape with changes + lastInsertRowid", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)")
    const res = db.run("INSERT INTO t(val) VALUES(?)", ["a"])
    expect(res.changes).toBe(1)
    expect(res.lastInsertRowid).toBe(1)
    const row = db.query<{ val: string }>("SELECT val FROM t WHERE id = ?").get(1)
    expect(row?.val).toBe("a")
  })

  // 2. query().get — positional params, single row.
  it("query().get() returns a single row with positional params", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)")
    db.run("INSERT INTO t(val) VALUES(?)", ["x"])
    const row = db.query<{ val: string }>("SELECT val FROM t WHERE val = ?").get("x")
    expect(row).toEqual({ val: "x" })
  })

  // 3. query().all — multiple rows + NULL handling.
  it("query().all() returns multiple rows and preserves NULLs", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE n(a TEXT, b INTEGER)")
    db.run("INSERT INTO n(a, b) VALUES(?, ?)", ["one", 1])
    db.run("INSERT INTO n(a, b) VALUES(?, ?)", [null, null])
    const rows = db.query<{ a: string | null; b: number | null }>("SELECT a, b FROM n ORDER BY rowid").all()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ a: "one", b: 1 })
    expect(rows[1]).toEqual({ a: null, b: null })
  })

  // 4. exec — multi-statement DDL string.
  it("exec() runs a multi-statement DDL string", () => {
    const db = mkBunDb()
    db.exec(`
      CREATE TABLE foo(id INTEGER PRIMARY KEY, name TEXT);
      CREATE INDEX idx_foo_name ON foo(name);
      CREATE TABLE bar(id INTEGER PRIMARY KEY, ref INTEGER REFERENCES foo(id));
    `)
    db.run("INSERT INTO foo(name) VALUES(?)", ["z"])
    const row = db.query<{ name: string }>("SELECT name FROM foo").get()
    expect(row).toEqual({ name: "z" })
  })

  // 5. transaction() return-value propagation.
  it("transaction() propagates the wrapped fn's return value", () => {
    const db = mkBunDb()
    const r = db.transaction(() => 42)()
    expect(r).toBe(42)
  })

  // 6. transaction().immediate() — bun provides this natively. The deterministic
  //    SQL-sink assertion lives in node-adapter.test.ts (hook is node-only); here
  //    we assert the interface is present and executes without error.
  it("transaction().immediate() exists and runs", () => {
    const db = mkBunDb()
    const tx = db.transaction((n: number) => n + 1)
    expect(typeof tx.immediate).toBe("function")
    expect(tx.immediate(41)).toBe(42)
  })

  // 7. transaction() rollback — throw inside fn; rows not persisted, error re-thrown.
  it("transaction() rolls back and re-throws when fn throws", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE r(id INTEGER PRIMARY KEY)")
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO r(id) VALUES(1)")
        throw new Error("boom")
      })()
    ).toThrow("boom")
    const row = db.query("SELECT id FROM r").get()
    expect(row).toBeNull()
  })

  // 8. transaction() nesting — bun SUPPORTS it (savepoints).
  //    DIVERGENCE FROM NODE (documented): the node adapter REJECTS nesting;
  //    bun delegates to its native savepoint implementation.
  it("transaction() nesting is SUPPORTED on bun (divergence from node)", () => {
    const db = mkBunDb()
    expect(() =>
      db.transaction(() => {
        db.transaction(() => {})()
      })()
    ).not.toThrow()
  })

  // 9. readonly open — bun honors {readonly:true} natively.
  it("readonly open blocks writes", () => {
    const path = tmpDbPath()
    openPaths.push(path)
    const w = new BunDatabase(Database!, path)
    w.exec("CREATE TABLE t(id INTEGER)")
    w.close()

    const ro = new BunDatabase(Database!, path, { readonly: true })
    openDbs.push(ro)
    expect(() => ro.run("INSERT INTO t(id) VALUES(1)")).toThrow()
  })

  // 10. close() — subsequent method calls throw.
  it("close() invalidates the connection", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE t(id INTEGER)")
    db.close()
    expect(() => db.exec("SELECT 1")).toThrow()
    expect(() => db.run("SELECT 1")).toThrow()
    expect(() => db.query("SELECT 1")).toThrow()
  })

  // 11. query() caching — bun caches statements by SQL string natively.
  it("query() returns a reusable statement for the same SQL", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE c(id INTEGER PRIMARY KEY, v INTEGER)")
    const stmtA = db.query("SELECT v FROM c WHERE id = ?")
    const stmtB = db.query("SELECT v FROM c WHERE id = ?")
    // bun returns an equivalent cached statement (reference-equality is an
    // implementation detail; behavioral reusability is the parity contract).
    db.run("INSERT INTO c(v) VALUES(?)", [42])
    expect(stmtA.get(1)).toEqual({ v: 42 })
    expect(stmtB.get(1)).toEqual({ v: 42 })
  })

  // 12. run() no-params path.
  it("run() works without a params array", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE p(id INTEGER)")
    db.run("INSERT INTO p(id) VALUES(1)")
    const row = db.query<{ id: number }>("SELECT id FROM p").get()
    expect(row).toEqual({ id: 1 })
  })

  // 13. run() with params — db.run(sql, [a, b]) spreads correctly.
  it("run() spreads a params array across placeholders", () => {
    const db = mkBunDb()
    db.exec("CREATE TABLE pp(a TEXT, b INTEGER)")
    const res = db.run("INSERT INTO pp(a, b) VALUES(?, ?)", ["hello", 99])
    expect(res.changes).toBe(1)
    const row = db.query<{ a: string; b: number }>("SELECT a, b FROM pp").get()
    expect(row).toEqual({ a: "hello", b: 99 })
  })
})
