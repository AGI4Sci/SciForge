import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus, X } from 'lucide-react'
import { CommentEditor } from './CommentEditor'
import { CommentPanel } from './CommentPanel'
import { ProductFeedbackDialog } from './ProductFeedbackDialog'
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
