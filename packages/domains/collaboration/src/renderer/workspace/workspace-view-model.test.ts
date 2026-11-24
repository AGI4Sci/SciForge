import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts'
import { createWorkspaceViewModel } from './workspace-view-model.js'
import { offerAvailabilityPresentation } from './offer-availability.js'
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

test('only this user and exact current execution can label a task as waiting for followup', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const current = task()
  const followup = { key: 'job-result', at, about: 'Read existing output.', state: 'waiting', reason: null }
  const status = snapshot([current]) as any
  const local = { taskId: current.taskId, executionId: current.executionId, workerUserId: workerId, followup }
  status.projects = [{ projectId, tasks: [local] }]
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
  assert.equal(build().cards[0]?.stateLabel, '等待到期复查')
  local.executionId = 'exe_Predecessor0001'
  assert.notEqual(build().cards[0]?.stateLabel, '等待到期复查')
  local.executionId = current.executionId
  local.workerUserId = userId
  assert.notEqual(build().cards[0]?.stateLabel, '等待到期复查')
})

function localDelivery(overrides: Partial<WorkerDeliveryView> = {}): WorkerDeliveryView {
  return {
    projectId, taskId: 'tsk_TestTask0001', executionId: 'exe_TestExecution0001', state: 'waiting_confirmation',
    draft: { selectedMaterials: [], materialError: null, revision: 1, resultRevision: 1, basedOnResultRevision: null, summary: '私有交付草稿总结', aiSummary: null, summaryEdited: false, sourceTurnId: null, sourceRound: 0, sourceUpdatedAt: null, updatedAt: at, changed: false, outputs: [{ fileName: 'README.md', relativePath: 'README.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 42, sha256: 'a'.repeat(64) }] },
    history: [], candidate: null, confirmationTarget: null, operationId: null, deliveryManifestId: null, error: null, residuals: [],
    ...overrides
  }
}

test('Task times survive refreshes and advance only with persisted Task and Delivery changes', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const card = task({ plannedDueAt: null, delivery: 'returned' })
  const view = {
    task: { taskId: card.taskId, title: card.title, currentExecutionId: card.executionId, createdAt: at, updatedAt: at },
    executions: [], delivery: null
  } as any
  source.projects[0].tasks = [view]
  const status = snapshot([card]) as any
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: status })
  const assertTimes = (expected: string) => {
    const model = build()
    const label = new Date(expected).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    assert.deepEqual([model.cards[0]?.dateTime, model.myWork[0]?.at, model.inbox[0]?.at], [expected, expected, expected])
    assert.deepEqual([model.cards[0]?.date, model.myWork[0]?.time, model.inbox[0]?.time], [label, label, label])
  }
  assertTimes(at)

  const refreshedAt = '2026-10-20T10:00:00.000Z'
  card.observedAt = refreshedAt
  source.observedAt = refreshedAt
  source.projects[0].project.updatedAt = refreshedAt
  status.dashboards[0].updatedAt = refreshedAt
  assertTimes(at)

  const changedAt = '2026-10-18T11:00:00.000Z'
  view.task.updatedAt = changedAt
  assertTimes(changedAt)
  const sealedAt = '2026-10-18T12:00:00.000Z'
  view.delivery = { manifest: { deliveryManifestId: 'dm_TestTime0001', sealedAt } }
  assertTimes(sealedAt)
  card.observedAt = '2026-10-21T10:00:00.000Z'
  assertTimes(sealedAt)
})

test('Task times include canonical execution, offer and delivery lifecycle facts', () => {
  const changedAt = '2026-10-18T12:00:00.000Z'
  const cases = [
    { name: 'execution update', executions: [{ updatedAt: changedAt }], delivery: null },
    { name: 'execution start', executions: [{ startedAt: changedAt }], delivery: null },
    { name: 'candidate update', executions: [], delivery: { candidate: { updatedAt: changedAt } } },
    { name: 'revision request', executions: [], delivery: { revisionRequest: { requestedAt: changedAt } } },
    { name: 'integration receipt', executions: [], delivery: { receipt: { createdAt: changedAt } } },
    { name: 'published result', executions: [], delivery: { result: { adoptedAt: changedAt } } }
  ]
  for (const { name, executions, delivery } of cases) {
    const source = workspace() as any
    source.connection.userId = workerId
    const card = task({ plannedDueAt: null })
    source.projects[0].tasks = [{ task: { taskId: card.taskId, createdAt: at, updatedAt: at }, executions, delivery }]
    source.projects[0].offers = [{ taskId: 'tsk_OtherTask0001', updatedAt: '2026-10-22T00:00:00.000Z' }]
    const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([card]) })
    assert.equal(model.cards[0]?.dateTime, changedAt, name)
    assert.equal(model.myWork[0]?.at, changedAt, name)
  }
})

test('deadline cards keep their due date while offer inbox rows show actual changes, never expiry', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const dueAt = '2026-10-25T10:00:00.000Z'
  const card = task({ plannedDueAt: dueAt, primaryAction: 'accept_offer', workflowColumn: 'intake', executionId: null })
  const offer = { taskId: card.taskId, taskOfferId: 'tof_TestAvailable0001', state: 'pending', offeredAt: at, expiresAt: '2026-10-24T10:00:00.000Z', updatedAt: at }
  source.projects[0].offers = [offer]
  const status = withAvailableOffer(snapshot([card]), card)
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: status })
  for (const expected of [at, '2026-10-18T12:00:00.000Z']) {
    offer.updatedAt = expected
    card.observedAt = '2026-10-22T10:00:00.000Z'
    const model = build()
    assert.equal(model.cards[0]?.dateTime, dueAt)
    assert.equal(model.myWork[0]?.at, dueAt)
    assert.equal(model.inbox[0]?.at, expected)
    assert.equal(model.inbox[0]?.kind, 'offer')
  }
})

test('ready delivery inbox time is stable when only the dashboard observation changes', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const card = task({ plannedDueAt: null, delivery: 'worker_review' })
  source.projects[0].tasks = [{ task: { taskId: card.taskId, createdAt: at, updatedAt: at }, executions: [] }]
  for (const observedAt of [at, '2026-10-22T10:00:00.000Z']) {
    card.observedAt = observedAt
    const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([card]) })
    assert.equal(model.inbox[0]?.id, `delivery:${card.taskId}`)
    assert.equal(model.inbox[0]?.at, at)
  }
})

test('missing Task activity stays unknown across refreshes in cards, My Work and every synthesized inbox todo', () => {
  for (const overrides of [
    { primaryAction: 'accept_offer', workflowColumn: 'intake', executionId: null },
    { delivery: 'worker_review' },
    { delivery: 'returned' },
    { primaryAction: 'adopt_delivery', delivery: 'sealed' }
  ]) {
    const source = workspace() as any
    const card = task({ ...overrides, assigneeUserId: userId, plannedDueAt: null })
    source.projects[0].tasks = [{ task: { taskId: 'tsk_OtherTask0001', createdAt: at, updatedAt: at }, executions: [] }]
    source.projects[0].offers = card.primaryAction === 'accept_offer'
      ? [{ taskId: card.taskId, taskOfferId: 'tof_TestAvailable0001', state: 'pending' }]
      : []
    for (const observedAt of [at, '2026-10-22T10:00:00.000Z']) {
      card.observedAt = observedAt
      const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([card]) })
      assert.deepEqual([model.cards[0]?.dateTime, model.myWork[0]?.at, model.inbox[0]?.at], [undefined, undefined, undefined])
      assert.deepEqual([model.cards[0]?.date, model.myWork[0]?.time, model.inbox[0]?.time], ['—', '—', '—'])
    }
  }
})

test('maps needs_human, awaiting review and completed states to board columns', () => {
  const cards = [task({ taskId: 'tsk_human', workflowColumn: 'needs_human', blocker: '请回答', lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0001' }, primaryAction: 'view' }), task({ taskId: 'tsk_review', workflowColumn: 'waiting_result_confirm', delivery: 'sealed', primaryAction: 'adopt_delivery', lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0002' } }), task({ taskId: 'tsk_done', workflowColumn: 'completed', adoption: 'adopted', lineage: { projectId, requirementsBaselineId: 'rqb_TestBaseline0001', workItemId: 'item_Test0003' } })]
  const model = createWorkspaceViewModel({ workspace: workspace(), snapshot: snapshot(cards), selectedProjectId: projectId })
  assert.deepEqual(model.cards.slice(0, 3).map((card) => card.status), ['in-progress', 'review', 'completed'])
  assert.equal(model.cards.find((card) => card.id === 'tsk_human')?.stateLabel, '等待回答')
  assert.equal(model.cards.find((card) => card.id === 'tsk_review')?.stateLabel, '待你采纳')
  // A Dashboard card is backed by the Cloud Task whose id it carries.
  assert.equal(model.cards.find((card) => card.id === 'tsk_human')?.cloudTaskId, 'tsk_human')
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
  // An undispatched module has no Cloud Task, so it must not offer a Cloud id.
  assert.ok(model.cards.every((card) => card.cloudTaskId === undefined))
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
  assert.equal(model.cards[0]?.offerAvailability?.reason, 'reconciliation_required')
  const detail = offerAvailabilityPresentation(model.cards[0]!.offerAvailability!).detail
  assert.match(detail, /暂时无法确认/)
  assert.doesNotMatch(detail, /缺少.*凭据/)
  assert.equal(model.inbox[0]?.action, '查看')
})

test('Cloud Offer projections ahead of the local journal stay pending sync and converge after acceptance', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const offerTask = task({ workflowColumn: 'intake', primaryAction: 'accept_offer', executionId: null })
  const offer = { taskId: offerTask.taskId, taskOfferId: 'tof_TestSync0001', workerUserId: workerId, state: 'pending', executionId: null } as any
  source.projects[0].offers = [offer]
  const status = snapshot([offerTask]) as any
  const build = (deliveries: Record<string, WorkerDeliveryView> = {}) => createWorkspaceViewModel({ workspace: source, snapshot: status, workerDeliveries: deliveries, selectedProjectId: projectId })
  const assertSync = () => {
    const model = build()
    assert.deepEqual(model.cards[0]?.offerAvailability, { state: 'sync_pending', reason: 'synchronization_pending', canAccept: false, canReject: false, canDismiss: false })
    assert.equal(model.cards[0]?.offerId, offer.taskOfferId)
    assert.equal(model.cards[0]?.stateLabel, '待同步')
    assert.equal(model.myWork[0]?.state, '待同步')
    assert.equal(model.inbox[0]?.state, '待同步')
    assert.equal(model.inbox[0]?.action, '查看')
    const detail = offerAvailabilityPresentation(model.cards[0]!.offerAvailability!).detail
    assert.match(detail, /无需重复接受或重新派发/)
    assert.doesNotMatch(detail, /已保存在本机|缺少.*凭据/)
  }
  assertSync()
  status.projects = [{ projectId, tasks: [{ taskId: offerTask.taskId, taskOfferId: offer.taskOfferId, workerUserId: workerId, offerAvailability: availableOffer }] }]
  assert.equal(build().cards[0]?.offerAvailability?.canAccept, true, 'only the backend gate grants a manual decision')

  // Cloud accepts first while this device still exposes the previous journal.
  offer.state = 'accepted'
  offer.executionId = 'exe_TestExecution0001'
  offerTask.executionId = offer.executionId
  source.projects[0].tasks = [{ task: { taskId: offerTask.taskId, currentExecutionId: offer.executionId }, executions: [] }]
  status.projects[0].tasks = []
  assertSync()
  offerTask.primaryAction = 'view'
  offerTask.contractExecution = 'accepted_awaiting_runtime'
  assert.equal(build().cards[0]?.offerAvailability, undefined, 'an accepted execution without a stale accept action uses its normal execution UI')
  status.projects[0].tasks = [{ taskId: offerTask.taskId, taskOfferId: offer.taskOfferId, workerUserId: workerId, offerAvailability: { state: 'sync_pending', reason: 'synchronization_pending', canAccept: false, canReject: false, canDismiss: false } }]
  assertSync()
  const settled = build({ exe_TestExecution0001: localDelivery() })
  assert.equal(settled.cards[0]?.stateLabel, '待提交交付')
  assert.equal(settled.myWork[0]?.state, '待提交交付')
  assert.equal(settled.cards[0]?.offerAvailability?.canAccept, false)
})

test('accepted Cloud Offers preserve explicit local invalid and missing-evidence gates', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const accepted = task({ contractExecution: 'accepted_awaiting_runtime', primaryAction: 'view' })
  source.projects[0].offers = [{ taskId: accepted.taskId, taskOfferId: 'tof_TestFailed0001', state: 'accepted', executionId: accepted.executionId }]
  for (const [state, reason, label] of [
    ['unverified', 'recovery_evidence_missing', '待核实'],
    ['invalid', 'authority_changed', '已失效'],
    ['invalid', 'contract_changed', '已失效'],
    ['invalid', 'offer_expired', '已失效']
  ] as const) {
    const availability = { state, reason, canAccept: false, canReject: false, canDismiss: false }
    const status = snapshot([accepted]) as any
    status.projects = [{ projectId, tasks: [{ taskId: accepted.taskId, taskOfferId: 'tof_TestFailed0001', workerUserId: workerId, offerAvailability: availability }] }]
    const model = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
    assert.deepEqual(model.cards[0]?.offerAvailability, availability)
    assert.equal(model.cards[0]?.stateLabel, label)
    assert.equal(model.myWork[0]?.state, label)
    assert.equal(model.inbox[0]?.state, label)
    assert.equal(model.inbox[0]?.action, '查看')
    if (reason === 'recovery_evidence_missing') assert.match(offerAvailabilityPresentation(availability).detail, /缺少.*凭据/)
  }
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
    assert.equal(model.cards[0]?.stateLabel, '待同步')
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
  const cards = [task({ taskId: 'tsk_second_module', workflowColumn: 'in_progress', assigneeUserId: userId, lineage: { projectId, requirementsBaselineId: 'rqd_TestRequirements0001', workItemId: 'item_Test0002' } })]
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

test('an assignment this Desktop dismissed leaves the board and My Work for its Worker, while the Owner keeps it for dispatch', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const offerTask = task({ taskId: 'tsk_TestDismissed01', workflowColumn: 'intake', primaryAction: 'accept_offer', assigneeUserId: workerId })
  source.projects[0].offers = [{ taskId: offerTask.taskId, taskOfferId: 'tof_TestAvailable0001', state: 'pending' }]
  const notification = { notificationId: 'ntf_TestDismissed1', projectId, taskId: offerTask.taskId, recipientUserId: workerId, kind: 'offer', summary: '任务待接受：验证实验输入', actionRequired: true, expiresAt: null, readAt: null, sourceEventId: 'evt_TestDismissed1', revision: 1, createdAt: at, updatedAt: at }
  const status = withAvailableOffer(snapshot([offerTask], [notification]), offerTask) as any
  status.projects[0].tasks[0].state = 'dismissed'
  status.projects[0].tasks[0].updatedAt = at
  status.projects[0].tasks[0].offerAvailability = { state: 'invalid', reason: 'offer_closed', canAccept: false, canReject: false, canDismiss: false }
  let model = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
  assert.deepEqual(model.cards.filter((card) => card.id === offerTask.taskId), [])
  assert.equal(model.myWork.some((item) => item.taskId === offerTask.taskId), false)
  assert.equal(model.inbox.some((item) => item.taskId === offerTask.taskId), false, 'the dismissed assignment is not an inbox todo either')

  // A newer pending Offer for the same Task is a new assignment and returns.
  status.projects[0].tasks[0] = { taskId: offerTask.taskId, taskOfferId: 'tof_TestAgain0000001', workerUserId: workerId, state: 'awaiting-manual', updatedAt: '2026-10-19T00:00:00.000Z', offerAvailability: availableOffer }
  model = createWorkspaceViewModel({ workspace: source, snapshot: status, selectedProjectId: projectId })
  assert.equal(model.cards.some((card) => card.id === offerTask.taskId), true)

  // The Owner's board is the dispatch surface: dismissing their own Offer must
  // not remove the Task they still have to hand to somebody.
  const ownerSource = workspace() as any
  const ownerTask = task({ taskId: 'tsk_TestOwnerDismiss01', workflowColumn: 'intake', primaryAction: 'accept_offer', assigneeUserId: userId })
  ownerSource.projects[0].offers = [{ taskId: ownerTask.taskId, taskOfferId: 'tof_TestOwnerDismiss1', state: 'pending' }]
  const ownerStatus = withAvailableOffer(snapshot([ownerTask], []), ownerTask) as any
  ownerStatus.projects[0].tasks[0].state = 'dismissed'
  ownerStatus.projects[0].tasks[0].updatedAt = at
  ownerStatus.projects[0].tasks[0].offerAvailability = { state: 'invalid', reason: 'offer_closed', canAccept: false, canReject: false, canDismiss: false }
  const ownerModel = createWorkspaceViewModel({ workspace: ownerSource, snapshot: ownerStatus, selectedProjectId: projectId })
  assert.equal(ownerModel.cards.some((card) => card.id === ownerTask.taskId), true)
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
  project.project.status = 'paused'
  const paused = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([task({ taskId: pendingTaskId })]), selectedProjectId: projectId })
  assert.equal(paused.cards[0]?.assignment, undefined, 'paused projects cannot withdraw and reassign pending offers')
})

test('failed tasks offer reassignment only with the Coordinator task state and retry budget', () => {
  const source = workspace() as any
  const project = source.projects[0]
  const failed = task({ contractExecution: 'failed', workflowColumn: 'waiting_result_confirm' })
  const canonical = {
    taskId: failed.taskId, projectId, status: 'in_progress', revision: 5,
    currentExecutionId: failed.executionId, currentExecutionState: 'failed',
    executionCount: 1, maxRetries: 2, requiredCapabilityTags: []
  }
  project.tasks = [{ task: canonical, executions: [{
    executionId: failed.executionId, projectId, taskId: failed.taskId, state: 'failed', fence: { status: 'fenced' }
  }] }]
  project.offers = [{ projectId, taskId: failed.taskId, taskOfferId: 'tof_TestFailedOffer01',
    executionId: failed.executionId, state: 'accepted' }]
  source.connection.userId = workerId
  const model = () => createWorkspaceViewModel({ workspace: source, snapshot: snapshot([failed]), selectedProjectId: projectId })
  const build = () => model().cards[0]!
  assert.equal(model().myWork[0]?.state, '执行失败')
  assert.equal(build().assignment, undefined, 'a fenced failure alone cannot be reassigned')
  assert.equal(build().stateLabel, '执行失败')
  canonical.status = 'revision_requested'
  assert.equal(build().assignment, undefined, 'the Worker cannot dispatch a successor')
  source.connection.userId = userId
  assert.equal(build().assignment?.kind, 'reassign', 'the Owner can dispatch a formal successor')
  source.connection.userId = workerId
  assert.equal(build().stateLabel, '待重新派发')
  assert.equal(model().myWork[0]?.state, '待重新派发', 'My Work agrees with the board for a formal retry')
  canonical.executionCount = 3
  assert.equal(build().assignment, undefined, 'exhausted retries cannot expose reassignment')
  assert.equal(build().stateLabel, '执行失败')
  canonical.executionCount = 1
  project.project.status = 'paused'
  assert.equal(build().assignment, undefined, 'paused projects cannot dispatch successors')
})

test('pending controls require the exact offered Task and unclaimed offer tuple', () => {
  const source = workspace() as any
  const project = source.projects[0]
  const dashboard = task({ workflowColumn: 'intake', executionId: null, contractExecution: 'unassigned' })
  const canonical = { taskId: dashboard.taskId, projectId, status: 'offered', currentExecutionId: null, currentExecutionState: null }
  const offer = { taskOfferId: 'tof_ExactPending01', taskId: dashboard.taskId, projectId, state: 'pending', executionId: null, workerUserId: workerId, expiresAt: at }
  const reset = () => {
    source.connection = { state: 'ready', userId }
    project.project.status = 'active'
    project.tasks = [{ task: { ...canonical }, executions: [] }]
    project.offers = [{ ...offer }]
  }
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: snapshot([dashboard]), selectedProjectId: projectId }).cards[0]!
  reset()
  assert.equal(build().assignment?.kind, 'withdraw')
  for (const mutate of [
    () => { project.tasks = [] },
    () => { project.tasks[0].task.status = 'in_progress' },
    () => { project.tasks[0].task.currentExecutionId = 'exe_OtherExecution01' },
    () => { project.tasks[0].task.projectId = 'prj_OtherProject01' },
    () => { project.offers[0].executionId = 'exe_OtherExecution01' },
    () => { project.offers[0].projectId = 'prj_OtherProject01' },
    () => { project.project.status = 'paused' },
    () => { source.connection.userId = workerId },
    () => { source.connection.state = 'recovering' }
  ]) {
    reset(); mutate()
    assert.equal(build().assignment, undefined, 'invalid or unauthorized pending controls stay hidden')
  }
})

test('terminal reassignment requires exact revision, resource history and fenced current execution', () => {
  const source = workspace() as any
  const project = source.projects[0]
  const dashboard = task({ contractExecution: 'failed' })
  const canonical = { taskId: dashboard.taskId, projectId, status: 'revision_requested', revision: 4,
    currentExecutionId: null, currentExecutionState: null, executionCount: 1, maxRetries: 2 }
  const terminal = { taskOfferId: 'tof_ExactTerminal01', taskId: dashboard.taskId, projectId, state: 'rejected', executionId: null, reassignmentTaskRevision: 4 }
  const reset = () => {
    project.tasks = [{ task: { ...canonical }, executions: [] }]
    project.offers = [{ ...terminal }]
  }
  const build = () => createWorkspaceViewModel({ workspace: source, snapshot: snapshot([dashboard]), selectedProjectId: projectId }).cards[0]!
  reset(); assert.equal(build().assignment?.kind, 'reassign')
  for (const mutate of [
    () => { project.tasks[0].task.currentExecutionState = 'failed' },
    () => { project.offers[0].reassignmentTaskRevision = 3 },
    () => { delete project.tasks[0].task.revision; delete project.offers[0].reassignmentTaskRevision },
    () => { project.offers[0].projectId = 'prj_OtherProject01' },
    () => { project.tasks[0].task.executionCount = 3 },
    () => { project.tasks[0].task.status = 'completed' }
  ]) {
    reset(); mutate(); assert.equal(build().assignment, undefined)
    assert.equal(build().stateLabel, '执行失败')
  }
  const resetExecution = () => {
    reset()
    Object.assign(project.tasks[0].task, { currentExecutionId: dashboard.executionId, currentExecutionState: 'failed' })
    project.tasks[0].executions = [{ executionId: dashboard.executionId, taskId: dashboard.taskId, projectId, state: 'failed', fence: { status: 'fenced' } }]
    Object.assign(project.offers[0], { state: 'accepted', executionId: dashboard.executionId })
  }
  resetExecution(); assert.equal(build().assignment?.kind, 'reassign')
  for (const mutate of [
    () => { project.tasks[0].executions = [] },
    () => { project.tasks[0].executions[0].taskId = 'tsk_OtherTask01' },
    () => { project.tasks[0].executions[0].projectId = 'prj_OtherProject01' },
    () => { project.tasks[0].executions[0].fence.status = 'open' },
    () => { project.tasks[0].task.currentExecutionState = 'running' },
    () => { project.tasks[0].executions[0].state = 'result_submitted' },
    () => { project.offers[0].state = 'withdrawn' }
  ]) {
    resetExecution(); mutate(); assert.equal(build().assignment, undefined)
  }
})

test('first assignment requires an active owned confirmed module with no existing Task or offer', () => {
  const source = workspace() as any
  const project = source.projects[0]
  project.confirmedRequirements = { ...project.requirementsDraft, state: 'confirmed' }
  const document = project.confirmedRequirements
  const canonicalId = canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_Test0001')
  const dashboard = task({ taskId: canonicalId, workflowColumn: 'intake', executionId: null, contractExecution: 'unassigned',
    lineage: { projectId, requirementsBaselineId: document.requirementsDocumentId, workItemId: 'item_Test0001' } })
  const build = (cards = [dashboard]) => createWorkspaceViewModel({ workspace: source, snapshot: snapshot(cards), selectedProjectId: projectId }).cards.find((card) => card.reference === '#1')!
  assert.equal(build().assignment?.kind, 'first')
  assert.equal(build([]).assignment?.kind, 'first', 'undispatched modules use the same gate')
  for (const mutate of [
    () => { project.project.status = 'paused' },
    () => { source.connection.userId = workerId },
    () => { source.connection.state = 'recovering' },
    () => { project.tasks = [{ task: { taskId: canonicalId }, executions: [] }] },
    () => { project.offers = [{ taskId: canonicalId, state: 'withdrawn' }] },
    () => { document.state = 'draft' }
  ]) {
    project.project.status = 'active'; source.connection = { state: 'ready', userId }
    project.tasks = []; project.offers = []; document.state = 'confirmed'
    mutate()
    assert.equal(build().assignment, undefined)
    assert.equal(build([]).assignment, undefined)
  }
  project.tasks = []; project.offers = []; document.state = 'confirmed'
  assert.equal(build([task({ ...dashboard, taskId: 'tsk_WrongCanonical01' })]).assignment, undefined)
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

test('a new requirements version keeps old Tasks separate and offers its own modules without inheriting adoption', () => {
  const source = workspace() as any
  const project = source.projects[0]
  const previousDocumentId = project.requirementsDraft.requirementsDocumentId
  const document = { ...project.requirementsDraft, requirementsDocumentId: 'rqd_TestRequirements0002', documentRevision: 2, state: 'confirmed' }
  document.workModules[1].dependencyPlanItemIds = ['item_Test0001']
  project.requirementsDraft = null
  project.confirmedRequirements = document
  const oldTaskId = canonicalTaskIdForRequirementsModule(previousDocumentId, 'item_Test0001')
  const oldRunningId = canonicalTaskIdForRequirementsModule(previousDocumentId, 'item_Test0002')
  project.tasks = [
    { task: { taskId: oldTaskId, status: 'completed', objective: 'Original accepted scope' }, delivery: { receipt: { disposition: 'adopted' } } },
    { task: { taskId: oldRunningId, status: 'running', objective: 'Original running scope' } }
  ]
  const previousCards = [
    task({ taskId: oldTaskId, workflowColumn: 'completed', adoption: 'adopted', lineage: { projectId, requirementsBaselineId: previousDocumentId, workItemId: 'item_Test0001' } }),
    task({ taskId: oldRunningId, lineage: { projectId, requirementsBaselineId: previousDocumentId, workItemId: 'item_Test0002' } })
  ]
  const build = (cards = previousCards) => createWorkspaceViewModel({ workspace: source, snapshot: snapshot(cards) })
  const model = build()
  assert.equal(model.completion.adopted, 0)
  assert.equal(model.completion.total, 2)
  assert.equal(model.cards.length, 4)
  for (const taskId of [oldTaskId, oldRunningId]) {
    const old = model.cards.find((card) => card.id === taskId)!
    assert.equal(old.reference, '旧版需求任务')
    assert.equal(old.blockedByLabel, undefined)
    assert.equal(old.assignment, undefined)
    assert.equal(old.cloudTaskId, taskId)
  }
  assert.equal(model.cards.find((card) => card.id === oldTaskId)?.status, 'completed')
  const assignment = model.cards.find((card) => card.reference === '#1')?.assignment
  assert.equal(assignment?.kind, 'first')
  assert.equal(assignment?.kind === 'first' ? assignment.taskId : undefined,
    canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_Test0001'))
  assert.equal(model.cards.find((card) => card.reference === '#2')?.blockedByLabel, '等待 #1 采纳')
  assert.ok(model.myWork.every((item) => item.reference === '旧版需求任务'))
  const currentTaskId = canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_Test0001')
  const currentCard = task({ taskId: currentTaskId, lineage: { projectId, requirementsBaselineId: document.requirementsDocumentId, workItemId: 'item_Test0001' } })
  const projected = build([...previousCards, currentCard])
  assert.equal(projected.cards.length, 4)
  assert.equal(projected.cards.find((card) => card.reference === '#1')?.cloudTaskId, currentTaskId)
  assert.equal(projected.cards.some((card) => card.id === 'module:item_Test0001'), false)
})

test('requirements name dependencies and both projected and unprojected cards wait for actual adoption', () => {
  const source = workspace() as any
  const project = source.projects[0]
  const document = project.requirementsDraft
  document.workModules.push({ planItemId: 'item_Test0003', title: '第三模块', objective: '汇总', dependencyPlanItemIds: ['item_Test0001', 'item_Test0002'] })
  project.confirmedRequirements = document
  const taskId = canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_Test0001')
  project.tasks = [{ task: { taskId, status: 'completed' }, delivery: { receipt: { disposition: 'pending' } } }]
  const build = (projected = false) => createWorkspaceViewModel({ workspace: source, snapshot: snapshot(projected ? [task({ taskId: 'tsk_third', lineage: { projectId, requirementsBaselineId: document.requirementsDocumentId, workItemId: 'item_Test0003' } })] : []) })
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

test('settled delivery facts suppress current Chinese and unknown historical actionable summaries', () => {
  for (const currentUserId of [userId, workerId]) {
    const source = workspace() as any
    source.connection.userId = currentUserId
    const taskId = 'tsk_TestSettledChinese01'
    source.projects[0].tasks = [{ task: { taskId, title: '已完成交付', status: 'completed', currentExecutionId: null }, delivery: { receipt: { disposition: 'adopted' } }, executions: [] }]
    for (const cards of [[], [task({ taskId, adoption: 'adopted', workflowColumn: 'completed' })]]) {
      const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot(cards, ['第 1 版已提交', '已采纳', 'Delivery pipeline paused for manual inspection.'].map((summary, index) => deliveryNotification(`ntf_settled${index}`, taskId, summary, at))) })
      assert.equal(model.inbox.length, 0)
    }
  }
})

test('superseded delivery with a current revision remains rework only for its assignee with or without a dashboard', () => {
  const source = workspace() as any
  const taskId = 'tsk_TestChineseRework01'
  source.projects[0].tasks = [{ task: { taskId, title: '补充对照', status: 'in_progress', currentExecutionId: 'exe_current' }, delivery: { receipt: { disposition: 'superseded' }, manifest: { deliveryManifestId: 'dm_current' }, revisionRequest: { deliveryManifestId: 'dm_current', executionId: 'exe_current' } }, executions: [{ executionId: 'exe_current', assigneeUserId: workerId }] }]
  for (const cards of [[], [task({ taskId, title: '补充对照', executionId: 'exe_current', delivery: 'returned' })]]) {
    for (const currentUserId of [workerId, userId, 'usr_Observer0001']) {
      source.connection.userId = currentUserId
      const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot(cards, [deliveryNotification('ntf_currentrework', taskId, '负责人要求返修', at, { recipientUserId: currentUserId })]) })
      assert.equal(model.inbox.length, 1)
      assert.deepEqual({ title: model.inbox[0]?.title, state: model.inbox[0]?.state, action: model.inbox[0]?.action }, currentUserId === workerId
        ? { title: '返修要求：补充对照', state: '待返修', action: '打开任务' }
        : { title: '返修中：补充对照', state: '返修中', action: '查看' })
    }
  }
})

test('superseded receipt alone does not settle an unresolved Chinese delivery notification', () => {
  const source = workspace() as any
  source.connection.userId = workerId
  const taskId = 'tsk_TestSupersededUnresolved01'
  source.projects[0].tasks = [{ task: { taskId, title: '补充对照', status: 'in_progress', currentExecutionId: 'exe_current' }, delivery: { receipt: { disposition: 'superseded' } }, executions: [{ executionId: 'exe_current', assigneeUserId: workerId }] }]
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([], [deliveryNotification('ntf_supersededunresolved', taskId, '负责人要求返修', at, { recipientUserId: workerId })]) })
  assert.deepEqual({ title: model.inbox[0]?.title, state: model.inbox[0]?.state, action: model.inbox[0]?.action }, { title: '需要你处理：补充对照', state: '交付待处理', action: '查看交付' })
})

test('old revision manifests and executions never grant a current rework action', () => {
  for (const revisionRequest of [
    { deliveryManifestId: 'dm_old', executionId: 'exe_current' },
    { deliveryManifestId: 'dm_current', executionId: 'exe_old' }
  ]) {
    const source = workspace() as any
    source.connection.userId = workerId
    const taskId = 'tsk_TestHistoricalRework01'
    source.projects[0].tasks = [{ task: { taskId, title: '补充对照', status: 'in_progress', currentExecutionId: 'exe_current' }, delivery: { receipt: { disposition: 'superseded' }, manifest: { deliveryManifestId: 'dm_current' }, revisionRequest }, executions: [{ executionId: 'exe_current', assigneeUserId: workerId }, { executionId: 'exe_old', assigneeUserId: workerId }] }]
    for (const cards of [[], [task({ taskId, executionId: 'exe_current' })]]) {
      const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot(cards, [deliveryNotification('ntf_oldrework', taskId, '负责人要求返修', at, { recipientUserId: workerId })]) })
      assert.equal(model.inbox.length, 1)
      assert.notEqual(model.inbox[0]?.state, '待返修')
      assert.notEqual(model.inbox[0]?.action, '打开任务')
      assert.doesNotMatch(model.inbox[0]?.title ?? '', /^返修要求/u)
    }
  }
})

test('adopted and unadopted receipts and completed or cancelled tasks stay settled despite revision facts', () => {
  for (const [disposition, status] of [['adopted', 'in_progress'], ['unadopted', 'in_progress'], ['superseded', 'completed'], ['superseded', 'cancelled']]) {
    for (const currentUserId of [workerId, userId, 'usr_Observer0001']) {
      const source = workspace() as any
      source.connection.userId = currentUserId
      const taskId = 'tsk_TestFinalRework01'
      source.projects[0].tasks = [{ task: { taskId, title: '补充对照', status, currentExecutionId: 'exe_current' }, delivery: { receipt: { disposition }, manifest: { deliveryManifestId: 'dm_current' }, revisionRequest: { deliveryManifestId: 'dm_current', executionId: 'exe_current' } }, executions: [{ executionId: 'exe_current', assigneeUserId: workerId }] }]
      for (const cards of [[], [task({ taskId, executionId: 'exe_current', adoption: disposition === 'superseded' ? 'pending' : disposition, workflowColumn: ['completed', 'cancelled'].includes(status!) ? 'completed' : 'in_progress' })]]) {
        const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot(cards, [deliveryNotification('ntf_finalrework', taskId, '负责人要求返修', at, { recipientUserId: currentUserId })]) })
        assert.deepEqual(model.inbox, [], `${disposition}/${status}/${currentUserId}`)
      }
    }
  }
})

test('an unknown unresolved delivery event cannot grant action to an unrelated member', () => {
  const source = workspace() as any
  source.connection.userId = 'usr_Observer0001'
  const model = createWorkspaceViewModel({ workspace: source, snapshot: snapshot([task()], [deliveryNotification('ntf_foreignrole', 'tsk_TestTask0001', '交付处理暂时阻塞', at)]) })
  assert.equal(model.inbox.length, 1)
  assert.doesNotMatch(model.inbox[0]?.title ?? '', /需要你处理/u)
  assert.equal(model.inbox[0]?.action, '查看')
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

test('latest ready chat draft clears historical failure consistently across board, drawer card and My Work', () => {
  const ws = workspace() as any
  ws.connection.userId = workerId
  const cloudTask = task()
  const status = snapshot([cloudTask], []) as any
  const oldRun = { taskId: cloudTask.taskId, projectId, executionId: cloudTask.executionId, workerUserId: workerId,
    reexecutionInputId: 'old-failed-session', failure: { code: 'upstream_unavailable', retryable: true } }
  status.projects = [{ projectId, tasks: [oldRun] }]
  const latest = localDelivery({ state: 'waiting_confirmation', error: null })
  const build = () => createWorkspaceViewModel({ workspace: ws, snapshot: status, workerDeliveries: { [latest.executionId]: latest } })
  const ready = build()
  assert.equal(ready.cards[0]?.stateLabel, '待提交交付')
  assert.equal(ready.cards[0]?.executionFailure, undefined)
  assert.equal(ready.selectedCard.stateLabel, '待提交交付')
  assert.equal(ready.myWork[0]?.state, '待提交交付')
  assert.equal(oldRun.failure.code, 'upstream_unavailable', 'historical failure is retained in its source')
  latest.state = 'sealed'
  assert.equal(build().cards[0]?.stateLabel, '待负责人采纳')
  assert.equal(build().myWork[0]?.state, '待负责人采纳')
  latest.state = 'executing'
  const executing = build()
  assert.equal(executing.cards[0]?.stateLabel, '执行失败')
  assert.equal(executing.cards[0]?.executionFailure?.reexecutionInputId, 'old-failed-session')
  assert.equal(executing.myWork[0]?.state, '执行失败')
})
