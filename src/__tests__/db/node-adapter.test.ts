// Parity tests for the node:sqlite (DatabaseSync) adapter.
//
// This is the parity-critical file: NodeDatabase EMULATES the bun:sqlite
// contract (no native transaction primitive, undefined→null coercion, the
// readonly→readOnly casing normalization). These 13 named tests pin that
// emulation against the behaviors state.ts and peer-tools.ts depend on.
//
// Runner: vitest (node). NodeDatabase is instantiated DIRECTLY with the
// `node:sqlite` DatabaseSync constructor (not via openDatabase/driver) so this
// suite exercises the emulation regardless of the host runtime.
//
// NOTE: This suite is skipped under Bun because `node:sqlite` is a Node.js
// built-in that Bun does not provide. The Bun adapter is covered by
// bun-adapter.test.ts.

import { describe, it, expect, afterEach } from "vitest"
import { NodeDatabase, __beginSqlCapture, __getEmittedSql, __endSqlCapture } from "../../db/node-adapter.js"
import { tmpDbPath, cleanupDb } from "./_helpers.js"

const isBun = typeof process !== "undefined" && !!process.versions?.bun

// node:sqlite is a Node.js built-in; Bun does not provide it. Load lazily so the
// module still parses under Bun (the suite is skipped there).
let NodeCtor: ConstructorParameters<typeof NodeDatabase>[0] | null = null
if (!isBun) {
  try {
    NodeCtor = (await import("node:sqlite")).DatabaseSync as unknown as ConstructorParameters<typeof NodeDatabase>[0]
  } catch {
    // node:sqlite unavailable in this runtime — tests will be skipped.
  }
}

// Track every DB + path created during a test so afterEach can tear them down
// deterministically (close is best-effort — some tests intentionally close).
const openDbs: NodeDatabase[] = []
const openPaths: string[] = []

afterEach(() => {
  for (const db of openDbs) {
    try {
      db.close()
    } catch {
      // already closed by the test itself — fine
    }
  }
  openDbs.length = 0
  for (const p of openPaths) cleanupDb(p)
  openPaths.length = 0
  // Safety reset so a capture started in one test never leaks into another.
  __endSqlCapture()
})

describe.skipIf(isBun || !NodeCtor)("NodeDatabase parity (13 behaviors)", () => {
  const Ctor = NodeCtor as NonNullable<typeof NodeCtor>

  function mkNodeDb(opts?: { readonly?: boolean }): NodeDatabase {
    const path = tmpDbPath()
    openPaths.push(path)
    const db = new NodeDatabase(Ctor, path, opts)
    openDbs.push(db)
    return db
  }

  // 1. run — INSERT then SELECT roundtrip; assert {changes, lastInsertRowid}.
  it("run() returns RunResult shape with changes + lastInsertRowid", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)")
    const res = db.run("INSERT INTO t(val) VALUES(?)", ["a"])
    expect(res.changes).toBe(1)
    expect(res.lastInsertRowid).toBe(1)
    const row = db.query<{ val: string }>("SELECT val FROM t WHERE id = ?").get(1)
    expect(row?.val).toBe("a")
  })

  // 2. query().get — positional params, single row.
  it("query().get() returns a single row with positional params", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)")
    db.run("INSERT INTO t(val) VALUES(?)", ["x"])
    const row = db.query<{ val: string }>("SELECT val FROM t WHERE val = ?").get("x")
    expect(row).toEqual({ val: "x" })
  })

  // 3. query().all — multiple rows + NULL handling.
  it("query().all() returns multiple rows and preserves NULLs", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE n(a TEXT, b INTEGER)")
    db.run("INSERT INTO n(a, b) VALUES(?, ?)", ["one", 1])
    db.run("INSERT INTO n(a, b) VALUES(?, ?)", [null, null])
    const rows = db.query<{ a: string | null; b: number | null }>("SELECT a, b FROM n ORDER BY rowid").all()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ a: "one", b: 1 })
    expect(rows[1]).toEqual({ a: null, b: null })
  })

  // 4. exec — multi-statement DDL string (mirrors migrate_v5_to_v6 style).
  it("exec() runs a multi-statement DDL string", () => {
    const db = mkNodeDb()
    db.exec(`
      CREATE TABLE foo(id INTEGER PRIMARY KEY, name TEXT);
      CREATE INDEX idx_foo_name ON foo(name);
      CREATE TABLE bar(id INTEGER PRIMARY KEY, ref INTEGER REFERENCES foo(id));
    `)
    // Verify the schema actually materialized by using it.
    db.run("INSERT INTO foo(name) VALUES(?)", ["z"])
    const row = db.query<{ name: string }>("SELECT name FROM foo").get()
    expect(row).toEqual({ name: "z" })
  })

  // 5. transaction() return-value propagation (state.ts:1200 save.immediate() contract).
  it("transaction() propagates the wrapped fn's return value", () => {
    const db = mkNodeDb()
    const r = db.transaction(() => 42)()
    expect(r).toBe(42)
  })

  // 6. transaction().immediate() emits BEGIN IMMEDIATE (deterministic via SQL-sink hook).
  it("transaction().immediate() emits BEGIN IMMEDIATE", () => {
    const db = mkNodeDb()
    __beginSqlCapture()
    db.transaction(() => {}).immediate()
    const emitted = __getEmittedSql()
    expect(emitted).toContain("BEGIN IMMEDIATE")
    expect(emitted).not.toContain("BEGIN") // guard: no bare "BEGIN" token beyond the immediate form
  })

  // 7. transaction() rollback — throw inside fn; ROLLBACK fires, rows not persisted, error re-thrown.
  it("transaction() rolls back and re-throws when fn throws", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE r(id INTEGER PRIMARY KEY)")

    __beginSqlCapture()
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO r(id) VALUES(1)")
        throw new Error("boom")
      })()
    ).toThrow("boom")
    // ROLLBACK emitted by the emulation.
    expect(__getEmittedSql()).toContain("ROLLBACK")
    // Row was NOT persisted.
    const row = db.query("SELECT id FROM r").get()
    expect(row).toBeNull()
  })

  // 8. transaction() nesting REJECTED.
  // DIVERGENCE FROM BUN (documented): bun:sqlite SUPPORTS nested transactions
  // via savepoints. The node adapter REJECTS them because node:sqlite has no
  // native nesting primitive and the emulation tracks a single inTransaction flag.
  it("transaction() nesting is REJECTED (divergence from bun)", () => {
    const db = mkNodeDb()
    expect(() =>
      db.transaction(() => {
        db.transaction(() => {})()
      })()
    ).toThrow(/nested transactions/)
  })

  // 9. readonly open — validates the readonly→readOnly casing normalization.
  // Without the normalization, {readonly:true} is SILENTLY IGNORED under Node
  // (opens writable) — this is the exact bug that would let peer-tools' readonly
  // open silently become writable on node.
  it("readonly open blocks writes (readonly→readOnly normalization)", () => {
    const path = tmpDbPath()
    openPaths.push(path)
    // Create + populate the file writable first (read-only open of a non-existent
    // file would throw, which is correct SQLite behavior).
    const w = new NodeDatabase(Ctor, path)
    w.exec("CREATE TABLE t(id INTEGER)")
    w.close()

    const ro = new NodeDatabase(Ctor, path, { readonly: true })
    openDbs.push(ro)
    expect(() => ro.run("INSERT INTO t(id) VALUES(1)")).toThrow()
  })

  // 10. close() — subsequent method calls throw.
  it("close() invalidates the connection", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE t(id INTEGER)")
    db.close()
    expect(() => db.exec("SELECT 1")).toThrow()
    expect(() => db.run("SELECT 1")).toThrow()
    expect(() => db.query("SELECT 1")).toThrow()
  })

  // 11. query() caching — same SQL returns the same reusable statement object.
  it("query() caches statements by SQL string (reusable)", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE c(id INTEGER PRIMARY KEY, v INTEGER)")
    const stmtA = db.query("SELECT v FROM c WHERE id = ?")
    const stmtB = db.query("SELECT v FROM c WHERE id = ?")
    expect(stmtA).toBe(stmtB) // same cached object
    // The cached statement stays usable as new data arrives.
    db.run("INSERT INTO c(v) VALUES(?)", [42])
    expect(stmtA.get(1)).toEqual({ v: 42 })
  })

  // 12. run() no-params path — db.run(sql) without a params array.
  it("run() works without a params array", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE p(id INTEGER)")
    db.run("INSERT INTO p(id) VALUES(1)")
    const row = db.query<{ id: number }>("SELECT id FROM p").get()
    expect(row).toEqual({ id: 1 })
  })

  // 13. run() with params — db.run(sql, [a, b]) spreads correctly.
  it("run() spreads a params array across placeholders", () => {
    const db = mkNodeDb()
    db.exec("CREATE TABLE pp(a TEXT, b INTEGER)")
    const res = db.run("INSERT INTO pp(a, b) VALUES(?, ?)", ["hello", 99])
    expect(res.changes).toBe(1)
    const row = db.query<{ a: string; b: number }>("SELECT a, b FROM pp").get()
    expect(row).toEqual({ a: "hello", b: 99 })
  })
})
