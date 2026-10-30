/**
 * Regenerates tests/baseline/golden.json from the plugin core. While the
 * static module exists, parity.test.ts is the primary guard; the golden file
 * keeps the baseline after the static module is removed. Run:
 *   node --import tsx tests/baseline/generate-baseline.ts
 */
import { writeFile } from 'node:fs/promises'
import { corpusSessions, corpusSteps, rejectionSteps } from '../cases.js'
import { runPluginScenario } from '../runner.js'

async function main(): Promise<void> {
  const scenarios: Record<string, readonly unknown[]> = {}
  for (const [name, steps] of [
    ['corpus', corpusSteps()],
    ['rejections', rejectionSteps()]
  ] as const) {
    scenarios[name] = await runPluginScenario(steps, { sessions: corpusSessions() })
  }
  const target = new URL('./golden.json', import.meta.url)
  await writeFile(target, `${JSON.stringify({ scenarios }, null, 2)}\n`, 'utf8')
  console.log(`wrote ${target.pathname}`)
}

await main()
