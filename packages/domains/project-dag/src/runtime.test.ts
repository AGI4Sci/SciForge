import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  EVIDENCE_DAG_CAPABILITY_IDS
} from '@sciforge/domain-evidence-dag/contract'
import {
  normalizeProjectDagStatus,
  ProjectDagRuntime,
  ProjectDagRuntimeError
} from './runtime.js'
import type {
  ProjectDagSidecar,
  ProjectDagSidecarConfig
} from './sidecar.js'

const now = '2026-07-26T05:30:20.000Z'
const evidenceDigest = `sha256:${'a'.repeat(64)}`
const projectDigest = `project:${'b'.repeat(64)}`
const fingerprint = `project-update-desired:${'c'.repeat(64)}`
const projectKey = 'path:/workspace'

function scope() {
  return {
    includedSessions: ['codex:thread-1'],
    excludedSessions: [],
    isolatedSessions: []
  }
}

function receipt(state: 'queued' | 'failed' = 'queued') {
  return {
    projectKey,
    jobId: 'pjob_0123456789ab',
    acceptedRequestVersion: 2,
    desiredFingerprint: fingerprint,
    desiredEvidenceVector: [
      { threadId: 'codex:thread-1', digest: evidenceDigest }
    ],
    capturedScope: scope(),
    state,
    acceptedAt: now,
    updatedAt: now,
    attempts: state === 'failed' ? 5 : 0,
    lastError: state === 'failed' ? 'compile failed' : null
  }
}

test('canonical status preserves committed graph beside a failed pending generation', () => {
  const status = normalizeProjectDagStatus({
    projectKey,
    state: 'update_failed',
    committedSnapshot: {
      version: 27,
      digest: projectDigest,
      evidenceVector: [
        { threadId: 'codex:thread-1', digest: evidenceDigest }
      ],
      excludedSessions: [],
      isolatedSessions: [],
      createdAt: now
    },
    latestReceipt: receipt('failed'),
    activeReceipt: receipt('failed'),
    autonomy: { autonomy_mode: 'checkpointed' },
    attentionCount: 3
  })

  assert.equal(status.committed?.version, 27)
  assert.equal(status.pending?.state, 'failed')
  assert.equal(status.pending?.error?.code, 'project_compile_failed')
})

test('runtime fails closed when generic text reasoning access is unavailable', async () => {
  let fetched = false
  const logged: string[] = []
  const runtime = new ProjectDagRuntime({
    fetchImpl: async () => {
      fetched = true
      return jsonResponse({})
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({
    environment: {
      EDAG_MODEL_ROUTER_BASE_URL: 'http://stale-domain-env/v1',
      EDAG_MODEL_ROUTER_API_KEY: 'stale-domain-key',
      EDAG_MODEL_ROUTER_MODEL: 'stale-domain-model'
    },
    modelAccess: {
      textReasoner: async () => null
    },
    log: (entry) => logged.push(entry.message)
  }))

  await assert.rejects(
    runtime.view({ workspaceRoot: '/workspace' }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectDagRuntimeError)
      assert.equal(error.error.code, 'upstream_unavailable')
      assert.match(error.error.message, /requires configured text reasoning model access/u)
      return true
    }
  )
  assert.equal(fetched, false)
  assert.deepEqual(logged, ['Project DAG sidecar is not ready.'])
  await deactivate()
})

test('manual update reads committed Evidence through its public capability and posts once', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = []
  let statusReads = 0
  const config = sidecarConfig()
  const sidecar = {
    ensure: async () => config,
    stop: async () => undefined
  } as unknown as ProjectDagSidecar
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ url, method, ...(body === undefined ? {} : { body }) })
    if (url.includes('/updates/status')) {
      statusReads += 1
      return jsonResponse(statusReads === 1
        ? emptyStatus()
        : { ...emptyStatus(), state: 'pending', latestReceipt: receipt(), activeReceipt: receipt() })
    }
    if (url.endsWith('/updates') && method === 'POST') return jsonResponse(receipt())
    throw new Error(`Unexpected request: ${method} ${url}`)
  }
  const invoked: string[] = []
  const runtime = new ProjectDagRuntime({ sidecar, fetchImpl })
  const deactivate = await runtime.activate(lifecycleContext({
    capabilities: {
      invoke: async <TInput, TOutput>(contract: { actionId: string }) => {
        invoked.push(contract.actionId)
        return {
          committed: {
            threadId: 'codex:thread-1',
            version: 3,
            digest: evidenceDigest,
            inputWatermark: '186:batch:1/4',
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [],
            createdAt: now
          },
          pending: null,
          updatedAt: now
        } as TOutput
      },
      createApprovedBatch: () => {
        throw new Error('Unexpected approved capability batch.')
      }
    }
  }))

  const result = await runtime.update({
    workspaceRoot: '/workspace',
    scope: ['codex:thread-1']
  })

  assert.equal(result.receipt.jobId, 'pjob_0123456789ab')
  assert.deepEqual(invoked, [EVIDENCE_DAG_CAPABILITY_IDS.snapshotStatus])
  const post = requests.find(({ url, method }) => url.endsWith('/updates') && method === 'POST')
  assert.deepEqual((post?.body as { evidenceVector?: unknown }).evidenceVector, [
    { threadId: 'codex:thread-1', digest: evidenceDigest }
  ])
  assert.equal(requests.filter(({ url, method }) => url.endsWith('/updates') && method === 'POST').length, 1)
  await deactivate()
})

test('artifact events only invalidate Project and never enqueue or compile per Evidence', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = []
  let invalidationRecorded!: () => void
  const invalidation = new Promise<void>((resolve) => { invalidationRecorded = resolve })
  const config = sidecarConfig()
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input, init) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, method: init?.method ?? 'GET', ...(body === undefined ? {} : { body }) })
      if (url.endsWith('/invalidation')) {
        invalidationRecorded()
        return jsonResponse({ projectKey, stale: true, changedFields: ['evidenceVector'], updatedAt: now })
      }
      throw new Error(`Unexpected Project request: ${url}`)
    }
  })
  const deactivate = await runtime.activate(lifecycleContext())
  await runtime.consumeArtifact({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-186',
    targetWatermark: '186',
    workspaceRoot: '/workspace',
    occurredAt: now,
    artifacts: []
  })
  await invalidation
  assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
    { url: `${config.baseUrl}/invalidation`, method: 'POST' }
  ])
  await deactivate()
})

test('execution invalidation requires the Host workspace binding', async () => {
  const requests: string[] = []
  const config = sidecarConfig()
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input) => {
      requests.push(String(input))
      return jsonResponse({ projectKey, stale: true, changedFields: ['evidenceVector'], updatedAt: now })
    }
  })
  const deactivate = await runtime.activate(lifecycleContext())
  await assert.rejects(runtime.consumeArtifact({
    contractVersion: 1,
    kind: 'execution-completed',
    producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
    executionId: 'execution-forged',
    runId: 'run-forged',
    targetWatermark: 'opaque:event-forged',
    workspaceRoot: '/workspace',
    occurredAt: now,
    artifacts: []
  }), (error: unknown) => error instanceof ProjectDagRuntimeError &&
    error.error.code === 'access_restricted')
  assert.deepEqual(requests, [])
  await deactivate()
})

test('manual updates reject implicit workspace-wide Session discovery', async () => {
  let listCalls = 0
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async () => jsonResponse(emptyStatus())
  })
  const base = lifecycleContext()
  const deactivate = await runtime.activate(lifecycleContext({
    agentThreads: {
      ...base.agentThreads,
      list: async () => {
        listCalls += 1
        throw new Error('Project update must not scan workspace Agent threads.')
      }
    }
  }))
  await assert.rejects(
    runtime.update({ workspaceRoot: '/workspace', scope: 'all' }),
    (error: unknown) => error instanceof ProjectDagRuntimeError && error.error.code === 'invalid_request'
  )
  assert.equal(listCalls, 0)
  await deactivate()
})

function sidecarConfig(): ProjectDagSidecarConfig {
  return {
    baseUrl: 'http://127.0.0.1:3898',
    runtimeToken: 'project-token',
    command: 'python',
    args: [],
    cwd: '/app/packages/domains/project-dag',
    env: {},
    projectPackageRoot: '/app/packages/domains/project-dag',
    evidencePackageRoot: '/app/packages/domains/evidence-dag',
    sessionDir: '/data/evidence',
    dbPath: '/data/project.db',
    autoStart: false
  }
}

function emptyStatus() {
  return {
    projectKey,
    state: 'empty',
    committedSnapshot: null,
    latestReceipt: null,
    activeReceipt: null,
    autonomy: { autonomy_mode: 'checkpointed' },
    attentionCount: 0
  }
}

function lifecycleContext(
  overrides: Partial<DomainMainRuntimeLifecycleContext> = {}
): DomainMainRuntimeLifecycleContext {
  return {
    owner: { moduleId: 'sciforge.project-dag', moduleVersion: '1.0.0' },
    userDataDir: '/data',
    appRoot: '/app',
    environment: {},
    signal: new AbortController().signal,
    agentThreads: {
      list: async () => [],
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
        workspaceRoot: '/workspace',
        watermark: '186',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => {
        throw new Error('Unexpected capability invocation.')
      },
      createApprovedBatch: () => {
        throw new Error('Unexpected approved capability batch.')
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
      publish: async () => {
        throw new Error('Unexpected execution event publication.')
      }
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined,
    ...overrides
  } as DomainMainRuntimeLifecycleContext
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
