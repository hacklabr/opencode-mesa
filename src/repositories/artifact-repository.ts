export interface ArtifactRepository {
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  fileExists(filePath: string): Promise<boolean>
  ensureDirectory(dirPath: string): Promise<void>
  listFiles(directory: string): Promise<string[]>
}
