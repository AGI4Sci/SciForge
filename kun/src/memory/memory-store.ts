import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryTaskType,
  type MemoryThreadMode,
  type MemoryUpdateRequest
} from '../contracts/memory.js'

export type MemoryScopeFilter = {
  workspace?: string
  project?: string
  threadMode?: MemoryThreadMode
  taskType?: MemoryTaskType
}

export type MemoryListFilter = MemoryScopeFilter & {
  includeDeleted?: boolean
}

export type MemoryRetrieveInput = MemoryScopeFilter & {
  query: string
  limit: number
}

export interface MemoryStore {
  create(input: MemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord>
  delete(id: string): Promise<MemoryRecord>
  list(filter?: MemoryListFilter): Promise<MemoryRecord[]>
  retrieve(input: MemoryRetrieveInput): Promise<MemoryRecord[]>
  diagnostics(): Promise<MemoryDiagnostics>
  setLastInjected(ids: string[]): void
}

export class FileMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []

  constructor(
    private readonly options: {
      rootDir: string
      config: MemoryCapabilityConfig
      nowIso?: () => string
      idGenerator?: () => string
    }
  ) {}

  async create(input: MemoryCreateRequest): Promise<MemoryRecord> {
    await mkdir(this.options.rootDir, { recursive: true })
    const now = this.now()
    const parsed = MemoryRecord.parse({
      id: this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      content: input.content,
      scope: input.scope ?? 'workspace',
      workspace: input.workspace,
      project: input.project ?? (input.scope === 'project' ? input.workspace : undefined),
      threadMode: input.threadMode,
      taskType: input.taskType,
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 1,
      createdAt: now,
      updatedAt: now
    })
    await this.write(parsed)
    return parsed
  }

  async update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord> {
    const current = await this.mustGet(id)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.disabled === true ? { disabledAt: current.disabledAt ?? now } : {}),
      ...(patch.disabled === false ? { disabledAt: undefined } : {}),
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async delete(id: string): Promise<MemoryRecord> {
    const current = await this.mustGet(id)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      deletedAt: current.deletedAt ?? now,
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    const records = await this.readAll()
    return records
      .filter((record) => filter.includeDeleted || !record.deletedAt)
      .filter((record) => inScope(record, filter))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async retrieve(input: MemoryRetrieveInput): Promise<MemoryRecord[]> {
    if (!this.options.config.enabled) return []
    const active = (await this.list({
      workspace: input.workspace,
      ...(input.project ? { project: input.project } : {}),
      ...(input.threadMode ? { threadMode: input.threadMode } : {}),
      ...(input.taskType ? { taskType: input.taskType } : {})
    }))
      .filter((record) => !record.disabledAt)
    return active
      .map((record) => ({ record, score: scoreMemory(record, input.query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, input.limit)
      .map((entry) => entry.record)
  }

  async diagnostics(): Promise<MemoryDiagnostics> {
    const records = await this.readAll()
    return {
      enabled: this.options.config.enabled,
      rootDir: this.options.rootDir,
      activeCount: records.filter((record) => !record.deletedAt && !record.disabledAt).length,
      tombstoneCount: records.filter((record) => Boolean(record.deletedAt)).length,
      lastInjectedIds: [...this.lastInjectedIds]
    }
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }

  private async mustGet(id: string): Promise<MemoryRecord> {
    const record = (await this.readAll()).find((candidate) => candidate.id === id)
    if (!record) throw new Error(`memory not found: ${id}`)
    return record
  }

  private async readAll(): Promise<MemoryRecord[]> {
    await mkdir(this.options.rootDir, { recursive: true })
    const entries = await readdir(this.options.rootDir).catch(() => [])
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readFile(join(this.options.rootDir, entry), 'utf8')
        .then((text) => MemoryRecord.parse(JSON.parse(text)))
        .catch(() => null)))
    return records.filter((record): record is MemoryRecord => Boolean(record))
  }

  private write(record: MemoryRecord): Promise<void> {
    return atomicWriteFile(
      join(this.options.rootDir, `${record.id}.json`),
      JSON.stringify(record, null, 2)
    )
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function inScope(record: MemoryRecord, filter: MemoryScopeFilter): boolean {
  if (!matchesTurnContext(record, filter)) return false
  if (record.scope === 'user') return true
  if (record.scope === 'workspace') return Boolean(filter.workspace && record.workspace === filter.workspace)
  return Boolean(filter.project && record.project === filter.project)
}

function matchesTurnContext(record: MemoryRecord, filter: MemoryScopeFilter): boolean {
  if (record.threadMode && record.threadMode !== filter.threadMode) return false
  if (record.taskType && record.taskType !== filter.taskType) return false
  return true
}

function scoreMemory(record: MemoryRecord, query: string): number {
  const words = new Set(query.toLowerCase().split(/[^a-z0-9_]+/).filter((word) => word.length > 2))
  let score = 0
  const text = `${record.content} ${record.tags.join(' ')}`.toLowerCase()
  for (const word of words) {
    if (text.includes(word)) score += 1
  }
  return score * record.confidence
}
