import { createHash, randomUUID } from 'node:crypto'

import {
  CURRENT_PROTOCOL_VERSION,
  taskExecutionSchema,
  taskFileDestinationNamesAreUnique,
  taskOfferReassignCommandSchema,
  taskOfferSchema,
  taskSchema,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import type {
  CoordinatorCloudCommand,
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'

import {
  projectCoordinatorTaskOfferReassignInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorProject,
  type ProjectCoordinatorTaskOfferReassignInput,
  type ProjectCoordinatorWorkspace
} from './contract.js'

type WorkspaceReader = Readonly<{
  readWorkspace(input: Readonly<{ projectId?: string }>): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorTaskOfferReassignmentPort = Readonly<{
  reassign(
    input: ProjectCoordinatorTaskOfferReassignInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
}>

type ReassignmentTuple = Readonly<{
  project: ProjectCoordinatorProject
  taskView: ProjectCoordinatorProject['tasks'][number]
  previousOffer: ProjectCoordinatorProject['offers'][number]
  previousExecution: ProjectCoordinatorProject['tasks'][number]['executions'][number] | null
  nextFileIntent: ProjectCoordinatorProject['tasks'][number]['task']['fileIntent']
}>

type CommittedReassignment = Readonly<{
  task: ProjectCoordinatorProject['tasks'][number]['task']
  offer: ProjectCoordinatorProject['offers'][number]
}>

type TaskOfferReassignCommand = Extract<
  CoordinatorCloudCommand,
  { type: 'task.offer.reassign' }
>

type NormalizedTaskOfferReassignInput = Readonly<
  Omit<ProjectCoordinatorTaskOfferReassignInput, 'nextOutputFileName'> & {
    nextOutputFileName: string | null
  }
>

export function createProjectCoordinatorTaskOfferReassignmentPort(options: Readonly<{
  workspace: WorkspaceReader
  coordinatorCloudCommands: Omit<CoordinatorCloudCommandService, 'localAgentId'>
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorTaskOfferReassignmentPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)

  return Object.freeze({
    reassign: async (rawInput, idempotencyKey) => {
      const parsedInput = projectCoordinatorTaskOfferReassignInputSchema.parse(rawInput)
      const input = {
        ...parsedInput,
        nextOutputFileName: parsedInput.nextOutputFileName ?? null
      }
      const observed = projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
      requireReassignmentAuthority(observed, input)
      const replay = await options.coordinatorCloudCommands.resume(
        idempotencyKey,
        (command) => { requireExactReplayedCommand(command, idempotencyKey, input) }
      )
      let current: ReassignmentTuple | null = null
      let command: TaskOfferReassignCommand
      let response: RestResponse
      if (replay) {
        command = requireExactReplayedCommand(replay.command, idempotencyKey, input)
        response = replay.response
      } else {
        current = requireReassignmentTuple(observed, input)
        command = taskOfferReassignCommandSchema.parse({
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          requestId: requestId(),
          type: 'task.offer.reassign',
          idempotencyKey,
          taskId: current.taskView.task.taskId,
          previousTaskOfferId: current.previousOffer.taskOfferId,
          expectedPreviousOfferRevision: current.previousOffer.revision,
          expectedProjectRevision: current.project.project.revision,
          expectedTaskRevision: current.taskView.task.revision,
          expectedCoordinatorAuthorityEpoch:
            current.project.project.coordinatorAuthorityEpoch,
          expectedExecutionAuthorityEpoch:
            current.project.project.executionAuthorityEpoch,
          workerUserId: input.workerUserId,
          offerExpiresAt: input.offerExpiresAt,
          nextFileIntent: current.nextFileIntent
        })
        response = await options.coordinatorCloudCommands.execute(command)
      }
      const committed = requireExactReassignmentResponse(
        response,
        command,
        input,
        current
      )
      const fresh = projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
      requireFreshReassignment(fresh, input, command, current, committed)
      return fresh
    }
  })
}

function requireExactReplayedCommand(
  rawCommand: CoordinatorCloudCommand,
  idempotencyKey: string,
  input: NormalizedTaskOfferReassignInput
): TaskOfferReassignCommand {
  const command = taskOfferReassignCommandSchema.parse(rawCommand)
  if (command.idempotencyKey !== idempotencyKey ||
      command.taskId !== input.taskId ||
      command.previousTaskOfferId !== input.previousTaskOfferId ||
      command.workerUserId !== input.workerUserId ||
      command.offerExpiresAt !== input.offerExpiresAt ||
      (command.nextFileIntent?.output.fileName ?? null) !== input.nextOutputFileName) {
    throw new Error('The durable Task offer reassignment command does not match this invocation.')
  }
  return command
}

function requireReassignmentTuple(
  workspace: ProjectCoordinatorWorkspace,
  input: NormalizedTaskOfferReassignInput
): ReassignmentTuple {
  const project = requireReassignmentAuthority(workspace, input)
  if (project.project.status !== 'active') {
    throw new Error('Task offer reassignment requires an active Project.')
  }
  const taskView = project.tasks.find(({ task }) => task.taskId === input.taskId)
  if (!taskView || taskView.task.status !== 'revision_requested') {
    throw new Error('Task offer reassignment requires the exact current revision-requested Task.')
  }
  if (taskView.task.executionCount >= taskView.task.maxRetries + 1) {
    throw new Error('The Task retry budget is exhausted.')
  }
  const previousOffer = project.offers.find(({ taskOfferId }) => (
    taskOfferId === input.previousTaskOfferId
  ))
  if (!previousOffer || previousOffer.taskId !== taskView.task.taskId ||
      previousOffer.projectId !== project.project.projectId) {
    throw new Error('Reassignment must name the exact previous offer for this Task.')
  }

  let previousExecution: ReassignmentTuple['previousExecution'] = null
  if (previousOffer.executionId === null) {
    if (taskView.task.currentExecutionId !== null ||
        taskView.task.currentExecutionState !== null ||
        !['rejected', 'withdrawn', 'timed_out'].includes(previousOffer.state) ||
        previousOffer.reassignmentTaskRevision !== taskView.task.revision) {
      throw new Error('The previous unclaimed offer is not the current terminal Task offer.')
    }
  } else {
    previousExecution = taskView.executions.find(({ executionId }) => (
      executionId === previousOffer.executionId
    )) ?? null
    if (previousOffer.state !== 'accepted' ||
        taskView.task.currentExecutionId !== previousOffer.executionId ||
        !previousExecution ||
        previousExecution.taskId !== taskView.task.taskId ||
        previousExecution.projectId !== project.project.projectId ||
        taskView.task.currentExecutionState !== previousExecution.state ||
        !['failed', 'cancelled', 'revoked'].includes(previousExecution.state) ||
        previousExecution.fence.status !== 'fenced') {
      throw new Error('The previous offer is not bound to the current terminal fenced execution.')
    }
  }

  let nextFileIntent: ReassignmentTuple['nextFileIntent']
  if (taskView.task.fileIntent === null) {
    if (input.nextOutputFileName !== null) {
      throw new Error('A text Task cannot receive an output filename.')
    }
    nextFileIntent = null
  } else {
    const nextOutputFileName = input.nextOutputFileName
    if (nextOutputFileName === null) {
      throw new Error('A file Task reassignment requires a new output filename.')
    }
    const binding = project.provisioning.binding
    if (!binding || binding.status !== 'active' ||
        binding.revision !== taskView.task.fileIntent.bindingRevision) {
      throw new Error('The Task file intent is not bound to the exact active Project content revision.')
    }
    const usedOutputNames = [
      taskView.task.fileIntent.output.fileName,
      ...taskView.executions.flatMap(({ fileIntent }) => (
        fileIntent ? [fileIntent.output.fileName] : []
      ))
    ]
    if (usedOutputNames.some((usedOutputName) => (
      !taskFileDestinationNamesAreUnique([usedOutputName, nextOutputFileName])
    ))) {
      throw new Error('A file Task successor requires a new no-overwrite output filename.')
    }
    nextFileIntent = {
      ...taskView.task.fileIntent,
      output: {
        ...taskView.task.fileIntent.output,
        fileName: nextOutputFileName
      }
    }
  }

  return Object.freeze({ project, taskView, previousOffer, previousExecution, nextFileIntent })
}

function requireReassignmentAuthority(
  workspace: ProjectCoordinatorWorkspace,
  input: NormalizedTaskOfferReassignInput
): ProjectCoordinatorProject {
  if (workspace.connection.state !== 'ready') {
    throw new Error(`Task offer reassignment is ${workspace.connection.state}.`)
  }
  const project = workspace.projects.find(({ project }) => (
    project.projectId === input.projectId
  ))
  if (!project) throw new Error('The exact Project is not visible to the current OIDC User.')
  if (workspace.connection.userId !== project.project.ownerUserId) {
    throw new Error('Only the OIDC owner of the current Coordinator Agent may reassign a Task.')
  }
  return project
}

function requireExactReassignmentResponse(
  response: RestResponse,
  command: TaskOfferReassignCommand,
  input: NormalizedTaskOfferReassignInput,
  current: ReassignmentTuple | null
): CommittedReassignment {
  if (response.type === 'rest.error') {
    throw new Error(`Task offer reassignment failed: ${response.error.code}: ${response.error.message}`)
  }
  if (
    response.type !== 'rest.collection' ||
    response.requestId !== command.requestId ||
    response.nextCursor !== undefined ||
    response.items.length !== 2
  ) {
    throw new Error(`Task offer reassignment returned ${response.type}.`)
  }
  const tasks = response.items.flatMap((item) => {
    const parsed = taskSchema.safeParse(item)
    return parsed.success && parsed.data.taskId === command.taskId
      ? [parsed.data]
      : []
  })
  const offers = response.items.flatMap((item) => {
    const parsed = taskOfferSchema.safeParse(item)
    return parsed.success && parsed.data.taskId === command.taskId &&
      parsed.data.taskOfferId !== command.previousTaskOfferId
      ? [parsed.data]
      : []
  })
  const executions = response.items.flatMap((item) => {
    const parsed = taskExecutionSchema.safeParse(item)
    return parsed.success && parsed.data.taskId === command.taskId
      ? [parsed.data]
      : []
  })
  const task = tasks.length === 1 ? tasks[0] : undefined
  const offer = offers.length === 1 ? offers[0] : undefined
  if (!task || task.projectId !== input.projectId ||
      task.revision !== command.expectedTaskRevision + 1 ||
      task.status !== 'offered' || task.currentExecutionId !== null ||
      task.currentExecutionState !== null ||
      (current !== null && task.executionCount !== current.taskView.task.executionCount) ||
      task.completedAt !== null ||
      stableDigest(task.fileIntent) !== stableDigest(command.nextFileIntent) ||
      executions.length !== 0 ||
      !offer || offer.projectId !== input.projectId ||
      offer.workerUserId !== input.workerUserId ||
      (current !== null &&
        offer.offeredByCoordinatorAgentId !== current.project.project.coordinatorAgentId) ||
      offer.state !== 'pending' || offer.revision !== 1 ||
      offer.executionId !== null || offer.respondedAt !== null ||
      offer.expiresAt !== input.offerExpiresAt) {
    throw new Error('Cloud did not return the exact pending successor Task offer.')
  }
  return Object.freeze({ task, offer })
}

function requireFreshReassignment(
  workspace: ProjectCoordinatorWorkspace,
  input: NormalizedTaskOfferReassignInput,
  command: TaskOfferReassignCommand,
  current: ReassignmentTuple | null,
  committed: CommittedReassignment
): void {
  const project = workspace.projects.find(({ project }) => (
    project.projectId === input.projectId
  ))
  if (workspace.connection.state !== 'ready' || !project ||
      workspace.connection.userId !== project.project.ownerUserId ||
      (current !== null &&
        project.project.ownerUserId !== current.project.project.ownerUserId)) {
    throw new Error('The reassigned Project is no longer visible to its OIDC owner.')
  }
  const taskView = project?.tasks.find(({ task }) => task.taskId === input.taskId)
  const successor = project?.offers.find(({ taskOfferId }) => (
    taskOfferId === committed.offer.taskOfferId
  ))
  const previousOffer = project?.offers.find(({ taskOfferId }) => (
    taskOfferId === command.previousTaskOfferId
  ))
  const previousExecutionId = current?.previousExecution?.executionId ??
    previousOffer?.executionId ?? null
  const previousExecution = previousExecutionId === null
    ? null
    : taskView?.executions.find(({ executionId }) => (
        executionId === previousExecutionId
      )) ?? null
  const successorExecution = successor?.executionId
    ? taskView?.executions.find(({ executionId }) => (
        executionId === successor.executionId
      )) ?? null
    : null
  const expectedProjectRevision = current?.project.project.revision ??
    command.expectedProjectRevision
  const previousAuthorityPreserved = current !== null
    ? previousOffer !== undefined &&
      stableDigest(previousOffer) === stableDigest(current.previousOffer) &&
      (current.previousExecution === null || (
        previousExecution !== null &&
        stableDigest(previousExecution) === stableDigest(current.previousExecution)
      ))
    : preservesReplayedPreviousAuthority(
        previousOffer,
        previousExecution,
        command,
        input
      )
  if (project.project.revision < expectedProjectRevision ||
      project.project.coordinatorAuthorityEpoch < command.expectedCoordinatorAuthorityEpoch ||
      project.project.executionAuthorityEpoch < command.expectedExecutionAuthorityEpoch ||
      (current !== null &&
        project.project.revision === current.project.project.revision &&
        stableDigest(project.project) !== stableDigest(current.project.project)) ||
      !taskView || taskView.task.revision < committed.task.revision ||
      taskView.task.executionCount < committed.task.executionCount ||
      (taskView.task.revision === committed.task.revision &&
        stableDigest(taskView.task) !== stableDigest(committed.task)) ||
      !successor ||
      !sameOfferIdentity(successor, committed.offer) ||
      !successorProgressIsCausal(taskView, successor, successorExecution, committed, input) ||
      !previousAuthorityPreserved) {
    throw new Error('Fresh Cloud facts did not preserve the exact reassignment transition.')
  }
}

function successorProgressIsCausal(
  taskView: ProjectCoordinatorProject['tasks'][number],
  successor: ProjectCoordinatorProject['offers'][number],
  successorExecution: ProjectCoordinatorProject['tasks'][number]['executions'][number] | null,
  committed: CommittedReassignment,
  input: NormalizedTaskOfferReassignInput
): boolean {
  if (successor.state === 'pending') {
    return successor.revision === committed.offer.revision &&
      taskView.task.revision === committed.task.revision &&
      stableDigest(successor) === stableDigest(committed.offer)
  }
  if (successor.state === 'accepted') {
    return successor.revision === committed.offer.revision + 1 &&
      successor.reassignmentTaskRevision === null &&
      taskView.task.revision >= committed.task.revision + 1 &&
      taskView.task.executionCount >= committed.task.executionCount + 1 &&
      successorExecution !== null &&
      successorExecution.taskId === input.taskId &&
      successorExecution.projectId === input.projectId &&
      successorExecution.assigneeUserId === input.workerUserId
  }
  const causalTaskRevision = committed.task.revision + 1
  return successor.revision === committed.offer.revision + 1 &&
    successor.executionId === null &&
    successor.reassignmentTaskRevision === causalTaskRevision &&
    taskView.task.revision >= causalTaskRevision
}

function preservesReplayedPreviousAuthority(
  previousOffer: ProjectCoordinatorProject['offers'][number] | undefined,
  previousExecution: ProjectCoordinatorProject['tasks'][number]['executions'][number] | null,
  command: TaskOfferReassignCommand,
  input: NormalizedTaskOfferReassignInput
): boolean {
  if (!previousOffer ||
      previousOffer.taskOfferId !== command.previousTaskOfferId ||
      previousOffer.taskId !== input.taskId ||
      previousOffer.projectId !== input.projectId ||
      previousOffer.revision !== command.expectedPreviousOfferRevision) return false
  if (previousOffer.executionId === null) {
    return ['rejected', 'withdrawn', 'timed_out'].includes(previousOffer.state) &&
      previousOffer.reassignmentTaskRevision === command.expectedTaskRevision
  }
  return previousOffer.state === 'accepted' &&
    previousExecution !== null &&
    previousExecution.executionId === previousOffer.executionId &&
    previousExecution.taskId === input.taskId &&
    previousExecution.projectId === input.projectId &&
    ['failed', 'cancelled', 'revoked'].includes(previousExecution.state) &&
    previousExecution.fence.status === 'fenced'
}

function sameOfferIdentity(
  left: ProjectCoordinatorProject['offers'][number],
  right: ProjectCoordinatorProject['offers'][number]
): boolean {
  return left.taskOfferId === right.taskOfferId &&
    left.projectId === right.projectId &&
    left.taskId === right.taskId &&
    left.workerUserId === right.workerUserId &&
    left.offeredByCoordinatorAgentId === right.offeredByCoordinatorAgentId &&
    left.offeredAt === right.offeredAt &&
    left.expiresAt === right.expiresAt &&
    left.createdAt === right.createdAt
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
