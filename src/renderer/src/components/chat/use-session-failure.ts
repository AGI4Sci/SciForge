import { useEffect, useState } from 'react'
import { readLatestSessionFailure, type SessionFailureFact } from '../../store/chat-session-admission'

/** Exact Session history drives an action affordance, independently of pending queue hydration. */
export function useSessionFailure({ runtimeId, threadId, runtimeReady, refreshKey, busy, latestTurnId, latestTurnStatus }: {
  runtimeId?: string
  threadId: string | null
  runtimeReady: boolean
  refreshKey: number
  busy: boolean
  latestTurnId?: string
  latestTurnStatus?: string
}): SessionFailureFact | null {
  const key = runtimeId && threadId ? JSON.stringify([runtimeId, threadId, latestTurnId, latestTurnStatus]) : null
  const [value, setValue] = useState<{ key: string; refreshKey: number; fact: SessionFailureFact | null } | null>(null)
  useEffect(() => {
    if (!runtimeId || !threadId || !runtimeReady || !key || busy) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = (attempt: number): void => {
      void readLatestSessionFailure({ runtimeId, threadId }).then(fact => {
        if (!current) return
        // The catalog's turn summary may be stale or absent after Stop. Only
        // the exact Session's Host ledger may identify its latest failed input.
        if (!fact && attempt < 3) {
          timer = setTimeout(() => refresh(attempt + 1), [100, 250, 500][attempt])
          return
        }
        setValue({ key, refreshKey, fact })
      }).catch(() => {
        if (current) setValue({ key, refreshKey, fact: null })
      })
    }
    refresh(0)
    return () => { current = false; if (timer !== undefined) clearTimeout(timer) }
  }, [runtimeId, threadId, runtimeReady, key, refreshKey, busy, latestTurnId, latestTurnStatus])
  return runtimeReady && !busy && value?.key === key && value.refreshKey === refreshKey ? value.fact : null
}
