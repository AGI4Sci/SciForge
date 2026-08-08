import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ARTIFACT_VERSION_COMMIT_CONTRACT,
  ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  artifactVersionBundleExportInputV1Schema,
  artifactVersionCommitInputV1Schema,
  artifactVersionIssueV1Schema,
  artifactVersionRefV1Schema
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

test('bundle export requires an explicit non-empty artifact or version selection', () => {
  const base = {
    idempotencyKey: 'bundle:explicit-selection',
    destinationPath: 'exports/result.bundle.json'
  }
  assert.equal(artifactVersionBundleExportInputV1Schema.safeParse(base).success, false)
  assert.equal(artifactVersionBundleExportInputV1Schema.safeParse({
    ...base,
    artifactIds: []
  }).success, false)
  assert.equal(artifactVersionBundleExportInputV1Schema.safeParse({
    ...base,
    versionIds: ['artifact-version:result-1']
  }).success, true)
})
