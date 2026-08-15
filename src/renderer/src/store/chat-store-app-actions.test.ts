import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'

afterEach(() => vi.unstubAllGlobals())

function buildHarness(initialState: Partial<ChatState> = {}) {
  const state = {
    route: 'chat',
    activeThreadId: 'desktop-thread',
    refreshThreads: vi.fn(async () => undefined),
    loadComposerModels: vi.fn(async () => undefined),
    applyI18nFromSettings: vi.fn(async () => undefined),
    composerModel: '',
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
    persistComposerModel: vi.fn(),
    readStoredComposerModel: vi.fn(() => ''),
    mergeComposerPickList: vi.fn(() => []),
    getComposerModelLoadPromise: vi.fn(() => null),
    setComposerModelLoadPromise: vi.fn(),
    applyTheme: vi.fn(),
    applyUiFontScale: vi.fn(),
    applyDocumentLocale: vi.fn(),
    workspaceLabelFromPath: vi.fn((workspaceRoot: string) => workspaceRoot),
    normalizeWorkspaceRoot: vi.fn((workspaceRoot?: string | null) => workspaceRoot?.trim() ?? '')
  })
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

    const task = actions.setActiveAgentRuntime('sciforge')
    expect(state.activeAgentRuntime).toBe('sciforge')
    expect(state.runtimeConnection).toBe('checking')
    expect(state.error).toBeNull()
    deferred.resolve({ activeAgentRuntime: 'sciforge' } as AppSettingsV1)
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

    await actions.setActiveAgentRuntime('sciforge')
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

    await actions.setActiveAgentRuntime('sciforge')
    expect(state.activeAgentRuntime).toBe('codex')
    expect(state.error).toBe('Codex Plan requires the Codex runtime.')
    expect(setSettings).not.toHaveBeenCalled()
  })
})
