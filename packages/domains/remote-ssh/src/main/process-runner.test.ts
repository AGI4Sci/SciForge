import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SystemOpenSshProcessRunner,
  type SpawnProcess
} from './process-runner.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('SystemOpenSshProcessRunner', () => {
  it('uses shell:false, a minimal environment, bounded output, and tolerates stdin EPIPE', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'must-not-reach-ssh')
    let executable = ''
    let options: Parameters<SpawnProcess>[2] | undefined
    const child = fakeChild()
    const spawnProcess: SpawnProcess = ((file, _args, spawnOptions) => {
      executable = file
      options = spawnOptions
      queueMicrotask(() => {
        const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
        child.stdin.emit('error', error)
        child.stdout.write('123456')
        child.emit('close', 0, null)
      })
      return child.value
    }) as SpawnProcess
    const runner = new SystemOpenSshProcessRunner(spawnProcess)

    const result = await runner.run({
      executable: 'ssh',
      args: ['--', 'target', 'true'],
      stdin: 'payload',
      timeoutMs: 1_000,
      maxOutputBytes: 4
    })

    expect(executable).toMatch(/(?:\/usr\/bin\/ssh|OpenSSH[\\/]ssh\.exe)$/)
    expect(options).toMatchObject({ shell: false, windowsHide: true })
    expect(options?.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(options?.env).toHaveProperty('ELECTRON_RUN_AS_NODE', '1')
    expect(result).toMatchObject({ stdout: '1234', truncated: true, exitCode: 0 })
  })

  it('escalates a timed-out child from SIGTERM to SIGKILL and settles', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const signals: Array<NodeJS.Signals | number | undefined> = []
    child.value.kill = ((signal?: NodeJS.Signals | number) => {
      signals.push(signal)
      ;(child.value as unknown as { killed: boolean }).killed = true
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
      return true
    })
    const runner = new SystemOpenSshProcessRunner((() => child.value) as SpawnProcess)

    const resultPromise = runner.run({
      executable: 'ssh',
      args: ['--', 'target', 'true'],
      timeoutMs: 10,
      maxOutputBytes: 1024
    })
    await vi.advanceTimersByTimeAsync(1_011)

    await expect(resultPromise).resolves.toMatchObject({ timedOut: true, signal: 'SIGKILL' })
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })
})

function fakeChild() {
  const events = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const value = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill: (_signal?: NodeJS.Signals | number) => true
  }) as unknown as ReturnType<SpawnProcess>
  return {
    value,
    stdin,
    stdout,
    stderr,
    emit: (event: string, ...args: unknown[]) => events.emit(event, ...args)
  }
}
