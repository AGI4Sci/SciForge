import { describe, expect, it } from 'vitest'
import {
  buildImageGenerationMcpServerConfig,
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

  it('requests a runtime restart when image worker launch env changes', () => {
    const configured = createSettings({
      apiKey: 'old-key',
      baseUrl: 'http://127.0.0.1:3888/v1',
      model: 'qwen-image-2.0-pro'
    })

    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings())).toBe(false)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({ model: 'image-model' }))).toBe(false)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({}, { componentSegmentationRunnerPath: '/tmp/runner' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({}, { componentSegmentationModelPath: '/tmp/component-model.pt' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({}, { fastSamRunnerPath: '/tmp/legacy-runner' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(createSettings(), configured)).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'new-key', baseUrl: 'http://127.0.0.1:3888/v1', model: 'qwen-image-2.0-pro' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'old-key', baseUrl: 'http://127.0.0.1:3999/v1', model: 'qwen-image-2.0-pro' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ apiKey: 'old-key', baseUrl: 'http://127.0.0.1:3888/v1', model: 'other-image-model' }))).toBe(true)
  })
})
