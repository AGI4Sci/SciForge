import { z } from 'zod'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk/contract'
import type {
  DomainCapabilityContract,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'

export const ARTIFACT_VERSION_CONTRACT_VERSION = 1 as const
export const ARTIFACT_VERSION_BUNDLE_SCHEMA_VERSION = 1 as const

export const ARTIFACT_VERSIONS_CAPABILITY_IDS = Object.freeze({
  commit: 'artifact-versions.commit',
  observe: 'artifact-versions.observe',
  read: 'artifact-versions.read',
  list: 'artifact-versions.list',
  materialize: 'artifact-versions.materialize',
  restoreAsNew: 'artifact-versions.restore-as-new',
  compare: 'artifact-versions.compare',
  exportBundle: 'artifact-versions.bundle.export',
  importBundle: 'artifact-versions.bundle.import',
  verifyBundle: 'artifact-versions.bundle.verify',
  listEvents: 'artifact-versions.events.list',
  refresh: 'artifact-versions.lifecycle.refresh'
} as const)

const identifierSchema = z.string().trim().min(1).max(256)
const artifactIdSchema = identifierSchema.startsWith('artifact:')
const versionIdSchema = identifierSchema.startsWith('artifact-version:')
const candidateIdSchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{1,200}$/)
const transactionIdSchema = identifierSchema.startsWith('artifact-commit:')
const eventIdSchema = identifierSchema.startsWith('artifact-event:')
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const timestampSchema = z.iso.datetime({ offset: true })
const mediaTypeSchema = z.string().trim().regex(/^[^\s/]+\/[^\s/]+$/).max(256)
const base64Schema = z.string().max(128 * 1024 * 1024).regex(
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
)
const pathSchema = z.string().trim().min(1).max(8_192)
const metadataSchema = z.record(z.string().trim().min(1).max(256), domainPackageJsonValueSchema)

export const artifactVersionAvailabilityV1Schema = z.enum([
  'available',
  'missing',
  'remote'
])
export const artifactVersionRetentionV1Schema = z.enum(['snapshot', 'reference'])
export const artifactVersionIntentV1Schema = z.enum([
  'save',
  'observe',
  'rerun',
  'restore',
  'import',
  'publish'
])

export const artifactVersionAccessPolicyV1Schema = z.object({
  visibility: z.enum(['workspace', 'restricted', 'public']),
  principals: z.array(z.string().trim().min(1).max(512)).max(1_000),
  allowExport: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.visibility === 'restricted' && value.principals.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['principals'],
      message: 'Restricted access requires at least one principal.'
    })
  }
})

export const artifactVersionRefV1Schema = z.object({
  artifactId: artifactIdSchema,
  versionId: versionIdSchema,
  contentDigest: sha256Schema,
  byteLength: z.number().int().nonnegative(),
  mediaType: mediaTypeSchema.optional(),
  availability: artifactVersionAvailabilityV1Schema,
  retention: artifactVersionRetentionV1Schema,
  accessPolicy: artifactVersionAccessPolicyV1Schema
}).strict()

export const artifactVersionDependencyRefV1Schema = z.object({
  role: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  target: artifactVersionRefV1Schema,
  required: z.boolean()
}).strict()

export const artifactVersionCandidateDependencyV1Schema = z.object({
  role: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  required: z.boolean().optional(),
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('version'),
      ref: artifactVersionRefV1Schema
    }).strict(),
    z.object({
      kind: z.literal('candidate'),
      candidateId: candidateIdSchema
    }).strict()
  ])
}).strict()

export const artifactVersionCommitContentV1Schema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('snapshot'),
    dataBase64: base64Schema,
    mediaType: mediaTypeSchema.optional()
  }).strict(),
  z.object({
    mode: z.literal('reference'),
    locator: z.string().trim().min(1).max(8_192),
    contentDigest: sha256Schema,
    byteLength: z.number().int().nonnegative(),
    mediaType: mediaTypeSchema.optional(),
    availability: artifactVersionAvailabilityV1Schema.optional()
  }).strict()
])

export const artifactVersionCommitCandidateV1Schema = z.object({
  candidateId: candidateIdSchema,
  artifactId: artifactIdSchema.optional(),
  expectedCurrentVersionId: versionIdSchema.nullable(),
  kind: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  label: z.string().trim().min(1).max(512).optional(),
  intent: artifactVersionIntentV1Schema,
  content: artifactVersionCommitContentV1Schema,
  dependencies: z.array(artifactVersionCandidateDependencyV1Schema).max(1_024).optional(),
  accessPolicy: artifactVersionAccessPolicyV1Schema.optional(),
  metadata: metadataSchema.optional()
}).strict().superRefine((value, context) => {
  if (!value.artifactId && value.expectedCurrentVersionId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['expectedCurrentVersionId'],
      message: 'A new artifact must use a null expectedCurrentVersionId.'
    })
  }
  if (value.artifactId && value.expectedCurrentVersionId === null) {
    context.addIssue({
      code: 'custom',
      path: ['expectedCurrentVersionId'],
      message: 'An existing artifact requires its expected current version.'
    })
  }
})

export const artifactVersionCommitInputV1Schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  candidates: z.array(artifactVersionCommitCandidateV1Schema).min(1).max(128)
}).strict().superRefine((value, context) => {
  const candidateIds = new Set<string>()
  const artifactIds = new Set<string>()
  value.candidates.forEach((candidate, index) => {
    if (candidateIds.has(candidate.candidateId)) {
      context.addIssue({
        code: 'custom',
        path: ['candidates', index, 'candidateId'],
        message: `Duplicate candidateId: ${candidate.candidateId}`
      })
    }
    candidateIds.add(candidate.candidateId)
    if (candidate.artifactId) {
      if (artifactIds.has(candidate.artifactId)) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'artifactId'],
          message: `Only one candidate per existing artifact is allowed: ${candidate.artifactId}`
        })
      }
      artifactIds.add(candidate.artifactId)
    }
  })
})

export const artifactV1Schema = z.object({
  artifactId: artifactIdSchema,
  kind: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  label: z.string().trim().min(1).max(512).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  currentVersionId: versionIdSchema,
  versionCount: z.number().int().positive()
}).strict()

export const artifactVersionStorageV1Schema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('snapshot'),
    contentDigest: sha256Schema,
    byteLength: z.number().int().nonnegative(),
    mediaType: mediaTypeSchema.optional()
  }).strict(),
  z.object({
    mode: z.literal('reference'),
    locator: z.string().trim().min(1).max(8_192),
    contentDigest: sha256Schema,
    byteLength: z.number().int().nonnegative(),
    mediaType: mediaTypeSchema.optional(),
    availability: artifactVersionAvailabilityV1Schema
  }).strict()
])

export const artifactVersionV1Schema = z.object({
  schemaVersion: z.literal(ARTIFACT_VERSION_CONTRACT_VERSION),
  versionId: versionIdSchema,
  artifactId: artifactIdSchema,
  parentVersionId: versionIdSchema.optional(),
  sequence: z.number().int().positive(),
  transactionId: transactionIdSchema,
  createdAt: timestampSchema,
  intent: artifactVersionIntentV1Schema,
  storage: artifactVersionStorageV1Schema,
  dependencies: z.array(artifactVersionDependencyRefV1Schema).max(1_024),
  accessPolicy: artifactVersionAccessPolicyV1Schema,
  metadata: metadataSchema
}).strict()

export const artifactVersionLifecycleEventV1Schema = z.object({
  schemaVersion: z.literal(ARTIFACT_VERSION_CONTRACT_VERSION),
  eventId: eventIdSchema,
  sequence: z.number().int().positive(),
  type: z.enum([
    'artifact-created',
    'version-committed',
    'current-changed',
    'availability-changed',
    'artifact-moved',
    'artifact-content-changed',
    'artifact-missing',
    'artifact-restored',
    'materialized',
    'bundle-imported'
  ]),
  artifactId: artifactIdSchema,
  versionId: versionIdSchema,
  previousVersionId: versionIdSchema.optional(),
  transactionId: transactionIdSchema.optional(),
  createdAt: timestampSchema,
  detail: metadataSchema
}).strict()

export const artifactVersionCommitReceiptItemV1Schema = z.object({
  candidateId: candidateIdSchema,
  artifact: artifactV1Schema,
  version: artifactVersionV1Schema,
  ref: artifactVersionRefV1Schema
}).strict()

export const artifactVersionCommitReceiptV1Schema = z.object({
  transactionId: transactionIdSchema,
  committedAt: timestampSchema,
  idempotentReplay: z.boolean(),
  versions: z.array(artifactVersionCommitReceiptItemV1Schema).min(1).max(128),
  events: z.array(artifactVersionLifecycleEventV1Schema).max(512)
}).strict()

export const artifactVersionIssueV1Schema = z.object({
  code: z.enum([
    'invalid-input',
    'stale-base',
    'idempotency-conflict',
    'artifact-not-found',
    'version-not-found',
    'access-restricted',
    'export-not-allowed',
    'invalid-dependency',
    'content-mismatch',
    'content-unavailable',
    'path-outside-workspace',
    'destination-exists',
    'bundle-invalid',
    'io-failure'
  ]),
  message: z.string().trim().min(1).max(4_000),
  details: metadataSchema.optional()
}).strict()

export function artifactVersionResultV1Schema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }).strict(),
    z.object({ ok: z.literal(false), issue: artifactVersionIssueV1Schema }).strict()
  ])
}

export const artifactVersionCommitResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionCommitReceiptV1Schema
)

export const artifactVersionObserveInputV1Schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  candidateId: candidateIdSchema,
  artifactId: artifactIdSchema.optional(),
  expectedCurrentVersionId: versionIdSchema.nullable(),
  kind: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  label: z.string().trim().min(1).max(512).optional(),
  path: pathSchema,
  retention: artifactVersionRetentionV1Schema,
  mediaType: mediaTypeSchema.optional(),
  dependencies: z.array(artifactVersionCandidateDependencyV1Schema).max(1_024).optional(),
  accessPolicy: artifactVersionAccessPolicyV1Schema.optional(),
  metadata: metadataSchema.optional()
}).strict()

export const artifactVersionReadInputV1Schema = z.object({
  versionId: versionIdSchema,
  maxBytes: z.number().int().positive().max(64 * 1024 * 1024).optional()
}).strict()
export const artifactVersionReadV1Schema = z.object({
  artifact: artifactV1Schema,
  version: artifactVersionV1Schema,
  ref: artifactVersionRefV1Schema,
  dataBase64: base64Schema
}).strict()
export const artifactVersionReadResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionReadV1Schema
)

export const artifactVersionListInputV1Schema = z.object({
  artifactId: artifactIdSchema.optional(),
  beforeSequence: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(500).optional()
}).strict()
export const artifactVersionHistoryItemV1Schema = z.object({
  artifact: artifactV1Schema,
  version: artifactVersionV1Schema,
  ref: artifactVersionRefV1Schema
}).strict()
export const artifactVersionListV1Schema = z.object({
  items: z.array(artifactVersionHistoryItemV1Schema).max(500),
  nextBeforeSequence: z.number().int().positive().optional()
}).strict()
export const artifactVersionListResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionListV1Schema
)

export const artifactVersionMaterializeInputV1Schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  versionId: versionIdSchema,
  destinationPath: pathSchema,
  overwrite: z.boolean().optional()
}).strict()
export const artifactVersionMaterializeReceiptV1Schema = z.object({
  version: artifactVersionRefV1Schema,
  destinationPath: pathSchema,
  byteLength: z.number().int().nonnegative(),
  contentDigest: sha256Schema,
  event: artifactVersionLifecycleEventV1Schema,
  idempotentReplay: z.boolean()
}).strict()
export const artifactVersionMaterializeResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionMaterializeReceiptV1Schema
)

export const artifactVersionRestoreAsNewInputV1Schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  artifactId: artifactIdSchema,
  sourceVersionId: versionIdSchema,
  expectedCurrentVersionId: versionIdSchema,
  label: z.string().trim().min(1).max(512).optional(),
  accessPolicy: artifactVersionAccessPolicyV1Schema.optional(),
  metadata: metadataSchema.optional()
}).strict()

export const artifactVersionCompareInputV1Schema = z.object({
  fromVersionId: versionIdSchema,
  toVersionId: versionIdSchema,
  textPreviewMaxBytes: z.number().int().min(0).max(256 * 1024).optional()
}).strict()
export const artifactVersionCompareV1Schema = z.object({
  from: artifactVersionRefV1Schema,
  to: artifactVersionRefV1Schema,
  sameContent: z.boolean(),
  byteLengthDelta: z.number().int(),
  mediaTypeChanged: z.boolean(),
  metadataChanged: z.boolean(),
  addedDependencies: z.array(artifactVersionDependencyRefV1Schema),
  removedDependencies: z.array(artifactVersionDependencyRefV1Schema),
  textPreview: z.object({
    from: z.string(),
    to: z.string(),
    truncated: z.boolean()
  }).strict().optional()
}).strict()
export const artifactVersionCompareResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionCompareV1Schema
)

export const artifactVersionBundleObjectV1Schema = z.object({
  contentDigest: sha256Schema,
  byteLength: z.number().int().nonnegative(),
  dataBase64: base64Schema
}).strict()
export const artifactVersionBundleV1Schema = z.object({
  schemaVersion: z.literal(ARTIFACT_VERSION_BUNDLE_SCHEMA_VERSION),
  createdAt: timestampSchema,
  artifacts: z.array(artifactV1Schema),
  versions: z.array(artifactVersionV1Schema),
  objects: z.array(artifactVersionBundleObjectV1Schema),
  bundleDigest: sha256Schema
}).strict()

export const artifactVersionBundleExportInputV1Schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  artifactIds: z.array(artifactIdSchema).max(10_000).optional(),
  versionIds: z.array(versionIdSchema).max(10_000).optional(),
  destinationPath: pathSchema,
  overwrite: z.boolean().optional()
}).strict()
export const artifactVersionBundleReceiptV1Schema = z.object({
  bundleDigest: sha256Schema,
  path: pathSchema,
  artifactCount: z.number().int().nonnegative(),
  versionCount: z.number().int().nonnegative(),
  objectCount: z.number().int().nonnegative(),
  idempotentReplay: z.boolean()
}).strict()
export const artifactVersionBundleExportResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionBundleReceiptV1Schema
)

export const artifactVersionBundleVerifyInputV1Schema = z.object({
  bundlePath: pathSchema
}).strict()
export const artifactVersionBundleVerificationV1Schema = z.object({
  valid: z.boolean(),
  bundleDigest: sha256Schema.optional(),
  artifactCount: z.number().int().nonnegative(),
  versionCount: z.number().int().nonnegative(),
  objectCount: z.number().int().nonnegative(),
  issues: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
}).strict()
export const artifactVersionBundleVerifyResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionBundleVerificationV1Schema
)

export const artifactVersionBundleImportInputV1Schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(512),
  bundlePath: pathSchema,
  conflictPolicy: z.enum(['reject', 'fork']).optional()
}).strict()
export const artifactVersionBundleImportReceiptV1Schema = z.object({
  bundleDigest: sha256Schema,
  artifactIdMap: z.record(artifactIdSchema, artifactIdSchema),
  versionIdMap: z.record(versionIdSchema, versionIdSchema),
  importedArtifactCount: z.number().int().nonnegative(),
  importedVersionCount: z.number().int().nonnegative(),
  events: z.array(artifactVersionLifecycleEventV1Schema),
  idempotentReplay: z.boolean()
}).strict()
export const artifactVersionBundleImportResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionBundleImportReceiptV1Schema
)

export const artifactVersionEventListInputV1Schema = z.object({
  afterSequence: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(1_000).optional()
}).strict()
export const artifactVersionEventListV1Schema = z.object({
  events: z.array(artifactVersionLifecycleEventV1Schema).max(1_000),
  lastSequence: z.number().int().nonnegative()
}).strict()
export const artifactVersionEventListResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionEventListV1Schema
)

export const artifactVersionLocationV1Schema = z.object({
  artifactId: artifactIdSchema,
  versionId: versionIdSchema,
  activeLocator: z.string().trim().min(1).max(8_192),
  historicalLocators: z.array(z.string().trim().min(1).max(8_192)).max(10_000),
  sourceAvailability: z.enum(['available', 'missing']),
  observedAt: timestampSchema
}).strict()

export const artifactVersionRefreshInputV1Schema = z.object({
  artifactId: artifactIdSchema.optional()
}).strict()
export const artifactVersionRefreshV1Schema = z.object({
  checked: z.number().int().nonnegative(),
  locations: z.array(artifactVersionLocationV1Schema),
  events: z.array(artifactVersionLifecycleEventV1Schema)
}).strict()
export const artifactVersionRefreshResultV1Schema = artifactVersionResultV1Schema(
  artifactVersionRefreshV1Schema
)

export type ArtifactVersionRefV1 = z.infer<typeof artifactVersionRefV1Schema>
export type ArtifactVersionAccessPolicyV1 = z.infer<
  typeof artifactVersionAccessPolicyV1Schema
>
export type ArtifactVersionDependencyRefV1 = z.infer<typeof artifactVersionDependencyRefV1Schema>
export type ArtifactVersionCandidateDependencyV1 = z.infer<
  typeof artifactVersionCandidateDependencyV1Schema
>
export type ArtifactVersionCommitCandidateV1 = z.infer<
  typeof artifactVersionCommitCandidateV1Schema
>
export type ArtifactVersionCommitInputV1 = z.infer<typeof artifactVersionCommitInputV1Schema>
export type ArtifactV1 = z.infer<typeof artifactV1Schema>
export type ArtifactVersionV1 = z.infer<typeof artifactVersionV1Schema>
export type ArtifactVersionLifecycleEventV1 = z.infer<
  typeof artifactVersionLifecycleEventV1Schema
>
export type ArtifactVersionCommitReceiptV1 = z.infer<
  typeof artifactVersionCommitReceiptV1Schema
>
export type ArtifactVersionIssueV1 = z.infer<typeof artifactVersionIssueV1Schema>
export type ArtifactVersionCommitResultV1 = z.infer<
  typeof artifactVersionCommitResultV1Schema
>
export type ArtifactVersionObserveInputV1 = z.infer<typeof artifactVersionObserveInputV1Schema>
export type ArtifactVersionReadInputV1 = z.infer<typeof artifactVersionReadInputV1Schema>
export type ArtifactVersionReadV1 = z.infer<typeof artifactVersionReadV1Schema>
export type ArtifactVersionReadResultV1 = z.infer<typeof artifactVersionReadResultV1Schema>
export type ArtifactVersionListInputV1 = z.infer<typeof artifactVersionListInputV1Schema>
export type ArtifactVersionListV1 = z.infer<typeof artifactVersionListV1Schema>
export type ArtifactVersionMaterializeInputV1 = z.infer<
  typeof artifactVersionMaterializeInputV1Schema
>
export type ArtifactVersionMaterializeReceiptV1 = z.infer<
  typeof artifactVersionMaterializeReceiptV1Schema
>
export type ArtifactVersionRestoreAsNewInputV1 = z.infer<
  typeof artifactVersionRestoreAsNewInputV1Schema
>
export type ArtifactVersionCompareInputV1 = z.infer<typeof artifactVersionCompareInputV1Schema>
export type ArtifactVersionCompareV1 = z.infer<typeof artifactVersionCompareV1Schema>
export type ArtifactVersionBundleV1 = z.infer<typeof artifactVersionBundleV1Schema>
export type ArtifactVersionBundleExportInputV1 = z.infer<
  typeof artifactVersionBundleExportInputV1Schema
>
export type ArtifactVersionBundleReceiptV1 = z.infer<
  typeof artifactVersionBundleReceiptV1Schema
>
export type ArtifactVersionBundleVerifyInputV1 = z.infer<
  typeof artifactVersionBundleVerifyInputV1Schema
>
export type ArtifactVersionBundleVerificationV1 = z.infer<
  typeof artifactVersionBundleVerificationV1Schema
>
export type ArtifactVersionBundleImportInputV1 = z.infer<
  typeof artifactVersionBundleImportInputV1Schema
>
export type ArtifactVersionBundleImportReceiptV1 = z.infer<
  typeof artifactVersionBundleImportReceiptV1Schema
>
export type ArtifactVersionEventListInputV1 = z.infer<
  typeof artifactVersionEventListInputV1Schema
>
export type ArtifactVersionEventListV1 = z.infer<typeof artifactVersionEventListV1Schema>
export type ArtifactVersionLocationV1 = z.infer<typeof artifactVersionLocationV1Schema>
export type ArtifactVersionRefreshInputV1 = z.infer<typeof artifactVersionRefreshInputV1Schema>
export type ArtifactVersionRefreshV1 = z.infer<typeof artifactVersionRefreshV1Schema>

export type ArtifactVersionResultV1<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issue: ArtifactVersionIssueV1 }>

export type ArtifactVersionCommitPortV1 = Readonly<{
  commit(input: ArtifactVersionCommitInputV1): Promise<ArtifactVersionCommitResultV1>
}>
export type ArtifactVersionReadPortV1 = Readonly<{
  read(input: ArtifactVersionReadInputV1): Promise<ArtifactVersionReadResultV1>
}>
export type ArtifactVersionEventListResultV1 = ArtifactVersionResultV1<
  ArtifactVersionEventListV1
>
export type ArtifactVersionEventListPortV1 = Readonly<{
  listEvents(
    input: ArtifactVersionEventListInputV1
  ): Promise<ArtifactVersionEventListResultV1>
}>

export const ARTIFACT_VERSION_COMMIT_CONTRACT: DomainCapabilityContract<
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitResultV1
> = Object.freeze({
  actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.commit,
  effect: 'workspace-write',
  inputSchema: artifactVersionCommitInputV1Schema,
  outputSchema: artifactVersionCommitResultV1Schema
})

export const ARTIFACT_VERSION_READ_CONTRACT: DomainCapabilityContract<
  ArtifactVersionReadInputV1,
  ArtifactVersionReadResultV1
> = Object.freeze({
  actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
  effect: 'read',
  inputSchema: artifactVersionReadInputV1Schema,
  outputSchema: artifactVersionReadResultV1Schema
})

export const ARTIFACT_VERSION_EVENT_LIST_CONTRACT: DomainCapabilityContract<
  ArtifactVersionEventListInputV1,
  ArtifactVersionEventListResultV1
> = Object.freeze({
  actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.listEvents,
  effect: 'read',
  inputSchema: artifactVersionEventListInputV1Schema,
  outputSchema: artifactVersionEventListResultV1Schema
})

export function createArtifactVersionCommitPortV1(
  invoker: DomainMainSystemCapabilityInvoker,
  workspaceId: string
): ArtifactVersionCommitPortV1 {
  const scope = workspaceId.trim()
  if (!scope) throw new Error('Artifact version commit port requires a workspaceId.')
  return Object.freeze({
    commit: (input) => invoker.invoke(
      ARTIFACT_VERSION_COMMIT_CONTRACT,
      input,
      {
        workspaceId: scope,
        idempotencyKey: input.idempotencyKey
      }
    )
  })
}

export function createArtifactVersionReadPortV1(
  invoker: DomainMainSystemCapabilityInvoker,
  workspaceId: string
): ArtifactVersionReadPortV1 {
  const scope = workspaceId.trim()
  if (!scope) throw new Error('Artifact version read port requires a workspaceId.')
  return Object.freeze({
    read: (input) => invoker.invoke(
      ARTIFACT_VERSION_READ_CONTRACT,
      input,
      { workspaceId: scope }
    )
  })
}

export function createArtifactVersionEventListPortV1(
  invoker: DomainMainSystemCapabilityInvoker,
  workspaceId: string
): ArtifactVersionEventListPortV1 {
  const scope = workspaceId.trim()
  if (!scope) throw new Error('Artifact version event port requires a workspaceId.')
  return Object.freeze({
    listEvents: (input) => invoker.invoke(
      ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
      input,
      { workspaceId: scope }
    )
  })
}

export type ArtifactVersionJsonMetadata = Readonly<Record<string, DomainPackageJsonValue>>
