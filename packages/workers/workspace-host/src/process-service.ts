import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export const WORKSPACE_PROCESS_LIMITS = Object.freeze({
  maxArgvItems: 256,
  maxArgumentCharacters: 16_384,
  maxEnvironmentEntries: 256,
  maxEnvironmentValueCharacters: 16_384,
  maxWriteCharacters: 100_000,
  maxReadCharacters: 1_000_000,
  maxReadWaitMilliseconds: 30_000,
  maxBufferedCharacters: 4_000_000,
  maxProcesses: 64
} as const)

export type WorkspaceProcessCreateInput = Readonly<{
  argv: readonly string[]
  cwd?: string
  env?: Readonly<Record<string, string>>
  terminal?: Readonly<{ columns: number; rows: number }>
}>

export type WorkspaceProcessCreateOutput = Readonly<{
  processId: string
  cursor: string
}>

export type WorkspaceProcessReadOutput = Readonly<{
  cursor: string
  chunks: readonly Readonly<{
    stream: 'stdout' | 'stderr'
    data: string
  }>[]
  truncated: boolean
  exit?: Readonly<{
    code: number | null
    signal: string | null
  }>
}>

type OutputChunk = {
  start: number
  end: number
  stream: 'stdout' | 'stderr'
  data: string
}

type ProcessRecord = {
  child: ChildProcessWithoutNullStreams
  chunks: OutputChunk[]
  baseCursor: number
  nextCursor: number
  exit?: {
    code: number | null
    signal: string | null
  }
  readers: Set<() => void>
}

const PROXY_ENVIRONMENT_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy'
] as const

export type WorkspaceProcessServiceOptions = Readonly<{
  resolveCwd: (path: string | undefined) => Promise<string>
  baseEnvironment?: NodeJS.ProcessEnv
  maxProcesses?: number
  spawnProcess?: typeof spawn
}>

/**
 * Owns subprocess leases for one Workspace Host session.
 *
 * The API accepts argv arrays only and always uses `shell: false`. The remote
 * transport therefore cannot turn an untrusted string into a shell program.
 */
export class WorkspaceProcessService {
  readonly #resolveCwd: WorkspaceProcessServiceOptions['resolveCwd']
  readonly #baseEnvironment: NodeJS.ProcessEnv
  readonly #maxProcesses: number
  readonly #spawnProcess: typeof spawn
  readonly #records = new Map<string, ProcessRecord>()
  #proxyEnvironment: NodeJS.ProcessEnv = {}
  #proxyExpiresAtMs?: number

  constructor(options: WorkspaceProcessServiceOptions) {
    this.#resolveCwd = options.resolveCwd
    this.#baseEnvironment = { ...(options.baseEnvironment ?? process.env) }
    for (const key of PROXY_ENVIRONMENT_KEYS) delete this.#baseEnvironment[key]
    this.#maxProcesses = options.maxProcesses ?? WORKSPACE_PROCESS_LIMITS.maxProcesses
    this.#spawnProcess = options.spawnProcess ?? spawn
  }

  async create(input: WorkspaceProcessCreateInput): Promise<WorkspaceProcessCreateOutput> {
    assertArgv(input.argv)
    assertEnvironment(input.env)
    if (this.#records.size >= this.#maxProcesses) {
      throw processError('process_limit', 'The Workspace Host process limit has been reached.')
    }
    const cwd = await this.#resolveCwd(input.cwd)
    const [executable, ...args] = input.argv
    const child = this.#spawnProcess(executable!, args, {
      cwd,
      env: {
        ...this.currentEnvironment(),
        ...input.env,
        ...(input.terminal
          ? {
              COLUMNS: String(input.terminal.columns),
              LINES: String(input.terminal.rows)
            }
          : {})
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }) as ChildProcessWithoutNullStreams
    const processId = randomUUID()
    const record: ProcessRecord = {
      child,
      chunks: [],
      baseCursor: 0,
      nextCursor: 0,
      readers: new Set()
    }
    this.#records.set(processId, record)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => this.#append(record, 'stdout', data))
    child.stderr.on('data', (data: string) => this.#append(record, 'stderr', data))
    child.once('error', (error) => {
      this.#append(record, 'stderr', `${error.message}\n`)
      record.exit ??= { code: null, signal: 'SPAWN_ERROR' }
      this.#wakeReaders(record)
    })
    child.once('exit', (code, signal) => {
      record.exit = { code, signal }
      this.#wakeReaders(record)
    })
    return { processId, cursor: '0' }
  }

  async read(
    processId: string,
    input: {
      cursor: string
      maxCharacters?: number
      waitMilliseconds?: number
    }
  ): Promise<WorkspaceProcessReadOutput> {
    const record = this.#record(processId)
    const requestedCursor = parseCursor(input.cursor)
    const maxCharacters = boundedInteger(
      input.maxCharacters ?? 64_000,
      1,
      WORKSPACE_PROCESS_LIMITS.maxReadCharacters,
      'maxCharacters'
    )
    const waitMilliseconds = boundedInteger(
      input.waitMilliseconds ?? 0,
      0,
      WORKSPACE_PROCESS_LIMITS.maxReadWaitMilliseconds,
      'waitMilliseconds'
    )
    if (requestedCursor >= record.nextCursor && !record.exit && waitMilliseconds > 0) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer)
          record.readers.delete(finish)
          resolve()
        }
        const timer = setTimeout(finish, waitMilliseconds)
        record.readers.add(finish)
      })
    }
    const startCursor = Math.max(requestedCursor, record.baseCursor)
    let remaining = maxCharacters
    let nextCursor = startCursor
    const chunks: Array<{ stream: 'stdout' | 'stderr'; data: string }> = []
    let outputTruncated = requestedCursor < record.baseCursor
    for (const chunk of record.chunks) {
      if (chunk.end <= startCursor) continue
      const offset = Math.max(0, startCursor - chunk.start)
      const data = chunk.data.slice(offset, offset + remaining)
      if (!data) continue
      chunks.push({ stream: chunk.stream, data })
      remaining -= data.length
      nextCursor = Math.max(nextCursor, chunk.start + offset + data.length)
      if (remaining === 0) {
        outputTruncated ||= nextCursor < record.nextCursor
        break
      }
    }
    return {
      cursor: String(nextCursor),
      chunks,
      truncated: outputTruncated,
      ...(record.exit && nextCursor >= record.nextCursor ? { exit: { ...record.exit } } : {})
    }
  }

  async write(processId: string, data: string): Promise<{ acceptedCharacters: number }> {
    const record = this.#record(processId)
    if (!data || data.length > WORKSPACE_PROCESS_LIMITS.maxWriteCharacters) {
      throw processError(
        'invalid_process_input',
        `Process input must contain 1 to ${WORKSPACE_PROCESS_LIMITS.maxWriteCharacters} characters.`
      )
    }
    if (record.exit || record.child.stdin.destroyed) {
      throw processError('process_exited', 'The process no longer accepts input.')
    }
    await new Promise<void>((resolve, reject) => {
      record.child.stdin.write(data, 'utf8', (error) => error ? reject(error) : resolve())
    })
    return { acceptedCharacters: data.length }
  }

  resize(
    processId: string,
    columns: number,
    rows: number
  ): { supported: false; behavior: 'sigwinch-notification' | 'unsupported' } {
    const record = this.#record(processId)
    boundedInteger(columns, 1, 1_000, 'columns')
    boundedInteger(rows, 1, 1_000, 'rows')
    // Plain controlled processes do not expose a PTY resize primitive. SIGWINCH
    // is the portable Unix notification for programs that elect to handle it.
    if (!record.exit && process.platform !== 'win32') {
      record.child.kill('SIGWINCH')
      return { supported: false, behavior: 'sigwinch-notification' }
    }
    return { supported: false, behavior: 'unsupported' }
  }

  dispose(processId: string): { ok: true } {
    const record = this.#record(processId)
    this.#records.delete(processId)
    for (const reader of record.readers) reader()
    if (!record.exit) {
      record.child.kill('SIGTERM')
      const timer = setTimeout(() => {
        if (!record.exit) record.child.kill('SIGKILL')
      }, 2_000)
      timer.unref()
    }
    record.child.stdin.destroy()
    return { ok: true }
  }

  disposeAll(): void {
    for (const processId of [...this.#records.keys()]) {
      this.dispose(processId)
    }
  }

  configureProxyEnvironment(
    environment: NodeJS.ProcessEnv | undefined,
    expiresAt?: string
  ): void {
    const selected: NodeJS.ProcessEnv = {}
    for (const key of PROXY_ENVIRONMENT_KEYS) {
      const value = environment?.[key]
      if (value) selected[key] = value
    }
    this.#proxyEnvironment = selected
    this.#proxyExpiresAtMs = expiresAt ? Date.parse(expiresAt) : undefined
  }

  renewProxyEnvironment(expiresAt: string): boolean {
    const expiresAtMs = Date.parse(expiresAt)
    if (
      !Number.isFinite(expiresAtMs)
      || expiresAtMs <= Date.now()
      || !PROXY_ENVIRONMENT_KEYS.some((key) => Boolean(this.#proxyEnvironment[key]))
    ) {
      return false
    }
    this.#proxyExpiresAtMs = expiresAtMs
    return true
  }

  currentEnvironment(): NodeJS.ProcessEnv {
    return {
      ...this.#baseEnvironment,
      ...(this.isNetworkEgressReady() ? this.#proxyEnvironment : {})
    }
  }

  isNetworkEgressReady(): boolean {
    const proxyAvailable = this.#proxyExpiresAtMs === undefined
      || this.#proxyExpiresAtMs > Date.now()
    return proxyAvailable && PROXY_ENVIRONMENT_KEYS.some(
      (key) => Boolean(this.#proxyEnvironment[key])
    )
  }

  #append(record: ProcessRecord, stream: 'stdout' | 'stderr', data: string): void {
    if (!data) return
    const chunk = {
      start: record.nextCursor,
      end: record.nextCursor + data.length,
      stream,
      data
    }
    record.nextCursor = chunk.end
    record.chunks.push(chunk)
    while (
      record.chunks.length > 0
      && record.nextCursor - record.chunks[0]!.start > WORKSPACE_PROCESS_LIMITS.maxBufferedCharacters
    ) {
      const removed = record.chunks.shift()!
      record.baseCursor = removed.end
    }
    this.#wakeReaders(record)
  }

  #wakeReaders(record: ProcessRecord): void {
    for (const reader of [...record.readers]) reader()
  }

  #record(processId: string): ProcessRecord {
    const record = this.#records.get(processId)
    if (!record) {
      throw processError('process_not_found', 'The controlled process lease does not exist.')
    }
    return record
  }
}

export class WorkspaceProcessError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WorkspaceProcessError'
    this.code = code
  }
}

function processError(code: string, message: string): WorkspaceProcessError {
  return new WorkspaceProcessError(code, message)
}

function assertArgv(argv: readonly string[]): void {
  if (
    !Array.isArray(argv)
    || argv.length < 1
    || argv.length > WORKSPACE_PROCESS_LIMITS.maxArgvItems
    || argv.some(
      (item) =>
        typeof item !== 'string'
        || item.includes('\0')
        || item.length > WORKSPACE_PROCESS_LIMITS.maxArgumentCharacters
    )
    || !argv[0]
  ) {
    throw processError(
      'invalid_process_input',
      `argv must contain 1 to ${WORKSPACE_PROCESS_LIMITS.maxArgvItems} bounded strings.`
    )
  }
}

function assertEnvironment(env: Readonly<Record<string, string>> | undefined): void {
  if (!env) return
  const entries = Object.entries(env)
  if (
    entries.length > WORKSPACE_PROCESS_LIMITS.maxEnvironmentEntries
    || entries.some(([key, value]) =>
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      || typeof value !== 'string'
      || value.includes('\0')
      || value.length > WORKSPACE_PROCESS_LIMITS.maxEnvironmentValueCharacters
    )
  ) {
    throw processError('invalid_process_input', 'Process environment is invalid or exceeds its bounds.')
  }
}

function parseCursor(cursor: string): number {
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw processError('invalid_process_cursor', 'Process cursor must be a non-negative integer string.')
  }
  const parsed = Number(cursor)
  if (!Number.isSafeInteger(parsed)) {
    throw processError('invalid_process_cursor', 'Process cursor is outside the supported range.')
  }
  return parsed
}

function boundedInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw processError('invalid_process_input', `${name} must be an integer between ${min} and ${max}.`)
  }
  return value
}
