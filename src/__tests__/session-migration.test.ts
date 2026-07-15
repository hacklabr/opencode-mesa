import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, closeStorage, getDb } from "../state.js"
import { createLegacyMesaStructure } from "./_helpers/legacy-mesa-fixture.js"
import { buildSessionFolderPath } from "../utils/paths.js"
import { PLUGIN_STATE_DIR } from "../config.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "session-migration")

describe("session file migration (v10 → v11)", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("migrates briefing to sessions/{folder}/briefing.md", async () => {
    const { db, sessionId, slug, startedAt } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    // Trigger migration by loading state (calls getDb → migrateFiles_v10_to_v11)
    await loadState(TEST_DIR, sessionId)

    const expectedFolder = buildSessionFolderPath({
      createdAt: startedAt,
      sessionId,
      slug,
    })
    const briefingPath = join(TEST_DIR, expectedFolder, "briefing.md")

    const content = await fs.readFile(briefingPath, "utf-8")
    expect(content).toContain("Legacy Briefing")
  })

  test("migrates spec to sessions/{folder}/specification.md", async () => {
    const { db, sessionId, slug, startedAt } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    await loadState(TEST_DIR, sessionId)

    const expectedFolder = buildSessionFolderPath({
      createdAt: startedAt,
      sessionId,
      slug,
    })
    const specPath = join(TEST_DIR, expectedFolder, "specification.md")

    const content = await fs.readFile(specPath, "utf-8")
    expect(content).toContain("Legacy Spec")
  })

  test("migrates overview to sessions/{folder}/overview.md", async () => {
    const { db, sessionId, slug, startedAt } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    await loadState(TEST_DIR, sessionId)

    const expectedFolder = buildSessionFolderPath({
      createdAt: startedAt,
      sessionId,
      slug,
    })
    const overviewPath = join(TEST_DIR, expectedFolder, "overview.md")

    const content = await fs.readFile(overviewPath, "utf-8")
    expect(content).toContain("Legacy Overview")
  })

  test("updates state.db path columns to relative after migration", async () => {
    const { db, sessionId, slug, startedAt } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    await loadState(TEST_DIR, sessionId)

    const state = await loadState(TEST_DIR, sessionId)
    expect(state.briefing.path).not.toBeNull()
    expect(state.briefing.path!.startsWith(join(PLUGIN_STATE_DIR, "sessions"))).toBe(true)
    expect(state.briefing.path!.endsWith("briefing.md")).toBe(true)

    expect(state.specification.path).not.toBeNull()
    expect(state.specification.path!.endsWith("specification.md")).toBe(true)

    expect(state.specification.overviewPath).not.toBeNull()
    expect(state.specification.overviewPath!.endsWith("overview.md")).toBe(true)
  })

  test("sets sessionFolder column after migration", async () => {
    const { db, sessionId } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    await loadState(TEST_DIR, sessionId)

    const state = await loadState(TEST_DIR, sessionId)
    expect(state.sessionFolder).not.toBeNull()
    expect(state.sessionFolder!.startsWith(join(PLUGIN_STATE_DIR, "sessions"))).toBe(true)
  })

  test("is idempotent — running twice is a no-op", async () => {
    const { db, sessionId } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    // First migration
    await loadState(TEST_DIR, sessionId)
    const state1 = await loadState(TEST_DIR, sessionId)
    const briefingPath1 = state1.briefing.path!

    // Second migration (should be a no-op)
    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, sessionId)
    const state2 = await loadState(TEST_DIR, sessionId)
    const briefingPath2 = state2.briefing.path!

    expect(briefingPath2).toBe(briefingPath1)
    expect(state2.sessionFolder).toBe(state1.sessionFolder)
  })

  test("migrates appendices from basenames to relative paths", async () => {
    const { db, sessionId, appendixBasename, masterSpecId } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    await loadState(TEST_DIR, sessionId)

    const state = await loadState(TEST_DIR, sessionId)
    expect(state.appendices.length).toBeGreaterThan(0)

    // The new appendix reference should be a relative path, not a bare basename
    const ref = state.appendices[0]
    expect(ref).toContain("sessions")
    expect(ref).toContain("appendices")
    expect(ref.endsWith(".md")).toBe(true)

    // The masterSpecId prefix should be stripped from the basename (TD2)
    expect(ref).not.toContain(masterSpecId)

    // The file should exist at the new location
    const fileExists = await fs.access(join(TEST_DIR, ref)).then(() => true).catch(() => false)
    expect(fileExists).toBe(true)
  })

  test("migrates analyses files to sessions/{folder}/analyses/", async () => {
    const { db, sessionId } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    await loadState(TEST_DIR, sessionId)

    const state = await loadState(TEST_DIR, sessionId)
    expect(state.sessionFolder).not.toBeNull()

    // The analysis file should have been moved to the session folder
    const expectedAnalysisPath = join(
      TEST_DIR, state.sessionFolder!, "analyses", "turn1", "backend-architect.md"
    )
    const exists = await fs.access(expectedAnalysisPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  test("handles missing briefing file gracefully (sets path to null)", async () => {
    const { db, sessionId, slug } = await createLegacyMesaStructure(TEST_DIR)
    // Delete the briefing file before migration
    await fs.rm(join(TEST_DIR, ".mesa", "briefings", `briefing-${slug}.md`))
    db.close()

    // Should not throw
    await loadState(TEST_DIR, sessionId)

    const state = await loadState(TEST_DIR, sessionId)
    expect(state.sessionFolder).not.toBeNull()
    expect(state.briefing.path).toBeNull()
  })

  test("legacy files are moved (not copied) from original locations", async () => {
    const { db, sessionId, slug, masterSpecId } = await createLegacyMesaStructure(TEST_DIR)
    db.close()

    // Confirm legacy files exist before migration
    const oldBriefingPath = join(TEST_DIR, ".mesa", "briefings", `briefing-${slug}.md`)
    const oldSpecPath = join(TEST_DIR, ".mesa", "specifications", `spec-${masterSpecId}.md`)
    expect(await fs.access(oldBriefingPath).then(() => true).catch(() => false)).toBe(true)
    expect(await fs.access(oldSpecPath).then(() => true).catch(() => false)).toBe(true)

    await loadState(TEST_DIR, sessionId)

    // After migration, legacy files should no longer be at their original
    // locations (they were moved via rename, not copied).
    expect(await fs.access(oldBriefingPath).then(() => true).catch(() => false)).toBe(false)
    expect(await fs.access(oldSpecPath).then(() => true).catch(() => false)).toBe(false)
  })

  test("does not migrate when no sessions exist in DB", async () => {
    // Create legacy dirs but no session rows
    await fs.mkdir(join(TEST_DIR, ".mesa", "briefings"), { recursive: true })
    await fs.writeFile(
      join(TEST_DIR, ".mesa", "briefings", "orphan.md"),
      "# Orphan",
      "utf-8"
    )

    // Loading state creates a session, but no pre-existing session to migrate
    const state = await loadState(TEST_DIR, "fresh-session-id")
    expect(state.briefing.status).toBe("draft")

    // The orphan briefing should still be at its original location
    // (migration skipped because there were no sessions at first open)
    const orphanExists = await fs
      .access(join(TEST_DIR, ".mesa", "briefings", "orphan.md"))
      .then(() => true).catch(() => false)
    // After archival runs, it may be moved to _archive — verify it's
    // either at original or archived location
    const archivedExists = await fs
      .access(join(TEST_DIR, ".mesa", "_archive", "briefings", "orphan.md"))
      .then(() => true).catch(() => false)
    expect(orphanExists || archivedExists).toBe(true)
  })
})
