import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'

import {
  CollaborationService,
  toAgent,
  toInboxMessage,
  toProjection
} from '../packages/collaboration-server/src/index.ts'
import { createCollaborationHttpServer } from '../packages/collaboration-server/src/api.ts'
import { AuthenticationService } from '../packages/collaboration-server/src/auth.ts'
import { stableDigest } from '../packages/collaboration-server/src/crypto.ts'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from '../packages/collaboration-server/src/test-fixtures/collaboration-identity.ts'
import {
  CollaborationLocalStore,
  ProjectionCoordinator,
  localProjectionFromRemote
} from '../packages/domains/collaboration/src/main.ts'
import { DurableCloudOutbox } from '../packages/domains/collaboration/src/main/outbox.ts'
import { CollaborationTaskAdapter } from '../packages/domains/collaboration/src/main/task-adapter.ts'
import { createProjectCoordinatorCloudWorkspacePort } from '../packages/domains/project-coordinator/src/ports.ts'
import {
  FakeAgentExecutionHost,
  FakeAgentThreadsHost,
  FakeClock,
  FakeCollaborationRepository,
  FakeCollaborationStateBackend,
  FakeHumanEndpointDeliveryWorker,
  FakeHumanProvider,
  fakeAgentActor,
  fakeHumanEndpointActor,
  FakeServiceProjectionOutbox
} from '../test-fixtures/collaboration/fake-adapters.mjs'

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail(`timed out waiting for ${label}`)
}

async function bindParticipant(service, repository, clock) {
  const identity = await seedOidcUserDevice(repository, '全链路用户', clock.now())
  const begun = await service.createEndpointChallenge(identity.user, {
    provider: 'fake-im',
    realmId: 'fake-realm',
    expectedProviderUserId: 'full-path-provider-user',
    idempotencyKey: 'full-path-create-endpoint-challenge'
  })
  const verified = await service.verifyEndpointChallengeFromProvider({
    provider: 'fake-im',
    realmId: 'fake-realm',
    providerUserId: 'full-path-provider-user',
    providerEventId: 'full-path-pairing-event',
    challengeId: begun.challengeId,
    challengeCode: begun.challengeCode,
    assurance: 'strong'
  })
  assert.equal((await service.getEndpointChallenge(identity.user, begun.challengeId)).type,
    'endpoint.challenge.verified')
  const endpoint = await repository.getEndpoint(verified.humanEndpointId)
  return {
    userId: identity.userId,
    deviceId: identity.deviceId,
    humanEndpointId: verified.humanEndpointId,
    endpointActor: fakeHumanEndpointActor(endpoint),
    userActor: identity.user
  }
}

test('10.2 canonical Fake provider → server → fixed desktop Session → server → provider survives retry and offline delivery', async () => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const service = new CollaborationService({ repository, now: clock.now })
  const provider = new FakeHumanProvider()
  const participant = await bindParticipant(service, repository, clock)
  const bootstrap = createAgentCredentialBootstrap()
  const registered = await service.ensureAgent(participant.userActor, {
    deviceId: participant.deviceId,
    capabilities: ['agent-runtime'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: 'idem_full-path-ensure-agent'
  })
  const issuedCredential = bootstrap.open(registered.sealedCredential)
  assert.match(issuedCredential, /^agent\.[A-Za-z0-9_-]+$/u)
  const agentActor = fakeAgentActor(registered.agent)
  const endpointActor = participant.endpointActor
  const locator = {
    type: 'provider_locator',
    provider: 'fake-im',
    realmId: 'fake-realm',
    containerId: 'full-path-container',
    topicId: 'full-path-stable-topic',
    topicDisplayName: '固定个人 Session'
  }
  await repository.insertManagedContainer({
    managedContainerId: 'mco-full-path',
    ownerUserId: participant.userId,
    humanEndpointId: participant.humanEndpointId,
    provider: 'fake-im',
    realmId: 'fake-realm',
    ownerProviderUserId: 'full-path-provider-user',
    stableKey: 'managed-full-path',
    displayName: 'managed-full-path',
    externalContainerId: locator.containerId,
    policy: {
      version: 1,
      visibility: 'private',
      history: 'protected',
      membership: 'owner_and_message_bot',
      memberManagement: 'provisioning_service_only',
      channelManagement: 'provisioning_service_only',
      ownerCanSend: true,
      ownerCanCreateTopics: true,
      messageBotCanSend: true,
      messageBotCreatesProjectTopics: false
    },
    status: 'active',
    revision: 1,
    createdAt: clock.now().toISOString(),
    updatedAt: clock.now().toISOString()
  })
  const projection = await service.createProjection(participant.userActor, {
    agentId: registered.agent.agentId,
    humanEndpointId: participant.humanEndpointId,
    locator,
    displayName: '手机与桌面固定 Session',
    allowedSenderUserIds: [],
    idempotencyKey: 'full-path-create-projection'
  })

  const backend = new FakeCollaborationStateBackend()
  const store = new CollaborationLocalStore(backend)
  await store.open()
  const threadId = `thread-${projection.projectionId}`
  await store.transact((draft) => {
    draft.agents.push(toAgent(registered.agent))
    draft.projections.push(localProjectionFromRemote(toProjection(projection), {
      runtimeId: 'codex',
      threadId,
      bindingMode: 'existing'
    }))
  })
  const agentExecution = new FakeAgentExecutionHost()
  const agentThreads = new FakeAgentThreadsHost()
  const cloudOutbox = new FakeServiceProjectionOutbox({ service, actor: agentActor })
  const coordinator = new ProjectionCoordinator({
    store,
    agentExecution,
    agentThreads,
    cloudOutbox,
    localAgentId: () => registered.agent.agentId,
    now: clock.now
  })
  provider.onEvent((event) => service.acceptPersonalProviderMessage(endpointActor, event))

  const mobileEvent = {
    locator,
    providerMessageId: 'full-path-mobile-message-1',
    text: '手机进入同一个桌面 Session',
    occurredAt: clock.now().toISOString(),
    providerEventId: 'full-path-provider-event-1'
  }
  await provider.emit(mobileEvent)
  await provider.emit(mobileEvent)
  const serverInbox = await service.pullInbox(agentActor, { afterSequence: 0, limit: 20 })
  assert.equal(serverInbox.messages.length, 1)
  const accepted = await coordinator.acceptPersonalInbox(toInboxMessage(serverInbox.messages[0]))
  assert.equal(accepted.duplicate, false)
  await waitUntil(() => agentExecution.requests.length === 1, 'fixed Session Agent execution')
  assert.equal(agentExecution.requests[0].threadId, threadId)
  assert.equal(agentExecution.requests[0].prompt, mobileEvent.text)

  agentThreads.setTurn({
    runtimeId: 'codex',
    threadId,
    turnId: 'fake-turn-1',
    messages: [{
      itemId: 'full-path-assistant-item-1',
      turnId: 'fake-turn-1',
      kind: 'assistant-message',
      text: 'Agent 回复返回手机',
      occurredAt: clock.now().toISOString()
    }]
  })
  provider.setOnline(false)
  agentExecution.completeNext({ text: 'Agent 回复返回手机', runtimeId: 'codex', threadId })
  await coordinator.waitForIdle(projection.projectionId)
  assert.equal(cloudOutbox.deliveries.length, 1)

  const interruptedDelivery = new FakeHumanEndpointDeliveryWorker({
    service,
    actor: endpointActor,
    provider
  })
  await assert.rejects(() => interruptedDelivery.drain(), { code: 'resource_offline' })
  assert.equal(interruptedDelivery.afterSequence, 0)
  assert.equal(provider.outbound.length, 0)

  provider.setOnline(true)
  const recoveredDelivery = new FakeHumanEndpointDeliveryWorker({
    service,
    actor: endpointActor,
    provider
  })
  await recoveredDelivery.drain()
  assert.equal(provider.outbound.length, 1)
  assert.equal(provider.outbound[0].type, 'projection.message.outbound')
  assert.equal(provider.outbound[0].projectionId, projection.projectionId)
  assert.equal(
    provider.outbound[0].text,
    '【SciForge Agent · 最终报告】\nAgent 回复返回手机'
  )

  await coordinator.mirrorDesktopEvent({
    runtimeId: 'codex',
    threadId,
    itemId: 'full-path-desktop-item-1',
    kind: 'user-message',
    text: '桌面消息也同步到手机',
    occurredAt: clock.now().toISOString()
  })
  const desktopDelivery = new FakeHumanEndpointDeliveryWorker({
    service,
    actor: endpointActor,
    provider,
    afterSequence: recoveredDelivery.afterSequence
  })
  await desktopDelivery.drain()
  assert.equal(provider.outbound.length, 2)
  assert.equal(provider.outbound[1].kind, 'user_message')
  assert.equal(provider.outbound[1].text, '【电脑端】\n桌面消息也同步到手机')
  assert.equal(agentExecution.requests.length, 1)
})

test('confirmed Cloud assignment reaches Worker Inbox, durable claim, one Execution, and Project Worker projection', async (t) => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const service = new CollaborationService({ repository, now: clock.now })
  const owner = await seedOidcUserDevice(repository, 'Assignment Owner', clock.now())
  const worker = await seedOidcUserDevice(repository, 'Assignment Worker', clock.now())
  const capabilities = ['research.execute']
  const ownerRegistration = await registerAgent(
    service,
    owner,
    capabilities,
    'assignment-owner'
  )
  const workerRegistration = await registerAgent(
    service,
    worker,
    capabilities,
    'assignment-worker'
  )
  const coordinator = fakeAgentActor(ownerRegistration.registered.agent)
  const workerAgent = fakeAgentActor(workerRegistration.registered.agent)
  const workerHeartbeat = await service.heartbeatAgent(workerAgent, {
    expectedRevision: workerRegistration.registered.agent.revision,
    connectionStatus: 'online',
    capabilities,
    idempotencyKey: 'idem_full_path_worker_heartbeat'
  })
  await service.publishWorkerAvailability(workerAgent, {
    protocolVersion: '1.0',
    type: 'worker.availability.publish',
    requestId: 'req_full_path_worker_availability',
    idempotencyKey: 'idem_full_path_worker_availability',
    agentId: workerAgent.agentId,
    expectedAgentRevision: workerHeartbeat.revision,
    connectionStatus: 'online',
    lastHeartbeatAt: workerHeartbeat.lastSeenAt,
    runtimeReadiness: 'ready',
    runtimeCapabilityTags: capabilities,
    acceptsNewOffers: true,
    activeTaskCount: 0,
    observedAt: clock.now().toISOString()
  })

  const created = await service.createProject(coordinator, {
    protocolVersion: '1.0',
    type: 'project.create',
    requestId: 'req_full_path_assignment_project',
    idempotencyKey: 'idem_full_path_assignment_project',
    createIntentId: 'pct_FullPathAssignment01',
    displayName: 'Cloud assignment Project',
    goal: 'Deliver one User-targeted Task through the production Worker path.',
    budget: { maxTasks: 4, maxTasksPerRound: 4, maxTaskRetries: 1, maxCoordinationRounds: 2 }
  })
  const tasks = [{
    workerUserId: worker.userId,
    planItemId: 'item_full_path_worker',
    title: 'Execute assigned work',
    objective: 'Return one reviewable bounded result.',
    completionCriteria: ['Cloud receives one TaskResult'],
    dependencyPlanItemIds: [],
    requiredCapabilityTags: capabilities,
    fileIntent: null
  }]
  const planFacts = {
    projectId: created.project.projectId,
    expectedProjectRevision: created.project.revision,
    expectedCoordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks,
    rationale: 'One explicit Worker User owns this Plan item.',
    runtimeProvenance: {
      runtimeId: 'codex',
      modelId: null,
      generatedByCoordinatorAgentId: coordinator.agentId,
      generatedAt: clock.now().toISOString()
    }
  }
  const submitted = await service.submitProjectPlan(coordinator, {
    protocolVersion: '1.0',
    type: 'project.plan.submit',
    requestId: 'req_full_path_assignment_plan_submit',
    idempotencyKey: 'idem_full_path_assignment_plan_submit',
    ...planFacts,
    planDigest: stableDigest(planFacts)
  })
  const afterSubmit = await repository.getProject(created.project.projectId)
  assert.ok(afterSubmit)
  const confirmed = await service.confirmProjectPlan(owner.user, {
    protocolVersion: '1.0',
    type: 'project.plan.confirm',
    requestId: 'req_full_path_assignment_plan_confirm',
    idempotencyKey: 'idem_full_path_assignment_plan_confirm',
    projectId: afterSubmit.projectId,
    projectPlanId: submitted.projectPlanId,
    expectedProjectRevision: afterSubmit.revision,
    expectedCoordinatorAuthorityEpoch: afterSubmit.coordinatorAuthorityEpoch,
    expectedPlanRevision: submitted.revision,
    planDigest: submitted.planDigest,
    initialTeam: {
      mode: 'none',
      members: [{ userId: owner.userId }, { userId: worker.userId }]
    }
  })
  const invitation = await repository.getProjectMember(afterSubmit.projectId, worker.userId)
  const beforeAcceptance = await repository.getProject(afterSubmit.projectId)
  assert.ok(invitation)
  assert.ok(beforeAcceptance)
  await service.acceptProjectMembership(worker.user, {
    protocolVersion: '1.0',
    type: 'project.membership.accept',
    requestId: 'req_full_path_assignment_member_accept',
    idempotencyKey: 'idem_full_path_assignment_member_accept',
    projectId: beforeAcceptance.projectId,
    projectMembershipId: invitation.projectMembershipId,
    expectedProjectRevision: beforeAcceptance.revision,
    expectedMembershipRevision: invitation.revision,
    projectPlanId: confirmed.projectPlanId,
    expectedPlanRevision: confirmed.revision,
    planDigest: confirmed.planDigest
  })
  const beforeActivation = await repository.getProject(afterSubmit.projectId)
  assert.ok(beforeActivation)
  const active = await service.transitionProject(owner.user, {
    protocolVersion: '1.0',
    type: 'project.transition',
    requestId: 'req_full_path_assignment_activate',
    idempotencyKey: 'idem_full_path_assignment_activate',
    projectId: beforeActivation.projectId,
    expectedRevision: beforeActivation.revision,
    expectedCoordinatorAuthorityEpoch: beforeActivation.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: beforeActivation.executionAuthorityEpoch,
    status: 'active'
  })
  const offered = await service.createTaskOffer(coordinator, {
    protocolVersion: '1.0',
    type: 'task.offer.create',
    requestId: 'req_full_path_assignment_offer',
    idempotencyKey: 'idem_full_path_assignment_offer',
    projectId: active.projectId,
    expectedProjectRevision: active.revision,
    expectedCoordinatorAuthorityEpoch: active.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: active.executionAuthorityEpoch,
    projectPlanId: confirmed.projectPlanId,
    expectedPlanRevision: confirmed.revision,
    planItemId: tasks[0].planItemId,
    offerExpiresAt: new Date(clock.now().getTime() + 60_000).toISOString()
  })
  assert.equal(offered.offer.workerUserId, worker.userId)
  assert.equal(offered.offer.executionId, null)

  const ownerToken = 'header.assignment-owner.signature'
  const authentication = new AuthenticationService(repository, clock.now, {
    isCandidate: (candidate) => candidate === ownerToken,
    resolve: async () => owner.user
  })
  const server = createCollaborationHttpServer({
    service,
    authentication,
    readiness: async () => true
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const executeWorkerCommand = (request) => postCloudCommand(
    baseUrl,
    workerRegistration.credential,
    request
  )
  const agentCloudRuntime = {
    authorityStatus: async (agentId) => ({
      state: 'ready',
      agentId,
      userId: worker.userId,
      deviceId: worker.deviceId,
      generation: workerRegistration.registered.agent.credentialGeneration,
      runtimeId: 'codex',
      capabilityTags: capabilities
    }),
    execute: async ({ request }) => executeWorkerCommand(request)
  }
  const backend = new FakeCollaborationStateBackend()
  const store = new CollaborationLocalStore(backend)
  await store.open()
  await store.transact((draft) => {
    draft.agents.push(toAgent(workerHeartbeat))
  })
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime,
    localAgentId: () => workerAgent.agentId,
    now: clock.now
  })
  const adapter = new CollaborationTaskAdapter({
    store,
    connection: { executeAsAgent: executeWorkerCommand },
    outbox,
    agentExecution: {
      runtimeReadiness: async () => ({
        state: 'ready',
        runtimeId: 'codex',
        capabilityTags: capabilities
      }),
      prepareSession: async () => ({
        runtimeId: 'codex',
        threadId: 'thread-full-path-worker'
      }),
      run: async () => ({
        runtimeId: 'codex',
        threadId: 'thread-full-path-worker',
        turnId: 'turn-full-path-worker',
        state: 'completed',
        text: JSON.stringify({
          schemaVersion: 1,
          outcome: 'completed',
          summary: 'Worker completed the Cloud-assigned Task.'
        })
      })
    },
    capabilities: {
      invoke: async () => { throw new Error('Text Task must not invoke Content Space.') },
      createApprovedBatch: () => { throw new Error('Text Task must not create an approval batch.') }
    },
    localAgentId: () => workerAgent.agentId,
    workspaceRootForExecution: (executionId) => `/tmp/sciforge-full-path-${executionId}`,
    now: clock.now
  })
  const workerInbox = await service.pullInbox(workerAgent, { afterSequence: 0, limit: 20 })
  const offeredMessage = workerInbox.messages.find((message) => (
    message.payload.type === 'task.offered' &&
    message.payload.taskOfferId === offered.offer.taskOfferId
  ))
  assert.ok(offeredMessage)
  await adapter.handleInbox(toInboxMessage(offeredMessage))
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  await adapter.decideOffer(offered.offer.taskOfferId, { decision: 'accept' })
  await adapter.waitForIdle()
  await outbox.waitForIdle()

  const executions = await repository.listTaskExecutionsByProject(active.projectId, null, 10)
  assert.equal(executions.length, 1)
  assert.equal(executions[0].assigneeUserId, worker.userId)
  assert.equal(executions[0].assigneeAgentId, workerAgent.agentId)
  assert.equal(store.snapshot().taskRuns.length, 1)
  assert.equal(
    store.snapshot().taskRuns[0].state,
    'completed',
    store.snapshot().taskRuns[0].error ?? undefined
  )
  assert.deepEqual(
    store.snapshot().outbox.filter(({ body }) => body.type === 'task.offer.accept').map(({ state }) => state),
    ['delivered']
  )
  await adapter.handleInbox(toInboxMessage(offeredMessage))
  await adapter.waitForIdle()
  assert.equal((await repository.listTaskExecutionsByProject(active.projectId, null, 10)).length, 1)

  const ownerTransport = {
    status: () => ({
      state: 'ready',
      baseUrl,
      userId: owner.userId,
      deviceId: owner.deviceId
    }),
    execute: async ({ payload }) => {
      const response = await postCloudCommand(baseUrl, ownerToken, payload, true)
      return { contractVersion: 1, status: 200, body: response }
    }
  }
  const workspace = await createProjectCoordinatorCloudWorkspacePort({
    transport: ownerTransport
  }).readWorkspace({ projectId: active.projectId })
  assert.equal(workspace.projects[0].plan.plan.tasks[0].workerUserId, worker.userId)
  assert.equal(workspace.projects[0].workerGroups.length, 1)
  assert.equal(workspace.projects[0].workerGroups[0].userId, worker.userId)

  adapter.stop()
  outbox.stop()
})

async function registerAgent(service, identity, capabilities, key) {
  const bootstrap = createAgentCredentialBootstrap()
  const registered = await service.ensureAgent(identity.user, {
    deviceId: identity.deviceId,
    capabilities,
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: `idem_full_path_register_${key}`
  })
  return {
    registered,
    credential: bootstrap.open(registered.sealedCredential)
  }
}

async function postCloudCommand(baseUrl, token, command, oidc = false) {
  const response = await fetch(`${baseUrl}/v1/commands`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...('idempotencyKey' in command
        ? { 'idempotency-key': command.idempotencyKey }
        : {})
    },
    body: JSON.stringify(command)
  })
  const body = await response.json()
  assert.equal(response.status, 200, `${oidc ? 'OIDC' : 'Agent'} command failed: ${JSON.stringify(body)}`)
  return body
}
