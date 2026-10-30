import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativePresentationQueue } from './native-presentation-queue'

test('presentation remains ordered across cleanup, fullscreen and renewed handles', async () => {
  const resource = { token: 'cap_abcdefghijklmnopqrstuvwxyz', semanticRevision: 'browser-1', expiresAt: '2026-10-01T00:00:00Z' }
  const renewed = { ...resource, token: 'cap_bcdefghijklmnopqrstuvwxyz0' }
  const calls: { visible: boolean; resource: typeof resource; width: number }[] = []
  const releases: (() => void)[] = []
  const enqueue = createNativePresentationQueue(async (input, handle) => {
    calls.push({ visible: input.visible, resource: handle, width: input.width })
    await new Promise<void>(resolve => releases.push(resolve))
  })
  const show = { x: 20, y: 50, width: 400, height: 300, visible: true }
  const onError = (error: unknown): void => { throw error }
  enqueue({ input: show, resource, onError })
  enqueue({ input: { ...show, visible: false }, resource, onError })
  enqueue({ input: { ...show, width: 900 }, resource, onError })
  enqueue({ input: show, resource: renewed, onError })
  assert.equal(calls.length, 1)
  releases.shift()!()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[1].visible, true, 'stale cleanup cannot hide the new fullscreen layout')
  assert.equal(calls[1].width, 900)
  releases.shift()!()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[2].resource, renewed, 'opaque resource retained exactly')
  releases.shift()!()
})

test('a failed presentation does not discard the final hide', async () => {
  const resource = { token: 'cap_abcdefghijklmnopqrstuvwxyz', semanticRevision: 'browser-1', expiresAt: '2026-10-01T00:00:00Z' }
  const calls: boolean[] = []
  const errors: unknown[] = []
  const enqueue = createNativePresentationQueue(async input => {
    calls.push(input.visible)
    if (input.visible) throw new Error('failed')
  })
  const input = { x: 0, y: 0, width: 400, height: 300, visible: true }
  enqueue({ input, resource, onError: error => errors.push(error) })
  enqueue({ input: { ...input, visible: false }, resource, onError: error => errors.push(error) })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [true, false])
  assert.equal(errors.length, 1)
})
