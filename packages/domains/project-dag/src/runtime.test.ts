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
  })
  const runtime = new ProjectDagRuntime({ sidecar, fetchImpl })
  const deactivate = await runtime.activate(context)
  const result = await runtime.update({
    workspaceRoot: '/workspace',
    scope: 'all'
  })

  assert.equal(result.receipt.jobId, 'pjob_0123456789ab')
  assert.deepEqual(invoked, [EVIDENCE_DAG_CAPABILITY_IDS.snapshotStatus])
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

test('manual update rejects project-only discovery and cross-workspace explicit sessions', async () => {
  const requests: Array<{ url: string; method: string }> = []
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
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' })
      return jsonResponse({
        projectKey,
        state: 'empty',
        committedSnapshot: null,
        latestReceipt: null,
        activeReceipt: null,
        autonomy: { autonomy_mode: 'checkpointed' },
        attentionCount: 0
      })
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({
    agentThreads: {
      list: async () => [],
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
        workspaceRoot: '/workspace/b',
        watermark: '1',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    }
  }))
  try {
    await assert.rejects(
      runtime.update({ project: 'project-only', scope: 'all' }),
      (error: unknown) => error instanceof ProjectDagRuntimeError &&
        error.error.code === 'invalid_request'
    )
    await assert.rejects(
      runtime.update({
        workspaceRoot: '/workspace/a',
        sessions: ['codex:thread-b'],
        scope: ['codex:thread-b']
      }),
      (error: unknown) => error instanceof ProjectDagRuntimeError &&
        error.error.code === 'access_restricted'
    )
    assert.equal(requests.some(({ url, method }) =>
      url.endsWith('/updates') && method === 'POST'
    ), false)
  } finally {
    await deactivate()
  }
})

test('artifact handoff skips Host-unbound executions and rejects forged scope', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-scope-reject-'))
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
  const outbox = new ProjectDagHandoffOutbox(userDataDir)
  let authoritativeWorkspace = '/workspace/authoritative'
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    handoffOutbox: outbox,
    autoProcessHandoffs: false
  })
  const deactivate = await runtime.activate(lifecycleContext({
    userDataDir,
    agentThreads: {
      list: async () => [],
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
        workspaceRoot: authoritativeWorkspace,
        watermark: '186',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    }
  }))
  try {
    await assert.rejects(runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'turn-completed',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-186',
      targetWatermark: '186',
      workspaceRoot: '/workspace/forged',
      occurredAt: now,
      artifacts: []
    }), (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'access_restricted')
    await assert.rejects(runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'execution-completed',
      producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-unbound',
      runId: 'run-unbound',
      targetWatermark: '7:event-unbound',
      workspaceRoot: '/workspace/authoritative',
      occurredAt: now,
      artifacts: []
    }), (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'access_restricted')
    await runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'execution-completed',
      hostBinding: {
        contractVersion: 1,
        acceptanceSequence: 7,
        workspaceBinding: 'unbound'
      },
      producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-host-unbound',
      runId: 'run-host-unbound',
      targetWatermark: 'opaque:event-host-unbound',
      occurredAt: now,
      artifacts: []
    })
    assert.equal(outbox.all().length, 0)
    await assert.rejects(runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'execution-completed',
      hostBinding: {
        contractVersion: 1,
        acceptanceSequence: 0,
        workspaceBinding: 'unbound'
      },
      producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-forged-unbound',
      runId: 'run-forged-unbound',
      targetWatermark: 'opaque:event-forged-unbound',
      occurredAt: now,
      artifacts: []
    }), (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'access_restricted')
    await assert.rejects(runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'execution-completed',
      hostBinding: {
        contractVersion: 1,
        acceptanceSequence: Number.MAX_SAFE_INTEGER + 1,
        workspaceBinding: 'capability-caller',
        workspaceRoot: '/workspace/authoritative'
      },
      producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-invalid-sequence',
      runId: 'run-invalid-sequence',
      targetWatermark: 'opaque:event-invalid-sequence',
      workspaceRoot: '/workspace/authoritative',
      occurredAt: now,
      artifacts: []
    }), (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'access_restricted')
    await assert.rejects(runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'execution-completed',
      hostBinding: {
        contractVersion: 1,
        acceptanceSequence: 8,
        workspaceBinding: 'capability-caller',
        workspaceRoot: '/workspace/authoritative'
      },
      producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-1',
      runId: 'run-1',
      runtimeId: 'another-package',
      threadId: 'workflow:one',
      targetWatermark: '8:event-1',
      workspaceRoot: '/workspace/authoritative',
      occurredAt: now,
      artifacts: []
    }), (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'access_restricted')
    await assert.rejects(runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'execution-completed',
      hostBinding: {
        contractVersion: 1,
        acceptanceSequence: 9,
        workspaceBinding: 'capability-caller',
        workspaceRoot: '/workspace/authoritative'
      },
      producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-forged-workspace',
      runId: 'run-forged-workspace',
      targetWatermark: '9:event-forged-workspace',
      workspaceRoot: '/workspace/forged',
      occurredAt: now,
      artifacts: []
    }), (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'access_restricted')
    assert.equal(outbox.all().length, 0)

    await runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'turn-completed',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-187',
      targetWatermark: '187',
      workspaceRoot: '/workspace/authoritative',
      occurredAt: now,
      artifacts: []
    })
    authoritativeWorkspace = '/workspace/moved'
    await runtime.drainHandoffs()
    assert.equal(outbox.all()[0]?.state, 'failed')
  } finally {
    await deactivate()
    await rm(userDataDir, { recursive: true })
  }
})

test('missing committed Evidence retries handoff triggers but remains terminal for manual updates', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-missing-evidence-'))
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
  const outbox = new ProjectDagHandoffOutbox(userDataDir)
  let postCount = 0
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    handoffOutbox: outbox,
    autoProcessHandoffs: false,
    fetchImpl: async (_input, init) => {
      if (init?.method === 'POST') postCount += 1
      return jsonResponse({
        projectKey,
        state: 'empty',
        committedSnapshot: null,
        latestReceipt: null,
        activeReceipt: null,
        autonomy: { autonomy_mode: 'checkpointed' },
        attentionCount: 0
      })
    }
  })
  const context = lifecycleContext({
    userDataDir,
    capabilities: {
      invoke: async <TInput, TOutput>() => ({
        committed: null,
        pending: null,
        updatedAt: now
      }) as TOutput,
      createApprovedBatch: () => {
        throw new Error('Unexpected approved capability batch.')
      }
    }
  })
  const deactivate = await runtime.activate(context)
  try {
    await runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'turn-completed',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-missing-evidence',
      targetWatermark: '186',
      workspaceRoot: '/workspace',
      occurredAt: now,
      artifacts: []
    })
    await runtime.drainHandoffs()

    assert.equal(outbox.all()[0]?.state, 'retry_scheduled')
    assert.equal(outbox.all()[0]?.attempts, 1)
    await assert.rejects(
      runtime.update({ workspaceRoot: '/workspace', scope: 'all' }),
      (error: unknown) => error instanceof ProjectDagRuntimeError &&
        error.error.code === 'evidence_snapshot_unavailable' &&
        error.error.retryable === false
    )
    assert.equal(postCount, 0)
  } finally {
    await deactivate()
    await rm(userDataDir, { recursive: true })
  }
})

test('artifact handoff survives restart, posts once, and never reposts an accepted receipt', async () => {
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
      }) as TOutput,
      createApprovedBatch: () => {
        throw new Error('Unexpected approved capability batch.')
      }
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
      first.consumeArtifact(event),
      first.consumeArtifact(event)
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

test('one committed snapshot accepts every covered handoff in its durable lane', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-covered-lane-'))
  const outbox = new ProjectDagHandoffOutbox(userDataDir)
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
  let postCount = 0
  let snapshotReads = 0
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    handoffOutbox: outbox,
    autoProcessHandoffs: false,
    readEvidenceSnapshot: async (threadId) => {
      snapshotReads += 1
      return {
        threadId,
        version: 3,
        digest: evidenceDigest,
        inputWatermark: '25',
        schemaVersion: '1',
        extractorVersion: '1',
        verifierVersion: '1',
        artifactDigests: [],
        createdAt: now
      }
    },
    fetchImpl: async () => {
      postCount += 1
      return jsonResponse(receipt())
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({ userDataDir }))
  try {
    for (const targetWatermark of ['10', '20', '30']) {
      await runtime.consumeArtifact({
        contractVersion: 1,
        kind: 'turn-completed',
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: `turn-${targetWatermark}`,
        targetWatermark,
        workspaceRoot: '/workspace',
        occurredAt: now,
        artifacts: []
      })
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    await runtime.drainHandoffs()

    const byWatermark = new Map(
      outbox.all().map((record) => [record.targetWatermark, record] as const)
    )
    assert.equal(postCount, 1)
    assert.equal(snapshotReads, 2)
    assert.equal(byWatermark.get('10')?.state, 'accepted')
    assert.equal(byWatermark.get('20')?.state, 'accepted')
    assert.equal(byWatermark.get('30')?.state, 'retry_scheduled')
    assert.equal(
      byWatermark.get('10')?.receipt?.desiredFingerprint,
      byWatermark.get('20')?.receipt?.desiredFingerprint
    )
  } finally {
    await deactivate()
    await rm(userDataDir, { recursive: true })
  }
})

test('shared upstream failure retries only one backlog record per backoff window', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-retry-barrier-'))
  const outbox = new ProjectDagHandoffOutbox(userDataDir)
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
  let snapshotReads = 0
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    handoffOutbox: outbox,
    autoProcessHandoffs: false,
    readEvidenceSnapshot: async () => {
      snapshotReads += 1
      throw new Error('Evidence is temporarily unavailable.')
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({ userDataDir }))
  try {
    for (const targetWatermark of ['10', '20', '30']) {
      await runtime.consumeArtifact({
        contractVersion: 1,
        kind: 'turn-completed',
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: `turn-${targetWatermark}`,
        targetWatermark,
        workspaceRoot: '/workspace',
        occurredAt: now,
        artifacts: []
      })
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    await runtime.drainHandoffs()

    assert.equal(snapshotReads, 1)
    assert.equal(outbox.all().filter(({ state }) => state === 'retry_scheduled').length, 1)
    assert.equal(outbox.all().filter(({ state }) => state === 'pending').length, 2)
  } finally {
    await deactivate()
    await rm(userDataDir, { recursive: true })
  }
})

test('execution completion uses a Host-bound synthetic scope through the durable handoff lane', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-execution-'))
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
  const invoked: Array<{ runtimeId: string; threadId: string }> = []
  let posted: unknown
  const runtime = new ProjectDagRuntime({
    sidecar,
    handoffOutbox: new ProjectDagHandoffOutbox(userDataDir),
    autoProcessHandoffs: false,
    fetchImpl: async (_input, init) => {
      posted = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      return jsonResponse(receipt())
    }
  })
  const context = lifecycleContext({
    userDataDir,
    agentThreads: {
      list: async () => [],
      read: async () => {
        throw new Error('Synthetic execution scope must not read an Agent thread.')
      },
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async <TInput, TOutput>(
        _contract: { actionId: string },
        input: TInput
      ) => {
        invoked.push(input as { runtimeId: string; threadId: string })
        return {
          committed: {
            threadId: 'domain:sciforge.create-loop:execution:execution-9',
            version: 1,
            digest: evidenceDigest,
            inputWatermark: 'opaque:event-9',
            schemaVersion: 'evidence.v3',
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
  })
  try {
    const deactivate = await runtime.activate(context)
    await runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'execution-completed',
      hostBinding: {
        contractVersion: 1,
        acceptanceSequence: 9,
        workspaceBinding: 'capability-caller',
        workspaceRoot: '/workspace'
      },
      producer: {
        moduleId: 'sciforge.create-loop',
        moduleVersion: '1.0.0'
      },
      executionId: 'execution-9',
      runId: 'run-9',
      targetWatermark: 'opaque:event-9',
      workspaceRoot: '/workspace',
      occurredAt: now,
      artifacts: []
    })
    await runtime.drainHandoffs()

    assert.deepEqual(invoked, [{
      runtimeId: 'domain:sciforge.create-loop',
      threadId: 'execution:execution-9'
    }])
    assert.deepEqual(
      (posted as { evidenceVector?: unknown }).evidenceVector,
      [{
        threadId: 'domain:sciforge.create-loop:execution:execution-9',
        digest: evidenceDigest
      }]
    )
    await deactivate()
  } finally {
    await runtime.dispose()
    await rm(userDataDir, { recursive: true })
  }
})

test('artifact handoff terminates on 4xx and retries only retryable 5xx failures', async (t) => {
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
        await runtime.consumeArtifact({
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

test('scheduled handoff drain catches and logs persistence rejection', {
  timeout: 2_000
}, async () => {
  const drainFailure = new Error('handoff retry persistence failed')
  let hasReadyRecord = true
  const failingOutbox = {
    load: async () => undefined,
    ready: () => {
      if (!hasReadyRecord) return []
      hasReadyRecord = false
      return [{
        id: 'project-handoff:timer-failure',
        workspaceRoot: '/workspace',
        runtimeId: 'codex',
        threadId: 'thread-1',
        targetWatermark: '186',
        sourceKind: 'agent-thread',
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      }]
    },
    active: () => [],
    markRetry: async () => { throw drainFailure }
  } as unknown as ProjectDagHandoffOutbox
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
  let loggedDetail: unknown
  let resolveLogged!: () => void
  const logged = new Promise<void>((resolve) => { resolveLogged = resolve })
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    handoffOutbox: failingOutbox,
    readEvidenceSnapshot: async () => {
      throw new Error('Evidence is temporarily unavailable.')
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({
    log: (entry) => {
      if (entry.message !== 'Project DAG handoff drain failed.') return
      loggedDetail = entry.detail
      resolveLogged()
    }
  }))
  try {
    await withTimeout(logged, 'scheduled handoff drain did not report its failure')
    assert.equal(loggedDetail, drainFailure)
  } finally {
    await deactivate()
  }
})

test('terminal persistence failure backs off instead of scheduling a zero-delay hot loop', {
  timeout: 2_000
}, async () => {
  const record = {
    id: 'project-handoff:terminal-persist-failure',
    workspaceRoot: '/workspace',
    runtimeId: 'codex',
    threadId: 'thread-1',
    targetWatermark: '186',
    sourceKind: 'agent-thread' as const,
    state: 'pending' as const,
    attempts: 0,
    createdAt: now,
    updatedAt: now
  }
  let failedPersistenceAttempts = 0
  const persistFailure = new Error('handoff terminal persistence failed')
  const failingOutbox = {
    load: async () => undefined,
    ready: () => [record],
    active: () => [record],
    markFailed: async () => {
      failedPersistenceAttempts += 1
      throw persistFailure
    }
  } as unknown as ProjectDagHandoffOutbox
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
  let loggedFailures = 0
  let resolveLogged!: () => void
  const logged = new Promise<void>((resolve) => { resolveLogged = resolve })
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    handoffOutbox: failingOutbox,
    readEvidenceSnapshot: async () => {
      throw new ProjectDagRuntimeError({
        code: 'evidence_snapshot_unavailable',
        message: 'Evidence identity is terminally invalid.',
        retryable: false
      })
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({
    log: (entry) => {
      if (entry.message !== 'Project DAG handoff drain failed.') return
      loggedFailures += 1
      resolveLogged()
    }
  }))
  try {
    await withTimeout(logged, 'terminal persistence failure was not logged')
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(failedPersistenceAttempts, 1)
    assert.equal(loggedFailures, 1)
  } finally {
    await deactivate()
  }
})

test('activation still schedules handoff recovery when the initial sidecar start fails', {
  timeout: 2_000
}, async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-sidecar-recovery-'))
  const outbox = new ProjectDagHandoffOutbox(userDataDir)
  await outbox.enqueue({
    workspaceRoot: '/workspace',
    runtimeId: 'codex',
    threadId: 'thread-1',
    targetWatermark: '186',
    sourceKind: 'agent-thread'
  })
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
  let ensureAttempts = 0
  let resolvePosted!: () => void
  const posted = new Promise<void>((resolve) => { resolvePosted = resolve })
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => {
        ensureAttempts += 1
        if (ensureAttempts === 1) throw new Error('initial sidecar start failed')
        return config
      },
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    handoffOutbox: outbox,
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
    fetchImpl: async () => {
      resolvePosted()
      return jsonResponse(receipt())
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({ userDataDir }))
  try {
    await withTimeout(posted, 'scheduled handoff recovery did not post an update')
    await runtime.drainHandoffs()
    assert.equal(outbox.all()[0]?.state, 'accepted')
    assert.equal(ensureAttempts, 2)
  } finally {
    await deactivate()
    await rm(userDataDir, { recursive: true })
  }
})

test('dispose waits for an in-flight handoff before stopping the sidecar', {
  timeout: 2_000
}, async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-runtime-dispose-drain-'))
  const outbox = new ProjectDagHandoffOutbox(userDataDir)
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
  let stopCount = 0
  let resolveRequestStarted!: () => void
  const requestStarted = new Promise<void>((resolve) => { resolveRequestStarted = resolve })
  let releaseRequest!: () => void
  const requestRelease = new Promise<void>((resolve) => { releaseRequest = resolve })
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => { stopCount += 1 }
    } as unknown as ProjectDagSidecar,
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
    fetchImpl: async () => {
      resolveRequestStarted()
      await requestRelease
      return jsonResponse(receipt())
    }
  })
  const deactivate = await runtime.activate(lifecycleContext({ userDataDir }))
  try {
    await runtime.consumeArtifact({
      contractVersion: 1,
      kind: 'turn-completed',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-dispose',
      targetWatermark: '186',
      workspaceRoot: '/workspace',
      occurredAt: now,
      artifacts: []
    })
    const draining = runtime.drainHandoffs()
    await withTimeout(requestStarted, 'handoff request did not start')
    const disposing = runtime.dispose()
    let concurrentDisposeSettled = false
    const concurrentDisposing = runtime.dispose().then(() => {
      concurrentDisposeSettled = true
    })
    await Promise.resolve()
    assert.equal(stopCount, 0)
    assert.equal(concurrentDisposeSettled, false)

    releaseRequest()
    await Promise.all([draining, disposing, concurrentDisposing])
    assert.equal(stopCount, 1)
    assert.equal(outbox.all()[0]?.state, 'accepted')
  } finally {
    releaseRequest()
    await deactivate()
    await rm(userDataDir, { recursive: true })
  }
})

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 1_000)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
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
