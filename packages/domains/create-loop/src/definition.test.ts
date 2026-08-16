import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WORKFLOW_AUTOMATION_CAPABILITY_FACTORY_CONTRIBUTION,
  WORKFLOW_AUTOMATION_DOMAIN_MODULE_ID,
  WORKFLOW_AUTOMATION_DOMAIN_PACKAGE_NAME,
  WORKFLOW_AUTOMATION_RENDERER_COMMAND_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_I18N_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  WORKFLOW_AUTOMATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

test('declares the canonical Create Loop package identity', () => {
  assert.equal(WORKFLOW_AUTOMATION_DOMAIN_PACKAGE_NAME, '@sciforge/domain-create-loop')
  assert.equal(WORKFLOW_AUTOMATION_DOMAIN_MODULE_ID, 'sciforge.create-loop')
  assert.equal(domainPackageDefinition.module.version, '1.1.0')
})

test('owns main runtime and command-driven renderer contributions', () => {
  assert.deepEqual(
    [
      WORKFLOW_AUTOMATION_CAPABILITY_FACTORY_CONTRIBUTION,
      WORKFLOW_AUTOMATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
      WORKFLOW_AUTOMATION_RENDERER_COMMAND_CONTRIBUTION,
      WORKFLOW_AUTOMATION_RENDERER_RIGHT_PANEL_CONTRIBUTION,
      WORKFLOW_AUTOMATION_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
      WORKFLOW_AUTOMATION_RENDERER_I18N_CONTRIBUTION
    ].map(({ kind, id }) => ({ kind, id })),
    [
      { kind: 'main.capability-factory', id: 'create-loop.capabilities' },
      { kind: 'main.runtime-lifecycle', id: 'create-loop.runtime-lifecycle' },
      { kind: 'renderer.command', id: 'create-loop.open' },
      {
        kind: 'renderer.workbench-right-panel',
        id: 'create-loop.workbench-right-panel'
      },
      {
        kind: 'renderer.workbench-toolbar-action',
        id: 'create-loop.workbench-toolbar-action'
      },
      { kind: 'renderer.i18n-resource', id: 'create-loop.translations' }
    ]
  )
  assert.deepEqual(
    domainPackageDefinition.contributionContracts[
      'create-loop.workbench-right-panel'
    ],
    {
      location: 'workbench.right-panel',
      title: 'Create Loop',
      resourceKind: 'create-loop-settings'
    }
  )
  assert.deepEqual(
    domainPackageDefinition.contributionContracts[
      'create-loop.workbench-toolbar-action'
    ],
    {
      location: 'workbench.topbar',
      commandId: 'create-loop.open',
      label: 'workflowAutomationToolbar'
    }
  )
})
