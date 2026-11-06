import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import type { ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js'
import { AGENT_RUNTIME_TOOL_MODEL_CONTENT_DEFAULT_BYTES, AGENT_RUNTIME_TOOL_MODEL_CONTENT_MAX_BYTES, agentRuntimeToolModelContent, type AgentRuntimeToolSurface, type AgentRuntimeToolCall, type AgentRuntimeToolResult } from './agent-tool-surface'

const PREVIEW_MAX_BYTES = 2800
const IMAGE_MAX_BYTES = 20 * 1024 * 1024
const IMAGE_BATCH_MAX_BYTES = 25 * 1024 * 1024
const IMAGE_MAX_PIXELS = 25_000_000
const PNG_MAX_CHUNKS = 4096
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})
const imageDeliveries = new WeakMap<AgentRuntimeToolResult, ImageProjection>()
type ImageProjection = { value: unknown; images: ImageContent[]; found: boolean }

/** A byte-integrity check, not a provenance, permission or task-completion receipt. */
function verifiedPng(record: Record<string, unknown>): ImageContent {
  const invalid = (): never => { throw new Error('Image payload failed Host byte, digest or PNG validation.') }
  if (record.mimeType !== 'image/png' || typeof record.dataUrl !== 'string') return invalid()
  const prefix = 'data:image/png;base64,'
  if (!record.dataUrl.startsWith(prefix) || record.dataUrl.length > prefix.length + Math.ceil(IMAGE_MAX_BYTES / 3) * 4) return invalid()
  const encoded = record.dataUrl.slice(prefix.length)
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) return invalid()
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length < 57 || bytes.length > IMAGE_MAX_BYTES || bytes.toString('base64') !== encoded || record.byteLength !== bytes.length) return invalid()
  const digest = createHash('sha256').update(bytes).digest('hex')
  const declared = [record.digest, record.sha256].filter(value => value !== undefined)
  if (!declared.length || declared.some(value => value !== digest)) return invalid()
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return invalid()
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, chunks = 0
  const compressed: Buffer[] = []
  while (offset + 12 <= bytes.length) {
    if (++chunks > PNG_MAX_CHUNKS) return invalid()
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) return invalid()
    // Buffer's ASCII decoder clears bit 7: validate the original bytes before
    // decoding, otherwise e.g. 0xc9DAT can masquerade as the critical IDAT type.
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    if (!typeBytes.every(byte => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122)) return invalid()
    const type = typeBytes.toString('ascii')
    const chunk = bytes.subarray(offset + 4, offset + 8 + length)
    let crc = 0xffffffff
    for (const byte of chunk) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff]
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) return invalid()
    if (offset === 8 && type !== 'IHDR') return invalid()
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) return invalid()
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12)
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[offset + 17]] ?? 0
      if (!width || !height || width * height > IMAGE_MAX_PIXELS || width !== record.width || height !== record.height || bytes[offset + 16] !== 8 || !channels || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) return invalid()
    } else if (type === 'IDAT') {
      if (length) compressed.push(bytes.subarray(offset + 8, offset + 8 + length))
    } else if (type === 'IEND') {
      if (length || offset + 12 !== bytes.length) return invalid()
      ended = true
    } else if (type[0] === type[0].toUpperCase() && type !== 'PLTE') return invalid()
    offset += length + 12
  }
  if (!ended || !compressed.length || offset !== bytes.length) return invalid()
  const rowBytes = width * channels + 1
  const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: rowBytes * height })
  if (decoded.length !== rowBytes * height) return invalid()
  for (let row = 0; row < height; row++) if (decoded[row * rowBytes] > 4) return invalid()
  return { type: 'image', mimeType: 'image/png', data: encoded }
}

function projectImages(value: unknown, imageInputAllowed = true): ImageProjection {
  const images: ImageContent[] = []
  let found = false, total = 0, nodes = 0
  const visit = (item: unknown, depth: number): unknown => {
    if (item === null || typeof item !== 'object') return item
    if (++nodes > 10000 || depth > 16) return '[nested result omitted]'
    if (Array.isArray(item)) return item.map(child => visit(child, depth + 1))
    const record = item as Record<string, unknown>
    if (typeof record.dataUrl === 'string' && (record.dataUrl.startsWith('data:image/') || typeof record.mimeType === 'string' && record.mimeType.startsWith('image/'))) {
      found = true
      const { dataUrl: _bytes, integrityVerified: _claim, ...metadata } = record
      if (!imageInputAllowed) return { ...visit(metadata, depth + 1) as object, imageDelivery: { status: 'rejected', code: 'unsupported_model_image_input', scope: 'mcp-content-only', message: 'The current runtime model has no approved image-input declaration. No image block was delivered.' } }
      try {
        const image = verifiedPng(record)
        const byteLength = record.byteLength as number
        if (images.length >= 4 || total + byteLength > IMAGE_BATCH_MAX_BYTES) throw new Error('Image batch exceeds Host delivery limit.')
        total += byteLength
        images.push(image)
        // Metadata can itself contain an image; keep this block's index before
        // visiting children so nested and duplicate images retain distinct refs.
        const contentIndex = images.length
        return { ...visit(metadata, depth + 1) as object, imageDelivery: { status: 'attached', scope: 'mcp-content-only', modelConsumption: 'unverified', contentIndex, byteIntegrityVerified: true } }
      } catch {
        return { ...visit(metadata, depth + 1) as object, imageDelivery: { status: 'rejected', code: 'invalid_or_unsupported_image_payload', message: 'Host rejected the image bytes, metadata, format or delivery limit. No image block was delivered.' } }
      }
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child, depth + 1)]))
  }
  const projected = visit(value, 0)
  return { value: projected, images, found }
}

/** MCP transport projection uses original value even when bounded model text is a summary. */
export function modelVisibleToolResultContent(result: AgentRuntimeToolResult, imageInputAllowed = true): Array<TextContent | ImageContent> {
  // Reproject on denial: the bounded result may cache a previous transport's
  // accepted images and prepared text. Neither may bypass this lease's gate.
  const cached = imageInputAllowed ? imageDeliveries.get(result) : undefined
  const projection = cached ?? projectImages(result.value, imageInputAllowed)
  // Denial only replaces image-bearing text; text-only canonical modelContent
  // may be the sole tool output (result.value can legitimately be undefined).
  const prepared = imageInputAllowed || !projection.found ? agentRuntimeToolModelContent(result) : undefined
  const text = projection.found
    ? cached ? prepared! : modelVisibleToolResult(projection.value, 'unavailable', false)
    : prepared ?? modelVisibleToolResult(result.value, 'unavailable', false)
  return [{ type: 'text', text }, ...projection.images]
}

/** Project delivery only; the canonical durable tool artifact owns the complete result. */
function modelVisibleToolResult(value: unknown, artifactRef: string, canReadHistory = true): string {
  const complete = JSON.stringify(value) ?? 'null'
  if (Buffer.byteLength(complete) <= AGENT_RUNTIME_TOOL_MODEL_CONTENT_DEFAULT_BYTES) return complete
  const delivery = {
    status: 'partial',
    originalBytes: Buffer.byteLength(complete),
    sha256: createHash('sha256').update(complete).digest('hex'),
    instruction: 'The tool executed. Read omitted fields from this artifact, not by re-executing. schemaPointer is an exact JSON pointer into the stored original (not this preview). Pass it as jsonPointer with nextRead.arguments. Follow nextOffset until null before using a schema. items may wrap an original root array.',
    ...(canReadHistory
      ? { nextRead: { tool: 'sciforge_read_history', arguments: { artifactRef, offset: 0, maxBytes: AGENT_RUNTIME_TOOL_MODEL_CONTENT_MAX_BYTES } } }
      : { historyAvailable: false, instruction: 'The tool returned; its complete result is stored, but history reading is outside this turn tool scope. Do not re-execute the original action to recover omitted output. Report the scope limitation.', artifactRef })
  }
  const projected = Array.isArray(value) && value.every(isDescriptor)
    ? compactDescriptors(value, '')
    : compactDynamicToolValue(value, 0)
  const preview = projected && typeof projected === 'object' && !Array.isArray(projected)
    ? projected : { items: projected }
  const candidate = JSON.stringify({ ...preview, _delivery: delivery })
  if (Buffer.byteLength(candidate) <= AGENT_RUNTIME_TOOL_MODEL_CONTENT_DEFAULT_BYTES) return candidate
  return JSON.stringify({ _delivery: delivery })
}

function isDescriptor(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).operationRef === 'string')
}

function compactDescriptors(values: unknown[], pointer: string, single = false): unknown[] {
  const compact: Record<string, unknown>[] = []
  for (const [index, value] of values.entries()) {
    if (!isDescriptor(value)) continue
    const descriptor: Record<string, unknown> = {}
    for (const key of ['operationRef', 'title', 'effect', 'approval']) {
      if (value[key] !== undefined) descriptor[key] = value[key]
    }
    if (value.inputShape !== undefined) {
      descriptor.schemaPointer = `${pointer}${single ? '' : `/${index}`}/inputShape`
    }
    if (Buffer.byteLength(JSON.stringify([...compact, descriptor])) > PREVIEW_MAX_BYTES - 200) break
    compact.push(descriptor)
  }
  for (const [index, descriptor] of compact.entries()) {
    const value = values[index] as Record<string, unknown>
    if (value.inputShape === undefined) continue
    const omission = descriptor.schemaPointer
    delete descriptor.schemaPointer
    descriptor.inputShape = value.inputShape
    if (Buffer.byteLength(JSON.stringify(compact)) > PREVIEW_MAX_BYTES - 200) {
      delete descriptor.inputShape
      descriptor.schemaPointer = omission
    }
  }
  if (compact.length < values.length) {
    // Reserve room for an explicit continuation; never imply a partial catalog is complete.
    while (compact.length && Buffer.byteLength(JSON.stringify([...compact, {
      _truncated: true, totalItems: values.length, nextIndex: compact.length, jsonPointer: pointer
    }])) > PREVIEW_MAX_BYTES - 200) compact.pop()
    return [...compact, { _truncated: true, totalItems: values.length, nextIndex: compact.length, jsonPointer: pointer }]
  }
  return compact
}

function compactDynamicToolValue(value: unknown, depth: number, key?: string, pointer = ''): unknown {
  if (isDescriptor(value) && value.inputShape !== undefined) return compactDescriptors([value], pointer, true)[0]
  if (Array.isArray(value) && value.length > 0 && value.every(isDescriptor)) return compactDescriptors(value, pointer)
  if (key === 'inputShape') return value
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    if (isDynamicToolLocatorKey(key)) return value
    const limit = 160
    return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
  }
  // Capability envelopes commonly place the useful result four levels down
  // (response -> output -> domain envelope -> result -> records). Keep one
  // more shallow record level visible so the Agent can inspect returned IDs
  // and labels;
  // the byte boundary and array cap still bound the model-visible payload.
  // Small structured workflow payloads can legitimately place the useful
  // values several levels down (for example renderRequest.data.series.x/y).
  // Preserve those bounded leaves so the evaluator can independently parse
  // the receipt instead of treating a successful action as unverifiable.
  if (depth >= 8) return '[nested result omitted]'
  if (Array.isArray(value)) {
    // Preserve short primitive lists (status enumerations, identifiers, and
    // similar contract values) in full. Nested result arrays remain bounded
    // aggressively so large records cannot consume the handoff budget.
    const primitiveList = value.every((item) => (
      item === null || typeof item === 'boolean' || typeof item === 'number' || typeof item === 'string'
    ))
    const limit = primitiveList ? 16 : 3
    const compacted = value.slice(0, limit).map((item, index) => compactDynamicToolValue(item, depth + 1, undefined, `${pointer}/${index}`))
    return value.length > limit ? [...compacted, { _truncated: true }] : compacted
  }
  if (!value || typeof value !== 'object') return String(value)

  const source = value as Record<string, unknown>
  const target: Record<string, unknown> = {}
  let omitted = false
  for (const key of Object.keys(source).sort((left, right) => dynamicToolResultKeyPriority(left) - dynamicToolResultKeyPriority(right))) {
    target[key] = compactDynamicToolValue(source[key], depth + 1, key, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)
    if (Buffer.byteLength(JSON.stringify(target), 'utf8') > PREVIEW_MAX_BYTES) {
      delete target[key]
      omitted = true
    }
  }
  if (omitted && Buffer.byteLength(JSON.stringify({ ...target, _truncated: true }), 'utf8') <= PREVIEW_MAX_BYTES) {
    target._truncated = true
  }
  return target
}

function isDynamicToolLocatorKey(key: string | undefined): boolean {
  return Boolean(key && /(?:path|artifact|filename|ref|cursor|token|id)$/iu.test(key)) || key === 'uri'
}

function dynamicToolResultKeyPriority(key: string): number {
  if (/^(?:capabilityId|operationRef|resourceRef|artifactRef|path|relativePath|filePath|id|status|operations|progress|relation|changed|replayed|nextCursor|nextOffset|retryable|recoveryGuidance)$/u.test(key)) return 0
  if (/^(?:output|result|data|artifact|artifacts|manifest|lineage|source|target|recipe|figure|validation|versionCommit|versions|value|ref)$/u.test(key)) return 1
  if (/^(?:state|error|message|summary|count|records|fields|items|events|completedAt)$/u.test(key)) return 2
  return 3
}


/** Every runtime shares this boundary; transport adapters only serialize modelContent. */
export function withBoundedToolResults(surface: AgentRuntimeToolSurface, persist: (
  request: AgentRuntimeToolCall, result: AgentRuntimeToolResult
) => Promise<string>, persistMutation?: (request: AgentRuntimeToolCall, result: AgentRuntimeToolResult, signal?: AbortSignal) => Promise<void>): AgentRuntimeToolSurface {
  return {
    ...surface,
    async call(request, options) {
      const result = await surface.call(request, options)
      await persistMutation?.(request, result, options?.signal)
      const projection = projectImages(result.value)
      if (!projection.found && agentRuntimeToolModelContent(result) !== undefined) return result
      const complete = JSON.stringify(result.value) ?? 'null'
      const descriptors = Array.isArray(result.value) ? result.value : [result.value]
      const singleSchema = descriptors.length === 1 && isDescriptor(descriptors[0]) && descriptors[0].inputShape !== undefined
      const budget = singleSchema ? AGENT_RUNTIME_TOOL_MODEL_CONTENT_MAX_BYTES : AGENT_RUNTIME_TOOL_MODEL_CONTENT_DEFAULT_BYTES
      if (!projection.found && Buffer.byteLength(complete) <= budget) {
        return { ...result, modelContent: complete }
      }
      let artifactRef: string
      try { artifactRef = await persist(request, result) }
      catch (cause) {
        throw Object.assign(new Error('The tool returned, but saving its result failed. Do not repeat the original action; inspect its resulting state before taking another action.', { cause }), {
          code: 'tool_result_history_unavailable', retryable: false,
          recoveryGuidance: 'Inspect the resulting state; do not retry the original execution to recover output.'
        })
      }
      surface.assertPrincipalLease?.(request.context)
      const visibleValue = projection.found ? { result: projection.value, _imageDelivery: { artifactRef, scope: 'byte-integrity-only', provenanceVerified: false } } : result.value
      const bounded = { ...result, modelContent: modelVisibleToolResult(visibleValue, artifactRef, !request.context.allowedToolNames || request.context.allowedToolNames.includes('sciforge_read_history')) }
      if (projection.found) imageDeliveries.set(bounded, projection)
      return bounded
    }
  }
}
