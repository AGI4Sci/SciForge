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
export const RIGHT_PANEL_SESSION_CONTEXT_KEY = 'sciforge.layout.rightPanelContext.v1'
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
const RIGHT_PANEL_CONTEXT_MAX_CHARS = 4_000

export type RightPanelSessionContext = {
  version: 1
  mode: Exclude<RightPanelMode, null>
  workspaceRoot?: string
  threadId?: string
  filePreviewTarget?: Pick<WorkspaceFileTarget, 'path' | 'workspaceRoot'>
  filePreviewReturnContext?: WorkspaceFilePreviewReturnContext
  visualDocumentId?: string
}

const THREAD_BOUND_PANEL_MODES = new Set<Exclude<RightPanelMode, null>>([
  'child-agents',
  'evidence'
])

function safeContextText(value: unknown, max = 1_024): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function isRestorableRightPanelMode(value: unknown): value is Exclude<RightPanelMode, null> {
  return value === 'changes' || value === 'browser' || value === 'checkpoints' ||
    value === 'evidence' || value === 'project-dag' || value === 'file' ||
    value === 'paper' || value === 'plan' || value === 'visual-review' ||
    value === 'child-agents'
}

function safeReturnContext(value: unknown): WorkspaceFilePreviewReturnContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (input.kind === 'evidence-dag') {
    const nodeId = safeContextText(input.nodeId, 512)
    const threadId = safeContextText(input.threadId)
    return nodeId && threadId ? { kind: 'evidence-dag', nodeId, threadId } : undefined
  }
  if (input.kind === 'project-dag') {
    const claimId = safeContextText(input.claimId, 512)
    const nodeId = normalizeProjectDagGraphNodeId(input.nodeId)
    return claimId || nodeId
      ? { kind: 'project-dag', ...(claimId ? { claimId } : {}), ...(nodeId ? { nodeId } : {}) }
      : undefined
  }
  return undefined
}

export function normalizeRightPanelSessionContext(value: unknown): RightPanelSessionContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.version !== 1 || !isRestorableRightPanelMode(input.mode)) return null
  const workspaceRoot = safeContextText(input.workspaceRoot)
  const threadId = THREAD_BOUND_PANEL_MODES.has(input.mode)
    ? safeContextText(input.threadId)
    : undefined
  const visualDocumentId = safeContextText(input.visualDocumentId)
  const targetInput = input.filePreviewTarget && typeof input.filePreviewTarget === 'object' &&
    !Array.isArray(input.filePreviewTarget)
    ? input.filePreviewTarget as Record<string, unknown>
    : null
  const targetPath = safeContextText(targetInput?.path, 2_048)
  const targetWorkspaceRoot = safeContextText(targetInput?.workspaceRoot)
  const filePreviewTarget = targetPath
    ? { path: targetPath, ...(targetWorkspaceRoot ? { workspaceRoot: targetWorkspaceRoot } : {}) }
    : undefined
  const filePreviewReturnContext = safeReturnContext(input.filePreviewReturnContext)
  if (input.mode === 'file' && !filePreviewTarget) return null
  if (input.mode === 'visual-review' && !visualDocumentId) return null
  if (THREAD_BOUND_PANEL_MODES.has(input.mode) && !threadId) return null
  return {
    version: 1,
    mode: input.mode,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(threadId ? { threadId } : {}),
    ...(filePreviewTarget ? { filePreviewTarget } : {}),
    ...(filePreviewReturnContext ? { filePreviewReturnContext } : {}),
    ...(visualDocumentId ? { visualDocumentId } : {})
  }
}

export function readStoredRightPanelContext(): RightPanelSessionContext | null {
  try {
    const raw = readBrowserStorageItem(RIGHT_PANEL_SESSION_CONTEXT_KEY)
    if (!raw || raw.length > RIGHT_PANEL_CONTEXT_MAX_CHARS) return null
    return normalizeRightPanelSessionContext(JSON.parse(raw))
  } catch {
    return null
  }
}

export function persistRightPanelContext(context: RightPanelSessionContext | null): void {
  const normalized = normalizeRightPanelSessionContext(context)
  if (!normalized) {
    removeBrowserStorageItem(RIGHT_PANEL_SESSION_CONTEXT_KEY)
    return
  }
  writeBrowserStorageItem(RIGHT_PANEL_SESSION_CONTEXT_KEY, JSON.stringify(normalized))
}

export function validateRestoredRightPanelContext(
  context: RightPanelSessionContext | null,
  current: { activeThreadId: string | null; workspaceRoot: string }
): RightPanelSessionContext | null {
  if (!context) return null
  const activeThreadId = current.activeThreadId?.trim() || ''
  const workspaceRoot = current.workspaceRoot.trim()
  if (context.threadId && context.threadId !== activeThreadId) return null
  if (context.workspaceRoot && workspaceRoot && context.workspaceRoot !== workspaceRoot) return null
  if (
    context.filePreviewTarget?.workspaceRoot && workspaceRoot &&
    context.filePreviewTarget.workspaceRoot !== workspaceRoot
  ) return null
  if (context.filePreviewReturnContext?.kind === 'evidence-dag' &&
    context.filePreviewReturnContext.threadId !== activeThreadId) return null
  return context
}

export type RightPanelHistoryEntry = {
  mode: Exclude<RightPanelMode, null>
  filePreviewTarget: WorkspaceFileTarget | null
  filePreviewReturnContext: WorkspaceFilePreviewReturnContext | null
  threadId?: string
  workspaceRoot?: string
  visualDocumentId?: string
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

export function pruneRightPanelHistory(
  history: RightPanelHistory,
  current: { activeThreadId: string | null; workspaceRoot: string }
): RightPanelHistory {
  const activeThreadId = current.activeThreadId?.trim() || ''
  const workspaceRoot = current.workspaceRoot.trim()
  const entries = history.entries.filter((entry) => {
    if (entry.threadId && entry.threadId !== activeThreadId) return false
    if (entry.workspaceRoot && workspaceRoot && entry.workspaceRoot !== workspaceRoot) return false
    if (entry.mode === 'file' && !entry.filePreviewTarget?.path.trim()) return false
    if (entry.mode === 'visual-review' && !entry.visualDocumentId?.trim()) return false
    return true
  })
  if (entries.length === history.entries.length) return history
  return { entries, index: Math.min(entries.length - 1, Math.max(-1, history.index)) }
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
  if (raw === 'sciforge-canvas') {
    writeBrowserStorageItem(RIGHT_PANEL_MODE_KEY, 'visual-review')
    return 'visual-review'
  }
  return raw === 'changes' || raw === 'browser' || raw === 'biology' || raw === 'checkpoints' || raw === 'evidence' || raw === 'project-dag' || raw === 'file' || raw === 'paper' || raw === 'plan' || raw === 'visual-review'
    ? raw
    : null
}

export function persistRightPanelMode(mode: RightPanelMode): void {
  if (mode === 'changes' || mode === 'browser' || mode === 'biology' || mode === 'checkpoints' || mode === 'evidence' || mode === 'project-dag' || mode === 'file' || mode === 'paper' || mode === 'plan' || mode === 'visual-review') {
    writeBrowserStorageItem(RIGHT_PANEL_MODE_KEY, mode)
  } else {
    removeBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  }
}

export function initialRightPanelMode(
  context: RightPanelSessionContext | null,
  legacyMode: RightPanelMode
): RightPanelMode {
  if (context) return context.mode
  // Legacy mode-only state cannot prove which thread/file/document it belongs
  // to. Restore only context-free panels and fail open for targeted surfaces.
  return legacyMode === 'file' || legacyMode === 'evidence' ||
    legacyMode === 'visual-review' || legacyMode === 'child-agents'
    ? null
    : legacyMode
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
  workspaceRoot,
  contextValidationReady = false,
  visualDocumentId = null
}: {
  activeThreadId: string | null
  latestAutoOpenDevPreviewUrl: string | null
  latestDevPreviewUrl: string | null
  route: AppRoute
  workspaceRoot: string
  contextValidationReady?: boolean
  visualDocumentId?: string | null
}) {
  const restoredContextRef = useRef<RightPanelSessionContext | null>(readStoredRightPanelContext())
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>(
    () => initialRightPanelMode(restoredContextRef.current, readStoredRightPanelMode())
  )
  const [filePreviewTarget, setFilePreviewTarget] = useState<WorkspaceFileTarget | null>(
    () => restoredContextRef.current?.filePreviewTarget ?? null
  )
  const [filePreviewReturnContext, setFilePreviewReturnContext] = useState<WorkspaceFilePreviewReturnContext | null>(
    () => restoredContextRef.current?.filePreviewReturnContext ?? null
  )
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
    if (!rightPanelMode) {
      persistRightPanelContext(null)
      return
    }
    persistRightPanelContext({
      version: 1,
      mode: rightPanelMode,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(THREAD_BOUND_PANEL_MODES.has(rightPanelMode) && activeThreadId
        ? { threadId: activeThreadId }
        : {}),
      ...(rightPanelMode === 'file' && filePreviewTarget ? {
        filePreviewTarget: {
          path: filePreviewTarget.path,
          ...(filePreviewTarget.workspaceRoot ? { workspaceRoot: filePreviewTarget.workspaceRoot } : {})
        },
        ...(filePreviewReturnContext ? { filePreviewReturnContext } : {})
      } : {}),
      ...(rightPanelMode === 'visual-review' && visualDocumentId ? { visualDocumentId } : {})
    })
  }, [activeThreadId, filePreviewReturnContext, filePreviewTarget, rightPanelMode, visualDocumentId, workspaceRoot])

  useEffect(() => {
    if (!contextValidationReady || !restoredContextRef.current) return
    const restored = validateRestoredRightPanelContext(restoredContextRef.current, {
      activeThreadId,
      workspaceRoot
    })
    restoredContextRef.current = null
    if (restored) return
    rightPanelHistoryRef.current = { entries: [], index: -1 }
    setFilePreviewTarget(null)
    setFilePreviewReturnContext(null)
    setRightPanelMode(null)
    persistRightPanelContext(null)
    setRightPanelHistoryRevision((revision) => revision + 1)
  }, [activeThreadId, contextValidationReady, workspaceRoot])

  useEffect(() => {
    if (!rightPanelMode) return
    const entry: RightPanelHistoryEntry = {
      mode: rightPanelMode,
      filePreviewTarget: rightPanelMode === 'file' ? filePreviewTarget : null,
      filePreviewReturnContext: rightPanelMode === 'file' ? filePreviewReturnContext : null,
      ...(THREAD_BOUND_PANEL_MODES.has(rightPanelMode) && activeThreadId
        ? { threadId: activeThreadId }
        : {}),
      ...((rightPanelMode === 'file' || rightPanelMode === 'visual-review') && workspaceRoot
        ? { workspaceRoot }
        : {}),
      ...(rightPanelMode === 'visual-review' && visualDocumentId ? { visualDocumentId } : {})
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
  }, [activeThreadId, filePreviewReturnContext, filePreviewTarget, rightPanelMode, visualDocumentId, workspaceRoot])

  useEffect(() => {
    const nextHistory = pruneRightPanelHistory(rightPanelHistoryRef.current, {
      activeThreadId,
      workspaceRoot
    })
    if (nextHistory === rightPanelHistoryRef.current) return
    rightPanelHistoryRef.current = nextHistory
    setRightPanelHistoryRevision((revision) => revision + 1)
  }, [activeThreadId, workspaceRoot])

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

  const discardRightPanelResource = useCallback((
    mode: 'file' | 'visual-review',
    resourceId: string
  ): void => {
    const normalizedResourceId = resourceId.trim()
    const entries = rightPanelHistoryRef.current.entries.filter((entry) => {
      if (entry.mode !== mode) return true
      return mode === 'file'
        ? entry.filePreviewTarget?.path.trim() !== normalizedResourceId
        : entry.visualDocumentId?.trim() !== normalizedResourceId
    })
    rightPanelHistoryRef.current = { entries, index: entries.length - 1 }
    if (mode === 'file' && filePreviewTarget?.path.trim() === normalizedResourceId) {
      setFilePreviewTarget(null)
      setFilePreviewReturnContext(null)
      setRightPanelMode((current) => current === 'file' ? null : current)
    }
    if (mode === 'visual-review' && visualDocumentId?.trim() === normalizedResourceId) {
      setRightPanelMode((current) => current === 'visual-review' ? null : current)
    }
    setRightPanelHistoryRevision((revision) => revision + 1)
  }, [filePreviewTarget?.path, visualDocumentId])

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
    discardRightPanelResource,
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
