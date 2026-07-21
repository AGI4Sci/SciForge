import { z } from 'zod'

export const PDF_ANNOTATION_SCHEMA_VERSION = 1
export const PDF_ANNOTATION_APP_ID = 'sciforge.pdf-annotations'
export const PDF_ANNOTATION_DEFAULT_DIR = '.sciforge/pdf-annotations'
export const PDF_ANNOTATION_PACKAGE_SUFFIX = '.dsgui-pdf.zip'
export const MAX_PDF_ANCHOR_RECTS = 800
export const MAX_PDF_ANNOTATION_TEXT_CHARS = 80_000

export type PdfAnnotationKind =
  | 'highlight'
  | 'comment'
  | 'note'
  | 'translation'
  | 'question'
  | 'answer'

export type PdfAnchorKind = 'text' | 'image' | 'visual'
export type PdfAnnotationThreadStatus = 'open' | 'resolved'

export type PdfFingerprint = {
  sha256: string
  size: number
  mtimeMs?: number
  pageCount?: number
  fileName?: string
}

export type PdfAnchorRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type PdfAnchorTextRange = {
  start: number
  end: number
  startLine?: number
  startColumn?: number
  endLine?: number
  endColumn?: number
}

export type PdfAnchor = {
  id: string
  kind: PdfAnchorKind
  pageStart: number
  pageEnd: number
  rects: PdfAnchorRect[]
  quote: string
  textHash: string
  contextBefore: string
  contextAfter: string
  textRange?: PdfAnchorTextRange
  pdfFingerprint: PdfFingerprint
  createdAt: string
  updatedAt: string
}

export type PdfAnnotation = {
  id: string
  threadId: string
  anchorId: string
  kind: PdfAnnotationKind
  body: string
  authorId?: string
  color?: string
  targetLanguage?: string
  sourceText?: string
  sourceMessageId?: string
  createdAt: string
  updatedAt: string
}

export type PdfAnnotationThread = {
  id: string
  kind: PdfAnnotationKind
  anchorIds: string[]
  annotationIds: string[]
  status: PdfAnnotationThreadStatus
  title?: string
  authorId?: string
  sourceQuoteId?: string
  sourceMessageId?: string
  createdAt: string
  updatedAt: string
}

export type PdfAnnotationAuthor = {
  id: string
  name: string
  email?: string
  anonymous?: boolean
  createdAt: string
  updatedAt: string
}

export type PdfAnnotationThreadTombstone = {
  threadId: string
  annotationIds: string[]
  anchorIds: string[]
  deletedAt: string
  deletedVersion: number
}

export type PdfAnnotationSidecarManifest = {
  app: typeof PDF_ANNOTATION_APP_ID
  schemaVersion: typeof PDF_ANNOTATION_SCHEMA_VERSION
  sourcePdfName?: string
  sourcePdfPath?: string
  exchangePackage?: string
  privacy: {
    explicitOnly: boolean
    chatTranscriptEmbedded: false
  }
  contribution: {
    reviewableJson: boolean
    mergeKey: 'threadId'
    conflictResolution: 'updatedAt'
  }
  createdAt: string
  updatedAt: string
}

export type PdfAnnotationSidecar = {
  schemaVersion: typeof PDF_ANNOTATION_SCHEMA_VERSION
  version: number
  manifest: PdfAnnotationSidecarManifest
  pdfFingerprint: PdfFingerprint
  anchors: PdfAnchor[]
  annotations: PdfAnnotation[]
  threads: PdfAnnotationThread[]
  authors: PdfAnnotationAuthor[]
  deletedThreads?: PdfAnnotationThreadTombstone[]
  updatedAt: string
}

export type PdfAnchorPageText = {
  page: number
  text: string
}

export type PdfAnchorRelocationResult = {
  strategy: 'text-hash' | 'quote' | 'context' | 'original-rect'
  pageStart: number
  pageEnd: number
  rects: PdfAnchorRect[]
}

export type PdfAnnotationSidecarTarget = {
  pdfPath: string
  workspaceRoot?: string
  pageCount?: number
}

export type PdfAnnotationSidecarLoadResult =
  | {
      ok: true
      sidecar: PdfAnnotationSidecar
      path: string
      source: 'default' | 'empty'
      pdfFingerprint: PdfFingerprint
      warnings: string[]
    }
  | { ok: false; message: string }

export type PdfAnnotationSidecarSavePayload = PdfAnnotationSidecarTarget & {
  sidecar: PdfAnnotationSidecar
}

export type PdfAnnotationSidecarSaveResult =
  | {
      ok: true
      sidecar: PdfAnnotationSidecar
      path: string
      savedAt: string
    }
  | { ok: false; message: string }

export type PdfAnnotationSidecarExportPayload = PdfAnnotationSidecarTarget & {
  sidecar?: PdfAnnotationSidecar
  anonymizeAuthors?: boolean
}

export type PdfAnnotationSidecarExportResult =
  | {
      ok: true
      path: string
      manifest: PdfAnnotationSidecarManifest
      exportedAt: string
    }
  | { ok: false; message: string }

export type PdfAnnotationPdfExportPayload = PdfAnnotationSidecarTarget & {
  sidecar?: PdfAnnotationSidecar
}

export type PdfAnnotationPdfExportResult =
  | {
      ok: true
      path: string
      annotationCount: number
      exportedAt: string
    }
  | { ok: false; message: string }

export type PdfAnnotationSidecarImportPayload = PdfAnnotationSidecarTarget & {
  packagePath?: string
  packageBase64?: string
  attemptRelocation?: boolean
}

export type PdfAnnotationSidecarImportResult =
  | {
      ok: true
      sidecar: PdfAnnotationSidecar
      path: string
      importedAt: string
      pdfFingerprint: PdfFingerprint
      fingerprintMatched: boolean
      warnings: string[]
    }
  | { ok: false; message: string }

const isoDateSchema = z.string().trim().min(1).max(128)
const idSchema = z.string().trim().min(1).max(256)
const boundedTextSchema = z.string().max(MAX_PDF_ANNOTATION_TEXT_CHARS)
const optionalBoundedTextSchema = z.string().max(MAX_PDF_ANNOTATION_TEXT_CHARS).optional()

export const pdfFingerprintSchema = z
  .object({
    sha256: z.string().trim().min(1).max(128),
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().finite().nonnegative().optional(),
    pageCount: z.number().int().positive().max(1_000_000).optional(),
    fileName: z.string().trim().max(512).optional()
  })
  .strict()

export const pdfAnchorRectSchema = z
  .object({
    page: z.number().int().positive().max(1_000_000),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1)
  })
  .strict()

export const pdfAnchorTextRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    startLine: z.number().int().positive().optional(),
    startColumn: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    endColumn: z.number().int().positive().optional()
  })
  .strict()
  .refine((range) => range.end >= range.start, {
    message: 'Annotation text range end must be greater than or equal to start.'
  })

export const pdfAnchorSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['text', 'image', 'visual']),
    pageStart: z.number().int().positive().max(1_000_000),
    pageEnd: z.number().int().positive().max(1_000_000),
    rects: z.array(pdfAnchorRectSchema).max(MAX_PDF_ANCHOR_RECTS),
    quote: boundedTextSchema,
    textHash: z.string().trim().max(128),
    contextBefore: boundedTextSchema,
    contextAfter: boundedTextSchema,
    textRange: pdfAnchorTextRangeSchema.optional(),
    pdfFingerprint: pdfFingerprintSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  })
  .strict()

export const pdfAnnotationSchema = z
  .object({
    id: idSchema,
    threadId: idSchema,
    anchorId: idSchema,
    kind: z.enum(['highlight', 'comment', 'note', 'translation', 'question', 'answer']),
    body: boundedTextSchema,
    authorId: idSchema.optional(),
    color: z.string().trim().max(64).optional(),
    targetLanguage: z.string().trim().max(128).optional(),
    sourceText: optionalBoundedTextSchema,
    sourceMessageId: idSchema.optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  })
  .strict()

export const pdfAnnotationThreadSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['highlight', 'comment', 'note', 'translation', 'question', 'answer']),
    anchorIds: z.array(idSchema).max(1_000),
    annotationIds: z.array(idSchema).max(2_000),
    status: z.enum(['open', 'resolved']),
    title: z.string().trim().max(512).optional(),
    authorId: idSchema.optional(),
    sourceQuoteId: idSchema.optional(),
    sourceMessageId: idSchema.optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  })
  .strict()

export const pdfAnnotationAuthorSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(512),
    email: z.string().trim().max(512).optional(),
    anonymous: z.boolean().optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  })
  .strict()

export const pdfAnnotationThreadTombstoneSchema = z
  .object({
    threadId: idSchema,
    annotationIds: z.array(idSchema).max(2_000),
    anchorIds: z.array(idSchema).max(1_000),
    deletedAt: isoDateSchema,
    deletedVersion: z.number().int().nonnegative()
  })
  .strict()

export const pdfAnnotationSidecarManifestSchema = z
  .object({
    app: z.literal(PDF_ANNOTATION_APP_ID),
    schemaVersion: z.literal(PDF_ANNOTATION_SCHEMA_VERSION),
    sourcePdfName: z.string().trim().max(512).optional(),
    sourcePdfPath: z.string().trim().max(4_096).optional(),
    exchangePackage: z.string().trim().max(512).optional(),
    privacy: z
      .object({
        explicitOnly: z.literal(true),
        chatTranscriptEmbedded: z.literal(false)
      })
      .strict(),
    contribution: z
      .object({
        reviewableJson: z.literal(true),
        mergeKey: z.literal('threadId'),
        conflictResolution: z.literal('updatedAt')
      })
      .strict(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  })
  .strict()

export const pdfAnnotationSidecarSchema = z
  .object({
    schemaVersion: z.literal(PDF_ANNOTATION_SCHEMA_VERSION),
    version: z.number().int().nonnegative(),
    manifest: pdfAnnotationSidecarManifestSchema,
    pdfFingerprint: pdfFingerprintSchema,
    anchors: z.array(pdfAnchorSchema).max(10_000),
    annotations: z.array(pdfAnnotationSchema).max(20_000),
    threads: z.array(pdfAnnotationThreadSchema).max(10_000),
    authors: z.array(pdfAnnotationAuthorSchema).max(1_000),
    deletedThreads: z.array(pdfAnnotationThreadTombstoneSchema).max(10_000).optional(),
    updatedAt: isoDateSchema
  })
  .strict()

export const pdfAnnotationSidecarTargetSchema = z
  .object({
    pdfPath: z.string().trim().min(1).max(4_096),
    workspaceRoot: z.string().trim().max(4_096).optional(),
    pageCount: z.number().int().positive().max(1_000_000).optional()
  })
  .strict()

export const pdfAnnotationSidecarSavePayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    sidecar: pdfAnnotationSidecarSchema
  })
  .strict()

export const pdfAnnotationSidecarExportPayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    sidecar: pdfAnnotationSidecarSchema.optional(),
    anonymizeAuthors: z.boolean().optional()
  })
  .strict()

export const pdfAnnotationPdfExportPayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    sidecar: pdfAnnotationSidecarSchema.optional()
  })
  .strict()

export const pdfAnnotationSidecarImportPayloadSchema = pdfAnnotationSidecarTargetSchema
  .extend({
    packagePath: z.string().trim().max(4_096).optional(),
    packageBase64: z.string().max(160_000_000).optional(),
    attemptRelocation: z.boolean().optional()
  })
  .refine((payload) => Boolean(payload.packagePath?.trim() || payload.packageBase64?.trim()), {
    message: 'PDF annotation package path or base64 content is required.'
  })
  .strict()

function cleanText(value: string, maxChars = MAX_PDF_ANNOTATION_TEXT_CHARS): string {
  const normalized = String(value ?? '').replace(/\r\n?/g, '\n')
  let out = ''
  for (let index = 0; index < normalized.length && out.length < maxChars; index += 1) {
    const code = normalized.charCodeAt(index)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) out += normalized[index]
  }
  return out
}

export function sanitizePdfAnnotationText(value: string, maxChars = MAX_PDF_ANNOTATION_TEXT_CHARS): string {
  return cleanText(value, maxChars).trim()
}

export function normalizePdfQuote(value: string): string {
  return cleanText(value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function hashPdfAnchorText(value: string): string {
  return `fnv1a32:${fnv1a32(normalizePdfQuote(value))}`
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
}

function byUpdatedThenId(a: { updatedAt: string; id: string }, b: { updatedAt: string; id: string }): number {
  return a.updatedAt.localeCompare(b.updatedAt) || byId(a, b)
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

export function stablePdfAnnotationSidecar(sidecar: PdfAnnotationSidecar): PdfAnnotationSidecar {
  const deletedThreadsById = new Map<string, PdfAnnotationThreadTombstone>()
  for (const tombstone of sidecar.deletedThreads ?? []) {
    const normalized: PdfAnnotationThreadTombstone = {
      ...tombstone,
      annotationIds: sortedUnique(tombstone.annotationIds),
      anchorIds: sortedUnique(tombstone.anchorIds)
    }
    const existing = deletedThreadsById.get(normalized.threadId)
    if (!existing || normalized.deletedVersion > existing.deletedVersion || (
      normalized.deletedVersion === existing.deletedVersion &&
      normalized.deletedAt.localeCompare(existing.deletedAt) > 0
    )) {
      deletedThreadsById.set(normalized.threadId, normalized)
    }
  }
  const deletedThreads = [...deletedThreadsById.values()]
    .sort((a, b) => a.deletedAt.localeCompare(b.deletedAt) || a.threadId.localeCompare(b.threadId))
  const deletedThreadIds = new Set(deletedThreads.map((tombstone) => tombstone.threadId))
  const deletedAnnotationIds = new Set(deletedThreads.flatMap((tombstone) => tombstone.annotationIds))
  const deletedAnchorIds = new Set(deletedThreads.flatMap((tombstone) => tombstone.anchorIds))
  const threads = sidecar.threads.filter((thread) => !deletedThreadIds.has(thread.id))
  const annotations = sidecar.annotations.filter((annotation) =>
    !deletedThreadIds.has(annotation.threadId) && !deletedAnnotationIds.has(annotation.id)
  )
  const retainedAnchorIds = new Set([
    ...threads.flatMap((thread) => thread.anchorIds),
    ...annotations.map((annotation) => annotation.anchorId)
  ])
  return {
    ...sidecar,
    anchors: sidecar.anchors
      .filter((anchor) => !deletedAnchorIds.has(anchor.id) || retainedAnchorIds.has(anchor.id))
      .sort((a, b) => a.pageStart - b.pageStart || byId(a, b)),
    annotations: annotations.sort((a, b) => a.threadId.localeCompare(b.threadId) || byUpdatedThenId(a, b)),
    threads: threads
      .map((thread) => ({
        ...thread,
        anchorIds: sortedUnique(thread.anchorIds),
        annotationIds: sortedUnique(thread.annotationIds)
      }))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || byId(a, b)),
    authors: [...sidecar.authors].sort(byId),
    deletedThreads
  }
}

export function createEmptyPdfAnnotationSidecar(
  pdfFingerprint: PdfFingerprint,
  options: {
    sourcePdfName?: string
    sourcePdfPath?: string
    now?: string
  } = {}
): PdfAnnotationSidecar {
  const now = options.now ?? new Date().toISOString()
  return {
    schemaVersion: PDF_ANNOTATION_SCHEMA_VERSION,
    version: 0,
    manifest: {
      app: PDF_ANNOTATION_APP_ID,
      schemaVersion: PDF_ANNOTATION_SCHEMA_VERSION,
      ...(options.sourcePdfName ? { sourcePdfName: options.sourcePdfName } : {}),
      ...(options.sourcePdfPath ? { sourcePdfPath: options.sourcePdfPath } : {}),
      privacy: {
        explicitOnly: true,
        chatTranscriptEmbedded: false
      },
      contribution: {
        reviewableJson: true,
        mergeKey: 'threadId',
        conflictResolution: 'updatedAt'
      },
      createdAt: now,
      updatedAt: now
    },
    pdfFingerprint,
    anchors: [],
    annotations: [],
    threads: [],
    authors: [],
    deletedThreads: [],
    updatedAt: now
  }
}

function withV1Defaults(raw: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString()
  const fingerprint = raw.pdfFingerprint && typeof raw.pdfFingerprint === 'object'
    ? raw.pdfFingerprint as Record<string, unknown>
    : { sha256: 'unknown', size: 0 }
  const manifest = raw.manifest && typeof raw.manifest === 'object'
    ? raw.manifest as Record<string, unknown>
    : {}
  const annotations = Array.isArray(raw.annotations)
    ? raw.annotations.map((annotation) => {
        if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) return annotation
        const { pdfFingerprint: _legacyPdfFingerprint, ...normalized } = annotation as Record<string, unknown>
        return normalized
      })
    : []
  return {
    schemaVersion: PDF_ANNOTATION_SCHEMA_VERSION,
    version: typeof raw.version === 'number' ? raw.version : 0,
    ...raw,
    pdfFingerprint: fingerprint,
    anchors: Array.isArray(raw.anchors) ? raw.anchors : [],
    annotations,
    threads: Array.isArray(raw.threads) ? raw.threads : [],
    authors: Array.isArray(raw.authors) ? raw.authors : [],
    deletedThreads: Array.isArray(raw.deletedThreads) ? raw.deletedThreads : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    manifest: {
      app: PDF_ANNOTATION_APP_ID,
      schemaVersion: PDF_ANNOTATION_SCHEMA_VERSION,
      privacy: {
        explicitOnly: true,
        chatTranscriptEmbedded: false
      },
      contribution: {
        reviewableJson: true,
        mergeKey: 'threadId',
        conflictResolution: 'updatedAt'
      },
      createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : now,
      updatedAt: typeof manifest.updatedAt === 'string' ? manifest.updatedAt : typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
      ...manifest
    }
  }
}

export function migratePdfAnnotationSidecar(raw: unknown): PdfAnnotationSidecar {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('PDF annotation sidecar must be a JSON object.')
  }
  const record = raw as Record<string, unknown>
  const schemaVersion = typeof record.schemaVersion === 'number'
    ? record.schemaVersion
    : typeof record.manifest === 'object' && record.manifest && 'schemaVersion' in record.manifest
      ? Number((record.manifest as { schemaVersion?: unknown }).schemaVersion)
      : PDF_ANNOTATION_SCHEMA_VERSION
  if (schemaVersion > PDF_ANNOTATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported PDF annotation schema version: ${schemaVersion}.`)
  }
  const parsed = pdfAnnotationSidecarSchema.safeParse(withV1Defaults(record))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid PDF annotation sidecar: ${issue?.message ?? 'Bad schema.'}`)
  }
  return stablePdfAnnotationSidecar(parsed.data)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function normalizePdfAnchorRects(
  rects: PdfAnchorRect[],
  maxRects = MAX_PDF_ANCHOR_RECTS
): PdfAnchorRect[] {
  const out: PdfAnchorRect[] = []
  for (const rect of rects) {
    if (out.length >= maxRects) break
    const page = Math.floor(rect.page)
    const width = clamp01(rect.width)
    const height = clamp01(rect.height)
    if (!Number.isFinite(page) || page <= 0 || !positiveFinite(width) || !positiveFinite(height)) continue
    const x = clamp01(rect.x)
    const y = clamp01(rect.y)
    out.push({
      page,
      x: Math.min(x, Math.max(0, 1 - width)),
      y: Math.min(y, Math.max(0, 1 - height)),
      width: Math.min(width, 1),
      height: Math.min(height, 1)
    })
  }
  return out
}

export function pdfAnchorPageRange(rects: PdfAnchorRect[], fallbackPage = 1): { pageStart: number; pageEnd: number } {
  const pages = rects
    .map((rect) => Math.floor(rect.page))
    .filter((page) => Number.isFinite(page) && page > 0)
  if (pages.length === 0) return { pageStart: fallbackPage, pageEnd: fallbackPage }
  return { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) }
}

export function createPdfAnchor(input: {
  id: string
  kind?: PdfAnchorKind
  rects: PdfAnchorRect[]
  quote?: string
  contextBefore?: string
  contextAfter?: string
  textRange?: PdfAnchorTextRange
  pdfFingerprint: PdfFingerprint
  createdAt?: string
  updatedAt?: string
}): PdfAnchor {
  const rects = normalizePdfAnchorRects(input.rects)
  const pageRange = pdfAnchorPageRange(rects)
  const quote = sanitizePdfAnnotationText(input.quote ?? '')
  const createdAt = input.createdAt ?? new Date().toISOString()
  const textRange = input.textRange
    ? pdfAnchorTextRangeSchema.parse(input.textRange)
    : undefined
  return {
    id: input.id,
    kind: input.kind ?? (quote ? 'text' : 'visual'),
    ...pageRange,
    rects,
    quote,
    textHash: quote ? hashPdfAnchorText(quote) : '',
    contextBefore: sanitizePdfAnnotationText(input.contextBefore ?? '', 2_000),
    contextAfter: sanitizePdfAnnotationText(input.contextAfter ?? '', 2_000),
    ...(textRange ? { textRange } : {}),
    pdfFingerprint: input.pdfFingerprint,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt
  }
}

function pageTextsInRange(anchor: PdfAnchor, pages: PdfAnchorPageText[]): PdfAnchorPageText[] {
  return pages
    .filter((page) => page.page >= anchor.pageStart && page.page <= anchor.pageEnd)
    .sort((a, b) => a.page - b.page)
}

function matchPageByQuote(quote: string, pages: PdfAnchorPageText[]): number | null {
  if (!quote) return null
  const normalizedQuote = normalizePdfQuote(quote)
  for (const page of pages) {
    if (normalizePdfQuote(page.text).includes(normalizedQuote)) return page.page
  }
  return null
}

function matchPageByContext(anchor: PdfAnchor, pages: PdfAnchorPageText[]): number | null {
  const before = normalizePdfQuote(anchor.contextBefore)
  const after = normalizePdfQuote(anchor.contextAfter)
  if (!before && !after) return null
  for (const page of pages) {
    const text = normalizePdfQuote(page.text)
    const beforeOk = !before || text.includes(before)
    const afterOk = !after || text.includes(after)
    if (beforeOk && afterOk) return page.page
  }
  return null
}

export function relocatePdfAnchor(anchor: PdfAnchor, pages: PdfAnchorPageText[]): PdfAnchorRelocationResult {
  const scopedPages = pageTextsInRange(anchor, pages)
  const allPages = [...pages].sort((a, b) => a.page - b.page)
  const searchGroups = scopedPages.length > 0 ? [scopedPages, allPages] : [allPages]
  const quote = normalizePdfQuote(anchor.quote)
  const expectedHash = anchor.textHash || (quote ? hashPdfAnchorText(quote) : '')
  if (quote && expectedHash) {
    for (const group of searchGroups) {
      for (const page of group) {
        const text = normalizePdfQuote(page.text)
        if (hashPdfAnchorText(text) === expectedHash || hashPdfAnchorText(quote) === expectedHash && text.includes(quote)) {
          return { strategy: 'text-hash', pageStart: page.page, pageEnd: page.page, rects: anchor.rects }
        }
      }
    }
  }

  for (const group of searchGroups) {
    const quotePage = matchPageByQuote(anchor.quote, group)
    if (quotePage != null) {
      return { strategy: 'quote', pageStart: quotePage, pageEnd: quotePage, rects: anchor.rects }
    }
  }

  for (const group of searchGroups) {
    const contextPage = matchPageByContext(anchor, group)
    if (contextPage != null) {
      return { strategy: 'context', pageStart: contextPage, pageEnd: contextPage, rects: anchor.rects }
    }
  }

  return {
    strategy: 'original-rect',
    pageStart: anchor.pageStart,
    pageEnd: anchor.pageEnd,
    rects: anchor.rects
  }
}
