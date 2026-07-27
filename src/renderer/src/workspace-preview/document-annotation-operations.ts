import {
  WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS,
  WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS,
  type WorkspacePreviewAnnotationKind,
  type WorkspacePreviewAnnotationUpsertTarget,
  type WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import type {
  PdfAnnotation,
  PdfAnnotationSidecar,
  PdfAnnotationThread
} from '@shared/pdf-annotations'
import type {
  WritePdfAnnotationOverlay,
  WritePdfSelectionPageRect
} from '../components/write/WritePdfViewer'
import type {
  WritePdfAnnotationDisplayMode
} from '../components/write/WritePdfAnnotationsPanel'
import type {
  DocumentAnnotationAction,
  DocumentAnnotationSelection,
  DocumentKind,
  DocumentNavigationRequest,
  DocumentTextAnnotationOverlay
} from './document-annotation-types'

type AnnotationRect = NonNullable<NonNullable<WorkspacePreviewAnnotationUpsertTarget['anchor']>['rects']>[number]

export type AnnotationThreadOperationInput = {
  path: string
  threadId: string
}

export type CreateDocumentAnnotationOperationInput = {
  documentKind: DocumentKind
  path: string
  action: DocumentAnnotationAction
  selection: DocumentAnnotationSelection
  translationBody?: string
  visualSelectionQuote?: string
  createId?: (prefix: string) => string
}

export function workspacePreviewAnnotationKindForAction(
  action: DocumentAnnotationAction
): WorkspacePreviewAnnotationKind | null {
  if (action === 'copy') return null
  if (action === 'comment') return 'comment'
  if (action === 'translation') return 'question'
  if (action === 'question') return 'question'
  return 'highlight'
}

export function createDocumentWorkspacePreviewAnnotationOperation(
  input: CreateDocumentAnnotationOperationInput
): WorkspacePreviewEditOperation | null {
  if (
    input.selection.sourceKind !== input.documentKind ||
    input.selection.metadata.sourceKind !== input.documentKind
  ) return null
  const annotationKind = workspacePreviewAnnotationKindForAction(input.action)
  if (!annotationKind) return null

  const rawQuote = cleanAnnotationText(input.selection.text, WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS)
  if (input.documentKind !== 'pdf' && !rawQuote) return null

  const createId = input.createId ?? createLocalId
  const fallbackQuote = cleanAnnotationText(
    input.visualSelectionQuote ?? 'Selected region',
    WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS
  )
  const sourceText = rawQuote || fallbackQuote
  const pageStart = positivePage(input.selection.pageStart ?? input.selection.metadata.pageStart ?? input.selection.ranges[0]?.page)
  const pageEnd = Math.max(
    pageStart,
    positivePage(input.selection.pageEnd ?? input.selection.metadata.pageEnd ?? pageStart)
  )
  const rects = input.documentKind === 'pdf'
    ? normalizeAnnotationRects(input.selection.rects ?? input.selection.metadata.rects)
    : []
  const context = {
    before: cleanAnnotationText(
      input.selection.contextBefore ?? '',
      WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS
    ),
    after: cleanAnnotationText(
      input.selection.contextAfter ?? '',
      WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS
    )
  }
  const selectionRange = input.selection.ranges[0]
  const textRange = rawQuote && selectionRange
    ? {
        start: Math.max(0, Math.min(selectionRange.from, selectionRange.to)),
        end: Math.max(0, Math.max(selectionRange.from, selectionRange.to)),
        startLine: selectionRange.startLine,
        startColumn: selectionRange.startColumn,
        endLine: selectionRange.endLine,
        endColumn: selectionRange.endColumn
      }
    : undefined
  const body = input.action === 'translation'
    ? cleanAnnotationText(input.translationBody ?? '', WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS)
    : ''

  return {
    kind: 'annotation.upsert',
    path: input.path,
    annotationId: createId(`${input.documentKind}-ann`),
    annotationKind,
    body,
    target: {
      documentKind: input.documentKind,
      threadId: createId(`${input.documentKind}-thread`),
      anchor: {
        id: createId(`${input.documentKind}-anchor`),
        kind: annotationAnchorKind(input.selection, rawQuote),
        quote: sourceText,
        contextBefore: context.before,
        contextAfter: context.after,
        ...(textRange ? { textRange } : {}),
        pageStart,
        pageEnd,
        ...(rects.length ? { rects } : {})
      },
      thread: {
        status: 'open',
        ...(annotationKind === 'question' ? { title: clipInlineText(sourceText, 96) } : {})
      },
      annotation: {
        sourceText
      }
    }
  }
}

export function createAnnotationThreadStatusOperation(
  input: AnnotationThreadOperationInput & {
    status: 'open' | 'resolved'
    title?: string
  }
): WorkspacePreviewEditOperation {
  return {
    kind: 'annotation.thread.update',
    path: input.path,
    threadId: input.threadId,
    patch: {
      status: input.status,
      ...(input.title !== undefined ? { title: input.title } : {})
    }
  }
}

export function createAnnotationThreadDeleteOperation(
  input: AnnotationThreadOperationInput
): WorkspacePreviewEditOperation {
  return {
    kind: 'annotation.thread.delete',
    path: input.path,
    threadId: input.threadId,
    pruneOrphanAnchors: true
  }
}

export function createAnnotationBodyUpdateOperation(input: {
  path: string
  sidecar: PdfAnnotationSidecar
  annotationId: string
  body: string
}): WorkspacePreviewEditOperation | null {
  const annotation = input.sidecar.annotations.find((candidate) => candidate.id === input.annotationId)
  if (!annotation) return null
  return {
    kind: 'annotation.upsert',
    path: input.path,
    annotationId: annotation.id,
    annotationKind: annotation.kind,
    body: cleanAnnotationText(input.body, WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS)
  }
}

export function createPdfAnnotationOverlaysFromSidecar(
  sidecar: PdfAnnotationSidecar | null | undefined,
  options: {
    displayMode?: WritePdfAnnotationDisplayMode
    activeThreadId?: string | null
  } = {}
): WritePdfAnnotationOverlay[] {
  if (!sidecar || options.displayMode === 'hidden') return []
  const activeThreadId = options.activeThreadId?.trim() || null
  return sidecar.threads
    .filter((thread) => shouldShowAnnotationThread(thread, options.displayMode, activeThreadId))
    .flatMap((thread): WritePdfAnnotationOverlay[] => {
      const annotations = annotationsForThread(sidecar, thread)
      const rects = anchorsForThread(sidecar, thread).flatMap((anchor) => anchor.rects)
      if (rects.length === 0) return []
      return [{
        id: thread.id,
        kind: annotationOverlayKind(thread.kind),
        rects,
        status: thread.status,
        label: thread.title || annotations.find((annotation) => annotation.body.trim())?.body || thread.kind
      }]
    })
}

export function createTextAnnotationOverlaysFromSidecar(
  sidecar: PdfAnnotationSidecar | null | undefined,
  options: {
    displayMode?: WritePdfAnnotationDisplayMode
    activeThreadId?: string | null
  } = {}
): DocumentTextAnnotationOverlay[] {
  if (!sidecar || options.displayMode === 'hidden') return []
  const activeThreadId = options.activeThreadId?.trim() || null
  return sidecar.threads
    .filter((thread) => shouldShowAnnotationThread(thread, options.displayMode, activeThreadId))
    .flatMap((thread): DocumentTextAnnotationOverlay[] => {
      const anchor = anchorsForThread(sidecar, thread)
        .find((candidate) => candidate.quote.trim())
      const quote = anchor?.quote ?? ''
      if (!quote.trim()) return []
      return [{
        id: thread.id,
        kind: annotationOverlayKind(thread.kind),
        quote,
        ...(anchor?.contextBefore ? { contextBefore: anchor.contextBefore } : {}),
        ...(anchor?.contextAfter ? { contextAfter: anchor.contextAfter } : {}),
        ...(anchor?.textRange ? { textRange: anchor.textRange } : {}),
        status: thread.status,
        label: thread.title || annotationsForThread(sidecar, thread)
          .find((annotation) => annotation.body.trim())?.body || thread.kind
      }]
    })
}

export function createDocumentAnnotationNavigationRequest(
  sidecar: PdfAnnotationSidecar | null | undefined,
  threadId: string,
  requestId: string
): DocumentNavigationRequest | null {
  if (!sidecar) return null
  const thread = sidecar.threads.find((candidate) => candidate.id === threadId)
  if (!thread) return null
  const anchor = anchorsForThread(sidecar, thread)
    .find((candidate) => candidate.rects.length > 0 || candidate.quote.trim())
  if (!anchor) return null
  return {
    requestId,
    threadId,
    quote: anchor.quote,
    ...(anchor.contextBefore ? { contextBefore: anchor.contextBefore } : {}),
    ...(anchor.contextAfter ? { contextAfter: anchor.contextAfter } : {}),
    ...(anchor.textRange ? { textRange: anchor.textRange } : {}),
    ...(anchor.rects[0] ? { pageRect: { ...anchor.rects[0] } } : {})
  }
}

function shouldShowAnnotationThread(
  thread: PdfAnnotationThread,
  displayMode: WritePdfAnnotationDisplayMode | undefined,
  activeThreadId: string | null
): boolean {
  if (displayMode === 'all') return true
  if (!activeThreadId) return true
  return thread.id === activeThreadId
}

function anchorsForThread(sidecar: PdfAnnotationSidecar, thread: PdfAnnotationThread): PdfAnnotationSidecar['anchors'] {
  return sidecar.anchors.filter((anchor) => thread.anchorIds.includes(anchor.id))
}

function annotationsForThread(sidecar: PdfAnnotationSidecar, thread: PdfAnnotationThread): PdfAnnotation[] {
  return sidecar.annotations.filter((annotation) =>
    annotation.threadId === thread.id || thread.annotationIds.includes(annotation.id)
  )
}

function annotationOverlayKind(kind: WorkspacePreviewAnnotationKind): WritePdfAnnotationOverlay['kind'] {
  return kind
}

function annotationAnchorKind(
  selection: DocumentAnnotationSelection,
  rawQuote: string
): NonNullable<NonNullable<WorkspacePreviewAnnotationUpsertTarget['anchor']>['kind']> {
  if (rawQuote) return 'text'
  if (selection.visualImage) return 'image'
  return 'visual'
}

function normalizeAnnotationRects(
  rects: readonly WritePdfSelectionPageRect[] | undefined
): AnnotationRect[] {
  return (rects ?? [])
    .map((rect) => ({
      page: positivePage(rect.page),
      x: clampUnit(rect.x),
      y: clampUnit(rect.y),
      width: clampUnit(rect.width),
      height: clampUnit(rect.height)
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0)
}

function positivePage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value ?? 1))
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function cleanAnnotationText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, maxChars).trimEnd()
}

function clipInlineText(value: string, maxChars: number): string {
  const compact = cleanAnnotationText(value, maxChars)
  if (compact.length <= maxChars) return compact
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}...`
}

function createLocalId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${uuid}`
}
