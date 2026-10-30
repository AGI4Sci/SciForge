import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSealedDeliverySummary } from './delivery-bundle-summary.js'
import type { DeliveryManifest } from '@sciforge/collaboration-contracts'

function fixture(overrides: Record<string, unknown> = {}) {
  const bundle = { schemaVersion: 2, projectId: 'prj_Summary0000001', taskId: 'tsk_Summary0000001', executionId: 'exe_Summary0000001', contractRevision: 1, resultRevision: 1, summary: '成员确认的说明', outputs: [], ...overrides }
  const bytes = new TextEncoder().encode(JSON.stringify(bundle))
  const object = { objectId: 'obj_Summary0000001', projectId: 'prj_Summary0000001', revision: 1, mediaType: 'application/json', sha256: 'a'.repeat(64), byteCount: bytes.length }
  const manifest = { projectId: 'prj_Summary0000001', taskId: 'tsk_Summary0000001', executionId: 'exe_Summary0000001', resultRevision: 1, deliveryManifestId: 'dmf_Summary0000001', bundleObjectId: object.objectId, objects: [object] } as DeliveryManifest
  const reads: unknown[] = []
  const reader = {
    openDeliveryObject: async (input: unknown) => { reads.push(input); return { resource: { token: 'summary' }, object } },
    describeDeliveryObject: async () => ({ descriptor: { range: { size: bytes.length, maxChunkBytes: 7 } } }),
    readDeliveryObjectRange: async (_resource: unknown, input: { range: { offset: number; length: number } }) => ({ dataBase64: Buffer.from(bytes.subarray(input.range.offset, input.range.offset + input.range.length)).toString('base64') })
  }
  return { bundle, bytes, object, manifest, reader, reads }
}

test('sealed summary reads only exact bundle metadata through the existing bounded resource contract', async () => {
  const data = fixture()
  assert.equal(await readSealedDeliverySummary(data.reader as never, data.manifest), '成员确认的说明')
  assert.deepEqual(data.reads, [{ deliveryManifestId: 'dmf_Summary0000001', objectId: 'obj_Summary0000001' }])
})

test('sealed summary preserves readable v1 metadata without creating output descriptors', async () => {
  const data = fixture({ schemaVersion: 1 })
  assert.equal(await readSealedDeliverySummary(data.reader as never, data.manifest), '成员确认的说明')
  assert.deepEqual(data.bundle.outputs, [])
})

test('sealed summary rejects oversized metadata before allocation and rejects short or mismatched reads', async () => {
  const oversized = fixture()
  oversized.object.byteCount = 256 * 1024 + 1
  await assert.rejects(readSealedDeliverySummary(oversized.reader as never, oversized.manifest), /大小或对象/u)
  assert.equal(oversized.reads.length, 0)
  const short = fixture()
  await assert.rejects(readSealedDeliverySummary({ ...short.reader, readDeliveryObjectRange: async () => ({ dataBase64: '' }) } as never, short.manifest), /读取不完整/u)
  const mismatch = fixture({ taskId: 'tsk_Different0001' })
  await assert.rejects(readSealedDeliverySummary(mismatch.reader as never, mismatch.manifest), /快照不一致/u)
})
