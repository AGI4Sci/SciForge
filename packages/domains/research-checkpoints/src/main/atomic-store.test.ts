import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
