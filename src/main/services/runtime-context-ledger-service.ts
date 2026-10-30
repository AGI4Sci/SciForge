import { createHash } from 'node:crypto'
import { requireRegisteredRuntimeId } from '../runtime/agent-runtime/registered-runtime-identity'
import { canonicalizeJson } from '@sciforge/domain-sdk/canonical-json'
import {
  SessionAdmissionError, sessionInputReceiptSchema, sessionSubmissionFenceSchema,
  type SessionAdmissionRef, type SessionAdmissionSnapshot, type SessionInputReceipt,
  type SessionSubmissionAcquire, type SessionSubmissionRelease, type SessionQueuedInput,
  type SessionQueuedInputSnapshot, type SessionQueuedMutation, type SessionInputRecovery
} from '@sciforge/domain-sdk/agent-execution'
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
  inputRecoveryVersion?: 1
}

const RUNTIME_CONTEXT_LEDGERS_STORE = ['runtime-context-ledgers', 'ledgers.json'] as const

export type RuntimeDirectiveDeliveryStart = {
  directive: AgentRuntimeContextDirective
  deliver: boolean
}

export class RuntimeContextLedgerService {
  private currentStore: StoredRuntimeContextLedgers | null = null
  private loaded: Promise<StoredRuntimeContextLedgers> | null = null
  private mutationTail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly dataDir: string,
    private readonly runtimes: ReadonlyMap<AgentRuntimeId, unknown>
  ) {}

  /** A native context branch owns its past; derived summaries from the old future must not be injected. */
  async reset(input: { runtimeId: AgentRuntimeId; threadId: string }): Promise<void> {
    await this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      assertUnlocked(ledger)
      if (ledger.directives.some(inputBlocksSubmission)) throw new SessionAdmissionError('session_input_pending', 'Resolve Session input before resetting its context.')
      setLedger(store, { runtimeId: ledger.runtimeId, threadId: ledger.threadId,
        admissionRevision: (ledger.admissionRevision ?? 0) + 1, directives: [], evidence: [],
        fileReferences: [], explicitMemories: [], updatedAt: new Date().toISOString() })
    })
  }

  async get(input: { runtimeId: AgentRuntimeId; threadId: string }): Promise<AgentRuntimeContextLedger> {
    await this.mutationTail
    const store = await this.load()
    return cloneLedger(this.ensure(store, input.runtimeId, input.threadId))
  }

  async peek(input: { runtimeId: AgentRuntimeId; threadId: string }): Promise<AgentRuntimeContextLedger | null> {
    await this.mutationTail
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
      const normalized = normalizeLedger(next, this.runtimes)
      if (!normalized) throw new Error('Runtime context ledger normalization failed.')
      setLedger(store, normalized)
      return cloneLedger(normalized)
    })
  }

  async captureAdmissionLease(input: SessionAdmissionRef): Promise<() => void> {
    const snapshot = await this.readAdmission(input)
    return () => {
      const current = this.currentStore && findLedger(this.currentStore, requireRegisteredRuntimeId(this.runtimes, input.runtimeId), input.threadId)
      if (!current || (current.admissionRevision ?? 0) !== snapshot.revision) throw new SessionAdmissionError('admission_revision_conflict', 'Session input changed during human confirmation.')
    }
  }

  async completeInputRecovery(input: SessionInputRecovery): Promise<void> {
    await this.mutate(async (store) => {
      if (store.inputRecoveryVersion === input.version) return
      for (const recovered of input.inputs) {
        const ledger = this.ensure(store, recovered.runtimeId, recovered.threadId)
        assertUnlocked(ledger)
        const existing = ledger.directives.find((item) => item.id === recovered.clientDirectiveId)
        if (existing) {
          if (existing.text !== recovered.text) throw new SessionAdmissionError('input_immutable', 'Recovered input conflicts with an existing Runtime receipt.')
          continue
        }
        ledger.directives.push({ id: recovered.clientDirectiveId, text: recovered.text,
          acceptedAt: new Date().toISOString(), delivery: recovered.disposition === 'uncertain' ? 'uncertain' : 'rejected',
          queuePayload: { ...structuredClone(recovered.payload), legacyDispositionRequired: true },
          admission: { revision: 1, mode: 'queue', payloadDigest: digestPayload({ ...recovered.payload, legacyDispositionRequired: true }), execution: 'not_started' } })
        ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
      }
      store.inputRecoveryVersion = 1
    })
  }

  async readAdmission(input: SessionAdmissionRef): Promise<SessionAdmissionSnapshot> {
    await this.mutationTail
    const store = await this.load()
    const snapshot = admissionSnapshot(this.ensure(store, input.runtimeId, input.threadId))
    return store.inputRecoveryVersion === 1 ? snapshot : { ...snapshot, recovery: 'required' }
  }

  async readQueuedInputs(input: SessionAdmissionRef): Promise<readonly SessionQueuedInputSnapshot[]> {
    await this.mutationTail
    const store = await this.load()
    const ledger = this.ensure(store, input.runtimeId, input.threadId)
    return ledger.directives.filter(inputBlocksSubmission).map((item) => ({
        receipt: directiveReceipt(item), payload: structuredClone(item.queuePayload ?? {
          id: item.id, text: item.text, createdAt: item.acceptedAt, runtimeId: ledger.runtimeId, threadId: ledger.threadId,
          sendFailure: { userBlockId: item.id, message: 'The original Runtime operation requires receipt reconciliation before another send.' }
        })
      }))
  }

  async acceptQueuedInput(input: SessionQueuedInput, assertCurrent: (current: SessionAdmissionSnapshot) => void = () => undefined): Promise<SessionInputReceipt> {
    return this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      assertCurrent(admissionSnapshot(ledger))
      assertUnlocked(ledger)
      const existing = ledger.directives.find((item) => item.id === input.clientDirectiveId)
      const payloadDigest = digestPayload(input.payload)
      if (existing) {
        if (existing.queuePayload && existing.admission?.payloadDigest === payloadDigest) {
          if (existing.delivery === 'rejected') {
            if (existing.queuePayload.legacyDispositionRequired) throw new SessionAdmissionError('admission_recovery_required', 'Explicitly dispose of the legacy input before sending a new instruction.')
            if (input.expectedRevision !== existing.admission.revision) throw new SessionAdmissionError('input_revision_conflict', 'Retry requires the exact rejected input revision.')
            existing.delivery = 'accepted'
            existing.admission.execution = 'not_started'
            existing.admission.revision += 1
            ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
            delete existing.error
          }
          return directiveReceipt(existing)
        }
        if (input.expectedRevision === undefined || input.expectedRevision !== existing.admission?.revision) {
          throw new SessionAdmissionError('input_revision_conflict', 'Queued input changed; refresh before editing.')
        }
        if (existing.delivery !== 'accepted') throw new SessionAdmissionError('input_immutable', 'Dispatched input cannot be edited.')
        existing.text = input.text
        existing.queuePayload = structuredClone(input.payload)
        existing.admission = { revision: input.expectedRevision + 1, mode: 'queue', payloadDigest, execution: 'not_started' }
        ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
        return directiveReceipt(existing)
      }
      const directive: AgentRuntimeContextDirective = {
        id: input.clientDirectiveId, text: input.text, acceptedAt: new Date().toISOString(), delivery: 'accepted',
        queuePayload: structuredClone(input.payload),
        admission: { revision: 1, mode: 'queue', payloadDigest, execution: 'not_started' }
      }
      ledger.directives.push(directive)
      ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
      return directiveReceipt(directive)
    })
  }

  async abandonQueuedInput(input: SessionQueuedMutation, assertCurrent: (current: SessionAdmissionSnapshot) => void = () => undefined): Promise<void> {
    await this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      assertCurrent(admissionSnapshot(ledger))
      assertUnlocked(ledger)
      const item = requiredDirective(ledger, input.clientDirectiveId)
      if (item.admission?.revision !== input.expectedRevision) throw new SessionAdmissionError('input_revision_conflict', 'Input changed before abandonment.')
      if (!input.force && (item.delivery === 'delivering' || item.delivery === 'uncertain' || item.admission.execution === 'active' || item.admission.execution === 'output_pending')) {
        throw new SessionAdmissionError('admission_recovery_required', 'Reconcile the original Runtime operation before abandoning input.')
      }
      item.delivery = 'abandoned'
      item.admission.revision += 1
      delete item.queuePayload
      ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
    })
  }

  async acquireSubmission(input: SessionSubmissionAcquire, assertCurrent: (current: SessionAdmissionSnapshot) => void = () => undefined): Promise<SessionAdmissionSnapshot> {
    return this.mutate(async (store) => {
      if (store.inputRecoveryVersion !== 1) throw new SessionAdmissionError('admission_recovery_required', 'Restore the ordinary Session queue before submitting.')
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      assertCurrent(admissionSnapshot(ledger))
      if (ledger.submissionFence) {
        if (ledger.submissionFence.operationId === input.operationId && ledger.submissionFence.targetDigest === input.targetDigest) return admissionSnapshot(ledger)
        throw new SessionAdmissionError('submission_locked', 'This Session already has a submission in progress.')
      }
      if ((ledger.admissionRevision ?? 0) !== input.expectedRevision) throw new SessionAdmissionError('admission_revision_conflict', 'The Session changed after the candidate was frozen.')
      if (ledger.directives.some(inputBlocksSubmission)) throw new SessionAdmissionError('session_input_pending', 'Resolve pending input, Runtime delivery and output validation before submitting.')
      ledger.submissionFence = { operationId: input.operationId, targetDigest: input.targetDigest, acquiredAt: new Date().toISOString() }
      return admissionSnapshot(ledger)
    })
  }

  async releaseSubmission(input: SessionSubmissionRelease, assertCurrent: (current: SessionAdmissionSnapshot) => void = () => undefined): Promise<void> {
    await this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      assertCurrent(admissionSnapshot(ledger))
      if (!ledger.submissionFence || ledger.submissionFence.operationId !== input.operationId || ledger.submissionFence.targetDigest !== input.targetDigest) {
        throw new SessionAdmissionError('submission_identity_conflict', 'Submission release must identify the exact persisted operation and target.')
      }
      delete ledger.submissionFence
      ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
    })
  }

  async observeTurnOutput(input: SessionAdmissionRef & { turnId: string; clientDirectiveId?: string; state: 'completed' | 'failed' | 'cancelled'; validated: boolean }): Promise<void> {
    await this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      for (const item of ledger.directives) {
        if (item.turnId !== input.turnId && item.id !== input.clientDirectiveId) continue
        item.turnId = input.turnId
        if (!item.admission) item.admission = { revision: 0, mode: 'direct', payloadDigest: digestPayload(item.text), execution: 'output_pending' }
        item.admission.execution = input.validated ? input.state : 'output_pending'
        if (input.validated && input.state === 'completed') delete item.queuePayload
      }
    })
  }

  async acceptDirective(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    id: string
    text: string
    acceptedAt?: string
    mode?: 'direct' | 'steer'
    inputRevision?: number
    deliveryPayload?: Record<string, unknown>
    assertCurrent?: (current: SessionAdmissionSnapshot) => void
  }): Promise<AgentRuntimeContextDirective> {
    const id = toWellFormedUnicode(input.id).trim()
    const text = toWellFormedUnicode(input.text).trim()
    if (!id || !text) throw new Error('Runtime directive id and text are required.')
    return this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      input.assertCurrent?.(admissionSnapshot(ledger))
      const existing = ledger.directives.find((directive) => directive.id === id)
      if (existing) {
        if (existing.delivery === 'abandoned') throw new SessionAdmissionError('input_immutable', 'Abandoned input requires a new human send.')
        if (existing.delivery !== 'delivered') assertUnlocked(ledger)
        if (existing.queuePayload) {
          if (input.inputRevision !== existing.admission?.revision) throw new SessionAdmissionError('input_revision_conflict', 'Queued input changed before dispatch.')
          if (input.mode === 'steer' && (existing.queuePayload.guiPlan ||
            (Array.isArray(existing.queuePayload.attachmentIds) && existing.queuePayload.attachmentIds.length) ||
            (Array.isArray(existing.queuePayload.fileReferences) && existing.queuePayload.fileReferences.length))) {
            throw new SessionAdmissionError('input_immutable', 'Only plain queued text can be steered into an active turn.')
          }
          for (const key of input.mode === 'steer' ? [] : ['mode', 'model', 'reasoningEffort', 'serviceTier', 'permissionLevel', 'governanceProfile', 'workspaceLocator', 'attachmentIds', 'fileReferences']) {
            const expected = existing.queuePayload[key]
            if (expected !== undefined && canonicalizeJson(expected) !== canonicalizeJson(input.deliveryPayload?.[key] ?? null)) {
              throw new SessionAdmissionError('input_immutable', `Queued ${key} changed before dispatch.`)
            }
          }
        }
        if (existing.text !== text) {
          throw new Error(`Runtime directive id ${id} was reused with different text.`)
        }
        return cloneDirective(existing)
      }
      assertUnlocked(ledger)
      // Receipts are durable delivery history, not a model context window.
      // Retain them for idempotency without imposing a lifetime input budget.
      const metadata = recordPayloadOrUndefined(input.deliveryPayload?.metadata)
      const directive: AgentRuntimeContextDirective = {
        id,
        text,
        ...(metadata ? { metadata: structuredClone(metadata) } : {}),
        acceptedAt: input.acceptedAt?.trim() || new Date().toISOString(),
        delivery: 'accepted',
        admission: { revision: 1, mode: input.mode ?? 'direct', payloadDigest: digestPayload(text), execution: 'not_started' }
      }
      ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
      ledger.directives.push(directive)
      ledger.updatedAt = new Date().toISOString()
      return cloneDirective(directive)
    })
  }

  async beginDirectiveDelivery(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    id: string
    mode?: 'direct' | 'steer'
    assertCurrent?: (current: SessionAdmissionSnapshot) => void
  }): Promise<RuntimeDirectiveDeliveryStart> {
    const result = await this.mutate(async (store) => {
      const ledger = this.ensure(store, input.runtimeId, input.threadId)
      input.assertCurrent?.(admissionSnapshot(ledger))
      const directive = requiredDirective(ledger, input.id)
      if (directive.delivery === 'rejected' || directive.delivery === 'abandoned') throw new SessionAdmissionError('input_immutable', 'Explicitly retry or dispose of this input before dispatch.')
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
      assertUnlocked(ledger)
      directive.delivery = 'delivering'
      if (directive.admission) {
        directive.admission.execution = 'active'
        // Record the actual dispatch route atomically with delivery. A failed
        // preflight leaves queued input intact, and sent history is immutable.
        if (input.mode === 'steer' && directive.admission.mode === 'queue') directive.admission.mode = 'steer'
      }
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
      if (directive.admission && input.delivery === 'rejected') directive.admission.execution = 'failed'
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
   * Enumerates queued inputs stuck in a non-terminal delivery state so the
   * Host can reconcile only the ones whose Session has no live owner.
   */
  async listInterruptedQueuedInputs(): Promise<readonly { runtimeId: AgentRuntimeId; threadId: string; clientDirectiveId: string }[]> {
    await this.mutationTail
    const store = await this.load()
    const interrupted: { runtimeId: AgentRuntimeId; threadId: string; clientDirectiveId: string }[] = []
    for (const ledger of store.ledgers) {
      for (const item of ledger.directives) {
        if (item.admission?.mode !== 'queue') continue
        if (item.delivery !== 'uncertain' && item.delivery !== 'delivering') continue
        interrupted.push({ runtimeId: ledger.runtimeId, threadId: ledger.threadId, clientDirectiveId: item.id })
      }
    }
    return interrupted
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
      if (directive.admission) {
        directive.admission.execution = 'failed'
        directive.admission.revision += 1
      }
      directive.error = input.error.trim() || 'Interrupted delivery had no durable turn owner.'
      delete directive.turnId
      ledger.admissionRevision = (ledger.admissionRevision ?? 0) + 1
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
    await this.mutationTail
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
      ...(ledger.recentTailDigest ? { recentTailDigest: ledger.recentTailDigest } : {}),
      ...(ledger.compactionDigest ? { compactionDigest: ledger.compactionDigest } : {}),
      ...(ledger.sourceMarker ? { sourceMarker: ledger.sourceMarker } : {}),
      createdAt: new Date().toISOString()
    }
  }

  private ensure(
    store: StoredRuntimeContextLedgers,
    runtimeIdentity: string,
    threadId: string
  ): AgentRuntimeContextLedger {
    const runtimeId = requireRegisteredRuntimeId(this.runtimes, runtimeIdentity)
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
        .then((raw) => normalizeStore(JSON.parse(raw) as unknown, this.runtimes))
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ledgers: [] }
          throw error
        })
    }
    const store = await this.loaded
    this.currentStore = store
    return store
  }

  private async save(store: StoredRuntimeContextLedgers): Promise<void> {
    await atomicWriteAppDataJson(this.dataDir, RUNTIME_CONTEXT_LEDGERS_STORE, normalizeStore(store, this.runtimes))
  }

  private async mutate<T>(mutation: (store: StoredRuntimeContextLedgers) => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(async () => {
      const store = structuredClone(await this.load())
      const value = await mutation(store)
      try {
        await this.save(store)
      } catch (error) {
        // Rename may have committed before a later filesystem failure. Reload before retry.
        this.loaded = null
        this.currentStore = null
        throw error
      }
      this.currentStore = store
      this.loaded = Promise.resolve(store)
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

function normalizeStore(value: unknown, runtimes: ReadonlyMap<AgentRuntimeId, unknown>): StoredRuntimeContextLedgers {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { ledgers?: unknown }).ledgers)) {
    throw new Error('Runtime admission ledger is corrupt.')
  }
  const checkpoint = (value as { inputRecoveryVersion?: unknown }).inputRecoveryVersion
  if (checkpoint !== undefined && checkpoint !== 1) throw new Error('Unsupported Session input recovery checkpoint.')
  return {
    ...(checkpoint === 1 ? { inputRecoveryVersion: 1 as const } : {}),
    ledgers: (value as { ledgers: unknown[] }).ledgers
      .map((value) => {
        const ledger = normalizeLedger(value, runtimes)
        if (!ledger) throw new Error('Runtime admission ledger contains an invalid Session.')
        return ledger
      })
  }
}

function normalizeLedger(value: unknown, runtimes: ReadonlyMap<AgentRuntimeId, unknown>): AgentRuntimeContextLedger | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const runtimeId = requireRegisteredRuntimeId(runtimes, record.runtimeId)
  const threadId = stringValue(record.threadId)
  if (!threadId) return null
  return {
    runtimeId,
    threadId,
    ...(record.admissionRevision !== undefined ? { admissionRevision: requireRevision(record.admissionRevision) } : {}),
    ...(record.submissionFence !== undefined ? { submissionFence: sessionSubmissionFenceSchema.parse(record.submissionFence) } : {}),
    ...(stringValue(record.objective) ? { objective: stringValue(record.objective) } : {}),
    ...(isThreadGoalStatus(record.status) ? { status: record.status } : {}),
    ...(stringValue(record.summary) ? { summary: stringValue(record.summary) } : {}),
    ...(normalizeStringArray(record.completed) ? { completed: normalizeStringArray(record.completed) } : {}),
    ...(normalizeStringArray(record.pending) ? { pending: normalizeStringArray(record.pending) } : {}),
    evidence: normalizeEvidenceArray(record.evidence, runtimes),
    fileReferences: normalizeWorkspaceReferences(record.fileReferences),
    explicitMemories: normalizeMemoryArray(record.explicitMemories),
    directives: normalizeDirectiveArray(record.directives),
    ...(stringValue(record.recentTailDigest) ? { recentTailDigest: stringValue(record.recentTailDigest) } : {}),
    ...(stringValue(record.compactionDigest) ? { compactionDigest: stringValue(record.compactionDigest) } : {}),
    ...(stringValue(record.sourceMarker) ? { sourceMarker: stringValue(record.sourceMarker) } : {}),
    updatedAt: stringValue(record.updatedAt) || new Date().toISOString()
  }
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => toWellFormedUnicode(item).trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function normalizeEvidenceArray(value: unknown, runtimes: ReadonlyMap<AgentRuntimeId, unknown>): AgentRuntimeContextLedgerEvidence[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeEvidence(item, runtimes))
    .filter((item): item is AgentRuntimeContextLedgerEvidence => item != null)
}

function normalizeEvidence(value: unknown, runtimes: ReadonlyMap<AgentRuntimeId, unknown>): AgentRuntimeContextLedgerEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const summary = stringValue(record.summary)
  if (!id || !summary) return null
  const sourceRuntimeId = record.sourceRuntimeId === undefined ? undefined : requireRegisteredRuntimeId(runtimes, record.sourceRuntimeId)
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
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Runtime admission directives are corrupt.')
  return value.map((raw) => {
    const item = normalizeDirective(raw)
    if (!item) throw new Error('Runtime admission contains a corrupt directive.')
    return item
  })
}

function normalizeDirective(value: unknown): AgentRuntimeContextDirective | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const text = stringValue(record.text)
  const acceptedAt = stringValue(record.acceptedAt)
  const delivery = directiveDelivery(record.delivery)
  const metadata = recordPayloadOrUndefined(record.metadata)
  if (!id || !text || !acceptedAt || !delivery) return null
  const turnId = stringValue(record.turnId)
  // Pre-admission-schema records only carried a turnId once delivery was acknowledged.
  // The turn owner proves the input was delivered; synthesize the terminal receipt so
  // the queue projection and submission fence stop treating historical input as pending.
  const admission = record.admission !== undefined
    ? receiptMetadata(record.admission, id, delivery)
    : legacyDeliveredReceipt(delivery, turnId, text)
  return {
    id,
    text,
    acceptedAt,
    delivery,
    ...(metadata ? { metadata: structuredClone(metadata) } : {}),
    ...(admission ? { admission } : {}),
    ...(record.queuePayload !== undefined ? { queuePayload: requireQueuePayload(record.queuePayload) } : {}),
    ...(turnId ? { turnId } : {}),
    ...(stringValue(record.error) ? { error: stringValue(record.error) } : {})
  }
}

function legacyDeliveredReceipt(
  delivery: AgentRuntimeContextDirective['delivery'],
  turnId: string,
  text: string
): NonNullable<AgentRuntimeContextDirective['admission']> | undefined {
  if (delivery !== 'delivered' || !turnId) return undefined
  return { revision: 0, mode: 'direct', payloadDigest: digestPayload(text), execution: 'completed' }
}

function directiveDelivery(value: unknown): AgentRuntimeContextDirective['delivery'] | undefined {
  return value === 'accepted' ||
    value === 'delivering' ||
    value === 'delivered' ||
    value === 'rejected' ||
    value === 'uncertain' ||
    value === 'abandoned'
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
  return structuredClone(directive)
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

function digestPayload(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value)).digest('hex')
}
function assertUnlocked(ledger: AgentRuntimeContextLedger): void {
  if (ledger.submissionFence) throw new SessionAdmissionError('submission_locked', 'Submission is in progress. Keep this input unsent until editing is reopened.')
}
function directiveReceipt(item: AgentRuntimeContextDirective): SessionInputReceipt {
  return {
    clientDirectiveId: item.id,
    ...(item.admission ?? { revision: 0, mode: 'direct' as const, payloadDigest: digestPayload(item.text), execution: 'output_pending' as const }),
    delivery: item.delivery,
    ...(item.turnId ? { turnId: item.turnId } : {})
  }
}
function inputBlocksSubmission(item: AgentRuntimeContextDirective): boolean {
  return item.delivery !== 'abandoned' && !(item.delivery === 'delivered' &&
    ['completed', 'failed', 'cancelled'].includes(item.admission?.execution ?? ''))
}
function admissionSnapshot(ledger: AgentRuntimeContextLedger): SessionAdmissionSnapshot {
  return {
    revision: ledger.admissionRevision ?? 0,
    receipts: ledger.directives.map(directiveReceipt),
    submission: ledger.submissionFence ? { ...ledger.submissionFence } : null,
    recovery: ledger.directives.some((item) => item.delivery === 'uncertain' || item.delivery === 'delivering' || (!item.admission && item.delivery !== 'abandoned')) ? 'required' : 'ready'
  }
}
function requireRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid admission revision.')
  return value
}
function receiptMetadata(value: unknown, id: string, delivery: AgentRuntimeContextDirective['delivery']): NonNullable<AgentRuntimeContextDirective['admission']> {
  const receipt = sessionInputReceiptSchema.parse({ ...(value as object), clientDirectiveId: id, delivery })
  return { revision: receipt.revision, mode: receipt.mode, payloadDigest: receipt.payloadDigest, execution: receipt.execution }
}
function requireQueuePayload(value: unknown): NonNullable<AgentRuntimeContextDirective['queuePayload']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid queued input payload.')
  canonicalizeJson(value)
  return structuredClone(value) as NonNullable<AgentRuntimeContextDirective['queuePayload']>
}
