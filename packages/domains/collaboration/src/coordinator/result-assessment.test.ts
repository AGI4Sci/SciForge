import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { projectFixture, TEST_IDS, TEST_TIMESTAMP, taskFixture, agentInboxMessageFixture } from '@sciforge/collaboration-contracts/testing'
import { agentInboxMessageSchema, deliveryManifestDigest } from '@sciforge/collaboration-contracts'
import type { DomainMainAgentExecutionRequest } from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost, DomainMainPackageSettingsSnapshot } from '@sciforge/domain-sdk/package-storage'
import { projectCoordinatorWorkspaceSchema } from './contract.js'
import { publishedResultDrive } from './cloud-test-fixtures.js'
import { createResultAssessment, assessmentKey } from './result-assessment.js'
import { ProjectCoordinatorStateStore } from './state.js'
import { createProjectCoordinatorActionPort } from './ports.js'

async function fixture(projectId = projectFixture.projectId, suffix = 'ObserveResult001') {
  const project = { ...projectFixture, projectId, status: 'active' as const }
  const drive = publishedResultDrive(project.projectId, taskFixture.taskId, TEST_IDS.executionId, suffix)
  const manifest = drive.taskDeliveries[0]!
  const body = Buffer.from(JSON.stringify({ schemaVersion: 2, projectId: project.projectId,
    taskId: taskFixture.taskId, executionId: TEST_IDS.executionId, contractRevision: 1, resultRevision: 1,
    summary: 'Matched control found no improvement. Counterexample under condition B; significance unknown.', outputs: [] }))
  const sha256 = createHash('sha256').update(body).digest('hex')
  const object = { ...manifest.objects[0]!, objectId: manifest.bundleObjectId!, sha256, byteCount: body.length }
  const { manifestDigest: _old, ...payload } = { ...manifest, bundleDigest: sha256, objects: [object, manifest.objects[1]!] }
  const exact = { ...payload, manifestDigest: deliveryManifestDigest(payload) }
  const workspace = projectCoordinatorWorkspaceSchema.parse({ connection: { state: 'ready', userId: project.ownerUserId, deviceId: TEST_IDS.deviceId },
    observedAt: TEST_TIMESTAMP, focusedProjectId: project.projectId, availableWorkerUsers: [],
    projects: [{ project, plan: null, memberUsers: [], workerGroups: [], tasks: [], offers: [], deliveryDrive: { ...drive, taskDeliveries: [exact] },
      pendingHumanNeeded: [], records: [], finalSummary: null, memberships: [] }] })
  let snapshot: DomainMainPackageSettingsSnapshot = { revision: 0, value: null }
  const settings: DomainMainPackageSettingsHost = { read: async () => structuredClone(snapshot), write: async (value, revision) => {
    if (revision !== snapshot.revision) throw new Error('CAS conflict')
    snapshot = { revision: revision + 1, value }; return structuredClone(snapshot)
  }, clear: async () => { throw new Error('Unexpected clear') } }
  const state = new ProjectCoordinatorStateStore(settings)
  await state.persistCoordinatorSessionBinding({ schemaVersion: 1, role: 'coordinator', projectId: project.projectId,
    principalUserId: project.ownerUserId, coordinatorAgentId: project.coordinatorAgentId, coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    runtimeId: 'runtime-observe', threadId: 'thread-observe', boundAt: TEST_TIMESTAMP })
  const calls: DomainMainAgentExecutionRequest[] = []
  let response = JSON.stringify({ action: 'propose_next_step', rationale: 'The negative result is informative.',
    suggestion: 'Compare condition B with matched resources before expanding scope.', limitations: ['Summary only; raw evidence not inspected.'] })
  let duringRun = async () => {}
  const identity = { state: 'ready' as const, baseUrl: 'https://fixture.invalid', userId: project.ownerUserId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }
  const options = { state, workspace: { readWorkspace: async () => workspace }, transport: { status: () => identity },
    localAgentId: () => project.coordinatorAgentId,
    getAgentExecution: () => ({ run: async (request: DomainMainAgentExecutionRequest) => { calls.push(request); await duringRun(); return {
      runtimeId: request.runtimeId!, threadId: request.threadId!, turnId: 'turn-observe', state: 'completed' as const, text: response } } }),
    delivery: { readObject: async () => ({ object, body }) } }
  return { options, settings, state, workspace, project, calls, body, identity,
    resultId: drive.projectResults[0]!.projectResultId,
    setResponse: (text: string) => { response = text }, setDuringRun: (run: () => Promise<void>) => { duringRun = run } }
}

test('production observation uses exact sealed negative result, tool-free bounded directive and durable restart dedup', async () => {
  const f = await fixture(); const port = createResultAssessment(f.options)
  await Promise.all([port.observe(f.project.projectId, f.resultId), port.observe(f.project.projectId, f.resultId)])
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0]!.allowedTools, [])
  assert.match(f.calls[0]!.prompt, /no improvement/); assert.equal(f.calls[0]!.threadId, 'thread-observe')
  const [entry] = await f.state.readResultAssessments(f.project.projectId)
  assert.equal(entry!.state, 'completed'); assert.equal(entry!.decision!.action, 'propose_next_step')
  await createResultAssessment({ ...f.options, state: new ProjectCoordinatorStateStore(f.settings) }).sweep()
  assert.equal(f.calls.length, 1)
})

test('late response cannot publish recommendation after authority changes', async () => {
  const f = await fixture(); f.setDuringRun(async () => { f.workspace.projects[0]!.project.coordinatorAuthorityEpoch += 1 })
  await createResultAssessment(f.options).observe(f.project.projectId, f.resultId)
  const [entry] = await f.state.readResultAssessments(f.project.projectId)
  assert.equal(entry!.state, 'stale'); assert.equal(entry!.decision, null)
})

test('invalid model output is unknown, bounded retries reuse exact directive, never synthesize success', async () => {
  const f = await fixture(); f.setResponse('{"action":"dispatch"}')
  for (let i = 0; i < 4; i++) await createResultAssessment(f.options).observe(f.project.projectId, f.resultId)
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0]!.clientDirectiveId, f.calls[1]!.clientDirectiveId)
  assert.equal((await f.state.readResultAssessments(f.project.projectId))[0]!.state, 'unknown')
})

test('revoked identity and paused project do not invoke runtime', async () => {
  const f = await fixture(); f.identity.userId = TEST_IDS.secondUserId
  await assert.rejects(createResultAssessment(f.options).observe(f.project.projectId, f.resultId), /authority/)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.state.readResultAssessments(f.project.projectId)).length, 0)
})

test('tampered bytes cannot enter model context', async () => {
  const f = await fixture(); f.body[0] = 0
  await createResultAssessment(f.options).observe(f.project.projectId, f.resultId)
  assert.equal(f.calls.length, 0); assert.equal((await f.state.readResultAssessments(f.project.projectId))[0]!.state, 'unknown')
})

test('current publication frontier ignores older events', async () => {
  const f = await fixture(); const drive = f.workspace.projects[0]!.deliveryDrive!
  drive.projectResults.push({ ...drive.projectResults[0]!, projectResultId: 'res_NewerObserve001', projectVersion: 2 })
  await createResultAssessment(f.options).observe(f.project.projectId, f.resultId)
  assert.equal(f.calls.length, 0)
})

test('timeout remains unknown and late model response never writes completed', async () => {
  const f = await fixture(); let release!: () => void
  f.setDuringRun(() => new Promise<void>((resolve) => { release = resolve }))
  await createResultAssessment({ ...f.options, timeoutMs: 5 }).observe(f.project.projectId, f.resultId)
  release(); await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal((await f.state.readResultAssessments(f.project.projectId))[0]!.state, 'unknown')
})

test('canonical published-result Inbox handler schedules observation and acknowledges without waiting on model', async () => {
  const f = await fixture(); let scheduled = 0
  const port = createProjectCoordinatorActionPort({ workspace: f.options.workspace, state: f.state,
    coordinatorCloudCommands: {} as never, transport: f.options.transport as never,
    requirementsDispatch: { reconcileProject: async () => {} },
    resultAssessment: { enqueue: async () => { scheduled++ } } })
  const result = f.workspace.projects[0]!.deliveryDrive!.projectResults[0]!
  const message = agentInboxMessageSchema.parse({ ...agentInboxMessageFixture, recipientAgentId: f.project.coordinatorAgentId,
    payload: { protocolVersion: '1.0', type: 'project.result.published', projectId: f.project.projectId,
      projectResultId: f.resultId, deliveryManifestId: result.deliveryManifestId, projectVersion: result.projectVersion } })
  await port.handleInbox(message); assert.equal(scheduled, 1)
})


test('unrelated Project revision and result list order do not create new model directives', async () => {
  const f = await fixture(); const view = f.workspace.projects[0]!
  view.deliveryDrive!.projectResults.push({ ...view.deliveryDrive!.projectResults[0]!, projectResultId: 'res_AnotherResult001' })
  const key = assessmentKey(view, f.resultId)
  view.project.revision += 1; view.deliveryDrive!.projectResults.reverse()
  assert.equal(assessmentKey(view, f.resultId), key)
  view.project.executionAuthorityEpoch += 1
  assert.notEqual(assessmentKey(view, f.resultId), key)
})

test('lifecycle stop aborts active observation, discards late response and prevents further dispatch', async () => {
  const f = await fixture(); let release!: () => void
  f.setDuringRun(() => new Promise<void>((resolve) => { release = resolve }))
  const port = createResultAssessment(f.options)
  const pending = port.observe(f.project.projectId, f.resultId)
  while (!f.calls.length) await new Promise((resolve) => setTimeout(resolve, 1))
  port.dispose(); await pending
  assert.equal(f.calls[0]!.signal!.aborted, true)
  release(); await new Promise((resolve) => setTimeout(resolve, 5))
  await port.observe(f.project.projectId, f.resultId)
  assert.equal(f.calls.length, 1)
  assert.equal((await f.state.readResultAssessments(f.project.projectId))[0]!.state, 'unknown')
})

test('canonical Inbox through durable observation to research projection exposes exact bounded suggestion', async () => {
  const f = await fixture(); const observer = createResultAssessment(f.options)
  const port = createProjectCoordinatorActionPort({ workspace: f.options.workspace, state: f.state,
    coordinatorCloudCommands: {} as never, transport: f.options.transport as never,
    requirementsDispatch: { reconcileProject: async () => {} }, resultAssessment: observer })
  const result = f.workspace.projects[0]!.deliveryDrive!.projectResults[0]!
  const message = agentInboxMessageSchema.parse({ ...agentInboxMessageFixture, recipientAgentId: f.project.coordinatorAgentId,
    payload: { protocolVersion: '1.0', type: 'project.result.published', projectId: f.project.projectId,
      projectResultId: f.resultId, deliveryManifestId: result.deliveryManifestId, projectVersion: result.projectVersion } })
  await port.handleInbox(message)
  while (['queued', 'running'].includes((await f.state.readResultAssessments(f.project.projectId))[0]?.state ?? '')) await new Promise((resolve) => setTimeout(resolve, 1))
  const entries = await f.state.readResultAssessments(f.project.projectId)
  const projected = projectCoordinatorWorkspaceSchema.parse({ ...f.workspace,
    projects: [{ ...f.workspace.projects[0], resultAssessments: entries }] })
  assert.equal(projected.projects[0]!.resultAssessments![0]!.decision!.action, 'propose_next_step')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { ResearchView } = await import('../renderer/workspace/research/ResearchView.js')
  const html = renderToStaticMarkup(createElement(ResearchView, {
    model: { project: projected.projects[0], currentUserId: f.project.ownerUserId, currentProject: f.project,
      projectId: f.project.projectId, cards: [] } as never,
    client: { readSessionProjection: async () => ({ bindings: [] }) } as never,
    busy: false, onSend: async () => true, onOpenTask: () => {}, onPlan: () => {} }))
  assert.match(html, /Negative result|negative result/); assert.match(html, /带入研究问题/)
  assert.match(html, new RegExp(entries[0]!.manifestDigest))
  const { Window } = await import('happy-dom')
  const window = new Window({ url: 'http://localhost/' })
  const { act } = await import('react')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const { createRoot } = await import('react-dom/client')
  const container = window.document.createElement('div'); window.document.body.append(container)
  const root = createRoot(container as never)
  let sent = 0
  try {
    await act(async () => { root.render(createElement(ResearchView, {
      model: { project: projected.projects[0], currentUserId: f.project.ownerUserId, currentProject: f.project,
        projectId: f.project.projectId, cards: [] } as never, busy: false,
      client: { readSessionProjection: async () => ({ bindings: [{ role: 'coordinator', projectId: f.project.projectId,
        principalUserId: f.project.ownerUserId, access: 'coordinator', coordinatorAgentId: f.project.coordinatorAgentId,
        coordinatorAuthorityEpoch: f.project.coordinatorAuthorityEpoch }] }) } as never,
      onSend: async () => { sent++; return true }, onOpenTask: () => {}, onPlan: () => {} })) })
    const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === '带入研究问题')!
    await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    assert.match(container.querySelector('textarea')!.value, /matched resources/)
    assert.match(container.querySelector('textarea')!.value, new RegExp(entries[0]!.manifestDigest))
    assert.equal(sent, 0)
  } finally {
    await act(async () => root.unmount())
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
    await window.happyDOM.close()
  }
})


test('empty startup discovers local intents only: zero Cloud, identity, source and model work', async () => {
  const f = await fixture()
  let cloudReads = 0
  let identityReads = 0
  let sourceReads = 0
  await createResultAssessment({ ...f.options,
    workspace: { readWorkspace: async () => { cloudReads++; throw new Error('Empty startup must not read Cloud.') } },
    transport: { status: () => { identityReads++; return f.identity } },
    delivery: { readObject: async () => { sourceReads++; throw new Error('Empty startup must not read sources.') } }
  }).sweep()
  assert.equal(cloudReads, 0); assert.equal(identityReads, 0); assert.equal(sourceReads, 0)
  assert.equal(f.calls.length, 0); assert.equal((await f.state.readPendingResultAssessments()).length, 0)
})

test('restart resumes only a persisted unknown intent through the same directive', async () => {
  const f = await fixture(); f.setResponse('invalid')
  await createResultAssessment(f.options).enqueue(f.project.projectId, f.resultId)
  while (['queued', 'running'].includes((await f.state.readResultAssessments(f.project.projectId))[0]?.state ?? '')) await new Promise((resolve) => setTimeout(resolve, 1))
  f.setResponse(JSON.stringify({ action: 'no_action', rationale: 'Keep negative result.', suggestion: '', limitations: ['Summary only.'] }))
  await createResultAssessment({ ...f.options, state: new ProjectCoordinatorStateStore(f.settings) }).sweep()
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0]!.clientDirectiveId, f.calls[1]!.clientDirectiveId)
  assert.equal((await f.state.readResultAssessments(f.project.projectId))[0]!.state, 'completed')
})

test('unresponsive source read is bounded before any model call', async () => {
  const f = await fixture()
  await createResultAssessment({ ...f.options, timeoutMs: 5, delivery: { readObject: () => new Promise(() => {}) } }).observe(f.project.projectId, f.resultId)
  assert.equal(f.calls.length, 0); assert.equal((await f.state.readResultAssessments(f.project.projectId))[0]!.state, 'unknown')
})

test('local observation allowance counts every attempt and stops new model turns after 20', async () => {
  const f = await fixture()
  for (let i = 0; i < 21; i++) {
    f.workspace.projects[0]!.project.goal = `Goal version ${i}`
    await createResultAssessment(f.options).observe(f.project.projectId, f.resultId)
  }
  assert.equal(f.calls.length, 20)
  const records = await f.state.readResultAssessments(f.project.projectId)
  assert.equal(records.at(-1)!.state, 'unknown'); assert.equal(records.at(-1)!.limits.perAuthorityAttempts, 20)
})


test('two projects drain serially without reconnect; queued work consumes no attempt while another model is active', async () => {
  const first = await fixture(); const second = await fixture('prj_SecondObserve01', 'SecondObserve001')
  first.workspace.projects.push(second.workspace.projects[0]!)
  await first.state.persistCoordinatorSessionBinding({ schemaVersion: 1, role: 'coordinator', projectId: second.project.projectId,
    principalUserId: second.project.ownerUserId, coordinatorAgentId: second.project.coordinatorAgentId,
    coordinatorAuthorityEpoch: second.project.coordinatorAuthorityEpoch, runtimeId: 'runtime-observe', threadId: 'thread-second', boundAt: TEST_TIMESTAMP })
  let release!: () => void
  first.setDuringRun(async () => { if (first.calls.length === 1) await new Promise<void>((resolve) => { release = resolve }) })
  const port = createResultAssessment({ ...first.options, delivery: { readObject: (input) => input.deliveryManifestId ===
    second.workspace.projects[0]!.deliveryDrive!.taskDeliveries[0]!.deliveryManifestId
    ? second.options.delivery.readObject() : first.options.delivery.readObject() } })
  await port.enqueue(first.project.projectId, first.resultId)
  while (!first.calls.length) await new Promise((resolve) => setTimeout(resolve, 1))
  await port.enqueue(second.project.projectId, second.resultId)
  const queued = (await first.state.readResultAssessments(second.project.projectId))[0]!
  assert.equal(queued.state, 'queued'); assert.equal(queued.attempt, 0); assert.equal(first.calls.length, 1)
  release()
  await port.observe(second.project.projectId, second.resultId)
  assert.equal(first.calls.length, 2)
  assert.equal((await first.state.readResultAssessments(second.project.projectId))[0]!.state, 'completed')
  assert.equal((await first.state.readResultAssessments(second.project.projectId))[0]!.attempt, 1)
})

test('successive publications drain normally and stale predecessor proposal cannot replace current result', async () => {
  const f = await fixture(); let release!: () => void
  f.setDuringRun(async () => { if (f.calls.length === 1) await new Promise<void>((resolve) => { release = resolve }) })
  const port = createResultAssessment(f.options)
  await port.enqueue(f.project.projectId, f.resultId)
  while (!f.calls.length) await new Promise((resolve) => setTimeout(resolve, 1))
  const drive = f.workspace.projects[0]!.deliveryDrive!
  const next = { ...drive.projectResults[0]!, projectResultId: 'res_NextObserve001', projectVersion: 2 }
  drive.projectResults.push(next)
  await port.enqueue(f.project.projectId, next.projectResultId)
  assert.equal((await f.state.readResultAssessments(f.project.projectId)).at(-1)!.attempt, 0)
  release(); await port.observe(f.project.projectId, next.projectResultId)
  const records = await f.state.readResultAssessments(f.project.projectId)
  assert.equal(records[0]!.state, 'stale'); assert.equal(records.at(-1)!.state, 'completed')
  assert.equal(f.calls.length, 2)
})


test('queue wait expiration records unknown without consuming a model attempt', async () => {
  const f = await fixture(); let clock = Date.now(); let release!: () => void
  f.setDuringRun(async () => { if (f.calls.length === 1) await new Promise<void>((resolve) => { release = resolve }) })
  const port = createResultAssessment({ ...f.options, now: () => new Date(clock) })
  await port.enqueue(f.project.projectId, f.resultId)
  while (!f.calls.length) await new Promise((resolve) => setTimeout(resolve, 1))
  const drive = f.workspace.projects[0]!.deliveryDrive!
  const next = { ...drive.projectResults[0]!, projectResultId: 'res_QueueExpired001', projectVersion: 2 }
  drive.projectResults.push(next); await port.enqueue(f.project.projectId, next.projectResultId)
  clock += 300_001; release(); await port.observe(f.project.projectId, next.projectResultId)
  const record = (await f.state.readResultAssessments(f.project.projectId)).at(-1)!
  assert.equal(record.state, 'unknown'); assert.equal(record.attempt, 0); assert.equal(f.calls.length, 1)
})


test('pending recovery targets only its referenced Project and never lists the Cloud workspace', async () => {
  const f = await fixture(); f.setResponse('invalid')
  await createResultAssessment(f.options).observe(f.project.projectId, f.resultId)
  const before = (await f.state.readPendingResultAssessments())[0]!
  assert.equal(before.state, 'unknown')
  f.setResponse(JSON.stringify({ action: 'no_action', rationale: 'Keep the counterexample.', suggestion: '', limitations: ['Summary only.'] }))
  const requests: Array<{ projectId?: string }> = []
  await createResultAssessment({ ...f.options, state: new ProjectCoordinatorStateStore(f.settings), workspace: {
    readWorkspace: async (input) => { requests.push(input); assert.equal(input.projectId, f.project.projectId); return f.workspace }
  } }).sweep()
  assert.ok(requests.length > 0)
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0]!.clientDirectiveId, f.calls[1]!.clientDirectiveId)
  assert.equal((await f.state.readPendingResultAssessments()).length, 0)
})

test('recovery of an old pending intent cannot reserve work against a changed goal baseline', async () => {
  const f = await fixture(); f.setResponse('invalid')
  await createResultAssessment(f.options).observe(f.project.projectId, f.resultId)
  const before = await f.state.readResultAssessments(f.project.projectId)
  f.workspace.projects[0]!.project.goal = 'Changed research scope requires a new event or explicit input.'
  await createResultAssessment(f.options).sweep()
  assert.equal(f.calls.length, 1)
  assert.deepEqual(await f.state.readResultAssessments(f.project.projectId), before)
})
