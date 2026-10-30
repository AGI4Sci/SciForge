import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'
import type { PdfAnnotationKind } from '@shared/pdf-annotations'
import type { WriteRetrievalContext, WriteRetrievalSnippet } from '@shared/write-retrieval'

export const WRITE_QUOTE_ORIGINAL_START = '[引用原文]'
export const WRITE_QUOTE_ORIGINAL_END = '[/引用原文]'
export const WRITE_CONTEXT_HEADING = '[写作上下文]'
export const WRITE_QUOTE_HEADING = '[引用片段]'
export const WRITE_QUOTE_METADATA_PREFIX = '引用元数据:'
export const WRITE_RETRIEVAL_HEADING = '[相关文献上下文]'
export const WRITE_RETRIEVAL_END = '[/相关文献上下文]'

const WRITE_ASSISTANT_INTERACTION_RULE =
  '交互限制: 当前 GUI 无法提交 request_user_input 的 HTTP 响应；需要更多信息时，直接用普通文本向用户提问，不要调用 request_user_input。'
const WRITE_ASSISTANT_FILE_ACCESS_RULE =
  '文件访问限制: 写作助手已经自动附带引用片段和相关文献上下文；请直接基于这些内容与用户请求回答，不要为了读取、确认或补全当前写作文件而调用 shell、cat、sed、rg、grep、python 等命令。若上下文不足，直接说明需要更多选区或扩大检索。'

export type WriteQuotedSelectionSourceKind = 'text' | 'pdf'

export type WriteQuotedSelectionRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

type WriteQuotedSelectionRange = WriteEditorSelectionState['ranges'][number] & {
  page?: number
}

export type WriteQuotedSelectionInput = Omit<WriteEditorSelectionState, 'ranges'> & {
  ranges: WriteQuotedSelectionRange[]
  sourceKind?: WriteQuotedSelectionSourceKind
  pageStart?: number
  pageEnd?: number
  rects?: WriteQuotedSelectionRect[]
  pdfAnchorId?: string
  pdfAnnotationThreadId?: string
  pdfAnnotationKind?: PdfAnnotationKind
}

export type WriteQuotedSelection = {
  id: string
  text: string
  sourceKind?: WriteQuotedSelectionSourceKind
  sourceTitle: string
  sourceFilePath: string
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  rects?: WriteQuotedSelectionRect[]
  pdfAnchorId?: string
  pdfAnnotationThreadId?: string
  pdfAnnotationKind?: PdfAnnotationKind
  charCount: number
  createdAt: string
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function basenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

export function relativeWritePath(workspaceRoot: string, filePath: string): string {
  const root = normalizePath(workspaceRoot)
  const file = normalizePath(filePath)
  const prefix = `${root}/`
  if (root && file.startsWith(prefix)) return file.slice(prefix.length)
  return basenameFromPath(filePath)
}

function normalizedPositiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number)
}

function normalizedFiniteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

const PDF_ANNOTATION_KIND_VALUES = [
  'highlight',
  'comment',
  'note',
  'translation',
  'question',
  'answer'
] as const satisfies readonly PdfAnnotationKind[]

type WriteQuoteMetadata = Pick<WriteQuotedSelection, 'pdfAnchorId' | 'pdfAnnotationThreadId' | 'pdfAnnotationKind'>

function cleanOptionalValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim()
  return cleaned || undefined
}

function normalizedPdfAnnotationKind(value: unknown): PdfAnnotationKind | undefined {
  if (typeof value !== 'string') return undefined
  return PDF_ANNOTATION_KIND_VALUES.includes(value as PdfAnnotationKind) ? value as PdfAnnotationKind : undefined
}

function normalizeWriteQuoteMetadata(value: WriteQuoteMetadata): WriteQuoteMetadata {
  const pdfAnchorId = cleanOptionalValue(value.pdfAnchorId)
  const pdfAnnotationThreadId = cleanOptionalValue(value.pdfAnnotationThreadId)
  const pdfAnnotationKind = normalizedPdfAnnotationKind(value.pdfAnnotationKind)
  return {
    ...(pdfAnchorId ? { pdfAnchorId } : {}),
    ...(pdfAnnotationThreadId ? { pdfAnnotationThreadId } : {}),
    ...(pdfAnnotationKind ? { pdfAnnotationKind } : {})
  }
}

function hasWriteQuoteMetadata(metadata: WriteQuoteMetadata): boolean {
  return Boolean(metadata.pdfAnchorId || metadata.pdfAnnotationThreadId || metadata.pdfAnnotationKind)
}

function formatWriteQuoteMetadataLine(selection: WriteQuotedSelection): string | undefined {
  if (selection.sourceKind !== 'pdf') return undefined
  const metadata = normalizeWriteQuoteMetadata(selection)
  if (!hasWriteQuoteMetadata(metadata)) return undefined
  return `${WRITE_QUOTE_METADATA_PREFIX} ${JSON.stringify(metadata)}`
}

function normalizedPageRange(
  pageStart: number | undefined,
  pageEnd: number | undefined
): { pageStart?: number; pageEnd?: number } {
  if (pageStart == null && pageEnd == null) return {}
  const start = pageStart ?? pageEnd
  const end = pageEnd ?? pageStart
  if (start == null || end == null) return {}
  return {
    pageStart: Math.min(start, end),
    pageEnd: Math.max(start, end)
  }
}

function normalizeSelectionRects(rects: WriteQuotedSelectionRect[] | undefined): WriteQuotedSelectionRect[] {
  if (!rects?.length) return []
  const normalized: WriteQuotedSelectionRect[] = []
  for (const rect of rects) {
    const page = normalizedPositiveInteger(rect.page)
    const x = normalizedFiniteNumber(rect.x)
    const y = normalizedFiniteNumber(rect.y)
    const width = normalizedFiniteNumber(rect.width)
    const height = normalizedFiniteNumber(rect.height)
    if (page == null || x == null || y == null || width == null || height == null) continue
    if (width <= 0 || height <= 0) continue
    normalized.push({ page, x, y, width, height })
  }
  return normalized
}

function pageRangeFromRects(rects: WriteQuotedSelectionRect[]): { pageStart?: number; pageEnd?: number } {
  const pages = rects.map((rect) => rect.page).filter((page) => Number.isFinite(page) && page > 0)
  if (pages.length === 0) return {}
  return normalizedPageRange(Math.min(...pages), Math.max(...pages))
}

function formatCoordinate(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function pageLabel(pageStart: number, pageEnd: number): string {
  return pageStart === pageEnd ? `第${pageStart}页` : `第${pageStart}-${pageEnd}页`
}

export function formatWriteQuotedSelectionPosition(selection: Pick<WriteQuotedSelection, 'rects'>): string | undefined {
  const rects = normalizeSelectionRects(selection.rects)
  const first = rects[0]
  if (!first) return undefined
  const firstRect = [
    `p.${first.page}`,
    `x=${formatCoordinate(first.x)}`,
    `y=${formatCoordinate(first.y)}`,
    `w=${formatCoordinate(first.width)}`,
    `h=${formatCoordinate(first.height)}`
  ].join(' ')
  return rects.length > 1 ? `${firstRect} 等${rects.length}处` : firstRect
}

export function quotedSelectionFromEditor(
  selection: WriteQuotedSelectionInput,
  filePath: string,
  workspaceRoot: string,
  now = Date.now()
): WriteQuotedSelection | null {
  const text = selection.text.trim()
  if (!text || selection.charCount <= 0) return null
  const first = selection.ranges[0]
  const last = selection.ranges[selection.ranges.length - 1]
  const sourceKind: WriteQuotedSelectionSourceKind = selection.sourceKind === 'pdf' ? 'pdf' : 'text'
  const rects = normalizeSelectionRects(selection.rects)
  const explicitPageRange = normalizedPageRange(
    normalizedPositiveInteger(selection.pageStart ?? first?.page),
    normalizedPositiveInteger(selection.pageEnd ?? last?.page ?? selection.pageStart ?? first?.page)
  )
  const rectPageRange = pageRangeFromRects(rects)
  const pageRange = explicitPageRange.pageStart != null ? explicitPageRange : rectPageRange
  const pdfMetadata = normalizeWriteQuoteMetadata(selection)
  return {
    id: `quote-${now}-${Math.random().toString(36).slice(2)}`,
    text,
    sourceKind,
    sourceTitle: relativeWritePath(workspaceRoot, filePath),
    sourceFilePath: filePath,
    ...(sourceKind === 'pdf'
      ? {
          ...pageRange,
          ...(rects.length ? { rects } : {}),
          ...pdfMetadata
        }
      : {
          ...(first ? { lineStart: first.startLine } : {}),
          ...(last ? { lineEnd: last.endLine } : {})
        }),
    charCount: selection.charCount,
    createdAt: new Date(now).toISOString()
  }
}

export function formatWriteQuotedSelectionForPrompt(selection: WriteQuotedSelection): string {
  const metadataLine = formatWriteQuoteMetadataLine(selection)
  const rects = normalizeSelectionRects(selection.rects)
  const explicitPageRange = normalizedPageRange(
    normalizedPositiveInteger(selection.pageStart),
    normalizedPositiveInteger(selection.pageEnd ?? selection.pageStart)
  )
  const rectPageRange = pageRangeFromRects(rects)
  const pdfPageRange = explicitPageRange.pageStart != null ? explicitPageRange : rectPageRange
  if (selection.sourceKind === 'pdf' && pdfPageRange.pageStart != null && pdfPageRange.pageEnd != null) {
    const position = formatWriteQuotedSelectionPosition(selection)
    const metadata = [
      pageLabel(pdfPageRange.pageStart, pdfPageRange.pageEnd),
      ...(position ? [`位置: ${position}`] : []),
      `共${selection.charCount}字`
    ].join('，')
    return [
      `[引用片段] ${selection.sourceTitle}（${metadata}）路径: ${selection.sourceFilePath}`,
      ...(metadataLine ? [metadataLine] : []),
      WRITE_QUOTE_ORIGINAL_START,
      selection.text,
      WRITE_QUOTE_ORIGINAL_END
    ].join('\n')
  }
  if (selection.lineStart != null && selection.lineEnd != null) {
    return [
      `[引用片段] ${selection.sourceTitle}（第${selection.lineStart}-${selection.lineEnd}行，共${selection.charCount}字）路径: ${selection.sourceFilePath}`,
      ...(metadataLine ? [metadataLine] : []),
      WRITE_QUOTE_ORIGINAL_START,
      selection.text,
      WRITE_QUOTE_ORIGINAL_END
    ].join('\n')
  }
  return [
    `[引用片段] ${selection.sourceTitle}（共${selection.charCount}字）路径: ${selection.sourceFilePath}`,
    ...(metadataLine ? [metadataLine] : []),
    WRITE_QUOTE_ORIGINAL_START,
    selection.text,
    WRITE_QUOTE_ORIGINAL_END
  ].join('\n')
}

type WritePromptContext = {
  workspaceRoot?: string
  activeFilePath?: string | null
  retrieval?: WriteRetrievalContext | null
}

export type WritePromptDisplayContext = {
  workspaceRoot?: string
  activeFile?: string
  lines: string[]
}

export type WritePromptDisplayQuote = {
  sourceTitle: string
  sourceFilePath?: string
  sourceKind?: WriteQuotedSelectionSourceKind
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  position?: string
  pdfAnchorId?: string
  pdfAnnotationThreadId?: string
  pdfAnnotationKind?: PdfAnnotationKind
  charCount?: number
  text: string
}

export type WritePromptDisplayRetrievalSnippet = {
  location: string
  title?: string
  keywords?: string
  text: string
}

export type WritePromptDisplayRetrieval = {
  source?: string
  keywords?: string
  snippets: WritePromptDisplayRetrievalSnippet[]
}

export type WritePromptDisplay = {
  userInput: string
  context: WritePromptDisplayContext | null
  quotes: WritePromptDisplayQuote[]
  retrieval: WritePromptDisplayRetrieval | null
}

function formatWriteRetrievalSnippetLocation(snippet: WriteRetrievalSnippet): string {
  if (snippet.location.kind === 'pdf') {
    const page = snippet.location.pageStart === snippet.location.pageEnd
      ? `第${snippet.location.pageStart}页`
      : `第${snippet.location.pageStart}-${snippet.location.pageEnd}页`
    return `${snippet.path} ${page}`
  }
  return snippet.location.lineStart === snippet.location.lineEnd
    ? `${snippet.path}:${snippet.location.lineStart}`
    : `${snippet.path}:${snippet.location.lineStart}-${snippet.location.lineEnd}`
}

export function formatWriteRetrievalContextForPrompt(
  retrieval: WriteRetrievalContext | null | undefined
): string {
  if (!retrieval?.snippets.length) return ''
  const lines = [
    WRITE_RETRIEVAL_HEADING,
    `检索来源: ${retrieval.source}; 查询关键词: ${retrieval.keywords.join(', ')}`
  ]
  retrieval.snippets.forEach((snippet, index) => {
    lines.push('')
    lines.push(`[${index + 1}] ${formatWriteRetrievalSnippetLocation(snippet)}`)
    if (snippet.title) lines.push(`标题: ${snippet.title}`)
    lines.push(`匹配: ${snippet.keywords.join(', ')}`)
    lines.push(snippet.text)
  })
  lines.push(WRITE_RETRIEVAL_END)
  return lines.join('\n')
}

export function composeWritePrompt(
  input: string,
  selections: WriteQuotedSelection[],
  context: WritePromptContext = {}
): string {
  const body = input.trim()
  const contextLines: string[] = []
  contextLines.push(WRITE_ASSISTANT_INTERACTION_RULE)
  contextLines.push(WRITE_ASSISTANT_FILE_ACCESS_RULE)
  if (context.workspaceRoot?.trim()) {
    contextLines.push(`工作空间: ${context.workspaceRoot.trim()}`)
  }
  if (context.activeFilePath?.trim()) {
    const activeFile = relativeWritePath(context.workspaceRoot ?? '', context.activeFilePath)
    contextLines.push(`当前文件: ${activeFile}`)
  }
  const contextText = contextLines.length > 0
    ? `[写作上下文]\n${contextLines.join('\n')}`
    : ''
  const quoteText = selections.map(formatWriteQuotedSelectionForPrompt).join('\n\n')
  const retrievalText = formatWriteRetrievalContextForPrompt(context.retrieval)
  return [contextText, quoteText, retrievalText, body].filter(Boolean).join('\n\n')
}

function parseContextBlock(text: string): WritePromptDisplayContext {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  let workspaceRoot: string | undefined
  let activeFile: string | undefined

  for (const line of lines) {
    const workspaceMatch = line.match(/^工作空间:\s*(.+)$/)
    if (workspaceMatch?.[1]) {
      workspaceRoot = workspaceMatch[1].trim()
      continue
    }
    const fileMatch = line.match(/^当前文件:\s*(.+)$/)
    if (fileMatch?.[1]) {
      activeFile = fileMatch[1].trim()
    }
  }

  return {
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(activeFile ? { activeFile } : {}),
    lines
  }
}

function splitFirstSection(text: string): { head: string; rest: string } {
  const separator = text.search(/\n{2,}/)
  if (separator < 0) return { head: text.trim(), rest: '' }
  return {
    head: text.slice(0, separator).trim(),
    rest: text.slice(separator).trimStart()
  }
}

function parseQuoteHeader(header: string): Omit<WritePromptDisplayQuote, 'text'> {
  const body = header.replace(WRITE_QUOTE_HEADING, '').trim()
  const pathSplit = body.match(/^(.*?)\s*路径:\s*(.+)$/)
  const titleAndMeta = (pathSplit?.[1] ?? body).trim()
  const sourceFilePath = pathSplit?.[2]?.trim()
  const pdfMetaMatch = titleAndMeta.match(/^(.*?)（第(\d+)(?:[-–—](\d+))?页(?:，位置:\s*([^，]+))?，共(\d+)字）$/)
  if (pdfMetaMatch) {
    const pageStart = Number.parseInt(pdfMetaMatch[2] ?? '', 10)
    const pageEnd = Number.parseInt(pdfMetaMatch[3] ?? pdfMetaMatch[2] ?? '', 10)
    const position = pdfMetaMatch[4]?.trim()
    const charCount = Number.parseInt(pdfMetaMatch[5] ?? '', 10)
    return {
      sourceTitle: (pdfMetaMatch[1] ?? titleAndMeta).trim(),
      sourceKind: 'pdf',
      ...(sourceFilePath ? { sourceFilePath } : {}),
      ...(Number.isFinite(pageStart) ? { pageStart } : {}),
      ...(Number.isFinite(pageEnd) ? { pageEnd } : {}),
      ...(position ? { position } : {}),
      ...(Number.isFinite(charCount) ? { charCount } : {})
    }
  }

  const metaMatch = titleAndMeta.match(/^(.*?)（(?:第(\d+)[-–—](\d+)行，)?共(\d+)字）$/)
  const sourceTitle = (metaMatch?.[1] ?? titleAndMeta).trim()
  const lineStart = metaMatch?.[2] ? Number.parseInt(metaMatch[2], 10) : undefined
  const lineEnd = metaMatch?.[3] ? Number.parseInt(metaMatch[3], 10) : undefined
  const charCount = metaMatch?.[4] ? Number.parseInt(metaMatch[4], 10) : undefined

  return {
    sourceTitle,
    sourceKind: 'text',
    ...(sourceFilePath ? { sourceFilePath } : {}),
    ...(Number.isFinite(lineStart) ? { lineStart } : {}),
    ...(Number.isFinite(lineEnd) ? { lineEnd } : {}),
    ...(Number.isFinite(charCount) ? { charCount } : {})
  }
}

function parseWriteQuoteMetadataLine(line: string): WriteQuoteMetadata {
  if (!line.startsWith(WRITE_QUOTE_METADATA_PREFIX)) return {}
  const raw = line.slice(WRITE_QUOTE_METADATA_PREFIX.length).trim()
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return normalizeWriteQuoteMetadata(parsed as WriteQuoteMetadata)
  } catch {
    return {}
  }
}

function consumeQuoteMetadataLine(text: string): { metadata: WriteQuoteMetadata; rest: string } {
  if (!text.startsWith(WRITE_QUOTE_METADATA_PREFIX)) return { metadata: {}, rest: text }
  const firstLineEnd = text.indexOf('\n')
  const line = firstLineEnd < 0 ? text : text.slice(0, firstLineEnd)
  const rest = firstLineEnd < 0 ? '' : text.slice(firstLineEnd + 1).trimStart()
  return {
    metadata: parseWriteQuoteMetadataLine(line.trim()),
    rest
  }
}

function parseRetrievalBlock(text: string): WritePromptDisplayRetrieval {
  const lines = text.split('\n')
  let source: string | undefined
  let keywords: string | undefined
  const snippets: WritePromptDisplayRetrievalSnippet[] = []
  let current: { location: string; title?: string; keywords?: string; textLines: string[] } | null = null

  const commit = (): void => {
    if (!current) return
    snippets.push({
      location: current.location,
      ...(current.title ? { title: current.title } : {}),
      ...(current.keywords ? { keywords: current.keywords } : {}),
      text: current.textLines.join('\n').trim()
    })
    current = null
  }

  for (const line of lines) {
    const snippetStart = line.match(/^\[(\d+)\]\s+(.+)$/)
    if (snippetStart) {
      commit()
      current = { location: (snippetStart[2] ?? '').trim(), textLines: [] }
      continue
    }
    if (!current) {
      const sourceMatch = line.match(/^检索来源:\s*(.*?)(?:;\s*查询关键词:\s*(.*))?$/)
      if (sourceMatch) {
        source = sourceMatch[1]?.trim() || undefined
        keywords = sourceMatch[2]?.trim() || undefined
      }
      continue
    }
    const beforeBody = current.textLines.every((item) => !item.trim())
    const titleMatch = line.match(/^标题:\s*(.*)$/)
    if (titleMatch && current.title === undefined && beforeBody) {
      current.title = titleMatch[1]?.trim() || undefined
      continue
    }
    const keywordMatch = line.match(/^匹配:\s*(.*)$/)
    if (keywordMatch && current.keywords === undefined && beforeBody) {
      current.keywords = keywordMatch[1]?.trim() || undefined
      continue
    }
    current.textLines.push(line)
  }
  commit()

  return {
    ...(source ? { source } : {}),
    ...(keywords ? { keywords } : {}),
    snippets
  }
}

function consumeQuoteSection(text: string): { quote: WritePromptDisplayQuote | null; rest: string } {
  if (!text.startsWith(WRITE_QUOTE_HEADING)) return { quote: null, rest: text }
  const firstLineEnd = text.indexOf('\n')
  if (firstLineEnd < 0) return { quote: null, rest: text }

  const header = text.slice(0, firstLineEnd).trim()
  let rest = text.slice(firstLineEnd + 1).trimStart()
  const quoteMetadata = consumeQuoteMetadataLine(rest)
  rest = quoteMetadata.rest
  if (!rest.startsWith(WRITE_QUOTE_ORIGINAL_START)) {
    return { quote: null, rest: text }
  }

  rest = rest.slice(WRITE_QUOTE_ORIGINAL_START.length).trimStart()
  const originalEnd = rest.indexOf(WRITE_QUOTE_ORIGINAL_END)
  if (originalEnd < 0) return { quote: null, rest: text }

  const quotedText = rest.slice(0, originalEnd).trim()
  const afterQuote = rest.slice(originalEnd + WRITE_QUOTE_ORIGINAL_END.length).trimStart()
  const metadata = quoteMetadata.metadata
  return {
    quote: {
      ...parseQuoteHeader(header),
      ...(hasWriteQuoteMetadata(metadata) ? { sourceKind: 'pdf' as const } : {}),
      ...metadata,
      text: quotedText
    },
    rest: afterQuote
  }
}

export function parseWritePromptForDisplay(text: string): WritePromptDisplay | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (
    !normalized.includes(WRITE_CONTEXT_HEADING) &&
    !normalized.includes(WRITE_QUOTE_HEADING) &&
    !normalized.includes(WRITE_RETRIEVAL_HEADING)
  ) {
    return null
  }

  let rest = normalized
  let context: WritePromptDisplayContext | null = null
  const quotes: WritePromptDisplayQuote[] = []

  if (rest.startsWith(WRITE_CONTEXT_HEADING)) {
    rest = rest.slice(WRITE_CONTEXT_HEADING.length).trimStart()
    const contextSection = splitFirstSection(rest)
    context = parseContextBlock(contextSection.head)
    rest = contextSection.rest
  }

  while (rest.startsWith(WRITE_QUOTE_HEADING)) {
    const consumed = consumeQuoteSection(rest)
    if (!consumed.quote) break
    quotes.push(consumed.quote)
    rest = consumed.rest
  }

  let retrieval: WritePromptDisplayRetrieval | null = null
  if (rest.startsWith(WRITE_RETRIEVAL_HEADING)) {
    const endIndex = rest.indexOf(WRITE_RETRIEVAL_END)
    if (endIndex >= 0) {
      retrieval = parseRetrievalBlock(rest.slice(WRITE_RETRIEVAL_HEADING.length, endIndex))
      rest = rest.slice(endIndex + WRITE_RETRIEVAL_END.length).trimStart()
    }
  }

  if (!context && quotes.length === 0 && !retrieval) return null

  return {
    userInput: rest.trim(),
    context,
    quotes,
    retrieval
  }
}
