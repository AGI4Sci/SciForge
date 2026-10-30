import { spawn, type ChildProcess } from 'node:child_process'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  basename,
  delimiter,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  LSP_STATUS_RESOURCE_URI,
  type LspOperation,
  type LspQueryResult,
  type LspStatusResult,
  type LspSessionSummary,
  type RuntimeDependency,
  type RuntimeInspectorFailure,
  type RuntimeInspectorErrorCode
} from './contract.js'

export type RuntimeInspectorLspServiceOptions = {
  env: NodeJS.ProcessEnv
  serverCommand?: string
  serverArgs?: string[]
  requestTimeoutMs?: number
  cleanupDelayMs?: number
}

type LspSessionManagerOptions = {
  env: NodeJS.ProcessEnv
  serverCommand?: string
  serverArgs?: string[]
  requestTimeoutMs: number
  cleanupDelayMs: number
}

export type LspQueryRequest = {
  workspace_root: string
  operation: LspOperation
  file_path?: string
  line?: number
  character?: number
  query?: string
  unsaved_buffer_policy?: 'reject'
}

export type LspQuerySuccess = {
  operation: LspOperation
  workspaceRoot: string
  filePath?: string
  query?: string
  result: unknown
  unsavedBufferPolicy: 'reject'
  languageServer: {
    name: 'typescript-language-server'
    command: string
    pid?: number
    sessionReused: boolean
  }
}

type LspCommand = {
  command: string
  args: string[]
}

type LspSessionEntry = {
  promise: Promise<LspSession>
  session?: LspSession
}

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  abortListener?: () => void
  signal?: AbortSignal
}

type LspSession = {
  process: ChildProcess
  workspaceRoot: string
  command: LspCommand
  refCount: number
  cleanupTimer: ReturnType<typeof setTimeout> | null
  stdoutBuffer: Buffer
  pending: Map<string, PendingRequest>
  openDocuments: Map<string, number>
  nextId: number
  initialized: boolean
  initPromise: Promise<void> | null
  closed: boolean
  startedAt: string
  lastUsedAt: string
}

type RequestOptions = {
  signal?: AbortSignal
  timeoutMs: number
}

const POSITION_REQUIRED = new Set<LspOperation>([
  'goToDefinition',
  'findReferences',
  'hover',
  'goToImplementation'
])
const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_CLEANUP_DELAY_MS = 30_000
const MAX_REQUEST_TIMEOUT_MS = 30_000

export class RuntimeInspectorLspService {
  private readonly manager: TypeScriptLanguageServerManager
  private readonly env: NodeJS.ProcessEnv
  private readonly serverCommand?: string
  private readonly serverArgs?: string[]

  constructor(options: RuntimeInspectorLspServiceOptions) {
    this.env = options.env
    this.serverCommand = cleanOptionalString(options.serverCommand)
    this.serverArgs = options.serverArgs
    this.manager = new TypeScriptLanguageServerManager({
      env: options.env,
      ...(this.serverCommand ? { serverCommand: this.serverCommand, serverArgs: this.serverArgs } : {}),
      requestTimeoutMs: clampInteger(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 250, MAX_REQUEST_TIMEOUT_MS),
      cleanupDelayMs: clampInteger(options.cleanupDelayMs ?? DEFAULT_CLEANUP_DELAY_MS, 250, 10 * 60_000)
    })
  }

  async dependency(workspaceRoot: string | undefined): Promise<RuntimeDependency> {
    return lspDependency(workspaceRoot, this.env, this.commandOverride())
  }

  async status(workspaceRoot: string | undefined, includeDependencyProbe: boolean): Promise<LspStatusResult> {
    const dependency = await this.dependency(workspaceRoot)
    const snapshot = this.manager.status(workspaceRoot)
    const running = workspaceRoot
      ? snapshot.workspaceActiveSession !== undefined
      : snapshot.activeSessionCount > 0
    const available = dependency.available
    return {
      ok: true,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      status: running ? 'running' : available ? 'available' : 'unavailable',
      available,
      lifecycle: {
        mode: 'per_workspace',
        longLivedServerStarted: snapshot.activeSessionCount > 0,
        activeSessionCount: snapshot.activeSessionCount,
        cleanupPolicy: 'ref_counted_delayed_shutdown',
        cleanupDelayMs: snapshot.cleanupDelayMs,
        requestTimeoutMs: snapshot.requestTimeoutMs,
        sessions: snapshot.sessions,
        ...(snapshot.workspaceActiveSession ? { workspaceActiveSession: snapshot.workspaceActiveSession } : {})
      },
      boundaries: {
        unsavedBuffers: 'rejected',
        fileSource: 'saved_files_only',
        realLanguageServer: running ? 'running' : available ? 'available' : 'missing'
      },
      ...(includeDependencyProbe ? { dependency } : {}),
      resourceUri: LSP_STATUS_RESOURCE_URI
    }
  }

  async query(input: LspQueryRequest, options: { signal?: AbortSignal } = {}): Promise<LspQueryResult> {
    try {
      return {
        ok: true,
        ...await this.manager.query(input, options)
      }
    } catch (error) {
      return failureFromLspError(error)
    }
  }

  shutdown(): void {
    this.manager.shutdown()
  }

  private commandOverride(): LspCommand | undefined {
    return this.serverCommand
      ? { command: this.serverCommand, args: this.serverArgs ?? ['--stdio'] }
      : undefined
  }
}

export class TypeScriptLanguageServerManager {
  private readonly sessions = new Map<string, LspSessionEntry>()
  private readonly env: NodeJS.ProcessEnv
  private readonly commandOverride?: LspCommand
  private readonly requestTimeoutMs: number
  private readonly cleanupDelayMs: number

  constructor(options: LspSessionManagerOptions) {
    this.env = options.env
    this.commandOverride = options.serverCommand
      ? { command: options.serverCommand, args: options.serverArgs ?? ['--stdio'] }
      : undefined
    this.requestTimeoutMs = options.requestTimeoutMs
    this.cleanupDelayMs = options.cleanupDelayMs
  }

  async query(input: LspQueryRequest, options: { signal?: AbortSignal } = {}): Promise<LspQuerySuccess> {
    throwIfAborted(options.signal)
    const workspaceRoot = await resolveExistingWorkspaceRoot(input.workspace_root)
    const filePath = input.operation === 'workspaceSymbol'
      ? undefined
      : await resolveWorkspaceFile(requiredFilePath(input), workspaceRoot)

    if (filePath && !isTsJsFile(filePath)) {
      throw lspError(
        'unsupported_language',
        'LSP code navigation currently supports TypeScript and JavaScript files only.',
        false,
        'Choose a .ts, .tsx, .js, .jsx, .mjs, .cjs, .mts, or .cts file.',
        { filePath }
      )
    }
    if (POSITION_REQUIRED.has(input.operation) && (!positive(input.line) || !positive(input.character))) {
      throw lspError(
        'invalid_request',
        `${input.operation} requires 1-based line and character.`,
        false,
        'Pass line and character as positive integers.'
      )
    }

    const { session, reused } = await this.acquire(workspaceRoot, options.signal)
    try {
      let rawResult: unknown
      if (filePath) await this.openDocument(session, filePath, options)
      switch (input.operation) {
        case 'goToDefinition':
          rawResult = await this.positionRequest(session, 'textDocument/definition', filePath!, input, options)
          break
        case 'findReferences':
          rawResult = await this.positionRequest(session, 'textDocument/references', filePath!, input, options, {
            context: { includeDeclaration: true }
          })
          break
        case 'hover':
          rawResult = await this.positionRequest(session, 'textDocument/hover', filePath!, input, options)
          break
        case 'documentSymbol':
          rawResult = await this.request(session, 'textDocument/documentSymbol', {
            textDocument: { uri: pathToFileURL(filePath!).href }
          }, requestOptions(options.signal, this.requestTimeoutMs))
          break
        case 'workspaceSymbol':
          rawResult = await this.request(session, 'workspace/symbol', {
            query: input.query?.trim() ?? ''
          }, requestOptions(options.signal, this.requestTimeoutMs))
          break
        case 'goToImplementation':
          rawResult = await this.positionRequest(session, 'textDocument/implementation', filePath!, input, options)
          break
      }
      return {
        operation: input.operation,
        workspaceRoot,
        ...(filePath ? { filePath } : {}),
        ...(input.operation === 'workspaceSymbol' ? { query: input.query?.trim() ?? '' } : {}),
        result: simplifyResult(rawResult),
        unsavedBufferPolicy: 'reject',
        languageServer: {
          name: 'typescript-language-server',
          command: session.command.command,
          ...(session.process.pid ? { pid: session.process.pid } : {}),
          sessionReused: reused
        }
      }
    } finally {
      if (filePath) this.closeDocument(session, filePath)
      this.release(workspaceRoot)
    }
  }

  status(workspaceRoot?: string): {
    activeSessionCount: number
    sessions: LspSessionSummary[]
    cleanupDelayMs: number
    requestTimeoutMs: number
    workspaceActiveSession?: LspSessionSummary
  } {
    const sessions = [...this.sessions.values()]
      .map((entry) => entry.session)
      .filter((session): session is LspSession => session !== undefined && !session.closed)
      .map(sessionSummary)
    const workspaceActiveSession = workspaceRoot
      ? sessions.find((session) => samePath(session.workspaceRoot, workspaceRoot))
      : undefined
    return {
      activeSessionCount: sessions.length,
      sessions,
      cleanupDelayMs: this.cleanupDelayMs,
      requestTimeoutMs: this.requestTimeoutMs,
      ...(workspaceActiveSession ? { workspaceActiveSession } : {})
    }
  }

  shutdown(): void {
    for (const entry of this.sessions.values()) {
      if (entry.session) terminateSession(entry.session)
      else void entry.promise.then(terminateSession).catch(() => undefined)
    }
    this.sessions.clear()
  }

  private async acquire(workspaceRoot: string, signal?: AbortSignal): Promise<{ session: LspSession; reused: boolean }> {
    throwIfAborted(signal)
    const existing = this.sessions.get(workspaceRoot)
    if (existing) {
      const session = existing.session ?? await existing.promise
      if (!session.closed) {
        if (session.cleanupTimer) {
          clearTimeout(session.cleanupTimer)
          session.cleanupTimer = null
        }
        session.refCount += 1
        session.lastUsedAt = new Date().toISOString()
        await this.initialize(session, signal)
        return { session, reused: true }
      }
      this.sessions.delete(workspaceRoot)
    }

    const entry: LspSessionEntry = {
      promise: Promise.reject(new Error('LSP session not initialized'))
    }
    entry.promise.catch(() => undefined)
    entry.promise = this.createSession(workspaceRoot, () => {
      if (this.sessions.get(workspaceRoot) === entry) this.sessions.delete(workspaceRoot)
    }, signal).then((session) => {
      entry.session = session
      return session
    })
    this.sessions.set(workspaceRoot, entry)
    try {
      return { session: await entry.promise, reused: false }
    } catch (error) {
      if (this.sessions.get(workspaceRoot) === entry) this.sessions.delete(workspaceRoot)
      throw error
    }
  }

  private release(workspaceRoot: string): void {
    const entry = this.sessions.get(workspaceRoot)
    if (!entry) return
    void entry.promise.then((session) => {
      session.refCount = Math.max(0, session.refCount - 1)
      session.lastUsedAt = new Date().toISOString()
      if (session.refCount > 0 || session.cleanupTimer || session.closed) return
      session.cleanupTimer = setTimeout(() => {
        if (session.refCount === 0) {
          terminateSession(session)
          if (this.sessions.get(workspaceRoot) === entry) this.sessions.delete(workspaceRoot)
        }
      }, this.cleanupDelayMs)
      session.cleanupTimer.unref?.()
    }).catch(() => undefined)
  }

  private async createSession(workspaceRoot: string, onClose: () => void, signal?: AbortSignal): Promise<LspSession> {
    const command = await resolveTypeScriptLanguageServerCommand(workspaceRoot, this.env, this.commandOverride)
    if (!command) {
      throw lspError(
        'language_server_missing',
        'typescript-language-server is not installed for this workspace.',
        false,
        'Install typescript-language-server and typescript in the workspace, or ensure typescript-language-server is available on PATH.'
      )
    }
    throwIfAborted(signal)
    const batch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command.command)
    if (batch && [command.command, ...command.args].some((value) => /[&|<>^%!"\r\n]/.test(value))) {
      throw new Error('Language server command contains unsupported command processor characters.')
    }
    const child = spawn(batch ? (this.env.ComSpec || process.env.ComSpec || 'cmd.exe') : command.command,
      batch ? ['/d', '/s', '/c', `""${command.command}" ${command.args.map((arg) => `"${arg}"`).join(' ')}"`] : command.args, {
      cwd: workspaceRoot,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: batch
    })
    const now = new Date().toISOString()
    const session: LspSession = {
      process: child,
      workspaceRoot,
      command,
      refCount: 1,
      cleanupTimer: null,
      stdoutBuffer: Buffer.alloc(0),
      pending: new Map(),
      openDocuments: new Map(),
      nextId: 1,
      initialized: false,
      initPromise: null,
      closed: false,
      startedAt: now,
      lastUsedAt: now
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      session.stdoutBuffer = Buffer.concat([session.stdoutBuffer, chunk])
      processBuffer(session)
    })
    child.stderr?.on('data', () => {
      // Language servers may log diagnostics on stderr; keep protocol handling on stdout.
    })
    child.on('error', (error) => {
      session.closed = true
      rejectPending(session, lspError('lsp_session_closed', error.message, true, 'Retry the LSP request; the worker will start a fresh language server session.'))
      onClose()
    })
    child.on('exit', () => {
      session.closed = true
      rejectPending(session, lspError('lsp_session_closed', 'LSP session exited.', true, 'Retry the LSP request; the worker will start a fresh language server session.'))
      onClose()
    })

    try {
      await this.initialize(session, signal)
      return session
    } catch (error) {
      terminateSession(session)
      throw error
    }
  }

  private async initialize(session: LspSession, signal?: AbortSignal): Promise<void> {
    if (session.initialized) return
    if (session.initPromise) return session.initPromise
    session.initPromise = (async () => {
      await this.request(session, 'initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(session.workspaceRoot).href,
        workspaceFolders: [{
          uri: pathToFileURL(session.workspaceRoot).href,
          name: basename(session.workspaceRoot)
        }],
        capabilities: {
          textDocument: {
            synchronization: { didOpen: true, didClose: true, didChange: false, willSave: false },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: false },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            implementation: {}
          },
          workspace: { symbol: {} }
        }
      }, requestOptions(signal, this.requestTimeoutMs))
      sendNotification(session, 'initialized', {})
      session.initialized = true
    })()
    return session.initPromise
  }

  private async openDocument(session: LspSession, filePath: string, options: { signal?: AbortSignal }): Promise<void> {
    throwIfAborted(options.signal)
    const openCount = session.openDocuments.get(filePath) ?? 0
    session.openDocuments.set(filePath, openCount + 1)
    if (openCount > 0) return
    const text = await readFile(filePath, 'utf8')
    sendNotification(session, 'textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(filePath).href,
        languageId: languageId(filePath),
        version: 1,
        text
      }
    })
  }

  private closeDocument(session: LspSession, filePath: string): void {
    const openCount = session.openDocuments.get(filePath) ?? 0
    if (openCount > 1) {
      session.openDocuments.set(filePath, openCount - 1)
      return
    }
    session.openDocuments.delete(filePath)
    if (!session.closed) {
      sendNotification(session, 'textDocument/didClose', {
        textDocument: { uri: pathToFileURL(filePath).href }
      })
    }
  }

  private positionRequest(
    session: LspSession,
    method: string,
    filePath: string,
    input: LspQueryRequest,
    options: { signal?: AbortSignal },
    extra?: Record<string, unknown>
  ): Promise<unknown> {
    return this.request(session, method, {
      textDocument: { uri: pathToFileURL(filePath).href },
      position: {
        line: Math.max(0, (input.line ?? 1) - 1),
        character: Math.max(0, (input.character ?? 1) - 1)
      },
      ...extra
    }, requestOptions(options.signal, this.requestTimeoutMs))
  }

  private request(
    session: LspSession,
    method: string,
    params: Record<string, unknown>,
    options: RequestOptions
  ): Promise<unknown> {
    if (session.closed) {
      return Promise.reject(lspError('lsp_session_closed', 'LSP session is closed.', true, 'Retry the LSP request; the worker will start a fresh language server session.'))
    }
    throwIfAborted(options.signal)

    return new Promise((resolvePromise, rejectPromise) => {
      const id = String(session.nextId++)
      const reject = (error: Error) => {
        const pending = session.pending.get(id)
        if (!pending) return
        cleanupPending(id, pending, session)
        rejectPromise(error)
      }
      const timer = setTimeout(() => {
        sendNotification(session, '$/cancelRequest', { id })
        reject(lspError(
          'lsp_request_timeout',
          `LSP request "${method}" timed out after ${options.timeoutMs}ms.`,
          true,
          'Retry the request, or increase SCIFORGE_RUNTIME_INSPECTOR_LSP_TIMEOUT_MS for slow workspaces.',
          { method, timeoutMs: options.timeoutMs }
        ))
      }, options.timeoutMs)
      const abortListener = options.signal
        ? () => {
            sendNotification(session, '$/cancelRequest', { id })
            reject(lspError('aborted', 'LSP request was aborted.', true, 'Retry the request if it is still needed.', { method }))
          }
        : undefined
      const pending: PendingRequest = {
        method,
        resolve: (value) => {
          cleanupPending(id, pending, session)
          resolvePromise(value)
        },
        reject,
        timer,
        ...(abortListener ? { abortListener, signal: options.signal } : {})
      }
      session.pending.set(id, pending)
      options.signal?.addEventListener('abort', abortListener!, { once: true })
      timer.unref?.()
      sendMessage(session, { jsonrpc: '2.0', id, method, params })
    })
  }
}

export async function lspDependency(workspaceRoot: string | undefined, env: NodeJS.ProcessEnv, override?: LspCommand): Promise<RuntimeDependency> {
  const command = workspaceRoot
    ? await resolveTypeScriptLanguageServerCommand(workspaceRoot, env, override)
    : await resolveTypeScriptLanguageServerCommand(undefined, env, override)
  return command
    ? {
        id: 'typescript-language-server',
        available: true,
        path: command.command,
        status: override
          ? 'configured_command'
          : workspaceRoot && command.command.startsWith(join(workspaceRoot, 'node_modules'))
          ? 'local_binary_found'
          : 'path_binary_found'
      }
    : {
        id: 'typescript-language-server',
        available: false,
        reason: 'typescript-language-server is not installed for this workspace or available on PATH.'
      }
}

async function resolveTypeScriptLanguageServerCommand(workspaceRoot: string | undefined, env: NodeJS.ProcessEnv, override?: LspCommand): Promise<LspCommand | null> {
  if (override) return override
  if (workspaceRoot) {
    const localPath = join(workspaceRoot, 'node_modules', '.bin', executableName('typescript-language-server'))
    try {
      await access(localPath)
      return { command: localPath, args: ['--stdio'] }
    } catch {
      // Continue to PATH probe.
    }
  }
  const pathResult = await findOnPath(executableName('typescript-language-server'), env)
  return pathResult ? { command: pathResult, args: ['--stdio'] } : null
}

async function findOnPath(binary: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const pathValue = env.PATH ?? process.env.PATH ?? ''
  for (const root of pathValue.split(delimiter)) {
    if (!root) continue
    const candidate = join(root, binary)
    try {
      await stat(candidate)
      return candidate
    } catch {
      // Keep scanning PATH.
    }
  }
  return null
}

async function resolveExistingWorkspaceRoot(path: string): Promise<string> {
  const absolute = resolve(expandHomePath(path))
  try {
    return await realpath(absolute)
  } catch {
    throw lspError('workspace_root_not_found', `Workspace root does not exist: ${path}`, false, 'Choose an existing workspace directory.')
  }
}

async function resolveWorkspaceFile(path: string, workspaceRoot: string): Promise<string> {
  const absolute = isAbsolute(expandHomePath(path))
    ? resolve(expandHomePath(path))
    : resolve(workspaceRoot, path)
  if (!isInsidePath(absolute, workspaceRoot)) {
    throw lspError(
      'path_outside_repository',
      'LSP file_path must stay inside the workspace root.',
      false,
      'Pass a workspace-relative file_path or an absolute path under workspace_root.',
      { workspaceRoot, filePath: path }
    )
  }
  let resolvedFile: string
  try {
    resolvedFile = await realpath(absolute)
  } catch {
    throw lspError('file_not_found', `LSP file does not exist: ${path}`, false, 'Save the file first and pass a path under workspace_root.')
  }
  if (!isInsidePath(resolvedFile, workspaceRoot)) {
    throw lspError(
      'path_outside_repository',
      'LSP file_path resolved outside the workspace root.',
      false,
      'Use a file inside workspace_root. Symlinks that resolve outside the workspace are rejected.',
      { workspaceRoot, filePath: path, resolvedFile }
    )
  }
  return resolvedFile
}

function requiredFilePath(input: LspQueryRequest): string {
  const filePath = input.file_path?.trim()
  if (!filePath) {
    throw lspError('invalid_request', 'file_path is required for this LSP operation.', false, 'Pass file_path for file-scoped LSP operations.')
  }
  return filePath
}

function requestOptions(signal: AbortSignal | undefined, timeoutMs: number): RequestOptions {
  return { ...(signal ? { signal } : {}), timeoutMs }
}

function sendMessage(session: LspSession, message: Record<string, unknown>): void {
  if (session.closed || !session.process.stdin?.writable) return
  const body = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`
  session.process.stdin.write(`${header}${body}`)
}

function sendNotification(session: LspSession, method: string, params: Record<string, unknown>): void {
  sendMessage(session, { jsonrpc: '2.0', method, params })
}

function processBuffer(session: LspSession): void {
  while (session.stdoutBuffer.length > 0) {
    const headerEnd = session.stdoutBuffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = session.stdoutBuffer.subarray(0, headerEnd).toString('utf8')
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      session.stdoutBuffer = session.stdoutBuffer.subarray(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    if (session.stdoutBuffer.length < bodyStart + length) return
    const body = session.stdoutBuffer.subarray(bodyStart, bodyStart + length).toString('utf8')
    session.stdoutBuffer = session.stdoutBuffer.subarray(bodyStart + length)
    try {
      const message = JSON.parse(body) as Record<string, unknown>
      handleMessage(session, message)
    } catch {
      // Ignore malformed language-server output.
    }
  }
}

function handleMessage(session: LspSession, message: Record<string, unknown>): void {
  if (message.id === undefined || (message.result === undefined && message.error === undefined)) return
  const id = String(message.id)
  const pending = session.pending.get(id)
  if (!pending) return
  if (message.error) {
    pending.reject(lspError('lsp_request_failed', errorMessage(message.error), true, 'Check the target file and retry.', {
      method: pending.method
    }))
  } else {
    pending.resolve(message.result)
  }
}

function cleanupPending(id: string, pending: PendingRequest, session: LspSession): void {
  clearTimeout(pending.timer)
  if (pending.abortListener && pending.signal) {
    pending.signal.removeEventListener('abort', pending.abortListener)
  }
  session.pending.delete(id)
}

function rejectPending(session: LspSession, error: Error): void {
  for (const pending of [...session.pending.values()]) {
    pending.reject(error)
  }
}

function terminateSession(session: LspSession): void {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer)
  rejectPending(session, lspError('lsp_session_closed', 'LSP session closed.', true, 'Retry the LSP request; the worker will start a fresh language server session.'))
  try {
    sendNotification(session, 'exit', {})
  } catch {
    // Process may already be gone.
  }
  session.closed = true
  try {
    session.process.kill('SIGTERM')
  } catch {
    // Process already exited.
  }
  const timer = setTimeout(() => {
    try {
      session.process.kill('SIGKILL')
    } catch {
      // Process already exited.
    }
  }, 2_000)
  timer.unref?.()
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return 'LSP request failed.'
}

function simplifyResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(simplifyResult)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.targetUri === 'string') {
    return {
      path: uriToPath(record.targetUri),
      range: simplifyResult(record.targetRange),
      selectionRange: simplifyResult(record.targetSelectionRange),
      ...(record.originSelectionRange ? { originSelectionRange: simplifyResult(record.originSelectionRange) } : {})
    }
  }
  if (typeof record.uri === 'string') {
    return {
      path: uriToPath(record.uri),
      range: simplifyResult(record.range)
    }
  }
  if (record.contents !== undefined) {
    return {
      contents: hoverText(record.contents),
      ...(record.range ? { range: simplifyResult(record.range) } : {})
    }
  }
  if (record.name && (record.kind !== undefined || record.location !== undefined || record.selectionRange !== undefined)) {
    const location = asRecord(record.location)
    return {
      name: record.name,
      kind: symbolKindName(record.kind),
      ...(record.detail ? { detail: record.detail } : {}),
      ...(record.range ? { range: simplifyResult(record.range) } : {}),
      ...(record.selectionRange ? { selectionRange: simplifyResult(record.selectionRange) } : {}),
      ...(location.uri ? { path: uriToPath(location.uri) } : {}),
      ...(location.range ? { locationRange: simplifyResult(location.range) } : {}),
      ...(record.containerName ? { containerName: record.containerName } : {}),
      ...(Array.isArray(record.children) ? { children: simplifyResult(record.children) } : {})
    }
  }
  if ('start' in record && 'end' in record) {
    return {
      start: position(record.start),
      end: position(record.end)
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, simplifyResult(entry)]))
}

function position(value: unknown): unknown {
  const record = asRecord(value)
  return {
    line: (typeof record.line === 'number' ? record.line : 0) + 1,
    character: (typeof record.character === 'number' ? record.character : 0) + 1
  }
}

function hoverText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(hoverText).join('\n\n')
  if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
    return String((value as { value: unknown }).value)
  }
  if (value && typeof value === 'object' && typeof (value as { language?: unknown; value?: unknown }).language === 'string') {
    return String((value as { value?: unknown }).value ?? '')
  }
  return String(value)
}

function uriToPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    return isAbsolute(value) ? value : fileURLToPath(value)
  } catch {
    return value
  }
}

function sessionSummary(session: LspSession): LspSessionSummary {
  return {
    workspaceRoot: session.workspaceRoot,
    pid: session.process.pid ?? null,
    initialized: session.initialized,
    refCount: session.refCount,
    pendingRequests: session.pending.size,
    openDocuments: session.openDocuments.size,
    cleanupScheduled: session.cleanupTimer !== null,
    startedAt: session.startedAt,
    lastUsedAt: session.lastUsedAt
  }
}

function lspError(
  code: RuntimeInspectorErrorCode,
  reason: string,
  retryable: boolean,
  suggestion: string,
  details?: unknown
): Error {
  return Object.assign(new Error(reason), {
    runtimeInspectorError: true,
    code,
    retryable,
    suggestion,
    details
  })
}

function failureFromLspError(error: unknown): RuntimeInspectorFailure {
  if (isRuntimeInspectorError(error)) {
    return {
      ok: false,
      error: {
        code: error.code,
        reason: error.message,
        retryable: error.retryable,
        suggestion: error.suggestion,
        ...(error.details !== undefined ? { details: error.details } : {})
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'unknown',
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
      suggestion: 'Check worker logs and retry the LSP request.'
    }
  }
}

function isRuntimeInspectorError(error: unknown): error is Error & {
  runtimeInspectorError: true
  code: RuntimeInspectorErrorCode
  retryable: boolean
  suggestion: string
  details?: unknown
} {
  return asRecord(error)?.runtimeInspectorError === true
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw lspError('aborted', 'LSP request was aborted.', true, 'Retry the request if it is still needed.')
  }
}

function positive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
}

function isTsJsFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
  return TS_JS_EXTENSIONS.has(ext)
}

function languageId(filePath: string): string {
  if (filePath.endsWith('.tsx')) return 'typescriptreact'
  if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')) return 'typescript'
  if (filePath.endsWith('.jsx')) return 'javascriptreact'
  return 'javascript'
}

function symbolKindName(value: unknown): string {
  const kinds: Record<number, string> = {
    1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
    6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
    11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant', 15: 'String',
    16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object', 20: 'Key',
    21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event', 25: 'Operator',
    26: 'TypeParameter'
  }
  const key = typeof value === 'number' ? value : Number(value)
  return kinds[key] ?? String(value)
}

function isInsidePath(path: string, root: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function samePath(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right)
}

function normalizeComparablePath(path: string): string {
  return resolve(expandHomePath(path)).split(sep).join('/').replace(/\/+$/, '')
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}

function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
