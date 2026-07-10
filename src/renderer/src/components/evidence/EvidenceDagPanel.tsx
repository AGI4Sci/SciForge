import { AlertTriangle, Loader2, Network, PanelRightClose, Play, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentRuntimeId } from '@shared/app-settings'
import type {
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
export const EVIDENCE_DAG_UPDATE_TIMEOUT_MS = 10 * 60_000

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function isEvidenceDagUpdateTimeout(cause: unknown): boolean {
  return /Evidence DAG update timed out/i.test(errorMessage(cause))
}

export async function runEvidenceDagUpdate(
  api: EvidenceDagUpdateApi,
  input: { runtimeId: AgentRuntimeId; threadId: string }
): Promise<EvidenceDagUpdateResult> {
  if (typeof api.updateEvidenceDag === 'function') {
    return api.updateEvidenceDag(input)
  }
  throw new Error('Evidence DAG is unavailable in this build.')
}

export function withEvidenceDagUpdateTimeout<T>(
  task: Promise<T>,
  timeoutMs = EVIDENCE_DAG_UPDATE_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Evidence DAG update timed out. The request may still be running in the background.'))
    }, timeoutMs)
  })
  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
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
  const [updating, setUpdating] = useState(false)
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
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [requestNonce, runtimeId, t, threadId])

  const subtitle = view?.threadId || threadId || t('evidenceDagGlobalView')
  const canUpdateDag = Boolean(threadId && runtimeId)
  const updateDagTitle = !canUpdateDag
    ? t('evidenceDagUpdateUnavailableHint')
    : updating
      ? t('evidenceDagUpdateRunning')
      : t('evidenceDagUpdateHelp')

  const updateDag = (): void => {
    const api = window.sciforge
    if (typeof api?.updateEvidenceDag !== 'function') {
      setError(t('evidenceDagUnavailable'))
      return
    }
    if (!threadId || !runtimeId) return
    setUpdating(true)
    setError(null)
    setUpdateSummary(null)
    void withEvidenceDagUpdateTimeout(runEvidenceDagUpdate(api, {
      runtimeId,
      threadId
    })).then((result) => {
      setView({ url: result.url, threadId: result.threadId })
      setUpdateSummary(t('evidenceDagUpdateSummary', { count: result.itemCount }))
      setFrameNonce((current) => current + 1)
    }).catch((cause) => {
      setError(isEvidenceDagUpdateTimeout(cause) ? t('evidenceDagUpdateTimedOut') : errorMessage(cause))
    }).finally(() => {
      setUpdating(false)
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
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">{updateSummary || subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={updateDag}
            disabled={loading || updating || !canUpdateDag}
            className="inline-flex h-7 min-w-[86px] items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-[11.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={updateDagTitle}
            title={updateDagTitle}
          >
            {updating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            <span>{updating ? t('evidenceDagUpdateRunning') : t('evidenceDagUpdate')}</span>
          </button>
          <button
            type="button"
            onClick={() => setRequestNonce((current) => current + 1)}
            disabled={loading || updating}
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
