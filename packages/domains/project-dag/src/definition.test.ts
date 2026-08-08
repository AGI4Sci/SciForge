import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_DAG_ARTIFACT_CONSUMER_CONTRIBUTION,
  PROJECT_DAG_DOMAIN_MODULE_ID,
  PROJECT_DAG_DOMAIN_PACKAGE_NAME,
  PROJECT_DAG_RENDERER_COMMAND_CONTRIBUTION,
  PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  PROJECT_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

test('Project DAG definition declares canonical package identity', () => {
  assert.equal(PROJECT_DAG_DOMAIN_PACKAGE_NAME, '@sciforge/domain-project-dag')
  assert.equal(PROJECT_DAG_DOMAIN_MODULE_ID, 'sciforge.project-dag')
  assert.equal(domainPackageDefinition.contractVersion, 1)
  assert.equal(domainPackageDefinition.kind, 'trusted-compile-time')
})

test('Project DAG manifest owns main lifecycle and renderer contributions', () => {
  assert.deepEqual(
    [
      PROJECT_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
      PROJECT_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION,
      PROJECT_DAG_ARTIFACT_CONSUMER_CONTRIBUTION,
      PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
      PROJECT_DAG_RENDERER_COMMAND_CONTRIBUTION,
      PROJECT_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
      PROJECT_DAG_RENDERER_I18N_CONTRIBUTION
    ].map(({ kind, id }) => ({ kind, id })),
    [
      {
        kind: 'main.capability-factory',
        id: 'project-dag.capabilities'
      },
      {
        kind: 'main.runtime-lifecycle',
        id: 'project-dag.runtime-lifecycle'
      },
      {
        kind: 'main.artifact-consumer',
        id: 'project-dag.artifacts'
      },
      {
        kind: 'renderer.workbench-right-panel',
        id: 'project-dag.workbench-right-panel'
      },
      {
        kind: 'renderer.command',
        id: 'project-dag.open'
      },
      {
        kind: 'renderer.workbench-toolbar-action',
        id: 'project-dag.workbench-toolbar-action'
      },
      {
        kind: 'renderer.i18n-resource',
        id: 'project-dag.translations'
      }
    ]
  )
})

test('Project DAG definition declares its stable toolbar command reference', () => {
  assert.deepEqual(
    domainPackageDefinition.contributionContracts['project-dag.workbench-toolbar-action'],
    {
      location: 'workbench.topbar',
      commandId: 'project-dag.open',
      label: 'rightPanelProjectDag'
    }
  )
})
