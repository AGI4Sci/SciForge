/**
 * Architecture / Host lifecycle fixture acceptance; no live model, app or UI.
 * Requires the plugin's existing build artifact.
 *
 * node --import tsx scripts/change-inspector-plugin-acceptance.mjs [--json <path>] [--startup-tests]
 * --startup-tests also runs the existing source/packaged startup composition tests.
 */
import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAcceptance } from './change-inspector-acceptance-core.ts'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  let jsonPath
  let startupTests = false
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index]
    if (arg === '--startup-tests') startupTests = true
    else if (arg === '--json') {
      jsonPath = process.argv[++index]
      if (!jsonPath || jsonPath.startsWith('--')) throw new Error('--json requires an output path')
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  const report = await runAcceptance({
    repository,
    onStep: (step) => console.log(`ACCEPT ${step.step}: ${JSON.stringify(step.detail)}`)
  })
  if (startupTests) {
    const result = spawnSync(process.execPath, [
      resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run',
      'src/main/extensions/development-plugin-composition.test.ts'
    ], { cwd: repository, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Startup composition tests failed (${result.signal ?? result.status})`)
  }
  const finalReport = {
    ...report,
    startupComposition: startupTests ? 'existing source/packaged composition tests passed' : 'not run',
    applicationLaunched: false
  }
  if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(finalReport, null, 2)}\n`)
  console.log(JSON.stringify(finalReport, null, 2))
}

main().catch((error) => {
  console.error(`ACCEPTANCE FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
