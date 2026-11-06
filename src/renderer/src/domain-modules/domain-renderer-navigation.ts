import type { ChatState } from '../store/chat-store-types'
import { workspaceRootIdentityKey } from '../lib/workspace-path'
import type {
  DomainRendererWorkbenchHost,
  DomainRendererWorkbenchSendMessageInput,
  DomainRendererWorkbenchSendMessageResult,
  DomainRendererWorkspacePreviewHost,
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkbenchOpenResourceInput,
  DomainWorkbenchOpenSurfaceInput,
  DomainWorkbenchOpenSessionInput,
  DomainWorkbenchOpenSideConversationInput,
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

type DomainWorkbenchSideConversationOpener = (input: DomainWorkbenchOpenSideConversationInput) => Promise<string | null>
let sideConversationOpener: DomainWorkbenchSideConversationOpener | null = null

export function setDomainWorkbenchSideConversationOpener(opener: DomainWorkbenchSideConversationOpener): () => void {
  sideConversationOpener = opener
  return () => {
    if (sideConversationOpener === opener) sideConversationOpener = null
  }
}

/** Resolve the explicit parent, including while a different main Session is visible. */
export async function openDomainWorkbenchSideConversation(
  input: DomainWorkbenchOpenSideConversationInput,
  state: Pick<ChatState, 'threads' | 'sideConversations' | 'spawnSideConversation' | 'selectSideConversation' | 'sendSideMessage'>
): Promise<string | null> {
  const parent = state.threads.find(thread => thread.id === input.parentThreadId.trim() && thread.runtimeId === input.runtimeId.trim())
  if (!parent?.runtimeId) return null
  if (input.workspaceRoot && (!parent.workspace || workspaceRootIdentityKey(input.workspaceRoot) !== workspaceRootIdentityKey(parent.workspace))) return null
  const context = input.context
  if (context && (!context.id.trim() || !context.title.trim() || context.text.length > 40000 ||
    (context.sourceRefs?.length ?? 0) > 100)) return null
  const existing = context && Object.values(state.sideConversations).find(side =>
    side.parentThreadId === parent.id && side.runtimeId === parent.runtimeId && side.context?.id === context.id)
  if (existing) {
    state.selectSideConversation(existing.threadId)
    if (input.question?.trim()) await state.sendSideMessage(existing.threadId, input.question.trim())
    return existing.threadId
  }
  return state.spawnSideConversation(input.question?.trim(), {
    parentThreadId: parent.id,
    runtimeId: parent.runtimeId,
    workspaceRoot: parent.workspace,
    title: input.title ?? context?.title,
    chatMode: input.chatMode ?? 'light',
    ...(context ? { context } : {})
  })
}

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
  // Store selection is keyed by Session ID; ambiguous catalogs cannot safely route a source.
  if (threads.some(thread => thread.id === threadId && thread.runtimeId !== runtimeId)) return null
  if ((input.turnId !== undefined && !input.turnId.trim()) || (input.itemId !== undefined && !input.itemId.trim())) return null
  return threads.some(thread => thread.id === threadId && thread.runtimeId === runtimeId &&
    (!input.workspaceRoot || (thread.workspace && workspaceRootIdentityKey(thread.workspace) === workspaceRootIdentityKey(input.workspaceRoot))))
    ? { threadId, runtimeId } : null
}

/** Canonical selection, including read-only source views. No send/resume path is invoked. */
export async function selectDomainWorkbenchSession(input: DomainWorkbenchOpenSessionInput, get: () => Pick<ChatState, 'threads' | 'activeThreadId' | 'selectThread' | 'error'>): Promise<boolean> {
  const target = resolveDomainWorkbenchSession(input, get().threads)
  if (!target) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const selected = await Promise.race([
      get().selectThread(target.threadId, { readOnly: Boolean(input.readOnly || input.turnId || input.itemId) }).then(() => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 12000) })
    ])
    return selected && get().activeThreadId === target.threadId && !get().error && Boolean(resolveDomainWorkbenchSession(input, get().threads))
  } finally { if (timer) clearTimeout(timer) }
}

type DomainWorkbenchResourceNavigationProvider = Readonly<{
  canOpen: (resourceKind: string) => boolean
  resolve: (input: DomainWorkbenchOpenResourceInput) => DomainWorkbenchOpenRightPanelInput | null
}>

let resourceNavigationProvider: DomainWorkbenchResourceNavigationProvider | null = null
/**
 * Development plugin panels are not domain renderer contributions, so they get
 * a second, lower-priority resolver. Domain packages always win a resource
 * kind they already own.
 */
let developmentResourceNavigationProvider: DomainWorkbenchResourceNavigationProvider | null = null

export function setDomainWorkbenchResourceNavigationProvider(
  provider: DomainWorkbenchResourceNavigationProvider
): () => void {
  const previous = resourceNavigationProvider
  resourceNavigationProvider = provider
  return () => {
    if (resourceNavigationProvider === provider) resourceNavigationProvider = previous
  }
}

export function setDevelopmentWorkbenchResourceNavigationProvider(
  provider: DomainWorkbenchResourceNavigationProvider
): () => void {
  const previous = developmentResourceNavigationProvider
  developmentResourceNavigationProvider = provider
  return () => {
    if (developmentResourceNavigationProvider === provider) developmentResourceNavigationProvider = previous
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
    openSideConversation: (input: DomainWorkbenchOpenSideConversationInput) =>
      sideConversationOpener?.(input) ?? Promise.resolve(null),
    canOpenResource: (resourceKind: string) =>
      (resourceNavigationProvider?.canOpen(resourceKind) ?? false) ||
      (developmentResourceNavigationProvider?.canOpen(resourceKind) ?? false),
    openResource: (input: DomainWorkbenchOpenResourceInput) => {
      const rightPanel = resourceNavigationProvider?.resolve(input) ??
        developmentResourceNavigationProvider?.resolve(input) ?? null
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
    if (!('reexecuteInput' in request) && !state.threads.some((thread) => thread.id === requestedSessionId)) {
      return { ok: false, error: { code: 'session-unavailable', message: '指定会话不存在或已不可访问，消息尚未发送。' } }
    }
    const sent = 'reexecuteInput' in request
      ? await state.reexecuteFailedInput({ ...request.reexecuteInput, threadId: requestedSessionId })
      : await state.sendMessage(request.text, 'agent', {
          targetThreadId: requestedSessionId,
          ...(request.displayText ? { displayText: request.displayText } : {})
        })
    return sent ? { ok: true } : { ok: false, error: {
      code: 'message-not-sent', message: '消息未能发送到指定会话，请刷新会话后重试。'
    } }
  } catch {
    return { ok: false, error: { code: 'message-failed', message: '会话操作失败，请刷新后重试。' } }
  }
}
