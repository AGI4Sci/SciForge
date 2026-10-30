/**
 * Regenerates tests/baseline/golden.json from the plugin core. While the
 * static module exists, the ported runtime.test.ts and capability-parity
 * tests are the primary guards; the golden file keeps the baseline after the
 * static module is removed. Run:
 *   node --import tsx tests/baseline/generate-baseline.ts
 */
import { writeFile } from 'node:fs/promises'
import { runBaselineScenarios } from '../scenario.js'

async function main(): Promise<void> {
  const golden = await runBaselineScenarios()
  const target = new URL('./golden.json', import.meta.url)
  await writeFile(target, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')
  console.log(`wrote ${target.pathname}`)
}

await main()
