import { spawnSync } from 'node:child_process'
import { delimiter, resolve } from 'node:path'

const command = process.env.SCIFORGE_PYTHON_COMMAND || (process.platform === 'win32' ? 'python' : 'python3')
const result = spawnSync(command, process.argv.slice(2), {
  env: { ...process.env, PYTHONUTF8: '1', PYTHONPATH: [resolve('python'), process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
  stdio: 'inherit', windowsHide: true
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
