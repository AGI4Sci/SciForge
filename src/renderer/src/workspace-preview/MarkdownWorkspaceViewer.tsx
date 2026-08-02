import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ClipboardCopy,
  Columns2,
  Eye,
  HelpCircle,
  Highlighter,
  Languages,
  LoaderCircle,
  MessageSquare,
  PencilLine,
  Search,
  TriangleAlert
} from 'lucide-react'
import type { MarkdownWechatCopyResult } from '@shared/markdown-wechat'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import {
  WriteMarkdownPreview,
  type WriteMarkdownWorkspaceImageLoader,
  type WriteMarkdownWorkspaceLinkOpener
} from '../components/write/WriteMarkdownPreview'
import {
  createTextReplaceAllOperation,
  TextWorkspaceViewer,
  type TextWorkspaceViewerApplyEditHandler
} from './TextWorkspaceViewer'
import { CopyTextButton } from '../components/CopyTextButton'
import {
  documentTextAnchorFromDomRange,
  findDocumentTextSearchMatches,
  isNewDocumentNavigationRequest,
  resolveDocumentTextOverlayRects,
  resolveDomDocumentTextAnchor,
  resolveDomDocumentTextSearchMatches,
  type DocumentTextAnchor,
  type DocumentTextOverlayRect,
  type ResolvedDocumentTextOverlay
} from './dom-text-annotations'
import type {
  DocumentAnnotationAction,
  DocumentAnnotationSelection,
  DocumentNavigationRequest,
  DocumentTextAnnotationOverlay
} from './document-annotation-types'

const EMPTY_MARKDOWN_ANNOTATION_OVERLAYS: readonly DocumentTextAnnotationOverlay[] = []

export type MarkdownWorkspaceViewerApplyEditHandler = (
  operation: Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }>
) => void | Promise<void>

export type MarkdownWorkspaceViewerCopyForWechatHandler =
  () => Promise<MarkdownWechatCopyResult>

export type MarkdownWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  documentContentKey?: string
  className?: string
  onApplyEdit?: MarkdownWorkspaceViewerApplyEditHandler
  onCopyForWechat?: MarkdownWorkspaceViewerCopyForWechatHandler
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
  onOpenWorkspaceLink?: WriteMarkdownWorkspaceLinkOpener
  initialMode?: MarkdownWorkspaceViewerMode
  annotationOverlays?: readonly DocumentTextAnnotationOverlay[]
  activeAnnotationId?: string | null
  onAnnotationAction?: (
    action: DocumentAnnotationAction,
    selection: DocumentAnnotationSelection
  ) => void
  onAnnotationSelect?: (threadId: string) => void
  onOpenAnnotations?: () => void
  navigationRequest?: DocumentNavigationRequest | null
}

export type MarkdownWorkspaceViewerMode = 'edit' | 'preview' | 'split'

export type MarkdownWorkspaceViewerModel = {
  status: 'ready' | 'empty' | 'unsupported'
  title: string
  subtitle?: string
  markdown: string
  truncated: boolean
  editable: boolean
  summary: string
}

type MarkdownSelectionState = {
  selection: DocumentAnnotationSelection
  toolbarStyle: CSSProperties
}

type MarkdownSearchOverlay = {
  index: number
  rects: DocumentTextOverlayRect[]
}

type MarkdownScrollSyncOrigin = 'editor' | 'preview' | 'search'

export type MarkdownWechatCopyState =
  | { kind: 'idle' }
  | { kind: 'copying' }
  | { kind: 'success'; result: MarkdownWechatCopyResult }
  | { kind: 'error'; message: string }

export type MarkdownWechatCopyFeedbackModel = {
  phase: 'idle' | 'copying' | 'success' | 'warning' | 'error'
  warningCount: number
}

export function buildMarkdownWechatCopyFeedbackModel(
  state: MarkdownWechatCopyState
): MarkdownWechatCopyFeedbackModel {
  if (state.kind === 'success') {
    const warningCount = state.result.warnings.length
    return {
      phase: warningCount > 0 ? 'warning' : 'success',
      warningCount
    }
  }
  return {
    phase: state.kind,
    warningCount: 0
  }
}

export function buildMarkdownWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined,
  hasApplyEditHandler = false
): MarkdownWorkspaceViewerModel {
  if (!observation) {
    return {
      status: 'empty',
      title: 'Markdown viewer',
      markdown: '',
      truncated: false,
      editable: false,
      summary: 'Open a Markdown workspace preview to populate this viewer.'
    }
  }

  if (!isMarkdownObservation(observation)) {
    return {
      status: 'unsupported',
      title: displayFilePath(observation.file.path, observation.file.workspaceRoot),
      subtitle: compactStrings([observation.view.pluginId, formatLabel(observation.view.mode)]).join(' | '),
      markdown: '',
      truncated: false,
      editable: false,
      summary: `${formatLabel(observation.view.modality)} observations cannot be rendered by the Markdown viewer.`
    }
  }

  const markdown = observation.visibleText ?? ''
  const truncated = Boolean(observation.text?.truncated)
  const canApplyEdit = observation.actions.includes('text.replaceRange') ||
    observation.actions.includes('applyEdit') ||
    observation.actions.includes('save')
  const editable = hasApplyEditHandler && canApplyEdit && !truncated
  const characterCount = observation.text?.characterCount ?? markdown.length
  const lineCount = observation.text?.lineCount ?? countTextLines(markdown)

  return {
    status: 'ready',
    title: displayFilePath(observation.file.path, observation.file.workspaceRoot),
    markdown,
    truncated,
    editable,
    summary: [
      `${formatCount(lineCount, 'line')}`,
      `${formatCount(characterCount, 'character')}`,
      truncated ? 'truncated' : 'complete',
      editable ? 'editable' : 'read-only'
    ].join(', ')
  }
}

export function MarkdownWorkspaceViewer({
  observation,
  documentContentKey,
  className,
  onApplyEdit,
  onCopyForWechat,
  loadWorkspaceImage,
  onOpenWorkspaceLink,
  initialMode,
  annotationOverlays = EMPTY_MARKDOWN_ANNOTATION_OVERLAYS,
  activeAnnotationId = null,
  onAnnotationAction,
  onAnnotationSelect,
  onOpenAnnotations,
  navigationRequest = null
}: MarkdownWorkspaceViewerProps): ReactElement {
  const { t } = useTranslation('common')
  const model = buildMarkdownWorkspaceViewerModel(observation, Boolean(onApplyEdit))
  const applyTextEdit: TextWorkspaceViewerApplyEditHandler = async (operation) => {
    await onApplyEdit?.(operation)
  }
  const resolvedInitialMode = initialMode ?? (
    observation?.selection?.kind === 'text' ? 'edit' : 'preview'
  )
  const [mode, setMode] = useState<MarkdownWorkspaceViewerMode>(resolvedInitialMode)
  const viewerRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const previewScrollerRef = useRef<HTMLDivElement | null>(null)
  const previewTextRootRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const handledNavigationRequestIdRef = useRef<string | null>(null)
  const copyRequestRef = useRef(0)
  const copyInFlightRef = useRef(false)
  const scrollSyncOriginRef = useRef<MarkdownScrollSyncOrigin | null>(null)
  const scrollSyncResetFrameRef = useRef<number | null>(null)
  const previousModeRef = useRef<MarkdownWorkspaceViewerMode>(resolvedInitialMode)
  const [selectionState, setSelectionState] = useState<MarkdownSelectionState | null>(null)
  const [resolvedAnnotationOverlays, setResolvedAnnotationOverlays] = useState<ResolvedDocumentTextOverlay[]>([])
  const [resolvedSearchOverlays, setResolvedSearchOverlays] = useState<MarkdownSearchOverlay[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [editorSearchText, setEditorSearchText] = useState(model.markdown)
  const [wechatCopyState, setWechatCopyState] = useState<MarkdownWechatCopyState>({ kind: 'idle' })

  useEffect(() => {
    setMode(resolvedInitialMode)
  }, [resolvedInitialMode, observation?.file.path])

  useEffect(() => {
    copyRequestRef.current += 1
    copyInFlightRef.current = false
    setWechatCopyState({ kind: 'idle' })
    return () => {
      copyRequestRef.current += 1
      copyInFlightRef.current = false
    }
  }, [documentContentKey, observation?.file.path])

  const showEditor = mode === 'edit' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'
  const wechatCopyFeedback = buildMarkdownWechatCopyFeedbackModel(wechatCopyState)
  const sourceSearchMatches = useMemo(
    () => findDocumentTextSearchMatches(editorSearchText, searchQuery),
    [editorSearchText, searchQuery]
  )
  const searchMatchCount = mode === 'preview'
    ? resolvedSearchOverlays.length
    : sourceSearchMatches.length
  const activeSearchIndex = searchMatchCount > 0
    ? Math.min(searchIndex, searchMatchCount - 1)
    : 0
  const searchMatchLabel = searchQuery.trim()
    ? `${searchMatchCount ? activeSearchIndex + 1 : 0}/${searchMatchCount}`
    : ''

  useEffect(() => {
    setEditorSearchText(model.markdown)
  }, [documentContentKey, model.markdown, observation?.file.path])

  useEffect(() => {
    setSearchIndex(0)
  }, [documentContentKey, observation?.file.path, searchQuery])

  useEffect(() => {
    setSearchIndex((current) => searchMatchCount > 0
      ? Math.min(current, searchMatchCount - 1)
      : 0)
  }, [searchMatchCount])

  useEffect(() => {
    if (!showPreview) {
      setSelectionState(null)
      setResolvedAnnotationOverlays([])
      setResolvedSearchOverlays([])
      return
    }
    const root = previewTextRootRef.current
    const scroller = previewScrollerRef.current
    if (!root || !scroller) return
    const refresh = (): void => {
      setResolvedAnnotationOverlays(resolveDocumentTextOverlayRects(root, scroller, annotationOverlays))
      setResolvedSearchOverlays(resolveMarkdownSearchOverlayRects(root, scroller, searchQuery))
    }
    const frame = window.requestAnimationFrame(refresh)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh)
    observer?.observe(root)
    observer?.observe(scroller)
    window.addEventListener('resize', refresh)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', refresh)
    }
  }, [annotationOverlays, model.markdown, searchQuery, showPreview])

  useEffect(() => {
    if (!isNewDocumentNavigationRequest(
      handledNavigationRequestIdRef.current,
      navigationRequest
    )) return
    if (!showPreview) {
      setMode('preview')
      return
    }
    const root = previewTextRootRef.current
    const scroller = previewScrollerRef.current
    if (!root || !scroller) return
    const anchor = resolveDomDocumentTextAnchor(root, navigationRequest)
    if (!anchor) return
    const targetRect = anchor.range.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    const targetTop = scroller.scrollTop + targetRect.top - scrollerRect.top
    scroller.scrollTo({
      top: Math.max(0, Math.min(
        scroller.scrollHeight - scroller.clientHeight,
        targetTop - scroller.clientHeight / 2 + targetRect.height / 2
      )),
      behavior: 'smooth'
    })
    handledNavigationRequestIdRef.current = navigationRequest.requestId
  }, [model.markdown, navigationRequest, showPreview])

  const updateSelection = useCallback((): void => {
    if (!onAnnotationAction) return
    const root = previewTextRootRef.current
    const browserSelection = window.getSelection()
    if (!root || !browserSelection || browserSelection.rangeCount === 0 || browserSelection.isCollapsed) {
      setSelectionState(null)
      return
    }
    const anchor = documentTextAnchorFromDomRange(root, browserSelection.getRangeAt(0))
    if (!anchor) {
      setSelectionState(null)
      return
    }
    const rect = Array.from(anchor.range.getClientRects()).find((item) => item.width > 0 && item.height > 0)
    if (!rect) {
      setSelectionState(null)
      return
    }
    const selection = createMarkdownAnnotationSelection({
      anchor,
      filePath: observation?.file.path ?? '',
      mimeType: observation?.file.mimeType,
      size: observation?.file.size,
      mtimeMs: observation?.file.mtimeMs,
      anchorRect: domRectAnchor(rect)
    })
    setSelectionState({
      selection,
      toolbarStyle: markdownSelectionToolbarStyle(rect)
    })
  }, [observation?.file.mimeType, observation?.file.mtimeMs, observation?.file.path, observation?.file.size, onAnnotationAction])

  const scheduleSelectionUpdate = useCallback((): void => {
    window.setTimeout(updateSelection, 0)
  }, [updateSelection])

  const performSelectionAction = useCallback(async (action: DocumentAnnotationAction): Promise<void> => {
    const selection = selectionState?.selection
    if (!selection || !onAnnotationAction) return
    if (action === 'copy') await navigator.clipboard?.writeText(selection.text)
    onAnnotationAction(action, selection)
    if (action !== 'copy') window.getSelection()?.removeAllRanges()
    setSelectionState(null)
  }, [onAnnotationAction, selectionState])

  const copyForWechat = useCallback(async (): Promise<void> => {
    if (
      !onCopyForWechat ||
      model.truncated ||
      wechatCopyState.kind === 'copying' ||
      copyInFlightRef.current
    ) return
    const requestId = copyRequestRef.current + 1
    copyRequestRef.current = requestId
    copyInFlightRef.current = true
    setWechatCopyState({ kind: 'copying' })
    try {
      const result = await onCopyForWechat()
      if (copyRequestRef.current !== requestId) return
      setWechatCopyState({ kind: 'success', result })
    } catch (error) {
      if (copyRequestRef.current !== requestId) return
      setWechatCopyState({
        kind: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message
          : String(error)
      })
    } finally {
      if (copyRequestRef.current === requestId) {
        copyInFlightRef.current = false
      }
    }
  }, [model.truncated, onCopyForWechat, wechatCopyState.kind])

  const lockScrollSync = useCallback((origin: MarkdownScrollSyncOrigin): void => {
    scrollSyncOriginRef.current = origin
    if (scrollSyncResetFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollSyncResetFrameRef.current)
    }
    scrollSyncResetFrameRef.current = window.requestAnimationFrame(() => {
      if (scrollSyncOriginRef.current === origin) scrollSyncOriginRef.current = null
      scrollSyncResetFrameRef.current = null
    })
  }, [])

  const synchronizePaneScroll = useCallback((
    origin: Exclude<MarkdownScrollSyncOrigin, 'search'>,
    source: HTMLElement,
    target: HTMLElement
  ): void => {
    if (mode !== 'split') return
    const activeOrigin = scrollSyncOriginRef.current
    if (activeOrigin && activeOrigin !== origin) return
    const nextScrollTop = proportionalScrollTop({
      sourceScrollTop: source.scrollTop,
      sourceScrollHeight: source.scrollHeight,
      sourceClientHeight: source.clientHeight,
      targetScrollHeight: target.scrollHeight,
      targetClientHeight: target.clientHeight
    })
    if (Math.abs(target.scrollTop - nextScrollTop) < 1) return
    lockScrollSync(origin)
    target.scrollTop = nextScrollTop
  }, [lockScrollSync, mode])

  const handleEditorElementChange = useCallback((element: HTMLTextAreaElement | null): void => {
    editorRef.current = element
  }, [])

  const handleEditorScroll = useCallback((editor: HTMLTextAreaElement): void => {
    const preview = previewScrollerRef.current
    if (preview) synchronizePaneScroll('editor', editor, preview)
  }, [synchronizePaneScroll])

  const handlePreviewScroll = useCallback((preview: HTMLDivElement): void => {
    const editor = editorRef.current
    if (editor) synchronizePaneScroll('preview', preview, editor)
  }, [synchronizePaneScroll])

  const jumpSearch = useCallback((direction: -1 | 1): void => {
    if (searchMatchCount === 0) return
    setSearchIndex((current) => (current + direction + searchMatchCount) % searchMatchCount)
  }, [searchMatchCount])

  useEffect(() => {
    const root = viewerRef.current
    if (!root) return
    const handleFindShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      const activeElement = root.ownerDocument.activeElement
      if (!root.contains(activeElement) && !root.matches(':hover')) return
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    root.ownerDocument.addEventListener('keydown', handleFindShortcut)
    return () => root.ownerDocument.removeEventListener('keydown', handleFindShortcut)
  }, [])

  useEffect(() => {
    if (!searchQuery.trim() || searchMatchCount === 0) return
    const frame = window.requestAnimationFrame(() => {
      lockScrollSync('search')
      if (showEditor) {
        const editor = editorRef.current
        const match = sourceSearchMatches[Math.min(activeSearchIndex, sourceSearchMatches.length - 1)]
        if (editor && match) locateTextareaSearchMatch(editor, editorSearchText, match.from, match.to)
      }
      if (showPreview) {
        const preview = previewScrollerRef.current
        const overlay = resolvedSearchOverlays[Math.min(activeSearchIndex, resolvedSearchOverlays.length - 1)]
        const rect = overlay?.rects[0]
        if (preview && rect) {
          preview.scrollTop = Math.max(0, rect.top - preview.clientHeight / 2 + rect.height / 2)
        }
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    activeSearchIndex,
    editorSearchText,
    lockScrollSync,
    resolvedSearchOverlays,
    searchMatchCount,
    searchQuery,
    showEditor,
    showPreview,
    sourceSearchMatches
  ])

  useEffect(() => {
    const previousMode = previousModeRef.current
    previousModeRef.current = mode
    if (mode !== 'split') return
    const frame = window.requestAnimationFrame(() => {
      const editor = editorRef.current
      const preview = previewScrollerRef.current
      if (!editor || !preview) return
      if (previousMode === 'preview') synchronizePaneScroll('preview', preview, editor)
      else synchronizePaneScroll('editor', editor, preview)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mode, synchronizePaneScroll])

  useEffect(() => () => {
    if (scrollSyncResetFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollSyncResetFrameRef.current)
    }
  }, [])

  return (
    <section
      ref={viewerRef}
      className={compactClassName(
        'workspace-preview-markdown-viewer flex h-full min-h-0 flex-col overflow-hidden',
        className
      )}
      data-workspace-preview-markdown-viewer
      data-status={model.status}
      data-editable={model.editable ? 'true' : 'false'}
      data-truncated={model.truncated ? 'true' : 'false'}
      data-markdown-wechat-copy-state={wechatCopyFeedback.phase}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-4 py-3 pr-28">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-ds-text" title={model.title}>{model.title}</h3>
            {model.status === 'ready' ? (
              <CopyTextButton text={model.title} iconOnly className="-mr-1" />
            ) : null}
          </div>
          {model.subtitle ? <p className="mt-1 text-xs text-ds-muted">{model.subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {model.status === 'ready' && onCopyForWechat ? (
            <MarkdownWechatCopyButton
              state={wechatCopyState}
              disabled={model.truncated}
              onCopy={() => void copyForWechat()}
            />
          ) : null}
          {model.status === 'ready' && onOpenAnnotations ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-text"
              title={t('writeDocxAnnotations')}
              aria-label={t('writeDocxAnnotations')}
              onClick={onOpenAnnotations}
              data-markdown-open-annotations
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          {model.status === 'ready' ? (
            <MarkdownModeControl mode={mode} onModeChange={setMode} />
          ) : null}
        </div>
        <p className="sr-only" data-markdown-agent-summary>
          {model.summary}
        </p>
      </header>

      {model.status === 'ready' ? (
        <div
          className="shrink-0 border-b border-ds-border bg-ds-panel/70 px-4 py-2 pr-20"
          data-markdown-search-toolbar
        >
          <div className="flex min-w-0 items-center gap-1 rounded-lg border border-ds-border bg-ds-bg px-2 py-1">
            <Search className="h-4 w-4 shrink-0 text-ds-faint" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-text outline-none placeholder:text-ds-faint"
              value={searchQuery}
              placeholder={t('writeDocxSearchPlaceholder')}
              aria-label={t('writeDocxSearchPlaceholder')}
              data-markdown-search-input
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  jumpSearch(event.shiftKey ? -1 : 1)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setSearchQuery('')
                }
              }}
            />
            <span
              className="min-w-[42px] shrink-0 text-right text-[11px] tabular-nums text-ds-faint"
              aria-live="polite"
              data-markdown-search-count
            >
              {searchMatchLabel}
            </span>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-text disabled:cursor-default disabled:opacity-35"
              title={t('writePdfPrevMatch')}
              aria-label={t('writePdfPrevMatch')}
              disabled={searchMatchCount === 0}
              onClick={() => jumpSearch(-1)}
              data-markdown-search-previous
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-text disabled:cursor-default disabled:opacity-35"
              title={t('writePdfNextMatch')}
              aria-label={t('writePdfNextMatch')}
              disabled={searchMatchCount === 0}
              onClick={() => jumpSearch(1)}
              data-markdown-search-next
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {model.status === 'ready' && onCopyForWechat && wechatCopyState.kind !== 'idle' ? (
        <MarkdownWechatCopyNotice state={wechatCopyState} />
      ) : null}

      {model.status !== 'ready' ? (
        <div
          className="p-4 text-sm text-ds-text"
          role={model.status === 'unsupported' ? 'alert' : 'status'}
        >
          <strong>{model.status === 'empty' ? 'No Markdown observation' : 'Unsupported observation'}</strong>
          <p className="mt-1 text-ds-muted">{model.summary}</p>
        </div>
      ) : (
        <div
          className={compactClassName(
            'min-h-0 flex-1 overflow-hidden',
            showEditor && showPreview ? 'grid grid-cols-1 lg:grid-cols-2' : 'flex flex-col'
          )}
          data-markdown-view-mode={mode}
        >
          {showEditor ? (
            <div className={compactClassName(
              'min-h-0 overflow-hidden',
              showPreview ? 'border-b border-ds-border lg:border-b-0 lg:border-r' : 'flex-1'
            )}>
              <TextWorkspaceViewer
                observation={observation}
                documentContentKey={documentContentKey}
                className="h-full min-h-0"
                onApplyEdit={onApplyEdit ? applyTextEdit : undefined}
                onDraftChange={setEditorSearchText}
                onEditorElementChange={handleEditorElementChange}
                onEditorScroll={handleEditorScroll}
              />
            </div>
          ) : null}
          {showPreview ? (
            <div
              ref={previewScrollerRef}
              className={compactClassName(
                'relative min-h-0 overflow-auto bg-ds-bg px-5 py-4 pr-20',
                showEditor ? false : 'flex-1'
              )}
              data-markdown-preview-pane
              data-markdown-annotation-actions={onAnnotationAction ? 'true' : 'false'}
              data-markdown-annotation-overlay-count={annotationOverlays.length}
              data-active-annotation-id={activeAnnotationId ?? undefined}
              onPointerUp={scheduleSelectionUpdate}
              onKeyUp={scheduleSelectionUpdate}
              onScroll={(event) => handlePreviewScroll(event.currentTarget)}
            >
              <div ref={previewTextRootRef} data-markdown-annotation-text-root>
                <WriteMarkdownPreview
                  content={model.markdown}
                  isMarkdown
                  filePath={observation?.file.path}
                  workspaceRoot={observation?.file.workspaceRoot}
                  loadWorkspaceImage={loadWorkspaceImage}
                  onOpenWorkspaceLink={onOpenWorkspaceLink}
                />
              </div>
              <MarkdownAnnotationOverlayLayer
                overlays={resolvedAnnotationOverlays}
                activeAnnotationId={activeAnnotationId}
                onAnnotationSelect={onAnnotationSelect}
              />
              <MarkdownSearchOverlayLayer
                overlays={resolvedSearchOverlays}
                activeIndex={activeSearchIndex}
              />
            </div>
          ) : null}
        </div>
      )}
      {selectionState && onAnnotationAction ? (
        <MarkdownSelectionToolbar
          style={selectionState.toolbarStyle}
          onAction={(action) => void performSelectionAction(action)}
        />
      ) : null}
    </section>
  )
}

function MarkdownWechatCopyButton({
  state,
  disabled,
  onCopy
}: {
  state: MarkdownWechatCopyState
  disabled: boolean
  onCopy: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const feedback = buildMarkdownWechatCopyFeedbackModel(state)
  const copying = feedback.phase === 'copying'
  const label = copying
    ? t('markdownWechatCopying')
    : feedback.phase === 'success'
      ? t('markdownWechatCopySuccessButton')
      : feedback.phase === 'warning'
        ? t('markdownWechatCopyWarningButton', { count: feedback.warningCount })
        : feedback.phase === 'error'
          ? t('markdownWechatCopyRetry')
          : t('markdownWechatCopy')
  const title = disabled ? t('markdownWechatCopyTruncated') : label
  const toneClassName = feedback.phase === 'success'
    ? 'text-emerald-600 dark:text-emerald-400'
    : feedback.phase === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : feedback.phase === 'error'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-ds-muted hover:text-ds-text'

  return (
    <button
      type="button"
      className={compactClassName(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition',
        'hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45',
        toneClassName
      )}
      title={title}
      aria-label={title}
      aria-busy={copying ? 'true' : undefined}
      disabled={disabled || copying}
      onClick={onCopy}
      data-markdown-copy-for-wechat
      data-state={feedback.phase}
    >
      {copying ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : feedback.phase === 'success' || feedback.phase === 'warning' ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : feedback.phase === 'error' ? (
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  )
}

function MarkdownWechatCopyNotice({
  state
}: {
  state: Exclude<MarkdownWechatCopyState, { kind: 'idle' }>
}): ReactElement {
  const { t } = useTranslation('common')
  const feedback = buildMarkdownWechatCopyFeedbackModel(state)
  const toneClassName = feedback.phase === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-200'
    : feedback.phase === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-100'
      : feedback.phase === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-200'
        : 'border-ds-border bg-ds-panel text-ds-muted'

  let body: ReactElement
  if (state.kind === 'copying') {
    body = <p>{t('markdownWechatCopyingDetail')}</p>
  } else if (state.kind === 'error') {
    body = <p>{t('markdownWechatCopyFailed', { message: state.message })}</p>
  } else {
    const result = state.result
    body = (
      <>
        <p>
          {feedback.phase === 'warning'
            ? t('markdownWechatCopyWarning', { count: feedback.warningCount })
            : t('markdownWechatCopySuccess')}
        </p>
        <p className="mt-0.5 opacity-80">
          {t('markdownWechatCopySummary', {
            formulas: result.counts.formulas,
            images: result.counts.embeddedImages,
            codeBlocks: result.counts.codeBlocks
          })}
        </p>
        {result.warnings.length ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.index ?? index}`}>{warning.message}</li>
            ))}
          </ul>
        ) : null}
      </>
    )
  }

  return (
    <div
      className={compactClassName(
        'shrink-0 border-b px-4 py-2 text-xs leading-relaxed',
        toneClassName
      )}
      role={feedback.phase === 'error' ? 'alert' : 'status'}
      aria-live={feedback.phase === 'error' ? 'assertive' : 'polite'}
      data-markdown-wechat-copy-notice
      data-state={feedback.phase}
    >
      {body}
    </div>
  )
}

export function createMarkdownAnnotationSelection(input: {
  anchor: DocumentTextAnchor
  filePath: string
  mimeType?: string
  size?: number
  mtimeMs?: number
  anchorRect?: NonNullable<DocumentAnnotationSelection['anchorRect']>
}): DocumentAnnotationSelection {
  const { anchor } = input
  return {
    text: anchor.quote,
    ranges: [{
      from: anchor.from,
      to: anchor.to,
      startLine: anchor.start.line,
      startColumn: anchor.start.column,
      endLine: anchor.end.line,
      endColumn: anchor.end.column,
      text: anchor.quote,
      charCount: anchor.quote.length
    }],
    charCount: anchor.quote.length,
    sourceKind: 'markdown',
    contextBefore: anchor.contextBefore,
    contextAfter: anchor.contextAfter,
    ...(input.anchorRect ? { anchorRect: input.anchorRect } : {}),
    rects: [],
    metadata: {
      sourceKind: 'markdown',
      filePath: input.filePath,
      sourceTitle: basename(input.filePath),
      mimeType: input.mimeType ?? 'text/markdown',
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.mtimeMs !== undefined ? { mtimeMs: input.mtimeMs } : {}),
      rects: []
    }
  }
}

export function proportionalScrollTop(input: {
  sourceScrollTop: number
  sourceScrollHeight: number
  sourceClientHeight: number
  targetScrollHeight: number
  targetClientHeight: number
}): number {
  const sourceRange = Math.max(0, input.sourceScrollHeight - input.sourceClientHeight)
  const targetRange = Math.max(0, input.targetScrollHeight - input.targetClientHeight)
  if (sourceRange === 0 || targetRange === 0) return 0
  const progress = Math.max(0, Math.min(1, input.sourceScrollTop / sourceRange))
  return progress * targetRange
}

function locateTextareaSearchMatch(
  editor: HTMLTextAreaElement,
  text: string,
  from: number,
  to: number
): void {
  editor.setSelectionRange(from, to)
  const lineIndex = text.slice(0, from).split(/\r\n|\r|\n/u).length - 1
  const computedLineHeight = Number.parseFloat(
    editor.ownerDocument.defaultView?.getComputedStyle(editor).lineHeight ?? ''
  )
  const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 20
  const targetTop = lineIndex * lineHeight - editor.clientHeight / 2 + lineHeight / 2
  editor.scrollTop = Math.max(0, Math.min(
    editor.scrollHeight - editor.clientHeight,
    targetTop
  ))
}

function resolveMarkdownSearchOverlayRects(
  root: HTMLElement,
  scroller: HTMLElement,
  query: string
): MarkdownSearchOverlay[] {
  const scrollerRect = scroller.getBoundingClientRect()
  return resolveDomDocumentTextSearchMatches(root, query).flatMap((match, index) => {
    const rects = Array.from(match.range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        top: rect.top - scrollerRect.top + scroller.scrollTop,
        left: rect.left - scrollerRect.left + scroller.scrollLeft,
        width: rect.width,
        height: rect.height
      }))
    return rects.length ? [{ index, rects }] : []
  })
}

function MarkdownSearchOverlayLayer({
  overlays,
  activeIndex
}: {
  overlays: readonly MarkdownSearchOverlay[]
  activeIndex: number
}): ReactElement {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[9]"
      aria-hidden="true"
      data-markdown-search-overlay-layer
    >
      {overlays.flatMap((overlay) => overlay.rects.map((rect, rectIndex) => (
        <span
          key={`${overlay.index}-${rectIndex}`}
          className={compactClassName(
            'absolute rounded-[2px]',
            overlay.index === activeIndex
              ? 'bg-orange-400/45 ring-1 ring-orange-500/70'
              : 'bg-amber-300/35'
          )}
          style={rect}
          data-markdown-search-match={overlay.index}
          data-active={overlay.index === activeIndex ? 'true' : undefined}
        />
      )))}
    </div>
  )
}

function MarkdownAnnotationOverlayLayer({
  overlays,
  activeAnnotationId,
  onAnnotationSelect
}: {
  overlays: readonly ResolvedDocumentTextOverlay[]
  activeAnnotationId: string | null
  onAnnotationSelect?: (threadId: string) => void
}): ReactElement {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      aria-hidden={overlays.length ? undefined : 'true'}
      data-markdown-annotation-overlay-layer
    >
      {overlays.flatMap((overlay) => overlay.rects.map((rect, index) => (
        <button
          key={`${overlay.id}-${index}`}
          type="button"
          className={compactClassName(
            'pointer-events-auto absolute rounded-[3px] border-0 p-0 transition',
            markdownAnnotationOverlayClassName(overlay.kind, overlay.status),
            overlay.id === activeAnnotationId ? 'ring-2 ring-accent/55' : false
          )}
          style={rect}
          title={overlay.label ?? 'Open annotation'}
          aria-label={overlay.label ?? 'Open annotation'}
          data-markdown-annotation-id={overlay.id}
          data-active={overlay.id === activeAnnotationId ? 'true' : undefined}
          onClick={() => onAnnotationSelect?.(overlay.id)}
        />
      )))}
    </div>
  )
}

function MarkdownSelectionToolbar({
  style,
  onAction
}: {
  style: CSSProperties
  onAction: (action: DocumentAnnotationAction) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const actions: Array<{
    action: DocumentAnnotationAction
    label: string
    icon: ReactElement
    hoverClassName: string
  }> = [
    {
      action: 'highlight',
      label: t('writePdfAnnotationKind_highlight'),
      icon: <Highlighter className="h-4 w-4" aria-hidden="true" />,
      hoverClassName: 'hover:text-amber-600'
    },
    {
      action: 'comment',
      label: t('writePdfAnnotationKind_comment'),
      icon: <MessageSquare className="h-4 w-4" aria-hidden="true" />,
      hoverClassName: 'hover:text-sky-600'
    },
    {
      action: 'question',
      label: t('writePdfAnnotationKind_question'),
      icon: <HelpCircle className="h-4 w-4" aria-hidden="true" />,
      hoverClassName: 'hover:text-violet-600'
    },
    {
      action: 'translation',
      label: t('writePdfAnnotationKind_translation'),
      icon: <Languages className="h-4 w-4" aria-hidden="true" />,
      hoverClassName: 'hover:text-cyan-600'
    },
    {
      action: 'copy',
      label: t('windowsMenuCopy'),
      icon: <Clipboard className="h-4 w-4" aria-hidden="true" />,
      hoverClassName: 'hover:text-ds-text'
    }
  ]
  return (
    <div
      className="fixed z-40 flex items-center gap-1 rounded-lg border border-ds-border bg-ds-card/98 p-1 text-ds-text shadow-[0_14px_42px_rgba(15,23,42,0.18)] backdrop-blur-xl"
      style={style}
      data-markdown-selection-toolbar
      onPointerDown={(event) => event.preventDefault()}
    >
      {actions.map((item) => (
        <button
          key={item.action}
          type="button"
          className={compactClassName(
            'flex h-8 w-8 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover',
            item.hoverClassName
          )}
          title={item.label}
          aria-label={item.label}
          data-markdown-annotation-action={item.action}
          onClick={() => onAction(item.action)}
        >
          {item.icon}
        </button>
      ))}
    </div>
  )
}

function markdownAnnotationOverlayClassName(
  kind: ResolvedDocumentTextOverlay['kind'],
  status?: 'open' | 'resolved'
): string {
  const opacity = status === 'resolved' ? 'opacity-55' : 'opacity-80'
  if (kind === 'comment') return `bg-sky-300/65 ${opacity}`
  if (kind === 'question') return `bg-violet-300/65 ${opacity}`
  if (kind === 'translation') return `bg-cyan-300/65 ${opacity}`
  if (kind === 'answer') return `bg-emerald-300/65 ${opacity}`
  return `bg-amber-300/70 ${opacity}`
}

function MarkdownModeControl({
  mode,
  onModeChange
}: {
  mode: MarkdownWorkspaceViewerMode
  onModeChange: (mode: MarkdownWorkspaceViewerMode) => void
}): ReactElement {
  const modes: Array<{ mode: MarkdownWorkspaceViewerMode; label: string; icon: ReactElement }> = [
    { mode: 'edit', label: 'Edit', icon: <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> },
    { mode: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" /> },
    { mode: 'split', label: 'Split', icon: <Columns2 className="h-3.5 w-3.5" aria-hidden="true" /> }
  ]
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-lg border border-ds-border bg-ds-panel p-1"
      data-markdown-mode-control
    >
      {modes.map((item) => (
        <button
          key={item.mode}
          type="button"
          onClick={() => onModeChange(item.mode)}
          className={compactClassName(
            'inline-flex h-7 w-7 min-w-0 items-center justify-center rounded-md text-[11.5px] font-semibold transition',
            mode === item.mode
              ? 'bg-white text-accent shadow-sm ring-1 ring-ds-border dark:bg-white/10 dark:ring-white/10'
              : 'text-ds-muted hover:bg-ds-hover hover:text-ds-text'
          )}
          title={item.label}
          aria-label={item.label}
          aria-pressed={mode === item.mode}
          data-markdown-mode-button={item.mode}
        >
          {item.icon}
          <span className="sr-only">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

export function createMarkdownReplaceAllOperation(input: {
  observation: WorkspaceObservation
  beforeText: string
  text: string
}): Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }> {
  return createTextReplaceAllOperation(input)
}

function isMarkdownObservation(observation: WorkspaceObservation): boolean {
  return observation.view.pluginId === 'markdown' ||
    /\.(?:md|mdx|markdown)$/i.test(observation.file.path) ||
    observation.file.mimeType === 'text/markdown' ||
    observation.file.mimeType === 'text/x-markdown'
}

function countTextLines(value: string): number {
  if (value.length === 0) return 0
  return value.split(/\r\n|\r|\n/u).length
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function displayFilePath(filePath: string, workspaceRoot?: string): string {
  if (isAbsoluteFilePath(filePath)) return filePath
  const root = workspaceRoot?.trim()
  if (!root) return filePath
  return `${root.replace(/[\\/]+$/u, '')}/${filePath.replace(/^[\\/]+/u, '')}`
}

function basename(filePath: string): string {
  return filePath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? filePath
}

function domRectAnchor(rect: DOMRect): NonNullable<DocumentAnnotationSelection['anchorRect']> {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

function markdownSelectionToolbarStyle(rect: DOMRect): CSSProperties {
  const width = 190
  const left = Math.min(
    Math.max(12, rect.left + rect.width / 2 - width / 2),
    Math.max(12, window.innerWidth - width - 12)
  )
  return {
    left,
    top: Math.max(12, rect.top - 48),
    width
  }
}

function isAbsoluteFilePath(filePath: string): boolean {
  return filePath.startsWith('/') ||
    filePath.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/u.test(filePath)
}

function compactStrings(values: Array<string | undefined | null | false>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function compactClassName(...values: Array<string | undefined | null | false>): string {
  return compactStrings(values).join(' ')
}
