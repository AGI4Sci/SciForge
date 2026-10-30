/**
 * The plugin core against outputs saved from the static-verified plugin. The
 * scenarios are fully deterministic (fixed store clock, fixed recording-id
 * sequence, deterministic harness digests), so the replay must reproduce the
 * golden file byte-for-byte. This keeps the parity guarantee after the static
 * module is removed.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runBaselineScenarios, type BaselineGolden } from './scenario.js'

const golden = JSON.parse(
  await readFile(new URL('./baseline/golden.json', import.meta.url), 'utf8')
) as BaselineGolden

test('plugin runtime reproduces the saved golden baseline', async () => {
  const actual = await runBaselineScenarios()
  assert.deepEqual(actual, golden)
})
