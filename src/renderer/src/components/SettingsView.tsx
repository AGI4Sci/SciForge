import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  codexSettingsPatch,
  claudeSettingsPatch,
  type AppSettingsPatch,
  type CodexRuntimeSettingsPatchV1,
  type ClaudeRuntimeSettingsPatchV1,
  getClaudeRuntimeSettings,
  getCodexRuntimeSettings,
  getModelAccessSettings,
  getModelRouterSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import {
  joinFsPath,
  loadPreferredSkillRootId,
  savePreferredSkillRootId,
  type SkillRootId
} from '../lib/skill-root-preference'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { useChatStore, type SettingsRouteSection } from '../store/chat-store'
import { SettingsSidebar } from './SettingsSidebar'
import { useSettingsGuiUpdate } from './use-settings-gui-update'
import {
  DEFAULT_WORKSPACE_ROOT,
  coerceRendererSettings,
  listSettingsText,
  mergeSettings,
  splitSettingsList
} from './settings-utils'
import {
  SETTINGS_CHANGED_EVENT,
  emitRendererSettingsChanged
} from '../lib/keyboard-shortcut-settings'
import type { InlineNotice } from './settings-controls'
import {
  AgentsSettingsSection,
  GeneralSettingsSection,
  KeyboardShortcutsSettingsSection,
  RemoteResourcesSettingsSection,
  SpeechToTextSettingsSection
} from './settings-sections'

type SettingsCategory =
  | 'general'
  | 'speechToText'
  | 'agents'
  | 'shortcuts'
  | 'remoteResources'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SettingsPatch = AppSettingsPatch
type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  available: boolean
}

export function SettingsView(): ReactElement {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const setRoute = useChatStore((s) => s.setRoute)
  const settingsReturnRoute = useChatStore((s) => s.settingsReturnRoute)
  const settingsSection = useChatStore((s) => s.settingsSection)
  const openCode = useChatStore((s) => s.openCode)
  const openSchedule = useChatStore((s) => s.openSchedule)
  const openInitialSetup = useChatStore((s) => s.openInitialSetup)
  const openPlugins = useChatStore((s) => s.openPlugins)
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)
  const [category, setCategory] = useState<SettingsCategory>('general')
  const [form, setForm] = useState<AppSettingsV1 | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workspacePickerError, setWorkspacePickerError] = useState<
    string | null
  >(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [logPath, setLogPath] = useState('')
  const [logDirOpenError, setLogDirOpenError] = useState<string | null>(null)
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() =>
    loadPreferredSkillRootId()
  )
  const [skillNotice, setSkillNotice] = useState<InlineNotice | null>(null)
  const initializedCategory = useRef(false)
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const draftVersion = useRef(0)
  const agentsSectionRef = useRef<HTMLDivElement | null>(null)
  const skillSectionRef = useRef<HTMLDivElement | null>(null)
  const permissionsSectionRef = useRef<HTMLDivElement | null>(null)
  const formTheme = form?.theme
  const formUiFontScale = form?.uiFontScale
  const formWorkspaceRoot = form?.workspaceRoot
  const formGuiUpdateChannel = form?.guiUpdate?.channel
  const {
    checkingGuiUpdate,
    checkGuiUpdate,
    downloadingGuiUpdate,
    downloadGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateError,
    guiUpdateInfo,
    guiUpdateProgress,
    installingGuiUpdate,
    installGuiUpdate,
    resetGuiUpdateState
  } = useSettingsGuiUpdate({
    category,
    channel: formGuiUpdateChannel,
    form,
    t
  })

  useEffect(() => {
    let cancelled = false
    if (typeof window.sciforge === 'undefined') {
      setLoadError('PRELOAD_BRIDGE')
      return
    }
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
      .then((s) => {
        if (!cancelled) setForm(coerceRendererSettings(s))
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onSettingsChanged = (event: Event): void => {
      const next = coerceRendererSettings(
        (event as CustomEvent<AppSettingsV1>).detail
      )
      setForm(next)
      void applyI18n(next.locale)
      void reloadUiSettings()
      void probeRuntime('background')
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () =>
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [applyI18n, probeRuntime, reloadUiSettings])

  useEffect(() => {
    if (!formTheme || !formUiFontScale) return
    applyTheme(formTheme)
    applyUiFontScale(formUiFontScale)
  }, [formTheme, formUiFontScale])

  useEffect(() => {
    if (typeof window.sciforge?.getLogPath !== 'function') return
    void window.sciforge
      .getLogPath()
      .then((p) => setLogPath(p))
      .catch(() => undefined)
  }, [category])

  useEffect(() => {
    if (!form || initializedCategory.current) return
    initializedCategory.current = true
    const access = getModelAccessSettings(form)
    const textReasoner =
      getModelRouterSettings(form).profiles.default.textReasoner
    const accessConfigured =
      access?.mode === 'coding-plan'
        ? Boolean(access.planAdapterId.trim())
        : access?.mode === 'api'
          ? Boolean(
              textReasoner.apiKey.trim() &&
              textReasoner.baseUrl.trim() &&
              textReasoner.model.trim()
            )
          : false
    if (!accessConfigured) {
      setCategory('general')
    }
  }, [form])

  useEffect(() => {
    if (settingsSection === 'general') {
      setCategory('general')
      return
    }
    if (settingsSection === 'speechToText') {
      setCategory('speechToText')
      return
    }
    if (settingsSection === 'shortcuts') {
      setCategory('shortcuts')
      return
    }
    if (settingsSection === 'remoteResources') {
      setCategory('remoteResources')
      return
    }
    setCategory('agents')
  }, [settingsSection])

  useEffect(() => {
    if (!form) return
    if (
      settingsSection === 'general' ||
      settingsSection === 'speechToText' ||
      settingsSection === 'remoteResources' ||
      settingsSection === 'shortcuts' ||
      category !== 'agents'
    ) {
      return
    }
    const refs: Record<
      Exclude<
        SettingsRouteSection,
        | 'general'
        | 'speechToText'
        | 'remoteResources'
        | 'shortcuts'
      >,
      HTMLDivElement | null
    > = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: agentsSectionRef.current
    }
    const target = refs[settingsSection]
    if (!target) return
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [category, form, settingsSection])

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
    }
  }, [])

  const skillRootOptions = useMemo<SkillRootOption[]>(() => {
    const workspaceRoot = normalizeWorkspaceRoot(formWorkspaceRoot)
    const hasWorkspace = !!workspaceRoot
    return [
      {
        id: 'workspace-agents',
        label: tCommon('pluginSkillRootWorkspaceAgents'),
        path: workspaceRoot ? joinFsPath(workspaceRoot, '.agents/skills') : '',
        available: hasWorkspace
      },
      {
        id: 'workspace-skills',
        label: tCommon('pluginSkillRootWorkspaceSkills'),
        path: workspaceRoot ? joinFsPath(workspaceRoot, 'skills') : '',
        available: hasWorkspace
      },
      {
        id: 'global-agents',
        label: tCommon('pluginSkillRootGlobalAgents'),
        path: '~/.agents/skills',
        available: true
      },
      {
        id: 'global-sciforge',
        label: tCommon('pluginSkillRootGlobalSciforge'),
        path: '~/.sciforge/skills',
        available: true
      }
    ]
  }, [formWorkspaceRoot, tCommon])

  const selectedSkillRoot =
    skillRootOptions.find(
      (option) => option.id === skillRootId && option.available
    ) ?? skillRootOptions.find((option) => option.available)

  useEffect(() => {
    const selectedOption = skillRootOptions.find(
      (option) => option.id === skillRootId && option.available
    )
    if (selectedOption) {
      savePreferredSkillRootId(skillRootId)
      return
    }
    const fallback = skillRootOptions.find((option) => option.available)
    if (fallback && fallback.id !== skillRootId) {
      setSkillRootId(fallback.id)
    }
  }, [skillRootId, skillRootOptions])

  const openSkillRoot = async (): Promise<void> => {
    if (!selectedSkillRoot?.path || !selectedSkillRoot.available) {
      setSkillNotice({ tone: 'error', message: t('skillsRootUnavailable') })
      return
    }
    if (typeof window.sciforge?.openSkillRoot !== 'function') return
    setSkillNotice(null)
    const result = await window.sciforge.openSkillRoot(selectedSkillRoot.path)
    if (!result.ok) {
      setSkillNotice({
        tone: 'error',
        message: result.message ?? t('applyFailed')
      })
    }
  }

  const scrollToAgentSection = (
    target: 'agents' | 'skill' | 'permissions'
  ): void => {
    const refs = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    refs[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const persistSettings = async (
    snapshot: AppSettingsV1,
    version: number
  ): Promise<void> => {
    setSaveStatus('saving')
    setSaveError(null)

    try {
      const next = coerceRendererSettings(
        await rendererRuntimeClient.setSettings(snapshot)
      )
      if (version !== draftVersion.current) return

      setForm(next)
      emitRendererSettingsChanged(next)
      await applyI18n(next.locale)
      void reloadUiSettings()
      void probeRuntime('background')
      if (version !== draftVersion.current) return

      setSaveStatus('saved')
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
      statusTimer.current = window.setTimeout(() => {
        if (version === draftVersion.current) setSaveStatus('idle')
        statusTimer.current = null
      }, 1500)
    } catch (e) {
      if (version !== draftVersion.current) return
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    }
  }

  const scheduleSave = (next: AppSettingsV1): void => {
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (statusTimer.current) window.clearTimeout(statusTimer.current)
    statusTimer.current = null
    setSaveError(null)

    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void persistSettings(next, version)
    }, 450)
  }

  const flushPendingSave = async (): Promise<void> => {
    if (!form) return
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (statusTimer.current) {
      window.clearTimeout(statusTimer.current)
      statusTimer.current = null
    }

    await persistSettings(form, version)
  }

  const goBack = (): void => {
    void (async () => {
      await flushPendingSave()
      await reloadUiSettings()
      if (settingsReturnRoute === 'schedule') {
        openSchedule()
        return
      }
      if (settingsReturnRoute === 'plugins') {
        setRoute('plugins')
        return
      }
      await openCode()
    })()
  }

  const openOnboardingPreview = (): void => {
    void (async () => {
      await flushPendingSave()
      openInitialSetup('preview')
    })()
  }

  if (loadError) {
    const msg =
      loadError === 'PRELOAD_BRIDGE'
        ? t('preloadBridgeError')
        : t('loadFailed', { message: loadError })
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-ds-main p-6 text-center">
        <p className="max-w-md text-sm text-red-700 dark:text-red-300">{msg}</p>
        <button
          type="button"
          className="rounded-xl bg-ds-userbubble px-4 py-2 text-sm font-medium text-ds-userbubbleFg"
          onClick={goBack}
        >
          {t('back')}
        </button>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="flex h-full items-center justify-center bg-ds-main text-ds-faint">
        {t('loading')}
      </div>
    )
  }

  const codex = getCodexRuntimeSettings(form)
  const claude = getClaudeRuntimeSettings(form)
  const modelAccess = getModelAccessSettings(form)
  const textReasoner =
    getModelRouterSettings(form).profiles.default.textReasoner
  const modelAccessConfigured =
    modelAccess?.mode === 'coding-plan'
      ? Boolean(modelAccess.planAdapterId.trim())
      : modelAccess?.mode === 'api'
        ? Boolean(
            textReasoner.apiKey.trim() &&
            textReasoner.baseUrl.trim() &&
            textReasoner.model.trim()
          )
        : false

  const update = (partial: SettingsPatch): void => {
    const next = mergeSettings(form, partial)
    setForm(next)
    if (partial.locale) void applyI18n(partial.locale)
    if (
      partial.guiUpdate?.channel &&
      partial.guiUpdate.channel !== form.guiUpdate.channel
    ) {
      resetGuiUpdateState()
    }
    scheduleSave(next)
  }

  const updateCodex = (patch: CodexRuntimeSettingsPatchV1): void => {
    update({ agents: codexSettingsPatch(patch) })
  }

  const updateClaude = (patch: ClaudeRuntimeSettingsPatchV1): void => {
    update({ agents: claudeSettingsPatch(patch) })
  }

  const pickWorkspace = async (): Promise<void> => {
    try {
      setWorkspacePickerError(null)
      if (typeof window.sciforge?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.sciforge.pickWorkspaceDirectory(
        form.workspaceRoot || undefined
      )
      if (!picked.canceled && picked.path) {
        update({ workspaceRoot: picked.path })
      }
    } catch (e) {
      setWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetWorkspaceToDefault = (): void => {
    setWorkspacePickerError(null)
    update({ workspaceRoot: DEFAULT_WORKSPACE_ROOT })
  }

  const selectControlClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

  const settingsSectionContext = {
    t,
    tCommon,
    form,
    codex,
    claude,
    update,
    saveStatus,
    updateCodex,
    updateClaude,
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
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    splitSettingsList,
    listSettingsText
  }

  return (
    <div className="ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main">
      <SettingsSidebar
        category={category}
        setCategory={setCategory}
        goBack={goBack}
        t={t}
      />

      <div className="ds-no-drag min-h-0 min-w-0 flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto max-w-3xl">
          {!modelAccessConfigured ? (
            <div className="mb-6 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-5 py-4 text-amber-950 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
              <div className="text-[15px] font-semibold">
                {t('modelAccessRequiredTitle')}
              </div>
              <p className="mt-1 text-[13px] leading-6 text-amber-900/90 dark:text-amber-100/90">
                {t('modelAccessRequiredBody')}
              </p>
            </div>
          ) : null}

          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ds-ink">
                {t('title')}
              </h1>
              <p className="mt-1 text-[14px] text-ds-muted">{t('subtitle')}</p>
            </div>
            <span
              title={
                saveStatus === 'error' && saveError ? saveError : undefined
              }
              className={`max-w-md shrink-0 rounded-full px-3 py-1 text-right text-[12px] font-medium leading-5 ${
                saveStatus === 'saved'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                  : saveStatus === 'error'
                    ? 'bg-red-500/15 text-red-700 dark:text-red-200'
                    : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {saveStatus === 'saving'
                ? t('applying')
                : saveStatus === 'saved'
                  ? t('applied')
                  : saveStatus === 'error'
                    ? saveError
                      ? t('applyFailedWithReason', { message: saveError })
                      : t('applyFailed')
                    : t('autoApplyHint')}
            </span>
          </div>

          {category === 'general' ? (
            <GeneralSettingsSection ctx={settingsSectionContext} />
          ) : null}
          {category === 'speechToText' ? (
            <SpeechToTextSettingsSection ctx={settingsSectionContext} />
          ) : null}
          {category === 'agents' ? (
            <AgentsSettingsSection ctx={settingsSectionContext} />
          ) : null}
          {category === 'shortcuts' ? (
            <KeyboardShortcutsSettingsSection ctx={settingsSectionContext} />
          ) : null}
          {category === 'remoteResources' ? (
            <RemoteResourcesSettingsSection ctx={settingsSectionContext} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
