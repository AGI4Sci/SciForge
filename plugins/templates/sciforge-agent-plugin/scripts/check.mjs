import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const adapter = JSON.parse(await readFile(join(root, 'sciforge.adapter.json'), 'utf8'))

const requiredScripts = ['check', 'test', 'build']
for (const script of requiredScripts) {
  if (typeof packageJson.scripts?.[script] !== 'string' || !packageJson.scripts[script].trim()) {
    throw new Error(`package.json must define a non-empty ${script} script.`)
  }
}
if (typeof packageJson.name !== 'string' || !packageJson.name.startsWith('@sciforge/')) throw new Error('Use a canonical @sciforge/ package name.')
if (adapter.schemaVersion !== 1 || adapter.kind !== 'renderer' || adapter.reloadPolicy !== 'live') throw new Error('The template adapter must be a live renderer adapter.')
if (adapter.ui?.entry !== 'dist/ui/index.html') throw new Error('The renderer entry must be dist/ui/index.html.')
for (const path of ['src/main.mjs', 'src/ui/index.html', 'src/ui/sdk.mjs', 'scripts/build.mjs', 'test/template.test.mjs']) {
  await access(join(root, path))
}
console.log('SciForge plugin template checks passed.')
