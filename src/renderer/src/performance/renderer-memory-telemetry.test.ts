// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startRendererMemoryTelemetry } from './renderer-memory-telemetry'

describe('startRendererMemoryTelemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function fakeMemory(usedMb: number): void {
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: {
        usedJSHeapSize: usedMb * 1048576,
        totalJSHeapSize: (usedMb + 4) * 1048576,
        jsHeapSizeLimit: 4096 * 1048576
      }
    })
  }

  it('logs one renderer memory line per interval tick', () => {
    fakeMemory(100)
    startRendererMemoryTelemetry(60_000)
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.info).mock.calls[0]?.[0]).toContain('[renderer-memory]')
    expect(vi.mocked(console.info).mock.calls[0]?.[0]).toContain('used=100.0MB')

    fakeMemory(150)
    vi.advanceTimersByTime(60_000)
    expect(console.info).toHaveBeenCalledTimes(2)
    expect(vi.mocked(console.info).mock.calls[1]?.[0]).toContain('used=150.0MB')
  })

  it('stops logging after the page unloads', () => {
    fakeMemory(100)
    startRendererMemoryTelemetry(60_000)
    expect(console.info).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('beforeunload'))
    vi.advanceTimersByTime(300_000)
    expect(console.info).toHaveBeenCalledTimes(1)
  })
})
