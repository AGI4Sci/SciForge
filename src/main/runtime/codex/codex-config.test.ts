import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  CODEX_PLAN_GATEWAY_PROVIDER_ID,
  codexAuthSourceHomes,
  codexRuntimeEnv,
  expandHome,
  prepareCodexAppServerLaunch,
  resolveCodexCommand
} from './codex-config'

function settings(codexHome: string): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = 'http://127.0.0.1:49876/v1'
  modelRouter.publicModelAlias = DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }

  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    modelAccess: { mode: 'api', planAdapterId: '' },
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: {
        ...defaultCodexRuntimeSettings(),
        codexHome,
        extraArgs: ['--profile', 'sciforge']
      }
    },
    modelRouter,
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('codex config launch helpers', () => {
  it('falls back from the legacy SciForge Codex home to the standard Codex login home', () => {
    expect(codexAuthSourceHomes('~/.sciforge/codex', '/Users/example')).toEqual([
      '/Users/example/.sciforge/codex',
      '/Users/example/.codex'
    ])
    expect(codexAuthSourceHomes('~/custom-codex', '/Users/example')).toEqual([
      '/Users/example/custom-codex'
    ])
  })

  it('finds a Codex standalone install when a Finder launch omits the user bin directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-command-'))
    const command = join(home, '.local', 'bin', 'codex')
    await mkdir(join(home, '.local', 'bin'), { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolveCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin'
    })).resolves.toBe(command)
  })

  it('preserves an explicit Codex path and prefers the supplied PATH', async () => {
    await expect(resolveCodexCommand('~/custom/codex', {
      homeDir: '/Users/example',
      platform: 'darwin',
      isExecutable: async () => false
    })).resolves.toBe('/Users/example/custom/codex')

    await expect(resolveCodexCommand('codex', {
      env: { PATH: '/custom/bin:/usr/bin' },
      homeDir: '/Users/example',
      platform: 'darwin',
      isExecutable: async (path) => path === '/custom/bin/codex'
    })).resolves.toBe('/custom/bin/codex')
  })

  it('prepares app-server stdio launch config and creates CODEX_HOME', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const managedHome = join(codexHome, 'nested')
    await mkdir(managedHome, { recursive: true })
    await writeFile(
      join(managedHome, 'config.toml'),
      [
        'model = "gpt-5"',
        'model_provider = "openai"',
        '[model_providers.openai_proxy]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "OPENAI_API_KEY"'
      ].join('\n')
    )

    const launch = await prepareCodexAppServerLaunch({
      settings: settings(managedHome),
      workspace: '~/project',
      env: {
        OPENAI_API_KEY: 'sk-openai',
        DEEPSEEK_API_KEY: 'sk-deepseek',
        ANTHROPIC_API_KEY: 'sk-anthropic',
        ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
        QWEN_API_KEY: 'sk-qwen',
        DASHSCOPE_API_KEY: 'sk-dashscope',
        GEMINI_API_KEY: 'sk-gemini',
        GOOGLE_API_KEY: 'sk-google',
        GROQ_API_KEY: 'sk-groq',
        MISTRAL_API_KEY: 'sk-mistral',
        COHERE_API_KEY: 'sk-cohere',
        OPENROUTER_API_KEY: 'sk-openrouter',
        AZURE_OPENAI_API_KEY: 'sk-azure',
        TOGETHER_API_KEY: 'sk-together',
        FIREWORKS_API_KEY: 'sk-fireworks',
        XAI_API_KEY: 'sk-xai',
        PERPLEXITY_API_KEY: 'sk-perplexity',
        MOONSHOT_API_KEY: 'sk-moonshot',
        ZHIPU_API_KEY: 'sk-zhipu',
        SILICONFLOW_API_KEY: 'sk-siliconflow',
        ARK_API_KEY: 'sk-ark',
        OPENAI_MODEL: 'gpt-5',
        TOGETHER_MODEL: 'together-model',
        DEEPSEEK_MODEL: 'deepseek-chat',
        ANTHROPIC_MODEL: 'opus',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'bailian/deepseek-v4-flash',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'bailian/deepseek-v4-flash',
        MODEL_PROVIDER: 'anthropic',
        KUN_BASE_URL: 'https://old-runtime-provider.example/v1',
        SCIFORGE_IMAGE_API_KEY: 'outer-image-key',
        SCIFORGE_IMAGE_BASE_URL: 'https://direct-image-provider.example/v1',
        SCIFORGE_IMAGE_MODEL: 'outer-image-model',
        SCIFORGE_IMAGE_ALLOW_PLACEHOLDER: '1',
        SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://127.0.0.1:3898',
        SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'outer-sci-modality-token',
        SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS: '12345',
        SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'outer-model-router-scientific-token',
        EXPERT_PROVIDER_BASE_URL: 'http://127.0.0.1:8001/v1',
        EXPERT_PROVIDER_API_KEY: 'outer-expert-token',
        SCIMODALITY_ROUTER_PORT: '3898',
        SCIMODALITY_ROUTER_RUNTIME_TOKEN: 'outer-router-token',
        EDAG_LLM_BASE_URL: 'https://direct-edag-provider.example/v1',
        EDAG_LLM_API_KEY: 'outer-edag-key',
        EDAG_LLM_MODEL: 'outer-edag-model',
        SCIFORGE_RUNTIME_API_KEY: 'stale-runtime-key',
        PATH: '/bin',
        CODEX_USER_HOME: '/old',
        CODEX_CONFIG_HOME: '/old-config',
        NO_PROXY: 'example.com'
      }
    })

    expect(launch.command).toMatch(/(?:^|\/)codex$/)
    if (launch.command.includes('/')) {
      expect(launch.env.PATH?.split(':')).toContain(join(launch.command, '..'))
    }
    expect(launch.args).toEqual(['app-server', '--listen', 'stdio://'])
    expect(launch.cwd).toContain('project')
    expect(launch.env.CODEX_HOME).toBe(managedHome)
    expect(launch.env.CODEX_USER_HOME).toBeUndefined()
    expect(launch.env.CODEX_CONFIG_HOME).toBeUndefined()
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(launch.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(launch.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(launch.env.QWEN_API_KEY).toBeUndefined()
    expect(launch.env.DASHSCOPE_API_KEY).toBeUndefined()
    expect(launch.env.GEMINI_API_KEY).toBeUndefined()
    expect(launch.env.GOOGLE_API_KEY).toBeUndefined()
    expect(launch.env.GROQ_API_KEY).toBeUndefined()
    expect(launch.env.MISTRAL_API_KEY).toBeUndefined()
    expect(launch.env.COHERE_API_KEY).toBeUndefined()
    expect(launch.env.OPENROUTER_API_KEY).toBeUndefined()
    expect(launch.env.AZURE_OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.TOGETHER_API_KEY).toBeUndefined()
    expect(launch.env.FIREWORKS_API_KEY).toBeUndefined()
    expect(launch.env.XAI_API_KEY).toBeUndefined()
    expect(launch.env.PERPLEXITY_API_KEY).toBeUndefined()
    expect(launch.env.MOONSHOT_API_KEY).toBeUndefined()
    expect(launch.env.ZHIPU_API_KEY).toBeUndefined()
    expect(launch.env.SILICONFLOW_API_KEY).toBeUndefined()
    expect(launch.env.ARK_API_KEY).toBeUndefined()
    expect(launch.env.OPENAI_MODEL).toBeUndefined()
    expect(launch.env.TOGETHER_MODEL).toBeUndefined()
    expect(launch.env.DEEPSEEK_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(launch.env.MODEL_PROVIDER).toBeUndefined()
    expect(launch.env.KUN_BASE_URL).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_API_KEY).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_BASE_URL).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_MODEL).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER).toBeUndefined()
    expect(launch.env.SCIFORGE_SCIMODALITY_SERVICE_URL).toBeUndefined()
    expect(launch.env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN).toBeUndefined()
    expect(launch.env.SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS).toBeUndefined()
    expect(launch.env.SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN).toBeUndefined()
    expect(launch.env.EXPERT_PROVIDER_BASE_URL).toBeUndefined()
    expect(launch.env.EXPERT_PROVIDER_API_KEY).toBeUndefined()
    expect(launch.env.SCIMODALITY_ROUTER_PORT).toBeUndefined()
    expect(launch.env.SCIMODALITY_ROUTER_RUNTIME_TOKEN).toBeUndefined()
    expect(launch.env.EDAG_LLM_BASE_URL).toBeUndefined()
    expect(launch.env.EDAG_LLM_API_KEY).toBeUndefined()
    expect(launch.env.EDAG_LLM_MODEL).toBeUndefined()
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.NO_PROXY).toContain('127.0.0.1')
    await expect(stat(managedHome)).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'sessions'))).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'memories'))).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'logs'))).resolves.toMatchObject({})

    const config = await readFile(join(managedHome, 'config.toml'), 'utf8')
    expect(config).toContain(`model = "${DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS}"`)
    expect(config).toContain(`model_provider = "${DEFAULT_MODEL_ROUTER_PROVIDER_ID}"`)
    expect(config).toContain('hide_agent_reasoning = false')
    expect(config).toContain('show_raw_agent_reasoning = true')
    expect(config).toContain('model_reasoning_summary = "detailed"')
    expect(config).toContain('model_supports_reasoning_summaries = true')
    expect(config).toContain(`[model_providers.${DEFAULT_MODEL_ROUTER_PROVIDER_ID}]`)
    expect(config).toContain('name = "SciForge Model Router"')
    expect(config).toContain('base_url = "http://127.0.0.1:49876/v1"')
    expect(config).toContain('env_key = "SCIFORGE_RUNTIME_API_KEY"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).not.toContain('api.openai.com')
    expect(config).not.toContain('sk-')
    expect(config).not.toContain('OPENAI_API_KEY')
  })

  it('drops Codex runtime-only profile args before launching app-server', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        agents: {
          ...settings(codexHome).agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            codexHome,
            extraArgs: [
              '--profile-v2',
              '--profile',
              'sciforge',
              '-p',
              'legacy-profile',
              '--config',
              'features.experimental=true'
            ]
          }
        }
      },
      env: {}
    })

    expect(launch.args).toEqual([
      'app-server',
      '--listen',
      'stdio://',
      '--config',
      'features.experimental=true'
    ])
  })

  it('does not write the shared research MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: settings(codexHome),
      env: {
        SCIFORGE_RESEARCH_MAX_RESULTS: '7',
        SCIFORGE_RESEARCH_TIMEOUT_MS: '12000'
      },
      researchMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_research]')
    expect(config).not.toContain('research-search-mcp-node-entry')
    expect(config).not.toContain('SCIFORGE_RESEARCH_MAX_RESULTS')
    expect(config).not.toContain('SCIFORGE_RESEARCH_TIMEOUT_MS')
  })

  it('does not write the shared schedule MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        schedule: {
          ...defaultScheduleSettings(),
          internal: {
            port: 9797,
            secret: 'schedule-secret'
          }
        }
      },
      scheduleMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    expect(launch.env.GUI_SCHEDULE_INTERNAL_SECRET).toBe('schedule-secret')
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_schedule]')
    expect(config).not.toContain('schedule-mcp-node-entry')
    expect(config).not.toContain('schedule-secret')
  })

  it('does not write the shared workflow MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        workflow: {
          ...defaultWorkflowSettings(),
          enabled: true,
          webhookPort: 9898,
          webhookSecret: 'workflow-secret'
        }
      },
      workflowMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    expect(launch.env.GUI_WORKFLOW_INTERNAL_SECRET).toBe('workflow-secret')
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_workflow]')
    expect(config).not.toContain('workflow-mcp-node-entry')
    expect(config).not.toContain('workflow-secret')
  })

  it('does not write the shared workspace intel MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        workspaceRoot: '/tmp/codex-workspace'
      },
      workspaceIntelMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_workspace_intel]')
    expect(config).not.toContain('workspace-intel-mcp-node-entry')
  })

  it('does not write the shared computer-use MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: settings(codexHome)
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_computer_use]')
    expect(config).not.toContain('computer-use-mcp-node-entry')
  })

  it('does not write GUI MCP server tables when the dynamic bridge handles exposure', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    await prepareCodexAppServerLaunch({
      settings: settings(codexHome),
      scheduleMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      researchMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      workflowMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      workspaceIntelMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      paperRadarMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false,
        dbPath: '/tmp/sciforge-test-app/paper-radar.sqlite',
        profilesPath: '/tmp/sciforge-test-app/paper-radar-profiles.json'
      },
      writeAssistMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      runtimeInspectorMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false,
        checkpointDataDir: '/tmp/sciforge-test-app/checkpoints'
      }
    })

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_')
    expect(config).not.toContain('-mcp-node-entry')
  })

  it('does not write the shared computer-use MCP server when computer use is disabled', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        computerUse: {
          enabled: false,
          runtimeEnabled: {
            sciforge: true,
            codex: true,
            claude: true
          }
        }
      }
    })

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_computer_use]')
    expect(config).not.toContain('computer-use-mcp-node-entry')
  })

  it('does not write the shared computer-use MCP server when Codex runtime access is disabled', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        computerUse: {
          enabled: true,
          runtimeEnabled: {
            sciforge: true,
            codex: false,
            claude: true
          }
        }
      }
    })

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_computer_use]')
    expect(config).not.toContain('computer-use-mcp-node-entry')
  })

  it('uses the managed Codex home instead of a persisted global Codex home', async () => {
    const settingsCodexHome = await mkdtemp(join(tmpdir(), 'global-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'project-codex-home-'))
    await writeFile(
      join(settingsCodexHome, 'config.toml'),
      [
        'model = "gpt-5"',
        'model_provider = "openai"',
        '[model_providers.openai]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "OPENAI_API_KEY"'
      ].join('\n')
    )

    const launch = await prepareCodexAppServerLaunch({
      settings: settings(settingsCodexHome),
      managedCodexHome,
      env: {
        OPENAI_API_KEY: 'sk-global',
        SCIFORGE_RUNTIME_API_KEY: 'stale-runtime-key'
      }
    })

    expect(launch.codexHome).toBe(managedCodexHome)
    expect(launch.env.CODEX_HOME).toBe(managedCodexHome)
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')

    const managedConfig = await readFile(join(managedCodexHome, 'config.toml'), 'utf8')
    expect(managedConfig).toContain(`model_provider = "${DEFAULT_MODEL_ROUTER_PROVIDER_ID}"`)
    expect(managedConfig).toContain('base_url = "http://127.0.0.1:49876/v1"')

    const persistedGlobalConfig = await readFile(join(settingsCodexHome, 'config.toml'), 'utf8')
    expect(persistedGlobalConfig).toContain('api.openai.com')
    expect(persistedGlobalConfig).not.toContain(DEFAULT_MODEL_ROUTER_PROVIDER_ID)
  })

  it('writes an authenticated Plan Gateway provider without an API-key environment variable', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(externalCodexHome, 'config.toml'), 'model_provider = "external"\n')
    await writeFile(join(externalCodexHome, 'auth.json'), '{"auth":"existing"}\n', { mode: 0o600 })

    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' },
      env: {
        SCIFORGE_RUNTIME_API_KEY: 'stale-api-path-key',
        OPENAI_API_KEY: 'stale-openai-key'
      }
    })

    expect(launch.accessMode).toBe('coding-plan')
    expect(launch.env.CODEX_HOME).toBe(managedCodexHome)
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBeUndefined()
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()

    const config = await readFile(join(managedCodexHome, 'config.toml'), 'utf8')
    expect(config).toContain(`model_provider = "${CODEX_PLAN_GATEWAY_PROVIDER_ID}"`)
    expect(config).toContain(`[model_providers.${CODEX_PLAN_GATEWAY_PROVIDER_ID}]`)
    expect(config).toContain('base_url = "http://127.0.0.1:47931/v1"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('requires_openai_auth = true')
    expect(config).toContain('supports_websockets = false')
    expect(config).not.toContain('env_key')
    expect(config).not.toContain('model =')
    await expect(readFile(join(externalCodexHome, 'config.toml'), 'utf8'))
      .resolves.toBe('model_provider = "external"\n')
    await expect(readFile(join(managedCodexHome, 'auth.json'), 'utf8'))
      .resolves.toBe('{"auth":"existing"}\n')
    expect((await stat(join(managedCodexHome, 'auth.json'))).mode & 0o777).toBe(0o600)
  })

  it('does not overwrite an existing managed Codex login', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(externalCodexHome, 'auth.json'), '{"auth":"external"}\n')
    await writeFile(join(managedCodexHome, 'auth.json'), '{"auth":"managed"}\n', { mode: 0o600 })

    await prepareCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })

    await expect(readFile(join(managedCodexHome, 'auth.json'), 'utf8'))
      .resolves.toBe('{"auth":"managed"}\n')
  })

  it('fails closed when coding-plan mode has no local gateway or selects another adapter', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    await expect(prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      }
    })).rejects.toThrow('Plan Gateway base URL is required')

    await expect(prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'other-plan' }
      },
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' }
    })).rejects.toThrow('does not support coding plan adapter')
  })

  it('rejects non-local Model Router URLs', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const current = settings(codexHome)

    await expect(prepareCodexAppServerLaunch({
      settings: {
        ...current,
        modelRouter: {
          ...current.modelRouter!,
          baseUrl: 'https://router.example.com/v1'
        }
      },
      env: {}
    })).rejects.toThrow('Model Router base URL must be local')
  })

  it('rejects launch config when the text reasoner is incomplete', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const current = settings(codexHome)
    current.modelRouter!.profiles.default.textReasoner.model = ''

    await expect(prepareCodexAppServerLaunch({
      settings: current,
      env: {}
    })).rejects.toThrow('text reasoner')
  })

  it('keeps external env clean and appends loopback no_proxy entries', () => {
    const env = codexRuntimeEnv({
      CODEX_CONFIG_HOME: '/old',
      no_proxy: 'localhost'
    }, '/tmp/codex-home')

    expect(env.CODEX_HOME).toBe('/tmp/codex-home')
    expect(env.CODEX_CONFIG_HOME).toBeUndefined()
    expect(env.no_proxy).toContain('localhost')
    expect(env.no_proxy).toContain('127.0.0.1')
    expect(env.no_proxy).toContain('::1')
  })

  it('expands home paths without rewriting non-home paths', () => {
    expect(expandHome('/tmp/codex')).toBe('/tmp/codex')
    expect(expandHome('')).toBe('')
    expect(expandHome('~/codex')).toContain('codex')
  })
})
