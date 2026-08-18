import {
  type ArtifactVersionListInputV2,
  type ArtifactVersionListV2,
  type ArtifactVersionReadV1,
  type ArtifactVersionRefV1,
  type ArtifactVersionDescribeV2
} from '@sciforge/domain-artifact-versions/contract'
import type {
  LegacyComputeBreakpointV1,
  LegacyComputeRunRecordV1,
  LegacyComputeRunSpecV1
} from './legacy-compute-projection.js'
import type { ResearchCheckpointRecordV1 } from '@sciforge/domain-research-checkpoints/contract'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  createResearchDossierActivation,
  type ResearchDossierPage,
  type ResearchDossierTargetV1
} from '../contract.js'
import type { DomainWorkspacePreviewTarget } from '@sciforge/domain-sdk/host'

export type ResearchDossierFiveAxisStatus = Readonly<{
  execution: string
  provenance: string
  control: string
  replication: string
  evidence: string
}>

export type ResearchDossierExactRecord =
  | Readonly<{
      kind: 'artifact-version'
      descriptor: ArtifactVersionDescribeV2
      history: ArtifactVersionListV2
      spec?: LegacyComputeRunSpecV1
      checkpoint?: ResearchCheckpointRecordV1
    }>
  | Readonly<{
      kind: 'compute-run'
      run: LegacyComputeRunRecordV1
      spec?: LegacyComputeRunSpecV1
      specIssue?: string
    }>

export const RESEARCH_DOSSIER_HISTORY_PAGE_SIZE = 25
export const RESEARCH_DOSSIER_SPEC_MAX_BYTES = 4 * 1024 * 1024

export function fiveAxisStatus(
  record: ResearchDossierExactRecord
): ResearchDossierFiveAxisStatus {
  if (record.kind === 'compute-run') {
    return {
      execution: record.run.outcome,
      provenance: record.run.provenance,
      control: record.run.control,
      replication: record.run.replication,
      evidence: record.run.evidence
    }
  }
  const metadata = record.descriptor.version.metadata
  if (record.checkpoint) {
    const status = record.checkpoint.manifest.status
    return {
      execution: status.execution,
      provenance: status.provenance,
      control: status.control,
      replication: status.reproduction,
      evidence: record.checkpoint.status.evidence.status
    }
  }
  return {
    execution: metadataStatus(metadata.executionOutcome),
    provenance: metadataStatus(metadata.provenanceStatus),
    control: metadataStatus(metadata.controlLevel),
    replication: metadataStatus(metadata.replicationStatus),
    evidence: metadataStatus(metadata.evidenceStatus)
  }
}

export function dossierBreakpoints(
  record: ResearchDossierExactRecord
): readonly Readonly<{ code: string; blocking: boolean; message: string }>[] {
  if (record.kind === 'compute-run') return record.run.breakpoints
  if (record.checkpoint) {
    const nonResearchSourceIds = new Set(record.checkpoint.manifest.sources
      .filter((source) => !isResearchSourceUri(source.uri))
      .map((source) => source.sourceId))
    return record.checkpoint.manifest.breakpoints.filter((breakpoint) => !(
      breakpoint.code === 'source-unpinned' &&
      breakpoint.itemId !== undefined &&
      nonResearchSourceIds.has(breakpoint.itemId)
    ))
  }
  const value = record.descriptor.version.metadata.breakpoints
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const item = asRecord(candidate)
    if (!item) return []
    const code = boundedString(item.code)
    const message = boundedString(item.message)
    if (!code || !message || typeof item.blocking !== 'boolean') return []
    return [{ code, message, blocking: item.blocking }]
  })
}

/** XML namespaces describe a file format; they are never scientific sources. */
export function isResearchSourceUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/u, '')
    return ![
      'http://www.w3.org/2000/svg',
      'https://www.w3.org/2000/svg',
      'http://www.w3.org/1999/xlink',
      'https://www.w3.org/1999/xlink',
      'http://www.w3.org/1999/xhtml',
      'https://www.w3.org/1999/xhtml'
    ].includes(normalized)
  } catch {
    return true
  }
}

export function artifactHistoryInput(
  artifactId: string,
  beforeSequence?: number
): ArtifactVersionListInputV2 {
  return {
    artifactId,
    limit: RESEARCH_DOSSIER_HISTORY_PAGE_SIZE,
    ...(beforeSequence ? { beforeSequence } : {})
  }
}

export function mergeArtifactHistory(
  current: ArtifactVersionListV2,
  next: ArtifactVersionListV2
): ArtifactVersionListV2 {
  const seen = new Set<string>()
  return {
    items: [...current.items, ...next.items].filter((item) => {
      if (seen.has(item.version.versionId)) return false
      seen.add(item.version.versionId)
      return true
    }),
    ...(next.nextBeforeSequence
      ? { nextBeforeSequence: next.nextBeforeSequence }
      : {})
  }
}

export function decodeComputeRunSpec(
  _read: ArtifactVersionReadV1
): Readonly<{ ok: false; message: string }> {
  return {
    ok: false,
    message: 'The formal Compute owner is unavailable; legacy RunSpec bytes remain opaque.'
  }
}

export function exactRecordDigest(record: ResearchDossierExactRecord): string {
  const digest = record.kind === 'artifact-version'
    ? record.descriptor.ref.contentDigest
    : (record.run.receiptRef ?? record.run.specRef).contentDigest
  return `sha256:${digest}`
}

export function expectedDigestMatches(
  record: ResearchDossierExactRecord,
  expectedDigest?: string
): boolean {
  return !expectedDigest || exactRecordDigest(record) === expectedDigest
}

export function previewableRef(
  record: ResearchDossierExactRecord
): ArtifactVersionRefV1 | null {
  const ref = record.kind === 'artifact-version'
    ? record.descriptor.ref
    : record.run.outputs.find((output) => output.versionRef && !output.quarantined)?.versionRef
  return ref?.retention === 'snapshot' && ref.availability === 'available' ? ref : null
}

export function previewDestination(ref: ArtifactVersionRefV1): string {
  const safeVersion = ref.versionId
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96) || 'artifact-version'
  return `.sciforge/research-dossier/previews/${safeVersion}-${ref.contentDigest.slice(0, 12)}${mediaExtension(ref.mediaType)}`
}

export function previewIdempotencyKey(ref: ArtifactVersionRefV1): string {
  return `research-dossier:preview:${ref.versionId}:${ref.contentDigest.slice(0, 16)}`
}

export function bundleV2Destination(ref: ArtifactVersionRefV1): string {
  const safeVersion = ref.versionId
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96) || 'artifact-version'
  return `.sciforge/artifact-versions/bundles/${safeVersion}-${ref.contentDigest.slice(0, 12)}.artifact-bundle`
}

export function bundleV2IdempotencyKey(ref: ArtifactVersionRefV1): string {
  return `research-dossier:bundle-v2:${ref.versionId}:${ref.contentDigest.slice(0, 16)}`
}

export function researchDossierPreviewTarget(input: Readonly<{
  destinationPath: string
  previewRef: ArtifactVersionRefV1
  recordDigest: string
  sessionId: string
  surfaceId: string
  workspaceRoot: string
  target: ResearchDossierTargetV1
  page: ResearchDossierPage
  revision: number
  label: string
}>): DomainWorkspacePreviewTarget {
  return {
    path: input.destinationPath,
    sessionId: input.sessionId,
    surfaceId: input.surfaceId,
    workspaceRoot: input.workspaceRoot,
    ...(input.previewRef.mediaType ? { mimeType: input.previewRef.mediaType } : {}),
    kind: 'file',
    integrity: {
      algorithm: 'sha256',
      expectedDigest: `sha256:${input.previewRef.contentDigest}`
    },
    returnTo: {
      contributionId: 'research-dossier.workbench-right-panel',
      label: input.label,
      activation: createResearchDossierActivation(input.target, {
        page: input.page,
        expectedDigest: input.recordDigest,
        revision: input.revision
      })
    }
  }
}

export function computeRunRefs(record: LegacyComputeRunRecordV1): readonly Readonly<{
  role: string
  ref: ArtifactVersionRefV1
}>[] {
  return [
    { role: 'run-spec', ref: record.specRef },
    ...(record.receiptRef ? [{ role: 'run-receipt', ref: record.receiptRef }] : []),
    ...record.outputs.flatMap((output) => output.versionRef
      ? [{ role: `output:${output.outputId}`, ref: output.versionRef }]
      : [])
  ]
}

export function artifactMetadataRows(
  metadata: Readonly<Record<string, DomainPackageJsonValue>>
): readonly Readonly<{ key: string; value: DomainPackageJsonValue }>[] {
  return Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 100)
    .map(([key, value]) => ({ key, value }))
}

export function computeBreakpointSummary(
  breakpoint: LegacyComputeBreakpointV1
): string {
  return `${breakpoint.blocking ? 'blocking' : 'advisory'} · ${breakpoint.code}`
}

function metadataStatus(value: DomainPackageJsonValue | undefined): string {
  return typeof value === 'string' && value.trim() ? value : 'unavailable'
}

function mediaExtension(mediaType?: string): string {
  switch (mediaType?.toLowerCase()) {
    case 'application/json': return '.json'
    case 'application/pdf': return '.pdf'
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/svg+xml': return '.svg'
    case 'text/csv': return '.csv'
    case 'text/tab-separated-values': return '.tsv'
    case 'text/html': return '.html'
    case 'text/markdown': return '.md'
    case 'text/plain': return '.txt'
    default: return '.bin'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= 4_000 ? normalized : null
}
