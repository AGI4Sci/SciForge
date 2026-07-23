import { describe, expect, it } from 'vitest'
import type {
  ProcessRequest,
  ProcessResult,
  RemoteSshProcessRunner
} from './process-runner.js'
import {
  OpenSshTargetResolutionError,
  SystemOpenSshTargetResolver,
  parseOpenSshTarget
} from './ssh-target-resolver.js'

class FakeRunner implements RemoteSshProcessRunner {
  readonly requests: ProcessRequest[] = []

  constructor(private readonly result: ProcessResult) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request)
    return this.result
  }
}

describe('SystemOpenSshTargetResolver', () => {
  it('uses shell-free ssh -G and returns the effective target endpoint', async () => {
    const runner = new FakeRunner(result({
      stdout: 'host lab-a\nhostname 10.20.30.40\nport 2222\nuser researcher\n'
    }))
    const resolver = new SystemOpenSshTargetResolver(runner)

    await expect(resolver.resolve('lab-a-gpu01')).resolves.toEqual({
      host: '10.20.30.40',
      port: 2222
    })
    expect(runner.requests).toEqual([expect.objectContaining({
      executable: 'ssh',
      args: ['-G', '--', 'lab-a-gpu01'],
      timeoutMs: 10_000
    })])
  })

  it('rejects missing, invalid, truncated, and shell-shaped target values', async () => {
    expect(() => parseOpenSshTarget('hostname cluster.internal;touch\nport 22\n'))
      .toThrow(OpenSshTargetResolutionError)
    expect(() => parseOpenSshTarget('hostname cluster.internal\nport 0\n'))
      .toThrow(OpenSshTargetResolutionError)

    const resolver = new SystemOpenSshTargetResolver(new FakeRunner(result({
      stdout: 'hostname cluster.internal\nport 22\n',
      truncated: true
    })))
    await expect(resolver.resolve('lab-a-gpu01')).rejects.toThrow(OpenSshTargetResolutionError)
  })
})

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    truncated: false,
    timedOut: false,
    ...overrides
  }
}
