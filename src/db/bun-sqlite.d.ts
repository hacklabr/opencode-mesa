// Ambient declaration for the runtime-only `bun:sqlite` specifier.
//
// `bun:sqlite` is resolved exclusively by the Bun host runtime — never by
// TypeScript's resolver or any bundler. This file declares only the minimal
// surface that driver.ts touches (the Database ctor); the driver immediately
// casts through `unknown` onto bun-adapter.ts's structural ctor type, so the
// skeletal shape here is sufficient. Replaces the former top-level
// src/bun-sqlite.d.ts shim, consolidated alongside the rest of the db layer.
declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, opts?: { create?: boolean; readonly?: boolean })
  }
}
