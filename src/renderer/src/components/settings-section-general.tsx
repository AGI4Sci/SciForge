import { useState, type ReactElement } from 'react'
import type {
  ApprovalPolicy,
  AppSettingsV1,
  ModelRouterMemberProviderSettingsPatchV1,
  ModelRouterScientificTranslatorSettingsPatchV1,
  SandboxMode
} from '@shared/app-settings'
import {
  getModelRouterSettings
} from '@shared/app-settings'
import type { GuiUpdateChannel } from '@shared/gui-update'
import type { SkillRootId } from '../lib/skill-root-preference'
import { FolderOpen, PencilLine, RefreshCw, Settings } from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import {
  InlineNoticeView,
  SecretInput,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'

function ModelRouterRoleFields({
  t,
  baseUrl,
  apiKey,
  model,
  baseUrlPlaceholder,
  modelPlaceholder,
  secretVisible,
  onToggleSecret,
  onChange
}: {
  t: (key: string) => string
  baseUrl: string
  apiKey: string
  model: string
  baseUrlPlaceholder: string
  modelPlaceholder: string
  secretVisible: boolean
  onToggleSecret: () => void
  onChange: (patch: { baseUrl?: string; apiKey?: string; model?: string }) => void
}): ReactElement {
  const labelClass = 'text-[12px] font-medium text-ds-muted'
  const inputClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
  return (
    <div className="grid gap-3 md:max-w-md">
      <label className="grid gap-1">
        <span className={labelClass}>{t('modelRouterRoleBaseUrl')}</span>
        <input
          className={inputClass}
          placeholder={baseUrlPlaceholder}
          value={baseUrl}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
      </label>
      <label className="grid gap-1">
        <span className={labelClass}>{t('modelRouterRoleApiKey')}</span>
        <SecretInput
          value={apiKey}
          onChange={(value) => onChange({ apiKey: value })}
          visible={secretVisible}
          onToggleVisibility={onToggleSecret}
          placeholder="sk-..."
          autoComplete="off"
          showLabel={t('showSecret')}
          hideLabel={t('hideSecret')}
        />
      </label>
      <label className="grid gap-1">
        <span className={labelClass}>{t('modelRouterRoleModel')}</span>
        <input
          className={`${inputClass} font-mono`}
          placeholder={modelPlaceholder}
          value={model}
          spellCheck={false}
          onChange={(event) => onChange({ model: event.target.value })}
        />
      </label>
    </div>
  )
}

type ModelRouterSecretId = 'textReasoner' | 'visionTranslator' | 'imageGenerator' | 'scientificTranslator'

export function GeneralSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    update,
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
  const modelRouterSettings = getModelRouterSettings(form)
  const defaultModelRouterProfile = modelRouterSettings.profiles.default
  const updateTextReasoner = (patch: ModelRouterMemberProviderSettingsPatchV1): void => {
    update({ modelRouter: { profiles: { default: { textReasoner: patch } } } })
  }
  const updateImageGenerator = (patch: ModelRouterMemberProviderSettingsPatchV1): void => {
    update({ modelRouter: { profiles: { default: { imageGenerator: patch } } } })
  }
  const updateVisionTranslator = (patch: ModelRouterMemberProviderSettingsPatchV1): void => {
    update({ modelRouter: { profiles: { default: { translators: { vision: patch } } } } })
  }
  const updateScientificTranslator = (patch: ModelRouterScientificTranslatorSettingsPatchV1): void => {
    update({ modelRouter: { profiles: { default: { translators: { scientific: patch } } } } })
  }
  const [modelRouterSecretVisibility, setModelRouterSecretVisibility] =
    useState<Record<ModelRouterSecretId, boolean>>({
      textReasoner: false,
      visionTranslator: false,
      imageGenerator: false,
      scientificTranslator: false
    })
  const toggleModelRouterSecret = (secretId: ModelRouterSecretId): void => {
    setModelRouterSecretVisibility((current) => ({
      ...current,
      [secretId]: !current[secretId]
    }))
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
              <SettingsCard title={t('modelRouterModels')}>
                <SettingRow
                  title={t('modelRouterTextReasoner')}
                  description={t('modelRouterTextReasonerDesc')}
                  control={
                    <ModelRouterRoleFields
                      t={t}
                      baseUrl={defaultModelRouterProfile.textReasoner.baseUrl}
                      apiKey={defaultModelRouterProfile.textReasoner.apiKey}
                      model={defaultModelRouterProfile.textReasoner.model}
                      baseUrlPlaceholder={t('modelRouterTextReasonerBaseUrlPlaceholder')}
                      modelPlaceholder={t('modelRouterTextReasonerModelPlaceholder')}
                      secretVisible={modelRouterSecretVisibility.textReasoner}
                      onToggleSecret={() => toggleModelRouterSecret('textReasoner')}
                      onChange={updateTextReasoner}
                    />
                  }
                />
                <SettingRow
                  title={t('modelRouterVisionTranslator')}
                  description={t('modelRouterVisionTranslatorDesc')}
                  control={
                    <ModelRouterRoleFields
                      t={t}
                      baseUrl={defaultModelRouterProfile.translators.vision.baseUrl}
                      apiKey={defaultModelRouterProfile.translators.vision.apiKey}
                      model={defaultModelRouterProfile.translators.vision.model}
                      baseUrlPlaceholder={t('modelRouterVisionTranslatorBaseUrlPlaceholder')}
                      modelPlaceholder={t('modelRouterVisionTranslatorModelPlaceholder')}
                      secretVisible={modelRouterSecretVisibility.visionTranslator}
                      onToggleSecret={() => toggleModelRouterSecret('visionTranslator')}
                      onChange={updateVisionTranslator}
                    />
                  }
                />
                <SettingRow
                  title={t('modelRouterImageGenerator')}
                  description={t('modelRouterImageGeneratorDesc')}
                  control={
                    <ModelRouterRoleFields
                      t={t}
                      baseUrl={defaultModelRouterProfile.imageGenerator.baseUrl}
                      apiKey={defaultModelRouterProfile.imageGenerator.apiKey}
                      model={defaultModelRouterProfile.imageGenerator.model}
                      baseUrlPlaceholder={t('modelRouterImageGeneratorBaseUrlPlaceholder')}
                      modelPlaceholder={t('modelRouterImageGeneratorModelPlaceholder')}
                      secretVisible={modelRouterSecretVisibility.imageGenerator}
                      onToggleSecret={() => toggleModelRouterSecret('imageGenerator')}
                      onChange={updateImageGenerator}
                    />
                  }
                />
                <SettingRow
                  title={t('modelRouterScientificTranslator')}
                  description={t('modelRouterScientificTranslatorDesc')}
                  control={
                    <ModelRouterRoleFields
                      t={t}
                      baseUrl={defaultModelRouterProfile.translators.scientific.baseUrl}
                      apiKey={defaultModelRouterProfile.translators.scientific.apiKey}
                      model={defaultModelRouterProfile.translators.scientific.model}
                      baseUrlPlaceholder={t('modelRouterScientificTranslatorBaseUrlPlaceholder')}
                      modelPlaceholder={t('modelRouterScientificTranslatorModelPlaceholder')}
                      secretVisible={modelRouterSecretVisibility.scientificTranslator}
                      onToggleSecret={() => toggleModelRouterSecret('scientificTranslator')}
                      onChange={updateScientificTranslator}
                    />
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
              </SettingsCard>
              <SettingsCard title={t('sectionGeneral')}>
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
