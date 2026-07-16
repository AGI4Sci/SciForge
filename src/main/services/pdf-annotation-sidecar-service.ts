import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import JSZip from 'jszip'
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFPage
} from 'pdf-lib'
import {
  PDF_ANNOTATION_DEFAULT_DIR,
  PDF_ANNOTATION_PACKAGE_SUFFIX,
  createEmptyPdfAnnotationSidecar,
  migratePdfAnnotationSidecar,
  pdfAnnotationSidecarSchema,
  stablePdfAnnotationSidecar,
  type PdfAnchor,
  type PdfAnnotation,
  type PdfAnnotationAuthor,
  type PdfAnnotationPdfExportPayload,
  type PdfAnnotationPdfExportResult,
  type PdfAnnotationSidecar,
  type PdfAnnotationSidecarExportPayload,
  type PdfAnnotationSidecarExportResult,
  type PdfAnnotationSidecarImportPayload,
  type PdfAnnotationSidecarImportResult,
  type PdfAnnotationSidecarLoadResult,
  type PdfAnnotationSidecarSavePayload,
  type PdfAnnotationSidecarSaveResult,
  type PdfAnnotationSidecarTarget,
  type PdfFingerprint
} from '../../shared/pdf-annotations'
import {
  canonicalPath,
  expandHomePath,
  pathExists,
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget,
  type ResolvedWorkspaceWriteTarget,
  writeSafeWorkspaceFile
} from './workspace-paths'

const MAX_SIDECAR_JSON_BYTES = 16 * 1024 * 1024
const MAX_IMPORT_PACKAGE_BYTES = 160 * 1024 * 1024
const MAX_SIDECAR_PROMOTION_CANDIDATES = 200
const sidecarMutationQueues = new Map<string, Promise<void>>()

type ResolvedPdfTarget = {
  pdfPath: string
  workspaceRoot?: string
  sidecarRoot: string
  defaultSidecarTarget: ResolvedWorkspaceWriteTarget
  defaultSidecarPath: string
  exportPackageTarget: ResolvedWorkspaceWriteTarget
  exportPackagePath: string
  exportPdfTarget: ResolvedWorkspaceWriteTarget
  exportPdfPath: string
  fingerprint: PdfFingerprint
}

type PdfAnnotationLoadCandidate = {
  path: string
  sidecar: PdfAnnotationSidecar
  currentFingerprint: boolean
  updatedAt: string
}

type ResolvePdfAnnotationTargetOptions = {
  createDefaultSidecarParents?: boolean
  createExportPackageParents?: boolean
  createExportPdfParents?: boolean
}

function normalizeWorkspaceRoot(workspaceRoot: string | undefined): string | undefined {
  const value = workspaceRoot?.trim()
  if (!value) return undefined
  return expandHomePath(value)
}

function withoutPdfExtension(name: string): string {
  return extname(name).toLowerCase() === '.pdf' ? name.slice(0, -4) : name
}

function normalizeDocumentIdentityPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function pdfDocumentIdentityPath(pdfPath: string, sidecarRoot: string): string {
  const relativePath = relative(sidecarRoot, pdfPath)
  if (relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath)) {
    return normalizeDocumentIdentityPath(relativePath)
  }
  return normalizeDocumentIdentityPath(pdfPath)
}

function pdfDocumentIdentityKey(pdfPath: string, sidecarRoot: string): string {
  return createHash('sha256')
    .update(pdfDocumentIdentityPath(pdfPath, sidecarRoot))
    .digest('hex')
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function fingerprintPdf(path: string, pageCount?: number): Promise<PdfFingerprint> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('PDF annotation target must be a file.')
  return {
    sha256: await sha256File(path),
    size: info.size,
    mtimeMs: info.mtimeMs,
    ...(pageCount ? { pageCount } : {}),
    fileName: basename(path)
  }
}

async function resolvePdfAnnotationTarget(
  target: PdfAnnotationSidecarTarget,
  options?: ResolvePdfAnnotationTargetOptions
): Promise<ResolvedPdfTarget> {
  const workspaceRoot = normalizeWorkspaceRoot(target.workspaceRoot)
  const pdfPath = await resolveOpenTargetPath(target.pdfPath, workspaceRoot)
  const fingerprint = await fingerprintPdf(pdfPath, target.pageCount)
  const sidecarRoot = workspaceRoot
    ? await canonicalPath(workspaceRoot)
    : dirname(pdfPath)
  const defaultSidecarTarget = await resolveSafeWorkspaceWriteTarget(
    join(PDF_ANNOTATION_DEFAULT_DIR, `${pdfDocumentIdentityKey(pdfPath, sidecarRoot)}.json`),
    sidecarRoot,
    { createParentDirectories: options?.createDefaultSidecarParents ?? false }
  )
  const exportPackageTarget = await resolveSafeWorkspaceWriteTarget(
    `${withoutPdfExtension(basename(pdfPath))}${PDF_ANNOTATION_PACKAGE_SUFFIX}`,
    sidecarRoot,
    { createParentDirectories: options?.createExportPackageParents ?? false }
  )
  const exportPdfTarget = await resolveSafeWorkspaceWriteTarget(
    `${withoutPdfExtension(basename(pdfPath))}.annotated.pdf`,
    sidecarRoot,
    { createParentDirectories: options?.createExportPdfParents ?? false }
  )
  return {
    pdfPath,
    workspaceRoot,
    sidecarRoot,
    defaultSidecarTarget,
    defaultSidecarPath: defaultSidecarTarget.path,
    exportPackageTarget,
    exportPackagePath: exportPackageTarget.path,
    exportPdfTarget,
    exportPdfPath: exportPdfTarget.path,
    fingerprint
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  const info = await stat(path)
  if (info.size > MAX_SIDECAR_JSON_BYTES) {
    throw new Error('PDF annotation sidecar is too large.')
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function writeJsonFile(target: ResolvedWorkspaceWriteTarget, value: unknown): Promise<void> {
  const tmpTarget = await resolveSafeWorkspaceWriteTarget(
    join(target.parentPath, `${basename(target.path)}.tmp-${process.pid}-${randomUUID()}`),
    target.workspaceRoot,
    { createParentDirectories: false }
  )
  const content = `${JSON.stringify(value, null, 2)}\n`
  await writeSafeWorkspaceFile(tmpTarget, content, { encoding: 'utf8', exclusive: true })
  try {
    await resolveSafeWorkspaceWriteTarget(target.path, target.workspaceRoot, {
      createParentDirectories: false
    })
    await rename(tmpTarget.path, target.path)
  } catch (error) {
    await rm(tmpTarget.path, { force: true })
    throw error
  }
}

async function withSidecarMutationLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = sidecarMutationQueues.get(path) ?? Promise.resolve()
  let release!: () => void
  const turn = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.catch(() => undefined).then(() => turn)
  sidecarMutationQueues.set(path, queued)
  await previous.catch(() => undefined)
  try {
    return await work()
  } finally {
    release()
    if (sidecarMutationQueues.get(path) === queued) sidecarMutationQueues.delete(path)
  }
}

function mergeUpdatedRecords<T extends { id: string; updatedAt: string }>(
  current: readonly T[],
  incoming: readonly T[]
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    const existing = byId.get(item.id)
    if (!existing || item.updatedAt.localeCompare(existing.updatedAt) >= 0) byId.set(item.id, item)
  }
  return [...byId.values()]
}

function inferredThreadDeletions(
  current: PdfAnnotationSidecar,
  incoming: PdfAnnotationSidecar,
  now: string
): NonNullable<PdfAnnotationSidecar['deletedThreads']> {
  if (incoming.version !== current.version) return []
  const incomingThreadIds = new Set(incoming.threads.map((thread) => thread.id))
  return current.threads
    .filter((thread) => !incomingThreadIds.has(thread.id))
    .map((thread) => ({
      threadId: thread.id,
      annotationIds: Array.from(new Set([
        ...thread.annotationIds,
        ...current.annotations
          .filter((annotation) => annotation.threadId === thread.id)
          .map((annotation) => annotation.id)
      ])),
      anchorIds: Array.from(new Set([
        ...thread.anchorIds,
        ...current.annotations
          .filter((annotation) => annotation.threadId === thread.id)
          .map((annotation) => annotation.anchorId)
      ])),
      deletedAt: incoming.updatedAt || now,
      deletedVersion: current.version + 1
    }))
}

function mergeSidecarsForSave(
  current: PdfAnnotationSidecar,
  incoming: PdfAnnotationSidecar,
  target: ResolvedPdfTarget,
  now: string
): PdfAnnotationSidecar {
  return stablePdfAnnotationSidecar({
    ...current,
    pdfFingerprint: target.fingerprint,
    anchors: mergeUpdatedRecords(current.anchors, incoming.anchors),
    annotations: mergeUpdatedRecords(current.annotations, incoming.annotations),
    threads: mergeUpdatedRecords(current.threads, incoming.threads),
    authors: mergeUpdatedRecords(current.authors, incoming.authors),
    deletedThreads: [
      ...(current.deletedThreads ?? []),
      ...(incoming.deletedThreads ?? []),
      ...inferredThreadDeletions(current, incoming, now)
    ],
    manifest: {
      ...current.manifest,
      ...incoming.manifest,
      sourcePdfName: basename(target.pdfPath),
      sourcePdfPath: target.pdfPath,
      createdAt: current.manifest.createdAt,
      updatedAt: now
    },
    version: Math.max(current.version, incoming.version) + 1,
    updatedAt: now
  })
}

function withResolvedFingerprint(sidecar: PdfAnnotationSidecar, target: ResolvedPdfTarget): PdfAnnotationSidecar {
  return stablePdfAnnotationSidecar({
    ...sidecar,
    schemaVersion: 1,
    pdfFingerprint: target.fingerprint,
    manifest: {
      ...sidecar.manifest,
      sourcePdfName: basename(target.pdfPath),
      sourcePdfPath: target.pdfPath,
      updatedAt: sidecar.updatedAt
    }
  })
}

function hasPdfAnnotationContent(sidecar: PdfAnnotationSidecar): boolean {
  return sidecar.anchors.length > 0 || sidecar.annotations.length > 0 || sidecar.threads.length > 0
}

function isPdfAnnotationSidecarForTarget(sidecar: PdfAnnotationSidecar, resolved: ResolvedPdfTarget): boolean {
  const sourcePath = sidecar.manifest.sourcePdfPath?.trim()
  return sourcePath === resolved.pdfPath || sidecar.pdfFingerprint.sha256 === resolved.fingerprint.sha256
}

async function readPdfAnnotationSidecar(path: string): Promise<PdfAnnotationSidecar> {
  return migratePdfAnnotationSidecar(await readJsonFile(path))
}

async function matchingPdfAnnotationSidecarCandidates(
  resolved: ResolvedPdfTarget,
  warnings: string[]
): Promise<PdfAnnotationLoadCandidate[]> {
  const sidecarDirectory = join(resolved.sidecarRoot, PDF_ANNOTATION_DEFAULT_DIR)
  let entries: string[]
  try {
    entries = await readdir(sidecarDirectory)
  } catch {
    return []
  }
  const out: PdfAnnotationLoadCandidate[] = []
  const candidateEntries = entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .slice(0, MAX_SIDECAR_PROMOTION_CANDIDATES)
  for (const entry of candidateEntries) {
    const candidatePath = join(sidecarDirectory, entry)
    if (candidatePath === resolved.defaultSidecarPath) continue
    try {
      const rawSidecar = await readPdfAnnotationSidecar(candidatePath)
      if (!hasPdfAnnotationContent(rawSidecar)) continue
      if (!isPdfAnnotationSidecarForTarget(rawSidecar, resolved)) continue
      out.push({
        path: candidatePath,
        sidecar: withResolvedFingerprint(rawSidecar, resolved),
        currentFingerprint: rawSidecar.pdfFingerprint.sha256 === resolved.fingerprint.sha256,
        updatedAt: rawSidecar.updatedAt || rawSidecar.manifest.updatedAt
      })
    } catch (error) {
      warnings.push(`annotation sidecar skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return out.sort((a, b) =>
    Number(b.currentFingerprint) - Number(a.currentFingerprint) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.path.localeCompare(b.path)
  )
}

export async function loadPdfAnnotationSidecar(
  target: PdfAnnotationSidecarTarget
): Promise<PdfAnnotationSidecarLoadResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(target)
    const warnings: string[] = []
    let emptyDefaultSidecar: PdfAnnotationSidecar | undefined
    if (await pathExists(resolved.defaultSidecarPath)) {
      try {
        const sidecar = withResolvedFingerprint(await readPdfAnnotationSidecar(resolved.defaultSidecarPath), resolved)
        if (hasPdfAnnotationContent(sidecar) || (sidecar.deletedThreads?.length ?? 0) > 0) {
          return {
            ok: true,
            sidecar,
            path: resolved.defaultSidecarPath,
            source: 'default',
            pdfFingerprint: resolved.fingerprint,
            warnings
          }
        }
        emptyDefaultSidecar = sidecar
      } catch (error) {
        warnings.push(`annotation sidecar skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const promotedCandidate = (await matchingPdfAnnotationSidecarCandidates(resolved, warnings))[0]
    if (promotedCandidate) {
      const writableResolved = await resolvePdfAnnotationTarget(target, { createDefaultSidecarParents: true })
      const sidecar = withResolvedFingerprint(promotedCandidate.sidecar, writableResolved)
      const parsed = pdfAnnotationSidecarSchema.parse(sidecar)
      await writeJsonFile(writableResolved.defaultSidecarTarget, parsed)
      return {
        ok: true,
        sidecar: parsed,
        path: writableResolved.defaultSidecarPath,
        source: 'default',
        pdfFingerprint: writableResolved.fingerprint,
        warnings
      }
    }

    return {
      ok: true,
      sidecar: emptyDefaultSidecar ?? createEmptyPdfAnnotationSidecar(resolved.fingerprint, {
          sourcePdfName: basename(resolved.pdfPath),
          sourcePdfPath: resolved.pdfPath
        }),
      path: resolved.defaultSidecarPath,
      source: emptyDefaultSidecar ? 'default' : 'empty',
      pdfFingerprint: resolved.fingerprint,
      warnings
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function savePdfAnnotationSidecar(
  payload: PdfAnnotationSidecarSavePayload
): Promise<PdfAnnotationSidecarSaveResult> {
  try {
    const target = await resolvePdfAnnotationTarget(payload)
    return await withSidecarMutationLock(target.defaultSidecarPath, async () => {
      const resolved = await resolvePdfAnnotationTarget(payload, { createDefaultSidecarParents: true })
      const now = new Date().toISOString()
      let current: PdfAnnotationSidecar | undefined
      if (await pathExists(resolved.defaultSidecarPath)) {
        current = withResolvedFingerprint(await readPdfAnnotationSidecar(resolved.defaultSidecarPath), resolved)
      }
      const sidecar = current
        ? mergeSidecarsForSave(current, payload.sidecar, resolved, now)
        : stablePdfAnnotationSidecar({
            ...withResolvedFingerprint(payload.sidecar, resolved),
            version: payload.sidecar.version + 1,
            updatedAt: now,
            manifest: {
              ...payload.sidecar.manifest,
              sourcePdfName: basename(resolved.pdfPath),
              sourcePdfPath: resolved.pdfPath,
              updatedAt: now
            }
          })
      const parsed = pdfAnnotationSidecarSchema.parse(sidecar)
      await writeJsonFile(resolved.defaultSidecarTarget, parsed)
      return {
        ok: true,
        sidecar: parsed,
        path: resolved.defaultSidecarPath,
        savedAt: now
      }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function anonymizeAuthors(authors: PdfAnnotationAuthor[]): PdfAnnotationAuthor[] {
  return authors.map((author, index) => ({
    ...author,
    name: `Anonymous ${index + 1}`,
    email: undefined,
    anonymous: true,
    updatedAt: new Date().toISOString()
  }))
}

function pdfDateString(date = new Date()): string {
  const value = (part: number, size = 2) => String(part).padStart(size, '0')
  return `D:${date.getUTCFullYear()}${value(date.getUTCMonth() + 1)}${value(date.getUTCDate())}${value(date.getUTCHours())}${value(date.getUTCMinutes())}${value(date.getUTCSeconds())}Z`
}

function compactAnnotationText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function annotationKindLabel(kind: PdfAnnotation['kind']): string {
  if (kind === 'highlight') return 'Highlight'
  if (kind === 'comment') return 'Comment'
  if (kind === 'note') return 'Note'
  if (kind === 'translation') return 'Translation'
  if (kind === 'question') return 'Question'
  return 'Answer'
}

function parseAnnotationColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const hex = value?.trim().match(/^#?([0-9a-f]{6})$/i)?.[1]
  if (!hex) return fallback
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255
  ]
}

function getOrCreatePdfAnnots(page: PDFPage, pdf: PDFDocument): PDFArray {
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (existing) return existing
  const annots = pdf.context.obj([])
  page.node.set(PDFName.of('Annots'), annots)
  return annots
}

function normalizedRectToPdf(
  anchor: PdfAnchor,
  rect: PdfAnchor['rects'][number],
  page: PDFPage
): { left: number; bottom: number; right: number; top: number } {
  const { width, height } = page.getSize()
  const left = rect.x * width
  const right = (rect.x + rect.width) * width
  const top = (1 - rect.y) * height
  const bottom = (1 - rect.y - rect.height) * height
  const minX = Math.max(0, Math.min(left, right))
  const maxX = Math.min(width, Math.max(left, right))
  const minY = Math.max(0, Math.min(bottom, top))
  const maxY = Math.min(height, Math.max(bottom, top))
  if (maxX > minX && maxY > minY) return { left: minX, bottom: minY, right: maxX, top: maxY }

  const fallbackPage = Math.max(1, anchor.pageStart)
  const fallbackTop = fallbackPage === rect.page ? top : height - 72
  return {
    left: 72,
    bottom: Math.max(36, fallbackTop - 18),
    right: 90,
    top: Math.max(54, fallbackTop)
  }
}

function threadExportContents(input: {
  title: string
  quote: string
  annotations: PdfAnnotation[]
}): string {
  const parts: string[] = []
  if (input.title) parts.push(input.title)
  if (input.quote) parts.push(`Selected text:\n${input.quote}`)
  for (const annotation of input.annotations) {
    const body = annotation.body.trim()
    if (!body) continue
    parts.push(`${annotationKindLabel(annotation.kind)}:\n${body}`)
  }
  return parts.join('\n\n').trim() || input.quote || input.title || 'SciForge annotation'
}

function addHighlightAnnotation(input: {
  pdf: PDFDocument
  page: PDFPage
  id: string
  rect: { left: number; bottom: number; right: number; top: number }
  contents: string
  color: [number, number, number]
  modifiedAt: string
}): void {
  const context = input.pdf.context
  const annotation = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Highlight'),
    Rect: [
      input.rect.left,
      input.rect.bottom,
      input.rect.right,
      input.rect.top
    ],
    QuadPoints: [
      input.rect.left,
      input.rect.top,
      input.rect.right,
      input.rect.top,
      input.rect.left,
      input.rect.bottom,
      input.rect.right,
      input.rect.bottom
    ],
    Contents: PDFHexString.fromText(input.contents),
    T: PDFHexString.fromText('SciForge'),
    NM: PDFHexString.fromText(input.id),
    M: PDFString.of(input.modifiedAt),
    C: input.color,
    CA: 0.35,
    F: 4
  })
  getOrCreatePdfAnnots(input.page, input.pdf).push(context.register(annotation))
}

function addTextAnnotation(input: {
  pdf: PDFDocument
  page: PDFPage
  id: string
  rect: { left: number; bottom: number; right: number; top: number }
  contents: string
  color: [number, number, number]
  modifiedAt: string
}): void {
  const context = input.pdf.context
  const left = input.rect.left
  const top = input.rect.top
  const iconSize = 18
  const annotation = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: [
      left,
      Math.max(0, top - iconSize),
      left + iconSize,
      top
    ],
    Contents: PDFHexString.fromText(input.contents),
    T: PDFHexString.fromText('SciForge'),
    NM: PDFHexString.fromText(input.id),
    M: PDFString.of(input.modifiedAt),
    Name: PDFName.of('Comment'),
    Open: false,
    C: input.color,
    F: 4
  })
  getOrCreatePdfAnnots(input.page, input.pdf).push(context.register(annotation))
}

function annotationsForThread(sidecar: PdfAnnotationSidecar, threadId: string): PdfAnnotation[] {
  return sidecar.annotations
    .filter((annotation) => annotation.threadId === threadId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

export async function exportPdfAnnotationAdobePdf(
  payload: PdfAnnotationPdfExportPayload
): Promise<PdfAnnotationPdfExportResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(payload, { createExportPdfParents: true })
    const loaded = payload.sidecar
      ? { ok: true as const, sidecar: payload.sidecar }
      : await loadPdfAnnotationSidecar(payload)
    if (!loaded.ok) return loaded

    const sidecar = withResolvedFingerprint(loaded.sidecar, resolved)
    const pdf = await PDFDocument.load(await readFile(resolved.pdfPath), { ignoreEncryption: true })
    const anchorsById = new Map(sidecar.anchors.map((anchor) => [anchor.id, anchor]))
    const modifiedAt = pdfDateString()
    let annotationCount = 0

    for (const thread of sidecar.threads) {
      const threadAnnotations = annotationsForThread(sidecar, thread.id)
      const title = compactAnnotationText(thread.title ?? '')
      const quote = compactAnnotationText(
        thread.anchorIds
          .map((anchorId) => anchorsById.get(anchorId)?.quote ?? '')
          .filter(Boolean)
          .join('\n\n')
      )
      const contents = threadExportContents({ title, quote, annotations: threadAnnotations })
      if (!contents) continue

      for (const anchorId of thread.anchorIds) {
        const anchor = anchorsById.get(anchorId)
        if (!anchor || anchor.rects.length === 0) continue
        const rectsByPage = new Map<number, PdfAnchor['rects']>()
        for (const rect of anchor.rects) {
          const pageIndex = rect.page - 1
          if (pageIndex < 0 || pageIndex >= pdf.getPageCount()) continue
          rectsByPage.set(rect.page, [...(rectsByPage.get(rect.page) ?? []), rect])
        }

        for (const [pageNumber, rects] of rectsByPage) {
          const page = pdf.getPage(pageNumber - 1)
          const firstRect = normalizedRectToPdf(anchor, rects[0], page)
          if (thread.kind === 'highlight') {
            const annotation = threadAnnotations.find((item) => item.kind === 'highlight') ?? threadAnnotations[0]
            const color = parseAnnotationColor(annotation?.color, [1, 0.82, 0.16])
            for (const [index, rect] of rects.entries()) {
              addHighlightAnnotation({
                pdf,
                page,
                id: `${thread.id}-${anchor.id}-${pageNumber}-${index}`,
                rect: normalizedRectToPdf(anchor, rect, page),
                contents,
                color,
                modifiedAt
              })
              annotationCount += 1
            }
          } else {
            addTextAnnotation({
              pdf,
              page,
              id: `${thread.id}-${anchor.id}-${pageNumber}`,
              rect: firstRect,
              contents,
              color: thread.kind === 'question' || thread.kind === 'answer'
                ? [0.42, 0.32, 0.9]
                : [0.12, 0.56, 0.94],
              modifiedAt
            })
            annotationCount += 1
          }
        }
      }
    }

    const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }))
    await writeSafeWorkspaceFile(resolved.exportPdfTarget, bytes)
    return {
      ok: true,
      path: resolved.exportPdfPath,
      annotationCount,
      exportedAt: new Date().toISOString()
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function exportPdfAnnotationSidecarPackage(
  payload: PdfAnnotationSidecarExportPayload
): Promise<PdfAnnotationSidecarExportResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(payload, { createExportPackageParents: true })
    const loaded = payload.sidecar
      ? { ok: true as const, sidecar: payload.sidecar }
      : await loadPdfAnnotationSidecar(payload)
    if (!loaded.ok) return loaded

    const now = new Date().toISOString()
    const sidecar = stablePdfAnnotationSidecar({
      ...withResolvedFingerprint(loaded.sidecar, resolved),
      authors: payload.anonymizeAuthors ? anonymizeAuthors(loaded.sidecar.authors) : loaded.sidecar.authors,
      updatedAt: now,
      manifest: {
        ...loaded.sidecar.manifest,
        sourcePdfName: basename(resolved.pdfPath),
        sourcePdfPath: resolved.pdfPath,
        exchangePackage: basename(resolved.exportPackagePath),
        updatedAt: now
      }
    })
    const zip = new JSZip()
    zip.file(basename(resolved.pdfPath), await readFile(resolved.pdfPath))
    zip.file('annotations.json', `${JSON.stringify(sidecar, null, 2)}\n`)
    zip.file('manifest.json', `${JSON.stringify(sidecar.manifest, null, 2)}\n`)
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })
    await writeSafeWorkspaceFile(resolved.exportPackageTarget, bytes)
    return {
      ok: true,
      path: resolved.exportPackagePath,
      manifest: sidecar.manifest,
      exportedAt: now
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function readImportPackage(payload: PdfAnnotationSidecarImportPayload, workspaceRoot?: string): Promise<Buffer> {
  if (payload.packageBase64?.trim()) {
    const bytes = Buffer.from(payload.packageBase64.trim(), 'base64')
    if (bytes.length > MAX_IMPORT_PACKAGE_BYTES) throw new Error('PDF annotation package is too large.')
    return bytes
  }
  const rawPath = payload.packagePath?.trim()
  if (!rawPath) throw new Error('PDF annotation package path is required.')
  const path = await resolveOpenTargetPath(rawPath, workspaceRoot)
  const info = await stat(path)
  if (info.size > MAX_IMPORT_PACKAGE_BYTES) throw new Error('PDF annotation package is too large.')
  return readFile(path)
}

export async function importPdfAnnotationSidecarPackage(
  payload: PdfAnnotationSidecarImportPayload
): Promise<PdfAnnotationSidecarImportResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(payload, { createDefaultSidecarParents: true })
    const zip = await JSZip.loadAsync(await readImportPackage(payload, resolved.workspaceRoot))
    const annotationsEntry = zip.file('annotations.json')
    if (!annotationsEntry) throw new Error('PDF annotation package is missing annotations.json.')
    const sidecar = migratePdfAnnotationSidecar(JSON.parse(await annotationsEntry.async('string')) as unknown)
    const fingerprintMatched = sidecar.pdfFingerprint.sha256 === resolved.fingerprint.sha256
    if (!fingerprintMatched && payload.attemptRelocation !== true) {
      return {
        ok: false,
        message: 'PDF fingerprint does not match this annotation package.'
      }
    }

    const now = new Date().toISOString()
    const imported = stablePdfAnnotationSidecar({
      ...withResolvedFingerprint(sidecar, resolved),
      updatedAt: now,
      manifest: {
        ...sidecar.manifest,
        sourcePdfName: basename(resolved.pdfPath),
        sourcePdfPath: resolved.pdfPath,
        updatedAt: now
      }
    })
    await writeJsonFile(resolved.defaultSidecarTarget, imported)
    return {
      ok: true,
      sidecar: imported,
      path: resolved.defaultSidecarPath,
      importedAt: now,
      pdfFingerprint: resolved.fingerprint,
      fingerprintMatched,
      warnings: fingerprintMatched ? [] : ['PDF fingerprint mismatch; imported with anchor relocation allowed.']
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
