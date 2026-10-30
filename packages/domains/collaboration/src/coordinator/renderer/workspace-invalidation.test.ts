import assert from 'node:assert/strict'
import test from 'node:test'

import {
  publishProjectCoordinatorWorkspaceInvalidation,
  subscribeProjectCoordinatorWorkspaceInvalidation
} from './workspace-invalidation.js'

test('workspace invalidation is package-local and disposal is idempotent', () => {
  const observed: number[] = []
  const dispose = subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    observed.push(observed.length + 1)
  })

  publishProjectCoordinatorWorkspaceInvalidation()
  dispose()
  dispose()
  publishProjectCoordinatorWorkspaceInvalidation()

  assert.deepEqual(observed, [1])
})
