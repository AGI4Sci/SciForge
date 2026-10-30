import type { ChatState } from '../store/chat-store-types'
import type {
  DomainRendererWorkbenchHost,
  DomainRendererWorkbenchSendMessageInput,
  DomainRendererWorkbenchSendMessageResult,
  DomainRendererWorkspacePreviewHost,
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkbenchOpenResourceInput,
  DomainWorkbenchOpenSurfaceInput,
  DomainWorkbenchOpenSessionInput,
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

type DomainWorkbenchMessageSender = (
  input: DomainRendererWorkbenchSendMessageInput
) => Promise<DomainRendererWorkbenchSendMessageResult>

let messageSender: DomainWorkbenchMessageSender | null = null

type DomainWorkbenchSessionNavigator = (input: DomainWorkbenchOpenSessionInput) => Promise<boolean>
let sessionNavigator: DomainWorkbenchSessionNavigator | null = null

export function setDomainWorkbenchSessionNavigator(navigator: DomainWorkbenchSessionNavigator): () => void {
  sessionNavigator = navigator
  return () => {
    if (sessionNavigator === navigator) sessionNavigator = null
  }
}

/** Domain navigation resolves only an exact Session in the current principal's catalog. */
export function resolveDomainWorkbenchSession(
  input: DomainWorkbenchOpenSessionInput,
  threads: Pick<ChatState, 'threads'>['threads']
): { threadId: string; runtimeId: string } | null {
  const runtimeId = input.runtimeId.trim()
  const threadId = input.threadId.trim()
  if (!runtimeId || !threadId) return null
  return threads.some(thread => thread.id === threadId && thread.runtimeId === runtimeId)
    ? { threadId, runtimeId } : null
}

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
    openSession: (input: DomainWorkbenchOpenSessionInput) =>
      sessionNavigator?.(input) ?? Promise.resolve(false),
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

/** All domain sends and Session reexecution use the Workbench's canonical store actions. */
export async function sendDomainWorkbenchMessage(
  request: DomainRendererWorkbenchSendMessageInput,
  state: Pick<ChatState, 'sendMessage' | 'reexecuteFailedInput' | 'activeThreadId' | 'threads'>
): Promise<DomainRendererWorkbenchSendMessageResult> {
  try {
    const requestedSessionId = request.sessionId.trim()
    const sent = 'reexecuteInput' in request
      ? await state.reexecuteFailedInput({ ...request.reexecuteInput, threadId: requestedSessionId })
      : await state.sendMessage(request.text, 'agent', {
          targetThreadId: state.threads.some((thread) => thread.id === requestedSessionId)
            ? requestedSessionId : state.activeThreadId ?? undefined,
          ...(request.displayText ? { displayText: request.displayText } : {})
        })
    return sent ? { ok: true } : { ok: false, error: {
      code: 'message-not-sent', message: '消息未能发送到指定会话，请刷新会话后重试。'
    } }
  } catch {
    return { ok: false, error: { code: 'message-failed', message: '会话操作失败，请刷新后重试。' } }
  }
}
