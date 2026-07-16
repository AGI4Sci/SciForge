import { useEffect, useState } from 'react'

const THREAD_USAGE_REFRESH_DEBOUNCE_MS = 400
const threadUsageLoads = new Map<string, Promise<ThreadUsageSummary | null>>()

export type ThreadUsageSummary = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  costCny: number | null
  cacheSavingsUsd: number
  cacheSavingsCny: number | null
  tokenEconomySavingsTokens: number
  tokenEconomySavingsUsd: number
  tokenEconomySavingsCny: number | null
  turns: number
}

export type ThreadUsageState = {
  usage: ThreadUsageSummary | null
  loading: boolean
  loaded: boolean
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

function field(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key]
  }
  return undefined
}

function fieldNumber(record: Record<string, unknown>, ...keys: string[]): number {
  return usageNumber(field(record, ...keys))
}

function hasNumber(record: Record<string, unknown>, ...keys: string[]): boolean {
  return typeof field(record, ...keys) === 'number' && Number.isFinite(field(record, ...keys))
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat().format(value)
}

function isChineseLocale(locale?: string): boolean {
  const normalized = (locale ?? '').trim().toLowerCase()
  return normalized === 'zh' || normalized.startsWith('zh-')
}

function fallbackLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en'
}

function formatMoneyValue(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  return safeValue.toFixed(safeValue >= 1 ? 2 : 4)
}

export function formatCost(costUsd: number, locale = fallbackLocale(), costCny?: number | null): string {
  if (isChineseLocale(locale)) {
    const safeUsd = Number.isFinite(costUsd) ? costUsd : 0
    const value = typeof costCny === 'number' && Number.isFinite(costCny) ? costCny : safeUsd * 7.2
    return `￥${formatMoneyValue(value)}`
  }
  return `$${formatMoneyValue(costUsd)}`
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const percent = Math.max(0, Math.min(100, value * 100))
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1)}%`
}

export function buildThreadUsageQuery(threadId: string): { groupBy: 'thread'; threadId: string } {
  return { groupBy: 'thread', threadId }
}

export async function loadThreadUsage(threadId: string): Promise<ThreadUsageSummary | null> {
  if (typeof window.sciforge?.agentRuntime?.usage !== 'function') return null
  const parsed = await window.sciforge.agentRuntime.usage(buildThreadUsageQuery(threadId)) as {
    supported?: unknown
    groupBy?: unknown
    group_by?: unknown
    buckets?: Array<Record<string, unknown>>
  }
  if (parsed.supported === false) return null
  if ((parsed.groupBy ?? parsed.group_by) !== 'thread') return null
  const bucket = parsed.buckets?.find((item) => {
    const candidates = [item.threadId, item.thread_id, item.key, item.id, item.label]
    return candidates.some((candidate) => candidate === threadId)
  })
  if (!bucket) return null
  const inputTokens = fieldNumber(bucket, 'inputTokens', 'input_tokens')
  const outputTokens = fieldNumber(bucket, 'outputTokens', 'output_tokens')
  const reasoningTokens = fieldNumber(bucket, 'reasoningTokens', 'reasoning_tokens')
  const bucketCacheHitRate = usageRate(field(bucket, 'cacheHitRate', 'cache_hit_rate'))
  const hasBucketCacheTelemetry = bucketCacheHitRate !== null
  const cachedTokens = hasBucketCacheTelemetry
    ? fieldNumber(bucket, 'cachedTokens', 'cached_tokens')
    : 0
  const cacheMissTokens = hasBucketCacheTelemetry
    ? fieldNumber(bucket, 'cacheMissTokens', 'cache_miss_tokens')
    : 0
  const cacheTotal = cachedTokens + cacheMissTokens
  const cacheHitRate = hasBucketCacheTelemetry && cacheTotal > 0 ? bucketCacheHitRate : bucketCacheHitRate
  const totalTokens = fieldNumber(bucket, 'totalTokens', 'total_tokens') || inputTokens + outputTokens
  const costUsd = fieldNumber(bucket, 'costUsd', 'cost_usd')
  const costCny = hasNumber(bucket, 'costCny', 'cost_cny') ? fieldNumber(bucket, 'costCny', 'cost_cny') : null
  const cacheSavingsUsd = fieldNumber(bucket, 'cacheSavingsUsd', 'cache_savings_usd')
  const cacheSavingsCny = hasNumber(bucket, 'cacheSavingsCny', 'cache_savings_cny')
    ? fieldNumber(bucket, 'cacheSavingsCny', 'cache_savings_cny')
    : null
  const tokenEconomySavingsTokens = fieldNumber(bucket, 'tokenEconomySavingsTokens', 'token_economy_savings_tokens')
  const tokenEconomySavingsUsd = fieldNumber(bucket, 'tokenEconomySavingsUsd', 'token_economy_savings_usd')
  const tokenEconomySavingsCny = hasNumber(bucket, 'tokenEconomySavingsCny', 'token_economy_savings_cny')
    ? fieldNumber(bucket, 'tokenEconomySavingsCny', 'token_economy_savings_cny')
    : null
  const turns = fieldNumber(bucket, 'turns')
  if (
    totalTokens <= 0 &&
    cachedTokens <= 0 &&
    costUsd <= 0 &&
    (costCny ?? 0) <= 0 &&
    cacheSavingsUsd <= 0 &&
    (cacheSavingsCny ?? 0) <= 0 &&
    tokenEconomySavingsTokens <= 0 &&
    tokenEconomySavingsUsd <= 0 &&
    (tokenEconomySavingsCny ?? 0) <= 0 &&
    turns <= 0
  ) return null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    totalTokens,
    costUsd,
    costCny,
    cacheSavingsUsd,
    cacheSavingsCny,
    tokenEconomySavingsTokens,
    tokenEconomySavingsUsd,
    tokenEconomySavingsCny,
    turns
  }
}

function loadThreadUsageSingleflight(threadId: string): Promise<ThreadUsageSummary | null> {
  const existing = threadUsageLoads.get(threadId)
  if (existing) return existing
  const pending = loadThreadUsage(threadId).finally(() => {
    if (threadUsageLoads.get(threadId) === pending) threadUsageLoads.delete(threadId)
  })
  threadUsageLoads.set(threadId, pending)
  return pending
}

export function useThreadUsageState(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageState {
  const [state, setState] = useState<ThreadUsageState>({
    usage: null,
    loading: false,
    loaded: false
  })

  useEffect(() => {
    let cancelled = false
    if (!threadId || !enabled) {
      setState({ usage: null, loading: false, loaded: false })
      return
    }
    setState((current) => ({ ...current, loading: true }))
    const timer = window.setTimeout(() => {
      void loadThreadUsageSingleflight(threadId)
        .then((usage) => {
          if (!cancelled) setState({ usage, loading: false, loaded: true })
        })
        .catch(() => {
          if (!cancelled) setState({ usage: null, loading: false, loaded: true })
        })
    }, THREAD_USAGE_REFRESH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled, refreshKey, threadId])

  return state
}

export function useThreadUsage(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageSummary | null {
  return useThreadUsageState(threadId, enabled, refreshKey).usage
}
