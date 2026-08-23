import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  WorkspaceHostOperationError,
  workspaceHostRuntimeInvokeInputSchema,
  workspaceHostRuntimeReplayEventsInputSchema,
  type WorkspaceHostEventKind,
  type WorkspaceHostOperation,
  type WorkspaceHostPayload,
  type WorkspaceHostRuntimeInvokeInput,
  type WorkspaceHostRuntimeMethod
} from '@sciforge/domain-sdk/workspace-host'

import {
  CODEX_MAIN_IPC_CHANNELS,
  codexAppServerTurnInputs,
  createCodexAppServerClient,
  type CodexAppServerClientEvent,
  type CodexAppServerJsonRpcClient,
  type CodexAppServerJsonRpcClientOptions,
  type CodexAppServerPendingRequest
} from './app-server/index.js'
import {
  RuntimeEventStore,
  type StoredRuntimeEvent,
  type StoredThreadEventSummary
} from './runtime-event-store.js'
import {
  boundRuntimeEventPayload,
  boundRuntimeToolItem,
  decodeRuntimeToolArtifactRef
} from './runtime-payload-boundary.js'

const REMOTE_CODEX_RUNTIME_VERSION = '1.0.0'
const MAX_PERSISTED_THREAD_BINDINGS = 10_000
const THREAD_BINDING_STATE_SCHEMA_VERSION = 1
const SCIFORGE_MODEL_PROVIDER_ID = 'sciforge-model-router'
const SCIFORGE_MODEL_ALIAS = 'sciforge-router'
const SCIFORGE_RUNTIME_API_KEY = 'SCIFORGE_RUNTIME_API_KEY'
const PROXY_ENVIRONMENT_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy'
] as const

export type CodexWorkspaceHostModelAccess = Readonly<{
  baseUrl: string
  authorization: Readonly<{
    scheme: 'bearer'
    token: string
  }>
  expiresAt: string
}>

export type CodexWorkspaceHostOperationContext = Readonly<{
  workspaceRoot: string
  sessionId: string
  publishEvent(
    kind: WorkspaceHostEventKind,
    payload: WorkspaceHostPayload
  ): unknown
  getProcessEnvironment?(): NodeJS.ProcessEnv
  getProcessEnvironmentGeneration?(): number
  isProcessNetworkEgressReady?(): boolean
  getModelAccess?(): CodexWorkspaceHostModelAccess | undefined
  getModelAccessGeneration?(): number
  isModelAccessReady?(): boolean
}>

export type CodexWorkspaceHostOperationRegistration = Readonly<{
  operation: WorkspaceHostOperation
  version: string
  onProcessEnvironmentChanged?(
    environment: NodeJS.ProcessEnv,
    generation: number,
    ready?: boolean
  ): void | Promise<void>
  onModelAccessChanged?(
    access: CodexWorkspaceHostModelAccess | undefined,
    generation: number,
    ready: boolean
  ): void | Promise<void>
  handler(
    payload: WorkspaceHostPayload,
    context: CodexWorkspaceHostOperationContext
  ): WorkspaceHostPayload | Promise<WorkspaceHostPayload>
}>

export type CodexWorkspaceHostRuntimeOptions = Readonly<{
  workspaceRoot: string
  command?: string
  args?: string[]
  environment?: NodeJS.ProcessEnv
  stateDirectory?: string
  createClient?: (
    options: CodexAppServerJsonRpcClientOptions
  ) => CodexAppServerJsonRpcClient
  now?: () => Date
}>

type RuntimeEvent = StoredRuntimeEvent

type RuntimeStream = {
  streamId: string
  threadId: string
}

type ThreadBinding = {
  guiThreadId: string
  codexThreadId: string
  title?: string
  workspace: string
  createdAt: string
  updatedAt: string
}

/**
 * Package-owned remote Codex backend.
 *
 * This is intentionally a thin AgentRuntime handler around the same canonical
 * app-server client used by Electron main. SSH, Workspace Host transport,
 * desktop settings, and local secrets are outside this package.
 */
export class CodexWorkspaceHostRuntime {
  readonly operationHandlers: readonly CodexWorkspaceHostOperationRegistration[]

  readonly #workspaceRoot: string
  readonly #createClient: NonNullable<CodexWorkspaceHostRuntimeOptions['createClient']>
  readonly #clientOptions: Omit<CodexAppServerJsonRpcClientOptions, 'env'>
  readonly #baseEnvironment: NodeJS.ProcessEnv
  readonly #stateFile: string
  readonly #codexHome: string
  readonly #eventStore: RuntimeEventStore
  readonly #now: () => Date
  readonly #streams = new Map<string, RuntimeStream>()
  readonly #threads = new Map<string, ThreadBinding>()
  readonly #codexToGuiThread = new Map<string, string>()
  readonly #pendingRequestIds = new Map<string, string | number>()
  readonly #expectedStops = new WeakSet<CodexAppServerJsonRpcClient>()
  #client?: CodexAppServerJsonRpcClient
  #connectPromise?: Promise<void>
  #eventPump?: Promise<void>
  #publishEvent?: CodexWorkspaceHostOperationContext['publishEvent']
  #processEnvironment: NodeJS.ProcessEnv = {}
  #processEnvironmentFingerprint = proxyEnvironmentFingerprint({})
  #processEnvironmentGeneration = -1
  #networkEgressReady = false
  #modelAccess?: CodexWorkspaceHostModelAccess
  #modelAccessFingerprint = modelAccessFingerprint(undefined)
  #modelAccessGeneration = -1
  #clientLaunchFingerprint?: string
  #configurationChangeTail: Promise<void> = Promise.resolve()
  #stateWriteTail: Promise<void> = Promise.resolve()
  #disposed = false

  private constructor(
    options: CodexWorkspaceHostRuntimeOptions,
    workspaceRoot: string,
    stateDirectory: string,
    eventStore: RuntimeEventStore
  ) {
    this.#workspaceRoot = workspaceRoot
    this.#stateFile = join(stateDirectory, 'thread-bindings.json')
    this.#codexHome = join(stateDirectory, 'codex-home')
    this.#eventStore = eventStore
    this.#createClient = options.createClient ?? createCodexAppServerClient
    this.#clientOptions = {
      cwd: workspaceRoot,
      ...(options.command ? { command: options.command } : {}),
      ...(options.args ? { args: [...options.args] } : {}),
      pendingServerRequests: {
        onPendingRequest: (request) => this.#acceptPendingRequest(request),
        onUnknownRequest: (request) => {
          if (!request.threadId) return
          this.#appendEvent(request.threadId, {
            kind: 'error',
            turnId: request.turnId,
            recoverable: false,
            severity: 'error',
            code: 'unsupported_runtime_request',
            message: request.message
          })
        }
      }
    }
    this.#baseEnvironment = withoutProxyEnvironment(
      options.environment ?? process.env
    )
    this.#now = options.now ?? (() => new Date())
    const onProcessEnvironmentChanged = (
      environment: NodeJS.ProcessEnv,
      generation: number,
      ready?: boolean
    ) => this.#queueProcessEnvironmentChange(environment, generation, ready)
    const onModelAccessChanged = (
      access: CodexWorkspaceHostModelAccess | undefined,
      generation: number,
      ready: boolean
    ) => this.#queueModelAccessChange(access, generation, ready)
    this.operationHandlers = Object.freeze([
      Object.freeze({
        operation: WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
        version: REMOTE_CODEX_RUNTIME_VERSION,
        onProcessEnvironmentChanged,
        onModelAccessChanged,
        handler: (
          payload: WorkspaceHostPayload,
          context: CodexWorkspaceHostOperationContext
        ) => this.invoke(payload, context)
      }),
      Object.freeze({
        operation: WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents,
        version: REMOTE_CODEX_RUNTIME_VERSION,
        onProcessEnvironmentChanged,
        onModelAccessChanged,
        handler: (
          payload: WorkspaceHostPayload,
          context: CodexWorkspaceHostOperationContext
        ) => this.replayEvents(payload, context)
      })
    ])
  }

  static async create(
    options: CodexWorkspaceHostRuntimeOptions
  ): Promise<CodexWorkspaceHostRuntime> {
    const workspaceRoot = await realpath(options.workspaceRoot)
    const requestedStateDirectory = options.stateDirectory ??
      defaultStateDirectory(workspaceRoot)
    if (!isAbsolute(requestedStateDirectory)) {
      throw new Error('Remote Codex state directory must be an absolute server path.')
    }
    await mkdir(requestedStateDirectory, { recursive: true, mode: 0o700 })
    const stateDirectory = await realpath(requestedStateDirectory)
    const eventStore = await RuntimeEventStore.create(stateDirectory)
    const runtime = new CodexWorkspaceHostRuntime(
      options,
      workspaceRoot,
      stateDirectory,
      eventStore
    )
    await runtime.#loadThreadBindings()
    return runtime
  }

  async invoke(
    rawPayload: WorkspaceHostPayload,
    context: CodexWorkspaceHostOperationContext
  ): Promise<WorkspaceHostPayload> {
    this.#assertActive()
    await this.#acceptContext(context)
    const payload = workspaceHostRuntimeInvokeInputSchema.parse(rawPayload)
    if (payload.runtimeId !== 'codex') {
      throw new Error(`Remote runtime ${payload.runtimeId} is unavailable.`)
    }
    const result = await this.#invokeMethod(payload)
    await this.#eventStore.flush()
    return asPayload({
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      runtimeId: 'codex',
      method: payload.method,
      result
    })
  }

  async replayEvents(
    rawPayload: WorkspaceHostPayload,
    context: CodexWorkspaceHostOperationContext
  ): Promise<WorkspaceHostPayload> {
    this.#assertActive()
    await this.#acceptContext(context)
    const payload = workspaceHostRuntimeReplayEventsInputSchema.parse(rawPayload)
    if (payload.runtimeId !== 'codex') {
      throw new Error(`Remote runtime ${payload.runtimeId} is unavailable.`)
    }
    const events = (await this.#eventStore.readSince(payload.threadId, payload.sinceSeq))
      .map((event) => boundRuntimeEventPayload(payload.threadId, asPayload(event)))
    return { events }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#streams.clear()
    await this.#configurationChangeTail.catch(() => undefined)
    const client = this.#client
    this.#client = undefined
    this.#connectPromise = undefined
    this.#clientLaunchFingerprint = undefined
    if (client) {
      this.#expectedStops.add(client)
      await client.stop().catch(() => undefined)
    }
    await this.#eventPump?.catch(() => undefined)
    await this.#eventStore.flush()
    await this.#stateWriteTail.catch(() => undefined)
  }

  async #invokeMethod(
    payload: WorkspaceHostRuntimeInvokeInput
  ): Promise<WorkspaceHostPayload> {
    const input = record(payload.input)
    switch (payload.method) {
      case 'connect':
        await this.#ensureConnected()
        return null
      case 'capabilities':
        return remoteCodexCapabilities(
          this.#networkAccessReady(),
          this.#modelAccessReady()
        )
      case 'listThreads':
        return this.#listThreads(input)
      case 'startThread':
        return this.#startThread(input)
      case 'readThreadStatus':
        return this.#readThreadStatus(input)
      case 'readThreadPage':
        return this.#readThreadPage(input)
      case 'readToolArtifact':
        return this.#readToolArtifact(input)
      case 'startTurn':
        return this.#startTurn(input)
      case 'interruptTurn':
        return this.#interruptTurn(input)
      case 'steerTurn':
        return this.#steerTurn(input)
      case 'renameThread':
        return this.#renameThread(input)
      case 'deleteThread':
        return this.#deleteThread(input)
      case 'subscribeEvents':
        return this.#subscribeEvents(payload, input)
      case 'unsubscribeEvents':
        return this.#unsubscribeEvents(payload)
      case 'resolveApproval':
        return this.#resolveApproval(input)
      case 'resolveUserInput':
        return this.#resolveUserInput(input)
      case 'publishSyntheticEvent':
        return this.#publishSyntheticEvent(input)
      case 'updateTurnGovernanceSnapshot':
        return null
      case 'usage':
        return {
          supported: false,
          reason: 'Remote Codex usage aggregation is not available in this server cohort.',
          groupBy: stringValue(input.groupBy) || 'day',
          buckets: [],
          totals: {}
        }
      case 'auxiliary':
        return this.#auxiliary(input)
      case 'compactThread':
      case 'forkThread':
      case 'resumeSession':
      case 'updateThreadRelation':
        throw new Error(`Remote Codex method ${payload.method} is not supported.`)
      default:
        return assertNever(payload.method)
    }
  }

  async #ensureConnected(): Promise<CodexAppServerJsonRpcClient> {
    this.#assertActive()
    if (!this.#modelAccessReady()) {
      throw runtimeUnavailable(
        'model-access-unavailable',
        'Remote Codex requires ready scoped Model Router access.'
      )
    }
    if (
      this.#client &&
      this.#clientLaunchFingerprint !== this.#launchFingerprint()
    ) {
      await this.#stopCurrentClient()
    }
    if (this.#client && this.#connectPromise) {
      await this.#connectPromise
      return this.#client
    }
    await this.#prepareManagedCodexHome()
    const modelAccess = this.#modelAccess
    if (!modelAccess || !this.#modelAccessReady()) {
      throw runtimeUnavailable(
        'model-access-unavailable',
        'Remote Codex scoped Model Router access expired before launch.'
      )
    }
    const client = this.#createClient({
      ...this.#clientOptions,
      env: codexLaunchEnvironment(
        this.#baseEnvironment,
        this.#networkAccessReady() ? this.#processEnvironment : {},
        this.#codexHome,
        modelAccess
      )
    })
    this.#client = client
    this.#clientLaunchFingerprint = this.#launchFingerprint()
    this.#eventPump = this.#pumpEvents(client)
    this.#connectPromise = client.connect().then(() => undefined).catch((error) => {
      if (this.#client === client) {
        this.#client = undefined
        this.#connectPromise = undefined
        this.#clientLaunchFingerprint = undefined
      }
      throw error
    })
    await this.#connectPromise
    return client
  }

  async #listThreads(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const client = await this.#ensureConnected()
    const [response, summaries] = await Promise.all([
      client.listThreads({
        limit: numberValue(input.limit) ?? 100,
        ...(stringValue(input.search) ? { search: stringValue(input.search) } : {}),
        ...(input.includeArchived === true ? { includeArchived: true } : {}),
        ...(input.archivedOnly === true ? { archivedOnly: true } : {})
      }),
      this.#eventStore.summaries()
    ])
    const byThreadId = new Map(summaries.map((summary) => [summary.threadId, summary]))
    return threadList(response).map((thread) => {
      const mapped = this.#mapThread(thread)
      return withEventSummary(mapped, byThreadId.get(stringValue(record(mapped).id)))
    })
  }

  async #startThread(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const client = await this.#ensureConnected()
    const workspace = await this.#containedWorkspace(stringValue(input.workspace))
    const response = await client.startThread({
      cwd: workspace,
      ...(stringValue(input.model) ? { model: stringValue(input.model) } : {}),
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      ephemeral: false,
      serviceName: 'SciForge'
    })
    const rawThread = threadFromResponse(response)
    const codexThreadId = stringValue(rawThread.id)
    if (!codexThreadId) throw new Error('Codex app-server did not return a thread ID.')
    const guiThreadId = stringValue(input.threadId) || codexThreadId
    const now = this.#now().toISOString()
    const binding: ThreadBinding = {
      guiThreadId,
      codexThreadId,
      title: stringValue(input.title) || threadTitle(rawThread),
      workspace,
      createdAt: dateValue(rawThread.createdAt) || now,
      updatedAt: dateValue(rawThread.updatedAt) || now
    }
    this.#threads.set(guiThreadId, binding)
    this.#codexToGuiThread.set(codexThreadId, guiThreadId)
    await this.#persistThreadBindings()
    const thread = this.#mapThread(rawThread, binding)
    this.#appendEvent(guiThreadId, {
      kind: 'thread_lifecycle',
      state: 'created',
      thread
    })
    return thread
  }

  async #readThreadStatus(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'readThreadStatus.threadId')
    const client = await this.#ensureConnected()
    const binding = this.#threads.get(guiThreadId)
    const response = await client.readThread({
      threadId: binding?.codexThreadId ?? guiThreadId,
      includeTurns: false
    })
    const rawThread = threadFromResponse(response)
    const thread = this.#mapThread(rawThread, binding)
    const threadRecord = record(thread)
    const summary = await this.#eventStore.summary(guiThreadId)
    const latestTurnId = summary?.latestTurnId || stringValue(threadRecord.latestTurnId)
    const latestTurnStatus = summary?.latestTurnStatus || stringValue(threadRecord.latestTurnStatus)
    return {
      id: stringValue(threadRecord.id) || guiThreadId,
      runtimeId: 'codex',
      latestSeq: summary?.latestSeq ?? 0,
      ...(latestTurnId ? { latestTurnId } : {}),
      ...(latestTurnStatus ? { latestTurnStatus, status: latestTurnStatus } : {})
    }
  }

  async #readThreadPage(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'readThreadPage.threadId')
    const limit = Math.min(100, Math.max(1, Math.floor(numberValue(input.limit) || 20)))
    const page = await this.#eventStore.readPage(
      guiThreadId,
      stringValue(input.cursor),
      limit
    )
    const events = page.events
    const turnIds: string[] = []
    const seenTurnIds = new Set<string>()
    for (const event of events) {
      const turnId = eventTurnId(event)
      if (!turnId || seenTurnIds.has(turnId)) continue
      seenTurnIds.add(turnId)
      turnIds.push(turnId)
    }
    const selectedTurnIds = turnIds
    const selected = new Set(selectedTurnIds)
    const eventsByTurn = new Map(
      selectedTurnIds.map((turnId) => [turnId, [] as RuntimeEvent[]])
    )
    for (const event of events) {
      const turnId = eventTurnId(event)
      if (!selected.has(turnId)) continue
      eventsByTurn.get(turnId)?.push(event)
    }
    const turns = selectedTurnIds.map((turnId) => {
      const turnEvents = eventsByTurn.get(turnId) ?? []
      return {
        id: turnId,
        threadId: guiThreadId,
        status: turnStatusFromEvents(turnEvents),
        items: itemsFromTurnEvents(turnEvents).map((item) =>
          boundRuntimeToolItem(guiThreadId, item)
        )
      }
    })
    const summary = await this.#eventStore.summary(guiThreadId)
    return {
      runtimeId: 'codex',
      threadId: guiThreadId,
      latestSeq: summary?.latestSeq ?? 0,
      turns,
      nextCursor: page.nextCursor
    }
  }

  async #readToolArtifact(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'readToolArtifact.threadId')
    const ref = requiredString(input.ref, 'readToolArtifact.ref')
    const itemId = decodeRuntimeToolArtifactRef(ref)
    const content = await this.#eventStore.readLatestToolArtifact(guiThreadId, itemId)
    if (content !== undefined) return {
      runtimeId: 'codex',
      threadId: guiThreadId,
      ref,
      size: Buffer.byteLength(content, 'utf8'),
      content
    }
    throw new Error('Tool artifact was not found.')
  }

  async #startTurn(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'startTurn.threadId')
    const text = requiredString(input.text, 'startTurn.text')
    const client = await this.#ensureConnected()
    const binding = this.#threads.get(guiThreadId)
    const workspace = await this.#containedWorkspace(
      stringValue(input.workspace) || binding?.workspace
    )
    let response: unknown
    try {
      response = await client.startTurn({
        threadId: binding?.codexThreadId ?? guiThreadId,
        input: await codexAppServerTurnInputs({
          text,
          workspaceRoot: workspace,
          fileReferences: input.fileReferences
        }),
        cwd: workspace,
        ...(stringValue(input.model) ? { model: stringValue(input.model) } : {}),
        approvalPolicy: 'on-request',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [workspace],
          networkAccess: this.#networkAccessReady()
        }
      })
    } catch (error) {
      await this.#stopCurrentClient()
      throw error
    }
    const turn = record(record(response).turn)
    const turnId = stringValue(turn.id) || randomUUID()
    const userMessageItemId =
      stringValue(turn.userMessageItemId) || `codex-user-${randomUUID()}`
    this.#appendEvent(guiThreadId, {
      kind: 'user_message',
      turnId,
      itemId: userMessageItemId,
      text,
      ...(stringValue(input.displayText)
        ? { displayText: stringValue(input.displayText) }
        : {})
    })
    this.#appendEvent(guiThreadId, {
      kind: 'turn_lifecycle',
      turnId,
      state: 'started'
    })
    return { threadId: guiThreadId, turnId, userMessageItemId }
  }

  async #interruptTurn(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'interruptTurn.threadId')
    const turnId = requiredString(input.turnId, 'interruptTurn.turnId')
    const client = await this.#ensureConnected()
    await client.interruptTurn({
      threadId: this.#threads.get(guiThreadId)?.codexThreadId ?? guiThreadId,
      turnId
    })
    this.#appendEvent(guiThreadId, {
      kind: 'turn_lifecycle',
      turnId,
      state: 'interrupted'
    })
    return null
  }

  async #steerTurn(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'steerTurn.threadId')
    const turnId = requiredString(input.turnId, 'steerTurn.turnId')
    const text = requiredString(input.text, 'steerTurn.text')
    const client = await this.#ensureConnected()
    await client.steerTurn({
      threadId: this.#threads.get(guiThreadId)?.codexThreadId ?? guiThreadId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text, text_elements: [] }]
    })
    return null
  }

  async #renameThread(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'renameThread.threadId')
    const title = requiredString(input.title, 'renameThread.title')
    const client = await this.#ensureConnected()
    const binding = this.#threads.get(guiThreadId)
    await client.renameThread({
      threadId: binding?.codexThreadId ?? guiThreadId,
      title
    })
    if (binding) {
      binding.title = title
      binding.updatedAt = this.#now().toISOString()
      await this.#persistThreadBindings()
    }
    return null
  }

  async #deleteThread(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const guiThreadId = requiredString(input.threadId, 'deleteThread.threadId')
    const client = await this.#ensureConnected()
    const binding = this.#threads.get(guiThreadId)
    await client.deleteThread({
      threadId: binding?.codexThreadId ?? guiThreadId
    })
    if (binding) this.#codexToGuiThread.delete(binding.codexThreadId)
    this.#threads.delete(guiThreadId)
    await this.#persistThreadBindings()
    await this.#eventStore.delete(guiThreadId)
    for (const [streamId, stream] of this.#streams) {
      if (stream.threadId === guiThreadId) this.#streams.delete(streamId)
    }
    return null
  }

  async #subscribeEvents(
    payload: WorkspaceHostRuntimeInvokeInput,
    input: Record<string, unknown>
  ): Promise<WorkspaceHostPayload> {
    const streamId = requiredString(payload.streamId, 'subscribeEvents.streamId')
    const threadId = requiredString(input.threadId, 'subscribeEvents.threadId')
    await this.#reconcileOrphanedTurnTerminal(threadId)
    this.#streams.set(streamId, { streamId, threadId })
    return null
  }

  async #reconcileOrphanedTurnTerminal(threadId: string): Promise<void> {
    const summary = await this.#eventStore.summary(threadId)
    const localTurnId = summary?.latestTurnId
    if (!localTurnId || terminalTurnState(summary.latestTurnStatus)) return
    const binding = this.#threads.get(threadId)
    let rawThread: Record<string, unknown>
    try {
      const client = await this.#ensureConnected()
      rawThread = threadFromResponse(await client.readThread({
        threadId: binding?.codexThreadId ?? threadId,
        includeTurns: true
      }))
    } catch {
      return
    }
    const durableTurnId = latestTurnId(rawThread)
    const durableStatus = terminalTurnState(latestTurnStatus(rawThread))
    if (!durableTurnId || durableTurnId !== localTurnId || !durableStatus) return
    this.#appendEvent(threadId, {
      kind: 'turn_lifecycle',
      turnId: durableTurnId,
      state: durableStatus
    })
  }

  #unsubscribeEvents(payload: WorkspaceHostRuntimeInvokeInput): WorkspaceHostPayload {
    const streamId = requiredString(payload.streamId, 'unsubscribeEvents.streamId')
    this.#streams.delete(streamId)
    return null
  }

  async #resolveApproval(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const approvalId = requiredString(input.approvalId, 'resolveApproval.approvalId')
    const requestId = this.#pendingRequestIds.get(approvalId)
    if (requestId === undefined) {
      throw new Error(`Remote Codex approval ${approvalId} is not pending.`)
    }
    const client = await this.#ensureConnected()
    const decision = stringValue(input.decision)
    client.resolveApproval({
      requestId,
      decision: decision === 'allowed' ? 'allowed' : 'denied',
      ...(stringValue(input.message) ? { message: stringValue(input.message) } : {})
    })
    this.#pendingRequestIds.delete(approvalId)
    const threadId = stringValue(input.threadId)
    if (threadId) {
      this.#appendEvent(threadId, {
        kind: 'approval_resolved',
        approvalId,
        decision: decision === 'allowed' ? 'allowed' : 'denied',
        ...(stringValue(input.message) ? { message: stringValue(input.message) } : {})
      })
    }
    return null
  }

  async #resolveUserInput(input: Record<string, unknown>): Promise<WorkspaceHostPayload> {
    const requestKey = requiredString(input.requestId, 'resolveUserInput.requestId')
    const requestId = this.#pendingRequestIds.get(requestKey)
    if (requestId === undefined) {
      throw new Error(`Remote Codex user input ${requestKey} is not pending.`)
    }
    const client = await this.#ensureConnected()
    const answers = arrayValue(input.answers)
      .map(record)
      .filter((answer) => stringValue(answer.id))
      .map((answer) => ({
        id: stringValue(answer.id),
        ...(stringValue(answer.label) ? { label: stringValue(answer.label) } : {}),
        value: stringValue(answer.value)
      }))
    client.resolveUserInput({ requestId, answers, status: 'submitted' })
    this.#pendingRequestIds.delete(requestKey)
    const threadId = stringValue(input.threadId)
    if (threadId) {
      this.#appendEvent(threadId, {
        kind: 'user_input_resolved',
        requestId: requestKey,
        status: 'submitted',
        answers
      })
    }
    return null
  }

  #publishSyntheticEvent(input: Record<string, unknown>): WorkspaceHostPayload {
    const threadId = requiredString(input.threadId, 'publishSyntheticEvent.threadId')
    return asPayload(this.#appendEvent(threadId, input))
  }

  #auxiliary(input: Record<string, unknown>): WorkspaceHostPayload {
    const operation = stringValue(input.operation)
    if (operation === 'getRuntimeInfo') {
      return {
        runtimeId: 'codex',
        placement: 'workspace-host',
        workspaceRoot: this.#workspaceRoot,
        connected: Boolean(this.#client)
      }
    }
    if (operation === 'getToolDiagnostics') {
      return {
        runtimeId: 'codex',
        commandExecution: true,
        fileChange: true,
        mcpServers: []
      }
    }
    if (operation === 'listSkills' || operation === 'listMemories') return []
    throw new Error(`Remote Codex auxiliary operation ${operation || '<missing>'} is unsupported.`)
  }

  async #pumpEvents(client: CodexAppServerJsonRpcClient): Promise<void> {
    try {
      for await (const event of client.subscribe()) {
        this.#acceptClientEvent(client, event)
      }
    } catch (error) {
      if (!this.#expectedStops.has(client)) this.#publishRuntimeFailure(error)
    }
  }

  #acceptClientEvent(
    client: CodexAppServerJsonRpcClient,
    event: CodexAppServerClientEvent
  ): void {
    if (event.channel === CODEX_MAIN_IPC_CHANNELS.event) {
      const mapped = mapCodexNotification(event.payload, this.#codexToGuiThread, this.#now)
      for (const runtimeEvent of mapped) {
        this.#appendEvent(runtimeEvent.threadId, runtimeEvent)
      }
      return
    }
    if (event.type === 'error') {
      this.#publishRuntimeFailure(new Error(event.error.message))
      return
    }
    if (event.type === 'closed') {
      if (this.#expectedStops.has(client)) return
      this.#publishRuntimeFailure(
        new Error(`Codex app-server connection closed: ${event.reason}`)
      )
    }
  }

  #acceptPendingRequest(request: CodexAppServerPendingRequest): void {
    const threadId = request.threadId
      ? this.#codexToGuiThread.get(request.threadId) ?? request.threadId
      : ''
    if (!threadId) return
    const requestId = String(request.requestId)
    this.#pendingRequestIds.set(requestId, request.requestId)
    if (request.kind === 'approval') {
      this.#appendEvent(threadId, {
        kind: 'approval_requested',
        turnId: request.turnId,
        itemId: request.itemId,
        approvalId: requestId,
        summary: request.summary,
        toolName: approvalToolName(request.method),
        meta: asPayload({ method: request.method })
      })
      return
    }
    this.#appendEvent(threadId, {
      kind: 'user_input_requested',
      turnId: request.turnId,
      itemId: request.itemId,
      requestId,
      questions: userInputQuestions(request.params)
    })
  }

  #publishRuntimeFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const threadIds = new Set([
      ...this.#threads.keys(),
      ...[...this.#streams.values()].map((stream) => stream.threadId)
    ])
    for (const threadId of threadIds) {
      this.#appendEvent(threadId, {
        kind: 'error',
        recoverable: true,
        severity: 'error',
        code: 'runtime_disconnected',
        message
      })
    }
  }

  #appendEvent(
    threadId: string,
    input: Record<string, unknown>
  ): RuntimeEvent {
    const event = this.#eventStore.append(threadId, input, this.#now().toISOString())
    for (const stream of this.#streams.values()) {
      if (stream.threadId !== threadId) continue
      this.#publishEvent?.(WORKSPACE_HOST_EVENT_KINDS.runtimeEvent, {
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        runtimeId: 'codex',
        threadId,
        streamId: stream.streamId,
        event: boundRuntimeEventPayload(threadId, asPayload(event))
      })
    }
    return event
  }

  #mapThread(
    rawThread: Record<string, unknown>,
    known?: ThreadBinding
  ): WorkspaceHostPayload {
    const codexThreadId = stringValue(rawThread.id) || known?.codexThreadId || ''
    const guiThreadId =
      known?.guiThreadId ||
      this.#codexToGuiThread.get(codexThreadId) ||
      codexThreadId
    const binding = known ?? this.#threads.get(guiThreadId)
    const now = this.#now().toISOString()
    return {
      id: guiThreadId,
      runtimeId: 'codex',
      title: binding?.title || threadTitle(rawThread) || 'Codex thread',
      updatedAt: dateValue(rawThread.updatedAt) || binding?.updatedAt || now,
      createdAt: dateValue(rawThread.createdAt) || binding?.createdAt || now,
      workspace:
        stringValue(rawThread.cwd) ||
        stringValue(rawThread.workspace) ||
        binding?.workspace ||
        this.#workspaceRoot,
      backendThreadId: codexThreadId,
      latestTurnId: latestTurnId(rawThread),
      latestTurnStatus: latestTurnStatus(rawThread)
    }
  }

  async #containedWorkspace(candidate?: string): Promise<string> {
    const requested = candidate?.trim() || this.#workspaceRoot
    if (!isAbsolute(requested)) {
      throw new Error('Remote Codex workspace must be an absolute server path.')
    }
    const resolved = resolve(requested)
    const rel = relative(this.#workspaceRoot, resolved)
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
      throw new Error('Remote Codex workspace is outside the authorized Workspace Host root.')
    }
    return realpath(resolved)
  }

  async #acceptContext(
    context: CodexWorkspaceHostOperationContext
  ): Promise<void> {
    if (context.workspaceRoot !== this.#workspaceRoot) {
      throw new Error('Codex runtime context belongs to another Workspace Host root.')
    }
    this.#publishEvent = context.publishEvent
    const environment = context.getProcessEnvironment?.() ?? {}
    const generation = context.getProcessEnvironmentGeneration?.()
      ?? this.#processEnvironmentGeneration + 1
    await this.#queueProcessEnvironmentChange(
      environment,
      generation,
      context.isProcessNetworkEgressReady?.()
    )
    const modelAccess = context.getModelAccess?.()
    const modelAccessGeneration = context.getModelAccessGeneration?.()
      ?? this.#modelAccessGeneration + 1
    await this.#queueModelAccessChange(
      modelAccess,
      modelAccessGeneration,
      context.isModelAccessReady?.() ?? modelAccessReady(modelAccess)
    )
  }

  #queueProcessEnvironmentChange(
    environment: NodeJS.ProcessEnv,
    generation: number,
    ready?: boolean
  ): Promise<void> {
    const snapshot = { ...environment }
    const change = this.#configurationChangeTail.then(
      () => this.#applyProcessEnvironmentChange(snapshot, generation, ready)
    )
    this.#configurationChangeTail = change.catch(() => undefined)
    return change
  }

  async #applyProcessEnvironmentChange(
    environment: NodeJS.ProcessEnv,
    generation: number,
    ready?: boolean
  ): Promise<void> {
    if (this.#disposed || generation < this.#processEnvironmentGeneration) return
    const fingerprint = proxyEnvironmentFingerprint(environment)
    const nextReady = ready ?? isScopedEgressEnvironment(environment)
    const configurationChanged =
      fingerprint !== this.#processEnvironmentFingerprint ||
      nextReady !== this.#networkEgressReady
    this.#processEnvironmentGeneration = generation
    if (!configurationChanged) return
    this.#processEnvironment = proxyEnvironment(environment)
    this.#processEnvironmentFingerprint = fingerprint
    this.#networkEgressReady = nextReady &&
      isScopedEgressEnvironment(this.#processEnvironment)

    const hadClient = Boolean(this.#client || this.#connectPromise)
    if (!hadClient) return
    this.#publishRuntimeStatus(
      'reconnecting',
      'Workspace egress lease changed; restarting remote Codex.'
    )
    await this.#stopCurrentClient()
    if (!this.#networkAccessReady()) this.#publishEgressUnavailable()
    if (!this.#modelAccessReady()) return
    try {
      await this.#ensureConnected()
      this.#publishRuntimeStatus(
        'initialize_done',
        'Remote Codex reconnected with current Workspace access.'
      )
    } catch (error) {
      this.#publishRuntimeFailure(error)
    }
  }

  #queueModelAccessChange(
    access: CodexWorkspaceHostModelAccess | undefined,
    generation: number,
    ready: boolean
  ): Promise<void> {
    const snapshot = access === undefined
      ? undefined
      : {
          baseUrl: access.baseUrl,
          authorization: { ...access.authorization },
          expiresAt: access.expiresAt
        }
    const change = this.#configurationChangeTail.then(
      () => this.#applyModelAccessChange(snapshot, generation, ready)
    )
    this.#configurationChangeTail = change.catch(() => undefined)
    return change
  }

  async #applyModelAccessChange(
    access: CodexWorkspaceHostModelAccess | undefined,
    generation: number,
    ready: boolean
  ): Promise<void> {
    if (this.#disposed || generation < this.#modelAccessGeneration) return
    const validated = ready && modelAccessReady(access) ? access : undefined
    const fingerprint = modelAccessFingerprint(validated)
    const changed = fingerprint !== this.#modelAccessFingerprint
    this.#modelAccessGeneration = generation
    if (!changed) return
    this.#modelAccess = validated
    this.#modelAccessFingerprint = fingerprint

    const hadClient = Boolean(this.#client || this.#connectPromise)
    if (!hadClient) return
    this.#publishRuntimeStatus(
      'reconnecting',
      validated
        ? 'Scoped Model Router access changed; restarting remote Codex.'
        : 'Scoped Model Router access is unavailable; remote Codex stopped.'
    )
    await this.#stopCurrentClient()
    if (!validated) {
      this.#publishModelAccessUnavailable()
      return
    }
    try {
      await this.#ensureConnected()
      this.#publishRuntimeStatus(
        'initialize_done',
        'Remote Codex reconnected with current scoped Model Router access.'
      )
    } catch (error) {
      this.#publishRuntimeFailure(error)
    }
  }

  async #stopCurrentClient(): Promise<void> {
    const client = this.#client
    const eventPump = this.#eventPump
    this.#client = undefined
    this.#connectPromise = undefined
    this.#eventPump = undefined
    this.#clientLaunchFingerprint = undefined
    this.#pendingRequestIds.clear()
    if (!client) return
    this.#expectedStops.add(client)
    await client.stop().catch(() => undefined)
    await eventPump?.catch(() => undefined)
  }

  #networkAccessReady(): boolean {
    return this.#networkEgressReady &&
      isScopedEgressEnvironment(this.#processEnvironment)
  }

  #modelAccessReady(): boolean {
    return modelAccessReady(this.#modelAccess)
  }

  #launchFingerprint(): string {
    return createHash('sha256')
      .update(this.#processEnvironmentFingerprint)
      .update('\0')
      .update(this.#modelAccessFingerprint)
      .digest('hex')
  }

  #publishRuntimeStatus(phase: string, message: string): void {
    for (const threadId of this.#activeThreadIds()) {
      this.#appendEvent(threadId, {
        kind: 'runtime_status',
        phase,
        message
      })
    }
  }

  #publishEgressUnavailable(): void {
    for (const threadId of this.#activeThreadIds()) {
      this.#appendEvent(threadId, {
        kind: 'error',
        recoverable: true,
        severity: 'error',
        code: 'workspace_egress_unavailable',
        message: 'Remote Codex stopped because its scoped Workspace egress lease is unavailable.'
      })
    }
  }

  #publishModelAccessUnavailable(): void {
    for (const threadId of this.#activeThreadIds()) {
      this.#appendEvent(threadId, {
        kind: 'error',
        recoverable: true,
        severity: 'error',
        code: 'model_access_unavailable',
        message: 'Remote Codex stopped because scoped Model Router access is unavailable.'
      })
    }
  }

  async #prepareManagedCodexHome(): Promise<void> {
    const modelAccess = this.#modelAccess
    if (!modelAccessReady(modelAccess)) {
      throw runtimeUnavailable(
        'model-access-unavailable',
        'Remote Codex scoped Model Router access is unavailable.'
      )
    }
    await Promise.all([
      mkdir(this.#codexHome, { recursive: true, mode: 0o700 }),
      ...['sessions', 'memories', 'logs'].map((name) =>
        mkdir(join(this.#codexHome, name), { recursive: true, mode: 0o700 })
      )
    ])
    await atomicWritePrivateFile(
      join(this.#codexHome, 'config.toml'),
      codexModelRouterConfig(modelAccess.baseUrl)
    )
  }

  #activeThreadIds(): Set<string> {
    return new Set([
      ...this.#threads.keys(),
      ...[...this.#streams.values()].map((stream) => stream.threadId)
    ])
  }

  async #loadThreadBindings(): Promise<void> {
    let decoded: unknown
    try {
      decoded = JSON.parse(await readFile(this.#stateFile, 'utf8'))
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return
      throw new Error('Remote Codex thread-binding state is unreadable.', {
        cause: error
      })
    }
    const state = record(decoded)
    if (
      state.schemaVersion !== THREAD_BINDING_STATE_SCHEMA_VERSION ||
      state.workspaceRoot !== this.#workspaceRoot
    ) {
      throw new Error('Remote Codex thread-binding state is incompatible.')
    }
    const bindings = arrayValue(state.threads)
    if (bindings.length > MAX_PERSISTED_THREAD_BINDINGS) {
      throw new Error('Remote Codex thread-binding state exceeds its limit.')
    }
    for (const value of bindings) {
      const binding = await persistedThreadBinding(value, this.#workspaceRoot)
      if (
        this.#threads.has(binding.guiThreadId) ||
        this.#codexToGuiThread.has(binding.codexThreadId)
      ) {
        throw new Error('Remote Codex thread-binding state contains duplicate IDs.')
      }
      this.#threads.set(binding.guiThreadId, binding)
      this.#codexToGuiThread.set(binding.codexThreadId, binding.guiThreadId)
    }
  }

  #persistThreadBindings(): Promise<void> {
    const persist = this.#stateWriteTail.then(async () => {
      const state = {
        schemaVersion: THREAD_BINDING_STATE_SCHEMA_VERSION,
        workspaceRoot: this.#workspaceRoot,
        threads: [...this.#threads.values()]
          .sort((left, right) => left.guiThreadId.localeCompare(right.guiThreadId))
          .map((binding) => ({ ...binding }))
      }
      const temporaryPath = `${this.#stateFile}.${randomUUID()}.tmp`
      await mkdir(dirname(this.#stateFile), { recursive: true, mode: 0o700 })
      try {
        await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600
        })
        await rename(temporaryPath, this.#stateFile)
      } finally {
        await rm(temporaryPath, { force: true })
      }
    })
    this.#stateWriteTail = persist.catch(() => undefined)
    return persist
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Remote Codex runtime has been disposed.')
  }
}

export async function createCodexWorkspaceHostRuntime(
  options: CodexWorkspaceHostRuntimeOptions
): Promise<CodexWorkspaceHostRuntime> {
  return CodexWorkspaceHostRuntime.create(options)
}

function remoteCodexCapabilities(
  networkAccessReady: boolean,
  modelAccessReady: boolean
): WorkspaceHostPayload {
  const unavailable = { available: false, reason: 'unsupported in remote server cohort' }
  if (!modelAccessReady) {
    const modelUnavailable = {
      available: false,
      reason: 'Scoped Workspace Model Router access is unavailable.'
    }
    return {
      contractVersion: 1,
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio',
      ready: false,
      networkAccess: networkAccessReady,
      matrix: {
        nativeHistory: modelUnavailable,
        nativeCompact: modelUnavailable,
        nativeResume: modelUnavailable,
        steer: modelUnavailable,
        fork: modelUnavailable,
        handoffImport: modelUnavailable,
        usage: modelUnavailable,
        eventReplay: modelUnavailable
      },
      events: {
        live: false,
        replayable: false,
        sequenced: false,
        delivery: 'async_iterable'
      },
      threadMaterialization: 'immediate',
      latency: {
        phaseEvents: false,
        firstTokenMetric: false,
        turnDurationMetric: false,
        supportedPhases: []
      },
      reasoning: {
        available: false,
        streaming: false,
        visibility: 'none',
        source: 'unknown'
      },
      model: {
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: false
      },
      tools: {
        toolCalling: false,
        commandExecution: modelUnavailable,
        fileChange: modelUnavailable,
        mcp: { ...modelUnavailable, search: modelUnavailable, toolCount: 0 },
        web: {
          ...modelUnavailable,
          fetch: modelUnavailable,
          search: modelUnavailable
        },
        research: modelUnavailable,
        computerUse: modelUnavailable,
        codeNavigation: {
          ...modelUnavailable,
          operations: [],
          languages: [],
          readonly: true
        },
        skills: modelUnavailable,
        subagents: modelUnavailable,
        diagnostics: modelUnavailable
      },
      observability: {
        fullTrace: { ...modelUnavailable, durable: false }
      },
      context: {
        state: modelUnavailable,
        compaction: modelUnavailable,
        goalResume: modelUnavailable,
        ledger: modelUnavailable,
        handoff: modelUnavailable
      },
      controls: {
        interrupt: false,
        steer: false,
        approval: 'unsupported',
        userInput: 'unsupported',
        compact: 'unsupported',
        fork: false,
        review: false,
        goals: false,
        todos: false,
        resumeSession: false
      },
      guard: { execution: 'observe' },
      storage: {
        guiOwnedThreads: true,
        backendThreadIdStable: true,
        usage: false,
        attachments: modelUnavailable,
        memory: modelUnavailable,
        checkpoints: modelUnavailable,
        workspaceReferences: modelUnavailable
      },
      capabilityDescriptors: []
    }
  }
  return {
    contractVersion: 1,
    runtimeId: 'codex',
    transport: 'jsonrpc_stdio',
    ready: modelAccessReady,
    networkAccess: networkAccessReady,
    matrix: {
      nativeHistory: { available: true },
      nativeCompact: unavailable,
      nativeResume: unavailable,
      steer: { available: true },
      fork: unavailable,
      handoffImport: unavailable,
      usage: unavailable,
      eventReplay: { available: true }
    },
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'async_iterable'
    },
    threadMaterialization: 'immediate',
    latency: {
      phaseEvents: true,
      firstTokenMetric: false,
      turnDurationMetric: false,
      supportedPhases: ['process_start', 'initialize_done', 'turn_start_sent', 'reconnecting']
    },
    reasoning: {
      available: true,
      streaming: true,
      visibility: 'summary',
      source: 'runtime_summary'
    },
    model: {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true
    },
    tools: {
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      mcp: { ...unavailable, search: unavailable, toolCount: 0 },
      web: { ...unavailable, fetch: unavailable, search: unavailable },
      research: unavailable,
      computerUse: unavailable,
      codeNavigation: {
        ...unavailable,
        operations: [],
        languages: [],
        readonly: true
      },
      skills: unavailable,
      subagents: unavailable,
      diagnostics: { available: true }
    },
    observability: {
      fullTrace: { ...unavailable, durable: true }
    },
    context: {
      state: unavailable,
      compaction: unavailable,
      goalResume: unavailable,
      ledger: unavailable,
      handoff: unavailable
    },
    controls: {
      interrupt: true,
      steer: true,
      approval: 'async',
      userInput: 'async',
      compact: 'unsupported',
      fork: false,
      review: false,
      goals: false,
      todos: false,
      resumeSession: false
    },
    guard: { execution: 'observe' },
    storage: {
      guiOwnedThreads: true,
      backendThreadIdStable: true,
      usage: false,
      attachments: unavailable,
      memory: unavailable,
      checkpoints: unavailable,
      workspaceReferences: unavailable
    },
    capabilityDescriptors: []
  }
}

function mapCodexNotification(
  payload: unknown,
  codexToGuiThread: ReadonlyMap<string, string>,
  now: () => Date
): Array<Record<string, unknown> & { threadId: string }> {
  const message = record(payload)
  const method = stringValue(message.method)
  const params = record(message.params)
  const codexThreadId =
    stringValue(params.threadId) ||
    stringValue(params.thread_id) ||
    stringValue(record(params.thread).id)
  if (!codexThreadId) return []
  const threadId = codexToGuiThread.get(codexThreadId) ?? codexThreadId
  const turnId =
    stringValue(params.turnId) ||
    stringValue(params.turn_id) ||
    stringValue(record(params.turn).id)
  const itemId =
    stringValue(params.itemId) ||
    stringValue(params.item_id) ||
    stringValue(record(params.item).id)
  const common = {
    threadId,
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {})
  }
  if (ASSISTANT_DELTA_METHODS.has(method)) {
    return [{
      ...common,
      kind: 'assistant_delta',
      itemId: itemId || `assistant-${turnId || randomUUID()}`,
      text: deltaText(params)
    }]
  }
  if (REASONING_DELTA_METHODS.has(method)) {
    return [{
      ...common,
      kind: 'reasoning_delta',
      itemId: itemId || `reasoning-${turnId || randomUUID()}`,
      text: deltaText(params),
      visibility: 'summary',
      source: 'runtime_summary'
    }]
  }
  if (method === 'turn/started') {
    return [{ ...common, kind: 'turn_lifecycle', state: 'running' }]
  }
  if (method === 'turn/completed') {
    return [{ ...common, kind: 'turn_lifecycle', state: 'completed' }]
  }
  if (method === 'turn/cancelled' || method === 'turn/canceled') {
    return [{ ...common, kind: 'turn_lifecycle', state: 'cancelled' }]
  }
  if (method === 'turn/failed' || method === 'error') {
    const error = record(params.error)
    return [
      { ...common, kind: 'turn_lifecycle', state: 'failed' },
      {
        ...common,
        kind: 'error',
        recoverable: false,
        severity: 'error',
        code: stringValue(error.code) || 'codex_runtime_error',
        message: stringValue(error.message) || stringValue(params.message) || 'Codex runtime error'
      }
    ]
  }
  if (method === 'thread/tokenUsage/updated') {
    const usage = tokenUsage(params)
    return usage ? [{ ...common, kind: 'usage', usage }] : []
  }
  if (method === 'item/started' || method === 'item/completed') {
    const item = record(params.item)
    const type = stringValue(item.type)
    if (type === 'agentMessage' || type === 'assistantMessage') {
      const text = itemText(item)
      if (!text) return []
      return [{
        ...common,
        kind: 'item_snapshot',
        item: {
          id: itemId || `assistant-${randomUUID()}`,
          turnId: turnId || undefined,
          kind: 'assistant_message',
          text,
          status: method === 'item/completed' ? 'completed' : 'running',
          createdAt: now().toISOString()
        }
      }]
    }
    if (type === 'commandExecution' || type === 'fileChange') {
      const detail = remoteToolDetail(item, type)
      return [{
        ...common,
        kind: 'item_snapshot',
        item: {
          id: itemId || `${type}-${randomUUID()}`,
          turnId: turnId || undefined,
          kind: 'tool',
          summary: type === 'fileChange' ? 'File changes' : 'Command execution',
          status: method === 'item/completed' ? 'completed' : 'running',
          toolKind: type === 'fileChange' ? 'file_change' : 'command_execution',
          meta: { source: 'codex-app-server' },
          ...(detail ? { detail } : {}),
          createdAt: now().toISOString()
        }
      }]
    }
  }
  return []
}

const ASSISTANT_DELTA_METHODS = new Set([
  'item/agentMessage/delta',
  'item/agentMessage/textDelta',
  'item/agentMessage/contentDelta',
  'item/assistantMessage/delta',
  'item/assistantMessage/textDelta',
  'item/assistantMessage/contentDelta'
])

const REASONING_DELTA_METHODS = new Set([
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/delta',
  'item/reasoning/summaryDelta',
  'item/reasoning/contentDelta',
  'item/agentReasoning/delta',
  'item/agentReasoning/textDelta'
])

function threadList(response: unknown): Record<string, unknown>[] {
  const root = record(response)
  const candidates = [
    root.data,
    root.threads,
    record(root.result).data,
    record(root.result).threads
  ]
  return candidates.find(Array.isArray)?.map(record) ?? []
}

function threadFromResponse(response: unknown): Record<string, unknown> {
  const root = record(response)
  return record(root.thread).id ? record(root.thread) : root
}

function threadTitle(thread: Record<string, unknown>): string {
  return stringValue(thread.name) ||
    stringValue(thread.title) ||
    stringValue(thread.preview)
}

function latestTurnId(thread: Record<string, unknown>): string {
  const turns = arrayValue(thread.turns).map(record)
  return stringValue(turns.at(-1)?.id)
}

function latestTurnStatus(thread: Record<string, unknown>): string {
  const turns = arrayValue(thread.turns).map(record)
  return stringValue(turns.at(-1)?.status)
}

function withEventSummary(
  thread: WorkspaceHostPayload | Record<string, unknown>,
  summary: StoredThreadEventSummary | undefined
): WorkspaceHostPayload {
  const value = record(thread)
  const latestTurnId = summary?.latestTurnId || stringValue(value.latestTurnId)
  const latestTurnStatus = summary?.latestTurnStatus || stringValue(value.latestTurnStatus)
  return {
    ...value,
    latestSeq: summary?.latestSeq ?? 0,
    ...(latestTurnId ? { latestTurnId } : {}),
    ...(latestTurnStatus
      ? { latestTurnStatus, status: latestTurnStatus }
      : {}),
    ...(summary ? { hasUserMessage: summary.hasUserMessage } : {}),
    ...(summary?.updatedAt ? { updatedAt: summary.updatedAt } : {})
  }
}

function eventToItem(event: RuntimeEvent): WorkspaceHostPayload[] {
  if (event.kind === 'user_message') {
    return [{
      id: stringValue(event.itemId) || `user-${event.seq}`,
      ...(stringValue(event.turnId) ? { turnId: stringValue(event.turnId) } : {}),
      kind: 'user_message',
      text: stringValue(event.text),
      createdAt: event.createdAt
    }]
  }
  if (event.kind === 'item_snapshot' && record(event.item).id) {
    return [asPayload(event.item)]
  }
  return []
}

function itemsFromTurnEvents(events: RuntimeEvent[]): WorkspaceHostPayload[] {
  const items: WorkspaceHostPayload[] = []
  const itemIndexes = new Map<string, number>()
  for (const event of events) {
    for (const item of eventToItem(event)) {
      const itemId = stringValue(record(item).id)
      const existingIndex = itemId ? itemIndexes.get(itemId) : undefined
      if (existingIndex === undefined) {
        if (itemId) itemIndexes.set(itemId, items.length)
        items.push(item)
        continue
      }
      items[existingIndex] = asPayload({
        ...record(items[existingIndex]),
        ...record(item)
      })
    }
  }
  return items
}

function turnStatusFromEvents(events: RuntimeEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.kind !== 'turn_lifecycle') continue
    const state = stringValue(event.state)
    if (state === 'completed' || state === 'success') return 'completed'
    if (state === 'failed' || state === 'error') return 'failed'
    if (
      state === 'aborted' ||
      state === 'cancelled' ||
      state === 'canceled' ||
      state === 'interrupted'
    ) return 'aborted'
    if (state === 'started' || state === 'running' || state === 'in_progress') return 'running'
  }
  return events.length > 0 ? 'running' : 'queued'
}

function terminalTurnState(value: unknown): 'completed' | 'failed' | 'aborted' | undefined {
  const state = stringValue(value).toLowerCase()
  if (state === 'completed' || state === 'success' || state === 'done') return 'completed'
  if (state === 'failed' || state === 'failure' || state === 'error') return 'failed'
  if (
    state === 'aborted' ||
    state === 'cancelled' ||
    state === 'canceled' ||
    state === 'interrupted'
  ) return 'aborted'
  return undefined
}

function eventTurnId(event: RuntimeEvent): string {
  return stringValue(event.turnId) || stringValue(record(event.item).turnId)
}

function itemText(item: Record<string, unknown>): string {
  const direct = stringValue(item.text) || stringValue(item.content)
  if (direct) return direct
  return arrayValue(item.content)
    .map(record)
    .map((part) => stringValue(part.text))
    .filter(Boolean)
    .join('')
}

function remoteToolDetail(
  item: Record<string, unknown>,
  type: 'commandExecution' | 'fileChange'
): string {
  if (type === 'commandExecution') {
    const output = stringValue(item.aggregatedOutput)
    if (output) return output
    const command = stringValue(item.command)
    if (command) return command
    return arrayValue(item.command)
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
  }
  try {
    return JSON.stringify(item.changes ?? [], null, 2)
  } catch {
    return ''
  }
}

function deltaText(params: Record<string, unknown>): string {
  return stringValue(params.delta) ||
    stringValue(params.text) ||
    stringValue(record(params.delta).text) ||
    stringValue(record(params.content).text)
}

function tokenUsage(params: Record<string, unknown>): WorkspaceHostPayload | null {
  const usage = record(params.tokenUsage)
  const source = Object.keys(usage).length > 0 ? usage : record(params.usage)
  if (Object.keys(source).length === 0) return null
  const inputTokens = numberValue(source.inputTokens) ?? numberValue(source.input_tokens)
  const outputTokens = numberValue(source.outputTokens) ?? numberValue(source.output_tokens)
  const totalTokens = numberValue(source.totalTokens) ??
    numberValue(source.total_tokens) ??
    ((inputTokens ?? 0) + (outputTokens ?? 0))
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    totalTokens
  }
}

function approvalToolName(method: string): string {
  if (method.includes('commandExecution') || method === 'execCommandApproval') {
    return 'command execution'
  }
  if (method.includes('fileChange') || method === 'applyPatchApproval') {
    return 'file change'
  }
  return 'tool'
}

function userInputQuestions(params: Record<string, unknown>): WorkspaceHostPayload[] {
  const questions = arrayValue(params.questions)
  if (questions.length === 0) {
    return [{
      id: 'input',
      header: 'Input',
      question: stringValue(params.prompt) || 'Codex requires input.',
      options: []
    }]
  }
  return questions.map((value, index) => {
    const question = record(value)
    return {
      id: stringValue(question.id) || `question-${index + 1}`,
      header: stringValue(question.header) || 'Input',
      question: stringValue(question.question) || stringValue(question.prompt) || 'Choose an option.',
      options: arrayValue(question.options).map((optionValue) => {
        const option = record(optionValue)
        return {
          label: stringValue(option.label) || stringValue(option.value),
          ...(stringValue(option.description)
            ? { description: stringValue(option.description) }
            : {})
        }
      })
    }
  })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value)
  if (!result) throw new Error(`${field} is required.`)
  return result
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function dateValue(value: unknown): string {
  const text = stringValue(value)
  if (!text) return ''
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString() : ''
}

function defaultStateDirectory(workspaceRoot: string): string {
  const workspaceKey = createHash('sha256')
    .update(workspaceRoot)
    .digest('hex')
    .slice(0, 32)
  return join(
    homedir(),
    '.sciforge',
    'workspace-host-state',
    workspaceKey,
    'codex-runtime'
  )
}

function proxyEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {}
  for (const key of PROXY_ENVIRONMENT_KEYS) {
    const value = environment[key]
    if (value) selected[key] = value
  }
  return selected
}

function withoutProxyEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected = { ...environment }
  for (const key of PROXY_ENVIRONMENT_KEYS) delete selected[key]
  return selected
}

function proxyEnvironmentFingerprint(environment: NodeJS.ProcessEnv): string {
  return createHash('sha256')
    .update(JSON.stringify(PROXY_ENVIRONMENT_KEYS.map((key) => [
      key,
      environment[key] ?? ''
    ])))
    .digest('hex')
}

function isScopedEgressEnvironment(environment: NodeJS.ProcessEnv): boolean {
  const values = [
    environment.HTTP_PROXY,
    environment.HTTPS_PROXY,
    environment.ALL_PROXY
  ]
  if (values.some((value) => !value) || new Set(values).size !== 1) return false
  try {
    const endpoint = new URL(values[0]!)
    const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return endpoint.protocol === 'http:' &&
      endpoint.username === 'sciforge-lease' &&
      endpoint.password.length >= 1 &&
      (hostname === '127.0.0.1' || hostname === '::1') &&
      endpoint.port !== '' &&
      endpoint.pathname === '/' &&
      endpoint.search === '' &&
      endpoint.hash === ''
  } catch {
    return false
  }
}

function modelAccessReady(
  access: CodexWorkspaceHostModelAccess | undefined
): access is CodexWorkspaceHostModelAccess {
  if (
    !access ||
    access.authorization.scheme !== 'bearer' ||
    access.authorization.token.length < 24 ||
    !Number.isFinite(Date.parse(access.expiresAt)) ||
    Date.parse(access.expiresAt) <= Date.now()
  ) {
    return false
  }
  try {
    const endpoint = new URL(access.baseUrl)
    const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return endpoint.protocol === 'http:' &&
      (hostname === '127.0.0.1' || hostname === '::1') &&
      endpoint.port !== '' &&
      (endpoint.pathname === '/v1' || endpoint.pathname === '/v1/') &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      endpoint.search === '' &&
      endpoint.hash === ''
  } catch {
    return false
  }
}

function modelAccessFingerprint(
  access: CodexWorkspaceHostModelAccess | undefined
): string {
  return createHash('sha256')
    .update(access?.baseUrl ?? '')
    .update('\0')
    .update(access?.authorization.token ?? '')
    .update('\0')
    .update(access?.expiresAt ?? '')
    .digest('hex')
}

function codexLaunchEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  processEnvironment: NodeJS.ProcessEnv,
  codexHome: string,
  modelAccess: CodexWorkspaceHostModelAccess
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  const preservedNames = new Set([
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'TERM',
    'COLORTERM',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
    'RUST_LOG',
    'RUST_BACKTRACE'
  ])
  for (const [name, value] of Object.entries(baseEnvironment)) {
    if (
      value !== undefined &&
      (preservedNames.has(name) || name.startsWith('LC_'))
    ) {
      environment[name] = value
    }
  }
  Object.assign(environment, proxyEnvironment(processEnvironment))
  environment.CODEX_HOME = codexHome
  environment[SCIFORGE_RUNTIME_API_KEY] = modelAccess.authorization.token
  environment.NO_PROXY = '127.0.0.1,localhost,::1'
  environment.no_proxy = '127.0.0.1,localhost,::1'
  return environment
}

function codexModelRouterConfig(baseUrl: string): string {
  return [
    `model = "${SCIFORGE_MODEL_ALIAS}"`,
    `model_provider = "${SCIFORGE_MODEL_PROVIDER_ID}"`,
    'hide_agent_reasoning = false',
    'show_raw_agent_reasoning = true',
    'model_reasoning_summary = "detailed"',
    'model_supports_reasoning_summaries = true',
    '',
    `[model_providers.${SCIFORGE_MODEL_PROVIDER_ID}]`,
    'name = "SciForge Model Router"',
    `base_url = "${tomlString(baseUrl)}"`,
    `env_key = "${SCIFORGE_RUNTIME_API_KEY}"`,
    'wire_api = "responses"',
    ''
  ].join('\n')
}

function tomlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

async function atomicWritePrivateFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function persistedThreadBinding(
  value: unknown,
  workspaceRoot: string
): Promise<ThreadBinding> {
  const input = record(value)
  const guiThreadId = requiredString(input.guiThreadId, 'state.guiThreadId')
  const codexThreadId = requiredString(input.codexThreadId, 'state.codexThreadId')
  const requestedWorkspace = requiredString(input.workspace, 'state.workspace')
  const createdAt = dateValue(input.createdAt)
  const updatedAt = dateValue(input.updatedAt)
  if (
    !isAbsolute(requestedWorkspace) ||
    !createdAt ||
    !updatedAt
  ) {
    throw new Error('Remote Codex thread-binding state contains an invalid binding.')
  }
  const workspace = await realpath(requestedWorkspace).catch(() => '')
  if (!workspace || !isContainedPath(workspaceRoot, workspace)) {
    throw new Error('Remote Codex thread-binding state escapes its Workspace Host root.')
  }
  const title = stringValue(input.title)
  return {
    guiThreadId,
    codexThreadId,
    workspace,
    createdAt,
    updatedAt,
    ...(title ? { title } : {})
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const rel = relative(root, resolve(candidate))
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}

function nodeErrorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

function runtimeUnavailable(
  code: 'model-access-unavailable' | 'egress-unavailable',
  message: string
): WorkspaceHostOperationError {
  return new WorkspaceHostOperationError({
    code,
    message,
    retryable: true
  })
}

function asPayload(value: unknown): WorkspaceHostPayload {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  return JSON.parse(serialized) as WorkspaceHostPayload
}

function assertNever(value: never): never {
  throw new Error(`Unsupported remote Codex method: ${String(value)}`)
}
