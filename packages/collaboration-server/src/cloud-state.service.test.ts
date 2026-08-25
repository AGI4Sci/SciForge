import { createHash, generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  canonicalProjectContentProvisioningAttestationFactualPayloadBytes,
  canonicalProjectContentProvisioningAttestationSignatureBytes,
  canonicalProvisionedMemberSetBytes,
  type CloudStateCommand,
  type ProjectContentProvisioningAttestation,
  type ProjectCreateCommand
} from '@sciforge/collaboration-contracts'
import { FakeCollaborationRepository } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import type { AgentActor, HumanEndpointActor, UserActor } from './actor.js'
import { stableDigest } from './crypto.js'
import { CollaborationService } from './service.js'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from './test-fixtures/collaboration-identity.js'

const at = new Date('2026-08-24T08:00:00.000Z')
const now = () => at

async function registeredAgent(
  service: CollaborationService,
  user: UserActor,
  deviceId: string,
  label: string
): Promise<AgentActor> {
  const result = await service.registerAgent(user, {
    deviceId,
    displayName: `${label} Agent`,
    nodeType: 'desktop',
    capabilities: ['research.execute', 'content.read', 'content.write'],
    credentialBootstrapPublicKey: createAgentCredentialBootstrap().publicKey,
    idempotencyKey: `idem_agent_register_${label}`
  })
  return {
    kind: 'agent_device',
    actorKey: `agent:${result.agent.agentId}:test`,
    userId: user.userId,
    agentId: result.agent.agentId,
    deviceId,
    credentialId: `credential_${label}`,
    credentialGeneration: result.agent.credentialGeneration,
    assurance: 'device'
  }
}

function providerFactCommand(
  actor: UserActor,
  deviceId: string,
  principalId: string,
  idempotencyKey: string
): Extract<CloudStateCommand, { type: 'provider_directory_principal.publish' }> {
  return {
    protocolVersion: '1.0',
    type: 'provider_directory_principal.publish',
    requestId: `req_${idempotencyKey.slice(-16).padStart(16, '0')}`,
    idempotencyKey,
    providerPrincipalFactId: null,
    expectedFactRevision: null,
    deviceId,
    expectedDeviceRevision: 1,
    providerPrincipal: {
      schemaVersion: 1,
      type: 'provider_directory_principal_reference',
      providerInstance: {
        schemaVersion: 1,
        type: 'provider_instance_reference',
        authority: 'opencontent.sciforge.test',
        instanceId: 'run0-instance'
      },
      principalKind: 'user',
      principalId
    },
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: 'a'.repeat(64),
    readiness: 'ready',
    readinessReason: null,
    observedAt: at.toISOString()
  }
}

function signProvisioningAttestation(
  factual: Omit<ProjectContentProvisioningAttestation,
    'schemaVersion' | 'type' | 'deviceSignature' | 'revision' | 'createdAt' | 'updatedAt'>,
  key: Readonly<{ privateKey: KeyObject }>,
  deviceId: string,
  deviceKeyId: string,
  deviceKeyRevision: number
): ProjectContentProvisioningAttestation {
  const placeholder: ProjectContentProvisioningAttestation = {
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
  const factualDigest = createHash('sha256')
    .update(canonicalProjectContentProvisioningAttestationFactualPayloadBytes(placeholder))
    .digest('hex')
  const withDigest: ProjectContentProvisioningAttestation = {
    ...placeholder,
    deviceSignature: { ...placeholder.deviceSignature, canonicalPayloadDigest: factualDigest }
  }
  return {
    ...withDigest,
    deviceSignature: {
      ...withDigest.deviceSignature,
      signature: signBytes(
        null,
        canonicalProjectContentProvisioningAttestationSignatureBytes(withDigest),
        key.privateKey
      ).toString('base64url')
    }
  }
}

describe('vNext Cloud application service', () => {
  it('publishes one global exact User/ACTIVE Device Provider fact with CAS', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'owner', at)
    const command = providerFactCommand(
      owner.user,
      owner.deviceId,
      'provider-owner',
      'idem_provider_fact_owner_create'
    )

    const created = await service.publishProviderDirectoryPrincipalFact(owner.user, command)
    expect(created.userId).toBe(owner.userId)
    expect(created.publishedByDeviceId).toBe(owner.deviceId)
    expect(created.revision).toBe(1)

    await expect(service.publishProviderDirectoryPrincipalFact(owner.user, {
      ...command,
      idempotencyKey: 'idem_provider_fact_owner_duplicate_slot'
    })).rejects.toMatchObject({ code: 'revision_conflict' })

    const other = await seedOidcUserDevice(repository, 'other', at)
    await expect(service.publishProviderDirectoryPrincipalFact(owner.user, {
      ...command,
      deviceId: other.deviceId,
      idempotencyKey: 'idem_provider_fact_cross_user_device'
    })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('atomically derives Owner and snapshots exact ready facts into a paused Project', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'owner-project', at)
    const worker = await seedOidcUserDevice(repository, 'worker-project', at)
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'owner-project')
    await registeredAgent(service, worker.user, worker.deviceId, 'worker-project')
    const ownerFact = await service.publishProviderDirectoryPrincipalFact(owner.user, providerFactCommand(
      owner.user,
      owner.deviceId,
      'provider-owner-project',
      'idem_provider_fact_owner_project'
    ))
    const workerFact = await service.publishProviderDirectoryPrincipalFact(worker.user, providerFactCommand(
      worker.user,
      worker.deviceId,
      'provider-worker-project',
      'idem_provider_fact_worker_project'
    ))
    const command: ProjectCreateCommand = {
      protocolVersion: '1.0',
      type: 'project.create',
      requestId: 'req_project_create_001',
      idempotencyKey: 'idem_project_create_vnext',
      displayName: 'Multi-user design review',
      goal: 'Produce reviewed meeting artifacts.',
      coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: {
        maxTasks: 20,
        maxTasksPerRound: 10,
        maxTaskRetries: 2,
        maxCoordinationRounds: 5
      },
      content: {
        mode: 'required',
        contentOwnerUserId: owner.userId,
        providerInstance: ownerFact.providerPrincipal.providerInstance,
        containerDisplayName: 'Multi-user design review',
        members: [
          {
            userId: owner.userId,
            providerPrincipalFactId: ownerFact.providerPrincipalFactId,
            expectedFactRevision: ownerFact.revision
          },
          {
            userId: worker.userId,
            providerPrincipalFactId: workerFact.providerPrincipalFactId,
            expectedFactRevision: workerFact.revision
          }
        ]
      }
    }

    const created = await service.createProject(owner.user, command)
    expect(created.project).toMatchObject({
      ownerUserId: owner.userId,
      coordinatorAgentId: coordinator.agentId,
      status: 'paused',
      contentMode: 'required',
      coordinatorAuthorityEpoch: 1,
      executionAuthorityEpoch: 1
    })
    expect(created.memberships).toHaveLength(2)
    expect(created.memberships.every((membership) => membership.state === 'active')).toBe(true)
    expect(created.provisioningIntent?.desiredMembers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: owner.userId,
        providerPrincipalFactId: ownerFact.providerPrincipalFactId,
        snapshottedFactRevision: ownerFact.revision
      }),
      expect.objectContaining({
        userId: worker.userId,
        providerPrincipalFactId: workerFact.providerPrincipalFactId,
        snapshottedFactRevision: workerFact.revision
      })
    ]))
    expect(await repository.listProjectContentReadiness(created.project.projectId)).toHaveLength(2)
    expect(await repository.listTaskAuthorities(created.project.projectId)).toHaveLength(4)
  })

  it('activates Project Content only after exact journal observations and a current Owner Device signature', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'content-owner', at)
    const worker = await seedOidcUserDevice(repository, 'content-worker', at)
    const signing = generateKeyPairSync('ed25519')
    const publicJwk = signing.publicKey.export({ format: 'jwk' })
    const deviceKeyId = 'content-owner-device-key'
    await repository.transaction(async (tx) => {
      const device = (await tx.getDeviceForUpdate(owner.deviceId))!
      await tx.updateDevice({ ...device,
        publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig',
          kid: deviceKeyId, x: publicJwk.x! },
        revision: device.revision + 1, updatedAt: at.toISOString() }, device.revision)
    })
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'content-owner')
    const ownerFact = await service.publishProviderDirectoryPrincipalFact(owner.user, {
      ...providerFactCommand(owner.user, owner.deviceId, 'content-provider-owner', 'idem_content_owner_fact'),
      expectedDeviceRevision: 2
    })
    const workerFact = await service.publishProviderDirectoryPrincipalFact(worker.user,
      providerFactCommand(worker.user, worker.deviceId, 'content-provider-worker', 'idem_content_worker_fact'))
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_content_project_01',
      idempotencyKey: 'idem_content_project_01', displayName: 'Signed Content meeting',
      goal: 'Verify the exact Provider root and member roster.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'required', contentOwnerUserId: owner.userId,
        providerInstance: ownerFact.providerPrincipal.providerInstance,
        containerDisplayName: 'Signed Content meeting', members: [
          { userId: owner.userId, providerPrincipalFactId: ownerFact.providerPrincipalFactId,
            expectedFactRevision: ownerFact.revision },
          { userId: worker.userId, providerPrincipalFactId: workerFact.providerPrincipalFactId,
            expectedFactRevision: workerFact.revision }
        ] }
    })
    const intent = created.provisioningIntent!
    const requestDigest = 'b'.repeat(64)
    const prepared = await service.prepareExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.prepare', requestId: 'req_content_prepare_01',
      idempotencyKey: 'idem_content_prepare_01', scope: 'project_provisioning',
      projectId: created.project.projectId, taskId: null, executionId: null,
      preparedTaskRevision: null, preparedExecutionRevision: null,
      provisioningIntentId: intent.provisioningIntentId, provisioningRevision: intent.provisioningRevision,
      logicalInvocationId: 'create-content-root-01', operation: 'create_shared_container', requestDigest
    })
    const dispatched = await service.dispatchExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.dispatch', requestId: 'req_content_dispatch_01',
      idempotencyKey: 'idem_content_dispatch_01', journalEntryId: prepared.contentRecoveryJournalEntryId,
      expectedJournalRevision: prepared.revision
    })
    const receiptDigest = 'c'.repeat(64)
    const operationObservationDigest = 'd'.repeat(64)
    const observed = await service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.observe', requestId: 'req_content_observe_01',
      idempotencyKey: 'idem_content_observe_01', journalEntryId: dispatched.contentRecoveryJournalEntryId,
      expectedJournalRevision: dispatched.revision, outcome: 'observed_success',
      receiptDigest, observationDigest: operationObservationDigest, safeFailureCode: null
    })
    expect(observed.provisioningIntent?.state).toBe('awaiting_attestation')
    const rootLocator = { contractVersion: 1 as const, kind: 'content-space.container-reference' as const,
      authority: 'opencontent.sciforge.test', identity: { containerId: 'signed-content-root' } }
    const memberObservations = intent.desiredMembers.map((member, index) => ({
      userId: member.userId, providerPrincipalFactId: member.providerPrincipalFactId,
      snapshottedFactRevision: member.snapshottedFactRevision, principal: member.principal,
      presence: 'present' as const, observationDigest: String(index + 1).repeat(64),
      observedAt: at.toISOString()
    }))
    const attestation = signProvisioningAttestation({
      format: 'sciforge.project-content-provisioning-attestation.v1',
      provisioningAttestationId: 'pca_ContentSigned001', projectId: created.project.projectId,
      provisioningIntentId: intent.provisioningIntentId, provisioningRevision: intent.provisioningRevision,
      ownerUserId: owner.userId, principalIdentityRevision: ownerFact.principalIdentityRevision,
      providerBindingAttestationDigest: ownerFact.providerBindingAttestationDigest,
      providerInstance: ownerFact.providerPrincipal.providerInstance,
      rootLocator, rootLocatorDigest: stableDigest(rootLocator),
      observedOperations: [{ operationId: prepared.logicalInvocationId,
        operationRevision: observed.journal.revision, kind: 'create_shared_container', subjectPrincipal: null,
        requestDigest, receiptDigest, outcome: 'observed_success', safeFailureCode: null,
        observedAt: at.toISOString() }],
      memberObservations,
      memberSetDigest: createHash('sha256').update(canonicalProvisionedMemberSetBytes(memberObservations)).digest('hex'),
      observationStartedAt: at.toISOString(), observationCompletedAt: at.toISOString()
    }, signing, owner.deviceId, deviceKeyId, 2)
    const activated = await service.attestProjectContent(owner.user, {
      protocolVersion: '1.0', type: 'project.content.attest', requestId: 'req_content_attest_01',
      idempotencyKey: 'idem_content_attest_01', projectId: created.project.projectId,
      expectedProjectRevision: created.project.revision,
      expectedProvisioningRevision: intent.provisioningRevision,
      attestation
    })
    expect(activated.binding).toMatchObject({ status: 'active', rootLocatorDigest: stableDigest(rootLocator) })
    expect(activated.readiness).toHaveLength(2)
    expect(activated.readiness.every(({ state }) => state === 'ready')).toBe(true)

    const workerMembership = created.memberships.find(({ userId }) => userId === worker.userId)!
    const removal = await service.removeProjectMembership(owner.user, {
      protocolVersion: '1.0', type: 'project.membership.remove', requestId: 'req_content_remove_01',
      idempotencyKey: 'idem_content_remove_01', projectId: created.project.projectId,
      projectMembershipId: workerMembership.projectMembershipId,
      expectedProjectRevision: activated.project.revision,
      expectedMembershipRevision: workerMembership.revision
    })
    expect(removal.membership.state).toBe('membership_removal_pending')
    const pendingRead = await service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_pending_read',
      projectId: created.project.projectId,
      collections: [{ collection: 'memberships', limit: 1 }]
    })
    expect(pendingRead).toMatchObject({ project: { projectId: created.project.projectId },
      pages: [{ collection: 'memberships', items: [expect.any(Object)], nextCursor: expect.any(String) }] })
    const membershipCursor = pendingRead.pages[0]!.nextCursor
    if (membershipCursor === undefined) throw new Error('The first Membership page must have a continuation.')
    await expect(service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_pending_next',
      projectId: created.project.projectId,
      collections: [{ collection: 'memberships', cursor: membershipCursor, limit: 1 }]
    })).resolves.toMatchObject({ pages: [{ collection: 'memberships', cursor: membershipCursor,
      items: [expect.any(Object)] }] })
    await expect(service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_wrong_cursor',
      projectId: created.project.projectId,
      collections: [{ collection: 'task_authorities', cursor: membershipCursor, limit: 1 }]
    })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(service.listProjects(worker.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_content_pending_list', limit: 10
    })).resolves.toMatchObject({ projects: [{ projectId: created.project.projectId }] })
    const removalIntent = removal.provisioningIntent!
    const removalRequestDigest = 'e'.repeat(64)
    const removalPrepared = await service.prepareExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.prepare', requestId: 'req_content_remove_prepare',
      idempotencyKey: 'idem_content_remove_prepare', scope: 'project_membership',
      projectId: created.project.projectId, taskId: null, executionId: null,
      preparedTaskRevision: null, preparedExecutionRevision: null,
      provisioningIntentId: removalIntent.provisioningIntentId,
      provisioningRevision: removalIntent.provisioningRevision,
      logicalInvocationId: 'remove-content-worker-01', operation: 'remove_member',
      requestDigest: removalRequestDigest
    })
    const removalDispatched = await service.dispatchExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.dispatch', requestId: 'req_content_remove_dispatch',
      idempotencyKey: 'idem_content_remove_dispatch',
      journalEntryId: removalPrepared.contentRecoveryJournalEntryId,
      expectedJournalRevision: removalPrepared.revision
    })
    const removalReceiptDigest = 'f'.repeat(64)
    const removalOperationDigest = 'a'.repeat(64)
    const removalObserved = await service.observeExternalOperation(owner.user, {
      protocolVersion: '1.0', type: 'external_operation.observe', requestId: 'req_content_remove_observe',
      idempotencyKey: 'idem_content_remove_observe',
      journalEntryId: removalDispatched.contentRecoveryJournalEntryId,
      expectedJournalRevision: removalDispatched.revision, outcome: 'observed_success',
      receiptDigest: removalReceiptDigest, observationDigest: removalOperationDigest,
      safeFailureCode: null
    })
    const removalMembers = [
      { userId: owner.userId, providerPrincipalFactId: ownerFact.providerPrincipalFactId,
        snapshottedFactRevision: ownerFact.revision, principal: ownerFact.providerPrincipal,
        presence: 'present' as const, observationDigest: 'b'.repeat(64), observedAt: at.toISOString() },
      { userId: worker.userId, providerPrincipalFactId: workerFact.providerPrincipalFactId,
        snapshottedFactRevision: workerFact.revision, principal: workerFact.providerPrincipal,
        presence: 'absent' as const, observationDigest: 'c'.repeat(64), observedAt: at.toISOString() }
    ]
    const removalAttestation = signProvisioningAttestation({
      format: 'sciforge.project-content-provisioning-attestation.v1',
      provisioningAttestationId: 'pca_ContentRemoval01', projectId: created.project.projectId,
      provisioningIntentId: removalIntent.provisioningIntentId,
      provisioningRevision: removalIntent.provisioningRevision,
      ownerUserId: owner.userId, principalIdentityRevision: ownerFact.principalIdentityRevision,
      providerBindingAttestationDigest: ownerFact.providerBindingAttestationDigest,
      providerInstance: ownerFact.providerPrincipal.providerInstance,
      rootLocator, rootLocatorDigest: stableDigest(rootLocator),
      observedOperations: [{ operationId: removalPrepared.logicalInvocationId,
        operationRevision: removalObserved.journal.revision, kind: 'remove_member',
        subjectPrincipal: workerFact.providerPrincipal, requestDigest: removalRequestDigest,
        receiptDigest: removalReceiptDigest, outcome: 'observed_success', safeFailureCode: null,
        observedAt: at.toISOString() }],
      memberObservations: removalMembers,
      memberSetDigest: createHash('sha256').update(canonicalProvisionedMemberSetBytes(removalMembers)).digest('hex'),
      observationStartedAt: at.toISOString(), observationCompletedAt: at.toISOString()
    }, signing, owner.deviceId, deviceKeyId, 2)
    const removed = await service.attestProjectContent(owner.user, {
      protocolVersion: '1.0', type: 'project.content.attest', requestId: 'req_content_remove_attest',
      idempotencyKey: 'idem_content_remove_attest', projectId: created.project.projectId,
      expectedProjectRevision: removal.project.revision,
      expectedProvisioningRevision: removalIntent.provisioningRevision,
      attestation: removalAttestation
    })
    expect(removed.binding.status).toBe('active')
    expect(removed.memberships).toEqual([
      expect.objectContaining({ userId: worker.userId, state: 'removed' })
    ])
    await expect(service.readProjectCoordination(worker.user, {
      protocolVersion: '1.0', type: 'project.coordination.read', requestId: 'req_content_removed_read',
      projectId: created.project.projectId,
      collections: [{ collection: 'memberships', limit: 10 }]
    })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(service.listProjects(worker.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_content_removed_list', limit: 10
    })).resolves.toMatchObject({ projects: [] })
  })

  it('adds and safely removes dynamic content-free Membership without a Provider ACL saga', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'membership-owner', at)
    const originalWorker = await seedOidcUserDevice(repository, 'membership-original-worker', at)
    const addedWorker = await seedOidcUserDevice(repository, 'membership-added-worker', at)
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'membership-owner')
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_membership_project_01',
      idempotencyKey: 'idem_membership_project_01', displayName: 'Dynamic meeting team',
      goal: 'Exercise User-level membership authority.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'none', members: [{ userId: owner.userId }, { userId: originalWorker.userId }] }
    })
    const added = await service.addProjectMembership(owner.user, {
      protocolVersion: '1.0', type: 'project.membership.add', requestId: 'req_membership_add_01',
      idempotencyKey: 'idem_membership_add_01', projectId: created.project.projectId,
      expectedProjectRevision: created.project.revision, userId: addedWorker.userId,
      providerPrincipalFactId: null, expectedProviderPrincipalFactRevision: null
    })
    expect(added).toMatchObject({ membership: { userId: addedWorker.userId, state: 'active' },
      contentReadiness: null, provisioningIntent: null })
    expect(added.taskAuthorities).toHaveLength(2)
    const removed = await service.removeProjectMembership(owner.user, {
      protocolVersion: '1.0', type: 'project.membership.remove', requestId: 'req_membership_remove_01',
      idempotencyKey: 'idem_membership_remove_01', projectId: created.project.projectId,
      projectMembershipId: added.membership.projectMembershipId,
      expectedProjectRevision: added.project.revision,
      expectedMembershipRevision: added.membership.revision
    })
    expect(removed.membership).toMatchObject({ state: 'removed', removedAt: at.toISOString() })
    expect(removed.taskAuthorities.every(({ state, reason }) =>
      state === 'fenced' && reason === 'membership_removed')).toBe(true)
    expect(removed.provisioningIntent).toBeNull()

    const secondProject = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_membership_project_02',
      idempotencyKey: 'idem_membership_project_02', displayName: 'Second dynamic meeting',
      goal: 'Exercise an actor-bound Project list continuation.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'none', members: [{ userId: owner.userId }] }
    })
    const firstPage = await service.listProjects(owner.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_membership_project_page_1', limit: 1
    })
    expect(firstPage.projects).toHaveLength(1)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    const secondPage = await service.listProjects(owner.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_membership_project_page_2',
      cursor: firstPage.nextCursor!, limit: 1
    })
    expect(new Set([...firstPage.projects, ...secondPage.projects].map(({ projectId }) => projectId))).toEqual(
      new Set([created.project.projectId, secondProject.project.projectId])
    )
    expect(secondPage.observedAt).toBe(firstPage.observedAt)
    await expect(service.listProjects(originalWorker.user, {
      protocolVersion: '1.0', type: 'project.list', requestId: 'req_membership_project_wrong_actor',
      cursor: firstPage.nextCursor!, limit: 1
    })).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('keeps Worker HumanNeeded execution-bound and runs review before Coordinator decision/completion', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'meeting-owner', at)
    const worker = await seedOidcUserDevice(repository, 'meeting-worker', at)
    const endpointChallenge = await service.createEndpointChallenge(owner.user, {
      provider: 'zulip', realmId: 'realm-meeting', expectedProviderUserId: 'owner-zulip-user',
      idempotencyKey: 'idem_meeting_owner_endpoint_challenge'
    })
    await service.verifyEndpointChallengeFromProvider({
      provider: 'zulip', realmId: 'realm-meeting', providerUserId: 'owner-zulip-user',
      providerDisplayName: 'Meeting Owner', challengeCode: String(endpointChallenge.challengeCode),
      providerEventId: 'provider-event-meeting-owner-verify', assurance: 'verified'
    })
    const verifiedChallenge = await service.getEndpointChallenge(owner.user, String(endpointChallenge.challengeId))
    const ownerEndpointId = String(verifiedChallenge.humanEndpointId)
    const ownerEndpoint: HumanEndpointActor = {
      kind: 'human_endpoint', actorKey: `endpoint:${ownerEndpointId}:test`, userId: owner.userId,
      humanEndpointId: ownerEndpointId, assurance: 'verified'
    }
    const projectLocator = {
      type: 'provider_locator' as const, provider: 'zulip', realmId: 'realm-meeting',
      containerId: 'stream-meeting', topicId: 'topic-meeting', topicDisplayName: 'Meeting decisions'
    }
    const coordinator = await registeredAgent(service, owner.user, owner.deviceId, 'meeting-owner')
    const workerAgent = await registeredAgent(service, worker.user, worker.deviceId, 'meeting-worker')
    const availability = await service.publishWorkerAvailability(workerAgent, {
      protocolVersion: '1.0', type: 'worker.availability.publish', requestId: 'req_worker_available_01',
      idempotencyKey: 'idem_worker_available_01', agentId: workerAgent.agentId,
      expectedAgentRevision: 1, connectionStatus: 'online', lastHeartbeatAt: at.toISOString(),
      runtimeReadiness: 'ready', runtimeCapabilityTags: ['research.execute'], acceptsNewOffers: true,
      activeTaskCount: 0, observedAt: at.toISOString()
    })
    const created = await service.createProject(owner.user, {
      protocolVersion: '1.0', type: 'project.create', requestId: 'req_text_project_001',
      idempotencyKey: 'idem_text_project_001', displayName: 'Meeting synthesis',
      goal: 'Synthesize and approve meeting decisions.', coordinatorAgentId: coordinator.agentId,
      expectedCoordinatorAgentRevision: 1,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'none', members: [{ userId: owner.userId }, { userId: worker.userId }] }
    })
    await service.bindProjectEndpoint(owner.user, {
      projectId: created.project.projectId, locator: projectLocator, expectedRevision: null,
      idempotencyKey: 'idem_meeting_project_endpoint_bind'
    })
    expect(await repository.listProjectContentReadiness(created.project.projectId)).toEqual([])

    const runtimeProvenance = { runtimeId: 'runtime_meeting_coordinator', modelId: null,
      generatedByCoordinatorAgentId: coordinator.agentId, generatedAt: at.toISOString() }
    const tasks = [{ planItemId: 'item_meeting_summary', title: 'Summarize decisions',
      objective: 'Produce a bounded meeting decision summary.', completionCriteria: ['Owner can review it'],
      dependencyPlanItemIds: [], requiredCapabilityTags: ['research.execute'], fileIntent: null }]
    const planFacts = { projectId: created.project.projectId, expectedProjectRevision: 1,
      expectedCoordinatorAuthorityEpoch: 1, supersedesProjectPlanId: null,
      sourceInputLocators: [], tasks, rationale: 'One Worker can synthesize the meeting.', runtimeProvenance }
    const submittedPlan = await service.submitProjectPlan(coordinator, {
      protocolVersion: '1.0', type: 'project.plan.submit', requestId: 'req_plan_submit_001',
      idempotencyKey: 'idem_plan_submit_001', ...planFacts, planDigest: stableDigest(planFacts)
    })
    const confirmedPlan = await service.confirmProjectPlan(owner.user, {
      protocolVersion: '1.0', type: 'project.plan.confirm', requestId: 'req_plan_confirm_001',
      idempotencyKey: 'idem_plan_confirm_001', projectId: created.project.projectId,
      projectPlanId: submittedPlan.projectPlanId, expectedProjectRevision: 2,
      expectedCoordinatorAuthorityEpoch: 1, expectedPlanRevision: submittedPlan.revision,
      planDigest: submittedPlan.planDigest
    })
    const activeProject = await service.transitionProject(owner.user, {
      protocolVersion: '1.0', type: 'project.transition', requestId: 'req_project_active_001',
      idempotencyKey: 'idem_project_active_001', projectId: created.project.projectId,
      expectedRevision: 3, expectedCoordinatorAuthorityEpoch: 1,
      expectedExecutionAuthorityEpoch: 1, status: 'active'
    })
    const offered = await service.createTaskOffer(coordinator, {
      protocolVersion: '1.0', type: 'task.offer.create', requestId: 'req_offer_create_001',
      idempotencyKey: 'idem_offer_create_001', projectId: activeProject.projectId,
      expectedProjectRevision: activeProject.revision, expectedCoordinatorAuthorityEpoch: 1,
      expectedExecutionAuthorityEpoch: 1, projectPlanId: confirmedPlan.projectPlanId,
      expectedPlanRevision: confirmedPlan.revision, planItemId: 'item_meeting_summary',
      assigneeAgentId: workerAgent.agentId, expectedAvailabilityRevision: availability.revision,
      offerExpiresAt: new Date(at.getTime() + 60_000).toISOString()
    })
    const accepted = await service.acceptTaskOffer(workerAgent, {
      protocolVersion: '1.0', type: 'task.offer.accept', requestId: 'req_offer_accept_001',
      idempotencyKey: 'idem_offer_accept_001', taskOfferId: offered.offer.taskOfferId,
      taskId: offered.task.taskId, executionId: offered.execution.executionId,
      expectedTaskRevision: offered.task.revision, expectedExecutionRevision: offered.execution.revision,
      expectedOfferRevision: offered.offer.revision
    })
    expect((await service.getTaskExecutionPreflight(workerAgent, {
      protocolVersion: '1.0', type: 'task.execution.preflight.get', requestId: 'req_preflight_001',
      taskId: accepted.task.taskId, executionId: accepted.execution.executionId,
      expectedTaskRevision: accepted.task.revision, expectedExecutionRevision: accepted.execution.revision
    })).decision).toEqual({ outcome: 'allowed', reasons: [] })
    const running = await service.startTaskExecution(workerAgent, {
      protocolVersion: '1.0', type: 'task.execution.start', requestId: 'req_execution_start_001',
      idempotencyKey: 'idem_execution_start_001', taskId: accepted.task.taskId,
      executionId: accepted.execution.executionId, expectedTaskRevision: accepted.task.revision,
      expectedExecutionRevision: accepted.execution.revision, startedAt: at.toISOString()
    })
    const workerRequest = await service.createHumanNeeded(workerAgent, {
      protocolVersion: '1.0', type: 'human.needed.create', requestId: 'req_worker_human_needed_1',
      idempotencyKey: 'idem_worker_human_needed_1', projectId: activeProject.projectId,
      context: {
        scope: 'worker_execution', taskId: running.task.taskId, executionId: running.execution.executionId,
        expectedTaskRevision: running.task.revision, expectedExecutionRevision: running.execution.revision
      },
      requiredAssurance: 'verified', prompt: 'Confirm the ambiguous input interpretation.',
      confirmableAction: null, expiresAt: new Date(at.getTime() + 60_000).toISOString()
    })
    expect(workerRequest.context).toEqual({
      scope: 'worker_execution', taskId: running.task.taskId, executionId: running.execution.executionId
    })
    const workerAnswer = await service.answerHumanNeeded(owner.user, {
      protocolVersion: '1.0', type: 'human.answer', requestId: 'req_worker_human_answer_1',
      idempotencyKey: 'idem_worker_human_answer_1', humanRequestId: workerRequest.humanRequestId,
      requestRevision: workerRequest.revision, answer: 'Interpret it using the frozen baseline.'
    })
    expect(workerAnswer.context).toEqual(workerRequest.context)
    const resumedTask = (await repository.getTask(running.task.taskId))!
    const resumedExecution = (await repository.getTaskExecution(running.execution.executionId))!
    expect(resumedTask.status).toBe('in_progress')
    expect(resumedExecution.state).toBe('running')
    const resultFacts = { taskId: running.task.taskId, executionId: running.execution.executionId,
      expectedTaskRevision: resumedTask.revision, expectedExecutionRevision: resumedExecution.revision,
      summary: 'The meeting froze one Coordinator Agent and dynamic Worker membership.',
      runtimeProvenance: { runtimeId: 'runtime_meeting_worker', modelId: null,
        startedAt: at.toISOString(), completedAt: at.toISOString() }, outputs: [], recoveryJournalEntryIds: [] }
    const result = await service.submitTaskResult(workerAgent, {
      protocolVersion: '1.0', type: 'task.result.submit', requestId: 'req_result_submit_001',
      idempotencyKey: 'idem_result_submit_001', ...resultFacts, submissionDigest: stableDigest(resultFacts)
    })
    const reviewCommand = {
      protocolVersion: '1.0', type: 'task.result.review', requestId: 'req_result_review_001',
      idempotencyKey: 'idem_result_review_001', projectId: activeProject.projectId,
      taskId: result.task.taskId, executionId: result.execution.executionId,
      resultSubmissionId: result.submission.resultSubmissionId,
      expectedProjectRevision: (await repository.getProject(activeProject.projectId))!.revision,
      expectedTaskRevision: result.task.revision, expectedExecutionRevision: result.execution.revision,
      expectedResultRevision: result.submission.revision, expectedCoordinatorAuthorityEpoch: 1,
      decision: 'accept', instruction: null, nextAssigneeAgentId: null,
      expectedNextAssigneeAvailabilityRevision: null, nextOfferExpiresAt: null, nextFileIntent: null
    } satisfies Extract<CloudStateCommand, { type: 'task.result.review' }>
    await expect(service.reviewTaskResult(workerAgent, {
      ...reviewCommand,
      idempotencyKey: 'idem_result_review_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const reviewed = await service.reviewTaskResult(coordinator, reviewCommand)
    expect(reviewed).toMatchObject({ task: { status: 'completed' },
      execution: { state: 'completed', fence: { status: 'fenced', reason: 'completed' } },
      review: { decision: 'accept', decidedByUserId: owner.userId,
        decidedByCoordinatorAgentId: coordinator.agentId } })
    const observation = await repository.getProjectRecord(reviewed.review.acceptedProjectRecordId!)
    expect(observation).toMatchObject({
      kind: 'observation',
      status: 'accepted',
      authorAgentId: coordinator.agentId,
      sourceTaskId: result.task.taskId,
      sourceResultSubmissionId: result.submission.resultSubmissionId,
      sourceHumanAnswerId: undefined
    })
    const projectAfterReview = (await repository.getProject(activeProject.projectId))!
    const coordinatorRequestCommand = {
      protocolVersion: '1.0', type: 'human.needed.create', requestId: 'req_human_needed_001',
      idempotencyKey: 'idem_human_needed_001', projectId: activeProject.projectId,
      context: {
        scope: 'coordinator_project', expectedProjectRevision: projectAfterReview.revision,
        expectedCoordinatorAuthorityEpoch: projectAfterReview.coordinatorAuthorityEpoch
      },
      requiredAssurance: 'verified', prompt: 'Which confirmed decision should lead the summary?',
      confirmableAction: null, expiresAt: new Date(at.getTime() + 60_000).toISOString()
    } satisfies Extract<import('@sciforge/collaboration-contracts').RestRequest, { type: 'human.needed.create' }>
    await expect(service.createHumanNeeded(workerAgent, {
      ...coordinatorRequestCommand,
      idempotencyKey: 'idem_human_needed_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const humanRequest = await service.createHumanNeeded(coordinator, coordinatorRequestCommand)
    expect(humanRequest.context).toEqual({ scope: 'coordinator_project', coordinatorAuthorityEpoch: 1 })
    const humanAnswer = await service.answerHumanNeeded(ownerEndpoint, {
      protocolVersion: '1.0', type: 'human.answer', requestId: 'req_human_answer_001',
      idempotencyKey: 'idem_human_answer_001', humanRequestId: humanRequest.humanRequestId,
      requestRevision: humanRequest.revision, answer: 'Lead with the frozen role boundary.',
      sourceLocator: projectLocator
    })
    expect(humanAnswer.context).toEqual({ scope: 'coordinator_project', coordinatorAuthorityEpoch: 1 })
    expect(humanAnswer.answeredFrom).toEqual({ type: 'human_endpoint', humanEndpointId: ownerEndpointId })
    const coordinatorInbox = await service.pullInbox(coordinator, { afterSequence: 0, limit: 200 })
    expect(coordinatorInbox.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageType: 'human.answer.received',
        payload: expect.objectContaining({
          answer: expect.objectContaining({ humanAnswerId: humanAnswer.humanAnswerId })
        })
      })
    ]))
    const decisionCommand = {
      protocolVersion: '1.0', type: 'project.decision.submit', requestId: 'req_project_decision_001',
      idempotencyKey: 'idem_project_decision_001', projectId: activeProject.projectId,
      humanRequestId: humanRequest.humanRequestId, humanAnswerId: humanAnswer.humanAnswerId,
      expectedProjectRevision: projectAfterReview.revision, expectedCoordinatorAuthorityEpoch: 1,
      expectedHumanRequestRevision: humanRequest.revision + 1,
      expectedHumanAnswerRevision: humanAnswer.revision,
      decision: 'The frozen Coordinator boundary will lead the meeting summary.'
    } satisfies Extract<CloudStateCommand, { type: 'project.decision.submit' }>
    await expect(service.submitProjectDecision(workerAgent, {
      ...decisionCommand,
      idempotencyKey: 'idem_project_decision_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const decision = await service.submitProjectDecision(coordinator, decisionCommand)
    expect(decision.record).toMatchObject({
      kind: 'decision',
      status: 'accepted',
      authorAgentId: coordinator.agentId,
      sourceTaskId: undefined,
      sourceHumanAnswerId: humanAnswer.humanAnswerId,
      sourceResultSubmissionId: undefined
    })
    await expect(service.submitProjectDecision(coordinator, {
      ...decisionCommand,
      idempotencyKey: 'idem_project_decision_duplicate_answer',
      expectedProjectRevision: decision.project.revision
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    const finalSummaryCommand = {
      protocolVersion: '1.0', type: 'project.final_summary.submit', requestId: 'req_final_summary_001',
      idempotencyKey: 'idem_final_summary_001', projectId: activeProject.projectId,
      expectedProjectRevision: decision.project.revision, expectedCoordinatorAuthorityEpoch: 1,
      expectedExecutionAuthorityEpoch: 1, projectPlanId: confirmedPlan.projectPlanId,
      confirmedPlanRevision: confirmedPlan.revision,
      acceptedResultSubmissionIds: [result.submission.resultSubmissionId],
      summary: 'The meeting completed with a confirmed plan, Human answer, and accepted Worker result.'
    } satisfies Extract<CloudStateCommand, { type: 'project.final_summary.submit' }>
    await expect(service.submitProjectFinalSummary(workerAgent, {
      ...finalSummaryCommand,
      idempotencyKey: 'idem_final_summary_worker_bypass'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    const final = await service.submitProjectFinalSummary(coordinator, finalSummaryCommand)
    expect(final).toMatchObject({ project: { status: 'completed', executionAuthorityEpoch: 2 },
      finalSummary: { createdByUserId: owner.userId,
        acceptedResultSubmissionIds: [result.submission.resultSubmissionId] } })
    expect(final.record).toMatchObject({
      kind: 'summary',
      status: 'accepted',
      authorAgentId: coordinator.agentId,
      sourceResultSubmissionId: undefined,
      sourceHumanAnswerId: undefined
    })
    expect(final.record.sourceTaskId).toBeUndefined()
    expect((await repository.listProjectRecords(activeProject.projectId, true)).map((record) => record.kind))
      .toEqual(['observation', 'decision', 'summary'])
  })
})
