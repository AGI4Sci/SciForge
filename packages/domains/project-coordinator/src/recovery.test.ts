import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  cloudResourceRefSchema,
  externalOperationRecoveryJournalEntrySchema,
  restResponseSchema,
  taskExecutionSchema,
  taskOfferReassignCommandSchema,
  taskOfferSchema,
  taskRecoveryAbandonCommandSchema,
  taskRecoveryLinkObservedOutputCommandSchema,
  taskSchema,
  visibleRecoveryActionSchema,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import type {
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'
import {
  CONTENT_SPACE_SYSTEM_OBSERVE_EXACT_OUTPUT_CONTRACT,
  contentSpaceSuccess,
  contentSpaceSystemObserveExactOutputReceiptSchema
} from '@sciforge/domain-content-space/contract'
import type {
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import type {
  AuthenticatedCloudResponse,
  AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'

import {
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import { createProjectCoordinatorRecoveryPort } from './recovery.js'

const now = '2026-08-26T02:00:00.000Z'
const projectId = 'prj_RecoveryProject01'
const ownerUserId = 'usr_RecoveryOwner01'
const taskId = 'tsk_RecoveryTask001'
const executionId = 'exe_RecoveryExec001'
const recoveryActionId = 'rca_TaskRecovery001'
const journalEntryId = 'crj_TaskRecovery001'
const expectedName = 'meeting-summary.recovery-1.md'
const successorName = 'meeting-summary.recovery-2.md'
const successorExecutionId = 'exe_RecoveryExec002'
const root = {
  contractVersion: 1 as const,
  kind: 'content-space.container-reference' as const,
  authority: 'opencontent.run0',
  identity: { containerId: 'team-root-recovery' }
}
const recoveredFile = {
  contractVersion: 1 as const,
  kind: 'content-space.file-reference' as const,
  authority: root.authority,
  identity: { fileId: 'meeting-summary-recovered' }
}

test('Owner observes and links only the exact current unknown-output tuple', async () => {
  const initial = recoveryWorkspace('available')
  const linked = recoveryWorkspace('linked')
  let workspaceReads = 0
  const capabilityCalls: Array<Readonly<{
    contract: unknown
    input: unknown
    options: unknown
  }>> = []
  const commandBodies: unknown[] = []
  const receipt = exactObservationReceipt()
  const capabilities = capabilityInvoker(async (contract, input, options) => {
    capabilityCalls.push({ contract, input, options })
    return contentSpaceSuccess(receipt)
  })
  const transport = cloudTransport(async (payload) => {
    const command = taskRecoveryLinkObservedOutputCommandSchema.parse(payload)
    commandBodies.push(command)
    return collectionResponse(command.requestId, linkResponseItems(linked))
  })
  const port = createProjectCoordinatorRecoveryPort({
    workspace: {
      readWorkspace: async () => (++workspaceReads < 3 ? initial : linked)
    },
    transport,
    coordinatorCloudCommands: coordinatorCloudService(async () => {
      throw new Error('observe-link must not create a successor execution')
    }),
    getCapabilities: () => capabilities,
    workspaceRoot: '/private/owner/project-coordinator/content-recovery',
    requestId: () => 'req_TaskRecoveryLink01'
  })

  const result = await port.observeAndLink({ projectId, recoveryActionId }, 'idem_TaskRecoveryLink01')

  assert.equal(result.projects[0]?.provisioning.recoveryActions[0]?.status, 'completed')
  assert.equal(workspaceReads, 3)
  assert.equal(capabilityCalls.length, 1)
  assert.equal(capabilityCalls[0]?.contract, CONTENT_SPACE_SYSTEM_OBSERVE_EXACT_OUTPUT_CONTRACT)
  assert.deepEqual(capabilityCalls[0]?.input, {
    root,
    expectedName,
    logicalInvocationId: 'worker-upload-recovery-0001',
    requestDigest: '1'.repeat(64)
  })
  assert.deepEqual(capabilityCalls[0]?.options, {
    workspaceId: '/private/owner/project-coordinator/content-recovery',
    systemExecutionContext: {
      schemaVersion: 1,
      operation: 'output-recovery-observation',
      projectId,
      taskId,
      executionId,
      recoveryActionId,
      journalEntryId,
      coordinatorAgentId: 'agt_RecoveryCoord01',
      coordinatorAuthorityEpoch: 4,
      expectedTaskRevision: 6,
      expectedExecutionRevision: 7,
      assignmentTaskRevision: 5,
      bindingRevision: 3,
      logicalInvocationId: 'worker-upload-recovery-0001',
      requestDigest: '1'.repeat(64),
      rootLocatorDigest: stableDigest(root),
      expectedName
    }
  })

  const command = taskRecoveryLinkObservedOutputCommandSchema.parse(commandBodies[0])
  assert.deepEqual(command, {
    protocolVersion: '1.0',
    requestId: 'req_TaskRecoveryLink01',
    type: 'task.recovery.link_observed_output',
    idempotencyKey: 'idem_TaskRecoveryLink01',
    projectId,
    taskId,
    executionId,
    recoveryActionId,
    journalEntryId,
    expectedTaskRevision: 6,
    expectedExecutionRevision: 7,
    expectedRecoveryActionRevision: 2,
    expectedCoordinatorAuthorityEpoch: 4,
    observation: {
      schemaVersion: 1,
      projectId,
      taskId,
      executionId,
      assignmentTaskRevision: 5,
      bindingRevision: 3,
      logicalInvocationId: 'worker-upload-recovery-0001',
      requestDigest: '1'.repeat(64),
      rootLocator: root,
      rootLocatorDigest: stableDigest(root),
      expectedName,
      locator: recoveredFile,
      locatorDigest: stableDigest(recoveredFile),
      contentObservationReceiptDigest: '2'.repeat(64),
      observationDigest: '3'.repeat(64),
      providerObservationDigest: '4'.repeat(64),
      observedAt: now
    }
  })
  assert.doesNotMatch(
    JSON.stringify(command),
    /\/private\/|token|credential|executionContextDigest|principalSnapshotDigest/u
  )
})

test('observe-link rejects Cloud tuple drift after Provider observation and sends no command', async () => {
  const initial = recoveryWorkspace('available')
  const drifted = recoveryWorkspace('available', { requestDigest: '9'.repeat(64) })
  let workspaceReads = 0
  let commandSent = false
  const port = createProjectCoordinatorRecoveryPort({
    workspace: {
      readWorkspace: async () => (++workspaceReads === 1 ? initial : drifted)
    },
    transport: cloudTransport(async () => {
      commandSent = true
      throw new Error('stale recovery must not reach Cloud')
    }),
    coordinatorCloudCommands: coordinatorCloudService(async () => {
      throw new Error('stale observation must not create a successor execution')
    }),
    getCapabilities: () => capabilityInvoker(async () => (
      contentSpaceSuccess(exactObservationReceipt())
    )),
    workspaceRoot: '/private/owner/project-coordinator/content-recovery'
  })

  await assert.rejects(
    port.observeAndLink({ projectId, recoveryActionId }, 'idem_TaskRecoveryStale01'),
    /changed during the exact output observation/u
  )
  assert.equal(commandSent, false)
})

test('Owner abandons from freshly read CAS facts without manufacturing an observation', async () => {
  const initial = recoveryWorkspace('available', { bindingStatus: 'degraded' })
  const abandoned = recoveryWorkspace('abandoned', { bindingStatus: 'degraded' })
  let workspaceReads = 0
  let invoked = false
  let commandBody: unknown
  const transport = cloudTransport(async (payload) => {
    const command = taskRecoveryAbandonCommandSchema.parse(payload)
    commandBody = command
    return collectionResponse(command.requestId, abandonResponseItems(abandoned))
  })
  const port = createProjectCoordinatorRecoveryPort({
    workspace: { readWorkspace: async () => (++workspaceReads === 1 ? initial : abandoned) },
    transport,
    coordinatorCloudCommands: coordinatorCloudService(async () => {
      throw new Error('abandon must not create a successor execution')
    }),
    getCapabilities: () => capabilityInvoker(async () => {
      invoked = true
      throw new Error('abandon must not invoke Content Space')
    }),
    workspaceRoot: '/private/owner/project-coordinator/content-recovery',
    requestId: () => 'req_TaskRecoveryAbandon01'
  })
  const reason = 'The exact Provider output cannot be verified; abandon this fenced execution.'

  const result = await port.abandon({ projectId, recoveryActionId, reason }, 'idem_TaskRecoveryAbandon01')

  assert.equal(result.projects[0]?.tasks[0]?.task.status, 'revision_requested')
  assert.equal(invoked, false)
  assert.deepEqual(taskRecoveryAbandonCommandSchema.parse(commandBody), {
    protocolVersion: '1.0',
    requestId: 'req_TaskRecoveryAbandon01',
    type: 'task.recovery.abandon',
    idempotencyKey: 'idem_TaskRecoveryAbandon01',
    projectId,
    taskId,
    executionId,
    recoveryActionId,
    journalEntryId,
    expectedTaskRevision: 6,
    expectedExecutionRevision: 7,
    expectedRecoveryActionRevision: 2,
    expectedCoordinatorAuthorityEpoch: 4,
    reason
  })
})

test('Owner approval asks the current Coordinator Agent to create one freshly named successor', async () => {
  const abandoned = recoveryWorkspace('abandoned')
  const retried = recoverySuccessorWorkspace()
  let workspaceReads = 0
  let userTransportCalled = false
  const commands: unknown[] = []
  const coordinatorCloudCommands = coordinatorCloudService(async (rawCommand) => {
    const command = taskOfferReassignCommandSchema.parse(rawCommand)
    commands.push(command)
    return restResponseSchema.parse({
      protocolVersion: '1.0',
      type: 'rest.collection',
      requestId: command.requestId,
      items: successorResponseItems(retried)
    })
  })
  const port = createProjectCoordinatorRecoveryPort({
    workspace: {
      readWorkspace: async () => (++workspaceReads === 1 ? abandoned : retried)
    },
    transport: cloudTransport(async () => {
      userTransportCalled = true
      throw new Error('Human/User transport must not create a successor execution')
    }),
    coordinatorCloudCommands,
    getCapabilities: () => capabilityInvoker(async () => {
      throw new Error('successor retry must not invoke Content Space directly')
    }),
    workspaceRoot: '/private/owner/project-coordinator/content-recovery',
    requestId: () => 'req_TaskRecoverySuccessor01'
  })

  const result = await port.retrySuccessor({
    projectId,
    recoveryActionId,
    assigneeAgentId: 'agt_RecoveryWorker01',
    nextOutputFileName: successorName,
    offerExpiresAt: '2026-08-27T02:00:00.000Z'
  }, 'idem_TaskRecoverySuccessor01')

  assert.equal(userTransportCalled, false)
  assert.equal(workspaceReads, 2)
  assert.equal(result.projects[0]?.tasks[0]?.task.currentExecutionId, successorExecutionId)
  assert.deepEqual(commands, [{
    protocolVersion: '1.0',
    requestId: 'req_TaskRecoverySuccessor01',
    type: 'task.offer.reassign',
    idempotencyKey: 'idem_TaskRecoverySuccessor01',
    taskId,
    previousExecutionId: executionId,
    expectedProjectRevision: 9,
    expectedTaskRevision: 7,
    expectedExecutionRevision: 8,
    expectedCoordinatorAuthorityEpoch: 4,
    expectedExecutionAuthorityEpoch: 2,
    assigneeAgentId: 'agt_RecoveryWorker01',
    expectedAvailabilityRevision: 11,
    offerExpiresAt: '2026-08-27T02:00:00.000Z',
    nextFileIntent: {
      schemaVersion: 1,
      bindingRevision: 3,
      inputs: [],
      output: {
        kind: 'content-space.output-new',
        target: 'project-binding-root',
        mode: 'upload-new',
        fileName: successorName,
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    }
  }])
  const oldExecution = result.projects[0]?.tasks[0]?.executions.find(({ executionId: id }) => (
    id === executionId
  ))
  assert.equal(oldExecution?.state, 'cancelled')
  assert.equal(oldExecution?.fence.reason, 'manual_recovery_abandoned')
})

function recoveryWorkspace(
  phase: 'available' | 'linked' | 'abandoned',
  overrides: Readonly<{
    requestDigest?: string
    bindingStatus?: 'active' | 'degraded'
  }> = {}
): ProjectCoordinatorWorkspace {
  const taskRevision = phase === 'abandoned' ? 7 : 6
  const executionRevision = phase === 'abandoned' ? 8 : 7
  const actionRevision = phase === 'available' ? 2 : 3
  const journalRevision = phase === 'available' ? 3 : 4
  const taskStatus = phase === 'abandoned' ? 'revision_requested' as const : 'manual_recovery_required' as const
  const executionState = phase === 'abandoned' ? 'cancelled' as const : 'manual_recovery_required' as const
  const journalState = phase === 'available'
    ? 'outcome_unknown' as const
    : phase === 'linked'
      ? 'observed_success' as const
      : 'abandoned' as const
  const task = taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId,
    projectId,
    createdByCoordinatorAgentId: 'agt_RecoveryCoord01',
    title: 'Write the meeting summary',
    objective: 'Write and upload one reviewable meeting summary.',
    completionCriteria: ['The exact new file is available for review.'],
    dependencyTaskIds: [],
    fileIntent: {
      schemaVersion: 1,
      bindingRevision: 3,
      inputs: [],
      output: {
        kind: 'content-space.output-new',
        target: 'project-binding-root',
        mode: 'upload-new',
        fileName: expectedName,
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    },
    currentExecutionId: executionId,
    currentExecutionState: executionState,
    status: taskStatus,
    executionCount: 1,
    maxRetries: 2,
    completedAt: null,
    revision: taskRevision,
    createdAt: now,
    updatedAt: now
  })
  const execution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId,
    taskId,
    executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: 'agt_RecoveryCoord01',
    assigneeUserId: 'usr_RecoveryWorker01',
    assigneeAgentId: 'agt_RecoveryWorker01',
    assigneeDeviceId: 'dev_RecoveryWorker01',
    state: executionState,
    stateRevision: phase === 'abandoned' ? 5 : 4,
    fence: {
      schemaVersion: 1,
      executionId,
      assigneeUserId: 'usr_RecoveryWorker01',
      assigneeAgentId: 'agt_RecoveryWorker01',
      assigneeDeviceId: 'dev_RecoveryWorker01',
      assignmentTaskRevision: 5,
      projectExecutionAuthorityEpoch: 2,
      userTaskAuthorityEpoch: 2,
      bindingRevision: 3,
      status: 'fenced',
      reason: phase === 'abandoned'
        ? 'manual_recovery_abandoned'
        : 'manual_recovery_required',
      fencedAt: now
    },
    fileIntent: {
      schemaVersion: 1,
      type: 'task_execution_file_intent',
      projectId,
      taskId,
      executionId,
      assignmentTaskRevision: 5,
      bindingRevision: 3,
      declarationDigest: 'a'.repeat(64),
      inputs: [],
      output: {
        rootResourceRefId: 'rrf_RecoveryRoot001',
        fileName: expectedName,
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    },
    currentResultSubmissionId: null,
    offeredAt: now,
    acceptedAt: now,
    startedAt: now,
    terminalAt: now,
    revision: executionRevision,
    createdAt: now,
    updatedAt: now
  })
  const journal = externalOperationRecoveryJournalEntrySchema.parse({
    schemaVersion: 1,
    type: 'external_operation_recovery_journal_entry',
    contentRecoveryJournalEntryId: journalEntryId,
    scope: 'task_content_transfer',
    projectId,
    taskId,
    executionId,
    preparedTaskRevision: 5,
    preparedExecutionRevision: 6,
    provisioningIntentId: null,
    provisioningRevision: null,
    logicalInvocationId: 'worker-upload-recovery-0001',
    operation: 'upload_new',
    state: journalState,
    requestDigest: overrides.requestDigest ?? '1'.repeat(64),
    receiptDigest: phase === 'linked' ? '2'.repeat(64) : null,
    observationDigest: phase === 'linked' ? '3'.repeat(64) : null,
    safeFailureCode: phase === 'available' ? 'outcome_unknown' : null,
    preparedAt: now,
    dispatchedAt: now,
    resolvedAt: phase === 'available' ? null : now,
    revision: journalRevision,
    createdAt: now,
    updatedAt: now
  })
  const action = visibleRecoveryActionSchema.parse({
    schemaVersion: 1,
    type: 'visible_recovery_action',
    recoveryActionId,
    projectId,
    taskId,
    executionId,
    journalEntryId,
    audience: 'coordinator',
    action: 'link_observed_output',
    status: phase === 'available' ? 'available' : 'completed',
    requiresFreshObservation: true,
    safeSummary: 'Observe the exact no-overwrite output or abandon the fenced execution.',
    availableAt: now,
    completedAt: phase === 'available' ? null : now,
    revision: actionRevision,
    createdAt: now,
    updatedAt: now
  })
  return projectCoordinatorWorkspaceSchema.parse({
    connection: {
      state: 'ready',
      userId: ownerUserId,
      deviceId: 'dev_RecoveryOwner01'
    },
    observedAt: now,
    focusedProjectId: projectId,
    projects: [{
      project: {
        schemaVersion: 1,
        type: 'project',
        projectId,
        ownerUserId,
        displayName: 'Recovery Project',
        goal: 'Recover one uncertain uploaded output safely.',
        coordinatorAgentId: 'agt_RecoveryCoord01',
        coordinatorAuthorityEpoch: 4,
        executionAuthorityEpoch: 2,
        contentMode: 'required',
        status: 'active',
        budget: {
          maxTasks: 8,
          maxTasksPerRound: 3,
          maxTaskRetries: 2,
          maxCoordinationRounds: 3
        },
        revision: 9,
        createdAt: now,
        updatedAt: now
      },
      plan: null,
      workerGroups: recoveryWorkerGroups(),
      tasks: [{ task, executions: [execution] }],
      reviews: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: {
          schemaVersion: 1,
          type: 'project_content_space_binding',
          projectContentBindingId: 'pcb_RecoveryBinding01',
          projectId,
          contentOwnerUserId: ownerUserId,
          providerInstance: {
            schemaVersion: 1,
            type: 'provider_instance_reference',
            providerInstanceRef: root.authority
          },
          rootLocator: root,
          rootLocatorDigest: stableDigest(root),
          provisioningIntentId: 'pci_RecoveryIntent001',
          provisioningRevision: 2,
          attestationId: 'pca_RecoveryAttest01',
          attestationDigest: 'b'.repeat(64),
          status: overrides.bindingStatus ?? 'active',
          statusReason: overrides.bindingStatus === 'degraded' ? 'provider_unavailable' : null,
          activatedAt: now,
          degradedAt: overrides.bindingStatus === 'degraded' ? now : null,
          closedAt: null,
          revision: 3,
          createdAt: now,
          updatedAt: now
        },
        memberships: [],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [journal],
        recoveryActions: [action]
      }
    }]
  })
}

function recoveryWorkerGroups() {
  return [{
    userId: 'usr_RecoveryWorker01',
    displayName: 'Recovery Worker',
    agents: [{
      displayName: 'Recovery Worker Desktop',
      projectAvailability: {
        schemaVersion: 1 as const,
        type: 'project_worker_availability_view' as const,
        projectId,
        userId: 'usr_RecoveryWorker01',
        agentId: 'agt_RecoveryWorker01',
        revision: 12,
        availability: {
          schemaVersion: 1 as const,
          type: 'worker_availability_projection' as const,
          userId: 'usr_RecoveryWorker01',
          agentId: 'agt_RecoveryWorker01',
          deviceId: 'dev_RecoveryWorker01',
          agentActive: true,
          deviceActive: true,
          connectionStatus: 'online' as const,
          lastHeartbeatAt: now,
          runtimeReadiness: 'ready' as const,
          runtimeCapabilityTags: ['meeting.summary'],
          acceptsNewOffers: true,
          activeTaskCount: 0,
          observedAt: now,
          expiresAt: '2026-08-27T02:00:00.000Z',
          revision: 11,
          createdAt: now,
          updatedAt: now
        },
        membership: null,
        taskAuthorities: [],
        providerPrincipalFact: null,
        providerPrincipalSnapshotStatus: 'not_applicable' as const,
        contentReadiness: null,
        observedAt: now
      }
    }]
  }]
}

function recoverySuccessorWorkspace(): ProjectCoordinatorWorkspace {
  const workspace: any = structuredClone(recoveryWorkspace('abandoned'))
  const project = workspace.projects[0]!
  const taskView = project.tasks[0]!
  const succeededAt = '2026-08-26T02:05:00.000Z'
  taskView.task = taskSchema.parse({
    ...taskView.task,
    currentExecutionId: successorExecutionId,
    currentExecutionState: 'offered',
    status: 'offered',
    executionCount: 2,
    revision: 8,
    updatedAt: succeededAt,
    fileIntent: {
      ...taskView.task.fileIntent!,
      output: {
        ...taskView.task.fileIntent!.output,
        fileName: successorName
      }
    }
  })
  taskView.executions.push(taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId,
    taskId,
    executionId: successorExecutionId,
    attempt: 2,
    offeredByCoordinatorAgentId: 'agt_RecoveryCoord01',
    assigneeUserId: 'usr_RecoveryWorker01',
    assigneeAgentId: 'agt_RecoveryWorker01',
    assigneeDeviceId: 'dev_RecoveryWorker01',
    state: 'offered',
    stateRevision: 1,
    fence: {
      schemaVersion: 1,
      executionId: successorExecutionId,
      assigneeUserId: 'usr_RecoveryWorker01',
      assigneeAgentId: 'agt_RecoveryWorker01',
      assigneeDeviceId: 'dev_RecoveryWorker01',
      assignmentTaskRevision: 8,
      projectExecutionAuthorityEpoch: 2,
      userTaskAuthorityEpoch: 2,
      bindingRevision: 3,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: {
      schemaVersion: 1,
      type: 'task_execution_file_intent',
      projectId,
      taskId,
      executionId: successorExecutionId,
      assignmentTaskRevision: 8,
      bindingRevision: 3,
      declarationDigest: 'c'.repeat(64),
      inputs: [],
      output: {
        rootResourceRefId: 'rrf_RecoveryRoot001',
        fileName: successorName,
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    },
    currentResultSubmissionId: null,
    offeredAt: succeededAt,
    acceptedAt: null,
    startedAt: null,
    terminalAt: null,
    revision: 1,
    createdAt: succeededAt,
    updatedAt: succeededAt
  }))
  workspace.observedAt = succeededAt
  return projectCoordinatorWorkspaceSchema.parse(workspace)
}

function exactObservationReceipt() {
  return contentSpaceSystemObserveExactOutputReceiptSchema.parse({
    operation: 'observe-exact-output',
    execution: {
      callerId: 'domain:project-coordinator',
      principal: {
        authority: 'sciforge.identity-access',
        subject: ownerUserId,
        assurance: 'cloud-authenticated',
        deviceId: 'dev_RecoveryOwner01',
        identityVersion: 1
      },
      principalSnapshotDigest: '5'.repeat(64),
      workspaceId: '/private/owner/project-coordinator/content-recovery',
      executionContextDigest: '6'.repeat(64),
      invocationId: 'invocation_recovery_observation_0001'
    },
    root,
    expectedName,
    logicalInvocationId: 'worker-upload-recovery-0001',
    requestDigest: '1'.repeat(64),
    portableReference: recoveredFile,
    observation: {
      parent: root,
      reference: recoveredFile,
      name: expectedName,
      size: 41
    },
    observedAt: now,
    providerObservationDigest: '4'.repeat(64),
    contentObservationReceiptDigest: '2'.repeat(64),
    observationDigest: '3'.repeat(64)
  })
}

function linkResponseItems(workspace: ProjectCoordinatorWorkspace) {
  const project = workspace.projects[0]!
  const task = project.tasks[0]!.task
  const execution = project.tasks[0]!.executions[0]!
  const journal = project.provisioning.externalOperationJournal[0]!
  const action = project.provisioning.recoveryActions[0]!
  const resource = cloudResourceRefSchema.parse({
    schemaVersion: 1,
    type: 'resource_ref',
    resourceRefId: 'rrf_RecoveryOutput01',
    projectId,
    taskId,
    executionId,
    assignmentTaskRevision: 5,
    bindingRevision: 3,
    intentDigest: '7'.repeat(64),
    role: 'output-file',
    ordinal: 1,
    locator: recoveredFile,
    locatorDigest: stableDigest(recoveredFile),
    status: 'available',
    invalidatedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now
  })
  return [task, execution, journal, action, resource]
}

function abandonResponseItems(workspace: ProjectCoordinatorWorkspace) {
  const project = workspace.projects[0]!
  return [
    project.tasks[0]!.task,
    project.tasks[0]!.executions[0]!,
    project.provisioning.externalOperationJournal[0]!,
    project.provisioning.recoveryActions[0]!
  ]
}

function successorResponseItems(workspace: ProjectCoordinatorWorkspace) {
  const taskView = workspace.projects[0]!.tasks[0]!
  const execution = taskView.executions.find(({ executionId: id }) => (
    id === successorExecutionId
  ))!
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: 'ofr_RecoveryOffer002',
    projectId,
    taskId,
    executionId: successorExecutionId,
    assigneeUserId: 'usr_RecoveryWorker01',
    assigneeAgentId: 'agt_RecoveryWorker01',
    assigneeDeviceId: 'dev_RecoveryWorker01',
    state: 'pending',
    offeredAt: execution.offeredAt,
    expiresAt: '2026-08-27T02:00:00.000Z',
    respondedAt: null,
    rejectionReason: null,
    safeReasonDetail: null,
    revision: 1,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt
  })
  return [taskView.task, execution, offer]
}

function capabilityInvoker(
  invoke: (...input: any[]) => Promise<any>
): DomainMainSystemCapabilityInvoker {
  return {
    invoke: invoke as DomainMainSystemCapabilityInvoker['invoke'],
    createApprovedBatch: () => { throw new Error('recovery observation does not use a write batch') }
  }
}

function cloudTransport(
  execute: (payload: any) => Promise<AuthenticatedCloudResponse>
): AuthenticatedCloudTransport {
  return {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.invalid/',
      userId: ownerUserId,
      deviceId: 'dev_RecoveryOwner01'
    }),
    execute: async ({ payload }) => execute(payload)
  }
}

function coordinatorCloudService(
  execute: CoordinatorCloudCommandService['execute']
): CoordinatorCloudCommandService {
  return {
    execute,
    subscribe: () => () => undefined
  }
}

function collectionResponse(
  requestId: string,
  items: readonly unknown[]
): AuthenticatedCloudResponse {
  const body: RestResponse = restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId,
    items
  })
  return { contractVersion: 1, status: 200, body }
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}
