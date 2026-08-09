import { createHash } from 'node:crypto'
import {
  artifactVersionRefV1Schema,
  type ArtifactVersionAccessPolicyV1,
  type ArtifactVersionCommitCandidateV1,
  type ArtifactVersionCommitPortV1,
  type ArtifactVersionReadPortV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  evidenceDagExportSnapshotProductsOutputSchema,
  type EvidenceDagExportProductKind,
  type EvidenceDagExportSnapshotProductsInput,
  type EvidenceDagExportSnapshotProductsOutput,
  type EvidenceDagExportTargetsV1
} from '../contract.js'
import type { EvidenceDagSnapshotProductsProjection } from './client.js'

const PRODUCT_ORDER: readonly EvidenceDagExportProductKind[] = Object.freeze([
  'prov-json',
  'ro-crate',
  'datacite',
  'audit-report',
  'reproduction-report'
])

const PRODUCT_CONFIG: Readonly<Record<EvidenceDagExportProductKind, Readonly<{
  candidateId: string
  kind: string
  label: string
  target: keyof EvidenceDagExportTargetsV1
}>>> = Object.freeze({
  'prov-json': {
    candidateId: 'evidence-product:prov-json',
    kind: 'evidence-prov-json',
    label: 'Evidence PROV-JSON',
    target: 'provJson'
  },
  'ro-crate': {
    candidateId: 'evidence-product:ro-crate',
    kind: 'evidence-ro-crate',
    label: 'Evidence RO-Crate',
    target: 'roCrate'
  },
  datacite: {
    candidateId: 'evidence-product:datacite',
    kind: 'evidence-datacite',
    label: 'Evidence DataCite metadata',
    target: 'datacite'
  },
  'audit-report': {
    candidateId: 'evidence-product:audit-report',
    kind: 'evidence-audit-report',
    label: 'Evidence audit report',
    target: 'auditReport'
  },
  'reproduction-report': {
    candidateId: 'evidence-product:reproduction-report',
    kind: 'evidence-reproduction-report',
    label: 'Evidence reproduction report',
    target: 'reproductionReport'
  }
})

export async function commitEvidenceSnapshotProducts(input: Readonly<{
  request: EvidenceDagExportSnapshotProductsInput
  engineThreadId: string
  projection: EvidenceDagSnapshotProductsProjection
  readPort: ArtifactVersionReadPortV1
  commitPort: ArtifactVersionCommitPortV1
}>): Promise<EvidenceDagExportSnapshotProductsOutput> {
  const { request, projection } = input
  if (projection.threadId !== input.engineThreadId) {
    throw new Error('Evidence product projection threadId does not match the requested thread.')
  }
  if (projection.snapshotDigest !== request.snapshotDigest) {
    throw new Error('Evidence product projection does not match the pinned snapshot digest.')
  }
  const products = new Map(projection.products.map((product) => [product.product, product]))
  if (products.size !== PRODUCT_ORDER.length) {
    throw new Error('Evidence product projection is incomplete.')
  }
  for (const product of projection.products) verifyProjectedBytes(product)

  const sourceRefs = [...projection.sourceArtifactVersionRefs]
    .map((ref) => artifactVersionRefV1Schema.parse(ref))
    .sort(compareRefs)
  if (sourceRefs.length > 1_024) {
    throw new Error(
      'Evidence snapshot export exceeds the 1024 exact source dependency limit.'
    )
  }
  ensureUniqueSourceRefs(sourceRefs)
  await Promise.all(sourceRefs.map((ref) => verifyExactSourceRef(ref, input.readPort)))
  const accessPolicy = derivedAccessPolicy(sourceRefs)
  const dependencies = sourceRefs.map((ref) => ({
    role: 'source-artifact',
    required: true,
    target: { kind: 'version' as const, ref }
  }))
  const candidates: ArtifactVersionCommitCandidateV1[] = PRODUCT_ORDER.map((productKind) => {
    const product = products.get(productKind)
    if (!product) throw new Error(`Evidence product projection is missing ${productKind}.`)
    const config = PRODUCT_CONFIG[productKind]
    const target = request.targets?.[config.target]
    return {
      candidateId: config.candidateId,
      ...(target ? { artifactId: target.artifactId } : {}),
      expectedCurrentVersionId: target?.expectedCurrentVersionId ?? null,
      kind: config.kind,
      label: config.label,
      intent: 'publish',
      content: {
        mode: 'snapshot',
        dataBase64: Buffer.from(product.content, 'utf8').toString('base64'),
        mediaType: product.mediaType
      },
      dependencies,
      accessPolicy,
      metadata: {
        evidenceRuntimeId: request.runtimeId,
        evidenceThreadId: request.threadId,
        evidenceEngineThreadId: input.engineThreadId,
        evidenceSnapshotDigest: request.snapshotDigest,
        evidenceProduct: productKind,
        evidenceProductDigest: product.contentDigest,
        evidenceProductFileName: product.fileName
      }
    }
  })
  const idempotencyKey = exportIdempotencyKey(request, projection)
  const committed = await input.commitPort.commit({ idempotencyKey, candidates })
  if (!committed.ok) {
    throw new Error(
      `Evidence products were not committed: ${committed.issue.code}: ${committed.issue.message}`
    )
  }
  const byCandidate = new Map(
    committed.value.versions.map((item) => [item.candidateId, item])
  )
  if (byCandidate.size !== PRODUCT_ORDER.length) {
    throw new Error('Artifact Versions returned an incomplete Evidence product transaction receipt.')
  }
  const output = {
    runtimeId: request.runtimeId,
    threadId: request.threadId,
    snapshotDigest: request.snapshotDigest,
    transactionId: committed.value.transactionId,
    idempotentReplay: committed.value.idempotentReplay,
    products: PRODUCT_ORDER.map((product) => {
      const receipt = byCandidate.get(PRODUCT_CONFIG[product].candidateId)
      if (!receipt) {
        throw new Error(`Artifact Versions receipt is missing ${product}.`)
      }
      const projected = products.get(product)!
      const target = request.targets?.[PRODUCT_CONFIG[product].target]
      if (target && receipt.ref.artifactId !== target.artifactId) {
        throw new Error(`Artifact Versions receipt changed the ${product} Artifact identity.`)
      }
      if (
        receipt.ref.contentDigest !== projected.contentDigest ||
        receipt.ref.byteLength !== projected.byteLength ||
        receipt.ref.mediaType !== projected.mediaType ||
        receipt.ref.retention !== 'snapshot' ||
        receipt.ref.availability !== 'available'
      ) {
        throw new Error(`Artifact Versions receipt does not match ${product} canonical bytes.`)
      }
      return { product, ref: receipt.ref }
    }),
    sourceArtifactVersionRefs: sourceRefs
  }
  return evidenceDagExportSnapshotProductsOutputSchema.parse(output)
}

function verifyProjectedBytes(product: EvidenceDagSnapshotProductsProjection['products'][number]) {
  const bytes = Buffer.from(product.content, 'utf8')
  if (bytes.byteLength !== product.byteLength) {
    throw new Error(`Evidence ${product.product} projection byte length does not match its content.`)
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== product.contentDigest) {
    throw new Error(`Evidence ${product.product} projection digest does not match its content.`)
  }
}

async function verifyExactSourceRef(
  expected: ArtifactVersionRefV1,
  port: ArtifactVersionReadPortV1
): Promise<void> {
  if (!expected.accessPolicy.allowExport) {
    throw new Error(`ArtifactVersion ${expected.versionId} does not allow export.`)
  }
  if (expected.availability !== 'available') {
    throw new Error(`ArtifactVersion ${expected.versionId} is not available for verification.`)
  }
  if (expected.byteLength > 64 * 1024 * 1024) {
    throw new Error(
      `ArtifactVersion ${expected.versionId} exceeds the exact-read verification limit.`
    )
  }
  const result = await port.read({
    versionId: expected.versionId,
    maxBytes: Math.max(1, expected.byteLength)
  })
  if (!result.ok) {
    throw new Error(
      `ArtifactVersion ${expected.versionId} could not be resolved: ` +
      `${result.issue.code}: ${result.issue.message}`
    )
  }
  if (!sameRef(expected, result.value.ref)) {
    throw new Error(`ArtifactVersion ${expected.versionId} no longer matches the pinned ref.`)
  }
  const bytes = Buffer.from(result.value.dataBase64, 'base64')
  if (bytes.byteLength !== expected.byteLength) {
    throw new Error(`ArtifactVersion ${expected.versionId} byte length verification failed.`)
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== expected.contentDigest) {
    throw new Error(`ArtifactVersion ${expected.versionId} content verification failed.`)
  }
}

function sameRef(left: ArtifactVersionRefV1, right: ArtifactVersionRefV1): boolean {
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
    left.accessPolicy.principals.every(
      (principal, index) => principal === right.accessPolicy.principals[index]
    )
}

function derivedAccessPolicy(
  refs: readonly ArtifactVersionRefV1[]
): ArtifactVersionAccessPolicyV1 {
  const restricted = refs.filter((ref) => ref.accessPolicy.visibility === 'restricted')
  if (restricted.length) {
    let principals = new Set(restricted[0]!.accessPolicy.principals)
    for (const ref of restricted.slice(1)) {
      const allowed = new Set(ref.accessPolicy.principals)
      principals = new Set([...principals].filter((principal) => allowed.has(principal)))
    }
    if (!principals.size) {
      throw new Error('No principal is authorized to export all pinned source versions.')
    }
    return {
      visibility: 'restricted',
      principals: [...principals].sort(),
      allowExport: true
    }
  }
  if (!refs.length || refs.some((ref) => ref.accessPolicy.visibility === 'workspace')) {
    return { visibility: 'workspace', principals: [], allowExport: true }
  }
  return { visibility: 'public', principals: [], allowExport: true }
}

function ensureUniqueSourceRefs(refs: readonly ArtifactVersionRefV1[]): void {
  const versionIds = new Set<string>()
  for (const ref of refs) {
    if (versionIds.has(ref.versionId)) {
      throw new Error(`Duplicate source ArtifactVersionRef: ${ref.versionId}`)
    }
    versionIds.add(ref.versionId)
  }
}

function compareRefs(left: ArtifactVersionRefV1, right: ArtifactVersionRefV1): number {
  return left.artifactId.localeCompare(right.artifactId) ||
    left.versionId.localeCompare(right.versionId)
}

function exportIdempotencyKey(
  request: EvidenceDagExportSnapshotProductsInput,
  projection: EvidenceDagSnapshotProductsProjection
): string {
  const payload = {
    runtimeId: request.runtimeId,
    threadId: request.threadId,
    snapshotDigest: request.snapshotDigest,
    datacite: request.datacite,
    targets: request.targets ?? {},
    products: [...projection.products]
      .map((product) => ({ product: product.product, digest: product.contentDigest }))
      .sort((left, right) => left.product.localeCompare(right.product))
  }
  return `evidence-export:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}
