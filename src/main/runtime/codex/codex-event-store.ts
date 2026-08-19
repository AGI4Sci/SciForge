import type { CodexThreadEventPayload } from './codex-runtime-api'
import {
  isAgentRuntimeChildActive,
  type AgentRuntimeChild
} from '../../../shared/agent-runtime-contract'
import { AGENT_RUNTIME_RECENT_CHILD_LIMIT } from '../agent-runtime/bounded-child-history'
import { AppDataJsonlStore } from '../../services/app-data-store'
import {
  decodeToolArtifactRef,
  readLatestJsonlThreadRecord,
  readJsonlThreadPage,
  readJsonlThreadRecordsSince
} from '../agent-runtime/jsonl-thread-page'

export type CodexStoredEvent = {
  seq: number
  threadId: string
  createdAt: string
  event: CodexThreadEventPayload
}

export type CodexEventStoreOptions = {
  rootDir: string
  now?: () => Date
}

export class CodexEventStore {
  private readonly rootDir: string
  private readonly now: () => Date
  private readonly threadQueues = new Map<string, Promise<void>>()
  private readonly jsonlStores = new Map<string, AppDataJsonlStore>()
  private readonly latestSeqByThread = new Map<string, number>()

  constructor(options: CodexEventStoreOptions) {
    this.rootDir = options.rootDir
    this.now = options.now ?? (() => new Date())
  }

  async append(threadId: string, event: CodexThreadEventPayload): Promise<CodexStoredEvent> {
    const normalizedThreadId = nonEmpty(threadId || event.threadId, 'Codex thread id is required.')
    return this.enqueueForThread(normalizedThreadId, async () => this.appendNow(normalizedThreadId, event))
  }

  private async appendNow(threadId: string, event: CodexThreadEventPayload): Promise<CodexStoredEvent> {
    const seq = await this.nextSeq(threadId)
    const createdAt = this.now().toISOString()
    const stored: CodexStoredEvent = {
      seq,
      threadId,
      createdAt,
      event: {
        ...event,
        threadId,
        seq,
        // The Host-owned event-store timestamp is the authoritative durable
        // occurrence time for lifecycle replay. Keep it inside the replayed
        // payload as well as the outer journal envelope so subscribers cannot
        // accidentally discard it when reading only `event`.
        createdAt
      }
    }
    await this.jsonlForThread(threadId).appendJson([stored])
    this.latestSeqByThread.set(threadId, seq)
    return stored
  }

  async read(
    threadId: string,
    options: { sinceSeq?: number; includeAll?: boolean } = {}
  ): Promise<CodexStoredEvent[]> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return []
    const events = await readJsonlThreadRecordsSince({
      store: this.jsonlForThread(normalizedThreadId),
      threadId: normalizedThreadId,
      sinceSeq: options.sinceSeq,
      includeAll: options.includeAll,
      parse: parseStoredEvent
    })
    this.noteLatestSeq(normalizedThreadId, events)
    return events
  }

  async readPage(
    threadId: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<{ events: CodexStoredEvent[]; nextCursor: string | null }> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return { events: [], nextCursor: null }
    const page = await readJsonlThreadPage({
      store: this.jsonlForThread(normalizedThreadId),
      threadId: normalizedThreadId,
      cursor: options.cursor,
      limit: options.limit,
      parse: parseStoredEvent,
      turnId: ({ event }) => event.turnId || event.userMessage?.turnId
    })
    this.noteLatestSeq(normalizedThreadId, page.records)
    return { events: page.records, nextCursor: page.nextCursor }
  }

  async readToolArtifact(threadId: string, ref: string): Promise<string | null> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return null
    const itemId = decodeToolArtifactRef(ref)
    let content: string | null = null
    try {
      await this.jsonlForThread(normalizedThreadId).readLinesReverse((line) => {
        const stored = parseStoredEvent(line.trim())
        if (stored?.threadId !== normalizedThreadId) return
        if (stored.event.tool?.itemId === itemId) {
          const tool = stored.event.tool
          const candidate = tool.detail ?? tool.meta?.structuredContent ?? tool.meta?.output ?? tool.meta?.result
          if (candidate === undefined) return
          content = typeof candidate === 'string' ? candidate : safeArtifactJson(candidate)
          return false
        }
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return content
  }

  async findLatestChild(threadId: string, childId: string): Promise<AgentRuntimeChild | null> {
    const normalizedThreadId = threadId.trim()
    const normalizedChildId = childId.trim()
    if (!normalizedThreadId || !normalizedChildId) return null
    let child: AgentRuntimeChild | null = null
    try {
      await this.jsonlForThread(normalizedThreadId).readLinesReverse((line) => {
        const stored = parseStoredEvent(line.trim())
        if (stored?.threadId !== normalizedThreadId || stored.event.child?.id !== normalizedChildId) return
        child = stored.event.child.metadata?.lifecycleOperation === 'delete' ? null : stored.event.child
        return false
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return child
  }

  async readLatestChildren(
    threadId: string,
    terminalLimit = AGENT_RUNTIME_RECENT_CHILD_LIMIT
  ): Promise<AgentRuntimeChild[]> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return []
    const seen = new Set<string>()
    const active: AgentRuntimeChild[] = []
    const terminal: AgentRuntimeChild[] = []
    try {
      await this.jsonlForThread(normalizedThreadId).readLinesReverse((line) => {
        const stored = parseStoredEvent(line.trim())
        const child = stored?.threadId === normalizedThreadId ? stored.event.child : undefined
        if (!child || seen.has(child.id)) return
        seen.add(child.id)
        if (child.metadata?.lifecycleOperation === 'delete') return
        if (isAgentRuntimeChildActive(child)) active.push(child)
        else if (terminal.length < terminalLimit) terminal.push(child)
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return [...active, ...terminal]
  }

  async latestSeq(threadId: string): Promise<number> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return 0
    const cached = this.latestSeqByThread.get(normalizedThreadId)
    if (cached !== undefined) return cached
    const latest = (await readLatestJsonlThreadRecord({
      store: this.jsonlForThread(normalizedThreadId),
      threadId: normalizedThreadId,
      parse: parseStoredEvent
    }))?.seq ?? 0
    this.latestSeqByThread.set(normalizedThreadId, latest)
    return latest
  }

  private async nextSeq(threadId: string): Promise<number> {
    return (await this.latestSeq(threadId)) + 1
  }

  private noteLatestSeq(threadId: string, events: readonly CodexStoredEvent[]): void {
    if (!events.length) return
    const latest = Math.max(0, ...events.map((event) => event.seq))
    const cached = this.latestSeqByThread.get(threadId) ?? 0
    if (latest > cached) this.latestSeqByThread.set(threadId, latest)
  }

  private jsonlForThread(threadId: string): AppDataJsonlStore {
    const storeKey = safeSegment(threadId)
    const existing = this.jsonlStores.get(storeKey)
    if (existing) return existing
    const created = new AppDataJsonlStore({
      rootDir: this.rootDir,
      segments: ['events', `${storeKey}.jsonl`]
    })
    this.jsonlStores.set(storeKey, created)
    return created
  }

  private enqueueForThread<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadQueues.get(threadId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const next = run.then(() => undefined, () => undefined)
    this.threadQueues.set(threadId, next)
    void next.then(() => {
      if (this.threadQueues.get(threadId) === next) this.threadQueues.delete(threadId)
    })
    return run
  }
}

function safeArtifactJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseStoredEvent(line: string): CodexStoredEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const event = normalizeEvent(record.event)
  const threadId = stringValue(record.threadId) || event?.threadId || ''
  const seq = numberValue(record.seq)
  if (!event || !threadId || seq <= 0) return null
  const createdAt = stringValue(record.createdAt) || new Date(0).toISOString()
  return {
    seq,
    threadId,
    createdAt,
    event: {
      ...event,
      threadId,
      seq,
      // Migrate older JSONL records whose Host timestamp lived only on the
      // outer envelope. Event replay must preserve that durable occurrence
      // time without inventing a new clock value.
      createdAt
    }
  }
}

function normalizeEvent(raw: unknown): CodexThreadEventPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const threadId = stringValue(record.threadId)
  if (!threadId) return null
  return record as CodexThreadEventPayload
}

function safeSegment(value: string): string {
  const trimmed = value.trim()
  const encoded = Buffer.from(trimmed, 'utf8').toString('base64url')
  return encoded || 'thread'
}

function nonEmpty(value: string, message: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
}
