import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultSpeechToTextSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { GeneralSettingsSection } from './settings-section-general'

const labels: Record<string, string> = {
  sectionGeneral: 'Basics',
  modelRouterModels: 'Model Router models',
  modelRouterRoleBaseUrl: 'Base URL',
  modelRouterRoleApiKey: 'API key',
  modelRouterRoleModel: 'Model name',
  modelRouterTextReasoner: 'Text understanding and reasoning',
  modelRouterTextReasonerDesc: 'Default model.',
  modelRouterTextReasonerBaseUrlPlaceholder: 'https://api.example.com/v1',
  modelRouterTextReasonerModelPlaceholder: 'deepseek-v4-pro',
  modelRouterVisionTranslator: 'Image understanding',
  modelRouterVisionTranslatorDesc: 'Vision model.',
  modelRouterVisionTranslatorBaseUrlPlaceholder: 'https://api.example.com/v1',
  modelRouterVisionTranslatorModelPlaceholder: 'qwen-vl-max',
  modelRouterImageGenerator: 'Image generation',
  modelRouterImageGeneratorDesc: 'Image model.',
  modelRouterImageGeneratorBaseUrlPlaceholder: 'https://api.example.com/v1',
  modelRouterImageGeneratorModelPlaceholder: 'gpt-image-2',
  modelRouterScientificTranslator: 'Scientific modality translation',
  modelRouterScientificTranslatorDesc: 'Scientific model.',
  modelRouterScientificTranslatorBaseUrlPlaceholder: 'http://127.0.0.1:3898',
  modelRouterScientificTranslatorModelPlaceholder: 'sci-modality',
  modelRouterConfigFile: 'Model Router config file',
  modelRouterConfigFileDesc: 'Edit provider members, routing rules, and upstream credentials in the local config file.',
  modelRouterOpenConfigFile: 'Open Model Router config file',
  language: 'Language',
  languageDesc: 'Choose a language.',
  theme: 'Theme',
  themeDesc: 'Choose a theme.',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  onboardingPreview: 'Initial setup guide',
  onboardingPreviewDesc: 'Open the initial setup flow.',
  onboardingPreviewOpen: 'Open guide',
  fontScale: 'Font size',
  fontScaleDesc: 'Adjust font size.',
  fontScaleSmall: 'Small',
  fontScaleMedium: 'Medium',
  fontScaleLarge: 'Large',
  turnCompleteNotification: 'Completion notification',
  turnCompleteNotificationDesc: 'Show a notification.',
  workspaceRoot: 'Default working directory',
  workspaceRootDesc: 'Default workspace.',
  workspaceRootPlaceholder: '~/.sciforge/default_workspace',
  restoreWorkspaceDefault: 'Restore default',
  browse: 'Browse',
  desktopBehavior: 'Desktop behavior',
  desktopOpenAtLogin: 'Open at login',
  desktopOpenAtLoginUnsupportedDesc: 'Unsupported.',
  desktopStartMinimized: 'Start minimized',
  desktopStartMinimizedDisabledDesc: 'Disabled.',
  desktopCloseToTray: 'Close to tray',
  desktopCloseToTrayDesc: 'Keep running.',
  evidenceDagSettings: 'Evidence DAG',
  evidenceDagEnabled: 'Enable Evidence DAG',
  evidenceDagEnabledDesc: 'Build evidence graphs in the background.',
  guiUpdate: 'GUI update',
  guiUpdateChannel: 'Update channel',
  guiUpdateChannelDesc: 'Choose channel.',
  guiUpdateChannelFrontier: 'Frontier',
  guiUpdateChannelStable: 'Stable',
  guiUpdateDesc: 'Check for updates.',
  logTitle: 'Logs',
  logEnabled: 'Enable logs',
  logEnabledDesc: 'Write logs.',
  logRetention: 'Retention',
  logRetentionDesc: 'Keep logs.',
  logRetentionOne: '1 day',
  logRetentionTwo: '2 days',
  logRetentionThree: '3 days',
  logRetentionFive: '5 days',
  logRetentionSeven: '7 days',
  logDir: 'Log directory',
  logDirDesc: 'Open logs.',
  logDirOpen: 'Open log directory',
  showSecret: 'Show',
  hideSecret: 'Hide'
}

function t(key: string): string {
  return labels[key] ?? key
}

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
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
    speechToText: defaultSpeechToTextSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('GeneralSettingsSection', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      sciforge: {
        platform: 'linux',
        openLogDir: vi.fn(),
        openModelRouterConfigFile: vi.fn()
      }
    })
  })

  it('renders a Model Router config file button in basics', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, {
      ctx: {
        t,
        tCommon: t,
        form: buildSettings(),
        update: vi.fn(),
        selectControlClass: 'select-control',
        openOnboardingPreview: vi.fn(),
        pickWorkspace: vi.fn(),
        resetWorkspaceToDefault: vi.fn(),
        workspacePickerError: null,
        guiUpdateInfo: null,
        checkingGuiUpdate: false,
        downloadingGuiUpdate: false,
        installingGuiUpdate: false,
        guiUpdateDownloaded: false,
        guiUpdateProgress: null,
        guiUpdateError: null,
        checkGuiUpdate: vi.fn(),
        downloadGuiUpdate: vi.fn(),
        installGuiUpdate: vi.fn(),
        logPath: '/tmp/sciforge.log',
        logDirOpenError: null,
        setLogDirOpenError: vi.fn()
      }
    }))

    expect(html).toContain('Model Router models')
    expect(html).toContain('Text understanding and reasoning')
    expect(html).toContain('Image understanding')
    expect(html).toContain('Image generation')
    expect(html).toContain('Scientific modality translation')
    expect(html).toContain('Model Router config file')
    expect(html).toContain('Open Model Router config file')
    expect(html).toContain('Enable Evidence DAG')
    expect(html).toContain('Build evidence graphs in the background.')
  })

  it('keeps Model Router API keys hidden by default', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, {
      ctx: {
        t,
        tCommon: t,
        form: buildSettings(),
        update: vi.fn(),
        selectControlClass: 'select-control',
        openOnboardingPreview: vi.fn(),
        pickWorkspace: vi.fn(),
        resetWorkspaceToDefault: vi.fn(),
        workspacePickerError: null,
        guiUpdateInfo: null,
        checkingGuiUpdate: false,
        downloadingGuiUpdate: false,
        installingGuiUpdate: false,
        guiUpdateDownloaded: false,
        guiUpdateProgress: null,
        guiUpdateError: null,
        checkGuiUpdate: vi.fn(),
        downloadGuiUpdate: vi.fn(),
        installGuiUpdate: vi.fn(),
        logPath: '/tmp/sciforge.log',
        logDirOpenError: null,
        setLogDirOpenError: vi.fn()
      }
    }))

    expect(html.match(/type="password"/g)).toHaveLength(4)
    expect(html).not.toContain('type="text" autoComplete="off" placeholder="sk-..."')
  })
})
