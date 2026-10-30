import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logInfo } from './logger'
import { mainPerformanceMonitor } from './performance-monitor'

vi.mock('./logger', () => ({
  logInfo: vi.fn()
}))

describe('mainPerformanceMonitor memory telemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    mainPerformanceMonitor.stopMemoryTelemetry()
    vi.useRealTimers()
    vi.mocked(logInfo).mockClear()
  })

  it('logs one INFO memory line per interval tick', () => {
    mainPerformanceMonitor.startMemoryTelemetry(60_000)

    expect(logInfo).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(logInfo).toHaveBeenCalledTimes(1)

    const [category, line] = vi.mocked(logInfo).mock.calls[0] ?? []
    expect(category).toBe('main-memory')
    expect(line).toMatch(/^rss=\d+(\.\d+)?MB heapUsed=\d+(\.\d+)?MB heapTotal=\d+(\.\d+)?MB external=\d+(\.\d+)?MB arrayBuffers=\d+(\.\d+)?MB$/u)

    vi.advanceTimersByTime(120_000)
    expect(logInfo).toHaveBeenCalledTimes(3)
  })

  it('stops logging after stopMemoryTelemetry', () => {
    mainPerformanceMonitor.startMemoryTelemetry(60_000)
    vi.advanceTimersByTime(60_000)
    expect(logInfo).toHaveBeenCalledTimes(1)

    mainPerformanceMonitor.stopMemoryTelemetry()
    vi.advanceTimersByTime(600_000)
    expect(logInfo).toHaveBeenCalledTimes(1)
  })

  it('replaces the previous interval when started again', () => {
    mainPerformanceMonitor.startMemoryTelemetry(60_000)
    mainPerformanceMonitor.startMemoryTelemetry(30_000)

    vi.advanceTimersByTime(30_000)
    expect(logInfo).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_000)
    expect(logInfo).toHaveBeenCalledTimes(2)
  })
})
