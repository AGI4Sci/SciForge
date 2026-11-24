/**
 * Token usage for the account surface.
 *
 * Reads the canonical Agent Runtime daily-usage query through the preload
 * bridge (`window.sciforge.agentRuntime.usage`) and normalizes it exactly like
 * the host usage hooks do: day grouping, `from`/`to`/`timezone` range, and
 * camelCase or snake_case totals. The domain package owns this read so the
 * sidebar shows usage without importing host-private modules.
 */

const ACCOUNT_USAGE_RECENT_DAYS = 7

export type AccountUsageTotals = Readonly<{
  totalTokens: number
  costUsd: number
  costCny: number | null
}>

export type AccountUsageSnapshot = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'
  today: AccountUsageTotals | null
  recent: AccountUsageTotals | null
  recentDays: number
}>

type AccountUsageRange = Readonly<{
  from: string
  to: string
  timezone: string
}>

type AccountUsageQuery = Readonly<{
  groupBy: 'day'
  from: string
  to: string
  timezone: string
}>

type AgentRuntimeUsageBridge = Readonly<{
  usage?: (query: AccountUsageQuery) => Promise<unknown>
}>

type RawRecord = Readonly<Record<string, unknown>>

const ZERO_USAGE_TOTALS: AccountUsageTotals = Object.freeze({
  totalTokens: 0,
  costUsd: 0,
  costCny: null
})

const IDLE_SNAPSHOT: AccountUsageSnapshot = Object.freeze({
  status: 'idle',
  today: null,
  recent: null,
  recentDays: ACCOUNT_USAGE_RECENT_DAYS
})

export class AccountUsageProjection {
  private snapshotValue = IDLE_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private loading: Promise<AccountUsageSnapshot> | null = null
  private disposed = false

  constructor(private readonly recentDays = ACCOUNT_USAGE_RECENT_DAYS) {}

  getSnapshot = (): AccountUsageSnapshot => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** One bounded read per call; concurrent callers share the in-flight read. */
  load(): Promise<AccountUsageSnapshot> {
    if (this.loading) return this.loading
    const bridge = agentRuntimeUsageBridge()
    if (!bridge?.usage) {
      this.set({ ...IDLE_SNAPSHOT, status: 'unsupported' })
      return Promise.resolve(this.snapshotValue)
    }
    if (this.snapshotValue.status !== 'ready') {
      this.set({ ...this.snapshotValue, status: 'loading' })
    }
    const range = defaultAccountUsageRange(new Date(), this.recentDays)
    this.loading = Promise.resolve()
      .then(() => bridge.usage!(buildAccountUsageQuery(range)))
      .then((raw) => {
        if (this.disposed) return this.snapshotValue
        if (!isRecord(raw) || raw.supported === false) {
          this.set({ ...IDLE_SNAPSHOT, status: 'unsupported' })
          return this.snapshotValue
        }
        if ((raw.groupBy ?? raw.group_by) !== 'day') {
          throw new Error('daily usage response did not use day grouping')
        }
        const summary = normalizeAccountUsageResponse(raw)
        const today = summary.buckets.find((bucket) => bucket.date === summary.to)
        this.set({
          status: 'ready',
          today: today ? totalsOf(today) : ZERO_USAGE_TOTALS,
          recent: summary.totals,
          recentDays: this.recentDays
        })
        return this.snapshotValue
      })
      .catch(() => {
        if (!this.disposed && this.snapshotValue.status !== 'ready') {
          this.set({ ...IDLE_SNAPSHOT, status: 'error' })
        }
        return this.snapshotValue
      })
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private set(snapshot: AccountUsageSnapshot): void {
    if (this.disposed) return
    this.snapshotValue = Object.freeze(snapshot)
    for (const listener of this.listeners) listener()
  }
}

function defaultAccountUsageRange(
  now = new Date(),
  days = ACCOUNT_USAGE_RECENT_DAYS
): AccountUsageRange {
  const timezone = clientTimezone()
  const rangeDays = Math.max(7, Math.round(days))
  const to = dateStringFromParts(now, timezone)
  return {
    from: addDays(to, -(rangeDays - 1)),
    to,
    timezone
  }
}

function buildAccountUsageQuery(range: AccountUsageRange): AccountUsageQuery {
  return { groupBy: 'day', from: range.from, to: range.to, timezone: range.timezone }
}

type AccountUsageSummary = Readonly<{
  from: string
  to: string
  buckets: readonly (AccountUsageTotals & Readonly<{ date: string }>)[]
  totals: AccountUsageTotals
}>

function normalizeAccountUsageResponse(raw: unknown): AccountUsageSummary {
  if (!isRecord(raw)) throw new Error('usage response is not an object')
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.date !== 'string' || !entry.date) return []
        return [{ date: entry.date, ...normalizeTotals(entry) }]
      })
    : []
  return {
    from: typeof raw.from === 'string' ? raw.from : buckets[0]?.date ?? '',
    to: typeof raw.to === 'string' ? raw.to : buckets[buckets.length - 1]?.date ?? '',
    buckets,
    totals: normalizeTotals(isRecord(raw.totals) ? raw.totals : {})
  }
}

export function formatCompactTokens(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  try {
    return new Intl.NumberFormat(locale).format(value)
  } catch {
    return String(value)
  }
}

export function formatUsageCost(
  costUsd: number,
  locale?: string,
  costCny?: number | null
): string {
  const usd = Number.isFinite(costUsd) ? costUsd : 0
  if (isChineseLocale(locale)) {
    const cny = typeof costCny === 'number' && Number.isFinite(costCny) ? costCny : usd * 7.2
    return `￥${formatMoney(cny)}`
  }
  return `$${formatMoney(usd)}`
}

function agentRuntimeUsageBridge(): AgentRuntimeUsageBridge | undefined {
  const runtime = globalThis as {
    sciforge?: Readonly<{ agentRuntime?: AgentRuntimeUsageBridge }>
  }
  return runtime.sciforge?.agentRuntime
}

function totalsOf(totals: AccountUsageTotals): AccountUsageTotals {
  return {
    totalTokens: totals.totalTokens,
    costUsd: totals.costUsd,
    costCny: totals.costCny
  }
}

function normalizeTotals(raw: RawRecord): AccountUsageTotals {
  const inputTokens = usageNumber(rawField(raw, 'inputTokens', 'input_tokens'))
  const outputTokens = usageNumber(rawField(raw, 'outputTokens', 'output_tokens'))
  return {
    totalTokens: usageNumber(rawField(raw, 'totalTokens', 'total_tokens')) ||
      inputTokens + outputTokens,
    costUsd: usageNumber(rawField(raw, 'costUsd', 'cost_usd')),
    costCny: usageOptionalNumber(rawField(raw, 'costCny', 'cost_cny'))
  }
}

function rawField(raw: RawRecord, camel: string, snake: string): unknown {
  return raw[camel] ?? raw[snake]
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
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

function isChineseLocale(locale?: string): boolean {
  const normalized = (locale ?? '').trim().toLowerCase()
  return normalized === 'zh' || normalized.startsWith('zh-')
}

function formatMoney(value: number): string {
  return value.toFixed(value >= 1 ? 2 : 4)
}
