import assert from 'node:assert/strict'
import test from 'node:test'
import { createCollaborationError } from '@sciforge/collaboration-contracts'
import {
  TEST_HASH, TEST_IDS, TEST_TIMESTAMP, projectFixture
} from '@sciforge/collaboration-contracts/testing'
import type { ProjectCoordinatorMembershipAcceptInput, ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'
import { projectCoordinatorWorkspaceSchema } from '../../coordinator/contract.js'
import { createProjectCoordinatorMembershipPort } from '../../coordinator/membership.js'
import { acceptReviewedInvitation } from './accept-reviewed-invitation.js'

function fixture() {
  return structuredClone(projectCoordinatorWorkspaceSchema.parse({
    connection: { state: 'ready', userId: TEST_IDS.secondUserId, deviceId: TEST_IDS.deviceId },
    observedAt: TEST_TIMESTAMP, availableWorkerUsers: [], projects: [{
      project: { ...projectFixture, ownerUserId: TEST_IDS.userId, status: 'paused', revision: 7 },
      plan: null, memberUsers: [], workerGroups: [], tasks: [], offers: [], deliveryDrive: null,
      records: [], pendingHumanNeeded: [], finalSummary: null,
      confirmedRequirements: {
        schemaVersion: 1, revision: 2, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
        type: 'project_requirements_document', requirementsDocumentId: 'rqd_InviteRace000000000001',
        projectId: TEST_IDS.projectId, documentRevision: 1, state: 'confirmed',
        goalsDeliverables: 'Goal', inputsBoundaries: 'Input', inputReferences: [],
        workModules: [{ planItemId: 'item_analysis', title: 'Analysis', objective: 'Review.', dependencyPlanItemIds: [] }],
        acceptanceCriteria: [
          { target: 'item_analysis', criteria: 'Reviewed.', evidenceMethod: 'Owner review.' },
          { target: '$project', criteria: 'Complete.', evidenceMethod: 'Owner review.' }
        ],
        contentDigest: TEST_HASH, confirmedByUserId: TEST_IDS.userId, confirmedAt: TEST_TIMESTAMP, supersededAt: null
      },
      memberships: [{
        schemaVersion: 1, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
        type: 'project_membership', projectMembershipId: TEST_IDS.projectMembershipId,
        projectId: TEST_IDS.projectId, userId: TEST_IDS.secondUserId, state: 'invited',
        authorityEpoch: 1, activatedAt: null, removalRequestedAt: null,
        removalRequestedByUserId: null, removedAt: null
      }]
    }]
  }))
}

const localConflict = () => new Error('Project invitation acceptance lost the exact current Project revision.')
const cloudConflict = () => new Error('SciForge Cloud request failed: revision_conflict: The resource revision is stale.')

function rig(firstError: Error = localConflict()) {
  const reviewed = fixture()
  const fresh = fixture()
  fresh.projects[0].project.revision++
  const calls: ProjectCoordinatorMembershipAcceptInput[] = []
  let reads = 0
  let secondError: Error | undefined
  const client = {
    readWorkspace: async () => { reads++; return fresh },
    acceptInvitation: async (input: ProjectCoordinatorMembershipAcceptInput) => {
      calls.push(input)
      if (calls.length === 1) throw firstError
      if (secondError) throw secondError
      return fresh
    }
  }
  return {
    reviewed, fresh, calls, reads: () => reads,
    secondError: (cause: Error) => { secondError = cause },
    accept: () => acceptReviewedInvitation({ client, project: reviewed.projects[0], userId: TEST_IDS.secondUserId, membershipId: TEST_IDS.projectMembershipId })
  }
}

for (const conflict of [localConflict, cloudConflict]) {
  test(`one re-submit after ${conflict.name} keeps the reviewed Membership CAS`, async () => {
    const state = rig(conflict())
    await state.accept()
    assert.deepEqual(state.calls.map(({ expectedProjectRevision, expectedMembershipRevision }) => [expectedProjectRevision, expectedMembershipRevision]), [[7, 1], [8, 1]])
    assert.equal(state.reads(), 1)
  })
}

const changes: Record<string, (workspace: ProjectCoordinatorWorkspace) => void> = {
  'Membership revision': (w) => { w.projects[0].memberships[0].revision++ },
  'Membership removed': (w) => { w.projects[0].memberships[0].state = 'removed' },
  'Membership accepted elsewhere': (w) => { w.projects[0].memberships[0].state = 'active' },
  'Membership missing': (w) => { w.projects[0] = { ...w.projects[0], memberships: [] } },
  'Membership User': (w) => { w.projects[0].memberships[0].userId = TEST_IDS.userId },
  'requirements digest': (w) => { w.projects[0].confirmedRequirements!.contentDigest = 'b'.repeat(64) },
  'requirements row revision with same digest': (w) => { w.projects[0].confirmedRequirements!.revision++ },
  'requirements document revision with same digest': (w) => { w.projects[0].confirmedRequirements!.documentRevision++ },
  'requirements ID with same digest': (w) => { w.projects[0].confirmedRequirements!.requirementsDocumentId = 'rqd_InviteRace000000000002' },
  'requirements missing': (w) => { w.projects[0] = { ...w.projects[0], confirmedRequirements: null } },
  'project cancelled': (w) => { w.projects[0].project.status = 'cancelled' },
  'project completed': (w) => { w.projects[0].project.status = 'completed' },
  'project status': (w) => { w.projects[0].project.status = 'active' },
  'Coordinator epoch': (w) => { w.projects[0].project.coordinatorAuthorityEpoch++ },
  'execution epoch': (w) => { w.projects[0].project.executionAuthorityEpoch++ },
  'project goal': (w) => { w.projects[0].project.goal = 'Changed goal.' },
  'project budget': (w) => { w.projects[0].project.budget.maxTasks++ },
  'unchanged project revision': (w) => { w.projects[0].project.revision = 7 },
  'current User': (w) => { Object.assign(w, { connection: { state: 'ready', userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId } }) },
  'identity unavailable': (w) => { Object.assign(w, { connection: { state: 'identity_required' } }) },
  'project missing': (w) => { w.projects.length = 0 }
}
for (const [name, change] of Object.entries(changes)) {
  test(`invitation re-submit stops when ${name} changes`, async () => {
    const state = rig()
    change(state.fresh)
    await assert.rejects(state.accept(), /项目已更新，请查看后再接受/u)
    assert.equal(state.calls.length, 1)
  })
}

test('a second conflict stops after exactly two submissions', async () => {
  const state = rig()
  state.secondError(cloudConflict())
  await assert.rejects(state.accept(), /重提期间项目再次变化/u)
  assert.equal(state.calls.length, 2)
  assert.equal(state.reads(), 1)
})

for (const message of ['Cloud timeout: outcome unknown', 'SciForge Cloud request failed: permission_denied: Denied.', 'SciForge Cloud request failed: idempotency_conflict: Changed request.', 'Cloud did not return the accepted Project Membership state.']) {
  test(`invitation acceptance never retries ${message}`, async () => {
    const cause = new Error(message)
    const state = rig(cause)
    await assert.rejects(state.accept(), (error) => error === cause)
    assert.equal(state.calls.length, 1)
    assert.equal(state.reads(), 0)
  })
}

test('reviewed requirements remain frozen while the first write is pending', async () => {
  const state = rig()
  const pending = state.accept()
  state.reviewed.projects[0].confirmedRequirements!.contentDigest = 'b'.repeat(64)
  state.fresh.projects[0].confirmedRequirements!.contentDigest = 'b'.repeat(64)
  await assert.rejects(pending, /正式需求版本或摘要已变化/u)
  assert.equal(state.calls.length, 1)
})

for (const message of [
  'Only the exact invited OIDC User may accept this Project invitation.',
  'SciForge Cloud request failed: invalid_state_transition: Only an invited Project Membership may be accepted.',
  'Requirements are not confirmed yet.',
  'SciForge Cloud request failed: invalid_state_transition: A terminal Project invitation cannot be accepted.',
  'Project is not visible to the current User.'
]) {
  test(`known invitation change has a review prompt without retry: ${message}`, async () => {
    const state = rig(new Error(message))
    await assert.rejects(state.accept(), /项目已更新，请查看后再接受/u)
    assert.equal(state.calls.length, 1)
    assert.equal(state.reads(), 0)
  })
}

test('the real membership port handles an intervening Cloud CAS rejection with one fresh-key submission', async () => {
  const current = fixture()
  const reviewed = structuredClone(current.projects[0])
  const commands: Array<{ expectedProjectRevision: number; idempotencyKey: string }> = []
  const workspace = { readWorkspace: async () => structuredClone(current) }
  const port = createProjectCoordinatorMembershipPort({
    workspace,
    transport: {
      status: () => ({ state: 'ready', baseUrl: 'https://cloud.test', userId: TEST_IDS.secondUserId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
      readObject: async () => { throw new Error('No object read.') },
      stageObject: async () => { throw new Error('No object stage.') },
      execute: async ({ payload }) => {
        assert.equal(payload.type, 'project.membership.accept')
        if (payload.type !== 'project.membership.accept') throw new Error('Unexpected command.')
        commands.push(payload)
        if (commands.length === 1) {
          current.projects[0].project.revision++
          return { contractVersion: 1, status: 409, body: {
            protocolVersion: '1.0', type: 'rest.error', requestId: payload.requestId,
            error: createCollaborationError('revision_conflict', 'The resource revision is stale.')
          } }
        }
        return { contractVersion: 1, status: 200, body: {
          protocolVersion: '1.0', type: 'rest.collection', requestId: payload.requestId,
          items: [{ ...current.projects[0].memberships[0], state: 'active', revision: 2, activatedAt: TEST_TIMESTAMP }]
        } }
      }
    }
  })
  let attempt = 0
  await acceptReviewedInvitation({
    project: reviewed, userId: TEST_IDS.secondUserId, membershipId: TEST_IDS.projectMembershipId,
    client: { ...workspace, acceptInvitation: (input) => port.acceptInvitation(input, `idem_invite_race_${++attempt}`) }
  })
  assert.deepEqual(commands.map((command) => command.expectedProjectRevision), [7, 8])
  assert.notEqual(commands[0].idempotencyKey, commands[1].idempotencyKey)
})
