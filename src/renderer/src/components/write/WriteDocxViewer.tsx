import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  HelpCircle,
  Highlighter,
  Languages,
  Loader2,
  MessageSquare,
  Pencil,
  RotateCcw,
  Save,
  Search
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  WorkspaceDocxParagraph,
  WorkspaceDocxTextParagraphWrite,
  WorkspaceDocxTextWriteResult
} from '@shared/workspace-file'
import type {
  DocumentAnnotationAction,
  DocumentAnnotationSelection,
  DocumentNavigationRequest,
  DocumentTextAnnotationOverlay
} from '../../workspace-preview/document-annotation-types'
import {
  createDocumentTextAnchor,
  isNewDocumentNavigationRequest,
  resolveDocumentTextAnchor
} from '../../workspace-preview/dom-text-annotations'

type Props = {
  filePath: string
  documentContentKey?: string
  paragraphs: WorkspaceDocxParagraph[]
  content: string
  size: number
  mtimeMs: number
  workspaceRoot: string
  annotationOverlays?: readonly DocumentTextAnnotationOverlay[]
  activeAnnotationId?: string | null
  onAnnotationAction?: (action: DocumentAnnotationAction, selection: DocumentAnnotationSelection) => void
  onAnnotationSelect?: (threadId: string) => void
  annotationsOpen?: boolean
  onToggleAnnotations?: () => void
  navigationRequest?: DocumentNavigationRequest | null
  onSaveParagraphs?: (paragraphs: WorkspaceDocxTextParagraphWrite[]) => Promise<WorkspaceDocxTextWriteResult>
  className?: string
}

type DocxSelectionState = {
  selection: DocumentAnnotationSelection
  toolbarStyle: CSSProperties
}

type HighlightSpan = {
  id: string
  kind: DocumentTextAnnotationOverlay['kind']
  status?: 'open' | 'resolved'
  start: number
  end: number
  active: boolean
}

type DocxSearchMatch = {
  paragraphIndex: number
  start: number
  end: number
  globalIndex: number
}

type ParagraphTextSpan = {
  start: number
  end: number
  annotation?: HighlightSpan
  search?: DocxSearchMatch
}

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCX_ICON_BUTTON_CLASS = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40'

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function anchorRectFromDomRect(rect: DOMRect): DocumentAnnotationSelection['anchorRect'] {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

function paragraphElementFromNode(node: Node, root: HTMLElement): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const paragraph = element?.closest<HTMLElement>('[data-docx-paragraph-index]')
  return paragraph && root.contains(paragraph) ? paragraph : null
}

function paragraphIndexFromElement(paragraph: HTMLElement): number | null {
  const value = Number(paragraph.dataset.docxParagraphIndex ?? '')
  return Number.isFinite(value) && value > 0 ? value : null
}

function textOffsetInElement(element: HTMLElement, node: Node, offset: number): number {
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  try {
    range.setEnd(node, offset)
    return range.toString().length
  } catch {
    return 0
  }
}

function selectionToolbarStyle(rect: DOMRect): CSSProperties {
  const width = 190
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), Math.max(12, window.innerWidth - width - 12))
  const top = Math.max(12, rect.top - 48)
  return { left, top, width }
}

function paragraphClassName(style: string | undefined): string {
  const normalized = style?.toLowerCase() ?? ''
  if (normalized.includes('heading1') || normalized.includes('title')) {
    return 'mt-6 text-[22px] font-semibold leading-8 text-slate-950 first:mt-0 dark:text-slate-50'
  }
  if (normalized.includes('heading2')) {
    return 'mt-5 text-[18px] font-semibold leading-7 text-slate-900 dark:text-slate-100'
  }
  if (normalized.includes('heading3')) {
    return 'mt-4 text-[15px] font-semibold leading-6 text-slate-900 dark:text-slate-100'
  }
  return 'mt-3 text-[14px] leading-7 text-slate-800 first:mt-0 dark:text-slate-100'
}

function editableParagraphText(element: HTMLElement): string {
  return element.innerText.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n')
}

function highlightClassName(kind: DocumentTextAnnotationOverlay['kind'], active: boolean, status?: 'open' | 'resolved'): string {
  const resolved = status === 'resolved'
  const activeClass = active ? 'ring-2 ring-accent/45' : ''
  const opacity = resolved ? 'opacity-60' : ''
  if (kind === 'comment') return `bg-sky-200/70 text-inherit ${activeClass} ${opacity}`
  if (kind === 'question') return `bg-violet-200/70 text-inherit ${activeClass} ${opacity}`
  if (kind === 'translation') return `bg-cyan-200/70 text-inherit ${activeClass} ${opacity}`
  if (kind === 'answer') return `bg-emerald-200/70 text-inherit ${activeClass} ${opacity}`
  return `bg-amber-200/80 text-inherit ${activeClass} ${opacity}`
}

function highlightedSpansForParagraph(
  documentText: string,
  paragraphText: string,
  paragraphStart: number,
  overlays: readonly DocumentTextAnnotationOverlay[],
  activeAnnotationId: string | null | undefined
): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  const occupied: Array<{ start: number; end: number }> = []
  for (const overlay of overlays) {
    const anchor = resolveDocumentTextAnchor(documentText, overlay)
    if (!anchor) continue
    const paragraphEnd = paragraphStart + paragraphText.length
    const start = Math.max(anchor.from, paragraphStart) - paragraphStart
    const end = Math.min(anchor.to, paragraphEnd) - paragraphStart
    if (end <= start) continue
    if (occupied.some((span) => start < span.end && end > span.start)) continue
    occupied.push({ start, end })
    spans.push({
      id: overlay.id,
      kind: overlay.kind,
      status: overlay.status,
      start,
      end,
      active: overlay.id === activeAnnotationId
    })
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end)
}

function findTextOccurrences(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const haystack = text.toLowerCase()
  const starts: number[] = []
  let cursor = 0
  while (cursor < haystack.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index < 0) break
    starts.push(index)
    cursor = index + Math.max(1, needle.length)
  }
  return starts
}

function buildDocxSearchMatches(
  paragraphs: readonly WorkspaceDocxParagraph[],
  query: string
): DocxSearchMatch[] {
  const matches: DocxSearchMatch[] = []
  for (const paragraph of paragraphs) {
    const starts = findTextOccurrences(paragraph.text, query)
    for (const start of starts) {
      matches.push({
        paragraphIndex: paragraph.index,
        start,
        end: start + query.trim().length,
        globalIndex: matches.length
      })
    }
  }
  return matches
}

function paragraphTextSpans(
  text: string,
  annotations: readonly HighlightSpan[],
  searches: readonly DocxSearchMatch[]
): ParagraphTextSpan[] {
  const boundaries = new Set<number>([0, text.length])
  for (const span of annotations) {
    boundaries.add(span.start)
    boundaries.add(span.end)
  }
  for (const match of searches) {
    boundaries.add(match.start)
    boundaries.add(match.end)
  }
  const points = Array.from(boundaries)
    .filter((point) => point >= 0 && point <= text.length)
    .sort((a, b) => a - b)
  const spans: ParagraphTextSpan[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (end <= start) continue
    spans.push({
      start,
      end,
      annotation: annotations.find((span) => start >= span.start && end <= span.end),
      search: searches.find((match) => start >= match.start && end <= match.end)
    })
  }
  return spans
}

export function WriteDocxViewer({
  filePath,
  documentContentKey,
  paragraphs,
  content,
  size,
  mtimeMs,
  workspaceRoot,
  annotationOverlays = [],
  activeAnnotationId,
  onAnnotationAction,
  onAnnotationSelect,
  annotationsOpen = false,
  onToggleAnnotations,
  navigationRequest = null,
  onSaveParagraphs,
  className
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const handledNavigationRequestIdRef = useRef<string | null>(null)
  const editableParagraphRefs = useRef<Map<number, HTMLElement>>(new Map())
  const paragraphSourceRef = useRef(paragraphs)
  paragraphSourceRef.current = paragraphs
  const [selectionState, setSelectionState] = useState<DocxSelectionState | null>(null)
  const [committedParagraphs, setCommittedParagraphs] = useState<WorkspaceDocxParagraph[]>(paragraphs)
  const [draftParagraphs, setDraftParagraphs] = useState<WorkspaceDocxParagraph[]>(paragraphs)
  const [editMode, setEditMode] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [searchIndex, setSearchIndex] = useState(0)
  const sourceTitle = fileNameFromPath(filePath)
  const documentIdentity = documentContentKey?.trim() ||
    `${filePath}\u0000${mtimeMs}\u0000${size}`
  const visibleOverlays = useMemo(
    () => annotationOverlays.filter((overlay) => overlay.quote.trim()),
    [annotationOverlays]
  )
  const originalTextByIndex = useMemo(() => new Map(
    committedParagraphs.map((paragraph) => [paragraph.index, paragraph.text])
  ), [committedParagraphs])
  const draftDirty = useMemo(() => draftParagraphs.some((paragraph) => (
    paragraph.text !== (originalTextByIndex.get(paragraph.index) ?? '')
  )), [draftParagraphs, originalTextByIndex])
  const searchMatches = useMemo(
    () => editMode ? [] : buildDocxSearchMatches(committedParagraphs, deferredSearchQuery),
    [committedParagraphs, deferredSearchQuery, editMode]
  )
  const committedContent = useMemo(
    () => committedParagraphs.map((paragraph) => paragraph.text).join('\n\n'),
    [committedParagraphs]
  )
  const paragraphStartOffsets = useMemo(() => {
    let offset = 0
    return new Map(committedParagraphs.map((paragraph) => {
      const entry: [number, number] = [paragraph.index, offset]
      offset += paragraph.text.length + 2
      return entry
    }))
  }, [committedParagraphs])
  const activeSearchMatch = searchMatches[Math.min(searchIndex, Math.max(0, searchMatches.length - 1))] ?? null
  const matchLabel = searchQuery.trim()
    ? `${searchMatches.length ? Math.min(searchIndex + 1, searchMatches.length) : 0}/${searchMatches.length}`
    : ''

  useEffect(() => {
    const nextParagraphs = paragraphSourceRef.current
    setCommittedParagraphs(nextParagraphs)
    setDraftParagraphs(nextParagraphs)
    setEditMode(false)
    setSaveState('idle')
    setSaveError(null)
    setSearchIndex(0)
  }, [documentIdentity])

  useEffect(() => {
    setSearchIndex(0)
  }, [deferredSearchQuery])

  useEffect(() => {
    if (!activeSearchMatch || editMode) return
    window.setTimeout(() => {
      const root = rootRef.current
      const target = root?.querySelector<HTMLElement>(`[data-docx-search-index="${activeSearchMatch.globalIndex}"]`)
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    }, 0)
  }, [activeSearchMatch, editMode])

  useEffect(() => {
    if (!isNewDocumentNavigationRequest(
      handledNavigationRequestIdRef.current,
      navigationRequest
    )) return
    window.setTimeout(() => {
      const anchor = resolveDocumentTextAnchor(committedContent, navigationRequest)
      const paragraph = anchor ? committedParagraphs.find((candidate) => {
        const start = paragraphStartOffsets.get(candidate.index) ?? 0
        return anchor.from >= start && anchor.from <= start + candidate.text.length
      }) : undefined
      const target = paragraph
        ? rootRef.current?.querySelector<HTMLElement>(`[data-docx-paragraph-index="${paragraph.index}"]`)
        : null
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      if (target) handledNavigationRequestIdRef.current = navigationRequest.requestId
    }, 0)
  }, [committedContent, committedParagraphs, navigationRequest, paragraphStartOffsets])

  const updateSelection = useCallback((): void => {
    if (editMode) {
      setSelectionState(null)
      return
    }
    const root = rootRef.current
    const browserSelection = window.getSelection()
    if (!root || !browserSelection || browserSelection.rangeCount === 0) {
      setSelectionState(null)
      return
    }
    const range = browserSelection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) {
      setSelectionState(null)
      return
    }
    const text = browserSelection.toString().trim()
    if (!text) {
      setSelectionState(null)
      return
    }
    const rect = Array.from(range.getClientRects()).find((item) => item.width > 0 && item.height > 0)
    if (!rect) {
      setSelectionState(null)
      return
    }
    const startParagraph = paragraphElementFromNode(range.startContainer, root)
    const endParagraph = paragraphElementFromNode(range.endContainer, root)
    if (!startParagraph || !endParagraph) {
      setSelectionState(null)
      return
    }
    const startParagraphIndex = paragraphIndexFromElement(startParagraph)
    const endParagraphIndex = paragraphIndexFromElement(endParagraph)
    const startParagraphOffset = startParagraphIndex == null ? undefined : paragraphStartOffsets.get(startParagraphIndex)
    const endParagraphOffset = endParagraphIndex == null ? undefined : paragraphStartOffsets.get(endParagraphIndex)
    if (startParagraphOffset == null || endParagraphOffset == null) {
      setSelectionState(null)
      return
    }
    const anchor = createDocumentTextAnchor(
      committedContent,
      startParagraphOffset + textOffsetInElement(startParagraph, range.startContainer, range.startOffset),
      endParagraphOffset + textOffsetInElement(endParagraph, range.endContainer, range.endOffset)
    )
    if (!anchor) {
      setSelectionState(null)
      return
    }
    const nextSelection: DocumentAnnotationSelection = {
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
      sourceKind: 'docx',
      contextBefore: anchor.contextBefore,
      contextAfter: anchor.contextAfter,
      anchorRect: anchorRectFromDomRect(rect),
      rects: [],
      metadata: {
        sourceKind: 'docx',
        filePath,
        sourceTitle,
        mimeType: DOCX_MIME_TYPE,
        size,
        mtimeMs,
        rects: []
      }
    }
    setSelectionState({
      selection: nextSelection,
      toolbarStyle: selectionToolbarStyle(rect)
    })
  }, [committedContent, editMode, filePath, mtimeMs, paragraphStartOffsets, size, sourceTitle])

  const scheduleSelectionUpdate = useCallback((): void => {
    window.setTimeout(updateSelection, 0)
  }, [updateSelection])

  const performSelectionAction = useCallback(async (action: DocumentAnnotationAction): Promise<void> => {
    const selection = selectionState?.selection
    if (!selection) return
    if (action === 'copy') {
      await navigator.clipboard?.writeText(selection.text)
    }
    onAnnotationAction?.(action, selection)
    if (action !== 'copy') window.getSelection()?.removeAllRanges()
    setSelectionState(null)
  }, [onAnnotationAction, selectionState])

  const jumpSearch = useCallback((direction: 1 | -1): void => {
    if (searchMatches.length === 0) return
    setSearchIndex((index) => (index + direction + searchMatches.length) % searchMatches.length)
  }, [searchMatches.length])

  const updateDraftParagraph = useCallback((paragraphIndex: number, text: string): void => {
    setSaveState('idle')
    setSaveError(null)
    setDraftParagraphs((current) => current.map((paragraph) => (
      paragraph.index === paragraphIndex ? { ...paragraph, text } : paragraph
    )))
  }, [])

  const syncDraftParagraphsFromDom = useCallback((): WorkspaceDocxParagraph[] => {
    let changed = false
    const nextDraft = draftParagraphs.map((paragraph) => {
      const element = editableParagraphRefs.current.get(paragraph.index)
      if (!element) return paragraph
      const text = editableParagraphText(element)
      if (text === paragraph.text) return paragraph
      changed = true
      return { ...paragraph, text }
    })
    if (changed) setDraftParagraphs(nextDraft)
    return nextDraft
  }, [draftParagraphs])

  const revertDocxEdits = useCallback((): void => {
    setDraftParagraphs(committedParagraphs)
    setSaveState('idle')
    setSaveError(null)
  }, [committedParagraphs])

  const saveDocxEdits = useCallback(async (): Promise<void> => {
    const currentDraftParagraphs = syncDraftParagraphsFromDom()
    const currentDirty = currentDraftParagraphs.some((paragraph) => (
      paragraph.text !== (originalTextByIndex.get(paragraph.index) ?? '')
    ))
    if (!currentDirty || saveState === 'saving') return
    if (!onSaveParagraphs) {
      setSaveState('error')
      setSaveError(t('writeDocxEditUnavailable'))
      return
    }
    const changed = currentDraftParagraphs
      .filter((paragraph) => paragraph.text !== (originalTextByIndex.get(paragraph.index) ?? ''))
      .map((paragraph) => ({ index: paragraph.index, text: paragraph.text }))
    if (changed.length === 0) {
      setEditMode(false)
      return
    }
    setSaveState('saving')
    setSaveError(null)
    try {
      const result = await onSaveParagraphs(changed)
      if (!result.ok) {
        setSaveState('error')
        setSaveError(t('writeDocxSaveFailed', { message: result.message }))
        return
      }
    } catch (error) {
      setSaveState('error')
      setSaveError(t('writeDocxSaveFailed', {
        message: error instanceof Error ? error.message : String(error)
      }))
      return
    }
    const nextCommitted = currentDraftParagraphs.map((paragraph) => ({ ...paragraph }))
    setCommittedParagraphs(nextCommitted)
    setDraftParagraphs(nextCommitted)
    setEditMode(false)
    setSaveState('saved')
  }, [onSaveParagraphs, originalTextByIndex, saveState, syncDraftParagraphsFromDom, t])

  const handleHighlightKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    threadId: string
  ): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onAnnotationSelect?.(threadId)
  }

  const renderParagraphText = (paragraph: WorkspaceDocxParagraph): ReactElement[] => {
    const spans = highlightedSpansForParagraph(
      committedContent,
      paragraph.text,
      paragraphStartOffsets.get(paragraph.index) ?? 0,
      visibleOverlays,
      activeAnnotationId
    )
    const paragraphSearchMatches = searchMatches.filter((match) => match.paragraphIndex === paragraph.index)
    if (spans.length === 0 && paragraphSearchMatches.length === 0) return [<span key="plain">{paragraph.text}</span>]
    const parts: ReactElement[] = []
    const textSpans = paragraphTextSpans(paragraph.text, spans, paragraphSearchMatches)
    for (const span of textSpans) {
      const textPart = paragraph.text.slice(span.start, span.end)
      if (!span.annotation && !span.search) {
        parts.push(<span key={`text-${span.start}`}>{textPart}</span>)
        continue
      }
      const activeSearch = span.search?.globalIndex === activeSearchMatch?.globalIndex
      const className = [
        'rounded-[3px] px-0.5 outline-none transition',
        span.annotation ? `cursor-pointer ${highlightClassName(span.annotation.kind, span.annotation.active, span.annotation.status)}` : '',
        span.search ? (
          activeSearch
            ? 'bg-sky-300/70 text-inherit ring-2 ring-sky-500/70'
            : 'bg-yellow-200/75 text-inherit'
        ) : ''
      ].filter(Boolean).join(' ')
      parts.push(
        <mark
          key={`${span.start}-${span.end}-${span.annotation?.id ?? 'search'}-${span.search?.globalIndex ?? 'annotation'}`}
          role={span.annotation ? 'button' : undefined}
          tabIndex={span.annotation ? 0 : undefined}
          className={className}
          data-docx-search-index={span.search?.globalIndex}
          data-docx-annotation-id={span.annotation?.id}
          onClick={span.annotation ? () => onAnnotationSelect?.(span.annotation!.id) : undefined}
          onKeyDown={span.annotation ? (event) => handleHighlightKeyDown(event, span.annotation!.id) : undefined}
        >
          {textPart}
        </mark>
      )
    }
    return parts
  }

  return (
    <div
      ref={rootRef}
      className={`relative flex h-full min-h-0 flex-col bg-ds-main/70 ${className ?? ''}`}
      onPointerUp={scheduleSelectionUpdate}
      onKeyUp={scheduleSelectionUpdate}
    >
      <div
        className="shrink-0 border-b border-ds-border-muted bg-white/88 px-3 py-2 backdrop-blur-xl dark:bg-ds-card/95"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!editMode ? (
            <div className="flex min-w-[190px] flex-1 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 dark:bg-white/6 sm:max-w-[360px]">
              <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
              <input
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
                value={searchQuery}
                placeholder={t('writeDocxSearchPlaceholder')}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <span className="min-w-[42px] shrink-0 text-right text-[11px] text-ds-faint">
                {matchLabel}
              </span>
              <button
                type="button"
                className={DOCX_ICON_BUTTON_CLASS}
                title={t('writePdfPrevMatch')}
                aria-label={t('writePdfPrevMatch')}
                disabled={searchMatches.length === 0}
                onClick={() => jumpSearch(-1)}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                className={DOCX_ICON_BUTTON_CLASS}
                title={t('writePdfNextMatch')}
                aria-label={t('writePdfNextMatch')}
                disabled={searchMatches.length === 0}
                onClick={() => jumpSearch(1)}
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          ) : null}

          <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            {onToggleAnnotations ? (
              <button
                type="button"
                className={DOCX_ICON_BUTTON_CLASS}
                data-active={annotationsOpen ? 'true' : undefined}
                title={t('writeDocxAnnotations')}
                aria-label={t('writeDocxAnnotations')}
                aria-pressed={annotationsOpen}
                onClick={onToggleAnnotations}
              >
                <MessageSquare className="h-4 w-4" strokeWidth={1.9} />
              </button>
            ) : null}
            <button
              type="button"
              className={DOCX_ICON_BUTTON_CLASS}
              title={editMode ? t('writeDocxReadMode') : t('writeDocxEditMode')}
              aria-label={editMode ? t('writeDocxReadMode') : t('writeDocxEditMode')}
              onClick={() => {
                if (!editMode) {
                  setEditMode(true)
                  setSaveState('idle')
                  setSaveError(null)
                } else if (!draftDirty) {
                  setEditMode(false)
                }
              }}
              disabled={editMode && draftDirty}
            >
              {editMode ? <Check className="h-4 w-4" strokeWidth={1.9} /> : <Pencil className="h-4 w-4" strokeWidth={1.9} />}
            </button>
            {editMode ? (
              <>
                <button
                  type="button"
                  className={DOCX_ICON_BUTTON_CLASS}
                  title={t('writeDocxRevert')}
                  aria-label={t('writeDocxRevert')}
                  disabled={!draftDirty || saveState === 'saving'}
                  onClick={revertDocxEdits}
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!draftDirty || saveState === 'saving'}
                  onClick={() => void saveDocxEdits()}
                >
                  {saveState === 'saving' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                  ) : (
                    <Save className="h-3.5 w-3.5" strokeWidth={1.9} />
                  )}
                  {saveState === 'saving' ? t('writeDocxSaving') : t('writeDocxSave')}
                </button>
              </>
            ) : null}
          </div>
        </div>
        {saveState === 'error' && saveError ? (
          <div className="mt-2 rounded-lg border border-red-500/20 bg-red-50 px-3 py-1.5 text-[12px] text-red-700 dark:bg-red-950/60 dark:text-red-200">
            {saveError}
          </div>
        ) : saveState === 'saved' ? (
          <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200">
            {t('writeDocxSaved')}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto my-8 min-h-[calc(100%-4rem)] w-[min(780px,calc(100%-48px))] rounded-sm border border-ds-border-muted bg-white px-16 py-14 shadow-sm dark:bg-ds-card">
          {committedParagraphs.length > 0 ? (
            editMode ? (
              <article className="ds-selectable-text whitespace-pre-wrap">
                {draftParagraphs.map((paragraph) => (
                  <p
                    key={paragraph.id}
                    ref={(element) => {
                      if (element) editableParagraphRefs.current.set(paragraph.index, element)
                      else editableParagraphRefs.current.delete(paragraph.index)
                    }}
                    data-docx-paragraph-index={paragraph.index}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck
                    className={`${paragraphClassName(paragraph.style)} rounded-[4px] px-1 outline-none transition hover:bg-ds-hover/45 focus:bg-accent/5 focus:ring-2 focus:ring-accent/20`}
                    onInput={(event) => updateDraftParagraph(paragraph.index, editableParagraphText(event.currentTarget))}
                  >
                    {paragraph.text}
                  </p>
                ))}
              </article>
            ) : (
              <article className="ds-selectable-text whitespace-pre-wrap">
                {committedParagraphs.map((paragraph) => (
                  <p
                    key={paragraph.id}
                    data-docx-paragraph-index={paragraph.index}
                    className={paragraphClassName(paragraph.style)}
                  >
                    {renderParagraphText(paragraph)}
                  </p>
                ))}
              </article>
            )
          ) : (
            <div className="flex min-h-[240px] items-center justify-center text-center text-[13px] leading-6 text-ds-muted">
              {t('writeDocxPreviewEmpty')}
            </div>
          )}
        </div>
      </div>
      {selectionState && onAnnotationAction ? (
        <div
          className="fixed z-40 flex items-center gap-1 rounded-lg border border-ds-border bg-ds-card/98 p-1 text-ds-ink shadow-[0_14px_42px_rgba(15,23,42,0.18)] backdrop-blur-xl"
          style={selectionState.toolbarStyle}
        >
          <button
            type="button"
            onClick={() => void performSelectionAction('highlight')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-amber-600"
            title={t('writePdfAnnotationKind_highlight')}
            aria-label={t('writePdfAnnotationKind_highlight')}
          >
            <Highlighter className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => void performSelectionAction('comment')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-sky-600"
            title={t('writePdfAnnotationKind_comment')}
            aria-label={t('writePdfAnnotationKind_comment')}
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => void performSelectionAction('question')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-violet-600"
            title={t('writePdfAnnotationKind_question')}
            aria-label={t('writePdfAnnotationKind_question')}
          >
            <HelpCircle className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => void performSelectionAction('translation')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-cyan-600"
            title={t('writePdfAnnotationKind_translation')}
            aria-label={t('writePdfAnnotationKind_translation')}
          >
            <Languages className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => void performSelectionAction('copy')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            title={t('windowsMenuCopy')}
            aria-label={t('windowsMenuCopy')}
          >
            <Clipboard className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      ) : null}
      <div className="sr-only">{committedContent.slice(0, 2000) || content.slice(0, 2000)}</div>
      <div className="sr-only">{workspaceRoot}</div>
    </div>
  )
}
