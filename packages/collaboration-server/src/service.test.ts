import { describe, expect, it } from 'vitest'

import { FakeCollaborationRepository, FakeInboxNotifier } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import { AuthenticationService, type HumanEndpointActor, type UserActor } from './auth.js'
import { toInboxMessage } from './contracts.js'
import { CollaborationService, providerIdentityInboxId } from './service.js'
import { stableDigest } from './crypto.js'

const at = new Date('2026-08-15T02:00:00.000Z')
const now = () => at

async function onboard(
  service: CollaborationService,
  authentication: AuthenticationService,
  label: string,
  providerUserId: string
) {
  const begun = await service.beginPairing({ provider: 'zulip', realmId: 'realm-hk', requestedDisplayName: label,
    idempotencyKey: `idem_pairing_begin_${label}` })
  await service.verifyPairingFromProvider({ provider: 'zulip', realmId: 'realm-hk', providerUserId,
    providerDisplayName: `${label} Remote`, challengeCode: String(begun.challengeCode),
    providerEventId: `provider-event-${label}-verify`, assurance: 'verified' })
  const redeemed = await service.redeemPairing({ pollSecret: String(begun.pollSecret),
    idempotencyKey: `idem_pairing_redeem_${label}` })
  const user = await authentication.resolveBearer(String(redeemed.userCredential))
  if (user.kind !== 'user') throw new Error('Expected user actor')
  const endpoint = await authentication.resolveProviderIdentity('zulip', 'realm-hk', providerUserId)
  return { user, endpoint, userId: String(redeemed.userId), endpointId: String(redeemed.humanEndpointId) }
}

async function registerAgent(service: CollaborationService, user: UserActor, label: string) {
  const result = await service.registerAgent(user, { installationId: `ins_${label.padEnd(12, '0')}`,
    displayName: `${label} desktop`, nodeType: 'desktop', capabilities: ['research.execute'],
    idempotencyKey: `idem_agent_register_${label}` })
  if (!result.deviceCredential) throw new Error('Expected one-time device credential')
  return result
}

async function activateManagedContainer(
  repository: FakeCollaborationRepository,
  owner: Awaited<ReturnType<typeof onboard>>,
  containerId: string
) {
  const endpoint = (await repository.getEndpoint(owner.endpointId))!
  await repository.insertManagedContainer({
    managedContainerId: `mco_${stableDigest(`${owner.userId}\u0000${containerId}`).slice(0, 12)}`,
    ownerUserId: owner.userId,
    humanEndpointId: owner.endpointId,
    provider: 'zulip',
    realmId: 'realm-hk',
    ownerProviderUserId: endpoint.providerUserId,
    stableKey: `managed-${stableDigest(owner.userId)}`,
    displayName: `sciforge-${stableDigest(owner.userId).slice(0, 12)}`,
    externalContainerId: containerId,
    policy: {
      version: 1, visibility: 'private', history: 'protected', membership: 'owner_and_message_bot',
      memberManagement: 'provisioning_service_only', channelManagement: 'provisioning_service_only',
      ownerCanSend: true, ownerCanCreateTopics: true, messageBotCanSend: true,
      messageBotCreatesProjectTopics: false
    },
    status: 'active', revision: 1, createdAt: at.toISOString(), updatedAt: at.toISOString()
  })
}

function enableContentSpaceRepository(repository: FakeCollaborationRepository): void {
  const state = repository.state as typeof repository.state & {
    projectContentSpaceBindings: Map<string, Record<string, unknown>>
    cloudResourceRefs: Map<string, Record<string, unknown>>
  }
  state.projectContentSpaceBindings = new Map()
  state.cloudResourceRefs = new Map()
  Object.assign(repository, {
    getProjectContentSpaceBinding: async (projectId: string) =>
      structuredClone(state.projectContentSpaceBindings.get(projectId) ?? null),
    upsertProjectContentSpaceBinding: async (binding: Record<string, unknown>, expectedRevision: number | null) => {
      const current = state.projectContentSpaceBindings.get(String(binding.projectId))
      if ((expectedRevision === null && current) ||
          (expectedRevision !== null && Number(current?.revision) !== expectedRevision)) {
        throw new Error('fake repository project content-space binding revision conflict')
      }
      state.projectContentSpaceBindings.set(String(binding.projectId), structuredClone(binding))
    },
    countOpenFileTasks: async (projectId: string) => [...repository.state.tasks.values()].filter((task) =>
      task.projectId === projectId && task.fileIntent !== null &&
      !['rejected', 'completed', 'failed', 'cancelled'].includes(task.status)).length,
    getCloudResourceRef: async (resourceRefId: string) =>
      structuredClone(state.cloudResourceRefs.get(resourceRefId) ?? null),
    listCloudResourceRefs: async (taskId: string, executionId: string) =>
      structuredClone([...state.cloudResourceRefs.values()].filter((resource) =>
        resource.taskId === taskId && resource.executionId === executionId)),
    insertCloudResourceRefs: async (resources: Array<Record<string, unknown>>) => {
      for (const resource of resources) {
        const id = String(resource.resourceRefId)
        if (state.cloudResourceRefs.has(id)) throw new Error('fake repository duplicate resource ref')
        state.cloudResourceRefs.set(id, structuredClone(resource))
      }
    },
    invalidateCloudResourceRefs: async (taskId: string, executionId: string, invalidatedAt: string) => {
      let count = 0
      for (const [id, resource] of state.cloudResourceRefs) {
        if (resource.taskId === taskId && resource.executionId === executionId && resource.status === 'available') {
          state.cloudResourceRefs.set(id, { ...resource, status: 'invalidated', invalidatedAt,
            revision: Number(resource.revision) + 1, updatedAt: invalidatedAt })
          count += 1
        }
      }
      return count
    },
    invalidateCloudResourceRefsForBinding: async (
      projectId: string,
      bindingRevision: number,
      invalidatedAt: string
    ) => {
      let count = 0
      for (const [id, resource] of state.cloudResourceRefs) {
        if (resource.projectId === projectId && resource.bindingRevision === bindingRevision &&
            resource.status === 'available') {
          state.cloudResourceRefs.set(id, { ...resource, status: 'invalidated', invalidatedAt,
            revision: Number(resource.revision) + 1, updatedAt: invalidatedAt })
          count += 1
        }
      }
      return count
    }
  })
}

describe('CollaborationService canonical transactions', () => {
  it('binds a Host-authorized ContentSpace and fences derived ResourceRefs by execution', async () => {
    const repository = new FakeCollaborationRepository()
    enableContentSpaceRepository(repository)
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(new CollaborationService({ repository, now }), authentication,
      'contentspace-alice', 'contentspace-provider-alice')
    const bob = await onboard(new CollaborationService({ repository, now }), authentication,
      'contentspace-bob', 'contentspace-provider-bob')
    const bootstrap = new CollaborationService({ repository, now })
    const aliceAgent = await registerAgent(bootstrap, alice.user, 'contentspacealice')
    const bobAgent = await registerAgent(bootstrap, bob.user, 'contentspacebob')
    const aliceDevice = await authentication.resolveBearer(aliceAgent.deviceCredential!)
    const bobDevice = await authentication.resolveBearer(bobAgent.deviceCredential!)
    if (aliceDevice.kind !== 'agent_device' || bobDevice.kind !== 'agent_device') throw new Error('Expected Agent actors')

    const rootLocator = {
      contractVersion: 1 as const,
      kind: 'content-space.container-reference' as const,
      authority: 'sciforge.content-space.host',
      identity: { spaceId: 'space-alpha', containerId: 'project-root' }
    }
    const inputLocator = {
      contractVersion: 1 as const,
      kind: 'content-space.file-reference' as const,
      authority: 'sciforge.content-space.host',
      identity: { spaceId: 'space-alpha', fileId: 'input-one', semanticRevision: '7' }
    }
    const proof = {
      format: 'sciforge.content-space.authorization-proof.v1' as const,
      issuer: 'sciforge.content-space.host',
      payload: 'opaque-host-signed-proof'
    }
    const verifierInputs: Array<Record<string, unknown>> = []
    const service = new CollaborationService({ repository, now,
      verifyContentSpaceAuthorization: async (input) => {
        verifierInputs.push(structuredClone(input))
        return {
          proofId: 'csp_HostProof0001', issuer: proof.issuer, proofDigest: stableDigest(proof),
          principal: { authority: 'sciforge.oidc', subject: alice.user.userId,
            deviceId: input.actorCredentialId, identityVersion: 1 },
          principalUserId: alice.userId, rootLocatorDigest: stableDigest(rootLocator),
          scopes: ['content-space.read', 'content-space.upload-new'],
          issuedAt: '2026-08-15T01:59:00.000Z', expiresAt: '2026-08-15T03:00:00.000Z'
        }
      } })
    const project = await service.createProject(alice.user, { displayName: 'Host-authorized Project',
      goal: 'Exercise typed file Tasks', memberUserIds: [alice.userId, bob.userId],
      coordinatorAgentId: aliceAgent.agent.agentId,
      budgets: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 2, maxCoordinationRounds: 2 },
      idempotencyKey: 'idem_contentspace_project' })

    const binding = await service.bindProjectContentSpace(alice.user, { projectId: project.projectId,
      expectedRevision: project.revision, rootLocator, authorizationProof: proof,
      idempotencyKey: 'idem_contentspace_binding' })
    expect(verifierInputs).toHaveLength(1)
    expect(verifierInputs[0]).toMatchObject({ actorUserId: alice.userId,
      actorCredentialId: alice.user.credentialId, rootLocator, authorizationProof: proof })
    expect(JSON.stringify(binding)).not.toContain(proof.payload)

    const task = await service.createTask(aliceDevice, { projectId: project.projectId,
      assigneeAgentId: bobAgent.agent.agentId, title: 'Analyze authorized input', objective: 'Produce a new result',
      completionCriteria: ['result uploaded'], dependencyTaskIds: [], expectedProjectRevision: project.revision + 1,
      fileIntent: { schemaVersion: 1, bindingRevision: binding.revision,
        inputs: [{ kind: 'content-space.input-file', locator: inputLocator,
          destinationName: 'input.csv', expectedSemanticRevision: '7' }],
        output: { kind: 'content-space.output-new', target: 'project-binding-root', mode: 'upload-new' } },
      idempotencyKey: 'idem_contentspace_task' })
    expect(task.resourceRefIds).toHaveLength(2)
    expect(task.executionFence).toMatchObject({ assigneeAgentId: bobAgent.agent.agentId,
      taskRevision: task.revision, bindingRevision: binding.revision,
      intentDigest: stableDigest(task.fileIntent) })
    const firstExecutionId = task.executionFence.executionId
    const firstResources = await Promise.all(task.resourceRefIds.map((id) => service.getCloudResourceRef(alice.user, id)))
    expect(firstResources.map((resource) => resource.role)).toEqual(['input-file', 'output-container'])
    expect(firstResources.every((resource) => resource.executionId === firstExecutionId &&
      resource.intentDigest === task.executionFence.intentDigest)).toBe(true)

    const accepted = await service.transitionTask(bobDevice, { taskId: task.taskId, executionId: firstExecutionId,
      status: 'accepted', expectedRevision: task.revision, idempotencyKey: 'idem_contentspace_accept' })
    const running = await service.transitionTask(bobDevice, { taskId: task.taskId, executionId: firstExecutionId,
      status: 'in_progress', expectedRevision: accepted.revision, idempotencyKey: 'idem_contentspace_running' })
    const failed = await service.transitionTask(bobDevice, { taskId: task.taskId, executionId: firstExecutionId,
      status: 'failed', expectedRevision: running.revision, failureSummary: 'bounded failure',
      idempotencyKey: 'idem_contentspace_failed' })
    expect((await service.getCloudResourceRef(alice.user, task.resourceRefIds[0]!)).status).toBe('invalidated')

    const reassigned = await service.retryOrReassignTask(aliceDevice, { taskId: task.taskId,
      previousExecutionId: firstExecutionId, assigneeAgentId: bobAgent.agent.agentId,
      expectedRevision: failed.revision, idempotencyKey: 'idem_contentspace_reassign' })
    expect(reassigned.executionFence.executionId).not.toBe(firstExecutionId)
    expect(reassigned.resourceRefIds).not.toEqual(task.resourceRefIds)
    await expect(service.transitionTask(bobDevice, { taskId: task.taskId, executionId: firstExecutionId,
      status: 'accepted', expectedRevision: reassigned.revision,
      idempotencyKey: 'idem_contentspace_stale_execution' })).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(service.unbindProjectContentSpace(alice.user, { projectId: project.projectId,
      expectedRevision: project.revision + 2, expectedBindingRevision: binding.revision,
      idempotencyKey: 'idem_contentspace_unbind_open' })).rejects.toMatchObject({ code: 'invalid_state_transition' })

    const acceptedAgain = await service.transitionTask(bobDevice, { taskId: task.taskId,
      executionId: reassigned.executionFence.executionId, status: 'accepted', expectedRevision: reassigned.revision,
      idempotencyKey: 'idem_contentspace_accept_again' })
    const runningAgain = await service.transitionTask(bobDevice, { taskId: task.taskId,
      executionId: reassigned.executionFence.executionId, status: 'in_progress', expectedRevision: acceptedAgain.revision,
      idempotencyKey: 'idem_contentspace_running_again' })
    await service.transitionTask(bobDevice, { taskId: task.taskId,
      executionId: reassigned.executionFence.executionId, status: 'completed', expectedRevision: runningAgain.revision,
      resultSummary: 'bounded result', idempotencyKey: 'idem_contentspace_complete_again' })
    const closed = await service.unbindProjectContentSpace(alice.user, { projectId: project.projectId,
      expectedRevision: project.revision + 2, expectedBindingRevision: binding.revision,
      idempotencyKey: 'idem_contentspace_unbind_closed' })
    expect(closed).toMatchObject({ status: 'closed', revision: binding.revision + 1 })
    for (const id of reassigned.resourceRefIds) {
      expect((await service.getCloudResourceRef(alice.user, id)).status).toBe('invalidated')
    }
  })

  it('rejects a handcrafted personal locator when the owner has no managed container', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const owner = await onboard(service, authentication, 'unmanaged-owner', 'unmanaged-provider-user')
    const agent = await registerAgent(service, owner.user, 'unmanagedagent')

    await expect(service.createProjection(owner.user, {
      agentId: agent.agent.agentId,
      humanEndpointId: owner.endpointId,
      locator: { type: 'provider_locator', provider: 'zulip', realmId: 'realm-hk',
        containerId: 'another-users-private-channel', topicId: 'stolen-topic' },
      displayName: 'Untrusted locator',
      allowedSenderUserIds: [owner.userId],
      idempotencyKey: 'idem_projection_without_managed_container'
    })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('restores a closed projection only through the safe paused state', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const owner = await onboard(service, authentication, 'restore-owner', 'restore-provider-user')
    const agent = await registerAgent(service, owner.user, 'restoreagent')
    await activateManagedContainer(repository, owner, 'private-channel')
    const locator = {
      type: 'provider_locator' as const,
      provider: 'zulip',
      realmId: 'realm-hk',
      containerId: 'private-channel',
      topicId: 'topic-22'
    }
    const created = await service.createProjection(owner.user, {
      agentId: agent.agent.agentId,
      humanEndpointId: owner.endpointId,
      locator,
      displayName: 'Topic 22',
      allowedSenderUserIds: [owner.userId],
      idempotencyKey: 'idem_projection_restore_create'
    })
    const closed = await service.updateProjection(owner.user, {
      projectionId: created.projectionId,
      expectedRevision: created.revision,
      status: 'closed',
      idempotencyKey: 'idem_projection_restore_close'
    })

    await expect(service.updateProjection(owner.user, {
      projectionId: closed.projectionId,
      expectedRevision: closed.revision,
      status: 'active',
      idempotencyKey: 'idem_projection_restore_direct_active'
    })).rejects.toMatchObject({ code: 'invalid_state_transition' })

    const paused = await service.updateProjection(owner.user, {
      projectionId: closed.projectionId,
      expectedRevision: closed.revision,
      status: 'paused',
      idempotencyKey: 'idem_projection_restore_pause'
    })
    expect(paused).toMatchObject({ status: 'paused', revision: closed.revision + 1 })

    const restored = await service.updateProjection(owner.user, {
      projectionId: paused.projectionId,
      expectedRevision: paused.revision,
      status: 'active',
      idempotencyKey: 'idem_projection_restore_activate'
    })
    expect(restored).toMatchObject({ status: 'active', revision: paused.revision + 1 })
  })

  it('transfers managed ownership atomically and pauses the previous owner projection', async () => {
    const repository = new FakeCollaborationRepository()
    const notifier = new FakeInboxNotifier()
    const service = new CollaborationService({ repository, notifier, now })
    const authentication = new AuthenticationService(repository, now)
    const owner = await onboard(service, authentication, 'transfer-owner', 'transfer-provider-user')
    const target = await onboard(service, authentication, 'transfer-target', 'target-provider-user')
    const agent = await registerAgent(service, owner.user, 'transferagent')
    await activateManagedContainer(repository, owner, 'transfer-channel')
    const projection = await service.createProjection(owner.user, {
      agentId: agent.agent.agentId, humanEndpointId: owner.endpointId,
      locator: { type: 'provider_locator', provider: 'zulip', realmId: 'realm-hk',
        containerId: 'transfer-channel', topicId: 'transfer-topic' },
      displayName: 'Transfer topic', allowedSenderUserIds: [owner.userId],
      idempotencyKey: 'idem_projection_before_endpoint_transfer'
    })
    const container = (await service.listManagedContainers(owner.user))[0]!
    const endpointBeforeTransfer = (await repository.getEndpoint(owner.endpointId))!

    await service.transferEndpoint({ ...owner.user, assurance: 'strong' }, {
      humanEndpointId: owner.endpointId, targetUserId: target.userId,
      expectedRevision: endpointBeforeTransfer.revision, idempotencyKey: 'idem_endpoint_transfer_managed_owner'
    })

    expect(await repository.getProjection(projection.projectionId)).toMatchObject({
      status: 'paused', lastErrorCode: 'human_endpoint_transferred', revision: projection.revision + 1
    })
    expect(await repository.getManagedContainer(container.managedContainerId)).toMatchObject({
      ownerUserId: target.userId, revision: container.revision + 1
    })
    await expect(service.inspectManagedContainer(owner.user, {
      managedContainerId: container.managedContainerId, expectedRevision: container.revision + 1,
      idempotencyKey: 'idem_old_owner_inspect_after_transfer'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(service.inspectManagedContainer(target.user, {
      managedContainerId: container.managedContainerId, expectedRevision: container.revision + 1,
      idempotencyKey: 'idem_new_owner_inspect_after_transfer'
    })).resolves.toMatchObject({ ownerUserId: target.userId })
    expect(notifier.notifications).toContainEqual(expect.objectContaining({
      recipient: { kind: 'agent', id: agent.agent.agentId }
    }))
  })

  it('queues exactly one managed Channel ensure job for an owned active endpoint', async () => {
    const repository = new FakeCollaborationRepository()
    const notifier = new FakeInboxNotifier()
    const service = new CollaborationService({ repository, notifier, now })
    const authentication = new AuthenticationService(repository)
    const owner = await onboard(service, authentication, 'managed-owner', '42')
    const policy = { version: 1 as const, visibility: 'private' as const, history: 'protected' as const,
      membership: 'owner_and_message_bot' as const, memberManagement: 'provisioning_service_only' as const,
      channelManagement: 'provisioning_service_only' as const, ownerCanSend: true as const,
      ownerCanCreateTopics: true as const, messageBotCanSend: true as const,
      messageBotCreatesProjectTopics: false as const }
    const input = {
      humanEndpointId: owner.endpointId,
      displayName: `sciforge-${stableDigest(owner.userId).slice(0, 12)}`,
      policy,
      idempotencyKey: 'idem_managed_container_ensure_owner'
    }
    const first = await service.ensureManagedContainer(owner.user, input)
    const second = await service.ensureManagedContainer(owner.user, input)
    expect(second.managedContainerId).toBe(first.managedContainerId)
    expect(first).toMatchObject({ ownerUserId: owner.userId, humanEndpointId: owner.endpointId,
      status: 'requested', revision: 1 })
    expect(repository.state.managedContainers.size).toBe(1)
    expect(repository.state.managedContainerJobs.size).toBe(1)

    repository.state.managedContainers.set(first.managedContainerId, {
      ...first,
      status: 'failed',
      safeErrorCode: 'invalid_payload',
      revision: 2,
      updatedAt: at.toISOString()
    })
    const retried = await service.ensureManagedContainer(owner.user, {
      ...input,
      idempotencyKey: 'idem_managed_container_retry_owner'
    })
    const retryReplay = await service.ensureManagedContainer(owner.user, {
      ...input,
      idempotencyKey: 'idem_managed_container_retry_owner'
    })
    expect(retried).toMatchObject({
      managedContainerId: first.managedContainerId,
      status: 'requested',
      revision: 3
    })
    expect(retried.safeErrorCode).toBeUndefined()
    expect(retryReplay).toEqual(retried)
    expect(repository.state.managedContainers.size).toBe(1)
    expect(repository.state.managedContainerJobs.size).toBe(2)
    expect([...repository.state.managedContainerJobs.values()]).toContainEqual(expect.objectContaining({
      operation: 'ensure', desiredRevision: 3, state: 'queued'
    }))

    repository.state.managedContainers.set(first.managedContainerId, {
      ...first,
      externalContainerId: '123',
      status: 'active',
      revision: 4,
      updatedAt: at.toISOString()
    })
    const agent = await registerAgent(service, owner.user, 'managedagent')
    await expect(service.createProjection(owner.user, {
      agentId: agent.agent.agentId,
      humanEndpointId: owner.endpointId,
      locator: {
        type: 'provider_locator', provider: 'zulip', realmId: 'realm-hk',
        containerId: 'another-users-private-channel', topicId: 'topic-cross-user'
      },
      displayName: 'Cross-user locator',
      allowedSenderUserIds: [owner.userId],
      idempotencyKey: 'idem_projection_cross_user_container'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const replayed = await service.ensureManagedContainer(owner.user, input)
    expect(replayed).toMatchObject({ status: 'active', revision: 4 })

    const inspected = await service.inspectManagedContainer(owner.user, {
      managedContainerId: first.managedContainerId,
      expectedRevision: 4,
      idempotencyKey: 'idem_managed_container_inspect_owner'
    })
    expect(inspected).toMatchObject({ status: 'active', revision: 4 })
    expect([...repository.state.managedContainerJobs.values()]).toContainEqual(expect.objectContaining({
      operation: 'inspect', desiredRevision: 4, state: 'queued'
    }))
    const projection = await service.createProjection(owner.user, {
      agentId: agent.agent.agentId, humanEndpointId: owner.endpointId,
      locator: { type: 'provider_locator', provider: 'zulip', realmId: 'realm-hk',
        containerId: '123', topicId: 'topic-owned' },
      displayName: 'Owned Topic', allowedSenderUserIds: [owner.userId],
      idempotencyKey: 'idem_projection_owned_managed_container'
    })
    const archived = await service.archiveManagedContainer(owner.user, {
      managedContainerId: first.managedContainerId, expectedRevision: 4,
      idempotencyKey: 'idem_managed_container_archive_owner'
    })
    expect(archived).toMatchObject({ status: 'suspended', revision: 5 })
    expect(await repository.getProjection(projection.projectionId)).toMatchObject({
      status: 'paused', lastErrorCode: 'managed_container_archived', revision: 2
    })
    expect([...repository.state.managedContainerJobs.values()]).toContainEqual(expect.objectContaining({
      operation: 'archive', desiredRevision: 5, state: 'queued'
    }))
    expect(notifier.notifications).toContainEqual(expect.objectContaining({
      recipient: { kind: 'agent', id: agent.agent.agentId }
    }))

    const other = await onboard(service, authentication, 'managed-other', '43')
    await expect(service.ensureManagedContainer(other.user, {
      ...input,
      displayName: `sciforge-${stableDigest(other.userId).slice(0, 12)}`,
      idempotencyKey: 'idem_managed_container_cross_user'
    })).rejects.toMatchObject({ code: 'permission_denied' })
  })
  it('queues idempotent provider command results without exposing challenge details', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = {
      type: 'provider_identity' as const,
      provider: 'zulip',
      realmId: 'realm-hk',
      providerUserId: 'provider-direct-user'
    }
    const input = { identity, providerEventId: 'provider-event-direct-result-1', result: 'invalid_or_expired' as const }

    await service.enqueueProviderCommandResult(input)
    await service.enqueueProviderCommandResult(input)

    const recipient = {
      kind: 'provider_identity' as const,
      id: providerIdentityInboxId({
        type: 'provider_direct_recipient',
        provider: identity.provider,
        realmId: identity.realmId,
        providerUserId: identity.providerUserId
      })
    }
    const messages = await repository.pullInbox(recipient, 0, 20, at.toISOString())
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      recipient,
      messageType: 'provider.command.result.outbound',
      payload: {
        type: 'provider.command.result.outbound',
        result: 'invalid_or_expired',
        text: '绑定码无效或已失效，请重新生成。',
        recipient: {
          type: 'provider_direct_recipient',
          provider: 'zulip',
          realmId: 'realm-hk',
          providerUserId: 'provider-direct-user'
        }
      }
    })
    expect(JSON.stringify(messages)).not.toContain('challenge')
  })

  it('pulls provider command results after the durable ack cursor beyond one page', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = {
      type: 'provider_identity' as const,
      provider: 'zulip',
      realmId: 'realm-hk',
      providerUserId: 'provider-direct-paged-user'
    }
    const recipientId = providerIdentityInboxId({
      type: 'provider_direct_recipient',
      provider: identity.provider,
      realmId: identity.realmId,
      providerUserId: identity.providerUserId
    })
    for (let index = 1; index <= 101; index += 1) {
      await service.enqueueProviderCommandResult({
        identity,
        providerEventId: `provider-event-direct-page-${index}`,
        result: 'invalid_or_expired'
      })
    }

    const firstPage = await service.pullProviderIdentityInbox({ recipientId, limit: 100 })
    expect(firstPage.messages).toHaveLength(100)
    const last = firstPage.messages.at(-1)!
    await service.ackProviderIdentityInboxMessage({
      recipientId,
      inboxMessageId: last.messageId,
      sequence: last.sequence
    })

    const nextPage = await service.pullProviderIdentityInbox({ recipientId, limit: 100 })
    expect(nextPage.ackedSequence).toBe(100)
    expect(nextPage.messages.map((message) => message.sequence)).toEqual([101])
  })

  it('pairs a provider identity exactly once without persisting plaintext secrets', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const identity = await onboard(service, authentication, 'alice', 'provider-alice')

    expect(identity.userId).toMatch(/^usr_/)
    expect(identity.endpointId).toMatch(/^hep_/)
    const serialized = JSON.stringify(repository.state)
    expect(serialized).not.toContain('pairing_poll.')
    expect(serialized).not.toContain('user.')
    const endpoint = await repository.getEndpoint(identity.endpointId)
    expect(endpoint).toMatchObject({ userId: identity.userId, providerUserId: 'provider-alice', status: 'active' })
    const additional = await service.beginPairing({ provider: 'zulip', realmId: 'realm-hk',
      requestedDisplayName: 'alice', requestedBy: identity.user, expectedProviderUserId: 'provider-alice-secondary',
      idempotencyKey: 'idem_pairing_expected_identity' })
    await expect(service.verifyPairingFromProvider({ provider: 'zulip', realmId: 'realm-hk',
      providerUserId: 'provider-attacker', providerDisplayName: 'Attacker', challengeId: String(additional.challengeId),
      challengeCode: String(additional.challengeCode), providerEventId: 'provider-event-wrong-identity',
      assurance: 'verified' })).rejects.toMatchObject({ code: 'identity_conflict' })
    await expect(service.redeemPairing({ pollSecret: 'pairing_poll.invalid-but-long-enough-to-check',
      idempotencyKey: 'idem_invalid_pairing_poll' })).rejects.toMatchObject({ code: 'authentication_required' })
  })

  it('does not cache a pending pairing redeem and redacts the terminal replay for the same key', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const begun = await service.beginPairing({ provider: 'zulip', realmId: 'realm-hk',
      requestedDisplayName: 'Pending pairing user', idempotencyKey: 'idem_pairing_pending_begin_01' })
    const receiptsAfterBegin = repository.state.receipts.size
    const redeemInput = { pollSecret: String(begun.pollSecret), idempotencyKey: 'idem_pairing_pending_redeem_01' }

    const pending = await service.redeemPairing(redeemInput)
    expect(pending).toMatchObject({ type: 'pairing.pending', challengeId: begun.challengeId })
    expect(repository.state.receipts.size).toBe(receiptsAfterBegin)
    expect(repository.state.auditEvents).toContainEqual(expect.objectContaining({
      action: 'pairing.redeem', outcome: 'accepted' }))

    await service.verifyPairingFromProvider({ provider: 'zulip', realmId: 'realm-hk',
      providerUserId: 'provider-pending-user', providerDisplayName: 'Pending Remote User',
      challengeId: String(begun.challengeId), challengeCode: String(begun.challengeCode),
      providerEventId: 'provider-event-pending-verify', assurance: 'verified' })
    expect(repository.state.challenges.get(String(begun.challengeId))?.consumedAt).toBeUndefined()

    const redeemed = await service.redeemPairing(redeemInput)
    expect(redeemed).toMatchObject({ type: 'pairing.redeemed' })
    expect(typeof redeemed.userCredential).toBe('string')
    expect(repository.state.challenges.get(String(begun.challengeId))?.consumedAt).toBe(at.toISOString())
    const credentialCount = repository.state.credentials.size
    const terminalReceiptCount = repository.state.receipts.size

    const replayed = await service.redeemPairing(redeemInput)
    expect(replayed).toMatchObject({ type: 'pairing.redeemed', replayed: true })
    expect(replayed).not.toHaveProperty('userCredential')
    expect(repository.state.credentials.size).toBe(credentialCount)
    expect(repository.state.receipts.size).toBe(terminalReceiptCount)
  })

  it('isolates Agent registration idempotency from every stable intent field', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(service, authentication, 'agent-idem-alice', 'provider-agent-idem-alice')
    const bob = await onboard(service, authentication, 'agent-idem-bob', 'provider-agent-idem-bob')
    const installationId = 'ins_agentidem0000001'
    const baseline = {
      installationId,
      displayName: 'Desktop',
      nodeType: 'desktop',
      capabilities: ['agent.execute', 'workspace.read'],
      idempotencyKey: 'idem_agent_register_matrix_baseline'
    }

    const registered = await service.registerAgent(alice.user, baseline)
    expect(registered.deviceCredential).toBeTypeOf('string')

    const replayed = await service.registerAgent(alice.user, baseline)
    expect(replayed).toMatchObject({ agent: { agentId: registered.agent.agentId }, replayed: true })
    expect(replayed).not.toHaveProperty('deviceCredential')
    expect(repository.state.agents.size).toBe(1)

    await expect(service.registerAgent(alice.user, {
      ...baseline,
      displayName: 'Different body with reused key'
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })

    const changedIntents = [
      { ...baseline, displayName: 'Desktop Two', idempotencyKey: 'idem_agent_register_matrix_display' },
      { ...baseline, nodeType: 'server', idempotencyKey: 'idem_agent_register_matrix_node' },
      { ...baseline, capabilities: ['agent.execute'], idempotencyKey: 'idem_agent_register_matrix_capability' }
    ]
    for (const intent of changedIntents) {
      const result = await service.registerAgent(alice.user, intent)
      expect(result).toMatchObject({ agent: { agentId: registered.agent.agentId }, replayed: true })
      expect(result).not.toHaveProperty('deviceCredential')
    }
    expect(repository.state.agents.size).toBe(1)

    await expect(service.registerAgent(bob.user, {
      ...baseline,
      idempotencyKey: 'idem_agent_register_matrix_owner'
    })).rejects.toMatchObject({ code: 'identity_conflict' })
    expect(repository.state.agents.size).toBe(1)
  })

  it('keeps Project task writes star-shaped, idempotent, ordered, and restart-recoverable', async () => {
    const repository = new FakeCollaborationRepository()
    const notifier = new FakeInboxNotifier()
    const service = new CollaborationService({ repository, notifier, now })
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(service, authentication, 'alice', 'provider-alice')
    const bob = await onboard(service, authentication, 'bob', 'provider-bob')
    const aliceAgent = await registerAgent(service, alice.user, 'aliceagent01')
    const bobAgent = await registerAgent(service, bob.user, 'bobagent0001')
    const aliceDevice = await authentication.resolveBearer(aliceAgent.deviceCredential!)
    const bobDevice = await authentication.resolveBearer(bobAgent.deviceCredential!)
    if (aliceDevice.kind !== 'agent_device' || bobDevice.kind !== 'agent_device') throw new Error('Expected Agent actors')

    const project = await service.createProject(alice.user, { displayName: '共同研究', goal: '验证协作内核',
      memberUserIds: [alice.userId, bob.userId], coordinatorAgentId: aliceAgent.agent.agentId,
      budgets: { maxTasks: 4, maxTasksPerRound: 2, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      idempotencyKey: 'idem_project_create_shared' })
    const task = await service.createTask(aliceDevice, { projectId: project.projectId,
      assigneeAgentId: bobAgent.agent.agentId, title: '分析数据', objective: '返回有界结果摘要',
      completionCriteria: ['结果可复核'], dependencyTaskIds: [], expectedProjectRevision: project.revision,
      idempotencyKey: 'idem_task_create_bob_01' })
    const repeated = await service.createTask(aliceDevice, { projectId: project.projectId,
      assigneeAgentId: bobAgent.agent.agentId, title: '分析数据', objective: '返回有界结果摘要',
      completionCriteria: ['结果可复核'], dependencyTaskIds: [], expectedProjectRevision: project.revision,
      idempotencyKey: 'idem_task_create_bob_01' })
    expect(repeated.taskId).toBe(task.taskId)
    expect((await repository.pullInbox({ kind: 'agent', id: bobAgent.agent.agentId }, 0, 20, at.toISOString())))
      .toHaveLength(1)
    await expect(service.transitionTask(aliceDevice, { taskId: task.taskId, status: 'accepted',
      executionId: task.executionFence.executionId, expectedRevision: 1,
      idempotencyKey: 'idem_wrong_agent_accept' })).rejects.toMatchObject({ code: 'permission_denied' })

    const restarted = new CollaborationService({ repository, notifier, now })
    const accepted = await restarted.transitionTask(bobDevice, { taskId: task.taskId, status: 'accepted',
      executionId: task.executionFence.executionId, expectedRevision: 1,
      idempotencyKey: 'idem_bob_accept_task_01' })
    const running = await restarted.transitionTask(bobDevice, { taskId: task.taskId, status: 'in_progress',
      executionId: accepted.executionFence.executionId, expectedRevision: accepted.revision,
      idempotencyKey: 'idem_bob_run_task_01' })
    const completed = await restarted.transitionTask(bobDevice, { taskId: task.taskId, status: 'completed',
      executionId: running.executionFence.executionId, expectedRevision: running.revision,
      resultSummary: '分析完成，结果可复核。',
      idempotencyKey: 'idem_bob_complete_task_01' })
    expect(completed.status).toBe('completed')
    const coordinatorInbox = await restarted.pullInbox(aliceDevice, { afterSequence: 0, limit: 20 })
    expect(() => coordinatorInbox.messages.map(toInboxMessage)).not.toThrow()
    expect(coordinatorInbox.messages.map((message) => message.sequence)).toEqual(
      coordinatorInbox.messages.map((_, index) => index + 1)
    )
  })

  it('routes an owner-only personal topic to its fixed Agent once and targets HumanNeeded answers', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(service, authentication, 'alice', 'provider-alice')
    const bob = await onboard(service, authentication, 'bob', 'provider-bob')
    const aliceAgent = await registerAgent(service, alice.user, 'aliceagent02')
    const bobAgent = await registerAgent(service, bob.user, 'bobagent0002')
    const aliceDevice = await authentication.resolveBearer(aliceAgent.deviceCredential!)
    const bobDevice = await authentication.resolveBearer(bobAgent.deviceCredential!)
    if (aliceDevice.kind !== 'agent_device' || bobDevice.kind !== 'agent_device') throw new Error('Expected Agent actors')
    await activateManagedContainer(repository, alice, 'stream-research')
    const locator = { type: 'provider_locator' as const, provider: 'zulip', realmId: 'realm-hk',
      containerId: 'stream-research', topicId: 'topic-fixed', topicDisplayName: '固定会话' }
    const projection = await service.createProjection(alice.user, { agentId: aliceAgent.agent.agentId,
      humanEndpointId: alice.endpointId, locator, displayName: '固定会话', allowedSenderUserIds: [alice.userId],
      idempotencyKey: 'idem_projection_create_alice' })
    const first = await service.acceptPersonalProviderMessage(alice.endpoint, { locator,
      providerMessageId: 'zulip-message-100', providerEventId: 'zulip-event-100', text: '请继续分析',
      occurredAt: at.toISOString() })
    const duplicate = await service.acceptPersonalProviderMessage(alice.endpoint, { locator,
      providerMessageId: 'zulip-message-100', providerEventId: 'zulip-event-100', text: '请继续分析',
      occurredAt: at.toISOString() })
    expect(duplicate).toEqual(first)
    expect(await repository.pullInbox({ kind: 'agent', id: aliceAgent.agent.agentId }, 0, 20, at.toISOString())).toHaveLength(1)
    expect(await repository.pullInbox({ kind: 'agent', id: bobAgent.agent.agentId }, 0, 20, at.toISOString())).toHaveLength(0)
    expect(projection.agentId).toBe(aliceAgent.agent.agentId)
    const movedLocator = { ...locator,
      containerDisplayName: '研究（新）', topicDisplayName: '固定会话（新）' }
    const moved = await service.applyProviderLocatorChange({ previousLocator: locator, currentLocator: movedLocator,
      providerEventId: 'zulip-event-locator-moved-100' })
    expect(moved).toEqual({ kind: 'personal_projection', resourceId: projection.projectionId })
    const updatedProjection = await service.getProjection(alice.user, projection.projectionId)
    expect(updatedProjection).toMatchObject({ projectionId: projection.projectionId,
      agentId: aliceAgent.agent.agentId, displayName: '固定会话', locator: movedLocator,
      locatorRevision: 2, revision: 2 })
    const replayedMove = await service.applyProviderLocatorChange({ previousLocator: locator,
      currentLocator: movedLocator, providerEventId: 'zulip-event-locator-moved-replay-100' })
    expect(replayedMove).toEqual({ kind: 'personal_projection', resourceId: projection.projectionId })
    expect(await service.getProjection(alice.user, projection.projectionId)).toMatchObject({
      projectionId: projection.projectionId, locatorRevision: 2, revision: 2 })
    await service.acceptPersonalProviderMessage(alice.endpoint, { locator: movedLocator,
      providerMessageId: 'zulip-message-101', providerEventId: 'zulip-event-101', text: '在新 Topic 继续',
      occurredAt: at.toISOString() })
    const movedSessionInbox = await repository.pullInbox(
      { kind: 'agent', id: aliceAgent.agent.agentId }, 0, 20, at.toISOString())
    expect(movedSessionInbox.map((message) => message.messageType)).toEqual([
      'personal.message.received', 'projection.updated', 'personal.message.received'
    ])
    expect(movedSessionInbox[1]?.payload).toMatchObject({
      type: 'projection.updated', projectionId: projection.projectionId, revision: 2 })
    expect(movedSessionInbox[2]?.payload).toMatchObject({
      type: 'personal.message.received', projectionId: projection.projectionId, projectionRevision: 2 })
    await expect(service.acceptPersonalProviderMessage(alice.endpoint, { locator,
      providerMessageId: 'zulip-message-102', providerEventId: 'zulip-event-102', text: '稳定 ID 仍应路由',
      occurredAt: at.toISOString() })).resolves.toMatchObject({ projectionId: projection.projectionId })

    const project = await service.createProject(alice.user, { displayName: 'Human loop', goal: '定向提问',
      memberUserIds: [alice.userId, bob.userId], coordinatorAgentId: aliceAgent.agent.agentId,
      idempotencyKey: 'idem_project_human_loop' })
    const projectLocator = { ...locator, topicId: 'topic-project', topicDisplayName: '项目协作' }
    const projectBinding = await service.bindProjectEndpoint(alice.user, { projectId: project.projectId,
      locator: projectLocator, expectedRevision: null, idempotencyKey: 'idem_project_endpoint_bind' })
    const movedProjectLocator = { ...projectLocator, containerId: 'stream-project-renamed',
      containerDisplayName: '项目（新）', topicDisplayName: '项目协作（新）' }
    const movedProject = await service.applyProviderLocatorChange({ previousLocator: projectLocator,
      currentLocator: movedProjectLocator, providerEventId: 'zulip-event-project-locator-moved-100' })
    expect(movedProject).toEqual({ kind: 'project', resourceId: project.projectId })
    expect(await service.getProjectEndpointBinding(alice.user, project.projectId)).toMatchObject({
      projectEndpointBindingId: projectBinding.projectEndpointBindingId, projectId: project.projectId,
      locator: movedProjectLocator, locatorRevision: 2, revision: 2 })
    const replayedProjectMove = await service.applyProviderLocatorChange({ previousLocator: projectLocator,
      currentLocator: movedProjectLocator, providerEventId: 'zulip-event-project-locator-moved-replay-100' })
    expect(replayedProjectMove).toEqual({ kind: 'project', resourceId: project.projectId })
    expect(await service.getProjectEndpointBinding(alice.user, project.projectId)).toMatchObject({
      projectEndpointBindingId: projectBinding.projectEndpointBindingId, locatorRevision: 2, revision: 2 })
    const projectInput = await service.acceptProjectInput(bob.endpoint, { locator: movedProjectLocator,
      providerMessageId: 'zulip-project-message-101', providerEventId: 'zulip-project-event-101',
      text: '在新项目 Topic 继续', occurredAt: at.toISOString() })
    expect(projectInput).toMatchObject({ projectId: project.projectId, senderUserId: bob.userId })
    const movedProjectInbox = await repository.pullInbox(
      { kind: 'agent', id: aliceAgent.agent.agentId }, 0, 50, at.toISOString())
    const endpointUpdateIndex = movedProjectInbox.findIndex((message) =>
      message.messageType === 'project.endpoint.updated' && message.payload.projectId === project.projectId)
    const projectInputIndex = movedProjectInbox.findIndex((message) =>
      message.messageType === 'project.input.received' && message.payload.projectInputId === projectInput.projectInputId)
    expect(endpointUpdateIndex).toBeGreaterThanOrEqual(0)
    expect(projectInputIndex).toBeGreaterThan(endpointUpdateIndex)
    await expect(service.acceptProjectInput(bob.endpoint, { locator: projectLocator,
      providerMessageId: 'zulip-project-message-102', providerEventId: 'zulip-project-event-102',
      text: '旧项目 Topic 不应路由', occurredAt: at.toISOString() }))
      .rejects.toMatchObject({ code: 'not_found' })
    const task = await service.createTask(aliceDevice, { projectId: project.projectId,
      assigneeAgentId: bobAgent.agent.agentId, title: '需确认', objective: '等待 Bob 决策',
      completionCriteria: ['收到回答'], dependencyTaskIds: [], expectedProjectRevision: project.revision,
      idempotencyKey: 'idem_task_human_loop' })
    const accepted = await service.transitionTask(bobDevice, { taskId: task.taskId, status: 'accepted', expectedRevision: 1,
      executionId: task.executionFence.executionId, idempotencyKey: 'idem_task_human_accept' })
    const running = await service.transitionTask(bobDevice, { taskId: task.taskId, status: 'in_progress',
      executionId: accepted.executionFence.executionId, expectedRevision: accepted.revision,
      idempotencyKey: 'idem_task_human_running' })
    const request = await service.createHumanNeeded(bobDevice, { projectId: project.projectId, taskId: task.taskId,
      executionId: running.executionFence.executionId, expectedTaskRevision: running.revision,
      targetUserId: bob.userId, requiredAssurance: 'verified',
      prompt: '是否继续？', expiresAt: '2026-08-15T03:00:00.000Z', idempotencyKey: 'idem_human_needed_bob' })
    const providerNotifications = await repository.pullInbox(
      { kind: 'human_endpoint', id: bob.endpointId }, 0, 20, at.toISOString())
    expect(providerNotifications).toContainEqual(expect.objectContaining({
      messageType: 'provider.notification.outbound',
      payload: expect.objectContaining({
        resourceId: request.humanRequestId,
        text: `是否继续？\n\n回复命令：sciforge-answer ${request.humanRequestId} ${request.revision} <answer>`
      })
    }))
    await expect(service.answerHumanNeeded(alice.endpoint as HumanEndpointActor, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '代答', idempotencyKey: 'idem_human_wrong_user' }))
      .rejects.toMatchObject({ code: 'permission_denied' })
    const otherProject = await service.createProject(alice.user, { displayName: 'Other project', goal: '错误 Topic 验证',
      memberUserIds: [alice.userId, bob.userId], coordinatorAgentId: aliceAgent.agent.agentId,
      idempotencyKey: 'idem_project_other_human_loop' })
    const otherProjectLocator = { ...locator, topicId: 'topic-other-project', topicDisplayName: '其他项目' }
    await service.bindProjectEndpoint(alice.user, { projectId: otherProject.projectId,
      locator: otherProjectLocator, expectedRevision: null, idempotencyKey: 'idem_project_other_endpoint_bind' })
    await expect(service.answerHumanNeeded(bob.endpoint, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '从错误项目回答', sourceLocator: otherProjectLocator,
      idempotencyKey: 'idem_human_wrong_project_locator' })).rejects.toMatchObject({ code: 'not_found' })
    const answer = await service.answerHumanNeeded(bob.endpoint, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '继续', sourceLocator: movedProjectLocator,
      idempotencyKey: 'idem_human_answer_bob' })
    expect(answer).toMatchObject({ answeredByUserId: bob.userId, answeredFromHumanEndpointId: bob.endpointId })
    const repeatedAnswer = await service.answerHumanNeeded(bob.endpoint, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '继续', sourceLocator: movedProjectLocator,
      idempotencyKey: 'idem_human_answer_bob' })
    expect(repeatedAnswer.humanAnswerId).toBe(answer.humanAnswerId)
    const expiringRequest = await service.createHumanNeeded(bobDevice, { projectId: project.projectId, taskId: task.taskId,
      executionId: running.executionFence.executionId, expectedTaskRevision: running.revision + 1,
      targetUserId: bob.userId, requiredAssurance: 'verified',
      prompt: '过期后不可回答', expiresAt: '2026-08-15T03:30:00.000Z',
      idempotencyKey: 'idem_human_needed_expiring_bob' })
    const laterService = new CollaborationService({ repository, now: () => new Date('2026-08-15T04:00:00.000Z') })
    await expect(laterService.answerHumanNeeded(bob.endpoint, { humanRequestId: expiringRequest.humanRequestId,
      requestRevision: expiringRequest.revision, answer: '迟到回答', sourceLocator: movedProjectLocator,
      idempotencyKey: 'idem_human_expired_answer_bob' })).rejects.toMatchObject({ code: 'request_expired' })
    const bobInbox = await service.pullInbox(bob.user, { afterSequence: 0, limit: 20 })
    expect(() => bobInbox.messages.map(toInboxMessage)).not.toThrow()
    const aliceAgentInbox = await service.pullInbox(aliceDevice, { afterSequence: 0, limit: 50 })
    expect(() => aliceAgentInbox.messages.map(toInboxMessage)).not.toThrow()
  })
})
