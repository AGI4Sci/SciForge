import assert from 'node:assert/strict'
import test from 'node:test'
import { managedContainerEnsureIdempotencyKey } from './runtime.js'

test('managed Channel retries use a fresh key while one request remains replay-safe', () => {
  const initial = managedContainerEnsureIdempotencyKey('usr_test', 'hep_test')
  const retryOne = managedContainerEnsureIdempotencyKey('usr_test', 'hep_test', '2\u0000req_retry_one')
  const retryOneReplay = managedContainerEnsureIdempotencyKey('usr_test', 'hep_test', '2\u0000req_retry_one')
  const retryTwo = managedContainerEnsureIdempotencyKey('usr_test', 'hep_test', '2\u0000req_retry_two')

  assert.equal(retryOneReplay, retryOne)
  assert.notEqual(retryOne, initial)
  assert.notEqual(retryTwo, retryOne)
})
