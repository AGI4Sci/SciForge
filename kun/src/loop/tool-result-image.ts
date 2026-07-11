import type { TurnItem } from '../contracts/items.js'

export type ToolResultImage = {
  mimeType: string
  dataBase64: string
  width?: number
  height?: number
}

export const IMAGE_TOOL_RESULT_TOKEN_ESTIMATE = 1_200

const MODEL_VISIBLE_IMAGE_KINDS = new Set(['image', 'computer_screenshot', 'visualSnapshot'])

const EVICTED_IMAGE_PLACEHOLDER =
  '[older screenshot omitted to save context; take another screenshot if you need the current view]'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toImage(value: unknown): ToolResultImage | null {
  if (!isRecord(value)) return null
  const dataBase64 = typeof value.data_base64 === 'string'
    ? value.data_base64
    : typeof value.dataBase64 === 'string'
      ? value.dataBase64
      : ''
  const mimeType = typeof value.mime_type === 'string'
    ? value.mime_type
    : typeof value.mimeType === 'string'
      ? value.mimeType
      : ''
  if (!dataBase64 || !mimeType) return null
  const width = typeof value.width === 'number' ? value.width : undefined
  const height = typeof value.height === 'number' ? value.height : undefined
  return {
    mimeType,
    dataBase64,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {})
  }
}

function toMcpContentImage(value: unknown, metadata: unknown): ToolResultImage | null {
  if (!isRecord(value)) return null
  if (value.type !== 'image') return null
  const dataBase64 = typeof value.data === 'string' ? value.data : ''
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : ''
  if (!dataBase64 || !mimeType) return null
  const meta = isRecord(metadata) ? metadata : {}
  const width = typeof meta.width === 'number' ? meta.width : undefined
  const height = typeof meta.height === 'number' ? meta.height : undefined
  return {
    mimeType,
    dataBase64,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {})
  }
}

function addUniqueImage(images: ToolResultImage[], image: ToolResultImage | null): void {
  if (!image) return
  if (!images.some((candidate) => candidate.dataBase64 === image.dataBase64)) images.push(image)
}

function directToolResultImages(output: Record<string, unknown>): ToolResultImage[] {
  const kind = typeof output.kind === 'string' ? output.kind : ''
  if (!MODEL_VISIBLE_IMAGE_KINDS.has(kind)) return []
  const images: ToolResultImage[] = []
  if (Array.isArray(output.images)) {
    for (const entry of output.images) addUniqueImage(images, toImage(entry))
  }
  addUniqueImage(images, toImage(output))
  return images
}

function mcpContentImages(output: Record<string, unknown>): ToolResultImage[] {
  const structured = isRecord(output.structuredContent) ? output.structuredContent : {}
  const content = Array.isArray(output.content) ? output.content : []
  const metadata = Array.isArray(structured.images) ? structured.images : []
  const visualResource = isRecord(structured.resource) && structured.resource.kind === 'visualSnapshot'
    ? structured.resource
    : undefined
  const images: ToolResultImage[] = []
  let imageIndex = 0
  for (const entry of content) {
    if (!isRecord(entry) || entry.type !== 'image') continue
    // MCP `content.type=image` is already an explicit model-visible image
    // contract. Do not require a second, tool-specific `kind` marker: doing so
    // silently drops otherwise valid images from tools such as
    // gui_visual_capture, whose metadata lives under `resource`.
    addUniqueImage(images, toMcpContentImage(entry, metadata[imageIndex] ?? visualResource))
    imageIndex += 1
  }
  return images
}

export function extractToolResultImages(output: unknown): ToolResultImage[] {
  if (!isRecord(output)) return []
  const images: ToolResultImage[] = []
  for (const image of directToolResultImages(output)) addUniqueImage(images, image)
  for (const image of mcpContentImages(output)) addUniqueImage(images, image)
  for (const key of ['result', 'structuredContent', 'output'] as const) {
    if (isRecord(output[key])) {
      for (const image of extractToolResultImages(output[key])) addUniqueImage(images, image)
    }
  }
  return images
}

export function isModelVisibleImageOutput(output: unknown): boolean {
  return extractToolResultImages(output).length > 0
}

export function toolResultTextWithoutImages(output: unknown): string {
  if (typeof output === 'string') return output
  if (!isRecord(output)) {
    try {
      return JSON.stringify(output) ?? ''
    } catch {
      return String(output)
    }
  }
  const clone = stripImagesFromOutput(output)
  try {
    return JSON.stringify(clone)
  } catch {
    return ''
  }
}

function stripImagesFromOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  const clone: Record<string, unknown> = {}
  let strippedImage = false
  for (const [key, value] of Object.entries(output)) {
    if (key === 'data_base64') {
      clone[key] = EVICTED_IMAGE_PLACEHOLDER
      strippedImage = true
      continue
    }
    if (key === 'images') {
      clone.images_omitted = Array.isArray(value) ? value.length : 1
      strippedImage = true
      continue
    }
    if (key === 'content' && Array.isArray(value)) {
      clone.content = value.map((entry) => {
        if (!isRecord(entry) || entry.type !== 'image') return stripImagesFromOutput(entry)
        strippedImage = true
        return { ...entry, data: EVICTED_IMAGE_PLACEHOLDER }
      })
      continue
    }
    if (isRecord(value)) {
      clone[key] = stripImagesFromOutput(value)
      continue
    }
    if (Array.isArray(value)) {
      clone[key] = value.map((entry) => stripImagesFromOutput(entry))
      continue
    }
    clone[key] = value
  }
  if (strippedImage && typeof clone.note !== 'string') clone.note = EVICTED_IMAGE_PLACEHOLDER
  return clone
}

export function capToolResultImages(history: TurnItem[], maxKept: number): TurnItem[] {
  const keep = Math.max(0, Math.floor(maxKept))
  const imageIndexes: number[] = []
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index]
    if (item?.kind === 'tool_result' && isModelVisibleImageOutput(item.output)) {
      imageIndexes.push(index)
    }
  }
  if (imageIndexes.length <= keep) return history
  const evict = new Set(imageIndexes.slice(0, imageIndexes.length - keep))
  return history.map((item, index) => {
    if (!evict.has(index) || item.kind !== 'tool_result') return item
    return { ...item, output: stripImagesFromOutput(item.output) }
  })
}
