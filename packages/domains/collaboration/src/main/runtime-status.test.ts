import assert from 'node:assert/strict'
import test from 'node:test'
import { agentNodeFixture, projectFixture, taskFixture, userPrincipalFixture } from '@sciforge/collaboration-contracts/testing'
import { collaborationTaskViewSchema } from '../contract.js'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { AgentCloudRuntime } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import { defineAuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { CollaborationConnection } from './connection.js'
import { CollaborationSettingsService } from './settings.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'
import { CollaborationRuntime } from './runtime.js'
import { CollaborationTaskAdapter } from './task-adapter.js'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('status read with refreshDashboards joins the foreground Dashboard refresh before reading the snapshot', async () => {
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    user: userPrincipalFixture,
    agents: [agentNodeFixture]
  })
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: settings,
    authenticatedCloudTransport: {} as AuthenticatedCloudTransport,
    agentCloudRuntime: {} as AgentCloudRuntime,
    humanActions: {
      capture: () => { throw new Error('unused') },
      validate: () => { throw new Error('unused') }
    },
    signing: { signDeviceFact: async () => { throw new Error('unused') } },
    stateBackend: backend
  })
  const internals = runtime as unknown as {
    store: CollaborationLocalStore
    connection: Record<string, unknown>
    active: boolean
  }
  await internals.store.open()
  internals.active = true
  let refreshes = 0
  internals.connection = {
    state: () => ({ state: 'disconnected' }),
    localAgentId: () => undefined,
    providers: () => [],
    cloudDashboards: () => [],
    publicCoordinationSlices: () => ({ agentProfiles: [], devices: [], notifications: [] }),
    refreshDashboardsForPage: async () => { refreshes += 1 }
  }

  const snapshot = await runtime.status({ refreshDashboards: true })
  assert.equal(refreshes, 1)
  assert.equal(snapshot.connection.state, 'disconnected')
  assert.deepEqual(snapshot.dashboards, [])

  await runtime.status()
  assert.equal(refreshes, 1, 'a plain status read does not refresh the Dashboard')

  const outboxWait = { reason: 'agent_authority' as const, since: '2026-10-26T12:57:12.766Z' }
  await internals.store.transact((draft) => { draft.outboxWait = outboxWait })
  assert.deepEqual((await runtime.status()).connection.outboxWait, outboxWait)
})

const settings: DomainMainPackageSettingsHost = {
  read: async () => ({ revision: 1, value: { schemaVersion: 2, baseUrl: 'https://collaboration.example.test' } }),
  write: async () => { throw new Error('Settings writes are not expected.') },
  clear: async () => { throw new Error('Settings writes are not expected.') }
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

test('runtime Task views preserve the adapter Offer operation gate for recovering and historical journals', async () => {
  const at = '2026-10-20T00:00:00.000Z'
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1, user: userPrincipalFixture, agents: [agentNodeFixture], projects: [projectFixture], tasks: [taskFixture],
    pendingTaskOffers: [{
      projectId: projectFixture.projectId, taskId: taskFixture.taskId, taskOfferId: 'ofr_TestRecover0001',
      workerUserId: userPrincipalFixture.userId, recipientAgentId: agentNodeFixture.agentId,
      currentTaskRevision: 1, offerRevision: 1, contractRevision: null, contractDigest: null,
      receivedAt: at, preflightReasons: [], state: 'failed', updatedAt: at, completedAt: at, error: 'Historical journal'
    }]
  })
  const runtime = new CollaborationRuntime({
    statePath: 'unused', packageSettings: settings,
    authenticatedCloudTransport: {} as AuthenticatedCloudTransport,
    agentCloudRuntime: {} as AgentCloudRuntime,
    humanActions: { capture: () => { throw new Error('unused') }, validate: () => { throw new Error('unused') } },
    signing: { signDeviceFact: async () => { throw new Error('unused') } }, stateBackend: backend
  })
  const internals = runtime as unknown as { store: CollaborationLocalStore; tasks: CollaborationTaskAdapter }
  await internals.store.open()
  internals.tasks = new CollaborationTaskAdapter({
    store: internals.store, connection: { state: () => ({ state: 'connected' }) } as never,
    outbox: {} as never, agentExecution: {} as never, humanActions: {} as never, signing: {} as never,
    localAgentId: () => agentNodeFixture.agentId, workspaceRootForExecution: () => 'unused', now: () => new Date(at)
  })
  for (const [state, recoveryReason, expected, reason] of [
    ['failed', undefined, 'unverified', 'recovery_evidence_missing'],
    ['pending', 'reconciliation_required', 'recovering', 'reconciliation_required'],
    ['claiming', undefined, 'sync_pending', 'synchronization_pending'],
    ['claimed_elsewhere', undefined, 'claimed_elsewhere', 'claimed_by_other_device'],
    ['awaiting-manual', undefined, 'available', 'manual_decision_required']
  ] as const) {
    await internals.store.transact((draft) => {
      const offer = draft.pendingTaskOffers[0]!
      offer.state = state
      offer.recoveryReason = recoveryReason
      offer.completedAt = ['failed', 'claimed_elsewhere'].includes(state) ? at : null
    })
    const projected = collaborationTaskViewSchema.parse(runtime.listTasks({})[0])
    assert.equal(projected.offerAvailability?.state, expected)
    assert.equal(projected.offerAvailability?.reason, reason)
    assert.equal(projected.decisionRequired, expected === 'available')
    assert.equal(projected.offerAvailability?.canAccept, expected === 'available')
  }
})


test('status polling every eight seconds completes after a slow shared Dashboard read without queuing another', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const agentCloudRuntime = createTestAgentCloudRuntime({})
  let reads = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const authenticatedCloudTransport = defineAuthenticatedCloudTransport({
    status: () => ({ state: 'ready', baseUrl: 'https://collaboration.example.test', userId: userPrincipalFixture.userId, deviceId: agentNodeFixture.deviceId, deviceRevision: 1 }),
    execute: async ({ payload: request }) => {
      assert.equal(request.type, 'project.list')
      reads += 1
      await gate
      return { contractVersion: 1, status: 200, body: { protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId, limit: 250, projects: [], observedAt: '2026-10-20T00:00:00.000Z' } }
    },
    stageObject: async () => { throw new Error('unused') },
    readObject: async () => { throw new Error('unused') }
  })
  const runtime = new CollaborationRuntime({
    statePath: 'unused', packageSettings: settings, authenticatedCloudTransport, agentCloudRuntime,
    humanActions: { capture: () => { throw new Error('unused') }, validate: () => { throw new Error('unused') } },
    signing: { signDeviceFact: async () => { throw new Error('unused') } },
    stateBackend: new MemoryBackend({ ...EMPTY_COLLABORATION_LOCAL_STATE, revision: 1, user: userPrincipalFixture, agents: [agentNodeFixture] })
  })
  const internals = runtime as unknown as { store: CollaborationLocalStore; connection: CollaborationConnection; active: boolean }
  await internals.store.open()
  internals.active = true
  const connection = new CollaborationConnection({
    store: internals.store, settings: new CollaborationSettingsService(settings),
    outbox: { stop: () => undefined } as never, authenticatedCloudTransport, agentCloudRuntime,
    inboxHandler: { handle: async () => undefined }
  })
  internals.connection = connection
  let completed = 0
  const pending: Promise<unknown>[] = []
  const poll = () => { pending.push(runtime.status({ refreshDashboards: true }).then((value) => { completed += 1; return value })) }
  const timer = setInterval(poll, 8_000)
  try {
    poll()
    // The Cloud read stays pending over three full foreground polling periods.
    for (let i = 0; i < 3; i += 1) {
      t.mock.timers.tick(8_000)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    assert.equal(reads, 1)
    assert.equal(completed, 0)
    release()
    await Promise.all(pending)
    assert.equal(completed, 4)
    assert.equal(reads, 1, 'polls never append another read to the shared refresh')
    await runtime.status({ refreshDashboards: true })
    assert.equal(reads, 2, 'the next poll after completion starts a fresh read')
  } finally { clearInterval(timer); release(); await connection.dispose() }
})
