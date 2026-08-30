import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearProjectCoordinatorPanelContexts,
  clearProjectCoordinatorPanelContext,
  currentProjectCoordinatorPanelContext,
  setProjectCoordinatorPanelContext
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

