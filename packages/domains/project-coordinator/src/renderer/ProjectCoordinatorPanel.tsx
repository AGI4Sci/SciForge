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
  ArrowRightLeft,
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
import { taskFileDestinationNameSchema } from '@sciforge/collaboration-contracts'
import type { DomainWorkbenchRightPanelSession } from '@sciforge/domain-sdk/host'

import type {
  ProjectCoordinatorCompleteInput,
  ProjectCoordinatorArtifactReviewPrepareInput,
  ProjectCoordinatorContentRecoveryAbandonInput,
  ProjectCoordinatorContentRecoveryObserveLinkInput,
  ProjectCoordinatorContentRecoveryRetrySuccessorInput,
  ProjectCoordinatorHumanAnswerInput,
  ProjectCoordinatorHumanNeededCreateInput,
  ProjectCoordinatorMembershipAddInput,
  ProjectCoordinatorMembershipRemoveInput,
  ProjectCoordinatorPlanDraft,
  ProjectCoordinatorPlanDraftEditInput,
  ProjectCoordinatorProjectCreateResult,
  ProjectCoordinatorProject,
  ProjectCoordinatorProvisioningApplyInput,
  ProjectCoordinatorProvisioningPlan,
  ProjectCoordinatorResultReviewInput,
  ProjectCoordinatorWorkspace
} from '../contract.js'
import type { ProjectCoordinatorRendererClient } from './project-coordinator-capability-client.js'

export const PROJECT_COORDINATOR_PANEL_SECTION_IDS = Object.freeze([
  'coordinator',
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
  onOpenArtifact?: (input: ProjectCoordinatorArtifactReviewPrepareInput) => Promise<void>
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

/**
 * Narrows the Human-reviewed full plan to the immutable Cloud/Host CAS facts accepted by apply.
 * Provider operations remain Host-owned and cannot be replaced by renderer input.
 */
export function projectCoordinatorProvisioningApplyInput(
  plan: ProjectCoordinatorProvisioningPlan
): ProjectCoordinatorProvisioningApplyInput {
  return {
    projectId: plan.projectId,
    provisioningIntentId: plan.provisioningIntentId,
    expectedProjectRevision: plan.expectedProjectRevision,
    expectedProvisioningRevision: plan.expectedProvisioningRevision,
    expectedProvisioningIntentRevision: plan.expectedProvisioningIntentRevision,
    intentDigest: plan.intentDigest,
    attemptId: plan.attemptId,
    confirmedPlanDigest: plan.confirmedPlanDigest
  }
}

export function ProjectCoordinatorPanel({
  client,
  session,
  initialProjectId,
  className,
  onCollapse,
  onOpenArtifact
}: ProjectCoordinatorPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [workspace, setWorkspace] = useState<ProjectCoordinatorWorkspace>()
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState<ProjectCoordinatorPlanDraft | null>(null)
  const [provisioningPlan, setProvisioningPlan] = useState<ProjectCoordinatorProvisioningPlan>()
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
      setProvisioningPlan(undefined)
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

  useEffect(() => {
    setProvisioningPlan(undefined)
  }, [project?.project.projectId, project?.project.revision])

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

  const editDraft = useCallback((content: Pick<
    ProjectCoordinatorPlanDraftEditInput,
    'tasks' | 'rationale' | 'assignments'
  >) => {
    if (!draft) return
    void runAction('plan-edit', () => client.editPlanDraft({
      projectId: draft.projectId,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
      ...content
    }), setDraft)
  }, [client, draft, runAction])

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

  const applyProjectWorkspace = useCallback((next: ProjectCoordinatorWorkspace) => {
    setWorkspace(next)
    if (next.focusedProjectId) setSelectedProjectId(next.focusedProjectId)
  }, [])

  const createHumanNeeded = useCallback((input: ProjectCoordinatorHumanNeededCreateInput) => {
    void runAction('human-needed-create', () => client.createHumanNeeded(input), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const answerHumanNeeded = useCallback((input: ProjectCoordinatorHumanAnswerInput) => {
    void runAction('human-answer', () => client.answerHumanNeeded(input), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const transferCoordinator = useCallback((input: Readonly<{
    projectId: string
    coordinatorAgentId: string
  }>) => {
    void runAction('coordinator-transfer', () => (
      client.transferCoordinator(input)
    ), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const reviewResult = useCallback((input: ProjectCoordinatorResultReviewInput) => {
    void runAction('result-review', () => client.reviewResult(input), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const openArtifact = useCallback((input: ProjectCoordinatorArtifactReviewPrepareInput) => {
    if (!onOpenArtifact) return
    void runAction('artifact-review', () => onOpenArtifact(input), () => undefined)
  }, [onOpenArtifact, runAction])

  const completeProject = useCallback((input: ProjectCoordinatorCompleteInput) => {
    void runAction('project-complete', () => client.completeProject(input), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const previewProvisioning = useCallback(() => {
    if (!project) return
    void runAction('provisioning-preview', () => client.previewProvisioning({
      projectId: project.project.projectId
    }), setProvisioningPlan)
  }, [client, project, runAction])

  const applyProvisioning = useCallback((plan: ProjectCoordinatorProvisioningPlan) => {
    void runAction('provisioning-apply', () => client.applyProvisioning(
      projectCoordinatorProvisioningApplyInput(plan)
    ), (next) => {
      applyProjectWorkspace(next)
      setProvisioningPlan(undefined)
    })
  }, [applyProjectWorkspace, client, runAction])

  const observeAndLinkRecovery = useCallback((
    input: ProjectCoordinatorContentRecoveryObserveLinkInput
  ) => {
    void runAction('recovery-observe-link', () => (
      client.observeAndLinkRecovery(input)
    ), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const abandonRecovery = useCallback((
    input: ProjectCoordinatorContentRecoveryAbandonInput
  ) => {
    void runAction('recovery-abandon', () => (
      client.abandonRecovery(input)
    ), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const retryRecoverySuccessor = useCallback((
    input: ProjectCoordinatorContentRecoveryRetrySuccessorInput
  ) => {
    void runAction('recovery-retry-successor', () => (
      client.retryRecoverySuccessor(input)
    ), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const addMember = useCallback((input: ProjectCoordinatorMembershipAddInput) => {
    void runAction('membership-add', () => client.addMember(input), (next) => {
      applyProjectWorkspace(next)
      setProvisioningPlan(undefined)
    })
  }, [applyProjectWorkspace, client, runAction])

  const removeMember = useCallback((input: ProjectCoordinatorMembershipRemoveInput) => {
    void runAction('membership-remove', () => client.removeMember(input), (next) => {
      applyProjectWorkspace(next)
      setProvisioningPlan(undefined)
    })
  }, [applyProjectWorkspace, client, runAction])

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
        <ProjectCoordinatorTransferSection
          project={project}
          canTransfer={workspace?.connection.state === 'ready' &&
            workspace.connection.userId === project?.project.ownerUserId}
          busy={busyAction === 'coordinator-transfer'}
          onTransfer={transferCoordinator}
        />
        <ProjectCoordinatorPlanSection
          project={project}
          draft={draft}
          busy={Boolean(busyAction?.startsWith('plan-'))}
          onGenerate={generateDraft}
          onEditDraft={editDraft}
          onSubmitDraft={submitDraft}
          onConfirmActivate={confirmActivate}
        />
        <WorkersSection project={project} />
        <TasksSection project={project} />
        <ProjectCoordinatorDecisionSection
          project={project}
          canAnswer={workspace?.connection.state === 'ready' &&
            workspace.connection.userId === project?.project.ownerUserId}
          busy={Boolean(busyAction && !busyAction.startsWith('plan-'))}
          onCreateHumanNeeded={createHumanNeeded}
          onAnswerHumanNeeded={answerHumanNeeded}
          onOpenArtifact={onOpenArtifact ? openArtifact : undefined}
          onReviewResult={reviewResult}
          onComplete={completeProject}
        />
        <ProjectCoordinatorProvisioningSection
          project={project}
          plan={provisioningPlan ?? null}
          canManage={workspace?.connection.state === 'ready' &&
            workspace.connection.userId === project?.project.ownerUserId}
          busy={Boolean(busyAction?.startsWith('provisioning-') ||
            busyAction?.startsWith('membership-') ||
            busyAction?.startsWith('recovery-'))}
          onPreview={previewProvisioning}
          onApply={applyProvisioning}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onObserveAndLinkRecovery={observeAndLinkRecovery}
          onAbandonRecovery={abandonRecovery}
          onRetryRecoverySuccessor={retryRecoverySuccessor}
        />
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

export function projectCoordinatorTransferCandidates(
  project: ProjectCoordinatorProject
): ProjectCoordinatorProject['workerGroups'][number]['agents'] {
  if (project.project.status === 'completed' || project.project.status === 'cancelled') return []
  const ownerGroup = project.workerGroups.find(({ userId }) => (
    userId === project.project.ownerUserId
  ))
  return ownerGroup?.agents.filter(({ projectAvailability }) => {
    const availability = projectAvailability.availability
    return projectAvailability.userId === project.project.ownerUserId &&
      projectAvailability.agentId !== project.project.coordinatorAgentId &&
      projectAvailability.membership?.state === 'active' &&
      availability.agentActive &&
      availability.deviceActive &&
      availability.connectionStatus === 'online' &&
      availability.runtimeReadiness === 'ready'
  }) ?? []
}

export type ProjectCoordinatorWorkerPresenceSummary = Readonly<{
  onlineUsers: number
  visibleUsers: number
  onlineAgents: number
  visibleAgents: number
}>

/**
 * Summarises the exact Cloud worker projection without inventing a second presence source.
 * A User is online when at least one of their visible Agents is online, so multiple Devices
 * owned by the same Human never inflate the online member count.
 */
export function projectCoordinatorWorkerPresenceSummary(
  project: ProjectCoordinatorProject
): ProjectCoordinatorWorkerPresenceSummary {
  let onlineUsers = 0
  let onlineAgents = 0
  let visibleAgents = 0
  for (const group of project.workerGroups) {
    const groupOnlineAgents = group.agents.filter(({ projectAvailability }) => (
      projectAvailability.availability.connectionStatus === 'online'
    )).length
    onlineAgents += groupOnlineAgents
    visibleAgents += group.agents.length
    if (groupOnlineAgents > 0) onlineUsers += 1
  }
  return Object.freeze({
    onlineUsers,
    visibleUsers: project.workerGroups.length,
    onlineAgents,
    visibleAgents
  })
}

export function ProjectCoordinatorTransferSection({
  project,
  canTransfer,
  busy,
  onTransfer
}: Readonly<{
  project?: ProjectCoordinatorProject
  canTransfer: boolean
  busy: boolean
  onTransfer(input: Readonly<{ projectId: string; coordinatorAgentId: string }>): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const candidates = project ? projectCoordinatorTransferCandidates(project) : []
  const [selectedAgentId, setSelectedAgentId] = useState('')
  useEffect(() => {
    if (selectedAgentId && !candidates.some(({ projectAvailability }) => (
      projectAvailability.agentId === selectedAgentId
    ))) {
      setSelectedAgentId('')
    }
  }, [candidates, selectedAgentId])
  const feedback = project?.coordinatorTransferFeedback
  return (
    <Section
      id="coordinator"
      title={t('projectCoordinatorTransferTitle')}
      icon={<ArrowRightLeft className="h-4 w-4" />}
    >
      {!project ? <Empty /> : (
        <div className="space-y-2">
          <div className="rounded border border-ds-border bg-ds-bg p-2 text-[11px]">
            <div className="text-ds-muted">{t('projectCoordinatorCurrentAuthority')}</div>
            <div className="break-all font-mono">{project.project.coordinatorAgentId}</div>
            <div className="text-ds-muted">
              {t('projectCoordinatorAuthorityEpoch')}: {project.project.coordinatorAuthorityEpoch}
            </div>
          </div>
          {feedback ? (
            <div
              className="rounded border border-amber-500/40 p-2 text-[11px]"
              data-default-visible-card="coordinator-transfer-fence"
            >
              <div className="font-medium">
                {t(feedback.disposition === 'authority_transferred_out'
                  ? 'projectCoordinatorAuthorityTransferredOut'
                  : 'projectCoordinatorAuthorityTransferredIn')}
              </div>
              <div className="mt-1 break-all font-mono text-ds-muted">
                {feedback.previousCoordinatorAgentId} → {feedback.coordinatorAgentId}
              </div>
              <div className="text-ds-muted">
                {t('projectCoordinatorAuthorityEpoch')}: {feedback.coordinatorAuthorityEpoch}
              </div>
            </div>
          ) : null}
          {canTransfer ? candidates.length === 0 ? (
            <p className="text-[11px] text-ds-muted">
              {t('projectCoordinatorNoEligibleOwnerAgent')}
            </p>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!selectedAgentId) return
                onTransfer({
                  projectId: project.project.projectId,
                  coordinatorAgentId: selectedAgentId
                })
              }}
            >
              <select
                required
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.currentTarget.value)}
                aria-label={t('projectCoordinatorSuccessorAgent')}
                className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
              >
                <option value="">{t('projectCoordinatorChooseOwnerAgent')}</option>
                {candidates.map(({ displayName, projectAvailability }) => (
                  <option
                    key={projectAvailability.agentId}
                    value={projectAvailability.agentId}
                  >
                    {displayName} · {projectAvailability.agentId}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy || !selectedAgentId}
                className="rounded border border-amber-500/50 px-2 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorTransferAction')}
              </button>
            </form>
          ) : (
            <p className="text-[11px] text-ds-muted">
              {t('projectCoordinatorOwnerOnlyTransfer')}
            </p>
          )}
        </div>
      )}
    </Section>
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
  onEditDraft(content: Pick<
    ProjectCoordinatorPlanDraftEditInput,
    'tasks' | 'rationale' | 'assignments'
  >): void
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
        <div className="space-y-2" data-default-visible-card="plan-draft" key={draft.draftRevision}>
          <Status value="draft" />
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              const values = new FormData(event.currentTarget)
              onEditDraft({
                rationale: String(values.get('plan-rationale') ?? ''),
                tasks: draft.tasks.map((item) => ({
                  ...item,
                  title: String(values.get(`plan-item-title-${item.planItemId}`) ?? ''),
                  objective: String(values.get(`plan-item-objective-${item.planItemId}`) ?? ''),
                  completionCriteria: splitLines(
                    String(values.get(`plan-item-criteria-${item.planItemId}`) ?? '')
                  ),
                  requiredCapabilityTags: splitCommaSeparated(
                    String(values.get(`plan-item-capabilities-${item.planItemId}`) ?? '')
                  )
                })),
                assignments: draft.assignments.map((assignment) => {
                  const selectedAgentId = String(
                    values.get(`plan-item-agent-${assignment.planItemId}`) ?? ''
                  )
                  return {
                    ...assignment,
                    selectedAgentId: selectedAgentId || null,
                    recommendationReason: selectedAgentId
                      ? t('projectCoordinatorOwnerSelectedExactAgent')
                      : null
                  }
                })
              })
            }}
          >
            <label className="block text-xs">
              <span className="text-ds-muted">{t('projectCoordinatorPlanRationale')}</span>
              <textarea
                required
                name="plan-rationale"
                defaultValue={draft.rationale}
                className="mt-1 w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
              />
            </label>
            {draft.tasks.map((item) => {
              const assignment = draft.assignments.find(({ planItemId }) => (
                planItemId === item.planItemId
              ))
              return (
              <fieldset key={item.planItemId} className="block space-y-1.5 rounded border border-ds-border p-2 text-xs">
                <legend className="px-1 font-mono text-[10px] text-ds-faint">{item.planItemId}</legend>
                <input required name={`plan-item-title-${item.planItemId}`} defaultValue={item.title} aria-label={t('projectCoordinatorTaskTitle')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                <textarea required name={`plan-item-objective-${item.planItemId}`} defaultValue={item.objective} aria-label={t('projectCoordinatorTaskObjective')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                <textarea required name={`plan-item-criteria-${item.planItemId}`} defaultValue={item.completionCriteria.join('\n')} aria-label={t('projectCoordinatorCompletionCriteria')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                <input required name={`plan-item-capabilities-${item.planItemId}`} defaultValue={item.requiredCapabilityTags.join(', ')} aria-label={t('projectCoordinatorCapabilityTags')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                <select
                  name={`plan-item-agent-${item.planItemId}`}
                  className="mt-1 w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                  defaultValue={assignment?.selectedAgentId ?? ''}
                  disabled={busy}
                >
                  <option value="">{t('projectCoordinatorChooseExactAgent')}</option>
                  {visibleAgents.map((agent) => (
                    <option key={agent.projectAvailability.agentId} value={agent.projectAvailability.agentId}>
                      {agent.displayName} · {agent.projectAvailability.agentId}
                    </option>
                  ))}
                </select>
              </fieldset>
              )
            })}
            <button type="submit" disabled={busy} className="rounded border border-ds-border px-2 py-1.5 text-xs disabled:opacity-50">
              {t('projectCoordinatorSavePlanEdits')}
            </button>
          </form>
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

export function WorkersSection({
  project
}: Readonly<{ project?: ProjectCoordinatorProject }>): ReactElement {
  const { t } = useTranslation('common')
  const presence = project ? projectCoordinatorWorkerPresenceSummary(project) : undefined
  return (
    <Section id="workers" title={t('projectCoordinatorWorkers')} icon={<UsersRound className="h-4 w-4" />}>
      {!project?.workerGroups.length ? (
        <Empty message={project ? t('projectCoordinatorNoWorkers') : undefined} />
      ) : (
        <>
          <div
            className="mb-2 rounded border border-ds-border bg-ds-bg p-2 text-xs"
            data-project-online-users={presence?.onlineUsers}
            data-project-visible-users={presence?.visibleUsers}
            data-project-online-agents={presence?.onlineAgents}
            data-project-visible-agents={presence?.visibleAgents}
          >
            <div className="font-medium">
              {t('projectCoordinatorOnlineMembers', {
                online: presence?.onlineUsers,
                total: presence?.visibleUsers
              })}
            </div>
            <div className="mt-0.5 text-[10px] text-ds-muted">
              {t('projectCoordinatorOnlineAgents', {
                online: presence?.onlineAgents,
                total: presence?.visibleAgents
              })}
            </div>
          </div>
          {project.workerGroups.map((group) => (
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
        </>
      )}
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

export function ProjectCoordinatorDecisionSection({
  project,
  canAnswer,
  busy,
  onCreateHumanNeeded,
  onAnswerHumanNeeded,
  onOpenArtifact,
  onReviewResult,
  onComplete
}: Readonly<{
  project?: ProjectCoordinatorProject
  canAnswer: boolean
  busy: boolean
  onCreateHumanNeeded(input: ProjectCoordinatorHumanNeededCreateInput): void
  onAnswerHumanNeeded(input: ProjectCoordinatorHumanAnswerInput): void
  onOpenArtifact?: (input: ProjectCoordinatorArtifactReviewPrepareInput) => void
  onReviewResult(input: ProjectCoordinatorResultReviewInput): void
  onComplete(input: ProjectCoordinatorCompleteInput): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const pendingReviews = project?.reviews.filter(({ decision }) => decision === null) ?? []
  const acceptedCurrentResults = project ? acceptedCurrentResultIds(project) : null
  const mayAskOwner = project?.project.status === 'active' &&
    acceptedCurrentResults !== null &&
    !project.records.some(({ kind }) => kind === 'decision') &&
    project.pendingHumanNeeded.length === 0
  const completionInput = project ? projectCoordinatorCompletionInput(project, '') : null
  return (
    <Section id="reviews" title={t('projectCoordinatorReviews')} icon={<ClipboardCheck className="h-4 w-4" />}>
      {!project ? <Empty /> : (
        <div className="space-y-2 text-xs">
          {project.pendingHumanNeeded.map((request) => (
            <form
              key={request.humanRequestId}
              className="space-y-2 rounded border border-amber-500/40 p-2"
              data-default-visible-card="human-needed"
              onSubmit={(event) => {
                event.preventDefault()
                const values = new FormData(event.currentTarget)
                const decision = String(values.get('decision') ?? '')
                onAnswerHumanNeeded({
                  projectId: request.projectId,
                  humanRequestId: request.humanRequestId,
                  requestRevision: request.revision,
                  answer: String(values.get('answer') ?? ''),
                  ...(decision === 'approve' || decision === 'reject' ? { decision } : {})
                })
              }}
            >
              <Status value="human_needed" />
              <p className="whitespace-pre-wrap text-[11px] text-ds-muted">{request.prompt}</p>
              <textarea required name="answer" disabled={!canAnswer || busy} aria-label={t('projectCoordinatorHumanAnswer')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
              {request.confirmableAction ? (
                <div className="flex gap-2">
                  <button name="decision" value="approve" type="submit" disabled={!canAnswer || busy} className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50">{t('projectCoordinatorApprove')}</button>
                  <button name="decision" value="reject" type="submit" disabled={!canAnswer || busy} className="rounded border border-ds-border px-2 py-1 disabled:opacity-50">{t('projectCoordinatorReject')}</button>
                </div>
              ) : (
                <button type="submit" disabled={!canAnswer || busy} className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50">{t('projectCoordinatorSubmitHumanAnswer')}</button>
              )}
            </form>
          ))}
          {pendingReviews.map((review) => (
            <form
              key={review.submission.resultSubmissionId}
              className="space-y-2 rounded border border-amber-500/40 p-2"
              data-default-visible-card="result-review"
              onSubmit={(event) => {
                event.preventDefault()
                const values = new FormData(event.currentTarget)
                const decision = String(values.get('decision') ?? '')
                const selectedAgentId = String(values.get('next-agent') ?? '')
                const input = projectCoordinatorResultReviewInput(
                  project,
                  review.submission.resultSubmissionId,
                  decision === 'accept' ? 'accept' : 'request_revision',
                  {
                    instruction: String(values.get('instruction') ?? ''),
                    nextAssigneeAgentId: selectedAgentId,
                    nextOfferExpiresAt: String(values.get('offer-expires-at') ?? ''),
                    nextOutputFileName: String(values.get('next-output-file-name') ?? '')
                  }
                )
                if (input) onReviewResult(input)
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="break-all font-mono text-[10px]">{review.submission.taskId}</span>
                <Status value="awaiting_review" />
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-ds-muted">
                {review.submission.summary}
              </p>
              {review.submission.outputs.length > 0 ? (
                <div className="space-y-1" data-artifact-review-list="true">
                  {review.submission.outputs.map((output, outputIndex) => (
                    <button
                      key={`${output.locatorDigest}:${outputIndex}`}
                      type="button"
                      disabled={busy || !onOpenArtifact}
                      data-artifact-review-output={outputIndex}
                      className="flex w-full items-center justify-between gap-2 rounded border border-ds-border px-2 py-1.5 text-left disabled:opacity-50"
                      onClick={() => onOpenArtifact?.({
                        projectId: review.submission.projectId,
                        taskId: review.submission.taskId,
                        executionId: review.submission.executionId,
                        resultSubmissionId: review.submission.resultSubmissionId,
                        submissionDigest: review.submission.submissionDigest,
                        outputIndex,
                        locatorDigest: output.locatorDigest
                      })}
                    >
                      <span>{t('projectCoordinatorOpenArtifactInContentSpace')}</span>
                      <span className="max-w-[11rem] truncate font-mono text-[10px] text-ds-faint">
                        {output.locatorDigest}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea name="instruction" aria-label={t('projectCoordinatorRevisionInstruction')} placeholder={t('projectCoordinatorRevisionInstruction')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
              <select name="next-agent" defaultValue="" aria-label={t('projectCoordinatorNextAgent')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs">
                <option value="">{t('projectCoordinatorChooseExactAgent')}</option>
                {project.workerGroups.flatMap(({ agents }) => agents).map((agent) => (
                  <option key={agent.projectAvailability.agentId} value={agent.projectAvailability.agentId}>
                    {agent.displayName} · {agent.projectAvailability.agentId}
                  </option>
                ))}
              </select>
              <input name="offer-expires-at" aria-label={t('projectCoordinatorOfferExpiresAt')} placeholder="2026-08-26T01:08:00.000Z" className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
              {project.tasks.find(({ task }) => (
                task.taskId === review.submission.taskId
              ))?.task.fileIntent ? (
                <input
                  name="next-output-file-name"
                  aria-label={t('projectCoordinatorNextOutputFileName')}
                  placeholder={t('projectCoordinatorNextOutputFileName')}
                  className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                />
              ) : null}
              <div className="flex gap-2">
                <button name="decision" value="accept" type="submit" disabled={busy} className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50">{t('projectCoordinatorAcceptResult')}</button>
                <button name="decision" value="request_revision" type="submit" disabled={busy} className="rounded border border-ds-border px-2 py-1 disabled:opacity-50">{t('projectCoordinatorRequestRevision')}</button>
              </div>
            </form>
          ))}
          {mayAskOwner ? (
            <form
              className="space-y-2 rounded border border-ds-border p-2"
              data-default-visible-card="human-needed-create"
              onSubmit={(event) => {
                event.preventDefault()
                const values = new FormData(event.currentTarget)
                onCreateHumanNeeded({
                  projectId: project.project.projectId,
                  expectedProjectRevision: project.project.revision,
                  expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
                  requiredAssurance: 'verified',
                  prompt: String(values.get('prompt') ?? ''),
                  expiresAt: String(values.get('expires-at') ?? '')
                })
              }}
            >
              <textarea required name="prompt" aria-label={t('projectCoordinatorHumanPrompt')} placeholder={t('projectCoordinatorHumanPrompt')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
              <input required name="expires-at" aria-label={t('projectCoordinatorHumanExpiresAt')} placeholder="2026-08-26T01:08:00.000Z" className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
              <button type="submit" disabled={busy} className="rounded border border-ds-border px-2 py-1 disabled:opacity-50">{t('projectCoordinatorAskOwner')}</button>
            </form>
          ) : null}
          {completionInput ? (
            <form
              className="space-y-2 rounded border border-emerald-500/40 p-2"
              data-default-visible-card="project-completion"
              onSubmit={(event) => {
                event.preventDefault()
                const summary = String(new FormData(event.currentTarget).get('summary') ?? '')
                const input = projectCoordinatorCompletionInput(project, summary)
                if (input) onComplete(input)
              }}
            >
              <textarea required name="summary" aria-label={t('projectCoordinatorFinalSummary')} placeholder={t('projectCoordinatorFinalSummary')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
              <button type="submit" disabled={busy} className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50">{t('projectCoordinatorCompleteProject')}</button>
            </form>
          ) : null}
          {project.finalSummary ? (
            <div className="rounded border border-ds-border p-2" data-default-visible-card="final-summary">
              <Status value="completed" />
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-ds-muted">{project.finalSummary.summary}</p>
            </div>
          ) : null}
          {project.pendingHumanNeeded.length === 0 && pendingReviews.length === 0 &&
            !mayAskOwner && !completionInput && !project.finalSummary ? (
              <Empty message={t('projectCoordinatorNoReviews')} />
            ) : null}
        </div>
      )}
    </Section>
  )
}

export function projectCoordinatorResultReviewInput(
  project: ProjectCoordinatorProject,
  resultSubmissionId: string,
  decision: 'accept' | 'request_revision',
  revision: Readonly<{
    instruction: string
    nextAssigneeAgentId: string
    nextOfferExpiresAt: string
    nextOutputFileName: string
  }>
): ProjectCoordinatorResultReviewInput | null {
  const review = project.reviews.find(({ submission }) => (
    submission.resultSubmissionId === resultSubmissionId
  ))
  if (!review || review.decision) return null
  const task = project.tasks.find(({ task }) => task.taskId === review.submission.taskId)
  const execution = task?.executions.find(({ executionId }) => (
    executionId === review.submission.executionId
  ))
  if (!task || !execution) return null
  const nextAgent = project.workerGroups.flatMap(({ agents }) => agents).find(
    ({ projectAvailability }) => (
      projectAvailability.agentId === revision.nextAssigneeAgentId
    )
  )
  const parsedOutputName = task.task.fileIntent
    ? taskFileDestinationNameSchema.safeParse(revision.nextOutputFileName)
    : null
  const nextFileIntent = task.task.fileIntent === null
    ? revision.nextOutputFileName.trim() === '' ? null : undefined
    : parsedOutputName?.success &&
        parsedOutputName.data !== task.task.fileIntent.output.fileName
      ? {
          ...task.task.fileIntent,
          output: {
            ...task.task.fileIntent.output,
            fileName: parsedOutputName.data
          }
        }
      : undefined
  const base = {
    projectId: project.project.projectId,
    taskId: task.task.taskId,
    executionId: execution.executionId,
    resultSubmissionId: review.submission.resultSubmissionId,
    expectedProjectRevision: project.project.revision,
    expectedTaskRevision: task.task.revision,
    expectedExecutionRevision: execution.revision,
    expectedResultRevision: review.submission.revision,
    expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch
  }
  return decision === 'accept' ? {
    ...base,
    decision,
    instruction: null,
    nextAssigneeAgentId: null,
    expectedNextAssigneeAvailabilityRevision: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  } : revision.instruction.trim() && nextAgent && revision.nextOfferExpiresAt &&
      nextFileIntent !== undefined ? {
        ...base,
        decision,
        instruction: revision.instruction,
        nextAssigneeAgentId: revision.nextAssigneeAgentId,
        expectedNextAssigneeAvailabilityRevision:
          nextAgent.projectAvailability.availability.revision,
        nextOfferExpiresAt: revision.nextOfferExpiresAt,
        nextFileIntent
      } : null
}

export function projectCoordinatorCompletionInput(
  project: ProjectCoordinatorProject,
  summary: string
): ProjectCoordinatorCompleteInput | null {
  if (
    project.project.status !== 'active' ||
    project.finalSummary !== null ||
    project.plan?.plan.state !== 'confirmed' ||
    !project.records.some(({ kind }) => kind === 'decision') ||
    project.tasks.length === 0
  ) return null
  const acceptedResultSubmissionIds = acceptedCurrentResultIds(project)
  if (acceptedResultSubmissionIds === null) return null
  return {
    projectId: project.project.projectId,
    expectedProjectRevision: project.project.revision,
    expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
    projectPlanId: project.plan.plan.projectPlanId,
    confirmedPlanRevision: project.plan.plan.revision,
    acceptedResultSubmissionIds,
    summary: summary || project.project.goal
  }
}

function acceptedCurrentResultIds(project: ProjectCoordinatorProject): string[] | null {
  if (project.tasks.length === 0) return null
  const resultSubmissionIds = project.tasks.map(({ task }) => (
    task.status === 'completed'
      ? project.reviews.find(({ submission, decision }) => (
          submission.taskId === task.taskId &&
          submission.executionId === task.currentExecutionId &&
          decision?.decision === 'accept'
        ))?.submission.resultSubmissionId
      : undefined
  ))
  return resultSubmissionIds.some((id) => id === undefined)
    ? null
    : resultSubmissionIds as string[]
}

export function ProjectCoordinatorProvisioningSection({
  project,
  plan,
  canManage = true,
  busy,
  onPreview,
  onApply,
  onAddMember,
  onRemoveMember,
  onObserveAndLinkRecovery,
  onAbandonRecovery,
  onRetryRecoverySuccessor
}: Readonly<{
  project?: ProjectCoordinatorProject
  plan: ProjectCoordinatorProvisioningPlan | null
  canManage?: boolean
  busy: boolean
  onPreview(): void
  onApply(plan: ProjectCoordinatorProvisioningPlan): void
  onAddMember(input: ProjectCoordinatorMembershipAddInput): void
  onRemoveMember(input: ProjectCoordinatorMembershipRemoveInput): void
  onObserveAndLinkRecovery(input: ProjectCoordinatorContentRecoveryObserveLinkInput): void
  onAbandonRecovery(input: ProjectCoordinatorContentRecoveryAbandonInput): void
  onRetryRecoverySuccessor(input: ProjectCoordinatorContentRecoveryRetrySuccessorInput): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const [selectedProviderFactId, setSelectedProviderFactId] = useState('')
  const [contentFreeUserId, setContentFreeUserId] = useState('')
  const [recoveryAbandonReason, setRecoveryAbandonReason] = useState('')
  const provisioning = project?.provisioning
  const memberships = provisioning?.memberships ?? []
  const existingUserIds = new Set(
    memberships.filter(({ state }) => state !== 'removed').map(({ userId }) => userId)
  )
  const eligibleProviderFacts = (provisioning?.providerPrincipalFacts ?? []).filter((fact) => (
    fact.readiness === 'ready' && !existingUserIds.has(fact.userId)
  ))
  const selectedProviderFact = eligibleProviderFacts.find(({ providerPrincipalFactId }) => (
    providerPrincipalFactId === selectedProviderFactId
  )) ?? eligibleProviderFacts[0]
  const provisioningState = provisioning?.binding?.status ?? provisioning?.intent?.state
  const recoveryAction = provisioning?.recoveryActions.find(({ status }) => (
    status === 'available'
  ))
  const taskRecoveryAction = recoveryAction?.taskId && recoveryAction.executionId &&
    (recoveryAction.action === 'link_observed_output' ||
      recoveryAction.action === 'abandon_execution')
    ? recoveryAction
    : undefined
  const abandonedRecoveryAction = provisioning?.recoveryActions.find((candidate) => {
    if (candidate.status !== 'completed' || candidate.audience !== 'coordinator' ||
      candidate.taskId === null || candidate.executionId === null) return false
    const taskView = project?.tasks.find(({ task }) => task.taskId === candidate.taskId)
    const execution = taskView?.executions.find(({ executionId }) => (
      executionId === candidate.executionId
    ))
    return taskView?.task.currentExecutionId === candidate.executionId &&
      taskView.task.status === 'revision_requested' &&
      taskView.task.fileIntent !== null &&
      execution?.state === 'cancelled' &&
      execution.fence.reason === 'manual_recovery_abandoned'
  })
  const abandonedTask = abandonedRecoveryAction?.taskId
    ? project?.tasks.find(({ task }) => task.taskId === abandonedRecoveryAction.taskId)
    : undefined
  const rootLost = provisioning?.binding?.status === 'degraded'

  const addExactMember = () => {
    if (!project) return
    if (project.project.contentMode === 'required') {
      if (!selectedProviderFact) return
      onAddMember({
        projectId: project.project.projectId,
        expectedProjectRevision: project.project.revision,
        userId: selectedProviderFact.userId,
        providerPrincipalFactId: selectedProviderFact.providerPrincipalFactId,
        expectedProviderPrincipalFactRevision: selectedProviderFact.revision
      })
      return
    }
    const userId = contentFreeUserId.trim()
    if (!userId) return
    onAddMember({
      projectId: project.project.projectId,
      expectedProjectRevision: project.project.revision,
      userId,
      providerPrincipalFactId: null,
      expectedProviderPrincipalFactRevision: null
    })
  }

  return (
    <Section id="provisioning" title={t('projectCoordinatorProvisioning')} icon={<Warehouse className="h-4 w-4" />}>
      {!project || !provisioning ? <Empty /> : (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <Status value={provisioningState ?? 'unbound'} />
            <span className="text-[10px] text-ds-muted">
              {t('projectCoordinatorRevision')}{' '}
              {provisioning.binding?.provisioningRevision ?? provisioning.intent?.provisioningRevision ?? '—'}
            </span>
          </div>

          {rootLost || recoveryAction ? (
            <div
              className="space-y-2 rounded border border-amber-500/40 bg-ds-bg p-2"
              data-default-visible-card="content-recovery"
              {...(taskRecoveryAction
                ? { 'data-task-recovery-action': taskRecoveryAction.recoveryActionId }
                : {})}
            >
              <div className="font-medium">{t('projectCoordinatorContentRecovery')}</div>
              {provisioning.binding?.statusReason ? (
                <code className="block break-all text-[10px]" data-binding-status-reason={provisioning.binding.statusReason}>
                  {provisioning.binding.statusReason}
                </code>
              ) : null}
              {recoveryAction ? (
                <p className="text-[11px] text-ds-muted">
                  {t('projectCoordinatorProvisioningNext')}: {recoveryAction.safeSummary}
                </p>
              ) : null}
              {canManage && taskRecoveryAction ? (
                <div className="space-y-2">
                  {taskRecoveryAction.action === 'link_observed_output' &&
                    taskRecoveryAction.requiresFreshObservation ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onObserveAndLinkRecovery({
                          projectId: project.project.projectId,
                          recoveryActionId: taskRecoveryAction.recoveryActionId
                        })}
                        className="rounded bg-ds-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        {busy
                          ? t('projectCoordinatorWorking')
                          : t('projectCoordinatorObserveAndLinkOutput')}
                      </button>
                    ) : null}
                  <input
                    value={recoveryAbandonReason}
                    onChange={(event) => setRecoveryAbandonReason(event.target.value)}
                    placeholder={t('projectCoordinatorAbandonReason')}
                    aria-label={t('projectCoordinatorAbandonReason')}
                    className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 text-[10px]"
                  />
                  <button
                    type="button"
                    disabled={busy || !recoveryAbandonReason.trim()}
                    onClick={() => onAbandonRecovery({
                      projectId: project.project.projectId,
                      recoveryActionId: taskRecoveryAction.recoveryActionId,
                      reason: recoveryAbandonReason.trim()
                    })}
                    className="rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-600 disabled:opacity-50"
                  >
                    {busy
                      ? t('projectCoordinatorWorking')
                      : t('projectCoordinatorAbandonExecution')}
                  </button>
                </div>
              ) : canManage && project.project.contentMode === 'required' && provisioning.intent ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onPreview}
                  className="rounded border border-ds-border px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorPreviewReconcile')}
                </button>
              ) : null}
            </div>
          ) : null}

          {abandonedRecoveryAction && abandonedTask?.task.fileIntent ? (
            <div
              className="space-y-2 rounded border border-amber-500/40 bg-ds-bg p-2"
              data-default-visible-card="content-recovery-successor"
              data-recovery-action-id={abandonedRecoveryAction.recoveryActionId}
            >
              <div className="font-medium">
                {t('projectCoordinatorRecoverySuccessor')}
              </div>
              <p className="text-[11px] text-ds-muted">
                {t('projectCoordinatorRecoverySuccessorSummary')}
              </p>
              <code className="block break-all text-[10px]">
                {abandonedTask.task.fileIntent.output.fileName}
              </code>
              {canManage ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const values = new FormData(event.currentTarget)
                    onRetryRecoverySuccessor({
                      projectId: project!.project.projectId,
                      recoveryActionId: abandonedRecoveryAction.recoveryActionId,
                      assigneeAgentId: String(values.get('successor-agent') ?? ''),
                      nextOutputFileName: String(
                        values.get('next-output-file-name') ?? ''
                      ),
                      offerExpiresAt: String(values.get('successor-offer-expires-at') ?? '')
                    })
                  }}
                >
                  <select
                    required
                    name="successor-agent"
                    defaultValue=""
                    aria-label={t('projectCoordinatorNextAgent')}
                    className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 text-[10px]"
                  >
                    <option value="">{t('projectCoordinatorChooseExactAgent')}</option>
                    {project!.workerGroups.flatMap(({ agents }) => agents).map((agent) => (
                      <option
                        key={agent.projectAvailability.agentId}
                        value={agent.projectAvailability.agentId}
                      >
                        {agent.displayName} · {agent.projectAvailability.agentId}
                      </option>
                    ))}
                  </select>
                  <input
                    required
                    name="next-output-file-name"
                    aria-label={t('projectCoordinatorNextOutputFileName')}
                    placeholder={t('projectCoordinatorNextOutputFileName')}
                    className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 text-[10px]"
                  />
                  <input
                    required
                    name="successor-offer-expires-at"
                    aria-label={t('projectCoordinatorOfferExpiresAt')}
                    placeholder="2026-08-27T01:08:00.000Z"
                    className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 text-[10px]"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-ds-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {busy
                      ? t('projectCoordinatorWorking')
                      : t('projectCoordinatorApproveRecoveryRetry')}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {canManage && project.project.contentMode === 'required' && provisioning.intent && !plan ? (
            <div
              className="space-y-2 rounded border border-ds-border bg-ds-bg p-2"
              data-default-visible-card="content-provisioning"
            >
              <p className="text-[11px] text-ds-muted">
                {t('projectCoordinatorProvisioningReviewRequired')}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={onPreview}
                className="rounded bg-ds-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorPreviewProvisioning')}
              </button>
            </div>
          ) : null}

          {plan ? (
            <div
              className="space-y-2 rounded border border-ds-border bg-ds-bg p-2"
              data-default-visible-card="content-provisioning-confirmation"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t('projectCoordinatorProvisioningFullPlan')}</span>
                <Status value={plan.rootStrategy} />
              </div>
              <ol className="space-y-1">
                {plan.operations.map((operation, index) => (
                  <li
                    key={operation.operationId}
                    className="rounded border border-ds-border px-2 py-1 text-[10px]"
                    data-provisioning-operation={operation.operationId}
                  >
                    <span>{index + 1}. </span>
                    <code>{operation.actionId}</code>
                    <span> · {operation.kind}</span>
                    {operation.userId ? <span> · <code>{operation.userId}</code></span> : null}
                  </li>
                ))}
              </ol>
              <div className="break-all font-mono text-[9px] text-ds-muted">
                {t('projectCoordinatorConfirmedPlanDigest')}: {plan.confirmedPlanDigest}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onApply(plan)}
                className="rounded bg-ds-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorApplyProvisioning')}
              </button>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="font-medium">{t('projectCoordinatorProjectMembers')}</div>
            {memberships.length === 0 ? <Empty /> : memberships.map((membership) => {
              const readiness = provisioning.contentReadiness.find(({ userId }) => (
                userId === membership.userId
              ))
              const authoritySuspended = membership.state === 'pending_membership' ||
                membership.state === 'membership_removal_pending'
              return (
                <div
                  key={membership.projectMembershipId}
                  className="space-y-1 rounded bg-ds-bg px-2 py-1.5 text-[10px]"
                  data-membership-state={membership.state}
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="break-all">{membership.userId}</code>
                    <Status value={membership.state} />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-ds-muted">
                    <span>{readiness?.state ?? 'not_applicable'}</span>
                    {authoritySuspended ? (
                      <span>{t('projectCoordinatorTaskAuthoritySuspended')}</span>
                    ) : null}
                  </div>
                  {canManage && membership.userId !== project.project.ownerUserId &&
                    membership.state === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemoveMember({
                          projectId: project.project.projectId,
                          projectMembershipId: membership.projectMembershipId,
                          expectedProjectRevision: project.project.revision,
                          expectedMembershipRevision: membership.revision
                        })}
                        className="rounded border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-600 disabled:opacity-50"
                      >
                        {t('projectCoordinatorRemoveMember')}
                      </button>
                    ) : null}
                </div>
              )
            })}
          </div>

          {canManage ? (
            <div className="space-y-2 rounded border border-ds-border bg-ds-bg p-2">
              <div className="font-medium">{t('projectCoordinatorAddMember')}</div>
              {project.project.contentMode === 'required' ? (
                eligibleProviderFacts.length === 0 ? (
                  <p className="text-[10px] text-ds-muted">
                    {t('projectCoordinatorNoReadyProviderPrincipal')}
                  </p>
                ) : (
                  <select
                    value={selectedProviderFact?.providerPrincipalFactId ?? ''}
                    onChange={(event) => setSelectedProviderFactId(event.currentTarget.value)}
                    className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 text-[10px]"
                    aria-label={t('projectCoordinatorProviderPrincipal')}
                  >
                    {eligibleProviderFacts.map((fact) => (
                      <option key={fact.providerPrincipalFactId} value={fact.providerPrincipalFactId}>
                        {fact.userId} · rev {fact.revision}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <input
                  value={contentFreeUserId}
                  onChange={(event) => setContentFreeUserId(event.currentTarget.value)}
                  placeholder={t('projectCoordinatorExactUserId')}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 text-[10px]"
                />
              )}
              <button
                type="button"
                disabled={busy || (project.project.contentMode === 'required'
                  ? !selectedProviderFact
                  : contentFreeUserId.trim().length === 0)}
                onClick={addExactMember}
                className="rounded border border-ds-border px-2 py-1 text-[11px] disabled:opacity-50"
              >
                {t('projectCoordinatorAddMember')}
              </button>
              <div className="font-medium">{t('projectCoordinatorRemoveMember')}</div>
            </div>
          ) : null}
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

function splitLines(value: string): string[] {
  return value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)
}

function splitCommaSeparated(value: string): string[] {
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
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
