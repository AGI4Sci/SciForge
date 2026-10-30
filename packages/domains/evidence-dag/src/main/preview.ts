import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  evidenceDagPreviewOutputSchema,
  evidenceSourceSelectorSchema,
  type EvidenceDagPreviewInput,
  type EvidenceDagPreviewOutput
} from '../contract.js'

export async function resolveEvidenceDagPreview(input: Readonly<{
  request: EvidenceDagPreviewInput
  engineThreadId: string
  workspaceRoot: string
  snapshotEvidence: unknown
}>): Promise<EvidenceDagPreviewOutput> {
  const evidence = record(input.snapshotEvidence)
  if (!evidence || evidence.resolved !== true) {
    return fail(
      stringValue(evidence?.code) === 'snapshot_mismatch'
        ? 'snapshot_mismatch'
        : 'provenance_mismatch',
      stringValue(evidence?.message) ??
        'The evidence tuple is not present in the pinned committed Evidence Snapshot.'
    )
  }
  if (stringValue(evidence.threadId) !== input.engineThreadId ||
      stringValue(evidence.snapshotDigest) !== input.request.snapshotDigest ||
      !samePath(stringValue(evidence.workspaceRoot), input.workspaceRoot)) {
    return fail('snapshot_mismatch', 'The evidence response does not match the pinned workspace snapshot.')
  }

  const assertion = record(evidence.sourceAssertion)
  const artifact = record(evidence.artifact)
  const version = record(evidence.artifactVersion)
  const anchor = record(evidence.sourceAnchor)
  if (!assertion || !artifact || !version || !anchor ||
      stringValue(assertion.id) !== input.request.sourceAssertionId ||
      stringValue(assertion.type) !== 'source_assertion' ||
      stringValue(assertion.artifact_version_id) !== input.request.artifactVersionId ||
      stringValue(assertion.source_anchor_id) !== input.request.sourceAnchorId) {
    return fail('provenance_mismatch', 'The SourceAssertion provenance tuple is inconsistent.')
  }
  const artifactId = stringValue(assertion.artifact_id)
  if (!artifactId || stringValue(artifact.artifactId) !== artifactId ||
      stringValue(version.versionId) !== input.request.artifactVersionId ||
      stringValue(version.artifactId) !== artifactId ||
      stringValue(anchor.anchorId) !== input.request.sourceAnchorId ||
      stringValue(anchor.artifactId) !== artifactId ||
      stringValue(anchor.artifactVersionId) !== input.request.artifactVersionId) {
    return fail('provenance_mismatch', 'The committed ArtifactVersion and SourceAnchor links are inconsistent.')
  }
  if ([evidence.accessPolicy, artifact.accessPolicy, anchor.accessPolicy].some(accessRestricted)) {
    return fail('access_restricted', 'The evidence Artifact or SourceAnchor is restricted.')
  }
  const availability = (
    stringValue(version.availability) ?? stringValue(artifact.availability)
  )?.toLowerCase()
  if (availability === 'restricted') {
    return fail('access_restricted', 'The evidence Artifact is restricted.')
  }
  if (availability === 'remote') {
    return fail('unsupported_locator', 'Remote evidence cannot be opened as a workspace file.')
  }
  if (availability === 'missing') {
    return fail('file_unavailable', 'The evidence Artifact is unavailable.')
  }

  const locator = localLocator(version.locator)
  if (!locator) {
    return fail('unsupported_locator', 'Only local workspace evidence can be previewed.')
  }
  const selector = evidenceSourceSelectorSchema.safeParse(anchor.selector)
  if (!selector.success) {
    return fail('provenance_mismatch', 'The committed SourceAnchor selector is invalid.')
  }
  const contentDigest = sha256(version.contentDigest)
  if (!contentDigest) {
    return fail('provenance_mismatch', 'The committed ArtifactVersion has no SHA-256 digest.')
  }
  const path = await trustedWorkspaceFile(input.workspaceRoot, locator)
  if (!path) {
    return fail('file_unavailable', 'The evidence locator is not an available workspace file.')
  }

  return evidenceDagPreviewOutputSchema.parse({
    ok: true,
    path,
    workspaceRoot: input.workspaceRoot,
    runtimeId: input.request.runtimeId,
    threadId: input.request.threadId,
    snapshotDigest: input.request.snapshotDigest,
    sourceAssertionId: input.request.sourceAssertionId,
    artifactId,
    artifactVersionId: input.request.artifactVersionId,
    sourceAnchorId: input.request.sourceAnchorId,
    selector: selector.data,
    contentDigest,
    ...(sha256(anchor.anchorDigest) ? { anchorDigest: sha256(anchor.anchorDigest) } : {}),
    ...(stringValue(version.mediaType) ? { mediaType: stringValue(version.mediaType) } : {})
  })
}

async function trustedWorkspaceFile(workspaceRoot: string, locator: string): Promise<string | null> {
  try {
    const lexicalRoot = resolve(workspaceRoot)
    const lexicalTarget = isAbsolute(locator) ? resolve(locator) : resolve(lexicalRoot, locator)
    if (!contained(lexicalRoot, lexicalTarget)) return null
    let current = lexicalRoot
    const targetRelative = relative(lexicalRoot, lexicalTarget)
    for (const segment of targetRelative.split(/[\\/]+/u).filter(Boolean)) {
      current = join(current, segment)
      if ((await lstat(current)).isSymbolicLink()) return null
    }
    const [realRoot, realTarget] = await Promise.all([realpath(lexicalRoot), realpath(lexicalTarget)])
    if (!contained(realRoot, realTarget) || !(await stat(realTarget)).isFile()) return null
    return realTarget
  } catch {
    return null
  }
}

function contained(root: string, target: string): boolean {
  const result = relative(root, target)
  return result === '' || (!result.startsWith('..') && !isAbsolute(result))
}

function localLocator(value: unknown): string | null {
  const locator = stringValue(value)
  if (!locator || locator.startsWith('~') || locator.startsWith('\\\\') ||
      [...locator].some((character) => character.charCodeAt(0) <= 0x1f)) return null
  const windowsAbsolute = /^[A-Za-z]:[\\/]/u.test(locator)
  if (windowsAbsolute && process.platform !== 'win32') return null
  if (!windowsAbsolute && /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(locator)) return null
  return locator
}

function accessRestricted(value: unknown): boolean {
  if (typeof value === 'string') {
    const policy = value.trim().toLowerCase()
    return Boolean(policy) && !['public', 'open', 'unrestricted'].includes(policy)
  }
  const policy = record(value)
  if (!policy || Object.keys(policy).length === 0) return false
  const normalized = new Map(Object.entries(policy).map(([key, item]) => [
    key.replaceAll(/[_-]/gu, '').toLowerCase(),
    item
  ]))
  if (normalized.get('read') === false || normalized.get('public') === false ||
      normalized.get('authorized') === false || normalized.get('restricted') === true ||
      normalized.get('redacted') === true || normalized.get('denied') === true) return true
  const classifications = ['level', 'visibility', 'classification']
    .flatMap((key) => stringValue(normalized.get(key))?.toLowerCase() ?? [])
  return classifications.some((item) =>
    ['restricted', 'private', 'confidential', 'sensitive', 'secret', 'internal'].includes(item)
  )
}

function samePath(left: string | undefined, right: string): boolean {
  if (!left) return false
  const normalize = (value: string) => {
    const normalized = resolve(value).replaceAll('\\', '/').replace(/\/+$/u, '')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  return normalize(left) === normalize(right)
}

function sha256(value: unknown): string | undefined {
  const digest = stringValue(value)?.toLowerCase()
  return digest && /^sha256:[0-9a-f]{64}$/u.test(digest) ? digest : undefined
}

function fail(
  code: Extract<EvidenceDagPreviewOutput, { ok: false }>['code'],
  message: string
): EvidenceDagPreviewOutput {
  return { ok: false, code, message }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
