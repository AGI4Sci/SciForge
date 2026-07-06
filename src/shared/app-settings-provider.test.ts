import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  isModelRouterTextReasonerConfigured,
  resolveLocalRuntimeSettings,
  type AppSettingsV1
} from './app-settings'

function settings(): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    provider: 'openai-compatible',
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'sk-text',
    model: 'text-model'
  }

  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: {
      ...defaultModelProviderSettings(),
      providers: [
        ...defaultModelProviderSettings().providers,
        {
          id: 'custom',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          models: ['custom-model']
        }
      ]
    },
    modelRouter,
    agents: {
      sciforge: {
        ...defaultLocalRuntimeSettings(),
        providerId: 'custom',
        model: 'custom-model'
      }
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

describe('model provider settings', () => {
  it('keeps the DeepSeek provider allowlist stable during product rebrands', () => {
    const provider = defaultModelProviderSettings()
    const defaultProvider = provider.providers[0]

    expect(DEFAULT_MODEL_PROVIDER_ID).toBe('deepseek')
    expect(DEFAULT_DEEPSEEK_BASE_URL).toBe('http://127.0.0.1:3892/v1')
    expect(provider.apiKey).toBe('')
    expect(defaultProvider).toMatchObject({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'http://127.0.0.1:3892/v1',
      models: ['deepseek-v4-pro', 'deepseek-v4-flash']
    })
  })

  it('resolves local runtime credentials only from the local Model Router boundary', () => {
    const runtime = resolveLocalRuntimeSettings(settings())

    expect(runtime.apiKey).toBe('local-runtime-router-key')
    expect(runtime.baseUrl).toBe('http://127.0.0.1:3892/v1')
    expect(runtime.model).toBe(DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)
  })

  it('recognizes incomplete text reasoner settings independently of router credentials', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner.apiKey = ''

    expect(isModelRouterTextReasonerConfigured(current.modelRouter!)).toBe(false)
  })
})
