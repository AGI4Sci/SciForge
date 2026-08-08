import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const html = readFileSync(
  fileURLToPath(new URL('../../ui/index.html', import.meta.url)),
  'utf8'
)

test('Evidence DAG UI exposes every v3 node family and reproducibility relation', () => {
  for (const type of [
    'source_assertion',
    'reasoning',
    'claim',
    'finding',
    'assumption',
    'artifact',
    'dataset_version',
    'observation',
    'experiment_run',
    'analysis_run',
    'software_version',
    'environment',
    'agent',
    'parameter_set',
    'tool_invocation',
    'approval_decision',
    'workflow_run',
    'conclusion'
  ]) {
    assert.match(html, new RegExp(`\\b${type}\\s*:`))
  }
  for (const relation of [
    'used',
    'generated_by',
    'part_of',
    'authorized_by',
    'rerun_of',
    'replicates',
    'fails_to_replicate'
  ]) {
    assert.match(html, new RegExp(relation))
  }
  assert.match(html, /sumEvidence/u)
  assert.match(html, /sumActivities/u)
  assert.match(html, /sumConclusions/u)
})

test('claim-like inspector traces lineage and downloads ready or blocked canonical specs', () => {
  assert.match(html, /function isConclusionLike/u)
  assert.match(html, /\/conclusion-lineage\?/u)
  assert.match(html, /\/rerun-spec\?/u)
  assert.match(html, /Download rerun spec/u)
  assert.match(html, /executionReady=false/u)
  assert.match(html, /new Blob\(\[JSON\.stringify\(spec/u)
  assert.match(html, /\.sciforge-rerun\.json/u)
  assert.match(html, /\.slice\(0, 120\)/u)
  assert.match(html, /authorization.*Bearer \$\{AUTH_TOKEN\}/u)
  assert.match(html, /Structural trace closure/u)
  assert.match(html, /Scientific sufficiency/u)
  assert.match(html, /not assessed by structural closure/u)
})
