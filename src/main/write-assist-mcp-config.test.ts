import { describe, expect, it } from 'vitest'
import {
  buildWriteAssistMcpArgs,
  buildWriteAssistMcpServerConfig,
  writeAssistMcpEnabledTools,
  writeAssistMcpEnv,
  type WriteAssistMcpLaunchConfig
} from './write-assist-mcp-config'
import { GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG } from './write-assist-mcp-server'
import { WriteAssistToolNames } from '../../packages/workers/write-assist/src/contract'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const launch: WriteAssistMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true
}

function createSettings(workspaceRoot = '/tmp/workspace'): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
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
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings()
  }
}

describe('write assist MCP config', () => {
  it('builds Electron-as-Node args and derives tools from the worker contract', () => {
    const settings = createSettings('/tmp/project')

    expect(buildWriteAssistMcpArgs(settings, launch)).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/write-assist-mcp-node-entry.js',
      GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG,
      '--workspace-root',
      '/tmp/project'
    ])
    expect(writeAssistMcpEnabledTools()).toEqual([...WriteAssistToolNames])
  })

  it('preserves string env while forcing Electron node mode', () => {
    expect(writeAssistMcpEnv({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '0'
    })).toEqual({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('builds a managed write assist MCP server config', () => {
    const config = buildWriteAssistMcpServerConfig(createSettings('/tmp/project'), launch, {
      env: { EXISTING: 'kept' },
      enabled_tools: ['old_tool']
    })

    expect(config).toMatchObject({
      args: buildWriteAssistMcpArgs(createSettings('/tmp/project'), launch),
      env: writeAssistMcpEnv({ EXISTING: 'kept' }),
      enabled: true,
      disabled: false,
      enabled_tools: writeAssistMcpEnabledTools(),
      disabled_tools: []
    })
  })
})
