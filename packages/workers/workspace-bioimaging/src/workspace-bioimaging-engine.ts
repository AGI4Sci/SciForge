import { deflateSync } from 'node:zlib'
import { TextDecoder } from 'node:util'

import {
  WORKSPACE_BIOIMAGING_ACTIONS,
  WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
  WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE,
  WORKSPACE_BIOIMAGING_MAX_CHANNELS,
  WORKSPACE_BIOIMAGING_MAX_IMAGES,
  WORKSPACE_BIOIMAGING_MAX_PYRAMID_LEVELS,
  WORKSPACE_BIOIMAGING_MAX_RENDERED_TILE_PIXELS,
  WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS,
  WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_BIOIMAGING_MAX_WARNINGS,
  WORKSPACE_BIOIMAGING_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspaceBioimagingChannelSelectionInputSchema,
  workspaceBioimagingChannelSelectionResultSchema,
  workspaceBioimagingPreviewResultSchema,
  workspaceBioimagingRegionSelectionInputSchema,
  workspaceBioimagingRegionSelectionResultSchema,
  workspaceBioimagingRegionAnnotationInputSchema,
  workspaceBioimagingRegionAnnotationResultSchema,
  workspaceBioimagingRoiSetExportInputSchema,
  workspaceBioimagingRoiSetExportResultSchema,
  workspaceBioimagingThumbnailDecodeInputSchema,
  workspaceBioimagingThumbnailDecodeResultSchema,
  workspaceBioimagingTileDecodeInputSchema,
  workspaceBioimagingTileDecodeResultSchema,
  type NormalizedWorkspaceBioimagingChannelSelectionInput,
  type NormalizedWorkspaceBioimagingPreviewInput,
  type NormalizedWorkspaceBioimagingRegionAnnotationInput,
  type NormalizedWorkspaceBioimagingRegionSelectionInput,
  type NormalizedWorkspaceBioimagingRoiSetExportInput,
  type NormalizedWorkspaceBioimagingThumbnailDecodeInput,
  type NormalizedWorkspaceBioimagingTileDecodeInput,
  type WorkspaceBioimagingChannel,
  type WorkspaceBioimagingChannelSelectionInput,
  type WorkspaceBioimagingChannelSelectionResult,
  type WorkspaceBioimagingDetectionSource,
  type WorkspaceBioimagingDimensions,
  type WorkspaceBioimagingObservation,
  type WorkspaceBioimagingOmeSummary,
  type WorkspaceBioimagingPlaceholder,
  type WorkspaceBioimagingRegionAnnotationInput,
  type WorkspaceBioimagingRegionAnnotationResult,
  type WorkspaceBioimagingRegionSelectionInput,
  type WorkspaceBioimagingRegionSelectionResult,
  type WorkspaceBioimagingResolvedFormat,
  type WorkspaceBioimagingRoiAnnotation,
  type WorkspaceBioimagingRoiSet,
  type WorkspaceBioimagingRoiSetExportInput,
  type WorkspaceBioimagingRoiSetExportResult,
  type WorkspaceBioimagingSelection,
  type WorkspaceBioimagingSelectionRegion,
  type WorkspaceBioimagingThumbnailDecodeInput,
  type WorkspaceBioimagingThumbnailDecodeResult,
  type WorkspaceBioimagingTileDecodeInput,
  type WorkspaceBioimagingTileDecodeResult,
  type WorkspaceBioimagingTilePlan,
  type WorkspaceBioimagingTiffSummary
} from './contract.js'

const utf8Decoder = new TextDecoder('utf-8', { fatal: false })
const MAX_TIFF_ASCII_BYTES = 512_000
const MAX_TIFF_NUMERIC_VALUES = 16
const MAX_OME_XML_SCAN_BYTES = 512_000
const MAX_VALUE_PREVIEW_CHARS = 512

const TIFF_TAG_NAMES = new Map<number, string>([
  [256, 'ImageWidth'],
  [257, 'ImageLength'],
  [258, 'BitsPerSample'],
  [259, 'Compression'],
  [262, 'PhotometricInterpretation'],
  [270, 'ImageDescription'],
  [277, 'SamplesPerPixel'],
  [278, 'RowsPerStrip'],
  [279, 'StripByteCounts'],
  [282, 'XResolution'],
  [283, 'YResolution'],
  [284, 'PlanarConfiguration'],
  [296, 'ResolutionUnit'],
  [305, 'Software'],
  [306, 'DateTime'],
  [315, 'Artist'],
  [338, 'ExtraSamples'],
  [339, 'SampleFormat'],
  [700, 'XMP']
])

const TIFF_TYPE_NAMES = new Map<number, string>([
  [1, 'BYTE'],
  [2, 'ASCII'],
  [3, 'SHORT'],
  [4, 'LONG'],
  [5, 'RATIONAL'],
  [6, 'SBYTE'],
  [7, 'UNDEFINED'],
  [8, 'SSHORT'],
  [9, 'SLONG'],
  [10, 'SRATIONAL'],
  [11, 'FLOAT'],
  [12, 'DOUBLE'],
  [16, 'LONG8'],
  [17, 'SLONG8'],
  [18, 'IFD8']
])

const TIFF_TYPE_BYTES = new Map<number, number>([
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 4],
  [5, 8],
  [6, 1],
  [7, 1],
  [8, 2],
  [9, 4],
  [10, 8],
  [11, 4],
  [12, 8],
  [16, 8],
  [17, 8],
  [18, 8]
])

const COMPRESSION_NAMES = new Map<number, string>([
  [1, 'none'],
  [2, 'ccitt-group-3'],
  [3, 'ccitt-group-3-fax'],
  [4, 'ccitt-group-4-fax'],
  [5, 'lzw'],
  [6, 'old-jpeg'],
  [7, 'jpeg'],
  [8, 'deflate'],
  [32773, 'packbits'],
  [34712, 'jpeg-2000']
])

const PHOTOMETRIC_NAMES = new Map<number, string>([
  [0, 'white-is-zero'],
  [1, 'black-is-zero'],
  [2, 'rgb'],
  [3, 'palette'],
  [4, 'transparency-mask'],
  [5, 'cmyk'],
  [6, 'ycbcr'],
  [8, 'cielab']
])

type TiffParseResult = {
  summary: WorkspaceBioimagingTiffSummary
  imageDescription?: string
  warnings: string[]
}

type TiffTagValue = {
  numbers: number[]
  text?: string
  valuePreview?: string
}

type ExtractedXml = {
  xml: string
  complete: boolean
}

type FormatResolution = {
  format: WorkspaceBioimagingResolvedFormat
  detectedBy: WorkspaceBioimagingDetectionSource
}

type ObservationBuildInput = {
  input: NormalizedWorkspaceBioimagingPreviewInput
  format: WorkspaceBioimagingResolvedFormat
  dimensions?: WorkspaceBioimagingDimensions
  channels: string[]
  tiff?: WorkspaceBioimagingTiffSummary
  ome?: WorkspaceBioimagingOmeSummary
  placeholder?: WorkspaceBioimagingPlaceholder
  tilePlan?: WorkspaceBioimagingTilePlan
  warnings: string[]
}

export function createWorkspaceBioimagingPreview(
  input: NormalizedWorkspaceBioimagingPreviewInput
) {
  const warnings: string[] = []
  const tiff = sniffTiff(input.bytes)
  if (tiff) warnings.push(...tiff.warnings)

  const omeXml = findOmeXml(tiff?.imageDescription, input.bytes)
  if (omeXml && !omeXml.complete) {
    warnings.push('OME XML closing tag was not found in the scanned metadata; parsed a bounded best-effort summary.')
  }
  const ome = omeXml ? parseOmeXml(omeXml.xml, warnings) : undefined
  const pathFormat = formatFromPath(input.path)
  const resolved = resolveFormat({
    requestedFormat: input.format,
    pathFormat,
    signatureFormat: signatureFormat(input.bytes),
    tiff,
    ome,
    imageDescription: tiff?.imageDescription
  })
  const dimensions = dimensionsFromOme(ome) ?? dimensionsFromTiff(tiff?.summary)
  const channels = channelsFromOme(ome, dimensions)
  const placeholder = placeholderForFormat(resolved.format)
  const tilePlan = buildTilePlan({
    format: resolved.format,
    dimensions,
    channels,
    tiff: tiff?.summary,
    placeholder,
    bytesAvailable: input.bytes.byteLength,
    sourceSize: input.size
  })

  if (placeholder) {
    warnings.push(placeholder.reason)
  }
  if (input.size !== undefined && input.size > input.bytes.byteLength) {
    warnings.push(`Analyzed the first ${input.bytes.byteLength} bytes of a ${input.size} byte file.`)
  }
  if (!tiff && ['tiff', 'ome-tiff', 'svs', 'ndpi'].includes(resolved.format)) {
    warnings.push('No valid TIFF header was found in the supplied byte range.')
  }
  if (resolved.format === 'ome-tiff' && !ome) {
    warnings.push('OME-TIFF was inferred by path or input format, but no OME XML metadata was found in the supplied byte range.')
  }

  const bounded = boundedWarnings(warnings)
  const result = {
    ok: true,
    contractVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    format: resolved.format,
    detectedBy: resolved.detectedBy,
    byteLength: input.bytes.byteLength,
    ...(dimensions ? { dimensions } : {}),
    channels,
    ...(tiff ? { tiff: tiff.summary } : {}),
    ...(ome ? { ome } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(tilePlan ? { tilePlan } : {}),
    warnings: bounded,
    ...(input.includeObservation
      ? {
          observation: buildWorkspaceObservation({
            input,
            format: resolved.format,
            dimensions,
            channels,
            tiff: tiff?.summary,
            ome,
            placeholder,
            tilePlan,
            warnings: bounded
          })
        }
      : {})
  }

  return workspaceBioimagingPreviewResultSchema.parse(result)
}

export function decodeWorkspaceBioimagingTile(
  input: WorkspaceBioimagingTileDecodeInput
): WorkspaceBioimagingTileDecodeResult {
  const normalized = workspaceBioimagingTileDecodeInputSchema.parse(input)
  const decoded = decodeBaselineTiffTile(normalized)
  return workspaceBioimagingTileDecodeResultSchema.parse(decoded)
}

export function decodeWorkspaceBioimagingThumbnail(
  input: WorkspaceBioimagingThumbnailDecodeInput
): WorkspaceBioimagingThumbnailDecodeResult {
  const normalized = workspaceBioimagingThumbnailDecodeInputSchema.parse(input)
  const decoded = decodeBaselineTiffThumbnail(normalized)
  return workspaceBioimagingThumbnailDecodeResultSchema.parse(decoded)
}

export function selectWorkspaceBioimagingRegion(
  input: WorkspaceBioimagingRegionSelectionInput
): WorkspaceBioimagingRegionSelectionResult {
  const normalized = workspaceBioimagingRegionSelectionInputSchema.parse(input)
  return workspaceBioimagingRegionSelectionResultSchema.parse(buildRegionSelection(normalized))
}

export function selectWorkspaceBioimagingChannels(
  input: WorkspaceBioimagingChannelSelectionInput
): WorkspaceBioimagingChannelSelectionResult {
  const normalized = workspaceBioimagingChannelSelectionInputSchema.parse(input)
  return workspaceBioimagingChannelSelectionResultSchema.parse(buildChannelSelection(normalized))
}

export function annotateWorkspaceBioimagingRegion(
  input: WorkspaceBioimagingRegionAnnotationInput
): WorkspaceBioimagingRegionAnnotationResult {
  const normalized = workspaceBioimagingRegionAnnotationInputSchema.parse(input)
  return workspaceBioimagingRegionAnnotationResultSchema.parse(buildRegionAnnotation(normalized))
}

export function exportWorkspaceBioimagingRoiSet(
  input: WorkspaceBioimagingRoiSetExportInput
): WorkspaceBioimagingRoiSetExportResult {
  const normalized = workspaceBioimagingRoiSetExportInputSchema.parse(input)
  return workspaceBioimagingRoiSetExportResultSchema.parse(buildRoiSetExport(normalized))
}

function buildTilePlan(input: {
  format: WorkspaceBioimagingResolvedFormat
  dimensions: WorkspaceBioimagingDimensions | undefined
  channels: string[]
  tiff?: WorkspaceBioimagingTiffSummary
  placeholder?: WorkspaceBioimagingPlaceholder
  bytesAvailable: number
  sourceSize?: number
}): WorkspaceBioimagingTilePlan | undefined {
  const { format, dimensions, channels } = input
  if (format !== 'tiff' && format !== 'ome-tiff') return undefined
  if (!dimensions?.width || !dimensions.height) return undefined
  const pixelDecoding = canDecodeBaselineTiffArtifacts(input)

  const levels: WorkspaceBioimagingTilePlan['levels'] = []
  let width = dimensions.width
  let height = dimensions.height
  let downsample = 1

  for (let level = 0; level < WORKSPACE_BIOIMAGING_MAX_PYRAMID_LEVELS; level += 1) {
    const columns = Math.max(1, Math.ceil(width / WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE))
    const rows = Math.max(1, Math.ceil(height / WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE))
    const tileCount = safeMultiply(columns, rows)
    levels.push({
      level,
      downsample,
      width,
      height,
      tileWidth: WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE,
      tileHeight: WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE,
      columns,
      rows,
      ...(tileCount !== undefined ? { tileCount } : {})
    })

    if (width <= WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE && height <= WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE) {
      break
    }

    width = Math.max(1, Math.ceil(width / 2))
    height = Math.max(1, Math.ceil(height / 2))
    downsample *= 2
  }

  const lastLevel = levels.at(-1)
  const notes = [
    'Generated from TIFF/OME-TIFF metadata only; observation pixels were not decoded.',
    pixelDecoding
      ? 'Bounded tile and thumbnail artifact decoding is available through the workspace preview transport.'
      : 'Pyramid levels describe a safe virtual tile access plan; pixel artifact decoding is not available for this source.'
  ]
  if (
    lastLevel &&
    levels.length >= WORKSPACE_BIOIMAGING_MAX_PYRAMID_LEVELS &&
    (lastLevel.width > WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE || lastLevel.height > WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE)
  ) {
    notes.push(`Pyramid description was bounded to ${WORKSPACE_BIOIMAGING_MAX_PYRAMID_LEVELS} levels.`)
  }

  return {
    status: 'metadata-only',
    kind: 'metadata-derived-pyramid',
    source: format === 'ome-tiff' ? 'ome-tiff-metadata' : 'tiff-metadata',
    tileRendererImplemented: pixelDecoding,
    pixelDecoding,
    baseDimensions: dimensions,
    recommendedTileSize: {
      width: WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE,
      height: WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE
    },
    ...(channels.length > 0 || dimensions.c ? { channelCount: channels.length || dimensions.c } : {}),
    levels,
    notes
  }
}

function canDecodeBaselineTiffArtifacts(input: {
  format: WorkspaceBioimagingResolvedFormat
  tiff?: WorkspaceBioimagingTiffSummary
  placeholder?: WorkspaceBioimagingPlaceholder
  bytesAvailable: number
  sourceSize?: number
}): boolean {
  if (input.placeholder) return false
  if (input.format !== 'tiff' && input.format !== 'ome-tiff') return false
  if (input.sourceSize !== undefined && input.sourceSize > input.bytesAvailable) return false
  const tiff = input.tiff
  if (!tiff?.imageWidth || !tiff.imageHeight) return false
  if (tiff.compression && tiff.compression !== 'none') return false
  if (tiff.bitsPerSample?.length && !tiff.bitsPerSample.every((bits) => bits === 8)) return false
  if (tiff.samplesPerPixel !== undefined && (tiff.samplesPerPixel < 1 || tiff.samplesPerPixel > 4)) return false
  if (
    tiff.photometricInterpretation &&
    !['white-is-zero', 'black-is-zero', 'rgb'].includes(tiff.photometricInterpretation)
  ) {
    return false
  }

  const tagNumbers = new Set(tiff.tags.map((tag) => tag.tag))
  return tagNumbers.has(273) || tagNumbers.has(324)
}

type BaselineTiffRawEntry = {
  tag: number
  typeCode: number
  count: number
  dataOffset: number
  typeByteLength: number
}

type BaselineTiffDirectory = {
  little: boolean
  bytes: Uint8Array
  entries: Map<number, BaselineTiffRawEntry>
}

type BaselineTiffInfo = {
  format: WorkspaceBioimagingResolvedFormat
  little: boolean
  width: number
  height: number
  bitsPerSample: number[]
  samplesPerPixel: number
  compression: number
  photometric: number
  planarConfiguration: number
  rowsPerStrip?: number
  stripOffsets: number[]
  stripByteCounts: number[]
  tileWidth?: number
  tileHeight?: number
  tileOffsets: number[]
  tileByteCounts: number[]
}

function decodeBaselineTiffTile(
  input: NormalizedWorkspaceBioimagingTileDecodeInput
): WorkspaceBioimagingTileDecodeResult {
  if (input.level !== 0) {
    throw new Error('Baseline TIFF tile decoding currently supports level 0 only.')
  }
  if (input.z !== undefined || input.t !== undefined) {
    throw new Error('Baseline TIFF tile decoding currently supports a single 2D plane only.')
  }

  const info = readBaselineTiffInfo(input.bytes, input)
  validateBaselineTiffForTileDecoding(info, input.channelIndex)

  const originX = input.x * input.width
  const originY = input.y * input.height
  if (originX >= info.width || originY >= info.height) {
    throw new Error(`Requested tile ${input.x},${input.y} is outside the ${info.width} x ${info.height} image bounds.`)
  }

  const outputWidth = Math.min(input.width, info.width - originX)
  const outputHeight = Math.min(input.height, info.height - originY)
  if (outputWidth * outputHeight > WORKSPACE_BIOIMAGING_MAX_RENDERED_TILE_PIXELS) {
    throw new Error(`Rendered tile area ${outputWidth * outputHeight} exceeds the ${WORKSPACE_BIOIMAGING_MAX_RENDERED_TILE_PIXELS} pixel limit.`)
  }

  const rgba = new Uint8Array(outputWidth * outputHeight * 4)
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const samples = readBaselineTiffPixel(input.bytes, info, originX + x, originY + y)
      writePixelAsRgba(rgba, (y * outputWidth + x) * 4, samples, info, input.channelIndex)
    }
  }

  const warnings = boundedWarnings([
    ...(info.tileOffsets.length > 0
      ? ['Decoded from uncompressed TIFF tile payload bytes.']
      : ['Decoded from uncompressed TIFF strip payload bytes.']),
    ...(input.channelIndex !== undefined
      ? [`Rendered channel index ${input.channelIndex} as grayscale.`]
      : [])
  ])
  return {
    ok: true,
    contractVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    format: info.format,
    mimeType: 'image/png',
    bytes: encodePngRgba(outputWidth, outputHeight, rgba),
    tile: {
      level: input.level,
      x: input.x,
      y: input.y,
      width: outputWidth,
      height: outputHeight
    },
    pixelDecoding: true,
    tileRendererImplemented: true,
    visibleText: truncateText(
      `Decoded TIFF tile ${input.x},${input.y} at level ${input.level}: ${outputWidth} x ${outputHeight} PNG, pixelDecoding=true.`,
      WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS
    ),
    warnings
  }
}

function decodeBaselineTiffThumbnail(
  input: NormalizedWorkspaceBioimagingThumbnailDecodeInput
): WorkspaceBioimagingThumbnailDecodeResult {
  if (input.z !== undefined || input.t !== undefined) {
    throw new Error('Baseline TIFF thumbnail decoding currently supports a single 2D plane only.')
  }

  const info = readBaselineTiffInfo(input.bytes, input)
  validateBaselineTiffForTileDecoding(info, input.channelIndex)
  const thumbnailSize = fitWithinDimensions(info.width, info.height, input.width, input.height)
  const rgba = new Uint8Array(thumbnailSize.width * thumbnailSize.height * 4)

  for (let y = 0; y < thumbnailSize.height; y += 1) {
    const sourceY = Math.min(info.height - 1, Math.floor(y * info.height / thumbnailSize.height))
    for (let x = 0; x < thumbnailSize.width; x += 1) {
      const sourceX = Math.min(info.width - 1, Math.floor(x * info.width / thumbnailSize.width))
      const samples = readBaselineTiffPixel(input.bytes, info, sourceX, sourceY)
      writePixelAsRgba(rgba, (y * thumbnailSize.width + x) * 4, samples, info, input.channelIndex)
    }
  }

  const warnings = boundedWarnings([
    'Decoded thumbnail from uncompressed baseline TIFF payload bytes using bounded nearest-neighbor sampling.',
    ...(input.channelIndex !== undefined
      ? [`Rendered channel index ${input.channelIndex} as grayscale.`]
      : [])
  ])
  return {
    ok: true,
    contractVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    format: info.format,
    mimeType: 'image/png',
    bytes: encodePngRgba(thumbnailSize.width, thumbnailSize.height, rgba),
    thumbnail: thumbnailSize,
    pixelDecoding: true,
    thumbnailRendererImplemented: true,
    visibleText: truncateText(
      `Decoded TIFF thumbnail: ${thumbnailSize.width} x ${thumbnailSize.height} PNG from ${info.width} x ${info.height}, pixelDecoding=true.`,
      WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS
    ),
    warnings
  }
}

function readBaselineTiffInfo(
  bytes: Uint8Array,
  input: Pick<NormalizedWorkspaceBioimagingTileDecodeInput, 'format' | 'path'>
): BaselineTiffInfo {
  const directory = readBaselineTiffEntries(bytes)
  const width = positiveTiffNumber(directory, 256)
  const height = positiveTiffNumber(directory, 257)
  if (!width || !height) throw new Error('TIFF image dimensions were not found in the first IFD.')

  const bitsPerSample = tiffNumberArray(directory, 258).filter((value) => value > 0)
  const samplesPerPixel = positiveTiffNumber(directory, 277) ?? (bitsPerSample.length || 1)
  const resolvedBits = bitsPerSample.length > 0 ? bitsPerSample : [8]
  const compression = positiveTiffNumber(directory, 259) ?? 1
  const photometric = tiffNumber(directory, 262) ?? (samplesPerPixel >= 3 ? 2 : 1)
  const planarConfiguration = positiveTiffNumber(directory, 284) ?? 1
  const rowsPerStrip = positiveTiffNumber(directory, 278)
  const tileWidth = positiveTiffNumber(directory, 322)
  const tileHeight = positiveTiffNumber(directory, 323)
  const format = resolveFormat({
    requestedFormat: input.format,
    pathFormat: formatFromPath(input.path),
    signatureFormat: signatureFormat(bytes),
    tiff: sniffTiff(bytes),
    ome: undefined,
    imageDescription: undefined
  }).format

  return {
    format: format === 'unknown' ? 'tiff' : format,
    little: directory.little,
    width,
    height,
    bitsPerSample: resolvedBits,
    samplesPerPixel,
    compression,
    photometric,
    planarConfiguration,
    ...(rowsPerStrip ? { rowsPerStrip } : {}),
    stripOffsets: tiffNumberArray(directory, 273),
    stripByteCounts: tiffNumberArray(directory, 279),
    ...(tileWidth ? { tileWidth } : {}),
    ...(tileHeight ? { tileHeight } : {}),
    tileOffsets: tiffNumberArray(directory, 324),
    tileByteCounts: tiffNumberArray(directory, 325)
  }
}

function fitWithinDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale))
  }
}

function readBaselineTiffEntries(bytes: Uint8Array): BaselineTiffDirectory {
  if (bytes.byteLength < 8) throw new Error('TIFF header is truncated.')
  const marker = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)
  const little = marker === 'II'
  if (!little && marker !== 'MM') throw new Error('TIFF byte order marker was not found.')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint16(2, little)
  const flavor = magic === 43 ? 'bigtiff' : magic === 42 ? 'classic-tiff' : null
  if (!flavor) throw new Error(`Unsupported TIFF magic ${magic}.`)

  const firstIfdOffset = flavor === 'bigtiff'
    ? readUint64AsNumber(view, 8, little)
    : view.getUint32(4, little)
  if (firstIfdOffset === undefined) throw new Error('BigTIFF first IFD offset is larger than JavaScript can safely represent.')
  if (!canRead(bytes, firstIfdOffset, flavor === 'bigtiff' ? 8 : 2)) {
    throw new Error('TIFF first IFD offset is outside the supplied byte range.')
  }

  const entryCount = flavor === 'bigtiff'
    ? readUint64AsNumber(view, firstIfdOffset, little)
    : view.getUint16(firstIfdOffset, little)
  if (entryCount === undefined) throw new Error('TIFF IFD entry count is larger than JavaScript can safely represent.')
  if (entryCount > WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS) {
    throw new Error(`TIFF IFD has ${entryCount} entries; tile decoding is bounded to ${WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS} metadata tags.`)
  }

  const entries = new Map<number, BaselineTiffRawEntry>()
  const countByteLength = flavor === 'bigtiff' ? 8 : 2
  const entrySize = flavor === 'bigtiff' ? 20 : 12
  const valueFieldByteLength = flavor === 'bigtiff' ? 8 : 4
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = firstIfdOffset + countByteLength + index * entrySize
    if (!canRead(bytes, entryOffset, entrySize)) throw new Error(`TIFF IFD entry ${index} is truncated.`)
    const tag = view.getUint16(entryOffset, little)
    const typeCode = view.getUint16(entryOffset + 2, little)
    const typeByteLength = TIFF_TYPE_BYTES.get(typeCode)
    if (!typeByteLength) continue
    const count = flavor === 'bigtiff'
      ? readUint64AsNumber(view, entryOffset + 4, little)
      : view.getUint32(entryOffset + 4, little)
    const valueOffset = flavor === 'bigtiff'
      ? readUint64AsNumber(view, entryOffset + 12, little)
      : view.getUint32(entryOffset + 8, little)
    if (count === undefined || valueOffset === undefined) continue
    const totalByteLength = safeMultiply(count, typeByteLength)
    if (totalByteLength === undefined) continue
    entries.set(tag, {
      tag,
      typeCode,
      count,
      dataOffset: totalByteLength <= valueFieldByteLength ? entryOffset + (flavor === 'bigtiff' ? 12 : 8) : valueOffset,
      typeByteLength
    })
  }
  return { little, bytes, entries }
}

function validateBaselineTiffForTileDecoding(info: BaselineTiffInfo, channelIndex: number | undefined): void {
  if (info.compression !== 1) {
    throw new Error(`Only uncompressed TIFF tiles are currently decoded; found compression code ${info.compression}.`)
  }
  if (!info.bitsPerSample.every((bits) => bits === 8)) {
    throw new Error(`Only 8-bit TIFF samples are currently decoded; found ${info.bitsPerSample.join(', ')} bits per sample.`)
  }
  if (info.samplesPerPixel < 1 || info.samplesPerPixel > 4) {
    throw new Error(`Only 1 to 4 samples per pixel are currently decoded; found ${info.samplesPerPixel}.`)
  }
  if (channelIndex !== undefined && channelIndex >= info.samplesPerPixel) {
    throw new Error(`Requested channel index ${channelIndex} is outside the ${info.samplesPerPixel} sample pixel layout.`)
  }
  if (info.planarConfiguration !== 1) {
    throw new Error('Only chunky TIFF planar configuration is currently decoded.')
  }
  if (![0, 1, 2].includes(info.photometric)) {
    throw new Error(`Only grayscale and RGB TIFF photometric interpretations are currently decoded; found code ${info.photometric}.`)
  }
  if (info.tileOffsets.length === 0 && info.stripOffsets.length === 0) {
    throw new Error('TIFF pixel offsets were not found in the first IFD.')
  }
  if (info.tileOffsets.length > 0 && (!info.tileWidth || !info.tileHeight)) {
    throw new Error('TIFF tile offsets are present, but TileWidth or TileLength is missing.')
  }
}

function readBaselineTiffPixel(bytes: Uint8Array, info: BaselineTiffInfo, x: number, y: number): number[] {
  const offset = info.tileOffsets.length > 0
    ? pixelOffsetFromTiledTiff(bytes, info, x, y)
    : pixelOffsetFromStrippedTiff(bytes, info, x, y)
  const samples: number[] = []
  for (let sample = 0; sample < info.samplesPerPixel; sample += 1) {
    samples.push(bytes[offset + sample] ?? 0)
  }
  return samples
}

function pixelOffsetFromStrippedTiff(bytes: Uint8Array, info: BaselineTiffInfo, x: number, y: number): number {
  const rowsPerStrip = info.rowsPerStrip ?? info.height
  const stripIndex = Math.floor(y / rowsPerStrip)
  const stripOffset = info.stripOffsets[stripIndex]
  const stripByteCount = info.stripByteCounts[stripIndex]
  if (stripOffset === undefined) throw new Error(`TIFF strip ${stripIndex} offset is missing.`)
  const rowByteLength = info.width * info.samplesPerPixel
  const rowInStrip = y - stripIndex * rowsPerStrip
  const offset = stripOffset + rowInStrip * rowByteLength + x * info.samplesPerPixel
  const stripEnd = stripOffset + (stripByteCount ?? rowByteLength * rowsPerStrip)
  if (!canRead(bytes, offset, info.samplesPerPixel) || offset + info.samplesPerPixel > stripEnd) {
    throw new Error(`TIFF pixel at ${x},${y} is outside the available strip payload.`)
  }
  return offset
}

function pixelOffsetFromTiledTiff(bytes: Uint8Array, info: BaselineTiffInfo, x: number, y: number): number {
  const tileWidth = info.tileWidth ?? WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE
  const tileHeight = info.tileHeight ?? WORKSPACE_BIOIMAGING_DEFAULT_TILE_SIZE
  const columns = Math.max(1, Math.ceil(info.width / tileWidth))
  const tileColumn = Math.floor(x / tileWidth)
  const tileRow = Math.floor(y / tileHeight)
  const tileIndex = tileRow * columns + tileColumn
  const tileOffset = info.tileOffsets[tileIndex]
  const tileByteCount = info.tileByteCounts[tileIndex]
  if (tileOffset === undefined) throw new Error(`TIFF tile ${tileColumn},${tileRow} offset is missing.`)
  const xInTile = x - tileColumn * tileWidth
  const yInTile = y - tileRow * tileHeight
  const offset = tileOffset + (yInTile * tileWidth + xInTile) * info.samplesPerPixel
  const tileEnd = tileOffset + (tileByteCount ?? tileWidth * tileHeight * info.samplesPerPixel)
  if (!canRead(bytes, offset, info.samplesPerPixel) || offset + info.samplesPerPixel > tileEnd) {
    throw new Error(`TIFF pixel at ${x},${y} is outside the available tile payload.`)
  }
  return offset
}

function writePixelAsRgba(
  rgba: Uint8Array,
  offset: number,
  samples: number[],
  info: BaselineTiffInfo,
  channelIndex: number | undefined
): void {
  if (channelIndex !== undefined) {
    const value = samples[channelIndex] ?? 0
    rgba[offset] = value
    rgba[offset + 1] = value
    rgba[offset + 2] = value
    rgba[offset + 3] = 255
    return
  }
  if (info.samplesPerPixel >= 3 && info.photometric === 2) {
    rgba[offset] = samples[0] ?? 0
    rgba[offset + 1] = samples[1] ?? 0
    rgba[offset + 2] = samples[2] ?? 0
    rgba[offset + 3] = 255
    return
  }
  const raw = samples[0] ?? 0
  const value = info.photometric === 0 ? 255 - raw : raw
  rgba[offset] = value
  rgba[offset + 1] = value
  rgba[offset + 2] = value
  rgba[offset + 3] = 255
}

function positiveTiffNumber(directory: BaselineTiffDirectory, tag: number): number | undefined {
  const value = tiffNumber(directory, tag)
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined
}

function tiffNumber(directory: BaselineTiffDirectory, tag: number): number | undefined {
  return tiffNumberArray(directory, tag, 1)[0]
}

function tiffNumberArray(directory: BaselineTiffDirectory, tag: number, maxCount = 100_000): number[] {
  const entry = directory.entries.get(tag)
  if (!entry) return []
  if (entry.count > maxCount) {
    throw new Error(`TIFF tag ${tag} has ${entry.count} values; tile decoding is bounded to ${maxCount}.`)
  }
  const requiredByteLength = safeMultiply(entry.count, entry.typeByteLength)
  if (requiredByteLength === undefined || !canRead(directory.bytes, entry.dataOffset, requiredByteLength)) {
    throw new Error(`TIFF tag ${tag} value bytes are outside the supplied byte range.`)
  }
  const view = new DataView(directory.bytes.buffer, directory.bytes.byteOffset, directory.bytes.byteLength)
  return readNumericTiffValues(view, entry.dataOffset, entry.typeCode, entry.count, directory.little)
}

function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1)
    raw[rowOffset] = 0
    raw.set(rgba.subarray(y * stride, y * stride + stride), rowOffset + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
  const copy = new Uint8Array(png.byteLength)
  copy.set(png)
  return copy
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(8 + data.byteLength + 4)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  Buffer.from(data).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength)
  return chunk
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildRegionSelection(
  input: NormalizedWorkspaceBioimagingRegionSelectionInput
): WorkspaceBioimagingRegionSelectionResult {
  const dimensions = input.preview.dimensions
  const clamped = clampRegionToDimensions(input.region, dimensions, input.clampToImage)
  const warnings = boundedWarnings([
    ...(!dimensions?.width || !dimensions.height
      ? ['ROI selection used supplied coordinates because image dimensions are unavailable in the metadata preview.']
      : []),
    ...(clamped.clipped
      ? [`ROI${input.roiId ? ` ${input.roiId}` : ''} was clipped to the available image metadata bounds.`]
      : [])
  ])
  const selection: WorkspaceBioimagingSelection = {
    kind: 'bioimaging',
    ...(input.roiId ? { roiIds: [input.roiId] } : {}),
    regions: [clamped.region]
  }

  return {
    ok: true,
    contractVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    region: clamped.region,
    ...(input.roiId ? { roiId: input.roiId } : {}),
    clipped: clamped.clipped,
    ...(dimensions ? { imageDimensions: dimensions } : {}),
    selection,
    visibleText: buildRegionSelectionVisibleText(clamped.region, input.roiId, warnings),
    warnings
  }
}

function buildChannelSelection(
  input: NormalizedWorkspaceBioimagingChannelSelectionInput
): WorkspaceBioimagingChannelSelectionResult {
  const knownChannels = uniqueStrings(input.preview.channels)
  const requestedChannels = input.channels ?? []
  const requestedIndexes = input.channelIndexes ?? []
  const selectedChannels: string[] = []
  const selectedIndexes = new Set<number>()
  const unknownChannels: string[] = []

  for (const requested of requestedChannels) {
    const known = resolveKnownChannel(requested, knownChannels)
    if (known) {
      addSelectedChannel(selectedChannels, selectedIndexes, known.name, known.index)
    } else if (input.allowUnknown) {
      addSelectedChannel(selectedChannels, selectedIndexes, requested)
    } else {
      unknownChannels.push(requested)
    }
  }

  for (const index of requestedIndexes) {
    const name = knownChannels[index]
    if (name) {
      addSelectedChannel(selectedChannels, selectedIndexes, name, index)
      continue
    }

    const generated = channelNameForIndex(index, input.preview.dimensions)
    if (generated && input.allowUnknown) {
      addSelectedChannel(selectedChannels, selectedIndexes, generated, index)
    } else {
      unknownChannels.push(`Channel index ${index}`)
    }
  }

  const warnings = boundedWarnings([
    ...(knownChannels.length === 0
      ? ['No channel metadata is available in the bounded preview summary.']
      : []),
    ...(unknownChannels.length > 0
      ? [`${unknownChannels.length} requested channel(s) were not present in bounded metadata and were omitted.`]
      : []),
    ...(selectedChannels.length === 0
      ? ['No channels were selected.']
      : [])
  ])
  const selection: WorkspaceBioimagingSelection = {
    kind: 'bioimaging',
    ...(selectedChannels.length > 0 ? { channels: selectedChannels } : {})
  }

  return {
    ok: true,
    contractVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    channels: selectedChannels,
    channelIndexes: [...selectedIndexes].sort((left, right) => left - right),
    unknownChannels: uniqueStrings(unknownChannels),
    selection,
    visibleText: buildChannelSelectionVisibleText(selectedChannels, warnings),
    warnings
  }
}

function buildRegionAnnotation(
  input: NormalizedWorkspaceBioimagingRegionAnnotationInput
): WorkspaceBioimagingRegionAnnotationResult {
  const dimensions = input.preview.dimensions
  const clamped = clampRegionToDimensions(input.region, dimensions, input.clampToImage)
  const roiId = input.roiId ?? generatedRoiId(clamped.region)
  const channelSelection = selectAnnotationChannels(input)
  const warnings = boundedWarnings([
    ...(!dimensions?.width || !dimensions.height
      ? ['ROI annotation used supplied coordinates because image dimensions are unavailable in the metadata preview.']
      : []),
    ...(clamped.clipped
      ? [`ROI annotation ${roiId} was clipped to the available image metadata bounds.`]
      : []),
    ...channelSelection.warnings,
    ...(metadataOnlyPlaceholderWarning(input.preview, 'annotation')
      ? [metadataOnlyPlaceholderWarning(input.preview, 'annotation') as string]
      : [])
  ])
  const selection: WorkspaceBioimagingSelection = {
    kind: 'bioimaging',
    roiIds: [roiId],
    ...(channelSelection.channels.length > 0 ? { channels: channelSelection.channels } : {}),
    regions: [clamped.region]
  }
  const annotation: WorkspaceBioimagingRoiAnnotation = {
    id: roiId,
    kind: 'roi-annotation',
    metadataOnly: true,
    pixelDecoding: false,
    roiId,
    ...(input.label ? { label: input.label } : {}),
    ...(input.body ? { body: input.body } : {}),
    region: clamped.region,
    ...(channelSelection.channels.length > 0 ? { channels: channelSelection.channels } : {}),
    format: input.preview.format,
    summary: buildAnnotationSummary(roiId, input.label, input.body, clamped.region, channelSelection.channels)
  }

  return {
    ok: true,
    contractVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    region: clamped.region,
    roiId,
    clipped: clamped.clipped,
    channels: channelSelection.channels,
    channelIndexes: channelSelection.channelIndexes,
    unknownChannels: channelSelection.unknownChannels,
    ...(dimensions ? { imageDimensions: dimensions } : {}),
    selection,
    annotation,
    visibleText: buildRegionAnnotationVisibleText(annotation, warnings),
    warnings
  }
}

function selectAnnotationChannels(input: NormalizedWorkspaceBioimagingRegionAnnotationInput): Pick<
WorkspaceBioimagingChannelSelectionResult,
'channels' | 'channelIndexes' | 'unknownChannels' | 'warnings'
> {
  const requestedChannels = input.channels ?? []
  const requestedIndexes = input.channelIndexes ?? []
  if (requestedChannels.length === 0 && requestedIndexes.length === 0) {
    return {
      channels: [],
      channelIndexes: [],
      unknownChannels: [],
      warnings: []
    }
  }

  const channelSelection = buildChannelSelection({
    preview: input.preview,
    ...(requestedChannels.length > 0 ? { channels: requestedChannels } : {}),
    ...(requestedIndexes.length > 0 ? { channelIndexes: requestedIndexes } : {}),
    allowUnknown: input.allowUnknownChannels
  })
  return {
    channels: channelSelection.channels,
    channelIndexes: channelSelection.channelIndexes,
    unknownChannels: channelSelection.unknownChannels,
    warnings: channelSelection.warnings
  }
}

function buildRoiSetExport(
  input: NormalizedWorkspaceBioimagingRoiSetExportInput
): WorkspaceBioimagingRoiSetExportResult {
  const warnings: string[] = []
  const selection = buildExportSelection(input, warnings)
  const placeholderWarning = metadataOnlyPlaceholderWarning(input.preview, 'export')
  if (placeholderWarning) warnings.push(placeholderWarning)
  const bounded = boundedWarnings(warnings)
  const roiSet: WorkspaceBioimagingRoiSet = {
    kind: 'bioimaging-roi-set',
    schemaVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    metadataOnly: true,
    pixelDecoding: false,
    containsPixels: false,
    source: {
      format: input.preview.format,
      byteLength: input.preview.byteLength,
      ...(input.preview.dimensions ? { dimensions: input.preview.dimensions } : {}),
      channels: input.preview.channels,
      ...(input.preview.placeholder ? { placeholder: input.preview.placeholder } : {})
    },
    selection,
    annotations: input.annotations ?? []
  }
  const jsonText = JSON.stringify(roiSet, null, 2)

  return {
    ok: true,
    contractVersion: WORKSPACE_BIOIMAGING_CONTRACT_VERSION,
    mimeType: 'application/vnd.sciforge.bioimaging.roi-set+json',
    fileExtension: '.bioimaging-roi-set.json',
    roiSet,
    jsonText,
    visibleText: buildRoiSetExportVisibleText(roiSet, bounded),
    warnings: bounded
  }
}

function buildExportSelection(
  input: NormalizedWorkspaceBioimagingRoiSetExportInput,
  warnings: string[]
): WorkspaceBioimagingSelection {
  const roiIds: string[] = []
  const channels: string[] = []
  const regions: WorkspaceBioimagingSelectionRegion[] = []
  const seenRegions = new Set<string>()

  for (const roiId of input.selection?.roiIds ?? []) addUniqueId(roiIds, roiId)
  for (const channel of input.selection?.channels ?? []) addSelectedChannel(channels, new Set<number>(), channel)
  for (const region of input.selection?.regions ?? []) addExportRegion(region, input.preview.dimensions, regions, seenRegions, warnings)

  for (const annotation of input.annotations ?? []) {
    addUniqueId(roiIds, annotation.roiId)
    for (const channel of annotation.channels ?? []) addSelectedChannel(channels, new Set<number>(), channel)
    addExportRegion(annotation.region, input.preview.dimensions, regions, seenRegions, warnings)
  }

  return {
    kind: 'bioimaging',
    ...(roiIds.length > 0 ? { roiIds } : {}),
    ...(channels.length > 0 ? { channels } : {}),
    ...(regions.length > 0 ? { regions } : {})
  }
}

function addExportRegion(
  region: WorkspaceBioimagingSelectionRegion,
  dimensions: WorkspaceBioimagingDimensions | undefined,
  regions: WorkspaceBioimagingSelectionRegion[],
  seenRegions: Set<string>,
  warnings: string[]
): void {
  const clamped = clampRegionToDimensions(region, dimensions, true)
  if (!dimensions?.width || !dimensions.height) {
    warnings.push('ROI export preserved supplied coordinates because image dimensions are unavailable in the metadata preview.')
  }
  if (clamped.clipped) {
    warnings.push('One or more exported ROI regions were clipped to the available image metadata bounds.')
  }
  const key = JSON.stringify(clamped.region)
  if (seenRegions.has(key)) return
  seenRegions.add(key)
  regions.push(clamped.region)
}

function addUniqueId(ids: string[], id: string): void {
  const normalized = truncateText(id.trim(), 256)
  if (!normalized || ids.includes(normalized)) return
  ids.push(normalized)
}

function sniffTiff(bytes: Uint8Array): TiffParseResult | undefined {
  if (bytes.byteLength < 4) return undefined

  const marker = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)
  const littleEndian = marker === 'II'
  const bigEndian = marker === 'MM'
  if (!littleEndian && !bigEndian) return undefined

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const little = littleEndian
  const magic = readUint16(view, 2, little)
  if (magic !== 42 && magic !== 43) return undefined

  const warnings: string[] = []
  const flavor = magic === 43 ? 'bigtiff' : 'classic-tiff'
  const firstIfdOffset = magic === 43
    ? readBigTiffFirstIfdOffset(view, bytes, little, warnings)
    : readClassicTiffFirstIfdOffset(view, bytes, little, warnings)

  const parsedTags = firstIfdOffset === undefined
    ? { tags: [], imageDescription: undefined }
    : parseTiffIfd(bytes, view, firstIfdOffset, little, flavor, warnings)
  const summary: WorkspaceBioimagingTiffSummary = {
    byteOrder: little ? 'little' : 'big',
    flavor,
    magic,
    firstIfdOffset: firstIfdOffset ?? 0,
    ...summarizeKnownTiffTags(parsedTags.tags, parsedTags.imageDescription),
    tags: parsedTags.tags.map((tag) => ({
      tag: tag.tag,
      name: tag.name,
      type: tag.type,
      count: tag.count,
      ...(tag.valuePreview ? { valuePreview: tag.valuePreview } : {})
    }))
  }

  return {
    summary,
    imageDescription: parsedTags.imageDescription,
    warnings
  }
}

function readClassicTiffFirstIfdOffset(
  view: DataView,
  bytes: Uint8Array,
  little: boolean,
  warnings: string[]
): number | undefined {
  if (!canRead(bytes, 4, 4)) {
    warnings.push('Classic TIFF header is truncated before the first IFD offset.')
    return undefined
  }
  return view.getUint32(4, little)
}

function readBigTiffFirstIfdOffset(
  view: DataView,
  bytes: Uint8Array,
  little: boolean,
  warnings: string[]
): number | undefined {
  if (!canRead(bytes, 4, 12)) {
    warnings.push('BigTIFF header is truncated before the first IFD offset.')
    return undefined
  }

  const offsetSize = view.getUint16(4, little)
  const reserved = view.getUint16(6, little)
  if (offsetSize !== 8 || reserved !== 0) {
    warnings.push('BigTIFF header uses an unexpected offset-size or reserved value.')
  }

  const offset = readUint64AsNumber(view, 8, little)
  if (offset === undefined) {
    warnings.push('BigTIFF first IFD offset is larger than JavaScript can safely represent.')
  }
  return offset
}

function parseTiffIfd(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  little: boolean,
  flavor: WorkspaceBioimagingTiffSummary['flavor'],
  warnings: string[]
) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.byteLength) {
    warnings.push(`TIFF first IFD offset ${offset} is outside the supplied byte range.`)
    return { tags: [] as Array<WorkspaceBioimagingTiffSummary['tags'][number]>, imageDescription: undefined }
  }

  const countByteLength = flavor === 'bigtiff' ? 8 : 2
  if (!canRead(bytes, offset, countByteLength)) {
    warnings.push('TIFF IFD entry count is truncated.')
    return { tags: [] as Array<WorkspaceBioimagingTiffSummary['tags'][number]>, imageDescription: undefined }
  }

  const rawCount = flavor === 'bigtiff'
    ? readUint64AsNumber(view, offset, little)
    : view.getUint16(offset, little)
  if (rawCount === undefined) {
    warnings.push('TIFF IFD entry count is larger than JavaScript can safely represent.')
    return { tags: [] as Array<WorkspaceBioimagingTiffSummary['tags'][number]>, imageDescription: undefined }
  }

  const entrySize = flavor === 'bigtiff' ? 20 : 12
  const entriesToRead = Math.min(rawCount, WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS)
  if (rawCount > WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS) {
    warnings.push(`TIFF IFD has ${rawCount} entries; summarized the first ${WORKSPACE_BIOIMAGING_MAX_TIFF_TAGS}.`)
  }

  const tags: Array<WorkspaceBioimagingTiffSummary['tags'][number]> = []
  let imageDescription: string | undefined

  for (let index = 0; index < entriesToRead; index += 1) {
    const entryOffset = offset + countByteLength + index * entrySize
    if (!canRead(bytes, entryOffset, entrySize)) {
      warnings.push(`TIFF IFD entry ${index} is truncated.`)
      break
    }

    const tag = view.getUint16(entryOffset, little)
    const typeCode = view.getUint16(entryOffset + 2, little)
    const count = flavor === 'bigtiff'
      ? readUint64AsNumber(view, entryOffset + 4, little)
      : view.getUint32(entryOffset + 4, little)
    if (count === undefined) {
      warnings.push(`TIFF tag ${tag} count is larger than JavaScript can safely represent.`)
      continue
    }

    const valueOffset = flavor === 'bigtiff'
      ? readUint64AsNumber(view, entryOffset + 12, little)
      : view.getUint32(entryOffset + 8, little)
    const value = readTiffTagValue({
      bytes,
      view,
      little,
      tag,
      typeCode,
      count,
      valueFieldOffset: flavor === 'bigtiff' ? entryOffset + 12 : entryOffset + 8,
      valueFieldByteLength: flavor === 'bigtiff' ? 8 : 4,
      valueOffset,
      warnings
    })
    if (tag === 270 && value.text) imageDescription = value.text

    tags.push({
      tag,
      name: TIFF_TAG_NAMES.get(tag) ?? `Tag ${tag}`,
      type: TIFF_TYPE_NAMES.get(typeCode) ?? `Type ${typeCode}`,
      count,
      ...(value.valuePreview ? { valuePreview: value.valuePreview } : {})
    })
  }

  return { tags, imageDescription }
}

function readTiffTagValue(input: {
  bytes: Uint8Array
  view: DataView
  little: boolean
  tag: number
  typeCode: number
  count: number
  valueFieldOffset: number
  valueFieldByteLength: number
  valueOffset: number | undefined
  warnings: string[]
}): TiffTagValue {
  const typeByteLength = TIFF_TYPE_BYTES.get(input.typeCode)
  if (!typeByteLength) {
    return { numbers: [], valuePreview: `Unsupported TIFF type ${input.typeCode}` }
  }

  const totalByteLength = safeMultiply(input.count, typeByteLength)
  if (totalByteLength === undefined) {
    return { numbers: [], valuePreview: 'Value is too large to summarize safely' }
  }

  const inline = totalByteLength <= input.valueFieldByteLength
  const dataOffset = inline ? input.valueFieldOffset : input.valueOffset
  if (dataOffset === undefined) {
    return { numbers: [], valuePreview: 'Offset is too large to summarize safely' }
  }

  if (input.typeCode === 2) {
    const readLength = Math.min(totalByteLength, MAX_TIFF_ASCII_BYTES)
    if (!canRead(input.bytes, dataOffset, readLength)) {
      return { numbers: [], valuePreview: `Offset ${dataOffset}, ${totalByteLength} bytes` }
    }
    if (totalByteLength > MAX_TIFF_ASCII_BYTES) {
      input.warnings.push(`TIFF ASCII tag ${input.tag} is ${totalByteLength} bytes; parsed the first ${MAX_TIFF_ASCII_BYTES}.`)
    }
    const text = decodeAsciiTag(input.bytes.subarray(dataOffset, dataOffset + readLength))
    return {
      numbers: [],
      text,
      valuePreview: truncateText(text.replace(/\s+/g, ' ').trim(), MAX_VALUE_PREVIEW_CHARS)
    }
  }

  const valueCount = Math.min(input.count, MAX_TIFF_NUMERIC_VALUES)
  const requiredByteLength = valueCount * typeByteLength
  if (!canRead(input.bytes, dataOffset, requiredByteLength)) {
    return { numbers: [], valuePreview: `Offset ${dataOffset}, ${totalByteLength} bytes` }
  }

  const numbers = readNumericTiffValues(input.view, dataOffset, input.typeCode, valueCount, input.little)
  const suffix = input.count > valueCount ? ', ...' : ''
  return {
    numbers,
    valuePreview: truncateText(`${numbers.join(', ')}${suffix}`, MAX_VALUE_PREVIEW_CHARS)
  }
}

function readNumericTiffValues(
  view: DataView,
  offset: number,
  typeCode: number,
  count: number,
  little: boolean
): number[] {
  const numbers: number[] = []

  for (let index = 0; index < count; index += 1) {
    const itemOffset = offset + index * (TIFF_TYPE_BYTES.get(typeCode) ?? 1)
    switch (typeCode) {
      case 1:
      case 7:
        numbers.push(view.getUint8(itemOffset))
        break
      case 3:
        numbers.push(view.getUint16(itemOffset, little))
        break
      case 4:
        numbers.push(view.getUint32(itemOffset, little))
        break
      case 5: {
        const numerator = view.getUint32(itemOffset, little)
        const denominator = view.getUint32(itemOffset + 4, little)
        numbers.push(denominator === 0 ? numerator : numerator / denominator)
        break
      }
      case 6:
        numbers.push(view.getInt8(itemOffset))
        break
      case 8:
        numbers.push(view.getInt16(itemOffset, little))
        break
      case 9:
        numbers.push(view.getInt32(itemOffset, little))
        break
      case 10: {
        const numerator = view.getInt32(itemOffset, little)
        const denominator = view.getInt32(itemOffset + 4, little)
        numbers.push(denominator === 0 ? numerator : numerator / denominator)
        break
      }
      case 11:
        numbers.push(view.getFloat32(itemOffset, little))
        break
      case 12:
        numbers.push(view.getFloat64(itemOffset, little))
        break
      case 16:
      case 18:
        numbers.push(readUint64AsNumber(view, itemOffset, little) ?? Number.MAX_SAFE_INTEGER)
        break
      case 17:
        numbers.push(readInt64AsNumber(view, itemOffset, little) ?? Number.MAX_SAFE_INTEGER)
        break
      default:
        break
    }
  }

  return numbers.filter((value) => Number.isFinite(value))
}

function summarizeKnownTiffTags(
  tags: Array<WorkspaceBioimagingTiffSummary['tags'][number]>,
  imageDescription: string | undefined
): Omit<WorkspaceBioimagingTiffSummary, 'byteOrder' | 'flavor' | 'magic' | 'firstIfdOffset' | 'tags'> {
  const tagValues = new Map(tags.map((tag) => [tag.tag, tag.valuePreview ?? '']))
  const width = firstPositiveInteger(tagValues.get(256))
  const height = firstPositiveInteger(tagValues.get(257))
  const bitsPerSample = positiveIntegerList(tagValues.get(258)).slice(0, 16)
  const samplesPerPixel = firstPositiveInteger(tagValues.get(277))
  const compressionCode = firstPositiveInteger(tagValues.get(259))
  const photometricCode = firstPositiveInteger(tagValues.get(262))
  const omeXmlPresent = Boolean(imageDescription && extractOmeXml(imageDescription))

  return {
    ...(width ? { imageWidth: width } : {}),
    ...(height ? { imageHeight: height } : {}),
    ...(bitsPerSample.length > 0 ? { bitsPerSample } : {}),
    ...(samplesPerPixel ? { samplesPerPixel } : {}),
    ...(compressionCode ? { compression: COMPRESSION_NAMES.get(compressionCode) ?? `code-${compressionCode}` } : {}),
    ...(photometricCode !== undefined ? { photometricInterpretation: PHOTOMETRIC_NAMES.get(photometricCode) ?? `code-${photometricCode}` } : {}),
    ...(imageDescription ? { imageDescriptionCharCount: imageDescription.length } : {}),
    omeXmlPresent
  }
}

function findOmeXml(description: string | undefined, bytes: Uint8Array): ExtractedXml | undefined {
  const fromDescription = description ? extractOmeXml(description) : undefined
  if (fromDescription) return fromDescription

  const scanBytes = bytes.subarray(0, Math.min(bytes.byteLength, MAX_OME_XML_SCAN_BYTES))
  const scanText = utf8Decoder.decode(scanBytes)
  return extractOmeXml(scanText)
}

function extractOmeXml(text: string): ExtractedXml | undefined {
  const startMatch = /<OME\b/i.exec(text)
  if (!startMatch) return undefined

  const start = startMatch.index
  const rest = text.slice(start)
  const endMatch = /<\/OME>/i.exec(rest)
  if (!endMatch) {
    return { xml: rest, complete: false }
  }

  return {
    xml: rest.slice(0, endMatch.index + endMatch[0].length),
    complete: true
  }
}

function parseOmeXml(xml: string, warnings: string[]): WorkspaceBioimagingOmeSummary | undefined {
  const images: WorkspaceBioimagingOmeSummary['images'] = []
  const imagePattern = /<Image\b([^>]*)>([\s\S]*?)<\/Image>/gi
  const imageMatches = [...xml.matchAll(imagePattern)]

  const sourceImages = imageMatches.length > 0
    ? imageMatches.map((match) => ({ attrs: match[1] ?? '', body: match[2] ?? '' }))
    : [{ attrs: '', body: xml }]

  if (sourceImages.length > WORKSPACE_BIOIMAGING_MAX_IMAGES) {
    warnings.push(`OME XML has ${sourceImages.length} Image elements; summarized the first ${WORKSPACE_BIOIMAGING_MAX_IMAGES}.`)
  }

  for (const [index, image] of sourceImages.slice(0, WORKSPACE_BIOIMAGING_MAX_IMAGES).entries()) {
    const imageAttrs = parseXmlAttributes(image.attrs)
    const pixelsMatch = /<Pixels\b([^>]*)(?:\/>|>([\s\S]*?)<\/Pixels>)/i.exec(image.body)
    if (!pixelsMatch) continue

    const pixelsAttrs = parseXmlAttributes(pixelsMatch[1] ?? '')
    const pixelsBody = pixelsMatch[2] ?? ''
    const channels = parseOmeChannels(pixelsBody)
    images.push({
      ...(imageAttrs.ID ? { id: imageAttrs.ID } : {}),
      ...(imageAttrs.Name ? { name: truncateText(imageAttrs.Name, 256) } : {}),
      ...(pixelsAttrs.DimensionOrder ? { dimensionOrder: pixelsAttrs.DimensionOrder } : {}),
      ...(pixelsAttrs.Type ? { pixelType: pixelsAttrs.Type } : {}),
      dimensions: dimensionsFromPixelsAttributes(pixelsAttrs),
      channels
    })
    if (index === WORKSPACE_BIOIMAGING_MAX_IMAGES - 1) break
  }

  if (images.length === 0) {
    warnings.push('OME XML was found, but no Pixels metadata could be extracted.')
  }

  return {
    xmlCharCount: xml.length,
    imageCount: images.length,
    images
  }
}

function parseOmeChannels(pixelsBody: string): WorkspaceBioimagingChannel[] {
  const channels: WorkspaceBioimagingChannel[] = []
  const channelPattern = /<Channel\b([^>]*)/gi
  const matches = [...pixelsBody.matchAll(channelPattern)].slice(0, WORKSPACE_BIOIMAGING_MAX_CHANNELS)

  for (const [index, match] of matches.entries()) {
    const attrs = parseXmlAttributes(match[1] ?? '')
    const fallback = `Channel ${index + 1}`
    const name = truncateText((attrs.Name || attrs.Fluor || attrs.ID || fallback).trim(), 128) || fallback
    channels.push({
      ...(attrs.ID ? { id: truncateText(attrs.ID, 256) } : {}),
      name,
      ...(attrs.Color ? { color: truncateText(attrs.Color, 64) } : {})
    })
  }

  return channels
}

function dimensionsFromPixelsAttributes(attrs: Record<string, string>): WorkspaceBioimagingDimensions | undefined {
  const dimensions: WorkspaceBioimagingDimensions = {
    ...(positiveIntAttribute(attrs, 'SizeX') ? { width: positiveIntAttribute(attrs, 'SizeX') } : {}),
    ...(positiveIntAttribute(attrs, 'SizeY') ? { height: positiveIntAttribute(attrs, 'SizeY') } : {}),
    ...(positiveIntAttribute(attrs, 'SizeZ') ? { z: positiveIntAttribute(attrs, 'SizeZ') } : {}),
    ...(positiveIntAttribute(attrs, 'SizeC') ? { c: positiveIntAttribute(attrs, 'SizeC') } : {}),
    ...(positiveIntAttribute(attrs, 'SizeT') ? { t: positiveIntAttribute(attrs, 'SizeT') } : {})
  }
  return Object.keys(dimensions).length > 0 ? dimensions : undefined
}

function dimensionsFromOme(ome: WorkspaceBioimagingOmeSummary | undefined): WorkspaceBioimagingDimensions | undefined {
  const dimensions = ome?.images.find((image) => image.dimensions?.width && image.dimensions.height)?.dimensions
    ?? ome?.images.find((image) => image.dimensions)?.dimensions
  return dimensions
}

function dimensionsFromTiff(tiff: WorkspaceBioimagingTiffSummary | undefined): WorkspaceBioimagingDimensions | undefined {
  if (!tiff?.imageWidth || !tiff.imageHeight) return undefined
  return {
    width: tiff.imageWidth,
    height: tiff.imageHeight
  }
}

function channelsFromOme(
  ome: WorkspaceBioimagingOmeSummary | undefined,
  dimensions: WorkspaceBioimagingDimensions | undefined
): string[] {
  const channels = uniqueStrings(ome?.images.flatMap((image) => image.channels.map((channel) => channel.name)) ?? [])
  if (channels.length > 0) return channels.slice(0, WORKSPACE_BIOIMAGING_MAX_CHANNELS)

  const channelCount = Math.min(dimensions?.c ?? 0, WORKSPACE_BIOIMAGING_MAX_CHANNELS)
  return Array.from({ length: channelCount }, (_unused, index) => `Channel ${index + 1}`)
}

function resolveFormat(input: {
  requestedFormat: NormalizedWorkspaceBioimagingPreviewInput['format']
  pathFormat: WorkspaceBioimagingResolvedFormat | undefined
  signatureFormat: 'czi' | 'tiff' | undefined
  tiff: TiffParseResult | undefined
  ome: WorkspaceBioimagingOmeSummary | undefined
  imageDescription: string | undefined
}): FormatResolution {
  if (input.requestedFormat !== 'auto') {
    return { format: input.requestedFormat, detectedBy: 'input' }
  }

  if (input.ome) return { format: 'ome-tiff', detectedBy: 'metadata' }

  const description = input.imageDescription?.toLowerCase() ?? ''
  if (description.includes('aperio')) return { format: 'svs', detectedBy: 'metadata' }
  if (description.includes('hamamatsu') || description.includes('ndpi')) return { format: 'ndpi', detectedBy: 'metadata' }
  if (input.signatureFormat === 'czi') return { format: 'czi', detectedBy: 'signature' }
  if (input.pathFormat) return { format: input.pathFormat, detectedBy: 'path' }
  if (input.signatureFormat === 'tiff' || input.tiff) return { format: 'tiff', detectedBy: 'signature' }
  return { format: 'unknown', detectedBy: 'unknown' }
}

function signatureFormat(bytes: Uint8Array): 'czi' | 'tiff' | undefined {
  if (hasAsciiSignature(bytes, 'ZISRAWFILE')) return 'czi'
  if (bytes.byteLength >= 4) {
    const marker = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)
    if (marker === 'II' && ((bytes[2] === 42 && bytes[3] === 0) || (bytes[2] === 43 && bytes[3] === 0))) return 'tiff'
    if (marker === 'MM' && ((bytes[2] === 0 && bytes[3] === 42) || (bytes[2] === 0 && bytes[3] === 43))) return 'tiff'
  }
  return undefined
}

function formatFromPath(path: string | undefined): WorkspaceBioimagingResolvedFormat | undefined {
  const fileName = path?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)?.toLowerCase()
  if (!fileName) return undefined
  if (fileName.endsWith('.ome.tiff') || fileName.endsWith('.ome.tif')) return 'ome-tiff'
  if (fileName.endsWith('.tiff') || fileName.endsWith('.tif')) return 'tiff'
  if (fileName.endsWith('.czi')) return 'czi'
  if (fileName.endsWith('.svs')) return 'svs'
  if (fileName.endsWith('.ndpi')) return 'ndpi'
  return undefined
}

function placeholderForFormat(format: WorkspaceBioimagingResolvedFormat): WorkspaceBioimagingPlaceholder | undefined {
  if (format === 'czi') {
    return {
      kind: 'proprietary-container',
      vendor: 'Zeiss',
      tileRendererImplemented: false,
      reason: 'CZI is a proprietary microscopy container; this worker currently returns metadata-only placeholders without pixel decoding.'
    }
  }
  if (format === 'svs') {
    return {
      kind: 'whole-slide',
      vendor: 'Aperio',
      tileRendererImplemented: false,
      reason: 'SVS is treated as a whole-slide TIFF container; tile rendering and pyramid decoding are not implemented in this worker.'
    }
  }
  if (format === 'ndpi') {
    return {
      kind: 'whole-slide',
      vendor: 'Hamamatsu',
      tileRendererImplemented: false,
      reason: 'NDPI is treated as a proprietary whole-slide TIFF container; tile rendering and pyramid decoding are not implemented in this worker.'
    }
  }
  if (format === 'unknown') {
    return {
      kind: 'unsupported',
      tileRendererImplemented: false,
      reason: 'The supplied bytes do not match a supported bioimaging metadata signature.'
    }
  }
  return undefined
}

function buildWorkspaceObservation(input: ObservationBuildInput): WorkspaceBioimagingObservation {
  const title = titleForPath(input.input.path)
  const dimensions = observationDimensions(input.dimensions)
  const bioimaging = dimensions || input.channels.length > 0
    ? {
        ...(input.channels.length > 0 ? { channels: input.channels } : {}),
        ...(dimensions ? { dimensions } : {})
      }
    : undefined
  const selection = dimensions || input.channels.length > 0
    ? {
        kind: 'bioimaging' as const,
        ...(input.channels.length > 0 ? { channels: input.channels } : {}),
        ...(dimensions
          ? {
              regions: [{
                x: 0,
                y: 0,
                width: dimensions.width,
                height: dimensions.height
              }]
            }
          : {})
      }
    : undefined

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.input.path?.trim() || 'bioimage',
      ...(input.input.workspaceRoot ? { workspaceRoot: input.input.workspaceRoot } : {}),
      ...(input.input.mimeType ? { mimeType: input.input.mimeType } : defaultMimeType(input.format) ? { mimeType: defaultMimeType(input.format) } : {}),
      ...(input.input.size !== undefined ? { size: input.input.size } : {}),
      ...(input.input.mtimeMs !== undefined ? { mtimeMs: input.input.mtimeMs } : {})
    },
    view: {
      pluginId: WORKSPACE_BIOIMAGING_PLUGIN_ID,
      modality: 'bioimaging',
      mode: 'preview',
      title
    },
    ...(selection ? { selection } : {}),
    visibleText: buildVisibleText(input),
    ...(bioimaging ? { bioimaging } : {}),
    ...(input.warnings.length > 0
      ? {
          annotations: input.warnings.map((warning, index) => ({
            id: `warning-${index + 1}`,
            kind: 'warning',
            summary: warning
          }))
        }
      : {}),
    actions: [...WORKSPACE_BIOIMAGING_ACTIONS]
  }
}

function buildVisibleText(input: ObservationBuildInput): string {
  const lines = [`Bioimaging metadata preview: ${labelForFormat(input.format)}.`]

  if (input.dimensions?.width && input.dimensions.height) {
    const parts = [
      `${input.dimensions.width} x ${input.dimensions.height}`,
      ...(input.dimensions.z ? [`Z=${input.dimensions.z}`] : []),
      ...(input.dimensions.c ? [`C=${input.dimensions.c}`] : []),
      ...(input.dimensions.t ? [`T=${input.dimensions.t}`] : [])
    ]
    lines.push(`Dimensions: ${parts.join(', ')}.`)
  }

  if (input.channels.length > 0) {
    lines.push(`Channels: ${input.channels.slice(0, 32).join(', ')}${input.channels.length > 32 ? ', ...' : ''}.`)
  }

  if (input.tilePlan) {
    const firstLevel = input.tilePlan.levels[0]
    const lastLevel = input.tilePlan.levels.at(-1)
    const decodingText = input.tilePlan.pixelDecoding
      ? 'bounded tile artifact decoding available'
      : 'no pixel artifact decoding'
    lines.push(`Tile plan: metadata-only ${input.tilePlan.levels.length} pyramid level(s), ${input.tilePlan.recommendedTileSize.width} x ${input.tilePlan.recommendedTileSize.height} nominal tiles, ${decodingText}.`)
    if (firstLevel) {
      lines.push(`Tile level 0: ${firstLevel.columns} x ${firstLevel.rows} tiles covering ${firstLevel.width} x ${firstLevel.height}.`)
    }
    if (lastLevel && lastLevel.level > 0) {
      lines.push(`Smallest planned level: ${lastLevel.width} x ${lastLevel.height} at downsample ${lastLevel.downsample}.`)
    }
  }

  if (input.tiff) {
    lines.push(`TIFF: ${input.tiff.byteOrder}-endian ${input.tiff.flavor}, first IFD at byte ${input.tiff.firstIfdOffset}.`)
    if (input.tiff.bitsPerSample?.length) lines.push(`Bits per sample: ${input.tiff.bitsPerSample.join(', ')}.`)
    if (input.tiff.compression) lines.push(`Compression: ${input.tiff.compression}.`)
    if (input.tiff.photometricInterpretation) lines.push(`Photometric interpretation: ${input.tiff.photometricInterpretation}.`)
  }

  if (input.ome) {
    lines.push(`OME XML: ${input.ome.imageCount} image metadata block(s), ${input.ome.xmlCharCount} characters scanned.`)
    for (const image of input.ome.images.slice(0, 5)) {
      const imageName = image.name || image.id || 'Image'
      const dims = image.dimensions
      const dimsText = dims?.width && dims.height
        ? `${dims.width} x ${dims.height}${dims.z ? ` Z=${dims.z}` : ''}${dims.c ? ` C=${dims.c}` : ''}${dims.t ? ` T=${dims.t}` : ''}`
        : 'dimensions unavailable'
      const channelText = image.channels.length > 0 ? `; channels: ${image.channels.map((channel) => channel.name).join(', ')}` : ''
      lines.push(`- ${imageName}: ${dimsText}${channelText}.`)
    }
  }

  if (input.placeholder) {
    lines.push(input.placeholder.reason)
  }

  if (input.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of input.warnings) lines.push(`- ${warning}`)
  }

  return truncateText(lines.join('\n'), WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS)
}

function observationDimensions(dimensions: WorkspaceBioimagingDimensions | undefined): NonNullable<WorkspaceBioimagingObservation['bioimaging']>['dimensions'] {
  if (!dimensions?.width || !dimensions.height) return undefined
  return {
    width: dimensions.width,
    height: dimensions.height,
    ...(dimensions.z ? { z: dimensions.z } : {}),
    ...(dimensions.t ? { t: dimensions.t } : {})
  }
}

function clampRegionToDimensions(
  region: WorkspaceBioimagingSelectionRegion,
  dimensions: WorkspaceBioimagingDimensions | undefined,
  clampToImage: boolean
): { region: WorkspaceBioimagingSelectionRegion, clipped: boolean } {
  if (!clampToImage || !dimensions?.width || !dimensions.height) {
    return { region, clipped: false }
  }

  const x = clampNumber(region.x, 0, dimensions.width - 1)
  const y = clampNumber(region.y, 0, dimensions.height - 1)
  const width = Math.min(region.width, Math.max(Number.EPSILON, dimensions.width - x))
  const height = Math.min(region.height, Math.max(Number.EPSILON, dimensions.height - y))
  const z = region.z !== undefined && dimensions.z
    ? clampNumber(region.z, 0, dimensions.z - 1)
    : region.z
  const t = region.t !== undefined && dimensions.t
    ? clampNumber(region.t, 0, dimensions.t - 1)
    : region.t
  const clamped = {
    x,
    y,
    width,
    height,
    ...(z !== undefined ? { z } : {}),
    ...(t !== undefined ? { t } : {})
  }
  const clipped = region.x !== clamped.x ||
    region.y !== clamped.y ||
    region.width !== clamped.width ||
    region.height !== clamped.height ||
    region.z !== clamped.z ||
    region.t !== clamped.t

  return { region: clamped, clipped }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function buildRegionSelectionVisibleText(
  region: WorkspaceBioimagingSelectionRegion,
  roiId: string | undefined,
  warnings: string[]
): string {
  const lines = [
    `Bioimaging ROI selection${roiId ? ` ${roiId}` : ''}: x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}${region.z !== undefined ? `, z=${region.z}` : ''}${region.t !== undefined ? `, t=${region.t}` : ''}.`,
    'No pixels were decoded; selection was computed from the metadata preview object.'
  ]
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  return truncateText(lines.join('\n'), WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS)
}

function resolveKnownChannel(
  requested: string,
  knownChannels: string[]
): { name: string, index: number } | undefined {
  const exactIndex = knownChannels.indexOf(requested)
  if (exactIndex >= 0) return { name: knownChannels[exactIndex] ?? requested, index: exactIndex }

  const requestedLower = requested.toLowerCase()
  const lowerIndex = knownChannels.findIndex((channel) => channel.toLowerCase() === requestedLower)
  if (lowerIndex >= 0) return { name: knownChannels[lowerIndex] ?? requested, index: lowerIndex }
  return undefined
}

function addSelectedChannel(
  selectedChannels: string[],
  selectedIndexes: Set<number>,
  channel: string,
  index?: number
): void {
  const normalized = truncateText(channel.trim(), 128)
  if (!normalized) return
  if (!selectedChannels.includes(normalized)) selectedChannels.push(normalized)
  if (index !== undefined) selectedIndexes.add(index)
}

function channelNameForIndex(index: number, dimensions: WorkspaceBioimagingDimensions | undefined): string | undefined {
  if (dimensions?.c && index < dimensions.c) return `Channel ${index + 1}`
  return undefined
}

function buildChannelSelectionVisibleText(channels: string[], warnings: string[]): string {
  const selected = channels.length > 0 ? channels.join(', ') : 'none'
  const lines = [
    `Bioimaging channel selection: ${selected}.`,
    'No pixels were decoded; selection was computed from the metadata preview object.'
  ]
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  return truncateText(lines.join('\n'), WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS)
}

function generatedRoiId(region: WorkspaceBioimagingSelectionRegion): string {
  const raw = `roi-x${region.x}-y${region.y}-w${region.width}-h${region.height}${region.z !== undefined ? `-z${region.z}` : ''}${region.t !== undefined ? `-t${region.t}` : ''}`
  return truncateText(raw.replace(/[^A-Za-z0-9_.:-]+/g, '-'), 256)
}

function buildAnnotationSummary(
  roiId: string,
  label: string | undefined,
  body: string | undefined,
  region: WorkspaceBioimagingSelectionRegion,
  channels: string[]
): string {
  const parts = [
    label || `ROI ${roiId}`,
    body,
    `Region ${formatRegion(region)}`,
    channels.length > 0 ? `Channels: ${channels.join(', ')}` : undefined,
    'metadata-only'
  ].filter((part): part is string => Boolean(part))
  return truncateText(parts.join('. '), 1000)
}

function buildRegionAnnotationVisibleText(
  annotation: WorkspaceBioimagingRoiAnnotation,
  warnings: string[]
): string {
  const lines = [
    `Bioimaging ROI annotation ${annotation.roiId}${annotation.label ? `: ${annotation.label}` : ''}.`,
    `Region: ${formatRegion(annotation.region)}.`,
    ...(annotation.channels?.length ? [`Channels: ${annotation.channels.join(', ')}.`] : []),
    ...(annotation.body ? [`Body: ${annotation.body}`] : []),
    'Metadata-only annotation; no pixels, screenshots, rendered tiles, or decoded image data are included.'
  ]
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  return truncateText(lines.join('\n'), WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS)
}

function metadataOnlyPlaceholderWarning(
  preview: { format: WorkspaceBioimagingResolvedFormat, placeholder?: WorkspaceBioimagingPlaceholder },
  noun: 'annotation' | 'export'
): string | undefined {
  if (!preview.placeholder) return undefined
  return `${labelForFormat(preview.format)} preview is metadata-only; ROI ${noun} contains coordinate metadata only and no pixels, screenshots, or rendered tiles.`
}

function buildRoiSetExportVisibleText(roiSet: WorkspaceBioimagingRoiSet, warnings: string[]): string {
  const roiCount = roiSet.selection.roiIds?.length ?? 0
  const regionCount = roiSet.selection.regions?.length ?? 0
  const channelCount = roiSet.selection.channels?.length ?? 0
  const lines = [
    `Bioimaging ROI set export: ${roiCount} ROI id(s), ${regionCount} region(s), ${channelCount} channel(s), ${roiSet.annotations.length} annotation(s).`,
    'Export is metadata-only JSON; containsPixels=false and no image pixels, tiles, screenshots, or rendered image data are included.'
  ]
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  return truncateText(lines.join('\n'), WORKSPACE_BIOIMAGING_MAX_VISIBLE_TEXT_CHARS)
}

function formatRegion(region: WorkspaceBioimagingSelectionRegion): string {
  return `x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}${region.z !== undefined ? `, z=${region.z}` : ''}${region.t !== undefined ? `, t=${region.t}` : ''}`
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of raw.matchAll(pattern)) {
    attrs[match[1] ?? ''] = decodeXmlEntities(match[2] ?? match[3] ?? '')
  }
  return attrs
}

function positiveIntAttribute(attrs: Record<string, string>, key: string): number | undefined {
  const value = Number.parseInt(attrs[key] ?? '', 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function firstPositiveInteger(value: string | undefined): number | undefined {
  const first = positiveIntegerList(value)[0]
  return first
}

function positiveIntegerList(value: string | undefined): number[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((number) => Number.isInteger(number) && number > 0)
}

function decodeAsciiTag(bytes: Uint8Array): string {
  const nulIndex = bytes.indexOf(0)
  const valueBytes = nulIndex >= 0 ? bytes.subarray(0, nulIndex) : bytes
  return utf8Decoder.decode(valueBytes)
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function boundedWarnings(warnings: string[]): string[] {
  const seen = new Set<string>()
  const bounded: string[] = []
  for (const warning of warnings) {
    const normalized = truncateText(warning.trim(), 1000)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    bounded.push(normalized)
    if (bounded.length === WORKSPACE_BIOIMAGING_MAX_WARNINGS) break
  }
  return bounded
}

function defaultMimeType(format: WorkspaceBioimagingResolvedFormat): string | undefined {
  if (format === 'czi') return 'application/x-czi'
  if (['tiff', 'ome-tiff', 'svs', 'ndpi'].includes(format)) return 'image/tiff'
  return undefined
}

function labelForFormat(format: WorkspaceBioimagingResolvedFormat): string {
  switch (format) {
    case 'ome-tiff':
      return 'OME-TIFF'
    case 'tiff':
      return 'TIFF'
    case 'czi':
      return 'CZI'
    case 'svs':
      return 'SVS whole-slide image'
    case 'ndpi':
      return 'NDPI whole-slide image'
    case 'unknown':
      return 'unknown bioimaging format'
  }
}

function titleForPath(path: string | undefined): string {
  const trimmed = path?.trim()
  if (!trimmed) return 'Bioimaging data'
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    const trimmed = truncateText(value.trim(), 128)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

function hasAsciiSignature(bytes: Uint8Array, signature: string): boolean {
  if (bytes.byteLength < signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature.charCodeAt(index)) return false
  }
  return true
}

function readUint16(view: DataView, offset: number, little: boolean): number {
  return view.getUint16(offset, little)
}

function readUint64AsNumber(view: DataView, offset: number, little: boolean): number | undefined {
  const value = view.getBigUint64(offset, little)
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined
}

function readInt64AsNumber(view: DataView, offset: number, little: boolean): number | undefined {
  const value = view.getBigInt64(offset, little)
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return undefined
  return Number(value)
}

function safeMultiply(left: number, right: number): number | undefined {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0) return undefined
  const value = left * right
  return Number.isSafeInteger(value) ? value : undefined
}

function canRead(bytes: Uint8Array, offset: number, byteLength: number): boolean {
  return Number.isSafeInteger(offset) &&
    Number.isSafeInteger(byteLength) &&
    offset >= 0 &&
    byteLength >= 0 &&
    offset <= bytes.byteLength - byteLength
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}
