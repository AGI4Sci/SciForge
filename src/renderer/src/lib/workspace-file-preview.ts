import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type {
  DomainWorkbenchRightPanelActivation,
  DomainWorkbenchRightPanelTarget
} from '@sciforge/domain-sdk/host'

export const WORKSPACE_FILE_PREVIEW_EVENT = 'sciforge:workspace-file-preview'

export type WorkspaceFilePreviewReturnContext = {
  kind: 'domain-right-panel'
  contributionId: string
  label?: string
  activation?: DomainWorkbenchRightPanelActivation
}

export type WorkspaceFilePreviewDetail = WorkspaceFileTarget &
  DomainWorkbenchRightPanelTarget & {
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
