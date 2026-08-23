import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import { evidenceDagWatermarkCoversValue } from '../contract.js'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  EvidenceDagRuntime,
  evidenceDagWorkspaceRoot,
  updateEvidenceDagVisibleSurfaces
} from './runtime.js'
import { EvidenceDagQueue } from './queue.js'
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

test('ensures the sidecar immediately before a background queue submission', async () => {
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
  await waitFor(() => events.includes('submit'))

  assert.deepEqual(events.slice(0, 2), ['ensure', 'submit'])
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

test('reads snapshot status without waiting for the Evidence sidecar', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-status-'))
  const runtimeId = 'domain:sciforge.create-loop'
  const threadId = 'execution:execution-1'
  const engineThreadId = `${runtimeId}:${threadId}`
  const queue = new EvidenceDagQueue({
    storagePath: join(userDataDir, 'evidence-status-queue.json'),
    submit: async (input) => ({
      threadId: input.engineThreadId,
      version: 1,
      digest: `sha256:${'a'.repeat(64)}`,
      inputWatermark: input.targetWatermark,
      schemaVersion: '1',
      extractorVersion: '1',
      verifierVersion: '1',
      artifactDigests: [],
      createdAt: '2026-07-26T06:00:00.000Z'
    })
  })
  await queue.start(false)
  await queue.enqueue({
    runtimeId,
    threadId,
    engineThreadId,
    targetWatermark: '1:event-1',
    reason: 'execution_completed',
    priority: 'background',
    workspaceRoot: '/workspace',
    trace: [{ id: 'execution-1' }]
  })
  let ensureCalls = 0
  let fetchCalls = 0
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    queue,
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
  assert.equal(Boolean(status.committed || status.pending), true)
  assert.equal(Number.isNaN(Date.parse(status.updatedAt)), false)
  assert.equal(ensureCalls, activationEnsureCalls)
  assert.equal(fetchCalls, 0)
  await assert.rejects(
    () => runtime.snapshotStatus({
      runtimeId,
      threadId,
      workspaceRoot: '/different-workspace'
    }),
    /does not match/
  )
  assert.equal(ensureCalls, activationEnsureCalls)
  await runtime.close()
})

test('does not leak queue state when Agent authority has no workspace binding', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-unbound-status-'))
  const queue = new EvidenceDagQueue({
    storagePath: join(userDataDir, 'evidence-unbound-status-queue.json'),
    submit: async () => {
      throw new Error('The adversarial status test must not submit queue work.')
    }
  })
  await queue.start(false)
  await queue.enqueue({
    runtimeId: 'codex',
    threadId: 'thread-1',
    engineThreadId: 'codex:thread-1',
    targetWatermark: '7',
    reason: 'turn_committed',
    priority: 'background',
    workspaceRoot: '/workspace/a',
    trace: [{ id: 'workspace-a-artifact' }]
  })
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    queue,
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

test('routes a threadless completed execution through the canonical synthetic scope', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-execution-'))
  const submissions: Record<string, unknown>[] = []
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async (_url, init) => {
      submissions.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'domain:sciforge.create-loop:execution:workflow-9',
            version: 1,
            digest: `sha256:${'a'.repeat(64)}`,
            inputWatermark: 'event-9',
            schemaVersion: 'evidence.v3',
            extractorVersion: 'extractor.v3',
            verifierVersion: 'verifier.v3',
            artifactDigests: [],
            createdAt: '2026-08-05T00:00:00.000Z',
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
  await waitFor(() => submissions.length === 1)
  assert.equal(
    submissions[0]!.threadId,
    'domain:sciforge.create-loop:execution:workflow-9'
  )
  assert.equal(submissions[0]!.reason, 'execution_completed')
  assert.equal(
    (submissions[0]!.trace as Array<Record<string, unknown>>)[0]!.id,
    'execution:workflow-9:run-9:artifact:0'
  )
  await runtime.close()
})

test('stops an owned sidecar before the durable queue retries a timed-out POST', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-timeout-'))
  const events: string[] = []
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => {
        events.push('ensure')
      },
      stop: async () => {
        events.push('stop')
      }
    },
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname
      if (path === '/updates/status') {
        return new Response(JSON.stringify({ ok: true, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      events.push('submit')
      return new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'upstream_timeout',
          message: 'The model request timed out.',
          retryable: true
        }
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  await runtime.activate(runtimeContext(userDataDir, undefined, true))
  events.length = 0

  await runtime.update({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace'
  })
  await waitFor(() => events.includes('stop'))

  assert.deepEqual(events.slice(0, 4), ['ensure', 'ensure', 'submit', 'stop'])
  await runtime.close()
})

test('manual update carries the panel workspace through the queue to the service', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-manual-'))
  const submitted: Record<string, unknown>[] = []
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async (url, init) => {
      if (new URL(String(url)).pathname === '/updates/status') {
        return new Response(JSON.stringify({ ok: true, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      submitted.push(JSON.parse(String(init?.body)))
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
            createdAt: '2026-07-26T06:00:00.000Z'
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  await runtime.activate(runtimeContext(userDataDir, undefined, true))
  await runtime.update({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace/from-panel'
  })
  await waitFor(() => submitted.length === 1)
  assert.equal(submitted[0]?.workspaceRoot, '/workspace/from-panel')
  assert.equal('projectKey' in submitted[0]!, false)
  await runtime.close()
})

test('activation proactively consumes ArtifactVersion lifecycle into a new queued snapshot', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-lifecycle-'))
  const bytes = Buffer.from('dataset bytes', 'utf8')
  const ref: ArtifactVersionRefV1 = {
    artifactId: 'artifact:dataset',
    versionId: 'artifact-version:dataset-1',
    contentDigest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'text/csv',
    availability: 'available',
    retention: 'reference',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
  const submitted: Record<string, unknown>[] = []
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    artifactVersionCommitPort: {
      commit: async () => { throw new Error('Explicit refs must not commit.') }
    },
    artifactVersionReadPort: {
      read: async () => ({
        ok: true,
        value: {
          artifact: {
            artifactId: ref.artifactId,
            kind: 'dataset',
            createdAt: '2026-08-06T08:00:00.000Z',
            updatedAt: '2026-08-06T08:00:00.000Z',
            currentVersionId: ref.versionId,
            versionCount: 1
          },
          version: {
            schemaVersion: 1,
            versionId: ref.versionId,
            artifactId: ref.artifactId,
            sequence: 1,
            transactionId: 'artifact-commit:dataset',
            createdAt: '2026-08-06T08:00:00.000Z',
            intent: 'observe',
            storage: {
              mode: 'reference',
              locator: 'workspace:data/dataset.csv',
              contentDigest: ref.contentDigest,
              byteLength: ref.byteLength,
              mediaType: ref.mediaType,
              availability: ref.availability
            },
            dependencies: [],
            accessPolicy: ref.accessPolicy,
            metadata: {}
          },
          ref,
          dataBase64: bytes.toString('base64')
        }
      })
    },
    artifactVersionEventListPort: {
      listEvents: async (input) => input.afterSequence === 1
        ? { ok: true, value: { events: [], lastSequence: 1 } }
        : {
            ok: true,
            value: {
              events: [{
                schemaVersion: 1,
                eventId: 'artifact-event:moved-1',
                sequence: 1,
                type: 'artifact-moved',
                artifactId: ref.artifactId,
                versionId: ref.versionId,
                createdAt: '2026-08-06T08:00:00.000Z',
                detail: { locator: 'workspace:data/moved.csv' }
              }],
              lastSequence: 1
            }
          }
    },
    artifactVersionLifecyclePollIntervalMs: 60_000,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      submitted.push(body)
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'codex:thread-1',
            version: 2,
            digest: `sha256:${'b'.repeat(64)}`,
            inputWatermark: body.targetWatermark,
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [ref.contentDigest],
            createdAt: '2026-08-06T08:00:01.000Z'
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  const base = runtimeContext(userDataDir)
  await runtime.activate({
    ...base,
    agentThreads: {
      list: async () => [{
        id: 'thread-1', runtimeId: 'codex', workspaceRoot: '/workspace'
      }],
      read: async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        workspaceRoot: '/workspace',
        watermark: '7',
        turns: [],
        artifacts: [{ id: 'dataset', artifactVersionRef: ref }]
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    }
  })
  await waitFor(() => submitted.length === 1)

  assert.equal(submitted[0]?.reason, 'artifact_version_lifecycle')
  assert.equal(submitted[0]?.targetWatermark, '7:artifact-lifecycle:1')
  const trace = submitted[0]?.trace as Array<Record<string, unknown>>
  const projection = trace[0]?.evidenceArtifactVersions as {
    lifecycleEvents: Array<{ type: string }>
  }
  assert.deepEqual(projection.lifecycleEvents.map((event) => event.type), ['artifact-moved'])
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
