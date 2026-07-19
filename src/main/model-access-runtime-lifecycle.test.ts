import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId, AppSettingsV1 } from '../shared/app-settings'
import {
  managedLocalRuntimeAction,
  stopDisallowedAgentRuntimes
} from './model-access-runtime-lifecycle'

function settings(
  mode: 'api' | 'coding-plan',
  activeRuntime: AgentRuntimeId,
  planAdapterId = ''
): AppSettingsV1 {
  return {
    activeAgentRuntime: activeRuntime,
    modelAccess: { mode, planAdapterId },
    agents: { sciforge: { autoStart: true } }
  } as AppSettingsV1
}

describe('model access agent runtime lifecycle', () => {
  it('actively stops Kun and Claude when switching to the selected Codex plan', async () => {
    const stopSciforge = vi.fn(async () => undefined)
    const stopClaude = vi.fn(async () => undefined)
    const stopCodex = vi.fn(async () => undefined)

    await stopDisallowedAgentRuntimes(
      settings('coding-plan', 'codex', 'codex'),
      { stopSciforge, stopClaude, stopCodex }
    )

    expect(stopSciforge).toHaveBeenCalledOnce()
    expect(stopClaude).toHaveBeenCalledOnce()
    expect(stopCodex).not.toHaveBeenCalled()
  })

  it('does not fall back when the selected runtime and plan adapter disagree', async () => {
    const stopSciforge = vi.fn(async () => undefined)
    const stopClaude = vi.fn(async () => undefined)
    const stopCodex = vi.fn(async () => undefined)

    await stopDisallowedAgentRuntimes(
      settings('coding-plan', 'sciforge', 'codex'),
      { stopSciforge, stopClaude, stopCodex }
    )

    expect(stopSciforge).toHaveBeenCalledOnce()
    expect(stopClaude).toHaveBeenCalledOnce()
    expect(stopCodex).toHaveBeenCalledOnce()
  })

  it('keeps later MCP synchronization from restarting a stale Kun runtime', () => {
    const plan = settings('coding-plan', 'codex', 'codex')
    expect(managedLocalRuntimeAction(plan, {
      running: true,
      configurationChanged: true,
      hasApiKey: true
    })).toBe('stop')
    expect(managedLocalRuntimeAction(plan, {
      running: false,
      configurationChanged: true,
      hasApiKey: true
    })).toBe('none')
  })

  it('restarts Kun only for selected API mode with complete configuration', () => {
    expect(managedLocalRuntimeAction(settings('api', 'sciforge'), {
      running: true,
      configurationChanged: true,
      hasApiKey: true
    })).toBe('restart')
    expect(managedLocalRuntimeAction(settings('api', 'claude'), {
      running: true,
      configurationChanged: true,
      hasApiKey: true
    })).toBe('stop')
  })
})
