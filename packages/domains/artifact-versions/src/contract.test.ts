import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ARTIFACT_VERSION_COMMIT_CONTRACT,
  ARTIFACT_VERSION_COMMIT_V2_CONTRACT,
  ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
  ARTIFACT_VERSION_READ_RANGE_V2_CONTRACT,
  ARTIFACT_VERSION_STAGE_BEGIN_V2_CONTRACT,
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  artifactVersionBundleExportInputV1Schema,
  artifactVersionBundleReceiptV1Schema,
  artifactVersionBundleVerificationV1Schema,
  artifactVersionCommitInputV1Schema,
  artifactVersionCommitInputV2Schema,
  artifactVersionIssueV1Schema,
  artifactVersionListInputV1Schema,
  artifactVersionListV1Schema,
  artifactVersionRefV1Schema,
  artifactVersionStageAppendInputV2Schema,
  stagedObjectRefV2Schema
} from './contract.js'

const digest = 'a'.repeat(64)

test('ArtifactVersionRefV1 is strict, immutable-version-shaped data', () => {
  const ref = artifactVersionRefV1Schema.parse({
    artifactId: 'artifact:a',
    versionId: 'artifact-version:a1',
    contentDigest: digest,
    byteLength: 12,
    mediaType: 'text/csv',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: {
      visibility: 'workspace',
      principals: [],
      allowExport: true
    }
  })
  assert.equal(ref.versionId, 'artifact-version:a1')
  assert.equal(artifactVersionRefV1Schema.safeParse({ ...ref, claimId: 'claim:1' }).success, false)
})
test('V2 staged object contracts are pathless, bounded, and system-port shaped', () => {
  const staged = stagedObjectRefV2Schema.parse({
    stageToken: 'artifact-stage:sealed-object',
    contentDigest: digest,
    byteLength: 12,
    mediaType: 'text/plain',
    expiresAt: '2026-08-06T02:00:00.000Z'
  })
  assert.equal('path' in staged, false)
  assert.equal(artifactVersionCommitInputV2Schema.safeParse({
    idempotencyKey: 'commit:staged:fixture',
    candidates: [{
      candidateId: 'output',
      expectedCurrentVersionId: null,
      kind: 'dataset',
      intent: 'save',
      content: { mode: 'staged-object', stagedObject: staged }
    }]
  }).success, true)
  assert.equal(artifactVersionStageAppendInputV2Schema.safeParse({
    stageToken: staged.stageToken,
    offset: 0,
    chunkDigest: digest,
    dataBase64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')
  }).success, false)
  assert.equal(ARTIFACT_VERSION_STAGE_BEGIN_V2_CONTRACT.actionId, 'artifact-versions.stage.begin-v2')
  assert.equal(ARTIFACT_VERSION_READ_RANGE_V2_CONTRACT.actionId, 'artifact-versions.content.read-range-v2')
  assert.equal(artifactVersionCommitInputV1Schema.safeParse({
    idempotencyKey: 'commit:staged:fixture',
    candidates: [{
      candidateId: 'output',
      expectedCurrentVersionId: null,
      kind: 'dataset',
      intent: 'save',
      content: { mode: 'staged-object', stagedObject: staged }
    }]
  }).success, false)
})

test('access-control failures use stable public issue codes', () => {
  assert.deepEqual(artifactVersionIssueV1Schema.parse({
    code: 'access-restricted',
    message: 'The requested artifact version is not available to this caller.'
  }), {
    code: 'access-restricted',
    message: 'The requested artifact version is not available to this caller.'
  })
  assert.equal(artifactVersionIssueV1Schema.safeParse({
    code: 'access-denied-internal',
    message: 'unstable'
  }).success, false)
  assert.equal(artifactVersionCommitInputV1Schema.safeParse({
    idempotencyKey: 'deterministic-artifact-without-version',
    candidates: [{
      candidateId: 'output',
      requestedArtifactId: `artifact:${'a'.repeat(64)}`,
      expectedCurrentVersionId: null,
      kind: 'research-output',
      intent: 'save',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  }).success, false)
  assert.equal(artifactVersionCommitInputV1Schema.safeParse({
    idempotencyKey: 'deterministic-version-without-artifact',
    candidates: [{
      candidateId: 'output',
      requestedVersionId: `artifact-version:${'b'.repeat(64)}`,
      expectedCurrentVersionId: null,
      kind: 'research-output',
      intent: 'save',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  }).success, false)
})

test('commit contract rejects ambiguous bases and duplicate candidates', () => {
  const snapshot = { mode: 'snapshot' as const, dataBase64: 'YQ==' }
  assert.equal(artifactVersionCommitInputV1Schema.safeParse({
    idempotencyKey: 'commit:test:new',
    candidates: [{
      candidateId: 'figure',
      artifactId: 'artifact:existing',
      expectedCurrentVersionId: null,
      kind: 'figure',
      intent: 'save',
      content: snapshot
    }]
  }).success, false)
  assert.equal(artifactVersionCommitInputV1Schema.safeParse({
    idempotencyKey: 'commit:test:duplicates',
    candidates: [
      {
        candidateId: 'same',
        expectedCurrentVersionId: null,
        kind: 'data',
        intent: 'save',
        content: snapshot
      },
      {
        candidateId: 'same',
        expectedCurrentVersionId: null,
        kind: 'figure',
        intent: 'save',
        content: snapshot
      }
    ]
  }).success, false)
  assert.equal(ARTIFACT_VERSION_COMMIT_CONTRACT.actionId, ARTIFACT_VERSIONS_CAPABILITY_IDS.commit)
  assert.equal(ARTIFACT_VERSION_COMMIT_CONTRACT.effect, 'workspace-write')
  assert.equal(ARTIFACT_VERSION_EVENT_LIST_CONTRACT.actionId, 'artifact-versions.events.list')
  assert.equal(ARTIFACT_VERSION_EVENT_LIST_CONTRACT.effect, 'read')
})

test('deterministic commit identities are additive V2 fields and rejected by V1', () => {
  const exactIdentityInput = {
    idempotencyKey: 'deterministic-identities-valid',
    candidates: [{
      candidateId: 'output',
      requestedArtifactId: `artifact:${'a'.repeat(64)}`,
      requestedVersionId: `artifact-version:${'b'.repeat(64)}`,
      expectedCurrentVersionId: null,
      kind: 'research-output',
      intent: 'save',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  }
  assert.equal(artifactVersionCommitInputV2Schema.safeParse(exactIdentityInput).success, true)
  assert.equal(artifactVersionCommitInputV1Schema.safeParse(exactIdentityInput).success, false)
  assert.equal(artifactVersionCommitInputV2Schema.safeParse({
    idempotencyKey: 'deterministic-identities-ambiguous',
    candidates: [{
      candidateId: 'output',
      artifactId: 'artifact:existing',
      requestedArtifactId: `artifact:${'a'.repeat(64)}`,
      requestedVersionId: `artifact-version:${'b'.repeat(64)}`,
      expectedCurrentVersionId: 'artifact-version:current',
      kind: 'research-output',
      intent: 'save',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  }).success, false)
  assert.equal(ARTIFACT_VERSION_COMMIT_V2_CONTRACT.actionId, ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2)
})

test('public V1 list and bundle wires stay strict and fail closed', () => {
  assert.equal(artifactVersionListInputV1Schema.safeParse({ kind: 'dataset' }).success, false)
  assert.equal(artifactVersionListV1Schema.safeParse({
    items: [{ artifactOrdinal: 1, isCurrent: true }]
  }).success, false)
  assert.equal(artifactVersionBundleExportInputV1Schema.safeParse({
    idempotencyKey: 'bundle:empty',
    destinationPath: 'bundle.json'
  }).success, false)
  assert.equal(artifactVersionBundleExportInputV1Schema.safeParse({
    idempotencyKey: 'bundle:empty-arrays',
    artifactIds: [],
    versionIds: [],
    destinationPath: 'bundle.json'
  }).success, false)
  assert.equal(artifactVersionBundleExportInputV1Schema.safeParse({
    idempotencyKey: 'bundle:explicit',
    artifactIds: ['artifact:a'],
    destinationPath: 'bundle.json'
  }).success, true)
  const receipt = {
    bundleDigest: digest,
    path: 'bundle.json',
    artifactCount: 1,
    versionCount: 1,
    objectCount: 1,
    idempotentReplay: false
  }
  assert.equal(artifactVersionBundleReceiptV1Schema.safeParse(receipt).success, true)
  assert.equal(artifactVersionBundleReceiptV1Schema.safeParse({ ...receipt, format: 'v1-json' }).success, false)
  const verification = {
    valid: true,
    bundleDigest: digest,
    artifactCount: 1,
    versionCount: 1,
    objectCount: 1,
    issues: []
  }
  assert.equal(artifactVersionBundleVerificationV1Schema.safeParse(verification).success, true)
  assert.equal(artifactVersionBundleVerificationV1Schema.safeParse({ ...verification, format: 'v1-json' }).success, false)
})
