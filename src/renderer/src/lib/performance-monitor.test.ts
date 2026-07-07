import { describe, expect, it, vi } from 'vitest'
import { createPerformanceMonitor, type PerfConsoleApi } from './performance-monitor'

describe('performance monitor', () => {
  it('tracks counters, samples, and second buckets', () => {
    let now = 10
    const monitor = createPerformanceMonitor({
      enabled: true,
      clock: () => now,
      eventLimit: 5
    })

    monitor.count('runtime.event')
    monitor.count('runtime.event', 2)
    monitor.sample('react.commit.MessageTimeline', 20.4)
    now = 1_020
    monitor.count('runtime.delta.raw', 3)

    const snapshot = monitor.snapshot()

    expect(snapshot.enabled).toBe(true)
    expect(snapshot.counters['runtime.event']).toEqual({
      total: 3,
      currentSecond: 0,
      previousSecond: 3
    })
    expect(snapshot.counters['runtime.delta.raw']).toEqual({
      total: 3,
      currentSecond: 3,
      previousSecond: 0
    })
    expect(snapshot.samples['react.commit.MessageTimeline']).toMatchObject({
      count: 1,
      avgMs: 20.4,
      over16Ms: 1,
      over50Ms: 0
    })
  })

  it('exposes a resettable console API', () => {
    let now = 0
    const scope: { __SCIFORGE_PERF__?: PerfConsoleApi } = {}
    const monitor = createPerformanceMonitor({
      enabled: true,
      clock: () => now,
      globalScope: scope
    })

    monitor.expose()
    monitor.count('zustand.chat.set')
    now = 50

    expect(scope.__SCIFORGE_PERF__?.snapshot().counters['zustand.chat.set']?.total).toBe(1)
    scope.__SCIFORGE_PERF__?.reset()
    expect(scope.__SCIFORGE_PERF__?.snapshot().counters['zustand.chat.set']).toBeUndefined()
  })

  it('keeps dump usable for ad hoc debugging', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const table = vi.spyOn(console, 'table').mockImplementation(() => undefined)
    const monitor = createPerformanceMonitor({ enabled: true, clock: () => 0 })

    monitor.count('runtime.tool')
    expect(monitor.snapshot().counters['runtime.tool']?.total).toBe(1)

    const dumped = monitor.dump()
    expect(dumped.counters['runtime.tool']?.total).toBe(1)
    expect(monitor.snapshot().recentEvents.length).toBeGreaterThan(0)

    info.mockRestore()
    table.mockRestore()
  })
})
