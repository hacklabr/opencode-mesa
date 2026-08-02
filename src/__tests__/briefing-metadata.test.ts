import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import {
  loadState,
  saveState,
  closeStorage,
  DiscussionStateSchema,
} from "../state.js"
import { createInitialState } from "../config.js"
import { openDatabase } from "../db/driver.js"
import {
  createBriefingTool,
  approveBriefingTool,
  importBriefingTool,
} from "../tools/briefing-tools.js"
import type { DiscussionState } from "../types.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "briefing-metadata")

function makeContext() {
  return {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "test",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

// ---------------------------------------------------------------------------
// A. Schema validation
// ---------------------------------------------------------------------------

describe("BriefingMetadata schema validation", () => {
  function baseState(): DiscussionState {
    return createInitialState("ws-schema-test")
  }

  test("accepts BriefingMetadata with all fields populated", () => {
    const state = baseState()
    state.briefing.metadata = {
      scopeMagnitude: "composite",
      classificationReason: "domains: gamification, docs; users: admins, end-users",
      subAreas: ["gamification", "document collaboration"],
      nonTechnicalDimensions: ["behavioral", "human-social"],
      nonTechnicalFlag: true,
    }
    const result = DiscussionStateSchema.safeParse(state)
    expect(result.success).toBe(true)
  })

  test("accepts BriefingMetadata with subAreas omitted (optional)", () => {
    const state = baseState()
    state.briefing.metadata = {
      scopeMagnitude: "simple",
      classificationReason: "single domain, single user type",
      nonTechnicalDimensions: [],
      nonTechnicalFlag: false,
    }
    const result = DiscussionStateSchema.safeParse(state)
    expect(result.success).toBe(true)
  })

  test("accepts metadata: null (legacy briefings)", () => {
    const state = baseState()
    state.briefing.metadata = null
    const result = DiscussionStateSchema.safeParse(state)
    expect(result.success).toBe(true)
  })

  test("rejects invalid scopeMagnitude value", () => {
    const state = baseState()
    state.briefing.metadata = {
      scopeMagnitude: "moderate" as never,
      classificationReason: "test",
      nonTechnicalDimensions: [],
      nonTechnicalFlag: false,
    }
    const result = DiscussionStateSchema.safeParse(state)
    expect(result.success).toBe(false)
  })

  test("rejects invalid ScopeDimension value", () => {
    const state = baseState()
    state.briefing.metadata = {
      scopeMagnitude: "composite",
      classificationReason: "test",
      nonTechnicalDimensions: ["spiritual" as never],
      nonTechnicalFlag: false,
    }
    const result = DiscussionStateSchema.safeParse(state)
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// B. create_briefing with metadata
// ---------------------------------------------------------------------------

describe("create_briefing with metadata args", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("populates state.briefing.metadata when classification args are passed", async () => {
    await createBriefingTool.execute(
      {
        slug: "composite-project",
        title: "Composite Project",
        content: "# Briefing\n\nContent.",
        scope_magnitude: "composite",
        classification_reason: "domains: gamification, docs; novel: real-time collaboration",
        non_technical_dimensions: ["behavioral", "human-social"],
        sub_areas: ["gamification", "doc collaboration"],
      },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata).not.toBeNull()
    expect(state.briefing.metadata!.scopeMagnitude).toBe("composite")
    expect(state.briefing.metadata!.classificationReason).toBe(
      "domains: gamification, docs; novel: real-time collaboration"
    )
    expect(state.briefing.metadata!.nonTechnicalDimensions).toEqual([
      "behavioral",
      "human-social",
    ])
    expect(state.briefing.metadata!.nonTechnicalFlag).toBe(true)
    expect(state.briefing.metadata!.subAreas).toEqual([
      "gamification",
      "doc collaboration",
    ])
  })

  test("leaves metadata null when no metadata args are passed", async () => {
    await createBriefingTool.execute(
      { slug: "plain-briefing", title: "Plain", content: "# Content" },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata).toBeNull()
  })

  test("throws ValidationError when scope_magnitude is passed without classification_reason", async () => {
    const result = await createBriefingTool.execute(
      {
        slug: "missing-reason",
        title: "Missing Reason",
        content: "# Content",
        scope_magnitude: "simple",
      },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("classification_reason is required")
  })

  test("includes visible projection block in markdown body when metadata is present", async () => {
    await createBriefingTool.execute(
      {
        slug: "with-projection",
        title: "With Projection",
        content: "# Briefing Body",
        scope_magnitude: "composite",
        classification_reason: "multi-domain platform",
        non_technical_dimensions: ["cultural"],
      },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    const file = await fs.readFile(
      join(TEST_DIR, state.briefing.path!),
      "utf-8"
    )
    expect(file).toContain("> **Scope:**")
    expect(file).toContain("COMPOSITE")
    expect(file).toContain("multi-domain platform")
    expect(file).toContain("> **Non-technical dimensions:**")
    expect(file).toContain("cultural")
  })

  test("does NOT include projection block when metadata is absent", async () => {
    await createBriefingTool.execute(
      { slug: "no-projection", title: "No Projection", content: "# Briefing Body" },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    const file = await fs.readFile(
      join(TEST_DIR, state.briefing.path!),
      "utf-8"
    )
    expect(file).not.toContain("> **Scope:**")
    expect(file).not.toContain("> **Non-technical dimensions:**")
  })

  test("derives non_technical_flag = true when dimensions are non-empty and flag not passed", async () => {
    await createBriefingTool.execute(
      {
        slug: "derived-true",
        title: "Derived True",
        content: "# Content",
        scope_magnitude: "composite",
        classification_reason: "social platform",
        non_technical_dimensions: ["human-social"],
      },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata!.nonTechnicalFlag).toBe(true)
  })

  test("derives non_technical_flag = false when dimensions are empty and flag not passed", async () => {
    await createBriefingTool.execute(
      {
        slug: "derived-false",
        title: "Derived False",
        content: "# Content",
        scope_magnitude: "simple",
        classification_reason: "single bugfix",
        non_technical_dimensions: [],
      },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata!.nonTechnicalFlag).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// C. approve_briefing metadata default (folded from deliver_briefing, spec D5)
// ---------------------------------------------------------------------------

describe("approve_briefing metadata default (folded from deliver_briefing)", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("defaults to scopeMagnitude composite when metadata is null at approval", async () => {
    await createBriefingTool.execute(
      { slug: "no-meta", title: "No Meta", content: "# Content" },
      makeContext()
    )
    await approveBriefingTool.execute({}, makeContext())

    let state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata).not.toBeNull()
    expect(state.briefing.metadata!.scopeMagnitude).toBe("composite")
    expect(state.briefing.metadata!.classificationReason).toContain("default")
    expect(state.briefing.metadata!.nonTechnicalDimensions).toEqual([])
    expect(state.briefing.metadata!.nonTechnicalFlag).toBe(false)

    // Re-loading keeps the backfilled metadata (approve is the single delivery step).
    state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata!.scopeMagnitude).toBe("composite")
  })

  test("does NOT overwrite metadata when already populated", async () => {
    await createBriefingTool.execute(
      {
        slug: "with-meta",
        title: "With Meta",
        content: "# Content",
        scope_magnitude: "simple",
        classification_reason: "single bugfix — explicit classification",
        non_technical_dimensions: [],
      },
      makeContext()
    )
    await approveBriefingTool.execute({}, makeContext())

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata!.scopeMagnitude).toBe("simple")
    expect(state.briefing.metadata!.classificationReason).toBe(
      "single bugfix — explicit classification"
    )
  })
})

// ---------------------------------------------------------------------------
// D. import_briefing default
// ---------------------------------------------------------------------------

describe("import_briefing metadata default", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await fs.mkdir(join(TEST_DIR, "imports"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
    await fs.rm(join(TEST_DIR, "imports"), { recursive: true, force: true }).catch(() => {})
  })

  test("sets metadata to composite default on import", async () => {
    const srcPath = join(TEST_DIR, "imports", "external.md")
    await fs.writeFile(srcPath, "# Imported Briefing\n\nContent.", "utf-8")

    await importBriefingTool.execute(
      { file_path: srcPath, slug: "imported" },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata).not.toBeNull()
    expect(state.briefing.metadata!.scopeMagnitude).toBe("composite")
    expect(state.briefing.metadata!.classificationReason).toContain("imported")
    expect(state.briefing.metadata!.nonTechnicalDimensions).toEqual([])
    expect(state.briefing.metadata!.nonTechnicalFlag).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// E. Migration v7_to_v8
// ---------------------------------------------------------------------------

describe("migrate_v7_to_v8", () => {
  const SESSION_ID = "legacy-session"

  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  /**
   * Creates a v7-era mesa_session_state table WITHOUT the briefing_metadata
   * column, then inserts a legacy row at state_version = 7. When loadState
   * runs, getDb executes SCHEMA_SQL (table exists → CREATE skipped) then all
   * migrations in order. migrate_v7_to_v8 adds the missing briefing_metadata
   * column so the row loads with metadata: null.
   */
  async function seedV7SessionState(): Promise<void> {
    const dbPath = join(TEST_DIR, ".mesa", "state.db")
    const db = openDatabase(dbPath, { create: true })
    try {
      db.exec(`
        CREATE TABLE mesa_session_state (
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          current_phase TEXT NOT NULL DEFAULT 'PLANNING',
          previous_phase TEXT DEFAULT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          briefing_path TEXT,
          briefing_status TEXT NOT NULL DEFAULT 'draft',
          briefing_slug TEXT,
          discussion_topic TEXT DEFAULT '',
          discussion_current_turn INTEGER DEFAULT 0,
          discussion_max_turns INTEGER DEFAULT 2,
          discussion_consensus_round INTEGER DEFAULT 0,
          discussion_debate_needed INTEGER DEFAULT 0,
          discussion_progress TEXT DEFAULT '{}',
          specification_path TEXT,
          specification_status TEXT DEFAULT 'pending',
          phases TEXT DEFAULT '["PLANNING","DISCUSSION","SPECIFICATION","EXECUTION"]',
          appendices TEXT DEFAULT '[]',
          state_version INTEGER DEFAULT 5,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, session_id)
        )
      `)
      const now = new Date().toISOString()
      db.run(
        `INSERT INTO mesa_session_state (
          workspace_id, session_id, current_phase, status,
          briefing_path, briefing_status, briefing_slug,
          discussion_topic, discussion_max_turns,
          specification_status, phases, appendices,
          created_at, updated_at, state_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          TEST_DIR, SESSION_ID, "PLANNING", "active",
          null, "approved", "legacy-briefing",
          "", 2,
          "pending",
          '["PLANNING","DISCUSSION","SPECIFICATION","EXECUTION"]',
          "[]",
          now, now, 7,
        ]
      )
    } finally {
      db.close()
    }
  }

  test("existing v7 state without briefing_metadata column loads with metadata: null", async () => {
    await seedV7SessionState()

    const state = await loadState(TEST_DIR, SESSION_ID)

    expect(state.briefing.slug).toBe("legacy-briefing")
    expect(state.briefing.metadata).toBeNull()
  })

  test("migration is idempotent — running twice does not error", async () => {
    await seedV7SessionState()

    const state1 = await loadState(TEST_DIR, SESSION_ID)
    expect(state1.briefing.metadata).toBeNull()
    closeStorage(TEST_DIR)

    const state2 = await loadState(TEST_DIR, SESSION_ID)
    expect(state2.briefing.metadata).toBeNull()
    expect(state2.briefing.slug).toBe("legacy-briefing")
  })
})

// ---------------------------------------------------------------------------
// F. Dual-write consistency
// ---------------------------------------------------------------------------

describe("dual-write consistency (state ↔ markdown body)", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("state.briefing.metadata.scopeMagnitude matches the markdown body projection", async () => {
    await createBriefingTool.execute(
      {
        slug: "dual-write",
        title: "Dual Write Test",
        content: "# Briefing",
        scope_magnitude: "composite",
        classification_reason: "evidence: 2 domains, novel mechanic",
        non_technical_dimensions: ["human-social", "behavioral"],
        sub_areas: ["reputation", "gamification"],
      },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.metadata).not.toBeNull()

    const file = await fs.readFile(
      join(TEST_DIR, state.briefing.path!),
      "utf-8"
    )

    const stateMagnitude = state.briefing.metadata!.scopeMagnitude
    const projectedMagnitude = stateMagnitude.toUpperCase()

    expect(file).toContain(`> **Scope:** ${projectedMagnitude}`)
    expect(file).toContain(state.briefing.metadata!.classificationReason)

    const dimsText = state.briefing.metadata!.nonTechnicalDimensions.join(", ")
    expect(file).toContain(`> **Non-technical dimensions:** ${dimsText}`)
  })

  test("persisted state round-trips metadata through save → load", async () => {
    await createBriefingTool.execute(
      {
        slug: "roundtrip",
        title: "Roundtrip",
        content: "# Briefing",
        scope_magnitude: "simple",
        classification_reason: "single fix, no novel mechanic",
        non_technical_dimensions: [],
      },
      makeContext()
    )

    const before = await loadState(TEST_DIR, "test-session")
    expect(before.briefing.metadata!.scopeMagnitude).toBe("simple")

    // Explicitly save to force a DB write, then reload
    before.briefing.metadata!.subAreas = ["edge-case"]
    await saveState(TEST_DIR, before, "test-session")

    const after = await loadState(TEST_DIR, "test-session")
    expect(after.briefing.metadata).not.toBeNull()
    expect(after.briefing.metadata!.scopeMagnitude).toBe("simple")
    expect(after.briefing.metadata!.classificationReason).toBe(
      "single fix, no novel mechanic"
    )
    expect(after.briefing.metadata!.nonTechnicalFlag).toBe(false)
    expect(after.briefing.metadata!.subAreas).toEqual(["edge-case"])
  })
})
