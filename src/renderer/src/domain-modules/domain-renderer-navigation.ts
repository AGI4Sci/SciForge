import type {
  DomainRendererWorkbenchHost,
  DomainRendererWorkspacePreviewHost,
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkspacePreviewTarget
} from '@sciforge/domain-sdk/host'
import {
  previewWorkspaceFile,
  type WorkspaceFilePreviewDetail
} from '../lib/workspace-file-preview'

export const DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT =
  'sciforge:domain-workbench-open-right-panel' as const

export const domainRendererNavigationHost: Readonly<{
  workspacePreview: DomainRendererWorkspacePreviewHost
  workbench: DomainRendererWorkbenchHost
}> = Object.freeze({
  workspacePreview: Object.freeze({
    open: (target: DomainWorkspacePreviewTarget) => {
      previewWorkspaceFile({
        ...target,
        ...(target.returnTo ? {
          returnTo: {
            kind: 'domain-right-panel',
            ...target.returnTo
          }
        } : {})
      } as WorkspaceFilePreviewDetail)
    }
  }),
  workbench: Object.freeze({
    openRightPanel: (input: DomainWorkbenchOpenRightPanelInput) => {
      window.dispatchEvent(new CustomEvent<DomainWorkbenchOpenRightPanelInput>(
        DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
        { detail: input }
      ))
    }
  })
})
