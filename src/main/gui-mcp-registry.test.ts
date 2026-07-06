import { afterEach, describe, expect, it } from 'vitest'
import {
  buildClaudeCodeManagedGuiMcpServers,
  buildCodexManagedGuiMcpServers,
  buildLocalRuntimeManagedGuiMcpServers,
  managedGuiMcpServerNames
} from './gui-mcp-registry'
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
import { GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME } from './remote-executor-mcp-config'
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
    provider: defaultModelProviderSettings(),
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

  it('exposes every managed server name that must be stripped from external local runtime mcp.json', () => {
    expect(managedGuiMcpServerNames()).toEqual(expect.arrayContaining([
      'gui_schedule',
      'gui_research',
      'gui_workflow',
      'gui_workspace_intel',
      'remote_executor',
      'gui_paper_radar',
      'gui_write_assist',
      'gui_runtime_inspector',
      'scientific_skills',
      'scientific_plotting',
      'image_generation',
      'ppt_master',
      'sciforge_canvas',
      'gui_owl_computer_use',
      'gui_computer_use'
    ]))
  })

  it('builds local runtime managed server configs from shared descriptors and preserves existing env safely', () => {
    const settings = createSettings()
    settings.remoteExecutor = {
      enabled: true,
      defaultTargetId: 'cluster-a',
      targets: [{
        id: 'cluster-a',
        label: 'Cluster A',
        enabled: true,
        kind: 'slurm',
        ssh: { host: 'cluster.example.edu', user: 'alice', port: 2222 },
        remoteWorkspaceRoot: '/home/alice/project',
        slurm: { defaults: { partition: 'gpu' } },
        trustedWorkspaces: []
      }]
    }
    const servers = buildLocalRuntimeManagedGuiMcpServers({
      scheduleMcp: { settings, launch },
      workflowMcp: { settings, launch },
      remoteExecutorMcp: { settings, launch }
    })

    expect(servers.gui_schedule).toMatchObject({
      enabled: true,
      command: expect.stringContaining('SciForge Helper'),
      args: expect.arrayContaining(['--gui-schedule-mcp-server', '--base-url', 'http://127.0.0.1:9797']),
      env: { ELECTRON_RUN_AS_NODE: '1', GUI_SCHEDULE_INTERNAL_SECRET: 'schedule-secret' },
      timeoutMs: 5000
    })
    expect(servers.gui_workflow).toMatchObject({
      enabled: true,
      args: expect.arrayContaining(['--gui-workflow-mcp-server', '--base-url', 'http://127.0.0.1:9898']),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_WORKFLOW_INTERNAL_SECRET: 'workflow-secret'
      },
      timeoutMs: 30000
    })
    expect(servers[GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME]).toMatchObject({
      enabled: true,
      command: expect.stringContaining('SciForge Helper'),
      args: expect.arrayContaining(['--gui-remote-executor-mcp-server']),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      trustScope: 'user',
      timeoutMs: 30000
    })
    const remoteEnv = (servers[GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME] as { env?: Record<string, string> }).env
    expect(JSON.parse(remoteEnv?.SCIFORGE_REMOTE_EXECUTOR_TARGETS_JSON ?? '[]')).toEqual([{
      id: 'cluster-a',
      label: 'Cluster A',
      kind: 'ssh',
      host: 'cluster.example.edu',
      disabled: false,
      capabilities: {
        directRun: true,
        stdin: true,
        deploy: true,
        slurm: true
      },
      user: 'alice',
      port: 2222,
      workspaceRoot: '/home/alice/project'
    }])
    expect(servers.gui_computer_use).toBeUndefined()
    expect(servers[GUI_COMPUTER_USE_MCP_SERVER_NAME]).toBeUndefined()
  })

  it('builds the managed computer-use MCP server for every runtime from the shared registry', () => {
    process.env.SCIFORGE_CUA_SERVICE_URL = 'http://127.0.0.1:3900'
    process.env.SCIFORGE_CUA_SERVICE_TOKEN = 'test-token'
    const settings = createSettings()

    const localRuntime = buildLocalRuntimeManagedGuiMcpServers({
      settings,
      computerUseMcp: { settings, launch }
    })
    expect(localRuntime[GUI_COMPUTER_USE_MCP_SERVER_NAME]).toMatchObject({
      enabled: true,
      command: expect.stringContaining('SciForge Helper'),
      args: expect.arrayContaining(['--gui-owl-computer-use-mcp-server']),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900',
        SCIFORGE_CUA_SERVICE_TOKEN: 'test-token'
      },
      timeoutMs: 600000
    })

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
    expect(servers.find((server) => server.id === 'remote_executor')).toMatchObject({
      env: { ELECTRON_RUN_AS_NODE: '1' },
      args: expect.arrayContaining(['--gui-remote-executor-mcp-server']),
      enabledTools: expect.arrayContaining(['remote_run'])
    })
  })

  it('passes the workspace root to artifact worker MCP launch args', () => {
    const settings = createSettings()
    const localRuntime = buildLocalRuntimeManagedGuiMcpServers({
      settings,
      scientificSkillsMcp: { launch },
      scientificPlottingMcp: { launch },
      imageGenerationMcp: { launch },
      pptMasterMcp: { launch },
      sciforgeCanvasMcp: { launch }
    }) as Record<string, { args?: string[] }>
    const codex = buildCodexManagedGuiMcpServers({
      settings,
      scientificSkillsMcp: { launch },
      scientificPlottingMcp: { launch },
      imageGenerationMcp: { launch },
      pptMasterMcp: { launch },
      sciforgeCanvasMcp: { launch }
    })

    for (const id of ['scientific_skills', 'scientific_plotting', 'image_generation', 'ppt_master', 'sciforge_canvas']) {
      expect(localRuntime[id]?.args).toEqual(expect.arrayContaining(['--workspace-root', '/tmp/project']))
      expect(codex.find((server) => server.id === id)?.args).toEqual(
        expect.arrayContaining(['--workspace-root', '/tmp/project'])
      )
    }

    expect(codex.find((server) => server.id === 'scientific_plotting')?.enabledTools).toEqual(
      expect.arrayContaining([
        'scientific_plotting_plan',
        'scientific_plotting_research_brief',
        'scientific_plotting_render'
      ])
    )
  })

  it('does not build a Claude Code MCP config without computer-use launch input', () => {
    const servers = buildClaudeCodeManagedGuiMcpServers()

    expect(servers).toEqual({})
  })

  it('keeps retired MCP servers out of generated runtime configs while still cleaning them from disk', () => {
    for (const id of ['gui_computer_use', 'gui_research_memory']) {
      const localRuntime = buildLocalRuntimeManagedGuiMcpServers({})[id]
      const codex = buildCodexManagedGuiMcpServers({}).find((server) => server.id === id)
      const claude = buildClaudeCodeManagedGuiMcpServers()[id]

      expect(localRuntime).toBeUndefined()
      expect(codex).toBeUndefined()
      expect(claude).toBeUndefined()
      expect(managedGuiMcpServerNames()).toContain(id)
    }
  })
})
