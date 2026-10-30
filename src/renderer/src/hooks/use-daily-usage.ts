import { useEffect, useState } from 'react'
import type { AgentRuntimeId } from '@shared/agent-runtime-contract'

export const DEFAULT_USAGE_HEATMAP_DAYS = 90

export type DailyUsageBucket = {
  date: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  totalTokens: number
  costUsd: number
  costCny: number | null
  cacheSavingsUsd: number
  cacheSavingsCny: number | null
  tokenEconomySavingsTokens: number
  tokenEconomySavingsUsd: number
  tokenEconomySavingsCny: number | null
  turns: number
  threadCount: number
  cacheHitRate: number | null
}

export type DailyUsageTotals = Omit<DailyUsageBucket, 'date'> & {
  days: number
  activeDays: number
}

export type DailyUsageSummary = {
  groupBy: 'day'
  from: string
  to: string
  timezone: string
  buckets: DailyUsageBucket[]
  totals: DailyUsageTotals
}

export type DailyUsageState = {
  usage: DailyUsageSummary | null
  loading: boolean
  loaded: boolean
  error: string | null
}

type RawDailyUsageBucket = {
  date?: unknown
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
}

type RawDailyUsageResponse = {
  supported?: unknown
  groupBy?: unknown
  group_by?: unknown
  from?: unknown
  to?: unknown
  timezone?: unknown
  buckets?: unknown
  totals?: unknown
}

export type DailyUsageRange = {
  from: string
  to: string
  timezone: string
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

function dateStringFromParts(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return date.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function defaultDailyUsageRange(now = new Date(), days = DEFAULT_USAGE_HEATMAP_DAYS): DailyUsageRange {
  const timezone = clientTimezone()
  const rangeDays = Math.max(7, Math.round(days))
  const to = dateStringFromParts(now, timezone)
  return {
    from: addDays(to, -(rangeDays - 1)),
    to,
    timezone
  }
}

export function buildDailyUsageQuery(range: DailyUsageRange, runtimeId?: AgentRuntimeId): {
  runtimeId?: AgentRuntimeId
  groupBy: 'day'
  from: string
  to: string
  timezone: string
} {
  return {
    ...(runtimeId ? { runtimeId } : {}),
    groupBy: 'day',
    from: range.from,
    to: range.to,
    timezone: range.timezone
  }
}

function rawValue<T extends Record<string, unknown>>(raw: T, camel: keyof T, snake: keyof T): unknown {
  return raw[camel] ?? raw[snake]
}

function normalizeBucket(raw: RawDailyUsageBucket): DailyUsageBucket {
  const date = typeof raw.date === 'string' ? raw.date : ''
  const inputTokens = usageNumber(rawValue(raw, 'inputTokens', 'input_tokens'))
  const outputTokens = usageNumber(rawValue(raw, 'outputTokens', 'output_tokens'))
  const totalTokens = usageNumber(rawValue(raw, 'totalTokens', 'total_tokens')) || inputTokens + outputTokens
  return {
    date,
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

function normalizeTotals(raw: RawDailyUsageBucket & { days?: unknown; activeDays?: unknown; active_days?: unknown }): DailyUsageTotals {
  const bucket = normalizeBucket({ ...raw, date: 'totals' })
  return {
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    reasoningTokens: bucket.reasoningTokens,
    cachedTokens: bucket.cachedTokens,
    cacheMissTokens: bucket.cacheMissTokens,
    totalTokens: bucket.totalTokens,
    costUsd: bucket.costUsd,
    costCny: bucket.costCny,
    cacheSavingsUsd: bucket.cacheSavingsUsd,
    cacheSavingsCny: bucket.cacheSavingsCny,
    tokenEconomySavingsTokens: bucket.tokenEconomySavingsTokens,
    tokenEconomySavingsUsd: bucket.tokenEconomySavingsUsd,
    tokenEconomySavingsCny: bucket.tokenEconomySavingsCny,
    turns: bucket.turns,
    threadCount: bucket.threadCount,
    cacheHitRate: bucket.cacheHitRate,
    days: usageNumber(raw.days),
    activeDays: usageNumber(rawValue(raw, 'activeDays', 'active_days'))
  }
}

export function normalizeDailyUsageResponse(raw: RawDailyUsageResponse): DailyUsageSummary {
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets
        .map((item) => normalizeBucket((item ?? {}) as RawDailyUsageBucket))
        .filter((bucket) => bucket.date)
    : []
  return {
    groupBy: 'day',
    from: typeof raw.from === 'string' ? raw.from : buckets[0]?.date ?? '',
    to: typeof raw.to === 'string' ? raw.to : buckets[buckets.length - 1]?.date ?? '',
    timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone : clientTimezone(),
    buckets,
    totals: normalizeTotals((raw.totals ?? {}) as RawDailyUsageBucket & { days?: unknown; activeDays?: unknown; active_days?: unknown })
  }
}

export async function loadDailyUsage(
  range: DailyUsageRange,
  runtimeId?: AgentRuntimeId
): Promise<DailyUsageSummary | null> {
  if (typeof window.sciforge?.agentRuntime?.usage !== 'function') return null
  const parsed = await window.sciforge.agentRuntime.usage(buildDailyUsageQuery(range, runtimeId)) as RawDailyUsageResponse
  if (parsed.supported === false) return null
  if ((parsed.groupBy ?? parsed.group_by) !== 'day') {
    throw new Error('daily usage response did not use day grouping')
  }
  return normalizeDailyUsageResponse(parsed)
}

export function useDailyUsageState(
  enabled: boolean,
  refreshKey: unknown,
  days = DEFAULT_USAGE_HEATMAP_DAYS,
  runtimeId?: AgentRuntimeId
): DailyUsageState {
  const shouldLoad = enabled
  const [state, setState] = useState<DailyUsageState>({
    usage: null,
    loading: false,
    loaded: false,
    error: null
  })

  useEffect(() => {
    let cancelled = false
    if (!shouldLoad) {
      setState({ usage: null, loading: false, loaded: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    const range = defaultDailyUsageRange(new Date(), days)
    void loadDailyUsage(range, runtimeId)
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
  }, [days, refreshKey, runtimeId, shouldLoad])

  return state
}
