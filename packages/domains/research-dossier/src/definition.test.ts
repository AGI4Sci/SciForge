import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRACT,
  RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRACT,
  domainPackageDefinition
} from './definition.js'

test('research dossier is renderer-only and owns one right-panel surface', () => {
  assert.deepEqual(domainPackageDefinition.entrypoints.map(({ process }) => process), ['renderer'])
  assert.deepEqual(RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRACT, {
    location: 'workbench.right-panel',
    title: 'Research Dossier',
    resourceKind: 'research-dossier'
  })
  assert.deepEqual(RESEARCH_DOSSIER_RENDERER_RESOURCE_NAVIGATION_CONTRACT, {
    resourceKinds: ['artifact-version', 'compute-run'],
    target: {
      surface: 'right-panel',
      contributionId: 'research-dossier.workbench-right-panel'
    }
  })
  assert.equal(domainPackageDefinition.entrypoints[0]?.contributions.filter(
    ({ kind }) => kind === 'renderer.workbench-toolbar-action'
  ).length, 1)
})
