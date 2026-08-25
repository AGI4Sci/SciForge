import {
  AlertTriangle,
  Loader2,
  Network,
  PanelRightClose,
  Play,
  RefreshCw,
  RotateCcw
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
  type EvidenceDagUpdateInput,
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
import { DagWorkbenchFrame } from './dag-workbench-ui'

export type EvidenceDagPanelProps = Readonly<{
  active: boolean
  className?: string
  onCollapse: () => void
  session: DomainWorkbenchRightPanelSession
  surfaceId: string
  activation?: DomainWorkbenchRightPanelActivation
  client: EvidenceDagCapabilityClient
  workspacePreview?: DomainRendererWorkspacePreviewHost
}>

export type EvidenceDagPanelTarget = Readonly<{
  runtimeId?: string
  threadId?: string
  workspaceRoot?: string
  snapshotDigest?: string
  nodeId?: string
}>

export function evidenceDagPanelTarget(
  session: DomainWorkbenchRightPanelSession,
  activation?: DomainWorkbenchRightPanelActivation
): EvidenceDagPanelTarget {
  const parsed = evidenceDagActivationPayloadSchema.safeParse(activation?.payload)
  const payload: EvidenceDagActivationPayload | undefined = parsed.success
    ? parsed.data
    : undefined
  if (payload?.runtimeId && payload.threadId) {
    return {
      runtimeId: payload.runtimeId,
      threadId: payload.threadId,
      ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {}),
      ...(payload.snapshotDigest ? { snapshotDigest: payload.snapshotDigest } : {}),
      ...(payload.nodeId ? { nodeId: payload.nodeId } : {})
    }
  }
  return {
    ...(session.runtimeId ? { runtimeId: session.runtimeId, threadId: session.id } : {}),
    ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {}),
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
    `${target.runtimeId ?? ''}:${target.threadId ?? ''}:${target.workspaceRoot ?? ''}`
  const [view, setView] = useState<EvidenceDagViewOutput | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [requestRevision, setRequestRevision] = useState(0)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const viewInput = useMemo<EvidenceDagViewInput>(
    () => target.runtimeId && target.threadId
      ? { runtimeId: target.runtimeId, threadId: target.threadId }
      : {},
    [target.runtimeId, target.threadId]
  )
  const frameUrl = useMemo(
    () => view
      ? evidenceDagViewUrlWithNode(
          view.url,
          target.nodeId,
          Boolean(target.runtimeId && target.threadId)
        )
      : null,
    [target.nodeId, target.runtimeId, target.threadId, view]
  )
  const status = view?.status
  const committedDigest = status?.committed?.digest

  useEffect(() => {
    setView(null)
    setSummary(null)
    setError(null)
  }, [identityKey])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void client.view(viewInput)
      .then((result) => {
        if (!cancelled) setView(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, client, requestRevision, viewInput])

  useEffect(() => {
    const interval = evidenceDagPollInterval(active, status?.pending)
    if (interval === null) return
    const timer = window.setTimeout(
      () => setRequestRevision((revision) => revision + 1),
      interval
    )
    return () => window.clearTimeout(timer)
  }, [active, status?.pending])

  useEffect(() => {
    if (!target.runtimeId || !target.threadId) return
    void client.priority({
      runtimeId: target.runtimeId,
      threadId: target.threadId,
      surfaceId,
      visible: active && document.visibilityState === 'visible'
    }).catch(() => undefined)
    return () => {
      void client.priority({
        runtimeId: target.runtimeId!,
        threadId: target.threadId!,
        surfaceId,
        visible: false
      }).catch(() => undefined)
    }
  }, [active, client, surfaceId, target.runtimeId, target.threadId])

  useEffect(() => {
    if (!frameUrl) return
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
        resolvePreview: client.resolvePreview,
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
    workspacePreview
  ])

  const submitUpdate = (operation: EvidenceDagUpdateInput['operation']): void => {
    if (!target.runtimeId || !target.threadId) {
      setError(t('evidenceDagUnavailable'))
      return
    }
    setSubmitting(true)
    setError(null)
    setSummary(null)
    void client.update({
      runtimeId: target.runtimeId,
      threadId: target.threadId,
      ...(target.workspaceRoot ? { workspaceRoot: target.workspaceRoot } : {}),
      operation,
      ...(operation === 'rebuild'
        ? {
            rebuildKind: 'reinterpretation' as const,
            rebuildRationale:
              'Explicit reinterpretation requested from the Evidence DAG panel.'
          }
        : {})
    }).then((result) => {
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
  const pendingMeta = pending
    ? [
        t('evidenceDagLastActivity', { time: formatTime(pending.updatedAt) }),
        ...(pending.completedBatches !== undefined && pending.totalBatches !== undefined
          ? [t('evidenceDagBatchProgress', {
              completed: pending.completedBatches,
              total: pending.totalBatches
            })]
          : []),
        t('evidenceDagAttempt', { count: pending.attempt })
      ].join(' · ')
    : null
  const pendingError = pending?.state === 'failed' ? pending.error.message : null

  return (
    <aside
      className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}
      data-domain-panel="evidence-dag"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <Network className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('rightPanelEvidenceDag')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">
            {summary ?? subtitle}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => submitUpdate('update')}
            disabled={loading || updateBusy || !target.runtimeId || !target.threadId}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateBusy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            {t('evidenceDagUpdate')}
          </button>
          <button
            type="button"
            onClick={() => setRequestRevision((revision) => revision + 1)}
            disabled={loading}
            className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            aria-label={t('evidenceDagRefresh')}
            title={t('evidenceDagRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('evidenceDagCollapse')}
            title={t('evidenceDagCollapse')}
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
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
        <div className="shrink-0 border-b border-ds-border-muted px-3 py-1.5 text-[10.5px] text-ds-faint">
          {pendingMeta}
        </div>
      ) : null}
      {error || pendingError ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error ?? pendingError}</span>
        </div>
      ) : null}

      <DagWorkbenchFrame
        loading={loading}
        hasView={Boolean(view)}
        frameRef={iframeRef}
        frameUrl={frameUrl ?? undefined}
        frameKey={evidenceDagCommittedFrameKey(frameUrl ?? '', committedDigest)}
        title={t('rightPanelEvidenceDag')}
        sandbox="allow-forms allow-same-origin allow-scripts"
        loadingLabel={t('evidenceDagLoading')}
        emptyIcon={<Network className="h-8 w-8 text-ds-faint" />}
        emptyLabel={error ? t('evidenceDagUnavailable') : t('evidenceDagEmpty')}
        {...(target.runtimeId && target.threadId
          ? {
              action: {
                disabled: submitting,
                label: t('evidenceDagUpdate'),
                onClick: () => submitUpdate('update')
              }
            }
          : {})}
      />

      {target.runtimeId && target.threadId ? (
        <details className="shrink-0 border-t border-ds-border bg-ds-sidebar px-3 py-2 text-[11px] text-ds-muted">
          <summary className="cursor-pointer select-none">{t('evidenceDagRebuild')}</summary>
          <button
            type="button"
            onClick={() => submitUpdate('rebuild')}
            disabled={updateBusy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-800 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('evidenceDagRebuild')}
          </button>
        </details>
      ) : null}
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
