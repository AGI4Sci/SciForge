import { AlertTriangle, ChevronDown, Loader2, Network, PanelRightClose, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentRuntimeId } from '@shared/app-settings'
import type {
  DagPanelStatus,
  EvidenceDagUpdateRequest,
  EvidenceDagUpdateResult,
  EvidenceDagViewResult,
  SciForgeApi
} from '@shared/sciforge-api'

type Props = {
  activeThreadId: string | null
  runtimeId?: AgentRuntimeId
  className?: string
  onCollapse: () => void
}

type EvidenceDagUpdateApi = Partial<Pick<SciForgeApi, 'updateEvidenceDag'>>

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export async function runEvidenceDagUpdate(
  api: EvidenceDagUpdateApi,
  input: EvidenceDagUpdateRequest
): Promise<EvidenceDagUpdateResult> {
  if (typeof api.updateEvidenceDag === 'function') return api.updateEvidenceDag(input)
  throw new Error('Evidence DAG is unavailable in this build.')
}

function statusLabel(status: DagPanelStatus, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (status.freshness === 'failed') return t('dagStatusFailed')
  if (status.freshness === 'degraded') return t('dagStatusDegraded')
  if (status.freshness === 'paused') return t('dagStatusPaused')
  if (status.freshness === 'updating') return t('dagStatusUpdating')
  if (status.pendingCount > 0 || status.freshness === 'queued' || status.freshness === 'dirty') {
    return t('dagStatusPending', { count: status.pendingCount })
  }
  return t('dagStatusFresh')
}

function statusTone(status: DagPanelStatus): string {
  if (status.freshness === 'failed' || status.freshness === 'degraded' || status.missingArtifactCount) {
    return 'border-amber-300 bg-amber-50 text-amber-800'
  }
  if (status.freshness === 'fresh') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

export function EvidenceDagPanel({
  activeThreadId,
  runtimeId,
  className = '',
  onCollapse
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [view, setView] = useState<EvidenceDagViewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [updateSummary, setUpdateSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestNonce, setRequestNonce] = useState(0)
  const [frameNonce, setFrameNonce] = useState(0)
  const threadId = useMemo(() => activeThreadId?.trim() || null, [activeThreadId])

  useEffect(() => {
    let cancelled = false
    const getEvidenceDagView = window.sciforge?.getEvidenceDagView
    if (typeof getEvidenceDagView !== 'function') {
      setError(t('evidenceDagUnavailable'))
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    void getEvidenceDagView({
      ...(threadId ? { threadId } : {}),
      ...(runtimeId ? { runtimeId } : {})
    }).then((result) => {
      if (cancelled) return
      setView(result)
      setFrameNonce((current) => current + 1)
    }).catch((cause) => {
      if (cancelled) return
      setError(errorMessage(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [requestNonce, runtimeId, t, threadId])

  useEffect(() => {
    const freshness = view?.status.freshness
    if (freshness !== 'queued' && freshness !== 'updating' && freshness !== 'dirty') return
    const timer = setTimeout(() => setRequestNonce((current) => current + 1), 2_000)
    return () => clearTimeout(timer)
  }, [view?.status.freshness, view?.status.pendingCount])

  const subtitle = view?.threadId || threadId || t('evidenceDagGlobalView')
  const canUpdateDag = Boolean(threadId && runtimeId)
  const updateDagTitle = !canUpdateDag
    ? t('evidenceDagUpdateUnavailableHint')
    : submitting
      ? t('evidenceDagUpdateRunning')
      : t('evidenceDagUpdateHelp')

  const submitUpdate = (operation: 'update' | 'rebuild'): void => {
    const api = window.sciforge
    if (typeof api?.updateEvidenceDag !== 'function') {
      setError(t('evidenceDagUnavailable'))
      return
    }
    if (!threadId || !runtimeId) return
    setSubmitting(true)
    setError(null)
    setUpdateSummary(null)
    void runEvidenceDagUpdate(api, {
      runtimeId,
      threadId,
      operation,
      ...(operation === 'rebuild' ? {
        rebuildKind: 'reinterpretation' as const,
        rebuildRationale: 'Explicit reinterpretation requested from the advanced DAG controls after the displayed cost and scope warning.'
      } : {})
    }).then((result) => {
      setView({ url: result.url, threadId: result.threadId, status: result.status })
      setUpdateSummary(t('evidenceDagUpdateQueued', { count: result.itemCount }))
      setFrameNonce((current) => current + 1)
    }).catch((cause) => {
      setError(errorMessage(cause))
    }).finally(() => {
      setSubmitting(false)
    })
  }

  const status = view?.status

  return (
    <aside className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <Network className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('rightPanelEvidenceDag')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">{updateSummary || subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => submitUpdate('update')}
            disabled={loading || submitting || !canUpdateDag}
            className="inline-flex h-7 min-w-[86px] items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-[11.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={updateDagTitle}
            title={updateDagTitle}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span>{submitting ? t('evidenceDagUpdateRunning') : t('evidenceDagUpdate')}</span>
          </button>
          <button
            type="button"
            onClick={() => setRequestNonce((current) => current + 1)}
            disabled={loading || submitting}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('evidenceDagRefresh')}
            title={t('evidenceDagRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
          <button type="button" onClick={onCollapse} className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink" aria-label={t('rightPanelCollapse')} title={t('rightPanelCollapse')}>
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {status ? (
        <div className="shrink-0 border-b border-ds-border px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className={`rounded-full border px-2 py-0.5 font-medium ${statusTone(status)}`}>
              {statusLabel(status, t)}
            </span>
            {status.attentionCount ? <span className="text-amber-700">{t('dagAttentionCount', { count: status.attentionCount })}</span> : null}
            {status.missingArtifactCount ? <span className="text-amber-700">{t('dagMissingArtifacts', { count: status.missingArtifactCount })}</span> : null}
            {status.auditStale ? <span className="text-amber-700">{t('dagAuditStale')}</span> : null}
          </div>
          {status.latestSnapshotDigest ? (
            <div className="mt-1 truncate font-mono text-[10.5px] text-ds-faint" title={status.latestSnapshotDigest}>
              {t('dagSnapshotDigest')}: {status.latestSnapshotDigest}
            </div>
          ) : null}
          {status.desiredWatermark ? (
            <div className="mt-1 truncate text-[10.5px] text-ds-faint">
              {t('dagWatermarks', { committed: status.committedWatermark || '—', desired: status.desiredWatermark })}
            </div>
          ) : null}
          {status.lastError ? <div className="mt-1 break-words text-[11px] text-amber-700">{status.lastError}</div> : null}
          <details className="mt-2 text-[11px] text-ds-muted">
            <summary className="flex cursor-pointer list-none items-center gap-1"><ChevronDown className="h-3 w-3" />{t('dagAdvancedActions')}</summary>
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
              <p>{t('evidenceDagRebuildWarning')}</p>
              <button type="button" disabled={submitting || !canUpdateDag} onClick={() => submitUpdate('rebuild')} className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 font-medium disabled:opacity-50">
                <RotateCcw className="h-3 w-3" />{t('evidenceDagRebuild')}
              </button>
            </div>
          </details>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-ds-main">
        {view ? <iframe key={`${view.url}:${frameNonce}`} src={view.url} title={t('rightPanelEvidenceDag')} className="ds-no-drag block h-full w-full border-0 bg-ds-main" sandbox="allow-forms allow-same-origin allow-scripts" referrerPolicy="no-referrer" /> : null}
        {loading && !view ? <div className="absolute inset-0 flex items-center justify-center bg-ds-main text-ds-faint"><Loader2 className="h-4 w-4 animate-spin" /><span className="ml-2 text-[12px]">{t('evidenceDagLoading')}</span></div> : null}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ds-main px-6">
            <div className="max-w-sm text-center">
              <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" />
              <div className="mt-3 text-[13px] font-semibold text-ds-ink">{t('evidenceDagLoadFailed')}</div>
              <div className="mt-2 break-words text-[12px] leading-5 text-ds-muted">{error}</div>
              <button type="button" onClick={() => setRequestNonce((current) => current + 1)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"><RefreshCw className="h-3.5 w-3.5" />{t('evidenceDagRetry')}</button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
