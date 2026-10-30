import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId } from '@shared/app-settings'
import * as modelUsage from './use-model-usage'

type AgentRuntimeUsage = (input: unknown) => Promise<unknown>

function setAgentRuntimeUsage(agentRuntimeUsage: AgentRuntimeUsage): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sciforge: {
        agentRuntime: {
          usage: agentRuntimeUsage
        }
      }
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('model usage helpers', () => {
  it('builds a semantic model usage query without exposing local runtime endpoints', () => {
    expect(
      (modelUsage as unknown as {
        buildModelUsageQuery(range: unknown, runtimeId?: AgentRuntimeId): unknown
      }).buildModelUsageQuery({
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      })
    ).toEqual({
      groupBy: 'model',
      from: '2026-05-01',
      to: '2026-05-31',
      timezone: 'Asia/Shanghai'
    })
    expect(
      (modelUsage as unknown as {
        buildModelUsageQuery(range: unknown, runtimeId?: AgentRuntimeId): unknown
      }).buildModelUsageQuery({
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      }, 'codex')
    ).toEqual({
      runtimeId: 'codex',
      groupBy: 'model',
      from: '2026-05-01',
      to: '2026-05-31',
      timezone: 'Asia/Shanghai'
    })
  })

  it('normalizes model buckets and daily chart buckets', () => {
    const normalized = modelUsage.normalizeModelUsageResponse({
      groupBy: 'model',
      from: '2026-05-01',
      to: '2026-05-02',
      timezone: 'UTC',
      buckets: [
        {
          model: 'Opus 4.8',
          inputTokens: 100,
          outputTokens: 30,
          totalTokens: 130,
          cacheSavingsUsd: 0.006,
          cacheSavingsCny: 0.0432,
          tokenEconomySavingsTokens: 2048,
          tokenEconomySavingsUsd: 0.0009,
          tokenEconomySavingsCny: 0.0063,
          turns: 2,
          threadCount: 1,
          cacheHitRate: 0.5
        }
      ],
      days: [
        { date: '2026-05-01', totalTokens: 130, turns: 2 },
        { date: '2026-05-02', totalTokens: 0, turns: 0 }
      ],
      totals: { totalTokens: 130, turns: 2, days: 2, activeDays: 1, threadCount: 1 }
    })

    expect(normalized.buckets[0]).toMatchObject({
      model: 'Opus 4.8',
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
      cacheSavingsUsd: 0.006,
      cacheSavingsCny: 0.0432,
      tokenEconomySavingsTokens: 2048,
      tokenEconomySavingsUsd: 0.0009,
      tokenEconomySavingsCny: 0.0063,
      turns: 2,
      threadCount: 1,
      cacheHitRate: 0.5
    })
    expect(normalized.days.map((bucket) => bucket.date)).toEqual(['2026-05-01', '2026-05-02'])
    expect(normalized.totals.activeDays).toBe(1)
  })

  it('loads model usage from the neutral agent runtime bridge', async () => {
    const agentRuntimeUsage = vi.fn<AgentRuntimeUsage>(async () => ({
      supported: true,
      groupBy: 'model',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC',
      buckets: [{ model: 'Opus 4.8', totalTokens: 10, turns: 1 }],
      days: [{ date: '2026-05-01', totalTokens: 10, turns: 1 }],
      totals: { totalTokens: 10, turns: 1, days: 1, activeDays: 1 }
    }))
    setAgentRuntimeUsage(agentRuntimeUsage)

    const loaded = await modelUsage.loadModelUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' }, 'codex')

    expect(loaded?.buckets[0]?.model).toBe('Opus 4.8')
    expect(agentRuntimeUsage).toHaveBeenCalledWith({
      runtimeId: 'codex',
      groupBy: 'model',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC'
    })
  })

  it('returns null when the active runtime reports model usage as unsupported', async () => {
    setAgentRuntimeUsage(async () => ({
      supported: false,
      reason: 'usage unsupported',
      groupBy: 'model',
      buckets: [],
      days: [],
      totals: {}
    }))

    await expect(
      modelUsage.loadModelUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })
    ).resolves.toBeNull()
  })
})
