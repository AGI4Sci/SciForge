import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CollaborationService,
  toAgent,
  toInboxMessage,
  toProjection
} from '../packages/collaboration-server/src/index.ts'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from '../packages/collaboration-server/src/test-fixtures/collaboration-identity.ts'
import {
  CollaborationLocalStore,
  ProjectionCoordinator,
  localProjectionFromRemote
} from '../packages/domains/collaboration/src/main.ts'
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
  const registered = await service.registerAgent(participant.userActor, {
    deviceId: participant.deviceId,
    displayName: '全链路 Agent',
    nodeType: 'desktop',
    capabilities: ['agent-runtime'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: 'full-path-register-agent'
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
