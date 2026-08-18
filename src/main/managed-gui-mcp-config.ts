import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { resolveElectronRunAsNodeExecutable } from '@sciforge/domain-sdk/node/electron-node-executable'

export type JsonRecord = Record<string, unknown>

export type ManagedGuiMcpLaunchConfig = {
  appPath: string
  execPath: string
  isPackaged: boolean
  nodeExecPath?: string
}

export type ManagedGuiMcpDescriptor = {
  serverName: string
  legacyServerNames?: readonly string[]
  nodeEntry: string
  launchFlag: string
  timeoutMs: number
  enabledTools: () => readonly string[]
}

export type ManagedGuiMcpJsonServerInput = {
  descriptor: ManagedGuiMcpDescriptor
  launch: ManagedGuiMcpLaunchConfig
  args: readonly string[]
  env: Record<string, string>
  existing?: unknown
  enabled?: boolean
}

export type ManagedGuiLocalRuntimeMcpServerInput = ManagedGuiMcpJsonServerInput

export const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' } as const

export function resolveLocalRuntimeMcpJsonPath(): string {
  return join(homedir(), '.sciforge', 'mcp.json')
}

export function resolveManagedGuiMcpNodeEntryPath(
  launch: ManagedGuiMcpLaunchConfig,
  nodeEntry: string
): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, nodeEntry)
  }
  return join(launch.appPath, nodeEntry)
}

export function resolveManagedGuiMcpCommand(
  launch: ManagedGuiMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  const nodeExecPath = launch.nodeExecPath?.trim()
  if (!launch.isPackaged && nodeExecPath) return nodeExecPath
  return resolveElectronRunAsNodeExecutable(launch.execPath, platform)
}

export function buildManagedGuiMcpJsonServerConfig(
  input: ManagedGuiMcpJsonServerInput
): JsonRecord {
  const record = isJsonRecord(input.existing) ? input.existing : {}
  const enabled = input.enabled !== false
  return {
    ...record,
    command: resolveManagedGuiMcpCommand(input.launch),
    args: [...input.args],
    env: input.env,
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: !enabled,
    enabled,
    required: false,
    enabled_tools: [...input.descriptor.enabledTools()],
    disabled_tools: []
  }
}

export function buildManagedGuiLocalRuntimeMcpServerConfig(
  input: ManagedGuiLocalRuntimeMcpServerInput
): JsonRecord {
  const existing = isJsonRecord(input.existing) ? input.existing : {}
  return {
    ...existing,
    enabled: input.enabled !== false,
    transport: 'stdio',
    command: resolveManagedGuiMcpCommand(input.launch),
    args: [...input.args],
    env: input.env,
    trustScope: 'user',
    timeoutMs: input.descriptor.timeoutMs
  }
}

export function buildExternalLocalRuntimeMcpJson(
  existing: unknown,
  managedServerNames: readonly string[]
): JsonRecord {
  const base = isJsonRecord(existing) ? existing : {}
  const servers = stripManagedGuiMcpServers(objectValue(base.servers), managedServerNames)
  return {
    ...base,
    servers
  }
}

export async function syncExternalLocalRuntimeMcpJson(
  path: string,
  managedServerNames: readonly string[]
): Promise<void> {
  const current = await readJsonFile(path)
  if (current === null) return

  const next = buildExternalLocalRuntimeMcpJson(current, managedServerNames)
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  const currentText = `${JSON.stringify(current, null, 2)}\n`
  if (nextText === currentText) return

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, nextText, 'utf8')
}

export async function readJsonFile(path: string): Promise<unknown | null> {
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null
    throw error
  }

  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse local runtime MCP config at ${path}: ${message}`, { cause: error })
  }
}

export function stripManagedGuiMcpServers(
  servers: Record<string, unknown>,
  managedServerNames: readonly string[]
): Record<string, unknown> {
  const managed = new Set(managedServerNames)
  const next: Record<string, unknown> = {}
  for (const [serverName, server] of Object.entries(servers)) {
    if (!managed.has(serverName)) next[serverName] = server
  }
  return next
}

export function managedGuiMcpNames(descriptor: ManagedGuiMcpDescriptor): string[] {
  return [descriptor.serverName, ...(descriptor.legacyServerNames ?? [])]
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isJsonRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectValue(value: unknown): Record<string, unknown> {
  return isJsonRecord(value) ? value : {}
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}
