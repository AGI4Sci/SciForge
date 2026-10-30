import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'
import { AppDataJsonlStore } from '../../services/app-data-store'

export type ClaudeCodeSessionTranscript = {
  key: SessionKey
  path: string
  entries: SessionStoreEntry[]
}

export class ClaudeCodeSessionStore implements SessionStore {
  private readonly rootDir: string
  private readonly jsonlStores = new Map<string, AppDataJsonlStore>()

  constructor(options: { rootDir: string }) {
    this.rootDir = options.rootDir
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return
    await this.jsonlForKey(key).appendJson(entries)
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    try {
      return parseJsonl(await this.jsonlForKey(key).readText())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
    const projectDir = this.projectDir(projectKey)
    try {
      const entries = await readdir(projectDir, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => ({
          sessionId: entry.name.slice(0, -'.jsonl'.length),
          mtime: 0
        }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const sessionDir = this.sessionDir(key.projectKey, key.sessionId)
    try {
      const files = await collectJsonlFiles(sessionDir)
      return files
        .map((filePath) => relative(sessionDir, filePath).split(sep).join('/'))
        .filter((subpath) => subpath.endsWith('.jsonl'))
        .map((subpath) => subpath.slice(0, -'.jsonl'.length))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async readTranscript(input: {
    sessionId: string
    subpath?: string
    projectKey?: string
  }): Promise<ClaudeCodeSessionTranscript | null> {
    const sessionId = input.sessionId.trim()
    if (!sessionId) return null
    const candidates = input.projectKey
      ? [this.keyFromInput(input.projectKey, sessionId, input.subpath)]
      : await this.findKeysForSession(sessionId, input.subpath)
    for (const key of candidates) {
      const entries = await this.load(key)
      if (entries) {
        return {
          key,
          path: this.pathForKey(key),
          entries
        }
      }
    }
    return null
  }

  transcriptPath(input: {
    projectKey: string
    sessionId: string
    subpath?: string
  }): string {
    return this.pathForKey(this.keyFromInput(input.projectKey, input.sessionId, input.subpath))
  }

  private async findKeysForSession(sessionId: string, subpath?: string): Promise<SessionKey[]> {
    const projectsDir = join(this.rootDir, 'sdk-session-store', 'projects')
    let projects: string[]
    try {
      projects = (await readdir(projectsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => decodeFileSegment(entry.name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return projects.map((projectKey) => this.keyFromInput(projectKey, sessionId, subpath))
  }

  private keyFromInput(projectKey: string, sessionId: string, subpath?: string): SessionKey {
    return {
      projectKey,
      sessionId,
      ...(subpath?.trim() ? { subpath: normalizeSubpath(subpath) } : {})
    }
  }

  private pathForKey(key: SessionKey): string {
    const projectDir = join(this.rootDir, ...this.projectDirSegments(key.projectKey))
    if (!key.subpath) return join(projectDir, `${safeFileSegment(key.sessionId)}.jsonl`)
    return join(
      join(this.rootDir, ...this.sessionDirSegments(key.projectKey, key.sessionId)),
      `${normalizeSubpath(key.subpath).split('/').map(safeFileSegment).join(sep)}.jsonl`
    )
  }

  private projectDir(projectKey: string): string {
    return join(this.rootDir, ...this.projectDirSegments(projectKey))
  }

  private sessionDir(projectKey: string, sessionId: string): string {
    return join(this.rootDir, ...this.sessionDirSegments(projectKey, sessionId))
  }

  private jsonlForKey(key: SessionKey): AppDataJsonlStore {
    const segments = this.segmentsForKey(key)
    const storeKey = segments.join('\u0000')
    const existing = this.jsonlStores.get(storeKey)
    if (existing) return existing
    const created = new AppDataJsonlStore({
      rootDir: this.rootDir,
      segments
    })
    this.jsonlStores.set(storeKey, created)
    return created
  }

  private segmentsForKey(key: SessionKey): string[] {
    if (!key.subpath) {
      return [...this.projectDirSegments(key.projectKey), `${safeFileSegment(key.sessionId)}.jsonl`]
    }
    return [
      ...this.sessionDirSegments(key.projectKey, key.sessionId),
      ...normalizeSubpath(key.subpath).split('/').map(safeFileSegment).map((segment, index, segments) =>
        index === segments.length - 1 ? `${segment}.jsonl` : segment
      )
    ]
  }

  private projectDirSegments(projectKey: string): string[] {
    return ['sdk-session-store', 'projects', safeFileSegment(projectKey)]
  }

  private sessionDirSegments(projectKey: string, sessionId: string): string[] {
    return [...this.projectDirSegments(projectKey), safeFileSegment(sessionId)]
  }
}

function parseJsonl(raw: string): SessionStoreEntry[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionStoreEntry)
}

async function collectJsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const filePath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectJsonlFiles(filePath))
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(filePath)
    }
  }
  return files
}

function normalizeSubpath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
}

function safeFileSegment(value: string): string {
  return Buffer.from(value.trim() || 'empty', 'utf8').toString('base64url')
}

function decodeFileSegment(value: string): string {
  try {
    return Buffer.from(value, 'base64url').toString('utf8') || value
  } catch {
    return value
  }
}
