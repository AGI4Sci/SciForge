import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import {
  evidenceProducerDeliveryReceiptV1Schema,
  type EvidenceProducerReceiptV1
} from '../contract.js'
import {
  EvidenceProducerProvenanceConsumer,
  evidenceProducerDeliveryReceiptPath,
  evidenceProducerReceiptFileName,
  type EvidenceProducerPreparation,
  type EvidenceProducerReceipt
} from './producer-provenance-consumer.js'
import {
  scientificPlottingReceiptAdapter,
  type ScientificPlottingProvenanceReceiptV1
} from './scientific-plotting-receipt-adapter.js'
import {
  EvidenceDagDeltaStore,
  evidenceDagDeltaInputFromTrace,
  type EvidenceDagAppendResult,
  type EvidenceDagTraceAppendInput
} from './evidence-delta.js'

test('delivers a strict Scientific Plotting lineage as a durable synthetic trace', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-plot-success-')))
  const receipt = plotReceipt('plot-operation-success-0001')
  await writeProducerReceipt(workspaceRoot, receipt)
  const appended: EvidenceDagTraceAppendInput[] = []
  const consumer = consumerFor({
    workspaceRoot,
    receipt,
    append: async (input) => {
      appended.push(input)
      return appendToStore(input, workspaceRoot)
    }
  })

  await consumer.start(true)
  await consumer.pollNow()
  await waitFor(async () =>
    await optionalDelivery(workspaceRoot, receipt.operationId) !== undefined
  )

  assert.equal(appended.length, 1)
  assert.equal(appended[0]?.idempotencyKey?.startsWith('scientific-plotting/provenance-delivery:'), true)
  assert.equal(appended[0]?.kind, 'scientific_provenance')
  assert.equal(appended[0]?.workspaceRoot, workspaceRoot)
  const synthetic = appended[0]?.trace.find((item) =>
    item.id === `scientific-plotting/provenance:${receipt.operationId}`
  )
  assert.deepEqual(synthetic?.evidenceLineage, receipt.evidenceLineage)
  const delivery = evidenceProducerDeliveryReceiptV1Schema.parse(
    await optionalDelivery(workspaceRoot, receipt.operationId)
  )
  assert.equal(delivery.state, 'committed')
  assert.equal(delivery.state === 'committed' && delivery.deltaDigest.startsWith('sha256:'), true)
  assert.equal(
    delivery.sourceDigest,
    createHash('sha256').update(await producerBytes(workspaceRoot, receipt.operationId)).digest('hex')
  )
  await consumer.close()
})

test('keeps receipts pending while the target thread or durable queue is unavailable', async () => {
  const missingThreadWorkspace = await realpath(await mkdtemp(join(tmpdir(), 'evidence-plot-thread-')))
  const missingServiceWorkspace = await realpath(await mkdtemp(join(tmpdir(), 'evidence-plot-service-')))
  const threadReceipt = plotReceipt('plot-operation-thread-0001')
  const serviceReceipt = plotReceipt('plot-operation-service-0001')
  await writeProducerReceipt(missingThreadWorkspace, threadReceipt)
  await writeProducerReceipt(missingServiceWorkspace, serviceReceipt)
  let appendCalls = 0
  const missingThread = new EvidenceProducerProvenanceConsumer({
    discoverWorkspaces: async () => [missingThreadWorkspace],
    prepare: async () => {
      throw new Error('Target thread is missing.')
    },
    append: async (input) => {
      appendCalls += 1
      return appendToStore(input, missingThreadWorkspace)
    }
  })
  await missingThread.start(true)
  await missingThread.pollNow()
  assert.equal(appendCalls, 0)
  assert.equal(await optionalDelivery(missingThreadWorkspace, threadReceipt.operationId), undefined)
  await missingThread.close()

  const missingService = consumerFor({
    workspaceRoot: missingServiceWorkspace,
    receipt: serviceReceipt,
    append: async () => {
      appendCalls += 1
      throw new Error('Durable Evidence delta store is unavailable.')
    }
  })
  await missingService.start(true)
  await missingService.pollNow()
  assert.equal(appendCalls, 1)
  assert.equal(await optionalDelivery(missingServiceWorkspace, serviceReceipt.operationId), undefined)
  await missingService.close()
})

test('recovers the enqueue-to-delivery crash window without a duplicate enqueue', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-plot-restart-')))
  const receipt = plotReceipt('plot-operation-restart-0001')
  await writeProducerReceipt(workspaceRoot, receipt)
  let firstAppends = 0
  const first = consumerFor({
    workspaceRoot,
    receipt,
    append: async (input) => {
      firstAppends += 1
      return appendToStore(input, workspaceRoot)
    },
    afterAppend: async () => {
      throw new Error('Simulated crash before delivery receipt.')
    }
  })
  await first.start(true)
  await first.pollNow()
  assert.equal(firstAppends, 1)
  assert.equal(await optionalDelivery(workspaceRoot, receipt.operationId), undefined)
  await first.close()

  let restartedAppends = 0
  const restarted = consumerFor({
    workspaceRoot,
    receipt,
    append: async (input) => {
      restartedAppends += 1
      return appendToStore(input, workspaceRoot)
    }
  })
  await restarted.start(true)
  await restarted.pollNow()
  await waitFor(async () =>
    await optionalDelivery(workspaceRoot, receipt.operationId) !== undefined
  )
  assert.equal(restartedAppends, 1)
  const delivery = evidenceProducerDeliveryReceiptV1Schema.parse(
    await optionalDelivery(workspaceRoot, receipt.operationId)
  )
  assert.equal(delivery.state === 'committed' && delivery.deltaDigest.startsWith('sha256:'), true)
  await restarted.close()
})

test('fails closed when a receipt resolves to a target in another workspace', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-plot-scope-a-')))
  const otherWorkspace = await realpath(await mkdtemp(join(tmpdir(), 'evidence-plot-scope-b-')))
  const receipt = plotReceipt('plot-operation-cross-workspace-0001')
  await writeProducerReceipt(workspaceRoot, receipt)
  let appendCalls = 0
  const consumer = consumerFor({
    workspaceRoot,
    receipt,
    prepare: async (_workspace, received) => preparation(otherWorkspace, received),
    append: async (input) => {
      appendCalls += 1
      return appendToStore(input, workspaceRoot)
    }
  })

  await consumer.start(true)
  await consumer.pollNow()
  assert.equal(appendCalls, 0)
  assert.equal(await optionalDelivery(workspaceRoot, receipt.operationId), undefined)
  await consumer.close()
})

test('fails closed on conflicting full refs for the same versionId', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-plot-ref-conflict-')))
  const receipt = plotReceipt('plot-operation-ref-conflict-0001')
  const conflictingRef: ArtifactVersionRefV1 = {
    ...receipt.commitRefs.figure,
    contentDigest: 'd'.repeat(64)
  }
  receipt.evidenceLineage.inputs.push({
    id: 'plot-input:conflicting-figure',
    type: 'dataset_version',
    name: 'Conflicting duplicate ref',
    artifact: {
      kind: 'dataset',
      locator: `snapshot:${conflictingRef.versionId}`,
      contentDigest: conflictingRef.contentDigest,
      size: conflictingRef.byteLength,
      ...(conflictingRef.mediaType ? { mediaType: conflictingRef.mediaType } : {}),
      retention: conflictingRef.retention,
      accessPolicy: conflictingRef.accessPolicy,
      artifactVersionRef: conflictingRef
    }
  })
  await writeProducerReceipt(workspaceRoot, receipt)
  let appendCalls = 0
  const consumer = consumerFor({
    workspaceRoot,
    receipt,
    append: async (input) => {
      appendCalls += 1
      return appendToStore(input, workspaceRoot)
    }
  })

  await consumer.start(true)
  await consumer.pollNow()
  assert.equal(appendCalls, 0)
  assert.equal(await optionalDelivery(workspaceRoot, receipt.operationId), undefined)
  await consumer.close()
})

test('delivers a producer-neutral receipt from an inbox directory with no adapter', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-generic-success-')))
  const receipt = genericReceipt('paper-radar', 'deepread-operation-success-0001')
  await writeProducerReceipt(workspaceRoot, receipt)
  const appended: EvidenceDagTraceAppendInput[] = []
  const consumer = consumerFor({
    workspaceRoot,
    receipt,
    append: async (input) => {
      appended.push(input)
      return appendToStore(input, workspaceRoot)
    }
  })

  await consumer.start(true)
  await consumer.pollNow()
  await waitFor(async () =>
    await optionalDelivery(workspaceRoot, receipt.operationId, 'paper-radar') !== undefined
  )

  assert.equal(appended.length, 1)
  assert.equal(appended[0]?.idempotencyKey?.startsWith('paper-radar/provenance-delivery:'), true)
  assert.equal(appended[0]?.eventKind, 'paper_radar_provenance')
  const delivery = evidenceProducerDeliveryReceiptV1Schema.parse(
    await optionalDelivery(workspaceRoot, receipt.operationId, 'paper-radar')
  )
  assert.equal(delivery.producer, 'paper-radar')
  assert.equal(
    delivery.sourceDigest,
    createHash('sha256')
      .update(await producerBytes(workspaceRoot, receipt.operationId, 'paper-radar'))
      .digest('hex')
  )
  await consumer.close()
})

test('rejects a producer-neutral receipt filed under another producer or with unlisted commit refs', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-generic-reject-')))
  const misfiled = genericReceipt('paper-radar', 'deepread-operation-misfiled-0001')
  const unlisted = genericReceipt('paper-radar', 'deepread-operation-unlisted-0001')
  unlisted.commitRefs.extra = versionRef('unlisted', 'not in lineage')
  await writeProducerReceipt(workspaceRoot, unlisted)
  const path = producerPath(workspaceRoot, misfiled.operationId, 'other-producer')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(misfiled), 'utf8')
  let appendCalls = 0
  const consumer = consumerFor({
    workspaceRoot,
    receipt: misfiled,
    append: async (input) => {
      appendCalls += 1
      return appendToStore(input, workspaceRoot)
    }
  })

  await consumer.start(true)
  await consumer.pollNow()
  assert.equal(appendCalls, 0)
  assert.equal(await optionalDelivery(workspaceRoot, misfiled.operationId, 'other-producer'), undefined)
  assert.equal(await optionalDelivery(workspaceRoot, unlisted.operationId, 'paper-radar'), undefined)
  await consumer.close()
})

function genericReceipt(producer: string, operationId: string): EvidenceProducerReceiptV1 {
  const plot = plotReceipt(operationId)
  return {
    schemaVersion: 1,
    producer,
    operationId,
    state: 'pending',
    createdAt: plot.createdAt,
    runtimeId: 'codex',
    threadId: 'thread-1',
    toolName: 'paper_radar.deep_read',
    commitRefs: { analysis: plot.commitRefs.recipe, log: plot.commitRefs.attemptLog },
    evidenceLineage: plot.evidenceLineage
  }
}

test('a persisted delivery receipt from the job-queue generation is read, not redelivered', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-legacy-delivery-')))
  const receipt = plotReceipt('plot-operation-legacy-0001')
  await writeProducerReceipt(workspaceRoot, receipt)
  const sourceDigest = createHash('sha256')
    .update(await producerBytes(workspaceRoot, receipt.operationId)).digest('hex')
  // The shape consumers wrote before 2026-09-02 (job queue): same schemaVersion, state enqueued.
  const path = evidenceProducerDeliveryReceiptPath(workspaceRoot, 'scientific-plotting', receipt.operationId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    consumer: 'evidence-dag',
    producer: 'scientific-plotting',
    operationId: receipt.operationId,
    state: 'enqueued',
    createdAt: '2026-08-20T00:00:00.000Z',
    runtimeId: 'codex',
    threadId: 'thread-1',
    jobId: 'evidence-job-legacy',
    sourceDigest
  }), 'utf8')
  const before = await readFile(path, 'utf8')
  let appendCalls = 0
  const warnings: string[] = []
  const consumer = new EvidenceProducerProvenanceConsumer({
    discoverWorkspaces: async () => [workspaceRoot],
    adapters: new Map([['scientific-plotting', scientificPlottingReceiptAdapter]]),
    prepare: async (workspace, received) => preparation(workspace, received),
    append: async (input) => { appendCalls += 1; return appendToStore(input, workspaceRoot) },
    log: (entry) => { if (entry.level === 'warn') warnings.push(entry.message) },
    pollIntervalMs: 60_000
  })
  await consumer.start(true)
  await consumer.pollNow()

  assert.equal(appendCalls, 0, 'a receipt already delivered is not appended again')
  assert.deepEqual(warnings, [], 'the legacy receipt is not reported as unsupported')
  assert.equal(await readFile(path, 'utf8'), before, 'the legacy receipt is left untouched')
  const parsed = evidenceProducerDeliveryReceiptV1Schema.parse(JSON.parse(before))
  assert.equal(parsed.state, 'enqueued')
  await consumer.close()
})

test('a delivery receipt in an unknown state is refused and the receipt stays pending', async () => {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'evidence-unknown-delivery-')))
  const receipt = plotReceipt('plot-operation-unknown-0001')
  await writeProducerReceipt(workspaceRoot, receipt)
  const path = evidenceProducerDeliveryReceiptPath(workspaceRoot, 'scientific-plotting', receipt.operationId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({ schemaVersion: 1, state: 'delivered' }), 'utf8')
  const warnings: string[] = []
  let appendCalls = 0
  const consumer = new EvidenceProducerProvenanceConsumer({
    discoverWorkspaces: async () => [workspaceRoot],
    adapters: new Map([['scientific-plotting', scientificPlottingReceiptAdapter]]),
    prepare: async (workspace, received) => preparation(workspace, received),
    append: async (input) => { appendCalls += 1; return appendToStore(input, workspaceRoot) },
    log: (entry) => { if (entry.level === 'warn') warnings.push(entry.message) },
    pollIntervalMs: 60_000
  })
  await consumer.start(true)
  await consumer.pollNow()
  assert.equal(appendCalls, 0)
  assert.equal(warnings.length, 1)
  await consumer.close()
})

test('a plotting receipt from before the code artifact existed is still accepted', async () => {
  const receipt = plotReceipt('plot-operation-oldshape-0001')
  // Older producers wrote no `code` ref and a fully populated environment.
  assert.equal('code' in receipt.commitRefs, false)
  assert.doesNotThrow(() => scientificPlottingReceiptAdapter(receipt))
  const withCode = { ...receipt, commitRefs: { ...receipt.commitRefs, code: receipt.commitRefs.recipe } }
  assert.throws(() => scientificPlottingReceiptAdapter(withCode), /distinct/u)
})

function consumerFor(input: Readonly<{
  workspaceRoot: string
  receipt: Pick<EvidenceProducerReceipt, 'operationId' | 'runtimeId' | 'threadId'>
  prepare?: (
    workspaceRoot: string,
    receipt: EvidenceProducerReceipt
  ) => Promise<EvidenceProducerPreparation>
  append: (input: EvidenceDagTraceAppendInput) => Promise<EvidenceDagAppendResult>
  afterAppend?: () => Promise<void>
}>): EvidenceProducerProvenanceConsumer {
  return new EvidenceProducerProvenanceConsumer({
    discoverWorkspaces: async () => [input.workspaceRoot],
    adapters: new Map([['scientific-plotting', scientificPlottingReceiptAdapter]]),
    prepare: input.prepare ?? (async (_workspace, received) =>
      preparation(input.workspaceRoot, received)),
    append: input.append,
    ...(input.afterAppend ? { afterAppend: input.afterAppend } : {}),
    pollIntervalMs: 60_000
  })
}

const testStores = new Map<string, EvidenceDagDeltaStore>()
async function appendToStore(
  input: EvidenceDagTraceAppendInput,
  workspaceRoot: string
) {
  const store = testStores.get(workspaceRoot) ?? new EvidenceDagDeltaStore(
    join(workspaceRoot, 'deltas.json')
  )
  testStores.set(workspaceRoot, store)
  return store.append(evidenceDagDeltaInputFromTrace(input))
}

function preparation(
  workspaceRoot: string,
  receipt: EvidenceProducerReceipt
): EvidenceProducerPreparation {
  return {
    runtimeId: receipt.runtimeId!,
    threadId: receipt.threadId!,
    workspaceRoot,
    targetWatermark: '7',
    trace: [receipt.traceItem]
  }
}

function plotReceipt(operationId: string): ScientificPlottingProvenanceReceiptV1 {
  const commitRefs = {
    derivedData: versionRef('derived-data', 'derived bytes'),
    recipe: versionRef('recipe', 'recipe bytes'),
    figure: versionRef('figure', 'figure bytes', 'image/png'),
    renderManifest: versionRef('manifest', 'manifest bytes'),
    attemptLog: versionRef('attempt-log', 'log bytes')
  }
  const artifact = (kind: string, ref: ArtifactVersionRefV1) => ({
    kind,
    locator: `snapshot:${ref.versionId}`,
    contentDigest: ref.contentDigest,
    size: ref.byteLength,
    ...(ref.mediaType ? { mediaType: ref.mediaType } : {}),
    retention: ref.retention,
    accessPolicy: ref.accessPolicy,
    artifactVersionRef: ref
  })
  return {
    schemaVersion: 1,
    producer: 'scientific-plotting',
    operationId,
    state: 'pending',
    createdAt: '2026-08-06T08:00:00.000Z',
    runtimeId: 'codex',
    threadId: 'thread-1',
    commitRefs,
    evidenceLineage: {
      activity: {
        id: 'plot-run:1',
        type: 'analysis_run',
        name: 'Render fixture',
        status: 'completed',
        parameters: { template: 'box' }
      },
      inputs: [],
      software: [{
        id: 'software:plotting',
        type: 'software_version',
        name: 'SciForge Scientific Plotting',
        version: '1',
        contentDigest: 'a'.repeat(64)
      }],
      environment: {
        id: 'environment:fixture',
        type: 'environment',
        name: 'Pinned fixture environment',
        contentDigest: 'b'.repeat(64),
        pythonVersion: '3.12',
        packages: { matplotlib: '3.10' },
        fontFingerprint: 'c'.repeat(64)
      },
      logs: [{
        id: 'plot-log:attempt',
        type: 'artifact',
        name: 'Render attempts',
        artifact: artifact('log', commitRefs.attemptLog)
      }],
      outputs: [{
        id: 'plot-output:data',
        type: 'dataset_version',
        name: 'Derived data',
        artifact: artifact('dataset', commitRefs.derivedData)
      }, {
        id: 'plot-output:recipe',
        type: 'artifact',
        name: 'Recipe',
        artifact: artifact('plot-recipe', commitRefs.recipe)
      }, {
        id: 'plot-output:figure',
        type: 'artifact',
        name: 'Figure',
        artifact: artifact('figure', commitRefs.figure)
      }, {
        id: 'plot-output:manifest',
        type: 'artifact',
        name: 'Manifest',
        artifact: artifact('manifest', commitRefs.renderManifest)
      }],
      relations: [{
        src: 'plot-output:figure',
        dst: 'plot-output:recipe',
        rel: 'derived_from'
      }]
    }
  }
}

function versionRef(
  suffix: string,
  text: string,
  mediaType = 'application/json'
): ArtifactVersionRefV1 {
  const bytes = Buffer.from(text)
  return {
    artifactId: `artifact:${suffix}`,
    versionId: `artifact-version:${suffix}`,
    contentDigest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType,
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
}

async function writeProducerReceipt(
  workspaceRoot: string,
  receipt: ScientificPlottingProvenanceReceiptV1 | EvidenceProducerReceiptV1
): Promise<void> {
  const path = producerPath(workspaceRoot, receipt.operationId, receipt.producer)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
}

function producerPath(
  workspaceRoot: string,
  operationId: string,
  producer = 'scientific-plotting'
): string {
  return join(
    workspaceRoot,
    '.sciforge',
    'evidence-dag',
    'inbox',
    producer,
    evidenceProducerReceiptFileName(operationId)
  )
}

function producerBytes(
  workspaceRoot: string,
  operationId: string,
  producer = 'scientific-plotting'
): Promise<Buffer> {
  return readFile(producerPath(workspaceRoot, operationId, producer))
}

async function optionalDelivery(
  workspaceRoot: string,
  operationId: string,
  producer = 'scientific-plotting'
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(
      evidenceProducerDeliveryReceiptPath(workspaceRoot, producer, operationId),
      'utf8'
    ))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') return undefined
    throw error
  }
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for producer provenance delivery.')
}
