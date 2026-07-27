import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const uiPath = new URL('../ui/index.html', import.meta.url)

test('Project DAG iframe renders non-quantitative update telemetry as indeterminate', async () => {
  const html = await readFile(uiPath, 'utf8')

  assert.doesNotMatch(html, /(?:68|86)%/)
  assert.doesNotMatch(html, /aria-valuenow\s*=/)
  assert.doesNotMatch(html, /progress-percent/)
  assert.match(html, /id="progress-phase"/)
  assert.match(html, /`阶段 \$\{job\.status\}`/)
  assert.match(html, /已尝试 \$\{Number\(job\.attempts\|\|0\)}/)
  assert.match(html, /job\.last_error/)
  assert.match(html, /track\.hidden=failed/)
  assert.match(html, /classList\.toggle\('indeterminate',!failed\)/)
  assert.match(html, /removeAttribute\('aria-valuenow'\)/)
})
