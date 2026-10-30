import {
  hashPdfAnchorText,
  sanitizePdfAnnotationText,
  stablePdfAnnotationSidecar,
  type PdfAnchor,
  type PdfAnnotation,
  type PdfAnnotationAuthor,
  type PdfAnnotationKind,
  type PdfAnnotationSidecar,
  type PdfAnnotationThread,
  type PdfAnnotationThreadStatus
} from '@shared/pdf-annotations'

export const PDF_ANNOTATION_KIND_VALUES = [
  'highlight',
  'comment',
  'note',
  'translation',
  'question',
  'answer'
] as const satisfies readonly PdfAnnotationKind[]

export const PDF_ANNOTATION_STATUS_VALUES = [
  'open',
  'resolved'
] as const satisfies readonly PdfAnnotationThreadStatus[]

export type PdfAnnotationThreadFilter = {
  kind?: PdfAnnotationKind | 'all'
  kinds?: readonly PdfAnnotationKind[]
  status?: PdfAnnotationThreadStatus | 'all'
  statuses?: readonly PdfAnnotationThreadStatus[]
  page?: number | null
  query?: string
}

export type PdfAnnotationThreadSortKey = 'updatedAt' | 'createdAt' | 'page' | 'kind' | 'status'

export type PdfAnnotationThreadSort = {
  key?: PdfAnnotationThreadSortKey
  direction?: 'asc' | 'desc'
}

export type PdfAnnotationThreadSummary = {
  thread: PdfAnnotationThread
  annotations: PdfAnnotation[]
  anchors: PdfAnchor[]
  firstAnnotation?: PdfAnnotation
  lastAnnotation?: PdfAnnotation
  author?: PdfAnnotationAuthor
  title: string
  preview: string
  quote: string
  kind: PdfAnnotationKind
  status: PdfAnnotationThreadStatus
  pageStart?: number
  pageEnd?: number
  annotationCount: number
  updatedAt: string
  createdAt: string
}

export type CreatePdfAnnotationThreadAnnotationInput = {
  id: string
  anchorId: string
  kind?: PdfAnnotationKind
  body?: string
  authorId?: string
  color?: string
  targetLanguage?: string
  sourceText?: string
  sourceMessageId?: string
  createdAt?: string
  updatedAt?: string
}

export type CreatePdfAnnotationThreadInput = {
  id: string
  kind: PdfAnnotationKind
  anchorIds?: readonly string[]
  annotations?: readonly CreatePdfAnnotationThreadAnnotationInput[]
  status?: PdfAnnotationThreadStatus
  title?: string
  authorId?: string
  sourceQuoteId?: string
  sourceMessageId?: string
  createdAt: string
  updatedAt?: string
}

export type AddPdfAnnotationToThreadInput = {
  id: string
  anchorId?: string
  kind: PdfAnnotationKind
  body?: string
  authorId?: string
  color?: string
  targetLanguage?: string
  sourceText?: string
  sourceMessageId?: string
  createdAt: string
  updatedAt?: string
  resolveThread?: boolean
}

export type UpdatePdfAnnotationThreadInput = {
  kind?: PdfAnnotationKind
  anchorIds?: readonly string[]
  annotationIds?: readonly string[]
  status?: PdfAnnotationThreadStatus
  title?: string
  authorId?: string
  sourceQuoteId?: string
  sourceMessageId?: string
  updatedAt: string
}

export type UpdatePdfAnnotationInput = {
  kind?: PdfAnnotationKind
  body?: string
  authorId?: string
  color?: string
  targetLanguage?: string
  sourceText?: string
  sourceMessageId?: string
  updatedAt: string
}

export type PdfAnnotationContributionMergeConflict = {
  threadId: string
  kept: 'local' | 'incoming'
  localUpdatedAt: string
  incomingUpdatedAt: string
}

export type PdfAnnotationContributionMergeResult = {
  sidecar: PdfAnnotationSidecar
  addedThreadCount: number
  updatedThreadCount: number
  skippedThreadCount: number
  conflicts: PdfAnnotationContributionMergeConflict[]
}

function assertNonEmptyId(id: string, label: string): string {
  const normalized = id.trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

function cleanOptionalText(value: string | undefined, maxChars?: number): string | undefined {
  if (value == null) return undefined
  const cleaned = sanitizePdfAnnotationText(value, maxChars)
  return cleaned || undefined
}

function cleanOptionalValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned || undefined
}

function sortedUniqueIds(values: readonly string[] = []): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
}

function byCreatedThenId(a: Pick<PdfAnnotation, 'createdAt' | 'id'>, b: Pick<PdfAnnotation, 'createdAt' | 'id'>): number {
  return a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
}

function latestIso(values: readonly string[]): string {
  return values.reduce((latest, value) => value.localeCompare(latest) > 0 ? value : latest, values[0] ?? '')
}

function commitPdfAnnotationSidecar(
  sidecar: PdfAnnotationSidecar,
  changes: Partial<Pick<PdfAnnotationSidecar, 'anchors' | 'annotations' | 'threads' | 'authors'>>,
  updatedAt: string
): PdfAnnotationSidecar {
  return stablePdfAnnotationSidecar({
    ...sidecar,
    ...changes,
    version: sidecar.version + 1,
    manifest: {
      ...sidecar.manifest,
      updatedAt
    },
    updatedAt
  })
}

function applyOptionalThreadPatch(
  thread: PdfAnnotationThread,
  patch: UpdatePdfAnnotationThreadInput
): PdfAnnotationThread {
  const next: PdfAnnotationThread = {
    ...thread,
    kind: patch.kind ?? thread.kind,
    anchorIds: patch.anchorIds ? sortedUniqueIds(patch.anchorIds) : thread.anchorIds,
    annotationIds: patch.annotationIds ? sortedUniqueIds(patch.annotationIds) : thread.annotationIds,
    status: patch.status ?? thread.status,
    updatedAt: patch.updatedAt
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    const title = cleanOptionalText(patch.title, 512)
    if (title) next.title = title
    else delete next.title
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'authorId')) {
    const authorId = cleanOptionalValue(patch.authorId)
    if (authorId) next.authorId = authorId
    else delete next.authorId
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceQuoteId')) {
    const sourceQuoteId = cleanOptionalValue(patch.sourceQuoteId)
    if (sourceQuoteId) next.sourceQuoteId = sourceQuoteId
    else delete next.sourceQuoteId
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceMessageId')) {
    const sourceMessageId = cleanOptionalValue(patch.sourceMessageId)
    if (sourceMessageId) next.sourceMessageId = sourceMessageId
    else delete next.sourceMessageId
  }
  return next
}

function applyOptionalAnnotationPatch(
  annotation: PdfAnnotation,
  patch: UpdatePdfAnnotationInput
): PdfAnnotation {
  const next: PdfAnnotation = {
    ...annotation,
    kind: patch.kind ?? annotation.kind,
    updatedAt: patch.updatedAt
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'body')) {
    next.body = sanitizePdfAnnotationText(patch.body ?? '')
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'authorId')) {
    const authorId = cleanOptionalValue(patch.authorId)
    if (authorId) next.authorId = authorId
    else delete next.authorId
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'color')) {
    const color = cleanOptionalValue(patch.color)
    if (color) next.color = color
    else delete next.color
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'targetLanguage')) {
    const targetLanguage = cleanOptionalValue(patch.targetLanguage)
    if (targetLanguage) next.targetLanguage = targetLanguage
    else delete next.targetLanguage
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceText')) {
    const sourceText = cleanOptionalText(patch.sourceText)
    if (sourceText) next.sourceText = sourceText
    else delete next.sourceText
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceMessageId')) {
    const sourceMessageId = cleanOptionalValue(patch.sourceMessageId)
    if (sourceMessageId) next.sourceMessageId = sourceMessageId
    else delete next.sourceMessageId
  }
  return next
}

function backfillVisualAnchorQuote(
  anchor: PdfAnchor,
  annotation: PdfAnnotation,
  updatedAt: string
): PdfAnchor {
  if (anchor.kind === 'text') return anchor
  const body = cleanOptionalText(annotation.body, 4_000)
  if (!body) return anchor
  const currentQuote = cleanOptionalText(anchor.quote, 4_000)
  const sourceText = cleanOptionalText(annotation.sourceText, 4_000)
  if (currentQuote && currentQuote !== sourceText) return anchor
  return {
    ...anchor,
    quote: body,
    textHash: hashPdfAnchorText(body),
    updatedAt
  }
}

export function createPdfAnnotationThread(
  sidecar: PdfAnnotationSidecar,
  input: CreatePdfAnnotationThreadInput
): PdfAnnotationSidecar {
  const threadId = assertNonEmptyId(input.id, 'PDF annotation thread id')
  if (sidecar.threads.some((thread) => thread.id === threadId)) {
    throw new Error(`PDF annotation thread already exists: ${threadId}.`)
  }

  const createdAt = input.createdAt
  const updatedAt = input.updatedAt ?? createdAt
  const annotationInputs = input.annotations ?? []
  const annotationIds = new Set<string>()
  const existingAnnotationIds = new Set(sidecar.annotations.map((annotation) => annotation.id))
  const nextAnnotations = annotationInputs.map((annotationInput) => {
    const id = assertNonEmptyId(annotationInput.id, 'PDF annotation id')
    if (annotationIds.has(id) || existingAnnotationIds.has(id)) {
      throw new Error(`PDF annotation already exists: ${id}.`)
    }
    annotationIds.add(id)
    return {
      id,
      threadId,
      anchorId: assertNonEmptyId(annotationInput.anchorId, 'PDF annotation anchor id'),
      kind: annotationInput.kind ?? input.kind,
      body: sanitizePdfAnnotationText(annotationInput.body ?? ''),
      ...(cleanOptionalValue(annotationInput.authorId) ? { authorId: cleanOptionalValue(annotationInput.authorId) } : {}),
      ...(cleanOptionalValue(annotationInput.color) ? { color: cleanOptionalValue(annotationInput.color) } : {}),
      ...(cleanOptionalValue(annotationInput.targetLanguage) ? { targetLanguage: cleanOptionalValue(annotationInput.targetLanguage) } : {}),
      ...(cleanOptionalText(annotationInput.sourceText) ? { sourceText: cleanOptionalText(annotationInput.sourceText) } : {}),
      ...(cleanOptionalValue(annotationInput.sourceMessageId) ? { sourceMessageId: cleanOptionalValue(annotationInput.sourceMessageId) } : {}),
      createdAt: annotationInput.createdAt ?? createdAt,
      updatedAt: annotationInput.updatedAt ?? updatedAt
    } satisfies PdfAnnotation
  })

  const thread: PdfAnnotationThread = {
    id: threadId,
    kind: input.kind,
    anchorIds: sortedUniqueIds([
      ...(input.anchorIds ?? []),
      ...nextAnnotations.map((annotation) => annotation.anchorId)
    ]),
    annotationIds: sortedUniqueIds(nextAnnotations.map((annotation) => annotation.id)),
    status: input.status ?? 'open',
    ...(cleanOptionalText(input.title, 512) ? { title: cleanOptionalText(input.title, 512) } : {}),
    ...(cleanOptionalValue(input.authorId) ? { authorId: cleanOptionalValue(input.authorId) } : {}),
    ...(cleanOptionalValue(input.sourceQuoteId) ? { sourceQuoteId: cleanOptionalValue(input.sourceQuoteId) } : {}),
    ...(cleanOptionalValue(input.sourceMessageId) ? { sourceMessageId: cleanOptionalValue(input.sourceMessageId) } : {}),
    createdAt,
    updatedAt
  }

  return commitPdfAnnotationSidecar(
    sidecar,
    {
      annotations: [...sidecar.annotations, ...nextAnnotations],
      threads: [...sidecar.threads, thread]
    },
    updatedAt
  )
}

export function updatePdfAnnotationThread(
  sidecar: PdfAnnotationSidecar,
  threadId: string,
  patch: UpdatePdfAnnotationThreadInput
): PdfAnnotationSidecar {
  const normalizedThreadId = assertNonEmptyId(threadId, 'PDF annotation thread id')
  let found = false
  const threads = sidecar.threads.map((thread) => {
    if (thread.id !== normalizedThreadId) return thread
    found = true
    return applyOptionalThreadPatch(thread, patch)
  })
  if (!found) throw new Error(`PDF annotation thread not found: ${normalizedThreadId}.`)
  return commitPdfAnnotationSidecar(sidecar, { threads }, patch.updatedAt)
}

export function resolvePdfAnnotationThread(
  sidecar: PdfAnnotationSidecar,
  threadId: string,
  updatedAt: string
): PdfAnnotationSidecar {
  return updatePdfAnnotationThread(sidecar, threadId, { status: 'resolved', updatedAt })
}

export function reopenPdfAnnotationThread(
  sidecar: PdfAnnotationSidecar,
  threadId: string,
  updatedAt: string
): PdfAnnotationSidecar {
  return updatePdfAnnotationThread(sidecar, threadId, { status: 'open', updatedAt })
}

export function addPdfAnnotationToThread(
  sidecar: PdfAnnotationSidecar,
  threadId: string,
  input: AddPdfAnnotationToThreadInput
): PdfAnnotationSidecar {
  const normalizedThreadId = assertNonEmptyId(threadId, 'PDF annotation thread id')
  const annotationId = assertNonEmptyId(input.id, 'PDF annotation id')
  if (sidecar.annotations.some((annotation) => annotation.id === annotationId)) {
    throw new Error(`PDF annotation already exists: ${annotationId}.`)
  }
  const thread = sidecar.threads.find((item) => item.id === normalizedThreadId)
  if (!thread) throw new Error(`PDF annotation thread not found: ${normalizedThreadId}.`)

  const anchorId = assertNonEmptyId(input.anchorId ?? thread.anchorIds[0] ?? '', 'PDF annotation anchor id')
  if (!thread.anchorIds.includes(anchorId)) {
    throw new Error(`PDF annotation anchor ${anchorId} does not belong to thread ${normalizedThreadId}.`)
  }

  const createdAt = input.createdAt
  const updatedAt = input.updatedAt ?? createdAt
  const annotation: PdfAnnotation = {
    id: annotationId,
    threadId: normalizedThreadId,
    anchorId,
    kind: input.kind,
    body: sanitizePdfAnnotationText(input.body ?? ''),
    ...(cleanOptionalValue(input.authorId) ? { authorId: cleanOptionalValue(input.authorId) } : {}),
    ...(cleanOptionalValue(input.color) ? { color: cleanOptionalValue(input.color) } : {}),
    ...(cleanOptionalValue(input.targetLanguage) ? { targetLanguage: cleanOptionalValue(input.targetLanguage) } : {}),
    ...(cleanOptionalText(input.sourceText) ? { sourceText: cleanOptionalText(input.sourceText) } : {}),
    ...(cleanOptionalValue(input.sourceMessageId) ? { sourceMessageId: cleanOptionalValue(input.sourceMessageId) } : {}),
    createdAt,
    updatedAt
  }

  const threads = sidecar.threads.map((item) =>
    item.id === normalizedThreadId
      ? {
          ...item,
          annotationIds: sortedUniqueIds([...item.annotationIds, annotationId]),
          status: input.resolveThread ? 'resolved' : item.status,
          updatedAt
        }
      : item
  )
  const anchors = sidecar.anchors.map((anchor) =>
    anchor.id === anchorId ? backfillVisualAnchorQuote(anchor, annotation, updatedAt) : anchor
  )
  return commitPdfAnnotationSidecar(
    sidecar,
    {
      anchors,
      annotations: [...sidecar.annotations, annotation],
      threads
    },
    updatedAt
  )
}

export function updatePdfAnnotation(
  sidecar: PdfAnnotationSidecar,
  annotationId: string,
  patch: UpdatePdfAnnotationInput
): PdfAnnotationSidecar {
  const normalizedAnnotationId = assertNonEmptyId(annotationId, 'PDF annotation id')
  let parentThreadId: string | null = null
  const annotations = sidecar.annotations.map((annotation) => {
    if (annotation.id !== normalizedAnnotationId) return annotation
    parentThreadId = annotation.threadId
    return applyOptionalAnnotationPatch(annotation, patch)
  })
  if (!parentThreadId) throw new Error(`PDF annotation not found: ${normalizedAnnotationId}.`)

  const threads = sidecar.threads.map((thread) =>
    thread.id === parentThreadId ? { ...thread, updatedAt: patch.updatedAt } : thread
  )
  return commitPdfAnnotationSidecar(sidecar, { annotations, threads }, patch.updatedAt)
}

export function deletePdfAnnotationThread(
  sidecar: PdfAnnotationSidecar,
  threadId: string,
  options: { updatedAt: string; pruneOrphanAnchors?: boolean }
): PdfAnnotationSidecar {
  const normalizedThreadId = assertNonEmptyId(threadId, 'PDF annotation thread id')
  const thread = sidecar.threads.find((item) => item.id === normalizedThreadId)
  if (!thread) throw new Error(`PDF annotation thread not found: ${normalizedThreadId}.`)

  const deletedAnnotationIds = new Set(thread.annotationIds)
  const threads = sidecar.threads.filter((item) => item.id !== normalizedThreadId)
  const annotations = sidecar.annotations.filter(
    (annotation) => annotation.threadId !== normalizedThreadId && !deletedAnnotationIds.has(annotation.id)
  )
  const remainingAnchorIds = new Set(threads.flatMap((item) => item.anchorIds))
  const deletedAnchorIds = new Set(thread.anchorIds)
  const anchors = options.pruneOrphanAnchors === false
    ? sidecar.anchors
    : sidecar.anchors.filter((anchor) => !deletedAnchorIds.has(anchor.id) || remainingAnchorIds.has(anchor.id))

  return commitPdfAnnotationSidecar(sidecar, { anchors, annotations, threads }, options.updatedAt)
}

export function mergePdfAnnotationContribution(
  local: PdfAnnotationSidecar,
  incoming: PdfAnnotationSidecar,
  options: { updatedAt: string }
): PdfAnnotationContributionMergeResult {
  if (local.pdfFingerprint.sha256 !== incoming.pdfFingerprint.sha256) {
    throw new Error('PDF annotation contribution fingerprint mismatch.')
  }

  const localThreadsById = new Map(local.threads.map((thread) => [thread.id, thread]))
  const selectedIncomingThreadIds = new Set<string>()
  const replacedLocalThreadIds = new Set<string>()
  const conflicts: PdfAnnotationContributionMergeConflict[] = []
  let addedThreadCount = 0
  let updatedThreadCount = 0
  let skippedThreadCount = 0

  for (const incomingThread of incoming.threads) {
    const localThread = localThreadsById.get(incomingThread.id)
    if (!localThread) {
      selectedIncomingThreadIds.add(incomingThread.id)
      addedThreadCount += 1
      continue
    }

    const incomingIsNewer = incomingThread.updatedAt.localeCompare(localThread.updatedAt) > 0
    conflicts.push({
      threadId: incomingThread.id,
      kept: incomingIsNewer ? 'incoming' : 'local',
      localUpdatedAt: localThread.updatedAt,
      incomingUpdatedAt: incomingThread.updatedAt
    })
    if (incomingIsNewer) {
      selectedIncomingThreadIds.add(incomingThread.id)
      replacedLocalThreadIds.add(localThread.id)
      updatedThreadCount += 1
    } else {
      skippedThreadCount += 1
    }
  }

  if (selectedIncomingThreadIds.size === 0) {
    return {
      sidecar: local,
      addedThreadCount,
      updatedThreadCount,
      skippedThreadCount,
      conflicts
    }
  }

  const selectedIncomingThreads = incoming.threads.filter((thread) => selectedIncomingThreadIds.has(thread.id))
  const selectedIncomingAnchorIds = new Set(selectedIncomingThreads.flatMap((thread) => thread.anchorIds))
  const selectedIncomingAnnotationIds = new Set(selectedIncomingThreads.flatMap((thread) => thread.annotationIds))
  const selectedIncomingAnnotations = incoming.annotations.filter((annotation) =>
    selectedIncomingThreadIds.has(annotation.threadId) || selectedIncomingAnnotationIds.has(annotation.id)
  )
  for (const annotation of selectedIncomingAnnotations) {
    selectedIncomingAnnotationIds.add(annotation.id)
    selectedIncomingAnchorIds.add(annotation.anchorId)
  }

  const replacedLocalAnchorIds = new Set(
    local.threads
      .filter((thread) => replacedLocalThreadIds.has(thread.id))
      .flatMap((thread) => thread.anchorIds)
  )
  const remainingLocalAnchorIds = new Set(
    local.threads
      .filter((thread) => !replacedLocalThreadIds.has(thread.id))
      .flatMap((thread) => thread.anchorIds)
  )
  const selectedIncomingAnchors = incoming.anchors.filter((anchor) => selectedIncomingAnchorIds.has(anchor.id))
  const incomingAnchorIds = new Set(selectedIncomingAnchors.map((anchor) => anchor.id))
  const incomingAnnotationIds = new Set(selectedIncomingAnnotations.map((annotation) => annotation.id))
  const authorsById = new Map(local.authors.map((author) => [author.id, author]))
  for (const author of incoming.authors) {
    const existing = authorsById.get(author.id)
    if (!existing || author.updatedAt.localeCompare(existing.updatedAt) > 0) authorsById.set(author.id, author)
  }

  const sidecar = stablePdfAnnotationSidecar({
    ...local,
    version: local.version + 1,
    anchors: [
      ...local.anchors.filter((anchor) =>
        (!replacedLocalAnchorIds.has(anchor.id) || remainingLocalAnchorIds.has(anchor.id)) &&
        !incomingAnchorIds.has(anchor.id)
      ),
      ...selectedIncomingAnchors
    ],
    annotations: [
      ...local.annotations.filter((annotation) =>
        !replacedLocalThreadIds.has(annotation.threadId) &&
        !incomingAnnotationIds.has(annotation.id)
      ),
      ...selectedIncomingAnnotations
    ],
    threads: [
      ...local.threads.filter((thread) => !replacedLocalThreadIds.has(thread.id)),
      ...selectedIncomingThreads
    ],
    authors: Array.from(authorsById.values()),
    manifest: {
      ...local.manifest,
      updatedAt: options.updatedAt
    },
    updatedAt: options.updatedAt
  })

  return {
    sidecar,
    addedThreadCount,
    updatedThreadCount,
    skippedThreadCount,
    conflicts
  }
}

function annotationsForThread(sidecar: PdfAnnotationSidecar, thread: PdfAnnotationThread): PdfAnnotation[] {
  const annotationIds = new Set(thread.annotationIds)
  return sidecar.annotations
    .filter((annotation) => annotation.threadId === thread.id || annotationIds.has(annotation.id))
    .sort(byCreatedThenId)
}

function anchorsForThread(sidecar: PdfAnnotationSidecar, thread: PdfAnnotationThread): PdfAnchor[] {
  const anchorIds = new Set(thread.anchorIds)
  return sidecar.anchors
    .filter((anchor) => anchorIds.has(anchor.id))
    .sort((a, b) => a.pageStart - b.pageStart || a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
}

function authorForThread(
  authors: readonly PdfAnnotationAuthor[],
  thread: PdfAnnotationThread,
  annotations: readonly PdfAnnotation[]
): PdfAnnotationAuthor | undefined {
  const authorId = thread.authorId ?? annotations.find((annotation) => annotation.authorId)?.authorId
  return authorId ? authors.find((author) => author.id === authorId) : undefined
}

function pageRangeForAnchors(anchors: readonly PdfAnchor[]): { pageStart?: number; pageEnd?: number } {
  const pages = anchors.flatMap((anchor) => [
    anchor.pageStart,
    anchor.pageEnd,
    ...anchor.rects.map((rect) => rect.page)
  ]).filter((page) => Number.isFinite(page) && page > 0)
  if (pages.length === 0) return {}
  return {
    pageStart: Math.min(...pages),
    pageEnd: Math.max(...pages)
  }
}

function compactInlineText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clipText(value = '', maxChars = 180): string {
  const compact = compactInlineText(value)
  if (compact.length <= maxChars) return compact
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

export function summarizePdfAnnotationThread(
  sidecar: PdfAnnotationSidecar,
  thread: PdfAnnotationThread
): PdfAnnotationThreadSummary {
  const annotations = annotationsForThread(sidecar, thread)
  const anchors = anchorsForThread(sidecar, thread)
  const firstAnnotation = annotations[0]
  const lastAnnotation = annotations.reduce<PdfAnnotation | undefined>((latest, annotation) => {
    if (!latest) return annotation
    return annotation.updatedAt.localeCompare(latest.updatedAt) > 0 ? annotation : latest
  }, undefined)
  const quote = clipText(anchors.find((anchor) => compactInlineText(anchor.quote))?.quote ?? '', 220)
  const preview = clipText(firstAnnotation?.body || quote, 220)
  const title = cleanOptionalText(thread.title, 512) ??
    clipText(quote || firstAnnotation?.body || thread.kind, 96)
  const updatedAt = latestIso([
    thread.updatedAt,
    ...annotations.map((annotation) => annotation.updatedAt),
    ...anchors.map((anchor) => anchor.updatedAt)
  ])
  return {
    thread,
    annotations,
    anchors,
    firstAnnotation,
    lastAnnotation,
    author: authorForThread(sidecar.authors, thread, annotations),
    title,
    preview,
    quote,
    kind: thread.kind,
    status: thread.status,
    ...pageRangeForAnchors(anchors),
    annotationCount: annotations.length,
    updatedAt,
    createdAt: thread.createdAt
  }
}

function filterValues<T extends string>(single: T | 'all' | undefined, many: readonly T[] | undefined): Set<T> {
  if (many && many.length > 0) return new Set(many)
  if (single && single !== 'all') return new Set([single])
  return new Set()
}

export function matchesPdfAnnotationThreadSummary(
  summary: PdfAnnotationThreadSummary,
  filter: PdfAnnotationThreadFilter = {}
): boolean {
  const kinds = filterValues(filter.kind, filter.kinds)
  if (kinds.size > 0 && !kinds.has(summary.kind)) return false

  const statuses = filterValues(filter.status, filter.statuses)
  if (statuses.size > 0 && !statuses.has(summary.status)) return false

  if (filter.page != null && Number.isFinite(filter.page)) {
    const page = Math.floor(filter.page)
    if (page > 0) {
      if (summary.pageStart == null || summary.pageEnd == null) return false
      if (page < summary.pageStart || page > summary.pageEnd) return false
    }
  }

  const query = compactInlineText(filter.query ?? '').toLocaleLowerCase()
  if (query) {
    const haystack = [
      summary.title,
      summary.preview,
      summary.quote,
      summary.author?.name ?? '',
      ...summary.annotations.map((annotation) => annotation.body)
    ].join('\n').toLocaleLowerCase()
    if (!haystack.includes(query)) return false
  }

  return true
}

function compareString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function compareNumber(a: number | undefined, b: number | undefined): number {
  const left = a ?? Number.POSITIVE_INFINITY
  const right = b ?? Number.POSITIVE_INFINITY
  return left - right
}

function statusRank(status: PdfAnnotationThreadStatus): number {
  return status === 'open' ? 0 : 1
}

export function sortPdfAnnotationThreadSummaries(
  summaries: readonly PdfAnnotationThreadSummary[],
  sort: PdfAnnotationThreadSort = {}
): PdfAnnotationThreadSummary[] {
  const key = sort.key ?? 'updatedAt'
  const direction = sort.direction ?? (key === 'updatedAt' ? 'desc' : 'asc')
  const multiplier = direction === 'asc' ? 1 : -1

  return [...summaries].sort((a, b) => {
    let primary = 0
    if (key === 'page') primary = compareNumber(a.pageStart, b.pageStart)
    else if (key === 'createdAt') primary = compareString(a.createdAt, b.createdAt)
    else if (key === 'kind') primary = compareString(a.kind, b.kind)
    else if (key === 'status') primary = statusRank(a.status) - statusRank(b.status)
    else primary = compareString(a.updatedAt, b.updatedAt)

    if (primary !== 0) return primary * multiplier
    return statusRank(a.status) - statusRank(b.status) ||
      compareNumber(a.pageStart, b.pageStart) ||
      compareString(b.updatedAt, a.updatedAt) ||
      compareString(a.thread.id, b.thread.id)
  })
}

export function getPdfAnnotationThreadSummaries(
  sidecar: PdfAnnotationSidecar,
  options: {
    filter?: PdfAnnotationThreadFilter
    sort?: PdfAnnotationThreadSort
  } = {}
): PdfAnnotationThreadSummary[] {
  return sortPdfAnnotationThreadSummaries(
    sidecar.threads
      .map((thread) => summarizePdfAnnotationThread(sidecar, thread))
      .filter((summary) => matchesPdfAnnotationThreadSummary(summary, options.filter)),
    options.sort
  )
}
