import { useEffect, useState } from 'react'
import type { AgentRuntimeId } from '@shared/agent-runtime-contract'
import {
  type DailyUsageBucket,
  type DailyUsageRange,
  defaultDailyUsageRange
} from './use-daily-usage'

export type ModelUsageBucket = Omit<DailyUsageBucket, 'date'> & {
  model: string
}

export type ModelUsageSummary = {
  groupBy: 'model'
  from: string
  to: string
  timezone: string
  buckets: ModelUsageBucket[]
  days: DailyUsageBucket[]
  totals: Omit<DailyUsageBucket, 'date'> & {
    days: number
    activeDays: number
  }
}

export type ModelUsageState = {
  usage: ModelUsageSummary | null
  loading: boolean
  loaded: boolean
  error: string | null
}

type RawUsageCounters = {
  inputTokens?: unknown
  input_tokens?: unknown
  outputTokens?: unknown
  output_tokens?: unknown
  reasoningTokens?: unknown
  reasoning_tokens?: unknown
  cachedTokens?: unknown
  cached_tokens?: unknown
  cacheMissTokens?: unknown
  cache_miss_tokens?: unknown
  totalTokens?: unknown
  total_tokens?: unknown
  costUsd?: unknown
  cost_usd?: unknown
  costCny?: unknown
  cost_cny?: unknown
  cacheSavingsUsd?: unknown
  cache_savings_usd?: unknown
  cacheSavingsCny?: unknown
  cache_savings_cny?: unknown
  tokenEconomySavingsTokens?: unknown
  token_economy_savings_tokens?: unknown
  tokenEconomySavingsUsd?: unknown
  token_economy_savings_usd?: unknown
  tokenEconomySavingsCny?: unknown
  token_economy_savings_cny?: unknown
  turns?: unknown
  threadCount?: unknown
  thread_count?: unknown
  cacheHitRate?: unknown
  cache_hit_rate?: unknown
  activeDays?: unknown
  active_days?: unknown
}

type RawModelUsageBucket = RawUsageCounters & {
  model?: unknown
}

type RawModelUsageDayBucket = RawUsageCounters & {
  date?: unknown
}

type RawModelUsageResponse = {
  supported?: unknown
  groupBy?: unknown
  group_by?: unknown
  from?: unknown
  to?: unknown
  timezone?: unknown
  buckets?: unknown
  days?: unknown
  totals?: unknown
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function usageRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

function rawValue<T extends Record<string, unknown>>(raw: T, camel: keyof T, snake: keyof T): unknown {
  return raw[camel] ?? raw[snake]
}

function normalizeCounters(raw: RawUsageCounters): Omit<DailyUsageBucket, 'date'> {
  const inputTokens = usageNumber(rawValue(raw, 'inputTokens', 'input_tokens'))
  const outputTokens = usageNumber(rawValue(raw, 'outputTokens', 'output_tokens'))
  const totalTokens = usageNumber(rawValue(raw, 'totalTokens', 'total_tokens')) || inputTokens + outputTokens
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: usageNumber(rawValue(raw, 'reasoningTokens', 'reasoning_tokens')),
    cachedTokens: usageNumber(rawValue(raw, 'cachedTokens', 'cached_tokens')),
    cacheMissTokens: usageNumber(rawValue(raw, 'cacheMissTokens', 'cache_miss_tokens')),
    totalTokens,
    costUsd: usageNumber(rawValue(raw, 'costUsd', 'cost_usd')),
    costCny: usageOptionalNumber(rawValue(raw, 'costCny', 'cost_cny')),
    cacheSavingsUsd: usageNumber(rawValue(raw, 'cacheSavingsUsd', 'cache_savings_usd')),
    cacheSavingsCny: usageOptionalNumber(rawValue(raw, 'cacheSavingsCny', 'cache_savings_cny')),
    tokenEconomySavingsTokens: usageNumber(rawValue(raw, 'tokenEconomySavingsTokens', 'token_economy_savings_tokens')),
    tokenEconomySavingsUsd: usageNumber(rawValue(raw, 'tokenEconomySavingsUsd', 'token_economy_savings_usd')),
    tokenEconomySavingsCny: usageOptionalNumber(rawValue(raw, 'tokenEconomySavingsCny', 'token_economy_savings_cny')),
    turns: usageNumber(raw.turns),
    threadCount: usageNumber(rawValue(raw, 'threadCount', 'thread_count')),
    cacheHitRate: usageRate(rawValue(raw, 'cacheHitRate', 'cache_hit_rate'))
  }
}

function normalizeModelBucket(raw: RawModelUsageBucket): ModelUsageBucket {
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'unknown'
  return {
    model,
    ...normalizeCounters(raw)
  }
}

function normalizeDayBucket(raw: RawModelUsageDayBucket): DailyUsageBucket {
  return {
    date: typeof raw.date === 'string' ? raw.date : '',
    ...normalizeCounters(raw)
  }
}

function normalizeTotals(raw: RawUsageCounters & { days?: unknown }): ModelUsageSummary['totals'] {
  return {
    ...normalizeCounters(raw),
    days: usageNumber(raw.days),
    activeDays: usageNumber(rawValue(raw, 'activeDays', 'active_days'))
  }
}

export function buildModelUsageQuery(range: DailyUsageRange, runtimeId?: AgentRuntimeId): {
  runtimeId?: AgentRuntimeId
  groupBy: 'model'
  from: string
  to: string
  timezone: string
} {
  return {
    ...(runtimeId ? { runtimeId } : {}),
    groupBy: 'model',
    from: range.from,
    to: range.to,
    timezone: range.timezone
  }
}

export function normalizeModelUsageResponse(raw: RawModelUsageResponse): ModelUsageSummary {
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets.map((item) => normalizeModelBucket((item ?? {}) as RawModelUsageBucket))
    : []
  const days = Array.isArray(raw.days)
    ? raw.days
        .map((item) => normalizeDayBucket((item ?? {}) as RawModelUsageDayBucket))
        .filter((bucket) => bucket.date)
    : []
  return {
    groupBy: 'model',
    from: typeof raw.from === 'string' ? raw.from : days[0]?.date ?? '',
    to: typeof raw.to === 'string' ? raw.to : days[days.length - 1]?.date ?? '',
    timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone : '',
    buckets,
    days,
    totals: normalizeTotals((raw.totals ?? {}) as RawUsageCounters & { days?: unknown; active_days?: unknown })
  }
}

export async function loadModelUsage(
  range: DailyUsageRange,
  runtimeId?: AgentRuntimeId
): Promise<ModelUsageSummary | null> {
  if (typeof window.sciforge?.agentRuntime?.usage !== 'function') return null
  const parsed = await window.sciforge.agentRuntime.usage(buildModelUsageQuery(range, runtimeId)) as RawModelUsageResponse
  if (parsed.supported === false) return null
  if ((parsed.groupBy ?? parsed.group_by) !== 'model') {
    throw new Error('model usage response did not use model grouping')
  }
  return normalizeModelUsageResponse(parsed)
}

export function useModelUsageState(
  enabled: boolean,
  refreshKey: unknown,
  days: number,
  runtimeId?: AgentRuntimeId
): ModelUsageState {
  const [state, setState] = useState<ModelUsageState>({
    usage: null,
    loading: false,
    loaded: false,
    error: null
  })

  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setState({ usage: null, loading: false, loaded: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    const range = defaultDailyUsageRange(new Date(), days)
    void loadModelUsage(range, runtimeId)
      .then((usage) => {
        if (!cancelled) setState({ usage, loading: false, loaded: true, error: null })
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setState({ usage: null, loading: false, loaded: true, error: message })
        }
      })
    return () => {
      cancelled = true
    }
  }, [days, enabled, refreshKey, runtimeId])

  return state
}
