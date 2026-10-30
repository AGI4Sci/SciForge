import {
  CHANGE_INSPECTOR_DEFAULT_LIST_CHANGES,
  CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES,
  changeInspectorChangeSummarySchema,
  changeInspectorSnapshotSchema,
  type ChangeInspectorChange,
  type ChangeInspectorChangeSummary,
  type ChangeInspectorSnapshot
} from '../contract.js'

const MAX_CHANGES = 5_000
const MAX_PATCH_BYTES = 2_000_000
const SUMMARY_PATCH_TRUNCATION_MARKER = '\n… patch truncated by SciForge …'

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

export function projectSessionChangeSnapshot(
  sessionId: string,
  source: SessionArtifactSource
): ChangeInspectorSnapshot {
  const topLevelArtifacts = source.artifacts.length > 0
    ? source.artifacts
    : (source.turns ?? []).flatMap((turn) => turn.artifacts)
  const changes = topLevelArtifacts.flatMap((artifact, artifactIndex) =>
    projectArtifactChanges(artifact, artifactIndex)
  )
  const truncated = changes.length > MAX_CHANGES
  return changeInspectorSnapshotSchema.parse({
    sessionId,
    revision: normalizedRevision(source.watermark, changes),
    changes: truncated ? changes.slice(-MAX_CHANGES) : changes,
    truncated
  })
}

/**
 * Bounded change summaries for audit projections. Pagination walks the
 * canonical snapshot in storage order; the cursor is the opaque change id
 * that preceded the next page. An unknown cursor fails closed instead of
 * silently restarting the walk.
 */
export function projectSessionChangeSummaries(
  snapshot: ChangeInspectorSnapshot,
  input: Readonly<{ limit?: number; cursor?: string }>
): { changes: ChangeInspectorChangeSummary[]; nextCursor: string | null } {
  const limit = input.limit ?? CHANGE_INSPECTOR_DEFAULT_LIST_CHANGES
  const startIndex = input.cursor
    ? resolveCursor(snapshot.changes, input.cursor)
    : 0
  const page = snapshot.changes
    .slice(startIndex, startIndex + limit)
    .map(summarizeChange)
  const nextCursor = startIndex + page.length < snapshot.changes.length &&
    page.length > 0
    ? page[page.length - 1]!.id
    : null
  return { changes: page, nextCursor }
}

function resolveCursor(
  changes: readonly ChangeInspectorChange[],
  cursor: string
): number {
  const index = changes.findIndex((change) => change.id === cursor)
  if (index < 0) {
    throw new Error('Change Inspector list cursor does not match this session.')
  }
  return index + 1
}

function summarizeChange(
  change: ChangeInspectorChange
): ChangeInspectorChangeSummary {
  const patchBytes = byteLength(change.patch)
  if (patchBytes <= CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES) {
    return changeInspectorChangeSummarySchema.parse({
      id: change.id,
      status: change.status,
      ...(change.filePath ? { filePath: change.filePath } : {}),
      patch: change.patch,
      patchBytes,
      patchTruncated: false,
      ...(change.occurredAt ? { occurredAt: change.occurredAt } : {})
    })
  }
  const markerBytes = byteLength(SUMMARY_PATCH_TRUNCATION_MARKER)
  const head = Buffer.from(change.patch, 'utf8')
    .subarray(0, CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES - markerBytes)
    .toString('utf8')
  return changeInspectorChangeSummarySchema.parse({
    id: change.id,
    status: change.status,
    ...(change.filePath ? { filePath: change.filePath } : {}),
    patch: `${head}${SUMMARY_PATCH_TRUNCATION_MARKER}`,
    patchBytes,
    patchTruncated: true,
    ...(change.occurredAt ? { occurredAt: change.occurredAt } : {})
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
  const detail = rawDetail.trim()
  if (!detail) return []
  if (looksLikeUnifiedDiff(detail)) {
    return [{
      patch: truncatePatch(detail),
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
): ChangeInspectorChange[] {
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
    const patch = normalizedString(record[key])
    if (patch && looksLikeUnifiedDiff(patch)) {
      return [{
        patch: truncatePatch(patch),
        ...(filePath ? { filePath } : {})
      }]
    }
  }
  if (record.changes !== undefined) {
    return extractCandidatesFromJson(record.changes, filePath)
  }
  return []
}

function looksLikeUnifiedDiff(value: string): boolean {
  return value.split('\n').some((line) =>
    line.startsWith('diff --git ') ||
    line.startsWith('@@') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  )
}

function truncatePatch(value: string): string {
  return value.length <= MAX_PATCH_BYTES
    ? value
    : `${value.slice(0, MAX_PATCH_BYTES - 30)}\n… diff truncated by SciForge …`
}

function normalizedRevision(
  watermark: string,
  changes: readonly ChangeInspectorChange[]
): string {
  const candidate = watermark.trim()
  if (candidate && candidate.length <= 256) return candidate
  let hash = 0x811c9dc5
  const input = `${candidate}\u0000${changes.map((change) => change.id).join('\u0000')}`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `changes-${(hash >>> 0).toString(16)}`
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
