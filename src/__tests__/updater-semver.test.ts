import { describe, it, expect } from "vitest"
import { parseSemver, compareSemver, isNewerVersion, assertSemver, SEMVER_RE } from "../updater/semver"

describe("updater/semver", () => {
  describe("SEMVER_RE", () => {
    it("matches standard semver", () => {
      expect(SEMVER_RE.test("1.2.3")).toBe(true)
    })

    it("matches semver with v prefix", () => {
      expect(SEMVER_RE.test("v1.2.3")).toBe(true)
    })

    it("rejects prerelease suffix", () => {
      expect(SEMVER_RE.test("1.2.3-alpha")).toBe(false)
    })

    it("rejects build metadata", () => {
      expect(SEMVER_RE.test("1.2.3+build")).toBe(false)
    })

    it("rejects arbitrary strings", () => {
      expect(SEMVER_RE.test("not-a-version")).toBe(false)
    })

    it("rejects empty string", () => {
      expect(SEMVER_RE.test("")).toBe(false)
    })
  })

  describe("parseSemver", () => {
    it("parses standard semver", () => {
      expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
    })

    it("strips v prefix", () => {
      expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
    })

    it("parses zero versions", () => {
      expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 })
    })

    it("parses large version numbers", () => {
      expect(parseSemver("99.99.99")).toEqual({ major: 99, minor: 99, patch: 99 })
    })

    it("returns null for 0.0.0-unknown", () => {
      expect(parseSemver("0.0.0-unknown")).toBeNull()
    })

    it("returns null for non-version strings", () => {
      expect(parseSemver("not-a-version")).toBeNull()
    })

    it("returns null for prerelease suffix", () => {
      expect(parseSemver("1.2.3-alpha")).toBeNull()
    })

    it("returns null for empty string", () => {
      expect(parseSemver("")).toBeNull()
    })

    it("returns null for partial version", () => {
      expect(parseSemver("1.2")).toBeNull()
    })

    it("returns null for version with extra parts", () => {
      expect(parseSemver("1.2.3.4")).toBeNull()
    })
  })

  describe("compareSemver", () => {
    it("returns 0 for equal versions", () => {
      expect(compareSemver({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })).toBe(0)
    })

    it("returns 1 when a has higher major", () => {
      expect(compareSemver({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 })).toBe(1)
    })

    it("returns -1 when a has lower major", () => {
      expect(compareSemver({ major: 1, minor: 9, patch: 9 }, { major: 2, minor: 0, patch: 0 })).toBe(-1)
    })

    it("returns 1 when a has higher minor (same major)", () => {
      expect(compareSemver({ major: 1, minor: 3, patch: 0 }, { major: 1, minor: 2, patch: 9 })).toBe(1)
    })

    it("returns -1 when a has lower minor (same major)", () => {
      expect(compareSemver({ major: 1, minor: 2, patch: 9 }, { major: 1, minor: 3, patch: 0 })).toBe(-1)
    })

    it("returns 1 when a has higher patch (same major/minor)", () => {
      expect(compareSemver({ major: 1, minor: 2, patch: 4 }, { major: 1, minor: 2, patch: 3 })).toBe(1)
    })

    it("returns -1 when a has lower patch (same major/minor)", () => {
      expect(compareSemver({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 4 })).toBe(-1)
    })

    it("compares zero versions as equal", () => {
      expect(compareSemver({ major: 0, minor: 0, patch: 0 }, { major: 0, minor: 0, patch: 0 })).toBe(0)
    })
  })

  describe("isNewerVersion", () => {
    it("detects newer minor version", () => {
      expect(isNewerVersion("1.2.0", "1.3.0")).toBe(true)
    })

    it("detects newer patch version", () => {
      expect(isNewerVersion("1.2.0", "1.2.1")).toBe(true)
    })

    it("detects newer major version", () => {
      expect(isNewerVersion("1.2.0", "2.0.0")).toBe(true)
    })

    it("returns false for older version", () => {
      expect(isNewerVersion("2.0.0", "1.9.9")).toBe(false)
    })

    it("returns false for same version", () => {
      expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false)
    })

    it("returns false for invalid candidate", () => {
      expect(isNewerVersion("1.2.0", "abc")).toBe(false)
    })

    it("returns false for invalid current", () => {
      expect(isNewerVersion("abc", "1.2.0")).toBe(false)
    })

    it("returns false when both are invalid", () => {
      expect(isNewerVersion("abc", "def")).toBe(false)
    })

    it("returns false for empty strings", () => {
      expect(isNewerVersion("", "1.2.0")).toBe(false)
      expect(isNewerVersion("1.2.0", "")).toBe(false)
    })

    it("handles v-prefixed versions", () => {
      expect(isNewerVersion("v1.2.0", "v1.3.0")).toBe(true)
      expect(isNewerVersion("1.2.0", "v1.3.0")).toBe(true)
      expect(isNewerVersion("v1.2.0", "1.3.0")).toBe(true)
    })
  })

  describe("assertSemver", () => {
    it("does not throw for valid semver", () => {
      expect(() => assertSemver("1.2.3")).not.toThrow()
    })

    it("does not throw for v-prefixed semver", () => {
      expect(() => assertSemver("v1.2.3")).not.toThrow()
    })

    it("throws for invalid version string", () => {
      expect(() => assertSemver("invalid")).toThrow('Invalid semver: "invalid"')
    })

    it("throws for empty string", () => {
      expect(() => assertSemver("")).toThrow('Invalid semver: ""')
    })

    it("throws for prerelease suffix", () => {
      expect(() => assertSemver("1.0.0-beta")).toThrow()
    })

    it("throws for partial version", () => {
      expect(() => assertSemver("1.2")).toThrow()
    })

    it("throws with descriptive error message", () => {
      expect(() => assertSemver("foo")).toThrow('Invalid semver: "foo". Expected format: X.Y.Z')
    })
  })
})
