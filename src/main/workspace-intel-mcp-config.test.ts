import { describe, expect, it } from 'vitest'
import {
  buildSyncedWorkspaceIntelMcpJson,
  buildWorkspaceIntelMcpArgs,
  buildWorkspaceIntelMcpServerConfig,
  GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
  workspaceIntelMcpEnabledTools,
  workspaceIntelMcpEnv,
  type WorkspaceIntelMcpLaunchConfig
} from './workspace-intel-mcp-config'
import { GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG } from './workspace-intel-mcp-server'
import { WorkspaceIntelToolNames } from '../../packages/workers/workspace-intel/src/contract'
import {
  MODEL_ROUTER_BASE_URL_ENV,
  MODEL_ROUTER_RUNTIME_API_KEY_ENV,
  MODEL_ROUTER_VISUAL_MODEL_ENV
} from '../../packages/workers/workspace-intel/src/visual-inspection'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultRemoteExecutorSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const launch: WorkspaceIntelMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true
}

function createSettings(workspaceRoot = '/tmp/workspace'): AppSettingsV1 {
  const remoteChannel = defaultRemoteChannelSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot,
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    remoteExecutor: defaultRemoteExecutorSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    remoteChannel,
    connectPhone: defaultConnectPhoneSettings()
  }
}

describe('workspace intel MCP config', () => {
  it('builds Electron-as-Node args and exposes the full read-only tool surface', () => {
    const settings = createSettings('/tmp/project')

    expect(buildWorkspaceIntelMcpArgs(settings, launch)).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/workspace-intel-mcp-node-entry.js',
      GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG,
      '--include-global-skills'
    ])
    expect(workspaceIntelMcpEnabledTools()).toEqual([...WorkspaceIntelToolNames])
  })

  it('preserves string env while forcing Electron node mode', () => {
    expect(workspaceIntelMcpEnv({
      KEEP_ME: 'yes',
      DROP_ME: 'no',
      ELECTRON_RUN_AS_NODE: '0'
    })).toEqual({
      KEEP_ME: 'yes',
      DROP_ME: 'no',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('passes local Model Router vision settings to every workspace-intel runtime launch', () => {
    const settings = createSettings('/tmp/project')
    const modelRouter = defaultModelRouterSettings()
    settings.modelRouter = {
      ...modelRouter,
      baseUrl: 'http://127.0.0.1:4892/v1',
      runtimeApiKey: 'runtime-test-key',
      publicModelAlias: 'public-vision-model'
    }

    expect(workspaceIntelMcpEnv({ KEEP_ME: 'yes' }, settings)).toEqual({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '1',
      [MODEL_ROUTER_BASE_URL_ENV]: 'http://127.0.0.1:4892/v1',
      [MODEL_ROUTER_RUNTIME_API_KEY_ENV]: 'runtime-test-key',
      [MODEL_ROUTER_VISUAL_MODEL_ENV]: 'public-vision-model'
    })
  })

  it('removes GUI-managed workspace intel servers from external local runtime mcp.json', () => {
    const synced = buildSyncedWorkspaceIntelMcpJson({
      timeouts: { connect_timeout: 3, execute_timeout: 30, read_timeout: 90 },
      servers: {
        keep_existing: { command: 'node', args: ['server.js'] },
        [GUI_WORKSPACE_INTEL_MCP_SERVER_NAME]: {
          env: { EXISTING: 'kept' },
          enabled_tools: ['old_tool']
        }
      }
    }, createSettings('/tmp/project'), launch)
    const servers = synced.servers as Record<string, Record<string, unknown>>

    expect(synced.timeouts).toEqual({ connect_timeout: 3, execute_timeout: 30, read_timeout: 90 })
    expect(servers.keep_existing).toEqual({ command: 'node', args: ['server.js'] })
    expect(servers[GUI_WORKSPACE_INTEL_MCP_SERVER_NAME]).toBeUndefined()
  })

  it('builds the runtime server config with read-only workspace tools', () => {
    const config = buildWorkspaceIntelMcpServerConfig(createSettings('/tmp/project'), launch)

    expect(config).toMatchObject({
      args: buildWorkspaceIntelMcpArgs(createSettings('/tmp/project'), launch),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      enabled: true,
      disabled: false,
      enabled_tools: workspaceIntelMcpEnabledTools(),
      disabled_tools: []
    })
  })
})
