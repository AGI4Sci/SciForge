import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { createServer, connect } from 'node:net'
import { isAbsolute, posix, win32 } from 'node:path'
import type {
  RemoteSshLab,
  RemoteSshLabEnvironmentConfig,
  RemoteSshLabEnvironmentLocatorConfig,
  RemoteSshLabEnvironmentResult,
  RemoteSshVirtualBoxMachine,
  RemoteSshVirtualBoxMachineListResult,
  RemoteSshVmEnvironmentLocatorConfig,
  RemoteSshVmEnvironmentConfig
} from '../contract.js'
import {
  remoteSshVirtualBoxUuidSchema,
  remoteSshVmEnvironmentConfigSchema
} from '../contract.js'
import type {
  RemoteSshLabEnvironmentProvider,
  RemoteSshProxyEndpoint,
  RemoteSshProxyEndpointOptions
} from './lab-environment.js'

const COMMAND_TIMEOUT_MS = 30_000
const VM_TRANSITION_ATTEMPTS = 60
const VM_TRANSITION_POLL_MS = 500
const TUNNEL_START_ATTEMPTS = 100
const TUNNEL_START_POLL_MS = 50
const TUNNEL_STABILITY_MS = 100
const TUNNEL_LAUNCH_ATTEMPTS = 3
const PROCESS_TERMINATE_GRACE_MS = 1_000
const MAX_OUTPUT_BYTES = 256 * 1_024

export type VmCommandRequest = Readonly<{
  executable: string
  args: readonly string[]
  timeoutMs?: number
  signal?: AbortSignal
}>

export type VmCommandResult = Readonly<{
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}>

export interface VmCommandRunner {
  run(request: VmCommandRequest): Promise<VmCommandResult>
}

export interface VmTunnelProcess {
  readonly pid?: number
  readonly killed?: boolean
  readonly exitCode?: number | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'error', listener: (error: Error) => void): this
  once(
    event: 'exit',
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
  ): this
}

export type SpawnVmTunnel = (
  executable: string,
  args: readonly string[],
  options: {
    readonly shell: false
    readonly windowsHide: true
    stdio: ['ignore', 'ignore', 'ignore']
  }
) => VmTunnelProcess

export type VirtualBoxLabEnvironmentProviderOptions = Readonly<{
  runner?: VmCommandRunner
  spawnTunnel?: SpawnVmTunnel
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  now?: () => Date
  wait?: (milliseconds: number) => Promise<void>
  isExecutable?: (path: string) => Promise<boolean>
  isSocksProxyReady?: (port: number, signal?: AbortSignal) => Promise<boolean>
  allocateLoopbackPort?: () => Promise<number>
  terminateGraceMs?: number
  virtualBoxExecutable?: string
  openSshExecutable?: string
}>

export interface RemoteSshVirtualBoxMachineCatalog {
  listMachines(signal?: AbortSignal): Promise<RemoteSshVirtualBoxMachineListResult>
  close?(): void
}

type ActiveTunnel = {
  process: VmTunnelProcess
  port: number
  vmId: string
  gatewaySshAlias: string
  ready: boolean
  startupFailure?: Error
}

export class VirtualBoxLabEnvironmentProvider
implements RemoteSshLabEnvironmentProvider, RemoteSshVirtualBoxMachineCatalog {
  readonly provider = 'vm' as const

  private readonly runner: VmCommandRunner
  private readonly spawnTunnel: SpawnVmTunnel
  private readonly platform: NodeJS.Platform
  private readonly environment: NodeJS.ProcessEnv
  private readonly now: () => Date
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly isExecutable: (path: string) => Promise<boolean>
  private readonly isSocksProxyReady: (
    port: number,
    signal?: AbortSignal
  ) => Promise<boolean>
  private readonly allocateLoopbackPort: () => Promise<number>
  private readonly terminateGraceMs: number
  private readonly configuredVirtualBoxExecutable?: string
  private readonly configuredOpenSshExecutable?: string
  private readonly tunnels = new Map<string, ActiveTunnel>()
  private readonly terminatingTunnels = new Set<VmTunnelProcess>()
  private readonly visibleConsoles = new Map<string, string>()
  private closed = false

  constructor(options: VirtualBoxLabEnvironmentProviderOptions = {}) {
    this.runner = options.runner ?? new SystemVmCommandRunner()
    this.spawnTunnel = options.spawnTunnel ?? ((executable, args, spawnOptions) =>
      spawn(executable, args, spawnOptions) as VmTunnelProcess)
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
    this.now = options.now ?? (() => new Date())
    this.wait = options.wait ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.isExecutable = options.isExecutable ?? executableExists
    this.isSocksProxyReady = options.isSocksProxyReady ?? socks5ProxyReady
    this.allocateLoopbackPort = options.allocateLoopbackPort ?? allocateLoopbackPort
    this.terminateGraceMs = options.terminateGraceMs ?? PROCESS_TERMINATE_GRACE_MS
    this.configuredVirtualBoxExecutable = options.virtualBoxExecutable
    this.configuredOpenSshExecutable = options.openSshExecutable
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const labId of [...this.tunnels.keys()]) this.terminateTunnel(labId)
    this.visibleConsoles.clear()
  }

  async canonicalize(
    environment: RemoteSshLabEnvironmentLocatorConfig
  ): Promise<RemoteSshLabEnvironmentConfig> {
    this.assertOpen()
    const config = requireVirtualBoxLocatorConfig(environment)
    const canonicalInput = remoteSshVmEnvironmentConfigSchema.safeParse(config)
    if (canonicalInput.success) return canonicalInput.data
    const executable = await this.requireVirtualBoxExecutable()
    const machine = await this.inspectMachine(executable, config.vmId)
    if (machine.kind === 'missing') {
      throw new Error(`VirtualBox virtual machine is not registered: ${config.vmId}`)
    }
    if (machine.kind === 'failed') throw new Error(machine.message)
    return {
      provider: 'vm',
      driver: 'virtualbox',
      vmId: machine.uuid,
      gatewaySshAlias: config.gatewaySshAlias
    }
  }

  async listMachines(signal?: AbortSignal): Promise<RemoteSshVirtualBoxMachineListResult> {
    this.assertOpen()
    throwIfAborted(signal)
    const executable = await this.virtualBoxExecutable()
    if (!executable) return { available: false, machines: [] }
    const listed = await this.runner.run({
      executable,
      args: ['list', 'vms'],
      timeoutMs: COMMAND_TIMEOUT_MS,
      signal
    })
    if (listed.exitCode !== 0 || listed.timedOut) {
      throw commandError('list VirtualBox virtual machines', listed)
    }
    const registered = parseVirtualBoxMachineList(listed.stdout)
    const inspected = await Promise.all(registered.map(async ({ name, uuid }) => {
      const machine = await this.inspectMachine(executable, uuid, signal)
      if (machine.kind !== 'machine') return null
      return {
        uuid: machine.uuid,
        name,
        state: machine.state,
        ...(machine.osType ? { osType: machine.osType } : {}),
        ...(machine.architecture ? { architecture: machine.architecture } : {})
      } satisfies RemoteSshVirtualBoxMachine
    }))
    return {
      available: true,
      machines: inspected
        .filter((machine): machine is RemoteSshVirtualBoxMachine => machine !== null)
        .sort((left, right) => left.name.localeCompare(right.name))
    }
  }

  async get(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    this.assertOpen()
    const config = requireVirtualBoxConfig(lab)
    const executable = await this.virtualBoxExecutable()
    if (!executable) {
      return this.result(lab, 'provider-unavailable', false,
        'VirtualBox is not installed or VBoxManage is unavailable.')
    }

    return this.getWithSignal(lab, config, executable)
  }

  private async getWithSignal(
    lab: RemoteSshLab,
    config: RemoteSshVmEnvironmentConfig,
    executable: string,
    signal?: AbortSignal
  ): Promise<RemoteSshLabEnvironmentResult> {
    throwIfAborted(signal)
    const machine = await this.inspectMachine(executable, config.vmId, signal)
    if (machine.kind === 'missing') {
      return this.result(
        lab,
        'configuration-required',
        false,
        `VirtualBox virtual machine is not registered: ${config.vmId}`
      )
    }
    if (machine.kind === 'failed') {
      return this.result(lab, 'failed', false, machine.message)
    }

    const state = normalizeVirtualBoxState(machine.state)
    if (state === 'running') {
      const tunnel = this.tunnels.get(lab.id)
      const ready = tunnel !== undefined &&
        tunnel.ready &&
        tunnel.vmId === config.vmId &&
        tunnel.gatewaySshAlias === config.gatewaySshAlias &&
        await this.isSocksProxyReady(tunnel.port, signal)
      if (!ready && tunnel) this.terminateTunnel(lab.id)
      return this.result(lab, ready ? 'ready' : 'login-required', true)
    }
    if (state === 'stopped') this.visibleConsoles.delete(lab.id)
    if (state === 'paused') {
      return this.result(
        lab,
        'failed',
        true,
        'The VirtualBox VM is paused. Resume or power it off in VirtualBox before continuing.'
      )
    }
    if (state === 'failed') {
      return this.result(
        lab,
        'failed',
        true,
        `VirtualBox reported VM state "${machine.state}".`
      )
    }
    return this.result(
      lab,
      state === 'stopping' ? 'starting' : state,
      true,
      state === 'stopping'
        ? `VirtualBox is completing the VM transition "${machine.state}".`
        : undefined
    )
  }

  async ensure(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    return this.ensureWithSignal(lab)
  }

  private async ensureWithSignal(
    lab: RemoteSshLab,
    signal?: AbortSignal
  ): Promise<RemoteSshLabEnvironmentResult> {
    this.assertOpen()
    throwIfAborted(signal)
    const config = requireVirtualBoxConfig(lab)
    const executable = await this.requireVirtualBoxExecutable()
    const initial = await this.getWithSignal(lab, config, executable, signal)
    if (initial.state === 'ready' || initial.state === 'login-required') return initial
    if (initial.state !== 'stopped') throw environmentStateError(initial)

    this.assertOpen()
    const started = await this.runner.run({
      executable,
      args: ['startvm', config.vmId, '--type', 'gui'],
      timeoutMs: COMMAND_TIMEOUT_MS,
      signal
    })
    if (started.exitCode !== 0 || started.timedOut) {
      throw commandError('start the VirtualBox virtual machine', started)
    }
    this.visibleConsoles.set(lab.id, config.vmId)

    for (let attempt = 0; attempt < VM_TRANSITION_ATTEMPTS; attempt += 1) {
      const current = await this.getWithSignal(lab, config, executable, signal)
      if (current.state !== 'stopped' && current.state !== 'starting') return current
      await waitWithSignal(this.wait, VM_TRANSITION_POLL_MS, signal)
    }
    return this.result(
      lab,
      'starting',
      true,
      'VirtualBox accepted the start request but the virtual machine is not ready yet.'
    )
  }

  async openConsole(lab: RemoteSshLab) {
    this.assertOpen()
    const config = requireVirtualBoxConfig(lab)
    let current = await this.get(lab)
    if (current.state === 'stopped') {
      current = await this.ensure(lab)
    } else if (
      current.state === 'ready' ||
      current.state === 'login-required' ||
      current.state === 'starting'
    ) {
      if (this.visibleConsoles.get(lab.id) !== config.vmId) {
        throw new Error(
          'VirtualBox cannot attach a new GUI console to an already-running virtual machine. ' +
          'Stop the virtual machine, then open its console from SciForge.'
        )
      }
    }
    if (
      current.state !== 'ready' &&
      current.state !== 'login-required' &&
      current.state !== 'starting'
    ) {
      throw environmentStateError(current)
    }
    return {
      labId: lab.id,
      presentation: { kind: 'opened' as const }
    }
  }

  async stop(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    this.assertOpen()
    this.terminateTunnel(lab.id)
    this.visibleConsoles.delete(lab.id)
    const initial = await this.get(lab)
    if (initial.state === 'stopped' || initial.state === 'configuration-required') {
      return initial
    }
    if (initial.state === 'provider-unavailable' || initial.state === 'failed') {
      return initial
    }

    const config = requireVirtualBoxConfig(lab)
    const executable = await this.requireVirtualBoxExecutable()
    const stopped = await this.runner.run({
      executable,
      args: ['controlvm', config.vmId, 'acpipowerbutton'],
      timeoutMs: COMMAND_TIMEOUT_MS
    })
    if (stopped.exitCode !== 0 || stopped.timedOut) {
      throw commandError('request VirtualBox guest shutdown', stopped)
    }

    for (let attempt = 0; attempt < VM_TRANSITION_ATTEMPTS; attempt += 1) {
      const current = await this.get(lab)
      if (current.state === 'stopped') return current
      if (
        current.state === 'failed' ||
        current.state === 'configuration-required' ||
        current.state === 'provider-unavailable'
      ) {
        return current
      }
      await this.wait(VM_TRANSITION_POLL_MS)
    }
    return this.result(
      lab,
      'starting',
      true,
      'The guest shutdown request is still in progress.'
    )
  }

  async remove(lab: RemoteSshLab): Promise<void> {
    this.assertOpen()
    this.terminateTunnel(lab.id)
    this.visibleConsoles.delete(lab.id)
  }

  async proxyEndpoint(
    lab: RemoteSshLab,
    options: RemoteSshProxyEndpointOptions = {}
  ): Promise<RemoteSshProxyEndpoint> {
    this.assertOpen()
    throwIfAborted(options.signal)
    const config = requireVirtualBoxConfig(lab)
    const existing = this.tunnels.get(lab.id)
    if (
      existing &&
      existing.ready &&
      existing.vmId === config.vmId &&
      existing.gatewaySshAlias === config.gatewaySshAlias &&
      await this.isSocksProxyReady(existing.port, options.signal)
    ) {
      this.assertOpen()
      return loopbackEndpoint(existing.port)
    }
    if (existing) this.terminateTunnel(lab.id)

    const virtualBoxExecutable = await this.requireVirtualBoxExecutable()
    let status = await this.getWithSignal(
      lab,
      config,
      virtualBoxExecutable,
      options.signal
    )
    if (status.state === 'stopped' && options.startIfStopped) {
      status = await this.ensureWithSignal(lab, options.signal)
    }
    if (status.state !== 'ready' && status.state !== 'login-required') {
      throw environmentStateError(status)
    }

    const sshExecutable = await this.requireOpenSshExecutable()
    let lastFailure: unknown
    for (let launch = 0; launch < TUNNEL_LAUNCH_ATTEMPTS; launch += 1) {
      try {
        return await this.launchTunnel(
          lab,
          config,
          sshExecutable,
          options.signal
        )
      } catch (error) {
        lastFailure = error
        if (isAbortError(error) || this.closed) throw error
      }
    }
    throw lastFailure instanceof Error
      ? lastFailure
      : new Error('SSH SOCKS tunnel could not be started.')
  }

  private async launchTunnel(
    lab: RemoteSshLab,
    config: RemoteSshVmEnvironmentConfig,
    sshExecutable: string,
    signal?: AbortSignal
  ): Promise<RemoteSshProxyEndpoint> {
    throwIfAborted(signal)
    const port = await this.allocateLoopbackPort()
    assertValidTcpPort(port)
    this.assertOpen()
    const process = this.spawnTunnel(
      sshExecutable,
      [
        '-N',
        '-D', `127.0.0.1:${port}`,
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'BatchMode=yes',
        '-o', 'ControlMaster=no',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=2',
        config.gatewaySshAlias
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore']
      }
    )
    const tunnel: ActiveTunnel = {
      process,
      port,
      vmId: config.vmId,
      gatewaySshAlias: config.gatewaySshAlias,
      ready: false
    }
    process.once('error', (error) => {
      tunnel.startupFailure = error
      this.releaseTunnelProcess(lab.id, process)
    })
    process.once('exit', (exitCode, exitSignal) => {
      tunnel.startupFailure ??= new Error(
        `SSH SOCKS tunnel exited before becoming ready` +
        ` (exit=${String(exitCode)}, signal=${String(exitSignal)}).`
      )
      this.releaseTunnelProcess(lab.id, process)
    })
    this.tunnels.set(lab.id, tunnel)

    try {
      for (let attempt = 0; attempt < TUNNEL_START_ATTEMPTS; attempt += 1) {
        this.assertOpen()
        throwIfAborted(signal)
        this.assertTunnelRunning(tunnel)
        if (await this.isSocksProxyReady(port, signal)) {
          await waitWithSignal(this.wait, TUNNEL_STABILITY_MS, signal)
          this.assertOpen()
          this.assertTunnelRunning(tunnel)
          if (await this.isSocksProxyReady(port, signal)) {
            tunnel.ready = true
            return loopbackEndpoint(port)
          }
        }
        await waitWithSignal(this.wait, TUNNEL_START_POLL_MS, signal)
      }
      throw new Error('SSH SOCKS tunnel did not complete a SOCKS5 handshake within 5 seconds.')
    } catch (error) {
      this.terminateTunnel(lab.id, process)
      throw error
    }
  }

  private assertTunnelRunning(tunnel: ActiveTunnel): void {
    if (tunnel.startupFailure) throw tunnel.startupFailure
    if (tunnel.process.exitCode !== undefined && tunnel.process.exitCode !== null) {
      throw new Error(
        `SSH SOCKS tunnel exited before becoming ready (exit=${tunnel.process.exitCode}).`
      )
    }
  }

  private async inspectMachine(
    executable: string,
    vmId: string,
    signal?: AbortSignal
  ): Promise<
    | Readonly<{
        kind: 'machine'
        state: string
        uuid: string
        osType?: string
        architecture?: string
      }>
    | Readonly<{ kind: 'missing' }>
    | Readonly<{ kind: 'failed'; message: string }>
  > {
    let inspected: VmCommandResult
    try {
      inspected = await this.runner.run({
        executable,
        args: ['showvminfo', vmId, '--machinereadable'],
        timeoutMs: COMMAND_TIMEOUT_MS,
        signal
      })
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw abortError()
      inspected = {
        exitCode: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false
      }
    }
    throwIfAborted(signal)
    if (inspected.exitCode !== 0 || inspected.timedOut) {
      const message = commandOutput(inspected)
      if (/could not find a registered machine|not found|VBOX_E_OBJECT_NOT_FOUND/iu.test(message)) {
        return { kind: 'missing' }
      }
      return {
        kind: 'failed',
        message: message || 'VBoxManage could not inspect the virtual machine.'
      }
    }
    const state = parseMachineReadableValue(inspected.stdout, 'VMState')
    if (!state) {
      return {
        kind: 'failed',
        message: 'VBoxManage did not report a VMState value.'
      }
    }
    const rawUuid = parseMachineReadableValue(inspected.stdout, 'UUID')
    if (!rawUuid) {
      return {
        kind: 'failed',
        message: 'VBoxManage did not report a UUID value.'
      }
    }
    const uuid = canonicalVirtualBoxUuid(rawUuid)
    if (!uuid) {
      return {
        kind: 'failed',
        message: 'VBoxManage reported an invalid virtual machine UUID.'
      }
    }
    const osType = parseMachineReadableValue(inspected.stdout, 'ostype')
    const architecture = parseMachineReadableValue(
      inspected.stdout,
      'platformArchitecture'
    )
    return {
      kind: 'machine',
      state,
      uuid,
      ...(osType ? { osType } : {}),
      ...(architecture ? { architecture } : {})
    }
  }

  private async virtualBoxExecutable(): Promise<string | undefined> {
    if (this.configuredVirtualBoxExecutable) {
      return await this.isExecutable(this.configuredVirtualBoxExecutable)
        ? this.configuredVirtualBoxExecutable
        : undefined
    }
    for (const candidate of virtualBoxExecutableCandidates(this.platform, this.environment)) {
      if (await this.isExecutable(candidate)) return candidate
    }
    return undefined
  }

  private async requireVirtualBoxExecutable(): Promise<string> {
    const executable = await this.virtualBoxExecutable()
    if (!executable) {
      throw new Error('VirtualBox is not installed or VBoxManage is unavailable.')
    }
    return executable
  }

  private async requireOpenSshExecutable(): Promise<string> {
    const executable = this.configuredOpenSshExecutable ??
      systemOpenSshExecutable(this.platform, this.environment)
    if (!await this.isExecutable(executable)) {
      throw new Error(`Host OpenSSH executable is unavailable: ${executable}`)
    }
    return executable
  }

  private terminateTunnel(labId: string, expectedProcess?: VmTunnelProcess): void {
    const tunnel = this.tunnels.get(labId)
    if (!tunnel || (expectedProcess && tunnel.process !== expectedProcess)) return
    this.tunnels.delete(labId)
    this.terminatingTunnels.add(tunnel.process)
    tunnel.process.kill('SIGTERM')
    const forceKill = setTimeout(() => {
      if (!this.terminatingTunnels.has(tunnel.process)) return
      tunnel.process.kill('SIGKILL')
      this.terminatingTunnels.delete(tunnel.process)
    }, this.terminateGraceMs)
    forceKill.unref?.()
  }

  private releaseTunnelProcess(labId: string, process: VmTunnelProcess): void {
    const active = this.tunnels.get(labId)
    if (active?.process === process) this.tunnels.delete(labId)
    this.terminatingTunnels.delete(process)
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('VirtualBox Remote SSH lab environment provider is closed.')
    }
  }

  private result(
    lab: RemoteSshLab,
    state: RemoteSshLabEnvironmentResult['state'],
    consoleAvailable: boolean,
    message?: string
  ): RemoteSshLabEnvironmentResult {
    return {
      labId: lab.id,
      provider: 'vm',
      state,
      consoleAvailable,
      ...(message ? { message: message.slice(0, 2_000) } : {}),
      checkedAt: this.now().toISOString()
    }
  }
}

export class SystemVmCommandRunner implements VmCommandRunner {
  constructor(
    private readonly terminateGraceMs = PROCESS_TERMINATE_GRACE_MS
  ) {}

  async run(request: VmCommandRequest): Promise<VmCommandResult> {
    throwIfAborted(request.signal)
    return new Promise((resolve, reject) => {
      let settled = false
      let timedOut = false
      let forceKill: NodeJS.Timeout | undefined
      const child = spawn(request.executable, request.args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let capturedBytes = 0
      const capture = (bucket: Buffer[], chunk: Buffer | string): void => {
        if (capturedBytes >= MAX_OUTPUT_BYTES) return
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const bounded = bytes.subarray(0, MAX_OUTPUT_BYTES - capturedBytes)
        bucket.push(bounded)
        capturedBytes += bounded.length
      }
      child.stdout.on('data', (chunk: Buffer | string) => capture(stdout, chunk))
      child.stderr.on('data', (chunk: Buffer | string) => capture(stderr, chunk))

      const finishForcedTermination = (): void => {
        child.kill('SIGKILL')
        child.stdout.destroy()
        child.stderr.destroy()
        if (settled) return
        settled = true
        cleanup()
        if (request.signal?.aborted) {
          reject(abortError())
          return
        }
        resolve({
          exitCode: child.exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          timedOut
        })
      }
      const terminate = (): void => {
        child.kill('SIGTERM')
        if (forceKill) return
        forceKill = setTimeout(finishForcedTermination, this.terminateGraceMs)
        forceKill.unref?.()
      }
      const onAbort = (): void => {
        terminate()
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      const timeout = setTimeout(() => {
        timedOut = true
        terminate()
      }, request.timeoutMs ?? COMMAND_TIMEOUT_MS)
      timeout.unref?.()

      const cleanup = (): void => {
        clearTimeout(timeout)
        if (forceKill) clearTimeout(forceKill)
        request.signal?.removeEventListener('abort', onAbort)
      }
      child.once('error', (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
      child.once('close', (exitCode) => {
        if (settled) return
        settled = true
        cleanup()
        if (request.signal?.aborted) {
          reject(abortError())
          return
        }
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          timedOut
        })
      })
    })
  }
}

export function virtualBoxExecutableCandidates(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): readonly string[] {
  const fromPath = executableCandidatesFromPath(
    platform === 'win32' ? 'VBoxManage.exe' : 'VBoxManage',
    platform,
    environment
  )
  if (platform === 'darwin') {
    return [...new Set([
      '/Applications/VirtualBox.app/Contents/MacOS/VBoxManage',
      '/opt/homebrew/bin/VBoxManage',
      '/usr/local/bin/VBoxManage',
      ...fromPath
    ])]
  }
  if (platform === 'win32') {
    const installerCandidate = environment.VBOX_MSI_INSTALL_PATH
      ? win32.join(environment.VBOX_MSI_INSTALL_PATH, 'VBoxManage.exe')
      : undefined
    const standardCandidates = [
      environment.ProgramW6432,
      environment.ProgramFiles,
      'C:\\Program Files'
    ].filter((root): root is string => Boolean(root)).map((root) =>
      root.toLowerCase().endsWith('virtualbox')
        ? win32.join(root, 'VBoxManage.exe')
        : win32.join(root, 'Oracle', 'VirtualBox', 'VBoxManage.exe')
    )
    return [...new Set([
      ...(installerCandidate ? [installerCandidate] : []),
      ...standardCandidates,
      ...fromPath
    ])]
  }
  return [...new Set([
    '/usr/bin/VBoxManage',
    '/usr/local/bin/VBoxManage',
    ...fromPath
  ])]
}

export function systemOpenSshExecutable(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): string {
  if (platform === 'win32') {
    return win32.join(
      environment.SystemRoot ?? environment.WINDIR ?? 'C:\\Windows',
      'System32',
      'OpenSSH',
      'ssh.exe'
    )
  }
  return '/usr/bin/ssh'
}

export function parseMachineReadableValue(
  output: string,
  key: string
): string | undefined {
  const prefix = `${key}=`
  const line = output.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix))
  if (!line) return undefined
  const raw = line.slice(prefix.length)
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, '\\')
  }
  return raw
}

export function parseVirtualBoxMachineList(
  output: string
): readonly Readonly<{ name: string; uuid: string }>[] {
  return output.split(/\r?\n/u).flatMap((line) => {
    const match = /^"((?:[^"\\]|\\.)*)"\s+\{([^{}]+)\}\s*$/u.exec(line.trim())
    if (!match) return []
    const uuid = canonicalVirtualBoxUuid(match[2] ?? '')
    if (!uuid) return []
    const name = (match[1] ?? '')
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, '\\')
      .trim()
    if (!name || /[\0\r\n]/u.test(name)) return []
    return [{ name, uuid }]
  })
}

function requireVirtualBoxConfig(lab: RemoteSshLab): RemoteSshVmEnvironmentConfig {
  if (lab.environment.provider !== 'vm') {
    throw new Error(
      `VirtualBox provider cannot manage ${lab.environment.provider} environment for lab ${lab.id}.`
    )
  }
  if (lab.environment.driver !== 'virtualbox') {
    throw new Error(
      `Unsupported VM driver for Remote SSH lab ${lab.id}: ${lab.environment.driver}`
    )
  }
  return lab.environment
}

function requireVirtualBoxLocatorConfig(
  environment: RemoteSshLabEnvironmentLocatorConfig
): RemoteSshVmEnvironmentLocatorConfig {
  if (environment.provider !== 'vm') {
    throw new Error(
      `VirtualBox provider cannot canonicalize ${environment.provider} environment.`
    )
  }
  if (environment.driver !== 'virtualbox') {
    throw new Error(`Unsupported VM driver: ${environment.driver}`)
  }
  return environment
}

export function canonicalVirtualBoxUuid(value: string): string | undefined {
  const trimmed = value.trim()
  const unwrapped = trimmed.startsWith('{') && trimmed.endsWith('}')
    ? trimmed.slice(1, -1)
    : trimmed
  const parsed = remoteSshVirtualBoxUuidSchema.safeParse(unwrapped)
  return parsed.success ? parsed.data : undefined
}

function normalizeVirtualBoxState(
  state: string
): 'stopped' | 'starting' | 'running' | 'paused' | 'stopping' | 'failed' {
  switch (state.toLowerCase()) {
    case 'running':
      return 'running'
    case 'poweroff':
    case 'saved':
      return 'stopped'
    case 'paused':
      return 'paused'
    case 'starting':
    case 'restoring':
      return 'starting'
    case 'stopping':
    case 'saving':
      return 'stopping'
    default:
      return 'failed'
  }
}

function environmentStateError(result: RemoteSshLabEnvironmentResult): Error {
  return new Error(
    result.message ??
    `Remote SSH lab environment ${result.labId} is ${result.state}.`
  )
}

function commandError(action: string, result: VmCommandResult): Error {
  const detail = commandOutput(result)
  return new Error(`Failed to ${action}${detail ? `: ${detail}` : '.'}`)
}

function commandOutput(result: VmCommandResult): string {
  return (result.stderr.trim() || result.stdout.trim()).slice(0, 2_000)
}

function loopbackEndpoint(port: number): RemoteSshProxyEndpoint {
  assertValidTcpPort(port)
  return { host: '127.0.0.1', port }
}

function assertValidTcpPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid loopback TCP port: ${String(port)}`)
  }
}

async function executableExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a loopback TCP port.'))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

async function socks5ProxyReady(
  port: number,
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) throw abortError()
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.unref()
    let settled = false
    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve(ready)
    }
    const onAbort = (): void => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]))
    })
    let response = Buffer.alloc(0)
    socket.on('data', (data) => {
      response = Buffer.concat([response, data])
      if (response.length >= 2) {
        finish(response[0] === 0x05 && response[1] === 0x00)
      }
    })
    socket.once('error', () => finish(false))
  })
}

function executableCandidatesFromPath(
  executable: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): readonly string[] {
  const pathValue = environment.PATH ?? environment.Path ?? environment.path
  if (!pathValue) return []
  const pathApi = platform === 'win32' ? win32 : posix
  const separator = platform === 'win32' ? ';' : ':'
  return pathValue
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) =>
      entry.length > 0 &&
      (platform === 'win32' ? win32.isAbsolute(entry) : isAbsolute(entry))
    )
    .map((entry) => pathApi.join(entry, executable))
}

async function waitWithSignal(
  wait: (milliseconds: number) => Promise<void>,
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  if (!signal) {
    await wait(milliseconds)
    return
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = (): void => finish(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    void wait(milliseconds).then(
      () => finish(),
      (error: unknown) => finish(error instanceof Error ? error : new Error(String(error)))
    )
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(): Error {
  const error = new Error('The operation was cancelled.')
  error.name = 'AbortError'
  return error
}
