import { z } from 'zod'
import {
  artifactVersionRefV1Schema,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk/contract'

export const RESEARCH_CHECKPOINT_CONTRACT_VERSION = 1 as const
export const RESEARCH_CHECKPOINT_MANIFEST_KIND =
  'sciforge.research-checkpoint-manifest.v1' as const
export const RESEARCH_CHECKPOINT_TEXT_SANITIZATION_POLICY =
  'credential-redaction-v1' as const
export const RESEARCH_CHECKPOINT_SOURCE_URL_POLICY =
  'http-origin-path-safe-query-v1' as const

export const RESEARCH_CHECKPOINT_CAPABILITY_IDS = Object.freeze({
  start: 'research-checkpoints.start',
  stop: 'research-checkpoints.stop',
  status: 'research-checkpoints.status',
  read: 'research-checkpoints.read',
  list: 'research-checkpoints.list',
  turnStatus: 'research-checkpoints.turn-status',
  resolve: 'research-checkpoints.resolve',
  restoreAsNew: 'research-checkpoints.restore-as-new',
  previewLegacy: 'research-checkpoints.legacy.preview',
  importLegacy: 'research-checkpoints.legacy.import'
} as const)

const identifierSchema = z.string().trim().regex(/^[A-Za-z0-9._:@/-]{1,512}$/)
const runtimeIdSchema = z.string().trim().min(1).max(128)
const threadIdSchema = z.string().trim().min(1).max(512)
const turnIdSchema = z.string().trim().min(1).max(512)
const recordingIdSchema = z.string().trim()
  .regex(/^research-recording:[A-Za-z0-9._:-]{1,220}$/)
const operationIdSchema = z.string().trim()
  .regex(/^research-checkpoint-operation:[a-f0-9]{64}$/)
const restoreOperationIdSchema = z.string().trim()
  .regex(/^research-checkpoint-restore:[a-f0-9]{64}$/)
const recordCursorSchema = z.union([operationIdSchema, restoreOperationIdSchema])
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const timestampSchema = z.iso.datetime({ offset: true })
const titleSchema = z.string().trim().min(1).max(512)
const changeReasonSchema = z.string().trim().min(1).max(2_000)
const relativePathSchema = z.string().trim().min(1).max(8_192).superRefine((value, context) => {
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    context.addIssue({ code: 'custom', message: 'Checkpoint file paths must be normalized workspace-relative paths.' })
  }
})

export const researchCheckpointOriginV1Schema = z.enum(['live', 'legacy-import'])
export const researchRecordingStateV1Schema = z.enum(['active', 'stopped'])

export const researchCheckpointBreakpointV1Schema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,127}$/),
  blocking: z.boolean(),
  message: z.string().trim().min(1).max(4_000),
  itemId: identifierSchema.optional(),
  detail: domainPackageJsonValueSchema.optional()
}).strict()

export const researchCheckpointSourceV1Schema = z.object({
  sourceId: identifierSchema,
  uri: z.string().trim().min(1).max(16_384).refine(
    (value) => !/^file:/iu.test(value) && !value.startsWith('/'),
    { message: 'Source URIs must not expose an absolute Host path.' }
  ),
  title: z.string().trim().min(1).max(1_024).optional(),
  contentDigest: sha256Schema.optional(),
  artifactVersionRef: artifactVersionRefV1Schema.optional()
}).strict()

export const researchCheckpointDeclaredFileV1Schema = z.object({
  path: relativePathSchema,
  role: z.enum(['input', 'output', 'generated', 'modified']),
  capture: z.enum(['declared-exact', 'observed-after-turn', 'host-turn-boundary-exact']),
  artifactOrdinal: z.number().int().positive().optional(),
  contentDigest: sha256Schema.optional(),
  byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  mediaType: z.string().trim().regex(/^[^\s/]+\/[^\s/]+$/).max(256).optional(),
  artifactVersionRef: artifactVersionRefV1Schema.optional()
}).strict()

export const researchCheckpointArtifactDependencyV1Schema = z.object({
  role: z.enum(['input', 'output', 'source', 'code', 'compute', 'plot', 'other']),
  label: z.string().trim().min(1).max(1_024).optional(),
  ref: artifactVersionRefV1Schema
}).strict()

export const researchCheckpointComputeRunRefV1Schema = z.object({
  runId: z.string().trim().regex(/^compute-run:[A-Za-z0-9._:-]{1,240}$/),
  specRef: artifactVersionRefV1Schema.optional(),
  receiptRef: artifactVersionRefV1Schema.optional()
}).strict().superRefine((value, context) => {
  if (!value.specRef && !value.receiptRef) {
    context.addIssue({
      code: 'custom',
      message: 'A Compute run reference requires an exact spec or receipt Artifact Version.'
    })
  }
})

export const researchCheckpointGitRefV1Schema = z.object({
  checkpointId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,200}$/),
  provider: z.string().trim().min(1).max(128),
  revision: z.string().trim().min(1).max(512)
}).strict()

export const researchCheckpointUntrackedOperationV1Schema = z.object({
  kind: z.enum(['terminal', 'ambient-command', 'editor-change', 'unknown']),
  itemId: identifierSchema.optional(),
  summary: z.string().trim().min(1).max(4_000).optional()
}).strict()

export const researchCheckpointFiveAxisStatusV1Schema = z.object({
  execution: z.enum([
    'not-applicable',
    'observed-untracked',
    'formal-references-present',
    'mixed'
  ]),
  provenance: z.enum(['pending', 'complete', 'incomplete']),
  control: z.enum(['untracked', 'partial', 'isolated-attested']),
  reproduction: z.enum([
    'not-run',
    'eligible',
    'replicates',
    'fails-to-replicate',
    'inconclusive'
  ]),
  evidence: z.enum(['pending', 'committed', 'stale', 'needs-review', 'unavailable'])
}).strict()

export const researchCheckpointPrivacyV1Schema = z.object({
  textSanitization: z.literal(RESEARCH_CHECKPOINT_TEXT_SANITIZATION_POLICY),
  sourceUrlPolicy: z.literal(RESEARCH_CHECKPOINT_SOURCE_URL_POLICY),
  opaqueSecretSanitization: z.enum(['host-settings', 'unavailable'])
}).strict()

export const researchCheckpointManifestV1Schema = z.object({
  contractVersion: z.literal(RESEARCH_CHECKPOINT_CONTRACT_VERSION),
  kind: z.literal(RESEARCH_CHECKPOINT_MANIFEST_KIND),
  recording: z.object({
    recordingId: recordingIdSchema,
    origin: researchCheckpointOriginV1Schema,
    runtimeId: runtimeIdSchema,
    threadId: threadIdSchema,
    workspaceBindingDigest: sha256Schema
  }).strict(),
  turn: z.object({
    turnId: turnIdSchema,
    targetWatermark: z.string().trim().min(1).max(1_024),
    sequence: z.number().int().nonnegative().optional(),
    occurredAt: timestampSchema
  }).strict(),
  title: titleSchema,
  changeReason: changeReasonSchema,
  narrative: z.object({
    canonicalText: z.string().max(16 * 1024 * 1024),
    contentDigest: sha256Schema
  }).strict(),
  sources: z.array(researchCheckpointSourceV1Schema).max(10_000),
  declaredFiles: z.array(researchCheckpointDeclaredFileV1Schema).max(10_000),
  artifactDependencies: z.array(researchCheckpointArtifactDependencyV1Schema).max(1_024),
  computeRuns: z.array(researchCheckpointComputeRunRefV1Schema).max(10_000),
  gitCheckpoints: z.array(researchCheckpointGitRefV1Schema).max(10_000),
  untrackedOperations: z.array(researchCheckpointUntrackedOperationV1Schema).max(10_000),
  breakpoints: z.array(researchCheckpointBreakpointV1Schema).max(10_000),
  status: researchCheckpointFiveAxisStatusV1Schema,
  /** Optional only for backward-compatible reads of records created before the privacy boundary. */
  privacy: researchCheckpointPrivacyV1Schema.optional(),
  importedTranscriptDigest: sha256Schema.optional(),
  importedTurnIds: z.array(turnIdSchema).min(1).max(100_000).optional()
}).strict().superRefine((value, context) => {
  if (value.recording.origin === 'legacy-import') {
    if (!(value.importedTranscriptDigest && value.importedTurnIds?.length)) {
      context.addIssue({
        code: 'custom',
        path: ['importedTranscriptDigest'],
        message: 'Legacy imports require an immutable transcript digest and explicit turn selection.'
      })
    }
    if (
      value.computeRuns.length > 0 ||
      value.artifactDependencies.length > 0 ||
      value.sources.some((item) => Boolean(item.contentDigest || item.artifactVersionRef)) ||
      value.declaredFiles.length > 0 ||
      value.gitCheckpoints.length > 0 ||
      value.untrackedOperations.length === 0 ||
      !value.breakpoints.some((item) => item.blocking) ||
      value.status.execution !== 'observed-untracked' ||
      value.status.provenance !== 'incomplete' ||
      value.status.control !== 'untracked' ||
      value.status.reproduction !== 'not-run' ||
      value.status.evidence !== 'unavailable'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Legacy imports must remain blocking, untracked, incomplete, unavailable, and free of formal references.'
      })
    }
  } else if (value.importedTranscriptDigest || value.importedTurnIds) {
    context.addIssue({
      code: 'custom',
      path: ['importedTranscriptDigest'],
      message: 'Live checkpoints cannot carry legacy transcript import fields.'
    })
  }
  if (value.status.provenance === 'complete' && value.breakpoints.some((item) => item.blocking)) {
    context.addIssue({
      code: 'custom',
      path: ['status', 'provenance'],
      message: 'Complete provenance cannot contain a blocking breakpoint.'
    })
  }
})

export const researchRecordingStatusV1Schema = z.object({
  recordingId: recordingIdSchema,
  origin: researchCheckpointOriginV1Schema,
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  title: titleSchema,
  state: researchRecordingStateV1Schema,
  versionCount: z.number().int().nonnegative(),
  artifactId: z.string().trim().startsWith('artifact:').optional(),
  currentVersionId: z.string().trim().startsWith('artifact-version:').optional(),
  currentContentDigest: sha256Schema.optional(),
  currentOrdinal: z.number().int().positive().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  stoppedAt: timestampSchema.optional()
}).strict().superRefine((value, context) => {
  const bound = Boolean(value.artifactId || value.currentVersionId || value.currentContentDigest)
  if (bound && !(value.artifactId && value.currentVersionId && value.currentContentDigest)) {
    context.addIssue({ code: 'custom', message: 'A recording Artifact binding must be exact.' })
  }
  if (value.versionCount === 0 && bound) {
    context.addIssue({ code: 'custom', message: 'An unversioned recording cannot have an Artifact binding.' })
  }
})

export const researchCheckpointTurnStateV1Schema = z.enum([
  'unrecorded',
  'pending',
  'committed',
  'stale-conflict',
  'failed'
])

const turnScopeSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  turnId: turnIdSchema
}).strict()

const operationStatusBaseSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  turnId: turnIdSchema,
  recordingId: recordingIdSchema,
  operationId: operationIdSchema,
  changeReason: changeReasonSchema,
  attempts: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export const researchCheckpointCommittedTurnStatusV1Schema = operationStatusBaseSchema.extend({
  state: z.literal('committed'),
  changeKind: z.enum(['new', 'updated']),
  title: titleSchema,
  artifactRef: artifactVersionRefV1Schema,
  ordinal: z.number().int().positive(),
  inputs: z.array(z.string().trim().min(1).max(1_024)).max(1_024),
  outputs: z.array(z.string().trim().min(1).max(1_024)).max(1_024),
  outputArtifacts: z.array(z.object({
    path: relativePathSchema,
    role: z.enum(['output', 'generated', 'modified']),
    capture: z.literal('host-turn-boundary-exact'),
    artifactOrdinal: z.number().int().positive(),
    ref: artifactVersionRefV1Schema
  }).strict()).max(1_024),
  reproduction: z.object({
    status: researchCheckpointFiveAxisStatusV1Schema.shape.reproduction
  }).strict(),
  provenance: z.object({
    status: researchCheckpointFiveAxisStatusV1Schema.shape.provenance
  }).strict(),
  control: z.object({
    status: researchCheckpointFiveAxisStatusV1Schema.shape.control
  }).strict(),
  untrackedOperationCount: z.number().int().nonnegative(),
  evidence: z.object({
    status: researchCheckpointFiveAxisStatusV1Schema.shape.evidence
  }).strict()
}).strict()

export const researchCheckpointTurnStatusV1Schema = z.discriminatedUnion('state', [
  turnScopeSchema.extend({ state: z.literal('unrecorded') }).strict(),
  operationStatusBaseSchema.extend({ state: z.literal('pending') }).strict(),
  researchCheckpointCommittedTurnStatusV1Schema,
  operationStatusBaseSchema.extend({
    state: z.literal('stale-conflict'),
    error: z.string().trim().min(1).max(4_000),
    retryable: z.literal(true)
  }).strict(),
  operationStatusBaseSchema.extend({
    state: z.literal('failed'),
    error: z.string().trim().min(1).max(4_000),
    retryable: z.boolean()
  }).strict()
])

export const researchCheckpointRecordProjectionV1Schema = z.object({
  kind: z.literal('restore'),
  restoreOperationId: restoreOperationIdSchema,
  sourceVersionId: z.string().trim().startsWith('artifact-version:'),
  sourceRecordId: operationIdSchema
}).strict()

export const researchCheckpointRecordV1Schema = z.object({
  manifest: researchCheckpointManifestV1Schema,
  status: researchCheckpointCommittedTurnStatusV1Schema,
  projection: researchCheckpointRecordProjectionV1Schema.optional()
}).strict().superRefine((value, context) => {
  if (
    value.projection?.kind === 'restore' &&
    value.projection.sourceVersionId === value.status.artifactRef.versionId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['projection', 'sourceVersionId'],
      message: 'A restored checkpoint projection must reference an earlier exact Version.'
    })
  }
})

export const researchCheckpointStartInputV1Schema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  expectedPolicyRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(512),
  title: titleSchema.optional(),
  changeReason: changeReasonSchema.optional()
}).strict()

export const researchCheckpointStartReceiptV1Schema = z.object({
  created: z.boolean(),
  policyRevision: z.number().int().positive(),
  recording: researchRecordingStatusV1Schema
}).strict()

export const researchCheckpointStopInputV1Schema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  expectedPolicyRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(512),
  recordingId: recordingIdSchema.optional()
}).strict()

export const researchCheckpointStopReceiptV1Schema = z.object({
  policyRevision: z.number().int().positive(),
  recording: researchRecordingStatusV1Schema.nullable()
}).strict()

export const researchCheckpointResolveInputV1Schema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  recordingId: recordingIdSchema,
  operationId: operationIdSchema,
  resolution: z.enum(['rebase', 'discard']),
  idempotencyKey: z.string().trim().min(8).max(512)
}).strict()

export const researchCheckpointResolveReceiptV1Schema = z.object({
  resolution: z.enum(['rebase', 'discard']),
  status: researchCheckpointTurnStatusV1Schema
}).strict()

export const researchCheckpointRestoreAsNewInputV1Schema = z.object({
  recordingId: recordingIdSchema,
  artifactId: z.string().trim().startsWith('artifact:'),
  sourceVersionId: z.string().trim().startsWith('artifact-version:'),
  expectedCurrentVersionId: z.string().trim().startsWith('artifact-version:'),
  idempotencyKey: z.string().trim().min(8).max(512)
}).strict()

export const researchCheckpointRestoreAsNewReceiptV1Schema = z.object({
  recording: researchRecordingStatusV1Schema,
  restoredRef: artifactVersionRefV1Schema,
  ordinal: z.number().int().positive(),
  transactionId: z.string().trim().startsWith('artifact-commit:'),
  idempotentReplay: z.boolean()
}).strict().superRefine((value, context) => {
  if (
    value.recording.artifactId !== value.restoredRef.artifactId ||
    value.recording.currentVersionId !== value.restoredRef.versionId ||
    value.recording.currentContentDigest !== value.restoredRef.contentDigest ||
    value.recording.currentOrdinal !== value.ordinal
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Restore receipt must exactly match the adopted recording current Version.'
    })
  }
})

export const researchCheckpointStatusInputV1Schema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema
}).strict()

export const researchCheckpointStatusV1Schema = z.object({
  recordingMode: z.literal('automatic'),
  automaticEnabled: z.boolean(),
  policyRevision: z.number().int().nonnegative(),
  recording: researchRecordingStatusV1Schema.nullable()
}).strict()

export const researchCheckpointTurnStatusInputV1Schema = turnScopeSchema

export const researchCheckpointReadInputV1Schema = z.object({
  recordingId: recordingIdSchema.optional(),
  versionId: z.string().trim().startsWith('artifact-version:').optional()
}).strict().superRefine((value, context) => {
  if (!value.recordingId && !value.versionId) {
    context.addIssue({ code: 'custom', message: 'Checkpoint read requires recordingId or exact versionId.' })
  }
})

export const researchCheckpointListInputV1Schema = z.object({
  runtimeId: runtimeIdSchema.optional(),
  threadId: threadIdSchema.optional(),
  recordingId: recordingIdSchema.optional(),
  cursor: recordCursorSchema.optional(),
  limit: z.number().int().positive().max(200).default(50)
}).strict()

export const researchCheckpointListV1Schema = z.object({
  records: z.array(researchCheckpointRecordV1Schema).max(200),
  nextCursor: recordCursorSchema.optional()
}).strict()

export const researchCheckpointLegacyImportInputV1Schema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  idempotencyKey: z.string().trim().min(8).max(512),
  title: titleSchema,
  // Legacy import is intentionally a two-step, user-selected operation. The
  // owner must always bind the mutation to the exact durable preview bytes;
  // an older renderer cannot bypass that integrity boundary by omitting it.
  expectedTranscriptDigest: sha256Schema,
  selectedTurnIds: z.array(turnIdSchema).min(1).max(100_000)
}).strict().superRefine((value, context) => {
  if (new Set(value.selectedTurnIds).size !== value.selectedTurnIds.length) {
    context.addIssue({ code: 'custom', path: ['selectedTurnIds'], message: 'Legacy selection turn IDs must be unique.' })
  }
})

export const researchCheckpointLegacyPreviewInputV1Schema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  selectedTurnIds: z.array(turnIdSchema).max(100_000).optional()
}).strict()

export const researchCheckpointLegacyPreviewTurnV1Schema = z.object({
  turnId: turnIdSchema,
  status: z.string().trim().min(1).max(128).optional(),
  completedAt: timestampSchema.optional(),
  summary: z.string().trim().min(1).max(600)
}).strict()

export const researchCheckpointLegacyPreviewV1Schema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  turns: z.array(researchCheckpointLegacyPreviewTurnV1Schema).max(100_000),
  selectedTurnIds: z.array(turnIdSchema).max(100_000),
  selectedTranscriptDigest: sha256Schema.nullable()
}).strict().superRefine((value, context) => {
  const availableTurnIds = new Set(value.turns.map((turn) => turn.turnId))
  if (availableTurnIds.size !== value.turns.length) {
    context.addIssue({ code: 'custom', path: ['turns'], message: 'Legacy preview turn IDs must be unique.' })
  }
  if (new Set(value.selectedTurnIds).size !== value.selectedTurnIds.length) {
    context.addIssue({ code: 'custom', path: ['selectedTurnIds'], message: 'Legacy selection turn IDs must be unique.' })
  }
  if (value.selectedTurnIds.some((turnId) => !availableTurnIds.has(turnId))) {
    context.addIssue({ code: 'custom', path: ['selectedTurnIds'], message: 'Legacy selection must reference previewed turns.' })
  }
  if ((value.selectedTurnIds.length === 0) !== (value.selectedTranscriptDigest === null)) {
    context.addIssue({
      code: 'custom',
      path: ['selectedTranscriptDigest'],
      message: 'A legacy transcript digest is required exactly when turns are selected.'
    })
  }
})

export const researchCheckpointIssueV1Schema = z.object({
  code: z.enum([
    'invalid-input',
    'not-found',
    'scope-mismatch',
    'recording-stopped',
    'stale-conflict',
    'artifact-unavailable',
    'content-mismatch',
    'io-failure',
    'internal'
  ]),
  message: z.string().trim().min(1).max(4_000),
  retryable: z.boolean(),
  details: domainPackageJsonValueSchema.optional()
}).strict()

export function researchCheckpointResultV1Schema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }).strict(),
    z.object({ ok: z.literal(false), issue: researchCheckpointIssueV1Schema }).strict()
  ])
}

export const researchCheckpointStartResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointStartReceiptV1Schema
)
export const researchCheckpointStopResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointStopReceiptV1Schema
)
export const researchCheckpointResolveResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointResolveReceiptV1Schema
)
export const researchCheckpointRestoreAsNewResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointRestoreAsNewReceiptV1Schema
)
export const researchCheckpointStatusResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointStatusV1Schema
)
export const researchCheckpointTurnStatusResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointTurnStatusV1Schema
)
export const researchCheckpointReadResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointRecordV1Schema
)
export const researchCheckpointListResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointListV1Schema
)
export const researchCheckpointLegacyPreviewResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointLegacyPreviewV1Schema
)
export const researchCheckpointLegacyImportResultV1Schema = researchCheckpointResultV1Schema(
  researchCheckpointCommittedTurnStatusV1Schema
)

export type ResearchCheckpointOriginV1 = z.infer<typeof researchCheckpointOriginV1Schema>
export type ResearchRecordingStateV1 = z.infer<typeof researchRecordingStateV1Schema>
export type ResearchCheckpointBreakpointV1 = z.infer<typeof researchCheckpointBreakpointV1Schema>
export type ResearchCheckpointSourceV1 = z.infer<typeof researchCheckpointSourceV1Schema>
export type ResearchCheckpointDeclaredFileV1 = z.infer<typeof researchCheckpointDeclaredFileV1Schema>
export type ResearchCheckpointArtifactDependencyV1 = z.infer<typeof researchCheckpointArtifactDependencyV1Schema>
export type ResearchCheckpointComputeRunRefV1 = z.infer<typeof researchCheckpointComputeRunRefV1Schema>
export type ResearchCheckpointGitRefV1 = z.infer<typeof researchCheckpointGitRefV1Schema>
export type ResearchCheckpointUntrackedOperationV1 = z.infer<typeof researchCheckpointUntrackedOperationV1Schema>
export type ResearchCheckpointFiveAxisStatusV1 = z.infer<typeof researchCheckpointFiveAxisStatusV1Schema>
export type ResearchCheckpointManifestV1 = z.infer<typeof researchCheckpointManifestV1Schema>
export type ResearchRecordingStatusV1 = z.infer<typeof researchRecordingStatusV1Schema>
export type ResearchCheckpointCommittedTurnStatusV1 = z.infer<typeof researchCheckpointCommittedTurnStatusV1Schema>
export type ResearchCheckpointOutputArtifactV1 = ResearchCheckpointCommittedTurnStatusV1['outputArtifacts'][number]
export type ResearchCheckpointTurnStatusV1 = z.infer<typeof researchCheckpointTurnStatusV1Schema>
export type ResearchCheckpointRecordProjectionV1 = z.infer<typeof researchCheckpointRecordProjectionV1Schema>
export type ResearchCheckpointRecordV1 = z.infer<typeof researchCheckpointRecordV1Schema>
export type ResearchCheckpointStartInputV1 = z.infer<typeof researchCheckpointStartInputV1Schema>
export type ResearchCheckpointStartReceiptV1 = z.infer<typeof researchCheckpointStartReceiptV1Schema>
export type ResearchCheckpointStopInputV1 = z.infer<typeof researchCheckpointStopInputV1Schema>
export type ResearchCheckpointStopReceiptV1 = z.infer<typeof researchCheckpointStopReceiptV1Schema>
export type ResearchCheckpointResolveInputV1 = z.infer<typeof researchCheckpointResolveInputV1Schema>
export type ResearchCheckpointResolveReceiptV1 = z.infer<typeof researchCheckpointResolveReceiptV1Schema>
export type ResearchCheckpointRestoreAsNewInputV1 = z.infer<typeof researchCheckpointRestoreAsNewInputV1Schema>
export type ResearchCheckpointRestoreAsNewReceiptV1 = z.infer<typeof researchCheckpointRestoreAsNewReceiptV1Schema>
export type ResearchCheckpointStatusInputV1 = z.infer<typeof researchCheckpointStatusInputV1Schema>
export type ResearchCheckpointStatusV1 = z.infer<typeof researchCheckpointStatusV1Schema>
export type ResearchCheckpointTurnStatusInputV1 = z.infer<typeof researchCheckpointTurnStatusInputV1Schema>
export type ResearchCheckpointReadInputV1 = z.infer<typeof researchCheckpointReadInputV1Schema>
export type ResearchCheckpointListInputV1 = z.input<typeof researchCheckpointListInputV1Schema>
export type ResearchCheckpointListV1 = z.infer<typeof researchCheckpointListV1Schema>
export type ResearchCheckpointLegacyPreviewInputV1 = z.infer<typeof researchCheckpointLegacyPreviewInputV1Schema>
export type ResearchCheckpointLegacyPreviewTurnV1 = z.infer<typeof researchCheckpointLegacyPreviewTurnV1Schema>
export type ResearchCheckpointLegacyPreviewV1 = z.infer<typeof researchCheckpointLegacyPreviewV1Schema>
export type ResearchCheckpointLegacyImportInputV1 = z.infer<typeof researchCheckpointLegacyImportInputV1Schema>
export type ResearchCheckpointIssueV1 = z.infer<typeof researchCheckpointIssueV1Schema>
export type ResearchCheckpointResultV1<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issue: ResearchCheckpointIssueV1 }>

export type { ArtifactVersionRefV1, DomainPackageJsonValue }
