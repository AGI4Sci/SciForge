import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type { z } from 'zod'

import {
  COLLABORATION_CAPABILITY_IDS,
  collaborationActivityCommentInputSchema,
  collaborationActivityCommentResultSchema,
  collaborationNotificationMarkReadInputSchema,
  collaborationNotificationMarkReadResultSchema,
  collaborationConnectionConfigureInputSchema,
  collaborationConnectionConfigureResultSchema,
  collaborationConnectionConnectInputSchema,
  collaborationConnectionConnectResultSchema,
  collaborationEndpointChallengePollInputSchema,
  collaborationEndpointChallengePollResultSchema,
  collaborationEndpointChallengeStartInputSchema,
  collaborationEndpointChallengeStartResultSchema,
  collaborationManagedContainerManageResultSchema,
  collaborationManagedContainerInspectInputSchema,
  collaborationManagedContainerProvisionInputSchema,
  collaborationManagedContainerArchiveInputSchema,
  collaborationPrivateChannelDiscoverInputSchema,
  collaborationPrivateChannelDiscoverResultSchema,
  collaborationProjectionLinkInputSchema,
  collaborationProjectionLinkResultSchema,
  collaborationProjectionShareInputSchema,
  collaborationProjectionShareResultSchema,
  collaborationProjectionUpdateInputSchema,
  collaborationProjectionUpdateResultSchema,
  collaborationStatusReadInputSchema,
  collaborationStatusReadResultSchema,
  collaborationSynchronizationRetryInputSchema,
  collaborationSynchronizationRetryResultSchema,
  collaborationTaskListInputSchema,
  collaborationTaskListResultSchema,
  collaborationTaskInteractionReadInputSchema,
  collaborationTaskInteractionReadResultSchema,
  collaborationTaskCheckpointAppendInputSchema,
  collaborationTaskCheckpointAppendResultSchema,
  collaborationTaskOfferDecisionInputSchema,
  collaborationTaskOfferDecisionResultSchema,
  collaborationTaskReturnInputSchema,
  collaborationTaskReturnResultSchema,
  type CollaborationTaskReturnInput,
  collaborationTaskSessionOpenInputSchema,
  collaborationTaskSessionOpenResultSchema,
  type CollaborationActivityCommentInput,
  type CollaborationConnectionConfigureInput,
  type CollaborationNotificationMarkReadInput,
  type CollaborationConnectionConnectInput,
  type CollaborationEndpointChallengePollInput,
  type CollaborationEndpointChallengeStartInput,
  type CollaborationManagedContainerManageInput,
  type CollaborationPrivateChannelDiscoverInput,
  type CollaborationProjectionLinkInput,
  type CollaborationProjectionShareInput,
  type CollaborationProjectionUpdateInput,
  type CollaborationStatusReadInput,
  type CollaborationStatusSnapshot,
  type CollaborationSynchronizationRetryInput,
  type CollaborationTaskListInput,
  type CollaborationTaskInteractionReadInput,
  type CollaborationTaskCheckpointAppendInput,
  type CollaborationTaskOfferDecisionInput,
  type CollaborationTaskSessionOpenInput,
} from '../contract.js'
import {
  workerDeliveryReadInputSchema,
  workerDeliveryMaterialsInputSchema,
  workerDeliveryMaterialsResultSchema,
  type WorkerDeliveryMaterialsInput,
  type WorkerDeliveryMaterialsResult,
  workerDeliveryDraftSaveInputSchema,
  workerDeliveryResultSchema,
  workerDeliverySubmitInputSchema,
  workerResidualDisposeInputSchema,
  type WorkerDeliveryReadInput,
  type WorkerDeliveryDraftSaveInput,
  type WorkerDeliverySubmitInput
} from '../worker-delivery.js'

type WorkerDeliveryResult = z.infer<typeof workerDeliveryResultSchema>
type WorkerResidualDisposeInput = z.infer<typeof workerResidualDisposeInputSchema>

type ConnectionConfigureResult = z.infer<typeof collaborationConnectionConfigureResultSchema>
type ConnectionConnectResult = z.infer<typeof collaborationConnectionConnectResultSchema>
type EndpointChallengeStartResult = z.infer<typeof collaborationEndpointChallengeStartResultSchema>
type EndpointChallengePollResult = z.infer<typeof collaborationEndpointChallengePollResultSchema>
type PrivateChannelDiscoverResult = z.infer<typeof collaborationPrivateChannelDiscoverResultSchema>
type ProjectionLinkResult = z.infer<typeof collaborationProjectionLinkResultSchema>
type ProjectionUpdateResult = z.infer<typeof collaborationProjectionUpdateResultSchema>
type ProjectionShareResult = z.infer<typeof collaborationProjectionShareResultSchema>
type SynchronizationRetryResult = z.infer<typeof collaborationSynchronizationRetryResultSchema>
type TaskListResult = z.infer<typeof collaborationTaskListResultSchema>
type TaskInteractionReadResult = z.infer<typeof collaborationTaskInteractionReadResultSchema>
type TaskCheckpointAppendResult = z.infer<typeof collaborationTaskCheckpointAppendResultSchema>
type TaskOfferDecisionResult = z.infer<typeof collaborationTaskOfferDecisionResultSchema>
type TaskSessionOpenResult = z.infer<typeof collaborationTaskSessionOpenResultSchema>
type ManagedContainerManageResult = z.infer<typeof collaborationManagedContainerManageResultSchema>
type ActivityCommentResult = z.infer<typeof collaborationActivityCommentResultSchema>
type NotificationMarkReadResult = z.infer<typeof collaborationNotificationMarkReadResultSchema>

const contracts = Object.freeze({
  statusRead: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.statusRead,
    effect: 'read' as const,
    inputSchema: collaborationStatusReadInputSchema,
    outputSchema: collaborationStatusReadResultSchema
  }),
  connectionConfigure: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.connectionConfigure,
    effect: 'external-write' as const,
    inputSchema: collaborationConnectionConfigureInputSchema,
    outputSchema: collaborationConnectionConfigureResultSchema
  }),
  connectionConnect: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.connectionConnect,
    effect: 'external-write' as const,
    inputSchema: collaborationConnectionConnectInputSchema,
    outputSchema: collaborationConnectionConnectResultSchema
  }),
  endpointChallengeStart: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.endpointChallengeStart,
    effect: 'external-write' as const,
    inputSchema: collaborationEndpointChallengeStartInputSchema,
    outputSchema: collaborationEndpointChallengeStartResultSchema
  }),
  endpointChallengePoll: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.endpointChallengePoll,
    effect: 'read' as const,
    inputSchema: collaborationEndpointChallengePollInputSchema,
    outputSchema: collaborationEndpointChallengePollResultSchema
  }),
  projectionLink: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.projectionLink,
    effect: 'external-write' as const,
    inputSchema: collaborationProjectionLinkInputSchema,
    outputSchema: collaborationProjectionLinkResultSchema
  }),
  projectionUpdate: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.projectionUpdate,
    effect: 'external-write' as const,
    inputSchema: collaborationProjectionUpdateInputSchema,
    outputSchema: collaborationProjectionUpdateResultSchema
  }),
  projectionShare: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.projectionShare,
    effect: 'external-write' as const,
    inputSchema: collaborationProjectionShareInputSchema,
    outputSchema: collaborationProjectionShareResultSchema
  }),
  synchronizationRetry: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.synchronizationRetry,
    effect: 'external-write' as const,
    inputSchema: collaborationSynchronizationRetryInputSchema,
    outputSchema: collaborationSynchronizationRetryResultSchema
  }),
  privateChannelDiscover: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.privateChannelDiscover,
    effect: 'read' as const,
    inputSchema: collaborationPrivateChannelDiscoverInputSchema,
    outputSchema: collaborationPrivateChannelDiscoverResultSchema
  }),
  taskList: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskList,
    effect: 'read' as const,
    inputSchema: collaborationTaskListInputSchema,
    outputSchema: collaborationTaskListResultSchema
  }),
  workerDeliveryRead: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.workerDeliveryRead,
    effect: 'read' as const,
    inputSchema: workerDeliveryReadInputSchema,
    outputSchema: workerDeliveryResultSchema
  }),
  workerDeliveryMaterials: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.workerDeliveryMaterialsList,
    effect: 'read' as const,
    inputSchema: workerDeliveryMaterialsInputSchema,
    outputSchema: workerDeliveryMaterialsResultSchema
  }),
  workerDeliveryDraftSave: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.workerDeliveryDraftSave,
    effect: 'workspace-write' as const,
    inputSchema: workerDeliveryDraftSaveInputSchema,
    outputSchema: workerDeliveryResultSchema
  }),
  deliverySubmit: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.deliverySubmit,
    effect: 'external-write' as const,
    inputSchema: workerDeliverySubmitInputSchema,
    outputSchema: workerDeliveryResultSchema
  }),
  workerResidualDispose: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.workerResidualDispose,
    effect: 'workspace-write' as const,
    inputSchema: workerResidualDisposeInputSchema,
    outputSchema: workerDeliveryResultSchema
  }),
  taskInteractionRead: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskInteractionRead,
    effect: 'read' as const,
    inputSchema: collaborationTaskInteractionReadInputSchema,
    outputSchema: collaborationTaskInteractionReadResultSchema
  }),
  taskCheckpointAppend: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskCheckpointAppend,
    effect: 'workspace-write' as const,
    inputSchema: collaborationTaskCheckpointAppendInputSchema,
    outputSchema: collaborationTaskCheckpointAppendResultSchema
  }),

  taskOfferDecide: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskOfferDecide,
    effect: 'external-write' as const,
    inputSchema: collaborationTaskOfferDecisionInputSchema,
    outputSchema: collaborationTaskOfferDecisionResultSchema
  }),
  taskSessionOpen: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskSessionOpen,
    effect: 'read' as const,
    inputSchema: collaborationTaskSessionOpenInputSchema,
    outputSchema: collaborationTaskSessionOpenResultSchema
  }),
  taskReturn: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskReturn,
    effect: 'external-write' as const,
    inputSchema: collaborationTaskReturnInputSchema,
    outputSchema: collaborationTaskReturnResultSchema
  }),
  managedContainerInspect: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.managedContainerInspect,
    effect: 'read' as const,
    inputSchema: collaborationManagedContainerInspectInputSchema,
    outputSchema: collaborationManagedContainerManageResultSchema
  }),
  managedContainerProvision: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.managedContainerProvision,
    effect: 'external-write' as const,
    inputSchema: collaborationManagedContainerProvisionInputSchema,
    outputSchema: collaborationManagedContainerManageResultSchema
  }),
  activityComment: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.activityComment,
    effect: 'external-write' as const,
    inputSchema: collaborationActivityCommentInputSchema,
    outputSchema: collaborationActivityCommentResultSchema
  }),
  notificationMarkRead: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.notificationMarkRead,
    effect: 'external-write' as const,
    inputSchema: collaborationNotificationMarkReadInputSchema,
    outputSchema: collaborationNotificationMarkReadResultSchema
  }),
  managedContainerArchive: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.managedContainerArchive,
    effect: 'destructive' as const,
    inputSchema: collaborationManagedContainerArchiveInputSchema,
    outputSchema: collaborationManagedContainerManageResultSchema
  })
})

const CONFIRMED = Object.freeze({ approval: Object.freeze({ mode: 'confirmation' as const }) })

export type CollaborationRendererClient = Readonly<{
  readStatus(input?: CollaborationStatusReadInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<CollaborationStatusSnapshot>
  configureConnection(input: CollaborationConnectionConfigureInput): Promise<ConnectionConfigureResult>
  changeConnection(input: CollaborationConnectionConnectInput): Promise<ConnectionConnectResult>
  startEndpointChallenge(input: CollaborationEndpointChallengeStartInput): Promise<EndpointChallengeStartResult>
  pollEndpointChallenge(input: CollaborationEndpointChallengePollInput): Promise<EndpointChallengePollResult>
  linkProjection(input: CollaborationProjectionLinkInput): Promise<ProjectionLinkResult>
  updateProjection(input: CollaborationProjectionUpdateInput): Promise<ProjectionUpdateResult>
  shareProjection(input: CollaborationProjectionShareInput): Promise<ProjectionShareResult>
  retrySynchronization(input: CollaborationSynchronizationRetryInput): Promise<SynchronizationRetryResult>
  discoverPrivateChannels(input: CollaborationPrivateChannelDiscoverInput): Promise<PrivateChannelDiscoverResult>
  listTasks(input?: CollaborationTaskListInput): Promise<TaskListResult>
  readWorkerDelivery(input: WorkerDeliveryReadInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<WorkerDeliveryResult>
  listWorkerDeliveryMaterials(input: WorkerDeliveryMaterialsInput): Promise<WorkerDeliveryMaterialsResult>
  saveWorkerDeliveryDraft(input: WorkerDeliveryDraftSaveInput): Promise<WorkerDeliveryResult>
  submitWorkerDelivery(input: WorkerDeliverySubmitInput): Promise<WorkerDeliveryResult>
  disposeWorkerResidual(input: WorkerResidualDisposeInput): Promise<WorkerDeliveryResult>
  readTaskInteraction(input: CollaborationTaskInteractionReadInput): Promise<TaskInteractionReadResult>
  appendTaskCheckpoint(input: CollaborationTaskCheckpointAppendInput): Promise<TaskCheckpointAppendResult>
  decideTaskOffer(input: CollaborationTaskOfferDecisionInput): Promise<TaskOfferDecisionResult>
  returnTask(input: CollaborationTaskReturnInput): Promise<z.infer<typeof collaborationTaskReturnResultSchema>>
  openTaskSession(input: CollaborationTaskSessionOpenInput): Promise<TaskSessionOpenResult>
  manageContainer(input: CollaborationManagedContainerManageInput): Promise<ManagedContainerManageResult>
  publishComment(input: CollaborationActivityCommentInput): Promise<ActivityCommentResult>
  markNotificationRead(input: CollaborationNotificationMarkReadInput): Promise<NotificationMarkReadResult>
}>

export function createCollaborationRendererClient(
  invoker: DomainRendererCapabilityInvoker
): CollaborationRendererClient {
  return Object.freeze({
    readStatus: (input = {}, options) => invoker.invoke(contracts.statusRead, input, options),
    configureConnection: (input) => invoker.invoke(
      contracts.connectionConfigure,
      input,
      CONFIRMED
    ),
    changeConnection: (input) => invoker.invoke(
      contracts.connectionConnect,
      input,
      CONFIRMED
    ),
    startEndpointChallenge: (input) => invoker.invoke(
      contracts.endpointChallengeStart,
      input,
      CONFIRMED
    ),
    pollEndpointChallenge: (input) => invoker.invoke(
      contracts.endpointChallengePoll,
      input
    ),
    linkProjection: (input) => invoker.invoke(contracts.projectionLink, input, CONFIRMED),
    updateProjection: (input) => invoker.invoke(contracts.projectionUpdate, input, CONFIRMED),
    shareProjection: (input) => invoker.invoke(contracts.projectionShare, input, CONFIRMED),
    retrySynchronization: (input) => invoker.invoke(
      contracts.synchronizationRetry,
      input,
      CONFIRMED
    ),
    discoverPrivateChannels: (input) => invoker.invoke(contracts.privateChannelDiscover, input),
    listTasks: (input = {}) => invoker.invoke(contracts.taskList, input),
    readWorkerDelivery: (input, options) => invoker.invoke(contracts.workerDeliveryRead, input, options),
    listWorkerDeliveryMaterials: (input) => invoker.invoke(contracts.workerDeliveryMaterials, input),
    saveWorkerDeliveryDraft: (input) => invoker.invoke(contracts.workerDeliveryDraftSave, input),
    submitWorkerDelivery: (input) => invoker.invoke(
      contracts.deliverySubmit,
      input,
      CONFIRMED
    ),
    disposeWorkerResidual: (input) => invoker.invoke(
      contracts.workerResidualDispose,
      input,
      CONFIRMED
    ),
    readTaskInteraction: (input) => invoker.invoke(contracts.taskInteractionRead, input),
    appendTaskCheckpoint: (input) => invoker.invoke(
      contracts.taskCheckpointAppend,
      input,
      CONFIRMED
    ),
    decideTaskOffer: (input) => invoker.invoke(contracts.taskOfferDecide, input, CONFIRMED),
    returnTask: (input) => invoker.invoke(contracts.taskReturn, input, CONFIRMED),
    openTaskSession: (input) => invoker.invoke(contracts.taskSessionOpen, input),
    manageContainer: (input) => {
      if (input.action === 'refresh-status' || input.action === 'refresh-locators') {
        return invoker.invoke(contracts.managedContainerInspect, input)
      }
      if (input.action === 'archive') {
        return invoker.invoke(contracts.managedContainerArchive, input, CONFIRMED)
      }
      return invoker.invoke(contracts.managedContainerProvision, input, CONFIRMED)
    },
    publishComment: (input) => invoker.invoke(contracts.activityComment, input, CONFIRMED),
    markNotificationRead: (input) => invoker.invoke(
      contracts.notificationMarkRead,
      input,
      CONFIRMED
    )
  })
}

export const collaborationRendererContracts = contracts
