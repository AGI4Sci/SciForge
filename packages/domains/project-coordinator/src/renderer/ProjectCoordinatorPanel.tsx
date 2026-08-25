import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode
} from 'react'
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
  ProjectCoordinatorPlanDraft,
  ProjectCoordinatorProjectCreateResult,
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

export function projectCoordinatorCreatedSelection(
  result: ProjectCoordinatorProjectCreateResult
): Readonly<{
  workspace: ProjectCoordinatorWorkspace
  selectedProjectId: string
}> {
  return Object.freeze({
    workspace: result.workspace,
    selectedProjectId: result.createdProjectId
  })
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
  const [draft, setDraft] = useState<ProjectCoordinatorPlanDraft | null>(null)
  const [busyAction, setBusyAction] = useState<string>()
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createGoal, setCreateGoal] = useState('')
  const [createCoordinatorAgentId, setCreateCoordinatorAgentId] = useState('')
  const [createCoordinatorRevision, setCreateCoordinatorRevision] = useState('1')
  const [createWorkerUserIds, setCreateWorkerUserIds] = useState('')

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
        const nextDraft = await client.readPlanDraft({ projectId: preferred })
        if (!signal?.aborted) setDraft(nextDraft)
      } else if (next.projects.length === 1) {
        const onlyProjectId = next.projects[0]!.project.projectId
        setSelectedProjectId(onlyProjectId)
        const nextDraft = await client.readPlanDraft({ projectId: onlyProjectId })
        if (!signal?.aborted) setDraft(nextDraft)
      } else {
        setSelectedProjectId('')
        setDraft(null)
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

  const runAction = useCallback(async <T,>(
    action: string,
    operation: () => Promise<T>,
    apply: (value: T) => void | Promise<void>
  ) => {
    setBusyAction(action)
    setError(undefined)
    try {
      await apply(await operation())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('projectCoordinatorActionFailed'))
    } finally {
      setBusyAction(undefined)
    }
  }, [t])

  const createProject = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (workspace?.connection.state !== 'ready') return
    const workerUserIds = createWorkerUserIds.split(',').map((value) => value.trim()).filter(Boolean)
    const memberUserIds = [...new Set([workspace.connection.userId, ...workerUserIds])]
    void runAction('project-create', () => client.createProject({
      displayName: createDisplayName,
      goal: createGoal,
      coordinatorAgentId: createCoordinatorAgentId,
      expectedCoordinatorAgentRevision: Number(createCoordinatorRevision),
      budget: {
        maxTasks: 32,
        maxTasksPerRound: 8,
        maxTaskRetries: 2,
        maxCoordinationRounds: 4
      },
      content: {
        mode: 'none',
        members: memberUserIds.map((userId) => ({ userId }))
      }
    }), async (result) => {
      const selected = projectCoordinatorCreatedSelection(result)
      setWorkspace(selected.workspace)
      setSelectedProjectId(selected.selectedProjectId)
      setDraft(await client.readPlanDraft({ projectId: selected.selectedProjectId }))
      setCreateDisplayName('')
      setCreateGoal('')
      setCreateCoordinatorAgentId('')
      setCreateWorkerUserIds('')
    })
  }, [
    client,
    createCoordinatorAgentId,
    createCoordinatorRevision,
    createDisplayName,
    createGoal,
    createWorkerUserIds,
    runAction,
    workspace
  ])

  const generateDraft = useCallback(() => {
    if (!project) return
    void runAction('plan-generate', () => client.generatePlanDraft({
      projectId: project.project.projectId,
      instruction: project.project.goal,
      sourceInputLocators: [],
      modelId: null
    }), setDraft)
  }, [client, project, runAction])

  const editDraftAssignment = useCallback((planItemId: string, selectedAgentId: string) => {
    if (!draft) return
    const nextAssignments = draft.assignments.map((assignment) => (
      assignment.planItemId === planItemId
        ? {
            ...assignment,
            selectedAgentId: selectedAgentId || null,
            recommendationReason: selectedAgentId
              ? t('projectCoordinatorOwnerSelectedExactAgent')
              : null
          }
        : assignment
    ))
    void runAction('plan-edit', () => client.editPlanDraft({
      projectId: draft.projectId,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
      tasks: draft.tasks,
      rationale: draft.rationale,
      assignments: nextAssignments
    }), setDraft)
  }, [client, draft, runAction, t])

  const submitDraft = useCallback(() => {
    if (!draft) return
    void runAction('plan-submit', () => client.submitPlanDraft({
      projectId: draft.projectId,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision
    }), (result) => {
      setWorkspace(result.workspace)
      setSelectedProjectId(result.plan.projectId)
      setDraft(null)
    })
  }, [client, draft, runAction])

  const confirmActivate = useCallback(() => {
    if (!project?.plan || project.plan.plan.state !== 'awaiting_confirmation') return
    const plan = project.plan.plan
    void runAction('plan-confirm', () => client.confirmPlanAndActivate({
      projectId: project.project.projectId,
      projectPlanId: plan.projectPlanId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      expectedPlanRevision: plan.revision,
      planDigest: plan.planDigest
    }), (next) => {
      setWorkspace(next)
      setSelectedProjectId(project.project.projectId)
    })
  }, [client, project, runAction])

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

        {workspace?.connection.state === 'ready' ? (
          <ProjectCreateForm
            busy={busyAction === 'project-create'}
            coordinatorAgentId={createCoordinatorAgentId}
            coordinatorRevision={createCoordinatorRevision}
            displayName={createDisplayName}
            goal={createGoal}
            workerUserIds={createWorkerUserIds}
            onCoordinatorAgentId={setCreateCoordinatorAgentId}
            onCoordinatorRevision={setCreateCoordinatorRevision}
            onDisplayName={setCreateDisplayName}
            onGoal={setCreateGoal}
            onSubmit={createProject}
            onWorkerUserIds={setCreateWorkerUserIds}
          />
        ) : null}

        {workspace?.connection.state === 'ready' && workspace.projects.length > 0 ? (
          <label className="block text-xs font-medium text-ds-muted">
            {t('projectCoordinatorProject')}
            <select
              className="mt-1 w-full rounded border border-ds-border bg-ds-surface px-2 py-1.5 text-xs text-ds-text"
              value={project?.project.projectId ?? ''}
              onChange={(event) => {
                const projectId = event.currentTarget.value
                if (projectId) void refresh(projectId)
              }}
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
        <ProjectCoordinatorPlanSection
          project={project}
          draft={draft}
          busy={Boolean(busyAction?.startsWith('plan-'))}
          onGenerate={generateDraft}
          onEditDraft={editDraftAssignment}
          onSubmitDraft={submitDraft}
          onConfirmActivate={confirmActivate}
        />
        <WorkersSection project={project} />
        <TasksSection project={project} />
        <ReviewsSection project={project} />
        <ProvisioningSection project={project} />
      </div>
    </aside>
  )
}

function ProjectCreateForm({
  busy,
  coordinatorAgentId,
  coordinatorRevision,
  displayName,
  goal,
  workerUserIds,
  onCoordinatorAgentId,
  onCoordinatorRevision,
  onDisplayName,
  onGoal,
  onSubmit,
  onWorkerUserIds
}: Readonly<{
  busy: boolean
  coordinatorAgentId: string
  coordinatorRevision: string
  displayName: string
  goal: string
  workerUserIds: string
  onCoordinatorAgentId(value: string): void
  onCoordinatorRevision(value: string): void
  onDisplayName(value: string): void
  onGoal(value: string): void
  onSubmit(event: FormEvent<HTMLFormElement>): void
  onWorkerUserIds(value: string): void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <form className="rounded-lg border border-ds-border bg-ds-surface p-2.5" onSubmit={onSubmit}>
      <h3 className="mb-2 text-xs font-semibold">{t('projectCoordinatorCreateProject')}</h3>
      <div className="grid gap-2">
        <input required value={displayName} onChange={(event) => onDisplayName(event.currentTarget.value)} placeholder={t('projectCoordinatorProjectName')} className="rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
        <textarea required value={goal} onChange={(event) => onGoal(event.currentTarget.value)} placeholder={t('projectCoordinatorProjectGoal')} className="rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
        <input required value={coordinatorAgentId} onChange={(event) => onCoordinatorAgentId(event.currentTarget.value)} placeholder={t('projectCoordinatorCoordinatorAgentId')} className="rounded border border-ds-border bg-ds-bg px-2 py-1.5 font-mono text-xs" />
        <input required min={1} type="number" value={coordinatorRevision} onChange={(event) => onCoordinatorRevision(event.currentTarget.value)} placeholder={t('projectCoordinatorAgentRevision')} className="rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
        <input value={workerUserIds} onChange={(event) => onWorkerUserIds(event.currentTarget.value)} placeholder={t('projectCoordinatorWorkerUserIds')} className="rounded border border-ds-border bg-ds-bg px-2 py-1.5 font-mono text-xs" />
        <button disabled={busy} type="submit" className="rounded bg-ds-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorCreateProject')}
        </button>
      </div>
    </form>
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

export function ProjectCoordinatorPlanSection({
  project,
  draft,
  busy,
  onGenerate,
  onEditDraft,
  onSubmitDraft,
  onConfirmActivate
}: Readonly<{
  project?: ProjectCoordinatorProject
  draft: ProjectCoordinatorPlanDraft | null
  busy: boolean
  onGenerate(): void
  onEditDraft(planItemId: string, selectedAgentId: string): void
  onSubmitDraft(): void
  onConfirmActivate(): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const visibleAgents = project?.workerGroups.flatMap((group) => group.agents) ?? []
  const awaitingConfirmation = project?.plan?.plan.state === 'awaiting_confirmation'
  return (
    <Section id="plan" title={t('projectCoordinatorPlan')} icon={<ListChecks className="h-4 w-4" />}>
      {!project ? <Empty /> : awaitingConfirmation ? (
        <div className="space-y-2 rounded border border-amber-500/40 p-2" data-default-visible-card="plan-confirmation">
          <Status value="awaiting_confirmation" />
          <p className="text-[11px] text-ds-muted">{project.plan!.plan.rationale}</p>
          <button type="button" disabled={busy} onClick={onConfirmActivate} className="rounded bg-ds-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {t('projectCoordinatorConfirmActivate')}
          </button>
        </div>
      ) : draft ? (
        <div className="space-y-2" data-default-visible-card="plan-draft">
          <Status value="draft" />
          {draft.tasks.map((item) => {
            const assignment = draft.assignments.find(({ planItemId }) => planItemId === item.planItemId)
            return (
              <label key={item.planItemId} className="block rounded border border-ds-border p-2 text-xs">
                <span className="font-medium">{item.title}</span>
                <select
                  className="mt-1 w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                  value={assignment?.selectedAgentId ?? ''}
                  disabled={busy}
                  onChange={(event) => onEditDraft(item.planItemId, event.currentTarget.value)}
                >
                  <option value="">{t('projectCoordinatorChooseExactAgent')}</option>
                  {visibleAgents.map((agent) => (
                    <option key={agent.projectAvailability.agentId} value={agent.projectAvailability.agentId}>
                      {agent.displayName} · {agent.projectAvailability.agentId}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
          <button
            type="button"
            disabled={busy || draft.assignments.some(({ selectedAgentId }) => selectedAgentId === null)}
            onClick={onSubmitDraft}
            className="rounded bg-ds-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {t('projectCoordinatorSubmitPlan')}
          </button>
        </div>
      ) : !project.plan ? (
        <div className="space-y-2">
          <Empty message={t('projectCoordinatorPlanMissing')} />
          <button type="button" disabled={busy} onClick={onGenerate} className="rounded border border-ds-border px-2 py-1.5 text-xs disabled:opacity-50">
            {t('projectCoordinatorGeneratePlan')}
          </button>
        </div>
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
  }
}
