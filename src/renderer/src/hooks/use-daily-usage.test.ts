import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId } from '@shared/app-settings'
import * as dailyUsage from './use-daily-usage'

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

describe('daily usage helpers', () => {
  it('builds the default 90-day range ending on the current client date', () => {
    const range = dailyUsage.defaultDailyUsageRange(new Date('2026-06-01T12:00:00.000Z'))

    expect(range.from).toBe('2026-03-04')
    expect(range.to).toBe('2026-06-01')
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.timezone).toBeTruthy()
  })

  it('builds a semantic daily usage query without exposing local runtime endpoints', () => {
    expect(
      (dailyUsage as unknown as {
        buildDailyUsageQuery(range: dailyUsage.DailyUsageRange, runtimeId?: AgentRuntimeId): unknown
      }).buildDailyUsageQuery({
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      })
    ).toEqual({
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-31',
      timezone: 'Asia/Shanghai'
    })
    expect(
      (dailyUsage as unknown as {
        buildDailyUsageQuery(range: dailyUsage.DailyUsageRange, runtimeId?: AgentRuntimeId): unknown
      }).buildDailyUsageQuery({
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      }, 'codex')
    ).toEqual({
      runtimeId: 'codex',
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-31',
      timezone: 'Asia/Shanghai'
    })
  })

  it('normalizes buckets and totals into renderer naming', () => {
    const normalized = dailyUsage.normalizeDailyUsageResponse({
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC',
      buckets: [
        {
          date: '2026-05-01',
          inputTokens: 100,
          outputTokens: 30,
          totalTokens: 130,
          costUsd: 0.02,
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
      totals: {
        totalTokens: 130,
        cacheSavingsUsd: 0.006,
        tokenEconomySavingsTokens: 2048,
        tokenEconomySavingsUsd: 0.0009,
        turns: 2,
        threadCount: 1,
        days: 1,
        activeDays: 1
      }
    })

    expect(normalized.buckets[0]).toMatchObject({
      date: '2026-05-01',
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
    expect(normalized.totals.cacheSavingsUsd).toBe(0.006)
    expect(normalized.totals.tokenEconomySavingsTokens).toBe(2048)
    expect(normalized.totals.tokenEconomySavingsUsd).toBe(0.0009)
    expect(normalized.totals.activeDays).toBe(1)
  })

  it('loads daily usage from the neutral agent runtime bridge', async () => {
    const agentRuntimeUsage = vi.fn<AgentRuntimeUsage>(async () => ({
      supported: true,
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC',
      buckets: [{ date: '2026-05-01', totalTokens: 10, turns: 1 }],
      totals: { totalTokens: 10, turns: 1, days: 1, activeDays: 1 }
    }))
    setAgentRuntimeUsage(agentRuntimeUsage)

    const loaded = await dailyUsage.loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' }, 'codex')

    expect(loaded?.totals.totalTokens).toBe(10)
    expect(agentRuntimeUsage).toHaveBeenCalledWith({
      runtimeId: 'codex',
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC'
    })
  })

  it('loads an empty usage response without inventing activity', async () => {
    setAgentRuntimeUsage(async () => ({
      supported: true,
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC',
      buckets: [
        {
          date: '2026-05-01',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          turns: 0,
          threadCount: 0
        }
      ],
      totals: { totalTokens: 0, turns: 0, days: 1, activeDays: 0, threadCount: 0 }
    }))

    const loaded = await dailyUsage.loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })

    expect(loaded?.totals.activeDays).toBe(0)
    expect(loaded?.buckets[0]?.totalTokens).toBe(0)
  })

  it('returns null when the active runtime reports usage as unsupported', async () => {
    setAgentRuntimeUsage(async () => ({
      supported: false,
      reason: 'usage unsupported',
      groupBy: 'day',
      buckets: [],
      totals: {}
    }))

    await expect(
      dailyUsage.loadDailyUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })
    ).resolves.toBeNull()
  })
})
