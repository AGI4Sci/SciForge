import { readFile, stat } from 'node:fs/promises'
import {
  getDocument,
  type TextContentItem
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  createPdfAnchor,
  stablePdfAnnotationSidecar,
  type PdfAnchorRect,
  type PdfAnnotation,
  type PdfAnnotationAuthor,
  type PdfAnnotationSidecar,
  type PdfAnnotationThread
} from '../../shared/pdf-annotations'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { resolveRuntimeModelRouterSettings } from '../../shared/app-settings-model-router'
import { buildModelRouterResponsesUrl } from '../../shared/model-router-url'
import { redactSecretText } from '../../shared/secret-redaction'
import type {
  PdfReviewGeneratePayload,
  PdfReviewGenerateResult,
  PdfReviewImproveAnnotationPayload,
  PdfReviewImproveAnnotationResult,
  PdfReviewSelection
} from '../../shared/pdf-review'
import {
  loadPdfAnnotationSidecar,
  savePdfAnnotationSidecar
} from './pdf-annotation-sidecar-service'
import {
  canonicalPath,
  resolveOpenTargetPath
} from './workspace-paths'

const REVIEW_AUTHOR_ID = 'sciforge-reviewer'
const REVIEW_ID_PREFIX = 'sciforge-review'
const DEFAULT_AUTO_REVIEW_COMMENT_COUNT = 8
const MAX_PDF_REVIEW_COMMENT_COUNT = 50
const MAX_PDF_REVIEW_CONTEXT_CHARS = 52_000
const MAX_PDF_REVIEW_PAGE_CHARS = 3_800
const MAX_PDF_REVIEW_BYTES = 80 * 1024 * 1024
const MODEL_REQUEST_TIMEOUT_MS = 120_000
const MAX_REVIEW_COMPLETION_ATTEMPTS = 3

type RawReviewComment = {
  id?: unknown
  selected_passage?: unknown
  page_number?: unknown
  matched_page?: unknown
  reviewer_concern?: unknown
  evidence_issue?: unknown
  suggested_tex_edit_intent?: unknown
  modification_advice?: unknown
  modified_text?: unknown
  severity?: unknown
  linked_source_file?: unknown
  rects?: unknown
}

type RawReviewData = {
  comments?: unknown
}

type ExtractedPdfWord = {
  page: number
  text: string
  token: string
  x: number
  y: number
  width: number
  height: number
}

type ExtractedPdfPage = {
  page: number
  text: string
  width: number
  height: number
  words: ExtractedPdfWord[]
}

type ExtractedPdf = {
  pages: ExtractedPdfPage[]
  text: string
}

type ReviewModelConfig = {
  url: string
  apiKey: string
  model: string
}

export type PdfReviewServiceOptions = {
  fetchImpl?: typeof fetch
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanCommentId(value: unknown, index: number): string {
  const raw = cleanText(value) || `C${String(index + 1).padStart(2, '0')}`
  return raw.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || `C${index + 1}`
}

function commentIdNumber(id: string): number | null {
  const match = id.match(/^C(\d+)$/iu)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function nextReviewCommentId(preferredId: string, usedIds: Set<string>, nextIndex: { value: number }): string {
  if (preferredId && !usedIds.has(preferredId)) {
    usedIds.add(preferredId)
    const preferredNumber = commentIdNumber(preferredId)
    if (preferredNumber !== null && preferredNumber >= nextIndex.value) nextIndex.value = preferredNumber + 1
    return preferredId
  }

  while (true) {
    const id = `C${String(nextIndex.value).padStart(2, '0')}`
    nextIndex.value += 1
    if (!usedIds.has(id)) {
      usedIds.add(id)
      return id
    }
  }
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wordToken(text: string): string {
  return text.replace(/2,000/gu, '2000').replace(/[^A-Za-z0-9]+/gu, '').toLowerCase()
}

function tokenise(text: string): string[] {
  return text
    .replace(/2,000/gu, '2000')
    .toLowerCase()
    .match(/[a-z0-9]+/gu) ?? []
}

function textItemString(item: TextContentItem): string {
  return typeof item.str === 'string' ? item.str : ''
}

function textItemTransform(item: TextContentItem): number[] {
  return Array.isArray(item.transform) ? item.transform : []
}

function rectsForWords(words: ExtractedPdfWord[]): PdfAnchorRect[] {
  const lines: ExtractedPdfWord[][] = []
  for (const word of words) {
    const existing = lines.find((line) => line[0] && Math.abs(line[0].y - word.y) <= 0.006)
    if (existing) existing.push(word)
    else lines.push([word])
  }
  return lines.map((line) => {
    const page = line[0]?.page ?? 1
    const x0 = Math.min(...line.map((word) => word.x))
    const x1 = Math.max(...line.map((word) => word.x + word.width))
    const y0 = Math.min(...line.map((word) => word.y))
    const y1 = Math.max(...line.map((word) => word.y + word.height))
    return {
      page,
      x: clamp(x0 - 0.002, 0, 1),
      y: clamp(y0 - 0.0015, 0, 1),
      width: clamp((x1 - x0) + 0.004, 0.0001, 1),
      height: clamp((y1 - y0) + 0.003, 0.0001, 1)
    }
  })
}

function normalizedRect(raw: unknown, page: number): PdfAnchorRect | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const x = numberValue(record.x)
  const y = numberValue(record.y)
  const width = numberValue(record.width ?? record.w)
  const height = numberValue(record.height ?? record.h)
  if (x == null || y == null || width == null || height == null) return null
  if (width <= 0 || height <= 0) return null
  return {
    page,
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    width: Math.min(1, Math.max(0.0001, width)),
    height: Math.min(1, Math.max(0.0001, height))
  }
}

function buildAnnotationBody(comment: RawReviewComment): string {
  const rows = [
    ['Reviewer concern', cleanText(comment.reviewer_concern)],
    ['Evidence issue', cleanText(comment.evidence_issue)],
    ['Modification advice', cleanText(comment.modification_advice) || cleanText(comment.suggested_tex_edit_intent)],
    ['Revised content', cleanText(comment.modified_text)],
    ['Source file', cleanText(comment.linked_source_file)],
    ['Severity', cleanText(comment.severity)]
  ].filter(([, value]) => value)
  return rows.map(([label, value]) => `${label}:\n${value}`).join('\n\n')
}

function ensureReviewAuthor(sidecar: PdfAnnotationSidecar, now: string): PdfAnnotationAuthor[] {
  if (sidecar.authors.some((author) => author.id === REVIEW_AUTHOR_ID)) return sidecar.authors
  return [
    ...sidecar.authors,
    {
      id: REVIEW_AUTHOR_ID,
      name: 'SciForge Reviewer',
      anonymous: false,
      createdAt: now,
      updatedAt: now
    }
  ]
}

function withoutPreviousReview(sidecar: PdfAnnotationSidecar): PdfAnnotationSidecar {
  const reviewThreadIds = new Set(
    sidecar.threads
      .filter((thread) => thread.id.startsWith(`${REVIEW_ID_PREFIX}-thread-`))
      .map((thread) => thread.id)
  )
  const reviewAnchorIds = new Set(
    sidecar.anchors
      .filter((anchor) => anchor.id.startsWith(`${REVIEW_ID_PREFIX}-anchor-`))
      .map((anchor) => anchor.id)
  )
  const reviewAnnotationIds = new Set(
    sidecar.annotations
      .filter((annotation) => annotation.id.startsWith(`${REVIEW_ID_PREFIX}-annotation-`))
      .map((annotation) => annotation.id)
  )
  return {
    ...sidecar,
    anchors: sidecar.anchors.filter((anchor) => !reviewAnchorIds.has(anchor.id)),
    annotations: sidecar.annotations.filter((annotation) =>
      !reviewAnnotationIds.has(annotation.id) && !reviewThreadIds.has(annotation.threadId)
    ),
    threads: sidecar.threads.filter((thread) => !reviewThreadIds.has(thread.id))
  }
}

async function readReviewData(path: string): Promise<RawReviewComment[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as RawReviewData
  if (!Array.isArray(parsed.comments)) {
    throw new Error('SciForge PDF review data must contain a comments array.')
  }
  return parsed.comments.filter((item): item is RawReviewComment => Boolean(item && typeof item === 'object'))
}

function wordsFromTextItem(
  item: TextContentItem,
  options: { page: number; pageWidth: number; pageHeight: number }
): ExtractedPdfWord[] {
  const text = textItemString(item)
  if (!text.trim()) return []
  const transform = textItemTransform(item)
  const rawX = numberValue(transform[4]) ?? 0
  const rawBaselineY = numberValue(transform[5]) ?? options.pageHeight
  const rawWidth = Math.max(1, numberValue(item.width) ?? text.length * 5)
  const rawHeight = Math.max(5, Math.abs(numberValue(item.height) ?? numberValue(transform[3]) ?? 10))
  const x = clamp(rawX / options.pageWidth, 0, 1)
  const y = clamp((options.pageHeight - rawBaselineY - rawHeight) / options.pageHeight, 0, 1)
  const width = clamp(rawWidth / options.pageWidth, 0.0001, 1)
  const height = clamp(rawHeight / options.pageHeight, 0.0001, 1)
  const matches = Array.from(text.matchAll(/\S+/gu))
  if (matches.length === 0) return []

  return matches.map((match) => {
    const word = match[0]
    const start = match.index ?? 0
    const ratioStart = text.length > 0 ? start / text.length : 0
    const ratioWidth = text.length > 0 ? word.length / text.length : 1
    return {
      page: options.page,
      text: word,
      token: wordToken(word),
      x: clamp(x + width * ratioStart, 0, 1),
      y,
      width: clamp(width * ratioWidth, 0.0001, 1),
      height
    }
  }).filter((word) => word.token)
}

async function extractPdfText(pdfPath: string): Promise<ExtractedPdf> {
  const info = await stat(pdfPath)
  if (info.size > MAX_PDF_REVIEW_BYTES) {
    throw new Error(`PDF review is limited to files up to ${Math.round(MAX_PDF_REVIEW_BYTES / 1024 / 1024)} MB.`)
  }
  const data = new Uint8Array(await readFile(pdfPath))
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true
  })
  const pdf = await loadingTask.promise
  const pages: ExtractedPdfPage[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const pageTextItems = content.items.map(textItemString).filter(Boolean)
      const words = content.items.flatMap((item) =>
        wordsFromTextItem(item, {
          page: pageNumber,
          pageWidth: viewport.width,
          pageHeight: viewport.height
        })
      )
      pages.push({
        page: pageNumber,
        text: pageTextItems.join(' ').replace(/\s+/gu, ' ').trim(),
        width: viewport.width,
        height: viewport.height,
        words
      })
      page.cleanup()
    }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }
  return {
    pages,
    text: pages.map((page) => `Page ${page.page}\n${page.text}`).join('\n\n')
  }
}

function findTokenMatch(tokens: string[], pages: ExtractedPdfPage[]): ExtractedPdfWord[] {
  if (tokens.length === 0) return []
  const candidateLengths = [...new Set([
    tokens.length,
    Math.min(28, tokens.length),
    Math.min(18, tokens.length),
    Math.min(12, tokens.length),
    Math.min(8, tokens.length),
    Math.min(5, tokens.length)
  ])].filter((length) => length >= 4)

  for (const length of candidateLengths) {
    const candidate = tokens.slice(0, length)
    for (const page of pages) {
      const pageTokens = page.words.map((word) => word.token)
      const limit = pageTokens.length - candidate.length
      for (let start = 0; start <= limit; start += 1) {
        if (pageTokens.slice(start, start + candidate.length).every((token, index) => token === candidate[index])) {
          return page.words.slice(start, start + candidate.length)
        }
      }
    }
  }
  return []
}

function selectionPageNumbers(selection?: PdfReviewSelection): Set<number> {
  const pages = new Set<number>()
  if (selection?.pageStart) pages.add(selection.pageStart)
  if (selection?.pageEnd) pages.add(selection.pageEnd)
  for (const rect of selection?.rects ?? []) pages.add(rect.page)
  return pages
}

function selectionQuote(selection?: PdfReviewSelection): string {
  return cleanText(selection?.text).slice(0, 8_000)
}

function normalizedSelectionRects(selection?: PdfReviewSelection): PdfAnchorRect[] {
  return (selection?.rects ?? [])
    .map((rect) => normalizedRect(rect, rect.page))
    .filter((rect): rect is PdfAnchorRect => Boolean(rect))
}

function anchorGeneratedComments(
  comments: RawReviewComment[],
  extracted: ExtractedPdf,
  selection?: PdfReviewSelection
): RawReviewComment[] {
  const selectedPages = selectionPageNumbers(selection)
  const selectionPages = selectedPages.size > 0
    ? extracted.pages.filter((page) => selectedPages.has(page.page))
    : []
  const searchablePages = selectionPages.length > 0 ? selectionPages : extracted.pages
  const fallbackRects = normalizedSelectionRects(selection)
  const fallbackQuote = selectionQuote(selection)

  return comments.map((comment) => {
    const selected = cleanText(comment.selected_passage)
    const tokens = tokenise(selected)
    const pageNumber = Math.max(1, Math.floor(numberValue(comment.page_number) ?? numberValue(comment.matched_page) ?? 1))
    const preferredPages = searchablePages.filter((page) => page.page === pageNumber)
    let matchedWords = findTokenMatch(tokens, preferredPages.length ? preferredPages : searchablePages)
    if (matchedWords.length === 0 && !selection) matchedWords = findTokenMatch(tokens, extracted.pages)
    if (matchedWords.length === 0 && fallbackRects.length > 0) {
      const matchedPage = fallbackRects[0]?.page ?? pageNumber
      return {
        ...comment,
        selected_passage: selected || fallbackQuote || `Selected PDF region on page ${matchedPage}`,
        matched_page: matchedPage,
        page_number: matchedPage,
        rects: fallbackRects
      }
    }
    if (matchedWords.length === 0) return comment
    return {
      ...comment,
      matched_page: matchedWords[0]?.page ?? pageNumber,
      page_number: matchedWords[0]?.page ?? pageNumber,
      rects: rectsForWords(matchedWords)
    }
  })
}

function resolveReviewModelConfig(settings?: AppSettingsV1): ReviewModelConfig {
  if (!settings) throw new Error('SciForge Model Router settings are unavailable for PDF review.')
  const router = resolveRuntimeModelRouterSettings(settings)
  const url = buildModelRouterResponsesUrl(router.baseUrl)
  if (!router.apiKey || !router.model || !url) {
    throw new Error('Configure SciForge Model Router before generating PDF review annotations.')
  }
  return {
    url,
    apiKey: router.apiKey,
    model: router.model
  }
}

function flattenModelContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
      return (item as { text: string }).text
    }
    return ''
  }).join('')
}

function modelTextFromResponse(responseText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    throw new Error('Model returned non-JSON response data.')
  }
  if (!parsed || typeof parsed !== 'object') return ''
  const record = parsed as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  if (Array.isArray(record.output)) {
    return record.output.map((item: unknown) => {
      if (!item || typeof item !== 'object') return ''
      const output = item as { text?: unknown; content?: unknown }
      return typeof output.text === 'string' ? output.text : flattenModelContent(output.content)
    }).join('')
  }
  const choices = Array.isArray(record.choices) ? record.choices : []
  const firstChoice = choices[0] as { text?: unknown; message?: { content?: unknown } } | undefined
  if (typeof firstChoice?.text === 'string') return firstChoice.text
  return flattenModelContent(firstChoice?.message?.content)
}

async function callReviewModel(
  prompt: string,
  settings?: AppSettingsV1,
  options: PdfReviewServiceOptions = {}
): Promise<string> {
  const config = resolveReviewModelConfig(settings)
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      instructions: 'You are SciForge Reviewer. Return only valid JSON and write all visible text in English.',
      input: prompt,
      max_output_tokens: 4096,
      text: { format: { type: 'json_object' } }
    }),
    signal: AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS)
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`SciForge review model request failed (${response.status}): ${redactSecretText(responseText).slice(0, 500)}`)
  }
  const text = modelTextFromResponse(responseText).trim()
  if (!text) throw new Error('SciForge review model returned empty text.')
  return text
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)
  if (fenced?.[1]?.trim()) return fenced[1].trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) return text.slice(first, last + 1)
  const firstArray = text.indexOf('[')
  const lastArray = text.lastIndexOf(']')
  if (firstArray >= 0 && lastArray > firstArray) return text.slice(firstArray, lastArray + 1)
  return text.trim()
}

function escapeControlCharactersInJsonStrings(text: string): string {
  let inString = false
  let escaped = false
  let result = ''
  for (const char of text) {
    if (!inString) {
      result += char
      if (char === '"') inString = true
      continue
    }
    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === '\\') {
      result += char
      escaped = true
      continue
    }
    if (char === '"') {
      result += char
      inString = false
      continue
    }
    if (char === '\n') {
      result += '\\n'
      continue
    }
    if (char === '\r') {
      result += '\\r'
      continue
    }
    if (char === '\t') {
      result += '\\t'
      continue
    }
    result += char
  }
  return result
}

function parseJsonWithRepairs(text: string): unknown {
  const extracted = extractJsonText(text)
  try {
    return JSON.parse(extracted) as unknown
  } catch (firstError) {
    try {
      return JSON.parse(escapeControlCharactersInJsonStrings(extracted)) as unknown
    } catch {
      throw firstError
    }
  }
}

function extractBalancedObjects(text: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }

  return objects
}

function extractCommentArrayText(text: string): string {
  const extracted = extractJsonText(text)
  const commentsIndex = extracted.search(/"comments"\s*:/iu)
  if (commentsIndex >= 0) {
    const arrayStart = extracted.indexOf('[', commentsIndex)
    if (arrayStart >= 0) return extracted.slice(arrayStart + 1)
  }
  if (extracted.trimStart().startsWith('[')) return extracted.slice(extracted.indexOf('[') + 1)
  return extracted
}

function salvageReviewCommentsJson(text: string): RawReviewComment[] {
  return extractBalancedObjects(extractCommentArrayText(text))
    .flatMap((objectText) => {
      try {
        const parsed = parseJsonWithRepairs(objectText)
        return parsed && typeof parsed === 'object' ? [parsed as RawReviewComment] : []
      } catch {
        return []
      }
    })
}

function parseReviewCommentsJson(text: string): RawReviewComment[] {
  let parsed: RawReviewData | RawReviewComment[]
  try {
    parsed = parseJsonWithRepairs(text) as RawReviewData | RawReviewComment[]
  } catch (error) {
    const salvaged = salvageReviewCommentsJson(text)
    if (salvaged.length > 0) return salvaged
    throw error
  }
  const comments = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.comments)
      ? parsed.comments
      : []
  return comments.filter((item): item is RawReviewComment => Boolean(item && typeof item === 'object'))
}

async function requestReviewComments(
  prompt: string,
  maxComments: number,
  settings?: AppSettingsV1,
  options: PdfReviewServiceOptions = {}
): Promise<RawReviewComment[]> {
  const modelText = await callReviewModel(prompt, settings, options)
  try {
    return parseReviewCommentsJson(modelText)
  } catch {
    const repairedText = await callReviewModel(buildReviewJsonRepairPrompt(modelText, maxComments), settings, options)
    return parseReviewCommentsJson(repairedText)
  }
}

function reviewCommentDedupeKey(comment: RawReviewComment): string {
  const passage = cleanText(comment.selected_passage)
  const concern = cleanText(comment.reviewer_concern)
  return (passage || concern)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .slice(0, 220)
}

function dedupeReviewComments(comments: RawReviewComment[]): RawReviewComment[] {
  const seen = new Set<string>()
  const out: RawReviewComment[] = []
  for (const comment of comments) {
    const key = reviewCommentDedupeKey(comment)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(comment)
  }
  return out
}

function withSequentialCommentIds(comments: RawReviewComment[]): RawReviewComment[] {
  return comments.map((comment, index) => ({
    ...comment,
    id: `C${String(index + 1).padStart(2, '0')}`
  }))
}

function pageContextForPrompt(extracted: ExtractedPdf, selection?: PdfReviewSelection): string {
  if (selection) {
    const pages = selectionPageNumbers(selection)
    const selectedPageText = extracted.pages
      .filter((page) => pages.size === 0 || pages.has(page.page))
      .map((page) => `Page ${page.page}:\n${page.text.slice(0, MAX_PDF_REVIEW_PAGE_CHARS)}`)
      .join('\n\n')
      .slice(0, Math.floor(MAX_PDF_REVIEW_CONTEXT_CHARS / 2))
    const quote = selectionQuote(selection)
    const pageLabel = pages.size > 0 ? [...pages].sort((a, b) => a - b).join(', ') : 'unknown'
    return [
      `Selected region pages: ${pageLabel}`,
      '',
      'Selected region text:',
      quote || '(visual selection without extracted text)',
      '',
      'Nearby page context:',
      selectedPageText || '(no extractable page context)'
    ].join('\n').slice(0, MAX_PDF_REVIEW_CONTEXT_CHARS)
  }

  let total = 0
  const chunks: string[] = []
  for (const page of extracted.pages) {
    if (total >= MAX_PDF_REVIEW_CONTEXT_CHARS) break
    const pageText = page.text.slice(0, MAX_PDF_REVIEW_PAGE_CHARS)
    const chunk = `Page ${page.page}:\n${pageText}`
    chunks.push(chunk)
    total += chunk.length
  }
  return chunks.join('\n\n').slice(0, MAX_PDF_REVIEW_CONTEXT_CHARS)
}

function reviewInstructionsForPrompt(prompt: string | undefined): string {
  const instructions = cleanText(prompt).slice(0, 20_000)
  if (!instructions) return ''
  return `Reviewer focus requested by the user:
<review_instructions>
${instructions}
</review_instructions>

Apply these instructions as review criteria. The review scope, grounding rules, and JSON output contract below remain authoritative.

`
}

function buildAutoReviewPrompt(
  extracted: ExtractedPdf,
  maxComments: number,
  selection?: PdfReviewSelection,
  prompt?: string
): string {
  const reviewScope = selection
    ? 'Review scope: Only review the selected PDF region. Do not create comments about text outside the selected region.'
    : 'Review scope: Review the full current PDF. If the PDF is long, review the provided visible context and say concerns grounded in that context.'
  const countRule = selection
    ? `Generate up to ${maxComments} comments. If the selected region is short or only supports one substantive critique, return one high-quality comment instead of splitting it artificially.`
    : `Generate exactly ${maxComments} distinct comments. Cover different passages across motivation, claims, methods, evaluation, evidence, limitations, and writing clarity when possible.`
  return `Review the current PDF independently and generate PDF-anchored reviewer comments.

${reviewScope}

${reviewInstructionsForPrompt(prompt)}Return only valid JSON in this exact shape:
{
  "comments": [
    {
      "id": "C01",
      "selected_passage": "exact text copied from the PDF context",
      "page_number": 1,
      "reviewer_concern": "specific concern",
      "evidence_issue": "why this text needs revision or evidence",
      "modification_advice": "how the authors should improve it",
      "modified_text": "a concise revised version of the selected passage",
      "severity": "major|moderate|minor",
      "linked_source_file": ""
    }
  ]
}

Rules:
- Write all fields in English.
- ${countRule}
- If the scope is a selected region, every selected_passage must come from that selected region.
- Use selected_passage as an exact copied span from the PDF context, preferably one or two sentences.
- Do not invent page numbers; use the page marker from the context.
- Prefer comments that can be acted on by editing the manuscript.
- Do not include Markdown fences or prose outside JSON.

PDF context:
${pageContextForPrompt(extracted, selection)}`
}

function buildSupplementalReviewPrompt(
  extracted: ExtractedPdf,
  remainingCount: number,
  existingComments: RawReviewComment[],
  prompt?: string
): string {
  const existingTargets = existingComments
    .map((comment, index) => {
      const passage = cleanText(comment.selected_passage).slice(0, 600)
      const concern = cleanText(comment.reviewer_concern).slice(0, 240)
      return `${index + 1}. ${passage || concern}`
    })
    .filter(Boolean)
    .join('\n')

  return `Continue the SciForge full-PDF review.

Return exactly ${remainingCount} additional, distinct PDF-anchored reviewer comments as valid JSON only.

${reviewInstructionsForPrompt(prompt)}Use this exact shape:
{
  "comments": [
    {
      "id": "C01",
      "selected_passage": "exact text copied from the PDF context",
      "page_number": 1,
      "reviewer_concern": "specific concern",
      "evidence_issue": "why this text needs revision or evidence",
      "modification_advice": "how the authors should improve it",
      "modified_text": "a concise revised version of the selected passage",
      "severity": "major|moderate|minor",
      "linked_source_file": ""
    }
  ]
}

Rules:
- Write all fields in English.
- Do not repeat any selected_passage or concern already listed below.
- Use selected_passage as an exact copied span from the PDF context.
- Prefer actionable comments from different pages or different sections.
- Do not include Markdown fences or prose outside JSON.

Existing comments to avoid:
${existingTargets || '(none)'}

PDF context:
${pageContextForPrompt(extracted)}`
}

function buildReviewJsonRepairPrompt(text: string, maxComments: number): string {
  return `The following model response was intended to be JSON for SciForge PDF review comments, but it is invalid or truncated.

Repair it into valid JSON only. Return this exact shape:
{
  "comments": [
    {
      "id": "C01",
      "selected_passage": "exact text copied from the PDF context",
      "page_number": 1,
      "reviewer_concern": "specific concern",
      "evidence_issue": "why this text needs revision or evidence",
      "modification_advice": "how the authors should improve it",
      "modified_text": "a concise revised version of the selected passage",
      "severity": "major|moderate|minor",
      "linked_source_file": ""
    }
  ]
}

Rules:
- Preserve the available comment content.
- Keep at most ${maxComments} complete comments.
- Drop incomplete comments rather than returning invalid JSON.
- Write all fields in English.
- Do not include Markdown fences or prose outside JSON.

Invalid response:
${text.slice(0, 12_000)}`
}

function parseImproveJson(text: string): { modificationAdvice: string; revisedContent: string; rationale: string } {
  const parsed = parseJsonWithRepairs(text) as {
    modification_advice?: unknown
    revised_content?: unknown
    modified_text?: unknown
    rationale?: unknown
  }
  const modificationAdvice = cleanText(parsed.modification_advice)
  const revisedContent = cleanText(parsed.revised_content) || cleanText(parsed.modified_text)
  const rationale = cleanText(parsed.rationale)
  if (!modificationAdvice || !revisedContent) {
    throw new Error('SciForge improvement response must contain modification_advice and revised_content.')
  }
  return { modificationAdvice, revisedContent, rationale }
}

function extractBodySection(body: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`${escapedHeading}:\\s*([\\s\\S]*?)(?:\\n\\n[A-Z][^\\n:]{1,80}:|$)`, 'u'))
  return cleanText(match?.[1])
}

function fallbackImproveAnnotation(input: {
  selectedText: string
  userComment: string
  annotationBody: string
}): { modificationAdvice: string; revisedContent: string; rationale: string } {
  const existingAdvice = extractBodySection(input.annotationBody, 'Modification advice')
  const existingRevision = extractBodySection(input.annotationBody, 'Suggested revised text') ||
    extractBodySection(input.annotationBody, 'Revised content')
  const concern = cleanText(input.userComment) ||
    extractBodySection(input.annotationBody, 'Reviewer concern') ||
    'Improve clarity, evidence, and precision for the selected passage.'
  const selectedText = cleanText(input.selectedText)
  const modificationAdvice = existingAdvice ||
    `Make the selected passage directly address this comment: ${concern} Add the missing qualifier, evidence, or quantitative support in the manuscript text rather than leaving the reader to infer it.`
  const revisedContent = existingRevision ||
    (selectedText
      ? `${selectedText} [Revise this passage by adding the concrete evidence, quantitative comparison, or limitation requested in the comment.]`
      : 'Add a concise revised passage that directly answers the comment with concrete evidence, quantitative support, and an explicit limitation where needed.')
  return {
    modificationAdvice,
    revisedContent,
    rationale: 'Model-backed improvement was unavailable, so SciForge generated this local fallback from the selected text and the existing annotation.'
  }
}

function buildImprovePrompt(input: {
  selectedText: string
  userComment: string
  page: number | null
}): string {
  return `A user selected a section of a PDF manuscript and wrote a comment. Provide a concrete improvement suggestion.

Return only valid JSON in this exact shape:
{
  "modification_advice": "specific advice for improving the selected text",
  "revised_content": "a revised version of the selected text",
  "rationale": "brief reason"
}

Rules:
- Write in English.
- Preserve technical meaning.
- If the user's comment asks for evidence, suggest what evidence or experiment should be added.
- Do not include Markdown fences or prose outside JSON.

Page: ${input.page ?? 'unknown'}

Selected text:
${input.selectedText || '(visual selection without extracted text)'}

User comment:
${input.userComment || '(no user comment provided; improve clarity, evidence, and precision)'}`
}

function appendReviewComments(
  sidecar: PdfAnnotationSidecar,
  comments: RawReviewComment[],
  options: { now: string; maxComments?: number; replaceExisting?: boolean }
): { sidecar: PdfAnnotationSidecar; commentCount: number; skippedCount: number } {
  const next = options.replaceExisting === false ? sidecar : withoutPreviousReview(sidecar)
  const anchors = [...next.anchors]
  const annotations = [...next.annotations]
  const threads = [...next.threads]
  const usedReviewIds = new Set(
    threads
      .map((thread) => thread.id.startsWith(`${REVIEW_ID_PREFIX}-thread-`)
        ? thread.id.slice(`${REVIEW_ID_PREFIX}-thread-`.length)
        : '')
      .filter(Boolean)
  )
  const nextReviewIndex = {
    value: Math.max(0, ...[...usedReviewIds].map((id) => commentIdNumber(id) ?? 0)) + 1
  }
  let commentCount = 0
  let skippedCount = 0
  const limited = comments.slice(0, options.maxComments ?? comments.length)

  limited.forEach((comment, index) => {
    const page = Math.max(1, Math.floor(numberValue(comment.matched_page) ?? numberValue(comment.page_number) ?? 1))
    const rects = Array.isArray(comment.rects)
      ? comment.rects.map((rect) => normalizedRect(rect, page)).filter((rect): rect is PdfAnchorRect => Boolean(rect))
      : []
    const quote = cleanText(comment.selected_passage)
    const body = buildAnnotationBody(comment)
    if (rects.length === 0 || !body) {
      skippedCount += 1
      return
    }

    const id = nextReviewCommentId(cleanCommentId(comment.id, index), usedReviewIds, nextReviewIndex)
    const anchorId = `${REVIEW_ID_PREFIX}-anchor-${id}`
    const threadId = `${REVIEW_ID_PREFIX}-thread-${id}`
    const annotationId = `${REVIEW_ID_PREFIX}-annotation-${id}`
    const anchor = createPdfAnchor({
      id: anchorId,
      kind: quote ? 'text' : 'visual',
      rects,
      quote: quote || `SciForge review target ${id}`,
      pdfFingerprint: next.pdfFingerprint,
      createdAt: options.now,
      updatedAt: options.now
    })
    const annotation: PdfAnnotation = {
      id: annotationId,
      threadId,
      anchorId,
      kind: 'comment',
      body,
      authorId: REVIEW_AUTHOR_ID,
      color: '#f59e0b',
      ...(quote ? { sourceText: quote } : {}),
      createdAt: options.now,
      updatedAt: options.now
    }
    const severity = cleanText(comment.severity)
    const thread: PdfAnnotationThread = {
      id: threadId,
      kind: 'comment',
      anchorIds: [anchorId],
      annotationIds: [annotationId],
      status: 'open',
      title: severity ? `${id} · ${severity}` : id,
      authorId: REVIEW_AUTHOR_ID,
      createdAt: options.now,
      updatedAt: options.now
    }
    anchors.push(anchor)
    annotations.push(annotation)
    threads.push(thread)
    commentCount += 1
  })

  return {
    sidecar: stablePdfAnnotationSidecar({
      ...next,
      anchors,
      annotations,
      threads,
      authors: ensureReviewAuthor(next, options.now),
      manifest: {
        ...next.manifest,
        updatedAt: options.now
      },
      updatedAt: options.now
    }),
    commentCount,
    skippedCount
  }
}

async function generateAutoReviewComments(
  payload: PdfReviewGeneratePayload,
  settings?: AppSettingsV1,
  options: PdfReviewServiceOptions = {}
): Promise<RawReviewComment[]> {
  const workspaceRoot = payload.workspaceRoot ? await canonicalPath(payload.workspaceRoot) : undefined
  const pdfPath = await resolveOpenTargetPath(payload.pdfPath, workspaceRoot)
  const extracted = await extractPdfText(pdfPath)
  if (extracted.pages.length === 0 || !extracted.text.trim()) {
    throw new Error('Could not extract text from the current PDF.')
  }
  const maxComments = clamp(Math.floor(payload.maxComments ?? DEFAULT_AUTO_REVIEW_COMMENT_COUNT), 1, MAX_PDF_REVIEW_COMMENT_COUNT)
  let comments = dedupeReviewComments(
    await requestReviewComments(
      buildAutoReviewPrompt(extracted, maxComments, payload.selection, payload.prompt),
      maxComments,
      settings,
      options
    )
  )

  if (!payload.selection) {
    for (let attempt = 1; comments.length < maxComments && attempt < MAX_REVIEW_COMPLETION_ATTEMPTS; attempt += 1) {
      const remainingCount = maxComments - comments.length
      const supplemental = await requestReviewComments(
        buildSupplementalReviewPrompt(extracted, remainingCount, comments, payload.prompt),
        remainingCount,
        settings,
        options
      )
      const nextComments = dedupeReviewComments([...comments, ...supplemental])
      if (nextComments.length <= comments.length) break
      comments = nextComments
    }
  }
  if (comments.length === 0) throw new Error('SciForge review model did not return any comments.')
  return withSequentialCommentIds(
    anchorGeneratedComments(comments.slice(0, maxComments), extracted, payload.selection)
  )
}

export async function generatePdfReviewAnnotations(
  payload: PdfReviewGeneratePayload,
  settings?: AppSettingsV1,
  options: PdfReviewServiceOptions = {}
): Promise<PdfReviewGenerateResult> {
  try {
    const workspaceRoot = payload.workspaceRoot ? await canonicalPath(payload.workspaceRoot) : undefined
    const importMode = Boolean(payload.reviewDataPath)
    const reviewDataPath = payload.reviewDataPath
      ? await resolveOpenTargetPath(payload.reviewDataPath, workspaceRoot)
      : undefined
    const comments = reviewDataPath
      ? await readReviewData(reviewDataPath)
      : await generateAutoReviewComments(payload, settings, options)
    const loaded = await loadPdfAnnotationSidecar(payload)
    if (!loaded.ok) return loaded

    const now = new Date().toISOString()
    const generated = appendReviewComments(loaded.sidecar, comments, {
      now,
      maxComments: payload.maxComments,
      replaceExisting: payload.replaceExisting
    })
    const saved = await savePdfAnnotationSidecar({
      ...payload,
      sidecar: generated.sidecar
    })
    if (!saved.ok) return saved

    return {
      ok: true,
      mode: importMode ? 'import' : 'auto',
      sidecar: saved.sidecar,
      path: saved.path,
      ...(reviewDataPath ? { reviewDataPath } : {}),
      commentCount: generated.commentCount,
      skippedCount: generated.skippedCount,
      generatedAt: now
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? redactSecretText(error.message) : redactSecretText(String(error)) }
  }
}

export async function improvePdfReviewAnnotation(
  payload: PdfReviewImproveAnnotationPayload,
  settings?: AppSettingsV1,
  options: PdfReviewServiceOptions = {}
): Promise<PdfReviewImproveAnnotationResult> {
  try {
    const loaded = await loadPdfAnnotationSidecar(payload)
    if (!loaded.ok) return loaded
    const sidecar = loaded.sidecar
    const thread = sidecar.threads.find((item) => item.id === payload.threadId)
    if (!thread) throw new Error('PDF annotation thread was not found.')
    const annotationId = payload.annotationId ?? thread.annotationIds[0]
    const annotation = annotationId
      ? sidecar.annotations.find((item) => item.id === annotationId)
      : undefined
    if (!annotation) throw new Error('PDF annotation was not found.')
    const anchor = sidecar.anchors.find((item) => item.id === annotation.anchorId) ||
      sidecar.anchors.find((item) => thread.anchorIds.includes(item.id))
    if (!anchor) throw new Error('PDF annotation anchor was not found.')

    const selectedText = annotation.sourceText?.trim() || anchor.quote.trim()
    const userComment = cleanText(payload.userComment) || annotation.body.trim()
    const page = anchor.rects[0]?.page ?? anchor.pageStart ?? null
    let improved: { modificationAdvice: string; revisedContent: string; rationale: string }
    try {
      const modelText = await callReviewModel(buildImprovePrompt({ selectedText, userComment, page }), settings, options)
      improved = parseImproveJson(modelText)
    } catch {
      improved = fallbackImproveAnnotation({
        selectedText,
        userComment,
        annotationBody: annotation.body
      })
    }
    const now = new Date().toISOString()
    const improvementBlock = [
      'SciForge improvement advice:',
      improved.modificationAdvice,
      '',
      'Suggested revised content:',
      improved.revisedContent,
      ...(improved.rationale ? ['', 'Rationale:', improved.rationale] : [])
    ].join('\n')
    const existingBody = annotation.body.trim()
    const updatedBody = existingBody
      ? `${existingBody}\n\n${improvementBlock}`
      : improvementBlock
    const nextSidecar = stablePdfAnnotationSidecar({
      ...sidecar,
      annotations: sidecar.annotations.map((item) =>
        item.id === annotation.id
          ? {
              ...item,
              body: updatedBody,
              updatedAt: now
            }
          : item
      ),
      threads: sidecar.threads.map((item) =>
        item.id === thread.id
          ? {
              ...item,
              status: 'open',
              updatedAt: now
            }
          : item
      ),
      manifest: {
        ...sidecar.manifest,
        updatedAt: now
      },
      updatedAt: now
    })
    const saved = await savePdfAnnotationSidecar({
      ...payload,
      sidecar: nextSidecar
    })
    if (!saved.ok) return saved
    return {
      ok: true,
      sidecar: saved.sidecar,
      path: saved.path,
      threadId: thread.id,
      annotationId: annotation.id,
      modificationAdvice: improved.modificationAdvice,
      revisedContent: improved.revisedContent,
      generatedAt: now
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? redactSecretText(error.message) : redactSecretText(String(error)) }
  }
}
