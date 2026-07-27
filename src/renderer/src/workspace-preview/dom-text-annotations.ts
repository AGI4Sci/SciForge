import type {
  DocumentAnnotationKind,
  DocumentNavigationRequest,
  DocumentTextAnnotationOverlay
} from './document-annotation-types'

const DEFAULT_CONTEXT_CHARS = 160
const IGNORED_TEXT_SELECTOR = [
  'button',
  'script',
  'style',
  '[aria-hidden="true"]',
  '.ds-code-block-header',
  '.ds-code-block-fade'
].join(',')

export type DocumentTextPosition = {
  line: number
  column: number
}

export type DocumentTextAnchor = {
  from: number
  to: number
  quote: string
  contextBefore: string
  contextAfter: string
  start: DocumentTextPosition
  end: DocumentTextPosition
}

export type DomDocumentTextAnchor = DocumentTextAnchor & {
  range: Range
}

export type DocumentTextOverlayRect = {
  top: number
  left: number
  width: number
  height: number
}

export type ResolvedDocumentTextOverlay = {
  id: string
  kind: DocumentAnnotationKind
  status?: 'open' | 'resolved'
  label?: string
  rects: DocumentTextOverlayRect[]
}

type NormalizedTextMap = {
  text: string
  starts: number[]
  ends: number[]
}

export function createDocumentTextAnchor(
  documentText: string,
  from: number,
  to: number,
  contextChars = DEFAULT_CONTEXT_CHARS
): DocumentTextAnchor | null {
  const lower = Math.max(0, Math.min(documentText.length, Math.min(from, to)))
  const upper = Math.max(lower, Math.min(documentText.length, Math.max(from, to)))
  const selected = documentText.slice(lower, upper)
  const leadingWhitespace = selected.match(/^\s*/u)?.[0].length ?? 0
  const trailingWhitespace = selected.match(/\s*$/u)?.[0].length ?? 0
  const startOffset = lower + leadingWhitespace
  const endOffset = Math.max(startOffset, upper - trailingWhitespace)
  const quote = normalizeInlineText(documentText.slice(startOffset, endOffset))
  if (!quote) return null

  return {
    from: startOffset,
    to: endOffset,
    quote,
    contextBefore: normalizeInlineText(documentText.slice(
      Math.max(0, startOffset - contextChars),
      startOffset
    )),
    contextAfter: normalizeInlineText(documentText.slice(
      endOffset,
      Math.min(documentText.length, endOffset + contextChars)
    )),
    start: documentTextPositionAtOffset(documentText, startOffset),
    end: documentTextPositionAtOffset(documentText, endOffset)
  }
}

export function resolveDocumentTextAnchor(
  documentText: string,
  input: Pick<DocumentTextAnnotationOverlay, 'quote' | 'contextBefore' | 'contextAfter' | 'textRange'>
): DocumentTextAnchor | null {
  const textRange = input.textRange
  if (
    textRange &&
    textRange.start >= 0 &&
    textRange.end >= textRange.start &&
    textRange.end <= documentText.length
  ) {
    const rangedAnchor = createDocumentTextAnchor(documentText, textRange.start, textRange.end)
    if (rangedAnchor && normalizeInlineText(rangedAnchor.quote) === normalizeInlineText(input.quote)) {
      return rangedAnchor
    }
  }

  const normalizedDocument = normalizeTextWithMap(documentText)
  const quote = normalizeInlineText(input.quote)
  if (!normalizedDocument.text || !quote) return null

  const contextBefore = normalizeInlineText(input.contextBefore ?? '')
  const contextAfter = normalizeInlineText(input.contextAfter ?? '')
  let best: { index: number; score: number } | null = null
  let cursor = 0
  while (cursor <= normalizedDocument.text.length - quote.length) {
    const index = normalizedDocument.text.indexOf(quote, cursor)
    if (index < 0) break
    const score = anchorContextScore(
      normalizedDocument.text,
      index,
      quote.length,
      contextBefore,
      contextAfter
    )
    if (!best || score > best.score) best = { index, score }
    cursor = index + 1
  }
  if (!best) return null

  const from = normalizedDocument.starts[best.index]
  const to = normalizedDocument.ends[best.index + quote.length - 1]
  if (from === undefined || to === undefined) return null
  return createDocumentTextAnchor(documentText, from, to)
}

export function documentTextPositionAtOffset(
  documentText: string,
  offset: number
): DocumentTextPosition {
  const target = Math.max(0, Math.min(documentText.length, offset))
  const before = documentText.slice(0, target)
  const lines = before.split('\n')
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1
  }
}

export function documentTextFromDom(root: HTMLElement): string {
  return documentTextNodes(root).map((node) => node.data).join('')
}

export function documentTextAnchorFromDomRange(
  root: HTMLElement,
  range: Range
): DomDocumentTextAnchor | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const nodes = documentTextNodes(root)
  const documentText = nodes.map((node) => node.data).join('')
  const from = domPointTextOffset(root, nodes, range.startContainer, range.startOffset)
  const to = domPointTextOffset(root, nodes, range.endContainer, range.endOffset)
  const anchor = createDocumentTextAnchor(documentText, from, to)
  if (!anchor) return null
  const trimmedRange = createDomRangeForOffsets(root, nodes, anchor.from, anchor.to)
  return trimmedRange ? { ...anchor, range: trimmedRange } : null
}

export function resolveDomDocumentTextAnchor(
  root: HTMLElement,
  input: Pick<DocumentTextAnnotationOverlay, 'quote' | 'contextBefore' | 'contextAfter' | 'textRange'>
): DomDocumentTextAnchor | null {
  const nodes = documentTextNodes(root)
  const documentText = nodes.map((node) => node.data).join('')
  const anchor = resolveDocumentTextAnchor(documentText, input)
  if (!anchor) return null
  const range = createDomRangeForOffsets(root, nodes, anchor.from, anchor.to)
  return range ? { ...anchor, range } : null
}

export function resolveDocumentTextOverlayRects(
  root: HTMLElement,
  scroller: HTMLElement,
  overlays: readonly DocumentTextAnnotationOverlay[]
): ResolvedDocumentTextOverlay[] {
  const scrollerRect = scroller.getBoundingClientRect()
  return overlays.flatMap((overlay): ResolvedDocumentTextOverlay[] => {
    const anchor = resolveDomDocumentTextAnchor(root, overlay)
    if (!anchor) return []
    const rects = Array.from(anchor.range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        top: rect.top - scrollerRect.top + scroller.scrollTop,
        left: rect.left - scrollerRect.left + scroller.scrollLeft,
        width: rect.width,
        height: rect.height
      }))
    if (!rects.length) return []
    return [{
      id: overlay.id,
      kind: overlay.kind,
      ...(overlay.status ? { status: overlay.status } : {}),
      ...(overlay.label ? { label: overlay.label } : {}),
      rects
    }]
  })
}

export function isNewDocumentNavigationRequest(
  handledRequestId: string | null,
  request: DocumentNavigationRequest | null | undefined
): request is DocumentNavigationRequest {
  return Boolean(request?.requestId && request.requestId !== handledRequestId)
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function normalizeTextWithMap(value: string): NormalizedTextMap {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  let index = 0
  while (index < value.length) {
    if (/\s/u.test(value[index] ?? '')) {
      const start = index
      while (index < value.length && /\s/u.test(value[index] ?? '')) index += 1
      if (text && !text.endsWith(' ')) {
        text += ' '
        starts.push(start)
        ends.push(index)
      }
      continue
    }
    text += value[index]
    starts.push(index)
    ends.push(index + 1)
    index += 1
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    starts.pop()
    ends.pop()
  }
  return { text, starts, ends }
}

function anchorContextScore(
  documentText: string,
  quoteStart: number,
  quoteLength: number,
  contextBefore: string,
  contextAfter: string
): number {
  const precedingText = documentText.slice(0, quoteStart).trimEnd()
  const followingText = documentText.slice(quoteStart + quoteLength).trimStart()
  const actualBefore = precedingText.slice(Math.max(0, precedingText.length - contextBefore.length))
  const actualAfter = followingText.slice(0, contextAfter.length)
  return commonSuffixLength(actualBefore, contextBefore) + commonPrefixLength(actualAfter, contextAfter)
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1
  return length
}

function commonSuffixLength(left: string, right: string): number {
  let length = 0
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) length += 1
  return length
}

function documentTextNodes(root: HTMLElement): Text[] {
  const ownerWindow = root.ownerDocument.defaultView
  const showText = ownerWindow?.NodeFilter.SHOW_TEXT ?? 4
  const accept = ownerWindow?.NodeFilter.FILTER_ACCEPT ?? 1
  const reject = ownerWindow?.NodeFilter.FILTER_REJECT ?? 2
  const walker = root.ownerDocument.createTreeWalker(root, showText, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!node.textContent || parent?.closest(IGNORED_TEXT_SELECTOR)) return reject
      return accept
    }
  })
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function domPointTextOffset(
  root: HTMLElement,
  nodes: readonly Text[],
  container: Node,
  offset: number
): number {
  let total = 0
  for (const node of nodes) {
    if (node === container) return total + Math.max(0, Math.min(node.data.length, offset))
    total += node.data.length
  }

  const prefix = root.ownerDocument.createRange()
  prefix.selectNodeContents(root)
  try {
    prefix.setEnd(container, offset)
    return Math.max(0, Math.min(total, prefix.toString().length))
  } catch {
    return total
  }
}

function createDomRangeForOffsets(
  root: HTMLElement,
  nodes: readonly Text[],
  from: number,
  to: number
): Range | null {
  const start = domPointAtOffset(nodes, from)
  const end = domPointAtOffset(nodes, to)
  if (!start || !end) return null
  const range = root.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

function domPointAtOffset(
  nodes: readonly Text[],
  targetOffset: number
): { node: Text; offset: number } | null {
  if (!nodes.length) return null
  const total = nodes.reduce((sum, node) => sum + node.data.length, 0)
  const target = Math.max(0, Math.min(total, targetOffset))
  let current = 0
  for (const node of nodes) {
    const next = current + node.data.length
    if (target <= next) return { node, offset: target - current }
    current = next
  }
  const last = nodes.at(-1)
  return last ? { node: last, offset: last.data.length } : null
}
