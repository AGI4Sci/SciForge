import assert from 'node:assert/strict'
import test from 'node:test'
import {
  domainRendererWorkbenchRightPanelContractSchema,
  domainRendererWorkbenchToolbarActionContractSchema
} from '@sciforge/domain-sdk/renderer'
import {
  ARTIFACT_VERSIONS_RENDERER_COMMAND_CONTRIBUTION,
  ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRACT,
  ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRACT,
  domainPackageDefinition
} from './definition.js'

test('manifest publishes the artifact history panel through generic renderer contracts', () => {
  assert.equal(domainPackageDefinition.module.priority, 170)
  assert.ok(
    domainPackageDefinition.entrypoints.every((entrypoint) =>
      entrypoint.contributions.every((contribution) => contribution.priority === 170)
    )
  )
  assert.deepEqual(
    domainRendererWorkbenchRightPanelContractSchema.parse(
      ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRACT
    ),
    {
      location: 'workbench.right-panel',
      title: 'Artifact Versions',
      resourceKind: 'artifact-version'
    }
  )
  assert.deepEqual(
    domainRendererWorkbenchToolbarActionContractSchema.parse(
      ARTIFACT_VERSIONS_RENDERER_TOOLBAR_ACTION_CONTRACT
    ),
    {
      location: 'workbench.topbar',
      commandId: ARTIFACT_VERSIONS_RENDERER_COMMAND_CONTRIBUTION.id,
      label: 'rightPanelArtifactVersions'
    }
  )
  assert.equal(
    ARTIFACT_VERSIONS_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind,
    'renderer.workbench-right-panel'
  )
})
