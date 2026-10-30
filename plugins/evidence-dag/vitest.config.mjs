import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const python = execFileSync(
  process.env.EVIDENCE_BUILD_PYTHON ?? process.env.SCIFORGE_PYTHON_COMMAND ?? (process.platform === 'win32' ? 'python.exe' : 'python3'),
  ['-I', '-c', 'import sys; print(sys.executable)'],
  { encoding: 'utf8', windowsHide: true }
).trim()

export default defineConfig({
  root: repositoryRoot,
  test: {
    environment: 'node',
    include: ['plugins/evidence-dag/tests/*.test.ts'],
    globalSetup: ['plugins/evidence-dag/tests/setup.mjs'],
    env: { EVIDENCE_BUILD_PYTHON: python, EVIDENCE_TEST_PYTHON: python },
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
