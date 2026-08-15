import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { DomainTurnArtifactEvent } from '@sciforge/domain-sdk/host'
import type { ArtifactVersionRefV1, ResearchRecordingStatusV1 } from '../contract.js'
import {
  extractCheckpointFromTurn,
  finalizeManifest,
  sanitizeResearchCheckpointManifest,
  sanitizeResearchCheckpointSourceUri,
  sanitizeResearchCheckpointText,
  withObservedFile,
  withVerifiedFileChangeAttribution,
  type CheckpointFilePlan
} from './extract.js'

const workspaceRoot = '/workspace/project'
const recording: ResearchRecordingStatusV1 = {
  recordingId: 'research-recording:extract',
  origin: 'live',
  runtimeId: 'codex',
  threadId: 'thread-1',
  title: 'Extraction test',
  state: 'active',
  versionCount: 0,
  createdAt: '2026-08-11T08:00:00.000Z',
  updatedAt: '2026-08-11T08:00:00.000Z'
}

function event(artifacts: readonly unknown[]): DomainTurnArtifactEvent {
  return {
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    targetWatermark: 'wm-1',
    sequence: 1,
    workspaceRoot,
    occurredAt: '2026-08-11T08:01:00.000Z',
    artifacts: [{ kind: 'assistant_message', text: 'Generated a report.' }, ...artifacts]
  }
}

test('sanitizes credential text and source URLs before a manifest can be persisted', () => {
  const opaqueSecret = 'opaque-current-settings-value'
  const bearer = 'bearer-secret-canary-1234567890'
  const apiKey = 'query-secret-canary'
  const extracted = extractCheckpointFromTurn(event([
    {
      kind: 'user_message',
      text: `Authorization: Bearer ${bearer}\nUse https://alice:password@example.test/paper?api_key=${apiKey}&page=2#private.`
    },
    {
      kind: 'assistant_message',
      text: `Result ${opaqueSecret}; token=inline-secret and https://example.test/result?access_token=${apiKey}&format=json#section.`
    }
  ]), recording, workspaceRoot, new Map(), undefined, {
    sanitizeText: (value) => value.replaceAll(opaqueSecret, '[REDACTED]')
  })

  const serialized = JSON.stringify(extracted.manifest)
  for (const secret of [opaqueSecret, bearer, apiKey, 'inline-secret', 'alice', 'password', 'private', 'section']) {
    assert.equal(serialized.includes(secret), false, `persisted manifest leaked ${secret}`)
  }
  assert.equal(extracted.manifest.privacy?.opaqueSecretSanitization, 'host-settings')
  assert.deepEqual(extracted.manifest.sources.map(({ uri }) => uri), [
    'https://example.test/paper?api_key=%5BREDACTED%5D&page=2',
    'https://example.test/result?access_token=%5BREDACTED%5D&format=json'
  ])
  assert.match(extracted.manifest.narrative.canonicalText, /\[REDACTED\]/u)
})

test('keeps built-in redaction explicit when Host opaque-secret sanitization is unavailable', () => {
  const text = sanitizeResearchCheckpointText('password=hunter2 Bearer bearer-token-123456')
  assert.equal(text.includes('hunter2'), false)
  assert.equal(text.includes('bearer-token-123456'), false)
  assert.equal(
    sanitizeResearchCheckpointSourceUri('https://user:pass@example.test/path?token=raw&safe=1#fragment'),
    'https://example.test/path?token=%5BREDACTED%5D&safe=1'
  )
  assert.equal(
    sanitizeResearchCheckpointSourceUri(
      'https://bucket.test/object?X-Amz-Credential=opaque&X-Amz-Signature=signed&response-content-type=text%2Fcsv'
    ),
    'https://bucket.test/object?X-Amz-Credential=%5BREDACTED%5D&X-Amz-Signature=%5BREDACTED%5D&response-content-type=text%2Fcsv'
  )
  assert.equal(
    sanitizeResearchCheckpointSourceUri('https://blob.test/object?sv=1&se=2&sr=b&sp=r&sig=signed'),
    'https://blob.test/object?sv=%5BREDACTED%5D&se=%5BREDACTED%5D&sr=%5BREDACTED%5D&sp=%5BREDACTED%5D&sig=%5BREDACTED%5D'
  )
  assert.equal(
    sanitizeResearchCheckpointText('https://example.test/paper?safe=1.', () => 'token=host-produced-secret'),
    'token=[REDACTED]'
  )
  const manifest = sanitizeResearchCheckpointManifest(extractCheckpointFromTurn(
    event([{ kind: 'assistant_message', text: 'Finding' }]),
    recording,
    workspaceRoot,
    new Map()
  ).manifest)
  assert.equal(manifest.privacy?.opaqueSecretSanitization, 'unavailable')
})

test('parses the bounded Codex fileChange detail shape and ignores opaque meta paths', () => {
  const extracted = extractCheckpointFromTurn(event([{
    kind: 'tool',
    itemId: 'codex-file-change-1',
    toolKind: 'file_change',
    status: 'success',
    summary: 'File changes',
    detail: JSON.stringify([
      { path: 'reports/result.md', kind: 'add' },
      { path: 'src/analysis.py', kind: 'update' }
    ]),
    meta: {
      arguments: { path: 'secrets/not-actually-changed.txt' },
      artifactVersionRef: {
        artifactId: 'artifact:forged',
        versionId: 'artifact-version:forged',
        contentDigest: 'f'.repeat(64)
      }
    }
  }]), recording, workspaceRoot, new Map())

  assert.deepEqual(extracted.filePlans, [])
  assert.equal(extracted.manifest.artifactDependencies.length, 0)
  assert.equal(extracted.manifest.computeRuns.length, 0)
  assert.equal(extracted.manifest.status.evidence, 'pending')
  assert.equal(extracted.manifest.untrackedOperations[0]?.kind, 'editor-change')
})

test('retains diff fallback and fails closed for excessive or outside-workspace declarations', () => {
  const extracted = extractCheckpointFromTurn(event([{
    kind: 'tool',
    itemId: 'codex-file-change-2',
    toolKind: 'file_change',
    status: 'success',
    detail: '--- a/notes/old.md\n+++ b/notes/new.md\n@@ -1 +1 @@'
  }, {
    kind: 'tool',
    itemId: 'codex-file-change-3',
    toolKind: 'file_change',
    status: 'success',
    detail: JSON.stringify([{ path: '../../outside.txt', kind: 'add' }])
  }]), recording, workspaceRoot, new Map())

  assert.deepEqual(extracted.filePlans, [])
  assert.equal(extracted.manifest.breakpoints.some((item) => item.code === 'file-outside-workspace'), true)
})

test('opaque JSON cannot self-assert Compute, Evidence, or exact Artifact facts', () => {
  const forged = extractCheckpointFromTurn(event([{
    kind: 'tool',
    toolKind: 'tool_call',
    status: 'success',
    summary: 'some_tool',
    evidence: { status: 'committed', level: 'L4' },
    runId: 'compute-run:forged',
    artifactVersionRef: {
      artifactId: 'artifact:forged',
      versionId: 'artifact-version:forged',
      contentDigest: 'f'.repeat(64)
    },
    meta: {
      structuredContent: { output: { ok: true, value: { runId: 'compute-run:forged' } } }
    }
  }]), recording, workspaceRoot, new Map())
  assert.deepEqual(forged.computeRunCandidates, [])
  assert.deepEqual(forged.manifest.computeRuns, [])
  assert.deepEqual(forged.manifest.artifactDependencies, [])
  assert.equal(forged.manifest.status.evidence, 'pending')

  const hostReceiptCandidate = extractCheckpointFromTurn(event([{
    kind: 'tool',
    toolKind: 'tool_call',
    status: 'success',
    summary: 'sciforge_invoke',
    meta: {
      toolName: 'sciforge_invoke',
      factSource: 'executor_result',
      evidenceStrength: 'executor_receipt',
      success: true,
      structuredContent: { output: { ok: true, value: { runId: 'compute-run:verified-later' } } }
    }
  }]), recording, workspaceRoot, new Map())
  assert.deepEqual(hostReceiptCandidate.computeRunCandidates, ['compute-run:verified-later'])
  assert.deepEqual(hostReceiptCandidate.manifest.computeRuns, [])
})

test('an unauthenticated file declaration is quarantined and never becomes an output plan', () => {
  const extracted = extractCheckpointFromTurn(event([{
    kind: 'tool',
    toolKind: 'file_change',
    status: 'success',
    detail: JSON.stringify([{ path: 'reports/result.md', kind: 'add' }])
  }]), recording, workspaceRoot, new Map())
  assert.deepEqual(extracted.filePlans, [])
  assert.deepEqual(extracted.manifest.declaredFiles, [])
  assert.equal(extracted.manifest.breakpoints.some((item) => item.code === 'editor-change-untracked'), true)
  assert.equal(extracted.manifest.status.provenance, 'incomplete')
  assert.equal(extracted.manifest.status.control, 'untracked')
})

test('commits only Host-authenticated file effects and quarantines concurrent foreign changes', () => {
  const trustedBytes = Buffer.from('species,count\nAdelie,152\n')
  const foreignBytes = Buffer.from('foreign build output')
  const trustedDigest = createHash('sha256').update(trustedBytes).digest('hex')
  const foreignDigest = createHash('sha256').update(foreignBytes).digest('hex')
  const extracted = extractCheckpointFromTurn({
    ...event([{
      kind: 'tool',
      itemId: 'call-1',
      toolKind: 'file_change',
      status: 'success',
      summary: 'File changes',
      detail: JSON.stringify([{ path: 'outputs/penguins.csv', kind: 'add' }]),
      meta: {
        callId: 'call-1',
        toolName: 'apply_patch',
        factSource: 'executor_result',
        evidenceStrength: 'executor_receipt',
        success: true
      }
    }]),
    fileEffects: {
      contractVersion: 1,
      capture: 'host-turn-boundary',
      baselineDigest: 'b'.repeat(64),
      baselineCapturedAt: '2026-08-11T08:00:00.000Z',
      terminalCapturedAt: '2026-08-11T08:01:00.000Z',
      effects: [{
        contractVersion: 1,
        kind: 'created',
        path: 'outputs/penguins.csv',
        contentDigest: trustedDigest,
        byteLength: trustedBytes.byteLength,
        mediaType: 'text/csv',
        dataBase64: trustedBytes.toString('base64')
      }, {
        contractVersion: 1,
        kind: 'created',
        path: 'dist/foreign.js',
        contentDigest: foreignDigest,
        byteLength: foreignBytes.byteLength,
        mediaType: 'text/javascript',
        dataBase64: foreignBytes.toString('base64')
      }],
      issues: []
    },
    filePatchReceipts: [{
      contractVersion: 1,
      kind: 'host-authenticated-file-patch',
      issuer: 'sciforge.agent-runtime-host',
      source: 'codex-app-server-file-change',
      callId: 'call-1',
      executorSequence: 41,
      path: 'outputs/penguins.csv',
      operation: 'add',
      patchFormat: 'full-content',
      patchText: trustedBytes.toString('utf8'),
      patchDigest: trustedDigest
    }]
  }, recording, workspaceRoot, new Map())

  assert.deepEqual(extracted.filePlans.map((item) => item.path), ['outputs/penguins.csv'])
  assert.deepEqual(extracted.manifest.untrackedOperations.map((item) => item.itemId), ['call-1'])
  assert.equal(extracted.manifest.breakpoints.some((item) => (
    item.code === 'editor-change-untracked' && item.itemId === 'call-1'
  )), true)
  assert.equal(extracted.manifest.declaredFiles.some((item) => item.path === 'dist/foreign.js'), false)
  assert.equal(extracted.manifest.breakpoints.some((item) => (
    item.code === 'ambient-file-change-unattributed' && item.itemId === 'file:dist/foreign.js'
  )), true)
})

test('extracts research URLs only from durable user or assistant narrative, never tool payload markup', () => {
  const extracted = extractCheckpointFromTurn(event([{
    kind: 'user_message',
    text: 'Use the source-pinned study at https://doi.org/10.1371/journal.pone.0090081.'
  }, {
    kind: 'tool',
    itemId: 'svg-output',
    toolKind: 'file_change',
    status: 'success',
    detail: '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://attacker.invalid/tool-detail"/></svg>'
  }]), recording, workspaceRoot, new Map())

  assert.deepEqual(extracted.manifest.sources.map((source) => source.uri), [
    'https://doi.org/10.1371/journal.pone.0090081'
  ])
  assert.equal(extracted.manifest.sources.some((source) => source.uri.includes('w3.org')), false)
  assert.equal(extracted.manifest.sources.some((source) => source.uri.includes('attacker.invalid')), false)
})

test('does not treat a document namespace in the final answer as a research source', () => {
  const extracted = extractCheckpointFromTurn(event([{
    kind: 'assistant_message',
    text: 'Rendered <svg xmlns="http://www.w3.org/2000/svg"> from https://doi.org/10.1000/example.'
  }]), recording, workspaceRoot, new Map())

  assert.deepEqual(extracted.manifest.sources.map((source) => source.uri), [
    'https://doi.org/10.1000/example'
  ])
  assert.equal(extracted.manifest.breakpoints.some((item) => item.message.includes('w3.org')), false)
})

test('uses only the final durable assistant answer as the research narrative and source surface', () => {
  const extracted = extractCheckpointFromTurn(event([{
    kind: 'assistant_message',
    text: 'I am inspecting an implementation detail at https://internal.invalid/process.'
  }, {
    kind: 'tool',
    toolKind: 'tool_call',
    status: 'success',
    summary: 'completed analysis'
  }, {
    kind: 'user_message',
    text: 'Use the source-pinned study at https://doi.org/10.1371/journal.pone.0090081.'
  }, {
    kind: 'assistant_message',
    text: 'The final sensitivity analysis preserved the primary finding.'
  }, {
    kind: 'assistant_message',
    text: 'The conclusion remained stable across the prespecified checks.'
  }]), recording, workspaceRoot, new Map())

  assert.equal(
    extracted.manifest.narrative.canonicalText,
    'The final sensitivity analysis preserved the primary finding.\n\nThe conclusion remained stable across the prespecified checks.'
  )
  assert.deepEqual(extracted.manifest.sources.map((source) => source.uri), [
    'https://doi.org/10.1371/journal.pone.0090081'
  ])
})

test('clears a trusted file-change warning only after every path in the call is verified', () => {
  const outputs = [
    // An exact empty snapshot is verified data, not a missing snapshot.
    { path: 'outputs/empty.csv', bytes: Buffer.alloc(0), mediaType: 'text/csv' },
    { path: 'figures/summary.svg', bytes: Buffer.from('<svg><title>summary</title></svg>'), mediaType: 'image/svg+xml' }
  ] as const
  const callId = 'call-multi-path'
  const extracted = extractCheckpointFromTurn({
    ...event([{
      kind: 'tool',
      itemId: callId,
      toolKind: 'file_change',
      status: 'success',
      summary: 'File changes',
      detail: JSON.stringify(outputs.map((output) => ({ path: output.path, kind: 'add' })))
    }]),
    fileEffects: {
      contractVersion: 1,
      capture: 'host-turn-boundary',
      baselineDigest: 'b'.repeat(64),
      baselineCapturedAt: '2026-08-11T08:00:00.000Z',
      terminalCapturedAt: '2026-08-11T08:01:00.000Z',
      effects: outputs.map((output) => ({
        contractVersion: 1 as const,
        kind: 'created' as const,
        path: output.path,
        contentDigest: createHash('sha256').update(output.bytes).digest('hex'),
        byteLength: output.bytes.byteLength,
        mediaType: output.mediaType,
        dataBase64: output.bytes.toString('base64')
      })),
      issues: []
    },
    filePatchReceipts: outputs.map((output, index) => ({
      contractVersion: 1 as const,
      kind: 'host-authenticated-file-patch' as const,
      issuer: 'sciforge.agent-runtime-host' as const,
      source: 'codex-app-server-file-change' as const,
      callId,
      executorSequence: index + 1,
      path: output.path,
      operation: 'add' as const,
      patchFormat: 'full-content' as const,
      patchText: output.bytes.toString('utf8'),
      patchDigest: createHash('sha256').update(output.bytes).digest('hex')
    }))
  }, recording, workspaceRoot, new Map())

  const verifiedPlans = extracted.filePlans.map((plan, index): CheckpointFilePlan => ({
    ...plan,
    artifactId: `artifact:output-${index + 1}`,
    terminalSnapshot: {
      contentDigest: plan.declaredDigest!,
      byteLength: outputs[index]!.bytes.byteLength,
      mediaType: outputs[index]!.mediaType,
      dataBase64: outputs[index]!.bytes.toString('base64')
    }
  }))
  const attach = (manifest: typeof extracted.manifest, plan: CheckpointFilePlan, index: number) => withObservedFile(manifest, {
    plan,
    artifactOrdinal: 1,
    ref: {
      artifactId: plan.artifactId!,
      versionId: `artifact-version:output-${index + 1}`,
      contentDigest: plan.terminalSnapshot!.contentDigest,
      byteLength: plan.terminalSnapshot!.byteLength,
      mediaType: plan.terminalSnapshot!.mediaType,
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
    }
  })

  const partialPlans = [verifiedPlans[0]!, { ...verifiedPlans[1]!, terminalSnapshot: undefined }]
  const partialManifest = attach(extracted.manifest, partialPlans[0]!, 0)
  const partial = withVerifiedFileChangeAttribution(
    partialManifest,
    extracted.manifest,
    partialPlans,
    [partialPlans[0]!]
  )
  assert.deepEqual(partial.untrackedOperations.map((item) => item.itemId), [callId])

  const fullyObserved = verifiedPlans.reduce(attach, extracted.manifest)
  const complete = withVerifiedFileChangeAttribution(
    fullyObserved,
    extracted.manifest,
    verifiedPlans,
    verifiedPlans
  )
  assert.deepEqual(complete.untrackedOperations, [])
  assert.equal(complete.breakpoints.some((item) => item.code === 'editor-change-untracked'), false)
  assert.equal(complete.status.execution, 'not-applicable')
  assert.equal(complete.status.provenance, 'complete')

  const computeRef: ArtifactVersionRefV1 = {
    artifactId: 'artifact:compute-spec-file-attribution',
    versionId: 'artifact-version:compute-spec-file-attribution-v1',
    contentDigest: 'd'.repeat(64),
    byteLength: 32,
    mediaType: 'application/json',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
  for (const ownerStatus of [
    { provenance: 'incomplete', reproduction: 'fails-to-replicate' },
    { provenance: 'incomplete', reproduction: 'inconclusive' },
    { provenance: 'complete', reproduction: 'replicates' }
  ] as const) {
    const formalComputeManifest = {
      ...fullyObserved,
      computeRuns: [{ runId: 'compute-run:file-attribution', specRef: computeRef }],
      status: {
        ...fullyObserved.status,
        execution: 'mixed' as const,
        provenance: ownerStatus.provenance,
        control: 'partial' as const,
        reproduction: ownerStatus.reproduction
      }
    }
    const attributed = withVerifiedFileChangeAttribution(
      formalComputeManifest,
      extracted.manifest,
      verifiedPlans,
      verifiedPlans
    )
    assert.deepEqual(attributed.untrackedOperations, [])
    assert.equal(attributed.status.execution, 'formal-references-present')
    assert.equal(attributed.status.provenance, ownerStatus.provenance)
    assert.equal(attributed.status.control, 'partial')
    assert.equal(attributed.status.reproduction, ownerStatus.reproduction)
  }
})

test('a pure-text checkpoint never becomes complete through an empty file closure', () => {
  const extracted = extractCheckpointFromTurn(event([]), recording, workspaceRoot, new Map())
  assert.equal(extracted.manifest.declaredFiles.length, 0)
  assert.equal(extracted.manifest.artifactDependencies.length, 0)
  assert.equal(extracted.manifest.computeRuns.length, 0)

  const manifest = finalizeManifest(extracted.manifest)
  assert.equal(manifest.status.provenance, 'pending')
  assert.equal(manifest.status.control, 'untracked')
  assert.equal(manifest.status.reproduction, 'not-run')
})

test('an editor change keeps a checkpoint partial even when a formal Compute ref is present', () => {
  const extracted = extractCheckpointFromTurn(event([{
    kind: 'tool',
    toolKind: 'file_change',
    status: 'success',
    detail: JSON.stringify([{ path: 'reports/result.md', kind: 'update' }])
  }]), recording, workspaceRoot, new Map())
  const ref: ArtifactVersionRefV1 = {
    artifactId: 'artifact:compute-spec',
    versionId: 'artifact-version:compute-spec-v1',
    contentDigest: 'b'.repeat(64),
    byteLength: 10,
    mediaType: 'application/json',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
  const manifest = finalizeManifest({
    ...extracted.manifest,
    computeRuns: [{ runId: 'compute-run:formal', specRef: ref }],
    status: {
      ...extracted.manifest.status,
      execution: 'formal-references-present',
      control: 'isolated-attested'
    }
  })
  assert.equal(manifest.status.control, 'partial')
})

test('finalization never hides an owner-reported replication failure behind eligible', () => {
  const extracted = extractCheckpointFromTurn(event([]), recording, workspaceRoot, new Map())
  const ref: ArtifactVersionRefV1 = {
    artifactId: 'artifact:compute-spec',
    versionId: 'artifact-version:compute-spec-v2',
    contentDigest: 'c'.repeat(64),
    byteLength: 10,
    mediaType: 'application/json',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
  const manifest = finalizeManifest({
    ...extracted.manifest,
    computeRuns: [{ runId: 'compute-run:failed-replication', specRef: ref }],
    status: {
      ...extracted.manifest.status,
      execution: 'formal-references-present',
      provenance: 'incomplete',
      control: 'isolated-attested',
      reproduction: 'fails-to-replicate'
    }
  })
  assert.equal(manifest.status.reproduction, 'fails-to-replicate')
  assert.equal(manifest.status.provenance, 'incomplete')
})
