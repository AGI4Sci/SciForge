import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { cp, mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type { ChildProcess } from 'node:child_process'
import type {
  DomainMainRuntimeLifecycleContext,
  DomainMainTextReasoner
} from '@sciforge/domain-sdk/host'
import {
  EvidenceDagSidecar,
  resolveEvidenceDagPackageRoot,
  resolveEvidenceDagPythonPath
} from './sidecar.js'

const execFileAsync = promisify(execFile)

test('resolves source and packaged paths only inside the installed Evidence domain', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'evidence-domain-sidecar-')))
  const sourcePackage = join(root, 'packages', 'domains', 'evidence-dag')
  await mkdir(join(sourcePackage, 'python', 'evidence_dag'), { recursive: true })
  assert.equal(resolveEvidenceDagPackageRoot({
    appRoot: root,
    environment: {}
  }), sourcePackage)
  assert.equal(resolveEvidenceDagPythonPath(sourcePackage, {}), join(sourcePackage, 'python'))

  const packagedApp = join(root, 'packaged', 'app.asar')
  const packagedDomain = join(
    `${packagedApp}.unpacked`,
    'node_modules',
    '@sciforge',
    'domain-evidence-dag'
  )
  await mkdir(packagedDomain, { recursive: true })
  assert.equal(resolveEvidenceDagPackageRoot({
    appRoot: packagedApp,
    environment: {}
  }), packagedDomain)
  assert.doesNotMatch(packagedDomain, /packages[\\/]workers/u)
})

test('imports and reads the stdlib-only engine without a model from source and packaged domain roots', async () => {
  const sourcePackage = fileURLToPath(new URL('../../', import.meta.url))
  const sourcePython = resolveEvidenceDagPythonPath(sourcePackage, {})
  await assertSelfContainedPythonImport(sourcePython)

  const root = await realpath(await mkdtemp(join(tmpdir(), 'evidence-packaged-python-')))
  const packagedApp = join(root, 'app.asar')
  const packagedDomain = join(
    `${packagedApp}.unpacked`,
    'node_modules',
    '@sciforge',
    'domain-evidence-dag'
  )
  await cp(join(sourcePackage, 'python'), join(packagedDomain, 'python'), {
    recursive: true
  })
  const resolvedPackage = resolveEvidenceDagPackageRoot({
    appRoot: packagedApp,
    environment: {}
  })
  assert.equal(resolvedPackage, packagedDomain)
  await assertSelfContainedPythonImport(
    resolveEvidenceDagPythonPath(resolvedPackage, {})
  )
})

test('does not reuse an HTTP-healthy sidecar with the old service version', async () => {
  let requests = 0
  const sidecar = new EvidenceDagSidecar({
    fetchImpl: async () => {
      requests += 1
      return new Response(JSON.stringify({
        ok: true,
        data: {
          service: 'evidence-dag-engine',
          version: '0.2.0'
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  sidecar.configure(lifecycleContext({
    SCIFORGE_EVIDENCE_DAG_AUTO_START: '0',
    SCIFORGE_EVIDENCE_DAG_SERVICE_URL: 'http://127.0.0.1:3897'
  }))

  await assert.rejects(
    sidecar.ensureReady(),
    /auto-start is disabled and no service is reachable/
  )
  assert.equal(requests, 1)
})

test('injects host-resolved reasoning access and restarts when it changes', async () => {
  let running = false
  let stops = 0
  const environments: NodeJS.ProcessEnv[] = []
  let reasoner: DomainMainTextReasoner = {
    baseUrl: 'http://127.0.0.1:3892/v1/',
    apiKey: 'first-key',
    model: 'first-model'
  }
  const sidecar = new EvidenceDagSidecar({
    fetchImpl: async () => running
      ? evidenceServiceResponse()
      : new Response('{}', { status: 503 }),
    spawnImpl: (_command, args, options) => {
      assert.deepEqual(args, ['-B', '-m', 'evidence_dag.server'])
      environments.push({ ...options.env })
      running = true
      return fakeChild(() => {
        running = false
        stops += 1
      })
    }
  })
  sidecar.configure(lifecycleContext({
    LAUNCH_SENTINEL: 'inherited',
    PYTHONDONTWRITEBYTECODE: '',
    EDAG_MODEL_ROUTER_BASE_URL: 'http://stale-domain-env/v1',
    EDAG_MODEL_ROUTER_API_KEY: 'stale-domain-key',
    EDAG_MODEL_ROUTER_MODEL: 'stale-domain-model',
    SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://stale-host-env/v1',
    SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'stale-host-key'
  }, async () => reasoner))

  await sidecar.ensureReady()
  await sidecar.ensureReady()
  assert.equal(environments.length, 1)
  assert.equal(environments[0]?.LAUNCH_SENTINEL, 'inherited')
  assert.equal(environments[0]?.PYTHONDONTWRITEBYTECODE, '1')
  assert.equal(environments[0]?.EDAG_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:3892/v1')
  assert.equal(environments[0]?.EDAG_MODEL_ROUTER_API_KEY, 'first-key')
  assert.equal(environments[0]?.EDAG_MODEL_ROUTER_MODEL, 'first-model')
  assert.equal(environments[0]?.EDAG_MODEL_ROUTER_MAX_ATTEMPTS, '1')

  reasoner = {
    baseUrl: 'http://127.0.0.1:4892/v1',
    apiKey: 'second-key',
    model: 'second-model'
  }
  await sidecar.ensureReady()

  assert.equal(stops, 1)
  assert.equal(environments.length, 2)
  assert.equal(environments[1]?.EDAG_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:4892/v1')
  assert.equal(environments[1]?.EDAG_MODEL_ROUTER_API_KEY, 'second-key')
  assert.equal(environments[1]?.EDAG_MODEL_ROUTER_MODEL, 'second-model')
  await sidecar.stop()
})

test('uses a package-owned dynamic loopback port when no endpoint is configured', async () => {
  let running = false
  let spawnedEnvironment: NodeJS.ProcessEnv | undefined
  const sidecar = new EvidenceDagSidecar({
    allocatePort: async () => 48_123,
    fetchImpl: async () => running
      ? evidenceServiceResponse()
      : new Response('{}', { status: 503 }),
    spawnImpl: (_command, _args, options) => {
      spawnedEnvironment = { ...options.env }
      running = true
      return fakeChild(() => { running = false })
    }
  })
  sidecar.configure(lifecycleContext({}))

  await sidecar.ensureReady()

  assert.equal(sidecar.endpoint().baseUrl, 'http://127.0.0.1:48123')
  assert.equal(spawnedEnvironment?.EDAG_PORT, '48123')
  assert.equal(
    spawnedEnvironment?.SCIFORGE_EVIDENCE_DAG_SERVICE_URL,
    'http://127.0.0.1:48123'
  )
  await sidecar.stop()
})

test('coalesces concurrent startup failures and detects an early child exit', async () => {
  let allocations = 0
  let spawns = 0
  const sidecar = new EvidenceDagSidecar({
    allocatePort: async () => {
      allocations += 1
      return 48_124
    },
    fetchImpl: async () => new Response('{}', { status: 503 }),
    readyTimeoutMs: 30_000,
    spawnImpl: () => {
      spawns += 1
      return exitingChild(1)
    }
  })
  sidecar.configure(lifecycleContext({}))

  const results = await Promise.allSettled([
    sidecar.ensureReady(),
    sidecar.ensureReady(),
    sidecar.ensureReady()
  ])

  assert.equal(allocations, 1)
  assert.equal(spawns, 1)
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    assert.match(String((result as PromiseRejectedResult).reason), /exited before becoming ready/)
  }
})

test('unset reasoning starts read service, then configures and revokes without inherited keys', async () => {
  let running = false
  let stops = 0
  let reasoner: DomainMainTextReasoner | null = null
  const environments: NodeJS.ProcessEnv[] = []
  const sidecar = new EvidenceDagSidecar({
    fetchImpl: async () => running ? evidenceServiceResponse() : new Response('{}', { status: 503 }),
    spawnImpl: (_command, _args, options) => {
      environments.push({ ...options.env }); running = true
      return fakeChild(() => { running = false; stops++ })
    }
  })
  sidecar.configure(lifecycleContext({
    EDAG_MODEL_ROUTER_BASE_URL: 'http://stale-domain-env/v1',
    EDAG_MODEL_ROUTER_API_KEY: 'synthetic-stale-key',
    EDAG_MODEL_ROUTER_MODEL: 'stale-model',
    SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://stale-host-env/v1',
    SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'synthetic-stale-host-key'
  }, async () => reasoner))
  try {
    await sidecar.ensureReady()
    await sidecar.ensureReady()
    assert.equal(environments.length, 1)
    reasoner = { baseUrl: 'http://127.0.0.1:3892/v1', apiKey: 'synthetic-new-key', model: 'model' }
    await sidecar.ensureReady()
    assert.equal(environments[1]?.EDAG_MODEL_ROUTER_MODEL, 'model')
    reasoner = null
    await sidecar.ensureReady()
    assert.equal(stops, 2)
    assert.equal(environments.length, 3)
    for (const index of [0, 2]) for (const name of [
      'EDAG_MODEL_ROUTER_BASE_URL', 'EDAG_MODEL_ROUTER_API_KEY', 'EDAG_MODEL_ROUTER_MODEL',
      'SCIFORGE_MODEL_ROUTER_BASE_URL', 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY'
    ]) assert.equal(environments[index]?.[name], undefined)
  } finally { await sidecar.stop() }
})

test('invalid access stops an already configured child and remains an explicit failure', async () => {
  let running = false
  let reasoner = { baseUrl: 'http://127.0.0.1:3892/v1', apiKey: 'synthetic-key', model: 'model' }
  let starts = 0
  const sidecar = new EvidenceDagSidecar({
    fetchImpl: async () => running ? evidenceServiceResponse() : new Response('{}', { status: 503 }),
    spawnImpl: () => { running = true; starts++; return fakeChild(() => { running = false }) }
  })
  sidecar.configure(lifecycleContext({}, async () => reasoner))
  try {
    await sidecar.ensureReady()
    reasoner = { ...reasoner, apiKey: '' }
    await assert.rejects(sidecar.ensureReady(), /incomplete/)
    assert.equal(running, false)
    assert.equal(starts, 1)
  } finally { await sidecar.stop() }
})

test('stop invalidates a pending model lookup before any child can start', async () => {
  let release!: (value: null) => void
  let entered!: () => void
  const entering = new Promise<void>(resolve => { entered = resolve })
  let starts = 0
  const sidecar = new EvidenceDagSidecar({
    fetchImpl: async () => new Response('{}', { status: 503 }),
    spawnImpl: () => { starts++; return fakeChild(() => undefined) }
  })
  sidecar.configure(lifecycleContext({}, () => { entered(); return new Promise(resolve => { release = resolve }) }))
  const starting = sidecar.ensureReady()
  await entering
  const stopped = sidecar.stop()
  release(null)
  await assert.rejects(starting, /lifecycle changed/)
  await stopped
  assert.equal(starts, 0)
})

function lifecycleContext(
  environment: Readonly<Record<string, string | undefined>>,
  textReasoner: () => Promise<DomainMainTextReasoner | null> = async () => ({
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'router-key',
    model: 'sciforge-router'
  })
): DomainMainRuntimeLifecycleContext {
  return {
    owner: { moduleId: 'sciforge.evidence-dag', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    userDataDir: '/tmp/evidence-domain',
    appRoot: '/workspace',
    environment,
    agentThreads: {
      list: async () => [],
      read: async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        watermark: '1',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => {
        throw new Error('Unexpected capability invocation.')
      },
      createApprovedBatch: () => {
        throw new Error('Unexpected capability invocation.')
      }
    },
    modelAccess: {
      textReasoner
    },
    executionEvents: {
      publish: async () => { throw new Error('Unexpected execution event.') }
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  }
}

function evidenceServiceResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    data: {
      service: 'evidence-dag-engine',
      version: '1.0.0'
    }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function fakeChild(onKill: () => void): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    stdout: undefined
    stderr: undefined
    kill: (signal?: NodeJS.Signals | number) => boolean
  }
  child.exitCode = null
  child.signalCode = null
  child.stdout = undefined
  child.stderr = undefined
  child.kill = (signal = 'SIGTERM') => {
    if (child.exitCode !== null || child.signalCode !== null) return false
    const signalCode = typeof signal === 'string' ? signal : 'SIGTERM'
    child.signalCode = signalCode
    onKill()
    child.emit('exit', null, signalCode)
    return true
  }
  return child as unknown as ChildProcess
}

function exitingChild(exitCode: number): ChildProcess {
  const child = fakeChild(() => undefined) as ChildProcess & {
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }
  setTimeout(() => {
    child.exitCode = exitCode
    child.emit('exit', exitCode, null)
  }, 0)
  return child
}

async function assertSelfContainedPythonImport(pythonPath: string): Promise<void> {
  const command = process.env.SCIFORGE_PYTHON_COMMAND?.trim() ||
    (process.platform === 'win32' ? 'python.exe' : 'python3')
  const { stdout } = await execFileAsync(command, [
    '-I',
    '-S',
    '-c',
    [
      'import sys, os',
      'os.environ.clear()',
      'sys.path.insert(0, sys.argv[1])',
      'import evidence_dag.server',
      'engine = evidence_dag.server.build_engine()',
      'assert engine.llm is None',
      'assert engine.list_threads_for_read() == []',
      'assert engine.get("missing-fixture-thread") is None',
      'print(evidence_dag.server.SERVICE_ID)'
    ].join(';'),
    pythonPath
  ])
  assert.equal(stdout.trim(), 'evidence-dag-engine')
}


test('lifecycle abort during readiness stops the newly spawned child', async () => {
  const controller = new AbortController()
  let running = false
  const sidecar = new EvidenceDagSidecar({
    fetchImpl: async () => {
      if (!running) return new Response('{}', { status: 503 })
      controller.abort()
      return evidenceServiceResponse()
    },
    spawnImpl: () => { running = true; return fakeChild(() => { running = false }) }
  })
  sidecar.configure({ ...lifecycleContext({}), signal: controller.signal })
  await assert.rejects(sidecar.ensureReady(), /lifecycle changed/)
  assert.equal(running, false)
  await sidecar.stop()
})
