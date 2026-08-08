import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  canonicalizeReproValue,
  domainExecutionEventSchema,
  type DomainExecutionEventV1
} from '@sciforge/domain-sdk/reproducibility'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'

const OUTBOX_VERSION = 3
const LEGACY_OUTBOX_VERSION = 2
const MAX_PENDING_EVENTS = 1_000
const MAX_DELIVERED_RECEIPTS = 10_000
const MAX_TERMINAL_IDENTITIES = 1_000_000

export type DomainExecutionOutboxRecord = Readonly<{
  event: DomainExecutionEventV1
  /** Host-assigned acceptance order; never derived from producer timestamps. */
  sequence: number
  /** True only when the capability broker bound the event to its caller workspace. */
  workspaceBound: boolean
  traceRecorded: boolean
  attempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string
  error?: string
}>

type PersistedOutbox = Readonly<{
  version: typeof OUTBOX_VERSION
  nextSequence: number
  records: readonly DomainExecutionOutboxRecord[]
  receipts: readonly DomainExecutionDeliveryReceipt[]
  terminalIdentities: readonly DomainExecutionTerminalIdentity[]
  /** Producers whose early v2 receipts lack enough data to reconstruct a tuple. */
  ambiguousLegacyProducers: readonly string[]
}>

type ParsedOutbox = PersistedOutbox & Readonly<{
  needsMigration: boolean
}>

type DomainExecutionDeliveryReceipt = Readonly<{
  eventId: string
  intentDigest: string
  producer: DomainExecutionEventV1['producer']
  /** Optional only while loading receipts written before acceptance sequencing. */
  terminalKey?: string
  sequence?: number
  deliveredAt: string
}>

/**
 * Permanent, compact acceptance identity. Delivery receipts are intentionally
 * bounded, but forgetting this tuple would allow a mutually exclusive terminal
 * event to be accepted after receipt pruning.
 */
type DomainExecutionTerminalIdentity = Readonly<{
  terminalKey: string
  eventId: string
  intentDigest: string
  producer: DomainExecutionEventV1['producer']
  sequence: number
  acceptedAt: string
}>

type DomainExecutionEventOutboxOptions = Readonly<{
  /** Test/embedded deployments may choose a smaller fail-closed bound. */
  maxDeliveredReceipts?: number
  /** Once full, new terminal identities are rejected rather than forgotten. */
  maxTerminalIdentities?: number
  /**
   * Resolves early v2 receipts against the Host-owned Full Trace before the
   * fail-closed producer ambiguity tombstone is needed. Returned values are
   * treated as untrusted and must match the receipt's exact intent digest.
   */
  resolveLegacyTerminalEvents?: (
    eventIds: readonly string[]
  ) => Promise<readonly unknown[]>
}>

/**
 * Host-owned durable handoff for terminal domain executions.
 *
 * Consumers are idempotent on eventId/targetWatermark, so a partial fan-out is
 * retried to every consumer and acknowledged only after all of them accept it.
 */
export class DomainExecutionEventOutbox {
  readonly path: string
  #records = new Map<string, DomainExecutionOutboxRecord>()
  #receipts = new Map<string, DomainExecutionDeliveryReceipt>()
  #terminalIdentities = new Map<string, DomainExecutionTerminalIdentity>()
  #terminalEventIdsByKey = new Map<string, string>()
  #ambiguousLegacyProducers = new Set<string>()
  readonly #maxDeliveredReceipts: number
  readonly #maxTerminalIdentities: number
  readonly #resolveLegacyTerminalEvents?: NonNullable<
    DomainExecutionEventOutboxOptions['resolveLegacyTerminalEvents']
  >
  #nextSequence = 1
  #loaded = false
  #mutation: Promise<void> = Promise.resolve()

  constructor(userDataDir: string, options: DomainExecutionEventOutboxOptions = {}) {
    this.path = join(userDataDir, 'domain-executions', 'artifact-handoff-outbox.json')
    this.#maxDeliveredReceipts = boundedCapacity(
      options.maxDeliveredReceipts ?? MAX_DELIVERED_RECEIPTS,
      MAX_DELIVERED_RECEIPTS,
      'maxDeliveredReceipts'
    )
    this.#maxTerminalIdentities = boundedCapacity(
      options.maxTerminalIdentities ?? MAX_TERMINAL_IDENTITIES,
      MAX_TERMINAL_IDENTITIES,
      'maxTerminalIdentities'
    )
    this.#resolveLegacyTerminalEvents = options.resolveLegacyTerminalEvents
  }

  async load(): Promise<void> {
    if (this.#loaded) return
    await this.#mutate(async () => {
      if (this.#loaded) return
      let value: unknown
      try {
        value = JSON.parse(await readFile(this.path, 'utf8'))
        await chmod(dirname(this.path), 0o700)
        await chmod(this.path, 0o600)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
        value = {
          version: OUTBOX_VERSION,
          nextSequence: 1,
          records: [],
          receipts: [],
          terminalIdentities: [],
          ambiguousLegacyProducers: []
        }
      }
      value = await restoreLegacyReceiptIdentities(
        value,
        this.#resolveLegacyTerminalEvents
      )
      const parsed = parseOutbox(value, {
        maxDeliveredReceipts: this.#maxDeliveredReceipts,
        maxTerminalIdentities: this.#maxTerminalIdentities
      })
      this.#records = new Map(parsed.records.map((record) => [record.event.eventId, record]))
      this.#receipts = new Map(parsed.receipts.map((receipt) => [receipt.eventId, receipt]))
      this.#terminalIdentities = new Map(
        parsed.terminalIdentities.map((identity) => [identity.eventId, identity])
      )
      this.#terminalEventIdsByKey = new Map(
        parsed.terminalIdentities.map((identity) => [identity.terminalKey, identity.eventId])
      )
      this.#ambiguousLegacyProducers = new Set(parsed.ambiguousLegacyProducers)
      this.#nextSequence = parsed.nextSequence
      if (parsed.needsMigration) await this.#persist()
      this.#loaded = true
    })
  }

  async enqueue(
    event: DomainExecutionEventV1,
    options: Readonly<{ workspaceBound?: boolean }> = {}
  ): Promise<DomainExecutionEventV1> {
    const parsed = terminalEvent(event)
    await this.load()
    let accepted: DomainExecutionEventV1 | undefined
    await this.#mutate(async () => {
      const existing = this.#records.get(parsed.eventId)
      if (existing) {
        assertSamePackageIntent(existing.event, parsed)
        accepted = existing.event
        return
      }
      const delivered = this.#receipts.get(parsed.eventId)
      if (delivered) {
        assertSamePackageIntentDigest(delivered.intentDigest, parsed)
        accepted = terminalEvent({ ...parsed, producer: delivered.producer })
        return
      }
      const acceptedIdentity = this.#terminalIdentities.get(parsed.eventId)
      if (acceptedIdentity) {
        assertSamePackageIntentDigest(acceptedIdentity.intentDigest, parsed)
        accepted = terminalEvent({ ...parsed, producer: acceptedIdentity.producer })
        return
      }
      if (this.#ambiguousLegacyProducers.has(parsed.producer.moduleId)) {
        throw new Error(
          `Domain execution terminal identity for ${parsed.producer.moduleId} is ambiguous after v2 migration; refusing a new terminal while exact legacy event retries remain allowed.`
        )
      }
      const terminalKey = terminalIdentityKey(parsed)
      const conflictingEventId = this.#terminalEventIdsByKey.get(terminalKey)
      if (conflictingEventId !== undefined) {
        throw terminalCollision(parsed, conflictingEventId)
      }
      if (this.#records.size >= MAX_PENDING_EVENTS) {
        throw new Error('Domain execution handoff outbox is full.')
      }
      if (this.#terminalIdentities.size >= this.#maxTerminalIdentities) {
        throw new Error(
          'Domain execution terminal identity index is full; refusing to forget an accepted terminal.'
        )
      }
      if (
        !Number.isSafeInteger(this.#nextSequence) ||
        this.#nextSequence <= 0 ||
        !Number.isSafeInteger(this.#nextSequence + 1)
      ) {
        throw new Error('Domain execution handoff acceptance sequence is exhausted.')
      }
      if (options.workspaceBound === true && !parsed.workspaceRoot?.trim()) {
        throw new Error('A workspace-bound execution event must include its workspaceRoot.')
      }
      const now = new Date().toISOString()
      const sequence = this.#nextSequence
      const record = Object.freeze({
        event: parsed,
        sequence,
        workspaceBound: options.workspaceBound === true,
        traceRecorded: false,
        attempts: 0,
        createdAt: now,
        updatedAt: now
      })
      const identity: DomainExecutionTerminalIdentity = Object.freeze({
        terminalKey,
        eventId: parsed.eventId,
        intentDigest: packageIntentDigest(parsed),
        producer: Object.freeze({ ...parsed.producer }),
        sequence,
        acceptedAt: now
      })
      const nextSequenceBefore = this.#nextSequence
      this.#nextSequence += 1
      this.#records.set(parsed.eventId, record)
      this.#terminalIdentities.set(parsed.eventId, identity)
      this.#terminalEventIdsByKey.set(terminalKey, parsed.eventId)
      try {
        await this.#persist()
      } catch (error) {
        this.#records.delete(parsed.eventId)
        this.#terminalIdentities.delete(parsed.eventId)
        this.#terminalEventIdsByKey.delete(terminalKey)
        this.#nextSequence = nextSequenceBefore
        throw error
      }
      accepted = parsed
    })
    return accepted!
  }

  ready(now = Date.now()): readonly DomainExecutionOutboxRecord[] {
    return [...this.#records.values()]
      .filter((record) => (
        record.nextAttemptAt === undefined || Date.parse(record.nextAttemptAt) <= now
      ))
      .sort((left, right) => (
        left.sequence - right.sequence || left.event.eventId.localeCompare(right.event.eventId)
      ))
  }

  nextAttemptAt(): number | null {
    const values = [...this.#records.values()]
      .map((record) => record.nextAttemptAt ? Date.parse(record.nextAttemptAt) : Date.now())
      .filter(Number.isFinite)
    return values.length > 0 ? Math.min(...values) : null
  }

  all(): readonly DomainExecutionOutboxRecord[] {
    return [...this.#records.values()]
  }

  record(eventId: string): DomainExecutionOutboxRecord | undefined {
    return this.#records.get(eventId)
  }

  wasDelivered(eventId: string): boolean {
    return this.#receipts.has(eventId)
  }

  async markTraceRecorded(eventId: string): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(eventId)
      if (!current || current.traceRecorded) return
      const updated = Object.freeze({
        ...current,
        traceRecorded: true,
        updatedAt: new Date().toISOString()
      })
      this.#records.set(eventId, updated)
      try {
        await this.#persist()
      } catch (error) {
        this.#records.set(eventId, current)
        throw error
      }
    })
  }

  async markDelivered(eventId: string): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(eventId)
      if (!current) return
      const receiptsBefore = new Map(this.#receipts)
      const receipt: DomainExecutionDeliveryReceipt = Object.freeze({
        eventId,
        intentDigest: packageIntentDigest(current.event),
        producer: Object.freeze({ ...current.event.producer }),
        terminalKey: terminalIdentityKey(current.event),
        sequence: current.sequence,
        deliveredAt: new Date().toISOString()
      })
      this.#records.delete(eventId)
      this.#receipts.set(eventId, receipt)
      this.#pruneReceipts()
      try {
        await this.#persist()
      } catch (error) {
        this.#records.set(eventId, current)
        this.#receipts = receiptsBefore
        throw error
      }
    })
  }

  async markFailed(eventId: string, error: unknown, retryAfterMs: number): Promise<void> {
    await this.load()
    await this.#mutate(async () => {
      const current = this.#records.get(eventId)
      if (!current) return
      const now = Date.now()
      const updated = Object.freeze({
        ...current,
        attempts: current.attempts + 1,
        updatedAt: new Date(now).toISOString(),
        nextAttemptAt: new Date(now + Math.max(0, retryAfterMs)).toISOString(),
        error: errorMessage(error).slice(0, 4_000)
      })
      this.#records.set(eventId, updated)
      try {
        await this.#persist()
      } catch (persistError) {
        this.#records.set(eventId, current)
        throw persistError
      }
    })
  }

  async #persist(): Promise<void> {
    const payload: PersistedOutbox = {
      version: OUTBOX_VERSION,
      nextSequence: this.#nextSequence,
      records: [...this.#records.values()].sort((left, right) => (
        left.sequence - right.sequence || left.event.eventId.localeCompare(right.event.eventId)
      )),
      receipts: [...this.#receipts.values()].sort((left, right) => (
        left.deliveredAt.localeCompare(right.deliveredAt) ||
        left.eventId.localeCompare(right.eventId)
      )),
      terminalIdentities: [...this.#terminalIdentities.values()].sort((left, right) => (
        left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)
      )),
      ambiguousLegacyProducers: [...this.#ambiguousLegacyProducers].sort()
    }
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await chmod(dirname(this.path), 0o700)
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
    try {
      temporaryHandle = await open(temporary, 'wx', 0o600)
      await temporaryHandle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await temporaryHandle.sync()
      await temporaryHandle.close()
      temporaryHandle = undefined
      await rename(temporary, this.path)
      // Windows does not support opening a directory as a FileHandle. POSIX
      // needs this sync to make the rename durable across sudden power loss.
      if (process.platform !== 'win32') {
        const directoryHandle = await open(dirname(this.path), 'r')
        try {
          await directoryHandle.sync()
        } finally {
          await directoryHandle.close()
        }
      }
    } catch (error) {
      await temporaryHandle?.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  async #mutate(operation: () => Promise<void>): Promise<void> {
    const pending = this.#mutation.then(operation, operation)
    this.#mutation = pending.catch(() => undefined)
    await pending
  }

  #pruneReceipts(): void {
    const overflow = this.#receipts.size - this.#maxDeliveredReceipts
    if (overflow <= 0) return
    // An early v2 receipt has no recoverable terminal tuple. Its producer-level
    // ambiguity tombstone blocks new terminals, and the exact receipt must also
    // remain so a crash retry of that eventId can still be acknowledged.
    const oldest = [...this.#receipts.values()]
      .filter((receipt) => this.#terminalIdentities.has(receipt.eventId))
      .sort((left, right) => (
        left.deliveredAt.localeCompare(right.deliveredAt) ||
        left.eventId.localeCompare(right.eventId)
      ))
      .slice(0, overflow)
    for (const receipt of oldest) this.#receipts.delete(receipt.eventId)
  }
}

async function restoreLegacyReceiptIdentities(
  value: unknown,
  resolver: DomainExecutionEventOutboxOptions['resolveLegacyTerminalEvents']
): Promise<unknown> {
  if (
    resolver === undefined ||
    !isRecord(value) ||
    value.version !== LEGACY_OUTBOX_VERSION ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.receipts) ||
    value.records.length > MAX_PENDING_EVENTS ||
    value.receipts.length > MAX_DELIVERED_RECEIPTS
  ) return value

  // Parse the legacy envelope before asking an external reader for anything.
  // Malformed records must still fail startup instead of influencing the query.
  const records = value.records.map((record, index) => parseRecord(record, index + 1))
  const receipts = value.receipts.map(parseReceipt)
  const unresolvedIds = receipts.flatMap((receipt) => (
    receipt.terminalKey === undefined || receipt.sequence === undefined
      ? [receipt.eventId]
      : []
  ))
  if (unresolvedIds.length === 0) return value

  let candidates: readonly unknown[]
  try {
    candidates = await resolver(Object.freeze([...new Set(unresolvedIds)].sort()))
  } catch {
    // Full Trace recovery is an availability upgrade, never a trust bypass.
    // The normal v2 migration will retain exact receipts and block the producer.
    return value
  }
  if (!Array.isArray(candidates)) return value

  const events = new Map<string, DomainExecutionEventV1>()
  const conflictingEventIds = new Set<string>()
  for (const candidate of candidates) {
    let event: DomainExecutionEventV1
    try {
      event = terminalEvent(candidate)
    } catch {
      continue
    }
    const existing = events.get(event.eventId)
    if (existing && packageIntentDigest(existing) !== packageIntentDigest(event)) {
      conflictingEventIds.add(event.eventId)
      events.delete(event.eventId)
      continue
    }
    if (!conflictingEventIds.has(event.eventId)) events.set(event.eventId, event)
  }

  const usedSequences = new Set<number>([
    ...records.map((record) => record.sequence),
    ...receipts.flatMap((receipt) => receipt.sequence === undefined ? [] : [receipt.sequence])
  ])
  let nextSequence = Math.max(0, ...usedSequences) + 1
  const restored = receipts.map((receipt): DomainExecutionDeliveryReceipt => {
    if (receipt.terminalKey !== undefined && receipt.sequence !== undefined) return receipt
    const event = events.get(receipt.eventId)
    if (
      !event ||
      !sameProducer(event.producer, receipt.producer) ||
      packageIntentDigest(event) !== receipt.intentDigest
    ) return receipt
    while (usedSequences.has(nextSequence)) nextSequence += 1
    if (!Number.isSafeInteger(nextSequence) || nextSequence <= 0) {
      throw new Error('Domain execution legacy acceptance sequence is exhausted.')
    }
    const sequence = nextSequence
    usedSequences.add(sequence)
    nextSequence += 1
    return Object.freeze({
      ...receipt,
      terminalKey: terminalIdentityKey(event),
      sequence
    })
  })
  const minimumNextSequence = Math.max(0, ...usedSequences) + 1
  const persistedNextSequence = value.nextSequence === undefined
    ? minimumNextSequence
    : Math.max(
        positiveSafeInteger(value.nextSequence, 'nextSequence'),
        minimumNextSequence
      )
  return {
    ...value,
    nextSequence: persistedNextSequence,
    receipts: restored
  }
}

function parseOutbox(
  value: unknown,
  limits: Readonly<{
    maxDeliveredReceipts: number
    maxTerminalIdentities: number
  }>
): ParsedOutbox {
  if (
    !isRecord(value) ||
    (value.version !== OUTBOX_VERSION && value.version !== LEGACY_OUTBOX_VERSION) ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.receipts)
  ) {
    throw new Error('Domain execution handoff outbox has an unsupported schema.')
  }
  if (value.records.length > MAX_PENDING_EVENTS) {
    throw new Error('Domain execution handoff outbox exceeds its bounded capacity.')
  }
  // Version 2 records written before Host sequencing are migrated in their
  // persisted order; all subsequently written records carry an explicit value.
  const records = value.records.map((record, index) => parseRecord(record, index + 1))
  if (new Set(records.map((record) => record.event.eventId)).size !== records.length) {
    throw new Error('Domain execution handoff outbox contains duplicate event ids.')
  }
  if (value.receipts.length > limits.maxDeliveredReceipts) {
    throw new Error('Domain execution handoff outbox exceeds its receipt capacity.')
  }
  const receipts = value.receipts.map(parseReceipt)
  const receiptIds = new Set(receipts.map((receipt) => receipt.eventId))
  if (receiptIds.size !== receipts.length) {
    throw new Error('Domain execution handoff outbox contains duplicate delivery receipts.')
  }
  if (records.some((record) => receiptIds.has(record.event.eventId))) {
    throw new Error('Domain execution handoff outbox contains pending and delivered duplicates.')
  }
  const terminalIdentities = value.version === OUTBOX_VERSION
    ? parseTerminalIdentities(value.terminalIdentities, limits.maxTerminalIdentities)
    : migrateTerminalIdentities(records, receipts, limits.maxTerminalIdentities)
  const ambiguousLegacyProducers = value.version === OUTBOX_VERSION
    ? parseAmbiguousLegacyProducers(value.ambiguousLegacyProducers)
    : legacyAmbiguousProducers(receipts)
  assertTerminalIdentityIndex(records, receipts, terminalIdentities)
  assertLegacyAmbiguitiesCovered(receipts, ambiguousLegacyProducers)
  const assignedSequences = terminalIdentities.map((identity) => identity.sequence)
  if (new Set(assignedSequences).size !== assignedSequences.length) {
    throw new Error('Domain execution handoff outbox contains duplicate acceptance sequences.')
  }
  const minimumNextSequence = Math.max(0, ...assignedSequences) + 1
  const nextSequence = value.nextSequence === undefined
    ? minimumNextSequence
    : positiveSafeInteger(value.nextSequence, 'nextSequence')
  if (nextSequence < minimumNextSequence) {
    throw new Error('Domain execution handoff nextSequence precedes an accepted event.')
  }
  return {
    version: OUTBOX_VERSION,
    nextSequence,
    records,
    receipts,
    terminalIdentities,
    ambiguousLegacyProducers,
    needsMigration: value.version !== OUTBOX_VERSION
  }
}

function parseAmbiguousLegacyProducers(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_DELIVERED_RECEIPTS) {
    throw new Error('Domain execution legacy terminal ambiguity index must be a bounded array.')
  }
  const producers = value.map((entry) => required(
    entry,
    'legacy terminal ambiguity producer',
    512
  ))
  if (new Set(producers).size !== producers.length) {
    throw new Error('Domain execution legacy terminal ambiguity index contains duplicates.')
  }
  return producers
}

function legacyAmbiguousProducers(
  receipts: readonly DomainExecutionDeliveryReceipt[]
): readonly string[] {
  return [...new Set(receipts.flatMap((receipt) => (
    receipt.terminalKey === undefined || receipt.sequence === undefined
      ? [receipt.producer.moduleId]
      : []
  )))].sort()
}

function assertLegacyAmbiguitiesCovered(
  receipts: readonly DomainExecutionDeliveryReceipt[],
  ambiguousLegacyProducers: readonly string[]
): void {
  const covered = new Set(ambiguousLegacyProducers)
  for (const producer of legacyAmbiguousProducers(receipts)) {
    if (!covered.has(producer)) {
      throw new Error('Domain execution legacy receipt lacks its fail-closed ambiguity tombstone.')
    }
  }
}

function parseTerminalIdentities(
  value: unknown,
  maximum: number
): readonly DomainExecutionTerminalIdentity[] {
  if (!Array.isArray(value)) {
    throw new Error('Domain execution handoff terminal identity index must be an array.')
  }
  if (value.length > maximum) {
    throw new Error('Domain execution handoff exceeds its terminal identity capacity.')
  }
  return value.map(parseTerminalIdentity)
}

function parseTerminalIdentity(value: unknown): DomainExecutionTerminalIdentity {
  if (!isRecord(value)) {
    throw new Error('Domain execution terminal identity must be an object.')
  }
  const terminalKey = sha256Digest(value.terminalKey, 'terminal identity terminalKey')
  const eventId = required(value.eventId, 'terminal identity eventId', 512)
  const intentDigest = sha256Digest(value.intentDigest, 'terminal identity intentDigest')
  const producer = domainExecutionEventSchema.shape.producer.parse(value.producer)
  return Object.freeze({
    terminalKey,
    eventId,
    intentDigest,
    producer: Object.freeze(producer),
    sequence: positiveSafeInteger(value.sequence, 'terminal identity sequence'),
    acceptedAt: timestamp(value.acceptedAt, 'terminal identity acceptedAt')
  })
}

function migrateTerminalIdentities(
  records: readonly DomainExecutionOutboxRecord[],
  receipts: readonly DomainExecutionDeliveryReceipt[],
  maximum: number
): readonly DomainExecutionTerminalIdentity[] {
  const migrated = [
    ...records.map((record): DomainExecutionTerminalIdentity => Object.freeze({
      terminalKey: terminalIdentityKey(record.event),
      eventId: record.event.eventId,
      intentDigest: packageIntentDigest(record.event),
      producer: Object.freeze({ ...record.event.producer }),
      sequence: record.sequence,
      acceptedAt: record.createdAt
    })),
    // Early v2 receipts did not retain executionId/runId and therefore cannot
    // be promoted into a terminal tuple.  Keep those receipts for exact event
    // dedupe; every receipt written with the complete Host envelope migrates.
    ...receipts.flatMap((receipt): DomainExecutionTerminalIdentity[] => (
      receipt.terminalKey === undefined || receipt.sequence === undefined
        ? []
        : [Object.freeze({
            terminalKey: receipt.terminalKey,
            eventId: receipt.eventId,
            intentDigest: receipt.intentDigest,
            producer: Object.freeze({ ...receipt.producer }),
            sequence: receipt.sequence,
            acceptedAt: receipt.deliveredAt
          })]
    ))
  ]
  if (migrated.length > maximum) {
    throw new Error('Domain execution handoff exceeds its terminal identity capacity.')
  }
  return migrated
}

function parseReceipt(value: unknown): DomainExecutionDeliveryReceipt {
  if (!isRecord(value)) throw new Error('Domain execution delivery receipt must be an object.')
  const eventId = required(value.eventId, 'receipt eventId', 512)
  const intentDigest = required(value.intentDigest, 'receipt intentDigest', 71)
  if (!/^sha256:[0-9a-f]{64}$/u.test(intentDigest)) {
    throw new Error('Domain execution receipt intentDigest must be a sha256 digest.')
  }
  const producer = domainExecutionEventSchema.shape.producer.parse(value.producer)
  const terminalKey = value.terminalKey === undefined
    ? undefined
    : sha256Digest(value.terminalKey, 'receipt terminalKey')
  const sequence = value.sequence === undefined
    ? undefined
    : positiveSafeInteger(value.sequence, 'receipt sequence')
  return Object.freeze({
    eventId,
    intentDigest,
    producer: Object.freeze(producer),
    ...(terminalKey ? { terminalKey } : {}),
    ...(sequence === undefined ? {} : { sequence }),
    deliveredAt: timestamp(value.deliveredAt, 'receipt deliveredAt')
  })
}

function parseRecord(value: unknown, legacySequence: number): DomainExecutionOutboxRecord {
  if (!isRecord(value)) throw new Error('Domain execution handoff record must be an object.')
  const event = terminalEvent(value.event)
  const sequence = value.sequence === undefined
    ? legacySequence
    : positiveSafeInteger(value.sequence, 'record sequence')
  if (
    value.workspaceBound !== undefined &&
    value.workspaceBound !== true &&
    value.workspaceBound !== false
  ) {
    throw new Error('Domain execution handoff workspaceBound must be a boolean.')
  }
  const workspaceBound = value.workspaceBound === true
  if (workspaceBound && !event.workspaceRoot?.trim()) {
    throw new Error('A workspace-bound execution record is missing workspaceRoot.')
  }
  const traceRecorded = value.traceRecorded === true
  const attempts = value.attempts
  if (!Number.isInteger(attempts) || Number(attempts) < 0) {
    throw new Error('Domain execution handoff attempts must be a non-negative integer.')
  }
  const createdAt = timestamp(value.createdAt, 'createdAt')
  const updatedAt = timestamp(value.updatedAt, 'updatedAt')
  const nextAttemptAt = value.nextAttemptAt === undefined
    ? undefined
    : timestamp(value.nextAttemptAt, 'nextAttemptAt')
  return Object.freeze({
    event,
    sequence,
    workspaceBound,
    traceRecorded,
    attempts: Number(attempts),
    createdAt,
    updatedAt,
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 4_000) } : {})
  })
}

function assertTerminalIdentityIndex(
  records: readonly DomainExecutionOutboxRecord[],
  receipts: readonly DomainExecutionDeliveryReceipt[],
  identities: readonly DomainExecutionTerminalIdentity[]
): void {
  const byEventId = new Map<string, DomainExecutionTerminalIdentity>()
  const byTerminalKey = new Map<string, string>()
  for (const identity of identities) {
    if (byEventId.has(identity.eventId)) {
      throw new Error('Domain execution handoff contains duplicate terminal identity event ids.')
    }
    const existing = byTerminalKey.get(identity.terminalKey)
    if (existing !== undefined && existing !== identity.eventId) {
      throw new Error('Domain execution handoff outbox contains conflicting terminal events.')
    }
    byEventId.set(identity.eventId, identity)
    byTerminalKey.set(identity.terminalKey, identity.eventId)
  }
  for (const record of records) {
    const identity = byEventId.get(record.event.eventId)
    if (
      identity === undefined ||
      identity.terminalKey !== terminalIdentityKey(record.event) ||
      identity.intentDigest !== packageIntentDigest(record.event) ||
      identity.sequence !== record.sequence ||
      !sameProducer(identity.producer, record.event.producer)
    ) {
      throw new Error('Domain execution pending record does not match its terminal identity.')
    }
  }
  for (const receipt of receipts) {
    if ((receipt.terminalKey === undefined) !== (receipt.sequence === undefined)) {
      throw new Error('Domain execution delivery receipt has an incomplete terminal identity.')
    }
    if (receipt.terminalKey === undefined || receipt.sequence === undefined) continue
    const identity = byEventId.get(receipt.eventId)
    if (
      identity === undefined ||
      identity.terminalKey !== receipt.terminalKey ||
      identity.intentDigest !== receipt.intentDigest ||
      identity.sequence !== receipt.sequence ||
      !sameProducer(identity.producer, receipt.producer)
    ) {
      throw new Error('Domain execution delivery receipt does not match its terminal identity.')
    }
  }
}

function sameProducer(
  left: DomainExecutionEventV1['producer'],
  right: DomainExecutionEventV1['producer']
): boolean {
  return left.moduleId === right.moduleId && left.moduleVersion === right.moduleVersion
}

function terminalCollision(event: DomainExecutionEventV1, conflict: string): Error {
  return new Error(
    `Domain execution terminal collision for ${event.producer.moduleId}:${event.executionId}:${event.runId} (${conflict} vs ${event.eventId}).`
  )
}

function terminalIdentityKey(event: DomainExecutionEventV1): string {
  const identity = canonicalizeReproValue({
    producer: event.producer.moduleId,
    executionId: event.executionId,
    runId: event.runId
  } as DomainPackageJsonValue)
  return `sha256:${createHash('sha256').update(identity).digest('hex')}`
}

function terminalEvent(value: unknown): DomainExecutionEventV1 {
  const event = domainExecutionEventSchema.parse(value)
  if (event.phase !== 'run_completed' && event.phase !== 'run_failed') {
    throw new Error('Only terminal domain execution events belong in the handoff outbox.')
  }
  return deepFreeze(event)
}

function assertSamePackageIntent(
  accepted: DomainExecutionEventV1,
  repeated: DomainExecutionEventV1
): void {
  assertSamePackageIntentDigest(packageIntentDigest(accepted), repeated)
}

function assertSamePackageIntentDigest(
  acceptedDigest: string,
  repeated: DomainExecutionEventV1
): void {
  if (acceptedDigest !== packageIntentDigest(repeated)) {
    throw new Error(`Domain execution eventId collision: ${repeated.eventId}`)
  }
}

/** The active package version is Host-injected metadata, not package-owned intent identity. */
function packageIntentDigest(event: DomainExecutionEventV1): string {
  const { moduleVersion: _moduleVersion, ...producer } = event.producer
  const canonical = canonicalizeReproValue({ ...event, producer } as DomainPackageJsonValue)
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Domain execution handoff ${field} must be a timestamp.`)
  }
  return new Date(value).toISOString()
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Domain execution handoff ${field} must be a positive safe integer.`)
  }
  return Number(value)
}

function boundedCapacity(value: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${field} must be a positive safe integer no greater than ${maximum}.`)
  }
  return value
}

function sha256Digest(value: unknown, field: string): string {
  const parsed = required(value, field, 71)
  if (!/^sha256:[0-9a-f]{64}$/u.test(parsed)) {
    throw new Error(`Domain execution handoff ${field} must be a sha256 digest.`)
  }
  return parsed
}

function required(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`Domain execution handoff ${field} must be a non-empty bounded string.`)
  }
  return value.trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
