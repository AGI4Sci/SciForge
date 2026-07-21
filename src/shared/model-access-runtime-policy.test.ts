import { describe, expect, it } from 'vitest'
import type { AgentRuntimeId, AppSettingsV1 } from './app-settings-types'
import {
  modelAccessRuntimePolicyChanged,
  resolveModelAccessRuntimePolicy
} from './model-access-runtime-policy'

function settings(
  mode: 'api' | 'coding-plan' | undefined,
  activeRuntime: AgentRuntimeId,
  planAdapterId = ''
): AppSettingsV1 {
  return {
    activeAgentRuntime: activeRuntime,
    ...(mode ? { modelAccess: { mode, planAdapterId } } : {})
  } as AppSettingsV1
}

describe('model access runtime policy', () => {
  it.each([
    ['sciforge', { activeRuntime: 'codex', sciforge: false, codex: true, claude: false }],
    ['codex', { sciforge: false, codex: true, claude: false }],
    ['claude', { sciforge: false, codex: false, claude: true }]
  ] as const)('allows only a supported API-backed runtime for %s settings', (activeRuntime, expected) => {
    expect(resolveModelAccessRuntimePolicy(settings('api', activeRuntime))).toMatchObject(expected)
  })

  it('allows only the explicitly selected Codex plan adapter runtime', () => {
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'codex', 'codex')))
      .toMatchObject({ sciforge: false, claude: false, codex: true })
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'sciforge', 'codex')))
      .toMatchObject({ activeRuntime: 'codex', sciforge: false, claude: false, codex: true })
  })

  it('fails closed for missing access and unknown plan adapters', () => {
    expect(resolveModelAccessRuntimePolicy(settings(undefined, 'sciforge')))
      .toMatchObject({ sciforge: false, claude: false, codex: false })
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'codex', 'unknown')))
      .toMatchObject({ sciforge: false, claude: false, codex: false })
  })

  it('treats access mode, adapter, and active runtime changes as lifecycle changes', () => {
    const api = settings('api', 'sciforge')
    expect(modelAccessRuntimePolicyChanged(api, settings('coding-plan', 'codex', 'codex'))).toBe(true)
    expect(modelAccessRuntimePolicyChanged(api, settings('api', 'claude'))).toBe(true)
    expect(modelAccessRuntimePolicyChanged(
      settings('coding-plan', 'codex', 'codex'),
      settings('coding-plan', 'codex', 'unknown')
    )).toBe(true)
  })
})
