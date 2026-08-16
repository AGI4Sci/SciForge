import rehypeParse from 'rehype-parse'
import rehypeSanitize, { type Options as RehypeSanitizeOptions } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'

const MAX_SVG_SOURCE_BYTES = 4 * 1024 * 1024
const MAX_SVG_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_SVG_ELEMENTS = 20_000
const MAX_SVG_DEPTH = 256
const FORBIDDEN_SVG_SUBTREES = new Set([
  'a', 'animate', 'animatemotion', 'animatetransform', 'audio', 'discard',
  'embed', 'feimage', 'foreignobject', 'iframe', 'image', 'link', 'metadata',
  'mpath', 'object', 'script', 'set', 'style', 'use', 'video'
])

/**
 * Deliberately excludes every element that can fetch or execute external
 * content (`script`, `style`, `image`, `use`, `foreignObject`, animation and
 * link elements). Consumers may rasterize or embed only this inert subset.
 */
const SAFE_SVG_SCHEMA: RehypeSanitizeOptions = Object.freeze({
  // SVG is always used as an image/raster source, never inserted as live DOM.
  // Preserve local paint-server IDs so `url(#gradient)` remains functional.
  clobberPrefix: '',
  tagNames: [
    'svg', 'g', 'defs', 'clipPath', 'mask',
    'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'title', 'desc',
    'linearGradient', 'radialGradient', 'stop'
  ],
  attributes: {
    '*': [
      'id', 'className', 'transform', 'opacity',
      'fill', 'fillOpacity', 'fillRule',
      'stroke', 'strokeOpacity', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin',
      'clipPath', 'mask'
    ],
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio'],
    g: ['transform'],
    path: ['d', 'pathLength'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    polyline: ['points'],
    polygon: ['points'],
    text: ['x', 'y', 'dx', 'dy', 'textAnchor', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight'],
    tspan: ['x', 'y', 'dx', 'dy', 'textAnchor', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight'],
    linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform'],
    radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform'],
    stop: ['offset', 'stopColor', 'stopOpacity']
  },
  protocols: {}
})

export function sanitizeSvgForPreview(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength === 0) throw new Error('SVG preview source is empty.')
  if (bytes.byteLength > MAX_SVG_SOURCE_BYTES) {
    throw new Error(`SVG preview source exceeds ${MAX_SVG_SOURCE_BYTES} bytes.`)
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (!/<svg(?:\s|>)/iu.test(source)) throw new Error('SVG preview source has no SVG root.')
  assertBoundedSvgShape(source)

  const sanitized = stripExternalPaintReferences(String(unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeSanitize, SAFE_SVG_SCHEMA)
    .use(rehypeStringify, { allowDangerousHtml: false })
    .processSync(stripForbiddenSvgSubtrees(source))))
  if (!/^\s*<svg(?:\s|>)/iu.test(sanitized)) {
    throw new Error('SVG preview source did not produce a safe SVG root.')
  }
  const output = new TextEncoder().encode(sanitized)
  if (output.byteLength > MAX_SVG_OUTPUT_BYTES) {
    throw new Error(`Sanitized SVG preview exceeds ${MAX_SVG_OUTPUT_BYTES} bytes.`)
  }
  return output
}

/**
 * Removes active and external-resource subtrees before the HTML parser sees
 * them. In particular, malformed HTML inside SVG `foreignObject` must not be
 * allowed to change how the remainder of the SVG is tokenized.
 */
function stripForbiddenSvgSubtrees(source: string): string {
  const tags = source.matchAll(/<\s*(\/)?\s*([A-Za-z][\w:.-]*)([^>]*)>/gu)
  const skipped: string[] = []
  const retained: string[] = []
  let cursor = 0
  for (const match of tags) {
    const closing = Boolean(match[1])
    const localName = match[2]!.split(':').at(-1)!.toLowerCase()
    const forbidden = FORBIDDEN_SVG_SUBTREES.has(localName)
    const selfClosing = /\/\s*$/u.test(match[3] ?? '')
    if (skipped.length === 0) {
      if (!forbidden) continue
      retained.push(source.slice(cursor, match.index))
    }
    if (forbidden && !selfClosing) {
      if (!closing) {
        skipped.push(localName)
      } else if (skipped.at(-1) === localName) {
        skipped.pop()
      }
    }
    cursor = match.index + match[0].length
  }
  if (skipped.length === 0) retained.push(source.slice(cursor))
  return retained.join('')
}

function assertBoundedSvgShape(source: string): void {
  const tags = source.matchAll(/<\s*(\/)?\s*([A-Za-z][\w:.-]*)([^>]*)>/gu)
  let elements = 0
  let depth = 0
  for (const match of tags) {
    const closing = Boolean(match[1])
    const suffix = match[3] ?? ''
    if (closing) {
      depth = Math.max(0, depth - 1)
      continue
    }
    elements += 1
    if (elements > MAX_SVG_ELEMENTS) {
      throw new Error(`SVG preview exceeds ${MAX_SVG_ELEMENTS} elements.`)
    }
    if (!/\/\s*$/u.test(suffix)) depth += 1
    if (depth > MAX_SVG_DEPTH) {
      throw new Error(`SVG preview exceeds nesting depth ${MAX_SVG_DEPTH}.`)
    }
  }
}

function stripExternalPaintReferences(source: string): string {
  return source.replace(
    /\s(fill|stroke|clip-path|mask)="([^"]*)"/giu,
    (attribute, _name: string, value: string) => {
      if (!/[\\]|url\s*\(/iu.test(value)) return attribute
      return /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/u.test(value) ? attribute : ''
    }
  )
}
