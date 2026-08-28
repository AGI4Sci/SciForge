import assert from 'node:assert/strict'
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes
} from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'

import {
  canonicalProjectContentProvisioningAttestationFactualPayloadBytes,
  canonicalProjectContentProvisioningAttestationSignatureBytes,
  canonicalProvisionedMemberSetBytes,
  PROJECT_COORDINATION_COLLECTIONS
} from '../packages/collaboration-contracts/src/index.ts'
import {
  CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT,
  CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT,
  CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT
} from '../packages/domains/content-space/src/contract.ts'

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
import {
  createProjectCoordinatorActionPort,
  createProjectCoordinatorCloudWorkspacePort
} from '../packages/domains/project-coordinator/src/ports.ts'
import {
  createProjectCoordinatorContinuationPort
} from '../packages/domains/project-coordinator/src/continuation.ts'
import {
  ProjectCoordinatorStateStore
} from '../packages/domains/project-coordinator/src/state.ts'
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
    if (await predicate()) return
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

test('Cloud file Plan survives same-profile Coordinator restart and uniquely continues its dependent Task', async (t) => {
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
  const signing = generateKeyPairSync('ed25519')
  const publicJwk = signing.publicKey.export({ format: 'jwk' })
  const ownerDeviceKeyId = 'full-path-owner-device-key'
  await repository.transaction(async (tx) => {
    const device = await tx.getDeviceForUpdate(owner.deviceId)
    assert.ok(device)
    await tx.updateDevice({
      ...device,
      publicKeyJwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        alg: 'EdDSA',
        use: 'sig',
        kid: ownerDeviceKeyId,
        x: publicJwk.x
      },
      revision: device.revision + 1,
      updatedAt: clock.now().toISOString()
    }, device.revision)
  })
  const ownerProviderFact = await service.publishProviderDirectoryPrincipalFact(
    owner.user,
    fullPathProviderFactCommand({
      deviceId: owner.deviceId,
      expectedDeviceRevision: 2,
      principalId: 'full-path-owner-principal',
      requestId: 'req_full_path_owner_provider_fact',
      idempotencyKey: 'idem_full_path_owner_provider_fact',
      observedAt: clock.now().toISOString()
    })
  )
  const workerProviderFact = await service.publishProviderDirectoryPrincipalFact(
    worker.user,
    fullPathProviderFactCommand({
      deviceId: worker.deviceId,
      expectedDeviceRevision: 1,
      principalId: 'full-path-worker-principal',
      requestId: 'req_full_path_worker_provider_fact',
      idempotencyKey: 'idem_full_path_worker_provider_fact',
      observedAt: clock.now().toISOString()
    })
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
    fileIntent: {
      schemaVersion: 1,
      inputs: [{
        kind: 'content-space.input-file',
        locator: {
          contractVersion: 1,
          kind: 'content-space.file-reference',
          authority: 'opencontent.full-path',
          identity: { fileId: 'full-path-agenda' }
        },
        destinationName: 'agenda.md',
        expectedSemanticRevision: null,
        expectedMediaType: 'text/markdown'
      }],
      output: {
        kind: 'content-space.output-new',
        target: 'project-binding-root',
        mode: 'upload-new',
        fileName: 'agenda-summary.md',
        mediaType: 'text/markdown',
        maxBytes: 1_000_000
      }
    }
  }, {
    workerUserId: worker.userId,
    planItemId: 'item_full_path_dependent',
    title: 'Summarize accepted work',
    objective: 'Use the accepted root result to produce the final bounded summary.',
    completionCriteria: ['Cloud receives one dependent TaskResult'],
    dependencyPlanItemIds: ['item_full_path_worker'],
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
      mode: 'required',
      contentOwnerUserId: owner.userId,
      providerInstance: ownerProviderFact.providerPrincipal.providerInstance,
      containerDisplayName: 'Full path Team root',
      members: [{
        userId: owner.userId,
        providerPrincipalFactId: ownerProviderFact.providerPrincipalFactId,
        expectedFactRevision: ownerProviderFact.revision
      }, {
        userId: worker.userId,
        providerPrincipalFactId: workerProviderFact.providerPrincipalFactId,
        expectedFactRevision: workerProviderFact.revision
      }]
    }
  })
  const invitation = await repository.getProjectMember(afterSubmit.projectId, worker.userId)
  const beforeAcceptance = await repository.getProject(afterSubmit.projectId)
  assert.ok(invitation)
  assert.ok(beforeAcceptance)
  const acceptedMembership = await service.acceptProjectMembership(worker.user, {
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
  const attestedContent = await provisionFullPathTeamRoot({
    service,
    repository,
    clock,
    owner,
    ownerProviderFact,
    acceptedProject: acceptedMembership.project,
    signing,
    ownerDeviceKeyId
  })
  const active = await service.transitionProject(owner.user, {
    protocolVersion: '1.0',
    type: 'project.transition',
    requestId: 'req_full_path_assignment_activate',
    idempotencyKey: 'idem_full_path_assignment_activate',
    projectId: attestedContent.project.projectId,
    expectedRevision: attestedContent.project.revision,
    expectedCoordinatorAuthorityEpoch: attestedContent.project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: attestedContent.project.executionAuthorityEpoch,
    status: 'active'
  })

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
  const workspacePort = createProjectCoordinatorCloudWorkspacePort({
    transport: ownerTransport
  })
  const ownerBackend = new FakeCollaborationStateBackend()
  const ownerStore = new CollaborationLocalStore(ownerBackend)
  await ownerStore.open()
  await ownerStore.transact((draft) => {
    draft.agents.push(toAgent(ownerRegistration.registered.agent))
  })
  const createOwnerOutbox = (localStore) => new DurableCloudOutbox({
    store: localStore,
    agentCloudRuntime: {
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: owner.userId,
        deviceId: owner.deviceId,
        generation: ownerRegistration.registered.agent.credentialGeneration,
        runtimeId: 'codex',
        capabilityTags: capabilities
      }),
      execute: async ({ request }) => postCloudCommand(
        baseUrl,
        ownerRegistration.credential,
        request
      )
    },
    localAgentId: () => coordinator.agentId,
    now: clock.now
  })
  const ownerOutbox = createOwnerOutbox(ownerStore)
  const coordinatorCloudCommands = {
    execute: (request) => ownerOutbox.enqueueAndWait('coordinator.command', request),
    subscribe: () => () => undefined
  }
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: workspacePort,
    coordinatorCloudCommands,
    now: clock.now
  })
  for (const [index, collection] of PROJECT_COORDINATION_COLLECTIONS.entries()) {
    await postCloudCommand(baseUrl, ownerToken, {
      protocolVersion: '1.0',
      type: 'project.coordination.read',
      requestId: `req_full_path_collection_${String(index).padStart(2, '0')}`,
      projectId: active.projectId,
      collections: [{ collection, limit: 250 }]
    }, true)
  }
  const backgroundContinuationFailures = []
  let coordinatorProcessAvailable = true
  const ownerPackageSettings = memoryPackageSettings()
  const actions = createProjectCoordinatorActionPort({
    workspace: workspacePort,
    coordinatorCloudCommands,
    transport: ownerTransport,
    state: new ProjectCoordinatorStateStore(ownerPackageSettings),
    continuation: {
      reconcileProject: async (projectId) => {
        if (!coordinatorProcessAvailable) {
          throw new Error('simulated Coordinator process restart after Cloud review commit')
        }
        return continuation.reconcileProject(projectId)
      }
    },
    onBackgroundContinuationFailure: (_projectId, error) => {
      backgroundContinuationFailures.push(error)
    }
  })
  await continuation.reconcileProject(active.projectId)
  const rootOffers = await repository.listTaskOffersByProject(active.projectId, null, 10)
  assert.equal(rootOffers.length, 1)
  const offered = { offer: rootOffers[0] }
  assert.equal(offered.offer.workerUserId, worker.userId)
  assert.equal(offered.offer.executionId, null)
  const offeredTasks = await repository.listTasksByProject(active.projectId, null, 10)
  const offeredRootTask = offeredTasks.find(({ taskId }) => taskId === offered.offer.taskId)
  assert.ok(offeredRootTask?.fileIntent)
  assert.ok(attestedContent.binding.revision > 1)
  assert.equal(
    offeredRootTask.fileIntent.bindingRevision,
    attestedContent.binding.revision,
    'Cloud must bind the logical file declaration to the attested binding at offer time.'
  )

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
  let runtimeSessionOrdinal = 0
  let contentInvocationOrdinal = 0
  const contentOperations = []
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
      prepareSession: async () => {
        runtimeSessionOrdinal += 1
        return {
          runtimeId: 'codex',
          threadId: `thread-full-path-worker-${runtimeSessionOrdinal}`
        }
      },
      run: async ({ runtimeId, threadId, metadata }) => {
        const currentRun = store.snapshot().taskRuns.find(({ offer }) => (
          offer.executionId === metadata.executionId
        ))
        if (currentRun?.execution?.fileIntent) {
          assert.equal(
            currentRun.externalJournal.filter(({ operation, state }) => (
              operation === 'download' && state === 'observed_success'
            )).length,
            1,
            'Runtime may start only after the exact input download is observed.'
          )
        }
        return {
          runtimeId,
          threadId,
          turnId: `turn-${metadata.executionId}`,
          state: 'completed',
          text: JSON.stringify({
            schemaVersion: 1,
            outcome: 'completed',
            summary: `Worker completed ${metadata.taskId}.`
          })
        }
      }
    },
    capabilities: {
      invoke: async (contract, input, options) => {
        contentInvocationOrdinal += 1
        if (contract.actionId === CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.actionId) {
          contentOperations.push(`preflight:${input.operation}`)
          return contract.outputSchema.parse(fullPathContentPreflightResult({
            ordinal: contentInvocationOrdinal,
            worker,
            workspaceId: options?.workspaceId,
            input
          }))
        }
        if (contract.actionId === CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT.actionId) {
          contentOperations.push('download')
          return contract.outputSchema.parse(fullPathContentDownloadResult({
            ordinal: contentInvocationOrdinal,
            worker,
            workspaceId: options?.workspaceId,
            input,
            observedAt: clock.now().toISOString()
          }))
        }
        if (contract.actionId === CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT.actionId) {
          contentOperations.push('upload-new')
          return contract.outputSchema.parse(fullPathContentUploadResult({
            ordinal: contentInvocationOrdinal,
            worker,
            workspaceId: options?.workspaceId,
            input,
            observedAt: clock.now().toISOString()
          }))
        }
        throw new Error(`Unexpected Content Space operation ${contract.actionId}.`)
      },
      createApprovedBatch: () => {
        throw new Error('Worker file transfer must not create a provisioning approval batch.')
      }
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
  assert.equal(executions[0].fileIntent?.bindingRevision, attestedContent.binding.revision)
  assert.equal(executions[0].fence.bindingRevision, attestedContent.binding.revision)
  assert.equal(store.snapshot().taskRuns.length, 1)
  assert.equal(
    store.snapshot().taskRuns[0].state,
    'completed',
    JSON.stringify({
      error: store.snapshot().taskRuns[0].error,
      contentOperations,
      externalJournal: store.snapshot().taskRuns[0].externalJournal
    })
  )
  const [completedRootRun] = store.snapshot().taskRuns
  assert.deepEqual(
    completedRootRun.externalJournal.map(({ operation, state }) => ({ operation, state })),
    [
      { operation: 'download', state: 'observed_success' },
      { operation: 'upload_new', state: 'observed_success' }
    ]
  )
  assert.equal(contentOperations.filter((operation) => operation === 'download').length, 1)
  assert.equal(contentOperations.filter((operation) => operation === 'upload-new').length, 1)
  assert.ok(contentOperations.indexOf('download') < contentOperations.indexOf('upload-new'))
  assert.deepEqual(
    store.snapshot().outbox.filter(({ body }) => body.type === 'task.offer.accept').map(({ state }) => state),
    ['delivered']
  )
  await adapter.handleInbox(toInboxMessage(offeredMessage))
  await adapter.waitForIdle()
  assert.equal((await repository.listTaskExecutionsByProject(active.projectId, null, 10)).length, 1)

  let workspace = await workspacePort.readWorkspace({ projectId: active.projectId })
  assert.equal(workspace.projects[0].plan.plan.tasks[0].workerUserId, worker.userId)
  assert.equal(workspace.projects[0].workerGroups.length, 1)
  assert.equal(workspace.projects[0].workerGroups[0].userId, worker.userId)
  const rootTask = workspace.projects[0].tasks.find(({ task }) => (
    task.taskId === offered.offer.taskId
  ))
  assert.ok(rootTask)
  const rootSubmission = workspace.projects[0].reviews.find(({ submission }) => (
    submission.taskId === rootTask.task.taskId
  ))?.submission
  assert.ok(rootSubmission)
  assert.equal(rootSubmission.outputs.length, 1)
  assert.equal(rootSubmission.outputs[0].bindingRevision, attestedContent.binding.revision)
  assert.equal(rootSubmission.outputs[0].locator.authority, 'opencontent.full-path')
  coordinatorProcessAvailable = false
  await actions.reviewResult(
    acceptedResultReviewInput(workspace.projects[0], rootTask.task.taskId),
    'idem_full_path_root_review'
  )
  await waitUntil(
    () => backgroundContinuationFailures.length === 1,
    'simulated pre-restart continuation failure'
  )
  const coordinatorInbox = await service.pullInbox(coordinator, {
    afterSequence: 0,
    limit: 50
  })
  const observationWake = coordinatorInbox.messages.find((message) => (
    message.payload.type === 'project_record.submitted' &&
    message.payload.projectId === active.projectId
  ))
  assert.ok(observationWake)

  ownerOutbox.stop()
  const restartedOwnerStore = new CollaborationLocalStore(ownerBackend)
  await restartedOwnerStore.open()
  const restartedOwnerOutbox = createOwnerOutbox(restartedOwnerStore)
  const restartedCoordinatorCloudCommands = {
    execute: (request) => restartedOwnerOutbox.enqueueAndWait('coordinator.command', request),
    subscribe: () => () => undefined
  }
  const restartedContinuation = createProjectCoordinatorContinuationPort({
    workspace: workspacePort,
    coordinatorCloudCommands: restartedCoordinatorCloudCommands,
    now: clock.now
  })
  const restartedActions = createProjectCoordinatorActionPort({
    workspace: workspacePort,
    coordinatorCloudCommands: restartedCoordinatorCloudCommands,
    transport: ownerTransport,
    state: new ProjectCoordinatorStateStore(ownerPackageSettings),
    continuation: restartedContinuation,
    onBackgroundContinuationFailure: (_projectId, error) => {
      backgroundContinuationFailures.push(error)
    }
  })
  await Promise.all([
    restartedContinuation.reconcileVisibleProjects(),
    restartedActions.handleInbox(toInboxMessage(observationWake))
  ])

  await waitUntil(async () => (
    (await repository.listTaskOffersByProject(active.projectId, null, 10)).length === 2
  ), 'dependent Task offer after accepted root result')
  assert.deepEqual(
    backgroundContinuationFailures.map((failure) => failure.message),
    ['simulated Coordinator process restart after Cloud review commit']
  )
  const continuedOffers = await repository.listTaskOffersByProject(active.projectId, null, 10)
  const dependentOffer = continuedOffers.find(({ taskOfferId }) => (
    taskOfferId !== offered.offer.taskOfferId
  ))
  assert.ok(dependentOffer)
  const continuedInbox = await service.pullInbox(workerAgent, { afterSequence: 0, limit: 50 })
  const dependentMessage = continuedInbox.messages.find((message) => (
    message.payload.type === 'task.offered' &&
    message.payload.taskOfferId === dependentOffer.taskOfferId
  ))
  assert.ok(dependentMessage)
  await adapter.handleInbox(toInboxMessage(dependentMessage))
  await adapter.waitForIdle()
  assert.equal(
    store.snapshot().pendingTaskOffers.find(({ taskOfferId }) => (
      taskOfferId === dependentOffer.taskOfferId
    ))?.state,
    'awaiting-manual'
  )
  await adapter.decideOffer(dependentOffer.taskOfferId, { decision: 'accept' })
  await adapter.waitForIdle()
  await outbox.waitForIdle()

  const completedExecutions = await repository.listTaskExecutionsByProject(
    active.projectId,
    null,
    10
  )
  assert.equal(completedExecutions.length, 2)
  assert.equal(new Set(completedExecutions.map(({ executionId }) => executionId)).size, 2)
  assert.equal(store.snapshot().taskRuns.length, 2)
  assert.ok(store.snapshot().taskRuns.every(({ state }) => state === 'completed'))

  workspace = await workspacePort.readWorkspace({ projectId: active.projectId })
  const dependentTask = workspace.projects[0].tasks.find(({ task }) => (
    task.taskId === dependentOffer.taskId
  ))
  assert.ok(dependentTask)
  await restartedActions.reviewResult(
    acceptedResultReviewInput(workspace.projects[0], dependentTask.task.taskId),
    'idem_full_path_dependent_review'
  )
  await restartedContinuation.reconcileProject(active.projectId)

  workspace = await workspacePort.readWorkspace({ projectId: active.projectId })
  const project = workspace.projects[0]
  assert.equal(project.tasks.length, 2)
  assert.ok(project.tasks.every(({ task }) => task.status === 'completed'))
  assert.equal((await repository.listTaskOffersByProject(active.projectId, null, 10)).length, 2)
  const acceptedResultSubmissionIds = project.reviews
    .filter(({ decision }) => decision?.decision === 'accept')
    .map(({ submission }) => submission.resultSubmissionId)
  assert.equal(acceptedResultSubmissionIds.length, 2)
  const completionInput = {
    projectId: project.project.projectId,
    expectedProjectRevision: project.project.revision,
    expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
    projectPlanId: project.plan.plan.projectPlanId,
    confirmedPlanRevision: project.plan.plan.planRevision,
    acceptedResultSubmissionIds,
    summary: 'Owner accepted both results and completed the bounded Project.'
  }
  const completed = await restartedActions.completeProject(
    completionInput,
    'idem_full_path_project_complete'
  )
  const completedProject = completed.projects[0]
  assert.equal(completedProject.project.status, 'completed')
  assert.ok(completedProject.finalSummary)
  assert.deepEqual(
    completedProject.records.map(({ kind }) => kind).sort(),
    ['observation', 'observation', 'summary']
  )
  assert.equal(runtimeSessionOrdinal, 2)
  const coordinatorCommands = restartedOwnerStore.snapshot().outbox
    .filter(({ kind }) => kind === 'coordinator.command')
  assert.ok(coordinatorCommands.every(({ state }) => state === 'delivered'))
  assert.deepEqual(
    coordinatorCommands.map(({ body }) => body.type),
    [
      'task.offer.create',
      'task.result.review',
      'task.offer.create',
      'task.result.review',
      'project.final_summary.submit'
    ]
  )

  adapter.stop()
  outbox.stop()
  restartedOwnerOutbox.stop()
})

function fullPathProviderFactCommand({
  deviceId,
  expectedDeviceRevision,
  principalId,
  requestId,
  idempotencyKey,
  observedAt
}) {
  return {
    protocolVersion: '1.0',
    type: 'provider_directory_principal.publish',
    requestId,
    idempotencyKey,
    providerPrincipalFactId: null,
    expectedFactRevision: null,
    deviceId,
    expectedDeviceRevision,
    providerPrincipal: {
      schemaVersion: 1,
      type: 'provider_directory_principal_reference',
      providerInstance: {
        schemaVersion: 1,
        type: 'provider_instance_reference',
        providerInstanceRef: 'opencontent.full-path'
      },
      principalKind: 'user',
      principalId
    },
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: stableDigest({ principalId, deviceId }),
    readiness: 'ready',
    readinessReason: null,
    observedAt
  }
}

async function provisionFullPathTeamRoot({
  service,
  repository,
  clock,
  owner,
  ownerProviderFact,
  acceptedProject,
  signing,
  ownerDeviceKeyId
}) {
  const [intent] = await repository.listProjectContentProvisioningIntents(
    acceptedProject.projectId
  )
  assert.ok(intent)
  const requestDigest = stableDigest({
    projectId: acceptedProject.projectId,
    operation: 'create_shared_container'
  })
  const prepared = await service.prepareExternalOperation(owner.user, {
    protocolVersion: '1.0',
    type: 'external_operation.prepare',
    requestId: 'req_full_path_content_prepare',
    idempotencyKey: 'idem_full_path_content_prepare',
    scope: 'project_provisioning',
    projectId: acceptedProject.projectId,
    taskId: null,
    executionId: null,
    preparedTaskRevision: null,
    preparedExecutionRevision: null,
    provisioningIntentId: intent.provisioningIntentId,
    provisioningRevision: intent.provisioningRevision,
    logicalInvocationId: 'full-path-create-team-root',
    operation: 'create_shared_container',
    requestDigest
  })
  const dispatched = await service.dispatchExternalOperation(owner.user, {
    protocolVersion: '1.0',
    type: 'external_operation.dispatch',
    requestId: 'req_full_path_content_dispatch',
    idempotencyKey: 'idem_full_path_content_dispatch',
    journalEntryId: prepared.contentRecoveryJournalEntryId,
    expectedJournalRevision: prepared.revision
  })
  const receiptDigest = stableDigest({
    projectId: acceptedProject.projectId,
    receipt: 'team-root-created'
  })
  const observed = await service.observeExternalOperation(owner.user, {
    protocolVersion: '1.0',
    type: 'external_operation.observe',
    requestId: 'req_full_path_content_observe',
    idempotencyKey: 'idem_full_path_content_observe',
    journalEntryId: dispatched.contentRecoveryJournalEntryId,
    expectedJournalRevision: dispatched.revision,
    outcome: 'observed_success',
    receiptDigest,
    observationDigest: stableDigest({
      projectId: acceptedProject.projectId,
      observation: 'team-root-created'
    }),
    safeFailureCode: null
  })
  const rootLocator = {
    contractVersion: 1,
    kind: 'content-space.container-reference',
    authority: 'opencontent.full-path',
    identity: { containerId: 'full-path-team-root' }
  }
  const observedAt = clock.now().toISOString()
  const memberObservations = intent.desiredMembers.map((member) => ({
    userId: member.userId,
    providerPrincipalFactId: member.providerPrincipalFactId,
    snapshottedFactRevision: member.snapshottedFactRevision,
    principal: member.principal,
    presence: 'present',
    observationDigest: stableDigest({
      projectId: acceptedProject.projectId,
      userId: member.userId,
      presence: 'present'
    }),
    observedAt
  }))
  const attestation = signFullPathProvisioningAttestation({
    format: 'sciforge.project-content-provisioning-attestation.v1',
    provisioningAttestationId: 'pca_FullPathTeamRoot01',
    projectId: acceptedProject.projectId,
    provisioningIntentId: intent.provisioningIntentId,
    provisioningRevision: intent.provisioningRevision,
    ownerUserId: owner.userId,
    principalIdentityRevision: ownerProviderFact.principalIdentityRevision,
    providerBindingAttestationDigest:
      ownerProviderFact.providerBindingAttestationDigest,
    providerInstance: ownerProviderFact.providerPrincipal.providerInstance,
    rootLocator,
    rootLocatorDigest: stableDigest(rootLocator),
    observedOperations: [{
      operationId: prepared.logicalInvocationId,
      operationRevision: observed.journal.revision,
      kind: 'create_shared_container',
      subjectPrincipal: null,
      requestDigest,
      receiptDigest,
      outcome: 'observed_success',
      safeFailureCode: null,
      observedAt
    }],
    memberObservations,
    memberSetDigest: createHash('sha256')
      .update(canonicalProvisionedMemberSetBytes(memberObservations))
      .digest('hex'),
    observationStartedAt: observedAt,
    observationCompletedAt: observedAt
  }, signing, owner.deviceId, ownerDeviceKeyId, 2)
  const result = await service.attestProjectContent(owner.user, {
    protocolVersion: '1.0',
    type: 'project.content.attest',
    requestId: 'req_full_path_content_attest',
    idempotencyKey: 'idem_full_path_content_attest',
    projectId: acceptedProject.projectId,
    expectedProjectRevision: acceptedProject.revision,
    expectedProvisioningRevision: intent.provisioningRevision,
    attestation
  })
  assert.equal(result.binding.status, 'active')
  assert.ok(result.readiness.every(({ state }) => state === 'ready'))
  return result
}

function signFullPathProvisioningAttestation(
  factual,
  signing,
  deviceId,
  deviceKeyId,
  deviceKeyRevision
) {
  const placeholder = {
    schemaVersion: 1,
    type: 'project_content_provisioning_attestation',
    ...factual,
    deviceSignature: {
      purpose: 'project-content-provisioning-attestation',
      userId: factual.ownerUserId,
      deviceId,
      deviceKeyId,
      deviceKeyRevision,
      signatureAlgorithm: 'Ed25519',
      canonicalPayloadDigest: '0'.repeat(64),
      factRevision: factual.provisioningRevision,
      observedAt: factual.observationCompletedAt,
      issuedAt: factual.observationCompletedAt,
      signature: 'A'.repeat(86)
    },
    revision: 1,
    createdAt: factual.observationCompletedAt,
    updatedAt: factual.observationCompletedAt
  }
  const canonicalPayloadDigest = createHash('sha256')
    .update(canonicalProjectContentProvisioningAttestationFactualPayloadBytes(placeholder))
    .digest('hex')
  const withDigest = {
    ...placeholder,
    deviceSignature: {
      ...placeholder.deviceSignature,
      canonicalPayloadDigest
    }
  }
  return {
    ...withDigest,
    deviceSignature: {
      ...withDigest.deviceSignature,
      signature: signBytes(
        null,
        canonicalProjectContentProvisioningAttestationSignatureBytes(withDigest),
        signing.privateKey
      ).toString('base64url')
    }
  }
}

function fullPathContentExecutionBinding({ ordinal, worker, workspaceId }) {
  assert.equal(typeof workspaceId, 'string')
  return {
    callerId: 'sciforge.collaboration',
    principal: {
      authority: 'sciforge.oidc',
      subject: worker.userId,
      assurance: 'cloud-authenticated',
      deviceId: worker.deviceId,
      identityVersion: 1
    },
    principalSnapshotDigest: stableDigest({ workerUserId: worker.userId }),
    workspaceId,
    executionContextDigest: stableDigest({ workspaceId }),
    invocationId: `contentInvocation${String(ordinal).padStart(4, '0')}`
  }
}

function fullPathContentPreflightResult({ ordinal, worker, workspaceId, input }) {
  return {
    ok: true,
    value: {
      execution: fullPathContentExecutionBinding({ ordinal, worker, workspaceId }),
      status: 'ready',
      intentDigest: stableDigest(input),
      observationRevision: stableDigest({ ordinal, phase: 'preflight' }),
      authorization: 'not_granted',
      cacheable: false
    }
  }
}

function fullPathContentDownloadResult({
  ordinal,
  worker,
  workspaceId,
  input,
  observedAt
}) {
  const invocationId = `contentInvocation${String(ordinal).padStart(4, '0')}`
  const sha256 = stableDigest({ ordinal, operation: 'download' })
  return {
    ok: true,
    value: {
      operation: 'download',
      execution: fullPathContentExecutionBinding({ ordinal, worker, workspaceId }),
      root: input.root,
      receipt: {
        invocationId,
        reference: {
          providerInstanceRef: input.candidate.authority,
          fileId: input.candidate.identity.fileId
        },
        bytesWritten: 128,
        digest: { algorithm: 'sha256', value: sha256 }
      },
      readAfterObservation: {
        reference: input.candidate,
        bytes: 128,
        sha256
      },
      workspaceRelativePath: input.workspaceRelativePath,
      observedAt,
      bytes: 128,
      sha256,
      transferReceiptDigest: stableDigest({ invocationId, receipt: 'download' }),
      observationDigest: stableDigest({ invocationId, observation: 'download' }),
      providerDigest: {
        status: 'deferred',
        reason: 'provider_digest_not_in_run0_contract'
      }
    }
  }
}

function fullPathContentUploadResult({
  ordinal,
  worker,
  workspaceId,
  input,
  observedAt
}) {
  const invocationId = `contentInvocation${String(ordinal).padStart(4, '0')}`
  const portableReference = {
    contractVersion: 1,
    kind: 'content-space.file-reference',
    authority: input.root.authority,
    identity: { fileId: `full-path-output-${ordinal}` }
  }
  return {
    ok: true,
    value: {
      operation: 'upload-new',
      execution: fullPathContentExecutionBinding({ ordinal, worker, workspaceId }),
      root: input.root,
      receipt: {
        invocationId,
        parent: {
          providerInstanceRef: input.root.authority,
          containerId: input.root.identity.containerId
        },
        name: input.name,
        sourceSize: 256,
        reference: {
          providerInstanceRef: portableReference.authority,
          fileId: portableReference.identity.fileId
        }
      },
      portableReference,
      writeAfterObservation: {
        parent: input.root,
        reference: portableReference,
        name: input.name,
        size: 256
      },
      workspaceRelativePath: input.workspaceRelativePath,
      observedAt,
      bytes: 256,
      sha256: stableDigest({ invocationId, output: input.name }),
      transferReceiptDigest: stableDigest({ invocationId, receipt: 'upload-new' }),
      observationDigest: stableDigest({ invocationId, observation: 'upload-new' }),
      providerDigest: {
        status: 'deferred',
        reason: 'provider_digest_not_in_run0_contract'
      }
    }
  }
}

function acceptedResultReviewInput(project, taskId) {
  const task = project.tasks.find((candidate) => candidate.task.taskId === taskId)
  assert.ok(task)
  const execution = task.executions.find(({ executionId }) => (
    executionId === task.task.currentExecutionId
  ))
  assert.ok(execution)
  const review = project.reviews.find(({ submission, decision }) => (
    submission.taskId === taskId &&
    submission.executionId === execution.executionId &&
    decision === null
  ))
  assert.ok(review)
  return {
    projectId: project.project.projectId,
    taskId,
    executionId: execution.executionId,
    resultSubmissionId: review.submission.resultSubmissionId,
    expectedProjectRevision: project.project.revision,
    expectedTaskRevision: task.task.revision,
    expectedExecutionRevision: execution.revision,
    expectedResultRevision: review.submission.revision,
    expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
    decision: 'accept',
    instruction: null,
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  }
}

function memoryPackageSettings() {
  let revision = 0
  let value = null
  return {
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      value = next
      revision += 1
      return { revision, value }
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, revision)
      value = null
      revision += 1
      return { revision, value }
    }
  }
}

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
  assert.equal(
    response.status,
    200,
    `${oidc ? 'OIDC' : 'Agent'} command failed for ${JSON.stringify(command)}: ${JSON.stringify(body)}`
  )
  return body
}
