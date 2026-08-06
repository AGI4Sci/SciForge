import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mainPerformanceMonitor } from '../../performance-monitor'
import type {
  RuntimeToolCallRequest,
  RuntimeToolCallResponse,
  RuntimeToolDefinition,
  RuntimeToolOutputContentItem,
  RuntimeToolReleaseReason
} from './runtime-tool-contract'

export type RuntimeMcpServerConfig = {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  enabledTools?: string[]
  disabled?: boolean
}

export type McpToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export type RuntimeMcpClient = {
  listTools(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }>
  callTool(
    input: { name: string; arguments: Record<string, unknown>; _meta?: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  close(): Promise<void>
}

export type RuntimeMcpToolGatewayOptions = {
  servers: readonly RuntimeMcpServerConfig[]
  clientFactory?: (server: RuntimeMcpServerConfig) => Promise<RuntimeMcpClient>
}

export type RuntimeMcpLifecycleEvent = {
  at: string
  event: 'request_aborted' | 'server_closed' | 'tool_unavailable'
  serverId: string
  namespace: string
  reason: RuntimeToolReleaseReason
  requestId?: string
  threadId?: string
  turnId?: string
  toolName?: string
  activeRequestCount?: number
  diagnosticCode?: RuntimeMcpSchemaDiagnosticCode
}

export type RuntimeMcpSchemaDiagnosticCode =
  | 'schema_root_not_object'
  | 'schema_properties_not_object'
  | 'schema_property_not_object'
  | 'schema_items_not_object'
  | 'schema_additional_properties_invalid'
  | 'schema_too_complex'
  | 'provider_schema_invalid'

export type RuntimeMcpToolUnavailableDiagnostic = {
  at: string
  event: 'tool_unavailable'
  serverId: string
  namespace: string
  reason: 'invalid_input_schema'
  toolName: string
  diagnosticCode: RuntimeMcpSchemaDiagnosticCode
}

type CatalogTool = McpToolDescriptor & {
  originalName: string
  catalogName: string
  catalogInputSchema: Record<string, unknown>
}

type ActiveMcpRequest = {
  controller: AbortController
  requestId?: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  toolName?: string
}

type ServerState = {
  config: RuntimeMcpServerConfig
  namespace: string
  client?: RuntimeMcpClient
  clientPromise?: Promise<RuntimeMcpClient>
  catalog?: CatalogTool[]
  catalogPromise?: Promise<CatalogTool[]>
  activeRequests: Set<ActiveMcpRequest>
  lifecycleEvents: RuntimeMcpLifecycleEvent[]
  unavailableToolDiagnostics: Map<string, RuntimeMcpToolUnavailableDiagnostic>
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_LIFECYCLE_EVENTS_PER_SERVER = 50
const MAX_UNAVAILABLE_TOOL_DIAGNOSTICS_PER_SERVER = 50
const MAX_CATALOG_PAGES_PER_SERVER = 100
const MAX_CATALOG_TOOLS_PER_SERVER = 2_000

class RuntimeMcpInvocationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly metadata: Pick<RuntimeToolCallResponse, 'failureClass' | 'retryable'> = {}
  ) {
    super(message)
    this.name = 'RuntimeMcpInvocationError'
  }
}

export function createRuntimeMcpToolGateway(
  options: RuntimeMcpToolGatewayOptions
): RuntimeMcpToolGateway {
  return new RuntimeMcpToolGateway(options)
}

export class RuntimeMcpToolGateway {
  private states: ServerState[] = []
  private readonly statesByNamespace = new Map<string, ServerState>()
  private readonly clientFactory: (server: RuntimeMcpServerConfig) => Promise<RuntimeMcpClient>
  private closedReason: RuntimeToolReleaseReason | null = null
  private serverConfigSignature = ''

  constructor(options: RuntimeMcpToolGatewayOptions) {
    this.clientFactory = options.clientFactory ?? createRuntimeMcpClient
    this.installServerStates(options.servers)
  }

  private installServerStates(servers: readonly RuntimeMcpServerConfig[]): void {
    const usedNamespaces = new Set<string>()
    this.statesByNamespace.clear()
    this.states = servers
      .filter((server) => !server.disabled && server.id.trim() && server.command.trim())
      .map((server) => {
        const namespace = uniqueToolName(`mcp_${slug(server.id)}`, server.id, usedNamespaces, 64)
        const state: ServerState = {
          config: {
            ...server,
            args: server.args ?? [],
            timeoutMs: server.timeoutMs ?? DEFAULT_TIMEOUT_MS
          },
          namespace,
          activeRequests: new Set<ActiveMcpRequest>(),
          lifecycleEvents: [],
          unavailableToolDiagnostics: new Map<string, RuntimeMcpToolUnavailableDiagnostic>()
        }
        this.statesByNamespace.set(namespace, state)
        return state
      })
    this.serverConfigSignature = serverConfigsSignature(this.states.map((state) => state.config))
  }

  hasConfiguredServers(): boolean {
    return this.states.length > 0
  }

  lifecycleEvents(): RuntimeMcpLifecycleEvent[] {
    return this.states.flatMap((state) => state.lifecycleEvents)
  }

  toolUnavailableDiagnostics(): RuntimeMcpToolUnavailableDiagnostic[] {
    return this.states.flatMap((state) => [...state.unavailableToolDiagnostics.values()])
  }

  abortRequestsForTurn(
    identity: { runtimeId: string; threadId: string; turnId: string },
    reason: RuntimeToolReleaseReason = 'user_stop'
  ): number {
    let aborted = 0
    for (const state of this.states) {
      aborted += this.abortStateRequests(state, reason, (request) => {
        return request.runtimeId === identity.runtimeId
          && request.threadId === identity.threadId
          && request.turnId === identity.turnId
      })
    }
    return aborted
  }

  async tools(query?: string): Promise<RuntimeToolDefinition[]> {
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.runtime.mcp.tools')
    if (this.closedReason) return []
    try {
      // Explicit discovery is allowed to pay the one-time catalog cost. A
      // server-name prefilter is not semantically complete and caused valid
      // description/title matches to disappear.
      const entries = await this.availableCatalogEntries(this.states)
      return entries.map(({ state, tool }) => ({
        type: 'function',
        namespace: state.namespace,
        providerId: state.config.id,
        providerToolName: tool.originalName,
        name: tool.catalogName,
        description: tool.description || tool.title || `MCP tool ${tool.originalName}`,
        inputSchema: tool.catalogInputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {})
      }))
    } finally {
      mainPerformanceMonitor.sample('main.runtime.mcp.tools.duration', mainPerformanceMonitor.now() - startedAt, {
        servers: this.states.length
      })
    }
  }

  async sync(servers: readonly RuntimeMcpServerConfig[]): Promise<boolean> {
    if (this.closedReason) return false
    const nextSignature = serverConfigsSignature(servers
      .filter((server) => !server.disabled && server.id.trim() && server.command.trim())
      .map(normalizedServerConfig))
    if (nextSignature === this.serverConfigSignature) return false

    const previous = this.states
    for (const state of previous) this.abortStateRequests(state, 'settings_changed')
    this.installServerStates(servers)
    await Promise.all(previous.map(async (state) => {
      const client = state.client ?? await state.clientPromise?.catch(() => undefined)
      await client?.close().catch(() => undefined)
    }))
    return true
  }

  async callTool(
    request: RuntimeToolCallRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<RuntimeToolCallResponse> {
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.runtime.mcp.call')
    let resolved: { state: ServerState; tool: CatalogTool } | null = null
    let retriedClosedConnection = false
    try {
      for (;;) {
        try {
          if (this.closedReason) {
            return failedRuntimeToolResponse(`MCP tool gateway is closed: ${this.closedReason}.`)
          }
          resolved = await this.resolveTool(request)
          if (!resolved) {
            const name = request.namespace ? `${request.namespace}.${request.tool}` : request.tool
            return failedRuntimeToolResponse(`No configured MCP tool matched ${name}.`)
          }
          return await this.invokeResolvedTool(resolved, request, options)
        } catch (error) {
          if (
            !retriedClosedConnection
            && isClosedMcpConnectionError(error)
            && !options.signal?.aborted
            && (!resolved || toolCallMayRetry(resolved.tool))
          ) {
            retriedClosedConnection = true
            await this.resetClosedConnection(resolved?.state)
            resolved = null
            continue
          }
          const name = resolved?.tool.originalName ?? (request.namespace ? `${request.namespace}.${request.tool}` : request.tool)
          const message = error instanceof Error ? error.message : String(error)
          return error instanceof RuntimeMcpInvocationError
            ? failedRuntimeToolResponse(`MCP tool ${name} failed: ${message}`, {
                errorCode: error.code,
                ...error.metadata
              })
            : failedRuntimeToolResponse(`MCP tool ${name} failed: ${message}`, {
                errorCode: options.signal?.aborted ? 'aborted' : 'mcp_tool_failed',
                failureClass: options.signal?.aborted ? 'aborted' : 'upstream_error',
                retryable: !options.signal?.aborted
              })
        }
      }
    } finally {
      mainPerformanceMonitor.sample('main.runtime.mcp.call.duration', mainPerformanceMonitor.now() - startedAt, {
        namespace: request.namespace,
        tool: request.tool
      })
    }
  }

  async close(reason: RuntimeToolReleaseReason = 'service_shutdown'): Promise<void> {
    this.closedReason = reason
    for (const state of this.states) {
      this.abortStateRequests(state, reason)
    }
    await Promise.all(this.states.map(async (state) => {
      const client = state.client ?? await state.clientPromise?.catch(() => undefined)
      await client?.close().catch(() => undefined)
      this.recordLifecycleEvent(state, {
        event: 'server_closed',
        reason
      })
      state.client = undefined
      state.clientPromise = undefined
      state.catalog = undefined
      state.catalogPromise = undefined
    }))
  }

  private async resolveTool(
    request: RuntimeToolCallRequest
  ): Promise<{ state: ServerState; tool: CatalogTool } | null> {
    const normalized = normalizeToolRequestName(request)
    if (normalized.namespace) {
      const state = this.statesByNamespace.get(normalized.namespace)
      if (!state) return null
      const catalog = await this.catalogFor(state)
      const tool = catalog.find((candidate) => candidate.catalogName === normalized.tool)
      return tool ? { state, tool } : null
    }

    const matches: Array<{ state: ServerState; tool: CatalogTool }> = []
    let firstCatalogError: unknown = null
    let loadedCatalogCount = 0
    for (const state of this.states) {
      let catalog: CatalogTool[]
      try {
        catalog = await this.catalogFor(state)
      } catch (error) {
        firstCatalogError ??= error
        // Unqualified tool lookup should not let one optional MCP server block
        // unrelated runtime tools from later servers.
        continue
      }
      loadedCatalogCount += 1
      const tool = catalog.find((candidate) => candidate.catalogName === normalized.tool)
      if (tool) matches.push({ state, tool })
    }
    if (loadedCatalogCount === 0 && firstCatalogError) throw firstCatalogError
    return matches.length === 1 ? matches[0] : null
  }

  private async invokeResolvedTool(
    resolved: { state: ServerState; tool: CatalogTool },
    request: RuntimeToolCallRequest,
    options: { signal?: AbortSignal }
  ): Promise<RuntimeToolCallResponse> {
    const { state, tool } = resolved
    const callArguments = mcpToolArgumentsForRequest(request)
    const client = await this.clientFor(state)
    const result = await this.withTrackedRequest(
      state,
      {
        requestId: String(request.requestId),
        runtimeId: request.runtimeId,
        threadId: request.threadId,
        turnId: request.turnId,
        toolName: tool.originalName
      },
      options.signal,
      (signal) => client.callTool(
        {
          name: tool.originalName,
          arguments: callArguments,
          ...(request.trustedInvocation && state.config.id === 'gui_owl_computer_use'
            ? { _meta: { 'io.sciforge/computer-use-invocation': request.trustedInvocation } }
            : {})
        },
        { signal, timeout: state.config.timeoutMs }
      )
    )
    return runtimeToolResponseFromMcpResult(result)
  }

  private async availableCatalogEntries(
    states: readonly ServerState[] = this.states
  ): Promise<Array<{ state: ServerState; tool: CatalogTool }>> {
    const listed = await Promise.all(states.map(async (state) => {
      try {
        return { state, catalog: await this.catalogFor(state) }
      } catch {
        // A failed optional MCP server should not prevent a runtime turn from starting.
        return null
      }
    }))
    return listed.flatMap((entry) => entry
      ? entry.catalog.map((tool) => ({ state: entry.state, tool }))
      : [])
  }

  private async catalogFor(state: ServerState): Promise<CatalogTool[]> {
    if (state.catalog) return state.catalog
    let retriedClosedConnection = false
    for (;;) {
      if (!state.catalogPromise) {
        state.catalogPromise = this.loadCatalog(state).catch((error) => {
          state.catalogPromise = undefined
          throw error
        })
      }
      try {
        state.catalog = await state.catalogPromise
        return state.catalog
      } catch (error) {
        if (!retriedClosedConnection && isClosedMcpConnectionError(error)) {
          retriedClosedConnection = true
          await this.resetClosedConnection(state)
          continue
        }
        throw error
      }
    }
  }

  private async loadCatalog(state: ServerState): Promise<CatalogTool[]> {
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.runtime.mcp.catalog.load')
    const client = await this.clientFor(state)
    const tools: McpToolDescriptor[] = []
    let cursor: string | undefined
    let pageCount = 0
    const seenCursors = new Set<string>()
    try {
      do {
        pageCount += 1
        if (pageCount > MAX_CATALOG_PAGES_PER_SERVER) {
          throw new Error(`MCP catalog exceeded ${MAX_CATALOG_PAGES_PER_SERVER} pages.`)
        }
        const listed = await this.withTrackedRequest(
          state,
          { toolName: 'tools/list' },
          undefined,
          (signal) => client.listTools({ cursor, signal, timeout: state.config.timeoutMs })
        )
        tools.push(...listed.tools)
        if (tools.length > MAX_CATALOG_TOOLS_PER_SERVER) {
          throw new Error(`MCP catalog exceeded ${MAX_CATALOG_TOOLS_PER_SERVER} tools.`)
        }
        cursor = listed.nextCursor
        if (cursor) {
          if (seenCursors.has(cursor)) throw new Error('MCP catalog returned a repeated cursor.')
          seenCursors.add(cursor)
        }
      } while (cursor)

      const enabled = new Set((state.config.enabledTools ?? []).filter(Boolean))
      const usedNames = new Set<string>()
      return tools
        .filter((tool) => !enabled.size || enabled.has(tool.name))
        .filter((tool) => tool.name.trim().length > 0)
        .flatMap((tool) => {
          const catalogSchema = catalogToolInputSchemaResult(tool.inputSchema)
          if (!catalogSchema.ok) {
            this.recordUnavailableTool(state, tool.name, catalogSchema.code)
            return []
          }
          return [{
            ...tool,
            originalName: tool.name,
            catalogName: uniqueToolName(slug(tool.name), tool.name, usedNames, 128),
            catalogInputSchema: catalogSchema.schema
          }]
        })
    } finally {
      mainPerformanceMonitor.sample('main.runtime.mcp.catalog.load.duration', mainPerformanceMonitor.now() - startedAt, {
        serverId: state.config.id,
        tools: tools.length
      })
    }
  }

  private async clientFor(state: ServerState): Promise<RuntimeMcpClient> {
    if (this.closedReason) throw new Error(`MCP tool gateway is closed: ${this.closedReason}.`)
    if (state.client) return state.client
    if (!state.clientPromise) {
      state.clientPromise = this.clientFactory(state.config).then((client) => {
        state.client = client
        return client
      }).catch((error) => {
        state.clientPromise = undefined
        throw error
      })
    }
    return state.clientPromise
  }

  private async resetClosedConnection(state?: ServerState): Promise<void> {
    const states = state ? [state] : this.states
    await Promise.all(states.map(async (candidate) => {
      const client = candidate.client ?? await candidate.clientPromise?.catch(() => undefined)
      candidate.client = undefined
      candidate.clientPromise = undefined
      candidate.catalog = undefined
      candidate.catalogPromise = undefined
      await client?.close().catch(() => undefined)
    }))
  }

  private async withTrackedRequest<T>(
    state: ServerState,
    metadata: Omit<ActiveMcpRequest, 'controller'>,
    signal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController()
    const request: ActiveMcpRequest = { controller, ...metadata }
    const unlink = linkAbortSignal(signal, controller)
    state.activeRequests.add(request)
    try {
      if (this.closedReason && !controller.signal.aborted) {
        controller.abort(mcpAbortError(this.closedReason))
      }
      return await run(controller.signal)
    } finally {
      unlink()
      state.activeRequests.delete(request)
    }
  }

  private abortStateRequests(
    state: ServerState,
    reason: RuntimeToolReleaseReason,
    matches: (request: ActiveMcpRequest) => boolean = () => true
  ): number {
    let aborted = 0
    for (const request of state.activeRequests) {
      if (!matches(request) || request.controller.signal.aborted) continue
      request.controller.abort(mcpAbortError(reason))
      aborted += 1
      this.recordLifecycleEvent(state, {
        event: 'request_aborted',
        reason,
        requestId: request.requestId,
        threadId: request.threadId,
        turnId: request.turnId,
        toolName: request.toolName,
        activeRequestCount: state.activeRequests.size
      })
    }
    return aborted
  }

  private recordLifecycleEvent(
    state: ServerState,
    event: Omit<RuntimeMcpLifecycleEvent, 'at' | 'serverId' | 'namespace'>
  ): void {
    state.lifecycleEvents.push({
      at: new Date().toISOString(),
      serverId: safeDiagnosticIdentifier(state.config.id, 64, state.namespace),
      namespace: state.namespace,
      ...event
    })
    if (state.lifecycleEvents.length > MAX_LIFECYCLE_EVENTS_PER_SERVER) {
      state.lifecycleEvents.splice(0, state.lifecycleEvents.length - MAX_LIFECYCLE_EVENTS_PER_SERVER)
    }
  }

  private recordUnavailableTool(
    state: ServerState,
    toolName: string,
    diagnosticCode: RuntimeMcpSchemaDiagnosticCode
  ): void {
    const boundedToolName = safeDiagnosticIdentifier(toolName, 128, 'unknown_tool')
    const key = `${boundedToolName}:${diagnosticCode}`
    if (state.unavailableToolDiagnostics.has(key)) return
    mainPerformanceMonitor.count('main.runtime.mcp.toolUnavailable', 1, {
      serverId: safeDiagnosticIdentifier(state.config.id, 64, state.namespace),
      diagnosticCode
    })
    const diagnostic: RuntimeMcpToolUnavailableDiagnostic = {
      at: new Date().toISOString(),
      event: 'tool_unavailable',
      serverId: safeDiagnosticIdentifier(state.config.id, 64, state.namespace),
      namespace: state.namespace,
      reason: 'invalid_input_schema',
      toolName: boundedToolName,
      diagnosticCode
    }
    state.unavailableToolDiagnostics.set(key, diagnostic)
    while (state.unavailableToolDiagnostics.size > MAX_UNAVAILABLE_TOOL_DIAGNOSTICS_PER_SERVER) {
      const oldest = state.unavailableToolDiagnostics.keys().next().value
      if (oldest === undefined) break
      state.unavailableToolDiagnostics.delete(oldest)
    }
    this.recordLifecycleEvent(state, {
      event: diagnostic.event,
      reason: diagnostic.reason,
      toolName: diagnostic.toolName,
      diagnosticCode: diagnostic.diagnosticCode
    })
  }
}

function safeDiagnosticIdentifier(value: string, maxLength: number, fallback: string): string {
  if (/[\\/]/.test(value)) {
    return `redacted_${createHash('sha256').update(value).digest('hex').slice(0, 12)}`.slice(0, maxLength)
  }
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '_').replace(/^_+|_+$/g, '')
  return (normalized || fallback).slice(0, maxLength)
}

function normalizedServerConfig(server: RuntimeMcpServerConfig): RuntimeMcpServerConfig {
  return {
    ...server,
    args: server.args ?? [],
    timeoutMs: server.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }
}

function serverConfigsSignature(servers: readonly RuntimeMcpServerConfig[]): string {
  const canonical = servers.map((server) => ({
    ...normalizedServerConfig(server),
    env: Object.fromEntries(Object.entries(server.env ?? {}).sort(([left], [right]) => left.localeCompare(right)))
  }))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function toolCallMayRetry(tool: CatalogTool): boolean {
  return tool.annotations?.readOnlyHint === true || tool.annotations?.idempotentHint === true
}

async function createRuntimeMcpClient(server: RuntimeMcpServerConfig): Promise<RuntimeMcpClient> {
  const startedAt = mainPerformanceMonitor.now()
  mainPerformanceMonitor.count('main.runtime.mcp.client.connect')
  const client = new Client({ name: `sciforge-runtime-${server.id}`, version: '0.1.0' })
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: server.env,
    stderr: 'pipe'
  })
  let recentStderr = ''
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    recentStderr = `${recentStderr}${String(chunk)}`.slice(-4_000)
  })
  const withStderr = (error: unknown): Error => {
    const message = error instanceof Error ? error.message : String(error)
    const stderr = recentStderr.trim()
    if (!stderr) return error instanceof Error ? error : new Error(message)
    return new Error(`${message}; ${server.id} stderr: ${stderr}`, { cause: error })
  }
  const timeout = server.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    await client.connect(transport, { timeout })
  } catch (error) {
    throw withStderr(error)
  } finally {
    mainPerformanceMonitor.sample('main.runtime.mcp.client.connect.duration', mainPerformanceMonitor.now() - startedAt, {
      serverId: server.id
    })
  }
  return {
    listTools: (options) => {
      const params = options?.cursor ? { cursor: options.cursor } : undefined
      return client.listTools(params, {
        signal: options?.signal,
        timeout: options?.timeout
      }).catch((error: unknown) => {
        throw withStderr(error)
      })
    },
    callTool: (input, options) => client.callTool(input, undefined, options).catch((error: unknown) => {
      throw withStderr(error)
    }),
    close: () => client.close()
  }
}

export function runtimeToolResponseFromMcpResult(
  result: unknown
): RuntimeToolCallResponse {
  const record = asRecord(result)
  const structuredContent = record?.structuredContent
  const structuredRecord = asRecord(structuredContent)
  const structuredError = asRecord(structuredRecord?.error)
  const errorCode = stringValue(structuredError?.code) ||
    stringValue(structuredRecord?.errorCode) ||
    stringValue(record?.errorCode)
  const failureClass = stringValue(structuredError?.failureClass) ||
    stringValue(structuredRecord?.failureClass) ||
    stringValue(record?.failureClass)
  const retryable = booleanValue(structuredError?.retryable) ??
    booleanValue(structuredRecord?.retryable) ??
    booleanValue(record?.retryable)
  const recoveryGuidance = stringValue(structuredError?.recoveryGuidance) ||
    stringValue(structuredRecord?.recoveryGuidance) ||
    stringValue(record?.recoveryGuidance)
  const providerStage = stringValue(structuredError?.providerStage) ||
    stringValue(structuredRecord?.providerStage) ||
    stringValue(record?.providerStage)
  const resourceIdentity = stringValue(structuredRecord?.resourceRef) ||
    stringValue(structuredRecord?.resourceIdentity) ||
    stringValue(record?.resourceRef)
  const evidenceDelta = booleanValue(structuredRecord?.evidenceDelta) ??
    booleanValue(record?.evidenceDelta)
  const stateChanged = booleanValue(structuredRecord?.changed) ??
    booleanValue(structuredRecord?.stateChanged) ??
    booleanValue(record?.changed)
  const success = record?.isError !== true && !structuredError && !errorCode
  const contentItems: RuntimeToolOutputContentItem[] = []
  for (const item of arrayValue(record?.content)) {
    contentItems.push(...runtimeContentItemsFromMcpContent(item))
  }
  if (record && structuredContent !== undefined) {
    contentItems.push({
      type: 'inputText',
      text: `structuredContent:\n${jsonText(structuredContent)}`
    })
  }
  if (contentItems.length === 0) {
    contentItems.push({
      type: 'inputText',
      text: result === undefined ? '' : jsonText(result)
    })
  }
  return {
    contentItems,
    success,
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(failureClass ? { failureClass } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(recoveryGuidance ? { recoveryGuidance } : {}),
    ...(providerStage ? { providerStage } : {}),
    ...(resourceIdentity ? { resourceIdentity } : {}),
    ...(evidenceDelta !== undefined ? { evidenceDelta } : {}),
    ...(stateChanged !== undefined ? { stateChanged } : {})
  }
}

function runtimeContentItemsFromMcpContent(
  item: unknown
): RuntimeToolOutputContentItem[] {
  const record = asRecord(item)
  if (!record) return [{ type: 'inputText', text: jsonText(item) }]
  const type = stringValue(record.type)
  if (type === 'text') return [{ type: 'inputText', text: stringValue(record.text) }]
  if (type === 'image') {
    const imageUrl = stringValue(record.imageUrl) || imageDataUrl(record)
    if (imageUrl) return [{ type: 'inputImage', imageUrl }]
  }
  return [{ type: 'inputText', text: jsonText(item) }]
}

function imageDataUrl(record: Record<string, unknown>): string {
  const data = stringValue(record.data)
  if (!data) return ''
  const mimeType = stringValue(record.mimeType) || 'image/png'
  if (data.startsWith('data:')) return data
  return `data:${mimeType};base64,${data}`
}

function failedRuntimeToolResponse(
  message: string,
  metadata: Pick<RuntimeToolCallResponse, 'errorCode' | 'failureClass' | 'retryable'> = {}
): RuntimeToolCallResponse {
  return {
    contentItems: [{ type: 'inputText', text: message }],
    success: false,
    ...metadata
  }
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function recordArguments(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  if (record) return record
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return asRecord(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

function mcpToolArgumentsForRequest(
  request: RuntimeToolCallRequest
): Record<string, unknown> {
  const parsed = recordArguments(request.arguments)
  if (!parsed) throw new RuntimeMcpInvocationError(
    'invalid_arguments',
    'MCP tool arguments must be a JSON object.',
    { failureClass: 'invalid_arguments', retryable: true }
  )
  return parsed
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => undefined
  }
  const abort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

function mcpAbortError(reason: RuntimeToolReleaseReason): Error {
  return new Error(`MCP worker request aborted: ${reason}`)
}

function isClosedMcpConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(connection|transport|stdio|stream|socket)\b.*\b(closed|ended|terminated)\b/i.test(message)
    || /\b(closed|ended|terminated)\b.*\b(connection|transport|stdio|stream|socket)\b/i.test(message)
}

function normalizeToolRequestName(request: RuntimeToolCallRequest): {
  namespace?: string
  tool: string
} {
  if (request.namespace) return { namespace: request.namespace, tool: request.tool }
  const separator = request.tool.indexOf('.')
  if (separator <= 0 || separator >= request.tool.length - 1) return { tool: request.tool }
  return {
    namespace: request.tool.slice(0, separator),
    tool: request.tool.slice(separator + 1)
  }
}

function uniqueToolName(
  rawBase: string,
  original: string,
  used: Set<string>,
  maxLength: number
): string {
  const base = (rawBase || 'tool').slice(0, maxLength)
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  const suffix = `_${createHash('sha256').update(original).digest('hex').slice(0, 8)}`
  const hashed = `${base.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`
  if (!used.has(hashed)) {
    used.add(hashed)
    return hashed
  }
  for (let index = 2; ; index += 1) {
    const indexedSuffix = `${suffix}_${index}`
    const candidate = `${base.slice(0, Math.max(1, maxLength - indexedSuffix.length))}${indexedSuffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

function slug(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tool'
}

function jsonText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value, null, 2)
    return text === undefined ? '' : text
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

type CatalogToolInputSchemaResult =
  | { ok: true; schema: Record<string, unknown> }
  | { ok: false; code: RuntimeMcpSchemaDiagnosticCode }

function catalogToolInputSchemaResult(value: unknown): CatalogToolInputSchemaResult {
  const sourceIssue = validateInputSchemaStructure(value)
  if (sourceIssue) return { ok: false, code: sourceIssue }
  const schema = compactCatalogSchema(value)
  const providerIssue = validateInputSchemaStructure(schema, { requireRoot: true })
  return providerIssue
    ? { ok: false, code: 'provider_schema_invalid' }
    : { ok: true, schema }
}

function validateInputSchemaStructure(
  value: unknown,
  options: { requireRoot?: boolean } = {}
): RuntimeMcpSchemaDiagnosticCode | null {
  // MCP descriptors historically omitted inputSchema for no-argument tools.
  // Preserve that compatibility by advertising an empty object schema.
  if (value === undefined && !options.requireRoot) return null
  const root = asRecord(value)
  if (!root) return 'schema_root_not_object'
  if (root.type !== undefined && root.type !== 'object') return 'schema_root_not_object'
  return validateSchemaNodes(root)
}

function validateSchemaNodes(root: Record<string, unknown>): RuntimeMcpSchemaDiagnosticCode | null {
  const pending = [root]
  const seen = new Set<Record<string, unknown>>()
  while (pending.length > 0) {
    const schema = pending.pop()!
    if (seen.has(schema)) return 'provider_schema_invalid'
    seen.add(schema)
    if (seen.size > 10_000) return 'schema_too_complex'

    if (schema.properties !== undefined) {
      const properties = asRecord(schema.properties)
      if (!properties) return 'schema_properties_not_object'
      for (const property of Object.values(properties)) {
        const propertySchema = asRecord(property)
        if (!propertySchema) return 'schema_property_not_object'
        pending.push(propertySchema)
      }
    }
    if (schema.items !== undefined) {
      const items = asRecord(schema.items)
      if (!items) return 'schema_items_not_object'
      pending.push(items)
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      const additional = asRecord(schema.additionalProperties)
      if (!additional) return 'schema_additional_properties_invalid'
      pending.push(additional)
    }
  }
  return null
}

function compactCatalogSchema(value: unknown): Record<string, unknown> {
  const root = asRecord(value) ?? {}
  const properties = asRecord(root.properties) ?? {}
  const compactProperties = Object.fromEntries(Object.entries(properties).map(([name, property]) => [
    name,
    compactCatalogProperty(asRecord(property) ?? {})
  ]))
  const required = arrayValue(root.required)
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return {
    type: 'object',
    properties: compactProperties,
    ...(required.length ? { required: [...new Set(required)] } : {})
  }
}

function compactCatalogProperty(schema: Record<string, unknown>): Record<string, unknown> {
  const type = typeof schema.type === 'string'
    ? schema.type
    : asRecord(schema.properties)
      ? 'object'
      : schema.items !== undefined
        ? 'array'
        : undefined
  const description = typeof schema.description === 'string'
    ? schema.description.slice(0, 1_000)
    : undefined
  const enumValues = Array.isArray(schema.enum)
    ? schema.enum.filter(isJsonPrimitive).slice(0, 64)
    : []
  return {
    ...(type ? { type } : {}),
    ...(description ? { description } : {}),
    ...(enumValues.length ? { enum: enumValues } : {})
  }
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
