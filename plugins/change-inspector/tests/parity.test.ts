/**
 * Parity with the in-tree static module. The plugin operation must reproduce
 * the static handler's observable data exactly: the projected snapshot, the
 * canonical resource id and every rejection message. The Broker resource
 * handle that the static handler additionally returns is the host thin
 * layer's concern (G3) and is normalized away by the static runner. The
 * static module is imported by relative path, which is allowed in tests only.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANGE_INSPECTOR_CAPABILITY_IDS as STATIC_IDS } from '../../../packages/domains/change-inspector/src/contract.js'
import {
  CHANGE_INSPECTOR_CAPABILITY_IDS,
  changeInspectorOpenSessionResultSchema
} from '../src/contract.js'
import {
  corpusSessions,
  corpusSteps,
  hugePatchSession,
  manyChangesSession,
  rejectionSteps
} from './cases.js'
import { runPluginScenario } from './runner.js'
import { runStaticScenario } from './static-harness.js'

test('capability ids match the static module', () => {
  assert.deepEqual(CHANGE_INSPECTOR_CAPABILITY_IDS, STATIC_IDS)
  assert.equal(STATIC_IDS.openSession, 'change-inspector.open-session')
})

test('standard corpus: static handler and plugin operation produce identical results', async () => {
  const steps = corpusSteps()
  const pluginResults = await runPluginScenario(steps, { sessions: corpusSessions() })
  const staticResults = await runStaticScenario(steps, { sessions: corpusSessions() })
  assert.deepEqual(pluginResults, staticResults)
  assert.equal(pluginResults.length, steps.length)
  for (const result of pluginResults) {
    assert.ok(
      'value' in (result as Record<string, unknown>),
      `corpus step threw: ${JSON.stringify(result)}`
    )
    changeInspectorOpenSessionResultSchema.parse((result as { value: unknown }).value)
  }
})

test('rejections: invalid inputs and policy violations behave identically', async () => {
  const steps = rejectionSteps()
  const pluginResults = await runPluginScenario(steps, { sessions: corpusSessions() })
  const staticResults = await runStaticScenario(steps, { sessions: corpusSessions() })
  assert.deepEqual(pluginResults, staticResults)
  const threwCount = pluginResults.filter((entry) => 'threw' in (entry as object)).length
  assert.equal(threwCount, steps.length, 'every rejection step must throw on both sides')
})

test('truncation limits: >5000 changes truncate identically; >2MB patch rejects identically', async () => {
  const steps = [
    { input: { sessionId: 'many', runtimeId: 'codex' } },
    { input: { sessionId: 'huge', runtimeId: 'codex' } }
  ]
  const sessions = () => ({ many: manyChangesSession(), huge: hugePatchSession() })
  const pluginResults = await runPluginScenario(steps, { sessions: sessions() })
  const staticResults = await runStaticScenario(steps, { sessions: sessions() })
  assert.deepEqual(pluginResults, staticResults)
  const [many, huge] = pluginResults as readonly [
    { value: { snapshot: { truncated: boolean; changes: readonly unknown[] } } },
    { threw: string }
  ]
  assert.equal(many.value.snapshot.truncated, true)
  assert.equal(many.value.snapshot.changes.length, 5_000)
  assert.match(huge.threw, /Too big: expected string to have <=2000000 characters/u)
})
