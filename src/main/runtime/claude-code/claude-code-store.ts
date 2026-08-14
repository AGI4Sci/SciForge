import type {
  AgentRuntimeEvent,
  AgentRuntimeItem,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadStatus,
  AgentRuntimeThread,
  AgentRuntimeTurn
} from '../../../shared/agent-runtime-contract'
import {
  AppDataJsonlStore,
  atomicWriteAppDataJson,
  readAppDataStoreText
} from '../../services/app-data-store'
import {
  EXECUTION_INTEGRITY_POLICY_METADATA_KEY,
  EXECUTION_INTEGRITY_POLICY_VERSION,
  requiresExecutionIntegrityValidation
} from '../agent-runtime/execution-integrity-guard'
import {
  decodeToolArtifactRef,
  externalizeToolDetails,
  readLatestJsonlThreadRecord,
  readJsonlThreadPage,
  readJsonlThreadRecordsSince
} from '../agent-runtime/jsonl-thread-page'

export type ClaudeCodeStoredThread = {
  guiThreadId: string
  claudeSessionId: string
  runtimeId: 'claude'
  workspace: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  archived: boolean
  latestSeq: number
  latestTurnId?: string
  latestUserMessageId?: string
  latestTurnStatus?: AgentRuntimeTurn['status']
}

export type ClaudeCodeThreadStoreSnapshot = {
  version: 1
  threads: ClaudeCodeStoredThread[]
}

export class ClaudeCodeThreadStore {
  private readonly rootDir: string
  private transactionQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: { rootDir: string; now?: () => Date }) {
    this.rootDir = options.rootDir
  }

  async list(options: { includeArchived?: boolean } = {}): Promise<ClaudeCodeStoredThread[]> {
    const snapshot = await this.load()
    const threads = options.includeArchived
      ? snapshot.threads
      : snapshot.threads.filter((thread) => !thread.archived)
    return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  async get(guiThreadId: string): Promise<ClaudeCodeStoredThread | null> {
    const id = guiThreadId.trim()
    if (!id) return null
    const snapshot = await this.load()
    return snapshot.threads.find((thread) => thread.guiThreadId === id) ?? null
  }

  async upsert(input: {
    guiThreadId: string
    claudeSessionId?: string
    workspace?: string
    title?: string
    model?: string
    archived?: boolean
    latestSeq?: number
    latestTurnId?: string
    latestUserMessageId?: string
    latestTurnStatus?: AgentRuntimeTurn['status']
  }): Promise<ClaudeCodeStoredThread> {
    return this.enqueue(async () => this.upsertNow(input))
  }

  async delete(guiThreadId: string): Promise<void> {
    const id = guiThreadId.trim()
    if (!id) return
    return this.enqueue(async () => {
      const snapshot = await this.load()
      await this.save({
        version: 1,
        threads: snapshot.threads.filter((thread) => thread.guiThreadId !== id)
      })
    })
  }

  private async upsertNow(input: {
    guiThreadId: string
    claudeSessionId?: string
    workspace?: string
    title?: string
    model?: string
    archived?: boolean
    latestSeq?: number
    latestTurnId?: string
    latestUserMessageId?: string
    latestTurnStatus?: AgentRuntimeTurn['status']
  }): Promise<ClaudeCodeStoredThread> {
    const guiThreadId = input.guiThreadId.trim()
    if (!guiThreadId) throw new Error('Claude Code GUI thread id is required.')
    const snapshot = await this.load()
    const existingIndex = snapshot.threads.findIndex((thread) => thread.guiThreadId === guiThreadId)
    const existing = existingIndex >= 0 ? snapshot.threads[existingIndex] : null
    const now = (this.options.now ?? (() => new Date()))().toISOString()
    const next: ClaudeCodeStoredThread = {
      guiThreadId,
      claudeSessionId: nonEmpty(input.claudeSessionId, existing?.claudeSessionId ?? ''),
      runtimeId: 'claude',
      workspace: nonEmpty(input.workspace, existing?.workspace ?? ''),
      title: nonEmpty(input.title, existing?.title ?? 'Claude Code thread'),
      model: nonEmpty(input.model, existing?.model ?? ''),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archived: input.archived ?? existing?.archived ?? false,
      latestSeq: typeof input.latestSeq === 'number'
        ? Math.max(0, Math.floor(input.latestSeq))
        : existing?.latestSeq ?? 0,
      ...(input.latestTurnId !== undefined
        ? { latestTurnId: input.latestTurnId }
        : existing?.latestTurnId ? { latestTurnId: existing.latestTurnId } : {}),
      ...(input.latestUserMessageId !== undefined
        ? { latestUserMessageId: input.latestUserMessageId }
        : existing?.latestUserMessageId ? { latestUserMessageId: existing.latestUserMessageId } : {}),
      ...(input.latestTurnStatus !== undefined
        ? { latestTurnStatus: input.latestTurnStatus }
        : existing?.latestTurnStatus ? { latestTurnStatus: existing.latestTurnStatus } : {})
    }
    const threads = [...snapshot.threads]
    if (existingIndex >= 0) threads[existingIndex] = next
    else threads.push(next)
    await this.save({ version: 1, threads })
    return next
  }

  private async load(): Promise<ClaudeCodeThreadStoreSnapshot> {
    try {
      const raw = await readAppDataStoreText(this.rootDir, CLAUDE_CODE_THREADS_STORE)
      return normalizeThreadSnapshot(JSON.parse(raw) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyThreadSnapshot()
      throw error
    }
  }

  private async save(snapshot: ClaudeCodeThreadStoreSnapshot): Promise<void> {
    await atomicWriteAppDataJson(this.rootDir, CLAUDE_CODE_THREADS_STORE, normalizeThreadSnapshot(snapshot), {
      trailingNewline: true
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(task, task)
    this.transactionQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

const CLAUDE_CODE_THREADS_STORE = ['threads.json'] as const

export type ClaudeCodeStoredEvent = {
  seq: number
  threadId: string
  createdAt: string
  event: AgentRuntimeEvent
}

export class ClaudeCodeEventStore {
  private readonly rootDir: string
  private readonly now: () => Date
  private readonly threadQueues = new Map<string, Promise<void>>()
  private readonly jsonlStores = new Map<string, AppDataJsonlStore>()
  private readonly latestSeqByThread = new Map<string, number>()

  constructor(options: { rootDir: string; now?: () => Date }) {
    this.rootDir = options.rootDir
    this.now = options.now ?? (() => new Date())
  }

  async append(threadId: string, event: AgentRuntimeEvent): Promise<ClaudeCodeStoredEvent> {
    const normalizedThreadId = nonEmpty(threadId || event.threadId, 'Claude Code thread id is required.')
    return this.enqueueForThread(normalizedThreadId, async () => this.appendNow(normalizedThreadId, event))
  }

  async read(
    threadId: string,
    options: { sinceSeq?: number; includeAll?: boolean } = {}
  ): Promise<ClaudeCodeStoredEvent[]> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return []
    const events = await readJsonlThreadRecordsSince({
      store: this.jsonlForThread(normalizedThreadId),
      threadId: normalizedThreadId,
      sinceSeq: options.sinceSeq,
      includeAll: options.includeAll,
      parse: parseStoredEvent
    })
    if (events.length > 0) {
      const latest = events.at(-1)!.seq
      if (latest > (this.latestSeqByThread.get(normalizedThreadId) ?? 0)) {
        this.latestSeqByThread.set(normalizedThreadId, latest)
      }
    }
    return events
  }

  async readPage(
    threadId: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<{ events: ClaudeCodeStoredEvent[]; nextCursor: string | null }> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return { events: [], nextCursor: null }
    const page = await readJsonlThreadPage({
      store: this.jsonlForThread(normalizedThreadId),
      threadId: normalizedThreadId,
      cursor: options.cursor,
      limit: options.limit,
      parse: parseStoredEvent,
      turnId: ({ event }) => event.turnId
    })
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
        const event = stored.event
        if (event.kind === 'tool_event' && event.itemId === itemId) {
          const candidate = event.detail ?? event.receipt?.output ?? event.meta?.structuredContent ?? event.meta?.output ?? event.meta?.result
          if (candidate === undefined) return
          content = typeof candidate === 'string' ? candidate : safeArtifactJson(candidate)
          return false
        } else if (event.kind === 'item_snapshot' && event.item.id === itemId) {
          const candidate = event.item.detail ?? event.item.meta?.structuredContent ?? event.item.meta?.output ?? event.item.meta?.result
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

  async delete(threadId: string): Promise<void> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    await this.enqueueForThread(normalizedThreadId, async () => {
      const storeKey = safeSegment(normalizedThreadId)
      const store = this.jsonlStores.get(storeKey) ?? new AppDataJsonlStore({
        rootDir: this.rootDir,
        segments: ['events', `${storeKey}.jsonl`]
      })
      await store.delete()
      this.jsonlStores.delete(storeKey)
      this.latestSeqByThread.delete(normalizedThreadId)
    })
  }

  private async appendNow(threadId: string, event: AgentRuntimeEvent): Promise<ClaudeCodeStoredEvent> {
    const seq = (await this.latestSeq(threadId)) + 1
    const createdAt = event.createdAt || this.now().toISOString()
    const stored: ClaudeCodeStoredEvent = {
      seq,
      threadId,
      createdAt,
      event: {
        ...event,
        threadId,
        runtimeId: 'claude',
        seq,
        createdAt
      }
    }
    await this.jsonlForThread(threadId).appendJson([stored])
    this.latestSeqByThread.set(threadId, seq)
    return stored
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

export function storedThreadToRuntimeThread(thread: ClaudeCodeStoredThread): AgentRuntimeThread {
  return {
    id: thread.guiThreadId,
    runtimeId: 'claude',
    title: thread.title,
    updatedAt: thread.updatedAt,
    createdAt: thread.createdAt,
    model: thread.model || undefined,
    workspace: thread.workspace,
    archived: thread.archived,
    latestTurnId: thread.latestTurnId,
    latestTurnStatus: thread.latestTurnStatus,
    backendThreadId: thread.claudeSessionId || undefined,
    hasUserMessage: Boolean(thread.latestUserMessageId)
  }
}

export function storedThreadStatus(thread: ClaudeCodeStoredThread): AgentRuntimeThreadStatus {
  return {
    id: thread.guiThreadId,
    runtimeId: 'claude',
    status: thread.latestTurnStatus,
    latestSeq: thread.latestSeq,
    latestTurnId: thread.latestTurnId,
    latestTurnStatus: thread.latestTurnStatus
  }
}

export async function storedThreadPage(
  thread: ClaudeCodeStoredThread,
  eventStore: ClaudeCodeEventStore,
  options: { cursor?: string; limit?: number } = {}
): Promise<AgentRuntimeThreadPage> {
  const page = await eventStore.readPage(thread.guiThreadId, options)
  const storedEvents = page.events
  const events = storedEvents.map((item) => item.event)
  const items = externalizeToolDetails({
    runtimeId: 'claude',
    threadId: thread.guiThreadId,
    items: itemsFromEvents(events)
  })
  const turns = turnsFromEvents(thread.guiThreadId, events, items)
  return {
    runtimeId: 'claude',
    threadId: thread.guiThreadId,
    latestSeq: thread.latestSeq,
    turns,
    nextCursor: page.nextCursor
  }
}

function itemsFromEvents(events: AgentRuntimeEvent[]): AgentRuntimeItem[] {
  const items = new Map<string, AgentRuntimeItem>()
  const textChunks = new Map<string, string[]>()
  for (const event of events) {
    if (event.kind === 'user_message') {
      items.set(event.itemId, {
        id: event.itemId,
        turnId: event.turnId,
        kind: 'user_message',
        text: event.displayText?.trim() || event.text,
        ...(requiresExecutionIntegrityValidation(event.text)
          ? {
              meta: {
                [EXECUTION_INTEGRITY_POLICY_METADATA_KEY]:
                  EXECUTION_INTEGRITY_POLICY_VERSION
              }
            }
          : {}),
        createdAt: event.createdAt
      })
      continue
    }
    if (event.kind === 'assistant_delta') {
      const current = items.get(event.itemId)
      const chunks = textChunks.get(event.itemId) ?? []
      chunks.push(event.text)
      textChunks.set(event.itemId, chunks)
      items.set(event.itemId, {
        id: event.itemId,
        turnId: event.turnId,
        kind: 'assistant_message',
        text: '',
        createdAt: current?.createdAt ?? event.createdAt
      })
      continue
    }
    if (event.kind === 'reasoning_delta') {
      const current = items.get(event.itemId)
      const chunks = textChunks.get(event.itemId) ?? []
      chunks.push(event.text)
      textChunks.set(event.itemId, chunks)
      items.set(event.itemId, {
        id: event.itemId,
        turnId: event.turnId,
        kind: 'reasoning',
        text: '',
        createdAt: current?.createdAt ?? event.createdAt
      })
      continue
    }
    if (event.kind === 'item_snapshot') {
      textChunks.delete(event.item.id)
      items.set(event.item.id, {
        ...event.item,
        turnId: event.item.turnId ?? event.turnId,
        createdAt: event.item.createdAt ?? event.createdAt
      })
      continue
    }
    if (event.kind === 'tool_event') {
      items.set(event.itemId ?? `tool-${event.seq ?? items.size + 1}`, {
        id: event.itemId ?? `tool-${event.seq ?? items.size + 1}`,
        turnId: event.turnId,
        kind: 'tool',
        summary: event.summary ?? 'Claude Code tool event',
        status: event.status,
        toolKind: event.toolKind,
        detail: event.detail,
        meta: event.filePath ? { filePath: event.filePath, ...event.meta } : event.meta,
        createdAt: event.createdAt
      })
      continue
    }
    if (event.kind === 'error') {
      items.set(event.itemId ?? `error-${event.seq ?? items.size + 1}`, {
        id: event.itemId ?? `error-${event.seq ?? items.size + 1}`,
        turnId: event.turnId,
        kind: 'system',
        text: event.message,
        detail: event.detail,
        status: 'error',
        meta: { code: event.code, severity: event.severity },
        createdAt: event.createdAt
      })
    }
  }
  return [...items.values()].map((item) => {
    const chunks = textChunks.get(item.id)
    return chunks ? { ...item, text: chunks.join('') } : item
  })
}

function turnsFromEvents(
  threadId: string,
  events: AgentRuntimeEvent[],
  items: AgentRuntimeItem[]
): AgentRuntimeTurn[] {
  const statuses = new Map<string, AgentRuntimeTurn['status']>()
  const startedAt = new Map<string, string>()
  const completedAt = new Map<string, string>()
  for (const event of events) {
    if (!event.turnId) continue
    if (event.kind === 'turn_lifecycle') {
      statuses.set(event.turnId, normalizeTurnLifecycleState(event.state))
      if (event.state === 'started' && event.createdAt) startedAt.set(event.turnId, event.createdAt)
      if (event.state !== 'started' && event.createdAt) completedAt.set(event.turnId, event.createdAt)
    }
  }
  const turnIds = [...new Set([
    ...items.map((item) => item.turnId ?? '').filter(Boolean),
    ...statuses.keys()
  ])]
  return turnIds.map((id): AgentRuntimeTurn => ({
    id,
    threadId,
    status: statuses.get(id) ?? inferTurnStatus(items.filter((item) => item.turnId === id)),
    startedAt: startedAt.get(id),
    completedAt: completedAt.get(id),
    items: items.filter((item) => item.turnId === id)
  }))
}

function normalizeThreadSnapshot(raw: unknown): ClaudeCodeThreadStoreSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyThreadSnapshot()
  const record = raw as Record<string, unknown>
  const threads = Array.isArray(record.threads)
    ? record.threads.map(normalizeThread).filter((thread): thread is ClaudeCodeStoredThread => Boolean(thread))
    : []
  return { version: 1, threads }
}

function normalizeThread(raw: unknown): ClaudeCodeStoredThread | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const guiThreadId = stringValue(record.guiThreadId)
  if (!guiThreadId) return null
  return {
    guiThreadId,
    claudeSessionId: stringValue(record.claudeSessionId),
    runtimeId: 'claude',
    workspace: stringValue(record.workspace),
    title: stringValue(record.title) || 'Claude Code thread',
    model: stringValue(record.model),
    createdAt: stringValue(record.createdAt) || new Date(0).toISOString(),
    updatedAt: stringValue(record.updatedAt) || new Date(0).toISOString(),
    archived: record.archived === true,
    latestSeq: numberValue(record.latestSeq),
    ...(stringValue(record.latestTurnId) ? { latestTurnId: stringValue(record.latestTurnId) } : {}),
    ...(stringValue(record.latestUserMessageId) ? { latestUserMessageId: stringValue(record.latestUserMessageId) } : {}),
    ...(isTurnStatus(record.latestTurnStatus) ? { latestTurnStatus: record.latestTurnStatus } : {})
  }
}

function parseStoredEvent(line: string): ClaudeCodeStoredEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const event = record.event
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null
  const threadId = stringValue(record.threadId) || stringValue((event as Record<string, unknown>).threadId)
  const seq = numberValue(record.seq)
  if (!threadId || seq <= 0) return null
  return {
    seq,
    threadId,
    createdAt: stringValue(record.createdAt) || new Date(0).toISOString(),
    event: {
      ...(event as AgentRuntimeEvent),
      threadId,
      runtimeId: 'claude',
      seq
    }
  }
}

function emptyThreadSnapshot(): ClaudeCodeThreadStoreSnapshot {
  return { version: 1, threads: [] }
}

function normalizeTurnLifecycleState(
  state: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state']
): AgentRuntimeTurn['status'] {
  if (state === 'completed') return 'completed'
  if (state === 'failed') return 'failed'
  if (state === 'aborted') return 'aborted'
  if (state === 'steered') return 'steered'
  return 'running'
}

function inferTurnStatus(items: AgentRuntimeItem[]): AgentRuntimeTurn['status'] {
  if (items.some((item) => item.status === 'error' || item.status === 'failed')) return 'failed'
  if (items.length > 0) return 'completed'
  return 'queued'
}

function isTurnStatus(value: unknown): value is AgentRuntimeTurn['status'] {
  return value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'aborted' ||
    value === 'steered'
}

function safeSegment(value: string): string {
  const trimmed = value.trim()
  const encoded = Buffer.from(trimmed, 'utf8').toString('base64url')
  return encoded || 'thread'
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
}
