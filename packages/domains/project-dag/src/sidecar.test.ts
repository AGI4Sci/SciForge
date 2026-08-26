import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type {
  DomainMainRuntimeLifecycleContext,
  DomainMainTextReasoner
} from '@sciforge/domain-sdk/host'
import {
  ProjectDagSidecar,
  projectDagPackageRoots,
  projectDagSidecarConfig
} from './sidecar.js'

test('sidecar configuration is package-owned and derives only generic lifecycle paths', () => {
  const config = projectDagSidecarConfig({
    appRoot: '/Applications/SciForge',
    userDataDir: '/Users/test/Library/Application Support/SciForge',
    environment: {
      EDAG_STORAGE_DIR: '/data/evidence',
      EDAG_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3900/v1',
      EDAG_MODEL_ROUTER_API_KEY: 'router-token',
      EDAG_MODEL_ROUTER_MODEL: 'extractor'
    }
  }, {
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'contract-router-token',
    model: 'contract-extractor'
  }, 'stable-project-token')

  assert.equal(config.baseUrl, 'http://127.0.0.1:3898')
  assert.equal(config.runtimeToken, 'stable-project-token')
  assert.equal(config.command, process.platform === 'win32' ? 'python.exe' : 'python3')
  assert.deepEqual(config.args, ['-m', 'project_dag.server'])
  assert.equal(config.cwd, '/Applications/SciForge/packages/domains/project-dag')
  assert.equal(config.sessionDir, '/data/evidence')
  assert.equal(
    config.dbPath,
    '/Users/test/Library/Application Support/SciForge/project-dag/project-view.db'
  )
  assert.equal(config.env.SCIFORGE_PROJECT_DAG_API_KEY, 'stable-project-token')
  assert.equal(config.env.EDAG_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:3892/v1')
  assert.equal(config.env.EDAG_MODEL_ROUTER_API_KEY, 'contract-router-token')
  assert.equal(config.env.EDAG_MODEL_ROUTER_MODEL, 'contract-extractor')
  assert.deepEqual(config.env.PYTHONPATH?.split(delimiter), [
    '/Applications/SciForge/packages/domains/project-dag/python',
    '/Applications/SciForge/packages/domains/evidence-dag/python'
  ])
})

test('package roots resolve identically from source and app.asar.unpacked layouts', () => {
  const sourceRoot = '/repo'
  const packagedRoot =
    '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked'
  const exists = (path: string) => path.includes('/packages/domains/')

  assert.deepEqual(projectDagPackageRoots(sourceRoot, {}, exists), {
    project: '/repo/packages/domains/project-dag',
    evidence: '/repo/packages/domains/evidence-dag'
  })
  assert.deepEqual(projectDagPackageRoots(packagedRoot, {}, exists), {
    project:
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/packages/domains/project-dag',
    evidence:
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/packages/domains/evidence-dag'
  })
})

test('sidecar appends an existing PYTHONPATH after canonical domain roots', () => {
  const config = projectDagSidecarConfig({
    appRoot: '/repo',
    userDataDir: '/data',
    environment: {
      PYTHONPATH: ['/existing/one', '/existing/two'].join(delimiter)
    }
  }, {
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'router-token',
    model: 'extractor'
  }, 'stable-project-token')

  assert.deepEqual(config.env.PYTHONPATH?.split(delimiter), [
    '/repo/packages/domains/project-dag/python',
    '/repo/packages/domains/evidence-dag/python',
    '/existing/one',
    '/existing/two'
  ])
})

test('injects host-resolved text reasoning access and restarts its owned child on change', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-domain-sidecar-'))
  let running = false
  let stops = 0
  const environments: NodeJS.ProcessEnv[] = []
  let reasoner: DomainMainTextReasoner | null = {
    baseUrl: 'http://127.0.0.1:3892/v1/',
    apiKey: 'first-key',
    model: 'first-model'
  }
  const sidecar = new ProjectDagSidecar({
    allocatePort: async () => 45_321,
    fetchImpl: async () => running
      ? projectServiceResponse()
      : new Response('{}', { status: 503 }),
    spawnImpl: (_command, _args, options) => {
      environments.push({ ...options.env })
      running = true
      return fakeChild(() => {
        running = false
        stops += 1
      })
    }
  })
  const context = lifecycleContext({
    EDAG_MODEL_ROUTER_BASE_URL: 'http://stale-domain-env/v1',
    EDAG_MODEL_ROUTER_API_KEY: 'stale-domain-key',
    EDAG_MODEL_ROUTER_MODEL: 'stale-domain-model',
    SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://stale-host-env/v1',
    SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'stale-host-key'
  }, async () => reasoner, userDataDir)

  try {
    await sidecar.ensure(context)
    await sidecar.ensure(context)
    assert.equal(environments.length, 1)
    assert.equal(environments[0]?.PDAG_PORT, '45321')
    assert.equal(environments[0]?.EDAG_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:3892/v1')
    assert.equal(environments[0]?.EDAG_MODEL_ROUTER_API_KEY, 'first-key')
    assert.equal(environments[0]?.EDAG_MODEL_ROUTER_MODEL, 'first-model')
    assert.equal(environments[0]?.SCIFORGE_MODEL_ROUTER_BASE_URL, undefined)
    assert.equal(environments[0]?.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY, undefined)

    reasoner = {
      baseUrl: 'http://127.0.0.1:4892/v1',
      apiKey: 'second-key',
      model: 'second-model'
    }
    await sidecar.ensure(context)

    assert.equal(stops, 1)
    assert.equal(environments.length, 2)
    assert.equal(environments[1]?.EDAG_MODEL_ROUTER_BASE_URL, 'http://127.0.0.1:4892/v1')
    assert.equal(environments[1]?.EDAG_MODEL_ROUTER_API_KEY, 'second-key')
    assert.equal(environments[1]?.EDAG_MODEL_ROUTER_MODEL, 'second-model')

    reasoner = null
    await assert.rejects(
      sidecar.ensure(context),
      /requires configured text reasoning model access/u
    )
    assert.equal(stops, 2)
    assert.equal(environments.length, 2)
  } finally {
    await sidecar.stop()
    await rm(userDataDir, { recursive: true })
  }
})

test('allocates one private loopback endpoint and coalesces concurrent readiness', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-domain-sidecar-'))
  let allocations = 0
  let spawns = 0
  let running = false
  const sidecar = new ProjectDagSidecar({
    allocatePort: async () => {
      allocations += 1
      return 45_322
    },
    fetchImpl: async () => running
      ? projectServiceResponse()
      : new Response('{}', { status: 503 }),
    spawnImpl: () => {
      spawns += 1
      running = true
      return fakeChild(() => {
        running = false
      })
    }
  })

  try {
    const [first, second] = await Promise.all([
      sidecar.ensure(lifecycleContext({}, undefined, userDataDir)),
      sidecar.ensure(lifecycleContext({}, undefined, userDataDir))
    ])
    assert.equal(first.baseUrl, 'http://127.0.0.1:45322')
    assert.equal(second.baseUrl, first.baseUrl)
    assert.equal(allocations, 1)
    assert.equal(spawns, 1)
  } finally {
    await sidecar.stop()
    await rm(userDataDir, { recursive: true })
  }
})

test('preserves an explicitly configured external endpoint', async () => {
  let allocations = 0
  const sidecar = new ProjectDagSidecar({
    allocatePort: async () => {
      allocations += 1
      return 45_323
    },
    fetchImpl: async () => projectServiceResponse()
  })

  const config = await sidecar.ensure(lifecycleContext({
    SCIFORGE_PROJECT_DAG_SERVICE_URL: 'http://127.0.0.1:40123'
  }))
  assert.equal(config.baseUrl, 'http://127.0.0.1:40123')
  assert.equal(allocations, 0)
})

test('fails closed without model-access contract and never falls back to Router env', async () => {
  let fetched = false
  let spawned = false
  const sidecar = new ProjectDagSidecar({
    fetchImpl: async () => {
      fetched = true
      return projectServiceResponse()
    },
    spawnImpl: () => {
      spawned = true
      return fakeChild(() => undefined)
    }
  })
  const context = lifecycleContext({
    EDAG_MODEL_ROUTER_BASE_URL: 'http://stale-domain-env/v1',
    EDAG_MODEL_ROUTER_API_KEY: 'stale-domain-key',
    EDAG_MODEL_ROUTER_MODEL: 'stale-domain-model',
    SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://stale-host-env/v1',
    SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'stale-host-key'
  }, async () => null)

  await assert.rejects(
    sidecar.ensure(context),
    /requires configured text reasoning model access/u
  )
  assert.equal(fetched, false)
  assert.equal(spawned, false)
})

test('Project domain sidecar has no old worker-desktop or host-private import', async () => {
  const source = await readFile(
    fileURLToPath(new URL('./sidecar.ts', import.meta.url)),
    'utf8'
  )
  assert.doesNotMatch(source, /@sciforge\/project-dag\/desktop/u)
  assert.doesNotMatch(source, /src\/(?:main|shared|renderer)|@shared|@renderer/u)
})

function lifecycleContext(
  environment: Readonly<Record<string, string | undefined>>,
  textReasoner: () => Promise<DomainMainTextReasoner | null> = async () => ({
    baseUrl: 'http://127.0.0.1:3892/v1',
    apiKey: 'router-key',
    model: 'sciforge-router'
  }),
  userDataDir = '/data'
): DomainMainRuntimeLifecycleContext {
  return {
    owner: { moduleId: 'sciforge.project-dag', moduleVersion: '1.0.0' },
    userDataDir,
    appRoot: '/app',
    environment,
    signal: new AbortController().signal,
    agentThreads: {
      list: async () => [],
      read: async ({ runtimeId, threadId }) => ({
        id: threadId,
        runtimeId,
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
        throw new Error('Unexpected approved capability batch.')
      }
    },
    modelAccess: {
      textReasoner
    },
    executionEvents: {
      publish: async () => {
        throw new Error('Unexpected execution event publication.')
      }
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  }
}

function projectServiceResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    data: {
      service: 'project-dag-engine',
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
