import { describe, expect, it } from 'vitest'
import {
  buildImageGenerationMcpServerConfig,
  imageGenerationMcpSettingsChanged,
  type ImageGenerationMcpLaunchConfig
} from './image-generation-mcp-config'
import {
  defaultConnectPhoneSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultRemoteChannelSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ModelRouterMemberProviderSettingsPatchV1
} from '../shared/app-settings'

function createSettings(imageGenerator: ModelRouterMemberProviderSettingsPatchV1 = {}): AppSettingsV1 {
  const remoteChannel = defaultRemoteChannelSettings()
  const modelRouter = defaultModelRouterSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...modelRouter,
      baseUrl: 'http://127.0.0.1:3892/v1',
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'router-runtime-key',
      profiles: {
        default: {
          ...modelRouter.profiles.default,
          imageGenerator: {
            ...modelRouter.profiles.default.imageGenerator,
            ...imageGenerator
          }
        }
      }
    },
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
    workflow: defaultWorkflowSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    remoteChannel: {
      ...remoteChannel,
      enabled: true,
      im: {
        ...remoteChannel.im,
        enabled: true,
        port: 8787,
        secret: ''
      }
    },
    connectPhone: defaultConnectPhoneSettings()
  }
}

const launch: ImageGenerationMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('image generation MCP config', () => {
  it('passes Model Router image endpoint settings through stdio MCP env', () => {
    const server = buildImageGenerationMcpServerConfig(launch, '/tmp/workspace', createSettings({
      provider: 'openai-compatible',
      apiKey: 'image-key',
      baseUrl: 'http://image-provider.example/v1',
      model: 'qwen-image-2.0-pro'
    }))

    expect(server).toMatchObject({
      enabled: true,
      transport: 'stdio',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'router-runtime-key',
        SCIFORGE_MODEL_ROUTER_IMAGE_MODEL: 'sciforge-router'
      },
      trustedWorkspaceRoots: ['/tmp/workspace'],
      trustScope: 'user'
    })
    expect(JSON.stringify(server)).not.toContain('image-key')
    expect(JSON.stringify(server)).not.toContain('http://image-provider.example/v1')
  })

  it('requests a runtime restart when image worker launch env changes', () => {
    const configured = createSettings({
      provider: 'openai-compatible',
      apiKey: 'old-key',
      baseUrl: 'http://127.0.0.1:3888/v1',
      model: 'qwen-image-2.0-pro'
    })

    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings())).toBe(false)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({ model: 'gpt-image-2' }))).toBe(false)
    expect(imageGenerationMcpSettingsChanged(createSettings(), configured)).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'new-key', baseUrl: 'http://127.0.0.1:3888/v1', model: 'qwen-image-2.0-pro' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'old-key', baseUrl: 'http://127.0.0.1:3999/v1', model: 'qwen-image-2.0-pro' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'old-key', baseUrl: 'http://127.0.0.1:3888/v1', model: 'gpt-image-2' }))).toBe(true)
  })
})
