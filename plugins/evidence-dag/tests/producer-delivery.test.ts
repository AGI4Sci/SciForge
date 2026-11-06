import { it, expect } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EvidenceRuntime } from '../src/runtime.js'
import { artifactFixture } from './artifact-fixture.js'
import { evidenceProducerInboxRelativePath, evidenceProducerDeliveryRelativePath } from '@sciforge/domain-evidence-dag/producer-inbox'
import { evidenceProducerReceiptV1Schema } from '@sciforge/domain-evidence-dag/contract'

async function producerFixture() {
  const f = await artifactFixture()
  const committed = await f.service.commit(f.scope.workspaceRoot, {
    idempotencyKey: 'producer-real-artifact-0001',
    candidates: [{ candidateId: 'output', expectedCurrentVersionId: null, kind: 'text', intent: 'save', content: { mode: 'snapshot', dataBase64: Buffer.from('synthetic evidence artifact').toString('base64'), mediaType: 'text/plain' }, accessPolicy: { visibility: 'workspace', principals: [], allowExport: true } }],
  }, f.access)
  if (!committed.ok) throw new Error(committed.issue.message)
  const ref = committed.value.versions[0]!.ref
  const receipt = evidenceProducerReceiptV1Schema.parse({
    schemaVersion: 1, producer: 'test-producer', toolName: 'test_producer.render',
    operationId: 'producer-operation-real-0001', state: 'pending', createdAt: '2026-08-06T08:00:00.000Z',
    runtimeId: f.scope.runtimeId, threadId: f.scope.threadId, commitRefs: { output: ref },
    evidenceLineage: { activity: { id: 'run:1', type: 'analysis_run', name: 'Fixture producer', status: 'completed', parameters: {} }, inputs: [], software: [], logs: [],
      outputs: [{ id: 'output:1', type: 'artifact', name: 'Output', artifact: { kind: 'text', locator: `snapshot:${ref.versionId}`, contentDigest: ref.contentDigest, size: ref.byteLength, mediaType: ref.mediaType, retention: ref.retention, accessPolicy: ref.accessPolicy, artifactVersionRef: ref } }], relations: [] },
  })
  const source = join(f.scope.workspaceRoot, evidenceProducerInboxRelativePath(receipt.producer, receipt.operationId))
  await mkdir(dirname(source), { recursive: true }); await writeFile(source, JSON.stringify(receipt))
  const delivery = join(f.scope.workspaceRoot, evidenceProducerDeliveryRelativePath(receipt.producer, receipt.operationId))
  return { ...f, receipt, source, delivery }
}

it('explicit producer poll uses real immutable artifact reads, durable canonical delivery and idempotent restart', async () => {
  const f = await producerFixture()
  const runtime = new EvidenceRuntime(f.ports)
  await runtime.start()
  try {
    // Disabled background consumer does not deliver merely by activation.
    await expect(readFile(f.delivery)).rejects.toMatchObject({ code: 'ENOENT' })
    const result = await runtime.withInvocation({ callId: 'producer-call' }, new AbortController().signal, () => runtime.pollProducerProvenance(f.scope))
    expect(result).toMatchObject({ delivered: 1, idempotent: 0, pending: [], drained: true })
    const receipt = JSON.parse(await readFile(f.delivery, 'utf8'))
    const chain = await runtime.store.chain(`${f.scope.runtimeId}:${f.scope.threadId}`)
    expect(chain.list().some(delta => delta.deltaDigest === receipt.deltaDigest)).toBe(true)
    expect(f.calls.filter(call => call.operation === 'artifacts.read').every(call => call.caller.callId === 'producer-call')).toBe(true)
    expect(await runtime.pollProducerProvenance(f.scope)).toMatchObject({ delivered: 0, idempotent: 1, drained: true })
    expect(chain.list()).toHaveLength(1)
  } finally { await runtime.close() }
  const restart = new EvidenceRuntime(f.ports)
  await restart.start()
  try { expect(await restart.pollProducerProvenance(f.scope)).toMatchObject({ delivered: 0, idempotent: 1, drained: true }) }
  finally { await restart.close() }
})

it('reports exact ref mismatch pending without writing a delivery', async () => {
  const f = await producerFixture()
  const ports = { ...f.ports, request: async (request: any) => {
    const result = await f.ports.request(request)
    return request.operation === 'artifacts.read' && result.ok ? { ...result, value: { ...result.value, dataBase64: Buffer.from('tampered').toString('base64') } } : result
  } }
  const runtime = new EvidenceRuntime(ports); await runtime.start()
  try {
    const result = await runtime.pollProducerProvenance(f.scope)
    expect(result.drained).toBe(false)
    expect(result.pending[0]?.message).toMatch(/byte integrity/)
    await expect(readFile(f.delivery)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await runtime.store.chain(`${f.scope.runtimeId}:${f.scope.threadId}`)).list()).toHaveLength(0)
  } finally { await runtime.close() }
})

it('skips other target sessions and rejects an existing delivery from a different fact owner', async () => {
  const f = await producerFixture()
  const owner = new EvidenceRuntime(f.ports); await owner.start()
  try { await owner.pollProducerProvenance(f.scope) } finally { await owner.close() }
  const foreign = new EvidenceRuntime({ ...f.ports, storageRoot: join(f.root, 'foreign-evidence') }); await foreign.start()
  try {
    const result = await foreign.pollProducerProvenance(f.scope)
    expect(result).toMatchObject({ delivered: 0, idempotent: 0, drained: false })
    expect(result.pending[0]?.message).toMatch(/another fact owner/)
    expect((await foreign.store.chain(`${f.scope.runtimeId}:${f.scope.threadId}`)).list()).toHaveLength(0)
    await writeFile(f.source, JSON.stringify({ ...f.receipt, threadId: 'other-session' }))
    expect(await foreign.pollProducerProvenance(f.scope)).toMatchObject({ skipped: 1, pending: [], delivered: 0 })
  } finally { await foreign.close() }
})
