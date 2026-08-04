import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { IPty } from 'node-pty'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'

export const CONTROLLED_PROCESS_MAX_SESSIONS = 8
export const CONTROLLED_PROCESS_RING_BUFFER_CHARACTERS = 64 * 1024
export const CONTROLLED_PROCESS_DEFAULT_COLUMNS = 80
export const CONTROLLED_PROCESS_DEFAULT_ROWS = 24

const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'LOCALAPPDATA'
] as const)

type ControlledPty = Pick<IPty, 'kill' | 'resize' | 'write' | 'onData' | 'onExit'>

type ControlledProcessSession = {
  pty: ControlledPty
  ownerId: string
  resourceId: string
  ringBuffer: string
  startCursor: number
  endCursor: number
  exited: boolean
  exitCode: number | null
  exitSignal: string | null
  waiters: Set<() => void>
}

export type ControlledProcessCreateInput = Readonly<{
  ownerId: string
  workspaceRoot: string
  cwd?: string
  columns?: number
  rows?: number
  workspaceLocator?: WorkspaceLocator
}>

export type ControlledProcessCreateResult = Readonly<{
  resourceId: string
  cursor: string
}>

export type ControlledProcessReadInput = Readonly<{
  ownerId: string
  resourceId: string
  cursor: string
  maxCharacters: number
  waitMilliseconds: number
  signal?: AbortSignal
}>

export type ControlledProcessReadResult = Readonly<{
  cursor: string
  chunks: Array<{ stream: 'stdout'; data: string }>
  truncated: boolean
  exit?: Readonly<{ code: number | null; signal: string | null }>
}>

export type ControlledProcessServiceOptions = Readonly<{
  environment?: NodeJS.ProcessEnv
  maxSessions?: number
  platform?: NodeJS.Platform
  spawnPty?: (
    file: string,
    args: string[],
    options: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: Record<string, string>
      useConpty: boolean
    }
  ) => ControlledPty | Promise<ControlledPty>
  log?: (message: string, detail?: unknown) => void
}>

let nodePty: typeof import('node-pty') | null | undefined
let nodePtyHelpersExecutableChecked = false
const require = createRequire(import.meta.url)

/**
 * Generic, owner-scoped host process broker used by trusted domain packages.
 *
 * The public capability contract exposes only the `system-shell` profile.
 * Executable paths, arguments, and inherited environment values are never
 * accepted from renderer code.
 */
export class ControlledProcessService {
  readonly #environment: NodeJS.ProcessEnv
  readonly #maxSessions: number
  readonly #platform: NodeJS.Platform
  readonly #spawnPty: NonNullable<ControlledProcessServiceOptions['spawnPty']>
  readonly #log: NonNullable<ControlledProcessServiceOptions['log']>
  readonly #sessions = new Map<string, ControlledProcessSession>()

  constructor(options: ControlledProcessServiceOptions = {}) {
    this.#environment = options.environment ?? process.env
    this.#maxSessions = Math.max(
      1,
      Math.min(
        CONTROLLED_PROCESS_MAX_SESSIONS,
        options.maxSessions ?? CONTROLLED_PROCESS_MAX_SESSIONS
      )
    )
    this.#platform = options.platform ?? process.platform
    this.#spawnPty = options.spawnPty ?? defaultSpawnPty
    this.#log = options.log ?? (() => undefined)
  }

  async create(input: ControlledProcessCreateInput): Promise<ControlledProcessCreateResult> {
    if (this.#sessions.size >= this.#maxSessions) {
      throw new Error(`Controlled process session limit reached (${this.#maxSessions}).`)
    }

    const workspaceRoot = await realpath(input.workspaceRoot)
    const requestedCwd = input.cwd?.trim() || workspaceRoot
    if (!isAbsolute(requestedCwd)) {
      throw new Error('Controlled process working directory must be absolute.')
    }
    const cwd = await realpath(requestedCwd)
    if (!pathIsWithin(cwd, workspaceRoot)) {
      throw new Error('Controlled process working directory is outside the active workspace.')
    }

    ensureNodePtySpawnHelpersExecutable(this.#platform, this.#log)
    const shell = resolveDefaultShell(this.#platform, this.#environment)
    const pty = await this.#spawnPty(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: input.columns ?? CONTROLLED_PROCESS_DEFAULT_COLUMNS,
      rows: input.rows ?? CONTROLLED_PROCESS_DEFAULT_ROWS,
      cwd,
      env: buildControlledProcessEnvironment(this.#environment, this.#platform),
      useConpty: true
    })
    const resourceId = `process_${randomBytes(24).toString('base64url')}`
    const session: ControlledProcessSession = {
      pty,
      ownerId: input.ownerId,
      resourceId,
      ringBuffer: '',
      startCursor: 0,
      endCursor: 0,
      exited: false,
      exitCode: null,
      exitSignal: null,
      waiters: new Set()
    }
    this.#sessions.set(resourceId, session)

    pty.onData((data) => {
      if (session.exited) return
      appendOutput(session, data)
      wakeReaders(session)
    })
    pty.onExit(({ exitCode, signal }) => {
      if (session.exited) return
      session.exited = true
      session.exitCode = Number.isSafeInteger(exitCode) ? exitCode : null
      session.exitSignal = typeof signal === 'number' && signal !== 0 ? String(signal) : null
      wakeReaders(session)
    })

    return { resourceId, cursor: '0' }
  }

  async read(input: ControlledProcessReadInput): Promise<ControlledProcessReadResult> {
    let session = this.#requireOwned(input.ownerId, input.resourceId)
    let cursor = parseCursor(input.cursor)
    if (cursor > session.endCursor) {
      throw new Error('Controlled process cursor is ahead of available output.')
    }
    if (
      cursor >= session.endCursor &&
      !session.exited &&
      input.waitMilliseconds > 0 &&
      !input.signal?.aborted
    ) {
      await waitForProcessActivity(session, input.waitMilliseconds, input.signal)
      session = this.#requireOwned(input.ownerId, input.resourceId)
    }

    const truncated = cursor < session.startCursor
    const start = Math.max(cursor, session.startCursor)
    const data = session.ringBuffer.slice(
      start - session.startCursor,
      start - session.startCursor + input.maxCharacters
    )
    const nextCursor = start + data.length
    return {
      cursor: String(nextCursor),
      chunks: data ? [{ stream: 'stdout', data }] : [],
      truncated,
      ...(session.exited
        ? { exit: { code: session.exitCode, signal: session.exitSignal } }
        : {})
    }
  }

  write(ownerId: string, resourceId: string, data: string): number {
    const session = this.#requireOwned(ownerId, resourceId)
    if (session.exited) throw new Error('Controlled process session has exited.')
    session.pty.write(data)
    return data.length
  }

  resize(ownerId: string, resourceId: string, columns: number, rows: number): void {
    const session = this.#requireOwned(ownerId, resourceId)
    if (session.exited) throw new Error('Controlled process session has exited.')
    session.pty.resize(columns, rows)
  }

  dispose(ownerId: string, resourceId: string): boolean {
    const session = this.#sessions.get(resourceId)
    if (!session || session.ownerId !== ownerId) return false
    this.#disposeSession(session)
    return true
  }

  disposeOwner(ownerId: string): void {
    for (const session of [...this.#sessions.values()]) {
      if (session.ownerId === ownerId) this.#disposeSession(session)
    }
  }

  disposeAll(): void {
    for (const session of [...this.#sessions.values()]) this.#disposeSession(session)
  }

  has(ownerId: string, resourceId: string): boolean {
    const session = this.#sessions.get(resourceId)
    return Boolean(session && session.ownerId === ownerId)
  }

  #requireOwned(ownerId: string, resourceId: string): ControlledProcessSession {
    const session = this.#sessions.get(resourceId)
    if (!session || session.ownerId !== ownerId) {
      throw new Error('Controlled process session is unavailable to this caller.')
    }
    return session
  }

  #disposeSession(session: ControlledProcessSession): void {
    this.#sessions.delete(session.resourceId)
    wakeReaders(session)
    try {
      session.pty.kill()
    } catch (error) {
      this.#log('Failed to stop controlled process.', {
        resourceId: session.resourceId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export function buildControlledProcessEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value) environment[key] = value
  }
  const locale = resolveLocale(source, platform)
  return {
    ...environment,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: locale,
    LC_ALL: locale
  }
}

export function pathIsWithin(path: string, root: string): boolean {
  const relation = relative(resolve(root), resolve(path))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function appendOutput(session: ControlledProcessSession, data: string): void {
  if (!data) return
  session.ringBuffer += data
  session.endCursor += data.length
  if (session.ringBuffer.length > CONTROLLED_PROCESS_RING_BUFFER_CHARACTERS) {
    const removed = session.ringBuffer.length - CONTROLLED_PROCESS_RING_BUFFER_CHARACTERS
    session.ringBuffer = session.ringBuffer.slice(removed)
    session.startCursor += removed
  }
}

function parseCursor(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Controlled process cursor is invalid.')
  const cursor = Number(value)
  if (!Number.isSafeInteger(cursor)) throw new Error('Controlled process cursor is invalid.')
  return cursor
}

function wakeReaders(session: ControlledProcessSession): void {
  for (const wake of [...session.waiters]) wake()
  session.waiters.clear()
}

async function waitForProcessActivity(
  session: ControlledProcessSession,
  waitMilliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      session.waiters.delete(finish)
      resolve()
    }
    session.waiters.add(finish)
    signal?.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, waitMilliseconds)
  })
}

function resolveDefaultShell(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): { file: string; args: string[] } {
  if (platform === 'win32') {
    const systemRoot = environment.SystemRoot ?? environment.WINDIR ?? 'C:\\Windows'
    const windowsPowerShell = join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    if (existsSync(windowsPowerShell)) return { file: windowsPowerShell, args: ['-NoLogo'] }
    return { file: environment.COMSPEC ?? join(systemRoot, 'System32', 'cmd.exe'), args: [] }
  }
  const fallback = platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  return { file: environment.SHELL || fallback, args: ['-l'] }
}

function isUtf8Locale(value: string | undefined): value is string {
  return Boolean(value && /utf-?8/i.test(value))
}

function resolveLocale(source: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (isUtf8Locale(source.LC_ALL)) return source.LC_ALL
  if (isUtf8Locale(source.LC_CTYPE)) return source.LC_CTYPE
  if (isUtf8Locale(source.LANG)) return source.LANG
  if (platform === 'darwin') return 'en_US.UTF-8'
  return 'C.UTF-8'
}

async function defaultSpawnPty(
  file: string,
  args: string[],
  options: {
    name: string
    cols: number
    rows: number
    cwd: string
    env: Record<string, string>
    useConpty: boolean
  }
): Promise<ControlledPty> {
  nodePty ??= await import('node-pty').catch(() => null)
  if (!nodePty) throw new Error('The controlled process backend is unavailable on this system.')
  return nodePty.spawn(file, args, options)
}

function ensureNodePtySpawnHelpersExecutable(
  platform: NodeJS.Platform,
  log: NonNullable<ControlledProcessServiceOptions['log']>
): void {
  if (platform !== 'darwin' || nodePtyHelpersExecutableChecked) return
  nodePtyHelpersExecutableChecked = true
  try {
    const packageJsonPath = require.resolve('node-pty/package.json')
    const prebuildsDir = join(dirname(packageJsonPath), 'prebuilds')
    if (!existsSync(prebuildsDir)) return
    for (const entry of readdirSync(prebuildsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('darwin-')) continue
      const helperPath = join(prebuildsDir, entry.name, 'spawn-helper')
      if (!existsSync(helperPath)) continue
      const mode = statSync(helperPath).mode
      if ((mode & 0o111) === 0) chmodSync(helperPath, mode | 0o755)
    }
  } catch (error) {
    log('Failed to repair node-pty spawn-helper permissions.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
