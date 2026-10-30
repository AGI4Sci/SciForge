import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { ReasoningDiscovery } from './reasoning-discovery'
import { createUpstreamReasoningDeclarationProvider } from './upstream-declaration'

function settings(): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.profiles.default.textReasoner.model = 'private-text-model'
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter: {
      ...modelRouter,
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function listingResponse(levels: Array<{ effort: string; description: string }>): Response {
  return new Response(JSON.stringify({
    object: 'list',
    data: [{
      id: 'sciforge-router',
      object: 'model',
      default_reasoning_level: null,
      supported_reasoning_levels: levels
    }]
  }), { status: 200 })
}

describe('upstream reasoning declaration provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('turns a declared listing into a declared outcome for the real model and the alias', async () => {
    vi.stubGlobal('fetch', async () => listingResponse([
      { effort: 'high', description: 'Declared reasoning effort for this connection' },
      { effort: 'low', description: 'Declared reasoning effort for this connection' }
    ]))
    const provider = createUpstreamReasoningDeclarationProvider({ loadSettings: () => settings() })

    const byRealModel = await provider({
      provider: 'model-router',
      model: 'private-text-model',
      protocol: 'auto',
      endpoint: ''
    })
    expect(byRealModel).toMatchObject({ kind: 'declared', levels: [{ id: 'high' }, { id: 'low' }] })
    expect((byRealModel as { observedAt?: string }).observedAt).toBeTruthy()

    const byAlias = await provider({
      provider: 'model-router',
      model: 'sciforge-router',
      protocol: 'auto',
      endpoint: ''
    })
    expect(byAlias).toMatchObject({ kind: 'declared' })
  })

  it('treats an undeclared listing as unknown, never as unsupported', async () => {
    vi.stubGlobal('fetch', async () => listingResponse([]))
    const provider = createUpstreamReasoningDeclarationProvider({ loadSettings: () => settings() })

    await expect(provider({
      provider: 'model-router',
      model: 'private-text-model',
      protocol: 'auto',
      endpoint: ''
    })).resolves.toEqual({ kind: 'unknown' })
  })

  it('throws when the listing cannot be observed, so discovery retries instead of caching a failure', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection refused')
    })
    const provider = createUpstreamReasoningDeclarationProvider({ loadSettings: () => settings() })
    await expect(provider({
      provider: 'model-router',
      model: 'private-text-model',
      protocol: 'auto',
      endpoint: ''
    })).rejects.toThrow(/connection refused/u)

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const offBindingProvider = createUpstreamReasoningDeclarationProvider({ loadSettings: () => settings() })
    await expect(offBindingProvider({
      provider: 'model-router',
      model: 'some-other-model',
      protocol: 'auto',
      endpoint: ''
    })).resolves.toEqual({ kind: 'unknown' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('feeds discovery end to end: a declared listing wins, failures stay unknown and retry', async () => {
    let fail = true
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      if (fail) throw new Error('temporary failure')
      return listingResponse([{ effort: 'high', description: 'Declared reasoning effort for this connection' }])
    })
    const discovery = new ReasoningDiscovery({
      declarationProvider: createUpstreamReasoningDeclarationProvider({ loadSettings: () => settings() })
    })
    const query = { provider: 'model-router', model: 'private-text-model', protocol: 'auto', endpoint: '' }

    const degraded = await discovery.discover(query)
    expect(degraded.state).toBe('unknown')
    expect(calls).toBe(1)

    fail = false
    const declared = await discovery.discover(query)
    expect(declared.state).toBe('known')
    expect(declared.source).toBe('upstream')
    expect(declared.levels).toEqual(['high'])
    expect(calls).toBe(2)
  })
})