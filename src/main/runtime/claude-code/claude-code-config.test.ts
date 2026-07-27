import { describe, expect, it } from 'vitest'
import { delimiter, dirname } from 'node:path'
import { deriveTraceId } from '@sciforge/full-trace'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultClaudeRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  claudeCodeAnthropicBaseUrl,
  claudeCodeCliModel,
  claudeCodeSdkExtraArgs,
  claudeCodeRuntimeEnv,
  prepareClaudeCodeSdkLaunch,
  resolveClaudeCodeExecutable
} from './claude-code-config'

function settings(): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = 'http://127.0.0.1:49876/v1'
  modelRouter.publicModelAlias = 'sciforge-router'
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
    activeAgentRuntime: 'claude',
    modelAccess: { mode: 'api', planAdapterId: '' },
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        command: 'claude',
        configDir: '~/.sciforge/claude-code',
        extraArgs: ['--allowedTools', 'Edit']
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

describe('claude-code config launch helpers', () => {
  it('keeps the literal default command on the SDK-bundled executable', async () => {
    let executableChecks = 0
    await expect(resolveClaudeCodeExecutable(' claude ', {
      env: { PATH: '/external/bin' },
      homeDir: '/users/tester',
      platform: 'darwin',
      isExecutable: async () => {
        executableChecks += 1
        return true
      },
      readLoginShellPath: async () => '/login-shell/bin'
    })).resolves.toBeUndefined()
    expect(executableChecks).toBe(0)
  })

  it('expands and validates an explicitly configured executable path', async () => {
    const checked: string[] = []
    await expect(resolveClaudeCodeExecutable('~/.local/bin/claude', {
      homeDir: '/users/tester',
      platform: 'darwin',
      isExecutable: async (path) => {
        checked.push(path)
        return true
      }
    })).resolves.toBe('/users/tester/.local/bin/claude')
    expect(checked).toEqual(['/users/tester/.local/bin/claude'])

    await expect(resolveClaudeCodeExecutable('/missing/claude', {
      platform: 'darwin',
      isExecutable: async () => false
    })).rejects.toThrow('missing or not executable: /missing/claude')

    await expect(resolveClaudeCodeExecutable('./bin/claude', {
      platform: 'darwin',
      isExecutable: async () => true
    })).rejects.toThrow('must be absolute')
  })

  it('resolves a custom command from the inherited PATH', async () => {
    let loginShellReads = 0
    await expect(resolveClaudeCodeExecutable('claude-enterprise', {
      env: { PATH: '/gui/bin:/team/bin' },
      homeDir: '/users/tester',
      platform: 'darwin',
      isExecutable: async (path) => path === '/team/bin/claude-enterprise',
      readLoginShellPath: async () => {
        loginShellReads += 1
        return ''
      }
    })).resolves.toBe('/team/bin/claude-enterprise')
    expect(loginShellReads).toBe(0)
  })

  it('falls back to the login-shell PATH and common install directories', async () => {
    await expect(resolveClaudeCodeExecutable('claude-login', {
      env: { PATH: '/usr/bin', SHELL: '/bin/zsh' },
      homeDir: '/users/tester',
      platform: 'darwin',
      isExecutable: async (path) => path === '/volta/bin/claude-login',
      readLoginShellPath: async () => '/volta/bin:/opt/custom/bin'
    })).resolves.toBe('/volta/bin/claude-login')

    await expect(resolveClaudeCodeExecutable('claude-local', {
      env: { PATH: '' },
      homeDir: '/users/tester',
      platform: 'linux',
      isExecutable: async (path) => path === '/users/tester/.local/bin/claude-local',
      readLoginShellPath: async () => ''
    })).resolves.toBe('/users/tester/.local/bin/claude-local')

    await expect(resolveClaudeCodeExecutable('claude-nvm', {
      env: { PATH: '/usr/bin', NVM_BIN: '~/.nvm/current/bin' },
      homeDir: '/users/tester',
      platform: 'darwin',
      isExecutable: async (path) => path === '/users/tester/.nvm/current/bin/claude-nvm',
      readLoginShellPath: async () => ''
    })).resolves.toBe('/users/tester/.nvm/current/bin/claude-nvm')
  })

  it('reports an actionable error when a custom command cannot be resolved', async () => {
    await expect(resolveClaudeCodeExecutable('missing-claude', {
      env: { PATH: '/usr/bin' },
      homeDir: '/users/tester',
      platform: 'linux',
      isExecutable: async () => false,
      readLoginShellPath: async () => ''
    })).rejects.toThrow('Use the default "claude" for the SDK-bundled executable')
  })

  it('rejects Coding Plan and non-selected API access without a fallback', async () => {
    const codingPlan = settings()
    codingPlan.activeAgentRuntime = 'codex'
    codingPlan.modelAccess = { mode: 'coding-plan', planAdapterId: 'codex' }
    await expect(prepareClaudeCodeSdkLaunch({
      settings: codingPlan,
      text: 'hello',
      threadId: 'thread-plan',
      turnId: 'turn-plan'
    })).rejects.toThrow(/requires API model access/)

    const codexApi = settings()
    codexApi.activeAgentRuntime = 'codex'
    await expect(prepareClaudeCodeSdkLaunch({
      settings: codexApi,
      text: 'hello',
      threadId: 'thread-api',
      turnId: 'turn-api'
    })).rejects.toThrow(/selected Agent runtime/)
  })

  it('forces Claude Code traffic through the Model Router env', () => {
    const env = claudeCodeRuntimeEnv({
      OPENAI_API_KEY: 'sk-openai',
      DEEPSEEK_API_KEY: 'sk-deepseek',
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
      ANTHROPIC_API_KEY: 'sk-anthropic',
      ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'opus',
      ANTHROPIC_CUSTOM_HEADERS: 'authorization: inherited-secret\nx-inherited: conflict',
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
      SCIMODALITY_ROUTER_RUNTIME_TOKEN: 'outer-router-token'
    }, {
      configDir: '/tmp/claude-config',
      baseUrl: 'http://127.0.0.1:49876/v1',
      apiKey: 'local-runtime-router-key',
      model: 'sonnet',
      threadId: 'thread-env',
      turnId: 'turn-env'
    })

    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.QWEN_API_KEY).toBeUndefined()
    expect(env.DASHSCOPE_API_KEY).toBeUndefined()
    expect(env.GEMINI_API_KEY).toBeUndefined()
    expect(env.GOOGLE_API_KEY).toBeUndefined()
    expect(env.GROQ_API_KEY).toBeUndefined()
    expect(env.MISTRAL_API_KEY).toBeUndefined()
    expect(env.COHERE_API_KEY).toBeUndefined()
    expect(env.OPENROUTER_API_KEY).toBeUndefined()
    expect(env.AZURE_OPENAI_API_KEY).toBeUndefined()
    expect(env.TOGETHER_API_KEY).toBeUndefined()
    expect(env.FIREWORKS_API_KEY).toBeUndefined()
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(env.PERPLEXITY_API_KEY).toBeUndefined()
    expect(env.MOONSHOT_API_KEY).toBeUndefined()
    expect(env.ZHIPU_API_KEY).toBeUndefined()
    expect(env.SILICONFLOW_API_KEY).toBeUndefined()
    expect(env.ARK_API_KEY).toBeUndefined()
    expect(env.MODEL_PROVIDER).toBeUndefined()
    expect(env.KUN_BASE_URL).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_API_KEY).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_BASE_URL).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_MODEL).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER).toBeUndefined()
    expect(env.SCIFORGE_SCIMODALITY_SERVICE_URL).toBeUndefined()
    expect(env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN).toBeUndefined()
    expect(env.SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS).toBeUndefined()
    expect(env.SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN).toBeUndefined()
    expect(env.EXPERT_PROVIDER_BASE_URL).toBeUndefined()
    expect(env.EXPERT_PROVIDER_API_KEY).toBeUndefined()
    expect(env.SCIMODALITY_ROUTER_PORT).toBeUndefined()
    expect(env.SCIMODALITY_ROUTER_RUNTIME_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(env.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
    expect(env.ANTHROPIC_MODEL).toBe('sonnet')
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe([
      `x-sciforge-trace-id: ${deriveTraceId({ runtimeId: 'claude', threadId: 'thread-env', turnId: 'turn-env' })}`,
      'x-sciforge-runtime-id: claude',
      'x-sciforge-thread-id: thread-env',
      'x-sciforge-turn-id: turn-env'
    ].join('\n'))
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/claude-config')
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
  })

  it('prepares SDK launch options without allowing controlled CLI overrides', async () => {
    const launch = await prepareClaudeCodeSdkLaunch({
      settings: {
        ...settings(),
        agents: {
          ...settings().agents,
          claude: {
            ...defaultClaudeRuntimeSettings(),
            extraArgs: ['--model', 'opus', '--allowedTools', 'Edit']
          }
        }
      },
      text: 'hello',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspace: '/tmp/workspace',
      sessionId: 'session-1',
      managedConfigDir: '/tmp/claude-managed'
    })

    expect(launch.prompt).toBe('hello')
    expect(launch.sdkOptions).toMatchObject({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      resume: 'session-1',
      extraArgs: { allowedTools: 'Edit' }
    })
    expect(launch.sdkOptions.extraArgs).not.toHaveProperty('model')
    expect(launch.sdkOptions.extraArgs).not.toHaveProperty('cwd')
    expect(launch.cwd).toBe('/tmp/workspace')
    expect(launch.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(claudeCodeSdkExtraArgs([
      '--model',
      'opus',
      '--bare',
      '--dangerously-skip-permissions',
      '--allowedTools',
      'Edit'
    ])).toEqual({ allowedTools: 'Edit' })
  })

  it('passes a validated custom executable to the SDK and makes its directory discoverable', async () => {
    const current = settings()
    current.agents.claude = {
      ...(current.agents.claude ?? defaultClaudeRuntimeSettings()),
      command: process.execPath
    }
    const launch = await prepareClaudeCodeSdkLaunch({
      settings: current,
      text: 'hello',
      threadId: 'thread-custom-executable',
      turnId: 'turn-custom-executable',
      workspace: '/tmp/workspace',
      managedConfigDir: '/tmp/claude-managed',
      env: { PATH: '/usr/bin' }
    })

    expect(launch.pathToClaudeCodeExecutable).toBe(process.execPath)
    expect(launch.sdkOptions.pathToClaudeCodeExecutable).toBe(process.execPath)
    expect(launch.env.PATH?.split(delimiter)[0]).toBe(dirname(process.execPath))
  })

  it('rejects launch options when the text reasoner is incomplete', async () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner.baseUrl = ''

    await expect(prepareClaudeCodeSdkLaunch({
      settings: current,
      text: 'hello',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspace: '/tmp/workspace',
      managedConfigDir: '/tmp/claude-managed'
    })).rejects.toThrow('text reasoner')
  })

  it('uses Claude CLI model aliases instead of the router public alias', () => {
    expect(claudeCodeCliModel('', 'sciforge-router')).toBe('sonnet')
    expect(claudeCodeCliModel('sciforge-router', 'sciforge-router')).toBe('sonnet')
    expect(claudeCodeCliModel('opus', 'sciforge-router')).toBe('opus')
    expect(claudeCodeCliModel('claude-sonnet-4-5', 'sciforge-router')).toBe('claude-sonnet-4-5')
  })

  it('strips the /v1 suffix for Claude CLI base URL handling', () => {
    expect(claudeCodeAnthropicBaseUrl('http://127.0.0.1:3892/v1')).toBe('http://127.0.0.1:3892')
    expect(claudeCodeAnthropicBaseUrl('http://127.0.0.1:3892/v1/')).toBe('http://127.0.0.1:3892')
  })
})
