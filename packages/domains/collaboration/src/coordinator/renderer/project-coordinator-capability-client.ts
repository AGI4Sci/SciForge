import {
  deliveryDriveViewSchema,
  deliveryReadViewSchema,
  deliveryRevisionRecordSchema,
  integrationReceiptSchema,
  projectRequirementsDocumentSchema,
  projectResultSchema,
  type DeliveryDriveView,
  type DeliveryReadView,
  type DeliveryRevisionRecord,
  type IntegrationReceipt,
  type ProjectRequirementsDocument,
  type ProjectResult
} from '@sciforge/collaboration-contracts'
import type { DomainRendererCapabilityContract, DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type { DomainCapabilityResourceHandle } from '@sciforge/domain-sdk/renderer-contributions'
import {
  DELIVERY_CONTENT_ACTIONS,
  deliveryObjectDescribeInputSchema,
  deliveryObjectDescribeOutputSchema,
  deliveryObjectOpenInputSchema,
  deliveryObjectOpenOutputSchema,
  deliveryObjectReadRangeInputSchema,
  deliveryObjectReadRangeOutputSchema,
  type DeliveryObjectInput,
  type DeliveryObjectReadRangeInput
} from '../delivery-content-contract.js'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorActivationAcknowledgeInputSchema,
  projectCoordinatorActivationAcknowledgeResultSchema,
  projectCoordinatorAdoptionInputSchema,
  projectCoordinatorCompleteInputSchema,
  projectCoordinatorDeliveryReadInputSchema,
  projectCoordinatorDriveListInputSchema,
  projectCoordinatorHumanAnswerInputSchema,
  projectCoordinatorHumanNeededCreateInputSchema,
  projectCoordinatorMembershipAcceptInputSchema,
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorProjectDeleteInputSchema,
  projectCoordinatorProjectDeleteResultSchema,
  projectCoordinatorRequirementsCompleteInputSchema,
  projectCoordinatorRequirementsCompleteResultSchema,
  projectCoordinatorRequirementsConfirmInputSchema,
  projectCoordinatorRequirementsDraftSaveInputSchema,
  projectCoordinatorResultPublishInputSchema,
  projectCoordinatorRevisionRequestInputSchema,
  projectCoordinatorSessionOwnershipReadInputSchema,
  projectCoordinatorSessionOwnershipSchema,
  projectCoordinatorSessionProjectionReadInputSchema,
  projectCoordinatorSessionProjectionSchema,
  projectCoordinatorTaskOfferExtendInputSchema,
  projectCoordinatorTaskOfferReassignInputSchema,
  projectCoordinatorTaskOfferWithdrawInputSchema,
  projectCoordinatorTransferInputSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorActivationAcknowledgeInput,
  type ProjectCoordinatorAdoptionInput,
  type ProjectCoordinatorCompleteInput,
  type ProjectCoordinatorDeliveryReadInput,
  type ProjectCoordinatorDriveListInput,
  type ProjectCoordinatorHumanAnswerInput,
  type ProjectCoordinatorHumanNeededCreateInput,
  type ProjectCoordinatorMembershipAcceptInput,
  type ProjectCoordinatorMembershipAddInput,
  type ProjectCoordinatorMembershipRemoveInput,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateResult,
  type ProjectCoordinatorProjectDeleteInput,
  type ProjectCoordinatorProjectDeleteResult,
  type ProjectCoordinatorRequirementsCompleteInput,
  type ProjectCoordinatorRequirementsCompletionFailureReason,
  type ProjectCoordinatorRequirementsConfirmInput,
  type ProjectCoordinatorRequirementsDraftSaveInput,
  type ProjectCoordinatorResultPublishInput,
  type ProjectCoordinatorRevisionRequestInput,
  type ProjectCoordinatorSessionProjection,
  type ProjectCoordinatorTaskOfferExtendInput,
  type ProjectCoordinatorTaskOfferReassignInput,
  type ProjectCoordinatorTaskOfferWithdrawInput,
  type ProjectCoordinatorTransferInput,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from '../contract.js'
import { publishProjectCoordinatorWorkspaceInvalidation } from './workspace-invalidation.js'

const workspaceReadContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
  effect: 'read' as const,
  inputSchema: projectCoordinatorWorkspaceReadInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const projectCreateContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorProjectCreateInputSchema,
  outputSchema: projectCoordinatorProjectCreateResultSchema
})

const projectDeleteContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
  effect: 'destructive' as const,
  inputSchema: projectCoordinatorProjectDeleteInputSchema,
  outputSchema: projectCoordinatorProjectDeleteResultSchema
})

const projectActivationAcknowledgeContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge,
  effect: 'workspace-write' as const,
  inputSchema: projectCoordinatorActivationAcknowledgeInputSchema,
  outputSchema: projectCoordinatorActivationAcknowledgeResultSchema
})

const sessionOwnershipReadContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.sessionOwnershipRead,
  effect: 'read' as const,
  inputSchema: projectCoordinatorSessionOwnershipReadInputSchema,
  outputSchema: projectCoordinatorSessionOwnershipSchema
})

const sessionProjectionReadContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
  effect: 'read' as const,
  inputSchema: projectCoordinatorSessionProjectionReadInputSchema,
  outputSchema: projectCoordinatorSessionProjectionSchema
})

const requirementsDraftSaveContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorRequirementsDraftSaveInputSchema,
  outputSchema: projectRequirementsDocumentSchema
})

const requirementsCompleteContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
  effect: 'workspace-write' as const,
  inputSchema: projectCoordinatorRequirementsCompleteInputSchema,
  outputSchema: projectCoordinatorRequirementsCompleteResultSchema
})

export const requirementsCompletionMessages: Readonly<Record<ProjectCoordinatorRequirementsCompletionFailureReason, string>> = {
  draft_unavailable: '当前需求草稿不可用，请刷新后重试',
  completion_in_progress: '已有补全正在进行，请稍后重试',
  revision_conflict: '需求内容或协调权限已变化，或项目版本持续更新，请重新补全',
  runtime_unavailable: '本地 Agent Runtime 不可用，请连接后重试',
  runtime_execution_failed: '本地 Agent Runtime 执行失败，请重试',
  invalid_structured_output: '生成的工作模块或验收标准不符合要求，请重试',
  placeholder_generated_content: '生成的工作模块或验收标准含纯标点或占位内容，每项须包含文字或数字，请重新补全',
  write_failed: '补全结果写入云端失败，请重试',
  unexpected_failure: '补全发生异常，请重试'
}

export class ProjectCoordinatorRequirementsCompletionClientError extends Error {
  readonly reason: ProjectCoordinatorRequirementsCompletionFailureReason

  constructor(reason: ProjectCoordinatorRequirementsCompletionFailureReason) {
    super(requirementsCompletionMessages[reason])
    this.name = 'ProjectCoordinatorRequirementsCompletionClientError'
    this.reason = reason
  }
}

const requirementsConfirmContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorRequirementsConfirmInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const taskOfferReassignContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorTaskOfferReassignInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const taskOfferWithdrawContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
  effect: 'destructive' as const,
  inputSchema: projectCoordinatorTaskOfferWithdrawInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const taskOfferExtendContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorTaskOfferExtendInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const membershipAddContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorMembershipAddInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const membershipAcceptContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorMembershipAcceptInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const membershipRemoveContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
  effect: 'destructive' as const,
  inputSchema: projectCoordinatorMembershipRemoveInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const humanNeededCreateContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorHumanNeededCreateInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const humanAnswerContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorHumanAnswerInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const coordinatorTransferContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorTransferInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const deliveryReadContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.deliveryRead, effect: 'read' as const,
  inputSchema: projectCoordinatorDeliveryReadInputSchema, outputSchema: deliveryReadViewSchema
})
const deliveryObjectDescribeContract = Object.freeze({
  actionId: DELIVERY_CONTENT_ACTIONS.describe, effect: 'read' as const,
  inputSchema: deliveryObjectDescribeInputSchema, outputSchema: deliveryObjectDescribeOutputSchema
})
const deliveryObjectReadRangeContract = Object.freeze({
  actionId: DELIVERY_CONTENT_ACTIONS.readRange, effect: 'read' as const,
  inputSchema: deliveryObjectReadRangeInputSchema, outputSchema: deliveryObjectReadRangeOutputSchema
})
const driveListContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.driveList, effect: 'read' as const,
  inputSchema: projectCoordinatorDriveListInputSchema, outputSchema: deliveryDriveViewSchema
})
const adoptionDecideContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide, effect: 'external-write' as const,
  inputSchema: projectCoordinatorAdoptionInputSchema, outputSchema: integrationReceiptSchema
})
const revisionRequestContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.revisionRequest, effect: 'external-write' as const,
  inputSchema: projectCoordinatorRevisionRequestInputSchema, outputSchema: deliveryRevisionRecordSchema
})
const resultPublishContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.resultPublish, effect: 'external-write' as const,
  inputSchema: projectCoordinatorResultPublishInputSchema, outputSchema: projectResultSchema
})

const projectCompleteContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorCompleteInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const confirmationApproval = Object.freeze({
  approval: Object.freeze({ mode: 'confirmation' as const })
})

const transientFaultCodes = [
  'revision_conflict',
  'authority_unverified',
  'transport_unavailable'
] as const

type TransientFaultCode = (typeof transientFaultCodes)[number]

/**
 * Both faults below are self-healing: the Cloud rejects commands whose expected
 * revisions are stale, and the Device connection drops for a moment while it
 * re-verifies itself. The Connection recovers on its own, and a fresh workspace
 * read carries the current revisions, so a single replay finishes the caller's
 * action. Users must never be shown the raw protocol fault.
 */
export const projectCoordinatorTransientFaultMessages: Readonly<Record<TransientFaultCode, string>> = {
  revision_conflict: '项目已被其他成员更新，已为你重新读取最新数据，请再试一次',
  authority_unverified: '正在重新校验这台设备与云端的连接，请稍候再试',
  transport_unavailable: '与云端的连接中断了，已尝试重新连接，请稍候再试'
}

export class ProjectCoordinatorTransientFaultError extends Error {
  readonly code: TransientFaultCode

  constructor(code: TransientFaultCode, cause?: unknown) {
    super(projectCoordinatorTransientFaultMessages[code], { cause })
    this.name = 'ProjectCoordinatorTransientFaultError'
    this.code = code
  }
}

const cloudAccessMessages = {
  cloud_unavailable: '暂时无法连接云端，请检查网络后重试。',
  cloud_timeout: '连接云端超时，请稍后重试。',
  identity_required: '请重新登录云端后再试。',
  device_required: '这台设备尚未获得云端授权，请到账户设置检查设备连接。'
} as const

type CloudAccessFaultCode = keyof typeof cloudAccessMessages

export class ProjectCoordinatorCloudAccessError extends Error {
  constructor(readonly code: CloudAccessFaultCode, cause: unknown) {
    super(cloudAccessMessages[code], { cause })
    this.name = 'ProjectCoordinatorCloudAccessError'
  }
}

const structuredReasonCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const details = 'details' in error ? error.details : undefined
  const reason = details && typeof details === 'object' && 'reasonCode' in details
    ? details.reasonCode : 'code' in error ? error.code : undefined
  return typeof reason === 'string' && reason !== 'handler_failed' ? reason : undefined
}

const cloudAccessError = (error: unknown): unknown => {
  const message = error instanceof Error ? error.message : String(error)
  const code = structuredReasonCode(error)
  for (const candidate of Object.keys(cloudAccessMessages) as CloudAccessFaultCode[]) {
    if (code === candidate || (code === undefined && new RegExp(`\\b${candidate}\\b`, 'u').test(message))) {
      return new ProjectCoordinatorCloudAccessError(candidate, error)
    }
  }
  return error
}

const transientFaultCode = (error: unknown): TransientFaultCode | undefined => {
  const code = structuredReasonCode(error)
  if (code !== undefined) return transientFaultCodes.find((candidate) => candidate === code)
  const message = error instanceof Error ? error.message : String(error)
  if (/\brevision_conflict\b|The resource revision is stale/u.test(message)) return 'revision_conflict'
  if (/\bauthority_unverified\b|Connection interrupted/u.test(message)) return 'authority_unverified'
  if (/\btransport_unavailable\b/u.test(message)) return 'transport_unavailable'
  return undefined
}

type ProjectRevisions = ReadonlyMap<string, Readonly<{
  revision: number
  authorityEpoch: number
  membershipRevisions: ReadonlyMap<string, number>
}>>

type InvokeOptions = NonNullable<Parameters<DomainRendererCapabilityInvoker['invoke']>[2]>

const readProjectRevisions = async (
  invoker: DomainRendererCapabilityInvoker,
  input: unknown,
  options?: InvokeOptions
): Promise<ProjectRevisions> => {
  options?.signal?.throwIfAborted()
  const projectId = input && typeof input === 'object' && 'projectId' in input
    ? input.projectId : undefined
  const workspace: ProjectCoordinatorWorkspace = await invoker.invoke(
    workspaceReadContract,
    typeof projectId === 'string' ? { projectId } : {},
    {
      ...(options?.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
      ...(options?.signal === undefined ? {} : { signal: options.signal })
    }
  )
  if (workspace.connection.state !== 'ready') {
    if (workspace.connection.state === 'cloud_unavailable' &&
        workspace.connection.reasonCode === 'authority_unverified') {
      throw new ProjectCoordinatorTransientFaultError('authority_unverified')
    }
    throw new ProjectCoordinatorCloudAccessError(workspace.connection.state, workspace.connection)
  }
  return new Map(
    workspace.projects.map(({ project, memberships }) => [
      project.projectId,
      {
        revision: project.revision,
        authorityEpoch: project.coordinatorAuthorityEpoch,
        membershipRevisions: new Map(memberships.map(membership => [membership.projectMembershipId, membership.revision]))
      }
    ])
  )
}

const withCurrentExpectedRevisions = <TInput>(input: TInput, revisions: ProjectRevisions): TInput => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  const projectId = record.projectId
  if (typeof projectId !== 'string') return input
  const current = revisions.get(projectId)
  if (current === undefined) return input
  const patched: Record<string, unknown> = { ...record }
  if ('expectedProjectRevision' in patched) patched.expectedProjectRevision = current.revision
  if ('expectedCoordinatorAuthorityEpoch' in patched) {
    patched.expectedCoordinatorAuthorityEpoch = current.authorityEpoch
  }
  if ('expectedMembershipRevision' in patched && typeof patched.projectMembershipId === 'string') {
    const membershipRevision = current.membershipRevisions.get(patched.projectMembershipId)
    if (membershipRevision !== undefined) patched.expectedMembershipRevision = membershipRevision
  }
  return Object.freeze(patched) as TInput
}

/**
 * Replays one invocation after a self-healing Cloud fault: re-read the Project
 * revisions the caller's command was fenced on, then send the same command once
 * more. A second failure is reported as a user-facing message, never as the raw
 * protocol error.
 */
const invokeWithTransientRecovery = async <TInput, TOutput>(
  invoker: DomainRendererCapabilityInvoker,
  contract: DomainRendererCapabilityContract<TInput, TOutput>,
  input: TInput,
  options?: InvokeOptions
): Promise<TOutput> => {
  try {
    return await invoker.invoke(contract, input, options)
  } catch (error) {
    const fault = transientFaultCode(error)
    if (fault === undefined) throw cloudAccessError(error)
    let revisions: ProjectRevisions
    try {
      revisions = await readProjectRevisions(invoker, input, options)
    } catch (readError) {
      const readFault = transientFaultCode(readError)
      throw readFault ? new ProjectCoordinatorTransientFaultError(readFault, readError) : cloudAccessError(readError)
    }
    const replayed = withCurrentExpectedRevisions(input, revisions)
    try {
      options?.signal?.throwIfAborted()
      return await invoker.invoke(contract, replayed, options)
    } catch (replayError) {
      const replayFault = transientFaultCode(replayError)
      throw replayFault ? new ProjectCoordinatorTransientFaultError(replayFault, replayError) : cloudAccessError(replayError)
    }
  }
}

const withTransientRecovery = (invoker: DomainRendererCapabilityInvoker): DomainRendererCapabilityInvoker =>
  Object.freeze({
    ...invoker,
    invoke: (contract, input, options) => invokeWithTransientRecovery(invoker, contract, input, options)
  })

export type ProjectCoordinatorRendererClient = Readonly<{
  readWorkspace(input?: ProjectCoordinatorWorkspaceReadInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<ProjectCoordinatorWorkspace>
  createProject(input: ProjectCoordinatorProjectCreateInput): Promise<ProjectCoordinatorProjectCreateResult>
  deleteProject(input: ProjectCoordinatorProjectDeleteInput): Promise<ProjectCoordinatorProjectDeleteResult>
  acknowledgeProjectActivation(input: ProjectCoordinatorActivationAcknowledgeInput): Promise<void>
  readSessionOwnership(): Promise<readonly Readonly<{ runtimeId: string; threadId: string }>[]>
  readSessionProjection(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProjectCoordinatorSessionProjection>
  saveRequirementsDraft(input: ProjectCoordinatorRequirementsDraftSaveInput): Promise<ProjectRequirementsDocument>
  completeRequirements(input: ProjectCoordinatorRequirementsCompleteInput): Promise<ProjectRequirementsDocument>
  confirmRequirements(input: ProjectCoordinatorRequirementsConfirmInput): Promise<ProjectCoordinatorWorkspace>
  withdrawTaskOffer(input: ProjectCoordinatorTaskOfferWithdrawInput): Promise<ProjectCoordinatorWorkspace>
  extendTaskOffer(input: ProjectCoordinatorTaskOfferExtendInput): Promise<ProjectCoordinatorWorkspace>
  reassignTaskOffer(
    input: ProjectCoordinatorTaskOfferReassignInput
  ): Promise<ProjectCoordinatorWorkspace>
  addMember(input: ProjectCoordinatorMembershipAddInput): Promise<ProjectCoordinatorWorkspace>
  acceptInvitation(input: ProjectCoordinatorMembershipAcceptInput): Promise<ProjectCoordinatorWorkspace>
  removeMember(input: ProjectCoordinatorMembershipRemoveInput): Promise<ProjectCoordinatorWorkspace>
  createHumanNeeded(input: ProjectCoordinatorHumanNeededCreateInput): Promise<ProjectCoordinatorWorkspace>
  answerHumanNeeded(input: ProjectCoordinatorHumanAnswerInput): Promise<ProjectCoordinatorWorkspace>
  transferCoordinator(input: ProjectCoordinatorTransferInput): Promise<ProjectCoordinatorWorkspace>
  openDeliveryObject(input: DeliveryObjectInput): Promise<import('zod').infer<typeof deliveryObjectOpenOutputSchema>>
  describeDeliveryObject(resource: DomainCapabilityResourceHandle): Promise<import('zod').infer<typeof deliveryObjectDescribeOutputSchema>>
  readDeliveryObjectRange(resource: DomainCapabilityResourceHandle, input: DeliveryObjectReadRangeInput): Promise<import('zod').infer<typeof deliveryObjectReadRangeOutputSchema>>
  readDelivery(input: ProjectCoordinatorDeliveryReadInput): Promise<DeliveryReadView>
  listDrive(input: ProjectCoordinatorDriveListInput): Promise<DeliveryDriveView>
  decideAdoption(input: ProjectCoordinatorAdoptionInput): Promise<IntegrationReceipt>
  requestRevision(input: ProjectCoordinatorRevisionRequestInput): Promise<DeliveryRevisionRecord>
  publishResult(input: ProjectCoordinatorResultPublishInput): Promise<ProjectResult>
  completeProject(input: ProjectCoordinatorCompleteInput): Promise<ProjectCoordinatorWorkspace>
}>

export function createProjectCoordinatorRendererClient(
  hostInvoker: DomainRendererCapabilityInvoker
): ProjectCoordinatorRendererClient {
  const invoker = withTransientRecovery(hostInvoker)
  const invokeMutation = async <T>(
    operation: () => Promise<T>
  ): Promise<T> => {
    const result = await operation()
    publishProjectCoordinatorWorkspaceInvalidation()
    return result
  }
  return Object.freeze({
    readWorkspace: (input = {}, options = {}) => invoker.invoke(workspaceReadContract, input, options),
    createProject: async (input) => {
      return invokeMutation(() => invoker.invoke(projectCreateContract, input, confirmationApproval))
    },
    deleteProject: async (input) => {
      const result = await invoker.invoke(projectDeleteContract, input, confirmationApproval)
      publishProjectCoordinatorWorkspaceInvalidation()
      return result
    },
    acknowledgeProjectActivation: async (input) => {
      await invokeMutation(() => invoker.invoke(projectActivationAcknowledgeContract, input))
    },
    readSessionOwnership: () => invoker.invoke(sessionOwnershipReadContract, {}),
    readSessionProjection: (options = {}) => invoker.invoke(sessionProjectionReadContract, {}, options),
    saveRequirementsDraft: (input) => invoker.invoke(requirementsDraftSaveContract, input),
    completeRequirements: async (input) => {
      const result = await invokeMutation(() => invoker.invoke(requirementsCompleteContract, input))
      if (result.status === 'failed') {
        throw new ProjectCoordinatorRequirementsCompletionClientError(result.reason)
      }
      return result.document
    },
    confirmRequirements: (input) => invoker.invoke(
      requirementsConfirmContract,
      input,
      confirmationApproval
    ),
    withdrawTaskOffer: (input) => invokeMutation(() => invoker.invoke(
      taskOfferWithdrawContract,
      input,
      confirmationApproval
    )),
    extendTaskOffer: (input) => invokeMutation(() => invoker.invoke(
      taskOfferExtendContract,
      input,
      confirmationApproval
    )),
    reassignTaskOffer: (input) => invokeMutation(() => invoker.invoke(
      taskOfferReassignContract,
      input,
      confirmationApproval
    )),
    addMember: (input) => invoker.invoke(
      membershipAddContract,
      input,
      confirmationApproval
    ),
    // The review helper owns conflict recovery: never upgrade approved facts or
    // replay a write whose transport outcome may be unknown here.
    acceptInvitation: (input) => hostInvoker.invoke(
      membershipAcceptContract,
      input,
      confirmationApproval
    ),
    removeMember: (input) => invoker.invoke(
      membershipRemoveContract,
      input,
      confirmationApproval
    ),
    createHumanNeeded: (input) => invoker.invoke(
      humanNeededCreateContract,
      input,
      confirmationApproval
    ),
    answerHumanNeeded: (input) => invoker.invoke(
      humanAnswerContract,
      input,
      confirmationApproval
    ),
    transferCoordinator: (input) => invoker.invoke(
      coordinatorTransferContract,
      input,
      confirmationApproval
    ),
    openDeliveryObject: (input) => invoker.invoke({ actionId: DELIVERY_CONTENT_ACTIONS.open, effect: 'read',
      inputSchema: deliveryObjectOpenInputSchema, outputSchema: deliveryObjectOpenOutputSchema }, input),
    describeDeliveryObject: (resource) => invoker.invoke(deliveryObjectDescribeContract, {}, { resource }),
    readDeliveryObjectRange: (resource, input) => invoker.invoke(deliveryObjectReadRangeContract, input, { resource }),
    readDelivery: (input) => invoker.invoke(deliveryReadContract, input),
    listDrive: (input) => invoker.invoke(driveListContract, input),
    decideAdoption: (input) => invokeMutation(() => invoker.invoke(adoptionDecideContract, input, confirmationApproval)),
    requestRevision: (input) => invokeMutation(() => invoker.invoke(revisionRequestContract, input, confirmationApproval)),
    publishResult: (input) => invokeMutation(() => invoker.invoke(resultPublishContract, input, confirmationApproval)),
    completeProject: (input) => invoker.invoke(
      projectCompleteContract,
      input,
      confirmationApproval
    )
  })
}
