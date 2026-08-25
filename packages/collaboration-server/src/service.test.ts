import { describe, expect, it } from 'vitest'

import { FakeCollaborationRepository, FakeInboxNotifier } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import type { OidcUserActor, UserActor } from './actor.js'
import { AuthenticationService } from './auth.js'
import { toInboxMessage } from './contracts.js'
import { CollaborationService, providerIdentityInboxId } from './service.js'
import { stableDigest } from './crypto.js'
import { createAgentCredentialBootstrap, seedOidcUserDevice } from './test-fixtures/collaboration-identity.js'

const at = new Date('2026-08-15T02:00:00.000Z')
const now = () => at

async function onboard(
  repository: FakeCollaborationRepository,
  service: CollaborationService,
  authentication: AuthenticationService,
  label: string,
  providerUserId: string
) {
  const identity = await seedOidcUserDevice(repository, label, at)
  const begun = await service.createEndpointChallenge(identity.user, { provider: 'zulip', realmId: 'realm-hk',
    expectedProviderUserId: providerUserId, idempotencyKey: `idem_endpoint_challenge_${label}` })
  await service.verifyEndpointChallengeFromProvider({ provider: 'zulip', realmId: 'realm-hk', providerUserId,
    providerDisplayName: `${label} Remote`, challengeCode: String(begun.challengeCode),
    providerEventId: `provider-event-${label}-verify`, assurance: 'verified' })
  const verified = await service.getEndpointChallenge(identity.user, String(begun.challengeId))
  const endpoint = await authentication.resolveProviderIdentity('zulip', 'realm-hk', providerUserId)
  return { user: identity.user, endpoint, userId: identity.userId, deviceId: identity.deviceId,
    endpointId: String(verified.humanEndpointId) }
}

async function registerAgent(service: CollaborationService, user: UserActor, label: string) {
  const bootstrap = createAgentCredentialBootstrap()
  const result = await service.registerAgent(user, { deviceId: `dev_${user.userId.slice(4)}`,
    displayName: `${label} desktop`, nodeType: 'desktop', capabilities: ['research.execute'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: `idem_agent_register_${label}` })
  if (!result.sealedCredential) throw new Error('Expected one-time sealed Agent credential')
  return { ...result, openedCredential: bootstrap.open(result.sealedCredential) }
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
  it('rejects a handcrafted personal locator when the owner has no managed container', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const owner = await onboard(repository, service, authentication, 'unmanaged-owner', 'unmanaged-provider-user')
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
    const owner = await onboard(repository, service, authentication, 'restore-owner', 'restore-provider-user')
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
    const owner = await onboard(repository, service, authentication, 'transfer-owner', 'transfer-provider-user')
    const target = await onboard(repository, service, authentication, 'transfer-target', 'target-provider-user')
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
    const owner = await onboard(repository, service, authentication, 'managed-owner', '42')
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

    const other = await onboard(repository, service, authentication, 'managed-other', '43')
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

  it('binds a provider endpoint only to its requesting OIDC User without creating a second credential', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const identity = await onboard(repository, service, authentication, 'alice', 'provider-alice')

    expect(identity.userId).toMatch(/^usr_/)
    expect(identity.endpointId).toMatch(/^hep_/)
    const serialized = JSON.stringify(repository.state)
    expect(serialized).not.toContain('pollSecret')
    expect(repository.state.credentials.size).toBe(0)
    const endpoint = await repository.getEndpoint(identity.endpointId)
    expect(endpoint).toMatchObject({ userId: identity.userId, providerUserId: 'provider-alice', status: 'active' })
    const additional = await service.createEndpointChallenge(identity.user, { provider: 'zulip', realmId: 'realm-hk',
      expectedProviderUserId: 'provider-alice-secondary',
      idempotencyKey: 'idem_pairing_expected_identity' })
    await expect(service.verifyEndpointChallengeFromProvider({ provider: 'zulip', realmId: 'realm-hk',
      providerUserId: 'provider-attacker', providerDisplayName: 'Attacker', challengeId: String(additional.challengeId),
      challengeCode: String(additional.challengeCode), providerEventId: 'provider-event-wrong-identity',
      assurance: 'verified' })).rejects.toMatchObject({ code: 'identity_conflict' })
  })

  it('reports endpoint challenge pending and verified state without issuing a polling credential', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = await seedOidcUserDevice(repository, 'pending-endpoint-user', at)
    const begun = await service.createEndpointChallenge(identity.user, { provider: 'zulip', realmId: 'realm-hk',
      expectedProviderUserId: 'provider-pending-user', idempotencyKey: 'idem_pairing_pending_begin_01' })
    const receiptsAfterBegin = repository.state.receipts.size

    const pending = await service.getEndpointChallenge(identity.user, String(begun.challengeId))
    expect(pending).toMatchObject({ type: 'endpoint.challenge.pending', challengeId: begun.challengeId })
    expect(repository.state.receipts.size).toBe(receiptsAfterBegin)

    await service.verifyEndpointChallengeFromProvider({ provider: 'zulip', realmId: 'realm-hk',
      providerUserId: 'provider-pending-user', providerDisplayName: 'Pending Remote User',
      challengeId: String(begun.challengeId), challengeCode: String(begun.challengeCode),
      providerEventId: 'provider-event-pending-verify', assurance: 'verified' })
    const verified = await service.getEndpointChallenge(identity.user, String(begun.challengeId))
    expect(verified).toMatchObject({ type: 'endpoint.challenge.verified', userId: identity.userId,
      assurance: 'verified', verifiedAt: at.toISOString() })
    expect(repository.state.credentials.size).toBe(0)

    const replayed = await service.createEndpointChallenge(identity.user, { provider: 'zulip', realmId: 'realm-hk',
      expectedProviderUserId: 'provider-pending-user', idempotencyKey: 'idem_pairing_pending_begin_01' })
    expect(replayed).toMatchObject({ type: 'endpoint.challenge.created', replayed: true })
    expect(replayed).not.toHaveProperty('challengeCode')
  })

  it('isolates Agent registration idempotency from every stable intent field', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(repository, service, authentication, 'agent-idem-alice', 'provider-agent-idem-alice')
    const bob = await onboard(repository, service, authentication, 'agent-idem-bob', 'provider-agent-idem-bob')
    const bootstrap = createAgentCredentialBootstrap()
    const baseline = {
      deviceId: alice.deviceId,
      displayName: 'Desktop',
      nodeType: 'desktop',
      capabilities: ['agent.execute', 'workspace.read'],
      credentialBootstrapPublicKey: bootstrap.publicKey,
      idempotencyKey: 'idem_agent_register_matrix_baseline'
    }

    const registered = await service.registerAgent(alice.user, baseline)
    expect(bootstrap.open(registered.sealedCredential!)).toMatch(/^agent\./u)

    const replayed = await service.registerAgent(alice.user, baseline)
    expect(replayed).toMatchObject({ agent: { agentId: registered.agent.agentId }, replayed: true })
    expect(replayed).not.toHaveProperty('sealedCredential')
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
      await expect(service.registerAgent(alice.user, intent)).rejects.toMatchObject({ code: 'identity_conflict' })
    }
    expect(repository.state.agents.size).toBe(1)

    await expect(service.registerAgent(bob.user, {
      ...baseline,
      idempotencyKey: 'idem_agent_register_matrix_owner'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    expect(repository.state.agents.size).toBe(1)
  })

})
