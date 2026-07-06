import { useEffect, useState, type ReactElement } from 'react'
import type {
  ApprovalPolicy,
  AppSettingsV1,
  SandboxMode
} from '@shared/app-settings'
import {
  defaultImageGenerationSettings,
  getModelProviderSettings,
  getModelRouterSettings
} from '@shared/app-settings'
import type { GuiUpdateChannel } from '@shared/gui-update'
import type { SkillRootId } from '../lib/skill-root-preference'
import { FolderOpen, PencilLine, RefreshCw, RotateCcw, Save, Settings } from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import {
  InlineNoticeView,
  SecretInput,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'

export function GeneralSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    update,
    updateImageGeneration,
    saveBasicsModelConfig,
    showApiKey,
    setShowApiKey,
    showImageGenerationApiKey,
    setShowImageGenerationApiKey,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    splitSettingsList,
    listSettingsText
  } = ctx
  const platform = typeof window !== 'undefined' ? window.sciforge?.platform ?? '' : ''
  const openAtLoginSupported = platform === 'win32' || platform === 'darwin'
  const startMinimizedSupported = platform === 'win32'
  const desktopBehavior = form.appBehavior
  const imageGenerationSettings = form.imageGeneration ?? defaultImageGenerationSettings()
  const modelRouterSettings = getModelRouterSettings(form)
  const modelProviderSettings = getModelProviderSettings(form)
  const defaultModelName = modelRouterSettings.profiles.default.textReasoner.model
  const savedApiKey = modelProviderSettings.apiKey
  const savedBaseUrl = modelProviderSettings.baseUrl
  const [draftApiKey, setDraftApiKey] = useState(savedApiKey)
  const [draftBaseUrl, setDraftBaseUrl] = useState(savedBaseUrl)
  const [draftDefaultModelName, setDraftDefaultModelName] = useState(defaultModelName)
  const [modelConfigSaving, setModelConfigSaving] = useState(false)
  const [modelConfigNotice, setModelConfigNotice] =
    useState<{ tone: 'error' | 'info' | 'success'; message: string } | null>(null)
  const updateImageGenerationSettings =
    typeof updateImageGeneration === 'function'
      ? updateImageGeneration
      : (patch: Partial<NonNullable<AppSettingsV1['imageGeneration']>>) => update({ imageGeneration: patch })

  useEffect(() => {
    setDraftApiKey(savedApiKey)
    setDraftBaseUrl(savedBaseUrl)
    setDraftDefaultModelName(defaultModelName)
  }, [savedApiKey, savedBaseUrl, defaultModelName])

  const modelConfigChanged =
    draftApiKey !== savedApiKey ||
    draftBaseUrl !== savedBaseUrl ||
    draftDefaultModelName !== defaultModelName
  const saveModelConfigDraft = async (): Promise<void> => {
    const apiKey = draftApiKey.trim()
    const baseUrl = draftBaseUrl.trim()
    const model = draftDefaultModelName.trim()
    if (!apiKey) {
      setModelConfigNotice({
        tone: 'error',
        message: t('modelConfigApiKeyRequired')
      })
      return
    }
    if (!model) {
      setModelConfigNotice({
        tone: 'error',
        message: t('modelConfigModelNameRequired')
      })
      return
    }
    if (typeof saveBasicsModelConfig !== 'function') {
      setModelConfigNotice({
        tone: 'error',
        message: t('modelConfigSaveUnavailable')
      })
      return
    }
    setModelConfigSaving(true)
    setModelConfigNotice(null)
    try {
      const next = await saveBasicsModelConfig({ apiKey, baseUrl, model })
      const nextProvider = getModelProviderSettings(next)
      const nextModel = getModelRouterSettings(next).profiles.default.textReasoner.model
      setDraftApiKey(nextProvider.apiKey)
      setDraftBaseUrl(nextProvider.baseUrl)
      setDraftDefaultModelName(nextModel)
      setModelConfigNotice({
        tone: 'success',
        message: t('modelConfigSaved')
      })
    } catch (error) {
      setModelConfigNotice({
        tone: 'error',
        message: t('modelConfigSaveError', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setModelConfigSaving(false)
    }
  }

  const resetModelConfigDraft = (): void => {
    setDraftApiKey(savedApiKey)
    setDraftBaseUrl(savedBaseUrl)
    setDraftDefaultModelName(defaultModelName)
    setModelConfigNotice(null)
  }
  const [modelRouterConfigNotice, setModelRouterConfigNotice] =
    useState<{ tone: 'error' | 'info' | 'success'; message: string } | null>(null)
  const openModelRouterConfigFile = async (): Promise<void> => {
    const api = window.sciforge as typeof window.sciforge & {
      openModelRouterConfigFile?: () => Promise<{ ok: boolean; message?: string }>
    }
    if (typeof api?.openModelRouterConfigFile !== 'function') {
      setModelRouterConfigNotice({
        tone: 'error',
        message: t('modelRouterOpenConfigFileUnavailable')
      })
      return
    }
    setModelRouterConfigNotice(null)
    try {
      const result = await api.openModelRouterConfigFile()
      if (!result.ok) {
        setModelRouterConfigNotice({
          tone: 'error',
          message: t('modelRouterOpenConfigFileError', {
            message: result.message || tCommon('unknownError')
          })
        })
      }
    } catch (error) {
      setModelRouterConfigNotice({
        tone: 'error',
        message: t('modelRouterOpenConfigFileError', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  return (
            <>
              <SettingsCard
                title={t('sectionGeneral')}
                action={
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveModelConfigDraft()}
                      disabled={!modelConfigChanged || modelConfigSaving}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-[13px] font-medium text-accent shadow-sm transition hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      {modelConfigSaving ? t('modelConfigSaving') : t('modelConfigSave')}
                    </button>
                    <button
                      type="button"
                      onClick={resetModelConfigDraft}
                      disabled={!modelConfigChanged || modelConfigSaving}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t('modelConfigReset')}
                    </button>
                  </div>
                }
              >
                <SettingRow
                  title={t('apiKey')}
                  description={t('apiKeySharedDesc')}
                  control={
                    <SecretInput
                      value={draftApiKey}
                      onChange={(value) => {
                        setDraftApiKey(value)
                        setModelConfigNotice(null)
                      }}
                      visible={showApiKey}
                      onToggleVisibility={() => setShowApiKey((value: boolean) => !value)}
                      placeholder="sk-..."
                      autoComplete="off"
                      invalid={!draftApiKey.trim()}
                      showLabel={t('showSecret')}
                      hideLabel={t('hideSecret')}
                      className="md:max-w-md"
                    />
                  }
                />
                <SettingRow
                  title={t('baseUrl')}
                  description={t('baseUrlSharedDesc')}
                  control={
                    <input
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                      placeholder={t('baseUrlPlaceholder')}
                      value={draftBaseUrl}
                      onChange={(e) => {
                        setDraftBaseUrl(e.target.value)
                        setModelConfigNotice(null)
                      }}
                    />
                  }
                />
                <SettingRow
                  title={t('defaultModelName')}
                  description={t('defaultModelNameDesc')}
                  control={
                    <div className="grid gap-2 md:max-w-md">
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        placeholder={t('defaultModelNamePlaceholder')}
                        value={draftDefaultModelName}
                        spellCheck={false}
                        onChange={(e) => {
                          setDraftDefaultModelName(e.target.value)
                          setModelConfigNotice(null)
                        }}
                      />
                      {modelConfigNotice ? <InlineNoticeView notice={modelConfigNotice} /> : null}
                    </div>
                  }
                />
                <SettingRow
                  title={t('modelRouterConfigFile')}
                  description={t('modelRouterConfigFileDesc')}
                  control={
                    <div className="grid gap-2">
                      <button
                        type="button"
                        onClick={() => void openModelRouterConfigFile()}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                      >
                        <FolderOpen className="h-4 w-4" />
                        {t('modelRouterOpenConfigFile')}
                      </button>
                      {modelRouterConfigNotice ? <InlineNoticeView notice={modelRouterConfigNotice} /> : null}
                    </div>
                  }
                />
                <SettingRow
                  title={t('imageGenerationEnabled')}
                  description={t('imageGenerationEnabledDesc')}
                  control={
                    <Toggle
                      checked={imageGenerationSettings.enabled}
                      onChange={(enabled) => updateImageGenerationSettings({ enabled })}
                    />
                  }
                />
                <SettingRow
                  title={t('imageGenerationApiKey')}
                  description={t('imageGenerationApiKeyDesc')}
                  control={
                    <SecretInput
                      value={imageGenerationSettings.apiKey}
                      onChange={(apiKey) => updateImageGenerationSettings({ apiKey })}
                      visible={showImageGenerationApiKey}
                      onToggleVisibility={() => setShowImageGenerationApiKey((value: boolean) => !value)}
                      placeholder="sk-..."
                      autoComplete="off"
                      showLabel={t('showSecret')}
                      hideLabel={t('hideSecret')}
                      className="md:max-w-md"
                    />
                  }
                />
                <SettingRow
                  title={t('imageGenerationBaseUrl')}
                  description={t('imageGenerationBaseUrlDesc')}
                  control={
                    <input
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                      placeholder={t('imageGenerationBaseUrlPlaceholder')}
                      value={imageGenerationSettings.baseUrl}
                      onChange={(e) => updateImageGenerationSettings({ baseUrl: e.target.value })}
                    />
                  }
                />
                <SettingRow
                  title={t('imageGenerationModel')}
                  description={t('imageGenerationModelDesc')}
                  control={
                    <input
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                      placeholder={t('imageGenerationModelPlaceholder')}
                      value={imageGenerationSettings.model}
                      onChange={(e) => updateImageGenerationSettings({ model: e.target.value })}
                    />
                  }
                />
                <SettingRow
                  title={t('language')}
                  description={t('languageDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.locale}
                      onChange={(e) => update({ locale: e.target.value as 'en' | 'zh' })}
                    >
                      <option value="en">English</option>
                      <option value="zh">简体中文</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('theme')}
                  description={t('themeDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.theme}
                      onChange={(e) => update({ theme: e.target.value as AppSettingsV1['theme'] })}
                    >
                      <option value="system">{t('themeSystem')}</option>
                      <option value="light">{t('themeLight')}</option>
                      <option value="dark">{t('themeDark')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('onboardingPreview')}
                  description={t('onboardingPreviewDesc')}
                  control={
                    <button
                      type="button"
                      onClick={openOnboardingPreview}
                      className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    >
                      {t('onboardingPreviewOpen')}
                    </button>
                  }
                />
                <SettingRow
                  title={t('fontScale')}
                  description={t('fontScaleDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.uiFontScale}
                      onChange={(e) =>
                        update({
                          uiFontScale: e.target.value as AppSettingsV1['uiFontScale']
                        })
                      }
                    >
                      <option value="small">{t('fontScaleSmall')}</option>
                      <option value="medium">{t('fontScaleMedium')}</option>
                      <option value="large">{t('fontScaleLarge')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('turnCompleteNotification')}
                  description={t('turnCompleteNotificationDesc')}
                  control={
                    <Toggle
                      checked={form.notifications.turnComplete}
                      onChange={(v) => update({ notifications: { turnComplete: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('workspaceRoot')}
                  description={t('workspaceRootDesc')}
                  control={
                    <div className="w-full min-w-[200px] md:max-w-xl">
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={form.workspaceRoot}
                          onChange={(e) => update({ workspaceRoot: e.target.value })}
                          placeholder={t('workspaceRootPlaceholder')}
                        />
                        <button
                          type="button"
                          onClick={resetWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('restoreWorkspaceDefault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {workspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {workspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('desktopBehavior')} className="mt-6">
                <SettingRow
                  title={t('desktopOpenAtLogin')}
                  description={
                    openAtLoginSupported
                      ? t('desktopOpenAtLoginDesc')
                      : t('desktopOpenAtLoginUnsupportedDesc')
                  }
                  control={
                    <Toggle
                      checked={desktopBehavior.openAtLogin}
                      disabled={!openAtLoginSupported}
                      onChange={(v) =>
                        update({
                          appBehavior: {
                            openAtLogin: v,
                            startMinimized: v ? desktopBehavior.startMinimized : false
                          }
                        })
                      }
                    />
                  }
                />
                <SettingRow
                  title={t('desktopStartMinimized')}
                  description={
                    desktopBehavior.openAtLogin && startMinimizedSupported
                      ? t('desktopStartMinimizedDesc')
                      : t('desktopStartMinimizedDisabledDesc')
                  }
                  control={
                    <Toggle
                      checked={desktopBehavior.startMinimized}
                      disabled={!desktopBehavior.openAtLogin || !startMinimizedSupported}
                      onChange={(v) => update({ appBehavior: { startMinimized: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('desktopCloseToTray')}
                  description={t('desktopCloseToTrayDesc')}
                  control={
                    <Toggle
                      checked={desktopBehavior.closeToTray}
                      onChange={(v) => update({ appBehavior: { closeToTray: v } })}
                    />
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('guiUpdate')} className="mt-6">
                <SettingRow
                  title={t('guiUpdateChannel')}
                  description={t('guiUpdateChannelDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.guiUpdate.channel}
                      onChange={(e) =>
                        update({
                          guiUpdate: { channel: e.target.value as GuiUpdateChannel }
                        })
                      }
                    >
                      <option value="frontier">{t('guiUpdateChannelFrontier')}</option>
                      <option value="stable">{t('guiUpdateChannelStable')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('guiUpdate')}
                  description={t('guiUpdateDesc')}
                  control={
                    <GuiUpdateControl
                      info={guiUpdateInfo}
                      checking={checkingGuiUpdate}
                      downloading={downloadingGuiUpdate}
                      installing={installingGuiUpdate}
                      downloaded={guiUpdateDownloaded}
                      progress={guiUpdateProgress}
                      error={guiUpdateError}
                      onCheck={checkGuiUpdate}
                      onDownload={downloadGuiUpdate}
                      onInstall={installGuiUpdate}
                      t={t}
                    />
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('logTitle')} className="mt-6">
                <SettingRow
                  title={t('logEnabled')}
                  description={t('logEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.log.enabled}
                      onChange={(v) => update({ log: { enabled: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('logRetention')}
                  description={t('logRetentionDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.log.retentionDays}
                      onChange={(e) =>
                        update({ log: { retentionDays: Number(e.target.value) } })
                      }
                    >
                      <option value={1}>{t('logRetentionOne')}</option>
                      <option value={2}>{t('logRetentionTwo')}</option>
                      <option value={3}>{t('logRetentionThree')}</option>
                      <option value={5}>{t('logRetentionFive')}</option>
                      <option value={7}>{t('logRetentionSeven')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('logDir')}
                  description={t('logDirDesc')}
                  wideControl
                  control={
                    <div className="flex w-full min-w-0 flex-col items-start gap-2">
                      {logPath ? (
                        <code className="block w-full max-w-full break-all rounded-xl bg-ds-main/70 px-3 py-2 font-mono text-[12px] text-ds-muted shadow-sm">
                          {logPath}
                        </code>
                      ) : (
                        <span className="text-[13px] text-ds-faint">…</span>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-50"
                        disabled={typeof window.sciforge?.openLogDir !== 'function'}
                        onClick={async () => {
                          if (typeof window.sciforge?.openLogDir !== 'function') return
                          setLogDirOpenError(null)
                          try {
                            const result = await window.sciforge.openLogDir()
                            if (!result.ok) setLogDirOpenError(result.message ?? 'Unknown error')
                          } catch (e) {
                            setLogDirOpenError(e instanceof Error ? e.message : String(e))
                          }
                        }}
                      >
                        <FolderOpen className="h-4 w-4" />
                        {t('logDirOpen')}
                      </button>
                      {logDirOpenError ? (
                        <p className="text-[12px] text-red-700 dark:text-red-300">
                          {logDirOpenError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </SettingsCard>
            </>
  )
}
