import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  DomainMainAfterTurnEvent,
  DomainMainDurableTurnBoundary,
  DomainMainDurableTurnBoundarySnapshot,
  DomainTurnArtifactEvent,
  DomainTurnFileEffectsV1,
  DomainTurnFilePatchReceiptV1
} from '@sciforge/domain-sdk/host'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import {
  definePrincipalContextSnapshot,
  definePrincipalSnapshot,
  samePrincipalContextSnapshot,
  samePrincipalSnapshot,
  type PrincipalContextSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import {
  isSensitiveWorkspacePath,
  TURN_FILE_CAPTURE_LIMITS,
  type TurnFileBaselineV1,
  type TurnFileCaptureIssueV1,
  type TurnFileMetadataV1
} from './turn-file-effect-capture'

const OUTBOX_VERSION = 6
const LEGACY_OUTBOX_VERSIONS = new Set([1, 2, 3, 4, 5])
const BOUNDARY_OWNERSHIP_VERSION = 4
const PRINCIPAL_ATTRIBUTION_VERSION = 5
const START_PHASE_VERSION = 6
const MAX_PENDING_TURNS = 1_000
const MAX_TERMINAL_RECEIPTS = 1_024
const MAX_ARTIFACT_RECEIPTS = 1_024
const MAX_RETIRED_ORDINAL_RANGES =
  MAX_PENDING_TURNS + MAX_TERMINAL_RECEIPTS + MAX_ARTIFACT_RECEIPTS + 1
const DEFAULT_MAX_SERIALIZED_BYTES = 64 * 1024 * 1024

type TurnArtifactIntentPayload = Readonly<{
  runtimeId: string
  threadId: string
  turnId: string
  /** Host-private correlation to the one accepted user directive. */
  clientDirectiveId?: string
  inputDigest?: string
  providerUserMessageItemId?: string
  bindingSource?: 'provider-accepted' | 'explicit-resolution'
  sequence?: number
  workspaceRoot?: string
  workspaceLocator?: WorkspaceLocator
  fileBaseline?: TurnFileBaselineV1
  fileEffects?: DomainTurnFileEffectsV1
  filePatchReceipts?: readonly DomainTurnFilePatchReceiptV1[]
  /** Host-captured at dispatch; null is an explicit signed-out attribution. */
  principal: PrincipalSnapshot | null
  /** Exact Host lease; null means legacy attribution was unknowable. */
  principalContext: PrincipalContextSnapshot | null
  occurredAt: string
}>

export type TurnArtifactIntent = TurnArtifactIntentPayload & Readonly<{
  /** Host-owned exact provider-delivery attempt. */
  issuerEpoch: string
  deliveryAttemptId: string
  deliveryAttemptOrdinal: number
  boundaryLeaseId: string
}>

/** Artifact-only replay envelope for records persisted before Host boundary ownership. */
export type TurnArtifactReplayIntent = Omit<
  TurnArtifactIntentPayload,
  'principal' | 'principalContext'
> & Readonly<{
  /** Missing only while replaying a pre-V5 artifact record. */
  principal?: PrincipalSnapshot | null
  /** Missing only in caller envelopes for legacy artifact-only replay. */
  principalContext?: PrincipalContextSnapshot | null
  deliveryAttemptId?: string
  issuerEpoch?: string
  deliveryAttemptOrdinal?: number
  boundaryLeaseId?: string
}>

/**
 * Durable acknowledgement that the Host accepted one exact turn and therefore
 * owes the artifact handoff a terminal observation.  It deliberately contains
 * no guessed sequence or completion time; those facts may only come from the
 * adapter's durable terminal event.
 */
export type TurnArtifactWatch = Readonly<{
  runtimeId: string
  threadId: string
  turnId: string
  /** Host-owned exact provider-delivery attempt. */
  issuerEpoch: string
  deliveryAttemptId: string
  deliveryAttemptOrdinal: number
  boundaryLeaseId: string
  /** Exact provider correlation when the adapter exposes it. */
  providerUserMessageItemId?: string
  bindingSource?: 'provider-accepted' | 'explicit-resolution'
  /** Absent only on legacy/unbound watches migrated from V1. */
  clientDirectiveId?: string
  inputDigest?: string
  workspaceRoot?: string
  workspaceLocator?: WorkspaceLocator
  fileBaseline?: TurnFileBaselineV1
  filePatchReceipts?: readonly DomainTurnFilePatchReceiptV1[]
  /** Host-captured at dispatch; null is an explicit signed-out attribution. */
  principal: PrincipalSnapshot | null
  /** Exact Host lease; null means legacy attribution was unknowable. */
  principalContext: PrincipalContextSnapshot | null
}>

export type PendingTurnArtifactWatch = TurnArtifactWatch & Readonly<{
  key: string
  registeredAt: string
}>

export type TurnArtifactStartPhase = 'prepared' | 'dispatching'

/** Pre-dispatch journal entry. It is not a completed turn and cannot fan out. */
export type TurnArtifactStart = Readonly<{
  runtimeId: string
  threadId: string
  clientDirectiveId: string
  issuerEpoch: string
  deliveryAttemptId: string
  deliveryAttemptOrdinal: number
  boundaryLeaseId: string
  inputDigest: string
  workspaceRoot?: string
  workspaceLocator?: WorkspaceLocator
  fileBaseline?: TurnFileBaselineV1
  /** Host-captured immediately before this durable start is registered. */
  principal: PrincipalSnapshot | null
  /** Exact signed-in or signed-out Host authorization lease at dispatch. */
  principalContext: PrincipalContextSnapshot | null
}>

export type TurnArtifactStartDraft = Omit<
  TurnArtifactStart,
  | 'issuerEpoch'
  | 'deliveryAttemptId'
  | 'deliveryAttemptOrdinal'
  | 'boundaryLeaseId'
>

export type PendingTurnArtifactStart = TurnArtifactStart & Readonly<{
  /**
   * `prepared` durably proves provider dispatch has not begun and is therefore
   * safe to release during recovery. `dispatching` is outcome-ambiguous until
   * it is bound to an accepted provider turn or authoritatively rejected.
   */
  phase: TurnArtifactStartPhase
  key: string
  registeredAt: string
}>

type TurnArtifactRecordBase = Readonly<{
  key: string
  intent: TurnArtifactReplayIntent
  attempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string
  error?: string
  legacyArtifactOnly?: true
}>

export type PendingTurnArtifactMaterialization = TurnArtifactRecordBase & Readonly<{
  stage: 'pending_materialization'
}>

export type PendingTurnArtifactFanout = TurnArtifactRecordBase & Readonly<{
  stage: 'pending_fanout'
  event: DomainTurnArtifactEvent
}>

export type TurnArtifactOutboxRecord =
  | PendingTurnArtifactMaterialization
  | PendingTurnArtifactFanout

type PersistedOutbox = Readonly<{
  version: typeof OUTBOX_VERSION
  starts: readonly PendingTurnArtifactStart[]
  watches: readonly PendingTurnArtifactWatch[]
  records: readonly TurnArtifactOutboxRecord[]
  receipts: readonly TurnArtifactTerminalReceipt[]
  lifecycleSettlements: readonly TurnLifecycleSettlementRecord[]
  lifecycleReceipts: readonly TurnLifecycleSettlementReceipt[]
  attemptIssuer: PersistedAttemptIssuer
}>

type PersistedAttemptIssuer = Readonly<{
  contractVersion: 1
  issuerEpoch: string
  nextOrdinal: number
  retiredThroughOrdinal: number
  retiredOrdinalRanges: readonly RetiredOrdinalRange[]
}>

type RetiredOrdinalRange = Readonly<{ first: number; last: number }>

type TurnLifecycleSettlementRecord = Readonly<{
  key: string
  event: DomainMainAfterTurnEvent
  attempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string
  error?: string
}>

type TurnLifecycleSettlementReceipt = Readonly<{
  key: string
  event: DomainMainAfterTurnEvent
  deliveredAt: string
}>

type TurnArtifactReceiptBase = Readonly<{
  key: string
  runtimeId: string
  threadId: string
  turnId: string
  issuerEpoch?: string
  deliveryAttemptId?: string
  deliveryAttemptOrdinal?: number
  boundaryLeaseId?: string
  clientDirectiveId?: string
  inputDigest?: string
  /** Irreversible binding; terminal tombstones never retain absolute paths. */
  workspaceBindingDigest?: string
  fileBaselineDigest?: string
  /** Retained bounded attribution so later lifecycle replay cannot rebind it. */
  principal?: PrincipalSnapshot
  /** Irreversible proof of the Host-captured Principal (including null). */
  principalDigest: string
  /** Retained exact signed-in/signed-out lease; absent for legacy unknown. */
  principalContext?: PrincipalContextSnapshot
  /** Irreversible proof of the exact lease, including legacy unknown null. */
  principalContextDigest: string
  /** Digest of the validated pre-context V5 intent; context has its own proof. */
  intentDigest: string
}>

type TurnArtifactDeliveryReceipt = TurnArtifactReceiptBase & Readonly<{
  outcome: 'delivered'
  deliveredAt: string
}>

type TurnArtifactLegacyMaterializationQuarantineReceipt =
  TurnArtifactReceiptBase & Readonly<{
    outcome: 'legacy_materialization_quarantined'
    firstSeenAt: string
    quarantinedAt: string
    attempts: number
    error: string
  }>

type TurnArtifactTerminalReceipt =
  | TurnArtifactDeliveryReceipt
  | TurnArtifactLegacyMaterializationQuarantineReceipt

type TurnArtifactDirectiveBinding = Readonly<{
  runtimeId: string
  threadId: string
  turnId: string
  deliveryAttemptId?: string
  boundaryLeaseId?: string
  clientDirectiveId?: string
  inputDigest?: string
}>

export type TurnArtifactOutboxOptions = Readonly<{
  /** Test seam for the post-rename directory durability barrier. */
  syncDirectory?: (directory: string) => Promise<void>
  /** Aggregate serialized journal budget; mutations fail before filesystem IO. */
  maxSerializedBytes?: number
  /** Test seam and soft bound for primary artifact receipts. */
  maxArtifactReceipts?: number
  /** Soft bound for delivered lifecycle receipts before safe retirement. */
  maxLifecycleReceipts?: number
}>

/** Host-owned, owner-only durable state for completed Agent turn handoff. */
export class TurnArtifactOutbox {
  readonly path: string
  #records = new Map<string, TurnArtifactOutboxRecord>()
  #receipts = new Map<string, TurnArtifactTerminalReceipt>()
  #watches = new Map<string, PendingTurnArtifactWatch>()
  #starts = new Map<string, PendingTurnArtifactStart>()
  #lifecycleSettlements = new Map<string, TurnLifecycleSettlementRecord>()
  #lifecycleReceipts = new Map<string, TurnLifecycleSettlementReceipt>()
  #attemptIssuer: PersistedAttemptIssuer
  #poisoned: Error | null = null
  #loaded = false
  #mutation: Promise<void> = Promise.resolve()
  readonly #syncDirectory: (directory: string) => Promise<void>
  readonly #maxSerializedBytes: number
  readonly #maxArtifactReceipts: number
  readonly #maxLifecycleReceipts: number

  constructor(userDataDir: string, options: TurnArtifactOutboxOptions = {}) {
    this.path = join(userDataDir, 'agent-runtime', 'turn-artifacts', 'outbox.json')
    this.#syncDirectory = options.syncDirectory ?? syncDirectory
    const maxSerializedBytes = options.maxSerializedBytes ?? DEFAULT_MAX_SERIALIZED_BYTES
    if (!Number.isSafeInteger(maxSerializedBytes) || maxSerializedBytes <= 0) {
      throw new Error('Turn artifact outbox serialized byte budget must be a positive safe integer.')
    }
    this.#maxSerializedBytes = maxSerializedBytes
    const maxArtifactReceipts = options.maxArtifactReceipts ?? MAX_ARTIFACT_RECEIPTS
    if (
      !Number.isSafeInteger(maxArtifactReceipts) ||
      maxArtifactReceipts <= 0 ||
      maxArtifactReceipts > MAX_ARTIFACT_RECEIPTS
    ) {
      throw new Error('Turn artifact receipt limit must be a positive safe integer.')
    }
    this.#maxArtifactReceipts = maxArtifactReceipts
    const maxLifecycleReceipts = options.maxLifecycleReceipts ?? MAX_TERMINAL_RECEIPTS
    if (
      !Number.isSafeInteger(maxLifecycleReceipts) ||
      maxLifecycleReceipts <= 0 ||
      maxLifecycleReceipts > MAX_TERMINAL_RECEIPTS
    ) {
      throw new Error('Turn lifecycle receipt limit must be a positive safe integer.')
    }
    this.#maxLifecycleReceipts = maxLifecycleReceipts
    this.#attemptIssuer = newAttemptIssuer()
  }

  /** A post-rename durability ambiguity permanently fail-stops this writer. */
  get poisonedError(): Error | null {
    return this.#poisoned
  }

  async load(): Promise<void> {
    if (this.#loaded) return
    await this.#mutate(async () => {
      if (this.#loaded) return
      let value: unknown
      try {
        const serialized = await readFile(this.path, 'utf8')
        this.#assertSerializedBudget(serialized)
        value = JSON.parse(serialized)
        await chmod(dirname(this.path), 0o700)
        await chmod(this.path, 0o600)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
        value = {
          version: OUTBOX_VERSION,
          starts: [],
          watches: [],
          records: [],
          receipts: [],
          lifecycleSettlements: [],
          lifecycleReceipts: [],
          attemptIssuer: newAttemptIssuer()
        }
      }
      const parsed = parseOutbox(value)
      this.#starts = new Map(parsed.starts.map((start) => [start.key, start]))
      this.#watches = new Map(parsed.watches.map((watch) => [watch.key, watch]))
      this.#records = new Map(parsed.records.map((record) => [record.key, record]))
      this.#receipts = new Map(parsed.receipts.map((receipt) => [receipt.key, receipt]))
      this.#lifecycleSettlements = new Map(
        parsed.lifecycleSettlements.map((record) => [record.key, record])
      )
      this.#lifecycleReceipts = new Map(
        parsed.lifecycleReceipts.map((receipt) => [receipt.key, receipt])
      )
      this.#attemptIssuer = parsed.attemptIssuer
      const artifactReceiptCount = this.#receipts.size
      const lifecycleReceiptCount = this.#lifecycleReceipts.size
      this.#retireDeliveredReceipts()
      if (
        parsed.migrate ||
        artifactReceiptCount !== this.#receipts.size ||
        lifecycleReceiptCount !== this.#lifecycleReceipts.size
      ) await this.#persist()
      this.#loaded = true
    })
  }

  async registerStart(input: TurnArtifactStartDraft): Promise<PendingTurnArtifactStart> {
    const draft = parseStartDraft(input)
    if (draft.principalContext === null) {
      throw new Error('A new turn requires an exact Principal context attribution.')
    }
    const key = turnArtifactStartKey(draft)
    await this.load()
    let pending: PendingTurnArtifactStart | undefined
    await this.#mutate(async () => {
      const existing = this.#starts.get(key)
      if (existing) {
        assertSameStartDraft(existing, draft, key)
        pending = existing
        return
      }
      assertDirectiveNotBound(
        draft,
        [...this.#watches.values()],
        [...this.#records.values()].map((record) => record.intent),
        this.#allArtifactReceipts().map(receiptBinding)
      )
      if (this.#starts.size + this.#watches.size + this.#records.size >= MAX_PENDING_TURNS) {
        throw new Error('Turn artifact capture journal is full.')
      }
      const issuerBefore = this.#attemptIssuer
      const attempt = issueDeliveryAttempt(this.#attemptIssuer)
      this.#attemptIssuer = attempt.issuer
      const created = Object.freeze({
        ...draft,
        issuerEpoch: attempt.issuerEpoch,
        deliveryAttemptId: attempt.deliveryAttemptId,
        deliveryAttemptOrdinal: attempt.deliveryAttemptOrdinal,
        boundaryLeaseId: `turn-boundary:${attempt.deliveryAttemptId}`,
        phase: 'prepared' as const,
        key,
        registeredAt: new Date().toISOString()
      })
      this.#starts.set(key, created)
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) {
          this.#starts.delete(key)
          this.#attemptIssuer = issuerBefore
        }
        throw error
      }
      pending = created
    })
    return pending!
  }

  pendingStarts(): readonly PendingTurnArtifactStart[] {
    return [...this.#starts.values()].sort(compareStarts)
  }

  /** Durably crosses the last safe pre-dispatch boundary. */
  async markStartDispatching(input: TurnArtifactStart): Promise<PendingTurnArtifactStart> {
    const start = parseStartInput(input)
    const startKey = turnArtifactStartKey(start)
    await this.load()
    let pending: PendingTurnArtifactStart | undefined
    await this.#mutate(async () => {
      this.#assertLiveIssuedAttempt(start)
      const current = this.#starts.get(startKey)
      if (!current) throw new Error(`Turn artifact start ${startKey} is missing.`)
      assertSameStart(current, start, startKey)
      if (current.phase === 'dispatching') {
        pending = current
        return
      }
      const updated = Object.freeze({
        ...current,
        phase: 'dispatching' as const
      })
      this.#starts.set(startKey, updated)
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) this.#starts.set(startKey, current)
        throw error
      }
      pending = updated
    })
    return pending!
  }

  async bindStart(input: TurnArtifactStart, watchInput: TurnArtifactWatch): Promise<boolean> {
    const start = parseStartInput(input)
    const startKey = turnArtifactStartKey(start)
    const unboundWatch = parseWatchInput(watchInput)
    if (
      (unboundWatch.clientDirectiveId !== undefined &&
        unboundWatch.clientDirectiveId !== start.clientDirectiveId) ||
      (unboundWatch.inputDigest !== undefined && unboundWatch.inputDigest !== start.inputDigest)
    ) {
      throw new Error('Turn artifact watch resolved from a different user directive.')
    }
    const watch = Object.freeze({
      ...unboundWatch,
      clientDirectiveId: start.clientDirectiveId,
      inputDigest: start.inputDigest,
      issuerEpoch: start.issuerEpoch,
      deliveryAttemptId: start.deliveryAttemptId,
      deliveryAttemptOrdinal: start.deliveryAttemptOrdinal,
      boundaryLeaseId: start.boundaryLeaseId,
      principal: start.principal,
      principalContext: start.principalContext,
      ...(start.fileBaseline ? { fileBaseline: start.fileBaseline } : {})
    })
    if (start.runtimeId !== watch.runtimeId || start.threadId !== watch.threadId) {
      throw new Error('Turn artifact start resolved outside its runtime/thread scope.')
    }
    if (
      start.workspaceRoot !== watch.workspaceRoot ||
      start.workspaceLocator?.contractVersion !== watch.workspaceLocator?.contractVersion ||
      start.workspaceLocator?.hostSessionId !== watch.workspaceLocator?.hostSessionId ||
      start.workspaceLocator?.path !== watch.workspaceLocator?.path
    ) {
      throw new Error('Turn artifact start resolved outside its workspace scope.')
    }
    const watchKey = turnArtifactIntentKey(watch)
    await this.load()
    let pending = false
    await this.#mutate(async () => {
      this.#assertLiveIssuedAttempt(start)
      this.#assertLiveIssuedAttempt(watch)
      const currentStart = this.#starts.get(startKey)
      if (currentStart) assertSameStart(currentStart, start, startKey)
      const existingWatch = this.#watches.get(watchKey)
      const record = this.#records.get(watchKey)
      const receipt = this.#artifactReceipt(watchKey)
      if (!currentStart) {
        if (existingWatch) assertSameWatch(existingWatch, watch, watchKey)
        if (record) assertWatchMatchesIntent(watch, record.intent, watchKey)
        if (receipt) assertWatchMatchesReceipt(watch, receipt, watchKey)
        if (existingWatch || record || receipt) return
        const conflictingSuccessor = [...this.#watches.values()].find(
          (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
        ) ?? [...this.#records.values()].map((candidate) => candidate.intent).find(
          (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
        ) ?? [...this.#receipts.values()].find(
          (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
        )
        if (conflictingSuccessor) {
          assertSameBoundaryIdentity(start, conflictingSuccessor)
          throw new Error('Turn artifact start resolution identity collision.')
        }
        const terminalSuccessor = [...this.#lifecycleSettlements.values()].map(
          (candidate) => candidate.event
        ).find(
          (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
        ) ?? [...this.#lifecycleReceipts.values()].map((candidate) => candidate.event).find(
          (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
        )
        if (terminalSuccessor) {
          assertSameBoundaryIdentity(start, terminalSuccessor)
          return
        }
        throw new Error(`Turn artifact start ${startKey} is missing.`)
      }
      if (currentStart.phase !== 'dispatching') {
        throw new Error('Turn artifact start must be marked dispatching before provider acceptance.')
      }
      assertDirectiveNotBound(
        start,
        [...this.#watches.values()].filter((candidate) => candidate.key !== watchKey),
        [...this.#records.values()]
          .filter((candidate) => candidate.key !== watchKey)
          .map((candidate) => candidate.intent),
        this.#allArtifactReceipts()
          .filter((candidate) => candidate.key !== watchKey)
          .map(receiptBinding)
      )
      if (existingWatch) {
        assertSameWatch(existingWatch, watch, watchKey)
      }
      if (record) assertWatchMatchesIntent(watch, record.intent, watchKey)
      if (receipt) assertWatchMatchesReceipt(watch, receipt, watchKey)
      const createdWatch = !existingWatch && !record && !receipt
        ? Object.freeze({ ...watch, key: watchKey, registeredAt: new Date().toISOString() })
        : undefined
      if (createdWatch) {
        this.#watches.set(watchKey, createdWatch)
        pending = true
      }
      if (currentStart) this.#starts.delete(startKey)
      if (!currentStart && !createdWatch) return
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) {
          if (createdWatch) this.#watches.delete(watchKey)
          if (currentStart) this.#starts.set(startKey, currentStart)
        }
        throw error
      }
    })
    return pending
  }

  /** Atomically rejects only a still-pending pre-dispatch start. */
  async rejectStart(
    input: TurnArtifactStart,
    settlementInput: DomainMainAfterTurnEvent
  ): Promise<boolean> {
    const start = parseStartInput(input)
    const startKey = turnArtifactStartKey(start)
    const event = bindLifecyclePrincipalContext(
      parseLifecycleSettlement(settlementInput),
      start.principal,
      start.principalContext
    )
    if (event.state !== 'rejected') {
      throw new Error('A pending turn start may only transition to rejected.')
    }
    assertSettlementMatchesBoundary(event, start)
    const lifecycleKey = turnLifecycleSettlementKey(event)
    await this.load()
    let applied = false
    await this.#mutate(async () => {
      this.#assertLiveIssuedAttempt(start)
      const currentStart = this.#starts.get(startKey)
      if (currentStart) assertSameStart(currentStart, start, startKey)
      const existingLifecycle = this.#lifecycleSettlements.get(lifecycleKey) ??
        this.#lifecycleReceipts.get(lifecycleKey)
      const resolvedOwner = [...this.#watches.values()].find(
        (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
      ) ?? [...this.#records.values()].map((record) => record.intent).find(
        (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
      ) ?? [...this.#receipts.values()].find(
        (candidate) => candidate.boundaryLeaseId === start.boundaryLeaseId
      )
      if (!currentStart) {
        const durableOwner = existingLifecycle?.event ?? resolvedOwner
        if (!durableOwner) {
          throw new Error(`Turn artifact start ${startKey} is missing.`)
        }
        assertSettlementMatchesBoundary(event, durableOwner)
        return
      }
      if (existingLifecycle || resolvedOwner) {
        throw new Error('Pending turn start has conflicting durable owners.')
      }
      if (this.#lifecycleSettlements.size >= MAX_PENDING_TURNS) {
        throw new Error('Turn lifecycle settlement outbox is full.')
      }
      const created = createLifecycleSettlementRecord(lifecycleKey, event)
      this.#starts.delete(startKey)
      this.#lifecycleSettlements.set(lifecycleKey, created)
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) {
          this.#lifecycleSettlements.delete(lifecycleKey)
          this.#starts.set(startKey, currentStart)
        }
        throw error
      }
      applied = true
    })
    return applied
  }

  pendingWatches(): readonly PendingTurnArtifactWatch[] {
    return [...this.#watches.values()].sort(compareWatches)
  }

  /** Durably appends Host-frozen executor-edge receipts before terminal capture. */
  async appendFilePatchReceipts(
    input: Pick<TurnArtifactWatch, 'runtimeId' | 'threadId' | 'turnId'>,
    values: readonly DomainTurnFilePatchReceiptV1[]
  ): Promise<void> {
    if (values.length === 0) return
    const key = turnArtifactIntentKey(input)
    const parsed = parseFilePatchReceipts(values)
    await this.load()
    await this.#mutate(async () => {
      const current = this.#watches.get(key)
      if (!current) {
        if (this.#records.has(key) || this.#artifactReceipt(key)) return
        throw new Error(`Accepted turn artifact watch ${key} is missing.`)
      }
      this.#assertLiveIssuedAttempt(current)
      const byIdentity = new Map(
        (current.filePatchReceipts ?? []).map((item) => [filePatchReceiptKey(item), item])
      )
      for (const receipt of parsed) {
        const identity = filePatchReceiptKey(receipt)
        const existing = byIdentity.get(identity)
        if (existing && JSON.stringify(existing) !== JSON.stringify(receipt)) {
          throw new Error(`Turn file-patch receipt collision: ${receipt.path}`)
        }
        byIdentity.set(identity, receipt)
      }
      const combined = parseFilePatchReceipts([...byIdentity.values()])
      const updated = Object.freeze({
        ...current,
        filePatchReceipts: combined
      })
      this.#watches.set(key, updated)
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) this.#watches.set(key, current)
        throw error
      }
    })
  }

  /** Atomically replaces the accepted-turn watch with its completed intent. */
  async completeWatch(input: TurnArtifactIntent): Promise<TurnArtifactOutboxRecord | undefined> {
    const submittedIntent = parseIntent(input)
    const key = turnArtifactIntentKey(submittedIntent)
    await this.load()
    await this.#mutate(async () => {
      this.#assertLiveIssuedAttempt(submittedIntent)
      const watch = this.#watches.get(key)
      if (watch) assertWatchMatchesIntent(watch, submittedIntent, key)
      const intent = watch?.filePatchReceipts?.length
        ? parseIntent({ ...submittedIntent, filePatchReceipts: watch.filePatchReceipts })
        : submittedIntent
      const existing = this.#records.get(key)
      if (existing) assertSameIntent(existing.intent, intent, key)
      const delivered = this.#artifactReceipt(key)
      if (delivered) assertReceiptMatchesIntent(delivered, intent, key)
      if (!watch && !existing && !delivered) {
        throw new Error(`Completed turn artifact intent ${key} has no accepted-turn watch.`)
      }
      if (
        !existing &&
        !delivered &&
        !watch &&
        this.#starts.size + this.#watches.size + this.#records.size >= MAX_PENDING_TURNS
      ) {
        throw new Error('Completed turn artifact outbox is full.')
      }
      const created: PendingTurnArtifactMaterialization | undefined = existing || delivered
        ? undefined
        : Object.freeze({
            key,
            intent,
            stage: 'pending_materialization',
            attempts: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
      const lifecycle = completedLifecycleSettlementForIntent(intent)
      const lifecycleKey = lifecycle ? turnLifecycleSettlementKey(lifecycle) : undefined
      const existingLifecycle = lifecycleKey
        ? this.#lifecycleSettlements.get(lifecycleKey) ?? this.#lifecycleReceipts.get(lifecycleKey)
        : undefined
      if (existingLifecycle && lifecycle) {
        assertSameLifecycleSettlement(existingLifecycle.event, lifecycle, lifecycleKey!)
      }
      if (lifecycle && !existingLifecycle && this.#lifecycleSettlements.size >= MAX_PENDING_TURNS) {
        throw new Error('Turn lifecycle settlement outbox is full.')
      }
      const createdLifecycle = lifecycle && lifecycleKey && !existingLifecycle
        ? createLifecycleSettlementRecord(lifecycleKey, lifecycle)
        : undefined
      if (created) this.#records.set(key, created)
      if (createdLifecycle) this.#lifecycleSettlements.set(lifecycleKey!, createdLifecycle)
      if (watch) this.#watches.delete(key)
      if (!created && !watch && !createdLifecycle) return
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) {
          if (created) this.#records.delete(key)
          if (createdLifecycle) this.#lifecycleSettlements.delete(lifecycleKey!)
          if (watch) this.#watches.set(key, watch)
        }
        throw error
      }
    })
    return this.#records.get(key)
  }

  async enqueueIntent(input: TurnArtifactIntent): Promise<TurnArtifactOutboxRecord | undefined> {
    return this.completeWatch(input)
  }

  record(key: string): TurnArtifactOutboxRecord | undefined {
    return this.#records.get(key)
  }

  all(): readonly TurnArtifactOutboxRecord[] {
    return [...this.#records.values()]
  }

  wasDelivered(key: string): boolean {
    return this.#artifactReceipt(key)?.outcome === 'delivered'
  }

  ready(now = Date.now()): readonly TurnArtifactOutboxRecord[] {
    return [...this.#records.values()]
      .filter((record) => (
        record.nextAttemptAt === undefined || Date.parse(record.nextAttemptAt) <= now
      ))
      .sort(compareRecords)
  }

  nextAttemptAt(): number | null {
    const values = [...this.#records.values(), ...this.#lifecycleSettlements.values()]
      .map((record) => record.nextAttemptAt ? Date.parse(record.nextAttemptAt) : Date.now())
      .filter(Number.isFinite)
    return values.length > 0 ? Math.min(...values) : null
  }

  async enqueueLifecycleSettlement(input: DomainMainAfterTurnEvent): Promise<void> {
    const submittedEvent = parseLifecycleSettlement(input)
    const key = turnLifecycleSettlementKey(submittedEvent)
    await this.load()
    await this.#mutate(async () => {
      this.#assertLiveIssuedAttempt(submittedEvent)
      const existing = this.#lifecycleSettlements.get(key)
      const receipt = this.#lifecycleReceipts.get(key)
      const matchingStart = [...this.#starts.values()].find(
        (candidate) => candidate.boundaryLeaseId === submittedEvent.boundaryLeaseId
      )
      const matchingWatch = [...this.#watches.values()].find(
        (candidate) => candidate.boundaryLeaseId === submittedEvent.boundaryLeaseId
      )
      const matchingIntent = [...this.#records.values()]
        .map((record) => record.intent)
        .find((candidate) => candidate.boundaryLeaseId === submittedEvent.boundaryLeaseId)
      const matchingArtifactReceipt = [...this.#receipts.values()].find(
        (candidate) => candidate.boundaryLeaseId === submittedEvent.boundaryLeaseId
      )
      const boundaryOwner = matchingStart ?? matchingWatch ?? matchingIntent ??
        existing?.event ?? receipt?.event ?? matchingArtifactReceipt
      if (!boundaryOwner) {
        throw new Error('Turn lifecycle settlement has no durable boundary owner.')
      }
      const event = bindLifecyclePrincipalContext(
        submittedEvent,
        principalFromBoundaryOwner(boundaryOwner),
        principalContextFromBoundaryOwner(boundaryOwner)
      )
      if (existing) {
        assertSameLifecycleSettlement(existing.event, event, key)
        return
      }
      if (receipt) {
        assertSameLifecycleSettlement(receipt.event, event, key)
        return
      }
      if (this.#lifecycleSettlements.size >= MAX_PENDING_TURNS) {
        throw new Error('Turn lifecycle settlement outbox is full.')
      }
      assertSettlementMatchesBoundary(event, boundaryOwner)
      if (matchingStart) this.#starts.delete(matchingStart.key)
      if (matchingWatch && event.state !== 'completed') this.#watches.delete(matchingWatch.key)
      const now = new Date().toISOString()
      this.#lifecycleSettlements.set(key, Object.freeze({
        key,
        event,
        attempts: 0,
        createdAt: now,
        updatedAt: now
      }))
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) {
          this.#lifecycleSettlements.delete(key)
          if (matchingStart) this.#starts.set(matchingStart.key, matchingStart)
          if (matchingWatch && event.state !== 'completed') {
            this.#watches.set(matchingWatch.key, matchingWatch)
          }
        }
        throw error
      }
    })
  }

  readyLifecycleSettlements(now = Date.now()): readonly TurnLifecycleSettlementRecord[] {
    return [...this.#lifecycleSettlements.values()]
      .filter((record) => (
        record.nextAttemptAt === undefined || Date.parse(record.nextAttemptAt) <= now
      ))
      .sort(compareLifecycleSettlements)
  }

  lifecycleSettlementsForThread(
    runtimeId: string,
    threadId: string
  ): readonly TurnLifecycleSettlementRecord[] {
    return [...this.#lifecycleSettlements.values()]
      .filter((record) => record.event.runtimeId === runtimeId && record.event.threadId === threadId)
      .sort(compareLifecycleSettlements)
  }

  recordsForThread(runtimeId: string, threadId: string): readonly TurnArtifactOutboxRecord[] {
    return [...this.#records.values()]
      .filter((record) => record.intent.runtimeId === runtimeId && record.intent.threadId === threadId)
      .sort(compareRecords)
  }

  unresolvedCapturesForThread(
    runtimeId: string,
    threadId: string
  ): readonly (PendingTurnArtifactStart | PendingTurnArtifactWatch)[] {
    return Object.freeze([
      ...[...this.#starts.values()].filter(
        (start) => start.runtimeId === runtimeId && start.threadId === threadId
      ),
      ...[...this.#watches.values()].filter(
        (watch) => watch.runtimeId === runtimeId && watch.threadId === threadId
      )
    ])
  }

  async markLifecycleSettlementFailed(
    key: string,
    error: unknown,
    retryAfterMs: number
  ): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#lifecycleSettlements.get(key)
      if (!current) return
      const now = Date.now()
      this.#lifecycleSettlements.set(key, Object.freeze({
        ...current,
        attempts: current.attempts + 1,
        updatedAt: new Date(now).toISOString(),
        nextAttemptAt: new Date(now + Math.max(0, retryAfterMs)).toISOString(),
        error: errorMessage(error).slice(0, 4_000)
      }))
      try {
        await this.#persist()
      } catch (persistError) {
        if (!isPostRenameDurabilityError(persistError)) {
          this.#lifecycleSettlements.set(key, current)
        }
        throw persistError
      }
    })
  }

  async markLifecycleSettlementDelivered(key: string): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#lifecycleSettlements.get(key)
      if (!current) return
      const receiptsBefore = new Map(this.#lifecycleReceipts)
      const artifactReceiptsBefore = new Map(this.#receipts)
      const attemptIssuerBefore = this.#attemptIssuer
      this.#lifecycleSettlements.delete(key)
      this.#lifecycleReceipts.set(key, Object.freeze({
        key,
        event: current.event,
        deliveredAt: new Date().toISOString()
      }))
      this.#retireDeliveredReceipts()
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) {
          this.#lifecycleSettlements.set(key, current)
          this.#lifecycleReceipts = receiptsBefore
          this.#receipts = artifactReceiptsBefore
          this.#attemptIssuer = attemptIssuerBefore
        }
        throw error
      }
    })
  }

  durableTurnBoundarySnapshot(): DomainMainDurableTurnBoundarySnapshot {
    this.#assertAttemptLedgerComplete()
    const values = new Map<string, DomainMainDurableTurnBoundary>()
    for (const start of this.#starts.values()) {
      setBoundarySnapshot(values, boundarySnapshot(start, 'pending-start', start.registeredAt))
    }
    for (const watch of this.#watches.values()) {
      if (!watch.boundaryLeaseId || !watch.deliveryAttemptId || !watch.clientDirectiveId) continue
      setBoundarySnapshot(values, boundarySnapshot({
        boundaryLeaseId: watch.boundaryLeaseId,
        issuerEpoch: watch.issuerEpoch,
        deliveryAttemptOrdinal: watch.deliveryAttemptOrdinal,
        deliveryAttemptId: watch.deliveryAttemptId,
        runtimeId: watch.runtimeId,
        threadId: watch.threadId,
        clientDirectiveId: watch.clientDirectiveId,
        ...(watch.principal ? { principal: watch.principal } : {}),
        ...(watch.principalContext ? { principalContext: watch.principalContext } : {}),
        ...(watch.workspaceRoot ? { workspaceRoot: watch.workspaceRoot } : {}),
        turnId: watch.turnId
      }, 'watching', watch.registeredAt))
    }
    for (const record of this.#records.values()) {
      const intent = record.intent
      if (!intent.boundaryLeaseId || !intent.deliveryAttemptId || !intent.clientDirectiveId) continue
      setBoundarySnapshot(values, boundarySnapshot(
        {
          boundaryLeaseId: intent.boundaryLeaseId,
          issuerEpoch: intent.issuerEpoch!,
          deliveryAttemptOrdinal: intent.deliveryAttemptOrdinal!,
          deliveryAttemptId: intent.deliveryAttemptId,
          runtimeId: intent.runtimeId,
          threadId: intent.threadId,
          clientDirectiveId: intent.clientDirectiveId,
          ...(intent.principal ? { principal: intent.principal } : {}),
          ...(intent.principalContext ? { principalContext: intent.principalContext } : {}),
          ...(intent.workspaceRoot ? { workspaceRoot: intent.workspaceRoot } : {}),
          turnId: intent.turnId
        },
        'completed-intent',
        record.updatedAt,
        'completed'
      ))
    }
    for (const receipt of this.#lifecycleReceipts.values()) {
      setBoundarySnapshot(values, boundarySnapshotFromSettlement(
        receipt.event,
        receipt.deliveredAt
      ))
    }
    for (const record of this.#lifecycleSettlements.values()) {
      setBoundarySnapshot(values, boundarySnapshotFromSettlement(
        record.event,
        record.updatedAt
      ))
    }
    const owners = Object.freeze([...values.values()].sort((left, right) => (
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.boundaryLeaseId.localeCompare(right.boundaryLeaseId)
    )))
    return Object.freeze({
      issuerEpoch: this.#attemptIssuer.issuerEpoch,
      nextDeliveryAttemptOrdinal: this.#attemptIssuer.nextOrdinal,
      retiredThroughOrdinal: this.#attemptIssuer.retiredThroughOrdinal,
      retiredOrdinalRanges: this.#attemptIssuer.retiredOrdinalRanges,
      owners
    })
  }

  #assertAttemptLedgerComplete(): void {
    assertAttemptLedgerComplete(this.#attemptIssuer, [
      ...this.#starts.values(),
      ...this.#watches.values(),
      ...[...this.#records.values()].map((record) => record.intent),
      ...this.#receipts.values(),
      ...[...this.#lifecycleSettlements.values()].map((record) => record.event),
      ...[...this.#lifecycleReceipts.values()].map((receipt) => receipt.event)
    ])
  }

  async markMaterialized(
    key: string,
    value: DomainTurnArtifactEvent
  ): Promise<PendingTurnArtifactFanout> {
    await this.load()
    let materialized: PendingTurnArtifactFanout | undefined
    await this.#mutate(async () => {
      const current = this.#records.get(key)
      if (!current) throw new Error(`Completed turn artifact intent ${key} is missing.`)
      if (current.stage === 'pending_fanout') {
        materialized = current
        return
      }
      // The lifecycle event can be emitted before the runtime adapter has an
      // authoritative workspace.  The materializer reads the completed thread
      // from the owning runtime, so it is the only place allowed to fill that
      // previously absent field.  Persist the binding together with the
      // immutable event; a pre-bound intent still requires an exact match.
      const materializedIntent = bindMaterializedWorkspace(value, current.intent)
      const event = parseTurnArtifactEvent(value, materializedIntent)
      const updated: PendingTurnArtifactFanout = Object.freeze({
        key: current.key,
        intent: materializedIntent,
        stage: 'pending_fanout',
        event,
        attempts: 0,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        ...(current.legacyArtifactOnly ? { legacyArtifactOnly: true as const } : {})
      })
      this.#records.set(key, updated)
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) this.#records.set(key, current)
        throw error
      }
      materialized = updated
    })
    return materialized!
  }

  async markFailed(key: string, error: unknown, retryAfterMs: number): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(key)
      if (!current) return
      const now = Date.now()
      const updated = Object.freeze({
        ...current,
        attempts: current.attempts + 1,
        updatedAt: new Date(now).toISOString(),
        nextAttemptAt: new Date(now + Math.max(0, retryAfterMs)).toISOString(),
        error: errorMessage(error).slice(0, 4_000)
      }) as TurnArtifactOutboxRecord
      this.#records.set(key, updated)
      try {
        await this.#persist()
      } catch (persistError) {
        if (!isPostRenameDurabilityError(persistError)) this.#records.set(key, current)
        throw persistError
      }
    })
  }

  /**
   * Durably terminates only an unmaterializable pre-boundary artifact record.
   * This is an explicit quarantine outcome, never a delivery acknowledgement.
   */
  async markLegacyMaterializationQuarantined(key: string, error: unknown): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(key)
      if (!current) return
      if (!current.legacyArtifactOnly || current.stage !== 'pending_materialization') {
        throw new Error(
          'Only a legacy artifact-only pending materialization may be quarantined.'
        )
      }
      const receiptsBefore = new Map(this.#receipts)
      const now = new Date().toISOString()
      const receipt = compactLegacyMaterializationQuarantineReceipt(
        current,
        error,
        now
      )
      this.#records.delete(key)
      this.#receipts.set(key, receipt)
      try {
        await this.#persist()
      } catch (persistError) {
        if (!isPostRenameDurabilityError(persistError)) {
          this.#records.set(key, current)
          this.#receipts = receiptsBefore
        }
        throw persistError
      }
    })
  }

  async markDelivered(key: string): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(key)
      if (!current) return
      const receiptsBefore = new Map(this.#receipts)
      const lifecycleReceiptsBefore = new Map(this.#lifecycleReceipts)
      const attemptIssuerBefore = this.#attemptIssuer
      const receipt = compactReceipt(current.intent, new Date().toISOString())
      this.#records.delete(key)
      this.#receipts.set(key, receipt)
      this.#retireDeliveredReceipts()
      try {
        await this.#persist()
      } catch (error) {
        if (!isPostRenameDurabilityError(error)) {
          this.#records.set(key, current)
          this.#receipts = receiptsBefore
          this.#lifecycleReceipts = lifecycleReceiptsBefore
          this.#attemptIssuer = attemptIssuerBefore
        }
        throw error
      }
    })
  }

  #artifactReceipt(key: string): TurnArtifactTerminalReceipt | undefined {
    return this.#receipts.get(key)
  }

  #allArtifactReceipts(): readonly TurnArtifactTerminalReceipt[] {
    return [...this.#receipts.values()]
  }

  #assertLiveIssuedAttempt(value: Readonly<{
    issuerEpoch?: string
    deliveryAttemptOrdinal?: number
    deliveryAttemptId?: string
    boundaryLeaseId?: string
  }>): void {
    if (
      !value.issuerEpoch ||
      value.deliveryAttemptOrdinal === undefined ||
      !value.deliveryAttemptId ||
      !value.boundaryLeaseId
    ) throw new Error('Turn delivery attempt requires an exact Host-issued identity.')
    assertIssuedAttempt(
      this.#attemptIssuer,
      value.issuerEpoch,
      value.deliveryAttemptOrdinal,
      value.deliveryAttemptId,
      value.boundaryLeaseId
    )
    if (isRetiredOrdinal(this.#attemptIssuer, value.deliveryAttemptOrdinal)) {
      throw new Error('Turn delivery attempt is permanently retired.')
    }
    const live = [
      ...this.#starts.values(),
      ...this.#watches.values(),
      ...[...this.#records.values()].map((record) => record.intent),
      ...this.#receipts.values(),
      ...[...this.#lifecycleSettlements.values()].map((record) => record.event),
      ...[...this.#lifecycleReceipts.values()].map((receipt) => receipt.event)
    ].filter((candidate) => candidate.deliveryAttemptOrdinal === value.deliveryAttemptOrdinal)
    if (live.length === 0) {
      throw new Error('Turn delivery attempt has no durable Host owner.')
    }
    if (live.some((candidate) => (
      candidate.issuerEpoch !== value.issuerEpoch ||
      candidate.deliveryAttemptId !== value.deliveryAttemptId ||
      candidate.boundaryLeaseId !== value.boundaryLeaseId
    ))) {
      throw new Error('Turn delivery-attempt ordinal identity collision.')
    }
  }

  #retireDeliveredReceipts(): void {
    let changed = true
    while (
      changed &&
      (
        this.#receipts.size > this.#maxArtifactReceipts ||
        this.#lifecycleReceipts.size > this.#maxLifecycleReceipts
      )
    ) {
      changed = false
      const lifecycleReceipts = [...this.#lifecycleReceipts.values()].sort((left, right) => (
        left.deliveredAt.localeCompare(right.deliveredAt) || left.key.localeCompare(right.key)
      ))
      for (const receipt of lifecycleReceipts) {
        const relatedArtifacts = [...this.#receipts.values()].filter((candidate) => (
          candidate.boundaryLeaseId === receipt.event.boundaryLeaseId
        ))
        const pressured = this.#lifecycleReceipts.size > this.#maxLifecycleReceipts || (
          this.#receipts.size > this.#maxArtifactReceipts && relatedArtifacts.length > 0
        )
        if (!pressured || !this.#canRetireBoundary(receipt.event.boundaryLeaseId)) continue
        const ordinal = receipt.event.deliveryAttemptOrdinal
        assertIssuedAttempt(
          this.#attemptIssuer,
          receipt.event.issuerEpoch,
          ordinal,
          receipt.event.deliveryAttemptId,
          receipt.event.boundaryLeaseId
        )
        this.#attemptIssuer = retireDeliveryAttemptOrdinal(this.#attemptIssuer, ordinal)
        for (const artifact of relatedArtifacts) {
          if (this.#records.has(artifact.key) || this.#watches.has(artifact.key)) continue
          this.#receipts.delete(artifact.key)
        }
        this.#lifecycleReceipts.delete(receipt.key)
        changed = true
        break
      }
      if (changed) continue
      // New Host-issued artifacts always have a lifecycle receipt and retire
      // atomically with it. Legacy artifact-only receipts intentionally remain
      // exact tombstones because they have no ordinal that can enter the exact
      // retirement ledger.
    }
  }

  #canRetireBoundary(boundaryLeaseId: string): boolean {
    return ![...this.#starts.values()].some((value) => value.boundaryLeaseId === boundaryLeaseId) &&
      ![...this.#watches.values()].some((value) => value.boundaryLeaseId === boundaryLeaseId) &&
      ![...this.#records.values()].some(
        (value) => value.intent.boundaryLeaseId === boundaryLeaseId
      ) &&
      ![...this.#lifecycleSettlements.values()].some(
        (value) => value.event.boundaryLeaseId === boundaryLeaseId
      )
  }

  async #persist(): Promise<void> {
    const payload: PersistedOutbox = {
      version: OUTBOX_VERSION,
      starts: [...this.#starts.values()].sort(compareStarts),
      watches: [...this.#watches.values()].sort(compareWatches),
      records: [...this.#records.values()].sort(compareRecords),
      receipts: [...this.#receipts.values()].sort((left, right) => (
        artifactReceiptTimestamp(left).localeCompare(artifactReceiptTimestamp(right)) ||
        left.key.localeCompare(right.key)
      )),
      lifecycleSettlements: [...this.#lifecycleSettlements.values()].sort(compareLifecycleSettlements),
      lifecycleReceipts: [...this.#lifecycleReceipts.values()].sort((left, right) => (
        left.deliveredAt.localeCompare(right.deliveredAt) || left.key.localeCompare(right.key)
      )),
      attemptIssuer: this.#attemptIssuer
    }
    const serialized = `${JSON.stringify(payload, null, 2)}\n`
    // Enforce before mkdir/open/rename so an oversized operation can be rolled
    // back without creating any ambiguous on-disk state or dispatching work.
    this.#assertSerializedBudget(serialized)
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    let renamed = false
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.path)
      renamed = true
      try {
        await this.#syncDirectory(directory)
      } catch (cause) {
        const error = new PostRenameDurabilityError(cause)
        this.#poisoned = error
        throw error
      }
    } finally {
      if (!renamed) await unlink(temporary).catch(() => undefined)
    }
  }

  #assertSerializedBudget(serialized: string): void {
    const bytes = Buffer.byteLength(serialized, 'utf8')
    if (bytes > this.#maxSerializedBytes) {
      throw new Error(
        `Turn artifact outbox exceeds its ${this.#maxSerializedBytes}-byte serialized capacity.`
      )
    }
  }

  async #mutate(operation: () => Promise<void>): Promise<void> {
    const guarded = async (): Promise<void> => {
      if (this.#poisoned) throw this.#poisoned
      await operation()
    }
    const pending = this.#mutation.then(guarded, guarded)
    this.#mutation = pending.catch(() => undefined)
    await pending
  }

}

export function turnArtifactIntentKey(intent: Pick<
  TurnArtifactIntent,
  'runtimeId' | 'threadId' | 'turnId'
>): string {
  const identity = [intent.runtimeId, intent.threadId, intent.turnId].join('\u0000')
  return `turn-artifact:${createHash('sha256').update(identity).digest('hex')}`
}

export function turnArtifactStartKey(start: Pick<
  TurnArtifactStart,
  'runtimeId' | 'threadId' | 'clientDirectiveId'
>): string {
  const identity = [start.runtimeId, start.threadId, start.clientDirectiveId].join('\u0000')
  return `turn-artifact-start:${createHash('sha256').update(identity).digest('hex')}`
}

function newAttemptIssuer(): PersistedAttemptIssuer {
  return Object.freeze({
    contractVersion: 1,
    issuerEpoch: `issuer-${randomBytes(16).toString('hex')}`,
    nextOrdinal: 1,
    retiredThroughOrdinal: 0,
    retiredOrdinalRanges: Object.freeze([])
  })
}

function issueDeliveryAttempt(issuer: PersistedAttemptIssuer): Readonly<{
  issuer: PersistedAttemptIssuer
  issuerEpoch: string
  deliveryAttemptId: string
  deliveryAttemptOrdinal: number
}> {
  const ordinal = issuer.nextOrdinal
  if (!Number.isSafeInteger(ordinal) || ordinal <= 0 || ordinal >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Turn delivery-attempt ordinal space is exhausted.')
  }
  const next = Object.freeze({
    ...issuer,
    nextOrdinal: ordinal + 1
  })
  return Object.freeze({
    issuer: next,
    issuerEpoch: issuer.issuerEpoch,
    deliveryAttemptOrdinal: ordinal,
    deliveryAttemptId: [
      'delivery-attempt',
      issuer.issuerEpoch,
      String(ordinal),
      randomBytes(16).toString('hex')
    ].join(':')
  })
}

function parseAttemptIssuer(value: unknown): PersistedAttemptIssuer {
  if (!isRecord(value) || value.contractVersion !== 1) {
    throw new Error('Turn delivery-attempt issuer state is missing or invalid.')
  }
  const issuerEpoch = parseIssuerEpoch(value.issuerEpoch)
  const nextOrdinal = positiveSafeInteger(value.nextOrdinal, 'nextOrdinal')
  const retiredThroughOrdinal = nonNegativeSafeInteger(
    value.retiredThroughOrdinal,
    'retiredThroughOrdinal'
  )
  if (!Array.isArray(value.retiredOrdinalRanges)) {
    throw new Error('Turn delivery-attempt retired ranges must be an array.')
  }
  const retiredOrdinalRanges = Object.freeze(value.retiredOrdinalRanges.map((candidate) => {
    if (!isRecord(candidate)) throw new Error('Turn delivery-attempt retired range is invalid.')
    const first = positiveSafeInteger(candidate.first, 'retiredOrdinalRanges.first')
    const last = positiveSafeInteger(candidate.last, 'retiredOrdinalRanges.last')
    if (first > last || last >= nextOrdinal) {
      throw new Error('Turn delivery-attempt retired range exceeds issued ordinals.')
    }
    return Object.freeze({ first, last })
  }))
  for (let index = 1; index < retiredOrdinalRanges.length; index += 1) {
    if (retiredOrdinalRanges[index - 1]!.last + 1 >= retiredOrdinalRanges[index]!.first) {
      throw new Error('Turn delivery-attempt retired ranges are not canonical.')
    }
  }
  if (retiredOrdinalRanges.length > MAX_RETIRED_ORDINAL_RANGES) {
    throw new Error('Turn delivery-attempt retired ranges exceed bounded active gaps.')
  }
  const expectedThrough = retiredOrdinalRanges[0]?.first === 1
    ? retiredOrdinalRanges[0].last
    : 0
  if (retiredThroughOrdinal !== expectedThrough) {
    throw new Error('Turn delivery-attempt retired prefix does not match its ranges.')
  }
  return Object.freeze({
    contractVersion: 1,
    issuerEpoch,
    nextOrdinal,
    retiredThroughOrdinal,
    retiredOrdinalRanges
  })
}

function retireDeliveryAttemptOrdinal(
  issuer: PersistedAttemptIssuer,
  ordinal: number
): PersistedAttemptIssuer {
  if (ordinal <= 0 || ordinal >= issuer.nextOrdinal) {
    throw new Error('Cannot retire an unissued turn delivery attempt.')
  }
  if (isRetiredOrdinal(issuer, ordinal)) return issuer
  const ranges = [...issuer.retiredOrdinalRanges, { first: ordinal, last: ordinal }]
    .sort((left, right) => left.first - right.first)
  const normalized: RetiredOrdinalRange[] = []
  for (const range of ranges) {
    const last = normalized.at(-1)
    if (last && range.first <= last.last + 1) {
      normalized[normalized.length - 1] = Object.freeze({
        first: last.first,
        last: Math.max(last.last, range.last)
      })
    } else {
      normalized.push(Object.freeze({ ...range }))
    }
  }
  if (normalized.length > MAX_RETIRED_ORDINAL_RANGES) {
    throw new Error('Turn delivery-attempt retired ranges exceed bounded active gaps.')
  }
  return Object.freeze({
    ...issuer,
    retiredThroughOrdinal: normalized[0]?.first === 1 ? normalized[0].last : 0,
    retiredOrdinalRanges: Object.freeze(normalized)
  })
}

function isRetiredOrdinal(issuer: PersistedAttemptIssuer, ordinal: number): boolean {
  return issuer.retiredOrdinalRanges.some((range) => ordinal >= range.first && ordinal <= range.last)
}

function assertIssuedAttempt(
  issuer: PersistedAttemptIssuer,
  issuerEpoch: string,
  ordinal: number,
  deliveryAttemptId: string,
  boundaryLeaseId: string
): void {
  if (issuerEpoch !== issuer.issuerEpoch || ordinal <= 0 || ordinal >= issuer.nextOrdinal) {
    throw new Error('Turn delivery attempt was not issued by this durable Host epoch.')
  }
  parseOptionalBoundaryBinding({
    issuerEpoch,
    deliveryAttemptOrdinal: ordinal,
    deliveryAttemptId,
    boundaryLeaseId
  })
}

type AttemptLedgerValue = Readonly<{
  issuerEpoch?: string
  deliveryAttemptId?: string
  deliveryAttemptOrdinal?: number
  boundaryLeaseId?: string
}>

function assertAttemptLedgerComplete(
  issuer: PersistedAttemptIssuer,
  values: readonly AttemptLedgerValue[]
): void {
  const live = new Map<number, string>()
  for (const value of values) {
    const hasAny = value.issuerEpoch !== undefined ||
      value.deliveryAttemptId !== undefined ||
      value.deliveryAttemptOrdinal !== undefined ||
      value.boundaryLeaseId !== undefined
    if (!hasAny) continue
    if (
      !value.issuerEpoch ||
      !value.deliveryAttemptId ||
      value.deliveryAttemptOrdinal === undefined ||
      !value.boundaryLeaseId
    ) throw new Error('Turn delivery-attempt ledger contains a partial identity.')
    assertIssuedAttempt(
      issuer,
      value.issuerEpoch,
      value.deliveryAttemptOrdinal,
      value.deliveryAttemptId,
      value.boundaryLeaseId
    )
    if (isRetiredOrdinal(issuer, value.deliveryAttemptOrdinal)) {
      throw new Error('Retired turn delivery attempt still has live durable state.')
    }
    const existing = live.get(value.deliveryAttemptOrdinal)
    if (existing && existing !== value.boundaryLeaseId) {
      throw new Error('Turn delivery-attempt ordinal binds multiple boundary leases.')
    }
    live.set(value.deliveryAttemptOrdinal, value.boundaryLeaseId)
  }
  const coverage = [
    ...issuer.retiredOrdinalRanges,
    ...[...live.keys()].map((ordinal) => ({ first: ordinal, last: ordinal }))
  ].sort((left, right) => left.first - right.first || left.last - right.last)
  let coveredThrough = 0
  for (const range of coverage) {
    if (range.first > coveredThrough + 1) {
      throw new Error(`Turn delivery-attempt ledger is missing ordinal ${coveredThrough + 1}.`)
    }
    coveredThrough = Math.max(coveredThrough, range.last)
  }
  if (coveredThrough !== issuer.nextOrdinal - 1) {
    throw new Error(`Turn delivery-attempt ledger is missing ordinal ${coveredThrough + 1}.`)
  }
}

function parseOutbox(value: unknown): PersistedOutbox & Readonly<{ migrate: boolean }> {
  const persistedVersion = isRecord(value) ? Number(value.version) : Number.NaN
  if (
    !isRecord(value) ||
    (value.version !== OUTBOX_VERSION && !LEGACY_OUTBOX_VERSIONS.has(Number(value.version))) ||
    (value.version === OUTBOX_VERSION && !Array.isArray(value.starts)) ||
    (value.version === OUTBOX_VERSION && !Array.isArray(value.watches)) ||
    (value.version === OUTBOX_VERSION && !Array.isArray(value.lifecycleSettlements)) ||
    (value.version === OUTBOX_VERSION && !Array.isArray(value.lifecycleReceipts)) ||
    (LEGACY_OUTBOX_VERSIONS.has(Number(value.version)) && value.starts !== undefined && !Array.isArray(value.starts)) ||
    (LEGACY_OUTBOX_VERSIONS.has(Number(value.version)) && value.watches !== undefined && !Array.isArray(value.watches)) ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.receipts)
  ) {
    throw new Error('Completed turn artifact outbox has an unsupported schema.')
  }
  const rawStarts = Array.isArray(value.starts) ? value.starts : []
  const rawWatches = Array.isArray(value.watches) ? value.watches : []
  const rawLifecycleSettlements = Array.isArray(value.lifecycleSettlements)
    ? value.lifecycleSettlements
    : []
  const rawLifecycleReceipts = Array.isArray(value.lifecycleReceipts)
    ? value.lifecycleReceipts
    : []
  const receiptsNeedCompaction = value.receipts.some((receipt) => (
    isRecord(receipt) && (
      receipt.intent !== undefined ||
      receipt.fileBaseline !== undefined ||
      receipt.fileEffects !== undefined ||
      receipt.workspaceRoot !== undefined ||
      receipt.workspaceLocator !== undefined
    )
  ))
  const principalContextNeedsMigration = [
    ...rawStarts,
    ...rawWatches,
    ...value.records.map((record) => isRecord(record) ? record.intent : undefined)
  ].some((owner) => (
    isRecord(owner) && !Object.prototype.hasOwnProperty.call(owner, 'principalContext')
  )) || value.receipts.some((receipt) => (
    isRecord(receipt) && !Object.prototype.hasOwnProperty.call(receipt, 'principalContextDigest')
  )) || [
    ...value.records.map((record) => (
      isRecord(record) && record.stage === 'pending_fanout' ? record.event : undefined
    )),
    ...rawLifecycleSettlements.map((record) => isRecord(record) ? record.event : undefined),
    ...rawLifecycleReceipts.map((receipt) => isRecord(receipt) ? receipt.event : undefined)
  ].some((event) => (
    isRecord(event) &&
    event.principal !== undefined &&
    !Object.prototype.hasOwnProperty.call(event, 'principalContext')
  ))
  // Pre-V4 captures have no Host delivery-attempt identity and therefore
  // cannot be authoritative boundary owners. Only completed artifact records
  // remain replayable across that migration boundary. V4 boundary owners stay
  // recoverable, but their missing attribution is normalized to fail-closed
  // signed-out state instead of being rebound to the current Principal.
  const preBoundaryOwnership = persistedVersion < BOUNDARY_OWNERSHIP_VERSION
  const legacyPrincipal = persistedVersion < PRINCIPAL_ATTRIBUTION_VERSION
  const legacyStartPhase = persistedVersion < START_PHASE_VERSION
  const legacyArtifactSchema = persistedVersion < PRINCIPAL_ATTRIBUTION_VERSION
  const starts = preBoundaryOwnership
    ? []
    : rawStarts.map((start) => parsePersistedStart(
        start,
        legacyPrincipal,
        legacyStartPhase
      ))
  const watches = preBoundaryOwnership
    ? []
    : rawWatches.map((watch) => parsePersistedWatch(watch, legacyPrincipal))
  if (starts.length + watches.length + value.records.length > MAX_PENDING_TURNS) {
    throw new Error('Accepted and completed turn artifact outbox exceeds its bounded capacity.')
  }
  if (new Set(watches.map((watch) => watch.key)).size !== watches.length) {
    throw new Error('Accepted turn artifact outbox contains duplicate watch keys.')
  }
  if (new Set(starts.map((start) => start.key)).size !== starts.length) {
    throw new Error('Turn artifact outbox contains duplicate start keys.')
  }
  if (value.records.length > MAX_PENDING_TURNS) {
    throw new Error('Completed turn artifact outbox exceeds its bounded capacity.')
  }
  const records = value.records.map((record) => parseRecord(
    record,
    legacyArtifactSchema || (isRecord(record) && record.legacyArtifactOnly === true)
  ))
  if (new Set(records.map((record) => record.key)).size !== records.length) {
    throw new Error('Completed turn artifact outbox contains duplicate intent keys.')
  }
  const receipts = value.receipts.map((receipt) => parseReceipt(
    receipt,
    legacyArtifactSchema,
    persistedVersion < OUTBOX_VERSION
  ))
  const receiptKeys = new Set(receipts.map((receipt) => receipt.key))
  if (receiptKeys.size !== receipts.length) {
    throw new Error('Completed turn artifact outbox contains duplicate delivery receipts.')
  }
  if (records.some((record) => receiptKeys.has(record.key))) {
    throw new Error('Completed turn artifact outbox contains pending and delivered duplicates.')
  }
  const pendingKeys = new Set(records.map((record) => record.key))
  if (watches.some((watch) => pendingKeys.has(watch.key) || receiptKeys.has(watch.key))) {
    throw new Error('Turn artifact outbox contains duplicate watch and completion state.')
  }
  const lifecycleSettlements = rawLifecycleSettlements.map((record) => (
    parseLifecycleSettlementRecord(record, legacyPrincipal)
  ))
  const lifecycleReceipts = rawLifecycleReceipts.map((receipt) => (
    parseLifecycleSettlementReceipt(receipt, legacyPrincipal)
  ))
  if (lifecycleSettlements.length > MAX_PENDING_TURNS) {
    throw new Error('Turn lifecycle settlement outbox exceeds its bounded capacity.')
  }
  const lifecycleReceiptKeys = new Set(lifecycleReceipts.map((receipt) => receipt.key))
  if (
    new Set(lifecycleSettlements.map((record) => record.key)).size !== lifecycleSettlements.length ||
    lifecycleReceiptKeys.size !== lifecycleReceipts.length ||
    lifecycleSettlements.some((record) => lifecycleReceiptKeys.has(record.key))
  ) {
    throw new Error('Turn lifecycle settlement outbox contains duplicate identities.')
  }
  assertUniqueDirectiveBindings([
    ...watches,
    ...records.map((record) => record.intent),
    ...receipts.map(receiptBinding)
  ])
  assertBoundaryPrincipalAttributionConsistent([
    ...starts,
    ...watches,
    ...records.map((record) => record.intent),
    ...receipts,
    ...lifecycleSettlements.map((record) => record.event),
    ...lifecycleReceipts.map((receipt) => receipt.event)
  ])
  const attemptIssuer = preBoundaryOwnership
    ? newAttemptIssuer()
    : parseAttemptIssuer(value.attemptIssuer)
  assertAttemptLedgerComplete(attemptIssuer, [
    ...starts,
    ...watches,
    ...records.map((record) => record.intent),
    ...receipts,
    ...lifecycleSettlements.map((record) => record.event),
    ...lifecycleReceipts.map((receipt) => receipt.event)
  ])
  return {
    version: OUTBOX_VERSION,
    starts,
    watches,
    records,
    receipts,
    lifecycleSettlements,
    lifecycleReceipts,
    attemptIssuer,
    migrate: value.version !== OUTBOX_VERSION ||
      receiptsNeedCompaction ||
      principalContextNeedsMigration
  }
}

function parseStartDraft(
  value: unknown,
  legacyPrincipal = false,
  persisted = false
): TurnArtifactStartDraft {
  if (!isRecord(value)) throw new Error('Turn artifact start must be an object.')
  const runtimeId = required(value.runtimeId, 'runtimeId')
  const threadId = required(value.threadId, 'threadId')
  const clientDirectiveId = required(value.clientDirectiveId, 'clientDirectiveId')
  const inputDigest = required(value.inputDigest, 'inputDigest')
  if (!/^sha256:[a-f0-9]{64}$/.test(inputDigest)) {
    throw new Error('Turn artifact start inputDigest must be a canonical SHA-256 digest.')
  }
  const workspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'workspaceRoot', 16_384)
  const workspaceLocator = parseWorkspaceLocator(value.workspaceLocator)
  const fileBaseline = parseFileBaseline(value.fileBaseline)
  const principal = parsePrincipalAttribution(value, legacyPrincipal)
  const principalContext = parsePrincipalContextAttribution(
    value,
    principal,
    legacyPrincipal,
    persisted
  )
  if (workspaceRoot && workspaceLocator && workspaceRoot !== workspaceLocator.path) {
    throw new Error('Turn artifact start workspace locator does not match workspaceRoot.')
  }
  return Object.freeze({
    runtimeId,
    threadId,
    clientDirectiveId,
    inputDigest,
    principal,
    principalContext,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(workspaceLocator ? { workspaceLocator } : {}),
    ...(fileBaseline ? { fileBaseline } : {})
  })
}

function parseStartInput(
  value: unknown,
  legacyPrincipal = false,
  persisted = false
): TurnArtifactStart {
  if (!isRecord(value)) throw new Error('Turn artifact start must be an object.')
  return Object.freeze({
    ...parseStartDraft(value, legacyPrincipal, persisted),
    ...parseRequiredBoundaryBinding(value)
  })
}

function parsePersistedStart(
  value: unknown,
  legacyPrincipal = false,
  legacyStartPhase = false
): PendingTurnArtifactStart {
  const start = parseStartInput(value, legacyPrincipal, true)
  if (!isRecord(value)) throw new Error('Turn artifact start must be an object.')
  const key = turnArtifactStartKey(start)
  if (value.key !== key) throw new Error('Turn artifact start has an invalid key.')
  return Object.freeze({
    ...start,
    phase: parseStartPhase(value.phase, legacyStartPhase),
    key,
    registeredAt: timestamp(value.registeredAt, 'registeredAt')
  })
}

function parseStartPhase(
  value: unknown,
  legacyStartPhase: boolean
): TurnArtifactStartPhase {
  if (value === 'prepared' || value === 'dispatching') return value
  if (legacyStartPhase && value === undefined) return 'dispatching'
  throw new Error('Turn artifact start phase is invalid.')
}

function parseWatchInput(
  value: unknown,
  legacyPrincipal = false,
  persisted = false
): TurnArtifactWatch {
  if (!isRecord(value)) throw new Error('Accepted turn artifact watch must be an object.')
  const runtimeId = required(value.runtimeId, 'runtimeId')
  const threadId = required(value.threadId, 'threadId')
  const turnId = required(value.turnId, 'turnId')
  const binding = parseDirectiveBinding(value)
  const boundary = parseRequiredBoundaryBinding(value)
  const workspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'workspaceRoot', 16_384)
  const workspaceLocator = parseWorkspaceLocator(value.workspaceLocator)
  const fileBaseline = parseFileBaseline(value.fileBaseline)
  const filePatchReceipts = parseFilePatchReceipts(value.filePatchReceipts)
  const providerUserMessageItemId = value.providerUserMessageItemId === undefined
    ? undefined
    : required(value.providerUserMessageItemId, 'providerUserMessageItemId', 4_096)
  const bindingSource = parseBindingSource(value.bindingSource)
  const principal = parsePrincipalAttribution(value, legacyPrincipal)
  const principalContext = parsePrincipalContextAttribution(
    value,
    principal,
    legacyPrincipal,
    persisted
  )
  if (workspaceRoot && workspaceLocator && workspaceRoot !== workspaceLocator.path) {
    throw new Error('Accepted turn artifact workspace locator does not match workspaceRoot.')
  }
  return Object.freeze({
    runtimeId,
    threadId,
    turnId,
    ...binding,
    ...boundary,
    principal,
    principalContext,
    ...(providerUserMessageItemId ? { providerUserMessageItemId } : {}),
    ...(bindingSource ? { bindingSource } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(workspaceLocator ? { workspaceLocator } : {}),
    ...(fileBaseline ? { fileBaseline } : {}),
    ...(filePatchReceipts.length ? { filePatchReceipts } : {})
  })
}

function parsePersistedWatch(
  value: unknown,
  legacyPrincipal = false
): PendingTurnArtifactWatch {
  const watch = parseWatchInput(value, legacyPrincipal, true)
  if (!isRecord(value)) throw new Error('Accepted turn artifact watch must be an object.')
  const key = turnArtifactIntentKey(watch)
  if (value.key !== key) throw new Error('Accepted turn artifact watch has an invalid key.')
  return Object.freeze({
    ...watch,
    key,
    registeredAt: timestamp(value.registeredAt, 'registeredAt')
  })
}

function parseWorkspaceLocator(value: unknown): WorkspaceLocator | undefined {
  if (value === undefined) return undefined
  if (
    !isRecord(value) ||
    value.contractVersion !== 1 ||
    typeof value.hostSessionId !== 'string' ||
    !value.hostSessionId.trim() ||
    typeof value.path !== 'string' ||
    !value.path.trim()
  ) {
    throw new Error('Accepted turn artifact workspaceLocator is invalid.')
  }
  return Object.freeze({
    contractVersion: 1,
    hostSessionId: value.hostSessionId.trim(),
    path: value.path.trim()
  })
}

function parsePrincipalAttribution(
  value: Record<string, unknown>,
  legacyPrincipal: boolean
): PrincipalSnapshot | null {
  if (!Object.prototype.hasOwnProperty.call(value, 'principal')) {
    if (legacyPrincipal) return null
    throw new Error('Turn artifact Principal attribution is required.')
  }
  if (value.principal === null) return null
  try {
    return definePrincipalSnapshot(value.principal as PrincipalSnapshot)
  } catch {
    throw new Error('Turn artifact Principal attribution is invalid.')
  }
}

function parseOptionalPrincipalSnapshot(value: unknown): PrincipalSnapshot {
  try {
    return definePrincipalSnapshot(value as PrincipalSnapshot)
  } catch {
    throw new Error('Turn lifecycle Principal attribution is invalid.')
  }
}

function parsePrincipalContextAttribution(
  value: Record<string, unknown>,
  principal: PrincipalSnapshot | null,
  legacyPrincipal: boolean,
  persisted: boolean
): PrincipalContextSnapshot | null {
  if (!Object.prototype.hasOwnProperty.call(value, 'principalContext')) {
    if (persisted) {
      if (legacyPrincipal) {
        if (principal !== null) {
          throw new Error('Legacy signed-in Principal attribution has no exact context.')
        }
        return null
      }
      if (principal === null) return null
      return definePrincipalContextSnapshot({
        identityVersion: principal.identityVersion,
        principal
      })
    }
    throw new Error('Turn artifact Principal context attribution is required.')
  }
  if (value.principalContext === null) {
    if (principal !== null) {
      throw new Error('A signed-in Principal requires an exact context attribution.')
    }
    return null
  }
  let context: PrincipalContextSnapshot
  try {
    context = definePrincipalContextSnapshot(value.principalContext as PrincipalContextSnapshot)
  } catch {
    throw new Error('Turn artifact Principal context attribution is invalid.')
  }
  const projected = context.principal
  if (
    (principal === null && projected !== null) ||
    (principal !== null && (
      projected === null || !samePrincipalSnapshot(principal, projected)
    ))
  ) {
    throw new Error('Turn artifact Principal projection does not match its context attribution.')
  }
  return context
}

function bindLifecyclePrincipalContext(
  event: DomainMainAfterTurnEvent,
  principal: PrincipalSnapshot | null,
  principalContext: PrincipalContextSnapshot | null
): DomainMainAfterTurnEvent {
  const {
    principal: _untrustedPrincipal,
    principalContext: _untrustedPrincipalContext,
    ...base
  } = event
  return Object.freeze({
    ...base,
    ...(principal ? { principal } : {}),
    ...(principalContext ? { principalContext } : {})
  }) as DomainMainAfterTurnEvent
}

function principalFromBoundaryOwner(value: unknown): PrincipalSnapshot | null {
  if (!isRecord(value) || value.principal === undefined || value.principal === null) return null
  return parseOptionalPrincipalSnapshot(value.principal)
}

function principalContextFromBoundaryOwner(value: unknown): PrincipalContextSnapshot | null {
  if (!isRecord(value) || value.principalContext === undefined || value.principalContext === null) {
    return null
  }
  return parseOptionalPrincipalContextSnapshot(value.principalContext)
}

function parseOptionalPrincipalContextSnapshot(value: unknown): PrincipalContextSnapshot {
  try {
    return definePrincipalContextSnapshot(value as PrincipalContextSnapshot)
  } catch {
    throw new Error('Turn lifecycle Principal context attribution is invalid.')
  }
}

function parseFileBaseline(value: unknown): TurnFileBaselineV1 | undefined {
  if (value === undefined) return undefined
  if (
    !isRecord(value) ||
    value.contractVersion !== 1 ||
    value.capture !== 'host-before-turn-metadata' ||
    typeof value.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    typeof value.digest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.digest) ||
    !Array.isArray(value.files) ||
    value.files.length > TURN_FILE_CAPTURE_LIMITS.maxFiles ||
    !Array.isArray(value.issues) ||
    value.issues.length > TURN_FILE_CAPTURE_LIMITS.maxDirectoryEntries
  ) throw new Error('Turn artifact fileBaseline is invalid.')
  const files = value.files.map(parseFileMetadata)
  if (new Set(files.map((item) => item.path)).size !== files.length) {
    throw new Error('Turn artifact fileBaseline contains duplicate paths.')
  }
  const issues = value.issues.map(parseFileCaptureIssue)
  return Object.freeze({
    contractVersion: 1,
    capture: 'host-before-turn-metadata',
    capturedAt: new Date(value.capturedAt).toISOString(),
    digest: value.digest,
    files: Object.freeze(files),
    issues: Object.freeze(issues)
  })
}

function parseFileEffects(value: unknown): DomainTurnFileEffectsV1 | undefined {
  if (value === undefined) return undefined
  if (
    !isRecord(value) ||
    value.contractVersion !== 1 ||
    value.capture !== 'host-turn-boundary' ||
    typeof value.baselineDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.baselineDigest) ||
    typeof value.baselineCapturedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.baselineCapturedAt)) ||
    typeof value.terminalCapturedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.terminalCapturedAt)) ||
    !Array.isArray(value.effects) ||
    value.effects.length > TURN_FILE_CAPTURE_LIMITS.maxEffects ||
    !Array.isArray(value.issues) ||
    value.issues.length > TURN_FILE_CAPTURE_LIMITS.maxDirectoryEntries
  ) throw new Error('Turn artifact fileEffects is invalid.')
  let snapshotBytes = 0
  const effects = value.effects.map((effect) => {
    if (!isRecord(effect) || effect.contractVersion !== 1) {
      throw new Error('Turn artifact file effect is invalid.')
    }
    const path = required(effect.path, 'fileEffects.effects.path', 8_192)
    // Quarantine by path before touching dataBase64. A forged sensitive
    // snapshot must never be decoded into process memory, even transiently.
    if (!portableRelativePath(path) || isSensitiveWorkspacePath(path)) {
      throw new Error('Turn artifact file effect path is invalid.')
    }
    if (!Number.isSafeInteger(effect.byteLength) || Number(effect.byteLength) < 0) {
      throw new Error('Turn artifact file effect byteLength is invalid.')
    }
    if (effect.kind === 'deleted') {
      if (typeof effect.baselineFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(effect.baselineFingerprint)) {
        throw new Error('Turn artifact deleted file effect identity is invalid.')
      }
      return Object.freeze({
        contractVersion: 1 as const,
        kind: 'deleted' as const,
        path,
        byteLength: Number(effect.byteLength),
        baselineFingerprint: effect.baselineFingerprint
      })
    }
    if (effect.kind !== 'created' && effect.kind !== 'modified') {
      throw new Error('Turn artifact file effect kind is invalid.')
    }
    if (
      typeof effect.contentDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(effect.contentDigest) ||
      typeof effect.dataBase64 !== 'string'
    ) throw new Error('Turn artifact file effect snapshot is invalid.')
    const bytes = Buffer.from(effect.dataBase64, 'base64')
    if (
      bytes.toString('base64') !== effect.dataBase64 ||
      bytes.byteLength !== effect.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== effect.contentDigest
    ) throw new Error('Turn artifact file effect snapshot digest is invalid.')
    snapshotBytes += bytes.byteLength
    if (snapshotBytes > TURN_FILE_CAPTURE_LIMITS.maxTotalSnapshotBytes) {
      throw new Error('Turn artifact file effects exceed the aggregate snapshot limit.')
    }
    return Object.freeze({
      contractVersion: 1 as const,
      kind: effect.kind,
      path,
      byteLength: bytes.byteLength,
      contentDigest: effect.contentDigest,
      ...(typeof effect.mediaType === 'string' && effect.mediaType.trim()
        ? { mediaType: effect.mediaType.trim() }
        : {}),
      dataBase64: effect.dataBase64
    })
  })
  const issues = value.issues.map(parseFileCaptureIssue)
  return Object.freeze({
    contractVersion: 1,
    capture: 'host-turn-boundary',
    baselineDigest: value.baselineDigest,
    baselineCapturedAt: new Date(value.baselineCapturedAt).toISOString(),
    terminalCapturedAt: new Date(value.terminalCapturedAt).toISOString(),
    effects: Object.freeze(effects),
    issues: Object.freeze(issues)
  })
}

function parseFilePatchReceipts(value: unknown): readonly DomainTurnFilePatchReceiptV1[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || value.length > TURN_FILE_CAPTURE_LIMITS.maxEffects) {
    throw new Error('Accepted turn artifact filePatchReceipts are invalid.')
  }
  let totalPatchBytes = 0
  const identities = new Set<string>()
  const values = value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.contractVersion !== 1 ||
      candidate.kind !== 'host-authenticated-file-patch' ||
      candidate.issuer !== 'sciforge.agent-runtime-host' ||
      candidate.source !== 'codex-app-server-file-change'
    ) throw new Error('Accepted turn artifact filePatchReceipt is invalid.')
    const callId = required(candidate.callId, 'filePatchReceipts.callId', 512)
    const path = required(candidate.path, 'filePatchReceipts.path', 8_192)
    const executorSequence = candidate.executorSequence
    const patchText = typeof candidate.patchText === 'string' ? candidate.patchText : ''
    const patchBytes = Buffer.byteLength(patchText, 'utf8')
    if (
      !portableRelativePath(path) ||
      isSensitiveWorkspacePath(path) ||
      callId.includes('\0') ||
      path.includes('\0') ||
      patchText.includes('\0') ||
      Buffer.from(patchText, 'utf8').toString('utf8') !== patchText ||
      (candidate.operation !== 'add' && candidate.operation !== 'update' && candidate.operation !== 'delete') ||
      (candidate.patchFormat !== 'full-content' && candidate.patchFormat !== 'unified-hunks') ||
      (candidate.operation === 'add' && candidate.patchFormat !== 'full-content') ||
      (candidate.operation !== 'add' && candidate.patchFormat !== 'unified-hunks') ||
      !Number.isSafeInteger(executorSequence) ||
      Number(executorSequence) <= 0 ||
      (candidate.operation !== 'add' && patchBytes <= 0) ||
      patchBytes > TURN_FILE_CAPTURE_LIMITS.maxFileBytes ||
      totalPatchBytes + patchBytes > TURN_FILE_CAPTURE_LIMITS.maxTotalSnapshotBytes ||
      typeof candidate.patchDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(candidate.patchDigest) ||
      createHash('sha256').update(patchText).digest('hex') !== candidate.patchDigest
    ) throw new Error('Accepted turn artifact filePatchReceipt fields are invalid.')
    totalPatchBytes += patchBytes
    const parsed = Object.freeze({
      contractVersion: 1 as const,
      kind: 'host-authenticated-file-patch' as const,
      issuer: 'sciforge.agent-runtime-host' as const,
      source: 'codex-app-server-file-change' as const,
      callId,
      executorSequence: Number(executorSequence),
      path,
      operation: candidate.operation,
      patchFormat: candidate.patchFormat,
      patchText,
      patchDigest: candidate.patchDigest
    })
    const identity = filePatchReceiptKey(parsed)
    if (identities.has(identity)) throw new Error('Accepted turn artifact has duplicate filePatchReceipts.')
    identities.add(identity)
    return parsed
  })
  return Object.freeze(values.sort(compareFilePatchReceipts))
}

function filePatchReceiptKey(value: DomainTurnFilePatchReceiptV1): string {
  return [value.executorSequence, value.callId, value.path, value.patchDigest].join('\0')
}

function compareFilePatchReceipts(
  left: DomainTurnFilePatchReceiptV1,
  right: DomainTurnFilePatchReceiptV1
): number {
  return left.executorSequence - right.executorSequence ||
    left.callId.localeCompare(right.callId) ||
    left.path.localeCompare(right.path) ||
    left.patchDigest.localeCompare(right.patchDigest)
}

function fileEffectsDigest(value: DomainTurnFileEffectsV1 | undefined): string | undefined {
  return value
    ? createHash('sha256').update(JSON.stringify(value)).digest('hex')
    : undefined
}

function parseFileMetadata(value: unknown): TurnFileMetadataV1 {
  if (!isRecord(value)) throw new Error('Turn artifact file metadata is invalid.')
  const path = required(value.path, 'fileBaseline.files.path', 8_192)
  if (!portableRelativePath(path)) throw new Error('Turn artifact file metadata path is invalid.')
  const size = value.size
  if (!Number.isSafeInteger(size) || Number(size) < 0) {
    throw new Error('Turn artifact file metadata size is invalid.')
  }
  const decimal = (field: string): string => {
    const candidate = value[field]
    if (typeof candidate !== 'string' || !/^\d+$/u.test(candidate)) {
      throw new Error(`Turn artifact file metadata ${field} is invalid.`)
    }
    return candidate
  }
  return Object.freeze({
    path,
    dev: decimal('dev'),
    ino: decimal('ino'),
    size: Number(size),
    mtimeNs: decimal('mtimeNs'),
    ctimeNs: decimal('ctimeNs')
  })
}

function parseFileCaptureIssue(value: unknown): TurnFileCaptureIssueV1 {
  if (!isRecord(value) || value.blocking !== true) {
    throw new Error('Turn artifact file baseline issue is invalid.')
  }
  const code = required(value.code, 'fileBaseline.issues.code', 128)
  const message = required(value.message, 'fileBaseline.issues.message', 4_000)
  const path = value.path === undefined ? undefined : required(value.path, 'fileBaseline.issues.path', 8_192)
  if (path && !portableRelativePath(path)) throw new Error('Turn artifact file baseline issue path is invalid.')
  return Object.freeze({ code, blocking: true, message, ...(path ? { path } : {}) })
}

function portableRelativePath(value: string): boolean {
  return !value.startsWith('/') &&
    !value.includes('\\') &&
    value.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')
}

function parseReceipt(
  value: unknown,
  legacy = false,
  legacyOutcome = legacy
): TurnArtifactTerminalReceipt {
  if (!isRecord(value)) throw new Error('Completed turn artifact receipt must be an object.')
  // V1/V2 kept the full immutable intent as the delivery tombstone. Migrate
  // those records in memory to a compact identity + digest before V3 persists.
  if (value.intent !== undefined) {
    const intent = parseIntent(value.intent, legacy, true)
    const key = turnArtifactIntentKey(intent)
    if (value.key !== key) throw new Error('Completed turn artifact receipt has an invalid key.')
    return compactReceipt(intent, timestamp(value.deliveredAt, 'deliveredAt'))
  }
  const runtimeId = required(value.runtimeId, 'receipt.runtimeId')
  const threadId = required(value.threadId, 'receipt.threadId')
  const turnId = required(value.turnId, 'receipt.turnId')
  const boundary = value.deliveryAttemptId === undefined
    ? {}
    : parseOptionalBoundaryBinding(value, legacy)
  const key = turnArtifactIntentKey({ runtimeId, threadId, turnId })
  if (value.key !== key) throw new Error('Completed turn artifact receipt has an invalid key.')
  const binding = parseDirectiveBinding(value)
  const legacyWorkspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'receipt.workspaceRoot', 16_384)
  const legacyWorkspaceLocator = parseWorkspaceLocator(value.workspaceLocator)
  if (
    legacyWorkspaceRoot && legacyWorkspaceLocator &&
    legacyWorkspaceRoot !== legacyWorkspaceLocator.path
  ) {
    throw new Error('Completed turn artifact receipt workspace locator does not match workspaceRoot.')
  }
  const persistedWorkspaceBindingDigest = value.workspaceBindingDigest === undefined
    ? undefined
    : digest(value.workspaceBindingDigest, 'receipt.workspaceBindingDigest')
  const workspaceBindingDigest = persistedWorkspaceBindingDigest ?? workspaceReceiptBindingDigest(
    legacyWorkspaceRoot,
    legacyWorkspaceLocator
  )
  const fileBaselineDigest = value.fileBaselineDigest === undefined
    ? undefined
    : digest(value.fileBaselineDigest, 'receipt.fileBaselineDigest')
  const intentDigest = digest(value.intentDigest, 'receipt.intentDigest')
  const principal = value.principal === undefined
    ? undefined
    : parseOptionalPrincipalSnapshot(value.principal)
  if (value.principalContext === null) {
    throw new Error('Completed turn artifact receipt Principal context is invalid.')
  }
  const principalContext = value.principalContext === undefined
    ? (!legacy && principal
        ? definePrincipalContextSnapshot({
            identityVersion: principal.identityVersion,
            principal
          })
        : undefined)
    : parseOptionalPrincipalContextSnapshot(value.principalContext)
  if (
    principalContext &&
    !samePrincipalAttribution(principal ?? null, principalContext.principal)
  ) {
    throw new Error('Completed turn artifact receipt Principal projection does not match its context.')
  }
  const principalDigest = value.principalDigest === undefined && legacy
    ? principalAttributionDigest(null)
    : digest(value.principalDigest, 'receipt.principalDigest')
  if (principalAttributionDigest(principal ?? null) !== principalDigest) {
    throw new Error('Completed turn artifact receipt Principal proof is invalid.')
  }
  const principalContextDigest = value.principalContextDigest === undefined
    ? principalContextAttributionDigest(principalContext ?? null)
    : digest(value.principalContextDigest, 'receipt.principalContextDigest')
  if (principalContextAttributionDigest(principalContext ?? null) !== principalContextDigest) {
    throw new Error('Completed turn artifact receipt Principal context proof is invalid.')
  }
  const receiptBase = {
    key,
    runtimeId,
    threadId,
    turnId,
    ...boundary,
    ...binding,
    ...(workspaceBindingDigest ? { workspaceBindingDigest } : {}),
    ...(fileBaselineDigest ? { fileBaselineDigest } : {}),
    ...(principal ? { principal } : {}),
    principalDigest,
    ...(principalContext ? { principalContext } : {}),
    principalContextDigest,
    intentDigest
  } satisfies TurnArtifactReceiptBase
  const outcome = value.outcome === undefined && legacyOutcome
    ? 'delivered'
    : value.outcome
  if (outcome === 'delivered') {
    return Object.freeze({
      ...receiptBase,
      outcome,
      deliveredAt: timestamp(value.deliveredAt, 'deliveredAt')
    })
  }
  if (outcome === 'legacy_materialization_quarantined') {
    if (
      receiptBase.deliveryAttemptId !== undefined ||
      receiptBase.deliveryAttemptOrdinal !== undefined ||
      receiptBase.issuerEpoch !== undefined ||
      receiptBase.boundaryLeaseId !== undefined
    ) {
      throw new Error('A quarantined legacy artifact receipt cannot own a Host boundary.')
    }
    const attempts = value.attempts
    if (!Number.isSafeInteger(attempts) || Number(attempts) <= 0) {
      throw new Error('A quarantined legacy artifact receipt requires positive attempts.')
    }
    return Object.freeze({
      ...receiptBase,
      outcome,
      firstSeenAt: timestamp(value.firstSeenAt, 'firstSeenAt'),
      quarantinedAt: timestamp(value.quarantinedAt, 'quarantinedAt'),
      attempts: Number(attempts),
      error: required(value.error, 'receipt.error', 4_000)
    })
  }
  throw new Error('Completed turn artifact receipt has an invalid outcome.')
}

function compactReceipt(
  intent: TurnArtifactReplayIntent,
  deliveredAt: string
): TurnArtifactDeliveryReceipt {
  return Object.freeze({
    ...compactReceiptBase(intent),
    outcome: 'delivered',
    deliveredAt
  })
}

function compactLegacyMaterializationQuarantineReceipt(
  record: PendingTurnArtifactMaterialization,
  error: unknown,
  quarantinedAt: string
): TurnArtifactLegacyMaterializationQuarantineReceipt {
  const message = errorMessage(error).slice(0, 4_000) ||
    'Legacy turn artifact materialization failed without an error message.'
  return Object.freeze({
    ...compactReceiptBase(record.intent),
    outcome: 'legacy_materialization_quarantined',
    firstSeenAt: record.createdAt,
    quarantinedAt,
    attempts: record.attempts + 1,
    error: message
  })
}

function compactReceiptBase(
  intent: TurnArtifactReplayIntent
): TurnArtifactReceiptBase {
  return Object.freeze({
    key: turnArtifactIntentKey(intent),
    runtimeId: intent.runtimeId,
    threadId: intent.threadId,
    turnId: intent.turnId,
    ...(intent.issuerEpoch ? { issuerEpoch: intent.issuerEpoch } : {}),
    deliveryAttemptId: intent.deliveryAttemptId,
    ...(intent.deliveryAttemptOrdinal === undefined
      ? {}
      : { deliveryAttemptOrdinal: intent.deliveryAttemptOrdinal }),
    boundaryLeaseId: intent.boundaryLeaseId,
    ...(intent.clientDirectiveId ? { clientDirectiveId: intent.clientDirectiveId } : {}),
    ...(intent.inputDigest ? { inputDigest: intent.inputDigest } : {}),
    ...(workspaceReceiptBindingDigest(intent.workspaceRoot, intent.workspaceLocator)
      ? {
          workspaceBindingDigest: workspaceReceiptBindingDigest(
            intent.workspaceRoot,
            intent.workspaceLocator
          )!
        }
      : {}),
    ...(intent.fileBaseline ? { fileBaselineDigest: intent.fileBaseline.digest } : {}),
    ...(intent.principal ? { principal: intent.principal } : {}),
    principalDigest: principalAttributionDigest(intent.principal ?? null),
    ...(intent.principalContext ? { principalContext: intent.principalContext } : {}),
    principalContextDigest: principalContextAttributionDigest(intent.principalContext ?? null),
    intentDigest: turnArtifactIntentDigest(intent)
  })
}

function artifactReceiptTimestamp(receipt: TurnArtifactTerminalReceipt): string {
  return receipt.outcome === 'delivered' ? receipt.deliveredAt : receipt.quarantinedAt
}

function receiptBinding(receipt: TurnArtifactTerminalReceipt): TurnArtifactDirectiveBinding {
  return Object.freeze({
    runtimeId: receipt.runtimeId,
    threadId: receipt.threadId,
    turnId: receipt.turnId,
    ...(receipt.deliveryAttemptId && receipt.boundaryLeaseId
      ? {
          deliveryAttemptId: receipt.deliveryAttemptId,
          boundaryLeaseId: receipt.boundaryLeaseId
        }
      : {}),
    ...(receipt.clientDirectiveId ? { clientDirectiveId: receipt.clientDirectiveId } : {}),
    ...(receipt.inputDigest ? { inputDigest: receipt.inputDigest } : {}),
    // Absolute workspace identity is intentionally not recoverable from a
    // delivered tombstone. Exact replays are guarded by intentDigest and new
    // watch attempts compare their independently computed binding below.
  })
}

function workspaceReceiptBindingDigest(
  workspaceRoot: string | undefined,
  workspaceLocator: WorkspaceLocator | undefined
): string | undefined {
  if (!workspaceRoot && !workspaceLocator) return undefined
  return createHash('sha256').update(JSON.stringify({
    workspaceRoot: workspaceRoot ?? null,
    workspaceLocator: workspaceLocator
      ? {
          contractVersion: workspaceLocator.contractVersion,
          hostSessionId: workspaceLocator.hostSessionId,
          path: workspaceLocator.path
        }
      : null
  })).digest('hex')
}

function turnArtifactIntentDigest(intent: TurnArtifactReplayIntent): string {
  // Preserve the existing V5 intent digest so principal-only receipts remain
  // replayable. The complete context is bound by its independent digest.
  const { principalContext: _principalContext, ...v5Intent } = intent
  return createHash('sha256').update(JSON.stringify(v5Intent)).digest('hex')
}

function principalAttributionDigest(principal: PrincipalSnapshot | null): string {
  return createHash('sha256').update(JSON.stringify(principal)).digest('hex')
}

function principalContextAttributionDigest(
  principalContext: PrincipalContextSnapshot | null
): string {
  return createHash('sha256').update(JSON.stringify(principalContext)).digest('hex')
}

function parseRecord(value: unknown, legacy = false): TurnArtifactOutboxRecord {
  if (!isRecord(value)) throw new Error('Completed turn artifact record must be an object.')
  const intent = parseIntent(value.intent, legacy, true)
  const expectedKey = turnArtifactIntentKey(intent)
  if (value.key !== expectedKey) {
    throw new Error('Completed turn artifact record has an invalid intent key.')
  }
  const stage = value.stage
  if (stage !== 'pending_materialization' && stage !== 'pending_fanout') {
    throw new Error('Completed turn artifact record has an invalid stage.')
  }
  const attempts = value.attempts
  if (!Number.isInteger(attempts) || Number(attempts) < 0) {
    throw new Error('Completed turn artifact attempts must be a non-negative integer.')
  }
  const createdAt = timestamp(value.createdAt, 'createdAt')
  const updatedAt = timestamp(value.updatedAt, 'updatedAt')
  const nextAttemptAt = value.nextAttemptAt === undefined
    ? undefined
    : timestamp(value.nextAttemptAt, 'nextAttemptAt')
  const base = {
    key: expectedKey,
    intent,
    stage,
    attempts: Number(attempts),
    createdAt,
    updatedAt,
    ...(legacy && !intent.deliveryAttemptId ? { legacyArtifactOnly: true as const } : {}),
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 4_000) } : {})
  }
  return stage === 'pending_materialization'
    ? Object.freeze(base as PendingTurnArtifactMaterialization)
    : Object.freeze({
        ...base,
        stage,
        event: parseTurnArtifactEvent(value.event, intent, legacy)
      } as PendingTurnArtifactFanout)
}

function parseIntent(
  value: unknown,
  legacy = false,
  persisted = false
): TurnArtifactReplayIntent {
  if (!isRecord(value)) throw new Error('Completed turn artifact intent must be an object.')
  const runtimeId = required(value.runtimeId, 'runtimeId')
  const threadId = required(value.threadId, 'threadId')
  const turnId = required(value.turnId, 'turnId')
  const binding = parseDirectiveBinding(value)
  const boundary = legacy
    ? parseOptionalBoundaryBinding(value, true)
    : parseRequiredBoundaryBinding(value)
  const occurredAt = timestamp(value.occurredAt, 'occurredAt')
  const sequence = value.sequence
  if (sequence !== undefined && (!Number.isSafeInteger(sequence) || Number(sequence) < 0)) {
    throw new Error('Completed turn artifact sequence must be a non-negative safe integer.')
  }
  const workspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'workspaceRoot', 16_384)
  const workspaceLocator = parseWorkspaceLocator(value.workspaceLocator)
  const fileBaseline = parseFileBaseline(value.fileBaseline)
  const fileEffects = parseFileEffects(value.fileEffects)
  const filePatchReceipts = parseFilePatchReceipts(value.filePatchReceipts)
  const providerUserMessageItemId = value.providerUserMessageItemId === undefined
    ? undefined
    : required(value.providerUserMessageItemId, 'providerUserMessageItemId', 4_096)
  const bindingSource = parseBindingSource(value.bindingSource)
  const principal = parsePrincipalAttribution(value, legacy)
  const principalContext = parsePrincipalContextAttribution(
    value,
    principal,
    legacy,
    persisted
  )
  if (
    filePatchReceipts.length > 0 &&
    (sequence === undefined || filePatchReceipts.some((receipt) => (
      receipt.executorSequence >= Number(sequence)
    )))
  ) {
    throw new Error('Completed turn artifact patch receipt sequence must precede terminal sequence.')
  }
  if (workspaceRoot && workspaceLocator && workspaceRoot !== workspaceLocator.path) {
    throw new Error('Completed turn artifact workspace locator does not match workspaceRoot.')
  }
  return Object.freeze({
    runtimeId,
    threadId,
    turnId,
    ...binding,
    ...boundary,
    principal,
    principalContext,
    ...(providerUserMessageItemId ? { providerUserMessageItemId } : {}),
    ...(bindingSource ? { bindingSource } : {}),
    ...(sequence === undefined ? {} : { sequence: Number(sequence) }),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(workspaceLocator ? { workspaceLocator } : {}),
    ...(fileBaseline ? { fileBaseline } : {}),
    ...(fileEffects ? { fileEffects } : {}),
    ...(filePatchReceipts.length ? { filePatchReceipts } : {}),
    occurredAt
  })
}

function parseTurnArtifactEvent(
  value: unknown,
  intent: TurnArtifactReplayIntent,
  legacy = false
): DomainTurnArtifactEvent {
  if (!isRecord(value) || value.contractVersion !== 1 || value.kind !== 'turn-completed') {
    throw new Error('Materialized turn artifact event has an invalid contract.')
  }
  if (
    value.runtimeId !== intent.runtimeId ||
    value.threadId !== intent.threadId ||
    value.turnId !== intent.turnId ||
    value.issuerEpoch !== intent.issuerEpoch ||
    value.deliveryAttemptOrdinal !== intent.deliveryAttemptOrdinal ||
    value.deliveryAttemptId !== intent.deliveryAttemptId ||
    value.boundaryLeaseId !== intent.boundaryLeaseId ||
    value.clientDirectiveId !== intent.clientDirectiveId
  ) {
    throw new Error('Materialized turn artifact event does not match its durable intent.')
  }
  const targetWatermark = required(value.targetWatermark, 'targetWatermark')
  const occurredAt = timestamp(value.occurredAt, 'occurredAt')
  const sequence = value.sequence
  if (sequence !== undefined && (!Number.isSafeInteger(sequence) || Number(sequence) < 0)) {
    throw new Error('Materialized turn artifact event has an invalid sequence.')
  }
  const workspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'workspaceRoot', 16_384)
  const expectedTargetWatermark = String(intent.sequence ?? intent.turnId)
  if (
    sequence !== intent.sequence ||
    workspaceRoot !== intent.workspaceRoot ||
    occurredAt !== intent.occurredAt ||
    targetWatermark !== expectedTargetWatermark
  ) {
    throw new Error('Materialized turn artifact event envelope does not match its durable intent.')
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length > 100_000) {
    throw new Error('Materialized turn artifact event has invalid artifacts.')
  }
  const filePatchReceipts = parseFilePatchReceipts(value.filePatchReceipts)
  if (
    JSON.stringify(filePatchReceipts) !== JSON.stringify(intent.filePatchReceipts ?? [])
  ) throw new Error('Materialized turn artifact filePatchReceipts do not match its durable intent.')
  const durable = jsonClone({
    contractVersion: 1 as const,
    kind: 'turn-completed' as const,
    runtimeId: intent.runtimeId,
    threadId: intent.threadId,
    turnId: intent.turnId,
    ...(intent.issuerEpoch ? { issuerEpoch: intent.issuerEpoch } : {}),
    ...(intent.deliveryAttemptOrdinal === undefined
      ? {}
      : { deliveryAttemptOrdinal: intent.deliveryAttemptOrdinal }),
    ...(intent.deliveryAttemptId ? { deliveryAttemptId: intent.deliveryAttemptId } : {}),
    ...(intent.boundaryLeaseId ? { boundaryLeaseId: intent.boundaryLeaseId } : {}),
    ...(intent.clientDirectiveId ? { clientDirectiveId: intent.clientDirectiveId } : {}),
    targetWatermark,
    ...(sequence === undefined ? {} : { sequence: Number(sequence) }),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    occurredAt,
    ...(intent.fileEffects ? { fileEffects: intent.fileEffects } : {}),
    ...(filePatchReceipts.length ? { filePatchReceipts } : {}),
    artifacts: value.artifacts.map((artifact) => bindArtifactPrincipal(
      artifact,
      intent.principal ?? null
    )),
    ...(intent.principal ? { principal: intent.principal } : {}),
    ...(intent.principalContext ? { principalContext: intent.principalContext } : {})
  })
  return deepFreeze(durable) as DomainTurnArtifactEvent
}

function bindArtifactPrincipal(
  value: unknown,
  principal: PrincipalSnapshot | null
): unknown {
  if (!isRecord(value)) return value
  const {
    principal: _untrustedPrincipal,
    principalContext: _untrustedPrincipalContext,
    ...artifact
  } = value
  return principal ? { ...artifact, principal } : artifact
}

function samePrincipalAttribution(
  left: PrincipalSnapshot | null | undefined,
  right: PrincipalSnapshot | null | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left === null || right === null) return left === right
  return samePrincipalSnapshot(left, right)
}

function samePrincipalContextAttribution(
  left: PrincipalContextSnapshot | null | undefined,
  right: PrincipalContextSnapshot | null | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left === null || right === null) return left === right
  return samePrincipalContextSnapshot(left, right)
}

function bindMaterializedWorkspace(
  value: unknown,
  intent: TurnArtifactReplayIntent
): TurnArtifactReplayIntent {
  if (intent.workspaceRoot !== undefined || !isRecord(value) || value.workspaceRoot === undefined) {
    return intent
  }
  return Object.freeze({
    ...intent,
    workspaceRoot: required(value.workspaceRoot, 'workspaceRoot', 16_384)
  })
}

function assertSameIntent(
  left: TurnArtifactReplayIntent,
  right: TurnArtifactReplayIntent,
  key: string
): void {
  if (
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.turnId !== right.turnId ||
    left.issuerEpoch !== right.issuerEpoch ||
    left.deliveryAttemptOrdinal !== right.deliveryAttemptOrdinal ||
    left.deliveryAttemptId !== right.deliveryAttemptId ||
    left.boundaryLeaseId !== right.boundaryLeaseId ||
    left.providerUserMessageItemId !== right.providerUserMessageItemId ||
    left.bindingSource !== right.bindingSource ||
    left.clientDirectiveId !== right.clientDirectiveId ||
    left.inputDigest !== right.inputDigest ||
    left.sequence !== right.sequence ||
    left.workspaceRoot !== right.workspaceRoot ||
    left.workspaceLocator?.contractVersion !== right.workspaceLocator?.contractVersion ||
    left.workspaceLocator?.hostSessionId !== right.workspaceLocator?.hostSessionId ||
    left.workspaceLocator?.path !== right.workspaceLocator?.path ||
    left.fileBaseline?.digest !== right.fileBaseline?.digest ||
    !samePrincipalAttribution(left.principal, right.principal) ||
    !samePrincipalContextAttribution(left.principalContext, right.principalContext) ||
    fileEffectsDigest(left.fileEffects) !== fileEffectsDigest(right.fileEffects) ||
    JSON.stringify(left.filePatchReceipts ?? []) !== JSON.stringify(right.filePatchReceipts ?? []) ||
    left.occurredAt !== right.occurredAt
  ) {
    throw new Error(`Completed turn artifact intent key collision: ${key}`)
  }
}

function assertReceiptMatchesIntent(
  receipt: TurnArtifactTerminalReceipt,
  intent: TurnArtifactReplayIntent,
  key: string
): void {
  if (
    receipt.runtimeId !== intent.runtimeId ||
    receipt.threadId !== intent.threadId ||
    receipt.turnId !== intent.turnId ||
    receipt.principalContextDigest !==
      principalContextAttributionDigest(intent.principalContext ?? null) ||
    receipt.intentDigest !== turnArtifactIntentDigest(intent)
  ) throw new Error(`Completed turn artifact intent key collision: ${key}`)
}

function assertSameArtifactReceipt(
  left: TurnArtifactTerminalReceipt,
  right: TurnArtifactTerminalReceipt
): void {
  if (
    left.key !== right.key ||
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.turnId !== right.turnId ||
    left.issuerEpoch !== right.issuerEpoch ||
    left.deliveryAttemptOrdinal !== right.deliveryAttemptOrdinal ||
    left.deliveryAttemptId !== right.deliveryAttemptId ||
    left.boundaryLeaseId !== right.boundaryLeaseId ||
    left.clientDirectiveId !== right.clientDirectiveId ||
    left.inputDigest !== right.inputDigest ||
    left.workspaceBindingDigest !== right.workspaceBindingDigest ||
    left.fileBaselineDigest !== right.fileBaselineDigest ||
    !samePrincipalAttribution(left.principal ?? null, right.principal ?? null) ||
    left.principalDigest !== right.principalDigest ||
    !samePrincipalContextAttribution(
      left.principalContext ?? null,
      right.principalContext ?? null
    ) ||
    left.principalContextDigest !== right.principalContextDigest ||
    left.intentDigest !== right.intentDigest ||
    !sameArtifactReceiptOutcome(left, right)
  ) throw new Error(`Completed turn artifact receipt proof collision: ${left.key}`)
}

function sameArtifactReceiptOutcome(
  left: TurnArtifactTerminalReceipt,
  right: TurnArtifactTerminalReceipt
): boolean {
  if (left.outcome !== right.outcome) return false
  if (left.outcome === 'delivered' && right.outcome === 'delivered') {
    return left.deliveredAt === right.deliveredAt
  }
  if (
    left.outcome === 'legacy_materialization_quarantined' &&
    right.outcome === 'legacy_materialization_quarantined'
  ) {
    return left.firstSeenAt === right.firstSeenAt &&
      left.quarantinedAt === right.quarantinedAt &&
      left.attempts === right.attempts &&
      left.error === right.error
  }
  return false
}

function assertWatchMatchesReceipt(
  watch: TurnArtifactWatch,
  receipt: TurnArtifactTerminalReceipt,
  key: string
): void {
  if (
    watch.runtimeId !== receipt.runtimeId ||
    watch.threadId !== receipt.threadId ||
    watch.turnId !== receipt.turnId ||
    watch.issuerEpoch !== receipt.issuerEpoch ||
    watch.deliveryAttemptOrdinal !== receipt.deliveryAttemptOrdinal ||
    watch.deliveryAttemptId !== receipt.deliveryAttemptId ||
    watch.boundaryLeaseId !== receipt.boundaryLeaseId ||
    watch.clientDirectiveId !== receipt.clientDirectiveId ||
    watch.inputDigest !== receipt.inputDigest ||
    principalAttributionDigest(watch.principal) !== receipt.principalDigest ||
    principalContextAttributionDigest(watch.principalContext) !==
      receipt.principalContextDigest ||
    workspaceReceiptBindingDigest(watch.workspaceRoot, watch.workspaceLocator) !==
      receipt.workspaceBindingDigest ||
    (watch.fileBaseline !== undefined && watch.fileBaseline.digest !== receipt.fileBaselineDigest)
  ) throw new Error(`Accepted turn artifact watch does not match completed intent: ${key}`)
}

function assertSameWatch(
  left: TurnArtifactWatch,
  right: TurnArtifactWatch,
  key: string
): void {
  if (
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.turnId !== right.turnId ||
    left.issuerEpoch !== right.issuerEpoch ||
    left.deliveryAttemptOrdinal !== right.deliveryAttemptOrdinal ||
    left.deliveryAttemptId !== right.deliveryAttemptId ||
    left.boundaryLeaseId !== right.boundaryLeaseId ||
    left.providerUserMessageItemId !== right.providerUserMessageItemId ||
    left.bindingSource !== right.bindingSource ||
    left.clientDirectiveId !== right.clientDirectiveId ||
    left.inputDigest !== right.inputDigest ||
    left.workspaceRoot !== right.workspaceRoot ||
    left.workspaceLocator?.contractVersion !== right.workspaceLocator?.contractVersion ||
    left.workspaceLocator?.hostSessionId !== right.workspaceLocator?.hostSessionId ||
    left.workspaceLocator?.path !== right.workspaceLocator?.path ||
    left.fileBaseline?.digest !== right.fileBaseline?.digest ||
    !samePrincipalAttribution(left.principal, right.principal) ||
    !samePrincipalContextAttribution(left.principalContext, right.principalContext)
  ) {
    throw new Error(`Accepted turn artifact watch key collision: ${key}`)
  }
}

function assertSameStart(
  left: TurnArtifactStart,
  right: TurnArtifactStart,
  key: string
): void {
  if (
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.clientDirectiveId !== right.clientDirectiveId ||
    left.issuerEpoch !== right.issuerEpoch ||
    left.deliveryAttemptOrdinal !== right.deliveryAttemptOrdinal ||
    left.deliveryAttemptId !== right.deliveryAttemptId ||
    left.boundaryLeaseId !== right.boundaryLeaseId ||
    left.inputDigest !== right.inputDigest ||
    left.workspaceRoot !== right.workspaceRoot ||
    left.workspaceLocator?.contractVersion !== right.workspaceLocator?.contractVersion ||
    left.workspaceLocator?.hostSessionId !== right.workspaceLocator?.hostSessionId ||
    left.workspaceLocator?.path !== right.workspaceLocator?.path ||
    left.fileBaseline?.digest !== right.fileBaseline?.digest ||
    !samePrincipalAttribution(left.principal, right.principal) ||
    !samePrincipalContextAttribution(left.principalContext, right.principalContext)
  ) {
    throw new Error(`Turn artifact start key collision: ${key}`)
  }
}

function assertSameStartDraft(
  left: TurnArtifactStart,
  right: TurnArtifactStartDraft,
  key: string
): void {
  if (
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.clientDirectiveId !== right.clientDirectiveId ||
    left.inputDigest !== right.inputDigest ||
    left.workspaceRoot !== right.workspaceRoot ||
    left.workspaceLocator?.contractVersion !== right.workspaceLocator?.contractVersion ||
    left.workspaceLocator?.hostSessionId !== right.workspaceLocator?.hostSessionId ||
    left.workspaceLocator?.path !== right.workspaceLocator?.path ||
    left.fileBaseline?.digest !== right.fileBaseline?.digest ||
    !samePrincipalAttribution(left.principal, right.principal) ||
    !samePrincipalContextAttribution(left.principalContext, right.principalContext)
  ) throw new Error(`Turn artifact start key collision: ${key}`)
}

function assertWatchMatchesIntent(
  watch: TurnArtifactWatch,
  intent: TurnArtifactReplayIntent,
  key: string
): void {
  if (
    watch.runtimeId !== intent.runtimeId ||
    watch.threadId !== intent.threadId ||
    watch.turnId !== intent.turnId ||
    watch.issuerEpoch !== intent.issuerEpoch ||
    watch.deliveryAttemptOrdinal !== intent.deliveryAttemptOrdinal ||
    watch.deliveryAttemptId !== intent.deliveryAttemptId ||
    watch.boundaryLeaseId !== intent.boundaryLeaseId ||
    watch.providerUserMessageItemId !== intent.providerUserMessageItemId ||
    watch.bindingSource !== intent.bindingSource ||
    watch.clientDirectiveId !== intent.clientDirectiveId ||
    watch.inputDigest !== intent.inputDigest ||
    (watch.workspaceRoot !== undefined && watch.workspaceRoot !== intent.workspaceRoot) ||
    watch.workspaceLocator?.hostSessionId !== intent.workspaceLocator?.hostSessionId ||
    watch.workspaceLocator?.path !== intent.workspaceLocator?.path ||
    watch.fileBaseline?.digest !== intent.fileBaseline?.digest ||
    !samePrincipalAttribution(watch.principal, intent.principal) ||
    !samePrincipalContextAttribution(watch.principalContext, intent.principalContext)
  ) {
    throw new Error(`Accepted turn artifact watch does not match completed intent: ${key}`)
  }
}

function assertDirectiveNotBound(
  start: Pick<
    TurnArtifactStart,
    'runtimeId' | 'threadId' | 'clientDirectiveId' | 'inputDigest'
  >,
  ...groups: readonly (readonly TurnArtifactDirectiveBinding[])[]
): void {
  const existing = groups.flat().find((candidate) => (
    candidate.runtimeId === start.runtimeId &&
    candidate.threadId === start.threadId &&
    candidate.clientDirectiveId === start.clientDirectiveId
  ))
  if (!existing) return
  if (existing.inputDigest !== start.inputDigest) {
    throw new Error(`Turn artifact directive input collision: ${start.clientDirectiveId}`)
  }
  throw new Error(
    `Turn artifact directive ${start.clientDirectiveId} is already bound to turn ${existing.turnId}.`
  )
}

function assertUniqueDirectiveBindings(
  values: readonly TurnArtifactDirectiveBinding[]
): void {
  const turnsByDirective = new Map<string, string>()
  for (const value of values) {
    if (!value.clientDirectiveId) continue
    const key = [value.runtimeId, value.threadId, value.clientDirectiveId].join('\u0000')
    const existing = turnsByDirective.get(key)
    if (existing && existing !== value.turnId) {
      throw new Error('Turn artifact outbox binds one directive to multiple turns.')
    }
    turnsByDirective.set(key, value.turnId)
  }
}

function assertBoundaryPrincipalAttributionConsistent(
  values: readonly Readonly<{
    boundaryLeaseId?: string
    principal?: PrincipalSnapshot | null
    principalContext?: PrincipalContextSnapshot | null
  }>[]
): void {
  const owners = new Map<string, Readonly<{
    principal?: PrincipalSnapshot | null
    principalContext?: PrincipalContextSnapshot | null
  }>>()
  for (const value of values) {
    if (!value.boundaryLeaseId) continue
    const existing = owners.get(value.boundaryLeaseId)
    if (existing && (
      !samePrincipalAttribution(existing.principal ?? null, value.principal ?? null) ||
      !samePrincipalContextAttribution(
        existing.principalContext ?? null,
        value.principalContext ?? null
      )
    )) {
      throw new Error(
        `Turn boundary Principal attribution collision: ${value.boundaryLeaseId}`
      )
    }
    owners.set(value.boundaryLeaseId, value)
  }
}

function parseDirectiveBinding(
  value: Record<string, unknown>
): Readonly<{ clientDirectiveId?: string; inputDigest?: string }> {
  if (value.clientDirectiveId === undefined && value.inputDigest === undefined) return {}
  if (value.clientDirectiveId === undefined || value.inputDigest === undefined) {
    throw new Error('Turn artifact directive binding must include identity and input digest.')
  }
  const clientDirectiveId = required(value.clientDirectiveId, 'clientDirectiveId')
  const inputDigest = required(value.inputDigest, 'inputDigest')
  if (!/^sha256:[a-f0-9]{64}$/.test(inputDigest)) {
    throw new Error('Turn artifact directive inputDigest must be a canonical SHA-256 digest.')
  }
  return Object.freeze({ clientDirectiveId, inputDigest })
}

function parseRequiredBoundaryBinding(value: Record<string, unknown>): Readonly<{
  issuerEpoch: string
  deliveryAttemptId: string
  deliveryAttemptOrdinal: number
  boundaryLeaseId: string
}> {
  const boundary = parseOptionalBoundaryBinding(value)
  if (
    !boundary.issuerEpoch ||
    !boundary.deliveryAttemptId ||
    boundary.deliveryAttemptOrdinal === undefined ||
    !boundary.boundaryLeaseId
  ) {
    throw new Error('Turn boundary binding is required.')
  }
  return boundary as Readonly<{
    issuerEpoch: string
    deliveryAttemptId: string
    deliveryAttemptOrdinal: number
    boundaryLeaseId: string
  }>
}

function parseOptionalBoundaryBinding(
  value: Record<string, unknown>,
  legacy = false
): Readonly<{
  issuerEpoch?: string
  deliveryAttemptId?: string
  deliveryAttemptOrdinal?: number
  boundaryLeaseId?: string
}> {
  const present = [
    value.issuerEpoch,
    value.deliveryAttemptId,
    value.deliveryAttemptOrdinal,
    value.boundaryLeaseId
  ].filter((candidate) => candidate !== undefined).length
  if (present === 0) return {}
  if (legacy && value.deliveryAttemptId !== undefined && value.boundaryLeaseId !== undefined) {
    const deliveryAttemptId = required(value.deliveryAttemptId, 'deliveryAttemptId', 256)
    const boundaryLeaseId = required(value.boundaryLeaseId, 'boundaryLeaseId', 512)
    if (boundaryLeaseId !== `turn-boundary:${deliveryAttemptId}`) {
      throw new Error('Turn boundary lease identity does not match its delivery attempt.')
    }
    // Pre-V4 attempt names were not issued by the exact ordinal ledger. Keep
    // the artifact replay, but deliberately drop the non-authoritative lease.
    return Object.freeze({})
  }
  if (present !== 4) {
    throw new Error('Turn boundary binding must include attempt and lease identities.')
  }
  const issuerEpoch = parseIssuerEpoch(value.issuerEpoch)
  const deliveryAttemptOrdinal = positiveSafeInteger(
    value.deliveryAttemptOrdinal,
    'deliveryAttemptOrdinal'
  )
  const deliveryAttemptId = required(value.deliveryAttemptId, 'deliveryAttemptId', 256)
  const boundaryLeaseId = required(value.boundaryLeaseId, 'boundaryLeaseId', 512)
  const pattern = new RegExp(
    `^delivery-attempt:${escapeRegExp(issuerEpoch)}:${deliveryAttemptOrdinal}:[a-f0-9]{32}$`,
    'u'
  )
  if (!pattern.test(deliveryAttemptId)) {
    throw new Error('Turn boundary deliveryAttemptId is invalid.')
  }
  if (boundaryLeaseId !== `turn-boundary:${deliveryAttemptId}`) {
    throw new Error('Turn boundary lease identity does not match its delivery attempt.')
  }
  return Object.freeze({
    issuerEpoch,
    deliveryAttemptId,
    deliveryAttemptOrdinal,
    boundaryLeaseId
  })
}

function parseBindingSource(
  value: unknown
): TurnArtifactWatch['bindingSource'] | undefined {
  if (value === undefined) return undefined
  if (
    value !== 'provider-accepted' && value !== 'explicit-resolution'
  ) throw new Error('Turn artifact watch bindingSource is invalid.')
  return value
}

export function turnLifecycleSettlementKey(
  event: Pick<DomainMainAfterTurnEvent, 'boundaryLeaseId'>
): string {
  const boundaryLeaseId = event.boundaryLeaseId?.trim()
  if (!boundaryLeaseId) throw new Error('Turn lifecycle settlement requires a boundary lease id.')
  return `turn-lifecycle:${createHash('sha256').update(boundaryLeaseId).digest('hex')}`
}

function parseLifecycleSettlement(
  value: unknown,
  persisted = false,
  legacyPrincipal = false
): DomainMainAfterTurnEvent {
  if (!isRecord(value) || value.kind !== 'after-turn') {
    throw new Error('Turn lifecycle settlement must be an after-turn event.')
  }
  const state = value.state
  if (state !== 'completed' && state !== 'failed' && state !== 'cancelled' && state !== 'rejected') {
    throw new Error('Turn lifecycle settlement has an invalid terminal state.')
  }
  const {
    issuerEpoch,
    deliveryAttemptId,
    deliveryAttemptOrdinal,
    boundaryLeaseId
  } = parseRequiredBoundaryBinding(value)
  const runtimeId = required(value.runtimeId, 'runtimeId')
  const threadId = required(value.threadId, 'threadId')
  const clientDirectiveId = required(value.clientDirectiveId, 'clientDirectiveId')
  const workspaceRoot = value.workspaceRoot === undefined
    ? undefined
    : required(value.workspaceRoot, 'workspaceRoot', 16_384)
  const occurredAt = timestamp(value.occurredAt, 'occurredAt')
  const settlementSource = value.settlementSource === undefined
    ? 'runtime'
    : value.settlementSource
  if (
    settlementSource !== undefined &&
    settlementSource !== 'runtime' &&
    settlementSource !== 'explicit-pending-start-release'
  ) throw new Error('Turn lifecycle settlement source is invalid.')
  const turnId = value.turnId === undefined ? undefined : required(value.turnId, 'turnId')
  const principal = value.principal === undefined
    ? undefined
    : parseOptionalPrincipalSnapshot(value.principal)
  const principalContext = value.principalContext === undefined
    ? (persisted && !legacyPrincipal && principal
        ? definePrincipalContextSnapshot({
            identityVersion: principal.identityVersion,
            principal
          })
        : undefined)
    : parseOptionalPrincipalContextSnapshot(value.principalContext)
  if (
    principalContext &&
    !samePrincipalAttribution(principal ?? null, principalContext.principal)
  ) {
    throw new Error('Turn lifecycle Principal projection does not match its context attribution.')
  }
  if (state === 'rejected' ? turnId !== undefined : turnId === undefined) {
    throw new Error('Turn lifecycle settlement turn identity does not match its terminal state.')
  }
  return Object.freeze({
    kind: 'after-turn',
    state,
    issuerEpoch,
    deliveryAttemptId,
    deliveryAttemptOrdinal,
    boundaryLeaseId,
    runtimeId,
    threadId,
    clientDirectiveId,
    ...(turnId ? { turnId } : {}),
    ...(principal ? { principal } : {}),
    ...(principalContext ? { principalContext } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    settlementSource,
    occurredAt
  }) as DomainMainAfterTurnEvent
}

function completedLifecycleSettlementForIntent(
  intent: TurnArtifactReplayIntent
): DomainMainAfterTurnEvent | undefined {
  if (
    !intent.deliveryAttemptId ||
    !intent.issuerEpoch ||
    intent.deliveryAttemptOrdinal === undefined ||
    !intent.boundaryLeaseId ||
    !intent.clientDirectiveId
  ) return undefined
  return Object.freeze({
    kind: 'after-turn',
    state: 'completed',
    issuerEpoch: intent.issuerEpoch,
    deliveryAttemptId: intent.deliveryAttemptId,
    deliveryAttemptOrdinal: intent.deliveryAttemptOrdinal,
    boundaryLeaseId: intent.boundaryLeaseId,
    runtimeId: intent.runtimeId,
    threadId: intent.threadId,
    turnId: intent.turnId,
    clientDirectiveId: intent.clientDirectiveId,
    ...(intent.principal ? { principal: intent.principal } : {}),
    ...(intent.principalContext ? { principalContext: intent.principalContext } : {}),
    ...(intent.workspaceRoot ? { workspaceRoot: intent.workspaceRoot } : {}),
    settlementSource: 'runtime',
    occurredAt: intent.occurredAt
  })
}

function createLifecycleSettlementRecord(
  key: string,
  event: DomainMainAfterTurnEvent
): TurnLifecycleSettlementRecord {
  const now = new Date().toISOString()
  return Object.freeze({
    key,
    event,
    attempts: 0,
    createdAt: now,
    updatedAt: now
  })
}

function parseLifecycleSettlementRecord(
  value: unknown,
  legacyPrincipal = false
): TurnLifecycleSettlementRecord {
  if (!isRecord(value)) throw new Error('Turn lifecycle settlement record must be an object.')
  const event = parseLifecycleSettlement(value.event, true, legacyPrincipal)
  const key = turnLifecycleSettlementKey(event)
  if (value.key !== key) throw new Error('Turn lifecycle settlement record has an invalid key.')
  const attempts = value.attempts
  if (!Number.isSafeInteger(attempts) || Number(attempts) < 0) {
    throw new Error('Turn lifecycle settlement attempts must be a non-negative integer.')
  }
  return Object.freeze({
    key,
    event,
    attempts: Number(attempts),
    createdAt: timestamp(value.createdAt, 'createdAt'),
    updatedAt: timestamp(value.updatedAt, 'updatedAt'),
    ...(value.nextAttemptAt === undefined
      ? {}
      : { nextAttemptAt: timestamp(value.nextAttemptAt, 'nextAttemptAt') }),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 4_000) } : {})
  })
}

function parseLifecycleSettlementReceipt(
  value: unknown,
  legacyPrincipal = false
): TurnLifecycleSettlementReceipt {
  if (!isRecord(value)) throw new Error('Turn lifecycle settlement receipt must be an object.')
  const event = parseLifecycleSettlement(value.event, true, legacyPrincipal)
  const key = turnLifecycleSettlementKey(event)
  if (value.key !== key) throw new Error('Turn lifecycle settlement receipt has an invalid key.')
  return Object.freeze({
    key,
    event,
    deliveredAt: timestamp(value.deliveredAt, 'deliveredAt')
  })
}

function assertSameLifecycleSettlement(
  left: DomainMainAfterTurnEvent,
  right: DomainMainAfterTurnEvent,
  key: string
): void {
  if (
    left.kind !== right.kind ||
    left.state !== right.state ||
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.turnId !== right.turnId ||
    left.issuerEpoch !== right.issuerEpoch ||
    left.deliveryAttemptOrdinal !== right.deliveryAttemptOrdinal ||
    left.deliveryAttemptId !== right.deliveryAttemptId ||
    left.boundaryLeaseId !== right.boundaryLeaseId ||
    left.clientDirectiveId !== right.clientDirectiveId ||
    !samePrincipalAttribution(left.principal ?? null, right.principal ?? null) ||
    !samePrincipalContextAttribution(
      left.principalContext ?? null,
      right.principalContext ?? null
    ) ||
    left.workspaceRoot !== right.workspaceRoot ||
    left.settlementSource !== right.settlementSource ||
    left.occurredAt !== right.occurredAt
  ) {
    throw new Error(`Turn lifecycle settlement identity collision: ${key}`)
  }
}

function assertSettlementMatchesBoundary(
  event: DomainMainAfterTurnEvent,
  owner: Readonly<{
    runtimeId: string
    threadId: string
    turnId?: string
    issuerEpoch?: string
    deliveryAttemptOrdinal?: number
    deliveryAttemptId?: string
    boundaryLeaseId?: string
    clientDirectiveId?: string
    workspaceRoot?: string
    principal?: PrincipalSnapshot | null
    principalContext?: PrincipalContextSnapshot | null
  }>
): void {
  if (
    event.runtimeId !== owner.runtimeId ||
    event.threadId !== owner.threadId ||
    event.issuerEpoch !== owner.issuerEpoch ||
    event.deliveryAttemptOrdinal !== owner.deliveryAttemptOrdinal ||
    event.deliveryAttemptId !== owner.deliveryAttemptId ||
    event.boundaryLeaseId !== owner.boundaryLeaseId ||
    event.clientDirectiveId !== owner.clientDirectiveId ||
    !samePrincipalAttribution(event.principal ?? null, owner.principal ?? null) ||
    !samePrincipalContextAttribution(
      event.principalContext ?? null,
      owner.principalContext ?? null
    ) ||
    event.workspaceRoot !== owner.workspaceRoot ||
    (event.state !== 'rejected' && owner.turnId !== undefined && event.turnId !== owner.turnId)
  ) {
    throw new Error('Turn lifecycle settlement does not match its durable boundary owner.')
  }
}

function assertSameBoundaryIdentity(
  left: Readonly<{
    runtimeId: string
    threadId: string
    issuerEpoch?: string
    deliveryAttemptOrdinal?: number
    deliveryAttemptId?: string
    boundaryLeaseId?: string
    clientDirectiveId?: string
    workspaceRoot?: string
    principal?: PrincipalSnapshot | null
    principalContext?: PrincipalContextSnapshot | null
  }>,
  right: Readonly<{
    runtimeId: string
    threadId: string
    issuerEpoch?: string
    deliveryAttemptOrdinal?: number
    deliveryAttemptId?: string
    boundaryLeaseId?: string
    clientDirectiveId?: string
    workspaceRoot?: string
    principal?: PrincipalSnapshot | null
    principalContext?: PrincipalContextSnapshot | null
  }>
): void {
  if (
    left.runtimeId !== right.runtimeId ||
    left.threadId !== right.threadId ||
    left.issuerEpoch !== right.issuerEpoch ||
    left.deliveryAttemptOrdinal !== right.deliveryAttemptOrdinal ||
    left.deliveryAttemptId !== right.deliveryAttemptId ||
    left.boundaryLeaseId !== right.boundaryLeaseId ||
    left.clientDirectiveId !== right.clientDirectiveId ||
    !samePrincipalAttribution(left.principal ?? null, right.principal ?? null) ||
    !samePrincipalContextAttribution(
      left.principalContext ?? null,
      right.principalContext ?? null
    ) ||
    left.workspaceRoot !== right.workspaceRoot
  ) {
    throw new Error('Turn artifact start successor does not match its durable boundary owner.')
  }
}

function boundarySnapshot(
  value: Readonly<{
    boundaryLeaseId: string
    issuerEpoch: string
    deliveryAttemptOrdinal: number
    deliveryAttemptId: string
    runtimeId: string
    threadId: string
    clientDirectiveId: string
    workspaceRoot?: string
    turnId?: string
    principal?: PrincipalSnapshot | null
    principalContext?: PrincipalContextSnapshot | null
  }>,
  phase: DomainMainDurableTurnBoundary['phase'],
  occurredAt: string,
  terminalState?: DomainMainDurableTurnBoundary['terminalState']
): DomainMainDurableTurnBoundary {
  return Object.freeze({
    boundaryLeaseId: value.boundaryLeaseId,
    issuerEpoch: value.issuerEpoch,
    deliveryAttemptOrdinal: value.deliveryAttemptOrdinal,
    deliveryAttemptId: value.deliveryAttemptId,
    runtimeId: value.runtimeId,
    threadId: value.threadId,
    clientDirectiveId: value.clientDirectiveId,
    ...(value.principal ? { principal: value.principal } : {}),
    ...(value.principalContext ? { principalContext: value.principalContext } : {}),
    ...(value.workspaceRoot ? { workspaceRoot: value.workspaceRoot } : {}),
    phase,
    ...(value.turnId ? { turnId: value.turnId } : {}),
    ...(terminalState ? { terminalState } : {}),
    occurredAt
  })
}

function boundarySnapshotFromSettlement(
  event: DomainMainAfterTurnEvent,
  occurredAt: string
): DomainMainDurableTurnBoundary {
  return boundarySnapshot({
    boundaryLeaseId: event.boundaryLeaseId,
    issuerEpoch: event.issuerEpoch,
    deliveryAttemptOrdinal: event.deliveryAttemptOrdinal,
    deliveryAttemptId: event.deliveryAttemptId,
    runtimeId: event.runtimeId,
    threadId: event.threadId,
    clientDirectiveId: event.clientDirectiveId,
    ...(event.principal ? { principal: event.principal } : {}),
    ...(event.principalContext ? { principalContext: event.principalContext } : {}),
    ...(event.workspaceRoot ? { workspaceRoot: event.workspaceRoot } : {}),
    ...(event.state === 'rejected' ? {} : { turnId: event.turnId })
  }, 'terminal-settlement', occurredAt, event.state)
}

function setBoundarySnapshot(
  values: Map<string, DomainMainDurableTurnBoundary>,
  next: DomainMainDurableTurnBoundary
): void {
  const current = values.get(next.boundaryLeaseId)
  if (current && (
    current.deliveryAttemptId !== next.deliveryAttemptId ||
    current.issuerEpoch !== next.issuerEpoch ||
    current.deliveryAttemptOrdinal !== next.deliveryAttemptOrdinal ||
    current.runtimeId !== next.runtimeId ||
    current.threadId !== next.threadId ||
    current.clientDirectiveId !== next.clientDirectiveId ||
    !samePrincipalAttribution(current.principal ?? null, next.principal ?? null) ||
    !samePrincipalContextAttribution(
      current.principalContext ?? null,
      next.principalContext ?? null
    ) ||
    current.workspaceRoot !== next.workspaceRoot ||
    (current.turnId !== undefined && next.turnId !== undefined && current.turnId !== next.turnId)
  )) {
    throw new Error(`Turn boundary ownership collision: ${next.boundaryLeaseId}`)
  }
  values.set(next.boundaryLeaseId, Object.freeze({
    ...next,
    ...(next.turnId ? { turnId: next.turnId } : current?.turnId ? { turnId: current.turnId } : {})
  }))
}

function compareWatches(left: PendingTurnArtifactWatch, right: PendingTurnArtifactWatch): number {
  return left.registeredAt.localeCompare(right.registeredAt) || left.key.localeCompare(right.key)
}

function compareStarts(left: PendingTurnArtifactStart, right: PendingTurnArtifactStart): number {
  return left.registeredAt.localeCompare(right.registeredAt) || left.key.localeCompare(right.key)
}

function compareRecords(left: TurnArtifactOutboxRecord, right: TurnArtifactOutboxRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key)
}

function compareLifecycleSettlements(
  left: TurnLifecycleSettlementRecord,
  right: TurnLifecycleSettlementRecord
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key)
}

async function syncDirectory(directory: string): Promise<void> {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EISDIR') {
      throw error
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function jsonClone<T>(value: T): T {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Turn artifact payload is not JSON serializable.')
  return JSON.parse(serialized) as T
}

function deepFreeze(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function required(value: unknown, field: string, max = 4_096): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`Completed turn artifact ${field} must be a non-empty bounded string.`)
  }
  return value.trim()
}

function digest(value: unknown, field: string): string {
  const parsed = required(value, field, 64)
  if (!/^[a-f0-9]{64}$/u.test(parsed)) {
    throw new Error(`Completed turn artifact ${field} must be a SHA-256 digest.`)
  }
  return parsed
}

function parseIssuerEpoch(value: unknown): string {
  const parsed = required(value, 'issuerEpoch', 64)
  if (!/^issuer-[a-f0-9]{32}$/u.test(parsed)) {
    throw new Error('Turn delivery-attempt issuerEpoch is invalid.')
  }
  return parsed
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Turn delivery-attempt ${field} must be a positive safe integer.`)
  }
  return Number(value)
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Turn delivery-attempt ${field} must be a non-negative safe integer.`)
  }
  return Number(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Completed turn artifact ${field} must be a timestamp.`)
  }
  return new Date(value).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class PostRenameDurabilityError extends Error {
  readonly postRename = true

  constructor(cause: unknown) {
    super('Turn artifact outbox rename completed but directory durability could not be confirmed.', {
      cause
    })
    this.name = 'PostRenameDurabilityError'
  }
}

function isPostRenameDurabilityError(error: unknown): error is PostRenameDurabilityError {
  return error instanceof PostRenameDurabilityError
}
