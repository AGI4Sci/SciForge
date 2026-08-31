import { randomUUID } from 'node:crypto'

import {
  CURRENT_PROTOCOL_VERSION,
  restResponseSchema,
  taskOfferExtendCommandSchema,
  taskOfferWithdrawCommandSchema,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import type {
  CoordinatorCloudCommand,
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'

import {
  projectCoordinatorTaskOfferExtendInputSchema,
  projectCoordinatorTaskOfferWithdrawInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorProject,
  type ProjectCoordinatorTaskOfferExtendInput,
  type ProjectCoordinatorTaskOfferWithdrawInput,
  type ProjectCoordinatorWorkspace
} from './contract.js'

type WorkspaceReader = Readonly<{
  readWorkspace(input: Readonly<{ projectId?: string }>): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorTaskOfferControlsPort = Readonly<{
  withdraw(
    input: ProjectCoordinatorTaskOfferWithdrawInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  extend(
    input: ProjectCoordinatorTaskOfferExtendInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
}>

type TaskOfferCommand = Extract<CoordinatorCloudCommand, {
  type: 'task.offer.withdraw' | 'task.offer.extend'
}>

export function createProjectCoordinatorTaskOfferControlsPort(options: Readonly<{
  workspace: WorkspaceReader
  coordinatorCloudCommands: CoordinatorCloudCommandService
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorTaskOfferControlsPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  return Object.freeze({
    withdraw: (rawInput, idempotencyKey) => runControl({
      kind: 'withdraw',
      rawInput,
      idempotencyKey,
      requestId: requestId(),
      workspace: options.workspace,
      coordinatorCloudCommands: options.coordinatorCloudCommands
    }),
    extend: (rawInput, idempotencyKey) => runControl({
      kind: 'extend',
      rawInput,
      idempotencyKey,
      requestId: requestId(),
      workspace: options.workspace,
      coordinatorCloudCommands: options.coordinatorCloudCommands
    })
  })
}

async function runControl(options: Readonly<{
  kind: 'withdraw' | 'extend'
  rawInput: ProjectCoordinatorTaskOfferWithdrawInput | ProjectCoordinatorTaskOfferExtendInput
  idempotencyKey: string
  requestId: `req_${string}`
  workspace: WorkspaceReader
  coordinatorCloudCommands: CoordinatorCloudCommandService
}>): Promise<ProjectCoordinatorWorkspace> {
  const input = options.kind === 'withdraw'
    ? projectCoordinatorTaskOfferWithdrawInputSchema.parse(options.rawInput)
    : projectCoordinatorTaskOfferExtendInputSchema.parse(options.rawInput)
  const observed = projectCoordinatorWorkspaceSchema.parse(
    await options.workspace.readWorkspace({ projectId: input.projectId })
  )
  const replay = await options.coordinatorCloudCommands.resume(
    options.idempotencyKey,
    (replayed) => validateReplayInput(replayed, options.kind, input, options.idempotencyKey)
  )
  let command: TaskOfferCommand
  if (replay) {
    if (options.kind === 'withdraw' && replay.command.type === 'task.offer.withdraw') {
      command = replay.command
    } else if (options.kind === 'extend' && replay.command.type === 'task.offer.extend') {
      command = replay.command
    } else {
      throw new Error('The durable Task offer control replay has the wrong command type.')
    }
  } else {
    const current = requirePendingOffer(observed, input.projectId, input.taskId, input.taskOfferId)
    if (current.project.project.status !== 'active') {
      throw new Error('Task offer controls require an active Project.')
    }
    if (options.kind === 'withdraw') {
      const withdraw = input as ProjectCoordinatorTaskOfferWithdrawInput
      command = taskOfferWithdrawCommandSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: options.requestId,
        type: 'task.offer.withdraw',
        idempotencyKey: options.idempotencyKey,
        taskOfferId: current.offer.taskOfferId,
        taskId: current.task.taskId,
        expectedTaskRevision: current.task.revision,
        expectedOfferRevision: current.offer.revision,
        expectedCoordinatorAuthorityEpoch: current.project.project.coordinatorAuthorityEpoch,
        reason: withdraw.reason
      })
    } else {
      const extend = input as ProjectCoordinatorTaskOfferExtendInput
      command = taskOfferExtendCommandSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: options.requestId,
        type: 'task.offer.extend',
        idempotencyKey: options.idempotencyKey,
        taskOfferId: current.offer.taskOfferId,
        taskId: current.task.taskId,
        expectedTaskRevision: current.task.revision,
        expectedOfferRevision: current.offer.revision,
        expectedCoordinatorAuthorityEpoch: current.project.project.coordinatorAuthorityEpoch,
        offerExpiresAt: extend.offerExpiresAt
      })
    }
  }
  const response = replay
    ? replay.response
    : await options.coordinatorCloudCommands.execute(command)
  requireControlResponse(response, command)

  const fresh = projectCoordinatorWorkspaceSchema.parse(
    await options.workspace.readWorkspace({ projectId: input.projectId })
  )
  const freshTask = fresh.projects
    .flatMap(({ tasks }) => tasks)
    .find(({ task }) => task.taskId === input.taskId)
  const freshOffer = fresh.projects
    .flatMap(({ offers }) => offers)
    .find((offer) => offer.taskOfferId === input.taskOfferId)
  if (!freshTask || !freshOffer || freshOffer.taskId !== freshTask.task.taskId) {
    throw new Error('The controlled Task offer disappeared from the fresh workspace.')
  }
  if (options.kind === 'withdraw') {
    if (freshTask.task.status !== 'revision_requested' || freshOffer.state !== 'withdrawn' ||
        freshTask.task.revision !== command.expectedTaskRevision + 1 ||
        freshOffer.revision !== command.expectedOfferRevision + 1) {
      throw new Error('The withdrawn Task offer was not committed in the fresh workspace.')
    }
  } else {
    const extend = input as ProjectCoordinatorTaskOfferExtendInput
    if (freshTask.task.status !== 'offered' || freshOffer.state !== 'pending' ||
        freshTask.task.revision !== command.expectedTaskRevision ||
        freshOffer.revision !== command.expectedOfferRevision + 1 ||
        freshOffer.expiresAt !== extend.offerExpiresAt) {
      throw new Error('The extended Task offer was not committed in the fresh workspace.')
    }
  }
  return fresh
}

function requirePendingOffer(
  workspace: ProjectCoordinatorWorkspace,
  projectId: string,
  taskId: string,
  taskOfferId: string
): Readonly<{
  project: ProjectCoordinatorProject
  task: ProjectCoordinatorProject['tasks'][number]['task']
  offer: ProjectCoordinatorProject['offers'][number]
}> {
  const project = workspace.projects.find(({ project: value }) => value.projectId === projectId)
  if (!project) throw new Error('The requested Project is not present in the workspace.')
  const taskView = project.tasks.find(({ task }) => task.taskId === taskId)
  const offer = project.offers.find(({ taskOfferId: id }) => id === taskOfferId)
  if (!taskView || !offer || offer.taskId !== taskId || offer.projectId !== projectId ||
      offer.state !== 'pending' || offer.executionId !== null ||
      taskView.task.status !== 'offered' || taskView.task.currentExecutionId !== null) {
    throw new Error('Only the current pending Task offer can be controlled.')
  }
  return { project, task: taskView.task, offer }
}

function validateReplayInput(
  raw: CoordinatorCloudCommand,
  kind: 'withdraw' | 'extend',
  input: ProjectCoordinatorTaskOfferWithdrawInput | ProjectCoordinatorTaskOfferExtendInput,
  idempotencyKey: string
): void {
  if (raw.idempotencyKey !== idempotencyKey) {
    throw new Error('The durable Task offer control command does not match this invocation.')
  }
  if (kind === 'withdraw') {
    if (raw.type !== 'task.offer.withdraw' || raw.taskId !== input.taskId ||
        raw.taskOfferId !== input.taskOfferId ||
        raw.reason !== (input as ProjectCoordinatorTaskOfferWithdrawInput).reason) {
      throw new Error('The durable Task offer control command does not match this invocation.')
    }
  } else if (raw.type !== 'task.offer.extend' || raw.taskId !== input.taskId ||
      raw.taskOfferId !== input.taskOfferId ||
      raw.offerExpiresAt !== (input as ProjectCoordinatorTaskOfferExtendInput).offerExpiresAt) {
    throw new Error('The durable Task offer control command does not match this invocation.')
  }
}

function requireControlResponse(
  rawResponse: RestResponse,
  command: TaskOfferCommand
): void {
  const response = restResponseSchema.parse(rawResponse)
  if (response.type !== 'rest.collection' || response.requestId !== command.requestId ||
      response.items.length !== 2) {
    throw new Error('The Cloud Task offer control response is invalid.')
  }
  const [task, offer] = response.items
  if (task?.type !== 'task' || offer?.type !== 'task_offer' ||
      task.taskId !== command.taskId || offer.taskOfferId !== command.taskOfferId ||
      task.projectId !== offer.projectId || offer.executionId !== null) {
    throw new Error('The Cloud Task offer control response targets the wrong resources.')
  }
  if (command.type === 'task.offer.withdraw') {
    if (task.status !== 'revision_requested' || offer.state !== 'withdrawn' ||
        task.revision !== command.expectedTaskRevision + 1 ||
        offer.revision !== command.expectedOfferRevision + 1) {
      throw new Error('The Cloud did not withdraw the expected Task offer.')
    }
  } else if (task.status !== 'offered' || offer.state !== 'pending' ||
      task.revision !== command.expectedTaskRevision ||
      offer.revision !== command.expectedOfferRevision + 1 ||
      offer.expiresAt !== command.offerExpiresAt) {
    throw new Error('The Cloud did not extend the expected Task offer.')
  }
}
