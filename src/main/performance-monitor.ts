import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

type PerfDetailValue = string | number | boolean | null | undefined

type PerfDetail = Record<string, PerfDetailValue>

type PerfEvent = {
  atMs: number
  kind: 'counter' | 'sample'
  name: string
  value?: number
  durationMs?: number
  detail?: PerfDetail
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

const DEFAULT_EVENT_LIMIT = 240
const DETAIL_STRING_LIMIT = 120

function createMainPerformanceMonitor() {
  const enabled = process.env.SCIFORGE_PERF !== '0'
  const startedAtMs = performance.now()
  const counters = new Map<string, CounterState>()
  const samples = new Map<string, SampleState>()
  const recentEvents: PerfEvent[] = []
  let currentSecondBucket = secondBucket(startedAtMs)
  let currentSecondCounts = new Map<string, number>()
  let previousSecondCounts = new Map<string, number>()
  let lastEventLoopUtilization = performance.eventLoopUtilization()
  const eventLoopDelay = enabled ? monitorEventLoopDelay({ resolution: 20 }) : null
  eventLoopDelay?.enable()

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
    while (recentEvents.length > DEFAULT_EVENT_LIMIT) recentEvents.shift()
  }

  const count = (name: string, value = 1, detail?: PerfDetail): void => {
    if (!enabled) return
    const normalizedName = normalizeName(name)
    if (!normalizedName || !Number.isFinite(value) || value === 0) return
    const nowMs = performance.now()
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
    const nowMs = performance.now()
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

  const snapshot = () => {
    const nowMs = performance.now()
    if (enabled) rotateBuckets(nowMs)
    const totalEventLoop = performance.eventLoopUtilization()
    const intervalEventLoop = performance.eventLoopUtilization(lastEventLoopUtilization)
    lastEventLoopUtilization = totalEventLoop
    const delay = eventLoopDelay
      ? {
          meanMs: nsToMs(eventLoopDelay.mean),
          maxMs: nsToMs(eventLoopDelay.max),
          p95Ms: nsToMs(eventLoopDelay.percentile(95))
        }
      : null
    eventLoopDelay?.reset()

    const memory = process.memoryUsage()
    return {
      enabled,
      startedAtMs,
      uptimeMs: Math.max(0, round(nowMs - startedAtMs)),
      eventLoop: {
        totalUtilization: round(totalEventLoop.utilization * 100),
        intervalUtilization: round(intervalEventLoop.utilization * 100),
        intervalActiveMs: round(intervalEventLoop.active),
        intervalIdleMs: round(intervalEventLoop.idle),
        delay
      },
      process: {
        pid: process.pid,
        uptimeMs: round(process.uptime() * 1000),
        rssMb: bytesToMb(memory.rss),
        heapTotalMb: bytesToMb(memory.heapTotal),
        heapUsedMb: bytesToMb(memory.heapUsed),
        externalMb: bytesToMb(memory.external),
        arrayBuffersMb: bytesToMb(memory.arrayBuffers)
      },
      counters: Object.fromEntries([...counters.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, state]) => [name, { ...state }] as const)),
      samples: Object.fromEntries([...samples.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, state]) => [name, {
          count: state.count,
          avgMs: state.count > 0 ? round(state.totalMs / state.count) : 0,
          maxMs: round(state.maxMs),
          lastMs: round(state.lastMs),
          over16Ms: state.over16Ms,
          over50Ms: state.over50Ms
        }] as const)),
      recentEvents: recentEvents.slice()
    }
  }

  const reset = (): void => {
    counters.clear()
    samples.clear()
    recentEvents.splice(0)
    currentSecondCounts = new Map()
    previousSecondCounts = new Map()
    currentSecondBucket = secondBucket(performance.now())
    lastEventLoopUtilization = performance.eventLoopUtilization()
    eventLoopDelay?.reset()
  }

  return {
    enabled,
    now: () => enabled ? performance.now() : 0,
    count,
    sample,
    snapshot,
    reset
  }
}

export const mainPerformanceMonitor = createMainPerformanceMonitor()

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

function nsToMs(value: number): number {
  return Number.isFinite(value) ? round(value / 1_000_000) : 0
}

function bytesToMb(value: number): number {
  return round(value / 1024 / 1024)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
