import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import {
  workspacePreviewTextReadRangeSchema,
  type WorkspacePreviewTextReadRange,
  type WorkspacePreviewTextReadResult
} from '@sciforge/domain-sdk/workspace-preview'

const MAX_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const cursorKey = randomBytes(32)
export type DocumentTextExtraction = { text: string; anchors?: { frameIndex: number; start: number; end: number }[] }
export type DocumentTextExtractor = { version: string; extract(bytes: Uint8Array): Promise<DocumentTextExtraction> }
type Snapshot = DocumentTextExtraction & { revision: string; id: string; cost: number }
const snapshots = new Map<string, Snapshot>()
const extractions = new Map<string, Promise<DocumentTextExtraction>>()
let cacheBytes = 0

/** A bounded, shared immutable snapshot; callers own their independent cursors. */
async function snapshot(path: string, extractor?: DocumentTextExtractor): Promise<{ source: string; value: Snapshot }> {
  const source = await realpath(path)
  const cacheKey = JSON.stringify([source, extractor?.version ?? 'utf8-v1'])
  const handle = await open(source, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > (extractor ? 128 * 1024 * 1024 : MAX_SOURCE_BYTES)) throw new Error('Document source exceeds the supported file size limit.')
    const revision = [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs].join(':')
    const cached = snapshots.get(cacheKey)
    if (cached?.revision === revision) {
      snapshots.delete(cacheKey)
      snapshots.set(cacheKey, cached)
      return { source, value: cached }
    }
    // Read with an explicit ceiling even if another writer grows the file.
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    const after = await handle.stat()
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('Preview source changed while reading; retry from the beginning.')
    }
    const content = bytes.subarray(0, length)
    const id = createHash('sha256').update(content).update(extractor?.version ?? 'utf8-v1').digest('hex')
    let extracted: DocumentTextExtraction
    if (extractor) {
      let pending = extractions.get(id)
      if (!pending) {
        pending = extractor.extract(content).finally(() => { extractions.delete(id) })
        extractions.set(id, pending)
      }
      extracted = await pending
    } else {
      extracted = { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content) }
    }
    const { text } = extracted
    if (text.length * 2 > MAX_CACHE_BYTES) throw new Error('Extracted document text exceeds the supported size limit.')
    if (text.includes('\0')) throw new Error('The preview asset is not UTF-8 source text.')
    const value = { revision, id, ...extracted, cost: text.length * 2 }
    const previous = snapshots.get(cacheKey)
    if (previous) { snapshots.delete(cacheKey); cacheBytes -= previous.cost }
    while (snapshots.size && (cacheBytes + value.cost > MAX_CACHE_BYTES || snapshots.size >= 8)) {
      const oldest = snapshots.keys().next().value!
      cacheBytes -= snapshots.get(oldest)!.cost
      snapshots.delete(oldest)
    }
    if (value.cost <= MAX_CACHE_BYTES) { snapshots.set(cacheKey, value); cacheBytes += value.cost }
    return { source, value }
  } finally { await handle.close() }
}

function sign(value: string): string { return createHmac('sha256', cursorKey).update(value).digest('base64url') }

/** Bounded UTF-8 source read shared by local and placed preview sessions. */
export async function readWorkspacePreviewTextRange(
  path: string,
  sessionId: string,
  input: WorkspacePreviewTextReadRange,
  extractor?: DocumentTextExtractor
): Promise<WorkspacePreviewTextReadResult> {
  const range = workspacePreviewTextReadRangeSchema.parse(input)
  const { source, value } = await snapshot(path, extractor)
  const sourceId = createHash('sha256').update(source).digest('hex')
  let offset = 0
  let scopeEnd = value.text.length
  let start = range.start ?? { line: 1, column: 1 }
  if (range.cursor) {
    const [payload, signature, extra] = range.cursor.split('.')
    if (!payload || !signature || extra || signature.length !== sign(payload).length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) throw new Error('Invalid or expired document cursor.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (decoded.source !== sourceId || decoded.snapshot !== value.id) throw new Error('Document cursor source version changed; restart the read.')
    if (!Number.isSafeInteger(decoded.offset) || decoded.offset < 0 || decoded.offset > value.text.length) throw new Error('Invalid document cursor offset.')
    offset = decoded.offset
    scopeEnd = decoded.scopeEnd
    start = decoded.position
  } else {
    let line = 1
    while (line < start.line) {
      const newline = value.text.indexOf('\n', offset)
      if (newline < 0) throw new Error('Text start is outside the source.')
      offset = newline + 1
      line++
    }
    const lineEnd = value.text.indexOf('\n', offset)
    offset += start.column - 1
    if (offset > (lineEnd < 0 ? value.text.length : lineEnd)) throw new Error('Text start is outside the source.')
    if (offset > 0 && /[\uDC00-\uDFFF]/u.test(value.text[offset] ?? '') && /[\uD800-\uDBFF]/u.test(value.text[offset - 1])) {
      throw new Error('Text start splits a Unicode character.')
    }
  }
  if (!range.cursor && (range.frameIndex || range.query)) {
    if (range.frameIndex) {
      const frame = value.anchors?.find(anchor => anchor.frameIndex === range.frameIndex)
      if (!frame) throw new Error('Requested frame is not available in the document text.')
      offset = frame.start
      scopeEnd = frame.end
    }
    if (range.query) {
      const match = value.text.indexOf(range.query, offset)
      if (match < 0 || match + range.query.length > scopeEnd) throw new Error('Requested text was not found in the selected document range.')
      offset = match
    }
    let line = 1
    let lastNewline = -1
    for (let next = value.text.indexOf('\n'); next >= 0 && next < offset; next = value.text.indexOf('\n', next + 1)) {
      line++
      lastNewline = next
    }
    start = { line, column: offset - lastNewline }
  }
  let endOffset = Math.min(scopeEnd, offset + range.maxCharacters)
  const pageAnchors = value.anchors?.filter(a => a.end > offset)
  if (pageAnchors && pageAnchors.length > 8) endOffset = Math.min(endOffset, pageAnchors[8].start)
  if (endOffset < value.text.length && /[\uDC00-\uDFFF]/u.test(value.text[endOffset])) endOffset--
  // Binary-search the escaped transport budget instead of repeatedly trimming
  // one character (which would be quadratic for heavily escaped documents).
  let lower = offset
  let upper = endOffset
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2)
    if (JSON.stringify(JSON.stringify(value.text.slice(offset, middle))).length <= 3800) lower = middle
    else upper = middle - 1
  }
  endOffset = lower
  if (endOffset < value.text.length && /[\uDC00-\uDFFF]/u.test(value.text[endOffset])) endOffset--
  // Prefer a paragraph boundary, without producing tiny pages for long paragraphs.
  const boundary = value.text.lastIndexOf('\n\n', endOffset - 2)
  if (endOffset < value.text.length && boundary >= offset + (endOffset - offset) / 2) endOffset = boundary + 2
  const text = value.text.slice(offset, endOffset)
  const end = { ...start }
  for (const char of text) {
    if (char === '\n') { end.line++; end.column = 1 }
    else end.column += char.length
  }
  const truncated = endOffset < scopeEnd
  const payload = Buffer.from(JSON.stringify({ source: sourceId, snapshot: value.id, offset: endOffset, scopeEnd, position: end })).toString('base64url')
  return { ok: true, sessionId, text, start, end, snapshotId: value.id, truncated,
    ...(value.anchors ? { anchors: value.anchors.filter(a => a.end > offset && a.start < endOffset).map(a => ({ frameIndex: a.frameIndex, start: Math.max(a.start, offset) - offset, end: Math.min(a.end, endOffset) - offset })) } : {}),
    ...(truncated ? { nextCursor: `${payload}.${sign(payload)}` } : {}) }
}
