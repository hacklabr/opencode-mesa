import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  openSync,
  writeSync,
  mkdirSync,
  appendFileSync,
  existsSync,
  readFileSync,
} from "node:fs"
import { execSync, spawn as nodeSpawn, type ChildProcess } from "node:child_process"
import type { UpdateResult } from "./types"
import { assertSemver } from "./semver"
import { UpdaterError } from "../errors"

const REPO_URL = "https://github.com/hacklabr/opencode-mesa"
const UPDATE_TIMEOUT_MS = 120_000
const LOCK_FILENAME = "update.lock"
const PRE_UPDATE_SHA_FILENAME = "pre-update-sha"
const UPDATE_LOG_FILENAME = "update-log.jsonl"

const __dirname = dirname(fileURLToPath(import.meta.url))

export function getInstallDir(): string {
  // dist/updater/runner.js -> dist/updater -> dist -> project root
  return join(__dirname, "..", "..")
}

export async function getGitSha(installDir: string): Promise<string> {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: installDir,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim()
    return sha
  } catch (err) {
    throw new UpdaterError(
      `Failed to get current git SHA: ${err instanceof Error ? err.message : String(err)}`,
      "GIT_SHA_FAILED",
    )
  }
}

// Sentinel value returned when lock acquisition fails
const LOCK_FAILED = -1

// Global map of lock path -> background holder process
const lockHolders = new Map<string, ChildProcess>()

export function acquireLock(lockPath: string): number | null {
  // Check if a stale lock file exists with a dead process
  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, "utf-8").trim()
      const pid = parseInt(content, 10)
      if (!isNaN(pid) && pid > 0) {
        // Check if the process is still alive
        try {
          process.kill(pid, 0) // Throws if process doesn't exist
          // Process is alive — lock is held
          return null
        } catch {
          // Process is dead — stale lock, remove it
        }
      }
    } catch {
      // Can't read lock file — try to acquire anyway
    }
  }

  // Spawn a background process that holds flock on the file.
  // The process sleeps indefinitely while holding the lock.
  // When we kill it, flock is released automatically on process exit.
  let holder: ChildProcess
  try {
    holder = nodeSpawn(
      "bash",
      [
        "-c",
        `exec 9>"${lockPath}" && flock -n 9 || exit 1 && echo $$ >&9 && exec sleep infinity`,
      ],
      { stdio: "ignore", detached: true },
    )
  } catch {
    return null
  }

  // Wait briefly for the holder to either succeed or fail
  let resolved = false
  let exitCode: number | null = null

  holder.on("exit", (code) => {
    exitCode = code
    resolved = true
  })

  // Give it 500ms to acquire the lock
  const deadline = Date.now() + 500
  while (!resolved && Date.now() < deadline) {
    // Busy-wait with small yield
  }

  if (exitCode !== null && exitCode !== 0) {
    // Holder exited immediately — lock is held by someone else
    return null
  }

  if (!resolved) {
    // Holder is still running — lock acquired successfully
    lockHolders.set(lockPath, holder)
    return holder.pid ?? LOCK_FAILED
  }

  // Holder exited with 0 — shouldn't happen but handle it
  return null
}

export function releaseLock(lockPathOrFd: number | string): void {
  // Accept either the lock path (string) or a numeric handle
  const lockPath = typeof lockPathOrFd === "string" ? lockPathOrFd : null

  if (lockPath) {
    const holder = lockHolders.get(lockPath)
    if (holder) {
      try {
        holder.kill("SIGTERM")
      } catch {
        // Process already dead
      }
      lockHolders.delete(lockPath)
    }
  }
}

interface LogEntry {
  timestamp: string
  event: string
  tag?: string
  success?: boolean
  message?: string
  previousSha?: string
}

function writeUpdateLog(cacheDir: string, entry: LogEntry): void {
  const logPath = join(cacheDir, UPDATE_LOG_FILENAME)
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8")
}

function ensureCacheDir(installDir: string): string {
  const cacheDir = join(installDir, ".cache")
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

export async function rollback(installDir: string, previousSha: string): Promise<boolean> {
  try {
    execSync(`git checkout ${previousSha}`, {
      cwd: installDir,
      encoding: "utf-8",
      timeout: 30_000,
    })
    return true
  } catch {
    return false
  }
}

// Bun subprocess interface — dynamic to avoid compile-time type errors in Node
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BunSubprocess = any

function spawnInstallBun(
  args: string[],
  installDir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bunGlobal: any,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc: BunSubprocess = bunGlobal.spawn({
      cmd: ["bash", ...args],
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    const readStream = (stream: unknown): string => {
      if (stream && typeof stream === "object" && "read" in stream) {
        const buf = (stream as { read: () => Buffer | null }).read()
        return buf ? buf.toString("utf-8") : ""
      }
      return ""
    }

    void (async () => {
      try {
        const code = await proc.exitCode
        const stdout = readStream(proc.stdout)
        const stderr = readStream(proc.stderr)
        resolve({ exitCode: code ?? 1, stdout, stderr })
      } catch {
        resolve({ exitCode: 1, stdout: "", stderr: "Bun.spawn failed" })
      }
    })()
  })
}

function spawnInstallNode(
  args: string[],
  installDir: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const child = nodeSpawn("bash", args, {
      cwd: installDir,
      shell: false,
      timeout: UPDATE_TIMEOUT_MS,
    })

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8")
    })

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8")
    })

    child.on("close", (code: number | null) => {
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })

    child.on("error", (err: Error) => {
      resolve({ exitCode: 1, stdout, stderr: err.message })
    })
  })
}

function spawnInstall(
  targetTag: string,
  installDir: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = ["install.sh", "--tag", targetTag, REPO_URL, installDir]

  // Detect Bun at runtime — avoid referencing Bun global at compile time
  const bunGlobal = (globalThis as Record<string, unknown>)["Bun"]
  if (typeof bunGlobal === "object" && bunGlobal !== null && "spawn" in bunGlobal) {
    return spawnInstallBun(args, installDir, bunGlobal)
  }

  return spawnInstallNode(args, installDir)
}

export async function runUpdate(targetTag: string): Promise<UpdateResult> {
  // 1. Validate tag
  try {
    assertSemver(targetTag)
  } catch {
    throw new UpdaterError(
      `Invalid target tag: "${targetTag}". Only semver tags (X.Y.Z) are accepted.`,
      "INVALID_TAG",
    )
  }

  const installDir = getInstallDir()
  const cacheDir = ensureCacheDir(installDir)

  // 2. Record pre-update SHA
  let preSha: string
  try {
    preSha = await getGitSha(installDir)
  } catch (err) {
    throw new UpdaterError(
      `Cannot determine current version (git SHA): ${err instanceof Error ? err.message : String(err)}`,
      "PRE_SHA_FAILED",
    )
  }

  // 3. Write pre-update SHA to cache
  const shaPath = join(cacheDir, PRE_UPDATE_SHA_FILENAME)
  writeSync(openSync(shaPath, "w"), preSha)

  // 4. Acquire lock
  const lockPath = join(cacheDir, LOCK_FILENAME)
  const lockFd = acquireLock(lockPath)
  if (lockFd === null) {
    throw new UpdaterError(
      "Another update is already in progress. Please wait and try again.",
      "LOCK_FAILED",
    )
  }

  writeUpdateLog(cacheDir, {
    timestamp: new Date().toISOString(),
    event: "update_started",
    tag: targetTag,
    previousSha: preSha,
  })

  try {
    // 5. Spawn install.sh
    const { exitCode, stdout, stderr } = await spawnInstall(targetTag, installDir)

    if (exitCode !== 0) {
      // Attempt rollback
      writeUpdateLog(cacheDir, {
        timestamp: new Date().toISOString(),
        event: "install_failed",
        tag: targetTag,
        success: false,
        message: `exit=${exitCode} stderr=${stderr.slice(0, 500)}`,
      })

      const rolledBack = await rollback(installDir, preSha)
      const rollbackMsg = rolledBack
        ? "Rolled back to previous version."
        : "Rollback failed — manual recovery may be needed."

      return {
        success: false,
        previousVersion: preSha.slice(0, 7),
        newVersion: targetTag,
        message: `Update to v${targetTag} failed (exit ${exitCode}). ${rollbackMsg}`,
      }
    }

    // Success
    const newSha = await getGitSha(installDir)
    writeUpdateLog(cacheDir, {
      timestamp: new Date().toISOString(),
      event: "update_completed",
      tag: targetTag,
      success: true,
      previousSha: preSha,
      message: `Updated ${preSha.slice(0, 7)} -> ${newSha.slice(0, 7)}`,
    })

    return {
      success: true,
      previousVersion: preSha.slice(0, 7),
      newVersion: targetTag,
      message: `Successfully updated to v${targetTag}. Please restart opencode to load the new version.`,
    }
  } catch (err) {
    writeUpdateLog(cacheDir, {
      timestamp: new Date().toISOString(),
      event: "update_error",
      tag: targetTag,
      success: false,
      message: err instanceof Error ? err.message : String(err),
    })

    await rollback(installDir, preSha)

    return {
      success: false,
      previousVersion: preSha.slice(0, 7),
      newVersion: targetTag,
      message: `Update to v${targetTag} failed with unexpected error. Rolled back to previous version.`,
    }
  } finally {
    releaseLock(lockPath)
  }
}
