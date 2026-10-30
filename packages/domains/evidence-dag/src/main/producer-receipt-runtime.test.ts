/**
 * Producer receipts through the real EvidenceDagRuntime, so the target-thread
 * checks in the runtime are exercised instead of a stubbed `prepare`.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import {
  evidenceProducerDeliveryReceiptV1Schema,
  evidenceProducerReceiptV1Schema,
  type EvidenceProducerReceiptV1
} from '../contract.js'
import {
  evidenceProducerDeliveryRelativePath,
  evidenceProducerInboxRelativePath
} from '../producer-inbox.js'
import { EvidenceDagRuntime } from './runtime.js'
import type { EvidenceDagSidecarPort } from './sidecar.js'

const OPERATION = 'producer-operation-runtime-0001'

type ReadCall = Readonly<{ runtimeId: string; threadId: string }>

async function harness(options: Readonly<{
  readThread: (call: ReadCall, workspaceRoot: string) => Promise<Record<string, unknown>>
  pollIntervalMs?: number
  readableVersions?: boolean
}>) {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'producer-runtime-user-')))
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'producer-runtime-ws-')))
  const reads: ReadCall[] = []
  const logs: string[] = []
  const sidecar: EvidenceDagSidecarPort = {
    configure: () => undefined,
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
    ensureReady: async () => undefined,
    stop: async () => undefined
  }
  const known = new Map<string, ArtifactVersionRefV1>()
  for (const ref of Object.values(producerReceipt('paper-radar', OPERATION, 'codex', 'thread-1').commitRefs)) {
    known.set(ref.versionId, ref)
  }
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar,
    // Readable exact versions: with this port the only thing standing between a
    // receipt and delivery is the check each test targets.
    ...(options.readableVersions === false ? {} : {
      artifactVersionReadPort: {
        read: async ({ versionId }: { versionId: string }) => {
          const ref = known.get(versionId)
          if (!ref) return { ok: false, issue: { code: 'not-found', message: `No version ${versionId}.` } } as never
          return {
            ok: true,
            value: { ref, dataBase64: Buffer.from(versionId.replace('artifact-version:', '')).toString('base64') }
          } as never
        }
      }
    }),
    producerProvenancePollIntervalMs: options.pollIntervalMs ?? 20,
    fetchImpl: async () => new Response('{}', { status: 200 })
  })
  const context = {
    owner: { moduleId: 'sciforge.evidence-dag', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    userDataDir,
    appRoot: '/workspace/app',
    environment: {},
    agentThreads: {
      list: async () => [{ id: 'thread-1', runtimeId: 'codex', workspaceRoot }],
      read: async (call: ReadCall) => {
        reads.push(call)
        return options.readThread(call, workspaceRoot)
      },
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => { throw new Error('Unexpected capability invocation.') },
      createApprovedBatch: () => { throw new Error('Unexpected capability invocation.') }
    },
    modelAccess: { textReasoner: async () => ({ baseUrl: 'http://127.0.0.1:3892/v1', apiKey: 'k', model: 'm' }) },
    executionEvents: { publish: async () => { throw new Error('Unexpected execution event.') } },
    workflowExecutionReceipts: [],
    enablement: { isEnabled: async () => true, subscribe: () => () => undefined },
    log: (entry: { message: string }) => { logs.push(entry.message) }
  } as unknown as DomainMainRuntimeLifecycleContext
  await runtime.activate(context)
  return { runtime, userDataDir, workspaceRoot, reads, logs }
}

test('control: a routable receipt with readable versions is delivered', async () => {
  const h = await harness({
    readThread: async (_call, workspaceRoot) => threadDetail('codex', 'thread-1', workspaceRoot)
  })
  await writeReceipt(h.workspaceRoot, producerReceipt('paper-radar', OPERATION, 'codex', 'thread-1'))
  const deadline = Date.now() + 3_000
  let delivered: unknown
  while (!delivered && Date.now() < deadline) {
    delivered = await delivery(h.workspaceRoot, 'paper-radar', OPERATION)
    if (!delivered) await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.ok(delivered, `the control receipt was not delivered; log: ${h.logs.join(' | ')}`)
  assert.equal((delivered as { state: string }).state, 'committed')
  assert.ok(await deltaCount(h.userDataDir) >= 1)
  await h.runtime.close()
})

test('a missing target thread keeps the receipt pending after the thread check ran', async () => {
  const h = await harness({ readThread: async () => { throw new Error('Thread is not available.') } })
  const receipt = producerReceipt('paper-radar', OPERATION, 'codex', 'thread-1')
  await writeReceipt(h.workspaceRoot, receipt)
  const parsed = evidenceProducerReceiptV1Schema.safeParse(receipt)
  assert.equal(parsed.success, true, 'the fixture itself must be a valid receipt')

  await settle(h)

  assert.ok(h.reads.length > 0, 'the target thread was looked up')
  for (const read of h.reads) assert.deepEqual(read, { runtimeId: 'codex', threadId: 'thread-1' })
  assert.equal(await delivery(h.workspaceRoot, 'paper-radar', OPERATION), undefined)
  assert.equal(await deltaCount(h.userDataDir), 0)
  await h.runtime.close()
})

test('a receipt routed to another thread than the one returned is refused', async () => {
  const h = await harness({
    readThread: async (_call, workspaceRoot) => threadDetail('codex', 'someone-else', workspaceRoot)
  })
  await writeReceipt(h.workspaceRoot, producerReceipt('paper-radar', OPERATION, 'codex', 'thread-1'))

  await settle(h)

  assert.ok(h.reads.length > 0)
  assert.equal(await delivery(h.workspaceRoot, 'paper-radar', OPERATION), undefined)
  assert.equal(await deltaCount(h.userDataDir), 0)
  await h.runtime.close()
})

test('a thread bound to a different workspace is refused', async () => {
  const other = await realpath(await mkdtemp(join(tmpdir(), 'producer-runtime-other-')))
  const h = await harness({ readThread: async () => threadDetail('codex', 'thread-1', other) })
  await writeReceipt(h.workspaceRoot, producerReceipt('paper-radar', OPERATION, 'codex', 'thread-1'))

  await settle(h)

  assert.equal(await delivery(h.workspaceRoot, 'paper-radar', OPERATION), undefined)
  assert.equal(await deltaCount(h.userDataDir), 0)
  await h.runtime.close()
})

test('a receipt that references an unavailable Artifact Version never reaches an append', async () => {
  const h = await harness({
    readableVersions: false,
    readThread: async (_call, workspaceRoot) => threadDetail('codex', 'thread-1', workspaceRoot)
  })
  await writeReceipt(h.workspaceRoot, producerReceipt('paper-radar', OPERATION, 'codex', 'thread-1'))

  await settle(h)

  assert.ok(h.reads.length > 0, 'the thread check passed and the version check refused it')
  assert.equal(await delivery(h.workspaceRoot, 'paper-radar', OPERATION), undefined)
  assert.equal(await deltaCount(h.userDataDir), 0)
  await h.runtime.close()
})

function producerReceipt(
  producer: string,
  operationId: string,
  runtimeId: string,
  threadId: string
): EvidenceProducerReceiptV1 {
  const refFor = (id: string): ArtifactVersionRefV1 => ({
    artifactId: `artifact:${id}`,
    versionId: `artifact-version:${id}`,
    contentDigest: createHash('sha256').update(id).digest('hex'),
    byteLength: id.length,
    mediaType: 'application/json',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  })
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
  const analysis = refFor('analysis')
  const check = refFor('check')
  return {
    schemaVersion: 1,
    producer,
    operationId,
    state: 'pending',
    createdAt: '2026-10-12T00:00:00.000Z',
    runtimeId,
    threadId,
    toolName: 'paper_radar.deep_read',
    commitRefs: { analysis, check },
    evidenceLineage: {
      activity: {
        id: `activity:${operationId}`,
        type: 'analysis_run',
        name: 'Deep read',
        status: 'completed',
        parameters: { paperId: 'arxiv:1' }
      },
      inputs: [],
      software: [],
      logs: [{ id: 'check', type: 'artifact', name: 'Check', artifact: artifact('check', check) }],
      outputs: [{ id: 'analysis', type: 'artifact', name: 'Analysis', artifact: artifact('analysis', analysis) }],
      relations: []
    }
  }
}

function threadDetail(runtimeId: string, id: string, workspaceRoot: string): Record<string, unknown> {
  return { id, runtimeId, watermark: '7', turns: [], artifacts: [], workspaceRoot }
}

async function writeReceipt(workspaceRoot: string, receipt: EvidenceProducerReceiptV1): Promise<void> {
  const path = join(workspaceRoot, evidenceProducerInboxRelativePath(receipt.producer, receipt.operationId))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
}

async function delivery(workspaceRoot: string, producer: string, operationId: string): Promise<unknown> {
  try {
    return evidenceProducerDeliveryReceiptV1Schema.parse(JSON.parse(await readFile(
      join(workspaceRoot, evidenceProducerDeliveryRelativePath(producer, operationId)),
      'utf8'
    )))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function deltaCount(userDataDir: string): Promise<number> {
  try {
    const files = await readdir(join(userDataDir, 'evidence-dag'))
    if (!files.includes('deltas.json')) return 0
    const persisted = JSON.parse(await readFile(join(userDataDir, 'evidence-dag', 'deltas.json'), 'utf8')) as {
      chains?: Array<{ records: unknown[] }>
    }
    return (persisted.chains ?? []).reduce((total, chain) => total + chain.records.length, 0)
  } catch {
    return 0
  }
}

/** Let the runtime's own poller run: wait for the thread lookup, then for the attempt to finish. */
async function settle(h: { reads: ReadCall[] }): Promise<void> {
  const deadline = Date.now() + 3_000
  while (h.reads.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(h.reads.length > 0, 'the poller never looked up the target thread')
  await new Promise((resolve) => setTimeout(resolve, 150))
}
