import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { Dna, Loader2, Plus, RefreshCw } from 'lucide-react'
import {
  biologyRoomFormatFromPath,
  type BiologyRoomAsset,
  type BiologyRoomEvent,
  type BiologyRoomHistoryResult,
  type BiologyRoomManifest,
  type BiologyRoomMutationOperation,
  type BiologyRoomSelection,
  type BiologyRoomSummary
} from '@shared/biology-room'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { CapabilityBoundBiologyRoomManifest } from '@shared/sciforge-api'
import type { BioGymRunEvent } from '@shared/biogym'
import {
  BiologyRoomShell,
  biologyRoomAssetBlockingIssue,
  biologySelectionFromWorkspaceSelection,
  biologyRoomWatchPaths,
  buildBiologyRoomVisibleContextComponent,
  isBiologyRoomTrack,
  isBiologyRoomTrackVisible,
  resolveActiveBiologyRoomAsset,
  resolveBiologyRoomReference,
  type BiologyRoomAssetSources,
  type BiologyRoomProvenanceEntry,
  type BiologyRoomRevisionConflict,
  type BiologyRoomRevisionSummary
} from '../biology-room'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import { registerVisibleContextComponent } from '../lib/visible-context'
import {
  resolveBioGymDisplayedAssetId,
  shouldResetBioGymFollowRun
} from '../biology-room/biogym-run-ui'
import { createBiologyPreviewSessionLease } from '../biology-room/preview-session-lease'

type PreviewTransportState = {
  planKey: string | null
  status: 'loading' | 'ready' | 'error'
  assetSources: BiologyRoomAssetSources
  error: string | null
}

type BiologyPreviewTransportAsset = Pick<
  BiologyRoomAsset,
  'id' | 'path' | 'indexPaths' | 'indexFingerprints' | 'sha256'
>

type BiologyPreviewTransportPlan = {
  activeAssetId: string
  assets: BiologyPreviewTransportAsset[]
}

type PendingBiologyRoomMutation = {
  operation: BiologyRoomMutationOperation
  waiters: Array<(success: boolean) => void>
}

const EMPTY_PREVIEW_TRANSPORT: PreviewTransportState = {
  planKey: null,
  status: 'loading',
  assetSources: {},
  error: null
}

const LAST_BIOLOGY_ROOM_KEY_PREFIX = 'sciforge.biology.lastRoom'

export type BiologyRoomPanelBridgeProps = {
  workspaceRoot: string
  initialTarget?: WorkspaceFileTarget | null
  initialRoomId?: string | null
  runEvent?: BioGymRunEvent | null
  className?: string
  visibleContextActive?: boolean
  onAddSelectionToChat?: (context: string, selection: BiologyRoomSelection) => void
  onClose?: () => void
}

export function BiologyRoomPanelBridge({
  workspaceRoot,
  initialTarget,
  initialRoomId,
  runEvent,
  className,
  visibleContextActive = true,
  onAddSelectionToChat,
  onClose
}: BiologyRoomPanelBridgeProps): ReactElement {
  const [room, setRoom] = useState<CapabilityBoundBiologyRoomManifest | null>(null)
  const [rooms, setRooms] = useState<BiologyRoomSummary[]>([])
  const [history, setHistory] = useState<BiologyRoomHistoryResult | null>(null)
  const [preview, setPreview] = useState<PreviewTransportState>(EMPTY_PREVIEW_TRANSPORT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [conflict, setConflict] = useState<BiologyRoomRevisionConflict | null>(null)
  const [followRun, setFollowRun] = useState(true)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialTargetRef = useRef(initialTarget)
  const initialOpenCoordinatorRef = useRef<BiologyRoomInitialOpenCoordinator | null>(null)
  const roomRef = useRef<CapabilityBoundBiologyRoomManifest | null>(null)
  const mutationQueueRef = useRef<PendingBiologyRoomMutation[]>([])
  const mutationRunningRef = useRef(false)
  const followRunRef = useRef(true)
  const pinnedAssetIdRef = useRef<string | null>(null)
  const runEventRef = useRef<BioGymRunEvent | null>(runEvent ?? null)
  if (!initialOpenCoordinatorRef.current) {
    initialOpenCoordinatorRef.current = createBiologyRoomInitialOpenCoordinator()
  }
  initialTargetRef.current = initialTarget
  const initialTargetKey = biologyRoomInitialTargetKey(workspaceRoot, initialTarget)

  const loadHistory = useCallback(async (manifest: BiologyRoomManifest): Promise<void> => {
    const api = window.sciforge?.biologyRoom
    if (!api) return
    const result = await api.history({
      workspaceRoot,
      roomId: manifest.roomId,
      limit: 50
    })
    setHistory(result)
  }, [workspaceRoot])

  const acceptRoom = useCallback((
    manifest: CapabilityBoundBiologyRoomManifest,
    preferredActiveAssetId?: string
  ): void => {
    writeBrowserStorageItem(lastBiologyRoomStorageKey(workspaceRoot), manifest.roomId)
    roomRef.current = manifest
    const displayedAssetId = resolveBioGymDisplayedAssetId({
      room: manifest,
      followRun: followRunRef.current,
      preferredAssetId: preferredActiveAssetId,
      pinnedAssetId: pinnedAssetIdRef.current
    })
    setRoom(displayedAssetId && displayedAssetId !== manifest.activeAssetId
      ? { ...manifest, activeAssetId: displayedAssetId, selection: undefined }
      : manifest)
    setConflict(null)
    setError(null)
    setWarning(null)
    void loadHistory(manifest).catch((cause) => setError(errorMessage(cause)))
  }, [loadHistory, workspaceRoot])

  const acceptRefreshedRoom = useCallback(async (manifest: BiologyRoomManifest): Promise<void> => {
    const api = window.sciforge?.biologyRoom
    if (!api) throw new Error('Biology Room desktop bridge is unavailable.')
    const result = await api.refresh({
      workspaceRoot,
      roomId: manifest.roomId,
      actor: { kind: 'system' }
    })
    acceptRoom(result.manifest)
    setWarning(result.warnings.length ? result.warnings.join(' ') : null)
  }, [acceptRoom, workspaceRoot])

  const openPath = useCallback(async (
    rawPath: string,
    options: { asReference?: boolean; target?: WorkspaceFileTarget } = {}
  ): Promise<void> => {
    const api = window.sciforge?.biologyRoom
    if (!api) throw new Error('Biology Room desktop bridge is unavailable.')
    const path = relativeBiologyPath(rawPath, workspaceRoot)
    const expectedSha256 = normalizeExpectedSha256(options.target?.integrity?.expectedDigest)
    const result = await api.openOrCreate({
      workspaceRoot,
      path,
      ...(expectedSha256 ? { expectedSha256 } : {}),
      ...(options.asReference !== undefined ? { asReference: options.asReference } : {}),
      actor: { kind: 'user' }
    })
    let manifest = result.manifest
    let refreshWarnings: string[] = []
    if (!result.created) {
      const refreshed = await api.refresh({
        workspaceRoot,
        roomId: manifest.roomId,
        actor: { kind: 'system' }
      })
      manifest = refreshed.manifest
      refreshWarnings = refreshed.warnings
    }
    const targetAsset = manifest.assets.find((asset) => asset.path === path)
    if (!targetAsset) throw new Error(`Biology Room did not register ${path}.`)
    const operations: BiologyRoomMutationOperation[] = []
    if (manifest.activeAssetId !== targetAsset.id) {
      operations.push({ type: 'setActiveAsset', assetId: targetAsset.id })
    }
    if (options.target?.selection) {
      const selection = biologySelectionFromWorkspaceSelection(
        targetAsset.id,
        options.target.selection
      )
      if (selection !== undefined) operations.push({ type: 'setSelection', selection })
    }
    if (operations.length) {
      manifest = (await api.apply({
        workspaceRoot,
        roomId: manifest.roomId,
        baseRevision: manifest.revision,
        operations,
        actor: { kind: 'user' }
      })).manifest
    }
    acceptRoom(manifest, targetAsset.id)
    setWarning(refreshWarnings.length ? refreshWarnings.join(' ') : null)
  }, [acceptRoom, workspaceRoot])

  const loadLatestRoom = useCallback(async (): Promise<void> => {
    const api = window.sciforge?.biologyRoom
    if (!api) throw new Error('Biology Room desktop bridge is unavailable.')
    const listed = await api.list({ workspaceRoot, limit: 100 })
    setRooms(listed)
    const rememberedRoomId = readBrowserStorageItem(lastBiologyRoomStorageKey(workspaceRoot))
    const latest = listed.find((candidate) => candidate.roomId === rememberedRoomId) ?? listed[0]
    if (!latest) {
      roomRef.current = null
      setRoom(null)
      return
    }
    await acceptRefreshedRoom(await api.load({ workspaceRoot, roomId: latest.roomId }))
  }, [acceptRefreshedRoom, workspaceRoot])

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    const directTarget = initialTargetRef.current
    const targetPath = directTarget?.path?.trim()
    const targetRoomId = initialRoomId?.trim()
    const api = window.sciforge?.biologyRoom
    const task = targetRoomId && api
      ? api.load({ workspaceRoot, roomId: targetRoomId }).then((manifest) =>
          acceptRefreshedRoom(manifest)
        )
      : targetPath && directTarget && initialTargetKey
        ? (() => {
            return initialOpenCoordinatorRef.current!.run(
              initialTargetKey,
              () => openPath(targetPath, { target: directTarget })
            )
          })()
        : loadLatestRoom()
    void task
      .catch((cause) => {
        if (!cancelled) setError(formatBiologyRoomError(cause))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    acceptRefreshedRoom,
    initialRoomId,
    initialTargetKey,
    loadLatestRoom,
    openPath,
    workspaceRoot
  ])

  useEffect(() => {
    if (!runEvent) return
    if (shouldResetBioGymFollowRun(
      runEventRef.current?.designRunId,
      runEvent.designRunId
    )) {
      followRunRef.current = true
      pinnedAssetIdRef.current = null
      setFollowRun(true)
    }
    runEventRef.current = runEvent
    const displayedRoomId = initialRoomId?.trim() || roomRef.current?.roomId
    if (
      runEvent.workspaceRoot !== workspaceRoot ||
      (displayedRoomId && runEvent.roomId !== displayedRoomId)
    ) return
    const api = window.sciforge?.biologyRoom
    if (!api) return
    let cancelled = false
    void api.load({ workspaceRoot, roomId: runEvent.roomId })
      .then((manifest) => {
        if (!cancelled) acceptRoom(manifest, followRunRef.current ? runEvent.activeAssetId : undefined)
      })
      .catch((cause) => {
        if (!cancelled) setError(formatBiologyRoomError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [acceptRoom, initialRoomId, runEvent, workspaceRoot])

  useEffect(() => {
    if (!room || !visibleContextActive) return undefined
    return registerVisibleContextComponent(buildBiologyRoomVisibleContextComponent({
      room,
      workspaceRoot,
      conflicted: Boolean(conflict)
    }))
  }, [conflict, room, visibleContextActive, workspaceRoot])

  useEffect(() => {
    const capabilities = window.sciforge?.capabilities
    const biologyRoom = window.sciforge?.biologyRoom
    if (!capabilities || !biologyRoom) return undefined

    let active = true
    let subscriptionId: string | null = null
    const offEvent = capabilities.onEvent((payload) => {
      if (!active || payload.subscriptionId !== subscriptionId) return
      if (payload.event.resourceKind !== 'biology-room') return
      const current = roomRef.current
      if (!current) return
      if (current.capability?.resourceRef && payload.event.resourceRef !== current.capability.resourceRef) return
      void biologyRoom.load({ workspaceRoot, roomId: current.roomId })
        .then((manifest) => {
          if (active && roomRef.current?.roomId === manifest.roomId) acceptRoom(manifest)
        })
        .catch((cause) => {
          if (active) setError(formatBiologyRoomError(cause))
        })
    })

    void capabilities.subscribe(workspaceRoot)
      .then((subscription) => {
        if (!active) {
          void capabilities.unsubscribe(subscription.subscriptionId)
          return
        }
        subscriptionId = subscription.subscriptionId
      })
      .catch((cause) => {
        if (active) setError(formatBiologyRoomError(cause))
      })

    return () => {
      active = false
      offEvent()
      if (subscriptionId) void capabilities.unsubscribe(subscriptionId)
    }
  }, [acceptRoom, workspaceRoot])

  const drainMutationQueue = useCallback(async (): Promise<void> => {
    if (mutationRunningRef.current) return
    const api = window.sciforge?.biologyRoom
    if (!api) {
      for (const pending of mutationQueueRef.current.splice(0)) {
        for (const resolve of pending.waiters) resolve(false)
      }
      setError('Biology Room desktop bridge is unavailable.')
      return
    }
    mutationRunningRef.current = true
    setBusy(true)
    setError(null)
    try {
      while (mutationQueueRef.current.length) {
        const pending = mutationQueueRef.current.shift()!
        const current = roomRef.current
        if (!current) {
          for (const resolve of pending.waiters) resolve(false)
          continue
        }
        try {
          const result = await api.apply({
            workspaceRoot,
            roomId: current.roomId,
            baseRevision: current.revision,
            operations: [pending.operation],
            actor: { kind: 'user' }
          })
          acceptRoom(result.manifest)
          setWarning(result.warnings.length ? result.warnings.join(' ') : null)
          for (const resolve of pending.waiters) resolve(true)
        } catch (cause) {
          const message = errorMessage(cause)
          if (/revision conflict|expected\s+\d+.*current\s+\d+/i.test(message)) {
            const latest = await api.load({ workspaceRoot, roomId: current.roomId })
            setConflict({
              expectedRevision: current.revision,
              actualRevision: latest.revision,
              message
            })
            for (const resolve of pending.waiters) resolve(false)
            for (const queued of mutationQueueRef.current.splice(0)) {
              for (const resolve of queued.waiters) resolve(false)
            }
            break
          }
          setError(formatBiologyRoomError(cause))
          for (const resolve of pending.waiters) resolve(false)
        }
      }
    } finally {
      mutationRunningRef.current = false
      setBusy(false)
    }
  }, [acceptRoom, workspaceRoot])

  const applyOperation = useCallback((
    operation: BiologyRoomMutationOperation
  ): Promise<boolean> => new Promise((resolve) => {
    if (!roomRef.current) {
      resolve(false)
      return
    }
    if (operation.type === 'setActiveAsset') {
      followRunRef.current = false
      pinnedAssetIdRef.current = operation.assetId
      setFollowRun(false)
    }
    const coalesceKey = biologyMutationCoalesceKey(operation)
    const existing = coalesceKey
      ? [...mutationQueueRef.current].reverse().find((pending) =>
          biologyMutationCoalesceKey(pending.operation) === coalesceKey
        )
      : undefined
    if (existing) {
      existing.operation = operation
      existing.waiters.push(resolve)
    } else {
      mutationQueueRef.current.push({ operation, waiters: [resolve] })
    }
    void drainMutationQueue()
  }), [drainMutationQueue])

  const updateFollowRun = useCallback((follow: boolean): void => {
    followRunRef.current = follow
    setFollowRun(follow)
    if (!follow) {
      pinnedAssetIdRef.current = room?.activeAssetId ?? roomRef.current?.activeAssetId ?? null
      return
    }
    pinnedAssetIdRef.current = null
    const latest = roomRef.current
    if (!latest) return
    const preferred = runEventRef.current?.roomId === latest.roomId
      ? runEventRef.current.activeAssetId
      : undefined
    acceptRoom(latest, preferred)
  }, [acceptRoom, room?.activeAssetId])

  const activeRoomId = room?.roomId

  const refreshRoom = useCallback(async (): Promise<void> => {
    if (!activeRoomId) return
    const api = window.sciforge?.biologyRoom
    if (!api) return
    try {
      const result = await api.refresh({
        workspaceRoot,
        roomId: activeRoomId,
        actor: { kind: 'system' }
      })
      acceptRoom(result.manifest)
      setWarning(result.warnings.length ? result.warnings.join(' ') : null)
    } catch (cause) {
      setError(formatBiologyRoomError(cause))
    }
  }, [acceptRoom, activeRoomId, workspaceRoot])

  const watchedPathsJson = JSON.stringify(
    room ? biologyRoomWatchPaths(room) : []
  )

  useEffect(() => {
    const watchedPaths = JSON.parse(watchedPathsJson) as string[]
    if (!watchedPaths.length || !window.sciforge?.workspacePreview) return undefined
    let cancelled = false
    const watchIds = new Set<string>()
    const pendingPaths = new Set<string>()
    const watchAttempts = new Set<string>()
    let retryTimer: ReturnType<typeof setInterval> | null = null
    const stopChanged = window.sciforge.workspacePreview.onChanged((payload) => {
      if (!watchIds.has(payload.watchId)) return
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        void refreshRoom()
      }, 180)
    })
    const registerWatch = async (path: string): Promise<boolean> => {
      if (cancelled || watchAttempts.has(path)) return false
      watchAttempts.add(path)
      try {
        const result = await window.sciforge.workspacePreview.watch({
          path,
          workspaceRoot
        })
        if (cancelled) {
          if (result.ok) void window.sciforge.workspacePreview.unwatch(result.watchId)
          return false
        }
        if (!result.ok) {
          pendingPaths.add(path)
          return false
        }
        pendingPaths.delete(path)
        watchIds.add(result.watchId)
        return true
      } catch {
        pendingPaths.add(path)
        return false
      } finally {
        watchAttempts.delete(path)
      }
    }
    void Promise.all(watchedPaths.map(registerWatch)).then(() => {
      if (cancelled || !pendingPaths.size) return
      retryTimer = setInterval(() => {
        if (cancelled || !pendingPaths.size) {
          if (retryTimer) clearInterval(retryTimer)
          retryTimer = null
          return
        }
        void Promise.all([...pendingPaths].map(registerWatch)).then((results) => {
          if (results.some(Boolean)) void refreshRoom()
        })
      }, 2_000)
    }).catch((cause) => {
      if (!cancelled) setError(`File watching is unavailable: ${errorMessage(cause)}`)
    })
    return () => {
      cancelled = true
      stopChanged()
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      if (retryTimer) clearInterval(retryTimer)
      for (const watchId of watchIds) {
        void window.sciforge.workspacePreview.unwatch(watchId)
      }
    }
  }, [refreshRoom, watchedPathsJson, workspaceRoot])

  const transportPlanJson = JSON.stringify(room ? biologyPreviewTransportPlan(room) : null)
  const transportPlan = useMemo(
    () => JSON.parse(transportPlanJson) as BiologyPreviewTransportPlan | null,
    [transportPlanJson]
  )

  useEffect(() => {
    if (!transportPlan || !window.sciforge?.workspacePreview) {
      setPreview(EMPTY_PREVIEW_TRANSPORT)
      return undefined
    }
    let cancelled = false
    const sessionLease = createBiologyPreviewSessionLease((sessionId) =>
      window.sciforge.workspacePreview.releaseSession(sessionId)
    )
    setPreview(EMPTY_PREVIEW_TRANSPORT)
    void prepareRoomPreviewTransport(transportPlan, workspaceRoot, sessionLease.track)
      .then((next) => {
        if (!cancelled) setPreview({ ...next, planKey: transportPlanJson })
      })
      .catch((cause) => {
        sessionLease.releaseAll()
        if (!cancelled) {
          setPreview({
            ...EMPTY_PREVIEW_TRANSPORT,
            planKey: transportPlanJson,
            status: 'error',
            error: errorMessage(cause)
          })
        }
      })
    return () => {
      cancelled = true
      sessionLease.releaseAll()
    }
  }, [transportPlan, transportPlanJson, workspaceRoot])

  const resolvedPreview = preview.planKey === transportPlanJson
    ? preview
    : EMPTY_PREVIEW_TRANSPORT

  const versions = useMemo<BiologyRoomRevisionSummary[]>(() =>
    (history?.entries ?? []).map((entry) => ({
      revision: entry.revision,
      createdAt: entry.updatedAt,
      actor: entry.event?.actor.kind,
      summary: entry.event?.operations.map((operation) => operation.type).join(', '),
      active: entry.revision === room?.revision
    })), [history, room?.revision])

  const provenance = useMemo<BiologyRoomProvenanceEntry[]>(() =>
    (history?.entries ?? []).flatMap((entry) => entry.event ? [{
      id: entry.event.eventId,
      createdAt: entry.event.timestamp,
      actor: entry.event.actor.kind,
      revision: entry.revision,
      summary: entry.event.operations.map((operation) => operation.type).join(', '),
      detail: biologyRoomProvenanceDetail(entry.event)
    }] : []), [history])

  const pickAsset = useCallback(async (
    asReference = false,
    targetTrackId?: string
  ): Promise<void> => {
    const api = window.sciforge.biologyRoom
    if (!api) throw new Error('Biology Room desktop bridge is unavailable.')
    const picked = await api.pickFile(workspaceRoot)
    if (picked.canceled || !picked.path) return
    if (targetTrackId && biologyRoomFormatFromPath(picked.path) !== 'fasta') {
      setError('Select a FASTA reference (.fa, .fasta, .fna, or indexed bgzip FASTA).')
      return
    }
    if (!room) {
      setBusy(true)
      try {
        await openPath(picked.path, { asReference })
      } catch (cause) {
        setError(formatBiologyRoomError(cause))
      } finally {
        setBusy(false)
      }
      return
    }
    const path = relativeBiologyPath(picked.path, workspaceRoot)
    let referenceAsset = roomRef.current?.assets.find((asset) => asset.path === path)
    if (!referenceAsset) {
      const added = await applyOperation({
        type: 'addAsset',
        asset: { path, indexPaths: [], ...(asReference ? { asReference: true } : {}) }
      })
      if (!added) return
      referenceAsset = roomRef.current?.assets.find((asset) => asset.path === path)
    }
    if (targetTrackId) {
      if (!referenceAsset || referenceAsset.format !== 'fasta') {
        setError('The selected file could not be added as a FASTA reference.')
        return
      }
      await applyOperation({
        type: 'setTrackReference',
        trackAssetId: targetTrackId,
        referenceAssetId: referenceAsset.id
      })
    }
  }, [applyOperation, openPath, room, workspaceRoot])

  if (!room) {
    return (
      <BiologyRoomEmptyPanel
        className={className}
        busy={busy}
        error={error}
        rooms={rooms}
        onOpenFile={() => void pickAsset(false)}
        onReload={() => void loadLatestRoom()}
        onClose={onClose}
      />
    )
  }

  return (
    <BiologyRoomShell
      room={room}
      transportStatus={resolvedPreview.status}
      transportError={resolvedPreview.error}
      assetSources={resolvedPreview.assetSources}
      busy={busy}
      error={error}
      warning={warning}
      conflict={conflict}
      versions={versions}
      provenance={provenance}
      annotationActor={{ kind: 'user' }}
      className={className}
      resizable={false}
      onApply={applyOperation}
      onAddSelectionToChat={onAddSelectionToChat}
      onRequestAddAsset={() => void pickAsset(false)}
      onSelectReference={(track) => void pickAsset(true, track.id)}
      onReloadConflict={() => {
        const api = window.sciforge.biologyRoom
        if (!api) {
          setError('Biology Room desktop bridge is unavailable.')
          return
        }
        void api.load({ workspaceRoot, roomId: room.roomId })
          .then(acceptRoom)
          .catch((cause) => setError(formatBiologyRoomError(cause)))
      }}
      onDismissError={() => setError(null)}
      onDismissWarning={() => setWarning(null)}
      onClose={onClose}
      runSnapshot={runEvent?.roomId === room.roomId ? runEvent.snapshot : null}
      followRun={followRun}
      onFollowRunChange={updateFollowRun}
    />
  )
}

async function prepareRoomPreviewTransport(
  plan: BiologyPreviewTransportPlan,
  workspaceRoot: string,
  onSessionOpened: (sessionId: string) => void
): Promise<PreviewTransportState> {
  const previewApi = window.sciforge.workspacePreview
  const active = plan.assets.find((asset) => asset.id === plan.activeAssetId)
  if (!active) return EMPTY_PREVIEW_TRANSPORT
  const expectedSha256ByPath = new Map<string, string>()
  for (const asset of plan.assets) {
    expectedSha256ByPath.set(asset.path, asset.sha256)
    for (const index of asset.indexFingerprints ?? []) {
      expectedSha256ByPath.set(index.path, index.sha256)
    }
  }
  const sessions = new Map<string, string>()
  for (const [path, expectedSha256] of expectedSha256ByPath) {
    const opened = await previewApi.open({
      path,
      workspaceRoot,
      mode: 'inspect',
      integrity: {
        algorithm: 'sha256',
        expectedDigest: `sha256:${expectedSha256}`
      }
    })
    if (!opened.ok) throw new Error(opened.message)
    onSessionOpened(opened.session.id)
    sessions.set(path, opened.session.id)
  }
  const sourceForPath = (path: string): string | null => {
    const sessionId = sessions.get(path)
    return sessionId ? previewApi.getAssetSourceUrl?.(sessionId) ?? null : null
  }
  const assetSources: Record<string, { sourceUrl: string; indexUrls?: Record<string, string> }> = {}
  for (const asset of plan.assets) {
    const sourceUrl = sourceForPath(asset.path)
    if (!sourceUrl) throw new Error(`Preview source URL was not created for ${asset.path}.`)
    const indexUrls = Object.fromEntries(asset.indexPaths.flatMap((path) => {
      const url = sourceForPath(path)
      return url ? [[path, url]] : []
    }))
    if (Object.keys(indexUrls).length !== asset.indexPaths.length) {
      throw new Error(`Preview source URL was not created for every index of ${asset.path}.`)
    }
    assetSources[asset.id] = {
      sourceUrl,
      ...(Object.keys(indexUrls).length ? { indexUrls } : {})
    }
  }
  return {
    planKey: null,
    status: 'ready',
    assetSources,
    error: null
  }
}

function biologyPreviewTransportPlan(room: BiologyRoomManifest): BiologyPreviewTransportPlan | null {
  const active = resolveActiveBiologyRoomAsset(room)
  if (!active || biologyRoomAssetBlockingIssue(active)) return null
  const reference = isBiologyRoomTrack(active) ? resolveBiologyRoomReference(room, active) : null
  if (reference && biologyRoomAssetBlockingIssue(reference)) return null
  return {
    activeAssetId: active.id,
    assets: assetsNeededForViewer(room, active)
      .filter((asset) => !biologyRoomAssetBlockingIssue(asset))
      .map((asset) => ({
      id: asset.id,
      path: asset.path,
      indexPaths: asset.indexPaths,
      indexFingerprints: asset.indexFingerprints,
      sha256: asset.sha256
      }))
  }
}

function assetsNeededForViewer(room: BiologyRoomManifest, active: BiologyRoomAsset): BiologyRoomAsset[] {
  if (!isBiologyRoomTrack(active)) return [active]
  const reference = resolveBiologyRoomReference(room, active)
  const tracks = reference
    ? room.assets.filter((asset) =>
        isBiologyRoomTrack(asset) &&
        asset.referenceAssetId === reference.id &&
        isBiologyRoomTrackVisible(room, asset.id)
      )
    : []
  return uniqueAssets([...(reference ? [reference] : []), ...tracks, active])
}

function uniqueAssets(assets: BiologyRoomAsset[]): BiologyRoomAsset[] {
  const seen = new Set<string>()
  return assets.filter((asset) => {
    if (seen.has(asset.id)) return false
    seen.add(asset.id)
    return true
  })
}

function biologyMutationCoalesceKey(operation: BiologyRoomMutationOperation): string | null {
  switch (operation.type) {
    case 'setSelection':
      return 'selection'
    case 'setViewport':
      return `viewport:${operation.viewport.kind}`
    case 'setTrackVisibility':
      return `track-visibility:${operation.trackAssetId}`
    case 'setMolecularView':
      return 'molecular-view'
    case 'setActiveAsset':
      return 'active-asset'
    default:
      return null
  }
}

function relativeBiologyPath(rawPath: string, workspaceRoot: string): string {
  const path = rawPath.trim().replaceAll('\\', '/')
  const root = workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  if (!path) throw new Error('A biology file path is required.')
  if (!path.startsWith('/') && !/^[A-Za-z]:\//.test(path)) return normalizeRelativePath(path)
  if (!root || (path !== root && !path.startsWith(`${root}/`))) {
    throw new Error('Biology Room files must be inside the active workspace.')
  }
  return normalizeRelativePath(path.slice(root.length + (path === root ? 0 : 1)))
}

function normalizeExpectedSha256(value?: string): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '')
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error('Expected SHA-256 digest is invalid.')
  }
  return normalized
}

export function biologyRoomInitialTargetKey(
  workspaceRoot: string,
  target?: WorkspaceFileTarget | null
): string | null {
  if (!target?.path.trim()) return null
  return JSON.stringify([
    workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+$/, ''),
    target.path.trim().replaceAll('\\', '/'),
    target.integrity?.expectedDigest?.trim().toLowerCase() ?? null,
    target.selection ?? null
  ])
}

export type BiologyRoomInitialOpenCoordinator = {
  run: (key: string, start: () => Promise<void>) => Promise<void>
}

export function createBiologyRoomInitialOpenCoordinator(): BiologyRoomInitialOpenCoordinator {
  let current: { key: string; task: Promise<void> } | null = null
  return {
    run: (key, start) => {
      if (current?.key === key) return current.task
      const task = start()
      current = { key, task }
      return task
    }
  }
}

function normalizeRelativePath(path: string): string {
  const segments = path.split('/').filter((segment) => segment && segment !== '.')
  if (!segments.length || segments.some((segment) => segment === '..')) {
    throw new Error('Biology Room files must stay inside the active workspace.')
  }
  return segments.join('/')
}

function formatBiologyRoomError(cause: unknown): string {
  const message = errorMessage(cause)
  if (/Unindexed Biology Room assets may not exceed/i.test(message)) {
    return `${message} Add the standard adjacent index (.fai/.gzi for FASTA, .tbi/.csi for bgzip GFF3/BED/VCF) and reopen the file.`
  }
  return message
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function biologyRoomProvenanceDetail(event: BiologyRoomEvent): string {
  const actor = [
    event.actor.id ? `actor=${event.actor.id}` : null,
    event.actor.taskId ? `task=${event.actor.taskId}` : null,
    event.actor.turnId ? `turn=${event.actor.turnId}` : null
  ].filter(Boolean).join(' · ')
  const operations = JSON.stringify(event.operations)
  return [
    `Revision ${event.fromRevision} → ${event.toRevision}`,
    actor || null,
    `operations=${operations.length > 2_000 ? `${operations.slice(0, 2_000)}…` : operations}`
  ].filter((line): line is string => Boolean(line)).join('\n')
}

function lastBiologyRoomStorageKey(workspaceRoot: string): string {
  return `${LAST_BIOLOGY_ROOM_KEY_PREFIX}:${workspaceRoot.trim().replaceAll('\\', '/')}`
}

function BiologyRoomEmptyPanel({
  className,
  busy,
  error,
  rooms,
  onOpenFile,
  onReload,
  onClose
}: {
  className?: string
  busy: boolean
  error: string | null
  rooms: BiologyRoomSummary[]
  onOpenFile: () => void
  onReload: () => void
  onClose?: () => void
}): ReactElement {
  return (
    <aside className={`flex h-full min-h-0 w-full flex-col bg-ds-main ${className ?? ''}`} aria-label="Biology Room">
      <header className="flex items-center justify-between border-b border-ds-border bg-ds-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Dna className="h-4 w-4 text-emerald-500" />
          <span className="text-[13px] font-semibold text-ds-ink">Biology Room</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onReload} className="rounded-md p-1.5 text-ds-muted hover:bg-ds-hover" aria-label="Reload Biology Rooms">
            <RefreshCw className="h-4 w-4" />
          </button>
          {onClose ? <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-ds-muted hover:bg-ds-hover">Close</button> : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        {busy ? <Loader2 className="h-7 w-7 animate-spin text-emerald-500" /> : <Dna className="h-9 w-9 text-emerald-500" />}
        <h2 className="mt-4 text-[15px] font-semibold text-ds-ink">Open a biology file</h2>
        <p className="mt-2 max-w-sm text-[12px] leading-5 text-ds-muted">
          FASTA, GenBank, PDB/mmCIF, GFF3, BED, and VCF files open as persistent, agent-visible rooms.
        </p>
        {error ? <p className="mt-3 max-w-md rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-600">{error}</p> : null}
        <button
          type="button"
          onClick={onOpenFile}
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Choose biology file
        </button>
        {rooms.length ? <p className="mt-3 text-[10.5px] text-ds-faint">{rooms.length} saved room{rooms.length === 1 ? '' : 's'} found.</p> : null}
      </div>
    </aside>
  )
}
