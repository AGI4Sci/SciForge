import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
  type WheelEvent as ReactWheelEvent
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clipboard,
  HelpCircle,
  Highlighter,
  Loader2,
  MessageSquare,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Quote,
  Search,
  StickyNote
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type TextContentItem
} from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import {
  clampContentScale,
  resolveContentZoomWheel,
  stepContentScale
} from '../../lib/content-zoom-shortcuts'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_MIN_SCALE = 0.65
const PDF_MAX_SCALE = 2.4
const PDF_SCALE_STEP = 0.1
const DEFAULT_PDF_SCALE = 1.15
const MAX_SELECTION_FRAGMENT_RECTS = 6000
const LINE_MERGE_WINDOW = 6
const TEXT_LAYER_TOKEN_HIT_PAD_X = 2
const TEXT_LAYER_TOKEN_HIT_PAD_Y = 5
const TEXT_LAYER_TOKEN_MAX_PICK_DISTANCE = 18
const MAX_SEARCH_HIGHLIGHTS_PER_PAGE = 240

type PageText = {
  page: number
  text: string
}

type WritePdfSearchIndexItem = {
  page: number
  pageMatchIndex: number
  globalIndex: number
}

type WritePdfSearchHighlight = {
  rect: WritePdfSelectionPageRect
  active: boolean
  matchIndex: number
}

type ViewportRect = {
  left: number
  top: number
  right: number
  bottom: number
}

type TextLayerPoint = {
  x: number
  y: number
}

type TextLayerToken = {
  text: string
  node: Text
  start: number
  end: number
  rect: DOMRect
  spanRect: DOMRect
  page: number
  order: number
  wordLike: boolean
}

export type WritePdfSelectionAnchorRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type WritePdfSelectionPageRect = {
  page: number
  /** Normalized page coordinates in the 0..1 range. */
  x: number
  y: number
  width: number
  height: number
}

export type WritePdfSelectionVisualImage = {
  dataUrl: string
  mimeType: string
  fileName: string
}

export type WritePdfSelectionRange = {
  from: number
  to: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  charCount: number
  page: number
}

export type WritePdfSelectionMetadata = {
  sourceKind: 'pdf'
  filePath: string
  sourceTitle: string
  mimeType: string
  size?: number
  mtimeMs?: number
  pageStart?: number
  pageEnd?: number
  pageCount?: number
  rects: WritePdfSelectionPageRect[]
}

export type WritePdfSelection = {
  text: string
  ranges: WritePdfSelectionRange[]
  charCount: number
  sourceKind: 'pdf'
  pageStart?: number
  pageEnd?: number
  anchorRect?: WritePdfSelectionAnchorRect
  rects?: WritePdfSelectionPageRect[]
  visualImage?: WritePdfSelectionVisualImage
  metadata: WritePdfSelectionMetadata
}

export type WritePdfAnnotationAction = 'highlight' | 'comment' | 'translation' | 'question' | 'copy'

export type WritePdfAnnotationOverlayKind =
  | 'highlight'
  | 'comment'
  | 'note'
  | 'translation'
  | 'question'
  | 'answer'

export type WritePdfAnnotationOverlay = {
  id: string
  kind: WritePdfAnnotationOverlayKind
  rects: WritePdfSelectionPageRect[]
  color?: string
  status?: 'open' | 'resolved'
  label?: string
}

export type WritePdfViewerProps = {
  filePath: string
  dataBase64?: string
  data?: Uint8Array | ArrayBuffer
  sourceUrl?: string
  mimeType?: string
  size?: number
  mtimeMs?: number
  workspaceRoot?: string
  className?: string
  viewerRef?: RefObject<HTMLDivElement | null>
  initialPage?: number
  initialScale?: number
  annotationOverlays?: WritePdfAnnotationOverlay[]
  activeAnnotationId?: string | null
  annotationsOpen?: boolean
  jumpToRect?: WritePdfSelectionPageRect | null
  onSelectionChange?: (selection: WritePdfSelection) => void
  onQuoteSelection?: (selection: WritePdfSelection) => void
  onAnnotationAction?: (action: WritePdfAnnotationAction, selection: WritePdfSelection) => void
  onAnnotationSelect?: (annotationId: string) => void
  onOpenAnnotations?: (selection: WritePdfSelection | null) => void
  onToggleAnnotations?: () => void
}

type PdfSelectionContext = {
  filePath: string
  sourceTitle: string
  mimeType: string
  size?: number
  mtimeMs?: number
  pageCount?: number
}

type VisualPdfDrag = {
  page: number
  pageRect: DOMRect
  pageElement: HTMLElement
  startX: number
  startY: number
}

type PdfContextMenuState = {
  left: number
  top: number
  selection: WritePdfSelection | null
}

const PDF_VIEWER_CSS = `
.write-pdf-viewer {
  user-select: text;
  -webkit-user-select: text;
}

.write-pdf-icon-button {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--ds-muted);
  transition: background 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}

.write-pdf-icon-button:hover:not(:disabled) {
  background: var(--ds-hover);
  color: var(--ds-ink);
}

.write-pdf-icon-button[data-active='true'] {
  background: color-mix(in srgb, var(--ds-accent) 12%, transparent);
  color: var(--ds-accent);
}

.write-pdf-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.write-pdf-page-input {
  width: 44px;
  border: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.72);
  padding: 3px 6px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-ink);
  outline: none;
}

[data-theme='dark'] .write-pdf-page-input {
  background: rgba(255, 255, 255, 0.08);
}

.write-pdf-page {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  background: #fff;
  user-select: text;
  -webkit-user-select: text;
  box-shadow:
    0 18px 50px rgba(20, 47, 95, 0.14),
    0 0 0 1px rgba(15, 23, 42, 0.08);
}

.write-pdf-canvas,
.write-pdf-text-layer,
.write-pdf-overlay-layer {
  position: absolute;
  inset: 0;
}

.write-pdf-canvas {
  display: block;
}

.write-pdf-text-layer {
  z-index: 1;
  overflow: hidden;
  opacity: 1;
  pointer-events: auto;
  line-height: 1;
  text-align: initial;
  caret-color: var(--ds-ink);
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  user-select: text;
  -webkit-user-select: text;
}

.write-pdf-text-layer :is(span, br) {
  color: rgba(0, 0, 0, 0.01);
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
  -webkit-user-select: text;
  z-index: 1;
}

.write-pdf-text-layer span.markedContent {
  top: 0;
  height: 0;
}

.write-pdf-text-layer span[role='img'] {
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.write-pdf-text-layer ::selection {
  background: var(--write-selection-bg, var(--ds-selection));
}

.write-pdf-text-layer br::selection,
.write-pdf-text-layer .write-pdf-text-ws::selection {
  background: transparent;
}

.write-pdf-text-layer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.write-pdf-overlay-layer {
  z-index: 2;
  pointer-events: none;
}

.write-pdf-selection-rect {
  position: absolute;
  border-radius: 3px;
  background: var(--write-selection-bg, var(--ds-selection));
}

.write-pdf-search-rect {
  position: absolute;
  z-index: 1;
  border-radius: 2px;
  background: rgba(250, 204, 21, 0.38);
  box-shadow: 0 0 0 1px rgba(180, 83, 9, 0.2);
  mix-blend-mode: multiply;
}

.write-pdf-search-rect[data-active='true'] {
  z-index: 2;
  background: rgba(59, 130, 246, 0.32);
  outline: 2px solid rgba(37, 99, 235, 0.9);
  outline-offset: 1px;
  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.18),
    0 0 16px rgba(37, 99, 235, 0.28);
}

[data-theme='dark'] .write-pdf-search-rect {
  background: rgba(250, 204, 21, 0.3);
  box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.2);
  mix-blend-mode: screen;
}

[data-theme='dark'] .write-pdf-search-rect[data-active='true'] {
  background: rgba(56, 189, 248, 0.3);
  outline-color: rgba(125, 211, 252, 0.9);
  box-shadow:
    0 0 0 3px rgba(56, 189, 248, 0.18),
    0 0 16px rgba(56, 189, 248, 0.3);
}

.write-pdf-viewer[data-live-selection] .write-pdf-selection-rect {
  opacity: 0;
}

.write-pdf-annotation-rect {
  position: absolute;
  border-radius: 3px;
  opacity: 0.34;
  mix-blend-mode: multiply;
}

[data-theme='dark'] .write-pdf-annotation-rect {
  mix-blend-mode: screen;
  opacity: 0.32;
}

.write-pdf-annotation-rect[data-kind='highlight'] {
  background: rgba(250, 204, 21, 0.42);
}

.write-pdf-annotation-rect[data-kind='comment'],
.write-pdf-annotation-rect[data-kind='note'] {
  background: rgba(59, 130, 246, 0.28);
}

.write-pdf-annotation-rect[data-kind='translation'] {
  background: rgba(16, 185, 129, 0.28);
}

.write-pdf-annotation-rect[data-kind='question'],
.write-pdf-annotation-rect[data-kind='answer'] {
  background: rgba(168, 85, 247, 0.25);
}

.write-pdf-annotation-rect[data-active='true'] {
  outline: 2px solid rgba(37, 99, 235, 0.75);
  outline-offset: 1px;
  opacity: 0.74;
}

.write-pdf-annotation-marker {
  position: absolute;
  right: 4px;
  top: 4px;
  display: inline-flex;
  height: 18px;
  min-width: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.16);
  background: rgba(255, 255, 255, 0.92);
  color: rgb(30, 41, 59);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  pointer-events: auto;
}

[data-theme='dark'] .write-pdf-annotation-marker {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(15, 23, 42, 0.88);
  color: rgba(255, 255, 255, 0.9);
}
`

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function basenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

function relativeToWorkspace(workspaceRoot: string | undefined, filePath: string): string {
  const root = normalizePath(workspaceRoot ?? '')
  const file = normalizePath(filePath)
  const prefix = `${root}/`
  if (root && file.startsWith(prefix)) return file.slice(prefix.length)
  return basenameFromPath(filePath)
}

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function nextScale(value: number, direction: 1 | -1): number {
  return stepContentScale(value, direction, {
    min: PDF_MIN_SCALE,
    max: PDF_MAX_SCALE,
    step: PDF_SCALE_STEP
  })
}

function normalizePdfScale(value: number): number {
  return clampContentScale(value, PDF_MIN_SCALE, PDF_MAX_SCALE)
}

function bytesFromBase64(base64: string): Uint8Array {
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const binary = window.atob(payload.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function pdfDataFromSource(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data
  return new Uint8Array(data)
}

function documentSourceFromProps({
  data,
  dataBase64,
  sourceUrl
}: Pick<WritePdfViewerProps, 'data' | 'dataBase64' | 'sourceUrl'>): unknown {
  if (data) {
    return {
      data: pdfDataFromSource(data),
      isEvalSupported: false,
      useSystemFonts: true
    }
  }
  if (dataBase64?.trim()) {
    return {
      data: bytesFromBase64(dataBase64),
      isEvalSupported: false,
      useSystemFonts: true
    }
  }
  if (sourceUrl?.trim()) {
    return {
      url: sourceUrl.trim(),
      isEvalSupported: false,
      useSystemFonts: true
    }
  }
  throw new Error('No PDF data source was provided.')
}

function unionRects(rects: DOMRect[]): WritePdfSelectionAnchorRect | undefined {
  if (rects.length === 0) return undefined
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined
  }
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function anchorRectFromDomRect(rect: DOMRect): WritePdfSelectionAnchorRect | undefined {
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
    return undefined
  }
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

function isSelectionBackward(selection: Selection): boolean {
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  if (!anchor || !focus) return false
  if (anchor === focus) return selection.anchorOffset > selection.focusOffset
  return Boolean(anchor.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_PRECEDING)
}

function intersects(a: ViewportRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function collectRangeTextRects(range: Range): DOMRect[] {
  const doc = range.startContainer.ownerDocument ?? window.document
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  const probe = doc.createRange()
  const rects: DOMRect[] = []

  let node: Node | null
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    walker.currentNode = range.startContainer
    node = range.startContainer
  } else {
    walker.currentNode = range.startContainer
    node = walker.nextNode()
  }

  while (node && rects.length < MAX_SELECTION_FRAGMENT_RECTS) {
    if (range.comparePoint(node, 0) > 0) break
    const text = node as Text
    if (text.data.trim() && range.intersectsNode(text)) {
      probe.selectNodeContents(text)
      if (text === range.startContainer) probe.setStart(text, range.startOffset)
      if (text === range.endContainer) probe.setEnd(text, range.endOffset)
      for (const rect of probe.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) rects.push(rect)
      }
    }
    if (text === range.endContainer) break
    node = walker.nextNode()
  }
  probe.detach()
  return rects
}

function mergeRectsIntoLineBars(rects: DOMRect[]): ViewportRect[] {
  if (rects.length === 0) return []
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  type LineBucket = { top: number; bottom: number; segments: Array<{ left: number; right: number }> }
  const lines: LineBucket[] = []

  for (const rect of sorted) {
    let target: LineBucket | null = null
    for (let index = lines.length - 1; index >= 0 && index >= lines.length - LINE_MERGE_WINDOW; index -= 1) {
      const line = lines[index]
      const overlap = Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top)
      if (overlap > 0 && overlap >= Math.min(line.bottom - line.top, rect.height) * 0.45) {
        target = line
        break
      }
    }
    if (target) {
      target.top = Math.min(target.top, rect.top)
      target.bottom = Math.max(target.bottom, rect.bottom)
      target.segments.push({ left: rect.left, right: rect.right })
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom, segments: [{ left: rect.left, right: rect.right }] })
    }
  }

  const bars: ViewportRect[] = []
  for (const line of lines) {
    const gapLimit = Math.max(10, (line.bottom - line.top) * 0.85)
    const segments = [...line.segments].sort((a, b) => a.left - b.left)
    let current = { ...segments[0] }
    for (let index = 1; index < segments.length; index += 1) {
      const segment = segments[index]
      if (segment.left - current.right <= gapLimit) {
        current.right = Math.max(current.right, segment.right)
      } else {
        bars.push({ left: current.left, right: current.right, top: line.top, bottom: line.bottom })
        current = { ...segment }
      }
    }
    bars.push({ left: current.left, right: current.right, top: line.top, bottom: line.bottom })
  }
  return bars
}

function viewportRectFromDomRect(rect: DOMRect): ViewportRect | null {
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
    return null
  }
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom
  }
}

function pageRectsFromViewportRects(root: HTMLElement, rects: ViewportRect[]): WritePdfSelectionPageRect[] {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-write-pdf-page]'))
    .map((element) => ({
      element,
      page: Number(element.dataset.writePdfPage ?? ''),
      rect: element.getBoundingClientRect()
    }))
    .filter((page) => Number.isFinite(page.page) && page.page > 0)
  const out: WritePdfSelectionPageRect[] = []

  for (const rect of rects) {
    const page = pages.find((item) => intersects(rect, item.rect))
    if (!page) continue
    const left = Math.max(rect.left, page.rect.left)
    const right = Math.min(rect.right, page.rect.right)
    const top = Math.max(rect.top, page.rect.top)
    const bottom = Math.min(rect.bottom, page.rect.bottom)
    if (right <= left || bottom <= top) continue
    out.push({
      page: page.page,
      x: clamp01((left - page.rect.left) / page.rect.width),
      y: clamp01((top - page.rect.top) / page.rect.height),
      width: clamp01((right - left) / page.rect.width),
      height: clamp01((bottom - top) / page.rect.height)
    })
  }
  return out
}

function rectStyleFromNormalizedRect(
  rect: WritePdfSelectionPageRect,
  pageSize: { width: number; height: number } | null
): CSSProperties {
  const width = pageSize?.width ?? 0
  const height = pageSize?.height ?? 0
  return {
    left: rect.x * width,
    top: rect.y * height,
    width: rect.width * width,
    height: rect.height * height
  }
}

function pageRectsFromViewportRectsForPage(
  pageElement: HTMLElement,
  page: number,
  rects: ViewportRect[]
): WritePdfSelectionPageRect[] {
  const pageRect = pageElement.getBoundingClientRect()
  const out: WritePdfSelectionPageRect[] = []

  for (const rect of rects) {
    if (!intersects(rect, pageRect)) continue
    const left = Math.max(rect.left, pageRect.left)
    const right = Math.min(rect.right, pageRect.right)
    const top = Math.max(rect.top, pageRect.top)
    const bottom = Math.min(rect.bottom, pageRect.bottom)
    if (right <= left || bottom <= top) continue
    out.push({
      page,
      x: clamp01((left - pageRect.left) / pageRect.width),
      y: clamp01((top - pageRect.top) / pageRect.height),
      width: clamp01((right - left) / pageRect.width),
      height: clamp01((bottom - top) / pageRect.height)
    })
  }

  return out
}

function anchorRectFromViewportRect(rect: ViewportRect): WritePdfSelectionAnchorRect {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top
  }
}

function visualSelectionFromViewportRect(
  rect: ViewportRect,
  page: number,
  pageRect: DOMRect,
  context: PdfSelectionContext
): WritePdfSelection {
  const left = clamp(rect.left, pageRect.left, pageRect.right)
  const right = clamp(rect.right, pageRect.left, pageRect.right)
  const top = clamp(rect.top, pageRect.top, pageRect.bottom)
  const bottom = clamp(rect.bottom, pageRect.top, pageRect.bottom)
  const normalized = {
    page,
    x: clamp01((left - pageRect.left) / pageRect.width),
    y: clamp01((top - pageRect.top) / pageRect.height),
    width: clamp01((right - left) / pageRect.width),
    height: clamp01((bottom - top) / pageRect.height)
  }
  return {
    text: '',
    ranges: [],
    charCount: 0,
    sourceKind: 'pdf',
    pageStart: page,
    pageEnd: page,
    anchorRect: anchorRectFromViewportRect({ left, right, top, bottom }),
    rects: [normalized],
    metadata: {
      sourceKind: 'pdf',
      filePath: context.filePath,
      sourceTitle: context.sourceTitle,
      mimeType: context.mimeType,
      size: context.size,
      mtimeMs: context.mtimeMs,
      pageStart: page,
      pageEnd: page,
      pageCount: context.pageCount,
      rects: [normalized]
    }
  }
}

function visualSelectionImageFileName(context: PdfSelectionContext, page: number): string {
  const baseName = context.sourceTitle.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${baseName || 'pdf'}-p${page}-selection.png`
}

function cropVisualSelectionImage(
  pageElement: HTMLElement,
  rect: WritePdfSelectionPageRect,
  context: PdfSelectionContext
): WritePdfSelectionVisualImage | undefined {
  const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas.write-pdf-canvas')
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return undefined
  const sourceX = clamp(Math.floor(rect.x * canvas.width), 0, canvas.width - 1)
  const sourceY = clamp(Math.floor(rect.y * canvas.height), 0, canvas.height - 1)
  const sourceWidth = clamp(Math.ceil(rect.width * canvas.width), 1, canvas.width - sourceX)
  const sourceHeight = clamp(Math.ceil(rect.height * canvas.height), 1, canvas.height - sourceY)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = sourceWidth
  outputCanvas.height = sourceHeight
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) return undefined
  outputContext.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  )
  return {
    dataUrl: outputCanvas.toDataURL('image/png'),
    mimeType: 'image/png',
    fileName: visualSelectionImageFileName(context, rect.page)
  }
}

function annotationMarkerLabel(kind: WritePdfAnnotationOverlayKind): string {
  switch (kind) {
    case 'comment':
    case 'note':
      return 'C'
    case 'translation':
      return 'T'
    case 'question':
      return '?'
    case 'answer':
      return 'A'
    case 'highlight':
      return ''
  }
}

function pageFromNode(node: Node | null): number | null {
  const element = node instanceof Element ? node : node?.parentElement
  const pageElement = element?.closest<HTMLElement>('[data-write-pdf-page]')
  const page = Number(pageElement?.dataset.writePdfPage ?? '')
  return Number.isFinite(page) && page > 0 ? page : null
}

function pageRangeFromSelection(
  selection: Selection,
  pageRects: WritePdfSelectionPageRect[]
): { pageStart: number; pageEnd: number } {
  const rectPages = pageRects.map((rect) => rect.page).filter((page) => Number.isFinite(page) && page > 0)
  if (rectPages.length > 0) {
    return {
      pageStart: Math.min(...rectPages),
      pageEnd: Math.max(...rectPages)
    }
  }
  const pageA = pageFromNode(selection.anchorNode)
  const pageB = pageFromNode(selection.focusNode)
  const pageStart = Math.min(pageA ?? pageB ?? 1, pageB ?? pageA ?? 1)
  const pageEnd = Math.max(pageA ?? pageB ?? pageStart, pageB ?? pageA ?? pageStart)
  return { pageStart, pageEnd }
}

function emptyPdfSelection(context: PdfSelectionContext): WritePdfSelection {
  return {
    text: '',
    ranges: [],
    charCount: 0,
    sourceKind: 'pdf',
    metadata: {
      sourceKind: 'pdf',
      filePath: context.filePath,
      sourceTitle: context.sourceTitle,
      mimeType: context.mimeType,
      size: context.size,
      mtimeMs: context.mtimeMs,
      pageCount: context.pageCount,
      rects: []
    }
  }
}

function domRectFromBounds(left: number, top: number, right: number, bottom: number): DOMRect | null {
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null
  }
  if (right <= left || bottom <= top) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

function unionDomRects(rects: DOMRect[]): DOMRect | null {
  if (rects.length === 0) return null
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  return domRectFromBounds(left, top, right, bottom)
}

let textMeasureCanvas: HTMLCanvasElement | null = null

function textMeasureContext(doc: Document): CanvasRenderingContext2D | null {
  try {
    textMeasureCanvas ??= doc.createElement('canvas')
    return textMeasureCanvas.getContext('2d')
  } catch {
    return null
  }
}

function measuredPdfTextRangeRect(node: Text, start: number, end: number, fallbackRect: DOMRect): DOMRect | null {
  const span = node.parentElement?.closest<HTMLElement>('.write-pdf-text-layer span')
  if (!span) return null
  const text = node.data
  if (end <= start || start < 0 || end > text.length) return null

  const style = span.ownerDocument.defaultView?.getComputedStyle(span)
  const context = textMeasureContext(span.ownerDocument)
  const letterSpacing = style?.letterSpacing && style.letterSpacing !== 'normal'
    ? Number.parseFloat(style.letterSpacing)
    : 0
  const extraSpacing = (value: string): number => {
    return Number.isFinite(letterSpacing) && value.length > 1 ? letterSpacing * (value.length - 1) : 0
  }
  const measure = (value: string): number => {
    if (!context) return value.length
    if (style?.font) context.font = style.font
    return context.measureText(value).width + extraSpacing(value)
  }

  const prefix = text.slice(0, start)
  const selected = text.slice(start, end)
  const fullWidth = measure(text)
  const selectedWidth = measure(selected)
  if (!Number.isFinite(fullWidth) || fullWidth <= 0 || !Number.isFinite(selectedWidth) || selectedWidth <= 0) {
    return null
  }

  const scaleX = fallbackRect.width / fullWidth
  const startX = measure(prefix) * scaleX
  const width = selectedWidth * scaleX
  const direction = style?.direction === 'rtl' ? 'rtl' : 'ltr'
  const left = direction === 'rtl'
    ? fallbackRect.right - startX - width
    : fallbackRect.left + startX

  const range = node.ownerDocument.createRange()
  let verticalRect: DOMRect | null = null
  try {
    range.setStart(node, start)
    range.setEnd(node, end)
    const rect = range.getBoundingClientRect()
    verticalRect = rect.width > 0 && rect.height > 0 ? rect : null
  } catch {
    verticalRect = null
  } finally {
    range.detach?.()
  }

  return domRectFromBounds(left, verticalRect?.top ?? fallbackRect.top, left + width, verticalRect?.bottom ?? fallbackRect.bottom)
}

function inflateViewportRect(rect: DOMRect, padX: number, padY: number): ViewportRect {
  return {
    left: rect.left - padX,
    right: rect.right + padX,
    top: rect.top - padY,
    bottom: rect.bottom + padY
  }
}

function splitTextLayerTokens(text: string): Array<{ text: string; start: number; end: number }> {
  const tokens: Array<{ text: string; start: number; end: number }> = []
  const matcher = /\S+/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) != null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length
    })
  }
  return tokens
}

function firstTextNodeForElement(element: HTMLElement): Text | null {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent) return child as Text
  }
  const doc = element.ownerDocument
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const node = walker.nextNode()
  return node instanceof Text ? node : null
}

function rectFromTextRange(node: Text, start: number, end: number, fallbackRect: DOMRect): DOMRect | null {
  if (end <= start || start < 0 || end > node.data.length) return null
  const measuredPdfRect = measuredPdfTextRangeRect(node, start, end, fallbackRect)
  if (measuredPdfRect) return measuredPdfRect

  const doc = node.ownerDocument
  const range = doc.createRange()
  try {
    range.setStart(node, start)
    range.setEnd(node, end)
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
    const rect = unionDomRects(rects) ?? anchorRectFromDomRect(range.getBoundingClientRect())
    if (rect && rect.width > 0 && rect.height > 0) {
      return rect instanceof DOMRect
        ? rect
        : domRectFromBounds(rect.left, rect.top, rect.right, rect.bottom)
    }
  } catch {
    // Fall back to a proportional slice of the PDF.js span when the browser rejects the text range.
  } finally {
    range.detach()
  }

  const length = Math.max(1, node.data.length)
  const left = fallbackRect.left + fallbackRect.width * (start / length)
  const right = fallbackRect.left + fallbackRect.width * (end / length)
  return domRectFromBounds(left, fallbackRect.top, right, fallbackRect.bottom)
}

function pageNumberFromElement(element: Element): number | null {
  const pageElement = element.closest<HTMLElement>('[data-write-pdf-page]')
  const page = Number(pageElement?.dataset.writePdfPage ?? '')
  return Number.isFinite(page) && page > 0 ? page : null
}

function collectTextLayerTokens(root: HTMLElement, scopes: Element | Element[] = root): TextLayerToken[] {
  const scopeList = Array.isArray(scopes) ? scopes : [scopes]
  const tokens: TextLayerToken[] = []
  let order = 0

  for (const scope of scopeList) {
    const spans = scope.matches?.('.write-pdf-text-layer span')
      ? [scope as HTMLElement]
      : Array.from(scope.querySelectorAll<HTMLElement>('.write-pdf-text-layer span'))
    for (const span of spans) {
      if (span.matches('[role="img"], .markedContent, .write-pdf-text-ws')) continue
      const node = firstTextNodeForElement(span)
      if (!node || !node.data.trim()) continue
      const page = pageNumberFromElement(span)
      if (!page) continue
      const spanRect = span.getBoundingClientRect()
      if (spanRect.width <= 0 || spanRect.height <= 0) continue
      for (const part of splitTextLayerTokens(node.data)) {
        const rect = rectFromTextRange(node, part.start, part.end, spanRect)
        if (!rect) continue
        tokens.push({
          text: part.text,
          node,
          start: part.start,
          end: part.end,
          rect,
          spanRect,
          page,
          order,
          wordLike: /[A-Za-z0-9]/.test(part.text)
        })
        order += 1
      }
    }
  }

  return tokens
}

function joinTextLayerTokens(tokens: TextLayerToken[]): string {
  let text = ''
  for (const token of tokens) {
    if (!text) {
      text = token.text
      continue
    }
    const previous = text.at(-1) ?? ''
    const noSpaceBefore = /^[,.;:?!%)]/.test(token.text)
    const noSpaceAfter = previous === '(' || previous === '['
    text += noSpaceBefore || noSpaceAfter ? token.text : ` ${token.text}`
  }
  return text.trim()
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

function buildPdfSearchIndex(pageTexts: PageText[], query: string): WritePdfSearchIndexItem[] {
  const matches: WritePdfSearchIndexItem[] = []
  for (const page of pageTexts) {
    const occurrences = findTextOccurrences(page.text, query)
    for (let index = 0; index < occurrences.length; index += 1) {
      matches.push({
        page: page.page,
        pageMatchIndex: index,
        globalIndex: matches.length
      })
    }
  }
  return matches.sort((a, b) => a.page - b.page || a.pageMatchIndex - b.pageMatchIndex)
    .map((match, index) => ({ ...match, globalIndex: index }))
}

function joinTextLayerTokensWithOffsets(tokens: TextLayerToken[]): {
  text: string
  parts: Array<{ token: TextLayerToken; start: number; end: number }>
} {
  let text = ''
  const parts: Array<{ token: TextLayerToken; start: number; end: number }> = []
  for (const token of [...tokens].sort((a, b) => a.order - b.order)) {
    if (text) {
      const previous = text.at(-1) ?? ''
      const noSpaceBefore = /^[,.;:?!%)]/.test(token.text)
      const noSpaceAfter = previous === '(' || previous === '['
      if (!noSpaceBefore && !noSpaceAfter) text += ' '
    }
    const start = text.length
    text += token.text
    parts.push({ token, start, end: text.length })
  }
  return { text: text.trim(), parts }
}

function searchHighlightsFromTextLayer(
  pageElement: HTMLElement,
  page: number,
  query: string,
  activePageMatchIndex: number | null
): WritePdfSearchHighlight[] {
  const needle = query.trim()
  if (!needle) return []
  const tokens = collectTextLayerTokens(pageElement, pageElement)
  if (tokens.length === 0) return []
  const joined = joinTextLayerTokensWithOffsets(tokens)
  const occurrences = findTextOccurrences(joined.text, needle)
  if (occurrences.length === 0) return []
  const highlightedIndexes = Array.from(
    { length: Math.min(MAX_SEARCH_HIGHLIGHTS_PER_PAGE, occurrences.length) },
    (_, index) => index
  )
  if (
    activePageMatchIndex != null &&
    activePageMatchIndex >= MAX_SEARCH_HIGHLIGHTS_PER_PAGE &&
    activePageMatchIndex < occurrences.length
  ) {
    highlightedIndexes.push(activePageMatchIndex)
  }

  const highlights: WritePdfSearchHighlight[] = []
  for (const matchIndex of highlightedIndexes) {
    const matchStart = occurrences[matchIndex]
    const matchEnd = matchStart + needle.length
    const rects: DOMRect[] = []
    for (const part of joined.parts) {
      if (part.end <= matchStart || part.start >= matchEnd) continue
      const localStart = Math.max(0, matchStart - part.start)
      const localEnd = Math.min(part.token.text.length, matchEnd - part.start)
      if (localEnd <= localStart) continue
      const rect = localStart === 0 && localEnd === part.token.text.length
        ? part.token.rect
        : rectFromTextRange(
            part.token.node,
            part.token.start + localStart,
            part.token.start + localEnd,
            part.token.spanRect
          )
      if (rect) rects.push(rect)
    }

    const pageRects = pageRectsFromViewportRectsForPage(pageElement, page, mergeRectsIntoLineBars(rects))
    const active = activePageMatchIndex === matchIndex
    for (const rect of pageRects) {
      highlights.push({ rect, active, matchIndex })
    }
  }
  return highlights
}

function selectionFromTextLayerTokens(
  root: HTMLElement,
  tokens: TextLayerToken[],
  context: PdfSelectionContext,
  backward = false
): WritePdfSelection | null {
  if (tokens.length === 0) return null
  const sorted = [...tokens].sort((a, b) => a.order - b.order)
  const text = joinTextLayerTokens(sorted)
  if (!text) return null
  const tokenRects = sorted.map((token) => token.rect)
  let rects = pageRectsFromViewportRects(root, mergeRectsIntoLineBars(tokenRects))
  if (rects.length === 0) {
    rects = pageRectsFromViewportRects(root, tokenRects.map((rect) => inflateViewportRect(rect, 0, 0)))
  }
  if (rects.length === 0) return null
  const pages = rects.map((rect) => rect.page)
  const pageStart = Math.min(...pages)
  const pageEnd = Math.max(...pages)
  const focusToken = sorted[backward ? 0 : sorted.length - 1]
  const anchorRect = anchorRectFromDomRect(focusToken.rect)
    ?? unionRects(tokenRects)
    ?? anchorRectFromDomRect(tokenRects[0])

  return {
    text,
    ranges: [{
      from: 0,
      to: text.length,
      startLine: pageStart,
      startColumn: 1,
      endLine: pageEnd,
      endColumn: text.length + 1,
      text,
      charCount: text.length,
      page: pageStart
    }],
    charCount: text.length,
    sourceKind: 'pdf',
    pageStart,
    pageEnd,
    anchorRect,
    rects,
    metadata: {
      sourceKind: 'pdf',
      filePath: context.filePath,
      sourceTitle: context.sourceTitle,
      mimeType: context.mimeType,
      size: context.size,
      mtimeMs: context.mtimeMs,
      pageStart,
      pageEnd,
      pageCount: context.pageCount,
      rects
    }
  }
}

function tokenIntersectsViewportRect(token: TextLayerToken, rect: ViewportRect): boolean {
  return intersects(rect, token.rect)
}

function tokenOverlapsRange(token: TextLayerToken, range: Range): boolean {
  try {
    if (!range.intersectsNode(token.node)) return false
    if (range.startContainer === token.node && range.startOffset >= token.end) return false
    if (range.endContainer === token.node && range.endOffset <= token.start) return false
    return true
  } catch {
    return false
  }
}

function textLayerScopesForSelection(root: HTMLElement, selection: Selection, rects: DOMRect[]): Element[] {
  const pageA = pageFromNode(selection.anchorNode)
  const pageB = pageFromNode(selection.focusNode)
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-write-pdf-page]'))
  if (pageA && pageB) {
    const pageStart = Math.min(pageA, pageB)
    const pageEnd = Math.max(pageA, pageB)
    const scoped = pages.filter((pageElement) => {
      const page = Number(pageElement.dataset.writePdfPage ?? '')
      return Number.isFinite(page) && page >= pageStart && page <= pageEnd
    })
    if (scoped.length > 0) return scoped
  }

  const bars = mergeRectsIntoLineBars(rects)
  if (bars.length > 0) {
    const scoped = pages.filter((pageElement) => {
      const pageRect = pageElement.getBoundingClientRect()
      return bars.some((bar) => intersects(bar, pageRect))
    })
    if (scoped.length > 0) return scoped
  }

  return [root]
}

function selectionFromRangeTextLayerTokens(
  root: HTMLElement,
  selection: Selection,
  range: Range,
  textRects: DOMRect[],
  context: PdfSelectionContext
): WritePdfSelection | null {
  const scopes = textLayerScopesForSelection(root, selection, textRects)
  const tokens = collectTextLayerTokens(root, scopes)
  if (tokens.length === 0) return null
  const bars = mergeRectsIntoLineBars(textRects)
  const selected = bars.length > 0
    ? tokens.filter((token) => bars.some((bar) => tokenIntersectsViewportRect(token, bar)))
    : tokens.filter((token) => tokenOverlapsRange(token, range))
  const unique = Array.from(new Map(selected.map((token) => [token.order, token])).values())
  return selectionFromTextLayerTokens(root, unique, context, isSelectionBackward(selection))
}

function pointInsideRect(point: TextLayerPoint, rect: ViewportRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

function pointDistanceToRect(point: TextLayerPoint, rect: DOMRect): number {
  const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0
  const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0
  return Math.hypot(dx, dy)
}

function nearestTokenToPoint(tokens: TextLayerToken[], point: TextLayerPoint): TextLayerToken | null {
  let best: TextLayerToken | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const token of tokens) {
    const hitRect = inflateViewportRect(token.rect, TEXT_LAYER_TOKEN_HIT_PAD_X, TEXT_LAYER_TOKEN_HIT_PAD_Y)
    if (pointInsideRect(point, hitRect)) return token
    const distance = pointDistanceToRect(point, token.rect)
    if (distance < bestDistance) {
      best = token
      bestDistance = distance
    }
  }
  return bestDistance <= TEXT_LAYER_TOKEN_MAX_PICK_DISTANCE ? best : null
}

function tokenHorizontalSelectionOverlap(token: TextLayerToken, left: number, right: number): number {
  return Math.max(0, Math.min(token.rect.right, right) - Math.max(token.rect.left, left))
}

function tokenHorizontalSelectionThreshold(token: TextLayerToken): number {
  return Math.min(4, Math.max(1, token.rect.width * 0.35))
}

function tokenSelectedBetweenX(token: TextLayerToken, left: number, right: number): boolean {
  const center = token.rect.left + token.rect.width / 2
  return (
    (center >= left && center <= right)
    || tokenHorizontalSelectionOverlap(token, left, right) >= tokenHorizontalSelectionThreshold(token)
  )
}

function tokenSelectedAfterX(token: TextLayerToken, x: number): boolean {
  const center = token.rect.left + token.rect.width / 2
  return center >= x || token.rect.right - x >= tokenHorizontalSelectionThreshold(token)
}

function tokenSelectedBeforeX(token: TextLayerToken, x: number): boolean {
  const center = token.rect.left + token.rect.width / 2
  return center <= x || x - token.rect.left >= tokenHorizontalSelectionThreshold(token)
}

type TextLayerTokenLine = {
  page: number
  top: number
  bottom: number
  tokens: TextLayerToken[]
}

function groupTokensIntoVisualLines(tokens: TextLayerToken[]): TextLayerTokenLine[] {
  const lines: TextLayerTokenLine[] = []
  const sorted = [...tokens].sort((a, b) => a.page - b.page || a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  for (const token of sorted) {
    let target: TextLayerTokenLine | null = null
    for (let index = lines.length - 1; index >= 0 && index >= lines.length - LINE_MERGE_WINDOW; index -= 1) {
      const line = lines[index]
      if (line.page !== token.page) continue
      const overlap = Math.min(line.bottom, token.rect.bottom) - Math.max(line.top, token.rect.top)
      if (overlap > 0 && overlap >= Math.min(line.bottom - line.top, token.rect.height) * 0.45) {
        target = line
        break
      }
    }
    if (target) {
      target.top = Math.min(target.top, token.rect.top)
      target.bottom = Math.max(target.bottom, token.rect.bottom)
      target.tokens.push(token)
    } else {
      lines.push({ page: token.page, top: token.rect.top, bottom: token.rect.bottom, tokens: [token] })
    }
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.rect.left - b.rect.left || a.order - b.order)
  }
  return lines.sort((a, b) => a.page - b.page || a.top - b.top || a.tokens[0].rect.left - b.tokens[0].rect.left)
}

function nearestLineToPoint(lines: TextLayerTokenLine[], point: TextLayerPoint, page: number | null): number {
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (page && line.page !== page) continue
    const verticalDistance = point.y < line.top ? line.top - point.y : point.y > line.bottom ? point.y - line.bottom : 0
    const lineLeft = Math.min(...line.tokens.map((token) => token.rect.left))
    const lineRight = Math.max(...line.tokens.map((token) => token.rect.right))
    const horizontalDistance = point.x < lineLeft ? lineLeft - point.x : point.x > lineRight ? point.x - lineRight : 0
    const distance = verticalDistance * 2 + horizontalDistance * 0.25
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  }
  return bestIndex
}

function pageAtTextLayerPoint(root: HTMLElement, point: TextLayerPoint): number | null {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-write-pdf-page]'))
  for (const pageElement of pages) {
    const rect = pageElement.getBoundingClientRect()
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue
    const page = Number(pageElement.dataset.writePdfPage ?? '')
    if (Number.isFinite(page) && page > 0) return page
  }
  return null
}

function selectionContainsPoint(root: HTMLElement, selection: WritePdfSelection, point: TextLayerPoint): boolean {
  const rects = selection.rects ?? selection.metadata.rects
  if (rects.length === 0) return false
  for (const rect of rects) {
    const pageElement = root.querySelector<HTMLElement>(`[data-write-pdf-page="${rect.page}"]`)
    if (!pageElement) continue
    const pageRect = pageElement.getBoundingClientRect()
    const viewportRect = {
      left: pageRect.left + rect.x * pageRect.width,
      right: pageRect.left + (rect.x + rect.width) * pageRect.width,
      top: pageRect.top + rect.y * pageRect.height,
      bottom: pageRect.top + (rect.y + rect.height) * pageRect.height
    }
    if (pointInsideRect(point, {
      left: viewportRect.left - TEXT_LAYER_TOKEN_HIT_PAD_X,
      right: viewportRect.right + TEXT_LAYER_TOKEN_HIT_PAD_X,
      top: viewportRect.top - TEXT_LAYER_TOKEN_HIT_PAD_Y,
      bottom: viewportRect.bottom + TEXT_LAYER_TOKEN_HIT_PAD_Y
    })) {
      return true
    }
  }
  return false
}

function selectionFromTextLayerDrag(
  root: HTMLElement,
  start: TextLayerPoint,
  end: TextLayerPoint,
  context: PdfSelectionContext
): WritePdfSelection | null {
  const startPage = pageAtTextLayerPoint(root, start)
  const endPage = pageAtTextLayerPoint(root, end)
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-write-pdf-page]'))
  const scopes = startPage && endPage
    ? pages.filter((pageElement) => {
      const page = Number(pageElement.dataset.writePdfPage ?? '')
      return Number.isFinite(page) && page >= Math.min(startPage, endPage) && page <= Math.max(startPage, endPage)
    })
    : pages.filter((pageElement) => {
      const rect = pageElement.getBoundingClientRect()
      return intersects({
        left: Math.min(start.x, end.x),
        right: Math.max(start.x, end.x),
        top: Math.min(start.y, end.y),
        bottom: Math.max(start.y, end.y)
      }, rect)
    })
  const tokens = collectTextLayerTokens(root, scopes.length > 0 ? scopes : root)
  if (tokens.length === 0) return null
  const lines = groupTokensIntoVisualLines(tokens)
  const startLineIndex = nearestLineToPoint(lines, start, startPage)
  const endLineIndex = nearestLineToPoint(lines, end, endPage)
  if (startLineIndex < 0 || endLineIndex < 0) return null

  const forward = startLineIndex < endLineIndex || (startLineIndex === endLineIndex && start.x <= end.x)
  const first = forward ? { lineIndex: startLineIndex, point: start } : { lineIndex: endLineIndex, point: end }
  const last = forward ? { lineIndex: endLineIndex, point: end } : { lineIndex: startLineIndex, point: start }
  const selected: TextLayerToken[] = []

  for (let lineIndex = first.lineIndex; lineIndex <= last.lineIndex; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue
    for (const token of line.tokens) {
      if (first.lineIndex === last.lineIndex) {
        const left = Math.min(first.point.x, last.point.x)
        const right = Math.max(first.point.x, last.point.x)
        if (tokenSelectedBetweenX(token, left, right)) selected.push(token)
      } else if (lineIndex === first.lineIndex) {
        if (tokenSelectedAfterX(token, first.point.x)) selected.push(token)
      } else if (lineIndex === last.lineIndex) {
        if (tokenSelectedBeforeX(token, last.point.x)) selected.push(token)
      } else {
        selected.push(token)
      }
    }
  }

  if (selected.length === 0 && first.lineIndex === last.lineIndex) {
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const token = nearestTokenToPoint(lines[first.lineIndex].tokens, midpoint)
    if (token) selected.push(token)
  }

  const unique = Array.from(new Map(selected.map((token) => [token.order, token])).values())
  return selectionFromTextLayerTokens(root, unique, context, !forward)
}

function selectionFromTextLayerElement(
  root: HTMLElement,
  element: Element | null,
  context: PdfSelectionContext,
  point?: TextLayerPoint
): WritePdfSelection | null {
  const span = element?.closest<HTMLElement>('.write-pdf-text-layer span')
  if (!span || span.matches('[role="img"]')) return null
  const tokens = collectTextLayerTokens(root, span)
  if (tokens.length > 0) {
    const token = point ? nearestTokenToPoint(tokens, point) : null
    return selectionFromTextLayerTokens(root, token ? [token] : tokens, context)
  }
  const text = (span.textContent ?? '').trim()
  if (!text) return null
  const viewportRect = viewportRectFromDomRect(span.getBoundingClientRect())
  if (!viewportRect) return null
  const rects = pageRectsFromViewportRects(root, [viewportRect])
  if (rects.length === 0) return null
  const pages = rects.map((rect) => rect.page)
  const pageStart = Math.min(...pages)
  const pageEnd = Math.max(...pages)
  return {
    text,
    ranges: [{
      from: 0,
      to: text.length,
      startLine: pageStart,
      startColumn: 1,
      endLine: pageEnd,
      endColumn: text.length + 1,
      text,
      charCount: text.length,
      page: pageStart
    }],
    charCount: text.length,
    sourceKind: 'pdf',
    pageStart,
    pageEnd,
    anchorRect: anchorRectFromViewportRect(viewportRect),
    rects,
    metadata: {
      sourceKind: 'pdf',
      filePath: context.filePath,
      sourceTitle: context.sourceTitle,
      mimeType: context.mimeType,
      size: context.size,
      mtimeMs: context.mtimeMs,
      pageStart,
      pageEnd,
      pageCount: context.pageCount,
      rects
    }
  }
}

function selectionFromPdf(
  root: HTMLElement,
  context: PdfSelectionContext,
  drag?: { start: TextLayerPoint; end: TextLayerPoint }
): WritePdfSelection {
  if (drag) {
    const dragSelection = selectionFromTextLayerDrag(root, drag.start, drag.end, context)
    if (dragSelection) return dragSelection
  }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return emptyPdfSelection(context)
  const anchorInside = selection.anchorNode ? root.contains(selection.anchorNode) : false
  const focusInside = selection.focusNode ? root.contains(selection.focusNode) : false
  if (!anchorInside || !focusInside) return emptyPdfSelection(context)

  const range = selection.getRangeAt(0)
  const textRects = collectRangeTextRects(range)
  const tokenSelection = selectionFromRangeTextLayerTokens(root, selection, range, textRects, context)
  if (tokenSelection) return tokenSelection

  const text = selection.toString().trim()
  if (!text) return emptyPdfSelection(context)
  let rects = pageRectsFromViewportRects(root, mergeRectsIntoLineBars(textRects))
  if (rects.length === 0) {
    const boundingRect = viewportRectFromDomRect(range.getBoundingClientRect())
    rects = boundingRect ? pageRectsFromViewportRects(root, [boundingRect]) : []
  }
  const { pageStart, pageEnd } = pageRangeFromSelection(selection, rects)
  const backward = isSelectionBackward(selection)
  const focusRect = textRects.length > 0
    ? textRects[backward ? 0 : textRects.length - 1]
    : null
  const anchorRect = (focusRect ? anchorRectFromDomRect(focusRect) : undefined)
    ?? unionRects(textRects)
    ?? anchorRectFromDomRect(range.getBoundingClientRect())

  return {
    text,
    ranges: [{
      from: 0,
      to: text.length,
      startLine: pageStart,
      startColumn: 1,
      endLine: pageEnd,
      endColumn: text.length + 1,
      text,
      charCount: text.length,
      page: pageStart
    }],
    charCount: text.length,
    sourceKind: 'pdf',
    pageStart,
    pageEnd,
    anchorRect,
    rects,
    metadata: {
      sourceKind: 'pdf',
      filePath: context.filePath,
      sourceTitle: context.sourceTitle,
      mimeType: context.mimeType,
      size: context.size,
      mtimeMs: context.mtimeMs,
      pageStart,
      pageEnd,
      pageCount: context.pageCount,
      rects
    }
  }
}

function WritePdfPage({
  document,
  pageNumber,
  scale,
  searchQuery,
  activeSearchMatchIndex,
  selectionRects,
  annotationOverlays,
  activeAnnotationId,
  onAnnotationSelect,
  onPageText
}: {
  document: PDFDocumentProxy
  pageNumber: number
  scale: number
  searchQuery: string
  activeSearchMatchIndex: number | null
  selectionRects: WritePdfSelectionPageRect[]
  annotationOverlays: WritePdfAnnotationOverlay[]
  activeAnnotationId?: string | null
  onAnnotationSelect?: (annotationId: string) => void
  onPageText: (page: PageText) => void
}): ReactElement {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const [textLayerRevision, setTextLayerRevision] = useState(0)
  const [searchHighlights, setSearchHighlights] = useState<WritePdfSearchHighlight[]>([])

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null

    const renderPage = async (): Promise<void> => {
      const canvas = canvasRef.current
      const textLayer = textLayerRef.current
      if (!canvas || !textLayer) return
      textLayer.replaceChildren()
      setSearchHighlights([])
      const page: PDFPageProxy = await document.getPage(pageNumber)
      if (cancelled) {
        page.cleanup()
        return
      }
      const viewport = page.getViewport({ scale })
      const outputScale = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setPageSize({ width: viewport.width, height: viewport.height })

      const context = canvas.getContext('2d')
      if (!context) {
        page.cleanup()
        return
      }
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
      const task = page.render({ canvasContext: context, viewport })
      renderTask = task
      await task.promise
      if (cancelled) {
        page.cleanup()
        return
      }

      const textContent = await page.getTextContent()
      const textLayerRenderer = new TextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport
      })
      await textLayerRenderer.render()
      if (!cancelled) {
        for (const span of Array.from(textLayer.querySelectorAll<HTMLElement>('span'))) {
          if (!(span.textContent ?? '').trim()) span.classList.add('write-pdf-text-ws')
        }
        const pageText = textContent.items
          .map((item: TextContentItem) => (typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' ')
          .trim()
        onPageText({ page: pageNumber, text: pageText })
        setTextLayerRevision((value) => value + 1)
      }
      page.cleanup()
    }

    void renderPage().catch(() => undefined)
    return () => {
      cancelled = true
      try {
        renderTask?.cancel()
      } catch {
        // pdf.js can throw when a completed render task is cancelled during cleanup.
      }
    }
  }, [document, onPageText, pageNumber, scale])

  useEffect(() => {
    const pageElement = pageRef.current
    if (!pageElement || !pageSize || !searchQuery.trim()) {
      setSearchHighlights([])
      return
    }
    setSearchHighlights(searchHighlightsFromTextLayer(pageElement, pageNumber, searchQuery, activeSearchMatchIndex))
  }, [activeSearchMatchIndex, pageNumber, pageSize, searchQuery, textLayerRevision])

  return (
    <div
      ref={pageRef}
      className="write-pdf-page"
      data-write-pdf-page={pageNumber}
      style={pageSize ? { width: pageSize.width, height: pageSize.height } : undefined}
    >
      <canvas ref={canvasRef} className="write-pdf-canvas" />
      <div ref={textLayerRef} className="write-pdf-text-layer textLayer" />
      <div className="write-pdf-overlay-layer">
        {searchHighlights.map((highlight, index) => (
          <span
            key={`search-${pageNumber}-${highlight.matchIndex}-${index}-${highlight.rect.x}-${highlight.rect.y}`}
            className="write-pdf-search-rect"
            data-active={highlight.active ? 'true' : undefined}
            style={rectStyleFromNormalizedRect(highlight.rect, pageSize)}
          />
        ))}
        {annotationOverlays.flatMap((overlay) => overlay.rects.map((rect, index) => {
          const markerLabel = overlay.label ?? annotationMarkerLabel(overlay.kind)
          const marker = markerLabel && index === 0
          return (
            <span
              key={`${overlay.id}-${pageNumber}-${index}-${rect.x}-${rect.y}`}
              className="write-pdf-annotation-rect"
              data-kind={overlay.kind}
              data-active={activeAnnotationId === overlay.id ? 'true' : undefined}
              style={{
                ...rectStyleFromNormalizedRect(rect, pageSize),
                ...(overlay.color ? { background: overlay.color } : {})
              }}
            >
              {marker ? (
                <button
                  type="button"
                  className="write-pdf-annotation-marker"
                  aria-label={overlay.label ?? overlay.kind}
                  title={overlay.label ?? overlay.kind}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAnnotationSelect?.(overlay.id)
                  }}
                >
                  {markerLabel}
                </button>
              ) : null}
            </span>
          )
        }))}
        {selectionRects.map((rect, index) => (
          <span
            key={`${pageNumber}-${index}-${rect.x}-${rect.y}`}
            className="write-pdf-selection-rect"
            style={rectStyleFromNormalizedRect(rect, pageSize)}
          />
        ))}
      </div>
    </div>
  )
}

export function WritePdfViewer({
  filePath,
  dataBase64,
  data,
  sourceUrl,
  mimeType = 'application/pdf',
  size,
  mtimeMs,
  workspaceRoot,
  className,
  viewerRef,
  initialPage = 1,
  initialScale = DEFAULT_PDF_SCALE,
  annotationOverlays = [],
  activeAnnotationId = null,
  annotationsOpen = false,
  jumpToRect = null,
  onSelectionChange,
  onQuoteSelection,
  onAnnotationAction,
  onAnnotationSelect,
  onOpenAnnotations,
  onToggleAnnotations
}: WritePdfViewerProps): ReactElement {
  const { t } = useTranslation('common')
  const localViewerRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const selectionSyncTimerRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const visualDragRef = useRef<VisualPdfDrag | null>(null)
  const textDragRef = useRef<{ start: TextLayerPoint; last: TextLayerPoint } | null>(null)
  const skipMouseUpSelectionSyncRef = useRef(false)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onQuoteSelectionRef = useRef(onQuoteSelection)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(() => normalizePdfScale(initialScale))
  const [pageInput, setPageInput] = useState(String(Math.max(1, Math.round(initialPage))))
  const [currentPage, setCurrentPage] = useState(Math.max(1, Math.round(initialPage)))
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [searchIndex, setSearchIndex] = useState(0)
  const [pageTexts, setPageTexts] = useState<PageText[]>([])
  const [committedSelection, setCommittedSelection] = useState<WritePdfSelection | null>(null)
  const [committedSelectionRects, setCommittedSelectionRects] = useState<WritePdfSelectionPageRect[]>([])
  const [contextMenu, setContextMenu] = useState<PdfContextMenuState | null>(null)
  const [liveSelection, setLiveSelection] = useState(false)
  const rootRef = viewerRef ?? localViewerRef
  const pageCount = pdfDocument?.numPages ?? 0
  const sourceTitle = useMemo(() => relativeToWorkspace(workspaceRoot, filePath), [filePath, workspaceRoot])
  const selectionContext = useMemo<PdfSelectionContext>(() => ({
    filePath,
    sourceTitle,
    mimeType,
    size,
    mtimeMs,
    pageCount
  }), [filePath, mimeType, mtimeMs, pageCount, size, sourceTitle])

  const label = useCallback((key: string, fallback: string, options: Record<string, unknown> = {}): string => {
    return t(key, { defaultValue: fallback, ...options })
  }, [t])

  const zoomIn = useCallback((): void => {
    setScale((value) => nextScale(value, 1))
  }, [])

  const zoomOut = useCallback((): void => {
    setScale((value) => nextScale(value, -1))
  }, [])

  const handleZoomWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    const direction = resolveContentZoomWheel(event)
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    if (direction === 'in') zoomIn()
    else zoomOut()
  }, [zoomIn, zoomOut])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    onQuoteSelectionRef.current = onQuoteSelection
  }, [onQuoteSelection])

  const emitSelection = useCallback((selection: WritePdfSelection): void => {
    onSelectionChangeRef.current?.(selection)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPdfDocument(null)
    setPageTexts([])
    setCommittedSelection(null)
    setCommittedSelectionRects([])
    setContextMenu(null)
    setLiveSelection(false)
    emitSelection(emptyPdfSelection({
      filePath,
      sourceTitle,
      mimeType,
      size,
      mtimeMs
    }))

    let task: ReturnType<typeof getDocument>
    try {
      task = getDocument(documentSourceFromProps({ data, dataBase64, sourceUrl }))
    } catch (reason) {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      }
      return () => {
        cancelled = true
      }
    }

    void task.promise.then((pdf) => {
      if (cancelled) {
        void pdf.destroy()
        return
      }
      const targetPage = clamp(Math.round(initialPage), 1, pdf.numPages || 1)
      setPdfDocument(pdf)
      setCurrentPage(targetPage)
      setPageInput(String(targetPage))
      setLoading(false)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data, dataBase64, emitSelection, filePath, initialPage, mimeType, mtimeMs, size, sourceTitle, sourceUrl])

  useEffect(() => {
    setScale(normalizePdfScale(initialScale))
  }, [filePath, initialScale, mtimeMs])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
      if (selectionSyncTimerRef.current != null) {
        window.clearTimeout(selectionSyncTimerRef.current)
        selectionSyncTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const empty = emptyPdfSelection(selectionContext)
    visualDragRef.current = null
    textDragRef.current = null
    setCommittedSelection(null)
    setCommittedSelectionRects([])
      setContextMenu(null)
      setLiveSelection(false)
      emitSelection(empty)
  }, [emitSelection, scale, selectionContext])

  const updatePageText = useCallback((page: PageText): void => {
    setPageTexts((current) => {
      const existing = current.find((item) => item.page === page.page)
      if (existing?.text === page.text) return current
      const next = current.filter((item) => item.page !== page.page)
      next.push(page)
      return next.sort((a, b) => a.page - b.page)
    })
  }, [])

  const scrollToPage = useCallback((page: number): void => {
    const clamped = clamp(Math.round(page), 1, pageCount || 1)
    setCurrentPage(clamped)
    setPageInput(String(clamped))
    pageRefs.current.get(clamped)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [pageCount])

  const updateCurrentPageFromScroll = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!scroller || pageRefs.current.size === 0) return
    const scrollerRect = scroller.getBoundingClientRect()
    const targetY = scrollerRect.top + scrollerRect.height * 0.42
    let bestPage = 1
    let bestDistance = Number.POSITIVE_INFINITY

    pageRefs.current.forEach((node, page) => {
      const rect = node.getBoundingClientRect()
      const distance = targetY >= rect.top && targetY <= rect.bottom
        ? 0
        : Math.min(Math.abs(targetY - rect.top), Math.abs(targetY - rect.bottom))
      if (distance < bestDistance) {
        bestDistance = distance
        bestPage = page
      }
    })

    setCurrentPage((value) => value === bestPage ? value : bestPage)
    setPageInput((value) => value === String(bestPage) ? value : String(bestPage))
  }, [])

  const schedulePageSync = useCallback((): void => {
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      updateCurrentPageFromScroll()
    })
  }, [updateCurrentPageFromScroll])

  const searchMatches = useMemo(() => {
    return buildPdfSearchIndex(pageTexts, deferredSearchQuery)
  }, [deferredSearchQuery, pageTexts])
  const activeSearchMatch = searchMatches[Math.min(searchIndex, Math.max(0, searchMatches.length - 1))] ?? null
  const firstSearchPage = searchMatches[0]?.page ?? null
  const allPageTextLoaded = pageCount > 0 && pageTexts.length >= pageCount
  const pdfHasText = pageTexts.some((page) => page.text.trim().length > 0)
  const visualSelectionEnabled = allPageTextLoaded && !pdfHasText
  const committedRectsByPage = useMemo(() => {
    const byPage = new Map<number, WritePdfSelectionPageRect[]>()
    for (const rect of committedSelectionRects) {
      const pageRects = byPage.get(rect.page)
      if (pageRects) pageRects.push(rect)
      else byPage.set(rect.page, [rect])
    }
    return byPage
  }, [committedSelectionRects])
  const annotationOverlaysByPage = useMemo(() => {
    const byPage = new Map<number, WritePdfAnnotationOverlay[]>()
    for (const overlay of annotationOverlays) {
      const rectsByPage = new Map<number, WritePdfSelectionPageRect[]>()
      for (const rect of overlay.rects) {
        const pageRects = rectsByPage.get(rect.page)
        if (pageRects) pageRects.push(rect)
        else rectsByPage.set(rect.page, [rect])
      }
      rectsByPage.forEach((rects, page) => {
        const pageOverlays = byPage.get(page)
        const pageOverlay = { ...overlay, rects }
        if (pageOverlays) pageOverlays.push(pageOverlay)
        else byPage.set(page, [pageOverlay])
      })
    }
    return byPage
  }, [annotationOverlays])

  useEffect(() => {
    setSearchIndex(0)
    if (firstSearchPage != null) scrollToPage(firstSearchPage)
  }, [deferredSearchQuery, firstSearchPage, scrollToPage])

  useEffect(() => {
    setSearchIndex((index) => {
      if (searchMatches.length === 0) return 0
      return Math.min(index, searchMatches.length - 1)
    })
  }, [searchMatches.length])

  const jumpSearch = useCallback((direction: 1 | -1): void => {
    if (searchMatches.length === 0) return
    const nextIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
    setSearchIndex(nextIndex)
    scrollToPage(searchMatches[nextIndex].page)
  }, [scrollToPage, searchIndex, searchMatches])

  useEffect(() => {
    if (!activeSearchMatch || !deferredSearchQuery.trim()) return
    const frame = window.requestAnimationFrame(() => {
      const root = rootRef.current
      const activeRect = root?.querySelector<HTMLElement>('.write-pdf-search-rect[data-active="true"]')
      if (activeRect) {
        activeRect.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSearchMatch, deferredSearchQuery, rootRef])

  const syncSelection = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const next = selectionFromPdf(root, selectionContext)
    emitSelection(next)
    if (next.text.trim()) {
      setCommittedSelection(next)
      setCommittedSelectionRects(next.rects ?? [])
      setLiveSelection(true)
    } else {
      setCommittedSelection(null)
      setCommittedSelectionRects([])
      setLiveSelection(false)
    }
  }, [emitSelection, rootRef, selectionContext])

  const syncSelectionSoon = useCallback((): void => {
    if (selectionSyncTimerRef.current != null) {
      window.clearTimeout(selectionSyncTimerRef.current)
    }
    selectionSyncTimerRef.current = window.setTimeout(() => {
      selectionSyncTimerRef.current = null
      syncSelection()
    }, 0)
  }, [syncSelection])

  useEffect(() => {
    const handleSelectionChange = (): void => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!root) return
      if (textDragRef.current) return
      if (!selection || selection.rangeCount === 0) {
        setLiveSelection(false)
        return
      }
      const anchorInside = selection.anchorNode ? root.contains(selection.anchorNode) : false
      const focusInside = selection.focusNode ? root.contains(selection.focusNode) : false
      if (anchorInside || focusInside) {
        syncSelectionSoon()
      } else {
        setLiveSelection(false)
      }
    }
    window.document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      window.document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [rootRef, syncSelectionSoon])

  const pageAtPointer = useCallback((clientX: number, clientY: number): { page: number; rect: DOMRect; element: HTMLElement } | null => {
    const root = rootRef.current
    if (!root) return null
    const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-write-pdf-page]'))
    for (const pageElement of pages) {
      const rect = pageElement.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue
      const page = Number(pageElement.dataset.writePdfPage ?? '')
      if (Number.isFinite(page) && page > 0) return { page, rect, element: pageElement }
    }
    return null
  }, [rootRef])

  const commitVisualSelection = useCallback((
    drag: VisualPdfDrag,
    clientX: number,
    clientY: number,
    includeVisualImage = false
  ): void => {
    const viewportRect = {
      left: Math.min(drag.startX, clientX),
      right: Math.max(drag.startX, clientX),
      top: Math.min(drag.startY, clientY),
      bottom: Math.max(drag.startY, clientY)
    }
    if (viewportRect.right - viewportRect.left < 4 || viewportRect.bottom - viewportRect.top < 4) {
      const empty = emptyPdfSelection(selectionContext)
      setCommittedSelection(null)
      setCommittedSelectionRects([])
      setLiveSelection(false)
      emitSelection(empty)
      return
    }
    const selection = visualSelectionFromViewportRect(viewportRect, drag.page, drag.pageRect, selectionContext)
    const visualImage = includeVisualImage && selection.rects?.[0]
      ? cropVisualSelectionImage(drag.pageElement, selection.rects[0], selectionContext)
      : undefined
    const selectionWithImage = visualImage ? { ...selection, visualImage } : selection
    setCommittedSelection(selectionWithImage)
    setCommittedSelectionRects(selectionWithImage.rects ?? [])
    setLiveSelection(false)
    emitSelection(selectionWithImage)
  }, [emitSelection, selectionContext])

  const beginPdfSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    setContextMenu(null)
    if (visualSelectionEnabled) {
      const page = pageAtPointer(event.clientX, event.clientY)
      if (page) {
        event.preventDefault()
        textDragRef.current = null
        event.currentTarget.setPointerCapture(event.pointerId)
        visualDragRef.current = {
          page: page.page,
          pageRect: page.rect,
          pageElement: page.element,
          startX: event.clientX,
          startY: event.clientY
        }
        commitVisualSelection(visualDragRef.current, event.clientX, event.clientY)
        return
      }
    }
    const empty = emptyPdfSelection(selectionContext)
    visualDragRef.current = null
    const targetElement = event.target instanceof Element ? event.target : null
    textDragRef.current = targetElement?.closest('.write-pdf-text-layer')
      ? {
        start: { x: event.clientX, y: event.clientY },
        last: { x: event.clientX, y: event.clientY }
      }
      : null
    setCommittedSelection(null)
    setCommittedSelectionRects([])
    setLiveSelection(false)
    emitSelection(empty)
  }, [commitVisualSelection, emitSelection, pageAtPointer, selectionContext, visualSelectionEnabled])

  const updateVisualSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = visualDragRef.current
    const textDrag = textDragRef.current
    if (textDrag) textDrag.last = { x: event.clientX, y: event.clientY }
    if (!drag) return
    event.preventDefault()
    commitVisualSelection(drag, event.clientX, event.clientY)
  }, [commitVisualSelection])

  const endPdfSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = visualDragRef.current
    if (drag) {
      event.preventDefault()
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture can already be released by the browser.
      }
      commitVisualSelection(drag, event.clientX, event.clientY, true)
      visualDragRef.current = null
      return
    }
    const textDrag = textDragRef.current
    if (textDrag) {
      textDrag.last = { x: event.clientX, y: event.clientY }
      textDragRef.current = null
      const distance = Math.hypot(textDrag.last.x - textDrag.start.x, textDrag.last.y - textDrag.start.y)
      if (distance >= 4) {
        const root = rootRef.current
        if (root) {
          const nativeSelection = selectionFromPdf(root, selectionContext)
          const next = nativeSelection.text.trim()
            ? nativeSelection
            : selectionFromPdf(root, selectionContext, {
              start: textDrag.start,
              end: textDrag.last
            })
          if (next.text.trim()) {
            window.getSelection()?.removeAllRanges()
            emitSelection(next)
            setCommittedSelection(next)
            setCommittedSelectionRects(next.rects ?? [])
            setLiveSelection(false)
            skipMouseUpSelectionSyncRef.current = true
            return
          }
        }
      }
    }
    syncSelectionSoon()
  }, [commitVisualSelection, emitSelection, rootRef, selectionContext, syncSelectionSoon])

  const syncSelectionAfterMouseUp = useCallback((): void => {
    if (skipMouseUpSelectionSyncRef.current) {
      skipMouseUpSelectionSyncRef.current = false
      return
    }
    if (!visualSelectionEnabled) syncSelectionSoon()
  }, [syncSelectionSoon, visualSelectionEnabled])

  const quoteButtonStyle = useMemo<CSSProperties | undefined>(() => {
    const rect = committedSelection?.anchorRect
    if (!rect) return undefined
    const width = onAnnotationAction ? (onQuoteSelection ? 198 : 160) : 122
    const left = clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12)
    const top = clamp(rect.bottom + 8, 12, window.innerHeight - 44)
    return { left, top, width }
  }, [committedSelection, onAnnotationAction, onQuoteSelection])

  const submitQuoteSelection = useCallback((selection = committedSelection): void => {
    if (!selection?.text.trim()) return
    onQuoteSelectionRef.current?.(selection)
    setContextMenu(null)
  }, [committedSelection])

  const performSelectionAction = useCallback((action: WritePdfAnnotationAction, selection = committedSelection): void => {
    if (!selection) return
    const hasText = Boolean(selection.text.trim())
    const hasRects = Boolean(selection.rects?.length)
    if (!hasText && !hasRects) return
    if (action === 'copy') {
      if (!hasText) return
      void navigator.clipboard?.writeText(selection.text).catch(() => undefined)
      setContextMenu(null)
      return
    }
    onAnnotationAction?.(action, selection)
    setContextMenu(null)
  }, [committedSelection, onAnnotationAction])

  const openPdfContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!onAnnotationAction && !onQuoteSelection && !onOpenAnnotations) return
    const root = rootRef.current
    if (!root) return
    event.preventDefault()
    event.stopPropagation()
    const point = { x: event.clientX, y: event.clientY }
    const selected = selectionFromPdf(root, selectionContext)
    const targetElement = event.target instanceof Element
      ? event.target
      : document.elementFromPoint(event.clientX, event.clientY)
    const pointSelection = selectionFromTextLayerElement(root, targetElement, selectionContext, point)
    const selectedAtPoint = (selected.text.trim() || selected.rects?.length)
      && selectionContainsPoint(root, selected, point)
    const committedAtPoint = committedSelection && selectionContainsPoint(root, committedSelection, point)
    const nextSelection = selectedAtPoint
      ? selected
      : committedAtPoint
        ? committedSelection
        : pointSelection
    if (nextSelection) {
      setCommittedSelection(nextSelection)
      setCommittedSelectionRects(nextSelection.rects ?? [])
      emitSelection(nextSelection)
    }
    const width = onAnnotationAction || onQuoteSelection ? 190 : 174
    const height = onAnnotationAction || onQuoteSelection ? 200 : 48
    setContextMenu({
      left: clamp(event.clientX, 8, window.innerWidth - width - 8),
      top: clamp(event.clientY, 8, window.innerHeight - height - 8),
      selection: nextSelection ?? null
    })
  }, [committedSelection, emitSelection, onAnnotationAction, onOpenAnnotations, onQuoteSelection, rootRef, selectionContext])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!jumpToRect) return
    scrollToPage(jumpToRect.page)
  }, [jumpToRect, scrollToPage])

  const matchLabel = searchQuery.trim()
    ? `${searchMatches.length ? Math.min(searchIndex + 1, searchMatches.length) : 0}/${searchMatches.length}`
    : ''
  const committedSelectionHasText = Boolean(committedSelection?.text.trim())
  const committedSelectionHasAnchor = Boolean(committedSelectionHasText || committedSelection?.rects?.length)
  const contextSelection = contextMenu?.selection ?? null
  const contextSelectionHasText = Boolean(contextSelection?.text.trim())
  const contextSelectionHasAnchor = Boolean(contextSelectionHasText || contextSelection?.rects?.length)
  const contextMenuVisible = Boolean(
    contextMenu &&
    (onOpenAnnotations || contextSelectionHasAnchor || (onQuoteSelection && contextSelectionHasText))
  )
  const toggleAnnotations = onToggleAnnotations ?? (onOpenAnnotations ? () => onOpenAnnotations(committedSelection) : null)
  const annotationsToggleLabel = annotationsOpen
    ? label('writePdfAnnotationsClosePanel', 'Close annotations sidebar')
    : label('writePdfAnnotationsOpenPanel', 'Open annotations sidebar')

  return (
    <div
      ref={rootRef}
      className={`write-pdf-viewer flex h-full min-h-0 min-w-0 flex-col ${className ?? ''}`}
      data-live-selection={liveSelection ? '' : undefined}
      onWheelCapture={handleZoomWheel}
    >
      <style>{PDF_VIEWER_CSS}</style>
      <div className="shrink-0 border-b border-ds-border-muted bg-white/88 px-3 py-2 backdrop-blur-xl dark:bg-ds-card/95">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfZoomOut', 'Zoom PDF out')}
              aria-label={label('writePdfZoomOut', 'Zoom PDF out')}
              onClick={zoomOut}
            >
              <Minus className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <span className="min-w-[52px] text-center text-[12px] font-semibold text-ds-muted">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfZoomIn', 'Zoom PDF in')}
              aria-label={label('writePdfZoomIn', 'Zoom PDF in')}
              onClick={zoomIn}
            >
              <Plus className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfPrevPage', 'Previous page')}
              aria-label={label('writePdfPrevPage', 'Previous page')}
              onClick={() => scrollToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                scrollToPage(Number(pageInput))
              }}
            >
              <input
                className="write-pdf-page-input"
                value={pageInput}
                aria-label={label('writePdfPageInput', 'PDF page')}
                onChange={(event) => setPageInput(event.target.value)}
              />
              <span className="text-[12px] text-ds-faint">/ {pageCount || '-'}</span>
            </form>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfNextPage', 'Next page')}
              aria-label={label('writePdfNextPage', 'Next page')}
              onClick={() => scrollToPage(currentPage + 1)}
              disabled={!pageCount || currentPage >= pageCount}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>

          {toggleAnnotations ? (
            <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
              <button
                type="button"
                className="write-pdf-icon-button"
                data-active={annotationsOpen ? 'true' : undefined}
                title={annotationsToggleLabel}
                aria-label={annotationsToggleLabel}
                aria-pressed={annotationsOpen}
                onClick={toggleAnnotations}
              >
                {annotationsOpen ? (
                  <PanelRightClose className="h-4 w-4" strokeWidth={1.9} />
                ) : (
                  <PanelRightOpen className="h-4 w-4" strokeWidth={1.9} />
                )}
              </button>
            </div>
          ) : null}

          <div className="flex min-w-[190px] flex-1 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 dark:bg-white/6 sm:max-w-[280px]">
            <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
            <input
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
              value={searchQuery}
              placeholder={label('writePdfSearchPlaceholder', 'Search PDF')}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <span className="min-w-[42px] shrink-0 text-right text-[11px] text-ds-faint">
              {matchLabel}
            </span>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfPrevMatch', 'Previous match')}
              aria-label={label('writePdfPrevMatch', 'Previous match')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(-1)}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfNextMatch', 'Next match')}
              aria-label={label('writePdfNextMatch', 'Next match')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(1)}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto bg-ds-main/55 px-4 py-5 dark:bg-black/20"
        onPointerDown={beginPdfSelection}
        onPointerMove={updateVisualSelection}
        onPointerUp={endPdfSelection}
        onPointerCancel={endPdfSelection}
        onContextMenu={openPdfContextMenu}
        onMouseUp={syncSelectionAfterMouseUp}
        onKeyUp={syncSelectionSoon}
        onScroll={schedulePageSync}
      >
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-[13px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
            {label('writePdfLoading', 'Opening PDF...')}
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-[13px] leading-6 text-red-600 dark:text-red-300">
            {label('writePdfLoadFailed', 'PDF failed to open: {{message}}', { message: error })}
          </div>
        ) : pdfDocument ? (
          <div className="mx-auto flex w-max max-w-full flex-col items-center gap-5">
            {allPageTextLoaded && !pdfHasText ? (
              <div className="max-w-[560px] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/36 dark:text-amber-100">
                {label(
                  'writePdfNoTextLayer',
                  'This PDF has no extractable text layer. Visual selection mode is available for image-region anchors.'
                )}
              </div>
            ) : null}
            {Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1).map((pageNumber) => (
              <div
                key={pageNumber}
                ref={(node) => {
                  if (node) pageRefs.current.set(pageNumber, node)
                  else pageRefs.current.delete(pageNumber)
                }}
              >
                <WritePdfPage
                  document={pdfDocument}
                  pageNumber={pageNumber}
                  scale={scale}
                  searchQuery={activeSearchMatch?.page === pageNumber ? deferredSearchQuery : ''}
                  activeSearchMatchIndex={
                    activeSearchMatch?.page === pageNumber ? activeSearchMatch.pageMatchIndex : null
                  }
                  selectionRects={committedRectsByPage.get(pageNumber) ?? []}
                  annotationOverlays={annotationOverlaysByPage.get(pageNumber) ?? []}
                  activeAnnotationId={activeAnnotationId}
                  onAnnotationSelect={onAnnotationSelect}
                  onPageText={updatePageText}
                />
                <div className="mt-1 text-center text-[11px] text-ds-faint">
                  {label('writePdfPageLabel', 'Page {{page}}', { page: pageNumber })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {contextMenu && contextMenuVisible ? (
        <div
          data-selection-ignore="true"
          className="fixed z-[60] min-w-[174px] rounded-lg border border-ds-border bg-ds-card p-1 text-[12px] font-semibold text-ds-ink shadow-[0_18px_42px_rgba(15,23,42,0.2)]"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
        >
          {onOpenAnnotations ? (
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-ds-hover"
              onClick={() => {
                onOpenAnnotations(contextSelection)
                setContextMenu(null)
              }}
            >
              <StickyNote className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="truncate">{label('writePdfAnnotations', 'PDF annotations')}</span>
            </button>
          ) : null}
          {onQuoteSelection && contextSelectionHasText ? (
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-ds-hover"
              onClick={() => submitQuoteSelection(contextSelection)}
            >
              <Quote className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="truncate">{label('writeSelectionQuote', 'Add quote')}</span>
            </button>
          ) : null}
          {onAnnotationAction && contextSelectionHasAnchor ? (
            <>
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-ds-hover"
                onClick={() => performSelectionAction('highlight', contextSelection)}
              >
                <Highlighter className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="truncate">{label('writePdfAnnotateHighlight', 'Highlight')}</span>
              </button>
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-ds-hover"
                onClick={() => performSelectionAction('comment', contextSelection)}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="truncate">{label('writePdfAnnotateComment', 'Comment')}</span>
              </button>
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-ds-hover"
                onClick={() => performSelectionAction('question', contextSelection)}
              >
                <HelpCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="truncate">{label('writePdfAnnotateAsk', 'Ask')}</span>
              </button>
              {contextSelectionHasText ? (
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-ds-hover"
                  onClick={() => performSelectionAction('copy', contextSelection)}
                >
                  <Clipboard className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  <span className="truncate">{label('writePdfAnnotateCopyQuote', 'Copy quote')}</span>
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {(onQuoteSelection || onAnnotationAction) && committedSelectionHasAnchor && quoteButtonStyle ? (
        <div
          data-selection-ignore="true"
          className="fixed z-50 inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-ds-border bg-ds-card px-1.5 text-[12px] font-semibold text-ds-ink shadow-[0_14px_34px_rgba(15,23,42,0.16)]"
          style={quoteButtonStyle}
          onMouseDown={(event) => event.preventDefault()}
        >
          {onQuoteSelection && committedSelectionHasText ? (
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writeSelectionQuote', 'Add quote')}
              aria-label={label('writeSelectionQuote', 'Add quote')}
              onClick={() => submitQuoteSelection()}
            >
              <Quote className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ) : null}
          {onAnnotationAction ? (
            <>
              <button
                type="button"
                className="write-pdf-icon-button"
                title={label('writePdfAnnotateHighlight', 'Highlight')}
                aria-label={label('writePdfAnnotateHighlight', 'Highlight')}
                onClick={() => performSelectionAction('highlight')}
              >
                <Highlighter className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                className="write-pdf-icon-button"
                title={label('writePdfAnnotateComment', 'Comment')}
                aria-label={label('writePdfAnnotateComment', 'Comment')}
                onClick={() => performSelectionAction('comment')}
              >
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                className="write-pdf-icon-button"
                title={label('writePdfAnnotateAsk', 'Ask')}
                aria-label={label('writePdfAnnotateAsk', 'Ask')}
                onClick={() => performSelectionAction('question')}
              >
                <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                className="write-pdf-icon-button"
                title={label('writePdfAnnotateCopyQuote', 'Copy quote')}
                aria-label={label('writePdfAnnotateCopyQuote', 'Copy quote')}
                disabled={!committedSelectionHasText}
                onClick={() => performSelectionAction('copy')}
              >
                <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
