import { createHash } from 'node:crypto'
import {
  ARTIFACT_VERSION_COMMIT_CONTRACT,
  ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
  ARTIFACT_VERSION_READ_CONTRACT,
  artifactVersionAccessPolicyV1Schema,
  artifactVersionRefV1Schema,
  type ArtifactVersionCommitCandidateV1,
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitPortV1,
  type ArtifactVersionEventListPortV1,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadPortV1,
  type ArtifactVersionRefV1,
  type ArtifactVersionIssueV1,
  type ArtifactVersionLifecycleEventV1
} from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  evidenceDagArtifactVersionProjectionV1Schema,
  type EvidenceDagArtifactVersionProjectionV1,
  type EvidenceDagArtifactVersionRecordV1
} from '../contract.js'

export type EvidenceArtifactVersionPinContext = Readonly<{
  runtimeId: string
  threadId: string
  operationId: string
  workspaceRoot: string
  occurredAt: string
}>

export type EvidenceArtifactVersionClient = Readonly<{
  pinTrace(
    trace: readonly Readonly<Record<string, unknown>>[],
    context: EvidenceArtifactVersionPinContext
  ): Promise<readonly Readonly<Record<string, unknown>>[]>
  withLifecycle(
    trace: readonly Readonly<Record<string, unknown>>[],
    lifecycle: ArtifactVersionLifecyclePage
  ): readonly Readonly<Record<string, unknown>>[]
  identities(
    trace: readonly Readonly<Record<string, unknown>>[]
  ): readonly EvidenceArtifactVersionIdentity[]
}>

export type EvidenceArtifactVersionIdentity = Readonly<{
  artifactId: string
  versionId: string
}>

export type ArtifactVersionLifecyclePage = Readonly<{
  events: readonly ArtifactVersionLifecycleEventV1[]
  lastSequence: number
  lifecyclePending: boolean
}>

export function artifactVersionCommitPort(
  context: DomainMainRuntimeLifecycleContext,
  workspaceRoot: string
): ArtifactVersionCommitPortV1 {
  return Object.freeze({
    commit: (input: ArtifactVersionCommitInputV1) => context.capabilities.invoke(
      ARTIFACT_VERSION_COMMIT_CONTRACT,
      input,
      {
        workspaceId: workspaceRoot,
        idempotencyKey: input.idempotencyKey
      }
    )
  })
}

export function artifactVersionEventListPort(
  context: DomainMainRuntimeLifecycleContext,
  workspaceRoot: string
): ArtifactVersionEventListPortV1 {
  return Object.freeze({
    listEvents: (input) => context.capabilities.invoke(
      ARTIFACT_VERSION_EVENT_LIST_CONTRACT,
      input,
      { workspaceId: workspaceRoot }
    )
  })
}

export function artifactVersionReadPort(
  context: DomainMainRuntimeLifecycleContext,
  workspaceRoot: string
): ArtifactVersionReadPortV1 {
  return Object.freeze({
    read: (input: ArtifactVersionReadInputV1) => context.capabilities.invoke(
      ARTIFACT_VERSION_READ_CONTRACT,
      input,
      { workspaceId: workspaceRoot }
    )
  })
}

export function createEvidenceArtifactVersionClient(
  commitPort: (workspaceRoot: string) => ArtifactVersionCommitPortV1,
  readPort: (workspaceRoot: string) => ArtifactVersionReadPortV1
): EvidenceArtifactVersionClient {
  return Object.freeze({
    pinTrace: async (trace, context) => {
      return Promise.all(
        trace.map((item) => pinTraceItem(item, context, commitPort, readPort))
      )
    },
    withLifecycle: mergeLifecycleProjection,
    identities: evidenceArtifactVersionIdentities
  })
}

export type ArtifactVersionLifecyclePull =
  | Readonly<{
      ok: true
      events: readonly ArtifactVersionLifecycleEventV1[]
      lastSequence: number
      lifecyclePending: boolean
    }>
  | Readonly<{ ok: false; issue: ArtifactVersionIssueV1 }>

export async function pullArtifactVersionLifecyclePage(
  workspaceRoot: string,
  afterSequence: number,
  port: (workspaceRoot: string) => ArtifactVersionEventListPortV1,
  limit = 256
): Promise<ArtifactVersionLifecyclePull> {
  try {
    const result = await port(workspaceRoot).listEvents({ afterSequence, limit })
    return result.ok
      ? {
          ok: true,
          events: result.value.events,
          lastSequence: result.value.lastSequence,
          lifecyclePending: result.value.events.length === limit
        }
      : { ok: false, issue: result.issue }
  } catch (error) {
    return {
      ok: false,
      issue: {
        code: 'io-failure',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export function mergeLifecycleProjection(
  trace: readonly Readonly<Record<string, unknown>>[],
  lifecycle: ArtifactVersionLifecyclePage
): readonly Readonly<Record<string, unknown>>[] {
  if (!trace.length) return trace
  const output = trace.map((item) => ({ ...item }))
  const index = output.findIndex((item) => {
    const parsed = evidenceDagArtifactVersionProjectionV1Schema.safeParse(
      item.evidenceArtifactVersions
    )
    return !parsed.success || parsed.data.status === 'ready'
  })
  const targetIndex = index >= 0 ? index : 0
  const target = output[targetIndex]!
  const parsed = evidenceDagArtifactVersionProjectionV1Schema.safeParse(
    target.evidenceArtifactVersions
  )
  const base = parsed.success
    ? parsed.data
    : { status: 'ready' as const, versions: [], lifecycleEvents: [] }
  if (base.status === 'ready') {
    const events = dedupeLifecycleEvents([...base.lifecycleEvents, ...lifecycle.events])
    target.evidenceArtifactVersions = evidenceDagArtifactVersionProjectionV1Schema.parse({
      ...base,
      lifecycleEvents: events,
      lastSequence: lifecycle.lastSequence,
      lifecyclePending: lifecycle.lifecyclePending
    })
  } else {
    target.evidenceArtifactVersions = evidenceDagArtifactVersionProjectionV1Schema.parse({
      ...base,
      lifecycleEvents: lifecycle.events,
      lastSequence: lifecycle.lastSequence,
      lifecyclePending: lifecycle.lifecyclePending
    })
  }
  return output.map((item) => Object.freeze(item))
}

export function evidenceArtifactVersionIdentities(
  trace: readonly Readonly<Record<string, unknown>>[]
): readonly EvidenceArtifactVersionIdentity[] {
  const identities = new Map<string, EvidenceArtifactVersionIdentity>()
  for (const item of trace) {
    const projection = evidenceDagArtifactVersionProjectionV1Schema.safeParse(
      item.evidenceArtifactVersions
    )
    if (projection.success && projection.data.status === 'ready') {
      for (const record of projection.data.versions) {
        identities.set(record.ref.versionId, {
          artifactId: record.ref.artifactId,
          versionId: record.ref.versionId
        })
      }
    }
  }
  return [...identities.values()].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId) ||
    left.versionId.localeCompare(right.versionId)
  )
}

function dedupeLifecycleEvents(
  events: readonly ArtifactVersionLifecycleEventV1[]
): ArtifactVersionLifecycleEventV1[] {
  const byId = new Map(events.map((event) => [event.eventId, event]))
  return [...byId.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-512)
}

async function pinTraceItem(
  input: Readonly<Record<string, unknown>>,
  context: EvidenceArtifactVersionPinContext,
  commitPort: (workspaceRoot: string) => ArtifactVersionCommitPortV1,
  readPort: (workspaceRoot: string) => ArtifactVersionReadPortV1
): Promise<Readonly<Record<string, unknown>>> {
  const existing = evidenceDagArtifactVersionProjectionV1Schema.safeParse(
    input.evidenceArtifactVersions
  )
  if (existing.success) {
    if (existing.data.status !== 'ready') return input
    const verifiedRecords: EvidenceDagArtifactVersionRecordV1[] = []
    for (const record of existing.data.versions) {
      const verified = await verifyArtifactVersionRef(
        record.ref,
        context.workspaceRoot,
        readPort
      )
      if (!verified.ok) {
        return withProjection(input, {
          status: 'failed',
          issue: verified.issue,
          lifecycleEvents: existing.data.lifecycleEvents,
          ...(existing.data.lastSequence !== undefined
            ? { lastSequence: existing.data.lastSequence }
            : {}),
          ...(existing.data.lifecyclePending !== undefined
            ? { lifecyclePending: existing.data.lifecyclePending }
            : {})
        })
      }
      verifiedRecords.push(verified.record)
    }
    return withProjection(input, {
      ...existing.data,
      versions: verifiedRecords
    })
  }

  const descriptors = artifactDescriptors(input)
  if (!descriptors.length) return input

  const records: EvidenceDagArtifactVersionRecordV1[] = []
  const candidates: ArtifactVersionCommitCandidateV1[] = []
  let incompleteReason: string | undefined
  for (const [index, descriptor] of descriptors.entries()) {
    const parsedRef = artifactVersionRefV1Schema.safeParse(descriptor.artifactVersionRef)
    if (parsedRef.success) {
      const verified = await verifyArtifactVersionRef(
        parsedRef.data,
        context.workspaceRoot,
        readPort
      )
      if (!verified.ok) {
        return withProjection(input, { status: 'failed', issue: verified.issue })
      }
      records.push(verified.record)
      continue
    }

    const locator = text(descriptor.locator)
    const digest = bareSha256(descriptor.contentDigest ?? descriptor.content_digest)
    const byteLength = nonnegativeInteger(
      descriptor.byteLength ?? descriptor.byte_length ?? descriptor.size
    )
    const artifactId = text(descriptor.artifactId ?? descriptor.artifact_id)
    const expectedCurrentVersionId = text(
      descriptor.expectedCurrentVersionId ?? descriptor.currentVersionId
    )
    if (!locator || !digest || byteLength === undefined) {
      incompleteReason = 'Artifact provenance requires locator, contentDigest, and byteLength.'
      continue
    }
    if (artifactId && !expectedCurrentVersionId) {
      incompleteReason = 'An existing artifact requires expectedCurrentVersionId.'
      continue
    }
    const rawAccessPolicy = descriptor.accessPolicy ?? descriptor.access_policy
    const parsedAccessPolicy = artifactVersionAccessPolicyV1Schema.safeParse(rawAccessPolicy)
    if (rawAccessPolicy !== undefined && !parsedAccessPolicy.success) {
      incompleteReason = 'Artifact provenance accessPolicy does not match the public contract.'
      continue
    }
    candidates.push({
      candidateId: candidateId(context.operationId, index, locator, digest),
      ...(artifactId ? { artifactId } : {}),
      expectedCurrentVersionId: artifactId ? expectedCurrentVersionId! : null,
      kind: normalizedKind(descriptor.kind),
      ...(text(descriptor.label ?? descriptor.name) ? {
        label: text(descriptor.label ?? descriptor.name)
      } : {}),
      intent: 'observe',
      ...(parsedAccessPolicy.success ? { accessPolicy: parsedAccessPolicy.data } : {}),
      content: {
        mode: 'reference',
        locator,
        contentDigest: digest,
        byteLength,
        ...(text(descriptor.mediaType ?? descriptor.media_type) ? {
          mediaType: text(descriptor.mediaType ?? descriptor.media_type)
        } : {}),
        ...(availability(descriptor.availability) ? {
          availability: availability(descriptor.availability)
        } : {})
      },
      metadata: {
        evidenceRuntimeId: context.runtimeId,
        evidenceThreadId: context.threadId,
        evidenceOperationId: context.operationId
      }
    })
  }

  if (incompleteReason) {
    return withProjection(input, {
      status: 'pending',
      reason: incompleteReason
    })
  }
  if (candidates.length) {
    const commitInput: ArtifactVersionCommitInputV1 = {
      idempotencyKey: idempotencyKey(context, candidates),
      candidates
    }
    try {
      const result = await commitPort(context.workspaceRoot).commit(commitInput)
      if (!result.ok) {
        return withProjection(input, { status: 'failed', issue: result.issue })
      }
      records.push(...result.value.versions.map((item) => ({
        ref: item.ref,
        artifact: item.artifact,
        version: item.version,
        kind: item.artifact.kind,
        ...(item.version.storage.mode === 'reference'
          ? { locator: item.version.storage.locator }
          : {}),
        observedAt: result.value.committedAt
      })))
      return withProjection(input, {
        status: 'ready',
        versions: records,
        lifecycleEvents: result.value.events
      })
    } catch (error) {
      return withProjection(input, {
        status: 'failed',
        issue: {
          code: 'io-failure',
          message: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }
  if (records.length) {
    return withProjection(input, {
      status: 'ready',
      versions: records,
      lifecycleEvents: []
    })
  }
  return input
}

type VerifiedArtifactVersionRef =
  | Readonly<{ ok: true; record: EvidenceDagArtifactVersionRecordV1 }>
  | Readonly<{ ok: false; issue: ArtifactVersionIssueV1 }>

async function verifyArtifactVersionRef(
  expectedRef: ArtifactVersionRefV1,
  workspaceRoot: string,
  readPort: (workspaceRoot: string) => ArtifactVersionReadPortV1
): Promise<VerifiedArtifactVersionRef> {
  try {
    const result = await readPort(workspaceRoot).read({ versionId: expectedRef.versionId })
    if (!result.ok) return { ok: false, issue: result.issue }
    if (stableJson(result.value.ref) !== stableJson(expectedRef)) {
      return {
        ok: false,
        issue: {
          code: 'content-mismatch',
          message: `Artifact version ${expectedRef.versionId} does not match its canonical reference.`
        }
      }
    }
    const bytes = Buffer.from(result.value.dataBase64, 'base64')
    const contentDigest = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== expectedRef.byteLength || contentDigest !== expectedRef.contentDigest) {
      return {
        ok: false,
        issue: {
          code: 'content-mismatch',
          message: `Artifact version ${expectedRef.versionId} bytes do not match its canonical reference.`
        }
      }
    }
    return {
      ok: true,
      record: {
        ref: result.value.ref,
        artifact: result.value.artifact,
        version: result.value.version,
        kind: result.value.artifact.kind,
        ...(result.value.version.storage.mode === 'reference'
          ? { locator: result.value.version.storage.locator }
          : {}),
        observedAt: result.value.version.createdAt
      }
    }
  } catch (error) {
    return {
      ok: false,
      issue: {
        code: 'io-failure',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

function withProjection(
  input: Readonly<Record<string, unknown>>,
  projection: EvidenceDagArtifactVersionProjectionV1
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...structuredClone(input) as Record<string, unknown>,
    evidenceArtifactVersions: evidenceDagArtifactVersionProjectionV1Schema.parse(projection)
  })
}

function artifactDescriptors(input: Readonly<Record<string, unknown>>): Record<string, unknown>[] {
  const descriptors: Record<string, unknown>[] = []
  const direct = record(input.artifact)
  if (direct) descriptors.push(direct)
  if (
    'artifactVersionRef' in input || 'locator' in input || 'contentDigest' in input ||
    'content_digest' in input
  ) {
    descriptors.push(input as Record<string, unknown>)
  }
  const payload = decodedRecord(input.output) ?? decodedRecord(input.content) ?? record(input.result)
  const lineage = explicitEvidenceLineage(payload)
  if (lineage) {
    for (const key of ['inputs', 'software', 'logs', 'outputs']) {
      const values = Array.isArray(lineage[key]) ? lineage[key] : []
      for (const value of values) {
        const artifact = record(record(value)?.artifact)
        if (artifact) descriptors.push(artifact)
      }
    }
    const environment = lineage.environment
    const environments = Array.isArray(environment) ? environment : [environment]
    for (const value of environments) {
      const artifact = record(record(value)?.artifact)
      if (artifact) descriptors.push(artifact)
    }
  }
  const unique = new Map<string, Record<string, unknown>>()
  for (const descriptor of descriptors) {
    const key = stableJson(descriptor)
    unique.set(key, descriptor)
  }
  return [...unique.values()].slice(0, 128)
}

function explicitEvidenceLineage(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  let current = value
  for (let depth = 0; current && depth < 4; depth += 1) {
    const direct = record(current.evidenceLineage) ?? record(current.evidence_lineage)
    if (direct) return direct
    const metadata = record(current.metadata)
    const inMetadata = record(metadata?.evidenceLineage) ?? record(metadata?.evidence_lineage)
    if (inMetadata) return inMetadata
    current = decodedRecord(current.output)
      ?? decodedRecord(current.result)
      ?? decodedRecord(current.value)
  }
  return undefined
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, sortJson(object[key])])
  )
}

function idempotencyKey(
  context: EvidenceArtifactVersionPinContext,
  candidates: readonly ArtifactVersionCommitCandidateV1[]
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(candidates))
    .digest('hex')
  return `evidence-dag:${context.runtimeId}:${context.threadId}:${context.operationId}:${digest}`
}

function candidateId(operationId: string, index: number, locator: string, digest: string): string {
  return `evidence:${createHash('sha256')
    .update(`${operationId}|${index}|${locator}|${digest}`)
    .digest('hex')
    .slice(0, 32)}`
}

function normalizedKind(value: unknown): string {
  const normalized = text(value)?.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-') ?? 'other'
  return /^[a-z][a-z0-9._-]{0,63}$/u.test(normalized) ? normalized : 'other'
}

function bareSha256(value: unknown): string | undefined {
  const raw = text(value)?.toLowerCase().replace(/^sha256:/u, '')
  return raw && /^[a-f0-9]{64}$/u.test(raw) ? raw : undefined
}

function availability(value: unknown): 'available' | 'missing' | 'remote' | undefined {
  return value === 'available' || value === 'missing' || value === 'remote' ? value : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function decodedRecord(value: unknown): Record<string, unknown> | undefined {
  const direct = record(value)
  if (direct) return direct
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return undefined
  try {
    return record(JSON.parse(value))
  } catch {
    return undefined
  }
}
