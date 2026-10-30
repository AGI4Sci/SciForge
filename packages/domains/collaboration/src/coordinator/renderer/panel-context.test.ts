import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearProjectCoordinatorPanelContexts,
  clearProjectCoordinatorPanelContext,
  clearProjectCoordinatorSessionSelections,
  currentProjectCoordinatorPanelContext,
  currentProjectCoordinatorSessionSelection,
  setProjectCoordinatorPanelContext,
  setProjectCoordinatorSessionSelection
} from './panel-context.js'

test('panel context prefers the focused active Project target', () => {
  clearProjectCoordinatorPanelContexts()
  setProjectCoordinatorPanelContext({
    surfaceId: 'surface-background',
    projectId: 'prj_background',
    active: true,
    focused: false,
    updatedAt: 10
  })
  setProjectCoordinatorPanelContext({
    surfaceId: 'surface-focused',
    projectId: 'prj_focused',
    active: true,
    focused: true,
    updatedAt: 1
  })
  assert.equal(currentProjectCoordinatorPanelContext()?.projectId, 'prj_focused')
  clearProjectCoordinatorPanelContexts()
})

test('inactive panel targets are ignored and can be cleared independently', () => {
  clearProjectCoordinatorPanelContexts()
  setProjectCoordinatorPanelContext({
    surfaceId: 'surface-inactive',
    projectId: 'prj_inactive',
    active: false,
    focused: true
  })
  assert.equal(currentProjectCoordinatorPanelContext(), null)
  setProjectCoordinatorPanelContext({
    surfaceId: 'surface-active',
    projectId: 'prj_active',
    active: true,
    focused: false
  })
  clearProjectCoordinatorPanelContext('surface-active')
  assert.equal(currentProjectCoordinatorPanelContext(), null)
  clearProjectCoordinatorPanelContexts()
})

test('session Project selections survive panel unmount and remain keyed by Session', () => {
  clearProjectCoordinatorSessionSelections()
  setProjectCoordinatorSessionSelection({
    sessionId: 'session-a',
    projectId: 'prj_a',
    source: 'cloud'
  })
  assert.deepEqual(currentProjectCoordinatorSessionSelection('session-a'), {
    sessionId: 'session-a',
    projectId: 'prj_a',
    source: 'cloud',
    updatedAt: currentProjectCoordinatorSessionSelection('session-a')?.updatedAt
  })
  assert.equal(currentProjectCoordinatorSessionSelection('session-b'), null)

  setProjectCoordinatorSessionSelection({
    sessionId: 'session-a',
    source: 'local'
  })
  assert.deepEqual(
    currentProjectCoordinatorSessionSelection('session-a')?.source,
    'local'
  )
  assert.equal(currentProjectCoordinatorSessionSelection('session-a')?.projectId, null)
  clearProjectCoordinatorSessionSelections()
})
