import { AlertTriangle, Check, FileText, GitMerge, Loader2, PanelRightClose, Pencil, Play, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DagAutonomyMode,
  DagPanelStatus,
  ProjectDagGoalSaveRequest,
  ProjectDagUpdateRequest,
  ProjectDagViewName,
  ProjectDagViewRequest,
  ProjectDagViewResult
} from '@shared/sciforge-api'
import {
  projectDagRequestContext,
  projectDagWorkspaceName,
  type ProjectDagRequestContext
} from './project-dag-panel-state'

type Props = {
  workspaceRoot?: string
  className?: string
  onCollapse: () => void
}

type ProjectDagSurface = 'evidence' | 'graph'

export function parseProjectSessionList(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))].sort()
}

function projectDagViewForSurface(surface: ProjectDagSurface): ProjectDagViewName {
  return surface === 'graph' ? 'graph' : 'home'
}

async function loadProjectDagView(
  loader: (input: ProjectDagViewRequest) => Promise<ProjectDagViewResult>,
  viewName: ProjectDagViewName,
  context: ProjectDagRequestContext
): Promise<ProjectDagViewResult> {
  return loader({ view: viewName, ...context })
}

function statusLabel(status: DagPanelStatus, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (status.freshness === 'failed') return t('dagStatusFailed')
  if (status.freshness === 'degraded') return t('dagStatusDegraded')
  if (status.freshness === 'paused') return t('dagStatusPaused')
  if (status.freshness === 'updating') return t('dagStatusUpdating')
  if (status.pendingCount > 0 || status.freshness === 'dirty' || status.freshness === 'queued') {
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

export function ProjectDagPanel({ workspaceRoot = '', className = '', onCollapse }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [view, setView] = useState<ProjectDagViewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [savingGoal, setSavingGoal] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [requestNonce, setRequestNonce] = useState(0)
  const [frameNonce, setFrameNonce] = useState(0)
  const [rootGoalId, setRootGoalId] = useState<string | undefined>()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [savedGoal, setSavedGoal] = useState({ title: '', description: '' })
  const [editingGoal, setEditingGoal] = useState(false)
  const [activeSurface, setActiveSurface] = useState<ProjectDagSurface>('evidence')
  const [autonomyMode, setAutonomyMode] = useState<DagAutonomyMode>('autonomous')
  const [excludedSessionsText, setExcludedSessionsText] = useState('')
  const [isolatedSessionsText, setIsolatedSessionsText] = useState('')

  const requestContext = useMemo(() => projectDagRequestContext(workspaceRoot), [workspaceRoot])
  const projectName = useMemo(() => projectDagWorkspaceName(workspaceRoot), [workspaceRoot])
  const activeViewName = useMemo(() => projectDagViewForSurface(activeSurface), [activeSurface])

  useEffect(() => {
    setRootGoalId(undefined)
    setSavedGoal({ title: '', description: '' })
    setTitle('')
    setDescription('')
    setSummary(null)
    setEditingGoal(false)
    setActiveSurface('evidence')
    setAutonomyMode('autonomous')
    setExcludedSessionsText('')
    setIsolatedSessionsText('')
  }, [workspaceRoot])

  useEffect(() => {
    let cancelled = false
    const loader = window.sciforge?.getProjectDagView
    if (typeof loader !== 'function') {
      setLoadError(t('projectDagUnavailable'))
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    void loadProjectDagView(loader, activeViewName, requestContext)
      .then((result) => {
        if (cancelled) return
        setView(result)
        setFrameNonce((current) => current + 1)
        if (result.goal) {
          const next = { title: result.goal.title, description: result.goal.description ?? '' }
          setRootGoalId(result.goal.id)
          setSavedGoal(next)
          if (!editingGoal) {
            setTitle(next.title)
            setDescription(next.description)
          }
        }
        if (result.status.autonomyMode) setAutonomyMode(result.status.autonomyMode)
        if (result.status.scope) {
          setExcludedSessionsText(result.status.scope.excludedSessions.join('\n'))
          setIsolatedSessionsText(result.status.scope.isolatedSessions.join('\n'))
        }
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeViewName, editingGoal, requestContext, requestNonce, t])

  useEffect(() => {
    const freshness = view?.status.freshness
    if (freshness !== 'queued' && freshness !== 'updating' && freshness !== 'dirty') return
    const timer = setTimeout(() => setRequestNonce((current) => current + 1), 2_000)
    return () => clearTimeout(timer)
  }, [view?.status.freshness, view?.status.pendingCount])

  const projectSubtitle = projectName ? t('projectDagCurrentProject', { project: projectName }) : t('projectDagGlobalView')
  const goalTitle = title.trim()
  const goalDescription = description.trim()
  const inlineError = commandError || (view ? loadError : null)
  const status = view?.status

  const cancelGoalEdit = (): void => {
    setTitle(savedGoal.title)
    setDescription(savedGoal.description)
    setEditingGoal(false)
  }

  const saveGoal = (): void => {
    const handler = window.sciforge?.saveProjectDagGoal
    if (typeof handler !== 'function' || !goalTitle) {
      setCommandError(t('projectDagUnavailable'))
      return
    }
    const request: ProjectDagGoalSaveRequest = {
      title: goalTitle,
      ...(goalDescription ? { description: goalDescription } : {}),
      ...(rootGoalId ? { rootGoalId } : {}),
      ...requestContext,
      autonomyMode
    }
    setSavingGoal(true)
    setCommandError(null)
    void handler(request).then((result) => {
      setRootGoalId(result.goalId)
      setSavedGoal({ title: goalTitle, description: goalDescription })
      setEditingGoal(false)
      setSummary(t('projectDagGoalQueued'))
      setView((current) => current ? { ...current, status: result.status } : current)
    }).catch((cause) => setCommandError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSavingGoal(false))
  }

  const updateProject = (): void => {
    const handler = window.sciforge?.updateProjectDag
    if (typeof handler !== 'function') {
      setCommandError(t('projectDagUnavailable'))
      return
    }
    const request: ProjectDagUpdateRequest = {
      scope: 'all',
      ...requestContext,
      autonomyMode,
      excludedSessions: parseProjectSessionList(excludedSessionsText),
      isolatedSessions: parseProjectSessionList(isolatedSessionsText)
    }
    setSubmitting(true)
    setCommandError(null)
    setSummary(null)
    void handler(request).then((result) => {
      setView({ url: result.url, status: result.status, ...(view?.goal ? { goal: view.goal } : {}) })
      setSummary(t('projectDagUpdateQueued'))
      setFrameNonce((current) => current + 1)
    }).catch((cause) => setCommandError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSubmitting(false))
  }

  return (
    <aside className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink"><FileText className="h-4 w-4 text-ds-muted" /><span>{t('projectDagPanelTitle')}</span></div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">{projectSubtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={updateProject} disabled={loading || submitting || savingGoal} className="inline-flex h-7 min-w-[88px] items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-50" aria-label={t('projectDagUpdateHelp')} title={t('projectDagUpdateHelp')}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}<span>{submitting ? t('projectDagUpdating') : t('projectDagUpdate')}</span>
          </button>
          <button type="button" onClick={() => setRequestNonce((current) => current + 1)} disabled={loading || submitting} className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50" aria-label={t('projectDagRefresh')} title={t('projectDagRefresh')}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={onCollapse} className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink" aria-label={t('rightPanelCollapse')} title={t('rightPanelCollapse')}><PanelRightClose className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="shrink-0 border-b border-ds-border px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-autonomy">{t('projectDagAutonomyMode')}</label>
          <select id="project-dag-autonomy" value={autonomyMode} onChange={(event) => setAutonomyMode(event.target.value as DagAutonomyMode)} disabled={submitting || savingGoal} className="rounded-lg border border-ds-border bg-ds-surface px-2 py-1 text-[11.5px] text-ds-ink">
            <option value="autonomous">{t('projectDagAutonomous')}</option>
            <option value="checkpointed">{t('projectDagCheckpointed')}</option>
            <option value="supervised">{t('projectDagSupervised')}</option>
          </select>
        </div>
        <details className="mb-3 rounded-lg border border-ds-border-muted bg-ds-main px-3 py-2">
          <summary className="cursor-pointer text-[11.5px] font-medium text-ds-faint">
            {t('projectDagScopeDispositions')}
            {status?.scope ? ` · ${t('projectDagScopeIncludedCount', { count: status.scope.includedSessions.length })}` : ''}
          </summary>
          <div className="mt-2 space-y-2">
            <p className="text-[11px] leading-4 text-ds-faint">{t('projectDagScopeHelp')}</p>
            <label className="block text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-excluded-sessions">{t('projectDagExcludedSessions')}</label>
            <textarea id="project-dag-excluded-sessions" value={excludedSessionsText} onChange={(event) => setExcludedSessionsText(event.target.value)} disabled={submitting || savingGoal} rows={2} className="w-full resize-y rounded-lg border border-ds-border-muted bg-ds-surface px-2.5 py-1.5 font-mono text-[11px] leading-4 text-ds-ink outline-none" placeholder={t('projectDagSessionListPlaceholder')} />
            <label className="block text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-isolated-sessions">{t('projectDagIsolatedSessions')}</label>
            <textarea id="project-dag-isolated-sessions" value={isolatedSessionsText} onChange={(event) => setIsolatedSessionsText(event.target.value)} disabled={submitting || savingGoal} rows={2} className="w-full resize-y rounded-lg border border-ds-border-muted bg-ds-surface px-2.5 py-1.5 font-mono text-[11px] leading-4 text-ds-ink outline-none" placeholder={t('projectDagSessionListPlaceholder')} />
          </div>
        </details>
        {editingGoal ? (
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); saveGoal() }}>
            <div className="flex items-center justify-between"><label className="text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-goal-title">{t('projectDagGoalTitle')}</label><div className="flex gap-1"><button type="submit" disabled={savingGoal || !goalTitle} className="rounded-lg p-1.5 text-ds-muted disabled:opacity-50" aria-label={t('projectDagSaveGoal')} title={t('projectDagSaveGoal')}>{savingGoal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button><button type="button" onClick={cancelGoalEdit} disabled={savingGoal} className="rounded-lg p-1.5 text-ds-muted" aria-label={t('projectDagCancelGoalEdit')}><X className="h-3.5 w-3.5" /></button></div></div>
            <input id="project-dag-goal-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={savingGoal} className="w-full rounded-lg border border-ds-border-muted bg-ds-surface px-3 py-2 text-[12px] text-ds-ink outline-none" placeholder={t('projectDagGoalTitlePlaceholder')} />
            <label className="block text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-goal-description">{t('projectDagGoalDescription')}</label>
            <textarea id="project-dag-goal-description" value={description} onChange={(event) => setDescription(event.target.value)} disabled={savingGoal} rows={2} className="w-full resize-none rounded-lg border border-ds-border-muted bg-ds-surface px-3 py-2 text-[12px] leading-5 text-ds-ink outline-none" placeholder={t('projectDagGoalDescriptionPlaceholder')} />
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[11.5px] font-medium text-ds-faint">{t('projectDagGoalTitle')}</div><div className="mt-1 truncate text-[13px] font-medium text-ds-ink">{goalTitle || t('projectDagGoalUnset')}</div>{goalDescription ? <div className="mt-1 line-clamp-2 text-[12px] text-ds-muted">{goalDescription}</div> : null}</div><button type="button" onClick={() => setEditingGoal(true)} disabled={savingGoal} className="rounded-lg p-1.5 text-ds-muted" aria-label={t('projectDagEditGoal')}><Pencil className="h-3.5 w-3.5" /></button></div>
        )}
        {inlineError ? <div role="status" className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{inlineError}</span></div> : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><GitMerge className="h-3.5 w-3.5 text-ds-muted" />{status ? <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(status)}`}>{statusLabel(status, t)}</span> : null}{status?.attentionCount ? <span className="text-[11px] text-amber-700">{t('dagAttentionCount', { count: status.attentionCount })}</span> : null}{status?.auditStale ? <span className="text-[11px] text-amber-700">{t('dagAuditStale')}</span> : null}{summary ? <span className="truncate text-[11px] text-ds-faint">{summary}</span> : null}</div>
        <div className="flex shrink-0 rounded-lg border border-ds-border-muted bg-ds-main p-0.5">{(['evidence', 'graph'] as const).map((surface) => <button key={surface} type="button" onClick={() => setActiveSurface(surface)} className={`rounded-md px-2 py-1 text-[11.5px] font-medium ${activeSurface === surface ? 'bg-ds-surface text-ds-ink shadow-sm' : 'text-ds-muted hover:bg-ds-hover'}`} aria-pressed={activeSurface === surface}>{surface === 'graph' ? t('projectDagGraphTab') : t('projectDagEvidenceTab')}</button>)}</div>
      </div>
      {status?.latestSnapshotDigest ? <div className="shrink-0 truncate border-b border-ds-border px-4 py-1.5 font-mono text-[10.5px] text-ds-faint" title={status.latestSnapshotDigest}>{t('dagSnapshotDigest')}: {status.latestSnapshotDigest}{status.auditTargetDigest ? ` · ${t('dagAuditDigest')}: ${status.auditTargetDigest}` : ''}</div> : null}

      <div className="min-h-0 flex-1 bg-ds-main p-2"><div className="relative h-full overflow-hidden rounded-lg border border-ds-border bg-ds-surface">
        {view ? <iframe key={`${view.url}:${frameNonce}`} src={view.url} title={activeSurface === 'graph' ? t('projectDagGraphSurface') : t('projectDagEvidenceSurface')} className="ds-no-drag block h-full w-full border-0 bg-ds-main" sandbox="allow-clipboard-write allow-forms allow-same-origin allow-scripts" referrerPolicy="no-referrer" /> : null}
        {loading && !view ? <div className="absolute inset-0 flex items-center justify-center bg-ds-main text-ds-faint"><Loader2 className="h-4 w-4 animate-spin" /><span className="ml-2 text-[12px]">{t('projectDagLoading')}</span></div> : null}
        {loadError && !view ? <div className="absolute inset-0 flex items-center justify-center bg-ds-main px-6"><div className="max-w-sm text-center"><AlertTriangle className="mx-auto h-5 w-5 text-amber-500" /><div className="mt-3 text-[13px] font-semibold text-ds-ink">{t('projectDagLoadFailed')}</div><div className="mt-2 text-[12px] text-ds-muted">{loadError}</div><button type="button" onClick={() => setRequestNonce((current) => current + 1)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-[12px]"><RefreshCw className="h-3.5 w-3.5" />{t('projectDagRetry')}</button></div></div> : null}
      </div></div>
    </aside>
  )
}
