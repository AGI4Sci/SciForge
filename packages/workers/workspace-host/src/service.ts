import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink
} from 'node:fs/promises'
import { constants as fsConstants, type Stats } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_OPERATIONS,
  WorkspaceHostOperationError,
  parseWorkspaceHostOperationInput,
  parseWorkspaceHostOperationOutput,
  workspaceHostEventKindSchema,
  workspaceHostModelAccessSchema,
  workspaceHostOperationContract,
  workspaceHostOperationSchema,
  workspaceHostPayloadSchema,
  type WorkspaceHostCapability,
  type WorkspaceHostDirectoryListInput,
  type WorkspaceHostEventKind,
  type WorkspaceHostFileEntry,
  type WorkspaceHostFileReadInput,
  type WorkspaceHostFileReadRangeInput,
  type WorkspaceHostFileWriteInput,
  type WorkspaceHostLifecycleMode,
  type WorkspaceHostModelAccess,
  type WorkspaceHostOperation,
  type WorkspaceHostPayload,
  type WorkspaceHostProcessCreateInput,
  type WorkspaceHostTextSearchInput
} from '@sciforge/domain-sdk/workspace-host'
import type { VersionControlDiffInput } from '@sciforge/domain-sdk/version-control'

import { BoundedWorkspaceHostJournal, type WorkspaceHostJournalEvent } from './journal.js'
import { WorkspaceProcessError, WorkspaceProcessService } from './process-service.js'

export const WORKSPACE_HOST_SERVER_VERSION = '0.1.0'
const MAX_SEARCH_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_GIT_OUTPUT_CHARACTERS = 1_000_000

export type WorkspaceHostOperationContext = Readonly<{
  workspaceRoot: string
  sessionId: string
  publishEvent: (
    type: WorkspaceHostEventKind,
    payload: WorkspaceHostPayload
  ) => WorkspaceHostJournalEvent
  getProcessEnvironment: () => NodeJS.ProcessEnv
  getProcessEnvironmentGeneration: () => number
  isProcessNetworkEgressReady: () => boolean
  getModelAccess: () => WorkspaceHostModelAccess | undefined
  getModelAccessGeneration: () => number
  isModelAccessReady: () => boolean
}>

export type WorkspaceHostOperationHandler = (
  payload: WorkspaceHostPayload,
  context: WorkspaceHostOperationContext
) => WorkspaceHostPayload | Promise<WorkspaceHostPayload>

export type WorkspaceHostOperationRegistration = Readonly<{
  operation: WorkspaceHostOperation
  version?: string
  maxRequestBytes?: number
  maxResponseBytes?: number
  onProcessEnvironmentChanged?: (
    environment: NodeJS.ProcessEnv,
    generation: number,
    networkEgressReady: boolean
  ) => void | Promise<void>
  onModelAccessChanged?: (
    access: WorkspaceHostModelAccess | undefined,
    generation: number,
    ready: boolean
  ) => void | Promise<void>
  handler: WorkspaceHostOperationHandler
}>

export type WorkspaceHostServiceOptions = Readonly<{
  workspaceRoot: string
  sessionId?: string
  serverInstanceId?: string
  lifecycleMode?: WorkspaceHostLifecycleMode
  lifecycleReason?: string
  journalCapacity?: number
  platform?: NodeJS.Platform
  architecture?: string
  environment?: NodeJS.ProcessEnv
  operationHandlers?: readonly WorkspaceHostOperationRegistration[]
}>

type JsonRecord = Record<string, WorkspaceHostPayload>

type RegisteredOperation = Required<Omit<
  WorkspaceHostOperationRegistration,
  'handler' | 'onProcessEnvironmentChanged' | 'onModelAccessChanged'
>> & {
  handler: WorkspaceHostOperationHandler
  onProcessEnvironmentChanged?: WorkspaceHostOperationRegistration[
    'onProcessEnvironmentChanged'
  ]
  onModelAccessChanged?: WorkspaceHostOperationRegistration[
    'onModelAccessChanged'
  ]
}

export class WorkspaceHostService {
  readonly workspaceRoot: string
  readonly sessionId: string
  readonly serverInstanceId: string
  readonly lifecycleMode: WorkspaceHostLifecycleMode
  readonly lifecycleReason?: string
  readonly platform: NodeJS.Platform
  readonly architecture: string
  readonly journal: BoundedWorkspaceHostJournal<WorkspaceHostPayload>
  readonly processes: WorkspaceProcessService
  readonly #operationHandlers = new Map<string, RegisteredOperation>()
  readonly #watchers = new Map<string, FSWatcher>()
  #processEnvironmentGeneration = 0
  #processEnvironmentExpiryTimer?: NodeJS.Timeout
  #modelAccess?: WorkspaceHostModelAccess
  #modelAccessGeneration = 0
  #modelAccessExpiryTimer?: NodeJS.Timeout

  private constructor(options: WorkspaceHostServiceOptions, workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot
    this.sessionId = options.sessionId ?? randomUUID()
    this.serverInstanceId = options.serverInstanceId ?? randomUUID()
    this.lifecycleMode = options.lifecycleMode ?? 'connection-session'
    this.lifecycleReason = options.lifecycleReason
    this.platform = options.platform ?? process.platform
    this.architecture = options.architecture ?? process.arch
    this.journal = new BoundedWorkspaceHostJournal({
      capacity: options.journalCapacity
    })
    this.processes = new WorkspaceProcessService({
      resolveCwd: async (path) => this.resolveDirectory(path ?? '.'),
      baseEnvironment: options.environment
    })
    for (const registration of options.operationHandlers ?? []) {
      this.registerOperation(registration)
    }
  }

  static async create(options: WorkspaceHostServiceOptions): Promise<WorkspaceHostService> {
    if (!isAbsolute(options.workspaceRoot)) {
      throw hostError('invalid_workspace_root', 'Workspace root must be an absolute path.')
    }
    const workspaceRoot = await realpath(options.workspaceRoot)
    const rootStat = await stat(workspaceRoot)
    if (!rootStat.isDirectory()) {
      throw hostError('invalid_workspace_root', 'Workspace root must be a directory.')
    }
    await access(workspaceRoot, fsConstants.R_OK)
    return new WorkspaceHostService(options, workspaceRoot)
  }

  get capabilities(): readonly WorkspaceHostCapability[] {
    const maxPayloadBytes = WORKSPACE_HOST_LIMITS.maxPayloadBytes
    const builtIns = [
      WORKSPACE_HOST_OPERATIONS.health,
      WORKSPACE_HOST_OPERATIONS.status,
      WORKSPACE_HOST_OPERATIONS.directoryList,
      WORKSPACE_HOST_OPERATIONS.fileStat,
      WORKSPACE_HOST_OPERATIONS.fileRead,
      WORKSPACE_HOST_OPERATIONS.fileReadRange,
      WORKSPACE_HOST_OPERATIONS.fileWrite,
      WORKSPACE_HOST_OPERATIONS.fileWatch,
      WORKSPACE_HOST_OPERATIONS.fileUnwatch,
      WORKSPACE_HOST_OPERATIONS.textSearch,
      WORKSPACE_HOST_OPERATIONS.processCreate,
      WORKSPACE_HOST_OPERATIONS.processRead,
      WORKSPACE_HOST_OPERATIONS.processWrite,
      WORKSPACE_HOST_OPERATIONS.processResize,
      WORKSPACE_HOST_OPERATIONS.processDispose,
      WORKSPACE_HOST_OPERATIONS.versionControlStatus,
      WORKSPACE_HOST_OPERATIONS.versionControlDiff
    ].map((operation) => ({
      operation,
      version: '1.0.0',
      maxRequestBytes: maxPayloadBytes,
      maxResponseBytes: maxPayloadBytes
    }))
    return [
      ...builtIns,
      ...[...this.#operationHandlers.values()].map((registration) => ({
        operation: registration.operation,
        version: registration.version,
        maxRequestBytes: registration.maxRequestBytes,
        maxResponseBytes: registration.maxResponseBytes
      }))
    ]
  }

  registerOperation(registration: WorkspaceHostOperationRegistration): () => void {
    const operation = workspaceHostOperationSchema.parse(registration.operation)
    if (this.#isOwnedOperation(operation)) {
      throw new Error(`Operation ${operation} is owned by the Workspace Host service.`)
    }
    if (this.#operationHandlers.has(operation)) {
      throw new Error(`Operation ${operation} is already registered.`)
    }
    const installed: RegisteredOperation = {
      operation,
      version: registration.version ?? '1.0.0',
      maxRequestBytes: registration.maxRequestBytes ?? WORKSPACE_HOST_LIMITS.maxPayloadBytes,
      maxResponseBytes: registration.maxResponseBytes ?? WORKSPACE_HOST_LIMITS.maxPayloadBytes,
      handler: registration.handler,
      ...(registration.onProcessEnvironmentChanged
        ? { onProcessEnvironmentChanged: registration.onProcessEnvironmentChanged }
        : {}),
      ...(registration.onModelAccessChanged
        ? { onModelAccessChanged: registration.onModelAccessChanged }
        : {})
    }
    this.#operationHandlers.set(operation, installed)
    return () => {
      if (this.#operationHandlers.get(operation) === installed) {
        this.#operationHandlers.delete(operation)
      }
    }
  }

  publishEvent(
    type: WorkspaceHostEventKind,
    payload: WorkspaceHostPayload
  ): WorkspaceHostJournalEvent {
    return this.journal.append(
      workspaceHostEventKindSchema.parse(type),
      workspaceHostPayloadSchema.parse(payload)
    )
  }

  async request(
    operation: WorkspaceHostOperation,
    payload: WorkspaceHostPayload
  ): Promise<WorkspaceHostPayload> {
    try {
      const operationContract = workspaceHostOperationContract(operation)
      const parsedPayload = operationContract
        ? parseWorkspaceHostOperationInput(
            operationContract.operation,
            payload
          ) as WorkspaceHostPayload
        : workspaceHostPayloadSchema.parse(payload)
      let output: unknown
      switch (operation) {
        case WORKSPACE_HOST_OPERATIONS.health:
          output = this.health()
          break
        case WORKSPACE_HOST_OPERATIONS.status:
          output = this.lifecycleStatus()
          break
        case WORKSPACE_HOST_OPERATIONS.fileStat:
          output = await this.workspaceStat(parsedPayload as { path: string })
          break
        case WORKSPACE_HOST_OPERATIONS.directoryList:
          output = await this.workspaceList(parsedPayload as WorkspaceHostDirectoryListInput)
          break
        case WORKSPACE_HOST_OPERATIONS.fileRead:
          output = await this.workspaceRead(parsedPayload as WorkspaceHostFileReadInput)
          break
        case WORKSPACE_HOST_OPERATIONS.fileReadRange:
          output = await this.workspaceReadRange(parsedPayload as WorkspaceHostFileReadRangeInput)
          break
        case WORKSPACE_HOST_OPERATIONS.fileWrite:
          output = await this.workspaceWrite(parsedPayload as WorkspaceHostFileWriteInput)
          break
        case WORKSPACE_HOST_OPERATIONS.fileWatch:
          output = await this.workspaceWatch(parsedPayload as {
            path: string
            recursive: boolean
          })
          break
        case WORKSPACE_HOST_OPERATIONS.fileUnwatch:
          output = this.workspaceUnwatch(parsedPayload as { watchId: string })
          break
        case WORKSPACE_HOST_OPERATIONS.textSearch:
          output = await this.workspaceSearch(parsedPayload as WorkspaceHostTextSearchInput)
          break
        case WORKSPACE_HOST_OPERATIONS.versionControlStatus:
          output = await this.gitStatus()
          break
        case WORKSPACE_HOST_OPERATIONS.versionControlDiff:
          output = await this.gitDiff(parsedPayload as VersionControlDiffInput)
          break
        case WORKSPACE_HOST_OPERATIONS.processCreate:
          output = await this.processCreate(parsedPayload as WorkspaceHostProcessCreateInput)
          break
        case WORKSPACE_HOST_OPERATIONS.processRead: {
          const input = parsedPayload as {
            processId: string
            cursor: string
            maxCharacters: number
            waitMilliseconds: number
          }
          output = await this.processes.read(input.processId, input)
          break
        }
        case WORKSPACE_HOST_OPERATIONS.processWrite: {
          const input = parsedPayload as { processId: string; data: string }
          output = await this.processes.write(input.processId, input.data)
          break
        }
        case WORKSPACE_HOST_OPERATIONS.processResize: {
          const input = parsedPayload as {
            processId: string
            columns: number
            rows: number
          }
          output = this.processes.resize(input.processId, input.columns, input.rows)
          break
        }
        case WORKSPACE_HOST_OPERATIONS.processDispose: {
          const input = parsedPayload as { processId: string }
          output = this.processes.dispose(input.processId)
          break
        }
        default: {
          const registration = this.#operationHandlers.get(operation)
          if (!registration) {
            throw hostError(
              'unsupported_operation',
              `Workspace Host operation "${operation}" is not supported.`
            )
          }
          output = await registration.handler(parsedPayload, {
            workspaceRoot: this.workspaceRoot,
            sessionId: this.sessionId,
            publishEvent: (type, eventPayload) => this.publishEvent(type, eventPayload),
            getProcessEnvironment: () => this.processes.currentEnvironment(),
            getProcessEnvironmentGeneration: () => this.#processEnvironmentGeneration,
            isProcessNetworkEgressReady: () => this.processes.isNetworkEgressReady(),
            getModelAccess: () => this.currentModelAccess(),
            getModelAccessGeneration: () => this.#modelAccessGeneration,
            isModelAccessReady: () => this.isModelAccessReady()
          })
          break
        }
      }
      const parsedOutput = operationContract
        ? parseWorkspaceHostOperationOutput(operationContract.operation, output)
        : workspaceHostPayloadSchema.parse(output)
      return parsedOutput as WorkspaceHostPayload
    } catch (error) {
      if (error instanceof WorkspaceHostServiceError) throw error
      if (error instanceof WorkspaceHostOperationError) {
        throw hostError(
          error.code,
          error.message,
          error.retryable,
          error.details
        )
      }
      if (error instanceof WorkspaceProcessError) {
        throw hostError(error.code, error.message)
      }
      if (isZodError(error)) {
        throw hostError('invalid_request', 'Workspace Host operation payload is invalid.', false, {
          issues: error.issues
        })
      }
      throw error
    }
  }

  #isOwnedOperation(operation: WorkspaceHostOperation): boolean {
    return [
      WORKSPACE_HOST_OPERATIONS.health,
      WORKSPACE_HOST_OPERATIONS.status,
      WORKSPACE_HOST_OPERATIONS.directoryList,
      WORKSPACE_HOST_OPERATIONS.fileStat,
      WORKSPACE_HOST_OPERATIONS.fileRead,
      WORKSPACE_HOST_OPERATIONS.fileReadRange,
      WORKSPACE_HOST_OPERATIONS.fileWrite,
      WORKSPACE_HOST_OPERATIONS.fileWatch,
      WORKSPACE_HOST_OPERATIONS.fileUnwatch,
      WORKSPACE_HOST_OPERATIONS.textSearch,
      WORKSPACE_HOST_OPERATIONS.processCreate,
      WORKSPACE_HOST_OPERATIONS.processRead,
      WORKSPACE_HOST_OPERATIONS.processWrite,
      WORKSPACE_HOST_OPERATIONS.processResize,
      WORKSPACE_HOST_OPERATIONS.processDispose,
      WORKSPACE_HOST_OPERATIONS.versionControlStatus,
      WORKSPACE_HOST_OPERATIONS.versionControlDiff
    ].includes(operation as never)
  }

  health(): JsonRecord {
    return {
      ok: true,
      serverVersion: WORKSPACE_HOST_SERVER_VERSION,
      sessionId: this.sessionId,
      serverInstanceId: this.serverInstanceId,
      platform: this.platform,
      architecture: this.architecture,
      lifecycleMode: this.lifecycleMode,
      latestSequence: this.journal.latestSeq
    }
  }

  lifecycleStatus(): JsonRecord {
    return {
      mode: this.lifecycleMode,
      persistent: this.lifecycleMode === 'persistent-daemon',
      ...(this.lifecycleReason ? { reason: this.lifecycleReason } : {}),
      capabilities: this.capabilities.map((capability) => ({ ...capability }))
    }
  }

  async workspaceStat(input: { path: string }): Promise<JsonRecord> {
    const path = normalizeWorkspacePath(input.path)
    const absolutePath = await this.resolveExisting(path)
    const fileStat = await stat(absolutePath)
    return { entry: statOutput(path, fileStat) }
  }

  async workspaceList(input: WorkspaceHostDirectoryListInput): Promise<JsonRecord> {
    const path = normalizeWorkspacePath(input.path)
    const absolutePath = await this.resolveDirectory(path)
    const limit = input.limit ?? 1_000
    const offset = parseListCursor(input.cursor)
    const directoryEntries = await readdir(absolutePath, { withFileTypes: true })
    directoryEntries.sort((left, right) => left.name.localeCompare(right.name))
    const selected = directoryEntries.slice(offset, offset + limit)
    const entries = await Promise.all(selected.map(async (entry) => {
      const childPath = path === '.' ? entry.name : `${path}/${entry.name}`
      const childStat = await lstat(resolve(absolutePath, entry.name))
      return statOutput(childPath, childStat, entry.name)
    }))
    return {
      entries,
      ...(offset + selected.length < directoryEntries.length
        ? { nextCursor: String(offset + selected.length) }
        : {})
    }
  }

  async workspaceRead(input: WorkspaceHostFileReadInput): Promise<JsonRecord> {
    const path = normalizeWorkspacePath(input.path)
    return this.readFileRange(
      path,
      0,
      input.maxBytes ?? WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes
    )
  }

  async workspaceReadRange(input: WorkspaceHostFileReadRangeInput): Promise<JsonRecord> {
    const path = normalizeWorkspacePath(input.path)
    return this.readFileRange(path, input.offset, input.length)
  }

  async readFileRange(
    path: string,
    offset: number,
    length: number
  ): Promise<JsonRecord> {
    const absolutePath = await this.resolveExistingFile(path)
    const handle = await open(absolutePath, 'r')
    try {
      const fileStat = await handle.stat()
      const bytesToRead = Math.min(length, Math.max(0, fileStat.size - offset))
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset)
      return {
        contentBase64: buffer.subarray(0, bytesRead).toString('base64'),
        bytesRead,
        revision: fileRevision(fileStat),
        truncated: offset + bytesRead < fileStat.size
      }
    } finally {
      await handle.close()
    }
  }

  async workspaceWrite(input: WorkspaceHostFileWriteInput): Promise<JsonRecord> {
    const path = normalizeWorkspacePath(input.path)
    const content = decodeBoundedBase64(input.contentBase64)
    const candidate = resolve(this.workspaceRoot, path)
    const parent = await this.resolveDirectory(relativePathParent(path))
    assertContained(this.workspaceRoot, candidate)
    let current: Stats | undefined
    try {
      const linkStat = await lstat(candidate)
      if (linkStat.isSymbolicLink()) {
        throw hostError('path_outside_workspace', 'Writes through symbolic links are not allowed.')
      }
      current = await stat(candidate)
      if (!current.isFile()) {
        throw hostError('invalid_file_type', 'Workspace write target must be a regular file.')
      }
    } catch (error) {
      if (!isFileNotFound(error)) throw error
    }
    if (!current && !input.create) {
      throw hostError('not_found', 'Workspace write target does not exist.')
    }
    const currentRevision = current ? fileRevision(current) : undefined
    if (
      (current && input.expectedRevision !== currentRevision)
      || (!current && input.expectedRevision !== undefined)
    ) {
      throw hostError('revision_conflict', 'Workspace file changed; reload before saving.', false, {
        expectedRevision: input.expectedRevision ?? null,
        currentRevision: currentRevision ?? null
      })
    }
    const temporaryPath = resolve(parent, `.${randomUUID()}.sciforge-write`)
    const handle = await open(temporaryPath, 'wx', current ? current.mode & 0o777 : 0o600)
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      // Close the read/write race as far as an atomic path replacement permits.
      let beforeRenameRevision: string | undefined
      try {
        beforeRenameRevision = fileRevision(await stat(candidate))
      } catch (error) {
        if (!isFileNotFound(error)) throw error
      }
      if (beforeRenameRevision !== currentRevision) {
        throw hostError('revision_conflict', 'Workspace file changed during save.', false, {
          expectedRevision: currentRevision ?? null,
          currentRevision: beforeRenameRevision ?? null
        })
      }
      await rename(temporaryPath, candidate)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    const writtenStat = await stat(candidate)
    const revision = fileRevision(writtenStat)
    this.publishEvent(WORKSPACE_HOST_EVENT_KINDS.fileChanged, {
      path,
      revision,
      kind: current ? 'updated' : 'created'
    })
    return {
      size: writtenStat.size,
      revision,
      mtimeMs: writtenStat.mtimeMs
    }
  }

  async workspaceWatch(input: {
    path: string
    recursive: boolean
  }): Promise<JsonRecord> {
    if (input.recursive && this.platform === 'linux') {
      throw hostError(
        'unsupported_operation',
        'Recursive filesystem watch is unavailable on Linux; watch directories individually.'
      )
    }
    const path = normalizeWorkspacePath(input.path)
    const absolutePath = await this.resolveExisting(path)
    const watchId = randomUUID()
    const watcher = watch(absolutePath, { recursive: input.recursive }, (eventType, filename) => {
      const relativeName = typeof filename === 'string'
        ? filename.split(sep).join('/')
        : undefined
      const eventPath = relativeName
        ? path === '.' ? relativeName : `${path}/${relativeName}`
        : path
      this.publishEvent(WORKSPACE_HOST_EVENT_KINDS.fileChanged, {
        watchId,
        path: eventPath,
        change: eventType
      })
    })
    watcher.once('error', (error) => {
      this.#watchers.delete(watchId)
      this.publishEvent(WORKSPACE_HOST_EVENT_KINDS.fileChanged, {
        watchId,
        path,
        change: 'watch-error',
        message: error.message
      })
    })
    this.#watchers.set(watchId, watcher)
    return {
      watchId,
      sequence: this.journal.latestSeq
    }
  }

  workspaceUnwatch(input: { watchId: string }): JsonRecord {
    const watcher = this.#watchers.get(input.watchId)
    if (!watcher) {
      throw hostError('not_found', 'Workspace filesystem watch does not exist.')
    }
    watcher.close()
    this.#watchers.delete(input.watchId)
    return { ok: true }
  }

  async workspaceSearch(input: WorkspaceHostTextSearchInput): Promise<JsonRecord> {
    const path = normalizeWorkspacePath(input.path ?? '.')
    const absolutePath = await this.resolveDirectory(path)
    const limit = input.maxResults ?? 1_000
    const args = [
      '--json',
      '--line-number',
      '--column',
      '--color=never',
      ...(input.caseSensitive ? ['--case-sensitive'] : ['--ignore-case']),
      ...(input.glob ? ['--glob', input.glob] : []),
      '--',
      input.query,
      absolutePath
    ]
    const result = await runBoundedCommand('rg', args, {
      cwd: this.workspaceRoot,
      maxBytes: MAX_SEARCH_OUTPUT_BYTES,
      acceptedExitCodes: [0, 1]
    })
    const matches: JsonRecord[] = []
    for (const line of result.stdout.split('\n')) {
      if (!line || matches.length >= limit) break
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        continue
      }
      const match = parseRipgrepMatch(value, this.workspaceRoot)
      if (match) matches.push(match)
    }
    return {
      matches,
      truncated: result.truncated || matches.length >= limit
    }
  }

  async gitStatus(): Promise<JsonRecord> {
    const result = await runBoundedCommand(
      'git',
      ['-C', this.workspaceRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      {
        cwd: this.workspaceRoot,
        maxBytes: MAX_GIT_OUTPUT_CHARACTERS,
        acceptedExitCodes: [0]
      }
    )
    const changes = parseGitStatus(result.stdout)
    return {
      revision: createHash('sha256')
        .update(`${await gitHead(this.workspaceRoot)}\0${result.stdout}`)
        .digest('hex'),
      clean: changes.length === 0,
      changes,
      truncated: result.truncated
    }
  }

  async gitDiff(input: VersionControlDiffInput): Promise<JsonRecord> {
    const maxCharacters = input.maxCharacters
      ?? MAX_GIT_OUTPUT_CHARACTERS
    const args = ['-C', this.workspaceRoot, 'diff', '--no-ext-diff', '--no-color']
    if (input.from && input.to) args.push(input.from, input.to)
    else if (input.from) args.push(input.from)
    if (input.paths?.length) {
      args.push('--', ...input.paths.map(normalizeWorkspacePath))
    }
    const result = await runBoundedCommand('git', args, {
      cwd: this.workspaceRoot,
      maxBytes: maxCharacters,
      acceptedExitCodes: [0]
    })
    return {
      text: result.stdout,
      truncated: result.truncated
    }
  }

  async processCreate(input: {
    profile: 'system-shell'
    cwd?: string
    terminal?: { columns: number; rows: number }
  }): Promise<JsonRecord> {
    const executable = await resolveSystemShell()
    return this.processes.create({
      argv: [executable, '-l'],
      cwd: input.cwd,
      terminal: input.terminal
    })
  }

  async resolveExisting(path: string): Promise<string> {
    const normalized = normalizeWorkspacePath(path)
    const resolved = await realpath(resolve(this.workspaceRoot, normalized))
    assertContained(this.workspaceRoot, resolved)
    return resolved
  }

  async resolveExistingFile(path: string): Promise<string> {
    const resolved = await this.resolveExisting(path)
    if (!(await stat(resolved)).isFile()) {
      throw hostError('invalid_file_type', 'Workspace path must name a regular file.')
    }
    return resolved
  }

  async resolveDirectory(path: string): Promise<string> {
    const resolved = await this.resolveExisting(path)
    if (!(await stat(resolved)).isDirectory()) {
      throw hostError('invalid_file_type', 'Workspace path must name a directory.')
    }
    return resolved
  }

  dispose(): void {
    for (const watcher of this.#watchers.values()) watcher.close()
    this.#watchers.clear()
    this.processes.disposeAll()
    this.processes.configureProxyEnvironment(undefined)
    this.configureModelAccess(undefined)
    this.journal.clearListeners()
  }

  configureProcessProxyEnvironment(
    environment: NodeJS.ProcessEnv | undefined,
    expiresAt?: string
  ): void {
    if (this.#processEnvironmentExpiryTimer) {
      clearTimeout(this.#processEnvironmentExpiryTimer)
      this.#processEnvironmentExpiryTimer = undefined
    }
    this.processes.configureProxyEnvironment(environment, expiresAt)
    this.#notifyProcessEnvironmentChanged()
    this.#scheduleProcessEnvironmentExpiry(environment, expiresAt)
  }

  renewProcessProxyEnvironment(expiresAt: string): boolean {
    if (!this.processes.renewProxyEnvironment(expiresAt)) return false
    if (this.#processEnvironmentExpiryTimer) {
      clearTimeout(this.#processEnvironmentExpiryTimer)
      this.#processEnvironmentExpiryTimer = undefined
    }
    this.#notifyProcessEnvironmentChanged()
    this.#scheduleProcessEnvironmentExpiry(
      this.processes.currentEnvironment(),
      expiresAt
    )
    return true
  }

  configureModelAccess(access: WorkspaceHostModelAccess | undefined): void {
    if (this.#modelAccessExpiryTimer) {
      clearTimeout(this.#modelAccessExpiryTimer)
      this.#modelAccessExpiryTimer = undefined
    }
    this.#modelAccess = access
      ? workspaceHostModelAccessSchema.parse(access)
      : undefined
    this.#notifyModelAccessChanged()
    this.#scheduleModelAccessExpiry()
  }

  renewModelAccess(expiresAt: string): boolean {
    const expiresAtMs = Date.parse(expiresAt)
    if (
      !this.#modelAccess
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= Date.now()
    ) {
      return false
    }
    if (this.#modelAccessExpiryTimer) {
      clearTimeout(this.#modelAccessExpiryTimer)
      this.#modelAccessExpiryTimer = undefined
    }
    this.#modelAccess = {
      ...this.#modelAccess,
      expiresAt
    }
    this.#notifyModelAccessChanged()
    this.#scheduleModelAccessExpiry()
    return true
  }

  currentModelAccess(): WorkspaceHostModelAccess | undefined {
    if (!this.isModelAccessReady() || !this.#modelAccess) return undefined
    return {
      ...this.#modelAccess,
      authorization: { ...this.#modelAccess.authorization }
    }
  }

  isModelAccessReady(): boolean {
    if (!this.#modelAccess) return false
    const expiresAtMs = Date.parse(this.#modelAccess.expiresAt)
    return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()
  }

  #notifyProcessEnvironmentChanged(): void {
    this.#processEnvironmentGeneration += 1
    const current = this.processes.currentEnvironment()
    for (const registration of this.#operationHandlers.values()) {
      if (!registration.onProcessEnvironmentChanged) continue
      void Promise.resolve(registration.onProcessEnvironmentChanged(
        { ...current },
        this.#processEnvironmentGeneration,
        this.processes.isNetworkEgressReady()
      )).catch(() => undefined)
    }
  }

  #scheduleProcessEnvironmentExpiry(
    environment: NodeJS.ProcessEnv | undefined,
    expiresAt?: string
  ): void {
    const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN
    if (environment && Number.isFinite(expiresAtMs)) {
      this.#processEnvironmentExpiryTimer = setTimeout(() => {
        this.#processEnvironmentExpiryTimer = undefined
        this.#notifyProcessEnvironmentChanged()
      }, Math.max(0, expiresAtMs - Date.now()))
      this.#processEnvironmentExpiryTimer.unref()
    }
  }

  #notifyModelAccessChanged(): void {
    this.#modelAccessGeneration += 1
    const current = this.currentModelAccess()
    const ready = this.isModelAccessReady()
    for (const registration of this.#operationHandlers.values()) {
      if (!registration.onModelAccessChanged) continue
      void Promise.resolve(registration.onModelAccessChanged(
        current,
        this.#modelAccessGeneration,
        ready
      )).catch(() => undefined)
    }
  }

  #scheduleModelAccessExpiry(): void {
    if (!this.#modelAccess) return
    const expiresAtMs = Date.parse(this.#modelAccess.expiresAt)
    if (!Number.isFinite(expiresAtMs)) return
    this.#modelAccessExpiryTimer = setTimeout(() => {
      this.#modelAccessExpiryTimer = undefined
      this.#notifyModelAccessChanged()
    }, Math.max(0, expiresAtMs - Date.now()))
    this.#modelAccessExpiryTimer.unref()
  }
}

export class WorkspaceHostServiceError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details?: WorkspaceHostPayload

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: WorkspaceHostPayload
  ) {
    super(message)
    this.name = 'WorkspaceHostServiceError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

function hostError(
  code: string,
  message: string,
  retryable = false,
  details?: WorkspaceHostPayload
): WorkspaceHostServiceError {
  return new WorkspaceHostServiceError(code, message, retryable, details)
}

function normalizeWorkspacePath(path: string): string {
  if (!path || path.includes('\0') || path.includes('\\') || isAbsolute(path)) {
    throw hostError('path_outside_workspace', 'Workspace paths must be relative POSIX paths.')
  }
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '') || '.'
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..')) {
    throw hostError('path_outside_workspace', 'Workspace path cannot contain parent traversal.')
  }
  return parts.filter((part) => part !== '.' && part !== '').join('/') || '.'
}

function assertContained(root: string, candidate: string): void {
  const child = relative(root, candidate)
  if (child === '') return
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw hostError('path_outside_workspace', 'Workspace path escapes its authorized root.')
  }
}

function relativePathParent(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '.' : path.slice(0, slash) || '.'
}

function statOutput(path: string, value: Stats, name?: string): WorkspaceHostFileEntry {
  return {
    name: name ?? (path === '.' ? '.' : path.slice(path.lastIndexOf('/') + 1)),
    path,
    kind: value.isDirectory()
      ? 'directory'
      : value.isFile()
        ? 'file'
        : value.isSymbolicLink()
          ? 'symbolic-link'
          : 'other',
    size: value.size,
    mtimeMs: value.mtimeMs,
    revision: fileRevision(value)
  }
}

function fileRevision(value: Stats): string {
  return createHash('sha256')
    .update([
      value.dev,
      value.ino,
      value.mode,
      value.size,
      value.mtimeMs,
      value.ctimeMs
    ].join(':'))
    .digest('hex')
}

function decodeBoundedBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw hostError('invalid_request', 'contentBase64 must use canonical base64 encoding.')
  }
  const content = Buffer.from(value, 'base64')
  if (
    content.byteLength > WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes
    || content.toString('base64') !== value
  ) {
    throw hostError('payload_too_large', 'Workspace write content exceeds its bound.')
  }
  return content
}

function parseListCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw hostError('invalid_request', 'Directory cursor must be a non-negative integer.')
  }
  const value = Number(cursor)
  if (!Number.isSafeInteger(value)) {
    throw hostError('invalid_request', 'Directory cursor is outside the supported range.')
  }
  return value
}

async function resolveSystemShell(): Promise<string> {
  const configured = process.env.SHELL
  const candidates = [
    ...(configured && isAbsolute(configured) && !configured.includes('\0') ? [configured] : []),
    '/bin/bash',
    '/bin/sh'
  ]
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Try the next trusted server-side executable.
    }
  }
  throw hostError('capability_unavailable', 'No executable system shell is available.')
}

type BoundedCommandResult = {
  stdout: string
  stderr: string
  truncated: boolean
}

async function runBoundedCommand(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string
    maxBytes: number
    acceptedExitCodes: readonly number[]
  }
): Promise<BoundedCommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    const append = (target: Buffer[], value: Buffer, isStdout: boolean): void => {
      const current = isStdout ? stdoutBytes : stderrBytes
      const remaining = Math.max(0, options.maxBytes - current)
      if (value.byteLength > remaining) truncated = true
      if (remaining > 0) target.push(value.subarray(0, remaining))
      if (isStdout) stdoutBytes += Math.min(value.byteLength, remaining)
      else stderrBytes += Math.min(value.byteLength, remaining)
      if (truncated) child.kill('SIGTERM')
    }
    child.stdout.on('data', (value: Buffer) => append(stdout, value, true))
    child.stderr.on('data', (value: Buffer) => append(stderr, value, false))
    child.once('error', (error) => {
      rejectCommand(hostError(
        isFileNotFound(error)
          ? 'capability_unavailable'
          : 'process_failed',
        `${executable} could not be started: ${error.message}`
      ))
    })
    child.once('close', (code, signal) => {
      const output = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated
      }
      if (
        (code !== null && options.acceptedExitCodes.includes(code))
        || (truncated && signal === 'SIGTERM')
      ) {
        resolveCommand(output)
        return
      }
      rejectCommand(hostError('process_failed', `${executable} exited unsuccessfully.`, false, {
        code,
        signal,
        stderr: output.stderr.slice(0, 4_096)
      }))
    })
  })
}

function parseRipgrepMatch(value: unknown, workspaceRoot: string): JsonRecord | undefined {
  if (!isRecord(value) || value.type !== 'match' || !isRecord(value.data)) return undefined
  const path = textField(value.data.path)
  const lines = textField(value.data.lines)
  const lineNumber = value.data.line_number
  const submatches = value.data.submatches
  if (
    !path
    || !lines
    || typeof lineNumber !== 'number'
    || !Array.isArray(submatches)
  ) return undefined
  const first = submatches[0]
  return {
    path: normalizeResultPath(workspaceRoot, path),
    line: lineNumber,
    column: isRecord(first) && typeof first.start === 'number' ? first.start + 1 : 1,
    preview: lines.replace(/\r?\n$/, '').slice(0, 20_000)
  }
}

function textField(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return typeof value.text === 'string' ? value.text : undefined
}

function normalizeResultPath(root: string, path: string): string {
  const workspaceRelative = relative(root, path).split(sep).join('/')
  return normalizeWorkspacePath(workspaceRelative)
}

function parseGitStatus(value: string): JsonRecord[] {
  const records = value.split('\0').filter(Boolean)
  const changes: JsonRecord[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    if (record.length < 4) continue
    const code = record.slice(0, 2)
    const path = record.slice(3)
    const renamed = code.includes('R') || code.includes('C')
    const previousPath = renamed ? records[++index] : undefined
    changes.push({
      path: normalizeWorkspacePath(path),
      status: gitStatusName(code),
      ...(previousPath ? { previousPath: normalizeWorkspacePath(previousPath) } : {})
    })
  }
  return changes
}

function gitStatusName(code: string): string {
  if (code === '??') return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted'
  if (code.includes('R')) return 'renamed'
  if (code.includes('C')) return 'copied'
  if (code.includes('A')) return 'added'
  if (code.includes('D')) return 'deleted'
  return 'modified'
}

async function gitHead(workspaceRoot: string): Promise<string | null> {
  try {
    const result = await runBoundedCommand(
      'git',
      ['-C', workspaceRoot, 'rev-parse', '--verify', 'HEAD'],
      { cwd: workspaceRoot, maxBytes: 1_024, acceptedExitCodes: [0] }
    )
    return result.stdout.trim() || null
  } catch (error) {
    if (
      error instanceof WorkspaceHostServiceError
      && error.code === 'process_failed'
    ) return null
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isZodError(value: unknown): value is {
  issues: WorkspaceHostPayload[]
} {
  return isRecord(value) && Array.isArray(value.issues)
}

function isFileNotFound(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value && value.code === 'ENOENT'
}
