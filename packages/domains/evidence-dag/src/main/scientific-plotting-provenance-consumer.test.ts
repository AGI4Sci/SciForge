import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import {
  ScientificPlottingProvenanceConsumer,
  scientificPlottingDeliveryReceiptPath,
  scientificPlottingEvidenceDeliveryReceiptV1Schema,
  scientificPlottingReceiptArtifactRefs,
  scientificPlottingReceiptFileName,
  type ScientificPlottingProvenancePreparation,
  type ScientificPlottingProvenanceReceiptV1
} from './scientific-plotting-provenance-consumer.js'
import {
  EvidenceDagDeltaStore,
  evidenceDagDeltaInputFromTrace,
  type EvidenceDagAppendResult,
  type EvidenceDagTraceAppendInput
} from './evidence-delta.js'

test('delivers a strict Scientific Plotting lineage as a durable synthetic trace', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'evidence-plot-success-'))
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
  const delivery = scientificPlottingEvidenceDeliveryReceiptV1Schema.parse(
    await optionalDelivery(workspaceRoot, receipt.operationId)
  )
  assert.equal(delivery.state, 'committed')
  assert.equal(delivery.deltaDigest.startsWith('sha256:'), true)
  assert.equal(
    delivery.sourceDigest,
    createHash('sha256').update(await producerBytes(workspaceRoot, receipt.operationId)).digest('hex')
  )
  await consumer.close()
})

test('keeps receipts pending while the target thread or durable queue is unavailable', async () => {
  const missingThreadWorkspace = await mkdtemp(join(tmpdir(), 'evidence-plot-thread-'))
  const missingServiceWorkspace = await mkdtemp(join(tmpdir(), 'evidence-plot-service-'))
  const threadReceipt = plotReceipt('plot-operation-thread-0001')
  const serviceReceipt = plotReceipt('plot-operation-service-0001')
  await writeProducerReceipt(missingThreadWorkspace, threadReceipt)
  await writeProducerReceipt(missingServiceWorkspace, serviceReceipt)
  let appendCalls = 0
  const missingThread = new ScientificPlottingProvenanceConsumer({
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
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'evidence-plot-restart-'))
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
  const delivery = scientificPlottingEvidenceDeliveryReceiptV1Schema.parse(
    await optionalDelivery(workspaceRoot, receipt.operationId)
  )
  assert.equal(delivery.deltaDigest.startsWith('sha256:'), true)
  await restarted.close()
})

test('fails closed when a receipt resolves to a target in another workspace', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'evidence-plot-scope-a-'))
  const otherWorkspace = await mkdtemp(join(tmpdir(), 'evidence-plot-scope-b-'))
  const receipt = plotReceipt('plot-operation-cross-workspace-0001')
  await writeProducerReceipt(workspaceRoot, receipt)
  let appendCalls = 0
  const consumer = consumerFor({
    workspaceRoot,
    receipt,
    prepare: async () => preparation(otherWorkspace, receipt),
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
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'evidence-plot-ref-conflict-'))
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
    prepare: async (targetWorkspace, parsedReceipt) => {
      scientificPlottingReceiptArtifactRefs(parsedReceipt)
      return preparation(targetWorkspace, parsedReceipt)
    },
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

function consumerFor(input: Readonly<{
  workspaceRoot: string
  receipt: ScientificPlottingProvenanceReceiptV1
  prepare?: (
    workspaceRoot: string,
    receipt: ScientificPlottingProvenanceReceiptV1
  ) => Promise<ScientificPlottingProvenancePreparation>
  append: (input: EvidenceDagTraceAppendInput) => Promise<EvidenceDagAppendResult>
  afterAppend?: () => Promise<void>
}>): ScientificPlottingProvenanceConsumer {
  return new ScientificPlottingProvenanceConsumer({
    discoverWorkspaces: async () => [input.workspaceRoot],
    prepare: input.prepare ?? (async () => preparation(input.workspaceRoot, input.receipt)),
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
  receipt: ScientificPlottingProvenanceReceiptV1
): ScientificPlottingProvenancePreparation {
  return {
    runtimeId: receipt.runtimeId!,
    threadId: receipt.threadId!,
    workspaceRoot,
    targetWatermark: '7',
    trace: [{
      id: `scientific-plotting/provenance:${receipt.operationId}`,
      evidenceLineage: receipt.evidenceLineage
    }]
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
  receipt: ScientificPlottingProvenanceReceiptV1
): Promise<void> {
  const path = producerPath(workspaceRoot, receipt.operationId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
}

function producerPath(workspaceRoot: string, operationId: string): string {
  return join(
    workspaceRoot,
    '.sciforge',
    'evidence-dag',
    'inbox',
    'scientific-plotting',
    scientificPlottingReceiptFileName(operationId)
  )
}

function producerBytes(workspaceRoot: string, operationId: string): Promise<Buffer> {
  return readFile(producerPath(workspaceRoot, operationId))
}

async function optionalDelivery(workspaceRoot: string, operationId: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(
      scientificPlottingDeliveryReceiptPath(workspaceRoot, operationId),
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
  throw new Error('Timed out waiting for Scientific Plotting provenance delivery.')
}
