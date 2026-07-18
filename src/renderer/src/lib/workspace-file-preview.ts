import type { WorkspaceFileTarget } from '@shared/workspace-file'

export const WORKSPACE_FILE_PREVIEW_EVENT = 'sciforge:workspace-file-preview'

export function normalizeProjectDagGraphNodeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const nodeId = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,511}$/u.test(nodeId) ? nodeId : undefined
}

export type WorkspaceFilePreviewReturnContext =
  | {
      kind: 'project-dag'
      label?: string
      claimId?: string
      nodeId?: string
    }
  | {
      kind: 'evidence-dag'
      label?: string
      nodeId: string
      threadId: string
    }

export type WorkspaceFilePreviewDetail = WorkspaceFileTarget & {
  sessionId?: string
  kind?: 'file' | 'directory'
  returnTo?: WorkspaceFilePreviewReturnContext
}

export function previewWorkspaceFile(target: WorkspaceFilePreviewDetail): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceFilePreviewDetail>(WORKSPACE_FILE_PREVIEW_EVENT, {
      detail: target
    })
  )
}
