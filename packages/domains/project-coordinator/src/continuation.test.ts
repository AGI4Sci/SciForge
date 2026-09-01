import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bindTaskFileDeclaration,
  createCollaborationError,
  DEFAULT_TASK_OFFER_TTL_MS,
  restResponseSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskSchema,
  type ProjectPlan,
  type ProjectPlanTask,
  type RestRequest,
  type RestResponse,
  type TaskFileIntent
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
    localAgentId: () => undefined,
    resume: async () => null,
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

test('a failed durable continuation attempt renews its exact command identity after expiry', async () => {
  const currentPlan = confirmedPlan([rootItem])
  let workspace = continuationWorkspace(currentPlan)
  let currentTime = new Date(TEST_TIMESTAMP)
  const commands: Array<Extract<RestRequest, { type: 'task.offer.create' }>> = []
  const durableBodies = new Map<string, string>()
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async (command) => {
        if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
        const { requestId: _requestId, ...businessBody } = command
        const serializedBody = JSON.stringify(businessBody)
        const durableBody = durableBodies.get(command.idempotencyKey)
        if (durableBody !== undefined && durableBody !== serializedBody) {
          throw new Error('Outbox idempotency key was reused for a different command.')
        }
        durableBodies.set(command.idempotencyKey, serializedBody)
        commands.push(command)
        if (commands.length <= 2) throw new Error('Injected offline delivery failure.')

        const response = offerResponse(command, currentPlan)
        workspace = workspaceWithCreatedOffer(workspace, response)
        return response
      },
      subscribe: () => () => undefined
    },
    requestId: () => `req_ContinuationExpiry${String(commands.length + 1).padStart(2, '0')}`,
    now: () => currentTime
  })

  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /Injected offline delivery failure/u
  )
  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /Injected offline delivery failure/u
  )
  assert.equal(commands[0]?.idempotencyKey, commands[1]?.idempotencyKey)
  assert.equal(commands[0]?.offerExpiresAt, commands[1]?.offerExpiresAt)
  currentTime = new Date(currentTime.getTime() + DEFAULT_TASK_OFFER_TTL_MS + 1)

  const reconciled = await continuation.reconcileProject(TEST_IDS.projectId)

  assert.equal(commands.length, 3)
  assert.notEqual(commands[1]?.offerExpiresAt, commands[2]?.offerExpiresAt)
  assert.notEqual(commands[1]?.idempotencyKey, commands[2]?.idempotencyKey)
  assert.equal(reconciled.projects[0]?.tasks.length, 1)
  assert.equal(reconciled.projects[0]?.offers.length, 1)
})

test('expired continuation delivery renewal is bounded for one canonical Plan item', async () => {
  const currentPlan = confirmedPlan([rootItem])
  const workspace = continuationWorkspace(currentPlan)
  let currentTime = new Date(TEST_TIMESTAMP)
  const commands: Array<Extract<RestRequest, { type: 'task.offer.create' }>> = []
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async (command) => {
        if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
        commands.push(command)
        currentTime = new Date(Date.parse(command.offerExpiresAt) + 1)
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: command.requestId,
          error: createCollaborationError(
            'expired',
            'A Task offer expiry must be in the future.',
            { requestId: command.requestId }
          )
        })
      },
      subscribe: () => () => undefined
    },
    requestId: () => `req_ContinuationBound${String(commands.length + 1).padStart(2, '0')}`,
    now: () => currentTime
  })

  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /Task offer expiry must be in the future/u
  )
  assert.equal(commands.length, 4)
  assert.equal(new Set(commands.map(({ idempotencyKey }) => idempotencyKey)).size, 4)
})

test('an unrelated validation error is terminal even when its offer body aged out in flight', async () => {
  const currentPlan = confirmedPlan([rootItem])
  const workspace = continuationWorkspace(currentPlan)
  let currentTime = new Date(TEST_TIMESTAMP)
  let attempts = 0
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async (command) => {
        if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
        attempts += 1
        currentTime = new Date(Date.parse(command.offerExpiresAt) + 1)
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: command.requestId,
          error: createCollaborationError(
            'validation_error',
            'The selected Plan item is invalid.',
            { requestId: command.requestId }
          )
        })
      },
      subscribe: () => () => undefined
    },
    now: () => currentTime
  })

  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /selected Plan item is invalid/u
  )
  assert.equal(attempts, 1)
})

test('a response-lost committed continuation attempt converges through the canonical Task fence', async () => {
  const currentPlan = confirmedPlan([rootItem])
  let workspace = continuationWorkspace(currentPlan)
  let currentTime = new Date(TEST_TIMESTAMP)
  let committedResponse: Extract<RestResponse, { type: 'rest.collection' }> | null = null
  const commands: Array<Extract<RestRequest, { type: 'task.offer.create' }>> = []
  const durableBodies = new Map<string, string>()
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async (command) => {
        if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
        const { requestId: _requestId, ...businessBody } = command
        const serializedBody = JSON.stringify(businessBody)
        const durableBody = durableBodies.get(command.idempotencyKey)
        if (durableBody !== undefined && durableBody !== serializedBody) {
          throw new Error('Outbox idempotency key was reused for a different command.')
        }
        durableBodies.set(command.idempotencyKey, serializedBody)
        commands.push(command)
        if (committedResponse === null) {
          committedResponse = offerResponse(command, currentPlan)
          throw new Error('Injected response loss after Cloud commit.')
        }
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: command.requestId,
          error: createCollaborationError(
            'identity_conflict',
            'This confirmed plan item already has its canonical Task.',
            { requestId: command.requestId }
          )
        })
      },
      subscribe: () => () => undefined
    },
    requestId: () => `req_ContinuationResponseLoss${String(commands.length + 1).padStart(2, '0')}`,
    now: () => currentTime
  })

  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /Injected response loss after Cloud commit/u
  )
  currentTime = new Date(currentTime.getTime() + DEFAULT_TASK_OFFER_TTL_MS + 1)
  await assert.rejects(
    continuation.reconcileProject(TEST_IDS.projectId),
    /identity_conflict/u
  )

  assert.ok(committedResponse)
  workspace = workspaceWithCreatedOffer(workspace, committedResponse)
  const reconciled = await continuation.reconcileProject(TEST_IDS.projectId)

  assert.equal(commands.length, 2)
  assert.notEqual(commands[0]?.idempotencyKey, commands[1]?.idempotencyKey)
  assert.equal(reconciled.projects[0]?.tasks.length, 1)
  assert.equal(reconciled.projects[0]?.offers.length, 1)
})

test('reconciliation stops on stale Cloud authority instead of fabricating local progress', async () => {
  const workspace = continuationWorkspace(confirmedPlan([rootItem]))
  let writes = 0
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: {
      resume: async () => null,
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
      resume: async () => null,
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
      resume: async () => null,
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
      schemaVersion: 2,
      inputs: [],
      dependencyInputs: [],
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
      resume: async () => null,
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

test('continuation accepts Cloud dependency locators only with the exact Plan input shape', async () => {
  const sourceItem: ProjectPlanTask = {
    ...rootItem,
    planItemId: 'item_file_dependency_source',
    title: 'Produce dependency files',
    fileIntent: {
      schemaVersion: 2,
      inputs: [],
      dependencyInputs: [],
      output: {
        kind: 'content-space.output-new',
        target: 'project-binding-root',
        mode: 'upload-new',
        fileName: 'dependency-source.md',
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    }
  }
  const staticInput = {
    kind: 'content-space.input-file' as const,
    locator: {
      contractVersion: 1 as const,
      kind: 'content-space.file-reference' as const,
      authority: 'provider.instance.alpha',
      identity: { fileId: 'static-plan-input' }
    },
    destinationName: 'static.csv',
    expectedSemanticRevision: 'semantic-revision-1',
    expectedMediaType: 'text/csv'
  }
  const dependencyInputs = [{
    planItemId: sourceItem.planItemId,
    outputIndex: 0,
    destinationName: 'dependency-zero.md'
  }, {
    planItemId: sourceItem.planItemId,
    outputIndex: 1,
    destinationName: 'dependency-one.md'
  }]
  const consumerItem: ProjectPlanTask = {
    ...dependentItem,
    planItemId: 'item_file_dependency_consumer',
    title: 'Consume dependency files',
    dependencyPlanItemIds: [sourceItem.planItemId],
    fileIntent: {
      schemaVersion: 2,
      inputs: [staticInput],
      dependencyInputs,
      output: {
        kind: 'content-space.output-new',
        target: 'project-binding-root',
        mode: 'upload-new',
        fileName: 'dependency-consumer.md',
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    }
  }
  const currentPlan = confirmedPlan([sourceItem, consumerItem])
  const cloudDependencyInputs: TaskFileIntent['inputs'] = [{
    kind: 'content-space.input-file',
    locator: {
      contractVersion: 1,
      kind: 'content-space.file-reference',
      authority: 'opencontent.run0',
      identity: { fileId: 'accepted-output-zero' }
    },
    destinationName: dependencyInputs[0]!.destinationName,
    expectedSemanticRevision: null,
    expectedMediaType: null
  }, {
    kind: 'content-space.input-file',
    locator: {
      contractVersion: 1,
      kind: 'content-space.file-reference',
      authority: 'opencontent.run0',
      identity: { fileId: 'accepted-output-one' }
    },
    destinationName: dependencyInputs[1]!.destinationName,
    expectedSemanticRevision: null,
    expectedMediaType: null
  }]
  const exactInputs: TaskFileIntent['inputs'] = [staticInput, ...cloudDependencyInputs]

  const reconcile = async (
    returnedInputs: TaskFileIntent['inputs']
  ): Promise<ProjectCoordinatorWorkspace> => {
    let workspace = dependencyContinuationWorkspace(currentPlan, sourceItem)
    const continuation = createProjectCoordinatorContinuationPort({
      workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
      coordinatorCloudCommands: {
        resume: async () => null,
        execute: async (command) => {
          if (command.type !== 'task.offer.create') throw new Error(`Unexpected ${command.type}.`)
          const response = withTaskFileInputs(
            offerResponse(command, currentPlan, cloudDependencyInputs),
            returnedInputs
          )
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
              offers: [offer]
            }]
          })
          return response
        },
        subscribe: () => () => undefined
      },
      now: () => new Date(TEST_TIMESTAMP)
    })
    return continuation.reconcileProject(TEST_IDS.projectId)
  }

  const reconciled = await reconcile(exactInputs)
  const createdIntent = reconciled.projects[0]?.tasks.find(({ task }) => (
    task.taskId === canonicalTaskIdForPlanItem(currentPlan.projectPlanId, consumerItem.planItemId)
  ))?.task.fileIntent
  assert.deepEqual(createdIntent?.inputs.slice(0, 1), [staticInput])
  assert.deepEqual(createdIntent?.inputs.slice(1), cloudDependencyInputs)
  assert.deepEqual(
    reconciled.projects[0]?.plan?.plan.tasks[1]?.fileIntent?.dependencyInputs,
    dependencyInputs
  )
  assert.equal('locator' in dependencyInputs[0]!, false)

  const rejectedInputs: ReadonlyArray<readonly [string, TaskFileIntent['inputs']]> = [[
    'dependency input count',
    exactInputs.slice(0, -1)
  ], [
    'dependency destination order',
    [staticInput, cloudDependencyInputs[1]!, cloudDependencyInputs[0]!]
  ], [
    'static input prefix position',
    [cloudDependencyInputs[0]!, staticInput, cloudDependencyInputs[1]!]
  ], [
    'static input prefix content',
    [{ ...staticInput, expectedMediaType: null }, ...cloudDependencyInputs]
  ]]
  for (const [label, returnedInputs] of rejectedInputs) {
    await assert.rejects(
      reconcile(returnedInputs),
      /exact selected Plan Task offer/u,
      label
    )
  }
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

function dependencyContinuationWorkspace(
  currentPlan: ProjectPlan,
  sourceItem: ProjectPlanTask
): ProjectCoordinatorWorkspace {
  if (sourceItem.fileIntent === null) throw new Error('Dependency source must be a file Task.')
  const workspace = fileContinuationWorkspace(currentPlan)
  const taskId = canonicalTaskIdForPlanItem(currentPlan.projectPlanId, sourceItem.planItemId)
  const executionId = 'exe_ContinuationSource01'
  const executionFileIntent = {
    schemaVersion: 1 as const,
    type: 'task_execution_file_intent' as const,
    projectId: TEST_IDS.projectId,
    taskId,
    executionId,
    assignmentTaskRevision: 1,
    bindingRevision: FILE_BINDING_REVISION,
    declarationDigest: TEST_HASH,
    inputs: [],
    output: {
      rootResourceRefId: 'rrf_ContinuationRoot01',
      fileName: sourceItem.fileIntent.output.fileName,
      mediaType: sourceItem.fileIntent.output.mediaType,
      maxBytes: sourceItem.fileIntent.output.maxBytes
    }
  }
  const sourceTask = taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId,
    projectId: TEST_IDS.projectId,
    createdByCoordinatorAgentId: TEST_IDS.agentId,
    title: sourceItem.title,
    objective: sourceItem.objective,
    completionCriteria: sourceItem.completionCriteria,
    dependencyTaskIds: [],
    requiredCapabilityTags: sourceItem.requiredCapabilityTags,
    fileIntent: bindTaskFileDeclaration(sourceItem.fileIntent, FILE_BINDING_REVISION),
    currentExecutionId: executionId,
    currentExecutionState: 'completed',
    status: 'completed',
    executionCount: 1,
    maxRetries: projectFixture.budget.maxTaskRetries,
    completedAt: TEST_LATER_TIMESTAMP,
    revision: 4,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const sourceExecution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId,
    executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: TEST_IDS.agentId,
    assigneeUserId: TEST_IDS.secondUserId,
    assigneeAgentId: TEST_IDS.secondAgentId,
    assigneeDeviceId: 'dev_ContinuationWorker01',
    state: 'completed',
    stateRevision: 4,
    fence: {
      schemaVersion: 1,
      executionId,
      assigneeUserId: TEST_IDS.secondUserId,
      assigneeAgentId: TEST_IDS.secondAgentId,
      assigneeDeviceId: 'dev_ContinuationWorker01',
      assignmentTaskRevision: 1,
      projectExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch,
      userTaskAuthorityEpoch: 1,
      bindingRevision: FILE_BINDING_REVISION,
      status: 'fenced',
      reason: 'completed',
      fencedAt: TEST_LATER_TIMESTAMP
    },
    fileIntent: executionFileIntent,
    currentResultSubmissionId: 'rsu_ContinuationSource01',
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_TIMESTAMP,
    startedAt: TEST_TIMESTAMP,
    terminalAt: TEST_LATER_TIMESTAMP,
    revision: 4,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: [{
      ...workspace.projects[0]!,
      tasks: [{ task: sourceTask, executions: [sourceExecution] }]
    }]
  })
}

function withTaskFileInputs(
  response: Extract<RestResponse, { type: 'rest.collection' }>,
  inputs: TaskFileIntent['inputs']
): Extract<RestResponse, { type: 'rest.collection' }> {
  return restResponseSchema.parse({
    ...response,
    items: response.items.map((item) => {
      if (item.type !== 'task') return item
      if (item.fileIntent === null) throw new Error('Fixture Task must carry a file intent.')
      return { ...item, fileIntent: { ...item.fileIntent, inputs } }
    })
  }) as Extract<RestResponse, { type: 'rest.collection' }>
}

function offerResponse(
  command: Extract<RestRequest, { type: 'task.offer.create' }>,
  currentPlan: ProjectPlan,
  dependencyInputs: readonly TaskFileIntent['inputs'][number][] = []
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
      : bindTaskFileDeclaration(item.fileIntent, FILE_BINDING_REVISION, dependencyInputs),
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
    reassignmentTaskRevision: null,
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

function workspaceWithCreatedOffer(
  workspace: ProjectCoordinatorWorkspace,
  response: Extract<RestResponse, { type: 'rest.collection' }>
): ProjectCoordinatorWorkspace {
  const task = response.items.find((item) => item.type === 'task')
  const offer = response.items.find((item) => item.type === 'task_offer')
  if (!task || task.type !== 'task' || !offer || offer.type !== 'task_offer') {
    throw new Error('Fixture did not produce a Task and TaskOffer.')
  }
  return projectCoordinatorWorkspaceSchema.parse({
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
}
