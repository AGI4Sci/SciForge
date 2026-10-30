import assert from 'node:assert/strict'
import test from 'node:test'
import {
  researchCheckpointCommittedTurnStatusV1Schema,
  researchCheckpointLegacyImportInputV1Schema,
  researchCheckpointLegacyPreviewV1Schema,
  researchCheckpointManifestV1Schema,
  researchCheckpointRestoreAsNewReceiptV1Schema,
  type ArtifactVersionRefV1,
  type ResearchCheckpointManifestV1
} from './contract.js'

const timestamp = '2026-08-11T08:00:00.000Z'
const accessPolicy = { visibility: 'workspace' as const, principals: [], allowExport: true }
const ref: ArtifactVersionRefV1 = {
  artifactId: 'artifact:checkpoint',
  versionId: 'artifact-version:checkpoint-v1',
  contentDigest: 'a'.repeat(64),
  byteLength: 42,
  mediaType: 'application/json',
  availability: 'available',
  retention: 'snapshot',
  accessPolicy
}

function liveManifest(): ResearchCheckpointManifestV1 {
  return researchCheckpointManifestV1Schema.parse({
    contractVersion: 1,
    kind: 'sciforge.research-checkpoint-manifest.v1',
    recording: {
      recordingId: 'research-recording:test',
      origin: 'live',
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspaceBindingDigest: 'b'.repeat(64)
    },
    turn: { turnId: 'turn-1', targetWatermark: 'wm-1', occurredAt: timestamp },
    title: 'Recorded research',
    changeReason: 'Initial investigation',
    narrative: { canonicalText: 'Finding', contentDigest: 'c'.repeat(64) },
    sources: [],
    declaredFiles: [],
    artifactDependencies: [],
    computeRuns: [],
    gitCheckpoints: [],
    untrackedOperations: [],
    breakpoints: [],
    status: {
      execution: 'not-applicable',
      provenance: 'complete',
      control: 'untracked',
      reproduction: 'not-run',
      evidence: 'pending'
    }
  })
}

test('legacy manifests are structurally fail-closed and live manifests cannot carry import fields', () => {
  const live = liveManifest()
  const dishonestLegacy = {
    ...live,
    recording: { ...live.recording, origin: 'legacy-import' as const },
    importedTranscriptDigest: 'd'.repeat(64),
    importedTurnIds: ['turn-1'],
    status: {
      execution: 'formal-references-present' as const,
      provenance: 'complete' as const,
      control: 'isolated-attested' as const,
      reproduction: 'replicates' as const,
      evidence: 'committed' as const
    }
  }
  assert.equal(researchCheckpointManifestV1Schema.safeParse(dishonestLegacy).success, false)
  assert.equal(researchCheckpointManifestV1Schema.safeParse({
    ...live,
    importedTranscriptDigest: 'e'.repeat(64),
    importedTurnIds: ['turn-1']
  }).success, false)

  const honestLegacy = {
    ...live,
    recording: { ...live.recording, origin: 'legacy-import' as const },
    importedTranscriptDigest: 'f'.repeat(64),
    importedTurnIds: ['turn-1'],
    untrackedOperations: [{ kind: 'unknown' as const, summary: 'Execution boundary unavailable' }],
    breakpoints: [{ code: 'legacy-incomplete', blocking: true, message: 'Legacy provenance is incomplete.' }],
    status: {
      execution: 'observed-untracked' as const,
      provenance: 'incomplete' as const,
      control: 'untracked' as const,
      reproduction: 'not-run' as const,
      evidence: 'unavailable' as const
    }
  }
  assert.equal(researchCheckpointManifestV1Schema.safeParse(honestLegacy).success, true)
  assert.equal(researchCheckpointManifestV1Schema.safeParse({
    ...honestLegacy,
    status: { ...honestLegacy.status, execution: 'formal-references-present' }
  }).success, false)
  assert.equal(researchCheckpointManifestV1Schema.safeParse({
    ...honestLegacy,
    sources: [{ sourceId: 'source:legacy', uri: 'https://example.test', contentDigest: '1'.repeat(64) }]
  }).success, false)
  assert.equal(researchCheckpointManifestV1Schema.safeParse({
    ...honestLegacy,
    declaredFiles: [{
      path: 'report.md',
      role: 'output',
      capture: 'declared-exact',
      contentDigest: '2'.repeat(64)
    }]
  }).success, false)
})

test('committed status uses the exact Artifact reference as its only navigation identity', () => {
  const base = {
    state: 'committed' as const,
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    recordingId: 'research-recording:test',
    operationId: `research-checkpoint-operation:${'1'.repeat(64)}`,
    changeReason: 'Saved iteration',
    attempts: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    changeKind: 'new' as const,
    title: 'Recorded research',
    artifactRef: ref,
    ordinal: 1,
    inputs: [],
    outputs: [],
    outputArtifacts: [],
    reproduction: { status: 'not-run' as const },
    provenance: { status: 'complete' as const },
    control: { status: 'untracked' as const },
    untrackedOperationCount: 0,
    evidence: { status: 'pending' as const }
  }
  assert.equal(researchCheckpointCommittedTurnStatusV1Schema.safeParse(base).success, true)
})

test('legacy preview exposes only bounded public turn facts and a selection digest', () => {
  assert.equal(researchCheckpointLegacyPreviewV1Schema.safeParse({
    runtimeId: 'codex',
    threadId: 'thread-1',
    turns: [{
      turnId: 'turn-1',
      status: 'completed',
      completedAt: timestamp,
      summary: 'User question · Assistant finding'
    }],
    selectedTurnIds: ['turn-1'],
    selectedTranscriptDigest: 'd'.repeat(64)
  }).success, true)
  assert.equal(researchCheckpointLegacyPreviewV1Schema.safeParse({
    runtimeId: 'codex',
    threadId: 'thread-1',
    turns: [{
      turnId: 'turn-1',
      status: 'completed',
      summary: 'Finding',
      hostPath: '/private/transcript.json'
    }],
    selectedTurnIds: [],
    selectedTranscriptDigest: null
  }).success, false)
  assert.equal(researchCheckpointLegacyPreviewV1Schema.safeParse({
    runtimeId: 'codex',
    threadId: 'thread-1',
    turns: [{ turnId: 'turn-1', status: 'completed', summary: 'Finding' }],
    selectedTurnIds: ['turn-1', 'turn-1'],
    selectedTranscriptDigest: 'd'.repeat(64)
  }).success, false)
  assert.equal(researchCheckpointLegacyPreviewV1Schema.safeParse({
    runtimeId: 'codex',
    threadId: 'thread-1',
    turns: [{ turnId: 'turn-1', status: 'completed', summary: 'Finding' }],
    selectedTurnIds: [],
    selectedTranscriptDigest: 'd'.repeat(64)
  }).success, false)
})

test('legacy import always requires an exact selection-bound transcript digest', () => {
  const base = {
    runtimeId: 'codex',
    threadId: 'thread-1',
    idempotencyKey: 'legacy-import-contract-1',
    title: 'Imported research',
    expectedTranscriptDigest: 'd'.repeat(64),
    selectedTurnIds: ['turn-1']
  }
  assert.equal(researchCheckpointLegacyImportInputV1Schema.safeParse(base).success, true)
  const { expectedTranscriptDigest: _digest, ...withoutDigest } = base
  assert.equal(researchCheckpointLegacyImportInputV1Schema.safeParse(withoutDigest).success, false)
})

test('restore receipt exactly adopts the returned Version as recording current', () => {
  const receipt = {
    recording: {
      recordingId: 'research-recording:test',
      origin: 'live' as const,
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'Recorded research',
      state: 'active' as const,
      versionCount: 3,
      artifactId: ref.artifactId,
      currentVersionId: ref.versionId,
      currentContentDigest: ref.contentDigest,
      currentOrdinal: 3,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    restoredRef: ref,
    ordinal: 3,
    transactionId: 'artifact-commit:restore-test',
    idempotentReplay: false
  }
  assert.equal(researchCheckpointRestoreAsNewReceiptV1Schema.safeParse(receipt).success, true)
  assert.equal(researchCheckpointRestoreAsNewReceiptV1Schema.safeParse({
    ...receipt,
    restoredRef: { ...ref, versionId: 'artifact-version:other' }
  }).success, false)
})
