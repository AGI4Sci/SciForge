import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))

test('template declares the host and renderer contracts', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const adapter = JSON.parse(await readFile(join(root, 'sciforge.adapter.json'), 'utf8'))
  assert.equal(manifest.exports['.'], './dist/main.mjs')
  assert.equal(manifest.exports['./client'], './dist/ui/sdk.mjs')
  assert.equal(adapter.ui.entry, 'dist/ui/index.html')
  assert.equal(adapter.reloadPolicy, 'live')
})

test('template includes a backend, iframe UI, SDK, and bounded build scripts', async () => {
  for (const path of ['src/main.mjs', 'src/ui/index.html', 'src/ui/sdk.mjs', 'scripts/check.mjs', 'scripts/build.mjs']) {
    await access(join(root, path))
  }
  const main = await readFile(join(root, 'src/main.mjs'), 'utf8')
  const ui = await readFile(join(root, 'src/ui/index.html'), 'utf8')
  assert.match(main, /export async function activate/u)
  assert.match(main, /getRendererContributions/u)
  assert.match(ui, /createSciForgeUiSdk/u)
})
