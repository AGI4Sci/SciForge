import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId, AppSettingsV1 } from '../shared/app-settings'
import { stopDisallowedAgentRuntimes } from './model-access-runtime-lifecycle'

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
  it('actively stops Claude and DSH when switching to the selected Codex plan', async () => {
    const stopClaude = vi.fn(async () => undefined)
    const stopCodex = vi.fn(async () => undefined)
    const stopDsh = vi.fn(async () => undefined)

    await stopDisallowedAgentRuntimes(
      settings('coding-plan', 'codex', 'codex'),
      { stopClaude, stopCodex, stopDsh }
    )

    expect(stopClaude).toHaveBeenCalledOnce()
    expect(stopCodex).not.toHaveBeenCalled()
    expect(stopDsh).toHaveBeenCalledOnce()
  })

  it('normalizes a retired runtime selection to the Codex plan adapter', async () => {
    const stopClaude = vi.fn(async () => undefined)
    const stopCodex = vi.fn(async () => undefined)
    const stopDsh = vi.fn(async () => undefined)

    const retiredSelection = {
      ...settings('coding-plan', 'codex', 'codex'),
      activeAgentRuntime: 'retired-runtime'
    } as unknown as AppSettingsV1

    await stopDisallowedAgentRuntimes(
      settings('coding-plan', 'sciforge' as unknown as AgentRuntimeId, 'codex'),
      { stopClaude, stopCodex, stopDsh }
    )

    expect(stopClaude).toHaveBeenCalledOnce()
    expect(stopCodex).not.toHaveBeenCalled()
    expect(stopDsh).toHaveBeenCalledOnce()
  })

  it('keeps only the selected Claude adapter running in API mode', async () => {
    const stopClaude = vi.fn(async () => undefined)
    const stopCodex = vi.fn(async () => undefined)
    const stopDsh = vi.fn(async () => undefined)

    await stopDisallowedAgentRuntimes(
      settings('api', 'claude'),
      { stopClaude, stopCodex, stopDsh }
    )

    expect(stopClaude).not.toHaveBeenCalled()
    expect(stopCodex).toHaveBeenCalledOnce()
    expect(stopDsh).toHaveBeenCalledOnce()
  })

  it('keeps the selected DSH adapter running in API mode', async () => {
    const stopClaude = vi.fn(async () => undefined)
    const stopCodex = vi.fn(async () => undefined)
    const stopDsh = vi.fn(async () => undefined)

    await stopDisallowedAgentRuntimes(
      settings('api', 'dsh'),
      { stopClaude, stopCodex, stopDsh }
    )

    expect(stopClaude).toHaveBeenCalledOnce()
    expect(stopCodex).toHaveBeenCalledOnce()
    expect(stopDsh).not.toHaveBeenCalled()
  })
})
