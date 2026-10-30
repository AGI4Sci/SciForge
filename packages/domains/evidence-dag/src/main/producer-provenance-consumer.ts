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
import {
  evidenceLineageV1Schema,
  evidenceOperationIdSchema,
  evidenceProducerDeliveryReceiptV1Schema,
  evidenceProducerIdSchema,
  evidenceProducerReceiptV1Schema,
  type EvidenceProducerDeliveryReceiptV1
} from '../producer-receipt.js'
import { evidenceProducerReceiptFileName } from '../producer-inbox.js'
import type {
  EvidenceDagAppendResult,
  EvidenceDagTraceAppendInput
} from './evidence-delta.js'

const MAX_PRODUCER_RECEIPT_BYTES = 16 * 1024 * 1024

export {
  evidenceLineageV1Schema,
  evidenceProducerDeliveryReceiptV1Schema,
  evidenceProducerReceiptV1Schema,
  type EvidenceProducerDeliveryReceiptV1
}

export type EvidenceProducerReceipt = Readonly<{
  producer: string
  operationId: string
  createdAt: string
  runtimeId?: string
  threadId?: string
  artifactRefs: readonly ArtifactVersionRefV1[]
  traceItem: Readonly<Record<string, unknown>>
}>

/** Parses and validates one producer's receipt file; throws on any violation. */
export type EvidenceProducerReceiptAdapter = (value: unknown) => EvidenceProducerReceipt

export type EvidenceProducerPreparation = Readonly<{
  runtimeId: string
  threadId: string
  workspaceRoot: string
  targetWatermark: string
  trace: readonly Readonly<Record<string, unknown>>[]
}>

/** Adapter for the producer-neutral receipt; used for every producer without its own. */
export function parseEvidenceProducerReceipt(
  producer: string,
  value: unknown
): EvidenceProducerReceipt {
  const receipt = evidenceProducerReceiptV1Schema.parse(value)
  if (receipt.producer !== producer) {
    throw new Error('Evidence producer receipt does not match its inbox directory.')
  }
  const committed = Object.values(receipt.commitRefs)
  if (new Set(committed.map((ref) => ref.versionId)).size !== committed.length) {
    throw new Error('Evidence producer receipt must reference distinct committed versions.')
  }
  assertLineageIntegrity(receipt.evidenceLineage)
  const lineageVersions = new Set([
    ...receipt.evidenceLineage.logs.map((item) => item.artifact.artifactVersionRef.versionId),
    ...receipt.evidenceLineage.outputs.map((item) => item.artifact.artifactVersionRef.versionId)
  ])
  for (const [role, ref] of Object.entries(receipt.commitRefs)) {
    if (!lineageVersions.has(ref.versionId)) {
      throw new Error(`Evidence producer ${role} commit ref is absent from the lineage logs and outputs.`)
    }
  }
  const id = `${producer}/provenance:${receipt.operationId}`
  return {
    producer,
    operationId: receipt.operationId,
    createdAt: receipt.createdAt,
    ...(receipt.runtimeId && receipt.threadId
      ? { runtimeId: receipt.runtimeId, threadId: receipt.threadId }
      : {}),
    artifactRefs: lineageArtifactRefs(receipt.evidenceLineage, committed),
    traceItem: Object.freeze({
      id,
      source_item_id: id,
      type: 'tool_result',
      tool_name: receipt.toolName,
      evidenceLineage: structuredClone(receipt.evidenceLineage),
      producerProvenance: {
        schemaVersion: receipt.schemaVersion,
        producer,
        operationId: receipt.operationId,
        commitRefs: structuredClone(receipt.commitRefs),
        createdAt: receipt.createdAt
      }
    })
  }
}

/** Every exact version a receipt names, deduplicated; conflicting duplicates throw. */
export function lineageArtifactRefs(
  lineage: z.infer<typeof evidenceLineageV1Schema>,
  committed: readonly ArtifactVersionRefV1[] = []
): readonly ArtifactVersionRefV1[] {
  const refs = [
    ...committed,
    ...lineage.inputs.flatMap((item) => item.artifact ? [item.artifact.artifactVersionRef] : []),
    ...lineage.logs.map((item) => item.artifact.artifactVersionRef),
    ...lineage.outputs.map((item) => item.artifact.artifactVersionRef)
  ]
  const unique = new Map<string, ArtifactVersionRefV1>()
  for (const ref of refs) {
    const existing = unique.get(ref.versionId)
    if (existing && stableJson(existing) !== stableJson(ref)) {
      throw new Error(`Evidence provenance contains conflicting refs for ${ref.versionId}.`)
    }
    unique.set(ref.versionId, ref)
  }
  return [...unique.values()]
}

const DEFAULT_POLL_INTERVAL_MS = 15_000

/**
 * Durable, workspace-scoped bridge from producer packages into Evidence DAG.
 *
 * A producer owns immutable pending receipts under
 * `.sciforge/evidence-dag/inbox/<producer>/`. Evidence owns the delta append and
 * the delivery receipt. If the process stops between those writes, the producer
 * receipt is replayed and the delta idempotency key returns the same committed
 * identity. A producer without its own adapter uses the producer-neutral receipt.
 */
export class EvidenceProducerProvenanceConsumer {
  private enabled = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private draining: Promise<void> | undefined

  constructor(private readonly options: Readonly<{
    discoverWorkspaces: () => Promise<readonly string[]>
    adapters?: ReadonlyMap<string, EvidenceProducerReceiptAdapter>
    prepare: (
      workspaceRoot: string,
      receipt: EvidenceProducerReceipt
    ) => Promise<EvidenceProducerPreparation>
    append: (input: EvidenceDagTraceAppendInput) => Promise<EvidenceDagAppendResult>
    afterAppend?: (
      prepared: EvidenceProducerPreparation,
      receipt: EvidenceProducerReceipt
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
      this.warn('Evidence DAG could not discover workspaces for producer provenance.', error)
      return
    }
    for (const workspaceRoot of uniqueResolved(workspaces)) {
      if (this.closed || !this.enabled) return
      let producers: readonly string[]
      try {
        producers = await producerDirectories(workspaceRoot)
      } catch (error) {
        this.warn(`Evidence DAG could not inspect producer provenance in ${workspaceRoot}.`, error)
        continue
      }
      for (const producer of producers) {
        let sources: readonly ProducerReceiptFile[]
        try {
          sources = await producerReceipts(workspaceRoot, producer)
        } catch (error) {
          this.warn(`Evidence DAG could not inspect ${producer} provenance in ${workspaceRoot}.`, error)
          continue
        }
        for (const source of sources) {
          if (this.closed || !this.enabled) return
          if ('issue' in source) {
            this.warn(
              `Evidence DAG kept ${producer} provenance ${source.fileName} pending.`,
              new Error(source.issue)
            )
            continue
          }
          try {
            await this.deliver(workspaceRoot, producer, source)
          } catch (error) {
            this.warn(`Evidence DAG kept ${producer} provenance ${source.fileName} pending.`, error)
          }
        }
      }
    }
  }

  private async deliver(
    workspaceRoot: string,
    producer: string,
    source: ValidProducerReceiptFile
  ): Promise<void> {
    const adapter = this.options.adapters?.get(producer)
    const value: unknown = JSON.parse(source.bytes.toString('utf8'))
    const receipt = adapter ? adapter(value) : parseEvidenceProducerReceipt(producer, value)
    if (receipt.producer !== producer) {
      throw new Error('Producer provenance does not match its inbox directory.')
    }
    if (source.fileName !== evidenceProducerReceiptFileName(receipt.operationId)) {
      throw new Error('Producer provenance filename does not match operationId.')
    }
    if (!receipt.runtimeId || !receipt.threadId) {
      throw new Error('Producer provenance has no target Evidence thread.')
    }

    const sourceDigest = createHash('sha256').update(source.bytes).digest('hex')
    const deliveryPath = evidenceProducerDeliveryReceiptPath(
      workspaceRoot,
      producer,
      receipt.operationId
    )
    const existingDelivery = await optionalWorkspaceJson(workspaceRoot, deliveryPath)
    if (existingDelivery !== undefined) {
      const delivery = evidenceProducerDeliveryReceiptV1Schema.safeParse(existingDelivery)
      if (delivery.success) {
        assertDeliveryMatches(delivery.data, receipt, sourceDigest)
        return
      }
      throw new Error('Evidence delivery receipt has an unsupported format.')
    }
    const prepared = await this.options.prepare(workspaceRoot, receipt)
    assertPreparedTarget(prepared, workspaceRoot, receipt)
    const appended = await this.options.append({
      idempotencyKey: `${producer}/provenance-delivery:${resolve(workspaceRoot)}:${receipt.operationId}`,
      runtimeId: prepared.runtimeId,
      threadId: prepared.threadId,
      operationId: receipt.operationId,
      kind: 'scientific_provenance',
      requestedWatermark: `${prepared.targetWatermark}:${producer}/provenance:${sourceDigest.slice(0, 16)}`,
      eventKind: `${producer.replaceAll('-', '_')}_provenance`,
      trace: prepared.trace,
      workspaceRoot: prepared.workspaceRoot
    })
    await this.options.afterAppend?.(prepared, receipt)
    await writeWorkspaceJsonAtomic(
      workspaceRoot,
      deliveryPath,
      evidenceProducerDeliveryReceiptV1Schema.parse({
        schemaVersion: 1,
        consumer: 'evidence-dag',
        producer,
        operationId: receipt.operationId,
        state: 'committed',
        createdAt: this.nowIso(),
        runtimeId: receipt.runtimeId,
        threadId: receipt.threadId,
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

export function evidenceProducerDeliveryReceiptPath(
  workspaceRoot: string,
  producer: string,
  operationId: string
): string {
  return join(
    resolve(workspaceRoot),
    '.sciforge',
    'evidence-dag',
    'delivery-receipts',
    evidenceProducerIdSchema.parse(producer),
    evidenceProducerReceiptFileName(operationId)
  )
}

export { evidenceProducerReceiptFileName }

/** Relations must close over the lineage and every artifact must match its exact version ref. */
export function assertLineageIntegrity(
  lineage: z.infer<typeof evidenceLineageV1Schema>
): void {
  const knownIds = new Set([
    lineage.activity.id,
    ...lineage.inputs.map((item) => item.id),
    ...lineage.software.map((item) => item.id),
    ...(lineage.environment ? [lineage.environment.id] : []),
    ...lineage.logs.map((item) => item.id),
    ...lineage.outputs.map((item) => item.id)
  ])
  for (const relation of lineage.relations) {
    if (!knownIds.has(relation.src) || !knownIds.has(relation.dst)) {
      throw new Error('Evidence lineage contains a dangling relation.')
    }
  }
  for (const item of [
    ...lineage.inputs.flatMap((value) => value.artifact ? [value.artifact] : []),
    ...lineage.logs.map((value) => value.artifact),
    ...lineage.outputs.map((value) => value.artifact)
  ]) {
    const ref = item.artifactVersionRef
    if (
      item.contentDigest !== ref.contentDigest ||
      item.size !== ref.byteLength ||
      item.retention !== ref.retention ||
      stableJson(item.accessPolicy) !== stableJson(ref.accessPolicy) ||
      item.mediaType !== ref.mediaType
    ) {
      throw new Error('Evidence artifact does not match its exact version ref.')
    }
  }
}

function assertPreparedTarget(
  prepared: EvidenceProducerPreparation,
  workspaceRoot: string,
  receipt: EvidenceProducerReceipt
): void {
  if (
    resolve(prepared.workspaceRoot) !== resolve(workspaceRoot) ||
    prepared.runtimeId !== receipt.runtimeId ||
    prepared.threadId !== receipt.threadId
  ) {
    throw new Error('Producer provenance target escaped its workspace or thread.')
  }
  if (!prepared.trace.length) {
    throw new Error('Producer provenance did not produce a structured Evidence trace.')
  }
}

function assertDeliveryMatches(
  delivery: EvidenceProducerDeliveryReceiptV1,
  receipt: EvidenceProducerReceipt,
  sourceDigest: string
): void {
  if (
    delivery.operationId !== receipt.operationId ||
    delivery.runtimeId !== receipt.runtimeId ||
    delivery.threadId !== receipt.threadId ||
    delivery.sourceDigest !== sourceDigest
  ) {
    throw new Error('Evidence delivery receipt does not match its producer source.')
  }
}

type ValidProducerReceiptFile = Readonly<{ fileName: string; bytes: Buffer }>
type ProducerReceiptFile =
  | ValidProducerReceiptFile
  | Readonly<{ fileName: string; issue: string }>

async function producerDirectories(workspaceRoot: string): Promise<readonly string[]> {
  const inboxRoot = join(resolve(workspaceRoot), '.sciforge', 'evidence-dag', 'inbox')
  let entries
  try {
    entries = await readdir(inboxRoot, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() &&
      evidenceProducerIdSchema.safeParse(entry.name).success)
    .map((entry) => entry.name)
    .sort()
}

async function producerReceipts(
  workspaceRoot: string,
  producer: string
): Promise<readonly ProducerReceiptFile[]> {
  const resolvedWorkspace = resolve(workspaceRoot)
  const inbox = join(
    resolvedWorkspace,
    '.sciforge',
    'evidence-dag',
    'inbox',
    evidenceProducerIdSchema.parse(producer)
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
        issue: `Producer provenance receipt ${entry.name} exceeds 16 MiB.`
      })
      continue
    }
    const fileReal = await realpath(path)
    if (!isInside(workspaceReal, fileReal)) {
      throw new Error('Producer provenance receipt escapes the workspace.')
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
