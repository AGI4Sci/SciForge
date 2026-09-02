import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  compareEvidenceDagWatermarks,
  evidenceDagCommittedSnapshotSchema,
  evidenceDagClosurePolicyV1Schema,
  evidenceDagCompactSummarySchema,
  evidenceDagCorrectionRecordV1Schema,
  evidenceDagDeltaSchema,
  evidenceDagHeadSchema,
  evidenceDagIndependenceMetadataV1Schema,
  evidenceDagLegacyCheckpointRootSchema,
  evidenceDagProvisionalViewSchema,
  evidenceDagSealedClosureSchema,
  evidenceDagSidechainRecordV1Schema,
  type EvidenceDagClosurePolicyV1,
  type EvidenceDagCommittedSnapshot,
  type EvidenceDagCompactSummary,
  type EvidenceDagCorrectionRecordV1,
  type EvidenceDagDelta,
  type EvidenceDagHead,
  type EvidenceDagLegacyCheckpointRoot,
  type EvidenceDagProvisionalView,
  type EvidenceDagSealedClosure,
  type EvidenceDagSidechainRecordV1,
  type EvidenceDagTypedError
} from '../contract.js'

export type EvidenceDagDeltaAppendInput = Readonly<{
  scope: EvidenceDagDelta['scope']
  requestedWatermark: string
  committedWatermark?: string
  schemaVersion: string
  extractorVersion: string
  verifierVersion: string
  idempotencyKey: string
  sourceRefs?: readonly string[]
  artifactRefs?: readonly string[]
  runRefs?: readonly string[]
  payload: Readonly<Record<string, unknown>>
  predecessorDigest?: string | null
  createdAt?: string
}>

export type EvidenceDagAppendResult = Readonly<{
  delta: EvidenceDagDelta
  idempotent: boolean
}>

export type EvidenceDagSidechainAppendResult = Readonly<{
  record: EvidenceDagSidechainRecordV1
  idempotent: boolean
}>

export type EvidenceDagProvisionalCompileInput = Readonly<{
  compilerVersion: string
  policyVersion: string
  desiredHeadDigest?: string | null
  summary?: Partial<EvidenceDagCompactSummary>
  lastGood?: Readonly<Record<string, unknown>> | null
  failure?: EvidenceDagTypedError | null
  now?: string
}>

export type EvidenceDagLegacyRootInput = Readonly<{
  snapshot: Readonly<Record<string, unknown>>
  snapshotBytes: Uint8Array
  ancestry: 'proven' | 'unproven'
  gapCodes?: readonly EvidenceDagSealedClosure['gapCodes'][number][]
  importedAt?: string
}>

export type EvidenceDagCorrectionAppendInput = Readonly<{
  scope: EvidenceDagDelta['scope']
  requestedWatermark: string
  idempotencyKey: string
  correction: EvidenceDagCorrectionRecordV1
  sourceRefs?: readonly string[]
  artifactRefs?: readonly string[]
  runRefs?: readonly string[]
  predecessorDigest?: string | null
  createdAt?: string
}>

export type EvidenceDagAssessmentAppendInput = Readonly<{
  scope: EvidenceDagDelta['scope']
  requestedWatermark: string
  idempotencyKey: string
  assessment: Readonly<Record<string, unknown>>
  sourceRefs?: readonly string[]
  artifactRefs?: readonly string[]
  runRefs?: readonly string[]
  predecessorDigest?: string | null
  createdAt?: string
}>

export type EvidenceDagSidechainAppendInput = Readonly<{
  threadId: string
  recordId: string
  recordType: EvidenceDagSidechainRecordV1['recordType']
  closureDigest: string
  idempotencyKey: string
  payload: Readonly<Record<string, unknown>>
  producerIdentity: string
  reviewerIdentity?: string | null
  createdAt?: string
}>

export type EvidenceDagTraceAppendInput = Readonly<{
  runtimeId: string
  threadId: string
  workspaceRoot: string
  operationId: string
  kind: EvidenceDagDelta['scope']['kind']
  requestedWatermark: string
  idempotencyKey: string
  trace: readonly Readonly<Record<string, unknown>>[]
  eventKind?: string
  createdAt?: string
}>

export type EvidenceDagProvisionalCompilerOptions = Readonly<{
  compilerVersion: string
  policyVersion: string
  now?: string
}>

export type EvidenceDagSealErrorCode =
  | 'stale_head'
  | 'invalid_predecessor'
  | 'invalid_legacy_root'
  | 'invalid_sidechain'
  | 'cycle_detected'
  | 'unknown_edge'

export class EvidenceDagSealError extends Error {
  readonly code: EvidenceDagSealErrorCode

  constructor(code: EvidenceDagSealErrorCode, message: string) {
    super(message)
    this.name = 'EvidenceDagSealError'
    this.code = code
  }
}

type EvidenceDagChainOptions = Readonly<{
  legacyRoot?: EvidenceDagLegacyCheckpointRoot | null
  committedSnapshot?: EvidenceDagCommittedSnapshot | null
  committedSnapshotClosureDigest?: string | null
  committedSnapshotClosures?: Readonly<Record<string, string>>
  provisional?: EvidenceDagProvisionalView | null
  closures?: readonly EvidenceDagSealedClosure[]
  sidechains?: readonly EvidenceDagSidechainRecordV1[]
  sealIdempotency?: Readonly<Record<string, string>>
}>

/** The single append-only owner of one Evidence thread. */
export class EvidenceDeltaChain {
  private readonly records: EvidenceDagDelta[] = []
  private readonly closuresByDigest = new Map<string, EvidenceDagSealedClosure>()
  private readonly sidechains: EvidenceDagSidechainRecordV1[] = []
  private readonly sealIdempotency = new Map<string, string>()
  private readonly committedSnapshotClosures = new Map<string, string>()
  private scopeIdentity: Pick<EvidenceDagDelta['scope'], 'runtimeId' | 'workspaceRoot'> | undefined
  private legacyRoot: EvidenceDagLegacyCheckpointRoot | null
  private committedSnapshot: EvidenceDagCommittedSnapshot | null
  private committedSnapshotClosureDigest: string | null
  private provisionalState: EvidenceDagProvisionalView | null

  constructor(
    private readonly threadId: string,
    records: readonly EvidenceDagDelta[] = [],
    options: EvidenceDagChainOptions = {}
  ) {
    this.legacyRoot = options.legacyRoot
      ? evidenceDagLegacyCheckpointRootSchema.parse(options.legacyRoot)
      : null
    this.committedSnapshot = options.committedSnapshot
      ? evidenceDagCommittedSnapshotSchema.parse(options.committedSnapshot)
      : null
    this.committedSnapshotClosureDigest = options.committedSnapshotClosureDigest ?? null
    if (this.committedSnapshotClosureDigest && !this.committedSnapshot) {
      throw new Error('Evidence committed Snapshot closure mapping has no Snapshot.')
    }
    if (this.committedSnapshot?.threadId !== undefined && this.committedSnapshot.threadId !== threadId) {
      throw new Error('Evidence committed Snapshot scope does not match its chain thread.')
    }
    this.provisionalState = options.provisional
      ? evidenceDagProvisionalViewSchema.parse(options.provisional)
      : null
    if (this.legacyRoot) this.validateLegacyRoot(this.legacyRoot)
    if (this.legacyRoot?.threadId !== undefined && this.legacyRoot.threadId !== threadId) {
      throw new Error('Evidence legacy root scope does not match its chain thread.')
    }
    if (this.provisionalState?.threadId !== undefined && this.provisionalState.threadId !== threadId) {
      throw new Error('Evidence provisional view scope does not match its chain thread.')
    }
    for (const closure of options.closures ?? []) {
      const parsed = evidenceDagSealedClosureSchema.parse(closure)
      if (parsed.threadId !== threadId) throw new Error('Evidence closure scope does not match its chain thread.')
      this.closuresByDigest.set(parsed.closureDigest, structuredClone(parsed))
    }
    for (const record of records) this.appendExisting(record)
    for (const closure of this.closuresByDigest.values()) this.validateClosure(closure)
    for (const [closureDigest, snapshotDigest] of Object.entries(options.committedSnapshotClosures ?? {})) {
      const closure = this.closuresByDigest.get(closureDigest)
      if (!closure) {
        throw new EvidenceDagSealError('invalid_sidechain', 'Evidence committed Snapshot binding points to an unknown closure.')
      }
      if (closure.status !== 'complete') {
        throw new EvidenceDagSealError('invalid_sidechain', 'Evidence committed Snapshot binding points to an incomplete closure.')
      }
      if (!/^sha256:[0-9a-f]{64}$/u.test(snapshotDigest)) {
        throw new Error('Evidence committed Snapshot binding has an invalid Snapshot digest.')
      }
      this.committedSnapshotClosures.set(closureDigest, snapshotDigest)
    }
    if (this.committedSnapshot && this.committedSnapshotClosureDigest) {
      if (!this.closuresByDigest.has(this.committedSnapshotClosureDigest)) {
        throw new EvidenceDagSealError('invalid_sidechain', 'Evidence committed Snapshot binding points to an unknown closure.')
      }
      const existing = this.committedSnapshotClosures.get(this.committedSnapshotClosureDigest)
      if (existing && existing !== this.committedSnapshot.digest) {
        throw new Error('Evidence committed Snapshot has a conflicting closure binding.')
      }
      this.committedSnapshotClosures.set(
        this.committedSnapshotClosureDigest,
        this.committedSnapshot.digest
      )
    }
    if (this.committedSnapshot) {
      if (!this.committedSnapshotClosureDigest) {
        throw new Error('Evidence committed Snapshot must be bound to a sealed closure.')
      }
      this.validateCommittedSnapshotBinding(
        this.committedSnapshot,
        this.committedSnapshotClosureDigest
      )
    }
    for (const sidechain of options.sidechains ?? []) this.appendSidechainExisting(sidechain)
    for (const [key, closureDigest] of Object.entries(options.sealIdempotency ?? {})) {
      if (!this.closuresByDigest.has(closureDigest)) {
        throw new EvidenceDagSealError('invalid_sidechain', 'Evidence seal idempotency points to an unknown closure.')
      }
      this.sealIdempotency.set(key, closureDigest)
    }
  }

  get head(): EvidenceDagHead {
    const last = this.records.at(-1)
    return evidenceDagHeadSchema.parse({
      threadId: this.threadId,
      headDigest: last?.deltaDigest ?? this.legacyRoot?.snapshot.digest ?? null,
      sequence: last?.sequence ?? 0,
      committedWatermark: last?.committedWatermark ?? this.legacyRoot?.snapshot.inputWatermark ?? null,
      updatedAt: last?.createdAt ?? this.legacyRoot?.importedAt ?? new Date(0).toISOString(),
      rootKind: last ? 'delta' : this.legacyRoot ? 'legacy_checkpoint_root' : 'empty',
      legacyRootStatus: this.legacyRoot?.status ?? null
    })
  }

  get provisionalView(): EvidenceDagProvisionalView | null {
    return this.provisionalState ? structuredClone(this.provisionalState) : null
  }

  get legacyCheckpointRoot(): EvidenceDagLegacyCheckpointRoot | null {
    return this.legacyRoot ? structuredClone(this.legacyRoot) : null
  }

  /** Exact immutable Snapshot identity last materialized by the Evidence owner. */
  get committedEvidenceSnapshot(): EvidenceDagCommittedSnapshot | null {
    return this.committedSnapshot ? structuredClone(this.committedSnapshot) : null
  }

  setCommittedEvidenceSnapshot(snapshot: EvidenceDagCommittedSnapshot, closureDigest: string): void {
    const parsed = this.validateCommittedSnapshot(snapshot)
    if (parsed.threadId !== this.threadId) {
      throw new Error('Evidence committed Snapshot scope does not match its chain thread.')
    }
    this.validateCommittedSnapshotBinding(parsed, closureDigest)
    // Snapshot replacement and closure binding are one in-memory transaction;
    // the store persists both together after this method returns.
    this.committedSnapshot = structuredClone(parsed)
    this.committedSnapshotClosureDigest = closureDigest
    this.committedSnapshotClosures.set(closureDigest, parsed.digest)
  }

  get committedSnapshotClosure(): string | null {
    return this.committedSnapshotClosureDigest
  }

  private validateCommittedSnapshot(
    snapshot: EvidenceDagCommittedSnapshot
  ): EvidenceDagCommittedSnapshot {
    const parsed = evidenceDagCommittedSnapshotSchema.parse(snapshot)
    if (parsed.threadId !== this.threadId) {
      throw new Error('Evidence committed Snapshot scope does not match its chain thread.')
    }
    const current = this.committedSnapshot
    if (current && parsed.version < current.version) {
      throw new Error('Evidence committed Snapshot version regressed.')
    }
    if (current && parsed.version === current.version && canonicalJson(parsed) !== canonicalJson(current)) {
      throw new Error('Evidence committed Snapshot identity was mutated during replay.')
    }
    if (current && parsed.version > current.version) {
      if (parsed.digest === current.digest) {
        throw new Error('Evidence committed Snapshot digest was reused at a new version.')
      }
      const watermarkComparison = compareEvidenceDagWatermarks(parsed.inputWatermark, current.inputWatermark)
      if (watermarkComparison === undefined || watermarkComparison < 0) {
        throw new Error('Evidence committed Snapshot watermark regressed or cannot be compared.')
      }
    }
    return parsed
  }

  private validateCommittedSnapshotBinding(
    snapshot: EvidenceDagCommittedSnapshot,
    closureDigest: string
  ): void {
    if (typeof closureDigest !== 'string' || !closureDigest.trim()) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence committed Snapshot binding requires a closure digest.')
    }
    const closure = this.closuresByDigest.get(closureDigest)
    if (!closure) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence committed Snapshot binding points to an unknown closure.')
    }
    if (closure.threadId !== this.threadId || snapshot.threadId !== closure.threadId) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence committed Snapshot binding scope does not match its chain thread.')
    }
    if (closure.status !== 'complete') {
      throw new EvidenceDagSealError('invalid_sidechain', 'Only a complete Evidence closure can bind a committed Snapshot.')
    }
    if (closure.policy.expectedHeadDigest !== closure.headDigest) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence closure expected head does not match its sealed head.')
    }
    const headWatermark = this.watermarkForDigest(closure.headDigest)
    if (!headWatermark) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence committed Snapshot binding closure points to an unknown head.')
    }
    // A Snapshot is the materialized representation of this exact closure.
    // Merely covering its barrier would permit a later cumulative Snapshot to
    // be attached to an older closure whose membership it does not prove.
    if (snapshot.inputWatermark !== closure.policy.barrierWatermark) {
      throw new EvidenceDagSealError(
        'invalid_sidechain',
        'Evidence committed Snapshot watermark must exactly match the closure barrier.'
      )
    }
    if (snapshot.inputWatermark !== headWatermark) {
      throw new EvidenceDagSealError(
        'invalid_sidechain',
        'Evidence committed Snapshot watermark must exactly match the closure head.'
      )
    }
    const existingSnapshotDigest = this.committedSnapshotClosures.get(closureDigest)
    if (existingSnapshotDigest && existingSnapshotDigest !== snapshot.digest) {
      throw new Error('Evidence closure is already bound to another committed Snapshot.')
    }
  }

  private watermarkForDigest(digestValue: string): string | null {
    if (this.legacyRoot?.snapshot.digest === digestValue) return this.legacyRoot.snapshot.inputWatermark
    return this.records.find((record) => record.deltaDigest === digestValue)?.committedWatermark ?? null
  }

  list(): readonly EvidenceDagDelta[] {
    return this.records.map((record) => structuredClone(record))
  }

  closures(): readonly EvidenceDagSealedClosure[] {
    return [...this.closuresByDigest.values()].map((closure) => structuredClone(closure))
  }

  sidechainRecords(): readonly EvidenceDagSidechainRecordV1[] {
    return this.sidechains.map((record) => structuredClone(record))
  }

  sealIdempotencyEntries(): readonly [string, string][] {
    return [...this.sealIdempotency.entries()]
  }

  committedSnapshotClosureEntries(): readonly [string, string][] {
    return [...this.committedSnapshotClosures.entries()]
  }

  importLegacyRoot(input: EvidenceDagLegacyRootInput): EvidenceDagLegacyCheckpointRoot {
    if (this.legacyRoot || this.records.length) {
      throw new EvidenceDagSealError(
        'invalid_legacy_root',
        'A legacy checkpoint root can only be imported before the first delta.'
      )
    }
    const snapshot = normalizeLegacySnapshot(input.snapshot, this.threadId)
    const root = evidenceDagLegacyCheckpointRootSchema.parse({
      kind: 'legacy_checkpoint_root',
      threadId: this.threadId,
      snapshot,
      snapshotBytesBase64: Buffer.from(input.snapshotBytes).toString('base64'),
      snapshotBytesDigest: digestBytes(input.snapshotBytes),
      ancestry: input.ancestry,
      status: input.ancestry === 'proven' && !input.gapCodes?.length
        ? 'legacy/complete'
        : 'legacy/incomplete',
      gapCodes: uniqueSortedGapCodes([
        ...(input.gapCodes ?? []),
        ...(input.ancestry === 'unproven' ? ['lineage_incomplete' as const] : [])
      ]),
      importedAt: input.importedAt ?? new Date().toISOString()
    })
    this.validateLegacyRoot(root)
    this.legacyRoot = root
    return structuredClone(root)
  }

  append(input: EvidenceDagDeltaAppendInput): EvidenceDagAppendResult {
    const existing = this.records.find((record) => record.idempotencyKey === input.idempotencyKey)
    if (existing) {
      if (input.predecessorDigest !== undefined && input.predecessorDigest !== existing.predecessorDigest) {
        throw new EvidenceDagSealError('invalid_predecessor', 'Evidence delta replay supplied a different predecessor.')
      }
      // The first append owns generated fields such as `createdAt`. A replay
      // that omits those fields must still resolve to the original immutable
      // identity rather than becoming a different delta merely because the
      // retry happened at a later wall-clock time.
      const candidate = this.materialize(input, existing.predecessorDigest, existing.sequence, {
        createdAt: input.createdAt ?? existing.createdAt,
        committedWatermark: input.committedWatermark ?? existing.committedWatermark
      })
      if (canonicalJson(deltaIdentity(candidate)) !== canonicalJson(deltaIdentity(existing))) {
        throw new Error(`Evidence delta idempotency key ${input.idempotencyKey} was reused with different content.`)
      }
      return { delta: structuredClone(existing), idempotent: true }
    }
    this.ensureScopeIdentity(input.scope)
    // `undefined` means the caller omitted the predecessor and asks the
    // canonical writer to use the current head. An explicit null is a real
    // predecessor value and must fail once the chain has a root.
    const predecessorDigest = input.predecessorDigest === undefined
      ? this.head.headDigest
      : input.predecessorDigest
    if (predecessorDigest !== this.head.headDigest) {
      throw new EvidenceDagSealError('invalid_predecessor', 'Evidence delta predecessor does not match the authoritative head.')
    }
    const committedWatermark = input.committedWatermark ?? input.requestedWatermark
    const priorWatermark = this.head.committedWatermark
    const comparison = priorWatermark
      ? compareEvidenceDagWatermarks(committedWatermark, priorWatermark)
      : undefined
    if (comparison !== undefined && comparison < 0) {
      throw new Error('Evidence committed watermark regressed behind its predecessor.')
    }
    const delta = this.materialize({ ...input, committedWatermark }, predecessorDigest, this.records.length + 1)
    this.records.push(delta)
    return { delta: structuredClone(delta), idempotent: false }
  }

  appendCorrection(input: EvidenceDagCorrectionAppendInput): EvidenceDagAppendResult {
    const correction = evidenceDagCorrectionRecordV1Schema.parse(input.correction)
    return this.append({
      scope: input.scope,
      requestedWatermark: input.requestedWatermark,
      committedWatermark: input.requestedWatermark,
      schemaVersion: 'evidence.delta.v1',
      extractorVersion: 'correction',
      verifierVersion: 'correction',
      idempotencyKey: input.idempotencyKey,
      sourceRefs: input.sourceRefs,
      artifactRefs: input.artifactRefs,
      runRefs: input.runRefs,
      predecessorDigest: input.predecessorDigest,
      payload: { recordType: 'correction', correction },
      createdAt: input.createdAt
    })
  }

  appendAssessment(input: EvidenceDagAssessmentAppendInput): EvidenceDagAppendResult {
    validateAssessmentIndependence(input.assessment)
    return this.append({
      scope: input.scope,
      requestedWatermark: input.requestedWatermark,
      committedWatermark: input.requestedWatermark,
      schemaVersion: 'evidence.delta.v1',
      extractorVersion: 'assessment',
      verifierVersion: 'assessment',
      idempotencyKey: input.idempotencyKey,
      sourceRefs: input.sourceRefs,
      artifactRefs: input.artifactRefs,
      runRefs: input.runRefs,
      predecessorDigest: input.predecessorDigest,
      payload: { recordType: 'assessment', assessment: structuredClone(input.assessment) },
      createdAt: input.createdAt
    })
  }

  appendSidechain(input: EvidenceDagSidechainAppendInput): EvidenceDagSidechainAppendResult {
    const existing = this.sidechains.find((record) => record.idempotencyKey === input.idempotencyKey)
    if (existing) {
      const candidate = this.materializeSidechain(input, existing.sequence, {
        createdAt: input.createdAt ?? existing.createdAt
      })
      if (canonicalJson(candidate) !== canonicalJson(existing)) {
        throw new EvidenceDagSealError(
          'invalid_sidechain',
          `Evidence sidechain idempotency key ${input.idempotencyKey} was reused with different content.`
        )
      }
      return { record: structuredClone(existing), idempotent: true }
    }
    if (input.threadId !== this.threadId) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence sidechain scope does not match its chain thread.')
    }
    const closure = this.closuresByDigest.get(input.closureDigest)
    if (!closure) {
      throw new EvidenceDagSealError(
        'invalid_sidechain',
        'Evidence sidechain must reference an existing sealed closure.'
      )
    }
    if (sidechainRequiresCommittedSnapshot(input) && (
      closure.status !== 'complete' ||
      !this.committedSnapshotClosures.has(input.closureDigest)
    )) {
      throw new EvidenceDagSealError(
        'invalid_sidechain',
        'Approval or certification sidechains require a complete closure bound to a committed Snapshot.'
      )
    }
    if (this.sidechains.some((record) => record.recordId === input.recordId)) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence sidechain record ID is already committed.')
    }
    const record = this.materializeSidechain(input, this.sidechains.length + 1)
    this.sidechains.push(record)
    return { record: structuredClone(record), idempotent: false }
  }

  provisional(input: EvidenceDagProvisionalCompileInput): EvidenceDagProvisionalView {
    const now = input.now ?? new Date().toISOString()
    const head = this.head
    const desiredHeadDigest = input.desiredHeadDigest ?? head.headDigest
    const desiredIsKnown = desiredHeadDigest === null ||
      desiredHeadDigest === head.headDigest ||
      this.records.some((record) => record.deltaDigest === desiredHeadDigest) ||
      this.legacyRoot?.snapshot.digest === desiredHeadDigest
    const previous = this.provisionalState
    const failed = input.failure !== undefined && input.failure !== null
    const appliedHeadDigest = failed
      ? input.summary?.appliedHeadDigest ?? previous?.appliedHeadDigest ?? (
        input.lastGood !== undefined ? desiredHeadDigest : null
      )
      : desiredIsKnown ? desiredHeadDigest : previous?.appliedHeadDigest ?? null
    const derived = desiredIsKnown
      ? deriveProvisionalModel(this.records, appliedHeadDigest, this.legacyRoot)
      : null
    const summary = evidenceDagCompactSummarySchema.parse({
      desiredHeadDigest,
      appliedHeadDigest,
      freshness: failed ? 'failed' : !desiredIsKnown ? 'unknown' : desiredHeadDigest === appliedHeadDigest ? 'fresh' : 'stale',
      coverage: {
        complete: input.summary?.coverage?.complete ?? derived?.coverage.complete ?? !failed,
        gapCount: input.summary?.coverage?.gapCount ?? derived?.coverage.gapCount ?? 0
      },
      materialRiskCount: input.summary?.materialRiskCount ?? derived?.materialRiskCount ?? 0,
      lastSuccessAt: failed
        ? input.summary?.lastSuccessAt ?? previous?.summary.lastSuccessAt ?? null
        : now,
      failure: input.failure ?? null
    })
    const endSequence = desiredHeadDigest === null ? 0 : sequenceAt(this.records, desiredHeadDigest)
    const view = evidenceDagProvisionalViewSchema.parse({
      threadId: this.threadId,
      desiredHeadDigest,
      appliedHeadDigest,
      inputFingerprint: digest({
        threadId: this.threadId,
        desiredHeadDigest,
        compilerVersion: input.compilerVersion,
        policyVersion: input.policyVersion,
        deltas: this.records
          .filter((record) => endSequence >= 0 && record.sequence <= endSequence)
          .map((record) => ({
            deltaDigest: record.deltaDigest,
            payloadDigest: record.payloadDigest,
            predecessorDigest: record.predecessorDigest,
            sequence: record.sequence,
            scope: record.scope,
            requestedWatermark: record.requestedWatermark,
            committedWatermark: record.committedWatermark,
            schemaVersion: record.schemaVersion,
            extractorVersion: record.extractorVersion,
            verifierVersion: record.verifierVersion,
            idempotencyKey: record.idempotencyKey,
            sourceRefs: record.sourceRefs,
            artifactRefs: record.artifactRefs,
            runRefs: record.runRefs
          }))
      }),
      compilerVersion: input.compilerVersion,
      policyVersion: input.policyVersion,
      summary,
      lastGood: input.lastGood ?? (failed ? previous?.lastGood ?? null : derived?.model ?? null),
      updatedAt: now
    })
    this.provisionalState = view
    return structuredClone(view)
  }

  seal(policyInput: EvidenceDagClosurePolicyV1, idempotencyKey?: string): EvidenceDagSealedClosure {
    const policy = canonicalizeClosurePolicy(evidenceDagClosurePolicyV1Schema.parse(policyInput))
    const priorDigest = idempotencyKey ? this.sealIdempotency.get(idempotencyKey) : undefined
    if (priorDigest) {
      const existing = this.closuresByDigest.get(priorDigest)
      if (!existing) {
        throw new EvidenceDagSealError(
          'invalid_sidechain',
          `Evidence seal idempotency key ${idempotencyKey} points to a missing closure.`
        )
      }
      if (canonicalJson(existing.policy) !== canonicalJson(policy)) {
        throw new EvidenceDagSealError(
          'invalid_sidechain',
          `Evidence seal idempotency key ${idempotencyKey} was reused for a different closure.`
        )
      }
      // The closure is an immutable historical boundary. A newer delta may
      // have advanced the live head while a failed Snapshot materialization
      // is being retried, so replay the original closure before CAS-checking
      // the current head.
      return structuredClone(existing)
    }
    const head = this.head
    if (policy.expectedHeadDigest !== head.headDigest) {
      throw new EvidenceDagSealError('stale_head', `Evidence seal expected head ${policy.expectedHeadDigest} but authoritative head is ${head.headDigest ?? 'empty'}.`)
    }
    const content = this.deriveClosure(policy, head.headDigest)
    const closureDigest = content.closureDigest
    const existing = this.closuresByDigest.get(closureDigest)
    if (existing) {
      if (idempotencyKey) this.sealIdempotency.set(idempotencyKey, closureDigest)
      return structuredClone(existing)
    }
    const closure = evidenceDagSealedClosureSchema.parse({
      threadId: this.threadId,
      ...content,
      sealedAt: new Date().toISOString(),
      ...(this.legacyRoot ? { legacyRootStatus: this.legacyRoot.status } : {})
    })
    this.closuresByDigest.set(closure.closureDigest, structuredClone(closure))
    if (idempotencyKey) this.sealIdempotency.set(idempotencyKey, closureDigest)
    return closure
  }

  private deriveClosure(
    policy: EvidenceDagClosurePolicyV1,
    headDigest: string
  ): Readonly<{
    closureDigest: `sha256:${string}`
    headDigest: string
    policyDigest: `sha256:${string}`
    policy: EvidenceDagClosurePolicyV1
    status: EvidenceDagSealedClosure['status']
    includedDeltaDigests: string[]
    includedExternalRefs: string[]
    gapCodes: EvidenceDagSealedClosure['gapCodes']
    includedLegacyRootDigests?: string[]
  }> {
    const canonicalPolicy = canonicalizeClosurePolicy(policy)
    const headSequence = sequenceAt(this.records, headDigest)
    const isLegacyHead = this.legacyRoot?.snapshot.digest === headDigest
    if (headSequence < 0 && !isLegacyHead) {
      throw new Error('Evidence closure references an unknown head.')
    }
    const headWatermark = isLegacyHead
      ? this.legacyRoot?.snapshot.inputWatermark
      : this.records.find((record) => record.deltaDigest === headDigest)?.committedWatermark
    const gaps: EvidenceDagSealedClosure['gapCodes'][number][] = []
    // A closure may intentionally stop at an older comparable watermark, but
    // an incomparable record cannot be classified as before or after the
    // declared barrier. Keep the closure incomplete instead of silently
    // dropping that ordered history from the formal baseline.
    if (!isLegacyHead) {
      for (const record of this.records) {
        if (record.sequence > headSequence) continue
        if (compareEvidenceDagWatermarks(record.committedWatermark, canonicalPolicy.barrierWatermark) === undefined) {
          addGap(gaps, 'missing_delta')
        }
      }
    }
    const eligible = this.records.filter((record) =>
      record.sequence <= (isLegacyHead ? 0 : headSequence) &&
      watermarkAtOrBefore(record.committedWatermark, canonicalPolicy.barrierWatermark)
    )
    const barrierCoverage = headWatermark
      ? compareEvidenceDagWatermarks(headWatermark, canonicalPolicy.barrierWatermark)
      : undefined
    if (barrierCoverage === undefined || barrierCoverage < 0) addGap(gaps, 'missing_delta')
    const traversal = traverseClosure(eligible, canonicalPolicy, gaps)
    const includedRecords = eligible.filter((record) => traversal.deltaDigests.has(record.deltaDigest))
    const availableExternalRefs = uniqueSorted(includedRecords.flatMap((record) => [
      ...record.sourceRefs,
      ...record.artifactRefs,
      ...record.runRefs,
      ...collectDeclaredRefs(record.payload)
    ]))
    if (this.legacyRoot) availableExternalRefs.push(...this.legacyRoot.snapshot.artifactDigests)
    // Keep every external ref reached by the declared traversal. A policy may
    // also require a ref that is not available yet; retaining that exact
    // identity makes the missing boundary explicit in the closure.
    const includedExternalRefs = uniqueSorted([
      ...availableExternalRefs,
      ...canonicalPolicy.requiredExternalRefs
    ])
    for (const required of canonicalPolicy.requiredExternalRefs) {
      if (!availableExternalRefs.includes(required)) addGap(gaps, 'source_unavailable')
    }
  for (const required of policy.requiredRecords) {
      if (!traversal.reachedIds.has(required)) addGap(gaps, 'lineage_incomplete')
    }
    if (this.legacyRoot?.status === 'legacy/incomplete') addGap(gaps, 'lineage_incomplete')
    const gapCodes = uniqueSortedGapCodes(gaps)
    const status = gapCodes.length === 0 ? 'complete' : 'incomplete'
    // Set insertion follows traversal order, which depends on payload shape.
    // Closure identities must be stable even when equivalent records are
    // discovered through a different edge ordering.
    const includedDeltaDigests = [...traversal.deltaDigests].sort()
    const includedLegacyRootDigests = this.legacyRoot ? [this.legacyRoot.snapshot.digest] : undefined
    const policyDigest = digest(canonicalPolicy)
    const closureIdentity = {
      threadId: this.threadId,
      headDigest,
      policyDigest,
      status,
      includedDeltaDigests,
      includedExternalRefs,
      gapCodes,
      ...(includedLegacyRootDigests ? { includedLegacyRootDigests } : {})
    }
    return {
      closureDigest: digest(closureIdentity),
      headDigest,
      policyDigest,
      policy: canonicalPolicy,
      status,
      includedDeltaDigests,
      includedExternalRefs,
      gapCodes,
      ...(includedLegacyRootDigests ? { includedLegacyRootDigests } : {})
    }
  }

  private appendExisting(record: EvidenceDagDelta): void {
    const parsed = evidenceDagDeltaSchema.parse(record)
    this.ensureScopeIdentity(parsed.scope)
    if (parsed.scope.threadId !== this.threadId) throw new Error('Evidence delta scope does not match its chain thread.')
    if (this.records.some((existing) => existing.idempotencyKey === parsed.idempotencyKey)) {
      throw new Error('Evidence delta chain contains a duplicate idempotency key.')
    }
    if (parsed.predecessorDigest !== this.head.headDigest || parsed.sequence !== this.records.length + 1) {
      throw new EvidenceDagSealError('invalid_predecessor', 'Evidence delta chain contains a missing or reordered predecessor.')
    }
    if (parsed.payloadDigest !== digest(parsed.payload)) throw new Error('Evidence delta payload digest does not match its payload.')
    const { deltaDigest: _digest, ...content } = parsed
    if (parsed.deltaDigest !== digest(content)) throw new Error('Evidence delta digest does not match its immutable content.')
    const priorWatermark = this.head.committedWatermark
    const comparison = priorWatermark ? compareEvidenceDagWatermarks(parsed.committedWatermark, priorWatermark) : undefined
    if (comparison !== undefined && comparison < 0) throw new Error('Evidence delta chain contains a regressed committed watermark.')
    this.records.push(structuredClone(parsed))
  }

  private appendSidechainExisting(record: EvidenceDagSidechainRecordV1): void {
    const parsed = evidenceDagSidechainRecordV1Schema.parse(record)
    if (parsed.threadId !== this.threadId || parsed.sequence !== this.sidechains.length + 1) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence sidechain contains a missing or reordered record.')
    }
    if (!this.closuresByDigest.has(parsed.closureDigest)) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence sidechain references an unknown closure.')
    }
    if (this.sidechains.some((existing) =>
      existing.idempotencyKey === parsed.idempotencyKey || existing.recordId === parsed.recordId
    )) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence sidechain contains a duplicate identity.')
    }
    const { recordDigest: _digest, ...content } = parsed
    if (parsed.recordDigest !== digest(content)) {
      throw new EvidenceDagSealError('invalid_sidechain', 'Evidence sidechain digest does not match its immutable content.')
    }
    this.sidechains.push(structuredClone(parsed))
  }

  private materialize(
    input: EvidenceDagDeltaAppendInput,
    predecessorDigest: string | null,
    sequence: number,
    defaults: Readonly<{
      createdAt?: string
      committedWatermark?: string
    }> = {}
  ): EvidenceDagDelta {
    if (input.scope.threadId !== this.threadId) throw new Error('Evidence delta scope does not match its chain thread.')
    const value = {
      payloadDigest: digest(input.payload),
      predecessorDigest,
      sequence,
      scope: input.scope,
      requestedWatermark: input.requestedWatermark,
      committedWatermark: input.committedWatermark ?? defaults.committedWatermark ?? input.requestedWatermark,
      schemaVersion: input.schemaVersion,
      extractorVersion: input.extractorVersion,
      verifierVersion: input.verifierVersion,
      idempotencyKey: input.idempotencyKey,
      sourceRefs: uniqueSorted(input.sourceRefs ?? []),
      artifactRefs: uniqueSorted(input.artifactRefs ?? []),
      runRefs: uniqueSorted(input.runRefs ?? []),
      payload: structuredClone(input.payload),
      createdAt: input.createdAt ?? defaults.createdAt ?? new Date().toISOString()
    }
    return evidenceDagDeltaSchema.parse({ ...value, deltaDigest: digest(value) })
  }

  private materializeSidechain(
    input: EvidenceDagSidechainAppendInput,
    sequence: number,
    defaults: Readonly<{ createdAt?: string }> = {}
  ): EvidenceDagSidechainRecordV1 {
    const value = {
      threadId: input.threadId,
      sequence,
      recordId: input.recordId,
      recordType: input.recordType,
      closureDigest: input.closureDigest,
      idempotencyKey: input.idempotencyKey,
      payload: structuredClone(input.payload),
      producerIdentity: input.producerIdentity,
      reviewerIdentity: input.reviewerIdentity ?? null,
      createdAt: input.createdAt ?? defaults.createdAt ?? new Date().toISOString()
    }
    return evidenceDagSidechainRecordV1Schema.parse({
      ...value,
      recordDigest: digest(value)
    })
  }

  private ensureScopeIdentity(scope: EvidenceDagDelta['scope']): void {
    if (!this.scopeIdentity) {
      this.scopeIdentity = { runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot }
      return
    }
    if (this.scopeIdentity.runtimeId !== scope.runtimeId || this.scopeIdentity.workspaceRoot !== scope.workspaceRoot) {
      throw new Error('Evidence delta scope identity drifted across runtime or workspace.')
    }
  }

  private validateClosure(closure: EvidenceDagSealedClosure): void {
    const policy = canonicalizeClosurePolicy(evidenceDagClosurePolicyV1Schema.parse(closure.policy))
    if (closure.policyDigest !== digest(policy) || canonicalJson(closure.policy) !== canonicalJson(policy)) {
      throw new Error('Evidence closure policy does not match its immutable digest.')
    }
    if (policy.expectedHeadDigest !== closure.headDigest) {
      throw new Error('Evidence closure policy head does not match its sealed head.')
    }
    const declaredIdentity = {
      threadId: closure.threadId,
      headDigest: closure.headDigest,
      policyDigest: closure.policyDigest,
      status: closure.status,
      includedDeltaDigests: closure.includedDeltaDigests,
      includedExternalRefs: closure.includedExternalRefs,
      gapCodes: closure.gapCodes,
      ...(closure.includedLegacyRootDigests
        ? { includedLegacyRootDigests: closure.includedLegacyRootDigests }
        : {})
    }
    if (digest(declaredIdentity) !== closure.closureDigest) {
      throw new Error('Evidence closure digest does not match its immutable content.')
    }
    const expected = this.deriveClosure(policy, closure.headDigest)
    const expectedWithoutTimestamp = {
      threadId: this.threadId,
      ...expected
    }
    const actualWithoutTimestamp = {
      threadId: closure.threadId,
      closureDigest: closure.closureDigest,
      headDigest: closure.headDigest,
      policyDigest: closure.policyDigest,
      policy: closure.policy,
      status: closure.status,
      includedDeltaDigests: closure.includedDeltaDigests,
      includedExternalRefs: closure.includedExternalRefs,
      gapCodes: closure.gapCodes,
      ...(closure.includedLegacyRootDigests
        ? { includedLegacyRootDigests: closure.includedLegacyRootDigests }
        : {})
    }
    if (canonicalJson(expectedWithoutTimestamp) !== canonicalJson(actualWithoutTimestamp)) {
      throw new Error('Evidence closure membership does not match its declared policy.')
    }
    if (this.legacyRoot && closure.legacyRootStatus !== this.legacyRoot.status) {
      throw new Error('Evidence closure legacy checkpoint status does not match its root.')
    }
    if (!this.legacyRoot && closure.legacyRootStatus !== undefined && closure.legacyRootStatus !== null) {
      throw new Error('Evidence closure references a legacy checkpoint root that is not present.')
    }
  }

  private validateLegacyRoot(root: EvidenceDagLegacyCheckpointRoot): void {
    if (Buffer.from(root.snapshotBytesBase64, 'base64').toString('base64') !== root.snapshotBytesBase64) {
      throw new Error('Evidence legacy checkpoint root bytes are not canonical base64.')
    }
    const bytes = Buffer.from(root.snapshotBytesBase64, 'base64')
    if (digestBytes(bytes) !== root.snapshotBytesDigest) {
      throw new Error('Evidence legacy checkpoint root bytes digest does not match its bytes.')
    }
    if (root.snapshot.threadId !== this.threadId) {
      throw new Error('Evidence legacy checkpoint root scope does not match its chain thread.')
    }
    const expectedStatus = root.ancestry === 'proven' && root.gapCodes.length === 0
      ? 'legacy/complete'
      : 'legacy/incomplete'
    if (root.status !== expectedStatus) {
      throw new Error('Evidence legacy checkpoint root status does not match its ancestry and gaps.')
    }
  }
}

type EvidenceDeltaStoreFile = Readonly<{
  version: 1
  chains: readonly Readonly<{
    threadId: string
    records: readonly EvidenceDagDelta[]
    legacyRoot?: EvidenceDagLegacyCheckpointRoot | null
    committedSnapshot?: EvidenceDagCommittedSnapshot | null
    committedSnapshotClosureDigest?: string | null
    committedSnapshotClosures?: Readonly<Record<string, string>>
    provisional?: EvidenceDagProvisionalView | null
    closures?: readonly EvidenceDagSealedClosure[]
    sidechains?: readonly EvidenceDagSidechainRecordV1[]
    sealIdempotency?: Readonly<Record<string, string>>
  }>[]
}>

/** Durable boundary for all Evidence deltas and their owner-derived views. */
export class EvidenceDagDeltaStore {
  private readonly chains = new Map<string, EvidenceDeltaChain>()
  private loaded = false
  private mutationQueue: Promise<void> = Promise.resolve()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly storagePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    let raw: string
    try {
      raw = await readFile(this.storagePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return
      this.loaded = false
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.chains)) {
        throw new Error('Evidence delta store has an unsupported format.')
      }
      const loadedChains = new Map<string, EvidenceDeltaChain>()
      for (const entry of parsed.chains) {
        if (!isRecord(entry) || typeof entry.threadId !== 'string' || !Array.isArray(entry.records)) {
          throw new Error('Evidence delta store contains an invalid chain entry.')
        }
        if (loadedChains.has(entry.threadId)) {
          throw new Error(`Evidence delta store contains duplicate thread ${entry.threadId}.`)
        }
        loadedChains.set(entry.threadId, new EvidenceDeltaChain(entry.threadId, entry.records as EvidenceDagDelta[], {
          legacyRoot: entry.legacyRoot as EvidenceDagLegacyCheckpointRoot | null | undefined,
          committedSnapshot: entry.committedSnapshot as EvidenceDagCommittedSnapshot | null | undefined,
          committedSnapshotClosureDigest: typeof entry.committedSnapshotClosureDigest === 'string'
            ? entry.committedSnapshotClosureDigest : null,
          committedSnapshotClosures: entry.committedSnapshotClosures as Readonly<Record<string, string>> | undefined,
          provisional: entry.provisional as EvidenceDagProvisionalView | null | undefined,
          closures: entry.closures as EvidenceDagSealedClosure[] | undefined,
          sidechains: entry.sidechains as EvidenceDagSidechainRecordV1[] | undefined,
          sealIdempotency: entry.sealIdempotency as Readonly<Record<string, string>> | undefined
        }))
      }
      this.chains.clear()
      for (const [threadId, chain] of loadedChains) this.chains.set(threadId, chain)
    } catch (error) {
      this.chains.clear()
      this.loaded = false
      throw error
    }
  }

  async append(input: EvidenceDagDeltaAppendInput): Promise<EvidenceDagAppendResult> {
    return this.mutate(async () => {
      const chain = this.chains.get(input.scope.threadId) ?? new EvidenceDeltaChain(input.scope.threadId)
      const result = chain.append(input)
      if (!result.idempotent) {
        this.chains.set(input.scope.threadId, chain)
        await this.persist()
      }
      return result
    })
  }

  async appendCorrection(input: EvidenceDagCorrectionAppendInput): Promise<EvidenceDagAppendResult> {
    return this.mutate(async () => {
      const chain = this.chains.get(input.scope.threadId) ?? new EvidenceDeltaChain(input.scope.threadId)
      const result = chain.appendCorrection(input)
      if (!result.idempotent) {
        this.chains.set(input.scope.threadId, chain)
        await this.persist()
      }
      return result
    })
  }

  async appendAssessment(input: EvidenceDagAssessmentAppendInput): Promise<EvidenceDagAppendResult> {
    return this.mutate(async () => {
      const chain = this.chains.get(input.scope.threadId) ?? new EvidenceDeltaChain(input.scope.threadId)
      const result = chain.appendAssessment(input)
      if (!result.idempotent) {
        this.chains.set(input.scope.threadId, chain)
        await this.persist()
      }
      return result
    })
  }

  async appendSidechain(input: EvidenceDagSidechainAppendInput): Promise<EvidenceDagSidechainAppendResult> {
    return this.mutate(async () => {
      const chain = this.chains.get(input.threadId) ?? new EvidenceDeltaChain(input.threadId)
      const result = chain.appendSidechain(input)
      if (!result.idempotent) {
        this.chains.set(input.threadId, chain)
        await this.persist()
      }
      return result
    })
  }

  async importLegacyRoot(threadId: string, input: EvidenceDagLegacyRootInput): Promise<EvidenceDagLegacyCheckpointRoot> {
    return this.mutate(async () => {
      const chain = this.chains.get(threadId) ?? new EvidenceDeltaChain(threadId)
      const root = chain.importLegacyRoot(input)
      this.chains.set(threadId, chain)
      await this.persist()
      return root
    })
  }

  /**
   * Imports the latest pre-delta snapshot files once, preserving their exact
   * logical bytes inside the legacy root instead of treating them as deltas.
   */
  async importLegacySnapshots(storageDir: string): Promise<number> {
    return this.mutate(async () => {
      let entries: Array<{ name: string; isFile(): boolean }> = []
      try {
        entries = await readdir(storageDir, { withFileTypes: true })
      } catch (error) {
        if (isMissingFile(error)) return 0
        throw error
      }
      let imported = 0
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.prov.json')) continue
        const filePath = join(storageDir, entry.name)
        const bytes = await readLegacySnapshotBytes(filePath, storageDir)
        const document = JSON.parse(bytes.toString('utf8')) as unknown
        const meta = isRecord(document) ? document['edag:meta'] : undefined
        const snapshot = isRecord(meta) ? meta.snapshot : undefined
        const threadId = isRecord(snapshot) ? stringValue(snapshot.threadId) : undefined
        if (!threadId || this.chains.has(threadId)) continue
        const chain = new EvidenceDeltaChain(threadId)
        chain.importLegacyRoot({
          snapshot: snapshot as Readonly<Record<string, unknown>>,
          snapshotBytes: bytes,
          ancestry: 'unproven',
          gapCodes: ['lineage_incomplete']
        })
        this.chains.set(threadId, chain)
        imported += 1
      }
      if (imported) await this.persist()
      return imported
    })
  }

  async compileProvisional(threadId: string, input: EvidenceDagProvisionalCompileInput): Promise<EvidenceDagProvisionalView> {
    return this.mutate(async () => {
      const chain = this.chains.get(threadId) ?? new EvidenceDeltaChain(threadId)
      const view = chain.provisional(input)
      this.chains.set(threadId, chain)
      await this.persist()
      return view
    })
  }

  async reconcileProvisional(options: EvidenceDagProvisionalCompilerOptions): Promise<void> {
    return this.mutate(async () => {
      let changed = false
      for (const chain of this.chains.values()) {
        const head = chain.head
        const current = chain.provisionalView
        if (
          current &&
          current.desiredHeadDigest === head.headDigest &&
          current.appliedHeadDigest === head.headDigest &&
          current.compilerVersion === options.compilerVersion &&
          current.policyVersion === options.policyVersion &&
          current.summary.freshness === 'fresh' &&
          current.summary.failure === null
        ) continue
        chain.provisional({
          compilerVersion: options.compilerVersion,
          policyVersion: options.policyVersion,
          desiredHeadDigest: head.headDigest,
          now: options.now
        })
        changed = true
      }
      if (changed) await this.persist()
    })
  }

  async seal(threadId: string, policy: EvidenceDagClosurePolicyV1, idempotencyKey?: string): Promise<EvidenceDagSealedClosure> {
    return this.mutate(async () => {
      const chain = this.chains.get(threadId) ?? new EvidenceDeltaChain(threadId)
      const closure = chain.seal(policy, idempotencyKey)
      this.chains.set(threadId, chain)
      await this.persist()
      return closure
    })
  }

  async chain(threadId: string): Promise<EvidenceDeltaChain> {
    await this.load()
    const chain = this.chains.get(threadId)
    if (!chain) return new EvidenceDeltaChain(threadId)
    // Callers receive a read view. Mutations must go through this store so the
    // append/closure transaction and its durable file remain one owner path.
    return new EvidenceDeltaChain(threadId, chain.list(), {
      legacyRoot: chain.legacyCheckpointRoot,
      committedSnapshot: chain.committedEvidenceSnapshot,
      committedSnapshotClosureDigest: chain.committedSnapshotClosure,
      committedSnapshotClosures: Object.fromEntries(chain.committedSnapshotClosureEntries()),
      provisional: chain.provisionalView,
      closures: chain.closures(),
      sidechains: chain.sidechainRecords(),
      sealIdempotency: Object.fromEntries(chain.sealIdempotencyEntries())
    })
  }

  async head(threadId: string): Promise<EvidenceDagHead> {
    return (await this.chain(threadId)).head
  }

  async committedSnapshot(threadId: string): Promise<EvidenceDagCommittedSnapshot | null> {
    return (await this.chain(threadId)).committedEvidenceSnapshot
  }

  async recordCommittedSnapshot(
    threadId: string,
    snapshot: EvidenceDagCommittedSnapshot,
    closureDigest: string
  ): Promise<EvidenceDagCommittedSnapshot> {
    return this.mutate(async () => {
      const chain = this.chains.get(threadId) ?? new EvidenceDeltaChain(threadId)
      chain.setCommittedEvidenceSnapshot(snapshot, closureDigest)
      this.chains.set(threadId, chain)
      await this.persist()
      return chain.committedEvidenceSnapshot!
    })
  }

  async provisional(threadId: string): Promise<EvidenceDagProvisionalView | null> {
    return (await this.chain(threadId)).provisionalView
  }

  async closure(threadId: string, closureDigest: string): Promise<EvidenceDagSealedClosure | null> {
    return (await this.chain(threadId)).closures().find((item) => item.closureDigest === closureDigest) ?? null
  }

  async sidechains(threadId: string): Promise<readonly EvidenceDagSidechainRecordV1[]> {
    return (await this.chain(threadId)).sidechainRecords()
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(async () => {
      await this.load()
      const before = cloneChains(this.chains)
      try {
        return await operation()
      } catch (error) {
        // A failed atomic replacement must not leave a newer head, closure, or
        // provisional view visible in memory after the durable write failed.
        this.chains.clear()
        for (const [threadId, chain] of before) this.chains.set(threadId, chain)
        throw error
      }
    })
    this.mutationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private async persist(): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const document: EvidenceDeltaStoreFile = {
        version: 1,
        chains: [...this.chains.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([threadId, chain]) => ({
          threadId,
          records: chain.list(),
          ...(chain.legacyCheckpointRoot ? { legacyRoot: chain.legacyCheckpointRoot } : {}),
          ...(chain.committedEvidenceSnapshot ? { committedSnapshot: chain.committedEvidenceSnapshot } : {}),
          ...(chain.committedSnapshotClosure ? { committedSnapshotClosureDigest: chain.committedSnapshotClosure } : {}),
          ...(chain.committedSnapshotClosureEntries().length
            ? { committedSnapshotClosures: Object.fromEntries(chain.committedSnapshotClosureEntries()) }
            : {}),
          ...(chain.provisionalView ? { provisional: chain.provisionalView } : {}),
          ...(chain.closures().length ? { closures: chain.closures() } : {}),
          ...(chain.sealIdempotencyEntries().length
            ? { sealIdempotency: Object.fromEntries(chain.sealIdempotencyEntries()) }
            : {}),
          ...(chain.sidechainRecords().length ? { sidechains: chain.sidechainRecords() } : {})
        }))
      }
      const parent = dirname(this.storagePath)
      await mkdir(parent, { recursive: true })
      const temporary = `${this.storagePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
      try {
        await writeFile(temporary, `${JSON.stringify(document)}\n`, { encoding: 'utf8', mode: 0o600 })
        await chmod(temporary, 0o600)
        await rename(temporary, this.storagePath)
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
      }
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
  }
}

function cloneChains(
  chains: ReadonlyMap<string, EvidenceDeltaChain>
): Map<string, EvidenceDeltaChain> {
  return new Map([...chains.entries()].map(([threadId, chain]) => [
    threadId,
    new EvidenceDeltaChain(threadId, chain.list(), {
      legacyRoot: chain.legacyCheckpointRoot,
      committedSnapshot: chain.committedEvidenceSnapshot,
      committedSnapshotClosureDigest: chain.committedSnapshotClosure,
      committedSnapshotClosures: Object.fromEntries(chain.committedSnapshotClosureEntries()),
      provisional: chain.provisionalView,
      closures: chain.closures(),
      sidechains: chain.sidechainRecords(),
      sealIdempotency: Object.fromEntries(chain.sealIdempotencyEntries())
    })
  ]))
}

/** Prevents a Claim-producing invocation from verifying itself. */
export function evaluateEvidenceDagIndependence(input: Readonly<{
  producerInvocationId: string
  reviewerInvocationId?: string | null
  producerPromptDigest?: string | null
  reviewerPromptDigest?: string | null
  producerContextDigest?: string | null
  reviewerContextDigest?: string | null
  predicate: 'distinct_invocation' | 'distinct_context' | 'deterministic_tool' | 'none'
}>): 'independent' | 'not_independent' | 'not_independently_assessed' {
  if (!input.reviewerInvocationId) return 'not_independently_assessed'
  if (input.reviewerInvocationId === input.producerInvocationId) return 'not_independent'
  if (sameNonNull(input.producerPromptDigest, input.reviewerPromptDigest) || sameNonNull(input.producerContextDigest, input.reviewerContextDigest)) {
    return 'not_independent'
  }
  if (input.predicate === 'none') return 'not_independently_assessed'
  if (input.predicate === 'distinct_context' && (!input.producerContextDigest || !input.reviewerContextDigest)) {
    return 'not_independently_assessed'
  }
  return 'independent'
}

export function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export function digestBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

/** Creates the common delta envelope for all Evidence producer consumers. */
export function evidenceDagDeltaInputFromTrace(input: EvidenceDagTraceAppendInput): EvidenceDagDeltaAppendInput {
  const refs = collectTraceReferences(input.trace)
  if (input.kind === 'execution') refs.runRefs.add(input.operationId)
  return {
    scope: {
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      operationId: input.operationId,
      kind: input.kind,
      workspaceRoot: input.workspaceRoot
    },
    requestedWatermark: input.requestedWatermark,
    committedWatermark: input.requestedWatermark,
    schemaVersion: 'evidence.delta.v1',
    extractorVersion: 'extractor.v3',
    verifierVersion: 'verifier.v3',
    idempotencyKey: input.idempotencyKey,
    sourceRefs: uniqueSorted([...refs.sourceRefs]),
    artifactRefs: uniqueSorted([...refs.artifactRefs]),
    runRefs: uniqueSorted([...refs.runRefs]),
    payload: {
      eventKind: input.eventKind ?? input.kind,
      operationId: input.operationId,
      targetWatermark: input.requestedWatermark,
      trace: input.trace.map((item) => structuredClone(item))
    },
    createdAt: input.createdAt
  }
}

type ClosureTraversal = Readonly<{ deltaDigests: Set<string>; reachedIds: Set<string> }>

function traverseClosure(records: readonly EvidenceDagDelta[], policy: EvidenceDagClosurePolicyV1, gaps: EvidenceDagSealedClosure['gapCodes'][number][]): ClosureTraversal {
  const reachedIds = new Set(policy.targetClaimIds)
  const depths = new Map(policy.targetClaimIds.map((id) => [id, 0]))
  const queue = [...policy.targetClaimIds]
  const deltaDigests = new Set<string>()
  const edges = records.flatMap((record) => extractEdges(record.payload).map((edge) => ({ edge, record })))
  const knownFamilies = new Set(policy.edgeFamilies)
  const acyclicEdges = new Map<string, Map<string, Set<string>>>()
  const unknownEdgesSeen = new Set<string>()
  const checkUnknownEdges = (): void => {
    for (const item of edges) {
      const edgeKey = `${item.record.deltaDigest}:${item.edge.source}:${item.edge.target}:${item.edge.family}`
      if (knownFamilies.has(item.edge.family) || unknownEdgesSeen.has(edgeKey) || !touches(item.record, reachedIds)) continue
      unknownEdgesSeen.add(edgeKey)
      handlePolicy(policy.unknownEdgeHandling, gaps, 'unsupported_edge_family', 'unknown_edge')
      for (const semanticGap of semanticGapsFor(item.record.payload)) addGap(gaps, semanticGap)
    }
  }
  checkUnknownEdges()
  while (queue.length) {
    const node = queue.shift()!
    const depth = depths.get(node) ?? 0
    if (depth >= policy.maxDepth) continue
    for (const item of edges) {
      const { edge, record } = item
      if (!knownFamilies.has(edge.family)) continue
      if (edge.family === 'equivalent' && !policy.expandEquivalent) continue
      if (edge.family === 'refinement' && !policy.expandRefinement) continue
      const neighbors: string[] = []
      if (policy.directions.includes('outbound') && edge.source === node) neighbors.push(edge.target)
      if (policy.directions.includes('inbound') && edge.target === node) neighbors.push(edge.source)
      if (!neighbors.length) continue
      deltaDigests.add(record.deltaDigest)
      for (const id of collectRecordIds(record)) reachedIds.add(id)
      if (isAcyclicClosureFamily(edge.family)) {
        const adjacency = acyclicEdges.get(edge.family) ?? new Map<string, Set<string>>()
        const targets = adjacency.get(edge.source) ?? new Set<string>()
        targets.add(edge.target)
        adjacency.set(edge.source, targets)
        // Cycle semantics follow the declared derivation direction, not the
        // direction used to traverse an inbound closure.
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set<string>())
        acyclicEdges.set(edge.family, adjacency)
      }
      for (const neighbor of neighbors) {
        const priorDepth = depths.get(neighbor)
        if (priorDepth !== undefined) {
          continue
        }
        reachedIds.add(neighbor)
        depths.set(neighbor, depth + 1)
        queue.push(neighbor)
      }
    }
    checkUnknownEdges()
    if (policy.termination === 'required_records' && policy.requiredRecords.every((id) => reachedIds.has(id))) break
  }
  checkUnknownEdges()
  if (policy.cycleHandling !== 'allow') {
    for (const adjacency of acyclicEdges.values()) {
      if (hasDirectedCycle(adjacency)) {
        handlePolicy(
          policy.cycleHandling === 'fail' ? 'fail' : 'record_gap',
          gaps,
          'lineage_incomplete',
          'cycle_detected'
        )
      }
    }
  }
  for (const record of records) {
    if (!touches(record, reachedIds)) continue
    deltaDigests.add(record.deltaDigest)
    for (const id of collectRecordIds(record)) reachedIds.add(id)
  }
  for (const target of policy.targetClaimIds) {
    if (!records.some((record) => collectRecordIds(record).has(target))) addGap(gaps, 'missing_delta')
  }
  // Pull records transitively through shared source/artifact/run ancestry.
  // Shared upstream records are part of the audit boundary even when their
  // risk marker is expressed outside the edge payload. Records are visited
  // in persisted sequence order; the final closure digest sorts the set for
  // order-independent identity.
  let changed = true
  while (changed) {
    changed = false
    const reachedRefs = new Set(records.filter((record) => deltaDigests.has(record.deltaDigest)).flatMap((record) => [
      ...record.sourceRefs, ...record.artifactRefs, ...record.runRefs
    ]))
    for (const record of records) {
      const semanticGaps = semanticGapsFor(record.payload)
      if (deltaDigests.has(record.deltaDigest)) {
        for (const semanticGap of semanticGaps) addGap(gaps, semanticGap)
        continue
      }
      const recordRefs = [...new Set([
        ...record.sourceRefs,
        ...record.artifactRefs,
        ...record.runRefs
      ])]
      const sharesRef = recordRefs.some((ref) => reachedRefs.has(ref))
      if (!sharesRef) continue
      deltaDigests.add(record.deltaDigest)
      changed = true
      for (const id of collectRecordIds(record)) reachedIds.add(id)
      for (const semanticGap of semanticGaps) addGap(gaps, semanticGap)
    }
  }
  for (const required of policy.requiredRecords) {
    if (!reachedIds.has(required)) addGap(gaps, 'lineage_incomplete')
  }
  return { deltaDigests, reachedIds }
}

/** Families that describe executable/derivation order must remain acyclic. */
function isAcyclicClosureFamily(family: string): boolean {
  return new Set([
    'provenance',
    'derivation',
    'derived_from',
    'generated_by',
    'generation',
    'generated-by',
    'refinement',
    'refines',
    'prerequisite',
    'used',
    'was_derived_from',
    'was_generated_by'
  ]).has(family)
}

function hasDirectedCycle(adjacency: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const color = new Map<string, 0 | 1 | 2>()
  for (const start of adjacency.keys()) {
    if ((color.get(start) ?? 0) !== 0) continue
    const stack: Array<Readonly<{ node: string; exit: boolean }>> = [{ node: start, exit: false }]
    while (stack.length) {
      const frame = stack.pop()!
      if (frame.exit) {
        color.set(frame.node, 2)
        continue
      }
      if ((color.get(frame.node) ?? 0) === 2) continue
      color.set(frame.node, 1)
      stack.push({ node: frame.node, exit: true })
      for (const neighbor of adjacency.get(frame.node) ?? []) {
        const neighborColor = color.get(neighbor) ?? 0
        if (neighborColor === 1) return true
        if (neighborColor === 0) stack.push({ node: neighbor, exit: false })
      }
    }
  }
  return false
}

function canonicalizeClosurePolicy(policy: EvidenceDagClosurePolicyV1): EvidenceDagClosurePolicyV1 {
  return {
    ...policy,
    targetClaimIds: uniqueSorted(policy.targetClaimIds),
    edgeFamilies: uniqueSorted(policy.edgeFamilies),
    directions: uniqueSorted(policy.directions) as EvidenceDagClosurePolicyV1['directions'],
    requiredRecords: uniqueSorted(policy.requiredRecords),
    requiredExternalRefs: uniqueSorted(policy.requiredExternalRefs)
  }
}

function extractEdges(value: unknown): Array<Readonly<{ source: string; target: string; family: string }>> {
  const found: Array<Readonly<{ source: string; target: string; family: string }>> = []
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    if (!isRecord(candidate)) return
    const source = stringValue(candidate.source ?? candidate.src ?? candidate.from)
    const target = stringValue(candidate.target ?? candidate.dst ?? candidate.to)
    const family = stringValue(candidate.family ?? candidate.edgeFamily ?? candidate.rel ?? candidate.type)
    if (source && target && family) found.push({ source, target, family })
    for (const child of Object.values(candidate)) visit(child)
  }
  visit(value)
  return found
}

function collectRecordIds(record: EvidenceDagDelta): Set<string> {
  // External refs are reachability inputs, not record identities. Keeping
  // them out of this set prevents a required record from being satisfied by a
  // coincidentally equal source/artifact/run ref without a semantic node.
  return new Set([
    ...collectSemanticIds(record.payload),
    ...extractEdges(record.payload).flatMap((edge) => [edge.source, edge.target])
  ])
}

function collectSemanticIds(value: unknown, key?: string): string[] {
  if (typeof value === 'string') {
    return !key || /^(id|recordId|claimId|assessmentId|targetId|targetRecordId|correctionId|findingId|reviewId|decisionId|sourceId|source_id|sourceAnchorId|source_anchor_id|anchorId|anchor_id|artifactVersionId|artifact_version_id|runId|run_id|nodeId|target|source|src|dst|from|to)$/u.test(key)
      ? [value]
      : []
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectSemanticIds(item, key))
  if (isRecord(value)) return Object.entries(value).flatMap(([childKey, child]) => collectSemanticIds(child, childKey))
  return []
}

function collectDeclaredRefs(value: unknown): string[] {
  if (!isRecord(value)) return []
  return collectByKey(
    value,
    /^(sourceId|source_id|sourceRef|source_ref|sourceIds|source_ids|source_refs|sourceAnchorId|source_anchor_id|sourceAnchorIds|source_anchor_ids|anchorId|anchor_id|anchorIds|anchor_ids|artifactRef|artifact_ref|artifactRefs|artifact_refs|artifactVersionId|artifact_version_id|artifactVersionIds|artifact_version_ids|versionId|version_id|runId|run_id|runRef|run_ref|runIds|run_ids|runRefs|run_refs)$/u
  )
}

function collectByKey(value: unknown, pattern: RegExp, key?: string): string[] {
  if (typeof value === 'string') return key && pattern.test(key) ? [value] : []
  if (Array.isArray(value)) return value.flatMap((item) => collectByKey(item, pattern, key))
  if (isRecord(value)) return Object.entries(value).flatMap(([childKey, child]) => collectByKey(child, pattern, childKey))
  return []
}

function collectTraceReferences(trace: readonly Readonly<Record<string, unknown>>[]): { sourceRefs: Set<string>; artifactRefs: Set<string>; runRefs: Set<string> } {
  const result = { sourceRefs: new Set<string>(), artifactRefs: new Set<string>(), runRefs: new Set<string>() }
  const visit = (value: unknown, key?: string): void => {
    if (isRecord(value) && isRecord(value.evidenceLineage)) {
      const lineage = value.evidenceLineage
      const activity = isRecord(lineage.activity) ? stringValue(lineage.activity.id) : undefined
      if (activity) result.runRefs.add(activity)
      const inputs = Array.isArray(lineage.inputs) ? lineage.inputs : []
      for (const input of inputs) {
        if (isRecord(input)) {
          const id = stringValue(input.id)
          if (id) result.sourceRefs.add(id)
        }
      }
    }
    if (typeof value === 'string') {
      if (key && /^(sourceId|source_id|sourceRef|source_ref)$/u.test(key)) result.sourceRefs.add(value)
      if (key && /^(versionId|version_id|artifactVersionId|artifact_version_id)$/u.test(key)) result.artifactRefs.add(value)
      if (key && /^(runId|run_id)$/u.test(key)) result.runRefs.add(value)
      return
    }
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key))
    if (isRecord(value)) Object.entries(value).forEach(([childKey, child]) => visit(child, childKey))
  }
  trace.forEach((item) => visit(item))
  return result
}

function validateAssessmentIndependence(assessment: Readonly<Record<string, unknown>>): void {
  const candidate = assessment.independenceMetadata ?? assessment.independence
  if (candidate === undefined) {
    throw new Error('Evidence semantic assessment requires explicit independence metadata.')
  }
  const metadata = evidenceDagIndependenceMetadataV1Schema.parse(candidate)
  const result = evaluateEvidenceDagIndependence(metadata)
  if (result !== metadata.result) {
    throw new Error(`Evidence assessment independence result ${metadata.result} contradicts its declared producer/reviewer context (${result}).`)
  }
  if (metadata.result === 'independent' && metadata.reviewerIdentity === null) {
    throw new Error('Evidence independently assessed metadata requires a reviewer identity.')
  }
}

function deriveProvisionalModel(
  records: readonly EvidenceDagDelta[],
  headDigest: string | null,
  legacyRoot: EvidenceDagLegacyCheckpointRoot | null
): Readonly<{ model: Record<string, unknown>; coverage: { complete: boolean; gapCount: number }; materialRiskCount: number }> | null {
  if (!headDigest) return null
  if (legacyRoot?.snapshot.digest === headDigest) {
    return {
      model: {
        headDigest,
        legacyRootDigest: legacyRoot.snapshotBytesDigest,
        legacyRootStatus: legacyRoot.status
      },
      coverage: {
        complete: legacyRoot.status === 'legacy/complete',
        gapCount: legacyRoot.gapCodes.length
      },
      materialRiskCount: 0
    }
  }
  const end = sequenceAt(records, headDigest)
  if (end < 0) return null
  const selected = records.filter((record) => record.sequence <= end)
  const claims = selected.flatMap((record) => collectArrayValues(record.payload, 'claims'))
  const gaps = uniqueSorted(selected.flatMap((record) => collectStringArray(record.payload, 'gapCodes')))
  return {
    model: { headDigest, claims, recordCount: selected.length, gapCodes: gaps },
    coverage: { complete: gaps.length === 0, gapCount: gaps.length },
    materialRiskCount: selected.reduce<number>((count, record) => count + countRiskMarkers(record.payload), 0)
  }
}

function collectArrayValues(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectArrayValues(item, key))
  if (isRecord(value)) return Object.entries(value).flatMap(([childKey, child]) => childKey === key && Array.isArray(child) ? child : collectArrayValues(child, key))
  return []
}

function collectStringArray(value: unknown, key: string): string[] {
  return collectArrayValues(value, key).filter((item): item is string => typeof item === 'string')
}

function countRiskMarkers(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((count, item) => count + countRiskMarkers(item), 0)
  if (!isRecord(value)) return 0
  const own = [value.materialRisk, value.material_risk, value.riskLevel, value.risk].some((item) => item === true || item === 'material' || item === 'critical') ? 1 : 0
  return own + Object.values(value).reduce<number>((count, item) => count + countRiskMarkers(item), 0)
}

function semanticGapsFor(value: unknown): EvidenceDagSealedClosure['gapCodes'] {
  const text = canonicalJson(value).toLowerCase()
  const gaps: EvidenceDagSealedClosure['gapCodes'][number][] = []
  const declared = collectStringArray(value, 'gapCodes')
  const known = new Set<EvidenceDagSealedClosure['gapCodes'][number]>([
    'missing_delta',
    'unsupported_edge_family',
    'access_restricted',
    'source_unavailable',
    'lineage_incomplete',
    'independence_unknown',
    'contradiction_unresolved',
    'negative_result_missing',
    'failed_replication_missing',
    'shared_ancestry_unknown'
  ])
  for (const code of declared) {
    const normalized = code as EvidenceDagSealedClosure['gapCodes'][number]
    if (known.has(normalized)) gaps.push(normalized)
  }
  if (text.includes('contradict')) gaps.push('contradiction_unresolved')
  if (text.includes('negative')) gaps.push('negative_result_missing')
  if (text.includes('fail') && text.includes('replicat')) gaps.push('failed_replication_missing')
  if (text.includes('shared') && text.includes('ances')) gaps.push('shared_ancestry_unknown')
  if (text.includes('access') && text.includes('breakpoint')) gaps.push('access_restricted')
  // `independent` is a valid result, so do not infer an unknown gap from a
  // substring match. Only explicit unknown/unassessed assessment metadata is
  // a closure gap; contradictory metadata is rejected on append.
  for (const metadata of collectIndependenceMetadata(value)) {
    if (metadata.result === 'not_independently_assessed') gaps.push('independence_unknown')
  }
  return uniqueSortedGapCodes(gaps)
}

function collectIndependenceMetadata(value: unknown): Array<Readonly<{ result: string }>> {
  const found: Array<Readonly<{ result: string }>> = []
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    if (!isRecord(candidate)) return
    const metadata = candidate.independenceMetadata ?? candidate.independence
    if (typeof metadata === 'string') {
      found.push({ result: metadata })
    } else if (isRecord(metadata) && typeof metadata.result === 'string') {
      found.push({ result: metadata.result })
    }
    for (const [key, child] of Object.entries(candidate)) {
      if (/^independence(?:Status|Result)?$/u.test(key) && typeof child === 'string') {
        found.push({ result: child })
      }
      visit(child)
    }
  }
  visit(value)
  return found
}

function sidechainRequiresCommittedSnapshot(input: EvidenceDagSidechainAppendInput): boolean {
  if (input.recordType === 'approval') return true
  const certifiedMarkers = new Set(['certified', 'public', 'public_external', 'certified_internal'])
  const visit = (value: unknown, key?: string): boolean => {
    if (typeof value === 'string') {
      return Boolean(key && /^(classification|certificationStatus|requestedStatus|actionClass|status)$/u.test(key) && certifiedMarkers.has(value.toLowerCase()))
    }
    if (Array.isArray(value)) return value.some((item) => visit(item, key))
    if (!isRecord(value)) return false
    return Object.entries(value).some(([childKey, child]) => visit(child, childKey))
  }
  return visit(input.payload)
}

function handlePolicy(handling: 'ignore' | 'record_gap' | 'fail', gaps: EvidenceDagSealedClosure['gapCodes'][number][], gapCode: EvidenceDagSealedClosure['gapCodes'][number], errorCode: EvidenceDagSealErrorCode): void {
  if (handling === 'ignore') return
  if (handling === 'fail') throw new EvidenceDagSealError(errorCode, `Evidence closure encountered ${errorCode}.`)
  addGap(gaps, gapCode)
}

function touches(record: EvidenceDagDelta, ids: ReadonlySet<string>): boolean {
  return [...collectRecordIds(record)].some((id) => ids.has(id))
}

function addGap(gaps: EvidenceDagSealedClosure['gapCodes'][number][], code: EvidenceDagSealedClosure['gapCodes'][number]): void {
  if (!gaps.includes(code)) gaps.push(code)
}

function normalizeLegacySnapshot(value: Readonly<Record<string, unknown>>, threadId: string) {
  const { status: _status, ...raw } = value
  if (raw.threadId !== undefined && raw.threadId !== threadId) {
    throw new EvidenceDagSealError('invalid_legacy_root', 'Evidence legacy checkpoint root scope does not match its chain thread.')
  }
  const artifactDigests = Array.isArray(raw.artifactDigests)
      ? raw.artifactDigests.map((item) => typeof item === 'string' && !item.startsWith('sha256:')
      ? `sha256:${item}`
      : item)
    : raw.artifactDigests
  // Legacy snapshot files may contain read-model fields such as humanReview.
  // Keep only the immutable public identity in the new root while preserving
  // the original file bytes separately in snapshotBytesBase64.
  const parsed = evidenceDagCommittedSnapshotSchema.safeParse({
    threadId,
    version: raw.version,
    digest: raw.digest,
    inputWatermark: raw.inputWatermark,
    schemaVersion: raw.schemaVersion,
    extractorVersion: raw.extractorVersion,
    verifierVersion: raw.verifierVersion,
    artifactDigests,
    createdAt: raw.createdAt,
    ...(typeof raw.url === 'string' ? { url: raw.url } : {})
  })
  if (!parsed.success) throw new EvidenceDagSealError('invalid_legacy_root', 'Legacy checkpoint root is missing immutable identity.')
  return parsed.data
}

async function readLegacySnapshotBytes(path: string, storageDir: string): Promise<Buffer> {
  const raw = await readFile(path)
  let manifest: unknown
  try {
    manifest = JSON.parse(raw.toString('utf8'))
  } catch {
    return raw
  }
  if (!isRecord(manifest) || manifest.format !== 'sciforge.evidence-snapshot.chunked.v1') {
    return raw
  }
  if (manifest.encoding !== 'utf-8' || !Array.isArray(manifest.chunks)) {
    throw new Error(`Legacy Evidence Snapshot manifest ${path} is invalid.`)
  }
  const output: Buffer[] = []
  for (const item of manifest.chunks) {
    if (!isRecord(item) || typeof item.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(item.sha256) ||
        !Number.isInteger(item.size) || Number(item.size) < 0) {
      throw new Error(`Legacy Evidence Snapshot manifest ${path} has an invalid chunk.`)
    }
    const chunk = await readFile(join(storageDir, 'snapshot-blobs', 'v1', 'sha256', item.sha256.slice(0, 2), item.sha256))
    if (chunk.byteLength !== Number(item.size) ||
        createHash('sha256').update(chunk).digest('hex') !== item.sha256) {
      throw new Error(`Legacy Evidence Snapshot manifest ${path} has a corrupt chunk.`)
    }
    output.push(chunk)
  }
  const bytes = Buffer.concat(output)
  if (Number.isInteger(manifest.size) && Number(manifest.size) !== bytes.byteLength) {
    throw new Error(`Legacy Evidence Snapshot manifest ${path} has an invalid size.`)
  }
  if (typeof manifest.sha256 === 'string' && manifest.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
    throw new Error(`Legacy Evidence Snapshot manifest ${path} has an invalid digest.`)
  }
  return bytes
}

function sequenceAt(records: readonly EvidenceDagDelta[], digestValue: string | null): number {
  if (digestValue === null) return 0
  return records.find((record) => record.deltaDigest === digestValue)?.sequence ?? -1
}

function deltaIdentity(delta: EvidenceDagDelta): Omit<EvidenceDagDelta, 'deltaDigest'> {
  const { deltaDigest: _digest, ...identity } = delta
  return identity
}

function watermarkAtOrBefore(value: string, barrier: string): boolean {
  const comparison = compareEvidenceDagWatermarks(value, barrier)
  return comparison !== undefined && comparison <= 0
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function uniqueSortedGapCodes(values: readonly EvidenceDagSealedClosure['gapCodes'][number][]): EvidenceDagSealedClosure['gapCodes'] {
  return uniqueSorted(values) as EvidenceDagSealedClosure['gapCodes']
}

function sameNonNull(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left === right)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
