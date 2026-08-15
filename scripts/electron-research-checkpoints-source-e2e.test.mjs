import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const scriptUrl = new URL('./electron-research-checkpoints-source-e2e.mjs', import.meta.url)

test('source Electron checkpoint E2E uses the real Agent Runtime and default recording', async () => {
  const source = await readFile(scriptUrl, 'utf8')
  assert.match(source, /rendererAgentCall\(first\.window, 'startThread'/u)
  assert.match(source, /rendererAgentCall\(first\.window, 'startTurn'/u)
  assert.match(source, /recordingMode !== 'automatic'/u)
  assert.match(source, /automatic\.recording\.versionCount !== 1/u)
  assert.doesNotMatch(source, /research-checkpoints\.start/u)
  assert.doesNotMatch(source, /research-checkpoints\.stop/u)
  assert.doesNotMatch(source, /__SCIFORGE_ELECTRON_RESEARCH_CHECKPOINT_SMOKE__/u)
  assert.match(source, /SCIFORGE_ELECTRON_SMOKE:\s*'0'/u)
})

test('source Electron checkpoint E2E proves V2 exact reads and compact researcher UI', async () => {
  const source = await readFile(scriptUrl, 'utf8')
  for (const actionId of [
    'artifact-versions.describe-v2',
    'artifact-versions.list-v2',
    'artifact-versions.content.read-range-v2'
  ]) {
    assert.ok(source.includes(actionId), `missing ${actionId}`)
  }
  assert.ok(source.includes('[data-research-checkpoint-state="committed"]'))
  assert.match(source, /Open research dossier\|打开科研档案/u)
  assert.match(source, /Chat timeline still exposes output artifacts/u)
  assert.match(source, /Chat timeline still exposes provenance detail/u)
})

test('source Electron checkpoint E2E retains hostile lifecycle and persistence probes', async () => {
  const source = await readFile(scriptUrl, 'utf8')
  assert.match(source, /waitForTerminalGate\(timeoutMs\)/u)
  assert.match(source, /reloadSourceRenderer\(first\.window/u)
  assert.match(source, /router\.releaseTerminal\(\)/u)
  assert.match(source, /assertDigestMismatchFailsClosed/u)
  assert.match(source, /findDurableCompletionEvent/u)
  assert.match(source, /restartPersistenceVerified:\s*true/u)
  assert.match(source, /managedCodexHomeIsolated:\s*true/u)
  assert.match(source, /window\.on\('crash'/u)
  assert.match(source, /window\.on\('pageerror'/u)
  assert.match(source, /app\.on\('close'/u)
  assert.match(source, /finally\s*\{[\s\S]*removeTemporaryDirectory/u)
})
