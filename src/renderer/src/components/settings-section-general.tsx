import type { ReactElement } from 'react'
import type {
  AppSettingsV1
} from '@shared/app-settings'
import {
  getImageGenerationSettings,
  getModelAccessSettings,
  getModelRouterSettings,
  type ImageGenerationSettingsPatchV1
} from '@shared/app-settings'
import type { GuiUpdateChannel } from '@shared/gui-update'
import { FolderOpen } from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import {
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
import { GenericApiMemberFields, ModelAccessSettings } from './model-access-settings'

export function GeneralSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    update,
    saveStatus,
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
    setLogDirOpenError
  } = ctx
  const platform = typeof window !== 'undefined' ? window.sciforge?.platform ?? '' : ''
  const openAtLoginSupported = platform === 'win32' || platform === 'darwin'
  const startMinimizedSupported = platform === 'win32'
  const desktopBehavior = form.appBehavior
  const modelAccess = getModelAccessSettings(form)
  const modelRouterSettings = getModelRouterSettings(form)
  const modelCapabilities = modelRouterSettings.profiles.default
  const imageGenerationSettings = getImageGenerationSettings(form)
  const updateImageGenerationSettings = (patch: ImageGenerationSettingsPatchV1): void => {
    update({ imageGeneration: patch })
  }

  return (
            <>
              <SettingsCard title={t('modelAccessTitle')}>
                <SettingRow
                  title={t('modelAccessMode')}
                  description={t('modelAccessModeDesc')}
                  wideControl
                  control={
                    <ModelAccessSettings
                      form={form}
                      update={update}
                      t={t}
                      serviceProbeEnabled={saveStatus === 'idle' || saveStatus === 'saved'}
                    />
                  }
                />
              </SettingsCard>
              {modelAccess?.mode === 'api' ? <details className="mt-6 overflow-hidden rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm shadow-black/5 dark:shadow-black/25">
                <summary className="cursor-pointer px-5 py-3 text-[14px] font-semibold text-ds-ink hover:bg-ds-hover">
                  {t('modelAccessAdvancedCapabilities')}
                  <span className="ml-2 text-[12px] font-normal text-ds-muted">
                    {t('modelAccessAdvancedCapabilitiesDesc')}
                  </span>
                </summary>
                <div className="divide-y divide-ds-border-muted border-t border-ds-border-muted px-2 py-1">
                  <SettingRow
                    title={t('modelRouterVisionTranslator')}
                    description={t('modelRouterVisionTranslatorDesc')}
                    wideControl
                    control={
                      <GenericApiMemberFields
                        member={modelCapabilities.translators.vision}
                        onChange={(patch) => update({
                          modelRouter: { profiles: { default: { translators: { vision: patch } } } }
                        })}
                        t={t}
                        testId="vision"
                        showProtocol
                        baseUrlPlaceholder={t('modelRouterVisionTranslatorBaseUrlPlaceholder')}
                        modelPlaceholder={t('modelRouterVisionTranslatorModelPlaceholder')}
                      />
                    }
                  />
                  <SettingRow
                    title={t('modelRouterImageGenerator')}
                    description={t('modelRouterImageGeneratorDesc')}
                    wideControl
                    control={
                      <GenericApiMemberFields
                        member={modelCapabilities.imageGenerator}
                        onChange={(patch) => update({
                          modelRouter: { profiles: { default: { imageGenerator: patch } } }
                        })}
                        t={t}
                        testId="image"
                        baseUrlPlaceholder={t('modelRouterImageGeneratorBaseUrlPlaceholder')}
                        modelPlaceholder={t('modelRouterImageGeneratorModelPlaceholder')}
                      />
                    }
                  />
                  <SettingRow
                    title={t('modelRouterScientificTranslator')}
                    description={t('modelRouterScientificTranslatorDesc')}
                    wideControl
                    control={
                      <GenericApiMemberFields
                        member={modelCapabilities.translators.scientific}
                        onChange={(patch) => update({
                          modelRouter: { profiles: { default: { translators: { scientific: patch } } } }
                        })}
                        t={t}
                        testId="scientific"
                        baseUrlPlaceholder={t('modelRouterScientificTranslatorBaseUrlPlaceholder')}
                        modelPlaceholder={t('modelRouterScientificTranslatorModelPlaceholder')}
                      />
                    }
                  />
                </div>
              </details> : null}
              <SettingsCard title={t('sectionGeneral')}>
                <SettingRow
                  title={t('imageGenerationComponentSegmentationRunner')}
                  description={t('imageGenerationComponentSegmentationRunnerDesc')}
                  control={
                    <input
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                      placeholder={t('imageGenerationComponentSegmentationRunnerPlaceholder')}
                      value={imageGenerationSettings.componentSegmentationRunnerPath}
                      onChange={(e) =>
                        updateImageGenerationSettings({ componentSegmentationRunnerPath: e.target.value })
                      }
                    />
                  }
                />
                <SettingRow
                  title={t('imageGenerationComponentSegmentationModel')}
                  description={t('imageGenerationComponentSegmentationModelDesc')}
                  control={
                    <input
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                      placeholder={t('imageGenerationComponentSegmentationModelPlaceholder')}
                      value={imageGenerationSettings.componentSegmentationModelPath}
                      onChange={(e) =>
                        updateImageGenerationSettings({ componentSegmentationModelPath: e.target.value })
                      }
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
