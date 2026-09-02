import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  ArtifactVersionEventListPortV1,
  ArtifactVersionLifecycleEventV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  pullArtifactVersionLifecyclePage,
  type ArtifactVersionLifecyclePage,
  type EvidenceArtifactVersionIdentity
} from './artifact-version-client.js'
import type {
  EvidenceDagAppendResult,
  EvidenceDagTraceAppendInput
} from './evidence-delta.js'

export type EvidenceArtifactLifecycleThreadKey = Readonly<{
  runtimeId: string
  threadId: string
  workspaceRoot: string
}>

export type EvidenceArtifactLifecycleThread = EvidenceArtifactLifecycleThreadKey & Readonly<{
  targetWatermark: string
  trace: readonly Readonly<Record<string, unknown>>[]
}>

type TrackedThread = {
  key: string
  runtimeId: string
  threadId: string
  workspaceRoot: string
  targetWatermark: string
  artifactIds: string[]
  versionIds: string[]
  updatedAt: string
}

type WorkspaceCursor = {
  workspaceRoot: string
  cursor: number
  updatedAt: string
}

type LifecycleReceipt = {
  receiptId: string
  workspaceRoot: string
  afterSequence: number
  lastSequence: number
  eventIds: string[]
  affectedThreadKeys: string[]
  deltaDigests: string[]
  processedAt: string
}

type LifecycleStateFile = {
  version: 2
  workspaces: WorkspaceCursor[]
  threads: TrackedThread[]
  receipts: LifecycleReceipt[]
}

const DEFAULT_PAGE_SIZE = 256
const DEFAULT_POLL_INTERVAL_MS = 15_000

/**
 * Durable ArtifactVersion lifecycle inbox owned by Evidence DAG.
 *
 * Artifact Versions remains the only event/outbox owner. This consumer stores
 * only an Evidence cursor, exact thread/ref associations, and delta receipts.
 */
export class EvidenceArtifactVersionLifecycleConsumer {
  private state: LifecycleStateFile = emptyState()
  private loaded = false
  private enabled = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private draining: Promise<void> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly options: Readonly<{
    storagePath: string
    eventListPort: (workspaceRoot: string) => ArtifactVersionEventListPortV1
    discoverThreads: () => Promise<readonly EvidenceArtifactLifecycleThreadKey[]>
    prepareThread: (
      thread: EvidenceArtifactLifecycleThreadKey
    ) => Promise<EvidenceArtifactLifecycleThread>
    identities: (
      trace: readonly Readonly<Record<string, unknown>>[]
    ) => readonly EvidenceArtifactVersionIdentity[]
    withLifecycle: (
      trace: readonly Readonly<Record<string, unknown>>[],
      lifecycle: ArtifactVersionLifecyclePage
    ) => readonly Readonly<Record<string, unknown>>[]
    append: (input: EvidenceDagTraceAppendInput) => Promise<EvidenceDagAppendResult>
    now?: () => Date
    pageSize?: number
    pollIntervalMs?: number
    log?: (entry: Readonly<{ level: 'debug' | 'warn'; message: string; detail?: unknown }>) => void
  }>) {}

  async start(enabled: boolean): Promise<void> {
    await this.load()
    this.enabled = enabled
    if (enabled) this.schedule(0)
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.load()
    this.enabled = enabled
    if (!enabled && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
      return
    }
    if (enabled) this.schedule(0)
  }

  async rememberThread(thread: EvidenceArtifactLifecycleThread): Promise<void> {
    await this.load()
    this.rememberThreadInMemory(thread, this.options.identities(thread.trace))
    await this.persist()
  }

  requestPoll(): void {
    if (!this.enabled || this.closed) return
    this.schedule(0, true)
  }

  async pollNow(): Promise<void> {
    await this.load()
    if (!this.enabled || this.closed) return
    if (this.draining) return this.draining
    const work = this.drain()
    this.draining = work
    try {
      await work
    } finally {
      if (this.draining === work) this.draining = undefined
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.enabled = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.draining
    await this.writing
  }

  private async drain(): Promise<void> {
    let discovered: readonly EvidenceArtifactLifecycleThreadKey[]
    try {
      discovered = await this.options.discoverThreads()
    } catch (error) {
      this.warn('Evidence DAG could not discover threads for ArtifactVersion lifecycle.', error)
      return
    }
    const byWorkspace = new Map<string, EvidenceArtifactLifecycleThreadKey[]>()
    for (const thread of discovered) {
      const workspaceRoot = resolve(thread.workspaceRoot)
      const values = byWorkspace.get(workspaceRoot) ?? []
      values.push({ ...thread, workspaceRoot })
      byWorkspace.set(workspaceRoot, values)
    }
    for (const workspaceRoot of this.state.workspaces.map((item) => item.workspaceRoot)) {
      if (!byWorkspace.has(workspaceRoot)) byWorkspace.set(workspaceRoot, [])
    }
    for (const workspaceRoot of this.state.threads.map((item) => item.workspaceRoot)) {
      if (!byWorkspace.has(workspaceRoot)) byWorkspace.set(workspaceRoot, [])
    }

    for (const [workspaceRoot, threads] of byWorkspace) {
      try {
        await this.drainWorkspace(workspaceRoot, threads)
      } catch (error) {
        this.warn(`Evidence DAG ArtifactVersion lifecycle pull failed for ${workspaceRoot}.`, error)
      }
    }
  }

  private async drainWorkspace(
    workspaceRoot: string,
    threads: readonly EvidenceArtifactLifecycleThreadKey[]
  ): Promise<void> {
    let cursor = this.workspaceCursor(workspaceRoot)
    let prepared: Map<string, EvidenceArtifactLifecycleThread> | undefined
    const pageSize = Math.min(512, Math.max(1, this.options.pageSize ?? DEFAULT_PAGE_SIZE))
    let pulled = await this.pullPage(workspaceRoot, cursor, pageSize)
    while (!this.closed && this.enabled) {
      if (!pulled.events.length) {
        if (pulled.lastSequence !== cursor) {
          throw new Error('ArtifactVersion lifecycle returned an empty non-monotonic page.')
        }
        return
      }
      if (
        pulled.lastSequence <= cursor ||
        pulled.events.some((event) => event.sequence <= cursor) ||
        pulled.events.at(-1)?.sequence !== pulled.lastSequence
      ) {
        throw new Error('ArtifactVersion lifecycle returned a non-monotonic page.')
      }
      if (!prepared) prepared = await this.prepareWorkspaceThreads(threads)
      const lookahead = pulled.events.length === pageSize
        ? await this.pullPage(workspaceRoot, pulled.lastSequence, pageSize)
        : undefined
      const page: ArtifactVersionLifecyclePage = {
        events: pulled.events,
        lastSequence: pulled.lastSequence,
        lifecyclePending: Boolean(lookahead?.events.length)
      }
      await this.acceptPage(workspaceRoot, cursor, page, prepared)
      cursor = pulled.lastSequence
      if (!lookahead?.events.length) {
        if (lookahead && lookahead.lastSequence !== cursor) {
          throw new Error('ArtifactVersion lifecycle returned an empty non-monotonic page.')
        }
        return
      }
      pulled = lookahead
    }
  }

  private async pullPage(workspaceRoot: string, afterSequence: number, limit: number) {
    const pulled = await pullArtifactVersionLifecyclePage(
      workspaceRoot,
      afterSequence,
      this.options.eventListPort,
      limit
    )
    if (!pulled.ok) throw new Error(pulled.issue.message)
    return pulled
  }

  private async prepareWorkspaceThreads(
    threads: readonly EvidenceArtifactLifecycleThreadKey[]
  ): Promise<Map<string, EvidenceArtifactLifecycleThread>> {
    const prepared = new Map<string, EvidenceArtifactLifecycleThread>()
    for (const thread of threads) {
      const key = threadKey(thread.runtimeId, thread.threadId)
      try {
        const value = await this.options.prepareThread(thread)
        prepared.set(key, value)
        this.rememberThreadInMemory(value, this.options.identities(value.trace))
      } catch (error) {
        this.warn(`Evidence DAG could not prepare lifecycle trace for ${key}.`, error)
      }
    }
    return prepared
  }

  private async acceptPage(
    workspaceRoot: string,
    afterSequence: number,
    page: ArtifactVersionLifecyclePage,
    prepared: ReadonlyMap<string, EvidenceArtifactLifecycleThread>
  ): Promise<void> {
    const receiptId = lifecycleReceiptId(workspaceRoot, afterSequence, page.events)
    const replay = this.state.receipts.find((receipt) => receipt.receiptId === receiptId)
    if (replay) {
      this.setWorkspaceCursor(workspaceRoot, replay.lastSequence)
      await this.persist()
      return
    }

    const affected = this.state.threads
      .filter((thread) => thread.workspaceRoot === workspaceRoot)
      .filter((thread) => page.events.some((event) => affectsThread(event, thread)))
      .sort((left, right) => left.key.localeCompare(right.key))
    const deltaDigests: string[] = []
    for (const thread of affected) {
      const live = prepared.get(thread.key)
      if (!live || !live.trace.length) {
        throw new Error(
          `Affected Evidence thread ${thread.key} is unavailable; lifecycle cursor was not advanced.`
        )
      }
      const appended = await this.options.append({
        idempotencyKey: `${receiptId}:${thread.key}`,
        runtimeId: thread.runtimeId,
        threadId: thread.threadId,
        operationId: `artifact-lifecycle:${page.lastSequence}`,
        kind: 'artifact_lifecycle',
        requestedWatermark: `${live.targetWatermark}:artifact-lifecycle:${page.lastSequence}`,
        eventKind: 'artifact_version_lifecycle',
        trace: this.options.withLifecycle(live.trace, page),
        workspaceRoot
      })
      deltaDigests.push(appended.delta.deltaDigest)
    }

    const processedAt = this.nowIso()
    this.state.receipts.push({
      receiptId,
      workspaceRoot,
      afterSequence,
      lastSequence: page.lastSequence,
      eventIds: page.events.map((event) => event.eventId),
      affectedThreadKeys: affected.map((thread) => thread.key),
      deltaDigests,
      processedAt
    })
    this.state.receipts = this.state.receipts.slice(-1_000)
    this.setWorkspaceCursor(workspaceRoot, page.lastSequence, processedAt)
    await this.persist()
  }

  private rememberThreadInMemory(
    thread: EvidenceArtifactLifecycleThread,
    identities: readonly EvidenceArtifactVersionIdentity[]
  ): void {
    const key = threadKey(thread.runtimeId, thread.threadId)
    const workspaceRoot = resolve(thread.workspaceRoot)
    const existing = this.state.threads.find((item) => item.key === key)
    const priorArtifactIds = existing?.workspaceRoot === workspaceRoot ? existing.artifactIds : []
    const priorVersionIds = existing?.workspaceRoot === workspaceRoot ? existing.versionIds : []
    const next: TrackedThread = {
      key,
      runtimeId: thread.runtimeId,
      threadId: thread.threadId,
      workspaceRoot,
      targetWatermark: thread.targetWatermark,
      artifactIds: uniqueSorted([...priorArtifactIds, ...identities.map((item) => item.artifactId)]),
      versionIds: uniqueSorted([...priorVersionIds, ...identities.map((item) => item.versionId)]),
      updatedAt: this.nowIso()
    }
    if (existing) Object.assign(existing, next)
    else this.state.threads.push(next)
    this.state.threads = this.state.threads
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(-5_000)
    if (!this.state.workspaces.some((item) => item.workspaceRoot === workspaceRoot)) {
      this.state.workspaces.push({ workspaceRoot, cursor: 0, updatedAt: next.updatedAt })
    }
  }

  private workspaceCursor(workspaceRoot: string): number {
    return this.state.workspaces.find((item) => item.workspaceRoot === workspaceRoot)?.cursor ?? 0
  }

  private setWorkspaceCursor(
    workspaceRoot: string,
    cursor: number,
    updatedAt = this.nowIso()
  ): void {
    const existing = this.state.workspaces.find((item) => item.workspaceRoot === workspaceRoot)
    if (existing) {
      existing.cursor = Math.max(existing.cursor, cursor)
      existing.updatedAt = updatedAt
    } else {
      this.state.workspaces.push({ workspaceRoot, cursor, updatedAt })
    }
  }

  private schedule(delayMs: number, replace = false): void {
    if (this.closed || !this.enabled) return
    if (this.timer && !replace) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.pollNow().finally(() => {
        if (!this.closed && this.enabled) {
          this.schedule(this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
        }
      })
    }, Math.max(0, delayMs))
    this.timer.unref?.()
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      this.state = canonicalState(JSON.parse(await readFile(this.options.storagePath, 'utf8')))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ''
      if (code !== 'ENOENT') throw error
      this.state = emptyState()
    }
  }

  private persist(): Promise<void> {
    const file = structuredClone(this.state)
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.options.storagePath), { recursive: true })
      const temporaryPath = `${this.options.storagePath}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.options.storagePath)
    })
    return this.writing
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }

  private warn(message: string, error: unknown): void {
    this.options.log?.({
      level: 'warn',
      message,
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}

function affectsThread(event: ArtifactVersionLifecycleEventV1, thread: TrackedThread): boolean {
  const versions = new Set(thread.versionIds)
  if (event.type === 'current-changed' || event.type === 'version-committed') {
    return Boolean(
      thread.artifactIds.includes(event.artifactId) ||
      versions.has(event.versionId) ||
      (event.previousVersionId && versions.has(event.previousVersionId))
    )
  }
  if (event.type === 'bundle-imported') return thread.artifactIds.includes(event.artifactId)
  if (
    event.type === 'availability-changed' ||
    event.type === 'artifact-moved' ||
    event.type === 'artifact-content-changed' ||
    event.type === 'artifact-missing' ||
    event.type === 'artifact-restored'
  ) {
    return versions.has(event.versionId) || Boolean(
      event.previousVersionId && versions.has(event.previousVersionId)
    )
  }
  return false
}

function lifecycleReceiptId(
  workspaceRoot: string,
  afterSequence: number,
  events: readonly ArtifactVersionLifecycleEventV1[]
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ workspaceRoot, afterSequence, events }))
    .digest('hex')
  return `artifact-lifecycle:${digest}`
}

function threadKey(runtimeId: string, threadId: string): string {
  return `${runtimeId}:${threadId}`
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function emptyState(): LifecycleStateFile {
  return { version: 2, workspaces: [], threads: [], receipts: [] }
}

function canonicalState(value: unknown): LifecycleStateFile {
  const source = record(value)
  if (!source || (source.version !== 1 && source.version !== 2)) {
    throw new Error('Evidence ArtifactVersion lifecycle state is invalid.')
  }
  if (
    !Array.isArray(source.workspaces) ||
    !Array.isArray(source.threads) ||
    !Array.isArray(source.receipts)
  ) {
    throw new Error('Evidence ArtifactVersion lifecycle state is incomplete.')
  }
  const workspaces = source.workspaces.flatMap((value) => {
    const item = record(value)
    const workspaceRoot = stringValue(item?.workspaceRoot)
    const cursor = nonnegativeInteger(item?.cursor)
    const updatedAt = validTimestamp(item?.updatedAt)
    return workspaceRoot && cursor !== undefined && updatedAt
      ? [{ workspaceRoot: resolve(workspaceRoot), cursor, updatedAt }]
      : []
  })
  const threads = source.threads.flatMap((value) => {
    const item = record(value)
    const key = stringValue(item?.key)
    const runtimeId = stringValue(item?.runtimeId)
    const threadId = stringValue(item?.threadId)
    const workspaceRoot = stringValue(item?.workspaceRoot)
    const targetWatermark = stringValue(item?.targetWatermark)
    const updatedAt = validTimestamp(item?.updatedAt)
    if (!key || !runtimeId || !threadId || !workspaceRoot || !targetWatermark || !updatedAt) {
      return []
    }
    return [{
      key,
      runtimeId,
      threadId,
      workspaceRoot: resolve(workspaceRoot),
      targetWatermark,
      artifactIds: stringArray(item?.artifactIds),
      versionIds: stringArray(item?.versionIds),
      updatedAt
    }]
  })
  const receipts = source.receipts.flatMap((value) => {
    const item = record(value)
    const receiptId = stringValue(item?.receiptId)
    const workspaceRoot = stringValue(item?.workspaceRoot)
    const afterSequence = nonnegativeInteger(item?.afterSequence)
    const lastSequence = nonnegativeInteger(item?.lastSequence)
    const processedAt = validTimestamp(item?.processedAt)
    if (
      !receiptId || !workspaceRoot || afterSequence === undefined ||
      lastSequence === undefined || !processedAt
    ) return []
    return [{
      receiptId,
      workspaceRoot: resolve(workspaceRoot),
      afterSequence,
      lastSequence,
      eventIds: stringArray(item?.eventIds),
      affectedThreadKeys: stringArray(item?.affectedThreadKeys),
      deltaDigests: source.version === 2
        ? stringArray(item?.deltaDigests)
        : [],
      processedAt
    }]
  })
  if (
    workspaces.length !== source.workspaces.length ||
    threads.length !== source.threads.length ||
    receipts.length !== source.receipts.length ||
    new Set(workspaces.map((item) => item.workspaceRoot)).size !== workspaces.length ||
    new Set(threads.map((item) => item.key)).size !== threads.length ||
    new Set(receipts.map((item) => item.receiptId)).size !== receipts.length
  ) {
    throw new Error('Evidence ArtifactVersion lifecycle state contains invalid records.')
  }
  return {
    version: 2,
    // v1 receipts represented queue acceptance, not durable delta commits.
    // Replaying from its cursor is therefore required during migration.
    workspaces: source.version === 1
      ? workspaces.map((item) => ({ ...item, cursor: 0 }))
      : workspaces,
    threads,
    receipts: source.version === 1 ? [] : receipts
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueSorted(value.flatMap((item) => stringValue(item) ? [stringValue(item)!] : []))
    : []
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function validTimestamp(value: unknown): string | undefined {
  const text = stringValue(value)
  return text && Number.isFinite(Date.parse(text)) ? text : undefined
}
