import { describe, expect, test } from "vitest"
import { join } from "node:path"
import {
  buildSessionFolderPath,
  buildBriefingPath,
  buildSpecificationPath,
  buildOverviewPath,
  buildAnalysisPath,
  buildDiscussionPath,
  buildAskPeerPath,
  getAppendixPath,
  getPhaseAnalysisDraftPath,
  shortSessionId,
  sanitizeSlugForFs,
  resolveAbsolutePath,
  type SessionFolderInput,
} from "../utils/paths.js"

const FIXED_INPUT: SessionFolderInput = {
  createdAt: "2026-07-13T15:34:00.000Z",
  sessionId: "ses_d19dbe71aaaa",
  slug: "analise-seguranca",
}

// ---------------------------------------------------------------------------
// buildSessionFolderPath
// ---------------------------------------------------------------------------

describe("buildSessionFolderPath", () => {
  test("produces the correct folder name format YYYYMMDDHHmm_4hex_slug", () => {
    const result = buildSessionFolderPath(FIXED_INPUT)
    expect(result).toBe(join(".mesa", "sessions", "202607131534_d19d_analise-seguranca"))
  })

  test("is deterministic — same input always yields same output", () => {
    const a = buildSessionFolderPath(FIXED_INPUT)
    const b = buildSessionFolderPath({ ...FIXED_INPUT })
    expect(a).toBe(b)
  })

  test("returns a workspace-relative path starting with .mesa/sessions/", () => {
    const result = buildSessionFolderPath(FIXED_INPUT)
    expect(result.startsWith(join(".mesa", "sessions"))).toBe(true)
  })

  test("uses UTC for timestamp formatting", () => {
    // 2026-07-13T15:34:00.000Z → 202607131534 in UTC
    const result = buildSessionFolderPath({
      createdAt: "2026-07-13T15:34:00.000Z",
      sessionId: "ses_a1b2c3d4",
      slug: "test",
    })
    expect(result).toContain("202607131534")
  })

  test("handles midnight boundary correctly", () => {
    const result = buildSessionFolderPath({
      createdAt: "2026-01-01T00:00:00.000Z",
      sessionId: "ses_abcd1234",
      slug: "boundary",
    })
    expect(result).toContain("202601010000")
  })

  test("different createdAt values produce different folders", () => {
    const a = buildSessionFolderPath({ ...FIXED_INPUT, createdAt: "2026-07-13T15:35:00.000Z" })
    const b = buildSessionFolderPath({ ...FIXED_INPUT, createdAt: "2026-07-13T15:36:00.000Z" })
    expect(a).not.toBe(b)
  })

  test("different session IDs produce different folders", () => {
    const a = buildSessionFolderPath({ ...FIXED_INPUT, sessionId: "ses_aaaa1111" })
    const b = buildSessionFolderPath({ ...FIXED_INPUT, sessionId: "ses_bbbb2222" })
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// shortSessionId
// ---------------------------------------------------------------------------

describe("shortSessionId", () => {
  test("strips ses_ prefix and returns first 4 hex chars", () => {
    expect(shortSessionId("ses_d19dbe71-1234-5678")).toBe("d19d")
  })

  test("works with UUID without ses_ prefix", () => {
    expect(shortSessionId("d19dbe71-1234-5678-abcd-ef0123456789")).toBe("d19d")
  })

  test("falls back to xxxx when no hex chars found", () => {
    expect(shortSessionId("zzzz-wxyz")).toBe("xxxx")
  })

  test("falls back to xxxx for empty string", () => {
    expect(shortSessionId("")).toBe("xxxx")
  })

  test("only takes hex characters [a-f0-9]", () => {
    expect(shortSessionId("ses_zzzz9999")).toBe("9999")
  })

  test("caps at 4 characters", () => {
    expect(shortSessionId("ses_abcdef123456")).toBe("abcd")
  })

  test("handles ses_ prefix followed by non-hex letters (digits are hex)", () => {
    expect(shortSessionId("ses_g1h2i3j4k5")).toBe("1234")
  })
})

// ---------------------------------------------------------------------------
// sanitizeSlugForFs
// ---------------------------------------------------------------------------

describe("sanitizeSlugForFs", () => {
  test("lowercases the slug", () => {
    expect(sanitizeSlugForFs("MyProject")).toBe("myproject")
  })

  test("strips accents via NFD normalization", () => {
    expect(sanitizeSlugForFs("análise-segurança")).toBe("analise-seguranca")
    expect(sanitizeSlugForFs("café-résumé")).toBe("cafe-resume")
  })

  test("replaces non-alphanumeric chars with hyphens", () => {
    expect(sanitizeSlugForFs("my project 2024")).toBe("my-project-2024")
    expect(sanitizeSlugForFs("foo_bar.baz")).toBe("foo-bar-baz")
  })

  test("collapses consecutive hyphens", () => {
    expect(sanitizeSlugForFs("foo---bar")).toBe("foo-bar")
    expect(sanitizeSlugForFs("a  b  c")).toBe("a-b-c")
  })

  test("trims leading and trailing hyphens", () => {
    expect(sanitizeSlugForFs("---foo---")).toBe("foo")
    expect(sanitizeSlugForFs("-bar-")).toBe("bar")
  })

  test("caps at 50 characters", () => {
    const long = "a".repeat(100)
    const result = sanitizeSlugForFs(long)
    expect(result.length).toBe(50)
  })

  test("falls back to untitled for empty input", () => {
    expect(sanitizeSlugForFs("")).toBe("untitled")
  })

  test("falls back to untitled when only special chars", () => {
    expect(sanitizeSlugForFs("!!!???")).toBe("untitled")
  })

  test("preserves hyphens between words", () => {
    expect(sanitizeSlugForFs("e-commerce-platform")).toBe("e-commerce-platform")
  })
})

// ---------------------------------------------------------------------------
// Delegating constructors
// ---------------------------------------------------------------------------

describe("buildBriefingPath", () => {
  test("appends briefing.md to session folder", () => {
    const result = buildBriefingPath(FIXED_INPUT)
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca", "briefing.md")
    )
  })

  test("starts with .mesa/sessions/", () => {
    expect(buildBriefingPath(FIXED_INPUT).startsWith(join(".mesa", "sessions"))).toBe(true)
  })
})

describe("buildSpecificationPath", () => {
  test("appends specification.md to session folder", () => {
    const result = buildSpecificationPath(FIXED_INPUT)
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca", "specification.md")
    )
  })

  test("uses fixed filename specification.md (not spec-{random}.md)", () => {
    const result = buildSpecificationPath(FIXED_INPUT)
    expect(result).not.toContain("spec-")
    expect(result.endsWith("specification.md")).toBe(true)
  })
})

describe("buildOverviewPath", () => {
  test("appends overview.md to session folder", () => {
    const result = buildOverviewPath(FIXED_INPUT)
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca", "overview.md")
    )
  })
})

describe("buildAnalysisPath", () => {
  test("produces turn{N}/{personaId}.md under analyses/", () => {
    const result = buildAnalysisPath(FIXED_INPUT, 1, "backend-architect")
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca",
        "analyses", "turn1", "backend-architect.md")
    )
  })

  test("handles multi-digit turn numbers", () => {
    const result = buildAnalysisPath(FIXED_INPUT, 10, "specialist")
    expect(result).toContain("turn10")
  })
})

describe("buildDiscussionPath", () => {
  test("produces discussion-r{R}/{personaId}.md under analyses/", () => {
    const result = buildDiscussionPath(FIXED_INPUT, 2, "frontend-dev")
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca",
        "analyses", "discussion-r2", "frontend-dev.md")
    )
  })
})

describe("buildAskPeerPath", () => {
  test("produces ask_peer/{caller}_{callee}_{id}.md", () => {
    const result = buildAskPeerPath(FIXED_INPUT, "caller-id", "callee-id", "ex123")
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca",
        "analyses", "ask_peer", "caller-id_callee-id_ex123.md")
    )
  })
})

describe("getAppendixPath", () => {
  test("produces appendices/appendix-{phaseSlug}-{uuid}.md", () => {
    const result = getAppendixPath(FIXED_INPUT, "phase-1", "abcd1234")
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca",
        "appendices", "appendix-phase-1-abcd1234.md")
    )
  })

  test("does not include masterSpecId in filename", () => {
    const result = getAppendixPath(FIXED_INPUT, "backend", "xyz")
    expect(result).not.toContain("spec-")
    expect(result).toContain("appendix-backend-xyz.md")
  })
})

describe("getPhaseAnalysisDraftPath", () => {
  test("produces phase-analysis/{phaseId} directory", () => {
    const result = getPhaseAnalysisDraftPath(FIXED_INPUT, "phase-1-backend")
    expect(result).toBe(
      join(".mesa", "sessions", "202607131534_d19d_analise-seguranca",
        "phase-analysis", "phase-1-backend")
    )
  })
})

// ---------------------------------------------------------------------------
// resolveAbsolutePath
// ---------------------------------------------------------------------------

describe("resolveAbsolutePath", () => {
  test("prepends workspace dir to relative paths", () => {
    const result = resolveAbsolutePath("/workspace", ".mesa/sessions/foo/briefing.md")
    expect(result).toBe(join("/workspace", ".mesa", "sessions", "foo", "briefing.md"))
  })

  test("returns absolute paths unchanged", () => {
    const abs = "/absolute/path/to/file.md"
    expect(resolveAbsolutePath("/workspace", abs)).toBe(abs)
  })

  test("handles relative paths with leading .", () => {
    const result = resolveAbsolutePath("/workspace", "./briefing.md")
    expect(result).toBe(join("/workspace", "./briefing.md"))
  })
})
