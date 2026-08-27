import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { test } from 'node:test'

import {
  DEV_PREPARATION_SCRIPTS,
  DEV_FORWARD_SIGNALS,
  devChildSpawnOptions,
  forwardSignalToDevChild,
  mergeDevelopmentEnvironment
} from './dev-bootstrap.mjs'

test('development startup prepares secure domain runtimes before agent support', () => {
  assert.deepEqual(DEV_PREPARATION_SCRIPTS, [
    'build:domain-native-addons',
    'build:agent-support'
  ])
})

test('versioned development deployment values fill only missing environment entries', () => {
  assert.deepEqual(mergeDevelopmentEnvironment(
    'SCIFORGE_OIDC_ISSUER=https://identity.example.test/realms/SciForge\n' +
      'SCIFORGE_CLOUD_BASE_URL=https://cloud.example.test\n',
    {
      SCIFORGE_CLOUD_BASE_URL: 'https://explicit-cloud.example.test',
      PRESERVED_VALUE: 'yes'
    }
  ), {
    SCIFORGE_OIDC_ISSUER: 'https://identity.example.test/realms/SciForge',
    SCIFORGE_CLOUD_BASE_URL: 'https://explicit-cloud.example.test',
    PRESERVED_VALUE: 'yes'
  })
})

test('fresh clones include the public Cloud Identity development deployment', async () => {
  const source = await readFile(
    new URL('../deployments/development/sciforge.env', import.meta.url),
    'utf8'
  )
  const environment = mergeDevelopmentEnvironment(source, {})
  assert.equal(
    environment.SCIFORGE_OIDC_ISSUER,
    'https://login-test.sciforge.cn/realms/SciForge'
  )
  assert.equal(environment.SCIFORGE_CLOUD_BASE_URL, 'https://cloud-test.sciforge.cn')
})

test('development children use an independent process group only on POSIX', () => {
  assert.deepEqual(devChildSpawnOptions('darwin'), { detached: true })
  assert.deepEqual(devChildSpawnOptions('linux'), { detached: true })
  assert.deepEqual(devChildSpawnOptions('win32'), { detached: false })
})

test('POSIX shutdown signals target the child process group', () => {
  const calls = []
  const target = {
    pid: 4242,
    killed: false,
    kill() {
      assert.fail('POSIX forwarding must address the process group, not only its leader')
    }
  }

  assert.equal(forwardSignalToDevChild(target, 'SIGINT', {
    platform: 'darwin',
    killProcess: (pid, signal) => calls.push([pid, signal])
  }), true)
  assert.deepEqual(calls, [[-4242, 'SIGINT']])
  assert.deepEqual(DEV_FORWARD_SIGNALS, ['SIGINT', 'SIGTERM', 'SIGHUP'])
})

test('Windows shutdown keeps using the supported direct-child kill path', () => {
  const signals = []
  const target = {
    pid: 4242,
    killed: false,
    kill(signal) {
      signals.push(signal)
      return true
    }
  }

  assert.equal(forwardSignalToDevChild(target, 'SIGTERM', {
    platform: 'win32',
    killProcess: () => assert.fail('Windows must not use POSIX negative process-group ids')
  }), true)
  assert.deepEqual(signals, ['SIGTERM'])
})

test('a completed POSIX process group is a harmless shutdown race', () => {
  const missingGroup = Object.assign(new Error('no such process'), { code: 'ESRCH' })
  assert.equal(forwardSignalToDevChild({ pid: 4242, killed: false }, 'SIGHUP', {
    platform: 'linux',
    killProcess: () => {
      throw missingGroup
    }
  }), false)
})

test('POSIX group forwarding reaches both a launcher and its descendant', {
  skip: process.platform === 'win32',
  timeout: 10_000
}, async () => {
  const leafSource = `
process.on('SIGTERM', () => {
  console.log('leaf-signal:SIGTERM')
  setTimeout(() => process.exit(0), 10)
})
console.log('leaf-ready')
setInterval(() => {}, 1_000)
`
  const launcherSource = `
import { spawn } from 'node:child_process'
const leaf = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(leafSource)}], {
  stdio: ['ignore', 'inherit', 'inherit']
})
leaf.once('spawn', () => console.log('launcher-ready'))
process.on('SIGTERM', () => {
  console.log('launcher-signal:SIGTERM')
  setTimeout(() => process.exit(0), 200)
})
setInterval(() => {}, 1_000)
`
  const launcher = spawn(
    process.execPath,
    ['--input-type=module', '-e', launcherSource],
    {
      ...devChildSpawnOptions(process.platform),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let output = ''
  launcher.stdout.setEncoding('utf8')
  launcher.stderr.setEncoding('utf8')
  launcher.stdout.on('data', (chunk) => { output += chunk })
  launcher.stderr.on('data', (chunk) => { output += chunk })

  try {
    await waitUntil(() => output.includes('launcher-ready') && output.includes('leaf-ready'))
    assert.equal(forwardSignalToDevChild(launcher, 'SIGTERM'), true)
    await waitUntil(() =>
      output.includes('launcher-signal:SIGTERM') && output.includes('leaf-signal:SIGTERM')
    )
    await waitForExit(launcher)
    assert.match(output, /launcher-signal:SIGTERM/u)
    assert.match(output, /leaf-signal:SIGTERM/u)
  } finally {
    if (launcher.exitCode === null && launcher.signalCode === null) {
      try {
        process.kill(-launcher.pid, 'SIGKILL')
      } catch {
        // Best-effort cleanup after a failed assertion or fixture timeout.
      }
      await waitForExit(launcher).catch(() => undefined)
    }
  }
})

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for process-tree fixture output.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  let timer
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for fixture exit.')), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
