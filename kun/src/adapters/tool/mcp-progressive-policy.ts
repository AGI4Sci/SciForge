import type { ToolHostContext } from '../../ports/tool-host.js'

export const MCP_PROGRESSIVE_DISCOVERY_TOOL_NAMES = [
  'mcp_search',
  'mcp_describe',
  'mcp_call'
] as const

const MCP_PROGRESSIVE_DISCOVERY_TOOL_NAME_SET = new Set<string>(
  MCP_PROGRESSIVE_DISCOVERY_TOOL_NAMES
)

export function isProgressiveMcpDiscoveryTool(toolName: string): boolean {
  return MCP_PROGRESSIVE_DISCOVERY_TOOL_NAME_SET.has(toolName)
}

export function isCanonicalMcpToolName(toolName: string): boolean {
  return toolName.startsWith('mcp_') && !isProgressiveMcpDiscoveryTool(toolName) && toolName !== 'mcp_refresh_catalog'
}

/**
 * A strict direct-MCP allow-list predates progressive discovery. When discovery
 * hides those direct tools, expose only the read/dispatch gateway needed to
 * reach them. The gateway itself applies the same direct-tool scope.
 */
export function allowsProgressiveMcpDiscoveryGateway(
  toolName: string,
  context: ToolHostContext | undefined
): boolean {
  if (!isProgressiveMcpDiscoveryTool(toolName)) return false
  if (context?.explicitStrictAllowedToolNames !== true) return false
  return context.allowedToolNames?.some(isCanonicalMcpToolName) === true
}

export function strictCanonicalMcpToolAllowList(
  context: ToolHostContext
): ReadonlySet<string> | undefined {
  if (context.explicitStrictAllowedToolNames !== true || !context.allowedToolNames) return undefined
  const names = context.allowedToolNames.filter(isCanonicalMcpToolName)
  return names.length > 0 ? new Set(names) : undefined
}
