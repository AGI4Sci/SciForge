import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from '../contract.js'

const workspaceReadContract = Object.freeze({
  actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
  effect: 'read' as const,
  inputSchema: projectCoordinatorWorkspaceReadInputSchema,
  outputSchema: projectCoordinatorWorkspaceSchema
})

export type ProjectCoordinatorRendererClient = Readonly<{
  readWorkspace(input?: ProjectCoordinatorWorkspaceReadInput): Promise<ProjectCoordinatorWorkspace>
}>

export function createProjectCoordinatorRendererClient(
  invoker: DomainRendererCapabilityInvoker
): ProjectCoordinatorRendererClient {
  return Object.freeze({
    readWorkspace: (input = {}) => invoker.invoke(workspaceReadContract, input)
  })
}
