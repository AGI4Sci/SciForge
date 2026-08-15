import type {
  ArtifactVersionDescribeV2,
  ArtifactVersionListV2,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import type { ResearchCheckpointRecordV1 } from '@sciforge/domain-research-checkpoints/contract'
import type { ResearchDossierActivationPayloadV1 } from '../contract.js'

import type { ResearchDossierCapabilityClient } from './research-dossier-capability-client.js'
import {
  artifactHistoryInput,
  expectedDigestMatches,
  type ResearchDossierExactRecord
} from './research-dossier-model.js'

export type ResearchDossierLoadedV1 = Readonly<{
  record: ResearchDossierExactRecord
  /** Reserved for a future exact Evidence owner contract; currently fail-closed. */
  evidence: null
  review: ResearchDossierVisualReviewSummaryV1 | null
  issues: ResearchDossierSectionIssuesV1
}>

export type ResearchDossierSectionIssuesV1 = Readonly<Partial<Record<
  'versions' | 'checkpoint' | 'reproduction' | 'evidence' | 'review',
  string
>>>

export type ResearchDossierVisualReviewSummaryV1 = Readonly<{
  documentId: string
  revisionId: string
  status: 'candidate' | 'accepted' | 'rejected'
  reviewDigest: string
  reviewedAt: string
  score: number
}>

export type ResearchDossierLoadResultV1 =
  | Readonly<{ ok: true; value: ResearchDossierLoadedV1 }>
  | Readonly<{ ok: false; issue: Readonly<{ code: string; message: string }> }>

export type ResearchDossierBrowseV1 = Readonly<{
  artifacts: ArtifactVersionListV2
  issues: Readonly<Partial<Record<'artifacts', string>>>
}>

export const RESEARCH_DOSSIER_SECONDARY_OWNER_TIMEOUT_MS = 1_500
export const RESEARCH_DOSSIER_BROWSE_ARTIFACT_KINDS = [
  'research-checkpoint',
  'research-output'
] as const
const RESEARCH_DOSSIER_BROWSE_LIMIT = 25

function isResearchDossierBrowseArtifact(
  item: ArtifactVersionListV2['items'][number]
): boolean {
  if (item.artifact.kind === 'research-checkpoint') return true
  if (item.artifact.kind !== 'research-output') return false
  // Legacy ambient capture used the same broad kind before authenticated
  // executor attribution existed. It remains immutable and directly readable,
  // but must not be advertised as a researcher-owned output in the landing list.
  return item.version.metadata.causality === 'host-authenticated-executor-write'
}

export type ResearchDossierLoadOptionsV1 = Readonly<{
  /**
   * Secondary owner reads must never hold the exact Artifact page open.
   * Tests may shorten the window; production callers use the bounded default above.
   */
  secondaryOwnerTimeoutMs?: number
}>

type SecondaryOwnerResultV1<T> = Readonly<{
  value: T | null
  issue?: string
}>

/** Load bounded recent targets for the toolbar/legacy-command landing page. */
export async function loadResearchDossierBrowse(
  client: ResearchDossierCapabilityClient,
  workspaceRoot: string
): Promise<ResearchDossierBrowseV1> {
  const [checkpointArtifactsResult, outputArtifactsResult] = await Promise.allSettled([
    client.listArtifactVersions(workspaceRoot, {
      kind: RESEARCH_DOSSIER_BROWSE_ARTIFACT_KINDS[0],
      currentOnly: true,
      limit: RESEARCH_DOSSIER_BROWSE_LIMIT
    }),
    client.listArtifactVersions(workspaceRoot, {
      kind: RESEARCH_DOSSIER_BROWSE_ARTIFACT_KINDS[1],
      currentOnly: true,
      limit: RESEARCH_DOSSIER_BROWSE_LIMIT
    })
  ])
  const issues: Partial<Record<'artifacts', string>> = {}
  const artifactItems: ArtifactVersionListV2['items'][number][] = []
  const artifactIssues: string[] = []
  for (const result of [checkpointArtifactsResult, outputArtifactsResult]) {
    if (result.status === 'rejected') {
      artifactIssues.push(errorMessage(result.reason))
    } else if (result.value.ok) {
      artifactItems.push(...result.value.value.items)
    } else {
      artifactIssues.push(result.value.issue.message)
    }
  }
  if (artifactIssues.length) issues.artifacts = [...new Set(artifactIssues)].join(' · ')
  const seenVersionIds = new Set<string>()
  const artifacts: ArtifactVersionListV2 = {
    items: artifactItems
      .sort((left, right) => (
        right.version.sequence - left.version.sequence ||
        right.version.createdAt.localeCompare(left.version.createdAt)
      ))
      .filter((item) => {
        if (!isResearchDossierBrowseArtifact(item)) return false
        if (seenVersionIds.has(item.version.versionId)) return false
        seenVersionIds.add(item.version.versionId)
        return true
      })
      .slice(0, RESEARCH_DOSSIER_BROWSE_LIMIT)
  }
  return { artifacts, issues }
}

export async function loadExactResearchDossier(
  client: ResearchDossierCapabilityClient,
  workspaceRoot: string,
  activation: ResearchDossierActivationPayloadV1,
  options: ResearchDossierLoadOptionsV1 = {}
): Promise<ResearchDossierLoadResultV1> {
  const secondaryOwnerTimeoutMs = normalizeSecondaryOwnerTimeout(
    options.secondaryOwnerTimeoutMs
  )
  if (activation.target.kind === 'artifact-version') {
    const described = await client.describeArtifactVersion(
      workspaceRoot,
      activation.target.versionId
    )
    if (!described.ok) return { ok: false, issue: described.issue }
    if (
      activation.expectedDigest &&
      activation.expectedDigest !== `sha256:${described.value.ref.contentDigest}`
    ) {
      return {
        ok: false,
        issue: {
          code: 'digest-mismatch',
          message: 'The exact artifact record does not match the expected digest.'
        }
      }
    }
    if (claimsResearchCheckpoint(described.value) && !isResearchCheckpointDescriptor(described.value)) {
      return {
        ok: false,
        issue: {
          code: 'content-mismatch',
          message: 'The selected Artifact claims Research Checkpoint ownership but its kind or media type is inconsistent.'
        }
      }
    }

    let history: ArtifactVersionListV2
    let versionsIssue: string | undefined
    try {
      const listed = await client.listArtifactVersions(
        workspaceRoot,
        artifactHistoryInput(described.value.artifact.artifactId)
      )
      if (listed.ok) history = listed.value
      else {
        history = { items: [described.value] }
        versionsIssue = listed.issue.message
      }
    } catch (error) {
      history = { items: [described.value] }
      versionsIssue = errorMessage(error)
    }
    const issues: Partial<Record<'versions' | 'checkpoint' | 'reproduction' | 'evidence' | 'review', string>> = {}
    if (versionsIssue) issues.versions = versionsIssue

    let checkpoint: ResearchCheckpointRecordV1 | undefined
    if (isResearchCheckpointDescriptor(described.value)) {
      const checkpointOwnerResult = await settleSecondaryOwner(
        Promise.resolve().then(async () => ({
          value: await client.readResearchCheckpoint(workspaceRoot, {
            ...(metadataString(described.value.version.metadata.researchRecordingId)
              ? { recordingId: metadataString(described.value.version.metadata.researchRecordingId) }
              : {}),
            versionId: described.value.version.versionId
          })
        })),
        secondaryOwnerTimeoutMs,
        'Research Checkpoint'
      )
      if (checkpointOwnerResult.value === null) {
        if (checkpointOwnerResult.issue) issues.checkpoint = checkpointOwnerResult.issue
      } else {
        const checkpointResult = checkpointOwnerResult.value
        if (!checkpointResult.ok) {
          if (isCheckpointIntegrityFailure(checkpointResult.issue.code)) {
            return {
              ok: false,
              issue: { code: checkpointResult.issue.code, message: checkpointResult.issue.message }
            }
          }
          issues.checkpoint = checkpointResult.issue.message
        } else {
          const mismatch = checkpointMismatch(described.value, checkpointResult.value)
          if (mismatch) {
            return { ok: false, issue: { code: 'content-mismatch', message: mismatch } }
          }
          checkpoint = checkpointResult.value
        }
      }
    } else if (metadataString(described.value.version.metadata.runId)) {
      issues.reproduction = 'The formal Compute owner is unavailable; linked run metadata remains opaque.'
    }

    const record: ResearchDossierExactRecord = {
      kind: 'artifact-version',
      descriptor: described.value,
      history,
      ...(checkpoint ? { checkpoint } : {})
    }
    if (!expectedDigestMatches(record, activation.expectedDigest)) {
      return {
        ok: false,
        issue: {
          code: 'digest-mismatch',
          message: 'The exact artifact record does not match the expected digest.'
        }
      }
    }
    // Evidence is intentionally omitted until upstream exposes an exact, scoped
    // summary contract. Never infer it from unrelated or ambient receipts.
    const reviewTask = loadVisualReviewSummary(client, workspaceRoot, described.value)
    const reviewResult = await settleSecondaryOwner(
      reviewTask,
      secondaryOwnerTimeoutMs,
      'Visual Review'
    )
    if (reviewResult.issue) issues.review = reviewResult.issue
    return {
      ok: true,
      value: {
        record,
        evidence: null,
        review: reviewResult.value,
        issues
      }
    }
  }

  return {
    ok: false,
    issue: {
      code: 'compute-owner-unavailable',
      message: 'The formal Compute owner is unavailable; this legacy run target cannot be verified.'
    }
  }
}

async function loadVisualReviewSummary(
  client: ResearchDossierCapabilityClient,
  workspaceRoot: string,
  descriptor: ArtifactVersionDescribeV2
): Promise<SecondaryOwnerResultV1<ResearchDossierVisualReviewSummaryV1>> {
  const metadata = descriptor.version.metadata
  if (metadataString(metadata.producer) !== 'visual-review') {
    return { value: null }
  }
  const documentId = metadataString(metadata.documentId)
  const revisionId = metadataString(metadata.revisionId)
  const recordedDigest = metadataString(metadata.reviewEvidenceDigest)
  if (!documentId || !revisionId || !recordedDigest) {
    return { value: null, issue: 'The Visual Review owner link is incomplete.' }
  }
  try {
    const opened = await client.readVisualReviewDocument(workspaceRoot, { documentId })
    if (opened.workspaceRoot !== workspaceRoot || opened.document.documentId !== documentId) {
      return {
        value: null,
        issue: 'The Visual Review owner returned a document outside the exact workspace/document scope.'
      }
    }
    const revision = opened.document.revisions.find((candidate) => candidate.id === revisionId)
    if (!revision || !revision.versionRef) {
      return {
        value: null,
        issue: 'The exact Visual Review revision or its committed VersionRef is unavailable.'
      }
    }
    if (!sameArtifactVersionRef(revision.versionRef, descriptor.ref)) {
      return {
        value: null,
        issue: 'The Visual Review revision does not match the full exact ArtifactVersionRef.'
      }
    }
    if (revision.reviewEvidence.reviewedArtifactHash !== recordedDigest) {
      return {
        value: null,
        issue: 'The Visual Review evidence digest does not match the Artifact metadata.'
      }
    }
    return {
      value: {
        documentId,
        revisionId,
        status: revision.status,
        reviewDigest: `sha256:${recordedDigest}`,
        reviewedAt: revision.decidedAt ?? revision.reviewEvidence.reviewedAt,
        score: revision.reviewEvidence.score.overall
      }
    }
  } catch (error) {
    return { value: null, issue: errorMessage(error) }
  }
}

async function settleSecondaryOwner<T>(
  request: Promise<SecondaryOwnerResultV1<T>>,
  timeoutMs: number,
  ownerLabel: string
): Promise<SecondaryOwnerResultV1<T>> {
  // Attach both fulfillment and rejection handlers before racing. If the UI timeout
  // wins, the capability invocation keeps running without an unhandled rejection or
  // cancellation that could corrupt broker/client inflight state.
  const guarded = request.then(
    (result) => ({ kind: 'settled' as const, result }),
    (error) => ({
      kind: 'settled' as const,
      result: { value: null, issue: errorMessage(error) } satisfies SecondaryOwnerResultV1<T>
    })
  )
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Readonly<{ kind: 'timeout' }>>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
  })
  const outcome = await Promise.race([guarded, timeout])
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  if (outcome.kind === 'settled') return outcome.result
  return {
    value: null,
    issue: `${ownerLabel} owner did not respond within ${timeoutMs} ms. The exact primary record remains available.`
  }
}

function normalizeSecondaryOwnerTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return RESEARCH_DOSSIER_SECONDARY_OWNER_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return RESEARCH_DOSSIER_SECONDARY_OWNER_TIMEOUT_MS
  }
  return Math.max(1, Math.floor(timeoutMs))
}

function sameArtifactVersionRef(left: ArtifactVersionRefV1, right: ArtifactVersionRefV1): boolean {
  return left.artifactId === right.artifactId &&
    left.versionId === right.versionId &&
    left.contentDigest === right.contentDigest &&
    left.byteLength === right.byteLength &&
    left.mediaType === right.mediaType &&
    left.availability === right.availability &&
    left.retention === right.retention &&
    left.accessPolicy.visibility === right.accessPolicy.visibility &&
    left.accessPolicy.allowExport === right.accessPolicy.allowExport &&
    left.accessPolicy.principals.length === right.accessPolicy.principals.length &&
    left.accessPolicy.principals.every((principal, index) =>
      principal === right.accessPolicy.principals[index]
    )
}

function isResearchCheckpointDescriptor(descriptor: ArtifactVersionDescribeV2): boolean {
  return descriptor.artifact.kind === 'research-checkpoint' &&
    descriptor.ref.mediaType === 'application/vnd.sciforge.research-checkpoint+json'
}

function isCheckpointIntegrityFailure(code: string): boolean {
  return code === 'content-mismatch' || code === 'scope-mismatch'
}

function claimsResearchCheckpoint(descriptor: ArtifactVersionDescribeV2): boolean {
  return descriptor.artifact.kind === 'research-checkpoint' ||
    descriptor.ref.mediaType === 'application/vnd.sciforge.research-checkpoint+json' ||
    descriptor.version.metadata.researchCheckpointContractVersion === 1
}

function checkpointMismatch(
  descriptor: ArtifactVersionDescribeV2,
  checkpoint: ResearchCheckpointRecordV1
): string | null {
  if (!sameArtifactVersionRef(checkpoint.status.artifactRef, descriptor.ref)) {
    return 'The Research Checkpoint owner returned a record for another exact Artifact Version.'
  }
  if (
    checkpoint.status.recordingId !== checkpoint.manifest.recording.recordingId ||
    checkpoint.status.runtimeId !== checkpoint.manifest.recording.runtimeId ||
    checkpoint.status.threadId !== checkpoint.manifest.recording.threadId ||
    checkpoint.status.turnId !== checkpoint.manifest.turn.turnId ||
    checkpoint.status.changeReason !== checkpoint.manifest.changeReason ||
    checkpoint.status.title !== checkpoint.manifest.title ||
    checkpoint.status.ordinal !== descriptor.artifactOrdinal
  ) {
    return 'The Research Checkpoint owner returned inconsistent immutable manifest and status identities.'
  }
  const metadata = descriptor.version.metadata
  const declared = [
    ['researchRecordingId', checkpoint.manifest.recording.recordingId],
    ['runtimeId', checkpoint.manifest.recording.runtimeId],
    ['threadId', checkpoint.manifest.recording.threadId],
    ['turnId', checkpoint.manifest.turn.turnId]
  ] as const
  if (declared.some(([key, expected]) => metadataString(metadata[key]) !== expected)) {
    return 'The Research Checkpoint owner projection does not match the Artifact owner metadata scope.'
  }
  return null
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() === value && value ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
