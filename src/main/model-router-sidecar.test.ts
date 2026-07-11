import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  buildModelRouterSidecarLaunch,
  ensureModelRouterSidecar,
  ensureModelRouterConfigFile,
  modelRouterConfigPath,
  syncModelRouterConfigFileFromSettings,
  syncModelRouterSettingsFromConfigFile
} from './model-router-sidecar'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:4567/v1',
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'local-runtime-key',
      profiles: {
        default: {
          textReasoner: {
            provider: 'openai-compatible',
            baseUrl: 'https://text-provider.example/v1',
            apiKey: 'text-secret',
            model: 'text-model'
          },
          imageGenerator: {
            provider: 'openai-compatible',
            baseUrl: 'https://image.example/v1',
            apiKey: 'image-secret',
            model: 'image-model'
          },
          translators: {
            vision: {
              provider: 'qwen-compatible',
              baseUrl: 'https://vision-provider.example/v1',
              apiKey: 'vision-secret',
              model: 'vision-model',
              maxSupplementRounds: 1
            },
            scientific: {
              baseUrl: 'http://127.0.0.1:3898',
              apiKey: 'sci-modality-token',
              model: 'sci-modality',
              timeoutMs: 12345
            }
          }
        }
      }
    },
    activeAgentRuntime: 'sciforge',
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
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

describe('buildModelRouterSidecarLaunch', () => {
  it('builds a dev workspace launch without writing provider secrets into config', () => {
    const result = buildModelRouterSidecarLaunch(settings(), {
      userDataDir: '/tmp/sciforge-user-data',
      appRoot: '/repo/sciforge',
      env: {
        OPENAI_API_KEY: 'outer-openai-key',
        OPENAI_BASE_URL: 'https://outer-openai.example/v1',
        OPENAI_MODEL: 'outer-openai-model',
        DEEPSEEK_API_KEY: 'outer-deepseek-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
        ANTHROPIC_API_KEY: 'outer-anthropic-key',
        ANTHROPIC_AUTH_TOKEN: 'outer-anthropic-token',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'outer-sonnet',
        QWEN_API_KEY: 'outer-qwen-key',
        QWEN_BASE_URL: 'https://dashscope.example/v1',
        TOGETHER_API_KEY: 'outer-together-key',
        TOGETHER_BASE_URL: 'https://api.together.example/v1',
        FIREWORKS_API_KEY: 'outer-fireworks-key',
        XAI_API_KEY: 'outer-xai-key',
        PERPLEXITY_API_KEY: 'outer-perplexity-key',
        MOONSHOT_API_KEY: 'outer-moonshot-key',
        ZHIPU_API_KEY: 'outer-zhipu-key',
        SILICONFLOW_API_KEY: 'outer-siliconflow-key',
        ARK_API_KEY: 'outer-ark-key',
        MODEL_PROVIDER: 'outer-provider',
        KUN_BASE_URL: 'https://old-runtime-provider.example/v1',
        SCIFORGE_TEXT_API_KEY: 'outer-standalone-text-key',
        SCIFORGE_TEXT_BASE_URL: 'https://outer-standalone-text.example/v1',
        SCIFORGE_TEXT_MODEL: 'outer-standalone-text-model',
        SCIFORGE_VISION_API_KEY: 'outer-standalone-vision-key',
        SCIFORGE_VISION_BASE_URL: 'https://outer-standalone-vision.example/v1',
        SCIFORGE_VISION_MODEL: 'outer-standalone-vision-model',
        SCIFORGE_IMAGE_API_KEY: 'outer-image-key',
        SCIFORGE_IMAGE_BASE_URL: 'https://direct-image-provider.example/v1',
        SCIFORGE_IMAGE_MODEL: 'outer-image-model',
        SCIFORGE_IMAGE_ALLOW_PLACEHOLDER: '1',
        SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'stale-image-router-key',
        KUN_MODEL_ROUTER_API_KEY: 'old-router-key',
        KUN_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:4888/v1',
        KUN_MODEL_ROUTER_MODEL: 'old-router-model',
        MODEL_ROUTER_API_KEY: 'generic-router-key',
        MODEL_ROUTER_RUNTIME_API_KEY: 'generic-runtime-router-key',
        MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:4999/v1',
        MODEL_ROUTER_MODEL: 'generic-router-model',
        EDAG_LLM_BASE_URL: 'https://direct-edag-provider.example/v1',
        EDAG_LLM_API_KEY: 'outer-edag-key',
        EDAG_LLM_MODEL: 'outer-edag-model',
        EXPERT_PROVIDER_BASE_URL: 'http://127.0.0.1:8001/v1',
        EXPERT_PROVIDER_API_KEY: 'outer-expert-token',
        SCIMODALITY_ROUTER_PORT: '3898',
        SCIMODALITY_ROUTER_RUNTIME_TOKEN: 'outer-router-token',
        SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://127.0.0.1:3898',
        SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'sci-modality-token',
        SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS: '12345',
        SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'stale-scientific-token'
      },
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.command).toBe('npm')
    expect(result.launch.cwd).toBe('/repo/sciforge')
    expect(result.launch.args).toEqual([
      '--workspace',
      '@sciforge/model-router',
      'run',
      'start',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '4567',
      '--config',
      '/tmp/sciforge-user-data/model-router/config.json',
      '--workspace-root',
      '/tmp/workspace',
      '--quiet'
    ])
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_TEXT_API_KEY).toBe('text-secret')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_VISION_API_KEY).toBe('vision-secret')
    expect(result.launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(result.launch.env.OPENAI_BASE_URL).toBeUndefined()
    expect(result.launch.env.OPENAI_MODEL).toBeUndefined()
    expect(result.launch.env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(result.launch.env.DEEPSEEK_BASE_URL).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(result.launch.env.QWEN_API_KEY).toBeUndefined()
    expect(result.launch.env.QWEN_BASE_URL).toBeUndefined()
    expect(result.launch.env.TOGETHER_API_KEY).toBeUndefined()
    expect(result.launch.env.TOGETHER_BASE_URL).toBeUndefined()
    expect(result.launch.env.FIREWORKS_API_KEY).toBeUndefined()
    expect(result.launch.env.XAI_API_KEY).toBeUndefined()
    expect(result.launch.env.PERPLEXITY_API_KEY).toBeUndefined()
    expect(result.launch.env.MOONSHOT_API_KEY).toBeUndefined()
    expect(result.launch.env.ZHIPU_API_KEY).toBeUndefined()
    expect(result.launch.env.SILICONFLOW_API_KEY).toBeUndefined()
    expect(result.launch.env.ARK_API_KEY).toBeUndefined()
    expect(result.launch.env.MODEL_PROVIDER).toBeUndefined()
    expect(result.launch.env.KUN_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_TEXT_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIFORGE_TEXT_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_TEXT_MODEL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_VISION_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIFORGE_VISION_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_VISION_MODEL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_MODEL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER).toBeUndefined()
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY).toBe('image-secret')
    expect(result.launch.env.KUN_MODEL_ROUTER_API_KEY).toBeUndefined()
    expect(result.launch.env.KUN_MODEL_ROUTER_BASE_URL).toBeUndefined()
    expect(result.launch.env.KUN_MODEL_ROUTER_MODEL).toBeUndefined()
    expect(result.launch.env.MODEL_ROUTER_API_KEY).toBeUndefined()
    expect(result.launch.env.MODEL_ROUTER_RUNTIME_API_KEY).toBeUndefined()
    expect(result.launch.env.MODEL_ROUTER_BASE_URL).toBeUndefined()
    expect(result.launch.env.MODEL_ROUTER_MODEL).toBeUndefined()
    expect(result.launch.env.EDAG_LLM_BASE_URL).toBeUndefined()
    expect(result.launch.env.EDAG_LLM_API_KEY).toBeUndefined()
    expect(result.launch.env.EDAG_LLM_MODEL).toBeUndefined()
    expect(result.launch.env.EXPERT_PROVIDER_BASE_URL).toBeUndefined()
    expect(result.launch.env.EXPERT_PROVIDER_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIMODALITY_ROUTER_PORT).toBeUndefined()
    expect(result.launch.env.SCIMODALITY_ROUTER_RUNTIME_TOKEN).toBeUndefined()
    expect(result.launch.env.SCIFORGE_SCIMODALITY_SERVICE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN).toBeUndefined()
    expect(result.launch.env.SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS).toBeUndefined()
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN).toBe('sci-modality-token')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_TEXT_API_KEY).toBe('text-secret')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_VISION_API_KEY).toBe('vision-secret')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY).toBe('image-secret')
    expect(result.launch.config?.profiles.default.textReasoner).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://text-provider.example/v1',
      apiKeyEnv: 'SCIFORGE_MODEL_ROUTER_TEXT_API_KEY',
      model: 'text-model'
    })
    expect(JSON.stringify(result.launch.config)).not.toContain('text-secret')
    expect(JSON.stringify(result.launch.config)).not.toContain('vision-secret')
    expect(result.launch.config?.profiles.default.translators.vision).toEqual({
      provider: 'qwen-compatible',
      baseUrl: 'https://vision-provider.example/v1',
      apiKeyEnv: 'SCIFORGE_MODEL_ROUTER_VISION_API_KEY',
      model: 'vision-model',
      maxSupplementRounds: 1
    })
    expect(result.launch.config?.profiles.default.translators.scientific).toEqual({
      baseUrl: 'http://127.0.0.1:3898',
      tokenEnv: 'SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN',
      model: 'sci-modality',
      timeoutMs: 12345
    })
  })

  it('maps the Model Router image role into the managed sidecar config', () => {
    const current = settings()
    current.modelRouter!.profiles.default.imageGenerator = {
      provider: 'openai-compatible',
      apiKey: 'image-secret',
      baseUrl: 'https://image.example/v1',
      model: 'image-model'
    }

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/sciforge-user-data',
      env: {
        SCIFORGE_IMAGE_API_KEY: 'outer-direct-image-key',
        SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY: 'stale-image-router-key'
      },
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.env.SCIFORGE_IMAGE_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY).toBe('image-secret')
    expect(result.launch.config?.profiles.default.imageGenerator).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://image.example/v1',
      apiKeyEnv: 'SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY',
      model: 'image-model'
    })
    expect(JSON.stringify(result.launch.config)).not.toContain('image-secret')
  })

  it('uses gpt-image-2 as the internal image provider model when settings omit it', () => {
    const current = settings()
    current.modelRouter!.profiles.default.imageGenerator = {
      provider: 'openai-compatible',
      apiKey: 'image-secret',
      baseUrl: 'https://image.example/v1',
      model: ''
    }

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/sciforge-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.config?.publicModelAlias).toBe('sciforge-router')
    expect(result.launch.config?.profiles.default.imageGenerator).toMatchObject({
      apiKeyEnv: 'SCIFORGE_MODEL_ROUTER_IMAGE_API_KEY',
      model: 'gpt-image-2'
    })
  })

  it('fails closed when the text reasoner member is incomplete in UI settings', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner.apiKey = ''
    current.modelRouter!.profiles.default.textReasoner.baseUrl = ''
    current.modelRouter!.profiles.default.textReasoner.model = ''

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/sciforge-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result).toEqual({
      ok: false,
      reason: 'Model Router text reasoner Base URL, API key, and model name are required.'
    })
  })

  it('does not use the local config file as a launch bypass for incomplete UI settings', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner = {
      provider: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      model: ''
    }

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/sciforge-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('Model Router text reasoner Base URL, API key, and model name are required.')
  })

  it('writes the current local Model Router config template and repairs stale files', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-config-'))
    try {
      const current = settings()
      current.modelRouter!.profiles.default.textReasoner = {
        provider: 'openai-compatible',
        baseUrl: '',
        apiKey: '',
        model: ''
      }

      const created = await ensureModelRouterConfigFile(current, { userDataDir })
      const content = await readFile(created.path, 'utf8')

      expect(created.created).toBe(true)
      expect(created.path).toBe(modelRouterConfigPath(userDataDir))
      expect(content).toContain('"publicModelAlias": "sciforge-router"')
      expect(content).toContain('"baseUrl": ""')
      expect(content).toContain('"apiKeyEnv": "SCIFORGE_MODEL_ROUTER_TEXT_API_KEY"')
      expect(content).toContain('"model": ""')

      await writeFile(created.path, '', 'utf8')
      const repaired = await ensureModelRouterConfigFile(current, { userDataDir })
      const afterSecondEnsure = await readFile(created.path, 'utf8')
      expect(repaired.created).toBe(false)
      expect(afterSecondEnsure).toBe(content)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('syncs GUI Model Router roles into the local config file', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-config-sync-from-settings-'))
    try {
      const current = settings()
      current.modelRouter!.profiles.default.textReasoner.baseUrl = 'https://text-sync.example/v1'
      current.modelRouter!.profiles.default.imageGenerator.model = 'image-sync-model'
      current.modelRouter!.profiles.default.translators.scientific.model = 'scientific-sync-model'

      const synced = await syncModelRouterConfigFileFromSettings(current, { userDataDir })
      const parsed = JSON.parse(await readFile(synced.path, 'utf8'))

      expect(parsed.profiles.default.textReasoner.baseUrl).toBe('https://text-sync.example/v1')
      expect(parsed.profiles.default.imageGenerator.model).toBe('image-sync-model')
      expect(parsed.profiles.default.translators.scientific.model).toBe('scientific-sync-model')
      expect(JSON.stringify(parsed)).not.toContain('text-secret')
      expect(JSON.stringify(parsed)).not.toContain('image-secret')
      expect(JSON.stringify(parsed)).not.toContain('sci-modality-token')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('syncs the local config file back into GUI Model Router settings without dropping secrets', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-config-sync-to-settings-'))
    try {
      await mkdir(join(userDataDir, 'model-router'), { recursive: true })
      await writeFile(modelRouterConfigPath(userDataDir), `${JSON.stringify({
        defaultProfile: 'default',
        publicModelAlias: 'router-from-file',
        runtimeApiKeyEnv: 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY',
        profiles: {
          default: {
            traceRoot: '/tmp/traces',
            textReasoner: {
              provider: 'file-text-provider',
              baseUrl: 'https://file-text.example/v1',
              apiKeyEnv: 'TEXT_KEY',
              model: 'file-text-model'
            },
            imageGenerator: {
              provider: 'file-image-provider',
              baseUrl: 'https://file-image.example/v1',
              apiKeyEnv: 'IMAGE_KEY',
              model: 'file-image-model'
            },
            translators: {
              vision: {
                provider: 'file-vision-provider',
                baseUrl: 'https://file-vision.example/v1',
                apiKeyEnv: 'VISION_KEY',
                model: 'file-vision-model',
                maxSupplementRounds: 2
              },
              scientific: {
                baseUrl: 'http://127.0.0.1:3999',
                tokenEnv: 'SCI_KEY',
                model: 'file-scientific-model',
                timeoutMs: 2222
              }
            }
          }
        }
      }, null, 2)}\n`, 'utf8')

      const synced = await syncModelRouterSettingsFromConfigFile(settings(), { userDataDir })
      const profile = synced.modelRouter!.profiles.default

      expect(synced.modelRouter!.publicModelAlias).toBe('router-from-file')
      expect(profile.textReasoner).toMatchObject({
        provider: 'file-text-provider',
        baseUrl: 'https://file-text.example/v1',
        apiKey: 'text-secret',
        model: 'file-text-model'
      })
      expect(profile.imageGenerator).toMatchObject({
        provider: 'file-image-provider',
        baseUrl: 'https://file-image.example/v1',
        apiKey: 'image-secret',
        model: 'file-image-model'
      })
      expect(profile.translators.vision).toMatchObject({
        provider: 'file-vision-provider',
        baseUrl: 'https://file-vision.example/v1',
        apiKey: 'vision-secret',
        model: 'file-vision-model',
        maxSupplementRounds: 2
      })
      expect(profile.translators.scientific).toMatchObject({
        baseUrl: 'http://127.0.0.1:3999',
        apiKey: 'sci-modality-token',
        model: 'file-scientific-model',
        timeoutMs: 2222
      })
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('spawns the managed sidecar instead of reusing an unmanaged healthy router on the same port', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/health') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ ok: true, service: 'sciforge.model-router' }))
        return
      }
      response.statusCode = 404
      response.end('{}')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-managed-sidecar-'))
    const current = settings()
    current.modelRouter!.baseUrl = `http://127.0.0.1:${address.port}/v1`
    const child = fakeChildProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
    const log = vi.fn()

    try {
      await ensureModelRouterSidecar(current, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith('Starting Model Router sidecar from /repo/sciforge.')
      child.emit('exit', 0, null)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('spawns from the explicit app root and logs sidecar output and unexpected exits', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-'))
    const current = settings()
    current.modelRouter!.baseUrl = 'http://127.0.0.1:45987/v1'
    const child = fakeChildProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
    const log = vi.fn()

    try {
      await ensureModelRouterSidecar(current, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['--workspace', '@sciforge/model-router']),
        expect.objectContaining({
          cwd: '/repo/sciforge',
          stdio: ['ignore', 'pipe', 'pipe']
        })
      )

      child.stderr?.emit('data', Buffer.from('router boot failed\n'))
      child.emit('exit', 1, null)

      expect(log).toHaveBeenCalledWith('Starting Model Router sidecar from /repo/sciforge.')
      expect(log).toHaveBeenCalledWith('Model Router sidecar stderr: router boot failed')
      expect(log).toHaveBeenCalledWith('Model Router sidecar exited unexpectedly (code=1, signal=null).')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('rewrites the managed config before spawning the sidecar', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-config-'))
    const current = settings()
    current.modelRouter!.baseUrl = 'http://127.0.0.1:45990/v1'
    current.modelRouter!.profiles.default.textReasoner = {
      provider: 'openai-compatible',
      baseUrl: 'https://fresh-text-provider.example/v1',
      apiKey: 'fresh-text-secret',
      model: 'fresh-text-model'
    }
    const child = fakeChildProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn

    try {
      await mkdir(join(userDataDir, 'model-router'), { recursive: true })
      await writeFile(modelRouterConfigPath(userDataDir), '{"publicModelAlias":"stale-router"}\n', 'utf8')

      await ensureModelRouterSidecar(current, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl
      })

      const content = await readFile(modelRouterConfigPath(userDataDir), 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.publicModelAlias).toBe('sciforge-router')
      expect(parsed.profiles.default.textReasoner.baseUrl).toBe('https://fresh-text-provider.example/v1')
      expect(parsed.profiles.default.textReasoner.model).toBe('fresh-text-model')
      expect(content).not.toContain('fresh-text-secret')
      expect(content).toContain('"apiKeyEnv": "SCIFORGE_MODEL_ROUTER_TEXT_API_KEY"')
      expect(spawnImpl).toHaveBeenCalledTimes(1)
      child.emit('exit', 0, null)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('restarts a managed sidecar when the derived router config changes', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-config-restart-'))
    const firstChild = fakeChildProcess()
    const secondChild = fakeChildProcess()
    const children = [firstChild, secondChild]
    const spawnImpl = vi.fn(() => children.shift() ?? fakeChildProcess()) as unknown as typeof spawn
    const log = vi.fn()

    try {
      const firstSettings = settings()
      firstSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45991/v1'
      firstSettings.modelRouter!.profiles.default.textReasoner.model = 'first-text-model'

      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      const secondSettings = settings()
      secondSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45991/v1'
      secondSettings.modelRouter!.profiles.default.textReasoner.model = 'second-text-model'

      await ensureModelRouterSidecar(secondSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledTimes(2)
      expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM')
      expect(log).toHaveBeenCalledWith('Model Router sidecar launch settings changed; restarting sidecar.')
      secondChild.emit('exit', 0, null)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('reuses matching sidecars and restarts when managed launch settings change', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-restart-'))
    const firstChild = fakeChildProcess()
    const secondChild = fakeChildProcess()
    const children = [firstChild, secondChild]
    const spawnImpl = vi.fn(() => children.shift() ?? fakeChildProcess()) as unknown as typeof spawn
    const log = vi.fn()

    try {
      const firstSettings = settings()
      firstSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45988/v1'
      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })
      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      const secondSettings = settings()
      secondSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45988/v1'
      secondSettings.modelRouter!.runtimeApiKey = 'local-runtime-key-2'
      await ensureModelRouterSidecar(secondSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledTimes(2)
      expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM')
      expect(log).toHaveBeenCalledWith('Model Router sidecar launch settings changed; restarting sidecar.')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess & {
    stdout: NonNullable<ChildProcess['stdout']>
    stderr: NonNullable<ChildProcess['stderr']>
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    child.exitCode = 0
    child.signalCode = typeof signal === 'string' ? signal : null
    child.emit('exit', child.exitCode, child.signalCode)
    return true
  }) as unknown as ChildProcess['kill']
  return child
}
