import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, truncate, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { workspaceAttachmentSessionDirectory } from '@sciforge/domain-sdk/attachment-policy'
import { listDeliveryMaterials, readDeliveryMaterials, readDeliveryWorkspaceIdentity } from './worker-delivery-materials.js'

const context = (root: string) => ({ workspaceRoot: root, threadId: 'task-thread', selectedMaterials: [], declared: { fileName: 'README.md', mediaType: 'text/markdown', maxBytes: 100 * 1024 * 1024 } })
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-delivery-materials-'))
  await writeFile(join(root, 'README.md'), 'Declared result')
  return root
}

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
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: paths.slice(0, 1) }), /data-0.csv.*100/u)
    for (const { relativePath } of paths.slice(0, 3)) await truncate(join(root, relativePath), 90 * 1024 * 1024)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: paths.slice(0, 3) }), /data-2.csv.*200/u)
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
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'image.png' }] }), /image.png.*32/u)
    await writeFile(join(root, 'paper.pdf'), '')
    await truncate(join(root, 'paper.pdf'), 64 * 1024 * 1024 + 1)
    await assert.rejects(readDeliveryMaterials({ ...context(root), selectedMaterials: [{ relativePath: 'paper.pdf' }] }), /paper.pdf.*64/u)
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
