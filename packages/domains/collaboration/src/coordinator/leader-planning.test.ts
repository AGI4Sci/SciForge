import assert from 'node:assert/strict'
import test from 'node:test'
import { projectRequirementsDocumentSchema, projectMembershipSchema, integrationReceiptSchema, deliveryManifestDigest, deliveryManifestSchema } from '@sciforge/collaboration-contracts'
import { humanNeededFixture, projectFixture, projectRecordFixture, taskFixture, TEST_IDS, TEST_TIMESTAMP } from '@sciforge/collaboration-contracts/testing'
import type { DomainMainAgentExecutionRequest, DomainMainAgentExecutionHost, DomainMainAgentExecutionSessionRequest } from '@sciforge/domain-sdk/agent-execution'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { createHumanDirectedCommands } from './human-directed-commands.js'
import type { DomainMainPackageSettingsHost, DomainMainPackageSettingsSnapshot } from '@sciforge/domain-sdk/package-storage'
import { projectCoordinatorWorkspaceSchema } from './contract.js'
import { createLeaderPlanning, leaderPlanningKey, leaderPlanningFacts, leaderPlanningContext } from './leader-planning.js'
import { leaderRecommendationOutputSchema, leaderRecommendationSchema } from './leader-planning-contract.js'
import { publishedResultDrive } from './cloud-test-fixtures.js'
import { ProjectCoordinatorStateStore } from './state.js'

// Runtime and Cloud below are fixtures, not live model/Cloud acceptance.

test('leader structured output declares a type, reference or combination for every schema node', () => {
  const visit = (raw: unknown, path: string): void => {
    assert.ok(raw !== null && typeof raw === 'object' && !Array.isArray(raw), path)
    const node = raw as Record<string, unknown>
    assert.ok(typeof node.type === 'string' || Array.isArray(node.type) || typeof node.$ref === 'string' ||
      ['anyOf', 'oneOf', 'allOf'].some(key => Array.isArray(node[key])), `Missing schema type at ${path}`)
    for (const [name, child] of Object.entries((node.properties ?? {}) as Record<string, unknown>)) visit(child, `${path}.properties.${name}`)
    if (node.items !== undefined) visit(node.items, `${path}.items`)
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      const children = node[key]
      if (Array.isArray(children)) children.forEach((child, index) => visit(child, `${path}.${key}[${index}]`))
    }
    for (const [name, child] of Object.entries((node.$defs ?? {}) as Record<string, unknown>)) visit(child, `${path}.$defs.${name}`)
  }
  visit(leaderRecommendationOutputSchema, '$')
})

test('leader assignment IDs have matching structured output and local validation bounds', () => {
  const fields = leaderRecommendationOutputSchema.properties.assignments.items.properties
  const assignment = { planItemId: 'item_evidence', workerUserId: TEST_IDS.userId, rationale: 'Owns the source materials' }
  const recommendation = { title: 'Prepare evidence', rationale: 'Establish shared evidence first', blockers: [], decisions: [] }
  for (const field of ['planItemId', 'workerUserId'] as const) {
    const { type, minLength, maxLength, pattern } = fields[field]
    assert.deepEqual({ type, minLength, maxLength }, { type: 'string', minLength: 1, maxLength: 256 }, field)
    const nonBlank = new RegExp(pattern, 'u')
    for (const [id, accepted] of [
      ['', false], ['   ', false], ['\t\n\u00a0', false], ['x'.repeat(257), false],
      [assignment[field], true], ['x', true], ['x'.repeat(256), true]
    ] as const) {
      const candidate = { ...assignment, [field]: id }
      const result = leaderRecommendationSchema.safeParse({ ...recommendation, assignments: [candidate] })
      const label = `${field}: ${JSON.stringify(id)}`
      assert.equal(id.length >= minLength && id.length <= maxLength && nonBlank.test(id), accepted, label)
      assert.equal(result.success, accepted, label)
      if (result.success) assert.deepEqual(result.data.assignments, [candidate])
      else assert.deepEqual(result.error.issues.map(issue => issue.path), [['assignments', 0, field]])
    }
  }
})

async function fixture(bound = true) {
  const project = { ...projectFixture, status: 'active' as const }
  const workspace = projectCoordinatorWorkspaceSchema.parse({ connection: { state: 'ready', userId: project.ownerUserId, deviceId: TEST_IDS.deviceId },
    observedAt: TEST_TIMESTAMP, focusedProjectId: project.projectId, availableWorkerUsers: [],
    projects: [{ project, plan: null, memberUsers: [], workerGroups: [], tasks: [], offers: [], deliveryDrive: null,
      pendingHumanNeeded: [], records: [], finalSummary: null, memberships: [] }] })
  Object.assign(workspace.projects[0]!.project, { executionMode: 'ai_leader' })
  let snapshot: DomainMainPackageSettingsSnapshot = { revision: 0, value: null }
  const settings: DomainMainPackageSettingsHost = { read: async () => structuredClone(snapshot), write: async (value, revision) => {
    if (revision !== snapshot.revision) throw new Error('CAS conflict')
    snapshot = { revision: revision + 1, value }; return structuredClone(snapshot)
  }, clear: async () => { throw new Error('Unexpected clear') } }
  const state = new ProjectCoordinatorStateStore(settings)
  if (bound) await state.persistCoordinatorSessionBinding({ schemaVersion: 1, role: 'coordinator', projectId: project.projectId,
    principalUserId: project.ownerUserId, coordinatorAgentId: project.coordinatorAgentId, coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    runtimeId: 'runtime-leader', threadId: 'thread-leader', boundAt: TEST_TIMESTAMP })
  const calls: DomainMainAgentExecutionRequest[] = []
  const identity = { state: 'ready' as const, baseUrl: 'https://fixture.invalid', userId: project.ownerUserId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }
  let duringRun = async () => {}
  let response: unknown = { title:'请确认下一批任务', rationale:'整理当前工作', blockers:[], decisions:[], assignments:[] }
  const options = { state, workspace: { readWorkspace: async () => workspace }, transport: { status: () => identity },
    localAgentId: () => project.coordinatorAgentId,
    getAgentExecution: () => ({ run: async (request: DomainMainAgentExecutionRequest) => { calls.push(request); await duringRun(); return {
      runtimeId: request.runtimeId!, threadId: request.threadId!, turnId: 'turn-leader', state: 'completed' as const, text: JSON.stringify(response) } } }) }
  return { options, settings, state, workspace, project, calls, identity, setResponse: (value: unknown) => { response = value }, setDuringRun: (fn: () => Promise<void>) => { duringRun = fn } }
}

async function unboundFixture(timeoutMs?: number) {
  const f = await fixture(false)
  f.workspace.projects[0]!.project.status = 'paused'
  const preparations: DomainMainAgentExecutionSessionRequest[] = []
  let prepare: NonNullable<DomainMainAgentExecutionHost['prepareSession']> = async () => ({ runtimeId: 'runtime-prepared', threadId: 'thread-prepared' })
  let runtime: Pick<DomainMainAgentExecutionHost, 'run' | 'prepareSession'> | undefined = {
    ...f.options.getAgentExecution(), prepareSession: async request => { preparations.push(request); return prepare(request) }
  }
  const options = { ...f.options, timeoutMs, getAgentExecution: () => runtime }
  const planner = createLeaderPlanning(options)
  const command = createHumanDirectedCommands({ ...options, transport: options.transport as AuthenticatedCloudTransport,
    retryProposal: id => planner.enqueue(id, { retry: true }), deferProposal: async () => {},
    dispatch: { reconcileProject: async () => { throw new Error('Planning must never dispatch') }, reconcileVisibleProjects: async () => {} } })
  return { ...f, options, preparations, planner, command, setPrepare: (fn: typeof prepare) => { prepare = fn },
    setRuntime: (value: typeof runtime) => { runtime = value } }
}

test('a synchronized device identity change during a turn cannot publish the old device result', async () => {
  const f = await fixture()
  f.setDuringRun(async () => {
    Object.assign(f.identity, { deviceId: 'dev_OtherDevice001' })
  })
  const workspace = { readWorkspace: async () => ({ ...f.workspace, connection: { ...f.workspace.connection, deviceId: f.identity.deviceId } }) }
  await assert.rejects(createLeaderPlanning({ ...f.options, workspace }).observe(f.project.projectId, { retry: true }), /changed authority/)
  assert.equal(await f.state.readLeaderProposal(f.project.projectId), null)
})

test('unbound manual project: public retry prepares once, persists canonical binding and plans in that exact Session', async () => {
  const f = await unboundFixture()
  const before = structuredClone(f.workspace)
  await f.planner.enqueue(f.project.projectId)
  await f.planner.sweep()
  assert.equal(f.preparations.length, 0)
  await Promise.all([f.command.retryLeaderProposal(f.project.projectId), f.command.retryLeaderProposal(f.project.projectId)])
  assert.equal(f.preparations.length, 1)
  assert.equal(f.preparations[0]!.mode, 'plan')
  assert.equal(f.preparations[0]!.interaction, 'reviewable')
  assert.deepEqual(f.preparations[0]!.allowedTools, [])
  const [binding] = await f.state.readCoordinatorSessionBindings()
  assert.equal(binding!.runtimeId, 'runtime-prepared')
  assert.equal(binding!.threadId, 'thread-prepared')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0]!.runtimeId, binding!.runtimeId)
  assert.equal(f.calls[0]!.threadId, binding!.threadId)
  assert.deepEqual(f.calls[0]!.allowedTools, [])
  assert.deepEqual(f.workspace, before)
  const restored = createLeaderPlanning({ ...f.options, state: new ProjectCoordinatorStateStore(f.settings) })
  await restored.sweep()
  await restored.enqueue(f.project.projectId, { retry: true })
  assert.equal(f.preparations.length, 1)
  assert.equal(f.calls.length, 1)
})

for (const failure of ['missing runtime', 'missing prepare', 'prepare throws', 'timeout'] as const) {
  test(`unbound public retry rejects ${failure} and recovers on explicit retry`, async () => {
    const f = await unboundFixture(failure === 'timeout' ? 30 : undefined)
    const healthy = f.options.getAgentExecution()
    if (failure === 'missing runtime') f.setRuntime(undefined)
    if (failure === 'missing prepare') f.setRuntime({ run: healthy!.run })
    if (failure === 'prepare throws') f.setPrepare(async () => { throw new Error('Host unavailable') })
    let late!: (value: { runtimeId: string; threadId: string }) => void
    if (failure === 'timeout') f.setPrepare(() => new Promise(resolve => { late = resolve }))
    await assert.rejects(f.command.retryLeaderProposal(f.project.projectId), /retry/)
    if (late) { late({ runtimeId: 'late-runtime', threadId: 'late-thread' }); await new Promise(resolve => setImmediate(resolve)) }
    assert.deepEqual(await f.state.readCoordinatorSessionBindings(), [])
    assert.equal(f.calls.length, 0)
    assert.equal(await f.state.readLeaderPlanningStatus(f.project.projectId), null)
    f.setRuntime(healthy)
    f.setPrepare(async () => ({ runtimeId: 'runtime-prepared', threadId: 'thread-prepared' }))
    await f.command.retryLeaderProposal(f.project.projectId)
    assert.equal(f.calls.length, 1)
  })
}

for (const change of ['revision', 'mode', 'owner', 'device', 'device revision', 'agent', 'epoch', 'dispose', 'binding conflict'] as const) {
  test(`preparation late result cannot bind or run after ${change}`, async () => {
    const f = await unboundFixture()
    let release!: (value: { runtimeId: string; threadId: string }) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    f.setPrepare(() => { entered(); return new Promise(resolve => { release = resolve }) })
    const work = f.command.retryLeaderProposal(f.project.projectId)
    const rejected = assert.rejects(work, /changed|cancelled/)
    await started
    const project = f.workspace.projects[0]!.project
    if (change === 'revision') project.revision++
    if (change === 'mode') project.executionMode = 'manual'
    if (change === 'owner') project.ownerUserId = TEST_IDS.secondUserId
    if (change === 'device') Object.assign(f.identity, { deviceId: 'dev_OtherDevice001' })
    if (change === 'device revision') f.identity.deviceRevision++
    if (change === 'agent') project.coordinatorAgentId = 'agt_OtherAgent001'
    if (change === 'epoch') project.coordinatorAuthorityEpoch++
    if (change === 'dispose') f.planner.dispose()
    if (change === 'binding conflict') await f.state.persistCoordinatorSessionBinding({ schemaVersion: 1, role: 'coordinator',
      projectId: project.projectId, principalUserId: project.ownerUserId, coordinatorAgentId: project.coordinatorAgentId,
      coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch, runtimeId: 'other-runtime', threadId: 'other-thread', boundAt: TEST_TIMESTAMP })
    release({ runtimeId: 'late-runtime', threadId: 'late-thread' })
    await rejected
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await f.state.readCoordinatorSessionBindings()).length, change === 'binding conflict' ? 1 : 0)
    assert.equal(f.calls.length, 0)
  })
}

test('paused background enqueue preserves explicit preparation; authority events cancel before a late Session resolves', async () => {
  for (const revoke of [false, 'mode', 'epoch', 'device'] as const) {
    const f = await unboundFixture()
    let release!: (value: { runtimeId: string; threadId: string }) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    f.setPrepare(() => { entered(); return new Promise(resolve => { release = resolve }) })
    const work = f.command.retryLeaderProposal(f.project.projectId)
    const outcome = revoke ? assert.rejects(work, /cancelled|changed/) : work
    await started
    if (revoke === 'mode') f.workspace.projects[0]!.project.executionMode = 'manual'
    if (revoke === 'epoch') f.workspace.projects[0]!.project.coordinatorAuthorityEpoch++
    if (revoke === 'device') f.identity.deviceRevision++
    await f.planner.enqueue(f.project.projectId)
    if (revoke) await outcome
    release({ runtimeId: 'runtime-prepared', threadId: 'thread-prepared' })
    await outcome
    assert.equal(f.calls.length, revoke ? 0 : 1)
    assert.equal((await f.state.readCoordinatorSessionBindings()).length, revoke ? 0 : 1)
  }
})

for (const status of ['draft', 'paused', 'active'] as const) {
  test(`unbound ${status} background never prepares a Session or runs a turn`, async () => {
    const f = await unboundFixture()
    f.workspace.projects[0]!.project.status = status
    await f.planner.enqueue(f.project.projectId)
    await new Promise(resolve => setImmediate(resolve))
    await f.planner.sweep()
    assert.deepEqual(f.preparations, [])
    assert.deepEqual(f.calls, [])
  })
}

test('explicit public retry waits for a preceding idle background pass then performs its own preparation', async () => {
  const f = await unboundFixture()
  await f.planner.enqueue(f.project.projectId)
  await f.command.retryLeaderProposal(f.project.projectId)
  assert.equal(f.preparations.length, 1)
  assert.equal(f.calls.length, 1)
})

test('public command exposes bound runtime failure and explicit retry reuses its Session', async () => {
  const f = await unboundFixture()
  f.setDuringRun(async () => { throw new Error('Runtime upstream unavailable') })
  await assert.rejects(f.command.retryLeaderProposal(f.project.projectId), /upstream unavailable/)
  assert.equal((await f.state.readLeaderPlanningStatus(f.project.projectId))?.state, 'failed')
  f.setDuringRun(async () => {})
  await f.command.retryLeaderProposal(f.project.projectId)
  assert.equal(f.preparations.length, 1)
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0]!.threadId, f.calls[1]!.threadId)
  assert.notEqual(f.calls[0]!.clientDirectiveId, f.calls[1]!.clientDirectiveId)
  assert.equal(await f.state.readLeaderPlanningStatus(f.project.projectId), null)
})

test('conflicting existing authority binding fails closed without creating or overwriting a Session', async () => {
  const f = await unboundFixture()
  const binding = await f.state.persistCoordinatorSessionBinding({ schemaVersion: 1, role: 'coordinator', projectId: f.project.projectId,
    principalUserId: TEST_IDS.secondUserId, coordinatorAgentId: f.project.coordinatorAgentId,
    coordinatorAuthorityEpoch: f.project.coordinatorAuthorityEpoch, runtimeId: 'foreign-runtime', threadId: 'foreign-thread', boundAt: TEST_TIMESTAMP })
  await assert.rejects(f.command.retryLeaderProposal(f.project.projectId), /authority is unavailable/)
  assert.deepEqual(await f.state.readCoordinatorSessionBindings(), [binding])
  assert.equal(f.preparations.length, 0)
  assert.equal(f.calls.length, 0)
})

for (const status of ['draft', 'paused'] as const) {
  test(`${status}: background stays idle; one explicit tool-free plan preserves status and authorization`, async () => {
    const f = await fixture()
    f.workspace.projects[0]!.project.status = status
    const before = structuredClone(f.workspace)
    const planner = createLeaderPlanning(f.options)
    await planner.observe(f.project.projectId)
    await planner.enqueue(f.project.projectId)
    await planner.sweep()
    assert.equal(f.calls.length, 0)
    await planner.observe(f.project.projectId, { retry: true })
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0]!.runtimeId, 'runtime-leader')
    assert.equal(f.calls[0]!.threadId, 'thread-leader')
    assert.deepEqual(f.calls[0]!.allowedTools, [])
    assert.equal(f.calls[0]!.mode, 'plan')
    assert.deepEqual(f.workspace, before)
    assert.ok(await f.state.readLeaderProposal(f.project.projectId))
    f.workspace.projects[0]!.project.revision += 1
    await planner.sweep()
    await planner.observe(f.project.projectId)
    assert.equal(f.calls.length, 1, 'explicit permission is not retained for new facts')
  })
}

test('missing runtime is durably failed, restart does not silently retry, explicit retry recovers', async () => {
  const f = await fixture()
  f.workspace.projects[0]!.project.status = 'paused'
  const missing = createLeaderPlanning({ ...f.options, getAgentExecution: () => undefined })
  await assert.rejects(missing.observe(f.project.projectId, { retry: true }), /runtime is unavailable/)
  const restored = new ProjectCoordinatorStateStore(f.settings)
  assert.equal((await restored.readLeaderPlanningStatus(f.project.projectId))?.state, 'failed')
  assert.match((await restored.readLeaderPlanningStatus(f.project.projectId))!.message, /模型连接后重试/)
  const planner = createLeaderPlanning({ ...f.options, state: restored })
  await planner.sweep()
  assert.equal(f.calls.length, 0)
  await planner.observe(f.project.projectId, { retry: true })
  assert.equal(f.calls.length, 1)
  assert.equal(await restored.readLeaderPlanningStatus(f.project.projectId), null)
  assert.ok(await restored.readLeaderProposal(f.project.projectId))
})

test('paused explicit retry reconciles an already-created decision once and keeps deferral durable', async () => {
  const f = await fixture()
  f.workspace.projects[0]!.project.status = 'paused'
  const decision = { prompt: 'Who reviews the evidence?', interaction: { kind: 'clarification' as const } }
  f.setResponse({ title: 'Confirm reviewer', rationale: 'Reviewer needed', blockers: [], decisions: [decision], assignments: [] })
  let writes = 0
  const planner = createLeaderPlanning({ ...f.options, createHumanNeeded: async input => {
    writes += 1
    f.workspace.projects[0]!.pendingHumanNeeded.push({ ...humanNeededFixture, projectId: input.projectId,
      targetUserId: input.targetUserId, requestedByAgentId: f.project.coordinatorAgentId,
      prompt: input.prompt, interaction: input.interaction })
    throw new Error('Response interrupted after decision creation')
  } })
  await assert.rejects(planner.observe(f.project.projectId, { retry: true }), /Response interrupted/)
  await planner.observe(f.project.projectId, { retry: true })
  assert.equal(writes, 1)
  assert.equal(f.workspace.projects[0]!.pendingHumanNeeded.length, 1)
  assert.deepEqual(f.workspace.projects[0]!.tasks, [])
  assert.deepEqual(f.workspace.projects[0]!.offers, [])
  const proposal = await f.state.readLeaderProposal(f.project.projectId)
  assert.ok(proposal)
  await f.state.deferLeaderPlanning(f.project.projectId, proposal.key)
  const restored = createLeaderPlanning({ ...f.options, state: new ProjectCoordinatorStateStore(f.settings) })
  await restored.sweep()
  assert.equal(await f.state.readLeaderProposal(f.project.projectId), null)
  assert.equal(f.calls.length, 2)
})

for (const change of ['manual', 'owner', 'device', 'agent', 'completed', 'cancelled']) {
  test(`explicit planning rejects ${change}`, async () => {
    const f = await fixture()
    const project = f.workspace.projects[0]!.project
    project.status = 'paused'
    if (change === 'manual') project.executionMode = 'manual'
    else if (change === 'owner') project.ownerUserId = TEST_IDS.secondUserId
    else if (change === 'device') Object.assign(f.identity, { deviceId: 'dev_OtherDevice001' })
    else if (change === 'agent') project.coordinatorAgentId = 'agt_OtherAgent001'
    else Object.assign(project, { status: change })
    await assert.rejects(createLeaderPlanning(f.options).observe(f.project.projectId, { retry: true }), /authority is unavailable/)
    assert.equal(f.calls.length, 0)
    assert.equal(await f.state.readLeaderPlanningStatus(f.project.projectId), null)
  })
}

test('explicit enqueue survives a background sweep in paused state without granting future background permission', async () => {
  const f = await fixture()
  f.workspace.projects[0]!.project.status = 'paused'
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  f.setDuringRun(async () => { entered(); await gate })
  const planner = createLeaderPlanning(f.options)
  const work = planner.enqueue(f.project.projectId, { retry: true })
  await started
  await planner.sweep()
  assert.equal(f.calls[0]!.signal?.aborted, false)
  release()
  await work
  for (let attempt = 0; attempt < 100 && !await f.state.readLeaderProposal(f.project.projectId); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  assert.ok(await f.state.readLeaderProposal(f.project.projectId))
  f.workspace.projects[0]!.project.revision += 1
  await planner.sweep()
  assert.equal(f.calls.length, 1)
  planner.dispose()
})

for (const change of ['revision', 'mode', 'binding', 'epoch']) {
  test(`paused explicit planning discards late reply after ${change} changes`, async () => {
    const f = await fixture()
    f.workspace.projects[0]!.project.status = 'paused'
    f.setDuringRun(async () => {
      if (change === 'revision') f.workspace.projects[0]!.project.revision += 1
      if (change === 'mode') f.workspace.projects[0]!.project.executionMode = 'manual'
      if (change === 'epoch') f.workspace.projects[0]!.project.coordinatorAuthorityEpoch += 1
      if (change === 'binding') {
        // Simulate a restored binding changing while the old runtime replies.
        const snapshot = await f.settings.read()
        const value = structuredClone(snapshot.value) as { coordinatorSessionBindings: { threadId: string }[] }
        value.coordinatorSessionBindings[0]!.threadId = 'thread-rebound'
        await f.settings.write(value, snapshot.revision)
      }
    })
    await assert.rejects(createLeaderPlanning(f.options).observe(f.project.projectId, { retry: true }), /inputs changed/)
    assert.equal(await f.state.readLeaderProposal(f.project.projectId), null)
  })
}

test('AI leader uses existing conversation with no tools and durable restart dedup', async () => {
  const f = await fixture()
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0]!.allowedTools, [])
  assert.equal(f.calls[0]!.mode, 'plan')
  assert.equal(f.calls[0]!.threadId, 'thread-leader')
  assert.match(f.calls[0]!.prompt, /只分析已提供的快照，不读取或操作当前界面/)
  assert.match(f.calls[0]!.prompt, /必须使用业务语言/)
  assert.match(f.calls[0]!.prompt, /授权可能已经用于派发并被消费/)
  assert.match(f.calls[0]!.prompt, /仅对本次新增或调整的派发方案请求负责人确认/)
  assert.match(f.calls[0]!.prompt, /结构化 assignments 的 ID 字段仍必须原样准确填写/)
  assert.match(f.calls[0]!.prompt, /non-empty exact planItemId.*non-empty exact workerUserId.*active member/)
  assert.match(f.calls[0]!.prompt, /recipient is uncertain.*"assignments": \[\].*blank IDs/)

  await createLeaderPlanning({ ...f.options, state: new ProjectCoordinatorStateStore(f.settings) }).observe(f.project.projectId)
  assert.equal(f.calls.length, 1)
  f.workspace.projects[0]!.project.revision += 1
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  assert.equal(f.calls.length, 2)
  assert.notEqual(f.calls[0]!.clientDirectiveId, f.calls[1]!.clientDirectiveId)
})

test('manual mode and foreign owner cannot initiate automatic planning', async () => {
  const f = await fixture()
  Object.assign(f.workspace.projects[0]!.project, { executionMode: 'manual' })
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  Object.assign(f.workspace.projects[0]!.project, { executionMode: 'ai_leader' })
  f.identity.userId = TEST_IDS.secondUserId
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  assert.equal(f.calls.length, 0)
})

test('concurrent planning reserves only one model directive', async () => {
  const f = await fixture()
  await Promise.all([createLeaderPlanning(f.options).observe(f.project.projectId), createLeaderPlanning(f.options).observe(f.project.projectId)])
  assert.equal(f.calls.length, 1)
})

test('switch to manual aborts active observation without starting another turn', async () => {
  const f = await fixture()
  const port = createLeaderPlanning(f.options)
  f.setDuringRun(async () => {
    Object.assign(f.workspace.projects[0]!.project, { executionMode: 'manual' })
    await port.enqueue(f.project.projectId)
  })
  await assert.rejects(port.observe(f.project.projectId), /abort/i)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0]!.signal?.aborted, true)
})


test('structured recommendation persists source and deferral survives restart without regenerating', async () => {
  const f = await fixture()
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  const proposal = await f.state.readLeaderProposal(f.project.projectId)
  assert.ok(proposal)
  assert.equal(proposal.projectRevision, f.workspace.projects[0]!.project.revision)
  assert.equal(proposal.threadId, 'thread-leader')
  assert.equal(proposal.title, '请确认下一批任务')
  assert.equal(proposal.requirementsDocumentId, null)
  await assert.rejects(f.state.deferLeaderPlanning(f.project.projectId, 'a'.repeat(64)), /changed/)
  await f.state.deferLeaderPlanning(f.project.projectId, proposal.key)
  const restored = new ProjectCoordinatorStateStore(f.settings)
  assert.equal(await restored.readLeaderProposal(f.project.projectId), null)
  await createLeaderPlanning({ ...f.options, state: restored }).observe(f.project.projectId)
  assert.equal(f.calls.length, 1)
})

test('unknown task modules and members cannot become a recommended dispatch batch', async () => {
  const f = await fixture()
  f.setResponse({ title: '派发', rationale: '建议', blockers: [], decisions: [],
    assignments: [{ planItemId: 'invented', workerUserId: 'outsider', rationale: '模型猜测' }] })
  await assert.rejects(createLeaderPlanning(f.options).observe(f.project.projectId), /unconfirmed module or inactive member/)
  assert.equal(await f.state.readLeaderProposal(f.project.projectId), null)
})

test('late model proposal is not published when current project facts have changed', async () => {
  const f = await fixture()
  f.setDuringRun(async () => { f.workspace.projects[0]!.project.revision += 1 })
  await assert.rejects(createLeaderPlanning(f.options).observe(f.project.projectId), /inputs changed/)
  assert.equal(await f.state.readLeaderProposal(f.project.projectId), null)
})


test('AI recommended batch preserves exact confirmed scope and active recipient', async () => {
  const f = await fixture()
  const requirements = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
    type: 'project_requirements_document', requirementsDocumentId: 'rqd_LeaderRequirements001', projectId: f.project.projectId,
    documentRevision: 1, state: 'confirmed', goalsDeliverables: 'Produce evidence table', inputsBoundaries: 'Shared materials only',
    inputReferences: [], workModules: [{ planItemId: 'item_evidence', title: 'Evidence table', objective: 'Summarize evidence', dependencyPlanItemIds: [] }],
    acceptanceCriteria: [{ target: 'item_evidence', criteria: 'Table links each claim to evidence', evidenceMethod: 'Owner review' }],
    contentDigest: 'a'.repeat(64), confirmedByUserId: f.project.ownerUserId, confirmedAt: TEST_TIMESTAMP, supersededAt: null
  })
  const view = { ...f.workspace.projects[0]!, confirmedRequirements: requirements }
  f.workspace.projects[0] = view
  view.memberships.push(projectMembershipSchema.parse({ schemaVersion: 1, type: 'project_membership', authorityEpoch: 1, activatedAt: TEST_TIMESTAMP, removalRequestedAt: null, removalRequestedByUserId: null, removedAt: null, projectMembershipId: 'pmb_LeaderMember001', projectId: f.project.projectId, userId: f.project.ownerUserId,
    state: 'active', revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP }))
  f.setResponse({ title: 'Prepare evidence', rationale: 'Establish shared evidence first', blockers: [], decisions: [],
    assignments: [{ planItemId: 'item_evidence', workerUserId: f.project.ownerUserId, rationale: 'Owns the source materials' }] })
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  const proposal = await f.state.readLeaderProposal(f.project.projectId)
  assert.equal(proposal?.requirementsDocumentId, view.confirmedRequirements.requirementsDocumentId)
  assert.equal(proposal?.requirementsContentDigest, view.confirmedRequirements.contentDigest)
  assert.equal(proposal?.requirementsRevision, 1)
  assert.deepEqual(proposal?.assignments, [{ planItemId: 'item_evidence', workerUserId: f.project.ownerUserId, rationale: 'Owns the source materials' }])
})


test('runtime failure becomes visible and explicit retry creates a new directive without touching authorization', async () => {
  const f = await fixture()
  f.setDuringRun(async () => { throw new Error('upstream unavailable') })
  const port = createLeaderPlanning(f.options)
  await assert.rejects(port.observe(f.project.projectId), /upstream/)
  assert.equal((await f.state.readLeaderPlanningStatus(f.project.projectId))?.state, 'failed')
  await port.observe(f.project.projectId)
  assert.equal(f.calls.length, 1)
  f.setDuringRun(async () => {})
  await port.observe(f.project.projectId, { retry: true })
  assert.equal(f.calls.length, 2)
  assert.notEqual(f.calls[0]!.clientDirectiveId, f.calls[1]!.clientDirectiveId)
  assert.equal(await f.state.readLeaderPlanningStatus(f.project.projectId), null)
  assert.ok(await f.state.readLeaderProposal(f.project.projectId))
})

test('read ordering changes do not invalidate the same planning facts', async () => {
  const f = await fixture()
  const binding = (await f.state.readCoordinatorSessionBindings())[0]!
  const original = f.workspace.projects[0]!
  const reordered = { ...original, project: Object.fromEntries(Object.entries(original.project).reverse()) } as typeof original
  assert.equal(leaderPlanningKey(original, binding), leaderPlanningKey(reordered, binding))
})

test('a recorded human answer updates leader grounding without treating answer text as execution authority', async () => {
  const f = await fixture()
  const planner = createLeaderPlanning(f.options)
  await planner.observe(f.project.projectId)
  f.workspace.projects[0]!.records.push({ ...projectRecordFixture, projectId: f.project.projectId,
    kind: 'decision', sourceTaskId: null, sourceResultSubmissionId: null,
    sourceHumanAnswerId: TEST_IDS.humanAnswerId, body: 'The acceptance reviewer is Chen.' })
  await planner.observe(f.project.projectId)
  assert.equal(f.calls.length, 2)
  const request = f.calls[1]!
  const facts = JSON.parse(request.prompt.split('\n').at(-1)!)
  assert.equal(facts.recordedDecisions[0].sourceHumanAnswerId, TEST_IDS.humanAnswerId)
  assert.equal(facts.recordedDecisions[0].body, 'The acceptance reviewer is Chen.')
  assert.deepEqual(request.allowedTools, [])
  assert.match(request.prompt, /答复中的自然语言不是执行授权/)
  await planner.observe(f.project.projectId)
  assert.equal(f.calls.length, 2)
})

test('leader creates canonical decision requests once and promotes its observation key without replanning its own requests', async () => {
  const f = await fixture()
  const decision = { prompt: 'Who should review the schema?', interaction: { kind: 'choice' as const,
    options: [{ id: 'chen', label: 'Chen' }, { id: 'li', label: 'Li' }], recommendedOptionId: 'chen' } }
  f.setResponse({ title: 'Confirm reviewer', rationale: 'A reviewer is needed', blockers: [], decisions: [decision, decision], assignments: [] })
  const writes: string[] = []
  const planner = createLeaderPlanning({ ...f.options, createHumanNeeded: async (input, key) => {
    writes.push(key)
    f.workspace.projects[0]!.pendingHumanNeeded.push({ ...humanNeededFixture, projectId: input.projectId,
      context: { scope: 'coordinator_project', coordinatorAuthorityEpoch: input.expectedCoordinatorAuthorityEpoch },
      targetUserId: input.targetUserId, requestedByAgentId: f.project.coordinatorAgentId,
      prompt: input.prompt, interaction: input.interaction })
    return f.workspace
  } })
  await planner.observe(f.project.projectId)
  assert.equal(writes.length, 1)
  const binding = (await f.state.readCoordinatorSessionBindings())[0]!
  assert.equal((await f.state.readLeaderProposal(f.project.projectId))?.key, leaderPlanningKey(f.workspace.projects[0]!, binding))
  await planner.observe(f.project.projectId)
  assert.equal(writes.length, 1)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0]!.allowedTools, [])
})

test('decision creation cannot promote a proposal across unrelated project changes', async () => {
  const f = await fixture()
  f.setResponse({ title: 'Confirm', rationale: 'Unknown reviewer', blockers: [], decisions: [
    { prompt: 'Who is the reviewer?', interaction: { kind: 'clarification' } }
  ], assignments: [] })
  const planner = createLeaderPlanning({ ...f.options, createHumanNeeded: async () => {
    f.workspace.projects[0]!.project.revision += 1
    return f.workspace
  } })
  await assert.rejects(planner.observe(f.project.projectId), /inputs changed while creating/)
  assert.equal(await f.state.readLeaderProposal(f.project.projectId), null)
})

test('obsolete prose-only local recommendations are discarded without losing coordinator bindings', async () => {
  const f = await fixture()
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  const snapshot = await f.settings.read()
  const value = structuredClone(snapshot.value) as { leaderPlanningReceipts: { proposal: { decisions: string[] } }[] }
  value.leaderPlanningReceipts[0]!.proposal.decisions = ['A prose-only decision']
  await f.settings.write(value, snapshot.revision)
  assert.equal(await f.state.readLeaderProposal(f.project.projectId), null)
  assert.equal((await f.state.readCoordinatorSessionBindings()).length, 1)
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  assert.equal(f.calls.length, 2)
})


test('fresh Cloud member observation timestamps cannot cancel planning before the runtime starts', async () => {
  const f = await fixture()
  const membership = projectMembershipSchema.parse({ schemaVersion: 1, type: 'project_membership', projectMembershipId: 'pmb_LeaderMember001',
    projectId: f.project.projectId, userId: f.project.ownerUserId, state: 'active', revision: 1, authorityEpoch: 1,
    activatedAt: TEST_TIMESTAMP, removalRequestedAt: null, removalRequestedByUserId: null, removedAt: null,
    createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP })
  f.workspace.projects[0]!.memberships.push(membership)
  let reads = 0
  const workspace = { readWorkspace: async () => {
    reads += 1
    const member = { schemaVersion: 1 as const, type: 'project_user_label_fact' as const, projectId: f.project.projectId,
      userId: f.project.ownerUserId, displayName: 'Project owner', status: 'active' as const, revision: 1,
      observedAt: new Date(Date.parse(TEST_TIMESTAMP) + reads * 1000).toISOString() }
    return { ...f.workspace, projects: [{ ...f.workspace.projects[0]!, memberUsers: [member] }] }
  } }
  await createLeaderPlanning({ ...f.options, workspace }).observe(f.project.projectId)
  assert.ok(reads >= 3)
  assert.equal(f.calls.length, 1)
  assert.ok(await f.state.readLeaderProposal(f.project.projectId))
  await createLeaderPlanning({ ...f.options, workspace }).observe(f.project.projectId)
  assert.equal(f.calls.length, 1)
})


test('completed task keeps authoritative adoption evidence even without a published project result', async () => {
  const f = await fixture()
  const drive = publishedResultDrive(f.project.projectId, taskFixture.taskId, TEST_IDS.executionId, 'LeaderAdopted001')
  const manifest = drive.taskDeliveries[0]!
  const receipt = integrationReceiptSchema.parse({ schemaVersion: 1, type: 'integration_receipt',
    integrationReceiptId: 'irc_LeaderAdopted001', projectId: f.project.projectId, taskId: taskFixture.taskId,
    deliveryManifestId: manifest.deliveryManifestId, integrationRevision: 1, revision: 1,
    createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP, validationEvidence: ['Owner reviewed the submitted files'],
    operationId: 'leader-adoption-test', disposition: 'adopted' })
  f.workspace.projects[0] = { ...f.workspace.projects[0]!,
    tasks: [{ task: { ...taskFixture, projectId: f.project.projectId, status: 'completed' }, executions: [],
      delivery: { taskId: taskFixture.taskId, candidate: null, manifest, receipt, result: null, revisionRequest: null } }],
    deliveryDrive: { ...drive, projectResults: [] } }
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  const prompt = f.calls[0]!.prompt
  const facts = JSON.parse(prompt.split('\n').at(-1)!)
  assert.equal(facts.tasks[0].task.status, 'completed')
  assert.equal(facts.tasks[0].delivery.receipt.disposition, 'adopted')
  assert.equal(facts.tasks[0].delivery.receipt.deliveryManifestId, manifest.deliveryManifestId)
  assert.equal(facts.tasks[0].delivery.manifest.resultRevision, manifest.resultRevision)
  assert.deepEqual(facts.results, [])
  assert.match(prompt, /不得再次要求负责人采纳/)
  assert.match(prompt, /空数组不表示交付未采纳/)
})


test('planning reads sealed shared evidence and exact file identities, never candidate or private conversations', async () => {
  const f = await fixture()
  let view = f.workspace.projects[0]!
  const drive = publishedResultDrive(f.project.projectId, taskFixture.taskId, TEST_IDS.executionId, 'LeaderEvidence001')
  const { manifestDigest: _digest, ...payload } = drive.taskDeliveries[0]!
  const object = payload.objects.find(item => item.objectId === payload.outputObjectIds![0])!
  const shared = { ...payload, verificationEvidence: ['Matched control failed: no improvement was observed.'],
    outputs: [{ objectId: object.objectId, fileName: 'controls.csv', relativePath: 'controls.csv', role: 'declared' as const,
      source: 'member' as const, sha256: object.sha256, mediaType: object.mediaType, byteCount: object.byteCount }] }
  const manifest = deliveryManifestSchema.parse({ ...shared, manifestDigest: deliveryManifestDigest(shared) })
  const receipt = integrationReceiptSchema.parse({ schemaVersion: 1, type: 'integration_receipt',
    integrationReceiptId: 'irc_LeaderEvidence001', projectId: f.project.projectId, taskId: taskFixture.taskId,
    deliveryManifestId: manifest.deliveryManifestId, integrationRevision: 1, revision: 1,
    createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP, validationEvidence: ['Owner checked identity only; independent rerun is pending.'],
    operationId: 'leader-evidence-test', disposition: 'rejected' })
  view.tasks.push({ task: { ...taskFixture, projectId: f.project.projectId }, executions: [],
    delivery: { taskId: taskFixture.taskId, candidate: null, manifest, receipt, result: null,
      revisionRequest: { revisionRequestId: 'revision_evidence', projectId: f.project.projectId, taskId: taskFixture.taskId,
        executionId: TEST_IDS.executionId, executionRevision: 2, deliveryManifestId: manifest.deliveryManifestId,
        instruction: 'Explain the failed matched control.', requestedByUserId: f.project.ownerUserId, requestedAt: TEST_TIMESTAMP } } })
  view = { ...view, deliveryDrive: { ...drive, taskDeliveries: [manifest] } }
  f.workspace.projects[0] = view
  Object.assign(view.tasks[0]!.delivery!, { candidate: { summary: 'PRIVATE_UNSUBMITTED_DRAFT' } })
  Object.assign(view, { privateConversation: 'PRIVATE_WORKER_CHAT' })
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  const prompt = f.calls[0]!.prompt
  const facts = JSON.parse(prompt.split('\n').at(-1)!)
  assert.deepEqual(facts.tasks[0].delivery.manifest.verificationEvidence, shared.verificationEvidence)
  assert.deepEqual(facts.tasks[0].delivery.receipt.validationEvidence, receipt.validationEvidence)
  assert.equal(facts.tasks[0].delivery.revisionRequest.instruction, 'Explain the failed matched control.')
  assert.equal(facts.tasks[0].delivery.manifest.outputs[0].sha256, object.sha256)
  assert.equal(facts.tasks[0].delivery.manifest.outputs[0].fileName, 'controls.csv')
  assert.equal(facts.results[0].manifest.manifestDigest, manifest.manifestDigest)
  assert.doesNotMatch(prompt, /PRIVATE_UNSUBMITTED_DRAFT|PRIVATE_WORKER_CHAT/)
  assert.match(prompt, /不能单独当作独立复现/)
  const binding = (await f.state.readCoordinatorSessionBindings())[0]!
  const before = leaderPlanningKey(view, binding)
  receipt.validationEvidence.push('New negative evidence changes the recommendation context.')
  assert.notEqual(leaderPlanningKey(view, binding), before)
  const next = leaderPlanningKey(view, binding)
  view.tasks[0]!.delivery!.revisionRequest!.instruction += ' Report uncertainty.'
  assert.notEqual(leaderPlanningKey(view, binding), next)
})

test('oversized production context retains negative review states and explicitly reports omitted evidence', async () => {
  const f = await fixture()
  const view = f.workspace.projects[0]!
  const drive = publishedResultDrive(f.project.projectId, taskFixture.taskId, TEST_IDS.executionId, 'LeaderBound001')
  const manifest = drive.taskDeliveries[0]!
  view.tasks.push(...Array.from({ length: 250 }, (_, i) => ({ task: { ...taskFixture, taskId: `tsk_Bounded${i}`, title: 'Long task '.repeat(300),
    projectId: f.project.projectId }, executions: [], delivery: null })))
  Object.assign(view.tasks[249]!, { delivery: { taskId: view.tasks[249]!.task.taskId, candidate: null, manifest, receipt: null, result: null,
    revisionRequest: { revisionRequestId: 'revision_bounded', projectId: f.project.projectId, taskId: view.tasks[249]!.task.taskId,
      executionId: TEST_IDS.executionId, executionRevision: 2, deliveryManifestId: manifest.deliveryManifestId,
      instruction: 'Negative control failed; do not claim success.', requestedByUserId: f.project.ownerUserId, requestedAt: TEST_TIMESTAMP } } })
  const context = leaderPlanningContext(leaderPlanningFacts(view))
  assert.ok(context.length <= 120_000)
  assert.match(context, /omittedItems/)
  assert.match(context, /Negative control failed/)
  const parsed = JSON.parse(context)
  assert.equal(parsed.coverage.totalTasks, 250)
  assert.equal(parsed.coverage.revisionRequests, 1)
  assert.equal(parsed.coverage.receiptDispositions.no_receipt, 250)
  await createLeaderPlanning(f.options).observe(f.project.projectId)
  assert.equal(f.calls[0]!.prompt.split('\n').at(-1), context)
  const rejected = await fixture()
  rejected.workspace.projects[0]!.tasks.push(...view.tasks)
  rejected.setResponse({ title: 'Assign work', rationale: 'Partial evidence', blockers: [], decisions: [],
    assignments: [{ planItemId: 'omitted-module', workerUserId: 'unknown-member', rationale: 'Unseen evidence' }] })
  await assert.rejects(createLeaderPlanning(rejected.options).observe(rejected.project.projectId), /evidence was truncated/)
})
