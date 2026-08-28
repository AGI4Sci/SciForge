import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bindTaskFileDeclaration,
  createCollaborationError,
  restResponseSchema,
  taskOfferSchema,
  taskSchema,
  type ProjectPlan,
  type ProjectPlanTask,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForPlanItem } from '@sciforge/collaboration-contracts/node'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  projectFixture
} from '@sciforge/collaboration-contracts/testing'
import type { CoordinatorCloudCommandService } from '@sciforge/domain-collaboration/coordinator-cloud-command'

import {
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import {
  createProjectCoordinatorContinuationPort,
  deriveReadyPlanItems
} from './continuation.js'
import { defineProjectCoordinatorWorkspacePort } from './ports.js'

const rootItem: ProjectPlanTask = {
  workerUserId: TEST_IDS.secondUserId,
  planItemId: 'item_collect',
  title: 'Collect evidence',
  objective: 'Collect the bounded source evidence.',
  completionCriteria: ['Evidence is recorded.'],
  dependencyPlanItemIds: [],
  requiredCapabilityTags: ['analysis'],
  fileIntent: null
}

const dependentItem: ProjectPlanTask = {
  workerUserId: TEST_IDS.secondUserId,
  planItemId: 'item_synthesize',
  title: 'Synthesize evidence',
  objective: 'Synthesize only after collection is accepted.',
  completionCriteria: ['Synthesis cites the collected evidence.'],
  dependencyPlanItemIds: [rootItem.planItemId],
  requiredCapabilityTags: ['analysis'],
  fileIntent: null
}

const plan = confirmedPlan([rootItem, dependentItem])
const FILE_BINDING_REVISION = 3

test('ready-set derives only absent Plan Tasks whose canonical dependencies completed', () => {
  assert.deepEqual(deriveReadyPlanItems({
    projectStatus: 'active',
    plan,
    tasks: []
  }).map(({ planItemId }) => planItemId), [rootItem.planItemId])

  assert.deepEqual(deriveReadyPlanItems({
    projectStatus: 'active',
    plan,
    tasks: [{
      taskId: canonicalTaskIdForPlanItem(plan.projectPlanId, rootItem.planItemId),
      status: 'completed'
    }]
  }).map(({ planItemId }) => planItemId), [dependentItem.planItemId])

  const secondRoot = {
    ...rootItem,
    planItemId: 'item_validate',
    title: 'Validate evidence'
  }
  const joined = {
    ...dependentItem,
    dependencyPlanItemIds: [rootItem.planItemId, secondRoot.planItemId]
  }
  const joinedPlan = confirmedPlan([rootItem, secondRoot, joined])
  assert.deepEqual(deriveReadyPlanItems({
    projectStatus: 'active',
    plan: joinedPlan,
    tasks: []
  }).map(({ planItemId }) => planItemId), [rootItem.planItemId, secondRoot.planItemId])
  assert.deepEqual(deriveReadyPlanItems({
    projectStatus: 'active',
    plan: joinedPlan,
    tasks: [{
      taskId: canonicalTaskIdForPlanItem(joinedPlan.projectPlanId, rootItem.planItemId),
      status: 'completed'
    }, {
      taskId: canonicalTaskIdForPlanItem(joinedPlan.projectPlanId, secondRoot.planItemId),
      status: 'awaiting_review'
    }]
  }), [])

  assert.deepEqual(deriveReadyPlanItems({
    projectStatus: 'active',
    plan: { ...plan, state: 'awaiting_confirmation' },
    tasks: []
  }), [])

  assert.deepEqual(deriveReadyPlanItems({
    projectStatus: 'paused',
    plan,
    tasks: []
  }), [])
})

test('concurrent and replayed reconciliation serializes one canonical offer per ready Plan item', async () => {
  const parallelPlan = confirmedPlan([
    rootItem,
    { ...dependentItem, dependencyPlanItemIds: [] }
  ])
  let workspace = continuationWorkspace(parallelPlan)
  const commands: Array<Extract<RestRequest, { type: 'task.offer.create' }>> = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    execute: async (command) => {
      if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
      commands.push(command)
      const response = offerResponse(command, parallelPlan)
      const task = response.items.find((item) => item.type === 'task')
      const offer = response.items.find((item) => item.type === 'task_offer')
      if (!task || task.type !== 'task' || !offer || offer.type !== 'task_offer') {
        throw new Error('Fixture did not produce a Task and TaskOffer.')
      }
      workspace = projectCoordinatorWorkspaceSchema.parse({
        ...workspace,
        projects: [{
          ...workspace.projects[0]!,
          project: {
            ...workspace.projects[0]!.project,
            revision: workspace.projects[0]!.project.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          },
          tasks: [...workspace.projects[0]!.tasks, { task, executions: [] }],
          offers: [...workspace.projects[0]!.offers, offer]
        }]
      })
      return response
    },
    subscribe: () => () => undefined
  }
  let requestOrdinal = 0
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    coordinatorCloudCommands,
    requestId: () => `req_Continuation${String(++requestOrdinal).padStart(3, '0')}`,
    now: () => new Date(TEST_TIMESTAMP)
  })

  await Promise.all([
    continuation.reconcileVisibleProjects(),
    continuation.reconcileProject(TEST_IDS.projectId)
  ])
  await continuation.reconcileVisibleProjects()

  assert.deepEqual(commands.map(({ planItemId }) => planItemId), [
    rootItem.planItemId,
    dependentItem.planItemId
  ])
  assert.equal(new Set(commands.map(({ idempotencyKey }) => idempotencyKey)).size, 2)
  assert.ok(commands.every(({ idempotencyKey }) => (
    /^idem_project-continuation\.[a-f0-9]{48}$/u.test(idempotencyKey)
  )))
  assert.equal(workspace.projects[0]?.tasks.length, 2)
})

test('reconciliation stops on stale Cloud authority instead of fabricating local progress', async () => {
  const workspace = continuationWorkspace(confirmedPlan([rootItem]))
  let writes = 0
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      execute: async (command) => {
        writes += 1
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: command.requestId,
          error: createCollaborationError(
            'revision_conflict',
            'Project revision changed before dispatch.',
            { requestId: command.requestId, expectedRevision: 1, currentRevision: 2 }
          )
        })
      },
      subscribe: () => () => undefined
    }
  })

  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /revision_conflict/u
  )
  assert.equal(writes, 1)
  assert.equal(workspace.projects[0]?.tasks.length, 0)
})

test('reconciliation reads the Worker User only from the Cloud-confirmed Plan', async () => {
  const currentPlan = confirmedPlan([rootItem])
  const workspace = continuationWorkspace(currentPlan)
  let commandCount = 0
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      execute: async (command) => {
        commandCount += 1
        assert.equal(command.type, 'task.offer.create')
        assert.equal('workerUserId' in command, false)
        return offerResponse(command, currentPlan)
      },
      subscribe: () => () => undefined
    },
    now: () => new Date(TEST_TIMESTAMP)
  })

  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /not observed in fresh Cloud facts/u
  )
  assert.equal(commandCount, 1)
})

test('a successful write must become visible before reconciliation dispatches again', async () => {
  const currentPlan = confirmedPlan([rootItem])
  const workspace = continuationWorkspace(currentPlan)
  let writes = 0
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      execute: async (command) => {
        if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
        writes += 1
        return offerResponse(command, currentPlan)
      },
      subscribe: () => () => undefined
    },
    now: () => new Date(TEST_TIMESTAMP)
  })

  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /not observed in fresh Cloud facts/u
  )
  assert.equal(writes, 1)
})

test('continuation accepts only the current Team-root binding of a logical file Plan item', async () => {
  const fileItem: ProjectPlanTask = {
    ...rootItem,
    planItemId: 'item_file_collect',
    fileIntent: {
      schemaVersion: 1,
      inputs: [],
      output: {
        kind: 'content-space.output-new',
        target: 'project-binding-root',
        mode: 'upload-new',
        fileName: 'evidence-summary.md',
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    }
  }
  const currentPlan = confirmedPlan([fileItem])
  let workspace = fileContinuationWorkspace(currentPlan)
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      execute: async (command) => {
        if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
        const response = offerResponse(command, currentPlan)
        const task = response.items.find((item) => item.type === 'task')
        const offer = response.items.find((item) => item.type === 'task_offer')
        if (!task || task.type !== 'task' || !offer || offer.type !== 'task_offer') {
          throw new Error('Fixture did not produce a Task and TaskOffer.')
        }
        workspace = projectCoordinatorWorkspaceSchema.parse({
          ...workspace,
          projects: [{
            ...workspace.projects[0]!,
            project: {
              ...workspace.projects[0]!.project,
              revision: workspace.projects[0]!.project.revision + 1,
              updatedAt: TEST_LATER_TIMESTAMP
            },
            tasks: [{ task, executions: [] }],
            offers: [offer]
          }]
        })
        return response
      },
      subscribe: () => () => undefined
    },
    now: () => new Date(TEST_TIMESTAMP)
  })

  const reconciled = await continuation.reconcileProject(TEST_IDS.projectId)
  assert.equal(
    reconciled.projects[0]?.tasks[0]?.task.fileIntent?.bindingRevision,
    FILE_BINDING_REVISION
  )
  assert.deepEqual(
    reconciled.projects[0]?.plan?.plan.tasks[0]?.fileIntent,
    fileItem.fileIntent
  )
})

function confirmedPlan(tasks: readonly ProjectPlanTask[]): ProjectPlan {
  return {
    schemaVersion: 1,
    type: 'project_plan',
    projectPlanId: TEST_IDS.projectPlanId,
    projectId: TEST_IDS.projectId,
    state: 'confirmed',
    planRevision: 1,
    sourceInputLocators: [],
    tasks: [...tasks],
    rationale: 'The dependency graph is confirmed by the Owner.',
    runtimeProvenance: {
      runtimeId: 'codex-runtime',
      modelId: null,
      generatedByCoordinatorAgentId: TEST_IDS.agentId,
      generatedAt: TEST_TIMESTAMP
    },
    planDigest: TEST_HASH,
    submittedAt: TEST_TIMESTAMP,
    confirmedByUserId: TEST_IDS.userId,
    confirmedAt: TEST_LATER_TIMESTAMP,
    supersededAt: null,
    revision: 2,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  }
}

function continuationWorkspace(currentPlan: ProjectPlan): ProjectCoordinatorWorkspace {
  const availability = {
    schemaVersion: 1,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    type: 'worker_availability_projection' as const,
    userId: TEST_IDS.secondUserId,
    agentId: TEST_IDS.secondAgentId,
    deviceId: 'dev_Worker0000001',
    agentActive: true,
    deviceActive: true,
    connectionStatus: 'online' as const,
    lastHeartbeatAt: TEST_TIMESTAMP,
    runtimeReadiness: 'ready' as const,
    runtimeCapabilityTags: ['analysis'],
    acceptsNewOffers: true,
    activeTaskCount: 0,
    observedAt: TEST_TIMESTAMP,
    expiresAt: TEST_LATER_TIMESTAMP
  }
  return projectCoordinatorWorkspaceSchema.parse({
    connection: {
      state: 'ready',
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId
    },
    observedAt: TEST_TIMESTAMP,
    focusedProjectId: TEST_IDS.projectId,
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: [{
      project: projectFixture,
      plan: {
        plan: currentPlan
      },
      memberUsers: [],
      workerGroups: [{
        userId: TEST_IDS.secondUserId,
        displayName: 'Worker User',
        agents: [{
          displayName: 'Worker Desktop',
          projectAvailability: {
            schemaVersion: 1,
            type: 'project_worker_availability_view',
            projectId: TEST_IDS.projectId,
            userId: TEST_IDS.secondUserId,
            agentId: TEST_IDS.secondAgentId,
            revision: 1,
            availability,
            membership: {
              schemaVersion: 1,
              type: 'project_membership',
              projectMembershipId: TEST_IDS.projectMembershipId,
              projectId: TEST_IDS.projectId,
              userId: TEST_IDS.secondUserId,
              state: 'active',
              authorityEpoch: 1,
              activatedAt: TEST_TIMESTAMP,
              removalRequestedAt: null,
              removalRequestedByUserId: null,
              removedAt: null,
              revision: 1,
              createdAt: TEST_TIMESTAMP,
              updatedAt: TEST_TIMESTAMP
            },
            taskAuthorities: [{
              schemaVersion: 1,
              type: 'task_authority',
              taskAuthorityId: TEST_IDS.taskAuthorityId,
              projectId: TEST_IDS.projectId,
              userId: TEST_IDS.secondUserId,
              scope: 'text_tasks',
              state: 'eligible',
              authorityEpoch: 1,
              reason: null,
              effectiveAt: TEST_TIMESTAMP,
              revision: 1,
              createdAt: TEST_TIMESTAMP,
              updatedAt: TEST_TIMESTAMP
            }],
            providerPrincipalFact: null,
            providerPrincipalSnapshotStatus: 'not_applicable',
            contentReadiness: null,
            observedAt: TEST_TIMESTAMP
          }
        }]
      }],
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

function fileContinuationWorkspace(currentPlan: ProjectPlan): ProjectCoordinatorWorkspace {
  const workspace = continuationWorkspace(currentPlan)
  const rootLocator = {
    contractVersion: 1 as const,
    kind: 'content-space.container-reference' as const,
    authority: 'opencontent.run0',
    identity: { containerId: 'continuation-root' }
  }
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: [{
      ...workspace.projects[0]!,
      project: { ...workspace.projects[0]!.project, contentMode: 'required' },
      provisioning: {
        ...workspace.projects[0]!.provisioning,
        binding: {
          schemaVersion: 1,
          type: 'project_content_space_binding',
          projectContentBindingId: 'pcb_Continuation001',
          projectId: TEST_IDS.projectId,
          contentOwnerUserId: TEST_IDS.userId,
          providerInstance: {
            schemaVersion: 1,
            type: 'provider_instance_reference',
            providerInstanceRef: rootLocator.authority
          },
          rootLocator,
          rootLocatorDigest: TEST_HASH,
          provisioningIntentId: 'pci_Continuation001',
          provisioningRevision: 1,
          attestationId: 'pca_Continuation001',
          attestationDigest: TEST_HASH,
          status: 'active',
          statusReason: null,
          activatedAt: TEST_TIMESTAMP,
          degradedAt: null,
          closedAt: null,
          revision: FILE_BINDING_REVISION,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP
        }
      }
    }]
  })
}

function offerResponse(
  command: Extract<RestRequest, { type: 'task.offer.create' }>,
  currentPlan: ProjectPlan
): Extract<RestResponse, { type: 'rest.collection' }> {
  const item = currentPlan.tasks.find(({ planItemId }) => planItemId === command.planItemId)
  if (!item) throw new Error('Unknown Plan item.')
  const taskId = canonicalTaskIdForPlanItem(currentPlan.projectPlanId, item.planItemId)
  const task = taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId,
    projectId: command.projectId,
    createdByCoordinatorAgentId: TEST_IDS.agentId,
    title: item.title,
    objective: item.objective,
    completionCriteria: item.completionCriteria,
    dependencyTaskIds: item.dependencyPlanItemIds.map((planItemId) => (
      canonicalTaskIdForPlanItem(currentPlan.projectPlanId, planItemId)
    )),
    requiredCapabilityTags: item.requiredCapabilityTags,
    fileIntent: item.fileIntent === null
      ? null
      : bindTaskFileDeclaration(item.fileIntent, FILE_BINDING_REVISION),
    currentExecutionId: null,
    currentExecutionState: null,
    status: 'offered',
    executionCount: 0,
    maxRetries: projectFixture.budget.maxTaskRetries,
    completedAt: null,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: `ofr_${String(command.planItemId).replace('item_', '')}0000001`,
    projectId: command.projectId,
    taskId,
    executionId: null,
    workerUserId: item.workerUserId,
    offeredByCoordinatorAgentId: TEST_IDS.agentId,
    state: 'pending',
    offeredAt: TEST_TIMESTAMP,
    expiresAt: command.offerExpiresAt,
    respondedAt: null,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: command.requestId,
    items: [task, offer]
  }) as Extract<RestResponse, { type: 'rest.collection' }>
}
