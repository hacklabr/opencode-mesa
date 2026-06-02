export interface SemVer {
  major: number
  minor: number
  patch: number
}

export interface GitHubTag {
  name: string
  commit: {
    sha: string
  }
}

export interface UpdateCache {
  latestVersion: string
  latestSha: string
  checkedAt: string
  etag: string | null
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  checkedAt: string
  cacheHit: boolean
}

export interface UpdateResult {
  success: boolean
  previousVersion: string
  newVersion: string
  message: string
}
