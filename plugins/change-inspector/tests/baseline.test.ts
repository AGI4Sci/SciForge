/**
 * Immutable legacy golden is a BUSINESS DIFF snapshot, not the current authority
 * contract. Do not resample it to hide regressions. New authority rejection and
 * byte/revision metadata contracts are pinned by separate unit/real-Host tests.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { corpusSessions, corpusSteps } from './cases.js'
import { runPluginScenario } from './runner.js'

const golden = JSON.parse(await readFile(new URL('./baseline/golden.json', import.meta.url), 'utf8')) as {
  scenarios: { corpus: readonly unknown[]; rejections: readonly unknown[] }
}

/** Narrow ignore list only: no filtering of changes, patch text, status or identity. */
function businessDiff(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(businessDiff)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['revision', 'patchBytes', 'patchTruncated', 'truncationReasons'].includes(key)
  ).map(([key, child]) => [key, businessDiff(child)]))
}

test('business diff corpus matches the immutable legacy golden excluding only new metadata/hash revision', async () => {
  const actual = await runPluginScenario(corpusSteps(), { sessions: corpusSessions() })
  assert.deepEqual(businessDiff(actual), businessDiff(golden.scenarios.corpus))
})

test('legacy authorization snapshots remain archived rather than claimed as current acceptance', () => {
  assert.equal(golden.scenarios.rejections.length > 0, true)
})
