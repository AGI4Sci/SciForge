import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  normalizeGuiUpdateChannel,
  type AppBehaviorConfigV1,
  type AgentCapabilitySettingsPatchV1,
  type AppSettingsV1,
  type ConnectPhoneSettingsPatchV1,
  type ComputerUseSettingsPatchV1,
  type RemoteChannelSettingsPatchV1,
  type RemoteExecutorSettingsPatchV1,
  type GuiUpdateConfigV1,
  type ImageGenerationSettingsPatchV1,
  type NotificationConfigV1,
  type ScheduleSettingsPatchV1,
  type SpeechToTextSettingsPatchV1,
  type WorkflowSettingsPatchV1,
  type WriteSettingsPatchV1
} from './app-settings-types'
import { normalizeKeyboardShortcuts, type KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import {
  defaultLocalRuntimeSettings,
  getLocalRuntimeSettings,
  agentRuntimeSettingsEnvelope,
  mergeLocalRuntimeSettings,
  normalizeRuntimeGuardSettings
} from './app-settings-local-runtime'
import {
  defaultCodexRuntimeSettings,
  getCodexRuntimeSettings,
  mergeCodexRuntimeSettings,
  normalizeAgentRuntimeId
} from './app-settings-codex'
import {
  defaultClaudeRuntimeSettings,
  getClaudeRuntimeSettings,
  mergeClaudeRuntimeSettings
} from './app-settings-claude'
import { normalizeModelProviderSettings } from './app-settings-provider'
import { normalizeModelRouterSettings } from './app-settings-model-router'
import { normalizeInstallationId } from './app-settings-normalizers'
import { normalizeConnectPhoneSettings, normalizeRemoteChannelSettings } from './app-settings-remote-channel'
import { normalizeScheduleSettings } from './app-settings-schedule'
import { normalizeWorkflowSettings } from './app-settings-workflow'
import { normalizeRemoteExecutorSettings } from './app-settings-remote-executor'
import { normalizeWriteSettings } from './app-settings-write'
import { normalizeSpeechToTextSettings } from './speech-to-text'
import { normalizeComputerUseSettings } from './app-settings-computer-use'
import { normalizeAgentCapabilitySettings } from './app-settings-agent-capabilities'
import { normalizeImageGenerationSettings } from './app-settings-image-generation'

export function normalizeAppSettings(settings: AppSettingsV1): AppSettingsV1 {
  const maybeSettings = settings as AppSettingsV1 & {
    appBehavior?: Partial<AppBehaviorConfigV1>
    keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
    notifications?: Partial<NotificationConfigV1>
    provider?: Parameters<typeof normalizeModelProviderSettings>[0]
    modelRouter?: Parameters<typeof normalizeModelRouterSettings>[0]
    write?: WriteSettingsPatchV1
    remoteChannel?: RemoteChannelSettingsPatchV1
    connectPhone?: ConnectPhoneSettingsPatchV1
    schedule?: ScheduleSettingsPatchV1
    workflow?: WorkflowSettingsPatchV1
    remoteExecutor?: RemoteExecutorSettingsPatchV1
    speechToText?: SpeechToTextSettingsPatchV1
    guiUpdate?: Partial<GuiUpdateConfigV1>
    runtimeGuards?: Parameters<typeof normalizeRuntimeGuardSettings>[0]
    agentCapabilities?: AgentCapabilitySettingsPatchV1
    imageGeneration?: ImageGenerationSettingsPatchV1
    computerUse?: ComputerUseSettingsPatchV1
  }
  const runtime = getLocalRuntimeSettings(maybeSettings)
  const codexRuntime = getCodexRuntimeSettings(maybeSettings)
  const claudeRuntime = getClaudeRuntimeSettings(maybeSettings)
  return {
    version: 1,
    installationId: normalizeInstallationId(maybeSettings.installationId),
    locale: maybeSettings.locale === 'zh' ? 'zh' : 'en',
    theme:
      maybeSettings.theme === 'light' || maybeSettings.theme === 'dark' || maybeSettings.theme === 'system'
        ? maybeSettings.theme
        : 'system',
    uiFontScale:
      maybeSettings.uiFontScale === 'small' ||
      maybeSettings.uiFontScale === 'medium' ||
      maybeSettings.uiFontScale === 'large'
        ? maybeSettings.uiFontScale
        : 'small',
    provider: normalizeModelProviderSettings(maybeSettings.provider),
    modelRouter: normalizeModelRouterSettings(maybeSettings.modelRouter),
    runtimeGuards: normalizeRuntimeGuardSettings(maybeSettings.runtimeGuards),
    agentCapabilities: normalizeAgentCapabilitySettings(maybeSettings.agentCapabilities),
    imageGeneration: normalizeImageGenerationSettings(maybeSettings.imageGeneration),
    computerUse: normalizeComputerUseSettings(maybeSettings.computerUse),
    activeAgentRuntime: normalizeAgentRuntimeId(maybeSettings.activeAgentRuntime),
    agents: {
      ...agentRuntimeSettingsEnvelope(mergeLocalRuntimeSettings(defaultLocalRuntimeSettings(), runtime)),
      codex: mergeCodexRuntimeSettings(defaultCodexRuntimeSettings(), codexRuntime),
      claude: mergeClaudeRuntimeSettings(defaultClaudeRuntimeSettings(), claudeRuntime)
    },
    workspaceRoot: typeof maybeSettings.workspaceRoot === 'string' ? maybeSettings.workspaceRoot : '',
    log: {
      enabled: maybeSettings.log?.enabled !== false,
      retentionDays: typeof maybeSettings.log?.retentionDays === 'number' ? maybeSettings.log.retentionDays : 2
    },
    notifications: {
      turnComplete: maybeSettings.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(maybeSettings.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(maybeSettings.keyboardShortcuts),
    write: normalizeWriteSettings(maybeSettings.write),
    speechToText: normalizeSpeechToTextSettings(maybeSettings.speechToText),
    remoteChannel: normalizeRemoteChannelSettings(maybeSettings.remoteChannel),
    connectPhone: normalizeConnectPhoneSettings(maybeSettings.connectPhone),
    schedule: normalizeScheduleSettings(maybeSettings.schedule),
    workflow: normalizeWorkflowSettings(maybeSettings.workflow),
    remoteExecutor: normalizeRemoteExecutorSettings(maybeSettings.remoteExecutor),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(
        maybeSettings.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL
      )
    },
    codePromptPrefix: typeof maybeSettings.codePromptPrefix === 'string' ? maybeSettings.codePromptPrefix : ''
  }
}

export function normalizeAppBehaviorSettings(
  settings?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const openAtLogin = settings?.openAtLogin === true
  return {
    openAtLogin,
    startMinimized: openAtLogin && settings?.startMinimized === true,
    closeToTray: settings?.closeToTray === true
  }
}
