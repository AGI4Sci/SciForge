import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { ProjectDagHandoffOutbox } from './handoff-outbox.js'
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
    autoProcessHandoffs: false,
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
      assert.match(
        error.error.message,
        /requires configured text reasoning model access/u
      )
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
  const config: ProjectDagSidecarConfig = {
    baseUrl: 'http://127.0.0.1:3898',
    runtimeToken: 'project-token',
    command: 'npm',
    args: [],
    cwd: '/app',
    env: {},
    projectPackageRoot: '/app/packages/domains/project-dag',
    evidencePackageRoot: '/app/packages/domains/evidence-dag',
    sessionDir: '/data/evidence',
    dbPath: '/data/project.db',
    autoStart: false
  }
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
        ? {
            projectKey,
            state: 'empty',
            committedSnapshot: null,
            latestReceipt: null,
            activeReceipt: null,
            autonomy: { autonomy_mode: 'checkpointed' },
            attentionCount: 0
          }
        : {
            projectKey,
            state: 'pending',
            committedSnapshot: null,
            latestReceipt: receipt(),
            activeReceipt: receipt(),
            autonomy: { autonomy_mode: 'checkpointed' },
            attentionCount: 0
          })
    }
    if (url.endsWith('/updates') && method === 'POST') return jsonResponse(receipt())
    throw new Error(`Unexpected request: ${method} ${url}`)
  }
  const invoked: string[] = []
  const context = lifecycleContext({
    capabilities: {
      invoke: async <TInput, TOutput>(contract: { actionId: string }) => {
        invoked.push(contract.actionId)
        return {
          url: 'http://127.0.0.1:3897/',
          threadId: 'thread-1',
          status: {
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
          }
        } as TOutput
      }
    }
  })
  const runtime = new ProjectDagRuntime({ sidecar, fetchImpl })
  const deactivate = await runtime.activate(context)
  const result = await runtime.update({
    workspaceRoot: '/workspace',
    scope: 'all'
  })

  assert.equal(result.receipt.jobId, 'pjob_0123456789ab')
  assert.deepEqual(invoked, [EVIDENCE_DAG_CAPABILITY_IDS.view])
  const post = requests.find(({ url, method }) =>
    url.endsWith('/updates') && method === 'POST'
  )
  assert.deepEqual((post?.body as { evidenceVector?: unknown }).evidenceVector, [
    { threadId: 'codex:thread-1', digest: evidenceDigest }
  ])
  assert.equal(requests.filter(({ url, method }) =>
    url.endsWith('/updates') && method === 'POST'
  ).length, 1)
  await deactivate()
})

test('turn handoff survives restart, posts once, and never reposts an accepted receipt', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-handoff-'))
  let postCount = 0
  const config: ProjectDagSidecarConfig = {
    baseUrl: 'http://127.0.0.1:3898',
    runtimeToken: 'project-token',
    command: 'python',
    args: ['-m', 'project_dag.server'],
    cwd: '/app/packages/domains/project-dag',
    env: {},
    projectPackageRoot: '/app/packages/domains/project-dag',
    evidencePackageRoot: '/app/packages/domains/evidence-dag',
    sessionDir: '/data/evidence',
    dbPath: '/data/project.db',
    autoStart: false
  }
  const sidecar = {
    ensure: async () => config,
    stop: async () => undefined
  } as unknown as ProjectDagSidecar
  const fetchImpl: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/updates') && init?.method === 'POST') {
      postCount += 1
      return jsonResponse(receipt())
    }
    throw new Error(`Unexpected request: ${String(input)}`)
  }
  const context = lifecycleContext({
    userDataDir,
    capabilities: {
      invoke: async <TInput, TOutput>() => ({
        url: 'http://127.0.0.1:3897/',
        threadId: 'thread-1',
        status: {
          committed: {
            threadId: 'codex:thread-1',
            version: 3,
            digest: evidenceDigest,
            inputWatermark: '186:batch:4/4',
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [],
            createdAt: now
          },
          pending: null,
          updatedAt: now
        }
      }) as TOutput
    }
  })
  try {
    const firstOutbox = new ProjectDagHandoffOutbox(userDataDir)
    const first = new ProjectDagRuntime({
      sidecar,
      fetchImpl,
      handoffOutbox: firstOutbox,
      autoProcessHandoffs: false
    })
    const deactivate = await first.activate(context)
    const event = {
      contractVersion: 1 as const,
      kind: 'turn-completed' as const,
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-186',
      targetWatermark: '186',
      workspaceRoot: '/workspace',
      occurredAt: now,
      artifacts: []
    }
    await Promise.all([
      first.consumeTurnCompleted(event),
      first.consumeTurnCompleted(event)
    ])
    assert.equal(firstOutbox.all().length, 1)
    await first.drainHandoffs()
    assert.equal(postCount, 1)
    assert.equal(firstOutbox.all()[0]?.state, 'accepted')
    await deactivate()

    const recoveredOutbox = new ProjectDagHandoffOutbox(userDataDir)
    const recovered = new ProjectDagRuntime({
      sidecar,
      fetchImpl,
      handoffOutbox: recoveredOutbox,
      autoProcessHandoffs: false
    })
    const deactivateRecovered = await recovered.activate(context)
    await recovered.drainHandoffs()
    assert.equal(postCount, 1)
    assert.equal(recoveredOutbox.all()[0]?.state, 'accepted')
    await deactivateRecovered()
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('turn handoff terminates on 4xx and retries only retryable 5xx failures', async (t) => {
  for (const expected of [
    { status: 400, state: 'failed' },
    { status: 503, state: 'retry_scheduled' }
  ] as const) {
    await t.test(`HTTP ${expected.status} becomes ${expected.state}`, async () => {
      const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-retry-'))
      const config: ProjectDagSidecarConfig = {
        baseUrl: 'http://127.0.0.1:3898',
        runtimeToken: 'project-token',
        command: 'python',
        args: ['-m', 'project_dag.server'],
        cwd: '/app/packages/domains/project-dag',
        env: {},
        projectPackageRoot: '/app/packages/domains/project-dag',
        evidencePackageRoot: '/app/packages/domains/evidence-dag',
        sessionDir: '/data/evidence',
        dbPath: '/data/project.db',
        autoStart: false
      }
      const sidecar = {
        ensure: async () => config,
        stop: async () => undefined
      } as unknown as ProjectDagSidecar
      const outbox = new ProjectDagHandoffOutbox(userDataDir)
      const runtime = new ProjectDagRuntime({
        sidecar,
        handoffOutbox: outbox,
        autoProcessHandoffs: false,
        readEvidenceSnapshot: async (threadId) => ({
          threadId,
          version: 3,
          digest: evidenceDigest,
          inputWatermark: '186:batch:4/4',
          schemaVersion: '1',
          extractorVersion: '1',
          verifierVersion: '1',
          artifactDigests: [],
          createdAt: now
        }),
        fetchImpl: async () => new Response(JSON.stringify({
          ok: false,
          error: {
            code: 'UPSTREAM_REJECTED',
            message: `HTTP ${expected.status} failure`,
            retryable: true
          }
        }), {
          status: expected.status,
          headers: { 'Content-Type': 'application/json' }
        })
      })
      try {
        const deactivate = await runtime.activate(lifecycleContext({ userDataDir }))
        await runtime.consumeTurnCompleted({
          contractVersion: 1,
          kind: 'turn-completed',
          runtimeId: 'codex',
          threadId: 'thread-1',
          turnId: `turn-${expected.status}`,
          targetWatermark: '186',
          workspaceRoot: '/workspace',
          occurredAt: now,
          artifacts: []
        })
        await runtime.drainHandoffs()

        const record = outbox.all()[0]
        assert.equal(record?.state, expected.state)
        assert.equal(record?.attempts, 1)
        assert.equal(
          record?.nextAttemptAt !== undefined,
          expected.state === 'retry_scheduled'
        )
        await deactivate()
      } finally {
        await runtime.dispose()
        await rm(userDataDir, { recursive: true })
      }
    })
  }
})

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
      list: async () => [
        {
          id: 'thread-1',
          runtimeId: 'codex',
          workspaceRoot: '/workspace'
        }
      ],
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
        workspaceRoot: '/workspace',
        watermark: '186',
        turns: [],
        artifacts: []
      }),
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
