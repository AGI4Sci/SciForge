import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVIDENCE_DAG_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION,
  EVIDENCE_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
  EVIDENCE_DAG_DOMAIN_MODULE_ID,
  EVIDENCE_DAG_DOMAIN_PACKAGE_NAME,
  EVIDENCE_DAG_RENDERER_COMMAND_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  EVIDENCE_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION,
  EVIDENCE_DAG_WRITE_EXPORT_ACTION_GUARD_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

test('declares Evidence DAG as one installed package with process-specific entrypoints', () => {
  assert.equal(EVIDENCE_DAG_DOMAIN_PACKAGE_NAME, '@sciforge/domain-evidence-dag')
  assert.equal(EVIDENCE_DAG_DOMAIN_MODULE_ID, 'sciforge.evidence-dag')
  assert.deepEqual(
    domainPackageDefinition.entrypoints.map(({ process, export: entryExport }) => [
      process,
      entryExport
    ]),
    [
      ['main', './main'],
      ['renderer', './renderer']
    ]
  )
})

test('declares every required contribution without a host feature map', () => {
  assert.deepEqual(
    domainPackageDefinition.entrypoints.flatMap((entrypoint) =>
      entrypoint.contributions.map(({ kind, id }) => `${kind}:${id}`)
    ),
    [
      'main.capability-factory:evidence-dag.capabilities',
      'main.runtime-lifecycle:evidence-dag.runtime-lifecycle',
      'main.agent-artifact-consumer:evidence-dag.agent-artifact-consumer',
      'main.action-guard:evidence-dag.write-export-guard',
      'renderer.workbench-right-panel:evidence-dag.workbench-right-panel',
      'renderer.command:evidence-dag.open',
      'renderer.workbench-toolbar-action:evidence-dag.workbench-toolbar-action',
      'renderer.i18n-resource:evidence-dag.translations'
    ]
  )
  assert.equal(EVIDENCE_DAG_CAPABILITY_FACTORY_CONTRIBUTION.id, 'evidence-dag.capabilities')
  assert.equal(EVIDENCE_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION.id, 'evidence-dag.runtime-lifecycle')
  assert.equal(
    EVIDENCE_DAG_AGENT_ARTIFACT_CONSUMER_CONTRIBUTION.id,
    'evidence-dag.agent-artifact-consumer'
  )
  assert.equal(
    EVIDENCE_DAG_WRITE_EXPORT_ACTION_GUARD_CONTRIBUTION.id,
    'evidence-dag.write-export-guard'
  )
  assert.equal(
    EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    'evidence-dag.workbench-right-panel'
  )
  assert.equal(
    EVIDENCE_DAG_RENDERER_COMMAND_CONTRIBUTION.id,
    'evidence-dag.open'
  )
  assert.equal(
    EVIDENCE_DAG_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id,
    'evidence-dag.workbench-toolbar-action'
  )
  assert.equal(EVIDENCE_DAG_RENDERER_I18N_CONTRIBUTION.id, 'evidence-dag.translations')
})
