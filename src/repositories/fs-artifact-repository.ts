import { promises as fs } from "node:fs"
import { dirname } from "node:path"
import type { ArtifactRepository } from "./artifact-repository"

export class FsArtifactRepository implements ArtifactRepository {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8")
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf-8")
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true })
  }

  async listFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  }
}
