export type JsonRecord = Record<string, unknown>

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseMcpJsonConfig(content: string): JsonRecord {
  const trimmed = content.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`MCP config must be JSON: ${message}`)
  }
  if (!isJsonRecord(parsed)) {
    throw new Error('MCP config must be a JSON object.')
  }
  return parsed
}

function buildStdioMcpServer(
  command: string,
  args: string[],
  options: {
    trustScope?: 'workspace' | 'user'
    trustedWorkspaceRoots?: string[]
    env?: JsonRecord
  } = {}
): JsonRecord {
  const trustScope = options.trustScope ?? 'user'
  return {
    enabled: true,
    transport: 'stdio',
    command,
    args,
    env: options.env ?? {},
    trustScope,
    ...(trustScope === 'workspace'
      ? {
          trustedWorkspaceRoots: options.trustedWorkspaceRoots?.length
            ? options.trustedWorkspaceRoots
            : ['/path/to/workspace']
        }
      : {}),
    timeoutMs: 30_000
  }
}

export function buildMcpConfig(
  id: string,
  command: string,
  args: string[],
  options?: Parameters<typeof buildStdioMcpServer>[2]
): JsonRecord {
  return {
    servers: {
      [id]: buildStdioMcpServer(command, args, options)
    }
  }
}

export function mcpServersFromConfig(config: JsonRecord): JsonRecord {
  const rootServers = isJsonRecord(config.servers) ? config.servers : undefined
  const capabilities = isJsonRecord(config.capabilities) ? config.capabilities : undefined
  const mcp = isJsonRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  const nestedServers = isJsonRecord(mcp?.servers) ? mcp.servers : undefined
  return {
    ...(nestedServers ?? {}),
    ...(rootServers ?? {})
  }
}

export function mcpConfigHasServer(content: string, id: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(mcpServersFromConfig(parseMcpJsonConfig(content)), id)
  } catch {
    return false
  }
}

export function customMcpConfigFragment(id: string, raw: string, fallback: JsonRecord): JsonRecord {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const parsed = parseMcpJsonConfig(trimmed)
  if (isJsonRecord(parsed.servers)) return parsed
  if (isJsonRecord(parsed.capabilities)) {
    const mcp = isJsonRecord(parsed.capabilities.mcp) ? parsed.capabilities.mcp : undefined
    if (isJsonRecord(mcp?.servers)) return { servers: mcp.servers }
  }
  if (parsed.command !== undefined || parsed.url !== undefined || parsed.transport !== undefined) {
    return { servers: { [id]: parsed } }
  }
  throw new Error('MCP JSON config must include a servers object or a single server object.')
}

export type McpJsonMergeResult = {
  alreadyExists: boolean
  changed: boolean
  text: string
}

export function mergeMcpJsonConfig(content: string, fragment: JsonRecord): McpJsonMergeResult {
  const current = parseMcpJsonConfig(content)
  const currentServers = mcpServersFromConfig(current)
  const fragmentServers = mcpServersFromConfig(fragment)
  const fragmentServerIds = Object.keys(fragmentServers)
  if (fragmentServerIds.length === 0) {
    throw new Error('MCP JSON config must include at least one server.')
  }
  const alreadyExists = fragmentServerIds.some((id) =>
    Object.prototype.hasOwnProperty.call(currentServers, id)
  )

  const fragmentRest = { ...fragment }
  delete fragmentRest.servers
  const mergedServers = { ...currentServers }
  let changed = false

  for (const [id, server] of Object.entries(fragmentServers)) {
    const existing = currentServers[id]
    if (!isJsonRecord(existing) || !isJsonRecord(server)) {
      if (existing !== server) changed = true
      mergedServers[id] = server
      continue
    }
    const nextServer = mergeExistingMcpServer(existing, server)
    if (JSON.stringify(nextServer) !== JSON.stringify(existing)) changed = true
    mergedServers[id] = nextServer
  }

  const next: JsonRecord = {
    ...current,
    ...fragmentRest
  }
  if (usesLocalRuntimeCapabilitiesMcpServers(current)) {
    const capabilities = isJsonRecord(next.capabilities) ? next.capabilities : {}
    const mcp = isJsonRecord(capabilities.mcp) ? capabilities.mcp : {}
    next.capabilities = {
      ...capabilities,
      mcp: {
        ...mcp,
        servers: mergedServers
      }
    }
    delete next.servers
  } else {
    next.servers = {
      ...mergedServers
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(current)) changed = true
  return { alreadyExists, changed, text: `${JSON.stringify(next, null, 2)}\n` }
}

function usesLocalRuntimeCapabilitiesMcpServers(config: JsonRecord): boolean {
  const capabilities = isJsonRecord(config.capabilities) ? config.capabilities : undefined
  const mcp = isJsonRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  return Boolean(mcp)
}

function mergeExistingMcpServer(existing: JsonRecord, incoming: JsonRecord): JsonRecord {
  const existingRoots = stringArray(existing.trustedWorkspaceRoots)
  const incomingRoots = stringArray(incoming.trustedWorkspaceRoots)
  const trustedWorkspaceRoots = [...new Set([...existingRoots, ...incomingRoots])]
  const next: JsonRecord = {
    ...existing,
    ...incoming
  }
  if (isJsonRecord(existing.env) || isJsonRecord(incoming.env)) {
    next.env = {
      ...(isJsonRecord(existing.env) ? existing.env : {}),
      ...(isJsonRecord(incoming.env) ? incoming.env : {})
    }
  }
  if (trustedWorkspaceRoots.length > 0) {
    next.trustScope = 'workspace'
    next.trustedWorkspaceRoots = trustedWorkspaceRoots
  }
  return next
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}
