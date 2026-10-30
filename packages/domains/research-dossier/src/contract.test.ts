import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createResearchDossierActivation,
  moveResearchDossierActivationToPage,
  researchDossierActivationPayloadV1Schema
} from './contract.js'

test('research dossier activation accepts only exact public identities', () => {
  const activation = createResearchDossierActivation({
    kind: 'artifact-version',
    versionId: 'artifact-version:figure:2'
  }, {
    page: 'versions',
    expectedDigest: `sha256:${'a'.repeat(64)}`,
    revision: 4
  })
  assert.deepEqual(activation, {
    contributionId: 'research-dossier.workbench-right-panel',
    revision: 4,
    payload: {
      contractVersion: 1,
      target: {
        kind: 'artifact-version',
        versionId: 'artifact-version:figure:2'
      },
      page: 'versions',
      expectedDigest: `sha256:${'a'.repeat(64)}`
    }
  })
  assert.throws(() => researchDossierActivationPayloadV1Schema.parse({
    contractVersion: 1,
    target: {
      kind: 'compute-run',
      runId: 'run-1',
      workspaceRoot: '/private/host/path'
    },
    page: 'overview'
  }))
})

test('research dossier page navigation preserves target and session history input', () => {
  const activation = createResearchDossierActivation({
    kind: 'compute-run',
    runId: 'run-1'
  })
  const next = moveResearchDossierActivationToPage(
    researchDossierActivationPayloadV1Schema.parse(activation.payload),
    'reproduction',
    2
  )
  assert.deepEqual(next.payload, {
    contractVersion: 1,
    target: { kind: 'compute-run', runId: 'run-1' },
    page: 'reproduction'
  })
  assert.equal(next.revision, 2)
})
