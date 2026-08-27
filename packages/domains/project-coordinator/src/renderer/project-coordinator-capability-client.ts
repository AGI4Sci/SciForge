import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorArtifactReviewPrepareInputSchema,
  projectCoordinatorArtifactReviewPreparedSchema,
  projectCoordinatorCompleteInputSchema,
  projectCoordinatorContentRecoveryAbandonInputSchema,
  projectCoordinatorContentRecoveryObserveLinkInputSchema,
  projectCoordinatorContentRecoveryRetrySuccessorInputSchema,
  projectCoordinatorHumanAnswerInputSchema,
  projectCoordinatorHumanNeededCreateInputSchema,
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorPlanConfirmActivateInputSchema,
  projectCoordinatorPlanDraftEditInputSchema,
  projectCoordinatorPlanDraftGenerateInputSchema,
  projectCoordinatorPlanDraftGenerateResultSchema,
  projectCoordinatorPlanDraftReadInputSchema,
  projectCoordinatorPlanDraftSchema,
  projectCoordinatorPlanDraftSubmitInputSchema,
  projectCoordinatorPlanSubmitResultSchema,
  projectCoordinatorProvisioningApplyInputSchema,
  projectCoordinatorProvisioningPlanInputSchema,
  projectCoordinatorProvisioningPlanSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorResultReviewInputSchema,
  projectCoordinatorTransferInputSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorPlanConfirmActivateInput,
  type ProjectCoordinatorArtifactReviewPrepareInput,
  type ProjectCoordinatorArtifactReviewPrepared,
  type ProjectCoordinatorCompleteInput,
  type ProjectCoordinatorContentRecoveryAbandonInput,
  type ProjectCoordinatorContentRecoveryObserveLinkInput,
  type ProjectCoordinatorContentRecoveryRetrySuccessorInput,
  type ProjectCoordinatorHumanAnswerInput,
  type ProjectCoordinatorHumanNeededCreateInput,
  type ProjectCoordinatorMembershipAddInput,
  type ProjectCoordinatorMembershipRemoveInput,
  type ProjectCoordinatorPlanDraft,
  type ProjectCoordinatorPlanDraftEditInput,
  type ProjectCoordinatorPlanDraftGenerateInput,
  type ProjectCoordinatorPlanDraftGenerateFailureReason,
  type ProjectCoordinatorPlanDraftReadInput,
  type ProjectCoordinatorPlanDraftSubmitInput,
  type ProjectCoordinatorPlanSubmitResult,
  type ProjectCoordinatorProvisioningApplyInput,
  type ProjectCoordinatorProvisioningPlan,
  type ProjectCoordinatorProvisioningPlanInput,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateResult,
  type ProjectCoordinatorResultReviewInput,
  type ProjectCoordinatorTransferInput,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from '../contract.js'

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

const planDraftReadContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
  effect: 'read' as const,
  inputSchema: projectCoordinatorPlanDraftReadInputSchema,
  outputSchema: projectCoordinatorPlanDraftSchema.nullable()
})

const planDraftGenerateContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
  effect: 'workspace-write' as const,
  inputSchema: projectCoordinatorPlanDraftGenerateInputSchema,
  outputSchema: projectCoordinatorPlanDraftGenerateResultSchema
})

export class ProjectCoordinatorPlanDraftGenerationClientError extends Error {
  readonly reason: ProjectCoordinatorPlanDraftGenerateFailureReason

  constructor(reason: ProjectCoordinatorPlanDraftGenerateFailureReason) {
    super(planDraftGenerationFailureMessage(reason))
    this.name = 'ProjectCoordinatorPlanDraftGenerationClientError'
    this.reason = reason
  }
}

function planDraftGenerationFailureMessage(
  reason: ProjectCoordinatorPlanDraftGenerateFailureReason
): string {
  switch (reason) {
    case 'runtime_unavailable':
      return 'The local Agent Runtime is unavailable for Plan generation.'
    case 'runtime_execution_failed':
      return 'The local Agent Runtime could not complete structured Plan generation.'
    case 'invalid_structured_output':
      return 'The Agent returned a Plan that does not match the required task structure.'
  }
}

const planDraftEditContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
  effect: 'workspace-write' as const,
  inputSchema: projectCoordinatorPlanDraftEditInputSchema,
  outputSchema: projectCoordinatorPlanDraftSchema
})

const planSubmitContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorPlanDraftSubmitInputSchema,
  outputSchema: projectCoordinatorPlanSubmitResultSchema
})

const planConfirmActivateContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirmActivate,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorPlanConfirmActivateInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const contentProvisioningPlanContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.contentProvisioningPlan,
  effect: 'read' as const,
  inputSchema: projectCoordinatorProvisioningPlanInputSchema,
  outputSchema: projectCoordinatorProvisioningPlanSchema
})

const contentProvisioningApplyContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.contentProvisioningApply,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorProvisioningApplyInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const contentRecoveryObserveLinkContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorContentRecoveryObserveLinkInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const contentRecoveryAbandonContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
  effect: 'destructive' as const,
  inputSchema: projectCoordinatorContentRecoveryAbandonInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const contentRecoveryRetrySuccessorContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryRetrySuccessor,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorContentRecoveryRetrySuccessorInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

const membershipAddContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorMembershipAddInputSchema,
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

const artifactReviewPrepareContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.artifactReviewPrepare,
  effect: 'read' as const,
  inputSchema: projectCoordinatorArtifactReviewPrepareInputSchema,
  outputSchema: projectCoordinatorArtifactReviewPreparedSchema
})

const resultReviewContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview,
  effect: 'external-write' as const,
  inputSchema: projectCoordinatorResultReviewInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
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

export type ProjectCoordinatorRendererClient = Readonly<{
  readWorkspace(input?: ProjectCoordinatorWorkspaceReadInput): Promise<ProjectCoordinatorWorkspace>
  createProject(input: ProjectCoordinatorProjectCreateInput): Promise<ProjectCoordinatorProjectCreateResult>
  readPlanDraft(input: ProjectCoordinatorPlanDraftReadInput): Promise<ProjectCoordinatorPlanDraft | null>
  generatePlanDraft(input: ProjectCoordinatorPlanDraftGenerateInput): Promise<ProjectCoordinatorPlanDraft>
  editPlanDraft(input: ProjectCoordinatorPlanDraftEditInput): Promise<ProjectCoordinatorPlanDraft>
  submitPlanDraft(input: ProjectCoordinatorPlanDraftSubmitInput): Promise<ProjectCoordinatorPlanSubmitResult>
  confirmPlanAndActivate(input: ProjectCoordinatorPlanConfirmActivateInput): Promise<ProjectCoordinatorWorkspace>
  previewProvisioning(input: ProjectCoordinatorProvisioningPlanInput): Promise<ProjectCoordinatorProvisioningPlan>
  applyProvisioning(input: ProjectCoordinatorProvisioningApplyInput): Promise<ProjectCoordinatorWorkspace>
  observeAndLinkRecovery(
    input: ProjectCoordinatorContentRecoveryObserveLinkInput
  ): Promise<ProjectCoordinatorWorkspace>
  abandonRecovery(
    input: ProjectCoordinatorContentRecoveryAbandonInput
  ): Promise<ProjectCoordinatorWorkspace>
  retryRecoverySuccessor(
    input: ProjectCoordinatorContentRecoveryRetrySuccessorInput
  ): Promise<ProjectCoordinatorWorkspace>
  addMember(input: ProjectCoordinatorMembershipAddInput): Promise<ProjectCoordinatorWorkspace>
  removeMember(input: ProjectCoordinatorMembershipRemoveInput): Promise<ProjectCoordinatorWorkspace>
  createHumanNeeded(input: ProjectCoordinatorHumanNeededCreateInput): Promise<ProjectCoordinatorWorkspace>
  answerHumanNeeded(input: ProjectCoordinatorHumanAnswerInput): Promise<ProjectCoordinatorWorkspace>
  transferCoordinator(input: ProjectCoordinatorTransferInput): Promise<ProjectCoordinatorWorkspace>
  prepareArtifactReview(
    input: ProjectCoordinatorArtifactReviewPrepareInput,
    options?: Readonly<{ workspaceId?: string }>
  ): Promise<ProjectCoordinatorArtifactReviewPrepared>
  reviewResult(input: ProjectCoordinatorResultReviewInput): Promise<ProjectCoordinatorWorkspace>
  completeProject(input: ProjectCoordinatorCompleteInput): Promise<ProjectCoordinatorWorkspace>
}>

export function createProjectCoordinatorRendererClient(
  invoker: DomainRendererCapabilityInvoker
): ProjectCoordinatorRendererClient {
  return Object.freeze({
    readWorkspace: (input = {}) => invoker.invoke(workspaceReadContract, input),
    createProject: (input) => invoker.invoke(projectCreateContract, input, confirmationApproval),
    readPlanDraft: (input) => invoker.invoke(planDraftReadContract, input),
    generatePlanDraft: async (input) => {
      const result = await invoker.invoke(planDraftGenerateContract, input)
      if (result.status === 'failed') {
        throw new ProjectCoordinatorPlanDraftGenerationClientError(result.reason)
      }
      return result.draft
    },
    editPlanDraft: (input) => invoker.invoke(planDraftEditContract, input),
    submitPlanDraft: (input) => invoker.invoke(planSubmitContract, input, confirmationApproval),
    confirmPlanAndActivate: (input) => invoker.invoke(
      planConfirmActivateContract,
      input,
      confirmationApproval
    ),
    previewProvisioning: (input) => invoker.invoke(contentProvisioningPlanContract, input),
    applyProvisioning: (input) => invoker.invoke(
      contentProvisioningApplyContract,
      input,
      confirmationApproval
    ),
    observeAndLinkRecovery: (input) => invoker.invoke(
      contentRecoveryObserveLinkContract,
      input,
      confirmationApproval
    ),
    abandonRecovery: (input) => invoker.invoke(
      contentRecoveryAbandonContract,
      input,
      confirmationApproval
    ),
    retryRecoverySuccessor: (input) => invoker.invoke(
      contentRecoveryRetrySuccessorContract,
      input,
      confirmationApproval
    ),
    addMember: (input) => invoker.invoke(
      membershipAddContract,
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
    prepareArtifactReview: (input, options) => invoker.invoke(
      artifactReviewPrepareContract,
      input,
      options
    ),
    reviewResult: (input) => invoker.invoke(
      resultReviewContract,
      input,
      confirmationApproval
    ),
    completeProject: (input) => invoker.invoke(
      projectCompleteContract,
      input,
      confirmationApproval
    )
  })
}
