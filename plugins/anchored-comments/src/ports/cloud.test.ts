import assert from 'node:assert/strict'
import test from 'node:test'
import { createHostCloudPort } from './cloud.js'
const expectedBinding = { baseUrl: 'https://cloud.example.test', userId: 'user-1', deviceId: 'device-1', deviceRevision: 1, sessionGeneration: 'runtime:1' }

test('Cloud port forwards only the named Host operations', async () => {
  const calls: unknown[] = []
  const port = createHostCloudPort({ invoke: async (operation, input) => {
    calls.push({ operation, input })
    return operation === 'status' ? { state: 'ready', ...expectedBinding } : { contractVersion: 1, status: 503, body: { type: 'rest.error' } }
  } })
  assert.equal((await port.status()).state, 'ready')
  const request = { contractVersion: 1 as const, operationId: 'sciforge.cloud.command' as const, payload: {}, expectedBinding }
  assert.equal((await port.execute(request)).status, 503)
  assert.deepEqual(calls, [{ operation: 'status', input: {} }, { operation: 'execute', input: request }])
})

test('Cloud port refuses malformed or extra response authority', async () => {
  const port = createHostCloudPort({ invoke: async () => ({ contractVersion: 1, status: 200, body: {}, accessToken: 'unexpected' }) })
  await assert.rejects(port.execute({ contractVersion: 1, operationId: 'sciforge.cloud.command', payload: {}, expectedBinding }))
})

test('Cloud port rejects missing preflight binding without invoking Host', async () => {
  let calls = 0
  const port = createHostCloudPort({ invoke: async () => { calls++; return {} } })
  await assert.rejects(port.execute({ contractVersion: 1, operationId: 'sciforge.cloud.command', payload: {} } as never))
  assert.equal(calls, 0)
})
