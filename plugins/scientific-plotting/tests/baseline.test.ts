/**
 * The plugin core against outputs saved from the static-verified plugin. The
 * mapData scenario is deterministic once the ephemeral workspace path is
 * normalized, so the replay must reproduce the golden file exactly. This
 * keeps the parity guarantee after the static module is removed.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runBaselineScenarios, type BaselineGolden } from './scenario.js'

const golden = JSON.parse(
  await readFile(new URL('./baseline/golden.json', import.meta.url), 'utf8')
) as BaselineGolden

test('plugin core reproduces the saved golden baseline', async () => {
  // The saved macOS golden normalized /tmp before realpath, leaving /private.
  // Normalize only this known ephemeral slot; scenario verifies the real path.
  const expected = structuredClone(golden)
  const output = expected.scenarios['map-data']![0]!.output as { renderRequest: { workspaceRoot: string } }
  assert.equal(output.renderRequest.workspaceRoot, '/private<workspace>')
  output.renderRequest.workspaceRoot = '<workspace>'
  assert.deepEqual(await runBaselineScenarios(), expected)
})
