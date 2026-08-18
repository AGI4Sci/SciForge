import {
  AlertTriangle,
  GitMerge,
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
  DomainRendererWorkbenchHost,
  DomainRendererWorkspacePreviewHost,
  DomainWorkbenchRightPanelActivation,
  DomainWorkbenchRightPanelSession
} from '@sciforge/domain-sdk/host'
import { evidenceDagActivationPayloadSchema } from '@sciforge/domain-evidence-dag/contract'
import {
  EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION
} from '@sciforge/domain-evidence-dag/definition'
import {
  projectDagActivationPayloadSchema,
  type ProjectDagActivationPayload,
  type ProjectDagAutonomyMode,
  type ProjectDagStatus,
  type ProjectDagTarget,
  type ProjectDagViewOutput
} from '../contract'
import type { ProjectDagCapabilityClient } from './project-dag-capability-client'
import {
  projectDagPendingIsActive,
  projectDagPollInterval,
  ProjectDagProgressiveView
} from './project-dag-progressive-view'
import {
  handleProjectDagPreviewMessage,
  normalizeProjectDagGraphNodeId
} from './project-dag-preview-bridge'

export type ProjectDagPanelProps = Readonly<{
  active: boolean
  className?: string
  onCollapse: () => void
  session: DomainWorkbenchRightPanelSession
  surfaceId: string
  activation?: DomainWorkbenchRightPanelActivation
  client: ProjectDagCapabilityClient
  workspacePreview?: DomainRendererWorkspacePreviewHost
  workbench?: DomainRendererWorkbenchHost
}>

export type ProjectDagPanelTarget = ProjectDagTarget & Readonly<{
  view: NonNullable<ProjectDagActivationPayload['view']>
  focus?: NonNullable<ProjectDagActivationPayload['focus']>
}>

export function projectDagPanelTarget(
  session: DomainWorkbenchRightPanelSession,
  activation?: DomainWorkbenchRightPanelActivation
): ProjectDagPanelTarget {
  const parsed = projectDagActivationPayloadSchema.safeParse(activation?.payload)
  const payload: ProjectDagActivationPayload | undefined = parsed.success
    ? parsed.data
    : undefined
  const sessionRoot = session.workspaceRoot?.trim()
  return {
    ...(sessionRoot
      ? { workspaceRoot: sessionRoot, projectRoot: sessionRoot }
      : {}),
    ...payload,
    view: payload?.view ?? 'home'
  }
}

export function projectDagFrameUrl(
  url: string,
  claimId?: string,
  nodeId?: string
): string {
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

export function projectDagCommittedFrameKey(
  url: string,
  snapshotDigest?: string
): string {
  return `${url}:${snapshotDigest?.trim() ?? ''}`
}

export function projectDagUpdateScope(
  status: ProjectDagStatus | undefined
): 'all' | string[] {
  if (!status) return 'all'
  const sessions = [...new Set([
    ...status.scope.includedSessions,
    ...status.scope.excludedSessions,
    ...status.scope.isolatedSessions
  ])].sort()
  return sessions.length > 0 ? sessions : 'all'
}

export function ProjectDagPanel({
  active,
  className = '',
  onCollapse,
  session,
  surfaceId,
  activation,
  client,
  workspacePreview,
  workbench
}: ProjectDagPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const target = useMemo(
    () => projectDagPanelTarget(session, activation),
    [activation, session]
  )
  const targetKey = JSON.stringify(target)
  const [view, setView] = useState<ProjectDagViewOutput | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [savingGoal, setSavingGoal] = useState(false)
  const [requestRevision, setRequestRevision] = useState(0)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDescription, setGoalDescription] = useState('')
  const [rootGoalId, setRootGoalId] = useState<string | undefined>()
  const [autonomyMode, setAutonomyMode] =
    useState<ProjectDagAutonomyMode>('autonomous')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const viewInput = useMemo(
    () => ({
      ...projectTarget(target),
      view: target.view
    }),
    [target]
  )
  const frameUrl = useMemo(
    () => view
      ? projectDagFrameUrl(
          view.url,
          target.focus?.claimId,
          target.focus?.nodeId
        )
      : null,
    [target.focus?.claimId, target.focus?.nodeId, view]
  )
  const status = view?.status
  const committedDigest = status?.committed?.digest

  useEffect(() => {
    setView(null)
    setSummary(null)
    setError(null)
    setGoalTitle('')
    setGoalDescription('')
    setRootGoalId(undefined)
  }, [targetKey])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void client.view(viewInput)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        setView(result.data)
        setSummary(null)
        setAutonomyMode(result.data.status.autonomyMode)
        if (result.data.goal) {
          setGoalTitle(result.data.goal.title)
          setGoalDescription(result.data.goal.description ?? '')
          setRootGoalId(result.data.goal.id)
        }
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
    const interval = projectDagPollInterval(active, status?.pending)
    if (interval === null) return
    const timer = window.setTimeout(
      () => setRequestRevision((revision) => revision + 1),
      interval
    )
    return () => window.clearTimeout(timer)
  }, [active, status?.pending])

  useEffect(() => {
    if (!frameUrl) return
    const onMessage = (event: MessageEvent): void => {
      void handleProjectDagPreviewMessage({
        event,
        frameWindow: iframeRef.current?.contentWindow ?? null,
        frameUrl,
        sessionId: session.id,
        surfaceId,
        target: projectTarget(target),
        committedSnapshotDigest: committedDigest,
        activationRevision: activation?.revision,
        workspacePreview,
        resolvePreview: client.resolveEvidencePreview,
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
    client.resolveEvidencePreview,
    committedDigest,
    frameUrl,
    session.id,
    surfaceId,
    t,
    target,
    workspacePreview
  ])

  const updateProject = (): void => {
    setSubmitting(true)
    setError(null)
    setSummary(null)
    void client.update({
      ...projectTarget(target),
      scope: projectDagUpdateScope(status),
      excludedSessions: status?.scope.excludedSessions ?? [],
      isolatedSessions: status?.scope.isolatedSessions ?? [],
      autonomyMode
    }).then((result) => {
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setView((current) => ({
        url: result.data.url,
        status: result.data.status,
        ...(current?.goal ? { goal: current.goal } : {})
      }))
    }).catch((cause: unknown) => {
      setError(errorMessage(cause))
    }).finally(() => {
      setSubmitting(false)
    })
  }

  const saveGoal = (): void => {
    const title = goalTitle.trim()
    if (!title) return
    setSavingGoal(true)
    setError(null)
    void client.saveGoal({
      ...projectTarget(target),
      title,
      ...(goalDescription.trim()
        ? { description: goalDescription.trim() }
        : {}),
      ...(rootGoalId ? { rootGoalId } : {}),
      autonomyMode
    }).then((result) => {
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setRootGoalId(result.data.goal.id)
      setView((current) => current
        ? {
            ...current,
            goal: result.data.goal,
            status: result.data.status
          }
        : current)
      setSummary(t('projectDagGoalSaved'))
    }).catch((cause: unknown) => {
      setError(errorMessage(cause))
    }).finally(() => {
      setSavingGoal(false)
    })
  }

  const openEvidenceDag = (engineThreadId: string, snapshotDigest: string): void => {
    const nextActivation = projectDagEvidenceActivation(
      engineThreadId,
      snapshotDigest,
      (activation?.revision ?? 0) + 1
    )
    if (!nextActivation || !workbench) return
    const contributionId = EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
    workbench.openRightPanel({
      contributionId,
      sessionId: session.id,
      surfaceId,
      activation: nextActivation
    })
  }

  const pending = status?.pending
  const updateBusy = submitting || projectDagPendingIsActive(pending)
  const projectName = workspaceName(
    target.projectRoot ?? target.workspaceRoot ?? target.project ?? ''
  )
  const subtitle = projectName
    ? t('projectDagCurrentProject', { project: projectName })
    : t('projectDagGlobalView')
  const pendingMeta = pending
    ? [
        t('projectDagLastActivity', { time: formatTime(pending.updatedAt) }),
        t('projectDagAttempt', { count: pending.attempts })
      ].join(' · ')
    : null
  const pendingError = pending?.state === 'failed'
    ? pending.error?.message
    : null

  return (
    <aside
      className={`ds-no-drag flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}
      data-domain-panel="project-dag"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <GitMerge className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('rightPanelProjectDag')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">
            {summary ?? subtitle}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={updateProject}
            disabled={loading || updateBusy}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateBusy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            {t('projectDagUpdate')}
          </button>
          <button
            type="button"
            onClick={() => setRequestRevision((revision) => revision + 1)}
            disabled={loading}
            className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            aria-label={t('projectDagRefresh')}
            title={t('projectDagRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('projectDagCollapse')}
            title={t('projectDagCollapse')}
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </header>

      {status ? <ProjectDagProgressiveView status={status} t={t} /> : null}
      {pending && pending.state !== 'failed' ? (
        <div
          className="h-1 shrink-0 overflow-hidden bg-sky-100"
          role="progressbar"
          aria-label={t('projectDagAttemptLayer')}
        >
          <div className="h-full w-full animate-pulse bg-sky-500/70" />
        </div>
      ) : null}
      {status && (status.attentionCount > 0 || status.auditStale) ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-ds-border-muted px-3 py-1.5 text-[10.5px]">
          {status.attentionCount > 0 ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800">
              {t('projectDagAttention', { count: status.attentionCount })}
            </span>
          ) : null}
          {status.auditStale ? (
            <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-rose-700">
              {t('projectDagAuditStale')}
            </span>
          ) : null}
        </div>
      ) : null}
      {status?.committed?.evidenceVector.length ? (
        <div className="shrink-0 border-b border-ds-border-muted px-3 py-2">
          <div className="mb-1.5 text-[10.5px] font-medium text-ds-faint">
            {t('projectDagEvidenceSessions')}
          </div>
          <div className="flex flex-wrap gap-1">
            {status.committed.evidenceVector.slice(0, 8).map((evidence) => {
              const identity = parseEngineThreadId(evidence.threadId)
              return (
                <button
                  key={evidence.threadId}
                  type="button"
                  onClick={() => openEvidenceDag(evidence.threadId, evidence.digest)}
                  disabled={!identity || !workbench}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-ds-border bg-ds-surface px-2 py-0.5 text-[10.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:opacity-60"
                  title={t('projectDagOpenEvidence', {
                    session: identity?.threadId ?? evidence.threadId
                  })}
                >
                  <Network className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {identity?.threadId ?? evidence.threadId}
                  </span>
                </button>
              )
            })}
          </div>
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

      <div className="min-h-0 flex-1 bg-ds-main">
        {loading && !view ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('projectDagLoading')}
          </div>
        ) : frameUrl && view ? (
          <iframe
            ref={iframeRef}
            key={projectDagCommittedFrameKey(frameUrl, committedDigest)}
            src={frameUrl}
            title={t('rightPanelProjectDag')}
            className="ds-no-drag block h-full w-full border-0 bg-ds-main"
            data-dag-layer="committed"
            sandbox="allow-downloads allow-forms allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-ds-muted">
            <GitMerge className="h-8 w-8 text-ds-faint" />
            <span>{error ? t('projectDagUnavailable') : t('projectDagEmpty')}</span>
            <button
              type="button"
              onClick={updateProject}
              disabled={submitting}
              className="rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-xs text-ds-ink hover:bg-ds-hover disabled:opacity-50"
            >
              {t('projectDagUpdate')}
            </button>
          </div>
        )}
      </div>

      <details className="shrink-0 border-t border-ds-border bg-ds-sidebar px-3 py-2 text-[11px] text-ds-muted">
        <summary className="cursor-pointer select-none">{t('projectDagGoal')}</summary>
        <div className="mt-2 grid gap-2">
          <input
            value={goalTitle}
            onChange={(event) => setGoalTitle(event.target.value)}
            placeholder={t('projectDagGoalTitle')}
            maxLength={500}
            className="rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 text-xs text-ds-ink outline-none focus:border-ds-accent"
          />
          <textarea
            value={goalDescription}
            onChange={(event) => setGoalDescription(event.target.value)}
            placeholder={t('projectDagGoalDescription')}
            maxLength={4_000}
            rows={2}
            className="resize-none rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 text-xs text-ds-ink outline-none focus:border-ds-accent"
          />
          <div className="flex items-center justify-between gap-2">
            <select
              value={autonomyMode}
              onChange={(event) =>
                setAutonomyMode(event.target.value as ProjectDagAutonomyMode)}
              className="rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 text-xs text-ds-ink"
            >
              <option value="autonomous">Autonomous</option>
              <option value="checkpointed">Checkpointed</option>
              <option value="supervised">Supervised</option>
            </select>
            <button
              type="button"
              onClick={saveGoal}
              disabled={!goalTitle.trim() || savingGoal}
              className="inline-flex items-center gap-1.5 rounded-md border border-ds-border bg-ds-surface px-2.5 py-1.5 text-xs text-ds-ink hover:bg-ds-hover disabled:opacity-50"
            >
              {savingGoal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('projectDagGoalSave')}
            </button>
          </div>
        </div>
      </details>
    </aside>
  )
}

function projectTarget(target: ProjectDagPanelTarget): ProjectDagTarget {
  const {
    view: _view,
    focus: _focus,
    ...project
  } = target
  return project
}

function workspaceName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? ''
}

export function parseEngineThreadId(
  value: string
): Readonly<{ runtimeId: string; threadId: string }> | null {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) return null
  return {
    runtimeId: value.slice(0, separator),
    threadId: value.slice(separator + 1)
  }
}

export function projectDagEvidenceActivation(
  engineThreadId: string,
  snapshotDigest: string,
  revision: number
): DomainWorkbenchRightPanelActivation | null {
  const identity = parseEngineThreadId(engineThreadId)
  if (!identity) return null
  const contributionId = EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  const parsed = evidenceDagActivationPayloadSchema.safeParse({
    view: 'graph',
    runtimeId: identity.runtimeId,
    threadId: identity.threadId,
    snapshotDigest
  })
  if (!parsed.success) return null
  return {
    contributionId,
    revision,
    payload: parsed.data
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString()
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
