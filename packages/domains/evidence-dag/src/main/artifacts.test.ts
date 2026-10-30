import assert from 'node:assert/strict'
import test from 'node:test'

import { evidenceTraceFromArtifactEvent } from './artifacts.js'

test('preserves a completed turn as opaque Evidence trace input', () => {
  const trace = evidenceTraceFromArtifactEvent({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    targetWatermark: '7',
    occurredAt: '2026-08-05T00:00:00.000Z',
    artifacts: [{ type: 'assistant_message', text: 'Conclusion.' }]
  })
  assert.equal(trace.length, 1)
  assert.equal(trace[0]!.id, 'turn-1:artifact:0')
  assert.deepEqual(trace[0]!.sciforgeEvidenceEvent, {
    eventKind: 'turn-completed',
    turnId: 'turn-1',
    occurredAt: '2026-08-05T00:00:00.000Z',
    targetWatermark: '7'
  })
})

test('preserves the generic execution event and its deterministic lineage metadata', () => {
  const outputJson = JSON.stringify({
    evidenceLineage: {
      evidence: [{ id: 'evidence-9', type: 'finding', name: 'Observed result' }],
      conclusions: [{ id: 'conclusion-9', name: 'Declared conclusion' }]
    }
  })
  const manifestArtifact = {
    kind: 'sciforge.create-loop.run-manifest',
    manifest: {
      schema: 'sciforge.create-loop.run.v2',
      outputJson
    }
  }
  const specArtifact = {
    kind: 'sciforge.repro-spec',
    spec: {
      schemaVersion: 'sciforge.rerun.v1',
      specDigest: `sha256:${'a'.repeat(64)}`
    }
  }
  const execution = {
    schemaVersion: 'sciforge.execution-event.v1',
    eventId: 'event-9',
    phase: 'run_completed',
    producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
    executionId: 'workflow-9',
    runId: 'run-9',
    occurredAt: '2026-08-05T00:00:00.000Z',
    artifacts: [manifestArtifact, specArtifact]
  }
  const trace = evidenceTraceFromArtifactEvent({
    contractVersion: 1,
    kind: 'execution-completed',
    hostBinding: {
      contractVersion: 1,
      acceptanceSequence: 1,
      workspaceBinding: 'unbound'
    },
    producer: execution.producer,
    executionId: execution.executionId,
    runId: execution.runId,
    targetWatermark: `1:${execution.eventId}`,
    occurredAt: execution.occurredAt,
    artifacts: [execution, ...execution.artifacts]
  })
  assert.equal(trace.length, 3)
  assert.equal(trace[0]!.id, 'execution:workflow-9:run-9:artifact:0')
  assert.equal(trace[0]!.schemaVersion, 'sciforge.execution-event.v1')
  assert.deepEqual(trace[0]!.artifacts, [manifestArtifact, specArtifact])
  const preservedManifest = (trace[0]!.artifacts as typeof execution.artifacts)[0]!
  assert.ok('manifest' in preservedManifest)
  assert.equal(preservedManifest.manifest.outputJson, outputJson)
  assert.deepEqual(
    { kind: trace[1]!.kind, manifest: trace[1]!.manifest },
    manifestArtifact
  )
  assert.deepEqual(
    { kind: trace[2]!.kind, spec: trace[2]!.spec },
    specArtifact
  )
  assert.deepEqual(trace[0]!.sciforgeEvidenceEvent, {
    trustedBoundary: 'sciforge.host.execution-completed.v1',
    eventKind: 'execution-completed',
    hostBinding: {
      contractVersion: 1,
      acceptanceSequence: 1,
      workspaceBinding: 'unbound'
    },
    producer: execution.producer,
    executionId: 'workflow-9',
    runId: 'run-9',
    runtimeId: 'domain:sciforge.create-loop',
    threadId: 'execution:workflow-9',
    occurredAt: '2026-08-05T00:00:00.000Z',
    targetWatermark: '1:event-9'
  })
})

test('does not mint a trusted execution marker for a split explicit scope', () => {
  const [item] = evidenceTraceFromArtifactEvent({
    contractVersion: 1,
    kind: 'execution-completed',
    hostBinding: {
      contractVersion: 1,
      acceptanceSequence: 2,
      workspaceBinding: 'unbound'
    },
    producer: { moduleId: 'producer', moduleVersion: '1.0.0' },
    executionId: 'execution-2',
    runId: 'run-2',
    runtimeId: 'runtime-without-thread',
    targetWatermark: '2:event-2',
    occurredAt: '2026-08-05T00:00:00.000Z',
    artifacts: [{}]
  })
  assert.equal(
    (item!.sciforgeEvidenceEvent as Record<string, unknown>).trustedBoundary,
    undefined
  )
})
