import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runValidation } from './validation-report.mjs'
test('report retains stage streams, nonzero exit and timeout as unknown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'validation-report-'))
  const report = await runValidation([
    { name: 'failure', command: process.execPath, args: ['-e', 'console.log("out"); console.error("err"); process.exitCode=7'], timeoutMs: 5000 },
    { name: 'timeout', command: process.execPath, args: ['-e', 'setTimeout(()=>{}, 10000)'], timeoutMs: 100 }
  ], join(root, 'report'))
  assert.equal(report.status, 'not-passed'); assert.equal(report.stages[0].exitCode, 7)
  assert.equal(report.stages[1].status, 'timed-out-unknown')
  assert.match(await readFile(join(root, 'report/0.stdout.log'), 'utf8'), /out/)
  assert.match(await readFile(join(root, 'report/0.stderr.log'), 'utf8'), /err/)
  assert.ok(report.stages.every(s => s.durationMs >= 0))
})
