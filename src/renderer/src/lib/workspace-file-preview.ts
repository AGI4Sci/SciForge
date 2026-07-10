import type { WorkspaceFileTarget } from '@shared/workspace-file'

export const WORKSPACE_FILE_PREVIEW_EVENT = 'sciforge:workspace-file-preview'

export type WorkspaceFilePreviewReturnContext = {
  kind: 'project-dag'
  label?: string
  claimId?: string
}

export type WorkspaceFilePreviewDetail = WorkspaceFileTarget & {
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
