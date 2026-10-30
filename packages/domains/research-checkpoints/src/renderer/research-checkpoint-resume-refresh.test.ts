import assert from 'node:assert/strict'
import test from 'node:test'

import {
  installResearchCheckpointResumeRefresh,
  type ResearchCheckpointResumeDocument,
  type ResearchCheckpointResumeWindow
} from './research-checkpoint-resume-refresh.js'

function eventTarget<T extends 'focus' | 'visibilitychange'>() {
  const listeners = new Set<() => void>()
  return {
    addEventListener: (_type: T, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: T, listener: () => void) => listeners.delete(listener),
    dispatch: () => listeners.forEach((listener) => listener()),
    size: () => listeners.size
  }
}

test('coalesces visible focus signals and removes listeners on cleanup', async () => {
  const visibility = eventTarget<'visibilitychange'>()
  const focus = eventTarget<'focus'>()
  const documentTarget = {
    visibilityState: 'visible',
    ...visibility
  } satisfies ResearchCheckpointResumeDocument
  const windowTarget = focus satisfies ResearchCheckpointResumeWindow
  let refreshes = 0
  const cleanup = installResearchCheckpointResumeRefresh(() => {
    refreshes += 1
  }, { documentTarget, windowTarget })

  visibility.dispatch()
  focus.dispatch()
  await Promise.resolve()
  assert.equal(refreshes, 1)
  assert.equal(visibility.size(), 1)
  assert.equal(focus.size(), 1)

  cleanup()
  focus.dispatch()
  await Promise.resolve()
  assert.equal(refreshes, 1)
  assert.equal(visibility.size(), 0)
  assert.equal(focus.size(), 0)
})

test('does not refresh while the app is hidden', async () => {
  const visibility = eventTarget<'visibilitychange'>()
  const focus = eventTarget<'focus'>()
  const documentTarget = {
    visibilityState: 'hidden',
    ...visibility
  } satisfies ResearchCheckpointResumeDocument
  let refreshes = 0
  const cleanup = installResearchCheckpointResumeRefresh(() => {
    refreshes += 1
  }, {
    documentTarget,
    windowTarget: focus satisfies ResearchCheckpointResumeWindow
  })

  visibility.dispatch()
  focus.dispatch()
  await Promise.resolve()
  assert.equal(refreshes, 0)
  cleanup()
})
