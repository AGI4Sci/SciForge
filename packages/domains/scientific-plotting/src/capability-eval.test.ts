import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  SCIENTIFIC_PLOTTING_CAPABILITY_EVAL_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_WORKFLOW_EVAL_CASE_ID,
  SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH
} from './capability-eval.js'
import { SCIENTIFIC_PLOTTING_CAPABILITY_IDS } from './contract.js'

test('scientific plotting contribution owns all five action contracts', () => {
  assert.deepEqual(SCIENTIFIC_PLOTTING_CAPABILITY_EVAL_CONTRIBUTION.evaluationActionIds, [
    SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status,
    SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData,
    SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render,
    SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun,
    SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare
  ])
})

test('scientific plotting workflow fixture is package-owned and does not self-certify missing invocations', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-plotting-eval-'))
  try {
    const prepare = SCIENTIFIC_PLOTTING_CAPABILITY_EVAL_CONTRIBUTION.prepare
    const inspect = SCIENTIFIC_PLOTTING_CAPABILITY_EVAL_CONTRIBUTION.inspect
    assert.ok(prepare)
    assert.ok(inspect)
    const context = {
      caseId: SCIENTIFIC_PLOTTING_WORKFLOW_EVAL_CASE_ID,
      runId: 'run-plotting-fixture-test',
      workspaceDirectory: workspace
    }
    const fixture = await prepare(context)
    assert.ok(fixture)
    assert.deepEqual(fixture.paths, [SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH])
    const input = JSON.parse(await readFile(join(workspace, SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH), 'utf8'))
    assert.equal(input.figureId, 'capability-eval-line-fixture')
    const result = await inspect({ context, fixture, invocations: [] })
    assert.equal(result?.taskSuccess, false)
    assert.deepEqual(result?.verifiedActions, [])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
