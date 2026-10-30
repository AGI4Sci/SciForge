import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const repoNodeModules = join(here, '..', '..', 'node_modules')
const out = join(here, 'dist')

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await esbuild.build({
  entryPoints: [join(here, 'src', 'dsh-adapter', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(out, 'main.js'),
  // Native canvas bindings ship with the plugin directory (plugin-local
  // node_modules) and load in the plugin child process; everything else is
  // bundled from the repository workspace packages.
  external: ['@napi-rs/canvas'],
  nodePaths: [repoNodeModules],
  logLevel: 'error'
})
console.log('built', join(out, 'main.js'))
