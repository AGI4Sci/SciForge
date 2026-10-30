import { canonicalTaskIdForRequirementsModule, type DashboardTaskCard, type DeliveryDriveView, type ProjectCompletionTarget } from '@sciforge/collaboration-contracts'
import type { WorkerDeliveryView } from '../../worker-delivery.js'
import type { CollaborationOfferAvailability, CollaborationStatusSnapshot } from '../../contract.js'
import { offerAvailabilityPresentation } from './offer-availability.js'
import { capabilityRequirementsSatisfied } from '../../capability-requirements.js'
import type { ProjectCoordinatorProject, ProjectCoordinatorRequirementsCompletion, ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'
import type { BoardColumnId, ProjectModel, ProjectStatus, TaskCardModel, WorkspaceMemberViewModel, WorkspaceStructureModel } from './workspace-types.js'

export type WorkspaceRoute = 'my-work' | 'inbox' | 'board' | 'requirements' | 'files' | 'settings'

export type WorkspaceRequirementsViewModel = Readonly<{
  revision: number | null
  documentRevision: number | null
  state: string
  goalsDeliverables: string
  inputsBoundaries: string
  workModules: readonly Readonly<{ planItemId: string; title: string; objective: string; dependencyLabel: string; blockedByLabel?: string }>[]
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

function taskCard(task: DashboardTaskCard, options: Readonly<{
  stateLabel?: string
  executionFailure?: TaskCardModel['executionFailure']
  blockedByLabel?: string
  assignment?: TaskCardModel['assignment']
  reference?: string
  description?: string
  offerId?: string
  offerAvailability?: CollaborationOfferAvailability
  offerExpiresAt?: string
  executionId?: string | null
  humanRequestId?: string
  question?: string
  assignableWorkerUserIds?: readonly string[]
}> = {}): TaskCardModel {
  const status = columnMap[task.workflowColumn] ?? 'ready'
  const stateLabel = options.stateLabel
  return {
    id: task.taskId, reference: options.reference ?? `#${task.lineage.workItemId}`, moduleType: task.taskKind, title: task.title, description: options.description, question: options.question ?? task.blocker ?? undefined,
    assignee: task.assigneeDisplayName, assigneeUserId: task.assigneeUserId,
    date: task.plannedDueAt ? task.plannedDueAt.slice(5, 10) : task.observedAt.slice(5, 10), status, stateLabel, blockedByLabel: options.blockedByLabel,
    executionFailure: options.executionFailure,
    unread: task.unread, priority: task.primaryAction === 'adopt_delivery' ? 'high' : undefined,
    offerId: options.offerId, offerAvailability: options.offerAvailability, assignment: options.assignment, offerExpiresAt: options.offerExpiresAt, executionId: options.executionId ?? task.executionId,
    humanRequestId: options.humanRequestId, projectId: task.projectId,
    canReturnExecution: Boolean(task.executionId && ['accepted_awaiting_runtime', 'running', 'needs_human'].includes(task.contractExecution)),
    assignableWorkerUserIds: options.assignableWorkerUserIds
  }
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
type AgentQuestion = Readonly<{
  humanRequestId: string
  prompt: string
  targetUserId: string
}>

function agentQuestionForTask(project: ProjectCoordinatorProject | null | undefined, taskId: string, executionId: string | null | undefined): AgentQuestion | undefined {
  if (!project || !executionId) return undefined
  const request = project.pendingHumanNeeded.find((candidate) => (
    candidate.status === 'pending' &&
    candidate.context.scope === 'worker_execution' &&
    candidate.context.taskId === taskId &&
    candidate.context.executionId === executionId
  ))
  if (!request) return undefined
  return { humanRequestId: request.humanRequestId, prompt: request.prompt, targetUserId: request.targetUserId }
}

/** Local Session failures are private and scoped to the exact current assigned execution. */
function localFailureForTask(task: DashboardTaskCard, snapshot: CollaborationStatusSnapshot | undefined, userId: string | null): TaskCardModel['executionFailure'] {
  if (task.assigneeUserId !== userId || !task.executionId ||
      !['running', 'waiting_result_confirm'].includes(task.contractExecution)) return undefined
  const local = snapshot?.projects.find((project) => project.projectId === task.projectId)?.tasks.find((run) =>
    run.taskId === task.taskId && run.executionId === task.executionId && run.workerUserId === userId)
  return local?.failure ? { code: local.failure.code, reexecutionInputId: local.reexecutionInputId } : undefined
}

/** Only the Member the Agent asked may answer; everyone else sees a read-only status. */
function taskStateLabel(task: DashboardTaskCard, delivery: WorkerDeliveryView | undefined, question: AgentQuestion | undefined, currentUserId: string | null, availability?: CollaborationOfferAvailability, failure?: TaskCardModel['executionFailure']): string | undefined {
  if (task.contractExecution === 'failed') return '待重新派发'
  if (task.adoption === 'adopted') return undefined
  if (failure) return '执行失败'
  if (task.primaryAction === 'adopt_delivery') return '待你采纳'
  if (delivery?.state === 'sealed') return '待负责人采纳'
  // A pending question for this exact Execution outranks the broad local
  // "executing" projection, which also covers a run waiting for its human.
  if (question) return question.targetUserId === currentUserId ? '等待回答' : '等待成员回答'
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
  const currentOffer = task.executionId && task.primaryAction !== 'accept_offer'
    ? project?.offers.find((offer) => offer.taskId === task.taskId && offer.executionId === task.executionId)
    : pending ?? (cloudTask?.currentExecutionId === null
      ? project?.offers.find((offer) => offer.taskId === task.taskId && offer.reassignmentTaskRevision === cloudTask.revision)
      : undefined)
  const local = snapshot?.projects?.find((entry) => entry.projectId === task.projectId)?.tasks.find((entry) => (
    entry.taskId === task.taskId && entry.workerUserId === currentUserId && entry.offerAvailability &&
    entry.taskOfferId === currentOffer?.taskOfferId
  ))
  if (local?.offerAvailability) return { taskOfferId: local.taskOfferId, availability: local.offerAvailability }
  if (task.primaryAction !== 'accept_offer') return {}
  return {
    taskOfferId: currentOffer?.taskOfferId,
    availability: { state: 'unverified', reason: 'recovery_evidence_missing', canAccept: false, canReject: false, canDismiss: false }
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

function requirementsView(project: ProjectCoordinatorProject | null): WorkspaceRequirementsViewModel | null {
  const document = project?.confirmedRequirements ?? project?.requirementsDraft
  if (!project || !document) return null
  return { revision: document.revision, documentRevision: document.documentRevision, state: document.state, goalsDeliverables: document.goalsDeliverables, inputsBoundaries: document.inputsBoundaries, workModules: document.workModules.map((module) => {
    const dependencies = document.workModules.flatMap((dependency, index) => module.dependencyPlanItemIds.includes(dependency.planItemId) ? [{ reference: `#${index + 1}`, title: dependency.title, adopted: taskAdopted(project, canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, dependency.planItemId)) }] : [])
    const pending = dependencies.filter((dependency) => !dependency.adopted)
    return { ...module, dependencyLabel: dependencies.length ? `依赖：${dependencies.map((dependency) => `${dependency.reference} ${dependency.title}`).join('、')}` : '可立即开始', blockedByLabel: pending.length ? `等待 ${pending.map((dependency) => dependency.reference).join('、')} 采纳` : undefined }
  }), acceptanceCriteria: document.acceptanceCriteria, confirmed: project?.confirmedRequirements?.documentRevision === document.documentRevision, completion: project?.requirementsCompletion ?? undefined }
}

function projectName(workspace: ProjectCoordinatorWorkspace | undefined, projectId: string): string {
  return workspace?.projects.find((entry) => entry.project.projectId === projectId)?.project.displayName ?? projectId
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 10 ? value.slice(5, 16).replace('T', ' ') : value
}

const terminalOfferLabels: Readonly<Record<string, string>> = { rejected: '原派单已被拒绝', withdrawn: '原派单已撤回', timed_out: '原派单已超时' }

/** Same rule the Coordinator enforces: a pending offer is handed over through withdraw-then-reassign; only the current terminal offer can be succeeded. */
function assignmentFor(project: ProjectCoordinatorProject | null, taskId: string, pending: ProjectCoordinatorProject['offers'][number] | undefined, users: readonly Readonly<{ userId: string; displayName: string }>[]): TaskCardModel['assignment'] {
  if (!project) return undefined
  if (pending) return { kind: 'withdraw', taskOfferId: pending.taskOfferId, workerUserId: pending.workerUserId, workerName: users.find((user) => user.userId === pending.workerUserId)?.displayName ?? pending.workerUserId, expiresAt: formatTime(pending.expiresAt) }
  const view = project.tasks.find(({ task }) => task.taskId === taskId)
  if (!view) return undefined
  for (const offer of project.offers.filter((entry) => entry.taskId === taskId)) {
    if (offer.executionId === null) {
      if (view.task.currentExecutionId === null && offer.state in terminalOfferLabels && offer.reassignmentTaskRevision === view.task.revision) {
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

type InboxNotification = NonNullable<CollaborationStatusSnapshot['notifications']>[number]
type DashboardTask = NonNullable<CollaborationStatusSnapshot['dashboards']>[number]['tasks'][number]

type InboxTask = Readonly<{
  projectId: string
  projectName: string
  title: string
  submitter: string | null
  card: DashboardTask | null
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
        card: existing?.card ?? null
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
  if (!card) return null
  if (card.adoption === 'adopted' || card.adoption === 'superseded') return null
  const submitter = task.submitter ?? '成员'
  if (card.primaryAction === 'adopt_delivery' || (isOwner && card.delivery === 'sealed' && card.adoption === 'pending')) {
    return { title: `${submitter} 提交了交付：${task.title}`, state: '待你采纳', action: '查看交付', needsAction: true }
  }
  if (card.delivery === 'returned') {
    return card.assigneeUserId === currentUserId
      ? { title: `返修要求：${task.title}`, state: '待返修', action: '打开任务', needsAction: true }
      : { title: `返修中：${task.title}`, state: '返修中', action: '查看', needsAction: false }
  }
  if (card.delivery === 'sealed') {
    return { title: `${submitter} 提交了交付：${task.title}`, state: '待负责人采纳', action: '查看交付', needsAction: false }
  }
  if (card.delivery === 'worker_review') {
    return { title: `${submitter} 已提交交付，等待确认：${task.title}`, state: '待确认', action: '查看', needsAction: false }
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
function inboxItems(workspace: ProjectCoordinatorWorkspace | undefined, snapshot: CollaborationStatusSnapshot | undefined, currentUserId: string | null, deliveries: Readonly<Record<string, WorkerDeliveryView>>): WorkspacePersonalItem[] {
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
    const task = notification.taskId ? tasks.get(inboxTaskKey(notification.projectId, notification.taskId)) : undefined
    if (!task) {
      const phase = notification.kind === 'review' ? deliveryEventPhase(notification.summary) : null
      push({
        id: notification.notificationId,
        title: notification.kind === 'offer' ? '派单状态待核实' : phase ? deliveryEventProjectLabels[phase] : notification.summary,
        projectId: notification.projectId, projectName: projectName(workspace, notification.projectId),
        state: notification.kind === 'offer' ? '待核实' : notificationLabels[notification.kind] ?? '通知', time: formatTime(notification.createdAt),
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
        id: notification.notificationId, title: notification.kind === 'offer' && !offer?.availability?.canAccept ? `派单状态：${task.title}` : notification.summary,
        projectId: task.projectId, projectName: task.projectName,
        state: offerPresentation?.label ?? (notification.kind === 'offer' ? '待核实' : notificationLabels[notification.kind] ?? '通知'), time: formatTime(notification.createdAt),
        action: offer?.availability?.canAccept ? '接受任务' : notificationAction(notification.kind), taskId: notification.taskId ?? undefined,
        notificationId: notification.notificationId, notificationIds: [notification.notificationId], kind: notification.kind
      }, notification.actionRequired ? 2 : 1)
      continue
    }
    const owner = currentUserId !== null && projectOwnerUserId(workspace, task.projectId) === currentUserId
    const todo = currentUserId ? deliveryTodo(task, currentUserId, owner) : null
    const phase = notification.kind === 'review' ? deliveryEventPhase(notification.summary) : null
    const submitter = task.submitter ?? '成员'
    let entry: InboxTodo | null = null
    if (todo?.needsAction) entry = todo
    else if (phase === 'adopted') entry = { title: `${task.title} 已采纳`, state: '已采纳', action: '查看', needsAction: false }
    else if (phase === 'published') entry = { title: `成果已发布：${task.title}`, state: '已发布', action: '查看', needsAction: false }
    else if (todo) entry = todo
    else if (!task.card && phase === 'sealed') entry = { title: `${submitter} 提交了交付：${task.title}`, state: '待你采纳', action: '查看交付', needsAction: true }
    else if (!task.card && phase === 'revision_requested') entry = { title: `返修要求：${task.title}`, state: '待返修', action: '打开任务', needsAction: true }
    else if (phase === null && notification.actionRequired) entry = { title: `需要你处理：${task.title}`, state: notificationLabels[notification.kind] ?? '待处理', action: notificationAction(notification.kind), needsAction: true }
    if (!entry) continue
    push({
      id: `notification:${notification.notificationId}`, title: entry.title,
      projectId: task.projectId, projectName: task.projectName, state: entry.state,
      time: formatTime(notification.createdAt), action: entry.action, taskId: notification.taskId ?? undefined,
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
        id: `human:${request.humanRequestId}`, title: `Agent 需要你回答：${task?.title ?? '当前任务'}`,
        projectId: entry.project.projectId, projectName: entry.project.displayName, state: '等待回答',
        time: formatTime(request.updatedAt), action: '回答', taskId, kind: 'human'
      }, 4)
    }
  }
  for (const entry of workspace?.projects ?? []) {
    const membership = entry.memberships.find((candidate) => candidate.state === 'invited' && candidate.userId === currentUserId)
    if (!membership) continue
    push({
      id: `invite:${membership.projectMembershipId}`, title: `邀请你加入「${entry.project.displayName}」`,
      projectId: entry.project.projectId, projectName: entry.project.displayName, state: '邀请待接受',
      time: formatTime(membership.updatedAt), action: '查看需求并接受', membershipId: membership.projectMembershipId, kind: 'invite'
    }, 3)
  }
  for (const dashboard of snapshot?.dashboards ?? []) {
    for (const task of dashboard.tasks) {
      if (task.assigneeUserId === currentUserId && taskStateLabel(task, deliveryForTask(task, currentUserId, deliveries), agentQuestionForTask(workspace?.projects.find((entry) => entry.project.projectId === task.projectId), task.taskId, task.executionId), currentUserId) === '待提交交付') {
        push({ id: `delivery:${task.taskId}`, title: `交付已准备好：${task.title}`, projectId: task.projectId, projectName: dashboard.projectName, state: '待提交交付', time: formatTime(task.observedAt), action: '确认并提交交付', taskId: task.taskId, kind: 'delivery' }, 3)
        continue
      }
      const taskTodo = deliveryTodo({
        projectId: task.projectId, projectName: dashboard.projectName, title: task.title,
        submitter: task.assigneeDisplayName, card: task
      }, currentUserId, projectOwnerUserId(workspace, task.projectId) === currentUserId)
      if (taskTodo?.needsAction && task.primaryAction !== 'accept_offer') {
        push({
          id: `todo:${task.taskId}`, title: taskTodo.title, projectId: task.projectId, projectName: dashboard.projectName,
          state: taskTodo.state, time: formatTime(task.observedAt), action: taskTodo.action, taskId: task.taskId, kind: 'delivery'
        }, 3)
        continue
      }
      const offer = localOfferForTask(task, workspace?.projects.find((entry) => entry.project.projectId === task.projectId), snapshot, currentUserId)
      if (!offer.availability || notifiedOfferTaskIds.has(task.taskId)) continue
      const presentation = offerAvailabilityPresentation(offer.availability)
      push({
        id: `offer:${task.taskId}`, title: `${offer.availability.canAccept ? '新任务待接受' : '派单状态'}：${task.title}`,
        projectId: task.projectId, projectName: dashboard.projectName, state: offer.availability.canAccept ? '待接受' : presentation.label,
        time: formatTime(task.plannedDueAt ?? task.observedAt), action: offer.availability.canAccept ? '接受任务' : '查看', taskId: task.taskId, kind: 'offer'
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
  const requirements = requirementsView(project)
  const modules = project?.confirmedRequirements?.workModules ?? project?.requirementsDraft?.workModules ?? []
  const confirmedDocumentId = project?.confirmedRequirements?.requirementsDocumentId
  const moduleIndexById = new Map(modules.map((module, index) => [module.planItemId, index]))
  const cards = dashboard?.tasks.map((task) => {
    const delivery = deliveryForTask(task, currentUserId, workerDeliveries)
    const index = moduleIndexById.get(task.lineage.workItemId)
    const offer = project?.offers.find((entry) => entry.taskId === task.taskId && entry.state === 'pending')
    const localOffer = localOfferForTask(task, project, snapshot, currentUserId)
    const question = agentQuestionForTask(project, task.taskId, task.executionId)
    const executionFailure = localFailureForTask(task, snapshot, currentUserId)
    const assignment = assignmentFor(project, task.taskId, offer, project?.memberUsers ?? [])
      ?? (confirmedDocumentId && index !== undefined && task.workflowColumn === 'intake' && !project?.offers.some((entry) => entry.taskId === task.taskId)
        ? { kind: 'first' as const, requirementsDocumentId: confirmedDocumentId, planItemId: task.lineage.workItemId, taskId: task.taskId }
        : undefined)
    const assignmentModule = assignment?.kind === 'first'
      ? modules.find((module) => module.planItemId === assignment.planItemId)
      : undefined
    // A pending or terminal Offer already carries the Task's executable tags.
    // The Owner's replacement list uses the same rule as automatic dispatch.
    const requiredCapabilityTags = assignmentModule?.requiredCapabilityTags
      ?? project?.tasks.find((entry) => entry.task.taskId === task.taskId)?.task.requiredCapabilityTags
      ?? []
    return taskCard(task, { blockedByLabel: index === undefined ? undefined : requirements?.workModules[index]?.blockedByLabel, executionFailure, stateLabel: taskStateLabel(task, delivery, question, currentUserId, localOffer.availability, executionFailure), question: question?.prompt, assignment, reference: index === undefined ? undefined : `#${index + 1}`, description: index === undefined ? undefined : modules[index]!.objective, offerId: localOffer.taskOfferId ?? offer?.taskOfferId, offerAvailability: localOffer.availability, offerExpiresAt: offer?.expiresAt, executionId: task.executionId, humanRequestId: question?.humanRequestId, assignableWorkerUserIds: assignment && requiredCapabilityTags.length > 0 ? assignableWorkerUserIds(project, requiredCapabilityTags) : undefined })
  }) ?? []
  const projectedModuleIds = new Set(dashboard?.tasks.map((task) => task.lineage.workItemId) ?? [])
  for (const [moduleIndex, module] of modules.entries()) {
    if (projectedModuleIds.has(module.planItemId)) continue
    const requiredCapabilityTags = module.requiredCapabilityTags ?? []
    cards.push({ id: `module:${module.planItemId}`, reference: `#${moduleIndex + 1}`, moduleType: '需求模块', title: module.title, description: module.objective, assignee: null, date: '待派出', status: 'intake', stateLabel: '待分配', blockedByLabel: requirements?.workModules[moduleIndex]?.blockedByLabel, projectId: projectId ?? undefined, assignment: confirmedDocumentId ? { kind: 'first', requirementsDocumentId: confirmedDocumentId, planItemId: module.planItemId, taskId: canonicalTaskIdForRequirementsModule(confirmedDocumentId, module.planItemId) } : undefined, assignableWorkerUserIds: confirmedDocumentId && requiredCapabilityTags.length > 0 ? assignableWorkerUserIds(project, requiredCapabilityTags) : undefined })
  }
  const selectedCard = cards.find((card) => card.status === 'review') ?? cards[0] ?? { id: 'empty', reference: '#—', moduleType: '需求模块', title: '暂无任务', assignee: null, date: '—', status: 'intake' as const, projectId: projectId ?? undefined }
  const completion = completionView(project)
  const projects = workspace?.projects.map((entry) => projectModel(entry, currentUserId, snapshot)) ?? []
  const projectsById = new Map(workspace?.projects.map((entry) => [entry.project.projectId, entry]) ?? [])
  const myWork: WorkspacePersonalItem[] = (snapshot?.dashboards ?? []).flatMap((item) => {
    const itemModules = projectsById.get(item.projectId)?.confirmedRequirements?.workModules ?? projectsById.get(item.projectId)?.requirementsDraft?.workModules ?? []
    return item.tasks.filter((task) => task.assigneeUserId === currentUserId || task.primaryAction === 'adopt_delivery' || task.primaryAction === 'accept_offer').map((task) => {
      const index = itemModules.findIndex((module) => module.planItemId === task.lineage.workItemId)
      const availability = localOfferForTask(task, projectsById.get(task.projectId), snapshot, currentUserId).availability
      const stateLabel = taskStateLabel(task, deliveryForTask(task, currentUserId, workerDeliveries), agentQuestionForTask(projectsById.get(task.projectId), task.taskId, task.executionId), currentUserId, availability, localFailureForTask(task, snapshot, currentUserId))
      return { id: `task:${task.taskId}`, reference: index < 0 ? undefined : `#${index + 1}`, title: task.title, projectId: task.projectId, projectName: item.projectName, person: task.assigneeDisplayName ?? '待分配', state: stateLabel === '待你接受' ? '待接受' : stateLabel === '待你采纳' ? '待采纳' : stateLabel ?? taskColumnLabels[task.workflowColumn] ?? '进行中', time: formatTime(task.plannedDueAt ?? task.observedAt), action: '打开任务', taskId: task.taskId, kind: 'task' }
    })
  })
  const inbox = inboxItems(workspace, snapshot, currentUserId, workerDeliveries)
  const members: WorkspaceMemberViewModel[] = project?.memberships.map((membership) => ({ id: membership.projectMembershipId, userId: membership.userId, name: project.memberUsers.find((user) => user.userId === membership.userId)?.displayName ?? membership.userId, role: membership.userId === project.project.ownerUserId ? '所有者' : '成员', state: membership.state })) ?? []
  return {
    currentProject: { initials: projectInitials(project?.project.displayName ?? 'Collaboration'), name: project?.project.displayName ?? 'Collaboration', memberCount: members.filter((member) => member.state === 'active').length, status: (project?.project.status ?? 'draft') === 'cancelled' ? 'completed' : (project?.project.status ?? 'draft') as ProjectStatus, description: project?.project.goal ?? '', requirementsRevision: project?.confirmedRequirements?.documentRevision ?? project?.requirementsDraft?.documentRevision ?? 0, ownerName: project?.memberUsers.find((user) => user.userId === project.project.ownerUserId)?.displayName ?? '', ownerUserId: project?.project.ownerUserId, headerAction: completion.target ? '结项' : project?.project.status === 'draft' ? (requirements?.workModules.length && requirements?.acceptanceCriteria.length ? '确认需求' : '编辑需求') : undefined },
    completion, loaded: workspace !== undefined, connection: connectionView(workspace, snapshot),
    projects, selectedProjectId: projectId, cards, selectedCard, route, requirements, members, myWork, inbox, currentUserId, projectId, project, files, mentionableUsers: dashboard?.mentionableUsers ?? []
  }
}
