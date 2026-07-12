import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRuntimeId } from '@shared/app-settings'
import { getProvider } from '../../agent/registry'
import {
  buildChildAgentAttentionSummary,
  loadChildAgentAttentionTree,
  type ChildAgentAttentionSummary
} from './child-agent-attention'

const EMPTY_SUMMARY: ChildAgentAttentionSummary = {
  targets: [],
  actionableTargets: [],
  counts: { total: 0, waitingUserInput: 0, waitingApproval: 0, failed: 0, unread: 0, running: 0 },
  primaryTarget: null
}

export type UseChildAgentAttentionInput = {
  rootThreadId: string | null
  rootLabel?: string
  runtimeId?: AgentRuntimeId
  runtimeReady: boolean
  childRefreshKey: number
  unreadThreadIds: Readonly<Record<string, boolean>>
  /** Set to zero to rely solely on runtime refresh events. */
  pollIntervalMs?: number
}

export type UseChildAgentAttentionResult = {
  summary: ChildAgentAttentionSummary
  loading: boolean
  degraded: boolean
  error: string | null
  refresh: () => void
}

/**
 * Watches the full child tree for global attention indicators. Only active/unknown
 * child details are polled; completed branches are still traversed to discover
 * active grandchildren. Runtime child refresh events trigger an immediate reload.
 */
export function useChildAgentAttention(input: UseChildAgentAttentionInput): UseChildAgentAttentionResult {
  const [summary, setSummary] = useState<ChildAgentAttentionSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualRefreshKey, setManualRefreshKey] = useState(0)
  const requestRef = useRef(0)
  const unreadThreadIds = useMemo(() => input.unreadThreadIds, [input.unreadThreadIds])
  const refresh = useCallback(() => setManualRefreshKey((key) => key + 1), [])

  useEffect(() => {
    const rootThreadId = input.rootThreadId?.trim()
    if (!rootThreadId || !input.runtimeReady) {
      setSummary(EMPTY_SUMMARY)
      setLoading(false)
      setDegraded(false)
      setError(null)
      return undefined
    }

    let cancelled = false
    let interval: ReturnType<typeof window.setInterval> | null = null
    const provider = getProvider()
    provider.rememberThreadRuntime?.(rootThreadId, input.runtimeId)
    if (typeof provider.listThreadChildren !== 'function') {
      setSummary(EMPTY_SUMMARY)
      setLoading(false)
      setDegraded(false)
      setError(null)
      return undefined
    }
    const source = {
      listThreadChildren: (
        threadId: string,
        options?: { limit?: number }
      ) => provider.listThreadChildren!(threadId, options),
      getThreadDetail: (threadId: string) => provider.getThreadDetail(threadId),
      rememberThreadRuntime: provider.rememberThreadRuntime?.bind(provider)
    }
    let inFlight = false

    const load = async (showLoading: boolean): Promise<void> => {
      if (inFlight) return
      inFlight = true
      const request = ++requestRef.current
      if (showLoading) setLoading(true)
      try {
        const tree = await loadChildAgentAttentionTree({
          rootThreadId,
          source,
          shouldReadDetail: (child) => child.status === 'queued'
            || child.status === 'running'
            || child.status === 'unknown'
        })
        if (cancelled || request !== requestRef.current) return
        setSummary(buildChildAgentAttentionSummary({
          rootThreadId,
          rootLabel: input.rootLabel,
          children: tree.children,
          snapshots: tree.snapshots,
          unreadThreadIds
        }))
        setDegraded(tree.degraded)
        setError(tree.errors[0]?.message ?? null)
      } catch (reason) {
        if (!cancelled && request === requestRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setDegraded(true)
        }
      } finally {
        inFlight = false
        if (!cancelled && request === requestRef.current) setLoading(false)
      }
    }

    void load(true)
    const pollIntervalMs = Math.max(0, input.pollIntervalMs ?? 5000)
    if (pollIntervalMs > 0) interval = window.setInterval(() => void load(false), pollIntervalMs)
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [
    input.childRefreshKey,
    input.pollIntervalMs,
    input.rootLabel,
    input.rootThreadId,
    input.runtimeId,
    input.runtimeReady,
    manualRefreshKey,
    unreadThreadIds
  ])

  return { summary, loading, degraded, error, refresh }
}
