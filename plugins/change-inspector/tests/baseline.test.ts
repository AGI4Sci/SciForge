/**
 * The plugin core against outputs saved from the static-verified plugin. This
 * keeps the parity guarantee after the static module is removed. The giant
 * truncation sessions are intentionally not part of the golden file (they
 * would bloat it); parity.test.ts and change-observation.test.ts pin them.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { corpusSessions, corpusSteps, rejectionSteps } from './cases.js'
import { runPluginScenario } from './runner.js'

type Golden = {
  scenarios: Record<string, readonly unknown[]>
}

const golden = JSON.parse(
  await readFile(new URL('./baseline/golden.json', import.meta.url), 'utf8')
) as Golden

test('plugin core reproduces the saved golden baseline', async () => {
  const stepsByName = {
    corpus: corpusSteps(),
    rejections: rejectionSteps()
  } as const
  for (const [name, expected] of Object.entries(golden.scenarios)) {
    const steps = stepsByName[name as keyof typeof stepsByName]
    assert.ok(steps, `unknown golden scenario ${name}`)
    const actual = await runPluginScenario(steps, { sessions: corpusSessions() })
    assert.deepEqual(actual, expected, `scenario ${name} diverged from golden baseline`)
  }
})
