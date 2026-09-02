import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  artifactVersionRefV1Schema,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { z } from 'zod'
import type {
  EvidenceDagAppendResult,
  EvidenceDagTraceAppendInput
} from './evidence-delta.js'

const identifierSchema = z.string().trim().min(1).max(256)
const operationIdSchema = z.string()
  .trim()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const timestampSchema = z.iso.datetime({ offset: true })
const MAX_PRODUCER_RECEIPT_BYTES = 16 * 1024 * 1024

const evidenceArtifactSchema = z.object({
  kind: z.string().trim().min(1).max(256),
  locator: z.string().trim().min(1).max(8_192),
  contentDigest: sha256Schema,
  size: z.number().int().nonnegative(),
  mediaType: z.string().trim().min(1).max(256).optional(),
  retention: artifactVersionRefV1Schema.shape.retention,
  accessPolicy: artifactVersionRefV1Schema.shape.accessPolicy,
  artifactVersionRef: artifactVersionRefV1Schema
}).strict()

export const scientificPlotEvidenceLineageV1Schema = z.object({
  activity: z.object({
    id: identifierSchema,
    type: z.literal('analysis_run'),
    name: z.string().trim().min(1).max(1_000),
    status: z.literal('completed'),
    parameters: z.record(z.string().trim().min(1).max(256), z.unknown()),
    stochastic: z.boolean().optional(),
    randomSeed: z.number().int().safe().optional()
  }).strict(),
  inputs: z.array(z.object({
    id: identifierSchema,
    type: z.literal('dataset_version'),
    name: z.string().trim().min(1).max(1_000),
    artifact: evidenceArtifactSchema.optional(),
    provenanceBreakpoint: z.string().trim().min(1).max(4_000).optional()
  }).strict()).max(1_024),
  software: z.array(z.object({
    id: identifierSchema,
    type: z.literal('software_version'),
    name: z.string().trim().min(1).max(1_000),
    version: z.string().trim().min(1).max(512).optional(),
    contentDigest: sha256Schema
  }).strict()).max(1_024),
  environment: z.object({
    id: identifierSchema,
    type: z.literal('environment'),
    name: z.string().trim().min(1).max(1_000),
    contentDigest: sha256Schema,
    pythonVersion: z.string().trim().min(1).max(512),
    packages: z.record(
      z.string().trim().min(1).max(256),
      z.string().trim().min(1).max(512)
    ),
    fontFingerprint: sha256Schema
  }).strict(),
  logs: z.array(z.object({
    id: identifierSchema,
    type: z.literal('artifact'),
    name: z.string().trim().min(1).max(1_000),
    artifact: evidenceArtifactSchema
  }).strict()).max(1_024),
  outputs: z.array(z.object({
    id: identifierSchema,
    type: z.enum(['artifact', 'dataset_version']),
    name: z.string().trim().min(1).max(1_000),
    artifact: evidenceArtifactSchema
  }).strict()).max(1_024),
  relations: z.array(z.object({
    src: identifierSchema,
    dst: identifierSchema,
    rel: z.enum(['replicates', 'fails_to_replicate', 'derived_from'])
  }).strict()).max(4_096)
}).strict()

const scientificPlottingCommitRefsSchema = z.object({
  derivedData: artifactVersionRefV1Schema,
  recipe: artifactVersionRefV1Schema,
  figure: artifactVersionRefV1Schema,
  renderManifest: artifactVersionRefV1Schema,
  attemptLog: artifactVersionRefV1Schema
}).strict()

export const scientificPlottingProvenanceReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  producer: z.literal('scientific-plotting'),
  operationId: operationIdSchema,
  state: z.literal('pending'),
  createdAt: timestampSchema,
  runtimeId: identifierSchema.optional(),
  threadId: identifierSchema.optional(),
  commitRefs: scientificPlottingCommitRefsSchema,
  evidenceLineage: scientificPlotEvidenceLineageV1Schema
}).strict().superRefine((value, context) => {
  if (Boolean(value.runtimeId) !== Boolean(value.threadId)) {
    context.addIssue({
      code: 'custom',
      path: value.runtimeId ? ['threadId'] : ['runtimeId'],
      message: 'runtimeId and threadId must be provided together.'
    })
  }
})

export const scientificPlottingEvidenceDeliveryReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  consumer: z.literal('evidence-dag'),
  producer: z.literal('scientific-plotting'),
  operationId: operationIdSchema,
  state: z.literal('committed'),
  createdAt: timestampSchema,
  runtimeId: identifierSchema,
  threadId: identifierSchema,
  // Evidence delta identities use the public prefixed digest form while
  // embedded Artifact content digests remain bare SHA-256 hex strings.
  deltaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  sourceDigest: sha256Schema
}).strict()

export type ScientificPlottingProvenanceReceiptV1 = z.infer<
  typeof scientificPlottingProvenanceReceiptV1Schema
>
export type ScientificPlottingEvidenceDeliveryReceiptV1 = z.infer<
  typeof scientificPlottingEvidenceDeliveryReceiptV1Schema
>

export type ScientificPlottingProvenancePreparation = Readonly<{
  runtimeId: string
  threadId: string
  workspaceRoot: string
  targetWatermark: string
  trace: readonly Readonly<Record<string, unknown>>[]
}>

const DEFAULT_POLL_INTERVAL_MS = 15_000

/**
 * Durable, workspace-scoped bridge from Scientific Plotting into Evidence DAG.
 *
 * Plotting owns immutable pending producer receipts. Evidence owns the delta
 * append and delivery receipt. If the process stops between those writes, the
 * producer receipt is replayed and the delta idempotency key returns the same
 * committed identity.
 */
export class ScientificPlottingProvenanceConsumer {
  private enabled = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private draining: Promise<void> | undefined

  constructor(private readonly options: Readonly<{
    discoverWorkspaces: () => Promise<readonly string[]>
    prepare: (
      workspaceRoot: string,
      receipt: ScientificPlottingProvenanceReceiptV1
    ) => Promise<ScientificPlottingProvenancePreparation>
    append: (input: EvidenceDagTraceAppendInput) => Promise<EvidenceDagAppendResult>
    afterAppend?: (
      prepared: ScientificPlottingProvenancePreparation,
      receipt: ScientificPlottingProvenanceReceiptV1
    ) => Promise<void>
    now?: () => Date
    pollIntervalMs?: number
    log?: (entry: Readonly<{ level: 'debug' | 'warn'; message: string; detail?: unknown }>) => void
  }>) {}

  async start(enabled: boolean): Promise<void> {
    this.enabled = enabled
    if (enabled) this.schedule(0)
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    if (!enabled && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
      return
    }
    if (enabled) this.schedule(0)
  }

  requestPoll(): void {
    if (!this.enabled || this.closed) return
    this.schedule(0, true)
  }

  async pollNow(): Promise<void> {
    if (!this.enabled || this.closed) return
    if (this.draining) return this.draining
    const work = this.drain()
    this.draining = work
    try {
      await work
    } finally {
      if (this.draining === work) this.draining = undefined
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.enabled = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.draining
  }

  private async drain(): Promise<void> {
    let workspaces: readonly string[]
    try {
      workspaces = await this.options.discoverWorkspaces()
    } catch (error) {
      this.warn('Evidence DAG could not discover workspaces for Scientific Plotting provenance.', error)
      return
    }
    for (const workspaceRoot of uniqueResolved(workspaces)) {
      if (this.closed || !this.enabled) return
      let sources: readonly ProducerReceiptFile[]
      try {
        sources = await producerReceipts(workspaceRoot)
      } catch (error) {
        this.warn(`Evidence DAG could not inspect Scientific Plotting provenance in ${workspaceRoot}.`, error)
        continue
      }
      for (const source of sources) {
        if (this.closed || !this.enabled) return
        if ('issue' in source) {
          this.warn(
            `Evidence DAG kept Scientific Plotting provenance ${source.fileName} pending.`,
            new Error(source.issue)
          )
          continue
        }
        try {
          await this.deliver(workspaceRoot, source)
        } catch (error) {
          this.warn(
            `Evidence DAG kept Scientific Plotting provenance ${source.fileName} pending.`,
            error
          )
        }
      }
    }
  }

  private async deliver(workspaceRoot: string, source: ValidProducerReceiptFile): Promise<void> {
    const parsed = scientificPlottingProvenanceReceiptV1Schema.parse(
      JSON.parse(source.bytes.toString('utf8'))
    )
    if (source.fileName !== scientificPlottingReceiptFileName(parsed.operationId)) {
      throw new Error('Scientific Plotting provenance filename does not match operationId.')
    }
    if (parsed.state !== 'pending') {
      throw new Error('Evidence DAG only consumes immutable pending producer receipts.')
    }
    if (!parsed.runtimeId || !parsed.threadId) {
      throw new Error('Scientific Plotting provenance has no target Evidence thread.')
    }
    assertLineageIntegrity(parsed)

    const sourceDigest = createHash('sha256').update(source.bytes).digest('hex')
    const deliveryPath = scientificPlottingDeliveryReceiptPath(workspaceRoot, parsed.operationId)
    const existingDelivery = await optionalWorkspaceJson(workspaceRoot, deliveryPath)
    if (existingDelivery !== undefined) {
      const delivery = scientificPlottingEvidenceDeliveryReceiptV1Schema.safeParse(existingDelivery)
      if (delivery.success) {
        assertDeliveryMatches(delivery.data, parsed, sourceDigest)
        return
      }
      throw new Error('Evidence delivery receipt has an unsupported format.')
    }
    const prepared = await this.options.prepare(workspaceRoot, parsed)
    assertPreparedTarget(prepared, workspaceRoot, parsed)
    const appended = await this.options.append({
        idempotencyKey: `scientific-plotting/provenance-delivery:${resolve(workspaceRoot)}:${parsed.operationId}`,
        runtimeId: prepared.runtimeId,
        threadId: prepared.threadId,
        operationId: parsed.operationId,
        kind: 'scientific_provenance',
        requestedWatermark: `${prepared.targetWatermark}:scientific-plotting/provenance:${sourceDigest.slice(0, 16)}`,
        eventKind: 'scientific_plotting_provenance',
        trace: prepared.trace,
        workspaceRoot: prepared.workspaceRoot
      })
    await this.options.afterAppend?.(prepared, parsed)
    await writeWorkspaceJsonAtomic(
      workspaceRoot,
      deliveryPath,
      scientificPlottingEvidenceDeliveryReceiptV1Schema.parse({
        schemaVersion: 1,
        consumer: 'evidence-dag',
        producer: 'scientific-plotting',
        operationId: parsed.operationId,
        state: 'committed',
        createdAt: this.nowIso(),
        runtimeId: parsed.runtimeId,
        threadId: parsed.threadId,
        deltaDigest: appended.delta.deltaDigest,
        sourceDigest
      })
    )
  }

  private schedule(delayMs: number, replace = false): void {
    if (this.closed || !this.enabled) return
    if (this.timer && !replace) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.pollNow().finally(() => {
        if (!this.closed && this.enabled) {
          this.schedule(this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
        }
      })
    }, Math.max(0, delayMs))
    this.timer.unref?.()
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }

  private warn(message: string, error: unknown): void {
    this.options.log?.({
      level: 'warn',
      message,
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}

export function scientificPlottingEvidenceTraceItem(
  receipt: ScientificPlottingProvenanceReceiptV1
): Readonly<Record<string, unknown>> {
  const id = `scientific-plotting/provenance:${receipt.operationId}`
  return Object.freeze({
    id,
    source_item_id: id,
    type: 'tool_result',
    tool_name: 'scientific_plotting.render',
    evidenceLineage: structuredClone(receipt.evidenceLineage),
    scientificPlottingProvenance: {
      schemaVersion: receipt.schemaVersion,
      producer: receipt.producer,
      operationId: receipt.operationId,
      commitRefs: structuredClone(receipt.commitRefs),
      createdAt: receipt.createdAt
    }
  })
}

export function scientificPlottingReceiptArtifactRefs(
  receipt: ScientificPlottingProvenanceReceiptV1
): readonly ArtifactVersionRefV1[] {
  const refs = [
    ...Object.values(receipt.commitRefs),
    ...receipt.evidenceLineage.inputs.flatMap((item) => item.artifact
      ? [item.artifact.artifactVersionRef]
      : []),
    ...receipt.evidenceLineage.logs.map((item) => item.artifact.artifactVersionRef),
    ...receipt.evidenceLineage.outputs.map((item) => item.artifact.artifactVersionRef)
  ]
  const unique = new Map<string, ArtifactVersionRefV1>()
  for (const ref of refs) {
    const existing = unique.get(ref.versionId)
    if (existing && stableJson(existing) !== stableJson(ref)) {
      throw new Error(
        `Scientific Plotting provenance contains conflicting refs for ${ref.versionId}.`
      )
    }
    unique.set(ref.versionId, ref)
  }
  return [...unique.values()]
}

export function scientificPlottingDeliveryReceiptPath(
  workspaceRoot: string,
  operationId: string
): string {
  const safeOperationId = operationIdSchema.parse(operationId)
  return join(
    resolve(workspaceRoot),
    '.sciforge',
    'evidence-dag',
    'delivery-receipts',
    'scientific-plotting',
    scientificPlottingReceiptFileName(safeOperationId)
  )
}

export function scientificPlottingReceiptFileName(operationId: string): string {
  const safeOperationId = operationIdSchema.parse(operationId)
  return `${createHash('sha256').update(safeOperationId).digest('hex')}.json`
}

function assertLineageIntegrity(receipt: ScientificPlottingProvenanceReceiptV1): void {
  const committed = receipt.commitRefs
  const uniqueCommitted = new Set(Object.values(committed).map((ref) => ref.versionId))
  if (uniqueCommitted.size !== 5) {
    throw new Error('Scientific Plotting provenance must reference five distinct committed versions.')
  }
  const logVersions = new Set(
    receipt.evidenceLineage.logs.map((item) => item.artifact.artifactVersionRef.versionId)
  )
  const outputVersions = new Set(
    receipt.evidenceLineage.outputs.map((item) => item.artifact.artifactVersionRef.versionId)
  )
  if (!logVersions.has(committed.attemptLog.versionId)) {
    throw new Error('Scientific Plotting attemptLog commit ref is absent from Evidence lineage logs.')
  }
  for (const [role, ref] of Object.entries(committed)) {
    if (role !== 'attemptLog' && !outputVersions.has(ref.versionId)) {
      throw new Error(`Scientific Plotting ${role} commit ref is absent from Evidence lineage outputs.`)
    }
  }
  const knownIds = new Set([
    receipt.evidenceLineage.activity.id,
    ...receipt.evidenceLineage.inputs.map((item) => item.id),
    ...receipt.evidenceLineage.software.map((item) => item.id),
    receipt.evidenceLineage.environment.id,
    ...receipt.evidenceLineage.logs.map((item) => item.id),
    ...receipt.evidenceLineage.outputs.map((item) => item.id)
  ])
  for (const relation of receipt.evidenceLineage.relations) {
    if (!knownIds.has(relation.src) || !knownIds.has(relation.dst)) {
      throw new Error('Scientific Plotting Evidence lineage contains a dangling relation.')
    }
  }
  for (const item of [
    ...receipt.evidenceLineage.inputs.flatMap((value) => value.artifact ? [value.artifact] : []),
    ...receipt.evidenceLineage.logs.map((value) => value.artifact),
    ...receipt.evidenceLineage.outputs.map((value) => value.artifact)
  ]) {
    const ref = item.artifactVersionRef
    if (
      item.contentDigest !== ref.contentDigest ||
      item.size !== ref.byteLength ||
      item.retention !== ref.retention ||
      stableJson(item.accessPolicy) !== stableJson(ref.accessPolicy) ||
      item.mediaType !== ref.mediaType
    ) {
      throw new Error('Scientific Plotting Evidence artifact does not match its exact version ref.')
    }
  }
}

function assertPreparedTarget(
  prepared: ScientificPlottingProvenancePreparation,
  workspaceRoot: string,
  receipt: ScientificPlottingProvenanceReceiptV1
): void {
  if (
    resolve(prepared.workspaceRoot) !== resolve(workspaceRoot) ||
    prepared.runtimeId !== receipt.runtimeId ||
    prepared.threadId !== receipt.threadId
  ) {
    throw new Error('Scientific Plotting provenance target escaped its workspace or thread.')
  }
  if (!prepared.trace.length) {
    throw new Error('Scientific Plotting provenance did not produce a structured Evidence trace.')
  }
}

function assertDeliveryMatches(
  delivery: ScientificPlottingEvidenceDeliveryReceiptV1,
  receipt: ScientificPlottingProvenanceReceiptV1,
  sourceDigest: string
): void {
  if (
    delivery.operationId !== receipt.operationId ||
    delivery.runtimeId !== receipt.runtimeId ||
    delivery.threadId !== receipt.threadId ||
    delivery.sourceDigest !== sourceDigest
  ) {
    throw new Error('Evidence delivery receipt does not match its Scientific Plotting source.')
  }
}

type ValidProducerReceiptFile = Readonly<{ fileName: string; bytes: Buffer }>
type ProducerReceiptFile =
  | ValidProducerReceiptFile
  | Readonly<{ fileName: string; issue: string }>

async function producerReceipts(workspaceRoot: string): Promise<readonly ProducerReceiptFile[]> {
  const resolvedWorkspace = resolve(workspaceRoot)
  const inbox = join(
    resolvedWorkspace,
    '.sciforge',
    'evidence-dag',
    'inbox',
    'scientific-plotting'
  )
  let entries
  try {
    entries = await readdir(inbox, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  const workspaceReal = await realpath(resolvedWorkspace)
  const files: ProducerReceiptFile[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    const path = join(inbox, entry.name)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) continue
    if (stat.size > MAX_PRODUCER_RECEIPT_BYTES) {
      files.push({
        fileName: entry.name,
        issue: `Scientific Plotting provenance receipt ${entry.name} exceeds 16 MiB.`
      })
      continue
    }
    const fileReal = await realpath(path)
    if (!isInside(workspaceReal, fileReal)) {
      throw new Error('Scientific Plotting provenance receipt escapes the workspace.')
    }
    files.push({ fileName: basename(path), bytes: await readFile(path) })
  }
  return files
}

async function optionalWorkspaceJson(
  workspaceRoot: string,
  path: string
): Promise<unknown | undefined> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Evidence delivery receipt is not a regular file.')
    }
    if (stat.size > 1024 * 1024) {
      throw new Error('Evidence delivery receipt exceeds 1 MiB.')
    }
    const [workspaceReal, fileReal] = await Promise.all([
      realpath(resolve(workspaceRoot)),
      realpath(path)
    ])
    if (!isInside(workspaceReal, fileReal)) {
      throw new Error('Evidence delivery receipt escapes the workspace.')
    }
    return JSON.parse(await readFile(fileReal, 'utf8'))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

async function writeWorkspaceJsonAtomic(
  workspaceRoot: string,
  path: string,
  value: unknown
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const [workspaceReal, directoryReal] = await Promise.all([
    realpath(resolve(workspaceRoot)),
    realpath(dirname(path))
  ])
  if (!isInside(workspaceReal, directoryReal)) {
    throw new Error('Evidence delivery receipt directory escapes the workspace.')
  }
  await writeJsonAtomic(path, value)
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

function uniqueResolved(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => resolve(value)))].sort()
}

function isInside(parent: string, child: string): boolean {
  const fragment = relative(parent, child)
  return fragment !== '' && fragment !== '..' &&
    !fragment.startsWith(`..${sep}`) && !isAbsolute(fragment)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}
