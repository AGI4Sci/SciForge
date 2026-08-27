import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type { z } from 'zod'

import {
  COLLABORATION_CAPABILITY_IDS,
  collaborationAgentRegisterInputSchema,
  collaborationAgentRegisterResultSchema,
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
  collaborationPrimaryAgentSelectInputSchema,
  collaborationPrimaryAgentSelectResultSchema,
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
  collaborationTaskOfferDecisionInputSchema,
  collaborationTaskOfferDecisionResultSchema,
  collaborationWorkerAcceptanceUpdateInputSchema,
  collaborationWorkerAcceptanceUpdateResultSchema,
  type CollaborationAgentRegisterInput,
  type CollaborationConnectionConfigureInput,
  type CollaborationConnectionConnectInput,
  type CollaborationEndpointChallengePollInput,
  type CollaborationEndpointChallengeStartInput,
  type CollaborationManagedContainerManageInput,
  type CollaborationPrimaryAgentSelectInput,
  type CollaborationProjectionLinkInput,
  type CollaborationProjectionShareInput,
  type CollaborationProjectionUpdateInput,
  type CollaborationStatusSnapshot,
  type CollaborationSynchronizationRetryInput,
  type CollaborationTaskListInput,
  type CollaborationTaskOfferDecisionInput,
  type CollaborationWorkerAcceptanceUpdateInput
} from '../contract.js'

type AgentRegisterResult = z.infer<typeof collaborationAgentRegisterResultSchema>
type ConnectionConfigureResult = z.infer<typeof collaborationConnectionConfigureResultSchema>
type ConnectionConnectResult = z.infer<typeof collaborationConnectionConnectResultSchema>
type EndpointChallengeStartResult = z.infer<typeof collaborationEndpointChallengeStartResultSchema>
type EndpointChallengePollResult = z.infer<typeof collaborationEndpointChallengePollResultSchema>
type PrimaryAgentSelectResult = z.infer<typeof collaborationPrimaryAgentSelectResultSchema>
type ProjectionLinkResult = z.infer<typeof collaborationProjectionLinkResultSchema>
type ProjectionUpdateResult = z.infer<typeof collaborationProjectionUpdateResultSchema>
type ProjectionShareResult = z.infer<typeof collaborationProjectionShareResultSchema>
type SynchronizationRetryResult = z.infer<typeof collaborationSynchronizationRetryResultSchema>
type TaskListResult = z.infer<typeof collaborationTaskListResultSchema>
type TaskOfferDecisionResult = z.infer<typeof collaborationTaskOfferDecisionResultSchema>
type WorkerAcceptanceUpdateResult = z.infer<typeof collaborationWorkerAcceptanceUpdateResultSchema>
type ManagedContainerManageResult = z.infer<typeof collaborationManagedContainerManageResultSchema>

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
  agentRegister: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.agentRegister,
    effect: 'external-write' as const,
    inputSchema: collaborationAgentRegisterInputSchema,
    outputSchema: collaborationAgentRegisterResultSchema
  }),
  primaryAgentSelect: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.primaryAgentSelect,
    effect: 'external-write' as const,
    inputSchema: collaborationPrimaryAgentSelectInputSchema,
    outputSchema: collaborationPrimaryAgentSelectResultSchema
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
  taskList: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskList,
    effect: 'read' as const,
    inputSchema: collaborationTaskListInputSchema,
    outputSchema: collaborationTaskListResultSchema
  }),
  workerAcceptanceUpdate: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.workerAcceptanceUpdate,
    effect: 'external-write' as const,
    inputSchema: collaborationWorkerAcceptanceUpdateInputSchema,
    outputSchema: collaborationWorkerAcceptanceUpdateResultSchema
  }),
  taskOfferDecide: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.taskOfferDecide,
    effect: 'external-write' as const,
    inputSchema: collaborationTaskOfferDecisionInputSchema,
    outputSchema: collaborationTaskOfferDecisionResultSchema
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
  managedContainerArchive: Object.freeze({
    actionId: COLLABORATION_CAPABILITY_IDS.managedContainerArchive,
    effect: 'destructive' as const,
    inputSchema: collaborationManagedContainerArchiveInputSchema,
    outputSchema: collaborationManagedContainerManageResultSchema
  })
})

const CONFIRMED = Object.freeze({ approval: Object.freeze({ mode: 'confirmation' as const }) })

export type CollaborationRendererClient = Readonly<{
  readStatus(): Promise<CollaborationStatusSnapshot>
  configureConnection(input: CollaborationConnectionConfigureInput): Promise<ConnectionConfigureResult>
  changeConnection(input: CollaborationConnectionConnectInput): Promise<ConnectionConnectResult>
  startEndpointChallenge(input: CollaborationEndpointChallengeStartInput): Promise<EndpointChallengeStartResult>
  pollEndpointChallenge(input: CollaborationEndpointChallengePollInput): Promise<EndpointChallengePollResult>
  registerAgent(input: CollaborationAgentRegisterInput): Promise<AgentRegisterResult>
  selectPrimaryAgent(input: CollaborationPrimaryAgentSelectInput): Promise<PrimaryAgentSelectResult>
  linkProjection(input: CollaborationProjectionLinkInput): Promise<ProjectionLinkResult>
  updateProjection(input: CollaborationProjectionUpdateInput): Promise<ProjectionUpdateResult>
  shareProjection(input: CollaborationProjectionShareInput): Promise<ProjectionShareResult>
  retrySynchronization(input: CollaborationSynchronizationRetryInput): Promise<SynchronizationRetryResult>
  listTasks(input?: CollaborationTaskListInput): Promise<TaskListResult>
  updateWorkerAcceptancePolicy(
    input: CollaborationWorkerAcceptanceUpdateInput
  ): Promise<WorkerAcceptanceUpdateResult>
  decideTaskOffer(input: CollaborationTaskOfferDecisionInput): Promise<TaskOfferDecisionResult>
  manageContainer(input: CollaborationManagedContainerManageInput): Promise<ManagedContainerManageResult>
}>

export function createCollaborationRendererClient(
  invoker: DomainRendererCapabilityInvoker
): CollaborationRendererClient {
  return Object.freeze({
    readStatus: () => invoker.invoke(contracts.statusRead, {}),
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
    registerAgent: (input) => invoker.invoke(contracts.agentRegister, input, CONFIRMED),
    selectPrimaryAgent: (input) => invoker.invoke(
      contracts.primaryAgentSelect,
      input,
      CONFIRMED
    ),
    linkProjection: (input) => invoker.invoke(contracts.projectionLink, input, CONFIRMED),
    updateProjection: (input) => invoker.invoke(contracts.projectionUpdate, input, CONFIRMED),
    shareProjection: (input) => invoker.invoke(contracts.projectionShare, input, CONFIRMED),
    retrySynchronization: (input) => invoker.invoke(
      contracts.synchronizationRetry,
      input,
      CONFIRMED
    ),
    listTasks: (input = {}) => invoker.invoke(contracts.taskList, input),
    updateWorkerAcceptancePolicy: (input) => invoker.invoke(
      contracts.workerAcceptanceUpdate,
      input,
      CONFIRMED
    ),
    decideTaskOffer: (input) => invoker.invoke(contracts.taskOfferDecide, input, CONFIRMED),
    manageContainer: (input) => {
      if (input.action === 'refresh-status' || input.action === 'refresh-locators') {
        return invoker.invoke(contracts.managedContainerInspect, input)
      }
      if (input.action === 'archive') {
        return invoker.invoke(contracts.managedContainerArchive, input, CONFIRMED)
      }
      return invoker.invoke(contracts.managedContainerProvision, input, CONFIRMED)
    }
  })
}

export const collaborationRendererContracts = contracts
