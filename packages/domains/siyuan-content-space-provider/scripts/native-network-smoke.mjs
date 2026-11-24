import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const directory = await mkdtemp(join(tmpdir(), 'sciforge-notes-network-'))
const here = dirname(fileURLToPath(import.meta.url))
try {
  const outfile = join(directory, 'native-ai-session.cjs')
  await build({ entryPoints: [join(here, '../src/main/native-ai-session.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" }, define: { 'import.meta.url': '__importMetaUrl' } })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), [join(here, 'native-network-smoke.cjs'), outfile], { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  process.exitCode = code === 0 ? 0 : 1
} finally { await rm(directory, { recursive: true, force: true }) }
