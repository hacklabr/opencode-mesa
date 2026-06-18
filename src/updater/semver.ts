import type { SemVer } from "./types.js"

export const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

export function parseSemver(tag: string): SemVer | null {
  const match = tag.match(SEMVER_RE)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
  return 0
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const cur = parseSemver(current)
  const cand = parseSemver(candidate)
  if (!cur || !cand) return false
  return compareSemver(cand, cur) > 0
}

export function assertSemver(v: string): void {
  if (!parseSemver(v)) {
    throw new Error(`Invalid semver: "${v}". Expected format: X.Y.Z`)
  }
}
