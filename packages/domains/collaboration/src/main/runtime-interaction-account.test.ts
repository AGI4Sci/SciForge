import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TEST_IDS as I, TEST_TIMESTAMP as at, taskFixture, userPrincipalFixture } from '@sciforge/collaboration-contracts/testing'
import { createCollaborationCapabilityFactory } from '../main.js'
import { COLLABORATION_CAPABILITY_IDS, collaborationTaskInteractionReadResultSchema } from '../contract.js'
import { CollaborationRuntime } from './runtime.js'
import { CollaborationTaskAdapter } from './task-adapter.js'
import { TaskInteractionController } from './task-interaction-controller.js'
import { EMPTY_COLLABORATION_LOCAL_STATE } from './store.js'

// Only in-memory collaborators; exercise the production capability, Runtime,
// Adapter and journal projection without starting a Cloud connection or Session.
async function fixture(openStore = true) {
  const state = { ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE), user: userPrincipalFixture, taskRuns: [{
    offer: { projectId: I.projectId, taskId: I.taskId, executionId: I.executionId, taskOfferId: I.taskOfferId,
      currentTaskRevision: 1, currentExecutionRevision: 2, offerRevision: 1, recipientAgentId: I.agentId, receivedAt: at },
    task: taskFixture, execution: null, latestPreflight: null, decision: { decision: 'accept', decidedAt: at },
    expectedTaskRevision: 1, expectedExecutionRevision: 2, state: 'running', workspaceRoot: '/tmp/memory-only',
    runtimeId: 'codex', threadId: 'account-a-thread', humanRequestId: null, humanAnswer: null, resources: [],
    agentJournal: [{ logicalInvocationId: 'a.invocation', clientDirectiveId: 'a.directive', state: 'observed_failure',
      preparedAt: at, dispatchedAt: at, observedAt: at, runtimeId: 'codex', threadId: 'account-a-thread', turnId: null,
      runtimeState: 'failed', safeError: 'ACCOUNT_A_PRIVATE_DETAIL', safeResultText: null, failure: null }],
    externalJournal: [], outputs: [], recoveryJournalEntryIds: [], resultSummary: null, lateOutcomes: [],
    startedAt: at, updatedAt: at, completedAt: null, error: null
  }] }
  let status: unknown = { state: 'ready', userId: I.userId }
  let readGate: Promise<void> = Promise.resolve()
  const runtime = new CollaborationRuntime({ stateBackend: {
    read: async () => { await readGate; return structuredClone(state) }, write: async () => undefined
  }, authenticatedCloudTransport: { status: () => status } } as never)
  const internals = runtime as unknown as { store: import('./store.js').CollaborationLocalStore; tasks: CollaborationTaskAdapter; active: boolean }
  const tasks = Object.create(CollaborationTaskAdapter.prototype)
  tasks.interactions = new TaskInteractionController({ store: internals.store })
  internals.tasks = tasks
  internals.active = true
  if (openStore) await internals.store.open()
  const definitions = createCollaborationCapabilityFactory({ defineCapability: x => x, getRuntime: () => runtime }).createDefinitions()
  const read = definitions.find(x => x.id === COLLABORATION_CAPABILITY_IDS.taskInteractionRead)!
  const checkpoint = definitions.find(x => x.id === COLLABORATION_CAPABILITY_IDS.taskCheckpointAppend)!
  let hostUser: string = I.userId
  const context = (userId: string = I.userId) => ({ caller: { audience: 'ui' as const, principal: {
    authority: 'test', subject: userId, assurance: 'cloud-authenticated' as const, deviceId: I.deviceId, identityVersion: 1
  } }, assertPrincipalCurrent: () => { if (hostUser !== userId) throw new Error('Host Principal changed') } })
  const input = { projectId: I.projectId, taskId: I.taskId, executionId: I.executionId }
  return { runtime, store: internals.store, read, checkpoint, context, input, status: (v: unknown) => { status = v },
    host: (v: string) => { hostUser = v }, persistedUser: (v: string) => { state.user = { ...userPrincipalFixture, userId: v } },
    gate: (v: Promise<void>) => { readGate = v } }
}

test('public UI read denies B login with A store after failed reconnect, while same-account offline diagnostics remain readable', async () => {
  const f = await fixture()
  await assert.rejects(f.store.prepareForAuthenticatedUser(I.secondUserId), /already has Phone Link or Session data/)
  f.host(I.secondUserId)
  for (const status of [{ state: 'ready', userId: I.secondUserId }, { state: 'unavailable', reason: 'reconnect failed' }]) {
    f.status(status)
    await assert.rejects(f.read.handler(f.input, f.context(I.secondUserId)), /does not own/)
  }
  f.host(I.userId)
  const response = await f.read.handler(f.input, f.context())
  const output = collaborationTaskInteractionReadResultSchema.parse(response.output)
  assert.equal(output.view.runtimeDiagnostics?.agentJournal[0]?.safeError, 'ACCOUNT_A_PRIVATE_DETAIL')
  await assert.rejects(f.read.handler(f.input), /Host Principal/)
  await assert.rejects(f.read.handler(f.input, { caller: { audience: 'ui' }, assertPrincipalCurrent() {} }), /Host Principal/)
})

test('checkpoint UI return path rejects missing or mismatched Principal before writing or returning local details', async () => {
  const f = await fixture()
  let writes = 0
  f.runtime.appendTaskCheckpoint = async () => { writes += 1; throw new Error('must not write') }
  const input = { ...f.input, kind: 'progress', source: 'human', summary: 'fixture checkpoint' }
  await assert.rejects(f.checkpoint.handler(input), /Host Principal/)
  await assert.rejects(f.checkpoint.handler(input, { caller: { audience: 'ui' }, assertPrincipalCurrent() {} }), /Host Principal/)
  f.host(I.secondUserId)
  for (const status of [{ state: 'ready', userId: I.secondUserId }, { state: 'unavailable', reason: 'reconnect failed' }]) {
    f.status(status)
    await assert.rejects(f.checkpoint.handler(input, f.context(I.secondUserId)), /does not own/)
  }
  assert.equal(writes, 0)
})

test('Runtime public interaction reads require explicit account and reject a stale transport identity', async () => {
  const f = await fixture()
  f.status({ state: 'ready', userId: I.secondUserId })
  assert.throws(() => f.runtime.taskInteractionView(I.projectId, I.taskId, I.executionId, I.userId), /does not own/)
  assert.throws(() => f.runtime.listTaskInteractions(I.projectId, I.taskId, I.userId), /does not own/)
  assert.throws(() => f.runtime.listTaskCheckpoints(I.projectId, I.taskId, I.userId), /does not own/)
  f.status({ state: 'unavailable', reason: 'offline', userId: I.secondUserId })
  assert.throws(() => f.runtime.taskInteractionView(I.projectId, I.taskId, I.executionId, I.userId), /does not own/)
  f.status({ state: 'unavailable', reason: 'offline' })
  assert.throws(() => f.runtime.taskInteractionView(I.projectId, I.taskId, I.executionId, undefined as never), /does not own/)
  assert.equal(f.runtime.taskInteractionView(I.projectId, I.taskId, I.executionId, I.userId).runtimeDiagnostics?.agentJournal.length, 1)
})

for (const change of ['host', 'transport', 'store'] as const) {
  test(`public read rejects ${change} account change while local store opening is awaiting`, async () => {
    const f = await fixture(false)
    let release!: () => void
    f.gate(new Promise<void>(resolve => { release = resolve }))
    let settled = false
    const pending = f.read.handler(f.input, f.context()).finally(() => { settled = true })
    await Promise.resolve()
    assert.equal(settled, false, 'the real backend read must wait for release')
    if (change === 'host') f.host(I.secondUserId)
    if (change === 'transport') f.status({ state: 'ready', userId: I.secondUserId })
    if (change === 'store') f.persistedUser(I.secondUserId)
    release()
    await assert.rejects(pending, /Principal changed|does not own/)
  })
}

for (const change of ['host', 'transport', 'store'] as const) {
  test(`handler rechecks ${change} identity after async Runtime result before returning diagnostics`, async () => {
    const f = await fixture()
    const original = f.runtime.readTaskInteractionView.bind(f.runtime)
    f.runtime.readTaskInteractionView = async (...args) => {
      const view = await original(...args)
      if (change === 'host') f.host(I.secondUserId)
      if (change === 'transport') f.status({ state: 'ready', userId: I.secondUserId })
      if (change === 'store') await f.store.transact(state => { state.user = { ...userPrincipalFixture, userId: I.secondUserId } })
      return view
    }
    await assert.rejects(f.read.handler(f.input, f.context()), /Principal changed|does not own/)
  })
}
