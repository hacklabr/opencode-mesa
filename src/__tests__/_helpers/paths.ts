import { join } from "node:path"
import { buildSessionFolderPath, type SessionFolderInput } from "../../utils/paths.js"

export function testSessionInput(
  slug = "test-session",
  sessionId = "ses_test1234abcd",
  createdAt = "2026-07-13T15:34:00.000Z"
): SessionFolderInput {
  return { slug, sessionId, createdAt }
}

export function testSessionFolder(
  testDir: string,
  input?: Partial<SessionFolderInput>
): string {
  const fullInput = { ...testSessionInput(), ...input }
  return join(testDir, buildSessionFolderPath(fullInput))
}

export function testBriefingPath(
  testDir: string,
  input?: Partial<SessionFolderInput>
): string {
  return join(testSessionFolder(testDir, input), "briefing.md")
}

export function testSpecificationPath(
  testDir: string,
  input?: Partial<SessionFolderInput>
): string {
  return join(testSessionFolder(testDir, input), "specification.md")
}

export function testOverviewPath(
  testDir: string,
  input?: Partial<SessionFolderInput>
): string {
  return join(testSessionFolder(testDir, input), "overview.md")
}
