import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { WORKSPACE_ATTACHMENT_ACCEPT, workspaceAttachmentKind } from '@sciforge/domain-sdk/attachment-policy'
import { DELIVERY_MAX_FILE_BYTES, DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES } from '@sciforge/collaboration-contracts'
import { workerDeliveryMaterialImportInputSchema } from './worker-delivery.js'
import { DELIVERY_MATERIAL_ACCEPT, DELIVERY_ADDITIONAL_MATERIAL_ACCEPT, additionalDeliveryMaterialKind, deliveryMaterialKind, deliveryMaterialMaxBytes, deliveryMaterialMediaType, validateDeliveryMaterialBytes, deliveryOutputMaxBytes } from './delivery-material-policy.js'

test('additional ZIP is rejected by the Cloud shared policy while Markdown remains supported', () => {
  assert.equal(additionalDeliveryMaterialKind({ name: 'probe.zip', type: 'application/zip' }), 'unsupported')
  assert.equal(additionalDeliveryMaterialKind({ name: 'validation.md', type: 'text/markdown' }), 'scientific')
  assert.ok(!DELIVERY_ADDITIONAL_MATERIAL_ACCEPT.includes('.zip'))
})

test('delivery import encoded wire ceiling stays readable above the default admission gate', () => {
  assert.equal(workerDeliveryMaterialImportInputSchema.shape.contentBase64.maxLength, Math.ceil(DELIVERY_MAX_FILE_BYTES / 3) * 4)
  assert.ok(deliveryMaterialMaxBytes('zip') < DELIVERY_MAX_FILE_BYTES)
})

test('delivery ZIP support has explicit extension, MIME and size bounds without changing Session attachments', () => {
  assert.ok(DELIVERY_MATERIAL_ACCEPT.split(',').includes('.zip'))
  assert.ok(DELIVERY_MATERIAL_ACCEPT.split(',').includes('application/zip'))
  assert.ok(!WORKSPACE_ATTACHMENT_ACCEPT.split(',').includes('.zip'))
  assert.equal(workspaceAttachmentKind({ name: 'output.zip' }), 'unsupported')
  assert.equal(deliveryMaterialKind({ name: 'output.ZIP' }), 'zip')
  assert.equal(deliveryMaterialMediaType({ name: 'output.ZIP' }), 'application/zip')
  assert.equal(deliveryMaterialMaxBytes('zip'), DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES)
  assert.equal(DELIVERY_MAX_FILE_BYTES, 256 * 1024 * 1024)
  assert.equal(deliveryOutputMaxBytes(128 * 1024 * 1024), 128 * 1024 * 1024)
  assert.equal(deliveryOutputMaxBytes(1024 * 1024 * 1024), deliveryMaterialMaxBytes('zip'))
  assert.equal(deliveryMaterialKind({ name: 'output.zip.exe' }), 'unsupported')
  assert.equal(deliveryMaterialKind({ name: 'output.tar' }), 'unsupported')
  assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, Buffer.from('MZ executable')), /ZIP/u)
  assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, new Uint8Array(DELIVERY_MAX_FILE_BYTES + 1)), /大小/u)
  const empty = Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64')
  validateDeliveryMaterialBytes({ name: 'output.zip' }, empty)
  assert.equal(empty.toString('base64'), 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==')
})

test('ZIP structure rejects truncated headers and invalid directory bounds without extraction', () => {
  for (const bytes of [Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.from([0x50, 0x4b, 0x03, 0x04])]) {
    assert.throws(() => validateDeliveryMaterialBytes({ name: 'data.zip' }, bytes), /结构/u)
  }
  const empty = Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64')
  empty.writeUInt32LE(99, 16)
  assert.throws(() => validateDeliveryMaterialBytes({ name: 'data.zip' }, empty), /结构/u)
})
// A real one-byte entry (CRC32 of 'A'), stored or raw-deflated. The entry's
// misleading suffix is deliberate: archive contents remain opaque.
function zipFixture(method = 0, descriptor: 'none' | 'signed' | 'unsigned' = 'none', descriptorBytes?: number) {
  const name = Buffer.from('payload.exe')
  const payload = method === 0 ? Buffer.from('A') : deflateRawSync(Buffer.from('A'))
  const crc = 0xd3d99e8b
  const flags = descriptor === 'none' ? 0 : 8
  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt16LE(method, 8)
  if (!flags) {
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(1, 22)
  }
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  const descriptorSize = descriptor === 'none' ? 0 : descriptor === 'signed' ? 16 : 12
  const dataDescriptor = Buffer.alloc(descriptorSize)
  if (descriptorSize) {
    const at = descriptor === 'signed' ? 4 : 0
    if (at) dataDescriptor.writeUInt32LE(0x08074b50, 0)
    dataDescriptor.writeUInt32LE(crc, at)
    dataDescriptor.writeUInt32LE(payload.length, at + 4)
    dataDescriptor.writeUInt32LE(1, at + 8)
  }
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(1, 24)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)
  const retainedDescriptor = dataDescriptor.subarray(0, descriptorBytes ?? descriptorSize)
  const centralOffset = local.length + payload.length + retainedDescriptor.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  return { bytes: Buffer.concat([local, payload, retainedDescriptor, central, end]), central: centralOffset, descriptor: local.length + payload.length, data: local.length }
}

for (const method of [0, 8]) for (const descriptor of ['none', 'signed', 'unsigned'] as const) {
  test(`accepts real ZIP method=${method} descriptor=${descriptor} without extraction`, () => {
    validateDeliveryMaterialBytes({ name: 'output.zip' }, zipFixture(method, descriptor).bytes)
  })
}

for (const field of [14, 18, 22]) test(`rejects local ZIP field mismatch at ${field}`, () => {
  const { bytes } = zipFixture()
  bytes.writeUInt32LE(0xfffffffe, field)
  assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, bytes), /结构/u)
})

for (const descriptor of ['none', 'signed', 'unsigned'] as const) {
  test(`rejects stored compressed/uncompressed mismatch with descriptor=${descriptor}`, () => {
    const { bytes, central, descriptor: at } = zipFixture(0, descriptor)
    bytes.writeUInt32LE(999, central + 24)
    if (descriptor === 'none') bytes.writeUInt32LE(999, 22)
    else bytes.writeUInt32LE(999, at + (descriptor === 'signed' ? 12 : 8))
    assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, bytes), /结构/u)
  })
}

test('rejects local/central flag and method disagreement', () => {
  for (const field of [6, 8]) {
    const { bytes } = zipFixture()
    bytes.writeUInt16LE(1, field)
    assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, bytes), /结构/u)
  }
})

for (const descriptor of ['signed', 'unsigned'] as const) {
  for (const length of [0, 4, 8, 11, ...(descriptor === 'signed' ? [12, 15] : [])]) {
    test(`rejects bounded ${descriptor} descriptor truncated to ${length} bytes`, () => {
      assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, zipFixture(8, descriptor, length).bytes), /结构/u)
    })
  }
  test(`rejects ${descriptor} descriptor recorded CRC/size mismatch and invalid local size`, () => {
    for (const field of [0, 4, 8]) {
      const { bytes, descriptor: at } = zipFixture(8, descriptor)
      bytes.writeUInt32LE(999, at + (descriptor === 'signed' ? 4 : 0) + field)
      assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, bytes), /结构/u)
    }
    const { bytes } = zipFixture(8, descriptor)
    bytes.writeUInt32LE(999, 18)
    assert.throws(() => validateDeliveryMaterialBytes({ name: 'output.zip' }, bytes), /结构/u)
  })
}

test('ZIP validation compares recorded CRC only and never inspects payload content', () => {
  const { bytes, data } = zipFixture()
  bytes[data] = 0x42
  validateDeliveryMaterialBytes({ name: 'opaque.zip' }, bytes)
})

test('import filename follows the same portable path admission', () => {
  const input = { projectId: 'p', taskId: 't', executionId: 'e', contentBase64: 'YQ==' }
  for (const fileName of [' data.csv', 'CON.csv', 'a/b.csv', 'a\\b.csv']) assert.equal(workerDeliveryMaterialImportInputSchema.safeParse({ ...input, fileName }).success, false)
  assert.equal(workerDeliveryMaterialImportInputSchema.safeParse({ ...input, fileName: '科研.csv' }).success, true)
})
