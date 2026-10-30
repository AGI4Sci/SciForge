import { build } from 'esbuild'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? `${root}/dist`)
await mkdir(out, { recursive: true })
await build({ absWorkingDir: root, entryPoints: {
  'python-process': 'src/python-process.ts',
  index: 'src/dsh-adapter.ts',
  core: '../../packages/domains/project-dag/src/core/index.ts'
}, outdir: out, bundle: true, splitting: true, platform: 'node', format: 'esm', target: 'node22',
  sourcemap: false, metafile: true }).then(async result => {
    await writeFile(`${out}/metafile.json`, JSON.stringify(result.metafile, null, 2))
  })
await copyFile(`${root}/package.json`, `${out}/package.json`)
console.log(JSON.stringify({ out, entry: 'index.js' }))
