import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink
} from 'node:fs/promises'
import {
  createConnection,
  createServer,
  type Server as NetServer,
  type Socket
} from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'

import type {
  WorkspaceHostContributionCohort,
  WorkspaceNetworkEgressState
} from '@sciforge/domain-sdk/workspace-host'
import { createCodexWorkspaceHostRuntime } from '@sciforge/codex-runtime/workspace-host'

import { requireWorkspaceHostBundledCodexExecutable } from './artifact.js'
import { createWorkspaceHostDomainComposition } from './composition.js'
import { createWorkspaceHostPreviewOperation } from './preview-service.js'
import { WorkspaceHostJsonlServer } from './server.js'
import {
  WORKSPACE_HOST_SERVER_VERSION,
  WorkspaceHostService
} from './service.js'

const DAEMON_METADATA_SCHEMA_VERSION = 1
const MAX_LINUX_UNIX_SOCKET_PATH_BYTES = 107
const DAEMON_START_TIMEOUT_MILLISECONDS = 10_000
const DAEMON_POLL_INTERVAL_MILLISECONDS = 50
const INVALID_START_LOCK_STALE_MILLISECONDS = 30_000

export type WorkspaceHostDaemonProbe =
  | Readonly<{ supported: true }>
  | Readonly<{ supported: false; reason: string }>

export type WorkspaceHostDaemonMetadata = Readonly<{
  schemaVersion: 1
  daemonKey: string
  workspaceRoot: string
  cohortFingerprint: string
  pid: number
  sessionId: string
  socketPath: string
  lifecycle: 'persistent-daemon'
  startedAt: string
}>

export type WorkspaceHostDaemonPaths = Readonly<{
  daemonKey: string
  cohortFingerprint: string
  socketPath: string
  metadataPath: string
  lockPath: string
}>

export type StartWorkspaceHostDaemonOptions = Readonly<{
  workspaceRoot: string
  runtimeDirectory: string
  entrypointPath: string
  nodeExecutable?: string
  nodeArguments?: readonly string[]
  environment?: NodeJS.ProcessEnv
  timeoutMilliseconds?: number
}>

export type WorkspaceHostDaemonStartResult = Readonly<{
  sessionId: string
  socketPath: string
  lifecycle: 'persistent-daemon'
  reused: boolean
}>

export type CreateWorkspaceHostDaemonOptions = Readonly<{
  workspaceRoot: string
  runtimeDirectory: string
  egressState?: WorkspaceNetworkEgressState
  codexRuntimeFactory?: typeof createCodexWorkspaceHostRuntime
}>

export type WorkspaceHostDaemon = Readonly<{
  metadata: WorkspaceHostDaemonMetadata
  close: () => Promise<void>
}>

/**
 * Persistent daemon support is deliberately conservative. A false result is a
 * signal to use the connection-session cohort; callers must not infer support
 * merely because the platform has Unix sockets.
 */
export async function probeWorkspaceHostDaemon(
  runtimeDirectory: string,
  options: Readonly<{
    platform?: NodeJS.Platform
    architecture?: string
    uid?: number
  }> = {}
): Promise<WorkspaceHostDaemonProbe> {
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  const uid = options.uid ?? process.getuid?.()
  if (
    (platform !== 'linux' || architecture !== 'x64')
    && process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM !== '1'
  ) {
    return {
      supported: false,
      reason: 'Persistent Workspace Host daemon requires Linux x64.'
    }
  }
  if (uid === undefined) {
    return {
      supported: false,
      reason: 'Persistent Workspace Host daemon requires POSIX user identity support.'
    }
  }
  if (uid === 0) {
    return {
      supported: false,
      reason: 'Persistent Workspace Host daemon must not run as root.'
    }
  }
  if (!isAbsolute(runtimeDirectory) || runtimeDirectory.includes('\0')) {
    return {
      supported: false,
      reason: 'Workspace Host runtime directory must be an absolute path.'
    }
  }
  const representativeSocket = join(
    runtimeDirectory,
    `workspace-${'a'.repeat(32)}.sock`
  )
  if (
    Buffer.byteLength(representativeSocket, 'utf8')
    > MAX_LINUX_UNIX_SOCKET_PATH_BYTES
  ) {
    return {
      supported: false,
      reason: 'Workspace Host runtime directory is too long for a Linux Unix socket.'
    }
  }
  try {
    await assertRuntimeDirectoryCandidate(runtimeDirectory, uid)
  } catch (error) {
    return {
      supported: false,
      reason: errorMessage(error)
    }
  }
  return { supported: true }
}

export function defaultWorkspaceHostRuntimeDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  uid = process.getuid?.()
): string {
  if (uid === undefined) {
    throw new Error('Workspace Host runtime directory requires a POSIX user identity.')
  }
  const xdgRuntimeDirectory = environment.XDG_RUNTIME_DIR
  if (xdgRuntimeDirectory && isAbsolute(xdgRuntimeDirectory)) {
    return join(xdgRuntimeDirectory, 'sciforge', 'workspace-host')
  }
  return `/tmp/sciforge-workspace-host-${uid}`
}

export async function resolveWorkspaceHostDaemonPaths(
  workspaceRoot: string,
  runtimeDirectory: string,
  cohorts: readonly WorkspaceHostContributionCohort[]
): Promise<WorkspaceHostDaemonPaths> {
  const canonicalWorkspaceRoot = await realpath(workspaceRoot)
  if (!(await stat(canonicalWorkspaceRoot)).isDirectory()) {
    throw new Error('Workspace Host root must be a directory.')
  }
  const canonicalCohorts = [...cohorts]
    .map((cohort) => ({
      packageName: cohort.packageName,
      moduleId: cohort.moduleId,
      moduleVersion: cohort.moduleVersion
    }))
    .sort((left, right) =>
      `${left.packageName}\0${left.moduleId}\0${left.moduleVersion}`
        .localeCompare(`${right.packageName}\0${right.moduleId}\0${right.moduleVersion}`)
    )
  const cohortFingerprint = createHash('sha256')
    .update(JSON.stringify({
      serverVersion: WORKSPACE_HOST_SERVER_VERSION,
      cohorts: canonicalCohorts
    }))
    .digest('hex')
  const daemonKey = createHash('sha256')
    .update(JSON.stringify({
      workspaceRoot: canonicalWorkspaceRoot,
      cohortFingerprint
    }))
    .digest('hex')
    .slice(0, 32)
  const socketPath = join(runtimeDirectory, `workspace-${daemonKey}.sock`)
  if (Buffer.byteLength(socketPath, 'utf8') > MAX_LINUX_UNIX_SOCKET_PATH_BYTES) {
    throw new Error('Workspace Host Unix socket path exceeds the Linux limit.')
  }
  return {
    daemonKey,
    cohortFingerprint,
    socketPath,
    metadataPath: join(runtimeDirectory, `workspace-${daemonKey}.json`),
    lockPath: join(runtimeDirectory, `workspace-${daemonKey}.lock`)
  }
}

export async function startWorkspaceHostDaemon(
  options: StartWorkspaceHostDaemonOptions
): Promise<WorkspaceHostDaemonStartResult> {
  const probe = await probeWorkspaceHostDaemon(options.runtimeDirectory)
  if (!probe.supported) throw new Error(probe.reason)
  const runtimeDirectory = await ensurePrivateRuntimeDirectory(options.runtimeDirectory)
  const composition = createWorkspaceHostDomainComposition({ log: () => undefined })
  let paths: WorkspaceHostDaemonPaths
  try {
    paths = await resolveWorkspaceHostDaemonPaths(
      options.workspaceRoot,
      runtimeDirectory,
      composition.cohorts
    )
  } finally {
    composition.dispose()
  }

  const existing = await readLiveDaemonMetadata(paths)
  if (existing) return daemonStartResult(existing, true)

  const lock = await acquireStartLock(paths.lockPath)
  if (!lock) {
    const metadata = await waitForLiveDaemon(
      paths,
      options.timeoutMilliseconds ?? DAEMON_START_TIMEOUT_MILLISECONDS
    )
    if (!metadata) {
      throw new Error('Another Workspace Host daemon start did not become ready.')
    }
    return daemonStartResult(metadata, true)
  }

  try {
    const afterLock = await readLiveDaemonMetadata(paths)
    if (afterLock) return daemonStartResult(afterLock, true)
    await removeStaleDaemonFiles(paths)

    const workspaceRootBase64 = Buffer.from(
      await realpath(options.workspaceRoot),
      'utf8'
    ).toString('base64url')
    const runtimeDirectoryBase64 = Buffer.from(
      runtimeDirectory,
      'utf8'
    ).toString('base64url')
    const child = spawn(
      options.nodeExecutable ?? process.execPath,
      [
        ...(options.nodeArguments ?? process.execArgv),
        resolve(options.entrypointPath),
        'daemon',
        '--workspace-root-base64',
        workspaceRootBase64,
        '--runtime-dir-base64',
        runtimeDirectoryBase64
      ],
      {
        detached: true,
        stdio: 'ignore',
        shell: false,
        env: sanitizedDaemonEnvironment(options.environment ?? process.env)
      }
    )
    let childSpawnError: Error | undefined
    child.once('error', (error) => {
      childSpawnError = error
    })
    child.unref()
    if (!child.pid) {
      throw new Error('Workspace Host daemon process did not start.')
    }
    const metadata = await waitForLiveDaemon(
      paths,
      options.timeoutMilliseconds ?? DAEMON_START_TIMEOUT_MILLISECONDS,
      child.pid
    )
    if (!metadata) {
      throw new Error(
        childSpawnError
          ? `Workspace Host daemon failed to start: ${childSpawnError.message}`
          : 'Workspace Host daemon did not become ready before the deadline.'
      )
    }
    return daemonStartResult(metadata, false)
  } finally {
    await lock.close().catch(() => undefined)
    await unlink(paths.lockPath).catch(() => undefined)
  }
}

export async function createWorkspaceHostDaemon(
  options: CreateWorkspaceHostDaemonOptions
): Promise<WorkspaceHostDaemon> {
  const probe = await probeWorkspaceHostDaemon(options.runtimeDirectory)
  if (!probe.supported) throw new Error(probe.reason)
  const runtimeDirectory = await ensurePrivateRuntimeDirectory(options.runtimeDirectory)
  const codexExecutable = options.codexRuntimeFactory
    ? undefined
    : await requireWorkspaceHostBundledCodexExecutable(import.meta.dirname)
  const composition = createWorkspaceHostDomainComposition({
    log(entry) {
      process.stderr.write(`[workspace-server:${entry.level}] ${entry.message}\n`)
    }
  })
  const paths = await resolveWorkspaceHostDaemonPaths(
    options.workspaceRoot,
    runtimeDirectory,
    composition.cohorts
  )
  const existing = await readLiveDaemonMetadata(paths)
  if (existing && existing.pid !== process.pid) {
    composition.dispose()
    throw new Error('Workspace Host daemon is already running for this workspace cohort.')
  }
  await removeStaleDaemonFiles(paths)

  const previewOperation = createWorkspaceHostPreviewOperation(
    composition.contributions
  )
  const codexRuntime = options.codexRuntimeFactory
    ? await options.codexRuntimeFactory({
        workspaceRoot: options.workspaceRoot
      })
    : await createCodexWorkspaceHostRuntime({
        workspaceRoot: options.workspaceRoot,
        command: codexExecutable!
      })
  let service: WorkspaceHostService | undefined
  let relay: PersistentWorkspaceHostRelay | undefined
  let metadata: WorkspaceHostDaemonMetadata | undefined
  try {
    service = await WorkspaceHostService.create({
      workspaceRoot: options.workspaceRoot,
      lifecycleMode: 'persistent-daemon',
      lifecycleReason:
        'A private user daemon owns this workspace/cohort session across SSH relay disconnects.',
      operationHandlers: [
        ...codexRuntime.operationHandlers,
        ...(previewOperation ? [previewOperation] : [])
      ]
    })
    relay = new PersistentWorkspaceHostRelay({
      service,
      socketPath: paths.socketPath,
      contributions: composition.cohorts,
      egressState: options.egressState
    })
    await relay.listen()
    metadata = {
      schemaVersion: DAEMON_METADATA_SCHEMA_VERSION,
      daemonKey: paths.daemonKey,
      workspaceRoot: service.workspaceRoot,
      cohortFingerprint: paths.cohortFingerprint,
      pid: process.pid,
      sessionId: service.sessionId,
      socketPath: paths.socketPath,
      lifecycle: 'persistent-daemon',
      startedAt: new Date().toISOString()
    }
    await writeDaemonMetadata(paths.metadataPath, metadata)
  } catch (error) {
    await relay?.close().catch(() => undefined)
    service?.dispose()
    await codexRuntime.dispose().catch(() => undefined)
    composition.dispose()
    await removeOwnedDaemonFiles(paths, process.pid)
    throw error
  }

  let closePromise: Promise<void> | undefined
  return {
    metadata,
    close() {
      closePromise ??= (async () => {
        await relay.close()
        service.dispose()
        await codexRuntime.dispose()
        composition.dispose()
        await removeOwnedDaemonFiles(paths, process.pid, metadata.sessionId)
      })()
      return closePromise
    }
  }
}

export async function runWorkspaceHostDaemon(
  options: CreateWorkspaceHostDaemonOptions
): Promise<void> {
  const daemon = await createWorkspaceHostDaemon(options)
  await new Promise<void>((resolveStop) => {
    const stop = (): void => resolveStop()
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  })
  await daemon.close()
}

export async function attachWorkspaceHostDaemon(options: Readonly<{
  workspaceRoot: string
  runtimeDirectory: string
  input: Readable
  output: Writable
}>): Promise<void> {
  const runtimeDirectory = await ensurePrivateRuntimeDirectory(
    resolve(options.runtimeDirectory)
  )
  const composition = createWorkspaceHostDomainComposition({ log: () => undefined })
  let paths: WorkspaceHostDaemonPaths
  try {
    paths = await resolveWorkspaceHostDaemonPaths(
      options.workspaceRoot,
      runtimeDirectory,
      composition.cohorts
    )
  } finally {
    composition.dispose()
  }
  const metadata = await readLiveDaemonMetadata(paths)
  if (!metadata) {
    throw new Error('Persistent Workspace Host daemon is not running for this workspace cohort.')
  }
  await relayStreamsToSocket(
    paths.socketPath,
    options.input,
    options.output
  )
}

class PersistentWorkspaceHostRelay {
  readonly #service: WorkspaceHostService
  readonly #socketPath: string
  readonly #contributions: readonly WorkspaceHostContributionCohort[]
  readonly #egressState?: WorkspaceNetworkEgressState
  readonly #server: NetServer
  #activeSocket?: Socket
  #pendingSocket?: Socket
  #activeRun?: Promise<void>
  #pumping = false
  #closing = false

  constructor(options: Readonly<{
    service: WorkspaceHostService
    socketPath: string
    contributions: readonly WorkspaceHostContributionCohort[]
    egressState?: WorkspaceNetworkEgressState
  }>) {
    this.#service = options.service
    this.#socketPath = options.socketPath
    this.#contributions = options.contributions
    this.#egressState = options.egressState
    this.#server = createServer({ allowHalfOpen: true }, (socket) => {
      this.#queueAttachment(socket)
    })
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error): void => {
        this.#server.off('listening', onListening)
        rejectListen(error)
      }
      const onListening = (): void => {
        this.#server.off('error', onError)
        resolveListen()
      }
      this.#server.once('error', onError)
      this.#server.once('listening', onListening)
      this.#server.listen(this.#socketPath)
    })
    await chmod(this.#socketPath, 0o600)
    const socketStat = await lstat(this.#socketPath)
    if (!socketStat.isSocket()) {
      throw new Error('Workspace Host daemon endpoint is not a Unix socket.')
    }
    const uid = process.getuid?.()
    if (uid === undefined || socketStat.uid !== uid) {
      throw new Error('Workspace Host daemon socket is not owned by the current user.')
    }
    if ((socketStat.mode & 0o777) !== 0o600) {
      throw new Error('Workspace Host daemon socket permissions are not 0600.')
    }
  }

  async close(): Promise<void> {
    if (this.#closing) return
    this.#closing = true
    this.#pendingSocket?.destroy()
    this.#pendingSocket = undefined
    this.#activeSocket?.destroy()
    await new Promise<void>((resolveClose) => {
      this.#server.close(() => resolveClose())
    }).catch(() => undefined)
    await this.#activeRun?.catch(() => undefined)
  }

  #queueAttachment(socket: Socket): void {
    if (this.#closing) {
      socket.destroy()
      return
    }
    socket.setNoDelay(true)
    this.#pendingSocket?.destroy()
    this.#pendingSocket = socket
    // One authenticated desktop attachment owns the session route at a time.
    // A fresh attach supersedes a stale relay before its handshake is parsed.
    this.#activeSocket?.destroy()
    if (!this.#pumping) void this.#pump()
  }

  async #pump(): Promise<void> {
    this.#pumping = true
    try {
      while (!this.#closing && this.#pendingSocket) {
        await this.#activeRun?.catch(() => undefined)
        const socket = this.#pendingSocket
        this.#pendingSocket = undefined
        if (socket.destroyed) continue
        this.#activeSocket = socket
        const jsonlServer = new WorkspaceHostJsonlServer({
          service: this.#service,
          input: socket,
          output: socket,
          contributions: this.#contributions,
          ...(this.#egressState ? { egressState: this.#egressState } : {}),
          disposeServiceOnClose: false,
          deriveEgressStateFromHandshake: true
        })
        this.#activeRun = jsonlServer.run()
          .catch(() => {
            socket.destroy()
          })
          .finally(() => {
            if (this.#activeSocket === socket) this.#activeSocket = undefined
          })
        await this.#activeRun
      }
    } finally {
      this.#pumping = false
      if (!this.#closing && this.#pendingSocket) void this.#pump()
    }
  }
}

async function relayStreamsToSocket(
  socketPath: string,
  input: Readable,
  output: Writable
): Promise<void> {
  const socket = createConnection({ path: socketPath, allowHalfOpen: true })
  await new Promise<void>((resolveConnect, rejectConnect) => {
    const onError = (error: Error): void => {
      socket.off('connect', onConnect)
      rejectConnect(error)
    }
    const onConnect = (): void => {
      socket.off('error', onError)
      resolveConnect()
    }
    socket.once('error', onError)
    socket.once('connect', onConnect)
  })
  input.pipe(socket)
  socket.pipe(output, { end: false })
  await new Promise<void>((resolveClose, rejectClose) => {
    const onError = (error: Error): void => rejectClose(error)
    socket.once('error', onError)
    socket.once('close', () => {
      socket.off('error', onError)
      resolveClose()
    })
  }).finally(() => {
    input.unpipe(socket)
    socket.unpipe(output)
    socket.destroy()
  })
}

async function assertRuntimeDirectoryCandidate(
  runtimeDirectory: string,
  uid: number
): Promise<void> {
  try {
    const directoryStat = await lstat(runtimeDirectory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('Workspace Host runtime path must be a real directory.')
    }
    if (directoryStat.uid !== uid) {
      throw new Error('Workspace Host runtime directory must be owned by the current user.')
    }
    await access(runtimeDirectory, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)
    return
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
  }
  let candidate = dirname(runtimeDirectory)
  while (true) {
    try {
      const parentStat = await stat(candidate)
      if (!parentStat.isDirectory()) {
        throw new Error('Workspace Host runtime directory parent is not a directory.')
      }
      await access(candidate, fsConstants.W_OK | fsConstants.X_OK)
      return
    } catch (error) {
      if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

async function ensurePrivateRuntimeDirectory(runtimeDirectory: string): Promise<string> {
  const uid = process.getuid?.()
  if (uid === undefined || uid === 0) {
    throw new Error('Workspace Host persistent daemon requires a non-root POSIX user.')
  }
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })
  const directoryStat = await lstat(runtimeDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Workspace Host runtime path must be a real directory.')
  }
  if (directoryStat.uid !== uid) {
    throw new Error('Workspace Host runtime directory must be owned by the current user.')
  }
  await chmod(runtimeDirectory, 0o700)
  const securedStat = await lstat(runtimeDirectory)
  if ((securedStat.mode & 0o777) !== 0o700) {
    throw new Error('Workspace Host runtime directory permissions are not 0700.')
  }
  return realpath(runtimeDirectory)
}

async function acquireStartLock(path: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString()
      })}\n`, 'utf8')
      await handle.sync()
      return handle
    } catch (error) {
      if (!isNodeErrorWithCode(error, 'EEXIST')) throw error
      if (!(await isStaleStartLock(path))) return undefined
      await unlink(path).catch((unlinkError: unknown) => {
        if (!isNodeErrorWithCode(unlinkError, 'ENOENT')) throw unlinkError
      })
    }
  }
  return undefined
}

async function isStaleStartLock(path: string): Promise<boolean> {
  try {
    const content = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (
      content
      && typeof content === 'object'
      && !Array.isArray(content)
      && Number.isSafeInteger((content as { pid?: unknown }).pid)
    ) {
      return !isProcessAlive((content as { pid: number }).pid)
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return true
  }
  try {
    const lockStat = await lstat(path)
    return Date.now() - lockStat.mtimeMs > INVALID_START_LOCK_STALE_MILLISECONDS
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return true
    throw error
  }
}

async function readLiveDaemonMetadata(
  paths: WorkspaceHostDaemonPaths
): Promise<WorkspaceHostDaemonMetadata | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(paths.metadataPath, 'utf8')) as unknown
  } catch (error) {
    if (
      isNodeErrorWithCode(error, 'ENOENT')
      || error instanceof SyntaxError
    ) return undefined
    throw error
  }
  const metadata = parseDaemonMetadata(parsed)
  let metadataStat
  try {
    metadataStat = await lstat(paths.metadataPath)
  } catch {
    return undefined
  }
  const uid = process.getuid?.()
  if (
    !metadata
    || !metadataStat.isFile()
    || uid === undefined
    || metadataStat.uid !== uid
    || (metadataStat.mode & 0o777) !== 0o600
    || metadata.daemonKey !== paths.daemonKey
    || metadata.cohortFingerprint !== paths.cohortFingerprint
    || metadata.socketPath !== paths.socketPath
    || !isProcessAlive(metadata.pid)
  ) {
    return undefined
  }
  try {
    const socketStat = await lstat(paths.socketPath)
    if (
      !socketStat.isSocket()
      || socketStat.uid !== uid
      || (socketStat.mode & 0o777) !== 0o600
    ) return undefined
  } catch {
    return undefined
  }
  return metadata
}

async function waitForLiveDaemon(
  paths: WorkspaceHostDaemonPaths,
  timeoutMilliseconds: number,
  expectedPid?: number
): Promise<WorkspaceHostDaemonMetadata | undefined> {
  const deadline = Date.now() + timeoutMilliseconds
  do {
    const metadata = await readLiveDaemonMetadata(paths)
    if (metadata && (expectedPid === undefined || metadata.pid === expectedPid)) {
      return metadata
    }
    if (expectedPid !== undefined && !isProcessAlive(expectedPid)) return undefined
    await delay(DAEMON_POLL_INTERVAL_MILLISECONDS)
  } while (Date.now() < deadline)
  return undefined
}

async function removeStaleDaemonFiles(paths: WorkspaceHostDaemonPaths): Promise<void> {
  if (await readLiveDaemonMetadata(paths)) {
    throw new Error('Workspace Host daemon is already running for this workspace cohort.')
  }
  await rm(paths.metadataPath, { force: true })
  try {
    const socketStat = await lstat(paths.socketPath)
    if (!socketStat.isSocket()) {
      throw new Error('Refusing to replace a non-socket Workspace Host daemon endpoint.')
    }
    const uid = process.getuid?.()
    if (uid === undefined || socketStat.uid !== uid) {
      throw new Error('Refusing to replace a Workspace Host socket owned by another user.')
    }
    await unlink(paths.socketPath)
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
  }
}

async function removeOwnedDaemonFiles(
  paths: WorkspaceHostDaemonPaths,
  pid: number,
  sessionId?: string
): Promise<void> {
  try {
    const content = JSON.parse(await readFile(paths.metadataPath, 'utf8')) as unknown
    const metadata = parseDaemonMetadata(content)
    if (
      metadata?.pid === pid
      && (sessionId === undefined || metadata.sessionId === sessionId)
    ) {
      await unlink(paths.metadataPath).catch(() => undefined)
      await unlink(paths.socketPath).catch(() => undefined)
    }
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
  }
}

async function writeDaemonMetadata(
  metadataPath: string,
  metadata: WorkspaceHostDaemonMetadata
): Promise<void> {
  const temporaryPath = `${metadataPath}.${process.pid}.tmp`
  await rm(temporaryPath, { force: true })
  await open(temporaryPath, 'wx', 0o600).then(async (handle) => {
    try {
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  })
  await rename(temporaryPath, metadataPath)
  await chmod(metadataPath, 0o600)
}

function parseDaemonMetadata(value: unknown): WorkspaceHostDaemonMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const metadata = value as Record<string, unknown>
  if (
    metadata.schemaVersion !== DAEMON_METADATA_SCHEMA_VERSION
    || typeof metadata.daemonKey !== 'string'
    || typeof metadata.workspaceRoot !== 'string'
    || typeof metadata.cohortFingerprint !== 'string'
    || typeof metadata.pid !== 'number'
    || !Number.isSafeInteger(metadata.pid)
    || metadata.pid < 1
    || typeof metadata.sessionId !== 'string'
    || typeof metadata.socketPath !== 'string'
    || metadata.lifecycle !== 'persistent-daemon'
    || typeof metadata.startedAt !== 'string'
  ) return undefined
  return metadata as WorkspaceHostDaemonMetadata
}

function daemonStartResult(
  metadata: WorkspaceHostDaemonMetadata,
  reused: boolean
): WorkspaceHostDaemonStartResult {
  return {
    sessionId: metadata.sessionId,
    socketPath: metadata.socketPath,
    lifecycle: 'persistent-daemon',
    reused
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isNodeErrorWithCode(error, 'EPERM')
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}

/**
 * The detached server must not turn the SSH bootstrap environment into a
 * long-lived secret store. Network proxy credentials are supplied only by the
 * scoped protocol handshake and expire inside WorkspaceHostService.
 */
function sanitizedDaemonEnvironment(
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const exactAllowlist = new Set([
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOGNAME',
    'PATH',
    'SHELL',
    'TERM',
    'TMPDIR',
    'USER',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM'
  ])
  const environment: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined
      && (
        exactAllowlist.has(name)
        || name.startsWith('LC_')
      )
      && !name.toUpperCase().endsWith('_PROXY')
    ) {
      environment[name] = value
    }
  }
  return environment
}

function isNodeErrorWithCode(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
