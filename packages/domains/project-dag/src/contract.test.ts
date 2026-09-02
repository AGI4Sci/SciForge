import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_DAG_SERVICE_VERSION,
  projectDagActivationPayloadSchema,
  projectDagCapturedScopeSchema,
  projectDagDurableReceiptSchema,
  projectDagReleaseV1Schema,
  projectDagRequestedScopeSchema,
  projectDagStatusSchema,
  projectDagUpdateResultSchema
} from './contract.js'

const evidenceDigest = `sha256:${'a'.repeat(64)}`
const fingerprint = `project-update-desired:${'b'.repeat(64)}`
const projectDigest = `project:${'c'.repeat(64)}`
const acceptedAt = '2026-07-26T05:30:20.000Z'

test('service contract version matches the packaged Python engine', () => {
  assert.equal(PROJECT_DAG_SERVICE_VERSION, '1.0.0')
})

function receipt(state: 'queued' | 'failed' = 'queued') {
  return {
    projectKey: 'path:/workspace/research',
    jobId: 'pjob_0123456789ab',
    acceptedRequestVersion: 3,
    desiredFingerprint: fingerprint,
    desiredEvidenceVector: [
      { threadId: 'codex:thread-1', digest: evidenceDigest }
    ],
    capturedScope: {
      includedSessions: ['codex:thread-1'],
      excludedSessions: [],
      isolatedSessions: []
    },
    state,
    acceptedAt,
    updatedAt: acceptedAt
  }
}

test('durable receipts carry stable job, generation, fingerprint, and Evidence identity', () => {
  const parsed = projectDagDurableReceiptSchema.parse(receipt())
  assert.equal(parsed.jobId, 'pjob_0123456789ab')
  assert.equal(parsed.acceptedRequestVersion, 3)
  assert.equal(parsed.desiredFingerprint, fingerprint)

  assert.equal(projectDagDurableReceiptSchema.safeParse({
    ...receipt(),
    desiredFingerprint: 'unversioned-fingerprint'
  }).success, false)
})

test('a failed pending delta coexists with the last committed Project snapshot', () => {
  const parsed = projectDagStatusSchema.parse({
    projectKey: 'path:/workspace/research',
    committed: {
      version: 27,
      digest: projectDigest,
      evidenceVector: [
        { threadId: 'codex:thread-1', digest: evidenceDigest }
      ],
      createdAt: acceptedAt
    },
    pending: {
      state: 'failed',
      receipt: receipt('failed'),
      attempts: 5,
      updatedAt: acceptedAt,
      error: {
        code: 'project_compile_failed',
        message: 'Compilation failed.',
        retryable: false
      }
    },
    latestReceipt: receipt('failed'),
    scope: {
      includedSessions: ['codex:thread-1'],
      excludedSessions: [],
      isolatedSessions: []
    },
    autonomyMode: 'checkpointed',
    attentionCount: 2
  })

  assert.equal(parsed.committed?.version, 27)
  assert.equal(parsed.pending?.state, 'failed')
  assert.equal(parsed.pending?.error?.code, 'project_compile_failed')
})

test('failed pending state requires a typed error and active state forbids one', () => {
  const base = {
    state: 'failed',
    receipt: receipt('failed'),
    attempts: 1,
    updatedAt: acceptedAt
  }
  assert.equal(projectDagStatusSchema.shape.pending.unwrap().safeParse(base).success, false)
  assert.equal(projectDagStatusSchema.shape.pending.unwrap().safeParse({
    ...base,
    state: 'running',
    receipt: receipt(),
    error: {
      code: 'internal_error',
      message: 'This cannot be terminal while running.',
      retryable: false
    }
  }).success, false)
})

test('captured scope rejects overlapping or duplicate dispositions', () => {
  assert.equal(projectDagCapturedScopeSchema.safeParse({
    includedSessions: ['thread-1'],
    excludedSessions: ['thread-1'],
    isolatedSessions: []
  }).success, false)
  assert.equal(projectDagCapturedScopeSchema.safeParse({
    includedSessions: ['thread-1', 'thread-1'],
    excludedSessions: [],
    isolatedSessions: []
  }).success, false)
})

test('activation payload is process-neutral and rejects host-private extras', () => {
  assert.equal(projectDagActivationPayloadSchema.safeParse({
    workspaceRoot: '/workspace',
    view: 'attention',
    focus: { claimId: 'claim-1' }
  }).success, true)
  assert.equal(projectDagActivationPayloadSchema.safeParse({
    workspaceRoot: '/workspace',
    onCollapse: () => undefined
  }).success, false)
})

test('Project update scope is an explicit Session list', () => {
  assert.equal(projectDagRequestedScopeSchema.safeParse([
    'codex:thread-1'
  ]).success, true)
  assert.equal(projectDagRequestedScopeSchema.safeParse([]).success, false)
  assert.equal(projectDagRequestedScopeSchema.safeParse('all').success, false)
})

test('operation failures expose stable typed errors', () => {
  const parsed = projectDagUpdateResultSchema.parse({
    ok: false,
    error: {
      code: 'evidence_vector_regression',
      message: 'Evidence Snapshot version would roll back the accepted version.',
      retryable: false,
      details: {
        threadId: 'codex:thread-1',
        acceptedVersion: 4,
        requestedVersion: 3
      }
    }
  })
  assert.equal(parsed.ok, false)
  if (!parsed.ok) assert.equal(parsed.error.code, 'evidence_vector_regression')
})

test('release output references require exact Artifact Versions', () => {
  const base = {
    releaseId: 'release-1',
    projectSnapshot: projectDigest,
    classification: 'certified' as const,
    target: 'internal',
    outputArtifactVersions: [{
      artifactVersionId: 'artifact-version-1',
      contentDigest: evidenceDigest
    }],
    auditRefs: ['audit-1'],
    decisionRefs: ['decision-1'],
    approvalRefs: ['approval-1'],
    attemptOutcome: 'accepted',
    createdAt: acceptedAt
  }
  assert.equal(projectDagReleaseV1Schema.safeParse(base).success, true)
  assert.equal(projectDagReleaseV1Schema.safeParse({
    ...base,
    outputArtifactVersions: [{ artifactVersionId: 'latest', contentDigest: evidenceDigest }]
  }).success, false)
})
