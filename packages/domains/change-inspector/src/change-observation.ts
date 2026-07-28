import {
  changeInspectorSnapshotSchema,
  type ChangeInspectorChange,
  type ChangeInspectorSnapshot
} from './contract.js'

const MAX_CHANGES = 5_000
const MAX_PATCH_BYTES = 2_000_000

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
