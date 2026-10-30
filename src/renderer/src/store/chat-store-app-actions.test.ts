import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { ModelReasoningOutcome } from '@shared/model-reasoning'
import { composerReasoningDiscoveryKey } from '../lib/composer-reasoning-discovery'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createAppActions, reconcileStoredReasoningEffort } from './chat-store-app-actions'

const routerCatalog = {
  available: true,
  complete: true,
  defaultModelId: 'router-model',
  models: [{
    id: 'router-model', displayName: 'Router', isDefault: true,
    inputModalities: ['text'], reasoningEfforts: [], serviceTiers: []
  }, {
    id: 'declared-model', displayName: 'Declared', isDefault: false, inputModalities: ['text'],
    reasoningEfforts: [{ id: 'low', isDefault: false }, { id: 'high', isDefault: true }], serviceTiers: []
  }]
} as const

const routerEntry = {
  id: 'sciforge-router', upstreamModel: 'deepseek-v4-flash-0731',
  displayName: 'DeepSeek', protocol: 'chat-completions', endpoint: 'https://provider.invalid',
  reasoning: { levels: [], defaultLevel: null }
}
const modelGroups = [{
  providerId: 'model-router', label: 'Model Router', modelIds: [routerEntry.id], models: [routerEntry]
}]
function discovered(overrides: Partial<ModelReasoningOutcome> = {}): ModelReasoningOutcome {
  return {
    state: 'known', levels: ['high', 'max'], completeness: 'complete', defaultLevel: null,
    source: 'vocabulary', verifiedAt: null, checkedAt: '2026-10-27T12:00:00Z', attachEffort: true,
    ...overrides
  }
}

afterEach(() => vi.unstubAllGlobals())

function buildHarness(initialState: Partial<ChatState> = {}) {
  const state = {
    route: 'chat',
    activeThreadId: 'desktop-thread',
    refreshThreads: vi.fn(async () => undefined),
    loadComposerModels: vi.fn(async () => undefined),
    applyI18nFromSettings: vi.fn(async () => undefined),
    composerModel: '',
    composerReasoningEffort: 'medium',
    composerServiceTier: 'default',
    conversationSettingsByThread: {},
    draftConversationSettings: null,
    composerPickList: [],
    composerModelGroups: [],
    ...initialState
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
  }
  const get: ChatStoreGet = () => state
  const actions = createAppActions({
    set,
    get,
    i18n: { changeLanguage: vi.fn(async () => undefined) } as never,
    mergeComposerPickList: vi.fn(() => []),
    getComposerModelLoadPromise: vi.fn(() => null),
    setComposerModelLoadPromise: vi.fn(),
    applyTheme: vi.fn(),
    applyUiFontScale: vi.fn(),
    applyDocumentLocale: vi.fn(),
    workspaceLabelFromPath: vi.fn((workspaceRoot: string) => workspaceRoot),
    normalizeWorkspaceRoot: vi.fn((workspaceRoot?: string | null) => workspaceRoot?.trim() ?? '')
  })
  Object.assign(state, actions)
  return { actions, state }
}

describe('chat-store app actions', () => {
  it('optimistically shows the selected runtime while settings save', async () => {
    const deferred: { resolve: (settings: AppSettingsV1) => void } = { resolve: () => undefined }
    const setSettings = vi.fn(() => new Promise<AppSettingsV1>((resolve) => {
      deferred.resolve = resolve
    }))
    vi.stubGlobal('window', { sciforge: { setSettings } })
    const probeRuntime = vi.fn(async () => undefined)
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex',
      runtimeConnection: 'ready',
      runtimeErrorDetail: 'old error',
      error: 'old error',
      probeRuntime
    })

    const task = actions.setActiveAgentRuntime('dsh')
    expect(state.activeAgentRuntime).toBe('dsh')
    expect(state.runtimeConnection).toBe('checking')
    expect(state.error).toBeNull()
    deferred.resolve({ activeAgentRuntime: 'dsh' } as AppSettingsV1)
    await task
    expect(probeRuntime).toHaveBeenCalledWith('user')
  })

  it('rolls runtime selection back when settings save fails', async () => {
    vi.stubGlobal('window', { sciforge: { setSettings: vi.fn(async () => { throw new Error('save failed') }) } })
    const probeRuntime = vi.fn(async () => undefined)
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex',
      runtimeConnection: 'ready',
      probeRuntime
    })

    await actions.setActiveAgentRuntime('dsh')
    expect(state.activeAgentRuntime).toBe('codex')
    expect(state.runtimeConnection).toBe('offline')
    expect(state.error).toBe('save failed')
    expect(probeRuntime).not.toHaveBeenCalled()
  })

  it('rejects switching away from Codex while Codex Plan is active', async () => {
    const setSettings = vi.fn()
    vi.stubGlobal('window', { sciforge: { setSettings } })
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex',
      modelAccessMode: 'coding-plan',
      error: null
    })

    await actions.setActiveAgentRuntime('dsh')
    expect(state.activeAgentRuntime).toBe('codex')
    expect(state.error).toBe('Codex Plan requires the Codex runtime.')
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('rejects switching to DSH while Codex Plan is active', async () => {
    const setSettings = vi.fn()
    vi.stubGlobal('window', { sciforge: { setSettings } })
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex',
      modelAccessMode: 'coding-plan',
      error: null
    })

    await actions.setActiveAgentRuntime('dsh')
    expect(state.activeAgentRuntime).toBe('codex')
    expect(state.error).toBe('Codex Plan requires the Codex runtime.')
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('does not couple runtime model discovery to a localStorage-backed global default', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        fetchUpstreamModels: vi.fn(async () => ({ ok: true, modelIds: ['discovered-model'] }))
      }
    })
    const { actions, state } = buildHarness({
      composerModel: 'frozen-conversation-model',
      conversationSettingsByThread: {
        'desktop-thread': {
          model: 'frozen-conversation-model', reasoningEffort: 'high', serviceTier: 'default'
        }
      }
    })

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('frozen-conversation-model')
  })

  it('resets the effort to the new model default when switching models, and persists it', () => {
    const { actions, state } = buildHarness({
      composerModel: 'declared-model',
      composerReasoningEffort: 'low',
      composerModelCatalog: routerCatalog,
      conversationSettingsByThread: {
        'desktop-thread': { model: 'declared-model', reasoningEffort: 'low', serviceTier: '' }
      },
      composerReasoningEffortReset: null
    })

    actions.setComposerModel('router-model')

    expect(state.composerReasoningEffort).toBe('')
    expect(state.conversationSettingsByThread['desktop-thread']).toEqual({
      model: 'router-model', reasoningEffort: '', serviceTier: ''
    })
    expect(state.composerReasoningEffortReset).toEqual({ from: 'low', to: '' })

    actions.setComposerModel('declared-model')
    actions.dismissComposerReasoningEffortReset()
    expect(state.composerReasoningEffortReset).toBeNull()
  })

  it('resets the saved API effort when discovery arrives without requiring the menu to open', async () => {
    const discover = vi.fn(async () => discovered())
    vi.stubGlobal('window', { sciforge: { modelReasoning: { discover } } })
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex', modelAccessMode: 'api',
      composerModel: '', composerReasoningEffort: 'medium',
      composerModelGroups: modelGroups, composerModelCatalog: routerCatalog,
      composerReasoningDiscovery: null,
      conversationSettingsByThread: {
        'desktop-thread': { model: '', reasoningEffort: 'medium', serviceTier: '' }
      }
    })

    expect(reconcileStoredReasoningEffort(state)).toEqual({})
    await actions.refreshComposerReasoningDiscovery()

    expect(discover).toHaveBeenCalledWith({
      provider: 'model-router', model: routerEntry.upstreamModel,
      protocol: routerEntry.protocol, endpoint: routerEntry.endpoint
    })
    expect(state.composerReasoningEffort).toBe('')
    expect(state.conversationSettingsByThread['desktop-thread']?.reasoningEffort).toBe('')
    expect(state.composerReasoningEffortReset).toEqual({ from: 'medium', to: '' })
    actions.dismissComposerReasoningEffortReset()
    await actions.refreshComposerReasoningDiscovery()
    expect(state.composerReasoningEffortReset).toBeNull()
  })

  it.each([
    ['a supported level', discovered({ levels: ['medium', 'high'] })],
    ['unknown capability', discovered({ state: 'unknown', levels: [], completeness: null })],
    ['a partial level list', discovered({ completeness: 'partial' })]
  ])('does not replace a saved level using runtime alias metadata for %s', async (_name, outcome) => {
    vi.stubGlobal('window', { sciforge: { modelReasoning: { discover: vi.fn(async () => outcome) } } })
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex', modelAccessMode: 'api', composerModel: '',
      composerReasoningEffort: 'medium', composerModelGroups: modelGroups,
      composerModelCatalog: routerCatalog, composerReasoningDiscovery: null
    })
    await actions.refreshComposerReasoningDiscovery()
    expect(state.composerReasoningEffort).toBe('medium')
  })

  it('clears a saved effort for a binding that explicitly declares reasoning unsupported', () => {
    const { state } = buildHarness({
      activeAgentRuntime: 'codex', modelAccessMode: 'api', composerModel: '',
      composerReasoningEffort: 'medium', composerModelGroups: modelGroups,
      composerReasoningDiscovery: {
        key: composerReasoningDiscoveryKey(routerEntry), status: 'ready', message: null,
        outcome: discovered({ state: 'unsupported', levels: [], attachEffort: false })
      }
    })
    expect(reconcileStoredReasoningEffort(state)).toMatchObject({
      composerReasoningEffort: '', composerReasoningEffortReset: { from: 'medium', to: '' }
    })
  })

  it('keeps a declared stored effort without a notice', () => {
    const { state } = buildHarness({
      composerModel: 'declared-model',
      composerReasoningEffort: 'high',
      composerModelCatalog: routerCatalog
    })
    expect(reconcileStoredReasoningEffort(state)).toEqual({})
  })

  it('stores an explicit effort as chosen, including clearing it, and drops the notice', () => {
    const { actions, state } = buildHarness({
      composerModel: 'router-model',
      composerReasoningEffort: '',
      composerModelCatalog: routerCatalog,
      composerReasoningEffortReset: { from: 'medium', to: '' }
    })

    actions.setComposerReasoningEffort('xhigh')
    expect(state.composerReasoningEffort).toBe('xhigh')
    expect(state.composerReasoningEffortReset).toBeNull()

    actions.setComposerReasoningEffort('')
    expect(state.composerReasoningEffort).toBe('')
    expect(state.conversationSettingsByThread['desktop-thread']?.reasoningEffort).toBe('')
  })

  it('keeps temporary conversation choices isolated from global defaults', () => {
    const { actions, state } = buildHarness({
      activeThreadId: 'thread-one',
      conversationSettingsByThread: {
        'thread-one': {
          model: 'runtime-default',
          reasoningEffort: 'medium',
          serviceTier: 'default'
        }
      }
    })

    actions.setComposerModel('runtime-temporary')
    actions.setComposerReasoningEffort('ultra')
    actions.setComposerServiceTier('priority')

    expect(state.conversationSettingsByThread['thread-one']).toEqual({
      model: 'runtime-temporary',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    })
    expect(state.composerModel).toBe('runtime-temporary')
    expect(state.composerReasoningEffort).toBe('ultra')
    expect(state.composerServiceTier).toBe('priority')

    actions.setComposerServiceTier('')
    expect(state.composerServiceTier).toBe('')
    expect(state.conversationSettingsByThread['thread-one']?.serviceTier).toBe('')
  })
})
