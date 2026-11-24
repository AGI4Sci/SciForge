import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = await mkdtemp(join(tmpdir(), 'siyuan-native-ai-smoke-'))
const result = join(root, 'result.json')
const bundle = join(root, 'fixture.mjs')
await require('esbuild').build({
  entryPoints: [fileURLToPath(new URL('./native-ai.fixture.ts', import.meta.url))],
  outfile: bundle, bundle: true, platform: 'node', format: 'esm', external: ['electron'], logLevel: 'warning'
})
const env = { ...process.env, SIYUAN_AI_SMOKE_RESULT: result, SIYUAN_AI_SMOKE_PROFILE: join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [bundle, '--disable-gpu'], {
  env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
})
let output = ''
child.stdout.on('data', bytes => { output += bytes })
child.stderr.on('data', bytes => { output += bytes })
const timer = setTimeout(() => child.kill(), 60_000)
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
clearTimeout(timer)
try { console.log(await readFile(result, 'utf8')) }
catch { console.log(output.slice(-5000)) }
if (code !== 0) process.exitCode = 1
