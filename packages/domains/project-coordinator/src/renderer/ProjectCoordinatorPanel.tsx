import React, { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import {
  ClipboardCheck,
  FileCheck2,
  ListChecks,
  Loader2,
  RefreshCw,
  UsersRound,
  Warehouse,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DomainWorkbenchRightPanelSession } from '@sciforge/domain-sdk/host'

import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorWorkspace
} from '../contract.js'
import type { ProjectCoordinatorRendererClient } from './project-coordinator-capability-client.js'

export const PROJECT_COORDINATOR_PANEL_SECTION_IDS = Object.freeze([
  'plan',
  'workers',
  'tasks',
  'reviews',
  'provisioning'
] as const)

export type ProjectCoordinatorPanelProps = Readonly<{
  client: ProjectCoordinatorRendererClient
  session: DomainWorkbenchRightPanelSession
  initialProjectId?: string
  className?: string
  onCollapse?: () => void
}>

export function selectFocusedProject(
  workspace: ProjectCoordinatorWorkspace | undefined,
  requestedProjectId?: string
): ProjectCoordinatorProject | undefined {
  if (!workspace) return undefined
  const exactId = requestedProjectId ?? workspace.focusedProjectId
  if (exactId) return workspace.projects.find(({ project }) => project.projectId === exactId)
  return workspace.projects.length === 1 ? workspace.projects[0] : undefined
}

export function ProjectCoordinatorPanel({
  client,
  session,
  initialProjectId,
  className,
  onCollapse
}: ProjectCoordinatorPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [workspace, setWorkspace] = useState<ProjectCoordinatorWorkspace>()
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async (projectId?: string, signal?: AbortSignal) => {
    setLoading(true)
    setError(undefined)
    try {
      const next = await client.readWorkspace(projectId ? { projectId } : {})
      if (signal?.aborted) return
      setWorkspace(next)
      const preferred = projectId ?? next.focusedProjectId
      if (preferred && next.projects.some(({ project }) => project.projectId === preferred)) {
        setSelectedProjectId(preferred)
      } else if (next.projects.length === 1) {
        setSelectedProjectId(next.projects[0]!.project.projectId)
      }
    } catch (cause) {
      if (signal?.aborted) return
      setError(cause instanceof Error ? cause.message : t('projectCoordinatorReadFailed'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [client, t])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(initialProjectId, controller.signal)
    return () => controller.abort()
  }, [initialProjectId, refresh, session.id])

  const project = useMemo(
    () => selectFocusedProject(workspace, selectedProjectId || initialProjectId),
    [initialProjectId, selectedProjectId, workspace]
  )

  const connectionMessage = workspace && workspace.connection.state !== 'ready'
    ? connectionMessageKey(workspace.connection.state)
    : undefined

  return (
    <aside
      className={`ds-no-drag flex h-full min-h-0 flex-col bg-ds-bg text-ds-text ${className ?? ''}`}
      data-domain="project-coordinator"
      data-session-id={session.id}
    >
      <header className="flex items-center gap-2 border-b border-ds-border px-3 py-2.5">
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t('projectCoordinatorTitle')}
        </h2>
        <button
          type="button"
          className="rounded p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-text"
          aria-label={t('projectCoordinatorRefresh')}
          disabled={loading}
          onClick={() => void refresh(selectedProjectId || undefined)}
        >
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        </button>
        {onCollapse ? (
          <button
            type="button"
            className="rounded p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-text"
            aria-label={t('projectCoordinatorCollapse')}
            onClick={onCollapse}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {connectionMessage ? (
          <Notice tone="warning">
            {t(connectionMessage)}
            {'reason' in workspace!.connection ? ` ${workspace!.connection.reason}` : ''}
          </Notice>
        ) : null}
        {loading && !workspace ? <Notice>{t('projectCoordinatorLoading')}</Notice> : null}

        {workspace?.connection.state === 'ready' && workspace.projects.length > 0 ? (
          <label className="block text-xs font-medium text-ds-muted">
            {t('projectCoordinatorProject')}
            <select
              className="mt-1 w-full rounded border border-ds-border bg-ds-surface px-2 py-1.5 text-xs text-ds-text"
              value={project?.project.projectId ?? ''}
              onChange={(event) => setSelectedProjectId(event.currentTarget.value)}
            >
              <option value="">{t('projectCoordinatorNoProject')}</option>
              {workspace.projects.map((candidate) => (
                <option key={candidate.project.projectId} value={candidate.project.projectId}>
                  {candidate.project.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {project ? <ProjectSummary project={project} /> : null}
        <PlanSection project={project} />
        <WorkersSection project={project} />
        <TasksSection project={project} />
        <ReviewsSection project={project} />
        <ProvisioningSection project={project} />
      </div>
    </aside>
  )
}

function ProjectSummary({ project }: Readonly<{ project: ProjectCoordinatorProject }>): ReactElement {
  const { t } = useTranslation('common')
  const record = project.project
  return (
    <div className="rounded border border-ds-border bg-ds-surface p-2.5 text-xs">
      <div className="font-semibold">{record.displayName}</div>
      <p className="mt-1 whitespace-pre-wrap text-ds-muted">{record.goal}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-ds-muted">{t('projectCoordinatorOwner')}</dt>
        <dd className="break-all font-mono">{record.ownerUserId}</dd>
        <dt className="text-ds-muted">{t('projectCoordinatorCoordinator')}</dt>
        <dd className="break-all font-mono">{record.coordinatorAgentId}</dd>
        <dt className="text-ds-muted">{t('projectCoordinatorRevision')}</dt>
        <dd>{record.revision}</dd>
      </dl>
    </div>
  )
}

function PlanSection({ project }: Readonly<{ project?: ProjectCoordinatorProject }>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <Section id="plan" title={t('projectCoordinatorPlan')} icon={<ListChecks className="h-4 w-4" />}>
      {!project ? <Empty /> : !project.plan ? (
        <Empty message={t('projectCoordinatorPlanMissing')} />
      ) : (
        <div className="space-y-2 text-xs">
          <Status value={project.plan.plan.state} />
          {project.plan.plan.tasks.map((item) => {
            const assignment = project.plan?.assignments.find(
              ({ planItemId }) => planItemId === item.planItemId
            )
            return (
            <div key={item.planItemId} className="rounded border border-ds-border p-2">
              <div className="font-medium">{item.title}</div>
              <p className="mt-1 text-[11px] text-ds-muted">{item.objective}</p>
              {assignment?.selectedAgentId ? (
                <div className="mt-1 break-all text-[10px] font-mono text-ds-faint">
                  {t('projectCoordinatorExactAgent')}: {assignment.selectedAgentId}
                </div>
              ) : null}
            </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

function WorkersSection({ project }: Readonly<{ project?: ProjectCoordinatorProject }>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <Section id="workers" title={t('projectCoordinatorWorkers')} icon={<UsersRound className="h-4 w-4" />}>
      {!project?.workerGroups.length ? (
        <Empty message={project ? t('projectCoordinatorNoWorkers') : undefined} />
      ) : project.workerGroups.map((group) => (
        <div key={group.userId} className="mb-2 rounded border border-ds-border p-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium">{group.displayName}</span>
            <Status value={group.agents[0]?.projectAvailability.membership?.state ?? 'not_member'} />
          </div>
          <div className="break-all text-[10px] font-mono text-ds-faint">{group.userId}</div>
          <div className="mt-2 space-y-1.5">
            {group.agents.map((agent) => (
              <div key={agent.projectAvailability.agentId} className="rounded bg-ds-bg px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span>{agent.displayName}</span>
                  <Status value={agent.projectAvailability.availability.connectionStatus} />
                </div>
                <div className="break-all text-[10px] font-mono text-ds-faint">
                  {agent.projectAvailability.agentId}
                </div>
                <div className="mt-1 text-[10px] text-ds-muted">
                  {t('projectCoordinatorActiveTasks', {
                    count: agent.projectAvailability.availability.activeTaskCount
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  )
}

function TasksSection({ project }: Readonly<{ project?: ProjectCoordinatorProject }>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <Section id="tasks" title={t('projectCoordinatorTasks')} icon={<FileCheck2 className="h-4 w-4" />}>
      {!project?.tasks.length ? <Empty message={project ? t('projectCoordinatorNoTasks') : undefined} /> : (
        <div className="space-y-2 text-xs">
          {project.tasks.map((task) => (
            <div key={task.task.taskId} className="rounded border border-ds-border p-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{task.task.title}</span>
                <Status value={task.task.status} />
              </div>
              <div className="mt-1 break-all text-[10px] font-mono text-ds-faint">
                {task.task.taskId}
                {task.task.currentExecutionId
                  ? ` · ${task.executions.find(({ executionId }) => (
                      executionId === task.task.currentExecutionId
                    ))?.assigneeAgentId ?? task.task.currentExecutionId}`
                  : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function ReviewsSection({ project }: Readonly<{ project?: ProjectCoordinatorProject }>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <Section id="reviews" title={t('projectCoordinatorReviews')} icon={<ClipboardCheck className="h-4 w-4" />}>
      {!project?.reviews.length ? <Empty message={project ? t('projectCoordinatorNoReviews') : undefined} /> : (
        <div className="space-y-2 text-xs">
          {project.reviews.map((review) => (
            <div key={review.submission.resultSubmissionId} className="rounded border border-ds-border p-2">
              <div className="flex items-start justify-between gap-2">
                <span className="break-all font-mono text-[10px]">{review.submission.taskId}</span>
                <Status value={review.decision?.decision ?? 'awaiting_review'} />
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-ds-muted">
                {review.submission.summary}
              </p>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function ProvisioningSection({ project }: Readonly<{ project?: ProjectCoordinatorProject }>): ReactElement {
  const { t } = useTranslation('common')
  const provisioning = project?.provisioning
  const provisioningState = provisioning?.binding?.status ?? provisioning?.intent?.state
  return (
    <Section id="provisioning" title={t('projectCoordinatorProvisioning')} icon={<Warehouse className="h-4 w-4" />}>
      {!provisioning ? <Empty /> : (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <Status value={provisioningState ?? 'unbound'} />
            <span className="text-[10px] text-ds-muted">
              {t('projectCoordinatorRevision')}{' '}
              {provisioning.binding?.provisioningRevision ?? provisioning.intent?.provisioningRevision ?? '—'}
            </span>
          </div>
          {provisioning.recoveryActions[0] ? (
            <p className="text-[11px] text-ds-muted">
              {t('projectCoordinatorProvisioningNext')}: {provisioning.recoveryActions[0].safeSummary}
            </p>
          ) : null}
          {project!.workerGroups.map((group) => (
            <div key={group.userId} className="grid grid-cols-[1fr_auto] gap-2 rounded bg-ds-bg px-2 py-1.5 text-[10px]">
              <span className="break-all font-mono">{group.userId}</span>
              <span>
                {group.agents[0]?.projectAvailability.membership?.state ?? 'not_member'} ·{' '}
                {group.agents[0]?.projectAvailability.contentReadiness?.state ?? 'missing_identity'} ·{' '}
                {group.agents[0]?.projectAvailability.providerPrincipalSnapshotStatus ?? 'not_applicable'} ·{' '}
                {group.agents[0]?.projectAvailability.taskAuthorities
                  .map(({ state }) => state).join('/') || 'blocked'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function Section({
  id,
  title,
  icon,
  children
}: Readonly<{
  id: (typeof PROJECT_COORDINATOR_PANEL_SECTION_IDS)[number]
  title: string
  icon: ReactNode
  children: ReactNode
}>): ReactElement {
  return (
    <section
      className="rounded-lg border border-ds-border bg-ds-surface p-2.5"
      data-coordinator-section={id}
    >
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Empty({ message }: Readonly<{ message?: string }>): ReactElement {
  const { t } = useTranslation('common')
  return <p className="text-[11px] text-ds-muted">{message ?? t('projectCoordinatorEmpty')}</p>
}

function Notice({ children, tone = 'neutral' }: Readonly<{
  children: ReactNode
  tone?: 'neutral' | 'warning' | 'error'
}>): ReactElement {
  const toneClass = tone === 'error'
    ? 'border-red-500/40 text-red-600'
    : tone === 'warning'
      ? 'border-amber-500/40 text-amber-700'
      : 'border-ds-border text-ds-muted'
  return <p className={`rounded border p-2 text-xs ${toneClass}`}>{children}</p>
}

function Status({ value }: Readonly<{ value: string }>): ReactElement {
  return (
    <span className="shrink-0 rounded-full border border-ds-border px-1.5 py-0.5 text-[10px] text-ds-muted">
      {value.replaceAll('_', ' ')}
    </span>
  )
}

function connectionMessageKey(
  state: Exclude<ProjectCoordinatorWorkspace['connection']['state'], 'ready'>
): string {
  switch (state) {
    case 'identity_required': return 'projectCoordinatorIdentityRequired'
    case 'device_required': return 'projectCoordinatorDeviceRequired'
    case 'cloud_unavailable': return 'projectCoordinatorCloudUnavailable'
    case 'coordination_protocol_unavailable': return 'projectCoordinatorProtocolUnavailable'
  }
}
