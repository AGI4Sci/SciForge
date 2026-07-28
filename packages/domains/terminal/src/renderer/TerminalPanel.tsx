import type { ReactElement, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  PanelRightClose,
  PanelsTopLeft,
  PencilLine,
  Plus,
  RotateCw,
  TerminalSquare,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '@xterm/xterm/css/xterm.css'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import {
  TERMINAL_DEFAULT_COLUMNS,
  TERMINAL_DEFAULT_ROWS,
  type TerminalCapabilityClient
} from './terminal-capability-client'
import { terminalSessionIdForWorkspace, terminalWorkspaceSessionKey } from './terminal-session'

type Props = {
  client: TerminalCapabilityClient
  className?: string
  workspaceRoot: string
  onCollapse: () => void
  height?: number
}

type TerminalTab = {
  id: string
  index: number
  title?: string
}

type TerminalTabContextMenuState = {
  tabId: string
  x: number
  y: number
}

type TerminalTabState = {
  tabs: TerminalTab[]
  activeTabId: string
}

const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
const TERMINAL_FONT_SIZE = 13
const TERMINAL_SCROLLBACK = 5000
const FIT_DEBOUNCE_MS = 80
const INITIAL_TAB_ID = 'main'
const MAX_RENDERER_TABS = 8

function initialTerminalTabState(): TerminalTabState {
  return {
    tabs: [{ id: INITIAL_TAB_ID, index: 1 }],
    activeTabId: INITIAL_TAB_ID
  }
}

function resolveThemeMode(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function resolveTerminalTheme() {
  if (resolveThemeMode() === 'light') {
    return {
      background: '#f8fafc',
      foreground: '#1f2937',
      cursor: '#2563eb',
      selectionBackground: '#bfdbfe',
      black: '#0f172a',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#e5e7eb',
      brightBlack: '#64748b',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#eab308',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#ffffff'
    }
  }
  return {
    background: '#151d31',
    foreground: '#dbeafe',
    cursor: '#93c5fd',
    selectionBackground: '#334155',
    black: '#020617',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e2e8f0',
    brightBlack: '#64748b',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#f8fafc'
  }
}

export function TerminalPanel({
  client,
  className = '',
  workspaceRoot,
  onCollapse,
  height
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const terminalBodyRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const aliveRef = useRef(true)
  const attachTokenRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState(false)
  const [tabs, setTabs] = useState<TerminalTab[]>(() => initialTerminalTabState().tabs)
  const [activeTabId, setActiveTabId] = useState(() => initialTerminalTabState().activeTabId)
  const [contextMenu, setContextMenu] = useState<TerminalTabContextMenuState | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [terminalBackground, setTerminalBackground] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const workspaceTabStatesRef = useRef<Record<string, TerminalTabState>>({})
  const workspaceKeyRef = useRef(terminalWorkspaceSessionKey(workspaceRoot))
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const workspaceKey = terminalWorkspaceSessionKey(workspaceRoot)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const getTabTitle = useCallback((tab: TerminalTab): string => {
    return tab.title?.trim() || t('terminalTabTitle', { index: tab.index })
  }, [t])

  useLayoutEffect(() => {
    const previousKey = workspaceKeyRef.current
    if (previousKey === workspaceKey) return
    workspaceTabStatesRef.current[previousKey] = {
      tabs: tabsRef.current,
      activeTabId: activeTabIdRef.current
    }
    const next = workspaceTabStatesRef.current[workspaceKey] ?? initialTerminalTabState()
    const nextActiveId = next.tabs.some((tab) => tab.id === next.activeTabId)
      ? next.activeTabId
      : (next.tabs[0]?.id ?? INITIAL_TAB_ID)
    workspaceKeyRef.current = workspaceKey
    setTabs(next.tabs.length > 0 ? next.tabs : initialTerminalTabState().tabs)
    setActiveTabId(nextActiveId)
    setContextMenu(null)
    setRenamingTabId(null)
    setRenameValue('')
  }, [workspaceKey])

  const disposeRenderer = useCallback(() => {
    const term = termRef.current
    const disposer = (term as (Terminal & { __dispose?: () => void }) | null)?.__dispose
    disposer?.()
    term?.dispose()
    termRef.current = null
    fitRef.current = null
    const container = containerRef.current
    if (container) container.replaceChildren()
  }, [])

  const sessionIdForTab = useCallback((tabId: string): string => {
    return terminalSessionIdForWorkspace(workspaceRoot, tabId)
  }, [workspaceRoot])

  const attachTerminal = useCallback(async (tabId: string) => {
    const sessionId = sessionIdForTab(tabId)
    const attachToken = ++attachTokenRef.current
    const isCurrentAttach = (): boolean => aliveRef.current && attachTokenRef.current === attachToken
    const container = containerRef.current
    if (!container || !isCurrentAttach()) return
    container.replaceChildren()
    setError(null)
    setExited(false)

    const cols = fitRef.current?.proposeDimensions()?.cols ?? TERMINAL_DEFAULT_COLUMNS
    const rows = fitRef.current?.proposeDimensions()?.rows ?? TERMINAL_DEFAULT_ROWS
    const theme = resolveTerminalTheme()
    setTerminalBackground(theme.background)

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      cursorBlink: true,
      scrollback: TERMINAL_SCROLLBACK,
      allowProposedApi: true,
      theme,
      cols,
      rows
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    termRef.current = term
    fitRef.current = fit

    requestAnimationFrame(() => {
      if (!isCurrentAttach()) return
      try {
        fit.fit()
      } catch {
        // Wait until the lazy-rendered container has a measurable size.
      }
    })

    const inputDisposable = term.onData((data) => {
      void client.write(sessionId, data).catch((cause) => {
        if (isCurrentAttach()) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    })

    let readerActive = true
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const triggerFit = (): void => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (!isCurrentAttach()) return
        try {
          fit.fit()
        } catch {
          // The terminal can briefly have zero size while Suspense/layout settles.
        }
      }, FIT_DEBOUNCE_MS)
    }
    const resizeObserver = new ResizeObserver(triggerFit)
    resizeObserver.observe(container)
    const resizeDisposable = term.onResize((dim) => {
      void client.resize(sessionId, dim.cols, dim.rows).catch(() => {
        // The first fit can happen before the controlled process has opened.
      })
    })
    ;(term as Terminal & { __dispose?: () => void }).__dispose = () => {
      readerActive = false
      inputDisposable.dispose()
      resizeDisposable.dispose()
      resizeObserver.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }

    try {
      const attachment = await client.open(sessionId, workspaceRoot, {
        columns: cols,
        rows
      })
      if (!isCurrentAttach()) return
      const dims = fit.proposeDimensions()
      if (dims) {
        await client.resize(sessionId, dims.cols, dims.rows)
      }
      setExited(false)
      let cursor = attachment.cursor
      void (async () => {
        while (readerActive && isCurrentAttach()) {
          const output = await client.read(sessionId, cursor)
          if (!readerActive || !isCurrentAttach()) return
          for (const chunk of output.chunks) term.write(chunk.data)
          client.commitCursor(sessionId, cursor, output.cursor)
          cursor = output.cursor
          if (output.exit) {
            setExited(true)
            return
          }
        }
      })().catch((cause) => {
        if (readerActive && isCurrentAttach()) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    } catch (e) {
      if (!isCurrentAttach()) return
      setError(e instanceof Error ? e.message : String(e))
    }

  }, [client, sessionIdForTab, workspaceRoot])

  useEffect(() => {
    aliveRef.current = true
    if (activeTab) void attachTerminal(activeTab.id)
    return () => {
      aliveRef.current = false
      attachTokenRef.current += 1
      disposeRenderer()
    }
  }, [activeTab, attachTerminal, disposeRenderer])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const term = termRef.current
      const theme = resolveTerminalTheme()
      setTerminalBackground(theme.background)
      if (term) term.options.theme = theme
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!renamingTabId) return
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }, [renamingTabId])

  const handleNewTab = useCallback(() => {
    if (tabs.length >= MAX_RENDERER_TABS) return
    const nextIndex = tabs.length + 1
    const tab: TerminalTab = {
      id: `tab-${Date.now().toString(36)}-${nextIndex}`,
      index: nextIndex
    }
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }, [tabs.length])

  const handleCloseTab = useCallback((tabId: string) => {
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId)
    if (closingIndex === -1) return
    void client.dispose(sessionIdForTab(tabId), 'Terminal tab closed.')
    setTabs((current) => {
      if (current.length <= 1) return current
      return current.filter((tab) => tab.id !== tabId)
    })
    if (activeTabId === tabId) {
      const nextTab = tabs[closingIndex + 1] ?? tabs[closingIndex - 1] ?? tabs[0]
      if (nextTab && nextTab.id !== tabId) setActiveTabId(nextTab.id)
    }
  }, [activeTabId, client, sessionIdForTab, tabs])

  const openTabContextMenu = useCallback((event: ReactMouseEvent | ReactPointerEvent, tabId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const tabButton = tabButtonRefs.current[tabId]
    const tabRect = tabButton?.getBoundingClientRect()
    const pointerX = event.clientX > 0 ? event.clientX : (tabRect?.left ?? 0)
    const pointerY = event.clientY > 0 ? event.clientY : (tabRect?.bottom ?? 0)
    setActiveTabId(tabId)
    setContextMenu({
      tabId,
      x: Math.min(Math.max(pointerX, 8), window.innerWidth - 220),
      y: Math.min(Math.max(pointerY, 8), window.innerHeight - 132)
    })
  }, [])

  const openActiveTabContextMenu = useCallback((event: ReactMouseEvent) => {
    if (!activeTab) return
    openTabContextMenu(event, activeTab.id)
  }, [activeTab, openTabContextMenu])

  const openTabContextMenuOnSecondaryPointer = useCallback((event: ReactPointerEvent, tabId: string) => {
    if (event.button !== 2) return
    openTabContextMenu(event, tabId)
  }, [openTabContextMenu])

  const openActiveTabContextMenuOnSecondaryPointer = useCallback((event: ReactPointerEvent) => {
    if (!activeTab || event.button !== 2) return
    openTabContextMenu(event, activeTab.id)
  }, [activeTab, openTabContextMenu])

  const startRenameTab = useCallback((tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab) return
    setContextMenu(null)
    setRenamingTabId(tabId)
    setRenameValue(getTabTitle(tab))
  }, [getTabTitle, tabs])

  const commitRenameTab = useCallback(() => {
    if (!renamingTabId) return
    const nextTitle = renameValue.trim()
    setTabs((current) =>
      current.map((tab) => (tab.id === renamingTabId ? { ...tab, title: nextTitle || undefined } : tab))
    )
    setRenamingTabId(null)
    setRenameValue('')
  }, [renameValue, renamingTabId])

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null)
    setRenameValue('')
  }, [])

  const handleCloseOtherTabs = useCallback((tabId: string) => {
    const keptTab = tabs.find((tab) => tab.id === tabId)
    if (!keptTab) return
    for (const tab of tabs) {
      if (tab.id !== tabId) {
        void client.dispose(sessionIdForTab(tab.id), 'Other terminal tabs closed.')
      }
    }
    setTabs([keptTab])
    setActiveTabId(tabId)
    setContextMenu(null)
    if (renamingTabId && renamingTabId !== tabId) cancelRenameTab()
  }, [cancelRenameTab, client, renamingTabId, sessionIdForTab, tabs])

  const handleCloseAllTabs = useCallback(() => {
    for (const tab of tabs) {
      void client.dispose(sessionIdForTab(tab.id), 'All terminal tabs closed.')
    }
    setContextMenu(null)
    cancelRenameTab()
    const next = initialTerminalTabState()
    setTabs(next.tabs)
    setActiveTabId(next.activeTabId)
    onCollapse()
  }, [cancelRenameTab, client, onCollapse, sessionIdForTab, tabs])

  const handleRestart = useCallback(async () => {
    if (!activeTab) return
    try {
      await client.dispose(sessionIdForTab(activeTab.id), 'Terminal restarted.')
    } catch {
      // Ignore stale session disposal failures and try to spawn a fresh PTY.
    }
    setError(null)
    setExited(false)
    disposeRenderer()
    aliveRef.current = true
    void attachTerminal(activeTab.id)
  }, [activeTab, attachTerminal, client, disposeRenderer, sessionIdForTab])

  return (
    <aside
      className={`ds-no-drag ds-surface-strong flex min-h-0 flex-col overflow-hidden border-t border-ds-border-muted text-ds-ink shadow-[0_-18px_60px_rgba(20,47,95,0.08)] dark:bg-[rgba(21,29,49,0.98)] dark:shadow-[0_-24px_70px_rgba(2,6,16,0.2)] ${className}`}
      style={height ? { height } : undefined}
    >
      <div className="flex h-11 shrink-0 items-center border-b border-ds-border-muted bg-ds-card/92 text-ds-ink backdrop-blur-xl dark:bg-[rgba(24,33,54,0.92)]">
        <div
          className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-3 pt-2"
          role="tablist"
          aria-label={t('terminalPanelTitle')}
          onPointerDownCapture={openActiveTabContextMenuOnSecondaryPointer}
          onContextMenu={openActiveTabContextMenu}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={`group flex h-8 max-w-[220px] shrink-0 items-center rounded-t-[10px] text-[13px] font-medium transition ${
                  active
                    ? 'ds-surface-strong border border-b-transparent border-ds-border-muted text-ds-ink shadow-sm dark:bg-[rgba(38,49,76,0.96)]'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
                onContextMenu={(event) => openTabContextMenu(event, tab.id)}
              >
                {renamingTabId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={commitRenameTab}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitRenameTab()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRenameTab()
                      }
                    }}
                    className="mx-2 min-w-0 flex-1 rounded-md border border-ds-border-muted bg-ds-card px-2 py-1 text-[12px] text-ds-ink outline-none focus:border-ds-accent"
                    aria-label={t('terminalRenameTab')}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    ref={(node) => {
                      tabButtonRefs.current[tab.id] = node
                    }}
                    aria-selected={active}
                    onClick={() => setActiveTabId(tab.id)}
                    onPointerDownCapture={(event) => openTabContextMenuOnSecondaryPointer(event, tab.id)}
                    onContextMenu={(event) => openTabContextMenu(event, tab.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                  >
                    <TerminalSquare className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">{getTabTitle(tab)}</span>
                  </button>
                )}
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t('terminalCloseTab')}
                    title={t('terminalCloseTab')}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleCloseTab(tab.id)
                    }}
                    className="mr-2 rounded-full p-0.5 text-ds-faint opacity-0 transition hover:bg-ds-hover hover:text-ds-ink group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            )
          })}
          <button
            type="button"
            onClick={handleNewTab}
            disabled={tabs.length >= MAX_RENDERER_TABS}
            className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('terminalNewTab')}
            title={t('terminalNewTab')}
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1 px-3">
          <button
            type="button"
            onClick={() => void handleRestart()}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('terminalRestart')}
            title={t('terminalRestart')}
          >
            <RotateCw className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <X className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
        {contextMenu ? (
          createPortal(
            <TerminalTabContextMenu
              state={contextMenu}
              tabCount={tabs.length}
              onRename={() => startRenameTab(contextMenu.tabId)}
              onCloseOthers={() => handleCloseOtherTabs(contextMenu.tabId)}
              onCloseAll={handleCloseAllTabs}
              t={t}
            />,
            document.body
          )
        ) : null}
      </div>

      <div
        ref={terminalBodyRef}
        className="ds-surface-strong relative min-h-0 flex-1 overflow-hidden px-5 py-4 dark:bg-[rgba(21,29,49,0.98)]"
        style={terminalBackground ? { backgroundColor: terminalBackground } : undefined}
      >
        <div ref={containerRef} className="h-full w-full" key={activeTab?.id} />
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div>
              <div className="text-[13px] font-semibold text-red-400">{t('terminalUnavailable')}</div>
              <div className="mt-2 max-w-sm text-[12px] leading-5 text-zinc-400">{error}</div>
              <button
                type="button"
                onClick={() => void handleRestart()}
                className="mt-4 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-white/20"
              >
                {t('terminalRestart')}
              </button>
            </div>
          </div>
        ) : null}
        {exited && !error ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={() => void handleRestart()}
              className="pointer-events-auto rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white shadow-lg backdrop-blur transition hover:bg-white/20"
            >
              {t('terminalExitMessage')}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function TerminalTabContextMenu({
  state,
  tabCount,
  onRename,
  onCloseOthers,
  onCloseAll,
  t
}: {
  state: TerminalTabContextMenuState
  tabCount: number
  onRename: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <div
      role="menu"
      aria-label={t('terminalTabMenuTitle')}
      className="ds-no-drag fixed z-[1000] min-w-[196px] rounded-lg border border-ds-border bg-ds-card/98 p-1 text-[13px] text-ds-ink shadow-[0_18px_48px_rgba(2,6,16,0.28)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <TerminalTabContextMenuItem
        icon={<PencilLine className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('terminalRenameTab')}
        onClick={onRename}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <TerminalTabContextMenuItem
        icon={<PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('terminalCloseOtherTabs')}
        disabled={tabCount <= 1}
        onClick={onCloseOthers}
      />
      <TerminalTabContextMenuItem
        icon={<PanelsTopLeft className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('terminalCloseAllTabs')}
        danger
        onClick={onCloseAll}
      />
    </div>
  )
}

function TerminalTabContextMenuItem({
  icon,
  label,
  disabled = false,
  danger = false,
  onClick
}: {
  icon: ReactElement
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-300'
          : 'text-ds-ink hover:bg-[var(--ds-sidebar-row-hover)]'
      }`}
    >
      <span className="shrink-0 text-current">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
