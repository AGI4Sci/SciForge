import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ownedPythonLaunch } from './owned-python-launch.js'

const python = process.env.SCIFORGE_PYTHON_COMMAND?.trim() ||
  (process.platform === 'win32' ? 'python.exe' : 'python3')

test('owned policy overrides bytecode settings without widening or mutating launch environment', () => {
  const environment = Object.freeze({ HOME: '/owned/home', PYTHONDONTWRITEBYTECODE: '', TOKEN: 'scoped' })
  const args = Object.freeze(['-I', '-u', '-m', 'owned_service'])
  const launch = ownedPythonLaunch(args, environment)
  assert.deepEqual(launch, {
    args: ['-B', ...args],
    env: { HOME: '/owned/home', PYTHONDONTWRITEBYTECODE: '1', TOKEN: 'scoped' }
  })
  assert.equal(environment.PYTHONDONTWRITEBYTECODE, '')
  assert.deepEqual(args, ['-I', '-u', '-m', 'owned_service'])
  assert.equal(Object.hasOwn(launch.env, 'PATH'), false)
})

test('real normal and isolated Python imports leave writable and read-only source resources unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'owned-python-launch-'))
  const source = join(root, 'source')
  const cache = join(root, 'cache')
  await mkdir(source)
  await writeFile(join(source, 'owned_probe.py'), 'VALUE = 42\n')
  const script = [
    'import sys, os, json',
    'sys.path.insert(0, sys.argv[1])',
    'from owned_probe import VALUE',
    'print(json.dumps({"value": VALUE, "no_bytecode": sys.dont_write_bytecode, "sentinel": os.environ["LAUNCH_SENTINEL"]}))'
  ].join('; ')
  try {
    for (const readOnly of [false, true]) {
      if (readOnly && process.platform !== 'win32') {
        await chmod(join(source, 'owned_probe.py'), 0o444)
        await chmod(source, 0o555)
      }
      for (const isolated of [false, true]) {
        const environment = {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '',
          PYTHONPYCACHEPREFIX: cache,
          LAUNCH_SENTINEL: 'inherited'
        }
        const launch = ownedPythonLaunch([...(isolated ? ['-I'] : []), '-c', script, source], environment)
        const output = JSON.parse(execFileSync(python, launch.args, {
          env: launch.env, encoding: 'utf8', timeout: 10_000
        }))
        assert.deepEqual(output, { value: 42, no_bytecode: true, sentinel: 'inherited' })
        assert.deepEqual(await readdir(source), ['owned_probe.py'])
        assert.deepEqual(await readdir(root), ['source'])
        assert.equal(environment.PYTHONDONTWRITEBYTECODE, '')
      }
    }
  } finally {
    await chmod(source, 0o755)
    await rm(root, { recursive: true, force: true })
  }
})
