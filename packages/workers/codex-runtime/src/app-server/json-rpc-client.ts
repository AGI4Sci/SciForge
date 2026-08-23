import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { toWellFormedUnicode } from '@sciforge/domain-sdk/unicode'

import {
  CodexAppServerPendingRequestRegistry,
  createCodexAppServerPendingRequestRegistry,
  type CodexAppServerPendingRequest,
  type CodexAppServerPendingRequestRegistryOptions,
  type CodexAppServerResolveApprovalInput,
  type CodexAppServerResolveUserInputInput
} from './request-registry'
import {
  defaultCodexAppServerServerRequestHandler,
  visibleServerRequestFailureMessage
} from './server-requests'
import type {
  CodexAppServerGetAccountParams,
  CodexAppServerGetAccountRateLimitsResponse,
  CodexAppServerGetAccountResponse,
  CodexAppServerLoginAccountParams,
  CodexAppServerLoginAccountResponse,
  CodexAppServerClientInfo,
  CodexAppServerConfigBatchWriteParams,
  CodexAppServerConfigWriteResponse,
  CodexAppServerHooksListResponse,
  CodexAppServerInitializeParams,
  CodexAppServerInitializeResponse,
  CodexAppServerJsonRpcNotification,
  CodexAppServerJsonRpcRequest,
  CodexAppServerJsonRpcResponse,
  CodexAppServerProcess,
  CodexAppServerRequestId,
  CodexAppServerServerRequestHandler,
  CodexAppServerThreadDeleteParams,
  CodexAppServerThreadListParams,
  CodexAppServerThreadReadParams,
  CodexAppServerThreadRenameParams,
  CodexAppServerThreadResumeParams,
  CodexAppServerThreadStartParams,
  CodexAppServerTurnInterruptParams,
  CodexAppServerTurnStartParams,
  CodexAppServerTurnSteerParams,
  SpawnCodexAppServerProcess
} from './protocol'
export type {
  CodexAppServerAccount,
  CodexAppServerAccountLoginCompletedNotification,
  CodexAppServerAccountRateLimitsUpdatedNotification,
  CodexAppServerAccountUpdatedNotification,
  CodexAppServerApprovalPolicy,
  CodexAppServerClientInfo,
  CodexAppServerConfigBatchWriteParams,
  CodexAppServerConfigWriteResponse,
  CodexAppServerInitializeParams,
  CodexAppServerInitializeResponse,
  CodexAppServerGetAccountParams,
  CodexAppServerGetAccountRateLimitsResponse,
  CodexAppServerGetAccountResponse,
  CodexAppServerInputItem,
  CodexAppServerJsonRpcNotification,
  CodexAppServerJsonRpcRequest,
  CodexAppServerJsonRpcResponse,
  CodexAppServerLoginAccountParams,
  CodexAppServerLoginAccountResponse,
  CodexAppServerHookMetadata,
  CodexAppServerHooksListResponse,
  CodexAppServerPlanType,
  CodexAppServerRateLimitSnapshot,
  CodexAppServerProcess,
  CodexAppServerRequestId,
  CodexAppServerServerRequestHandler,
  CodexAppServerThreadDeleteParams,
  CodexAppServerThreadListParams,
  CodexAppServerThreadReadParams,
  CodexAppServerThreadRenameParams,
  CodexAppServerThreadResumeParams,
  CodexAppServerThreadSandboxPolicy,
  CodexAppServerThreadStartParams,
  CodexAppServerTurnInterruptParams,
  CodexAppServerTurnSandboxPolicy,
  CodexAppServerTurnStartParams,
  CodexAppServerTurnSteerParams,
  SpawnCodexAppServerProcess
} from './protocol'

export const CODEX_MAIN_IPC_CHANNELS = {
  connect: 'codex:connect',
  threadList: 'codex:thread:list',
  threadStart: 'codex:thread:start',
  threadRead: 'codex:thread:read',
  threadRename: 'codex:thread:rename',
  threadDelete: 'codex:thread:delete',
  turnStart: 'codex:turn:start',
  turnInterrupt: 'codex:turn:interrupt',
  turnSteer: 'codex:turn:steer',
  event: 'codex:event',
  error: 'codex:error',
  closed: 'codex:closed'
} as const

export type CodexMainIpcChannel =
  typeof CODEX_MAIN_IPC_CHANNELS[keyof typeof CODEX_MAIN_IPC_CHANNELS]

export type CodexAppServerClientEvent =
  | {
    type: 'event'
    channel: typeof CODEX_MAIN_IPC_CHANNELS.event
    payload: unknown
  }
  | {
    type: 'error'
    channel: typeof CODEX_MAIN_IPC_CHANNELS.error
    error: { message: string }
  }
  | {
    type: 'closed'
    channel: typeof CODEX_MAIN_IPC_CHANNELS.closed
    reason: string
  }

export type CodexAppServerJsonRpcClientOptions = {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  spawnProcess?: SpawnCodexAppServerProcess
  clientInfo?: CodexAppServerClientInfo
  serverRequestHandler?: CodexAppServerServerRequestHandler
  pendingServerRequests?: CodexAppServerPendingRequestRegistry | CodexAppServerPendingRequestRegistryOptions
  /** Maximum time to wait for the provider to acknowledge `turn/start`. */
  turnStartTimeoutMs?: number
}

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const DEFAULT_COMMAND = 'codex'
const DEFAULT_ARGS = ['app-server', '--listen', 'stdio://']
const DEFAULT_CLIENT_INFO: CodexAppServerClientInfo = {
  name: 'sciforge',
  title: 'SciForge',
  version: '0.1.0'
}

const DEFAULT_CAPABILITIES = {
  experimentalApi: true
}
const DEFAULT_TURN_START_TIMEOUT_MS = 30_000

export function createCodexAppServerClient(
  options: CodexAppServerJsonRpcClientOptions = {}
): CodexAppServerJsonRpcClient {
  return new CodexAppServerJsonRpcClient(options)
}

export class CodexAppServerJsonRpcClient {
  private readonly pending = new Map<CodexAppServerRequestId, PendingRequest>()
  private readonly eventSubscribers = new Set<AsyncEventQueue<CodexAppServerClientEvent>>()
  private readonly spawnProcess: SpawnCodexAppServerProcess
  private process: CodexAppServerProcess | undefined
  private nextRequestId = 1
  private closed = false
  private stderrTail = ''
  private initializePromise: Promise<CodexAppServerInitializeResponse> | null = null
  private readonly pendingServerRequestRegistry: CodexAppServerPendingRequestRegistry | null

  constructor(private readonly options: CodexAppServerJsonRpcClientOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawnCodexAppServerProcess
    this.pendingServerRequestRegistry = pendingServerRequestRegistry(options.pendingServerRequests)
  }

  start(): void {
    if (this.process) return
    this.assertOpen()
    const command = this.options.command ?? DEFAULT_COMMAND
    const args = this.options.args ?? DEFAULT_ARGS
    const detached = process.platform !== 'win32'
    this.process = this.spawnProcess(command, [...args], {
      cwd: this.options.cwd ?? process.cwd(),
      env: this.options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached,
      windowsHide: true
    })

    const stdout = createInterface({ input: this.process.stdout })
    stdout.on('line', (line) => this.handleLine(line))
    this.process.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-4_000)
    })
    this.process.on('error', (error) => this.fail(error))
    this.process.on('close', (code, signal) => {
      if (this.closed) return
      const closedProcess = this.process
      if (closedProcess) terminateCodexProcessTree(closedProcess, 'SIGTERM')
      const stderr = this.stderrTail.trim()
      const detail = stderr ? ` ${stderr}` : ''
      this.fail(new Error(
        `Codex app-server exited before stop: code=${code ?? 'null'} signal=${signal ?? 'null'}${detail}`
      ))
    })
  }

  subscribe(): AsyncIterable<CodexAppServerClientEvent> {
    const queue = new AsyncEventQueue<CodexAppServerClientEvent>()
    if (this.closed) {
      queue.end()
      return queue
    }
    this.eventSubscribers.add(queue)
    return cleanupAsyncIterable(queue, () => {
      this.eventSubscribers.delete(queue)
    })
  }

  connect(
    params: CodexAppServerInitializeParams = {},
    abortSignal?: AbortSignal
  ): Promise<CodexAppServerInitializeResponse> {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize(params, abortSignal).catch((error) => {
        this.initializePromise = null
        throw error
      })
    }
    return this.initializePromise
  }

  async initialize(
    params: CodexAppServerInitializeParams = {},
    abortSignal?: AbortSignal
  ): Promise<CodexAppServerInitializeResponse> {
    const { clientInfo, capabilities, ...rest } = params
    const result = await this.request<CodexAppServerInitializeResponse>('initialize', {
      ...rest,
      clientInfo: clientInfo ?? this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      capabilities: capabilities ?? DEFAULT_CAPABILITIES
    }, abortSignal)
    this.notify('initialized')
    return result
  }

  startThread(
    params: CodexAppServerThreadStartParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('thread/start', params, abortSignal)
  }

  resumeThread(
    params: CodexAppServerThreadResumeParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('thread/resume', params, abortSignal)
  }

  listThreads(
    params: CodexAppServerThreadListParams = {},
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('thread/list', params, abortSignal)
  }

  readThread(
    params: CodexAppServerThreadReadParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('thread/read', params, abortSignal)
  }

  renameThread(
    params: CodexAppServerThreadRenameParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('thread/name/set', {
      threadId: params.threadId,
      name: params.title
    }, abortSignal)
  }

  deleteThread(
    params: CodexAppServerThreadDeleteParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('thread/delete', params, abortSignal)
  }

  startTurn(
    params: CodexAppServerTurnStartParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    if (abortSignal) return this.request('turn/start', params, abortSignal)
    const timeoutMs = positiveTimeoutMs(
      this.options.turnStartTimeoutMs,
      DEFAULT_TURN_START_TIMEOUT_MS
    )
    const deadline = AbortSignal.timeout(timeoutMs)
    return this.request('turn/start', params, deadline).catch((error) => {
      if (!deadline.aborted) throw error
      const stderr = toWellFormedUnicode(this.stderrTail).trim()
      const detail = stderr ? ` Recent stderr: ${stderr}` : ''
      throw new Error(
        `Codex app-server did not acknowledge turn/start within ${timeoutMs} ms.${detail}`
      )
    })
  }

  listHooks(cwds: string[], abortSignal?: AbortSignal): Promise<CodexAppServerHooksListResponse> {
    return this.request('hooks/list', { cwds }, abortSignal)
  }

  writeConfigBatch(
    params: CodexAppServerConfigBatchWriteParams,
    abortSignal?: AbortSignal
  ): Promise<CodexAppServerConfigWriteResponse> {
    return this.request('config/batchWrite', params, abortSignal)
  }

  interruptTurn(
    params: CodexAppServerTurnInterruptParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('turn/interrupt', params, abortSignal)
  }

  steerTurn(
    params: CodexAppServerTurnSteerParams,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    return this.request('turn/steer', params, abortSignal)
  }

  readAccount(
    params: CodexAppServerGetAccountParams = {},
    abortSignal?: AbortSignal
  ): Promise<CodexAppServerGetAccountResponse> {
    return this.request('account/read', params, abortSignal)
  }

  startAccountLogin(
    params: CodexAppServerLoginAccountParams,
    abortSignal?: AbortSignal
  ): Promise<CodexAppServerLoginAccountResponse> {
    return this.request('account/login/start', params, abortSignal)
  }

  logoutAccount(abortSignal?: AbortSignal): Promise<Record<string, never>> {
    return this.request('account/logout', undefined, abortSignal)
  }

  readAccountRateLimits(
    abortSignal?: AbortSignal
  ): Promise<CodexAppServerGetAccountRateLimitsResponse> {
    return this.request('account/rateLimits/read', undefined, abortSignal)
  }

  pendingServerRequests(): CodexAppServerPendingRequest[] {
    return this.pendingServerRequestRegistry?.pending() ?? []
  }

  resolveServerRequest(requestId: CodexAppServerRequestId, result: unknown): void {
    this.pendingServerRequestRegistry?.resolveServerRequest(requestId, result)
  }

  resolveApproval(input: CodexAppServerResolveApprovalInput): void {
    this.pendingServerRequestRegistry?.resolveApproval(input)
  }

  resolveUserInput(input: CodexAppServerResolveUserInputInput): void {
    this.pendingServerRequestRegistry?.resolveUserInput(input)
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    abortSignal?: AbortSignal
  ): Promise<T> {
    this.assertOpen()
    this.start()
    const id = this.nextRequestId++
    const payload: CodexAppServerJsonRpcRequest = params === undefined
      ? { id, method }
      : { id, method, params }
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject
      })
    })

    const abort = () => {
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      pending.reject(new Error(`Codex app-server request aborted: ${method}`))
    }

    if (abortSignal?.aborted) {
      abort()
      return promise
    }

    abortSignal?.addEventListener('abort', abort, { once: true })
    try {
      this.write(payload)
    } catch (error) {
      const pending = this.pending.get(id)
      this.pending.delete(id)
      pending?.reject(asError(error))
      throw error
    }
    return promise.finally(() => abortSignal?.removeEventListener('abort', abort))
  }

  notify(method: string, params?: unknown): void {
    this.assertOpen()
    this.start()
    this.write(params === undefined ? { method } : { method, params })
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (this.closed) return
    this.closed = true
    const processToStop = this.process
    const closePromise = processToStop
      ? new Promise<void>((resolve) => {
        processToStop.on('close', () => resolve())
      })
      : Promise.resolve()

    this.rejectPending(new Error('Codex app-server client stopped.'))
    this.publishClosed('stopped')
    this.endSubscribers()
    if (processToStop && !processToStop.killed) {
      terminateCodexProcessTree(processToStop, signal)
      await closePromise
    }
  }

  private write(payload: CodexAppServerJsonRpcRequest | CodexAppServerJsonRpcNotification | CodexAppServerJsonRpcResponse): void {
    this.assertOpen()
    if (!this.process) throw new Error('Codex app-server process is not running.')
    this.process.stdin.write(`${JSON.stringify(wellFormedJsonValue(payload))}\n`)
  }

  private handleLine(line: string): void {
    const text = line.trim()
    if (!text) return
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      this.publishEvent({
        method: 'warning',
        params: {
          message: 'Codex app-server emitted invalid JSON.',
          text
        }
      })
      return
    }

    if (!isRecord(message)) return
    if (isJsonRpcResponse(message)) {
      this.resolveResponse(message)
      return
    }
    if (isJsonRpcServerRequest(message)) {
      void this.respondToServerRequest(message)
      return
    }
    this.publishEvent(message)
  }

  private resolveResponse(response: CodexAppServerJsonRpcResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.error) {
      pending.reject(new Error(response.error.message ?? `Codex app-server request failed: ${pending.method}`))
      return
    }
    pending.resolve(response.result)
  }

  private async respondToServerRequest(request: CodexAppServerJsonRpcRequest): Promise<void> {
    try {
      const handler = this.options.serverRequestHandler
        ?? this.pendingServerRequestRegistry?.handle.bind(this.pendingServerRequestRegistry)
        ?? defaultCodexAppServerServerRequestHandler
      const result = await handler(request)
      this.write({ id: request.id, result })
    } catch (error) {
      this.publishError(new Error(visibleServerRequestFailureMessage(request.method)))
      this.write({
        id: request.id,
        error: {
          code: -32000,
          message: asError(error).message
        }
      })
    }
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.pendingServerRequestRegistry?.rejectAll(error)
    this.rejectPending(error)
    this.publishError(error)
    this.publishClosed('error')
    this.endSubscribers()
  }

  private rejectPending(error: Error): void {
    this.pendingServerRequestRegistry?.rejectAll(error)
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private publish(event: CodexAppServerClientEvent): void {
    for (const subscriber of this.eventSubscribers) subscriber.push(event)
  }

  private publishEvent(payload: unknown): void {
    this.publish({
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      type: 'event',
      payload
    })
  }

  private publishError(error: Error): void {
    this.publish({
      channel: CODEX_MAIN_IPC_CHANNELS.error,
      type: 'error',
      error: { message: error.message }
    })
  }

  private publishClosed(reason: string): void {
    this.publish({
      channel: CODEX_MAIN_IPC_CHANNELS.closed,
      type: 'closed',
      reason
    })
  }

  private endSubscribers(): void {
    for (const subscriber of this.eventSubscribers) subscriber.end()
    this.eventSubscribers.clear()
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Codex app-server client stopped.')
  }
}

export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = []
  private ended = false

  push(value: T): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift() as T, done: false })
        }
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve))
      }
    }
  }
}

function spawnCodexAppServerProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    detached?: boolean
    windowsHide?: boolean
  }
): CodexAppServerProcess {
  return spawn(command, args, {
    ...options,
    // npm installs expose Codex as codex.cmd on Windows. Node cannot execute
    // cmd/bat shims directly without the Windows command processor.
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
  }) as unknown as CodexAppServerProcess
}

function terminateCodexProcessTree(
  child: CodexAppServerProcess,
  signal: NodeJS.Signals
): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall back to the direct child if the process group is already gone.
    }
  }
  child.kill(signal)
}

function pendingServerRequestRegistry(
  value: CodexAppServerJsonRpcClientOptions['pendingServerRequests']
): CodexAppServerPendingRequestRegistry | null {
  if (!value) return null
  if (value instanceof CodexAppServerPendingRequestRegistry) return value
  return createCodexAppServerPendingRequestRegistry(value)
}

function positiveTimeoutMs(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function wellFormedJsonValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (typeof value === 'string') return toWellFormedUnicode(value)
  if (value === null || typeof value !== 'object') return value
  if (ancestors.has(value)) throw new TypeError('Converting circular structure to JSON.')

  const toJSON = (value as { toJSON?: () => unknown }).toJSON
  if (typeof toJSON === 'function') {
    ancestors.add(value)
    const normalized = wellFormedJsonValue(toJSON.call(value), ancestors)
    ancestors.delete(value)
    return normalized
  }

  ancestors.add(value)
  const output: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {}
  for (const [key, nested] of Object.entries(value)) {
    const normalized = wellFormedJsonValue(nested, ancestors)
    if (Array.isArray(output)) output.push(normalized)
    else output[toWellFormedUnicode(key)] = normalized
  }
  ancestors.delete(value)
  return output
}

function isJsonRpcResponse(value: Record<string, unknown>): value is CodexAppServerJsonRpcResponse {
  return hasOwn(value, 'id')
    && !hasOwn(value, 'method')
    && (hasOwn(value, 'result') || hasOwn(value, 'error'))
}

function isJsonRpcServerRequest(value: Record<string, unknown>): value is CodexAppServerJsonRpcRequest {
  return hasOwn(value, 'id') && typeof value.method === 'string'
}

function cleanupAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  cleanup: () => void
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const value of iterable) yield value
      } finally {
        cleanup()
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
