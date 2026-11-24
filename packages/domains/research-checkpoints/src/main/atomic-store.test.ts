import assert from 'node:assert/strict'
import filesystem, { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { writeJsonAtomic } from './atomic-store.js'

test('writes durable JSON when directory fsync is unsupported by the platform', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'research-checkpoint-atomic-'))
  const path = join(directory, 'store.json')
  try {
    await writeJsonAtomic(path, { ready: true })
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ready: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const code of ['EPERM', 'EBUSY']) test(`one transient ${code} retries the same synced bytes and atomically replaces the checkpoint`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'checkpoint-rename-retry-'))
  const path = join(directory, 'store.json')
  await writeJsonAtomic(path, { prior: true })
  const original = filesystem.rename
  let calls = 0
  t.mock.method(filesystem, 'rename', async (source: Parameters<typeof original>[0], target: Parameters<typeof original>[1]) => {
    calls++
    assert.equal(await readFile(source, 'utf8'), '{"next":true}\n')
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { prior: true })
    if (calls === 1) throw Object.assign(new Error('synthetic share lock'), { code })
    return original(source, target)
  })
  try {
    await writeJsonAtomic(path, { next: true })
    assert.equal(calls, 2)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { next: true })
    assert.deepEqual(await readdir(directory), ['store.json'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

for (const code of ['EPERM', 'EIO']) test(`persistent ${code} preserves the prior checkpoint and removes only its temporary file`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'checkpoint-rename-failure-'))
  const path = join(directory, 'store.json')
  await writeJsonAtomic(path, { prior: true })
  let calls = 0
  t.mock.method(filesystem, 'rename', async () => { calls++; throw Object.assign(new Error('synthetic rename failure'), { code }) })
  try {
    await assert.rejects(writeJsonAtomic(path, { next: true }), error => (error as NodeJS.ErrnoException).code === code)
    assert.equal(calls, code === 'EPERM' ? 4 : 1)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { prior: true })
    assert.deepEqual(await readdir(directory), ['store.json'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
