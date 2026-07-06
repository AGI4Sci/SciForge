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
  apiKey: 'Provider member API key',
  apiKeySharedDesc: 'Required for the provider member that the local Model Router uses by default.',
  baseUrl: 'Provider member URL',
  baseUrlSharedDesc: 'Default provider member URL.',
  baseUrlPlaceholder: 'http://127.0.0.1:3892/v1',
  defaultModelName: 'Default model name',
  defaultModelNameDesc: 'Model ID written to profiles.default.textReasoner.model.',
  defaultModelNamePlaceholder: 'deepseek-v4-pro',
  modelConfigSave: 'Save config',
  modelConfigSaving: 'Saving config',
  modelConfigReset: 'Reset',
  modelConfigSaved: 'Model config saved.',
  modelConfigApiKeyRequired: 'Enter an API key before saving.',
  modelConfigModelNameRequired: 'Enter a model name before saving.',
  modelConfigSaveError: 'Could not save model config: {{message}}',
  modelConfigSaveUnavailable: 'Model config saver is unavailable.',
  defaultModelNameSave: 'Save',
  defaultModelNameSaving: 'Saving',
  defaultModelNameReset: 'Reset',
  defaultModelNameSaved: 'Default model name saved.',
  defaultModelNameRequired: 'Enter a model name before saving.',
  defaultModelNameSaveError: 'Could not save default model name: {{message}}',
  defaultModelNameSaveUnavailable: 'Default model name saver is unavailable.',
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
        activeApiKey: 'sk-test',
        update: vi.fn(),
        updateSharedCredential: vi.fn(),
        saveBasicsModelConfig: vi.fn(),
        sharedApiKey: 'sk-test',
        sharedBaseUrl: '',
        showApiKey: false,
        setShowApiKey: vi.fn(),
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

    expect(html).toContain('Model Router config file')
    expect(html).toContain('Open Model Router config file')
    expect(html).toContain('Default model name')
    expect(html).toContain('Save config')
    expect(html).toContain('Reset')
  })
})
