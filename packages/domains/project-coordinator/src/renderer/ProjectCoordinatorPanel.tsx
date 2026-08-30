import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  Bot,
  Check,
  CircleDashed,
  ClipboardCheck,
  Cloud,
  FileCheck2,
  FolderOpen,
  FileText,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  SquareKanban,
  UserRound,
  UserRoundCheck,
  UsersRound,
  Warehouse,
  Workflow,
  Zap,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  canonicalTaskIdForPlanItem,
  DEFAULT_TASK_OFFER_TTL_MS,
  taskFileDestinationNameSchema
} from '@sciforge/collaboration-contracts'
import type {
  DomainRendererVisibleContextHost,
  DomainWorkbenchRightPanelSession
} from '@sciforge/domain-sdk/host'

import type {
  ProjectCoordinatorCompleteInput,
  ProjectCoordinatorArtifactReviewPrepareInput,
  ProjectCoordinatorActivationView,
  ProjectCoordinatorContentRecoveryAbandonInput,
  ProjectCoordinatorContentRecoveryObserveLinkInput,
  ProjectCoordinatorHumanAnswerInput,
  ProjectCoordinatorHumanNeededCreateInput,
  ProjectCoordinatorMembershipAddInput,
  ProjectCoordinatorMembershipAcceptInput,
  ProjectCoordinatorMembershipRemoveInput,
  ProjectCoordinatorPlanDraft,
  ProjectCoordinatorPlanDraftEditInput,
  ProjectCoordinatorProjectCreateResult,
  ProjectCoordinatorProject,
  ProjectCoordinatorSessionBinding,
  ProjectCoordinatorSessionProjection,
  ProjectCoordinatorWorkflowPlan,
  ProjectCoordinatorResultReviewInput,
  ProjectCoordinatorTaskOfferReassignInput,
  ProjectCoordinatorWorkspace
} from '../contract.js'
import {
  projectCoordinatorPlanningRuntimeReadiness,
  projectCoordinatorPlanningTaskReadiness,
  projectCoordinatorTaskRequirementReadiness
} from '../plan-readiness.js'
import {
  ProjectCoordinatorPlanDraftGenerationClientError,
  type ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import type { ProjectCoordinatorWorkspaceSection } from './workspace-sections.js'
import { projectCoordinatorSessionBindingForOrdinarySession } from './session-binding.js'
import {
  clearProjectCoordinatorPanelContext,
  currentProjectCoordinatorPanelContext,
  setProjectCoordinatorPanelContext
} from './panel-context.js'

export const PROJECT_COORDINATOR_PANEL_SECTION_IDS = Object.freeze([
  'coordinator',
  'plan',
  'workers',
  'tasks',
  'reviews',
  'provisioning'
] as const)

export const PROJECT_COORDINATOR_LIVE_REFRESH_INTERVAL_MS = 15_000

function projectCoordinatorPlanGenerationFailureMessageKey(
  reason: ProjectCoordinatorPlanDraftGenerationClientError['reason']
): string {
  switch (reason) {
    case 'planning_candidates_unavailable':
      return 'projectCoordinatorPlanCandidatesUnavailable'
    case 'runtime_unavailable':
      return 'projectCoordinatorPlanRuntimeUnavailable'
    case 'runtime_execution_failed':
      return 'projectCoordinatorPlanRuntimeExecutionFailed'
    case 'invalid_structured_output':
      return 'projectCoordinatorPlanInvalidStructuredOutput'
  }
}

export const PROJECT_COORDINATOR_BUILT_IN_WORKSPACE_VIEWS = Object.freeze([
  'overview',
  'projects',
  'reviews'
] as const)

export type ProjectCoordinatorBuiltInWorkspaceView =
  typeof PROJECT_COORDINATOR_BUILT_IN_WORKSPACE_VIEWS[number]

export type ProjectCoordinatorWorkspaceNavigationItem = Readonly<{
  id: string
  label: string
  description: string
  icon: React.ElementType
  order: number
  source: 'built-in' | 'extension'
}>

type ProjectCoordinatorWorkerAgent =
  ProjectCoordinatorProject['workerGroups'][number]['agents'][number]

export type ProjectCoordinatorFlowStageId =
  | 'plan'
  | 'dispatch'
  | 'execute'
  | 'review'
  | 'record'
  | 'complete'

export type ProjectCoordinatorFlowStageState =
  | 'complete'
  | 'active'
  | 'attention'
  | 'pending'

export type ProjectCoordinatorFlowStage = Readonly<{
  id: ProjectCoordinatorFlowStageId
  state: ProjectCoordinatorFlowStageState
  count: number | null
}>

export type ProjectCoordinatorAttentionSummary = Readonly<{
  planConfirmation: number
  humanAnswers: number
  resultReviews: number
  recoveryActions: number
  revisionTasks: number
  total: number
}>

type ProjectCoordinatorEffectiveSessionAccess = 'coordinator' | 'worker' | 'read_only'

export type ProjectCoordinatorAgentOperationalState = Readonly<{
  state: 'ready' | 'busy' | 'blocked' | 'offline'
  online: boolean
  fresh: boolean
  runtimeReady: boolean
  acceptsNewOffers: boolean
  projectMember: boolean
  textAuthority: boolean
  fileAuthority: boolean
  contentReady: boolean | null
}>

export type ProjectCoordinatorMeetingPackageSummary = Readonly<{
  acceptedResults: number
  observations: number
  decisions: number
  artifactRefs: readonly string[]
}>

/**
 * Produces one UI projection from the existing orthogonal Cloud facts. It never
 * turns presence into authority: online, Runtime readiness, offer intake,
 * Membership, Task Authority, and Content readiness remain individually visible.
 */
export function projectCoordinatorAgentOperationalState(
  agent: ProjectCoordinatorWorkerAgent,
  observedAt = agent.projectAvailability.observedAt
): ProjectCoordinatorAgentOperationalState {
  const view = agent.projectAvailability
  const availability = view.availability
  const fresh = Date.parse(availability.expiresAt) > Date.parse(observedAt)
  const online = fresh && availability.connectionStatus === 'online'
  const projectMember = view.membership?.state === 'active'
  const textAuthority = view.taskAuthorities?.some(({ scope, state }) => (
    scope === 'text_tasks' && state === 'eligible'
  )) ?? false
  const fileAuthority = view.taskAuthorities?.some(({ scope, state }) => (
    scope === 'file_tasks' && state === 'eligible'
  )) ?? false
  const contentReady = view.contentReadiness == null
    ? null
    : view.contentReadiness.state === 'ready'
  const runtimeReady = availability.runtimeReadiness === 'ready'
  const active = availability.agentActive && availability.deviceActive
  const projectEligible = projectMember && (textAuthority || fileAuthority)
  const state = !online
    ? 'offline'
    : !active || !runtimeReady || !projectEligible
      ? 'blocked'
      : !availability.acceptsNewOffers
        ? 'busy'
        : 'ready'
  return Object.freeze({
    state,
    online,
    fresh,
    runtimeReady,
    acceptsNewOffers: availability.acceptsNewOffers,
    projectMember,
    textAuthority,
    fileAuthority,
    contentReady
  })
}

export function projectCoordinatorCurrentSessionBinding(
  projection: ProjectCoordinatorSessionProjection,
  session: DomainWorkbenchRightPanelSession
): ProjectCoordinatorSessionBinding | null {
  return projectCoordinatorSessionBindingForOrdinarySession(
    projection,
    session.runtimeId,
    session.id
  )
}

export function projectCoordinatorEffectiveSessionAccess(
  project: ProjectCoordinatorProject,
  currentUserId: string | null,
  binding: ProjectCoordinatorSessionBinding | null
): ProjectCoordinatorEffectiveSessionAccess {
  if (
    currentUserId === null ||
    binding === null ||
    binding.projectId !== project.project.projectId ||
    binding.principalUserId !== currentUserId
  ) return 'read_only'
  return binding.access
}

export function projectCoordinatorAttentionSummary(
  project: ProjectCoordinatorProject,
  currentUserId: string | null,
  binding: ProjectCoordinatorSessionBinding | null
): ProjectCoordinatorAttentionSummary {
  const access = projectCoordinatorEffectiveSessionAccess(project, currentUserId, binding)
  const canCoordinate = access === 'coordinator'
  const planConfirmation = canCoordinate &&
    project.plan?.plan.state === 'awaiting_confirmation' ? 1 : 0
  const humanAnswers = access === 'read_only' ? 0 : project.pendingHumanNeeded.filter((request) => (
    request.targetUserId === currentUserId
  )).length
  const resultReviews = canCoordinate
    ? project.reviews.filter(({ decision }) => decision === null).length
    : 0
  const recoveryActions = canCoordinate
    ? project.provisioning.recoveryActions.filter(({ status }) => status === 'available').length
    : 0
  const revisionTasks = access === 'worker' && binding?.role === 'worker'
    ? project.tasks.filter(({ task }) => (
        task.taskId === binding.taskId &&
        (task.status === 'revision_requested' || task.status === 'manual_recovery_required')
      )).length
    : 0
  return Object.freeze({
    planConfirmation,
    humanAnswers,
    resultReviews,
    recoveryActions,
    revisionTasks,
    total: planConfirmation + humanAnswers + resultReviews + recoveryActions + revisionTasks
  })
}

export function projectCoordinatorMeetingPackageSummary(
  project: ProjectCoordinatorProject
): ProjectCoordinatorMeetingPackageSummary {
  const acceptedResultIds = new Set(
    project.finalSummary?.acceptedResultSubmissionIds ?? []
  )
  const artifactRefs = project.reviews
    .filter(({ submission }) => acceptedResultIds.has(submission.resultSubmissionId))
    .flatMap(({ submission }) => submission.outputs.map(({ locatorDigest }) => locatorDigest))
  return Object.freeze({
    acceptedResults: acceptedResultIds.size,
    observations: project.records.filter(({ kind }) => kind === 'observation').length,
    decisions: project.records.filter(({ kind }) => kind === 'decision').length,
    artifactRefs: Object.freeze(artifactRefs)
  })
}

/** Maps the canonical Project lifecycle onto the six user-facing workflow stages. */
export function projectCoordinatorFlowStages(
  project: ProjectCoordinatorProject
): readonly ProjectCoordinatorFlowStage[] {
  if (project.project.status === 'completed') {
    return Object.freeze(([
      ['plan', project.plan?.plan.tasks.length ?? null],
      ['dispatch', project.tasks.length],
      ['execute', project.tasks.length],
      ['review', project.reviews.length],
      ['record', project.records.length],
      ['complete', 1]
    ] as const).map(([id, count]) => Object.freeze({ id, count, state: 'complete' as const })))
  }

  const planState = project.plan?.plan.state
  const planComplete = planState === 'confirmed'
  const hasTasks = project.tasks.length > 0
  const dispatched = hasTasks && project.tasks.every(({ task }) => task.status !== 'planned')
  const executionAttention = project.tasks.some(({ task }) => (
    task.status === 'needs_human' ||
    task.status === 'revision_requested' ||
    task.status === 'manual_recovery_required' ||
    task.status === 'failed'
  ))
  const executionComplete = hasTasks && project.tasks.every(({ task }) => (
    task.status === 'awaiting_review' ||
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'cancelled'
  ))
  const pendingReviews = project.reviews.filter(({ decision }) => decision === null).length
  const awaitingReviewTasks = project.tasks.filter(({ task }) => (
    task.status === 'awaiting_review'
  )).length
  const reviewQueueCount = Math.max(pendingReviews, awaitingReviewTasks)
  const reviewComplete = hasTasks && project.tasks.every(({ task }) => (
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
  )) && pendingReviews === 0
  const hasSummaryRecord = project.records.some(({ kind }) => kind === 'summary')
  const recordReady = reviewComplete && project.records.length > 0

  const stages: ProjectCoordinatorFlowStage[] = [
    {
      id: 'plan',
      count: project.plan?.plan.tasks.length ?? null,
      state: planComplete
        ? 'complete'
        : planState === 'awaiting_confirmation'
          ? 'attention'
          : 'active'
    },
    {
      id: 'dispatch',
      count: project.tasks.length,
      state: dispatched ? 'complete' : planComplete ? 'active' : 'pending'
    },
    {
      id: 'execute',
      count: project.tasks.filter(({ task }) => (
        task.status === 'in_progress' || task.status === 'needs_human'
      )).length,
      state: executionAttention
        ? 'attention'
        : executionComplete
          ? 'complete'
          : dispatched
            ? 'active'
            : 'pending'
    },
    {
      id: 'review',
      count: reviewQueueCount,
      state: reviewComplete
        ? 'complete'
        : reviewQueueCount > 0
          ? 'attention'
          : executionComplete
            ? 'active'
            : 'pending'
    },
    {
      id: 'record',
      count: project.records.length,
      state: hasSummaryRecord ? 'complete' : recordReady ? 'active' : 'pending'
    },
    {
      id: 'complete',
      count: project.finalSummary ? 1 : 0,
      state: project.finalSummary || hasSummaryRecord ? 'active' : 'pending'
    }
  ]
  return Object.freeze(stages.map((stage) => Object.freeze(stage)))
}

export function projectCoordinatorWorkspaceNavigationItems(
  workspaceSections: readonly ProjectCoordinatorWorkspaceSection[]
): readonly ProjectCoordinatorWorkspaceNavigationItem[] {
  const items: ProjectCoordinatorWorkspaceNavigationItem[] = [
    {
      id: 'overview',
      label: 'projectCoordinatorCenterOverview',
      description: 'projectCoordinatorCenterOverviewDescription',
      icon: LayoutDashboard,
      order: 10,
      source: 'built-in'
    },
    {
      id: 'projects',
      label: 'projectCoordinatorCenterProjects',
      description: 'projectCoordinatorCenterProjectsDescription',
      icon: SquareKanban,
      order: 20,
      source: 'built-in'
    },
    {
      id: 'reviews',
      label: 'projectCoordinatorCenterReviews',
      description: 'projectCoordinatorCenterReviewsDescription',
      icon: ClipboardCheck,
      order: 40,
      source: 'built-in'
    }
  ]
  const claimed = new Set(items.map(({ id }) => id))
  for (const section of workspaceSections.filter(({ placement }) => (
    placement === 'navigation'
  ))) {
    if (claimed.has(section.sectionId)) {
      throw new TypeError(
        `Collaboration Center navigation section ${section.sectionId} is duplicated.`
      )
    }
    claimed.add(section.sectionId)
    items.push({
      id: section.sectionId,
      label: section.label,
      description: section.description ?? section.label,
      icon: section.icon ?? Workflow,
      order: section.order,
      source: 'extension'
    })
  }
  return Object.freeze(items.sort((left, right) => (
    left.order - right.order || left.id.localeCompare(right.id)
  )).map((item) => Object.freeze(item)))
}

export type ProjectCoordinatorPanelProps = Readonly<{
  client: ProjectCoordinatorRendererClient
  session: DomainWorkbenchRightPanelSession
  visibleContext?: DomainRendererVisibleContextHost
  /** Host foreground/focus semantics; selection itself remains Project-owned. */
  active?: boolean
  focused?: boolean
  surfaceId?: string
  initialProjectId?: string
  initialView?: ProjectCoordinatorActivationView
  activationRevision?: number
  className?: string
  onCollapse?: () => void
  onOpenArtifact?: (input: ProjectCoordinatorArtifactReviewPrepareInput) => Promise<void>
  workspaceSections?: readonly ProjectCoordinatorWorkspaceSection[]
}>

export type ProjectCoordinatorActivationTarget = Readonly<{
  workspaceView: string
  sectionId?: (typeof PROJECT_COORDINATOR_PANEL_SECTION_IDS)[number] | 'create'
  requestCreate?: true
}>

export function projectCoordinatorActivationTarget(
  view: ProjectCoordinatorActivationView,
  availableWorkspaceViews: ReadonlySet<string>
): ProjectCoordinatorActivationTarget {
  switch (view) {
    case 'overview':
      return Object.freeze({ workspaceView: 'overview' })
    case 'tasks':
      return Object.freeze({ workspaceView: 'projects', sectionId: 'tasks' })
    case 'files':
      return Object.freeze({
        workspaceView: availableWorkspaceViews.has('files') ? 'files' : 'overview'
      })
    case 'decisions':
      return Object.freeze({ workspaceView: 'reviews' })
    case 'recovery':
      return Object.freeze({ workspaceView: 'projects', sectionId: 'provisioning' })
    case 'create':
      return Object.freeze({
        workspaceView: 'projects',
        sectionId: 'create',
        requestCreate: true
      })
  }
}

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
  visibleContext,
  active = true,
  focused = true,
  surfaceId,
  initialProjectId,
  initialView,
  activationRevision = 0,
  className,
  onCollapse,
  onOpenArtifact,
  workspaceSections = []
}: ProjectCoordinatorPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [workspace, setWorkspace] = useState<ProjectCoordinatorWorkspace>()
  const [sessionBinding, setSessionBinding] = useState<ProjectCoordinatorSessionBinding | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialProjectId ?? currentProjectCoordinatorPanelContext()?.projectId ?? ''
  )
  const selectedProjectIdRef = useRef(selectedProjectId)
  const [loading, setLoading] = useState(true)
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false)
  const [nowMilliseconds, setNowMilliseconds] = useState(() => Date.now())
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState<ProjectCoordinatorPlanDraft | null>(null)
  const [workflowPlan, setWorkflowPlan] = useState<ProjectCoordinatorWorkflowPlan>()
  const [busyAction, setBusyAction] = useState<string>()
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createGoal, setCreateGoal] = useState('')
  const createIntentRef = useRef<Readonly<{
    fingerprint: string
    createIntentId: `pct_${string}`
  }> | undefined>(undefined)
  const createInFlightRef = useRef<Promise<void> | null>(null)
  const [initialContentMode, setInitialContentMode] = useState<'none' | 'required'>('none')
  const [initialProviderFactId, setInitialProviderFactId] = useState('')
  const [activeView, setActiveView] = useState<string>('overview')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newProjectRequest, setNewProjectRequest] = useState(0)
  const [activationSectionRequest, setActivationSectionRequest] = useState<Readonly<{
    revision: number
    sectionId: (typeof PROJECT_COORDINATOR_PANEL_SECTION_IDS)[number]
  }>>()
  // Activation props are retained by the host while a pane is open.  The
  // panel can re-render for unrelated workspace updates (including Worker
  // assignment refreshes), so applying the retained initial view on every
  // render would undo a user's in-panel navigation.  A revisioned activation
  // is a one-shot intent; only a new activation tuple may change the view.
  const appliedActivationKeyRef = useRef<string | undefined>(undefined)
  const refreshRequestRef = useRef(0)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId
  }, [selectedProjectId])

  // Publish only the explicit Project selection.  This is a renderer context
  // hint for the composer; it carries no permission and is never used to
  // bypass the capability handlers' Principal and membership checks.
  useEffect(() => {
    if (!surfaceId || !active || !selectedProjectId) {
      if (surfaceId) clearProjectCoordinatorPanelContext(surfaceId)
      return
    }
    setProjectCoordinatorPanelContext({
      surfaceId,
      projectId: selectedProjectId,
      active,
      focused
    })
    const disposeVisibleContext = visibleContext?.registerComponent({
      id: `right-sidebar:project-coordinator:${encodeURIComponent(surfaceId)}`,
      region: 'right-sidebar',
      component: 'project-coordinator-panel',
      title: 'Project Coordinator',
      visible: true,
      priority: 20,
      updatedAt: new Date().toISOString(),
      summary: 'Project workbench target selected by the user.',
      state: {
        panelTarget: true,
        selectedProjectId,
        projectId: selectedProjectId,
        surfaceId,
        active,
        focused
      },
      resources: [{
        kind: 'project-coordinator-panel',
        metadata: {
          panelTarget: true,
          selectedProjectId,
          projectId: selectedProjectId,
          surfaceId
        }
      }]
    })
    return () => {
      clearProjectCoordinatorPanelContext(surfaceId)
      disposeVisibleContext?.()
    }
  }, [active, focused, selectedProjectId, surfaceId, visibleContext])

  const navigationItems = useMemo(
    () => projectCoordinatorWorkspaceNavigationItems(workspaceSections),
    [workspaceSections]
  )
  const settingsSections = useMemo(
    () => workspaceSections.filter(({ placement }) => placement === 'settings'),
    [workspaceSections]
  )
  const activeWorkspaceSection = useMemo(
    () => workspaceSections.find(({ placement, sectionId }) => (
      placement === 'navigation' && sectionId === activeView
    )),
    [activeView, workspaceSections]
  )
  const availableWorkspaceViews = useMemo(
    () => new Set(navigationItems.map(({ id }) => id)),
    [navigationItems]
  )

  const refresh = useCallback(async (
    projectId?: string,
    signal?: AbortSignal,
    mode: 'foreground' | 'background' = 'foreground'
  ) => {
    const requestRevision = refreshRequestRef.current + 1
    refreshRequestRef.current = requestRevision
    if (mode === 'foreground') {
      setLoading(true)
      setBackgroundRefreshing(false)
      setError(undefined)
      setWorkflowPlan(undefined)
    } else {
      setBackgroundRefreshing(true)
    }
    try {
      const [next, projection] = await Promise.all([
        client.readWorkspace(projectId ? { projectId } : {}),
        client.readSessionProjection().catch(() => null)
      ])
      if (signal?.aborted || refreshRequestRef.current !== requestRevision) return
      setWorkspace(next)
      setSessionBinding(projection
        ? projectCoordinatorCurrentSessionBinding(projection, {
            id: session.id,
            ...(session.runtimeId ? { runtimeId: session.runtimeId } : {})
          })
        : null)
      setNowMilliseconds(Date.now())
      // A Session switch must not silently replace a Project the user chose
      // in this workbench with the Cloud provider's focused Project.  Only an
      // explicit activation/selection may change the target.
      const preferred = projectId ?? selectedProjectIdRef.current ?? next.focusedProjectId
      if (preferred && next.projects.some(({ project }) => project.projectId === preferred)) {
        setSelectedProjectId(preferred)
        selectedProjectIdRef.current = preferred
        const nextDraft = await client.readPlanDraft({ projectId: preferred })
        if (!signal?.aborted && refreshRequestRef.current === requestRevision) setDraft(nextDraft)
      } else if (next.projects.length === 1) {
        const onlyProjectId = next.projects[0]!.project.projectId
        setSelectedProjectId(onlyProjectId)
        selectedProjectIdRef.current = onlyProjectId
        const nextDraft = await client.readPlanDraft({ projectId: onlyProjectId })
        if (!signal?.aborted && refreshRequestRef.current === requestRevision) setDraft(nextDraft)
      } else {
        setSelectedProjectId('')
        selectedProjectIdRef.current = ''
        setDraft(null)
      }
    } catch (cause) {
      if (signal?.aborted || refreshRequestRef.current !== requestRevision) return
      setError(cause instanceof Error ? cause.message : t('projectCoordinatorReadFailed'))
    } finally {
      if (!signal?.aborted && refreshRequestRef.current === requestRevision) {
        if (mode === 'foreground') setLoading(false)
        else setBackgroundRefreshing(false)
      }
    }
  }, [client, session.id, session.runtimeId, t])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(initialProjectId, controller.signal)
    return () => controller.abort()
  }, [initialProjectId, refresh, session.id])

  useEffect(() => {
    if (!initialView) return
    const activationKey = `${activationRevision}\u0000${initialProjectId ?? ''}\u0000${initialView}`
    if (appliedActivationKeyRef.current === activationKey) return
    appliedActivationKeyRef.current = activationKey
    const target = projectCoordinatorActivationTarget(
      initialView,
      availableWorkspaceViews
    )
    setSettingsOpen(false)
    setActiveView(target.workspaceView)
    if (target.requestCreate) {
      setNewProjectRequest((request) => request + 1)
      setActivationSectionRequest(undefined)
      return
    }
    setActivationSectionRequest(target.sectionId && target.sectionId !== 'create'
      ? { revision: activationRevision, sectionId: target.sectionId }
      : undefined)
  }, [activationRevision, availableWorkspaceViews, initialProjectId, initialView])

  useEffect(() => {
    const timer = setInterval(() => setNowMilliseconds(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [])

  const project = useMemo(
    () => selectFocusedProject(workspace, selectedProjectId || initialProjectId),
    [initialProjectId, selectedProjectId, workspace]
  )

  useEffect(() => {
    if (!navigationItems.some(({ id }) => id === activeView)) {
      setActiveView('overview')
    }
  }, [activeView, navigationItems])

  useEffect(() => {
    if (
      workspace?.connection.state === 'ready' &&
      workspace.projects.length === 0 &&
      activeView === 'overview'
    ) {
      setActiveView('projects')
    }
  }, [activeView, workspace])

  useEffect(() => {
    setWorkflowPlan(undefined)
  }, [project?.project.projectId, project?.project.revision])

  useEffect(() => {
    if (workspace?.connection.state !== 'ready' || busyAction) return
    const projectId = selectedProjectId || initialProjectId || undefined
    const refreshVisibleWorkspace = () => {
      if (globalThis.document?.visibilityState === 'hidden') return
      void refresh(projectId, undefined, 'background')
    }
    const timer = setInterval(
      refreshVisibleWorkspace,
      PROJECT_COORDINATOR_LIVE_REFRESH_INTERVAL_MS
    )
    const handleVisibility = () => {
      if (globalThis.document?.visibilityState === 'visible') refreshVisibleWorkspace()
    }
    globalThis.document?.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearInterval(timer)
      globalThis.document?.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [busyAction, initialProjectId, refresh, selectedProjectId, workspace?.connection.state])

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
      setError(cause instanceof ProjectCoordinatorPlanDraftGenerationClientError
        ? t(projectCoordinatorPlanGenerationFailureMessageKey(cause.reason))
        : cause instanceof Error
          ? cause.message
          : t('projectCoordinatorActionFailed'))
    } finally {
      setBusyAction(undefined)
    }
  }, [t])

  const createProject = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (workspace?.connection.state !== 'ready' || createInFlightRef.current) return
    const budget = {
      maxTasks: 32,
      maxTasksPerRound: 8,
      maxTaskRetries: 2,
      maxCoordinationRounds: 4
    }
    const fingerprint = JSON.stringify({
      displayName: createDisplayName.trim(),
      goal: createGoal.trim(),
      budget
    })
    const existingIntent = createIntentRef.current
    const createIntentId = existingIntent?.fingerprint === fingerprint
      ? existingIntent.createIntentId
      : newProjectCreateIntentId()
    createIntentRef.current = Object.freeze({ fingerprint, createIntentId })
    const operation = runAction('project-create', () => client.createProject({
      createIntentId,
      displayName: createDisplayName,
      goal: createGoal,
      budget
    }), async (result) => {
      const selected = projectCoordinatorCreatedSelection(result)
      setWorkspace(selected.workspace)
      setSelectedProjectId(selected.selectedProjectId)
      setDraft(await client.readPlanDraft({ projectId: selected.selectedProjectId }))
      createIntentRef.current = undefined
      setCreateDisplayName('')
      setCreateGoal('')
    })
    createInFlightRef.current = operation
    void operation.finally(() => {
      if (createInFlightRef.current === operation) createInFlightRef.current = null
    })
  }, [
    client,
    createDisplayName,
    createGoal,
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

  const confirmPlan = useCallback(() => {
    if (
      !project?.plan ||
      project.plan.plan.state !== 'awaiting_confirmation' ||
      workspace?.connection.state !== 'ready'
    ) return
    const plan = project.plan.plan
    const effectiveContentMode = plan.tasks.some(({ fileIntent }) => fileIntent !== null)
      ? 'required' as const
      : initialContentMode
    const assignedUserIds = project.plan.plan.tasks.map(({ workerUserId }) => workerUserId)
    const initialMemberUserIds = [...new Set([
      project.project.ownerUserId,
      ...assignedUserIds.filter((userId) => userId !== project.project.ownerUserId)
    ])]
    const ownerProviderFacts = workspace.providerPrincipalFacts
      .filter(({ userId, readiness }) => (
        userId === project.project.ownerUserId && readiness === 'ready'
      ))
      .sort((left, right) => right.revision - left.revision)
    const ownerProviderFact = ownerProviderFacts.find(({ providerPrincipalFactId }) => (
      providerPrincipalFactId === initialProviderFactId
    )) ?? ownerProviderFacts[0]
    const requiredMembers = effectiveContentMode === 'required' && ownerProviderFact
      ? initialMemberUserIds.map((userId) => {
          const fact = workspace.providerPrincipalFacts
            .filter((candidate) => (
              candidate.userId === userId &&
              candidate.readiness === 'ready' &&
              candidate.providerPrincipal.providerInstance.providerInstanceRef ===
                ownerProviderFact.providerPrincipal.providerInstance.providerInstanceRef
            ))
            .sort((left, right) => right.revision - left.revision)[0]
          return fact ? {
            userId,
            providerPrincipalFactId: fact.providerPrincipalFactId,
            expectedFactRevision: fact.revision
          } : null
        })
      : []
    if (
      project.project.status === 'draft' &&
      effectiveContentMode === 'required' &&
      (!ownerProviderFact || requiredMembers.some((member) => member === null))
    ) {
      setError(t('projectCoordinatorCreateProviderFactsMissing'))
      return
    }
    const initialTeam = project.project.status !== 'draft'
      ? null
      : effectiveContentMode === 'none'
        ? {
            mode: 'none' as const,
            members: initialMemberUserIds.map((userId) => ({ userId }))
          }
        : {
            mode: 'required' as const,
            contentOwnerUserId: project.project.ownerUserId,
            providerInstance: ownerProviderFact!.providerPrincipal.providerInstance,
            containerDisplayName: project.project.displayName,
            members: requiredMembers as Exclude<(typeof requiredMembers)[number], null>[]
          }
    void runAction('plan-confirm', () => client.confirmPlan({
      projectId: project.project.projectId,
      projectPlanId: plan.projectPlanId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      expectedPlanRevision: plan.revision,
      planDigest: plan.planDigest,
      initialTeam
    }), (next) => {
      setWorkspace(next)
      setSelectedProjectId(project.project.projectId)
    })
  }, [
    client,
    initialContentMode,
    initialProviderFactId,
    project,
    runAction,
    t,
    workspace
  ])

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

  const prepareWorkflow = useCallback(() => {
    if (!project) return
    void runAction('workflow-prepare', () => client.prepareWorkflow({
      projectId: project.project.projectId
    }), setWorkflowPlan)
  }, [client, project, runAction])

  const continueWorkflow = useCallback((plan: ProjectCoordinatorWorkflowPlan) => {
    void runAction('workflow-continue', () => client.continueWorkflow(plan), (next) => {
      applyProjectWorkspace(next)
      setWorkflowPlan(undefined)
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

  const reassignTaskOffer = useCallback((
    input: ProjectCoordinatorTaskOfferReassignInput
  ) => {
    void runAction('task-offer-reassign', () => (
      client.reassignTaskOffer(input)
    ), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const addMember = useCallback((input: ProjectCoordinatorMembershipAddInput) => {
    void runAction('membership-add', () => client.addMember(input), (next) => {
      applyProjectWorkspace(next)
      setWorkflowPlan(undefined)
    })
  }, [applyProjectWorkspace, client, runAction])

  const acceptInvitation = useCallback((input: ProjectCoordinatorMembershipAcceptInput) => {
    void runAction('membership-accept', () => client.acceptInvitation(input), applyProjectWorkspace)
  }, [applyProjectWorkspace, client, runAction])

  const removeMember = useCallback((input: ProjectCoordinatorMembershipRemoveInput) => {
    void runAction('membership-remove', () => client.removeMember(input), (next) => {
      applyProjectWorkspace(next)
      setWorkflowPlan(undefined)
    })
  }, [applyProjectWorkspace, client, runAction])

  const navigateWorkspace = useCallback((viewId: string) => {
    if (!navigationItems.some(({ id }) => id === viewId)) return
    setSettingsOpen(false)
    setActiveView(viewId)
  }, [navigationItems])

  const startNewProject = useCallback(() => {
    setSettingsOpen(false)
    setActiveView('projects')
    setNewProjectRequest((request) => request + 1)
  }, [])

  useEffect(() => {
    if (activeView !== 'projects' || newProjectRequest === 0) return
    const frame = globalThis.requestAnimationFrame?.(() => {
      focusCoordinatorSection('create')
    })
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame)
    }
  }, [activeView, newProjectRequest])

  useEffect(() => {
    if (activeView !== 'projects' || !activationSectionRequest) return
    const frame = globalThis.requestAnimationFrame?.(() => {
      focusCoordinatorSection(activationSectionRequest.sectionId)
    })
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame)
    }
  }, [activationSectionRequest, activeView])

  return (
    <aside
      className={`project-coordinator-panel ds-no-drag ${className ?? ''}`}
      data-domain="project-coordinator"
      data-session-id={session.id}
      data-surface-id={surfaceId}
      data-project-id={selectedProjectId || undefined}
      data-selected-project-id={selectedProjectId || undefined}
      data-active-workspace-view={activeView}
    >
      <header className="project-coordinator-header">
        <span className="project-coordinator-brand-mark" aria-hidden="true">
          <Workflow />
        </span>
        <div className="project-coordinator-heading">
          <h2>{t('projectCoordinatorTitle')}</h2>
          <span>{t('projectCoordinatorSubtitle')}</span>
        </div>
        <div className="project-coordinator-header-actions">
          {workspace?.connection.state === 'ready' ? (
            <LiveSyncStatus
              observedAt={workspace.observedAt}
              nowMilliseconds={nowMilliseconds}
              syncing={backgroundRefreshing}
            />
          ) : null}
          <button
            type="button"
            className="project-coordinator-header-button"
            disabled={workspace?.connection.state !== 'ready'}
            onClick={startNewProject}
          >
            <Plus aria-hidden="true" />
            <span>{t('projectCoordinatorCenterNewProject')}</span>
          </button>
          <button
            ref={settingsButtonRef}
            type="button"
            className="project-coordinator-icon-button"
            aria-label={t('projectCoordinatorCenterOpenSettings')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className="project-coordinator-icon-button"
            aria-label={t('projectCoordinatorRefresh')}
            disabled={loading || backgroundRefreshing || Boolean(busyAction)}
            onClick={() => void refresh(selectedProjectId || undefined)}
          >
            {loading || backgroundRefreshing
              ? <Loader2 className="animate-spin" aria-hidden="true" />
              : <RefreshCw aria-hidden="true" />}
          </button>
          {onCollapse ? (
            <button
              type="button"
              className="project-coordinator-icon-button"
              aria-label={t('projectCoordinatorCollapse')}
              onClick={onCollapse}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="project-coordinator-context">
        {workspace?.connection.state === 'ready' && workspace.projects.length > 0 ? (
          <label className="project-coordinator-project-picker">
            <span>{t('projectCoordinatorProject')}</span>
            <select
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
        ) : (
          <span className="project-coordinator-context-label">
            {t('projectCoordinatorCenterNoActiveProject')}
          </span>
        )}
        <CollaborationReadinessBar
          workspace={workspace}
          project={project}
          onNavigate={navigateWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      <div className="project-coordinator-workspace">
        <CollaborationWorkspaceNavigation
          activeView={activeView}
          items={navigationItems}
          onNavigate={navigateWorkspace}
        />

        <main
          className="project-coordinator-workspace-main"
          aria-label={t(
            navigationItems.find(({ id }) => id === activeView)?.label ??
              'projectCoordinatorTitle'
          )}
        >
          <div className="project-coordinator-global-notices">
            {error ? <Notice tone="error">{error}</Notice> : null}
            {connectionMessage ? (
              <Notice tone="warning">
                {t(connectionMessage)}
                {'reason' in workspace!.connection ? ` ${workspace!.connection.reason}` : ''}
              </Notice>
            ) : null}
            {loading && !workspace ? <Notice>{t('projectCoordinatorLoading')}</Notice> : null}
          </div>

          <div
            className="project-coordinator-workspace-view"
            data-workspace-view={activeView}
            data-extension-view={activeWorkspaceSection ? 'true' : 'false'}
            role="tabpanel"
            id={`project-coordinator-view-${activeView}`}
          >
            {activeView === 'overview' ? (
              project ? (
                <>
                  <ProjectOverview
                    project={project}
                    currentUserId={workspace?.connection.state === 'ready'
                      ? workspace.connection.userId
                      : null}
                    sessionBinding={sessionBinding}
                    observedAt={workspace?.observedAt ?? project.project.updatedAt}
                    nowMilliseconds={nowMilliseconds}
                    onNavigate={navigateWorkspace}
                  />
                  <WorkersSection
                    project={project}
                    observedAt={new Date(nowMilliseconds).toISOString()}
                  />
                </>
              ) : (
                <CollaborationCenterEmpty
                  title={t('projectCoordinatorCenterNoActiveProject')}
                  message={t('projectCoordinatorCenterNoActiveProjectDescription')}
                  action={t('projectCoordinatorCenterNewProject')}
                  onAction={workspace?.connection.state === 'ready'
                    ? startNewProject
                    : () => setSettingsOpen(true)}
                />
              )
            ) : null}

            {activeView === 'projects' ? (
              <>
                {workspace?.connection.state === 'ready' ? (
                  <ProjectCreateForm
                    defaultExpanded={workspace.projects.length === 0}
                    requestOpen={newProjectRequest}
                    busy={busyAction === 'project-create'}
                    displayName={createDisplayName}
                    goal={createGoal}
                    onDisplayName={(value) => {
                      createIntentRef.current = undefined
                      setCreateDisplayName(value)
                    }}
                    onGoal={(value) => {
                      createIntentRef.current = undefined
                      setCreateGoal(value)
                    }}
                    onSubmit={createProject}
                  />
                ) : null}
                <ProjectCoordinatorPlanSection
                  project={project}
                  draft={draft}
                  observedAt={workspace?.observedAt ?? project?.project.updatedAt ?? ''}
                  busy={Boolean(busyAction?.startsWith('plan-'))}
                  onGenerate={generateDraft}
                  onEditDraft={editDraft}
                  onSubmitDraft={submitDraft}
                  canConfirm={workspace?.connection.state === 'ready' &&
                    workspace.connection.userId === project?.project.ownerUserId}
                  currentUserId={workspace?.connection.state === 'ready'
                    ? workspace.connection.userId
                    : null}
                  providerPrincipalFacts={workspace?.providerPrincipalFacts ?? []}
                  initialContentMode={initialContentMode}
                  initialProviderFactId={initialProviderFactId}
                  onInitialContentMode={setInitialContentMode}
                  onInitialProviderFactId={setInitialProviderFactId}
                  onConfirm={confirmPlan}
                />
                <TasksSection
                  project={project}
                  observedAt={workspace?.observedAt}
                  canReassign={workspace?.connection.state === 'ready' &&
                    workspace.connection.userId === project?.project.ownerUserId &&
                    project?.project.status === 'active'}
                  busy={busyAction === 'task-offer-reassign'}
                  onReassign={reassignTaskOffer}
                />
                <ProjectCoordinatorTransferSection
                  project={project}
                  canTransfer={workspace?.connection.state === 'ready' &&
                    workspace.connection.userId === project?.project.ownerUserId}
                  busy={busyAction === 'coordinator-transfer'}
                  onTransfer={transferCoordinator}
                />
                <ProjectCoordinatorProvisioningSection
                  project={project}
                  plan={workflowPlan ?? null}
                  currentUserId={workspace?.connection.state === 'ready'
                    ? workspace.connection.userId
                    : null}
                  canManage={workspace?.connection.state === 'ready' &&
                    workspace.connection.userId === project?.project.ownerUserId}
                  busy={Boolean(busyAction?.startsWith('workflow-') ||
                    busyAction?.startsWith('membership-') ||
                    busyAction?.startsWith('recovery-'))}
                  onPrepareWorkflow={prepareWorkflow}
                  onContinueWorkflow={continueWorkflow}
                  onAddMember={addMember}
                  onAcceptInvitation={acceptInvitation}
                  onRemoveMember={removeMember}
                  onObserveAndLinkRecovery={observeAndLinkRecovery}
                  onAbandonRecovery={abandonRecovery}
                />
              </>
            ) : null}

            {activeView === 'reviews' ? (
              <ProjectCoordinatorDecisionSection
                project={project}
                currentUserId={workspace?.connection.state === 'ready'
                  ? workspace.connection.userId
                  : null}
                sessionBinding={sessionBinding}
                busy={Boolean(busyAction && !busyAction.startsWith('plan-'))}
                onCreateHumanNeeded={createHumanNeeded}
                onAnswerHumanNeeded={answerHumanNeeded}
                onOpenArtifact={onOpenArtifact ? openArtifact : undefined}
                onReviewResult={reviewResult}
                onComplete={completeProject}
              />
            ) : null}

            {activeWorkspaceSection
              ? activeWorkspaceSection.render({
                  active: true,
                  className: 'project-coordinator-extension-panel',
                  session
                })
              : null}
          </div>
        </main>
      </div>

      <CollaborationSettingsDrawer
        open={settingsOpen}
        sections={settingsSections}
        session={session}
        returnFocusRef={settingsButtonRef}
        onClose={() => setSettingsOpen(false)}
      />
    </aside>
  )
}

function CollaborationReadinessBar({
  workspace,
  project,
  onNavigate,
  onOpenSettings
}: Readonly<{
  workspace?: ProjectCoordinatorWorkspace
  project?: ProjectCoordinatorProject
  onNavigate(viewId: string): void
  onOpenSettings(): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const coordinator = project?.workerGroups.flatMap(({ agents }) => agents).find(
    ({ projectAvailability }) => (
      projectAvailability.agentId === project.project.coordinatorAgentId
    )
  )
  const operational = coordinator
    ? projectCoordinatorAgentOperationalState(coordinator)
    : undefined
  const recoveryRequired = project?.provisioning.recoveryActions.some(({ status }) => (
    status === 'available'
  )) ?? false
  const items = [
    {
      id: 'cloud',
      icon: <Cloud />,
      label: t('projectCoordinatorCenterCloud'),
      state: workspace?.connection.state === 'ready' ? 'ready' : 'attention',
      status: workspace?.connection.state === 'ready'
        ? t('projectCoordinatorCenterReady')
        : t('projectCoordinatorCenterActionRequired'),
      action: onOpenSettings
    },
    {
      id: 'runtime',
      icon: <Activity />,
      label: t('projectCoordinatorCenterRuntime'),
      state: !project ? 'pending' : operational?.runtimeReady ? 'ready' : 'attention',
      status: !project
        ? t('projectCoordinatorCenterWhenNeeded')
        : operational?.runtimeReady
          ? t('projectCoordinatorCenterReady')
          : t('projectCoordinatorCenterActionRequired'),
      action: onOpenSettings
    },
    {
      id: 'agent',
      icon: <Bot />,
      label: t('projectCoordinatorCenterAgent'),
      state: !project ? 'pending' : operational?.online ? 'ready' : 'attention',
      status: !project
        ? t('projectCoordinatorCenterWhenNeeded')
        : operational?.online
          ? t('projectCoordinatorCenterOnline')
          : t('projectCoordinatorCenterActionRequired'),
      action: onOpenSettings
    },
    {
      id: 'files',
      icon: <FolderOpen />,
      label: t('projectCoordinatorCenterSharedFiles'),
      state: project?.provisioning.binding
        ? 'ready'
        : recoveryRequired
          ? 'attention'
          : 'pending',
      status: project?.provisioning.binding
        ? t('projectCoordinatorCenterReady')
        : recoveryRequired
          ? t('projectCoordinatorCenterActionRequired')
          : t('projectCoordinatorCenterWhenNeeded'),
      action: () => onNavigate('files')
    }
  ] as const

  return (
    <div
      className="project-coordinator-readiness"
      aria-label={t('projectCoordinatorCenterReadiness')}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-readiness-id={item.id}
          data-readiness-state={item.state}
          onClick={item.action}
        >
          <span aria-hidden="true">{item.icon}</span>
          <span>
            <strong>{item.label}</strong>
            <small>{item.status}</small>
          </span>
        </button>
      ))}
    </div>
  )
}

function CollaborationWorkspaceNavigation({
  activeView,
  items,
  onNavigate
}: Readonly<{
  activeView: string
  items: readonly ProjectCoordinatorWorkspaceNavigationItem[]
  onNavigate(viewId: string): void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <nav
      className="project-coordinator-workspace-navigation"
      aria-label={t('projectCoordinatorCenterNavigation')}
      role="tablist"
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']
          .includes(event.key)) return
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        )
        const current = tabs.indexOf(globalThis.document?.activeElement as HTMLButtonElement)
        if (tabs.length === 0) return
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : event.key === 'ArrowDown' || event.key === 'ArrowRight'
              ? (Math.max(current, 0) + 1) % tabs.length
              : (current <= 0 ? tabs.length : current) - 1
        event.preventDefault()
        tabs[next]?.focus()
        tabs[next]?.click()
      }}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`project-coordinator-tab-${item.id}`}
            aria-controls={`project-coordinator-view-${item.id}`}
            aria-selected={activeView === item.id}
            tabIndex={activeView === item.id ? 0 : -1}
            data-navigation-source={item.source}
            onClick={() => onNavigate(item.id)}
            title={t(item.description)}
          >
            <span className="project-coordinator-navigation-icon" aria-hidden="true">
              <Icon />
            </span>
            <span>
              <strong>{t(item.label)}</strong>
              <small>{t(item.description)}</small>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function CollaborationCenterEmpty({
  title,
  message,
  action,
  onAction
}: Readonly<{
  title: string
  message: string
  action: string
  onAction(): void
}>): ReactElement {
  return (
    <div className="project-coordinator-center-empty">
      <span aria-hidden="true"><Workflow /></span>
      <strong>{title}</strong>
      <p>{message}</p>
      <button type="button" onClick={onAction}>{action}</button>
    </div>
  )
}

function CollaborationSettingsDrawer({
  open,
  sections,
  session,
  returnFocusRef,
  onClose
}: Readonly<{
  open: boolean
  sections: readonly ProjectCoordinatorWorkspaceSection[]
  session: DomainWorkbenchRightPanelSession
  returnFocusRef: React.RefObject<HTMLButtonElement | null>
  onClose(): void
}>): ReactElement | null {
  const { t } = useTranslation('common')
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    onClose()
    globalThis.queueMicrotask?.(() => returnFocusRef.current?.focus())
  }, [onClose, returnFocusRef])

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    globalThis.document?.addEventListener('keydown', onKeyDown)
    return () => globalThis.document?.removeEventListener('keydown', onKeyDown)
  }, [close, open])

  if (!open) return null
  return (
    <div className="project-coordinator-settings-layer">
      <button
        type="button"
        className="project-coordinator-settings-backdrop"
        aria-label={t('projectCoordinatorCenterCloseSettings')}
        onClick={close}
      />
      <section
        className="project-coordinator-settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-coordinator-settings-title"
      >
        <header>
          <span>
            <small>{t('projectCoordinatorTitle')}</small>
            <h3 id="project-coordinator-settings-title">
              {t('projectCoordinatorCenterConnections')}
            </h3>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            className="project-coordinator-icon-button"
            aria-label={t('projectCoordinatorCenterCloseSettings')}
            onClick={close}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="project-coordinator-settings-scroll">
          {sections.length > 0 ? sections.map((section) => (
            <section
              key={section.contributionId}
              className="project-coordinator-settings-section"
              data-settings-section={section.sectionId}
            >
              <div className="project-coordinator-settings-section-heading">
                <strong>{t(section.label)}</strong>
                {section.description ? <span>{t(section.description)}</span> : null}
              </div>
              {section.render({
                active: true,
                className: 'project-coordinator-settings-extension',
                session
              })}
            </section>
          )) : (
            <Notice>{t('projectCoordinatorCenterSettingsUnavailable')}</Notice>
          )}
        </div>
      </section>
    </div>
  )
}

export function ProjectCreateForm({
  defaultExpanded = false,
  requestOpen = 0,
  busy,
  displayName,
  goal,
  onDisplayName,
  onGoal,
  onSubmit
}: Readonly<{
  defaultExpanded?: boolean
  requestOpen?: number
  busy: boolean
  displayName: string
  goal: string
  onDisplayName(value: string): void
  onGoal(value: string): void
  onSubmit(event: FormEvent<HTMLFormElement>): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(defaultExpanded)
  useEffect(() => {
    if (defaultExpanded) setExpanded(true)
  }, [defaultExpanded])
  useEffect(() => {
    if (requestOpen > 0) setExpanded(true)
  }, [requestOpen])
  return (
    <details
      id="project-coordinator-create"
      className="project-coordinator-create"
      open={expanded}
      tabIndex={-1}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="project-coordinator-create-icon" aria-hidden="true">
          <CircleDashed />
        </span>
        <span>
          <strong>{t('projectCoordinatorCreateProject')}</strong>
          <small>{t('projectCoordinatorCreateProjectHint')}</small>
        </span>
      </summary>
      <form className="project-coordinator-create-form" onSubmit={onSubmit}>
        <label>
          <span>{t('projectCoordinatorProjectName')}</span>
          <input
            required
            value={displayName}
            onChange={(event) => onDisplayName(event.currentTarget.value)}
            placeholder={t('projectCoordinatorProjectNamePlaceholder')}
          />
        </label>
        <label>
          <span>{t('projectCoordinatorProjectGoal')}</span>
          <textarea
            required
            rows={3}
            value={goal}
            onChange={(event) => onGoal(event.currentTarget.value)}
            placeholder={t('projectCoordinatorProjectGoalPlaceholder')}
          />
        </label>
        <div className="project-coordinator-create-role">
          <UserRoundCheck aria-hidden="true" />
          <span>
            <strong>{t('projectCoordinatorCreatorRole')}</strong>
            <small>{t('projectCoordinatorCreatorRoleHint')}</small>
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-ds-muted">
          {t('projectCoordinatorMemberSelectionAfterCreate')}
        </p>
        <button disabled={busy} type="submit" className="project-coordinator-primary-button">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Zap aria-hidden="true" />}
          {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorCreateProject')}
        </button>
      </form>
    </details>
  )
}

function LiveSyncStatus({
  observedAt,
  nowMilliseconds,
  syncing
}: Readonly<{
  observedAt: string
  nowMilliseconds: number
  syncing: boolean
}>): ReactElement {
  const { i18n, t } = useTranslation('common')
  const relative = formatRelativeTime(observedAt, nowMilliseconds, i18n.resolvedLanguage)
  const observedMilliseconds = Date.parse(observedAt)
  const stale = !Number.isFinite(observedMilliseconds) ||
    nowMilliseconds - observedMilliseconds > PROJECT_COORDINATOR_LIVE_REFRESH_INTERVAL_MS * 3
  const stateLabel = syncing
    ? t('projectCoordinatorSyncing')
    : stale
      ? t('projectCoordinatorStale')
      : t('projectCoordinatorLive')
  return (
    <span
      className="project-coordinator-live-sync"
      data-syncing={syncing ? 'true' : 'false'}
      data-stale={stale ? 'true' : 'false'}
      title={`${t('projectCoordinatorObservedAt')}: ${observedAt}`}
      aria-live="polite"
      aria-label={`${stateLabel} · ${relative}`}
    >
      <span className="project-coordinator-live-dot" aria-hidden="true" />
      <Radio aria-hidden="true" />
      <span>{stateLabel}</span>
      <small>{syncing ? t('projectCoordinatorSyncing') : relative}</small>
    </span>
  )
}

function ProjectOverview({
  project,
  currentUserId,
  sessionBinding,
  observedAt,
  nowMilliseconds,
  onNavigate
}: Readonly<{
  project: ProjectCoordinatorProject
  currentUserId: string | null
  sessionBinding: ProjectCoordinatorSessionBinding | null
  observedAt: string
  nowMilliseconds: number
  onNavigate(viewId: string): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const record = project.project
  const asOf = new Date(nowMilliseconds).toISOString()
  const presence = projectCoordinatorWorkerPresenceSummary(project, asOf)
  const agents = project.workerGroups.flatMap(({ agents }) => agents)
  const coordinator = agents.find(({ projectAvailability }) => (
    projectAvailability.agentId === record.coordinatorAgentId
  ))
  const attention = projectCoordinatorAttentionSummary(
    project,
    currentUserId,
    sessionBinding
  )
  const stages = projectCoordinatorFlowStages(project)

  return (
    <section
      className="project-coordinator-overview"
      aria-labelledby="project-coordinator-project-title"
      data-project-status={record.status}
      data-project-attention-count={attention.total}
    >
      <div className="project-coordinator-overview-heading">
        <div>
          <div className="project-coordinator-eyebrow">
            <span>{t('projectCoordinatorActiveProject')}</span>
            <Status value={record.status} />
          </div>
          <h3 id="project-coordinator-project-title">{record.displayName}</h3>
          <p>{record.goal}</p>
        </div>
        <div className="project-coordinator-avatar-stack" aria-label={t('projectCoordinatorMembers')}>
          {project.workerGroups.slice(0, 4).map((group) => {
            const online = group.agents.some((agent) => (
              projectCoordinatorAgentOperationalState(agent, asOf).online
            ))
            return (
              <span
                key={group.userId}
                className="project-coordinator-avatar"
                data-online={online ? 'true' : 'false'}
                title={group.displayName}
              >
                {initials(group.displayName)}
              </span>
            )
          })}
          {project.workerGroups.length > 4 ? (
            <span className="project-coordinator-avatar project-coordinator-avatar-more">
              +{project.workerGroups.length - 4}
            </span>
          ) : null}
        </div>
      </div>

      <div className="project-coordinator-situation-strip">
        <div>
          <UserRoundCheck aria-hidden="true" />
          <span>
            <strong>{presence.onlineUsers}/{presence.visibleUsers}</strong>
            {t('projectCoordinatorMembersOnlineShort')}
          </span>
        </div>
        <div>
          <UserRoundCheck aria-hidden="true" />
          <span>
            <strong>{presence.readyUsers}/{presence.visibleUsers}</strong>
            {t('projectCoordinatorWorkerUsersReadyShort')}
          </span>
        </div>
        <div>
          <Workflow aria-hidden="true" />
          <span>
            <strong>{project.tasks.length}</strong>
            {t('projectCoordinatorTasksShort')}
          </span>
        </div>
      </div>

      <div className="project-coordinator-authority-line">
        <span className="project-coordinator-authority-glyph" aria-hidden="true">
          <Zap />
        </span>
        <span>
          <small>{t('projectCoordinatorCoordinator')}</small>
          <strong>{coordinator?.displayName ?? shortIdentifier(record.coordinatorAgentId)}</strong>
        </span>
        <code title={record.coordinatorAgentId}>{shortIdentifier(record.coordinatorAgentId)}</code>
        <span className="project-coordinator-epoch">e{record.coordinatorAuthorityEpoch}</span>
      </div>

      <ProjectFlowRail stages={stages} onNavigate={onNavigate} />
      <AttentionDeck attention={attention} onNavigate={onNavigate} />
      {project.finalSummary ? (
        <ProjectOutcomeHandoff project={project} onNavigate={onNavigate} />
      ) : null}

      <footer className="project-coordinator-overview-footer">
        <span>{t('projectCoordinatorObservedAt')}</span>
        <time dateTime={observedAt}>{formatAbsoluteTime(observedAt)}</time>
        <span>·</span>
        <span>{t('projectCoordinatorRevision')} {record.revision}</span>
      </footer>
    </section>
  )
}

function ProjectFlowRail({
  stages,
  onNavigate
}: Readonly<{
  stages: readonly ProjectCoordinatorFlowStage[]
  onNavigate(viewId: string): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const viewByStage: Readonly<Record<ProjectCoordinatorFlowStageId, string>> = {
    plan: 'projects',
    dispatch: 'projects',
    execute: 'projects',
    review: 'reviews',
    record: 'reviews',
    complete: 'reviews'
  }
  return (
    <div className="project-coordinator-flow" aria-label={t('projectCoordinatorFlow')}>
      <div className="project-coordinator-flow-heading">
        <span>{t('projectCoordinatorFlow')}</span>
        <small>{t('projectCoordinatorFlowHint')}</small>
      </div>
      <ol>
        {stages.map((stage) => (
          <li key={stage.id} data-flow-state={stage.state}>
            <button
              type="button"
              onClick={() => onNavigate(viewByStage[stage.id])}
            >
              <span className="project-coordinator-flow-node" aria-hidden="true">
                {stage.state === 'complete' ? <Check />
                  : stage.state === 'attention' ? <AlertCircle />
                    : stage.state === 'active' ? <Activity />
                      : <CircleDashed />}
              </span>
              <span className="project-coordinator-flow-label">
                {t(flowStageMessageKey(stage.id))}
              </span>
              {stage.count !== null ? <small>{stage.count}</small> : null}
              <span className="sr-only">{t(flowStageStateMessageKey(stage.state))}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function AttentionDeck({
  attention,
  onNavigate
}: Readonly<{
  attention: ProjectCoordinatorAttentionSummary
  onNavigate(viewId: string): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const items = [
    {
      id: 'plan-confirmation',
      count: attention.planConfirmation,
      view: 'projects',
      label: t('projectCoordinatorAttentionPlan')
    },
    {
      id: 'human-answers',
      count: attention.humanAnswers,
      view: 'reviews',
      label: t('projectCoordinatorAttentionHuman')
    },
    {
      id: 'result-reviews',
      count: attention.resultReviews,
      view: 'reviews',
      label: t('projectCoordinatorAttentionReview')
    },
    {
      id: 'revision-tasks',
      count: attention.revisionTasks,
      view: 'projects',
      label: t('projectCoordinatorAttentionRevision')
    },
    {
      id: 'recovery-actions',
      count: attention.recoveryActions,
      view: 'projects',
      label: t('projectCoordinatorAttentionRecovery')
    }
  ].filter(({ count }) => count > 0)

  return (
    <div className="project-coordinator-attention" data-has-attention={attention.total > 0 ? 'true' : 'false'}>
      <div className="project-coordinator-attention-heading">
        {attention.total > 0 ? <AlertCircle aria-hidden="true" /> : <Check aria-hidden="true" />}
        <span>{t('projectCoordinatorAttention')}</span>
        {attention.total > 0 ? <strong>{attention.total}</strong> : null}
      </div>
      {items.length > 0 ? (
        <nav aria-label={t('projectCoordinatorAttention')}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.view)}
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </nav>
      ) : (
        <p>{t('projectCoordinatorNoAttention')}</p>
      )}
    </div>
  )
}

function ProjectOutcomeHandoff({
  project,
  onNavigate
}: Readonly<{
  project: ProjectCoordinatorProject
  onNavigate(viewId: string): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const meetingPackage = projectCoordinatorMeetingPackageSummary(project)
  return (
    <div className="project-coordinator-handoff" data-completion-handoff="true">
      <div className="project-coordinator-handoff-heading">
        <span aria-hidden="true"><FileText /></span>
        <span>
          <strong>{t('projectCoordinatorMeetingPackage')}</strong>
          <small>{t('projectCoordinatorMeetingPackageHint')}</small>
        </span>
        <Status value="completed" />
      </div>
      <p>{project.finalSummary?.summary ?? project.project.goal}</p>
      <dl>
        <div>
          <dt>{t('projectCoordinatorAcceptedResults')}</dt>
          <dd>{meetingPackage.acceptedResults}</dd>
        </div>
        <div>
          <dt>{t('projectCoordinatorObservations')}</dt>
          <dd>{meetingPackage.observations}</dd>
        </div>
        <div>
          <dt>{t('projectCoordinatorDecisions')}</dt>
          <dd>{meetingPackage.decisions}</dd>
        </div>
        <div>
          <dt>artifactRefs</dt>
          <dd>{meetingPackage.artifactRefs.length}</dd>
        </div>
      </dl>
      {meetingPackage.artifactRefs.length > 0 ? (
        <details>
          <summary>{t('projectCoordinatorExactArtifactRefs')}</summary>
          {meetingPackage.artifactRefs.map((artifactRef) => (
            <code key={artifactRef}>{artifactRef}</code>
          ))}
        </details>
      ) : null}
      <div className="project-coordinator-handoff-actions">
        <button type="button" onClick={() => onNavigate('reviews')}>
          {t('projectCoordinatorReviewRecord')}
        </button>
        <button type="button" onClick={() => onNavigate('projects')}>
          {t('projectCoordinatorStartFollowUp')}
        </button>
      </div>
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
  readyUsers: number
  visibleUsers: number
}>

/**
 * Summarises the exact Cloud worker projection without inventing a second presence source.
 * A User is online when at least one of their visible Agents is online, so multiple Devices
 * owned by the same Human never inflate the online member count. Planning readiness uses the
 * same package-owned draft/paused/active predicate as the Plan Worker selector; execution-only
 * operational state remains separate and cannot hide prospective planning candidates.
 */
export function projectCoordinatorWorkerPresenceSummary(
  project: ProjectCoordinatorProject,
  observedAt?: string
): ProjectCoordinatorWorkerPresenceSummary {
  let onlineUsers = 0
  let readyUsers = 0
  for (const group of project.workerGroups) {
    const states = group.agents.map((agent) => projectCoordinatorWorkerPlanningState(
      project,
      agent,
      observedAt
    ))
    if (states.some(({ operational }) => operational.online)) onlineUsers += 1
    if (states.some(({ planning }) => planning.eligible)) readyUsers += 1
  }
  return Object.freeze({
    onlineUsers,
    readyUsers,
    visibleUsers: project.workerGroups.length
  })
}

function projectCoordinatorWorkerPlanningState(
  project: ProjectCoordinatorProject,
  agent: ProjectCoordinatorWorkerAgent,
  observedAt?: string
) {
  const asOf = observedAt ?? agent.projectAvailability.availability.observedAt
  return Object.freeze({
    operational: projectCoordinatorAgentOperationalState(agent, asOf),
    planning: projectCoordinatorPlanningRuntimeReadiness(
      project,
      agent.projectAvailability,
      asOf
    )
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
  observedAt,
  busy,
  onGenerate,
  onEditDraft,
  onSubmitDraft,
  canConfirm,
  currentUserId,
  providerPrincipalFacts,
  initialContentMode,
  initialProviderFactId,
  onInitialContentMode,
  onInitialProviderFactId,
  onConfirm
}: Readonly<{
  project?: ProjectCoordinatorProject
  draft: ProjectCoordinatorPlanDraft | null
  observedAt: string
  busy: boolean
  onGenerate(): void
  onEditDraft(content: Pick<
    ProjectCoordinatorPlanDraftEditInput,
    'tasks' | 'rationale' | 'assignments'
  >): void
  onSubmitDraft(): void
  canConfirm: boolean
  currentUserId: string | null
  providerPrincipalFacts: ProjectCoordinatorWorkspace['providerPrincipalFacts']
  initialContentMode: 'none' | 'required'
  initialProviderFactId: string
  onInitialContentMode(value: 'none' | 'required'): void
  onInitialProviderFactId(value: string): void
  onConfirm(): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const visibleWorkerGroups = project?.workerGroups ?? []
  const awaitingConfirmation = project?.plan?.plan.state === 'awaiting_confirmation'
  const initialMemberUserIds = [...new Set([
    ...(project ? [project.project.ownerUserId] : []),
    ...(project?.plan?.plan.tasks.map(({ workerUserId }) => workerUserId) ?? [])
  ])]
  const ownerProviderFacts = providerPrincipalFacts.filter(({ userId, readiness }) => (
    userId === currentUserId && readiness === 'ready'
  ))
  const selectedOwnerFact = ownerProviderFacts.find(({ providerPrincipalFactId }) => (
    providerPrincipalFactId === initialProviderFactId
  )) ?? ownerProviderFacts[0]
  const planRequiresContent = project?.plan?.plan.tasks.some(({ fileIntent }) => (
    fileIntent !== null
  )) ?? false
  const effectiveContentMode = planRequiresContent ? 'required' : initialContentMode
  const missingInitialProviderFacts = project?.project.status === 'draft' &&
    effectiveContentMode === 'required' && (
      !selectedOwnerFact || initialMemberUserIds.some((userId) => (
        !providerPrincipalFacts.some((fact) => (
          fact.userId === userId &&
          fact.readiness === 'ready' &&
          fact.providerPrincipal.providerInstance.providerInstanceRef ===
            selectedOwnerFact.providerPrincipal.providerInstance.providerInstanceRef
        ))
      ))
    )
  return (
    <Section id="plan" title={t('projectCoordinatorPlan')} icon={<ListChecks className="h-4 w-4" />}>
      {!project ? <Empty /> : awaitingConfirmation ? (
        <div className="space-y-2 rounded border border-amber-500/40 p-2" data-default-visible-card="plan-confirmation">
          <Status value="awaiting_confirmation" />
          <p className="text-[11px] text-ds-muted">{project.plan!.plan.rationale}</p>
          {canConfirm && project.project.status === 'draft' ? (
            <div className="space-y-2 rounded border border-ds-border p-2">
              <label className="block text-xs">
                <span className="text-ds-muted">{t('projectCoordinatorContentMode')}</span>
                <select
                  value={effectiveContentMode}
                  disabled={planRequiresContent}
                  data-content-required-by-plan={planRequiresContent ? 'true' : 'false'}
                  onChange={(event) => onInitialContentMode(
                    event.currentTarget.value as 'none' | 'required'
                  )}
                  className="mt-1 w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                >
                  <option value="none">{t('projectCoordinatorContentModeNone')}</option>
                  <option value="required">{t('projectCoordinatorContentModeTeam')}</option>
                </select>
              </label>
              {effectiveContentMode === 'required' ? (
                <label className="block text-xs">
                  <span className="text-ds-muted">{t('projectCoordinatorProviderInstance')}</span>
                  <select
                    required
                    value={selectedOwnerFact?.providerPrincipalFactId ?? ''}
                    onChange={(event) => onInitialProviderFactId(event.currentTarget.value)}
                    className="mt-1 w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                  >
                    {ownerProviderFacts.length === 0 ? (
                      <option value="">{t('projectCoordinatorCreateProviderFactsMissing')}</option>
                    ) : ownerProviderFacts.map((fact) => (
                      <option key={fact.providerPrincipalFactId} value={fact.providerPrincipalFactId}>
                        {fact.providerPrincipal.providerInstance.providerInstanceRef} · rev {fact.revision}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="text-[11px] text-ds-muted">
                {t('projectCoordinatorWorkerMembers')}: {initialMemberUserIds.join(', ')}
              </p>
              {missingInitialProviderFacts ? (
                <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300" role="status">
                  {t('projectCoordinatorCreateProviderFactsMissing')}
                </p>
              ) : null}
            </div>
          ) : null}
          {canConfirm ? (
            <button type="button" disabled={busy || missingInitialProviderFacts} onClick={onConfirm} className="rounded bg-ds-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {t('projectCoordinatorConfirmPlan')}
            </button>
          ) : null}
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
                  ),
                  dependencyPlanItemIds: splitCommaSeparated(
                    String(values.get(`plan-item-dependencies-${item.planItemId}`) ?? '')
                  ),
                  fileIntent: item.fileIntent !== null &&
                    values.get(`plan-item-file-enabled-${item.planItemId}`) === 'on'
                    ? item.fileIntent
                    : null
                })),
                assignments: draft.assignments.map((assignment) => {
                  const workerUserId = String(
                    values.get(`plan-item-user-${assignment.planItemId}`) ?? ''
                  )
                  return {
                    ...assignment,
                    workerUserId: workerUserId || null,
                    recommendationReason: workerUserId
                      ? t('projectCoordinatorOwnerSelectedWorkerUser')
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
                <input name={`plan-item-dependencies-${item.planItemId}`} defaultValue={item.dependencyPlanItemIds.join(', ')} aria-label={t('projectCoordinatorTaskDependencies')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                <input name={`plan-item-capabilities-${item.planItemId}`} defaultValue={item.requiredCapabilityTags.join(', ')} aria-label={t('projectCoordinatorCapabilityTags')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                {item.fileIntent !== null ? (
                  <label className="flex items-center gap-2 text-xs text-ds-muted">
                    <input
                      type="checkbox"
                      name={`plan-item-file-enabled-${item.planItemId}`}
                      defaultChecked
                    />
                    {t('projectCoordinatorKeepFileDeclaration')}
                  </label>
                ) : null}
                <select
                  name={`plan-item-user-${item.planItemId}`}
                  className="mt-1 w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                  defaultValue={assignment?.workerUserId ?? ''}
                  disabled={busy}
                >
                  <option value="">{t('projectCoordinatorChooseWorkerUser')}</option>
                  {visibleWorkerGroups.map((group) => {
                    const planningEligible = project !== undefined && group.agents.some(({
                      projectAvailability
                    }) => projectCoordinatorPlanningTaskReadiness(
                      project,
                      projectAvailability,
                      item,
                      observedAt
                    ).eligible)
                    return (
                      <option
                        key={group.userId}
                        value={group.userId}
                        disabled={!planningEligible}
                        data-planning-eligible={planningEligible ? 'true' : 'false'}
                      >
                        {group.displayName}
                      </option>
                    )
                  })}
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
            disabled={busy || draft.assignments.some(({ workerUserId }) => workerUserId === null)}
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
            return (
            <div key={item.planItemId} className="rounded border border-ds-border p-2">
              <div className="font-medium">{item.title}</div>
              <p className="mt-1 text-[11px] text-ds-muted">{item.objective}</p>
              <div className="mt-1 text-[10px] text-ds-faint">
                {t('projectCoordinatorWorkerUser')}: {
                  visibleWorkerGroups.find(({ userId }) => userId === item.workerUserId)?.displayName ??
                  item.workerUserId
                }
              </div>
            </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

export function WorkersSection({
  project,
  observedAt
}: Readonly<{
  project?: ProjectCoordinatorProject
  observedAt?: string
}>): ReactElement {
  const { t } = useTranslation('common')
  const asOf = observedAt ?? project?.workerGroups[0]?.agents[0]
    ?.projectAvailability.availability.observedAt
  const presence = project ? projectCoordinatorWorkerPresenceSummary(project, asOf) : undefined
  return (
    <Section id="workers" title={t('projectCoordinatorWorkers')} icon={<UsersRound className="h-4 w-4" />}>
      {!project?.workerGroups.length ? (
        <Empty message={project ? t('projectCoordinatorNoWorkers') : undefined} />
      ) : (
        <div className="project-coordinator-workers">
          <div
            className="project-coordinator-presence-summary"
            data-project-online-users={presence?.onlineUsers}
            data-project-visible-users={presence?.visibleUsers}
            data-project-ready-users={presence?.readyUsers}
          >
            <div className="project-coordinator-presence-primary">
              <span className="project-coordinator-presence-pulse" aria-hidden="true" />
              <span>
                <strong>
                  {t('projectCoordinatorOnlineMembers', {
                    online: presence?.onlineUsers,
                    total: presence?.visibleUsers
                  })}
                </strong>
                <small>{t('projectCoordinatorPresenceSource')}</small>
              </span>
            </div>
            <div className="project-coordinator-presence-numbers">
              <span>
                <strong>{presence?.readyUsers}/{presence?.visibleUsers}</strong>
                {t('projectCoordinatorWorkerUsersReadyShort')}
              </span>
            </div>
          </div>

          <div className="project-coordinator-member-list">
            {project.workerGroups.map((group) => {
              const states = group.agents.map((agent) => projectCoordinatorWorkerPlanningState(
                project,
                agent,
                asOf
              ))
              const groupOnline = states.some(({ operational }) => operational.online)
              const groupReady = states.some(({ planning }) => planning.eligible)
              const membership = group.agents.find(({ projectAvailability }) => (
                projectAvailability.membership !== null
              ))?.projectAvailability.membership
              return (
                <article
                  key={group.userId}
                  className="project-coordinator-member"
                  data-member-online={groupOnline ? 'true' : 'false'}
                  data-member-ready={groupReady ? 'true' : 'false'}
                >
                  <header>
                    <span className="project-coordinator-member-avatar" data-online={groupOnline ? 'true' : 'false'}>
                      {initials(group.displayName)}
                    </span>
                    <span className="project-coordinator-member-name">
                      <strong>{group.displayName}</strong>
                      <code title={group.userId}>{shortIdentifier(group.userId)}</code>
                    </span>
                    <Status value={membership?.state ?? 'not_member'} />
                    <Status value={groupReady ? 'ready' : groupOnline ? 'online' : 'offline'} />
                  </header>

                </article>
              )
            })}
          </div>
        </div>
      )}
    </Section>
  )
}

export function TasksSection({
  project,
  observedAt,
  canReassign = false,
  busy = false,
  onReassign
}: Readonly<{
  project?: ProjectCoordinatorProject
  observedAt?: string
  canReassign?: boolean
  busy?: boolean
  onReassign?(input: ProjectCoordinatorTaskOfferReassignInput): void
}>): ReactElement {
  const { t } = useTranslation('common')
  const defaultOfferExpiresAt = new Date(
    Date.now() + DEFAULT_TASK_OFFER_TTL_MS
  ).toISOString()
  const queue = project ? {
    active: project.tasks.filter(({ task }) => (
      task.status === 'offered' || task.status === 'in_progress'
    )).length,
    review: project.tasks.filter(({ task }) => task.status === 'awaiting_review').length,
    attention: project.tasks.filter(({ task }) => (
      task.status === 'needs_human' ||
      task.status === 'revision_requested' ||
      task.status === 'manual_recovery_required' ||
      task.status === 'failed'
    )).length,
    completed: project.tasks.filter(({ task }) => task.status === 'completed').length
  } : undefined
  return (
    <Section id="tasks" title={t('projectCoordinatorTasks')} icon={<FileCheck2 className="h-4 w-4" />}>
      {!project?.tasks.length ? <Empty message={project ? t('projectCoordinatorNoTasks') : undefined} /> : (
        <div className="project-coordinator-tasks">
          <div className="project-coordinator-task-queue" aria-label={t('projectCoordinatorTaskQueue')}>
            <span data-queue-state="active">
              <Activity aria-hidden="true" />
              <strong>{queue?.active}</strong>
              {t('projectCoordinatorQueueActive')}
            </span>
            <span data-queue-state="review">
              <ClipboardCheck aria-hidden="true" />
              <strong>{queue?.review}</strong>
              {t('projectCoordinatorQueueReview')}
            </span>
            <span data-queue-state="attention">
              <AlertCircle aria-hidden="true" />
              <strong>{queue?.attention}</strong>
              {t('projectCoordinatorQueueAttention')}
            </span>
            <span data-queue-state="complete">
              <Check aria-hidden="true" />
              <strong>{queue?.completed}</strong>
              {t('projectCoordinatorQueueComplete')}
            </span>
          </div>
          <div className="project-coordinator-task-list">
            {project.tasks.map((taskView) => {
              const task = taskView.task
              const execution = task.currentExecutionId
                ? taskView.executions.find(({ executionId }) => executionId === task.currentExecutionId)
                : undefined
              const pendingOffer = execution ? undefined : project.offers.find((offer) => (
                offer.taskId === task.taskId &&
                offer.state === 'pending' &&
                offer.executionId === null
              ))
              const claimedOffer = execution ? project.offers.find((offer) => (
                offer.taskId === task.taskId &&
                offer.state === 'accepted' &&
                offer.executionId === execution.executionId
              )) : undefined
              const reassignableOffer = projectCoordinatorReassignableTaskOffer(
                project,
                taskView
              )
              const candidateWorkerGroups = reassignableOffer
                ? project.workerGroups.filter((group) => group.agents.some((agent) => (
                    projectCoordinatorTaskRequirementReadiness(
                      project,
                      agent.projectAvailability,
                      task,
                      observedAt ?? task.updatedAt
                    ).eligible
                  )))
                : []
              const workerUserId = execution?.assigneeUserId ?? pendingOffer?.workerUserId
              const workerUser = workerUserId
                ? project.memberUsers.find(({ userId }) => userId === workerUserId) ??
                  project.workerGroups.find(({ userId }) => userId === workerUserId)
                : undefined
              const workerAgent = execution ? project.workerGroups.flatMap(({ agents }) => agents).find(
                ({ projectAvailability }) => (
                  projectAvailability.agentId === execution.assigneeAgentId
                )
              ) : undefined
              const assignmentState = execution
                ? 'claimed'
                : pendingOffer
                  ? 'awaiting-claim'
                  : 'not-published'
              const workerUserLabel = workerUser?.displayName ?? (
                workerUserId ? shortIdentifier(workerUserId) : null
              )
              const assignmentLabel = assignmentState === 'claimed'
                ? `${workerUserLabel ?? shortIdentifier(execution!.assigneeUserId)} · ${
                    workerAgent?.displayName ?? shortIdentifier(execution!.assigneeAgentId)
                  }`
                : assignmentState === 'awaiting-claim'
                  ? `${workerUserLabel ?? shortIdentifier(pendingOffer!.workerUserId)} · ${
                      t('projectCoordinatorAwaitingDeviceClaim')
                    }`
                  : t('projectCoordinatorNotPublished')
              return (
                <article
                  key={task.taskId}
                  className="project-coordinator-task"
                  data-task-status={task.status}
                  data-task-assignment-state={assignmentState}
                >
                  <span className="project-coordinator-task-signal" aria-hidden="true" />
                  <div className="project-coordinator-task-heading">
                    <span className="project-coordinator-task-kind" aria-hidden="true">
                      {task.fileIntent ? <FileText /> : <ListChecks />}
                    </span>
                    <span>
                      <strong>{task.title}</strong>
                      <small>{task.objective}</small>
                    </span>
                    <Status value={task.status} />
                  </div>
                  <dl className="project-coordinator-task-meta">
                    <div>
                      <dt>{t('projectCoordinatorAssignment')}</dt>
                      <dd>{assignmentLabel}</dd>
                    </div>
                    <div>
                      <dt>{t('projectCoordinatorExecution')}</dt>
                      <dd>{execution
                        ? `${t('projectCoordinatorAttempt', { count: execution.attempt })} · ${execution.state.replaceAll('_', ' ')}`
                        : '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('projectCoordinatorTaskType')}</dt>
                      <dd>{t(task.fileIntent
                        ? 'projectCoordinatorFileTask'
                        : 'projectCoordinatorTextTask')}</dd>
                    </div>
                  </dl>
                  <details className="project-coordinator-task-details">
                    <summary>{t('projectCoordinatorTaskDetails')}</summary>
                    <div>
                      <strong>{t('projectCoordinatorCompletionCriteria')}</strong>
                      <ul>
                        {task.completionCriteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                      <dl>
                        <dt>Task</dt>
                        <dd>{task.taskId}</dd>
                        {execution ? (
                          <>
                            <dt>Execution</dt>
                            <dd>{execution.executionId}</dd>
                            <dt>Agent</dt>
                            <dd>{execution.assigneeAgentId}</dd>
                          </>
                        ) : null}
                        {pendingOffer ? (
                          <>
                            <dt>Offer</dt>
                            <dd>{pendingOffer.taskOfferId}</dd>
                            <dt>Worker User</dt>
                            <dd>{pendingOffer.workerUserId}</dd>
                          </>
                        ) : null}
                        {claimedOffer ? (
                          <>
                            <dt>Offer</dt>
                            <dd>{claimedOffer.taskOfferId}</dd>
                          </>
                        ) : null}
                      </dl>
                    </div>
                  </details>
                  {canReassign && onReassign && reassignableOffer ? (
                    <form
                      className="space-y-2 rounded border border-amber-500/40 p-2"
                      data-task-offer-reassignment={task.taskId}
                      onSubmit={(event) => {
                        event.preventDefault()
                        const values = new FormData(event.currentTarget)
                        onReassign({
                          projectId: project.project.projectId,
                          taskId: task.taskId,
                          previousTaskOfferId: reassignableOffer.taskOfferId,
                          workerUserId: String(values.get('reassign-worker-user') ?? ''),
                          offerExpiresAt: String(
                            values.get('reassign-offer-expires-at') ?? ''
                          ).trim() || new Date(
                            Date.now() + DEFAULT_TASK_OFFER_TTL_MS
                          ).toISOString(),
                          nextOutputFileName: task.fileIntent === null
                            ? null
                            : String(values.get('reassign-output-file-name') ?? '')
                        })
                      }}
                    >
                      <select
                        required
                        name="reassign-worker-user"
                        defaultValue=""
                        aria-label={t('projectCoordinatorNextWorkerUser')}
                        className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                      >
                        <option value="">{t('projectCoordinatorChooseWorkerUser')}</option>
                        {candidateWorkerGroups.map((group) => (
                          <option key={group.userId} value={group.userId}>
                            {group.displayName}
                          </option>
                        ))}
                      </select>
                      {task.fileIntent ? (
                        <input
                          required
                          name="reassign-output-file-name"
                          aria-label={t('projectCoordinatorNextOutputFileName')}
                          placeholder={t('projectCoordinatorNextOutputFileName')}
                          className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                        />
                      ) : null}
                      <input
                        name="reassign-offer-expires-at"
                        placeholder={defaultOfferExpiresAt}
                        aria-label={t('projectCoordinatorOfferExpiresAt')}
                        className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={busy || candidateWorkerGroups.length === 0}
                        className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50"
                      >
                        {t('projectCoordinatorReassignTask')}
                      </button>
                    </form>
                  ) : null}
                </article>
              )
            })}
          </div>
        </div>
      )}
    </Section>
  )
}

export function projectCoordinatorReassignableTaskOffer(
  project: ProjectCoordinatorProject,
  taskView: ProjectCoordinatorProject['tasks'][number]
): ProjectCoordinatorProject['offers'][number] | null {
  const task = taskView.task
  if (project.project.status !== 'active' ||
      task.status !== 'revision_requested' ||
      task.executionCount >= task.maxRetries + 1) return null
  if (task.currentExecutionId === null) {
    const currentOffers = project.offers.filter((offer) => (
      offer.taskId === task.taskId &&
      offer.executionId === null &&
      ['rejected', 'withdrawn', 'timed_out'].includes(offer.state) &&
      offer.reassignmentTaskRevision === task.revision
    ))
    return currentOffers.length === 1 ? currentOffers[0]! : null
  }
  const execution = taskView.executions.find(({ executionId }) => (
    executionId === task.currentExecutionId
  ))
  if (!execution || task.currentExecutionState !== execution.state ||
      !['failed', 'cancelled', 'revoked'].includes(execution.state) ||
      execution.fence.status !== 'fenced') return null
  return project.offers.find((offer) => (
    offer.taskId === task.taskId &&
    offer.executionId === execution.executionId &&
    offer.state === 'accepted'
  )) ?? null
}

function projectCoordinatorUserDisplayName(
  project: ProjectCoordinatorProject,
  userId: string
): string {
  return project.memberUsers.find((user) => user.userId === userId)?.displayName ??
    project.workerGroups.find((group) => group.userId === userId)?.displayName ??
    shortIdentifier(userId)
}

function projectCoordinatorAgentDisplayName(
  project: ProjectCoordinatorProject,
  agentId: string
): string {
  return project.workerGroups.flatMap(({ agents }) => agents).find(({ projectAvailability }) => (
    projectAvailability.agentId === agentId
  ))?.displayName ?? shortIdentifier(agentId)
}

function projectCoordinatorUserRoleMessageKey(
  project: ProjectCoordinatorProject,
  userId: string
): string {
  if (userId === project.project.ownerUserId) return 'projectCoordinatorCoordinatorShort'
  if (
    project.plan?.plan.tasks.some(({ workerUserId }) => workerUserId === userId) ||
    project.tasks.some(({ executions }) => executions.some(({ assigneeUserId }) => (
      assigneeUserId === userId
    )))
  ) return 'projectCoordinatorWorkerUser'
  return 'projectCoordinatorMemberUser'
}

export function ProjectCoordinatorDecisionSection({
  project,
  currentUserId,
  sessionBinding,
  busy,
  onCreateHumanNeeded,
  onAnswerHumanNeeded,
  onOpenArtifact,
  onReviewResult,
  onComplete
}: Readonly<{
  project?: ProjectCoordinatorProject
  currentUserId: string | null
  sessionBinding: ProjectCoordinatorSessionBinding | null
  busy: boolean
  onCreateHumanNeeded(input: ProjectCoordinatorHumanNeededCreateInput): void
  onAnswerHumanNeeded(input: ProjectCoordinatorHumanAnswerInput): void
  onOpenArtifact?: (input: ProjectCoordinatorArtifactReviewPrepareInput) => void
  onReviewResult(input: ProjectCoordinatorResultReviewInput): void
  onComplete(input: ProjectCoordinatorCompleteInput): void
}>): ReactElement {
  const { i18n, t } = useTranslation('common')
  const pendingReviews = project?.reviews.filter(({ decision }) => decision === null) ?? []
  const decidedReviews = project?.reviews.filter(({ decision }) => decision !== null) ?? []
  const sessionAccess = project
    ? projectCoordinatorEffectiveSessionAccess(project, currentUserId, sessionBinding)
    : 'read_only'
  const canCoordinate = sessionAccess === 'coordinator'
  const canActAsMember = sessionAccess !== 'read_only'
  const acceptedCurrentResults = project ? acceptedCurrentResultIds(project) : null
  const targetUsers = project?.memberUsers.filter((user) => (
    user.status === 'active' && project.provisioning.memberships.some((membership) => (
      membership.userId === user.userId && membership.state === 'active'
    ))
  )) ?? []
  const mayAskMember = project?.project.status === 'active' &&
    acceptedCurrentResults !== null &&
    !project.records.some(({ kind }) => kind === 'decision') &&
    project.pendingHumanNeeded.length === 0 &&
    targetUsers.length > 0
  const completionInput = project ? projectCoordinatorCompletionInput(project, '') : null
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  return (
    <Section id="reviews" title={t('projectCoordinatorReviews')} icon={<ClipboardCheck className="h-4 w-4" />}>
      {!project ? <Empty /> : (
        <div className="space-y-2 text-xs">
          {project.pendingHumanNeeded.map((request) => {
            const targetsCurrentUser = request.targetUserId === currentUserId
            const canAnswer = targetsCurrentUser && canActAsMember
            const targetName = projectCoordinatorUserDisplayName(project, request.targetUserId)
            const requesterName = projectCoordinatorAgentDisplayName(
              project,
              request.requestedByAgentId
            )
            const answerState = canAnswer
              ? 'actionable'
              : targetsCurrentUser
                ? 'read-only'
                : 'waiting-other'
            return <article
              key={request.humanRequestId}
              className="space-y-2 rounded border border-amber-500/40 p-2"
              data-default-visible-card="human-needed"
              data-human-answer-state={answerState}
              role={canAnswer ? 'alert' : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <Status value="human_needed" />
                <strong className="text-[11px]">
                  {canAnswer
                    ? t('projectCoordinatorWaitingForYourAnswer')
                    : targetsCurrentUser
                      ? t('projectCoordinatorAnswerRequiresActiveSession')
                      : t('projectCoordinatorWaitingForUserAnswer', { name: targetName })}
                </strong>
              </div>
              <dl className="grid gap-1 text-[11px] text-ds-muted">
                <div className="flex justify-between gap-2">
                  <dt>{t('projectCoordinatorQuestionFrom')}</dt>
                  <dd className="text-right">
                    {requesterName} · {t(request.context.scope === 'worker_execution'
                      ? 'projectCoordinatorWorkerUser'
                      : 'projectCoordinatorCoordinatorShort')}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{t('projectCoordinatorAnswerOwner')}</dt>
                  <dd className="text-right">
                    {targetName} · {t(projectCoordinatorUserRoleMessageKey(
                      project,
                      request.targetUserId
                    ))}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{t('projectCoordinatorAnswerDeadline')}</dt>
                  <dd>
                    <time dateTime={request.expiresAt}>
                      {formatProjectCoordinatorDateTime(
                        request.expiresAt,
                        i18n.resolvedLanguage
                      )}
                    </time>
                  </dd>
                </div>
              </dl>
              <p className="whitespace-pre-wrap text-[11px] text-ds-muted">{request.prompt}</p>
              {canAnswer ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const values = new FormData(event.currentTarget)
                    const decision = projectCoordinatorSubmitDecision(
                      (event.nativeEvent as SubmitEvent).submitter
                    )
                    onAnswerHumanNeeded({
                      projectId: request.projectId,
                      humanRequestId: request.humanRequestId,
                      requestRevision: request.revision,
                      answer: String(values.get('answer') ?? ''),
                      ...(decision === 'approve' || decision === 'reject'
                        ? { decision }
                        : {})
                    })
                  }}
                >
                  <textarea required name="answer" disabled={busy} aria-label={t('projectCoordinatorHumanAnswer')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                  {request.confirmableAction ? (
                    <div className="flex gap-2">
                      <button name="decision" value="approve" type="submit" disabled={busy} className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50">{t('projectCoordinatorApprove')}</button>
                      <button name="decision" value="reject" type="submit" disabled={busy} className="rounded border border-ds-border px-2 py-1 disabled:opacity-50">{t('projectCoordinatorReject')}</button>
                    </div>
                  ) : (
                    <button type="submit" disabled={busy} className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50">{t('projectCoordinatorSubmitHumanAnswer')}</button>
                  )}
                </form>
              ) : null}
            </article>
          })}
          {pendingReviews.map((review) => (
            <article
              key={review.submission.resultSubmissionId}
              className="space-y-2 rounded border border-amber-500/40 p-2"
              data-default-visible-card="result-review"
              data-result-review-access={canCoordinate ? 'coordinator' : 'read-only'}
              role={canCoordinate ? 'alert' : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <span>
                  <strong className="block text-[11px]">
                    {t('projectCoordinatorWorkerResult')}
                  </strong>
                  <span className="break-all font-mono text-[10px]">
                    {review.submission.taskId}
                  </span>
                </span>
                <Status value="awaiting_review" />
              </div>
              <dl className="grid gap-1 text-[11px] text-ds-muted">
                <div className="flex justify-between gap-2">
                  <dt>{t('projectCoordinatorSubmittedBy')}</dt>
                  <dd>{projectCoordinatorUserDisplayName(
                    project,
                    review.submission.submittedByUserId
                  )}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{t('projectCoordinatorSubmittedAt')}</dt>
                  <dd>
                    <time dateTime={review.submission.submittedAt}>
                      {formatProjectCoordinatorDateTime(
                        review.submission.submittedAt,
                        i18n.resolvedLanguage
                      )}
                    </time>
                  </dd>
                </div>
              </dl>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-ds-muted">
                {review.submission.summary}
              </p>
              {canCoordinate ? (
                <p className="rounded bg-ds-subtle px-2 py-1.5 text-[11px] font-medium">
                  {t('projectCoordinatorWaitingForYourReview')}
                </p>
              ) : null}
              {review.submission.outputs.length > 0 ? (
                <div className="space-y-1" data-artifact-review-list="true">
                  {review.submission.outputs.map((output, outputIndex) => (
                    <button
                      key={`${output.locatorDigest}:${outputIndex}`}
                      type="button"
                      disabled={!canCoordinate || busy || !onOpenArtifact}
                      data-artifact-review-output={outputIndex}
                      className="flex w-full items-center justify-between gap-2 rounded border border-ds-border px-2 py-1.5 text-left disabled:opacity-50"
                      onClick={() => {
                        if (!canCoordinate) return
                        onOpenArtifact?.({
                          projectId: review.submission.projectId,
                          taskId: review.submission.taskId,
                          executionId: review.submission.executionId,
                          resultSubmissionId: review.submission.resultSubmissionId,
                          submissionDigest: review.submission.submissionDigest,
                          outputIndex,
                          locatorDigest: output.locatorDigest
                        })
                      }}
                    >
                      <span>{t('projectCoordinatorOpenArtifactInContentSpace')}</span>
                      <span className="max-w-[11rem] truncate font-mono text-[10px] text-ds-faint">
                        {output.locatorDigest}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {canCoordinate ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const values = new FormData(event.currentTarget)
                    const decision = projectCoordinatorSubmitDecision(
                      (event.nativeEvent as SubmitEvent).submitter
                    )
                    const workerUserId = String(values.get('next-user') ?? '')
                    const localOfferExpiry = projectCoordinatorIsoFromLocalDateTime(
                      String(values.get('offer-expires-at') ?? '')
                    )
                    const input = projectCoordinatorResultReviewInput(
                      project,
                      review.submission.resultSubmissionId,
                      decision === 'accept' ? 'accept' : 'request_revision',
                      {
                        instruction: String(values.get('instruction') ?? ''),
                        nextWorkerUserId: workerUserId,
                        nextOfferExpiresAt: localOfferExpiry || new Date(
                          Date.now() + DEFAULT_TASK_OFFER_TTL_MS
                        ).toISOString(),
                        nextOutputFileName: String(
                          values.get('next-output-file-name') ?? ''
                        )
                      }
                    )
                    if (input) onReviewResult(input)
                  }}
                >
                  <textarea required name="instruction" aria-label={t('projectCoordinatorRevisionInstruction')} placeholder={t('projectCoordinatorRevisionInstruction')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
                  <select required name="next-user" defaultValue="" aria-label={t('projectCoordinatorNextWorkerUser')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs">
                    <option value="">{t('projectCoordinatorChooseWorkerUser')}</option>
                    {project.workerGroups.map((group) => (
                      <option key={group.userId} value={group.userId}>
                        {group.displayName}
                      </option>
                    ))}
                  </select>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-ds-muted">
                      {t('projectCoordinatorOfferExpiresAtLocal', { timeZone })}
                    </span>
                    <input
                      type="datetime-local"
                      name="offer-expires-at"
                      aria-label={t('projectCoordinatorOfferExpiresAtLocal', { timeZone })}
                      className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                    />
                  </label>
                  {project.tasks.find(({ task }) => (
                    task.taskId === review.submission.taskId
                  ))?.task.fileIntent ? (
                    <input
                      required
                      name="next-output-file-name"
                      aria-label={t('projectCoordinatorNextOutputFileName')}
                      placeholder={t('projectCoordinatorNextOutputFileName')}
                      className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                    />
                  ) : null}
                  <div className="flex gap-2">
                    <button formNoValidate name="decision" value="accept" type="submit" disabled={busy} className="rounded bg-ds-accent px-2 py-1 text-white disabled:opacity-50">{t('projectCoordinatorAcceptResult')}</button>
                    <button name="decision" value="request_revision" type="submit" disabled={busy} className="rounded border border-ds-border px-2 py-1 disabled:opacity-50">{t('projectCoordinatorRequestRevision')}</button>
                  </div>
                </form>
              ) : (
                <p className="rounded bg-ds-subtle px-2 py-1.5 text-[11px] text-ds-muted">
                  {t('projectCoordinatorWaitingForCoordinatorReview', {
                    name: projectCoordinatorUserDisplayName(
                      project,
                      project.project.ownerUserId
                    )
                  })}
                </p>
              )}
            </article>
          ))}
          {decidedReviews.length > 0 ? (
            <section className="space-y-2" data-review-history="true">
              <strong className="text-xs">{t('projectCoordinatorReviewHistory')}</strong>
              {decidedReviews.map((review) => {
                const decision = review.decision!
                const nextOffer = decision.nextTaskOfferId
                  ? project.offers.find(({ taskOfferId }) => (
                      taskOfferId === decision.nextTaskOfferId
                    ))
                  : undefined
                return (
                  <article
                    key={decision.reviewDecisionId}
                    className="space-y-2 rounded border border-ds-border p-2"
                    data-review-history-decision={decision.decision}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <strong className="block text-[11px]">
                          {t('projectCoordinatorReviewDecision')}
                        </strong>
                        <span className="break-all font-mono text-[10px]">
                          {review.submission.taskId}
                        </span>
                      </span>
                      <Status value={decision.decision === 'accept'
                        ? 'accepted'
                        : 'revision_requested'} />
                    </div>
                    <div className="rounded bg-ds-subtle px-2 py-1.5">
                      <strong className="text-[11px]">
                        {t('projectCoordinatorWorkerResult')}
                      </strong>
                      <p className="mt-1 whitespace-pre-wrap text-[11px] text-ds-muted">
                        {review.submission.summary}
                      </p>
                    </div>
                    <dl className="grid gap-1 text-[11px] text-ds-muted">
                      <div className="flex justify-between gap-2">
                        <dt>{t('projectCoordinatorSubmittedBy')}</dt>
                        <dd>{projectCoordinatorUserDisplayName(
                          project,
                          review.submission.submittedByUserId
                        )}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t('projectCoordinatorSubmittedAt')}</dt>
                        <dd>
                          <time dateTime={review.submission.submittedAt}>
                            {formatProjectCoordinatorDateTime(
                              review.submission.submittedAt,
                              i18n.resolvedLanguage
                            )}
                          </time>
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t('projectCoordinatorReviewedBy')}</dt>
                        <dd>
                          {projectCoordinatorUserDisplayName(
                            project,
                            decision.decidedByUserId
                          )} · {t('projectCoordinatorCoordinatorShort')}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t('projectCoordinatorReviewedAt')}</dt>
                        <dd>
                          <time dateTime={decision.decidedAt}>
                            {formatProjectCoordinatorDateTime(
                              decision.decidedAt,
                              i18n.resolvedLanguage
                            )}
                          </time>
                        </dd>
                      </div>
                    </dl>
                    {decision.instruction ? (
                      <div className="rounded border border-amber-500/30 px-2 py-1.5">
                        <strong className="text-[11px]">
                          {t('projectCoordinatorRevisionInstruction')}
                        </strong>
                        <p className="mt-1 whitespace-pre-wrap text-[11px] text-ds-muted">
                          {decision.instruction}
                        </p>
                      </div>
                    ) : null}
                    {decision.acceptedProjectRecordId ? (
                      <dl className="text-[11px] text-ds-muted">
                        <dt>{t('projectCoordinatorAcceptedRecord')}</dt>
                        <dd className="break-all font-mono text-[10px]">
                          {decision.acceptedProjectRecordId}
                        </dd>
                      </dl>
                    ) : null}
                    {nextOffer ? (
                      <dl className="grid gap-1 text-[11px] text-ds-muted">
                        <div className="flex justify-between gap-2">
                          <dt>{t('projectCoordinatorNextWorkerUser')}</dt>
                          <dd>{projectCoordinatorUserDisplayName(
                            project,
                            nextOffer.workerUserId
                          )}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>{t('projectCoordinatorOfferAcceptanceDeadline')}</dt>
                          <dd>
                            <time dateTime={nextOffer.expiresAt}>
                              {formatProjectCoordinatorDateTime(
                                nextOffer.expiresAt,
                                i18n.resolvedLanguage
                              )}
                            </time>
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                  </article>
                )
              })}
            </section>
          ) : null}
          {canCoordinate && mayAskMember ? (
            <form
              className="space-y-2 rounded border border-ds-border p-2"
              data-default-visible-card="human-needed-create"
              onSubmit={(event) => {
                event.preventDefault()
                const values = new FormData(event.currentTarget)
                onCreateHumanNeeded({
                  projectId: project.project.projectId,
                  targetUserId: String(values.get('target-user') ?? ''),
                  expectedProjectRevision: project.project.revision,
                  expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
                  requiredAssurance: 'verified',
                  prompt: String(values.get('prompt') ?? ''),
                  expiresAt: projectCoordinatorIsoFromLocalDateTime(
                    String(values.get('expires-at') ?? '')
                  )
                })
              }}
            >
              <select required name="target-user" defaultValue="" aria-label={t('projectCoordinatorHumanTargetUser')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs">
                <option value="">{t('projectCoordinatorChooseHumanTargetUser')}</option>
                {targetUsers.map((user) => (
                  <option key={user.userId} value={user.userId}>{user.displayName}</option>
                ))}
              </select>
              <textarea required name="prompt" aria-label={t('projectCoordinatorHumanPrompt')} placeholder={t('projectCoordinatorHumanPrompt')} className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs" />
              <label className="block space-y-1">
                <span className="text-[11px] text-ds-muted">
                  {t('projectCoordinatorHumanExpiresAtLocal', { timeZone })}
                </span>
                <input
                  required
                  type="datetime-local"
                  name="expires-at"
                  aria-label={t('projectCoordinatorHumanExpiresAtLocal', { timeZone })}
                  className="w-full rounded border border-ds-border bg-ds-bg px-2 py-1.5 text-xs"
                />
              </label>
              <button type="submit" disabled={busy} className="rounded border border-ds-border px-2 py-1 disabled:opacity-50">{t('projectCoordinatorAskMember')}</button>
            </form>
          ) : null}
          {canCoordinate && completionInput ? (
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
            <div className="space-y-2 rounded border border-ds-border p-2" data-default-visible-card="final-summary">
              <div className="flex items-center justify-between gap-2">
                <strong>{t('projectCoordinatorFinalSummary')}</strong>
                <Status value="completed" />
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-ds-muted">{project.finalSummary.summary}</p>
              <dl className="grid gap-1 text-[11px] text-ds-muted">
                <div className="flex justify-between gap-2">
                  <dt>{t('projectCoordinatorCompletedBy')}</dt>
                  <dd>{projectCoordinatorUserDisplayName(
                    project,
                    project.finalSummary.createdByUserId
                  )} · {t('projectCoordinatorCoordinatorShort')}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{t('projectCoordinatorCompletedAt')}</dt>
                  <dd>
                    <time dateTime={project.finalSummary.completedAt}>
                      {formatProjectCoordinatorDateTime(
                        project.finalSummary.completedAt,
                        i18n.resolvedLanguage
                      )}
                    </time>
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
          {project.pendingHumanNeeded.length === 0 && pendingReviews.length === 0 &&
            decidedReviews.length === 0 && !(canCoordinate && mayAskMember) &&
            !(canCoordinate && completionInput) && !project.finalSummary ? (
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
    nextWorkerUserId: string
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
  const nextWorker = project.workerGroups.find(({ userId }) => userId === revision.nextWorkerUserId)
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
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  } : revision.instruction.trim() && nextWorker && revision.nextOfferExpiresAt &&
      nextFileIntent !== undefined ? {
        ...base,
        decision,
        instruction: revision.instruction,
        nextWorkerUserId: revision.nextWorkerUserId,
        nextOfferExpiresAt: revision.nextOfferExpiresAt,
        nextFileIntent
      } : null
}

export function projectCoordinatorSubmitDecision(submitter: unknown): string {
  if (!submitter || typeof submitter !== 'object') return ''
  const candidate = submitter as Readonly<{ name?: unknown; value?: unknown }>
  return candidate.name === 'decision' && typeof candidate.value === 'string'
    ? candidate.value
    : ''
}

export function projectCoordinatorCompletionInput(
  project: ProjectCoordinatorProject,
  summary: string
): ProjectCoordinatorCompleteInput | null {
  if (
    project.project.status !== 'active' ||
    project.finalSummary !== null ||
    project.plan?.plan.state !== 'confirmed'
  ) return null
  const acceptedResultSubmissionIds = acceptedCurrentResultIds(project)
  if (
    acceptedResultSubmissionIds === null ||
    acceptedResultSubmissionIds.some((resultSubmissionId) => (
      !project.records.some((record) => (
        record.kind === 'observation' &&
        record.sourceResultSubmissionId === resultSubmissionId
      ))
    ))
  ) return null
  return {
    projectId: project.project.projectId,
    expectedProjectRevision: project.project.revision,
    expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
    projectPlanId: project.plan.plan.projectPlanId,
    confirmedPlanRevision: project.plan.plan.planRevision,
    acceptedResultSubmissionIds,
    summary: summary || project.project.goal
  }
}

function acceptedCurrentResultIds(project: ProjectCoordinatorProject): string[] | null {
  const plan = project.plan?.plan
  if (!plan || plan.tasks.length === 0) return null
  const canonicalTaskIds = plan.tasks.map(({ planItemId }) => (
    canonicalTaskIdForPlanItem(plan.projectPlanId, planItemId)
  ))
  if (new Set(canonicalTaskIds).size !== plan.tasks.length) return null
  const tasksById = new Map(project.tasks.map((taskView) => [taskView.task.taskId, taskView]))
  const currentPlanTasks = canonicalTaskIds.map((taskId) => tasksById.get(taskId))
  if (currentPlanTasks.some((taskView) => taskView === undefined)) return null
  const resultSubmissionIds = currentPlanTasks.map((taskView) => {
    const task = taskView!.task
    if (task.status !== 'completed') return undefined
    return project.reviews.find(({ submission, decision }) => (
      submission.taskId === task.taskId &&
      submission.executionId === task.currentExecutionId &&
      decision?.decision === 'accept'
    ))?.submission.resultSubmissionId
  })
  return resultSubmissionIds.some((id) => id === undefined)
    ? null
    : resultSubmissionIds as string[]
}

export function ProjectCoordinatorProvisioningSection({
  project,
  plan,
  currentUserId,
  canManage = true,
  busy,
  onPrepareWorkflow,
  onContinueWorkflow,
  onAddMember,
  onAcceptInvitation,
  onRemoveMember,
  onObserveAndLinkRecovery,
  onAbandonRecovery
}: Readonly<{
  project?: ProjectCoordinatorProject
  plan: ProjectCoordinatorWorkflowPlan | null
  currentUserId: string | null
  canManage?: boolean
  busy: boolean
  onPrepareWorkflow(): void
  onContinueWorkflow(plan: ProjectCoordinatorWorkflowPlan): void
  onAddMember(input: ProjectCoordinatorMembershipAddInput): void
  onAcceptInvitation(input: ProjectCoordinatorMembershipAcceptInput): void
  onRemoveMember(input: ProjectCoordinatorMembershipRemoveInput): void
  onObserveAndLinkRecovery(input: ProjectCoordinatorContentRecoveryObserveLinkInput): void
  onAbandonRecovery(input: ProjectCoordinatorContentRecoveryAbandonInput): void
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
  const invitationsPending = memberships.some(({ state }) => state === 'invited')
  const confirmedPlan = project?.plan?.plan.state === 'confirmed'
  const pendingTeamIntent = project?.project.contentMode === 'required' &&
    provisioning?.intent !== null && provisioning?.intent !== undefined &&
    !['completed', 'superseded', 'cancelled'].includes(provisioning.intent.state)
  const workflowAvailable = confirmedPlan && !invitationsPending && (
    project?.project.status === 'paused' ||
    (project?.project.status === 'active' && pendingTeamIntent)
  )

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
                  onClick={onPrepareWorkflow}
                  className="rounded border border-ds-border px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorPrepareReconcileWorkflow')}
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
            </div>
          ) : null}

          {canManage && workflowAvailable && !plan ? (
            <div
              className="space-y-2 rounded border border-ds-border bg-ds-bg p-2"
              data-default-visible-card="project-workflow"
            >
              <p className="text-[11px] text-ds-muted">
                {t('projectCoordinatorWorkflowReviewRequired')}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={onPrepareWorkflow}
                className="rounded bg-ds-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorPrepareWorkflow')}
              </button>
            </div>
          ) : null}

          {canManage && confirmedPlan && invitationsPending ? (
            <div
              className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"
              data-default-visible-card="project-workflow-waiting-invitations"
              role="status"
            >
              {t('projectCoordinatorWorkflowWaitingForInvitations')}
            </div>
          ) : null}

          {plan ? (
            <div
              className="space-y-2 rounded border border-ds-border bg-ds-bg p-2"
              data-default-visible-card="project-workflow-confirmation"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t('projectCoordinatorWorkflowFullPlan')}</span>
                <Status value={plan.purpose} />
              </div>
              {plan.provisioning ? <ol className="space-y-1">
                {plan.provisioning.operations.map((operation, index) => (
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
              </ol> : (
                <p className="text-[10px] text-ds-muted">
                  {t('projectCoordinatorWorkflowNoProviderOperations')}
                </p>
              )}
              <div className="break-all font-mono text-[9px] text-ds-muted">
                {t('projectCoordinatorWorkflowDigest')}: {plan.workflowDigest}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onContinueWorkflow(plan)}
                className="rounded bg-ds-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {busy ? t('projectCoordinatorWorking') : t('projectCoordinatorContinueWorkflow')}
              </button>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="font-medium">{t('projectCoordinatorProjectMembers')}</div>
            {memberships.length === 0 ? <Empty /> : memberships.map((membership) => {
              const readiness = provisioning.contentReadiness.find(({ userId }) => (
                userId === membership.userId
              ))
              const authoritySuspended = membership.state === 'invited' ||
                membership.state === 'pending_membership' ||
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
                    <span>{readiness?.state ?? t(project.project.contentMode === 'none'
                      ? 'projectCoordinatorContentNotRequired'
                      : 'projectCoordinatorContentReadinessPending')}</span>
                    {authoritySuspended ? (
                      <span>{t('projectCoordinatorTaskAuthoritySuspended')}</span>
                    ) : null}
                  </div>
                  {membership.userId === currentUserId && membership.state === 'invited' &&
                    project.plan?.plan.state === 'confirmed' ? (
                      <div
                        className="space-y-1.5 rounded border border-amber-500/40 bg-amber-500/10 p-2"
                        data-default-visible-card="project-invitation-action"
                      >
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          {t('projectCoordinatorInvitationRequired')}
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAcceptInvitation({
                            projectId: project.project.projectId,
                            projectMembershipId: membership.projectMembershipId,
                            expectedProjectRevision: project.project.revision,
                            expectedMembershipRevision: membership.revision,
                            projectPlanId: project.plan!.plan.projectPlanId,
                            expectedPlanRevision: project.plan!.plan.revision,
                            planDigest: project.plan!.plan.planDigest
                          })}
                          className="rounded bg-ds-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                        >
                          {t('projectCoordinatorAcceptInvitation')}
                        </button>
                      </div>
                    ) : null}
                  {canManage && membership.userId !== project.project.ownerUserId &&
                    ['invited', 'pending_membership', 'active'].includes(membership.state) ? (
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
      id={`project-coordinator-${id}`}
      className="project-coordinator-section"
      data-coordinator-section={id}
      tabIndex={-1}
    >
      <h3>
        <span aria-hidden="true">{icon}</span>
        <span>{title}</span>
      </h3>
      {children}
    </section>
  )
}

function Empty({ message }: Readonly<{ message?: string }>): ReactElement {
  const { t } = useTranslation('common')
  return <p className="project-coordinator-empty">{message ?? t('projectCoordinatorEmpty')}</p>
}

function Notice({ children, tone = 'neutral' }: Readonly<{
  children: ReactNode
  tone?: 'neutral' | 'warning' | 'error'
}>): ReactElement {
  return (
    <p className="project-coordinator-notice" data-notice-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  )
}

function Status({ value }: Readonly<{ value: string }>): ReactElement {
  const { t } = useTranslation('common')
  const messageKey = statusMessageKey(value)
  return (
    <span
      className="project-coordinator-status"
      data-status={value}
      data-status-tone={statusTone(value)}
    >
      {messageKey ? t(messageKey) : value.replaceAll('_', ' ')}
    </span>
  )
}

export function formatRelativeTime(
  timestamp: string,
  nowMilliseconds: number,
  locale?: string
): string {
  const timestampMilliseconds = Date.parse(timestamp)
  if (!Number.isFinite(timestampMilliseconds)) return '—'
  const deltaSeconds = (timestampMilliseconds - nowMilliseconds) / 1_000
  const absoluteSeconds = Math.abs(deltaSeconds)
  const [value, unit] = absoluteSeconds < 60
    ? [Math.round(deltaSeconds), 'second'] as const
    : absoluteSeconds < 3_600
      ? [Math.round(deltaSeconds / 60), 'minute'] as const
      : absoluteSeconds < 86_400
        ? [Math.round(deltaSeconds / 3_600), 'hour'] as const
        : [Math.round(deltaSeconds / 86_400), 'day'] as const
  return new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: 'narrow'
  }).format(value, unit)
}

export function projectCoordinatorIsoFromLocalDateTime(value: string): string {
  if (!value.trim()) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

export function formatProjectCoordinatorDateTime(
  timestamp: string,
  locale?: string
): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date)
}

function formatAbsoluteTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toLocaleUpperCase()
  return `${parts[0]![0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toLocaleUpperCase()
}

function shortIdentifier(identifier: string): string {
  return identifier.length <= 14
    ? identifier
    : `${identifier.slice(0, 7)}…${identifier.slice(-4)}`
}

function focusCoordinatorSection(sectionId: string): void {
  const target = globalThis.document?.getElementById(`project-coordinator-${sectionId}`)
  if (!target) return
  if (target.tagName === 'DETAILS') (target as HTMLDetailsElement).open = true
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  target.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'start'
  })
  target.focus({ preventScroll: true })
}

function statusTone(value: string): 'positive' | 'active' | 'warning' | 'danger' | 'muted' {
  if ([
    'ready', 'online', 'active', 'eligible', 'completed', 'accepted', 'confirmed',
    'match', 'bound'
  ].includes(value)) return 'positive'
  if ([
    'offered', 'in_progress', 'running', 'awaiting_review', 'open', 'provisioning'
  ].includes(value)) return 'active'
  if ([
    'awaiting_confirmation', 'needs_human', 'revision_requested', 'busy',
    'pending_membership', 'membership_removal_pending', 'degraded'
  ].includes(value)) return 'warning'
  if ([
    'failed', 'manual_recovery_required', 'fenced', 'suspended', 'cancelled', 'blocked'
  ].includes(value)) return 'danger'
  return 'muted'
}

function statusMessageKey(value: string): string | undefined {
  switch (value) {
    case 'active': return 'projectCoordinatorStatusActive'
    case 'paused': return 'projectCoordinatorStatusPaused'
    case 'completed': return 'projectCoordinatorStatusCompleted'
    case 'accepted': return 'projectCoordinatorStatusAccepted'
    case 'cancelled': return 'projectCoordinatorStatusCancelled'
    case 'confirmed': return 'projectCoordinatorStatusConfirmed'
    case 'awaiting_confirmation': return 'projectCoordinatorStatusAwaitingConfirmation'
    case 'planned': return 'projectCoordinatorStatusPlanned'
    case 'offered': return 'projectCoordinatorStatusOffered'
    case 'in_progress': return 'projectCoordinatorStatusInProgress'
    case 'needs_human':
    case 'human_needed': return 'projectCoordinatorStatusNeedsHuman'
    case 'awaiting_review': return 'projectCoordinatorStatusAwaitingReview'
    case 'revision_requested': return 'projectCoordinatorStatusRevisionRequested'
    case 'manual_recovery_required': return 'projectCoordinatorStatusManualRecoveryRequired'
    case 'failed': return 'projectCoordinatorStatusFailed'
    case 'ready': return 'projectCoordinatorAgentReady'
    case 'busy': return 'projectCoordinatorAgentBusy'
    case 'blocked': return 'projectCoordinatorAgentBlocked'
    case 'offline': return 'projectCoordinatorAgentOffline'
    case 'online': return 'projectCoordinatorOnline'
    case 'eligible': return 'projectCoordinatorStatusEligible'
    case 'suspended': return 'projectCoordinatorStatusSuspended'
    case 'fenced': return 'projectCoordinatorStatusFenced'
    case 'pending_membership': return 'projectCoordinatorStatusPendingMembership'
    case 'membership_removal_pending': return 'projectCoordinatorStatusMembershipRemovalPending'
    case 'removed': return 'projectCoordinatorStatusRemoved'
    case 'not_member': return 'projectCoordinatorStatusNotMember'
    case 'unbound': return 'projectCoordinatorStatusUnbound'
    case 'bound': return 'projectCoordinatorStatusBound'
    case 'degraded': return 'projectCoordinatorStatusDegraded'
    default: return undefined
  }
}

function flowStageMessageKey(stage: ProjectCoordinatorFlowStageId): string {
  switch (stage) {
    case 'plan': return 'projectCoordinatorStagePlan'
    case 'dispatch': return 'projectCoordinatorStageDispatch'
    case 'execute': return 'projectCoordinatorStageExecute'
    case 'review': return 'projectCoordinatorStageReview'
    case 'record': return 'projectCoordinatorStageRecord'
    case 'complete': return 'projectCoordinatorStageComplete'
  }
}

function flowStageStateMessageKey(state: ProjectCoordinatorFlowStageState): string {
  switch (state) {
    case 'complete': return 'projectCoordinatorStageStateComplete'
    case 'active': return 'projectCoordinatorStageStateActive'
    case 'attention': return 'projectCoordinatorStageStateAttention'
    case 'pending': return 'projectCoordinatorStageStatePending'
  }
}

function agentStateMessageKey(
  state: ProjectCoordinatorAgentOperationalState['state']
): string {
  switch (state) {
    case 'ready': return 'projectCoordinatorAgentReady'
    case 'busy': return 'projectCoordinatorAgentBusy'
    case 'blocked': return 'projectCoordinatorAgentBlocked'
    case 'offline': return 'projectCoordinatorAgentOffline'
  }
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)
}

function splitCommaSeparated(value: string): string[] {
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
}

function newProjectCreateIntentId(): `pct_${string}` {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure Project create intent generation is unavailable.')
  }
  return `pct_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
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
