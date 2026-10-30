/**
 * The only environment seam the checkpoint core needs: snapshot operations on
 * the caller's workspace. The static adapter implements this port through the
 * host's governed `version-control.*` capabilities; this plugin ships a local
 * Git fixture implementation for offline use and testing until the host
 * capability bridge for plugins exists (see plugins/GAPS.md, G1).
 */
export type GitCheckpointCaptureInput = Readonly<{
  workspaceRoot: string
  snapshotName: string
}>

export type GitCheckpointCaptureResult = Readonly<{
  snapshotId: string
  provider: string
  revision: string
  changeSummary: string
}>

export type GitCheckpointPreviewInput = Readonly<{
  workspaceRoot: string
  snapshotId: string
}>

export type GitCheckpointPreviewResult = Readonly<{
  patch: string
  truncated: boolean
}>

export type GitCheckpointRestorePortInput = Readonly<{
  workspaceRoot: string
  snapshotId: string
}>

export type GitCheckpointVcsPort = Readonly<{
  capture(input: GitCheckpointCaptureInput): Promise<GitCheckpointCaptureResult>
  preview(input: GitCheckpointPreviewInput): Promise<GitCheckpointPreviewResult>
  restore(input: GitCheckpointRestorePortInput): Promise<void>
}>
