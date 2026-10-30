import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  relativeWorkspacePath,
  type ComposerFileReference
} from './composer-file-references'
import { withActiveWorkspaceLocator } from '../remote-workspace/placement'

export type WorkspaceFileIndexRecord = {
  files: ComposerFileReference[]
  loadedAt: number
}

const FILE_MENTION_MAX_DEPTH = 6
const FILE_MENTION_MAX_DIRECTORIES = 140
const FILE_MENTION_MAX_REFERENCES = 1200
const FILE_MENTION_CACHE_TTL_MS = 30_000
const FILE_MENTION_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
])
const FILE_MENTION_TEXT_EXTENSIONS = new Set([
  '.astro',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.dart',
  '.env',
  '.fish',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.lock',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.pdf',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])
const FILE_MENTION_TEXT_NAMES = new Set([
  '.env',
  '.gitignore',
  'dockerfile',
  'makefile',
  'package-lock.json',
  'pnpm-lock.yaml',
  'readme'
])
const workspaceFileIndexCache = new Map<string, WorkspaceFileIndexRecord | Promise<WorkspaceFileIndexRecord>>()

export function isMentionableWorkspaceEntry(entry: WorkspaceEntry): boolean {
  if (entry.type === 'directory') return !FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())
  const name = entry.name.toLowerCase()
  if (FILE_MENTION_TEXT_NAMES.has(name)) return true
  if (!entry.ext) return false
  return FILE_MENTION_TEXT_EXTENSIONS.has(entry.ext.toLowerCase())
}

export function fileReferenceFromWorkspaceEntry(
  entry: WorkspaceEntry,
  workspaceRoot: string
): ComposerFileReference {
  const relativePath = relativeWorkspacePath(entry.path, workspaceRoot)
  const kind = entry.type === 'directory'
    ? 'directory'
    : entry.ext.toLowerCase() === '.pdf'
      ? 'pdf'
      : 'file'
  return {
    path: relativePath,
    relativePath,
    name: entry.name,
    workspaceRoot,
    kind
  }
}

export async function loadWorkspaceFileIndex(workspaceRoot: string): Promise<WorkspaceFileIndexRecord> {
  const root = workspaceRoot.trim()
  const cached = workspaceFileIndexCache.get(root)
  const now = Date.now()
  if (cached && !(cached instanceof Promise) && now - cached.loadedAt < FILE_MENTION_CACHE_TTL_MS) {
    return cached
  }
  if (cached instanceof Promise) return cached

  const task = (async (): Promise<WorkspaceFileIndexRecord> => {
    const files: ComposerFileReference[] = []
    const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
    let visitedDirectories = 0

    while (
      queue.length > 0 &&
      visitedDirectories < FILE_MENTION_MAX_DIRECTORIES &&
      files.length < FILE_MENTION_MAX_REFERENCES
    ) {
      const current = queue.shift()
      if (!current) break
      visitedDirectories += 1
      const result = await window.sciforge.listWorkspaceDirectory(withActiveWorkspaceLocator({
        workspaceRoot: root,
        path: current.path
      }))
      if (!result.ok) continue

      for (const entry of result.entries) {
        if (!isMentionableWorkspaceEntry(entry)) continue
        if (entry.type === 'directory') {
          files.push(fileReferenceFromWorkspaceEntry(entry, root))
          if (current.depth < FILE_MENTION_MAX_DEPTH) {
            queue.push({ path: entry.path, depth: current.depth + 1 })
          }
        } else {
          files.push(fileReferenceFromWorkspaceEntry(entry, root))
        }
        if (files.length >= FILE_MENTION_MAX_REFERENCES) break
      }
    }

    return { files, loadedAt: Date.now() }
  })()

  workspaceFileIndexCache.set(root, task)
  try {
    const result = await task
    workspaceFileIndexCache.set(root, result)
    return result
  } catch (error) {
    workspaceFileIndexCache.delete(root)
    throw error
  }
}

export function clearWorkspaceFileIndexCacheForTests(): void {
  workspaceFileIndexCache.clear()
}
