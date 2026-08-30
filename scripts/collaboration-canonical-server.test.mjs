import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'

import { projectCreateCommandSchema } from '@sciforge/collaboration-contracts'

import { CollaborationServiceError } from '../packages/collaboration-server/src/errors.ts'
import { stableDigest } from '../packages/collaboration-server/src/crypto.ts'
import { CollaborationService } from '../packages/collaboration-server/src/service.ts'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from '../packages/collaboration-server/src/test-fixtures/collaboration-identity.ts'
import {
  FakeCollaborationRepository,
  FakeCollaborationRequestActorResolver,
  FakeClock,
  FakeInboxNotifier,
  fakeHumanEndpointActor
} from '../test-fixtures/collaboration/fake-adapters.mjs'

function expectCode(code, operation) {
  return assert.rejects(operation, (error) => {
    assert.ok(error instanceof CollaborationServiceError)
    assert.equal(error.code, code)
    return true
  })
}

function createServiceRig() {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const notifier = new FakeInboxNotifier()
  const service = new CollaborationService({ repository, notifier, now: clock.now })
  const actorResolver = new FakeCollaborationRequestActorResolver({ repository, now: clock.now })
  return { clock, repository, notifier, service, actorResolver }
}

function resolveFixtureToken(rig, token) {
  return rig.actorResolver.resolveRequestActor({ headers: { authorization: `Bearer ${token}` } })
}

async function endpointActor(rig, participant) {
  return fakeHumanEndpointActor(await rig.repository.getEndpoint(participant.endpointId))
}

async function bindUser(rig, slot, providerUserId = `provider-user-${slot.toLowerCase()}`) {
  const identity = await seedOidcUserDevice(rig.repository, `用户 ${slot}`, rig.clock.now())
  const begun = await rig.service.createEndpointChallenge(identity.user, {
    provider: 'fake-im',
    realmId: 'fake-realm',
    expectedProviderUserId: providerUserId,
    idempotencyKey: `create-endpoint-challenge-${slot}`
  })
  const verified = await rig.service.verifyEndpointChallengeFromProvider({
    provider: 'fake-im',
    realmId: 'fake-realm',
    providerUserId,
    providerEventId: `provider-event-${slot}`,
    challengeId: begun.challengeId,
    challengeCode: begun.challengeCode,
    assurance: 'strong'
  })
  const status = await rig.service.getEndpointChallenge(identity.user, begun.challengeId)
  assert.equal(status.type, 'endpoint.challenge.verified')
  return {
    userId: identity.userId,
    deviceId: identity.deviceId,
    endpointId: verified.humanEndpointId,
    providerUserId,
    actor: identity.user,
    challengeCode: begun.challengeCode
  }
}

async function addActiveDevice(rig, participant, slot) {
  const suffix = stableDigest(`${participant.userId}\u0000${slot}`).slice(0, 24)
  const timestamp = rig.clock.now().toISOString()
  const signing = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })
  const deviceId = `dev_${suffix}`
  await rig.repository.transaction(async (tx) => {
    await tx.insertDevice({
      deviceId,
      userId: participant.userId,
      installationId: `ins_${suffix}`,
      displayName: `${slot} Device`,
      platform: { os: 'macos', arch: 'arm64', appVersion: '0.1.0-test' },
      publicKeyJwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        alg: 'EdDSA',
        use: 'sig',
        kid: `device-${suffix}`,
        x: signing.x
      },
      capabilitySummary: ['research.execute'],
      status: 'active',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    })
  })
  return { ...participant, deviceId }
}

async function activatePersonalContainer(rig, owner, containerId) {
  const device = await rig.repository.getDevice(owner.deviceId)
  assert.ok(device)
  await rig.repository.insertManagedContainer({
    managedContainerId: `mco-test-${owner.userId}`,
    ownerUserId: owner.userId,
    humanEndpointId: owner.endpointId,
    installationId: device.installationId,
    provider: 'fake-im',
    realmId: 'fake-realm',
    ownerProviderUserId: owner.providerUserId,
    stableKey: `managed-${owner.userId}`,
    displayName: `managed-${owner.userId}`,
    externalContainerId: containerId,
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
    createdAt: rig.clock.now().toISOString(),
    updatedAt: rig.clock.now().toISOString()
  })
}

async function ensureAgent(rig, participant, slot) {
  const bootstrap = createAgentCredentialBootstrap()
  const registered = await rig.service.ensureAgent(participant.actor, {
    deviceId: participant.deviceId,
    capabilities: ['agent-runtime', 'research.execute'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: `idem_ensure-agent-${slot}`
  })
  const credential = bootstrap.open(registered.sealedCredential)
  return {
    agent: registered.agent,
    bootstrapPublicKey: bootstrap.publicKey,
    credential,
    actor: await resolveFixtureToken(rig, credential)
  }
}

async function publishAvailability(rig, registered, key) {
  const heartbeat = await rig.service.heartbeatAgent(registered.actor, {
    expectedRevision: registered.agent.revision,
    connectionStatus: 'online',
    capabilities: registered.agent.capabilities,
    idempotencyKey: `idem_heartbeat_${key}`
  })
  assert.ok(heartbeat.lastSeenAt)
  registered.agent = heartbeat
  return rig.service.publishWorkerAvailability(registered.actor, {
    protocolVersion: '1.0',
    type: 'worker.availability.publish',
    requestId: `req_availability_${key}`,
    idempotencyKey: `idem_availability_${key}`,
    agentId: registered.agent.agentId,
    expectedAgentRevision: registered.agent.revision,
    connectionStatus: 'online',
    lastHeartbeatAt: heartbeat.lastSeenAt,
    runtimeReadiness: 'ready',
    runtimeCapabilityTags: heartbeat.capabilities,
    acceptsNewOffers: true,
    activeTaskCount: 0,
    observedAt: rig.clock.now().toISOString()
  })
}

async function createActiveTextProject(rig, { owner, members, coordinator, tasks, key }) {
  const created = await rig.service.createProject(coordinator.actor, {
    protocolVersion: '1.0',
    type: 'project.create',
    requestId: `req_project_${key}`,
    idempotencyKey: `idem_project_${key}`,
    createIntentId: `pct_${stableDigest(`project-create\u0000${key}`).slice(0, 24)}`,
    displayName: `Project ${key}`,
    goal: `Canonical collaboration goal ${key}`,
    budget: { maxTasks: 20, maxTasksPerRound: 20, maxTaskRetries: 1, maxCoordinationRounds: 5 }
  })
  const project = created.project
  const planFacts = {
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks,
    rationale: 'Exercise the final confirmed-plan task distribution path.',
    runtimeProvenance: {
      runtimeId: `runtime_${key}`,
      modelId: null,
      generatedByCoordinatorAgentId: coordinator.agent.agentId,
      generatedAt: rig.clock.now().toISOString()
    }
  }
  const submitted = await rig.service.submitProjectPlan(coordinator.actor, {
    protocolVersion: '1.0',
    type: 'project.plan.submit',
    requestId: `req_plan_submit_${key}`,
    idempotencyKey: `idem_plan_submit_${key}`,
    ...planFacts,
    planDigest: stableDigest(planFacts)
  })
  const confirmed = await rig.service.confirmProjectPlan(owner.actor, {
    protocolVersion: '1.0',
    type: 'project.plan.confirm',
    requestId: `req_plan_confirm_${key}`,
    idempotencyKey: `idem_plan_confirm_${key}`,
    projectId: project.projectId,
    projectPlanId: submitted.projectPlanId,
    expectedProjectRevision: project.revision + 1,
    expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    expectedPlanRevision: submitted.revision,
    planDigest: submitted.planDigest,
    initialTeam: {
      mode: 'none',
      members: [owner, ...members].map(({ userId }) => ({ userId }))
    }
  })
  for (const member of members) {
    const membership = await rig.repository.getProjectMember(project.projectId, member.userId)
    assert.ok(membership)
    const currentProject = await rig.repository.getProject(project.projectId)
    assert.ok(currentProject)
    await rig.service.acceptProjectMembership(member.actor, {
      protocolVersion: '1.0',
      type: 'project.membership.accept',
      requestId: `req_membership_accept_${key}_${member.userId}`,
      idempotencyKey: `idem_membership_accept_${key}_${member.userId}`,
      projectId: project.projectId,
      projectMembershipId: membership.projectMembershipId,
      expectedProjectRevision: currentProject.revision,
      expectedMembershipRevision: membership.revision,
      projectPlanId: confirmed.projectPlanId,
      expectedPlanRevision: confirmed.revision,
      planDigest: confirmed.planDigest
    })
  }
  const readyProject = await rig.repository.getProject(project.projectId)
  assert.ok(readyProject)
  const active = await rig.service.transitionProject(owner.actor, {
    protocolVersion: '1.0',
    type: 'project.transition',
    requestId: `req_project_activate_${key}`,
    idempotencyKey: `idem_project_activate_${key}`,
    projectId: project.projectId,
    expectedRevision: readyProject.revision,
    expectedCoordinatorAuthorityEpoch: readyProject.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: readyProject.executionAuthorityEpoch,
    status: 'active'
  })
  return { created, project: active, plan: confirmed }
}

async function createOffer(rig, { coordinator, project, plan, planItemId, key }) {
  return rig.service.createTaskOffer(coordinator.actor, {
    protocolVersion: '1.0',
    type: 'task.offer.create',
    requestId: `req_offer_${key}`,
    idempotencyKey: `idem_offer_${key}`,
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: project.executionAuthorityEpoch,
    projectPlanId: plan.projectPlanId,
    expectedPlanRevision: plan.revision,
    planItemId,
    offerExpiresAt: new Date(rig.clock.now().getTime() + 60_000).toISOString()
  })
}

async function acceptAndStart(rig, worker, offered, key) {
  const accepted = await rig.service.acceptTaskOffer(worker.actor, {
    protocolVersion: '1.0',
    type: 'task.offer.accept',
    requestId: `req_offer_accept_${key}`,
    idempotencyKey: `idem_offer_accept_${key}`,
    taskOfferId: offered.offer.taskOfferId,
    taskId: offered.task.taskId,
    expectedTaskRevision: offered.task.revision,
    expectedOfferRevision: offered.offer.revision
  })
  return rig.service.startTaskExecution(worker.actor, {
    protocolVersion: '1.0',
    type: 'task.execution.start',
    requestId: `req_execution_start_${key}`,
    idempotencyKey: `idem_execution_start_${key}`,
    taskId: accepted.task.taskId,
    executionId: accepted.execution.executionId,
    expectedTaskRevision: accepted.task.revision,
    expectedExecutionRevision: accepted.execution.revision,
    startedAt: rig.clock.now().toISOString()
  })
}

test('2.5 canonical service rejects identity theft/replay, keeps stable identity, rotates credentials and enforces revocation', async () => {
  const rig = createServiceRig()
  const a = await bindUser(rig, 'A')
  const b = await bindUser(rig, 'B')

  const userA = await rig.service.getUser(a.actor, a.userId)
  const renamedA = await rig.service.updateUser(a.actor, {
    userId: a.userId,
    displayName: '用户 A（新显示名）',
    expectedRevision: userA.revision,
    idempotencyKey: 'rename-user-A'
  })
  assert.equal(renamedA.userId, a.userId)
  assert.equal(renamedA.displayName, '用户 A（新显示名）')
  await expectCode('permission_denied', () => rig.service.updateUser(b.actor, {
    userId: a.userId,
    displayName: 'B 不得修改 A',
    expectedRevision: renamedA.revision,
    idempotencyKey: 'cross-user-rename'
  }))

  const replay = await rig.service.createEndpointChallenge(a.actor, {
    provider: 'fake-im',
    realmId: 'fake-realm',
    expectedProviderUserId: a.providerUserId,
    idempotencyKey: 'create-endpoint-challenge-A'
  })
  assert.equal(replay.replayed, true)
  assert.equal(replay.challengeCode, undefined)

  const conflict = await rig.service.createEndpointChallenge(b.actor, {
    provider: 'fake-im',
    realmId: 'fake-realm',
    expectedProviderUserId: a.providerUserId,
    idempotencyKey: 'begin-endpoint-theft'
  })
  await expectCode('identity_conflict', () => rig.service.verifyEndpointChallengeFromProvider({
    provider: 'fake-im',
    realmId: 'fake-realm',
    providerUserId: a.providerUserId,
    providerEventId: 'provider-event-endpoint-theft',
    challengeId: conflict.challengeId,
    challengeCode: conflict.challengeCode,
    assurance: 'strong'
  }))

  const agentA = await ensureAgent(rig, a, 'A')
  await expectCode('permission_denied', () => rig.service.ensureAgent(b.actor, {
    deviceId: a.deviceId,
    capabilities: ['agent-runtime', 'research.execute'],
    credentialBootstrapPublicKey: createAgentCredentialBootstrap().publicKey,
    idempotencyKey: 'agent-theft-attempt'
  }))

  const registrationReplay = await rig.service.ensureAgent(a.actor, {
    deviceId: a.deviceId,
    capabilities: ['agent-runtime', 'research.execute'],
    credentialBootstrapPublicKey: agentA.bootstrapPublicKey,
    idempotencyKey: 'idem_ensure-agent-A'
  })
  assert.equal(registrationReplay.agent.agentId, agentA.agent.agentId)
  assert.equal(registrationReplay.sealedCredential, undefined)
  assert.equal(registrationReplay.replayed, true)

  const rotationBootstrap = createAgentCredentialBootstrap()
  const rotated = await rig.service.rotateAgentCredential(a.actor, {
    agentId: agentA.agent.agentId,
    expectedRevision: agentA.agent.revision,
    credentialBootstrapPublicKey: rotationBootstrap.publicKey,
    idempotencyKey: 'rotate-agent-A'
  })
  await expectCode('credential_revoked', () => resolveFixtureToken(rig, agentA.credential))
  const rotatedCredential = rotationBootstrap.open(rotated.sealedCredential)
  const rotatedActor = await resolveFixtureToken(rig, rotatedCredential)
  assert.equal(rotatedActor.agentId, agentA.agent.agentId)
  assert.equal(rotatedActor.userId, a.userId)
  assert.equal(rotatedActor.deviceId, a.deviceId)

  await expectCode('permission_denied', () => rig.service.rotateAgentCredential(b.actor, {
    agentId: agentA.agent.agentId,
    expectedRevision: rotated.agent.revision,
    credentialBootstrapPublicKey: createAgentCredentialBootstrap().publicKey,
    idempotencyKey: 'other-user-rotate-device-agent'
  }))
  const rejectedAudit = rig.repository.state.auditEvents.find((event) => (
    event.action === 'agent.credential.rotate' && event.outcome === 'rejected'
  ))
  assert.equal(rejectedAudit?.actorUserId, b.userId)
  assert.equal(rejectedAudit?.metadata.errorCode, 'permission_denied')

  const revoked = await rig.service.revokeAgent(a.actor, {
    agentId: agentA.agent.agentId,
    expectedRevision: rotated.agent.revision,
    idempotencyKey: 'device-owner-revoke-agent'
  })
  assert.equal(revoked.status, 'revoked')
  await expectCode('credential_revoked', () => resolveFixtureToken(rig, rotatedCredential))

  await expectCode('permission_denied', () => rig.service.setEndpointStatus(b.actor, {
    humanEndpointId: a.endpointId,
    status: 'revoked',
    expectedRevision: 1,
    idempotencyKey: 'other-user-revoke-endpoint'
  }))
  const revokedEndpoint = await rig.service.setEndpointStatus(a.actor, {
    humanEndpointId: a.endpointId,
    status: 'revoked',
    expectedRevision: 1,
    idempotencyKey: 'owner-revoke-endpoint'
  })
  assert.equal(revokedEndpoint.status, 'revoked')
  await expectCode('authentication_required', () => endpointActor(rig, a))
})

test('2.6 canonical receipts, repository rows, audit and replay responses never persist or re-emit issued material', async () => {
  const rig = createServiceRig()
  const a = await bindUser(rig, 'A')
  const b = await bindUser(rig, 'B')
  const agentA = await ensureAgent(rig, a, 'A')
  const agentB = await ensureAgent(rig, b, 'B')
  const rotationBootstrap = createAgentCredentialBootstrap()
  const rotated = await rig.service.rotateAgentCredential(a.actor, {
    agentId: agentA.agent.agentId,
    expectedRevision: agentA.agent.revision,
    credentialBootstrapPublicKey: rotationBootstrap.publicKey,
    idempotencyKey: 'rotate-agent-A'
  })
  const rotatedCredential = rotationBootstrap.open(rotated.sealedCredential)

  const inMemoryOnly = [a.challengeCode, b.challengeCode, agentA.credential, agentB.credential, rotatedCredential]
  const persisted = JSON.stringify({
    challenges: [...rig.repository.state.challenges.values()],
    credentials: [...rig.repository.state.credentials.values()],
    receipts: [...rig.repository.state.receipts.values()],
    auditEvents: rig.repository.state.auditEvents
  })
  for (const material of inMemoryOnly) {
    assert.equal(typeof material, 'string')
    assert.ok(material.length >= 8)
    assert.doesNotMatch(persisted, new RegExp(material.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.ok(rig.repository.state.auditEvents.length > 0)
  assert.ok(rig.repository.state.auditEvents.every((event) => (
    !Object.keys(event.metadata).some((key) => /credential|secret|challenge|password|authorization/i.test(key))
  )))
})

test('8.3 and 10.2 canonical Project ledger enforces assignee/coordinator, idempotency, inbox recovery and Owner-owned handoff', async () => {
  const rig = createServiceRig()
  const a = await bindUser(rig, 'A')
  const b = await bindUser(rig, 'B')
  const c = await bindUser(rig, 'C')
  const agentA = await ensureAgent(rig, a, 'A')
  const agentA2 = await ensureAgent(rig, await addActiveDevice(rig, a, 'A2'), 'A2')
  const agentB = await ensureAgent(rig, b, 'B')
  const agentC = await ensureAgent(rig, c, 'C')
  const availabilityA2 = await publishAvailability(rig, agentA2, 'ledger_a2')
  await publishAvailability(rig, agentB, 'ledger_b')
  await publishAvailability(rig, agentC, 'ledger_c')
  const tasks = [
    { workerUserId: b.userId, planItemId: 'item_worker_b', title: 'Worker B 任务', objective: 'Worker B 执行',
      completionCriteria: ['返回 bounded summary'], dependencyPlanItemIds: [],
      requiredCapabilityTags: ['research.execute'], fileIntent: null },
    { workerUserId: c.userId, planItemId: 'item_worker_c', title: 'Worker C 任务', objective: 'Worker C 并行执行',
      completionCriteria: ['返回 bounded summary'], dependencyPlanItemIds: [],
      requiredCapabilityTags: ['research.execute'], fileIntent: null },
    { workerUserId: b.userId, planItemId: 'item_after_handoff', title: '移交后任务', objective: '新 Coordinator 创建',
      completionCriteria: ['由新 Coordinator 分发'], dependencyPlanItemIds: [],
      requiredCapabilityTags: ['research.execute'], fileIntent: null }
  ]
  const active = await createActiveTextProject(rig, {
    owner: a, members: [b, c], coordinator: agentA, tasks, key: 'ledger'
  })
  let project = active.project
  const offerBInput = { coordinator: agentA, project, plan: active.plan,
    planItemId: 'item_worker_b', key: 'ledger_b' }
  const offeredB = await createOffer(rig, offerBInput)
  const offeredBReplay = await createOffer(rig, offerBInput)
  assert.deepEqual(offeredBReplay, offeredB)
  const runningB = await acceptAndStart(rig, agentB, offeredB, 'ledger_b')
  await expectCode('permission_denied', () => rig.service.startTaskExecution(agentA.actor, {
    protocolVersion: '1.0', type: 'task.execution.start', requestId: 'req_wrong_agent_start_ledger',
    idempotencyKey: 'idem_wrong_agent_start_ledger', taskId: runningB.task.taskId,
    executionId: runningB.execution.executionId, expectedTaskRevision: runningB.task.revision,
    expectedExecutionRevision: runningB.execution.revision, startedAt: rig.clock.now().toISOString()
  }))
  await rig.service.createHumanNeeded(agentB.actor, {
    protocolVersion: '1.0', type: 'human.needed.create', requestId: 'req_human_needed_ledger_b',
    projectId: project.projectId,
    targetUserId: b.userId,
    context: {
      scope: 'worker_execution',
      taskId: runningB.task.taskId,
      executionId: runningB.execution.executionId,
      expectedTaskRevision: runningB.task.revision,
      expectedExecutionRevision: runningB.execution.revision
    },
    requiredAssurance: 'verified', prompt: 'Worker B 需要其 User 的明确输入', confirmableAction: null,
    expiresAt: new Date(rig.clock.now().getTime() + 60_000).toISOString(),
    idempotencyKey: 'idem_human_needed_ledger_b'
  })
  const waitingB = await rig.repository.getTask(runningB.task.taskId)
  assert.equal(waitingB.status, 'needs_human')
  const humanInbox = await rig.service.pullInbox(b.actor, { afterSequence: 0, limit: 20 })
  assert.ok(humanInbox.messages.some((message) => (
    message.messageType === 'human.needed' && message.payload.request?.targetUserId === b.userId
  )))
  const ownerInbox = await rig.service.pullInbox(a.actor, { afterSequence: 0, limit: 20 })
  assert.ok(!ownerInbox.messages.some((message) => message.messageType === 'human.needed'))

  project = await rig.repository.getProject(project.projectId)
  const offeredC = await createOffer(rig, { coordinator: agentA, project, plan: active.plan,
    planItemId: 'item_worker_c', key: 'ledger_c' })
  assert.notEqual(offeredB.offer.workerUserId, offeredC.offer.workerUserId)
  const taskInboxBeforeRestart = await rig.service.pullInbox(agentC.actor, { afterSequence: 0, limit: 20 })
  assert.ok(taskInboxBeforeRestart.messages.some((message) => message.payload.taskId === offeredC.task.taskId))

  const restarted = new CollaborationService({
    repository: rig.repository,
    notifier: rig.notifier,
    now: rig.clock.now
  })
  const taskInboxAfterRestart = await restarted.pullInbox(agentC.actor, { afterSequence: 0, limit: 20 })
  assert.deepEqual(taskInboxAfterRestart.messages, taskInboxBeforeRestart.messages)
  await restarted.ackInbox(agentC.actor, {
    throughSequence: taskInboxAfterRestart.messages.at(-1).sequence,
    idempotencyKey: 'ack-agent-C'
  })
  const cursor = await rig.repository.getInboxCursor({ kind: 'agent', id: agentC.agent.agentId })
  assert.equal(cursor.ackedSequence, taskInboxAfterRestart.messages.at(-1).sequence)

  project = await rig.repository.getProject(project.projectId)
  const currentAvailabilityC = await rig.repository.getWorkerAvailability(agentC.agent.agentId)
  await expectCode('permission_denied', () => restarted.transferCoordinator(a.actor, {
    protocolVersion: '1.0', type: 'project.transfer_coordinator', requestId: 'req_handoff_a_to_c_denied',
    projectId: project.projectId, expectedRevision: project.revision,
    expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    coordinatorAgentId: agentC.agent.agentId,
    expectedCoordinatorAvailabilityRevision: currentAvailabilityC.revision,
    idempotencyKey: 'idem_handoff_a_to_c_denied'
  }))
  const handedOff = await restarted.transferCoordinator(a.actor, {
    protocolVersion: '1.0', type: 'project.transfer_coordinator', requestId: 'req_handoff_a_to_a2',
    projectId: project.projectId, expectedRevision: project.revision,
    expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    coordinatorAgentId: agentA2.agent.agentId,
    expectedCoordinatorAvailabilityRevision: availabilityA2.revision,
    idempotencyKey: 'idem_handoff_a_to_a2'
  })
  await expectCode('permission_denied', () => createOffer(rig, { coordinator: agentA, project: handedOff,
    plan: active.plan,
    planItemId: 'item_after_handoff', key: 'old_coordinator' }))
  const pausedAfterHandoff = await restarted.transitionProject(a.actor, {
    protocolVersion: '1.0', type: 'project.transition', requestId: 'req_handoff_pause',
    idempotencyKey: 'idem_handoff_pause', projectId: handedOff.projectId,
    expectedRevision: handedOff.revision,
    expectedCoordinatorAuthorityEpoch: handedOff.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: handedOff.executionAuthorityEpoch,
    status: 'paused'
  })
  const handoffTask = tasks.find(({ planItemId }) => planItemId === 'item_after_handoff')
  const handoffPlanFacts = {
    projectId: pausedAfterHandoff.projectId, expectedProjectRevision: pausedAfterHandoff.revision,
    expectedCoordinatorAuthorityEpoch: pausedAfterHandoff.coordinatorAuthorityEpoch,
    supersedesProjectPlanId: active.plan.projectPlanId, sourceInputLocators: [], tasks: [handoffTask],
    rationale: 'The new Coordinator re-establishes an exact confirmed plan under its authority epoch.',
    runtimeProvenance: { runtimeId: 'runtime_handoff_a2', modelId: null,
      generatedByCoordinatorAgentId: agentA2.agent.agentId, generatedAt: rig.clock.now().toISOString() }
  }
  const submittedHandoffPlan = await restarted.submitProjectPlan(agentA2.actor, {
    protocolVersion: '1.0', type: 'project.plan.submit', requestId: 'req_handoff_plan_submit',
    idempotencyKey: 'idem_handoff_plan_submit', ...handoffPlanFacts,
    planDigest: stableDigest(handoffPlanFacts)
  })
  const confirmedHandoffPlan = await restarted.confirmProjectPlan(a.actor, {
    protocolVersion: '1.0', type: 'project.plan.confirm', requestId: 'req_handoff_plan_confirm',
    idempotencyKey: 'idem_handoff_plan_confirm', projectId: pausedAfterHandoff.projectId,
    projectPlanId: submittedHandoffPlan.projectPlanId, expectedProjectRevision: pausedAfterHandoff.revision + 1,
    expectedCoordinatorAuthorityEpoch: pausedAfterHandoff.coordinatorAuthorityEpoch,
    expectedPlanRevision: submittedHandoffPlan.revision, planDigest: submittedHandoffPlan.planDigest,
    initialTeam: null
  })
  const confirmedHandoffProject = await rig.repository.getProject(handedOff.projectId)
  const resumedAfterHandoff = await restarted.transitionProject(a.actor, {
    protocolVersion: '1.0', type: 'project.transition', requestId: 'req_handoff_resume',
    idempotencyKey: 'idem_handoff_resume', projectId: confirmedHandoffProject.projectId,
    expectedRevision: confirmedHandoffProject.revision,
    expectedCoordinatorAuthorityEpoch: confirmedHandoffProject.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: confirmedHandoffProject.executionAuthorityEpoch,
    status: 'active'
  })
  const newCoordinatorOffer = await createOffer(rig, { coordinator: agentA2, project: resumedAfterHandoff,
    plan: confirmedHandoffPlan,
    planItemId: 'item_after_handoff', key: 'new_coordinator' })
  assert.equal(newCoordinatorOffer.offer.workerUserId, agentB.agent.ownerUserId)
})

test('8.4 canonical service bounds payloads and blocks sensitive Project Record material', async () => {
  const rig = createServiceRig()
  const a = await bindUser(rig, 'A')
  const agentA = await ensureAgent(rig, a, 'A')
  assert.throws(() => projectCreateCommandSchema.parse({
    protocolVersion: '1.0', type: 'project.create', requestId: 'req_oversized_project',
    createIntentId: 'pct_OversizedProject001',
    displayName: '超限 Project',
    goal: 'x'.repeat(32_001),
    budget: { maxTasks: 2, maxTasksPerRound: 2, maxTaskRetries: 1, maxCoordinationRounds: 1 },
    idempotencyKey: 'idem_oversized_project'
  }))

  const { project } = await rig.service.createProject(agentA.actor, {
    protocolVersion: '1.0', type: 'project.create', requestId: 'req_security_project',
    createIntentId: 'pct_SecurityProject0001',
    displayName: '安全记录 Project',
    goal: '安全记录测试',
    budget: { maxTasks: 2, maxTasksPerRound: 2, maxTaskRetries: 1, maxCoordinationRounds: 1 },
    idempotencyKey: 'idem_security_project'
  })
  const sensitiveSummary = `${['api', 'key'].join('_')}=${['runtime', 'only', 'material'].join('-')}`
  await expectCode('validation_failed', () => rig.service.submitProjectFinalSummary(agentA.actor, {
    protocolVersion: '1.0', type: 'project.final_summary.submit', requestId: 'req_sensitive_summary',
    idempotencyKey: 'idem_sensitive_record',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: project.executionAuthorityEpoch,
    projectPlanId: 'ppl_SensitivePlan001',
    confirmedPlanRevision: 1,
    acceptedResultSubmissionIds: ['rsb_SensitiveResult01'],
    summary: sensitiveSummary
  }))
})

test('8.3 and 10.2 canonical human routes bind provider input and verified target User endpoint answers', async () => {
  const rig = createServiceRig()
  const a = await bindUser(rig, 'A')
  const b = await bindUser(rig, 'B')
  const c = await bindUser(rig, 'C')
  const agentA = await ensureAgent(rig, a, 'A')
  const agentB = await ensureAgent(rig, b, 'B')
  const agentC = await ensureAgent(rig, c, 'C')
  const endpointA = await endpointActor(rig, a)
  const endpointB = await endpointActor(rig, b)
  const endpointC = await endpointActor(rig, c)
  assert.equal(endpointA.userId, a.userId)
  assert.equal(endpointB.userId, b.userId)
  assert.equal(endpointC.userId, c.userId)

  const personalLocator = {
    type: 'provider_locator',
    provider: 'fake-im',
    realmId: 'fake-realm',
    containerId: 'personal-container',
    topicId: 'stable-personal-topic',
    topicDisplayName: '个人 Session'
  }
  await activatePersonalContainer(rig, a, personalLocator.containerId)
  const projection = await rig.service.createProjection(a.actor, {
    agentId: agentA.agent.agentId,
    humanEndpointId: a.endpointId,
    locator: personalLocator,
    displayName: 'A 的个人 Session',
    allowedSenderUserIds: [],
    idempotencyKey: 'create-personal-projection'
  })
  const remoteA = await rig.service.acceptPersonalProviderMessage(endpointA, {
    locator: personalLocator,
    providerMessageId: 'personal-provider-message-A',
    text: 'A 从手机进入固定 Session',
    occurredAt: rig.clock.now().toISOString(),
    providerEventId: 'personal-provider-event-A'
  })
  assert.equal(remoteA.projectionId, projection.projectionId)
  assert.deepEqual(await rig.service.acceptPersonalProviderMessage(endpointA, {
    locator: personalLocator,
    providerMessageId: 'personal-provider-message-A',
    text: 'A 从手机进入固定 Session',
    occurredAt: rig.clock.now().toISOString(),
    providerEventId: 'personal-provider-event-A'
  }), remoteA)
  await expectCode('permission_denied', () => rig.service.acceptPersonalProviderMessage(endpointB, {
    locator: personalLocator,
    providerMessageId: 'personal-provider-message-B',
    text: 'B 不能控制 A 的个人 Session',
    occurredAt: rig.clock.now().toISOString(),
    providerEventId: 'personal-provider-event-B'
  }))
  await expectCode('permission_denied', () => rig.service.acceptPersonalProviderMessage(endpointC, {
    locator: personalLocator,
    providerMessageId: 'personal-provider-message-C',
    text: 'C 未获共享权限',
    occurredAt: rig.clock.now().toISOString(),
    providerEventId: 'personal-provider-event-C'
  }))
  const personalInbox = await rig.service.pullInbox(agentA.actor, { afterSequence: 0, limit: 20 })
  const personalMessages = personalInbox.messages.filter((message) => message.messageType === 'personal.message.received')
  assert.equal(personalMessages.length, 1)
  assert.deepEqual(personalMessages.map((message) => message.payload.senderUserId), [a.userId])
  assert.deepEqual(personalMessages.map((message) => message.payload.humanEndpointId), [a.endpointId])
  assert.ok(personalMessages.every((message) => message.payload.projectionId === projection.projectionId))

  await publishAvailability(rig, agentB, 'human_b')
  const active = await createActiveTextProject(rig, {
    owner: a,
    members: [b],
    coordinator: agentA,
    key: 'human_routing',
    tasks: [{
      workerUserId: b.userId,
      planItemId: 'item_human_needed',
      title: 'HumanNeeded 任务',
      objective: 'B 需要真人决定',
      completionCriteria: ['收到 B 的定向回答'],
      dependencyPlanItemIds: [],
      requiredCapabilityTags: ['research.execute'],
      fileIntent: null
    }]
  })
  let project = active.project
  const projectLocator = {
    type: 'provider_locator',
    provider: 'fake-im',
    realmId: 'fake-realm',
    containerId: 'project-container',
    topicId: 'stable-project-topic',
    topicDisplayName: '多人 Project'
  }
  await rig.service.bindProjectEndpoint(a.actor, {
    projectId: project.projectId,
    locator: projectLocator,
    expectedRevision: null,
    idempotencyKey: 'bind-project-topic'
  })
  const inputB = await rig.service.acceptProjectInput(endpointB, {
    locator: projectLocator,
    providerMessageId: 'project-provider-message-B',
    text: 'B 的 ProjectInput',
    occurredAt: rig.clock.now().toISOString(),
    providerEventId: 'project-provider-event-B'
  })
  assert.equal(inputB.senderUserId, b.userId)
  assert.equal(inputB.sourceHumanEndpointId, b.endpointId)
  const inputBReplay = await rig.service.acceptProjectInput(endpointB, {
    locator: projectLocator,
    providerMessageId: 'project-provider-message-B',
    text: 'B 的 ProjectInput',
    occurredAt: rig.clock.now().toISOString(),
    providerEventId: 'project-provider-event-B-retry'
  })
  assert.equal(inputBReplay.projectInputId, inputB.projectInputId)
  assert.equal([...rig.repository.state.projectInputs.values()].length, 1)
  await expectCode('permission_denied', () => rig.service.acceptProjectInput(endpointC, {
    locator: projectLocator,
    providerMessageId: 'project-provider-message-C',
    text: '非成员 C 不得写 Project',
    occurredAt: rig.clock.now().toISOString(),
    providerEventId: 'project-provider-event-C'
  }))

  project = await rig.repository.getProject(project.projectId)
  const offeredB = await createOffer(rig, { coordinator: agentA, project, plan: active.plan,
    planItemId: 'item_human_needed', key: 'human_b' })
  const runningB = await acceptAndStart(rig, agentB, offeredB, 'human_b')
  const needed = await rig.service.createHumanNeeded(agentB.actor, {
    protocolVersion: '1.0', type: 'human.needed.create', requestId: 'req_human_needed_b',
    projectId: project.projectId,
    targetUserId: b.userId,
    context: {
      scope: 'worker_execution',
      taskId: runningB.task.taskId,
      executionId: runningB.execution.executionId,
      expectedTaskRevision: runningB.task.revision,
      expectedExecutionRevision: runningB.execution.revision
    },
    requiredAssurance: 'verified',
    prompt: '只由目标 Project 成员 B 回答',
    confirmableAction: null,
    expiresAt: new Date(rig.clock.now().getTime() + 60_000).toISOString(),
    idempotencyKey: 'idem_human_needed_b'
  })
  const inboxB = await rig.service.pullInbox(b.actor, { afterSequence: 0, limit: 20 })
  assert.ok(inboxB.messages.some((message) => message.payload.request?.targetUserId === b.userId))
  await expectCode('permission_denied', () => rig.service.answerHumanNeeded(a.actor, {
    protocolVersion: '1.0', type: 'human.answer', requestId: 'req_proxy_human_answer_b',
    humanRequestId: needed.humanRequestId,
    requestRevision: needed.revision,
    answer: 'A 不得代答',
    idempotencyKey: 'proxy-human-answer-A'
  }))
  await expectCode('permission_denied', () => rig.service.answerHumanNeeded(endpointA, {
    protocolVersion: '1.0', type: 'human.answer', requestId: 'req_wrong_endpoint_human_answer_b',
    humanRequestId: needed.humanRequestId,
    requestRevision: needed.revision,
    answer: 'A 的 Endpoint 也不得代答',
    sourceLocator: projectLocator,
    idempotencyKey: 'wrong-endpoint-human-answer-B'
  }))
  const answerB = await rig.service.answerHumanNeeded(endpointB, {
    protocolVersion: '1.0', type: 'human.answer', requestId: 'req_human_answer_b',
    humanRequestId: needed.humanRequestId,
    requestRevision: needed.revision,
    answer: 'B 的 verified Human Endpoint 唯一回答',
    sourceLocator: projectLocator,
    idempotencyKey: 'human-answer-B'
  })
  assert.equal(answerB.answeredByUserId, b.userId)
  assert.deepEqual(answerB.answeredFrom, {
    type: 'human_endpoint',
    humanEndpointId: b.endpointId
  })
  assert.equal((await rig.service.answerHumanNeeded(endpointB, {
    protocolVersion: '1.0', type: 'human.answer', requestId: 'req_human_answer_b',
    humanRequestId: needed.humanRequestId,
    requestRevision: needed.revision,
    answer: 'B 的 verified Human Endpoint 唯一回答',
    sourceLocator: projectLocator,
    idempotencyKey: 'human-answer-B'
  })).humanAnswerId, answerB.humanAnswerId)

  await expectCode('permission_denied', () => rig.service.publishProjectionMessage(agentB.actor, {
    projectionId: projection.projectionId,
    projectionRevision: projection.revision,
    localItemId: 'local-item-cross-agent',
    kind: 'assistant_final',
    text: 'B Agent 不得替 A Session 发布',
    occurredAt: rig.clock.now().toISOString(),
    idempotencyKey: 'cross-agent-projection-publish'
  }))
  assert.equal(agentC.agent.ownerUserId, c.userId)
})
