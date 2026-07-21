import { afterEach, describe, expect, it } from 'vitest'
import {
  buildClaudeCodeManagedGuiMcpServers,
  buildCodexManagedGuiMcpServers
} from './gui-mcp-registry'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultRemoteExecutorSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  COMPUTER_USE_MCP_TOOL_NAME,
  GUI_COMPUTER_USE_MCP_SERVER_NAME
} from './computer-use-mcp-config'

const launch = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true
}

const originalCuaServiceUrl = process.env.SCIFORGE_CUA_SERVICE_URL
const originalCuaServiceToken = process.env.SCIFORGE_CUA_SERVICE_TOKEN

function createSettings(): AppSettingsV1 {
  const schedule = defaultScheduleSettings()
  const workflow = defaultWorkflowSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:4567/v1'
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings(9876)
    },
    workspaceRoot: '/tmp/project',
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
    schedule: {
      ...schedule,
      internal: {
        ...schedule.internal,
        port: 9797,
        secret: 'schedule-secret'
      }
    },
    workflow: {
      ...workflow,
      webhookPort: 9898,
      webhookSecret: 'workflow-secret'
    },
    remoteExecutor: defaultRemoteExecutorSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings()
  }
}

describe('GUI MCP runtime registry', () => {
  afterEach(() => {
    if (originalCuaServiceUrl === undefined) delete process.env.SCIFORGE_CUA_SERVICE_URL
    else process.env.SCIFORGE_CUA_SERVICE_URL = originalCuaServiceUrl
    if (originalCuaServiceToken === undefined) delete process.env.SCIFORGE_CUA_SERVICE_TOKEN
    else process.env.SCIFORGE_CUA_SERVICE_TOKEN = originalCuaServiceToken
  })

  it('builds the managed computer-use MCP server for Codex and Claude', () => {
    process.env.SCIFORGE_CUA_SERVICE_URL = 'http://127.0.0.1:3900'
    process.env.SCIFORGE_CUA_SERVICE_TOKEN = 'test-token'
    const settings = createSettings()

    const codex = buildCodexManagedGuiMcpServers({
      settings,
      computerUseMcp: { settings, launch }
    })
    expect(codex).toEqual([
      expect.objectContaining({
        id: GUI_COMPUTER_USE_MCP_SERVER_NAME,
        args: expect.arrayContaining(['--gui-owl-computer-use-mcp-server']),
        enabledTools: [COMPUTER_USE_MCP_TOOL_NAME]
      })
    ])

    const claude = buildClaudeCodeManagedGuiMcpServers({
      settings,
      computerUseMcp: { settings, launch }
    })
    expect(claude[GUI_COMPUTER_USE_MCP_SERVER_NAME]).toMatchObject({
      type: 'stdio',
      args: expect.arrayContaining(['--gui-owl-computer-use-mcp-server']),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900',
        SCIFORGE_CUA_SERVICE_TOKEN: 'test-token'
      },
      alwaysLoad: true
    })
  })

  it('builds Codex dynamic MCP server configs with contract-derived tools and local secrets', () => {
    const settings = createSettings()
    settings.modelRouter = {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:4567/v1',
      runtimeApiKey: 'router-runtime-test-key',
      publicModelAlias: 'router-vision-model'
    }
    const servers = buildCodexManagedGuiMcpServers({
      settings,
      scheduleMcp: { settings, launch },
      workflowMcp: { settings, launch },
      workspaceIntelMcp: { settings, launch },
      remoteExecutorMcp: { launch }
    })

    expect(servers.map((server) => server.id)).toEqual([
      'gui_schedule',
      'gui_workflow',
      'gui_workspace_intel',
      'remote_executor'
    ])
    expect(servers.find((server) => server.id === 'gui_schedule')).toMatchObject({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_SCHEDULE_INTERNAL_SECRET: 'schedule-secret'
      },
      enabledTools: expect.arrayContaining(['gui_schedule_list', 'gui_schedule_run'])
    })
    expect(servers.find((server) => server.id === 'gui_workflow')).toMatchObject({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_WORKFLOW_INTERNAL_SECRET: 'workflow-secret'
      },
      enabledTools: expect.arrayContaining(['gui_workflow_list', 'gui_workflow_run'])
    })
    expect(servers.find((server) => server.id === 'gui_workspace_intel')).toMatchObject({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:4567/v1',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'router-runtime-test-key',
        SCIFORGE_MODEL_ROUTER_VISUAL_MODEL: 'router-vision-model'
      }
    })
    expect(buildClaudeCodeManagedGuiMcpServers({
      settings,
      workspaceIntelMcp: { settings, launch }
    }).gui_workspace_intel).toMatchObject({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:4567/v1',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'router-runtime-test-key',
        SCIFORGE_MODEL_ROUTER_VISUAL_MODEL: 'router-vision-model'
      }
    })
    expect(servers.find((server) => server.id === 'remote_executor')).toMatchObject({
      env: { ELECTRON_RUN_AS_NODE: '1' },
      args: expect.arrayContaining(['--gui-remote-executor-mcp-server']),
      enabledTools: expect.arrayContaining(['remote_run'])
    })
  })

  it('passes the workspace root to artifact worker MCP launch args', () => {
    const settings = createSettings()
    const codex = buildCodexManagedGuiMcpServers({
      settings,
      scientificSkillsMcp: { launch },
      scientificPlottingMcp: { launch },
      imageGenerationMcp: { launch },
      pptMasterMcp: { launch },
      visualDocumentMcp: { launch }
    })

    for (const id of ['scientific_skills', 'scientific_plotting', 'image_generation', 'ppt_master', 'visual_document']) {
      expect(codex.find((server) => server.id === id)?.args).toEqual(
        expect.arrayContaining(['--workspace-root', '/tmp/project'])
      )
    }

    expect(codex.find((server) => server.id === 'image_generation')?.enabledTools).toEqual(
      expect.arrayContaining([
        'visual_generate'
      ])
    )
    const scientificPlottingTools = codex.find((server) => server.id === 'scientific_plotting')?.enabledTools
    expect(scientificPlottingTools).not.toContain('visual_generate')
    expect(codex.find((server) => server.id === 'visual_document')).toMatchObject({
      args: expect.arrayContaining(['--sciforge-visual-document-mcp-server']),
      enabledTools: expect.arrayContaining([
        'sciforge_visual_document_save_annotations',
        'sciforge_visual_document_accept_candidate'
      ])
    })
  })

  it('does not build a Claude Code MCP config without computer-use launch input', () => {
    const servers = buildClaudeCodeManagedGuiMcpServers()

    expect(servers).toEqual({})
  })

  it('keeps retired MCP servers out of generated Codex and Claude configs', () => {
    for (const id of ['gui_computer_use', 'gui_research_memory', 'sciforge_canvas']) {
      const codex = buildCodexManagedGuiMcpServers({}).find((server) => server.id === id)
      const claude = buildClaudeCodeManagedGuiMcpServers()[id]

      expect(codex).toBeUndefined()
      expect(claude).toBeUndefined()
    }
  })
})
