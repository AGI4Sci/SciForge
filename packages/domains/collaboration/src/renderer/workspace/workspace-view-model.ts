import { translateWorkspace as cw } from './workspace-i18n.js'
import { formatWorkspaceTime } from './format-time.js'
import { localizeActivityText } from './activity-messages.js'
import { currentDeliveryExecutionFailure } from './task-drawer/worker-delivery-presentation.js'
import { canonicalTaskIdForRequirementsModule, type DashboardTaskCard, type DeliveryDriveView, type ProjectCompletionTarget, type RequirementsWorkModule } from '@sciforge/collaboration-contracts'
import type { WorkerDeliveryView } from '../../worker-delivery.js'
import type { CollaborationOfferAvailability, CollaborationStatusSnapshot } from '../../contract.js'
import { offerAvailabilityPresentation } from './offer-availability.js'
import { capabilityRequirementsSatisfied } from '../../capability-requirements.js'
import type { ProjectCoordinatorProject, ProjectCoordinatorRequirementsCompletion, ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'
import type { BoardColumnId, ProjectModel, ProjectStatus, TaskCardModel, WorkspaceMemberViewModel, WorkspaceStructureModel } from './workspace-types.js'

export type WorkspaceRoute = 'my-work' | 'inbox' | 'research' | 'board' | 'members' | 'requirements' | 'files' | 'info'

export type WorkspaceRequirementsViewModel = Readonly<{
  revision: number | null
  documentRevision: number | null
  state: string
  goalsDeliverables: string
  inputsBoundaries: string
  workModules: readonly Readonly<{ planItemId: string; title: string; objective: string; output?: RequirementsWorkModule['output']; dependencyLabel: string; blockedByLabel?: string }>[]
  acceptanceCriteria: readonly Readonly<{ target: string; criteria: string; evidenceMethod: string }>[]
  confirmed: boolean
  completion?: ProjectCoordinatorRequirementsCompletion
}>

export type WorkspacePersonalItem = Readonly<{
  id: string
  reference?: string
  title: string
  person?: string
  projectId: string
  projectName: string
  state: string
  time: string
  /** Raw ISO timestamp for the hover title. */
  at?: string
  action: string
  taskId?: string
  notificationId?: string
  /** Every unread process event merged into this one todo. */
  notificationIds?: readonly string[]
  membershipId?: string
  kind?: string
}>

export type WorkspaceConnectionViewModel = Readonly<{
  tone: 'ready' | 'pending' | 'attention'
  label: string
  detail?: string
  /** The one connection step this Desktop can take itself. */
  action?: 'configure' | 'connect' | 'recover'
  /** Why queued Cloud commands are not being sent yet. */
  waiting?: string
}>

/** The Owner can close the project once every confirmed module's Task is completed and adopted. */
export type WorkspaceCompletionViewModel = Readonly<{
  adopted: number
  total: number
  target: Omit<Extract<ProjectCompletionTarget, { baselineKind: 'requirements' }>, 'summary'> | null
}>

export type WorkspaceViewModel = WorkspaceStructureModel & Readonly<{
  completion: WorkspaceCompletionViewModel
  loaded: boolean
  connection: WorkspaceConnectionViewModel
  route: WorkspaceRoute
  requirements: WorkspaceRequirementsViewModel | null
  members: readonly WorkspaceMemberViewModel[]
  myWork: readonly WorkspacePersonalItem[]
  inbox: readonly WorkspacePersonalItem[]
  currentUserId: string | null
  projectId: string | null
  project: ProjectCoordinatorProject | null
  files: DeliveryDriveView | null
  mentionableUsers: readonly Readonly<{ userId: string; displayName: string }>[]
}>

const columnMap: Readonly<Record<string, BoardColumnId>> = {
  intake: 'intake', ready: 'ready', in_progress: 'in-progress', confirmation: 'review',
  accepted_awaiting_runtime: 'in-progress', running: 'in-progress', needs_human: 'in-progress', revision_requested: 'in-progress',
  awaiting_review: 'review', waiting_result_confirm: 'review', completed: 'completed', failed: 'completed', cancelled: 'completed',
  unknown_reconciling: 'ready'
}

const taskColumnLabels: Readonly<Record<string, string>> = {
  intake: '收集箱', ready: '待开始', in_progress: '进行中', confirmation: '待确认', completed: '已完成'
}

const notificationLabels: Readonly<Record<string, string>> = {
  offer: '任务待接受', review: '交付待处理', mention: '@我的讨论', blocked: '提问待回答', exception: '需要处理', system: '系统通知'
}

const outboxWaitLabels: Readonly<Record<NonNullable<CollaborationStatusSnapshot['connection']['outboxWait']>['reason'], string>> = {
  agent_identity: '正在等待这台电脑的 Agent 身份就绪，就绪后会自动发送。',
  agent_authority: '正在等待 Agent 授权就绪，就绪后会自动发送。',
  authority_check: 'Agent 授权检查超时，正在自动重试。',
  user_identity: '正在等待云端账户登录就绪，就绪后会自动发送。'
}

function connectionView(workspace: ProjectCoordinatorWorkspace | undefined, snapshot: CollaborationStatusSnapshot | undefined): WorkspaceConnectionViewModel {
  const connection = workspace?.connection
  if (!connection) return { tone: 'pending', label: '正在连接云端' }
  if (connection.state === 'ready') {
    // Signed in is not enough: this Desktop's Agent joins work only through its own Collaboration connection.
    const collaboration = snapshot?.connection
    if (!collaboration) return { tone: 'ready', label: '云端已连接' }
    if (collaboration.state === 'connected') {
      const wait = collaboration.outboxWait
      return wait
        ? { tone: 'pending', label: '指令等待发送', detail: outboxWaitLabels[wait.reason], waiting: outboxWaitLabels[wait.reason] }
        : { tone: 'ready', label: '云端已连接' }
    }
    if (collaboration.state === 'connecting' || collaboration.state === 'recovering') return { tone: 'pending', label: '正在连接协作' }
    if (collaboration.state === 'unconfigured') return { tone: 'attention', label: '协作未连接', detail: '连接后，这台电脑的 Agent 才能接收和执行任务。', action: 'configure' }
    if (collaboration.state === 'disconnected') return { tone: 'attention', label: '协作未连接', detail: '连接后，这台电脑的 Agent 才能接收和执行任务。', action: 'connect' }
    return { tone: 'attention', label: '协作连接异常', detail: collaboration.lastError, action: 'recover' }
  }
  if (connection.state === 'identity_required') return { tone: 'attention', label: '需要登录', detail: '请在设置中登录协作账户。' }
  if (connection.state === 'device_required') return { tone: 'attention', label: '需要登记设备', detail: connection.reason }
  if (connection.reasonCode === 'authority_unverified') return { tone: 'pending', label: '正在重新连接', detail: '正在恢复连接并核验设备，请稍候。' }
  return { tone: 'attention', label: '云端暂不可用', detail: connection.reason }
}

/** Latest persisted Task activity; dashboard observation and future deadlines are not events. */
function taskChangedAt(project: ProjectCoordinatorProject | null | undefined, taskId: string): string | undefined {
  const view = project?.tasks.find(({ task }) => task.taskId === taskId)
  const delivery = view?.delivery
  const offers = project?.offers.filter((offer) => offer.taskId === taskId) ?? []
  const facts = [view?.task, ...(view?.executions ?? []), ...offers, delivery?.candidate, delivery?.manifest, delivery?.receipt, delivery?.result]
  const times = [
    ...facts.flatMap((fact) => [fact?.createdAt, fact?.updatedAt]),
    view?.task.completedAt,
    ...(view?.executions ?? []).flatMap((execution) => [execution.offeredAt, execution.acceptedAt, execution.startedAt, execution.terminalAt]),
    ...offers.flatMap((offer) => [offer.offeredAt, offer.respondedAt]),
    delivery?.manifest?.sealedAt, delivery?.revisionRequest?.requestedAt, delivery?.result?.adoptedAt
  ]
  let latest: string | undefined
  let latestTime = -Infinity
  for (const time of times) {
    if (!time) continue
    const timestamp = Date.parse(time)
    if (timestamp > latestTime) {
      latest = time
      latestTime = timestamp
    }
  }
  return latest
}

function taskCard(task: DashboardTaskCard, options: Readonly<{
  changedAt?: string
  stateLabel?: string
  executionFailure?: TaskCardModel['executionFailure']
  blockedByLabel?: string
  assignment?: TaskCardModel['assignment']
  reference?: string
  description?: string
  offerId?: string
  offerAvailability?: CollaborationOfferAvailability
  offerDismissed?: boolean
  offerExpiresAt?: string
  executionId?: string | null
  humanRequest?: TaskCardModel['humanRequest']
  humanRequestId?: string
  question?: string
  assignableWorkerUserIds?: readonly string[]
}> = {}): TaskCardModel {
  const status = columnMap[task.workflowColumn] ?? 'ready'
  const stateLabel = options.stateLabel
  const dateTime = task.plannedDueAt ?? options.changedAt
  return {
    id: task.taskId, cloudTaskId: task.taskId, reference: options.reference ?? `#${task.lineage.workItemId}`, moduleType: task.taskKind, title: task.title, description: options.description, question: options.question ?? task.blocker ?? undefined,
    assignee: task.assigneeDisplayName, assigneeUserId: task.assigneeUserId,
    date: formatTime(dateTime), dateTime, status, stateLabel, blockedByLabel: options.blockedByLabel,
    executionFailure: options.executionFailure,
    unread: task.unread, priority: task.primaryAction === 'adopt_delivery' ? 'high' : undefined,
    offerId: options.offerId, offerAvailability: options.offerAvailability, offerDismissed: options.offerDismissed, assignment: options.assignment, offerExpiresAt: options.offerExpiresAt, executionId: options.executionId ?? task.executionId,
    humanRequest: options.humanRequest, executionState: task.contractExecution, humanRequestId: options.humanRequestId, projectId: task.projectId,
    canReturnExecution: Boolean(task.executionId && ['accepted_awaiting_runtime', 'running', 'needs_human'].includes(task.contractExecution)),
    assignableWorkerUserIds: options.assignableWorkerUserIds
  }
}

/**
 * A Task whose newest local Offer this Desktop dismissed is no longer a pending
 * assignment for that Member: it leaves the board, My Work and the alert. The
 * Project Owner keeps the card, because their board is the dispatch surface
 * rather than a personal inbox.
 */
function locallyDismissedTaskIds(
  snapshot: CollaborationStatusSnapshot | undefined,
  currentUserId: string | null,
  ownedProjectIds: ReadonlySet<string>
): ReadonlySet<string> {
  const dismissed = new Set<string>()
  if (!currentUserId) return dismissed
  for (const project of snapshot?.projects ?? []) {
    if (ownedProjectIds.has(project.projectId)) continue
    const latest = new Map<string, Readonly<{ state: string; updatedAt: string }>>()
    for (const task of project.tasks) {
      if (task.workerUserId !== currentUserId) continue
      const previous = latest.get(task.taskId)
      if (!previous || task.updatedAt > previous.updatedAt) {
        latest.set(task.taskId, { state: task.state, updatedAt: task.updatedAt })
      }
    }
    for (const [taskId, task] of latest) if (task.state === 'dismissed') dismissed.add(taskId)
  }
  return dismissed
}

/** Local drafts remain private and are matched to the exact assigned execution. */
function deliveryForTask(task: DashboardTaskCard, currentUserId: string | null, deliveries: Readonly<Record<string, WorkerDeliveryView>>): WorkerDeliveryView | undefined {
  if (!currentUserId || task.assigneeUserId !== currentUserId || !task.executionId) return undefined
  const delivery = deliveries[task.executionId]
  return delivery?.projectId === task.projectId && delivery.taskId === task.taskId && delivery.executionId === task.executionId ? delivery : undefined
}

/**
 * The one pending Agent question a Task's current execution is waiting on.
 * The Cloud Dashboard's `blocker` only describes manual recovery, so a Worker's
 * needs_human execution is read from the canonical pending HumanNeeded fact
 * instead of guessing from the execution badge.
 */
type AgentQuestion = NonNullable<TaskCardModel['humanRequest']>

function agentQuestionForTask(project: ProjectCoordinatorProject | null | undefined, taskId: string, executionId: string | null | undefined): AgentQuestion | undefined {
  if (!project || !executionId) return undefined
  const request = project.pendingHumanNeeded.find((candidate) => (
    candidate.status === 'pending' &&
    candidate.context.scope === 'worker_execution' &&
    candidate.context.taskId === taskId &&
    candidate.context.executionId === executionId
  ))
  if (!request) return undefined
  return request
}

/** Local Session failures are private and scoped to the exact current assigned execution. */
function localFailureForTask(task: DashboardTaskCard, snapshot: CollaborationStatusSnapshot | undefined, userId: string | null, delivery?: WorkerDeliveryView): TaskCardModel['executionFailure'] {
  if (task.assigneeUserId !== userId || !task.executionId ||
      !['running', 'waiting_result_confirm'].includes(task.contractExecution)) return undefined
  const local = snapshot?.projects.find((project) => project.projectId === task.projectId)?.tasks.find((run) =>
    run.taskId === task.taskId && run.executionId === task.executionId && run.workerUserId === userId)
  return currentDeliveryExecutionFailure(delivery, local?.failure ? { code: local.failure.code, reexecutionInputId: local.reexecutionInputId } : undefined)
}

/** Only the Member the Agent asked may answer; everyone else sees a read-only status. */
function taskStateLabel(task: DashboardTaskCard, delivery: WorkerDeliveryView | undefined, question: AgentQuestion | undefined, currentUserId: string | null, availability?: CollaborationOfferAvailability, failure?: TaskCardModel['executionFailure'], followup?: WorkerDeliveryView['followup'], assignment?: TaskCardModel['assignment']): string | undefined {
  if (task.contractExecution === 'failed') return assignment?.kind === 'reassign' ? '待重新派发' : '执行失败'
  if (task.adoption === 'adopted') return undefined
  if (failure) return '执行失败'
  if (task.primaryAction === 'adopt_delivery') return '待你采纳'
  if (delivery?.state === 'sealed') return '待负责人采纳'
  // A pending question for this exact Execution outranks the broad local
  // "executing" projection, which also covers a run waiting for its human.
  if (question) return question.confirmableAction ? question.targetUserId === currentUserId ? '等待决定' : '等待成员决定' : question.targetUserId === currentUserId ? '等待回答' : '等待成员回答'
  if (task.contractExecution === 'running') {
    const revisit = delivery?.followup ?? followup
    if (revisit?.state === 'waiting') return '等待到期复查'
    if (revisit?.state === 'dispatching') return '正在核对复查结果'
    if (revisit?.state === 'unknown') return '复查结果待核实'
    if (revisit?.state === 'cancelled') return '复查已取消'
  }
  if (delivery?.state === 'executing') return task.delivery === 'returned' ? '返修中' : '执行中'
  if (delivery?.state === 'waiting_confirmation' && delivery.draft) return '待提交交付'
  if (availability) return offerAvailabilityPresentation(availability).label
  return task.blocker ? '等待回答' : task.primaryAction === 'accept_offer' ? '等待成员接受' : task.delivery === 'worker_review' ? '待提交交付' : task.delivery === 'returned' ? '返修中' : undefined
}

/** The local backend gate identifies the exact current Offer; Cloud primaryAction alone is insufficient. */
function localOfferForTask(task: DashboardTaskCard, project: ProjectCoordinatorProject | null | undefined, snapshot: CollaborationStatusSnapshot | undefined, currentUserId: string | null): Readonly<{ taskOfferId?: string; availability?: CollaborationOfferAvailability }> {
  if (!currentUserId || task.assigneeUserId !== currentUserId) return {}
  const pending = project?.offers.find((offer) => offer.taskId === task.taskId && offer.state === 'pending')
  const cloudTask = project?.tasks.find((entry) => entry.task.taskId === task.taskId)?.task
  const currentExecutionId = cloudTask?.currentExecutionId ?? (task.primaryAction !== 'accept_offer' ? task.executionId : undefined)
  const currentOffer = currentExecutionId
    ? project?.offers.find((offer) => offer.taskId === task.taskId && offer.executionId === currentExecutionId)
    : pending ?? (cloudTask?.currentExecutionId === null
      ? project?.offers.find((offer) => offer.taskId === task.taskId && offer.reassignmentTaskRevision === cloudTask.revision)
      : undefined)
  const local = snapshot?.projects?.find((entry) => entry.projectId === task.projectId)?.tasks.find((entry) => (
    entry.taskId === task.taskId && entry.workerUserId === currentUserId && entry.offerAvailability &&
    entry.taskOfferId === currentOffer?.taskOfferId
  ))
  if (local?.offerAvailability) return { taskOfferId: local.taskOfferId, availability: local.offerAvailability }
  if (task.primaryAction !== 'accept_offer') return {}
  // Cloud projections may arrive before this device's Offer journal. This is
  // synchronization evidence, never permission to decide or execute an Offer.
  // An explicit local gate above remains authoritative, including real failures.
  if (currentOffer && (currentOffer.state === 'pending' || currentOffer.state === 'accepted')) {
    return {
      taskOfferId: currentOffer.taskOfferId,
      availability: { state: 'sync_pending', reason: 'synchronization_pending', canAccept: false, canReject: false, canDismiss: false }
    }
  }
  return {
    taskOfferId: currentOffer?.taskOfferId,
    availability: { state: 'unverified', reason: 'reconciliation_required', canAccept: false, canReject: false, canDismiss: false }
  }
}

function projectModel(entry: ProjectCoordinatorWorkspace['projects'][number], userId: string | null, snapshot: CollaborationStatusSnapshot | undefined): ProjectModel {
  const projectId = entry.project.projectId
  const dashboard = snapshot?.dashboards?.find((item) => item.projectId === projectId)
  const pending = (dashboard?.tasks.filter((task) => task.unread).length ?? 0) + (snapshot?.notifications?.filter((item) => item.projectId === projectId && item.readAt === null).length ?? 0)
  return { id: projectId, initials: projectInitials(entry.project.displayName), name: entry.project.displayName, status: entry.project.status === 'cancelled' ? 'completed' : entry.project.status as ProjectStatus, pendingCount: pending || undefined, owned: userId !== null && entry.project.ownerUserId === userId }
}

function projectInitials(name: string): string {
  const first = [...name.trim()][0]
  return first ? /[A-Za-z]/u.test(first) ? first.toUpperCase() : first : '—'
}

/**
 * The Owner's manual assignment uses the same executable-capability rule as
 * automatic dispatch and the claiming Device: a Worker is offered only when
 * one of their registered runtimes provides every tag the module requires.
 */
function assignableWorkerUserIds(
  project: ProjectCoordinatorProject | null,
  requiredCapabilityTags: readonly string[]
): readonly string[] {
  if (!project) return []
  return project.workerGroups
    .filter(({ agents }) => agents.some(({ projectAvailability }) => (
      projectAvailability.availability.agentActive &&
      projectAvailability.availability.deviceActive &&
      capabilityRequirementsSatisfied(
        requiredCapabilityTags,
        projectAvailability.availability.runtimeCapabilityTags
      )
    )))
    .map(({ userId }) => userId)
}

function taskAdopted(project: ProjectCoordinatorProject, taskId: string): boolean {
  const entry = project.tasks.find(({ task }) => task.taskId === taskId)
  return entry?.task.status === 'completed' && entry.delivery?.receipt?.disposition === 'adopted'
}

function requirementsView(project: ProjectCoordinatorProject | null, currentUserId: string | null): WorkspaceRequirementsViewModel | null {
  const document = project?.project.ownerUserId === currentUserId ? project?.requirementsDraft ?? project?.confirmedRequirements : project?.confirmedRequirements ?? project?.requirementsDraft
  if (!project || !document) return null
  return { revision: document.revision, documentRevision: document.documentRevision, state: document.state, goalsDeliverables: document.goalsDeliverables, inputsBoundaries: document.inputsBoundaries, workModules: document.workModules.map((module) => {
    const dependencies = document.workModules.flatMap((dependency, index) => module.dependencyPlanItemIds.includes(dependency.planItemId) ? [{ reference: `#${index + 1}`, title: dependency.title, adopted: taskAdopted(project, canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, dependency.planItemId)) }] : [])
    const pending = dependencies.filter((dependency) => !dependency.adopted)
    return { ...module, dependencyLabel: dependencies.length ? cw("依赖：{{dependencies}}", { dependencies: dependencies.map((dependency) => `${dependency.reference} ${dependency.title}`).join(cw('、')) }) : cw('可立即开始'), blockedByLabel: pending.length ? cw("等待 {{references}} 采纳", { references: pending.map((dependency) => dependency.reference).join(cw('、')) }) : undefined }
  }), acceptanceCriteria: document.acceptanceCriteria, confirmed: project?.confirmedRequirements?.documentRevision === document.documentRevision, completion: project?.requirementsCompletion ?? undefined }
}

function projectName(workspace: ProjectCoordinatorWorkspace | undefined, projectId: string): string {
  return workspace?.projects.find((entry) => entry.project.projectId === projectId)?.project.displayName ?? projectId
}

function formatTime(value: string | null | undefined): string {
  return value ? formatWorkspaceTime(value) : '—'
}

const terminalOfferLabels: Readonly<Record<string, string>> = { rejected: '原派单已被拒绝', withdrawn: '原派单已撤回', timed_out: '原派单已超时' }

/** Same rule the Coordinator enforces: a pending offer is handed over through withdraw-then-reassign; only the current terminal offer can be succeeded. */
function assignmentFor(project: ProjectCoordinatorProject | null, taskId: string, pending: ProjectCoordinatorProject['offers'][number] | undefined, users: readonly Readonly<{ userId: string; displayName: string }>[]): TaskCardModel['assignment'] {
  if (!project || project.project.status !== 'active') return undefined
  const view = project.tasks.find(({ task }) => task.taskId === taskId)
  if (!view || view.task.projectId !== project.project.projectId) return undefined
  if (pending) {
    if (pending.projectId !== project.project.projectId || pending.taskId !== taskId ||
        pending.state !== 'pending' || pending.executionId !== null ||
        view.task.status !== 'offered' || view.task.currentExecutionId !== null) return undefined
    return { kind: 'withdraw', taskOfferId: pending.taskOfferId, workerUserId: pending.workerUserId, workerName: users.find((user) => user.userId === pending.workerUserId)?.displayName ?? pending.workerUserId, expiresAt: formatTime(pending.expiresAt) }
  }
  if (view.task.status !== 'revision_requested' || !Number.isSafeInteger(view.task.revision) || view.task.revision < 1 ||
      !(view.task.executionCount < view.task.maxRetries + 1)) return undefined
  const offers = project.offers.filter((entry) => entry.taskId === taskId)
  // Recovery rejects cross-resource history rather than inferring an eligible successor.
  if (offers.some((offer) => offer.projectId !== project.project.projectId) ||
      view.executions.some((execution) => execution.projectId !== project.project.projectId || execution.taskId !== taskId)) return undefined
  for (const offer of offers) {
    if (offer.executionId === null) {
      if (view.task.currentExecutionId === null && view.task.currentExecutionState === null &&
          Object.hasOwn(terminalOfferLabels, offer.state) && offer.reassignmentTaskRevision === view.task.revision) {
        return { kind: 'reassign', previousTaskOfferId: offer.taskOfferId, reason: terminalOfferLabels[offer.state]! }
      }
      continue
    }
    const execution = view.executions.find(({ executionId }) => executionId === offer.executionId)
    if (offer.state === 'accepted' && execution && view.task.currentExecutionId === offer.executionId &&
        view.task.currentExecutionState === execution.state && ['failed', 'cancelled', 'revoked'].includes(execution.state) &&
        execution.fence.status === 'fenced') {
      return { kind: 'reassign', previousTaskOfferId: offer.taskOfferId, reason: '原执行已结束，未能完成' }
    }
  }
  return undefined
}

/** A first offer creates a Task; an existing Task must never take this path. */
function firstAssignmentFor(project: ProjectCoordinatorProject | null, taskId: string, planItemId: string): TaskCardModel['assignment'] {
  const document = project?.confirmedRequirements
  if (!project || project.project.status !== 'active' || !document || document.state !== 'confirmed' ||
      document.projectId !== project.project.projectId ||
      !document.workModules.some((module) => module.planItemId === planItemId) ||
      canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, planItemId) !== taskId ||
      project.tasks.some(({ task }) => task.taskId === taskId) || project.offers.some((offer) => offer.taskId === taskId)) return undefined
  return { kind: 'first', requirementsDocumentId: document.requirementsDocumentId, planItemId, taskId }
}

type InboxNotification = NonNullable<CollaborationStatusSnapshot['notifications']>[number]
type DashboardTask = NonNullable<CollaborationStatusSnapshot['dashboards']>[number]['tasks'][number]

type InboxTask = Readonly<{
  projectId: string
  projectName: string
  title: string
  submitter: string | null
  card: DashboardTask | null
  view?: ProjectCoordinatorProject['tasks'][number]
}>

type InboxTodo = Readonly<{
  title: string
  state: string
  action: string
  needsAction: boolean
}>

/**
 * The Cloud publishes one stable summary per Delivery lifecycle event. The
 * page translates those process events into one Chinese todo per Task; it
 * never renders the English summary itself.
 */
type DeliveryEventPhase = 'candidate' | 'reviewing' | 'returned' | 'sealed' | 'revision_requested' | 'adopted' | 'published'

const deliveryEventSummaryPhases: readonly Readonly<{ pattern: RegExp; phase: DeliveryEventPhase }>[] = [
  { pattern: /Worker confirmed a Delivery candidate/iu, phase: 'candidate' },
  { pattern: /Worker approved the Delivery candidate/iu, phase: 'reviewing' },
  { pattern: /Worker returned the Delivery candidate/iu, phase: 'returned' },
  { pattern: /Worker sealed an immutable Delivery manifest/iu, phase: 'sealed' },
  { pattern: /Coordinator requested a revision/iu, phase: 'revision_requested' },
  { pattern: /Coordinator adopted the sealed Delivery|non-adopted Delivery disposition/iu, phase: 'adopted' },
  { pattern: /Project Result was published/iu, phase: 'published' }
]

const deliveryEventProjectLabels: Readonly<Record<DeliveryEventPhase, string>> = {
  candidate: '交付已提交，等待确认',
  reviewing: '交付已确认，正在封存',
  returned: '交付已被退回修改',
  sealed: '交付待负责人采纳',
  revision_requested: '返修要求',
  adopted: '交付已采纳',
  published: '成果已发布'
}

function deliveryEventPhase(summary: string): DeliveryEventPhase | null {
  return deliveryEventSummaryPhases.find(({ pattern }) => pattern.test(summary))?.phase ?? null
}

function inboxTaskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`
}

/** Both the Cloud dashboard and the loaded Project contribute Task titles for a notification. */
function inboxTasks(workspace: ProjectCoordinatorWorkspace | undefined, snapshot: CollaborationStatusSnapshot | undefined): Map<string, InboxTask> {
  const tasks = new Map<string, InboxTask>()
  for (const dashboard of snapshot?.dashboards ?? []) {
    for (const card of dashboard.tasks) {
      tasks.set(inboxTaskKey(card.projectId, card.taskId), {
        projectId: card.projectId, projectName: dashboard.projectName, title: card.title,
        submitter: card.assigneeDisplayName, card
      })
    }
  }
  for (const entry of workspace?.projects ?? []) {
    const projectId = entry.project.projectId
    const members = entry.memberUsers
    for (const view of entry.tasks) {
      const key = inboxTaskKey(projectId, view.task.taskId)
      const existing = tasks.get(key)
      const currentExecution = view.task.currentExecutionId === null
        ? null
        : view.executions?.find(({ executionId }) => executionId === view.task.currentExecutionId) ?? null
      const assigneeUserId = existing?.card?.assigneeUserId ?? currentExecution?.assigneeUserId ?? null
      tasks.set(key, {
        projectId, projectName: existing?.projectName ?? entry.project.displayName, title: view.task.title,
        submitter: existing?.submitter ?? members.find((member) => member.userId === assigneeUserId)?.displayName ?? null,
        card: existing?.card ?? null, view
      })
    }
  }
  return tasks
}

function projectOwnerUserId(workspace: ProjectCoordinatorWorkspace | undefined, projectId: string): string | null {
  return workspace?.projects.find((entry) => entry.project.projectId === projectId)?.project.ownerUserId ?? null
}

/** The one current todo a Task proves, in the order the Owner/Worker must act on it. */
function deliveryTodo(task: InboxTask, currentUserId: string | null, isOwner: boolean): InboxTodo | null {
  const card = task.card
  const view = task.view
  const disposition = view?.delivery?.receipt?.disposition ?? card?.adoption
  if (['adopted', 'unadopted'].includes(disposition ?? '') || ['completed', 'cancelled'].includes(view?.task.status ?? '')) return null
  const revision = view?.delivery?.revisionRequest
  if (revision && revision.deliveryManifestId === view?.delivery?.manifest?.deliveryManifestId && revision.executionId === view.task.currentExecutionId) {
    const assigneeUserId = view?.executions.find((execution) => execution.executionId === view.task.currentExecutionId)?.assigneeUserId ?? card?.assigneeUserId
    return assigneeUserId === currentUserId
      ? { title: cw("返修要求：{{title}}", { title: task.title }), state: '待返修', action: '打开任务', needsAction: true }
      : { title: cw("返修中：{{title}}", { title: task.title }), state: '返修中', action: '查看', needsAction: false }
  }
  const submitter = task.submitter ?? cw('成员')
  if (isOwner && view?.delivery?.manifest && !view.delivery.revisionRequest && !view.delivery.receipt) {
    return { title: cw("{{submitter}} 提交了交付：{{title}}", { submitter, title: task.title }), state: '待你采纳', action: '查看交付', needsAction: true }
  }
  if (!card) return null
  if (isOwner && (card.primaryAction === 'adopt_delivery' || (card.delivery === 'sealed' && card.adoption === 'pending'))) {
    return { title: cw("{{submitter}} 提交了交付：{{title}}", { submitter, title: task.title }), state: '待你采纳', action: '查看交付', needsAction: true }
  }
  if (card.delivery === 'returned') {
    return card.assigneeUserId === currentUserId
      ? { title: cw("返修要求：{{title}}", { title: task.title }), state: '待返修', action: '打开任务', needsAction: true }
      : { title: cw("返修中：{{title}}", { title: task.title }), state: '返修中', action: '查看', needsAction: false }
  }
  if (card.delivery === 'sealed') {
    return { title: cw("{{submitter}} 提交了交付：{{title}}", { submitter, title: task.title }), state: '待负责人采纳', action: '查看交付', needsAction: false }
  }
  if (card.delivery === 'worker_review') {
    return { title: cw("{{submitter}} 已提交交付，等待确认：{{title}}", { submitter, title: task.title }), state: '待确认', action: '查看', needsAction: false }
  }
  return null
}

function notificationAction(kind: InboxNotification['kind']): string {
  return kind === 'blocked' ? '回答' : kind === 'review' ? '查看交付' : '查看'
}

/**
 * The inbox merges the Cloud's unread process events with the pending work this
 * snapshot proves. Every Task yields at most one row, and the row that needs the
 * current User to act always wins; once that work is handled the row is gone.
 */
function inboxItems(workspace: ProjectCoordinatorWorkspace | undefined, snapshot: CollaborationStatusSnapshot | undefined, currentUserId: string | null, deliveries: Readonly<Record<string, WorkerDeliveryView>>, dismissedTaskIds: ReadonlySet<string> = new Set()): WorkspacePersonalItem[] {
  const notifications = (snapshot?.notifications ?? []).filter((item) => item.readAt === null)
  const tasks = inboxTasks(workspace, snapshot)
  const items: WorkspacePersonalItem[] = []
  const priorities: number[] = []
  const taskSlots = new Map<string, number>()
  const push = (item: WorkspacePersonalItem, priority: number): void => {
    const key = item.projectId && item.taskId ? inboxTaskKey(item.projectId, item.taskId) : null
    const slot = key ? taskSlots.get(key) : undefined
    if (slot === undefined) {
      if (key) taskSlots.set(key, items.length)
      items.push(item)
      priorities.push(priority)
      return
    }
    const current = items[slot]!
    const notificationIds = [...new Set([...(current.notificationIds ?? []), ...(item.notificationIds ?? [])])]
    if (priority > (priorities[slot] ?? 0)) {
      items[slot] = { ...item, notificationId: notificationIds[0] ?? item.notificationId, notificationIds }
      priorities[slot] = priority
    } else {
      items[slot] = { ...current, notificationId: notificationIds[0] ?? current.notificationId, notificationIds }
    }
  }

  for (const notification of notifications) {
    // A Task this Desktop dismissed is no longer a pending assignment; its old
    // offer event is history, not a todo.
    if (notification.kind === 'offer' && notification.taskId && dismissedTaskIds.has(notification.taskId)) continue
    const task = notification.taskId ? tasks.get(inboxTaskKey(notification.projectId, notification.taskId)) : undefined
    if (!task) {
      const phase = notification.kind === 'review' ? deliveryEventPhase(notification.summary) : null
      push({
        id: notification.notificationId,
        title: notification.kind === 'offer' ? cw('派单状态待核实') : phase ? cw(deliveryEventProjectLabels[phase]) : localizeActivityText(notification.summary),
        projectId: notification.projectId, projectName: projectName(workspace, notification.projectId),
        state: notification.kind === 'offer' ? '待核实' : notificationLabels[notification.kind] ?? '通知', time: formatTime(notification.createdAt), at: notification.createdAt,
        action: notificationAction(notification.kind), taskId: notification.taskId ?? undefined,
        notificationId: notification.notificationId, notificationIds: [notification.notificationId], kind: notification.kind
      }, notification.actionRequired ? 2 : 1)
      continue
    }
    if (notification.kind !== 'review') {
      const offer = task.card && notification.kind === 'offer'
        ? localOfferForTask(task.card, workspace?.projects.find((entry) => entry.project.projectId === task.projectId), snapshot, currentUserId)
        : undefined
      const offerPresentation = offer?.availability ? offerAvailabilityPresentation(offer.availability) : undefined
      // Invitations, mentions, questions and system notices carry their own text.
      push({
        id: notification.notificationId, title: notification.kind === 'offer' && !offer?.availability?.canAccept ? cw("派单状态：{{title}}", { title: task.title }) : localizeActivityText(notification.summary),
        projectId: task.projectId, projectName: task.projectName,
        state: offerPresentation?.label ?? (notification.kind === 'offer' ? '待核实' : notificationLabels[notification.kind] ?? '通知'), time: formatTime(notification.createdAt), at: notification.createdAt,
        action: offer?.availability?.canAccept ? '接受任务' : notificationAction(notification.kind), taskId: notification.taskId ?? undefined,
        notificationId: notification.notificationId, notificationIds: [notification.notificationId], kind: notification.kind
      }, notification.actionRequired ? 2 : 1)
      continue
    }
    const owner = currentUserId !== null && projectOwnerUserId(workspace, task.projectId) === currentUserId
    const todo = currentUserId ? deliveryTodo(task, currentUserId, owner) : null
    const phase = notification.kind === 'review' ? deliveryEventPhase(notification.summary) : null
    const submitter = task.submitter ?? cw('成员')
    let entry: InboxTodo | null = null
    if (todo?.needsAction) entry = todo
    else if (phase === 'adopted') entry = { title: cw("{{title}} 已采纳", { title: task.title }), state: '已采纳', action: '查看', needsAction: false }
    else if (phase === 'published') entry = { title: cw("成果已发布：{{title}}", { title: task.title }), state: '已发布', action: '查看', needsAction: false }
    else if (todo) entry = todo
    else if (!task.card && !task.view?.delivery?.receipt && phase === 'sealed' && owner) entry = { title: cw("{{submitter}} 提交了交付：{{title}}", { submitter, title: task.title }), state: '待你采纳', action: '查看交付', needsAction: true }
    else if (phase === null && notification.actionRequired) {
      const disposition = task.view?.delivery?.receipt?.disposition ?? task.card?.adoption
      const settled = ['adopted', 'unadopted'].includes(disposition ?? '') || ['completed', 'cancelled'].includes(task.view?.task.status ?? '') || task.card?.workflowColumn === 'completed'
      if (settled) continue
      // Unknown events remain visible, but only the current Owner or assignee
      // can inherit an actionable fallback. Summary text cannot grant a role.
      const assigneeUserId = task.view?.executions.find((execution) => execution.executionId === task.view?.task.currentExecutionId)?.assigneeUserId ?? task.card?.assigneeUserId
      const actionable = owner || (currentUserId !== null && assigneeUserId === currentUserId)
      entry = { title: actionable ? cw("需要你处理：{{title}}", { title: task.title }) : localizeActivityText(notification.summary), state: notificationLabels[notification.kind] ?? '待处理', action: actionable ? notificationAction(notification.kind) : '查看', needsAction: actionable }
    }
    if (!entry) continue
    push({
      id: `notification:${notification.notificationId}`, title: entry.title,
      projectId: task.projectId, projectName: task.projectName, state: entry.state,
      time: formatTime(notification.createdAt), at: notification.createdAt, action: entry.action, taskId: notification.taskId ?? undefined,
      notificationId: notification.notificationId, notificationIds: [notification.notificationId], kind: notification.kind
    }, entry.needsAction ? 3 : 1)
  }

  if (!currentUserId) return items
  const notifiedOfferTaskIds = new Set(notifications.flatMap((item) => item.kind === 'offer' && item.taskId ? [item.taskId] : []))
  // A pending Agent question is the Member's actionable todo whether or not a
  // Cloud notification exists: the execution cannot continue until they answer.
  for (const entry of workspace?.projects ?? []) {
    for (const request of entry.pendingHumanNeeded) {
      if (request.status !== 'pending' || request.context.scope !== 'worker_execution' || request.targetUserId !== currentUserId) continue
      const { taskId, executionId: requestedExecutionId } = request.context
      const task = tasks.get(inboxTaskKey(entry.project.projectId, taskId))
      const executionState = task?.card?.contractExecution
        ?? entry.tasks.find((view) => view.task.taskId === taskId)?.task.currentExecutionState
      if (['failed', 'completed', 'cancelled', 'revoked', 'superseded', 'manual_recovery_required'].includes(executionState ?? '')) continue
      // Only the Task's current execution can be waiting; an older request is history.
      const executionId = task?.card?.executionId
        ?? entry.tasks.find((view) => view.task.taskId === taskId)?.task.currentExecutionId
        ?? null
      if (!executionId || requestedExecutionId !== executionId) continue
      push({
        id: `human:${request.humanRequestId}`, title: request.confirmableAction ? cw('Agent 需要你决定：{{title}}', { title: task?.title ?? cw('当前任务') }) : cw('Agent 需要你回答：{{title}}', { title: task?.title ?? cw('当前任务') }),
        projectId: entry.project.projectId, projectName: entry.project.displayName, state: request.confirmableAction ? '等待决定' : '等待回答',
        time: formatTime(request.updatedAt), at: request.updatedAt, action: request.confirmableAction ? '决定' : '回答', taskId, kind: 'human'
      }, 4)
    }
  }
  for (const entry of workspace?.projects ?? []) {
    const membership = entry.memberships.find((candidate) => candidate.state === 'invited' && candidate.userId === currentUserId)
    if (!membership) continue
    push({
      id: `invite:${membership.projectMembershipId}`, title: cw("邀请你加入「{{project}}」", { project: entry.project.displayName }),
      projectId: entry.project.projectId, projectName: entry.project.displayName, state: '邀请待接受',
      time: formatTime(membership.updatedAt), at: membership.updatedAt, action: '查看需求并接受', membershipId: membership.projectMembershipId, kind: 'invite'
    }, 3)
  }
  for (const dashboard of snapshot?.dashboards ?? []) {
    for (const task of dashboard.tasks) {
      const project = workspace?.projects.find((entry) => entry.project.projectId === task.projectId)
      const changedAt = taskChangedAt(project, task.taskId)
      if (task.assigneeUserId === currentUserId && taskStateLabel(task, deliveryForTask(task, currentUserId, deliveries), agentQuestionForTask(project, task.taskId, task.executionId), currentUserId) === '待提交交付') {
        push({ id: `delivery:${task.taskId}`, title: cw("交付已准备好：{{title}}", { title: task.title }), projectId: task.projectId, projectName: dashboard.projectName, state: '待提交交付', time: formatTime(changedAt), at: changedAt, action: '确认并提交交付', taskId: task.taskId, kind: 'delivery' }, 3)
        continue
      }
      const taskTodo = deliveryTodo({
        projectId: task.projectId, projectName: dashboard.projectName, title: task.title,
        submitter: task.assigneeDisplayName, card: task
      }, currentUserId, projectOwnerUserId(workspace, task.projectId) === currentUserId)
      if (taskTodo?.needsAction && task.primaryAction !== 'accept_offer') {
        push({
          id: `todo:${task.taskId}`, title: taskTodo.title, projectId: task.projectId, projectName: dashboard.projectName,
          state: taskTodo.state, time: formatTime(changedAt), at: changedAt, action: taskTodo.action, taskId: task.taskId, kind: 'delivery'
        }, 3)
        continue
      }
      const offer = localOfferForTask(task, project, snapshot, currentUserId)
      if (!offer.availability || notifiedOfferTaskIds.has(task.taskId) || dismissedTaskIds.has(task.taskId)) continue
      const presentation = offerAvailabilityPresentation(offer.availability)
      push({
        id: `offer:${task.taskId}`, title: offer.availability.canAccept ? cw('新任务待接受：{{title}}', { title: task.title }) : cw('派单状态：{{title}}', { title: task.title }),
        projectId: task.projectId, projectName: dashboard.projectName, state: offer.availability.canAccept ? '待接受' : presentation.label,
        time: formatTime(changedAt), at: changedAt, action: offer.availability.canAccept ? '接受任务' : '查看', taskId: task.taskId, kind: 'offer'
      }, 3)
    }
  }
  return items
}

function completionView(project: ProjectCoordinatorProject | null): WorkspaceCompletionViewModel {
  const confirmed = project?.confirmedRequirements
  if (!project || !confirmed) return { adopted: 0, total: 0, target: null }
  const taskIds = confirmed.workModules.map((module) => canonicalTaskIdForRequirementsModule(confirmed.requirementsDocumentId, module.planItemId))
  const adopted = taskIds.filter((taskId) => taskAdopted(project, taskId)).length
  const ready = project.project.status === 'active' && taskIds.length > 0 && adopted === taskIds.length
  return {
    adopted, total: taskIds.length,
    target: ready ? {
      baselineKind: 'requirements', projectId: project.project.projectId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
      requirementsDocumentId: confirmed.requirementsDocumentId,
      confirmedRequirementsRevision: confirmed.documentRevision,
      adoptedTaskIds: taskIds
    } : null
  }
}

export function createWorkspaceViewModel({ workspace, snapshot, selectedProjectId, route = 'board', files = null, workerDeliveries = {} }: Readonly<{ workspace?: ProjectCoordinatorWorkspace; snapshot?: CollaborationStatusSnapshot; selectedProjectId?: string | null; route?: WorkspaceRoute; files?: DeliveryDriveView | null; workerDeliveries?: Readonly<Record<string, WorkerDeliveryView>> }>): WorkspaceViewModel {
  const currentUserId = workspace?.connection.state === 'ready' ? workspace.connection.userId : null
  const project = selectedProjectId ? workspace?.projects.find((entry) => entry.project.projectId === selectedProjectId) ?? null : workspace?.projects[0] ?? null
  const projectId = project?.project.projectId ?? null
  const dashboard = snapshot?.dashboards?.find((item) => item.projectId === projectId)
  const requirements = requirementsView(project, currentUserId)
  const modules = project?.confirmedRequirements?.workModules ?? project?.requirementsDraft?.workModules ?? []
  const confirmedDocumentId = project?.confirmedRequirements?.requirementsDocumentId
  const moduleDocumentId = confirmedDocumentId ?? project?.requirementsDraft?.requirementsDocumentId
  const matchesModuleDocument = (task: DashboardTaskCard) => task.lineage.requirementsBaselineId === moduleDocumentId
  const moduleIndexById = new Map(modules.map((module, index) => [module.planItemId, index]))
  const ownedProjectIds = new Set(workspace?.projects.filter((entry) => entry.project.ownerUserId === currentUserId).map((entry) => entry.project.projectId) ?? [])
  const dismissedTaskIds = locallyDismissedTaskIds(snapshot, currentUserId, ownedProjectIds)
  const cards: TaskCardModel[] = (dashboard?.tasks.map((task) => {
    const delivery = deliveryForTask(task, currentUserId, workerDeliveries)
    const index = matchesModuleDocument(task) ? moduleIndexById.get(task.lineage.workItemId) : undefined
    const previousRequirements = Boolean(confirmedDocumentId && task.lineage.requirementsBaselineId.startsWith('rqd_') && !matchesModuleDocument(task))
    const offer = project?.offers.find((entry) => entry.taskId === task.taskId && entry.state === 'pending')
    const localOffer = localOfferForTask(task, project, snapshot, currentUserId)
    const question = agentQuestionForTask(project, task.taskId, task.executionId)
    const executionFailure = localFailureForTask(task, snapshot, currentUserId, delivery)
    const recoveryAssignment = assignmentFor(project, task.taskId, offer, project?.memberUsers ?? [])
    const assignment = currentUserId && currentUserId === project?.project.ownerUserId
      ? recoveryAssignment ?? (index !== undefined && task.workflowColumn === 'intake'
        ? firstAssignmentFor(project, task.taskId, task.lineage.workItemId) : undefined)
      : undefined
    const assignmentModule = assignment?.kind === 'first'
      ? modules.find((module) => module.planItemId === assignment.planItemId)
      : undefined
    // A pending or terminal Offer already carries the Task's executable tags.
    // The Owner's replacement list uses the same rule as automatic dispatch.
    const requiredCapabilityTags = assignmentModule?.requiredCapabilityTags
      ?? project?.tasks.find((entry) => entry.task.taskId === task.taskId)?.task.requiredCapabilityTags
      ?? []
    // A decision the gate still allows always wins over an older dismissal.
    const dismissible = localOffer.availability
      ? localOffer.availability.canAccept || localOffer.availability.canReject || localOffer.availability.canDismiss
      : false
    const offerDismissed = dismissedTaskIds.has(task.taskId) && !dismissible
    return taskCard(task, { changedAt: taskChangedAt(project, task.taskId), blockedByLabel: index === undefined ? undefined : requirements?.workModules[index]?.blockedByLabel, executionFailure, stateLabel: taskStateLabel(task, delivery, question, currentUserId, localOffer.availability, executionFailure, snapshot?.projects.find((item) => item.projectId === task.projectId)?.tasks.find((item) => item.taskId === task.taskId && item.executionId === task.executionId && item.workerUserId === currentUserId)?.followup, recoveryAssignment), question: question?.prompt, assignment, reference: previousRequirements ? cw('旧版需求任务') : index === undefined ? undefined : `#${index + 1}`, description: project?.tasks.find((entry) => entry.task.taskId === task.taskId)?.task.objective ?? (index === undefined ? undefined : modules[index]!.objective), offerId: localOffer.taskOfferId ?? offer?.taskOfferId, offerAvailability: localOffer.availability, offerDismissed, offerExpiresAt: offer?.expiresAt, executionId: task.executionId, humanRequest: question, humanRequestId: question?.humanRequestId, assignableWorkerUserIds: assignment && requiredCapabilityTags.length > 0 ? assignableWorkerUserIds(project, requiredCapabilityTags) : undefined })
  }) ?? []).filter((card) => !card.offerDismissed)
  const projectedModuleIds = new Set(dashboard?.tasks.filter(matchesModuleDocument).map((task) => task.lineage.workItemId) ?? [])
  for (const [moduleIndex, module] of modules.entries()) {
    if (projectedModuleIds.has(module.planItemId)) continue
    const requiredCapabilityTags = module.requiredCapabilityTags ?? []
    const assignment = currentUserId && currentUserId === project?.project.ownerUserId && confirmedDocumentId
      ? firstAssignmentFor(project, canonicalTaskIdForRequirementsModule(confirmedDocumentId, module.planItemId), module.planItemId)
      : undefined
    // `assignment.taskId` is the deterministic id the Coordinator will mint on
    // dispatch; until then the module has no Cloud Task, so `cloudTaskId` stays
    // absent and Cloud capabilities for the card are gated off.
    cards.push({ id: `module:${module.planItemId}`, reference: `#${moduleIndex + 1}`, moduleType: '需求模块', title: module.title, description: module.objective, assignee: null, date: '待派出', status: 'intake', stateLabel: '待分配', blockedByLabel: requirements?.workModules[moduleIndex]?.blockedByLabel, projectId: projectId ?? undefined, assignment, assignableWorkerUserIds: assignment && requiredCapabilityTags.length > 0 ? assignableWorkerUserIds(project, requiredCapabilityTags) : undefined })
  }
  const selectedCard = cards.find((card) => card.status === 'review') ?? cards[0] ?? { id: 'empty', reference: '#—', moduleType: '需求模块', title: cw('暂无任务'), assignee: null, date: '—', status: 'intake' as const, projectId: projectId ?? undefined }
  const completion = completionView(project)
  const projects = workspace?.projects.map((entry) => projectModel(entry, currentUserId, snapshot)) ?? []
  const projectsById = new Map(workspace?.projects.map((entry) => [entry.project.projectId, entry]) ?? [])
  const myWork: WorkspacePersonalItem[] = (snapshot?.dashboards ?? []).flatMap((item) => {
    const itemDocument = projectsById.get(item.projectId)?.confirmedRequirements ?? projectsById.get(item.projectId)?.requirementsDraft
    const itemModules = itemDocument?.workModules ?? []
    return item.tasks.filter((task) => (task.assigneeUserId === currentUserId || task.primaryAction === 'adopt_delivery' || task.primaryAction === 'accept_offer') && !dismissedTaskIds.has(task.taskId)).map((task) => {
      const index = task.lineage.requirementsBaselineId === itemDocument?.requirementsDocumentId
        ? itemModules.findIndex((module) => module.planItemId === task.lineage.workItemId) : -1
      const previousRequirements = Boolean(itemDocument && task.lineage.requirementsBaselineId.startsWith('rqd_') && task.lineage.requirementsBaselineId !== itemDocument.requirementsDocumentId)
      const availability = localOfferForTask(task, projectsById.get(task.projectId), snapshot, currentUserId).availability
      const delivery = deliveryForTask(task, currentUserId, workerDeliveries)
      const taskProject = projectsById.get(task.projectId) ?? null
      const assignment = assignmentFor(taskProject, task.taskId, taskProject?.offers.find((offer) => offer.taskId === task.taskId && offer.state === 'pending'), taskProject?.memberUsers ?? [])
      const stateLabel = taskStateLabel(task, delivery, agentQuestionForTask(taskProject, task.taskId, task.executionId), currentUserId, availability, localFailureForTask(task, snapshot, currentUserId, delivery), undefined, assignment)
      const time = task.plannedDueAt ?? taskChangedAt(projectsById.get(task.projectId), task.taskId)
      return { id: `task:${task.taskId}`, reference: previousRequirements ? cw('旧版需求任务') : index < 0 ? undefined : `#${index + 1}`, title: task.title, projectId: task.projectId, projectName: item.projectName, person: task.assigneeDisplayName ?? cw('待分配'), state: stateLabel === '待你接受' ? '待接受' : stateLabel === '待你采纳' ? '待采纳' : stateLabel ?? taskColumnLabels[task.workflowColumn] ?? '进行中', time: formatTime(time), at: time, action: '打开任务', taskId: task.taskId, kind: 'task' }
    })
  })
  const inbox = inboxItems(workspace, snapshot, currentUserId, workerDeliveries, dismissedTaskIds)
  const members: WorkspaceMemberViewModel[] = project?.memberships.map((membership) => ({ id: membership.projectMembershipId, userId: membership.userId, name: project.memberUsers.find((user) => user.userId === membership.userId)?.displayName ?? membership.userId, role: membership.userId === project.project.ownerUserId ? '所有者' : '成员', state: membership.state })) ?? []
  return {
    currentProject: { initials: projectInitials(project?.project.displayName ?? 'Collaboration'), name: project?.project.displayName ?? 'Collaboration', memberCount: members.filter((member) => member.state === 'active').length, status: (project?.project.status ?? 'draft') === 'cancelled' ? 'completed' : (project?.project.status ?? 'draft') as ProjectStatus, description: project?.project.goal ?? '', requirementsRevision: project?.confirmedRequirements?.documentRevision ?? project?.requirementsDraft?.documentRevision ?? 0, ownerName: project?.memberUsers.find((user) => user.userId === project.project.ownerUserId)?.displayName ?? '', ownerUserId: project?.project.ownerUserId, headerAction: completion.target ? '结项' : project?.project.status === 'draft' ? (requirements?.workModules.length && requirements?.acceptanceCriteria.length ? '确认需求' : '编辑需求') : undefined },
    completion, loaded: workspace !== undefined, connection: connectionView(workspace, snapshot),
    projects, selectedProjectId: projectId, cards, selectedCard, route, requirements, members, myWork, inbox, currentUserId, projectId, project, files, mentionableUsers: dashboard?.mentionableUsers ?? []
  }
}
