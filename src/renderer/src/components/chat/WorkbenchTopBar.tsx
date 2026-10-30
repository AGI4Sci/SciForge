import { type ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DomainRendererCommandInvocation } from '@sciforge/domain-sdk/renderer'
import type { EditorInfo } from '@shared/editor'
import type { GuiUpdateState } from '@shared/gui-update'
import {
  ArrowUpCircle,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  ClipboardList,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  MessageCircleMore,
  RefreshCw,
  Terminal
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readPreferredEditorId, writePreferredEditorId } from '../../lib/editor-preferences'
import { openSafeExternalUrl } from '../../lib/open-external'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import type {
  RegisteredWorkbenchToolbarActionContribution
} from '../../domain-modules/workbench-toolbar-slot'
import { visibleWorkbenchToolbarActions } from '../../domain-modules/workbench-toolbar-preferences'
import { useWorkbenchToolbarSettings } from '../../lib/use-workbench-toolbar-settings'
import { AdaptiveToolbar, type ToolbarAction } from './AdaptiveToolbar'
import { WorkbenchToolbarCustomizer } from './WorkbenchToolbarCustomizer'

export const RIGHT_PANEL_MODES = [
  'todo',
  'file',
  'plan',
  'sdd-ai',
  'child-agents'
] as const

export type CoreRightPanelMode = (typeof RIGHT_PANEL_MODES)[number]
export type ContributedRightPanelMode = string & {
  readonly __contributedRightPanelMode?: never
}
export type RightPanelMode = CoreRightPanelMode | ContributedRightPanelMode | null

export type WorkbenchTopBarProps = {
  focusedRightPanelMode: RightPanelMode
  onToggleFocusedRightPanelMode: (mode: Exclude<RightPanelMode, null>) => void
  workspaceRoot?: string
  planPanelEnabled?: boolean
  toolbarActions?: readonly RegisteredWorkbenchToolbarActionContribution[]
  toolbarCommandInvocation?: DomainRendererCommandInvocation
  onExecuteToolbarCommand?: (commandId: string) => void
  sideChatCount?: number
  sideChatRunningCount?: number
  sideChatOpen?: boolean
  sideChatEnabled?: boolean
  onOpenSideChat?: () => void
  childAgentCount?: number
  childAgentRunningCount?: number
  childAgentAttentionCount?: number
  childAgentsOpen?: boolean
  onOpenChildAgents?: () => void
}

export function WorkbenchTopBar({
  focusedRightPanelMode,
  onToggleFocusedRightPanelMode,
  workspaceRoot = '',
  planPanelEnabled = false,
  toolbarActions = [],
  toolbarCommandInvocation,
  onExecuteToolbarCommand,
  sideChatCount = 0,
  sideChatRunningCount = 0,
  sideChatOpen = false,
  sideChatEnabled = true,
  onOpenSideChat,
  childAgentCount = 0,
  childAgentRunningCount = 0,
  childAgentAttentionCount = 0,
  childAgentsOpen = false,
  onOpenChildAgents
}: WorkbenchTopBarProps): ReactElement {
  const { t } = useTranslation(['common', 'settings'])
  const [editors, setEditors] = useState<EditorInfo[]>([])
  const [selectedEditorId, setSelectedEditorId] = useState(() => readPreferredEditorId() ?? '')
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(() => new Set())
  const [guiUpdateState, setGuiUpdateState] = useState<GuiUpdateState>({ status: 'idle' })
  const [applyingGuiUpdate, setApplyingGuiUpdate] = useState(false)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const {
    preferences: toolbarPreferences,
    saveState: toolbarSaveState,
    saveError: toolbarSaveError,
    savePreferences: saveToolbarPreferences
  } = useWorkbenchToolbarSettings()
  const editorMenuButtonRef = useRef<HTMLButtonElement>(null)
  const editorMenuPanelRef = useRef<HTMLDivElement>(null)
  const [editorMenuPosition, setEditorMenuPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const toolbarContext: DomainRendererCommandInvocation =
    toolbarCommandInvocation ?? (workspaceRoot ? { workspaceRoot } : {})
  const contributedItems = visibleWorkbenchToolbarActions(
    toolbarActions,
    toolbarPreferences
  )
    .filter(({ contribution }) => contribution.isAvailable(toolbarContext))
    .map(({ id, contribution }) => ({
      id,
      commandId: contribution.commandId,
      label: t(contribution.label),
      icon: contribution.icon,
      active: contribution.isActive(toolbarContext),
      attention: typeof contribution.attention === 'function'
        ? contribution.attention()
        : contribution.attention
    }))
  const items = [
    ...(planPanelEnabled ? [{ mode: 'plan' as const, label: t('rightPanelPlan'), icon: ClipboardList }] : []),
    { mode: 'file' as const, label: t('rightPanelFiles'), icon: FolderOpen }
  ]
  const selectedEditor = useMemo(
    () => editors.find((editor) => editor.id === selectedEditorId) ?? editors[0],
    [editors, selectedEditorId]
  )

  useEffect(() => {
    let cancelled = false
    if (typeof window.sciforge?.listEditors !== 'function') return

    void window.sciforge.listEditors()
      .then((result) => {
        if (cancelled) return
        const available = result.editors.filter((editor) => editor.available)
        const stored = readPreferredEditorId()
        const nextId =
          stored && available.some((editor) => editor.id === stored)
            ? stored
            : result.defaultEditorId
        setEditors(available)
        setSelectedEditorId(nextId)
        writePreferredEditorId(nextId)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  const updateEditorMenuPosition = useCallback((): void => {
    const anchor = editorMenuButtonRef.current
    if (!anchor || typeof window === 'undefined') {
      setEditorMenuPosition(null)
      return
    }

    const rect = anchor.getBoundingClientRect()
    const scale = rect.width / anchor.offsetWidth
    const viewportWidth = window.innerWidth / scale
    const menuWidth = Math.min(256, viewportWidth - 16)
    const left = Math.min(Math.max(8, rect.right / scale - menuWidth), Math.max(8, viewportWidth - menuWidth - 8))
    setEditorMenuPosition({ left, top: rect.bottom / scale + 8, width: menuWidth })
  }, [])

  useEffect(() => {
    if (!editorMenuOpen) {
      setEditorMenuPosition(null)
      return
    }

    updateEditorMenuPosition()

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (editorMenuButtonRef.current?.contains(target) || editorMenuPanelRef.current?.contains(target)) return
      setEditorMenuOpen(false)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setEditorMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', updateEditorMenuPosition)
    window.addEventListener('scroll', updateEditorMenuPosition, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', updateEditorMenuPosition)
      window.removeEventListener('scroll', updateEditorMenuPosition, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [editorMenuOpen, updateEditorMenuPosition])

  useEffect(() => {
    if (typeof window.sciforge?.onGuiUpdateState !== 'function') return
    const applyState = (state: GuiUpdateState): void => {
      setGuiUpdateState(state)
    }
    const unsubscribe = window.sciforge.onGuiUpdateState(applyState)
    if (typeof window.sciforge?.getGuiUpdateState === 'function') {
      void window.sciforge.getGuiUpdateState().then(applyState).catch(() => undefined)
    }
    return unsubscribe
  }, [])

  const guiUpdateAction = useMemo(() => {
    if (guiUpdateState.status === 'available' || guiUpdateState.status === 'downloaded') {
      return guiUpdateState.info.hasUpdate ? guiUpdateState.info : null
    }
    if (guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing') {
      return guiUpdateState.info?.hasUpdate ? guiUpdateState.info : null
    }
    if (guiUpdateState.status === 'error' && guiUpdateState.info?.ok && guiUpdateState.info.hasUpdate) {
      return guiUpdateState.info
    }
    return null
  }, [guiUpdateState])
  const guiUpdateBusy =
    applyingGuiUpdate || guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing'
  const guiUpdateLabel = useMemo(() => {
    if (!guiUpdateAction) return ''
    if (guiUpdateState.status === 'downloading') {
      return t('guiUpdateTopbarDownloading', {
        percent: Math.max(0, Math.round(guiUpdateState.progress.percent))
      })
    }
    if (guiUpdateState.status === 'installing') {
      return t('guiUpdateTopbarInstalling')
    }
    if (guiUpdateAction.downloaded || guiUpdateState.status === 'downloaded') {
      return t('settings:guiUpdateInstall')
    }
    if (guiUpdateAction.manualOnly) {
      return t('guiUpdateTopbarManual', { version: guiUpdateAction.latestVersion })
    }
    return t('guiUpdateTopbarAvailable', { version: guiUpdateAction.latestVersion })
  }, [guiUpdateAction, guiUpdateState, t])
  const guiUpdateTitle = useMemo(() => {
    if (!guiUpdateAction) return ''
    return guiUpdateAction.manualOnly
      ? t('settings:guiUpdateAvailableManual', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
      : t('settings:guiUpdateAvailable', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
  }, [guiUpdateAction, t])

  const chooseEditor = (editor: EditorInfo): void => {
    setSelectedEditorId(editor.id)
    writePreferredEditorId(editor.id)
    setEditorMenuOpen(false)
  }

  const openWorkspaceInEditor = async (): Promise<void> => {
    const targetWorkspaceRoot = workspaceRoot.trim()
    if (!targetWorkspaceRoot || openingWorkspace) return

    setOpeningWorkspace(true)
    try {
      const result = await openWorkspacePathInEditor(
        { path: targetWorkspaceRoot },
        targetWorkspaceRoot
      )
      if (!result.ok) {
        await window.sciforge?.logError?.('editor-open', 'Failed to open workspace in editor', {
          message: result.message,
          workspaceRoot: targetWorkspaceRoot
        })?.catch(() => undefined)
      }
    } finally {
      setOpeningWorkspace(false)
    }
  }

  const toggleEditorMenu = (): void => {
    setEditorMenuOpen((open) => {
      const nextOpen = !open
      if (nextOpen) updateEditorMenuPosition()
      return nextOpen
    })
  }

  const markEditorIconFailed = (editorId: string): void => {
    setFailedIconIds((prev) => {
      if (prev.has(editorId)) return prev
      const next = new Set(prev)
      next.add(editorId)
      return next
    })
  }

  const renderEditorIcon = (editor: EditorInfo | null | undefined, className: string): ReactElement => {
    const Icon =
      editor?.kind === 'terminal' ? Terminal : editor?.kind === 'viewer' ? FolderOpen : Code2

    if (editor?.iconDataUrl && !failedIconIds.has(editor.id)) {
      return (
        <img
          src={editor.iconDataUrl}
          alt=""
          aria-hidden="true"
          className={`${className} shrink-0 rounded-[4px] object-contain`}
          onError={() => markEditorIconFailed(editor.id)}
        />
      )
    }

    return <Icon className={`${className} shrink-0`} strokeWidth={1.8} />
  }

  const runGuiUpdateAction = async (): Promise<void> => {
    if (!guiUpdateAction || guiUpdateBusy) return
    if (guiUpdateAction.manualOnly) {
      await openSafeExternalUrl(guiUpdateAction.releaseUrl)
      return
    }
    if (
      typeof window.sciforge?.downloadGuiUpdate !== 'function' ||
      typeof window.sciforge?.installGuiUpdate !== 'function'
    ) {
      return
    }

    setApplyingGuiUpdate(true)
    try {
      if (!guiUpdateAction.downloaded && guiUpdateState.status !== 'downloaded') {
        const downloadResult = await window.sciforge.downloadGuiUpdate(guiUpdateAction.channel)
        if (!downloadResult.ok) return
      }
      const installResult = await window.sciforge.installGuiUpdate()
      if (!installResult.ok && typeof window.sciforge?.logError === 'function') {
        await window.sciforge.logError('gui-update', 'Failed to install GUI update from workbench top bar', {
          version: guiUpdateAction.latestVersion,
          message: installResult.message
        })
      }
    } catch (error) {
      if (typeof window.sciforge?.logError === 'function') {
        await window.sciforge.logError('gui-update', 'Failed to apply GUI update from workbench top bar', {
          version: guiUpdateAction.latestVersion,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      setApplyingGuiUpdate(false)
    }
  }

  const renderGuiUpdateIcon = (): ReactElement => {
    if (guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing' || applyingGuiUpdate) {
      return <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
    }
    if (guiUpdateAction?.downloaded || guiUpdateState.status === 'downloaded') {
      return <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.85} />
    }
    if (guiUpdateAction?.manualOnly) {
      return <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.85} />
    }
    if (guiUpdateAction) {
      return <ArrowUpCircle className="h-3.5 w-3.5" strokeWidth={1.85} />
    }
    return <Download className="h-3.5 w-3.5" strokeWidth={1.85} />
  }

  const editorOpenTitle = workspaceRoot.trim()
    ? selectedEditor
      ? t('editorOpenWorkspaceTitleWithEditor', { editor: selectedEditor.label })
      : t('editorOpenWorkspaceTitle')
    : t('editorOpenWorkspaceUnavailable')

  const editorMenu =
    editorMenuOpen && editorMenuPosition ? (
      <div
        ref={editorMenuPanelRef}
        data-toolbar-popup
        role="menu"
        aria-label={t('editorPickerMenuTitle')}
        style={{
          left: editorMenuPosition.left,
          top: editorMenuPosition.top,
          width: editorMenuPosition.width
        }}
        className="ds-card-strong fixed z-[1001] max-h-[min(26rem,calc(100vh-3rem))] overflow-y-auto rounded-[18px] border border-ds-border py-1.5 shadow-[0_18px_52px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]"
      >
        <div className="border-b border-ds-border-muted px-3 pb-2 pt-1.5 text-[11px] font-semibold text-ds-faint">
          {t('editorPickerMenuTitle')}
        </div>
        {editors.map((editor) => {
          const active = editor.id === selectedEditor?.id
          return (
            <button
              key={editor.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => chooseEditor(editor)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] transition ${
                active
                  ? 'bg-ds-hover text-ds-ink'
                  : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
              }`}
            >
              {renderEditorIcon(editor, 'h-4 w-4')}
              <span className="min-w-0 flex-1 truncate">{editor.label}</span>
              {editor.supportsLine ? (
                <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  {t('editorLineBadge')}
                </span>
              ) : null}
              {active ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
            </button>
          )
        })}
      </div>
    ) : null

  const actions: ToolbarAction[] = [
    ...(guiUpdateAction ? [{
      id: 'gui-update', label: `${guiUpdateLabel}. ${guiUpdateTitle}`, icon: renderGuiUpdateIcon(),
      onClick: () => { void runGuiUpdateAction() }, disabled: guiUpdateBusy, attention: true
    }] : []),
    {
      id: 'open-editor', label: editorOpenTitle,
      icon: openingWorkspace ? <Loader2 className="h-4 w-4 animate-spin" /> : renderEditorIcon(selectedEditor, 'h-4 w-4'),
      onClick: () => { void openWorkspaceInEditor() }, disabled: !workspaceRoot.trim() || openingWorkspace
    },
    {
      id: 'choose-editor', label: t('editorPickerTitle'), icon: <ChevronDown className="h-3 w-3" />,
      onClick: (event) => { editorMenuButtonRef.current = event.currentTarget; toggleEditorMenu() },
      active: editorMenuOpen, keepOpen: true, popup: 'menu', expanded: editorMenuOpen
    },
    ...(onOpenChildAgents && (childAgentCount > 0 || childAgentAttentionCount > 0) ? [{
      id: 'children',
      label: childAgentAttentionCount > 0 ? t('sidebarChildrenNeedsAttention', { count: childAgentAttentionCount }) : t('sidebarChildren'),
      icon: <Bot className="h-4 w-4" strokeWidth={1.75} />,
      onClick: onOpenChildAgents, active: childAgentsOpen,
      attention: childAgentAttentionCount > 0 || childAgentRunningCount > 0,
      badge: <>
        {childAgentCount > 0 ? <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">{childAgentCount}</span> : null}
        {childAgentAttentionCount > 0 ? <CircleAlert className="absolute -bottom-2 -right-2 h-3 w-3 rounded-full bg-red-500 text-white" /> : null}
      </>
    }] : []),
    ...(onOpenSideChat && sideChatEnabled ? [{
      id: 'side-chat', label: t('sidePanelOpen'), icon: <MessageCircleMore className="h-4 w-4" strokeWidth={1.75} />,
      onClick: onOpenSideChat, active: sideChatOpen, attention: sideChatRunningCount > 0,
      badge: sideChatCount > 0 ? <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">{Math.min(sideChatCount, 9)}</span> : undefined
    }] : []),
    ...contributedItems.map((item) => ({
      id: item.id, label: item.label, icon: <item.icon className="h-4 w-4" strokeWidth={1.75} />,
      onClick: () => onExecuteToolbarCommand?.(item.commandId), disabled: !onExecuteToolbarCommand,
      active: item.active, attention: Boolean(item.attention)
    })),
    ...items.map((item) => ({
      id: item.mode, label: item.label, icon: <item.icon className="h-4 w-4" strokeWidth={1.75} />,
      onClick: () => onToggleFocusedRightPanelMode(item.mode), active: focusedRightPanelMode === item.mode
    }))
  ]

  return (
    <>
      <WorkbenchToolbarCustomizer
        actions={toolbarActions}
        preferences={toolbarPreferences}
        saving={toolbarSaveState === 'saving'}
        error={toolbarSaveError}
        onChange={(next) => { void saveToolbarPreferences(next) }}
        renderTrigger={(trigger) => <AdaptiveToolbar actions={actions} customization={trigger} />}
      />
      {typeof document === 'undefined' ? editorMenu : createPortal(editorMenu, document.body)}
    </>
  )
}
