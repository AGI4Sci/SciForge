import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'

import { createCollaborationHttpServer } from '../packages/collaboration-server/src/api.ts'
import { stableDigest } from '../packages/collaboration-server/src/crypto.ts'
import { CollaborationService } from '../packages/collaboration-server/src/service.ts'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from '../packages/collaboration-server/src/test-fixtures/collaboration-identity.ts'
import {
  FakeCollaborationRepository,
  FakeCollaborationRequestActorResolver,
  FakeClock,
  fakeAgentActor
} from '../test-fixtures/collaboration/fake-adapters.mjs'

const DESIGN_SCENARIOS = Object.freeze({
  4: Object.freeze({
    name: '深海生物制造产业创新中心设计评审',
    goal: '讨论深海生物制造产业创新中心下一阶段的发展重点：从中心现状出发确定高价值海洋产品和海洋天然产物新药的优先方向，并形成可执行的产业化设计计划；只做设计分析，不执行实验。',
    sourceLabel: 'scenario-1-attachment',
    firstLandingTask: '比较高价值海洋产品候选的需求、技术成熟度和产业化路径，形成首个可评审设计任务（decision:proposed，待 Coordinator 确认）。',
    designMetric: 'metric:设计子题覆盖率; threshold:4/4; measurement:每个角色均有一个 accepted Worker result; source:scenario-1-attachment',
    hardConstraint: '不得把未验证的市场、技术或实验结果写成既成事实。',
    risk: '专家依据不完整或角色之间出现方向冲突。',
    humanConfirmation: 'Coordinator 确认首个落地任务、指标阈值及任何后续外部执行前置条件。',
    nextAction: 'Coordinator 在下一次设计评审前逐项确认角色结论、来源和指标。',
    disagreement: '若产业优先级与技术/投资风险判断冲突，以 Coordinator 标记的待确认决策门为准，不把冲突写成已解决事实。',
    brief: '附件要求覆盖中心最需解决的 3 个问题、高价值海洋产品和海洋天然产物新药优先方向、每个方向的下一步任务/负责人/时间节点，以及资源、合作方、决策事项和未共识待讨论项。',
    requiredClaims: Object.freeze([
      '中心最需解决的 3 个问题（由 Coordinator 依据专家报告确认）',
      '高价值海洋产品与海洋天然产物新药的优先方向',
      '每个优先方向的下一步任务、负责人和时间节点',
      '需要补充的资源、合作方和决策事项',
      '未达成共识的内容列为待讨论事项'
    ]),
    roles: Object.freeze([
      Object.freeze({ role: '产业进展与能力缺口', subQuestion: '产业进展、关键能力缺口和首个可验证落地切口。', conclusion: '将能力缺口拆成首个设计任务的输入边界。' }),
      Object.freeze({ role: '海洋高价值产品与市场', subQuestion: '高价值海洋产品方向、用户需求和市场验证设计。', conclusion: '优先选择可被明确用户需求检验的产品假设。' }),
      Object.freeze({ role: '天然产物与药物方向', subQuestion: '天然产物药物方向的候选路径与设计依据。', conclusion: '把候选路径及其依据列为待评审设计分支。' }),
      Object.freeze({ role: '技术投资风险与资源伙伴', subQuestion: '技术、投资、资源伙伴和实施风险的设计约束。', conclusion: '把风险、资源伙伴和决策门列入整体方案。' })
    ])
  }),
  5: Object.freeze({
    name: '自进化蛋白设计方案评审',
    goal: '讨论如何为深海生物制造和海洋天然产物研发设计一个可持续自我改进的蛋白质设计 Agent，并确定首个落地任务、专家分工和验证方式；本轮只做设计分析，不执行实验、模拟或湿实验。',
    sourceLabel: 'scenario-2-attachment',
    firstLandingTask: '从酶、抗体或结合蛋白中提出 1–2 个首选蛋白质设计任务及选择理由（decision:proposed，待 Coordinator 确认）。',
    designMetric: 'metric:设计交付完整度; threshold:5/5 roles each provide metric+baseline+measurement proposal; measurement:Coordinator checklist; source:scenario-2-attachment',
    hardConstraint: '本轮只提交设计假设和评估方法，不生成或执行实验方案。',
    risk: '设计假设、基准或风险判断可能缺少可验证资料。',
    humanConfirmation: 'Coordinator 确认首个设计任务、成功指标与任何进入执行阶段前的人工审批点。',
    nextAction: 'Coordinator 在下一次设计评审前确认指标、基准、约束和风险责任人。',
    disagreement: '若结构/生信、Agent/ML 与风险治理意见不一致，保留对应 Result ID，交由 Coordinator 在确认门前裁决。',
    brief: '附件要求覆盖 1–2 个首选蛋白质设计任务及理由、Agent 主要模块与 Worker 分工、设计—模拟—实验—反馈—再设计的迭代描述（本轮只写设计）、指标/基准/计算与实验硬约束、风险控制，以及下一阶段试点负责人和交付时间。',
    requiredClaims: Object.freeze([
      '1–2 个首选蛋白质设计任务及选择理由',
      'Agent 的主要模块与专家 Worker 分工',
      '设计—模拟—实验—反馈—再设计的迭代方式（仅设计描述）',
      '量化成功指标、基准、测量方法及计算/实验硬约束',
      '风险控制、人工确认点、下一阶段试点负责人和交付时间'
    ]),
    roles: Object.freeze([
      Object.freeze({ role: '首个蛋白工程落地任务', subQuestion: '明确首个 Agent 应落地的蛋白工程设计任务和边界。', conclusion: '首个任务必须先固定目标、输入边界和确认责任人。' }),
      Object.freeze({ role: '结构与生信设计', subQuestion: '结构、生信假设和候选设计的分析路径。', conclusion: '结构与生信假设应作为可审阅的设计分支记录。' }),
      Object.freeze({ role: 'Agent 架构与 ML', subQuestion: 'Agent 架构、模型方法和可复用工作流设计。', conclusion: 'Agent/ML 方法应以可复用的分析步骤和限制条件表达。' }),
      Object.freeze({ role: '评估指标与基准', subQuestion: '量化成功指标、阈值、基准和测量方法的设计。', conclusion: '每项设计主张都应预先绑定指标、目标值、基准和测量方法。' }),
      Object.freeze({ role: '风险治理与人工确认', subQuestion: '风险、硬约束、人工确认点和停止条件的设计。', conclusion: '风险与人工确认点必须在设计包中成为显式决策门。' })
    ])
  })
})

/**
 * This is intentionally a text-only acceptance slice. It exercises the same
 * HTTP command boundary used by a Coordinator Desktop and Worker Desktop,
 * while keeping the Content Space path out of scope (`fileIntent: null`).
 */
test('MVP S1: four Workers return an attributed design review package', async () => {
  const result = await runTextReportScenario({ key: 's1-four-workers', workerCount: 4 })
  assert.equal(result.workerCount, 4)
  assert.equal(result.finalSummary.acceptedResultSubmissionIds.length, 4)
  assert.equal(result.project.status, 'completed')
  assertDesignPackage(result)
})

test('MVP S2: five Workers return an attributed protein-design package without execution', async () => {
  const result = await runTextReportScenario({ key: 's2-five-workers', workerCount: 5 })
  assert.equal(result.workerCount, 5)
  assert.equal(result.finalSummary.acceptedResultSubmissionIds.length, 5)
  assert.equal(result.project.status, 'completed')
  assertDesignPackage(result)
})

async function runTextReportScenario({ key, workerCount }) {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const service = new CollaborationService({ repository, now: clock.now })
  const actorResolver = new FakeCollaborationRequestActorResolver({ repository, now: clock.now })
  const server = createCollaborationHttpServer({
    service,
    authentication: actorResolver,
    readiness: async () => true
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`

  try {
    const scenario = DESIGN_SCENARIOS[workerCount]
    assert.ok(scenario)
    const owner = await provisionParticipant({
      service,
      repository,
      actorResolver,
      identityLabel: `${key} Coordinator`,
      tokenLabel: `${key}-coordinator`
    })
    const workers = []
    for (let index = 0; index < workerCount; index += 1) {
      const worker = await provisionParticipant({
        service,
        repository,
        actorResolver,
        identityLabel: `${key} Worker ${index + 1}`,
        tokenLabel: `${key}-worker-${index + 1}`
      })
      workers.push(worker)
      await publishWorkerAvailability({
        baseUrl,
        token: worker.agentToken,
        agent: worker.agent,
        key: `${key}-worker-${index + 1}`,
        clock
      })
    }

    const created = await postCommand(baseUrl, owner.agentToken, {
      protocolVersion: '1.0',
      type: 'project.create',
      requestId: requestId(`${key}-project-create`),
      idempotencyKey: idempotency(`${key}-project-create`),
      createIntentId: `pct_${stableDigest(`${key}-create-intent`).slice(0, 24)}`,
      displayName: `SciForge ${key} design project`,
      goal: scenario.goal,
      budget: {
        maxTasks: workerCount + 2,
        maxTasksPerRound: workerCount + 2,
        maxTaskRetries: 1,
        maxCoordinationRounds: 1
      }
    })
    const project = created.project

    const tasks = workers.map((worker, index) => {
      const role = scenario.roles[index]
      assert.ok(role)
      return {
      workerUserId: worker.userId,
      planItemId: `item_${key.replace(/[^A-Za-z0-9_-]/gu, '_')}_${index + 1}`,
      title: `${role.role}设计子课题`,
      objective: `design-analysis-only：仅分析“${role.subQuestion}”，为${scenario.name}提供设计输入。依据资料标签 [source:${scenario.sourceLabel}]；任务 brief：${scenario.brief} 只做 design analysis，不执行或声称执行实验。`,
      completionCriteria: [
        '报告必须包含 Expert/Role and Sub-question、Conclusion、Evidence or basis、Recommendation or next action。',
        '每个关键结论必须带 [expert:<role>] 或 [source:<label>] 归属。'
      ],
      dependencyPlanItemIds: [],
      // The production Desktop currently advertises only runtime/model-access
      // tags.  This text-only MVP has no domain-specific capability contract,
      // so it must not invent a business tag that real Workers cannot publish.
      requiredCapabilityTags: [],
      fileIntent: null
      }
    })
    const planFacts = {
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
      supersedesProjectPlanId: null,
      sourceInputLocators: [],
      tasks,
      rationale: 'Each Worker owns one design sub-question; the Coordinator will synthesize the first landing task, overall design, metrics, constraints, risks, human confirmation points, and next actions from attributed reports.',
      runtimeProvenance: {
        runtimeId: 'mvp-coordinator-runtime',
        modelId: null,
        generatedByCoordinatorAgentId: owner.agent.agentId,
        generatedAt: clock.now().toISOString()
      }
    }
    const submittedPlanEnvelope = await postCommand(baseUrl, owner.agentToken, {
      protocolVersion: '1.0',
      type: 'project.plan.submit',
      requestId: requestId(`${key}-plan-submit`),
      idempotencyKey: idempotency(`${key}-plan-submit`),
      ...planFacts,
      planDigest: stableDigest(planFacts)
    })
    const submittedPlan = submittedPlanEnvelope.entity
    const confirmedPlanEnvelope = await postCommand(baseUrl, owner.userToken, {
      protocolVersion: '1.0',
      type: 'project.plan.confirm',
      requestId: requestId(`${key}-plan-confirm`),
      idempotencyKey: idempotency(`${key}-plan-confirm`),
      projectId: project.projectId,
      projectPlanId: submittedPlan.projectPlanId,
      expectedProjectRevision: project.revision + 1,
      expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
      expectedPlanRevision: submittedPlan.revision,
      planDigest: submittedPlan.planDigest,
      initialTeam: {
        mode: 'none',
        members: [owner, ...workers].map(({ userId }) => ({ userId }))
      }
    })
    const confirmedPlan = confirmedPlanEnvelope.entity

    for (const worker of workers) {
      const invitation = await repository.getProjectMember(project.projectId, worker.userId)
      assert.ok(invitation)
      const currentProject = await repository.getProject(project.projectId)
      assert.ok(currentProject)
      await postCommand(baseUrl, worker.userToken, {
        protocolVersion: '1.0',
        type: 'project.membership.accept',
        requestId: requestId(`${key}-membership-${worker.userId}`),
        idempotencyKey: idempotency(`${key}-membership-${worker.userId}`),
        projectId: project.projectId,
        projectMembershipId: invitation.projectMembershipId,
        expectedProjectRevision: currentProject.revision,
        expectedMembershipRevision: invitation.revision,
        projectPlanId: confirmedPlan.projectPlanId,
        expectedPlanRevision: confirmedPlan.revision,
        planDigest: confirmedPlan.planDigest
      })
    }

    let currentProject = await repository.getProject(project.projectId)
    assert.ok(currentProject)
    const activeEnvelope = await postCommand(baseUrl, owner.userToken, {
      protocolVersion: '1.0',
      type: 'project.transition',
      requestId: requestId(`${key}-activate`),
      idempotencyKey: idempotency(`${key}-activate`),
      projectId: project.projectId,
      expectedRevision: currentProject.revision,
      expectedCoordinatorAuthorityEpoch: currentProject.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: currentProject.executionAuthorityEpoch,
      status: 'active'
    })
    const active = activeEnvelope.entity
    currentProject = active

    const submissions = []
    for (const [index, worker] of workers.entries()) {
      const task = tasks[index]
      assert.deepEqual(task.requiredCapabilityTags, [])
      const offeredEnvelope = await postCommand(baseUrl, owner.agentToken, {
        protocolVersion: '1.0',
        type: 'task.offer.create',
        requestId: requestId(`${key}-offer-${index + 1}`),
        idempotencyKey: idempotency(`${key}-offer-${index + 1}`),
        projectId: currentProject.projectId,
        expectedProjectRevision: currentProject.revision,
        expectedCoordinatorAuthorityEpoch: currentProject.coordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch: currentProject.executionAuthorityEpoch,
        projectPlanId: confirmedPlan.projectPlanId,
        expectedPlanRevision: confirmedPlan.revision,
        planItemId: task.planItemId,
        offerExpiresAt: new Date(clock.now().getTime() + 60_000).toISOString()
      })
      const offered = collectionEntities(offeredEnvelope)
      const workerInbox = await service.pullInbox(
        worker.agentActor,
        { afterSequence: 0, limit: 100 }
      )
      assert.ok(workerInbox.messages.some((message) => (
        message.payload.type === 'task.offered' && message.payload.taskOfferId === offered.offer.taskOfferId
      )))

      const acceptedEnvelope = await postCommand(baseUrl, worker.agentToken, {
        protocolVersion: '1.0',
        type: 'task.offer.accept',
        requestId: requestId(`${key}-accept-${index + 1}`),
        idempotencyKey: idempotency(`${key}-accept-${index + 1}`),
        taskOfferId: offered.offer.taskOfferId,
        taskId: offered.task.taskId,
        expectedTaskRevision: offered.task.revision,
        expectedOfferRevision: offered.offer.revision
      })
      const accepted = collectionEntities(acceptedEnvelope)
      const startedAt = clock.now().toISOString()
      const startedEnvelope = await postCommand(baseUrl, worker.agentToken, {
        protocolVersion: '1.0',
        type: 'task.execution.start',
        requestId: requestId(`${key}-start-${index + 1}`),
        idempotencyKey: idempotency(`${key}-start-${index + 1}`),
        taskId: accepted.task.taskId,
        executionId: accepted.execution.executionId,
        expectedTaskRevision: accepted.task.revision,
        expectedExecutionRevision: accepted.execution.revision,
        startedAt
      })
      const started = collectionEntities(startedEnvelope)
      const role = scenario.roles[index]
      const summary = [
        '## Expert / Role and Sub-question',
        `- [expert:${role.role}] [worker:${worker.userId}] ${role.subQuestion}`,
        '## Conclusion / 结论',
        `- [expert:${role.role}] ${role.conclusion}`,
        '## Evidence or basis / 依据（证据）',
        `- [source:${scenario.sourceLabel}] 基于项目任务 brief；本报告未执行实验或测量。`,
        '## Recommendation or next action / 建议（下一步）',
        '- [expert:' + role.role + '] 将该结论交由 Coordinator 纳入整体设计并标记待确认项。',
        '## Uncertainty / 不确定性',
        '- 当前结论是设计假设，需由 Coordinator 在最终设计包中确认。'
      ].join('\n')
      const runtimeProvenance = {
        runtimeId: `mvp-worker-runtime-${index + 1}`,
        modelId: null,
        startedAt,
        completedAt: clock.now().toISOString()
      }
      const resultFacts = {
        taskId: started.task.taskId,
        executionId: started.execution.executionId,
        expectedTaskRevision: started.task.revision,
        expectedExecutionRevision: started.execution.revision,
        summary,
        runtimeProvenance,
        outputs: [],
        recoveryJournalEntryIds: []
      }
      const submittedResultEnvelope = await postCommand(baseUrl, worker.agentToken, {
        protocolVersion: '1.0',
        type: 'task.result.submit',
        requestId: requestId(`${key}-result-${index + 1}`),
        idempotencyKey: idempotency(`${key}-result-${index + 1}`),
        ...resultFacts,
        submissionDigest: stableDigest(resultFacts)
      })
      const submittedResult = collectionEntities(submittedResultEnvelope)
      assert.equal(submittedResult.submission.submittedByUserId, worker.userId)
      assert.equal(submittedResult.submission.submittedByAgentId, worker.agent.agentId)
      const coordinatorInbox = await service.pullInbox(
        owner.agentActor,
        { afterSequence: 0, limit: 200 }
      )
      assert.ok(coordinatorInbox.messages.some((message) => (
        message.payload.type === 'task.result.submitted' &&
        message.payload.resultSubmissionId === submittedResult.submission.resultSubmissionId
      )))

      currentProject = await repository.getProject(project.projectId)
      assert.ok(currentProject)
      const reviewedEnvelope = await postCommand(baseUrl, owner.agentToken, {
        protocolVersion: '1.0',
        type: 'task.result.review',
        requestId: requestId(`${key}-review-${index + 1}`),
        idempotencyKey: idempotency(`${key}-review-${index + 1}`),
        projectId: currentProject.projectId,
        taskId: submittedResult.task.taskId,
        executionId: submittedResult.execution.executionId,
        resultSubmissionId: submittedResult.submission.resultSubmissionId,
        expectedProjectRevision: currentProject.revision,
        expectedTaskRevision: submittedResult.task.revision,
        expectedExecutionRevision: submittedResult.execution.revision,
        expectedResultRevision: submittedResult.submission.revision,
        expectedCoordinatorAuthorityEpoch: currentProject.coordinatorAuthorityEpoch,
        decision: 'accept',
        instruction: null,
        nextWorkerUserId: null,
        nextOfferExpiresAt: null,
        nextFileIntent: null
      })
      const reviewed = collectionEntities(reviewedEnvelope)
      assert.equal(reviewed.review.decision, 'accept')
      submissions.push(submittedResult.submission)
      currentProject = await repository.getProject(project.projectId)
      assert.ok(currentProject)
    }

    const coordinationRead = await postCommand(baseUrl, owner.userToken, {
      protocolVersion: '1.0',
      type: 'project.coordination.read',
      requestId: requestId(`${key}-coordination-read`),
      projectId: project.projectId,
      collections: [
        { collection: 'tasks', limit: 100 },
        { collection: 'executions', limit: 100 },
        { collection: 'result_submissions', limit: 100 },
        { collection: 'review_decisions', limit: 100 }
      ]
    })
    assert.equal(coordinationRead.type, 'rest.project_coordination')
    const coordinationItems = (collection) => coordinationRead.pages
      .find((page) => page.collection === collection)?.items ?? []
    const cloudSubmissions = coordinationItems('result_submissions')
    assert.equal(cloudSubmissions.length, workerCount)
    for (const [index, expectedSubmission] of submissions.entries()) {
      const submission = cloudSubmissions.find(({ taskId }) => taskId === expectedSubmission.taskId)
      assert.ok(submission)
      assert.equal(submission.submittedByUserId, workers[index].userId)
      assert.equal(submission.submittedByAgentId, workers[index].agent.agentId)
      assert.equal(submission.resultSubmissionId, expectedSubmission.resultSubmissionId)
    }
    const expertAttributions = submissions.map((submission, index) => {
      const role = scenario.roles[index]
      return `- [expert:${role.role}] [worker:${workers[index].userId}] [task:${submission.taskId}] [result:${submission.resultSubmissionId}] ${role.conclusion} 依据见 [source:${scenario.sourceLabel}]。`
    })
    const summary = [
      '# 设计方案评审纪要（不执行实验）',
      '',
      '## 首个 Agent 落地任务',
      `- [synthesis:Coordinator] [source:${scenario.sourceLabel}] task:first-landing-design; decision:proposed; owner: Coordinator; scope: ${scenario.firstLandingTask} 本轮不执行实验。`,
      '',
      '## 各专家结论与归属',
      ...expertAttributions,
      '',
      '## 整体方案',
      `[synthesis:Coordinator] 汇总各子课题为一条可审阅的设计路径，并明确依赖、决策顺序和待确认假设；依据见 [source:${scenario.sourceLabel}]。`,
      '',
      '## 场景要求覆盖',
      ...scenario.requiredClaims.map((claim) => (
        `[synthesis:Coordinator] ${claim}；依据 ${submissions.map(({ resultSubmissionId }) => `[result:${resultSubmissionId}]`).join(', ')} 与 [source:${scenario.sourceLabel}]。`
      )),
      '',
      '## 量化成功指标',
      `- [synthesis:Coordinator] ${scenario.designMetric}（设计提案，非实测结果）。`,
      '',
      '## 硬约束',
      `- [synthesis:Coordinator] ${scenario.hardConstraint} 依据 [source:${scenario.sourceLabel}]。`,
      '',
      '## 风险与人工确认点',
      `- [synthesis:Coordinator] 风险：${scenario.risk}；人工确认：${scenario.humanConfirmation}；输入 Result IDs：${submissions.map(({ resultSubmissionId }) => `[result:${resultSubmissionId}]`).join(', ')}；依据 [source:${scenario.sourceLabel}]。`,
      '',
      '## 分歧与处理',
      `- [synthesis:Coordinator] ${scenario.disagreement} 依据 ${submissions.map(({ resultSubmissionId }) => `[result:${resultSubmissionId}]`).join(', ')} 与 [source:${scenario.sourceLabel}]。`,
      '',
      '## 下一步行动项',
      `- [synthesis:Coordinator] owner: Coordinator；due: 下一次设计评审前；action: ${scenario.nextAction}；依据 [source:${scenario.sourceLabel}]。`,
      '',
      '## 资料与依据索引',
      `- [source:${scenario.sourceLabel}] 项目场景 brief；Worker 报告中的 [expert:*] 与 [result:*] 映射见上。`
    ].join('\n')
    const completedEnvelope = await postCommand(baseUrl, owner.agentToken, {
      protocolVersion: '1.0',
      type: 'project.final_summary.submit',
      requestId: requestId(`${key}-final-summary`),
      idempotencyKey: idempotency(`${key}-final-summary`),
      projectId: currentProject.projectId,
      expectedProjectRevision: currentProject.revision,
      expectedCoordinatorAuthorityEpoch: currentProject.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: currentProject.executionAuthorityEpoch,
      projectPlanId: confirmedPlan.projectPlanId,
      confirmedPlanRevision: confirmedPlan.planRevision,
      acceptedResultSubmissionIds: submissions.map(({ resultSubmissionId }) => resultSubmissionId),
      summary
    })
    const completed = collectionEntities(completedEnvelope)
    assert.equal(completed.project.status, 'completed')
    assert.equal(completed.finalSummary.acceptedResultSubmissionIds.length, workerCount)
    assert.equal(completed.finalSummary.summary, summary)
    assert.ok(completed.finalSummary.summary.includes('设计方案评审纪要（不执行实验）'))

    for (const worker of workers) {
      const userInbox = await service.pullInbox(worker.user, { afterSequence: 0, limit: 100 })
      assert.ok(userInbox.messages.some((message) => (
        message.payload.type === 'project.final_summary.created' &&
        message.payload.projectId === project.projectId
      )))
    }
    return {
      workerCount,
      scenario,
      tasks,
      submissions,
      workerReports: submissions.map(({ summary }) => summary),
      project: completed.project,
      finalSummary: completed.finalSummary
    }
  } finally {
    await closeServer(server)
  }
}

function assertDesignPackage(result) {
  assert.equal(result.project.goal, result.scenario.goal)
  assert.equal(result.tasks.length, result.workerCount)
  assert.equal(new Set(result.tasks.map(({ workerUserId }) => workerUserId)).size, result.workerCount)
  for (const [index, task] of result.tasks.entries()) {
    const role = result.scenario.roles[index]
    assert.match(task.objective, /design analysis/iu)
    assert.match(task.objective, /不执行|do not execute/iu)
    assert.match(task.objective, new RegExp(`\\[source:${result.scenario.sourceLabel}\\]`, 'u'))
    assert.match(task.objective, new RegExp(result.scenario.brief.slice(0, 16), 'u'))
    assert.deepEqual(task.requiredCapabilityTags, [])
    assert.equal(task.fileIntent, null)
    assert.match(task.title, new RegExp(role.role, 'u'))
  }
  for (const [index, report] of result.workerReports.entries()) {
    const role = result.scenario.roles[index]
    assert.match(report, /Expert \/ Role and Sub-question/u)
    assert.match(report, new RegExp(`\\[expert:${role.role}\\]`, 'u'))
    assert.match(report, /Conclusion|结论/u)
    assert.match(report, /Evidence or basis|依据/u)
    assert.match(report, new RegExp(`\\[source:${result.scenario.sourceLabel}\\]`, 'u'))
    assert.match(report, /Recommendation or next action|建议/u)
    assert.doesNotMatch(report, /experiment executed|实验已执行/iu)
  }
  const finalSummary = result.finalSummary.summary
  for (const heading of [
    '首个 Agent 落地任务',
    '各专家结论与归属',
    '整体方案',
    '场景要求覆盖',
    '量化成功指标',
    '硬约束',
    '风险与人工确认点',
    '分歧与处理',
    '下一步行动项',
    '资料与依据索引'
  ]) assert.match(finalSummary, new RegExp(heading, 'u'))
  assert.match(finalSummary, /decision:proposed/u)
  assert.match(finalSummary, /\[synthesis:Coordinator\]/u)
  for (const claim of result.scenario.requiredClaims) {
    assert.match(finalSummary, new RegExp(claim, 'u'))
  }
  assert.match(finalSummary, /metric:.*threshold:.*measurement:/su)
  assert.match(finalSummary, /owner:.*due:.*action:/su)
  assert.match(finalSummary, /task:first-landing-design/u)
  assert.match(finalSummary, new RegExp(result.scenario.firstLandingTask, 'u'))
  assert.ok(finalSummary.includes(result.scenario.designMetric))
  assert.match(finalSummary, new RegExp(`首个 Agent 落地任务[\\s\\S]*\\[source:${result.scenario.sourceLabel}\\]`, 'u'))
  assert.match(finalSummary, new RegExp(`风险与人工确认点[\\s\\S]*\\[source:${result.scenario.sourceLabel}\\]`, 'u'))
  assert.match(finalSummary, new RegExp(`分歧与处理[\\s\\S]*\\[source:${result.scenario.sourceLabel}\\]`, 'u'))
  for (const [index, submission] of result.submissions.entries()) {
    const role = result.scenario.roles[index]
    assert.ok((finalSummary.match(new RegExp(`\\[result:${submission.resultSubmissionId}\\]`, 'gu'))?.length ?? 0) >= 1)
    assert.match(finalSummary, new RegExp(`\\[expert:${role.role}\\]`, 'u'))
    assert.match(finalSummary, new RegExp(role.conclusion, 'u'))
  }
}

async function provisionParticipant({ service, repository, actorResolver, identityLabel, tokenLabel }) {
  const identity = await seedOidcUserDevice(
    repository,
    identityLabel,
    new Date('2026-08-15T00:00:00.000Z')
  )
  const userToken = `oidc-mvp-${tokenLabel}-token`
  actorResolver.registerOidcActor(userToken, identity.user)
  const bootstrap = createAgentCredentialBootstrap()
  const ensured = await service.ensureAgent(identity.user, {
    deviceId: identity.deviceId,
    capabilities: ['agent-runtime.codex', 'model-access.api'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: idempotency(`ensure-${tokenLabel}`)
  })
  const agentToken = bootstrap.open(ensured.sealedCredential)
  return {
    user: identity.user,
    userId: identity.userId,
    deviceId: identity.deviceId,
    agent: ensured.agent,
    agentActor: fakeAgentActor(ensured.agent),
    userToken,
    agentToken
  }
}

async function publishWorkerAvailability({ baseUrl, token, agent, key, clock }) {
  const heartbeatEnvelope = await postCommand(baseUrl, token, {
    protocolVersion: '1.0',
    type: 'agent.heartbeat',
    requestId: requestId(`${key}-heartbeat`),
    idempotencyKey: idempotency(`${key}-heartbeat`),
    agentId: agent.agentId,
    expectedRevision: agent.revision,
    connectionStatus: 'online',
    capabilities: agent.capabilities
  })
  assert.ok(heartbeatEnvelope.entity, JSON.stringify(heartbeatEnvelope))
  const heartbeat = heartbeatEnvelope.entity
  await postCommand(baseUrl, token, {
    protocolVersion: '1.0',
    type: 'worker.availability.publish',
    requestId: requestId(`${key}-availability`),
    idempotencyKey: idempotency(`${key}-availability`),
    agentId: agent.agentId,
    expectedAgentRevision: heartbeat.revision,
    connectionStatus: 'online',
    lastHeartbeatAt: heartbeat.lastSeenAt,
    runtimeReadiness: 'ready',
    runtimeCapabilityTags: heartbeat.capabilities,
    acceptsNewOffers: true,
    activeTaskCount: 0,
    observedAt: clock.now().toISOString()
  })
}

async function postCommand(baseUrl, token, command) {
  const response = await fetch(`${baseUrl}/v1/commands`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': command.idempotencyKey
    },
    body: JSON.stringify(command)
  })
  const body = await response.json()
  assert.equal(response.status, 200, `${command.type}: ${JSON.stringify(body)}`)
  return body
}

function collectionEntities(envelope) {
  assert.equal(envelope.type, 'rest.collection')
  const entities = {}
  for (const item of envelope.items) {
    if (item.type === 'task') entities.task = item
    if (item.type === 'task_offer') entities.offer = item
    if (item.type === 'task_execution') entities.execution = item
    if (item.type === 'task_result_submission') entities.submission = item
    if (item.type === 'task_review_decision') entities.review = item
    if (item.type === 'project') entities.project = item
    if (item.type === 'project_record') entities.record = item
    if (item.type === 'project_final_summary') entities.finalSummary = item
  }
  return entities
}

async function closeServer(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function requestId(seed) {
  return `req_${stableDigest(seed).slice(0, 24)}`
}

function idempotency(seed) {
  return `idem_${stableDigest(seed).slice(0, 32)}`
}
