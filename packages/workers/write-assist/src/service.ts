import type { Dirent, Stats } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open as openFile, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  WRITE_ASSIST_DEFAULT_MAX_SNIPPETS,
  WRITE_ASSIST_DEFAULT_PDF_TEXT_CHARS,
  WRITE_ASSIST_MAX_PDF_TEXT_CHARS,
  WRITE_ASSIST_WORKER_TRANSPORT,
  WRITE_ASSIST_WORKER_VERSION,
  WriteAssistToolNames,
  MarkdownValidateImagesInputSchema,
  PdfExtractTextInputSchema,
  WriteIndexStatsInputSchema,
  WriteRetrieveContextInputSchema,
  pdfTextResourceUri,
  writeIndexStatsResourceUri,
  type MarkdownImageValidationIssue,
  type MarkdownValidateImagesInput,
  type MarkdownValidateImagesResult,
  type PdfExtractTextInput,
  type PdfExtractTextResult,
  type PdfTextPage,
  type WriteAssistError,
  type WriteAssistErrorCode,
  type WriteAssistFailure,
  type WriteIndexSkippedFiles,
  type WriteIndexStats,
  type WriteIndexStatsInput,
  type WriteIndexStatsResult,
  type WriteRetrievalSnippet,
  type WriteRetrievalSnippetLocation,
  type WriteRetrieveContextInput,
  type WriteRetrieveContextResult
} from './contract.js'

export type WriteAssistServiceOptions = {
  workspaceRoot?: string
  maxTextFileBytes?: number
  maxPdfBytes?: number
  maxIndexFiles?: number
  maxIndexChunks?: number
  maxScanEntries?: number
  indexCacheTtlMs?: number
}

type ResolvedTarget = {
  workspaceRoot: string
  absolutePath: string
  relativePath: string
  stats: Stats
  lstats: Stats
}

type IndexedChunk = {
  path: string
  relativePath: string
  title: string
  text: string
  lowerText: string
  tokens: string[]
  termFrequency: Map<string, number>
  titleTokens: Set<string>
  pathTokens: Set<string>
  location: WriteRetrievalSnippetLocation
}

type WorkspaceIndex = {
  workspaceRoot: string
  workspaceId: string
  includePdf: boolean
  builtAt: number
  expiresAt: number
  filesScanned: number
  indexedFiles: number
  chunks: IndexedChunk[]
  averageLength: number
  documentFrequency: Map<string, number>
  skippedFiles: WriteIndexSkippedFiles
}

type QueryModel = {
  text: string
  terms: string[]
  weights: Map<string, number>
  phrases: string[]
}

type RankedChunk = {
  chunk: IndexedChunk
  score: number
  keywords: string[]
}

type PdfDocumentText = {
  path: string
  size: number
  mtimeMs: number
  pageCount: number
  pages: Array<{
    page: number
    text: string
    charStart: number
    charEnd: number
  }>
  hasText: boolean
  truncated: boolean
}

type PdfJsModule = {
  getDocument: (options: unknown) => {
    promise: Promise<{
      numPages: number
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items?: unknown[] }>
        cleanup?: () => void
      }>
      destroy: () => Promise<void>
    }>
  }
}

const DEFAULT_INDEX_CACHE_TTL_MS = 30_000
const MAX_INDEX_BUILD_MS = 2_500
const DEFAULT_MAX_SCAN_ENTRIES = 8_000
const DEFAULT_MAX_INDEX_FILES = 160
const DEFAULT_MAX_TEXT_FILE_BYTES = 600_000
const DEFAULT_MAX_PDF_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_INDEX_CHUNKS = 720
const MAX_CHUNK_CHARS = 900
const MIN_CHUNK_CHARS = 48
const MAX_TOKENS_PER_CHUNK = 1_200
const MAX_QUERY_TERMS = 36
const MAX_SNIPPET_CHARS = 520
const MAX_PDF_TEXT_PAGES = 300
const MAX_PDF_TEXT_CHARS = 1_000_000
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])

const WRITE_TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.tex',
  '.txt',
  '.text'
])

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '.cache',
  '.idea',
  '.pnpm-store',
  '.turbo',
  '.venv',
  '.vscode',
  '.yarn',
  '.yarn-cache',
  '.parcel-cache',
  'log',
  'logs',
  'target',
  'temp',
  'tmp',
  'vendor',
  'venv'
])

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'into',
  'about',
  'there',
  'their',
  'will',
  'would',
  'could',
  'should',
  'have',
  'has',
  'are',
  'was',
  'were',
  'been',
  'not',
  'but',
  'you',
  'your',
  'our',
  'can',
  'then',
  'when',
  'what',
  'how'
])

let pdfJsModulePromise: Promise<PdfJsModule> | null = null
const pdfJsModuleSpecifier: string = 'pdfjs-dist/legacy/build/pdf.mjs'
const require = createRequire(import.meta.url)
let pdfStandardFontDataUrlCache: string | undefined

export class WriteAssistService {
  readonly workspaceRoot?: string
  readonly maxTextFileBytes: number
  readonly maxPdfBytes: number
  readonly maxIndexFiles: number
  readonly maxIndexChunks: number
  readonly maxScanEntries: number
  readonly indexCacheTtlMs: number

  private readonly indexCache = new Map<string, Promise<WorkspaceIndex>>()
  private readonly pdfTextCache = new Map<string, Promise<PdfDocumentText>>()
  private readonly statsByWorkspaceId = new Map<string, WriteIndexStats>()
  private readonly pdfResourceWorkspaceRoots = new Map<string, string>()

  constructor(options: WriteAssistServiceOptions = {}) {
    this.workspaceRoot = cleanOptionalPath(options.workspaceRoot)
    this.maxTextFileBytes = clampInteger(options.maxTextFileBytes ?? DEFAULT_MAX_TEXT_FILE_BYTES, 1, DEFAULT_MAX_TEXT_FILE_BYTES)
    this.maxPdfBytes = clampInteger(options.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES, 1, DEFAULT_MAX_PDF_BYTES)
    this.maxIndexFiles = clampInteger(options.maxIndexFiles ?? DEFAULT_MAX_INDEX_FILES, 1, DEFAULT_MAX_INDEX_FILES)
    this.maxIndexChunks = clampInteger(options.maxIndexChunks ?? DEFAULT_MAX_INDEX_CHUNKS, 1, DEFAULT_MAX_INDEX_CHUNKS)
    this.maxScanEntries = clampInteger(options.maxScanEntries ?? DEFAULT_MAX_SCAN_ENTRIES, 1, DEFAULT_MAX_SCAN_ENTRIES)
    this.indexCacheTtlMs = clampInteger(options.indexCacheTtlMs ?? DEFAULT_INDEX_CACHE_TTL_MS, 1, 10 * 60_000)
  }

  async retrieveContext(input: WriteRetrieveContextInput): Promise<WriteRetrieveContextResult> {
    const parsed = WriteRetrieveContextInputSchema.safeParse(input)
    if (!parsed.success) {
      return failure('invalid_request', parsed.error.message, false, 'Fix the retrieval parameters and retry.')
    }

    return this.capture(async () => {
      const request = parsed.data
      const workspaceRoot = await this.resolveWorkspaceRoot(request.workspaceRoot)
      const currentFilePath = resolveOptionalComparablePath(request.currentFilePath, workspaceRoot)
      if (currentFilePath && !isWithinRoot(workspaceRoot, currentFilePath)) {
        throw serviceError('path_outside_workspace', 'currentFilePath must stay inside the workspace root.', 'Pass a path inside the selected workspace.')
      }

      const includePdf = request.includePdf !== false
      const index = await this.loadWorkspaceIndex(workspaceRoot, includePdf)
      const stats = this.statsFromIndex(index)
      const query = buildQueryModelFromText(request.query)
      const limit = clampInteger(request.maxSnippets ?? WRITE_ASSIST_DEFAULT_MAX_SNIPPETS, 1, 8)
      const offset = decodeCursor(request.cursor)

      if (index.chunks.length === 0 || query.terms.length === 0) {
        return {
          ok: true,
          workspaceRoot,
          workspaceId: index.workspaceId,
          source: 'bm25-keyword' as const,
          query: query.text,
          keywords: query.terms.slice(0, 12),
          snippets: [],
          totalMatches: 0,
          limit,
          ...(request.cursor ? { cursor: request.cursor } : {}),
          truncated: false,
          indexedFiles: index.indexedFiles,
          indexedChunks: index.chunks.length,
          summary: 'No matching write context was found.',
          stats,
          statsResourceUri: stats.resourceUri
        }
      }

      const matches = rankChunks(
        index,
        query,
        currentFilePath ?? '',
        request.includeCurrentFile !== false
      )
      const page = matches.slice(offset, offset + limit).map((match) => {
        const snippet = rankedChunkToSnippet(match)
        return request.summaryOnly === true
          ? { ...snippet, text: compactText(snippet.text).slice(0, 240) }
          : snippet
      })
      const nextOffset = offset + page.length
      const nextCursor = nextOffset < matches.length ? String(nextOffset) : undefined
      return {
        ok: true,
        workspaceRoot,
        workspaceId: index.workspaceId,
        source: 'bm25-keyword' as const,
        query: query.text,
        keywords: query.terms.slice(0, 12),
        snippets: page,
        totalMatches: matches.length,
        limit,
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
        truncated: Boolean(nextCursor),
        indexedFiles: index.indexedFiles,
        indexedChunks: index.chunks.length,
        summary: renderRetrievalSummary(page, matches.length, stats),
        stats,
        statsResourceUri: stats.resourceUri
      }
    })
  }

  async extractPdfText(input: PdfExtractTextInput): Promise<PdfExtractTextResult> {
    const parsed = PdfExtractTextInputSchema.safeParse(input)
    if (!parsed.success) {
      return failure('invalid_request', parsed.error.message, false, 'Fix the PDF extraction parameters and retry.')
    }

    return this.capture(async () => {
      const request = parsed.data
      const target = await this.resolveWorkspaceTarget(request.workspaceRoot, request.path)
      if (target.stats.isDirectory()) {
        throw serviceError('is_directory', 'Cannot extract PDF text from a directory.', 'Choose a PDF file inside the workspace.')
      }
      if (extname(target.absolutePath).toLowerCase() !== '.pdf') {
        throw serviceError('not_pdf', 'This file is not a PDF document.', 'Choose a .pdf file inside the workspace.')
      }
      if (target.stats.size > this.maxPdfBytes) {
        throw serviceError('file_too_large', 'This PDF is too large to extract in the write-assist worker.', 'Use a smaller PDF or split the document.')
      }

      const document = await this.loadPdfDocumentText(target)
      this.pdfResourceWorkspaceRoots.set(resourcePathKey(target.relativePath), target.workspaceRoot)
      const pageStart = request.pageStart ?? 1
      if (pageStart > document.pageCount) {
        throw serviceError('invalid_request', 'pageStart is greater than the PDF page count.', 'Use a pageStart within the returned pageCount.')
      }
      const pageEnd = Math.min(request.pageEnd ?? document.pageCount, document.pageCount)
      const maxChars = clampInteger(
        request.maxChars ?? WRITE_ASSIST_DEFAULT_PDF_TEXT_CHARS,
        1,
        WRITE_ASSIST_MAX_PDF_TEXT_CHARS
      )
      const selectedPages = document.pages.filter((page) => page.page >= pageStart && page.page <= pageEnd)
      const firstOffset = selectedPages[0]?.charStart ?? 0
      const cursorOffset = request.cursor ? decodeCursor(request.cursor) : firstOffset
      const offset = Math.max(firstOffset, cursorOffset)
      const pages: PdfTextPage[] = []
      let charsReturned = 0
      let nextCursor: string | undefined

      for (const page of selectedPages) {
        if (page.charEnd <= offset) continue
        if (charsReturned >= maxChars) break
        const sliceStart = Math.max(0, offset - page.charStart)
        const remaining = maxChars - charsReturned
        const text = page.text.slice(sliceStart, sliceStart + remaining)
        if (!text) continue
        const charStart = page.charStart + sliceStart
        const charEnd = charStart + text.length
        charsReturned += text.length
        pages.push({
          page: page.page,
          ...(request.summaryOnly === true ? {} : { text }),
          charStart,
          charEnd,
          truncated: charEnd < page.charEnd
        })
        if (charEnd < page.charEnd || charsReturned >= maxChars) {
          nextCursor = String(charEnd)
          break
        }
      }

      if (!nextCursor && pageEnd < document.pageCount) {
        const nextPage = document.pages.find((page) => page.page > pageEnd)
        if (nextPage) nextCursor = String(nextPage.charStart)
      }

      const truncated = Boolean(nextCursor) || document.truncated
      return {
        ok: true,
        workspaceRoot: target.workspaceRoot,
        relativePath: target.relativePath,
        name: basename(target.relativePath || target.absolutePath),
        mimeType: 'application/pdf' as const,
        size: document.size,
        mtimeMs: document.mtimeMs,
        pageCount: document.pageCount,
        pageStart,
        pageEnd,
        pages,
        charsReturned,
        hasText: pages.some((page) => page.charEnd > page.charStart) || document.hasText,
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
        truncated,
        summary: renderPdfSummary(target.relativePath, pages, document.pageCount, truncated, request.summaryOnly === true),
        resourceUri: pdfTextResourceUri(target.relativePath)
      }
    })
  }

  async validateMarkdownImages(
    input: MarkdownValidateImagesInput
  ): Promise<MarkdownValidateImagesResult> {
    const parsed = MarkdownValidateImagesInputSchema.safeParse(input)
    if (!parsed.success) {
      return failure('invalid_request', parsed.error.message, false, 'Fix the Markdown validation parameters and retry.')
    }

    return this.capture(async () => {
      const request = parsed.data
      const target = await this.resolveWorkspaceTarget(request.workspaceRoot, request.path)
      if (target.stats.isDirectory()) {
        throw serviceError('is_directory', 'Cannot validate a directory as Markdown.', 'Choose a Markdown file inside the workspace.')
      }
      if (!MARKDOWN_EXTENSIONS.has(extname(target.absolutePath).toLowerCase())) {
        throw serviceError('not_markdown', 'This file is not a Markdown document.', 'Choose a .md, .markdown, or .mdx file.')
      }
      if (target.stats.size > this.maxTextFileBytes) {
        throw serviceError('file_too_large', 'This Markdown file is too large to validate.', 'Validate a smaller Markdown document.')
      }

      const text = await readFile(target.absolutePath, 'utf8')
      const imageReferences = markdownImageReferences(text)
      const issues: MarkdownImageValidationIssue[] = []
      const validLocalImageKeys = new Set<string>()
      let localImageCount = 0
      for (const image of imageReferences) {
        const validation = await validateMarkdownImageDestination(
          image.destination,
          target.absolutePath,
          target.workspaceRoot
        )
        if (validation.local) {
          localImageCount += 1
          if (validation.pathKey) validLocalImageKeys.add(validation.pathKey)
        }
        if (validation.issue) {
          issues.push({
            ...validation.issue,
            line: image.line,
            column: image.column,
            destination: image.destination
          })
        }
      }

      const minimumImages = request.minimumImages ?? 0
      const minimumLocalImages = request.minimumLocalImages ?? 0
      const matchedExpectedLocalImages: string[] = []
      for (const expectedPath of request.expectedLocalImages ?? []) {
        const expectedAbsolutePath = resolve(target.workspaceRoot, normalizeUserPath(expectedPath))
        const expectedKey = comparablePath(expectedAbsolutePath)
        if (isWithinRoot(target.workspaceRoot, expectedAbsolutePath) && validLocalImageKeys.has(expectedKey)) {
          matchedExpectedLocalImages.push(expectedPath)
        } else {
          issues.push({
            code: 'expected_local_image_missing',
            message: `Expected local image is not both referenced by the Markdown and present inside the workspace: ${expectedPath}.`,
            destination: expectedPath
          })
        }
      }
      if (imageReferences.length < minimumImages) {
        issues.push({
          code: 'image_required',
          message: `Expected at least ${minimumImages} Markdown image reference${minimumImages === 1 ? '' : 's'}, found ${imageReferences.length}.`
        })
      }
      if (localImageCount < minimumLocalImages) {
        issues.push({
          code: 'local_image_required',
          message: `Expected at least ${minimumLocalImages} valid local image reference${minimumLocalImages === 1 ? '' : 's'}, found ${localImageCount}.`
        })
      }

      const valid = issues.length === 0
      return {
        ok: true,
        valid,
        workspaceRoot: target.workspaceRoot,
        relativePath: target.relativePath,
        imageCount: imageReferences.length,
        localImageCount,
        matchedExpectedLocalImages,
        issues,
        summary: valid
          ? `Markdown image validation passed for ${target.relativePath}: ${imageReferences.length} image reference(s), ${localImageCount} valid local image(s), ${matchedExpectedLocalImages.length} expected local image(s) matched.`
          : `Markdown image validation failed for ${target.relativePath}: ${issues.map((issue) => `${issue.code}${issue.line ? ` at line ${issue.line}` : ''}`).join(', ')}.`
      }
    })
  }

  async indexStats(input: WriteIndexStatsInput = {}): Promise<WriteIndexStatsResult> {
    const parsed = WriteIndexStatsInputSchema.safeParse(input)
    if (!parsed.success) {
      return failure('invalid_request', parsed.error.message, false, 'Fix the index stats parameters and retry.')
    }
    return this.capture(async () => {
      const workspaceRoot = await this.resolveWorkspaceRoot(parsed.data.workspaceRoot)
      const index = await this.loadWorkspaceIndex(workspaceRoot, true)
      return { ok: true, stats: this.statsFromIndex(index) }
    })
  }

  async extractPdfTextResource(path: string): Promise<PdfExtractTextResult> {
    const workspaceRoot = this.pdfResourceWorkspaceRoots.get(resourcePathKey(path)) ?? this.workspaceRoot
    return this.extractPdfText({
      ...(workspaceRoot ? { workspaceRoot } : {}),
      path
    })
  }

  async indexStatsByWorkspaceId(workspaceId: string): Promise<WriteIndexStatsResult> {
    const cleaned = workspaceId.trim()
    if (!cleaned) {
      return failure('invalid_request', 'Workspace id is required.', false, 'Use a workspace id returned by gui_write_retrieve_context.')
    }
    const cached = this.statsByWorkspaceId.get(cleaned)
    if (cached) return { ok: true, stats: cached }

    if (this.workspaceRoot) {
      const workspaceRoot = await this.resolveWorkspaceRoot()
      if (workspaceIdForRoot(workspaceRoot) === cleaned) {
        const index = await this.loadWorkspaceIndex(workspaceRoot, true)
        return { ok: true, stats: this.statsFromIndex(index) }
      }
    }

    return failure('index_not_found', `No write index stats are available for workspace id ${cleaned}.`, false, 'Call gui_write_retrieve_context for this workspace first.')
  }

  clearCaches(): void {
    this.indexCache.clear()
    this.pdfTextCache.clear()
    this.statsByWorkspaceId.clear()
    this.pdfResourceWorkspaceRoots.clear()
  }

  private async loadWorkspaceIndex(workspaceRoot: string, includePdf: boolean): Promise<WorkspaceIndex> {
    const cacheKey = `${workspaceRoot}::${includePdf ? 'pdf' : 'text'}`
    const cached = this.indexCache.get(cacheKey)
    if (cached) {
      const index = await cached
      if (Date.now() < index.expiresAt) return index
      this.indexCache.delete(cacheKey)
    }

    const pending = this.buildWorkspaceIndex(workspaceRoot, includePdf)
      .then((index) => {
        this.statsByWorkspaceId.set(index.workspaceId, this.statsFromIndex(index))
        return index
      })
      .catch((error) => {
        this.indexCache.delete(cacheKey)
        throw error
      })
    this.indexCache.set(cacheKey, pending)
    return pending
  }

  private async buildWorkspaceIndex(workspaceRoot: string, includePdf: boolean): Promise<WorkspaceIndex> {
    const deadline = Date.now() + MAX_INDEX_BUILD_MS
    const scan = await this.scanWorkspaceFiles(workspaceRoot, deadline, includePdf)
    const chunks: IndexedChunk[] = []
    const skippedFiles: WriteIndexSkippedFiles = { binary: 0, tooLarge: 0, unreadable: 0, pdfFailed: 0 }
    let indexedFiles = 0

    for (const path of scan.files) {
      if (chunks.length >= this.maxIndexChunks || deadlineExceeded(deadline)) break
      const relativePath = normalizePathSeparators(relative(workspaceRoot, path) || basename(path))
      const ext = extname(path).toLowerCase()
      try {
        const fileInfo = await stat(path)
        let fileChunks: IndexedChunk[] = []
        if (ext === '.pdf') {
          if (fileInfo.size > this.maxPdfBytes) {
            skippedFiles.tooLarge += 1
            continue
          }
          fileChunks = await this.chunkPdf(path, workspaceRoot, relativePath)
          if (fileChunks.length === 0) skippedFiles.pdfFailed += 1
        } else {
          const read = await readIndexableTextFile(path, fileInfo, this.maxTextFileBytes, deadline)
          if (read.skipped) {
            skippedFiles[read.skipped] += 1
            continue
          }
          fileChunks = chunkMarkdown(path, relativePath, read.content ?? '')
        }
        if (fileChunks.length > 0) indexedFiles += 1
        chunks.push(...fileChunks.slice(0, Math.max(0, this.maxIndexChunks - chunks.length)))
      } catch {
        skippedFiles.unreadable += 1
      }
    }

    const documentFrequency = new Map<string, number>()
    let tokenCount = 0
    for (const chunk of chunks) {
      tokenCount += chunk.tokens.length
      for (const token of new Set(chunk.tokens)) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
      }
    }

    return {
      workspaceRoot,
      workspaceId: workspaceIdForRoot(workspaceRoot),
      includePdf,
      builtAt: Date.now(),
      expiresAt: Date.now() + this.indexCacheTtlMs,
      filesScanned: scan.filesScanned,
      indexedFiles,
      chunks,
      averageLength: chunks.length > 0 ? tokenCount / chunks.length : 1,
      documentFrequency,
      skippedFiles
    }
  }

  private async scanWorkspaceFiles(
    workspaceRoot: string,
    deadline: number,
    includePdf: boolean
  ): Promise<{ files: string[]; filesScanned: number }> {
    const files: string[] = []
    const stack = [workspaceRoot]
    let scanned = 0

    while (
      stack.length > 0 &&
      scanned < this.maxScanEntries &&
      files.length < this.maxIndexFiles &&
      !deadlineExceeded(deadline)
    ) {
      const current = stack.pop()!
      const entries = await safeSortedDirectoryEntries(current)
      for (const entry of entries) {
        if (deadlineExceeded(deadline)) break
        scanned += 1
        if (scanned >= this.maxScanEntries || files.length >= this.maxIndexFiles) break
        if (entry.name === '.DS_Store' || entry.isSymbolicLink()) continue
        const path = join(current, entry.name)
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(path)
          continue
        }
        if (entry.isFile() && isIndexedFile(path, includePdf)) files.push(path)
      }
    }

    return { files, filesScanned: scanned }
  }

  private async chunkPdf(path: string, workspaceRoot: string, relativePath: string): Promise<IndexedChunk[]> {
    const info = await stat(path)
    const document = await this.loadPdfDocumentText({
      workspaceRoot,
      absolutePath: path,
      relativePath,
      stats: info,
      lstats: await lstat(path).catch(() => info)
    })
    if (!document.hasText) return []
    const chunks: IndexedChunk[] = []
    for (const page of document.pages) {
      if (chunks.length >= this.maxIndexChunks) break
      chunks.push(...chunkPdfPage(path, relativePath, page))
    }
    return chunks
  }

  private async loadPdfDocumentText(target: ResolvedTarget): Promise<PdfDocumentText> {
    const cacheKey = `${target.absolutePath}:${target.stats.size}:${target.stats.mtimeMs}`
    const cached = this.pdfTextCache.get(cacheKey)
    if (cached) return cached

    const pending = extractPdfDocumentText(target.absolutePath, target.stats.size, target.stats.mtimeMs)
      .catch((error) => {
        this.pdfTextCache.delete(cacheKey)
        throw error
      })
    this.pdfTextCache.set(cacheKey, pending)
    return pending
  }

  private statsFromIndex(index: WorkspaceIndex): WriteIndexStats {
    const stats = {
      workspaceRoot: index.workspaceRoot,
      workspaceId: index.workspaceId,
      includePdf: index.includePdf,
      builtAt: new Date(index.builtAt).toISOString(),
      expiresAt: new Date(index.expiresAt).toISOString(),
      filesScanned: index.filesScanned,
      indexedFiles: index.indexedFiles,
      indexedChunks: index.chunks.length,
      skippedFiles: index.skippedFiles,
      resourceUri: writeIndexStatsResourceUri(index.workspaceId)
    }
    this.statsByWorkspaceId.set(index.workspaceId, stats)
    return stats
  }

  private async resolveWorkspaceRoot(inputWorkspaceRoot?: string): Promise<string> {
    const rawRoot = cleanOptionalPath(inputWorkspaceRoot) ?? this.workspaceRoot
    if (!rawRoot) {
      throw serviceError('workspace_root_required', 'Workspace root is required.', 'Launch the worker with SCIFORGE_WRITE_ASSIST_ROOT or pass workspaceRoot.')
    }
    const rootPath = resolve(expandHomePath(rawRoot))
    const canonicalRoot = await canonicalPath(rootPath).catch(() => {
      throw serviceError('workspace_root_not_found', `Workspace root not found: ${rawRoot}`, 'Choose an existing workspace directory.')
    })
    const info = await stat(canonicalRoot).catch(() => {
      throw serviceError('workspace_root_not_found', `Workspace root not found: ${rawRoot}`, 'Choose an existing workspace directory.')
    })
    if (!info.isDirectory()) {
      throw serviceError('workspace_root_not_found', `Workspace root is not a directory: ${rawRoot}`, 'Choose an existing workspace directory.')
    }

    if (this.workspaceRoot && inputWorkspaceRoot?.trim()) {
      const configuredRoot = await canonicalPath(resolve(expandHomePath(this.workspaceRoot)))
      if (!samePath(configuredRoot, canonicalRoot)) {
        throw serviceError('workspace_root_mismatch', 'Requested workspace root does not match the worker launch root.', 'Omit workspaceRoot or use the configured workspace.')
      }
    }

    return canonicalRoot
  }

  private async resolveWorkspaceTarget(inputWorkspaceRoot: string | undefined, inputPath: string | undefined): Promise<ResolvedTarget> {
    const workspaceRoot = await this.resolveWorkspaceRoot(inputWorkspaceRoot)
    const rawPath = cleanOptionalPath(inputPath)
    if (!rawPath) {
      throw serviceError('path_required', 'Path is required.', 'Pass a file path relative to the workspace root.')
    }
    const expanded = expandHomePath(normalizeUserPath(rawPath))
    const directPath = isAbsolute(expanded) ? resolve(expanded) : resolve(workspaceRoot, expanded)
    const canonicalTarget = await canonicalPath(directPath).catch(() => {
      throw serviceError('path_not_found', `Path not found: ${rawPath}`, 'Check the path and inspect the workspace file list.')
    })
    if (!isWithinRoot(workspaceRoot, canonicalTarget)) {
      throw serviceError('path_outside_workspace', 'Path must stay within the selected workspace.', 'Use a path relative to the workspace root.')
    }

    const stats = await stat(directPath).catch(() => {
      throw serviceError('path_not_found', `Path not found: ${rawPath}`, 'Check the path and inspect the workspace file list.')
    })
    const lstats = await lstat(directPath).catch(() => stats)
    return {
      workspaceRoot,
      absolutePath: directPath,
      relativePath: relativePathForDisplay(workspaceRoot, directPath, canonicalTarget),
      stats,
      lstats
    }
  }

  private async capture<T>(operation: () => Promise<T>): Promise<T | WriteAssistFailure> {
    try {
      return await operation()
    } catch (error) {
      return { ok: false, error: errorToWriteAssistError(error) }
    }
  }
}

export function createWriteAssistService(options: WriteAssistServiceOptions = {}): WriteAssistService {
  return new WriteAssistService(options)
}

export function writeAssistConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WriteAssistServiceOptions {
  return compactObject({
    workspaceRoot: cleanOptionalPath(env.SCIFORGE_WRITE_ASSIST_ROOT) ?? cleanOptionalPath(env.SCIFORGE_WORKSPACE_PATH),
    maxTextFileBytes: parsePositiveInteger(env.SCIFORGE_WRITE_ASSIST_MAX_TEXT_FILE_BYTES),
    maxPdfBytes: parsePositiveInteger(env.SCIFORGE_WRITE_ASSIST_MAX_PDF_BYTES),
    maxIndexFiles: parsePositiveInteger(env.SCIFORGE_WRITE_ASSIST_MAX_INDEX_FILES),
    maxIndexChunks: parsePositiveInteger(env.SCIFORGE_WRITE_ASSIST_MAX_INDEX_CHUNKS)
  })
}

export function writeAssistDiagnostics() {
  return {
    version: WRITE_ASSIST_WORKER_VERSION,
    transport: WRITE_ASSIST_WORKER_TRANSPORT,
    capabilities: [...WriteAssistToolNames]
  }
}

export function tokenizeWriteRetrievalText(text = ''): string[] {
  const source = normalizeLower(text)
  const tokens: string[] = []

  const latinTerms = source.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  for (const term of latinTerms) {
    if (tokenAllowed(term)) tokens.push(term)
  }

  const hanSegments = source.match(/\p{Script=Han}+/gu) ?? []
  for (const segment of hanSegments) {
    const chars = [...segment].slice(0, 120)
    if (chars.length === 1) {
      tokens.push(chars[0])
      continue
    }
    for (let size = 2; size <= Math.min(4, chars.length); size += 1) {
      for (let index = 0; index <= chars.length - size; index += 1) {
        tokens.push(chars.slice(index, index + size).join(''))
      }
    }
  }

  return tokens
}

type MarkdownImageReference = {
  destination: string
  line: number
  column: number
}

function markdownImageReferences(markdown: string): MarkdownImageReference[] {
  const source = maskMarkdownCode(markdown)
  const definitions = new Map<string, string>()
  const definitionPattern = /^\s*\[([^\]\r\n]+)\]:\s*(?:<([^>\r\n]*)>|(\S*))\s*(?:["'(].*)?$/gmu
  for (const match of source.matchAll(definitionPattern)) {
    definitions.set(normalizeReferenceLabel(match[1] ?? ''), match[2] ?? match[3] ?? '')
  }

  const references: MarkdownImageReference[] = []
  const inlinePattern = /!\[([^\]\r\n]*)\]\(\s*(?:<([^>\r\n]*)>|([^)\s]*))(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)\r\n]*\)))?\s*\)/gu
  for (const match of source.matchAll(inlinePattern)) {
    references.push(markdownImageReference(markdown, match.index, match[2] ?? match[3] ?? ''))
  }
  const referencePattern = /!\[([^\]\r\n]*)\]\[([^\]\r\n]*)\]/gu
  for (const match of source.matchAll(referencePattern)) {
    const label = normalizeReferenceLabel(match[2] || match[1] || '')
    references.push(markdownImageReference(markdown, match.index, definitions.get(label) ?? ''))
  }
  const htmlPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/giu
  for (const match of source.matchAll(htmlPattern)) {
    references.push(markdownImageReference(markdown, match.index, match[1] ?? match[2] ?? match[3] ?? ''))
  }
  return references.sort((left, right) => left.line - right.line || left.column - right.column)
}

function maskMarkdownCode(markdown: string): string {
  return markdown
    .replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[^\n]*(?=\n|$)|$)/gu, (value) => (
      value.replace(/[^\n]/gu, ' ')
    ))
    .replace(/`[^`\r\n]*`/gu, (value) => ' '.repeat(value.length))
}

function normalizeReferenceLabel(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase()
}

function markdownImageReference(markdown: string, index: number, destination: string): MarkdownImageReference {
  const before = markdown.slice(0, index)
  const line = before.split(/\r?\n/u).length
  const lastLineBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
  return {
    destination: destination.trim(),
    line,
    column: index - lastLineBreak
  }
}

async function validateMarkdownImageDestination(
  destination: string,
  markdownPath: string,
  workspaceRoot: string
): Promise<{
  local: boolean
  pathKey?: string
  issue?: Pick<MarkdownImageValidationIssue, 'code' | 'message'>
}> {
  const trimmed = destination.trim()
  if (!trimmed) {
    return {
      local: false,
      issue: { code: 'empty_destination', message: 'Markdown image destination is empty.' }
    }
  }
  if (/^(?:https?:|data:image\/)/iu.test(trimmed)) return { local: false }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
    return {
      local: false,
      issue: { code: 'invalid_destination', message: 'Markdown image uses an unsupported URI scheme.' }
    }
  }

  const withoutSuffix = trimmed.split(/[?#]/u, 1)[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(withoutSuffix)
  } catch {
    return {
      local: false,
      issue: { code: 'invalid_destination', message: 'Markdown image path has invalid percent encoding.' }
    }
  }
  if (!decoded) {
    return {
      local: false,
      issue: { code: 'empty_destination', message: 'Markdown image destination is empty.' }
    }
  }
  const candidate = isAbsolute(decoded)
    ? resolve(decoded)
    : resolve(dirname(markdownPath), normalizeUserPath(decoded))
  if (!isWithinRoot(workspaceRoot, candidate)) {
    return {
      local: false,
      issue: { code: 'outside_workspace', message: 'Markdown image path leaves the workspace.' }
    }
  }
  try {
    const canonical = await realpath(candidate)
    if (!isWithinRoot(workspaceRoot, canonical)) {
      return {
        local: false,
        issue: { code: 'outside_workspace', message: 'Markdown image resolves outside the workspace.' }
      }
    }
    const info = await stat(candidate)
    if (!info.isFile()) {
      return {
        local: false,
        issue: { code: 'not_file', message: 'Markdown image destination is not a file.' }
      }
    }
    return { local: true, pathKey: comparablePath(candidate) }
  } catch {
    return {
      local: false,
      issue: { code: 'missing_local_image', message: 'Markdown image file does not exist.' }
    }
  }
}

async function extractPdfDocumentText(targetPath: string, size: number, mtimeMs: number): Promise<PdfDocumentText> {
  try {
    const pdfjs = await loadPdfJs()
    const bytes = await readFile(targetPath)
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      disableWorker: true,
      isEvalSupported: false,
      standardFontDataUrl: pdfStandardFontDataUrl(),
      useSystemFonts: false
    })
    const document = await loadingTask.promise
    const pages: PdfDocumentText['pages'] = []
    let charOffset = 0
    let truncated = false

    try {
      const maxPages = Math.min(document.numPages, MAX_PDF_TEXT_PAGES)
      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        const text = textContentToPageText(content)
        if (text) {
          const remaining = MAX_PDF_TEXT_CHARS - charOffset
          const pageText = text.length > remaining ? text.slice(0, Math.max(0, remaining)).trim() : text
          if (pageText) {
            pages.push({
              page: pageNumber,
              text: pageText,
              charStart: charOffset,
              charEnd: charOffset + pageText.length
            })
            charOffset += pageText.length + 1
          }
          if (text.length > remaining || charOffset >= MAX_PDF_TEXT_CHARS) {
            truncated = true
            page.cleanup?.()
            break
          }
        }
        page.cleanup?.()
      }
      if (document.numPages > MAX_PDF_TEXT_PAGES) truncated = true
    } finally {
      await document.destroy()
    }

    return {
      path: targetPath,
      size,
      mtimeMs,
      pageCount: document.numPages,
      pages,
      hasText: pages.some((page) => page.text.trim().length > 0),
      truncated
    }
  } catch (error) {
    if (error instanceof WriteAssistServiceError) throw error
    throw serviceError('pdf_extract_failed', `PDF text extraction failed: ${errorMessage(error)}`, false, 'Use a valid, text-based PDF or try a smaller document.')
  }
}

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    ensurePdfJsNodePolyfills()
    pdfJsModulePromise = import(pdfJsModuleSpecifier) as Promise<PdfJsModule>
  }
  return pdfJsModulePromise
}

function ensurePdfJsNodePolyfills(): void {
  const target = globalThis as unknown as Record<string, unknown>
  target.DOMMatrix ??= class DOMMatrix {}
  target.ImageData ??= class ImageData {}
  target.Path2D ??= class Path2D {}
}

function pdfStandardFontDataUrl(): string | undefined {
  if (pdfStandardFontDataUrlCache !== undefined) return pdfStandardFontDataUrlCache
  try {
    const packageJsonPath = require.resolve('pdfjs-dist/package.json')
    pdfStandardFontDataUrlCache = `${join(dirname(packageJsonPath), 'standard_fonts')}/`
  } catch {
    pdfStandardFontDataUrlCache = ''
  }
  return pdfStandardFontDataUrlCache || undefined
}

function textContentToPageText(content: { items?: unknown[] }): string {
  const parts: string[] = []
  for (const item of content.items ?? []) {
    if (!item || typeof item !== 'object') continue
    const value = (item as { str?: unknown }).str
    if (typeof value === 'string' && value.trim()) parts.push(value)
  }
  return compactPdfText(parts.join(' '))
}

function compactPdfText(text = ''): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readIndexableTextFile(
  path: string,
  info: Stats,
  maxFileBytes: number,
  deadline: number
): Promise<{ content?: string; skipped?: keyof WriteIndexSkippedFiles }> {
  if (!info.isFile() || info.size <= 0) return { content: '' }
  if (info.size > maxFileBytes) return { skipped: 'tooLarge' }
  if (deadlineExceeded(deadline)) return { skipped: 'unreadable' }

  const handle = await openFile(path, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(info.size, maxFileBytes))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const bytes = buffer.subarray(0, bytesRead)
    if (isLikelyBinaryBuffer(bytes)) return { skipped: 'binary' }
    if (deadlineExceeded(deadline)) return { skipped: 'unreadable' }
    return { content: bytes.toString('utf8') }
  } finally {
    await handle.close()
  }
}

function chunkMarkdown(path: string, relativePath: string, content: string): IndexedChunk[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const chunks: IndexedChunk[] = []
  let currentTitle = basename(path)
  let buffer: string[] = []
  let lineStart = 1
  let charCount = 0

  const flush = (): void => {
    const chunk = buildChunk(path, relativePath, currentTitle, buffer, {
      kind: 'text',
      lineStart,
      lineEnd: lineStart + buffer.length - 1
    })
    if (chunk) chunks.push(chunk)
    buffer = []
    charCount = 0
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const heading = headingFromLine(line)
    if (heading) {
      if (buffer.length > 0) flush()
      currentTitle = heading
      lineStart = index + 1
    } else if (buffer.length === 0) {
      lineStart = index + 1
    }

    buffer.push(line)
    charCount += line.length + 1
    const paragraphBreak = !line.trim() && charCount >= 360
    if (paragraphBreak || charCount >= MAX_CHUNK_CHARS) flush()
  }

  if (buffer.length > 0) flush()
  return chunks
}

function chunkPdfPage(
  path: string,
  relativePath: string,
  page: PdfDocumentText['pages'][number]
): IndexedChunk[] {
  const paragraphs = page.text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}|(?<=[。.!?！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const chunks: IndexedChunk[] = []
  let buffer: string[] = []
  let charCount = 0

  const flush = (): void => {
    const chunk = buildChunk(path, relativePath, `Page ${page.page}`, buffer, {
      kind: 'pdf',
      pageStart: page.page,
      pageEnd: page.page
    })
    if (chunk) chunks.push(chunk)
    buffer = []
    charCount = 0
  }

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [page.text]) {
    buffer.push(paragraph)
    charCount += paragraph.length + 1
    if (charCount >= MAX_CHUNK_CHARS) flush()
  }
  if (buffer.length > 0) flush()
  return chunks
}

function buildChunk(
  path: string,
  relativePath: string,
  title: string,
  lines: string[],
  location: WriteRetrievalSnippetLocation
): IndexedChunk | null {
  const raw = lines.join('\n').trim()
  const text = raw.length > MAX_CHUNK_CHARS + 160 ? `${raw.slice(0, MAX_CHUNK_CHARS).trimEnd()}...` : raw
  if (compactText(text).length < MIN_CHUNK_CHARS) return null

  const tokens = tokenizeWriteRetrievalText(`${title}\n${text}`).slice(0, MAX_TOKENS_PER_CHUNK)
  if (tokens.length === 0) return null
  return {
    path,
    relativePath,
    title,
    text,
    lowerText: normalizeLower(text),
    tokens,
    termFrequency: termFrequency(tokens),
    titleTokens: new Set(tokenizeWriteRetrievalText(title)),
    pathTokens: new Set(tokenizeWriteRetrievalText(relativePath.replace(/[\\/._-]+/g, ' '))),
    location
  }
}

function buildQueryModelFromText(text: string): QueryModel {
  const weights = new Map<string, number>()
  addWeightedTerms(weights, text, 2)
  const compact = compactText(text)
  const ranked = [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_QUERY_TERMS)
  return {
    text: compact.slice(0, 240),
    terms: ranked.map(([term]) => term),
    weights: new Map(ranked),
    phrases: compact.length >= 8 ? [normalizeLower(clipTail(compact, 80))] : []
  }
}

function rankChunks(
  index: WorkspaceIndex,
  query: QueryModel,
  currentFilePath: string,
  includeCurrentFile: boolean
): RankedChunk[] {
  const perFile = new Map<string, number>()
  const seenText = new Set<string>()
  const ranked = index.chunks
    .filter((chunk) => includeCurrentFile || !currentFilePath || comparablePath(chunk.path) !== comparablePath(currentFilePath))
    .map((chunk) => {
      const keyword = keywordScore(chunk, query)
      const score = bm25Score(chunk, index, query) + keyword.score
      return {
        chunk,
        score,
        keywords: keyword.keywords
      }
    })
    .filter((item) => item.score >= 0.25 && item.keywords.length > 0)
    .sort((a, b) => b.score - a.score)

  const output: RankedChunk[] = []
  for (const item of ranked) {
    const used = perFile.get(item.chunk.path) ?? 0
    if (used >= 2) continue
    const signature = compactText(bestSnippetText(item.chunk, item.keywords)).slice(0, 120)
    if (!signature || seenText.has(signature)) continue
    seenText.add(signature)
    perFile.set(item.chunk.path, used + 1)
    output.push(item)
    if (output.length >= 64) break
  }
  return output
}

function rankedChunkToSnippet(item: RankedChunk): WriteRetrievalSnippet {
  const text = bestSnippetText(item.chunk, item.keywords)
  return {
    path: item.chunk.relativePath,
    title: item.chunk.title,
    text,
    score: Number(item.score.toFixed(3)),
    keywords: item.keywords,
    location: item.chunk.location,
    ...(item.chunk.location.kind === 'pdf' ? { resourceUri: pdfTextResourceUri(item.chunk.relativePath) } : {}),
    ...(item.chunk.location.kind === 'text'
      ? { lineStart: item.chunk.location.lineStart, lineEnd: item.chunk.location.lineEnd }
      : { pageStart: item.chunk.location.pageStart, pageEnd: item.chunk.location.pageEnd })
  }
}

function bm25Score(chunk: IndexedChunk, index: WorkspaceIndex, query: QueryModel): number {
  const totalDocs = Math.max(1, index.chunks.length)
  const averageLength = Math.max(1, index.averageLength)
  const k1 = 1.2
  const b = 0.72
  let score = 0

  for (const term of query.terms) {
    const tf = chunk.termFrequency.get(term) ?? 0
    if (!tf) continue
    const df = index.documentFrequency.get(term) ?? 0
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5))
    const normalized = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (chunk.tokens.length / averageLength)))
    const weight = query.weights.get(term) ?? 1
    score += weight * idf * normalized
  }

  return score
}

function keywordScore(chunk: IndexedChunk, query: QueryModel): { score: number; keywords: string[] } {
  const keywords: string[] = []
  let score = 0
  for (const term of query.terms) {
    if (!chunk.termFrequency.has(term)) continue
    keywords.push(term)
    const weight = query.weights.get(term) ?? 1
    if (chunk.titleTokens.has(term)) score += 0.35 * weight
    if (chunk.pathTokens.has(term)) score += 0.18 * weight
  }
  if (keywords.length > 0) score += Math.sqrt(keywords.length) * 0.18

  for (const phrase of query.phrases) {
    if (phrase.length >= 8 && chunk.lowerText.includes(phrase)) score += 0.9
  }

  return { score, keywords: keywords.slice(0, 8) }
}

function bestSnippetText(chunk: IndexedChunk, keywords: string[]): string {
  const compact = chunk.text.replace(/\r\n?/g, '\n').trim()
  if (compact.length <= MAX_SNIPPET_CHARS) return compact

  const lower = normalizeLower(compact)
  let bestIndex = -1
  for (const keyword of keywords) {
    const index = lower.indexOf(keyword)
    if (index >= 0 && (bestIndex < 0 || index < bestIndex)) bestIndex = index
  }
  const center = bestIndex >= 0 ? bestIndex : Math.floor(compact.length / 2)
  const start = Math.max(0, center - Math.floor(MAX_SNIPPET_CHARS / 2))
  const end = Math.min(compact.length, start + MAX_SNIPPET_CHARS)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < compact.length ? '...' : ''
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`
}

function addWeightedTerms(weights: Map<string, number>, text: string, weight: number): void {
  for (const token of tokenizeWriteRetrievalText(text)) {
    weights.set(token, (weights.get(token) ?? 0) + weight)
  }
}

function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1)
  }
  return map
}

function tokenAllowed(token: string): boolean {
  if (!token || STOP_WORDS.has(token)) return false
  if (/^\d+$/.test(token)) return false
  return token.length >= 2
}

function isIndexedFile(path: string, includePdf: boolean): boolean {
  const ext = extname(path).toLowerCase()
  return WRITE_TEXT_FILE_EXTENSIONS.has(ext) || (includePdf && ext === '.pdf')
}

function cleanHeading(text: string): string {
  return text
    .replace(/^\s{0,3}/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .trim()
}

function headingFromLine(text: string): string | null {
  const match = text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/)
  return match ? cleanHeading(match[0]) : null
}

function renderRetrievalSummary(snippets: WriteRetrievalSnippet[], totalMatches: number, stats: WriteIndexStats): string {
  if (snippets.length === 0) {
    return `No matching write context found. Indexed ${stats.indexedFiles} file(s) and ${stats.indexedChunks} chunk(s).`
  }
  const paths = [...new Set(snippets.map((snippet) => snippet.path))].slice(0, 4).join(', ')
  return `Found ${totalMatches} matching write context snippet(s); returning ${snippets.length}. Top paths: ${paths}.`
}

function renderPdfSummary(
  relativePath: string,
  pages: PdfTextPage[],
  pageCount: number,
  truncated: boolean,
  summaryOnly: boolean
): string {
  const pageList = pages.map((page) => page.page).join(', ')
  const charCount = pages.reduce((sum, page) => sum + Math.max(0, page.charEnd - page.charStart), 0)
  const mode = summaryOnly ? 'summary' : 'text'
  return [
    `Extracted ${mode} for ${relativePath}.`,
    `Pages returned: ${pageList || 'none'} of ${pageCount}.`,
    `Characters returned: ${charCount}.`,
    truncated ? 'More text is available via nextCursor.' : ''
  ].filter(Boolean).join(' ')
}

function compactText(text = ''): string {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
}

function clipTail(text = '', maxChars = 0): string {
  const source = String(text || '')
  if (!maxChars || source.length <= maxChars) return source
  return source.slice(source.length - maxChars)
}

function normalizeLower(text = ''): string {
  return String(text || '').normalize('NFKC').toLowerCase()
}

function deadlineExceeded(deadline: number): boolean {
  return Date.now() > deadline
}

async function safeSortedDirectoryEntries(path: string): Promise<Dirent[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.name !== '.DS_Store')
    .sort(compareDirents)
}

function compareDirents(a: Dirent, b: Dirent): number {
  const aDirectory = a.isDirectory()
  const bDirectory = b.isDirectory()
  if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function isLikelyBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true
  if (buffer.length === 0) return false
  let suspicious = 0
  for (const byte of buffer) {
    const allowedControl = byte === 7 || byte === 8 || byte === 9 || byte === 10 || byte === 12 || byte === 13
    if (byte < 32 && !allowedControl) suspicious += 1
  }
  return suspicious / buffer.length > 0.08
}

function resolveOptionalComparablePath(raw: string | undefined, workspaceRoot: string): string | undefined {
  const value = cleanOptionalPath(raw)
  if (!value) return undefined
  const normalized = expandHomePath(normalizeUserPath(value))
  return isAbsolute(normalized) ? resolve(normalized) : resolve(workspaceRoot, normalized)
}

async function canonicalPath(path: string): Promise<string> {
  return await realpath(path)
}

function cleanOptionalPath(path: string | undefined): string | undefined {
  const value = path?.trim()
  return value ? value : undefined
}

function normalizeUserPath(raw: string): string {
  const trimmed = raw.trim().replace(/\0/g, '')
  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) ? trimmed.slice(1, -1).trim() : trimmed
  return process.platform === 'win32' ? unquoted : unquoted.replace(/\\/g, '/')
}

function expandHomePath(raw: string): string {
  const value = raw.trim()
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function samePath(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b)
}

function comparablePath(path: string): string {
  const normalized = normalizePathSeparators(resolve(path)).replace(/\/+$/g, '')
  return process.platform === 'linux' ? normalized : normalized.toLowerCase()
}

function relativePathForDisplay(workspaceRoot: string, directPath: string, canonicalTarget?: string): string {
  const directRelative = relative(workspaceRoot, resolve(directPath))
  if (directRelative === '' || (!directRelative.startsWith('..') && !isAbsolute(directRelative))) {
    return normalizePathSeparators(directRelative)
  }
  return normalizePathSeparators(relative(workspaceRoot, canonicalTarget ?? directPath))
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/')
}

function resourcePathKey(value: string): string {
  return normalizePathSeparators(value).replace(/^\/+/, '')
}

function workspaceIdForRoot(workspaceRoot: string): string {
  return createHash('sha256').update(comparablePath(workspaceRoot)).digest('hex').slice(0, 16)
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  if (!/^\d+$/.test(cursor)) {
    throw serviceError('invalid_request', 'Cursor must be an integer offset returned by a previous call.', 'Use the nextCursor value unchanged.')
  }
  return Number(cursor)
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(Math.floor(value), max))
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

class WriteAssistServiceError extends Error {
  readonly code: WriteAssistErrorCode
  readonly retryable: boolean
  readonly suggestion: string

  constructor(code: WriteAssistErrorCode, reason: string, retryable: boolean, suggestion: string) {
    super(reason)
    this.name = 'WriteAssistServiceError'
    this.code = code
    this.retryable = retryable
    this.suggestion = suggestion
  }
}

function serviceError(
  code: WriteAssistErrorCode,
  reason: string,
  retryableOrSuggestion?: boolean | string,
  suggestion = 'Fix the request and retry.'
): WriteAssistServiceError {
  const retryable = typeof retryableOrSuggestion === 'boolean' ? retryableOrSuggestion : false
  const resolvedSuggestion = typeof retryableOrSuggestion === 'string' ? retryableOrSuggestion : suggestion
  return new WriteAssistServiceError(code, reason, retryable, resolvedSuggestion)
}

function failure(
  code: WriteAssistErrorCode,
  reason: string,
  retryable: boolean,
  suggestion: string
): WriteAssistFailure {
  return {
    ok: false,
    error: { code, reason, retryable, suggestion }
  }
}

function errorToWriteAssistError(error: unknown): WriteAssistError {
  if (error instanceof WriteAssistServiceError) {
    return {
      code: error.code,
      reason: error.message,
      retryable: error.retryable,
      suggestion: error.suggestion
    }
  }
  return {
    code: 'read_failed',
    reason: errorMessage(error),
    retryable: false,
    suggestion: 'Check that the workspace files are readable and retry.'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
