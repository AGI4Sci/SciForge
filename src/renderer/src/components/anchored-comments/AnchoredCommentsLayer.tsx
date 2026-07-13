import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus, MessagesSquare, X } from 'lucide-react'
import { CommentEditor } from './CommentEditor'
import { CommentPanel } from './CommentPanel'
import { ProductFeedbackDialog } from './ProductFeedbackDialog'
import {
  clampCommentLauncherPosition,
  readCommentLauncherPosition,
  writeCommentLauncherPosition,
  type CommentLauncherPoint
} from './comment-launcher-position'
import {
  ANCHORED_COMMENTS_DELETE_EVENT,
  ANCHORED_COMMENTS_STATUS_CHANGE_EVENT,
  ANCHORED_COMMENTS_SUBMIT_FEEDBACK_EVENT,
  type AnchoredCommentsSubmitFeedbackDetail,
  useAnchoredCommentStore
} from './anchored-comment-store'
import {
  captureAndPersistThread,
  deletePersistedThread,
  getAnchoredCommentView,
  listAnchoredCommentViews,
  persistThreadStatus,
  submitAnchoredCommentFeedback
} from './renderer-bridge'
import {
  elementBehindCommentCaptureLayer,
  inspectCommentTarget,
  inspectTextSelectionTarget,
  isCommentTargetDenied
} from './targeting'
import type { AnchoredCommentKind, CommentTargetInspection } from './types'

const COMMENT_PORTAL_HOST_ID = 'sciforge-comments-portal-root'
const COMMENT_LAUNCHER_DRAG_THRESHOLD = 4

function commentPortalHost(): HTMLElement {
  const existing = document.getElementById(COMMENT_PORTAL_HOST_ID)
  if (existing) {
    if (existing.parentElement !== document.body) document.body.appendChild(existing)
    return existing
  }
  const host = document.createElement('div')
  host.id = COMMENT_PORTAL_HOST_ID
  host.setAttribute('data-sciforge-comments-root', 'true')
  // Body is zoomed by the user's UI scale. The portal host applies the inverse
  // scale so viewport/client coordinates stay 1:1 while remaining in the
  // document body for keyboard and accessibility traversal.
  document.body.appendChild(host)
  return host
}

export function AnchoredCommentsLayer({
  route,
  workspaceKey = 'global'
}: {
  route: string
  workspaceKey?: string
}): ReactElement {
  const commentMode = useAnchoredCommentStore((state) => state.commentMode)
  const setCommentMode = useAnchoredCommentStore((state) => state.setCommentMode)
  const toggleCommentMode = useAnchoredCommentStore((state) => state.toggleCommentMode)
  const panelOpen = useAnchoredCommentStore((state) => state.panelOpen)
  const setPanelOpen = useAnchoredCommentStore((state) => state.setPanelOpen)
  const threads = useAnchoredCommentStore((state) => state.threads)
  const addThread = useAnchoredCommentStore((state) => state.addThread)
  const replaceThreads = useAnchoredCommentStore((state) => state.replaceThreads)
  const replaceThread = useAnchoredCommentStore((state) => state.replaceThread)
  const productFeedbackThreadId = useAnchoredCommentStore((state) => state.productFeedbackThreadId)
  const closeProductFeedback = useAnchoredCommentStore((state) => state.closeProductFeedback)
  const submitProductFeedback = useAnchoredCommentStore((state) => state.submitProductFeedback)
  const markFeedbackStatus = useAnchoredCommentStore((state) => state.markFeedbackStatus)
  const [hovered, setHovered] = useState<CommentTargetInspection | null>(null)
  const [editorTarget, setEditorTarget] = useState<CommentTargetInspection | null>(null)
  const [deniedMessage, setDeniedMessage] = useState<string | null>(null)
  const [captureClean, setCaptureClean] = useState(false)
  const captureLayerRef = useRef<HTMLDivElement | null>(null)
  const launcherRef = useRef<HTMLDivElement | null>(null)
  const [launcherPosition, setLauncherPosition] = useState<CommentLauncherPoint | null>(
    readCommentLauncherPosition
  )
  const launcherPositionRef = useRef<CommentLauncherPoint | null>(launcherPosition)
  const [launcherDragging, setLauncherDragging] = useState(false)
  const launcherDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: CommentLauncherPoint
    current: CommentLauncherPoint
    moved: boolean
  } | null>(null)
  const suppressLauncherClickRef = useRef(false)
  const suppressLauncherClickTimerRef = useRef<number | null>(null)

  const clampLauncherPosition = useCallback((point: CommentLauncherPoint): CommentLauncherPoint => {
    const launcher = launcherRef.current
    if (!launcher) return point
    const bounds = launcher.getBoundingClientRect()
    return clampCommentLauncherPosition(
      point,
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight }
    )
  }, [])

  const updateLauncherPosition = useCallback((point: CommentLauncherPoint): CommentLauncherPoint => {
    const next = clampLauncherPosition(point)
    launcherPositionRef.current = next
    setLauncherPosition(next)
    return next
  }, [clampLauncherPosition])

  useLayoutEffect(() => {
    const launcher = launcherRef.current
    if (!launcher) return
    const bounds = launcher.getBoundingClientRect()
    updateLauncherPosition(
      launcherPositionRef.current ?? { x: bounds.left, y: bounds.top }
    )
  }, [threads.length, updateLauncherPosition])

  useEffect(() => {
    const keepLauncherVisible = (): void => {
      const launcher = launcherRef.current
      if (!launcher) return
      const bounds = launcher.getBoundingClientRect()
      updateLauncherPosition(
        launcherPositionRef.current ?? { x: bounds.left, y: bounds.top }
      )
    }
    window.addEventListener('resize', keepLauncherVisible)
    return () => window.removeEventListener('resize', keepLauncherVisible)
  }, [updateLauncherPosition])

  useEffect(() => {
    return () => {
      if (suppressLauncherClickTimerRef.current !== null) {
        window.clearTimeout(suppressLauncherClickTimerRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!commentMode) return
    const root = document.documentElement
    root.setAttribute('data-sciforge-comment-mode', 'true')
    return () => root.removeAttribute('data-sciforge-comment-mode')
  }, [commentMode])

  useEffect(() => {
    let cancelled = false
    void listAnchoredCommentViews(workspaceKey).then((persisted) => {
      if (!cancelled && persisted) replaceThreads(persisted)
    }).catch(() => {
      // Local comments remain usable when persistence is unavailable.
    })
    return () => {
      cancelled = true
    }
  }, [replaceThreads, workspaceKey])

  useEffect(() => {
    const onStatusChange = (event: Event): void => {
      const detail = (event as CustomEvent<{
        threadId?: string
        status?: 'open' | 'attached' | 'ai_responded' | 'awaiting_verification' | 'resolved'
      }>).detail
      if (!detail?.threadId || !detail.status) return
      void persistThreadStatus(detail.threadId, detail.status)
    }
    const onDelete = (event: Event): void => {
      const threadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId
      if (threadId) void deletePersistedThread(threadId)
    }
    window.addEventListener(ANCHORED_COMMENTS_STATUS_CHANGE_EVENT, onStatusChange)
    window.addEventListener(ANCHORED_COMMENTS_DELETE_EVENT, onDelete)
    return () => {
      window.removeEventListener(ANCHORED_COMMENTS_STATUS_CHANGE_EVENT, onStatusChange)
      window.removeEventListener(ANCHORED_COMMENTS_DELETE_EVENT, onDelete)
    }
  }, [])

  useEffect(() => {
    const onSubmitFeedback = (event: Event): void => {
      const detail = (event as CustomEvent<AnchoredCommentsSubmitFeedbackDetail>).detail
      if (!detail?.threadId) return
      void submitAnchoredCommentFeedback(detail.threadId, detail.disclosure).then(async (result) => {
        if (!result.ok) {
          markFeedbackStatus(detail.threadId, 'failed', result.message)
          return
        }
        const persisted = await getAnchoredCommentView(detail.threadId)
        if (persisted) replaceThread(persisted)
        else markFeedbackStatus(detail.threadId, 'submitted')
        closeProductFeedback()
      }).catch((error) => {
        markFeedbackStatus(
          detail.threadId,
          'failed',
          error instanceof Error ? error.message : String(error)
        )
      })
    }
    window.addEventListener(ANCHORED_COMMENTS_SUBMIT_FEEDBACK_EVENT, onSubmitFeedback)
    return () => window.removeEventListener(ANCHORED_COMMENTS_SUBMIT_FEEDBACK_EVENT, onSubmitFeedback)
  }, [closeProductFeedback, markFeedbackStatus, replaceThread])

  useEffect(() => {
    if (!productFeedbackThreadId) return
    let cancelled = false
    void getAnchoredCommentView(productFeedbackThreadId).then((persisted) => {
      if (!cancelled && persisted) replaceThread(persisted)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [productFeedbackThreadId, replaceThread])

  useEffect(() => {
    if (!commentMode) {
      setHovered(null)
      setDeniedMessage(null)
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setCommentMode(false)
      setHovered(null)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [commentMode, setCommentMode])

  useEffect(() => {
    if (commentMode) return
    const onContextMenu = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      const target = inspectTextSelectionTarget(window.getSelection(), route, event.target)
      if (!target) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setEditorTarget(target)
      setHovered(null)
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [commentMode, route])

  const targetBehindCaptureLayer = (clientX: number, clientY: number): Element | null => {
    const captureLayer = captureLayerRef.current
    if (!captureLayer) return null
    return elementBehindCommentCaptureLayer(captureLayer, clientX, clientY)
  }

  const moveCommentCursor = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = targetBehindCaptureLayer(event.clientX, event.clientY)
    if (!element || isCommentTargetDenied(element)) {
      setHovered(null)
      return
    }
    setHovered(inspectCommentTarget(element, route, event.altKey ? 'exact' : 'semantic'))
  }

  const selectCommentTarget = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const element = targetBehindCaptureLayer(event.clientX, event.clientY)
    if (!element) return
    if (isCommentTargetDenied(element)) {
      setDeniedMessage('This sensitive element cannot be commented on or captured.')
      return
    }
    const target = inspectCommentTarget(element, route, event.altKey ? 'exact' : 'semantic')
    if (!target) return
    setEditorTarget(target)
    setHovered(null)
    setCommentMode(false)
  }

  const saveComment = (comment: string, kind: AnchoredCommentKind): void => {
    if (!editorTarget || !comment.trim()) return
    const thread = addThread({ target: editorTarget, comment, kind })
    setEditorTarget(null)
    setPanelOpen(false)
    setCaptureClean(true)
    window.requestAnimationFrame(() => {
      void captureAndPersistThread(thread, workspaceKey)
        .then((persisted) => {
          if (persisted) replaceThread(persisted)
        })
        .finally(() => {
          setCaptureClean(false)
          setPanelOpen(true)
        })
    })
  }

  const feedbackThread = productFeedbackThreadId
    ? threads.find((thread) => thread.id === productFeedbackThreadId) ?? null
    : null

  const preventWorkbenchClick = (event: ReactMouseEvent): void => {
    event.stopPropagation()
  }

  const startLauncherDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary || event.button !== 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const origin = { x: bounds.left, y: bounds.top }
    suppressLauncherClickRef.current = false
    if (suppressLauncherClickTimerRef.current !== null) {
      window.clearTimeout(suppressLauncherClickTimerRef.current)
      suppressLauncherClickTimerRef.current = null
    }
    launcherDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      current: origin,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveLauncher = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = launcherDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(deltaX, deltaY) < COMMENT_LAUNCHER_DRAG_THRESHOLD) return
    drag.moved = true
    setLauncherDragging(true)
    event.preventDefault()
    drag.current = updateLauncherPosition({
      x: drag.origin.x + deltaX,
      y: drag.origin.y + deltaY
    })
  }

  const finishLauncherDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = launcherDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    launcherDragRef.current = null
    setLauncherDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drag.moved) return
    writeCommentLauncherPosition(drag.current)
    suppressLauncherClickRef.current = true
    suppressLauncherClickTimerRef.current = window.setTimeout(() => {
      suppressLauncherClickRef.current = false
      suppressLauncherClickTimerRef.current = null
    }, 0)
  }

  const suppressClickAfterLauncherDrag = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!suppressLauncherClickRef.current) return
    suppressLauncherClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  if (captureClean) return <></>

  return createPortal(
    <>
      {commentMode ? (
        <div
          ref={captureLayerRef}
          data-sciforge-comments-ui
          className="ds-no-drag fixed inset-0 z-[990] cursor-crosshair"
          aria-label="Select an element to comment on"
          onPointerMove={moveCommentCursor}
          onPointerLeave={() => setHovered(null)}
          onClick={selectCommentTarget}
        />
      ) : null}

      {commentMode && hovered ? (
        <div
          data-sciforge-comments-ui
          className="pointer-events-none fixed z-[995] rounded-[5px] border-2 border-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.18),inset_0_0_0_1px_rgba(255,255,255,0.28)]"
          style={{
            left: hovered.bounds.x,
            top: hovered.bounds.y,
            width: hovered.bounds.width,
            height: hovered.bounds.height,
            backgroundColor: 'rgba(99, 102, 241, 0.20)'
          }}
        >
          <span className="absolute -top-7 left-0 max-w-80 truncate rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white shadow-lg">
            {hovered.label} · {hovered.bounds.width}×{hovered.bounds.height}
          </span>
        </div>
      ) : null}

      {commentMode ? (
        <div
          data-sciforge-comments-ui
          className="ds-no-drag fixed left-1/2 top-4 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full border border-indigo-300/60 bg-ds-card/95 py-1.5 pl-3 pr-1.5 text-ds-ink shadow-[0_12px_40px_rgba(30,41,59,0.22)] backdrop-blur-xl"
          onClick={preventWorkbenchClick}
        >
          <MessageSquarePlus className="h-3.5 w-3.5 text-indigo-500" />
          <span className="text-[11px] font-semibold">Select anything to comment</span>
          <span className="text-[9.5px] text-ds-muted">Alt for exact · Esc to cancel</span>
          <button
            type="button"
            className="rounded-full p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label="Exit comment mode"
            onClick={() => setCommentMode(false)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {deniedMessage ? (
        <div
          data-sciforge-comments-ui
          className="ds-no-drag fixed left-1/2 top-16 z-[1002] -translate-x-1/2 rounded-lg bg-red-700 px-3 py-2 text-[11px] font-medium text-white shadow-xl"
          role="alert"
        >
          {deniedMessage}
        </div>
      ) : null}

      {editorTarget ? (
        <CommentEditor
          target={editorTarget}
          onCancel={() => setEditorTarget(null)}
          onSave={saveComment}
        />
      ) : null}

      {panelOpen ? <CommentPanel /> : null}

      <div
        ref={launcherRef}
        data-sciforge-comments-ui
        className={`ds-no-drag fixed z-[1000] flex touch-none select-none items-center gap-2 ${
          launcherPosition ? '' : 'bottom-4 right-4'
        } ${launcherDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={launcherPosition ? { left: launcherPosition.x, top: launcherPosition.y } : undefined}
        onPointerDown={startLauncherDrag}
        onPointerMove={moveLauncher}
        onPointerUp={finishLauncherDrag}
        onPointerCancel={finishLauncherDrag}
        onClickCapture={suppressClickAfterLauncherDrag}
        onClick={preventWorkbenchClick}
      >
        <button
          type="button"
          className={`relative grid h-11 w-11 place-items-center rounded-full border text-white shadow-[0_14px_36px_rgba(30,41,59,0.28)] transition ${
            commentMode
              ? 'border-indigo-300 bg-indigo-600 hover:bg-indigo-500'
              : 'border-slate-700 bg-slate-900 hover:bg-slate-800 dark:border-slate-300 dark:bg-white dark:text-slate-950'
          }`}
          aria-label={commentMode ? 'Exit comment mode' : 'Comment on anything'}
          aria-pressed={commentMode}
          style={{ cursor: 'inherit' }}
          onClick={toggleCommentMode}
        >
          {commentMode ? <X className="h-5 w-5" /> : <MessageSquarePlus className="h-5 w-5" />}
        </button>
        {threads.length > 0 ? (
          <button
            type="button"
            className="relative grid h-11 w-11 place-items-center rounded-full border border-ds-border bg-ds-card text-ds-ink shadow-[0_14px_36px_rgba(30,41,59,0.22)] transition hover:bg-ds-hover"
            aria-label="Open comments"
            aria-expanded={panelOpen}
            style={{ cursor: 'inherit' }}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <MessagesSquare className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-indigo-600 px-1 text-center text-[9px] font-bold leading-5 text-white">
              {Math.min(threads.length, 99)}
            </span>
          </button>
        ) : null}
      </div>

      {feedbackThread ? (
        <ProductFeedbackDialog
          thread={feedbackThread}
          onClose={closeProductFeedback}
          onConfirm={(disclosure) => submitProductFeedback(feedbackThread.id, disclosure)}
        />
      ) : null}
    </>,
    commentPortalHost()
  )
}
