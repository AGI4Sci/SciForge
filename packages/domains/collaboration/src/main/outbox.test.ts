import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthenticatedCloudTransportError, type AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  createCollaborationError,
  restRequestSchema,
  restResponseSchema,
  taskOfferSchema,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts/node'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  agentNodeFixture,
  humanNeededFixture,
  projectFixture,
  projectRecordFixture,
  taskFixture
} from '@sciforge/collaboration-contracts/testing'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DurableCloudOutbox } from './outbox.js'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'

function objectTimeoutRequest(bytes: Buffer) {
  return { protocolVersion: '1.0' as const, type: 'object.stage' as const,
    requestId: 'req_ObjectTimeout001', idempotencyKey: 'idem_object-timeout-original',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: bytes.length, mediaType: 'text/plain' }
}
function objectTimeoutReceipt(request: ReturnType<typeof objectTimeoutRequest>) {
  return { protocolVersion: '1.0' as const, type: 'rest.object.staged' as const, requestId: request.requestId,
    object: { objectId: 'obj_ObjectTimeout001', objectKey: 'immutable/timeout', revision: 1,
      projectId: request.projectId, sha256: request.sha256, byteCount: request.byteCount,
      mediaType: request.mediaType, visibility: 'staged' as const, ownerUserId: TEST_IDS.userId, retentionUntil: null } }
}

test('object stage keeps its independent 240s budget and aborts before reconciling the same identity', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const root = await mkdtemp(join(tmpdir(), 'sciforge-stage-timeout-')), path = join(root, 'result.txt')
  const bytes = Buffer.from('same immutable bytes'), request = objectTimeoutRequest(bytes)
  await writeFile(path, bytes)
  const store = await localStore()
  let signal: AbortSignal | undefined, sends = 0
  const transport = { status: () => userStatus(), stageObject: async (input, options) => {
    assert.deepEqual(input.request, request); assert.deepEqual(Buffer.from(input.body), bytes)
    if (++sends === 1) {
      signal = options?.signal
      assert.ok(signal)
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted upload')), { once: true }))
    }
    return objectTimeoutReceipt(request)
  } } as AuthenticatedCloudTransport
  const outbox = new DurableCloudOutbox({ store, agentCloudRuntime: createTestAgentCloudRuntime({}),
    authenticatedCloudTransport: transport, localAgentId: () => TEST_IDS.agentId })
  try {
    const pending = assert.rejects(outbox.stageAndWait(request, path), /outcome is unknown/u)
    await settle()
    context.mock.timers.tick(45_000); await settle()
    assert.equal(signal?.aborted, false); assert.equal(store.snapshot().outbox[0]?.state, 'sending')
    context.mock.timers.tick(194_999); await settle(); assert.equal(signal?.aborted, false)
    context.mock.timers.tick(1); await pending
    assert.equal(signal?.aborted, true); assert.equal(store.snapshot().outbox[0]?.state, 'failed')
    assert.equal(store.snapshot().outbox[0]?.failureReason, 'transport_unavailable')
    await outbox.stageAndWait(request, path)
    assert.equal(sends, 2); assert.equal(store.snapshot().outbox.length, 1)
    assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  } finally { outbox.stop(); await rm(root, { recursive: true, force: true }) }
})

test('an aborted but unsettled provider cannot overlap retries even across outbox recreation', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const root = await mkdtemp(join(tmpdir(), 'sciforge-stage-unsettled-')), path = join(root, 'result.txt')
  const bytes = Buffer.from('retained original'), request = objectTimeoutRequest(bytes)
  await writeFile(path, bytes)
  const store = await localStore()
  let sends = 0, finish: ((value: ReturnType<typeof objectTimeoutReceipt>) => void) | undefined
  const transport = { status: () => userStatus(), stageObject: async (_input, options) => {
    if (++sends === 1) return new Promise(resolve => { finish = resolve; options!.signal!.addEventListener('abort', () => undefined) })
    return objectTimeoutReceipt(request)
  } } as AuthenticatedCloudTransport
  const authority = new IdempotentAgentAuthority()
  const make = () => new DurableCloudOutbox({ store, agentCloudRuntime: authority.runtime,
    authenticatedCloudTransport: transport, localAgentId: () => TEST_IDS.agentId })
  let outbox = make()
  try {
    const pending = assert.rejects(outbox.stageAndWait(request, path), /outcome is unknown/u)
    await settle(); context.mock.timers.tick(240_000); await pending
    await assert.rejects(outbox.stageAndWait(request, path), /still settling/u)
    await assert.rejects(outbox.stageAndWait({ ...request, idempotencyKey: 'idem_object-second-stage' }, path), /still settling/u)
    await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
    await outbox.waitForIdle()
    assert.equal(store.snapshot().outbox.find(entry => entry.idempotencyKey === IDEMPOTENCY_KEY)?.state, 'delivered')
    await outbox.retry(); await outbox.waitForIdle(); assert.equal(sends, 1)
    outbox.stop(); outbox = make()
    await assert.rejects(outbox.stageAndWait(request, path), /still settling/u)
    finish!(objectTimeoutReceipt(request)); await settle()
    await outbox.stageAndWait(request, path)
    assert.equal(sends, 2); assert.equal(store.snapshot().outbox.filter(entry => entry.kind === 'delivery.stage').length, 1)
  } finally { outbox.stop(); await rm(root, { recursive: true, force: true }) }
})

test('object timeout cancels a real slow loopback HTTP request before same-key reconciliation', async context => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-stage-http-cancel-')), path = join(root, 'result.txt')
  const bytes = Buffer.from('loopback upload cancellation'), request = objectTimeoutRequest(bytes)
  await writeFile(path, bytes)
  let calls = 0, firstClosed = false
  const receivedKeys: string[] = []
  const server = createServer((incoming, response) => {
    receivedKeys.push(String(incoming.headers['idempotency-key']))
    incoming.resume()
    if (++calls === 1) { response.on('close', () => { firstClosed = true }); return }
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(objectTimeoutReceipt(request)))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const store = await localStore()
  let signal: AbortSignal | undefined
  const transport = { status: () => userStatus(), stageObject: async (input, options) => {
    signal = options?.signal
    const response = await fetch(`${base}/v1/objects/stage`, { method: 'POST', body: input.body,
      headers: { 'idempotency-key': input.request.idempotencyKey }, signal })
    return response.json()
  } } as AuthenticatedCloudTransport
  const originalTimeout = globalThis.setTimeout
  // Only compress the production object deadline; fetch/socket timers remain real.
  context.mock.method(globalThis, 'setTimeout', ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
    originalTimeout(callback, delay === 240_000 ? 100 : delay, ...args)) as typeof setTimeout)
  const outbox = new DurableCloudOutbox({ store, agentCloudRuntime: createTestAgentCloudRuntime({}),
    authenticatedCloudTransport: transport, localAgentId: () => TEST_IDS.agentId })
  try {
    await assert.rejects(outbox.stageAndWait(request, path), /outcome is unknown/u)
    assert.equal(signal?.aborted, true)
    await settle()
    assert.equal(firstClosed, true, 'fetch cancellation closes the unresolved HTTP response')
    await outbox.stageAndWait(request, path)
    assert.deepEqual(receivedKeys, [request.idempotencyKey, request.idempotencyKey])
    assert.equal(store.snapshot().outbox.length, 1); assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  } finally { outbox.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})

test('stopping the outbox aborts the active object and retains its unknown result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-stage-stop-')), path = join(root, 'result.txt')
  const bytes = Buffer.from('stop cancels object'), request = objectTimeoutRequest(bytes)
  await writeFile(path, bytes)
  const store = await localStore()
  let signal: AbortSignal | undefined
  const transport = { status: () => userStatus(), stageObject: async (_input, options) => {
    signal = options!.signal
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  } } as AuthenticatedCloudTransport
  const outbox = new DurableCloudOutbox({ store, agentCloudRuntime: createTestAgentCloudRuntime({}),
    authenticatedCloudTransport: transport, localAgentId: () => TEST_IDS.agentId })
  try {
    const pending = assert.rejects(outbox.stageAndWait(request, path), /outcome is unknown/u)
    await settle(); outbox.stop(); await pending
    assert.equal(signal?.aborted, true); assert.equal(store.snapshot().outbox[0]?.failureReason, 'transport_unavailable')
    assert.equal(store.snapshot().outbox[0]?.idempotencyKey, request.idempotencyKey)
  } finally { outbox.stop(); await rm(root, { recursive: true, force: true }) }
})

test('real 50 second loopback object upload survives the former 45 second outbox deadline',
  { skip: process.env.SCIFORGE_TEST_REAL_SLOW_UPLOAD !== '1' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-stage-real-slow-')), path = join(root, 'result.txt')
    const bytes = Buffer.from('real 50 second object verification'), request = objectTimeoutRequest(bytes)
    await writeFile(path, bytes)
    let responseTimer: ReturnType<typeof setTimeout> | undefined, signal: AbortSignal | undefined
    const server = createServer((incoming, response) => {
      incoming.resume()
      responseTimer = setTimeout(() => response.end(JSON.stringify(objectTimeoutReceipt(request))), 50_000)
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); assert.ok(address && typeof address !== 'string')
    const store = await localStore()
    const transport = { status: () => userStatus(), stageObject: async (input, options) => {
      signal = options?.signal
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/objects/stage`, {
        method: 'POST', body: input.body, signal, headers: { 'idempotency-key': input.request.idempotencyKey } })
      return response.json()
    } } as AuthenticatedCloudTransport
    const outbox = new DurableCloudOutbox({ store, agentCloudRuntime: createTestAgentCloudRuntime({}),
      authenticatedCloudTransport: transport, localAgentId: () => TEST_IDS.agentId })
    try {
      const completed = outbox.stageAndWait(request, path)
      await new Promise(resolve => setTimeout(resolve, 46_000))
      assert.equal(signal?.aborted, false); assert.equal(store.snapshot().outbox[0]?.state, 'sending')
      await completed
      assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
    } finally { outbox.stop(); clearTimeout(responseTimer); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
  })

const IDEMPOTENCY_KEY = 'idem_projection.outbox-recovery-01'
const COMMAND = {
  projectionId: TEST_IDS.projectionId,
  projectionRevision: 1,
  localItemId: TEST_IDS.localItemId,
  kind: 'user_message' as const,
  text: '同步一次',
  occurredAt: TEST_TIMESTAMP
}
test('coalesces the same logical command when only its request id changes', async () => {
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  authority.ready = false
  const outbox = createOutbox(store, authority)

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)

  assert.equal(store.snapshot().outbox.length, 1)
  await assert.rejects(
    outbox.enqueueProjectionDelivery({ ...COMMAND, text: '不同业务正文' }, IDEMPOTENCY_KEY),
    /reused for a different command/u
  )
})

test('a pending command wakes after exact Agent authority becomes ready', async () => {
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  authority.ready = false
  const outbox = createOutbox(store, authority)

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'pending')
  assert.equal(authority.attempts, 0)

  authority.ready = true
  outbox.wake()
  await outbox.waitForIdle()

  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(authority.attempts, 1)
  assert.equal(authority.businessCommits, 1)
})

test('temporary stop after the sending checkpoint resumes the same unsent command without restarting', async () => {
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  const store = new CollaborationLocalStore(backend)
  await store.open()
  const authority = new IdempotentAgentAuthority()
  const outbox = createOutbox(store, authority)
  const write = backend.write.bind(backend)
  let pauseOnce = true
  backend.write = async (state) => {
    await write(state)
    if (pauseOnce && state.outbox.some(({ state: phase }) => phase === 'sending')) {
      pauseOnce = false
      outbox.stop()
    }
  }
  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  const original = store.snapshot().outbox[0]!
  assert.equal(authority.attempts, 0)
  assert.equal(original.state, 'reconciling')
  assert.equal(original.authorityFence, undefined)
  outbox.start()
  await outbox.waitForIdle()
  assert.equal(authority.attempts, 1)
  assert.equal(authority.businessCommits, 1)
  assert.deepEqual(store.snapshot().outbox[0]?.body, original.body)
  assert.equal(store.snapshot().outbox[0]?.idempotencyKey, original.idempotencyKey)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('authenticated manual acceptance retains an exact Cloud rejection as its durable receipt', async () => {
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  const request = restRequestSchema.parse({
    protocolVersion: '1.0', type: 'task.offer.accept', requestId: 'req_ExpiredAcceptance01',
    idempotencyKey: 'idem_expired-acceptance-01', taskOfferId: 'ofr_ExpiredOffer001',
    taskId: TEST_IDS.taskId, agentId: TEST_IDS.agentId, interaction: 'explicit_click',
    expectedTaskRevision: 1, expectedOfferRevision: 1,
    expectedContractRevision: 1, expectedContractDigest: TEST_HASH
  })
  const response = restResponseSchema.parse({
    protocolVersion: '1.0', type: 'rest.error', requestId: request.requestId,
    error: createCollaborationError('expired', 'The Offer expired before Cloud received acceptance.')
  })
  const outbox = new DurableCloudOutbox({ store, agentCloudRuntime: authority.runtime,
    localAgentId: () => TEST_IDS.agentId,
    authenticatedCloudTransport: {
      status: () => ({ state: 'ready', baseUrl: 'https://cloud.example.test', userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
      execute: async () => ({ contractVersion: 1, status: 409, body: response }),
      lookupDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
      createDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
      revokeDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
      readDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
      mutateDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
      listCloudSpaces: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
      ensureCloudSpace: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
      createCloudSpaceSession: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
      stageObject: async () => { throw new Error('No object upload expected') },
      readObject: async () => { throw new Error('No object read expected') }
    }
  })
  assert.deepEqual(await outbox.enqueueAndWait('task.offer-decision', request), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('Agent offer acceptance keeps its original authority route when no User transport is installed', async () => {
  const store = await localStore()
  const request = restRequestSchema.parse({ protocolVersion: '1.0', type: 'task.offer.accept',
    requestId: 'req_AgentAcceptRoute01', idempotencyKey: 'idem_agent-accept-route-one',
    taskOfferId: 'ofr_AgentRoute00001', taskId: TEST_IDS.taskId, agentId: TEST_IDS.agentId,
    interaction: 'explicit_click', expectedTaskRevision: 1, expectedOfferRevision: 1 })
  const response = restResponseSchema.parse({ protocolVersion: '1.0', type: 'rest.error', requestId: request.requestId,
    error: createCollaborationError('expired', 'The Offer expired.') })
  let sends = 0
  const outbox = new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async agentId => ({ state: 'ready', agentId, userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId, generation: 1, runtimeId: null, capabilityTags: [] }),
      execute: async () => { sends++; return response }
    }) })
  assert.deepEqual(await outbox.enqueueAndWait('task.offer-decision', request), response)
  assert.equal(sends, 1)
  assert.equal(store.snapshot().outbox[0]?.userAuthority, undefined)
})

test('enqueueAndWait joins the exact pending command until authority wakes it to one terminal receipt', async () => {
  const store = await localStore()
  let ready = false
  let attempts = 0
  let projectsCreated = 0
  const command = coordinatorProjectCreateCommand()
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ready
        ? {
            state: 'ready',
            agentId,
            userId: agentNodeFixture.ownerUserId,
            deviceId: agentNodeFixture.deviceId!,
            generation: agentNodeFixture.credentialVersion,
            runtimeId: 'codex',
            capabilityTags: ['agent-runtime.codex', 'model-access.api']
          }
        : { state: 'agent_required', agentId },
      execute: async (_agentId, request) => {
        attempts += 1
        projectsCreated += 1
        return coordinatorProjectCreatedResponse(request)
      }
    }),
    localAgentId: () => TEST_IDS.agentId
  })

  await outbox.enqueue('coordinator.command', command)
  await outbox.waitForIdle()
  let settled = 0
  const first = outbox.enqueueAndWait('coordinator.command', command).then((response) => {
    settled += 1
    return response
  })
  const second = outbox.enqueueAndWait('coordinator.command', {
    ...command,
    requestId: 'req_ProjectCreateRetry1'
  }).then((response) => {
    settled += 1
    return response
  })
  await outbox.waitForIdle()

  assert.equal(settled, 0)
  assert.equal(store.snapshot().outbox.length, 1)
  assert.equal(store.snapshot().outbox[0]?.state, 'pending')
  ready = true
  outbox.wake()
  const expected = coordinatorProjectCreatedResponse(command)
  assert.deepEqual(await Promise.all([first, second]), [expected, expected])
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(attempts, 1)
  assert.equal(projectsCreated, 1)
})

test('a current Worker availability supersedes stale undelivered heartbeat facts', async () => {
  const store = await localStore()
  const attemptedAgentRevisions: number[] = []
  const outbox = availabilityOutbox(store, attemptedAgentRevisions)
  outbox.stop()

  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 45,
    connectionStatus: 'offline',
    observedAt: TEST_TIMESTAMP
  }))
  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 46,
    connectionStatus: 'online',
    observedAt: TEST_LATER_TIMESTAMP
  }))
  outbox.start()
  await outbox.waitForIdle()

  assert.deepEqual(attemptedAgentRevisions, [46])
  const entries = store.snapshot().outbox.filter(({ kind }) => kind === 'worker.availability')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.state, 'delivered', entries[0]?.error)
})

test('a late stale Worker availability cannot supersede the current Agent revision', async () => {
  const store = await localStore()
  const attemptedAgentRevisions: number[] = []
  const outbox = availabilityOutbox(store, attemptedAgentRevisions)
  outbox.stop()

  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 46,
    connectionStatus: 'online',
    observedAt: TEST_LATER_TIMESTAMP
  }))
  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 45,
    connectionStatus: 'offline',
    observedAt: TEST_TIMESTAMP
  }))
  outbox.start()
  await outbox.waitForIdle()

  assert.deepEqual(attemptedAgentRevisions, [46])
  const entries = store.snapshot().outbox.filter(({ kind }) => kind === 'worker.availability')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.state, 'delivered', entries[0]?.error)
})

test('an in-flight Worker availability is retained while the current fact is queued', async () => {
  const store = await localStore()
  const outbox = availabilityOutbox(store, [])
  outbox.stop()
  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 45,
    connectionStatus: 'offline',
    observedAt: TEST_TIMESTAMP
  }))
  await store.transact((draft) => {
    const sending = draft.outbox[0]
    assert.ok(sending)
    sending.state = 'sending'
  })

  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 46,
    connectionStatus: 'online',
    observedAt: TEST_LATER_TIMESTAMP
  }))

  assert.deepEqual(store.snapshot().outbox.map(({ state, body }) => ({
    state,
    expectedAgentRevision: body.expectedAgentRevision
  })), [
    { state: 'sending', expectedAgentRevision: 45 },
    { state: 'pending', expectedAgentRevision: 46 }
  ])
})

test('an uncertain response retries durably without duplicating the cloud write', async () => {
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  authority.dropNextResponse = true
  const outbox = createOutbox(store, authority)

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(authority.businessCommits, 1)

  await outbox.retry(IDEMPOTENCY_KEY)
  await outbox.waitForIdle()

  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(store.snapshot().outbox[0]?.attempts, 2)
  assert.equal(authority.attempts, 2)
  assert.equal(authority.businessCommits, 1)
})

test('restart reconciles an in-flight command and repeated wakes still deliver once', async () => {
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  const firstStore = new CollaborationLocalStore(backend)
  await firstStore.open()
  const dormantAuthority = new IdempotentAgentAuthority()
  dormantAuthority.ready = false
  const dormantOutbox = createOutbox(firstStore, dormantAuthority)
  await dormantOutbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await firstStore.transact((draft) => {
    const entry = draft.outbox[0]
    assert.ok(entry)
    entry.state = 'sending'
    entry.attempts = 1
  })

  const restartedStore = new CollaborationLocalStore(backend)
  const recovered = await restartedStore.open()
  assert.equal(recovered.outbox[0]?.state, 'reconciling')
  const authority = new IdempotentAgentAuthority()
  const outbox = createOutbox(restartedStore, authority)

  outbox.start()
  outbox.wake()
  outbox.wake()
  await outbox.waitForIdle()

  assert.equal(restartedStore.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(restartedStore.snapshot().outbox[0]?.attempts, 2)
  assert.equal(authority.attempts, 1)
  assert.equal(authority.businessCommits, 1)
})

test('persists and replays a strict Cloud fence error as a delivered command result', async () => {
  const store = await localStore()
  let attempts = 0
  const response: RestResponse = {
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: TEST_IDS.requestId,
    error: createCollaborationError('revision_conflict', 'Coordinator fence changed.', {
      requestId: TEST_IDS.requestId,
      expectedRevision: 1,
      currentRevision: 2
    })
  }
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (agentId, request) => {
        assert.equal(agentId, TEST_IDS.agentId)
        assert.equal(request.type, 'task.offer.withdraw')
        attempts += 1
        return response
      }
    }),
    localAgentId: () => TEST_IDS.agentId
  })
  const command = coordinatorWithdrawCommand()

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(attempts, 1)
  assert.deepEqual(store.snapshot().outbox[0], {
    ...store.snapshot().outbox[0],
    state: 'delivered',
    response
  })
})

test('persists a strict Worker offer-claim conflict instead of retrying it as response loss', async () => {
  const store = await localStore()
  const command = restRequestSchema.parse({
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.accept-conflict-01',
    type: 'task.offer.accept',
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1
  })
  const response = restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: command.requestId,
    error: createCollaborationError('revision_conflict', 'Another Device already claimed the offer.')
  })
  let attempts = 0
  const outbox = coordinatorOutbox(store, async () => {
    attempts += 1
    return response
  })

  assert.deepEqual(await outbox.enqueueAndWait('task.offer-decision', command), response)
  assert.deepEqual(await outbox.enqueueAndWait('task.offer-decision', command), response)
  assert.equal(attempts, 1)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('rejects a strict Cloud error whose request envelope belongs to another command', async () => {
  const store = await localStore()
  const command = coordinatorWithdrawCommand()
  const response = restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: 'req_Reque0000002',
    error: createCollaborationError('revision_conflict', 'Coordinator fence changed.')
  })
  const outbox = coordinatorOutbox(store, async () => response)

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('delivers project.create through its exact canonical creation response', async () => {
  const store = await localStore()
  const command = coordinatorProjectCreateCommand()
  const response = coordinatorProjectCreatedResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('rejects a project.create response whose durable facts drift from the request', async () => {
  const store = await localStore()
  const command = coordinatorProjectCreateCommand()
  const response = coordinatorProjectCreatedResponse(command)
  assert.equal(response.type, 'rest.project_created')
  const drifted = restResponseSchema.parse({
    ...response,
    project: { ...response.project, displayName: 'Another Project' }
  })
  const outbox = coordinatorOutbox(store, async () => drifted)

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('delivers human.needed.create through its exact Coordinator request response', async () => {
  const store = await localStore()
  const command = coordinatorHumanNeededCommand()
  const response = coordinatorHumanNeededResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers Worker human.needed.create through its exact execution response', async () => {
  const store = await localStore()
  const command = coordinatorWorkerHumanNeededCommand()
  const response = coordinatorHumanNeededResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers project.decision.submit through its exact Project record collection', async () => {
  const store = await localStore()
  const command = coordinatorDecisionCommand()
  const response = coordinatorDecisionResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers task.offer.create only through its exact canonical collection response', async () => {
  const store = await localStore()
  const command = coordinatorCreateCommand()
  const response = coordinatorOfferCollection(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers task.offer.reject only through its exact User-level closure response', async () => {
  const store = await localStore()
  const command = workerRejectCommand()
  const response = workerRejectCollection(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('task.offer-decision', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(response.type, 'rest.collection')
  const [task, offer] = response.items
  assert.equal(task?.type, 'task')
  assert.equal(offer?.type, 'task_offer')
  assert.equal(offer?.type === 'task_offer' ? offer.reassignmentTaskRevision : null, task?.revision)
})

test('delivers task.offer.withdraw only through its exact terminal collection response', async () => {
  const store = await localStore()
  const command = coordinatorWithdrawCommand()
  const response = coordinatorWithdrawCollection(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers an exact task.offer.reassign response without conjecturing executionCount', async () => {
  const store = await localStore()
  const command = coordinatorReassignCommand()
  const response = coordinatorReassignCollection(command)
  const outbox = coordinatorOutbox(store, async () => response, true)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(response.type, 'rest.collection')
  const [task, successorOffer] = response.items
  assert.equal(task?.type, 'task')
  assert.equal(successorOffer?.type, 'task_offer')
  assert.deepEqual(task?.type === 'task' ? task.fileIntent : undefined, command.nextFileIntent)
  assert.equal(task?.type === 'task' ? task.executionCount : undefined, 2)
  assert.notEqual(
    successorOffer?.type === 'task_offer' ? successorOffer.taskOfferId : undefined,
    command.previousTaskOfferId
  )
})

test('rejects task.offer.reassign success whose Task file intent drifts from the request', async () => {
  const store = await localStore()
  const command = coordinatorReassignCommand()
  const response = coordinatorReassignCollection(command)
  assert.equal(response.type, 'rest.collection')
  const [task, successorOffer] = response.items
  assert.equal(task?.type, 'task')
  assert.equal(successorOffer?.type, 'task_offer')
  const drifted = restResponseSchema.parse({
    ...response,
    items: [{ ...task, fileIntent: null }, successorOffer]
  })
  const outbox = coordinatorOutbox(store, async () => drifted, true)

  await assert.rejects(
    outbox.enqueueAndWait('coordinator.command', command),
    /Unexpected reassignment response/u
  )
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.deliveredAt, undefined)
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('rejects task.offer.reassign success that reuses the previous Task offer identity', async () => {
  const store = await localStore()
  const command = coordinatorReassignCommand()
  const response = coordinatorReassignCollection(command)
  assert.equal(response.type, 'rest.collection')
  const [task, successorOffer] = response.items
  assert.equal(task?.type, 'task')
  assert.equal(successorOffer?.type, 'task_offer')
  const drifted = restResponseSchema.parse({
    ...response,
    items: [task, { ...successorOffer, taskOfferId: command.previousTaskOfferId }]
  })
  const outbox = coordinatorOutbox(store, async () => drifted, true)

  await assert.rejects(
    outbox.enqueueAndWait('coordinator.command', command),
    /Unexpected reassignment response/u
  )
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.deliveredAt, undefined)
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('rejects collection response drift instead of treating an arbitrary page as write success', async () => {
  const store = await localStore()
  const command = coordinatorCreateCommand()
  const response = coordinatorOfferCollection(command)
  assert.equal(response.type, 'rest.collection')
  const drifted = restResponseSchema.parse({
    ...response,
    nextCursor: 'opaque-write-page-cursor'
  })
  const outbox = coordinatorOutbox(store, async () => drifted)

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('a repeated idempotent Coordinator command retries its original durable body after response loss', async () => {
  const store = await localStore()
  const command = coordinatorCreateCommand()
  const committedResponse = coordinatorOfferCollection(command)
  let attempts = 0
  let businessCommits = 0
  let responseLost = true
  let committed = false
  const outbox = coordinatorOutbox(store, async () => {
    attempts += 1
    if (!committed) {
      committed = true
      businessCommits += 1
    }
    if (responseLost) {
      responseLost = false
      throw new Error('response lost after canonical Cloud commit')
    }
    return committedResponse
  })

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(
    await outbox.resumeAndWait(
      'coordinator.command',
      'idem_UnknownCoordinatorReplay001',
      () => undefined
    ),
    null
  )
  await assert.rejects(
    outbox.resumeAndWait(
      'task.external-operation',
      command.idempotencyKey,
      () => undefined
    ),
    /another command kind/u
  )
  await assert.rejects(
    outbox.resumeAndWait(
      'coordinator.command',
      command.idempotencyKey,
      () => { throw new Error('replayed input conflict') }
    ),
    /replayed input conflict/u
  )
  assert.equal(attempts, 1)
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.deepEqual(
    await outbox.resumeAndWait(
      'coordinator.command',
      command.idempotencyKey,
      (request) => { assert.deepEqual(request, command) }
    ),
    { request: command, response: committedResponse }
  )
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.deepEqual(store.snapshot().outbox[0]?.response, committedResponse)
  assert.equal(attempts, 2)
  assert.equal(businessCommits, 1)
})

test('does not change existing fire-and-retry outbox error semantics', async () => {
  const store = await localStore()
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => ({
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: request.requestId,
        error: createCollaborationError('provider_unavailable', 'Provider is temporarily unavailable.')
      })
    }),
    localAgentId: () => TEST_IDS.agentId
  })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('rejects a non-strict upstream response without persisting its raw body', async () => {
  const store = await localStore()
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => ({
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: request.requestId,
        error: createCollaborationError('revision_conflict', 'Coordinator fence changed.'),
        rawUpstreamBody: { internalDebug: 'must-not-be-retained' }
      } as never)
    }),
    localAgentId: () => TEST_IDS.agentId
  })

  await assert.rejects(
    outbox.enqueueAndWait('coordinator.command', coordinatorWithdrawCommand())
  )
  const entry = store.snapshot().outbox[0]
  assert.equal(entry?.state, 'failed')
  assert.equal(entry?.response, undefined)
  assert.equal(JSON.stringify(entry).includes('must-not-be-retained'), false)
})

class IdempotentAgentAuthority {
  ready = true
  attempts = 0
  businessCommits = 0
  dropNextResponse = false
  private readonly committed = new Map<string, RestResponse>()

  readonly runtime = createTestAgentCloudRuntime({
    authorityStatus: async (agentId) => this.ready
      ? {
          state: 'ready',
          agentId,
          userId: agentNodeFixture.ownerUserId,
          deviceId: agentNodeFixture.deviceId!,
          generation: agentNodeFixture.credentialVersion,
          runtimeId: 'codex',
          capabilityTags: ['agent-runtime.codex', 'model-access.api']
        }
      : { state: 'agent_required', agentId },
    execute: async (agentId, request) => {
      assert.equal(agentId, TEST_IDS.agentId)
      this.attempts += 1
      const idempotencyKey = 'idempotencyKey' in request ? request.idempotencyKey : undefined
      assert.ok(idempotencyKey)
      let response = this.committed.get(idempotencyKey)
      if (!response) {
        this.businessCommits += 1
        response = receiptFor(request)
        this.committed.set(idempotencyKey, response)
      }
      if (this.dropNextResponse) {
        this.dropNextResponse = false
        throw new Error('response lost after cloud commit')
      }
      return response
    }
  })
}

function createOutbox(
  store: CollaborationLocalStore,
  authority: IdempotentAgentAuthority
): DurableCloudOutbox {
  return new DurableCloudOutbox({
    store,
    agentCloudRuntime: authority.runtime,
    localAgentId: () => TEST_IDS.agentId
  })
}

function receiptFor(request: RestRequest): RestResponse {
  assert.equal(request.type, 'projection.message.publish')
  return {
    protocolVersion: '1.0',
    type: 'rest.receipt',
    requestId: request.requestId,
    receipt: {
      schemaVersion: 1,
      type: 'projection.message.receipt',
      receiptId: 'rcp_Outbox000001',
      createdAt: TEST_TIMESTAMP,
      projectionId: request.projectionId,
      direction: 'local_to_remote',
      localItemId: request.localItemId,
      payloadHash: TEST_HASH,
      attempt: 1,
      status: 'succeeded',
      providerMessageId: 'provider-outbox-message-1'
    }
  }
}

function availabilityCommand(input: Readonly<{
  expectedAgentRevision: number
  connectionStatus: 'online' | 'offline'
  observedAt: string
}>): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: input.expectedAgentRevision === 45
      ? 'req_AvailabilityStale01'
      : 'req_AvailabilityCurrent1',
    idempotencyKey: `idem_worker.availability.${input.expectedAgentRevision}`,
    type: 'worker.availability.publish',
    agentId: TEST_IDS.agentId,
    expectedAgentRevision: input.expectedAgentRevision,
    connectionStatus: input.connectionStatus,
    lastHeartbeatAt: input.connectionStatus === 'online' ? TEST_LATER_TIMESTAMP : null,
    runtimeReadiness: 'ready',
    runtimeCapabilityTags: ['agent-runtime.codex', 'model-access.api'],
    acceptsNewOffers: input.connectionStatus === 'online',
    activeTaskCount: 0,
    observedAt: input.observedAt
  }
}

function availabilityOutbox(
  store: CollaborationLocalStore,
  attemptedAgentRevisions: number[]
): DurableCloudOutbox {
  return new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        assert.equal(request.type, 'worker.availability.publish')
        if (request.type !== 'worker.availability.publish') {
          throw new Error('Expected a Worker availability command.')
        }
        attemptedAgentRevisions.push(request.expectedAgentRevision)
        if (request.expectedAgentRevision === 45) {
          return {
            protocolVersion: '1.0',
            type: 'rest.error',
            requestId: request.requestId,
            error: createCollaborationError(
              'revision_conflict',
              'The resource revision is stale.'
            )
          }
        }
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: {
            schemaVersion: 1,
            type: 'worker_availability_projection',
            userId: agentNodeFixture.ownerUserId,
            agentId: TEST_IDS.agentId,
            deviceId: agentNodeFixture.deviceId!,
            agentActive: true,
            deviceActive: true,
            connectionStatus: 'online',
            lastHeartbeatAt: TEST_LATER_TIMESTAMP,
            runtimeReadiness: 'ready',
            runtimeCapabilityTags: ['agent-runtime.codex', 'model-access.api'],
            acceptsNewOffers: true,
            activeTaskCount: 0,
            observedAt: TEST_LATER_TIMESTAMP,
            expiresAt: '2099-08-15T09:01:30.000Z',
            revision: 2,
            createdAt: TEST_TIMESTAMP,
            updatedAt: TEST_LATER_TIMESTAMP
          }
        }
      }
    }),
    localAgentId: () => TEST_IDS.agentId
  })
}

function coordinatorWithdrawCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.withdraw-outbox-01',
    type: 'task.offer.withdraw',
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    reason: 'Coordinator changed the synthetic assignment.'
  }
}

function coordinatorProjectCreateCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_project.create-outbox-01',
    type: 'project.create',
    createIntentId: 'pct_OutboxCreateIntent01',
    displayName: 'Durable Project',
    goal: 'Create a durable collaboration Project exactly once.',
    budget: {
      maxTasks: 20,
      maxTasksPerRound: 4,
      maxCoordinationRounds: 10,
      maxTaskRetries: 2
    }
  }
}

function coordinatorProjectCreatedResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'project.create')
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.project_created',
    requestId: request.requestId,
    project: {
      ...projectFixture,
      displayName: request.displayName,
      goal: request.goal,
      budget: request.budget,
      status: 'draft'
    },
    memberships: [{
      schemaVersion: 1,
      type: 'project_membership',
      projectMembershipId: TEST_IDS.projectMembershipId,
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      state: 'active',
      authorityEpoch: 1,
      activatedAt: TEST_TIMESTAMP,
      removalRequestedAt: null,
      removalRequestedByUserId: null,
      removedAt: null,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }]
  })
}

function coordinatorHumanNeededCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_human.needed.create-outbox-01',
    type: 'human.needed.create',
    projectId: TEST_IDS.projectId,
    targetUserId: TEST_IDS.secondUserId,
    context: {
      scope: 'coordinator_project',
      expectedProjectRevision: 5,
      expectedCoordinatorAuthorityEpoch: 2
    },
    requiredAssurance: 'verified',
    prompt: 'Choose the direction the Coordinator should record.',
    interaction: { kind: 'clarification' },
    confirmableAction: null,
    expiresAt: TEST_LATER_TIMESTAMP
  }
}

function coordinatorWorkerHumanNeededCommand(): RestRequest {
  const command = coordinatorHumanNeededCommand()
  assert.equal(command.type, 'human.needed.create')
  return {
    ...command,
    idempotencyKey: 'idem_human.needed.worker-outbox-01',
    context: {
      scope: 'worker_execution',
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      expectedTaskRevision: 4,
      expectedExecutionRevision: 3
    }
  }
}

function coordinatorHumanNeededResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'human.needed.create')
  const context = request.context.scope === 'worker_execution'
    ? {
        scope: 'worker_execution' as const,
        taskId: request.context.taskId,
        executionId: request.context.executionId
      }
    : {
        scope: 'coordinator_project' as const,
        coordinatorAuthorityEpoch: request.context.expectedCoordinatorAuthorityEpoch
      }
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId: request.requestId,
    entity: {
      ...humanNeededFixture,
      projectId: request.projectId,
      context,
      targetUserId: request.targetUserId,
      requestedByAgentId: TEST_IDS.agentId,
      requiredAssurance: request.requiredAssurance,
      prompt: request.prompt,
      interaction: request.interaction,
      confirmableAction: request.confirmableAction,
      expiresAt: request.expiresAt
    }
  })
}

function coordinatorDecisionCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_project.decision.submit-outbox-01',
    type: 'project.decision.submit',
    projectId: TEST_IDS.projectId,
    humanRequestId: TEST_IDS.humanRequestId,
    humanAnswerId: TEST_IDS.humanAnswerId,
    expectedProjectRevision: 5,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedHumanRequestRevision: 2,
    expectedHumanAnswerRevision: 1,
    decision: 'Proceed with the confirmed lower-risk direction.'
  }
}

function coordinatorDecisionResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'project.decision.submit')
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [{
      ...projectFixture,
      coordinatorAuthorityEpoch: request.expectedCoordinatorAuthorityEpoch,
      revision: request.expectedProjectRevision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    }, {
      ...projectRecordFixture,
      kind: 'decision',
      body: request.decision,
      sourceTaskId: null,
      sourceResultSubmissionId: null,
      sourceHumanAnswerId: request.humanAnswerId,
      sourceRevision: request.expectedHumanAnswerRevision,
      acceptedAt: TEST_LATER_TIMESTAMP,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }]
  })
}

function coordinatorCreateCommand(): Extract<RestRequest, { type: 'task.offer.create' }> {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.create-outbox-01',
    type: 'task.offer.create',
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    requirementsDocumentId: 'rqd_CommandFixture00000001',
    requirementsDocumentRevision: 1,
    requirementsContentDigest: TEST_HASH,
    workerUserId: TEST_IDS.secondUserId,
    planItemId: 'item_Plan00000001',
    offerExpiresAt: TEST_LATER_TIMESTAMP
  }
}

function coordinatorReassignCommand(): Extract<RestRequest, { type: 'task.offer.reassign' }> {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.reassign-outbox-01',
    type: 'task.offer.reassign',
    taskId: TEST_IDS.taskId,
    previousTaskOfferId: TEST_IDS.taskOfferId,
    expectedPreviousOfferRevision: 1,
    expectedProjectRevision: 1,
    expectedTaskRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    workerUserId: TEST_IDS.secondUserId,
    offerExpiresAt: TEST_LATER_TIMESTAMP,
    nextFileIntent: reassignedFileIntent()
  }
}

function reassignedFileIntent() {
  return {
    schemaVersion: 1 as const,
    inputs: [],
    output: {
      kind: 'delivery.output' as const,
      fileName: 'reassigned-analysis.md',
      mediaType: 'text/markdown',
      maxBytes: 65_536
    }
  }
}

function coordinatorOfferCollection(request: RestRequest): RestResponse {
  const taskRevision = request.type === 'task.offer.reassign'
    ? request.expectedTaskRevision + 1
    : 1
  const taskId = request.type === 'task.offer.create'
    ? (canonicalTaskIdForRequirementsModule(request.requirementsDocumentId, request.planItemId))
    : TEST_IDS.taskId
  const workerUserId = request.type === 'task.offer.reassign'
    ? request.workerUserId
    : TEST_IDS.secondUserId
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: TEST_IDS.taskOfferId,
    projectId: TEST_IDS.projectId,
    taskId,
    executionId: null,
    workerUserId,
    offeredByCoordinatorAgentId: TEST_IDS.agentId,
    state: 'pending',
    reassignmentTaskRevision: null,
    offeredAt: TEST_TIMESTAMP,
    expiresAt: TEST_LATER_TIMESTAMP,
    respondedAt: null,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [{
      ...taskFixture,
      taskId,
      fileIntent: request.type === 'task.offer.reassign'
        ? request.nextFileIntent
        : taskFixture.fileIntent,
      executionCount: request.type === 'task.offer.reassign'
        ? 2
        : taskFixture.executionCount,
      revision: taskRevision,
      updatedAt: taskRevision === 1 ? TEST_TIMESTAMP : TEST_LATER_TIMESTAMP
    }, offer]
  })
}

function coordinatorWithdrawCollection(request: RestRequest): RestResponse {
  const created = coordinatorOfferCollection(request)
  assert.equal(created.type, 'rest.collection')
  const task = created.items.find((item) => item.type === 'task')
  const offer = created.items.find((item) => item.type === 'task_offer')
  assert.ok(task && offer)
  return restResponseSchema.parse({
    ...created,
    items: [
      {
        ...task,
        status: 'revision_requested',
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      },
      {
        ...offer,
        state: 'withdrawn',
        reassignmentTaskRevision: task.revision + 1,
        respondedAt: TEST_LATER_TIMESTAMP,
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      }
    ]
  })
}

function workerRejectCommand(): Extract<RestRequest, { type: 'task.offer.reject' }> {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.reject-outbox-01',
    type: 'task.offer.reject',
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1
  }
}

function workerRejectCollection(
  request: Extract<RestRequest, { type: 'task.offer.reject' }>
): RestResponse {
  const taskRevision = request.expectedTaskRevision + 1
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [{
      ...taskFixture,
      taskId: request.taskId,
      status: 'revision_requested',
      currentExecutionId: null,
      currentExecutionState: null,
      completedAt: null,
      revision: taskRevision,
      updatedAt: TEST_LATER_TIMESTAMP
    }, {
      schemaVersion: 1,
      type: 'task_offer',
      taskOfferId: request.taskOfferId,
      projectId: TEST_IDS.projectId,
      taskId: request.taskId,
      executionId: null,
      workerUserId: agentNodeFixture.ownerUserId,
      offeredByCoordinatorAgentId: TEST_IDS.secondAgentId,
      state: 'rejected',
      reassignmentTaskRevision: taskRevision,
      offeredAt: TEST_TIMESTAMP,
      expiresAt: TEST_LATER_TIMESTAMP,
      respondedAt: TEST_LATER_TIMESTAMP,
      revision: request.expectedOfferRevision + 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }]
  })
}

function coordinatorReassignCollection(request: RestRequest): RestResponse {
  const created = coordinatorOfferCollection(request)
  assert.equal(created.type, 'rest.collection')
  const task = created.items.find((item) => item.type === 'task')
  const offer = created.items.find((item) => item.type === 'task_offer')
  assert.ok(task && offer)
  return restResponseSchema.parse({
    ...created,
    items: [task, { ...offer, taskOfferId: 'ofr_Offer00000002' }]
  })
}

test('candidate validation rejection preserves its request-bound receipt and never retries frozen content', async () => {
  const store = await localStore()
  let sends = 0
  const outbox = new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    authenticatedCloudTransport: {
      status: () => ({ state: 'ready', baseUrl: 'https://cloud.invalid', userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
      execute: async ({ payload }: { payload: unknown }) => {
        const request = restRequestSchema.parse(payload)
        sends++
        return { contractVersion: 1, status: 400, body: { protocolVersion: '1.0', type: 'rest.error', requestId: request.requestId,
          error: { protocolVersion: '1.0', type: 'error', code: 'validation_error', category: 'validation', httpStatus: 400, retryable: false, message: 'Additional file violates policy.' } } }
      }
    } as never
  })
  const request = restRequestSchema.parse({ protocolVersion: '1.0', requestId: 'req_CandidateValidation01', type: 'delivery.candidate.create',
    idempotencyKey: 'idem_candidate_validation_01', candidateId: 'cnd_CandidateTest0001', projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId, workerUserId: TEST_IDS.userId,
    contractRevision: 1, resultRevision: 1, bundleDigest: 'a'.repeat(64), bundleObjectId: 'obj_BundleTest00001', outputObjectIds: [] })
  await assert.rejects(outbox.enqueueAndWait('delivery.command', request), /violates policy/u)
  const failed = store.snapshot().outbox[0]!
  assert.equal(failed.state, 'failed')
  assert.equal(failed.response?.type, 'rest.error')
  assert.equal(failed.response?.requestId, request.requestId)
  await outbox.retry()
  await outbox.waitForIdle()
  await assert.rejects(outbox.enqueueAndWait('delivery.command', request), /violates policy/u)
  assert.equal(sends, 1)
  assert.equal(store.snapshot().outbox[0]!.state, 'failed')
  // A pre-fix row has no verified rejection receipt and must still be able to
  // obtain one through the original command, never through a fabricated result.
  await store.transact(draft => { draft.outbox[0]!.response = undefined })
  await assert.rejects(outbox.enqueueAndWait('delivery.command', request), /violates policy/u)
  assert.equal(sends, 2)
  assert.equal(store.snapshot().outbox[0]!.response?.type, 'rest.error')
  outbox.stop()
})

function coordinatorOutbox(
  store: CollaborationLocalStore,
  execute: (agentId: string, request: RestRequest) => Promise<RestResponse>,
  authenticated = false
): DurableCloudOutbox {
  return new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute
    }),
    localAgentId: () => TEST_IDS.agentId,
    authenticatedCloudTransport: authenticated ? {
      status: () => ({ state: 'ready', baseUrl: 'https://cloud.example.test', userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
      execute: async ({ payload }) => {
        const request = restRequestSchema.parse(payload)
        assert.equal(request.type, 'task.offer.reassign')
        return { contractVersion: 1, status: 200, body: await execute(TEST_IDS.agentId, request) }
      },
      lookupDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
      createDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
      revokeDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
      readDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
      mutateDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
      listCloudSpaces: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
      ensureCloudSpace: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
      createCloudSpaceSession: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
      stageObject: async () => { throw new Error('No object upload expected') },
      readObject: async () => { throw new Error('No object read expected') }
    } : undefined
  })
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

async function localStore(): Promise<CollaborationLocalStore> {
  const store = new CollaborationLocalStore(
    new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  )
  await store.open()
  return store
}


test('unsupported persisted commands fail explicitly without blocking the canonical queue', async () => {
  const store = await localStore()
  await store.transact((draft) => {
    draft.outbox.push({ outboxId: 'out_RetiredCommand0001', idempotencyKey: 'idem_retired_command_01',
      kind: 'coordinator.command', body: { protocolVersion: '1.0', requestId: 'req_RetiredCommand001', type: 'project.plan.submit' },
      state: 'pending', attempts: 0, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP })
  })
  const authority = new IdempotentAgentAuthority()
  authority.ready = true
  const outbox = createOutbox(store, authority)
  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.match(store.snapshot().outbox[0]?.error ?? '', /Unsupported or retired Cloud command: project\.plan\.submit/u)
  assert.equal(store.snapshot().outbox[1]?.state, 'delivered')
  assert.equal(authority.businessCommits, 1)
})

test('a command blocked on the Agent identity records the wait and retries on its own once the identity is ready', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  let localAgentId: string | undefined
  const outbox = new DurableCloudOutbox({ store, agentCloudRuntime: authority.runtime, localAgentId: () => localAgentId })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'pending')
  assert.equal(store.snapshot().outboxWait?.reason, 'agent_identity')

  localAgentId = TEST_IDS.agentId
  // No connection event wakes the queue: its own bounded retry must.
  context.mock.timers.tick(5_000)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(store.snapshot().outboxWait, null)
  outbox.stop()
})

test('a hung Agent authority check is bounded, recorded and retried without blocking the queue', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  const ready = authority.runtime.authorityStatus
  let checks = 0
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: {
      ...authority.runtime,
      authorityStatus: (agentId) => (checks += 1) === 1 ? new Promise(() => undefined) : ready(agentId)
    },
    localAgentId: () => TEST_IDS.agentId
  })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await settle()
  context.mock.timers.tick(45_000)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'pending')
  assert.equal(store.snapshot().outbox[0]?.attempts, 0)
  assert.equal(store.snapshot().outboxWait?.reason, 'authority_check')

  context.mock.timers.tick(5_000)
  await outbox.waitForIdle()
  assert.equal(checks, 2)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(store.snapshot().outboxWait, null)
  outbox.stop()
})

test('a hung Cloud send fails as transport-unavailable after its bound and releases the queue', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  let sends = 0
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: {
      ...authority.runtime,
      execute: (input) => (sends += 1) === 1 ? new Promise(() => undefined) : authority.runtime.execute(input)
    },
    localAgentId: () => TEST_IDS.agentId
  })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await settle()
  context.mock.timers.tick(45_000)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.failureReason, 'transport_unavailable')

  await outbox.enqueueProjectionDelivery({ ...COMMAND, localItemId: 'lit_Local0000002' }, 'idem_projection.outbox-recovery-02')
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[1]?.state, 'delivered')
  outbox.stop()
})

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}


for (const legacy of [false, true]) test(`object 413 survives wakes and restart, then explicit retry reuses bytes and identity (legacy=${legacy})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-upload-'))
  const bytes = Buffer.from('a,b\n1,2\n')
  const path = join(root, 'result.csv')
  await writeFile(path, bytes)
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  let store = new CollaborationLocalStore(backend)
  await store.open()
  let rejected = true
  let sends = 0
  const requests: unknown[] = []
  const transport = { status: () => userStatus(), stageObject: async (input) => {
    sends++
    requests.push(input.request)
    assert.deepEqual(Buffer.from(input.body), bytes)
    if (rejected) throw new AuthenticatedCloudTransportError('object_upload_limit', 'Cloud object request returned HTTP 413.')
    return { protocolVersion: '1.0', type: 'rest.object.staged', requestId: input.request.requestId,
      object: { objectId: 'obj_UploadResult001', objectKey: 'immutable/result', revision: 1,
        projectId: TEST_IDS.projectId, sha256: input.request.sha256, byteCount: bytes.length,
        mediaType: 'text/csv', visibility: 'staged', ownerUserId: TEST_IDS.userId, retentionUntil: null } }
  } } as AuthenticatedCloudTransport
  const makeOutbox = () => new DurableCloudOutbox({ store, agentCloudRuntime: createTestAgentCloudRuntime({}),
    authenticatedCloudTransport: transport, localAgentId: () => TEST_IDS.agentId })
  let outbox = makeOutbox()
  const request = { protocolVersion: '1.0' as const, type: 'object.stage' as const,
    requestId: 'req_UploadLimit001', idempotencyKey: 'idem_upload-limit-result',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: bytes.length, mediaType: 'text/csv' }
  try {
    await assert.rejects(outbox.stageAndWait(request, path), /HTTP 413/u)
    assert.equal(store.snapshot().outbox[0]?.failureReason, 'object_upload_limit')
    await outbox.retry()
    await outbox.retry(store.snapshot().outbox[0]!.outboxId)
    await outbox.retry(request.idempotencyKey)
    await outbox.waitForIdle()
    assert.equal(sends, 1, 'generic retry cannot clear a parked upload limit')
    assert.equal(store.snapshot().outbox[0]?.error, 'Cloud object request returned HTTP 413.')
    if (legacy) await store.transact(draft => {
      draft.outbox[0]!.failureReason = 'command_failed'
      // The old stageAndWait may have revived the row immediately before shutdown.
      draft.outbox[0]!.state = 'reconciling'
    })
    outbox.wake()
    await outbox.waitForIdle()
    await assert.rejects(outbox.stageAndWait(request, path), /HTTP 413/u)
    outbox.stop()
    store = new CollaborationLocalStore(backend)
    await store.open()
    outbox = makeOutbox()
    outbox.start()
    await outbox.waitForIdle()
    await assert.rejects(outbox.stageAndWait(request, path), /HTTP 413/u)
    assert.equal(sends, 1)
    assert.equal(store.snapshot().outbox[0]?.attempts, 1)
    rejected = false
    await outbox.stageAndWait(request, path, { explicitRetry: true })
    assert.equal(sends, 2)
    assert.deepEqual(requests, [request, request])
    assert.equal(store.snapshot().outbox.length, 1)
    await outbox.stageAndWait(request, path, { explicitRetry: true })
    assert.equal(sends, 2)
  } finally { outbox.stop(); await rm(root, { recursive: true, force: true }) }
})


for (const code of ['cloud_unavailable', 'cloud_rejected', 'network'] as const) test(`transient object ${code} remains automatically resumable`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-transient-upload-'))
  const path = join(root, 'result.txt')
  const bytes = Buffer.from('transient retry')
  await writeFile(path, bytes)
  const store = await localStore()
  let sends = 0
  const request = { protocolVersion: '1.0' as const, type: 'object.stage' as const,
    requestId: 'req_TransientUpload1', idempotencyKey: 'idem_transient-upload-one',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: bytes.length, mediaType: 'text/plain' }
  const outbox = new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({}), authenticatedCloudTransport: {
      status: () => userStatus(),
      stageObject: async () => {
        if (++sends === 1) throw code === 'network' ? new TypeError('fetch failed') :
          new AuthenticatedCloudTransportError(code, `Cloud object request returned HTTP ${code === 'cloud_rejected' ? 429 : 503}.`)
        return { protocolVersion: '1.0', type: 'rest.object.staged', requestId: request.requestId,
          object: { objectId: 'obj_Transient0001', objectKey: 'immutable/transient', revision: 1,
            projectId: TEST_IDS.projectId, sha256: request.sha256, byteCount: bytes.length,
            mediaType: request.mediaType, visibility: 'staged', ownerUserId: TEST_IDS.userId, retentionUntil: null } }
      }
    } as unknown as AuthenticatedCloudTransport })
  try {
    await assert.rejects(outbox.stageAndWait(request, path))
    await outbox.stageAndWait(request, path)
    assert.equal(sends, 2)
    assert.equal(store.snapshot().outbox.length, 1)
  } finally { outbox.stop(); await rm(root, { recursive: true, force: true }) }
})

function userStatus(): { state: 'ready'; baseUrl: string; userId: string; deviceId: string; deviceRevision: number } {
  return { state: 'ready' as const, baseUrl: 'https://cloud.example.test', userId: TEST_IDS.userId,
    deviceId: TEST_IDS.deviceId, deviceRevision: 1 }
}

function boundUserRequest(): RestRequest {
  return restRequestSchema.parse({ protocolVersion: '1.0', requestId: 'req_BoundUser0001',
    type: 'delivery.adoption.record', idempotencyKey: 'idem_bound-user-command-01',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
    deliveryManifestId: 'mft_BoundManifest001', integrationRevision: 1,
    validationEvidence: ['Reviewed immutable delivery'], operationId: 'adoption-bound-command', disposition: 'adopted' })
}

function boundUserOutbox(store: CollaborationLocalStore, status: () => ReturnType<typeof userStatus>,
  execute: (request: RestRequest) => Promise<RestResponse>): DurableCloudOutbox {
  return new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({ execute: async () => { throw new Error('User command reached Agent transport') } }),
    authenticatedCloudTransport: { status, execute: async ({ payload }) =>
      ({ contractVersion: 1, status: 200, body: await execute(restRequestSchema.parse(payload)) }) } as AuthenticatedCloudTransport })
}

function boundUserReceipt(request: RestRequest): RestResponse {
  return restResponseSchema.parse({ protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
    entity: projectFixture })
}

for (const restart of [false, true]) for (const dimension of ['userId', 'deviceId', 'baseUrl'] as const) {
  test(`User creation binding blocks changed ${dimension}, restart=${restart}`, async () => {
    const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
    let store = new CollaborationLocalStore(backend)
    await store.open()
    let status = userStatus()
    let sends = 0
    const execute = async (request: RestRequest) => { sends++; return boundUserReceipt(request) }
    let outbox = boundUserOutbox(store, () => status, execute)
    outbox.stop()
    const request = boundUserRequest()
    await outbox.enqueue('delivery.command', request)
    const original = store.snapshot().outbox[0]!
    status = { ...status, [dimension]: dimension === 'userId' ? TEST_IDS.secondUserId :
      dimension === 'deviceId' ? 'dev_OtherDevice0001' : 'https://other-cloud.example.test' }
    if (restart) {
      store = new CollaborationLocalStore(backend)
      await store.open()
      outbox = boundUserOutbox(store, () => status, execute)
    }
    outbox.start()
    await outbox.waitForIdle()
    assert.equal(sends, 0)
    assert.equal(store.snapshot().outbox[0]?.failureReason, 'authority_lost')
    await outbox.retry()
    await outbox.waitForIdle()
    assert.equal(sends, 0)
    await assert.rejects(outbox.enqueue('delivery.command', request), /creation authority/u)
    await assert.rejects(outbox.resumeAndWait('delivery.command', original.idempotencyKey, () => {}), /creation authority/u)
    assert.deepEqual(store.snapshot().outbox[0]?.body, original.body)
    assert.deepEqual(store.snapshot().outbox[0]?.userAuthority, original.userAuthority)
    outbox.stop()
  })
}

test('User receipt survives restart and revision renewal; another identity cannot resume it', async () => {
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  let store = new CollaborationLocalStore(backend)
  await store.open()
  let status = userStatus()
  let sends = 0
  const execute = async (request: RestRequest) => { sends++; return boundUserReceipt(request) }
  let outbox = boundUserOutbox(store, () => status, execute)
  const request = boundUserRequest()
  const response = await outbox.enqueueAndWait('delivery.command', request)
  outbox.stop()
  store = new CollaborationLocalStore(backend)
  await store.open()
  status = { ...status, deviceRevision: 2 }
  outbox = boundUserOutbox(store, () => status, execute)
  assert.deepEqual((await outbox.resumeAndWait('delivery.command', 'idem_bound-user-command-01', () => {}))?.response, response)
  assert.equal(sends, 1)
  status = { ...status, userId: TEST_IDS.secondUserId }
  await assert.rejects(outbox.resumeAndWait('delivery.command', 'idem_bound-user-command-01', () => {}), /creation authority/u)
  assert.deepEqual(store.snapshot().outbox[0]?.response, response)
  await store.transact(draft => { draft.outbox[0]!.userAuthority = undefined })
  await assert.rejects(outbox.resumeAndWait('delivery.command', 'idem_bound-user-command-01', () => {}), /no creation authority/u)
  assert.deepEqual(store.snapshot().outbox[0]?.response, response)
  outbox.stop()
})

test('lost User response cannot be retried by another identity; original identity reconciles original body', async () => {
  const store = await localStore()
  let status = userStatus()
  let sends = 0
  const request = boundUserRequest()
  const outbox = boundUserOutbox(store, () => status, async original => {
    sends++
    if (sends === 1) throw new Error('response lost after commit')
    assert.deepEqual(original, request)
    return boundUserReceipt(original)
  })
  await assert.rejects(outbox.enqueueAndWait('delivery.command', request), /response lost/u)
  const original = store.snapshot().outbox[0]!
  status = { ...status, userId: TEST_IDS.secondUserId }
  await outbox.retry()
  await outbox.waitForIdle()
  assert.equal(sends, 1)
  assert.deepEqual(store.snapshot().outbox[0], original, 'another identity must not overwrite the retained lost-response failure')
  assert.deepEqual(store.snapshot().outbox[0]?.userAuthority, original.userAuthority)
  status = userStatus()
  assert.deepEqual((await outbox.resumeAndWait('delivery.command', original.idempotencyKey, () => {}))?.response, boundUserReceipt(request))
  assert.equal(sends, 2)
  outbox.stop()
})

test('legacy User command without binding is failed closed without dispatch', async () => {
  const store = await localStore()
  let sends = 0
  const outbox = boundUserOutbox(store, userStatus, async request => { sends++; return boundUserReceipt(request) })
  outbox.stop()
  await outbox.enqueue('delivery.command', boundUserRequest())
  await store.transact(draft => { draft.outbox[0]!.userAuthority = undefined })
  outbox.start()
  await outbox.waitForIdle()
  assert.equal(sends, 0)
  assert.equal(store.snapshot().outbox[0]?.failureReason, 'authority_lost')
  outbox.stop()
})

test('stage identity is checked after sending checkpoint and before reading private bytes', async () => {
  const store = await localStore()
  let status = userStatus()
  let sends = 0
  const outbox = new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({}), authenticatedCloudTransport: {
      status: () => status, stageObject: async () => { sends++; throw new Error('unexpected stage') }
    } as unknown as AuthenticatedCloudTransport })
  const transact = store.transact.bind(store)
  store.transact = async operation => {
    const result = await transact(operation)
    if (store.snapshot().outbox.some(entry => entry.state === 'sending')) status = { ...status, userId: TEST_IDS.secondUserId }
    return result
  }
  const request = { protocolVersion: '1.0' as const, type: 'object.stage' as const,
    requestId: 'req_BoundStage0001', idempotencyKey: 'idem_bound-stage-command-01',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    sha256: TEST_HASH, byteCount: 12, mediaType: 'text/plain' }
  await assert.rejects(outbox.stageAndWait(request, 'nonexistent-private-file'), /creation authority/u)
  assert.equal(sends, 0)
  assert.match(store.snapshot().outbox[0]?.error ?? '', /creation authority/u)
  assert.equal(store.snapshot().outbox[0]?.failureReason, 'authority_lost')
  outbox.stop()
})

test('User command checks creation identity again after the asynchronous sending checkpoint', async () => {
  const store = await localStore()
  let status = userStatus()
  let sends = 0
  const outbox = boundUserOutbox(store, () => status, async request => { sends++; return boundUserReceipt(request) })
  const transact = store.transact.bind(store)
  store.transact = async operation => {
    const result = await transact(operation)
    if (store.snapshot().outbox.some(entry => entry.state === 'sending')) status = { ...status, baseUrl: 'https://changed.example.test' }
    return result
  }
  await assert.rejects(outbox.enqueueAndWait('delivery.command', boundUserRequest()), /creation authority/u)
  assert.equal(sends, 0)
  assert.equal(store.snapshot().outbox[0]?.failureReason, 'authority_lost')
  outbox.stop()
})

test('held stage persists original authority across restart and never reads or uploads for another User', async () => {
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  let store = new CollaborationLocalStore(backend)
  await store.open()
  let status = userStatus()
  let sends = 0
  const transport = { status: () => status, stageObject: async () => { sends++; throw new Error('unexpected upload') } } as unknown as AuthenticatedCloudTransport
  const makeOutbox = () => new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({}), authenticatedCloudTransport: transport })
  let outbox = makeOutbox()
  outbox.stop()
  const request = { protocolVersion: '1.0' as const, type: 'object.stage' as const,
    requestId: 'req_HeldStage0001', idempotencyKey: 'idem_held-stage-command-01',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    sha256: TEST_HASH, byteCount: 12, mediaType: 'text/plain' }
  await assert.rejects(outbox.stageAndWait(request, 'nonexistent-private-file'), /pending reconciliation/u)
  const original = store.snapshot().outbox[0]!
  status = { ...status, userId: TEST_IDS.secondUserId }
  store = new CollaborationLocalStore(backend)
  await store.open()
  outbox = makeOutbox()
  outbox.start()
  await outbox.waitForIdle()
  assert.equal(sends, 0)
  assert.match(store.snapshot().outbox[0]?.error ?? '', /creation authority/u)
  await assert.rejects(outbox.stageAndWait(request, 'nonexistent-private-file', { explicitRetry: true }), /creation authority/u)
  assert.deepEqual(store.snapshot().outbox[0]?.stageFile, original.stageFile)
  assert.deepEqual(store.snapshot().outbox[0]?.userAuthority, original.userAuthority)
  outbox.stop()
})


test('stage response cannot complete for a different identity after upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'outbox-stage-authority-'))
  const path = join(root, 'frozen.txt')
  const bytes = Buffer.from('exact sealed bytes')
  await writeFile(path, bytes)
  const store = await localStore()
  let status = userStatus()
  let uploads = 0
  const outbox = new DurableCloudOutbox({ store, localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: createTestAgentCloudRuntime({}), authenticatedCloudTransport: {
      status: () => status,
      stageObject: async ({ request }: { request: { requestId: string; sha256: string; mediaType: string } }) => {
        uploads++
        status = { ...status, userId: TEST_IDS.secondUserId }
        return { protocolVersion: '1.0', type: 'rest.object.staged', requestId: request.requestId,
          object: { objectId: 'obj_StageAuthority001', objectKey: 'immutable/frozen', revision: 1,
            projectId: TEST_IDS.projectId, sha256: request.sha256, byteCount: bytes.length,
            mediaType: request.mediaType, visibility: 'staged', ownerUserId: TEST_IDS.userId, retentionUntil: null } }
      }
    } as unknown as AuthenticatedCloudTransport })
  const request = { protocolVersion: '1.0' as const, type: 'object.stage' as const,
    requestId: 'req_StageAuthority001', idempotencyKey: 'idem_stage-authority-response-1',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: bytes.length, mediaType: 'text/plain' }
  try {
    await assert.rejects(outbox.stageAndWait(request, path), /creation authority/u)
    assert.equal(uploads, 1)
    assert.equal(store.snapshot().outbox[0]?.state, 'failed')
    assert.equal(store.snapshot().outbox[0]?.userAuthority?.userId, TEST_IDS.userId)
    assert.equal(store.snapshot().outbox[0]?.failureReason, 'authority_lost')
  } finally { outbox.stop(); await rm(root, { recursive: true, force: true }) }
})
