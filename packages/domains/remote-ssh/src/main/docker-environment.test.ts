import { describe, expect, it } from 'vitest'
import type { RemoteSshLab } from '../contract.js'
import {
  DockerLabEnvironmentProvider,
  type DockerCommandRequest,
  type DockerCommandResult,
  type DockerCommandRunner
} from './docker-environment.js'

const now = '2026-07-23T00:00:00.000Z'
const CONTAINER_ID = 'a'.repeat(64)
const IDENTITY_FORMAT =
  '{{.Id}}|{{index .Config.Labels "com.sciforge.domain"}}|{{index .Config.Labels "com.sciforge.lab-id"}}|{{.Config.Image}}'
const lab: RemoteSshLab = {
  schemaVersion: 2,
  id: 'lab-a',
  displayName: 'Lab A',
  environment: {
    provider: 'docker',
    image: 'hagb/docker-atrust:latest'
  },
  maxConcurrentExecutions: 4,
  revision: 'lab-r1',
  createdAt: now,
  updatedAt: now
}

class FakeDockerRunner implements DockerCommandRunner {
  readonly requests: DockerCommandRequest[] = []
  readonly launches: Array<{ executable: string; args: readonly string[] }> = []

  constructor(private readonly handler: (request: DockerCommandRequest) => DockerCommandResult) {}

  async run(request: DockerCommandRequest): Promise<DockerCommandResult> {
    this.requests.push(request)
    return this.handler(request)
  }

  async launch(executable: string, args: readonly string[]): Promise<void> {
    this.launches.push({ executable, args })
  }
}

describe('DockerLabEnvironmentProvider', () => {
  it('canonicalizes only schema-valid Docker environment locators', async () => {
    const runner = new FakeDockerRunner(() => {
      throw new Error('Canonicalization must not call Docker.')
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.canonicalize({
      provider: 'docker',
      image: '  hagb/docker-atrust:latest  '
    })).resolves.toEqual({
      provider: 'docker',
      image: 'hagb/docker-atrust:latest'
    })
    await expect(provider.canonicalize({
      provider: 'docker',
      image: '--privileged'
    })).rejects.toThrow()
    await expect(provider.canonicalize({
      provider: 'vm',
      driver: 'virtualbox',
      vmId: 'lab-a-vm',
      gatewaySshAlias: 'lab-a-gateway'
    })).rejects.toThrow('cannot canonicalize a non-Docker environment')
    expect(runner.requests).toEqual([])
    expect(runner.launches).toEqual([])
  })

  it('reports Docker as unavailable without mutating the host', async () => {
    const runner = new FakeDockerRunner(() => failed('Cannot connect to the Docker daemon.'))
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.get(lab)).resolves.toEqual({
      labId: lab.id,
      provider: 'docker',
      state: 'provider-unavailable',
      consoleAvailable: false,
      message: 'Cannot connect to the Docker daemon.',
      checkedAt: now
    })
    expect(provider.provider).toBe('docker')
    expect(runner.launches).toEqual([])
  })

  it('creates one loopback-only aTrust container without claiming VPN readiness from utun7', async () => {
    const image = requireDockerImage(lab)
    let created = false
    const runner = new FakeDockerRunner((request) => {
      const args = request.args
      if (args[0] === 'info') return ok('27.0.0')
      if (args[0] === 'inspect' && args.includes(IDENTITY_FORMAT)) {
        return created
          ? ok(`${CONTAINER_ID}|remote-ssh|${lab.id}|${image}`)
          : failed('No such object')
      }
      if (args[0] === 'pull') return ok()
      if (args[0] === 'create') {
        created = true
        return ok('container-id')
      }
      if (args[0] === 'start') return ok()
      if (args[0] === 'inspect' && args.includes('{{json .State}}')) {
        return ok(JSON.stringify({ Running: true, Status: 'running', Error: '' }))
      }
      if (args[0] === 'port') return ok('127.0.0.1:32768')
      if (args[0] === 'inspect' && args.includes('{{range .Config.Env}}{{println .}}{{end}}')) {
        return ok('URLWIN=1\nPASSWORD=abcdefgh\n')
      }
      return failed(`Unexpected command: ${args.join(' ')}`)
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    const result = await provider.ensure(lab)

    expect(result).toEqual({
      labId: lab.id,
      provider: 'docker',
      state: 'login-required',
      consoleAvailable: true,
      checkedAt: now
    })
    const create = runner.requests.find((request) => request.args[0] === 'create')
    expect(create?.args).toEqual(expect.arrayContaining([
      '--device', '/dev/net/tun',
      '--cap-add', 'NET_ADMIN',
      '--label', 'com.sciforge.domain=remote-ssh',
      '--label', `com.sciforge.lab-id=${lab.id}`,
      '--publish', '127.0.0.1::8080',
      '--volume', expect.stringMatching(/^sciforge-atrust-data-/),
      image
    ]))
    expect(create?.args.join(' ')).not.toContain('0.0.0.0')
    expect(runner.requests.filter((request) => request.args[0] === 'create')).toHaveLength(1)
    expect(runner.requests.some((request) => request.args.includes('alpine:3.22'))).toBe(false)
    expect(runner.requests.some((request) => request.args.includes('--network'))).toBe(false)
    expect(runner.requests.some((request) => request.args[0] === 'exec')).toBe(false)
    await expect(provider.proxyEndpoint(lab)).resolves.toEqual({
      host: '127.0.0.1',
      port: 32768
    })
    expect(runner.requests.at(-1)?.args).toEqual([
      'port', expect.stringMatching(/^sciforge-atrust-[a-f0-9]{20}$/), '1080/tcp'
    ])
    await expect(provider.openConsole(lab)).resolves.toEqual({
      labId: lab.id,
      presentation: {
        kind: 'external-url',
        url: 'http://127.0.0.1:32768/vnc.html?autoconnect=true&resize=scale&password=abcdefgh'
      }
    })
  })

  it('retains the container data when stopped', async () => {
    const image = requireDockerImage(lab)
    const runner = new FakeDockerRunner((request) => {
      if (request.args[0] === 'info') return ok('27.0.0')
      if (request.args[0] === 'stop') return ok()
      if (request.args.includes(IDENTITY_FORMAT)) {
        return ok(`${CONTAINER_ID}|remote-ssh|${lab.id}|${image}`)
      }
      if (request.args.includes('{{json .State}}')) {
        return ok(JSON.stringify({ Running: false, Status: 'created', Error: '' }))
      }
      return ok()
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.stop(lab)).resolves.toMatchObject({
      provider: 'docker',
      state: 'stopped'
    })
    expect(runner.requests.find((request) => request.args[0] === 'stop')?.args).toEqual([
      'stop', '--time', '10', CONTAINER_ID
    ])
    expect(runner.requests.some((request) => request.args[0] === 'volume')).toBe(false)
  })

  it('recreates a container for a changed image without deleting its persistent volume', async () => {
    const image = requireDockerImage(lab)
    const runner = new FakeDockerRunner((request) => {
      const args = request.args
      if (args[0] === 'info') return ok('27.0.0')
      if (args[0] === 'inspect' && args.includes(IDENTITY_FORMAT)) {
        return ok(`${CONTAINER_ID}|remote-ssh|${lab.id}|registry.example.test/atrust:old`)
      }
      if (args[0] === 'inspect' && args.includes('{{json .State}}')) {
        return ok(JSON.stringify({ Running: true, Status: 'running', Error: '' }))
      }
      if (args[0] === 'inspect' && args.includes('{{range .Config.Env}}{{println .}}{{end}}')) {
        return ok('PASSWORD=abcdefgh\n')
      }
      if (args[0] === 'port') return ok('127.0.0.1:32768')
      if (args[0] === 'exec') return failed()
      return ok()
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await provider.ensure(lab)

    const removed = runner.requests.find((request) => request.args[0] === 'rm')
    expect(removed?.args).toEqual([
      'rm', '--force', CONTAINER_ID
    ])
    const created = runner.requests.find((request) => request.args[0] === 'create')
    expect(created?.args).toEqual(expect.arrayContaining([
      '--volume', expect.stringMatching(/^sciforge-atrust-data-[a-f0-9]{20}:\/root$/),
      image
    ]))
    expect(runner.requests.some((request) => request.args[0] === 'volume')).toBe(false)
  })

  it('refuses to replace an image when the same container name belongs to another lab', async () => {
    const runner = new FakeDockerRunner((request) => {
      if (request.args[0] === 'info') return ok('27.0.0')
      if (request.args.includes(IDENTITY_FORMAT)) {
        return ok(`${CONTAINER_ID}|remote-ssh|lab-b|registry.example.test/atrust:old`)
      }
      return failed(`Unexpected command: ${request.args.join(' ')}`)
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.ensure(lab)).rejects.toThrow(
      'ownership does not match Remote SSH lab lab-a'
    )
    expect(runner.requests.some((request) => request.args[0] === 'rm')).toBe(false)
    expect(runner.requests.some((request) => request.args[0] === 'create')).toBe(false)
  })

  it('refuses to stop or remove a container without both ownership labels', async () => {
    const runner = new FakeDockerRunner((request) => {
      if (request.args.includes(IDENTITY_FORMAT)) {
        return ok(`${CONTAINER_ID}|another-domain|${lab.id}|${requireDockerImage(lab)}`)
      }
      return failed(`Unexpected command: ${request.args.join(' ')}`)
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.stop(lab)).rejects.toThrow(
      'ownership does not match Remote SSH lab lab-a'
    )
    await expect(provider.remove(lab)).rejects.toThrow(
      'ownership does not match Remote SSH lab lab-a'
    )
    expect(runner.requests.some((request) => request.args[0] === 'stop')).toBe(false)
    expect(runner.requests.some((request) => request.args[0] === 'rm')).toBe(false)
  })

  it('removes a verified owned container by immutable container ID', async () => {
    const runner = new FakeDockerRunner((request) => {
      if (request.args.includes(IDENTITY_FORMAT)) {
        return ok(`${CONTAINER_ID}|remote-ssh|${lab.id}|${requireDockerImage(lab)}`)
      }
      if (request.args[0] === 'rm') return ok()
      return failed(`Unexpected command: ${request.args.join(' ')}`)
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.remove(lab)).resolves.toBeUndefined()
    expect(runner.requests.find((request) => request.args[0] === 'rm')?.args).toEqual([
      'rm', '--force', CONTAINER_ID
    ])
  })

  it('treats a missing container as an idempotent stop and removal', async () => {
    const runner = new FakeDockerRunner((request) => {
      if (request.args.includes(IDENTITY_FORMAT)) {
        return failed('Error: No such object: sciforge-atrust-missing')
      }
      return failed(`Unexpected command: ${request.args.join(' ')}`)
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.stop(lab)).resolves.toMatchObject({
      provider: 'docker',
      state: 'configuration-required'
    })
    await expect(provider.remove(lab)).resolves.toBeUndefined()
    expect(runner.requests.some((request) => request.args[0] === 'stop')).toBe(false)
    expect(runner.requests.some((request) => request.args[0] === 'rm')).toBe(false)
  })

  it('rejects a SOCKS5 endpoint that Docker did not bind to loopback', async () => {
    const image = requireDockerImage(lab)
    const runner = runningDockerRunner(image, '0.0.0.0:32768')
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.proxyEndpoint(lab)).rejects.toThrow(
      'Docker did not return a loopback SOCKS5 endpoint'
    )
  })

  it('does not start a stopped container unless startIfStopped is true', async () => {
    const image = requireDockerImage(lab)
    let running = false
    const runner = new FakeDockerRunner((request) => {
      const args = request.args
      if (args[0] === 'info') return ok('27.0.0')
      if (args.includes(IDENTITY_FORMAT)) {
        return ok(`${CONTAINER_ID}|remote-ssh|${lab.id}|${image}`)
      }
      if (args.includes('{{json .State}}')) {
        return ok(JSON.stringify({
          Running: running,
          Status: running ? 'running' : 'created',
          Error: ''
        }))
      }
      if (args[0] === 'start') {
        running = true
        return ok()
      }
      if (args[0] === 'port') return ok('127.0.0.1:32768')
      if (args.includes('{{range .Config.Env}}{{println .}}{{end}}')) {
        return ok('PASSWORD=abcdefgh\n')
      }
      return failed(`Unexpected command: ${args.join(' ')}`)
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    await expect(provider.proxyEndpoint(lab, { startIfStopped: false })).rejects.toThrow(
      'Docker VPN environment is not running: stopped'
    )
    expect(runner.requests.some((request) => request.args[0] === 'start')).toBe(false)

    await expect(provider.proxyEndpoint(lab, { startIfStopped: true })).resolves.toEqual({
      host: '127.0.0.1',
      port: 32768
    })
    expect(runner.requests.filter((request) => request.args[0] === 'start')).toHaveLength(1)
  })

  it('rejects VM labs without probing Docker or falling back', async () => {
    const runner = new FakeDockerRunner(() => {
      throw new Error('Docker must not be called for a VM lab.')
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })
    const vmLab: RemoteSshLab = {
      ...lab,
      environment: {
        provider: 'vm',
        driver: 'virtualbox',
        vmId: 'lab-a-vm',
        gatewaySshAlias: 'lab-a-gateway'
      }
    }

    await expect(provider.get(vmLab)).rejects.toThrow(
      'does not use the Docker environment provider'
    )
    await expect(provider.proxyEndpoint(vmLab, { startIfStopped: true })).rejects.toThrow(
      'does not use the Docker environment provider'
    )
    expect(runner.requests).toEqual([])
    expect(runner.launches).toEqual([])
  })

  it('closes without stopping or removing persistent Docker resources', () => {
    const runner = new FakeDockerRunner(() => {
      throw new Error('Closing the provider must not call Docker.')
    })
    const provider = new DockerLabEnvironmentProvider({ runner, now: () => new Date(now) })

    provider.close()
    provider.close()

    expect(runner.requests).toEqual([])
    expect(runner.launches).toEqual([])
  })
})

function runningDockerRunner(image: string, socksPort: string): FakeDockerRunner {
  return new FakeDockerRunner((request) => {
    const args = request.args
    if (args[0] === 'info') return ok('27.0.0')
    if (args.includes(IDENTITY_FORMAT)) {
      return ok(`${CONTAINER_ID}|remote-ssh|${lab.id}|${image}`)
    }
    if (args.includes('{{json .State}}')) {
      return ok(JSON.stringify({ Running: true, Status: 'running', Error: '' }))
    }
    if (args[0] === 'port') {
      return ok(args.at(-1) === '1080/tcp' ? socksPort : '127.0.0.1:32769')
    }
    if (args.includes('{{range .Config.Env}}{{println .}}{{end}}')) {
      return ok('PASSWORD=abcdefgh\n')
    }
    return failed(`Unexpected command: ${args.join(' ')}`)
  })
}

function requireDockerImage(value: RemoteSshLab): string {
  if (value.environment.provider !== 'docker') throw new Error('Expected Docker lab.')
  return value.environment.image
}

function ok(stdout = ''): DockerCommandResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false }
}

function failed(stderr = ''): DockerCommandResult {
  return { exitCode: 1, stdout: '', stderr, timedOut: false }
}
