import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHANGE_INSPECTOR_RENDERER_COMMAND_CONTRIBUTION,
  CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  CHANGE_INSPECTOR_RENDERER_TOOLBAR_ACTION_CONTRACT,
  domainPackageDefinition
} from './definition.js'

test('declares one official package with command-owned toolbar activation', () => {
  assert.equal(domainPackageDefinition.publisher?.id, 'sciforge')
  assert.equal(CHANGE_INSPECTOR_RENDERER_COMMAND_CONTRIBUTION.id, 'change-inspector.open')
  assert.equal(
    CHANGE_INSPECTOR_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    'change-inspector.workbench-right-panel'
  )
  assert.deepEqual(CHANGE_INSPECTOR_RENDERER_TOOLBAR_ACTION_CONTRACT, {
    location: 'workbench.topbar',
    commandId: 'change-inspector.open',
    label: 'changeInspectorToolbar'
  })
})
