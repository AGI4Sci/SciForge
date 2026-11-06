/**
 * Baseline golden snapshot of the plugin operations.
 *
 * The snapshot is generated from the plugin core against a throwaway workspace
 * with a fixed clock; `npm run baseline` is the only way to update it.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { baselineSnapshot } from './baseline/generate.js'

const GOLDEN = join(fileURLToPath(new URL('.', import.meta.url)), 'baseline', 'golden.json')

test('baseline snapshot matches the committed golden file', async () => {
  const golden = JSON.parse(await readFile(GOLDEN, 'utf8')) as Record<string, unknown>
  assert.deepEqual(await baselineSnapshot(), golden)
})

test('golden snapshot covers exactly the scripted scenarios', async () => {
  const golden = JSON.parse(await readFile(GOLDEN, 'utf8')) as Record<string, unknown>
  assert.deepEqual(Object.keys(golden).sort(), [
    'capture-unavailable',
    'delete',
    'empty-list',
    'feedback-status',
    'feedback-submit-unconfigured',
    'get',
    'list-by-target',
    'upsert'
  ])
})