import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildThreadUsageQuery, formatCost, loadThreadUsage } from './use-thread-usage'

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

describe('thread usage formatting', () => {
  it('builds runtime-scoped thread usage queries', () => {
    expect(buildThreadUsageQuery('codex', 'thread-1')).toEqual({
      runtimeId: 'codex',
      groupBy: 'thread',
      threadId: 'thread-1'
    })
  })

  it('uses RMB for Chinese locales and USD for English locales', () => {
    expect(formatCost(0.125, 'zh', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'zh-CN', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'en')).toBe('$0.1250')
  })

  it('keeps cache hit rate unknown for cachedTokens-only thread usage buckets', async () => {
    const agentRuntimeUsage = vi.fn<AgentRuntimeUsage>(async () => ({
      supported: true,
      groupBy: 'thread',
      buckets: [
        {
          threadId: 'thr_cached_only',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          cachedTokens: 42,
          cacheHitRate: null,
          turns: 1
        }
      ],
      totals: {}
    }))
    setAgentRuntimeUsage(agentRuntimeUsage)

    const usage = await loadThreadUsage('codex', 'thr_cached_only')

    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      cacheMissTokens: 0,
      cacheHitRate: null
    })
    expect(agentRuntimeUsage).toHaveBeenCalledWith({
      runtimeId: 'codex',
      groupBy: 'thread',
      threadId: 'thr_cached_only'
    })
  })

  it('uses explicit aggregate thread cache telemetry when available', async () => {
    setAgentRuntimeUsage(async () => ({
      supported: true,
      groupBy: 'thread',
      buckets: [
        {
          threadId: 'thr_aggregate_cache',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          cacheSavingsUsd: 0.003,
          cacheSavingsCny: 0.0216,
          tokenEconomySavingsTokens: 4096,
          tokenEconomySavingsUsd: 0.0018,
          tokenEconomySavingsCny: 0.0126,
          cachedTokens: 40,
          cacheMissTokens: 60,
          cacheHitRate: 0.4,
          turns: 1
        }
      ],
      totals: {}
    }))

    const usage = await loadThreadUsage('codex', 'thr_aggregate_cache')

    expect(usage).toMatchObject({
      cachedTokens: 40,
      cacheMissTokens: 60,
      cacheHitRate: 0.4,
      cacheSavingsUsd: 0.003,
      cacheSavingsCny: 0.0216,
      tokenEconomySavingsTokens: 4096,
      tokenEconomySavingsUsd: 0.0018,
      tokenEconomySavingsCny: 0.0126
    })
  })

  it('uses explicit thread cache hit and miss telemetry when available', async () => {
    setAgentRuntimeUsage(async () => ({
      supported: true,
      groupBy: 'thread',
      buckets: [
        {
          threadId: 'thr_native_cache',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          cachedTokens: 80,
          cacheMissTokens: 20,
          cacheHitRate: 0.8,
          turns: 1
        }
      ],
      totals: {}
    }))

    const usage = await loadThreadUsage('codex', 'thr_native_cache')

    expect(usage).toMatchObject({
      cachedTokens: 80,
      cacheMissTokens: 20,
      cacheHitRate: 0.8
    })
  })

  it('propagates neutral thread usage errors from the runtime bridge', async () => {
    setAgentRuntimeUsage(async () => {
      throw new Error('thread usage unavailable')
    })

    await expect(loadThreadUsage('codex', 'thr_error')).rejects.toThrow('thread usage unavailable')
  })

  it('returns null when the active runtime reports thread usage as unsupported', async () => {
    setAgentRuntimeUsage(async () => ({
      supported: false,
      reason: 'usage unsupported',
      groupBy: 'thread',
      buckets: [],
      totals: {}
    }))

    await expect(loadThreadUsage('codex', 'thr_unsupported')).resolves.toBeNull()
  })
})
