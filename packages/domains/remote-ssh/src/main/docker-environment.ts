import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { remoteSshDockerEnvironmentConfigSchema } from '../contract.js'
import type {
  RemoteSshDockerEnvironmentConfig,
  RemoteSshLab,
  RemoteSshLabEnvironmentLocatorConfig,
  RemoteSshLabEnvironmentOpenConsoleResult,
  RemoteSshLabEnvironmentResult
} from '../contract.js'
import type {
  RemoteSshLabEnvironmentProvider,
  RemoteSshProxyEndpointOptions
} from './lab-environment.js'

const COMMAND_TIMEOUT_MS = 30_000
const IMAGE_PULL_TIMEOUT_MS = 10 * 60_000
const ENGINE_START_TIMEOUT_MS = 45_000
const MAX_OUTPUT_BYTES = 256 * 1_024

type DockerContainerIdentity =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'owned'; containerId: string; image: string }>
  | Readonly<{ status: 'foreign'; message: string }>

export type DockerCommandResult = Readonly<{
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}>

export type DockerCommandRequest = Readonly<{
  executable: string
  args: readonly string[]
  timeoutMs?: number
}>

export interface DockerCommandRunner {
  run(request: DockerCommandRequest): Promise<DockerCommandResult>
  launch(executable: string, args: readonly string[]): Promise<void>
}

export type DockerLabEnvironmentProviderOptions = Readonly<{
  runner?: DockerCommandRunner
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  now?: () => Date
  wait?: (milliseconds: number) => Promise<void>
}>

export class DockerLabEnvironmentProvider implements RemoteSshLabEnvironmentProvider {
  readonly provider = 'docker' as const
  private readonly runner: DockerCommandRunner
  private readonly platform: NodeJS.Platform
  private readonly environment: NodeJS.ProcessEnv
  private readonly now: () => Date
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly dockerExecutable: string

  constructor(options: DockerLabEnvironmentProviderOptions = {}) {
    this.runner = options.runner ?? new SystemDockerCommandRunner()
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
    this.now = options.now ?? (() => new Date())
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.dockerExecutable = resolveDockerExecutable(this.platform, this.environment)
  }

  async canonicalize(
    environment: RemoteSshLabEnvironmentLocatorConfig
  ): Promise<RemoteSshDockerEnvironmentConfig> {
    if (environment.provider !== this.provider) {
      throw new Error('Docker environment provider cannot canonicalize a non-Docker environment.')
    }
    return remoteSshDockerEnvironmentConfigSchema.parse(environment)
  }

  async get(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    const configuration = requireDockerEnvironment(lab)
    const engine = await this.docker(['info', '--format', '{{.ServerVersion}}'])
      .catch((error) => missingCommandResult(error))
    if (engine.exitCode !== 0) {
      return this.result(lab, 'provider-unavailable', {
        message: dockerUnavailableMessage(engine.stderr)
      })
    }

    const name = environmentName(lab.id)
    const identity = await this.inspectContainerIdentity(lab, name)
    if (identity.status === 'missing') return this.result(lab, 'configuration-required')
    if (identity.status === 'foreign') {
      return this.result(lab, 'failed', {
        message: identity.message
      })
    }
    if (identity.image !== configuration.image) {
      return this.result(lab, 'configuration-required')
    }

    const inspect = await this.docker([
      'inspect', '--format', '{{json .State}}', name
    ])
    if (inspect.exitCode !== 0) return this.result(lab, 'configuration-required')

    const state = parseContainerState(inspect.stdout)
    if (!state.running) {
      const stopped = state.status === 'created' || state.status === 'exited'
      return this.result(lab, stopped ? 'stopped' : 'failed', {
        message: state.error || undefined
      })
    }

    return this.result(lab, 'login-required', {
      consoleAvailable: (await this.loginUrl(name)) !== undefined
    })
  }

  async ensure(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    const configuration = requireDockerEnvironment(lab)
    await this.ensureEngine()
    const name = environmentName(lab.id)
    const identity = await this.inspectContainerIdentity(lab, name)

    if (identity.status === 'foreign') throw new Error(identity.message)
    if (identity.status === 'owned') {
      if (identity.image !== configuration.image) {
        await this.requireDocker(
          ['rm', '--force', identity.containerId],
          'replace the previous VPN container'
        )
        await this.create(lab, configuration, name)
      }
    } else {
      await this.create(lab, configuration, name)
    }

    const started = await this.docker(['start', name])
    if (started.exitCode !== 0 && !/already running/i.test(started.stderr)) {
      throw dockerError('start the VPN container', started)
    }
    return this.get(lab)
  }

  async openConsole(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentOpenConsoleResult> {
    requireDockerEnvironment(lab)
    const status = await this.get(lab)
    if (status.state !== 'login-required' && status.state !== 'ready') {
      throw new Error(`Docker VPN environment console is not available: ${status.state}`)
    }
    const url = await this.loginUrl(environmentName(lab.id))
    if (!url) {
      throw new Error('Docker did not return a loopback console endpoint for the VPN container.')
    }
    return {
      labId: lab.id,
      presentation: {
        kind: 'external-url',
        url
      }
    }
  }

  async stop(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    requireDockerEnvironment(lab)
    const name = environmentName(lab.id)
    const identity = await this.inspectContainerIdentity(lab, name)
    if (identity.status === 'foreign') throw new Error(identity.message)
    if (identity.status === 'missing') {
      return this.result(lab, 'configuration-required')
    }
    const stopped = await this.docker(['stop', '--time', '10', identity.containerId])
    if (stopped.exitCode !== 0 && !/No such container/i.test(stopped.stderr)) {
      throw dockerError('stop the VPN container', stopped)
    }
    return this.get(lab)
  }

  async remove(lab: RemoteSshLab): Promise<void> {
    requireDockerEnvironment(lab)
    const name = environmentName(lab.id)
    const identity = await this.inspectContainerIdentity(lab, name)
    if (identity.status === 'foreign') throw new Error(identity.message)
    if (identity.status === 'missing') return
    const removed = await this.docker(['rm', '--force', identity.containerId])
    if (removed.exitCode !== 0 && !/No such container/i.test(removed.stderr)) {
      throw dockerError('remove the VPN container', removed)
    }
  }

  async proxyEndpoint(
    lab: RemoteSshLab,
    options: RemoteSshProxyEndpointOptions = {}
  ): Promise<Readonly<{
    host: '127.0.0.1'
    port: number
  }>> {
    requireDockerEnvironment(lab)
    options.signal?.throwIfAborted()
    if (options.startIfStopped) {
      await this.ensure(lab)
    } else {
      const status = await this.get(lab)
      if (status.state !== 'login-required' && status.state !== 'ready') {
        throw new Error(`Docker VPN environment is not running: ${status.state}`)
      }
    }
    options.signal?.throwIfAborted()
    const result = await this.docker([
      'port', environmentName(lab.id), '1080/tcp'
    ])
    options.signal?.throwIfAborted()
    if (result.exitCode !== 0) throw dockerError('resolve the VPN SOCKS5 endpoint', result)
    const port = parseLoopbackPort(result.stdout)
    if (port === undefined) {
      throw new Error('Docker did not return a loopback SOCKS5 endpoint for the VPN container.')
    }
    return { host: '127.0.0.1', port }
  }

  close(): void {
    // Docker owns container persistence independently of the SciForge process.
  }

  private async create(
    lab: RemoteSshLab,
    configuration: RemoteSshDockerEnvironmentConfig,
    name: string
  ): Promise<void> {
    await this.requireDocker(
      ['pull', configuration.image],
      'pull the selected VPN image',
      IMAGE_PULL_TIMEOUT_MS
    )
    const password = randomBytes(6).toString('base64url').slice(0, 8)
    await this.requireDocker([
      'create',
      '--name', name,
      '--label', 'com.sciforge.domain=remote-ssh',
      '--label', `com.sciforge.lab-id=${lab.id}`,
      '--restart', 'unless-stopped',
      '--device', '/dev/net/tun',
      '--cap-add', 'NET_ADMIN',
      '--sysctl', 'net.ipv4.conf.default.route_localnet=1',
      '--env', 'URLWIN=1',
      '--env', 'USE_NOVNC=1',
      '--env', `PASSWORD=${password}`,
      '--volume', `${environmentVolumeName(lab.id)}:/root`,
      '--publish', '127.0.0.1::8080',
      '--publish', '127.0.0.1::1080',
      '--publish', '127.0.0.1::8888',
      '--publish', '127.0.0.1::54631',
      configuration.image
    ], 'create the VPN container')
  }

  private async inspectContainerIdentity(
    lab: RemoteSshLab,
    name: string
  ): Promise<DockerContainerIdentity> {
    const inspected = await this.docker([
      'inspect',
      '--format',
      '{{.Id}}|{{index .Config.Labels "com.sciforge.domain"}}|{{index .Config.Labels "com.sciforge.lab-id"}}|{{.Config.Image}}',
      name
    ])
    if (inspected.exitCode !== 0) {
      if (isMissingContainer(inspected)) return { status: 'missing' }
      throw dockerError('inspect the VPN container ownership', inspected)
    }
    const [containerId, domainOwner, labOwner, image] = inspected.stdout.trim().split('|', 4)
    if (
      !containerId ||
      !/^[a-f0-9]{12,64}$/u.test(containerId) ||
      domainOwner !== 'remote-ssh' ||
      labOwner !== lab.id
    ) {
      return {
        status: 'foreign',
        message: `Docker container ownership does not match Remote SSH lab ${lab.id}: ${name}`
      }
    }
    return { status: 'owned', containerId, image: image ?? '' }
  }

  private async ensureEngine(): Promise<void> {
    const initial = await this.docker(['info', '--format', '{{.ServerVersion}}'])
      .catch((error) => missingCommandResult(error))
    if (initial.exitCode === 0) return
    if (/ENOENT|not found|cannot find/i.test(initial.stderr)) {
      throw new Error('Docker is not installed. Install Docker Desktop or Docker Engine, then try again.')
    }

    await this.launchDockerEngine()
    const deadline = Date.now() + ENGINE_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      await this.wait(1_000)
      const result = await this.docker(['info', '--format', '{{.ServerVersion}}'])
        .catch((error) => missingCommandResult(error))
      if (result.exitCode === 0) return
    }
    throw new Error('Docker was started but did not become ready within 45 seconds.')
  }

  private async launchDockerEngine(): Promise<void> {
    if (this.platform === 'darwin') {
      await this.runner.launch('/usr/bin/open', ['-a', 'Docker'])
      return
    }
    if (this.platform === 'win32') {
      const executable = join(
        this.environment.ProgramFiles ?? 'C:\\Program Files',
        'Docker', 'Docker', 'Docker Desktop.exe'
      )
      await this.runner.launch(executable, [])
      return
    }
    const started = await this.runner.run({
      executable: resolveSystemctlExecutable(),
      args: ['--user', 'start', 'docker'],
      timeoutMs: COMMAND_TIMEOUT_MS
    })
    if (started.exitCode !== 0) {
      throw new Error('Docker is not running. Start the Docker service, then try again.')
    }
  }

  private async loginUrl(name: string): Promise<string | undefined> {
    const [port, environment] = await Promise.all([
      this.docker(['port', name, '8080/tcp']),
      this.docker(['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', name])
    ])
    if (port.exitCode !== 0 || environment.exitCode !== 0) return undefined
    const match = port.stdout.match(/127\.0\.0\.1:(\d+)/)
    const password = environment.stdout
      .split(/\r?\n/u)
      .find((entry) => entry.startsWith('PASSWORD='))
      ?.slice('PASSWORD='.length)
    if (!match?.[1] || !password) return undefined
    const url = new URL(`http://127.0.0.1:${match[1]}/vnc.html`)
    url.searchParams.set('autoconnect', 'true')
    url.searchParams.set('resize', 'scale')
    url.searchParams.set('password', password)
    return url.toString()
  }

  private result(
    lab: RemoteSshLab,
    state: RemoteSshLabEnvironmentResult['state'],
    details: Readonly<{ consoleAvailable?: boolean; message?: string }> = {}
  ): RemoteSshLabEnvironmentResult {
    return {
      labId: lab.id,
      provider: this.provider,
      state,
      consoleAvailable: details.consoleAvailable ?? false,
      ...(details.message ? { message: details.message } : {}),
      checkedAt: this.now().toISOString()
    }
  }

  private docker(args: readonly string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<DockerCommandResult> {
    return this.runner.run({ executable: this.dockerExecutable, args, timeoutMs })
  }

  private async requireDocker(
    args: readonly string[],
    action: string,
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<void> {
    const result = await this.docker(args, timeoutMs)
    if (result.exitCode !== 0 || result.timedOut) throw dockerError(action, result)
  }
}

export class SystemDockerCommandRunner implements DockerCommandRunner {
  run(request: DockerCommandRequest): Promise<DockerCommandResult> {
    return new Promise((resolve, reject) => {
      let settled = false
      let timedOut = false
      const child = spawn(request.executable, request.args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let captured = 0
      const capture = (bucket: Buffer[], chunk: Buffer | string): void => {
        if (captured >= MAX_OUTPUT_BYTES) return
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const bounded = bytes.subarray(0, MAX_OUTPUT_BYTES - captured)
        bucket.push(bounded)
        captured += bounded.length
      }
      child.stdout.on('data', (chunk: Buffer | string) => capture(stdout, chunk))
      child.stderr.on('data', (chunk: Buffer | string) => capture(stderr, chunk))
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, request.timeoutMs ?? COMMAND_TIMEOUT_MS)
      timeout.unref?.()
      child.once('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (exitCode) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          timedOut
        })
      })
    })
  }

  launch(executable: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        detached: true,
        shell: false,
        windowsHide: true,
        stdio: 'ignore'
      })
      child.once('error', reject)
      child.once('spawn', () => {
        child.removeListener('error', reject)
        child.unref()
        resolve()
      })
    })
  }
}

function environmentName(labId: string): string {
  return `sciforge-atrust-${stableLabSuffix(labId)}`
}

function environmentVolumeName(labId: string): string {
  return `sciforge-atrust-data-${stableLabSuffix(labId)}`
}

function requireDockerEnvironment(lab: RemoteSshLab): RemoteSshDockerEnvironmentConfig {
  if (lab.environment.provider !== 'docker') {
    throw new Error(`Remote SSH lab ${lab.id} does not use the Docker environment provider.`)
  }
  return lab.environment
}

function stableLabSuffix(labId: string): string {
  return createHash('sha256').update(labId).digest('hex').slice(0, 20)
}

function parseContainerState(output: string): Readonly<{
  running: boolean
  status: string
  error: string
}> {
  try {
    const state = JSON.parse(output) as { Running?: unknown; Status?: unknown; Error?: unknown }
    return {
      running: state.Running === true,
      status: typeof state.Status === 'string' ? state.Status : '',
      error: typeof state.Error === 'string' ? state.Error.trim() : ''
    }
  } catch {
    return { running: false, status: '', error: 'Docker returned an invalid container state.' }
  }
}

function parseLoopbackPort(output: string): number | undefined {
  const match = output.match(/(?:^|\r?\n)127\.0\.0\.1:(\d+)(?:\r?\n|$)/u)
  if (!match?.[1]) return undefined
  const port = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : undefined
}

function isMissingContainer(result: DockerCommandResult): boolean {
  return /\bNo such (?:object|container)\b/iu.test(result.stderr || result.stdout)
}

function dockerError(action: string, result: DockerCommandResult): Error {
  const detail = boundedDiagnostic(result.stderr || result.stdout)
  return new Error(`Could not ${action}.${detail ? ` ${detail}` : ''}`)
}

function dockerUnavailableMessage(stderr: string): string {
  const detail = boundedDiagnostic(stderr)
  return detail || 'Docker is not installed or the Docker engine is not running.'
}

function boundedDiagnostic(value: string): string {
  return value.replace(/[\0\r\n]+/gu, ' ').trim().slice(0, 500)
}

function missingCommandResult(error: unknown): DockerCommandResult {
  return {
    exitCode: null,
    stdout: '',
    stderr: error instanceof Error ? `${error.name}: ${error.message}` : 'Docker command failed.',
    timedOut: false
  }
}

function resolveDockerExecutable(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string {
  const candidates = platform === 'win32'
    ? [
        join(environment.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
        'docker.exe'
      ]
    : platform === 'darwin'
      ? [
          '/Applications/Docker.app/Contents/Resources/bin/docker',
          '/opt/homebrew/bin/docker',
          '/usr/local/bin/docker',
          '/usr/bin/docker',
          'docker'
        ]
      : ['/usr/bin/docker', '/usr/local/bin/docker', 'docker']
  return candidates.find(isExecutableFile) ?? candidates[candidates.length - 1]!
}

function resolveSystemctlExecutable(): string {
  return isExecutableFile('/usr/bin/systemctl') ? '/usr/bin/systemctl' : 'systemctl'
}

function isExecutableFile(path: string): boolean {
  if (!path.includes('/') && !path.includes('\\')) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
