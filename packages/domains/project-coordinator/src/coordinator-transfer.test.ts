import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentInboxMessageSchema,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  projectFixture
} from '@sciforge/collaboration-contracts/testing'
import type { CoordinatorCloudCommandService } from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import { projectCoordinatorWorkspaceSchema } from './contract.js'
import {
  createProjectCoordinatorActionPort,
  defineProjectCoordinatorWorkspacePort
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

test('Owner transfer derives every Cloud CAS fact from the exact fresh Owner Agent projection', async () => {
  let transferred = false
  const commands: RestRequest[] = []
  const current = transferWorkspace(false)
  const updated = transferWorkspace(true)
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: projectFixture.ownerUserId,
      deviceId: TEST_IDS.deviceId
    }),
    execute: async ({ payload }) => {
      const command = payload as RestRequest
      commands.push(command)
      if (command.type !== 'project.transfer_coordinator') {
        throw new Error(`Unexpected ${command.type}.`)
      }
      transferred = true
      return {
        contractVersion: 1,
        status: 200,
        body: entityResponse(command.requestId, updated.projects[0]!.project)
      }
    }
  }
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => transferred ? updated : current
    }),
    coordinatorCloudCommands: unusedCoordinatorCommands(),
    transport,
    state: new ProjectCoordinatorStateStore(memorySettings()),
    requestId: () => 'req_CoordinatorTransfer01'
  })

  await assert.rejects(port.transferCoordinator({
    projectId: TEST_IDS.projectId,
    coordinatorAgentId: 'agt_MemberAgent001'
  }, 'idem_CoordinatorTransferMember'), /Project Owner/u)
  assert.equal(commands.length, 0)

  const result = await port.transferCoordinator({
    projectId: TEST_IDS.projectId,
    coordinatorAgentId: TEST_IDS.secondAgentId
  }, 'idem_CoordinatorTransferOwner')

  assert.equal(result.projects[0]?.project.coordinatorAgentId, TEST_IDS.secondAgentId)
  assert.deepEqual(commands, [{
    protocolVersion: '1.0',
    requestId: 'req_CoordinatorTransfer01',
    type: 'project.transfer_coordinator',
    idempotencyKey: 'idem_CoordinatorTransferOwner',
    projectId: TEST_IDS.projectId,
    expectedRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    coordinatorAgentId: TEST_IDS.secondAgentId,
    expectedCoordinatorAvailabilityRevision: 7
  }])
})

test('durable Coordinator transfer Inbox records explicit old-authority fencing feedback across restart', async () => {
  const settings = memorySettings()
  const state = new ProjectCoordinatorStateStore(settings)
  const workspace = transferWorkspace(true)
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: unusedCoordinatorCommands(),
    transport: unusedTransport(),
    state,
    requestId: () => 'req_CoordinatorTransferInbox'
  })
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: TEST_IDS.agentId,
    payload: {
      protocolVersion: '1.0',
      type: 'coordinator.transferred',
      projectId: TEST_IDS.projectId,
      previousCoordinatorAgentId: TEST_IDS.agentId,
      coordinatorAgentId: TEST_IDS.secondAgentId,
      coordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch + 1,
      revision: projectFixture.revision + 1
    }
  })

  await port.handleInbox(message)
  await port.handleInbox(message)

  const restartedState = new ProjectCoordinatorStateStore(settings)
  assert.deepEqual(await restartedState.readCoordinatorTransferFeedback(TEST_IDS.projectId), {
    projectId: TEST_IDS.projectId,
    inboxMessageId: message.inboxMessageId,
    recipientAgentId: TEST_IDS.agentId,
    previousCoordinatorAgentId: TEST_IDS.agentId,
    coordinatorAgentId: TEST_IDS.secondAgentId,
    coordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch + 1,
    projectRevision: projectFixture.revision + 1,
    disposition: 'authority_transferred_out',
    observedAt: message.createdAt
  })
})

function transferWorkspace(transferred: boolean) {
  const project = transferred
    ? {
        ...projectFixture,
        coordinatorAgentId: TEST_IDS.secondAgentId,
        coordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch + 1,
        revision: projectFixture.revision + 1,
        updatedAt: TEST_LATER_TIMESTAMP
      }
    : projectFixture
  return projectCoordinatorWorkspaceSchema.parse({
    connection: {
      state: 'ready',
      userId: projectFixture.ownerUserId,
      deviceId: TEST_IDS.deviceId
    },
    observedAt: TEST_TIMESTAMP,
    focusedProjectId: TEST_IDS.projectId,
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: [{
      project,
      plan: null,
      memberUsers: [],
      workerGroups: [
        workerGroup(projectFixture.ownerUserId, TEST_IDS.secondAgentId, 7),
        workerGroup(TEST_IDS.secondUserId, 'agt_MemberAgent001', 9)
      ],
      tasks: [],
      offers: [],
      reviews: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        memberships: [],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }]
  })
}

function workerGroup(userId: string, agentId: string, revision: number) {
  return {
    userId,
    displayName: userId === projectFixture.ownerUserId ? 'Project Owner' : 'Project Member',
    agents: [{
      displayName: userId === projectFixture.ownerUserId ? 'Owner Desktop B' : 'Member Desktop',
      projectAvailability: {
        schemaVersion: 1 as const,
        type: 'project_worker_availability_view' as const,
        projectId: TEST_IDS.projectId,
        userId,
        agentId,
        revision,
        availability: {
          schemaVersion: 1 as const,
          type: 'worker_availability_projection' as const,
          userId,
          agentId,
          deviceId: userId === projectFixture.ownerUserId
            ? 'dev_OwnerDevice002'
            : 'dev_MemberDevice01',
          agentActive: true,
          deviceActive: true,
          connectionStatus: 'online' as const,
          lastHeartbeatAt: TEST_TIMESTAMP,
          runtimeReadiness: 'ready' as const,
          runtimeCapabilityTags: ['research.execute'],
          acceptsNewOffers: true,
          activeTaskCount: 0,
          observedAt: TEST_TIMESTAMP,
          expiresAt: TEST_LATER_TIMESTAMP,
          revision,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP
        },
        membership: {
          schemaVersion: 1 as const,
          type: 'project_membership' as const,
          projectMembershipId: userId === projectFixture.ownerUserId
            ? 'pmb_OwnerMember001'
            : 'pmb_OtherMember001',
          projectId: TEST_IDS.projectId,
          userId,
          state: 'active' as const,
          authorityEpoch: 1,
          activatedAt: TEST_TIMESTAMP,
          removalRequestedAt: null,
          removalRequestedByUserId: null,
          removedAt: null,
          revision: 1,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP
        },
        taskAuthorities: [],
        providerPrincipalFact: null,
        providerPrincipalSnapshotStatus: 'not_applicable' as const,
        contentReadiness: null,
        observedAt: TEST_TIMESTAMP
      }
    }]
  }
}

function entityResponse(requestId: string, entity: unknown): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId,
    entity
  } as RestResponse
}

function memorySettings(): DomainMainPackageSettingsHost {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
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

function unusedCoordinatorCommands(): CoordinatorCloudCommandService {
  return {
    execute: async () => { throw new Error('Transfer must use the OIDC Owner transport.') },
    subscribe: () => () => undefined
  }
}

function unusedTransport(): AuthenticatedCloudTransport {
  return {
    status: () => ({ state: 'unavailable', reason: 'unused' }),
    execute: async () => { throw new Error('unused') }
  }
}
