import { useEffect, useState } from 'react'
import type { SiYuanServiceStatus, SiYuanServiceConfigureRequest, SiYuanServiceCheckResult } from '../editor-contract.js'

export type SiYuanServiceControls = Readonly<{
  status: () => Promise<SiYuanServiceStatus>
  configure: (input: SiYuanServiceConfigureRequest) => Promise<SiYuanServiceStatus>
  check: () => Promise<SiYuanServiceCheckResult>
}>

/** Serialize status reads and discard late results when the surface is hidden. */
export function useSiYuanServiceStatus(service: SiYuanServiceControls, active: boolean) {
  const [status, setStatus] = useState<SiYuanServiceStatus>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const next = await service.status()
        if (!cancelled) setError(undefined)
        if (!cancelled) setStatus(previous =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : '云笔记配置读取失败，请检查设置。')
        if (!cancelled) setStatus(previous => previous
          ? { ...previous, identity: { state: 'unavailable' } } : undefined)
      } finally {
        if (!cancelled) timer = setTimeout(() => { void poll() }, 1_000)
      }
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, service])
  return [status, setStatus, error] as const
}
