import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution,
  DomainMainRuntimeMcpServerContribution,
  DomainMcpTrustedInvocationMetadataContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  COMPUTER_USE_BIND_TARGET_TOOL_NAME,
  COMPUTER_USE_MCP_TIMEOUT_MS,
  COMPUTER_USE_MCP_TOOL_NAME,
  COMPUTER_USE_RELEASE_SESSION_TOOL_NAME,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  buildComputerUseMcpArgs,
  computerUseMcpEnabledTools,
  computerUseMcpEnv,
  isComputerUseMcpConfigured,
  resolveComputerUseMcpCommand,
  type AppSettingsLike,
  type ComputerUseMcpLaunchConfig
} from './main/mcp-config.js'
import {
  startElectronComputerUseAdapterRuntime,
  type ElectronComputerUseAdapterRuntime
} from './main/services/computer-use-electron-adapter-runtime.js'
import {
  COMPUTER_USE_RUNTIME_LIFECYCLE_CONTRIBUTION,
  COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION,
  COMPUTER_USE_TRUSTED_METADATA_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import { trustedLoopbackOrigin } from './main/trusted-loopback-url.js'

export {
  createPlaywrightCdpDriver,
  startComputerUseCdpAdapter
} from './main/services/computer-use-cdp-adapter.js'
export { createElectronWebContentsCdpDriver } from './main/services/computer-use-electron-webcontents-driver.js'

export function createDomainMainEntry(host: DomainMainHost): TrustedDomainProcessEntryInput<unknown> {
  const launch: ComputerUseMcpLaunchConfig = {
    appPath: host.getAppRoot?.() ?? process.cwd(),
    execPath: host.getExecutablePath?.() ?? process.execPath,
    isPackaged: host.isPackaged?.() ?? false
  }
  let adapter: ElectronComputerUseAdapterRuntime | null = null
  const runtimeMcpServer: DomainMainRuntimeMcpServerContribution = Object.freeze({
    serverId: GUI_COMPUTER_USE_MCP_SERVER_NAME,
    createConfig: (settings: unknown) => {
      const appSettings = settings as AppSettingsLike
      if (!isComputerUseMcpConfigured(appSettings, 'codex') &&
          !isComputerUseMcpConfigured(appSettings, 'claude')) return null
      return {
        id: GUI_COMPUTER_USE_MCP_SERVER_NAME,
        command: resolveComputerUseMcpCommand(launch),
        args: buildComputerUseMcpArgs(launch),
        env: computerUseMcpEnv(),
        timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS,
        enabledTools: computerUseMcpEnabledTools()
      }
    },
    isRuntimeEnabled: (settings, runtimeId) =>
      (runtimeId === 'codex' || runtimeId === 'claude') &&
      isComputerUseMcpConfigured(settings as AppSettingsLike, runtimeId)
  })
  const trustedMetadata: DomainMcpTrustedInvocationMetadataContribution = Object.freeze({
    serverId: GUI_COMPUTER_USE_MCP_SERVER_NAME,
    tools: Object.freeze([
      COMPUTER_USE_BIND_TARGET_TOOL_NAME,
      COMPUTER_USE_MCP_TOOL_NAME,
      COMPUTER_USE_RELEASE_SESSION_TOOL_NAME
    ]),
    metadataKey: 'io.sciforge/computer-use-invocation',
    source: 'trusted-invocation'
  })
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: async (context) => {
      const rawServiceUrl = (context.environment.SCIFORGE_CUA_SERVICE_URL ?? '').trim()
      const serviceUrl = rawServiceUrl ? trustedLoopbackOrigin(rawServiceUrl).origin : ''
      const serviceToken = ((context.environment.SCIFORGE_CUA_SERVICE_TOKEN ?? '').trim() ||
        (context.environment.CUA_SERVICE_TOKEN ?? '').trim())
      const explicitAdapter = Boolean(
        (context.environment.SCIFORGE_CUA_CDP_ADAPTER_URL ?? '').trim() ||
        (context.environment.SCIFORGE_CUA_CDP_ADAPTER_TOKEN ?? '').trim()
      )
      if (serviceUrl && serviceToken && !explicitAdapter) {
        const { webContents } = await import('electron')
        adapter = await startElectronComputerUseAdapterRuntime({
          serviceUrl,
          serviceToken,
          browserEndpoints: (context.environment.SCIFORGE_CUA_CDP_ENDPOINTS ?? '')
            .split(',').map((value) => value.trim()).filter(Boolean),
          listWebContents: () => webContents.getAllWebContents().filter((contents) =>
            !contents.isDestroyed() && contents.getType() === 'window'
          )
        })
        context.log({ level: 'info', message: 'Computer Use Electron CDP adapter started.' })
      }
      const unsubscribeTurnEvents = serviceUrl && serviceToken && context.turnEvents
        ? context.turnEvents.subscribe(async (event) => {
            if (
              (event.kind !== 'after-turn' && event.kind !== 'after-persistent-child-turn') ||
              !event.turnId
            ) return
            try {
              await reclaimTurnSessions({
                serviceUrl,
                serviceToken,
                runtimeId: event.runtimeId,
                threadId: event.threadId,
                turnId: event.turnId,
                reason: `turn_${event.state}`,
                signal: context.signal
              })
            } catch (error) {
              if (context.signal.aborted) return
              context.log({
                level: 'warn',
                message: `Computer Use turn cleanup failed: ${error instanceof Error ? error.message : String(error)}`
              })
              if (event.kind === 'after-persistent-child-turn') throw error
            }
          })
        : undefined
      return async () => {
        await unsubscribeTurnEvents?.()
        const current = adapter
        adapter = null
        await current?.close()
      }
    }
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      { ...COMPUTER_USE_RUNTIME_LIFECYCLE_CONTRIBUTION, value: lifecycle },
      { ...COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION, value: runtimeMcpServer },
      { ...COMPUTER_USE_TRUSTED_METADATA_CONTRIBUTION, value: trustedMetadata }
    ]
  }
}

async function reclaimTurnSessions(input: Readonly<{
  serviceUrl: string
  serviceToken: string
  runtimeId: string
  threadId: string
  turnId: string
  reason: string
  signal: AbortSignal
}>): Promise<void> {
  const response = await fetch(`${input.serviceUrl.replace(/\/+$/u, '')}/computer-use/reclaim-owner`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.serviceToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      turnId: input.turnId,
      reason: input.reason
    }),
    signal: input.signal
  })
  if (!response.ok) {
    throw new Error(`sidecar returned HTTP ${response.status}`)
  }
  const result = await response.json() as { ok?: boolean; error?: { message?: string } }
  if (!result.ok) throw new Error(result.error?.message ?? 'sidecar rejected cleanup')
}
