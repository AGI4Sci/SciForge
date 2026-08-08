import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evidenceDagActivationPayloadSchema,
  evidenceDagArtifactVersionProjectionV1Schema,
  evidenceDagCanonicalStatusSchema,
  evidenceDagExportSnapshotProductsInputSchema,
  evidenceDagPreviewOutputSchema,
  evidenceDagSnapshotIdentitySchema,
  evidenceDagTypedErrorSchema,
  evidenceDagUpdateInputSchema,
  evidenceDagViewInputSchema
} from './contract.js'

const pinnedRef = {
  artifactId: 'artifact:test',
  versionId: 'artifact-version:test-1',
  contentDigest: 'b'.repeat(64),
  byteLength: 9,
  availability: 'available',
  retention: 'reference',
  accessPolicy: { visibility: 'workspace', principals: [], allowExport: false }
} as const

const digest = `sha256:${'a'.repeat(64)}`
const now = '2026-07-26T06:00:00.000Z'

test('accepts only exact public ArtifactVersion refs and supports lifecycle-only projections', () => {
  assert.equal(evidenceDagArtifactVersionProjectionV1Schema.safeParse({
    status: 'ready', versions: [{ ref: pinnedRef }], lifecycleEvents: [], lastSequence: 4
  }).success, true)
  assert.equal(evidenceDagArtifactVersionProjectionV1Schema.safeParse({
    status: 'ready', versions: [], lifecycleEvents: [], lastSequence: 4
  }).success, true)
  assert.equal(evidenceDagArtifactVersionProjectionV1Schema.safeParse({
    status: 'ready',
    versions: [{ ref: { ...pinnedRef, contentDigest: `sha256:${'b'.repeat(64)}` } }],
    lifecycleEvents: []
  }).success, false)
  assert.equal(evidenceDagArtifactVersionProjectionV1Schema.safeParse({
    status: 'ready', versions: [{ ref: { ...pinnedRef, unowned: true } }], lifecycleEvents: []
  }).success, false)
})

test('keeps a committed snapshot available when the pending delta fails', () => {
  const status = evidenceDagCanonicalStatusSchema.parse({
    committed: {
      threadId: 'codex:thread-1',
      version: 3,
      digest,
      inputWatermark: '186:batch:1/4',
      schemaVersion: '1',
      extractorVersion: 'extractor-1',
      verifierVersion: 'verifier-1',
      artifactDigests: [],
      createdAt: now,
      url: 'http://127.0.0.1:4318/ui?thread_id=codex%3Athread-1'
    },
    pending: {
      state: 'failed',
      jobId: 'job-1',
      targetWatermark: '186:batch:2/4',
      attempt: 2,
      createdAt: now,
      updatedAt: now,
      completedBatches: 1,
      totalBatches: 4,
      error: {
        code: 'model_output_incomplete',
        message: 'The model exhausted its output budget before emitting JSON.',
        retryable: true,
        occurredAt: now,
        incompleteReason: 'max_output_tokens',
        maxOutputTokens: 4096
      }
    },
    updatedAt: now
  })

  assert.equal(status.committed?.version, 3)
  assert.equal(status.pending?.state, 'failed')
  assert.equal(status.pending?.error.code, 'model_output_incomplete')
  assert.equal(status.pending?.completedBatches, 1)
  assert.equal(status.pending?.totalBatches, 4)
})

test('exports one minimal immutable identity for downstream DAG vectors', () => {
  assert.deepEqual(evidenceDagSnapshotIdentitySchema.parse({
    threadId: 'codex:thread-1',
    digest
  }), {
    threadId: 'codex:thread-1',
    digest
  })
  assert.equal(evidenceDagSnapshotIdentitySchema.safeParse({
    threadId: 'codex:thread-1',
    digest,
    version: 3
  }).success, false)
})

test('requires typed incomplete metadata to be bounded and rejects opaque parser codes', () => {
  assert.equal(evidenceDagTypedErrorSchema.safeParse({
    code: 'model_output_incomplete',
    message: 'Incomplete model output.',
    retryable: true,
    occurredAt: now,
    incompleteReason: 'max_output_tokens',
    maxOutputTokens: 4096
  }).success, true)
  assert.equal(evidenceDagTypedErrorSchema.safeParse({
    code: 'json_decode_error',
    message: 'Expecting value.',
    retryable: true,
    occurredAt: now
  }).success, false)
})

test('enforces coherent thread scopes and explicit rebuild intent', () => {
  assert.equal(evidenceDagViewInputSchema.safeParse({}).success, true)
  assert.equal(evidenceDagViewInputSchema.safeParse({
    runtimeId: 'codex',
    threadId: 'thread-1'
  }).success, true)
  assert.equal(evidenceDagViewInputSchema.safeParse({ threadId: 'thread-1' }).success, false)
  assert.equal(evidenceDagUpdateInputSchema.safeParse({
    runtimeId: 'codex',
    threadId: 'thread-1',
    operation: 'rebuild'
  }).success, false)
  assert.equal(evidenceDagUpdateInputSchema.safeParse({
    runtimeId: 'codex',
    threadId: 'thread-1',
    operation: 'rebuild',
    rebuildKind: 'corruption_recovery',
    rebuildRationale: 'The committed snapshot failed integrity verification.'
  }).success, true)
})

test('validates preview provenance output and JSON-safe panel activation data', () => {
  assert.equal(evidenceDagPreviewOutputSchema.safeParse({
    ok: true,
    path: '/workspace/paper.pdf',
    workspaceRoot: '/workspace',
    runtimeId: 'codex',
    threadId: 'thread-1',
    snapshotDigest: digest,
    sourceAssertionId: 'source-1',
    artifactVersionId: 'artifact-version-1',
    sourceAnchorId: 'anchor-1',
    selector: { type: 'pdf', page: 2 },
    contentDigest: digest
  }).success, true)
  assert.deepEqual(evidenceDagActivationPayloadSchema.parse({
    nodeId: 'source-1',
    snapshotDigest: digest
  }), {
    view: 'graph',
    nodeId: 'source-1',
    snapshotDigest: digest
  })
  assert.equal(evidenceDagActivationPayloadSchema.safeParse({
    runtimeId: 'codex'
  }).success, false)
})

test('requires explicit DataCite publication identity for pinned snapshot exports', () => {
  const base = {
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace',
    snapshotDigest: digest,
    idempotencyKey: 'export-request-1',
    datacite: {
      doi: '10.12345/sciforge.snapshot',
      title: 'Pinned Evidence Snapshot',
      creators: [{ name: 'Researcher, Ada', nameType: 'Personal' }],
      publisher: 'SciForge Laboratory',
      publicationYear: 2026,
      projectId: 'project:snapshot'
    }
  }
  assert.equal(evidenceDagExportSnapshotProductsInputSchema.safeParse(base).success, true)
  assert.equal(evidenceDagExportSnapshotProductsInputSchema.safeParse({
    ...base,
    datacite: { ...base.datacite, doi: undefined }
  }).success, false)
  assert.equal(evidenceDagExportSnapshotProductsInputSchema.safeParse({
    ...base,
    datacite: { ...base.datacite, creators: [] }
  }).success, false)
  assert.equal(evidenceDagExportSnapshotProductsInputSchema.safeParse({
    ...base,
    datacite: {
      ...base.datacite,
      creators: [{ name: 'Ada', givenName: 'Ada' }]
    }
  }).success, false)
})
