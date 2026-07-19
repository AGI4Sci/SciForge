import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  applyClaudeRuntimePatch,
  defaultCodexRuntimeSettings,
  defaultClaudeRuntimeSettings,
  defaultLocalRuntimeSettings,
  defaultRuntimeGuardSettings,
  defaultAgentCapabilitySettings,
  defaultComputerUseSettings,
  defaultImageGenerationSettings,
  applyCodexRuntimePatch,
  applyLocalRuntimePatch,
  getCodexRuntimeSettings,
  getClaudeRuntimeSettings,
  getLocalRuntimeSettings,
  agentRuntimeSettingsEnvelope,
  mergeCodexRuntimeSettings,
  mergeClaudeRuntimeSettings,
  mergeConnectPhoneSettings,
  mergeLocalRuntimeSettings,
  mergeRemoteChannelSettings,
  mergeModelAccessSettings,
  mergeModelRouterSettings,
  mergeComputerUseSettings,
  mergeAgentCapabilitySettings,
  mergeRuntimeGuardSettings,
  mergeScheduleSettings,
  mergeSpeechToTextSettings,
  mergeWorkflowSettings,
  mergeRemoteExecutorSettings,
  mergeWriteSettings,
  mergeImageGenerationSettings,
  normalizeAppBehaviorSettings,
  normalizeAgentRuntimeId,
  normalizeConnectPhoneSettings,
  normalizeRemoteChannelSettings,
  normalizeGuiUpdateChannel,
  normalizeKeyboardShortcuts,
  normalizeModelAccessSettings,
  normalizeModelRouterSettings,
  normalizeComputerUseSettings,
  normalizeAgentCapabilitySettings,
  normalizeScheduleSettings,
  normalizeSpeechToTextSettings,
  normalizeWorkflowSettings,
  normalizeRemoteExecutorSettings,
  normalizeWriteSettings,
  normalizeImageGenerationSettings,
  normalizeEvidenceDagSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '@shared/app-settings'
import type { GuiUpdateInfo } from '@shared/gui-update'

type RendererSettingsShape = AppSettingsPatch
type SettingsPatch = AppSettingsPatch

export const DEFAULT_WORKSPACE_ROOT = '~/.sciforge/default_workspace'

export function splitSettingsList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function listSettingsText(values: string[]): string {
  return values.join('\n')
}

export function hasValidPort(settings: AppSettingsV1): boolean {
  const port = getLocalRuntimeSettings(settings).port
  return Number.isFinite(port) && port >= 1 && port <= 65535
}

export function mergeSettings(current: AppSettingsV1, patch: SettingsPatch): AppSettingsV1 {
  const safeCurrent = coerceRendererSettings(current)
  const {
    agents: agentsPatch,
    modelAccess: modelAccessPatch,
    modelRouter: modelRouterPatch,
    agentCapabilities: agentCapabilitiesPatch,
    computerUse: computerUsePatch,
    runtimeGuards: runtimeGuardsPatch,
    imageGeneration: imageGenerationPatch,
    connectPhone: connectPhonePatch,
    remoteExecutor: remoteExecutorPatch,
    ...restPatch
  } = patch
  const restSettingsPatch = restPatch as Partial<Pick<
    AppSettingsV1,
    | 'version'
    | 'installationId'
    | 'locale'
    | 'theme'
    | 'uiFontScale'
    | 'activeAgentRuntime'
    | 'workspaceRoot'
    | 'codePromptPrefix'
  >>
  return {
    ...applyClaudeRuntimePatch(
      applyCodexRuntimePatch(applyLocalRuntimePatch(safeCurrent, agentsPatch?.sciforge), agentsPatch?.codex),
      agentsPatch?.claude
    ),
    ...restSettingsPatch,
    modelAccess: mergeModelAccessSettings(safeCurrent.modelAccess, modelAccessPatch),
    modelRouter: mergeModelRouterSettings(safeCurrent.modelRouter, modelRouterPatch),
    agentCapabilities: mergeAgentCapabilitySettings(safeCurrent.agentCapabilities, agentCapabilitiesPatch),
    computerUse: mergeComputerUseSettings(safeCurrent.computerUse, computerUsePatch),
    runtimeGuards: mergeRuntimeGuardSettings(safeCurrent.runtimeGuards, runtimeGuardsPatch),
    evidenceDag: normalizeEvidenceDagSettings({
      ...safeCurrent.evidenceDag,
      ...(patch.evidenceDag ?? {})
    }),
    imageGeneration: mergeImageGenerationSettings(safeCurrent.imageGeneration, imageGenerationPatch),
    log: {
      ...safeCurrent.log,
      ...(patch.log ?? {})
    },
    notifications: {
      ...safeCurrent.notifications,
      ...(patch.notifications ?? {})
    },
    appBehavior: normalizeAppBehaviorSettings({
      ...safeCurrent.appBehavior,
      ...(patch.appBehavior ?? {})
    }),
    keyboardShortcuts: normalizeKeyboardShortcuts({
      bindings: {
        ...safeCurrent.keyboardShortcuts.bindings,
        ...(patch.keyboardShortcuts?.bindings ?? {})
      }
    }),
    write: mergeWriteSettings(safeCurrent.write, patch.write),
    speechToText: mergeSpeechToTextSettings(safeCurrent.speechToText, patch.speechToText),
    remoteChannel: mergeRemoteChannelSettings(safeCurrent.remoteChannel, patch.remoteChannel),
    connectPhone: mergeConnectPhoneSettings(safeCurrent.connectPhone, connectPhonePatch),
    schedule: mergeScheduleSettings(safeCurrent.schedule, patch.schedule),
    workflow: mergeWorkflowSettings(safeCurrent.workflow, patch.workflow),
    remoteExecutor: mergeRemoteExecutorSettings(safeCurrent.remoteExecutor, remoteExecutorPatch),
    guiUpdate: {
      ...safeCurrent.guiUpdate,
      ...(patch.guiUpdate ?? {})
    }
  }
}

export function coerceRendererSettings(settings: AppSettingsV1): AppSettingsV1 {
  const raw = settings as RendererSettingsShape
  const theme =
    raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark'
      ? raw.theme
      : 'system'
  const uiFontScale =
    raw.uiFontScale === 'small' || raw.uiFontScale === 'medium' || raw.uiFontScale === 'large'
      ? raw.uiFontScale
      : 'medium'
  return {
    version: 1,
    installationId: typeof raw.installationId === 'string' ? raw.installationId : '',
    locale: raw.locale === 'zh' ? 'zh' : 'en',
    theme,
    uiFontScale,
    modelAccess: normalizeModelAccessSettings(raw.modelAccess),
    modelRouter: normalizeModelRouterSettings(raw.modelRouter),
    agentCapabilities: mergeAgentCapabilitySettings(
      defaultAgentCapabilitySettings(),
      normalizeAgentCapabilitySettings(raw.agentCapabilities)
    ),
    computerUse: mergeComputerUseSettings(defaultComputerUseSettings(), normalizeComputerUseSettings(raw.computerUse)),
    runtimeGuards: mergeRuntimeGuardSettings(defaultRuntimeGuardSettings(), raw.runtimeGuards),
    evidenceDag: normalizeEvidenceDagSettings(raw.evidenceDag),
    imageGeneration: mergeImageGenerationSettings(
      defaultImageGenerationSettings(),
      normalizeImageGenerationSettings(raw.imageGeneration)
    ),
    activeAgentRuntime: normalizeAgentRuntimeId(raw.activeAgentRuntime),
    agents: {
      ...agentRuntimeSettingsEnvelope(mergeLocalRuntimeSettings(defaultLocalRuntimeSettings(), getLocalRuntimeSettings(settings))),
      codex: mergeCodexRuntimeSettings(defaultCodexRuntimeSettings(), getCodexRuntimeSettings(settings)),
      claude: mergeClaudeRuntimeSettings(defaultClaudeRuntimeSettings(), getClaudeRuntimeSettings(settings))
    },
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : DEFAULT_WORKSPACE_ROOT,
    log: {
      enabled: raw.log?.enabled !== false,
      retentionDays: typeof raw.log?.retentionDays === 'number' ? raw.log.retentionDays : 2
    },
    notifications: {
      turnComplete: raw.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(raw.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(raw.keyboardShortcuts),
    write: normalizeWriteSettings(raw.write),
    speechToText: normalizeSpeechToTextSettings(raw.speechToText),
    remoteChannel: normalizeRemoteChannelSettings(raw.remoteChannel),
    connectPhone: normalizeConnectPhoneSettings(raw.connectPhone),
    schedule: normalizeScheduleSettings(raw.schedule),
    workflow: normalizeWorkflowSettings(raw.workflow),
    remoteExecutor: normalizeRemoteExecutorSettings(raw.remoteExecutor),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(raw.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL)
    },
    codePromptPrefix: typeof raw.codePromptPrefix === 'string' ? raw.codePromptPrefix : ''
  }
}

export function guiUpdateFailureMessage(
  info: Extract<GuiUpdateInfo, { ok: false }>,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  switch (info.code) {
    case 'not_configured':
      return t('guiUpdateErrNotConfigured')
    case 'unsupported':
      return t('guiUpdateErrUnsupported')
    case 'download_failed':
      return t('guiUpdateErrDownloadFailed', { message: info.message.trim() })
    case 'install_failed':
      return t('guiUpdateErrInstallFailed', { message: info.message.trim() })
    case 'github_repo_not_found':
      return t('guiUpdateErrRepoNotFound', { repo: info.repo?.trim() || 'owner/repo' })
    case 'github_forbidden':
      return t('guiUpdateErrForbidden')
    case 'github_rate_limited':
      return t('guiUpdateErrRateLimit')
    case 'no_stable_version':
      return t('guiUpdateErrNoStableVersion', { repo: info.repo?.trim() || '—' })
    default:
      return info.message.trim() || t('guiUpdateCheckFailed')
  }
}
