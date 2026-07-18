import type i18next from 'i18next'
import {
  getActiveAgentRuntime,
  type AgentRuntimeId,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet, InitialSetupMode, PluginHostRoute, SettingsRouteSection } from './chat-store-types'

type CreateAppActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: typeof i18next
  persistComposerModel: (model: string) => void
  readStoredComposerModel: (allowedIds: readonly string[]) => string
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
  | 'setActiveAgentRuntime'
  | 'loadComposerModels'
  | 'setRoute'
  | 'openSettings'
  | 'openPlugins'
  | 'openConnectPhone'
  | 'setConnectPhonePanelOpen'
  | 'openSchedule'
  | 'selectRemoteGuardChannel'
  | 'clearRemoteGuardChannel'
  | 'openInitialSetup'
  | 'closeInitialSetup'
  | 'applyI18nFromSettings'
  | 'reloadUiSettings'
> {
  const {
    set,
    get,
    i18n,
    persistComposerModel,
    readStoredComposerModel,
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
      persistComposerModel(modelId)
      set({ composerModel: modelId })
    },

    setActiveAgentRuntime: async (runtimeId: AgentRuntimeId) => {
      const previousRuntimeId = get().activeAgentRuntime
      set({
        activeAgentRuntime: runtimeId,
        runtimeConnection: 'checking',
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
        const allowed = new Set(pick)
        set((state) => {
          let model = state.composerModel
          if (model !== '' && !allowed.has(model)) {
            model = readStoredComposerModel(pick)
          }
          if (model !== '' && !allowed.has(model)) model = ''
          if (model !== state.composerModel) persistComposerModel(model)
          return { composerPickList: pick, composerModel: model, composerModelGroups: groups }
        })
      })().finally(() => {
        setComposerModelLoadPromise(null)
      })
      setComposerModelLoadPromise(task)
      return task
    },

    setRoute: (route) => set({
      route,
      ...(route === 'chat' ? {} : { remoteGuardChannelId: null, connectPhonePanelOpen: false })
    }),

    openSettings: (section: SettingsRouteSection = 'general') =>
      set((state) => ({
        route: 'settings',
        remoteGuardChannelId: null,
        connectPhonePanelOpen: false,
        settingsSection: section,
        settingsReturnRoute: state.route === 'settings' ? state.settingsReturnRoute : state.route
      })),

    openPlugins: (host?: PluginHostRoute) =>
      set((state) => ({
        route: 'plugins',
        remoteGuardChannelId: null,
        connectPhonePanelOpen: false,
        pluginHostRoute: host ?? 'chat'
      })),

    openConnectPhone: () => {
      set({ route: 'chat', remoteGuardChannelId: null, connectPhonePanelOpen: true })
      void get().refreshRemoteChannels()
    },

    setConnectPhonePanelOpen: (open) => set({
      connectPhonePanelOpen: open,
      ...(open ? { route: 'chat' as const, remoteGuardChannelId: null } : {})
    }),

    openSchedule: () => {
      set({ route: 'schedule', remoteGuardChannelId: null, connectPhonePanelOpen: false })
    },

    selectRemoteGuardChannel: (channelId) => {
      const channel = get().remoteChannels.find((item) => item.id === channelId)
      if (!channel) return
      set({
        route: 'chat',
        remoteGuardChannelId: channel.id,
        connectPhonePanelOpen: false,
        activeRemoteChannelId: channel.id,
        error: null
      })
    },

    clearRemoteGuardChannel: () => set({ remoteGuardChannelId: null }),

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
        remoteChannels: settings.remoteChannel.channels,
        activeRemoteChannelId: settings.remoteChannel.channels.some(
          (channel) => channel.id === get().activeRemoteChannelId && channel.enabled
        )
          ? get().activeRemoteChannelId
          : settings.remoteChannel.channels.find((channel) => channel.enabled)?.id ?? ''
      })
      await get().applyI18nFromSettings(settings.locale)
      if (get().runtimeConnection === 'ready') {
        void get().refreshThreads()
      }
      void get().loadComposerModels()
    }
  }
}
