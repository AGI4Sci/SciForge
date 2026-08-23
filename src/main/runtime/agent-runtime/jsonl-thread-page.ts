import { truncateWellFormedUtf8 } from '@sciforge/domain-sdk/unicode'
import type { AppDataJsonlStore } from '../../services/app-data-store'
import type {
  AgentRuntimeExecutionReceipt,
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeCompletionReceipt,
  AgentRuntimeThreadPage
} from '../../../shared/agent-runtime-contract'

type SequencedThreadRecord = {
  seq: number
  threadId: string
}

export const JSONL_THREAD_PAGE_MAX_RECORDS = 256
export const JSONL_THREAD_PAGE_MAX_SOURCE_BYTES = 256 * 1024
export const AGENT_RUNTIME_THREAD_PAGE_MAX_DELIVERY_BYTES = 4 * 1024 * 1024

export async function readLatestJsonlThreadRecord<RecordType extends SequencedThreadRecord>(options: {
  store: AppDataJsonlStore
  threadId: string
  parse: (line: string) => RecordType | null
}): Promise<RecordType | null> {
  let latest: RecordType | null = null
  try {
    await options.store.readLinesReverse((line) => {
      const record = options.parse(line.trim())
      if (record?.threadId !== options.threadId) return
      latest = record
      return false
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return latest
}

export async function readJsonlThreadRecordsSince<RecordType extends SequencedThreadRecord>(options: {
  store: AppDataJsonlStore
  threadId: string
  sinceSeq?: number
  includeAll?: boolean
  parse: (line: string) => RecordType | null
}): Promise<RecordType[]> {
  const sinceSeq = options.includeAll ? 0 : Math.max(0, Math.floor(options.sinceSeq ?? 0))
  const records: RecordType[] = []
  try {
    if (sinceSeq > 0) {
      await options.store.readLinesReverse((line) => {
        const record = options.parse(line.trim())
        if (!record || record.threadId !== options.threadId) return
        if (record.seq <= sinceSeq) return false
        records.push(record)
      })
    } else {
      await options.store.readLines((line) => {
        const record = options.parse(line.trim())
        if (record?.threadId === options.threadId) records.push(record)
      })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  records.sort((left, right) => left.seq - right.seq)
  return records
}

export async function readJsonlThreadPage<RecordType extends SequencedThreadRecord>(options: {
  store: AppDataJsonlStore
  threadId: string
  cursor?: string
  limit?: number
  parse: (line: string) => RecordType | null
  turnId: (record: RecordType) => string | undefined
  maxRecords?: number
  maxSourceBytes?: number
}): Promise<{ records: RecordType[]; nextCursor: string | null }> {
  const endOffset = decodeThreadPageCursor(options.cursor)
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)))
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? JSONL_THREAD_PAGE_MAX_RECORDS))
  const maxSourceBytes = Math.max(
    1,
    Math.floor(options.maxSourceBytes ?? JSONL_THREAD_PAGE_MAX_SOURCE_BYTES)
  )
  const records: RecordType[] = []
  const selectedKeys = new Set<string>()
  let selectedSourceBytes = 0
  let oldestSelectedOffset: number | null = null
  let hasOlderRecords = false

  try {
    await options.store.readLinesReverse((line, startOffset) => {
      const sourceBytes = Buffer.byteLength(line, 'utf8') + 1
      if (records.length > 0 && (
        records.length >= maxRecords || selectedSourceBytes + sourceBytes > maxSourceBytes
      )) {
        hasOlderRecords = true
        return false
      }
      const record = options.parse(line)
      if (!record || record.threadId !== options.threadId) return
      const turnId = options.turnId(record)?.trim()
      const key = turnId ? `turn:${turnId}` : `event:${record.seq}`
      if (!selectedKeys.has(key)) {
        if (selectedKeys.size >= limit) {
          hasOlderRecords = true
          return false
        }
        selectedKeys.add(key)
      }
      // A turn can contain thousands of streaming events. Preserve turn-aware
      // ordering, but never materialize an unbounded turn into one IPC page.
      // The first matching record is always admitted so a single oversized
      // legacy line cannot make the cursor stall forever.
      records.push(record)
      selectedSourceBytes += sourceBytes
      oldestSelectedOffset = startOffset
    }, endOffset === undefined ? {} : { endOffset })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  records.sort((left, right) => left.seq - right.seq)
  return {
    records,
    nextCursor: hasOlderRecords && oldestSelectedOffset !== null
      ? encodeThreadPageCursor(oldestSelectedOffset)
      : null
  }
}

export function assertAgentRuntimeThreadPageDeliverySize(
  page: AgentRuntimeThreadPage,
  maxBytes = AGENT_RUNTIME_THREAD_PAGE_MAX_DELIVERY_BYTES
): AgentRuntimeThreadPage {
  const size = serializedByteLength(page)
  if (size > maxBytes) {
    throw Object.assign(new Error(
      `Agent runtime thread page exceeds the ${maxBytes}-byte delivery boundary.`
    ), {
      code: 'agent_runtime_thread_page_too_large',
      size,
      maxBytes
    })
  }
  return page
}

export function encodeToolArtifactRef(itemId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, itemId }), 'utf8').toString('base64url')
}

export function decodeToolArtifactRef(ref: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(ref, 'base64url').toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    const record = parsed as Record<string, unknown>
    if (record.v !== 1 || typeof record.itemId !== 'string' || !record.itemId.trim()) throw new Error()
    return record.itemId.trim()
  } catch {
    throw Object.assign(new Error('Invalid tool artifact reference.'), {
      code: 'invalid_tool_artifact_ref'
    })
  }
}

export function externalizeToolDetails(options: {
  runtimeId: AgentRuntimeId
  threadId: string
  items: AgentRuntimeItem[]
  maxInlineBytes?: number
  previewBytes?: number
}): AgentRuntimeItem[] {
  const maxInlineBytes = Math.max(1, options.maxInlineBytes ?? 16_384)
  const previewBytes = Math.max(0, Math.min(maxInlineBytes, options.previewBytes ?? 4_096))
  return options.items.map((item) => {
    if (item.kind !== 'tool') return item
    const detail = typeof item.detail === 'string' ? item.detail : ''
    const artifactContent = toolArtifactContent(item.detail, item.meta)
    const oversizedDetail = Buffer.byteLength(detail, 'utf8') > maxInlineBytes
    const oversizedMetadata = serializedByteLength(item.meta) > maxInlineBytes
    const oversizedCompletionReceipts = serializedByteLength(item.completionReceipts) > maxInlineBytes
    if (!oversizedDetail && !oversizedMetadata && !oversizedCompletionReceipts) return item
    return {
      ...item,
      ...(typeof item.detail === 'string' ? { detail: truncateUtf8(item.detail, previewBytes) } : {}),
      ...(item.meta ? { meta: compactInlineMetadata(item.meta, previewBytes) } : {}),
      ...(oversizedCompletionReceipts && item.completionReceipts
        ? { completionReceipts: compactCompletionReceipts(item.completionReceipts, previewBytes) }
        : {}),
      ...(artifactContent !== null
        ? {
            detailArtifact: {
              runtimeId: options.runtimeId,
              threadId: options.threadId,
              ref: encodeToolArtifactRef(item.id),
              size: Buffer.byteLength(artifactContent, 'utf8')
            }
          }
        : {})
    }
  })
}

export function boundedToolExecutionReceipt(
  receipt: AgentRuntimeExecutionReceipt,
  options: { maxInlineBytes?: number; previewBytes?: number } = {}
): AgentRuntimeExecutionReceipt {
  const maxInlineBytes = Math.max(1, options.maxInlineBytes ?? 16_384)
  const previewBytes = Math.max(0, Math.min(maxInlineBytes, options.previewBytes ?? 4_096))
  return {
    ...receipt,
    ...(typeof receipt.detail === 'string' && Buffer.byteLength(receipt.detail, 'utf8') > maxInlineBytes
      ? { detail: truncateUtf8(receipt.detail, previewBytes) }
      : {}),
    ...(serializedByteLength(receipt.output) > maxInlineBytes ? { output: undefined } : {})
  }
}

export function externalizeToolEventDetails(
  event: AgentRuntimeEvent,
  options: { maxInlineBytes?: number; previewBytes?: number } = {}
): AgentRuntimeEvent {
  if (event.kind !== 'tool_event') return event
  const maxInlineBytes = Math.max(1, options.maxInlineBytes ?? 16_384)
  const previewBytes = Math.max(0, Math.min(maxInlineBytes, options.previewBytes ?? 4_096))
  const detail = typeof event.detail === 'string' ? event.detail : ''
  const artifactContent = toolArtifactContent(
    event.detail,
    event.meta,
    'receipt' in event ? event.receipt?.output : undefined
  )
  const oversizedDetail = Buffer.byteLength(detail, 'utf8') > maxInlineBytes
  const oversizedMetadata = serializedByteLength(event.meta) > maxInlineBytes
  const oversizedCompletionReceipts = serializedByteLength(event.completionReceipts) > maxInlineBytes
  const boundedReceipt = 'receipt' in event && event.receipt
    ? boundedToolExecutionReceipt(event.receipt, { maxInlineBytes, previewBytes })
    : undefined
  if (!oversizedDetail && !oversizedMetadata && !oversizedCompletionReceipts && boundedReceipt === event.receipt) {
    return event
  }
  return {
    ...event,
    ...(oversizedDetail ? { detail: truncateUtf8(detail, previewBytes) } : {}),
    ...(oversizedMetadata && event.meta
      ? { meta: compactInlineMetadata(event.meta, previewBytes) }
      : {}),
    ...(oversizedCompletionReceipts && event.completionReceipts
      ? { completionReceipts: compactCompletionReceipts(event.completionReceipts, previewBytes) }
      : {}),
    ...(boundedReceipt ? { receipt: boundedReceipt } : {}),
    ...(artifactContent !== null && (
      oversizedDetail || oversizedMetadata || serializedByteLength('receipt' in event ? event.receipt?.output : undefined) > maxInlineBytes
    )
      ? {
          detailArtifact: {
            runtimeId: event.runtimeId,
            threadId: event.threadId,
            ref: encodeToolArtifactRef(event.itemId),
            size: Buffer.byteLength(artifactContent, 'utf8')
          }
        }
      : {})
  } as AgentRuntimeEvent
}

/**
 * Canonical renderer/event-stream serialization boundary.
 *
 * Durable stores keep the original event so tool details remain available via
 * readToolArtifact. This projection is only for event delivery. Streaming model
 * deltas are intentionally left untouched because splitting/reassembling them is
 * part of their contract; the boundary targets duplicated output and opaque data.
 */
export function boundAgentRuntimeEventForDelivery(
  event: AgentRuntimeEvent,
  options: { maxInlineBytes?: number; previewBytes?: number; runtimeId?: AgentRuntimeId } = {}
): AgentRuntimeEvent {
  if (event.kind === 'assistant_delta' || event.kind === 'reasoning_delta') return event
  const maxInlineBytes = Math.max(1, options.maxInlineBytes ?? 16_384)
  const previewBytes = Math.max(0, Math.min(maxInlineBytes, options.previewBytes ?? 4_096))
  const textBytes = Math.min(2_048, previewBytes)
  const unknownBytes = Math.min(4_096, previewBytes)
  const runtimeId = event.runtimeId ?? options.runtimeId
  let bounded: AgentRuntimeEvent

  switch (event.kind) {
    case 'tool_event':
      bounded = externalizeToolEventDetails(event, { maxInlineBytes, previewBytes })
      break
    case 'item_snapshot': {
      const [item] = event.item.kind === 'tool' && runtimeId
        ? externalizeToolDetails({
            runtimeId,
            threadId: event.threadId,
            items: [event.item],
            maxInlineBytes,
            previewBytes
          })
        : [event.item]
      bounded = {
        ...event,
        item: boundRuntimeItem(item ?? event.item, textBytes, unknownBytes)
      }
      break
    }
    case 'runtime_status':
      bounded = {
        ...event,
        ...(event.message ? { message: truncateUtf8(event.message, textBytes) } : {}),
        ...(event.metadata ? { metadata: boundedInlineMetadata(event.metadata, unknownBytes) } : {})
      }
      break
    case 'review_event':
      bounded = {
        ...event,
        title: truncateUtf8(event.title, textBytes),
        ...(event.reviewText ? { reviewText: truncateUtf8(event.reviewText, previewBytes) } : {}),
        ...(event.output !== undefined ? { output: compactUnknown(event.output, unknownBytes) } : {})
      }
      break
    case 'error':
      bounded = {
        ...event,
        message: truncateUtf8(event.message, textBytes),
        ...(event.detail ? { detail: truncateUtf8(event.detail, previewBytes) } : {})
      }
      break
    case 'compaction_event':
      bounded = {
        ...event,
        summary: truncateUtf8(event.summary, textBytes),
        ...(event.detail ? { detail: truncateUtf8(event.detail, previewBytes) } : {}),
        ...(event.sourceItemIds
          ? { sourceItemIds: event.sourceItemIds.slice(0, 32).map((id) => truncateUtf8(id, 256)) }
          : {})
      }
      break
    case 'approval_requested':
      bounded = {
        ...event,
        summary: truncateUtf8(event.summary, textBytes),
        ...(event.meta ? { meta: boundedInlineMetadata(event.meta, unknownBytes) } : {})
      }
      break
    case 'thread_lifecycle':
      bounded = event.thread ? { ...event, thread: boundRuntimeThread(event.thread, textBytes) } : event
      break
    case 'child_event':
      bounded = {
        ...event,
        child: {
          ...event.child,
          ...(event.child.prompt ? { prompt: truncateUtf8(event.child.prompt, textBytes) } : {}),
          ...(event.child.summary ? { summary: truncateUtf8(event.child.summary, textBytes) } : {}),
          ...(event.child.metadata
            ? { metadata: boundedInlineMetadata(event.child.metadata, unknownBytes) }
            : {}),
          ...(event.child.transcriptRef?.metadata
            ? {
                transcriptRef: {
                  ...event.child.transcriptRef,
                  metadata: boundedInlineMetadata(event.child.transcriptRef.metadata, unknownBytes)
                }
              }
            : {}),
          ...(event.child.openAsThreadRef?.metadata
            ? {
                openAsThreadRef: {
                  ...event.child.openAsThreadRef,
                  metadata: boundedInlineMetadata(event.child.openAsThreadRef.metadata, unknownBytes)
                }
              }
            : {})
        },
        ...(event.message ? { message: truncateUtf8(event.message, textBytes) } : {})
      }
      break
    case 'todo_event':
      bounded = {
        ...event,
        items: event.items.slice(0, 16).map((item) => ({
          ...item,
          id: truncateUtf8(item.id, 256),
          content: truncateUtf8(item.content, 512),
          ...(item.source
            ? {
                source: {
                  ...item.source,
                  planId: truncateUtf8(item.source.planId, 256),
                  relativePath: truncateUtf8(item.source.relativePath, 512),
                  contentHash: truncateUtf8(item.source.contentHash, 256)
                }
              }
            : {})
        }))
      }
      break
    case 'user_input_requested':
      bounded = {
        ...event,
        questions: event.questions.slice(0, 3).map((question) => ({
          ...question,
          header: truncateUtf8(question.header, 256),
          question: truncateUtf8(question.question, 1_024),
          options: question.options.slice(0, 8).map((option) => ({
            label: truncateUtf8(option.label, 256),
            ...(option.description ? { description: truncateUtf8(option.description, 512) } : {})
          }))
        }))
      }
      break
    case 'user_input_resolved':
      bounded = {
        ...event,
        ...(event.answers
          ? {
              answers: event.answers.slice(0, 16).map((answer) => ({
                id: truncateUtf8(answer.id, 256),
                ...(answer.label ? { label: truncateUtf8(answer.label, 256) } : {}),
                value: truncateUtf8(answer.value, 1_024)
              }))
            }
          : {}),
        ...(event.message ? { message: truncateUtf8(event.message, textBytes) } : {})
      }
      break
    case 'goal_event':
      bounded = {
        ...event,
        ...(event.objective ? { objective: truncateUtf8(event.objective, previewBytes) } : {}),
        ...(event.lastFailureReason
          ? { lastFailureReason: truncateUtf8(event.lastFailureReason, textBytes) }
          : {})
      }
      break
    case 'user_message':
      bounded = {
        ...event,
        ...(event.displayText ? { displayText: truncateUtf8(event.displayText, previewBytes) } : {})
      }
      break
    case 'turn_lifecycle':
    case 'approval_resolved':
    case 'handoff_event':
      bounded = {
        ...event,
        ...('message' in event && event.message
          ? { message: truncateUtf8(event.message, textBytes) }
          : {})
      } as AgentRuntimeEvent
      break
    default:
      bounded = event
  }

  return serializedByteLength(bounded) <= maxInlineBytes
    ? bounded
    : aggressivelyBoundEvent(bounded, Math.min(1_024, previewBytes))
}

function boundRuntimeItem(item: AgentRuntimeItem, textBytes: number, unknownBytes: number): AgentRuntimeItem {
  if (item.kind === 'assistant_message' || item.kind === 'reasoning' || item.kind === 'user_message') {
    return item
  }
  return {
    ...item,
    ...(item.text ? { text: truncateUtf8(item.text, textBytes) } : {}),
    ...(item.summary ? { summary: truncateUtf8(item.summary, textBytes) } : {}),
    ...(item.detail ? { detail: truncateUtf8(item.detail, Math.max(textBytes, unknownBytes)) } : {}),
    ...(item.meta ? { meta: boundedInlineMetadata(item.meta, unknownBytes) } : {}),
    ...(item.completionReceipts
      ? { completionReceipts: compactCompletionReceipts(item.completionReceipts, 256) }
      : {})
  }
}

function boundRuntimeThread(thread: import('../../../shared/agent-runtime-contract').AgentRuntimeThread, textBytes: number) {
  return {
    ...thread,
    title: truncateUtf8(thread.title, 512),
    ...(thread.preview ? { preview: truncateUtf8(thread.preview, textBytes) } : {}),
    ...(thread.goal ? { goal: { ...thread.goal, objective: truncateUtf8(thread.goal.objective, textBytes) } } : {}),
    ...(thread.todos
      ? {
          todos: {
            ...thread.todos,
            items: thread.todos.items.slice(0, 16).map((item) => ({
              ...item,
              content: truncateUtf8(item.content, 512)
            }))
          }
        }
      : {}),
    ...(thread.guiPlan?.sourceRequest
      ? { guiPlan: { ...thread.guiPlan, sourceRequest: truncateUtf8(thread.guiPlan.sourceRequest, textBytes) } }
      : {})
  }
}

function compactUnknown(value: unknown, maxBytes: number): unknown {
  if (serializedByteLength(value) <= maxBytes) return value
  if (typeof value === 'string') return truncateUtf8(value, maxBytes)
  let preview = ''
  try {
    preview = JSON.stringify(value)
  } catch {
    preview = String(value)
  }
  return { truncated: true, preview: truncateUtf8(preview, Math.max(0, maxBytes - 64)) }
}

function toolArtifactContent(detail: unknown, metadata?: Record<string, unknown>, receiptOutput?: unknown): string | null {
  if (typeof detail === 'string') return detail
  const candidate = receiptOutput ?? metadata?.structuredContent ?? metadata?.output ?? metadata?.result
  if (candidate === undefined) return null
  if (typeof candidate === 'string') return candidate
  try {
    return JSON.stringify(candidate)
  } catch {
    return String(candidate)
  }
}

function aggressivelyBoundEvent(event: AgentRuntimeEvent, previewBytes: number): AgentRuntimeEvent {
  if (event.kind === 'tool_event') {
    return externalizeToolEventDetails({
      ...event,
      ...(event.detail ? { detail: truncateUtf8(event.detail, previewBytes) } : {}),
      ...(event.meta ? { meta: compactInlineMetadata(event.meta, previewBytes) } : {}),
      ...(event.completionReceipts
        ? { completionReceipts: compactCompletionReceipts(event.completionReceipts, 128) }
        : {}),
      ...('receipt' in event && event.receipt
        ? { receipt: boundedToolExecutionReceipt(event.receipt, { maxInlineBytes: previewBytes, previewBytes }) }
        : {})
    } as AgentRuntimeEvent, { maxInlineBytes: previewBytes, previewBytes })
  }
  if (event.kind === 'item_snapshot') {
    return { ...event, item: boundRuntimeItem(event.item, previewBytes, previewBytes) }
  }
  return event
}

function compactInlineMetadata(
  metadata: Record<string, unknown>,
  maxValueBytes: number
): Record<string, unknown> {
  const compact: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      compact[key] = value
      continue
    }
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maxValueBytes) {
      compact[key] = value
    }
  }
  return compact
}

function boundedInlineMetadata(
  metadata: Record<string, unknown>,
  maxBytes: number
): Record<string, unknown> {
  return serializedByteLength(metadata) <= maxBytes
    ? metadata
    : compactInlineMetadata(metadata, maxBytes)
}

function compactCompletionReceipts(
  receipts: readonly AgentRuntimeCompletionReceipt[],
  maxValueBytes: number
): AgentRuntimeCompletionReceipt[] {
  const scalarLimit = Math.min(512, Math.max(32, maxValueBytes))
  return receipts.slice(0, 16).map((receipt) => ({
    ...receipt,
    receiptId: truncateUtf8(receipt.receiptId, scalarLimit),
    issuer: truncateUtf8(receipt.issuer, scalarLimit),
    callId: truncateUtf8(receipt.callId, scalarLimit),
    subjectRef: truncateUtf8(receipt.subjectRef, scalarLimit),
    ...(receipt.relatedRefs
      ? { relatedRefs: receipt.relatedRefs.slice(0, 8).map((ref) => truncateUtf8(ref, scalarLimit)) }
      : {}),
    ...(receipt.parentReceiptIds
      ? { parentReceiptIds: receipt.parentReceiptIds.slice(0, 8).map((id) => truncateUtf8(id, scalarLimit)) }
      : {}),
    ...(receipt.attestation ? { attestation: truncateUtf8(receipt.attestation, scalarLimit) } : {})
  }))
}

function truncateUtf8(value: string, maxBytes: number): string {
  return truncateWellFormedUtf8(value, maxBytes)
}

function serializedByteLength(value: unknown): number {
  if (value === undefined) return 0
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function encodeThreadPageCursor(endOffset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, endOffset }), 'utf8').toString('base64url')
}

function decodeThreadPageCursor(cursor: string | undefined): number | undefined {
  if (!cursor?.trim()) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    const record = parsed as Record<string, unknown>
    if (record.v !== 1 || !Number.isSafeInteger(record.endOffset) || Number(record.endOffset) < 0) {
      throw new Error()
    }
    return Number(record.endOffset)
  } catch {
    throw Object.assign(new Error('Invalid thread history cursor.'), {
      code: 'invalid_thread_history_cursor'
    })
  }
}
