import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { EvidenceDagRuntime } from './runtime.js'
import type { EvidenceDagSidecarPort } from './sidecar.js'

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
          messages: [],
          artifacts: [{ id: 'artifact-1', type: 'message', content: 'Evidence.' }]
        }],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => {
        throw new Error('Unexpected cross-domain capability.')
      },
      createApprovedBatch: () => {
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
