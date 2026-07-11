import { lstat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  EvidenceSourceSelector,
  EvidenceDagEvidencePreviewResolveResult
} from '../../shared/sciforge-api'
import type { WorkspaceFileResolveResult, WorkspaceFileTarget } from '../../shared/workspace-file'

export type ResolveTrustedEvidenceWorkspaceFile = (
  target: WorkspaceFileTarget
) => Promise<WorkspaceFileResolveResult>

export type TrustedEvidencePreviewFailureCode =
  Exclude<EvidenceDagEvidencePreviewResolveResult, { ok: true }>['code']

export type TrustedEvidencePreviewFailure = {
  ok: false
  code: TrustedEvidencePreviewFailureCode
  message: string
}

export type TrustedEvidencePreviewFile = {
  ok: true
  path: string
  selector: EvidenceSourceSelector
  contentDigest?: string
  anchorDigest?: string
  mediaType?: string
}

export function evidenceRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function evidenceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function trustedEvidencePreviewFailure(
  code: TrustedEvidencePreviewFailureCode,
  message: string
): TrustedEvidencePreviewFailure {
  return { ok: false, code, message }
}

/** Conservatively interpret Artifact/Anchor ACL metadata. Unknown non-empty policies deny access. */
export function evidenceAccessRestricted(value: unknown): boolean {
  if (typeof value === 'string') {
    const policy = value.trim().toLowerCase()
    return Boolean(policy) && !['public', 'open', 'unrestricted'].includes(policy)
  }
  const policy = evidenceRecord(value)
  if (!policy || Object.keys(policy).length === 0) return false
  const normalized = new Map(
    Object.entries(policy).map(([key, item]) => [key.replaceAll(/[_-]/g, '').toLowerCase(), item])
  )
  if (normalized.get('read') === false || normalized.get('public') === false ||
      normalized.get('authorized') === false || normalized.get('restricted') === true ||
      normalized.get('redacted') === true || normalized.get('denied') === true) return true
  const level = evidenceString(normalized.get('level'))?.toLowerCase()
  const visibility = evidenceString(normalized.get('visibility'))?.toLowerCase()
  const classification = evidenceString(normalized.get('classification'))?.toLowerCase()
  const policyValues = [level, visibility, classification].filter(
    (item): item is string => Boolean(item)
  )
  if (policyValues.some((item) =>
    ['restricted', 'private', 'confidential', 'sensitive', 'secret', 'internal'].includes(item)
  )) return true
  return normalized.get('read') !== true && normalized.get('public') !== true &&
    !policyValues.includes('public')
}

/** Accept local paths only. URL, DOI, runtime, trace, citation and UNC locators are never file paths. */
export function trustedLocalEvidenceLocator(value: unknown): string | null {
  const locator = evidenceString(value)
  const hasControlCharacter = locator
    ? [...locator].some((character) => {
        const code = character.charCodeAt(0)
        return code <= 0x1f || code === 0x7f
      })
    : false
  if (!locator || hasControlCharacter || locator.startsWith('~') ||
      locator.startsWith('\\\\')) return null
  const windowsAbsolute = /^[A-Za-z]:[\\/]/u.test(locator)
  if (windowsAbsolute && process.platform !== 'win32') return null
  if (!windowsAbsolute && /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(locator)) return null
  return locator
}

export function trustedEvidenceSha256(value: unknown): string | undefined {
  const digest = evidenceString(value)?.toLowerCase()
  return digest && /^sha256:[0-9a-f]{64}$/u.test(digest) ? digest : undefined
}

export function trustedEvidenceSourceSelector(value: unknown): EvidenceSourceSelector | null {
  const selector = evidenceRecord(value)
  if (!selector) return null
  const allowed = new Set([
    'type', 'page', 'section', 'table', 'figure', 'rowRange', 'columnNames',
    'lineRange', 'quote', 'query'
  ])
  if (Object.keys(selector).some((key) => !allowed.has(key))) return null
  const type = evidenceString(selector.type)
  if (!type || !['pdf', 'text', 'table', 'figure', 'code', 'dataset', 'web'].includes(type)) {
    return null
  }
  if (selector.page !== undefined &&
      (!Number.isInteger(selector.page) || Number(selector.page) < 1)) return null
  for (const field of ['section', 'table', 'figure', 'quote'] as const) {
    if (selector[field] !== undefined && typeof selector[field] !== 'string') return null
  }
  for (const field of ['rowRange', 'lineRange'] as const) {
    if (selector[field] !== undefined &&
        (typeof selector[field] !== 'string' || !/^\d+:\d+$/u.test(selector[field]))) return null
  }
  if (selector.columnNames !== undefined &&
      (!Array.isArray(selector.columnNames) ||
        !selector.columnNames.every((column) => typeof column === 'string' && column.trim()))) {
    return null
  }
  if (selector.query !== undefined && !evidenceRecord(selector.query)) return null
  return {
    type: type as EvidenceSourceSelector['type'],
    ...(selector.page !== undefined ? { page: Number(selector.page) } : {}),
    ...(typeof selector.section === 'string' ? { section: selector.section } : {}),
    ...(typeof selector.table === 'string' ? { table: selector.table } : {}),
    ...(typeof selector.figure === 'string' ? { figure: selector.figure } : {}),
    ...(typeof selector.rowRange === 'string' ? { rowRange: selector.rowRange } : {}),
    ...(Array.isArray(selector.columnNames) ? { columnNames: [...selector.columnNames] as string[] } : {}),
    ...(typeof selector.lineRange === 'string' ? { lineRange: selector.lineRange } : {}),
    ...(typeof selector.quote === 'string' ? { quote: selector.quote } : {}),
    ...(evidenceRecord(selector.query) ? { query: { ...selector.query as Record<string, unknown> } } : {})
  }
}

async function locatorCrossesWorkspaceSymlink(locator: string, workspaceRoot: string): Promise<boolean> {
  const lexicalRoot = resolve(workspaceRoot)
  const lexicalTarget = isAbsolute(locator) ? resolve(locator) : resolve(lexicalRoot, locator)
  const targetRelative = relative(lexicalRoot, lexicalTarget)
  if (!targetRelative || targetRelative.startsWith('..') || isAbsolute(targetRelative)) return false
  let current = lexicalRoot
  for (const segment of targetRelative.split(/[\\/]+/u).filter(Boolean)) {
    current = join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) return true
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ''
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      return true
    }
  }
  return false
}

/** Resolve a tuple already re-fetched from committed provenance into one workspace-local file. */
export async function resolveTrustedEvidencePreviewFile(input: {
  workspaceRoot: string
  artifact: Record<string, unknown>
  version: Record<string, unknown>
  anchor: Record<string, unknown>
  accessPolicies?: unknown[]
  requireContentDigest?: boolean
  resolveWorkspaceFile: ResolveTrustedEvidenceWorkspaceFile
}): Promise<TrustedEvidencePreviewFile | TrustedEvidencePreviewFailure> {
  if ([input.artifact.accessPolicy, input.anchor.accessPolicy, ...(input.accessPolicies ?? [])]
    .some(evidenceAccessRestricted)) {
    return trustedEvidencePreviewFailure(
      'access_restricted',
      'The evidence Artifact or SourceAnchor is restricted.'
    )
  }

  const availability = evidenceString(input.version.availability)?.toLowerCase() ??
    evidenceString(input.artifact.availability)?.toLowerCase()
  if (availability === 'restricted') {
    return trustedEvidencePreviewFailure('access_restricted', 'The evidence Artifact is restricted.')
  }
  if (availability === 'remote') {
    return trustedEvidencePreviewFailure(
      'unsupported_locator',
      'Remote evidence cannot be opened in the local file preview.'
    )
  }
  if (availability === 'missing') {
    return trustedEvidencePreviewFailure('file_unavailable', 'The evidence Artifact is unavailable.')
  }

  const locator = trustedLocalEvidenceLocator(input.version.locator)
  if (!locator) {
    return trustedEvidencePreviewFailure(
      'unsupported_locator',
      'Only local workspace evidence can be opened in the file preview.'
    )
  }
  const selector = trustedEvidenceSourceSelector(input.anchor.selector)
  if (!selector) {
    return trustedEvidencePreviewFailure(
      'provenance_mismatch',
      'The SourceAnchor selector is missing or invalid.'
    )
  }
  const contentDigest = trustedEvidenceSha256(input.version.contentDigest)
  if (input.requireContentDigest && !contentDigest) {
    return trustedEvidencePreviewFailure(
      'provenance_mismatch',
      'The committed ArtifactVersion has no verifiable SHA-256 content digest.'
    )
  }
  if (await locatorCrossesWorkspaceSymlink(locator, input.workspaceRoot)) {
    return trustedEvidencePreviewFailure(
      'file_unavailable',
      'The evidence locator must not cross a workspace symbolic link.'
    )
  }

  const resolved = await input.resolveWorkspaceFile({
    path: locator,
    workspaceRoot: input.workspaceRoot
  })
  if (!resolved.ok || resolved.kind !== 'file') {
    return trustedEvidencePreviewFailure('file_unavailable', resolved.ok
      ? 'The evidence locator resolves to a directory, not a file.'
      : resolved.message)
  }

  const anchorDigest = trustedEvidenceSha256(input.anchor.anchorDigest)
  const mediaType = evidenceString(input.version.mediaType)
  return {
    ok: true,
    path: resolved.path,
    selector,
    ...(contentDigest ? { contentDigest } : {}),
    ...(anchorDigest ? { anchorDigest } : {}),
    ...(mediaType ? { mediaType } : {})
  }
}
