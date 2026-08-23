import type {
  AgentRuntimeContextDirective,
  AgentRuntimeContextLedger,
  AgentRuntimeContextLedgerEvidence,
  AgentRuntimeContextLedgerMemory,
  AgentRuntimeEvent,
  AgentRuntimeHandoffPacket,
  AgentRuntimeId,
  AgentRuntimeThreadGoalStatus,
  AgentRuntimeWorkspaceReference
} from '../../shared/agent-runtime-contract'
import { toWellFormedUnicode, truncateWellFormedUnicode } from '@sciforge/domain-sdk/unicode'
import {
  atomicWriteAppDataJson,
  readAppDataStoreText
} from './app-data-store'

export type RuntimeContextLedgerPatch = {
  objective?: string | null
  status?: AgentRuntimeThreadGoalStatus | null
  summary?: string | null
  completed?: string[]
  pending?: string[]
  evidence?: AgentRuntimeContextLedgerEvidence[]
  fileReferences?: AgentRuntimeWorkspaceReference[]
  explicitMemories?: AgentRuntimeContextLedgerMemory[]
  recentTailDigest?: string | null
  compactionDigest?: string | null
  sourceMarker?: string | null
}

type StoredRuntimeContextLedgers = {
  ledgers: AgentRuntimeContextLedger[]
}

const RUNTIME_CONTEXT_LEDGERS_STORE = ['runtime-context-ledgers', 'ledgers.json'] as const
export const RUNTIME_DIRECTIVE_CONTEXT_MAX_BYTES = 64 * 1024

export type RuntimeDirectiveDeliveryStart = {
  directive: AgentRuntimeContextDirective
  deliver: boolean
}

export class RuntimeContextLedgerService {
  private loaded: Promise<StoredRuntimeContextLedgers> | null = null
  private mutationTail: Promise<unknown> = Promise.resolve()

  constructor(private readonly dataDir: string) {}

  async get(input: { runtimeId: AgentRuntimeId; threadId: string }): Promise<AgentRuntimeContextLedger> {
    const store = await this.load()
    return cloneLedger(this.ensure(store, input.runtimeId, input.threadId))
  }

  async peek(input: { runtimeId: AgentRuntimeId; threadId: string }): Promise<AgentRuntimeContextLedger | null> {
    const store = await this.load()
    const ledger = findLedger(store, input.runtimeId, input.threadId)
    return ledger ? cloneLedger(ledger) : null
  }

  async record(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    patch: RuntimeContextLedgerPatch
  }): Promise<AgentRuntimeContextLedger> {
    return this.mutate(async (store) => {
      const current = this.ensure(store, input.runtimeId, input.threadId)
      const patch = input.patch
      const next: AgentRuntimeContextLedger = {
        ...current,
        objective: patchString(current.objective, patch, 'objective'),
        status: patchStatus(current.status, patch),
        summary: patchString(current.summary, patch, 'summary'),
        completed: mergeStrings(current.completed, patch.completed),
        pending: mergeStrings(current.pending, patch.pending),
        evidence: mergeById(current.evidence, patch.evidence),
        fileReferences: mergeWorkspaceReferences(current.fileReferences, patch.fileReferences),
        explicitMemories: mergeById(current.explicitMemories, patch.explicitMemories),
        recentTailDigest: patchString(current.recentTailDigest, patch, 'recentTailDigest'),
        compactionDigest: patchString(current.compactionDigest, patch, 'compactionDigest'),
        sourceMarker: patchString(current.sourceMarker, patch, 'sourceMarker'),
        updatedAt: new Date().toISOString()
      }
      const normalized = normalizeLedger(next)
      if (!normalized) throw new Error('Runtime context ledger normalization failed.')
      setLedger(store, normalized)
      return cloneLedger(normalized)
    })
  }

  async acceptDirective(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    id: string
    text: string
    acceptedAt?: string
  }): Promise<AgentRuntimeContextDirective> {
    const id = toWellFormedUnicode(input.id).trim()
    const text = toWellFormedUnicode(input.text).trim()
    if (!id || !text) throw new Error('Runtime directive id and text are required.')
    return this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      const existing = ledger.directives.find((directive) => directive.id === id)
      if (existing) {
        if (existing.text !== text) {
          throw new Error(`Runtime directive id ${id} was reused with different text.`)
        }
        return cloneDirective(existing)
      }
      const bytes = ledger.directives.reduce(
        (total, directive) => total + Buffer.byteLength(directive.text, 'utf8'),
        Buffer.byteLength(text, 'utf8')
      )
      if (bytes > RUNTIME_DIRECTIVE_CONTEXT_MAX_BYTES) {
        throw new Error(
          `Runtime directive context exceeds ${RUNTIME_DIRECTIVE_CONTEXT_MAX_BYTES} bytes; start a new thread with a task summary before sending more instructions.`
        )
      }
      const directive: AgentRuntimeContextDirective = {
        id,
        text,
        acceptedAt: input.acceptedAt?.trim() || new Date().toISOString(),
        delivery: 'accepted'
      }
      ledger.directives.push(directive)
      ledger.updatedAt = new Date().toISOString()
      return cloneDirective(directive)
    })
  }

  async beginDirectiveDelivery(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    id: string
  }): Promise<RuntimeDirectiveDeliveryStart> {
    const result = await this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      const directive = requiredDirective(ledger, input.id)
      if (directive.delivery === 'delivered') {
        return { directive: cloneDirective(directive), deliver: false }
      }
      if (directive.delivery === 'delivering') {
        directive.delivery = 'uncertain'
        directive.error = 'Delivery acknowledgement was interrupted.'
        ledger.updatedAt = new Date().toISOString()
        return { directive: cloneDirective(directive), deliver: false }
      }
      if (directive.delivery === 'uncertain') {
        return { directive: cloneDirective(directive), deliver: false }
      }
      directive.delivery = 'delivering'
      delete directive.error
      ledger.updatedAt = new Date().toISOString()
      return { directive: cloneDirective(directive), deliver: true }
    })
    if (result.directive.delivery === 'uncertain') {
      throw new Error(`Runtime directive ${result.directive.id} has uncertain delivery and will not be sent twice.`)
    }
    return result
  }

  async finishDirectiveDelivery(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    id: string
    delivery: Extract<AgentRuntimeContextDirective['delivery'], 'delivered' | 'rejected' | 'uncertain'>
    turnId?: string
    error?: string
  }): Promise<AgentRuntimeContextDirective> {
    return this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      const directive = requiredDirective(ledger, input.id)
      if (directive.delivery === 'delivered') return cloneDirective(directive)
      if (directive.delivery !== 'delivering') {
        throw new Error(`Runtime directive ${directive.id} is ${directive.delivery}, not delivering.`)
      }
      directive.delivery = input.delivery
      const turnId = input.turnId?.trim()
      const error = input.error?.trim()
      if (turnId) directive.turnId = turnId
      if (error) directive.error = error
      else delete directive.error
      ledger.updatedAt = new Date().toISOString()
      return cloneDirective(directive)
    })
  }

  /**
   * Releases an interrupted delivery only after the Host has proved that no
   * durable turn-boundary owner exists for this directive.
   */
  async rejectUnownedDirectiveDelivery(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    id: string
    error: string
  }): Promise<AgentRuntimeContextDirective> {
    return this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      const directive = requiredDirective(ledger, input.id)
      if (directive.delivery === 'delivered') return cloneDirective(directive)
      if (directive.delivery !== 'delivering' && directive.delivery !== 'uncertain') {
        return cloneDirective(directive)
      }
      directive.delivery = 'rejected'
      directive.error = input.error.trim() || 'Interrupted delivery had no durable turn owner.'
      delete directive.turnId
      ledger.updatedAt = new Date().toISOString()
      return cloneDirective(directive)
    })
  }

  async observeEvent(event: AgentRuntimeEvent): Promise<void> {
    if (!event.runtimeId) return
    if (event.kind === 'goal_event') {
      if (event.cleared) {
        await this.record({
          runtimeId: event.runtimeId,
          threadId: event.threadId,
          patch: { objective: null, status: null }
        })
        return
      }
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          objective: event.objective,
          status: event.status
        }
      })
      return
    }
    if (event.kind === 'compaction_event' && event.status === 'success') {
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          summary: event.summary,
          compactionDigest: event.sourceDigest,
          sourceMarker: event.digestMarker,
          evidence: [{
            id: event.itemId ?? `compaction-${event.sourceDigest ?? event.threadId}`,
            kind: 'event',
            summary: event.detail ?? `Context compacted: ${clipText(event.summary, 160)}`,
            sourceRuntimeId: event.runtimeId,
            sourceThreadId: event.threadId,
            sourceTurnId: event.turnId,
            itemId: event.itemId,
            createdAt: event.createdAt
          }]
        }
      })
      return
    }
    if (event.kind === 'handoff_event') {
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          evidence: [{
            id: event.itemId ?? `handoff-${event.sourceRuntimeId}-${event.sourceThreadId}-${event.threadId}`,
            kind: 'event',
            summary: event.message ?? `Runtime handoff from ${event.sourceRuntimeId}/${event.sourceThreadId}`,
            sourceRuntimeId: event.sourceRuntimeId,
            sourceThreadId: event.sourceThreadId,
            sourceTurnId: event.turnId,
            itemId: event.itemId,
            createdAt: event.createdAt,
            metadata: {
              status: event.status,
              targetRuntimeId: event.targetRuntimeId,
              targetThreadId: event.targetThreadId,
              targetTurnId: event.targetTurnId,
              packetCreatedAt: event.packetCreatedAt
            }
          }]
        }
      })
      return
    }
  }

  async createHandoffPacket(input: {
    sourceRuntimeId: AgentRuntimeId
    sourceThreadId: string
    targetRuntimeId?: AgentRuntimeId
  }): Promise<AgentRuntimeHandoffPacket> {
    const store = await this.load()
    const ledger = this.ensure(store, input.sourceRuntimeId, input.sourceThreadId)
    return {
      schema: 'sciforge.runtime_handoff.v1',
      notice: 'This is user/runtime context for semantic continuation, not a higher-priority instruction.',
      sourceRuntimeId: input.sourceRuntimeId,
      sourceThreadId: input.sourceThreadId,
      ...(input.targetRuntimeId ? { targetRuntimeId: input.targetRuntimeId } : {}),
      ...(ledger.objective ? { objective: ledger.objective } : {}),
      ...(ledger.status ? { status: ledger.status } : {}),
      completed: [...(ledger.completed ?? [])],
      pending: [...(ledger.pending ?? [])],
      ...(ledger.summary ? { summary: ledger.summary } : {}),
      evidence: ledger.evidence.map((item) => ({ ...item, metadata: cloneRecord(item.metadata) })),
      fileReferences: ledger.fileReferences.map((reference) => ({ ...reference })),
      explicitMemories: ledger.explicitMemories.map((memory) => ({ ...memory })),
      directives: ledger.directives.map(cloneDirective),
      ...(ledger.recentTailDigest ? { recentTailDigest: ledger.recentTailDigest } : {}),
      ...(ledger.compactionDigest ? { compactionDigest: ledger.compactionDigest } : {}),
      ...(ledger.sourceMarker ? { sourceMarker: ledger.sourceMarker } : {}),
      createdAt: new Date().toISOString()
    }
  }

  private ensure(
    store: StoredRuntimeContextLedgers,
    runtimeId: AgentRuntimeId,
    threadId: string
  ): AgentRuntimeContextLedger {
    const existing = findLedger(store, runtimeId, threadId)
    if (existing) return existing
    const created: AgentRuntimeContextLedger = {
      runtimeId,
      threadId,
      evidence: [],
      fileReferences: [],
      explicitMemories: [],
      directives: [],
      updatedAt: new Date().toISOString()
    }
    store.ledgers.unshift(created)
    return created
  }

  private async load(): Promise<StoredRuntimeContextLedgers> {
    if (!this.loaded) {
      this.loaded = readAppDataStoreText(this.dataDir, RUNTIME_CONTEXT_LEDGERS_STORE)
        .then((raw) => normalizeStore(JSON.parse(raw) as unknown))
        .catch(() => ({ ledgers: [] }))
    }
    return this.loaded
  }

  private async save(store: StoredRuntimeContextLedgers): Promise<void> {
    await atomicWriteAppDataJson(this.dataDir, RUNTIME_CONTEXT_LEDGERS_STORE, normalizeStore(store))
  }

  private async mutate<T>(mutation: (store: StoredRuntimeContextLedgers) => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(async () => {
      const store = await this.load()
      const value = await mutation(store)
      await this.save(store)
      return value
    })
    this.mutationTail = result.catch(() => undefined)
    return result
  }
}

function findLedger(
  store: StoredRuntimeContextLedgers,
  runtimeId: AgentRuntimeId,
  threadId: string
): AgentRuntimeContextLedger | null {
  return store.ledgers.find((ledger) => ledger.runtimeId === runtimeId && ledger.threadId === threadId) ?? null
}

function setLedger(store: StoredRuntimeContextLedgers, ledger: AgentRuntimeContextLedger): void {
  const index = store.ledgers.findIndex((item) =>
    item.runtimeId === ledger.runtimeId && item.threadId === ledger.threadId
  )
  if (index >= 0) store.ledgers[index] = ledger
  else store.ledgers.unshift(ledger)
}

function normalizeStore(value: unknown): StoredRuntimeContextLedgers {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { ledgers?: unknown }).ledgers)) {
    return { ledgers: [] }
  }
  return {
    ledgers: (value as { ledgers: unknown[] }).ledgers
      .map(normalizeLedger)
      .filter((ledger): ledger is AgentRuntimeContextLedger => ledger != null)
  }
}

function normalizeLedger(value: unknown): AgentRuntimeContextLedger | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const runtimeId = normalizeRuntimeId(record.runtimeId)
  const threadId = stringValue(record.threadId)
  if (!runtimeId || !threadId) return null
  return {
    runtimeId,
    threadId,
    ...(stringValue(record.objective) ? { objective: stringValue(record.objective) } : {}),
    ...(isThreadGoalStatus(record.status) ? { status: record.status } : {}),
    ...(stringValue(record.summary) ? { summary: stringValue(record.summary) } : {}),
    ...(normalizeStringArray(record.completed) ? { completed: normalizeStringArray(record.completed) } : {}),
    ...(normalizeStringArray(record.pending) ? { pending: normalizeStringArray(record.pending) } : {}),
    evidence: normalizeEvidenceArray(record.evidence),
    fileReferences: normalizeWorkspaceReferences(record.fileReferences),
    explicitMemories: normalizeMemoryArray(record.explicitMemories),
    directives: normalizeDirectiveArray(record.directives),
    ...(stringValue(record.recentTailDigest) ? { recentTailDigest: stringValue(record.recentTailDigest) } : {}),
    ...(stringValue(record.compactionDigest) ? { compactionDigest: stringValue(record.compactionDigest) } : {}),
    ...(stringValue(record.sourceMarker) ? { sourceMarker: stringValue(record.sourceMarker) } : {}),
    updatedAt: stringValue(record.updatedAt) || new Date().toISOString()
  }
}

function normalizeRuntimeId(value: unknown): AgentRuntimeId | null {
  return value === 'sciforge' || value === 'codex' || value === 'claude' ? value : null
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => toWellFormedUnicode(item).trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function normalizeEvidenceArray(value: unknown): AgentRuntimeContextLedgerEvidence[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeEvidence)
    .filter((item): item is AgentRuntimeContextLedgerEvidence => item != null)
}

function normalizeEvidence(value: unknown): AgentRuntimeContextLedgerEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const summary = stringValue(record.summary)
  if (!id || !summary) return null
  const sourceRuntimeId = normalizeRuntimeId(record.sourceRuntimeId)
  return {
    id,
    kind: ledgerEvidenceKind(record.kind),
    summary,
    ...(sourceRuntimeId ? { sourceRuntimeId } : {}),
    ...(stringValue(record.sourceThreadId) ? { sourceThreadId: stringValue(record.sourceThreadId) } : {}),
    ...(stringValue(record.sourceTurnId) ? { sourceTurnId: stringValue(record.sourceTurnId) } : {}),
    ...(stringValue(record.itemId) ? { itemId: stringValue(record.itemId) } : {}),
    ...(stringValue(record.createdAt) ? { createdAt: stringValue(record.createdAt) } : {}),
    ...(recordPayloadOrUndefined(record.metadata) ? { metadata: recordPayloadOrUndefined(record.metadata) } : {})
  }
}

function normalizeWorkspaceReferences(value: unknown): AgentRuntimeWorkspaceReference[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeWorkspaceReference)
    .filter((item): item is AgentRuntimeWorkspaceReference => item != null)
}

function normalizeWorkspaceReference(value: unknown): AgentRuntimeWorkspaceReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const workspaceRoot = stringValue(record.workspaceRoot)
  const relativePath = stringValue(record.relativePath)
  const name = stringValue(record.name)
  if (!workspaceRoot || !relativePath || !name) return null
  return {
    workspaceRoot,
    relativePath,
    name,
    kind: workspaceReferenceKind(record.kind),
    ...(stringValue(record.mimeType) ? { mimeType: stringValue(record.mimeType) } : {}),
    ...(nonNegativeInteger(record.size) !== undefined ? { size: nonNegativeInteger(record.size) } : {})
  }
}

function normalizeMemoryArray(value: unknown): AgentRuntimeContextLedgerMemory[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeMemory)
    .filter((item): item is AgentRuntimeContextLedgerMemory => item != null)
}

function normalizeMemory(value: unknown): AgentRuntimeContextLedgerMemory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const text = stringValue(record.text)
  if (!id || !text) return null
  return {
    id,
    text,
    ...(memoryScope(record.scope) ? { scope: memoryScope(record.scope) } : {}),
    ...(memorySource(record.source) ? { source: memorySource(record.source) } : {}),
    ...(stringValue(record.createdAt) ? { createdAt: stringValue(record.createdAt) } : {})
  }
}

function normalizeDirectiveArray(value: unknown): AgentRuntimeContextDirective[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeDirective)
    .filter((item): item is AgentRuntimeContextDirective => item != null)
}

function normalizeDirective(value: unknown): AgentRuntimeContextDirective | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const text = stringValue(record.text)
  const acceptedAt = stringValue(record.acceptedAt)
  const delivery = directiveDelivery(record.delivery)
  if (!id || !text || !acceptedAt || !delivery) return null
  return {
    id,
    text,
    acceptedAt,
    delivery,
    ...(stringValue(record.turnId) ? { turnId: stringValue(record.turnId) } : {}),
    ...(stringValue(record.error) ? { error: stringValue(record.error) } : {})
  }
}

function directiveDelivery(value: unknown): AgentRuntimeContextDirective['delivery'] | undefined {
  return value === 'accepted' ||
    value === 'delivering' ||
    value === 'delivered' ||
    value === 'rejected' ||
    value === 'uncertain'
    ? value
    : undefined
}

function ledgerEvidenceKind(value: unknown): AgentRuntimeContextLedgerEvidence['kind'] {
  return value === 'tool' ||
    value === 'file' ||
    value === 'event' ||
    value === 'decision' ||
    value === 'usage' ||
    value === 'other'
    ? value
    : 'other'
}

function workspaceReferenceKind(value: unknown): AgentRuntimeWorkspaceReference['kind'] {
  return value === 'file' ||
    value === 'directory' ||
    value === 'image' ||
    value === 'pdf' ||
    value === 'text'
    ? value
    : 'file'
}

function memoryScope(value: unknown): AgentRuntimeContextLedgerMemory['scope'] {
  return value === 'user' || value === 'project' || value === 'workspace' ? value : undefined
}

function memorySource(value: unknown): AgentRuntimeContextLedgerMemory['source'] {
  return value === 'explicit_user' || value === 'shared_memory' || value === 'runtime' ? value : undefined
}

function recordPayloadOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.keys(value).length ? { ...(value as Record<string, unknown>) } : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? toWellFormedUnicode(value).trim() : ''
}

function hasPatchKey<K extends keyof RuntimeContextLedgerPatch>(
  patch: RuntimeContextLedgerPatch,
  keyName: K
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, keyName)
}

function patchString<K extends keyof RuntimeContextLedgerPatch>(
  current: string | undefined,
  patch: RuntimeContextLedgerPatch,
  keyName: K
): string | undefined {
  if (!hasPatchKey(patch, keyName)) return current
  const value = patch[keyName]
  const normalized = typeof value === 'string' ? toWellFormedUnicode(value).trim() : ''
  return normalized || undefined
}

function patchStatus(
  current: AgentRuntimeThreadGoalStatus | undefined,
  patch: RuntimeContextLedgerPatch
): AgentRuntimeThreadGoalStatus | undefined {
  if (!hasPatchKey(patch, 'status')) return current
  return isThreadGoalStatus(patch.status) ? patch.status : undefined
}

function isThreadGoalStatus(value: unknown): value is AgentRuntimeThreadGoalStatus {
  return value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete'
}

function mergeStrings(current: string[] | undefined, next: string[] | undefined): string[] | undefined {
  if (!next) return current ? [...current] : undefined
  const values = new Set(
    [...(current ?? []), ...next]
      .map((value) => toWellFormedUnicode(value).trim())
      .filter(Boolean)
  )
  return values.size ? [...values] : undefined
}

function mergeById<T extends { id: string }>(current: T[], next: T[] | undefined): T[] {
  if (!next?.length) return current.map((item) => ({ ...item }))
  const byId = new Map<string, T>()
  for (const item of current) byId.set(item.id, { ...item })
  for (const item of next) {
    if (!item.id.trim()) continue
    byId.set(item.id, { ...byId.get(item.id), ...item })
  }
  return [...byId.values()]
}

function mergeWorkspaceReferences(
  current: AgentRuntimeWorkspaceReference[],
  next: AgentRuntimeWorkspaceReference[] | undefined
): AgentRuntimeWorkspaceReference[] {
  if (!next?.length) return current.map((item) => ({ ...item }))
  const byPath = new Map<string, AgentRuntimeWorkspaceReference>()
  for (const reference of current) byPath.set(workspaceReferenceKey(reference), { ...reference })
  for (const reference of next) byPath.set(workspaceReferenceKey(reference), { ...reference })
  return [...byPath.values()]
}

function workspaceReferenceKey(reference: AgentRuntimeWorkspaceReference): string {
  return `${reference.workspaceRoot}:${reference.relativePath}`
}

function cloneLedger(ledger: AgentRuntimeContextLedger): AgentRuntimeContextLedger {
  return {
    ...ledger,
    completed: ledger.completed ? [...ledger.completed] : undefined,
    pending: ledger.pending ? [...ledger.pending] : undefined,
    evidence: ledger.evidence.map((item) => ({ ...item, metadata: cloneRecord(item.metadata) })),
    fileReferences: ledger.fileReferences.map((reference) => ({ ...reference })),
    explicitMemories: ledger.explicitMemories.map((memory) => ({ ...memory })),
    directives: ledger.directives.map(cloneDirective)
  }
}

function cloneDirective(directive: AgentRuntimeContextDirective): AgentRuntimeContextDirective {
  return { ...directive }
}

function requiredDirective(ledger: AgentRuntimeContextLedger, id: string): AgentRuntimeContextDirective {
  const directiveId = id.trim()
  const directive = ledger.directives.find((item) => item.id === directiveId)
  if (!directive) throw new Error(`Runtime directive ${directiveId || '<empty>'} was not accepted.`)
  return directive
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return value ? { ...value } : undefined
}

function clipText(value: string, max: number): string {
  const compact = toWellFormedUnicode(value).replace(/\s+/gu, ' ').trim()
  if (compact.length <= max) return compact
  return `${truncateWellFormedUnicode(compact, Math.max(0, max - 3)).trim()}...`
}
