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
      invoke: async <TInput, TOutput>(contract: { actionId: string }, input: TInput, options?: { workspaceId?: string }) => {
        invoked.push(contract.actionId)
        assert.deepEqual(input, { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace' })
        assert.equal(options?.workspaceId, '/workspace')
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
          // The local delta head is intentionally a different identity. The
          // Project vector must pin the Evidence owner's committed Snapshot.
          authoritativeHead: {
            threadId: 'codex:thread-1',
            headDigest: `sha256:${'d'.repeat(64)}`,
            sequence: 4,
            committedWatermark: '200',
            updatedAt: now,
            rootKind: 'delta',
            legacyRootStatus: null
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

test('opening a stale Project requests demand-driven derivation once', async () => {
  const requests: Array<{ url: string; method: string }> = []
  const config = sidecarConfig()
  let statusReads = 0
  const staleStatus = {
    ...emptyStatus(),
    state: 'stale',
    committedSnapshot: {
      version: 1,
      digest: projectDigest,
      evidenceVector: [],
      createdAt: now
    },
    invalidation: {
      projectKey,
      stale: true,
      changedFields: ['evidenceVector'],
      reason: 'upstream_changed',
      updatedAt: now
    }
  }
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ url, method })
      if (url.includes('/updates/status')) {
        statusReads += 1
        return jsonResponse(statusReads === 1 ? staleStatus : emptyStatus())
      }
      if (url.endsWith('/updates/open') && method === 'POST') {
        return jsonResponse({ derived: true })
      }
      if (url.includes('/goals')) return jsonResponse([])
      throw new Error(`Unexpected request: ${method} ${url}`)
    }
  })
  const deactivate = await runtime.activate(lifecycleContext())
  const result = await runtime.view({ workspaceRoot: '/workspace' })
  assert.equal(result.status.committed, null)
  assert.equal(requests.filter(({ url }) => url.includes('/updates/status')).length, 2)
  assert.equal(requests.filter(({ url, method }) => url.endsWith('/updates/open') && method === 'POST').length, 1)
  await deactivate()
})

test('manual update resolves colons in runtime and Session IDs through Host authority', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = []
  const config = sidecarConfig()
  const engineThreadId = 'domain:sciforge.create-loop:thread:with:colon'
  const runtimeId = 'domain:sciforge.create-loop'
  const threadId = 'thread:with:colon'
  let statusReads = 0
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => config,
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input, init) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, method: init?.method ?? 'GET', ...(body === undefined ? {} : { body }) })
      if (url.includes('/updates/status')) {
        statusReads += 1
        return jsonResponse(statusReads === 1
          ? emptyStatus()
          : { ...emptyStatus(), state: 'pending', latestReceipt: receipt(), activeReceipt: receipt() })
      }
      if (url.endsWith('/updates') && init?.method === 'POST') return jsonResponse(receipt())
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    }
  })
  const invoked: Array<{ runtimeId: string; threadId: string }> = []
  const base = lifecycleContext()
  const deactivate = await runtime.activate(lifecycleContext({
    agentThreads: {
      ...base.agentThreads,
      read: async (identity) => {
        if (identity.runtimeId !== runtimeId || identity.threadId !== threadId) {
          throw new Error('Candidate identity is not authoritative.')
        }
        return {
          id: threadId,
          runtimeId,
          workspaceRoot: '/workspace',
          watermark: '186',
          turns: [],
          artifacts: []
        }
      }
    },
    capabilities: {
      ...base.capabilities,
      invoke: async <TInput, TOutput>(
        _contract: unknown,
        input: TInput
      ) => {
        const identity = input as { runtimeId: string; threadId: string }
        invoked.push(identity)
        return {
          committed: {
            threadId: engineThreadId,
            version: 3,
            digest: evidenceDigest,
            inputWatermark: '186',
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [],
            createdAt: now
          },
          pending: null,
          updatedAt: now
        } as TOutput
      }
    }
  }))

  await runtime.update({ workspaceRoot: '/workspace', scope: [engineThreadId] })

  assert.deepEqual(invoked, [{ runtimeId, threadId, workspaceRoot: '/workspace' }])
  const post = requests.find(({ url, method }) => url.endsWith('/updates') && method === 'POST')
  assert.deepEqual((post?.body as { capturedScope?: unknown }).capturedScope, {
    includedSessions: [engineThreadId],
    excludedSessions: [],
    isolatedSessions: []
  })
  await deactivate()
})

test('manual update rejects ambiguous colon-delimited Session identities', async () => {
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
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
        workspaceRoot: '/workspace',
        watermark: '186',
        turns: [],
        artifacts: []
      })
    }
  }))
  await assert.rejects(
    runtime.update({
      workspaceRoot: '/workspace',
      scope: ['domain:runtime:thread']
    }),
    (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'access_restricted' && /ambiguous/u.test(error.error.message)
  )
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
    runtime.update({
      workspaceRoot: '/workspace',
      scope: 'all'
    } as never),
    (error: unknown) => error instanceof ProjectDagRuntimeError && error.error.code === 'invalid_request'
  )
  assert.equal(listCalls, 0)
  await deactivate()
})

const decisionRecord = {
  decisionId: 'decision:one',
  projectSnapshot: evidenceDigest,
  actionClass: 'draft_internal_reversible',
  action: 'endorse',
  actor: { type: 'agent', id: 'agent-1' },
  rationale: 'rationale',
  alternatives: ['alternative'],
  reversibility: 'reversible',
  policyRef: 'decision-policy/v1',
  createdAt: now
}

const approvalRecord = {
  approvalId: 'approval:one',
  decisionRef: 'decision:one',
  projectSnapshot: evidenceDigest,
  attestor: 'reviewer-1',
  attestation: 'attestation',
  policyRef: 'decision-policy/v1',
  createdAt: now,
  status: 'effective'
}

const releaseRecord = {
  releaseId: 'release:one',
  projectSnapshot: evidenceDigest,
  classification: 'internal',
  target: 'manuscript',
  outputArtifactVersions: [{
    artifactVersionId: 'artifact-version:one',
    contentDigest: evidenceDigest
  }],
  auditRefs: ['audit:one'],
  decisionRefs: ['decision:one'],
  approvalRefs: ['approval:one'],
  attemptOutcome: 'accepted',
  createdAt: now
}

test('read-records pages decision records through the sidecar with caller workspace', async () => {
  const requests: Array<{ url: string; method: string }> = []
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input, init) => {
      const url = String(input)
      requests.push({ url, method: init?.method ?? 'GET' })
      if (url.includes('/decisions')) {
        return jsonResponse({
          records: [decisionRecord],
          nextCursor: 'decision:one'
        })
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    }
  })
  const deactivate = await runtime.activate(lifecycleContext())

  const page = await runtime.readRecords({
    recordType: 'decision',
    limit: 25,
    cursor: 'decision:zero',
    workspaceRoot: '/workspace'
  })

  assert.deepEqual(page.records, [decisionRecord])
  assert.equal(page.nextCursor, 'decision:one')
  assert.equal(requests.length, 1)
  const url = new URL(requests[0]!.url)
  assert.equal(url.pathname, '/decisions')
  assert.equal(url.searchParams.get('workspaceRoot'), '/workspace')
  assert.equal(url.searchParams.get('limit'), '25')
  assert.equal(url.searchParams.get('cursor'), 'decision:zero')
  assert.equal(requests[0]!.method, 'GET')
  await deactivate()
})

test('read-records parses approvals and releases through their canonical schemas', async () => {
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input) => {
      const url = String(input)
      if (url.includes('/approvals')) {
        return jsonResponse({ records: [approvalRecord], nextCursor: null })
      }
      if (url.includes('/releases')) {
        return jsonResponse({ records: [releaseRecord], nextCursor: null })
      }
      throw new Error(`Unexpected request: ${url}`)
    }
  })
  const deactivate = await runtime.activate(lifecycleContext())

  const approvals = await runtime.readRecords({
    recordType: 'approval',
    workspaceRoot: '/workspace'
  })
  assert.deepEqual(approvals.records, [approvalRecord])
  assert.equal(approvals.nextCursor, null)

  const releases = await runtime.readRecords({
    recordType: 'release',
    workspaceRoot: '/workspace'
  })
  assert.deepEqual(releases.records, [releaseRecord])
  await deactivate()
})

test('read-records rejects malformed upstream records instead of guessing', async () => {
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async () => jsonResponse({
      records: [{ decisionId: 'decision:broken' }],
      nextCursor: null
    })
  })
  const deactivate = await runtime.activate(lifecycleContext())
  await assert.rejects(
    runtime.readRecords({ recordType: 'decision', workspaceRoot: '/workspace' }),
    (error: unknown) => error instanceof Error && error.name === 'ZodError'
  )
  await deactivate()
})

test('read-records fails closed with service_unreachable when the sidecar is absent', async () => {
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => {
        throw new Error('Project DAG auto-start is disabled and no compatible service is reachable.')
      },
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async () => {
      throw new Error('network down')
    }
  })
  const deactivate = await runtime.activate(lifecycleContext())
  await assert.rejects(
    runtime.readRecords({ recordType: 'decision', workspaceRoot: '/workspace' }),
    (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'service_unreachable' &&
      error.error.retryable === true
  )
  await deactivate()
})

test('read-records fails closed with service_unreachable on unreadable pages and transport errors', async () => {
  const unreachable = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async () => {
      throw new Error('socket hang up')
    }
  })
  const deactivateA = await unreachable.activate(lifecycleContext())
  await assert.rejects(
    unreachable.readRecords({ recordType: 'release', workspaceRoot: '/workspace' }),
    (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'service_unreachable'
  )
  await deactivateA()

  const unreadable = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async () => jsonResponse({ items: [] })
  })
  const deactivateB = await unreadable.activate(lifecycleContext())
  await assert.rejects(
    unreadable.readRecords({ recordType: 'release', workspaceRoot: '/workspace' }),
    (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'service_unreachable'
  )
  await deactivateB()
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

test('read-records maps a python HTTP 500 to a retryable upstream_unavailable', async () => {
  const runtime = new ProjectDagRuntime({
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: { code: 'INTERNAL', message: 'sqlite exploded', retryable: true }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  })
  const deactivate = await runtime.activate(lifecycleContext())
  // A live service answering 500 stays an upstream fault, not service_unreachable.
  await assert.rejects(
    runtime.readRecords({ recordType: 'decision', workspaceRoot: '/workspace' }),
    (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'upstream_unavailable' &&
      error.error.retryable === true &&
      error.error.details?.httpStatus === 500
  )
  await deactivate()
})

test('read-records keeps upstream_timeout for slow responses without relabeling', async () => {
  const runtime = new ProjectDagRuntime({
    requestTimeoutMs: 5,
    sidecar: {
      ensure: async () => sidecarConfig(),
      stop: async () => undefined
    } as unknown as ProjectDagSidecar,
    fetchImpl: async (input, init) => {
      void input
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 50)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('The operation timed out.', 'TimeoutError'))
        }, { once: true })
      })
      return jsonResponse({ records: [], nextCursor: null })
    }
  })
  const deactivate = await runtime.activate(lifecycleContext())
  await assert.rejects(
    runtime.readRecords({ recordType: 'decision', workspaceRoot: '/workspace' }),
    (error: unknown) => error instanceof ProjectDagRuntimeError &&
      error.error.code === 'upstream_timeout' &&
      error.error.retryable === true
  )
  await deactivate()
})
