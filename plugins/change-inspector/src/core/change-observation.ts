import { createHash } from 'node:crypto'
import {
  CHANGE_INSPECTOR_DEFAULT_LIST_CHANGES,
  CHANGE_INSPECTOR_MAX_LIST_CHANGES,
  CHANGE_INSPECTOR_MAX_PATCH_BYTES,
  CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES,
  CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES,
  changeInspectorChangeSummarySchema,
  changeInspectorSnapshotSchema,
  type ChangeInspectorChange,
  type ChangeInspectorChangeSummary,
  type ChangeInspectorSnapshot
} from '../contract.js'

const MAX_CHANGES = 5_000
const PATCH_TRUNCATION_MARKER = '\n… patch truncated by SciForge …'

type SessionArtifactSource = Readonly<{
  id?: string
  watermark: string
  artifacts: readonly unknown[]
  turns?: readonly Readonly<{
    id: string
    artifacts: readonly unknown[]
  }>[]
}>

type PatchCandidate = Readonly<{
  patch: string
  filePath?: string
}>

type RawChange = Omit<ChangeInspectorChange, 'patchBytes' | 'patchTruncated'>

export function projectSessionChangeSnapshot(
  sessionId: string,
  source: SessionArtifactSource
): ChangeInspectorSnapshot {
  const artifacts = source.artifacts.length > 0
    ? source.artifacts
    : (source.turns ?? []).flatMap((turn) => turn.artifacts)
  // Session watermarks also advance for reads and other non-change events.
  // Hash only file changes, before truncation, so omitted tails and discarded
  // changes still invalidate revisions and pagination cursors.
  const hash = createHash('sha256').update(JSON.stringify([sessionId]))
  let fileChangeIndex = 0
  const changes: ChangeInspectorChange[] = []
  const truncationReasons: ChangeInspectorSnapshot['truncationReasons'] = []
  let changeCount = 0
  let changesBytes = 0
  // Reserve the revision and all explanatory metadata. Count serialized JSON
  // bytes, including string escaping, not just the unescaped patch payloads.
  const envelopeBytes = byteLength(JSON.stringify({
    sessionId,
    revision: `changes-${'0'.repeat(64)}`,
    changes: [],
    truncated: false,
    truncationReasons: ['patch-byte-limit', 'snapshot-byte-limit', 'change-count-limit']
  }))
  const addReason = (reason: ChangeInspectorSnapshot['truncationReasons'][number]) => {
    if (!truncationReasons.includes(reason)) truncationReasons.push(reason)
  }
  for (const artifact of artifacts) {
    const record = asRecord(artifact)
    if (!record || record.kind !== 'tool' || record.toolKind !== 'file_change') continue
    // Count file-change artifacts only: unrelated tools must not shift fallback IDs.
    const artifactIndex = fileChangeIndex++
    const rawChanges = projectArtifactChanges(artifact, artifactIndex)
    // Include identity and source detail even when no diff can be projected yet.
    // Every new file-change artifact must invalidate an outstanding cursor.
    hash.update(JSON.stringify([
      normalizedString(record.id) ?? `file-change-${artifactIndex}`,
      typeof record.detail === 'string' ? record.detail : null,
      normalizedString(record.filePath) ?? null,
      record.status === 'running' || record.status === 'error' ? record.status : 'success',
      validDateTime(record.createdAt) ?? null,
      rawChanges
    ])).update('\n')
    for (const rawChange of rawChanges) {
      changeCount += 1
      const patch = truncatePatch(rawChange.patch, CHANGE_INSPECTOR_MAX_PATCH_BYTES)
      if (patch.patchTruncated) addReason('patch-byte-limit')
      const change = { ...rawChange, ...patch }
      changes.push(change)
      changesBytes += byteLength(JSON.stringify(change)) + 1
      if (changeCount > MAX_CHANGES) addReason('change-count-limit')
      while (changes.length > MAX_CHANGES ||
        envelopeBytes + changesBytes > CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES) {
        if (envelopeBytes + changesBytes > CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES) {
          addReason('snapshot-byte-limit')
        }
        const removed = changes.shift()!
        changesBytes -= byteLength(JSON.stringify(removed)) + 1
      }
    }
  }
  return changeInspectorSnapshotSchema.parse({
    sessionId,
    revision: `changes-${hash.digest('hex')}`,
    changes,
    truncated: truncationReasons.length > 0,
    truncationReasons
  })
}

/** Pages the canonical snapshot using a session- and revision-bound cursor. */
export function projectSessionChangeSummaries(
  snapshot: ChangeInspectorSnapshot,
  input: Readonly<{ limit?: number; cursor?: string }>
): { changes: ChangeInspectorChangeSummary[]; nextCursor: string | null } {
  const limit = input.limit ?? CHANGE_INSPECTOR_DEFAULT_LIST_CHANGES
  if (!Number.isInteger(limit) || limit < 1 || limit > CHANGE_INSPECTOR_MAX_LIST_CHANGES) {
    throw new Error('Change Inspector list limit is outside the supported range.')
  }
  const cursorPrefix = `ci1:${createHash('sha256')
    .update(JSON.stringify([snapshot.sessionId, snapshot.revision])).digest('hex')}:`
  const startIndex = input.cursor
    ? resolveCursor(snapshot.changes, input.cursor, cursorPrefix)
    : 0
  const page = snapshot.changes
    .slice(startIndex, startIndex + limit)
    .map(summarizeChange)
  const nextIndex = startIndex + page.length
  return {
    changes: page,
    nextCursor: nextIndex < snapshot.changes.length
      ? `${cursorPrefix}${nextIndex}`
      : null
  }
}

function resolveCursor(
  changes: readonly ChangeInspectorChange[],
  cursor: string,
  prefix: string
): number {
  const suffix = cursor.startsWith(prefix) ? cursor.slice(prefix.length) : ''
  const index = /^[1-9][0-9]*$/u.test(suffix) ? Number(suffix) : NaN
  if (!Number.isSafeInteger(index) || index >= changes.length) {
    throw new Error('Change Inspector list cursor does not match this session or revision.')
  }
  return index
}

function summarizeChange(change: ChangeInspectorChange): ChangeInspectorChangeSummary {
  const patch = truncatePatch(change.patch, CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES)
  return changeInspectorChangeSummarySchema.parse({
    ...change,
    patch: patch.patch,
    // Preserve the original size through this second projection.
    patchBytes: change.patchBytes,
    patchTruncated: change.patchTruncated || patch.patchTruncated
  })
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function extractUnifiedDiffCandidates(
  rawDetail: unknown,
  fallbackFilePath?: string
): readonly PatchCandidate[] {
  if (typeof rawDetail !== 'string') return []
  // Whitespace is meaningful patch data. Only test emptiness; never normalize
  // the bytes used by output, original byte budgets, or revision hashing.
  const detail = rawDetail
  if (!detail.trim()) return []
  if (looksLikeUnifiedDiff(detail)) {
    return [{
      patch: detail,
      ...(normalizedString(fallbackFilePath) ? { filePath: normalizedString(fallbackFilePath) } : {})
    }]
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(detail)
  } catch {
    return []
  }
  return extractCandidatesFromJson(parsed, fallbackFilePath)
}

function projectArtifactChanges(
  artifact: unknown,
  artifactIndex: number
): RawChange[] {
  const record = asRecord(artifact)
  if (!record || record.kind !== 'tool' || record.toolKind !== 'file_change') return []
  const artifactId = normalizedString(record.id) ?? `file-change-${artifactIndex}`
  const status = record.status === 'running' || record.status === 'error'
    ? record.status
    : 'success'
  const occurredAt = validDateTime(record.createdAt)
  return extractUnifiedDiffCandidates(record.detail, normalizedString(record.filePath))
    .map((candidate, candidateIndex) => ({
      id: candidateIndex === 0 ? artifactId : `${artifactId}:${candidateIndex}`,
      status,
      ...(candidate.filePath ? { filePath: candidate.filePath } : {}),
      patch: candidate.patch,
      ...(occurredAt ? { occurredAt } : {})
    }))
}

function extractCandidatesFromJson(
  value: unknown,
  fallbackFilePath?: string
): PatchCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractCandidatesFromJson(item, fallbackFilePath))
  }
  const record = asRecord(value)
  if (!record) return []

  const filePath = normalizedString(record.path) ??
    normalizedString(record.filePath) ??
    normalizedString(record.file_path) ??
    normalizedString(fallbackFilePath)
  for (const key of ['diff', 'patch', 'unified_diff', 'unifiedDiff']) {
    const patch = record[key]
    if (typeof patch === 'string' && patch.trim() && looksLikeUnifiedDiff(patch)) {
      return [{ patch, ...(filePath ? { filePath } : {}) }]
    }
  }
  if (record.changes !== undefined) {
    return extractCandidatesFromJson(record.changes, filePath)
  }
  return []
}

function looksLikeUnifiedDiff(value: string): boolean {
  return /^(?:diff --git |@@|--- |\+\+\+ )/mu.test(value)
}

/** Include the marker in the budget; never decode an incomplete UTF-8 scalar. */
function truncatePatch(value: string, budget: number): {
  patch: string; patchBytes: number; patchTruncated: boolean
} {
  const patchBytes = byteLength(value)
  if (patchBytes <= budget) return { patch: value, patchBytes, patchTruncated: false }
  const bytes = Buffer.from(value, 'utf8')
  let end = budget - byteLength(PATCH_TRUNCATION_MARKER)
  // `end` is the first excluded byte. Continuation bytes mean the preceding
  // scalar straddles the boundary, so exclude that scalar in full.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1
  const head = bytes.subarray(0, end).toString('utf8')
  return { patch: `${head}${PATCH_TRUNCATION_MARKER}`, patchBytes, patchTruncated: true }
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function validDateTime(value: unknown): string | undefined {
  const candidate = normalizedString(value)
  if (!candidate || Number.isNaN(Date.parse(candidate))) return undefined
  return new Date(candidate).toISOString()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
