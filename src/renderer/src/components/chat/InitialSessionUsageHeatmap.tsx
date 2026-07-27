import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Flame
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  getClaudeRuntimeSettings,
  getCodexRuntimeSettings,
  type AgentRuntimeId,
  type AppSettingsV1
} from '@shared/app-settings'
import {
  formatCompactNumber,
  formatCost,
  formatPercent
} from '../../hooks/use-thread-usage'
import {
  type DailyUsageBucket,
  type DailyUsageState,
  useDailyUsageState
} from '../../hooks/use-daily-usage'
import {
  type ModelUsageState,
  useModelUsageState
} from '../../hooks/use-model-usage'

type UsageTotalsBucket = DailyUsageBucket & { days: number; activeDays: number }
type UsageRangeKey = 'all' | '90d' | '30d' | '7d'
type UsageTabKey = 'overview' | 'models'
const USAGE_HEATMAP_GRID_DAYS = 26 * 7
const USAGE_RANGE_DAYS: Record<UsageRangeKey, number> = {
  all: 365,
  '90d': 90,
  '30d': 30,
  '7d': 7
}
const USAGE_RANGE_KEYS: UsageRangeKey[] = ['all', '90d', '30d', '7d']
const MODEL_USAGE_COLORS = ['#4f83df', '#6b99e5', '#8db3ed', '#b8cff6']
const MODEL_USAGE_BREAKDOWN_COLORS = {
  cachedInput: '#9bd8ff',
  uncachedInput: '#62aaf8',
  output: '#245fd7'
} as const
const EMPTY_DAILY_USAGE_BUCKETS: DailyUsageBucket[] = []
const DEFAULT_USAGE_RUNTIME_LABEL = 'Codex'

export const USAGE_HEATMAP_INTENSITY_CLASSES = [
  'border-ds-border-muted bg-ds-subtle',
  'border-rose-300 bg-rose-300 dark:border-rose-300/55 dark:bg-rose-400',
  'border-orange-400 bg-orange-400 dark:border-orange-300/60 dark:bg-orange-400',
  'border-fuchsia-500 bg-fuchsia-500 dark:border-fuchsia-300/60 dark:bg-fuchsia-400',
  'border-violet-700 bg-violet-700 dark:border-violet-300/70 dark:bg-violet-400'
]

export const USAGE_HEATMAP_CONTRAST_COLORS = [
  { level: 0, light: '#f5f7fb', dark: '#2a2a2a' },
  { level: 1, light: '#fda4af', dark: '#fb7185' },
  { level: 2, light: '#fb923c', dark: '#fb923c' },
  { level: 3, light: '#d946ef', dark: '#e879f9' },
  { level: 4, light: '#6d28d9', dark: '#a78bfa' }
] as const

export function usageHeatmapIntensityLevel(
  bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>,
  maxTokens: number,
  maxTurns: number
): number {
  const metric = maxTokens > 0 ? bucket.totalTokens : bucket.turns
  const max = maxTokens > 0 ? maxTokens : maxTurns
  if (metric <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(4, Math.ceil((metric / max) * 4)))
}

function usageHasBucketActivity(bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>): boolean {
  return bucket.totalTokens > 0 || bucket.turns > 0
}

function usageStreaks(buckets: DailyUsageBucket[]): { current: number; longest: number } {
  let current = 0
  let longest = 0
  let running = 0
  for (const bucket of buckets) {
    if (usageHasBucketActivity(bucket)) {
      running += 1
      longest = Math.max(longest, running)
    } else {
      running = 0
    }
  }
  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (!usageHasBucketActivity(buckets[index])) break
    current += 1
  }
  return { current, longest }
}

function usageRangeBuckets(buckets: DailyUsageBucket[], rangeKey: UsageRangeKey): DailyUsageBucket[] {
  if (rangeKey === 'all') return buckets
  return buckets.slice(-USAGE_RANGE_DAYS[rangeKey])
}

function usageTotalsFromBuckets(buckets: DailyUsageBucket[]): UsageTotalsBucket {
  let hasCny = false
  const totals = buckets.reduce<UsageTotalsBucket>(
    (acc, bucket) => {
      acc.inputTokens += bucket.inputTokens
      acc.outputTokens += bucket.outputTokens
      acc.reasoningTokens += bucket.reasoningTokens
      acc.cachedTokens += bucket.cachedTokens
      acc.cacheMissTokens += bucket.cacheMissTokens
      acc.totalTokens += bucket.totalTokens
      acc.costUsd += bucket.costUsd
      acc.costCny = (acc.costCny ?? 0) + (bucket.costCny ?? 0)
      acc.cacheSavingsUsd += bucket.cacheSavingsUsd
      acc.cacheSavingsCny = (acc.cacheSavingsCny ?? 0) + (bucket.cacheSavingsCny ?? 0)
      acc.tokenEconomySavingsTokens += bucket.tokenEconomySavingsTokens
      acc.tokenEconomySavingsUsd += bucket.tokenEconomySavingsUsd
      acc.tokenEconomySavingsCny =
        (acc.tokenEconomySavingsCny ?? 0) + (bucket.tokenEconomySavingsCny ?? 0)
      acc.turns += bucket.turns
      acc.threadCount += bucket.threadCount
      if (bucket.costCny != null) hasCny = true
      if (bucket.cacheSavingsCny != null) hasCny = true
      if (bucket.tokenEconomySavingsCny != null) hasCny = true
      if (usageHasBucketActivity(bucket)) acc.activeDays += 1
      return acc
    },
    {
      date: 'totals',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costCny: 0,
      cacheSavingsUsd: 0,
      cacheSavingsCny: 0,
      tokenEconomySavingsTokens: 0,
      tokenEconomySavingsUsd: 0,
      tokenEconomySavingsCny: 0,
      turns: 0,
      threadCount: 0,
      cacheHitRate: null,
      days: buckets.length,
      activeDays: 0
    }
  )
  const cacheTotal = totals.cachedTokens + totals.cacheMissTokens
  return {
    ...totals,
    costCny: hasCny ? totals.costCny : null,
    cacheHitRate: cacheTotal > 0 ? totals.cachedTokens / cacheTotal : null
  }
}

function dailySummary(
  bucket: DailyUsageBucket,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapDaySummary', {
    date: bucket.date,
    tokens: formatCompactNumber(bucket.totalTokens),
    cost: formatCost(bucket.costUsd, locale, bucket.costCny),
    saved: formatCost(bucket.cacheSavingsUsd, locale, bucket.cacheSavingsCny),
    turns: bucket.turns,
    threads: bucket.threadCount,
    cache: formatPercent(bucket.cacheHitRate)
  })
}

export function usageRuntimeLabel(runtimeId: AgentRuntimeId): string {
  if (runtimeId === 'claude') return 'Claude Code'
  return runtimeId === 'codex' ? 'Codex' : 'SciForge Runtime (Unavailable)'
}

function usageModelLabelFromSettings(settings: AppSettingsV1, runtimeId: AgentRuntimeId): string {
  const configuredModel = runtimeId === 'claude'
    ? getClaudeRuntimeSettings(settings).model
    : getCodexRuntimeSettings(settings).model
  return configuredModel.trim() || usageRuntimeLabel(runtimeId)
}

function HeatmapGrid({
  buckets,
  loading,
  runtimeLabel,
  selected,
  onSelect
}: {
  buckets: DailyUsageBucket[]
  loading: boolean
  runtimeLabel: string
  selected: DailyUsageBucket | null
  onSelect: (bucket: DailyUsageBucket) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const maxTokens = useMemo(() => Math.max(0, ...buckets.map((bucket) => bucket.totalTokens)), [buckets])
  const maxTurns = useMemo(() => Math.max(0, ...buckets.map((bucket) => bucket.turns)), [buckets])
  const skeletonDays = Array.from({ length: USAGE_HEATMAP_GRID_DAYS }, (_, day) => day)
  const timelineDays = loading ? skeletonDays : buckets
  const selectedSummary = selected
    ? `${formatChartDate(selected.date, i18n.language)} · ${formatCompactNumber(selected.totalTokens)} ${t('usageHeatmapTokens')}`
    : t('usageHeatmapGridHint')

  return (
    <div className="w-full min-w-0 rounded-[18px] border border-ds-border-muted bg-ds-card/70 px-4 py-4 dark:bg-white/[0.025]">
      <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
            {t('usageHeatmapGridLabel', { runtime: runtimeLabel })}
          </p>
          <p className="mt-1 truncate text-[12px] tabular-nums text-ds-muted" title={selectedSummary}>
            {selectedSummary}
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-1.5 text-[10px] font-medium text-ds-faint" aria-hidden>
          <span>{t('usageHeatmapLess')}</span>
          {USAGE_HEATMAP_INTENSITY_CLASSES.map((className, index) => (
            <span
              key={className}
              className={`w-1.5 rounded-full border ${className}`}
              style={{ height: `${8 + index * 4}px` }}
            />
          ))}
          <span>{t('usageHeatmapMore')}</span>
        </div>
      </div>
      <div className="max-w-full overflow-hidden pb-1">
        <div
          className="grid h-[64px] w-full items-end gap-px border-b border-ds-border-muted/80 px-0.5"
          style={{
            gridTemplateColumns: `repeat(${Math.max(timelineDays.length, 1)}, minmax(1px, 1fr))`
          }}
          aria-label={t('usageHeatmapGridLabel', { runtime: runtimeLabel })}
        >
          {loading
            ? skeletonDays.map((day) => (
                <span
                  key={day}
                  className="w-full animate-pulse rounded-t-full border border-ds-border-muted bg-ds-subtle"
                  style={{ height: `${8 + (day % 5) * 7}px` }}
                />
              ))
            : buckets.map((bucket) => {
                const level = usageHeatmapIntensityLevel(bucket, maxTokens, maxTurns)
                return (
                  <button
                    key={bucket.date}
                    type="button"
                    title={dailySummary(bucket, t, i18n.language)}
                    aria-label={dailySummary(bucket, t, i18n.language)}
                    onMouseEnter={() => onSelect(bucket)}
                    onFocus={() => onSelect(bucket)}
                    onClick={() => onSelect(bucket)}
                    className={`w-full rounded-t-full border transition-[height,filter,opacity] hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-1 focus:ring-offset-ds-bg ${USAGE_HEATMAP_INTENSITY_CLASSES[level]} ${
                      selected?.date === bucket.date ? 'ring-2 ring-violet-500 ring-offset-1 ring-offset-ds-bg' : ''
                    }`}
                    style={{ height: `${8 + level * 11}px` }}
                  />
                )
              })}
        </div>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  className = ''
}: {
  label: string
  value: string
  className?: string
}): ReactElement {
  return (
    <span className={`flex min-h-[74px] min-w-0 flex-col justify-between px-4 py-3.5 ${className}`}>
      <span className="min-w-0 truncate whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] text-ds-faint" title={label}>
        {label}
      </span>
      <span className="mt-2 min-w-0 truncate text-[20px] font-semibold leading-6 tabular-nums tracking-[-0.02em] text-ds-ink" title={value}>
        {value}
      </span>
    </span>
  )
}

function formatChartDate(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
}

function formatTokenCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(value)))
}

function modelUsageBreakdownSummary(
  label: string,
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens' | 'cacheSavingsUsd' | 'cacheSavingsCny'>,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapModelTooltip', {
    label,
    total: formatTokenCount(bucket.totalTokens, locale),
    input: formatTokenCount(bucket.inputTokens, locale),
    output: formatTokenCount(bucket.outputTokens, locale),
    cacheHit: formatTokenCount(bucket.cachedTokens, locale),
    cacheMiss: formatTokenCount(bucket.cacheMissTokens, locale),
    saved: formatCost(bucket.cacheSavingsUsd, locale, bucket.cacheSavingsCny)
  })
}

function modelUsageChartBreakdown(
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'>
): {
  cachedInput: number
  uncachedInput: number
  output: number
  total: number
} {
  const cachedInput = Math.max(0, bucket.cachedTokens)
  const uncachedInput = Math.max(
    0,
    bucket.cacheMissTokens > 0 ? bucket.cacheMissTokens : bucket.inputTokens - cachedInput
  )
  const output = Math.max(0, bucket.outputTokens)
  const total = Math.max(0, bucket.totalTokens, cachedInput + uncachedInput + output)
  return {
    cachedInput,
    uncachedInput,
    output,
    total
  }
}

function ModelUsagePanel({
  state,
  fallbackModel,
  locale,
  initialActiveDayIndex = null
}: {
  state: ModelUsageState
  fallbackModel: string
  locale: string
  initialActiveDayIndex?: number | null
}): ReactElement {
  const { t } = useTranslation('common')
  const usage = state.usage
  const modelBuckets = usage?.buckets ?? []
  const dayBuckets = usage?.days ?? []
  const activeDays = dayBuckets.filter((bucket) => bucket.totalTokens > 0)
  const chartDays = (activeDays.length > 0 ? activeDays : dayBuckets).slice(-5)
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(initialActiveDayIndex)
  const chartBreakdowns = useMemo(
    () => chartDays.map((bucket) => modelUsageChartBreakdown(bucket)),
    [chartDays]
  )
  const maxTokens = Math.max(1, ...chartBreakdowns.map((bucket) => bucket.total))
  const topModels = modelBuckets.slice(0, 4)
  const totalTokens = Math.max(usage?.totals.totalTokens ?? 0, 1)
  const resolvedActiveDayIndex =
    activeDayIndex != null && activeDayIndex >= 0 && activeDayIndex < chartDays.length
      ? activeDayIndex
      : null
  const activeDay = resolvedActiveDayIndex != null ? chartDays[resolvedActiveDayIndex] : null
  const activeBreakdown =
    resolvedActiveDayIndex != null ? chartBreakdowns[resolvedActiveDayIndex] : null
  const tooltipAnchorPercent =
    resolvedActiveDayIndex != null
      ? ((resolvedActiveDayIndex + 0.5) / Math.max(chartDays.length, 1)) * 100
      : 50
  const tooltipTransformClass =
    resolvedActiveDayIndex == null || (resolvedActiveDayIndex > 0 && resolvedActiveDayIndex < chartDays.length - 1)
      ? '-translate-x-1/2'
      : resolvedActiveDayIndex === 0
        ? 'translate-x-0'
        : '-translate-x-full'
  const tooltipRows = activeBreakdown
    ? [
        {
          key: 'cached-input',
          label: t('usageHeatmapModelTooltipCachedInput'),
          value: activeBreakdown.cachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
        },
        {
          key: 'uncached-input',
          label: t('usageHeatmapModelTooltipUncachedInput'),
          value: activeBreakdown.uncachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
        },
        {
          key: 'output',
          label: t('usageHeatmapModelTooltipOutput'),
          value: activeBreakdown.output,
          color: MODEL_USAGE_BREAKDOWN_COLORS.output
        }
      ]
    : []

  if (state.loading && !usage) {
    return (
      <div className="grid min-h-[180px] place-items-center text-[12px] text-ds-faint">
        {t('usageHeatmapLoading')}
      </div>
    )
  }

  if (modelBuckets.length === 0) {
    return (
      <div className="grid min-h-[180px] place-items-center rounded-md bg-ds-subtle text-[12px] text-ds-faint">
        {t('usageHeatmapModelsEmpty', { model: fallbackModel || '-' })}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline gap-3 px-1">
        <span className="text-[13px] font-medium text-ds-muted">{t('usageHeatmapTokens')}</span>
        <span className="text-[20px] font-semibold tabular-nums text-ds-ink">
          {formatTokenCount(usage?.totals.totalTokens ?? 0, locale)}
        </span>
      </div>
      <div className="grid min-h-[206px] grid-cols-[44px_1fr] gap-2">
        <div className="grid grid-rows-5 pb-5 pt-14 text-right text-[11px] leading-none text-ds-faint">
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <span key={ratio}>
              {ratio === 0 ? '0' : formatCompactNumber(maxTokens * ratio)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0" onMouseLeave={() => setActiveDayIndex(null)}>
          {activeDay && activeBreakdown ? (
            <div
              className={`pointer-events-none absolute top-0 z-20 w-[min(18rem,calc(100vw-4rem))] max-w-full rounded-[18px] border border-ds-border bg-ds-card/98 p-3 shadow-[0_18px_46px_rgba(15,23,42,0.12)] backdrop-blur-xl ${tooltipTransformClass}`}
              style={{ left: `${tooltipAnchorPercent}%` }}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-[12.5px] font-semibold text-ds-ink">{activeDay.date}</span>
                <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-ds-ink">
                  {t('usageHeatmapModelTooltipTotalTokens', {
                    value: formatTokenCount(activeBreakdown.total, locale)
                  })}
                </span>
              </div>
              <div className="mt-2 grid gap-1.5">
                {tooltipRows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[12px] leading-5"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-[3px]"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 text-ds-muted">{row.label}</span>
                    <span className="whitespace-nowrap tabular-nums text-ds-ink">
                      {t('usageHeatmapModelTooltipTotalTokens', {
                        value: formatTokenCount(row.value, locale)
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid min-h-[150px] min-w-0 grid-flow-col items-end gap-2 pt-14">
          {chartDays.map((bucket, index) => {
            const breakdown = chartBreakdowns[index]
            const segments = [
              {
                key: 'output',
                value: breakdown.output,
                color: MODEL_USAGE_BREAKDOWN_COLORS.output
              },
              {
                key: 'uncached-input',
                value: breakdown.uncachedInput,
                color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
              },
              {
                key: 'cached-input',
                value: breakdown.cachedInput,
                color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
              }
            ]
            const dateLabel = formatChartDate(bucket.date, locale)
            const summary = modelUsageBreakdownSummary(dateLabel, bucket, t, locale)
            const active = resolvedActiveDayIndex === index
            const barHeight = Math.max(8, (breakdown.total / maxTokens) * 112)
            return (
              <div key={`${bucket.date}-${index}`} className="relative grid min-w-0 grid-rows-[1fr_auto] gap-2">
                {active ? (
                  <span
                    className="pointer-events-none absolute bottom-5 left-1/2 top-0 z-0 w-px -translate-x-1/2 border-l border-dashed border-accent/35"
                    aria-hidden
                  />
                ) : null}
                <button
                  type="button"
                  title={summary}
                  aria-label={summary}
                  onMouseEnter={() => setActiveDayIndex(index)}
                  onFocus={() => setActiveDayIndex(index)}
                  onClick={() => setActiveDayIndex(index)}
                  className="relative z-[1] flex min-h-[112px] items-end rounded-[10px] px-1 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-ds-bg"
                >
                  <span
                    className={`flex w-full flex-col-reverse overflow-hidden rounded-t-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.36)] transition ${
                      active ? 'ring-1 ring-accent/18' : ''
                    }`}
                    style={{ height: `${barHeight}px` }}
                  >
                    {segments.map((segment) => {
                      const ratio = breakdown.total > 0 ? segment.value / breakdown.total : 0
                      if (ratio <= 0) return null
                      return (
                        <span
                          key={segment.key}
                          className="w-full border-t border-white/35 dark:border-white/10"
                          style={{
                            height: `${Math.max(4, ratio * barHeight)}px`,
                            backgroundColor: segment.color
                          }}
                        />
                      )
                    })}
                  </span>
                </button>
                <span className="truncate text-center text-[11px] text-ds-faint">
                  {dateLabel}
                </span>
              </div>
            )
          })}
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5">
        {topModels.map((bucket, index) => {
          const percent = (bucket.totalTokens / totalTokens) * 100
          const summary = modelUsageBreakdownSummary(bucket.model, bucket, t, locale)
          return (
            <div
              key={bucket.model}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] items-center gap-3 text-[12px] leading-5"
              title={summary}
              aria-label={summary}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-ds-ink">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: MODEL_USAGE_COLORS[index % MODEL_USAGE_COLORS.length] }}
                />
                <span className="truncate">{bucket.model}</span>
              </span>
              <span className="min-w-0 truncate whitespace-nowrap text-right tabular-nums text-ds-faint">
                {t('usageHeatmapModelTokenBreakdown', {
                  input: formatCompactNumber(bucket.inputTokens),
                  output: formatCompactNumber(bucket.outputTokens),
                  cacheHit: formatCompactNumber(bucket.cachedTokens),
                  cacheMiss: formatCompactNumber(bucket.cacheMissTokens)
                })}
              </span>
              <span className="min-w-[3.2rem] text-right tabular-nums font-semibold text-ds-ink">
                {percent.toFixed(percent >= 10 ? 1 : 1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UsageHeroToggle({
  expanded,
  onToggle
}: {
  expanded: boolean
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const Icon = expanded ? ChevronUp : ChevronDown
  const label = expanded ? t('usageHeatmapCollapse') : t('usageHeatmapExpand')

  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-ds-border-muted bg-ds-card text-ds-muted transition hover:border-violet-400/60 hover:text-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:ring-offset-2 focus:ring-offset-ds-bg dark:hover:text-violet-300"
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  )
}

function CollapsedCalendarCard({ onExpand }: { onExpand: () => void }): ReactElement {
  return (
    <div className="flex w-full min-w-0 justify-center border-y border-ds-border-muted py-3">
      <UsageHeroToggle expanded={false} onToggle={onExpand} />
    </div>
  )
}

function UsagePanelCard({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="w-full min-w-0 overflow-hidden border-y border-ds-border-muted bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.34))] shadow-[0_22px_54px_rgba(55,48,107,0.08)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))]">
      {children}
    </div>
  )
}

export function InitialSessionUsageHeatmap({ runtimeId }: { runtimeId: AgentRuntimeId }): ReactElement {
  return <RuntimeUsageHeatmap key={runtimeId} runtimeId={runtimeId} />
}

function RuntimeUsageHeatmap({ runtimeId }: { runtimeId: AgentRuntimeId }): ReactElement {
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('all')
  const runtimeLabel = usageRuntimeLabel(runtimeId)
  const [modelLabel, setModelLabel] = useState(runtimeLabel)
  const state = useDailyUsageState(true, runtimeId, USAGE_RANGE_DAYS.all, runtimeId)
  const modelState = useModelUsageState(true, rangeKey, USAGE_RANGE_DAYS[rangeKey], runtimeId)

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || typeof window.sciforge?.getSettings !== 'function') {
      setModelLabel(runtimeLabel)
      return
    }
    void window.sciforge.getSettings()
      .then((settings) => {
        if (!cancelled) setModelLabel(usageModelLabelFromSettings(settings, runtimeId))
      })
      .catch(() => {
        if (!cancelled) setModelLabel(runtimeLabel)
      })
    return () => {
      cancelled = true
    }
  }, [runtimeId, runtimeLabel])

  return (
    <InitialSessionUsageHeatmapView
      state={state}
      modelState={modelState}
      rangeKey={rangeKey}
      runtimeLabel={runtimeLabel}
      modelLabel={modelLabel}
      onRangeChange={setRangeKey}
    />
  )
}

export function InitialSessionUsageHeatmapView({
  state,
  modelState = { usage: null, loading: false, loaded: false, error: null },
  rangeKey = 'all',
  initialCollapsed = false,
  initialActiveTab = 'overview',
  initialModelHoverIndex = null,
  runtimeLabel = DEFAULT_USAGE_RUNTIME_LABEL,
  modelLabel = '',
  onRangeChange
}: {
  state: DailyUsageState
  modelState?: ModelUsageState
  rangeKey?: UsageRangeKey
  initialCollapsed?: boolean
  initialActiveTab?: UsageTabKey
  initialModelHoverIndex?: number | null
  runtimeLabel?: string
  modelLabel?: string
  onRangeChange?: (rangeKey: UsageRangeKey) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [activeBucket, setActiveBucket] = useState<DailyUsageBucket | null>(null)
  const [activeTab, setActiveTab] = useState<UsageTabKey>(initialActiveTab)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const effectiveModelLabel = modelLabel.trim() || runtimeLabel
  const usage = state.usage
  const buckets = usage?.buckets ?? EMPTY_DAILY_USAGE_BUCKETS
  const metricBuckets = useMemo(() => usageRangeBuckets(buckets, rangeKey), [buckets, rangeKey])
  const heatmapBuckets = useMemo(() => buckets.slice(-USAGE_HEATMAP_GRID_DAYS), [buckets])
  const totals = useMemo(() => usageTotalsFromBuckets(metricBuckets), [metricBuckets])
  const streaks = useMemo(() => usageStreaks(metricBuckets), [metricBuckets])
  const hasUnmeteredTokenBuckets = useMemo(
    () => metricBuckets.some((bucket) => bucket.turns > 0 && bucket.totalTokens <= 0),
    [metricBuckets]
  )
  const tokenMetricValue =
    hasUnmeteredTokenBuckets && totals.totalTokens <= 0
      ? t('usageHeatmapTokensUnrecorded')
      : formatCompactNumber(totals.totalTokens)
  const overviewCaption =
    hasUnmeteredTokenBuckets && totals.totalTokens <= 0
      ? t('usageHeatmapOverviewCaptionUnrecorded', { activeDays: totals.activeDays })
      : hasUnmeteredTokenBuckets
        ? t('usageHeatmapOverviewCaptionPartial', {
          tokens: formatCompactNumber(totals.totalTokens),
          activeDays: totals.activeDays
        })
        : t('usageHeatmapOverviewCaption', {
          tokens: formatCompactNumber(totals.totalTokens),
          activeDays: totals.activeDays
        })
  const overviewMetrics = [
    { label: t('usageHeatmapSessions'), value: formatCompactNumber(totals.threadCount) },
    { label: t('usageHeatmapMessages'), value: formatCompactNumber(totals.turns) },
    { label: t('usageHeatmapActiveDays'), value: String(totals.activeDays) },
    { label: t('usageHeatmapCache'), value: formatPercent(totals.cacheHitRate) }
  ]
  const economyMetrics = [
    { label: t('usageHeatmapCost'), value: formatCost(totals.costUsd, i18n.language, totals.costCny) },
    { label: t('usageHeatmapCacheSavings'), value: formatCost(totals.cacheSavingsUsd, i18n.language, totals.cacheSavingsCny) },
    {
      label: t('usageHeatmapContextSavings'),
      value: formatCost(totals.tokenEconomySavingsUsd, i18n.language, totals.tokenEconomySavingsCny)
    }
  ]
  const heroTitle = t('usageHeatmapTitle', { runtime: runtimeLabel })
  const heroSub = t('usageHeatmapSub', { runtime: runtimeLabel })

  return (
    <div className="ds-initial-usage-heatmap ds-no-drag mx-auto flex min-h-[min(620px,calc(100dvh-220px))] w-full items-center justify-center px-3 py-5 text-left sm:px-5 sm:py-7">
      <div className="flex w-full max-w-[900px] min-w-0 flex-col gap-5">
        {collapsed ? (
          <CollapsedCalendarCard onExpand={() => setCollapsed(false)} />
        ) : (
          <UsagePanelCard>
            <section className="ds-usage-command-center min-w-0">
                <header className="px-4 pt-5 sm:px-6 sm:pt-6">
                  <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                    <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[linear-gradient(145deg,#7c3aed,#d946ef_58%,#f97316)] text-white shadow-[0_10px_26px_rgba(124,58,237,0.25)]">
                      <Activity className="h-[18px] w-[18px]" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
                        {t('usageHeatmapBadge', { runtime: runtimeLabel })}
                      </p>
                      <h1 className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.025em] text-ds-ink sm:text-[25px]">
                        {heroTitle}
                      </h1>
                      <p className="mt-1.5 max-w-[660px] text-[12.5px] leading-5 text-ds-muted sm:text-[13px]">
                        {heroSub}
                      </p>
                    </div>
                    <UsageHeroToggle expanded onToggle={() => setCollapsed(true)} />
                  </div>
                  <div className="mt-5 flex min-w-0 flex-col gap-3 border-t border-ds-border-muted pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-5 text-[12.5px] font-medium text-ds-muted">
                      <button
                        type="button"
                        className={`relative min-h-8 transition after:absolute after:-bottom-3 after:left-0 after:right-0 after:h-0.5 after:rounded-full ${
                          activeTab === 'overview'
                            ? 'text-ds-ink after:bg-[linear-gradient(90deg,#7c3aed,#f97316)]'
                            : 'after:bg-transparent hover:text-ds-ink'
                        }`}
                        aria-pressed={activeTab === 'overview'}
                        onClick={() => setActiveTab('overview')}
                      >
                        {t('usageHeatmapTabOverview')}
                      </button>
                      <button
                        type="button"
                        className={`relative min-h-8 transition after:absolute after:-bottom-3 after:left-0 after:right-0 after:h-0.5 after:rounded-full ${
                          activeTab === 'models'
                            ? 'text-ds-ink after:bg-[linear-gradient(90deg,#7c3aed,#f97316)]'
                            : 'after:bg-transparent hover:text-ds-ink'
                        }`}
                        title={t('usageHeatmapTabModels')}
                        aria-pressed={activeTab === 'models'}
                        onClick={() => setActiveTab('models')}
                      >
                        {t('usageHeatmapTabModels')}
                      </button>
                    </div>
                    <div className="flex min-w-0 items-center gap-1 self-start rounded-full border border-ds-border-muted bg-ds-subtle/70 p-0.5 text-[11px] font-medium text-ds-muted sm:self-auto">
                      {USAGE_RANGE_KEYS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className={`min-h-7 rounded-full px-2.5 transition ${
                            rangeKey === key
                              ? 'bg-violet-600 text-white shadow-[0_4px_12px_rgba(124,58,237,0.22)] dark:bg-violet-500'
                              : 'hover:text-ds-ink'
                          }`}
                          aria-pressed={rangeKey === key}
                          onClick={() => onRangeChange?.(key)}
                        >
                          {t(`usageHeatmapRange.${key}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </header>
                {activeTab === 'overview' ? (
                  <div className="grid min-w-0 gap-4 border-t border-ds-border-muted px-4 py-5 sm:px-6 sm:py-6">
                    <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)]">
                      <div className="relative min-h-[176px] overflow-hidden rounded-[24px_8px_24px_8px] bg-[linear-gradient(135deg,#21123f_0%,#4c2784_58%,#7c3aed_100%)] p-5 text-white shadow-[0_18px_40px_rgba(70,35,130,0.22)]">
                        <span className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-orange-400/30 blur-2xl" aria-hidden />
                        <span className="pointer-events-none absolute bottom-0 right-8 h-20 w-28 -skew-x-12 bg-fuchsia-400/15 blur-xl" aria-hidden />
                        <div className="relative flex h-full min-w-0 flex-col">
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-violet-100/80">
                            {hasUnmeteredTokenBuckets ? t('usageHeatmapRecordedTokens') : t('usageHeatmapTotalTokens')}
                          </p>
                          <p className="mt-2 truncate text-[38px] font-semibold leading-none tabular-nums tracking-[-0.045em] sm:text-[42px]" title={tokenMetricValue}>
                            {tokenMetricValue}
                          </p>
                          <p className="mt-3 max-w-[420px] text-[11.5px] leading-5 text-violet-100/75">
                            {overviewCaption}
                          </p>
                          <div className="mt-auto grid grid-cols-2 gap-4 border-t border-white/15 pt-3">
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-violet-100/65">
                                <Flame className="h-3 w-3" strokeWidth={1.9} />
                                {t('usageHeatmapCurrentStreak')}
                              </span>
                              <span className="mt-1 block text-[17px] font-semibold tabular-nums">
                                {t('usageHeatmapStreakDays', { count: streaks.current })}
                              </span>
                            </span>
                            <span className="min-w-0 border-l border-white/15 pl-4">
                              <span className="text-[10px] uppercase tracking-[0.08em] text-violet-100/65">
                                {t('usageHeatmapLongestStreak')}
                              </span>
                              <span className="mt-1 block text-[17px] font-semibold tabular-nums">
                                {t('usageHeatmapStreakDays', { count: streaks.longest })}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="grid min-w-0 grid-cols-2 overflow-hidden rounded-[18px] border border-ds-border-muted bg-ds-card/55">
                        {overviewMetrics.map((metric, index) => (
                          <Metric
                            key={metric.label}
                            label={metric.label}
                            value={metric.value}
                            className={`${index < 2 ? 'border-b border-ds-border-muted' : ''} ${index % 2 === 0 ? 'border-r border-ds-border-muted' : ''}`}
                          />
                        ))}
                      </div>
                    </div>
                    <HeatmapGrid
                      buckets={heatmapBuckets}
                      loading={state.loading && heatmapBuckets.length === 0}
                      runtimeLabel={runtimeLabel}
                      selected={activeBucket}
                      onSelect={setActiveBucket}
                    />
                    <div className="grid min-w-0 grid-cols-1 border-y border-ds-border-muted sm:grid-cols-3">
                      {economyMetrics.map((metric, index) => (
                        <span
                          key={metric.label}
                          className={`flex min-w-0 items-center justify-between gap-3 px-1 py-2.5 text-[11.5px] sm:block sm:px-4 sm:py-1 ${index > 0 ? 'border-t border-ds-border-muted sm:border-l sm:border-t-0' : ''}`}
                        >
                          <span className="truncate text-ds-faint">{metric.label}</span>
                          <span className="mt-0.5 block truncate font-semibold tabular-nums text-ds-ink" title={metric.value}>
                            {metric.value}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-ds-border-muted px-4 py-5 sm:px-6 sm:py-6">
                    <div className="mx-auto max-w-[760px]">
                      <ModelUsagePanel
                        state={modelState}
                        fallbackModel={effectiveModelLabel}
                        locale={i18n.language}
                        initialActiveDayIndex={initialModelHoverIndex}
                      />
                    </div>
                  </div>
                )}
            </section>
          </UsagePanelCard>
        )}
      </div>
    </div>
  )
}
