import assert from 'node:assert/strict'
import test from 'node:test'

import {
  projectCoordinatorActivationSchema,
  projectCoordinatorWorkspaceSchema
} from './contract.js'

const createdAt = '2026-08-24T08:00:00.000Z'
const updatedAt = '2026-08-24T09:00:00.000Z'

const fixture = {
  connection: {
    state: 'ready' as const,
    userId: 'usr_Owner0000001',
    deviceId: 'dev_Device0000001'
  },
  observedAt: updatedAt,
  focusedProjectId: 'prj_Project000001',
  projects: [{
    project: {
      schemaVersion: 1 as const,
      revision: 3,
      createdAt,
      updatedAt,
      type: 'project' as const,
      projectId: 'prj_Project000001',
      ownerUserId: 'usr_Owner0000001',
      displayName: 'Multi-user review',
      goal: 'Review a synthetic collaboration design.',
      coordinatorAgentId: 'agt_Coordinator01',
      coordinatorAuthorityEpoch: 2,
      executionAuthorityEpoch: 2,
      contentMode: 'required' as const,
      status: 'active' as const,
      budget: {
        maxTasks: 12,
        maxTasksPerRound: 4,
        maxCoordinationRounds: 4,
        maxTaskRetries: 2
      }
    },
    plan: {
      plan: {
        schemaVersion: 1 as const,
        revision: 2,
        createdAt,
        updatedAt,
        type: 'project_plan' as const,
        projectPlanId: 'pln_ProjectPlan01',
        projectId: 'prj_Project000001',
        state: 'awaiting_confirmation' as const,
        planRevision: 1,
        sourceInputLocators: [],
        tasks: [{
          planItemId: 'item_architecture01',
          title: 'Architecture review',
          objective: 'Review the proposed boundaries.',
          completionCriteria: ['One bounded report is submitted.'],
          dependencyPlanItemIds: [],
          requiredCapabilityTags: ['document.review'],
          fileIntent: null
        }],
        rationale: 'The work is independent and bounded.',
        runtimeProvenance: {
          runtimeId: 'codex-runtime',
          modelId: 'configured-model',
          generatedByCoordinatorAgentId: 'agt_Coordinator01',
          generatedAt: '2026-08-24T08:55:00.000Z'
        },
        planDigest: '0'.repeat(64),
        submittedAt: '2026-08-24T08:56:00.000Z',
        confirmedByUserId: null,
        confirmedAt: null,
        supersededAt: null
      },
      assignments: [{
        planItemId: 'item_architecture01',
        selectedAgentId: 'agt_WorkerAgent001',
        recommendationReason: 'The Agent advertises the required Runtime capability.'
      }]
    },
    workerGroups: [{
      userId: 'usr_Worker000001',
      displayName: 'Worker User',
      agents: [{
        displayName: 'Worker Desktop A',
        projectAvailability: {
          schemaVersion: 1 as const,
          type: 'project_worker_availability_view' as const,
          projectId: 'prj_Project000001',
          userId: 'usr_Worker000001',
          agentId: 'agt_WorkerAgent001',
          revision: 7,
          availability: {
            schemaVersion: 1 as const,
            revision: 7,
            createdAt,
            updatedAt,
            type: 'worker_availability_projection' as const,
            userId: 'usr_Worker000001',
            agentId: 'agt_WorkerAgent001',
            deviceId: 'dev_WorkerDevice01',
            agentActive: true,
            deviceActive: true,
            connectionStatus: 'online' as const,
            lastHeartbeatAt: '2026-08-24T08:59:58.000Z',
            runtimeReadiness: 'ready' as const,
            runtimeCapabilityTags: ['document.review'],
            acceptsNewOffers: true,
            activeTaskCount: 0,
            observedAt: '2026-08-24T08:59:59.000Z',
            expiresAt: '2026-08-24T09:01:59.000Z'
          },
          membership: null,
          taskAuthorities: [],
          providerPrincipalFact: null,
          providerPrincipalSnapshotStatus: 'not_applicable' as const,
          contentReadiness: null,
          observedAt: '2026-08-24T08:59:59.000Z'
        }
      }, {
        displayName: 'Worker Desktop B',
        projectAvailability: {
          schemaVersion: 1 as const,
          type: 'project_worker_availability_view' as const,
          projectId: 'prj_Project000001',
          userId: 'usr_Worker000001',
          agentId: 'agt_WorkerAgent002',
          revision: 4,
          availability: {
            schemaVersion: 1 as const,
            revision: 4,
            createdAt,
            updatedAt,
            type: 'worker_availability_projection' as const,
            userId: 'usr_Worker000001',
            agentId: 'agt_WorkerAgent002',
            deviceId: 'dev_WorkerDevice02',
            agentActive: true,
            deviceActive: true,
            connectionStatus: 'offline' as const,
            lastHeartbeatAt: null,
            runtimeReadiness: 'ready' as const,
            runtimeCapabilityTags: ['document.review'],
            acceptsNewOffers: false,
            activeTaskCount: 1,
            observedAt: '2026-08-24T08:58:00.000Z',
            expiresAt: '2026-08-24T09:00:30.000Z'
          },
          membership: null,
          taskAuthorities: [],
          providerPrincipalFact: null,
          providerPrincipalSnapshotStatus: 'not_applicable' as const,
          contentReadiness: null,
          observedAt: '2026-08-24T08:58:00.000Z'
        }
      }]
    }],
    tasks: [],
    reviews: [],
    provisioning: {
      intent: null,
      attestation: null,
      binding: null,
      recoveryActions: []
    }
  }]
}

test('workspace composes canonical Cloud facts while grouping dynamic User candidates by exact Agent', () => {
  const parsed = projectCoordinatorWorkspaceSchema.parse(fixture)
  assert.equal(parsed.projects[0]?.workerGroups[0]?.agents.length, 2)
  assert.equal(
    parsed.projects[0]?.plan?.assignments[0]?.selectedAgentId,
    'agt_WorkerAgent001'
  )
  assert.equal(parsed.projects[0]?.plan?.plan.type, 'project_plan')
})

test('workspace rejects a selected Agent outside the User-grouped canonical availability projection', () => {
  const invalid = structuredClone(fixture)
  invalid.projects[0]!.plan!.assignments[0]!.selectedAgentId = 'agt_UnknownAgent01'
  assert.throws(
    () => projectCoordinatorWorkspaceSchema.parse(invalid),
    /exact Agent in the User-grouped candidate projection/u
  )
})

test('unavailable state cannot claim Project data or secret material', () => {
  assert.throws(() => projectCoordinatorWorkspaceSchema.parse({
    ...fixture,
    connection: { state: 'identity_required' }
  }), /cannot claim Project data/u)
  assert.throws(() => projectCoordinatorWorkspaceSchema.parse({
    ...fixture,
    connection: {
      state: 'ready',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      accessToken: 'forbidden'
    }
  }))
})

test('activation accepts only an exact Project focus', () => {
  assert.deepEqual(projectCoordinatorActivationSchema.parse({
    projectId: 'prj_Project000001'
  }), { projectId: 'prj_Project000001' })
  assert.throws(() => projectCoordinatorActivationSchema.parse({
    projectId: 'prj_Project000001',
    latest: true
  }))
})
