import type i18next from 'i18next'
import {
  getActiveAgentRuntime,
  getModelAccessSettings,
  type AgentRuntimeId,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { storedReasoningEffortReset } from '../lib/composer-runtime-options'
import {
  composerReasoningEntry,
  composerReasoningDiscoveryKey,
  composerReasoningEffortRepresentable
} from '../lib/composer-reasoning-discovery'
import type {
  ChatState,
  ChatStoreGet,
  ChatStoreSet,
  ConversationRuntimeSettings,
  InitialSetupMode,
  PluginHostRoute,
  SettingsRouteSection
} from './chat-store-types'

function updateConversationSettings(
  state: ChatState,
  patch: Partial<ConversationRuntimeSettings>
): Partial<ChatState> {
  const current = state.activeThreadId
    ? state.conversationSettingsByThread[state.activeThreadId]
    : state.draftConversationSettings
  const next = {
    model: current?.model ?? state.composerModel,
    reasoningEffort: current?.reasoningEffort ?? state.composerReasoningEffort,
    serviceTier: current?.serviceTier ?? state.composerServiceTier,
    ...patch
  }
  return {
    composerModel: next.model,
    composerReasoningEffort: next.reasoningEffort,
    composerServiceTier: next.serviceTier,
    ...(state.activeThreadId
      ? {
          conversationSettingsByThread: {
            ...state.conversationSettingsByThread,
            [state.activeThreadId]: next
          }
        }
      : { draftConversationSettings: next })
  }
}

/**
 * The single place a stored composer effort is checked against the current
 * binding's capability evidence. Router bindings use model-reasoning discovery;
 * runtime-owned models use their runtime catalog. The reset is persisted with
 * the conversation settings so reopening does not repeat the notice.
 */
export function reconcileStoredReasoningEffort(state: ChatState): Partial<ChatState> {
  const entry = composerReasoningEntry(state.composerModelGroups, state.composerModel)
  let reset: { from: string; to: string } | null
  if (entry) {
    const discovery = state.composerReasoningDiscovery
    if (discovery?.key !== composerReasoningDiscoveryKey(entry) || discovery.status !== 'ready') return {}
    const from = (state.composerReasoningEffort ?? '').trim()
    const outcome = discovery.outcome
    const unsupported = outcome?.state === 'unsupported' || (
      outcome?.completeness !== 'partial' && !composerReasoningEffortRepresentable(outcome, from)
    )
    reset = from && unsupported ? { from, to: '' } : null
  } else {
    // The Codex alias is not evidence about the configured upstream model.
    // Wait for its binding instead of judging it against fallback metadata.
    if (state.modelAccessMode === 'api' && state.activeAgentRuntime === 'codex') return {}
    reset = storedReasoningEffortReset(
      { model: state.composerModel, reasoningEffort: state.composerReasoningEffort },
      state.composerModelCatalog
    )
  }
  if (!reset) return {}
  return {
    ...updateConversationSettings(state, { reasoningEffort: reset.to }),
    composerReasoningEffortReset: reset
  }
}

type CreateAppActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: typeof i18next
  mergeComposerPickList: (upstreamOk: boolean, upstreamIds: string[]) => string[]
  getComposerModelLoadPromise: () => Promise<void> | null
  setComposerModelLoadPromise: (promise: Promise<void> | null) => void
  applyTheme: (theme: AppSettingsV1['theme']) => void
  applyUiFontScale: (scale: AppSettingsV1['uiFontScale']) => void
  applyDocumentLocale: (locale: AppSettingsV1['locale']) => void
  workspaceLabelFromPath: (workspaceRoot: string) => string
  normalizeWorkspaceRoot: (workspaceRoot?: string | null) => string
}

export function createAppActions(options: CreateAppActionsOptions): Pick<
  ChatState,
  | 'setError'
  | 'setComposerModel'
  | 'setComposerReasoningEffort'
  | 'dismissComposerReasoningEffortReset'
  | 'setComposerServiceTier'
  | 'refreshComposerReasoningDiscovery'
  | 'setActiveAgentRuntime'
  | 'loadComposerModels'
  | 'setRoute'
  | 'openSettings'
  | 'openPlugins'
  | 'openSchedule'
  | 'openInitialSetup'
  | 'closeInitialSetup'
  | 'applyI18nFromSettings'
  | 'reloadUiSettings'
> {
  const {
    set,
    get,
    i18n,
    mergeComposerPickList,
    getComposerModelLoadPromise,
    setComposerModelLoadPromise,
    applyTheme,
    applyUiFontScale,
    applyDocumentLocale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot
  } = options

  return {
    setError: (message) => set({ error: message }),

    setComposerModel: (modelId) => {
      set((state) => {
        const patch = updateConversationSettings(state, { model: modelId.trim() })
        return { ...patch, ...reconcileStoredReasoningEffort({ ...state, ...patch }) }
      })
      void get().refreshComposerReasoningDiscovery()
    },

    // An explicit choice is stored as-is (an empty value clears it to the
    // upstream default); an undeclared explicit choice is rejected at send.
    setComposerReasoningEffort: (reasoningEffort) => {
      set((state) => ({
        ...updateConversationSettings(state, { reasoningEffort: reasoningEffort.trim() }),
        composerReasoningEffortReset: null
      }))
    },

    dismissComposerReasoningEffortReset: () => set({ composerReasoningEffortReset: null }),

    setComposerServiceTier: (serviceTier) => {
      const normalized = serviceTier.trim()
      set((state) => updateConversationSettings(state, { serviceTier: normalized }))
    },

    refreshComposerReasoningDiscovery: async (options = {}) => {
      if (typeof window === 'undefined' || typeof window.sciforge === 'undefined') return
      const entry = composerReasoningEntry(get().composerModelGroups, get().composerModel)
      if (!entry) {
        if (get().composerReasoningDiscovery !== null) set({ composerReasoningDiscovery: null })
        return
      }
      const key = composerReasoningDiscoveryKey(entry)
      const current = get().composerReasoningDiscovery
      if (!options.force && current && current.key === key && current.status === 'ready') {
        set(reconcileStoredReasoningEffort(get()))
        return
      }
      set({
        composerReasoningDiscovery: {
          key,
          status: 'loading',
          outcome: current && current.key === key ? current.outcome : null,
          message: null
        }
      })
      try {
        const outcome = await window.sciforge.modelReasoning.discover({
          provider: 'model-router',
          model: entry.upstreamModel,
          protocol: entry.protocol,
          endpoint: entry.endpoint,
          ...(options.force ? { force: true } : {})
        })
        const latest = composerReasoningEntry(get().composerModelGroups, get().composerModel)
        // A late response must never override a newer selection.
        if (!latest || composerReasoningDiscoveryKey(latest) !== key) return
        set((state) => {
          const patch = { composerReasoningDiscovery: { key, status: 'ready' as const, outcome, message: null } }
          return { ...patch, ...reconcileStoredReasoningEffort({ ...state, ...patch }) }
        })
      } catch (error) {
        const latest = composerReasoningEntry(get().composerModelGroups, get().composerModel)
        if (!latest || composerReasoningDiscoveryKey(latest) !== key) return
        set({
          composerReasoningDiscovery: {
            key,
            status: 'error',
            outcome: null,
            message: error instanceof Error ? error.message : String(error)
          }
        })
      }
    },

    setActiveAgentRuntime: async (runtimeId: AgentRuntimeId) => {
      // Coding Plan is bound to the Codex runtime; DSH and every other
      // runtime stay excluded until Coding Plan support is declared for them.
      if (get().modelAccessMode === 'coding-plan' && runtimeId !== 'codex') {
        set({ error: 'Codex Plan requires the Codex runtime.' })
        return
      }
      const previousRuntimeId = get().activeAgentRuntime
      set({
        activeAgentRuntime: runtimeId,
        runtimeConnection: 'checking',
        composerModelCatalog: null,
        error: null,
        runtimeErrorDetail: null
      })
      try {
        const saved = await rendererRuntimeClient.setSettings({ activeAgentRuntime: runtimeId })
        const activeAgentRuntime = getActiveAgentRuntime(saved)
        set({
          activeAgentRuntime,
          runtimeConnection: 'checking',
          error: null,
          runtimeErrorDetail: null
        })
        await get().probeRuntime('user')
      } catch (error) {
        set({
          activeAgentRuntime: previousRuntimeId,
          error: error instanceof Error ? error.message : String(error),
          runtimeConnection: 'offline'
        })
      }
    },

    loadComposerModels: async () => {
      if (getComposerModelLoadPromise()) return getComposerModelLoadPromise()!
      if (typeof window.sciforge === 'undefined') return
      const task = (async () => {
        const res = await window.sciforge.fetchUpstreamModels()
        const pick = mergeComposerPickList(res.ok, res.ok ? res.modelIds : [])
        const groups = res.ok ? res.modelGroups ?? [] : []
        set({ composerPickList: pick, composerModelGroups: groups })
        await get().refreshComposerReasoningDiscovery()
      })().finally(() => {
        setComposerModelLoadPromise(null)
      })
      setComposerModelLoadPromise(task)
      return task
    },

    setRoute: (route) => set({ route }),

    openSettings: (section: SettingsRouteSection = 'general') =>
      set((state) => ({
        route: 'settings',
        settingsSection: section,
        settingsReturnRoute: state.route === 'settings' ? state.settingsReturnRoute : state.route
      })),

    openPlugins: (host?: PluginHostRoute) =>
      set((state) => ({
        route: 'plugins',
        pluginHostRoute: host ?? 'chat'
      })),

    openSchedule: () => {
      set({ route: 'schedule' })
    },

    openInitialSetup: (mode: InitialSetupMode = 'required') =>
      set({ initialSetupOpen: true, initialSetupMode: mode }),

    closeInitialSetup: () => set({ initialSetupOpen: false, initialSetupMode: 'required' }),

    applyI18nFromSettings: async (locale) => {
      await i18n.changeLanguage(locale)
      applyDocumentLocale(locale)
    },

    reloadUiSettings: async () => {
      if (typeof window.sciforge === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
      applyTheme(settings.theme)
      applyUiFontScale(settings.uiFontScale)
      set({
        workspaceRoot,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        activeAgentRuntime: getActiveAgentRuntime(settings),
        modelAccessMode: getModelAccessSettings(settings)?.mode ?? null
      })
      await get().applyI18nFromSettings(settings.locale)
      if (get().runtimeConnection === 'ready') {
        void get().refreshThreads()
      }
      void get().loadComposerModels()
    }
  }
}
