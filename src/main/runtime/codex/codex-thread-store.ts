import {
  atomicWriteAppDataJson,
  readAppDataStoreText
} from '../../services/app-data-store'
import {
  isAgentRuntimeTerminalTurnState,
  type AgentRuntimeThreadSidebarVisibility,
  type AgentRuntimeTurnStatus
} from '../../../shared/agent-runtime-contract'

export type CodexStoredThread = {
  guiThreadId: string
  codexThreadId: string
  runtimeId: 'codex'
  workspace: string
  title: string
  createdAt: string
  updatedAt: string
  archived: boolean
  latestSeq: number
  latestTurnId?: string
  latestTurnStatus?: AgentRuntimeTurnStatus
  latestUserMessageId?: string
  relation?: CodexStoredThreadRelation
  parentThreadId?: string
  parentTurnId?: string
  threadSource?: string
  sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
  titleSource?: string
  agentNickname?: string
  agentRole?: string
}

export type CodexThreadStoreSnapshot = {
  version: 1
  threads: CodexStoredThread[]
}

export type CodexThreadStoreOptions = {
  rootDir: string
  now?: () => Date
}

export type CodexStoredThreadRelation = 'primary' | 'fork' | 'side'

export type CodexThreadStoreUpsertInput = {
  guiThreadId?: string
  codexThreadId: string
  workspace?: string
  title?: string
  archived?: boolean
  preserveArchived?: boolean
  latestSeq?: number
  latestTurnId?: string
  latestTurnStatus?: AgentRuntimeTurnStatus
  latestUserMessageId?: string
  updatedAt?: string
  relation?: CodexStoredThreadRelation
  parentThreadId?: string
  parentTurnId?: string
  threadSource?: string
  sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
  titleSource?: string
  agentNickname?: string
  agentRole?: string
}

function applyThreadUpsert(
  threads: CodexStoredThread[],
  input: CodexThreadStoreUpsertInput,
  now: string
): { record: CodexStoredThread; threads: CodexStoredThread[]; changed: boolean } {
  const codexThreadId = input.codexThreadId.trim()
  if (!codexThreadId) throw new Error('Codex thread id is required.')
  const guiThreadId = stringValue(input.guiThreadId)
  const matchesInput = (thread: CodexStoredThread): boolean => (
    thread.codexThreadId === codexThreadId ||
    (guiThreadId !== '' && thread.guiThreadId === guiThreadId)
  )
  const updatedAt = validIso(input.updatedAt) ?? now
  const matchingThreads = threads.filter(matchesInput)
  const archived = input.preserveArchived && matchingThreads.length > 0
    ? undefined
    : input.archived
  const next = mergeThreadRecords(matchingThreads, {
    guiThreadId,
    codexThreadId,
    updatedAt,
    now,
    workspace: input.workspace,
    title: input.title,
    archived,
    latestSeq: input.latestSeq,
    latestTurnId: input.latestTurnId,
    latestTurnStatus: input.latestTurnStatus,
    latestUserMessageId: input.latestUserMessageId,
    relation: input.relation,
    parentThreadId: input.parentThreadId,
    parentTurnId: input.parentTurnId,
    threadSource: input.threadSource,
    sidebarVisibility: input.sidebarVisibility,
    titleSource: input.titleSource,
    agentNickname: input.agentNickname,
    agentRole: input.agentRole
  })
  if (matchingThreads.length === 1 && sameStoredThread(matchingThreads[0], next)) {
    return { record: next, threads, changed: false }
  }
  const nextThreads = threads.filter((thread) => !matchesInput(thread))
  nextThreads.push(next)
  return { record: next, threads: nextThreads, changed: true }
}

function sameStoredThread(a: CodexStoredThread, b: CodexStoredThread): boolean {
  return a.guiThreadId === b.guiThreadId &&
    a.codexThreadId === b.codexThreadId &&
    a.runtimeId === b.runtimeId &&
    a.workspace === b.workspace &&
    a.title === b.title &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.archived === b.archived &&
    a.latestSeq === b.latestSeq &&
    a.latestTurnId === b.latestTurnId &&
    a.latestTurnStatus === b.latestTurnStatus &&
    a.latestUserMessageId === b.latestUserMessageId &&
    a.relation === b.relation &&
    a.parentThreadId === b.parentThreadId &&
    a.parentTurnId === b.parentTurnId &&
    a.threadSource === b.threadSource &&
    a.sidebarVisibility === b.sidebarVisibility &&
    a.titleSource === b.titleSource &&
    a.agentNickname === b.agentNickname &&
    a.agentRole === b.agentRole
}

export class CodexThreadStore {
  private readonly rootDir: string
  private readonly now: () => Date
  private transactionQueue: Promise<void> = Promise.resolve()

  constructor(options: CodexThreadStoreOptions) {
    this.rootDir = options.rootDir
    this.now = options.now ?? (() => new Date())
  }

  async list(options: { includeArchived?: boolean } = {}): Promise<CodexStoredThread[]> {
    const snapshot = await this.load()
    const threads = options.includeArchived
      ? snapshot.threads
      : snapshot.threads.filter((thread) => !thread.archived)
    return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  async get(guiThreadId: string): Promise<CodexStoredThread | null> {
    const id = guiThreadId.trim()
    if (!id) return null
    const snapshot = await this.load()
    return snapshot.threads.find((thread) => thread.guiThreadId === id) ?? null
  }

  async getByCodexThreadId(codexThreadId: string): Promise<CodexStoredThread | null> {
    const id = codexThreadId.trim()
    if (!id) return null
    const snapshot = await this.load()
    return snapshot.threads.find((thread) => thread.codexThreadId === id) ?? null
  }

  async upsert(input: CodexThreadStoreUpsertInput): Promise<CodexStoredThread> {
    return this.enqueue(async () => this.upsertNow(input))
  }

  async upsertMany(inputs: readonly CodexThreadStoreUpsertInput[]): Promise<CodexStoredThread[]> {
    if (inputs.length === 0) return []
    return this.enqueue(async () => this.upsertManyNow(inputs))
  }

  private async upsertNow(input: CodexThreadStoreUpsertInput): Promise<CodexStoredThread> {
    const [record] = await this.upsertManyNow([input])
    return record
  }

  private async upsertManyNow(inputs: readonly CodexThreadStoreUpsertInput[]): Promise<CodexStoredThread[]> {
    const snapshot = await this.load()
    let threads = snapshot.threads
    let changed = false
    const records: CodexStoredThread[] = []
    for (const input of inputs) {
      const result = applyThreadUpsert(threads, input, this.now().toISOString())
      records.push(result.record)
      threads = result.threads
      changed = changed || result.changed
    }
    if (changed) {
      await this.save({ version: 1, threads })
    }
    return records
  }

  async archive(guiThreadId: string): Promise<CodexStoredThread | null> {
    const existing = await this.get(guiThreadId)
    if (!existing) return null
    return this.upsert({
      guiThreadId: existing.guiThreadId,
      codexThreadId: existing.codexThreadId,
      archived: true
    })
  }

  async updateLatestSeq(guiThreadId: string, latestSeq: number): Promise<CodexStoredThread | null> {
    const existing = await this.get(guiThreadId)
    if (!existing) return null
    return this.upsert({
      guiThreadId: existing.guiThreadId,
      codexThreadId: existing.codexThreadId,
      latestSeq
    })
  }

  private async load(): Promise<CodexThreadStoreSnapshot> {
    try {
      const raw = await readAppDataStoreText(this.rootDir, CODEX_THREADS_STORE)
      return normalizeSnapshot(parseSnapshotJson(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySnapshot()
      throw error
    }
  }

  private async save(snapshot: CodexThreadStoreSnapshot): Promise<void> {
    await atomicWriteAppDataJson(this.rootDir, CODEX_THREADS_STORE, normalizeSnapshot(snapshot), {
      trailingNewline: true
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(task, task)
    this.transactionQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

const CODEX_THREADS_STORE = ['threads.json'] as const

function emptySnapshot(): CodexThreadStoreSnapshot {
  return { version: 1, threads: [] }
}

function normalizeSnapshot(raw: unknown): CodexThreadStoreSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptySnapshot()
  const record = raw as Record<string, unknown>
  const threads = Array.isArray(record.threads)
    ? record.threads.map(normalizeThread).filter((thread): thread is CodexStoredThread => Boolean(thread))
    : []
  return { version: 1, threads: dedupeThreads(threads) }
}

function parseSnapshotJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const end = firstJsonObjectEnd(raw)
    if (end >= 0) {
      return JSON.parse(raw.slice(0, end + 1)) as unknown
    }
    throw error
  }
}

function firstJsonObjectEnd(raw: string): number {
  let depth = 0
  let started = false
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth += 1
      started = true
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (started && depth === 0) return i
      if (depth < 0) return -1
    }
  }
  return -1
}

function normalizeThread(raw: unknown): CodexStoredThread | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const codexThreadId = stringValue(record.codexThreadId)
  const guiThreadId = stringValue(record.guiThreadId) || codexThreadId
  if (!codexThreadId || !guiThreadId) return null
  return {
    guiThreadId,
    codexThreadId,
    runtimeId: 'codex',
    workspace: stringValue(record.workspace),
    title: stringValue(record.title) || 'Codex thread',
    createdAt: stringValue(record.createdAt) || new Date(0).toISOString(),
    updatedAt: stringValue(record.updatedAt) || stringValue(record.createdAt) || new Date(0).toISOString(),
    archived: record.archived === true,
    latestSeq: numberValue(record.latestSeq),
    ...(stringValue(record.latestTurnId) ? { latestTurnId: stringValue(record.latestTurnId) } : {}),
    ...(isTurnStatus(record.latestTurnStatus) ? { latestTurnStatus: record.latestTurnStatus } : {}),
    ...(stringValue(record.latestUserMessageId) ? { latestUserMessageId: stringValue(record.latestUserMessageId) } : {}),
    ...(normalizeThreadRelation(record.relation) ? { relation: normalizeThreadRelation(record.relation) } : {}),
    ...(stringValue(record.parentThreadId) ? { parentThreadId: stringValue(record.parentThreadId) } : {}),
    ...(stringValue(record.parentTurnId) ? { parentTurnId: stringValue(record.parentTurnId) } : {}),
    ...(stringValue(record.threadSource) ? { threadSource: stringValue(record.threadSource) } : {}),
    ...(normalizeSidebarVisibility(record.sidebarVisibility) ? { sidebarVisibility: normalizeSidebarVisibility(record.sidebarVisibility) } : {}),
    ...(stringValue(record.titleSource) ? { titleSource: stringValue(record.titleSource) } : {}),
    ...(stringValue(record.agentNickname) ? { agentNickname: stringValue(record.agentNickname) } : {}),
    ...(stringValue(record.agentRole) ? { agentRole: stringValue(record.agentRole) } : {})
  }
}

function dedupeThreads(threads: CodexStoredThread[]): CodexStoredThread[] {
  const groups: CodexStoredThread[][] = []
  for (const thread of threads) {
    const matchingIndexes = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => group.some((candidate) => sameThreadIdentity(candidate, thread)))
      .map(({ index }) => index)
    if (matchingIndexes.length === 0) {
      groups.push([thread])
      continue
    }
    const [firstIndex, ...otherIndexes] = matchingIndexes
    groups[firstIndex].push(thread)
    for (const index of [...otherIndexes].sort((a, b) => b - a)) {
      groups[firstIndex].push(...groups[index])
      groups.splice(index, 1)
    }
  }
  return groups.map((group) => mergeThreadRecords(group))
}

function sameThreadIdentity(a: CodexStoredThread, b: CodexStoredThread): boolean {
  return a.guiThreadId === b.guiThreadId || a.codexThreadId === b.codexThreadId
}

function mergeThreadRecords(
  records: CodexStoredThread[],
  overrides: {
    guiThreadId?: string
    codexThreadId?: string
    workspace?: string
    title?: string
    archived?: boolean
    latestSeq?: number
    latestTurnId?: string
    latestTurnStatus?: AgentRuntimeTurnStatus
    latestUserMessageId?: string
    updatedAt?: string
    now?: string
    relation?: CodexStoredThreadRelation
    parentThreadId?: string
    parentTurnId?: string
    threadSource?: string
    sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
    titleSource?: string
    agentNickname?: string
    agentRole?: string
  } = {}
): CodexStoredThread {
  const preferredRecords = [...records].sort(compareThreadActivity)
  const preferred = preferredRecords[0]
  const now = validIso(overrides.now) ?? new Date(0).toISOString()
  const guiThreadId = nonEmpty(overrides.guiThreadId, preferred?.guiThreadId ?? overrides.codexThreadId ?? '')
  const codexThreadId = nonEmpty(overrides.codexThreadId, preferred?.codexThreadId ?? guiThreadId)
  const latestTurnIdField = optionalString('latestTurnId', overrides.latestTurnId, preferredRecords)
  const durableTerminalStatus = preferredRecords.find((thread) => (
    thread.latestTurnId === latestTurnIdField.latestTurnId && isAgentRuntimeTerminalTurnState(thread.latestTurnStatus)
  ))?.latestTurnStatus
  const latestTurnStatusOverride = durableTerminalStatus && !isAgentRuntimeTerminalTurnState(overrides.latestTurnStatus)
    ? durableTerminalStatus
    : overrides.latestTurnStatus
  return {
    guiThreadId,
    codexThreadId,
    runtimeId: 'codex',
    workspace: chooseString([overrides.workspace, ...preferredRecords.map((thread) => thread.workspace)]),
    title: chooseDisplayTitle([overrides.title, ...preferredRecords.map((thread) => thread.title)]) ?? 'Codex thread',
    createdAt: earliestIso(preferredRecords.map((thread) => thread.createdAt)) ?? now,
    updatedAt: validIso(overrides.updatedAt) ?? latestIso(preferredRecords.map((thread) => thread.updatedAt)) ?? now,
    archived: overrides.archived ?? preferred?.archived ?? false,
    latestSeq: Math.max(
      numberValue(overrides.latestSeq),
      ...preferredRecords.map((thread) => thread.latestSeq)
    ),
    ...latestTurnIdField,
    ...optionalTurnStatus('latestTurnStatus', latestTurnStatusOverride, preferredRecords),
    ...optionalString('latestUserMessageId', overrides.latestUserMessageId, preferredRecords),
    ...optionalRelation('relation', overrides.relation, preferredRecords),
    ...optionalString('parentThreadId', overrides.parentThreadId, preferredRecords),
    ...optionalString('parentTurnId', overrides.parentTurnId, preferredRecords),
    ...optionalString('threadSource', overrides.threadSource, preferredRecords),
    ...optionalSidebarVisibility('sidebarVisibility', overrides.sidebarVisibility, preferredRecords),
    ...optionalString('titleSource', overrides.titleSource, preferredRecords),
    ...optionalString('agentNickname', overrides.agentNickname, preferredRecords),
    ...optionalString('agentRole', overrides.agentRole, preferredRecords)
  }
}

function compareThreadActivity(a: CodexStoredThread, b: CodexStoredThread): number {
  return b.latestSeq - a.latestSeq ||
    timestampValue(b.updatedAt) - timestampValue(a.updatedAt) ||
    timestampValue(b.createdAt) - timestampValue(a.createdAt)
}

function chooseString(values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return ''
}

function chooseDisplayTitle(values: unknown[]): string | null {
  for (const value of values) {
    const title = stringValue(value)
    if (title) return title
  }
  return null
}

function optionalString(
  key: 'latestTurnId' | 'latestUserMessageId' | 'parentThreadId' | 'parentTurnId' | 'threadSource' | 'titleSource' | 'agentNickname' | 'agentRole',
  override: string | undefined,
  records: CodexStoredThread[]
): Partial<Pick<CodexStoredThread, 'latestTurnId' | 'latestUserMessageId' | 'parentThreadId' | 'parentTurnId' | 'threadSource' | 'titleSource' | 'agentNickname' | 'agentRole'>> {
  if (override !== undefined) return override ? { [key]: override } : {}
  const value = records.map((thread) => thread[key]).find((candidate) => stringValue(candidate))
  return value ? { [key]: value } : {}
}

function optionalSidebarVisibility(
  key: 'sidebarVisibility',
  override: AgentRuntimeThreadSidebarVisibility | undefined,
  records: CodexStoredThread[]
): Partial<Pick<CodexStoredThread, 'sidebarVisibility'>> {
  if (override !== undefined) return { [key]: override }
  const value = records
    .map((thread) => normalizeSidebarVisibility(thread[key]))
    .find(Boolean)
  return value ? { [key]: value } : {}
}

function optionalTurnStatus(
  key: 'latestTurnStatus',
  override: AgentRuntimeTurnStatus | undefined,
  records: CodexStoredThread[]
): Partial<Pick<CodexStoredThread, 'latestTurnStatus'>> {
  if (override !== undefined) return { [key]: override }
  const value = records.map((thread) => thread.latestTurnStatus).find(isTurnStatus)
  return value ? { [key]: value } : {}
}

function isTurnStatus(value: unknown): value is AgentRuntimeTurnStatus {
  return typeof value === 'string' && [
    'idle', 'starting', 'running', 'reconnecting', 'tool_waiting', 'stream_recovering',
    'completing', 'completed', 'failed', 'cancelled', 'aborted', 'queued', 'pending',
    'started', 'in_progress', 'steered', 'success', 'error', 'canceled', 'interrupted'
  ].includes(value)
}

function optionalRelation(
  key: 'relation',
  override: CodexStoredThreadRelation | undefined,
  records: CodexStoredThread[]
): Partial<Pick<CodexStoredThread, 'relation'>> {
  if (override !== undefined) return { [key]: override }
  const value = records.map((thread) => normalizeThreadRelation(thread[key])).find(Boolean)
  return value ? { [key]: value } : {}
}

function normalizeSidebarVisibility(value: unknown): AgentRuntimeThreadSidebarVisibility | undefined {
  const visibility = stringValue(value).trim().toLowerCase()
  if (visibility === 'main' || visibility === 'sidebar' || visibility === 'visible') return 'main'
  if (visibility === 'side' || visibility === 'auxiliary') return 'side'
  if (visibility === 'hidden' || visibility === 'hide' || visibility === 'internal' || visibility === 'none') return 'hidden'
  return undefined
}

function normalizeThreadRelation(value: unknown): CodexStoredThreadRelation | undefined {
  const relation = stringValue(value)
  return relation === 'primary' || relation === 'fork' || relation === 'side' ? relation : undefined
}

function earliestIso(values: string[]): string | null {
  return validIsoBy(values, (a, b) => a - b)
}

function latestIso(values: string[]): string | null {
  return validIsoBy(values, (a, b) => b - a)
}

function validIsoBy(values: string[], compare: (a: number, b: number) => number): string | null {
  const valid = values
    .map((value) => ({ value: validIso(value), timestamp: timestampValue(value) }))
    .filter((item): item is { value: string; timestamp: number } => item.value !== null)
    .sort((a, b) => compare(a.timestamp, b.timestamp))
  return valid[0]?.value ?? null
}

function timestampValue(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function nonEmpty(value: unknown, fallback: string): string {
  return stringValue(value) || fallback
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function validIso(value: unknown): string | null {
  const text = stringValue(value)
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? text : null
}
