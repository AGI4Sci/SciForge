const DEFAULT_INTERVAL_MS = 5 * 60 * 1000

type ChromiumMemoryInfo = {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

function chromiumMemoryInfo(): ChromiumMemoryInfo | null {
  const memory = (performance as { memory?: ChromiumMemoryInfo }).memory
  return memory ?? null
}

function toMb(bytes: number): string {
  return (bytes / 1048576).toFixed(1)
}

export function startRendererMemoryTelemetry(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (typeof window === 'undefined') return
  if (!chromiumMemoryInfo()) return
  const log = (): void => {
    const memory = chromiumMemoryInfo()
    if (!memory) return
    console.info(
      `[renderer-memory] used=${toMb(memory.usedJSHeapSize)}MB ` +
      `total=${toMb(memory.totalJSHeapSize)}MB ` +
      `limit=${toMb(memory.jsHeapSizeLimit)}MB`
    )
  }
  const interval = window.setInterval(log, intervalMs)
  window.addEventListener('beforeunload', () => window.clearInterval(interval), { once: true })
  log()
}
