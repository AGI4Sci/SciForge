import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clipboard,
  Columns2,
  Eye,
  HelpCircle,
  Highlighter,
  Languages,
  MessageSquare,
  PencilLine
} from 'lucide-react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import {
  WriteMarkdownPreview,
  type WriteMarkdownWorkspaceImageLoader
} from '../components/write/WriteMarkdownPreview'
import {
  createTextReplaceAllOperation,
  TextWorkspaceViewer,
  type TextWorkspaceViewerApplyEditHandler
} from './TextWorkspaceViewer'
import { CopyTextButton } from '../components/CopyTextButton'
import {
  documentTextAnchorFromDomRange,
  isNewDocumentNavigationRequest,
  resolveDocumentTextOverlayRects,
  resolveDomDocumentTextAnchor,
  type DocumentTextAnchor,
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

export type MarkdownWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  documentContentKey?: string
  className?: string
  onApplyEdit?: MarkdownWorkspaceViewerApplyEditHandler
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
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
  loadWorkspaceImage,
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
  const previewScrollerRef = useRef<HTMLDivElement | null>(null)
  const previewTextRootRef = useRef<HTMLDivElement | null>(null)
  const handledNavigationRequestIdRef = useRef<string | null>(null)
  const [selectionState, setSelectionState] = useState<MarkdownSelectionState | null>(null)
  const [resolvedAnnotationOverlays, setResolvedAnnotationOverlays] = useState<ResolvedDocumentTextOverlay[]>([])

  useEffect(() => {
    setMode(resolvedInitialMode)
  }, [resolvedInitialMode, observation?.file.path])

  const showEditor = mode === 'edit' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'

  useEffect(() => {
    if (!showPreview) {
      setSelectionState(null)
      setResolvedAnnotationOverlays([])
      return
    }
    const root = previewTextRootRef.current
    const scroller = previewScrollerRef.current
    if (!root || !scroller) return
    const refresh = (): void => {
      setResolvedAnnotationOverlays(resolveDocumentTextOverlayRects(root, scroller, annotationOverlays))
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
  }, [annotationOverlays, model.markdown, showPreview])

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
    if (!root) return
    const anchor = resolveDomDocumentTextAnchor(root, navigationRequest)
    if (!anchor) return
    const target = anchor.range.startContainer.parentElement
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
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

  return (
    <section
      className={compactClassName(
        'workspace-preview-markdown-viewer flex h-full min-h-0 flex-col overflow-hidden',
        className
      )}
      data-workspace-preview-markdown-viewer
      data-status={model.status}
      data-editable={model.editable ? 'true' : 'false'}
      data-truncated={model.truncated ? 'true' : 'false'}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-4 py-3 pr-20">
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
            >
              <div ref={previewTextRootRef} data-markdown-annotation-text-root>
                <WriteMarkdownPreview
                  content={model.markdown}
                  isMarkdown
                  filePath={observation?.file.path}
                  workspaceRoot={observation?.file.workspaceRoot}
                  loadWorkspaceImage={loadWorkspaceImage}
                />
              </div>
              <MarkdownAnnotationOverlayLayer
                overlays={resolvedAnnotationOverlays}
                activeAnnotationId={activeAnnotationId}
                onAnnotationSelect={onAnnotationSelect}
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
