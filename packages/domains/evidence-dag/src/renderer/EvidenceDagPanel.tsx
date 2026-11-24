import {
  AlertTriangle,
  Loader2,
  Network,
  PanelRightClose,
  Play,
  RefreshCw
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DomainRendererWorkspacePreviewHost,
  DomainWorkbenchRightPanelActivation,
  DomainWorkbenchRightPanelSession
} from '@sciforge/domain-sdk/host'
import {
  evidenceDagActivationPayloadSchema,
  type EvidenceDagActivationPayload,
  type EvidenceDagViewInput,
  type EvidenceDagViewOutput
} from '../contract'
import type { EvidenceDagCapabilityClient } from './evidence-dag-capability-client'
import {
  evidenceDagPendingIsActive,
  evidenceDagPollInterval,
  EvidenceDagProgressiveView
} from './evidence-dag-progressive-view'
import { handleEvidenceDagPreviewMessage } from './evidence-dag-preview-bridge'

export type EvidenceDagPanelProps = Readonly<{
  active: boolean
  embedded?: boolean
  className?: string
  onCollapse: () => void
  session: DomainWorkbenchRightPanelSession
  surfaceId?: string
  activation?: DomainWorkbenchRightPanelActivation
  client: EvidenceDagCapabilityClient
  workspacePreview?: DomainRendererWorkspacePreviewHost
}>

export type EvidenceDagPanelTarget = Readonly<{
  runtimeId?: string
  threadId?: string
  workspaceRoot?: string
  snapshotDigest?: string
  artifactVersionRef?: EvidenceDagViewInput['artifactVersionRef']
  nodeId?: string
  invalidSelection?: boolean
}>

/** Workspace authorization follows the owning surface; never infer it from a global default. */
export function evidenceDagPanelViewInput(target: EvidenceDagPanelTarget): EvidenceDagViewInput | null {
  const workspaceRoot = target.workspaceRoot?.trim()
  if (target.invalidSelection || (target.snapshotDigest || target.artifactVersionRef) && (!target.runtimeId || !target.threadId)) return null
  if (!workspaceRoot || Boolean(target.runtimeId) !== Boolean(target.threadId)) return null
  return {
    workspaceRoot,
    ...(target.snapshotDigest ? { snapshotDigest: target.snapshotDigest } : {}),
    ...(target.artifactVersionRef ? { artifactVersionRef: target.artifactVersionRef } : {}),
    ...(target.runtimeId && target.threadId ? { runtimeId: target.runtimeId, threadId: target.threadId } : {})
  }
}

export function evidenceDagPanelTarget(
  session: DomainWorkbenchRightPanelSession,
  activation?: DomainWorkbenchRightPanelActivation
): EvidenceDagPanelTarget {
  const parsed = evidenceDagActivationPayloadSchema.safeParse(activation?.payload)
  if (activation?.payload !== undefined && !parsed.success) return { invalidSelection: true }
  const payload: EvidenceDagActivationPayload | undefined = parsed.success
    ? parsed.data
    : undefined
  if (payload?.runtimeId && payload.threadId) {
    return {
      runtimeId: payload.runtimeId,
      threadId: payload.threadId,
      ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {}),
      ...(payload.artifactVersionRef ? { artifactVersionRef: payload.artifactVersionRef } : {}),
      ...(payload.snapshotDigest ? { snapshotDigest: payload.snapshotDigest } : {}),
      ...(payload.nodeId ? { nodeId: payload.nodeId } : {})
    }
  }
  return {
    ...(session.runtimeId ? { runtimeId: session.runtimeId, threadId: session.id } : {}),
    ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {}),
    ...(payload?.artifactVersionRef ? { artifactVersionRef: payload.artifactVersionRef } : {}),
    ...(payload?.snapshotDigest ? { snapshotDigest: payload.snapshotDigest } : {}),
    ...(payload?.nodeId ? { nodeId: payload.nodeId } : {})
  }
}

export function evidenceDagViewUrlWithNode(
  url: string,
  nodeId?: string,
  previewEnabled = false
): string {
  if (!nodeId && !previewEnabled) return url
  try {
    const parsed = new URL(url)
    if (nodeId) parsed.searchParams.set('node', nodeId)
    if (previewEnabled) parsed.searchParams.set('preview', 'trusted')
    return parsed.toString()
  } catch {
    return url
  }
}

export function evidenceDagCommittedFrameKey(
  url: string,
  snapshotDigest?: string
): string {
  return `${url}:${snapshotDigest?.trim() ?? ''}`
}

export function EvidenceDagPanel({
  active,
  embedded = false,
  className = '',
  onCollapse,
  session,
  surfaceId,
  activation,
  client,
  workspacePreview
}: EvidenceDagPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const target = useMemo(
    () => evidenceDagPanelTarget(session, activation),
    [activation, session]
  )
  const identityKey =
    JSON.stringify([target.runtimeId, target.threadId, target.workspaceRoot, target.snapshotDigest, target.artifactVersionRef, target.invalidSelection])
  const pinned = Boolean(target.snapshotDigest || target.artifactVersionRef)
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null)
  const [view, setView] = useState<EvidenceDagViewOutput | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [requestRevision, setRequestRevision] = useState(0)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const viewInput = useMemo(
    () => evidenceDagPanelViewInput(target),
    [target.runtimeId, target.threadId, target.workspaceRoot, target.snapshotDigest, target.artifactVersionRef, target.invalidSelection]
  )
  const workspaceError = !viewInput ? t(target.invalidSelection ? 'evidenceDagSnapshotUnavailable' : 'evidenceDagWorkspaceRequired') : null
  const frameUrl = useMemo(
    () => loadedIdentity === identityKey && view?.url
      ? evidenceDagViewUrlWithNode(
          view.url,
          target.nodeId,
          Boolean(target.runtimeId && target.threadId)
        )
      : null,
    [identityKey, loadedIdentity, target.nodeId, target.runtimeId, target.threadId, view]
  )
  const status = loadedIdentity === identityKey ? view?.status : undefined
  const committedDigest = view?.binding?.snapshotDigest ?? status?.committed?.digest

  useEffect(() => {
    setView(null)
    setLoading(false)
    setSummary(null)
    setError(null)
  }, [identityKey])

  useEffect(() => {
    if (!active || !viewInput) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void client.view(viewInput)
      .then((result) => {
        if (!cancelled) { setView(result); setLoadedIdentity(identityKey) }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(pinned ? t('evidenceDagSnapshotUnavailable') : errorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, client, identityKey, pinned, requestRevision, t, viewInput])

  useEffect(() => {
    const interval = evidenceDagPollInterval(active && !pinned, status?.pending)
    if (interval === null) return
    const timer = window.setTimeout(
      () => setRequestRevision((revision) => revision + 1),
      interval
    )
    return () => window.clearTimeout(timer)
  }, [active, pinned, status?.pending])

  useEffect(() => {
    if (!surfaceId || pinned || !target.runtimeId || !target.threadId || !viewInput?.workspaceRoot) return
    void client.priority({
      runtimeId: target.runtimeId,
      threadId: target.threadId,
      workspaceRoot: viewInput.workspaceRoot,
      surfaceId,
      visible: active && document.visibilityState === 'visible'
    }).catch(() => undefined)
    return () => {
      void client.priority({
        runtimeId: target.runtimeId!,
        threadId: target.threadId!,
        workspaceRoot: viewInput.workspaceRoot,
        surfaceId,
        visible: false
      }).catch(() => undefined)
    }
  }, [active, client, pinned, surfaceId, target.runtimeId, target.threadId, viewInput?.workspaceRoot])

  useEffect(() => {
    if (!frameUrl || !viewInput?.workspaceRoot) return
    const onMessage = (event: MessageEvent): void => {
      void handleEvidenceDagPreviewMessage({
        event,
        frameWindow: iframeRef.current?.contentWindow ?? null,
        frameUrl,
        sessionId: session.id,
        surfaceId,
        runtimeId: target.runtimeId,
        threadId: target.threadId,
        committedSnapshotDigest: committedDigest,
        activationRevision: activation?.revision,
        workspacePreview,
        resolvePreview: request => client.resolvePreview({ ...request, workspaceRoot: viewInput.workspaceRoot }),
        t
      }).then((result) => {
        if (result.status === 'rejected') setError(result.message)
        if (result.status === 'opened') setError(null)
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [
    activation?.revision,
    client.resolvePreview,
    committedDigest,
    frameUrl,
    session.id,
    surfaceId,
    t,
    target.runtimeId,
    target.threadId,
    workspacePreview,
    viewInput?.workspaceRoot
  ])

  const submitUpdate = (): void => {
    if (pinned) return
    if (!target.runtimeId || !target.threadId || !viewInput?.workspaceRoot) {
      setError(workspaceError ?? t('evidenceDagUnavailable'))
      return
    }
    setSubmitting(true)
    setError(null)
    setSummary(null)
    void client.update({
      runtimeId: target.runtimeId,
      threadId: target.threadId,
      workspaceRoot: viewInput.workspaceRoot
    }).then((result) => {
      setLoadedIdentity(identityKey)
      setView({
        url: result.url,
        threadId: result.threadId,
        status: result.status
      })
      setSummary(t('evidenceDagUpdateQueued', { count: result.itemCount }))
    }).catch((cause: unknown) => {
      setError(errorMessage(cause))
    }).finally(() => {
      setSubmitting(false)
    })
  }

  const pending = status?.pending
  const updateBusy = submitting || evidenceDagPendingIsActive(pending)
  const subtitle = target.threadId
    ? t('evidenceDagCurrentThread')
    : t('evidenceDagAllThreads')
  const pendingMeta = pending ? t('evidenceDagLastActivity', { time: formatTime(pending.updatedAt) }) : null
  const pendingError = pending?.state === 'failed' ? pending.error.message : null

  return (
    <aside
      className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}
      data-domain-panel="evidence-dag"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        {!embedded && <div className="min-w-0">
          <div className="flex items-center gap-2 text-ds-md font-semibold text-ds-ink">
            <Network className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('rightPanelEvidenceDag')}</span>
          </div>
          <div className="mt-1 truncate text-ds-xs text-ds-faint">
            {summary ?? subtitle}
          </div>
        </div>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={submitUpdate}
            disabled={pinned || loading || updateBusy || !target.runtimeId || !target.threadId || !viewInput}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-ds-xs font-medium text-ds-ink hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateBusy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            {t('evidenceDagUpdate')}
          </button>
          <button
            type="button"
            onClick={() => setRequestRevision((revision) => revision + 1)}
            disabled={loading || !viewInput}
            className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            aria-label={t('evidenceDagRefresh')}
            title={t('evidenceDagRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!embedded && <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('evidenceDagCollapse')}
            title={t('evidenceDagCollapse')}
          >
            <PanelRightClose className="h-4 w-4" />
          </button>}
        </div>
      </header>

      {status ? <EvidenceDagProgressiveView status={status} t={t} /> : null}
      {pending && pending.state !== 'failed' ? (
        <div
          className="h-1 shrink-0 overflow-hidden bg-sky-100"
          role="progressbar"
          aria-label={t('evidenceDagAttemptLayer')}
        >
          <div className="h-full w-full animate-pulse bg-sky-500/70" />
        </div>
      ) : null}
      {pendingMeta ? (
        <div className="shrink-0 border-b border-ds-border-muted px-3 py-1.5 text-ds-2xs text-ds-faint">
          {pendingMeta}
        </div>
      ) : null}
      {workspaceError || error || pendingError ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-ds-xs leading-4 text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{workspaceError ?? error ?? pendingError}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-ds-main">
        {loading && !view && viewInput ? (
          <div className="flex h-full items-center justify-center gap-2 text-ds-lg text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('evidenceDagLoading')}
          </div>
        ) : frameUrl && view && viewInput ? (
          <iframe
            ref={iframeRef}
            key={evidenceDagCommittedFrameKey(frameUrl, committedDigest)}
            src={frameUrl}
            title={t('rightPanelEvidenceDag')}
            className="ds-no-drag block h-full w-full border-0 bg-ds-main"
            data-dag-layer="committed"
            sandbox="allow-forms allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-ds-lg text-ds-muted">
            <Network className="h-8 w-8 text-ds-faint" />
            <span>{view?.binding?.status === 'missing' ? t(view.binding.reason === 'snapshot_search_bounded' ? 'evidenceDagHistoricalSearchBounded' : view.binding.reason === 'material_snapshot_missing' ? 'evidenceDagMaterialSnapshotMissing' : 'evidenceDagSnapshotUnavailable') : error ? t('evidenceDagUnavailable') : t('evidenceDagEmpty')}</span>
            {!pinned && target.runtimeId && target.threadId && viewInput ? (
              <button
                type="button"
                onClick={submitUpdate}
                disabled={submitting}
                className="rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-ds-sm text-ds-ink hover:bg-ds-hover disabled:opacity-50"
              >
                {t('evidenceDagUpdate')}
              </button>
            ) : null}
          </div>
        )}
      </div>

    </aside>
  )
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString()
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
