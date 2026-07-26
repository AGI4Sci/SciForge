import { Fragment, type ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  FileEdit,
  GitMerge,
  FolderOpen,
  Loader2,
  MessageCircleMore,
  Network,
  Palette,
  RefreshCw,
  RotateCcw,
  Terminal,
  Workflow
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readPreferredEditorId, writePreferredEditorId } from '../../lib/editor-preferences'
import { openSafeExternalUrl } from '../../lib/open-external'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { AnchoredCommentsTopBarActions } from '../anchored-comments'
import type {
  RegisteredWorkbenchRightPanelContribution
} from '../../domain-modules/workbench-right-panel-slot'

export const RIGHT_PANEL_MODES = [
  'todo',
  'changes',
  'evidence',
  'project-dag',
  'workflow',
  'file',
  'plan',
  'sdd-ai',
  'checkpoints',
  'visual-review',
  'child-agents'
] as const

export type CoreRightPanelMode = (typeof RIGHT_PANEL_MODES)[number]
export type ContributedRightPanelMode = string & {
  readonly __contributedRightPanelMode?: never
}
export type RightPanelMode = CoreRightPanelMode | ContributedRightPanelMode | null

type Props = {
  rightPanelMode: RightPanelMode
  onToggleRightPanelMode: (mode: Exclude<RightPanelMode, null>) => void
  workspaceRoot?: string
  planPanelEnabled?: boolean
  rightPanelContributions?: readonly RegisteredWorkbenchRightPanelContribution[]
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
  terminalOpen?: boolean
  onToggleTerminal?: () => void
}

export function WorkbenchTopBar({
  rightPanelMode,
  onToggleRightPanelMode,
  workspaceRoot = '',
  planPanelEnabled = false,
  rightPanelContributions = [],
  sideChatCount = 0,
  sideChatRunningCount = 0,
  sideChatOpen = false,
  sideChatEnabled = true,
  onOpenSideChat,
  childAgentCount = 0,
  childAgentRunningCount = 0,
  childAgentAttentionCount = 0,
  childAgentsOpen = false,
  onOpenChildAgents,
  terminalOpen = false,
  onToggleTerminal
}: Props): ReactElement {
  const { t } = useTranslation(['common', 'settings'])
  const [editors, setEditors] = useState<EditorInfo[]>([])
  const [selectedEditorId, setSelectedEditorId] = useState(() => readPreferredEditorId() ?? '')
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(() => new Set())
  const [guiUpdateState, setGuiUpdateState] = useState<GuiUpdateState>({ status: 'idle' })
  const [applyingGuiUpdate, setApplyingGuiUpdate] = useState(false)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const editorMenuRef = useRef<HTMLDivElement>(null)
  const editorMenuButtonRef = useRef<HTMLButtonElement>(null)
  const editorMenuPanelRef = useRef<HTMLDivElement>(null)
  const [editorMenuPosition, setEditorMenuPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const items = [
    ...rightPanelContributions
      .filter(({ contribution }) => contribution.isAvailable())
      .map(({ contribution }) => ({
        mode: contribution.mode,
        label: t(contribution.label),
        icon: contribution.icon
      })),
    ...(planPanelEnabled ? [{ mode: 'plan' as const, label: t('rightPanelPlan'), icon: ClipboardList }] : []),
    { mode: 'evidence' as const, label: t('rightPanelEvidenceDag'), icon: Network },
    { mode: 'project-dag' as const, label: t('rightPanelProjectDag'), icon: GitMerge },
    { mode: 'workflow' as const, label: t('workflow'), icon: Workflow },
    { mode: 'visual-review' as const, label: t('rightPanelVisualReview'), icon: Palette },
    { mode: 'file' as const, label: t('rightPanelFiles'), icon: FolderOpen },
    { mode: 'changes' as const, label: t('rightPanelChanges'), icon: FileEdit },
    { mode: 'checkpoints' as const, label: t('rightPanelCheckpoints'), icon: RotateCcw }
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
    const viewportWidth = window.innerWidth
    const menuWidth = Math.min(256, Math.max(160, viewportWidth - 16))
    const left = Math.min(Math.max(8, rect.right - menuWidth), Math.max(8, viewportWidth - menuWidth - 8))
    setEditorMenuPosition({ left, top: rect.bottom + 8, width: menuWidth })
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
      if (editorMenuRef.current?.contains(target) || editorMenuPanelRef.current?.contains(target)) return
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

  return (
    <div className="chat-workbench-topbar ds-no-drag -my-1 flex min-w-0 max-w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto px-0.5 py-1">
      {guiUpdateAction ? (
        <button
          type="button"
          onClick={() => void runGuiUpdateAction()}
          disabled={guiUpdateBusy}
          className="chat-gui-update-button inline-flex items-center gap-1.5 rounded-full border border-amber-300/75 bg-amber-50/92 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/70 dark:bg-amber-950/35 dark:text-amber-100 dark:hover:bg-amber-900/45"
          aria-label={guiUpdateTitle}
          title={guiUpdateTitle}
        >
          {renderGuiUpdateIcon()}
          <span className="chat-gui-update-label max-w-[11rem] truncate">{guiUpdateLabel}</span>
        </button>
      ) : null}

      <div
        ref={editorMenuRef}
        className="inline-flex overflow-hidden rounded-full border border-transparent bg-white/38 text-ds-faint opacity-90 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] dark:hover:bg-white/8"
      >
        <button
          type="button"
          onClick={() => void openWorkspaceInEditor()}
          disabled={!workspaceRoot.trim() || openingWorkspace}
          className="inline-flex items-center justify-center px-2 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={editorOpenTitle}
          title={editorOpenTitle}
        >
          {openingWorkspace ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" strokeWidth={2} />
          ) : (
            renderEditorIcon(selectedEditor, 'h-4 w-4')
          )}
        </button>
        <button
          ref={editorMenuButtonRef}
          type="button"
          onClick={toggleEditorMenu}
          className="inline-flex items-center justify-center border-l border-ds-border-muted/60 px-1.5 py-1.5 transition hover:bg-ds-hover/60"
          aria-label={t('editorPickerTitle')}
          aria-expanded={editorMenuOpen}
          aria-haspopup="menu"
          title={
            selectedEditor
              ? t('editorPickerTitleWithEditor', { editor: selectedEditor.label })
              : t('editorPickerTitle')
          }
        >
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.9} />
        </button>

        {typeof document === 'undefined' ? editorMenu : createPortal(editorMenu, document.body)}
      </div>

      {onOpenChildAgents && (childAgentCount > 0 || childAgentAttentionCount > 0) ? (
        <button
          type="button"
          onClick={onOpenChildAgents}
          className={`relative rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
            childAgentsOpen
              ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
              : 'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
          }`}
          aria-label={childAgentAttentionCount > 0
            ? t('sidebarChildrenNeedsAttention', { count: childAgentAttentionCount })
            : t('sidebarChildren')}
          aria-pressed={childAgentsOpen}
          title={childAgentAttentionCount > 0
            ? t('sidebarChildrenNeedsAttention', { count: childAgentAttentionCount })
            : t('sidebarChildren')}
        >
          <Bot className="h-4 w-4" strokeWidth={1.75} />
          {childAgentCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
              {Math.min(childAgentCount, 9)}
            </span>
          ) : null}
          {childAgentAttentionCount > 0 ? (
            <span className="absolute -bottom-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-white shadow-[0_0_0_2px_rgba(239,68,68,0.18)]">
              <CircleAlert className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
            </span>
          ) : childAgentRunningCount > 0 ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.18)]" />
          ) : null}
        </button>
      ) : null}

      {onOpenSideChat && sideChatEnabled ? (
        <button
          type="button"
          onClick={onOpenSideChat}
          className={`relative rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
            sideChatOpen
              ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
              : 'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
          }`}
          aria-label={t('sidePanelOpen')}
          aria-pressed={sideChatOpen}
          title={t('sidePanelOpen')}
        >
          <MessageCircleMore className="h-4 w-4" strokeWidth={1.75} />
          {sideChatCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
              {Math.min(sideChatCount, 9)}
            </span>
          ) : null}
          {sideChatRunningCount > 0 ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.18)]" />
          ) : null}
        </button>
      ) : null}

      {items.map((item) => {
        const active = rightPanelMode === item.mode
        const Icon = item.icon
        const isChanges = item.mode === 'changes'
        return (
          <Fragment key={item.mode}>
            <button
              type="button"
              onClick={() => onToggleRightPanelMode(item.mode)}
              className={`rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
                active
                  ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
                  : 'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
              }`}
              aria-label={item.label}
              aria-pressed={active}
              title={item.label}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </button>
            {isChanges ? (
              <>
                {onToggleTerminal ? (
                  <button
                    type="button"
                    onClick={onToggleTerminal}
                    className={`rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
                      terminalOpen
                        ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
                        : 'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
                    }`}
                    aria-label={t('rightPanelTerminal')}
                    aria-pressed={terminalOpen}
                    title={t('rightPanelTerminal')}
                  >
                    <Terminal className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                ) : null}
                <AnchoredCommentsTopBarActions />
              </>
            ) : null}
          </Fragment>
        )
      })}
    </div>
  )
}
