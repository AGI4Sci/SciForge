import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts'
import { createWorkspaceViewModel } from './workspace-view-model.js'
import type { WorkerDeliveryView } from '../../worker-delivery.js'

const projectId = 'prj_TestWorkspace001'
const userId = 'usr_TestOwner0001'
const workerId = 'usr_TestWorker0001'
const at = '2026-10-18T10:00:00.000Z'
const availableOffer = { state: 'available', reason: 'manual_decision_required', canAccept: true, canReject: true, canDismiss: true } as const

function withAvailableOffer(status: unknown, card: ReturnType<typeof task>) {
  return { ...(status as object), projects: [{ projectId: card.projectId, tasks: [{ taskId: card.taskId, taskOfferId: 'tof_TestAvailable0001', workerUserId: card.assigneeUserId, offerAvailability: availableOffer }] }] } as never
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    projectId, taskId: 'tsk_TestTask0001', schemaVersion: 1, type: 'dashboard_task_card', taskKind: 'task',
    lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0001' },
    title: '验证实验输入', workflowColumn: 'in_progress', contractExecution: 'running', delivery: 'not_submitted', adoption: 'pending',
    contract: { projectId, taskId: 'tsk_TestTask0001', contractRevision: 1, contractDigest: 'a'.repeat(64), executionId: 'exe_TestExecution0001' },
    assigneeUserId: workerId, assigneeDisplayName: '林默', executionId: 'exe_TestExecution0001', unread: true, blocker: null,
    nextAction: null, plannedStartAt: null, plannedDueAt: at, observedAt: at, privateSessionAvailable: false, primaryAction: 'view',
    ...overrides
  }
}

function workspace() {
  return {
    connection: { state: 'ready', userId, deviceId: 'dev_TestDevice0001' }, observedAt: at, focusedProjectId: projectId, availableWorkerUsers: [],
    projects: [{ project: { projectId, ownerUserId: userId, displayName: '实验项目', goal: '目标', status: 'active', revision: 3, coordinatorAgentId: 'agt_TestAgent0001', coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 1, budget: { maxTasks: 10, maxTasksPerRound: 2, maxCoordinationRounds: 2, maxTaskRetries: 1 }, schemaVersion: 1, type: 'project', createdAt: at, updatedAt: at }, coordinatorTransferFeedback: null, plan: null,
      requirementsDraft: { schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at, type: 'project_requirements_document', requirementsDocumentId: 'rqd_TestRequirements0001', projectId, documentRevision: 1, state: 'draft', goalsDeliverables: '交付', inputsBoundaries: '边界', inputReferences: [], workModules: [{ planItemId: 'item_Test0001', title: '第一模块', objective: '完成模块', dependencyPlanItemIds: [] }, { planItemId: 'item_Test0002', title: '第二模块', objective: '完成第二模块', dependencyPlanItemIds: [] }], acceptanceCriteria: [], contentDigest: 'b'.repeat(64), confirmedByUserId: null, confirmedAt: null, supersededAt: null }, requirementsDraftSummary: null, requirementsCompletion: null, confirmedRequirements: null, memberUsers: [{ userId, displayName: '周岚' }, { userId: workerId, displayName: '林默' }], workerGroups: [], tasks: [], offers: [], deliveryDrive: null, pendingHumanNeeded: [], records: [], finalSummary: null, memberships: [{ projectMembershipId: 'pmb_TestMembership001', projectId, userId, state: 'active', revision: 1, createdAt: at, updatedAt: at }], legacyHistory: { readOnly: true, plans: [], tasks: [], executions: [] } }]
  } as never
}

function snapshot(tasks = [task()], notifications: unknown[] = []) {
  return { revision: 1, connection: { state: 'ready' }, providerOptions: [], managedContainers: [], projections: [], projects: [], dashboards: [{ schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at, type: 'cloud_project_dashboard', projectId, projectName: '实验项目', role: 'owner', view: 'board', tasks, activity: [], mentionableUsers: [], materialConflicts: [], activityCursor: null, stale: false, offline: false, revoked: false }], queue: [], notifications, diagnostics: [] } as never
}

function localDelivery(overrides: Partial<WorkerDeliveryView> = {}): WorkerDeliveryView {
  return {
    projectId, taskId: 'tsk_TestTask0001', executionId: 'exe_TestExecution0001', state: 'waiting_confirmation',
    draft: { selectedMaterials: [], materialError: null, revision: 1, resultRevision: 1, basedOnResultRevision: null, summary: '私有交付草稿总结', aiSummary: null, summaryEdited: false, sourceTurnId: null, sourceRound: 0, sourceUpdatedAt: null, updatedAt: at, changed: false, outputs: [{ fileName: 'README.md', relativePath: 'README.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 42, sha256: 'a'.repeat(64) }] },
    history: [], candidate: null, confirmationTarget: null, operationId: null, deliveryManifestId: null, error: null, residuals: [],
    ...overrides
  }
}

test('maps needs_human, awaiting review and completed states to board columns', () => {
  const cards = [task({ taskId: 'tsk_human', workflowColumn: 'needs_human', blocker: '请回答', lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0001' }, primaryAction: 'view' }), task({ taskId: 'tsk_review', workflowColumn: 'waiting_result_confirm', delivery: 'sealed', primaryAction: 'adopt_delivery', lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0002' } }), task({ taskId: 'tsk_done', workflowColumn: 'completed', adoption: 'adopted', lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0003' } })]
  const model = createWorkspaceViewModel({ workspace: workspace(), snapshot: snapshot(cards), selectedProjectId: projectId })
  assert.deepEqual(model.cards.slice(0, 3).map((card) => card.status), ['in-progress', 'review', 'completed'])
  assert.equal(model.cards.find((card) => card.id === 'tsk_human')?.stateLabel, '等待回答')
  assert.equal(model.cards.find((card) => card.id === 'tsk_review')?.stateLabel, '待你采纳')
})

test('keeps the document version separate from the row concurrency revision', () => {
  const source = workspace() as any
  source.projects[0].requirementsDraft.revision = 7
  source.projects[0].requirementsDraft.documentRevision = 2
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([]), selectedProjectId: projectId })
  assert.equal(model.requirements?.revision, 7)
  assert.equal(model.requirements?.documentRevision, 2)
  assert.equal(model.currentProject.requirementsRevision, 2)
})

test('places unprojected requirement modules in intake with sequential card references', () => {
  const model = createWorkspaceViewModel({ workspace: workspace(), snapshot: snapshot([]), selectedProjectId: projectId })
  assert.deepEqual(model.cards.map((card) => card.reference), ['#1', '#2'])
  assert.ok(model.cards.every((card) => card.status === 'intake'))
})

test('aggregates My Work and Inbox across project names', () => {
  const secondProjectId = 'prj_TestWorkspace0002'
  const model = createWorkspaceViewModel({ workspace: workspace(), snapshot: snapshot([task({ projectId: secondProjectId, taskId: 'tsk_second', assigneeUserId: userId, lineage: { projectId: secondProjectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0001' } })], [{ notificationId: 'ntf_TestNotification01', projectId: secondProjectId, taskId: null, recipientUserId: userId, kind: 'system', summary: '邀请加入第二项目', actionRequired: true, expiresAt: null, readAt: null, sourceEventId: 'evt_TestEvent0001', revision: 1, createdAt: at, updatedAt: at }]), selectedProjectId: projectId })
  assert.equal(model.myWork[0]?.projectName, '实验项目')
  assert.equal(model.inbox[0]?.projectName, secondProjectId)
})

test('derives an invitation inbox entry from an invited membership even without notifications', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  source.projects[0].memberships = [{ projectMembershipId: 'pmb_TestInvited0001', projectId, userId: workerId, state: 'invited', revision: 5, createdAt: at, updatedAt: at }]
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([], []), selectedProjectId: projectId })
  assert.equal(model.inbox.length, 1)
  const invite = model.inbox[0]!
  assert.equal(invite.id, 'invite:pmb_TestInvited0001')
  assert.deepEqual({ title: invite.title, state: invite.state, action: invite.action, membershipId: invite.membershipId }, { title: '邀请你加入「实验项目」', state: '邀请待接受', action: '查看需求并接受', membershipId: 'pmb_TestInvited0001' })

  source.projects[0].memberships[0].state = 'active'
  assert.equal(createWorkspaceViewModel({ workspace: source, snapshot: snapshot([], []), selectedProjectId: projectId }).inbox.length, 0)
})

test('derives an offer inbox entry for an accept_offer task assigned to the current user', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const offerTask = task({ taskId: 'tsk_TestOffer0001', title: '整理样本', workflowColumn: 'intake', primaryAction: 'accept_offer', assigneeUserId: workerId })
  source.projects[0].offers = [{ taskId: offerTask.taskId, taskOfferId: 'tof_TestAvailable0001', state: 'pending' }]
  const model = createWorkspaceViewModel({ workspace: source, snapshot: withAvailableOffer(snapshot([offerTask], []), offerTask), selectedProjectId: projectId })
  const offer = model.inbox.find((item) => item.id === 'offer:tsk_TestOffer0001')
  assert.ok(offer)
  assert.deepEqual({ title: offer.title, state: offer.state, action: offer.action, taskId: offer.taskId }, { title: '新任务待接受：整理样本', state: '待接受', action: '接受任务', taskId: 'tsk_TestOffer0001' })
})

test('does not repeat an offer that already has an unread notification', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const offerTask = task({ taskId: 'tsk_TestOffer0002', title: '整理样本', workflowColumn: 'intake', primaryAction: 'accept_offer', assigneeUserId: workerId })
  const notification = { notificationId: 'ntf_TestOffer0002', projectId, taskId: 'tsk_TestOffer0002', recipientUserId: workerId, kind: 'offer', summary: '任务待接受：整理样本', actionRequired: true, expiresAt: null, readAt: null, sourceEventId: 'evt_TestOffer0002', revision: 1, createdAt: at, updatedAt: at }
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([offerTask], [notification]), selectedProjectId: projectId })
  assert.equal(model.inbox.filter((item) => item.taskId === 'tsk_TestOffer0002').length, 1)
  assert.equal(model.inbox[0]?.notificationId, 'ntf_TestOffer0002')
})

test('Offer recovery availability is consistent in board, My Work and notification inbox despite stale Cloud accept action', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const offerTask = task({ taskId: 'tsk_TestRecover0001', workflowColumn: 'intake', primaryAction: 'accept_offer', assigneeUserId: workerId })
  source.projects[0].offers = [{ taskId: offerTask.taskId, taskOfferId: 'tof_TestRecover0001', state: 'pending' }]
  const notification = { notificationId: 'ntf_TestRecovery0001', projectId, taskId: offerTask.taskId, recipientUserId: workerId, kind: 'offer', summary: '任务待接受：验证实验输入', actionRequired: true, expiresAt: null, readAt: null, sourceEventId: 'evt_TestRecovery0001', revision: 1, createdAt: at, updatedAt: at }
  for (const [state, reason, label] of [
    ['recovering', 'authority_unverified', '恢复中'],
    ['sync_pending', 'synchronization_pending', '待同步'],
    ['claimed_elsewhere', 'claimed_by_other_device', '已被其他设备领取'],
    ['invalid', 'offer_expired', '已失效'],
    ['unverified', 'recovery_evidence_missing', '待核实']
  ]) {
    const status = snapshot([offerTask], [notification]) as any
    status.projects = [{ projectId, tasks: [{ taskId: offerTask.taskId, taskOfferId: 'tof_TestRecover0001', workerUserId: workerId, offerAvailability: { state, reason, canAccept: false, canReject: false, canDismiss: false } }] }]
    const model = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
    assert.equal(model.cards[0]?.stateLabel, label, state)
    assert.equal((model.cards[0] as any)?.offerAvailability?.canAccept, false, state)
    assert.equal(model.myWork[0]?.state, label, state)
    assert.equal(model.inbox[0]?.state, label, state)
    assert.equal(model.inbox[0]?.action, '查看', state)
  }
})

test('missing local Offer proof never grants acceptance solely from the Cloud primary action', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([task({ workflowColumn: 'intake', primaryAction: 'accept_offer' })]), selectedProjectId: projectId })
  assert.equal(model.cards[0]?.stateLabel, '待核实')
  assert.equal(model.inbox[0]?.action, '查看')
})

test('an older Offer or another account cannot supply operation availability for the current pending Offer', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const offerTask = task({ workflowColumn: 'intake', primaryAction: 'accept_offer' })
  source.projects[0].offers = [{ taskId: offerTask.taskId, taskOfferId: 'tof_TestNewOffer0001', state: 'pending', workerUserId: workerId }]
  for (const local of [
    { taskOfferId: 'tof_TestOldOffer0001', workerUserId: workerId },
    { taskOfferId: 'tof_TestNewOffer0001', workerUserId: userId }
  ]) {
    const status = snapshot([offerTask]) as any
    status.projects = [{ projectId, tasks: [{ ...local, taskId: offerTask.taskId, offerAvailability: availableOffer }] }]
    const model = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
    assert.equal(model.cards[0]?.offerAvailability?.canAccept, false)
    assert.equal(model.cards[0]?.stateLabel, '待核实')
    assert.equal(model.inbox[0]?.action, '查看')
  }
})

test('historical closed Offers cannot override the current accepted Execution or its pending original receipt', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const currentTask = task({ contractExecution: 'accepted_awaiting_runtime', executionId: 'exe_TestCurrent0001', primaryAction: 'view' })
  source.projects[0].tasks = [{ task: { taskId: currentTask.taskId, revision: 7, currentExecutionId: currentTask.executionId }, executions: [] }]
  source.projects[0].offers = [
    { taskId: currentTask.taskId, taskOfferId: 'tof_TestOldClosed001', state: 'withdrawn', executionId: null, reassignmentTaskRevision: 3 },
    { taskId: currentTask.taskId, taskOfferId: 'tof_TestCurrent0001', state: 'accepted', executionId: currentTask.executionId, reassignmentTaskRevision: null }
  ]
  const status = snapshot([currentTask]) as any
  status.projects = [{ projectId, tasks: [{ taskId: currentTask.taskId, taskOfferId: 'tof_TestOldClosed001', workerUserId: workerId, offerAvailability: { state: 'invalid', reason: 'offer_closed', canAccept: false, canReject: false, canDismiss: false } }] }]
  let model = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
  assert.equal(model.cards[0]?.offerAvailability, undefined, 'an old closed journal is history, not the current execution gate')
  assert.notEqual(model.cards[0]?.stateLabel, '已失效')
  assert.equal(model.inbox.length, 0)

  status.projects[0].tasks.push({ taskId: currentTask.taskId, taskOfferId: 'tof_TestCurrent0001', workerUserId: workerId, offerAvailability: { state: 'sync_pending', reason: 'synchronization_pending', canAccept: false, canReject: false, canDismiss: false } })
  model = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
  assert.equal(model.cards[0]?.offerId, 'tof_TestCurrent0001')
  assert.equal(model.cards[0]?.stateLabel, '待同步', 'the accepted current Offer can still be awaiting its original receipt')
  assert.equal(model.myWork[0]?.state, '待同步')
  assert.equal(model.inbox[0]?.state, '待同步')
})

test('offline verified Offers retain manual decisions while an unknown accepted result stays pending synchronization', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const offerTask = task({ workflowColumn: 'intake', primaryAction: 'accept_offer', executionId: null })
  source.projects[0].offers = [{ taskId: offerTask.taskId, taskOfferId: 'tof_TestAvailable0001', state: 'pending', executionId: null }]
  const status = withAvailableOffer(snapshot([offerTask]), offerTask) as any
  status.projects[0].tasks[0].offerAvailability = { ...availableOffer, reason: 'offline_queue_available' }
  const offline = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
  assert.equal(offline.cards[0]?.offerAvailability?.canAccept, true)
  offerTask.executionId = 'exe_TestCurrent0001'
  offerTask.primaryAction = 'view'
  source.projects[0].offers[0] = { ...source.projects[0].offers[0], state: 'accepted', executionId: offerTask.executionId }
  status.projects[0].tasks[0].offerAvailability = { state: 'sync_pending', reason: 'synchronization_pending', canAccept: false, canReject: false, canDismiss: false }
  const pending = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
  assert.equal(pending.cards[0]?.stateLabel, '待同步')
  assert.equal(pending.myWork[0]?.state, '待同步')
  assert.equal(pending.inbox[0]?.action, '查看')
})

test('labels offer, human, adoption and revision actions', () => {
  const base = workspace() as any
  const cards = [task({ taskId: 'tsk_offer', primaryAction: 'accept_offer', workflowColumn: 'intake', assigneeUserId: userId }), task({ taskId: 'tsk_human', blocker: '回答', workflowColumn: 'needs_human' }), task({ taskId: 'tsk_adopt', primaryAction: 'adopt_delivery', workflowColumn: 'waiting_result_confirm' }), task({ taskId: 'tsk_revision', delivery: 'returned', workflowColumn: 'in_progress' })]
  base.projects[0].offers = [{ taskId: cards[0]!.taskId, taskOfferId: 'tof_TestAvailable0001', state: 'pending' }]
  const model = createWorkspaceViewModel({ workspace: base, snapshot: withAvailableOffer(snapshot(cards), cards[0]!), selectedProjectId: projectId })
  assert.deepEqual(model.cards.slice(0, 4).map((card) => card.stateLabel), ['待你接受', '等待回答', '待你采纳', '返修中'])
})

test('numbers projected tasks by their requirement module, describes them, and labels states in Chinese', () => {
  const cards = [task({ taskId: 'tsk_second_module', workflowColumn: 'in_progress', assigneeUserId: userId, lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0002' } })]
  const model = createWorkspaceViewModel({ workspace: workspace(), snapshot: snapshot(cards), selectedProjectId: projectId })
  const card = model.cards.find((entry) => entry.id === 'tsk_second_module')
  assert.equal(card?.reference, '#2')
  assert.equal(card?.description, '完成第二模块')
  assert.equal(model.myWork[0]?.reference, '#2')
  assert.equal(model.myWork[0]?.state, '进行中')
})

test('reports the real cloud connection state instead of assuming it is connected', () => {
  assert.deepEqual(createWorkspaceViewModel({}).connection, { tone: 'pending', label: '正在连接云端' })
  assert.equal(createWorkspaceViewModel({}).loaded, false)
  const signedOut = { ...(workspace() as object), connection: { state: 'identity_required' } } as never
  assert.equal(createWorkspaceViewModel({ workspace: signedOut }).connection.label, '需要登录')
  assert.equal(createWorkspaceViewModel({ workspace: workspace() }).connection.tone, 'ready')
})

test('a connected Desktop whose queued Cloud commands are blocked shows what they wait for', () => {
  const status = { connection: { configured: true, state: 'connected', lastInboxSequence: 0, pendingOutboxCount: 1,
    outboxWait: { reason: 'agent_identity', since: '2026-10-26T12:57:12.766Z' } } } as never
  const connection = createWorkspaceViewModel({ workspace: workspace(), snapshot: status }).connection
  assert.equal(connection.tone, 'pending')
  assert.equal(connection.waiting, '正在等待这台电脑的 Agent 身份就绪，就绪后会自动发送。')
  assert.equal(createWorkspaceViewModel({ workspace: workspace(), snapshot: { connection: { configured: true, state: 'connected',
    lastInboxSequence: 0, pendingOutboxCount: 0 } } as never }).connection.waiting, undefined)
})

test('a signed-in Desktop without its own Collaboration connection is not reported as connected', () => {
  const status = (connection: Record<string, unknown>) => ({ connection: { configured: false, lastInboxSequence: 0, pendingOutboxCount: 0, ...connection } }) as never
  assert.deepEqual(createWorkspaceViewModel({ workspace: workspace(), snapshot: status({ state: 'connected', configured: true }) }).connection, { tone: 'ready', label: '云端已连接' })
  assert.equal(createWorkspaceViewModel({ workspace: workspace(), snapshot: status({ state: 'unconfigured' }) }).connection.action, 'configure')
  assert.equal(createWorkspaceViewModel({ workspace: workspace(), snapshot: status({ state: 'disconnected', configured: true }) }).connection.action, 'connect')
  const failed = createWorkspaceViewModel({ workspace: workspace(), snapshot: status({ state: 'error', configured: true, lastError: 'Inbox owner unavailable' }) }).connection
  assert.deepEqual([failed.label, failed.detail, failed.action], ['协作连接异常', 'Inbox owner unavailable', 'recover'])
})

test('offers only Workers whose runtimes provide a module executable tags', () => {
  const source = workspace() as any
  const project = source.projects[0]
  project.confirmedRequirements = {
    ...project.requirementsDraft,
    state: 'confirmed',
    workModules: [{
      planItemId: 'item_Test0001',
      title: '第一模块',
      objective: '完成模块',
      dependencyPlanItemIds: [],
      requiredCapabilityTags: ['agent-runtime.codex']
    }]
  }
  project.workerGroups = [
    {
      userId: workerId,
      agents: [{
        projectAvailability: {
          availability: {
            agentActive: true,
            deviceActive: true,
            runtimeCapabilityTags: ['agent-runtime.codex', 'model-access.api']
          }
        }
      }]
    },
    {
      userId: 'usr_TestTopical0001',
      agents: [{
        projectAvailability: {
          availability: {
            agentActive: true,
            deviceActive: true,
            runtimeCapabilityTags: ['public-data-selection']
          }
        }
      }]
    }
  ]
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([]), selectedProjectId: projectId })
  const card = model.cards.find((candidate) => candidate.id === 'module:item_Test0001')
  assert.deepEqual(card?.assignableWorkerUserIds, [workerId])
})

test('finds an invitation in a listed Project that is not the current selection', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  source.projects[0].memberships = [
    { projectMembershipId: 'pmb_TestOwnerMember001', projectId, userId, state: 'active', revision: 1, createdAt: at, updatedAt: at },
    { projectMembershipId: 'pmb_TestWorkerMember01', projectId, userId: workerId, state: 'active', revision: 2, createdAt: at, updatedAt: at }
  ]
  const invitedProjectId = 'prj_TestWorkspace0002'
  const invited = JSON.parse(JSON.stringify(source.projects[0]))
  invited.project = { ...invited.project, projectId: invitedProjectId, displayName: '新项目' }
  invited.requirementsDraft = { ...invited.requirementsDraft, projectId: invitedProjectId }
  invited.memberUsers = []
  invited.tasks = []
  invited.offers = []
  invited.memberships = [{
    projectMembershipId: 'pmb_TestInvited0002', projectId: invitedProjectId, userId: workerId,
    state: 'invited', revision: 5, createdAt: at, updatedAt: at
  }]
  source.projects.push(invited)

  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([], []), selectedProjectId: projectId })

  assert.equal(model.projectId, projectId)
  const invite = model.inbox.find((item) => item.projectId === invitedProjectId)
  assert.ok(invite)
  assert.deepEqual({
    id: invite.id, title: invite.title, projectName: invite.projectName,
    state: invite.state, action: invite.action, membershipId: invite.membershipId
  }, {
    id: 'invite:pmb_TestInvited0002', title: '邀请你加入「新项目」', projectName: '新项目',
    state: '邀请待接受', action: '查看需求并接受', membershipId: 'pmb_TestInvited0002'
  })
})

test('lists eligible replacement Workers for a pending offer addressed to the Owner', () => {
  const source = workspace() as any
  const project = source.projects[0]
  const pendingTaskId = 'tsk_TestPendingTask01'
  project.tasks = [{
    task: {
      taskId: pendingTaskId,
      projectId,
      status: 'offered',
      revision: 5,
      currentExecutionId: null,
      currentExecutionState: null,
      requiredCapabilityTags: ['agent-runtime.codex']
    },
    delivery: null,
    executions: []
  }]
  project.offers = [{
    taskOfferId: 'tof_TestPendingOffer01',
    projectId,
    taskId: pendingTaskId,
    state: 'pending',
    executionId: null,
    reassignmentTaskRevision: null,
    workerUserId: userId,
    expiresAt: '2026-10-20T08:00:00.000Z',
    revision: 1
  }]
  project.workerGroups = [
    {
      userId,
      agents: [{
        projectAvailability: {
          availability: { agentActive: true, deviceActive: true, runtimeCapabilityTags: ['agent-runtime.codex'] }
        }
      }]
    },
    {
      userId: workerId,
      agents: [{
        projectAvailability: {
          availability: { agentActive: true, deviceActive: true, runtimeCapabilityTags: ['agent-runtime.codex'] }
        }
      }]
    },
    {
      userId: 'usr_TestTopical0001',
      agents: [{
        projectAvailability: {
          availability: { agentActive: true, deviceActive: true, runtimeCapabilityTags: ['public-data-selection'] }
        }
      }]
    }
  ]
  const model = createWorkspaceViewModel({
    workspace: source,
    snapshot: snapshot([task({
      taskId: pendingTaskId,
      workflowColumn: 'intake',
      primaryAction: 'accept_offer',
      assigneeUserId: userId,
      lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0001' }
    })]),
    selectedProjectId: projectId
  })

  const card = model.cards.find((candidate) => candidate.id === pendingTaskId)
  assert.equal(card?.assignment?.kind, 'withdraw')
  assert.deepEqual(card?.assignableWorkerUserIds, [userId, workerId])
})

test('private delivery readiness drives board, My Work and the one inbox projection before Cloud submission', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const local = localDelivery()
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: snapshot(), workerDeliveries: { [local.executionId]: local } })
  for (const cloudDelivery of ['not_submitted', 'worker_review']) {
    const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([task({ delivery: cloudDelivery })]), workerDeliveries: { [local.executionId]: local } })
    assert.equal(model.cards[0]?.stateLabel, '待提交交付')
    assert.doesNotMatch(JSON.stringify(model.cards), /私有交付草稿总结|README.md/u)
    assert.equal(model.myWork[0]?.state, '待提交交付')
    assert.equal(model.inbox.filter((item) => item.kind === 'delivery').length, 1)
    assert.equal(model.inbox[0]?.title, '交付已准备好：验证实验输入')
  }
  local.state = 'sealed'
  assert.equal(build().cards[0]?.stateLabel, '待负责人采纳')
  assert.equal(build().myWork[0]?.state, '待负责人采纳')
  assert.equal(build().inbox.length, 0)
  local.state = 'waiting_confirmation'
  local.draft = null
  assert.equal(build().inbox.length, 0)
})

test('an ordinary unfrozen draft is ready after completion and changed files cannot imply active execution', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const local = localDelivery()
  assert.equal(local.candidate, null)
  local.draft = { ...local.draft!, changed: true }
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: snapshot(), workerDeliveries: { [local.executionId]: local } })
  assert.equal(build().cards[0]?.stateLabel, '待提交交付')
  assert.equal(build().myWork[0]?.state, '待提交交付')
  assert.equal(build().inbox.filter((item) => item.kind === 'delivery').length, 1)
  local.state = 'executing'
  assert.equal(build().cards[0]?.stateLabel, '执行中')
  assert.equal(build().myWork[0]?.state, '执行中')
  assert.equal(build().inbox.filter((item) => item.kind === 'delivery').length, 0)
  local.state = 'waiting_confirmation'
  assert.equal(build().cards[0]?.stateLabel, '待提交交付')
})

test('local delivery cannot cross member, Project, Task or execution boundaries', () => {
  const source = workspace() as any
  const local = localDelivery()
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: snapshot(), workerDeliveries: { exe_TestExecution0001: local } })
  assert.notEqual(build().cards[0]?.stateLabel, '待提交交付')
  assert.doesNotMatch(JSON.stringify(build().cards), /私有交付草稿总结|README.md/u)
  assert.equal(build().inbox.length, 0)
  source.connection.userId = workerId
  for (const [key, value] of [['projectId', 'prj_other'], ['taskId', 'tsk_other'], ['executionId', 'exe_other']] as const) {
    const before = local[key]
    local[key] = value
    assert.notEqual(build().cards[0]?.stateLabel, '待提交交付')
    assert.doesNotMatch(JSON.stringify(build().cards), /私有交付草稿总结|README.md/u)
    assert.equal(build().inbox.length, 0)
    local[key] = before
  }
})

test('requirements name dependencies and both projected and unprojected cards wait for actual adoption', () => {
  const source = workspace() as any
  const project = source.projects[0]
  const document = project.requirementsDraft
  document.workModules.push({ planItemId: 'item_Test0003', title: '第三模块', objective: '汇总', dependencyPlanItemIds: ['item_Test0001', 'item_Test0002'] })
  project.confirmedRequirements = document
  const taskId = canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_Test0001')
  project.tasks = [{ task: { taskId, status: 'completed' }, delivery: { receipt: { disposition: 'pending' } } }]
  const build = (projected = false) => createWorkspaceViewModel({ workspace: source, snapshot: snapshot(projected ? [task({ taskId: 'tsk_third', lineage: { workItemId: 'item_Test0003' } })] : []) })
  assert.equal(build().requirements?.workModules[0]?.dependencyLabel, '可立即开始')
  assert.equal(build().requirements?.workModules[2]?.dependencyLabel, '依赖：#1 第一模块、#2 第二模块')
  assert.equal(build().cards.find((card) => card.reference === '#3')?.blockedByLabel, '等待 #1、#2 采纳')
  assert.equal(build(true).cards.find((card) => card.reference === '#3')?.blockedByLabel, '等待 #1、#2 采纳')
  project.tasks[0].delivery.receipt.disposition = 'adopted'
  assert.equal(build().cards.find((card) => card.reference === '#3')?.blockedByLabel, '等待 #2 采纳')
  project.tasks.push({ task: { taskId: canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_Test0002'), status: 'completed' }, delivery: { receipt: { disposition: 'adopted' } } })
  assert.equal(build().cards.find((card) => card.reference === '#3')?.blockedByLabel, undefined)
})

function deliveryNotification(notificationId: string, taskId: string, summary: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return { notificationId, projectId, taskId, recipientUserId: userId, kind: 'review', summary, actionRequired: true, expiresAt: null, readAt: null, sourceEventId: `evt_${notificationId}`, revision: 1, createdAt, updatedAt: createdAt, ...overrides }
}

test('merges English delivery process events into one Chinese Owner todo with the task title', () => {
  const cards = [task({ taskId: 'tsk_TestSealed0001', title: '整理样本', delivery: 'sealed', workflowColumn: 'waiting_result_confirm', primaryAction: 'adopt_delivery' })]
  const model = createWorkspaceViewModel({
    workspace: workspace(),
    snapshot: snapshot(cards, [
      deliveryNotification('ntf_TestCandidate01', 'tsk_TestSealed0001', 'Worker confirmed a Delivery candidate; its review is in progress.', '2026-10-18T10:00:00.000Z'),
      deliveryNotification('ntf_TestSealed0001', 'tsk_TestSealed0001', 'Worker sealed an immutable Delivery manifest; it awaits the Coordinator decision.', '2026-10-18T10:05:00.000Z')
    ]),
    selectedProjectId: projectId
  })
  const items = model.inbox.filter((item) => item.taskId === 'tsk_TestSealed0001')
  assert.equal(items.length, 1)
  assert.deepEqual({ title: items[0]?.title, state: items[0]?.state, action: items[0]?.action }, {
    title: '林默 提交了交付：整理样本', state: '待你采纳', action: '查看交付'
  })
  assert.deepEqual(items[0]?.notificationIds, ['ntf_TestCandidate01', 'ntf_TestSealed0001'])
  assert.doesNotMatch(model.inbox.map((item) => item.title).join('\n'), /Worker|Coordinator|Delivery manifest/iu)
})

test('drops the merged Delivery todo once the Owner handled the task', () => {
  const cards = [task({ taskId: 'tsk_TestAdopted0001', title: '整理样本', delivery: 'sealed', adoption: 'adopted', workflowColumn: 'completed', primaryAction: 'view' })]
  const model = createWorkspaceViewModel({
    workspace: workspace(),
    snapshot: snapshot(cards, [deliveryNotification('ntf_TestSealed0002', 'tsk_TestAdopted0001', 'Worker sealed an immutable Delivery manifest; it awaits the Coordinator decision.', at)]),
    selectedProjectId: projectId
  })
  assert.deepEqual(model.inbox.filter((item) => item.taskId === 'tsk_TestAdopted0001'), [])
})

test('turns a Cloud revision request into a Chinese rework todo for the member', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const cards = [task({ taskId: 'tsk_TestRevision0001', title: '整理样本', delivery: 'returned', workflowColumn: 'in_progress' })]
  const model = createWorkspaceViewModel({
    workspace: source,
    snapshot: snapshot(cards, [deliveryNotification('ntf_TestRevision01', 'tsk_TestRevision0001', 'Coordinator requested a revision; the Worker continues in the same private Session.', at)]),
    selectedProjectId: projectId
  })
  const item = model.inbox.find((entry) => entry.taskId === 'tsk_TestRevision0001')
  assert.deepEqual({ title: item?.title, state: item?.state, action: item?.action }, {
    title: '返修要求：整理样本', state: '待返修', action: '打开任务'
  })
  assert.doesNotMatch(item?.title ?? '', /Coordinator/u)
})

test('tells the member that the Owner adopted their delivery', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const cards = [task({ taskId: 'tsk_TestWorkerAdopted01', title: '整理样本', delivery: 'sealed', adoption: 'adopted', workflowColumn: 'completed', primaryAction: 'view' })]
  const model = createWorkspaceViewModel({
    workspace: source,
    snapshot: snapshot(cards, [deliveryNotification('ntf_TestAdopted0002', 'tsk_TestWorkerAdopted01', 'Coordinator adopted the sealed Delivery.', at)]),
    selectedProjectId: projectId
  })
  const item = model.inbox.find((entry) => entry.taskId === 'tsk_TestWorkerAdopted01')
  assert.deepEqual({ title: item?.title, state: item?.state }, { title: '整理样本 已采纳', state: '已采纳' })
})

test('keeps an unmapped actionable Cloud Delivery event visible in Chinese with its task title', () => {
  const cards = [task({ taskId: 'tsk_TestUnmapped0001', title: '整理样本' })]
  const model = createWorkspaceViewModel({
    workspace: workspace(),
    snapshot: snapshot(cards, [deliveryNotification('ntf_TestUnmapped001', 'tsk_TestUnmapped0001', 'Delivery pipeline paused for manual inspection.', at)]),
    selectedProjectId: projectId
  })
  const item = model.inbox.find((entry) => entry.taskId === 'tsk_TestUnmapped0001')
  assert.deepEqual({ title: item?.title, state: item?.state }, { title: '需要你处理：整理样本', state: '交付待处理' })
})

test('resolves the task title from the loaded workspace when the dashboard has no card yet', () => {
  const source = workspace() as any
  source.projects[0].tasks = [{ task: { taskId: 'tsk_TestSealed0003', title: '工作区样本整理', currentExecutionId: null }, delivery: { receipt: null }, executions: [] }]
  const model = createWorkspaceViewModel({
    workspace: source,
    snapshot: snapshot([], [deliveryNotification('ntf_TestSealed0003', 'tsk_TestSealed0003', 'Worker sealed an immutable Delivery manifest; it awaits the Coordinator decision.', at)]),
    selectedProjectId: projectId
  })
  const item = model.inbox.find((entry) => entry.taskId === 'tsk_TestSealed0003')
  assert.deepEqual({ title: item?.title, state: item?.state }, { title: '成员 提交了交付：工作区样本整理', state: '待你采纳' })
})

test('a Cloud-authorized Owner adoption action remains available even for their own assigned task', () => {
  const model = createWorkspaceViewModel({ workspace: workspace(), snapshot: snapshot([task({ assigneeUserId: userId, primaryAction: 'adopt_delivery', delivery: 'sealed', workflowColumn: 'waiting_result_confirm' })]) })
  assert.equal(model.cards[0]?.stateLabel, '待你采纳')
  assert.equal(model.myWork[0]?.state, '待采纳')
})

const humanTaskId = 'tsk_TestHumanTask001'
const humanExecutionId = 'exe_TestHumanExec001'
const humanPrompt = '请确认汇总使用全部样本还是只使用合格批次。'

function humanNeeded(taskId = humanTaskId, executionId = humanExecutionId, targetUserId = workerId, prompt = humanPrompt) {
  return {
    schemaVersion: 1, revision: 2, createdAt: at, updatedAt: at, type: 'human_needed',
    humanRequestId: 'hrq_TestHumanRequest01', projectId,
    context: { scope: 'worker_execution', taskId, executionId },
    targetUserId, requestedByAgentId: 'agt_TestAgent0001', requiredAssurance: 'verified',
    prompt, confirmableAction: null, status: 'pending', expiresAt: '2026-10-21T00:00:00.000Z'
  }
}

function humanTask(overrides: Record<string, unknown> = {}) {
  return task({
    taskId: humanTaskId, title: '汇总说明', workflowColumn: 'needs_human', contractExecution: 'needs_human',
    executionId: humanExecutionId, blocker: null, ...overrides
  })
}

test('the asked Worker sees the Agent question, its answer entry and its inbox todo from the pending HumanNeeded fact', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  source.projects[0].pendingHumanNeeded = [humanNeeded()]
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([humanTask()]), selectedProjectId: projectId })
  const card = model.cards.find((entry) => entry.id === humanTaskId)
  assert.equal(card?.stateLabel, '等待回答')
  assert.equal(card?.question, humanPrompt)
  assert.equal(card?.humanRequestId, 'hrq_TestHumanRequest01')
  assert.equal(model.myWork.find((entry) => entry.taskId === humanTaskId)?.state, '等待回答')
  assert.deepEqual(model.inbox.map(({ title, state, action, taskId, kind }) => ({ title, state, action, taskId, kind })), [
    { title: 'Agent 需要你回答：汇总说明', state: '等待回答', action: '回答', taskId: humanTaskId, kind: 'human' }
  ])

  // The answer resolves the request; the execution may still show needs_human until the Cloud refreshes.
  source.projects[0].pendingHumanNeeded = []
  const answered = createWorkspaceViewModel({
    workspace: source,
    snapshot: snapshot([humanTask({ contractExecution: 'needs_human' })]),
    selectedProjectId: projectId
  })
  assert.equal(answered.cards.find((entry) => entry.id === humanTaskId)?.stateLabel, undefined)
  assert.equal(answered.cards.find((entry) => entry.id === humanTaskId)?.question, undefined)
  assert.equal(answered.myWork.find((entry) => entry.taskId === humanTaskId)?.state, '进行中')
  assert.deepEqual(answered.inbox.filter((entry) => entry.taskId === humanTaskId), [])
})

test('a pending Agent question outranks the local executing projection of the same run', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  source.projects[0].pendingHumanNeeded = [humanNeeded()]
  const local = localDelivery({ taskId: humanTaskId, executionId: humanExecutionId, state: 'executing', draft: null })
  const model = createWorkspaceViewModel({
    workspace: source,
    snapshot: snapshot([humanTask()]),
    selectedProjectId: projectId,
    workerDeliveries: { [humanExecutionId]: local }
  })
  const card = model.cards.find((entry) => entry.id === humanTaskId)
  assert.equal(card?.stateLabel, '等待回答')
  assert.equal(card?.question, humanPrompt)
  assert.equal(model.myWork.find((entry) => entry.taskId === humanTaskId)?.state, '等待回答')
})

test('the Owner and other Members see the read-only waiting label and no inbox answer todo', () => {
  for (const viewer of [userId, 'usr_TestAlice00001']) {
    const source = workspace() as any
    source.connection.userId = viewer
    source.projects[0].pendingHumanNeeded = [humanNeeded()]
    const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([humanTask()]), selectedProjectId: projectId })
    assert.equal(model.cards.find((entry) => entry.id === humanTaskId)?.stateLabel, '等待成员回答')
    assert.equal(model.inbox.some((entry) => entry.taskId === humanTaskId), false)
  }
})

test('a HumanNeeded request only paints the exact execution it belongs to', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  source.projects[0].pendingHumanNeeded = [humanNeeded(humanTaskId, 'exe_TestOlderExec001')]
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([humanTask()]), selectedProjectId: projectId })
  assert.equal(model.cards.find((entry) => entry.id === humanTaskId)?.stateLabel, undefined)
  assert.deepEqual(model.inbox.filter((entry) => entry.taskId === humanTaskId), [])
})


test('local turn failure paints only its exact assigned Task and clears when new input is executing', () => {
  const ws = workspace() as { connection: { userId: string } }
  ws.connection.userId = workerId
  const card = task()
  const status = snapshot([card], []) as any
  const local = { taskId: card.taskId, projectId, executionId: card.executionId, workerUserId: workerId,
    reexecutionInputId: 'failed-source', failure: { code: 'upstream_unavailable', retryable: true } }
  status.projects = [{ projectId, tasks: [local] }]
  const view = () => createWorkspaceViewModel({ workspace: ws as never, snapshot: status })
  assert.equal(view().cards[0]?.stateLabel, '执行失败')
  assert.equal(view().cards[0]?.executionFailure?.reexecutionInputId, 'failed-source')
  assert.equal(view().myWork[0]?.state, '执行失败')
  local.executionId = 'different-execution'
  assert.equal(view().cards[0]?.executionFailure, undefined)
  local.executionId = card.executionId
  ws.connection.userId = userId
  assert.equal(view().cards[0]?.executionFailure, undefined, 'another account cannot consume private Worker facts')
  ws.connection.userId = workerId
  delete (local as Partial<typeof local>).failure
  assert.equal(view().cards[0]?.executionFailure, undefined)
})

test('temporary Device uncertainty is a pending reconnect while rejected authority stays actionable', () => {
  for (const reasonCode of ['authority_unverified', 'authority_rejected'] as const) {
    const source = { ...(workspace() as object), connection: { state: 'cloud_unavailable', reasonCode, reason: 'Device access was rejected' } } as never
    const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot(), selectedProjectId: projectId })
    assert.equal(model.currentUserId, null, 'cached Projects never grant an offline Owner role')
    if (reasonCode === 'authority_unverified') {
      assert.equal(model.connection.tone, 'pending')
      assert.equal(model.connection.label, '正在重新连接')
      assert.doesNotMatch(model.connection.detail ?? '', /rejected/u)
    } else {
      assert.equal(model.connection.tone, 'attention')
      assert.equal(model.connection.detail, 'Device access was rejected')
    }
  }
})
