import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  access,
} from "node:fs/promises"
import { constants } from "node:fs"

import type { UpdateCache, UpdateCheckResult, GitHubTag } from "./types"
import { parseSemver, isNewerVersion, assertSemver, SEMVER_RE } from "./semver"
import { PLUGIN_VERSION } from "../config"

const __dirname = dirname(fileURLToPath(import.meta.url))

const GITHUB_TAGS_URL = "https://api.github.com/repos/hacklabr/opencode-mesa/tags"
const FETCH_TIMEOUT_MS = 5_000
const CACHE_TTL_MS = 900_000

export function getCachePath(): string {
  // Compiled to dist/updater/checker.js → go up two levels to project root
  const installDir = join(__dirname, "..", "..")
  return join(installDir, ".cache", "update-check.json")
}

export async function readCache(): Promise<UpdateCache | null> {
  try {
    const raw = await readFile(getCachePath(), "utf-8")
    const data = JSON.parse(raw) as Record<string, unknown>

    if (
      typeof data.latestVersion !== "string" ||
      typeof data.latestSha !== "string" ||
      typeof data.checkedAt !== "string" ||
      (data.etag !== null && typeof data.etag !== "string")
    ) {
      return null
    }

    return {
      latestVersion: data.latestVersion,
      latestSha: data.latestSha,
      checkedAt: data.checkedAt,
      etag: data.etag as string | null,
    }
  } catch {
    return null
  }
}

export async function writeCache(cache: UpdateCache): Promise<void> {
  const cachePath = getCachePath()
  const cacheDir = dirname(cachePath)
  const tmpPath = cachePath + ".tmp"

  try {
    await mkdir(cacheDir, { recursive: true })

    const content = JSON.stringify(cache, null, 2)
    await writeFile(tmpPath, content, { mode: 0o600 })
    await rename(tmpPath, cachePath)
  } catch {
    // Silently fail — cache write is non-critical
    try {
      await access(tmpPath, constants.F_OK).then(
        () => import("node:fs/promises").then((fs) => fs.unlink(tmpPath)),
        () => {},
      )
    } catch {
      // Best-effort cleanup
    }
  }
}

export async function fetchLatestTag(
  cachedEtag?: string | null,
): Promise<{ tag: GitHubTag; etag: string | null } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const headers: Record<string, string> = {
      "User-Agent": `opencode-mesa/${PLUGIN_VERSION}`,
      Accept: "application/vnd.github+json",
    }

    if (cachedEtag) {
      headers["If-None-Match"] = cachedEtag
    }

    let response: Response
    try {
      response = await fetch(`${GITHUB_TAGS_URL}?per_page=10`, {
        signal: controller.signal,
        headers,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (response.status === 304) {
      // Not modified — ETag match, no body to parse
      return null
    }

    if (!response.ok) {
      return null
    }

    const body: unknown = await response.json()

    if (!Array.isArray(body)) {
      return null
    }

    // Find first tag matching semver pattern
    for (const item of body) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string" &&
        SEMVER_RE.test((item as Record<string, unknown>).name as string)
      ) {
        const tag = item as GitHubTag
        const etag = response.headers.get("etag")
        return { tag, etag }
      }
    }

    return null
  } catch {
    return null
  }
}

export async function checkForUpdate(force = false): Promise<UpdateCheckResult> {
  const now = new Date().toISOString()

  try {
    assertSemver(PLUGIN_VERSION)
  } catch {
    return {
      currentVersion: PLUGIN_VERSION,
      latestVersion: PLUGIN_VERSION,
      hasUpdate: false,
      checkedAt: now,
      cacheHit: false,
    }
  }

  // Try reading from cache (skip if force=true)
  let cached: UpdateCache | null = null
  if (!force) {
    cached = await readCache()
    if (cached) {
      const age = Date.now() - new Date(cached.checkedAt).getTime()
      if (age < CACHE_TTL_MS) {
        try {
          assertSemver(cached.latestVersion)
        } catch {
          // Corrupted cache — fall through to fresh check
        }

        return {
          currentVersion: PLUGIN_VERSION,
          latestVersion: cached.latestVersion,
          hasUpdate: isNewerVersion(PLUGIN_VERSION, cached.latestVersion),
          checkedAt: cached.checkedAt,
          cacheHit: true,
        }
      }
    }
  }

  // Fetch fresh data
  const result = await fetchLatestTag(cached?.etag ?? null)

  if (!result) {
    // No new data — serve stale cache if available
    if (cached) {
      try {
        assertSemver(cached.latestVersion)
        return {
          currentVersion: PLUGIN_VERSION,
          latestVersion: cached.latestVersion,
          hasUpdate: isNewerVersion(PLUGIN_VERSION, cached.latestVersion),
          checkedAt: cached.checkedAt,
          cacheHit: true,
        }
      } catch {
        // Fall through to "no data" result
      }
    }

    return {
      currentVersion: PLUGIN_VERSION,
      latestVersion: PLUGIN_VERSION,
      hasUpdate: false,
      checkedAt: now,
      cacheHit: false,
    }
  }

  const { tag, etag } = result
  const latestVersion = tag.name.startsWith("v") ? tag.name.slice(1) : tag.name

  try {
    assertSemver(latestVersion)
  } catch {
    return {
      currentVersion: PLUGIN_VERSION,
      latestVersion: PLUGIN_VERSION,
      hasUpdate: false,
      checkedAt: now,
      cacheHit: false,
    }
  }

  const hasUpdate = isNewerVersion(PLUGIN_VERSION, latestVersion)

  const newCache: UpdateCache = {
    latestVersion,
    latestSha: tag.commit.sha,
    checkedAt: now,
    etag,
  }

  await writeCache(newCache)

  return {
    currentVersion: PLUGIN_VERSION,
    latestVersion,
    hasUpdate,
    checkedAt: now,
    cacheHit: false,
  }
}
