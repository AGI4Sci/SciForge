import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'

/**
 * Lists PDF file names inside a workspace.
 *
 * Only directory entries and file sizes are read: a PDF is never opened, copied
 * or parsed, so a copyrighted PDF stays where the user put it. Symbolic links
 * are never followed, hidden directories and dependency trees are skipped, and
 * the walk is bounded in both depth and entry count.
 */

export const MAX_PDF_SCAN_ENTRIES = 20_000
export const MAX_PDF_FILES = 500
export const PDF_SCAN_DEPTH = 3

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'out', 'build', 'target', '.venv', 'venv', '__pycache__'
])

export type WorkspacePdfFile = Readonly<{ path: string; sizeBytes: number }>

export type WorkspacePdfScan = Readonly<{
  files: readonly WorkspacePdfFile[]
  scannedEntries: number
  scannedDirectories: number
  /** True when a bound stopped the walk before every entry was visited. */
  truncated: boolean
  truncatedReasons: readonly string[]
}>

export async function listWorkspacePdfs(
  workspaceRoot: string,
  options: Readonly<{ maxDepth?: number; maxFiles?: number; signal?: AbortSignal }> = {}
): Promise<WorkspacePdfScan> {
  const maxDepth = options.maxDepth ?? PDF_SCAN_DEPTH
  const maxFiles = options.maxFiles ?? MAX_PDF_FILES
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 12) throw new Error('Invalid PDF scan depth.')
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_PDF_FILES) throw new Error('Invalid PDF file limit.')

  const root = await realpath(resolve(workspaceRoot))
  const files: WorkspacePdfFile[] = []
  const truncatedReasons: string[] = []
  let scannedEntries = 0
  let scannedDirectories = 0

  const walk = async (directory: string, depth: number): Promise<void> => {
    options.signal?.throwIfAborted()
    scannedDirectories += 1
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      options.signal?.throwIfAborted()
      scannedEntries += 1
      if (scannedEntries > MAX_PDF_SCAN_ENTRIES) {
        truncatedReasons.push(`Stopped after ${MAX_PDF_SCAN_ENTRIES} entries.`)
        return
      }
      if (entry.isSymbolicLink()) continue
      const absolute = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (depth >= maxDepth) {
          if (!entry.name.startsWith('.')) truncatedReasons.push(`Stopped descending at depth ${maxDepth}.`)
          continue
        }
        if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue
      if (files.length >= maxFiles) {
        truncatedReasons.push(`Stopped after ${maxFiles} PDF files.`)
        return
      }
      const info = await lstat(absolute)
      if (!info.isFile()) continue
      files.push({ path: toWorkspaceRelative(root, absolute), sizeBytes: info.size })
    }
  }

  await walk(root, 0)
  files.sort((left, right) => left.path.localeCompare(right.path))
  return {
    files,
    scannedEntries,
    scannedDirectories,
    truncated: truncatedReasons.length > 0,
    truncatedReasons: [...new Set(truncatedReasons)]
  }
}

function toWorkspaceRelative(root: string, absolute: string): string {
  if (isAbsolute(absolute) && win32.isAbsolute(absolute) === win32.isAbsolute(root)) {
    const value = relative(root, absolute)
    if (value && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)) {
      return value.split(sep).join('/')
    }
  }
  throw new Error('The file is outside the workspace.')
}
