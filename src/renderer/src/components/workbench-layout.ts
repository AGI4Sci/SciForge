import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { AppRoute } from '../store/chat-store-types'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import {
  normalizeProjectDagGraphNodeId,
  WORKSPACE_FILE_PREVIEW_EVENT,
  type WorkspaceFilePreviewDetail,
  type WorkspaceFilePreviewReturnContext
} from '../lib/workspace-file-preview'
import type { RightPanelMode } from './chat/WorkbenchTopBar'

const LEFT_PANEL_WIDTH_KEY = 'sciforge.layout.leftSidebarWidth'
const LEFT_PANEL_COLLAPSED_KEY = 'sciforge.layout.leftSidebarCollapsed'
const RIGHT_PANEL_WIDTH_KEY = 'sciforge.layout.rightInspectorWidth'
const RIGHT_PANEL_MODE_KEY = 'sciforge.layout.rightPanelMode'
const TERMINAL_HEIGHT_KEY = 'sciforge.layout.terminalHeight'
const LEFT_PANEL_DEFAULT = 304
const RIGHT_PANEL_DEFAULT = 360
export const CODE_PANEL_PREFERRED = 560
const LEFT_PANEL_MIN = 280
const LEFT_PANEL_MAX = 480
const RIGHT_PANEL_MIN = 300
const RIGHT_PANEL_MAX = Number.POSITIVE_INFINITY
const SIDEBAR_HARD_MIN = 180
const MAIN_MIN_WIDTH = 0
const PANEL_RESIZE_HANDLE_WIDTH = 7
const TERMINAL_HEIGHT_DEFAULT = 360
const TERMINAL_HEIGHT_MIN = 220
const TERMINAL_HEIGHT_MAX = 760
const RIGHT_PANEL_HISTORY_LIMIT = 50

export type RightPanelHistoryEntry = {
  mode: Exclude<RightPanelMode, null>
  filePreviewTarget: WorkspaceFileTarget | null
  filePreviewReturnContext: WorkspaceFilePreviewReturnContext | null
}

export type RightPanelHistory = {
  entries: RightPanelHistoryEntry[]
  index: number
}

export function rightPanelHistoryEntryKey(entry: RightPanelHistoryEntry): string {
  return JSON.stringify(entry)
}

export function pushRightPanelHistoryEntry(
  history: RightPanelHistory,
  entry: RightPanelHistoryEntry
): RightPanelHistory {
  if (rightPanelHistoryEntryKey(history.entries[history.index]) === rightPanelHistoryEntryKey(entry)) {
    return history
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry]
  const boundedEntries = entries.slice(-RIGHT_PANEL_HISTORY_LIMIT)
  return { entries: boundedEntries, index: boundedEntries.length - 1 }
}

export function moveRightPanelHistory(
  history: RightPanelHistory,
  offset: -1 | 1
): RightPanelHistory {
  if (history.entries.length === 0) return history
  const index = Math.min(history.entries.length - 1, Math.max(0, history.index + offset))
  return index === history.index ? history : { ...history, index }
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readStoredWidth(key: string, fallback: number): number {
  const raw = readBrowserStorageItem(key)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

function persistWidth(key: string, width: number): void {
  writeBrowserStorageItem(key, String(Math.round(width)))
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = readBrowserStorageItem(key)
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

function persistBoolean(key: string, value: boolean): void {
  writeBrowserStorageItem(key, value ? '1' : '0')
}

export function readStoredRightPanelMode(): RightPanelMode {
  const raw = readBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  return raw === 'changes' || raw === 'browser' || raw === 'checkpoints' || raw === 'evidence' || raw === 'project-dag' || raw === 'file' || raw === 'paper' || raw === 'plan' || raw === 'visual-review'
    ? raw
    : null
}

export function persistRightPanelMode(mode: RightPanelMode): void {
  if (mode === 'changes' || mode === 'browser' || mode === 'checkpoints' || mode === 'evidence' || mode === 'project-dag' || mode === 'file' || mode === 'paper' || mode === 'plan' || mode === 'visual-review') {
    writeBrowserStorageItem(RIGHT_PANEL_MODE_KEY, mode)
  } else {
    removeBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  }
}

export function shouldCloseRightPanelOnThreadChange(mode: RightPanelMode): boolean {
  void mode
  return false
}

export function projectDagReturnSelection(
  context: WorkspaceFilePreviewReturnContext | null
): { claimId?: string; nodeId?: string } | null {
  if (context?.kind !== 'project-dag') return null
  const claimId = context.claimId?.trim() || undefined
  const nodeId = normalizeProjectDagGraphNodeId(context.nodeId)
  return claimId || nodeId ? {
    ...(claimId ? { claimId } : {}),
    ...(nodeId ? { nodeId } : {})
  } : null
}

export function fitWorkbenchWidths(
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  panels: { leftPanelVisible: boolean; rightPanelVisible: boolean }
): { left: number; right: number } {
  const handleWidth =
    (panels.leftPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0) +
    (panels.rightPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0)
  const usableWidth = Math.max(0, containerWidth - handleWidth)

  if (!panels.leftPanelVisible) {
    if (!panels.rightPanelVisible) {
      return {
        left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
        right: clampWidth(rightWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)
      }
    }
    const safeContainer = Math.max(usableWidth, MAIN_MIN_WIDTH + SIDEBAR_HARD_MIN)
    const rightFloor =
      safeContainer - MAIN_MIN_WIDTH >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN
    const rightCeil = Math.min(
      RIGHT_PANEL_MAX,
      Math.max(rightFloor, safeContainer - MAIN_MIN_WIDTH)
    )
    return {
      left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
      right: clampWidth(rightWidth, rightFloor, rightCeil)
    }
  }

  const safeContainer = Math.max(
    usableWidth,
    MAIN_MIN_WIDTH + SIDEBAR_HARD_MIN + (panels.rightPanelVisible ? SIDEBAR_HARD_MIN : 0)
  )
  if (!panels.rightPanelVisible) {
    const leftFloor =
      safeContainer - MAIN_MIN_WIDTH >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
    const leftCeil = Math.min(
      LEFT_PANEL_MAX,
      Math.max(leftFloor, safeContainer - MAIN_MIN_WIDTH)
    )
    return {
      left: clampWidth(leftWidth, leftFloor, leftCeil),
      right: clampWidth(rightWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)
    }
  }

  const availableSides = Math.max(
    SIDEBAR_HARD_MIN * 2,
    safeContainer - MAIN_MIN_WIDTH
  )
  const leftFloor =
    availableSides - SIDEBAR_HARD_MIN >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
  const rightFloor =
    availableSides - SIDEBAR_HARD_MIN >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN

  let nextLeft = clampWidth(leftWidth, leftFloor, LEFT_PANEL_MAX)
  let nextRight = clampWidth(rightWidth, rightFloor, RIGHT_PANEL_MAX)

  if (nextLeft + nextRight > availableSides) {
    const overflow = nextLeft + nextRight - availableSides
    const rightShrink = Math.min(overflow, nextRight - rightFloor)
    nextRight -= rightShrink
    const remaining = overflow - rightShrink
    if (remaining > 0) {
      nextLeft = Math.max(leftFloor, nextLeft - remaining)
    }
  }

  const maxLeft = Math.min(LEFT_PANEL_MAX, availableSides - rightFloor)
  nextLeft = clampWidth(nextLeft, leftFloor, Math.max(leftFloor, maxLeft))
  const maxRight = Math.min(RIGHT_PANEL_MAX, availableSides - nextLeft)
  nextRight = clampWidth(nextRight, rightFloor, Math.max(rightFloor, maxRight))

  return { left: nextLeft, right: nextRight }
}

export function useWorkbenchLayout({
  activeThreadId,
  latestAutoOpenDevPreviewUrl,
  latestDevPreviewUrl,
  route,
  workspaceRoot
}: {
  activeThreadId: string | null
  latestAutoOpenDevPreviewUrl: string | null
  latestDevPreviewUrl: string | null
  route: AppRoute
  workspaceRoot: string
}) {
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>(readStoredRightPanelMode)
  const [filePreviewTarget, setFilePreviewTarget] = useState<WorkspaceFileTarget | null>(null)
  const [filePreviewReturnContext, setFilePreviewReturnContext] = useState<WorkspaceFilePreviewReturnContext | null>(null)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredWidth(LEFT_PANEL_WIDTH_KEY, LEFT_PANEL_DEFAULT)
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readStoredWidth(RIGHT_PANEL_WIDTH_KEY, RIGHT_PANEL_DEFAULT)
  )
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(() =>
    readStoredWidth(TERMINAL_HEIGHT_KEY, TERMINAL_HEIGHT_DEFAULT)
  )
  const shellRef = useRef<HTMLDivElement | null>(null)
  const previewThreadId = useRef<string | null>(activeThreadId)
  const autoOpenedPreviewUrlRef = useRef<string | null>(null)
  const rightPanelHistoryRef = useRef<RightPanelHistory>({ entries: [], index: -1 })
  const restoringRightPanelEntryKeyRef = useRef<string | null>(null)
  const [, setRightPanelHistoryRevision] = useState(0)
  const rightPanelVisible = rightPanelMode !== null

  useEffect(() => {
    persistWidth(LEFT_PANEL_WIDTH_KEY, leftSidebarWidth)
  }, [leftSidebarWidth])

  useEffect(() => {
    persistBoolean(LEFT_PANEL_COLLAPSED_KEY, leftSidebarCollapsed)
  }, [leftSidebarCollapsed])

  useEffect(() => {
    persistWidth(RIGHT_PANEL_WIDTH_KEY, rightSidebarWidth)
  }, [rightSidebarWidth])

  useEffect(() => {
    persistRightPanelMode(rightPanelMode)
  }, [rightPanelMode])

  useEffect(() => {
    if (!rightPanelMode) return
    const entry: RightPanelHistoryEntry = {
      mode: rightPanelMode,
      filePreviewTarget: rightPanelMode === 'file' ? filePreviewTarget : null,
      filePreviewReturnContext: rightPanelMode === 'file' ? filePreviewReturnContext : null
    }
    const entryKey = rightPanelHistoryEntryKey(entry)
    if (restoringRightPanelEntryKeyRef.current === entryKey) {
      restoringRightPanelEntryKeyRef.current = null
      return
    }
    const nextHistory = pushRightPanelHistoryEntry(rightPanelHistoryRef.current, entry)
    if (nextHistory === rightPanelHistoryRef.current) return
    rightPanelHistoryRef.current = nextHistory
    setRightPanelHistoryRevision((revision) => revision + 1)
  }, [filePreviewReturnContext, filePreviewTarget, rightPanelMode])

  useEffect(() => {
    persistWidth(TERMINAL_HEIGHT_KEY, terminalHeight)
  }, [terminalHeight])

  useEffect(() => {
    const onPreview = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
      if (!detail?.path) return
      if (detail.kind === 'directory') return
      setFilePreviewTarget({
        ...detail,
        workspaceRoot: detail.workspaceRoot ?? workspaceRoot
      })
      setFilePreviewReturnContext(detail.returnTo ?? null)
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
      setRightPanelMode('file')
    }

    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
  }, [workspaceRoot])

  useEffect(() => {
    if (previewThreadId.current === activeThreadId) return
    previewThreadId.current = activeThreadId
    autoOpenedPreviewUrlRef.current = null
    setFilePreviewReturnContext(null)
    if (shouldCloseRightPanelOnThreadChange(rightPanelMode)) setRightPanelMode(null)
  }, [activeThreadId, rightPanelMode])

  useEffect(() => {
    if (!latestAutoOpenDevPreviewUrl || route !== 'chat') return
    if (autoOpenedPreviewUrlRef.current === latestAutoOpenDevPreviewUrl) return
    autoOpenedPreviewUrlRef.current = latestAutoOpenDevPreviewUrl
    setRightPanelMode('browser')
  }, [latestAutoOpenDevPreviewUrl, route])

  useLayoutEffect(() => {
    const sync = (): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const next = fitWorkbenchWidths(
        containerWidth,
        leftSidebarWidth,
        rightSidebarWidth,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible
        }
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [leftSidebarCollapsed, leftSidebarWidth, rightPanelVisible, rightSidebarWidth])

  const toggleRightPanelMode = (nextMode: Exclude<RightPanelMode, null>): void => {
    setRightPanelMode((current) => (current === nextMode ? null : nextMode))
  }

  const toggleLeftSidebar = (): void => {
    setLeftSidebarCollapsed((current) => !current)
  }

  const openDevPreview = (): void => {
    if (latestDevPreviewUrl) {
      autoOpenedPreviewUrlRef.current = latestDevPreviewUrl
    }
    setRightPanelMode('browser')
  }

  const navigateRightPanelHistory = useCallback((offset: -1 | 1): void => {
    const nextHistory = moveRightPanelHistory(rightPanelHistoryRef.current, offset)
    if (nextHistory === rightPanelHistoryRef.current) return
    rightPanelHistoryRef.current = nextHistory
    const entry = nextHistory.entries[nextHistory.index]
    restoringRightPanelEntryKeyRef.current = rightPanelHistoryEntryKey(entry)
    setFilePreviewTarget(entry.filePreviewTarget)
    setFilePreviewReturnContext(entry.filePreviewReturnContext)
    setRightPanelMode(entry.mode)
    setRightPanelHistoryRevision((revision) => revision + 1)
  }, [])

  const beginLeftResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (leftSidebarCollapsed || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const target = event.currentTarget
    const pointerId = event.pointerId
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // Pointer capture can fail if the pointer was already released.
    }
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft + delta,
        startRight,
        {
          leftPanelVisible: true,
          rightPanelVisible
        }
      )
      setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
    }

    const onUp = (): void => {
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      } catch {
        // The browser may release capture before our cleanup runs.
      }
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const beginRightResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !rightPanelVisible) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const target = event.currentTarget
    const pointerId = event.pointerId
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // Pointer capture can fail if the pointer was already released.
    }
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft,
        startRight - delta,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible: true
        }
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      setRightSidebarWidth(next.right)
    }

    const onUp = (): void => {
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      } catch {
        // The browser may release capture before our cleanup runs.
      }
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const beginTerminalResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !terminalOpen) return
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const startHeight = terminalHeight
    const target = event.currentTarget
    const pointerId = event.pointerId
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // Pointer capture can fail if the pointer was already released.
    }
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerHeight = shellRef.current?.clientHeight ?? window.innerHeight
      const maxHeight = Math.max(TERMINAL_HEIGHT_MIN, Math.min(TERMINAL_HEIGHT_MAX, containerHeight - 260))
      const nextHeight = Math.min(Math.max(startHeight + startY - moveEvent.clientY, TERMINAL_HEIGHT_MIN), maxHeight)
      setTerminalHeight(nextHeight)
    }

    const onUp = (): void => {
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      } catch {
        // The browser may release capture before our cleanup runs.
      }
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const toggleTerminal = (): void => {
    setTerminalOpen((current) => !current)
  }

  return {
    beginLeftResize,
    beginRightResize,
    beginTerminalResize,
    filePreviewReturnContext,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    openDevPreview,
    canNavigateRightPanelBack: rightPanelHistoryRef.current.index > 0,
    canNavigateRightPanelForward:
      rightPanelHistoryRef.current.index >= 0 &&
      rightPanelHistoryRef.current.index < rightPanelHistoryRef.current.entries.length - 1,
    navigateRightPanelBack: () => navigateRightPanelHistory(-1),
    navigateRightPanelForward: () => navigateRightPanelHistory(1),
    rightPanelMode,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
    setFilePreviewReturnContext,
    setRightPanelMode,
    setRightSidebarWidth,
    shellRef,
    terminalHeight,
    terminalOpen,
    toggleLeftSidebar,
    toggleRightPanelMode,
    toggleTerminal
  }
}
