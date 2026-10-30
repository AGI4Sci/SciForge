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
  it('authorizes DSH only for its selected API route, never Codex or Claude', () => {
    expect(resolveModelAccessRuntimePolicy(settings('api', 'dsh'))).toMatchObject({ dsh: true, codex: false, claude: false })
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'dsh', 'codex'))).toMatchObject({ dsh: false, codex: false, claude: false })
    expect(resolveModelAccessRuntimePolicy(settings(undefined, 'dsh'))).toMatchObject({ dsh: false })
  })
  it.each([
    ['codex', { codex: true, claude: false, dsh: false }],
    ['claude', { codex: false, claude: true, dsh: false }],
    ['dsh', { codex: false, claude: false, dsh: true }]
  ] as const)('allows only a supported API-backed runtime for %s settings', (activeRuntime, expected) => {
    expect(resolveModelAccessRuntimePolicy(settings('api', activeRuntime))).toMatchObject(expected)
  })

  it('allows only the explicitly selected Codex plan adapter runtime', () => {
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'codex', 'codex')))
      .toMatchObject({ claude: false, codex: true, dsh: false })
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'claude', 'codex')))
      .toMatchObject({ activeRuntime: 'claude', codex: false, claude: false, dsh: false })
  })

  it('fails closed for DSH under coding-plan access until its capability statement lands', () => {
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'dsh', 'codex')))
      .toMatchObject({ activeRuntime: 'dsh', mode: 'coding-plan', codex: false, claude: false, dsh: false })
  })

  it('fails closed for missing access and unknown plan adapters', () => {
    expect(resolveModelAccessRuntimePolicy(settings(undefined, 'claude')))
      .toMatchObject({ claude: false, codex: false, dsh: false })
    expect(resolveModelAccessRuntimePolicy(settings('coding-plan', 'codex', 'unknown')))
      .toMatchObject({ codex: false, claude: false, dsh: false })
  })

  it('treats access mode, adapter, and active runtime changes as lifecycle changes', () => {
    const api = settings('api', 'dsh')
    expect(modelAccessRuntimePolicyChanged(api, settings('coding-plan', 'codex', 'codex'))).toBe(true)
    expect(modelAccessRuntimePolicyChanged(api, settings('api', 'claude'))).toBe(true)
    expect(modelAccessRuntimePolicyChanged(
      settings('coding-plan', 'codex', 'codex'),
      settings('coding-plan', 'codex', 'unknown')
    )).toBe(true)
  })
})
