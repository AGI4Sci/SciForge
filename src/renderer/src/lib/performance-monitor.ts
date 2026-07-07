type PerfDetailValue = string | number | boolean | null | undefined

export type PerfDetail = Record<string, PerfDetailValue>

export type PerfEvent = {
  atMs: number
  kind: 'counter' | 'sample'
  name: string
  value?: number
  durationMs?: number
  detail?: PerfDetail
}

export type PerfCounterSnapshot = {
  total: number
  currentSecond: number
  previousSecond: number
}

export type PerfSampleSnapshot = {
  count: number
  avgMs: number
  maxMs: number
  lastMs: number
  over16Ms: number
  over50Ms: number
}

export type PerfSnapshot = {
  enabled: boolean
  startedAtMs: number
  uptimeMs: number
  counters: Record<string, PerfCounterSnapshot>
  samples: Record<string, PerfSampleSnapshot>
  recentEvents: PerfEvent[]
}

export type PerfConsoleApi = {
  snapshot: () => PerfSnapshot
  reset: () => void
  recentEvents: () => PerfEvent[]
  dump: () => PerfSnapshot
}

export type PerformanceMonitorOptions = {
  enabled?: boolean
  clock?: () => number
  eventLimit?: number
  globalScope?: { __SCIFORGE_PERF__?: PerfConsoleApi }
}

type CounterState = {
  total: number
  currentSecond: number
  previousSecond: number
}

type SampleState = {
  count: number
  totalMs: number
  maxMs: number
  lastMs: number
  over16Ms: number
  over50Ms: number
}

export type StatePatch<State> = Partial<State> | ((state: State) => Partial<State>)
export type StateSetter<State> = (partial: StatePatch<State>) => void

const DEFAULT_EVENT_LIMIT = 240
const DETAIL_STRING_LIMIT = 120

declare global {
  interface Window {
    __SCIFORGE_PERF__?: PerfConsoleApi
  }
}

export function createPerformanceMonitor(options: PerformanceMonitorOptions = {}) {
  const enabled = options.enabled ?? defaultEnabled()
  const clock = options.clock ?? defaultClock
  const eventLimit = Math.max(20, options.eventLimit ?? DEFAULT_EVENT_LIMIT)
  const startedAtMs = clock()
  const counters = new Map<string, CounterState>()
  const samples = new Map<string, SampleState>()
  const recentEvents: PerfEvent[] = []
  let currentSecondBucket = secondBucket(startedAtMs)
  let currentSecondCounts = new Map<string, number>()
  let previousSecondCounts = new Map<string, number>()
  let longTaskObserver: PerformanceObserver | null = null

  const rotateBuckets = (nowMs: number): void => {
    const bucket = secondBucket(nowMs)
    if (bucket === currentSecondBucket) return
    previousSecondCounts = bucket === currentSecondBucket + 1
      ? currentSecondCounts
      : new Map()
    currentSecondCounts = new Map()
    currentSecondBucket = bucket
    for (const [name, state] of counters) {
      state.previousSecond = previousSecondCounts.get(name) ?? 0
      state.currentSecond = 0
    }
  }

  const pushEvent = (event: PerfEvent): void => {
    recentEvents.push(event)
    while (recentEvents.length > eventLimit) recentEvents.shift()
  }

  const count = (name: string, value = 1, detail?: PerfDetail): void => {
    if (!enabled) return
    const normalizedName = normalizeName(name)
    if (!normalizedName || !Number.isFinite(value) || value === 0) return
    const nowMs = clock()
    rotateBuckets(nowMs)
    const state = counters.get(normalizedName) ?? { total: 0, currentSecond: 0, previousSecond: 0 }
    state.total += value
    state.currentSecond += value
    counters.set(normalizedName, state)
    currentSecondCounts.set(normalizedName, (currentSecondCounts.get(normalizedName) ?? 0) + value)
    pushEvent({
      atMs: nowMs,
      kind: 'counter',
      name: normalizedName,
      value,
      ...(detail ? { detail: sanitizeDetail(detail) } : {})
    })
  }

  const sample = (name: string, durationMs: number, detail?: PerfDetail): void => {
    if (!enabled) return
    const normalizedName = normalizeName(name)
    if (!normalizedName || !Number.isFinite(durationMs)) return
    const nowMs = clock()
    rotateBuckets(nowMs)
    const state = samples.get(normalizedName) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      over16Ms: 0,
      over50Ms: 0
    }
    const duration = Math.max(0, durationMs)
    state.count += 1
    state.totalMs += duration
    state.maxMs = Math.max(state.maxMs, duration)
    state.lastMs = duration
    if (duration >= 16) state.over16Ms += 1
    if (duration >= 50) state.over50Ms += 1
    samples.set(normalizedName, state)
    pushEvent({
      atMs: nowMs,
      kind: 'sample',
      name: normalizedName,
      durationMs: round(duration),
      ...(detail ? { detail: sanitizeDetail(detail) } : {})
    })
  }

  const snapshot = (): PerfSnapshot => {
    const nowMs = clock()
    if (enabled) rotateBuckets(nowMs)
    const counterEntries = [...counters.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, state]) => [name, { ...state }] as const)
    const sampleEntries = [...samples.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, state]) => [name, {
        count: state.count,
        avgMs: state.count > 0 ? round(state.totalMs / state.count) : 0,
        maxMs: round(state.maxMs),
        lastMs: round(state.lastMs),
        over16Ms: state.over16Ms,
        over50Ms: state.over50Ms
      }] as const)
    return {
      enabled,
      startedAtMs,
      uptimeMs: Math.max(0, round(nowMs - startedAtMs)),
      counters: Object.fromEntries(counterEntries),
      samples: Object.fromEntries(sampleEntries),
      recentEvents: recentEvents.slice()
    }
  }

  const reset = (): void => {
    counters.clear()
    samples.clear()
    recentEvents.splice(0)
    currentSecondCounts = new Map()
    previousSecondCounts = new Map()
    currentSecondBucket = secondBucket(clock())
  }

  const dump = (): PerfSnapshot => {
    const out = snapshot()
    if (typeof console !== 'undefined') {
      console.info('[SciForge perf] snapshot', out)
      console.table(out.counters)
      console.table(out.samples)
    }
    return out
  }

  const expose = (scope = options.globalScope): void => {
    if (!enabled || !scope) return
    scope.__SCIFORGE_PERF__ = {
      snapshot,
      reset,
      recentEvents: () => recentEvents.slice(),
      dump
    }
  }

  const installLongTaskObserver = (): void => {
    if (!enabled || longTaskObserver || typeof PerformanceObserver === 'undefined') return
    const supported = PerformanceObserver.supportedEntryTypes ?? []
    if (!supported.includes('longtask')) return
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          sample('browser.longtask', entry.duration, {
            name: entry.name,
            startTime: round(entry.startTime)
          })
        }
      })
      longTaskObserver.observe({ entryTypes: ['longtask'] })
    } catch {
      longTaskObserver = null
    }
  }

  const now = (): number => enabled ? clock() : 0

  return {
    enabled,
    now,
    count,
    sample,
    snapshot,
    reset,
    dump,
    expose,
    installLongTaskObserver
  }
}

export const performanceMonitor = createPerformanceMonitor({
  globalScope: typeof window !== 'undefined' ? window : undefined
})

performanceMonitor.expose()
performanceMonitor.installLongTaskObserver()

export function trackZustandSet<State extends object>(
  storeName: string,
  set: StateSetter<State>
): StateSetter<State> {
  if (!performanceMonitor.enabled) return set
  return (partial) => {
    performanceMonitor.count(`zustand.${storeName}.set`)
    if (typeof partial === 'function') {
      set((state) => {
        const startedAt = performanceMonitor.now()
        const patch = partial(state)
        recordPatch(storeName, patch, performanceMonitor.now() - startedAt)
        return patch
      })
      return
    }
    recordPatch(storeName, partial, 0)
    set(partial)
  }
}

function recordPatch<State extends object>(
  storeName: string,
  patch: Partial<State>,
  reducerDurationMs: number
): void {
  const keys = Object.keys(patch)
  performanceMonitor.count(`zustand.${storeName}.patchKeys`, keys.length)
  if (reducerDurationMs > 0) {
    performanceMonitor.sample(`zustand.${storeName}.reducer`, reducerDurationMs, {
      keys: keys.slice(0, 12).join(',')
    })
  }
  for (const key of keys.slice(0, 16)) {
    performanceMonitor.count(`zustand.${storeName}.key.${key}`)
  }
}

function defaultEnabled(): boolean {
  return Boolean(import.meta.env.DEV && typeof window !== 'undefined')
}

function defaultClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function secondBucket(ms: number): number {
  return Math.floor(ms / 1000)
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, '.')
}

function sanitizeDetail(detail: PerfDetail): PerfDetail {
  const out: PerfDetail = {}
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue
    out[key] = typeof value === 'string' && value.length > DETAIL_STRING_LIMIT
      ? `${value.slice(0, DETAIL_STRING_LIMIT)}...`
      : value
  }
  return out
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
