import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  projectDagResolveEvidencePreviewOutputSchema,
  projectDagSourceSelectorSchema,
  type ProjectDagErrorCode,
  type ProjectDagResolveEvidencePreviewInput,
  type ProjectDagResolveEvidencePreviewOutput
} from './contract.js'

export class ProjectDagPreviewError extends Error {
  constructor(
    readonly code: ProjectDagErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ProjectDagPreviewError'
  }
}

export async function resolveProjectDagEvidencePreview(
  input: ProjectDagResolveEvidencePreviewInput,
  claimValue: unknown
): Promise<ProjectDagResolveEvidencePreviewOutput> {
  const claim = record(claimValue)
  if (!claim || text(claim.id) !== input.claimId) {
    throw new ProjectDagPreviewError(
      'claim_mismatch',
      'The requested Claim is not present in the pinned Project Snapshot.'
    )
  }
  const provenance = record(claim.provenance)
  if (!provenance || text(provenance.projectSnapshotDigest) !== input.snapshotDigest) {
    throw new ProjectDagPreviewError(
      'snapshot_mismatch',
      'The requested provenance does not match the pinned Project Snapshot.'
    )
  }
  if (accessRestricted(provenance.access)) {
    throw new ProjectDagPreviewError(
      'access_restricted',
      'The evidence path is restricted and cannot be opened.'
    )
  }

  const assertion = sourceAssertions(provenance).find((candidate) =>
    text(candidate.artifactVersionId) === input.artifactVersionId &&
    text(candidate.sourceAnchorId) === input.sourceAnchorId
  )
  if (!assertion) {
    throw new ProjectDagPreviewError(
      'provenance_mismatch',
      'The ArtifactVersion and SourceAnchor are not linked to this Claim.'
    )
  }
  const artifact = record(assertion.artifact)
  const version = record(assertion.artifactVersion)
  const anchor = record(assertion.sourceAnchor)
  if (
    !artifact ||
    !version ||
    !anchor ||
    text(version.versionId) !== input.artifactVersionId ||
    text(anchor.anchorId) !== input.sourceAnchorId
  ) {
    throw new ProjectDagPreviewError(
      'provenance_mismatch',
      'The resolved provenance tuple is internally inconsistent.'
    )
  }
  if (accessRestricted(artifact.accessPolicy) || accessRestricted(anchor.accessPolicy)) {
    throw new ProjectDagPreviewError(
      'access_restricted',
      'The evidence Artifact or SourceAnchor is restricted.'
    )
  }

  const availability = (
    text(version.availability) ??
    text(artifact.availability) ??
    ''
  ).toLowerCase()
  if (availability === 'restricted') {
    throw new ProjectDagPreviewError(
      'access_restricted',
      'The evidence Artifact is restricted.'
    )
  }
  if (availability === 'remote') {
    throw new ProjectDagPreviewError(
      'unsupported_locator',
      'Remote evidence cannot be opened in the local file preview.'
    )
  }
  if (availability === 'missing') {
    throw new ProjectDagPreviewError(
      'file_unavailable',
      'The evidence Artifact is unavailable.'
    )
  }

  const locator = localLocator(version.locator)
  if (!locator) {
    throw new ProjectDagPreviewError(
      'unsupported_locator',
      'Only local workspace evidence can be opened in the file preview.'
    )
  }
  const selectorResult = projectDagSourceSelectorSchema.safeParse(anchor.selector)
  if (!selectorResult.success) {
    throw new ProjectDagPreviewError(
      'provenance_mismatch',
      'The SourceAnchor selector is missing or invalid.'
    )
  }
  const path = await resolveWorkspaceFile(input.workspaceRoot, locator)
  const output = {
    path,
    workspaceRoot: input.workspaceRoot,
    snapshotDigest: input.snapshotDigest,
    claimId: input.claimId,
    ...(text(assertion.artifactId) ? { artifactId: text(assertion.artifactId) } : {}),
    artifactVersionId: input.artifactVersionId,
    sourceAnchorId: input.sourceAnchorId,
    selector: selectorResult.data,
    ...(sha256(version.contentDigest) ? { contentDigest: sha256(version.contentDigest) } : {}),
    ...(sha256(anchor.anchorDigest) ? { anchorDigest: sha256(anchor.anchorDigest) } : {}),
    ...(text(version.mediaType) ? { mediaType: text(version.mediaType) } : {})
  }
  return projectDagResolveEvidencePreviewOutputSchema.parse(output)
}

function sourceAssertions(provenance: Record<string, unknown>): Record<string, unknown>[] {
  const paths = Array.isArray(provenance.paths) ? provenance.paths : []
  return paths.flatMap((path) => {
    const assertions = record(path)?.sourceAssertions
    if (!Array.isArray(assertions)) return []
    return assertions.flatMap((assertion) => {
      const parsed = record(assertion)
      return parsed ? [parsed] : []
    })
  })
}

function accessRestricted(value: unknown): boolean {
  if (typeof value === 'string') {
    const policy = value.trim().toLowerCase()
    return Boolean(policy) && !['public', 'open', 'unrestricted'].includes(policy)
  }
  const policy = record(value)
  if (!policy || Object.keys(policy).length === 0) return false
  const normalized = new Map(
    Object.entries(policy).map(([key, item]) => [
      key.replaceAll(/[_-]/gu, '').toLowerCase(),
      item
    ])
  )
  if (
    normalized.get('read') === false ||
    normalized.get('public') === false ||
    normalized.get('authorized') === false ||
    normalized.get('restricted') === true ||
    normalized.get('redacted') === true ||
    normalized.get('denied') === true
  ) {
    return true
  }
  const classifications = ['level', 'visibility', 'classification']
    .map((key) => text(normalized.get(key))?.toLowerCase())
    .filter((item): item is string => Boolean(item))
  if (classifications.some((item) =>
    ['restricted', 'private', 'confidential', 'sensitive', 'secret', 'internal']
      .includes(item)
  )) {
    return true
  }
  return normalized.get('read') !== true &&
    normalized.get('public') !== true &&
    !classifications.includes('public')
}

function localLocator(value: unknown): string | null {
  const locator = text(value)
  if (!locator || locator.startsWith('~') || locator.startsWith('\\\\')) return null
  if ([...locator].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })) {
    return null
  }
  const windowsAbsolute = /^[A-Za-z]:[\\/]/u.test(locator)
  if (windowsAbsolute && process.platform !== 'win32') return null
  if (!windowsAbsolute && /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(locator)) return null
  return locator
}

async function resolveWorkspaceFile(workspaceRoot: string, locator: string): Promise<string> {
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(workspaceRoot)
  } catch {
    throw new ProjectDagPreviewError(
      'file_unavailable',
      'The Project workspace is unavailable.'
    )
  }
  const lexicalTarget = isAbsolute(locator)
    ? resolve(locator)
    : resolve(canonicalRoot, locator)
  const lexicalRelative = relative(canonicalRoot, lexicalTarget)
  if (
    lexicalRelative.startsWith('..') ||
    isAbsolute(lexicalRelative) ||
    lexicalRelative === ''
  ) {
    throw new ProjectDagPreviewError(
      'access_restricted',
      'The evidence locator is outside the Project workspace.'
    )
  }
  try {
    if ((await lstat(lexicalTarget)).isSymbolicLink()) {
      throw new ProjectDagPreviewError(
        'access_restricted',
        'The evidence locator must not be a symbolic link.'
      )
    }
    const canonicalTarget = await realpath(lexicalTarget)
    const canonicalRelative = relative(canonicalRoot, canonicalTarget)
    if (canonicalRelative.startsWith('..') || isAbsolute(canonicalRelative)) {
      throw new ProjectDagPreviewError(
        'access_restricted',
        'The evidence locator resolves outside the Project workspace.'
      )
    }
    if (!(await stat(canonicalTarget)).isFile()) {
      throw new ProjectDagPreviewError(
        'file_unavailable',
        'The evidence locator does not resolve to a file.'
      )
    }
    return canonicalTarget
  } catch (error) {
    if (error instanceof ProjectDagPreviewError) throw error
    throw new ProjectDagPreviewError(
      'file_unavailable',
      'The evidence file is unavailable.'
    )
  }
}

function sha256(value: unknown): string | undefined {
  const digest = text(value)?.toLowerCase()
  return digest && /^sha256:[0-9a-f]{64}$/u.test(digest) ? digest : undefined
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
