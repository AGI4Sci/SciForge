import { createHash, randomUUID } from 'node:crypto'

import {
  CURRENT_PROTOCOL_VERSION,
  cloudResourceRefSchema,
  externalOperationRecoveryJournalEntrySchema,
  taskExecutionSchema,
  taskOfferReassignCommandSchema,
  taskOfferSchema,
  taskRecoveryAbandonCommandSchema,
  taskRecoveryLinkObservedOutputCommandSchema,
  taskRecoveryObservedOutputSchema,
  taskSchema,
  visibleRecoveryActionSchema,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import type {
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  CONTENT_SPACE_SYSTEM_OBSERVE_EXACT_OUTPUT_CONTRACT
} from '@sciforge/domain-content-space/contract'
import type { DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  projectCoordinatorContentRecoveryAbandonInputSchema,
  projectCoordinatorContentRecoveryObserveLinkInputSchema,
  projectCoordinatorContentRecoveryRetrySuccessorInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorContentRecoveryAbandonInput,
  type ProjectCoordinatorContentRecoveryObserveLinkInput,
  type ProjectCoordinatorContentRecoveryRetrySuccessorInput,
  type ProjectCoordinatorProject,
  type ProjectCoordinatorWorkspace
} from './contract.js'

type WorkspaceReader = Readonly<{
  readWorkspace(input: Readonly<{ projectId?: string }>): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorRecoveryPort = Readonly<{
  observeAndLink(
    input: ProjectCoordinatorContentRecoveryObserveLinkInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  abandon(
    input: ProjectCoordinatorContentRecoveryAbandonInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  retrySuccessor(
    input: ProjectCoordinatorContentRecoveryRetrySuccessorInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
}>

type RecoveryTuple = Readonly<{
  workspace: ProjectCoordinatorWorkspace
  project: ProjectCoordinatorProject
  task: ProjectCoordinatorProject['tasks'][number]['task']
  execution: ProjectCoordinatorProject['tasks'][number]['executions'][number]
  action: ProjectCoordinatorProject['provisioning']['recoveryActions'][number]
  journal: ProjectCoordinatorProject['provisioning']['externalOperationJournal'][number]
  binding: NonNullable<ProjectCoordinatorProject['provisioning']['binding']>
  expectedName: string
}>

type RecoverySuccessorTuple = Readonly<{
  workspace: ProjectCoordinatorWorkspace
  project: ProjectCoordinatorProject
  task: ProjectCoordinatorProject['tasks'][number]['task']
  execution: ProjectCoordinatorProject['tasks'][number]['executions'][number]
  action: ProjectCoordinatorProject['provisioning']['recoveryActions'][number]
  journal: ProjectCoordinatorProject['provisioning']['externalOperationJournal'][number]
  previousOffer: ProjectCoordinatorProject['offers'][number]
  workerGroup: ProjectCoordinatorProject['workerGroups'][number]
}>

export function createProjectCoordinatorRecoveryPort(options: Readonly<{
  workspace: WorkspaceReader
  transport: AuthenticatedCloudTransport
  coordinatorCloudCommands: CoordinatorCloudCommandService
  getCapabilities(): DomainMainSystemCapabilityInvoker
  workspaceRoot: string | (() => string)
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorRecoveryPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const getWorkspaceRoot = (): string => {
    const workspaceRoot = (
      typeof options.workspaceRoot === 'function'
        ? options.workspaceRoot()
        : options.workspaceRoot
    ).trim()
    if (!workspaceRoot) throw new Error('Project Coordinator recovery Workspace is unavailable.')
    return workspaceRoot
  }

  const readTuple = async (
    projectId: string,
    recoveryActionId: string,
    mode: 'observe-link' | 'abandon'
  ): Promise<RecoveryTuple> => {
    const workspace = projectCoordinatorWorkspaceSchema.parse(
      await options.workspace.readWorkspace({ projectId })
    )
    const project = requireOwnerProject(workspace, projectId)
    const action = project.provisioning.recoveryActions.find((candidate) => (
      candidate.recoveryActionId === recoveryActionId
    ))
    if (!action || action.status !== 'available' || action.audience !== 'coordinator' ||
      action.taskId === null || action.executionId === null) {
      throw new Error('The exact current Coordinator recovery action is unavailable.')
    }
    if (mode === 'observe-link' && (
      action.action !== 'link_observed_output' || !action.requiresFreshObservation
    )) {
      throw new Error('Only an unresolved exact output accepts fresh observe-and-link recovery.')
    }
    if (mode === 'abandon' && ![
      'link_observed_output',
      'abandon_execution'
    ].includes(action.action)) {
      throw new Error('Only a Task execution recovery action can be abandoned.')
    }
    const taskView = project.tasks.find(({ task }) => task.taskId === action.taskId)
    const execution = taskView?.executions.find((candidate) => (
      candidate.executionId === action.executionId
    ))
    const journal = project.provisioning.externalOperationJournal.find((candidate) => (
      candidate.contentRecoveryJournalEntryId === action.journalEntryId
    ))
    const binding = project.provisioning.binding
    if (!taskView || !execution || !journal || !binding ||
      taskView.task.currentExecutionId !== execution.executionId ||
      action.projectId !== projectId ||
      journal.projectId !== projectId ||
      journal.taskId !== taskView.task.taskId ||
      journal.executionId !== execution.executionId ||
      journal.scope !== 'task_content_transfer' ||
      binding.projectId !== projectId) {
      throw new Error('The recovery action does not bind one exact current Project Task execution.')
    }
    if (taskView.task.status !== 'manual_recovery_required' ||
      execution.state !== 'manual_recovery_required' ||
      execution.fence.status !== 'fenced' ||
      execution.fence.reason !== 'manual_recovery_required' ||
      execution.fileIntent === null ||
      taskView.task.fileIntent === null ||
      execution.fileIntent.assignmentTaskRevision !==
        execution.fence.assignmentTaskRevision ||
      execution.fileIntent.output.fileName !== taskView.task.fileIntent.output.fileName ||
      execution.fileIntent.bindingRevision !== taskView.task.fileIntent.bindingRevision) {
      throw new Error('The exact Task, execution fence, or file intent is stale.')
    }
    if (mode === 'observe-link' && (
      binding.status !== 'active' ||
      binding.rootLocator === null ||
      binding.rootLocatorDigest === null ||
      execution.fence.bindingRevision !== binding.revision ||
      execution.fileIntent.bindingRevision !== binding.revision ||
      stableDigest(binding.rootLocator) !== binding.rootLocatorDigest
    )) {
      throw new Error('The active Content binding is stale for exact output observation.')
    }
    if (mode === 'observe-link' && (
      journal.state !== 'outcome_unknown' ||
      journal.operation !== 'upload_new'
    )) {
      throw new Error('Only one unknown upload-new journal can be observed and linked.')
    }
    if (mode === 'abandon' && ![
      'outcome_unknown',
      'observed_failure'
    ].includes(journal.state)) {
      throw new Error('Only an unresolved Task recovery journal can be abandoned.')
    }
    return Object.freeze({
      workspace,
      project,
      task: taskView.task,
      execution,
      action,
      journal,
      binding,
      expectedName: execution.fileIntent.output.fileName
    })
  }

  const readSuccessorTuple = async (
    input: ProjectCoordinatorContentRecoveryRetrySuccessorInput
  ): Promise<RecoverySuccessorTuple> => {
    const workspace = projectCoordinatorWorkspaceSchema.parse(
      await options.workspace.readWorkspace({ projectId: input.projectId })
    )
    const project = requireOwnerProject(workspace, input.projectId)
    const action = project.provisioning.recoveryActions.find(({ recoveryActionId }) => (
      recoveryActionId === input.recoveryActionId
    ))
    if (!action || action.status !== 'completed' || action.audience !== 'coordinator' ||
      action.taskId === null || action.executionId === null) {
      throw new Error('The exact completed Task recovery action is unavailable.')
    }
    const taskView = project.tasks.find(({ task }) => task.taskId === action.taskId)
    const execution = taskView?.executions.find(({ executionId }) => (
      executionId === action.executionId
    ))
    const journal = project.provisioning.externalOperationJournal.find(
      ({ contentRecoveryJournalEntryId }) => (
        contentRecoveryJournalEntryId === action.journalEntryId
      )
    )
    if (!taskView || !execution || !journal ||
      taskView.task.currentExecutionId !== execution.executionId ||
      journal.projectId !== input.projectId ||
      journal.taskId !== taskView.task.taskId ||
      journal.executionId !== execution.executionId ||
      journal.scope !== 'task_content_transfer') {
      throw new Error('The completed recovery action does not bind the current Task execution.')
    }
    if (taskView.task.status !== 'revision_requested' ||
      execution.state !== 'cancelled' ||
      execution.fence.status !== 'fenced' ||
      execution.fence.reason !== 'manual_recovery_abandoned' ||
      taskView.task.fileIntent === null ||
      execution.fileIntent === null ||
      execution.fileIntent.output.fileName !== taskView.task.fileIntent.output.fileName ||
      execution.fileIntent.bindingRevision !== taskView.task.fileIntent.bindingRevision ||
      !['abandoned', 'observed_failure'].includes(journal.state)) {
      throw new Error('Only one exact abandoned file execution may receive a successor retry.')
    }
    if (input.nextOutputFileName === taskView.task.fileIntent.output.fileName ||
      taskView.executions.some(({ fileIntent }) => (
        fileIntent?.output.fileName === input.nextOutputFileName
      ))) {
      throw new Error('A recovery successor requires a new no-overwrite output filename.')
    }
    const previousOffer = project.offers.find(({ executionId }) => executionId === execution.executionId)
    if (!previousOffer || previousOffer.state !== 'accepted') {
      throw new Error('The abandoned execution does not resolve to its claimed User-level offer.')
    }
    const workerGroup = project.workerGroups.find(({ userId }) => userId === input.workerUserId)
    if (!workerGroup || !workerGroup.agents.some(({ projectAvailability }) => (
      projectAvailability.availability.acceptsNewOffers
    ))) {
      throw new Error('The selected Worker User has no currently available Runtime.')
    }
    return Object.freeze({
      workspace,
      project,
      task: taskView.task,
      execution,
      action,
      journal,
      previousOffer,
      workerGroup
    })
  }

  return Object.freeze({
    observeAndLink: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorContentRecoveryObserveLinkInputSchema.parse(rawInput)
      const initial = await readTuple(input.projectId, input.recoveryActionId, 'observe-link')
      const workspaceRoot = getWorkspaceRoot()
      const contentResult = CONTENT_SPACE_SYSTEM_OBSERVE_EXACT_OUTPUT_CONTRACT.outputSchema.parse(
        await options.getCapabilities().invoke(
          CONTENT_SPACE_SYSTEM_OBSERVE_EXACT_OUTPUT_CONTRACT,
          CONTENT_SPACE_SYSTEM_OBSERVE_EXACT_OUTPUT_CONTRACT.inputSchema.parse({
            root: initial.binding.rootLocator,
            expectedName: initial.expectedName,
            logicalInvocationId: initial.journal.logicalInvocationId,
            requestDigest: initial.journal.requestDigest
          }),
          {
            workspaceId: workspaceRoot,
            systemExecutionContext: recoveryExecutionContext(initial)
          }
        )
      )
      if (!contentResult.ok) {
        throw new Error(
          `Exact Content Space recovery observation failed: ${contentResult.error.code}.`
        )
      }
      const receipt = contentResult.value
      if (receipt.execution.workspaceId !== workspaceRoot ||
        stableDigest(receipt.root) !== initial.binding.rootLocatorDigest ||
        receipt.expectedName !== initial.expectedName ||
        receipt.logicalInvocationId !== initial.journal.logicalInvocationId ||
        receipt.requestDigest !== initial.journal.requestDigest ||
        stableDigest(receipt.observation.parent) !== initial.binding.rootLocatorDigest ||
        receipt.observation.name !== initial.expectedName ||
        stableDigest(receipt.observation.reference) !==
          stableDigest(receipt.portableReference)) {
        throw new Error('Content Space did not return the exact bound recovery observation.')
      }

      const current = await readTuple(input.projectId, input.recoveryActionId, 'observe-link')
      if (stableDigest(recoveryTupleFacts(initial)) !== stableDigest(recoveryTupleFacts(current))) {
        throw new Error('Cloud recovery facts changed during the exact output observation.')
      }
      const observation = taskRecoveryObservedOutputSchema.parse({
        schemaVersion: 1,
        projectId: current.project.project.projectId,
        taskId: current.task.taskId,
        executionId: current.execution.executionId,
        assignmentTaskRevision: current.execution.fence.assignmentTaskRevision,
        bindingRevision: current.binding.revision,
        logicalInvocationId: current.journal.logicalInvocationId,
        requestDigest: current.journal.requestDigest,
        rootLocator: current.binding.rootLocator,
        rootLocatorDigest: current.binding.rootLocatorDigest,
        expectedName: current.expectedName,
        locator: receipt.portableReference,
        locatorDigest: stableDigest(receipt.portableReference),
        contentObservationReceiptDigest: receipt.contentObservationReceiptDigest,
        observationDigest: receipt.observationDigest,
        providerObservationDigest: receipt.providerObservationDigest,
        observedAt: receipt.observedAt
      })
      const command = taskRecoveryLinkObservedOutputCommandSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'task.recovery.link_observed_output',
        idempotencyKey,
        projectId: current.project.project.projectId,
        taskId: current.task.taskId,
        executionId: current.execution.executionId,
        recoveryActionId: current.action.recoveryActionId,
        journalEntryId: current.journal.contentRecoveryJournalEntryId,
        expectedTaskRevision: current.task.revision,
        expectedExecutionRevision: current.execution.revision,
        expectedRecoveryActionRevision: current.action.revision,
        expectedCoordinatorAuthorityEpoch:
          current.project.project.coordinatorAuthorityEpoch,
        observation
      })
      const response = await executeUserCloud(options.transport, command)
      requireExactLinkResponse(response, current, observation)
      const fresh = projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
      const linkedProject = requireOwnerProject(fresh, input.projectId)
      const linkedAction = linkedProject.provisioning.recoveryActions.find(({ recoveryActionId }) => (
        recoveryActionId === input.recoveryActionId
      ))
      const linkedJournal = linkedProject.provisioning.externalOperationJournal.find(
        ({ contentRecoveryJournalEntryId }) => (
          contentRecoveryJournalEntryId === current.journal.contentRecoveryJournalEntryId
        )
      )
      if (linkedAction?.status !== 'completed' ||
        linkedJournal?.state !== 'observed_success' ||
        linkedJournal.receiptDigest !== observation.contentObservationReceiptDigest ||
        linkedJournal.observationDigest !== observation.observationDigest) {
        throw new Error('The linked exact output was not observed in fresh Cloud facts.')
      }
      return fresh
    },

    abandon: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorContentRecoveryAbandonInputSchema.parse(rawInput)
      const current = await readTuple(input.projectId, input.recoveryActionId, 'abandon')
      const command = taskRecoveryAbandonCommandSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'task.recovery.abandon',
        idempotencyKey,
        projectId: current.project.project.projectId,
        taskId: current.task.taskId,
        executionId: current.execution.executionId,
        recoveryActionId: current.action.recoveryActionId,
        journalEntryId: current.journal.contentRecoveryJournalEntryId,
        expectedTaskRevision: current.task.revision,
        expectedExecutionRevision: current.execution.revision,
        expectedRecoveryActionRevision: current.action.revision,
        expectedCoordinatorAuthorityEpoch:
          current.project.project.coordinatorAuthorityEpoch,
        reason: input.reason
      })
      const response = await executeUserCloud(options.transport, command)
      requireExactAbandonResponse(response, current)
      const fresh = projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
      const abandonedProject = requireOwnerProject(fresh, input.projectId)
      const task = abandonedProject.tasks.find(({ task }) => (
        task.taskId === current.task.taskId
      ))
      const execution = task?.executions.find(({ executionId }) => (
        executionId === current.execution.executionId
      ))
      const action = abandonedProject.provisioning.recoveryActions.find(
        ({ recoveryActionId }) => recoveryActionId === input.recoveryActionId
      )
      const journal = abandonedProject.provisioning.externalOperationJournal.find(
        ({ contentRecoveryJournalEntryId }) => (
          contentRecoveryJournalEntryId === current.journal.contentRecoveryJournalEntryId
        )
      )
      const expectedJournalState = current.journal.state === 'outcome_unknown'
        ? 'abandoned'
        : current.journal.state
      if (task?.task.status !== 'revision_requested' ||
        execution?.state !== 'cancelled' ||
        execution.fence.reason !== 'manual_recovery_abandoned' ||
        action?.status !== 'completed' ||
        journal?.state !== expectedJournalState) {
        throw new Error('The abandoned execution was not observed in fresh Cloud facts.')
      }
      return fresh
    },

    retrySuccessor: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorContentRecoveryRetrySuccessorInputSchema.parse(rawInput)
      const current = await readSuccessorTuple(input)
      const nextFileIntent = {
        ...current.task.fileIntent!,
        output: {
          ...current.task.fileIntent!.output,
          fileName: input.nextOutputFileName
        }
      }
      const command = taskOfferReassignCommandSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'task.offer.reassign',
        idempotencyKey,
        taskId: current.task.taskId,
        previousTaskOfferId: current.previousOffer.taskOfferId,
        expectedPreviousOfferRevision: current.previousOffer.revision,
        expectedProjectRevision: current.project.project.revision,
        expectedTaskRevision: current.task.revision,
        expectedCoordinatorAuthorityEpoch:
          current.project.project.coordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch:
          current.project.project.executionAuthorityEpoch,
        workerUserId: current.workerGroup.userId,
        offerExpiresAt: input.offerExpiresAt,
        nextFileIntent
      })
      const response = await options.coordinatorCloudCommands.execute(command)
      const successorOfferId = requireExactSuccessorResponse(
        response,
        current,
        nextFileIntent
      )
      const fresh = projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
      requireFreshSuccessorWorkspace(
        fresh,
        current,
        successorOfferId,
        nextFileIntent
      )
      return fresh
    }
  })
}

function requireOwnerProject(
  workspace: ProjectCoordinatorWorkspace,
  projectId: string
): ProjectCoordinatorProject {
  if (workspace.connection.state !== 'ready') {
    throw new Error(`Project recovery is ${workspace.connection.state}.`)
  }
  const project = workspace.projects.find(({ project }) => project.projectId === projectId)
  if (!project) throw new Error('The exact Project is not visible to the current OIDC User.')
  if (workspace.connection.userId !== project.project.ownerUserId) {
    throw new Error('Only the OIDC owner of the current Coordinator Agent may recover a Task.')
  }
  if (project.project.status === 'completed' || project.project.status === 'cancelled') {
    throw new Error('A terminal Project cannot recover a Task output.')
  }
  return project
}

function recoveryExecutionContext(tuple: RecoveryTuple) {
  return Object.freeze({
    schemaVersion: 1,
    operation: 'output-recovery-observation' as const,
    projectId: tuple.project.project.projectId,
    taskId: tuple.task.taskId,
    executionId: tuple.execution.executionId,
    recoveryActionId: tuple.action.recoveryActionId,
    journalEntryId: tuple.journal.contentRecoveryJournalEntryId,
    coordinatorAgentId: tuple.project.project.coordinatorAgentId,
    coordinatorAuthorityEpoch: tuple.project.project.coordinatorAuthorityEpoch,
    expectedTaskRevision: tuple.task.revision,
    expectedExecutionRevision: tuple.execution.revision,
    assignmentTaskRevision: tuple.execution.fence.assignmentTaskRevision,
    bindingRevision: tuple.binding.revision,
    logicalInvocationId: tuple.journal.logicalInvocationId,
    requestDigest: tuple.journal.requestDigest,
    rootLocatorDigest: tuple.binding.rootLocatorDigest!,
    expectedName: tuple.expectedName
  })
}

function recoveryTupleFacts(tuple: RecoveryTuple) {
  return Object.freeze({
    projectId: tuple.project.project.projectId,
    coordinatorAgentId: tuple.project.project.coordinatorAgentId,
    coordinatorAuthorityEpoch: tuple.project.project.coordinatorAuthorityEpoch,
    task: tuple.task,
    execution: tuple.execution,
    action: tuple.action,
    journal: tuple.journal,
    binding: tuple.binding,
    expectedName: tuple.expectedName
  })
}

function requireExactLinkResponse(
  response: RestResponse,
  current: RecoveryTuple,
  observation: ReturnType<typeof taskRecoveryObservedOutputSchema.parse>
): void {
  if (response.type !== 'rest.collection') {
    throw new Error(`Task output recovery returned ${response.type}.`)
  }
  const task = findParsed(response.items, taskSchema, (candidate) => (
    candidate.taskId === current.task.taskId
  ))
  const execution = findParsed(response.items, taskExecutionSchema, (candidate) => (
    candidate.executionId === current.execution.executionId
  ))
  const journal = findParsed(
    response.items,
    externalOperationRecoveryJournalEntrySchema,
    (candidate) => candidate.contentRecoveryJournalEntryId ===
      current.journal.contentRecoveryJournalEntryId
  )
  const action = findParsed(response.items, visibleRecoveryActionSchema, (candidate) => (
    candidate.recoveryActionId === current.action.recoveryActionId
  ))
  const resource = findParsed(response.items, cloudResourceRefSchema, (candidate) => (
    candidate.taskId === current.task.taskId &&
    candidate.executionId === current.execution.executionId &&
    candidate.role === 'output-file'
  ))
  if (!task || task.revision !== current.task.revision ||
    task.status !== 'manual_recovery_required' ||
    !execution || execution.revision !== current.execution.revision ||
    execution.state !== 'manual_recovery_required' ||
    !journal || journal.revision !== current.journal.revision + 1 ||
    journal.state !== 'observed_success' ||
    journal.receiptDigest !== observation.contentObservationReceiptDigest ||
    journal.observationDigest !== observation.observationDigest ||
    !action || action.revision !== current.action.revision + 1 ||
    action.status !== 'completed' ||
    !resource || resource.status !== 'available' ||
    resource.assignmentTaskRevision !== observation.assignmentTaskRevision ||
    resource.bindingRevision !== observation.bindingRevision ||
    resource.locatorDigest !== observation.locatorDigest ||
    stableDigest(resource.locator) !== observation.locatorDigest) {
    throw new Error('Cloud did not return the exact linked recovery facts.')
  }
}

function requireExactAbandonResponse(
  response: RestResponse,
  current: RecoveryTuple
): void {
  if (response.type !== 'rest.collection') {
    throw new Error(`Task recovery abandon returned ${response.type}.`)
  }
  const task = findParsed(response.items, taskSchema, ({ taskId }) => (
    taskId === current.task.taskId
  ))
  const execution = findParsed(response.items, taskExecutionSchema, ({ executionId }) => (
    executionId === current.execution.executionId
  ))
  const journal = findParsed(
    response.items,
    externalOperationRecoveryJournalEntrySchema,
    ({ contentRecoveryJournalEntryId }) => contentRecoveryJournalEntryId ===
      current.journal.contentRecoveryJournalEntryId
  )
  const action = findParsed(response.items, visibleRecoveryActionSchema, ({ recoveryActionId }) => (
    recoveryActionId === current.action.recoveryActionId
  ))
  const expectedJournalRevision = current.journal.state === 'outcome_unknown'
    ? current.journal.revision + 1
    : current.journal.revision
  if (!task || task.revision !== current.task.revision + 1 ||
    task.status !== 'revision_requested' ||
    !execution || execution.revision !== current.execution.revision + 1 ||
    execution.state !== 'cancelled' ||
    execution.fence.reason !== 'manual_recovery_abandoned' ||
    !journal || journal.revision !== expectedJournalRevision ||
    journal.state !== 'abandoned' ||
    !action || action.revision !== current.action.revision + 1 ||
    action.status !== 'completed') {
    throw new Error('Cloud did not return the exact abandoned recovery facts.')
  }
}

function requireExactSuccessorResponse(
  response: RestResponse,
  current: RecoverySuccessorTuple,
  nextFileIntent: NonNullable<RecoverySuccessorTuple['task']['fileIntent']>
): string {
  if (response.type === 'rest.error') {
    throw new Error(
      `Recovery successor failed: ${response.error.code}: ${response.error.message}`
    )
  }
  if (response.type !== 'rest.collection') {
    throw new Error(`Recovery successor returned ${response.type}.`)
  }
  const task = findParsed(response.items, taskSchema, ({ taskId }) => (
    taskId === current.task.taskId
  ))
  const offer = findParsed(response.items, taskOfferSchema, (candidate) => (
    candidate.taskId === current.task.taskId && candidate.taskOfferId !== current.previousOffer.taskOfferId
  ))
  if (!task || task.revision !== current.task.revision + 1 ||
    task.currentExecutionId !== null ||
    task.currentExecutionState !== null ||
    task.status !== 'offered' ||
    task.executionCount !== current.task.executionCount ||
    stableDigest(task.fileIntent) !== stableDigest(nextFileIntent) ||
    !offer || offer.state !== 'pending' || offer.executionId !== null ||
    offer.workerUserId !== current.workerGroup.userId) {
    throw new Error('Cloud did not return the exact freshly named User-level successor offer.')
  }
  return offer.taskOfferId
}

function requireFreshSuccessorWorkspace(
  workspace: ProjectCoordinatorWorkspace,
  current: RecoverySuccessorTuple,
  successorOfferId: string,
  nextFileIntent: NonNullable<RecoverySuccessorTuple['task']['fileIntent']>
): void {
  const project = requireOwnerProject(workspace, current.project.project.projectId)
  const taskView = project.tasks.find(({ task }) => task.taskId === current.task.taskId)
  const oldExecution = taskView?.executions.find(({ executionId }) => (
    executionId === current.execution.executionId
  ))
  const successorOffer = project.offers.find(({ taskOfferId }) => taskOfferId === successorOfferId)
  const action = project.provisioning.recoveryActions.find(({ recoveryActionId }) => (
    recoveryActionId === current.action.recoveryActionId
  ))
  if (!taskView || taskView.task.currentExecutionId !== null ||
    taskView.task.currentExecutionState !== null ||
    taskView.task.status !== 'offered' ||
    taskView.task.executionCount !== current.task.executionCount ||
    stableDigest(taskView.task.fileIntent) !== stableDigest(nextFileIntent) ||
    !successorOffer || successorOffer.workerUserId !== current.workerGroup.userId ||
    successorOffer.executionId !== null || successorOffer.state !== 'pending' ||
    !oldExecution || oldExecution.state !== 'cancelled' ||
    oldExecution.fence.status !== 'fenced' ||
    oldExecution.fence.reason !== 'manual_recovery_abandoned' ||
    action?.status !== 'completed') {
    throw new Error('The fresh Cloud workspace did not retain the fenced old execution and User-level successor offer.')
  }
}

function findParsed<Output>(
  items: readonly unknown[],
  schema: Readonly<{ safeParse(value: unknown): Readonly<{
    success: boolean
    data?: Output
  }> }>,
  predicate: (value: Output) => boolean
): Output | undefined {
  for (const item of items) {
    const parsed = schema.safeParse(item)
    if (parsed.success && parsed.data !== undefined && predicate(parsed.data)) {
      return parsed.data
    }
  }
  return undefined
}

async function executeUserCloud(
  transport: AuthenticatedCloudTransport,
  payload: Parameters<AuthenticatedCloudTransport['execute']>[0]['payload']
): Promise<RestResponse> {
  const response = await transport.execute({
    contractVersion: 1,
    operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
    payload
  })
  if (response.status >= 400 || response.body.type === 'rest.error') {
    const detail = response.body.type === 'rest.error'
      ? `${response.body.error.code}: ${response.body.error.message}`
      : `HTTP ${response.status}`
    throw new Error(`SciForge Cloud request failed: ${detail}`)
  }
  return response.body
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}
