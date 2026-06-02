import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  getInstallDir,
  getGitSha,
  acquireLock,
  releaseLock,
  rollback,
  runUpdate,
} from "../updater/runner"
import { UpdaterError } from "../errors"

const TEST_DIR = join(tmpdir(), "mesa-runner-test")

describe("updater/runner", () => {
  describe("getInstallDir", () => {
    it("returns a path ending at project root (2 levels up from dist/updater)", () => {
      const dir = getInstallDir()
      expect(dir).toMatch(/opencode-mesa\/?$/)
    })
  })

  describe("getGitSha", () => {
    it("returns a 40-char hex SHA for the current repo", async () => {
      const sha = await getGitSha(getInstallDir())
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it("throws UpdaterError for a non-git directory", async () => {
      const fakeDir = join(tmpdir(), "mesa-no-git-dir-" + Date.now())
      mkdirSync(fakeDir, { recursive: true })
      try {
        await expect(getGitSha(fakeDir)).rejects.toThrow(UpdaterError)
      } finally {
        rmSync(fakeDir, { recursive: true, force: true })
      }
    })
  })

  describe("acquireLock / releaseLock", () => {
    beforeEach(() => {
      mkdirSync(TEST_DIR, { recursive: true })
    })

    afterEach(() => {
      rmSync(TEST_DIR, { recursive: true, force: true })
    })

    it("acquires a lock and returns a numeric handle", () => {
      const lockPath = join(TEST_DIR, "test.lock")
      const handle = acquireLock(lockPath)
      expect(handle).not.toBeNull()
      expect(typeof handle).toBe("number")

      // Lock file should exist
      expect(existsSync(lockPath)).toBe(true)

      releaseLock(lockPath)

      // Brief delay for the holder process to die and release flock
      // The lock file may still exist but the process is dead
    })

    it("returns null when lock is already held", () => {
      const lockPath = join(TEST_DIR, "test-dup.lock")
      const handle1 = acquireLock(lockPath)
      expect(handle1).not.toBeNull()

      // Second acquire should fail (non-blocking)
      const handle2 = acquireLock(lockPath)
      expect(handle2).toBeNull()

      releaseLock(lockPath)
    })

    it("allows re-acquiring after release", async () => {
      const lockPath = join(TEST_DIR, "test-release.lock")
      const handle1 = acquireLock(lockPath)
      expect(handle1).not.toBeNull()
      releaseLock(lockPath)

      // Wait for the background process to fully release flock
      await new Promise((resolve) => setTimeout(resolve, 200))

      const handle2 = acquireLock(lockPath)
      expect(handle2).not.toBeNull()
      releaseLock(lockPath)
    })
  })

  describe("rollback", () => {
    it("returns false for invalid SHA (non-existent commit)", async () => {
      const result = await rollback(getInstallDir(), "0".repeat(40))
      expect(result).toBe(false)
    })
  })

  describe("runUpdate", () => {
    it("throws UpdaterError for invalid tag format", async () => {
      await expect(runUpdate("not-a-version")).rejects.toThrow(UpdaterError)
      await expect(runUpdate("not-a-version")).rejects.toThrow("Invalid target tag")
    })

    it("throws UpdaterError for empty string tag", async () => {
      await expect(runUpdate("")).rejects.toThrow(UpdaterError)
    })

    it("rejects tags with extra metadata like prerelease suffix without validation", async () => {
      // "1.0.0-beta" is not valid per our strict semver regex (SEMVER_RE)
      await expect(runUpdate("1.0.0-beta")).rejects.toThrow(UpdaterError)
    })
  })
})
