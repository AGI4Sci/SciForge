import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {
  artifactVersionRefV1Schema,
  type ArtifactVersionCommitReceiptV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  researchCheckpointCommittedTurnStatusV1Schema,
  researchCheckpointManifestV1Schema,
  researchCheckpointRecordV1Schema,
  researchCheckpointTurnStatusV1Schema,
  researchRecordingStatusV1Schema,
  type ResearchCheckpointCommittedTurnStatusV1,
  type ResearchCheckpointListV1,
  type ResearchCheckpointManifestV1,
  type ResearchCheckpointRecordV1,
  type ResearchCheckpointResolveInputV1,
  type ResearchCheckpointStartInputV1,
  type ResearchCheckpointStartReceiptV1,
  type ResearchCheckpointStopInputV1,
  type ResearchCheckpointStopReceiptV1,
  type ResearchCheckpointStatusV1,
  type ResearchCheckpointTurnStatusV1,
  type ResearchRecordingStatusV1
} from '../contract.js'
import { writeJsonAtomic } from './atomic-store.js'
import {
  canonicalJson,
  idempotencyKey,
  operationId,
  outputArtifactId,
  outputVersionId,
  sha256,
  workspaceBindingDigest
} from './crypto.js'
import {
  sanitizeResearchCheckpointManifest,
  sanitizeResearchCheckpointText,
  type CheckpointFilePlan,
  type ExtractedCheckpoint,
  type ResearchCheckpointTextSanitizer
} from './extract.js'

const DEFAULT_MAX_STORE_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_AUTOMATIC_POLICY_RECEIPTS_PER_SCOPE = 32
const DEFAULT_MAX_AUTOMATIC_POLICY_RECEIPTS = 1_024

const filePlanSchema = z.object({
  path: z.string().trim().min(1).max(8_192),
  role: z.enum(['input', 'output', 'generated', 'modified']),
  declaredDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  mediaType: z.string().trim().min(1).max(256).optional(),
  artifactId: z.string().startsWith('artifact:').optional(),
  expectedCurrentVersionId: z.string().startsWith('artifact-version:').nullable(),
  expectedCurrentOrdinal: z.number().int().nonnegative().optional(),
  accessPolicy: artifactVersionRefV1Schema.shape.accessPolicy.optional(),
  preTurnBindingCaptured: z.boolean().optional(),
  expectedCurrentRef: artifactVersionRefV1Schema.optional(),
  /** Exact local predecessor bytes when the parent Version is pending in this producer journal. */
  expectedCurrentDataBase64: z.string().max(Math.ceil((4 * 1024 * 1024) / 3) * 4 + 4).optional(),
  patchReceipts: z.array(z.object({
    contractVersion: z.literal(1),
    kind: z.literal('host-authenticated-file-patch'),
    issuer: z.literal('sciforge.agent-runtime-host'),
    source: z.literal('codex-app-server-file-change'),
    callId: z.string().trim().min(1).max(512),
    executorSequence: z.number().int().positive(),
    path: z.string().trim().min(1).max(8_192),
    operation: z.enum(['add', 'update', 'delete']),
    patchFormat: z.enum(['full-content', 'unified-hunks']),
    patchText: z.string().max(4 * 1024 * 1024),
    patchDigest: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()).max(1_024).optional(),
  terminalEffect: z.object({
    kind: z.enum(['created', 'modified', 'deleted']),
    byteLength: z.number().int().nonnegative().max(4 * 1024 * 1024),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    mediaType: z.string().trim().min(1).max(256).optional()
  }).strict().optional(),
  terminalSnapshot: z.object({
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative().max(4 * 1024 * 1024),
    mediaType: z.string().trim().min(1).max(256).optional(),
    dataBase64: z.string().max(Math.ceil((4 * 1024 * 1024) / 3) * 4 + 4).optional()
  }).strict().optional()
}).strict()

const privateRecordingSchema = researchRecordingStatusV1Schema.extend({
  workspaceRoot: z.string().trim().min(1).max(16_384),
  startIdempotencyReceipts: z.array(z.object({
    idempotencyKey: z.string().trim().min(8).max(512),
    title: z.string().trim().min(1).max(512),
    changeReason: z.string().trim().min(1).max(2_000).optional()
  }).strict()).max(1),
  initialChangeReason: z.string().trim().min(1).max(2_000).optional(),
  startWatermark: z.string().trim().min(1).max(1_024).optional(),
  startKnownTurnIds: z.array(z.string().trim().min(1).max(512)).max(100_000).optional(),
  stopWatermark: z.string().trim().min(1).max(1_024).optional(),
  stopKnownTurnIds: z.array(z.string().trim().min(1).max(512)).max(100_000).optional(),
  fileBindings: z.array(z.object({
    path: z.string().trim().min(1).max(8_192),
    artifactId: z.string().startsWith('artifact:'),
    currentVersionId: z.string().startsWith('artifact-version:'),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()).max(100_000)
}).strict()

const workspaceFileBindingSchema = z.object({
  path: z.string().trim().min(1).max(8_192),
  ref: artifactVersionRefV1Schema,
  currentOrdinal: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true })
}).strict()

const turnBoundaryOutputBindingSchema = workspaceFileBindingSchema.extend({
  predecessorOperationId: z.string().regex(/^research-checkpoint-operation:[a-f0-9]{64}$/).optional(),
  dataBase64: z.string().max(Math.ceil((4 * 1024 * 1024) / 3) * 4 + 4).optional()
}).strict().superRefine((value, context) => {
  if ((value.predecessorOperationId !== undefined) !== (value.dataBase64 !== undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'A pending predecessor binding requires both its operation identity and exact bytes.'
    })
  }
  if (value.dataBase64 !== undefined) {
    const bytes = Buffer.from(value.dataBase64, 'base64')
    if (bytes.byteLength !== value.ref.byteLength || sha256(bytes) !== value.ref.contentDigest) {
      context.addIssue({ code: 'custom', message: 'Pending predecessor bytes do not match their exact reference.' })
    }
  }
})

const preTurnOutputBindingSnapshotSchema = z.object({
  issuerEpoch: z.string().trim().min(1).max(256),
  deliveryAttemptOrdinal: z.number().int().positive(),
  leaseId: z.string().trim().min(1).max(1_024),
  deliveryAttemptId: z.string().trim().min(1).max(1_024),
  clientDirectiveId: z.string().trim().min(1).max(512),
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512),
  workspaceRoot: z.string().trim().min(1).max(16_384),
  recordingId: z.string().startsWith('research-recording:').optional(),
  state: z.enum(['open', 'consumed', 'released', 'skipped']),
  capturedAt: z.iso.datetime({ offset: true }),
  settledAt: z.iso.datetime({ offset: true }).optional(),
  turnId: z.string().trim().min(1).max(512).optional(),
  bindings: z.array(turnBoundaryOutputBindingSchema).max(100_000)
}).strict().superRefine((value, context) => {
  if (value.state === 'skipped') {
    if (value.recordingId !== undefined || value.bindings.length > 0) {
      context.addIssue({ code: 'custom', message: 'A skipped boundary decision cannot bind research state.' })
    }
    return
  }
  if (!value.recordingId) {
    context.addIssue({ code: 'custom', message: 'A research boundary lease requires its bound recording.' })
  }
})

const automaticRecordingPolicySchema = z.object({
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512),
  automaticEnabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true })
}).strict()

const automaticPolicyReceiptBaseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512),
  expectedPolicyRevision: z.number().int().nonnegative(),
  policyRevision: z.number().int().positive(),
  operationOrdinal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime({ offset: true })
})

const automaticPolicyReceiptSchema = z.discriminatedUnion('action', [
  automaticPolicyReceiptBaseSchema.extend({
    action: z.literal('start'),
    title: z.string().trim().min(1).max(512),
    changeReason: z.string().trim().min(1).max(2_000).optional(),
    created: z.boolean(),
    recordingId: z.string().startsWith('research-recording:')
  }).strict(),
  automaticPolicyReceiptBaseSchema.extend({
    action: z.literal('stop'),
    requestedRecordingId: z.string().startsWith('research-recording:').optional(),
    recordingId: z.string().startsWith('research-recording:').optional()
  }).strict()
])

const retiredOrdinalRangeSchema = z.object({
  first: z.number().int().positive(),
  last: z.number().int().positive()
}).strict().refine((value) => value.first <= value.last, 'Retired ordinal range is reversed.')

const turnBoundaryRetirementSchema = z.object({
  issuerEpoch: z.string().trim().min(1).max(256),
  nextDeliveryAttemptOrdinal: z.number().int().positive(),
  retiredThroughOrdinal: z.number().int().nonnegative(),
  retiredOrdinalRanges: z.array(retiredOrdinalRangeSchema).max(100_000)
}).strict()

const committedOutputReceiptSchema = z.object({
  path: z.string().trim().min(1).max(8_192),
  artifactOrdinal: z.number().int().positive(),
  ref: artifactVersionRefV1Schema
}).strict()

const resolutionReceiptSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  resolution: z.enum(['rebase', 'discard']),
  resolvedAt: z.iso.datetime({ offset: true }),
  rebasedCurrentVersionId: z.string().startsWith('artifact-version:').optional()
}).strict()

const operationSchema = z.object({
  operationId: z.string().regex(/^research-checkpoint-operation:[a-f0-9]{64}$/),
  workspaceRoot: z.string().trim().min(1).max(16_384),
  recordingId: z.string().startsWith('research-recording:'),
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512),
  turnId: z.string().trim().min(1).max(512),
  issuerEpoch: z.string().trim().min(1).max(256).optional(),
  deliveryAttemptOrdinal: z.number().int().positive().optional(),
  boundaryLeaseId: z.string().trim().min(1).max(1_024).optional(),
  deliveryAttemptId: z.string().trim().min(1).max(1_024).optional(),
  targetWatermark: z.string().trim().min(1).max(1_024),
  state: z.enum(['pending', 'committed', 'stale-conflict', 'failed']),
  manifest: researchCheckpointManifestV1Schema,
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  manifestStorage: z.enum(['full', 'summary']).default('full'),
  filePlans: z.array(filePlanSchema).max(10_000),
  observedPaths: z.array(z.string().trim().min(1).max(8_192)).max(10_000),
  idempotencyKey: z.string().trim().min(8).max(512),
  candidateId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,200}$/),
  artifactId: z.string().startsWith('artifact:').optional(),
  expectedCurrentVersionId: z.string().startsWith('artifact-version:').nullable(),
  preparedAt: z.iso.datetime({ offset: true }).optional(),
  computeRunCandidates: z.array(z.string().startsWith('compute-run:')).max(1_000),
  computeCandidatesProcessed: z.boolean(),
  gitProjectionProcessed: z.boolean(),
  frozenCommitDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  resolutionHistory: z.array(resolutionReceiptSchema).max(100),
  attempts: z.number().int().nonnegative(),
  error: z.string().trim().min(1).max(4_000).optional(),
  retryable: z.boolean().optional(),
  ref: artifactVersionRefV1Schema.optional(),
  ordinal: z.number().int().positive().optional(),
  transactionId: z.string().startsWith('artifact-commit:').optional(),
  outputReceipts: z.array(committedOutputReceiptSchema).max(10_000).default([]),
  committedStatus: researchCheckpointCommittedTurnStatusV1Schema.optional(),
  changeKind: z.enum(['new', 'updated']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true })
}).strict().superRefine((value, context) => {
  const boundaryIdentityCount = [
    value.issuerEpoch,
    value.deliveryAttemptOrdinal,
    value.boundaryLeaseId,
    value.deliveryAttemptId
  ].filter((item) => item !== undefined).length
  if (boundaryIdentityCount !== 0 && boundaryIdentityCount !== 4) {
    context.addIssue({ code: 'custom', message: 'Checkpoint boundary identity must be complete.' })
  }
  if (value.manifestStorage === 'full' && value.manifestDigest !== sha256(canonicalJson(value.manifest))) {
    context.addIssue({ code: 'custom', path: ['manifestDigest'], message: 'Operation manifest digest is invalid.' })
  }
  if (value.state === 'committed' && value.manifestStorage !== 'summary') {
    context.addIssue({ code: 'custom', path: ['manifestStorage'], message: 'Committed journals retain only a manifest summary.' })
  }
  if (value.state !== 'committed' && value.manifestStorage !== 'full') {
    context.addIssue({ code: 'custom', path: ['manifestStorage'], message: 'Uncommitted journals require the full restart manifest.' })
  }
  if (value.state === 'committed' && !(value.ref && value.ordinal && value.transactionId)) {
    context.addIssue({ code: 'custom', message: 'Committed operation requires its exact Artifact receipt.' })
  }
  if (value.state === 'committed' && !value.committedStatus) {
    context.addIssue({ code: 'custom', path: ['committedStatus'], message: 'Committed operation requires its compact public status.' })
  }
  if (
    value.state !== 'committed' &&
    value.filePlans.some((plan) => plan.terminalSnapshot && plan.terminalSnapshot.dataBase64 === undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['filePlans'],
      message: 'Uncommitted operations must retain exact terminal snapshot bytes for restart replay.'
    })
  }
  if (
    value.state === 'committed' &&
    value.filePlans.some((plan) => (
      plan.patchReceipts?.length ||
      plan.terminalSnapshot?.dataBase64 !== undefined ||
      plan.expectedCurrentDataBase64 !== undefined
    ))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['filePlans'],
      message: 'Committed operations must retain only compact output identities and durable receipts.'
    })
  }
  if (!value.artifactId && value.expectedCurrentVersionId !== null) {
    context.addIssue({ code: 'custom', message: 'New checkpoint operations require a null expected current Version.' })
  }
  if (!value.preparedAt && (value.artifactId || value.expectedCurrentVersionId !== null)) {
    context.addIssue({ code: 'custom', message: 'An unprepared queued operation cannot freeze an Artifact base.' })
  }
})

const restoreOperationSchema = z.object({
  restoreOperationId: z.string().regex(/^research-checkpoint-restore:[a-f0-9]{64}$/),
  workspaceRoot: z.string().trim().min(1).max(16_384),
  recordingId: z.string().startsWith('research-recording:'),
  artifactId: z.string().startsWith('artifact:'),
  sourceVersionId: z.string().startsWith('artifact-version:'),
  expectedCurrentVersionId: z.string().startsWith('artifact-version:'),
  idempotencyKey: z.string().trim().min(8).max(512),
  state: z.enum(['pending', 'committed', 'failed']),
  attempts: z.number().int().nonnegative(),
  error: z.string().trim().min(1).max(4_000).optional(),
  retryable: z.boolean().optional(),
  restoredRef: artifactVersionRefV1Schema.optional(),
  ordinal: z.number().int().positive().optional(),
  transactionId: z.string().startsWith('artifact-commit:').optional(),
  idempotentReplay: z.boolean().optional(),
  projectedRecord: researchCheckpointRecordV1Schema.optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true })
}).strict().superRefine((value, context) => {
  if (value.state === 'committed' && !(
    value.restoredRef && value.ordinal && value.transactionId && value.idempotentReplay !== undefined
  )) {
    context.addIssue({ code: 'custom', message: 'Committed restore requires its exact Artifact receipt.' })
  }
})

const storeSchema = z.object({
  schemaVersion: z.literal(1),
  recordings: z.array(privateRecordingSchema).max(100_000),
  operations: z.array(operationSchema).max(1_000_000),
  restoreOperations: z.array(restoreOperationSchema).max(100_000).default([]),
  // Output identity belongs to the workspace, not to one conversation. Keep
  // legacy per-recording bindings for read migration only; every new prepare
  // and commit uses this optimistic workspace current pointer.
  workspaceFileBindings: z.array(workspaceFileBindingSchema).max(100_000).default([]),
  automaticRecordingPolicies: z.array(automaticRecordingPolicySchema).max(100_000).default([]),
  automaticPolicyOperationOrdinal: z.number().int().nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  automaticPolicyReceipts: z.array(automaticPolicyReceiptSchema).max(100_000).default([]),
  preTurnOutputBindingSnapshots: z.array(preTurnOutputBindingSnapshotSchema).max(100_000).default([]),
  turnBoundaryRetirement: turnBoundaryRetirementSchema.optional()
}).strict()

type PrivateRecording = z.infer<typeof privateRecordingSchema>
export type StoredCheckpointFilePlan = z.infer<typeof filePlanSchema>
export type CheckpointOperation = z.infer<typeof operationSchema>
export type CheckpointRestoreOperation = z.infer<typeof restoreOperationSchema>
type CheckpointStoreFile = z.infer<typeof storeSchema>
type ArtifactVersionCommitReceiptItemV1 = ArtifactVersionCommitReceiptV1['versions'][number]

export type ResearchCheckpointStoreOptions = Readonly<{
  userDataDir: string
  now?: () => Date
  createRecordingId?: () => string
  /** Host settings-aware sanitizer; opaque secret values never enter this package. */
  sanitizeText?: ResearchCheckpointTextSanitizer
  /** Aggregate serialized journal cap; mutations fail before filesystem writes. */
  maxStoreBytes?: number
  /** Exact recent policy receipts retained per workspace/runtime/thread scope. */
  maxAutomaticPolicyReceiptsPerScope?: number
  /** Global exact receipt cap across all scopes in one workspace store. */
  maxAutomaticPolicyReceipts?: number
  committedManifestLoader?: ResearchCheckpointCommittedManifestLoader
}>

export type ResearchCheckpointCommittedManifestLoader = Readonly<{
  load: (input: Readonly<{
    workspaceRoot: string
    ref: ArtifactVersionRefV1
  }>) => Promise<Uint8Array>
}>

export type DurableTurnBoundaryOwner = Readonly<{
  issuerEpoch: string
  deliveryAttemptOrdinal: number
  boundaryLeaseId: string
  deliveryAttemptId: string
  runtimeId: string
  threadId: string
  clientDirectiveId: string
  workspaceRoot?: string
  phase: 'pending-start' | 'watching' | 'completed-intent' | 'terminal-settlement'
  turnId?: string
  terminalState?: 'completed' | 'failed' | 'cancelled' | 'rejected'
}>

export type DurableTurnBoundarySnapshot = Readonly<{
  issuerEpoch: string
  nextDeliveryAttemptOrdinal: number
  retiredThroughOrdinal: number
  retiredOrdinalRanges: readonly Readonly<{ first: number; last: number }>[]
  owners: readonly DurableTurnBoundaryOwner[]
}>

export class ResearchCheckpointStore {
  readonly #userDataDir: string
  readonly #now: () => Date
  readonly #createRecordingId: () => string
  readonly #sanitizeText?: ResearchCheckpointTextSanitizer
  readonly #maxStoreBytes: number
  readonly #maxAutomaticPolicyReceiptsPerScope: number
  readonly #maxAutomaticPolicyReceipts: number
  #committedManifestLoader?: ResearchCheckpointCommittedManifestLoader
  readonly #queues = new Map<string, Promise<void>>()

  constructor(options: ResearchCheckpointStoreOptions) {
    this.#userDataDir = options.userDataDir
    this.#now = options.now ?? (() => new Date())
    this.#createRecordingId = options.createRecordingId ?? (() => `research-recording:${randomUUID()}`)
    this.#sanitizeText = options.sanitizeText
    const maxStoreBytes = options.maxStoreBytes ?? DEFAULT_MAX_STORE_BYTES
    if (!Number.isSafeInteger(maxStoreBytes) || maxStoreBytes <= 0) {
      throw new Error('Research checkpoint store byte budget must be a positive safe integer.')
    }
    this.#maxStoreBytes = maxStoreBytes
    const maxAutomaticPolicyReceiptsPerScope = options.maxAutomaticPolicyReceiptsPerScope ??
      DEFAULT_MAX_AUTOMATIC_POLICY_RECEIPTS_PER_SCOPE
    if (
      !Number.isSafeInteger(maxAutomaticPolicyReceiptsPerScope) ||
      maxAutomaticPolicyReceiptsPerScope <= 0
    ) {
      throw new Error('Automatic policy receipt limit must be a positive safe integer.')
    }
    this.#maxAutomaticPolicyReceiptsPerScope = maxAutomaticPolicyReceiptsPerScope
    const maxAutomaticPolicyReceipts = options.maxAutomaticPolicyReceipts ??
      DEFAULT_MAX_AUTOMATIC_POLICY_RECEIPTS
    if (!Number.isSafeInteger(maxAutomaticPolicyReceipts) || maxAutomaticPolicyReceipts <= 0) {
      throw new Error('Global automatic policy receipt limit must be a positive safe integer.')
    }
    this.#maxAutomaticPolicyReceipts = maxAutomaticPolicyReceipts
    this.#committedManifestLoader = options.committedManifestLoader
  }

  bindCommittedManifestLoader(
    load: ResearchCheckpointCommittedManifestLoader['load']
  ): void {
    if (this.#committedManifestLoader?.load === load) return
    if (this.#committedManifestLoader) {
      throw new Error('Research checkpoint committed manifest loader is already bound.')
    }
    this.#committedManifestLoader = Object.freeze({ load })
  }

  async start(
    workspaceRoot: string,
    input: ResearchCheckpointStartInputV1,
    boundary?: Readonly<{ watermark: string; knownTurnIds: readonly string[] }>
  ): Promise<ResearchCheckpointStartReceiptV1> {
    const canonicalWorkspaceRoot = resolve(workspaceRoot)
    const title = this.#sanitizePersistedText(input.title ?? `Research ${input.threadId}`, 512)
    const changeReason = input.changeReason
      ? this.#sanitizePersistedText(input.changeReason, 2_000)
      : undefined
    return this.#mutate<ResearchCheckpointStartReceiptV1>(workspaceRoot, (current) => {
      const replay = current.automaticPolicyReceipts.find((receipt) => (
        receipt.idempotencyKey === input.idempotencyKey
      ))
      if (replay) {
        if (
          replay.action !== 'start' ||
          replay.runtimeId !== input.runtimeId ||
          replay.threadId !== input.threadId ||
          replay.expectedPolicyRevision !== input.expectedPolicyRevision ||
          replay.title !== title ||
          replay.changeReason !== changeReason
        ) throw idempotencyMismatch()
        const recording = current.recordings.find((item) => item.recordingId === replay.recordingId)
        if (!recording || recording.origin !== 'live') {
          throw new CheckpointStoreError('content-mismatch', 'Start receipt lost its bound recording.')
        }
        return [current, {
          created: replay.created,
          policyRevision: replay.policyRevision,
          recording: publicRecording(recording)
        }]
      }
      const policy = automaticRecordingPolicy(current, input.runtimeId, input.threadId)
      if (input.expectedPolicyRevision !== policy.revision) throw staleAutomaticPolicyRevision()
      const timestamp = this.#nowIso()
      const policyRevision = policy.revision + 1
      const operationOrdinal = nextAutomaticPolicyOperationOrdinal(current)
      const active = latestRecording(current.recordings, input.runtimeId, input.threadId, 'active')
      if (active) {
        if (!sameWorkspace(active.workspaceRoot, workspaceRoot)) throw scopeMismatch()
        const receipt = automaticPolicyReceiptSchema.parse({
          action: 'start',
          idempotencyKey: input.idempotencyKey,
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          expectedPolicyRevision: input.expectedPolicyRevision,
          policyRevision,
          operationOrdinal,
          title,
          ...(changeReason ? { changeReason } : {}),
          created: false,
          recordingId: active.recordingId,
          createdAt: timestamp
        })
        return [withAutomaticPolicyReceipt(withAutomaticRecordingPolicy({
          ...current,
          automaticPolicyOperationOrdinal: operationOrdinal
        }, {
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          automaticEnabled: true,
          revision: policyRevision,
          updatedAt: timestamp
        }), receipt, this.#maxAutomaticPolicyReceiptsPerScope, this.#maxAutomaticPolicyReceipts), {
          created: false,
          policyRevision,
          recording: publicRecording(active)
        }]
      }
      const recording = privateRecordingSchema.parse({
        recordingId: this.#createRecordingId(),
        origin: 'live',
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        title,
        state: 'active',
        versionCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        workspaceRoot: canonicalWorkspaceRoot,
        startIdempotencyReceipts: [],
        ...(changeReason ? { initialChangeReason: changeReason } : {}),
        ...(boundary ? {
          startWatermark: boundary.watermark,
          startKnownTurnIds: [...new Set(boundary.knownTurnIds)]
        } : {}),
        fileBindings: []
      })
      const receipt = automaticPolicyReceiptSchema.parse({
        action: 'start',
        idempotencyKey: input.idempotencyKey,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        expectedPolicyRevision: input.expectedPolicyRevision,
        policyRevision,
        operationOrdinal,
        title,
        ...(changeReason ? { changeReason } : {}),
        created: true,
        recordingId: recording.recordingId,
        createdAt: timestamp
      })
      return [
        withAutomaticPolicyReceipt(withAutomaticRecordingPolicy(
          {
            ...current,
            recordings: [...current.recordings, recording],
            automaticPolicyOperationOrdinal: operationOrdinal
          },
          {
            runtimeId: input.runtimeId,
            threadId: input.threadId,
            automaticEnabled: true,
            revision: policyRevision,
            updatedAt: timestamp
          }
        ), receipt, this.#maxAutomaticPolicyReceiptsPerScope, this.#maxAutomaticPolicyReceipts),
        { created: true, policyRevision, recording: publicRecording(recording) }
      ]
    })
  }

  async createLegacyRecording(
    workspaceRoot: string,
    input: Readonly<{
      runtimeId: string
      threadId: string
      title: string
      idempotencyKey: string
    }>
  ): Promise<PrivateRecording> {
    const canonicalWorkspaceRoot = resolve(workspaceRoot)
    const title = this.#sanitizePersistedText(input.title, 512)
    return this.#mutate(workspaceRoot, (current) => {
      const replay = current.recordings.find((item) => item.startIdempotencyReceipts.some(
        (receipt) => receipt.idempotencyKey === input.idempotencyKey
      ))
      if (replay) {
        if (
          replay.runtimeId !== input.runtimeId ||
          replay.threadId !== input.threadId ||
          replay.title !== title ||
          replay.origin !== 'legacy-import'
        ) throw idempotencyMismatch()
        return [current, replay]
      }
      const timestamp = this.#nowIso()
      const recording = privateRecordingSchema.parse({
        recordingId: this.#createRecordingId(),
        origin: 'legacy-import',
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        title,
        state: 'stopped',
        versionCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        stoppedAt: timestamp,
        workspaceRoot: canonicalWorkspaceRoot,
        startIdempotencyReceipts: [{ idempotencyKey: input.idempotencyKey, title }],
        fileBindings: []
      })
      return [{ ...current, recordings: [...current.recordings, recording] }, recording]
    })
  }

  async stop(
    workspaceRoot: string,
    input: ResearchCheckpointStopInputV1,
    boundary?: Readonly<{ watermark: string; knownTurnIds: readonly string[] }>
  ): Promise<ResearchCheckpointStopReceiptV1> {
    return this.#mutate(workspaceRoot, (current) => {
      const replay = current.automaticPolicyReceipts.find((item) => (
        item.idempotencyKey === input.idempotencyKey
      ))
      if (replay) {
        if (
          replay.action !== 'stop' ||
          replay.runtimeId !== input.runtimeId ||
          replay.threadId !== input.threadId ||
          replay.expectedPolicyRevision !== input.expectedPolicyRevision ||
          replay.requestedRecordingId !== input.recordingId
        ) throw idempotencyMismatch()
        const recording = replay.recordingId
          ? current.recordings.find((item) => item.recordingId === replay.recordingId)
          : undefined
        if (replay.recordingId && !recording) {
          throw new CheckpointStoreError('content-mismatch', 'Stop receipt lost its bound recording.')
        }
        return [current, {
          policyRevision: replay.policyRevision,
          recording: recording ? publicRecording(recording) : null
        }]
      }
      const policy = automaticRecordingPolicy(current, input.runtimeId, input.threadId)
      if (input.expectedPolicyRevision !== policy.revision) throw staleAutomaticPolicyRevision()
      const latest = latestRecording(current.recordings, input.runtimeId, input.threadId)
      if (input.recordingId) {
        const requested = current.recordings.find((item) => item.recordingId === input.recordingId)
        if (!requested) {
          throw new CheckpointStoreError('not-found', 'Explicit research recording was not found.')
        }
        if (
          requested.runtimeId !== input.runtimeId ||
          requested.threadId !== input.threadId ||
          !sameWorkspace(requested.workspaceRoot, workspaceRoot) ||
          latest?.recordingId !== requested.recordingId
        ) {
          throw new CheckpointStoreError(
            'scope-mismatch',
            'Explicit research recording is not the canonical recording for this workspace runtime/thread.'
          )
        }
      }
      const index = latest ? current.recordings.indexOf(latest) : -1
      const timestamp = this.#nowIso()
      const policyRevision = policy.revision + 1
      const operationOrdinal = nextAutomaticPolicyOperationOrdinal(current)
      const recordings = [...current.recordings]
      let updated: PrivateRecording | undefined
      if (index >= 0) {
        const existing = current.recordings[index]!
        if (!sameWorkspace(existing.workspaceRoot, workspaceRoot)) throw scopeMismatch()
        updated = privateRecordingSchema.parse({
          ...existing,
          state: 'stopped',
          stoppedAt: existing.stoppedAt ?? timestamp,
          ...(boundary && existing.state === 'active' ? {
            stopWatermark: boundary.watermark,
            stopKnownTurnIds: [...new Set(boundary.knownTurnIds)]
          } : {}),
          updatedAt: timestamp
        })
        recordings[index] = updated
      }
      const receipt = automaticPolicyReceiptSchema.parse({
        idempotencyKey: input.idempotencyKey,
        action: 'stop',
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        expectedPolicyRevision: input.expectedPolicyRevision,
        policyRevision,
        operationOrdinal,
        ...(input.recordingId ? { requestedRecordingId: input.recordingId } : {}),
        ...(updated ? { recordingId: updated.recordingId } : {}),
        createdAt: timestamp
      })
      return [withAutomaticPolicyReceipt(withAutomaticRecordingPolicy(
        {
          ...current,
          recordings,
          automaticPolicyOperationOrdinal: operationOrdinal
        },
        {
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          automaticEnabled: false,
          revision: policyRevision,
          updatedAt: timestamp
        }
      ), receipt, this.#maxAutomaticPolicyReceiptsPerScope, this.#maxAutomaticPolicyReceipts), {
        policyRevision,
        recording: updated ? publicRecording(updated) : null
      }]
    })
  }

  async automaticRecordingEnabled(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<boolean> {
    const current = await this.#read(workspaceRoot)
    return automaticRecordingPolicy(current, runtimeId, threadId).automaticEnabled
  }

  async status(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<ResearchRecordingStatusV1 | null> {
    const current = await this.#read(workspaceRoot)
    const recording = latestRecording(current.recordings, runtimeId, threadId)
    return recording ? publicRecording(recording) : null
  }

  async checkpointStatus(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<ResearchCheckpointStatusV1> {
    const current = await this.#read(workspaceRoot)
    const recording = latestRecording(current.recordings, runtimeId, threadId)
    const policy = automaticRecordingPolicy(current, runtimeId, threadId)
    return {
      recordingMode: 'automatic',
      automaticEnabled: policy.automaticEnabled,
      policyRevision: policy.revision,
      recording: recording ? publicRecording(recording) : null
    }
  }

  async statusById(
    workspaceRoot: string,
    recordingId: string
  ): Promise<ResearchRecordingStatusV1 | null> {
    const current = await this.#read(workspaceRoot)
    const recording = current.recordings.find((item) => item.recordingId === recordingId)
    return recording ? publicRecording(recording) : null
  }

  async activeRecording(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<ResearchRecordingStatusV1 | null> {
    const current = await this.#read(workspaceRoot)
    const recording = latestRecording(current.recordings, runtimeId, threadId, 'active')
    return recording ? publicRecording(recording) : null
  }

  async activeRecordingContext(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<Readonly<{
    recording: ResearchRecordingStatusV1
    initialChangeReason?: string
  }> | null> {
    const current = await this.#read(workspaceRoot)
    const recording = latestRecording(current.recordings, runtimeId, threadId, 'active')
    return recording
      ? {
          recording: publicRecording(recording),
          ...(recording.initialChangeReason
            ? { initialChangeReason: recording.initialChangeReason }
            : {})
        }
      : null
  }

  async fileBindings(
    workspaceRoot: string,
    recordingId?: string
  ): Promise<ReadonlyMap<string, Readonly<{ artifactId: string; currentVersionId: string }>>> {
    const current = await this.#read(workspaceRoot)
    if (recordingId && !current.recordings.some((item) => item.recordingId === recordingId)) {
      throw new CheckpointStoreError('not-found', 'Research recording not found.')
    }
    return new Map(current.workspaceFileBindings.map((item) => [item.path, {
      artifactId: item.ref.artifactId,
      currentVersionId: item.ref.versionId
    }]))
  }

  /**
   * Required pre-dispatch barrier. Policy recheck, recording creation and the
   * exact lease snapshot are one durable mutation, so a concurrent stop is
   * ordered wholly before or wholly after this accepted turn.
   */
  async ensureAutomaticLease(
    workspaceRoot: string,
    input: Readonly<{
      issuerEpoch: string
      deliveryAttemptOrdinal: number
      leaseId: string
      deliveryAttemptId: string
      clientDirectiveId: string
      runtimeId: string
      threadId: string
      title: string
      boundary: Readonly<{ watermark: string; knownTurnIds: readonly string[] }>
    }>
  ): Promise<ResearchRecordingStatusV1 | null> {
    const canonicalWorkspaceRoot = resolve(workspaceRoot)
    const title = this.#sanitizePersistedText(input.title, 512)
    return this.#mutate(workspaceRoot, (current) => {
      const replay = current.preTurnOutputBindingSnapshots.find((item) => (
        item.leaseId === input.leaseId
      ))
      if (replay) {
        if (
          replay.issuerEpoch !== input.issuerEpoch ||
          replay.deliveryAttemptOrdinal !== input.deliveryAttemptOrdinal ||
          replay.deliveryAttemptId !== input.deliveryAttemptId ||
          replay.clientDirectiveId !== input.clientDirectiveId ||
          replay.runtimeId !== input.runtimeId ||
          replay.threadId !== input.threadId ||
          !sameWorkspace(replay.workspaceRoot, workspaceRoot)
        ) {
          throw new CheckpointStoreError('content-mismatch', 'Pre-turn directive identity changed scope.')
        }
        if (replay.state === 'skipped') return [current, null]
        const recording = current.recordings.find((item) => item.recordingId === replay.recordingId)
        if (!recording) {
          throw new CheckpointStoreError('content-mismatch', 'Turn boundary lease lost its bound recording.')
        }
        // A durable lease is never reopened, including after terminal
        // settlement. Re-delivery of the same Host attempt is a pure replay.
        return [current, publicRecording(recording)]
      }
      const attemptCollision = current.preTurnOutputBindingSnapshots.find((item) => (
        item.issuerEpoch === input.issuerEpoch && (
          item.deliveryAttemptOrdinal === input.deliveryAttemptOrdinal ||
          item.deliveryAttemptId === input.deliveryAttemptId
        )
      ))
      if (attemptCollision) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Host delivery attempt identity was reused for a different boundary lease.'
        )
      }
      const retirement = current.turnBoundaryRetirement
      if (retirement && retirement.issuerEpoch !== input.issuerEpoch) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Turn boundary issuer epoch changed without authoritative retirement reconciliation.'
        )
      }
      if (retirement && ordinalIsRetired(retirement.retiredOrdinalRanges, input.deliveryAttemptOrdinal)) {
        throw new CheckpointStoreError('content-mismatch', 'A retired delivery attempt cannot be reopened.')
      }

      const automaticEnabled = automaticRecordingPolicy(
        current,
        input.runtimeId,
        input.threadId
      ).automaticEnabled
      if (!automaticEnabled) {
        const snapshot = preTurnOutputBindingSnapshotSchema.parse({
          issuerEpoch: input.issuerEpoch,
          deliveryAttemptOrdinal: input.deliveryAttemptOrdinal,
          leaseId: input.leaseId,
          deliveryAttemptId: input.deliveryAttemptId,
          clientDirectiveId: input.clientDirectiveId,
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          workspaceRoot: canonicalWorkspaceRoot,
          state: 'skipped',
          capturedAt: this.#nowIso(),
          bindings: []
        })
        return [{
          ...current,
          preTurnOutputBindingSnapshots: compactTurnBoundaryLeases([
            ...current.preTurnOutputBindingSnapshots,
            snapshot
          ])
        }, null]
      }

      let next = current
      let recording = latestRecording(current.recordings, input.runtimeId, input.threadId, 'active')
      if (!recording) {
        const timestamp = this.#nowIso()
        recording = privateRecordingSchema.parse({
          recordingId: this.#createRecordingId(),
          origin: 'live',
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          title,
          state: 'active',
          versionCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          workspaceRoot: canonicalWorkspaceRoot,
          startIdempotencyReceipts: [],
          startWatermark: input.boundary.watermark,
          startKnownTurnIds: [...new Set(input.boundary.knownTurnIds)],
          fileBindings: []
        })
        next = { ...current, recordings: [...current.recordings, recording] }
      } else if (!sameWorkspace(recording.workspaceRoot, workspaceRoot)) {
        throw scopeMismatch()
      }

      const timestamp = this.#nowIso()
      const snapshot = preTurnOutputBindingSnapshotSchema.parse({
        issuerEpoch: input.issuerEpoch,
        deliveryAttemptOrdinal: input.deliveryAttemptOrdinal,
        leaseId: input.leaseId,
        deliveryAttemptId: input.deliveryAttemptId,
        clientDirectiveId: input.clientDirectiveId,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        workspaceRoot: canonicalWorkspaceRoot,
        recordingId: recording.recordingId,
        state: 'open',
        capturedAt: timestamp,
        bindings: turnBoundaryBindings(next, recording.recordingId, timestamp)
      })
      return [{
        ...next,
        preTurnOutputBindingSnapshots: compactTurnBoundaryLeases([
          ...next.preTurnOutputBindingSnapshots,
          snapshot
        ])
      }, publicRecording(recording)]
    })
  }

  async settleTurnBoundaryLease(
    workspaceRoot: string,
    input: Readonly<{
      issuerEpoch: string
      deliveryAttemptOrdinal: number
      leaseId: string
      deliveryAttemptId: string
      clientDirectiveId: string
      runtimeId: string
      threadId: string
      state: 'consumed' | 'released'
      turnId?: string
    }>
  ): Promise<void> {
    await this.#mutate(workspaceRoot, (current) => {
      const index = current.preTurnOutputBindingSnapshots.findIndex((item) => item.leaseId === input.leaseId)
      // Compact retirement receipts intentionally carry no remaining scope
      // payload. An unknown/retired settlement is an idempotent no-op, while
      // acquisition remains fail-closed for the same lease id.
      if (index < 0) return [current, undefined]
      const existing = current.preTurnOutputBindingSnapshots[index]!
      if (
        existing.issuerEpoch !== input.issuerEpoch ||
        existing.deliveryAttemptOrdinal !== input.deliveryAttemptOrdinal ||
        existing.deliveryAttemptId !== input.deliveryAttemptId ||
        existing.clientDirectiveId !== input.clientDirectiveId ||
        existing.runtimeId !== input.runtimeId ||
        existing.threadId !== input.threadId ||
        !sameWorkspace(existing.workspaceRoot, workspaceRoot) ||
        (existing.turnId && input.turnId && existing.turnId !== input.turnId)
      ) {
        throw new CheckpointStoreError('content-mismatch', 'Turn boundary lease settlement changed identity or scope.')
      }
      if (existing.state === 'skipped') return [current, undefined]
      if (existing.state !== 'open') {
        if (existing.state === input.state) return [current, undefined]
        throw new CheckpointStoreError(
          'content-mismatch',
          'Turn boundary lease received conflicting terminal dispositions.'
        )
      }
      const updated = preTurnOutputBindingSnapshotSchema.parse({
        ...existing,
        state: input.state,
        settledAt: this.#nowIso(),
        ...(input.turnId ? { turnId: input.turnId } : {}),
        // Successful completion retains the self-contained exact snapshot
        // until its durable artifact event arrives. Release never needs it.
        bindings: input.state === 'released' ? [] : existing.bindings
      })
      const leases = [...current.preTurnOutputBindingSnapshots]
      leases[index] = updated
      return [{ ...current, preTurnOutputBindingSnapshots: compactTurnBoundaryLeases(leases) }, undefined]
    })
  }

  async adoptRestoredVersion(
    workspaceRoot: string,
    input: Readonly<{
      recordingId: string
      artifactId: string
      expectedCurrentVersionId: string
      restoredRef: ArtifactVersionRefV1
      ordinal: number
    }>
  ): Promise<ResearchRecordingStatusV1> {
    return this.#mutate(workspaceRoot, (current) => {
      const index = current.recordings.findIndex((item) => item.recordingId === input.recordingId)
      if (index < 0) throw new CheckpointStoreError('not-found', 'Research recording not found.')
      const recording = current.recordings[index]!
      if (!sameWorkspace(recording.workspaceRoot, workspaceRoot)) throw scopeMismatch()
      if (
        recording.artifactId !== input.artifactId ||
        input.restoredRef.artifactId !== input.artifactId
      ) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Restored Version does not belong to the recording Artifact identity.'
        )
      }
      if (recording.currentVersionId === input.restoredRef.versionId) {
        if (
          recording.currentContentDigest !== input.restoredRef.contentDigest ||
          recording.currentOrdinal !== input.ordinal
        ) {
          throw new CheckpointStoreError(
            'content-mismatch',
            'Replayed restore changed the adopted exact Version facts.'
          )
        }
        return [current, publicRecording(recording)]
      }
      if (recording.currentVersionId !== input.expectedCurrentVersionId) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Research recording current Version changed before the restore binding was adopted.'
        )
      }
      const updated = privateRecordingSchema.parse({
        ...recording,
        currentVersionId: input.restoredRef.versionId,
        currentContentDigest: input.restoredRef.contentDigest,
        currentOrdinal: input.ordinal,
        versionCount: Math.max(recording.versionCount, input.ordinal),
        updatedAt: this.#nowIso()
      })
      const recordings = [...current.recordings]
      recordings[index] = updated
      return [{ ...current, recordings }, publicRecording(updated)]
    })
  }

  async enqueueRestore(
    workspaceRoot: string,
    input: Readonly<{
      recordingId: string
      artifactId: string
      sourceVersionId: string
      expectedCurrentVersionId: string
      idempotencyKey: string
    }>
  ): Promise<CheckpointRestoreOperation> {
    const canonicalWorkspaceRoot = resolve(workspaceRoot)
    return this.#mutate(workspaceRoot, (current) => {
      const replay = current.restoreOperations.find((item) => item.idempotencyKey === input.idempotencyKey)
      if (replay) {
        if (
          replay.recordingId !== input.recordingId ||
          replay.artifactId !== input.artifactId ||
          replay.sourceVersionId !== input.sourceVersionId ||
          replay.expectedCurrentVersionId !== input.expectedCurrentVersionId
        ) throw idempotencyMismatch()
        return [current, replay]
      }
      const recording = current.recordings.find((item) => item.recordingId === input.recordingId)
      if (!recording) throw new CheckpointStoreError('not-found', 'Research recording not found.')
      if (
        !sameWorkspace(recording.workspaceRoot, workspaceRoot) ||
        recording.artifactId !== input.artifactId ||
        recording.currentVersionId !== input.expectedCurrentVersionId
      ) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Restore request does not match the recording exact current Artifact Version.'
        )
      }
      const blocker = current.restoreOperations.find((item) => (
        item.recordingId === input.recordingId && item.state === 'pending'
      ))
      if (blocker) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Another restore is still pending for this research recording.'
        )
      }
      const timestamp = this.#nowIso()
      const restoreOperation = restoreOperationSchema.parse({
        restoreOperationId: `research-checkpoint-restore:${sha256([
          workspaceBindingDigest(workspaceRoot),
          input.recordingId,
          input.idempotencyKey
        ].join('\0'))}`,
        workspaceRoot: canonicalWorkspaceRoot,
        ...input,
        state: 'pending',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      return [
        { ...current, restoreOperations: [...current.restoreOperations, restoreOperation] },
        restoreOperation
      ]
    })
  }

  async pendingRestore(
    workspaceRoot: string,
    recordingId: string
  ): Promise<CheckpointRestoreOperation | null> {
    const current = await this.#read(workspaceRoot)
    return current.restoreOperations.find((item) => (
      item.recordingId === recordingId && item.state === 'pending'
    )) ?? null
  }

  async markRestoreAttempt(
    workspaceRoot: string,
    restoreOperationId: string,
    error?: string
  ): Promise<CheckpointRestoreOperation> {
    return this.#patchRestore(workspaceRoot, restoreOperationId, (existing) => ({
      ...existing,
      attempts: existing.attempts + 1,
      ...(error ? { error: this.#sanitizePersistedText(error, 4_000) } : {}),
      updatedAt: this.#nowIso()
    }))
  }

  async completeRestore(
    workspaceRoot: string,
    restoreOperationId: string,
    input: Readonly<{
      restoredRef: ArtifactVersionRefV1
      ordinal: number
      transactionId: string
      idempotentReplay: boolean
    }>
  ): Promise<CheckpointRestoreOperation> {
    return this.#mutate(workspaceRoot, async (current) => {
      const restoreIndex = current.restoreOperations.findIndex((item) => (
        item.restoreOperationId === restoreOperationId
      ))
      if (restoreIndex < 0) throw new CheckpointStoreError('not-found', 'Restore journal operation not found.')
      const existing = current.restoreOperations[restoreIndex]!
      if (existing.state === 'committed') {
        if (existing.restoredRef?.versionId !== input.restoredRef.versionId) {
          throw new CheckpointStoreError('content-mismatch', 'Restore replay changed Version identity.')
        }
        return [current, existing]
      }
      if (
        input.restoredRef.artifactId !== existing.artifactId ||
        !input.transactionId.startsWith('artifact-commit:')
      ) throw new CheckpointStoreError('content-mismatch', 'Restore receipt does not match its durable request.')
      const sourceOperation = current.operations.find((item) => (
        item.state === 'committed' &&
        item.recordingId === existing.recordingId &&
        item.ref?.versionId === existing.sourceVersionId
      ))
      const sourceRecord = sourceOperation
        ? await this.#operationRecord(workspaceRoot, sourceOperation)
        : current.restoreOperations.find((item) => (
            item.state === 'committed' &&
            item.recordingId === existing.recordingId &&
            item.projectedRecord?.status.artifactRef.versionId === existing.sourceVersionId
          ))?.projectedRecord
      if (!sourceRecord) {
        throw new CheckpointStoreError('not-found', 'Restore source checkpoint projection not found.')
      }
      if (!sameRestoredContent(sourceRecord.status.artifactRef, input.restoredRef)) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Restored Version content does not match its exact source checkpoint.'
        )
      }
      const recordingIndex = current.recordings.findIndex((item) => item.recordingId === existing.recordingId)
      if (recordingIndex < 0) throw new CheckpointStoreError('not-found', 'Research recording not found.')
      const recording = current.recordings[recordingIndex]!
      if (recording.currentVersionId !== existing.expectedCurrentVersionId) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Research recording advanced before its restore receipt was adopted.'
        )
      }
      const timestamp = this.#nowIso()
      const recordings = [...current.recordings]
      recordings[recordingIndex] = privateRecordingSchema.parse({
        ...recording,
        currentVersionId: input.restoredRef.versionId,
        currentContentDigest: input.restoredRef.contentDigest,
        currentOrdinal: input.ordinal,
        versionCount: Math.max(recording.versionCount, input.ordinal),
        updatedAt: timestamp
      })
      const restoreOperations = [...current.restoreOperations]
      const projectedRecord = restoredOperationRecord(
        existing,
        sourceRecord,
        input.restoredRef,
        input.ordinal,
        timestamp
      )
      restoreOperations[restoreIndex] = restoreOperationSchema.parse({
        ...existing,
        state: 'committed',
        ...input,
        error: undefined,
        retryable: undefined,
        projectedRecord,
        updatedAt: timestamp
      })
      return [
        { ...current, recordings, restoreOperations },
        restoreOperations[restoreIndex]!
      ]
    })
  }

  async failRestore(
    workspaceRoot: string,
    restoreOperationId: string,
    error: string,
    retryable: boolean
  ): Promise<CheckpointRestoreOperation> {
    return this.#patchRestore(workspaceRoot, restoreOperationId, (existing) => ({
      ...existing,
      state: retryable ? 'pending' : 'failed',
      error: this.#sanitizePersistedText(error, 4_000),
      retryable,
      updatedAt: this.#nowIso()
    }))
  }

  async enqueue(
    workspaceRoot: string,
    recordingId: string,
    extracted: ExtractedCheckpoint,
    commitIdempotencyKey: string,
    boundary?: Readonly<{
      issuerEpoch: string
      deliveryAttemptOrdinal: number
      leaseId: string
      deliveryAttemptId: string
    }>
  ): Promise<CheckpointOperation> {
    const canonicalWorkspaceRoot = resolve(workspaceRoot)
    const manifest = this.#sanitizeManifest(extracted.manifest)
    return this.#mutate(workspaceRoot, (current) => {
      const recording = current.recordings.find((item) => item.recordingId === recordingId)
      if (!recording) throw new CheckpointStoreError('not-found', 'Research recording not found.')
      if (!sameWorkspace(recording.workspaceRoot, workspaceRoot)) throw scopeMismatch()
      // A pending restore pauses this recording in nextProcessable(), but it
      // must not hold the shared Host turn-artifact outbox. Persist the turn
      // unprepared here; prepareOperation() will freeze the recording base
      // only after the exact restored Version has been durably adopted.
      const id = operationId([
        workspaceBindingDigest(workspaceRoot),
        recordingId,
        manifest.recording.runtimeId,
        manifest.recording.threadId,
        manifest.turn.turnId,
        manifest.turn.targetWatermark
      ])
      const preTurn = boundary
        ? current.preTurnOutputBindingSnapshots.find((item) => item.leaseId === boundary.leaseId)
        : undefined
      const replay = current.operations.find((item) => item.operationId === id)
      if (replay) {
        if (
          replay.recordingId !== recordingId ||
          replay.manifestDigest !== sha256(canonicalJson(manifest)) ||
          replay.issuerEpoch !== boundary?.issuerEpoch ||
          replay.deliveryAttemptOrdinal !== boundary?.deliveryAttemptOrdinal ||
          replay.boundaryLeaseId !== boundary?.leaseId ||
          replay.deliveryAttemptId !== boundary?.deliveryAttemptId
        ) throw new CheckpointStoreError('content-mismatch', 'Checkpoint event replay changed immutable content.')
        return [current, replay]
      }
      const timestamp = this.#nowIso()
      if (boundary && (
        !preTurn ||
        preTurn.issuerEpoch !== boundary.issuerEpoch ||
        preTurn.deliveryAttemptOrdinal !== boundary.deliveryAttemptOrdinal ||
        preTurn.deliveryAttemptId !== boundary.deliveryAttemptId ||
        preTurn.recordingId !== recordingId ||
        preTurn.clientDirectiveId !== extracted.clientDirectiveId ||
        preTurn.runtimeId !== manifest.recording.runtimeId ||
        preTurn.threadId !== manifest.recording.threadId ||
        !sameWorkspace(preTurn.workspaceRoot, workspaceRoot) ||
        preTurn.state === 'released' ||
        (preTurn.turnId !== undefined && preTurn.turnId !== manifest.turn.turnId)
      )) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Checkpoint event does not match its exact durable turn boundary lease.'
        )
      }
      const frozenBindings = new Map(
        (preTurn?.bindings ?? []).map((binding) => [binding.path, binding])
      )
      const record = operationSchema.parse({
        operationId: id,
        workspaceRoot: canonicalWorkspaceRoot,
        recordingId,
        runtimeId: manifest.recording.runtimeId,
        threadId: manifest.recording.threadId,
        turnId: manifest.turn.turnId,
        ...(boundary ? {
          issuerEpoch: boundary.issuerEpoch,
          deliveryAttemptOrdinal: boundary.deliveryAttemptOrdinal,
          boundaryLeaseId: boundary.leaseId,
          deliveryAttemptId: boundary.deliveryAttemptId
        } : {}),
        targetWatermark: manifest.turn.targetWatermark,
        state: 'pending',
        manifest,
        manifestDigest: sha256(canonicalJson(manifest)),
        manifestStorage: 'full',
        filePlans: extracted.filePlans.map((plan) => {
          const binding = frozenBindings.get(plan.path)
          return {
            ...plan,
            preTurnBindingCaptured: Boolean(preTurn),
            ...(binding ? {
              artifactId: binding.ref.artifactId,
              expectedCurrentVersionId: binding.ref.versionId,
              expectedCurrentOrdinal: binding.currentOrdinal,
              accessPolicy: binding.ref.accessPolicy,
              expectedCurrentRef: binding.ref,
              ...(binding.dataBase64 !== undefined ? { expectedCurrentDataBase64: binding.dataBase64 } : {})
            } : {
              artifactId: outputArtifactId(workspaceRoot, plan.path),
              expectedCurrentVersionId: null,
              expectedCurrentOrdinal: 0
            })
          }
        }),
        observedPaths: [],
        idempotencyKey: commitIdempotencyKey,
        candidateId: `checkpoint-${sha256(id).slice(0, 32)}`,
        expectedCurrentVersionId: null,
        computeRunCandidates: extracted.computeRunCandidates,
        computeCandidatesProcessed: extracted.computeRunCandidates.length === 0,
        gitProjectionProcessed: false,
        resolutionHistory: [],
        attempts: 0,
        changeKind: recording.versionCount === 0 ? 'new' : 'updated',
        createdAt: timestamp,
        updatedAt: timestamp
      })
      const leases = boundary && preTurn
        ? current.preTurnOutputBindingSnapshots.map((item) => item === preTurn
          ? preTurnOutputBindingSnapshotSchema.parse({
              ...item,
              state: 'consumed',
              settledAt: this.#nowIso(),
              turnId: manifest.turn.turnId,
              bindings: []
            })
          : item)
        : current.preTurnOutputBindingSnapshots
      return [{
        ...current,
        operations: [...current.operations, record],
        preTurnOutputBindingSnapshots: compactTurnBoundaryLeases(leases)
      }, record]
    })
  }

  async operation(workspaceRoot: string, operationIdValue: string): Promise<CheckpointOperation | undefined> {
    return (await this.#read(workspaceRoot)).operations.find((item) => item.operationId === operationIdValue)
  }

  async operationForEvent(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string,
    turnId: string,
    targetWatermark: string
  ): Promise<CheckpointOperation | undefined> {
    return (await this.#read(workspaceRoot)).operations.find((item) => (
      item.runtimeId === runtimeId &&
      item.threadId === threadId &&
      item.turnId === turnId &&
      item.targetWatermark === targetWatermark
    ))
  }

  async recordingContextForLease(
    workspaceRoot: string,
    event: Readonly<{
      issuerEpoch: string
      deliveryAttemptOrdinal: number
      leaseId: string
      deliveryAttemptId: string
      runtimeId: string
      threadId: string
      clientDirectiveId: string
    }>
  ): Promise<Readonly<{
    recording: ResearchRecordingStatusV1
    initialChangeReason?: string
  }> | null> {
    const current = await this.#read(workspaceRoot)
    const lease = current.preTurnOutputBindingSnapshots.find((item) => item.leaseId === event.leaseId)
    if (!lease) return null
    if (
      lease.issuerEpoch !== event.issuerEpoch ||
      lease.deliveryAttemptOrdinal !== event.deliveryAttemptOrdinal ||
      lease.deliveryAttemptId !== event.deliveryAttemptId ||
      lease.clientDirectiveId !== event.clientDirectiveId ||
      lease.runtimeId !== event.runtimeId ||
      lease.threadId !== event.threadId ||
      !sameWorkspace(lease.workspaceRoot, workspaceRoot)
    ) throw new CheckpointStoreError('content-mismatch', 'Artifact event changed its turn boundary identity.')
    if (lease.state === 'released' || lease.state === 'skipped') return null
    const recording = current.recordings.find((item) => item.recordingId === lease.recordingId)
    if (!recording || recording.origin !== 'live') {
      throw new CheckpointStoreError('content-mismatch', 'Turn boundary lease lost its live recording.')
    }
    return {
      recording: publicRecording(recording),
      ...(recording.initialChangeReason ? { initialChangeReason: recording.initialChangeReason } : {})
    }
  }

  async nextProcessable(
    workspaceRoot: string,
    recordingId: string
  ): Promise<CheckpointOperation | null> {
    const current = await this.#read(workspaceRoot)
    if (current.restoreOperations.some((item) => (
      item.recordingId === recordingId && item.state === 'pending'
    ))) return null
    for (const operation of current.operations.filter((item) => item.recordingId === recordingId)) {
      if (operation.state === 'stale-conflict') return null
      if (operation.state === 'pending') return operation
    }
    return null
  }

  async prepareOperation(
    workspaceRoot: string,
    operationIdValue: string
  ): Promise<CheckpointOperation> {
    return this.#mutate(workspaceRoot, (current) => {
      const index = current.operations.findIndex((item) => item.operationId === operationIdValue)
      if (index < 0) throw new CheckpointStoreError('not-found', 'Checkpoint operation not found.')
      const existing = current.operations[index]!
      if (existing.state !== 'pending' || existing.preparedAt) return [current, existing]
      const recording = current.recordings.find((item) => item.recordingId === existing.recordingId)
      if (!recording) throw new CheckpointStoreError('not-found', 'Research recording not found.')
      const updated = operationSchema.parse({
        ...existing,
        ...(recording.artifactId ? { artifactId: recording.artifactId } : {}),
        expectedCurrentVersionId: recording.currentVersionId ?? null,
        // Output parents are frozen by clientDirectiveId before provider
        // dispatch. Never late-bind them from terminal-time workspace current.
        filePlans: existing.filePlans,
        changeKind: recording.versionCount === 0 ? 'new' : 'updated',
        preparedAt: this.#nowIso(),
        updatedAt: this.#nowIso()
      })
      const operations = [...current.operations]
      operations[index] = updated
      return [{ ...current, operations }, updated]
    })
  }

  async completeComputeVerification(
    workspaceRoot: string,
    operationIdValue: string,
    manifest: ResearchCheckpointManifestV1
  ): Promise<CheckpointOperation> {
    const sanitizedManifest = this.#sanitizeManifest(manifest)
    return this.#patchOperation(workspaceRoot, operationIdValue, (existing) => ({
      ...existing,
      manifest: sanitizedManifest,
      manifestDigest: sha256(canonicalJson(sanitizedManifest)),
      computeCandidatesProcessed: true,
      updatedAt: this.#nowIso()
    }))
  }

  async completeGitProjection(
    workspaceRoot: string,
    operationIdValue: string,
    manifest: ResearchCheckpointManifestV1
  ): Promise<CheckpointOperation> {
    const sanitizedManifest = this.#sanitizeManifest(manifest)
    return this.#patchOperation(workspaceRoot, operationIdValue, (existing) => ({
      ...existing,
      manifest: sanitizedManifest,
      manifestDigest: sha256(canonicalJson(sanitizedManifest)),
      gitProjectionProcessed: true,
      updatedAt: this.#nowIso()
    }))
  }

  async freezeCommitDigest(
    workspaceRoot: string,
    operationIdValue: string,
    frozenCommitDigest: string
  ): Promise<CheckpointOperation> {
    return this.#patchOperation(workspaceRoot, operationIdValue, (existing) => {
      if (existing.frozenCommitDigest && existing.frozenCommitDigest !== frozenCommitDigest) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'A checkpoint retry changed its frozen Artifact candidate bytes or dependencies.'
        )
      }
      return existing.frozenCommitDigest
        ? existing
        : { ...existing, frozenCommitDigest, updatedAt: this.#nowIso() }
    })
  }

  async resolveConflict(
    workspaceRoot: string,
    input: ResearchCheckpointResolveInputV1,
    current?: Readonly<{ ref: ArtifactVersionRefV1; ordinal: number }>
  ): Promise<CheckpointOperation> {
    return this.#mutate(workspaceRoot, (store) => {
      const replay = store.operations.flatMap((operation) =>
        operation.resolutionHistory.map((receipt) => ({ operation, receipt }))
      ).find((item) => item.receipt.idempotencyKey === input.idempotencyKey)
      if (replay) {
        if (
          replay.operation.operationId !== input.operationId ||
          replay.operation.recordingId !== input.recordingId ||
          replay.operation.runtimeId !== input.runtimeId ||
          replay.operation.threadId !== input.threadId ||
          replay.receipt.resolution !== input.resolution
        ) throw idempotencyMismatch()
        return [store, replay.operation]
      }
      const index = store.operations.findIndex((item) => item.operationId === input.operationId)
      if (index < 0) throw new CheckpointStoreError('not-found', 'Checkpoint operation not found.')
      const existing = store.operations[index]!
      if (
        existing.recordingId !== input.recordingId ||
        existing.runtimeId !== input.runtimeId ||
        existing.threadId !== input.threadId
      ) throw scopeMismatch()
      if (existing.state !== 'stale-conflict') {
        throw new CheckpointStoreError('content-mismatch', 'Only a stale checkpoint conflict can be resolved.')
      }
      const resolvedAt = this.#nowIso()
      const resolutionReceipt = resolutionReceiptSchema.parse({
        idempotencyKey: input.idempotencyKey,
        resolution: input.resolution,
        resolvedAt,
        ...(current ? { rebasedCurrentVersionId: current.ref.versionId } : {})
      })
      const operations = [...store.operations]
      if (input.resolution === 'discard') {
        const discarded = operationSchema.parse({
          ...existing,
          state: 'failed',
          error: 'The stale checkpoint was explicitly discarded without changing Artifact current.',
          retryable: false,
          resolutionHistory: [...existing.resolutionHistory, resolutionReceipt],
          updatedAt: resolvedAt
        })
        operations[index] = discarded
        return [{ ...store, operations }, discarded]
      }
      const recordingIndex = store.recordings.findIndex((item) => item.recordingId === existing.recordingId)
      if (recordingIndex < 0) throw new CheckpointStoreError('not-found', 'Research recording not found.')
      const recording = store.recordings[recordingIndex]!
      const recordings = [...store.recordings]
      if (existing.artifactId) {
        if (!current || current.ref.artifactId !== existing.artifactId) {
          throw new CheckpointStoreError(
            'content-mismatch',
            'Rebase requires the exact current Version of the same checkpoint Artifact.'
          )
        }
        recordings[recordingIndex] = privateRecordingSchema.parse({
          ...recording,
          artifactId: current.ref.artifactId,
          currentVersionId: current.ref.versionId,
          currentContentDigest: current.ref.contentDigest,
          currentOrdinal: current.ordinal,
          versionCount: Math.max(recording.versionCount, current.ordinal),
          updatedAt: resolvedAt
        })
      }
      const rebaseToken = current?.ref.versionId ?? 'unbound-checkpoint-output-current-refresh'
      const rebased = operationSchema.parse({
        ...existing,
        state: 'pending',
        artifactId: undefined,
        expectedCurrentVersionId: null,
        preparedAt: undefined,
        frozenCommitDigest: undefined,
        idempotencyKey: idempotencyKey('resolve-rebase', [
          input.operationId,
          input.idempotencyKey,
          rebaseToken
        ]),
        error: undefined,
        retryable: undefined,
        resolutionHistory: [...existing.resolutionHistory, resolutionReceipt],
        updatedAt: resolvedAt
      })
      operations[index] = rebased
      return [{ ...store, recordings, operations }, rebased]
    })
  }

  async recoverableRecordings(): Promise<readonly Readonly<{
    workspaceRoot: string
    recordingId: string
  }>[]> {
    const directory = join(this.#userDataDir, 'research-checkpoints', 'workspaces')
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const values = new Map<string, Readonly<{ workspaceRoot: string; recordingId: string }>>()
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue
      const parsed = storeSchema.safeParse(await this.#readBoundedJson(join(directory, entry.name)))
      if (!parsed.success) continue
      const workspaceRoot = parsed.data.recordings[0]?.workspaceRoot ?? parsed.data.operations[0]?.workspaceRoot
      if (!workspaceRoot || entry.name !== `${workspaceBindingDigest(workspaceRoot)}.json`) continue
      for (const operation of parsed.data.operations) {
        if (operation.state !== 'pending') continue
        values.set(`${workspaceBindingDigest(workspaceRoot)}\0${operation.recordingId}`, {
          workspaceRoot,
          recordingId: operation.recordingId
        })
      }
      for (const restore of parsed.data.restoreOperations) {
        if (restore.state !== 'pending') continue
        values.set(`${workspaceBindingDigest(workspaceRoot)}\0${restore.recordingId}`, {
          workspaceRoot,
          recordingId: restore.recordingId
        })
      }
    }
    return [...values.values()]
  }

  async recoverableRestores(): Promise<readonly Readonly<{
    workspaceRoot: string
    restoreOperation: CheckpointRestoreOperation
  }>[]> {
    const directory = join(this.#userDataDir, 'research-checkpoints', 'workspaces')
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const output: Array<Readonly<{
      workspaceRoot: string
      restoreOperation: CheckpointRestoreOperation
    }>> = []
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue
      const parsed = storeSchema.safeParse(await this.#readBoundedJson(join(directory, entry.name)))
      if (!parsed.success) continue
      const workspaceRoot = parsed.data.recordings[0]?.workspaceRoot ??
        parsed.data.operations[0]?.workspaceRoot ??
        parsed.data.restoreOperations[0]?.workspaceRoot
      if (!workspaceRoot || entry.name !== `${workspaceBindingDigest(workspaceRoot)}.json`) continue
      for (const restoreOperation of parsed.data.restoreOperations) {
        if (restoreOperation.state === 'pending') output.push({ workspaceRoot, restoreOperation })
      }
    }
    return output
  }

  /** Reconciles local leases only from the Host's authoritative exact retirement snapshot. */
  async reconcileTurnBoundaryOwners(snapshot: DurableTurnBoundarySnapshot): Promise<number> {
    const validated = validateDurableTurnBoundarySnapshot(snapshot)
    const byLeaseId = new Map(validated.owners.map((owner) => [owner.boundaryLeaseId, owner]))
    const directory = join(this.#userDataDir, 'research-checkpoints', 'workspaces')
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let reconciled = 0
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue
      const parsed = storeSchema.parse(await this.#readBoundedJson(join(directory, entry.name)))
      const workspaceRoot = parsed.preTurnOutputBindingSnapshots[0]?.workspaceRoot ??
        parsed.recordings[0]?.workspaceRoot ??
        parsed.operations[0]?.workspaceRoot ??
        parsed.restoreOperations[0]?.workspaceRoot
      if (!workspaceRoot) {
        throw new CheckpointStoreError(
          'scope-mismatch',
          'Durable turn boundary store has no canonical workspace identity.'
        )
      }
      if (
        entry.name !== `${workspaceBindingDigest(workspaceRoot)}.json` ||
        parsed.preTurnOutputBindingSnapshots.some((lease) => !sameWorkspace(lease.workspaceRoot, workspaceRoot))
      ) {
        throw new CheckpointStoreError(
          'scope-mismatch',
          'Durable turn boundary store does not match its authoritative workspace file.'
        )
      }
      await this.#mutate(workspaceRoot, (current) => {
        if (
          current.turnBoundaryRetirement &&
          current.turnBoundaryRetirement.issuerEpoch !== validated.issuerEpoch
        ) {
          throw new CheckpointStoreError(
            'content-mismatch',
            'Host durable turn boundary issuer epoch changed unexpectedly.'
          )
        }
        const timestamp = this.#nowIso()
        let changed = false
        const leases: z.infer<typeof preTurnOutputBindingSnapshotSchema>[] = []
        for (const lease of current.preTurnOutputBindingSnapshots) {
          if (
            lease.issuerEpoch !== validated.issuerEpoch ||
            lease.deliveryAttemptOrdinal >= validated.nextDeliveryAttemptOrdinal
          ) {
            throw new CheckpointStoreError(
              'content-mismatch',
              'Local turn boundary lease is outside the Host authoritative issuer sequence.'
            )
          }
          const owner = byLeaseId.get(lease.leaseId)
          if (owner && (
            owner.issuerEpoch !== lease.issuerEpoch ||
            owner.deliveryAttemptOrdinal !== lease.deliveryAttemptOrdinal ||
            owner.deliveryAttemptId !== lease.deliveryAttemptId ||
            owner.clientDirectiveId !== lease.clientDirectiveId ||
            owner.runtimeId !== lease.runtimeId ||
            owner.threadId !== lease.threadId ||
            !owner.workspaceRoot ||
            !sameWorkspace(owner.workspaceRoot, lease.workspaceRoot)
          )) {
            throw new CheckpointStoreError(
              'content-mismatch',
              'Host durable turn boundary owner changed an existing lease identity.'
            )
          }
          if (!owner) {
            if (!ordinalIsRetired(validated.retiredOrdinalRanges, lease.deliveryAttemptOrdinal)) {
              throw new CheckpointStoreError(
                'content-mismatch',
                'Host snapshot omitted a local lease without exact retirement proof.'
              )
            }
            if (lease.state === 'open') {
              throw new CheckpointStoreError(
                'content-mismatch',
                'Host retired a delivery attempt before its local lease was durably settled.'
              )
            }
            changed = true
            reconciled += 1
            continue
          }
          if (lease.state === 'skipped') {
            leases.push(lease)
            continue
          }
          if (lease.state !== 'open') {
            if (owner?.phase === 'pending-start' || owner?.phase === 'watching') {
              throw new CheckpointStoreError(
                'content-mismatch',
                'Host attempted to reopen an already settled durable turn boundary lease.'
              )
            }
            const ownerTerminalState = owner?.phase === 'completed-intent'
              ? 'consumed'
              : owner?.phase === 'terminal-settlement'
                ? owner.terminalState === 'completed' ? 'consumed' : 'released'
                : undefined
            if (ownerTerminalState && ownerTerminalState !== lease.state) {
              throw new CheckpointStoreError(
                'content-mismatch',
                'Host durable turn boundary settlement conflicts with the local terminal receipt.'
              )
            }
            leases.push(lease)
            continue
          }
          if (owner.phase === 'pending-start' || owner.phase === 'watching') {
            leases.push(lease)
            continue
          }
          if (owner?.phase === 'completed-intent') {
            changed = true
            reconciled += 1
            leases.push(preTurnOutputBindingSnapshotSchema.parse({
              ...lease,
              state: 'consumed',
              settledAt: timestamp,
              ...(owner.turnId ? { turnId: owner.turnId } : {}),
              bindings: lease.bindings
            }))
            continue
          }
          const terminalState = owner?.terminalState
          if (owner && !terminalState) {
            throw new CheckpointStoreError(
              'content-mismatch',
              'Host terminal settlement omitted its terminal state.'
            )
          }
          if (owner?.turnId && lease.turnId && owner.turnId !== lease.turnId) {
            throw new CheckpointStoreError('content-mismatch', 'Host settlement changed the lease turn identity.')
          }
          const state = terminalState === 'completed' ? 'consumed' as const : 'released' as const
          changed = true
          reconciled += 1
          leases.push(preTurnOutputBindingSnapshotSchema.parse({
            ...lease,
            state,
            settledAt: timestamp,
            ...(owner?.turnId ? { turnId: owner.turnId } : {}),
            bindings: state === 'released' ? [] : lease.bindings
          }))
        }
        const retirement = turnBoundaryRetirementSchema.parse({
          issuerEpoch: validated.issuerEpoch,
          nextDeliveryAttemptOrdinal: validated.nextDeliveryAttemptOrdinal,
          retiredThroughOrdinal: validated.retiredThroughOrdinal,
          retiredOrdinalRanges: validated.retiredOrdinalRanges
        })
        if (canonicalJson(current.turnBoundaryRetirement ?? null) !== canonicalJson(retirement)) {
          changed = true
        }
        return changed
          ? [{
              ...current,
              preTurnOutputBindingSnapshots: compactTurnBoundaryLeases(leases),
              turnBoundaryRetirement: retirement
            }, undefined]
          : [current, undefined]
      })
    }
    return reconciled
  }

  async turnBoundaryLeaseState(
    workspaceRoot: string,
    leaseId: string
  ): Promise<'open' | 'consumed' | 'released' | 'skipped' | null> {
    const current = await this.#read(workspaceRoot)
    return current.preTurnOutputBindingSnapshots.find((item) => item.leaseId === leaseId)?.state ?? null
  }

  async updateObservedFile(
    workspaceRoot: string,
    operationIdValue: string,
    path: string,
    manifest: ResearchCheckpointManifestV1,
    ref?: ArtifactVersionRefV1,
    artifactOrdinal?: number
  ): Promise<CheckpointOperation> {
    const sanitizedManifest = this.#sanitizeManifest(manifest)
    return this.#mutate(workspaceRoot, (current) => {
      const operationIndex = current.operations.findIndex((item) => item.operationId === operationIdValue)
      if (operationIndex < 0) throw new CheckpointStoreError('not-found', 'Checkpoint operation not found.')
      const existing = current.operations[operationIndex]!
      const updated = operationSchema.parse({
        ...existing,
        manifest: sanitizedManifest,
        manifestDigest: sha256(canonicalJson(sanitizedManifest)),
        observedPaths: [...new Set([...existing.observedPaths, path])],
        updatedAt: this.#nowIso()
      })
      const operations = [...current.operations]
      operations[operationIndex] = updated
      if (!ref) return [{ ...current, operations }, updated]
      if (!artifactOrdinal) {
        throw new CheckpointStoreError('content-mismatch', 'Observed output binding requires its Artifact ordinal.')
      }
      const frozenPlan = existing.filePlans.find((plan) => plan.path === path)
      if (!frozenPlan) throw new CheckpointStoreError('content-mismatch', 'Observed output was not frozen in this operation.')
      const prior = current.workspaceFileBindings.find((item) => item.path === path)
      if (
        prior && (
          prior.ref.artifactId !== frozenPlan.artifactId ||
          prior.ref.versionId !== frozenPlan.expectedCurrentVersionId
        )
      ) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Workspace output current changed before its exact receipt was adopted.'
        )
      }
      if (!prior && frozenPlan.expectedCurrentVersionId !== null) {
        throw new CheckpointStoreError('content-mismatch', 'Workspace output binding disappeared before adoption.')
      }
      const timestamp = this.#nowIso()
      const workspaceFileBindings = [
        ...current.workspaceFileBindings.filter((item) => item.path !== path),
        {
          path,
          ref,
          currentOrdinal: artifactOrdinal,
          updatedAt: timestamp
        }
      ].sort((left, right) => left.path.localeCompare(right.path))
      return [{ ...current, operations, workspaceFileBindings }, updated]
    })
  }

  async completeFilePatchVerification(
    workspaceRoot: string,
    operationIdValue: string,
    path: string,
    plan: StoredCheckpointFilePlan,
    manifest: ResearchCheckpointManifestV1
  ): Promise<CheckpointOperation> {
    const sanitizedManifest = this.#sanitizeManifest(manifest)
    return this.#mutate(workspaceRoot, (current) => {
      const operationIndex = current.operations.findIndex((item) => item.operationId === operationIdValue)
      if (operationIndex < 0) throw new CheckpointStoreError('not-found', 'Checkpoint operation not found.')
      const existing = current.operations[operationIndex]!
      const planIndex = existing.filePlans.findIndex((item) => item.path === path)
      if (planIndex < 0 || plan.path !== path) {
        throw new CheckpointStoreError('content-mismatch', 'Patch verification changed its frozen output path.')
      }
      const filePlans = [...existing.filePlans]
      filePlans[planIndex] = filePlanSchema.parse(plan)
      const updated = operationSchema.parse({
        ...existing,
        filePlans,
        manifest: sanitizedManifest,
        manifestDigest: sha256(canonicalJson(sanitizedManifest)),
        observedPaths: [...new Set([...existing.observedPaths, path])],
        updatedAt: this.#nowIso()
      })
      const operations = [...current.operations]
      operations[operationIndex] = updated
      return [{ ...current, operations }, updated]
    })
  }

  async replaceManifest(
    workspaceRoot: string,
    operationIdValue: string,
    manifest: ResearchCheckpointManifestV1
  ): Promise<CheckpointOperation> {
    const sanitizedManifest = this.#sanitizeManifest(manifest)
    return this.#mutate(workspaceRoot, (current) => {
      const index = current.operations.findIndex((item) => item.operationId === operationIdValue)
      if (index < 0) throw new CheckpointStoreError('not-found', 'Checkpoint operation not found.')
      const updated = operationSchema.parse({
        ...current.operations[index],
        manifest: sanitizedManifest,
        manifestDigest: sha256(canonicalJson(sanitizedManifest)),
        updatedAt: this.#nowIso()
      })
      const operations = [...current.operations]
      operations[index] = updated
      return [{ ...current, operations }, updated]
    })
  }

  async markAttempt(
    workspaceRoot: string,
    operationIdValue: string,
    error?: string
  ): Promise<CheckpointOperation> {
    return this.#patchOperation(workspaceRoot, operationIdValue, (existing) => ({
      ...existing,
      attempts: existing.attempts + 1,
      ...(error ? { error: this.#sanitizePersistedText(error, 4_000) } : {}),
      updatedAt: this.#nowIso()
    }))
  }

  async markCommitted(
    workspaceRoot: string,
    operationIdValue: string,
    receiptItem: ArtifactVersionCommitReceiptItemV1,
    transactionId: string,
    outputReceipts: readonly Readonly<{
      path: string
      item: ArtifactVersionCommitReceiptItemV1
    }>[] = []
  ): Promise<CheckpointOperation> {
    return this.#mutate(workspaceRoot, (current) => {
      const operationIndex = current.operations.findIndex((item) => item.operationId === operationIdValue)
      if (operationIndex < 0) throw new CheckpointStoreError('not-found', 'Checkpoint operation not found.')
      const existing = current.operations[operationIndex]!
      if (existing.state === 'committed') {
        if (existing.ref?.versionId !== receiptItem.ref.versionId) {
          throw new CheckpointStoreError('content-mismatch', 'Idempotent checkpoint receipt changed Version identity.')
        }
        return [current, existing]
      }
      if (receiptItem.candidateId !== existing.candidateId) {
        throw new CheckpointStoreError('content-mismatch', 'Artifact receipt candidate does not match checkpoint operation.')
      }
      const recordingIndex = current.recordings.findIndex((item) => item.recordingId === existing.recordingId)
      if (recordingIndex < 0) throw new CheckpointStoreError('not-found', 'Research recording not found.')
      const recording = current.recordings[recordingIndex]!
      if (recording.artifactId && recording.artifactId !== receiptItem.ref.artifactId) {
        throw new CheckpointStoreError('content-mismatch', 'A checkpoint replay cannot change stable Artifact identity.')
      }
      if (
        existing.expectedCurrentVersionId &&
        receiptItem.version.parentVersionId !== existing.expectedCurrentVersionId
      ) {
        throw new CheckpointStoreError('content-mismatch', 'Checkpoint Version parent does not match its frozen base.')
      }
      if (
        receiptItem.version.transactionId !== transactionId ||
        outputReceipts.some(({ item }) => item.version.transactionId !== transactionId)
      ) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Checkpoint and output receipts must belong to one atomic Artifact transaction.'
        )
      }
      const workspaceFileBindings = [...current.workspaceFileBindings]
      for (const { path, item } of outputReceipts) {
        const plan = existing.filePlans.find((candidate) => candidate.path === path)
        if (!plan?.terminalSnapshot || !plan.artifactId) {
          throw new CheckpointStoreError('content-mismatch', 'Atomic output receipt was not frozen in this operation.')
        }
        if (
          item.ref.artifactId !== plan.artifactId ||
          item.ref.versionId !== outputVersionId(existing.operationId, path) ||
          item.ref.contentDigest !== plan.terminalSnapshot.contentDigest ||
          item.ref.byteLength !== plan.terminalSnapshot.byteLength ||
          item.version.parentVersionId !== (plan.expectedCurrentVersionId ?? undefined)
        ) {
          throw new CheckpointStoreError('content-mismatch', 'Atomic output receipt changed its frozen exact identity or bytes.')
        }
        const prior = workspaceFileBindings.find((candidate) => candidate.path === path)
        if (
          prior && (
            prior.ref.artifactId !== plan.artifactId ||
            prior.ref.versionId !== plan.expectedCurrentVersionId
          )
        ) {
          throw new CheckpointStoreError(
            'content-mismatch',
            'Workspace output current changed before the atomic receipt was adopted.'
          )
        }
        if (!prior && plan.expectedCurrentVersionId !== null) {
          throw new CheckpointStoreError('content-mismatch', 'Workspace output binding disappeared before atomic adoption.')
        }
        const next = workspaceFileBindingSchema.parse({
          path,
          ref: item.ref,
          currentOrdinal: item.artifact.versionCount,
          updatedAt: this.#nowIso()
        })
        const priorIndex = workspaceFileBindings.findIndex((candidate) => candidate.path === path)
        if (priorIndex < 0) workspaceFileBindings.push(next)
        else workspaceFileBindings[priorIndex] = next
      }
      const ordinal = receiptItem.artifact.versionCount
      const committedStatus = committedOperationStatus(existing, existing.manifest, receiptItem.ref, ordinal)
      const committedManifest = compactCommittedManifest(existing.manifest)
      const updatedOperation = operationSchema.parse({
        ...existing,
        state: 'committed',
        manifest: committedManifest,
        manifestStorage: 'summary',
        filePlans: existing.filePlans.map(compactCommittedFilePlan),
        ref: receiptItem.ref,
        ordinal,
        transactionId,
        outputReceipts: outputReceipts.map(({ path, item }) => ({
          path,
          artifactOrdinal: item.artifact.versionCount,
          ref: item.ref
        })),
        committedStatus,
        error: undefined,
        retryable: undefined,
        updatedAt: this.#nowIso()
      })
      const updatedRecording = privateRecordingSchema.parse({
        ...recording,
        artifactId: receiptItem.ref.artifactId,
        currentVersionId: receiptItem.ref.versionId,
        currentContentDigest: receiptItem.ref.contentDigest,
        currentOrdinal: ordinal,
        versionCount: Math.max(recording.versionCount, ordinal),
        updatedAt: this.#nowIso()
      })
      const operations = [...current.operations]
      operations[operationIndex] = updatedOperation
      const recordings = [...current.recordings]
      recordings[recordingIndex] = updatedRecording
      workspaceFileBindings.sort((left, right) => left.path.localeCompare(right.path))
      return [{
        ...current,
        operations,
        recordings,
        workspaceFileBindings
      }, updatedOperation]
    })
  }

  async markTerminalFailure(
    workspaceRoot: string,
    operationIdValue: string,
    state: 'stale-conflict' | 'failed',
    error: string,
    retryable: boolean
  ): Promise<CheckpointOperation> {
    return this.#patchOperation(workspaceRoot, operationIdValue, (existing) => ({
      ...existing,
      state,
      error: this.#sanitizePersistedText(error, 4_000),
      retryable,
      updatedAt: this.#nowIso()
    }))
  }

  async turnStatus(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string,
    turnId: string
  ): Promise<ResearchCheckpointTurnStatusV1> {
    const matching = (await this.#read(workspaceRoot)).operations
      .filter((item) => item.runtimeId === runtimeId && item.threadId === threadId && item.turnId === turnId)
      .sort(newestOperation)
    return matching[0]
      ? publicOperationStatus(matching[0])
      : researchCheckpointTurnStatusV1Schema.parse({ state: 'unrecorded', runtimeId, threadId, turnId })
  }

  async read(
    workspaceRoot: string,
    input: Readonly<{ recordingId?: string; versionId?: string }>
  ): Promise<ResearchCheckpointRecordV1> {
    const entries = (await this.#checkpointRecordEntries(workspaceRoot, await this.#read(workspaceRoot)))
      .filter((item) => !input.recordingId || item.recordingId === input.recordingId)
      .filter((item) => !input.versionId || item.record.status.artifactRef.versionId === input.versionId)
      .sort(newestRecordEntry)
    if (!entries[0]) throw new CheckpointStoreError('not-found', 'Committed research checkpoint not found.')
    return entries[0].record
  }

  async list(
    workspaceRoot: string,
    input: Readonly<{
      runtimeId?: string
      threadId?: string
      recordingId?: string
      cursor?: string
      limit?: number
    }>
  ): Promise<ResearchCheckpointListV1> {
    const sorted = (await this.#checkpointRecordEntries(workspaceRoot, await this.#read(workspaceRoot)))
      .filter((item) => !input.runtimeId || item.record.status.runtimeId === input.runtimeId)
      .filter((item) => !input.threadId || item.record.status.threadId === input.threadId)
      .filter((item) => !input.recordingId || item.recordingId === input.recordingId)
      .sort(newestRecordEntry)
    const start = input.cursor
      ? Math.max(0, sorted.findIndex((item) => item.cursor === input.cursor) + 1)
      : 0
    const limit = input.limit ?? 50
    const page = sorted.slice(start, start + limit)
    return {
      records: page.map((item) => item.record),
      ...(start + limit < sorted.length && page.length > 0
        ? { nextCursor: page[page.length - 1]!.cursor }
        : {})
    }
  }

  pathFor(workspaceRoot: string): string {
    return join(
      this.#userDataDir,
      'research-checkpoints',
      'workspaces',
      `${workspaceBindingDigest(workspaceRoot)}.json`
    )
  }

  async #checkpointRecordEntries(
    workspaceRoot: string,
    store: CheckpointStoreFile
  ): Promise<CheckpointRecordEntry[]> {
    const entries: CheckpointRecordEntry[] = []
    for (const operation of store.operations) {
      if (operation.state !== 'committed') continue
      entries.push({
        cursor: operation.operationId,
        recordingId: operation.recordingId,
        createdAt: operation.createdAt,
        record: await this.#operationRecord(workspaceRoot, operation)
      })
    }
    for (const restore of store.restoreOperations) {
      if (restore.state !== 'committed' || !restore.projectedRecord) continue
      entries.push({
        cursor: restore.restoreOperationId,
        recordingId: restore.recordingId,
        createdAt: restore.updatedAt,
        record: restore.projectedRecord
      })
    }
    return entries
  }

  async #operationRecord(
    workspaceRoot: string,
    operation: CheckpointOperation
  ): Promise<ResearchCheckpointRecordV1> {
    const status = publicOperationStatus(operation)
    if (status.state !== 'committed' || !operation.ref) {
      throw new Error('Checkpoint record requires a committed operation.')
    }
    if (operation.manifestStorage === 'full') {
      return researchCheckpointRecordV1Schema.parse({ manifest: operation.manifest, status })
    }
    if (!this.#committedManifestLoader) {
      throw new CheckpointStoreError(
        'content-mismatch',
        'Committed checkpoint manifest loader is unavailable.'
      )
    }
    let bytes: Uint8Array
    try {
      bytes = await this.#committedManifestLoader.load({ workspaceRoot, ref: operation.ref })
    } catch (error) {
      if (error instanceof CheckpointStoreError) throw error
      throw new CheckpointStoreError(
        'content-mismatch',
        `Committed checkpoint exact Artifact Version could not be loaded: ${errorMessage(error)}`
      )
    }
    if (
      bytes.byteLength !== operation.ref.byteLength ||
      sha256(bytes) !== operation.ref.contentDigest
    ) {
      throw new CheckpointStoreError(
        'content-mismatch',
        'Committed checkpoint bytes do not match the exact Artifact Version reference.'
      )
    }
    let manifest: ResearchCheckpointManifestV1
    try {
      manifest = researchCheckpointManifestV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
    } catch {
      throw new CheckpointStoreError(
        'content-mismatch',
        'Committed checkpoint Artifact Version does not contain a valid exact manifest.'
      )
    }
    if (
      sha256(canonicalJson(manifest)) !== operation.manifestDigest ||
      manifest.recording.recordingId !== operation.recordingId ||
      manifest.turn.turnId !== operation.turnId
    ) {
      throw new CheckpointStoreError(
        'content-mismatch',
        'Committed checkpoint manifest identity does not match its journal summary.'
      )
    }
    return researchCheckpointRecordV1Schema.parse({ manifest, status })
  }

  async #patchOperation(
    workspaceRoot: string,
    operationIdValue: string,
    patch: (operation: CheckpointOperation) => unknown
  ): Promise<CheckpointOperation> {
    return this.#mutate(workspaceRoot, (current) => {
      const index = current.operations.findIndex((item) => item.operationId === operationIdValue)
      if (index < 0) throw new CheckpointStoreError('not-found', 'Checkpoint operation not found.')
      const updated = operationSchema.parse(patch(current.operations[index]!))
      const operations = [...current.operations]
      operations[index] = updated
      return [{ ...current, operations }, updated]
    })
  }

  async #patchRestore(
    workspaceRoot: string,
    restoreOperationId: string,
    patch: (operation: CheckpointRestoreOperation) => unknown
  ): Promise<CheckpointRestoreOperation> {
    return this.#mutate(workspaceRoot, (current) => {
      const index = current.restoreOperations.findIndex((item) => (
        item.restoreOperationId === restoreOperationId
      ))
      if (index < 0) throw new CheckpointStoreError('not-found', 'Restore journal operation not found.')
      const updated = restoreOperationSchema.parse(patch(current.restoreOperations[index]!))
      const restoreOperations = [...current.restoreOperations]
      restoreOperations[index] = updated
      return [{ ...current, restoreOperations }, updated]
    })
  }

  async #read(workspaceRoot: string): Promise<CheckpointStoreFile> {
    const storePath = this.pathFor(workspaceRoot)
    let value: unknown
    try {
      const serialized = await readFile(storePath, 'utf8')
      this.#assertStoreBudget(serialized)
      value = JSON.parse(serialized) as unknown
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
      value = undefined
    }
    const migratedValue = compactLegacyCommittedOperations(value)
    let parsed = storeSchema.parse(migratedValue ?? {
      schemaVersion: 1,
      recordings: [],
      operations: [],
      restoreOperations: [],
      workspaceFileBindings: [],
      automaticRecordingPolicies: [],
      automaticPolicyOperationOrdinal: 0,
      preTurnOutputBindingSnapshots: []
    })
    // Merge rather than only backfill an entirely empty array: a migrated
    // workspace may already have one newly persisted path while other legacy
    // committed paths still exist only in immutable manifests. Persisted
    // workspace currents always win for the same normalized path.
    const workspaceFileBindings = new Map(
      deriveLegacyWorkspaceFileBindings(parsed.operations).map((item) => [item.path, item])
    )
    for (const binding of parsed.workspaceFileBindings) workspaceFileBindings.set(binding.path, binding)
    parsed = {
      ...parsed,
      workspaceFileBindings: [...workspaceFileBindings.values()]
        .sort((left, right) => left.path.localeCompare(right.path))
    }
    if (
      parsed.recordings.some((item) => !sameWorkspace(item.workspaceRoot, workspaceRoot)) ||
      parsed.operations.some((item) => !sameWorkspace(item.workspaceRoot, workspaceRoot)) ||
      parsed.restoreOperations.some((item) => !sameWorkspace(item.workspaceRoot, workspaceRoot))
    ) throw scopeMismatch()
    if (migratedValue !== value && value !== undefined) {
      await this.#writeStore(storePath, parsed)
    }
    return parsed
  }

  async #mutate<T>(
    workspaceRoot: string,
    mutation: (
      current: CheckpointStoreFile
    ) => readonly [CheckpointStoreFile, T] | Promise<readonly [CheckpointStoreFile, T]>
  ): Promise<T> {
    const key = this.pathFor(workspaceRoot)
    const previous = this.#queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>((resolveTail) => { release = resolveTail })
    const queued = previous.then(() => tail, () => tail)
    this.#queues.set(key, queued)
    await previous.catch(() => undefined)
    try {
      const current = await this.#read(workspaceRoot)
      const [next, result] = await mutation(current)
      if (next !== current) {
        await this.#writeStore(this.pathFor(workspaceRoot), storeSchema.parse({
          ...next,
          preTurnOutputBindingSnapshots: compactTurnBoundaryLeases(
            next.preTurnOutputBindingSnapshots
          )
        }))
      }
      return result
    } finally {
      release()
      if (this.#queues.get(key) === queued) this.#queues.delete(key)
    }
  }

  #nowIso(): string {
    const value = this.#now()
    if (Number.isNaN(value.getTime())) throw new Error('Clock returned an invalid time.')
    return value.toISOString()
  }

  #sanitizeManifest(manifest: ResearchCheckpointManifestV1): ResearchCheckpointManifestV1 {
    return sanitizeResearchCheckpointManifest(manifest, this.#sanitizeText)
  }

  #sanitizePersistedText(value: string, maxLength: number): string {
    return truncate(sanitizeResearchCheckpointText(value, this.#sanitizeText), maxLength)
  }

  async #writeStore(path: string, value: CheckpointStoreFile): Promise<void> {
    const serialized = JSON.stringify(value)
    this.#assertStoreBudget(serialized)
    await writeJsonAtomic(path, value)
  }

  async #readBoundedJson(path: string): Promise<unknown | undefined> {
    try {
      const serialized = await readFile(path, 'utf8')
      this.#assertStoreBudget(serialized)
      return JSON.parse(serialized) as unknown
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  #assertStoreBudget(serialized: string): void {
    const bytes = Buffer.byteLength(serialized, 'utf8')
    if (bytes > this.#maxStoreBytes) {
      throw new Error(
        `Research checkpoint store exceeds its ${this.#maxStoreBytes}-byte serialized capacity.`
      )
    }
  }
}

function compactTurnBoundaryLeases(
  leases: readonly z.infer<typeof preTurnOutputBindingSnapshotSchema>[]
): z.infer<typeof preTurnOutputBindingSnapshotSchema>[] {
  // Owned/open or terminal-but-still-owned leases retain their exact snapshot.
  // Only an authoritative exact retired ordinal range can remove one.
  return [...leases]
}

function validateDurableTurnBoundarySnapshot(
  snapshot: DurableTurnBoundarySnapshot
): DurableTurnBoundarySnapshot {
  const retirement = turnBoundaryRetirementSchema.parse({
    issuerEpoch: snapshot.issuerEpoch,
    nextDeliveryAttemptOrdinal: snapshot.nextDeliveryAttemptOrdinal,
    retiredThroughOrdinal: snapshot.retiredThroughOrdinal,
    retiredOrdinalRanges: snapshot.retiredOrdinalRanges
  })
  const normalizedRanges = normalizeRetiredOrdinalRanges(retirement.retiredOrdinalRanges)
  if (canonicalJson(normalizedRanges) !== canonicalJson(retirement.retiredOrdinalRanges)) {
    throw new CheckpointStoreError(
      'content-mismatch',
      'Host durable turn boundary retirement ranges are not canonical.'
    )
  }
  if (normalizedRanges.some((range) => range.last >= retirement.nextDeliveryAttemptOrdinal)) {
    throw new CheckpointStoreError(
      'content-mismatch',
      'Host retired an ordinal that has not been durably allocated.'
    )
  }
  const exactRetiredThrough = normalizedRanges[0]?.first === 1 ? normalizedRanges[0].last : 0
  if (retirement.retiredThroughOrdinal !== exactRetiredThrough) {
    throw new CheckpointStoreError(
      'content-mismatch',
      'Host retired-through ordinal does not match its exact retirement ranges.'
    )
  }
  const leaseIds = new Set<string>()
  const ownerOrdinals = new Set<number>()
  for (const owner of snapshot.owners) {
    if (
      owner.issuerEpoch !== retirement.issuerEpoch ||
      !Number.isSafeInteger(owner.deliveryAttemptOrdinal) ||
      owner.deliveryAttemptOrdinal <= 0 ||
      owner.deliveryAttemptOrdinal >= retirement.nextDeliveryAttemptOrdinal ||
      !owner.boundaryLeaseId.trim() ||
      !owner.deliveryAttemptId.trim() ||
      !owner.runtimeId.trim() ||
      !owner.threadId.trim() ||
      !owner.clientDirectiveId.trim()
    ) {
      throw new CheckpointStoreError('content-mismatch', 'Host returned an invalid durable boundary owner.')
    }
    if (
      leaseIds.has(owner.boundaryLeaseId) ||
      ownerOrdinals.has(owner.deliveryAttemptOrdinal) ||
      ordinalIsRetired(normalizedRanges, owner.deliveryAttemptOrdinal)
    ) {
      throw new CheckpointStoreError(
        'content-mismatch',
        'Host durable boundary owner overlaps another owner or retired ordinal.'
      )
    }
    leaseIds.add(owner.boundaryLeaseId)
    ownerOrdinals.add(owner.deliveryAttemptOrdinal)
  }
  const classified = [
    ...normalizedRanges,
    ...[...ownerOrdinals].map((ordinal) => ({ first: ordinal, last: ordinal }))
  ].sort((left, right) => left.first - right.first || left.last - right.last)
  let nextExpected = 1
  for (const range of classified) {
    if (range.first !== nextExpected) {
      throw new CheckpointStoreError(
        'content-mismatch',
        'Host snapshot left an allocated delivery attempt unowned and unretired.'
      )
    }
    nextExpected = range.last + 1
  }
  if (nextExpected !== retirement.nextDeliveryAttemptOrdinal) {
    throw new CheckpointStoreError(
      'content-mismatch',
      'Host snapshot does not classify every allocated delivery attempt.'
    )
  }
  return {
    ...retirement,
    retiredOrdinalRanges: normalizedRanges,
    owners: [...snapshot.owners]
  }
}

function normalizeRetiredOrdinalRanges(
  ranges: readonly Readonly<{ first: number; last: number }>[]
): Array<{ first: number; last: number }> {
  const output: Array<{ first: number; last: number }> = []
  for (const current of [...ranges].sort((left, right) => left.first - right.first || left.last - right.last)) {
    const previous = output.at(-1)
    if (!previous || current.first > previous.last + 1) {
      output.push({ first: current.first, last: current.last })
      continue
    }
    previous.last = Math.max(previous.last, current.last)
  }
  return output
}

function ordinalIsRetired(
  ranges: readonly Readonly<{ first: number; last: number }>[],
  ordinal: number
): boolean {
  return ranges.some((range) => ordinal >= range.first && ordinal <= range.last)
}

function turnBoundaryBindings(
  store: CheckpointStoreFile,
  recordingId: string,
  capturedAt: string
): z.infer<typeof turnBoundaryOutputBindingSchema>[] {
  const bindings = new Map(store.workspaceFileBindings.map((binding) => [
    binding.path,
    turnBoundaryOutputBindingSchema.parse(binding)
  ]))
  const defaultAccessPolicy = {
    visibility: 'workspace' as const,
    principals: [] as string[],
    allowExport: false
  }
  for (const operation of store.operations) {
    if (operation.recordingId !== recordingId) {
      if (
        (operation.state === 'pending' || operation.state === 'stale-conflict') &&
        operation.filePlans.length > 0
      ) {
        throw new CheckpointPredecessorError(
          operation.operationId,
          operation.state,
          'Another recording has an unresolved workspace output predecessor.'
        )
      }
      continue
    }
    if (operation.state === 'stale-conflict') {
      throw new CheckpointPredecessorError(
        operation.operationId,
        'stale-conflict',
        'A stale checkpoint predecessor must be resolved before another turn starts.'
      )
    }
    if (operation.state !== 'pending') continue
    for (const plan of operation.filePlans) {
      if (!operation.observedPaths.includes(plan.path)) {
        throw new CheckpointPredecessorError(
          operation.operationId,
          'pending',
          'A pending checkpoint predecessor has not durably verified all output bytes.'
        )
      }
      if (!plan.artifactId || plan.terminalSnapshot?.dataBase64 === undefined) continue
      const bytes = Buffer.from(plan.terminalSnapshot.dataBase64, 'base64')
      if (
        bytes.byteLength !== plan.terminalSnapshot.byteLength ||
        sha256(bytes) !== plan.terminalSnapshot.contentDigest
      ) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Pending output predecessor bytes changed before the next turn boundary.'
        )
      }
      bindings.set(plan.path, turnBoundaryOutputBindingSchema.parse({
        path: plan.path,
        ref: {
          artifactId: plan.artifactId,
          versionId: outputVersionId(operation.operationId, plan.path),
          contentDigest: plan.terminalSnapshot.contentDigest,
          byteLength: plan.terminalSnapshot.byteLength,
          ...(plan.terminalSnapshot.mediaType ? { mediaType: plan.terminalSnapshot.mediaType } : {}),
          availability: 'available',
          retention: 'snapshot',
          accessPolicy: plan.accessPolicy ?? defaultAccessPolicy
        },
        currentOrdinal: (plan.expectedCurrentOrdinal ?? 0) + 1,
        updatedAt: capturedAt,
        predecessorOperationId: operation.operationId,
        dataBase64: plan.terminalSnapshot.dataBase64
      }))
    }
  }
  return [...bindings.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function withAutomaticRecordingPolicy(
  store: CheckpointStoreFile,
  policy: z.infer<typeof automaticRecordingPolicySchema>
): CheckpointStoreFile {
  return {
    ...store,
    automaticRecordingPolicies: [
      ...store.automaticRecordingPolicies.filter((item) => !(
        item.runtimeId === policy.runtimeId && item.threadId === policy.threadId
      )),
      automaticRecordingPolicySchema.parse(policy)
    ]
  }
}

function automaticRecordingPolicy(
  store: CheckpointStoreFile,
  runtimeId: string,
  threadId: string
): z.infer<typeof automaticRecordingPolicySchema> {
  return store.automaticRecordingPolicies.find((item) => (
    item.runtimeId === runtimeId && item.threadId === threadId
  )) ?? {
    runtimeId,
    threadId,
    automaticEnabled: true,
    revision: 0,
    updatedAt: '1970-01-01T00:00:00.000Z'
  }
}

function nextAutomaticPolicyOperationOrdinal(store: CheckpointStoreFile): number {
  const ordinal = store.automaticPolicyOperationOrdinal + 1
  if (!Number.isSafeInteger(ordinal)) {
    throw new CheckpointStoreError(
      'content-mismatch',
      'Automatic recording policy operation sequence is exhausted.'
    )
  }
  return ordinal
}

function withAutomaticPolicyReceipt(
  store: CheckpointStoreFile,
  receipt: z.infer<typeof automaticPolicyReceiptSchema>,
  maxReceiptsPerScope: number,
  maxReceipts: number
): CheckpointStoreFile {
  const sameScope = [...store.automaticPolicyReceipts, receipt]
    .filter((item) => (
      item.runtimeId === receipt.runtimeId && item.threadId === receipt.threadId
    ))
    .sort((left, right) => (
      right.operationOrdinal - left.operationOrdinal
    ))
    .slice(0, maxReceiptsPerScope)
  const globallyBounded = [
    ...store.automaticPolicyReceipts.filter((item) => !(
      item.runtimeId === receipt.runtimeId && item.threadId === receipt.threadId
    )),
    ...sameScope
  ].sort((left, right) => (
    right.operationOrdinal - left.operationOrdinal
  )).slice(0, maxReceipts)
  return {
    ...store,
    automaticPolicyReceipts: globallyBounded
  }
}

function staleAutomaticPolicyRevision(): CheckpointStoreError {
  return new CheckpointStoreError(
    'content-mismatch',
    'Automatic recording policy revision is stale or was not observed from canonical status.'
  )
}

function findLatestRecordingIndex(
  recordings: readonly PrivateRecording[],
  runtimeId: string,
  threadId: string,
  recordingId?: string
): number {
  for (let index = recordings.length - 1; index >= 0; index -= 1) {
    const recording = recordings[index]!
    if (
      recording.runtimeId === runtimeId &&
      recording.threadId === threadId &&
      (!recordingId || recording.recordingId === recordingId)
    ) return index
  }
  return -1
}

function compactLegacyCommittedOperations(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.operations)) return value
  let migrated = false
  const operations = record.operations.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
    const operation = candidate as Record<string, unknown>
    if (operation.state !== 'committed' || !Array.isArray(operation.filePlans)) return candidate
    const filePlans = operation.filePlans.map((plan) => {
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return plan
      const compacted = compactCommittedFilePlan(plan as CheckpointFilePlan)
      if (JSON.stringify(compacted) !== JSON.stringify(plan)) migrated = true
      return compacted
    })
    let manifest = operation.manifest
    let manifestStorage = operation.manifestStorage
    let committedStatus = operation.committedStatus
    if (manifestStorage !== 'summary') {
      const parsedManifest = researchCheckpointManifestV1Schema.safeParse(manifest)
      if (parsedManifest.success) {
        const ref = artifactVersionRefV1Schema.safeParse(operation.ref)
        if (
          ref.success &&
          typeof operation.ordinal === 'number' &&
          typeof operation.runtimeId === 'string' &&
          typeof operation.threadId === 'string' &&
          typeof operation.turnId === 'string' &&
          typeof operation.recordingId === 'string' &&
          typeof operation.operationId === 'string' &&
          (operation.changeKind === 'new' || operation.changeKind === 'updated') &&
          typeof operation.attempts === 'number' &&
          typeof operation.createdAt === 'string' &&
          typeof operation.updatedAt === 'string'
        ) {
          committedStatus = committedOperationStatus(
            operation as Pick<CheckpointOperation,
              'runtimeId' | 'threadId' | 'turnId' | 'recordingId' | 'operationId' |
              'changeKind' | 'attempts' | 'createdAt' | 'updatedAt'>,
            parsedManifest.data,
            ref.data,
            operation.ordinal
          )
        }
        manifest = compactCommittedManifest(parsedManifest.data)
        manifestStorage = 'summary'
        migrated = true
      }
    }
    return migrated
      ? { ...operation, filePlans, manifest, manifestStorage, committedStatus }
      : candidate
  })
  return migrated ? { ...record, operations } : value
}

function compactCommittedManifest(
  manifest: ResearchCheckpointManifestV1
): ResearchCheckpointManifestV1 {
  const canonicalText = `Committed manifest sha256:${sha256(canonicalJson(manifest))}`
  const legacy = manifest.recording.origin === 'legacy-import'
  return researchCheckpointManifestV1Schema.parse({
    ...manifest,
    title: `Checkpoint ${sha256(manifest.title).slice(0, 12)}`,
    changeReason: `Committed reason sha256:${sha256(manifest.changeReason)}`,
    narrative: {
      canonicalText,
      contentDigest: sha256(canonicalText)
    },
    sources: [],
    declaredFiles: [],
    artifactDependencies: [],
    computeRuns: [],
    gitCheckpoints: [],
    untrackedOperations: legacy
      ? [{ kind: 'ambient-command', summary: 'Legacy import remains untracked.' }]
      : [],
    breakpoints: legacy
      ? [{ code: 'legacy-import-untracked', blocking: true, message: 'Legacy import remains untracked.' }]
      : [],
    status: legacy
      ? manifest.status
      : {
          ...manifest.status,
          provenance: manifest.status.provenance,
          control: manifest.status.control,
          reproduction: manifest.status.reproduction,
          evidence: manifest.status.evidence
        }
  })
}

function compactCommittedFilePlan<Plan extends CheckpointFilePlan>(plan: Plan): Plan {
  const terminalSnapshot = plan.terminalSnapshot
    ? {
        contentDigest: plan.terminalSnapshot.contentDigest,
        byteLength: plan.terminalSnapshot.byteLength,
        ...(plan.terminalSnapshot.mediaType ? { mediaType: plan.terminalSnapshot.mediaType } : {})
      }
    : undefined
  const compacted = {
    ...plan,
    patchReceipts: undefined,
    expectedCurrentDataBase64: undefined,
    ...(terminalSnapshot ? { terminalSnapshot } : {})
  }
  return compacted as Plan
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function deriveLegacyWorkspaceFileBindings(
  operations: readonly CheckpointOperation[]
): z.infer<typeof workspaceFileBindingSchema>[] {
  const byPath = new Map<string, z.infer<typeof workspaceFileBindingSchema>>()
  for (const operation of operations
    .filter((item) => item.state === 'committed')
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
    for (const file of operation.manifest.declaredFiles) {
      if (!file.artifactVersionRef || !file.artifactOrdinal) continue
      byPath.set(file.path, workspaceFileBindingSchema.parse({
        path: file.path,
        ref: file.artifactVersionRef,
        currentOrdinal: file.artifactOrdinal,
        updatedAt: operation.updatedAt
      }))
    }
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export class CheckpointStoreError extends Error {
  readonly code: 'not-found' | 'scope-mismatch' | 'content-mismatch'

  constructor(code: CheckpointStoreError['code'], message: string) {
    super(message)
    this.name = 'CheckpointStoreError'
    this.code = code
  }
}

export class CheckpointPredecessorError extends Error {
  readonly operationId: string
  readonly state: 'pending' | 'stale-conflict'

  constructor(
    operationIdValue: string,
    state: CheckpointPredecessorError['state'],
    message: string
  ) {
    super(message)
    this.name = 'CheckpointPredecessorError'
    this.operationId = operationIdValue
    this.state = state
  }
}

function sameWorkspace(left: string, right: string): boolean {
  return workspaceBindingDigest(left) === workspaceBindingDigest(right)
}

function publicRecording(value: PrivateRecording): ResearchRecordingStatusV1 {
  const {
    workspaceRoot: _workspaceRoot,
    startIdempotencyReceipts: _startIdempotencyReceipts,
    initialChangeReason: _initialChangeReason,
    startWatermark: _startWatermark,
    startKnownTurnIds: _startKnownTurnIds,
    stopWatermark: _stopWatermark,
    stopKnownTurnIds: _stopKnownTurnIds,
    fileBindings: _fileBindings,
    ...publicValue
  } = value
  return researchRecordingStatusV1Schema.parse(publicValue)
}

function latestRecording(
  recordings: readonly PrivateRecording[],
  runtimeId: string,
  threadId: string,
  state?: PrivateRecording['state']
): PrivateRecording | undefined {
  return recordings
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.runtimeId === runtimeId && item.threadId === threadId)
    .filter(({ item }) => !state || item.state === state)
    .sort((left, right) => (
      right.item.createdAt.localeCompare(left.item.createdAt) || right.index - left.index
    ))[0]?.item
}

function publicOperationStatus(operation: CheckpointOperation): ResearchCheckpointTurnStatusV1 {
  const base = {
    state: operation.state,
    runtimeId: operation.runtimeId,
    threadId: operation.threadId,
    turnId: operation.turnId,
    recordingId: operation.recordingId,
    operationId: operation.operationId,
    changeReason: operation.manifest.changeReason,
    attempts: operation.attempts,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt
  }
  if (operation.state === 'committed') {
    return operation.committedStatus ?? committedOperationStatus(
      operation,
      operation.manifest,
      operation.ref!,
      operation.ordinal!
    )
  }
  if (operation.state === 'stale-conflict') {
    return researchCheckpointTurnStatusV1Schema.parse({
      ...base,
      state: 'stale-conflict',
      error: operation.error ?? 'The checkpoint current Version changed before commit.',
      retryable: true
    })
  }
  if (operation.state === 'failed') {
    return researchCheckpointTurnStatusV1Schema.parse({
      ...base,
      state: 'failed',
      error: operation.error ?? 'Research checkpoint commit failed.',
      retryable: operation.retryable ?? false
    })
  }
  return researchCheckpointTurnStatusV1Schema.parse({ ...base, state: 'pending' })
}

function committedOperationStatus(
  operation: Pick<CheckpointOperation,
    'runtimeId' | 'threadId' | 'turnId' | 'recordingId' | 'operationId' |
    'changeKind' | 'attempts' | 'createdAt' | 'updatedAt'>,
  manifest: ResearchCheckpointManifestV1,
  ref: ArtifactVersionRefV1,
  ordinal: number
): ResearchCheckpointCommittedTurnStatusV1 {
  return researchCheckpointCommittedTurnStatusV1Schema.parse({
    state: 'committed',
    runtimeId: operation.runtimeId,
    threadId: operation.threadId,
    turnId: operation.turnId,
    recordingId: operation.recordingId,
    operationId: operation.operationId,
    changeReason: manifest.changeReason,
    attempts: operation.attempts,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    changeKind: operation.changeKind,
    title: manifest.title,
    artifactRef: ref,
    ordinal,
    inputs: summaryItems(manifest, 'input'),
    outputs: summaryItems(manifest, 'output'),
    outputArtifacts: outputArtifactItems(manifest),
    reproduction: { status: manifest.status.reproduction },
    provenance: { status: manifest.status.provenance },
    control: { status: manifest.status.control },
    untrackedOperationCount: manifest.untrackedOperations.length,
    evidence: { status: manifest.status.evidence }
  })
}

type CheckpointRecordEntry = Readonly<{
  cursor: string
  recordingId: string
  createdAt: string
  record: ResearchCheckpointRecordV1
}>

function newestRecordEntry(left: CheckpointRecordEntry, right: CheckpointRecordEntry): number {
  return right.createdAt.localeCompare(left.createdAt) || right.cursor.localeCompare(left.cursor)
}

function sameRestoredContent(source: ArtifactVersionRefV1, restored: ArtifactVersionRefV1): boolean {
  return source.artifactId === restored.artifactId &&
    source.contentDigest === restored.contentDigest &&
    source.byteLength === restored.byteLength &&
    source.mediaType === restored.mediaType &&
    source.retention === restored.retention &&
    canonicalJson(source.accessPolicy) === canonicalJson(restored.accessPolicy)
}

function restoredOperationRecord(
  restore: CheckpointRestoreOperation,
  source: ResearchCheckpointRecordV1,
  restoredRef: ArtifactVersionRefV1,
  ordinal: number,
  timestamp: string
): ResearchCheckpointRecordV1 {
  return researchCheckpointRecordV1Schema.parse({
    manifest: source.manifest,
    status: {
      ...source.status,
      changeKind: 'updated',
      artifactRef: restoredRef,
      ordinal,
      createdAt: timestamp,
      updatedAt: timestamp,
      evidence: {
        status: source.manifest.recording.origin === 'legacy-import' ? 'unavailable' : 'pending'
      }
    },
    projection: {
      kind: 'restore',
      restoreOperationId: restore.restoreOperationId,
      sourceVersionId: restore.sourceVersionId,
      sourceRecordId: source.status.operationId
    }
  })
}

function summaryItems(
  manifest: ResearchCheckpointManifestV1,
  direction: 'input' | 'output'
): string[] {
  const roles = direction === 'input'
    ? new Set(['input', 'source', 'code'])
    : new Set(['output', 'compute', 'plot'])
  const values = [
    ...manifest.declaredFiles
      .filter((item) => direction === 'input' ? item.role === 'input' : item.role !== 'input')
      .map((item) => item.path),
    ...manifest.artifactDependencies
      .filter((item) => roles.has(item.role))
      .map((item) => item.label ?? item.ref.versionId)
  ]
  return [...new Set(values)].slice(0, 1_024)
}

function outputArtifactItems(
  manifest: ResearchCheckpointManifestV1
): ResearchCheckpointCommittedTurnStatusV1['outputArtifacts'] {
  return manifest.declaredFiles
    .filter((item): item is typeof item & Readonly<{
      role: 'output' | 'generated' | 'modified'
      artifactVersionRef: ArtifactVersionRefV1
      artifactOrdinal: number
    }> => (
      item.role !== 'input' &&
      item.capture === 'host-turn-boundary-exact' &&
      Boolean(item.artifactVersionRef) &&
      Boolean(item.artifactOrdinal)
    ))
    .map((item) => ({
      path: item.path,
      role: item.role,
      capture: 'host-turn-boundary-exact' as const,
      artifactOrdinal: item.artifactOrdinal,
      ref: item.artifactVersionRef
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 1_024)
}

function newestOperation(left: CheckpointOperation, right: CheckpointOperation): number {
  return right.createdAt.localeCompare(left.createdAt) || right.operationId.localeCompare(left.operationId)
}

function scopeMismatch(): CheckpointStoreError {
  return new CheckpointStoreError('scope-mismatch', 'Research checkpoint state belongs to another workspace.')
}

function idempotencyMismatch(): CheckpointStoreError {
  return new CheckpointStoreError(
    'content-mismatch',
    'Research checkpoint idempotency key was already bound to different request semantics.'
  )
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

export type { CheckpointFilePlan }
