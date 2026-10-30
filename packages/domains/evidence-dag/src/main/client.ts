import {
  artifactVersionRefV1Schema,
} from '@sciforge/domain-artifact-versions/contract'
import {
  evidenceDagCommittedSnapshotSchema,
  evidenceDagDataCiteMetadataV1Schema,
  evidenceDagExportProductKindSchema,
  evidenceDagTypedErrorSchema,
  type EvidenceDagCommittedSnapshot,
  type EvidenceDagDataCiteMetadataV1,
  type EvidenceDagExportProductKind,
  type EvidenceDagPreviewInput,
  type EvidenceDagTypedError
} from '../contract.js'
import { z } from 'zod'

export const DEFAULT_EVIDENCE_DAG_SERVICE_URL = 'http://127.0.0.1:3897'
export const EVIDENCE_DAG_SERVICE_URL_ENV = 'SCIFORGE_EVIDENCE_DAG_SERVICE_URL'
export const EVIDENCE_DAG_API_KEY_ENV = 'SCIFORGE_EVIDENCE_DAG_API_KEY'
export const EVIDENCE_DAG_SERVICE_ID = 'evidence-dag-engine' as const
export const EVIDENCE_DAG_SERVICE_VERSION = '1.0.0' as const

const DEFAULT_REQUEST_TIMEOUT_MS = 600_000

export type EvidenceDagServiceEndpoint = Readonly<{
  baseUrl: string
  apiKey: string
}>

/**
 * Formal seal write submitted to the Evidence owner.  Ordinary completed
 * turns never use this path; they append to the desktop delta chain instead.
 */
export type EvidenceDagSnapshotCommitInput = Readonly<{
  threadId: string
  targetWatermark: string
  trace: readonly Readonly<Record<string, unknown>>[]
  workspaceRoot: string
  idempotencyKey: string
}>

const evidenceDagSnapshotProductProjectionSchema = z.object({
  product: evidenceDagExportProductKindSchema,
  fileName: z.string().trim().min(1).max(512),
  mediaType: z.string().trim().regex(/^[^\s/]+\/[^\s/]+$/u).max(256),
  content: z.string().max(128 * 1024 * 1024),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  byteLength: z.number().int().nonnegative()
}).strict()

const evidenceDagSnapshotProductsProjectionSchema = z.object({
  schemaVersion: z.literal('sciforge-evidence-products.v1'),
  threadId: z.string().trim().min(1).max(512),
  snapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  sourceArtifactVersionRefs: z.array(artifactVersionRefV1Schema).max(10_000),
  products: z.array(evidenceDagSnapshotProductProjectionSchema).length(5)
}).strict().superRefine((value, context) => {
  const products = new Set(value.products.map((item) => item.product))
  if (products.size !== evidenceDagExportProductKindSchema.options.length) {
    context.addIssue({
      code: 'custom',
      path: ['products'],
      message: 'The sidecar must return each snapshot product exactly once.'
    })
  }
})

export type EvidenceDagSnapshotProductProjection = Readonly<{
  product: EvidenceDagExportProductKind
  fileName: string
  mediaType: string
  content: string
  contentDigest: string
  byteLength: number
}>

export type EvidenceDagSnapshotProductsProjection = Readonly<{
  schemaVersion: 'sciforge-evidence-products.v1'
  threadId: string
  snapshotDigest: string
  sourceArtifactVersionRefs: readonly z.infer<typeof artifactVersionRefV1Schema>[]
  products: readonly EvidenceDagSnapshotProductProjection[]
}>

export class EvidenceDagServiceError extends Error {
  readonly diagnostic: EvidenceDagTypedError

  constructor(diagnostic: EvidenceDagTypedError) {
    super(diagnostic.message)
    this.name = 'EvidenceDagServiceError'
    this.diagnostic = diagnostic
  }
}

export class EvidenceDagServiceClient {
  constructor(private readonly options: Readonly<{
    endpoint: () => EvidenceDagServiceEndpoint
    fetchImpl?: typeof fetch
    timeoutMs?: number
    now?: () => Date
  }>) {}

  uiUrl(runtimeId?: string, threadId?: string): string {
    const endpoint = this.options.endpoint()
    const url = new URL(`${normalizeBaseUrl(endpoint.baseUrl)}/`)
    if (threadId?.trim()) {
      url.searchParams.set('thread', evidenceDagThreadId(runtimeId, threadId))
      if (runtimeId?.trim()) url.searchParams.set('preview', 'trusted')
    }
    if (endpoint.apiKey) {
      const hash = new URLSearchParams()
      hash.set('token', endpoint.apiKey)
      url.hash = hash.toString()
    }
    return url.toString()
  }

  async health(): Promise<void> {
    const identity = await this.request('/version', { method: 'GET' }, 2_000)
    if (!isEvidenceDagServiceIdentity(identity)) {
      throw this.error({
        code: 'upstream_unavailable',
        message: `Evidence DAG service must be ${EVIDENCE_DAG_SERVICE_ID} ` +
          `version ${EVIDENCE_DAG_SERVICE_VERSION}.`,
        retryable: false,
        occurredAt: this.now().toISOString()
      })
    }
  }

  async status(threadId: string): Promise<Readonly<Record<string, unknown>>> {
    const data = await this.request(
      `/updates/status?threadId=${encodeURIComponent(threadId)}`,
      { method: 'GET', cache: 'no-store' }
    )
    return record(data) ?? {}
  }

  /**
   * Materialize one exact committed Snapshot through the package-owned
   * Evidence sidecar. This is intentionally separate from `status`: the
   * sidecar remains the canonical Snapshot writer while callers retain the
   * returned immutable identity for downstream Project references.
   */
  async commitSnapshot(
    input: EvidenceDagSnapshotCommitInput
  ): Promise<EvidenceDagCommittedSnapshot> {
    const data = record(await this.request('/updates', {
      method: 'POST',
      body: JSON.stringify({
        threadId: input.threadId,
        targetWatermark: input.targetWatermark,
        reason: 'seal_closure',
        priority: 'immediate',
        trace: input.trace,
        workspaceRoot: input.workspaceRoot,
        queuedAt: this.now().toISOString(),
        correlationId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey
      })
    }))
    const snapshot = normalizeSnapshot(data?.snapshot)
    if (!snapshot) {
      throw this.error({
        code: 'internal_error',
        message: 'Evidence closure seal returned no committed Snapshot.',
        retryable: false,
        occurredAt: this.now().toISOString()
      })
    }
    if (snapshot.threadId !== input.threadId) {
      throw this.error({
        code: 'snapshot_corrupt',
        message: 'Evidence closure seal returned a Snapshot for a different thread.',
        retryable: false,
        occurredAt: this.now().toISOString()
      })
    }
    return snapshot
  }

  async evidencePreview(input: EvidenceDagPreviewInput): Promise<unknown> {
    const query = new URLSearchParams({
      snapshotDigest: input.snapshotDigest,
      sourceAssertionId: input.sourceAssertionId,
      artifactVersionId: input.artifactVersionId,
      sourceAnchorId: input.sourceAnchorId
    })
    return this.request(
      `/threads/${encodeURIComponent(evidenceDagThreadId(input.runtimeId, input.threadId))}` +
      `/evidence-preview?${query.toString()}`,
      { method: 'GET', cache: 'no-store' }
    )
  }

  async audit(threadId: string, targetDigest: string): Promise<unknown> {
    return this.request('/audits', {
      method: 'POST',
      body: JSON.stringify({
        threadId,
        targetDigest,
        level: 'L0',
        trigger: 'manual',
        threshold: 0.7
      })
    })
  }

  async snapshotProducts(
    threadId: string,
    snapshotDigest: string,
    datacite: EvidenceDagDataCiteMetadataV1
  ): Promise<EvidenceDagSnapshotProductsProjection> {
    const data = await this.request('/snapshot-products', {
      method: 'POST',
      body: JSON.stringify({
        threadId,
        snapshotDigest,
        datacite: evidenceDagDataCiteMetadataV1Schema.parse(datacite)
      })
    })
    return evidenceDagSnapshotProductsProjectionSchema.parse(data)
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = this.options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const endpoint = this.options.endpoint()
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        `${normalizeBaseUrl(endpoint.baseUrl)}${path}`,
        {
          ...init,
          headers: {
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${endpoint.apiKey}`,
            ...init.headers
          },
          signal: AbortSignal.timeout(timeoutMs)
        }
      )
      const body = await response.json().catch(() => null)
      const envelope = record(body)
      if (!response.ok || envelope?.ok !== true) {
        throw this.errorFromResponse(response.status, envelope)
      }
      return envelope.data
    } catch (error) {
      if (error instanceof EvidenceDagServiceError) throw error
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
      throw this.error({
        code: timedOut ? 'upstream_timeout' : 'upstream_unavailable',
        message: timedOut
          ? 'Evidence DAG service request timed out.'
          : 'Evidence DAG service is unavailable.',
        retryable: true,
        occurredAt: this.now().toISOString()
      })
    }
  }

  private errorFromResponse(
    status: number,
    envelope: Record<string, unknown> | null
  ): EvidenceDagServiceError {
    const error = record(envelope?.error)
    const upstreamCode = stringValue(error?.code)?.toLowerCase() ?? ''
    const code = canonicalErrorCode(upstreamCode, status)
    return this.error({
      code,
      message: stringValue(error?.message) ?? `Evidence DAG service returned HTTP ${status}.`,
      retryable: typeof error?.retryable === 'boolean'
        ? error.retryable
        : status === 408 || status === 429 || status >= 500,
      occurredAt: this.now().toISOString(),
      ...(stringValue(record(envelope?.provenance)?.requestId)
        ? { requestId: stringValue(record(envelope?.provenance)?.requestId) }
        : {}),
      ...(stringValue(error?.incompleteReason)
        ? { incompleteReason: stringValue(error?.incompleteReason) }
        : {}),
      ...(Number.isInteger(error?.attempts) && Number(error?.attempts) > 0
        ? { attempts: Number(error?.attempts) }
        : {}),
      ...(stringValue(error?.responseStatus)
        ? { responseStatus: stringValue(error?.responseStatus) }
        : {}),
      ...(status >= 100 && status <= 599 ? { upstreamStatus: status } : {})
    })
  }

  private error(input: z.input<typeof evidenceDagTypedErrorSchema>): EvidenceDagServiceError {
    return new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse(input))
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))()
  }
}

export function evidenceDagThreadId(runtimeId: string | undefined, threadId: string): string {
  const runtime = runtimeId?.trim()
  const id = threadId.trim()
  return runtime && id && !id.startsWith(`${runtime}:`) ? `${runtime}:${id}` : id
}

export function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim() || DEFAULT_EVIDENCE_DAG_SERVICE_URL)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Evidence DAG service URL must use HTTP or HTTPS.')
  }
  return parsed.toString().replace(/\/+$/u, '')
}

export function isEvidenceDagServiceIdentity(value: unknown): boolean {
  const identity = record(value)
  return identity?.service === EVIDENCE_DAG_SERVICE_ID &&
    identity.version === EVIDENCE_DAG_SERVICE_VERSION
}

function canonicalErrorCode(
  upstreamCode: string,
  status: number
): EvidenceDagTypedError['code'] {
  if (upstreamCode === 'router_response_incomplete') return 'model_output_incomplete'
  if (upstreamCode === 'router_empty_output' || upstreamCode === 'extractor_empty_output') {
    return 'model_output_empty'
  }
  if (upstreamCode === 'extractor_invalid_json' || upstreamCode === 'router_invalid_json' ||
      upstreamCode === 'extractor_invalid_shape' ||
      upstreamCode === 'extractor_invalid_output_type') {
    return 'model_output_invalid_json'
  }
  if (upstreamCode === 'upstream_timeout' || status === 408) return 'upstream_timeout'
  if (status === 429 || upstreamCode.includes('429')) return 'upstream_rate_limited'
  if (status >= 500 || upstreamCode === 'upstream_network_error' || upstreamCode === 'unavailable') {
    return 'upstream_unavailable'
  }
  if (upstreamCode.includes('snapshot')) return 'snapshot_corrupt'
  if (status === 401 || status === 403) return 'access_restricted'
  return 'internal_error'
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeSnapshot(value: unknown): EvidenceDagCommittedSnapshot | null {
  const snapshot = record(value)
  if (!snapshot || snapshot.status !== 'committed') return null
  return evidenceDagCommittedSnapshotSchema.parse({
    threadId: snapshot.threadId,
    version: snapshot.version,
    digest: snapshot.digest,
    inputWatermark: snapshot.inputWatermark,
    schemaVersion: snapshot.schemaVersion,
    extractorVersion: snapshot.extractorVersion,
    verifierVersion: snapshot.verifierVersion,
    artifactDigests: snapshot.artifactDigests,
    createdAt: snapshot.createdAt,
    ...(typeof snapshot.url === 'string' ? { url: snapshot.url } : {})
  })
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
