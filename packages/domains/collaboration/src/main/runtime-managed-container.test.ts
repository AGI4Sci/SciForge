import assert from 'node:assert/strict'
import test from 'node:test'
import { managedContainerDisplayName } from './runtime.js'

test('managed Channel display name matches the Server stable string digest', () => {
  assert.equal(managedContainerDisplayName('usr_test'), 'sciforge-20d556f4b190')
})
