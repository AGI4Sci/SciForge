import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { EvidenceDagRuntime } from './runtime.js'
import type { EvidenceDagSidecarPort } from './sidecar.js'

const digest = `sha256:${'a'.repeat(64)}`

test('ensures current Evidence, runs an L0 audit, and blocks blocker findings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-action-guard-'))
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = []
  const runtime = new EvidenceDagRuntime({
    userDataDir: root,
    sidecar: fakeSidecar(),
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path === '/updates') {
        return response({
          snapshot: {
            threadId: 'codex:thread-1',
            version: 1,
            digest,
            inputWatermark: '2',
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [],
            createdAt: new Date().toISOString(),
            status: 'committed'
          }
        })
      }
      if (path === '/updates/status') {
        return response({ snapshot: null })
      }
      if (path === '/audits') {
        return response({
          completed_at: new Date().toISOString(),
          risk_digest: {
            status: 'risks_found',
            total_findings: 1,
            counts_by_severity: { blocker: 1, major: 0, minor: 0, info: 0 },
            highest_severity: 'blocker'
          }
        })
      }
      return new Response('{}', { status: 404 })
    }
  })
  await runtime.activate(lifecycleContext(root))
  const decision = await runtime.guardWriteExport({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace',
    overrideConfirmed: true
  })
  assert.equal(decision.allowed, false)
  assert.match(decision.message ?? '', /blocker risks/)
  const audit = requests.find(({ path }) => path === '/audits')
  assert.deepEqual(audit?.body, {
    threadId: 'codex:thread-1',
    targetDigest: digest,
    level: 'L0',
    trigger: 'manual',
    threshold: 0.7
  })
  assert.equal(requests.filter(({ path }) => path === '/updates').length, 1)
  await runtime.close()
})

test('allows an explicit override when export context is unavailable without invoking the service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-action-guard-missing-'))
  let fetched = false
  const runtime = new EvidenceDagRuntime({
    userDataDir: root,
    sidecar: fakeSidecar(),
    fetchImpl: async () => {
      fetched = true
      return new Response('{}', { status: 500 })
    }
  })
  await runtime.activate(lifecycleContext(root))
  const blocked = await runtime.guardWriteExport({ overrideConfirmed: false })
  const overridden = await runtime.guardWriteExport({
    workspaceRoot: '/workspace',
    overrideConfirmed: true
  })
  assert.equal(blocked.allowed, false)
  assert.match(blocked.message ?? '', /runtimeId and threadId/)
  assert.equal(overridden.allowed, true)
  assert.ok(
    overridden.metadata &&
    typeof overridden.metadata === 'object' &&
    !Array.isArray(overridden.metadata)
  )
  assert.equal(overridden.metadata.auditState, 'missing')
  assert.equal(fetched, false)
  await runtime.close()
})

function fakeSidecar(): EvidenceDagSidecarPort {
  return {
    configure: () => undefined,
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    ensureReady: async () => undefined,
    stop: async () => undefined
  }
}

function lifecycleContext(userDataDir: string): DomainMainRuntimeLifecycleContext {
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
        workspaceRoot: '/workspace',
        watermark: '2',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          artifacts: [{ id: 'artifact-1', type: 'message', content: 'Evidence.' }]
        }],
        artifacts: []
      }),
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => {
        throw new Error('Unexpected cross-domain capability.')
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
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  }
}

function response(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
