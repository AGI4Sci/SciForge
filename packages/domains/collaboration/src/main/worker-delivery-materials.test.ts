import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, truncate, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DELIVERY_MAX_FILE_BYTES } from '@sciforge/collaboration-contracts'
import { workspaceAttachmentSessionDirectory } from '@sciforge/domain-sdk/attachment-policy'
import { listDeliveryMaterials, readDeliveryMaterials, readDeliveryWorkspaceIdentity } from './worker-delivery-materials.js'


// A real stored ZIP with one entry and a central directory (no extraction).
function storedZip(byteCount = 1): Buffer {
  const name = Buffer.from('data.txt')
  const bytes = Buffer.alloc(30 + name.length + byteCount + 46 + name.length + 22)
  const central = 30 + name.length + byteCount
  const table = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0 })
  let crc = 0xffffffff
  for (let index = 0; index < byteCount; index++) crc = table[crc & 255]! ^ crc >>> 8
  crc = (crc ^ 0xffffffff) >>> 0
  bytes.writeUInt32LE(0x04034b50, 0); bytes.writeUInt16LE(20, 4)
  bytes.writeUInt32LE(crc, 14); bytes.writeUInt32LE(byteCount, 18); bytes.writeUInt32LE(byteCount, 22); bytes.writeUInt16LE(name.length, 26); name.copy(bytes, 30)
  bytes.writeUInt32LE(0x02014b50, central); bytes.writeUInt16LE(20, central + 6)
  bytes.writeUInt32LE(crc, central + 16); bytes.writeUInt32LE(byteCount, central + 20); bytes.writeUInt32LE(byteCount, central + 24); bytes.writeUInt16LE(name.length, central + 28); name.copy(bytes, central + 46)
  const end = central + 46 + name.length
  bytes.writeUInt32LE(0x06054b50, end); bytes.writeUInt16LE(1, end + 8); bytes.writeUInt16LE(1, end + 10)
  bytes.writeUInt32LE(46 + name.length, end + 12); bytes.writeUInt32LE(central, end + 16)
  return bytes
}

const context = (root: string) => ({ workspaceRoot: root, threadId: 'task-thread', selectedMaterials: [], declared: { fileName: 'README.md', mediaType: 'text/markdown', maxBytes: 100 * 1024 * 1024 } })
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-delivery-materials-'))
  await writeFile(join(root, 'README.md'), 'Declared result')
  return root
}

test('ZIP files between the old import ceiling and delivery budget remain selectable and readable', async () => {
  const root = await workspace()
  try {
    const bytes = storedZip(100 * 1024 * 1024)
    await writeFile(join(root, 'result.zip'), bytes)
    const archive = { ...context(root), declared: { fileName: 'result.zip', mediaType: 'application/zip', maxBytes: 128 * 1024 * 1024 } }
    assert.equal((await listDeliveryMaterials(archive, {})).files.find(file => file.fileName === 'result.zip')?.byteCount, bytes.length)
    assert.equal((await readDeliveryMaterials(archive))[0]!.bytes.length, bytes.length)
    await assert.rejects(readDeliveryMaterials({ ...archive, declared: { ...archive.declared, maxBytes: 100 * 1024 * 1024 } }), /大小/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('required ZIP stays readable but additional ZIP is rejected before freeze and Markdown passes', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'probe.zip'), storedZip())
    await writeFile(join(root, 'validation.md'), 'Validation evidence')
    const ordinary = context(root)
    assert.ok(!(await listDeliveryMaterials(ordinary, {})).files.some(file => file.fileName === 'probe.zip'))
    await assert.rejects(readDeliveryMaterials({ ...ordinary, selectedMaterials: [{ relativePath: 'probe.zip' }] }), /ZIP 仅可作为任务声明的必交文件/u)
    assert.equal((await readDeliveryMaterials({ ...ordinary, selectedMaterials: [{ relativePath: 'validation.md' }] }))[1]!.metadata.role, 'member')
    const required = { ...ordinary, declared: { fileName: 'required.zip', mediaType: 'application/zip', maxBytes: 20 * 1024 * 1024 }, declaredMaterial: { relativePath: 'probe.zip', source: 'member' as const } }
    assert.ok((await listDeliveryMaterials(required, {})).files.some(file => file.fileName === 'probe.zip'))
    const result = await readDeliveryMaterials(required)
    assert.equal(result[0]!.metadata.role, 'declared')
    assert.equal(result[0]!.metadata.fileName, 'required.zip')
    assert.equal(result[0]!.metadata.mediaType, 'application/zip')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('declared files cannot exceed the delivery budget even when a legacy task allows 1 GiB', async () => {
  const root = await workspace()
  try {
    await truncate(join(root, 'README.md'), DELIVERY_MAX_FILE_BYTES + 1)
    const oversized = { ...context(root), declared: { fileName: 'README.md', mediaType: 'text/markdown', maxBytes: 1024 * 1024 * 1024 } }
    assert.equal((await listDeliveryMaterials(oversized, {})).files.length, 0)
    await assert.rejects(readDeliveryMaterials(oversized), /大小不符合要求/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('selected materials freeze distinct nested paths and raw attachment bytes, with required declared output first', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'figures'))
    await mkdir(join(root, '.sciforge/uploads/task-thread'), { recursive: true })
    await writeFile(join(root, 'figures/README.md'), 'Different result')
    await writeFile(join(root, '.sciforge/uploads/task-thread/data.parquet'), Buffer.from([0, 255, 0, 42]))
    const result = await readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'figures/README.md' }, { relativePath: '.sciforge/uploads/task-thread/data.parquet' }] })
    assert.deepEqual(result.map(({ metadata }) => [metadata.relativePath, metadata.role, metadata.source]), [['README.md', 'declared', 'ai'], ['figures/README.md', 'member', 'member'], ['.sciforge/uploads/task-thread/data.parquet', 'member', 'attachment']])
    assert.deepEqual(result[2]!.bytes, Buffer.from([0, 255, 0, 42]))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('material selection rejects traversal, any symlink, another session uploads and internal delivery bytes', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested/result.csv'), 'a,b')
    await symlink(join(root, 'nested'), join(root, 'linked'))
    for (const relativePath of ['../README.md', '/tmp/README.md', 'linked/result.csv', '.sciforge/delivery/candidate/bundle.json', '.sciforge/uploads/another-thread/data.csv']) {
      await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath }] }), /路径|符号链接|目录|会话/u)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('bundle count and byte bounds fail before allocating selected content', async () => {
  const root = await workspace()
  try {
    const paths = Array.from({ length: 20 }, (_, index) => ({ relativePath: `data-${index}.csv` }))
    for (const { relativePath } of paths) await writeFile(join(root, relativePath), 'data')
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: paths }), /20/u)
    await truncate(join(root, 'data-0.csv'), 100 * 1024 * 1024 + 1)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: paths.slice(0, 1) }), /data-0.csv.*104857600/u)
    for (const { relativePath } of paths.slice(0, 6)) await truncate(join(root, relativePath), 100 * 1024 * 1024)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: paths.slice(0, 6) }), /data-1.csv.*200/u)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'README.md' }] }), /重复|必交/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('material listing puts exact session attachments first, paginates, filters, and omits symlinks and snapshots', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, '.sciforge/uploads/task-thread'), { recursive: true })
    await mkdir(join(root, '.sciforge/delivery/candidate'), { recursive: true })
    await writeFile(join(root, '.sciforge/uploads/task-thread/data.csv'), 'a,b')
    await writeFile(join(root, '.sciforge/delivery/candidate/secret.json'), '{}')
    await symlink(join(root, 'README.md'), join(root, 'linked.md'))
    const list = await listDeliveryMaterials(context(root), { limit: 1 })
    assert.equal(list.files[0]!.source, 'attachment')
    assert.ok(list.nextCursor)
    const next = await listDeliveryMaterials(context(root), { limit: 1, cursor: list.nextCursor! })
    assert.equal(next.files[0]!.relativePath, 'README.md')
    const filtered = await listDeliveryMaterials(context(root), { query: 'data' })
    assert.deepEqual(filtered.files.map(({ fileName }) => fileName), ['data.csv'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('material limits share the generic attachment policy and reject portable path collisions before reading bytes', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'unsupported.exe'), 'binary')
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'unsupported.exe' }] }), /类型/u)
    await writeFile(join(root, 'data.csv'), 'data')
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'data.csv' }, { relativePath: 'DATA.csv' }] }), /重复/u)
    await writeFile(join(root, 'image.png'), '')
    await truncate(join(root, 'image.png'), 32 * 1024 * 1024 + 1)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'image.png' }] }), /image.png.*33554432/u)
    await writeFile(join(root, 'paper.pdf'), '')
    await truncate(join(root, 'paper.pdf'), 64 * 1024 * 1024 + 1)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'paper.pdf' }] }), /paper.pdf.*67108864/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('material reader and listing reject a symlink execution root instead of treating its outside target as the task', async () => {
  const outside = await workspace()
  const parent = await mkdtemp(join(tmpdir(), 'sciforge-delivery-root-'))
  try {
    const root = join(parent, 'execution')
    await symlink(outside, root)
    await assert.rejects(readDeliveryMaterials(context(root)), /工作目录.*符号链接/u)
    await assert.rejects(listDeliveryMaterials(context(root), {}), /工作目录.*符号链接/u)
  } finally { await rm(parent, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('bounded task listing visits session attachments before a large ordinary subtree', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'aaa'))
    await mkdir(join(root, '.sciforge/uploads/task-thread'), { recursive: true })
    await writeFile(join(root, '.sciforge/uploads/task-thread/important.csv'), 'a,b')
    for (let offset = 0; offset < 10_001; offset += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 10_001 - offset) }, (_, index) => writeFile(join(root, 'aaa', `${offset + index}.txt`), '')))
    }
    const listed = await listDeliveryMaterials(context(root), { limit: 1 })
    assert.equal(listed.files[0]!.fileName, 'important.csv')
    assert.equal(listed.files[0]!.source, 'attachment')
    assert.equal(listed.truncated, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('portable dotted filenames remain selectable and attachment errors show the logical name without internal paths', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, '..dataset.csv'), 'a,b')
    const dotted = await readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: '..dataset.csv' }] })
    assert.equal(dotted[1]!.metadata.fileName, '..dataset.csv')
    await mkdir(join(root, '.sciforge/uploads/task-thread'), { recursive: true })
    const relativePath = '.sciforge/uploads/task-thread/20261021T043005-ab123456-data.csv'
    await writeFile(join(root, relativePath), '')
    await truncate(join(root, relativePath), 100 * 1024 * 1024 + 1)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath }] }), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /data.csv/u)
      assert.equal(error.message.includes('.sciforge'), false)
      assert.equal(error.message.includes('20261021T043005'), false)
      return true
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('material reads reject an execution directory replaced after its exact root identity was captured', async () => {
  const root = await workspace()
  const backup = `${root}-original`
  let moved = false
  try {
    const identity = await readDeliveryWorkspaceIdentity(root)
    await rename(root, backup)
    moved = true
    await mkdir(root)
    await writeFile(join(root, 'README.md'), 'Replacement data')
    await assert.rejects(readDeliveryMaterials(context(root), identity), /工作目录.*改动/u)
  } finally {
    await rm(root, { recursive: true, force: true })
    if (moved) await rm(backup, { recursive: true, force: true })
  }
})

for (const [label, threadId] of [['unsafe characters', 'thread /科研 data'], ['long owner ID', `thread-${'x'.repeat(160)}`]] as const) {
  test(`delivery material consumer reads and lists the canonical attachment directory for ${label}`, async () => {
    const root = await workspace()
    try {
      const directory = workspaceAttachmentSessionDirectory(threadId)
      await mkdir(join(root, directory), { recursive: true })
      const relativePath = `${directory}/20261021T043005-ab123456-data.csv`
      const bytes = Buffer.from([0, 255, 42])
      await writeFile(join(root, relativePath), bytes)
      const binding = { ...context(root), threadId, selectedMaterials: [{ relativePath }] }
      const listed = await listDeliveryMaterials(binding, {})
      assert.equal(listed.files[0]!.relativePath, relativePath)
      assert.equal(listed.files[0]!.source, 'attachment')
      const selected = await readDeliveryMaterials(binding)
      assert.deepEqual(selected[1]!.bytes, bytes)
      assert.equal(selected[1]!.metadata.source, 'attachment')
      assert.equal(selected[1]!.metadata.fileName, 'data.csv')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

test('delivery material consumer rejects reserved attachment owner directories', async () => {
  const root = await workspace()
  try {
    for (const threadId of ['.', '..', ' _.._ ']) {
      await assert.rejects(listDeliveryMaterials({ ...context(root), threadId }, {}))
      await assert.rejects(readDeliveryMaterials({ ...context(root), threadId }))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a human binds uploaded bytes to the exact required output without writing a second file', async () => {
  const root = await workspace()
  const relativePath = '.sciforge/uploads/task-thread/my-results.csv'
  try {
    await mkdir(join(root, '.sciforge/uploads/task-thread'), { recursive: true })
    await writeFile(join(root, relativePath), 'x,y\n1,2\n')
    const mapped = { ...context(root), declared: { fileName: 'data.csv', mediaType: 'text/csv', maxBytes: 1024 },
      declaredMaterial: { relativePath, source: 'member' as const } }
    const files = await readDeliveryMaterials(mapped)
    assert.equal(files[0]!.bytes.toString(), 'x,y\n1,2\n')
    assert.deepEqual([files[0]!.metadata.fileName, files[0]!.metadata.relativePath, files[0]!.metadata.role, files[0]!.metadata.source],
      ['data.csv', 'data.csv', 'declared', 'member'])
    await assert.rejects(readDeliveryMaterials({ ...mapped, selectedMaterials: [{ relativePath }] }), /重复/u)
    await writeFile(join(root, 'data.csv'), 'duplicate output target')
    await assert.rejects(readDeliveryMaterials({ ...mapped, selectedMaterials: [{ relativePath: 'data.csv' }] }), /重复/u)
    await assert.rejects(readDeliveryMaterials({ ...mapped, declared: { ...mapped.declared, maxBytes: 2 } }), /大小/u)
    await assert.rejects(readDeliveryMaterials({ ...mapped, declaredMaterial: { relativePath: 'README.md' } }), /格式/u)
    for (const path of ['../outside.csv', '.sciforge/uploads/another-thread/private.csv']) {
      await assert.rejects(readDeliveryMaterials({ ...mapped, declaredMaterial: { relativePath: path } }), /路径|不可用/u)
    }
    await assert.rejects(readDeliveryMaterials({ ...mapped, declared: null }), /没有声明/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('script families preserve raw text bytes and hashes while unsupported and oversized files are not listed', async () => {
  const root = await workspace()
  try {
    const scripts = ['analysis.PY', 'analysis.R', 'analysis.jl', 'analysis.sh', 'analysis.bash', 'analysis.zsh', 'analysis.ps1']
    const bytes = Buffer.from('\ufeff# 科研\r\nprint("data only")\r\n')
    for (const name of scripts) await writeFile(join(root, name), bytes)
    await writeFile(join(root, 'tool.exe'), 'MZ')
    await writeFile(join(root, 'unknown.bin'), Buffer.from([0, 255]))
    await writeFile(join(root, 'large.py'), '')
    await truncate(join(root, 'large.py'), 100 * 1024 * 1024 + 1)
    const listed = await listDeliveryMaterials(context(root), {})
    assert.deepEqual(listed.files.map(file => file.relativePath).sort(), [...scripts, 'README.md'].sort())
    const files = await readDeliveryMaterials({ ...context(root), selectedMaterials: scripts.map(relativePath => ({ relativePath })) })
    for (const file of files.slice(1)) {
      assert.deepEqual(file.bytes, bytes)
      assert.equal(file.metadata.mediaType, 'text/plain')
      assert.equal(file.metadata.byteCount, bytes.length)
    }
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'large.py' }] }), /大小/u)
    for (const relativePath of ['../outside.py', 'nested\\analysis.py', 'C:\\outside.py']) {
      await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath }] }))
    }
    await writeFile(join(root, 'fake.py'), Buffer.from([77, 90, 0, 255]))
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'fake.py' }] }), /UTF-8/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('declared text script mapping preserves exact bytes and retains explicit MIME constraints', async () => {
  const root = await workspace()
  try {
    const bytes = Buffer.from('# 科研\r\nprint(1)\r\n')
    await mkdir(join(root, 'materials'), { recursive: true })
    await writeFile(join(root, 'materials/source.py'), bytes)
    const selected = { ...context(root), declared: { fileName: 'required.py', mediaType: 'text/plain', maxBytes: 1024 },
      declaredMaterial: { relativePath: 'materials/source.py', source: 'member' as const } }
    const result = await readDeliveryMaterials(selected)
    assert.deepEqual(result[0]!.bytes, bytes)
    assert.equal(result[0]!.metadata.relativePath, 'required.py')
    assert.equal(result[0]!.metadata.mediaType, 'text/plain')
    await assert.rejects(readDeliveryMaterials({ ...selected, declared: { ...selected.declared, mediaType: 'text/x-python' } }), /格式/u)
    await writeFile(join(root, 'custom.bin'), Buffer.from([0, 255]))
    const custom = { ...context(root), declared: { fileName: 'custom.bin', mediaType: 'application/octet-stream', maxBytes: 1024 } }
    assert.ok((await listDeliveryMaterials(custom, {})).files.some(file => file.relativePath === 'custom.bin'))
    assert.deepEqual((await readDeliveryMaterials(custom))[0]!.bytes, Buffer.from([0, 255]))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('required candidate admission excludes incompatible, empty and task-oversized ZIP aliases', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'empty.csv'), '')
    await writeFile(join(root, 'bad.zip'), 'oops')
    await writeFile(join(root, 'alias.zip'), storedZip(2048))
    const required = { ...context(root), declared: { fileName: 'required.zip', mediaType: 'application/zip', maxBytes: 1024 } }
    const list = await listDeliveryMaterials(required, {})
    assert.ok(!list.files.some(file => file.fileName === 'alias.zip'))
    await assert.rejects(readDeliveryMaterials({ ...required, declaredMaterial: { relativePath: 'bad.zip' } }), /ZIP 文件结构/u)
    await assert.rejects(readDeliveryMaterials({ ...context(root), declared: { fileName: 'empty.csv', mediaType: 'text/csv', maxBytes: 1024 } }), /不能为空/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})
