import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { cachedVisualFrame } from './preview-visual-export.js'

test('visual cache coalesces identical work and isolates returned buffers', async () => {
  let calls = 0
  const key = randomUUID()
  const render = async () => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 10))
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' as const, width: 1, height: 1,
      sourceRevision: 'one', anchor: { kind: 'test' } }
  }
  const [one, two] = await Promise.all([cachedVisualFrame(key, render), cachedVisualFrame(key, render)])
  assert.equal(calls, 1)
  one.bytes[0] = 9
  assert.equal(two.bytes[0], 1)
  assert.equal((await cachedVisualFrame(key, render)).bytes[0], 1)
  await cachedVisualFrame(key + ':changed-source', render)
  assert.equal(calls, 2)
})
