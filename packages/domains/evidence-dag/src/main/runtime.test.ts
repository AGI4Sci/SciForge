import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { evidenceDagWatermarkCoversValue } from '../contract.js'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  EvidenceDagRuntime,
  evidenceDagWorkspaceRoot,
  updateEvidenceDagVisibleSurfaces
} from './runtime.js'
import {
  EvidenceDagDeltaStore,
  evidenceDagDeltaInputFromTrace
} from './evidence-delta.js'
import { evidenceDagThreadId } from './client.js'
import type { EvidenceDagSidecarPort } from './sidecar.js'

test('reconciles pending work only when the committed watermark fully covers its target', () => {
  assert.equal(evidenceDagWatermarkCoversValue('186', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('186:batch:1/4', '186'), false)
  assert.equal(evidenceDagWatermarkCoversValue('186:batch:4/4', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('200', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('185', '186'), false)
  assert.equal(evidenceDagWatermarkCoversValue('7', '7:artifact-lifecycle:1'), false)
  assert.equal(evidenceDagWatermarkCoversValue('8', '7:artifact-lifecycle:1'), false)
  assert.equal(
    evidenceDagWatermarkCoversValue('7:artifact-lifecycle:1', '7:artifact-lifecycle:1'),
    true
  )
  assert.equal(evidenceDagWatermarkCoversValue('20:event-new', '19:event-old'), true)
  assert.equal(evidenceDagWatermarkCoversValue('19:event-old', '20:event-new'), false)
  assert.equal(
    evidenceDagWatermarkCoversValue('20:event-new:batch:3/4', '20:event-new:batch:1/4'),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '2026-07-26T07:00:00.000Z',
      '2026-07-26T06:00:00.000Z'
    ),
    true
  )
})

test('requires one unambiguous workspace scope for an update', () => {
  assert.equal(evidenceDagWorkspaceRoot('/workspace', undefined), '/workspace')
  assert.equal(evidenceDagWorkspaceRoot(undefined, '/workspace'), '/workspace')
  assert.throws(
    () => evidenceDagWorkspaceRoot('/workspace/a', '/workspace/b'),
    /does not match/
  )
  assert.throws(
    () => evidenceDagWorkspaceRoot(undefined, undefined),
    /requires a workspace root/
  )
})

test('keeps a thread prioritized until its last visible surface closes', () => {
  const visibleSurfacesByThread = new Map<string, Set<string>>()

  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-a',
    true
  ), true)
  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-b',
    true
  ), true)
  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-a',
    false
  ), true)
  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-b',
    false
  ), false)
})

test('appends a durable delta without publishing a per-turn full Snapshot', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-background-'))
  const events: string[] = []
  const sidecar: EvidenceDagSidecarPort = {
    configure: () => undefined,
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
    ensureReady: async () => {
      events.push('ensure')
    },
    stop: async () => undefined
  }
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar,
    fetchImpl: async (url) => {
      assert.equal(new URL(String(url)).pathname, '/updates')
      events.push('submit')
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'codex:thread-1',
            version: 1,
            digest: `sha256:${'a'.repeat(64)}`,
            inputWatermark: '7',
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [],
            createdAt: '2026-07-26T06:00:00.000Z',
            status: 'committed'
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  await runtime.activate(runtimeContext(userDataDir))
  await Promise.resolve()
  events.length = 0

  await runtime.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    targetWatermark: '7',
    occurredAt: '2026-07-26T06:00:00.000Z',
    workspaceRoot: '/workspace',
    artifacts: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }]
  })
  const persisted = JSON.parse(await readFile(
    join(userDataDir, 'evidence-dag', 'deltas.json'),
    'utf8'
  )) as { chains: Array<{ threadId: string; records: Array<Record<string, unknown>> }> }
  assert.deepEqual(events, [])
  assert.equal(persisted.chains[0]?.threadId, 'codex:thread-1')
  assert.deepEqual(persisted.chains[0]?.records[0]?.scope, {
    runtimeId: 'codex',
    threadId: 'codex:thread-1',
    operationId: 'turn-1',
    kind: 'turn',
    workspaceRoot: '/workspace'
  })
  assert.equal(persisted.chains[0]?.records[0]?.committedWatermark, '7')
  await runtime.close()
})

test('replays an identical completed event idempotently in the durable delta chain', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-replay-'))
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    }
  })
  await runtime.activate(runtimeContext(userDataDir))
  const event = {
    contractVersion: 1 as const,
    kind: 'turn-completed' as const,
    runtimeId: 'codex',
    threadId: 'thread-replay',
    turnId: 'turn-replay',
    targetWatermark: '9',
    occurredAt: '2026-09-01T00:00:00.000Z',
    workspaceRoot: '/workspace',
    artifacts: [{ id: 'answer-replay', kind: 'assistant_message', text: 'same' }]
  }
  await runtime.consume(event)
  await runtime.consume({
    ...event,
    turnId: 'turn-replay-newer',
    targetWatermark: '10',
    artifacts: [{ id: 'answer-replay-newer', kind: 'assistant_message', text: 'newer' }]
  })
  await runtime.consume(event)
  const persisted = JSON.parse(await readFile(
    join(userDataDir, 'evidence-dag', 'deltas.json'),
    'utf8'
  )) as { chains: Array<{ records: Array<Record<string, unknown>>; provisional?: Record<string, unknown> }> }
  assert.equal(persisted.chains[0]?.records.length, 2)
  assert.equal(
    persisted.chains[0]?.provisional?.desiredHeadDigest,
    persisted.chains[0]?.records[1]?.deltaDigest
  )
  await runtime.close()
})

test('does not enqueue an artifact event that has no workspace scope', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-unscoped-'))
  let submitted = false
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async () => {
      submitted = true
      throw new Error('Unscoped artifact events must not reach the service.')
    }
  })
  await runtime.activate(runtimeContext(userDataDir))
  await runtime.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    targetWatermark: '7',
    occurredAt: '2026-07-26T06:00:00.000Z',
    artifacts: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }]
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(submitted, false)
  await runtime.close()
})

test('reads the local delta head and provisional view without waiting for the Evidence sidecar', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-status-'))
  const runtimeId = 'domain:sciforge.create-loop'
  const threadId = 'execution:execution-1'
  const deltaStore = new EvidenceDagDeltaStore(join(userDataDir, 'evidence-deltas.json'))
  await deltaStore.append(evidenceDagDeltaInputFromTrace({
    runtimeId,
    // Synthetic execution scopes are keyed by the same canonical identity
    // used by the runtime status reader.
    threadId: evidenceDagThreadId(runtimeId, threadId),
    operationId: 'execution-1',
    kind: 'execution',
    requestedWatermark: '1:event-1',
    idempotencyKey: 'execution-status-1',
    workspaceRoot: '/workspace',
    trace: [{ id: 'execution-1' }]
  }))
  let ensureCalls = 0
  let fetchCalls = 0
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    deltaStore,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => {
        ensureCalls += 1
        throw new Error('Evidence sidecar is unavailable.')
      },
      stop: async () => undefined
    },
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('Evidence sidecar is unavailable.')
    }
  })
  const baseContext = runtimeContext(userDataDir)
  await runtime.activate({
    ...baseContext,
    agentThreads: {
      ...baseContext.agentThreads,
      read: async () => {
        throw new Error('Synthetic execution scope has no Agent thread.')
      }
    }
  })
  await Promise.resolve()
  const activationEnsureCalls = ensureCalls

  const status = await runtime.snapshotStatus({
    runtimeId,
    threadId,
    workspaceRoot: '/workspace'
  })
  assert.equal(status.authoritativeHead?.headDigest, (await deltaStore.head(
    evidenceDagThreadId(runtimeId, threadId)
  )).headDigest)
  assert.equal(status.provisional?.summary.freshness, 'fresh')
  assert.equal(status.committed, null)
  assert.equal(status.pending, null)
  assert.equal(Number.isNaN(Date.parse(status.updatedAt)), false)
  assert.equal(ensureCalls, activationEnsureCalls)
  assert.equal(fetchCalls, 0)
  const mismatched = await runtime.snapshotStatus({
    runtimeId,
    threadId,
    workspaceRoot: '/different-workspace'
  })
  assert.equal(mismatched.authoritativeHead, undefined)
  assert.equal(mismatched.provisional, undefined)
  assert.equal(mismatched.committed, null)
  assert.equal(mismatched.pending, null)
  assert.equal(ensureCalls, activationEnsureCalls)
  await runtime.close()
})

test('does not leak local delta state when Agent authority has no workspace binding', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-unbound-status-'))
  const deltaStore = new EvidenceDagDeltaStore(join(userDataDir, 'evidence-deltas.json'))
  await deltaStore.append(evidenceDagDeltaInputFromTrace({
    runtimeId: 'codex',
    threadId: 'thread-1',
    operationId: 'turn-1',
    kind: 'turn',
    requestedWatermark: '7',
    idempotencyKey: 'unbound-status-1',
    workspaceRoot: '/workspace/a',
    trace: [{ id: 'workspace-a-artifact' }]
  }))
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    deltaStore,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    }
  })
  await runtime.activate(runtimeContext(userDataDir))

  const status = await runtime.snapshotStatus({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace/b'
  })
  assert.equal(status.committed, null)
  assert.equal(status.pending, null)
  await runtime.close()
})

test('appends a threadless execution delta through the canonical synthetic scope', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-execution-'))
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async () => {
      throw new Error('Automatic execution capture must not publish a full Snapshot.')
    }
  })
  await runtime.activate(runtimeContext(userDataDir))
  await runtime.consume({
    contractVersion: 1,
    kind: 'execution-completed',
    producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
    executionId: 'workflow-9',
    runId: 'run-9',
    targetWatermark: 'event-9',
    workspaceRoot: '/workspace',
    occurredAt: '2026-08-05T00:00:00.000Z',
    artifacts: [{
      schemaVersion: 'sciforge.execution-event.v1',
      eventId: 'event-9',
      phase: 'run_completed'
    }]
  })
  const persisted = JSON.parse(await readFile(
    join(userDataDir, 'evidence-dag', 'deltas.json'),
    'utf8'
  )) as { chains: Array<{ threadId: string; records: Array<Record<string, unknown>> }> }
  assert.equal(
    persisted.chains[0]?.threadId,
    'domain:sciforge.create-loop:execution:workflow-9'
  )
  assert.deepEqual(persisted.chains[0]?.records[0]?.runRefs, ['run-9'])
  assert.equal(persisted.chains[0]?.records[0]?.committedWatermark, 'event-9')
  await runtime.close()
})

function runtimeContext(
  userDataDir: string,
  workspaceRoot?: string,
  withArtifact = false
): DomainMainRuntimeLifecycleContext {
  return {
    owner: { moduleId: 'sciforge.evidence-dag', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    userDataDir,
    appRoot: '/workspace/app',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        watermark: '7',
        turns: [],
        artifacts: withArtifact
          ? [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }]
          : [],
        ...(workspaceRoot ? { workspaceRoot } : {})
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => {
        throw new Error('Unexpected capability invocation.')
      },
      createApprovedBatch: () => {
        throw new Error('Unexpected capability invocation.')
      }
    },
    modelAccess: {
      textReasoner: async () => ({
        baseUrl: 'http://127.0.0.1:3892/v1',
        apiKey: 'router-key',
        model: 'sciforge-router'
      })
    },
    executionEvents: {
      publish: async () => { throw new Error('Unexpected execution event.') }
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}
