import { AlertTriangle, Check, FileText, GitMerge, Loader2, PanelRightClose, Pencil, Play, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ProjectDagCompileRequest,
  ProjectDagCompileResult,
  ProjectDagViewName,
  ProjectDagViewRequest,
  ProjectDagViewResult
} from '@shared/sciforge-api'
import {
  projectDagRequestContext,
  loadProjectDagSavedGoal,
  projectDagWorkspaceName,
  saveProjectDagGoal,
  type ProjectDagRequestContext
} from './project-dag-panel-state'

type Props = {
  workspaceRoot?: string
  className?: string
  onCollapse: () => void
}

type ProjectDagSurface = 'evidence' | 'graph'
type ProjectDagViewLoader = (input: ProjectDagViewRequest) => Promise<ProjectDagViewResult>
type ProjectDagCompiler = (input: ProjectDagCompileRequest) => Promise<ProjectDagCompileResult>

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

function projectDagViewForSurface(surface: ProjectDagSurface): ProjectDagViewName {
  return surface === 'graph' ? 'graph' : 'home'
}

async function loadProjectDagView(
  loader: ProjectDagViewLoader,
  viewName: ProjectDagViewName,
  context: ProjectDagRequestContext
): Promise<ProjectDagViewResult> {
  return loader({ view: viewName, ...context })
}

async function runProjectDagCompile(
  compiler: ProjectDagCompiler,
  request: ProjectDagCompileRequest,
  context: ProjectDagRequestContext
): Promise<ProjectDagCompileResult> {
  return compiler({ ...request, ...context })
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
  const [savedGoal, setSavedGoal] = useState({ title: '', description: '' })
  const [editingGoal, setEditingGoal] = useState(false)
  const [activeSurface, setActiveSurface] = useState<ProjectDagSurface>('evidence')

  const requestContext = useMemo(() => projectDagRequestContext(workspaceRoot), [workspaceRoot])
  const projectName = useMemo(() => projectDagWorkspaceName(workspaceRoot), [workspaceRoot])
  const activeViewName = useMemo(() => projectDagViewForSurface(activeSurface), [activeSurface])

  useEffect(() => {
    const saved = loadProjectDagSavedGoal(workspaceRoot)
    const nextGoal = { title: saved?.title || '', description: saved?.description || '' }
    setSavedGoal(nextGoal)
    setTitle(nextGoal.title)
    setDescription(nextGoal.description)
    setSummary(null)
    setEditingGoal(false)
    setActiveSurface('evidence')
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
    void loadProjectDagView(getProjectDagView, activeViewName, requestContext)
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
  }, [activeViewName, requestContext, requestNonce, t])

  const projectSubtitle = useMemo(
    () => projectName ? t('projectDagCurrentProject', { project: projectName }) : t('projectDagGlobalView'),
    [projectName, t]
  )
  const goalTitle = title.trim()
  const goalDescription = description.trim()
  const statusLine = summary || (activeSurface === 'graph' ? t('projectDagGraphSurface') : t('projectDagEvidenceSurface'))
  const inlineError = compileError || (view ? loadError : null)
  const frameTitle = activeSurface === 'graph' ? t('projectDagGraphSurface') : t('projectDagEvidenceSurface')
  const updateTitle = compiling ? t('projectDagUpdating') : t('projectDagUpdateHelp')

  const saveGoalDraft = (): void => {
    const nextGoal = { title: goalTitle, description: goalDescription }
    saveProjectDagGoal(workspaceRoot, nextGoal)
    setSavedGoal(nextGoal)
    setTitle(nextGoal.title)
    setDescription(nextGoal.description)
    setEditingGoal(false)
  }

  const cancelGoalEdit = (): void => {
    setTitle(savedGoal.title)
    setDescription(savedGoal.description)
    setEditingGoal(false)
  }

  const compileCurrentProject = (): void => {
    const runProjectDagCompileHandler = window.sciforge?.runProjectDagCompile
    if (typeof runProjectDagCompileHandler !== 'function') {
      setCompileError(t('projectDagUnavailable'))
      return
    }
    const nextGoal = { title: goalTitle, description: goalDescription }
    saveProjectDagGoal(workspaceRoot, nextGoal)
    setSavedGoal(nextGoal)
    setTitle(nextGoal.title)
    setDescription(nextGoal.description)
    setEditingGoal(false)

    const request: ProjectDagCompileRequest = { scope: 'all' }
    if (nextGoal.title) request.goalTitle = nextGoal.title
    if (nextGoal.description) request.goalDescription = nextGoal.description

    setCompiling(true)
    setCompileError(null)
    setSummary(null)
    void runProjectDagCompile(runProjectDagCompileHandler, request, requestContext)
      .then((result) => {
        setCompileError(null)
        setActiveSurface('graph')
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
            <FileText className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('projectDagPanelTitle')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">{projectSubtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={compileCurrentProject}
            disabled={loading || compiling}
            className="inline-flex h-7 min-w-[88px] items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-[11.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={updateTitle}
            title={updateTitle}
          >
            {compiling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            <span>{compiling ? t('projectDagUpdating') : t('projectDagUpdate')}</span>
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

      <div className="shrink-0 border-b border-ds-border px-4 py-3">
        {editingGoal ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              saveGoalDraft()
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-goal-title">
                {t('projectDagGoalTitle')}
              </label>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="submit"
                  disabled={compiling}
                  className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('projectDagSaveGoal')}
                  title={t('projectDagSaveGoal')}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.85} />
                </button>
                <button
                  type="button"
                  onClick={cancelGoalEdit}
                  disabled={compiling}
                  className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('projectDagCancelGoalEdit')}
                  title={t('projectDagCancelGoalEdit')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.85} />
                </button>
              </div>
            </div>
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
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium text-ds-faint">{t('projectDagGoalTitle')}</div>
              <div className="mt-1 truncate text-[13px] font-medium text-ds-ink">
                {goalTitle || t('projectDagGoalUnset')}
              </div>
              {goalDescription ? (
                <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-ds-muted">{goalDescription}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setEditingGoal(true)}
              disabled={compiling}
              className="mt-0.5 shrink-0 rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('projectDagEditGoal')}
              title={t('projectDagEditGoal')}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        )}

        {inlineError ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={1.8} />
            <span className="min-w-0 break-words">{inlineError}</span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitMerge className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
          <span className="truncate text-[11.5px] text-ds-faint">{statusLine}</span>
        </div>
        <div className="flex shrink-0 rounded-lg border border-ds-border-muted bg-ds-main p-0.5">
          {(['evidence', 'graph'] as const).map((surface) => {
            const active = activeSurface === surface
            return (
              <button
                key={surface}
                type="button"
                onClick={() => setActiveSurface(surface)}
                className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
                  active
                    ? 'bg-ds-surface text-ds-ink shadow-sm'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
                aria-pressed={active}
              >
                {surface === 'graph' ? t('projectDagGraphTab') : t('projectDagEvidenceTab')}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-ds-main p-2">
        <div className="relative h-full min-h-0 overflow-hidden rounded-lg border border-ds-border bg-ds-surface">
          {view ? (
            <iframe
              key={`${view.url}:${frameNonce}`}
              src={view.url}
              title={frameTitle}
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
      </div>
    </aside>
  )
}
