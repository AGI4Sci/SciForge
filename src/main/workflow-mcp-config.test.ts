import { describe, expect, it } from 'vitest'
import {
  buildSyncedWorkflowMcpJson,
  buildWorkflowLocalRuntimeMcpServerConfig,
  buildWorkflowMcpArgs,
  buildWorkflowMcpServerConfig,
  GUI_WORKFLOW_MCP_SERVER_NAME,
  workflowMcpEnabledTools,
  workflowMcpEnv,
  type WorkflowMcpLaunchConfig
} from './workflow-mcp-config'
import { GUI_WORKFLOW_MCP_LAUNCH_FLAG } from './workflow-mcp-server'
import { WORKFLOW_TOOL_CONTRACTS } from '../../packages/workers/workflow/src/contract'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const launch: WorkflowMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true
}

function createSettings(): AppSettingsV1 {
  const workflow = defaultWorkflowSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
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
    workflow: {
      ...workflow,
      webhookPort: 9898,
      webhookSecret: 'workflow-secret'
    },
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings()
  }
}

describe('workflow MCP config', () => {
  it('builds Electron-as-Node args and derives tools from the worker contract', () => {
    const settings = createSettings()

    expect(buildWorkflowMcpArgs(settings, launch)).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/workflow-mcp-node-entry.js',
      GUI_WORKFLOW_MCP_LAUNCH_FLAG,
      '--base-url',
      'http://127.0.0.1:9898'
    ])
    expect(workflowMcpEnabledTools()).toEqual(Object.keys(WORKFLOW_TOOL_CONTRACTS))
  })

  it('preserves string env while forcing Electron node mode', () => {
    expect(workflowMcpEnv({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '0'
    })).toEqual({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('builds runtime-specific server configs with the internal secret in env only', () => {
    const settings = createSettings()
    const server = buildWorkflowMcpServerConfig(settings, launch, {
      env: { EXISTING: 'kept' },
      enabled_tools: ['old_tool']
    })
    const localRuntimeServer = buildWorkflowLocalRuntimeMcpServerConfig(settings, launch, {
      env: { EXISTING: 'kept' }
    })

    expect(server).toMatchObject({
      args: buildWorkflowMcpArgs(settings, launch),
      env: workflowMcpEnv({ EXISTING: 'kept', GUI_WORKFLOW_INTERNAL_SECRET: 'workflow-secret' }),
      enabled: true,
      disabled: false,
      enabled_tools: workflowMcpEnabledTools(),
      disabled_tools: []
    })
    expect(localRuntimeServer).toMatchObject({
      transport: 'stdio',
      trustScope: 'user',
      timeoutMs: 30_000,
      args: buildWorkflowMcpArgs(settings, launch),
      env: workflowMcpEnv({ EXISTING: 'kept', GUI_WORKFLOW_INTERNAL_SECRET: 'workflow-secret' }),
      enabled: true
    })
    expect(JSON.stringify(server)).not.toContain('--secret')
    expect(JSON.stringify(localRuntimeServer)).not.toContain('--secret')
  })

  it('removes GUI-managed workflow servers from external local runtime mcp.json', () => {
    const synced = buildSyncedWorkflowMcpJson({
      timeouts: { connect_timeout: 3, execute_timeout: 30, read_timeout: 90 },
      servers: {
        keep_existing: { command: 'node', args: ['server.js'] },
        [GUI_WORKFLOW_MCP_SERVER_NAME]: {
          env: { EXISTING: 'kept' },
          enabled_tools: ['old_tool']
        }
      }
    }, createSettings(), launch)
    const servers = synced.servers as Record<string, Record<string, unknown>>

    expect(synced.timeouts).toEqual({ connect_timeout: 3, execute_timeout: 30, read_timeout: 90 })
    expect(servers.keep_existing).toEqual({ command: 'node', args: ['server.js'] })
    expect(servers[GUI_WORKFLOW_MCP_SERVER_NAME]).toBeUndefined()
  })
})
