import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { DomainTurnFilePatchReceiptV1 } from '@sciforge/domain-sdk/host'
import type { AgentRuntimeEvent } from '../../shared/agent-runtime-contract'
import { isSensitiveWorkspacePath } from './turn-file-effect-capture'

const MAX_FILE_CHANGE_DETAIL_BYTES = 4 * 1024 * 1024
const MAX_FILE_PATCH_TEXT_BYTES = 4 * 1024 * 1024
const MAX_FILE_PATCH_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_FILE_CHANGE_ITEMS = 256
const MAX_FILE_CHANGE_PATH_LENGTH = 8_192

/**
 * Copies exact executor-emitted patch text into the Host trust boundary.
 * Terminal, editor and script writes intentionally never satisfy this gate.
 */
export function captureTurnFilePatchReceipts(input: Readonly<{
  runtimeId: string
  workspaceRoot: string
  event: AgentRuntimeEvent
}>): readonly DomainTurnFilePatchReceiptV1[] {
  if (input.runtimeId !== 'codex' || input.event.kind !== 'tool_event') return Object.freeze([])
  const event = input.event
  if (
    event.status !== 'success' ||
    event.toolKind !== 'file_change' ||
    event.toolName !== 'apply_patch' ||
    event.phase !== 'succeeded' ||
    event.factSource !== 'executor_result' ||
    event.evidenceStrength !== 'executor_receipt' ||
    event.receipt?.status !== 'success' ||
    !Number.isSafeInteger(event.seq) || Number(event.seq) <= 0
  ) return Object.freeze([])
  const callId = event.callId?.trim() || event.itemId.trim()
  if (
    !callId ||
    callId.length > 512 ||
    callId.includes('\0') ||
    (event.callId?.trim() && event.callId.trim() !== event.itemId.trim())
  ) return Object.freeze([])
  return captureDeclaredPatches(input.workspaceRoot, callId, Number(event.seq), event.detail)
}

function captureDeclaredPatches(
  workspaceRoot: string,
  callId: string,
  executorSequence: number,
  detail: unknown
): readonly DomainTurnFilePatchReceiptV1[] {
  if (typeof detail !== 'string' || Buffer.byteLength(detail, 'utf8') > MAX_FILE_CHANGE_DETAIL_BYTES) {
    return Object.freeze([])
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(detail)
  } catch {
    return Object.freeze([])
  }
  const root = record(parsed)
  const changes = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root?.changes)
      ? root.changes
      : root?.changes && record(root.changes)
        ? Object.entries(root.changes as Record<string, unknown>).map(([path, value]) => ({
            ...(record(value) ?? {}),
            path
          }))
        : null
  if (!changes || changes.length > MAX_FILE_CHANGE_ITEMS) return Object.freeze([])

  let totalBytes = 0
  const output: DomainTurnFilePatchReceiptV1[] = []
  const paths = new Set<string>()
  for (const candidate of changes) {
    const change = record(candidate)
    if (!change) return Object.freeze([])
    const rawPath = string(change.path) || string(change.filePath) || string(change.relativePath)
    const path = workspaceRelativePath(workspaceRoot, rawPath)
    if (!path || isSensitiveWorkspacePath(path) || paths.has(path)) return Object.freeze([])
    const operation = patchOperation(change.kind ?? change.type)
    const patchValue = typeof change.diff === 'string'
      ? change.diff
      : typeof change.unified_diff === 'string'
        ? change.unified_diff
        : operation === 'add' && typeof change.content === 'string'
          ? change.content
          : undefined
    const patchText = patchValue ?? ''
    const patchFormat = operation === 'add' ? 'full-content' : 'unified-hunks'
    const movePath = string(record(change.kind)?.move_path ?? change.move_path)
    if (
      !operation ||
      patchValue === undefined ||
      patchText.includes('\0') ||
      Buffer.from(patchText, 'utf8').toString('utf8') !== patchText ||
      (operation !== 'add' && patchText.length === 0)
    ) return Object.freeze([])
    if (operation === 'update' && movePath) return Object.freeze([])
    const bytes = Buffer.byteLength(patchText, 'utf8')
    if (bytes > MAX_FILE_PATCH_TEXT_BYTES || totalBytes + bytes > MAX_FILE_PATCH_TOTAL_BYTES) {
      return Object.freeze([])
    }
    totalBytes += bytes
    paths.add(path)
    output.push(Object.freeze({
      contractVersion: 1,
      kind: 'host-authenticated-file-patch',
      issuer: 'sciforge.agent-runtime-host',
      source: 'codex-app-server-file-change',
      callId,
      executorSequence,
      path,
      operation,
      patchFormat,
      patchText,
      patchDigest: createHash('sha256').update(patchText).digest('hex')
    }))
  }
  return Object.freeze(output.sort(compareReceipts))
}

function patchOperation(value: unknown): DomainTurnFilePatchReceiptV1['operation'] | null {
  const candidate = record(value)
  const normalized = string(candidate?.type ?? value).toLocaleLowerCase('en-US')
  if (normalized === 'add' || normalized === 'create' || normalized === 'created') return 'add'
  if (normalized === 'update' || normalized === 'modify' || normalized === 'modified') return 'update'
  if (normalized === 'delete' || normalized === 'deleted' || normalized === 'remove') return 'delete'
  return null
}

function workspaceRelativePath(workspaceRoot: string, value: string): string | null {
  if (!value || value.length > MAX_FILE_CHANGE_PATH_LENGTH || value.includes('\0')) return null
  const cleaned = value.trim().replace(/^file:\/\//iu, '')
  const absolute = isAbsolute(cleaned) ? resolve(cleaned) : resolve(workspaceRoot, cleaned)
  const relativePath = relative(resolve(workspaceRoot), absolute)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null
  }
  return relativePath.split(sep).join('/')
}

function compareReceipts(left: DomainTurnFilePatchReceiptV1, right: DomainTurnFilePatchReceiptV1): number {
  return left.executorSequence - right.executorSequence ||
    left.callId.localeCompare(right.callId) ||
    left.path.localeCompare(right.path) ||
    left.patchDigest.localeCompare(right.patchDigest)
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
