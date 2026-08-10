import { join } from 'node:path'
import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution,
  DomainMainRuntimeMcpServerContribution,
  DomainMcpTrustedInvocationMetadataContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { z } from 'zod'

import {
  COMPUTER_USE_CAPABILITY_IDS,
  computerUsePermissionRequestInputSchema,
  computerUsePermissionsSchema,
  computerUseSettingsStatusInputSchema,
  computerUseSettingsStatusOutputSchema
} from './contract.js'
import {
  COMPUTER_USE_CAPABILITY_FACTORY_CONTRIBUTION,
  COMPUTER_USE_DOMAIN_MODULE_ID,
  COMPUTER_USE_RUNTIME_LIFECYCLE_CONTRIBUTION,
  COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION,
  COMPUTER_USE_TRUSTED_METADATA_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
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
  startComputerUseAgentModelBridge,
  type ComputerUseAgentModelBridge
} from './main/services/computer-use-agent-model-bridge.js'
import {
  startElectronComputerUseAdapterRuntime,
  type ElectronComputerUseAdapterRuntime
} from './main/services/computer-use-electron-adapter-runtime.js'
import {
  getComputerUsePermissions,
  requestComputerUsePermission
} from './main/services/computer-use-permissions.js'
import { ComputerUseRuntimeClient } from './main/services/computer-use-runtime-client.js'
import { trustedLoopbackEndpoint } from './main/trusted-loopback-url.js'

export {
  createPlaywrightCdpDriver,
  startComputerUseCdpAdapter
} from './main/services/computer-use-cdp-adapter.js'
export {
  createElectronWebContentsCdpDriver
} from './main/services/computer-use-electron-webcontents-driver.js'
export {
  startElectronComputerUseAdapterRuntime
} from './main/services/computer-use-electron-adapter-runtime.js'

type CapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global'
  effect: 'read' | 'external-write'
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{ revision: 'none'; idempotency: 'none' | 'required' }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (input: any) => Promise<{ output: unknown }>
}>

export type ComputerUseCapabilityFactory<Definition = unknown> = Readonly<{
  moduleId: typeof COMPUTER_USE_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'computer-use'
    title: 'Computer Use'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly Definition[]
}>

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<unknown> {
  const launch: ComputerUseMcpLaunchConfig = {
    appPath: host.getAppRoot?.() ?? process.cwd(),
    execPath: host.getExecutablePath?.() ?? process.execPath,
    isPackaged: host.isPackaged?.() ?? false
  }
  let runtimeClient: ComputerUseRuntimeClient | null = null
  const getRuntimeClient = (): ComputerUseRuntimeClient => {
    runtimeClient ??= new ComputerUseRuntimeClient({
      baseUrl: process.env.SCIFORGE_CUA_SERVICE_URL || 'http://127.0.0.1:3900',
      token: process.env.SCIFORGE_CUA_SERVICE_TOKEN || process.env.CUA_SERVICE_TOKEN,
      cachePath: join(host.getUserDataDir(), 'computer-use', 'runtime-status.json')
    })
    return runtimeClient
  }
  let adapter: ElectronComputerUseAdapterRuntime | null = null
  let modelBridge: ComputerUseAgentModelBridge | null = null

  const runtimeMcpServer: DomainMainRuntimeMcpServerContribution = Object.freeze({
    serverId: GUI_COMPUTER_USE_MCP_SERVER_NAME,
    createConfig: (settings: unknown) => {
      const appSettings = settings as AppSettingsLike
      if (
        !isComputerUseMcpConfigured(appSettings, 'codex') &&
        !isComputerUseMcpConfigured(appSettings, 'claude')
      ) return null
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
      const serviceUrl = (context.environment.SCIFORGE_CUA_SERVICE_URL ?? '').trim()
      const serviceToken = (
        (context.environment.SCIFORGE_CUA_SERVICE_TOKEN ?? '').trim() ||
        (context.environment.CUA_SERVICE_TOKEN ?? '').trim()
      )
      const explicitAdapter = Boolean(
        (context.environment.SCIFORGE_CUA_CDP_ADAPTER_URL ?? '').trim() ||
        (context.environment.SCIFORGE_CUA_CDP_ADAPTER_TOKEN ?? '').trim()
      )
      if (serviceUrl && serviceToken && context.agentExecution) {
        try {
          modelBridge = await startComputerUseAgentModelBridge({
            agentExecution: context.agentExecution,
            workspaceRoot: context.appRoot
          })
          const response = await fetch(
            trustedLoopbackEndpoint(serviceUrl, '/computer-use/model-access/configure'),
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${serviceToken}`,
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                baseUrl: modelBridge.baseUrl,
                apiKey: modelBridge.token,
                model: 'sciforge-computer-use-agent'
              }),
              signal: context.signal
            }
          )
          if (!response.ok) {
            throw new Error(`sidecar model bridge configuration failed (HTTP ${response.status})`)
          }
          context.log({
            level: 'info',
            message: 'Computer Use planner attached to the Host Agent model-access boundary.'
          })
        } catch (error) {
          const currentBridge = modelBridge
          modelBridge = null
          await currentBridge?.close().catch(() => undefined)
          context.log({
            level: 'warn',
            message: 'Computer Use planner bridge startup failed; targets remain unavailable.',
            detail: error instanceof Error ? error.message : String(error)
          })
          return
        }
      }
      if (serviceUrl && serviceToken && !explicitAdapter) {
        try {
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
          context.log({ level: 'info', message: 'Computer Use Electron adapter started.' })
        } catch (error) {
          context.log({
            level: 'warn',
            message: 'Computer Use Electron adapter startup failed; target remains unavailable.',
            detail: error instanceof Error ? error.message : String(error)
          })
        }
      }
      return async () => {
        const current = adapter
        adapter = null
        await current?.close()
        const currentBridge = modelBridge
        modelBridge = null
        if (currentBridge) {
          await fetch(
            trustedLoopbackEndpoint(serviceUrl, '/computer-use/model-access/configure'),
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${serviceToken}`,
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                baseUrl: '',
                apiKey: '',
                model: '',
                expectedBaseUrl: currentBridge.baseUrl
              })
            }
          ).catch(() => undefined)
          await currentBridge.close().catch(() => undefined)
        }
      }
    }
  })

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...COMPUTER_USE_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createComputerUseCapabilityFactory(
          host.defineCapability as (options: CapabilityOptions) => unknown,
          getRuntimeClient
        )
      },
      { ...COMPUTER_USE_RUNTIME_LIFECYCLE_CONTRIBUTION, value: lifecycle },
      { ...COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION, value: runtimeMcpServer },
      { ...COMPUTER_USE_TRUSTED_METADATA_CONTRIBUTION, value: trustedMetadata }
    ]
  }
}

function createComputerUseCapabilityFactory<Definition>(
  defineCapability: (options: CapabilityOptions) => Definition,
  getRuntimeClient: () => ComputerUseRuntimeClient
): ComputerUseCapabilityFactory<Definition> {
  const define = (options: Omit<CapabilityOptions, 'version' | 'scope' | 'concurrency' | 'tags'>) =>
    defineCapability({
      ...options,
      version: '1.0.0',
      scope: 'global',
      concurrency: {
        revision: 'none',
        idempotency: options.effect === 'read' ? 'none' : 'required'
      },
      tags: ['computer-use']
    })
  return Object.freeze({
    moduleId: COMPUTER_USE_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'computer-use' as const,
      title: 'Computer Use' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: COMPUTER_USE_CAPABILITY_IDS.status,
        title: 'Read Computer Use status',
        description: 'Reads permissions and the conservative runtime status view.',
        audiences: ['ui'],
        effect: 'read',
        approval: 'none',
        inputSchema: computerUseSettingsStatusInputSchema,
        outputSchema: computerUseSettingsStatusOutputSchema,
        handler: async (input) => ({
          output: {
            settings: input.settings,
            permissions: await getComputerUsePermissions(),
            runtime: await getRuntimeClient().refresh()
          }
        })
      }),
      define({
        id: COMPUTER_USE_CAPABILITY_IDS.requestPermission,
        title: 'Request Computer Use permission',
        description: 'Opens the operating system permission enrollment flow.',
        audiences: ['ui'],
        effect: 'external-write',
        approval: 'confirmation',
        inputSchema: computerUsePermissionRequestInputSchema,
        outputSchema: computerUsePermissionsSchema,
        handler: async (input) => ({
          output: await requestComputerUsePermission(input.kind)
        })
      })
    ]
  })
}
