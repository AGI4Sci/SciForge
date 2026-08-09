import type { WorkspaceHostPayload } from '@sciforge/domain-sdk/workspace-host'

const MAX_INLINE_BYTES = 16_384
const PREVIEW_BYTES = 4_096

export type BoundedRuntimePayload = Readonly<{
  payload: WorkspaceHostPayload
  artifactContent?: string
}>

/** Bounds known tool-result expansion fields before IPC/Workspace Host serialization. */
export function boundRuntimeEventPayload(
  threadId: string,
  event: WorkspaceHostPayload
): WorkspaceHostPayload {
  const raw = record(event)
  const item = record(raw.item)
  const boundedItem = Object.keys(item).length > 0
    ? boundToolPayload(threadId, item, stringValue(item.id) || stringValue(raw.itemId))
    : undefined
  const boundedEvent = boundToolPayload(
    threadId,
    boundedItem ? { ...raw, item: boundedItem.payload } : raw,
    stringValue(raw.itemId) || stringValue(item.id)
  )
  return boundedEvent.payload
}

export function boundRuntimeToolItem(
  threadId: string,
  item: WorkspaceHostPayload
): WorkspaceHostPayload {
  return boundToolPayload(threadId, record(item), stringValue(record(item).id)).payload
}

export function toolArtifactContent(value: unknown): string | undefined {
  const payload = record(value)
  const oversized: Record<string, unknown> = {}
  const detail = typeof payload.detail === 'string' ? payload.detail : ''
  if (Buffer.byteLength(detail, 'utf8') > MAX_INLINE_BYTES) oversized.detail = detail
  if (serializedByteLength(payload.meta) > MAX_INLINE_BYTES) oversized.meta = payload.meta
  if (serializedByteLength(payload.arguments) > MAX_INLINE_BYTES) {
    oversized.arguments = payload.arguments
  }
  if (serializedByteLength(payload.completionReceipts) > MAX_INLINE_BYTES) {
    oversized.completionReceipts = payload.completionReceipts
  }
  const receipt = record(payload.receipt)
  if (
    serializedByteLength(receipt.output) > MAX_INLINE_BYTES ||
    Buffer.byteLength(stringValue(receipt.detail), 'utf8') > MAX_INLINE_BYTES
  ) oversized.receipt = payload.receipt
  const keys = Object.keys(oversized)
  if (keys.length === 0) return undefined
  if (keys.length === 1 && typeof oversized.detail === 'string') return oversized.detail
  return JSON.stringify(oversized)
}

export function encodeRuntimeToolArtifactRef(itemId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, itemId }), 'utf8').toString('base64url')
}

export function decodeRuntimeToolArtifactRef(ref: string): string {
  try {
    const value = record(JSON.parse(Buffer.from(ref, 'base64url').toString('utf8')))
    const itemId = stringValue(value.itemId)
    if (value.v !== 1 || !itemId) throw new Error()
    return itemId
  } catch {
    throw new Error('Invalid tool artifact reference.')
  }
}

function boundToolPayload(
  threadId: string,
  payload: Record<string, unknown>,
  itemId: string
): BoundedRuntimePayload {
  const artifactContent = toolArtifactContent(payload)
  if (!artifactContent) return { payload: asPayload(payload) }
  const detail = typeof payload.detail === 'string' ? payload.detail : undefined
  const receipt = record(payload.receipt)
  const bounded: Record<string, unknown> = {
    ...payload,
    ...(detail !== undefined && Buffer.byteLength(detail, 'utf8') > MAX_INLINE_BYTES
      ? { detail: truncateUtf8(detail, PREVIEW_BYTES) }
      : {}),
    ...(serializedByteLength(payload.meta) > MAX_INLINE_BYTES
      ? { meta: compactMetadata(record(payload.meta)) }
      : {}),
    ...(serializedByteLength(payload.completionReceipts) > MAX_INLINE_BYTES
      ? { completionReceipts: compactCompletionReceipts(arrayValue(payload.completionReceipts)) }
      : {}),
    ...(Object.keys(receipt).length > 0
      ? { receipt: boundReceipt(receipt) }
      : {})
  }
  if (serializedByteLength(payload.arguments) > MAX_INLINE_BYTES) {
    delete bounded.arguments
  }
  if (itemId) {
    bounded.detailArtifact = {
      runtimeId: 'codex',
      threadId,
      ref: encodeRuntimeToolArtifactRef(itemId),
      size: Buffer.byteLength(artifactContent, 'utf8')
    }
  }
  return {
    payload: asPayload(bounded),
    artifactContent
  }
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {}
  let remainingBytes = 2_048
  for (const [key, value] of Object.entries(metadata).slice(0, 32)) {
    if (remainingBytes <= 0) break
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      compact[key] = value
      remainingBytes -= serializedByteLength({ [key]: value })
      continue
    }
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 512) {
      const fieldBytes = serializedByteLength({ [key]: value })
      if (fieldBytes <= remainingBytes) {
        compact[key] = value
        remainingBytes -= fieldBytes
      }
    }
  }
  return compact
}

function compactCompletionReceipts(receipts: unknown[]): unknown[] {
  return receipts.slice(0, 4).map((value) => {
    const receipt = record(value)
    const compact: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(receipt)) {
      if (field === null || typeof field === 'boolean' || typeof field === 'number') {
        compact[key] = field
      } else if (typeof field === 'string') {
        compact[key] = truncateUtf8(field, 128)
      } else if (Array.isArray(field)) {
        compact[key] = field.slice(0, 8).flatMap((part) =>
          typeof part === 'string' ? [truncateUtf8(part, 128)] : []
        )
      }
    }
    return compact
  })
}

function boundReceipt(receipt: Record<string, unknown>): Record<string, unknown> {
  const detail = typeof receipt.detail === 'string' ? receipt.detail : undefined
  const bounded: Record<string, unknown> = {
    ...receipt,
    ...(detail !== undefined && Buffer.byteLength(detail, 'utf8') > MAX_INLINE_BYTES
      ? { detail: truncateUtf8(detail, PREVIEW_BYTES) }
      : {})
  }
  if (serializedByteLength(receipt.output) > MAX_INLINE_BYTES) delete bounded.output
  return bounded
}

function serializedByteLength(value: unknown): number {
  if (value === undefined) return 0
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

function asPayload(value: unknown): WorkspaceHostPayload {
  return value as WorkspaceHostPayload
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
