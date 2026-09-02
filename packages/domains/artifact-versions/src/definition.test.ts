import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

test('artifact versions exposes owner capabilities and a bounded Research summary without a standalone panel', () => {
  assert.equal(domainPackageDefinition.module.priority, 170)
  assert.ok(
    domainPackageDefinition.entrypoints.every((entrypoint) =>
      entrypoint.contributions.every((contribution) => contribution.priority === 170)
    )
  )
  assert.equal(
    ARTIFACT_VERSIONS_RENDERER_RESEARCH_SUMMARY_CONTRIBUTION.kind,
    'renderer.research-summary.v1'
  )
  const rendererKinds = domainPackageDefinition.entrypoints
    .find(({ process }) => process === 'renderer')
    ?.contributions.map(({ kind }) => kind)
  assert.deepEqual(rendererKinds, ['renderer.research-summary.v1'])
  assert.equal(
    Object.hasOwn(domainPackageDefinition.contributionContracts, 'artifact-versions.workbench-right-panel'),
    false
  )
  assert.equal(
    Object.hasOwn(domainPackageDefinition.contributionContracts, 'artifact-versions.resource-navigation'),
    false
  )
})
