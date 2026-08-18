import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  DomainRendererWorkbenchSurfaceActivation
} from '@sciforge/domain-sdk/renderer'
import {
  subscribeSessionRightPanelDisposals,
  subscribeSessionRightPanelRekeys
} from '../lib/session-right-panel-lifecycle'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import {
  SESSION_RIGHT_PANEL_MIN_WIDTH,
  addSessionRightPanelPane,
  closeSessionRightPanelPane,
  ensureSessionRightPanelWorkspace,
  focusSessionRightPanelPane,
  focusedSessionRightPanelPane,
  moveSessionRightPanelWorkspaceOwner,
  navigateSessionRightPanelPaneHistory,
  placeSessionRightPanelPane,
  rebindSessionRightPanelPane,
  sessionRightPanelPaneById,
  sessionRightPanelWorkspaceList,
  setSessionRightPanelPaneWidth,
  splitSessionRightPanelPane,
  updateSessionRightPanelPane,
  type SessionRightPanelPaneBinding,
  type SessionRightPanelPanePatch,
  type SessionRightPanelPlacement,
  type SessionRightPanelWorkspaceMap
} from './session-right-panel-workspaces'
import {
  forgetRightPanelContextStateForSession,
  moveRightPanelContextStateOwner
} from './right-panel-context-state'

const LEFT_PANEL_WIDTH_KEY = 'sciforge.layout.leftSidebarWidth'
const LEFT_PANEL_COLLAPSED_KEY = 'sciforge.layout.leftSidebarCollapsed'
const BOTTOM_PANEL_HEIGHT_KEY = 'sciforge.layout.bottomPanelHeight'
const LEFT_PANEL_DEFAULT = 304
export const CODE_PANEL_PREFERRED = 560
const LEFT_PANEL_MIN = 280
const LEFT_PANEL_MAX = 480
export const WORKBENCH_MAIN_SURFACE_MIN_WIDTH = 360
const SIDEBAR_HARD_MIN = 180
const PANEL_RESIZE_HANDLE_WIDTH = 7
const BOTTOM_PANEL_HEIGHT_DEFAULT = 360
const BOTTOM_PANEL_HEIGHT_MIN = 220
const BOTTOM_PANEL_HEIGHT_MAX = 760

type SessionBottomPanelState = Readonly<{
  contributionId: string
  activation?: DomainRendererWorkbenchSurfaceActivation
}>

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

export function normalizeRightPanelPaneWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.max(SESSION_RIGHT_PANEL_MIN_WIDTH, width)
    : SESSION_RIGHT_PANEL_MIN_WIDTH
}

export type RightPanelPaneResizeEdge = 'start' | 'end'

export function rightPanelPaneWidthFromPointerDelta(
  startWidth: number,
  deltaX: number,
  edge: RightPanelPaneResizeEdge
): number {
  return normalizeRightPanelPaneWidth(
    startWidth + (edge === 'start' ? -deltaX : deltaX)
  )
}

export function fitWorkbenchWidths(
  containerWidth: number,
  leftWidth: number,
  rightPaneWidths: readonly number[],
  panels: { leftPanelVisible: boolean }
): { left: number; rightDockViewport: number; rightDockContent: number } {
  const rightPanelVisible = rightPaneWidths.length > 0
  const rightDockContent = rightPaneWidths.reduce(
    (total, width) =>
      total + PANEL_RESIZE_HANDLE_WIDTH + normalizeRightPanelPaneWidth(width),
    0
  )
  const handleWidth = panels.leftPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0
  const normalizedContainerWidth = Number.isFinite(containerWidth)
    ? Math.max(0, containerWidth)
    : 0
  const usableWidth = Math.max(0, normalizedContainerWidth - handleWidth)
  const availableSides = Math.max(
    0,
    usableWidth - Math.min(WORKBENCH_MAIN_SURFACE_MIN_WIDTH, usableWidth)
  )

  if (!panels.leftPanelVisible) {
    return {
      left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
      rightDockViewport: Math.min(rightDockContent, availableSides),
      rightDockContent
    }
  }

  if (!rightPanelVisible) {
    const leftFloor = availableSides >= LEFT_PANEL_MIN
      ? LEFT_PANEL_MIN
      : Math.min(SIDEBAR_HARD_MIN, availableSides)
    const leftCeil = Math.min(LEFT_PANEL_MAX, availableSides)
    return {
      left: clampWidth(leftWidth, leftFloor, Math.max(leftFloor, leftCeil)),
      rightDockViewport: 0,
      rightDockContent
    }
  }

  const dockFloor = Math.min(SIDEBAR_HARD_MIN, rightDockContent, availableSides)
  const leftCapacity = Math.max(0, availableSides - dockFloor)
  const leftFloor = leftCapacity >= LEFT_PANEL_MIN
    ? LEFT_PANEL_MIN
    : Math.min(SIDEBAR_HARD_MIN, leftCapacity)
  const leftCeil = Math.min(LEFT_PANEL_MAX, leftCapacity)
  const nextLeft = clampWidth(leftWidth, leftFloor, Math.max(leftFloor, leftCeil))

  return {
    left: nextLeft,
    rightDockViewport: Math.min(
      rightDockContent,
      Math.max(0, availableSides - nextLeft)
    ),
    rightDockContent
  }
}

export function useWorkbenchLayout({
  activeSessionId
}: {
  activeSessionId: string | null
}) {
  const normalizedActiveSessionId = activeSessionId?.trim() || null
  const [rightPanelWorkspaceMap, setRightPanelWorkspaceMap] =
    useState<SessionRightPanelWorkspaceMap>({})
  const rightPanelWorkspaceMapRef = useRef(rightPanelWorkspaceMap)
  rightPanelWorkspaceMapRef.current = rightPanelWorkspaceMap
  const [preferredLeftSidebarWidth, setPreferredLeftSidebarWidth] = useState(() =>
    readStoredWidth(LEFT_PANEL_WIDTH_KEY, LEFT_PANEL_DEFAULT)
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  )
  const [bottomPanelBySession, setBottomPanelBySession] =
    useState<Record<string, SessionBottomPanelState>>({})
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() =>
    readStoredWidth(BOTTOM_PANEL_HEIGHT_KEY, BOTTOM_PANEL_HEIGHT_DEFAULT)
  )
  const [workbenchContainerWidth, setWorkbenchContainerWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth
  )
  const shellRef = useRef<HTMLDivElement | null>(null)
  const disposedSessionIdsRef = useRef(new Set<string>())
  const activeRightPanelWorkspace = normalizedActiveSessionId
    ? rightPanelWorkspaceMap[normalizedActiveSessionId] ?? null
    : null
  const focusedRightPanelPane = focusedSessionRightPanelPane(activeRightPanelWorkspace)
  const focusedRightPanelMode = focusedRightPanelPane?.mode ?? null
  const focusedFilePreviewTarget = focusedRightPanelPane?.filePreviewTarget ?? null
  const focusedFilePreviewReturnContext =
    focusedRightPanelPane?.filePreviewReturnContext ?? null
  const focusedRightPanelPaneWidth = focusedRightPanelPane?.width ?? null
  const rightPanelVisible = Boolean(activeRightPanelWorkspace?.panes.length)
  const rightPanelPaneWidths = useMemo(
    () => activeRightPanelWorkspace?.panes.map((pane) => pane.width) ?? [],
    [activeRightPanelWorkspace]
  )
  const horizontalLayout = useMemo(
    () => fitWorkbenchWidths(
      workbenchContainerWidth,
      preferredLeftSidebarWidth,
      rightPanelPaneWidths,
      { leftPanelVisible: !leftSidebarCollapsed }
    ),
    [
      leftSidebarCollapsed,
      preferredLeftSidebarWidth,
      rightPanelPaneWidths,
      workbenchContainerWidth
    ]
  )
  const leftSidebarWidth = horizontalLayout.left
  const rightPanelDockViewportWidth = horizontalLayout.rightDockViewport
  const rightPanelDockContentWidth = horizontalLayout.rightDockContent
  const activeBottomPanelState = normalizedActiveSessionId
    ? bottomPanelBySession[normalizedActiveSessionId]
    : undefined
  const bottomPanelContributionId = activeBottomPanelState?.contributionId ?? null
  const bottomPanelActivation = activeBottomPanelState?.activation
  const rightPanelWorkspaces = useMemo(
    () => sessionRightPanelWorkspaceList(rightPanelWorkspaceMap),
    [rightPanelWorkspaceMap]
  )

  useEffect(() => {
    if (!normalizedActiveSessionId) return
    disposedSessionIdsRef.current.delete(normalizedActiveSessionId)
    setRightPanelWorkspaceMap((current) => ensureSessionRightPanelWorkspace(current, normalizedActiveSessionId))
  }, [normalizedActiveSessionId])

  useEffect(() => subscribeSessionRightPanelDisposals((sessionId) => {
    disposedSessionIdsRef.current.add(sessionId)
    forgetRightPanelContextStateForSession(sessionId)
    setRightPanelWorkspaceMap((current) => {
      if (!current[sessionId]) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    setBottomPanelBySession((current) => {
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
    if (targetWorkspaceExists) {
      forgetRightPanelContextStateForSession(previousSessionId)
    } else {
      moveRightPanelContextStateOwner(previousSessionId, nextSessionId)
    }
    setRightPanelWorkspaceMap((current) =>
      moveSessionRightPanelWorkspaceOwner(current, previousSessionId, nextSessionId)
    )
    setBottomPanelBySession((current) => {
      const panel = current[previousSessionId]
      if (!panel || current[nextSessionId]) return current
      const next = { ...current, [nextSessionId]: panel }
      delete next[previousSessionId]
      return next
    })
  }), [])

  const updateRightPanelPaneForSession = useCallback((
    sessionId: string,
    paneId: string,
    patch: SessionRightPanelPanePatch,
    options?: { recordHistory?: boolean }
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      updateSessionRightPanelPane(current, sessionId, paneId, patch, options)
    )
  }, [])

  const addRightPanelPaneForSession = useCallback((
    sessionId: string,
    binding: SessionRightPanelPaneBinding,
    options?: {
      afterPaneId?: string | null
      focus?: boolean
      width?: number
    }
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      addSessionRightPanelPane(current, sessionId, binding, options)
    )
  }, [])

  const placeRightPanelPaneForSession = useCallback((
    sessionId: string,
    binding: SessionRightPanelPaneBinding,
    placement: SessionRightPanelPlacement = 'focused',
    options?: { recordHistory?: boolean; width?: number }
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      placeSessionRightPanelPane(current, sessionId, binding, placement, options)
    )
  }, [])

  const focusRightPanelPaneForSession = useCallback((
    sessionId: string,
    paneId: string
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      focusSessionRightPanelPane(current, sessionId, paneId)
    )
  }, [])

  const splitRightPanelPaneForSession = useCallback((
    sessionId: string,
    paneId: string
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      splitSessionRightPanelPane(current, sessionId, paneId)
    )
  }, [])

  const closeRightPanelPaneForSession = useCallback((
    sessionId: string,
    paneId: string
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      closeSessionRightPanelPane(current, sessionId, paneId)
    )
  }, [])

  const rebindRightPanelPaneForSession = useCallback((
    sessionId: string,
    paneId: string,
    binding: SessionRightPanelPaneBinding,
    options?: { recordHistory?: boolean }
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      rebindSessionRightPanelPane(current, sessionId, paneId, binding, options)
    )
  }, [])

  const navigateRightPanelPaneHistoryForSession = useCallback((
    sessionId: string,
    paneId: string,
    offset: -1 | 1
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) =>
      navigateSessionRightPanelPaneHistory(current, sessionId, paneId, offset)
    )
  }, [])

  const setRightPanelPaneWidthForSession = useCallback((
    sessionId: string,
    paneId: string,
    value: number | ((current: number) => number)
  ): void => {
    if (disposedSessionIdsRef.current.has(sessionId)) return
    setRightPanelWorkspaceMap((current) => {
      const pane = sessionRightPanelPaneById(current[sessionId], paneId)
      if (!pane) return current
      const nextWidth = typeof value === 'function' ? value(pane.width) : value
      return setSessionRightPanelPaneWidth(current, sessionId, paneId, nextWidth)
    })
  }, [])

  useEffect(() => {
    persistWidth(LEFT_PANEL_WIDTH_KEY, preferredLeftSidebarWidth)
  }, [preferredLeftSidebarWidth])

  useEffect(() => {
    persistBoolean(LEFT_PANEL_COLLAPSED_KEY, leftSidebarCollapsed)
  }, [leftSidebarCollapsed])

  useEffect(() => {
    persistWidth(BOTTOM_PANEL_HEIGHT_KEY, bottomPanelHeight)
  }, [bottomPanelHeight])

  useLayoutEffect(() => {
    const sync = (): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      setWorkbenchContainerWidth((current) =>
        current === containerWidth ? current : containerWidth
      )
    }
    sync()
    const observer = typeof ResizeObserver === 'undefined' || !shellRef.current
      ? null
      : new ResizeObserver(sync)
    if (shellRef.current) observer?.observe(shellRef.current)
    window.addEventListener('resize', sync)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  const toggleLeftSidebar = (): void => {
    setLeftSidebarCollapsed((current) => !current)
  }

  const beginLeftResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (leftSidebarCollapsed || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
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
        rightPanelPaneWidths,
        { leftPanelVisible: true }
      )
      setPreferredLeftSidebarWidth(next.left)
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

  const beginRightPanelPaneResize = useCallback((
    sessionId: string,
    paneId: string,
    event: ReactPointerEvent<HTMLDivElement>,
    edge: RightPanelPaneResizeEdge = 'start'
  ): void => {
    const pane = sessionRightPanelPaneById(
      rightPanelWorkspaceMapRef.current[sessionId],
      paneId
    )
    if (event.button !== 0 || !pane || disposedSessionIdsRef.current.has(sessionId)) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = pane.width
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
      const delta = moveEvent.clientX - startX
      setRightPanelPaneWidthForSession(
        sessionId,
        paneId,
        rightPanelPaneWidthFromPointerDelta(startWidth, delta, edge)
      )
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
  }, [setRightPanelPaneWidthForSession])

  const beginBottomPanelResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !bottomPanelContributionId) return
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const startHeight = bottomPanelHeight
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
      const maxHeight = Math.max(
        BOTTOM_PANEL_HEIGHT_MIN,
        Math.min(BOTTOM_PANEL_HEIGHT_MAX, containerHeight - 260)
      )
      const nextHeight = Math.min(
        Math.max(
          startHeight + startY - moveEvent.clientY,
          BOTTOM_PANEL_HEIGHT_MIN
        ),
        maxHeight
      )
      setBottomPanelHeight(nextHeight)
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

  const openBottomPanelForSession = useCallback((
    sessionId: string,
    contributionId: string,
    activation?: DomainRendererWorkbenchSurfaceActivation
  ): void => {
    const normalizedSessionId = sessionId.trim()
    const normalizedContributionId = contributionId.trim()
    if (!normalizedSessionId || !normalizedContributionId) return
    setBottomPanelBySession((current) => ({
      ...current,
      [normalizedSessionId]: {
        contributionId: normalizedContributionId,
        ...(activation ? { activation } : {})
      }
    }))
  }, [])

  const closeBottomPanel = useCallback((): void => {
    if (!normalizedActiveSessionId) return
    setBottomPanelBySession((current) => {
      if (!current[normalizedActiveSessionId]) return current
      const next = { ...current }
      delete next[normalizedActiveSessionId]
      return next
    })
  }, [normalizedActiveSessionId])

  const focusedHistory = focusedRightPanelPane?.history ?? { entries: [], index: -1 }

  return {
    activeRightPanelWorkspace,
    addRightPanelPaneForSession,
    beginLeftResize,
    beginRightPanelPaneResize,
    beginBottomPanelResize,
    bottomPanelActivation,
    bottomPanelContributionId,
    bottomPanelHeight,
    canNavigateFocusedRightPanelBack: focusedHistory.index > 0,
    canNavigateFocusedRightPanelForward:
      focusedHistory.index >= 0 &&
      focusedHistory.index < focusedHistory.entries.length - 1,
    closeBottomPanel,
    closeRightPanelPaneForSession,
    focusedFilePreviewReturnContext,
    focusedFilePreviewTarget,
    focusedRightPanelMode,
    focusedRightPanelPane,
    focusedRightPanelPaneWidth,
    focusRightPanelPaneForSession,
    leftSidebarCollapsed,
    leftSidebarWidth,
    navigateRightPanelPaneHistoryForSession,
    placeRightPanelPaneForSession,
    rebindRightPanelPaneForSession,
    rightPanelDockContentWidth,
    rightPanelDockViewportWidth,
    rightPanelWorkspaces,
    rightPanelVisible,
    setRightPanelPaneWidthForSession,
    shellRef,
    openBottomPanelForSession,
    splitRightPanelPaneForSession,
    toggleLeftSidebar,
    updateRightPanelPaneForSession
  }
}
