import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  codexSettingsPatch,
  claudeSettingsPatch,
  localRuntimeSettingsPatch,
  type AppSettingsPatch,
  type CodexRuntimeSettingsPatchV1,
  type ClaudeRuntimeSettingsPatchV1,
  getActiveAgentApiKey,
  getClaudeRuntimeSettings,
  getCodexRuntimeSettings,
  getImageGenerationSettings,
  getLocalRuntimeSettings,
  getModelProviderSettings,
  isLocalRuntimeInsecure,
  type AppSettingsV1,
  type ImageGenerationSettingsPatchV1,
} from '@shared/app-settings'
import type {
  AgentRuntimeGitCheckpoint,
  AgentRuntimeModelAuditRecord
} from '@shared/agent-runtime-contract'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { getProvider } from '../agent/registry'
import type {
  LocalRuntimeMemoryRecordJson,
  LocalRuntimeInfoJson,
  LocalRuntimeToolDiagnosticsJson
} from '../agent/local-runtime-contract'
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
  hasValidPort,
  listSettingsText,
  mergeSettings,
  splitSettingsList
} from './settings-utils'
import { loadLocalRuntimeDiagnostics } from '../lib/load-local-runtime-diagnostics'
import { createSettingsMemoryActions } from '../lib/settings-memory-actions'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import type { InlineNotice } from './settings-controls'
import {
  AgentsSettingsSection,
  ConnectPhoneSettingsSection,
  GeneralSettingsSection,
  KeyboardShortcutsSettingsSection,
  RemoteResourcesSettingsSection,
  SpeechToTextSettingsSection
} from './settings-sections'

type SettingsCategory = 'general' | 'speechToText' | 'agents' | 'shortcuts' | 'connectPhone' | 'remoteResources'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SettingsPatch = AppSettingsPatch
type MemoryScopeFilter = 'all' | 'user' | 'workspace' | 'project'
type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  available: boolean
}

function unknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clipDiagnosticText(value: string, limit = 12_000): string {
  return value.length > limit ? `${value.slice(0, limit)}\n...` : value
}

function formatGitCheckpointPreviewResult(result: unknown, emptyLabel: string): string {
  const response = unknownRecord(result)
  if (response.ok === false) {
    return String(response.message ?? response.reason ?? emptyLabel)
  }
  const value = unknownRecord(response.value ?? result)
  const sections: string[] = []
  const untrackedFiles = Array.isArray(value.untrackedFiles)
    ? value.untrackedFiles.filter((item): item is string => typeof item === 'string')
    : []
  if (untrackedFiles.length > 0) {
    sections.push(`Untracked files:\n${untrackedFiles.slice(0, 50).join('\n')}`)
  }
  const stagedPatch = typeof value.stagedPatch === 'string' ? value.stagedPatch.trim() : ''
  if (stagedPatch) sections.push(`Staged patch:\n${stagedPatch}`)
  const unstagedPatch = typeof value.unstagedPatch === 'string' ? value.unstagedPatch.trim() : ''
  if (unstagedPatch) sections.push(`Unstaged patch:\n${unstagedPatch}`)
  return clipDiagnosticText(sections.join('\n\n') || emptyLabel)
}

function runtimeResultMessage(result: unknown): string | null {
  const response = unknownRecord(result)
  if (response.ok !== false) return null
  return String(response.message ?? response.reason ?? 'Operation failed.')
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
  const [workspacePickerError, setWorkspacePickerError] = useState<string | null>(null)
  const [connectPhoneWorkspacePickerError, setConnectPhoneWorkspacePickerError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showImageGenerationApiKey, setShowImageGenerationApiKey] = useState(false)
  const [showRuntimeToken, setShowRuntimeToken] = useState(false)
  const [logPath, setLogPath] = useState('')
  const [logDirOpenError, setLogDirOpenError] = useState<string | null>(null)
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [skillNotice, setSkillNotice] = useState<InlineNotice | null>(null)
  const [mcpConfigPath, setMcpConfigPath] = useState('~/.sciforge/mcp.json')
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpConfigExists, setMcpConfigExists] = useState(false)
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<InlineNotice | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<LocalRuntimeInfoJson | null>(null)
  const [toolDiagnostics, setToolDiagnostics] = useState<LocalRuntimeToolDiagnosticsJson | null>(null)
  const [memoryRecords, setMemoryRecords] = useState<LocalRuntimeMemoryRecordJson[]>([])
  const [memoryScopeFilter, setMemoryScopeFilter] = useState<MemoryScopeFilter>('all')
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryDraftContent, setMemoryDraftContent] = useState('')
  const [memoryDraftScope, setMemoryDraftScope] = useState<'user' | 'workspace' | 'project'>('workspace')
  const [memoryEditingId, setMemoryEditingId] = useState<string | null>(null)
  const [memoryEditingContent, setMemoryEditingContent] = useState('')
  const [modelAuditRecords, setModelAuditRecords] = useState<AgentRuntimeModelAuditRecord[]>([])
  const [gitCheckpoints, setGitCheckpoints] = useState<AgentRuntimeGitCheckpoint[]>([])
  const [gitCheckpointPreviewId, setGitCheckpointPreviewId] = useState<string | null>(null)
  const [gitCheckpointPreview, setGitCheckpointPreview] = useState('')
  const [gitCheckpointForceRestore, setGitCheckpointForceRestore] = useState(false)
  const [runtimeDiagnosticsBusy, setRuntimeDiagnosticsBusy] = useState(false)
  const [runtimeDiagnosticsNotice, setRuntimeDiagnosticsNotice] = useState<InlineNotice | null>(null)
  const initializedCategory = useRef(false)
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const draftVersion = useRef(0)
  const agentsSectionRef = useRef<HTMLDivElement | null>(null)
  const skillSectionRef = useRef<HTMLDivElement | null>(null)
  const mcpSectionRef = useRef<HTMLDivElement | null>(null)
  const permissionsSectionRef = useRef<HTMLDivElement | null>(null)
  const formTheme = form?.theme
  const formUiFontScale = form?.uiFontScale
  const formWorkspaceRoot = form?.workspaceRoot
  const formLocalRuntime = form ? getLocalRuntimeSettings(form) : null
  const formPort = formLocalRuntime?.port
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
    if (!formTheme || !formUiFontScale) return
    applyTheme(formTheme)
    applyUiFontScale(formUiFontScale)
  }, [formTheme, formUiFontScale])

  useEffect(() => {
    if (typeof window.sciforge?.getLogPath !== 'function') return
    void window.sciforge.getLogPath().then((p) => setLogPath(p)).catch(() => undefined)
  }, [category])

  useEffect(() => {
    if (!form || initializedCategory.current) return
    initializedCategory.current = true
    if (!getActiveAgentApiKey(form).trim()) {
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
    if (settingsSection === 'connectPhone') {
      setCategory('connectPhone')
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
      settingsSection === 'connectPhone' ||
      settingsSection === 'remoteResources' ||
      settingsSection === 'shortcuts' ||
      category !== 'agents'
    ) {
      return
    }
    const refs: Record<Exclude<SettingsRouteSection, 'general' | 'speechToText' | 'connectPhone' | 'remoteResources' | 'shortcuts'>, HTMLDivElement | null> = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current
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

  const portError = useMemo(() => {
    if (!form || typeof formPort !== 'number') return null
    if (!hasValidPort(form)) return t('portInvalid')
    return null
  }, [form, formPort, t])

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
    skillRootOptions.find((option) => option.id === skillRootId && option.available) ??
    skillRootOptions.find((option) => option.available)

  useEffect(() => {
    const selectedOption = skillRootOptions.find((option) => option.id === skillRootId && option.available)
    if (selectedOption) {
      savePreferredSkillRootId(skillRootId)
      return
    }
    const fallback = skillRootOptions.find((option) => option.available)
    if (fallback && fallback.id !== skillRootId) {
      setSkillRootId(fallback.id)
    }
  }, [skillRootId, skillRootOptions])

  const loadMcpConfig = async (): Promise<void> => {
    if (typeof window.sciforge?.getRuntimeConfigFile !== 'function') return
    setMcpLoading(true)
    setMcpNotice(null)
    try {
      const config = await window.sciforge.getRuntimeConfigFile()
      setMcpConfigPath(config.path)
      setMcpConfigText(config.content)
      setMcpConfigExists(config.exists)
      setMcpLoaded(true)
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpLoading(false)
    }
  }

  useEffect(() => {
    if (category !== 'agents' || mcpLoaded || mcpLoading) return
    void loadMcpConfig()
  }, [category, mcpLoaded, mcpLoading])

  const openSkillRoot = async (): Promise<void> => {
    if (!selectedSkillRoot?.path || !selectedSkillRoot.available) {
      setSkillNotice({ tone: 'error', message: t('skillsRootUnavailable') })
      return
    }
    if (typeof window.sciforge?.openSkillRoot !== 'function') return
    setSkillNotice(null)
    const result = await window.sciforge.openSkillRoot(selectedSkillRoot.path)
    if (!result.ok) {
      setSkillNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const saveMcpConfig = async (): Promise<void> => {
    if (typeof window.sciforge?.setRuntimeConfigFile !== 'function') return
    setMcpBusy(true)
    setMcpNotice(null)
    try {
      const result = await window.sciforge.setRuntimeConfigFile(mcpConfigText)
      setMcpConfigPath(result.path)
      setMcpConfigExists(true)
      setMcpNotice({
        tone: 'success',
        message: t('mcpSaved', { path: result.path })
      })
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpBusy(false)
    }
  }

  const openMcpConfigDir = async (): Promise<void> => {
    if (typeof window.sciforge?.openRuntimeConfigDir !== 'function') return
    const result = await window.sciforge.openRuntimeConfigDir()
    if (!result.ok) {
      setMcpNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const refreshLocalRuntimeDiagnostics = useCallback(async (): Promise<void> => {
    const provider = getProvider()
    setRuntimeDiagnosticsBusy(true)
    setRuntimeDiagnosticsNotice(null)
    try {
      const loaded = await loadLocalRuntimeDiagnostics(provider, {
        workspace: normalizeWorkspaceRoot(formWorkspaceRoot),
        memoryScope: memoryScopeFilter === 'all' ? undefined : memoryScopeFilter,
        memoryQuery
      })
      if (loaded.runtimeInfo !== undefined) setRuntimeInfo(loaded.runtimeInfo)
      if (loaded.toolDiagnostics !== undefined) setToolDiagnostics(loaded.toolDiagnostics)
      if (loaded.memoryRecords !== undefined) setMemoryRecords(loaded.memoryRecords)
      if (typeof provider.listModelAuditRecords === 'function') {
        setModelAuditRecords(await provider.listModelAuditRecords({ limit: 20 }))
      }
      if (typeof provider.listGitCheckpoints === 'function') {
        setGitCheckpoints(await provider.listGitCheckpoints({
          workspaceRoot: normalizeWorkspaceRoot(formWorkspaceRoot)
        }))
      }
      if (loaded.errors.length > 0) {
        setRuntimeDiagnosticsNotice({
          tone: 'error',
          message: loaded.errors.join(' | ')
        })
      }
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setRuntimeDiagnosticsBusy(false)
    }
  }, [formWorkspaceRoot, memoryQuery, memoryScopeFilter])

  const clearModelAuditRecords = async (): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.clearModelAuditRecords !== 'function') return
    try {
      await provider.clearModelAuditRecords()
      setModelAuditRecords([])
      setRuntimeDiagnosticsNotice({
        tone: 'success',
        message: t('modelAuditCleared')
      })
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const previewGitCheckpoint = async (checkpointId: string): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.previewGitCheckpoint !== 'function') return
    try {
      const result = await provider.previewGitCheckpoint(checkpointId)
      setGitCheckpointPreviewId(checkpointId)
      setGitCheckpointPreview(formatGitCheckpointPreviewResult(result, t('gitCheckpointPreviewEmpty')))
      const failure = runtimeResultMessage(result)
      if (failure) {
        setRuntimeDiagnosticsNotice({
          tone: 'error',
          message: failure
        })
      }
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const restoreGitCheckpoint = async (checkpointId: string): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.restoreGitCheckpoint !== 'function') return
    try {
      const result = await provider.restoreGitCheckpoint(checkpointId, {
        force: gitCheckpointForceRestore
      })
      const failure = runtimeResultMessage(result)
      if (failure) {
        setRuntimeDiagnosticsNotice({
          tone: 'error',
          message: failure
        })
        return
      }
      setRuntimeDiagnosticsNotice({
        tone: 'success',
        message: t('gitCheckpointRestored')
      })
      if (typeof provider.listGitCheckpoints === 'function') {
        setGitCheckpoints(await provider.listGitCheckpoints({
          workspaceRoot: normalizeWorkspaceRoot(formWorkspaceRoot)
        }))
      }
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  useEffect(() => {
    if (category !== 'agents') return
    void refreshLocalRuntimeDiagnostics()
  }, [category, refreshLocalRuntimeDiagnostics])

  const {
    createMemoryRecord,
    disableMemoryRecord,
    startEditingMemoryRecord,
    cancelEditingMemoryRecord,
    saveMemoryRecord,
    deleteMemoryRecord
  } = useMemo(() => createSettingsMemoryActions({
    getProvider,
    getState: () => ({
      memoryDraftContent,
      memoryDraftScope,
      memoryEditingContent,
      workspaceRoot: normalizeWorkspaceRoot(formWorkspaceRoot)
    }),
    setMemoryRecords,
    setMemoryDraftContent,
    setMemoryEditingId,
    setMemoryEditingContent,
    setNotice: setRuntimeDiagnosticsNotice,
    t
  }), [
    formWorkspaceRoot,
    memoryDraftContent,
    memoryDraftScope,
    memoryEditingContent,
    t
  ])

  const scrollToAgentSection = (target: 'agents' | 'skill' | 'mcp' | 'permissions'): void => {
    const refs = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    refs[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const persistSettings = async (snapshot: AppSettingsV1, version: number): Promise<void> => {
    if (!hasValidPort(snapshot)) return
    setSaveStatus('saving')
    setSaveError(null)

    try {
      const next = coerceRendererSettings(await rendererRuntimeClient.setSettings(snapshot))
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

    if (!hasValidPort(next)) {
      setSaveStatus('idle')
      return
    }

    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void persistSettings(next, version)
    }, 450)
  }

  const flushPendingSave = async (): Promise<void> => {
    if (!form || !hasValidPort(form)) return
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
      loadError === 'PRELOAD_BRIDGE' ? t('preloadBridgeError') : t('loadFailed', { message: loadError })
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

  const localRuntime = getLocalRuntimeSettings(form)
  const codex = getCodexRuntimeSettings(form)
  const claude = getClaudeRuntimeSettings(form)
  const provider = getModelProviderSettings(form)
  const imageGeneration = getImageGenerationSettings(form)
  const activeApiKey = getActiveAgentApiKey(form)

  const update = (partial: SettingsPatch): void => {
    const next = mergeSettings(form, partial)
    setForm(next)
    if (partial.locale) void applyI18n(partial.locale)
    if (partial.guiUpdate?.channel && partial.guiUpdate.channel !== form.guiUpdate.channel) {
      resetGuiUpdateState()
    }
    scheduleSave(next)
  }

  const updateLocalRuntime = (patch: Partial<AppSettingsV1['agents']['sciforge']>): void => {
    update({ agents: localRuntimeSettingsPatch(patch) })
  }

  const sharedApiKey = provider.apiKey
  const sharedBaseUrl = provider.baseUrl
  const updateSharedCredential = (patch: { apiKey?: string; baseUrl?: string }): void => {
    update({ provider: patch })
  }

  const updateImageGeneration = (patch: ImageGenerationSettingsPatchV1): void => {
    update({ imageGeneration: patch })
  }

  const saveBasicsModelConfig = async (config: { apiKey: string; baseUrl: string; model: string }): Promise<AppSettingsV1> => {
    const next = coerceRendererSettings(await rendererRuntimeClient.setSettings({
      provider: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl
      },
      modelRouter: {
        profiles: {
          default: {
            textReasoner: { model: config.model }
          }
        }
      }
    }))
    setForm(next)
    emitRendererSettingsChanged(next)
    void reloadUiSettings()
    void probeRuntime('background')
    return next
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
      const picked = await window.sciforge.pickWorkspaceDirectory(form.workspaceRoot || undefined)
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

  const pickConnectPhoneWorkspace = async (): Promise<void> => {
    try {
      setConnectPhoneWorkspacePickerError(null)
      if (typeof window.sciforge?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.sciforge.pickWorkspaceDirectory(
        form.remoteChannel.im.workspaceRoot || form.workspaceRoot || undefined
      )
      if (!picked.canceled && picked.path) {
        update({ remoteChannel: { im: { workspaceRoot: picked.path } } })
      }
    } catch (e) {
      setConnectPhoneWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetConnectPhoneWorkspaceToDefault = (): void => {
    setConnectPhoneWorkspacePickerError(null)
    update({ remoteChannel: { im: { workspaceRoot: '' } } })
  }

  const selectControlClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

  const settingsSectionContext = {
    t,
    tCommon,
    form,
    provider,
    localRuntime,
    imageGeneration,
    codex,
    claude,
    activeApiKey,
    update,
    updateLocalRuntime,
    updateCodex,
    updateClaude,
    updateSharedCredential,
    updateImageGeneration,
    saveBasicsModelConfig,
    sharedApiKey,
    sharedBaseUrl,
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
    runtimeInfo,
    toolDiagnostics,
    memoryRecords,
    memoryScopeFilter,
    setMemoryScopeFilter,
    memoryQuery,
    setMemoryQuery,
    memoryDraftContent,
    setMemoryDraftContent,
    memoryDraftScope,
    setMemoryDraftScope,
    memoryEditingId,
    memoryEditingContent,
    setMemoryEditingContent,
    modelAuditRecords,
    gitCheckpoints,
    gitCheckpointPreviewId,
    gitCheckpointPreview,
    gitCheckpointForceRestore,
    setGitCheckpointForceRestore,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshLocalRuntimeDiagnostics,
    clearModelAuditRecords,
    previewGitCheckpoint,
    restoreGitCheckpoint,
    createMemoryRecord,
    startEditingMemoryRecord,
    cancelEditingMemoryRecord,
    saveMemoryRecord,
    disableMemoryRecord,
    deleteMemoryRecord,
    pickConnectPhoneWorkspace,
    resetConnectPhoneWorkspaceToDefault,
    connectPhoneWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  }

  return (
    <div className="ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main">
      <SettingsSidebar category={category} setCategory={setCategory} goBack={goBack} t={t} />

      <div className="ds-no-drag min-h-0 min-w-0 flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto max-w-3xl">
          {!activeApiKey.trim() ? (
            <div className="mb-6 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-5 py-4 text-amber-950 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
              <div className="text-[15px] font-semibold">{t('apiKeyRequiredTitle')}</div>
              <p className="mt-1 text-[13px] leading-6 text-amber-900/90 dark:text-amber-100/90">
                {t('apiKeyRequiredBody')}
              </p>
            </div>
          ) : null}

          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ds-ink">{t('title')}</h1>
              <p className="mt-1 text-[14px] text-ds-muted">{t('subtitle')}</p>
            </div>
            <span
              title={saveStatus === 'error' && saveError ? saveError : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                portError
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                  : saveStatus === 'saved'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                    : saveStatus === 'error'
                      ? 'bg-red-500/15 text-red-700 dark:text-red-200'
                      : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {portError
                ? t('autoApplyBlocked')
                : saveStatus === 'saving'
                  ? t('applying')
                  : saveStatus === 'saved'
                    ? t('applied')
                    : saveStatus === 'error'
                      ? t('applyFailed')
                      : t('autoApplyHint')}
            </span>
          </div>

          {category === 'general' ? <GeneralSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'speechToText' ? <SpeechToTextSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'agents' ? <AgentsSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'shortcuts' ? <KeyboardShortcutsSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'remoteResources' ? <RemoteResourcesSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'connectPhone' ? <ConnectPhoneSettingsSection ctx={settingsSectionContext} /> : null}
        </div>
      </div>
    </div>
  )
}
