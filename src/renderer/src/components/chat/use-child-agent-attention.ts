import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRuntimeId } from '@shared/app-settings'
import {
  isAgentRuntimeTerminalTurnState,
  normalizeAgentRuntimeTurnState
} from '@shared/agent-runtime-contract'
import { getProvider } from '../../agent/registry'
import {
  buildChildAgentAttentionSummary,
  createChildAgentAttentionEventSink,
  loadChildAgentAttentionTree,
  updateChildAgentAttentionStatus,
  type ChildAgentAttentionSnapshot,
  type ChildAgentAttentionSummary
} from './child-agent-attention'

const EMPTY_SUMMARY: ChildAgentAttentionSummary = {
  targets: [],
  actionableTargets: [],
  counts: { total: 0, waitingUserInput: 0, waitingApproval: 0, failed: 0, unread: 0, running: 0 },
  primaryTarget: null
}

const CHILD_ATTENTION_FALLBACK_POLL_MS = 30_000

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
  const cacheScopeRef = useRef('')
  const snapshotCacheRef = useRef<Record<string, ChildAgentAttentionSnapshot>>({})
  const detailAttemptedThreadIdsRef = useRef(new Set<string>())
  const childrenRef = useRef<Parameters<typeof buildChildAgentAttentionSummary>[0]['children']>([])
  const reloadRef = useRef<((showLoading: boolean) => void) | null>(null)
  const publishRef = useRef<(() => void) | null>(null)
  const refreshSignalsRef = useRef({ childRefreshKey: input.childRefreshKey, manualRefreshKey })
  const presentationRef = useRef({ rootLabel: input.rootLabel, unreadThreadIds: input.unreadThreadIds })
  presentationRef.current = { rootLabel: input.rootLabel, unreadThreadIds: input.unreadThreadIds }
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
    const scope = `${input.runtimeId ?? ''}\u0000${rootThreadId}`
    if (cacheScopeRef.current !== scope) {
      cacheScopeRef.current = scope
      snapshotCacheRef.current = {}
      detailAttemptedThreadIdsRef.current.clear()
      childrenRef.current = []
    }
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
      getRecentThreadView: (threadId: string) => provider.getRecentThreadView(threadId),
      getThreadStatus: (threadId: string) => provider.getThreadStatus(threadId),
      rememberThreadRuntime: provider.rememberThreadRuntime?.bind(provider)
    }
    let inFlight = false
    let reloadRequested = false
    const subscriptions = new Map<string, AbortController>()

    const publishSummary = (): void => {
      if (cancelled) return
      setSummary(buildChildAgentAttentionSummary({
        rootThreadId,
        rootLabel: presentationRef.current.rootLabel,
        children: childrenRef.current,
        snapshots: snapshotCacheRef.current,
        unreadThreadIds: presentationRef.current.unreadThreadIds
      }))
    }
    publishRef.current = publishSummary

    const startSubscription = (threadId: string): void => {
      const snapshot = snapshotCacheRef.current[threadId]
      if (!snapshot || subscriptions.has(threadId)) return
      const controller = new AbortController()
      subscriptions.set(threadId, controller)
      const sink = createChildAgentAttentionEventSink({
        threadId,
        getSnapshot: () => snapshotCacheRef.current[threadId],
        updateSnapshot: (next, attentionChanged) => {
          snapshotCacheRef.current = {
            ...snapshotCacheRef.current,
            [threadId]: next
          }
          if (isAgentRuntimeTerminalTurnState(normalizeAgentRuntimeTurnState(next.threadStatus))) {
            controller.abort()
            subscriptions.delete(threadId)
          }
          if (attentionChanged) publishSummary()
        },
        onError: (reason) => {
          if (cancelled || controller.signal.aborted) return
          setError(reason.message)
          setDegraded(true)
        }
      })
      void provider.subscribeThreadEvents(threadId, snapshot.latestSeq, sink, controller.signal)
        .catch((reason: unknown) => {
          sink.onError(reason instanceof Error ? reason : new Error(String(reason)))
        })
        .finally(() => {
          if (subscriptions.get(threadId) === controller) subscriptions.delete(threadId)
        })
    }

    const load = async (showLoading: boolean): Promise<void> => {
      if (inFlight) {
        reloadRequested = true
        return
      }
      inFlight = true
      const request = ++requestRef.current
      if (showLoading) setLoading(true)
      try {
        const tree = await loadChildAgentAttentionTree({
          rootThreadId,
          source,
          cachedSnapshots: snapshotCacheRef.current,
          detailAttemptedThreadIds: detailAttemptedThreadIdsRef.current,
          shouldReadDetail: (child) => child.status === 'queued'
            || child.status === 'running'
            || child.status === 'unknown'
        })
        if (cancelled || request !== requestRef.current) return
        childrenRef.current = tree.children
        const mergedSnapshots = { ...snapshotCacheRef.current }
        for (const [threadId, incoming] of Object.entries(tree.snapshots)) {
          const current = snapshotCacheRef.current[threadId]
          mergedSnapshots[threadId] = current && current.latestSeq > incoming.latestSeq
            ? updateChildAgentAttentionStatus(current, incoming.threadStatus)
            : incoming
        }
        snapshotCacheRef.current = mergedSnapshots
        const subscriptionThreadIds = new Set(tree.children
          .filter((child) => child.status === 'queued' || child.status === 'running' || child.status === 'unknown')
          .map((child) => child.openAsThreadRef?.threadId?.trim())
          .filter((threadId): threadId is string => Boolean(threadId && tree.snapshots[threadId])))
        for (const [threadId, controller] of subscriptions) {
          if (subscriptionThreadIds.has(threadId)) continue
          controller.abort()
          subscriptions.delete(threadId)
        }
        for (const threadId of subscriptionThreadIds) startSubscription(threadId)
        publishSummary()
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
        if (!cancelled && reloadRequested) {
          reloadRequested = false
          void load(false)
        }
      }
    }

    const requestReload = (showLoading: boolean): void => {
      void load(showLoading)
    }
    reloadRef.current = requestReload

    requestReload(true)
    // Runtime child-refresh events are the primary update path. Polling is a
    // low-frequency recovery mechanism for missed events, not a live ticker.
    const pollIntervalMs = Math.max(
      0,
      input.pollIntervalMs ?? CHILD_ATTENTION_FALLBACK_POLL_MS
    )
    if (pollIntervalMs > 0) interval = window.setInterval(() => void load(false), pollIntervalMs)
    return () => {
      cancelled = true
      if (reloadRef.current === requestReload) reloadRef.current = null
      if (publishRef.current === publishSummary) publishRef.current = null
      if (interval) window.clearInterval(interval)
      for (const controller of subscriptions.values()) controller.abort()
      subscriptions.clear()
    }
  }, [
    input.pollIntervalMs,
    input.rootThreadId,
    input.runtimeId,
    input.runtimeReady
  ])

  useEffect(() => {
    const previous = refreshSignalsRef.current
    refreshSignalsRef.current = { childRefreshKey: input.childRefreshKey, manualRefreshKey }
    if (
      previous.childRefreshKey !== input.childRefreshKey
      || previous.manualRefreshKey !== manualRefreshKey
    ) {
      reloadRef.current?.(false)
    }
  }, [input.childRefreshKey, manualRefreshKey])

  useEffect(() => {
    publishRef.current?.()
  }, [input.rootLabel, unreadThreadIds])

  return { summary, loading, degraded, error, refresh }
}
