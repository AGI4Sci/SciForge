import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  buildPlanGatewaySidecarLaunch,
  ensurePlanGatewaySidecar,
  stopPlanGatewaySidecar
} from './plan-gateway-sidecar'

const tempRoots: string[] = []

function settings(mode: 'api' | 'coding-plan' = 'coding-plan'): AppSettingsV1 {
  return {
    modelAccess: { mode, planAdapterId: 'codex' }
  } as AppSettingsV1
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-plan-gateway-'))
  tempRoots.push(root)
  return root
}

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => {
      Object.assign(child, { exitCode: 0 })
      queueMicrotask(() => child.emit('exit', 0, null))
      return true
    })
  })
  return child
}

afterEach(async () => {
  await stopPlanGatewaySidecar()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('Plan Gateway sidecar', () => {
  it('builds a fixed loopback launch only for coding-plan mode', () => {
    const disabled = buildPlanGatewaySidecarLaunch(settings('api'), {
      userDataDir: '/data',
      npmCommand: 'npm'
    })
    expect(disabled).toMatchObject({ ok: false })

    const result = buildPlanGatewaySidecarLaunch(settings(), {
      userDataDir: '/data',
      appRoot: '/app',
      env: { PATH: '/bin' },
      npmCommand: 'npm',
      instanceId: 'instance-1'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch).toMatchObject({
      command: 'npm',
      cwd: '/app',
      adapterId: 'codex',
      baseUrl: 'http://127.0.0.1:3893/v1'
    })
    expect(result.launch.args).toEqual([
      '--workspace', '@sciforge/plan-gateway', 'run', 'start', '--',
      '--host', '127.0.0.1', '--port', '3893', '--mount-path', '/v1',
      '--adapter', 'codex', '--quiet'
    ])
    expect(result.launch.env).toEqual({
      PATH: '/bin',
      SCIFORGE_PLAN_GATEWAY_INSTANCE_ID: 'instance-1',
      SCIFORGE_PLAN_GATEWAY_USER_DATA_DIR: '/data'
    })
  })

  it('builds a packaged launch from the unpacked app entry without system npm', () => {
    const result = buildPlanGatewaySidecarLaunch(settings(), {
      userDataDir: '/data',
      resourcesPath: '/Applications/SciForge.app/Contents/Resources',
      execPath: '/opt/SciForge',
      isPackaged: true,
      npmCommand: 'must-not-be-used',
      env: { PATH: '/bin' },
      instanceId: 'instance-1'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.command).toBe('/opt/SciForge')
    expect(result.launch.cwd).toBe(
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked'
    )
    expect(result.launch.args).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/plan-gateway-sidecar-node-entry.js',
      '--host', '127.0.0.1', '--port', '3893', '--mount-path', '/v1',
      '--adapter', 'codex', '--quiet'
    ])
    expect(result.launch.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(result.launch.env.SCIFORGE_PLAN_GATEWAY_USER_DATA_DIR).toBe('/data')
  })

  it('passes resolved system proxy rules only through the child environment', async () => {
    const child = fakeChild()
    let spawnedEnv: NodeJS.ProcessEnv | undefined
    const spawnImpl = vi.fn((...args: unknown[]) => {
      spawnedEnv = (args[2] as SpawnOptions | undefined)?.env
      return child
    })
    const fetchImpl = vi.fn(async () => Response.json({
      status: 'ok',
      workerId: 'sciforge.plan-gateway',
      adapterId: 'codex',
      protocol: 'responses',
      traceCapture: 'ready',
      instanceId: spawnedEnv?.SCIFORGE_PLAN_GATEWAY_INSTANCE_ID
    }))
    const resolveProxy = vi.fn(async () => 'PROXY 127.0.0.1:4567; DIRECT')

    await ensurePlanGatewaySidecar(settings(), {
      userDataDir: tempRoot(),
      appRoot: '/app',
      env: { PATH: '/bin' },
      spawnImpl: spawnImpl as never,
      fetchImpl,
      resolveProxy
    })

    expect(resolveProxy).toHaveBeenCalledWith('https://chatgpt.com/backend-api/codex')
    expect(spawnedEnv?.SCIFORGE_PLAN_GATEWAY_PROXY_RULES).toBe('PROXY 127.0.0.1:4567; DIRECT')
    expect(spawnImpl.mock.calls[0]?.[1]).not.toContain('PROXY 127.0.0.1:4567; DIRECT')
  })

  it('starts one managed child and waits for its matching health identity', async () => {
    const child = fakeChild()
    let spawnedEnv: NodeJS.ProcessEnv | undefined
    const spawnImpl = vi.fn((...args: unknown[]) => {
      spawnedEnv = (args[2] as SpawnOptions | undefined)?.env
      return child
    })
    const fetchImpl = vi.fn(async () => Response.json({
      status: 'ok',
      workerId: 'sciforge.plan-gateway',
      adapterId: 'codex',
      protocol: 'responses',
      traceCapture: 'ready',
      instanceId: spawnedEnv?.SCIFORGE_PLAN_GATEWAY_INSTANCE_ID
    }))

    await ensurePlanGatewaySidecar(settings(), {
      userDataDir: tempRoot(),
      appRoot: '/app',
      env: { PATH: '/bin' },
      spawnImpl: spawnImpl as never,
      fetchImpl
    })

    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalled()

    await ensurePlanGatewaySidecar(settings(), {
      userDataDir: tempRoots[0],
      appRoot: '/app',
      env: { PATH: '/bin' },
      spawnImpl: spawnImpl as never,
      fetchImpl
    })
    expect(spawnImpl).toHaveBeenCalledTimes(1)
  })

  it('stops the child when readiness fails', async () => {
    const child = fakeChild()

    await expect(ensurePlanGatewaySidecar(settings(), {
      userDataDir: tempRoot(),
      appRoot: '/app',
      spawnImpl: vi.fn(() => child) as never,
      fetchImpl: async () => {
        throw new Error('unavailable')
      },
      readyTimeoutMs: 25,
      platform: 'linux'
    })).rejects.toThrow(/did not become ready/)

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('reclaims a recorded gateway after mode or adapter changes', async () => {
    const root = tempRoot()
    const stateDir = join(root, 'plan-gateway')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, 'sidecar-state.json'), JSON.stringify({
      pid: 4243,
      instanceId: 'old-instance'
    }))
    const killProcessImpl = vi.fn(() => true)

    await stopPlanGatewaySidecar({
      userDataDir: root,
      fetchImpl: async () => Response.json({
        status: 'ok',
        workerId: 'sciforge.plan-gateway',
        adapterId: 'previous-adapter',
        instanceId: 'old-instance'
      }),
      killProcessImpl: killProcessImpl as never,
      platform: 'linux'
    })

    expect(killProcessImpl).toHaveBeenCalledWith(4243, 'SIGTERM')
  })
})
