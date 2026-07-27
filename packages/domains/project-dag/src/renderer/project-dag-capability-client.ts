import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  PROJECT_DAG_CAPABILITY_IDS,
  projectDagResolveEvidencePreviewInputSchema,
  projectDagResolveEvidencePreviewResultSchema,
  projectDagSaveGoalInputSchema,
  projectDagSaveGoalResultSchema,
  projectDagUpdateInputSchema,
  projectDagUpdateResultSchema,
  projectDagViewInputSchema,
  projectDagViewResultSchema,
  type ProjectDagResolveEvidencePreviewInput,
  type ProjectDagResolveEvidencePreviewResult,
  type ProjectDagSaveGoalInput,
  type ProjectDagSaveGoalResult,
  type ProjectDagTarget,
  type ProjectDagUpdateInput,
  type ProjectDagUpdateResult,
  type ProjectDagViewInput,
  type ProjectDagViewResult
} from '../contract'

export const projectDagCapabilityContracts = Object.freeze({
  view: {
    actionId: PROJECT_DAG_CAPABILITY_IDS.view,
    effect: 'read' as const,
    inputSchema: projectDagViewInputSchema,
    outputSchema: projectDagViewResultSchema
  },
  update: {
    actionId: PROJECT_DAG_CAPABILITY_IDS.update,
    effect: 'compute' as const,
    inputSchema: projectDagUpdateInputSchema,
    outputSchema: projectDagUpdateResultSchema
  },
  saveGoal: {
    actionId: PROJECT_DAG_CAPABILITY_IDS.saveGoal,
    effect: 'compute' as const,
    inputSchema: projectDagSaveGoalInputSchema,
    outputSchema: projectDagSaveGoalResultSchema
  },
  resolveEvidencePreview: {
    actionId: PROJECT_DAG_CAPABILITY_IDS.resolveEvidencePreview,
    effect: 'read' as const,
    inputSchema: projectDagResolveEvidencePreviewInputSchema,
    outputSchema: projectDagResolveEvidencePreviewResultSchema
  }
})

export type ProjectDagCapabilityClient = Readonly<{
  view: (input: ProjectDagViewInput) => Promise<ProjectDagViewResult>
  update: (input: ProjectDagUpdateInput) => Promise<ProjectDagUpdateResult>
  saveGoal: (input: ProjectDagSaveGoalInput) => Promise<ProjectDagSaveGoalResult>
  resolveEvidencePreview: (
    input: ProjectDagResolveEvidencePreviewInput
  ) => Promise<ProjectDagResolveEvidencePreviewResult>
}>

export function createProjectDagCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): ProjectDagCapabilityClient {
  return Object.freeze({
    view: (input) => invoker.invoke(
      projectDagCapabilityContracts.view,
      input,
      workspaceInvokeOptions(input)
    ),
    update: (input) => invoker.invoke(
      projectDagCapabilityContracts.update,
      input,
      workspaceInvokeOptions(input)
    ),
    saveGoal: (input) => invoker.invoke(
      projectDagCapabilityContracts.saveGoal,
      input,
      workspaceInvokeOptions(input)
    ),
    resolveEvidencePreview: (input) =>
      invoker.invoke(
        projectDagCapabilityContracts.resolveEvidencePreview,
        input,
        workspaceInvokeOptions(input)
      )
  })
}

function workspaceInvokeOptions(
  input: ProjectDagTarget
): Readonly<{ workspaceId?: string }> | undefined {
  const workspaceId = input.workspaceRoot ?? input.projectRoot
  return workspaceId === undefined ? undefined : { workspaceId }
}
