import { describe, expect, it } from 'vitest'
import {
  buildImageGenerationMcpServerConfig,
  buildImageGenerationLocalRuntimeMcpServerConfig,
  buildImageGenerationMcpJsonServerConfig,
  imageGenerationMcpEnv,
  imageGenerationMcpSettingsChanged,
  type ImageGenerationMcpLaunchConfig
} from './image-generation-mcp-config'
import {
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ImageGenerationSettingsPatchV1,
  type ModelRouterMemberSettingsPatchV1
} from '../shared/app-settings'

function createSettings(
  imageGenerator: ModelRouterMemberSettingsPatchV1 = {},
  imageGeneration: ImageGenerationSettingsPatchV1 = {}
): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
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
    imageGeneration: {
      componentSegmentationRunnerPath: '',
      componentSegmentationModelPath: '',
      ...imageGeneration
    },
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    skills: defaultSkillsSettings()
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
      apiKey: 'image-key',
      baseUrl: 'http://image-provider.example/v1',
      model: 'qwen-image-2.0-pro'
    }, {
      componentSegmentationRunnerPath: '/tmp/sciforge-component-runner',
      componentSegmentationModelPath: '/tmp/component-model.pt'
    }))

    expect(server).toMatchObject({
      enabled: true,
      transport: 'stdio',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'router-runtime-key',
        SCIFORGE_MODEL_ROUTER_IMAGE_MODEL: 'sciforge-router',
        SCIFORGE_COMPONENT_SEGMENTATION_RUNNER: '/tmp/sciforge-component-runner',
        SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH: '/tmp/component-model.pt',
        SCIFORGE_FASTSAM_RUNNER: '/tmp/sciforge-component-runner',
        SCIFORGE_FASTSAM_MODEL_PATH: '/tmp/component-model.pt'
      },
      trustedWorkspaceRoots: ['/tmp/workspace'],
      trustScope: 'user'
    })
    expect(JSON.stringify(server)).not.toContain('image-key')
    expect(JSON.stringify(server)).not.toContain('http://image-provider.example/v1')
  })

  it('passes the local Router to code-only text and vision QA without image credentials', () => {
    const settings = createSettings()
    const profile = settings.modelRouter!.profiles.default
    profile.textReasoner = {
      apiKey: 'text-upstream-key', baseUrl: 'https://text.example/v1', model: 'text-model'
    }
    profile.translators.vision = {
      apiKey: 'vision-upstream-key', baseUrl: 'https://vision.example/v1', model: 'vision-model'
    }
    expect(profile.imageGenerator.apiKey).toBe('')
    const servers = [
      buildImageGenerationMcpServerConfig(launch, '/tmp/workspace', settings),
      buildImageGenerationLocalRuntimeMcpServerConfig(launch, {}, '/tmp/workspace', settings),
      buildImageGenerationMcpJsonServerConfig(launch, '/tmp/workspace', settings)
    ]
    for (const server of servers) {
      expect(server.env).toEqual({
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'router-runtime-key',
        SCIFORGE_MODEL_ROUTER_IMAGE_MODEL: 'sciforge-router'
      })
      const serialized = JSON.stringify(server)
      for (const member of [profile.textReasoner, profile.translators.vision]) {
        expect(serialized).not.toContain(member.apiKey)
        expect(serialized).not.toContain(member.baseUrl)
        expect(serialized).not.toContain(member.model)
      }
    }
  })

  it.each([
    ['disabled', { enabled: false }],
    ['missing runtime key', { runtimeApiKey: '' }],
    ['blank runtime key', { runtimeApiKey: '   ' }],
    ['non-local endpoint', { baseUrl: 'https://upstream.example/v1' }],
    ['invalid endpoint', { baseUrl: 'not-a-url' }]
  ])('fails closed for a %s Router even with image upstream credentials', (_name, patch) => {
    const settings = createSettings({
      apiKey: 'image-upstream-key', baseUrl: 'https://image.example/v1', model: 'image-model'
    }, { componentSegmentationRunnerPath: '/tmp/runner' })
    Object.assign(settings.modelRouter!, patch)
    expect(imageGenerationMcpEnv(launch, settings)).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      SCIFORGE_COMPONENT_SEGMENTATION_RUNNER: '/tmp/runner',
      SCIFORGE_FASTSAM_RUNNER: '/tmp/runner'
    })
  })

  it('does not invent credentials when settings are absent', () => {
    expect(imageGenerationMcpEnv(launch)).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    const settings = createSettings()
    delete settings.modelRouter
    expect(imageGenerationMcpEnv(launch, settings)).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it.each([
    ['endpoint', { baseUrl: 'http://localhost:3999/v1' }],
    ['runtime key', { runtimeApiKey: 'rotated-runtime-key' }],
    ['public alias', { publicModelAlias: 'new-router-alias' }],
    ['enablement', { enabled: false }],
    ['auto-start', { autoStart: false }],
    ['invalid endpoint', { baseUrl: 'https://upstream.example/v1' }]
  ])('requests a restart when the authoritative Router %s changes without image credentials', (_name, patch) => {
    const prev = createSettings()
    const next = createSettings()
    Object.assign(next.modelRouter!, patch)
    expect(imageGenerationMcpSettingsChanged(prev, next)).toBe(true)
    expect(imageGenerationMcpSettingsChanged(next, prev)).toBe(true)
  })

  it.each(['textReasoner', 'vision'] as const)('requests a restart for %s configuration changes', (role) => {
    const prev = createSettings()
    const next = createSettings()
    const profile = next.modelRouter!.profiles.default
    const member = role === 'vision' ? profile.translators.vision : profile.textReasoner
    Object.assign(member, {
      apiKey: 'upstream-key', baseUrl: 'https://provider.example/v1', model: 'provider-model'
    })
    expect(imageGenerationMcpSettingsChanged(prev, next)).toBe(true)
    for (const patch of [
      { apiKey: 'rotated-key' }, { baseUrl: 'https://other.example/v1' },
      { model: 'other-model' }, { protocol: 'responses' as const }
    ]) {
      const changed = structuredClone(next)
      const changedProfile = changed.modelRouter!.profiles.default
      const changedMember = role === 'vision' ? changedProfile.translators.vision : changedProfile.textReasoner
      Object.assign(changedMember, patch)
      expect(imageGenerationMcpSettingsChanged(next, changed)).toBe(true)
    }
    expect(imageGenerationMcpSettingsChanged(next, prev)).toBe(true)
  })

  it('ignores normalized whitespace and unrelated app settings', () => {
    const prev = createSettings()
    const next = createSettings()
    next.theme = 'dark'
    next.modelRouter!.runtimeApiKey = '  router-runtime-key  '
    next.modelRouter!.publicModelAlias = ' sciforge-router '
    expect(imageGenerationMcpSettingsChanged(prev, next)).toBe(false)
  })

  it('requests a runtime restart when image worker launch env changes', () => {
    const configured = createSettings({
      apiKey: 'old-key',
      baseUrl: 'http://127.0.0.1:3888/v1',
      model: 'qwen-image-2.0-pro'
    })

    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings())).toBe(false)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({ model: 'image-model' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({}, { componentSegmentationRunnerPath: '/tmp/runner' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({}, { componentSegmentationModelPath: '/tmp/component-model.pt' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({}, { fastSamRunnerPath: '/tmp/legacy-runner' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(createSettings(), configured)).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'new-key', baseUrl: 'http://127.0.0.1:3888/v1', model: 'qwen-image-2.0-pro' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'old-key', baseUrl: 'http://127.0.0.1:3999/v1', model: 'qwen-image-2.0-pro' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'old-key', baseUrl: 'http://127.0.0.1:3888/v1', model: 'other-image-model' }))).toBe(true)
  })
})
