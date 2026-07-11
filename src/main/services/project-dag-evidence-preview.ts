import type {
  ProjectDagEvidencePreviewResolveRequest,
  ProjectDagEvidencePreviewResolveResult
} from '../../shared/sciforge-api'
import type { WorkspaceFileResolveResult, WorkspaceFileTarget } from '../../shared/workspace-file'
import {
  evidenceRecord as record,
  evidenceString as string,
  resolveTrustedEvidencePreviewFile
} from './trusted-evidence-preview'

type ResolveWorkspaceFile = (target: WorkspaceFileTarget) => Promise<WorkspaceFileResolveResult>

type ResolveDependencies = {
  claimDetail: unknown
  resolveWorkspaceFile: ResolveWorkspaceFile
}

function fail(
  code: Exclude<ProjectDagEvidencePreviewResolveResult, { ok: true }>['code'],
  message: string
): ProjectDagEvidencePreviewResolveResult {
  return { ok: false, code, message }
}

function assertionCandidates(claimDetail: Record<string, unknown>): Record<string, unknown>[] {
  const provenance = record(claimDetail.provenance)
  const paths = Array.isArray(provenance?.paths) ? provenance.paths : []
  return paths.flatMap((path) => {
    const assertions = record(path)?.sourceAssertions
    return Array.isArray(assertions)
      ? assertions.map(record).filter((item): item is Record<string, unknown> => item !== null)
      : []
  })
}

/** Resolve one immutable provenance tuple without trusting a locator supplied by the iframe. */
export async function resolveProjectDagEvidencePreview(
  input: ProjectDagEvidencePreviewResolveRequest,
  dependencies: ResolveDependencies
): Promise<ProjectDagEvidencePreviewResolveResult> {
  const detail = record(dependencies.claimDetail)
  if (!detail || string(detail.id) !== input.claimId) {
    return fail('claim_mismatch', 'The requested Claim is not present in the pinned Project Snapshot.')
  }
  const provenance = record(detail.provenance)
  if (!provenance || string(provenance.projectSnapshotDigest) !== input.snapshotDigest) {
    return fail('snapshot_mismatch', 'The requested provenance does not match the pinned Project Snapshot.')
  }
  const access = record(provenance.access)
  if (access?.redacted === true || string(access?.level)?.toLowerCase() === 'restricted') {
    return fail('access_restricted', 'The evidence path is restricted and cannot be opened.')
  }

  const matches = assertionCandidates(detail).filter((assertion) =>
    string(assertion.artifactVersionId) === input.artifactVersionId &&
    string(assertion.sourceAnchorId) === input.sourceAnchorId
  )
  if (matches.length === 0) {
    return fail('provenance_mismatch', 'The ArtifactVersion and SourceAnchor are not linked to this Claim.')
  }
  const assertion = matches[0]!
  const artifact = record(assertion.artifact)
  const version = record(assertion.artifactVersion)
  const anchor = record(assertion.sourceAnchor)
  if (!artifact || !version || !anchor ||
      string(version.versionId) !== input.artifactVersionId ||
      string(anchor.anchorId) !== input.sourceAnchorId) {
    return fail('provenance_mismatch', 'The resolved provenance tuple is internally inconsistent.')
  }
  const resolved = await resolveTrustedEvidencePreviewFile({
    workspaceRoot: input.workspaceRoot,
    artifact,
    version,
    anchor,
    resolveWorkspaceFile: dependencies.resolveWorkspaceFile
  })
  if (!resolved.ok) return resolved

  return {
    ok: true,
    path: resolved.path,
    workspaceRoot: input.workspaceRoot,
    snapshotDigest: input.snapshotDigest,
    claimId: input.claimId,
    artifactId: string(assertion.artifactId),
    artifactVersionId: input.artifactVersionId,
    sourceAnchorId: input.sourceAnchorId,
    selector: resolved.selector,
    ...(resolved.contentDigest ? { contentDigest: resolved.contentDigest } : {}),
    ...(resolved.anchorDigest ? { anchorDigest: resolved.anchorDigest } : {}),
    ...(resolved.mediaType ? { mediaType: resolved.mediaType } : {})
  }
}
