import type {
  DomainRendererWorkbenchHost,
  DomainRendererWorkbenchSendMessageInput,
  DomainRendererWorkbenchSendMessageResult,
  DomainRendererWorkspacePreviewHost,
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkbenchOpenResourceInput,
  DomainWorkbenchOpenSurfaceInput,
  DomainWorkbenchToggleGlobalOverlayInput,
  DomainWorkspacePreviewTarget
} from '@sciforge/domain-sdk/host'
import {
  previewWorkspaceFile,
  type WorkspaceFilePreviewDetail
} from '../lib/workspace-file-preview'

export const DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT =
  'sciforge:domain-workbench-open-right-panel' as const
export const DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT =
  'sciforge:domain-workbench-open-bottom-panel' as const
export const DOMAIN_WORKBENCH_TOGGLE_GLOBAL_OVERLAY_EVENT =
  'sciforge:domain-workbench-toggle-global-overlay' as const
export const DOMAIN_WORKBENCH_OPEN_SETTINGS_EVENT =
  'sciforge:domain-workbench-open-settings' as const

type DomainWorkbenchMessageSender = (
  input: DomainRendererWorkbenchSendMessageInput
) => Promise<DomainRendererWorkbenchSendMessageResult>

let messageSender: DomainWorkbenchMessageSender | null = null

type DomainWorkbenchResourceNavigationProvider = Readonly<{
  canOpen: (resourceKind: string) => boolean
  resolve: (input: DomainWorkbenchOpenResourceInput) => DomainWorkbenchOpenRightPanelInput | null
}>

let resourceNavigationProvider: DomainWorkbenchResourceNavigationProvider | null = null

export function setDomainWorkbenchResourceNavigationProvider(
  provider: DomainWorkbenchResourceNavigationProvider
): () => void {
  const previous = resourceNavigationProvider
  resourceNavigationProvider = provider
  return () => {
    if (resourceNavigationProvider === provider) resourceNavigationProvider = previous
  }
}

export function setDomainWorkbenchMessageSender(
  sender: DomainWorkbenchMessageSender
): () => void {
  messageSender = sender
  return () => {
    if (messageSender === sender) messageSender = null
  }
}

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
    canOpenResource: (resourceKind: string) =>
      resourceNavigationProvider?.canOpen(resourceKind) ?? false,
    openResource: (input: DomainWorkbenchOpenResourceInput) => {
      const rightPanel = resourceNavigationProvider?.resolve(input) ?? null
      if (!rightPanel) return false
      window.dispatchEvent(new CustomEvent<DomainWorkbenchOpenRightPanelInput>(
        DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
        { detail: rightPanel }
      ))
      return true
    },
    openRightPanel: (input: DomainWorkbenchOpenRightPanelInput) => {
      window.dispatchEvent(new CustomEvent<DomainWorkbenchOpenRightPanelInput>(
        DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
        { detail: input }
      ))
    },
    openBottomPanel: (input: DomainWorkbenchOpenSurfaceInput) => {
      window.dispatchEvent(new CustomEvent<DomainWorkbenchOpenSurfaceInput>(
        DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT,
        { detail: input }
      ))
    },
    toggleGlobalOverlay: (input: DomainWorkbenchToggleGlobalOverlayInput) => {
      window.dispatchEvent(new CustomEvent<DomainWorkbenchToggleGlobalOverlayInput>(
        DOMAIN_WORKBENCH_TOGGLE_GLOBAL_OVERLAY_EVENT,
        { detail: input }
      ))
    },
    openSettings: (input: Readonly<{ sectionId: string }>) => {
      const sectionId = input.sectionId.trim()
      if (!sectionId) return false
      window.dispatchEvent(new CustomEvent<Readonly<{ sectionId: string }>>(
        DOMAIN_WORKBENCH_OPEN_SETTINGS_EVENT,
        { detail: { sectionId } }
      ))
      return true
    },
    sendMessage: (input: DomainRendererWorkbenchSendMessageInput) =>
      messageSender?.(input) ?? Promise.resolve({
        ok: false,
        error: {
          code: 'workbench-unavailable',
          message: 'The Workbench message host is not available.'
        }
      })
  })
})
