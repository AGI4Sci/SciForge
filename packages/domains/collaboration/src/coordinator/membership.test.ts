import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCollaborationError,
  projectPlanSchema,
  projectRequirementsDocumentSchema
} from '@sciforge/collaboration-contracts'
import {
  projectFixture,
  TEST_IDS,
  TEST_TIMESTAMP,
  TEST_HASH
} from '@sciforge/collaboration-contracts/testing'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { projectCoordinatorWorkspaceSchema } from './contract.js'
import { createProjectCoordinatorMembershipPort } from './membership.js'

function setup(
  execute: AuthenticatedCloudTransport['execute'] = async () => {
    throw new Error('Launch uses the existing plan activation port.')
  }
) {
  let projectRevision = 1
  let principal = TEST_IDS.userId as string
  let invitation = false
  let activations = 0
  const workspace = () => projectCoordinatorWorkspaceSchema.parse({
    connection: { state: 'ready', userId: principal, deviceId: TEST_IDS.deviceId }, observedAt: TEST_TIMESTAMP,
    availableWorkerUsers: [], projects: [{ project: { ...projectFixture, ownerUserId: TEST_IDS.userId,
      status: 'paused', revision: projectRevision }, coordinatorTransferFeedback: null,
    plan: { plan: projectPlanSchema.parse({ schemaVersion: 1, revision: 1,
      createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP, type: 'project_plan', projectPlanId: TEST_IDS.projectPlanId,
      projectId: TEST_IDS.projectId, state: 'confirmed', planRevision: 1, sourceInputLocators: [],
      tasks: [{ planItemId: 'item_analysis', title: 'Analysis', objective: 'Review evidence', completionCriteria: ['Reviewed'],
        dependencyPlanItemIds: [], requiredCapabilityTags: [], workerUserId: TEST_IDS.secondUserId, fileIntent: null }],
      rationale: 'Bounded analysis', runtimeProvenance: { runtimeId: 'codex', modelId: null,
        generatedByCoordinatorAgentId: TEST_IDS.agentId, generatedAt: TEST_TIMESTAMP }, planDigest: TEST_HASH,
      submittedAt: TEST_TIMESTAMP, confirmedByUserId: TEST_IDS.userId, confirmedAt: TEST_TIMESTAMP, supersededAt: null }) },
    memberUsers: [], workerGroups: [], tasks: [], offers: [], deliveryDrive: null, records: [], pendingHumanNeeded: [], finalSummary: null,
    memberships: invitation ? [{ schemaVersion: 1, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
      type: 'project_membership', projectMembershipId: TEST_IDS.projectMembershipId, projectId: TEST_IDS.projectId,
      userId: TEST_IDS.secondUserId, state: 'invited', invitedAt: TEST_TIMESTAMP, acceptedAt: null, removedAt: null }] : [] }]
  })
  const transport: AuthenticatedCloudTransport = {
    status: () => ({ state: 'ready', baseUrl: 'https://cloud.test', userId: principal, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
    stageObject: async () => { throw new Error('No staging in Project launch.') },
    readObject: async () => { throw new Error('No byte transfer in Project launch.') },
    execute
  }
  const port = createProjectCoordinatorMembershipPort({ workspace: { readWorkspace: async () => workspace() }, transport })
  return { port, stale: () => { projectRevision++ }, notOwner: () => { principal = TEST_IDS.secondUserId },
    pending: () => { invitation = true }, activations: () => activations }
}

test('membership add preserves the typed Cloud rejection', async () => {
  const { port } = setup(async (request) => ({
    contractVersion: 1,
    status: 409,
    body: {
      protocolVersion: '1.0', type: 'rest.error', requestId: request.payload.requestId,
      error: createCollaborationError(
        'invalid_state_transition',
        'The Project is no longer writable.'
      )
    }
  }))
  await assert.rejects(port.addMember({
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 1,
    userId: TEST_IDS.secondUserId
  }, 'idem_workflow_membership_add_draft'),
  /SciForge Cloud request failed: invalid_state_transition: The Project is no longer writable/u)
})

test('accepting a confirmed-requirements invitation does not dispatch from the Worker desktop', async () => {
  let executeCalls = 0
  const membership = {
    schemaVersion: 1 as const, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
    type: 'project_membership' as const, projectMembershipId: TEST_IDS.projectMembershipId,
    projectId: TEST_IDS.projectId, userId: TEST_IDS.secondUserId, state: 'invited',
    authorityEpoch: 1, activatedAt: null, removalRequestedAt: null,
    removalRequestedByUserId: null, removedAt: null
  }
  const confirmedRequirements = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1, revision: 2, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
    type: 'project_requirements_document', requirementsDocumentId: 'rqd_WorkflowAccept0000000001',
    projectId: TEST_IDS.projectId, documentRevision: 1, state: 'confirmed',
    goalsDeliverables: 'Goal', inputsBoundaries: 'Input', inputReferences: [],
    workModules: [{ planItemId: 'item_analysis', title: 'Analysis', objective: 'Review evidence.', dependencyPlanItemIds: [] }],
    acceptanceCriteria: [
      { target: 'item_analysis', criteria: 'Reviewed.', evidenceMethod: 'Owner review.' },
      { target: '$project', criteria: 'Complete.', evidenceMethod: 'Owner review.' }
    ],
    contentDigest: TEST_HASH, confirmedByUserId: TEST_IDS.userId,
    confirmedAt: TEST_TIMESTAMP, supersededAt: null
  })
  const workspace = projectCoordinatorWorkspaceSchema.parse({
    connection: { state: 'ready', userId: TEST_IDS.secondUserId, deviceId: TEST_IDS.deviceId },
    observedAt: TEST_TIMESTAMP,
    availableWorkerUsers: [],
    projects: [{
      project: { ...projectFixture, ownerUserId: TEST_IDS.userId, status: 'paused', revision: 3 },
      coordinatorTransferFeedback: null, plan: null, requirementsDraft: null,
      confirmedRequirements, memberUsers: [], workerGroups: [], tasks: [], offers: [],
      deliveryDrive: null, records: [], pendingHumanNeeded: [], finalSummary: null,
      memberships: [membership]
    }]
  })
  const transport: AuthenticatedCloudTransport = {
    status: () => ({ state: 'ready', baseUrl: 'https://cloud.test', userId: TEST_IDS.secondUserId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
    stageObject: async () => { throw new Error('No object staging.') },
    readObject: async () => { throw new Error('No object read.') },
    execute: async (request) => {
      executeCalls += 1
      return ({
      contractVersion: 1, status: 200,
      body: { protocolVersion: '1.0', type: 'rest.collection', requestId: request.payload.requestId,
        items: [{ ...membership, state: 'active', activatedAt: TEST_TIMESTAMP }] }
      })
    }
  }
  const port = createProjectCoordinatorMembershipPort({
    workspace: { readWorkspace: async () => workspace },
    transport,
  })

  await assert.rejects(port.acceptInvitation({
    projectId: TEST_IDS.projectId,
    projectMembershipId: TEST_IDS.projectMembershipId,
    expectedProjectRevision: 3,
    expectedMembershipRevision: 1,
    expectedPlanRevision: 1
  } as never, 'idem_workflow_requirements_accept-half-key'), /Unrecognized key/u)

  await port.acceptInvitation({
    projectId: TEST_IDS.projectId,
    projectMembershipId: TEST_IDS.projectMembershipId,
    expectedProjectRevision: 3,
    expectedMembershipRevision: 1
  }, 'idem_workflow_requirements_accept01')
  assert.equal(executeCalls, 1)
})

test('accepting a draft-requirements invitation is rejected before the Cloud write', async () => {
  const membership = {
    schemaVersion: 1 as const, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
    type: 'project_membership' as const, projectMembershipId: TEST_IDS.projectMembershipId,
    projectId: TEST_IDS.projectId, userId: TEST_IDS.secondUserId, state: 'invited' as const,
    authorityEpoch: 1, activatedAt: null, removalRequestedAt: null,
    removalRequestedByUserId: null, removedAt: null
  }
  const draft = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
    type: 'project_requirements_document', requirementsDocumentId: 'rqd_WorkflowDraftAccept00001',
    projectId: TEST_IDS.projectId, documentRevision: 1, state: 'draft',
    goalsDeliverables: 'Goal', inputsBoundaries: 'Input', inputReferences: [],
    workModules: [], acceptanceCriteria: [], contentDigest: TEST_HASH,
    confirmedByUserId: null, confirmedAt: null, supersededAt: null
  })
  const workspace = projectCoordinatorWorkspaceSchema.parse({
    connection: { state: 'ready', userId: TEST_IDS.secondUserId, deviceId: TEST_IDS.deviceId },
    observedAt: TEST_TIMESTAMP, availableWorkerUsers: [], projects: [{
      project: { ...projectFixture, ownerUserId: TEST_IDS.userId, status: 'draft', revision: 3 },
      coordinatorTransferFeedback: null, plan: null, requirementsDraft: draft,
      confirmedRequirements: null, memberUsers: [], workerGroups: [], tasks: [], offers: [],
      deliveryDrive: null, records: [], pendingHumanNeeded: [], finalSummary: null,
      memberships: [membership]
    }]
  })
  let executeCalls = 0
  const transport: AuthenticatedCloudTransport = {
    status: () => ({ state: 'ready', baseUrl: 'https://cloud.test', userId: TEST_IDS.secondUserId,
      deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
    stageObject: async () => { throw new Error('No object staging.') },
    readObject: async () => { throw new Error('No object read.') },
    execute: async () => { executeCalls += 1; throw new Error('Cloud acceptance must not run.') }
  }
  const port = createProjectCoordinatorMembershipPort({
    workspace: { readWorkspace: async () => workspace },
    transport,
  })

  await assert.rejects(port.acceptInvitation({
    projectId: TEST_IDS.projectId,
    projectMembershipId: TEST_IDS.projectMembershipId,
    expectedProjectRevision: 3,
    expectedMembershipRevision: 1,
  }, 'idem_workflow_draft_requirements_accept01'), /Requirements are not confirmed yet\./u)
  assert.equal(executeCalls, 0)
})
