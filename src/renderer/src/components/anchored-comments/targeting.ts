import type { CommentTargetBounds, CommentTargetInspection } from './types'

export const COMMENT_UI_ATTRIBUTE = 'data-sciforge-comments-ui'
export const COMMENT_DENY_SELECTOR = [
  '[data-sciforge-comment-deny]',
  '[data-sciforge-comment-sensitive]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]'
].join(',')

const COMMENTABLE_SELECTOR = [
  '[data-sciforge-comment-resource-id]',
  '[data-sciforge-comment-component]',
  '[data-sciforge-comment-element]'
].join(',')

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[contenteditable="true"]'
].join(',')

const SEMANTIC_BLOCK_TAGS = new Set([
  'P', 'LI', 'TD', 'TH', 'PRE', 'CODE', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
])

function clipped(value: string | null | undefined, maxLength: number): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function safeSegment(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const stableId = clipped(element.getAttribute('data-sciforge-comment-element'), 80)
  const component = clipped(element.getAttribute('data-sciforge-comment-component'), 80)
  const role = clipped(element.getAttribute('role'), 40)
  const marker = stableId || component
  if (marker) return `${tag}[sciforge=${JSON.stringify(marker)}]`
  if (element.id && !/\d{4,}/.test(element.id)) return `${tag}#${element.id.slice(0, 80)}`
  return role ? `${tag}[role=${JSON.stringify(role)}]` : tag
}

export function buildBoundedDomFingerprint(element: Element, maxDepth = 5): string[] {
  const segments: string[] = []
  let current: Element | null = element
  while (current && segments.length < maxDepth && current !== document.documentElement) {
    segments.unshift(safeSegment(current))
    current = current.parentElement
  }
  return segments
}

export function isCommentTargetDenied(element: Element): boolean {
  return Boolean(element.closest(`[${COMMENT_UI_ATTRIBUTE}],${COMMENT_DENY_SELECTOR}`))
}

function nearestSemanticBlock(element: Element, maxDepth = 4): Element | null {
  let current: Element | null = element
  for (let depth = 0; current && depth <= maxDepth; depth += 1, current = current.parentElement) {
    if (SEMANTIC_BLOCK_TAGS.has(current.tagName)) return current
  }
  return null
}

function isUsefulVisualGroup(element: Element, sourceRect: DOMRect): boolean {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (rect.width < sourceRect.width || rect.height < sourceRect.height) return false
  if (rect.width > window.innerWidth * 0.9 || rect.height > window.innerHeight * 0.7) return false
  if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.4) return false

  const style = window.getComputedStyle(element)
  const background = style.backgroundColor
  const paintedBackground = Boolean(
    background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)'
  )
  const paintedBorder = [
    style.borderTopWidth,
    style.borderRightWidth,
    style.borderBottomWidth,
    style.borderLeftWidth
  ].some((width) => Number.parseFloat(width) > 0)
  const paintedShadow = Boolean(style.boxShadow && style.boxShadow !== 'none')
  const rounded = Number.parseFloat(style.borderRadius) > 0
  const padded = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
    .some((padding) => Number.parseFloat(padding) >= 4)
  return (paintedBackground || paintedBorder || paintedShadow) && (rounded || padded)
}

function nearestVisualGroup(element: Element, maxDepth = 4): Element | null {
  const sourceRect = element.getBoundingClientRect()
  let current = element.parentElement
  for (let depth = 0; current && depth < maxDepth; depth += 1, current = current.parentElement) {
    if (isUsefulVisualGroup(current, sourceRect)) return current
  }
  return null
}

export function resolveCommentTargetElement(
  element: Element,
  mode: 'semantic' | 'exact' = 'semantic'
): Element {
  const explicit = element.closest(COMMENTABLE_SELECTOR)
  if (explicit) return explicit
  if (mode === 'exact') return element

  const interactive = element.closest(INTERACTIVE_SELECTOR)
  if (interactive) return interactive

  const normalized = element.closest('svg') ?? element
  return nearestSemanticBlock(normalized) ?? nearestVisualGroup(normalized) ?? normalized
}

export function elementBehindCommentCaptureLayer(
  captureLayer: HTMLElement,
  clientX: number,
  clientY: number
): Element | null {
  const previousPointerEvents = captureLayer.style.pointerEvents
  captureLayer.style.pointerEvents = 'none'
  try {
    return document.elementFromPoint(clientX, clientY)
  } finally {
    captureLayer.style.pointerEvents = previousPointerEvents
  }
}

function boundsFromRect(rect: DOMRect): CommentTargetBounds {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  }
}

function selectionContainerElement(range: Range): Element | null {
  const container = range.commonAncestorContainer
  return container.nodeType === 1
    ? container as Element
    : container.parentElement
}

function selectionIntersectsContext(range: Range, contextElement: Element): boolean {
  try {
    return range.intersectsNode(contextElement)
  } catch {
    // Detached/transient DOM nodes can make intersectsNode throw. Such a
    // selection must not open a comment editor for an unrelated context menu.
    return false
  }
}

export function commentTargetLabel(element: Element): string {
  const explicit = clipped(element.getAttribute('data-sciforge-comment-label'), 120)
  const aria = clipped(element.getAttribute('aria-label'), 120)
  const title = clipped(element.getAttribute('title'), 120)
  const text = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? undefined
    : clipped(element.textContent, 120)
  return explicit || aria || title || text || element.tagName.toLowerCase()
}

export function inspectCommentTarget(
  element: Element,
  route: string,
  mode: 'semantic' | 'exact' = 'semantic'
): CommentTargetInspection | null {
  if (isCommentTargetDenied(element)) return null
  const target = resolveCommentTargetElement(element, mode)
  if (isCommentTargetDenied(target)) return null
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  return {
    label: commentTargetLabel(target),
    route,
    bounds: boundsFromRect(rect),
    componentId: clipped(target.getAttribute('data-sciforge-comment-component'), 120),
    elementId: clipped(target.getAttribute('data-sciforge-comment-element'), 120),
    resourceType: clipped(target.getAttribute('data-sciforge-comment-resource-type'), 80),
    resourceId: clipped(target.getAttribute('data-sciforge-comment-resource-id'), 200),
    selection: clipped(target.getAttribute('data-sciforge-comment-selection'), 500),
    domFingerprint: buildBoundedDomFingerprint(target)
  }
}

/**
 * Turns the browser's active text selection into the same stable target shape
 * used by element comments. Supplying the context-menu target prevents a stale
 * selection elsewhere on the page from enabling the quick-comment action.
 */
export function inspectTextSelectionTarget(
  selection: Selection | null,
  route: string,
  contextElement?: Element | null
): CommentTargetInspection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null

  const selectedText = selection.toString().replace(/\s+/g, ' ').trim().slice(0, 4_096)
  if (!selectedText) return null

  const range = selection.getRangeAt(0)
  const container = selectionContainerElement(range)
  if (!container || isCommentTargetDenied(container)) return null
  if (contextElement) {
    if (isCommentTargetDenied(contextElement)) return null
    if (!selectionIntersectsContext(range, contextElement)) return null
  }

  const target = inspectCommentTarget(container, route)
  if (!target) return null
  const rangeRect = range.getBoundingClientRect()
  const bounds = rangeRect.width > 0 && rangeRect.height > 0
    ? boundsFromRect(rangeRect)
    : target.bounds

  return {
    ...target,
    label: `Selected text: ${selectedText.slice(0, 100)}`,
    bounds,
    selection: JSON.stringify({
      kind: 'text',
      text: selectedText,
      startOffset: range.startOffset,
      endOffset: range.endOffset
    })
  }
}
