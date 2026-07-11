import type {
  EvidenceDagEvidencePreviewResolveRequest,
  EvidenceDagEvidencePreviewResolveResult
} from '../../shared/sciforge-api'
import {
  evidenceRecord,
  evidenceString,
  resolveTrustedEvidencePreviewFile,
  trustedEvidencePreviewFailure
} from './trusted-evidence-preview'
import type { ResolveTrustedEvidenceWorkspaceFile } from './trusted-evidence-preview'

type ResolveDependencies = {
  engineThreadId: string
  workspaceRoot: string
  snapshotEvidence: unknown
  resolveWorkspaceFile: ResolveTrustedEvidenceWorkspaceFile
}

function workspaceKey(value: string): string {
  const normalized = value.trim().replace(/[\\/]+$/u, '').replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function fail(
  code: Exclude<EvidenceDagEvidencePreviewResolveResult, { ok: true }>['code'],
  message: string
): EvidenceDagEvidencePreviewResolveResult {
  return trustedEvidencePreviewFailure(code, message)
}

/** Resolve an opaque tuple only after the Evidence service re-fetched it from a verified snapshot. */
export async function resolveEvidenceDagEvidencePreview(
  input: EvidenceDagEvidencePreviewResolveRequest,
  dependencies: ResolveDependencies
): Promise<EvidenceDagEvidencePreviewResolveResult> {
  const evidence = evidenceRecord(dependencies.snapshotEvidence)
  if (!evidence || evidence.resolved !== true) {
    return fail(
      evidenceString(evidence?.code) === 'snapshot_mismatch'
        ? 'snapshot_mismatch'
        : 'provenance_mismatch',
      evidenceString(evidence?.message) ??
        'The evidence tuple is not present in the pinned committed Evidence Snapshot.'
    )
  }
  if (evidenceString(evidence.threadId) !== dependencies.engineThreadId ||
      evidenceString(evidence.snapshotDigest) !== input.snapshotDigest) {
    return fail('snapshot_mismatch', 'The evidence response does not match the pinned Evidence Snapshot.')
  }
  const committedWorkspaceRoot = evidenceString(evidence.workspaceRoot)
  if (!committedWorkspaceRoot ||
      workspaceKey(committedWorkspaceRoot) !== workspaceKey(dependencies.workspaceRoot)) {
    return fail('snapshot_mismatch', 'The pinned Evidence Snapshot belongs to a different workspace.')
  }

  const assertion = evidenceRecord(evidence.sourceAssertion)
  const artifact = evidenceRecord(evidence.artifact)
  const version = evidenceRecord(evidence.artifactVersion)
  const anchor = evidenceRecord(evidence.sourceAnchor)
  if (!assertion || !artifact || !version || !anchor ||
      evidenceString(assertion.id) !== input.sourceAssertionId ||
      evidenceString(assertion.type) !== 'source_assertion' ||
      evidenceString(assertion.artifact_version_id) !== input.artifactVersionId ||
      evidenceString(assertion.source_anchor_id) !== input.sourceAnchorId) {
    return fail('provenance_mismatch', 'The SourceAssertion provenance tuple is inconsistent.')
  }

  const artifactId = evidenceString(assertion.artifact_id)
  if (!artifactId || evidenceString(artifact.artifactId) !== artifactId ||
      evidenceString(version.versionId) !== input.artifactVersionId ||
      evidenceString(version.artifactId) !== artifactId ||
      evidenceString(anchor.anchorId) !== input.sourceAnchorId ||
      evidenceString(anchor.artifactId) !== artifactId ||
      evidenceString(anchor.artifactVersionId) !== input.artifactVersionId) {
    return fail('provenance_mismatch', 'The committed ArtifactVersion and SourceAnchor links are inconsistent.')
  }

  const resolved = await resolveTrustedEvidencePreviewFile({
    workspaceRoot: dependencies.workspaceRoot,
    artifact,
    version,
    anchor,
    accessPolicies: [evidence.accessPolicy],
    requireContentDigest: true,
    resolveWorkspaceFile: dependencies.resolveWorkspaceFile
  })
  if (!resolved.ok) return resolved
  if (!resolved.contentDigest) {
    return fail('provenance_mismatch', 'The ArtifactVersion content digest is unavailable.')
  }

  return {
    ok: true,
    path: resolved.path,
    workspaceRoot: dependencies.workspaceRoot,
    runtimeId: input.runtimeId,
    threadId: input.threadId,
    snapshotDigest: input.snapshotDigest,
    sourceAssertionId: input.sourceAssertionId,
    artifactId,
    artifactVersionId: input.artifactVersionId,
    sourceAnchorId: input.sourceAnchorId,
    selector: resolved.selector,
    contentDigest: resolved.contentDigest,
    ...(resolved.anchorDigest ? { anchorDigest: resolved.anchorDigest } : {}),
    ...(resolved.mediaType ? { mediaType: resolved.mediaType } : {})
  }
}
