import type { PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { AppRoute } from '../store/chat-store-types'
import {
  subscribeSessionRightPanelDisposals,
  subscribeSessionRightPanelRekeys
} from '../lib/session-right-panel-lifecycle'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import {
  normalizeProjectDagGraphNodeId,
  type WorkspaceFilePreviewReturnContext
} from '../lib/workspace-file-preview'
import type { RightPanelMode } from './chat/WorkbenchTopBar'
import {
  SESSION_RIGHT_PANEL_DEFAULT_WIDTH,
  createSessionRightPanelWorkspace,
  discardSessionRightPanelResource,
  ensureSessionRightPanelWorkspace,
  moveSessionRightPanelWorkspaceOwner,
  navigateSessionRightPanelHistory,
  sessionRightPanelWorkspaceList,
  toggleSessionRightPanelMode,
  updateSessionRightPanelWorkspace,
  type SessionRightPanelWorkspacePatch,
  type SessionRightPanelWorkspaceMap
} from './session-right-panel-workspaces'
import {
  forgetRightPanelContextStateForSession,
  moveRightPanelContextStateOwner
} from './right-panel-context-state'

const LEFT_PANEL_WIDTH_KEY = 'sciforge.layout.leftSidebarWidth'
const LEFT_PANEL_COLLAPSED_KEY = 'sciforge.layout.leftSidebarCollapsed'
const TERMINAL_HEIGHT_KEY = 'sciforge.layout.terminalHeight'
const LEFT_PANEL_DEFAULT = 304
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
  route
}: {
  activeThreadId: string | null
  latestAutoOpenDevPreviewUrl: string | null
  latestDevPreviewUrl: string | null
  route: AppRoute
}) {
  const activeSessionId = activeThreadId?.trim() || null
  const [rightPanelWorkspaceMap, setRightPanelWorkspaceMap] =
    useState<SessionRightPanelWorkspaceMap>({})
  const rightPanelWorkspaceMapRef = useRef(rightPanelWorkspaceMap)
  rightPanelWorkspaceMapRef.current = rightPanelWorkspaceMap
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredWidth(LEFT_PANEL_WIDTH_KEY, LEFT_PANEL_DEFAULT)
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  )
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(() =>
    readStoredWidth(TERMINAL_HEIGHT_KEY, TERMINAL_HEIGHT_DEFAULT)
  )
  const shellRef = useRef<HTMLDivElement | null>(null)
  const autoOpenedPreviewUrlBySessionRef = useRef(new Map<string, string>())
  const disposedSessionIdsRef = useRef(new Set<string>())
  const activeRightPanelWorkspace = activeSessionId
    ? rightPanelWorkspaceMap[activeSessionId] ?? createSessionRightPanelWorkspace(activeSessionId)
    : null
  const rightPanelMode = activeRightPanelWorkspace?.mode ?? null
  const filePreviewTarget = activeRightPanelWorkspace?.filePreviewTarget ?? null
  const filePreviewReturnContext = activeRightPanelWorkspace?.filePreviewReturnContext ?? null
  const rightSidebarWidth = activeRightPanelWorkspace?.width ?? SESSION_RIGHT_PANEL_DEFAULT_WIDTH
  const rightPanelVisible = rightPanelMode !== null
  const rightPanelWorkspaces = useMemo(
    () => sessionRightPanelWorkspaceList(rightPanelWorkspaceMap),
    [rightPanelWorkspaceMap]
  )

  useEffect(() => {
    if (!activeSessionId) return
    disposedSessionIdsRef.current.delete(activeSessionId)
    setRightPanelWorkspaceMap((current) => ensureSessionRightPanelWorkspace(current, activeSessionId))
  }, [activeSessionId])

  useEffect(() => subscribeSessionRightPanelDisposals((sessionId) => {
    disposedSessionIdsRef.current.add(sessionId)
    autoOpenedPreviewUrlBySessionRef.current.delete(sessionId)
    forgetRightPanelContextStateForSession(sessionId)
    setRightPanelWorkspaceMap((current) => {
      if (!current[sessionId]) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }), [])

  useEffect(() => subscribeSessionRightPanelRekeys((previousSessionId, nextSessionId) => {
    const targetWorkspaceExists = Boolean(rightPanelWorkspaceMapRef.current[nextSessionId])
    disposedSessionIdsRef.current.add(previousSessionId)
    disposedSessionIdsRef.current.delete(nextSessionId)
    const autoOpenedPreviewUrl = autoOpenedPreviewUrlBySessionRef.current.get(previousSessionId)
    autoOpenedPreviewUrlBySessionRef.current.delete(previousSessionId)
    if (autoOpenedPreviewUrl && !targetWorkspaceExists) {
      autoOpenedPreviewUrlBySessionRef.current.set(nextSessionId, autoOpenedPreviewUrl)
    }
    if (targetWorkspaceExists) {
      forgetRightPanelContextStateForSession(previousSessionId)
    } else {
      moveRightPanelContextStateOwner(previousSessionId, nextSessionId)
    }
    setRightPanelWorkspaceMap((current) =>
      moveSessionRightPanelWorkspaceOwner(current, previousSessionId, nextSessionId)
    )
  }), [])

  const updateRightPanelWorkspace = useCallback((
    sessionId: string,
    patch: SessionRightPanelWorkspacePatch,
    options?: { recordHistory?: boolean }
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      updateSessionRightPanelWorkspace(current, sessionId, patch, options)
    )
  }, [])

  const setRightPanelModeForSession = useCallback((sessionId: string, mode: RightPanelMode): void => {
    updateRightPanelWorkspace(sessionId, { mode })
  }, [updateRightPanelWorkspace])

  const setRightPanelMode = useCallback((value: SetStateAction<RightPanelMode>): void => {
    if (!activeSessionId || disposedSessionIdsRef.current.has(activeSessionId)) return
    setRightPanelWorkspaceMap((current) => {
      const ensured = ensureSessionRightPanelWorkspace(current, activeSessionId)
      const mode = typeof value === 'function' ? value(ensured[activeSessionId].mode) : value
      return updateSessionRightPanelWorkspace(ensured, activeSessionId, { mode })
    })
  }, [activeSessionId])

  const setFilePreviewTargetForSession = useCallback((
    sessionId: string,
    target: WorkspaceFileTarget | null
  ): void => {
    updateRightPanelWorkspace(sessionId, { filePreviewTarget: target })
  }, [updateRightPanelWorkspace])

  const setFilePreviewTarget = useCallback((target: WorkspaceFileTarget | null): void => {
    if (activeSessionId) setFilePreviewTargetForSession(activeSessionId, target)
  }, [activeSessionId, setFilePreviewTargetForSession])

  const setFilePreviewReturnContextForSession = useCallback((
    sessionId: string,
    context: WorkspaceFilePreviewReturnContext | null
  ): void => {
    updateRightPanelWorkspace(sessionId, { filePreviewReturnContext: context })
  }, [updateRightPanelWorkspace])

  const setFilePreviewReturnContext = useCallback((
    context: WorkspaceFilePreviewReturnContext | null
  ): void => {
    if (activeSessionId) setFilePreviewReturnContextForSession(activeSessionId, context)
  }, [activeSessionId, setFilePreviewReturnContextForSession])

  const setRightSidebarWidthForSession = useCallback((
    sessionId: string,
    value: number | ((current: number) => number)
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) => {
      const ensured = ensureSessionRightPanelWorkspace(current, sessionId)
      const width = ensured[sessionId]?.width ?? SESSION_RIGHT_PANEL_DEFAULT_WIDTH
      return updateSessionRightPanelWorkspace(ensured, sessionId, {
        width: typeof value === 'function' ? value(width) : value
      }, { recordHistory: false })
    })
  }, [])

  const setRightSidebarWidth = useCallback((
    value: number | ((current: number) => number)
  ): void => {
    if (activeSessionId) setRightSidebarWidthForSession(activeSessionId, value)
  }, [activeSessionId, setRightSidebarWidthForSession])

  useEffect(() => {
    persistWidth(LEFT_PANEL_WIDTH_KEY, leftSidebarWidth)
  }, [leftSidebarWidth])

  useEffect(() => {
    persistBoolean(LEFT_PANEL_COLLAPSED_KEY, leftSidebarCollapsed)
  }, [leftSidebarCollapsed])

  useEffect(() => {
    persistWidth(TERMINAL_HEIGHT_KEY, terminalHeight)
  }, [terminalHeight])

  useEffect(() => {
    if (!activeSessionId || !latestAutoOpenDevPreviewUrl || route !== 'chat') return
    if (autoOpenedPreviewUrlBySessionRef.current.get(activeSessionId) === latestAutoOpenDevPreviewUrl) return
    autoOpenedPreviewUrlBySessionRef.current.set(activeSessionId, latestAutoOpenDevPreviewUrl)
    setRightPanelModeForSession(activeSessionId, 'browser')
  }, [activeSessionId, latestAutoOpenDevPreviewUrl, route, setRightPanelModeForSession])

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
  }, [leftSidebarCollapsed, leftSidebarWidth, rightPanelVisible, rightSidebarWidth, setRightSidebarWidth])

  const toggleRightPanelMode = (nextMode: Exclude<RightPanelMode, null>): void => {
    if (!activeSessionId || disposedSessionIdsRef.current.has(activeSessionId)) return
    setRightPanelWorkspaceMap((current) => toggleSessionRightPanelMode(current, activeSessionId, nextMode))
  }

  const toggleLeftSidebar = (): void => {
    setLeftSidebarCollapsed((current) => !current)
  }

  const openDevPreview = (): void => {
    if (!activeSessionId || disposedSessionIdsRef.current.has(activeSessionId)) return
    if (latestDevPreviewUrl) autoOpenedPreviewUrlBySessionRef.current.set(activeSessionId, latestDevPreviewUrl)
    setRightPanelMode('browser')
  }

  const navigateRightPanelHistory = useCallback((offset: -1 | 1): void => {
    if (!activeSessionId || disposedSessionIdsRef.current.has(activeSessionId)) return
    setRightPanelWorkspaceMap((current) =>
      navigateSessionRightPanelHistory(current, activeSessionId, offset)
    )
  }, [activeSessionId])

  const discardRightPanelResourceForSession = useCallback((
    sessionId: string,
    mode: 'file' | 'visual-review',
    resourceId: string
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      discardSessionRightPanelResource(current, sessionId, mode, resourceId)
    )
  }, [])

  const discardRightPanelResource = useCallback((
    mode: 'file' | 'visual-review',
    resourceId: string
  ): void => {
    if (activeSessionId) discardRightPanelResourceForSession(activeSessionId, mode, resourceId)
  }, [activeSessionId, discardRightPanelResourceForSession])

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

  const activeHistory = activeRightPanelWorkspace?.history ?? { entries: [], index: -1 }

  return {
    beginLeftResize,
    beginRightResize,
    beginTerminalResize,
    discardRightPanelResource,
    discardRightPanelResourceForSession,
    filePreviewReturnContext,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    openDevPreview,
    canNavigateRightPanelBack: activeHistory.index > 0,
    canNavigateRightPanelForward:
      activeHistory.index >= 0 &&
      activeHistory.index < activeHistory.entries.length - 1,
    navigateRightPanelBack: () => navigateRightPanelHistory(-1),
    navigateRightPanelForward: () => navigateRightPanelHistory(1),
    rightPanelMode,
    rightPanelWorkspaces,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
    setFilePreviewTargetForSession,
    setFilePreviewReturnContext,
    setFilePreviewReturnContextForSession,
    setRightPanelMode,
    setRightPanelModeForSession,
    setRightSidebarWidth,
    setRightSidebarWidthForSession,
    shellRef,
    terminalHeight,
    terminalOpen,
    toggleLeftSidebar,
    toggleRightPanelMode,
    toggleTerminal,
    updateRightPanelWorkspace
  }
}
