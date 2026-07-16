import { describe, expect, it, vi } from 'vitest'
import {
  defaultModelRouterSettings,
  type AppSettingsV1
} from '../../../../src/shared/app-settings'
import { buildEvidenceDagLaunch, ensureEvidenceDagSidecar } from './sidecar'

function settings(): AppSettingsV1 {
  return {
    evidenceDag: { enabled: true },
    modelRouter: {
      ...defaultModelRouterSettings(),
      runtimeApiKey: 'router-runtime-key',
      publicModelAlias: 'sciforge-router'
    }
  } as AppSettingsV1
}

describe('Evidence DAG sidecar launch', () => {
  it('does not spawn while the app feature is disabled', async () => {
    const spawnImpl = vi.fn()
    await ensureEvidenceDagSidecar(
      { ...settings(), evidenceDag: { enabled: false } },
      { userDataDir: '/tmp/sciforge', spawnImpl: spawnImpl as never }
    )
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('routes LLM configuration only through Model Router env', () => {
    const result = buildEvidenceDagLaunch(settings(), {
      userDataDir: '/tmp/sciforge',
      appRoot: '/app/root',
      env: {
        EDAG_LLM_BASE_URL: 'https://provider.example/v1',
        EDAG_LLM_API_KEY: 'provider-key'
      } as NodeJS.ProcessEnv,
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.env.EDAG_MODEL_ROUTER_BASE_URL).toBe('http://127.0.0.1:3892/v1')
    expect(result.launch.env.EDAG_MODEL_ROUTER_API_KEY).toBe('router-runtime-key')
    expect(result.launch.env.EDAG_MODEL_ROUTER_MODEL).toBe('sciforge-router')
    expect(result.launch.env.EDAG_MODEL_ROUTER_TIMEOUT_S).toBe('180')
    expect(result.launch.env.EDAG_MODEL_ROUTER_MAX_ATTEMPTS).toBe('1')
    expect(result.launch.env.SCIFORGE_EVIDENCE_DAG_API_KEY).toMatch(/^edag-/)
    expect(result.launch.env.EDAG_LLM_BASE_URL).toBeUndefined()
    expect(result.launch.env.EDAG_LLM_API_KEY).toBeUndefined()
  })

  it('preserves explicit Model Router timeout and retry tuning', () => {
    const result = buildEvidenceDagLaunch(settings(), {
      userDataDir: '/tmp/sciforge',
      env: {
        EDAG_MODEL_ROUTER_TIMEOUT_S: '20',
        EDAG_MODEL_ROUTER_MAX_ATTEMPTS: '2'
      } as NodeJS.ProcessEnv,
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.env.EDAG_MODEL_ROUTER_TIMEOUT_S).toBe('20')
    expect(result.launch.env.EDAG_MODEL_ROUTER_MAX_ATTEMPTS).toBe('2')
  })

  it('keeps the generated Evidence DAG token stable for a Model Router runtime key', () => {
    const first = buildEvidenceDagLaunch(settings(), {
      userDataDir: '/tmp/sciforge',
      env: {} as NodeJS.ProcessEnv,
      npmCommand: 'npm'
    })
    const second = buildEvidenceDagLaunch(settings(), {
      userDataDir: '/tmp/sciforge',
      env: {} as NodeJS.ProcessEnv,
      npmCommand: 'npm'
    })

    expect(first.ok && first.launch.runtimeToken).toBe(second.ok && second.launch.runtimeToken)
  })
})
