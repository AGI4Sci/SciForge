import { useCallback, useEffect, useRef, useState } from 'react'

import type { CollaborationStatusSnapshot, CollaborationTaskView } from '../contract.js'
import type { CollaborationRendererClient } from './collaboration-capability-client.js'

/** Local status reads are cheap main-process cache reads. */
export const COLLABORATION_STATUS_POLL_INTERVAL_MS = 3_000

type CollaborationRefreshValue = Readonly<{
  snapshot: CollaborationStatusSnapshot
  tasks: readonly CollaborationTaskView[]
}>

export function createCollaborationRefreshCoordinator(input: Readonly<{
  load: () => Promise<CollaborationRefreshValue>
  apply: (value: CollaborationRefreshValue) => void
  reject: (error: unknown) => void
  setLoading: (loading: boolean) => void
}>): Readonly<{
  request: (options?: Readonly<{ showLoading?: boolean }>) => Promise<void>
  dispose: () => void
}> {
  let active = true
  let pending = false
  let loadingRequested = false
  let inFlight: Promise<void> | null = null

  const run = async (): Promise<void> => {
    try {
      while (active) {
        pending = false
        let value: CollaborationRefreshValue
        try {
          value = await input.load()
        } catch (error) {
          if (!active) return
          if (pending) continue
          input.reject(error)
          return
        }
        if (!active) return
        if (pending) continue
        input.apply(value)
        return
      }
    } finally {
      const stopLoading = loadingRequested
      loadingRequested = false
      inFlight = null
      if (active && stopLoading) input.setLoading(false)
    }
  }

  return Object.freeze({
    request: (options = {}) => {
      if (!active) return Promise.resolve()
      pending = true
      if (options.showLoading !== false && !loadingRequested) {
        loadingRequested = true
        input.setLoading(true)
      }
      inFlight ??= run()
      return inFlight
    },
    dispose: () => {
      active = false
      pending = false
    }
  })
}

type CollaborationRefreshCoordinator = ReturnType<typeof createCollaborationRefreshCoordinator>

export type CollaborationStatusState = Readonly<{
  snapshot: CollaborationStatusSnapshot | null
  tasks: readonly CollaborationTaskView[]
  loading: boolean
  error: string | null
  /** Re-reads the local status cache. */
  refresh: (options?: Readonly<{ showLoading?: boolean }>) => Promise<void>
  /** Re-reads the Cloud Dashboard projections, then the local status cache. */
  refreshDashboards: () => Promise<void>
}>

/**
 * The shell's one status read: participant, connection, Dashboard projections,
 * Agent/Device/notification slices and local Worker offers.
 */
export function useCollaborationStatus(
  client: CollaborationRendererClient,
  options: Readonly<{ active: boolean; unavailableMessage: string }>
): CollaborationStatusState {
  const [snapshot, setSnapshot] = useState<CollaborationStatusSnapshot | null>(null)
  const [tasks, setTasks] = useState<readonly CollaborationTaskView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const coordinatorRef = useRef<CollaborationRefreshCoordinator | null>(null)
  const { unavailableMessage } = options

  useEffect(() => {
    // Create the coordinator inside the effect's lifecycle. React StrictMode
    // replays effect setup/cleanup in development; resetting the ref during
    // cleanup ensures the replay gets a fresh live coordinator.
    const coordinator = createCollaborationRefreshCoordinator({
      load: async () => {
        const [nextSnapshot, taskList] = await Promise.all([
          client.readStatus(),
          client.listTasks()
        ])
        return { snapshot: nextSnapshot, tasks: taskList.tasks }
      },
      apply: ({ snapshot: nextSnapshot, tasks: nextTasks }) => {
        setSnapshot(nextSnapshot)
        setTasks(nextTasks)
        setError(null)
      },
      reject: (cause) => setError(cause instanceof Error && cause.message
        ? cause.message
        : unavailableMessage),
      setLoading
    })
    coordinatorRef.current = coordinator
    void coordinator.request()
    return () => {
      coordinator.dispose()
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null
    }
  }, [client, unavailableMessage])

  const refresh = useCallback(
    (refreshOptions?: Readonly<{ showLoading?: boolean }>) =>
      coordinatorRef.current?.request(refreshOptions) ?? Promise.resolve(),
    []
  )

  const refreshDashboards = useCallback(async () => {
    try {
      await client.retrySynchronization({ scope: 'dashboard' })
    } finally {
      await refresh({ showLoading: false })
    }
  }, [client, refresh])

  useEffect(() => {
    if (!options.active) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      await refresh({ showLoading: false }).catch(() => undefined)
      if (live) timer = setTimeout(() => void poll(), COLLABORATION_STATUS_POLL_INTERVAL_MS)
    }
    timer = setTimeout(() => void poll(), COLLABORATION_STATUS_POLL_INTERVAL_MS)
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [options.active, refresh])

  return { snapshot, tasks, loading, error, refresh, refreshDashboards }
}
