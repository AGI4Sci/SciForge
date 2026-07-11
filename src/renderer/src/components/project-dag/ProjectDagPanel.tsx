import { AlertTriangle, Check, FileText, GitMerge, Loader2, PanelRightClose, Pencil, Play, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DagAutonomyMode,
  DagPanelStatus,
  DagUpdateProgress,
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
import { handleProjectDagPreviewMessage } from './project-dag-preview-bridge'
import { normalizeProjectDagGraphNodeId } from '../../lib/workspace-file-preview'

type Props = {
  workspaceRoot?: string
  initialClaimId?: string
  initialNodeId?: string
  className?: string
  onCollapse: () => void
  onInitialClaimConsumed?: () => void
  onInitialNodeConsumed?: () => void
}

export const PROJECT_DAG_REVIEW_VIEW: ProjectDagViewName = 'home'

export function projectDagReviewRequest(context: ProjectDagRequestContext): ProjectDagViewRequest {
  return { view: PROJECT_DAG_REVIEW_VIEW, ...context }
}

export function parseProjectSessionList(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))].sort()
}

export function projectDagUpdateScope(status: DagPanelStatus | undefined): 'all' | string[] {
  const scope = status?.scope
  if (!scope) return 'all'
  const sessions = [...new Set([
    ...scope.includedSessions,
    ...scope.excludedSessions,
    ...scope.isolatedSessions
  ])].sort()
  return sessions.length > 0 ? sessions : 'all'
}

export function projectDagFrameUrl(url: string, claimId?: string, nodeId?: string): string {
  const normalizedClaimId = claimId?.trim()
  const normalizedNodeId = normalizeProjectDagGraphNodeId(nodeId)
  if (!normalizedClaimId && !normalizedNodeId) return url
  try {
    const parsed = new URL(url)
    if (normalizedClaimId) parsed.searchParams.set('claim', normalizedClaimId)
    if (normalizedNodeId) parsed.searchParams.set('node', normalizedNodeId)
    return parsed.toString()
  } catch {
    return url
  }
}

export function consumeProjectDagInitialClaim(
  pendingClaim: { current: string | undefined }
): string | undefined {
  const claimId = pendingClaim.current
  pendingClaim.current = undefined
  return claimId
}

export function consumeProjectDagInitialNode(
  pendingNode: { current: string | undefined }
): string | undefined {
  const nodeId = pendingNode.current
  pendingNode.current = undefined
  return nodeId
}

async function loadProjectDagView(
  loader: (input: ProjectDagViewRequest) => Promise<ProjectDagViewResult>,
  context: ProjectDagRequestContext
): Promise<ProjectDagViewResult> {
  return loader(projectDagReviewRequest(context))
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

export function projectDagProgressPercent(progress: DagUpdateProgress): number {
  if (progress.stage === 'capturing') return 8
  if (progress.stage === 'evidence') {
    const fraction = progress.totalItems > 0
      ? Math.min(1, Math.max(0, progress.completedItems / progress.totalItems))
      : 0
    return Math.round(18 + fraction * 42)
  }
  if (progress.stage === 'project') return 68
  if (progress.stage === 'compile') return 86
  return 68
}

function progressLabel(
  progress: DagUpdateProgress,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  if (progress.stage === 'capturing') return t('projectDagProgressCapturing')
  if (progress.stage === 'evidence') {
    return t('projectDagProgressEvidence', {
      completed: progress.completedItems,
      total: progress.totalItems
    })
  }
  if (progress.stage === 'project') return t('projectDagProgressProject')
  if (progress.stage === 'compile') return t('projectDagProgressCompile')
  return t('projectDagProgressRetrying')
}

function progressActivity(
  progress: DagUpdateProgress,
  t: (key: string, values?: Record<string, unknown>) => string
): string | null {
  const activity = progress.updatedAt
    ? t('projectDagProgressActivity', {
        time: new Date(progress.updatedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      })
    : null
  const attempt = progress.attempt
    ? t('projectDagProgressAttempt', { count: progress.attempt })
    : null
  return [activity, attempt].filter(Boolean).join(' · ') || null
}

export function ProjectDagPanel({
  workspaceRoot = '',
  initialClaimId,
  initialNodeId,
  className = '',
  onCollapse,
  onInitialClaimConsumed,
  onInitialNodeConsumed
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const pendingInitialClaimRef = useRef(initialClaimId?.trim() || undefined)
  const pendingInitialNodeRef = useRef(normalizeProjectDagGraphNodeId(initialNodeId))
  const [view, setView] = useState<ProjectDagViewResult | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [optimisticProgress, setOptimisticProgress] = useState<DagUpdateProgress | null>(null)
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
  const [autonomyMode, setAutonomyMode] = useState<DagAutonomyMode>('autonomous')
  const [excludedSessionsText, setExcludedSessionsText] = useState('')
  const [isolatedSessionsText, setIsolatedSessionsText] = useState('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const requestContext = useMemo(() => projectDagRequestContext(workspaceRoot), [workspaceRoot])
  const projectName = useMemo(() => projectDagWorkspaceName(workspaceRoot), [workspaceRoot])

  useEffect(() => {
    setRootGoalId(undefined)
    setSavedGoal({ title: '', description: '' })
    setTitle('')
    setDescription('')
    setSummary(null)
    setOptimisticProgress(null)
    setEditingGoal(false)
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
    void loadProjectDagView(loader, requestContext)
      .then((result) => {
        if (cancelled) return
        setFrameUrl(projectDagFrameUrl(
          result.url,
          pendingInitialClaimRef.current,
          pendingInitialNodeRef.current
        ))
        setView((current) => {
          const inFlightProgress = current?.status.progress ?? optimisticProgress
          if (submitting && inFlightProgress && !result.status.progress && result.status.freshness === 'fresh') {
            return {
              ...result,
              status: {
                ...result.status,
                freshness: current?.status.freshness ?? 'queued',
                pendingCount: Math.max(1, current?.status.pendingCount ?? 0),
                progress: inFlightProgress
              }
            }
          }
          return result
        })
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
        if (result.status.scope && !result.status.progress) {
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
  }, [editingGoal, optimisticProgress, requestContext, requestNonce, submitting, t])

  useEffect(() => {
    const freshness = view?.status.freshness
    if (!submitting && !optimisticProgress && !view?.status.progress &&
        freshness !== 'queued' && freshness !== 'updating' && freshness !== 'dirty') return
    const timer = setTimeout(() => setRequestNonce((current) => current + 1), 2_000)
    return () => clearTimeout(timer)
  }, [optimisticProgress, submitting, view?.status.freshness, view?.status.pendingCount, view?.status.progress])

  useEffect(() => {
    const root = workspaceRoot.trim()
    if (!frameUrl || !root) return
    const onMessage = (event: MessageEvent): void => {
      const resolver = window.sciforge?.resolveProjectDagEvidencePreview
      void handleProjectDagPreviewMessage({
        event,
        frameWindow: iframeRef.current?.contentWindow ?? null,
        frameUrl,
        workspaceRoot: root,
        ...(requestContext.projectRoot ? { projectRoot: requestContext.projectRoot } : {}),
        expectedSnapshotDigest: view?.status.latestSnapshotDigest,
        resolveProjectDagEvidencePreview: typeof resolver === 'function'
          ? (target) => resolver(target)
          : async () => ({
              ok: false,
              code: 'file_unavailable',
              message: t('projectDagUnavailable')
            })
      }).then((result) => {
        if (result.status === 'rejected') setCommandError(result.message)
        if (result.status === 'opened') setCommandError(null)
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frameUrl, requestContext.projectRoot, t, view?.status.latestSnapshotDigest, workspaceRoot])

  const projectSubtitle = projectName ? t('projectDagCurrentProject', { project: projectName }) : t('projectDagGlobalView')
  const goalTitle = title.trim()
  const goalDescription = description.trim()
  const inlineError = commandError || (view ? loadError : null)
  const status = view?.status
  const activeProgress = status?.progress ?? optimisticProgress
  const updateBusy = submitting || Boolean(activeProgress && activeProgress.stage !== 'retrying')
  const progressPercent = activeProgress ? projectDagProgressPercent(activeProgress) : 0
  const progressMeta = activeProgress ? progressActivity(activeProgress, t) : null

  const cancelGoalEdit = (): void => {
    setTitle(savedGoal.title)
    setDescription(savedGoal.description)
    setEditingGoal(false)
  }

  const consumeInitialSelection = (): void => {
    if (consumeProjectDagInitialClaim(pendingInitialClaimRef)) onInitialClaimConsumed?.()
    if (consumeProjectDagInitialNode(pendingInitialNodeRef)) onInitialNodeConsumed?.()
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
      scope: projectDagUpdateScope(status),
      ...requestContext,
      autonomyMode,
      excludedSessions: parseProjectSessionList(excludedSessionsText),
      isolatedSessions: parseProjectSessionList(isolatedSessionsText)
    }
    setSubmitting(true)
    setOptimisticProgress({
      stage: 'capturing',
      completedItems: 0,
      totalItems: status?.scope?.includedSessions.length ?? 0,
      updatedAt: new Date().toISOString()
    })
    setCommandError(null)
    setSummary(null)
    void handler(request).then((result) => {
      setFrameUrl(projectDagFrameUrl(
        result.url,
        pendingInitialClaimRef.current,
        pendingInitialNodeRef.current
      ))
      setView({ url: result.url, status: result.status, ...(view?.goal ? { goal: view.goal } : {}) })
      setSummary(t('projectDagUpdateQueued'))
      setOptimisticProgress(null)
      setFrameNonce((current) => current + 1)
    }).catch((cause) => {
      setOptimisticProgress(null)
      setCommandError(cause instanceof Error ? cause.message : String(cause))
    })
      .finally(() => setSubmitting(false))
  }

  return (
    <aside className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-ds-border px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-ds-muted" />
          <span className="shrink-0 text-[13px] font-semibold text-ds-ink">{t('projectDagPanelTitle')}</span>
          <span className="truncate text-[11.5px] text-ds-faint">· {projectSubtitle}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" onClick={updateProject} disabled={loading || updateBusy || savingGoal} className="inline-flex h-7 min-w-[88px] items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-50" aria-label={t('projectDagUpdateHelp')} title={t('projectDagUpdateHelp')}>
            {updateBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}<span>{updateBusy ? t('projectDagUpdating') : t('projectDagUpdate')}</span>
          </button>
          <button type="button" onClick={() => setRequestNonce((current) => current + 1)} disabled={loading || submitting} className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50" aria-label={t('projectDagRefresh')} title={t('projectDagRefresh')}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={onCollapse} className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink" aria-label={t('rightPanelCollapse')} title={t('rightPanelCollapse')}><PanelRightClose className="h-4 w-4" /></button>
        </div>
      </header>

      <details className="group shrink-0 border-b border-ds-border bg-ds-sidebar">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-[11px] marker:hidden sm:px-4 [&::-webkit-details-marker]:hidden">
          <GitMerge className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
          {status ? <span className={`shrink-0 rounded-full border px-2 py-0.5 font-medium ${statusTone(status)}`}>{statusLabel(status, t)}</span> : null}
          <span className="shrink-0 text-ds-faint">{t('projectDagAutonomyMode')}: {autonomyMode === 'autonomous' ? t('projectDagAutonomous') : autonomyMode === 'checkpointed' ? t('projectDagCheckpointed') : t('projectDagSupervised')}</span>
          {status?.scope ? <span className="shrink-0 text-ds-faint">· {t('projectDagScopeIncludedCount', { count: status.scope.includedSessions.length })}</span> : null}
          <span className="min-w-0 flex-1 truncate text-ds-muted">· {goalTitle || t('projectDagGoalUnset')}</span>
          {status?.attentionCount ? <span className="shrink-0 text-amber-700">{t('dagAttentionCount', { count: status.attentionCount })}</span> : null}
          <span className="shrink-0 font-medium text-ds-muted group-open:text-ds-ink">{t('projectDagSettings')}</span>
        </summary>
        <div className="border-t border-ds-border-muted px-3 py-3 sm:px-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <label className="text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-autonomy">{t('projectDagAutonomyMode')}</label>
            <select id="project-dag-autonomy" value={autonomyMode} onChange={(event) => setAutonomyMode(event.target.value as DagAutonomyMode)} disabled={updateBusy || savingGoal} className="rounded-lg border border-ds-border bg-ds-surface px-2 py-1 text-[11.5px] text-ds-ink">
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
              <textarea id="project-dag-excluded-sessions" value={excludedSessionsText} onChange={(event) => setExcludedSessionsText(event.target.value)} disabled={updateBusy || savingGoal} rows={2} className="w-full resize-y rounded-lg border border-ds-border-muted bg-ds-surface px-2.5 py-1.5 font-mono text-[11px] leading-4 text-ds-ink outline-none" placeholder={t('projectDagSessionListPlaceholder')} />
              <label className="block text-[11.5px] font-medium text-ds-faint" htmlFor="project-dag-isolated-sessions">{t('projectDagIsolatedSessions')}</label>
              <textarea id="project-dag-isolated-sessions" value={isolatedSessionsText} onChange={(event) => setIsolatedSessionsText(event.target.value)} disabled={updateBusy || savingGoal} rows={2} className="w-full resize-y rounded-lg border border-ds-border-muted bg-ds-surface px-2.5 py-1.5 font-mono text-[11px] leading-4 text-ds-ink outline-none" placeholder={t('projectDagSessionListPlaceholder')} />
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
          {status?.auditStale ? <div className="mt-2 text-[11px] text-amber-700">{t('dagAuditStale')}</div> : null}
          {summary ? <div className="mt-2 text-[11px] text-ds-faint">{summary}</div> : null}
          {inlineError ? <div role="status" className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{inlineError}</span></div> : null}
        </div>
      </details>
      {activeProgress ? (
        <div
          role="status"
          aria-live="polite"
          className={`shrink-0 border-b px-4 py-3 ${activeProgress.stage === 'retrying' ? 'border-amber-200 bg-amber-50/70' : 'border-sky-200 bg-sky-50/70'}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className={`flex min-w-0 items-center gap-2 text-[11.5px] font-medium ${activeProgress.stage === 'retrying' ? 'text-amber-800' : 'text-sky-800'}`}>
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">{progressLabel(activeProgress, t)}</span>
            </div>
            <span className="shrink-0 text-[10.5px] tabular-nums text-ds-faint">{progressPercent}%</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-ds-border-muted"
            role="progressbar"
            aria-label={progressLabel(activeProgress, t)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <div className={`h-full rounded-full transition-[width] duration-500 ${activeProgress.stage === 'retrying' ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${progressPercent}%` }} />
          </div>
          {progressMeta ? <div className="mt-1.5 truncate text-[10.5px] text-ds-faint">{progressMeta}</div> : null}
          {status?.lastError ? <div className="mt-1 break-words text-[10.5px] text-amber-800">{status.lastError}</div> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 bg-ds-main p-1 sm:p-1.5"><div className="relative h-full overflow-hidden rounded-md border border-ds-border bg-ds-surface sm:rounded-lg">
        {frameUrl ? <iframe ref={iframeRef} key={`${frameUrl}:${frameNonce}`} src={frameUrl} title={t('projectDagReviewSurface')} className="ds-no-drag block h-full w-full border-0 bg-ds-main" sandbox="allow-clipboard-write allow-forms allow-same-origin allow-scripts" referrerPolicy="no-referrer" onLoad={consumeInitialSelection} /> : null}
        {loading && !view ? <div className="absolute inset-0 flex items-center justify-center bg-ds-main text-ds-faint"><Loader2 className="h-4 w-4 animate-spin" /><span className="ml-2 text-[12px]">{t('projectDagLoading')}</span></div> : null}
        {loadError && !view ? <div className="absolute inset-0 flex items-center justify-center bg-ds-main px-6"><div className="max-w-sm text-center"><AlertTriangle className="mx-auto h-5 w-5 text-amber-500" /><div className="mt-3 text-[13px] font-semibold text-ds-ink">{t('projectDagLoadFailed')}</div><div className="mt-2 text-[12px] text-ds-muted">{loadError}</div><button type="button" onClick={() => setRequestNonce((current) => current + 1)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-[12px]"><RefreshCw className="h-3.5 w-3.5" />{t('projectDagRetry')}</button></div></div> : null}
      </div></div>
    </aside>
  )
}
