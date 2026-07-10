import { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultModelRouterSettings,
  type AppSettingsV1
} from '../../../../src/shared/app-settings'
import {
  PROJECT_DAG_API_KEY_ENV,
  PROJECT_DAG_SERVICE_URL_ENV
} from './contract'
import {
  buildProjectDagLaunch,
  ensureProjectDagSidecar,
  stopProjectDagSidecar
} from './sidecar'

type ProjectDagSpawn = NonNullable<Parameters<typeof ensureProjectDagSidecar>[1]['spawnImpl']>

type HealthRequest = {
  method: string | undefined
  path: string | undefined
  accept: string | undefined
  authorization: string | undefined
}

const originalProjectDagServiceUrl = process.env[PROJECT_DAG_SERVICE_URL_ENV]
const originalProjectDagApiKey = process.env[PROJECT_DAG_API_KEY_ENV]

function settings(): AppSettingsV1 {
  return {
    modelRouter: {
      ...defaultModelRouterSettings(),
      runtimeApiKey: 'router-runtime-key',
      publicModelAlias: 'sciforge-router'
    }
  } as AppSettingsV1
}

afterEach(async () => {
  await stopProjectDagSidecar()
  restoreEnv(PROJECT_DAG_SERVICE_URL_ENV, originalProjectDagServiceUrl)
  restoreEnv(PROJECT_DAG_API_KEY_ENV, originalProjectDagApiKey)
})

describe('Project DAG sidecar launch', () => {
  it('uses the durable update worker without a separate schedule lane', () => {
    const result = buildProjectDagLaunch(settings(), {
      userDataDir: '/tmp/sciforge',
      appRoot: '/app/root',
      env: {} as NodeJS.ProcessEnv,
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.env.PDAG_SCHEDULE).toBeUndefined()
    expect(result.launch.env.EDAG_MODEL_ROUTER_TIMEOUT_S).toBe('45')
    expect(result.launch.env.EDAG_MODEL_ROUTER_MAX_ATTEMPTS).toBe('1')
  })

  it('does not forward the removed PDAG_SCHEDULE bypass', () => {
    const result = buildProjectDagLaunch(settings(), {
      userDataDir: '/tmp/sciforge',
      appRoot: '/app/root',
      env: {
        PDAG_SCHEDULE: '1',
        EDAG_MODEL_ROUTER_TIMEOUT_S: '90',
        EDAG_MODEL_ROUTER_MAX_ATTEMPTS: '3'
      } as NodeJS.ProcessEnv,
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.env.PDAG_SCHEDULE).toBeUndefined()
    expect(result.launch.env.EDAG_MODEL_ROUTER_TIMEOUT_S).toBe('90')
    expect(result.launch.env.EDAG_MODEL_ROUTER_MAX_ATTEMPTS).toBe('3')
  })

  it('accepts an existing sidecar only through bearer-authenticated /version ServiceResult', async () => {
    const spawnMock = vi.fn(() => createMockChild())

    await withProjectDagServer((_, response) => {
      sendJson(response, 200, {
        ok: true,
        data: { service: 'project-dag-engine', version: '0.2.0' }
      })
    }, async (baseUrl, requests) => {
      await ensureProjectDagSidecar(settings(), {
        userDataDir: '/tmp/sciforge',
        appRoot: '/app/root',
        env: projectDagEnv(baseUrl),
        spawnImpl: spawnMock as unknown as ProjectDagSpawn
      })

      expect(spawnMock).not.toHaveBeenCalled()
      expect(requests).toEqual([
        {
          method: 'GET',
          path: '/version',
          accept: 'application/json',
          authorization: 'Bearer project-token'
        }
      ])
    })
  })

  it('rejects a stale authenticated sidecar instead of spawning into its occupied port', async () => {
    const spawnMock = vi.fn(() => createMockChild())

    await withProjectDagServer((_, response) => {
      sendJson(response, 200, {
        ok: true,
        data: { service: 'project-dag-engine', version: '0.1.0' }
      })
    }, async (baseUrl) => {
      await expect(ensureProjectDagSidecar(settings(), {
        userDataDir: '/tmp/sciforge',
        appRoot: '/app/root',
        env: projectDagEnv(baseUrl),
        spawnImpl: spawnMock as unknown as ProjectDagSpawn
      })).rejects.toThrow(/0\.1\.0.*requires 0\.2\.0.*Restart SciForge/)

      expect(spawnMock).not.toHaveBeenCalled()
    })
  })

  it('does not treat the legacy top-level health payload as healthy', async () => {
    const spawnMock = vi.fn(() => createMockChild())

    await withProjectDagServer((_, response, requestCount) => {
      if (requestCount === 1) {
        sendJson(response, 200, { ok: true, service: 'project-dag-engine' })
        return
      }
      sendJson(response, 200, {
        ok: true,
        data: { service: 'project-dag-engine', version: '0.2.0' }
      })
    }, async (baseUrl, requests) => {
      await ensureProjectDagSidecar(settings(), {
        userDataDir: '/tmp/sciforge',
        appRoot: '/app/root',
        env: projectDagEnv(baseUrl),
        spawnImpl: spawnMock as unknown as ProjectDagSpawn
      })

      expect(spawnMock).toHaveBeenCalledOnce()
      expect(requests.map((request) => request.path)).toEqual(['/version', '/version'])
      expect(requests.every((request) => request.authorization === 'Bearer project-token')).toBe(true)
    })
  })

  it('creates session and database directories before spawning the sidecar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-project-dag-sidecar-'))
    const spawnMock = vi.fn(() => createMockChild())
    const sessionDir = join(root, 'missing', 'sessions')
    const dbPath = join(root, 'missing', 'project-dag', 'project.db')

    try {
      await withProjectDagServer((_, response, requestCount) => {
        if (requestCount === 1) {
          response.writeHead(503)
          response.end()
          return
        }
        sendJson(response, 200, {
          ok: true,
          data: { service: 'project-dag-engine', version: '0.2.0' }
        })
      }, async (baseUrl) => {
        await ensureProjectDagSidecar(settings(), {
          userDataDir: root,
          appRoot: '/app/root',
          env: {
            ...projectDagEnv(baseUrl),
            PDAG_SESSION_DIR: sessionDir,
            PDAG_DB_PATH: dbPath
          } as NodeJS.ProcessEnv,
          spawnImpl: spawnMock as unknown as ProjectDagSpawn
        })

        expect(spawnMock).toHaveBeenCalledOnce()
        expect(existsSync(sessionDir)).toBe(true)
        expect(existsSync(join(root, 'missing', 'project-dag'))).toBe(true)
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails promptly when the spawned sidecar exits before becoming healthy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-project-dag-sidecar-exit-'))
    const spawnMock = vi.fn(() => {
      const child = createMockChild()
      setImmediate(() => child.emit('exit', 1, null))
      return child
    })

    try {
      await expect(
        ensureProjectDagSidecar(settings(), {
          userDataDir: root,
          appRoot: '/app/root',
          env: projectDagEnv('http://127.0.0.1:9'),
          spawnImpl: spawnMock as unknown as ProjectDagSpawn
        })
      ).rejects.toThrow('Project DAG sidecar exited before becoming ready')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('coalesces concurrent readiness checks into a single sidecar spawn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-project-dag-sidecar-concurrent-'))
    const spawnMock = vi.fn(() => createMockChild())

    try {
      await withProjectDagServer((_, response, requestCount) => {
        if (requestCount === 1) {
          response.writeHead(503)
          response.end()
          return
        }
        sendJson(response, 200, {
          ok: true,
          data: { service: 'project-dag-engine', version: '0.2.0' }
        })
      }, async (baseUrl) => {
        const options = {
          userDataDir: root,
          appRoot: '/app/root',
          env: projectDagEnv(baseUrl),
          spawnImpl: spawnMock as unknown as ProjectDagSpawn
        }

        await Promise.all([
          ensureProjectDagSidecar(settings(), options),
          ensureProjectDagSidecar(settings(), options)
        ])

        expect(spawnMock).toHaveBeenCalledOnce()
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function projectDagEnv(baseUrl: string): NodeJS.ProcessEnv {
  return {
    [PROJECT_DAG_SERVICE_URL_ENV]: baseUrl,
    [PROJECT_DAG_API_KEY_ENV]: 'project-token'
  } as NodeJS.ProcessEnv
}

async function withProjectDagServer(
  respond: (request: IncomingMessage, response: ServerResponse, requestCount: number) => void,
  run: (baseUrl: string, requests: HealthRequest[]) => Promise<void>
): Promise<void> {
  const requests: HealthRequest[] = []
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      accept: request.headers.accept,
      authorization: request.headers.authorization
    })
    respond(request, response, requests.length)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind to TCP')
    await run(`http://127.0.0.1:${address.port}`, requests)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
}

function createMockChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.defineProperties(child, {
    exitCode: { value: null, writable: true },
    signalCode: { value: null, writable: true }
  })
  child.kill = ((signal?: NodeJS.Signals | number) => {
    const signalCode = typeof signal === 'string' ? signal : 'SIGTERM'
    ;(child as ChildProcess & { signalCode: NodeJS.Signals | null }).signalCode = signalCode
    setImmediate(() => child.emit('exit', null, signalCode))
    return true
  }) as ChildProcess['kill']
  return child
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
