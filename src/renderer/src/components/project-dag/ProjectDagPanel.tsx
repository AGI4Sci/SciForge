import { AlertTriangle, GitMerge, Loader2, PanelRightClose, Play, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectDagCompileResult, ProjectDagViewResult } from '@shared/sciforge-api'
import {
  loadProjectDagSavedGoal,
  projectDagWorkspaceName,
  saveProjectDagGoal
} from './project-dag-panel-state'

type Props = {
  workspaceRoot?: string
  className?: string
  onCollapse: () => void
}

function numberStat(stats: unknown, key: string): number {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return 0
  const value = (stats as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function compileSummary(result: ProjectDagCompileResult, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (result.skipped) {
    return t('projectDagCompileAlreadyRunning')
  }
  if (result.stats) {
    return t('projectDagCompileSummary', {
      added: numberStat(result.stats, 'claims_added'),
      merged: numberStat(result.stats, 'claims_merged'),
      invalidated: numberStat(result.stats, 'claims_invalidated'),
      review: numberStat(result.stats, 'review_enqueued')
    })
  }
  return result.runId
    ? t('projectDagCompileFinishedWithRun', { runId: result.runId })
    : t('projectDagCompileFinished')
}

export function ProjectDagPanel({
  workspaceRoot = '',
  className = '',
  onCollapse
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [view, setView] = useState<ProjectDagViewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)
  const [requestNonce, setRequestNonce] = useState(0)
  const [frameNonce, setFrameNonce] = useState(0)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    const saved = loadProjectDagSavedGoal(workspaceRoot)
    setTitle(saved?.title || projectDagWorkspaceName(workspaceRoot))
    setDescription(saved?.description || '')
    setSummary(null)
  }, [workspaceRoot])

  useEffect(() => {
    let cancelled = false
    const getProjectDagView = window.sciforge?.getProjectDagView
    if (typeof getProjectDagView !== 'function') {
      setLoadError(t('projectDagUnavailable'))
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    void getProjectDagView({ view: 'graph' })
      .then((result) => {
        if (cancelled) return
        setView(result)
        setFrameNonce((current) => current + 1)
      })
      .catch((cause) => {
        if (cancelled) return
        setLoadError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [requestNonce, t])

  const subtitle = useMemo(() => summary || title.trim() || t('projectDagGlobalView'), [summary, t, title])
  const inlineError = compileError || (view ? loadError : null)

  const runCompile = (): void => {
    const runProjectDagCompile = window.sciforge?.runProjectDagCompile
    if (typeof runProjectDagCompile !== 'function') {
      setCompileError(t('projectDagUnavailable'))
      return
    }
    const goalTitle = title.trim()
    const goalDescription = description.trim()
    if (goalTitle || goalDescription) {
      saveProjectDagGoal(workspaceRoot, { title: goalTitle, description: goalDescription })
    }
    setCompiling(true)
    setCompileError(null)
    setSummary(null)
    void runProjectDagCompile({
      ...(goalTitle ? { goalTitle } : {}),
      ...(goalDescription ? { goalDescription } : {}),
      scope: 'all'
    })
      .then((result) => {
        setCompileError(null)
        setView({ url: result.url })
        setSummary(compileSummary(result, t))
        setFrameNonce((current) => current + 1)
      })
      .catch((cause) => {
        setCompileError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        setCompiling(false)
      })
  }

  return (
    <aside className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <GitMerge className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('rightPanelProjectDag')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">{subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={runCompile}
            disabled={loading || compiling}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={compiling ? t('projectDagCompiling') : t('projectDagCompile')}
            title={compiling ? t('projectDagCompiling') : t('projectDagCompile')}
          >
            {compiling ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Play className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setRequestNonce((current) => current + 1)}
            disabled={loading || compiling}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('projectDagRefresh')}
            title={t('projectDagRefresh')}
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

      <div className="shrink-0 space-y-2 border-b border-ds-border px-4 py-3">
        <label className="block text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-goal-title">
          {t('projectDagGoalTitle')}
        </label>
        <input
          id="project-dag-goal-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={compiling}
          className="w-full rounded-lg border border-ds-border-muted bg-ds-surface px-3 py-2 text-[12px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-ds-border-strong"
          placeholder={t('projectDagGoalTitlePlaceholder')}
        />
        <label className="block text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-goal-description">
          {t('projectDagGoalDescription')}
        </label>
        <textarea
          id="project-dag-goal-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={compiling}
          rows={2}
          className="w-full resize-none rounded-lg border border-ds-border-muted bg-ds-surface px-3 py-2 text-[12px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-ds-border-strong"
          placeholder={t('projectDagGoalDescriptionPlaceholder')}
        />
        {inlineError ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={1.8} />
            <span className="min-w-0 break-words">{inlineError}</span>
          </div>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 bg-ds-main">
        {view ? (
          <iframe
            key={`${view.url}:${frameNonce}`}
            src={view.url}
            title={t('rightPanelProjectDag')}
            className="ds-no-drag block h-full w-full border-0 bg-ds-main"
            sandbox="allow-clipboard-write allow-forms allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : null}

        {loading && !view ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ds-main text-ds-faint">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            <span className="ml-2 text-[12px]">{t('projectDagLoading')}</span>
          </div>
        ) : null}

        {loadError && !view ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ds-main px-6">
            <div className="max-w-sm text-center">
              <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" strokeWidth={1.8} />
              <div className="mt-3 text-[13px] font-semibold text-ds-ink">{t('projectDagLoadFailed')}</div>
              <div className="mt-2 break-words text-[12px] leading-5 text-ds-muted">{loadError}</div>
              <button
                type="button"
                onClick={() => setRequestNonce((current) => current + 1)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('projectDagRetry')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
