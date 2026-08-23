import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  CODEX_PLAN_GATEWAY_PROVIDER_ID,
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
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('codex config launch helpers', () => {
  it('finds a Codex standalone install when a Finder launch omits the user bin directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-command-'))
    const command = join(home, '.local', 'bin', 'codex')
    await mkdir(join(home, '.local', 'bin'), { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolveCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => ''
    })).resolves.toBe(command)
  })

  it('uses the interactive login shell PATH when Finder supplies only the system PATH', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-login-shell-'))
    const shellBin = join(home, 'shell-managed', 'bin')
    const command = join(shellBin, 'codex')
    const fakeShell = join(home, 'test-login-shell')
    await mkdir(shellBin, { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)
    await writeFile(
      fakeShell,
      '#!/bin/sh\nprintf \'\\036%s\\037\' "$SCIFORGE_TEST_LOGIN_PATH"\n',
      'utf8'
    )
    await chmod(fakeShell, 0o755)

    await expect(resolveCodexCommand('codex', {
      env: {
        PATH: '/usr/bin:/bin',
        SHELL: fakeShell,
        SCIFORGE_TEST_LOGIN_PATH: `/usr/bin:${shellBin}`
      },
      homeDir: home,
      platform: 'darwin'
    })).resolves.toBe(command)
  })

  it.each([
    ['asdf', ['.asdf', 'shims']],
    ['Volta', ['.volta', 'bin']],
    ['pnpm', ['Library', 'pnpm']],
    ['Bun', ['.bun', 'bin']]
  ])('finds a Codex install managed by %s outside the inherited PATH', async (_manager, parts) => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-manager-'))
    const binDir = join(home, ...parts)
    const command = join(binDir, 'codex')
    await mkdir(binDir, { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolveCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => ''
    })).resolves.toBe(command)
  })

  it('searches installed nvm Node versions when no version is activated in Finder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-nvm-'))
    const olderBin = join(home, '.nvm', 'versions', 'node', 'v20.19.0', 'bin')
    const newerBin = join(home, '.nvm', 'versions', 'node', 'v22.17.0', 'bin')
    await mkdir(olderBin, { recursive: true })
    await mkdir(newerBin, { recursive: true })
    await writeFile(join(olderBin, 'codex'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(newerBin, 'codex'), '#!/bin/sh\n', 'utf8')
    await chmod(join(olderBin, 'codex'), 0o755)
    await chmod(join(newerBin, 'codex'), 0o755)

    await expect(resolveCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => ''
    })).resolves.toBe(join(newerBin, 'codex'))
  })

  it('skips the extensionless Windows npm shim and resolves its cmd wrapper', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-windows-'))
    const npmBin = join(home, 'AppData', 'Roaming', 'npm')
    const command = join(npmBin, 'codex.cmd')
    await mkdir(npmBin, { recursive: true })
    await writeFile(join(npmBin, 'codex'), '#!/usr/bin/env node\n', 'utf8')
    await writeFile(command, '@echo off\r\n', 'utf8')

    await expect(resolveCodexCommand('codex', {
      env: {
        Path: 'C:\\Windows\\System32',
        APPDATA: join(home, 'AppData', 'Roaming')
      },
      homeDir: home,
      platform: 'win32',
      getLoginShellPath: async () => {
        throw new Error('must not inspect a Unix shell on Windows')
      }
    })).resolves.toBe(command)
  })

  it('resolves an explicitly configured Windows cmd wrapper outside Explorer Path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-windows-explicit-'))
    const npmBin = join(home, 'AppData', 'Roaming', 'npm')
    const command = join(npmBin, 'codex.cmd')
    await mkdir(npmBin, { recursive: true })
    await writeFile(command, '@echo off\r\n', 'utf8')

    await expect(resolveCodexCommand('codex.cmd', {
      env: {
        Path: 'C:\\Windows\\System32',
        APPDATA: join(home, 'AppData', 'Roaming')
      },
      homeDir: home,
      platform: 'win32'
    })).resolves.toBe(command)
  })

  it('prefers and materializes a native Windows app executable over an extensionless companion', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-windows-native-'))
    const bin = join(
      home,
      'Program Files',
      'WindowsApps',
      'OpenAI.Codex_26.810.7004.0_x64__test',
      'app',
      'resources'
    )
    const nativeCommand = join(bin, 'codex.exe')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'codex'), 'platform-neutral binary', 'utf8')
    await writeFile(nativeCommand, 'native Windows binary', 'utf8')
    await writeFile(join(bin, 'codex-code-mode-host.exe'), 'code mode host', 'utf8')

    await expect(resolveCodexCommand('codex', {
      env: { PATH: bin },
      homeDir: home,
      platform: 'win32'
    })).resolves.toBe(join(home, '.sciforge', 'codex-runtime', 'codex.exe'))
    await expect(readFile(
      join(home, '.sciforge', 'codex-runtime', 'codex.exe'),
      'utf8'
    )).resolves.toBe('native Windows binary')
    await expect(readFile(
      join(home, '.sciforge', 'codex-runtime', 'codex-code-mode-host.exe'),
      'utf8'
    )).resolves.toBe('code mode host')
  })

  it('materializes the runtime bundled with the Windows Codex app', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-msix-'))
    const programFiles = join(home, 'Program Files')
    const source = join(
      programFiles,
      'WindowsApps',
      'OpenAI.Codex_26.715.4045.0_x64__test',
      'app',
      'resources',
      'codex.exe'
    )
    await mkdir(join(source, '..'), { recursive: true })
    await writeFile(source, 'packaged-codex-runtime', 'utf8')
    await writeFile(
      join(source, '..', 'codex-code-mode-host.exe'),
      'packaged-code-mode-host',
      'utf8'
    )

    const resolved = await resolveCodexCommand('codex', {
      env: { Path: 'C:\\Windows\\System32', ProgramFiles: programFiles },
      homeDir: home,
      platform: 'win32'
    })

    expect(resolved).toBe(join(home, '.sciforge', 'codex-runtime', 'codex.exe'))
    await expect(readFile(resolved, 'utf8')).resolves.toBe('packaged-codex-runtime')
    await expect(readFile(
      join(home, '.sciforge', 'codex-runtime', 'codex-code-mode-host.exe'),
      'utf8'
    )).resolves.toBe('packaged-code-mode-host')
  })

  it('repairs a missing code-mode companion when the managed Codex exe is current', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-companion-repair-'))
    const programFiles = join(home, 'Program Files')
    const resources = join(
      programFiles,
      'WindowsApps',
      'OpenAI.Codex_26.818.5229.0_x64__test',
      'app',
      'resources'
    )
    const source = join(resources, 'codex.exe')
    const managedDirectory = join(home, '.sciforge', 'codex-runtime')
    await mkdir(resources, { recursive: true })
    await mkdir(managedDirectory, { recursive: true })
    await writeFile(source, 'same-runtime', 'utf8')
    await writeFile(join(resources, 'codex-code-mode-host.exe'), 'repaired-host', 'utf8')
    await writeFile(join(managedDirectory, 'codex.exe'), 'same-runtime', 'utf8')

    await expect(resolveCodexCommand('codex', {
      env: { Path: 'C:\\Windows\\System32', ProgramFiles: programFiles },
      homeDir: home,
      platform: 'win32'
    })).resolves.toBe(join(managedDirectory, 'codex.exe'))
    await expect(readFile(
      join(managedDirectory, 'codex-code-mode-host.exe'),
      'utf8'
    )).resolves.toBe('repaired-host')
  })

  it('expands and validates an explicit Codex executable path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-explicit-codex-'))
    const command = join(home, 'custom', 'codex')
    await mkdir(join(home, 'custom'), { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolveCodexCommand('~/custom/codex', {
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => {
        throw new Error('must not inspect the shell for an explicit path')
      }
    })).resolves.toBe(command)

    const windowsCommand = 'C:\\Tools\\Codex\\codex.exe'
    await expect(resolveCodexCommand(windowsCommand, {
      homeDir: 'C:\\Users\\example',
      platform: 'win32',
      isExecutable: async (path) => path === windowsCommand
    })).resolves.toBe(windowsCommand)
  })

  it('rejects missing and relative explicit Codex paths with actionable errors', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-invalid-codex-'))

    await expect(resolveCodexCommand('~/missing/codex', {
      homeDir: home,
      platform: 'darwin'
    })).rejects.toThrow(
      `Codex executable was not found or is not executable at "${join(home, 'missing', 'codex')}". ` +
      'Check the path and file permissions, or use "codex" to auto-detect it.'
    )

    await expect(resolveCodexCommand('./tools/codex', {
      homeDir: home,
      platform: 'darwin',
      isExecutable: async () => {
        throw new Error('must not inspect a relative explicit path')
      }
    })).rejects.toThrow(
      'Codex command path must be absolute: "./tools/codex". ' +
      'Enter the absolute path to the Codex executable, or use "codex" to auto-detect it.'
    )
  })

  it('prefers the supplied PATH for a bare Codex command', async () => {
    await expect(resolveCodexCommand('codex', {
      env: { PATH: '/custom/bin:/usr/bin' },
      homeDir: '/Users/example',
      platform: 'darwin',
      isExecutable: async (path) => path === '/custom/bin/codex',
      getLoginShellPath: async () => {
        throw new Error('must not inspect the shell after PATH resolves the command')
      }
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
  }, 15_000)

  it('materializes the canonical app-owned PreToolUse hook in the isolated Codex home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-hook-home-'))
    const codexHome = join(root, 'codex-home')
    const appPath = join(root, 'SciForge App')
    const launch = await prepareCodexAppServerLaunch({
      settings: settings(codexHome),
      preToolUseHookLaunch: {
        appPath,
        execPath: process.execPath,
        isPackaged: false
      }
    })

    expect(launch.preToolUseHook).toMatchObject({
      sourcePath: join(codexHome, 'hooks.json')
    })
    await expect(readFile(join(codexHome, 'config.toml'), 'utf8')).resolves.toContain(
      '[features]\nhooks = true'
    )
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config.indexOf('model_provider = "sciforge-plan-gateway"'))
      .toBeLessThan(config.indexOf('[features]'))
    const hooks = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8'))
    expect(hooks).toEqual({
      hooks: {
        PreToolUse: [{
          hooks: [{
            type: 'command',
            command: launch.preToolUseHook?.command,
            commandWindows: launch.preToolUseHook?.commandWindows,
            timeout: 10,
            async: false,
            statusMessage: 'Checking SciForge visual execution policy'
          }]
        }]
      }
    })
  })

  it('keeps the Coding Plan provider at the TOML root when hooks are enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-plan-hook-home-'))
    const codexHome = join(root, 'codex-home')
    const current = settings(codexHome)
    current.modelAccess = { mode: 'coding-plan', planAdapterId: 'codex' }

    await prepareCodexAppServerLaunch({
      settings: current,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' },
      preToolUseHookLaunch: {
        appPath: join(root, 'SciForge App'),
        execPath: process.execPath,
        isPackaged: false
      }
    })

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    const provider = `model_provider = "${CODEX_PLAN_GATEWAY_PROVIDER_ID}"`
    const providerIndex = config.indexOf(provider)
    const featuresIndex = config.indexOf('[features]')

    expect(providerIndex).toBeGreaterThanOrEqual(0)
    expect(featuresIndex).toBeGreaterThanOrEqual(0)
    expect(providerIndex).toBeLessThan(featuresIndex)
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

  it('does not write managed MCP servers into Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: settings(codexHome)
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.')
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

  it('does not import auth credentials from an external CODEX_HOME', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(externalCodexHome, 'config.toml'), 'model_provider = "external"\n')
    await writeFile(join(externalCodexHome, 'auth.json'), '{"auth":"external-only"}\n', { mode: 0o600 })

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
    await expect(readFile(join(externalCodexHome, 'auth.json'), 'utf8'))
      .resolves.toBe('{"auth":"external-only"}\n')
    await expect(readFile(join(managedCodexHome, 'auth.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('imports explicitly trusted standard Codex auth without overwriting runtime config', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    const standardCodexHome = await mkdtemp(join(tmpdir(), 'standard-codex-home-'))
    const standardAuthPath = join(standardCodexHome, 'auth.json')
    await writeFile(standardAuthPath, '{"auth":"standard-login"}\n', { mode: 0o600 })

    await prepareCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      standardCodexAuthPath: standardAuthPath,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })

    await expect(readFile(join(managedCodexHome, 'auth.json'), 'utf8'))
      .resolves.toBe('{"auth":"standard-login"}\n')
    if (process.platform !== 'win32') {
      expect((await stat(join(managedCodexHome, 'auth.json'))).mode & 0o777).toBe(0o600)
    }
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
    expect((await stat(join(managedCodexHome, 'auth.json'))).mode & 0o777).toBe(0o600)
  })

  it.skipIf(process.platform === 'win32')('rejects a managed Codex auth symlink', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(externalCodexHome, 'auth.json'), '{"auth":"external"}\n', { mode: 0o600 })
    await symlink(join(externalCodexHome, 'auth.json'), join(managedCodexHome, 'auth.json'))

    await expect(prepareCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })).rejects.toThrow('managed auth.json must not be a symbolic link')
  })

  it.skipIf(process.platform === 'win32')('rejects a broadly accessible managed Codex auth file', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(managedCodexHome, 'auth.json'), '{"auth":"managed"}\n', { mode: 0o644 })

    await expect(prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })).rejects.toThrow('managed auth.json must not be group or world accessible')
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
