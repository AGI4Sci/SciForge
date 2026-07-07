import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createHash } from 'node:crypto'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  McpCapabilityConfig,
  McpServerConfig
} from '../../contracts/capabilities.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  createMcpSearchProvider,
  mcpSearchDiagnostic,
  type McpSearchCatalogRecord,
  type McpSearchCatalogState,
  type McpSearchRuntimeDiagnostic
} from './mcp-tool-search.js'
import {
  mcpInputValidationFailure,
  schemaSafeMcpToolArguments
} from './mcp-schema-repair.js'

const GUI_COMPUTER_USE_MCP_SERVER_ID = 'gui_owl_computer_use'
const GUI_COMPUTER_USE_TOOL_NAME = 'computer_use'
const GUI_WORKSPACE_INTEL_MCP_SERVER_ID = 'gui_workspace_intel'
const GUI_WORKSPACE_TOOL_PREFIX = 'gui_workspace_'
const REMOTE_EXECUTOR_MCP_SERVER_ID = 'remote_executor'
const REMOTE_EXECUTOR_TOOL_PREFIX = 'remote_'
const DEFAULT_MCP_INHERITED_ENV_NAMES = process.platform === 'win32'
  ? [
      'APPDATA',
      'COMSPEC',
      'HOMEDRIVE',
      'HOMEPATH',
      'LOCALAPPDATA',
      'PATH',
      'PATHEXT',
      'PROCESSOR_ARCHITECTURE',
      'PROGRAMDATA',
      'PROGRAMFILES',
      'PROGRAMFILES(X86)',
      'SYSTEMDRIVE',
      'SYSTEMROOT',
      'TEMP',
      'TMP',
      'USERNAME',
      'USERPROFILE',
      'WINDIR'
    ]
  : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER']
const POSIX_FALLBACK_EXECUTABLE_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
]
const UPSTREAM_PROVIDER_PREFIX_SPECS: readonly {
  groups: readonly (readonly string[])[]
  separator?: string
}[] = [
  { groups: [['OPEN', 'AI']] },
  { groups: [['DEEP', 'SEEK']] },
  { groups: [['ANTHROPIC']] },
  { groups: [['QWEN']] },
  { groups: [['DASH', 'SCOPE']] },
  { groups: [['GEMINI']] },
  { groups: [['GOOGLE']] },
  { groups: [['GROQ']] },
  { groups: [['MISTRAL']] },
  { groups: [['COHERE']] },
  { groups: [['OPEN', 'ROUTER']] },
  { groups: [['AZURE'], ['OPEN', 'AI']], separator: '_' },
  { groups: [['TOGETHER']] },
  { groups: [['FIREWORKS']] },
  { groups: [['XAI']] },
  { groups: [['PERPLEXITY']] },
  { groups: [['MOONSHOT']] },
  { groups: [['ZHIPU']] },
  { groups: [['SILICON', 'FLOW']] },
  { groups: [['ARK']] }
]
const UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES = ['MODEL', 'BASE_URL', 'API_BASE', 'API_BASE_URL']
const UPSTREAM_PROVIDER_CONFIG_ENV_NAMES = ['MODEL_PROVIDER', 'KUN_BASE_URL']
const DIRECT_PROVIDER_WORKER_ENV_PREFIXES = [
  ['EDAG', 'LLM', ''].join('_'),
  ['SCIFORGE', 'IMAGE', ''].join('_')
]

export type McpToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  execution?: unknown
  icons?: unknown
  _meta?: Record<string, unknown>
}

export type McpClientLike = {
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

export type McpServerDiagnostic = {
  id: string
  enabled: boolean
  transport: McpServerConfig['transport']
  trustScope: McpServerConfig['trustScope']
  available: boolean
  status: 'disabled' | 'connected' | 'error'
  toolCount: number
  catalogFingerprint?: string
  catalogDrift?: boolean
  lastConnectedAt?: string
  lastError?: string
}

export type McpToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: McpServerDiagnostic[]
  search: McpSearchRuntimeDiagnostic
  connectedServers: number
  toolCount: number
  close: () => Promise<void>
}

export type McpToolProviderOptions = {
  clientFactory?: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso?: () => string
  reservedToolNames?: readonly string[]
}

type McpConnectionState = {
  serverId: string
  server: McpServerConfig
  client: McpClientLike
  clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso: () => string
  catalogFingerprint?: string
  catalogDrift?: boolean
  lastConnectedAt?: string
  lastError?: string
}

export async function buildMcpToolProviders(
  config: McpCapabilityConfig | undefined,
  options: McpToolProviderOptions = {}
): Promise<McpToolProviderBuildResult> {
  const providers: CapabilityToolProvider[] = []
  const directProviders: CapabilityToolProvider[] = []
  const alwaysAdvertisedDirectProviders: CapabilityToolProvider[] = []
  const diagnostics: McpServerDiagnostic[] = []
  const connected: McpConnectionState[] = []
  const directToolNames = new Set(options.reservedToolNames ?? [])
  const catalogState: McpSearchCatalogState = { records: [] }
  const mcp = config
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const clientFactory = options.clientFactory ?? createSdkMcpClient
  if (!mcp?.enabled) {
    return {
      providers,
      diagnostics,
      search: mcpSearchDiagnostic({
        config: config?.search ?? {
          enabled: false,
          mode: 'auto',
          autoThresholdToolCount: 24,
          topKDefault: 5,
          topKMax: 10,
          minScore: 0.15,
          bm25: { k1: 1.2, b: 0.75 }
        },
        active: false,
        indexedToolCount: 0,
        advertisedToolCount: 0,
        state: catalogState
      }),
      connectedServers: 0,
      toolCount: 0,
      close: async () => undefined
    }
  }

  for (const [serverId, server] of Object.entries(mcp.servers)) {
    if (!server.enabled) {
      diagnostics.push(serverDiagnostic({ serverId, server }, 'disabled', 0))
      continue
    }
    try {
      const client = await clientFactory(serverId, server)
      const state: McpConnectionState = {
        serverId,
        server,
        client,
        clientFactory,
        nowIso,
        lastConnectedAt: nowIso()
      }
      connected.push(state)
      const listed = await refreshMcpConnectionCatalog(state)
      catalogState.records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
      const tools = listed.flatMap((tool) => createMcpLocalTools(state, tool, directToolNames))
      const alwaysAdvertisedTools = tools.filter(isAlwaysAdvertisedMcpTool)
      directProviders.push({
        id: `mcp:${serverId}`,
        kind: 'mcp',
        enabled: true,
        available: true,
        tools
      })
      if (alwaysAdvertisedTools.length > 0) {
        alwaysAdvertisedDirectProviders.push({
          id: `mcp:${serverId}:always`,
          kind: 'mcp',
          enabled: true,
          available: true,
          tools: alwaysAdvertisedTools
        })
      }
      diagnostics.push(serverDiagnostic(state, 'connected', listed.length))
    } catch (error) {
      diagnostics.push(serverDiagnostic({ serverId, server }, 'error', 0, errorMessage(error)))
    }
  }

  const connectedServers = diagnostics.filter((diagnostic) => diagnostic.status === 'connected').length
  const toolCount = catalogState.records.length
  catalogState.lastRefreshedAt = nowIso()
  catalogState.catalogFingerprint = catalogFingerprint(catalogState.records.map((record) => record.toolId))
  const searchActive = shouldUseMcpSearch(mcp.search, toolCount) && connectedServers > 0
  if (searchActive) {
    providers.push(...alwaysAdvertisedDirectProviders)
    providers.push(createMcpSearchProvider({
      config: mcp.search,
      state: catalogState,
      refreshCatalog: async () => {
        try {
          const records: McpSearchCatalogRecord[] = []
          const previousFingerprint = catalogState.catalogFingerprint
          for (const state of connected) {
            const listed = await refreshMcpConnectionCatalog(state)
            records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
          }
          catalogState.records = records
          catalogState.lastError = undefined
          catalogState.lastRefreshedAt = nowIso()
          catalogState.catalogFingerprint = catalogFingerprint(records.map((record) => record.toolId))
          catalogState.catalogDrift = Boolean(previousFingerprint && previousFingerprint !== catalogState.catalogFingerprint)
          return records
        } catch (error) {
          catalogState.lastError = redactSecretText(errorMessage(error))
          throw error
        }
      },
      isServerTrusted: isMcpServerTrusted
    }))
  } else {
    providers.push(...directProviders)
  }
  const advertisedToolCount = providers.reduce((total, provider) => total + provider.tools.length, 0)
  return {
    providers,
    diagnostics,
    search: mcpSearchDiagnostic({
      config: mcp.search,
      active: searchActive,
      indexedToolCount: toolCount,
      advertisedToolCount,
      state: catalogState
    }),
    connectedServers,
    toolCount,
    close: async () => {
      await Promise.all(connected.map((state) => state.client.close().catch(() => undefined)))
    }
  }
}

export function normalizeMcpToolName(serverId: string, toolName: string): string {
  return `mcp_${slug(serverId)}_${slug(toolName)}`
}

export function isMcpServerTrusted(server: McpServerConfig, workspace: string): boolean {
  if (server.trustScope === 'user') return true
  const normalizedWorkspace = normalizePathForTrust(workspace)
  return server.trustedWorkspaceRoots.some((root) => {
    const normalizedRoot = normalizePathForTrust(root)
    return normalizedWorkspace === normalizedRoot || normalizedWorkspace.startsWith(`${normalizedRoot}/`)
  })
}

async function createSdkMcpClient(serverId: string, server: McpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: `sciforge-runtime-${serverId}`, version: '0.1.0' })
  const transport = createTransport(server)
  await client.connect(transport, { timeout: server.timeoutMs })
  return {
    listTools: (options) => {
      const params = options?.cursor ? { cursor: options.cursor } : undefined
      return client.listTools(params, {
        signal: options?.signal,
        timeout: options?.timeout
      })
    },
    callTool: (input, options) => client.callTool(input, undefined, options),
    close: () => client.close()
  }
}

function createTransport(server: McpServerConfig): Transport {
  switch (server.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: server.command ?? '',
        args: server.args,
        env: mcpStdioChildEnv(server.env),
        stderr: 'pipe'
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
        requestInit: { headers: server.headers }
      })
    case 'sse':
      return new SSEClientTransport(new URL(server.url ?? ''), {
        requestInit: { headers: server.headers },
        eventSourceInit: { fetch: fetchWithHeaders(server.headers) }
      })
  }
}

export function mcpStdioChildEnv(
  serverEnv: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of DEFAULT_MCP_INHERITED_ENV_NAMES) {
    const value = baseEnv[key]
    if (typeof value === 'string' && value && !value.startsWith('()')) env[key] = value
  }
  if (process.platform !== 'win32') {
    env.PATH = posixExecutablePath(env.PATH)
  }
  for (const [key, value] of Object.entries(serverEnv)) {
    if (value && !value.startsWith('()')) env[key] = value
  }
  for (const key of Object.keys(env)) {
    if (isBlockedDirectModelEnv(key)) delete env[key]
  }
  return env
}

function posixExecutablePath(current: string | undefined): string {
  const entries = new Set((current || '').split(':').filter(Boolean))
  for (const fallback of POSIX_FALLBACK_EXECUTABLE_PATHS) entries.add(fallback)
  return [...entries].join(':')
}

function isBlockedDirectModelEnv(key: string): boolean {
  const upstreamProviderPrefixes = upstreamProviderEnvPrefixes()
  if (
    upstreamProviderPrefixes.some((prefix) =>
      key === `${prefix}_API_KEY` ||
      (prefix === 'ANTHROPIC' && key === `${prefix}_AUTH_TOKEN`)
    )
  ) {
    return true
  }
  if (UPSTREAM_PROVIDER_CONFIG_ENV_NAMES.includes(key)) return true
  if (/^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(key)) return true
  if (DIRECT_PROVIDER_WORKER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) return true
  return upstreamProviderPrefixes.some((prefix) =>
    UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES.some((suffix) => key === `${prefix}_${suffix}`)
  )
}

function upstreamProviderEnvPrefixes(): string[] {
  return UPSTREAM_PROVIDER_PREFIX_SPECS.map(({ groups, separator = '' }) =>
    groups.map((group) => group.join('')).join(separator)
  )
}

function fetchWithHeaders(headers: Record<string, string>): typeof fetch {
  return (input, init) => {
    const mergedHeaders = new Headers(init?.headers)
    for (const [key, value] of Object.entries(headers)) {
      mergedHeaders.set(key, value)
    }
    return fetch(input, { ...init, headers: mergedHeaders })
  }
}

function createMcpLocalTools(
  state: McpConnectionState,
  descriptor: McpToolDescriptor,
  usedNames: Set<string>
): LocalTool[] {
  const canonicalName = normalizeMcpToolName(state.serverId, descriptor.name)
  const tools = [createMcpLocalTool(state, descriptor, canonicalName)]
  usedNames.add(canonicalName)

  const aliasName = remoteExecutorFlatToolAliasName(state, descriptor) ??
    computerUseFlatToolAliasName(state, descriptor)
  if (aliasName && !usedNames.has(aliasName)) {
    tools.push(createMcpLocalTool(state, descriptor, aliasName))
    usedNames.add(aliasName)
  }

  return tools
}

function createMcpLocalTool(
  state: McpConnectionState,
  descriptor: McpToolDescriptor,
  toolName: string
): LocalTool {
  return LocalToolHost.defineTool({
    name: toolName,
    description: descriptor.description ?? `MCP tool ${descriptor.name} from ${state.serverId}`,
    inputSchema: descriptor.inputSchema ?? { type: 'object' },
    policy: policyFromAnnotations(descriptor.annotations),
    metadata: {
      mcp: {
        serverId: state.serverId,
        toolName: descriptor.name,
        canonicalName: normalizeMcpToolName(state.serverId, descriptor.name)
      }
    },
    shouldAdvertise: (context: ToolHostContext) => isMcpServerTrusted(state.server, context.workspace),
    execute: async (args, context) => {
      if (!isMcpServerTrusted(state.server, context.workspace)) {
        return {
          output: { error: `MCP server ${state.serverId} is not trusted for this workspace` },
          isError: true
        }
      }
      const callArguments = schemaSafeMcpToolArguments(
        mcpToolArgumentsForContext(state, descriptor, args, context),
        descriptor.inputSchema
      )
      let result: unknown
      try {
        result = await callMcpToolWithReconnect(
          state,
          { name: descriptor.name, arguments: callArguments },
          context.abortSignal
        )
      } catch (error) {
        const validation = mcpInputValidationFailure(error)
        if (validation) return { output: validation, isError: true }
        throw error
      }
      return {
        output: {
          serverId: state.serverId,
          toolName: descriptor.name,
          result
        },
        isError: typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
      }
    }
  })
}

function remoteExecutorFlatToolAliasName(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): string | null {
  if (state.serverId !== REMOTE_EXECUTOR_MCP_SERVER_ID) return null
  if (!descriptor.name.startsWith(REMOTE_EXECUTOR_TOOL_PREFIX)) return null
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(descriptor.name)) return null
  return descriptor.name
}

function computerUseFlatToolAliasName(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): string | null {
  if (state.serverId !== GUI_COMPUTER_USE_MCP_SERVER_ID) return null
  if (descriptor.name !== GUI_COMPUTER_USE_TOOL_NAME) return null
  return GUI_COMPUTER_USE_TOOL_NAME
}

function isAlwaysAdvertisedMcpTool(tool: LocalTool): boolean {
  return tool.name === GUI_COMPUTER_USE_TOOL_NAME
}

async function listAllMcpTools(client: McpClientLike, timeout: number): Promise<McpToolDescriptor[]> {
  const tools: McpToolDescriptor[] = []
  let cursor: string | undefined
  do {
    const listed = await client.listTools({ cursor, timeout })
    tools.push(...listed.tools)
    cursor = listed.nextCursor
  } while (cursor)
  return tools
}

function createMcpSearchCatalogRecord(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): McpSearchCatalogRecord {
  return {
    toolId: `${state.serverId}/${descriptor.name}`,
    serverId: state.serverId,
    server: state.server,
    client: {
      callTool: (input, options) =>
        callMcpToolWithReconnect(state, input, options?.signal, options?.timeout)
    },
    descriptor,
    normalizedName: normalizeMcpToolName(state.serverId, descriptor.name),
    policy: policyFromAnnotations(descriptor.annotations),
    prepareArguments: (args, context) => schemaSafeMcpToolArguments(
      mcpToolArgumentsForContext(state, descriptor, args, context),
      descriptor.inputSchema
    )
  }
}

function mcpToolArgumentsForContext(
  state: McpConnectionState,
  descriptor: McpToolDescriptor,
  args: Record<string, unknown>,
  context: ToolHostContext
): Record<string, unknown> {
  if (state.serverId === GUI_WORKSPACE_INTEL_MCP_SERVER_ID && descriptor.name.startsWith(GUI_WORKSPACE_TOOL_PREFIX)) {
    const workspaceRoot = typeof args.workspaceRoot === 'string' && args.workspaceRoot.trim()
      ? args.workspaceRoot
      : context.workspace.trim()
    return workspaceRoot ? { ...args, workspaceRoot } : args
  }
  if (state.serverId === REMOTE_EXECUTOR_MCP_SERVER_ID && descriptor.name.startsWith(REMOTE_EXECUTOR_TOOL_PREFIX)) {
    return remoteExecutorArgumentsForContext(descriptor, args, context)
  }
  return args
}

function remoteExecutorArgumentsForContext(
  descriptor: McpToolDescriptor,
  args: Record<string, unknown>,
  context: ToolHostContext
): Record<string, unknown> {
  const remoteTargetId = context.remoteTargetId?.trim()
  if (!remoteTargetId) return args
  const properties = schemaProperties(descriptor.inputSchema)
  if (properties.target_id !== undefined && args.target_id === undefined) {
    return { ...args, target_id: remoteTargetId }
  }
  if (properties.targetId !== undefined && args.targetId === undefined) {
    return { ...args, targetId: remoteTargetId }
  }
  return args
}

function schemaProperties(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const properties = schema?.properties
  return properties && typeof properties === 'object' && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {}
}

async function refreshMcpConnectionCatalog(state: McpConnectionState): Promise<McpToolDescriptor[]> {
  const listed = await listAllMcpTools(state.client, state.server.timeoutMs)
  const nextFingerprint = catalogFingerprint(listed.map((tool) => tool.name))
  state.catalogDrift = Boolean(state.catalogFingerprint && state.catalogFingerprint !== nextFingerprint)
  state.catalogFingerprint = nextFingerprint
  state.lastError = undefined
  return listed
}

async function callMcpToolWithReconnect(
  state: McpConnectionState,
  input: { name: string; arguments: Record<string, unknown> },
  signal: AbortSignal | undefined,
  timeout = state.server.timeoutMs
): Promise<unknown> {
  try {
    return await state.client.callTool(input, { signal, timeout })
  } catch (error) {
    state.lastError = redactSecretText(errorMessage(error))
    if (signal?.aborted) throw error
    if (!isTransientMcpConnectionError(error)) throw error
    const client = await reconnectMcpConnection(state)
    return client.callTool(input, { signal, timeout })
  }
}

function isTransientMcpConnectionError(error: unknown): boolean {
  const message = errorMessage(error)
  return /\bnot connected\b/i.test(message)
    || /\b(connection|transport|stdio|stream|socket)\b.*\b(closed|ended|terminated|reset|stale|lost)\b/i.test(message)
    || /\b(closed|ended|terminated|reset|stale|lost)\b.*\b(connection|transport|stdio|stream|socket)\b/i.test(message)
}

async function reconnectMcpConnection(state: McpConnectionState): Promise<McpClientLike> {
  await state.client.close().catch(() => undefined)
  const client = await state.clientFactory(state.serverId, state.server)
  state.client = client
  state.lastConnectedAt = state.nowIso()
  state.lastError = undefined
  return client
}

function shouldUseMcpSearch(config: NonNullable<McpCapabilityConfig['search']>, toolCount: number): boolean {
  if (!config.enabled) return false
  if (config.mode === 'direct') return false
  if (config.mode === 'search') return true
  return toolCount >= config.autoThresholdToolCount
}

function policyFromAnnotations(annotation: McpToolDescriptor['annotations']): LocalTool['policy'] {
  if (annotation?.readOnlyHint && !annotation.openWorldHint && !annotation.destructiveHint) return 'auto'
  if (annotation?.destructiveHint) return 'on-request'
  if (annotation?.openWorldHint) return 'untrusted'
  return 'on-request'
}

function serverDiagnostic(
  state: { serverId: string; server: McpServerConfig; catalogFingerprint?: string; catalogDrift?: boolean; lastConnectedAt?: string },
  status: McpServerDiagnostic['status'],
  toolCount: number,
  lastError?: string
): McpServerDiagnostic {
  return {
    id: state.serverId,
    enabled: state.server.enabled,
    transport: state.server.transport,
    trustScope: state.server.trustScope,
    available: status === 'connected',
    status,
    toolCount,
    ...(state.catalogFingerprint ? { catalogFingerprint: state.catalogFingerprint } : {}),
    ...(state.catalogDrift !== undefined ? { catalogDrift: state.catalogDrift } : {}),
    ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
    ...(lastError ? { lastError: redactSecretText(lastError) } : {})
  }
}

function catalogFingerprint(values: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...values].sort()))
    .digest('hex')
    .slice(0, 16)
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}

function normalizePathForTrust(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
