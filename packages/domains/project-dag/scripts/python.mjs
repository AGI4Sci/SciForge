import { spawnSync } from 'node:child_process'
import { delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const command = process.env.SCIFORGE_PYTHON_COMMAND || (process.platform === 'win32' ? 'python' : 'python3')
const projectPython = fileURLToPath(new URL('../python', import.meta.url))
const evidencePython = fileURLToPath(new URL('../python', import.meta.resolve('@sciforge/domain-evidence-dag/contract')))
const result = spawnSync(command, process.argv.slice(2), {
  env: {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONPATH: [projectPython, evidencePython, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
  },
  stdio: 'inherit',
  windowsHide: true
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
