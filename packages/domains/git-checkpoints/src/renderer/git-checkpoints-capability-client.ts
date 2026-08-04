import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  GIT_CHECKPOINTS_CAPABILITY_IDS,
  gitCheckpointCreateInputSchema,
  gitCheckpointCreateResultSchema,
  gitCheckpointListInputSchema,
  gitCheckpointListResultSchema,
  gitCheckpointPreviewInputSchema,
  gitCheckpointPreviewResultSchema,
  gitCheckpointRestoreInputSchema,
  gitCheckpointRestoreResultSchema,
  type GitCheckpoint,
  type GitCheckpointCreateInput,
  type GitCheckpointListInput,
  type GitCheckpointPreview,
  type GitCheckpointRestore,
  type GitCheckpointRestoreInput,
  type GitCheckpointResult
} from '../contract'

export const gitCheckpointsCapabilityContracts = Object.freeze({
  list: {
    actionId: GIT_CHECKPOINTS_CAPABILITY_IDS.list,
    effect: 'read' as const,
    inputSchema: gitCheckpointListInputSchema,
    outputSchema: gitCheckpointListResultSchema
  },
  create: {
    actionId: GIT_CHECKPOINTS_CAPABILITY_IDS.create,
    effect: 'workspace-write' as const,
    inputSchema: gitCheckpointCreateInputSchema,
    outputSchema: gitCheckpointCreateResultSchema
  },
  preview: {
    actionId: GIT_CHECKPOINTS_CAPABILITY_IDS.preview,
    effect: 'read' as const,
    inputSchema: gitCheckpointPreviewInputSchema,
    outputSchema: gitCheckpointPreviewResultSchema
  },
  restore: {
    actionId: GIT_CHECKPOINTS_CAPABILITY_IDS.restore,
    effect: 'destructive' as const,
    inputSchema: gitCheckpointRestoreInputSchema,
    outputSchema: gitCheckpointRestoreResultSchema
  }
})

export type GitCheckpointsMutationConfirmation = Readonly<{
  approval: Readonly<{ mode: 'confirmation' }>
}>

export type GitCheckpointsCapabilityClient = Readonly<{
  list(input: GitCheckpointListInput): Promise<GitCheckpointResult<readonly GitCheckpoint[]>>
  create(input: GitCheckpointCreateInput): Promise<GitCheckpointResult<GitCheckpoint>>
  preview(
    checkpointId: string,
    workspaceRoot: string
  ): Promise<GitCheckpointResult<GitCheckpointPreview>>
  restore(
    input: GitCheckpointRestoreInput,
    workspaceRoot: string,
    confirmation: GitCheckpointsMutationConfirmation
  ): Promise<GitCheckpointResult<GitCheckpointRestore>>
}>

export function createGitCheckpointsCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): GitCheckpointsCapabilityClient {
  return Object.freeze({
    list: (input) => invoker.invoke(
      gitCheckpointsCapabilityContracts.list,
      input,
      input.workspaceRoot ? { workspaceId: input.workspaceRoot } : undefined
    ),
    create: (input) => invoker.invoke(
      gitCheckpointsCapabilityContracts.create,
      input,
      { workspaceId: input.workspaceRoot }
    ),
    preview: (checkpointId, workspaceRoot) => invoker.invoke(
      gitCheckpointsCapabilityContracts.preview,
      { checkpointId },
      { workspaceId: workspaceRoot }
    ),
    restore: (input, workspaceRoot, confirmation) => invoker.invoke(
      gitCheckpointsCapabilityContracts.restore,
      input,
      { workspaceId: workspaceRoot, ...confirmation }
    )
  })
}
