import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_DAG_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION,
  PROJECT_DAG_DOMAIN_MODULE_ID,
  PROJECT_DAG_DOMAIN_PACKAGE_NAME,
  PROJECT_DAG_RENDERER_I18N_CONTRIBUTION,
  PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
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
      PROJECT_DAG_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION,
      PROJECT_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
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
        kind: 'main.agent-artifact-consumer',
        id: 'project-dag.turn-completed'
      },
      {
        kind: 'renderer.workbench-right-panel',
        id: 'project-dag.workbench-right-panel'
      },
      {
        kind: 'renderer.i18n-resource',
        id: 'project-dag.translations'
      }
    ]
  )
})

test('Project DAG definition stays free of host-private contribution contracts', () => {
  assert.deepEqual(domainPackageDefinition.contributionContracts, {})
})
