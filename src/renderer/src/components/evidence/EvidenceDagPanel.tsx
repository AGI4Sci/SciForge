import { AlertTriangle, Loader2, Network, PanelRightClose, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { EvidenceDagViewResult } from '@shared/sciforge-api'

type Props = {
  activeThreadId: string | null
  runtimeId?: AgentRuntimeId
  className?: string
  onCollapse: () => void
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
  const [auditing, setAuditing] = useState(false)
  const [auditSummary, setAuditSummary] = useState<string | null>(null)
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
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [requestNonce, runtimeId, t, threadId])

  const subtitle = view?.threadId || threadId || t('evidenceDagGlobalView')

  const runAudit = (): void => {
    const runEvidenceDagAudit = window.sciforge?.runEvidenceDagAudit
    if (typeof runEvidenceDagAudit !== 'function') {
      setError(t('evidenceDagUnavailable'))
      return
    }
    if (!threadId || !runtimeId) return
    setAuditing(true)
    setError(null)
    setAuditSummary(null)
    void runEvidenceDagAudit({
      runtimeId,
      threadId
    }).then((result) => {
      setView({ url: result.url, threadId: result.threadId })
      const digest = result.riskDigest as {
        total_findings?: unknown
        highest_severity?: unknown
      } | undefined
      const count = typeof digest?.total_findings === 'number' ? digest.total_findings : 0
      const severity = typeof digest?.highest_severity === 'string' ? digest.highest_severity : 'none'
      setAuditSummary(t('evidenceDagAuditSummary', { count, severity }))
      setFrameNonce((current) => current + 1)
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      setAuditing(false)
    })
  }

  return (
    <aside className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <Network className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('rightPanelEvidenceDag')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">{auditSummary || subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={runAudit}
            disabled={loading || auditing || !threadId || !runtimeId}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={auditing ? t('evidenceDagAuditRunning') : t('evidenceDagAudit')}
            title={auditing ? t('evidenceDagAuditRunning') : t('evidenceDagAudit')}
          >
            <ShieldCheck className={`h-4 w-4 ${auditing ? 'animate-pulse' : ''}`} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setRequestNonce((current) => current + 1)}
            disabled={loading}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('evidenceDagRefresh')}
            title={t('evidenceDagRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 bg-ds-main">
        {view ? (
          <iframe
            key={`${view.url}:${frameNonce}`}
            src={view.url}
            title={t('rightPanelEvidenceDag')}
            className="ds-no-drag block h-full w-full border-0 bg-ds-main"
            sandbox="allow-forms allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : null}

        {loading && !view ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ds-main text-ds-faint">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            <span className="ml-2 text-[12px]">{t('evidenceDagLoading')}</span>
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ds-main px-6">
            <div className="max-w-sm text-center">
              <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" strokeWidth={1.8} />
              <div className="mt-3 text-[13px] font-semibold text-ds-ink">{t('evidenceDagLoadFailed')}</div>
              <div className="mt-2 break-words text-[12px] leading-5 text-ds-muted">{error}</div>
              <button
                type="button"
                onClick={() => setRequestNonce((current) => current + 1)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('evidenceDagRetry')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
