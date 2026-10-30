import { resolve } from 'node:path'
import {
  gitCheckpointCreateInputSchema,
  gitCheckpointListInputSchema,
  gitCheckpointPreviewInputSchema,
  gitCheckpointRestoreInputSchema,
  type GitCheckpoint,
  type GitCheckpointPreview,
  type GitCheckpointRestore,
  type GitCheckpointResult
} from '../contract.js'
import type { GitCheckpointService } from './service.js'

/**
 * Capability-handler orchestration, migrated from the static module's
 * main.ts capability factory. Each operation takes the caller's workspace
 * explicitly: the static adapter derives it from the invocation context,
 * while the DSH adapter takes it from a required tool parameter until the
 * host forwards caller workspace identity to plugins (see plugins/GAPS.md,
 * G1). Policy checks and messages are identical on both paths.
 */

export async function listCheckpoints(
  service: GitCheckpointService,
  rawInput: unknown,
  callerWorkspace: string
): Promise<Readonly<{ output: GitCheckpointResult<readonly GitCheckpoint[]> }>> {
  const workspaceRoot = requireWorkspace(callerWorkspace)
  const input = gitCheckpointListInputSchema.parse(rawInput)
  assertRequestedWorkspace(input.workspaceRoot, workspaceRoot)
  return {
    output: await service.list({
      ...input,
      workspaceRoot
    })
  }
}

export async function createCheckpoint(
  service: GitCheckpointService,
  rawInput: unknown,
  callerWorkspace: string
): Promise<Readonly<{ output: GitCheckpointResult<GitCheckpoint> }>> {
  const workspaceRoot = requireWorkspace(callerWorkspace)
  const input = gitCheckpointCreateInputSchema.parse(rawInput)
  assertRequestedWorkspace(input.workspaceRoot, workspaceRoot)
  if (input.phase !== 'manual') {
    throw new Error('The public create capability only creates manual checkpoints.')
  }
  const output = await service.create({
    ...input,
    workspaceRoot,
    phase: 'manual'
  })
  return { output }
}

export async function previewCheckpoint(
  service: GitCheckpointService,
  rawInput: unknown,
  callerWorkspace: string
): Promise<Readonly<{ output: GitCheckpointResult<GitCheckpointPreview> }>> {
  const workspaceRoot = requireWorkspace(callerWorkspace)
  const input = gitCheckpointPreviewInputSchema.parse(rawInput)
  return {
    output: await service.preview(
      input.checkpointId,
      workspaceRoot
    )
  }
}

export async function restoreCheckpoint(
  service: GitCheckpointService,
  rawInput: unknown,
  callerWorkspace: string
): Promise<Readonly<{ output: GitCheckpointResult<GitCheckpointRestore> }>> {
  const workspaceRoot = requireWorkspace(callerWorkspace)
  const input = gitCheckpointRestoreInputSchema.parse(rawInput)
  const output = await service.restore(input, workspaceRoot)
  return { output }
}

function requireWorkspace(callerWorkspace: string | undefined): string {
  const workspaceRoot = callerWorkspace?.trim()
  if (!workspaceRoot) {
    throw new Error('Git Checkpoints requires a workspace-scoped caller.')
  }
  return workspaceRoot
}

function assertRequestedWorkspace(
  requested: string | undefined,
  callerWorkspace: string
): void {
  if (!requested) return
  if (resolve(requested) !== resolve(callerWorkspace)) {
    throw new Error('Git Checkpoints cannot access another workspace.')
  }
}
