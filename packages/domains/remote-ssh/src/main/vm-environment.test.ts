import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  REMOTE_SSH_SCHEMA_VERSION,
  remoteSshVmEnvironmentConfigSchema,
  remoteSshVmEnvironmentLocatorConfigSchema,
  type RemoteSshLab
} from '../contract.js'
import {
  SystemVmCommandRunner,
  VirtualBoxLabEnvironmentProvider,
  canonicalVirtualBoxUuid,
  parseMachineReadableValue,
  parseVirtualBoxMachineList,
  systemOpenSshExecutable,
  virtualBoxManagerLaunchCommand,
  virtualBoxExecutableCandidates,
  type SpawnVmTunnel,
  type VmCommandRequest,
  type VmCommandResult,
  type VmCommandRunner,
  type VmTunnelProcess
} from './vm-environment.js'

const now = '2026-07-23T00:00:00.000Z'
const vmUuid = '11111111-2222-4333-8444-555555555555'
const lab: RemoteSshLab = {
  schemaVersion: REMOTE_SSH_SCHEMA_VERSION,
  id: 'lab-a',
  displayName: 'Lab A',
  environment: {
    provider: 'vm',
    driver: 'virtualbox',
    vmId: vmUuid,
    gatewaySshAlias: 'sciforge-lab-a-gateway'
  },
  maxConcurrentExecutions: 4,
  revision: 'lab-r1',
  createdAt: now,
  updatedAt: now
}

class FakeVmRunner implements VmCommandRunner {
  readonly requests: VmCommandRequest[] = []

  constructor(
    private readonly handler: (request: VmCommandRequest) => VmCommandResult,
    private readonly gatewayHandler: (request: VmCommandRequest) => VmCommandResult = () => ok()
  ) {}

  async run(request: VmCommandRequest): Promise<VmCommandResult> {
    this.requests.push(request)
    if (/(?:^|[/\\])ssh(?:\.exe)?$/iu.test(request.executable)) {
      return this.gatewayHandler(request)
    }
    return this.handler(request)
  }
}

class FakeTunnelProcess implements VmTunnelProcess {
  readonly pid = 42
  killed = false
  readonly signals: Array<NodeJS.Signals | number | undefined> = []
  private errorListener?: (error: Error) => void
  private exitListener?: (
    exitCode: number | null,
    signal: NodeJS.Signals | null
  ) => void

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true
    this.signals.push(signal)
    return true
  }

  once(event: 'error', listener: (error: Error) => void): this
  once(
    event: 'exit',
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
  ): this
  once(
    event: 'error' | 'exit',
    listener:
      | ((error: Error) => void)
      | ((exitCode: number | null, signal: NodeJS.Signals | null) => void)
  ): this {
    if (event === 'error') {
      this.errorListener = listener as (error: Error) => void
    } else {
      this.exitListener = listener as (
        exitCode: number | null,
        signal: NodeJS.Signals | null
      ) => void
    }
    return this
  }

  fail(error: Error): void {
    this.errorListener?.(error)
  }

  exit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    this.exitListener?.(exitCode, signal)
  }
}

describe('VirtualBoxLabEnvironmentProvider', () => {
  it('discovers registered VMs with canonical IDs and useful picker metadata', async () => {
    const runner = new FakeVmRunner((request) => {
      if (request.args.join(' ') === 'list vms') {
        return ok(
          `"VPN Windows" {AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}\n` +
          `"Ubuntu Lab" {11111111-2222-4333-8444-555555555555}\n`
        )
      }
      const uuid = request.args[1]
      return ok(
        `UUID="${uuid}"\n` +
        `VMState="${uuid?.startsWith('aaaaaaaa') ? 'running' : 'poweroff'}"\n` +
        `ostype="${uuid?.startsWith('aaaaaaaa') ? 'Windows11_64' : 'Ubuntu_64'}"\n` +
        'platformArchitecture="ARM"\n'
      )
    })
    const provider = fixtureProvider(runner)

    await expect(provider.listMachines()).resolves.toEqual({
      available: true,
      machines: [
        {
          uuid: '11111111-2222-4333-8444-555555555555',
          name: 'Ubuntu Lab',
          state: 'poweroff',
          osType: 'Ubuntu_64',
          architecture: 'ARM'
        },
        {
          uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          name: 'VPN Windows',
          state: 'running',
          osType: 'Windows11_64',
          architecture: 'ARM'
        }
      ]
    })
    expect(runner.requests.map((request) => request.args)).toEqual([
      ['list', 'vms'],
      ['showvminfo', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '--machinereadable'],
      ['showvminfo', '11111111-2222-4333-8444-555555555555', '--machinereadable']
    ])
  })

  it('returns an unavailable empty catalog when VirtualBox is not installed', async () => {
    const runner = new FakeVmRunner(() => ok())
    const provider = new VirtualBoxLabEnvironmentProvider({
      runner,
      platform: 'linux',
      isExecutable: async () => false
    })

    await expect(provider.listMachines()).resolves.toEqual({
      available: false,
      machines: []
    })
    expect(runner.requests).toEqual([])
  })

  it('resolves a user-entered VM name to the canonical VirtualBox UUID', async () => {
    const runner = new FakeVmRunner(() =>
      ok(`name="Research VPN"\nUUID="{AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}"\nVMState="poweroff"\n`))
    const provider = fixtureProvider(runner)

    await expect(provider.canonicalize({
      provider: 'vm',
      driver: 'virtualbox',
      vmId: 'Research VPN',
      gatewaySshAlias: 'research-vpn-gateway'
    })).resolves.toEqual({
      provider: 'vm',
      driver: 'virtualbox',
      vmId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      gatewaySshAlias: 'research-vpn-gateway'
    })
    expect(runner.requests[0]?.args).toEqual([
      'showvminfo',
      'Research VPN',
      '--machinereadable'
    ])
  })

  it('reports the provider as unavailable without invoking arbitrary commands', async () => {
    const runner = new FakeVmRunner(() => ok())
    const provider = new VirtualBoxLabEnvironmentProvider({
      runner,
      platform: 'linux',
      isExecutable: async () => false,
      now: () => new Date(now)
    })

    await expect(provider.get(lab)).resolves.toEqual({
      labId: lab.id,
      provider: 'vm',
      state: 'provider-unavailable',
      consoleAvailable: false,
      guidanceCode: 'install-provider',
      message: 'VirtualBox is not installed or VBoxManage is unavailable.',
      checkedAt: now
    })
    expect(runner.requests).toEqual([])
  })

  it('reports a missing configured VM without creating or adopting another VM', async () => {
    const runner = new FakeVmRunner(() =>
      failed(`VBoxManage: error: Could not find a registered machine named ${vmUuid}`))
    const provider = fixtureProvider(runner)

    await expect(provider.get(lab)).resolves.toMatchObject({
      state: 'configuration-required',
      consoleAvailable: false,
      guidanceCode: 'select-environment',
      message: expect.stringContaining(vmUuid)
    })
    expect(runner.requests).toHaveLength(1)
    expect(runner.requests[0]?.args).toEqual([
      'showvminfo',
      vmUuid,
      '--machinereadable'
    ])
  })

  it.each([
    {
      failure: 'ssh: Could not resolve hostname sciforge-lab-a-gateway: Name or service not known',
      guidanceCode: 'configure-gateway-alias'
    },
    {
      failure: 'Host key verification failed.',
      guidanceCode: 'trust-gateway-host-key'
    },
    {
      failure: 'sciforge@vm: Permission denied (publickey,password).',
      guidanceCode: 'authorize-gateway-key'
    },
    {
      failure: 'Connection timed out during banner exchange',
      guidanceCode: 'enable-gateway-ssh'
    }
  ] as const)(
    'turns an SSH readiness failure into $guidanceCode guidance',
    async ({ failure, guidanceCode }) => {
      const runner = new FakeVmRunner(
        () => machineState('running'),
        () => failed(failure)
      )
      const provider = fixtureProvider(runner)

      await expect(provider.get(lab)).resolves.toMatchObject({
        state: 'configuration-required',
        consoleAvailable: true,
        guidanceCode,
        message: failure
      })
      const probe = runner.requests.find((request) =>
        request.executable === '/usr/bin/ssh'
      )
      expect(probe).toMatchObject({
        args: expect.arrayContaining([
          '-T',
          '-o', 'BatchMode=yes',
          '-o', 'ClearAllForwardings=yes',
          '-o', 'ForwardAgent=no',
          '-o', 'ForwardX11=no',
          '-o', 'PermitLocalCommand=no',
          '-o', 'StrictHostKeyChecking=yes',
          lab.environment.provider === 'vm'
            ? lab.environment.gatewaySshAlias
            : ''
        ]),
        timeoutMs: 8_000
      })
    }
  )

  it('reports a ready gateway only after a non-interactive SSH probe succeeds', async () => {
    const runner = new FakeVmRunner(() => machineState('running'))
    const provider = fixtureProvider(runner)

    await expect(provider.get(lab)).resolves.toMatchObject({
      state: 'ready',
      consoleAvailable: true,
      guidanceCode: 'test-target'
    })
  })

  it('guides installation when the host OpenSSH client is missing', async () => {
    const runner = new FakeVmRunner(() => machineState('running'))
    const provider = fixtureProvider(runner, {
      isExecutable: async (path) => path === '/usr/bin/VBoxManage'
    })

    await expect(provider.get(lab)).resolves.toMatchObject({
      state: 'configuration-required',
      consoleAvailable: true,
      guidanceCode: 'install-host-openssh'
    })
    expect(runner.requests).toHaveLength(1)
  })

  it('starts a stopped VM in its visible VirtualBox console', async () => {
    let vmState = 'poweroff'
    const runner = new FakeVmRunner((request) => {
      if (request.args[0] === 'showvminfo') return machineState(vmState)
      if (request.args[0] === 'startvm') {
        vmState = 'running'
        return ok()
      }
      return failed(`Unexpected command: ${request.args.join(' ')}`)
    })
    const provider = fixtureProvider(runner)

    await expect(provider.ensure(lab)).resolves.toMatchObject({
      state: 'ready',
      consoleAvailable: true
    })
    expect(runner.requests.some((request) =>
      request.args.join(' ') === `startvm ${vmUuid} --type gui`
    )).toBe(true)
  })

  it('opens a stopped VM by actually starting its VirtualBox GUI frontend', async () => {
    let vmState = 'poweroff'
    const runner = new FakeVmRunner((request) => {
      if (request.args[0] === 'showvminfo') return machineState(vmState)
      if (request.args[0] === 'startvm') {
        vmState = 'running'
        return ok()
      }
      return failed()
    })
    const provider = fixtureProvider(runner)

    await expect(provider.openConsole(lab)).resolves.toEqual({
      labId: lab.id,
      presentation: { kind: 'opened' }
    })
    expect(runner.requests.some((request) =>
      request.args.join(' ') === `startvm ${vmUuid} --type gui`
    )).toBe(true)
  })

  it('starts an SSH dynamic SOCKS tunnel on strict loopback with Windows OpenSSH', async () => {
    const runner = new FakeVmRunner(() => machineState('running'))
    const tunnel = new FakeTunnelProcess()
    const spawns: Array<{
      executable: string
      args: readonly string[]
      options: Parameters<SpawnVmTunnel>[2]
    }> = []
    const spawnTunnel: SpawnVmTunnel = (executable, args, options) => {
      spawns.push({ executable, args, options })
      return tunnel
    }
    const provider = new VirtualBoxLabEnvironmentProvider({
      runner,
      spawnTunnel,
      platform: 'win32',
      environment: {
        ProgramFiles: String.raw`D:\Apps`,
        SystemRoot: String.raw`C:\Windows`
      },
      isExecutable: async () => true,
      isSocksProxyReady: async () => true,
      allocateLoopbackPort: async () => 41_023,
      now: () => new Date(now)
    })

    await expect(provider.proxyEndpoint(lab)).resolves.toEqual({
      host: '127.0.0.1',
      port: 41_023
    })
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.executable).toBe(
      String.raw`C:\Windows\System32\OpenSSH\ssh.exe`
    )
    expect(spawns[0]?.args).toEqual([
      '-N',
      '-D', '127.0.0.1:41023',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'BatchMode=yes',
      '-o', 'ControlMaster=no',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=2',
      'sciforge-lab-a-gateway'
    ])
    expect(spawns[0]?.args.join(' ')).not.toContain('0.0.0.0')
    expect(spawns[0]?.options).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore']
    })
  })

  it('opens VirtualBox Manager for an externally started VM', async () => {
    const runner = new FakeVmRunner(() => machineState('running'))
    const launches: Array<{
      platform: NodeJS.Platform
      vboxManageExecutable: string
    }> = []
    const provider = fixtureProvider(runner, {
      openVirtualBoxManager: async (input) => {
        launches.push(input)
      }
    })

    await expect(provider.openConsole(lab)).resolves.toEqual({
      labId: lab.id,
      presentation: { kind: 'opened' }
    })
    expect(launches).toEqual([{
      platform: 'linux',
      vboxManageExecutable: '/usr/bin/VBoxManage'
    }])
    expect(runner.requests.some((request) => request.args[0] === 'startvm')).toBe(false)
  })

  it('keeps console ownership while VirtualBox reports a starting transition', async () => {
    let vmState = 'poweroff'
    const runner = new FakeVmRunner((request) => {
      if (request.args[0] === 'showvminfo') return machineState(vmState)
      if (request.args[0] === 'startvm') {
        vmState = 'starting'
        return ok()
      }
      return failed()
    })
    const provider = fixtureProvider(runner, {
      wait: async () => {
        vmState = 'running'
      }
    })

    await expect(provider.ensure(lab)).resolves.toMatchObject({
      state: 'ready'
    })
    await expect(provider.openConsole(lab)).resolves.toEqual({
      labId: lab.id,
      presentation: { kind: 'opened' }
    })
  })

  it('does not try to start a paused VM as if it were powered off', async () => {
    const runner = new FakeVmRunner(() => machineState('paused'))
    const provider = fixtureProvider(runner)

    await expect(provider.ensure(lab)).rejects.toThrow('paused')
    expect(runner.requests.some((request) => request.args[0] === 'startvm')).toBe(false)
  })

  it('starts a stopped VM on demand before creating the proxy endpoint', async () => {
    let vmState = 'poweroff'
    const runner = new FakeVmRunner((request) => {
      if (request.args[0] === 'showvminfo') return machineState(vmState)
      if (request.args[0] === 'startvm') {
        vmState = 'running'
        return ok()
      }
      return failed()
    })
    const provider = fixtureProvider(runner, {
      spawnTunnel: () => new FakeTunnelProcess(),
      isSocksProxyReady: async () => true,
      allocateLoopbackPort: async () => 41_024
    })

    await expect(provider.proxyEndpoint(lab)).rejects.toThrow('is stopped')
    await expect(provider.proxyEndpoint(lab, {
      startIfStopped: true
    })).resolves.toEqual({
      host: '127.0.0.1',
      port: 41_024
    })
    expect(runner.requests.some((request) => request.args[0] === 'startvm')).toBe(true)
  })

  it('stops the tunnel before requesting guest shutdown and never deletes the user VM', async () => {
    let vmState = 'running'
    const runner = new FakeVmRunner((request) => {
      if (request.args[0] === 'showvminfo') return machineState(vmState)
      if (request.args[0] === 'controlvm') {
        vmState = 'poweroff'
        return ok()
      }
      return failed()
    })
    const tunnel = new FakeTunnelProcess()
    const provider = fixtureProvider(runner, {
      spawnTunnel: () => tunnel,
      isSocksProxyReady: async () => true,
      allocateLoopbackPort: async () => 41_025
    })
    await provider.proxyEndpoint(lab)

    await expect(provider.stop(lab)).resolves.toMatchObject({ state: 'stopped' })
    expect(tunnel.signals).toEqual(['SIGTERM'])
    expect(runner.requests.some((request) =>
      request.args.join(' ') === `controlvm ${vmUuid} acpipowerbutton`
    )).toBe(true)

    const requestCount = runner.requests.length
    await provider.remove(lab)
    expect(runner.requests).toHaveLength(requestCount)
    expect(runner.requests.some((request) =>
      request.args.includes('unregistervm') || request.args.includes('delete')
    )).toBe(false)
  })

  it('closes every active tunnel and rejects subsequent operations', async () => {
    const runner = new FakeVmRunner(() => machineState('running'))
    const tunnel = new FakeTunnelProcess()
    const provider = fixtureProvider(runner, {
      spawnTunnel: () => tunnel,
      isSocksProxyReady: async () => true,
      allocateLoopbackPort: async () => 41_026
    })
    await provider.proxyEndpoint(lab)

    provider.close()
    provider.close()

    expect(tunnel.signals).toEqual(['SIGTERM'])
    await expect(provider.get(lab)).rejects.toThrow(
      'lab environment provider is closed'
    )
  })

  it('does not accept a SOCKS endpoint when the spawned SSH process exits', async () => {
    let allocatedPort = 41_030
    const tunnels: FakeTunnelProcess[] = []
    const provider = fixtureProvider(
      new FakeVmRunner(() => machineState('running')),
      {
        spawnTunnel: () => {
          const tunnel = new FakeTunnelProcess()
          tunnels.push(tunnel)
          queueMicrotask(() => tunnel.exit(255, null))
          return tunnel
        },
        isSocksProxyReady: async () => true,
        allocateLoopbackPort: async () => allocatedPort++,
        wait: async () => undefined,
        terminateGraceMs: 5
      }
    )

    await expect(provider.proxyEndpoint(lab)).rejects.toThrow(
      'exited before becoming ready'
    )
    expect(tunnels).toHaveLength(3)
  })

  it('rejects a loopback listener that does not complete a SOCKS5 greeting', async () => {
    const server = createServer((socket) => {
      socket.once('data', () => {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Test server did not allocate a TCP port.')
    }
    const provider = fixtureProvider(
      new FakeVmRunner(() => machineState('running')),
      {
        spawnTunnel: () => new FakeTunnelProcess(),
        allocateLoopbackPort: async () => address.port,
        wait: async () => undefined,
        terminateGraceMs: 0
      }
    )

    try {
      await expect(provider.proxyEndpoint(lab)).rejects.toThrow(
        'did not complete a SOCKS5 handshake'
      )
    } finally {
      provider.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('terminates a tunnel that is still starting when the provider closes', async () => {
    let markProbeStarted!: () => void
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve
    })
    let releaseProbe!: (ready: boolean) => void
    const readiness = new Promise<boolean>((resolve) => {
      releaseProbe = resolve
    })
    const tunnel = new FakeTunnelProcess()
    const provider = fixtureProvider(
      new FakeVmRunner(() => machineState('running')),
      {
        spawnTunnel: () => tunnel,
        isSocksProxyReady: async () => {
          markProbeStarted()
          return readiness
        },
        allocateLoopbackPort: async () => 41_040,
        terminateGraceMs: 5
      }
    )

    const endpoint = provider.proxyEndpoint(lab)
    await probeStarted
    provider.close()
    releaseProbe(false)

    await expect(endpoint).rejects.toThrow('provider is closed')
    expect(tunnel.signals[0]).toBe('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(tunnel.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('propagates cancellation into VBoxManage inspection before spawning SSH', async () => {
    const controller = new AbortController()
    let markInspectionStarted!: () => void
    const inspectionStarted = new Promise<void>((resolve) => {
      markInspectionStarted = resolve
    })
    const runner: VmCommandRunner = {
      run: async (request) => {
        markInspectionStarted()
        return await new Promise<VmCommandResult>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      }
    }
    let spawnCount = 0
    const provider = fixtureProvider(runner, {
      spawnTunnel: () => {
        spawnCount += 1
        return new FakeTunnelProcess()
      }
    })

    const endpoint = provider.proxyEndpoint(lab, { signal: controller.signal })
    await inspectionStarted
    controller.abort()

    await expect(endpoint).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawnCount).toBe(0)
  })
})

describe('VirtualBox command helpers', () => {
  it('accepts a VirtualBox VM name with spaces as one argument', () => {
    const environment = {
      provider: 'vm',
      driver: 'virtualbox',
      vmId: 'SciForge Lab A',
      gatewaySshAlias: 'sciforge-lab-a-gateway'
    } as const

    expect(remoteSshVmEnvironmentLocatorConfigSchema.parse(environment).vmId)
      .toBe('SciForge Lab A')
    expect(remoteSshVmEnvironmentConfigSchema.safeParse(environment).success).toBe(false)
  })

  it('normalizes the UUID reported by VirtualBox', () => {
    expect(canonicalVirtualBoxUuid('{AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}'))
      .toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    expect(canonicalVirtualBoxUuid('not-a-uuid')).toBeUndefined()
  })

  it('parses quoted machine-readable values', () => {
    expect(parseMachineReadableValue(
      'name="Lab A"\nVMState="running"\n',
      'VMState'
    )).toBe('running')
  })

  it('parses the registered VM list without accepting malformed identifiers', () => {
    expect(parseVirtualBoxMachineList(
      `"VPN \\"A\\"" {AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}\n` +
      '"Broken" {not-a-uuid}\n'
    )).toEqual([{
      name: 'VPN "A"',
      uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    }])
  })

  it('uses the Windows system OpenSSH executable path', () => {
    expect(systemOpenSshExecutable('win32', {
      SystemRoot: String.raw`D:\Windows`
    })).toBe(String.raw`D:\Windows\System32\OpenSSH\ssh.exe`)
  })

  it('discovers VirtualBox from absolute PATH entries without using a shell', () => {
    expect(virtualBoxExecutableCandidates('linux', {
      PATH: '/nix/profile/bin:relative/bin:/custom/bin'
    })).toEqual([
      '/usr/bin/VBoxManage',
      '/usr/local/bin/VBoxManage',
      '/nix/profile/bin/VBoxManage',
      '/custom/bin/VBoxManage'
    ])
  })

  it('launches the platform VirtualBox Manager without a shell', () => {
    expect(virtualBoxManagerLaunchCommand(
      'darwin',
      '/Applications/VirtualBox.app/Contents/MacOS/VBoxManage'
    )).toEqual({
      executable: '/usr/bin/open',
      args: ['-a', 'VirtualBox']
    })
    expect(virtualBoxManagerLaunchCommand(
      'win32',
      String.raw`C:\Program Files\Oracle\VirtualBox\VBoxManage.exe`
    )).toEqual({
      executable: String.raw`C:\Program Files\Oracle\VirtualBox\VirtualBox.exe`,
      args: []
    })
    expect(virtualBoxManagerLaunchCommand(
      'linux',
      '/opt/virtualbox/VBoxManage'
    )).toEqual({
      executable: '/opt/virtualbox/VirtualBox',
      args: []
    })
  })

  it('force-kills a command that ignores graceful timeout termination', async () => {
    const runner = new SystemVmCommandRunner(10)

    const result = await runner.run({
      executable: process.execPath,
      args: [
        '-e',
        'process.on("SIGTERM", () => undefined); setInterval(() => undefined, 1000)'
      ],
      timeoutMs: 20
    })

    expect(result.timedOut).toBe(true)
  })
})

function fixtureProvider(
  runner: VmCommandRunner,
  overrides: Partial<ConstructorParameters<typeof VirtualBoxLabEnvironmentProvider>[0]> = {}
): VirtualBoxLabEnvironmentProvider {
  return new VirtualBoxLabEnvironmentProvider({
    runner,
    platform: 'linux',
    virtualBoxExecutable: '/usr/bin/VBoxManage',
    openSshExecutable: '/usr/bin/ssh',
    isExecutable: async () => true,
    wait: async () => undefined,
    now: () => new Date(now),
    ...overrides
  })
}

function machineState(state: string): VmCommandResult {
  return ok(`name="Lab A"\nUUID="${vmUuid}"\nVMState="${state}"\n`)
}

function ok(stdout = ''): VmCommandResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false }
}

function failed(stderr = ''): VmCommandResult {
  return { exitCode: 1, stdout: '', stderr, timedOut: false }
}
