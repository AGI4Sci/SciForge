import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mainPerformanceMonitor } from '../../performance-monitor'

export type CodexDynamicMcpServerConfig = {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  enabledTools?: string[]
  disabled?: boolean
}

export type CodexAppServerDynamicToolFunctionSpec = {
  type: 'function'
  namespace?: string
  name: string
  description: string
  inputSchema: unknown
  deferLoading?: boolean
}
export type CodexAppServerDynamicToolSpec = CodexAppServerDynamicToolFunctionSpec

export type CodexAppServerDynamicToolCallRequest = {
  requestId: string | number
  threadId?: string
  turnId?: string
  callId?: string
  namespace?: string
  tool: string
  arguments: unknown
}

export type CodexAppServerDynamicToolCallOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string }

export type CodexAppServerDynamicToolCallResponse = {
  contentItems: CodexAppServerDynamicToolCallOutputContentItem[]
  success: boolean
}

export type McpToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: { title?: string }
}

export type CodexDynamicMcpClient = {
  listTools(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }>
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  close(): Promise<void>
}

export type CodexDynamicMcpToolBridgeOptions = {
  servers: readonly CodexDynamicMcpServerConfig[]
  clientFactory?: (server: CodexDynamicMcpServerConfig) => Promise<CodexDynamicMcpClient>
}

export type CodexDynamicMcpReleaseReason =
  | 'user_stop'
  | 'service_shutdown'
  | 'runtime_disconnected'
  | 'unknown'
  | (string & {})

export type CodexDynamicMcpLifecycleEvent = {
  at: string
  event: 'request_aborted' | 'server_closed'
  serverId: string
  namespace: string
  reason: CodexDynamicMcpReleaseReason
  requestId?: string
  threadId?: string
  turnId?: string
  toolName?: string
  activeRequestCount?: number
}

type CatalogTool = McpToolDescriptor & {
  originalName: string
  dynamicName: string
  flatName?: string
}

type ActiveMcpRequest = {
  controller: AbortController
  requestId?: string
  threadId?: string
  turnId?: string
  toolName?: string
}

type ServerState = {
  config: CodexDynamicMcpServerConfig
  namespace: string
  client?: CodexDynamicMcpClient
  clientPromise?: Promise<CodexDynamicMcpClient>
  catalog?: CatalogTool[]
  catalogPromise?: Promise<CatalogTool[]>
  activeRequests: Set<ActiveMcpRequest>
  lifecycleEvents: CodexDynamicMcpLifecycleEvent[]
}

const DEFAULT_TIMEOUT_MS = 30_000

export function createCodexDynamicMcpToolBridge(
  options: CodexDynamicMcpToolBridgeOptions
): CodexDynamicMcpToolBridge {
  return new CodexDynamicMcpToolBridge(options)
}

export class CodexDynamicMcpToolBridge {
  private readonly states: ServerState[]
  private readonly statesByNamespace = new Map<string, ServerState>()
  private readonly clientFactory: (server: CodexDynamicMcpServerConfig) => Promise<CodexDynamicMcpClient>
  private closedReason: CodexDynamicMcpReleaseReason | null = null

  constructor(options: CodexDynamicMcpToolBridgeOptions) {
    this.clientFactory = options.clientFactory ?? createSdkMcpClient
    const usedNamespaces = new Set<string>()
    this.states = options.servers
      .filter((server) => !server.disabled && server.id.trim() && server.command.trim())
      .map((server) => {
        const namespace = uniqueDynamicName(`mcp_${slug(server.id)}`, server.id, usedNamespaces, 64)
        const state: ServerState = {
          config: {
            ...server,
            args: server.args ?? [],
            timeoutMs: server.timeoutMs ?? DEFAULT_TIMEOUT_MS
          },
          namespace,
          activeRequests: new Set<ActiveMcpRequest>(),
          lifecycleEvents: []
        }
        this.statesByNamespace.set(namespace, state)
        return state
      })
  }

  hasConfiguredServers(): boolean {
    return this.states.length > 0
  }

  lifecycleEvents(): CodexDynamicMcpLifecycleEvent[] {
    return this.states.flatMap((state) => state.lifecycleEvents)
  }

  abortRequestsForTurn(
    threadId: string,
    turnId: string,
    reason: CodexDynamicMcpReleaseReason = 'user_stop'
  ): number {
    let aborted = 0
    for (const state of this.states) {
      aborted += this.abortStateRequests(state, reason, (request) => {
        if (request.turnId && request.turnId === turnId) return true
        return Boolean(request.threadId && request.threadId === threadId)
      })
    }
    return aborted
  }

  async dynamicTools(): Promise<CodexAppServerDynamicToolSpec[]> {
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.codex.dynamicMcp.tools')
    if (this.closedReason) return []
    try {
      const entries = await this.availableCatalogEntries()
      assignFlatToolNames(entries)
      return entries.map(({ tool }) => ({
        type: 'function',
        name: tool.flatName ?? tool.dynamicName,
        description: tool.description || tool.title || `MCP tool ${tool.originalName}`,
        inputSchema: providerSafeToolInputSchema(tool.inputSchema)
      }))
    } finally {
      mainPerformanceMonitor.sample('main.codex.dynamicMcp.tools.duration', mainPerformanceMonitor.now() - startedAt, {
        servers: this.states.length
      })
    }
  }

  async callTool(
    request: CodexAppServerDynamicToolCallRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.codex.dynamicMcp.call')
    let resolved: { state: ServerState; tool: CatalogTool } | null = null
    let retriedClosedConnection = false
    try {
      for (;;) {
        try {
          if (this.closedReason) {
            return failedDynamicToolResponse(`MCP dynamic tool bridge is closed: ${this.closedReason}.`)
          }
          resolved = await this.resolveTool(request)
          if (!resolved) {
            const name = request.namespace ? `${request.namespace}.${request.tool}` : request.tool
            return failedDynamicToolResponse(`No configured MCP dynamic tool matched ${name}.`)
          }
          return await this.invokeResolvedTool(resolved, request, options)
        } catch (error) {
          if (!retriedClosedConnection && isClosedMcpConnectionError(error) && !options.signal?.aborted) {
            retriedClosedConnection = true
            await this.resetClosedConnection(resolved?.state)
            resolved = null
            continue
          }
          const name = resolved?.tool.originalName ?? (request.namespace ? `${request.namespace}.${request.tool}` : request.tool)
          return failedDynamicToolResponse(
            `MCP tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    } finally {
      mainPerformanceMonitor.sample('main.codex.dynamicMcp.call.duration', mainPerformanceMonitor.now() - startedAt, {
        namespace: request.namespace,
        tool: request.tool
      })
    }
  }

  async close(reason: CodexDynamicMcpReleaseReason = 'service_shutdown'): Promise<void> {
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
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<{ state: ServerState; tool: CatalogTool } | null> {
    const normalized = normalizeToolRequestName(request)
    if (normalized.namespace) {
      const state = this.statesByNamespace.get(normalized.namespace)
      if (!state) return null
      const catalog = await this.catalogFor(state)
      const tool = catalog.find((candidate) => candidate.dynamicName === normalized.tool || candidate.flatName === normalized.tool)
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
        // unrelated dynamic tools from later servers.
        continue
      }
      loadedCatalogCount += 1
      const tool = catalog.find((candidate) => dynamicToolCallNames(candidate).has(normalized.tool))
      if (tool) matches.push({ state, tool })
    }
    if (loadedCatalogCount === 0 && firstCatalogError) throw firstCatalogError
    return matches.length === 1 ? matches[0] : null
  }

  private async invokeResolvedTool(
    resolved: { state: ServerState; tool: CatalogTool },
    request: CodexAppServerDynamicToolCallRequest,
    options: { signal?: AbortSignal }
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    const { state, tool } = resolved
    const callArguments = schemaSafeToolArguments(
      mcpToolArgumentsForRequest(state, tool, request),
      tool.inputSchema
    )
    const client = await this.clientFor(state)
    const result = await this.withTrackedRequest(
      state,
      {
        requestId: String(request.requestId),
        threadId: request.threadId,
        turnId: request.turnId,
        toolName: tool.originalName
      },
      options.signal,
      (signal) => client.callTool(
        { name: tool.originalName, arguments: callArguments },
        { signal, timeout: state.config.timeoutMs }
      )
    )
    return dynamicToolResponseFromMcpResult(result)
  }

  private async availableCatalogEntries(): Promise<Array<{ state: ServerState; tool: CatalogTool }>> {
    const listed = await Promise.all(this.states.map(async (state) => {
      try {
        return { state, catalog: await this.catalogFor(state) }
      } catch {
        // A failed optional MCP server should not prevent the Codex thread from starting.
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
    mainPerformanceMonitor.count('main.codex.dynamicMcp.catalog.load')
    const client = await this.clientFor(state)
    const tools: McpToolDescriptor[] = []
    let cursor: string | undefined
    try {
      do {
        const listed = await this.withTrackedRequest(
          state,
          { toolName: 'tools/list' },
          undefined,
          (signal) => client.listTools({ cursor, signal, timeout: state.config.timeoutMs })
        )
        tools.push(...listed.tools)
        cursor = listed.nextCursor
      } while (cursor)

      const enabled = new Set((state.config.enabledTools ?? []).filter(Boolean))
      const usedNames = new Set<string>()
      return tools
        .filter((tool) => !enabled.size || enabled.has(tool.name))
        .filter((tool) => tool.name.trim().length > 0)
        .map((tool) => ({
          ...tool,
          originalName: tool.name,
          dynamicName: uniqueDynamicName(slug(tool.name), tool.name, usedNames, 128)
        }))
    } finally {
      mainPerformanceMonitor.sample('main.codex.dynamicMcp.catalog.load.duration', mainPerformanceMonitor.now() - startedAt, {
        serverId: state.config.id,
        tools: tools.length
      })
    }
  }

  private async clientFor(state: ServerState): Promise<CodexDynamicMcpClient> {
    if (this.closedReason) throw new Error(`MCP dynamic tool bridge is closed: ${this.closedReason}.`)
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
    reason: CodexDynamicMcpReleaseReason,
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
    event: Omit<CodexDynamicMcpLifecycleEvent, 'at' | 'serverId' | 'namespace'>
  ): void {
    state.lifecycleEvents.push({
      at: new Date().toISOString(),
      serverId: state.config.id,
      namespace: state.namespace,
      ...event
    })
    if (state.lifecycleEvents.length > 50) {
      state.lifecycleEvents.splice(0, state.lifecycleEvents.length - 50)
    }
  }
}

async function createSdkMcpClient(server: CodexDynamicMcpServerConfig): Promise<CodexDynamicMcpClient> {
  const startedAt = mainPerformanceMonitor.now()
  mainPerformanceMonitor.count('main.codex.dynamicMcp.client.connect')
  const client = new Client({ name: `sciforge-codex-${server.id}`, version: '0.1.0' })
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
    mainPerformanceMonitor.sample('main.codex.dynamicMcp.client.connect.duration', mainPerformanceMonitor.now() - startedAt, {
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

export function dynamicToolResponseFromMcpResult(
  result: unknown
): CodexAppServerDynamicToolCallResponse {
  const record = asRecord(result)
  const success = record?.isError !== true
  const contentItems: CodexAppServerDynamicToolCallOutputContentItem[] = []
  for (const item of arrayValue(record?.content)) {
    contentItems.push(...dynamicContentItemsFromMcpContent(item))
  }
  if (record && record.structuredContent !== undefined) {
    contentItems.push({
      type: 'inputText',
      text: `structuredContent:\n${jsonText(record.structuredContent)}`
    })
  }
  if (contentItems.length === 0) {
    contentItems.push({
      type: 'inputText',
      text: result === undefined ? '' : jsonText(result)
    })
  }
  return { contentItems, success }
}

function dynamicContentItemsFromMcpContent(
  item: unknown
): CodexAppServerDynamicToolCallOutputContentItem[] {
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

function failedDynamicToolResponse(message: string): CodexAppServerDynamicToolCallResponse {
  return {
    contentItems: [{ type: 'inputText', text: message }],
    success: false
  }
}

function recordArguments(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  if (record) return record
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    return asRecord(JSON.parse(value) as unknown) ?? {}
  } catch {
    return {}
  }
}

function mcpToolArgumentsForRequest(
  state: ServerState,
  tool: CatalogTool,
  request: CodexAppServerDynamicToolCallRequest
): Record<string, unknown> {
  void state
  void tool
  return recordArguments(request.arguments)
}

function schemaSafeToolArguments(
  args: Record<string, unknown>,
  schema: unknown
): Record<string, unknown> {
  const repaired = repairJsonValueForSchema(args, schema)
  return asRecord(repaired) ?? args
}

function repairJsonValueForSchema(value: unknown, schema: unknown): unknown {
  const record = asRecord(schema)
  if (!record) return value
  const types = schemaTypes(record.type)
  if (types.includes('object') || asRecord(record.properties)) {
    const source = asRecord(value)
    if (!source) return value
    const properties = asRecord(record.properties)
    if (!properties) return value
    const out: Record<string, unknown> = { ...source }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) continue
      out[key] = repairJsonValueForSchema(out[key], propertySchema)
    }
    return out
  }
  if (types.includes('array')) {
    const source = arrayValue(value)
    if (!Array.isArray(value)) return value
    const maxItems = finiteNumber(record.maxItems)
    const bounded = maxItems === undefined ? source : source.slice(0, Math.max(0, Math.floor(maxItems)))
    if (record.items === undefined) return bounded
    return bounded.map((item) => repairJsonValueForSchema(item, record.items))
  }
  if (types.includes('number') || types.includes('integer')) {
    return repairNumberValueForSchema(value, record, types.includes('integer'))
  }
  return value
}

function repairNumberValueForSchema(
  value: unknown,
  schema: Record<string, unknown>,
  integer: boolean
): unknown {
  let number = typeof value === 'number' ? value : numericStringValue(value)
  if (!Number.isFinite(number)) return value
  const minimum = finiteNumber(schema.minimum)
  const maximum = finiteNumber(schema.maximum)
  const exclusiveMinimum = finiteNumber(schema.exclusiveMinimum)
  const exclusiveMaximum = finiteNumber(schema.exclusiveMaximum)
  if (minimum !== undefined) number = Math.max(number, minimum)
  if (maximum !== undefined) number = Math.min(number, maximum)
  if (exclusiveMinimum !== undefined && number <= exclusiveMinimum) {
    number = integer ? Math.floor(exclusiveMinimum + 1) : Number.EPSILON + exclusiveMinimum
  }
  if (exclusiveMaximum !== undefined && number >= exclusiveMaximum) {
    number = integer ? Math.ceil(exclusiveMaximum - 1) : exclusiveMaximum - Number.EPSILON
  }
  if (integer) number = Math.trunc(number)
  return number
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return arrayValue(value).filter((entry): entry is string => typeof entry === 'string')
}

function numericStringValue(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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

function mcpAbortError(reason: CodexDynamicMcpReleaseReason): Error {
  return new Error(`MCP worker request aborted: ${reason}`)
}

function isClosedMcpConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(connection|transport|stdio|stream|socket)\b.*\b(closed|ended|terminated)\b/i.test(message)
    || /\b(closed|ended|terminated)\b.*\b(connection|transport|stdio|stream|socket)\b/i.test(message)
}

function normalizeToolRequestName(request: CodexAppServerDynamicToolCallRequest): {
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

function assignFlatToolNames(entries: Array<{ state: ServerState; tool: CatalogTool }>): void {
  const counts = new Map<string, number>()
  for (const { tool } of entries) {
    counts.set(tool.dynamicName, (counts.get(tool.dynamicName) ?? 0) + 1)
  }

  const used = new Set<string>()
  for (const { state, tool } of entries) {
    const baseName = counts.get(tool.dynamicName) === 1
      ? tool.dynamicName
      : `${state.namespace}_${tool.dynamicName}`
    tool.flatName = uniqueDynamicName(baseName, `${state.namespace}.${tool.originalName}`, used, 128)
  }
}

function dynamicToolCallNames(tool: CatalogTool): Set<string> {
  return new Set([
    tool.flatName,
    tool.dynamicName
  ].filter((name): name is string => Boolean(name)))
}

function uniqueDynamicName(
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

function providerSafeToolInputSchema(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeJsonSchemaRecord(value)
  return {
    properties: {},
    ...sanitized,
    type: 'object',
    ...(asRecord(sanitized.properties) ? { properties: sanitized.properties } : {})
  }
}

const SAFE_JSON_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
  'nullable'
])

function sanitizeJsonSchemaRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (key.startsWith('$') || !SAFE_JSON_SCHEMA_KEYS.has(key)) continue
    switch (key) {
      case 'properties': {
        const properties = asRecord(raw)
        if (!properties) break
        out.properties = Object.fromEntries(
          Object.entries(properties).map(([name, property]) => [name, sanitizeJsonSchemaRecord(property)])
        )
        break
      }
      case 'items': {
        if (Array.isArray(raw)) {
          out.items = raw.map((item) => sanitizeJsonSchemaRecord(item))
        } else if (asRecord(raw)) {
          out.items = sanitizeJsonSchemaRecord(raw)
        }
        break
      }
      case 'required': {
        const required = arrayValue(raw).filter((item): item is string => typeof item === 'string' && item.length > 0)
        if (required.length) out.required = [...new Set(required)]
        break
      }
      case 'enum': {
        if (Array.isArray(raw)) out.enum = raw.filter(isJsonPrimitive)
        break
      }
      case 'additionalProperties': {
        if (typeof raw === 'boolean') {
          out.additionalProperties = raw
        } else if (asRecord(raw)) {
          out.additionalProperties = sanitizeJsonSchemaRecord(raw)
        }
        break
      }
      case 'type':
      case 'description':
      case 'pattern':
      case 'format': {
        if (typeof raw === 'string' && raw.length > 0) out[key] = raw
        break
      }
      case 'nullable': {
        if (typeof raw === 'boolean') out.nullable = raw
        break
      }
      default: {
        if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw
        break
      }
    }
  }
  if (asRecord(out.properties) && !out.type) out.type = 'object'
  return out
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
