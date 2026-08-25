import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorPlanConfirmActivateInputSchema,
  projectCoordinatorPlanDraftEditInputSchema,
  projectCoordinatorPlanDraftGenerateInputSchema,
  projectCoordinatorPlanDraftReadInputSchema,
  projectCoordinatorPlanDraftSchema,
  projectCoordinatorPlanDraftSubmitInputSchema,
  projectCoordinatorPlanSubmitResultSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorPlanConfirmActivateInput,
  type ProjectCoordinatorPlanDraft,
  type ProjectCoordinatorPlanDraftEditInput,
  type ProjectCoordinatorPlanDraftGenerateInput,
  type ProjectCoordinatorPlanDraftReadInput,
  type ProjectCoordinatorPlanDraftSubmitInput,
  type ProjectCoordinatorPlanSubmitResult,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateResult,
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
  outputSchema: projectCoordinatorPlanDraftSchema
})

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

export type ProjectCoordinatorRendererClient = Readonly<{
  readWorkspace(input?: ProjectCoordinatorWorkspaceReadInput): Promise<ProjectCoordinatorWorkspace>
  createProject(input: ProjectCoordinatorProjectCreateInput): Promise<ProjectCoordinatorProjectCreateResult>
  readPlanDraft(input: ProjectCoordinatorPlanDraftReadInput): Promise<ProjectCoordinatorPlanDraft | null>
  generatePlanDraft(input: ProjectCoordinatorPlanDraftGenerateInput): Promise<ProjectCoordinatorPlanDraft>
  editPlanDraft(input: ProjectCoordinatorPlanDraftEditInput): Promise<ProjectCoordinatorPlanDraft>
  submitPlanDraft(input: ProjectCoordinatorPlanDraftSubmitInput): Promise<ProjectCoordinatorPlanSubmitResult>
  confirmPlanAndActivate(input: ProjectCoordinatorPlanConfirmActivateInput): Promise<ProjectCoordinatorWorkspace>
}>

export function createProjectCoordinatorRendererClient(
  invoker: DomainRendererCapabilityInvoker
): ProjectCoordinatorRendererClient {
  return Object.freeze({
    readWorkspace: (input = {}) => invoker.invoke(workspaceReadContract, input),
    createProject: (input) => invoker.invoke(projectCreateContract, input),
    readPlanDraft: (input) => invoker.invoke(planDraftReadContract, input),
    generatePlanDraft: (input) => invoker.invoke(planDraftGenerateContract, input),
    editPlanDraft: (input) => invoker.invoke(planDraftEditContract, input),
    submitPlanDraft: (input) => invoker.invoke(planSubmitContract, input),
    confirmPlanAndActivate: (input) => invoker.invoke(planConfirmActivateContract, input)
  })
}
