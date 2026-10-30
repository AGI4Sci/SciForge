import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TERMINAL_RENDERER_BOTTOM_PANEL_CONTRACT,
  TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION,
  TERMINAL_RENDERER_COMMAND_CONTRIBUTION,
  TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRACT,
  domainPackageDefinition
} from './definition'

test('declares the official package-owned terminal surfaces', () => {
  assert.equal(domainPackageDefinition.publisher?.id, 'sciforge')
  assert.equal(domainPackageDefinition.packageName, '@sciforge/domain-terminal')
  assert.equal(TERMINAL_RENDERER_COMMAND_CONTRIBUTION.id, 'terminal.open')
  assert.equal(
    TERMINAL_RENDERER_BOTTOM_PANEL_CONTRIBUTION.id,
    'terminal.workbench-bottom-panel'
  )
  assert.deepEqual(TERMINAL_RENDERER_BOTTOM_PANEL_CONTRACT, {
    location: 'workbench.bottom-panel',
    title: 'Terminal',
    resourceKind: 'host.controlled-process'
  })
  assert.deepEqual(TERMINAL_RENDERER_TOOLBAR_ACTION_CONTRACT, {
    location: 'workbench.topbar',
    commandId: 'terminal.open',
    label: 'rightPanelTerminal'
  })
})
