import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ProductStackSupervisor,
  ProductStackSupervisorError,
  collectDescendantProcessIdentities,
  commandFingerprint,
  forceStopProcessTree,
  inspectProcessIdentity,
  normalizeProductStackConfig,
  sameProcessIdentity
} from './product-stack-supervisor.mjs'

test('process snapshots derive only the complete descendant tree', () => {
  const processes = [
    { pid: 20, parentPid: 10, createdAt: 'child', executablePath: 'child.exe', commandLineHash: 'child' },
    { pid: 30, parentPid: 20, createdAt: 'grandchild', executablePath: 'grandchild.exe', commandLineHash: 'grandchild' },
    { pid: 40, parentPid: 999, createdAt: 'unrelated', executablePath: 'unrelated.exe', commandLineHash: 'unrelated' },
    { pid: 10, parentPid: 30, createdAt: 'cycle-root', executablePath: 'root.exe', commandLineHash: 'root' }
  ]
  assert.deepEqual(collectDescendantProcessIdentities(processes, 10), [
    { pid: 20, createdAt: 'child', executablePath: 'child.exe', commandLineHash: 'child' },
    { pid: 30, createdAt: 'grandchild', executablePath: 'grandchild.exe', commandLineHash: 'grandchild' }
  ])
})

function fakeChild(pid, exitOnTerm = true) {
  const child = new EventEmitter()
  child.pid = pid
  child.kill = (signal) => {
    if (exitOnTerm) queueMicrotask(() => child.emit('exit', null, signal))
    return true
  }
  return child
}

function harness(root, options = {}) {
  let nextPid = 7000
  const identities = new Map()
  const children = []
  const spawnCalls = []
  const forceStopped = []
  const descendants = new Map()
  const cancelledDeadlines = []
  const occupiedPorts = new Set(options.occupiedPorts ?? [])
  const spawn = (command, args, spawnOptions) => {
    spawnCalls.push({ command, args, options: spawnOptions })
    const child = fakeChild(nextPid++, options.exitOnTerm !== false)
    identities.set(child.pid, {
      pid: child.pid,
      createdAt: `created-${child.pid}`,
      executablePath: `c:/fake/${command}`,
      commandLineHash: commandFingerprint(command, args, root)
    })
    child.once('exit', () => identities.delete(child.pid))
    children.push(child)
    if (args.includes('driver.mjs') && !options.holdTask) {
      setTimeout(() => child.emit('exit', options.taskCode ?? 0, null), 50)
    }
    return child
  }
  return {
    children,
    spawnCalls,
    forceStopped,
    cancelledDeadlines,
    supervisor(config) {
      return new ProductStackSupervisor(config, {
        cwd: root,
        platform: options.platform ?? 'win32',
        randomId: () => '00000000-0000-4000-8000-000000000001',
        spawn,
        inspectProcess: async (pid) => identities.get(pid) ?? null,
        listDescendants: async (pid) => descendants.get(pid) ?? [],
        listProcessGroup: async (pid) => descendants.get(pid) ?? [],
        forceStop: async (identity) => {
          forceStopped.push(identity.pid)
          identities.delete(identity.pid)
          children.find((child) => child.pid === identity.pid)?.emit('exit', null, 'SIGKILL')
        },
        isPortFree: async (port) => !occupiedPorts.has(port),
        waitForPort: async () => undefined,
        createDeadline(milliseconds) {
          return {
            promise: milliseconds <= 1_000 || options.instantDelay
              ? Promise.resolve()
              : new Promise(() => undefined),
            cancel() {
              cancelledDeadlines.push(milliseconds)
            }
          }
        }
      })
    },
    identities,
    descendants
  }
}

async function config(root, overrides = {}) {
  return {
    stateRoot: join(root, 'state'),
    roots: [{ role: 'product', command: 'node', args: ['product.mjs'], cwd: root }],
    task: { role: 'driver', command: 'node', args: ['driver.mjs'], cwd: root },
    ports: [5173, 3900],
    profileDirectories: ['profiles/browser'],
    stopGraceMs: 100,
    ...overrides
  }
}

test('config keeps commands generic and profiles confined to the run directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-config-'))
  const base = await config(root)
  const normalized = normalizeProductStackConfig(base, { cwd: root })
  assert.deepEqual(normalized.ports, [3900, 5173])
  assert.equal(normalized.roots[0].role, 'product')
  assert.throws(
    () => normalizeProductStackConfig({ ...base, profileDirectories: ['../escape'] }, { cwd: root }),
    /run-directory-relative/u
  )
})

test('config supports a bounded self-launching E2E task without an artificial root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-task-only-'))
  const normalized = normalizeProductStackConfig(await config(root, { roots: [] }), { cwd: root })
  assert.equal(normalized.roots.length, 0)
  assert.equal(normalized.task?.role, 'driver')
  assert.throws(
    () => normalizeProductStackConfig({ stateRoot: join(root, 'state'), roots: [] }, { cwd: root }),
    /at least one root process or one bounded task/u
  )
})

test('normal completion writes a redacted manifest and reaches process, port, and profile zero', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-success-'))
  const runtime = harness(root)
  const result = await runtime.supervisor(await config(root)).run()
  assert.equal(result.manifest.phase, 'teardown-complete')
  assert.deepEqual(result.manifest.teardown.verification, {
    liveProcesses: [],
    occupiedPorts: [],
    profilesReleased: true
  })
  const text = await readFile(join(result.runDirectory, 'manifest.json'), 'utf8')
  assert.equal(text.includes('SCIFORGE_'), false)
  assert.equal(text.includes('product.mjs'), false)
  assert.match(text, /commandHash/u)
  assert.deepEqual(runtime.cancelledDeadlines, [600_000, 100])
})

test('task failure still tears down every owned root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-failure-'))
  const runtime = harness(root, { taskCode: 9 })
  await assert.rejects(runtime.supervisor(await config(root)).run(), (error) => {
    assert.equal(error.code, 'TASK_FAILED')
    return true
  })
  assert.equal(runtime.identities.size, 0)
})

test('teardown captures and identity-checks descendants that outlive their launcher root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-orphan-'))
  const runtime = harness(root)
  const supervisor = runtime.supervisor(await config(root))
  const run = supervisor.run()
  while (runtime.children.length < 1) await new Promise((resolve) => setImmediate(resolve))
  const rootPid = runtime.children[0].pid
  const descendant = {
    pid: 7999,
    createdAt: 'created-7999',
    executablePath: 'c:/fake/hermes/node.exe',
    commandLineHash: 'router-command'
  }
  runtime.identities.set(descendant.pid, descendant)
  runtime.descendants.set(rootPid, [descendant])
  const result = await run
  assert.equal(runtime.identities.size, 0)
  assert.deepEqual(runtime.forceStopped, [descendant.pid])
  assert.equal(result.manifest.roots[0].descendants[0].pid, descendant.pid)
  assert.ok(result.manifest.roots[0].descendants[0].stoppedAt)
})

test('task timeout tears down the task and every owned root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-timeout-'))
  const runtime = harness(root, { holdTask: true, instantDelay: true })
  await assert.rejects(runtime.supervisor(await config(root)).run(), (error) => {
    assert.equal(error.code, 'TASK_TIMEOUT')
    return true
  })
  assert.equal(runtime.identities.size, 0)
})

test('fixture launch failure tears down roots launched before it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-launch-failure-'))
  let call = 0
  const runtime = harness(root)
  const supervisor = runtime.supervisor(await config(root, {
    roots: [
      { role: 'fixture', command: 'node', args: ['fixture.mjs'], cwd: root, readyPort: 9235 },
      { role: 'product', command: 'node', args: ['product.mjs'], cwd: root, readyPort: 5173 }
    ]
  }))
  supervisor.waitForPort = async () => {
    call += 1
    if (call === 2) throw new ProductStackSupervisorError('READY_TIMEOUT', 'not ready')
  }
  await assert.rejects(supervisor.run(), /not ready/u)
  assert.equal(runtime.identities.size, 0)
})

test('preflight refuses occupied ports before starting a process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-port-'))
  const runtime = harness(root, { occupiedPorts: [5173] })
  await assert.rejects(runtime.supervisor(await config(root)).run(), (error) => {
    assert.equal(error.code, 'PORT_CONFLICT')
    return true
  })
  assert.equal(runtime.children.length, 0)
})

test('preflight refuses a live root from an incomplete previous run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-live-'))
  const runtime = harness(root)
  const stateRoot = join(root, 'state')
  const previous = join(stateRoot, 'previous')
  await mkdir(previous, { recursive: true })
  const identity = {
    pid: 8123,
    createdAt: 'created-8123',
    executablePath: 'c:/fake/node',
    commandLineHash: 'same'
  }
  runtime.identities.set(identity.pid, identity)
  await writeFile(join(previous, 'manifest.json'), JSON.stringify({
    version: 1,
    runId: 'previous',
    roots: [{ role: 'product', pid: identity.pid, identity }],
    teardown: { completedAt: null }
  }))
  await assert.rejects(runtime.supervisor(await config(root)).run(), (error) => {
    assert.equal(error.code, 'LIVE_PREVIOUS_RUN')
    return true
  })
})

test('preflight also refuses a live task from an incomplete previous run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-live-task-'))
  const runtime = harness(root)
  const previous = join(root, 'state', 'previous')
  await mkdir(previous, { recursive: true })
  const identity = {
    pid: 8124,
    createdAt: 'created-8124',
    executablePath: 'c:/fake/node',
    commandLineHash: 'same-task'
  }
  runtime.identities.set(identity.pid, identity)
  await writeFile(join(previous, 'manifest.json'), JSON.stringify({
    version: 1,
    runId: 'previous-task',
    roots: [],
    task: { role: 'driver', pid: identity.pid, identity },
    teardown: { completedAt: null }
  }))
  await assert.rejects(runtime.supervisor(await config(root)).run(), (error) => {
    assert.equal(error.code, 'LIVE_PREVIOUS_RUN')
    return true
  })
})

test('an invalid previous manifest fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-invalid-manifest-'))
  const runtime = harness(root)
  const previous = join(root, 'state', 'previous')
  await mkdir(previous, { recursive: true })
  await writeFile(join(previous, 'manifest.json'), '{broken')
  await assert.rejects(runtime.supervisor(await config(root)).run(), (error) => {
    assert.equal(error.code, 'INVALID_PREVIOUS_MANIFEST')
    return true
  })
})

test('a product root crash fails the task and still cleans the remaining stack', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-root-crash-'))
  const runtime = harness(root, { holdTask: true })
  const supervisor = runtime.supervisor(await config(root))
  const run = supervisor.run()
  while (runtime.children.length < 2) await new Promise((resolve) => setImmediate(resolve))
  runtime.children[0].emit('exit', 17, null)
  await assert.rejects(run, (error) => {
    assert.equal(error.code, 'ROOT_EXITED')
    return true
  })
  assert.equal(runtime.identities.size, 0)
})

test('a product root that exits before teardown still has its captured descendants stopped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-exited-root-descendant-'))
  const runtime = harness(root, { holdTask: true })
  const supervisor = runtime.supervisor(await config(root))
  const run = supervisor.run()
  while (runtime.children.length < 2) await new Promise((resolve) => setImmediate(resolve))
  const rootPid = runtime.children[0].pid
  const descendant = {
    pid: 8130,
    createdAt: 'created-8130',
    executablePath: 'c:/fake/electron.exe',
    commandLineHash: 'electron-child'
  }
  runtime.identities.set(descendant.pid, descendant)
  runtime.descendants.set(rootPid, [descendant])
  runtime.children[0].emit('exit', 17, null)
  await assert.rejects(run, (error) => {
    assert.equal(error.code, 'ROOT_EXITED')
    return true
  })
  assert.equal(runtime.identities.size, 0)
  assert.ok(runtime.forceStopped.includes(descendant.pid))
})

test('PID reuse is never considered the same owner', () => {
  const expected = { pid: 42, createdAt: 'one', executablePath: 'node', commandLineHash: 'a' }
  assert.equal(sameProcessIdentity({ ...expected, createdAt: 'two' }, expected), false)
  assert.equal(sameProcessIdentity({ ...expected, commandLineHash: 'b' }, expected), false)
  assert.equal(sameProcessIdentity({ ...expected }, expected), true)
})

test('signal interruption reaches the canonical finally teardown exactly once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-idempotent-'))
  const runtime = harness(root, { holdTask: true })
  const supervisor = runtime.supervisor(await config(root))
  const run = supervisor.run()
  while (runtime.children.length < 2) await new Promise((resolve) => setImmediate(resolve))
  supervisor.interrupt('SIGINT')
  await assert.rejects(run, (error) => {
    assert.equal(error.code, 'INTERRUPTED', error.message)
    return true
  })
  assert.equal(runtime.identities.size, 0)
})

test('signal interruption does not wait for a root process to honor SIGTERM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-interrupt-wakeup-'))
  const runtime = harness(root, { holdTask: true, exitOnTerm: false })
  const supervisor = runtime.supervisor(await config(root))
  const run = supervisor.run()
  while (runtime.children.length < 2) await new Promise((resolve) => setImmediate(resolve))
  supervisor.interrupt('SIGINT')
  await assert.rejects(run, (error) => {
    assert.equal(error.code, 'INTERRUPTED')
    return true
  })
  assert.equal(runtime.identities.size, 0)
})

test('POSIX tasks launch in their own process group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-product-supervisor-posix-group-'))
  const runtime = harness(root, { platform: 'darwin' })
  await runtime.supervisor(await config(root, { roots: [] })).run()
  assert.equal(runtime.spawnCalls.length, 1)
  assert.equal(runtime.spawnCalls[0]?.options.detached, true)
})

test('POSIX force stop falls back to the exact PID for a non-group-leader process', {
  skip: process.platform === 'win32'
}, async () => {
  const child = nodeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  try {
    const identity = await inspectProcessIdentity(child.pid)
    assert.ok(identity)
    await forceStopProcessTree(identity)
    await waitForChildExit(child, 2_000)
    assert.notEqual(child.signalCode, null)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})

test('checked-in source Electron smoke config uses the supervisor as its canonical launcher', async () => {
  const directory = dirname(fileURLToPath(import.meta.url))
  const input = JSON.parse(await readFile(join(directory, 'electron-domain-source.json'), 'utf8'))
  const normalized = normalizeProductStackConfig(input, { cwd: directory })
  assert.equal(normalized.roots.length, 0)
  assert.equal(normalized.task?.role, 'electron-domain-source')
  assert.deepEqual(normalized.task?.args, ['scripts/electron-domain-smoke.mjs'])
  assert.deepEqual(normalized.profileDirectories, ['profiles/electron-domain-smoke'])
})

test('checked-in Cloud source smoke freezes the Run-0 origin and issuer', async () => {
  const directory = dirname(fileURLToPath(import.meta.url))
  const input = JSON.parse(
    await readFile(join(directory, 'electron-domain-source-cloud.json'), 'utf8')
  )
  const normalized = normalizeProductStackConfig(input, { cwd: directory })
  assert.equal(normalized.roots.length, 0)
  assert.equal(normalized.task?.role, 'electron-domain-source-cloud')
  assert.deepEqual(normalized.task?.args, [
    'scripts/electron-domain-smoke.mjs',
    '--expected-cloud-origin',
    'https://cloud-test.sciforge.cn',
    '--expected-oidc-issuer',
    'https://login-test.sciforge.cn/realms/SciForge',
    '--timeout-ms',
    '180000'
  ])
  assert.deepEqual(normalized.profileDirectories, ['profiles/electron-domain-smoke'])
})

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      reject(new Error(`Child ${child.pid} did not exit within ${timeoutMs} ms.`))
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', onExit)
  })
}
