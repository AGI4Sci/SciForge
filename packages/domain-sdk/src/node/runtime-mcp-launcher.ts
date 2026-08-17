import { posix, win32 } from 'node:path'

export const DOMAIN_RUNTIME_MCP_NODE_ENTRY =
  'out/main/domain-runtime-mcp-node-entry.js'
export const DOMAIN_RUNTIME_MCP_SELECTOR_FLAG =
  '--sciforge-domain-runtime-mcp'

export type DomainRuntimeMcpLaunchConfig = Readonly<{
  appPath: string
  isPackaged: boolean
}>

export type DomainRuntimeMcpServerLauncher = (
  argv: string[]
) => void | Promise<void>

/**
 * Builds the argv for the one Host-owned launcher shared by installed domain
 * MCP servers. The contribution ID is the generated composition key; the Host
 * never needs a package- or domain-specific executable entry.
 */
export function buildDomainRuntimeMcpProcessArgs(
  launch: DomainRuntimeMcpLaunchConfig,
  contributionId: string,
  serverArgs: readonly string[] = []
): string[] {
  const normalizedContributionId = contributionId.trim()
  if (!normalizedContributionId) {
    throw new Error('Domain runtime MCP contribution ID is required.')
  }
  return [
    resolveDomainRuntimeMcpNodeEntryPath(launch),
    DOMAIN_RUNTIME_MCP_SELECTOR_FLAG,
    normalizedContributionId,
    ...serverArgs
  ]
}

export function resolveDomainRuntimeMcpNodeEntryPath(
  launch: DomainRuntimeMcpLaunchConfig
): string {
  const appRoot = unpackedApplicationRoot(launch)
  return usesPosixPath(appRoot)
    ? posix.join(appRoot, DOMAIN_RUNTIME_MCP_NODE_ENTRY)
    : win32.join(appRoot, DOMAIN_RUNTIME_MCP_NODE_ENTRY)
}

/** Returns null only when argv is not intended for the domain MCP launcher. */
export function selectedDomainRuntimeMcpContributionId(
  argv: readonly string[]
): string | null {
  const selectorIndexes = argv.flatMap((value, index) =>
    value === DOMAIN_RUNTIME_MCP_SELECTOR_FLAG ? [index] : []
  )
  if (selectorIndexes.length === 0) return null
  if (selectorIndexes.length !== 1) {
    throw new Error('Domain runtime MCP selector must be provided exactly once.')
  }
  const selected = argv[selectorIndexes[0]! + 1]?.trim()
  if (!selected || selected.startsWith('--')) {
    throw new Error('Domain runtime MCP selector is missing its contribution ID.')
  }
  return selected
}

function unpackedApplicationRoot(launch: DomainRuntimeMcpLaunchConfig): string {
  if (!launch.isPackaged) return launch.appPath
  return /(?:^|[/\\])app\.asar$/u.test(launch.appPath)
    ? `${launch.appPath}.unpacked`
    : launch.appPath
}

function usesPosixPath(path: string): boolean {
  return path.includes('/') && !path.includes('\\')
}
