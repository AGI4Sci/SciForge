import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import { Window } from 'happy-dom'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import { ProjectExecutionControls } from './ProjectExecutionControls.js'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { getI18n, setI18n } from 'react-i18next'
import { sectionMessages } from '../section-messages.js'
import { workspaceTranslationResources } from '../workspace-i18n.js'

test('initial and next-step generation controls follow the host language', async () => {
  const previous = getI18n()
  const instance = i18next.createInstance()
  await instance.init({ lng: 'en', defaultNS: 'common', resources: { en: { common: workspaceTranslationResources(sectionMessages, 'en') } } })
  setI18n(instance)
  try {
    for (const status of ['paused', 'active']) {
      const model = { currentUserId: 'owner', cards: [], project: { project: { status, executionMode: 'ai_leader', ownerUserId: 'owner' } } } as unknown as WorkspaceViewModel
      const markup = renderToStaticMarkup(<ProjectExecutionControls model={model} busy={false} onMode={() => {}} onAuthorize={() => {}} onRetry={() => {}} onOpenResearch={() => {}} />)
      assert.match(markup, status === 'paused' ? /Generate starting suggestions/ : /Generate next-step suggestions/)
      assert.match(markup, /Further actions require their own authorization/)
      assert.doesNotMatch(markup, /生成启动建议|生成下一步建议|生成仅整理建议/)
    }
  } finally { setI18n(previous) }
})

// UI fixtures only; no live Cloud or model requests.
const browser = new Window({ url: 'https://fixture.invalid/' })
const descriptors = new Map<string, PropertyDescriptor | undefined>()
before(() => {
  for (const [key, value] of Object.entries({ window: browser, document: browser.document,
    navigator: browser.navigator, HTMLElement: browser.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})
after(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  browser.close()
})

async function render(options: { status?: string; owner?: boolean; mode?: string; planning?: string; busy?: boolean } = {}) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let retries = 0
  const model = { currentUserId: options.owner === false ? 'member' : 'owner', connection: { tone: 'ready' }, cards: [], members: [],
    project: { project: { ownerUserId: 'owner', executionMode: options.mode ?? 'ai_leader', status: options.status ?? 'paused' },
      leaderProposal: null, leaderSession: null,
      leaderPlanningStatus: options.planning ? { state: options.planning, message: 'fixture failure' } : null }
  } as unknown as WorkspaceViewModel
  await act(async () => root.render(<ProjectExecutionControls model={model} busy={options.busy ?? false}
    onMode={() => assert.fail('Planning must not switch mode')}
    onAuthorize={() => assert.fail('Planning must not authorize dispatch')}
    onOpenResearch={() => assert.fail('Planning must not open a separate runtime')}
    onRetry={() => { retries += 1 }} />))
  const button = [...container.querySelectorAll('button')].find(item => /生成.*建议/.test(item.textContent ?? ''))
  return { container, button, retries: () => retries,
    close: async () => { await act(async () => root.unmount()); container.remove() } }
}

for (const status of ['draft', 'paused', 'active']) {
  test(`Owner can explicitly request ${status} suggestions through existing retry callback`, async () => {
    const view = await render({ status })
    try {
      assert.equal(view.button?.textContent, status === 'active' ? '生成下一步建议' : '生成启动建议')
      assert.match(view.container.textContent!, /不会激活项目、派发或执行任务/)
      await act(async () => view.button!.click())
      assert.equal(view.retries(), 1)
    } finally { await view.close() }
  })
}

test('Owner sees explanatory failure and can explicitly retry', async () => {
  const view = await render({ planning: 'failed' })
  try {
    assert.match(view.container.querySelector('[role="alert"]')!.textContent!, /fixture failure/)
    assert.equal(view.button?.textContent, '重新生成领队建议')
    await act(async () => view.button!.click())
    assert.equal(view.retries(), 1)
  } finally { await view.close() }
})

for (const options of [{ owner: false }, { mode: 'manual' }, { status: 'completed' }, { status: 'cancelled' },
  { planning: 'running' }, { status: 'completed', planning: 'failed' }]) {
  test(`planning entry is absent for ${JSON.stringify(options)}`, async () => {
    const view = await render(options)
    try { assert.equal(view.button, undefined) } finally { await view.close() }
  })
}

for (const planning of [undefined, 'failed']) {
  test(`busy disables ${planning ?? 'initial'} suggestion request`, async () => {
    const view = await render({ busy: true, planning })
    try {
      assert.equal(view.button?.disabled, true)
      await act(async () => view.button!.click())
      assert.equal(view.retries(), 0)
    } finally { await view.close() }
  })
}

function pausedBatchModel() {
  const projectId = 'prj_Batch0000001'
  const requirementsDocumentId = 'rqd_Batch000000000000000001'
  return { currentUserId: 'owner', connection: { tone: 'ready' }, cards: [],
    members: [{ userId: 'worker', name: 'Worker', state: 'active' }],
    project: { project: { projectId, ownerUserId: 'owner', status: 'paused', executionMode: 'ai_leader' },
      confirmedRequirements: { projectId, requirementsDocumentId, state: 'confirmed', goalsDeliverables: 'Goal', inputsBoundaries: 'Bounds', acceptanceCriteria: [],
        workModules: [{ planItemId: 'item_BatchModule01', title: 'First module', objective: 'Work', dependencyPlanItemIds: [], requiredCapabilityTags: ['analysis'], output: { fileName: 'result.txt', mediaType: 'text/plain', maxBytes: 1000 } }] },
      tasks: [], offers: [], workerGroups: [{ userId: 'worker', agents: [{ projectAvailability: { availability: {
        agentActive: true, deviceActive: true, runtimeCapabilityTags: ['analysis'] } } }] }],
      leaderProposal: { key: 'proposal', title: 'Suggestions', rationale: 'Review', blockers: [], decisions: [], assignments: [] }
    }
  } as any
}

test('paused AI-led project with an empty proposal can authorize a manually selected first batch', async () => {
  const { createRoot } = await import('react-dom/client')
  const model = pausedBatchModel()
  const container = document.createElement('div')
  const root = createRoot(container)
  const writes: unknown[] = []
  try {
    await act(async () => root.render(<ProjectExecutionControls model={model} busy={false} onMode={() => {}} onAuthorize={value => writes.push(value)} onOpenResearch={() => {}} />))
    const select = container.querySelector('[aria-label="执行人：First module"]') as HTMLSelectElement
    assert.ok(select, 'batch does not depend on active-only card.assignment')
    const approve = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('批准并派发'))!
    assert.equal(approve.disabled, true)
    await act(async () => { select.value = 'worker'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
    assert.equal(approve.disabled, false)
    await act(async () => approve.click())
    assert.deepEqual(writes, [[{ planItemId: 'item_BatchModule01', workerUserId: 'worker' }]])
  } finally { await act(async () => root.unmount()) }
})

for (const invalid of ['owner', 'connection', 'closed', 'document', 'existing-task', 'existing-offer', 'dependency', 'dependency-unadopted', 'worker-capability', 'suggested-worker']) {
  test(`batch authorization excludes unsafe candidate: ${invalid}`, () => {
    const model = pausedBatchModel()
    const project = model.project
    const document = project.confirmedRequirements
    const taskId = canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_BatchModule01')
    if (invalid === 'owner') model.currentUserId = 'other'
    if (invalid === 'connection') model.connection.tone = 'pending'
    if (invalid === 'closed') project.project.status = 'completed'
    if (invalid === 'document') document.projectId = 'other-project'
    if (invalid === 'existing-task') project.tasks.push({ task: { taskId } })
    if (invalid === 'existing-offer') project.offers.push({ taskId })
    if (invalid === 'dependency') document.workModules[0].dependencyPlanItemIds = ['item_Missing0001']
    if (invalid === 'dependency-unadopted') {
      document.workModules[0].dependencyPlanItemIds = ['item_Dependency0001']
      project.tasks.push({ task: { taskId: canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_Dependency0001'), projectId: project.project.projectId, status: 'completed' }, delivery: { receipt: { disposition: 'unadopted' } } })
    }
    if (invalid === 'worker-capability') project.workerGroups[0].agents[0].projectAvailability.availability.runtimeCapabilityTags = []
    project.leaderProposal.assignments = [{ planItemId: 'item_BatchModule01', workerUserId: invalid === 'suggested-worker' ? 'unknown-worker' : 'worker', rationale: 'suggested' }]
    const markup = renderToStaticMarkup(<ProjectExecutionControls model={model} busy={false} onMode={() => {}} onAuthorize={() => assert.fail('No writes')} onOpenResearch={() => {}} />)
    if (invalid === 'worker-capability') {
      assert.doesNotMatch(markup, /<option value="worker"/)
      assert.match(markup, /disabled=""[^>]*>批准并派发/)
    } else if (invalid === 'suggested-worker') {
      assert.doesNotMatch(markup, /<option value="unknown-worker"/)
      assert.match(markup, /disabled=""[^>]*>批准并派发/)
    } else assert.doesNotMatch(markup, /批准并派发/)
  })
}

for (const tags of [undefined, []]) {
  test(`untagged modules allow active human members without Agent availability: ${JSON.stringify(tags)}`, () => {
    const model = pausedBatchModel()
    model.project.confirmedRequirements.workModules[0].requiredCapabilityTags = tags
    model.project.workerGroups = []
    model.members.push({ userId: 'inactive', name: 'Inactive', state: 'removed' })
    const markup = renderToStaticMarkup(<ProjectExecutionControls model={model} busy={false} onMode={() => {}} onAuthorize={() => {}} onOpenResearch={() => {}} />)
    assert.match(markup, /<option value="worker"/)
    assert.doesNotMatch(markup, /<option value="inactive"/)
  })
}

test('manual paused startup explicitly authorizes activation without claiming dispatch or using an old AI suggestion', async () => {
  const { createRoot } = await import('react-dom/client')
  const model = pausedBatchModel()
  model.project.project.executionMode = 'manual'
  model.project.confirmedRequirements.workModules[0].requiredCapabilityTags = []
  model.project.workerGroups = []
  model.project.leaderProposal.assignments = [{ planItemId: 'item_BatchModule01', workerUserId: 'worker', rationale: 'OLD AI ADVICE' }]
  const container = document.createElement('div')
  const root = createRoot(container)
  const writes: unknown[] = []
  try {
    await act(async () => root.render(<ProjectExecutionControls model={model} busy={false} onMode={() => assert.fail('No mode switch')} onAuthorize={value => writes.push(value)} onOpenResearch={() => {}} />))
    assert.match(container.textContent!, /不会派发任务或启动 AI/)
    assert.doesNotMatch(container.textContent!, /OLD AI ADVICE|批准并派发/)
    const select = container.querySelector('[aria-label="执行人：First module"]') as HTMLSelectElement
    const start = [...container.querySelectorAll('button')].find(button => button.textContent === '授权并启动项目')!
    assert.equal(select.value, '')
    assert.equal(start.disabled, true)
    await act(async () => { select.value = 'worker'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
    await act(async () => start.click())
    assert.deepEqual(writes, [[{ planItemId: 'item_BatchModule01', workerUserId: 'worker' }]])
    model.project.project.status = 'active'
    await act(async () => root.render(<ProjectExecutionControls model={model} busy={false} onMode={() => {}} onAuthorize={() => assert.fail('No repeat startup')} onOpenResearch={() => {}} />))
    assert.doesNotMatch(container.textContent!, /授权并启动项目/)
  } finally { await act(async () => root.unmount()) }
})

for (const invalid of ['offline', 'member', 'missing-output']) {
  test(`manual startup excludes invalid authority or output: ${invalid}`, () => {
    const model = pausedBatchModel()
    model.project.project.executionMode = 'manual'
    if (invalid === 'offline') model.connection.tone = 'pending'
    if (invalid === 'member') model.currentUserId = 'worker'
    if (invalid === 'missing-output') delete model.project.confirmedRequirements.workModules[0].output
    const markup = renderToStaticMarkup(<ProjectExecutionControls model={model} busy={false} onMode={() => {}} onAuthorize={() => assert.fail('No write')} onOpenResearch={() => {}} />)
    assert.doesNotMatch(markup, /授权并启动项目/)
  })
}
