import {
  mcpConfigHasServer,
  mcpServersFromConfig,
  mergeMcpJsonConfig,
  parseMcpJsonConfig,
  type JsonRecord
} from './mcp-config'

export const PPT_MASTER_MCP_SERVER_ID = 'ppt_master'

type PptMasterConfigResult =
  | { ok: true; config: JsonRecord }
  | { ok: false; message: string }

export type PptMasterMcpBootstrapInput = {
  text: string
  workspaceRoot?: string
  readConfig: () => Promise<{ content: string }>
  writeConfig: (content: string) => Promise<unknown>
  buildConfig: (workspaceRoot?: string) => Promise<PptMasterConfigResult>
  getToolDiagnostics?: () => Promise<{ mcpServers?: Array<Record<string, unknown>> } | null | undefined>
  waitTimeoutMs?: number
  pollIntervalMs?: number
}

export type PptMasterMcpBootstrapResult =
  | { status: 'skipped' }
  | { status: 'configured'; runtimeConnected: boolean }
  | { status: 'installed'; runtimeConnected: boolean }
  | { status: 'unavailable'; message: string }

const PPT_DELIVERABLE_RE =
  /(?:pptx?|幻灯片|slides?|slide\s+deck|presentation|演示文稿)/i
const PPT_ACTION_BEFORE_RE =
  /(?:做|生成|创建|制作|导出|输出|整理成|转换成|转成|给我|帮我|make|create|generate|export|build|turn\s+.+\s+into|convert\s+.+\s+to).{0,28}(?:pptx?|幻灯片|slides?|slide\s+deck|presentation|演示文稿)/i
const PPT_ACTION_AFTER_RE =
  /(?:pptx?|幻灯片|slides?|slide\s+deck|presentation|演示文稿).{0,28}(?:做|生成|创建|制作|导出|输出|整理|转换|转成|给我|make|create|generate|export|build)/i
const UNKNOWN_PPT_MASTER_CONFIG_CHANNEL_RE =
  /Unknown app bridge channel:\s*mcp:ppt-master-config|Bridge request failed for mcp:ppt-master-config/i

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isPptDeckRequest(text: string): boolean {
  const normalized = text.trim()
  if (!PPT_DELIVERABLE_RE.test(normalized)) return false
  return PPT_ACTION_BEFORE_RE.test(normalized) || PPT_ACTION_AFTER_RE.test(normalized)
}

export async function ensurePptMasterMcpForChat(
  input: PptMasterMcpBootstrapInput
): Promise<PptMasterMcpBootstrapResult> {
  if (!isPptDeckRequest(input.text)) return { status: 'skipped' }

  const current = await input.readConfig()
  const alreadyConfigured = mcpConfigHasServer(current.content, PPT_MASTER_MCP_SERVER_ID)
  let wroteConfig = false

  if (!alreadyConfigured) {
    const result = await buildPptMasterConfigWithFallback(input, current.content)
    if (!result.ok) {
      return { status: 'unavailable', message: result.message }
    }
    const merged = mergeMcpJsonConfig(current.content, result.config)
    if (!merged.alreadyExists) {
      await input.writeConfig(merged.text)
      wroteConfig = true
    }
  } else {
    const result = await buildPptMasterConfigWithFallback(input, current.content)
    if (result.ok) {
      const merged = mergeMcpJsonConfig(current.content, result.config)
      if (merged.changed) {
        await input.writeConfig(merged.text)
        wroteConfig = true
      }
    }
  }

  if (alreadyConfigured && !wroteConfig && input.getToolDiagnostics) {
    if (diagnosticsHasConnectedPptMaster(await input.getToolDiagnostics())) {
      return { status: 'configured', runtimeConnected: true }
    }
    await input.writeConfig(current.content)
  }

  const runtimeConnected = input.getToolDiagnostics
    ? await waitForPptMasterRuntime(input)
    : true

  return {
    status: !alreadyConfigured && wroteConfig ? 'installed' : 'configured',
    runtimeConnected
  }
}

async function buildPptMasterConfigWithFallback(
  input: PptMasterMcpBootstrapInput,
  currentConfigText: string
): Promise<PptMasterConfigResult> {
  try {
    return await input.buildConfig(input.workspaceRoot?.trim() || undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!UNKNOWN_PPT_MASTER_CONFIG_CHANNEL_RE.test(message)) {
      return { ok: false, message }
    }
    const fallback = buildPptMasterMcpConfigFromExistingConfig(
      currentConfigText,
      input.workspaceRoot?.trim() || undefined
    )
    if (fallback) return { ok: true, config: fallback }
    return {
      ok: false,
      message: `${message}; unable to derive the SciForge app path from the existing MCP config.`
    }
  }
}

export function buildPptMasterMcpConfigFromExistingConfig(
  content: string,
  workspaceRoot?: string
): JsonRecord | null {
  const appPath = deriveAppPathFromExistingMcpConfig(content)
  if (!appPath) return null
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return {
    servers: {
      [PPT_MASTER_MCP_SERVER_ID]: {
        enabled: true,
        transport: 'stdio',
        command: 'npm',
        args: [
          '--prefix',
          appPath,
          '--workspace',
          'sciforge-ppt-master-mcp-service',
          'run',
          'start'
        ],
        env: {},
        trustScope: normalizedWorkspaceRoot ? 'workspace' : 'user',
        ...(normalizedWorkspaceRoot ? { trustedWorkspaceRoots: [normalizedWorkspaceRoot] } : {}),
        timeoutMs: 120_000
      }
    }
  }
}

function deriveAppPathFromExistingMcpConfig(content: string): string | null {
  let parsed: JsonRecord
  try {
    parsed = parseMcpJsonConfig(content)
  } catch {
    return null
  }
  const servers = mcpServersFromConfig(parsed)
  const candidates: string[] = []
  for (const server of Object.values(servers)) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue
    const record = server as JsonRecord
    const args = Array.isArray(record.args) ? record.args : []
    for (const arg of args) {
      if (typeof arg === 'string') candidates.push(arg)
    }
    if (typeof record.command === 'string') candidates.push(record.command)
  }
  for (const candidate of candidates) {
    const marker = '/out/main/'
    const markerIndex = candidate.indexOf(marker)
    if (markerIndex > 0) return candidate.slice(0, markerIndex)
  }
  return null
}

export function diagnosticsHasConnectedPptMaster(
  diagnostics: { mcpServers?: Array<Record<string, unknown>> } | null | undefined
): boolean {
  return diagnostics?.mcpServers?.some((server) => {
    const id = typeof server.id === 'string' ? server.id : ''
    const status = typeof server.status === 'string' ? server.status : ''
    return id === PPT_MASTER_MCP_SERVER_ID && status === 'connected'
  }) === true
}

async function waitForPptMasterRuntime(input: PptMasterMcpBootstrapInput): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, input.waitTimeoutMs ?? 45_000)
  const pollIntervalMs = Math.max(250, input.pollIntervalMs ?? 1_000)
  let isFirstAttempt = true
  while (isFirstAttempt || Date.now() < deadline) {
    isFirstAttempt = false
    try {
      if (diagnosticsHasConnectedPptMaster(await input.getToolDiagnostics?.())) return true
    } catch {
      /* Runtime can be restarting while the config change is being applied. */
    }
    if (Date.now() >= deadline) break
    await wait(pollIntervalMs)
  }
  return false
}
