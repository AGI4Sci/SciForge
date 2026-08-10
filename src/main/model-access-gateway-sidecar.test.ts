import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import {
  modelAccessGatewayStatePath,
  stopModelAccessGatewaySidecar,
  synchronizeModelAccessGatewaySidecar,
  type ModelAccessGatewayLaunchSpec
} from './model-access-gateway-sidecar'

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess & {
    stdout: PassThrough
    stderr: PassThrough
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    pid: number
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.pid = pid
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    child.signalCode = signal === 'SIGKILL' ? 'SIGKILL' : null
    child.exitCode = signal === 'SIGKILL' ? 137 : 0
    queueMicrotask(() => child.emit('exit', child.exitCode, child.signalCode))
    return true
  }) as unknown as ChildProcess['kill']
  return child
}

function spec(
  mode: 'model-router' | 'plan-gateway',
  childId: string,
  prepare?: () => Promise<void>
): ModelAccessGatewayLaunchSpec {
  return {
    mode,
    command: 'node',
    args: [`${mode}-${childId}`],
    env: { SCIFORGE_TEST_SECRET: 'should-not-be-written' },
    cwd: '/tmp/sciforge',
    signature: JSON.stringify({ mode, childId, secret: 'should-not-be-written' }),
    instanceId: `${mode}-${childId}`,
    healthUrl: `http://127.0.0.1:${mode === 'plan-gateway' ? 3893 : 3894}/healthz`,
    startMessage: `Starting ${mode}`,
    logLabel: mode,
    ...(prepare ? { prepare } : {})
  }
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-model-access-gateway-'))
}

describe('Model Access gateway sidecar controller', () => {
  const roots: string[] = []

  afterEach(async () => {
    vi.useRealTimers()
    await stopModelAccessGatewaySidecar({ userDataDir: roots[roots.length - 1], platform: 'linux' })
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('keeps one child across API to Coding Plan switches', async () => {
    const root = await tempRoot()
    roots.push(root)
    const first = fakeChild(4101)
    const second = fakeChild(4102)
    const spawnImpl = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)

    await synchronizeModelAccessGatewaySidecar(spec('model-router', 'one'), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      platform: 'linux'
    })
    await synchronizeModelAccessGatewaySidecar(spec('plan-gateway', 'two'), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      platform: 'linux'
    })

    expect(spawnImpl).toHaveBeenCalledTimes(2)
    expect(first.kill).toHaveBeenCalledWith('SIGTERM')
    expect(second.kill).not.toHaveBeenCalled()
    const state = JSON.parse(await readFile(modelAccessGatewayStatePath(root), 'utf8')) as Record<string, unknown>
    expect(state.mode).toBe('plan-gateway')
    expect(state.signatureHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(state)).not.toContain('should-not-be-written')
  })

  it('serializes concurrent reconciles so an older request cannot win last', async () => {
    const root = await tempRoot()
    roots.push(root)
    const first = fakeChild(4201)
    const second = fakeChild(4202)
    const spawnImpl = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    let releaseFirstPrepare!: () => void
    const firstPrepare = new Promise<void>((resolve) => { releaseFirstPrepare = resolve })

    const firstRun = synchronizeModelAccessGatewaySidecar(spec('model-router', 'one', () => firstPrepare), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      platform: 'linux'
    })
    const secondRun = synchronizeModelAccessGatewaySidecar(spec('plan-gateway', 'two'), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      platform: 'linux'
    })
    await Promise.resolve()
    expect(spawnImpl).not.toHaveBeenCalled()
    releaseFirstPrepare()
    await Promise.all([firstRun, secondRun])

    expect(spawnImpl).toHaveBeenCalledTimes(2)
    expect(first.kill).toHaveBeenCalledWith('SIGTERM')
    const state = JSON.parse(await readFile(modelAccessGatewayStatePath(root), 'utf8')) as Record<string, unknown>
    expect(state.mode).toBe('plan-gateway')
  })

  it('waits for a recorded process to release its health endpoint before force killing', async () => {
    const root = await tempRoot()
    roots.push(root)
    const statePath = modelAccessGatewayStatePath(root)
    await mkdir(join(root, 'model-access-gateway'), { recursive: true })
    await writeFile(statePath, `${JSON.stringify({
      pid: 4301,
      instanceId: 'old-instance',
      mode: 'plan-gateway',
      healthUrl: 'http://127.0.0.1:3893/healthz',
      signatureHash: 'old'
    })}\n`, 'utf8')
    const killProcessImpl = vi.fn(() => true)
    const fetchImpl = vi.fn(async () => Response.json({
      status: 'ok',
      workerId: 'sciforge.plan-gateway',
      instanceId: 'old-instance'
    }))

    await stopModelAccessGatewaySidecar({
      userDataDir: root,
      fetchImpl,
      killProcessImpl: killProcessImpl as never,
      isProcessAliveImpl: () => true,
      recordedStopTimeoutMs: 20,
      platform: 'linux'
    })

    expect(killProcessImpl).toHaveBeenNthCalledWith(1, 4301, 'SIGTERM')
    expect(killProcessImpl).toHaveBeenNthCalledWith(2, 4301, 'SIGKILL')
    await expect(readFile(statePath, 'utf8')).rejects.toThrow()
  })

  it('cleans a legacy Model Router state before reusing its endpoint', async () => {
    const root = await tempRoot()
    roots.push(root)
    const legacyPath = join(root, 'model-router', 'sidecar-state.json')
    await mkdir(join(root, 'model-router'), { recursive: true })
    await writeFile(legacyPath, `${JSON.stringify({
      pid: 4351,
      instanceId: 'legacy-router',
      signature: 'legacy'
    })}\n`, 'utf8')
    const child = fakeChild(4352)
    const spawnImpl = vi.fn(() => child)
    const killProcessImpl = vi.fn(() => true)
    const fetchImpl = vi.fn(async () => Response.json({
      service: 'sciforge.model-router',
      instanceId: 'legacy-router'
    }))

    await synchronizeModelAccessGatewaySidecar(spec('model-router', 'current'), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      fetchImpl,
      killProcessImpl: killProcessImpl as never,
      isProcessAliveImpl: () => false,
      platform: 'linux'
    })

    expect(killProcessImpl).toHaveBeenCalledWith(4351, 'SIGTERM')
    await expect(readFile(legacyPath, 'utf8')).rejects.toThrow()
    expect(spawnImpl).toHaveBeenCalledTimes(1)
  })

  it('restarts an unexpectedly exited gateway without waiting for another settings sync', async () => {
    vi.useFakeTimers()
    const root = await tempRoot()
    roots.push(root)
    const failed = fakeChild(4401)
    const replacement = fakeChild(4402)
    const spawnImpl = vi.fn()
      .mockReturnValueOnce(failed)
      .mockReturnValueOnce(replacement)
    const log = vi.fn()

    await synchronizeModelAccessGatewaySidecar(spec('model-router', 'one'), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      log,
      platform: 'linux'
    })
    Object.defineProperty(failed, 'exitCode', { value: 1, configurable: true })
    failed.emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(250)

    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(2))
    expect(log).toHaveBeenCalledWith(
      'model-router sidecar exited unexpectedly (code=1, signal=null).'
    )
    expect(log).toHaveBeenCalledWith('model-router sidecar will restart in 250ms.')
    const state = JSON.parse(await readFile(modelAccessGatewayStatePath(root), 'utf8')) as Record<string, unknown>
    expect(state.pid).toBe(4402)
  })

  it('reclaims both legacy state files when the current mode can prove ownership', async () => {
    const root = await tempRoot()
    roots.push(root)
    await mkdir(join(root, 'model-router'), { recursive: true })
    await mkdir(join(root, 'plan-gateway'), { recursive: true })
    await writeFile(join(root, 'model-router', 'sidecar-state.json'), JSON.stringify({
      pid: 4501,
      instanceId: 'old-router',
      mode: 'model-router'
    }))
    await writeFile(join(root, 'plan-gateway', 'sidecar-state.json'), JSON.stringify({
      pid: 4502,
      instanceId: 'old-plan'
    }))
    const child = fakeChild(4503)
    const killProcessImpl = vi.fn(() => true)
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)
      if (url.includes('3894/health')) {
        return Response.json({ service: 'sciforge.model-router', instanceId: 'old-router' })
      }
      return Response.json({ status: 'ok', workerId: 'sciforge.plan-gateway', instanceId: 'old-plan' })
    })

    await synchronizeModelAccessGatewaySidecar(spec('model-router', 'current'), {
      userDataDir: root,
      spawnImpl: vi.fn(() => child) as never,
      fetchImpl,
      killProcessImpl: killProcessImpl as never,
      isProcessAliveImpl: () => false,
      platform: 'linux'
    })

    expect(killProcessImpl).toHaveBeenNthCalledWith(1, 4501, 'SIGTERM')
    expect(killProcessImpl).toHaveBeenNthCalledWith(2, 4502, 'SIGTERM')
    await expect(readFile(join(root, 'model-router', 'sidecar-state.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(root, 'plan-gateway', 'sidecar-state.json'), 'utf8')).rejects.toThrow()
  })

  it('terminates the full managed process tree on Windows mode switches', async () => {
    const root = await tempRoot()
    roots.push(root)
    const first = fakeChild(4601)
    const second = fakeChild(4602)
    const spawnImpl = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const killProcessTreeImpl = vi.fn(async (pid: number) => {
      if (pid === first.pid) {
        Object.defineProperty(first, 'exitCode', { value: 137, configurable: true })
        Object.defineProperty(first, 'signalCode', { value: 'SIGKILL', configurable: true })
        first.emit('exit', 137, 'SIGKILL')
      }
    })

    await synchronizeModelAccessGatewaySidecar(spec('model-router', 'one'), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      killProcessTreeImpl,
      platform: 'win32'
    })
    await synchronizeModelAccessGatewaySidecar(spec('plan-gateway', 'two'), {
      userDataDir: root,
      spawnImpl: spawnImpl as never,
      killProcessTreeImpl,
      platform: 'win32'
    })

    expect(killProcessTreeImpl).toHaveBeenCalledOnce()
    expect(killProcessTreeImpl).toHaveBeenCalledWith(4601)
    expect(first.kill).not.toHaveBeenCalled()
    expect(spawnImpl).toHaveBeenCalledTimes(2)
  })
})
