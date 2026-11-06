import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('fixed scientific audit scenarios execute registered owner, client and DOM paths', async () => {
  const output = join(await mkdtemp(join(tmpdir(), 'audit-evaluation-test-')), 'report.json')
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/scientific-audit-evaluation.mjs', '--output', output], { encoding: 'utf8', timeout: 120000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(report.failures, 0)
  assert.ok(report.results.length >= 11)
  assert.ok(report.results.every(value => value.latencyMs >= 0 && !value.falsePositive && !value.miss))
})
