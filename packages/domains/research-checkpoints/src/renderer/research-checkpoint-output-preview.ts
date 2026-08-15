import type {
  ArtifactVersionReadResultV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { sanitizeSvgForPreview } from '@sciforge/domain-sdk/safe-svg'

import type { ResearchCheckpointOutputArtifactV1 } from '../contract.js'

const MAX_IMAGE_BYTES = 1024 * 1024
const MAX_TABLE_BYTES = 256 * 1024
const MAX_TEXT_BYTES = 128 * 1024
const MAX_TABLE_ROWS = 5
const MAX_TABLE_COLUMNS = 6
const MAX_TEXT_CHARACTERS = 360
const MAX_SVG_RASTER_DIMENSION = 1_024
const MAX_SVG_RASTER_PIXELS = 1_048_576
const MAX_SVG_PNG_DATA_URL_CHARACTERS = 6 * 1024 * 1024
const SVG_IMAGE_DECODE_TIMEOUT_MS = 10_000

const rasterImageMediaTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])

export type ExactOutputSvgRasterizer = (
  sanitizedSvg: Uint8Array
) => Promise<string | undefined>

export type ExactOutputSvgRasterizationDependencies = Readonly<{
  createImageBitmap?: (image: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>
  createCanvas?: () => HTMLCanvasElement | undefined
  createImage?: () => HTMLImageElement | undefined
  createObjectUrl?: (blob: Blob) => string | undefined
  revokeObjectUrl?: (url: string) => void
}>

export type ExactOutputPreviewDependencies = Readonly<{
  sanitizeSvg?: (bytes: Uint8Array) => Uint8Array
  rasterizeSvg?: ExactOutputSvgRasterizer
}>

export type ResearchCheckpointOutputPreview =
  | Readonly<{
    kind: 'image'
    dataUrl: string
    mediaType: string
  }>
  | Readonly<{
    kind: 'table'
    columns: readonly string[]
    rows: readonly (readonly string[])[]
    rowCount: number
    columnCount: number
    truncated: boolean
  }>
  | Readonly<{
    kind: 'text'
    text: string
    truncated: boolean
  }>

export function outputPreviewMaxBytes(
  output: ResearchCheckpointOutputArtifactV1
): number | undefined {
  const mediaType = normalizedMediaType(output.ref.mediaType)
  const path = output.path.toLowerCase()
  if (rasterImageMediaTypes.has(mediaType) || isSvg(mediaType, path)) {
    return output.ref.byteLength <= MAX_IMAGE_BYTES ? MAX_IMAGE_BYTES : undefined
  }
  if (isTable(mediaType, path)) {
    return output.ref.byteLength <= MAX_TABLE_BYTES ? MAX_TABLE_BYTES : undefined
  }
  if (isText(mediaType, path)) {
    return output.ref.byteLength <= MAX_TEXT_BYTES ? MAX_TEXT_BYTES : undefined
  }
  return undefined
}

export async function buildExactOutputPreview(
  output: ResearchCheckpointOutputArtifactV1,
  result: ArtifactVersionReadResultV1,
  dependencies: ExactOutputPreviewDependencies = {}
): Promise<ResearchCheckpointOutputPreview | undefined> {
  if (!result.ok || !sameExactRef(output.ref, result.value.ref)) return undefined
  const maxBytes = outputPreviewMaxBytes(output)
  if (maxBytes === undefined || result.value.ref.byteLength > maxBytes) return undefined
  const bytes = decodeBase64(result.value.dataBase64)
  if (
    !bytes ||
    bytes.byteLength !== output.ref.byteLength ||
    await sha256Hex(bytes) !== output.ref.contentDigest
  ) return undefined
  const mediaType = normalizedMediaType(output.ref.mediaType)
  const path = output.path.toLowerCase()

  if (isSvg(mediaType, path)) {
    try {
      // Sanitization and image decoding are deliberately ordered after the
      // exact reference, byte length, and SHA-256 checks above. Untrusted or
      // stale bytes never reach either parser.
      const sanitized = (dependencies.sanitizeSvg ?? sanitizeSvgForPreview)(bytes)
      const dataUrl = await (dependencies.rasterizeSvg ?? rasterizeSanitizedSvgToPng)(sanitized)
      if (!isBoundedPngDataUrl(dataUrl)) return undefined
      return { kind: 'image', dataUrl, mediaType: 'image/png' }
    } catch {
      return undefined
    }
  }

  if (rasterImageMediaTypes.has(mediaType)) {
    return {
      kind: 'image',
      dataUrl: `data:${mediaType};base64,${result.value.dataBase64}`,
      mediaType
    }
  }

  const text = decodeUtf8(bytes)
  if (text === undefined) return undefined
  if (isTable(mediaType, path)) return buildTablePreview(text, path.endsWith('.tsv') ? '\t' : ',')
  if (!isText(mediaType, path)) return undefined
  return {
    kind: 'text',
    text: text.slice(0, MAX_TEXT_CHARACTERS),
    truncated: text.length > MAX_TEXT_CHARACTERS
  }
}

/**
 * Converts the inert SVG subset into a bounded bitmap. The SVG is supplied to
 * browser decoders only as a short-lived Blob, never as a renderer-facing SVG
 * data URL. Chromium does not consistently support SVG in createImageBitmap,
 * so an unattached Image backed by a revoked Blob URL is the compatibility
 * path. In either case the only value returned to React is a PNG data URL.
 */
export async function rasterizeSanitizedSvgToPng(
  sanitizedSvg: Uint8Array,
  dependencies: ExactOutputSvgRasterizationDependencies = {}
): Promise<string | undefined> {
  const source = decodeUtf8(sanitizedSvg)
  if (source === undefined) return undefined
  const dimensions = boundedSvgRasterDimensions(source)
  if (!dimensions) return undefined
  const rasterSource = withBoundedSvgRasterDimensions(source, dimensions)
  if (!rasterSource) return undefined
  const blob = new Blob([rasterSource], { type: 'image/svg+xml' })
  const createCanvas = dependencies.createCanvas ?? (
    typeof globalThis.document?.createElement === 'function'
      ? () => globalThis.document.createElement('canvas')
      : undefined
  )
  const canvas = createCanvas?.()
  if (!canvas) return undefined
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context) return undefined

  const createBitmap = dependencies.createImageBitmap ?? (
    typeof globalThis.createImageBitmap === 'function'
      ? globalThis.createImageBitmap.bind(globalThis)
      : undefined
  )
  let bitmap: ImageBitmap | undefined
  try {
    if (createBitmap) {
      try {
        bitmap = await createBitmap(blob, {
          resizeWidth: dimensions.width,
          resizeHeight: dimensions.height,
          resizeQuality: 'high'
        })
      } catch {
        // Electron/Chromium may reject SVG Blob decoding even though its Image
        // decoder supports the exact same inert Blob.
      }
    }
    if (bitmap && isBoundedRasterSource(bitmap.width, bitmap.height)) {
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)
    } else {
      bitmap?.close()
      bitmap = undefined
      const image = await loadSanitizedSvgBlobImage(blob, dependencies)
      if (!image || !isBoundedRasterSource(image.naturalWidth, image.naturalHeight)) {
        return undefined
      }
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    }
    const dataUrl = canvas.toDataURL('image/png')
    return isBoundedPngDataUrl(dataUrl) ? dataUrl : undefined
  } finally {
    bitmap?.close()
  }
}

async function loadSanitizedSvgBlobImage(
  blob: Blob,
  dependencies: ExactOutputSvgRasterizationDependencies
): Promise<HTMLImageElement | undefined> {
  const createImage = dependencies.createImage ?? (
    typeof globalThis.Image === 'function' ? () => new globalThis.Image() : undefined
  )
  const createObjectUrl = dependencies.createObjectUrl ?? (
    typeof globalThis.URL?.createObjectURL === 'function'
      ? globalThis.URL.createObjectURL.bind(globalThis.URL)
      : undefined
  )
  const revokeObjectUrl = dependencies.revokeObjectUrl ?? (
    typeof globalThis.URL?.revokeObjectURL === 'function'
      ? globalThis.URL.revokeObjectURL.bind(globalThis.URL)
      : undefined
  )
  if (!createImage || !createObjectUrl || !revokeObjectUrl) return undefined
  const image = createImage()
  if (!image) return undefined
  const objectUrl = createObjectUrl(blob)
  if (!objectUrl) return undefined

  try {
    image.decoding = 'async'
    return await new Promise<HTMLImageElement | undefined>((resolve) => {
      let settled = false
      const finish = (value: HTMLImageElement | undefined) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        image.onload = null
        image.onerror = null
        resolve(value)
      }
      const timeout = setTimeout(() => finish(undefined), SVG_IMAGE_DECODE_TIMEOUT_MS)
      image.onload = () => finish(image)
      image.onerror = () => finish(undefined)
      image.src = objectUrl
    })
  } finally {
    revokeObjectUrl(objectUrl)
  }
}

function withBoundedSvgRasterDimensions(
  source: string,
  dimensions: Readonly<{ width: number; height: number }>
): string | undefined {
  const root = source.match(/^\s*<svg\b[^>]*>/iu)?.[0]
  if (!root) return undefined
  const boundedRoot = root
    .replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/giu, '')
    .replace(/>$/u, ` width="${dimensions.width}" height="${dimensions.height}">`)
  return `${boundedRoot}${source.slice(root.length)}`
}

function isBoundedRasterSource(width: number, height: number): boolean {
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= MAX_SVG_RASTER_DIMENSION &&
    height <= MAX_SVG_RASTER_DIMENSION &&
    width * height <= MAX_SVG_RASTER_PIXELS
}

function boundedSvgRasterDimensions(source: string): Readonly<{ width: number; height: number }> | undefined {
  const root = source.match(/^\s*<svg\b([^>]*)>/iu)?.[1]
  if (root === undefined) return undefined
  const width = positiveSvgLength(attributeValue(root, 'width'))
  const height = positiveSvgLength(attributeValue(root, 'height'))
  const viewBox = attributeValue(root, 'viewBox')
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number)
  const viewBoxWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2]! > 0
    ? viewBox[2]!
    : undefined
  const viewBoxHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3]! > 0
    ? viewBox[3]!
    : undefined
  const intrinsicWidth = width ?? (height && viewBoxWidth && viewBoxHeight
    ? height * viewBoxWidth / viewBoxHeight
    : viewBoxWidth ?? 300)
  const intrinsicHeight = height ?? (width && viewBoxWidth && viewBoxHeight
    ? width * viewBoxHeight / viewBoxWidth
    : viewBoxHeight ?? 150)
  if (
    !Number.isFinite(intrinsicWidth) ||
    !Number.isFinite(intrinsicHeight) ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0
  ) return undefined

  const longest = Math.max(intrinsicWidth, intrinsicHeight)
  const dimensionScale = Math.min(1, MAX_SVG_RASTER_DIMENSION / longest)
  let outputWidth = Math.max(1, Math.round(intrinsicWidth * dimensionScale))
  let outputHeight = Math.max(1, Math.round(intrinsicHeight * dimensionScale))
  if (outputWidth * outputHeight > MAX_SVG_RASTER_PIXELS) {
    const pixelScale = Math.sqrt(MAX_SVG_RASTER_PIXELS / (outputWidth * outputHeight))
    outputWidth = Math.max(1, Math.floor(outputWidth * pixelScale))
    outputHeight = Math.max(1, Math.floor(outputHeight * pixelScale))
  }
  return { width: outputWidth, height: outputHeight }
}

function attributeValue(source: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return source.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*["']([^"']*)["']`, 'iu'))?.[1]
}

function positiveSvgLength(value?: string): number | undefined {
  if (!value) return undefined
  const match = value.trim().match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/iu)
  if (!match) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function isBoundedPngDataUrl(value: string | undefined): value is string {
  return Boolean(
    value &&
    value.length <= MAX_SVG_PNG_DATA_URL_CHARACTERS &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
  )
}

function buildTablePreview(text: string, delimiter: ',' | '\t'): ResearchCheckpointOutputPreview {
  const parsedRows = parseDelimitedRows(text, delimiter)
  const columns = parsedRows[0] ?? []
  const dataRows = parsedRows.slice(1)
  const columnCount = Math.max(columns.length, ...dataRows.map((row) => row.length), 0)
  return {
    kind: 'table',
    columns: columns.slice(0, MAX_TABLE_COLUMNS),
    rows: dataRows.slice(0, MAX_TABLE_ROWS).map((row) => row.slice(0, MAX_TABLE_COLUMNS)),
    rowCount: dataRows.length,
    columnCount,
    truncated: dataRows.length > MAX_TABLE_ROWS || columnCount > MAX_TABLE_COLUMNS
  }
}

function parseDelimitedRows(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (!quoted && character === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      field = ''
      continue
    }
    field += character
  }
  row.push(field)
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

function decodeBase64(dataBase64: string): Uint8Array | undefined {
  try {
    const binary = atob(dataBase64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    let canonical = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      canonical += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(canonical) === dataBase64 ? bytes : undefined
  } catch {
    return undefined
  }
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  try {
    // Copy into an owned ArrayBuffer: DOM BufferSource excludes a view backed
    // by SharedArrayBuffer even though Uint8Array's generic defaults allow it.
    const owned = new Uint8Array(bytes.byteLength)
    owned.set(bytes)
    const digest = await globalThis.crypto?.subtle.digest('SHA-256', owned.buffer)
    return digest
      ? [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
      : undefined
  } catch {
    return undefined
  }
}

function normalizedMediaType(value?: string): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function isTable(mediaType: string, path: string): boolean {
  return mediaType === 'text/csv' || mediaType === 'text/tab-separated-values' || /\.(?:csv|tsv)$/u.test(path)
}

function isSvg(mediaType: string, path: string): boolean {
  return mediaType === 'image/svg+xml' || path.endsWith('.svg')
}

function isText(mediaType: string, path: string): boolean {
  return mediaType.startsWith('text/') || mediaType.includes('json') || /\.(?:json|md|rst|txt|log|py|r|sh|ts|js)$/u.test(path)
}

function sameExactRef(
  expected: ResearchCheckpointOutputArtifactV1['ref'],
  actual: ArtifactVersionRefV1
): boolean {
  return expected.artifactId === actual.artifactId &&
    expected.versionId === actual.versionId &&
    expected.contentDigest === actual.contentDigest &&
    expected.byteLength === actual.byteLength &&
    expected.mediaType === actual.mediaType &&
    expected.availability === actual.availability &&
    expected.retention === actual.retention &&
    expected.accessPolicy.visibility === actual.accessPolicy.visibility &&
    expected.accessPolicy.allowExport === actual.accessPolicy.allowExport &&
    expected.accessPolicy.principals.length === actual.accessPolicy.principals.length &&
    expected.accessPolicy.principals.every((principal, index) => actual.accessPolicy.principals[index] === principal)
}
