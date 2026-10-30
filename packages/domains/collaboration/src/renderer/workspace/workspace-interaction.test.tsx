import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import { Window } from 'happy-dom'
import { createCollaborationRendererClient } from '../collaboration-capability-client.js'
import { ProjectCoordinatorRequirementsCompletionClientError, createProjectCoordinatorRendererClient } from '../../coordinator/renderer/project-coordinator-capability-client.js'
import { COLLABORATION_CAPABILITY_IDS } from '../../contract.js'
import { PROJECT_COORDINATOR_CAPABILITY_IDS } from '../../coordinator/contract.js'
import { NewProjectDialog } from './projects/NewProjectDialog.js'
import { RequirementsView } from './requirements/RequirementsView.js'
import { CollaborationWorkspacePage } from './CollaborationWorkspacePage.js'
import { SettingsView } from './settings/SettingsView.js'
import { TaskDrawer } from './task-drawer/TaskDrawer.js'
import { ProjectBoard } from './project-board/ProjectBoard.js'
import { ProjectHeader } from './project-header/ProjectHeader.js'
import type { TaskCardModel } from './workspace-types.js'
import { canonicalTaskIdForRequirementsModule, dashboardActivityItemSchema } from '@sciforge/collaboration-contracts'
import type { WorkspaceViewModel } from './workspace-view-model.js'

const browserWindow = new Window({ url: 'https://sciforge.test/' })
const globalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()

before(() => {
  const globals: Readonly<Record<string, unknown>> = {
    window: browserWindow,
    self: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLInputElement: browserWindow.HTMLInputElement,
    HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
    HTMLSelectElement: browserWindow.HTMLSelectElement,
    SVGElement: browserWindow.SVGElement,
    Event: browserWindow.Event,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    requestAnimationFrame: browserWindow.requestAnimationFrame.bind(browserWindow),
    cancelAnimationFrame: browserWindow.cancelAnimationFrame.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true
  }
  for (const [key, value] of Object.entries(globals)) {
    globalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})

after(() => {
  for (const [key, descriptor] of globalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  browserWindow.close()
})

type Call = Readonly<{ id: string; input: unknown; options?: unknown }>

const availableOffer = { state: 'available', reason: 'manual_decision_required', canAccept: true, canReject: true, canDismiss: true } as const

function withAvailableOffer(status: unknown, taskId: string, taskOfferId: string, workerUserId: string) {
  return { ...(status as object), projects: [{ projectId: 'prj_demo000001', tasks: [{ taskId, taskOfferId, workerUserId, offerAvailability: availableOffer }] }] } as never
}

function clients() {
  const calls: Call[] = []
  const deliveryTarget = {
    projectId: 'prj_demo000001', taskId: 'tsk_demo000001', executionId: 'exe_demo000001',
    contractRevision: 1, resultRevision: 2, bundleDigest: 'a'.repeat(64), decision: 'approved' as const
  }
  const invoker = {
    invoke: async (contract: { actionId: string }, input: unknown, options?: unknown) => {
      calls.push({ id: contract.actionId, input, options })
      if (contract.actionId === COLLABORATION_CAPABILITY_IDS.workerDeliveryRead) {
        return { delivery: { candidate: { target: deliveryTarget, bundle: { summary: 'candidate', outputs: [] }, sourceTurnId: 'turn_demo000001', frozenAt: '2026-10-18T00:00:00.000Z', dirty: false } } }
      }
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) return { status: 'completed', document: {} }
      return {}
    }
  }
  return {
    calls,
    deliveryTarget,
    coordinator: createProjectCoordinatorRendererClient(invoker as never),
    collaboration: createCollaborationRendererClient(invoker as never)
  }
}

async function mount(element: React.ReactElement): Promise<Readonly<{
  container: HTMLElement
  rerender(element: React.ReactElement): Promise<void>
  unmount(): Promise<void>
}>> {
  const { createRoot } = await import('react-dom/client')
  const container = browserWindow.document.createElement('div') as unknown as HTMLElement
  browserWindow.document.body.append(container as never)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
    await tick()
    await tick()
  })
  return {
    container,
    rerender: async (next) => {
      await act(async () => {
        root.render(next)
        await tick()
        await tick()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await tick()
    await tick()
  })
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
    assert.equal(typeof setter, 'function')
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
  })
}

async function setSelectValue(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
  })
}

async function confirmDelivery(container: HTMLElement): Promise<void> {
  await click(buttonByText(container, '提交'))
  const confirm = container.querySelector('[data-testid="delivery-submit-confirm"]') as HTMLButtonElement
  assert.ok(confirm, 'submission must pass through the confirmation dialog')
  await click(confirm)
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text)
  assert.ok(button, `missing button ${text}`)
  return button as HTMLButtonElement
}

function stubClipboard(): string[] {
  const writes: string[] = []
  Object.defineProperty(browserWindow.navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { writes.push(value) } } })
  return writes
}

function restoreClipboard(): void {
  Reflect.deleteProperty(browserWindow.navigator, 'clipboard')
}

function inputByLabel(container: HTMLElement, text: string): HTMLInputElement | HTMLTextAreaElement {
  const label = [...container.querySelectorAll('label')].find((candidate) => candidate.textContent?.includes(text))
  const input = label?.querySelector('input, textarea')
  assert.ok(input, `missing field ${text}`)
  return input as HTMLInputElement | HTMLTextAreaElement
}

function model(overrides: Partial<WorkspaceViewModel> = {}): WorkspaceViewModel {
  const owner = 'usr_owner000001'
  const projectId = 'prj_demo000001'
  const project = {
    project: { projectId, ownerUserId: owner, revision: 7, displayName: 'Demo project', goal: 'Demo goal', status: 'active' },
    memberUsers: [{ userId: owner, displayName: 'Owner' }, { userId: 'usr_worker000001', displayName: 'Worker' }, { userId: 'usr_alice000001', displayName: 'Alice' }],
    memberships: [
      { projectMembershipId: 'pm_owner000001', userId: owner, state: 'active', revision: 3 },
      { projectMembershipId: 'pm_worker000001', userId: 'usr_worker000001', state: 'active', revision: 4 }
    ],
    requirementsDraft: { requirementsDocumentId: 'rqd_demo00000000000000001', projectId, inputReferences: [], revision: 3, documentRevision: 3, contentDigest: 'digest_demo', goalsDeliverables: 'Original goals', inputsBoundaries: 'Original boundaries', workModules: [{ planItemId: 'item_demo_01', title: 'Module one', objective: 'Objective', dependencyPlanItemIds: [], dependencyLabel: '可立即开始' }], acceptanceCriteria: [{ target: 'Module one', criteria: 'Criterion', evidenceMethod: 'Report' }], state: 'draft' },
    confirmedRequirements: null,
    requirementsCompletion: null,
    tasks: [], offers: [], pendingHumanNeeded: [], records: [], finalSummary: null, deliveryDrive: null,
    projectPlan: null, coordinatorTransferFeedback: null, workerGroups: [], legacyHistory: { readOnly: true, plans: [], tasks: [], executions: [] }
  } as never
  return {
    currentProject: { initials: 'DP', name: 'Demo project', memberCount: 2, status: 'active', description: 'Demo goal', requirementsRevision: 3, ownerName: 'Owner', ownerUserId: owner, headerAction: '编辑需求' },
    projects: [], selectedProjectId: projectId, cards: [], selectedCard: { id: 'empty', reference: '#—', moduleType: '需求模块', title: '暂无任务', assignee: null, date: '—', status: 'intake' }, route: 'board', requirements: { revision: 3, documentRevision: 3, state: 'draft', goalsDeliverables: 'Original goals', inputsBoundaries: 'Original boundaries', workModules: [{ planItemId: 'item_demo_01', title: 'Module one', objective: 'Objective', dependencyPlanItemIds: [], dependencyLabel: '可立即开始' }], acceptanceCriteria: [{ target: 'Module one', criteria: 'Criterion', evidenceMethod: 'Report' }], confirmed: false }, members: [{ id: 'pm_owner000001', userId: owner, name: 'Owner', role: '所有者', state: 'active' }, { id: 'pm_worker000001', userId: 'usr_worker000001', name: 'Worker', role: '成员', state: 'active' }], myWork: [], inbox: [], currentUserId: owner, projectId, project, files: null, mentionableUsers: [{ userId: 'usr_alice000001', displayName: 'Alice' }], ...overrides
  } as WorkspaceViewModel
}

function card(overrides: Partial<TaskCardModel> = {}): TaskCardModel {
  return { id: 'tsk_demo000001', reference: '#1', moduleType: '需求模块', title: 'Demo task', assignee: 'Worker', assigneeUserId: 'usr_worker000001', date: '10-18', status: 'in-progress', projectId: 'prj_demo000001', ...overrides }
}

function snapshot(tasks: readonly unknown[] = [], notifications: readonly unknown[] = []) {
  return { revision: 1, connection: { state: 'ready' }, providerOptions: [], managedContainers: [], projections: [], projects: [], dashboards: [{ schemaVersion: 1, revision: 1, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', type: 'cloud_project_dashboard', projectId: 'prj_demo000001', projectName: 'Demo project', role: 'owner', view: 'board', tasks, activity: [], mentionableUsers: [], materialConflicts: [], activityCursor: null, stale: false, offline: false, revoked: false }], queue: [], notifications, diagnostics: [] } as never
}

test('Offer buttons require structured backend availability even when a stale Chinese label still says pending', async () => {
  let decisions = 0
  const mounted = await mount(<TaskDrawer projectName="Demo" currentUserId="usr_worker000001" members={[]} card={card({ stateLabel: '待你接受', offerId: 'tof_TestRecover0001' })} onOfferDecision={() => { decisions += 1 }} />)
  try {
    assert.equal([...mounted.container.querySelectorAll('button')].some((button) => button.textContent === '接受任务'), false)
    assert.equal(decisions, 0)
  } finally { await mounted.unmount() }
})

test('Offer detail follows structured recovery transitions and preserves the offline queued acceptance explanation', async () => {
  const task = card({ offerId: 'tof_TestRecover0001', stateLabel: 'A translated label' })
  const props = { projectName: 'Demo', currentUserId: 'usr_worker000001', members: [] }
  let decisions = 0
  const mounted = await mount(<TaskDrawer {...props} card={task} onOfferDecision={() => { decisions += 1 }} />)
  try {
    for (const [state, reason, label] of [
      ['recovering', 'authority_unverified', '恢复中'],
      ['sync_pending', 'synchronization_pending', '待同步'],
      ['claimed_elsewhere', 'claimed_by_other_device', '已被其他设备领取'],
      ['invalid', 'contract_changed', '已失效'],
      ['unverified', 'recovery_evidence_missing', '待核实']
    ] as const) {
      await mounted.rerender(<TaskDrawer {...props} card={{ ...task, offerAvailability: { state, reason, canAccept: false, canReject: false, canDismiss: false } }} onOfferDecision={() => { decisions += 1 }} />)
      assert.match(mounted.container.textContent ?? '', new RegExp(label, 'u'))
      assert.equal([...mounted.container.querySelectorAll('button')].some((button) => button.textContent === '接受任务'), false)
    }
    await mounted.rerender(<TaskDrawer {...props} card={{ ...task, offerAvailability: { ...availableOffer, reason: 'offline_queue_available' } }} onOfferDecision={() => { decisions += 1 }} />)
    assert.match(mounted.container.textContent ?? '', /决定会保存在本机/u)
    assert.match(mounted.container.textContent ?? '', /同步成功前不会执行/u)
    await click(buttonByText(mounted.container, '接受任务'))
    assert.equal(decisions, 1, 'the translated label never controls permission')
  } finally { await mounted.unmount() }
})

test('new project dialog clicks create with entered name and description, and stays disabled when empty', async () => {
  const { calls, coordinator } = clients()
  const mounted = await mount(<NewProjectDialog busy={false} onCancel={() => undefined} onSubmit={(name, description) => { void coordinator.createProject({ createIntentId: 'pct_test000001', displayName: name, goal: description, budget: { maxTasks: 8, maxTasksPerRound: 2, maxCoordinationRounds: 4, maxTaskRetries: 1 } }) }} />)
  try {
    const create = buttonByText(mounted.container, '创建项目')
    assert.equal(create.disabled, true)
    await setValue(inputByLabel(mounted.container, '项目名称') as HTMLInputElement, 'Demo project')
    await setValue(inputByLabel(mounted.container, '项目说明') as HTMLTextAreaElement, 'Demo description')
    assert.equal(create.disabled, false)
    await click(create)
    assert.deepEqual(calls[0], { id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate, input: { createIntentId: 'pct_test000001', displayName: 'Demo project', goal: 'Demo description', budget: { maxTasks: 8, maxTasksPerRound: 2, maxCoordinationRounds: 4, maxTaskRetries: 1 } }, options: { approval: { mode: 'confirmation' } } })
  } finally { await mounted.unmount() }
})

test('requirements buttons render, edit both fields, and route save, complete, and confirmed document inputs', async () => {
  const { calls, coordinator } = clients()
  const fixture = model()
  const mounted = await mount(<RequirementsView model={fixture} busy={false} onSave={(goals, inputs) => { void coordinator.saveRequirementsDraft({ projectId: fixture.projectId!, expectedProjectRevision: fixture.project!.project.revision, expectedRequirementsRevision: fixture.requirements!.revision!, goalsDeliverables: goals, inputsBoundaries: inputs }) }} onComplete={() => { void coordinator.completeRequirements({ projectId: fixture.projectId!, expectedRequirementsRevision: fixture.requirements!.revision! }) }} onConfirm={() => { void coordinator.confirmRequirements({ projectId: fixture.projectId!, requirementsDocumentId: 'req_demo000001', expectedProjectRevision: fixture.project!.project.revision, expectedRequirementsRevision: fixture.requirements!.revision!, contentDigest: 'digest_demo' }) }} />)
  try {
    await setValue(inputByLabel(mounted.container, '目标与交付') as HTMLTextAreaElement, 'Edited goals')
    await setValue(inputByLabel(mounted.container, '输入与边界') as HTMLTextAreaElement, 'Edited boundaries')
    await click(buttonByText(mounted.container, '保存需求'))
    assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave)
    assert.deepEqual(calls.at(-1)?.input, { projectId: 'prj_demo000001', expectedProjectRevision: 7, expectedRequirementsRevision: 3, goalsDeliverables: 'Edited goals', inputsBoundaries: 'Edited boundaries' })
    await click(buttonByText(mounted.container, '重新补全'))
    assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete)
    await click(buttonByText(mounted.container, '确认需求'))
    assert.ok(mounted.container.querySelector('[role="dialog"]'))
    const confirmButtons = [...mounted.container.querySelectorAll('button')].filter((button) => button.textContent?.trim() === '确认需求') as HTMLButtonElement[]
    await click(confirmButtons.at(-1)!)
    assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm)
    assert.deepEqual(calls.at(-1)?.input, { projectId: 'prj_demo000001', requirementsDocumentId: 'req_demo000001', expectedProjectRevision: 7, expectedRequirementsRevision: 3, contentDigest: 'digest_demo' })
  } finally { await mounted.unmount() }
})

test('workspace page keeps the requirements row revision across save, completion, confirmation, and a later save', async () => {
  const calls: Call[] = []
  const pageProject = model().project as any
  const pageWorkspace = { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [pageProject] } as any
  const projectRecord = pageWorkspace.projects[0]
  const projectDocument = projectRecord.requirementsDraft
  const workspaceClient = {
    readWorkspace: async () => pageWorkspace,
    saveRequirementsDraft: async (input: Record<string, unknown>) => {
      calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave, input })
      projectDocument.revision += 1
      return projectDocument
    },
    completeRequirements: async (input: Record<string, unknown>) => {
      calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete, input })
      projectDocument.revision += 1
      return projectDocument
    },
    confirmRequirements: async (input: Record<string, unknown>) => {
      calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm, input })
      return pageWorkspace
    }
  } as never
  const collaborationClient = { readStatus: async () => snapshot([]) } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={workspaceClient} collaborationClient={collaborationClient} />)
  try {
    await tick(); await tick()
    const projectButton = mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement
    assert.ok(projectButton, mounted.container.innerHTML)
    await click(projectButton)
    await click(buttonByText(mounted.container, '需求'))
    await setValue(inputByLabel(mounted.container, '目标与交付') as HTMLTextAreaElement, 'Updated goals')
    await setValue(inputByLabel(mounted.container, '输入与边界') as HTMLTextAreaElement, 'Updated boundaries')
    await click(buttonByText(mounted.container, '保存需求'))
    assert.equal((calls.at(-1)?.input as { expectedRequirementsRevision: number }).expectedRequirementsRevision, 3)
    await click(buttonByText(mounted.container, '重新补全'))
    assert.equal((calls.at(-1)?.input as { expectedRequirementsRevision: number }).expectedRequirementsRevision, 4)
    await click(buttonByText(mounted.container, '确认需求'))
    await click([...mounted.container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '确认需求' && button.closest('[role="dialog"]')) as HTMLButtonElement)
    assert.equal((calls.at(-1)?.input as { expectedRequirementsRevision: number }).expectedRequirementsRevision, 5)
    await click(buttonByText(mounted.container, '保存需求'))
    assert.equal((calls.at(-1)?.input as { expectedRequirementsRevision: number }).expectedRequirementsRevision, 5)
    assert.deepEqual(calls.map((call) => call.id), [PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave, PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete, PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm, PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave])
  } finally { await mounted.unmount() }
})

test('concurrent requirements save conflicts remain visible after immediate and automatic refreshes', async () => {
  let project = structuredClone(model().project!)
  let saveCalls = 0
  let workspaceReads = 0
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('unused') },
    invoke: async (contract, input) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) {
        workspaceReads += 1
        return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [structuredClone(project)] } as never
      }
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave) {
        saveCalls += 1
        assert.equal((input as { expectedRequirementsRevision: number }).expectedRequirementsRevision, 3)
        assert.equal((input as { goalsDeliverables: string }).goalsDeliverables, 'My unsaved new goals')
        project = { ...project, requirementsDraft: { ...project.requirementsDraft!, revision: 4, goalsDeliverables: 'Other window goals' } }
        throw new Error('Requirements revision conflict: requested 3; current 4')
      }
      throw new Error('unexpected capability')
    }
  })
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '需求'))
    await setValue(inputByLabel(mounted.container, '目标与交付'), 'My unsaved new goals')
    const beforeSave = workspaceReads
    await click(buttonByText(mounted.container, '保存需求'))
    assert.equal(saveCalls, 1)
    assert.ok(workspaceReads > beforeSave, 'the rejected save refreshes the authoritative document')
    assert.equal(inputByLabel(mounted.container, '目标与交付').value, 'Other window goals')
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /Requirements revision conflict/u)
    project = { ...project, requirementsDraft: { ...project.requirementsDraft!, revision: 5 } }
    const beforeFocus = workspaceReads
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.ok(workspaceReads > beforeFocus, 'the production foreground refresh ran again')
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /Requirements revision conflict/u)
  } finally { await mounted.unmount() }
})

test('a successful requirements save replaces the previous save error and refreshes the page', async () => {
  let project = structuredClone(model().project!)
  let calls = 0
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('unused') },
    invoke: async (contract, input) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [structuredClone(project)] } as never
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave) {
        calls += 1
        if (calls === 1) throw new Error('Save was rejected')
        const save = input as { expectedRequirementsRevision: number; goalsDeliverables: string }
        assert.equal(save.expectedRequirementsRevision, 3)
        project = { ...project, requirementsDraft: { ...project.requirementsDraft!, revision: 4, goalsDeliverables: save.goalsDeliverables } }
        return project.requirementsDraft as never
      }
      throw new Error('unexpected capability')
    }
  })
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '需求'))
    await click(buttonByText(mounted.container, '保存需求'))
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /Save was rejected/u)
    await setValue(inputByLabel(mounted.container, '目标与交付'), 'Successfully saved goals')
    await click(buttonByText(mounted.container, '保存需求'))
    assert.equal(calls, 2)
    assert.equal(inputByLabel(mounted.container, '目标与交付').value, 'Successfully saved goals')
    assert.equal(mounted.container.querySelector('[role="alert"]'), null)
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.equal(mounted.container.querySelector('[role="alert"]'), null)
  } finally { await mounted.unmount() }
})

test('requirements version changes cannot clear a later file-read error from a different operation', async () => {
  let project = structuredClone(model().project!)
  project = { ...project, requirementsDraft: { ...project.requirementsDraft!, contentDigest: 'd'.repeat(64) } }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('unused') },
    invoke: async (contract) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [structuredClone(project)] } as never
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) return { status: 'failed', reason: 'write_failed' } as never
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.driveList) throw new Error('Project files are temporarily unavailable')
      throw new Error('unexpected capability')
    }
  })
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '需求'))
    await click(buttonByText(mounted.container, '重新补全'))
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u)
    await click(buttonByText(mounted.container, '文件'))
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /Project files are temporarily unavailable/u)
    project = { ...project, requirementsDraft: { ...project.requirementsDraft!, revision: 4, contentDigest: 'e'.repeat(64) },
      requirementsCompletion: { state: 'completed', requirementsDocumentId: project.requirementsDraft!.requirementsDocumentId,
        sourceRevision: 3, sourceContentDigest: 'd'.repeat(64), resultRevision: 4, resultContentDigest: 'e'.repeat(64) } }
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /Project files are temporarily unavailable/u)
  } finally { await mounted.unmount() }
})

for (const reason of ['runtime_execution_failed', 'revision_conflict'] as const) {
  test(`an ordinary unchanged draft save is not completion success (${reason})`, async () => {
    let project = structuredClone(model().project!)
    const original = structuredClone(project.requirementsDraft!)
    let completionRequests = 0
    let ordinarySaves = 0
    let failure: { state: 'failed'; reason: typeof reason; failedAt: string } | null = null
    const otherWindowSave = () => {
      ordinarySaves += 1
      // Same-document Owner draft.save preserves omitted parts and bumps revision.
      // No completion success or new completion output occurs in this fixture.
      project = { ...project, requirementsDraft: { ...project.requirementsDraft!, revision: 4 } }
    }
    const client = createProjectCoordinatorRendererClient({
      observe: async () => { throw new Error('unused') },
      invoke: async (contract, input) => {
        if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) {
          // The workspace queries completion attempts for the exact current row.
          const completion = project.requirementsDraft!.revision === 3 ? failure : null
          return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [{ ...structuredClone(project), requirementsCompletion: completion }] } as never
        }
        if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) {
          completionRequests += 1
          assert.equal((input as { expectedRequirementsRevision: number }).expectedRequirementsRevision, 3)
          failure = { state: 'failed', reason, failedAt: '2026-10-20T05:01:00.000Z' }
          if (reason === 'revision_conflict') otherWindowSave()
          return { status: 'failed', reason } as never
        }
        throw new Error('unexpected capability')
      }
    })
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
    const message = reason === 'runtime_execution_failed' ? /本地 Agent Runtime 执行失败/u : /需求内容或协调权限已变化/u
    try {
      await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
      await click(buttonByText(mounted.container, '需求'))
      await click(buttonByText(mounted.container, '重新补全'))
      if (reason === 'runtime_execution_failed') {
        assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', message)
        otherWindowSave()
        await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
      }
      assert.equal(completionRequests, 1)
      assert.equal(ordinarySaves, 1)
      assert.deepEqual(project.requirementsDraft!.workModules, original.workModules)
      assert.deepEqual(project.requirementsDraft!.acceptanceCriteria, original.acceptanceCriteria)
      assert.equal(project.requirementsDraft!.contentDigest, original.contentDigest)
      const alerts = [...mounted.container.querySelectorAll('[role="alert"]')].map(item => item.textContent)
      assert.match(alerts.join(' '), message, 'A failed completion must stay visible: a no-op draft save has not supplied a successful completion result')
    } finally { await mounted.unmount() }
  })
}

test('only a correlated completion receipt supersedes an old completion error', async () => {
  const source = { ...model().project!.requirementsDraft!, contentDigest: 'd'.repeat(64) }
  const result = { ...source, revision: 4, contentDigest: 'e'.repeat(64) }
  const receipt = {
    state: 'completed' as const, requirementsDocumentId: source.requirementsDocumentId,
    sourceRevision: source.revision, sourceContentDigest: source.contentDigest,
    resultRevision: result.revision, resultContentDigest: result.contentDigest
  }
  const scenarios = [
    { name: 'missing receipt', evidence: null, visible: result, clears: false },
    { name: 'different document', evidence: { ...receipt, requirementsDocumentId: 'rqd_other0000000000000001' }, visible: result, clears: false },
    { name: 'different source version', evidence: { ...receipt, sourceRevision: 2 }, visible: result, clears: false },
    { name: 'different source digest', evidence: { ...receipt, sourceContentDigest: 'f'.repeat(64) }, visible: result, clears: false },
    { name: 'later ordinary save', evidence: receipt, visible: { ...result, revision: 5 }, clears: false },
    { name: 'different visible digest', evidence: receipt, visible: { ...result, contentDigest: 'f'.repeat(64) }, clears: false },
    { name: 'correlated success', evidence: receipt, visible: result, clears: true }
  ]
  for (const scenario of scenarios) {
    let project = { ...structuredClone(model().project!), requirementsDraft: source }
    let evidence: unknown = null
    const client = createProjectCoordinatorRendererClient({
      observe: async () => { throw new Error('unused') },
      invoke: async (contract) => {
        if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [{ ...structuredClone(project), requirementsCompletion: evidence }] } as never
        if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) return { status: 'failed', reason: 'write_failed' } as never
        throw new Error('unexpected capability')
      }
    })
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
    try {
      await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
      await click(buttonByText(mounted.container, '需求'))
      await click(buttonByText(mounted.container, '重新补全'))
      assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u)
      project = { ...project, requirementsDraft: scenario.visible }
      evidence = scenario.evidence
      await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
      if (scenario.clears) assert.equal(mounted.container.querySelector('[role="alert"]'), null, scenario.name)
      else assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u, scenario.name)
    } finally { await mounted.unmount() }
  }
})

test('completion results in another project cannot clear the selected project error', async () => {
  const base = structuredClone(model().project!)
  const project = { ...base, requirementsDraft: { ...base.requirementsDraft!, contentDigest: 'd'.repeat(64) } }
  let projects = [project]
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('unused') },
    invoke: async (contract) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: structuredClone(projects) } as never
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) return { status: 'failed', reason: 'write_failed' } as never
      throw new Error('unexpected capability')
    }
  })
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '需求'))
    await click(buttonByText(mounted.container, '重新补全'))
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u)
    // Another Project completing cannot change this selection or clear its error.
    projects = [project, { ...project, project: { ...project.project, projectId: 'prj_other000001', displayName: 'Another project' }, requirementsDraft: { ...project.requirementsDraft!, projectId: 'prj_other000001', requirementsDocumentId: 'rqd_other0000000000000001', revision: 4, contentDigest: 'e'.repeat(64), goalsDeliverables: 'Other project goals' },
      requirementsCompletion: { state: 'completed', requirementsDocumentId: 'rqd_other0000000000000001',
        sourceRevision: 3, sourceContentDigest: 'd'.repeat(64), resultRevision: 4, resultContentDigest: 'e'.repeat(64) } }]
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.equal(inputByLabel(mounted.container, '目标与交付').value, project.requirementsDraft.goalsDeliverables)
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u)
    projects = [project, { ...projects[1]!, requirementsDraft: { ...projects[1]!.requirementsDraft!, revision: 5 } }]
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u)
  } finally { await mounted.unmount() }
})

for (const [reason, message] of [
  ['revision_conflict', '需求内容或协调权限已变化，或项目版本持续更新，请重新补全'],
  ['placeholder_generated_content', '生成的工作模块或验收标准含纯标点或占位内容，每项须包含文字或数字，请重新补全']
] as const) {
  test(`requirements page refreshes a failed completion reason and enables the existing retry action (${reason})`, async () => {
    const calls: Record<string, unknown>[] = []
    const pageProject = model().project!
    let reads = 0
    let failure: { state: 'failed'; reason: string; failedAt: string } | null = null
    const workspaceClient = {
      readWorkspace: async () => {
        reads += 1
        return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [{ ...pageProject, requirementsCompletion: failure }] }
      },
      completeRequirements: async (input: Record<string, unknown>) => {
        calls.push(input)
        if (calls.length === 1) {
          failure = { state: 'failed', reason, failedAt: '2026-10-19T14:18:30.000Z' }
          throw new ProjectCoordinatorRequirementsCompletionClientError(reason)
        }
        failure = null
        return pageProject.requirementsDraft
      }
    } as never
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={workspaceClient} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
    try {
      await tick(); await tick()
      await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
      await click(buttonByText(mounted.container, '需求'))
      const initialReads = reads
      await click(buttonByText(mounted.container, '重新补全'))
      assert.ok(reads > initialReads, 'failure immediately refreshes persisted attempt facts')
      assert.ok(mounted.container.textContent?.includes(`补全失败：${message}`))
      assert.doesNotMatch(mounted.container.textContent ?? '', /已补全待确认/u)
      const retry = buttonByText(mounted.container, '重新补全')
      assert.equal(retry.disabled, false)
      await click(retry)
      assert.equal(calls.length, 2)
      assert.deepEqual(calls[1], { projectId: 'prj_demo000001', expectedRequirementsRevision: 3 })
      assert.doesNotMatch(mounted.container.textContent ?? '', /补全失败：/u)
    } finally { await mounted.unmount() }
  })
}

test('saved background completion survives page reload, blocks duplicates and updates on refresh', async () => {
  let pageProject = structuredClone(model().project!)
  let running = false
  let completeCalls = 0
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('unused') },
    invoke: async (contract) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) {
        return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [{ ...pageProject, requirementsCompletion: running ? { state: 'running', startedAt: '2026-10-20T04:54:11.078Z' } : null }] } as never
      }
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave) {
        running = true
        return pageProject.requirementsDraft as never
      }
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) completeCalls += 1
      throw new Error('unexpected capability')
    }
  })
  const element = <CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />
  let mounted = await mount(element)
  const open = async () => {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '需求'))
  }
  try {
    await open()
    await click(buttonByText(mounted.container, '保存需求'))
    assert.match(mounted.container.textContent ?? '', /Coordinator 正在补全工作模块和验收标准/u)
    assert.equal(buttonByText(mounted.container, '正在补全…').disabled, true)
    assert.equal(buttonByText(mounted.container, '确认需求').disabled, true)
    await click(buttonByText(mounted.container, '正在补全…'))
    assert.equal(completeCalls, 0)
    await mounted.unmount()
    mounted = await mount(element)
    await open()
    assert.equal(buttonByText(mounted.container, '正在补全…').disabled, true, 'progress comes from the workspace after remount')
    running = false
    pageProject = { ...pageProject, requirementsDraft: { ...pageProject.requirementsDraft!, revision: 4 } }
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.equal(buttonByText(mounted.container, '重新补全').disabled, false)
    assert.equal(buttonByText(mounted.container, '确认需求').disabled, false)
    assert.doesNotMatch(mounted.container.textContent ?? '', /正在补全|补全失败/u)
  } finally { await mounted.unmount() }
})

test('concurrent completion response is progress and a correlated receipt clears the old failure', async () => {
  let pageProject = structuredClone(model().project!)
  pageProject = { ...pageProject, requirementsDraft: { ...pageProject.requirementsDraft!, contentDigest: 'd'.repeat(64) } }
  let receipt: unknown = null
  let running = false
  let calls = 0
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('unused') },
    invoke: async (contract) => {
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead) {
        return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [{ ...pageProject, requirementsCompletion: running ? { state: 'running', startedAt: '2026-10-20T04:54:11.078Z' } : receipt }] } as never
      }
      if (contract.actionId === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete) {
        calls += 1
        if (calls === 1) {
          running = true
          return { status: 'failed', reason: 'completion_in_progress' } as never
        }
        return { status: 'failed', reason: 'write_failed' } as never
      }
      throw new Error('unexpected capability')
    }
  })
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '需求'))
    await click(buttonByText(mounted.container, '重新补全'))
    assert.equal(calls, 1)
    assert.equal(buttonByText(mounted.container, '正在补全…').disabled, true)
    assert.equal(mounted.container.querySelector('[role="alert"]'), null)
    running = false
    pageProject = { ...pageProject, requirementsDraft: { ...pageProject.requirementsDraft!, revision: 4 } }
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    await click(buttonByText(mounted.container, '重新补全'))
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u)
    // A completed background/other-device write supersedes this failed revision.
    pageProject = { ...pageProject, requirementsDraft: { ...pageProject.requirementsDraft!, revision: 5, contentDigest: 'e'.repeat(64) } }
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /补全结果写入云端失败/u)
    receipt = { state: 'completed', requirementsDocumentId: pageProject.requirementsDraft!.requirementsDocumentId,
      sourceRevision: 4, sourceContentDigest: 'd'.repeat(64), resultRevision: 5, resultContentDigest: 'e'.repeat(64) }
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.equal(mounted.container.querySelector('[role="alert"]'), null)
    assert.equal(buttonByText(mounted.container, '重新补全').disabled, false)
  } finally { await mounted.unmount() }
})

test('workspace page adopts a sealed delivery without requiring a pre-existing receipt', async () => {
  const calls: Call[] = []
  const pageProject = model().project as any
  const adoptedTask = { projectId: 'prj_demo000001', taskId: 'tsk_adopt_page', schemaVersion: 1, type: 'dashboard_task_card', taskKind: 'task', lineage: { projectId: 'prj_demo000001', requirementsBaselineId: 'rqb_demo000001', workItemId: 'item_demo_01' }, title: 'Adoptable task', workflowColumn: 'waiting_result_confirm', contractExecution: 'completed', delivery: 'sealed', adoption: 'pending', contract: { projectId: 'prj_demo000001', taskId: 'tsk_adopt_page', contractRevision: 1, contractDigest: 'a'.repeat(64), executionId: 'exe_demo000001' }, assigneeUserId: 'usr_worker000001', assigneeDisplayName: 'Worker', executionId: 'exe_demo000001', unread: false, blocker: null, nextAction: null, plannedStartAt: null, plannedDueAt: '2026-10-18T00:00:00.000Z', observedAt: '2026-10-18T00:00:00.000Z', privateSessionAvailable: false, primaryAction: 'adopt_delivery' } as any
  pageProject.tasks = [{ task: { taskId: adoptedTask.taskId, projectId: pageProject.project.projectId, currentExecutionId: null }, delivery: { taskId: adoptedTask.taskId, candidate: null, manifest: { deliveryManifestId: 'dm_page000001', objects: [], sealedAt: '2026-10-18T00:00:00.000Z' }, receipt: null, result: null, revisionRequest: null }, executions: [] }]
  const pageWorkspace = { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [pageProject] } as any
  const workspaceClient = {
    readWorkspace: async () => pageWorkspace,
    decideAdoption: async (input: Record<string, unknown>) => { calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide, input }); return {} }
  } as never
  const collaborationClient = { readStatus: async () => snapshot([adoptedTask]), readWorkerDelivery: async () => ({ delivery: null }) } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={workspaceClient} collaborationClient={collaborationClient} />)
  try {
    await tick(); await tick()
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(mounted.container.querySelector('.collaboration-workspace-task-card-button') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '采纳交付'))
    assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide)
    const adoptionInput = calls.at(-1)?.input as { projectId: string; taskId: string; deliveryManifestId: string; integrationRevision: number; validationEvidence: string[]; disposition: string; operationId: string }
    assert.deepEqual({ ...adoptionInput, operationId: undefined }, { projectId: 'prj_demo000001', taskId: 'tsk_adopt_page', deliveryManifestId: 'dm_page000001', integrationRevision: 1, validationEvidence: ['Owner reviewed the submitted delivery in the task drawer.'], disposition: 'adopted', operationId: undefined })
    assert.match(adoptionInput.operationId, /^adoption_/u)
  } finally { await mounted.unmount() }
})

test('member invite validates usr_ input and invitation acceptance sends exact revisions', async () => {
  const { calls, coordinator } = clients()
  const fixture = model()
  const mounted = await mount(<SettingsView model={fixture} busy={false} initialSection="members" onAddMember={(userId) => { void coordinator.addMember({ projectId: fixture.projectId!, expectedProjectRevision: fixture.project!.project.revision, userId }) }} />)
  try {
    await click(buttonByText(mounted.container, '添加成员'))
    const userInput = mounted.container.querySelector('input[placeholder="粘贴对方的用户 ID"]') as HTMLInputElement
    await setValue(userInput, 'not-a-user-id')
    await click(buttonByText(mounted.container, '发送邀请'))
    assert.match(mounted.container.textContent ?? '', /用户 ID 应为 usr_ 格式/u)
    assert.equal(calls.some((call) => call.id === PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd), false)
    await setValue(userInput, 'usr_newmember000001')
    await click(buttonByText(mounted.container, '发送邀请'))
    assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd)
    assert.deepEqual(calls.at(-1)?.input, { projectId: 'prj_demo000001', expectedProjectRevision: 7, userId: 'usr_newmember000001' })
  } finally { await mounted.unmount() }

  const invitation = { id: 'notification_invite', title: '加入 Demo project', projectId: 'prj_demo000001', projectName: 'Demo project', state: '邀请', time: '10-18', action: '查看需求并接受', membershipId: 'pm_invited000001', kind: 'membership' } as never
  const inviteMounted = await mount(<RequirementsView model={fixture} busy={false} invitation={invitation} onAcceptInvitation={() => { void coordinator.acceptInvitation({ projectId: 'prj_demo000001', projectMembershipId: 'pm_invited000001', expectedProjectRevision: 7, expectedMembershipRevision: 5 }) }} onSave={() => undefined} onComplete={() => undefined} onConfirm={() => undefined} />)
  try {
    assert.match(inviteMounted.container.textContent ?? '', /Owner 邀请你加入此项目/u)
    await click(buttonByText(inviteMounted.container, '接受邀请'))
    assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept)
    assert.deepEqual(calls.at(-1)?.input, { projectId: 'prj_demo000001', projectMembershipId: 'pm_invited000001', expectedProjectRevision: 7, expectedMembershipRevision: 5 })
  } finally { await inviteMounted.unmount() }
})

test('drawer actions render real controls and route offer, answer, delivery, adoption, reassignment, and comments', async () => {
  const { calls, coordinator, collaboration, deliveryTarget } = clients()
  const members = [{ userId: 'usr_owner000001', name: 'Owner', role: '所有者' }, { userId: 'usr_worker000001', name: 'Worker', role: '成员' }]
  const common = { projectName: 'Demo project', currentUserId: 'usr_worker000001', members, activity: [] }
  let mounted = await mount(<TaskDrawer {...common} card={card({ stateLabel: '待你接受', offerId: 'offer_demo000001', offerAvailability: availableOffer })} onOfferDecision={(decision) => { void collaboration.decideTaskOffer({ taskOfferId: 'offer_demo000001', decision }) }} />)
  await click(buttonByText(mounted.container, '接受任务'))
  await click(buttonByText(mounted.container, '拒绝'))
  assert.deepEqual(calls.slice(-2).map((call) => call.input), [{ taskOfferId: 'offer_demo000001', decision: 'accept' }, { taskOfferId: 'offer_demo000001', decision: 'reject' }])
  await mounted.unmount()

  mounted = await mount(<TaskDrawer {...common} card={card({ stateLabel: '等待回答', humanRequestId: 'human_demo000001' })} onHumanAnswer={(answer) => { void coordinator.answerHumanNeeded({ projectId: 'prj_demo000001', humanRequestId: 'human_demo000001', requestRevision: 2, answer }) }} />)
  await setValue(mounted.container.querySelector('input[placeholder="输入回答"]') as HTMLInputElement, 'Use the bounded dataset')
  await click(buttonByText(mounted.container, '发送'))
  assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer)
  assert.deepEqual(calls.at(-1)?.input, { projectId: 'prj_demo000001', humanRequestId: 'human_demo000001', requestRevision: 2, answer: 'Use the bounded dataset' })
  await mounted.unmount()

  mounted = await mount(<TaskDrawer {...common} card={card({ stateLabel: '待提交交付', executionId: 'exe_demo000001' })} deliveryDetail={{ state: 'ready', revision: 2, summary: 'candidate', declaredFiles: [] }} onSubmitDelivery={() => { void (async () => { const result = await collaboration.readWorkerDelivery({ projectId: 'prj_demo000001', taskId: 'tsk_demo000001', executionId: 'exe_demo000001' }); await collaboration.submitWorkerDelivery({ target: result.delivery.candidate!.target }) })() }} />)
  await confirmDelivery(mounted.container)
  assert.equal(calls.at(-2)?.id, COLLABORATION_CAPABILITY_IDS.workerDeliveryRead)
  assert.equal(calls.at(-1)?.id, COLLABORATION_CAPABILITY_IDS.deliverySubmit)
  assert.deepEqual(calls.at(-1)?.input, { target: deliveryTarget })
  await mounted.unmount()

  mounted = await mount(<TaskDrawer {...common} currentUserId="usr_owner000001" card={card({ stateLabel: '待你采纳', assigneeUserId: 'usr_worker000001' })} onAdopt={() => { void coordinator.decideAdoption({ projectId: 'prj_demo000001', taskId: 'tsk_demo000001', deliveryManifestId: 'dm_demo000001', integrationRevision: 1, validationEvidence: ['reviewed'], operationId: 'adopt_demo000001', disposition: 'adopted' }) }} onRequestRevision={() => { void coordinator.requestRevision({ projectId: 'prj_demo000001', taskId: 'tsk_demo000001', deliveryManifestId: 'dm_demo000001', instruction: 'Please add evidence.' }) }} />)
  await click(buttonByText(mounted.container, '采纳交付'))
  await click(buttonByText(mounted.container, '要求返修'))
  await setValue(mounted.container.querySelector('textarea[aria-label="返修意见"]') as HTMLTextAreaElement, 'Please add evidence.')
  await click(buttonByText(mounted.container, '发送返修要求'))
  assert.deepEqual(calls.slice(-2).map((call) => call.id), [PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide, PROJECT_COORDINATOR_CAPABILITY_IDS.revisionRequest])
  assert.equal((calls.at(-2)?.input as { disposition: string }).disposition, 'adopted')
  await mounted.unmount()

  mounted = await mount(<TaskDrawer {...common} currentUserId="usr_owner000001" card={card({ assigneeUserId: 'usr_worker000001', assignment: { kind: 'reassign', previousTaskOfferId: 'offer_demo000002', reason: '原派单已被拒绝' } })} onAssign={(workerUserId) => { void coordinator.reassignTaskOffer({ projectId: 'prj_demo000001', taskId: 'tsk_demo000001', previousTaskOfferId: 'offer_demo000002', workerUserId, offerExpiresAt: '2026-10-19T00:00:00.000Z', nextOutputFileName: null }) }} mentionableUsers={[{ userId: 'usr_alice000001', displayName: 'Alice' }]} onComment={(text, mentionedUserIds) => { void collaboration.publishComment({ commentId: 'cmt_demo000001', projectId: 'prj_demo000001', taskId: 'tsk_demo000001', text, mentionedUserIds: [...mentionedUserIds] }) }} />)
  const callsBeforeSelect = calls.length
  const reassignButton = buttonByText(mounted.container, '重新派发')
  assert.equal(reassignButton.disabled, true)
  await setSelectValue(mounted.container.querySelector('select') as HTMLSelectElement, 'usr_worker000001')
  assert.equal(calls.length, callsBeforeSelect, 'choosing a member alone must not dispatch')
  await click(reassignButton)
  assert.equal(calls.at(-1)?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign)
  assert.deepEqual(calls.at(-1)?.input, { projectId: 'prj_demo000001', taskId: 'tsk_demo000001', previousTaskOfferId: 'offer_demo000002', workerUserId: 'usr_worker000001', offerExpiresAt: '2026-10-19T00:00:00.000Z', nextOutputFileName: null })
  await setValue(mounted.container.querySelector('input[placeholder="发起新讨论… @成员"]') as HTMLInputElement, '@Alice please review')
  await click(mounted.container.querySelector('button[aria-label="发送"]') as HTMLButtonElement)
  assert.equal(calls.at(-1)?.id, COLLABORATION_CAPABILITY_IDS.activityComment)
  assert.deepEqual(calls.at(-1)?.input, { commentId: 'cmt_demo000001', projectId: 'prj_demo000001', taskId: 'tsk_demo000001', text: '@Alice please review', mentionedUserIds: ['usr_alice000001'] })
  await mounted.unmount()
})

test('drawer role gates keep owner actions away from Workers and offer actions away from non-assignees', async () => {
  const members = [{ userId: 'usr_owner000001', name: 'Owner', role: '所有者' }, { userId: 'usr_worker000001', name: 'Worker', role: '成员' }]
  const worker = await mount(<TaskDrawer projectName="Demo project" currentUserId="usr_worker000001" members={members} card={card({ stateLabel: '待你采纳' })} />)
  try {
    assert.equal(worker.container.textContent?.includes('采纳交付'), false)
    assert.equal(worker.container.textContent?.includes('要求返修'), false)
    await worker.unmount()
  } finally { /* unmount is idempotent for the assertion path */ }
  const notAssignee = await mount(<TaskDrawer projectName="Demo project" currentUserId="usr_alice000001" members={members} card={card({ stateLabel: '待你接受', assigneeUserId: 'usr_worker000001' })} />)
  try {
    assert.equal(notAssignee.container.textContent?.includes('接受任务'), false)
    assert.equal(notAssignee.container.textContent?.includes('拒绝'), false)
  } finally { await notAssignee.unmount() }
})

test('board filters narrow cards by status, assignee and search, and can be cleared', async () => {
  const cards = [card({ id: 'tsk_a', reference: '#1', title: 'Align samples', status: 'in-progress', assignee: 'Worker' }), card({ id: 'tsk_b', reference: '#2', title: 'Report', status: 'review', assignee: 'Alice' }), card({ id: 'tsk_c', reference: '#3', title: 'Collect inputs', status: 'intake', assignee: null })]
  const mounted = await mount(<ProjectBoard cards={cards} selectedCardId={null} />)
  try {
    const visibleTitles = () => [...mounted.container.querySelectorAll('.collaboration-workspace-task-card h3')].map((node) => node.textContent)
    const [statusSelect, assigneeSelect] = [...mounted.container.querySelectorAll('select')] as HTMLSelectElement[]
    await setSelectValue(statusSelect!, 'review')
    assert.deepEqual(visibleTitles(), ['Report'])
    await setSelectValue(statusSelect!, '')
    await setSelectValue(assigneeSelect!, '__unassigned__')
    assert.deepEqual(visibleTitles(), ['Collect inputs'])
    await setSelectValue(assigneeSelect!, '')
    await setValue(mounted.container.querySelector('input[placeholder="搜索任务"]') as HTMLInputElement, 'align')
    assert.deepEqual(visibleTitles(), ['Align samples'])
    assert.match(mounted.container.textContent ?? '', /1 \/ 3 个任务/u)
    await click(buttonByText(mounted.container, '清除筛选'))
    assert.equal(visibleTitles().length, 3)
  } finally { await mounted.unmount() }
})

test('drawer closes on Escape and project tabs move with arrow keys', async () => {
  let closed = 0
  const drawer = await mount(<TaskDrawer projectName="Demo project" card={card()} onClose={() => { closed += 1 }} />)
  try {
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })) })
    assert.equal(closed, 1)
  } finally { await drawer.unmount() }
  const tabs: string[] = []
  const header = await mount(<ProjectHeader initials="D" name="Demo project" memberCount={2} status="active" activeTab="board" onTabChange={(tab) => tabs.push(tab)} />)
  try {
    const list = header.container.querySelector('[role="tablist"]') as HTMLElement
    await act(async () => { list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    await act(async () => { list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    assert.deepEqual(tabs, ['requirements', 'settings'])
  } finally { await header.unmount() }
})

test('the header confirm action opens the requirements confirmation dialog instead of confirming directly', async () => {
  const fixture = model()
  let confirmed = 0
  const mounted = await mount(<RequirementsView model={fixture} busy={false} confirmOnOpen onSave={() => undefined} onComplete={() => undefined} onConfirm={() => { confirmed += 1 }} />)
  try {
    const dialog = mounted.container.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.equal(confirmed, 0)
    await click([...dialog.querySelectorAll('button')].find((button) => button.textContent?.trim() === '确认需求') as HTMLButtonElement)
    assert.equal(confirmed, 1)
  } finally { await mounted.unmount() }
})

function confirmedPageWorkspace(tasks: readonly unknown[] = [], offers: readonly unknown[] = []) {
  const project = JSON.parse(JSON.stringify(model().project)) as any
  project.project = { ...project.project, coordinatorAuthorityEpoch: 2, executionAuthorityEpoch: 5 }
  project.confirmedRequirements = { ...project.requirementsDraft, requirementsDocumentId: 'rqd_TestRequirements0001', documentRevision: 4, revision: 9, state: 'confirmed', workModules: [{ planItemId: 'item_Test0001', title: 'Module one', objective: 'Objective one', dependencyPlanItemIds: [] }, { planItemId: 'item_Test0002', title: 'Module two', objective: 'Objective two', dependencyPlanItemIds: [] }] }
  project.requirementsDraft = null
  project.tasks = tasks
  project.offers = offers
  return { connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' }, projects: [project] } as any
}

const moduleOneTaskId = canonicalTaskIdForRequirementsModule('rqd_TestRequirements0001', 'item_Test0001')
const moduleTwoTaskId = canonicalTaskIdForRequirementsModule('rqd_TestRequirements0001', 'item_Test0002')

function adoptedTask(taskId: string, disposition = 'adopted') {
  return { task: { taskId, projectId: 'prj_demo000001', status: 'completed', currentExecutionId: null }, delivery: { taskId, candidate: null, manifest: { deliveryManifestId: 'dm_page000001', objects: [], sealedAt: '2026-10-18T00:00:00.000Z' }, receipt: { disposition }, result: null, revisionRequest: null }, executions: [] }
}

test('the header offers 结项 only when every confirmed module is completed and adopted, and sends the exact requirements target', async () => {
  const calls: Call[] = []
  const pending = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => confirmedPageWorkspace([adoptedTask(moduleOneTaskId), adoptedTask(moduleTwoTaskId, 'pending')]) } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await tick(); await tick()
    await click(pending.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    assert.equal([...pending.container.querySelectorAll('button')].some((button) => button.textContent?.trim() === '结项'), false)
    assert.match(pending.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /已采纳 1\/2/u)
  } finally { await pending.unmount() }

  const workspace = confirmedPageWorkspace([adoptedTask(moduleOneTaskId), adoptedTask(moduleTwoTaskId)])
  const coordinatorClient = { readWorkspace: async () => workspace, completeProject: async (input: Record<string, unknown>) => { calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete, input }); return workspace } } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await tick(); await tick()
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '结项'))
    const dialog = mounted.container.querySelector('[role="dialog"]') as HTMLElement
    assert.ok(dialog)
    assert.match(dialog.textContent ?? '', /需求 v4/u)
    const confirm = buttonByText(dialog, '确认结项')
    assert.equal(confirm.disabled, true)
    await setValue(inputByLabel(dialog, '结项总结') as HTMLTextAreaElement, '  All modules adopted  ')
    await click(confirm)
    assert.deepEqual(calls, [{ id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete, input: { target: { baselineKind: 'requirements', projectId: 'prj_demo000001', expectedProjectRevision: 7, expectedCoordinatorAuthorityEpoch: 2, expectedExecutionAuthorityEpoch: 5, requirementsDocumentId: 'rqd_TestRequirements0001', confirmedRequirementsRevision: 4, adoptedTaskIds: [moduleOneTaskId, moduleTwoTaskId], summary: 'All modules adopted' } } }])
  } finally { await mounted.unmount() }
})

function dashboardTask(taskId: string, planItemId: string, title: string, workflowColumn: string) {
  return { projectId: 'prj_demo000001', taskId, schemaVersion: 1, type: 'dashboard_task_card', taskKind: 'task', lineage: { projectId: 'prj_demo000001', requirementsBaselineId: 'rqd_TestRequirements0001', workItemId: planItemId }, title, workflowColumn, contractExecution: 'unassigned', delivery: 'not_submitted', adoption: 'pending', contract: null, assigneeUserId: 'usr_worker000001', assigneeDisplayName: 'Worker', executionId: null, unread: false, blocker: null, nextAction: null, plannedStartAt: null, plannedDueAt: null, observedAt: '2026-10-18T00:00:00.000Z', privateSessionAvailable: false, primaryAction: 'view' }
}

function cloudTask(taskId: string, revision: number) {
  return { task: { taskId, projectId: 'prj_demo000001', status: 'open', revision, currentExecutionId: null, currentExecutionState: null }, delivery: null, executions: [] }
}

test('a completion conflict stays in the dialog with the summary kept', async () => {
  const workspace = confirmedPageWorkspace([adoptedTask(moduleOneTaskId), adoptedTask(moduleTwoTaskId)])
  const coordinatorClient = { readWorkspace: async () => workspace, completeProject: async () => { throw new Error('Owner approval no longer matches the exact Project completion baseline.') } } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await tick(); await tick()
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /已采纳 2\/2/u)
    await click(buttonByText(mounted.container, '结项'))
    const summary = inputByLabel(mounted.container.querySelector('[role="dialog"]') as HTMLElement, '结项总结') as HTMLTextAreaElement
    await setValue(summary, 'Done')
    await click(buttonByText(mounted.container.querySelector('[role="dialog"]') as HTMLElement, '确认结项'))
    await tick()
    const dialog = mounted.container.querySelector('[role="dialog"]') as HTMLElement
    assert.ok(dialog, 'dialog stays open')
    assert.equal(dialog.querySelector('[role="alert"]')?.textContent, '项目已在其他设备更新，请关闭后重新检查再结项。')
    assert.equal((dialog.querySelector('textarea') as HTMLTextAreaElement).value, 'Done')
    assert.equal(mounted.container.querySelector('.collaboration-workspace-page-error'), null)
  } finally { await mounted.unmount() }
})

test('the page refreshes itself on window focus, and a failed background refresh shows no error', async () => {
  let reads = 0
  let fail = false
  const workspace = confirmedPageWorkspace()
  const coordinatorClient = { readWorkspace: async () => { reads += 1; if (fail) throw new Error('network down'); return workspace } } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await tick(); await tick()
    const before = reads
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.equal(reads, before + 1)
    fail = true
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.equal(reads, before + 2)
    assert.equal(mounted.container.querySelector('.collaboration-workspace-page-error'), null)
  } finally { await mounted.unmount() }
})

test('repeated focus refreshes join the slow read and allow its current result to render', async () => {
  const workspace = confirmedPageWorkspace()
  let slow = false
  let reads = 0
  let concurrent = 0
  let maximum = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const coordinatorClient = {
    readWorkspace: async () => {
      reads += 1
      concurrent += 1
      maximum = Math.max(maximum, concurrent)
      try { if (slow) await gate; return workspace }
      finally { concurrent -= 1 }
    }
  } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    const before = reads
    slow = true
    await act(async () => {
      window.dispatchEvent(new window.Event('focus'))
      await tick()
      window.dispatchEvent(new window.Event('focus'))
      window.dispatchEvent(new window.Event('focus'))
      await tick()
    })
    assert.equal(reads, before + 1, 'poll/focus must not start overlapping Cloud reads')
    release()
    await act(async () => { await tick(); await tick(); await tick() })
    assert.equal(maximum, 1)
    assert.ok(mounted.container.querySelector('.collaboration-workspace-project-row'))
  } finally { release(); await mounted.unmount() }
})

test('a timed-out page read is cancelled and its late data cannot replace the next refresh', async () => {
  const oldWorkspace = confirmedPageWorkspace()
  const newWorkspace = structuredClone(oldWorkspace)
  newWorkspace.projects[0].project.displayName = '超时后的当前项目'
  let stalled = false
  let recovered = false
  let release!: (value: unknown) => void
  let signal: AbortSignal | undefined
  const gate = new Promise((resolve) => { release = resolve })
  const deadlines = new Map<number, () => void>()
  let timerId = 1_000_000
  const originalSetTimeout = browserWindow.setTimeout
  const originalClearTimeout = browserWindow.clearTimeout
  Object.defineProperty(browserWindow, 'setTimeout', { configurable: true, value: (callback: () => void, delay: number) => {
    if (delay !== 30_000) return originalSetTimeout.call(browserWindow, callback, delay)
    deadlines.set(++timerId, callback)
    return timerId
  } })
  Object.defineProperty(browserWindow, 'clearTimeout', { configurable: true, value: (id: number | ReturnType<typeof originalSetTimeout>) => {
    if (typeof id === 'number') deadlines.delete(id)
    else originalClearTimeout.call(browserWindow, id)
  } })
  const coordinatorClient = {
    readWorkspace: async (_input: unknown, options?: { signal?: AbortSignal }) => {
      if (stalled) { signal = options?.signal; return gate }
      return recovered ? newWorkspace : oldWorkspace
    }
  } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    stalled = true
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick() })
    assert.equal(deadlines.size, 1)
    await act(async () => { [...deadlines.values()][0]!(); await tick(); await tick() })
    assert.equal(signal?.aborted, true)
    stalled = false; recovered = true
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.textContent ?? '', /超时后的当前项目/u)
    await act(async () => { release(oldWorkspace); await tick(); await tick() })
    assert.match(mounted.container.textContent ?? '', /超时后的当前项目/u)
  } finally {
    release(oldWorkspace)
    await mounted.unmount()
    Object.defineProperty(browserWindow, 'setTimeout', { configurable: true, writable: true, value: originalSetTimeout })
    Object.defineProperty(browserWindow, 'clearTimeout', { configurable: true, writable: true, value: originalClearTimeout })
  }
})

test('foreground auto-refresh asks for the Cloud Dashboard refresh and background does not', async () => {
  const statusInputs: unknown[] = []
  const workspace = confirmedPageWorkspace()
  const coordinatorClient = { readWorkspace: async () => workspace } as never
  const collaborationClient = {
    readStatus: async (input?: unknown) => {
      statusInputs.push(input)
      return snapshot([])
    }
  } as never
  const intervals = new Map<number, () => void>()
  let nextTimer = 0
  const originalSetInterval = browserWindow.setInterval
  const originalClearInterval = browserWindow.clearInterval
  Object.defineProperty(browserWindow, 'setInterval', {
    configurable: true,
    writable: true,
    value: (callback: () => void) => {
      nextTimer += 1
      intervals.set(nextTimer, callback)
      return nextTimer
    }
  })
  Object.defineProperty(browserWindow, 'clearInterval', {
    configurable: true,
    writable: true,
    value: (handle: number) => { intervals.delete(handle) }
  })
  try {
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={collaborationClient} />)
    try {
      await tick(); await tick(); await tick()
      assert.ok(statusInputs.length > 0)
      assert.ok(statusInputs.every((input) => (
        (input as { refreshDashboards?: boolean }).refreshDashboards === true
      )), 'every foreground status read asks the main process for the Dashboard refresh')
      assert.equal(intervals.size, 1, 'the foreground page installs exactly one live refresh timer')

      const beforeTimer = statusInputs.length
      await act(async () => {
        [...intervals.values()][0]!()
        await tick(); await tick()
      })
      assert.equal(statusInputs.length, beforeTimer + 1)
      assert.deepEqual(statusInputs.at(-1), { refreshDashboards: true })

      await mounted.rerender(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={collaborationClient} active={false} />)
      assert.equal(intervals.size, 0, 'the background page clears its live refresh timer')
      const backgroundReads = statusInputs.length
      await act(async () => {
        window.dispatchEvent(new window.Event('focus'))
        await tick(); await tick()
      })
      assert.equal(statusInputs.length, backgroundReads, 'the background page does not refresh or touch Dashboards')
    } finally {
      await mounted.unmount()
    }
  } finally {
    Object.defineProperty(browserWindow, 'setInterval', {
      configurable: true, writable: true, value: originalSetInterval
    })
    Object.defineProperty(browserWindow, 'clearInterval', {
      configurable: true, writable: true, value: originalClearInterval
    })
  }
})

function switchingProject(projectId: string, displayName: string, memberIds: readonly string[]) {
  const workspace = confirmedPageWorkspace() as any
  const project = workspace.projects[0]
  project.project = { ...project.project, projectId, displayName, revision: 7 }
  project.confirmedRequirements = {
    ...project.confirmedRequirements,
    projectId,
    requirementsDocumentId: `rqd_TestRequirements${projectId.endsWith('0002') ? 'B002' : 'B001'}`
  }
  project.memberships = memberIds.map((userId, index) => ({
    projectMembershipId: `pm_${projectId}_${index}`, userId, state: 'active', revision: index + 1
  }))
  project.memberUsers = memberIds.map((userId) => ({
    userId, displayName: userId === 'usr_owner000001' ? 'Owner' : 'Worker'
  }))
  project.tasks = []
  return project
}

test('switching Projects reads the new selection and shows a loading state that a stale refresh cannot undo', async () => {
  const oldProject = switchingProject('prj_oldProject0002', '旧项目', ['usr_owner000001', 'usr_worker000001'])
  const newProject = switchingProject('prj_newProject0002', '新项目', ['usr_owner000001', 'usr_worker000001', 'usr_alice000001'])
  const reads: Array<{ projectId?: string; resolve(workspace: unknown): void }> = []
  const coordinatorClient = {
    readWorkspace: (input: { projectId?: string } = {}) => new Promise((resolve) => {
      reads.push({ projectId: input.projectId, resolve })
    })
  } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([], []) } as never} />)
  const resolveRead = async (index: number) => {
    const read = reads[index]
    assert.ok(read, `missing read ${index}`)
    await act(async () => {
      read.resolve({
        connection: { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' },
        observedAt: '2026-10-18T00:00:00.000Z',
        ...(read.projectId ? { focusedProjectId: read.projectId } : {}),
        availableWorkerUsers: [],
        projects: [oldProject, newProject]
      })
      await tick(); await tick(); await tick()
    })
  }
  const row = (name: string) => [...mounted.container.querySelectorAll('.collaboration-workspace-project-row')]
    .find((candidate) => candidate.textContent?.includes(name)) as HTMLButtonElement
  try {
    await resolveRead(0)
    await resolveRead(1)
    assert.equal(reads[1]?.projectId, oldProject.project.projectId, 'the first selection is read in full')
    await click(row('旧项目'))
    await resolveRead(2)
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /旧项目/u)

    // A background refresh starts for the old selection and stays in flight.
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.equal(reads[3]?.projectId, oldProject.project.projectId)
    await click(row('新项目'))

    assert.match(mounted.container.querySelector('.collaboration-workspace-main-body')?.textContent ?? '', /正在读取项目…/u)
    assert.equal(mounted.container.querySelector('.collaboration-workspace-project-header'), null)
    assert.doesNotMatch(mounted.container.textContent ?? '', /0 位成员/u)
    assert.equal(reads[4]?.projectId, newProject.project.projectId, 'the switch reads the newly selected Project')

    // The older response lands late; it must neither replace the data nor move the selection back.
    await resolveRead(3)
    assert.match(mounted.container.querySelector('.collaboration-workspace-main-body')?.textContent ?? '', /正在读取项目…/u)
    assert.equal(row('新项目').getAttribute('aria-current'), 'page')
    assert.equal(mounted.container.querySelector('.collaboration-workspace-project-header'), null)

    await resolveRead(4)
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /新项目/u)
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /3 位成员/u)
    assert.doesNotMatch(mounted.container.querySelector('.collaboration-workspace-main-body')?.textContent ?? '', /正在读取项目…/u)

    // Later refreshes must read the latest selection, not the one from the old closure.
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.equal(reads[5]?.projectId, newProject.project.projectId)
    await resolveRead(5)
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /新项目/u)
    assert.equal(row('新项目').getAttribute('aria-current'), 'page')
  } finally { await mounted.unmount() }
})

test('an unconfigured Desktop joins automatically, and the sidebar retries or recovers through the existing capabilities', async () => {
  const calls: Call[] = []
  let state = 'unconfigured'
  const workspace = confirmedPageWorkspace()
  const collaborationClient = {
    readStatus: async () => { const base = snapshot([]) as any; return { ...base, connection: { configured: state !== 'unconfigured', state, lastInboxSequence: 0, pendingOutboxCount: 0, ...(state === 'error' ? { lastError: 'Inbox owner unavailable' } : {}) } } },
    configureConnection: async (input: Record<string, unknown>) => { calls.push({ id: COLLABORATION_CAPABILITY_IDS.connectionConfigure, input }); return {} },
    changeConnection: async (input: Record<string, unknown>) => { calls.push({ id: COLLABORATION_CAPABILITY_IDS.connectionConnect, input }); return {} }
  } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={collaborationClient} />)
  try {
    await tick(); await tick()
    // Signed in but never configured: the page joins the identity's Cloud once by itself.
    assert.deepEqual(calls, [{ id: COLLABORATION_CAPABILITY_IDS.connectionConfigure, input: {} }])
    assert.match(mounted.container.querySelector('.collaboration-workspace-sidebar-footer')?.textContent ?? '', /协作未连接/u)
    await click(buttonByText(mounted.container, '连接协作'))
    assert.deepEqual(calls.at(-1), { id: COLLABORATION_CAPABILITY_IDS.connectionConfigure, input: {} })
    assert.equal(calls.length, 2)
    state = 'error'
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.querySelector('.collaboration-workspace-sidebar-footer')?.textContent ?? '', /Inbox owner unavailable/u)
    await click(buttonByText(mounted.container, '重新连接'))
    assert.deepEqual(calls.at(-1), { id: COLLABORATION_CAPABILITY_IDS.connectionConnect, input: { action: 'recover' } })
  } finally { await mounted.unmount() }
})

test('a failed sidebar connect action surfaces the failure reason', async () => {
  const workspace = confirmedPageWorkspace()
  const collaborationClient = {
    readStatus: async () => ({
      ...(snapshot([]) as object),
      connection: { configured: true, state: 'disconnected', lastInboxSequence: 0, pendingOutboxCount: 0 }
    }),
    changeConnection: async () => {
      throw new Error('This Desktop Device has been revoked.')
    }
  } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={collaborationClient} />)
  try {
    await tick(); await tick()
    assert.match(mounted.container.querySelector('.collaboration-workspace-sidebar-footer')?.textContent ?? '', /协作未连接/u)
    await click(buttonByText(mounted.container, '连接协作'))
    await tick(); await tick()
    assert.match(
      mounted.container.querySelector('.collaboration-workspace-page-error')?.textContent ?? '',
      /This Desktop Device has been revoked\./u
    )
  } finally {
    await mounted.unmount()
  }
})

test('a member without any project can find and copy their own user ID from the sidebar', async () => {
  const writes = stubClipboard()
  const workspace = { connection: { state: 'ready', userId: 'usr_a30c0000000000003564', deviceId: 'dev_demo000001' }, projects: [] } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await tick(); await tick()
    const entry = mounted.container.querySelector('.collaboration-workspace-user-id-status') as HTMLElement
    assert.ok(entry, mounted.container.innerHTML)
    assert.match(entry.textContent ?? '', /我的用户 ID/u)
    assert.match(entry.textContent ?? '', /usr_a30c…3564/u)
    assert.equal(entry.getAttribute('title'), '我的用户 ID：usr_a30c0000000000003564')
    assert.equal(entry.querySelector('.collaboration-workspace-visually-hidden')?.textContent, '完整用户 ID：usr_a30c0000000000003564')
    const copy = entry.querySelector('button') as HTMLButtonElement
    assert.equal(copy.disabled, false)
    assert.equal(copy.textContent?.trim(), '复制')
    await click(copy)
    assert.deepEqual(writes, ['usr_a30c0000000000003564'])
    assert.equal(copy.textContent?.trim(), '已复制')
  } finally {
    await mounted.unmount()
    restoreClipboard()
  }
})

test('the sidebar user ID row shows 未连接 and disables copying without a connection', async () => {
  const writes = stubClipboard()
  const workspace = { connection: { state: 'identity_required', reason: '请先登录协作账户。' }, projects: [] } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await tick(); await tick()
    const entry = mounted.container.querySelector('.collaboration-workspace-user-id-status') as HTMLElement
    assert.ok(entry, mounted.container.innerHTML)
    assert.match(entry.textContent ?? '', /未连接/u)
    const copy = entry.querySelector('button') as HTMLButtonElement
    assert.equal(copy.disabled, true)
    await click(copy)
    assert.deepEqual(writes, [])
  } finally {
    await mounted.unmount()
    restoreClipboard()
  }
})

test('a member who is not the owner still sees and copies their own user ID in the project sidebar', async () => {
  const writes = stubClipboard()
  const workspace = confirmedPageWorkspace() as any
  workspace.connection.userId = 'usr_worker000001'
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await tick(); await tick()
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    const footer = mounted.container.querySelector('.collaboration-workspace-sidebar-footer') as HTMLElement
    assert.match(footer.textContent ?? '', /usr_work…0001/u)
    assert.equal([...footer.querySelectorAll('button')].some((button) => button.textContent?.trim() === '设置'), false)
    const copy = mounted.container.querySelector('.collaboration-workspace-user-id-status button') as HTMLButtonElement
    assert.equal(copy.disabled, false)
    await click(copy)
    assert.deepEqual(writes, ['usr_worker000001'])
  } finally {
    await mounted.unmount()
    restoreClipboard()
  }
})

async function mountAssignmentPage(workspace: unknown, tasks: readonly unknown[], calls: Call[], status: unknown = snapshot(tasks)) {
  const record = (id: string) => async (input: Record<string, unknown>) => { calls.push({ id, input }); return workspace }
  const coordinatorClient = { readWorkspace: async () => workspace, reassignTaskOffer: record(PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign), withdrawTaskOffer: record(PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw) } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => status } as never} />)
  await tick(); await tick()
  await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
  const openCard = (title: string) => click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes(title)) as HTMLButtonElement)
  const drawer = () => mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
  return { mounted, openCard, drawer }
}

test('first assignment and terminal-offer reassignment dispatch only from the explicit button, with the exact inputs', async () => {
  const calls: Call[] = []
  const rejected = { taskOfferId: 'tof_rejected00000001', taskId: moduleTwoTaskId, state: 'rejected', executionId: null, reassignmentTaskRevision: 3, workerUserId: 'usr_worker000001', expiresAt: '2026-10-19T00:00:00.000Z' }
  const workspace = confirmedPageWorkspace([cloudTask(moduleTwoTaskId, 3)], [rejected])
  const { mounted, openCard, drawer } = await mountAssignmentPage(workspace, [dashboardTask(moduleTwoTaskId, 'item_Test0002', 'Module two', 'intake')], calls)
  try {
    await openCard('Module one')
    assert.match(drawer().textContent ?? '', /为这个模块选择执行人/u)
    await setSelectValue(drawer().querySelector('select') as HTMLSelectElement, 'usr_worker000001')
    assert.equal(calls.length, 0, 'choosing a member alone must not dispatch')
    const before = Date.now()
    await click(buttonByText(drawer(), '派发任务'))
    const first = calls.at(-1)?.input as Record<string, unknown>
    assert.deepEqual({ ...first, offerExpiresAt: undefined }, { projectId: 'prj_demo000001', taskId: moduleOneTaskId, previousTaskOfferId: null, workerUserId: 'usr_worker000001', offerExpiresAt: undefined, nextOutputFileName: null, requirementsDocumentId: 'rqd_TestRequirements0001', planItemId: 'item_Test0001' })
    assert.ok(Date.parse(first.offerExpiresAt as string) > before)

    await openCard('Module two')
    assert.match(drawer().textContent ?? '', /任务需要重新派发/u)
    assert.match(drawer().textContent ?? '', /原派单已被拒绝/u)
    await setSelectValue(drawer().querySelector('select') as HTMLSelectElement, 'usr_worker000001')
    await click(buttonByText(drawer(), '重新派发'))
    const successor = calls.at(-1)?.input as Record<string, unknown>
    assert.deepEqual({ ...successor, offerExpiresAt: undefined }, { projectId: 'prj_demo000001', taskId: moduleTwoTaskId, previousTaskOfferId: 'tof_rejected00000001', workerUserId: 'usr_worker000001', offerExpiresAt: undefined, nextOutputFileName: null })
    assert.ok(Date.parse(successor.offerExpiresAt as string) > before)
    assert.equal(calls.length, 2)
  } finally { await mounted.unmount() }
})

test('a pending offer can be withdrawn, and a stale terminal offer is not offered for reassignment', async () => {
  const calls: Call[] = []
  const pending = { taskOfferId: 'tof_pending000000001', taskId: moduleTwoTaskId, state: 'pending', executionId: null, reassignmentTaskRevision: null, workerUserId: 'usr_worker000001', expiresAt: '2026-10-20T08:00:00.000Z' }
  const workspace = confirmedPageWorkspace([cloudTask(moduleTwoTaskId, 3)], [pending])
  const { mounted, openCard, drawer } = await mountAssignmentPage(workspace, [dashboardTask(moduleTwoTaskId, 'item_Test0002', 'Module two', 'ready')], calls)
  try {
    await openCard('Module two')
    assert.match(drawer().textContent ?? '', /当前派单待接受/u)
    assert.match(drawer().textContent ?? '', /改派/u, 'a pending offer can also be handed to another Member')
    await click(buttonByText(drawer(), '撤回派单'))
    assert.deepEqual(calls, [{ id: PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw, input: { projectId: 'prj_demo000001', taskId: moduleTwoTaskId, taskOfferId: 'tof_pending000000001', reason: '负责人撤回了待接受的派单。' } }])
  } finally { await mounted.unmount() }

  const stale = { taskOfferId: 'tof_stale0000000001', taskId: moduleTwoTaskId, state: 'rejected', executionId: null, reassignmentTaskRevision: 2, workerUserId: 'usr_worker000001', expiresAt: '2026-10-19T00:00:00.000Z' }
  const staleView = await mountAssignmentPage(confirmedPageWorkspace([cloudTask(moduleTwoTaskId, 3)], [stale]), [dashboardTask(moduleTwoTaskId, 'item_Test0002', 'Module two', 'intake')], [])
  try {
    await staleView.openCard('Module two')
    assert.equal(staleView.drawer().querySelector('select'), null)
    assert.doesNotMatch(staleView.drawer().textContent ?? '', /重新派发|派发任务/u)
  } finally { await staleView.mounted.unmount() }
})

function ownerPendingOfferWorkspace() {
  const workspace = confirmedPageWorkspace(
    [{
      task: {
        taskId: moduleOneTaskId,
        projectId: 'prj_demo000001',
        status: 'offered',
        revision: 5,
        currentExecutionId: null,
        currentExecutionState: null,
        requiredCapabilityTags: ['agent-runtime.codex']
      },
      delivery: null,
      executions: []
    }],
    [{
      taskOfferId: 'tof_owner0000000001',
      taskId: moduleOneTaskId,
      projectId: 'prj_demo000001',
      state: 'pending',
      executionId: null,
      reassignmentTaskRevision: null,
      workerUserId: 'usr_owner000001',
      expiresAt: '2026-10-20T08:00:00.000Z',
      revision: 1
    }]
  ) as any
  const project = workspace.projects[0]
  project.memberships = [...project.memberships, {
    projectMembershipId: 'pm_alice000001', userId: 'usr_alice000001', state: 'active', revision: 1
  }]
  const workerGroup = (userId: string, displayName: string, runtimeCapabilityTags: string[]) => ({
    userId,
    displayName,
    agents: [{
      displayName: `${displayName} Desktop`,
      projectAvailability: { availability: { agentActive: true, deviceActive: true, runtimeCapabilityTags } }
    }]
  })
  project.workerGroups = [
    workerGroup('usr_owner000001', 'Owner', ['agent-runtime.codex']),
    workerGroup('usr_worker000001', 'Worker', ['agent-runtime.codex']),
    workerGroup('usr_alice000001', 'Alice', ['public-data-selection'])
  ]
  return workspace
}

test('the Owner can reassign a pending Offer addressed to themselves while keeping accept and reject', async () => {
  const calls: Call[] = []
  const workspace = ownerPendingOfferWorkspace()
  const task = { ...dashboardTask(moduleOneTaskId, 'item_Test0001', 'Module one', 'intake'), primaryAction: 'accept_offer', assigneeUserId: 'usr_owner000001', assigneeDisplayName: 'Owner' }
  const { mounted, openCard, drawer } = await mountAssignmentPage(workspace, [task], calls, withAvailableOffer(snapshot([task]), moduleOneTaskId, 'tof_owner0000000001', 'usr_owner000001'))
  try {
    await openCard('Module one')
    assert.match(drawer().textContent ?? '', /这项任务分配给你/u)
    assert.ok(buttonByText(drawer(), '接受任务'))
    assert.ok(buttonByText(drawer(), '拒绝'))
    assert.match(drawer().textContent ?? '', /改派/u)
    const select = drawer().querySelector('select') as HTMLSelectElement
    assert.deepEqual(
      [...select.options].map((option) => option.value).filter(Boolean),
      ['usr_worker000001'],
      'only Members whose runtime provides every required tag are offered'
    )
    await setSelectValue(select, 'usr_worker000001')
    await click(buttonByText(drawer(), '改派'))
    assert.deepEqual(calls.map((call) => call.id), [
      PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
      PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign
    ])
    assert.deepEqual(calls[0]?.input, {
      projectId: 'prj_demo000001',
      taskId: moduleOneTaskId,
      taskOfferId: 'tof_owner0000000001',
      reason: '负责人将待接受的派单改派给其他成员。'
    })
    const successor = calls[1]?.input as Record<string, unknown>
    assert.deepEqual({ ...successor, offerExpiresAt: undefined }, {
      projectId: 'prj_demo000001',
      taskId: moduleOneTaskId,
      previousTaskOfferId: 'tof_owner0000000001',
      workerUserId: 'usr_worker000001',
      offerExpiresAt: undefined,
      nextOutputFileName: null
    })
    assert.ok(Date.parse(successor.offerExpiresAt as string) > Date.now() - 1_000)
  } finally { await mounted.unmount() }
})

function invitedMemberWorkspace() {
  const workspace = { connection: { state: 'ready', userId: 'usr_worker000001', deviceId: 'dev_demo000001' }, projects: [JSON.parse(JSON.stringify(model().project))] } as any
  workspace.projects[0].memberships = [
    { projectMembershipId: 'pm_owner000001', userId: 'usr_owner000001', state: 'active', revision: 3 },
    { projectMembershipId: 'pm_invited000001', userId: 'usr_worker000001', state: 'invited', revision: 5 }
  ]
  return workspace
}

test('two invited members accept the same reviewed Project revision after the first acceptance advances it', async () => {
  const reviewed = invitedMemberWorkspace()
  reviewed.projects[0].confirmedRequirements = {
    ...reviewed.projects[0].requirementsDraft, state: 'confirmed'
  }
  reviewed.projects[0].requirementsDraft = null
  const current = structuredClone(reviewed)
  const attempts: number[] = []
  const coordinator = {
    readWorkspace: async () => structuredClone(current),
    acceptInvitation: async (input: { expectedProjectRevision: number }) => {
      attempts.push(input.expectedProjectRevision)
      if (input.expectedProjectRevision !== current.projects[0].project.revision) {
        throw new Error('Project invitation acceptance lost the exact current Project revision.')
      }
      current.projects[0].memberships[1].state = 'active'
      current.projects[0].project.revision++
      return structuredClone(current)
    }
  }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinator as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    // Another invited User accepts after this User has reviewed revision 7.
    current.projects[0].memberships.push({ projectMembershipId: 'pm_other000001', userId: 'usr_other000001', state: 'active', revision: 2 })
    current.projects[0].project.revision++
    await click(buttonByText(mounted.container, '接受邀请'))
    assert.deepEqual(attempts, [7, 8])
    assert.equal(current.projects[0].memberships[1].state, 'active')
    assert.equal(mounted.container.querySelector('.collaboration-workspace-invitation-action'), null)
  } finally { await mounted.unmount() }
})

test('invitation acceptance shows the changed requirements reason without submitting again', async () => {
  const current = invitedMemberWorkspace()
  current.projects[0].confirmedRequirements = { ...current.projects[0].requirementsDraft, state: 'confirmed' }
  current.projects[0].requirementsDraft = null
  let attempts = 0
  const coordinator = {
    readWorkspace: async () => structuredClone(current),
    acceptInvitation: async () => {
      attempts++
      throw new Error('SciForge Cloud request failed: revision_conflict: The resource revision is stale.')
    }
  }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinator as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    current.projects[0].project.revision++
    current.projects[0].confirmedRequirements.documentRevision++
    await click(buttonByText(mounted.container, '接受邀请'))
    const banner = mounted.container.querySelector('.collaboration-workspace-invitation-action') as HTMLElement
    assert.match(banner.querySelector('[role="alert"]')?.textContent ?? '', /项目已更新，请查看后再接受：正式需求版本或摘要已变化/u)
    assert.equal(attempts, 1)
    assert.equal(current.projects[0].memberships[1].state, 'invited')
    assert.equal(buttonByText(banner, '接受邀请').disabled, false)
  } finally { await mounted.unmount() }
})

function inboxNav(container: HTMLElement): HTMLButtonElement {
  const nav = [...container.querySelectorAll('.collaboration-workspace-sidebar-nav-item')].find((candidate) => candidate.textContent?.includes('收件箱'))
  assert.ok(nav, 'missing inbox nav item')
  return nav as HTMLButtonElement
}

function acceptingCoordinator(workspace: any, calls: Call[]) {
  const project = workspace.projects[0]
  return {
    readWorkspace: async () => workspace,
    acceptInvitation: async (input: Record<string, any>) => {
      calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept, input })
      project.memberships = project.memberships.map((membership: any) => membership.projectMembershipId === input.projectMembershipId
        ? { ...membership, state: 'active', revision: membership.revision + 1 }
        : membership)
      return workspace
    }
  } as never
}

test('an invited member sees the invitation in the inbox, accepts it with the current revisions, and the entry disappears', async () => {
  const calls: Call[] = []
  const workspace = invitedMemberWorkspace()
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={acceptingCoordinator(workspace, calls)} collaborationClient={{ readStatus: async () => snapshot([], []) } as never} />)
  try {
    await tick(); await tick()
    assert.match(inboxNav(mounted.container).textContent ?? '', /1/u, 'the inbox badge counts the derived invitation')
    await click(inboxNav(mounted.container))
    assert.match(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /邀请你加入「Demo project」/u)
    await click(mounted.container.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)
    assert.match(mounted.container.querySelector('.collaboration-workspace-invitation-action')?.textContent ?? '', /Owner 邀请你加入此项目/u)
    assert.doesNotMatch(mounted.container.textContent ?? '', /负责人正在修改需求/u)
    await click(buttonByText(mounted.container, '接受邀请'))
    assert.deepEqual(calls.at(-1), {
      id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
      input: { projectId: 'prj_demo000001', projectMembershipId: 'pm_invited000001', expectedProjectRevision: 7, expectedMembershipRevision: 5 }
    })
    assert.equal(mounted.container.querySelector('.collaboration-workspace-invitation-action'), null, 'the accepted invitation disappears')
    await click(inboxNav(mounted.container))
    assert.equal(mounted.container.querySelectorAll('.collaboration-workspace-personal-row').length, 0)
    assert.equal(inboxNav(mounted.container).querySelector('b'), null, 'the inbox badge is cleared')
  } finally { await mounted.unmount() }
})

function invitationProject(projectId: string, displayName: string, membership: Readonly<{ projectMembershipId: string; state: 'active' | 'invited'; revision: number }>) {
  const record = JSON.parse(JSON.stringify(model().project)) as any
  record.project = { ...record.project, projectId, displayName, goal: `${displayName} 的目标` }
  record.requirementsDraft = { ...record.requirementsDraft, projectId }
  record.memberships = [
    { projectMembershipId: `pm_owner_${membership.projectMembershipId}`, userId: 'usr_owner000001', state: 'active', revision: 3 },
    { ...membership, userId: 'usr_worker000001' }
  ]
  record.memberUsers = [
    { userId: 'usr_owner000001', displayName: 'Owner' },
    { userId: 'usr_worker000001', displayName: 'Worker' }
  ]
  record.tasks = []
  record.offers = []
  record.workerGroups = []
  return record
}

test('a member who selected another Project still finds and accepts a new invitation in the inbox', async () => {
  const calls: Call[] = []
  const oldProject = invitationProject('prj_oldProject0001', '旧项目', { projectMembershipId: 'pm_oldWorker00001', state: 'active', revision: 4 })
  const newProject = invitationProject('prj_newProject0001', '新项目', { projectMembershipId: 'pm_newWorker00001', state: 'invited', revision: 5 })
  const workspace = (projectId?: string) => ({
    connection: { state: 'ready', userId: 'usr_worker000001', deviceId: 'dev_demo000001' },
    observedAt: '2026-10-18T00:00:00.000Z',
    ...(projectId ? { focusedProjectId: projectId } : {}),
    availableWorkerUsers: [],
    projects: [oldProject, newProject]
  })
  const coordinatorClient = {
    readWorkspace: async (input: { projectId?: string } = {}) => workspace(input.projectId),
    acceptInvitation: async (input: Record<string, unknown>) => {
      calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept, input })
      newProject.memberships = newProject.memberships.map((membership: any) => (
        membership.projectMembershipId === input.projectMembershipId
          ? { ...membership, state: 'active', revision: membership.revision + 1 }
          : membership
      ))
      return workspace('prj_newProject0001')
    }
  } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([], []) } as never} />)
  try {
    await tick(); await tick(); await tick()
    const oldRow = () => [...mounted.container.querySelectorAll('.collaboration-workspace-project-row')].find((row) => row.textContent?.includes('旧项目')) as HTMLButtonElement
    await click(oldRow())
    assert.equal(oldRow().classList.contains('is-selected'), true, 'the old Project stays selected')
    assert.match(inboxNav(mounted.container).textContent ?? '', /1/u, 'the unselected invitation is still counted')
    await click(inboxNav(mounted.container))
    assert.match(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /邀请你加入「新项目」/u)
    await click(mounted.container.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)
    assert.match(mounted.container.querySelector('.collaboration-workspace-invitation-action')?.textContent ?? '', /Owner 邀请你加入此项目/u)
    await click(buttonByText(mounted.container, '接受邀请'))
    assert.deepEqual(calls.at(-1), {
      id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
      input: { projectId: 'prj_newProject0001', projectMembershipId: 'pm_newWorker00001', expectedProjectRevision: 7, expectedMembershipRevision: 5 }
    })
    assert.equal(mounted.container.querySelector('.collaboration-workspace-invitation-action'), null)
    await click(inboxNav(mounted.container))
    assert.equal(mounted.container.querySelectorAll('.collaboration-workspace-personal-row').length, 0)
    assert.equal(inboxNav(mounted.container).querySelector('b'), null)
  } finally { await mounted.unmount() }
})

test('an invited member who opens the project from the sidebar sees the invitation banner and accepts it', async () => {
  const calls: Call[] = []
  const workspace = invitedMemberWorkspace()
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={acceptingCoordinator(workspace, calls)} collaborationClient={{ readStatus: async () => snapshot([], []) } as never} />)
  try {
    await tick(); await tick()
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    assert.match(mounted.container.querySelector('.collaboration-workspace-invitation-action')?.textContent ?? '', /Owner 邀请你加入此项目/u)
    assert.doesNotMatch(mounted.container.textContent ?? '', /负责人正在修改需求/u)
    await click(buttonByText(mounted.container, '接受邀请'))
    assert.deepEqual(calls, [{
      id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
      input: { projectId: 'prj_demo000001', projectMembershipId: 'pm_invited000001', expectedProjectRevision: 7, expectedMembershipRevision: 5 }
    }])
  } finally { await mounted.unmount() }
})

function offerMemberWorkspace() {
  const workspace = confirmedPageWorkspace() as any
  workspace.connection.userId = 'usr_worker000001'
  workspace.projects[0].offers = [{ taskId: assignedOfferTask().taskId, taskOfferId: 'tof_member000000001', workerUserId: 'usr_worker000001', state: 'pending', expiresAt: '2026-10-21T00:00:00.000Z' }]
  return workspace
}

function assignedOfferTask() {
  return { ...dashboardTask('tsk_offer_page0001', 'item_Test0001', 'Review samples', 'intake'), primaryAction: 'accept_offer', assigneeUserId: 'usr_worker000001', assigneeDisplayName: 'Worker' }
}

test('the mounted page refreshes one Offer gate across board, My Work, Inbox and detail and deduplicates acceptance clicks', async () => {
  const task = assignedOfferTask()
  const workspace = offerMemberWorkspace()
  workspace.projects[0].offers = [{ taskId: task.taskId, taskOfferId: 'ofr_TestRecover0001', workerUserId: 'usr_worker000001', state: 'pending', expiresAt: '2026-10-21T00:00:00.000Z' }]
  let availability = { state: 'recovering', reason: 'authority_unverified', canAccept: false, canReject: false, canDismiss: false }
  let accepts = 0
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const status = () => ({
    ...(snapshot([task], []) as object),
    projects: [{ projectId: task.projectId, tasks: [{ taskId: task.taskId, taskOfferId: 'ofr_TestRecover0001', workerUserId: 'usr_worker000001', offerAvailability: availability }] }]
  })
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={{
    readStatus: async () => status(),
    decideTaskOffer: async () => { accepts += 1; await pending }
  } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    const cardButton = () => mounted.container.querySelector('.collaboration-workspace-task-card-button') as HTMLButtonElement
    assert.match(cardButton().textContent ?? '', /恢复中/u)
    await click(cardButton())
    assert.match(mounted.container.querySelector('.collaboration-workspace-task-drawer')?.textContent ?? '', /恢复中/u)
    assert.equal([...mounted.container.querySelectorAll('button')].some((button) => button.textContent === '接受任务'), false)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-sidebar-nav-item')].find((item) => item.textContent?.includes('我的工作')) as HTMLButtonElement)
    assert.match(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /恢复中/u)
    await click(inboxNav(mounted.container))
    assert.match(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /恢复中/u)
    availability = { ...availableOffer }
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    await click(mounted.container.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)
    const accept = buttonByText(mounted.container, '接受任务')
    await click(accept)
    await click(accept)
    assert.equal(accepts, 1)
    availability = { state: 'sync_pending', reason: 'synchronization_pending', canAccept: false, canReject: false, canDismiss: false }
    await act(async () => { release(); await tick(); await tick() })
    assert.match(mounted.container.querySelector('.collaboration-workspace-task-drawer')?.textContent ?? '', /待同步/u)
    assert.equal([...mounted.container.querySelectorAll('button')].some((button) => button.textContent === '接受任务'), false)
    availability = { state: 'claimed_elsewhere', reason: 'claimed_by_other_device', canAccept: false, canReject: false, canDismiss: false }
    await act(async () => { browserWindow.dispatchEvent(new browserWindow.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.querySelector('.collaboration-workspace-task-drawer')?.textContent ?? '', /已被其他设备领取/u)
    assert.equal(accepts, 1)
  } finally { release(); await mounted.unmount() }
})

test('an accept_offer task assigned to the member appears in the inbox with its badge', async () => {
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => offerMemberWorkspace() } as never} collaborationClient={{ readStatus: async () => withAvailableOffer(snapshot([assignedOfferTask()], []), assignedOfferTask().taskId, 'tof_member000000001', 'usr_worker000001') } as never} />)
  try {
    await tick(); await tick()
    assert.match(inboxNav(mounted.container).textContent ?? '', /1/u)
    await click(inboxNav(mounted.container))
    assert.match(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /新任务待接受：Review samples/u)
  } finally { await mounted.unmount() }
})

test('an existing offer notification is not duplicated by the derived offer entry', async () => {
  const notification = { notificationId: 'ntf_offer_page0001', projectId: 'prj_demo000001', taskId: 'tsk_offer_page0001', recipientUserId: 'usr_worker000001', kind: 'offer', summary: '任务待接受：Review samples', actionRequired: true, expiresAt: null, readAt: null, sourceEventId: 'evt_offer_page0001', revision: 1, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => offerMemberWorkspace() } as never} collaborationClient={{ readStatus: async () => withAvailableOffer(snapshot([assignedOfferTask()], [notification]), assignedOfferTask().taskId, 'tof_member000000001', 'usr_worker000001') } as never} />)
  try {
    await tick(); await tick()
    await click(inboxNav(mounted.container))
    assert.equal(mounted.container.querySelectorAll('.collaboration-workspace-personal-row').length, 1)
    const list = mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? ''
    assert.match(list, /任务待接受：Review samples/u)
    assert.doesNotMatch(list, /新任务待接受：/u)
  } finally { await mounted.unmount() }
})

test('the owner inbox shows one Chinese delivery todo with the task title and acknowledges every merged event', async () => {
  const workspace = confirmedPageWorkspace()
  const task = { ...dashboardTask(moduleOneTaskId, 'item_Test0001', '本机交付任务', 'waiting_result_confirm'), delivery: 'sealed', contractExecution: 'completed', primaryAction: 'adopt_delivery', executionId: 'exe_preview000001' }
  const notification = (notificationId: string, summary: string) => ({ notificationId, projectId: 'prj_demo000001', taskId: moduleOneTaskId, recipientUserId: 'usr_owner000001', kind: 'review', summary, actionRequired: true, expiresAt: null, readAt: null, sourceEventId: `evt_${notificationId}`, revision: 1, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' })
  const marked: string[] = []
  const client = {
    readStatus: async () => snapshot([task], [
      notification('ntf_candidate_page01', 'Worker confirmed a Delivery candidate; its review is in progress.'),
      notification('ntf_sealed_page0001', 'Worker sealed an immutable Delivery manifest; it awaits the Coordinator decision.')
    ]),
    markNotificationRead: async (input: { notificationId: string }) => { marked.push(input.notificationId) }
  }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={client as never} />)
  try {
    await tick(); await tick()
    assert.match(inboxNav(mounted.container).textContent ?? '', /1/u)
    await click(inboxNav(mounted.container))
    const list = mounted.container.querySelector('.collaboration-workspace-personal-list') as HTMLElement
    assert.equal(list.querySelectorAll('.collaboration-workspace-personal-row').length, 1)
    assert.match(list.textContent ?? '', /Worker 提交了交付：本机交付任务/u)
    assert.doesNotMatch(list.textContent ?? '', /sealed an immutable|Delivery candidate|Coordinator decision/u)
    await click(list.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)
    assert.deepEqual(marked.sort(), ['ntf_candidate_page01', 'ntf_sealed_page0001'])
  } finally { await mounted.unmount() }
})

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function deliveryPageFixture(userId = 'usr_worker000001') {
  const workspace = confirmedPageWorkspace()
  workspace.connection.userId = userId
  const task = { ...dashboardTask(moduleOneTaskId, 'item_Test0001', '本机交付任务', 'in_progress'), executionId: 'exe_delivery000001' as string | null }
  const target = { projectId: task.projectId, taskId: task.taskId, executionId: task.executionId!, contractRevision: 1, resultRevision: 2, bundleDigest: 'b'.repeat(64), decision: 'approved' as const }
  const delivery = { projectId: target.projectId, taskId: target.taskId, executionId: target.executionId, state: 'waiting_confirmation',
    draft: { selectedMaterials: [], materialError: null, revision: 1, resultRevision: 2, basedOnResultRevision: null, summary: 'README 已生成并验证', aiSummary: null, summaryEdited: false,
      sourceTurnId: 'turn_delivery000001', sourceRound: 1, sourceUpdatedAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', changed: false,
      outputs: [{ fileName: 'README.md', relativePath: 'README.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 42, sha256: 'a'.repeat(64) }] },
    history: [], confirmationTarget: target, candidate: null, operationId: null, deliveryManifestId: null, error: null, residuals: [] } as any
  const status = () => ({ ...(snapshot([task]) as object), projects: [{ projectId: task.projectId, tasks: [{ taskId: task.taskId, workerUserId: 'usr_worker000001', executionId: task.executionId, hasDedicatedSession: true }] }] })
  const calls: Call[] = []
  const client = {
    readStatus: async () => status(),
    readWorkerDelivery: async (input: unknown) => { calls.push({ id: 'readWorkerDelivery', input }); return { delivery: { ...delivery } } },
    saveWorkerDeliveryDraft: async (input: any) => { calls.push({ id: 'saveWorkerDeliveryDraft', input }); delivery.draft = { ...delivery.draft, summary: input.summary, revision: delivery.draft.revision + 1 }; return { delivery: structuredClone(delivery) } },
    submitWorkerDelivery: async (input: unknown) => { calls.push({ id: 'submitWorkerDelivery', input }); delivery.state = 'sealed'; delivery.candidate = { target: delivery.confirmationTarget, bundle: { summary: delivery.draft.summary, outputs: delivery.draft.outputs, resultRevision: delivery.draft.resultRevision } }; return { delivery: structuredClone(delivery) } },
    openTaskSession: async (input: unknown) => { calls.push({ id: 'openTaskSession', input }); return { opened: true, sessionId: 'session_delivery000001', runtimeId: 'codex', threadId: 'session_delivery000001' } }
  }
  return { workspace, task, target, delivery, status, calls, client }
}

test('task draft opens its exact standard Session and contribution activation restores the same draft', async () => {
  const fixture = deliveryPageFixture()
  const requests: unknown[] = []
  const props = { coordinatorClient: { readWorkspace: async () => fixture.workspace } as never, collaborationClient: fixture.client as never,
    workbench: { openSession: async (request: unknown) => { requests.push(request); return true } } as never }
  const mounted = await mount(<CollaborationWorkspacePage {...props} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-ask-ai"]') as HTMLButtonElement)
    assert.equal(requests.length, 1)
    const request = requests[0] as any
    assert.equal(request.runtimeId, 'codex')
    assert.equal(request.threadId, 'session_delivery000001')
    assert.equal(request.focusComposer, true)
    assert.match(request.returnTo.label, /协作任务 #1.*返回交付草稿/u)
    assert.deepEqual(request.returnTo.activation.payload, { projectId: fixture.target.projectId, taskId: fixture.target.taskId })
    assert.deepEqual(fixture.calls.find((call) => call.id === 'openTaskSession')?.input, { projectId: fixture.target.projectId, taskId: fixture.target.taskId, executionId: fixture.target.executionId })
    await click(inboxNav(mounted.container))
    await mounted.rerender(<CollaborationWorkspacePage {...props} activation={request.returnTo.activation} />)
    assert.match(mounted.container.querySelector('.collaboration-workspace-task-drawer')?.textContent ?? '', /本机交付任务.*交付草稿/su)
  } finally { await mounted.unmount() }
})

test('task activity renders typed dispatch acceptance version submission and revision events', async () => {
  const fixture = deliveryPageFixture()
  const at = '2026-10-21T02:00:00.000Z'
  const entries = ([['state', '已派单给成员'], ['state', '成员已接受任务'], ['delivery', '第 1 版已提交'], ['review', '负责人要求返修']] as const).map(([kind, summary], index) => dashboardActivityItemSchema.parse({
    type: 'dashboard_activity_item', schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at, public: true, actorDisplayName: '任务参与人',
    event: { type: 'public_activity_event', schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at, projectId: 'prj_demo00000001',
      taskId: fixture.target.taskId, sequence: index + 1, eventId: `evt_taskactivity00000${index}`, kind, payload: { summary }, occurredAt: at }
  }))
  const client = { ...fixture.client, readStatus: async () => {
    const status = JSON.parse(JSON.stringify(fixture.status()).replaceAll('prj_demo000001', 'prj_demo00000001'))
    status.dashboards[0].activity = entries
    return status
  } }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => JSON.parse(JSON.stringify(fixture.workspace).replaceAll('prj_demo000001', 'prj_demo00000001')) } as never} collaborationClient={client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    const activity = mounted.container.querySelector('[aria-label="动态"]')!
    for (const [,summary] of [['state', '已派单给成员'], ['state', '成员已接受任务'], ['delivery', '第 1 版已提交'], ['review', '负责人要求返修']]) assert.ok(activity.textContent?.includes(summary!))
    assert.equal(activity.querySelectorAll('.is-event').length, 4)
  } finally { await mounted.unmount() }
})

test('real page submits a local waiting_confirmation candidate while Cloud says not_submitted and previews its exact file', async () => {
  const fixture = deliveryPageFixture()
  const previews: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={fixture.client as never} workspacePreview={{ open: (target) => previews.push(target) }} />)
  try {
    assert.match(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /待提交交付/u)
    await click(inboxNav(mounted.container))
    const inbox = mounted.container.querySelector('.collaboration-workspace-personal-list') as HTMLElement
    assert.match(inbox.textContent ?? '', /交付已准备好：本机交付任务/u)
    await click(inbox.querySelector('button') as HTMLButtonElement)
    const drawer = mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
    assert.match(mounted.container.querySelector('.collaboration-workspace-task-card.is-selected')?.textContent ?? '', /待提交交付/u)
    assert.match(drawer.textContent ?? '', /交付草稿.*README 已生成并验证.*README.md.*42 B/u)
    await click(drawer.querySelector('[aria-label="预览 README.md"]') as HTMLButtonElement)
    assert.deepEqual(fixture.calls.find((call) => call.id === 'openTaskSession')?.input, { projectId: fixture.target.projectId, taskId: fixture.target.taskId, executionId: fixture.target.executionId })
    assert.deepEqual(previews, [{ path: 'README.md', sessionId: 'session_delivery000001', mimeType: 'text/markdown', kind: 'file', integrity: { algorithm: 'sha256', expectedDigest: 'a'.repeat(64) } }])
    await confirmDelivery(drawer)
    assert.deepEqual(fixture.calls.find((call) => call.id === 'submitWorkerDelivery')?.input, { target: fixture.target })
    assert.equal(drawer.querySelector('[data-testid="delivery-submit"]'), null)
    assert.match(drawer.textContent ?? '', /待负责人采纳/u)
    await click(inboxNav(mounted.container))
    assert.doesNotMatch(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /交付已准备好/u)
  } finally { await mounted.unmount() }
})

test('real page replaces the dirty delivery with the new revision, summary, file digest and submission target after refresh', async () => {
  const fixture = deliveryPageFixture()
  const previews: unknown[] = []
  fixture.task.delivery = 'worker_review'
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={fixture.client as never} workspacePreview={{ open: (target) => previews.push(target) }} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    assert.match(mounted.container.textContent ?? '', /第 2 版/u)
    fixture.delivery.draft.changed = true
    fixture.delivery.state = 'executing'
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.textContent ?? '', /README 已生成并验证/u)
    assert.match(mounted.container.textContent ?? '', /AI 正在修改/u)
    assert.equal((mounted.container.querySelector('[data-testid="delivery-submit"]') as HTMLButtonElement).disabled, true)
    const revisedTarget = { ...fixture.target, resultRevision: 3, bundleDigest: 'c'.repeat(64) }
    fixture.delivery.confirmationTarget = revisedTarget
    fixture.delivery.draft = { ...fixture.delivery.draft, resultRevision: 3, revision: 2, changed: true,
      summary: '返修后已补充验收证据', outputs: [{ fileName: 'README.md', relativePath: 'README.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 2391, sha256: 'd'.repeat(64) }] }
    fixture.delivery.state = 'waiting_confirmation'
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    const drawer = mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
    assert.match(drawer.textContent ?? '', /第 3 版.*返修后已补充验收证据.*README.md.*2.3 KB/u)
    assert.doesNotMatch(drawer.textContent ?? '', /README 已生成并验证|42 B/u)
    await click(drawer.querySelector('[aria-label="预览 README.md"]') as HTMLButtonElement)
    assert.equal((previews[0] as { integrity: { expectedDigest: string } }).integrity.expectedDigest, 'd'.repeat(64))
    await confirmDelivery(drawer)
    assert.deepEqual(fixture.calls.find((call) => call.id === 'submitWorkerDelivery')?.input, { target: revisedTarget })
  } finally { await mounted.unmount() }
})

test('real page refresh discovers a newly prepared local delivery and keeps submission failures visible', async () => {
  const fixture = deliveryPageFixture()
  fixture.delivery.state = 'executing'
  const client = { ...fixture.client, submitWorkerDelivery: async () => { throw new Error('上传失败：连接中断') } }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never} />)
  try {
    assert.doesNotMatch(mounted.container.textContent ?? '', /待提交交付/u)
    fixture.delivery.state = 'waiting_confirmation'
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.match(mounted.container.querySelector('.collaboration-workspace-personal-list')?.textContent ?? '', /待提交交付/u)
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await confirmDelivery(mounted.container)
    assert.match(mounted.container.textContent ?? '', /上传失败：连接中断/u)
    assert.ok(mounted.container.querySelector('[data-testid="delivery-submit-confirm"]'))
  } finally { await mounted.unmount() }
})

test('non-assignees never read or submit another member candidate, and a missing candidate has no submit control', async () => {
  for (const userId of ['usr_owner000001', 'usr_alice000001', 'usr_worker000001']) {
    const fixture = deliveryPageFixture(userId)
    if (userId === 'usr_worker000001') fixture.delivery.draft = null
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={fixture.client as never} />)
    try {
      await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
      await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
      assert.doesNotMatch(mounted.container.textContent ?? '', /确认并提交交付|README 已生成/u)
      if (userId !== 'usr_worker000001') assert.equal(fixture.calls.length, 0)
    } finally { await mounted.unmount() }
  }
})

function sealedDeliveryPreviewFixture(options: Readonly<{ mediaType?: string; fileName?: string }> = {}) {
  const workspace = confirmedPageWorkspace()
  const fileName = options.fileName ?? 'README.md'
  const mediaType = options.mediaType ?? 'text/markdown'
  const object = (objectId: string, extra: Record<string, unknown>) => ({ objectId, objectKey: `objects/prj_demo000001/${objectId}`, revision: 1, sha256: 'a'.repeat(64), projectId: 'prj_demo00000001', visibility: 'project_public', ownerUserId: 'usr_worker000001', retentionUntil: null, ...extra })
  const manifest = {
    deliveryManifestId: 'dmf_Preview0001', projectId: 'prj_demo00000001', taskId: moduleOneTaskId, executionId: 'exe_preview000001',
    sealedAt: '2026-10-19T12:30:00.000Z', resultRevision: 1, bundleObjectId: 'obj_Bundle0001', outputObjectIds: ['obj_Readme0001'],
    outputs: [{ objectId: 'obj_Readme0001', fileName, relativePath: fileName, role: 'declared', source: 'ai', mediaType, byteCount: 42, sha256: 'a'.repeat(64) }],
    objects: [
      object('obj_Bundle0001', { mediaType: 'application/json', byteCount: 128 }),
      object('obj_Readme0001', { mediaType, byteCount: 42 })
    ]
  }
  workspace.projects[0].tasks = [{
    task: { taskId: moduleOneTaskId, projectId: 'prj_demo00000001', title: '本机交付任务', status: 'completed', currentExecutionId: 'exe_preview000001', currentExecutionState: 'completed', fileIntent: { schemaVersion: 1, inputs: [], output: { fileName, mediaType, maxBytes: 1_048_576 } } },
    delivery: { taskId: moduleOneTaskId, candidate: null, manifest, receipt: null, result: null, revisionRequest: null },
    executions: [{ executionId: 'exe_preview000001', assigneeUserId: 'usr_worker000001' }]
  }]
  const drive = { projectId: 'prj_demo00000001', sharedMaterials: [], taskDeliveries: [manifest], projectResults: [] }
  const card = { ...dashboardTask(moduleOneTaskId, 'item_Test0001', '本机交付任务', 'waiting_result_confirm'), delivery: 'sealed', adoption: 'pending', contractExecution: 'completed', primaryAction: 'adopt_delivery', executionId: 'exe_preview000001' }
  const status = () => snapshot([card])
  const text = '# 交付说明\n\n实验已完成，全部指标达到验收标准。\n'
  const sealedBody = (id: string) => new TextEncoder().encode(id === 'obj_Bundle0001' ? JSON.stringify({ schemaVersion: 2, projectId: manifest.projectId, taskId: manifest.taskId,
    executionId: manifest.executionId, contractRevision: 1, resultRevision: 1, summary: '成员确认的结果说明', outputs: [{ fileName, relativePath: fileName, role: 'declared', source: 'ai', mediaType, byteCount: 42, sha256: 'a'.repeat(64) }] }) : text)
  Object.assign(manifest.objects[0]!, { byteCount: sealedBody('obj_Bundle0001').byteLength })
  const calls = { open: [] as unknown[], ranges: [] as unknown[], describes: 0 }
  const client = {
    readWorkspace: async () => workspace,
    listDrive: async () => drive,
    openDeliveryObject: async (input: any) => { calls.open.push(input); return { resource: { token: input.objectId }, object: manifest.objects.find((object) => object.objectId === input.objectId) } },
    describeDeliveryObject: async (resource: any) => { calls.describes += 1; const body = sealedBody(resource.token); return { ok: true, descriptor: { file: { name: fileName, mimeType: mediaType }, range: { available: true, size: body.length, maxChunkBytes: 1_048_576, recommendedChunkBytes: 262_144 } } } },
    readDeliveryObjectRange: async (resource: any, input: Readonly<{ range: { offset: number; length: number } }>) => {
      calls.ranges.push(input)
      const bytes = sealedBody(resource.token)
      return { ok: true, offset: input.range.offset, length: bytes.length, size: bytes.length, dataBase64: Buffer.from(bytes).toString('base64') }
    }
  }
  return { workspace, drive, card, status, calls, client, manifest, text, fileName, mediaType }
}

async function openFilesPage(container: HTMLElement): Promise<HTMLElement> {
  await click(container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
  await click(buttonByText(container, '文件'))
  const files = container.querySelector('.collaboration-workspace-files-page') as HTMLElement
  assert.ok(files, container.innerHTML)
  return files
}

function previewRow(files: HTMLElement, name: string): HTMLElement {
  const row = [...files.querySelectorAll('.collaboration-workspace-file-row')].find((entry) => entry.textContent?.includes(name)) as HTMLElement | undefined
  assert.ok(row, `missing file row ${name}`)
  return row
}

test('the Owner opens a sealed file through the generic resource preview from the Files page', async () => {
  const fixture = sealedDeliveryPreviewFixture()
  const opened: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.client as never} collaborationClient={{ readStatus: async () => fixture.status() } as never} resourcePreview={{ open: (target) => { opened.push(target); return true } }} />)
  try {
    const files = await openFilesPage(mounted.container)
    assert.match(files.textContent ?? '', /README.md/u)
    assert.doesNotMatch(files.textContent ?? '', /objects\/|obj_Readme0001|obj_Bundle0001/u)
    await click(previewRow(files, 'README.md').querySelector('button') as HTMLButtonElement)
    assert.deepEqual(opened, [{ resource: { token: 'obj_Readme0001' }, file: { name: 'README.md', mimeType: 'text/markdown', size: 42 } }])
    assert.deepEqual(fixture.calls.open, [{ deliveryManifestId: 'dmf_Preview0001', objectId: 'obj_Readme0001' }])
    assert.equal(fixture.calls.ranges.length, 0)
    assert.equal(fixture.calls.describes, 0)
  } finally { await mounted.unmount() }
})

test('the Owner reads sealed summary metadata and opens the exact file resource before adopting', async () => {
  const fixture = sealedDeliveryPreviewFixture()
  const opened: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.client as never} collaborationClient={{ readStatus: async () => fixture.status() } as never} resourcePreview={{ open: (target) => { opened.push(target); return true } }} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    const drawer = mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
    assert.match(drawer.textContent ?? '', /成员确认的结果说明/u)
    assert.equal(drawer.querySelector('[data-testid="delivery-summary"]'), null)
    const metadataReads = fixture.calls.ranges.length
    await click(drawer.querySelector('[aria-label="预览 README.md"]') as HTMLButtonElement)
    assert.deepEqual(opened, [{ resource: { token: 'obj_Readme0001' }, file: { name: 'README.md', mimeType: 'text/markdown', size: 42 } }])
    assert.equal(fixture.calls.ranges.length, metadataReads)
    assert.equal(mounted.container.querySelector('[aria-label="交付文件预览"]'), null)
    assert.deepEqual(fixture.calls.open, [{ deliveryManifestId: 'dmf_Preview0001', objectId: 'obj_Bundle0001' }, { deliveryManifestId: 'dmf_Preview0001', objectId: 'obj_Readme0001' }])
  } finally { await mounted.unmount() }
})

test('sealed image preview uses the same generic resource path without a dedicated Session', async () => {
  const fixture = sealedDeliveryPreviewFixture({ mediaType: 'image/png', fileName: 'figure.png' })
  const opened: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.client as never} collaborationClient={{ readStatus: async () => fixture.status() } as never} resourcePreview={{ open: (target) => { opened.push(target); return true } }} />)
  try {
    const files = await openFilesPage(mounted.container)
    await click(previewRow(files, 'figure.png').querySelector('button') as HTMLButtonElement)
    assert.deepEqual(opened, [{ resource: { token: 'obj_Readme0001' }, file: { name: 'figure.png', mimeType: 'image/png', size: 42 } }])
    assert.equal(fixture.calls.ranges.length, 0)
    assert.equal(fixture.calls.describes, 0)
  } finally { await mounted.unmount() }
})

test('real requirements page names module dependencies and the board shows pending upstream adoption', async () => {
  const workspace = confirmedPageWorkspace()
  const document = workspace.projects[0].confirmedRequirements
  document.workModules[1].dependencyPlanItemIds = ['item_Test0001']
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    const board = mounted.container.querySelector('.collaboration-workspace-main-body') as HTMLElement
    assert.match(board.textContent ?? '', /等待 #1 采纳/u)
    await click(buttonByText(mounted.container, '需求'))
    const modules = mounted.container.querySelector('.collaboration-workspace-requirements-list') as HTMLElement
    assert.match(modules.textContent ?? '', /可立即开始/u)
    assert.match(modules.textContent ?? '', /依赖：#1 Module one/u)
    await click([...modules.querySelectorAll('button')].find((button) => button.textContent?.includes('Module two')) as HTMLButtonElement)
    assert.match(mounted.container.querySelector('.collaboration-workspace-task-drawer')?.textContent ?? '', /等待 #1 采纳/u)
  } finally { await mounted.unmount() }
})

function controlledAction(onSuccess: () => unknown = () => ({})) {
  let count = 0
  let reject!: (reason: Error) => void
  const pending = new Promise<unknown>((_resolve, fail) => { reject = fail })
  return {
    get count() { return count },
    invoke: async () => { count += 1; return count === 1 ? pending : onSuccess() },
    reject
  }
}

async function assertPendingAndFailure(scope: HTMLElement, label: string, operation: ReturnType<typeof controlledAction>): Promise<void> {
  const button = buttonByText(scope, label)
  await act(async () => { button.click(); button.click(); await tick(); await tick() })
  assert.equal(operation.count, 1, 'two immediate clicks dispatch only one operation')
  assert.equal(button.textContent, '处理中…')
  assert.equal(button.disabled, true)
  await click(button)
  assert.equal(operation.count, 1)
  await act(async () => { operation.reject(new Error('操作被拒绝，请重试')); await tick(); await tick() })
  assert.equal(button.textContent, label)
  assert.equal(button.disabled, false)
  assert.match(scope.querySelector('[role="alert"]')?.textContent ?? '', /操作被拒绝，请重试/u)
}

for (const kind of ['submit', 'adopt', 'revision', 'reassign'] as const) {
  test(`real page ${kind} action stays busy, rejects duplicate clicks and reports failure in its drawer`, async () => {
    const fixture = deliveryPageFixture(kind === 'submit' ? 'usr_worker000001' : 'usr_owner000001')
    const operation = controlledAction(() => kind === 'submit' ? { delivery: fixture.delivery } : {})
    const coordinator: Record<string, unknown> = { readWorkspace: async () => fixture.workspace }
    const client = { ...fixture.client }
    let label: string
    if (kind === 'submit') {
      label = '提交'
      client.submitWorkerDelivery = operation.invoke as never
    } else if (kind === 'reassign') {
      label = '改派'
      const pending = ownerPendingOfferWorkspace()
      fixture.workspace.projects = pending.projects
      fixture.task.primaryAction = 'accept_offer'
      fixture.task.assigneeUserId = 'usr_owner000001'
      fixture.task.executionId = null
      coordinator.withdrawTaskOffer = operation.invoke
      coordinator.reassignTaskOffer = async () => ({})
    } else {
      label = kind === 'adopt' ? '采纳交付' : '发送返修要求'
      fixture.task.primaryAction = 'adopt_delivery'
      fixture.task.delivery = 'sealed'
      fixture.task.workflowColumn = 'waiting_result_confirm'
      fixture.workspace.projects[0].tasks = [{ task: { taskId: fixture.task.taskId }, delivery: { manifest: { deliveryManifestId: 'dm_busy000001', objects: [], sealedAt: '2026-10-18T00:00:00.000Z' } }, executions: [] }]
      coordinator[kind === 'adopt' ? 'decideAdoption' : 'requestRevision'] = operation.invoke
    }
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinator as never} collaborationClient={client as never} />)
    try {
      await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
      await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
      const drawer = mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
      if (kind === 'reassign') await setSelectValue(drawer.querySelector('select') as HTMLSelectElement, 'usr_worker000001')
      if (kind === 'revision') {
        await click(buttonByText(drawer, '要求返修'))
        await setValue(inputByLabel(drawer, '返修意见') as HTMLTextAreaElement, '请补充验证证据。')
      }
      if (kind === 'submit') {
        await click(buttonByText(drawer, '提交'))
        const confirm = drawer.querySelector('[data-testid="delivery-submit-confirm"]') as HTMLButtonElement
        assert.ok(confirm)
        await act(async () => { confirm.click(); confirm.click(); await tick(); await tick() })
        assert.equal(operation.count, 1)
        assert.equal(confirm.textContent, '提交中…')
        assert.equal(confirm.disabled, true)
        fixture.delivery.submissionProgress = 'signing'
        await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
        assert.match(drawer.querySelector('[data-testid="delivery-submit-progress"]')?.textContent ?? '', /验证当前设备/u)
        fixture.delivery.submissionProgress = 'staging'
        await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
        assert.match(drawer.querySelector('[data-testid="delivery-submit-progress"]')?.textContent ?? '', /上传交付文件/u)
        await act(async () => { operation.reject(new Error('操作被拒绝，请重试')); await tick(); await tick() })
        assert.match(drawer.textContent ?? '', /操作被拒绝，请重试/u)
        assert.equal(confirm.disabled, false)
        await click(confirm)
        assert.equal(operation.count, 2)
        assert.equal(drawer.querySelector('[data-testid="delivery-submit-confirmation"]'), null)
      } else {
        await assertPendingAndFailure(drawer, label, operation)
        await click(buttonByText(drawer, label))
        assert.equal(operation.count, 2)
        assert.equal(buttonByText(drawer, kind === 'revision' ? '要求返修' : label).disabled, false)
        assert.equal(drawer.querySelector('[role="alert"]'), null)
      }
    } finally { await mounted.unmount() }
  })
}

test('real page invitation acceptance disables while pending, keeps its error by the invitation and recovers on retry', async () => {
  const workspace = invitedMemberWorkspace()
  const operation = controlledAction(() => { workspace.projects[0].memberships[1].state = 'active'; return workspace })
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace, acceptInvitation: operation.invoke } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    const banner = mounted.container.querySelector('.collaboration-workspace-invitation-action') as HTMLElement
    await assertPendingAndFailure(banner, '接受邀请', operation)
    await click(buttonByText(banner, '接受邀请'))
    assert.equal(operation.count, 2)
    assert.equal(mounted.container.querySelector('.collaboration-workspace-invitation-action'), null)
  } finally { await mounted.unmount() }
})

test('real page project creation keeps busy and errors in the dialog and closes it only on success', async () => {
  const workspace = confirmedPageWorkspace()
  const operation = controlledAction(() => ({ createdProjectId: workspace.projects[0].project.projectId, workspace }))
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace, createProject: operation.invoke } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('button[aria-label="新建项目"]') as HTMLButtonElement)
    const dialog = mounted.container.querySelector('[role="dialog"]') as HTMLElement
    await setValue(inputByLabel(dialog, '项目名称'), '新的项目')
    await setValue(inputByLabel(dialog, '项目说明'), '项目说明')
    await assertPendingAndFailure(dialog, '创建项目', operation)
    assert.equal((inputByLabel(dialog, '项目名称') as HTMLInputElement).value, '新的项目')
    await click(buttonByText(dialog, '创建项目'))
    assert.equal(operation.count, 2)
    assert.equal(mounted.container.querySelector('[role="dialog"]'), null)
    assert.match(mounted.container.querySelector('.collaboration-workspace-requirements-page')?.textContent ?? '', /需求文档/u)
  } finally { await mounted.unmount() }
})

test('real page requirements confirmation remains open while pending and failed, then closes on success', async () => {
  const workspace = { connection: { state: 'ready', userId: 'usr_owner000001' }, projects: [model().project] } as any
  const operation = controlledAction(() => workspace)
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => workspace, confirmRequirements: operation.invoke } as never} collaborationClient={{ readStatus: async () => snapshot([]) } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click(buttonByText(mounted.container, '需求'))
    await click(buttonByText(mounted.container, '确认需求'))
    const dialog = mounted.container.querySelector('[role="dialog"]') as HTMLElement
    await assertPendingAndFailure(dialog, '确认需求', operation)
    assert.ok(mounted.container.querySelector('[role="dialog"]'))
    await click(buttonByText(dialog, '确认需求'))
    assert.equal(operation.count, 2)
    assert.equal(mounted.container.querySelector('[role="dialog"]'), null)
  } finally { await mounted.unmount() }
})


test('workspace revision form validates instructions, preserves inline failures, and shows the Owner instruction to the member', async () => {
  const taskId = 'tsk_revision_page'
  const task = adoptedTask(taskId, 'pending') as any
  const workspace = confirmedPageWorkspace([task])
  const dashboard = { ...dashboardTask(taskId, 'item_Test0001', '返修任务', 'waiting_result_confirm'), delivery: 'sealed', contractExecution: 'completed', primaryAction: 'adopt_delivery' }
  const calls: unknown[] = []
  let rejectRequest!: (error: Error) => void
  let shouldFail = true
  const coordinatorClient = {
    readWorkspace: async () => workspace,
    requestRevision: async (input: { instruction: string }) => {
      calls.push(input)
      if (shouldFail) await new Promise<void>((_resolve, reject) => { rejectRequest = reject })
      task.delivery.revisionRequest = { instruction: input.instruction }
    }
  } as never
  const collaborationClient = { readStatus: async () => snapshot([dashboard]) } as never
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={collaborationClient} />)
  const instruction = '需要单细胞批次校正方法与效果评估\n请补充对照结果。'
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('返修任务')) as HTMLButtonElement)
    await click(buttonByText(mounted.container, '要求返修'))
    let input = inputByLabel(mounted.container, '返修意见') as HTMLTextAreaElement
    assert.equal(input.maxLength, 1000)
    assert.equal(input.required, true)
    assert.equal(buttonByText(mounted.container, '发送返修要求').disabled, true)
    await setValue(input, '   ')
    await click(buttonByText(mounted.container, '发送返修要求'))
    assert.equal(calls.length, 0)
    await setValue(input, '字'.repeat(1001))
    assert.equal(buttonByText(mounted.container, '发送返修要求').disabled, true)
    await click(buttonByText(mounted.container, '取消'))
    assert.equal(mounted.container.querySelector('textarea[aria-label="返修意见"]'), null)
    await click(buttonByText(mounted.container, '要求返修'))
    input = inputByLabel(mounted.container, '返修意见') as HTMLTextAreaElement
    await setValue(input, `  ${instruction}  `)
    await click(buttonByText(mounted.container, '发送返修要求'))
    assert.equal(calls.length, 1)
    assert.equal(input.disabled, true)
    assert.equal(buttonByText(mounted.container, '取消').disabled, true)
    assert.equal(mounted.container.querySelector('[aria-label="任务详情"]')?.getAttribute('aria-busy'), 'true')
    await act(async () => { rejectRequest(new Error('返修请求失败，请重试')); await tick(); await tick() })
    assert.equal(input.value, `  ${instruction}  `)
    assert.equal(mounted.container.querySelector('[aria-label="任务详情"] [role="alert"]')?.textContent, '返修请求失败，请重试')
    assert.equal(mounted.container.querySelector('.collaboration-workspace-page-error'), null)
    shouldFail = false
    await click(buttonByText(mounted.container, '发送返修要求'))
    assert.deepEqual(calls.at(-1), { projectId: 'prj_demo000001', taskId, deliveryManifestId: 'dm_page000001', instruction })
    assert.equal(mounted.container.querySelector('textarea[aria-label="返修意见"]'), null)
  } finally { await mounted.unmount() }

  workspace.connection.userId = 'usr_worker000001'
  const member = await mount(<CollaborationWorkspacePage coordinatorClient={coordinatorClient} collaborationClient={collaborationClient} />)
  try {
    await click(member.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...member.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('返修任务')) as HTMLButtonElement)
    assert.equal(member.container.querySelector('[aria-label="负责人返修意见"] p')?.textContent, instruction)
  } finally { await member.unmount() }
})

const humanQuestionTaskId = moduleOneTaskId
const humanQuestionExecutionId = 'exe_human000001'
const humanQuestionPrompt = '请确认汇总使用全部样本还是只使用合格批次。'

function humanQuestionPageFixture(viewerUserId = 'usr_worker000001') {
  const workspace = confirmedPageWorkspace() as any
  workspace.connection.userId = viewerUserId
  const request = {
    schemaVersion: 1, revision: 2, createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    type: 'human_needed', humanRequestId: 'hrq_PageHumanRequest01', projectId: 'prj_demo000001',
    context: { scope: 'worker_execution', taskId: humanQuestionTaskId, executionId: humanQuestionExecutionId },
    targetUserId: 'usr_worker000001', requestedByAgentId: 'agt_demo000001', requiredAssurance: 'verified',
    prompt: humanQuestionPrompt, confirmableAction: null, status: 'pending', expiresAt: '2026-10-21T00:00:00.000Z'
  }
  workspace.projects[0].pendingHumanNeeded = [request]
  workspace.projects[0].tasks = [{
    task: {
      taskId: humanQuestionTaskId, projectId: 'prj_demo000001', title: '汇总说明', status: 'in_progress', revision: 4,
      currentExecutionId: humanQuestionExecutionId, currentExecutionState: 'needs_human'
    },
    delivery: null,
    executions: []
  }]
  const dashboard = {
    ...dashboardTask(humanQuestionTaskId, 'item_Test0001', '汇总说明', 'needs_human'),
    contractExecution: 'needs_human', executionId: humanQuestionExecutionId, blocker: null,
    assigneeUserId: 'usr_worker000001', assigneeDisplayName: 'Worker'
  }
  const calls: Call[] = []
  const state = { fail: false }
  const coordinatorClient = {
    readWorkspace: async () => workspace,
    answerHumanNeeded: async (input: Record<string, unknown>) => {
      calls.push({ id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer, input })
      if (state.fail) throw new Error('回答失败：连接中断')
      workspace.projects[0].pendingHumanNeeded = []
      return workspace
    }
  } as never
  return { workspace, request, dashboard, calls, state, coordinatorClient }
}

test('a historical closed Offer cannot hide the current Execution question in the mounted detail', async () => {
  const fixture = humanQuestionPageFixture()
  fixture.workspace.projects[0].offers = [
    { taskId: humanQuestionTaskId, taskOfferId: 'ofr_Historical00001', state: 'withdrawn', executionId: null, reassignmentTaskRevision: 2 },
    { taskId: humanQuestionTaskId, taskOfferId: 'ofr_Current0000001', state: 'accepted', executionId: humanQuestionExecutionId, reassignmentTaskRevision: null }
  ]
  const status = snapshot([fixture.dashboard]) as any
  status.projects = [{ projectId: 'prj_demo000001', tasks: [{ taskId: humanQuestionTaskId, taskOfferId: 'ofr_Historical00001', workerUserId: 'usr_worker000001', offerAvailability: { state: 'invalid', reason: 'offer_closed', canAccept: false, canReject: false, canDismiss: false } }] }]
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.coordinatorClient} collaborationClient={{ readStatus: async () => status } as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)
    const drawer = mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
    assert.match(drawer.textContent ?? '', /Agent 在等你回答/u)
    assert.ok(drawer.querySelector('input[placeholder="输入回答"]'))
    assert.doesNotMatch(drawer.textContent ?? '', /已失效/u)
  } finally { await mounted.unmount() }
})

test('the asked member reads the Agent question, answers it through the existing capability, and the inbox entry disappears', async () => {
  const fixture = humanQuestionPageFixture()
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([fixture.dashboard]) } as never} />)
  const drawer = () => mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
  try {
    await tick(); await tick()
    // My Work names the blocked task without requiring a Cloud notification.
    const myWork = mounted.container.querySelector('.collaboration-workspace-personal-list') as HTMLElement
    assert.match(myWork.textContent ?? '', /汇总说明/u)
    assert.match(myWork.textContent ?? '', /等待回答/u)
    assert.equal(mounted.container.querySelectorAll('.collaboration-workspace-personal-row').length, 1)

    await click(inboxNav(mounted.container))
    assert.match(inboxNav(mounted.container).textContent ?? '', /1/u)
    const inbox = mounted.container.querySelector('.collaboration-workspace-personal-list') as HTMLElement
    assert.match(inbox.textContent ?? '', /Agent 需要你回答：汇总说明/u)
    await click(inbox.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)

    assert.match(drawer().textContent ?? '', /Agent 在等你回答/u)
    assert.match(drawer().textContent ?? '', new RegExp(humanQuestionPrompt, 'u'))
    assert.match(mounted.container.querySelector('.collaboration-workspace-task-card.is-selected')?.textContent ?? '', /等待回答/u)

    const input = drawer().querySelector(`input[placeholder="输入回答"]`) as HTMLInputElement
    await setValue(input, '只使用合格批次')
    fixture.state.fail = true
    await click(buttonByText(drawer(), '发送'))
    assert.match(drawer().querySelector('[role="alert"]')?.textContent ?? '', /回答失败：连接中断/u)
    assert.equal((drawer().querySelector(`input[placeholder="输入回答"]`) as HTMLInputElement).value, '只使用合格批次', 'a rejected answer is kept for retry')

    fixture.state.fail = false
    await click(buttonByText(drawer(), '发送'))
    const answerInput = { projectId: 'prj_demo000001', humanRequestId: 'hrq_PageHumanRequest01', requestRevision: 2, answer: '只使用合格批次' }
    assert.deepEqual(fixture.calls.map((call) => ({ id: call.id, input: call.input })), [
      { id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer, input: answerInput },
      { id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer, input: answerInput }
    ])
    assert.equal(drawer().querySelector(`input[placeholder="输入回答"]`), null)
    assert.doesNotMatch(drawer().textContent ?? '', /Agent 在等你回答/u)

    await click(inboxNav(mounted.container))
    assert.equal(mounted.container.querySelectorAll('.collaboration-workspace-personal-row').length, 0)
    assert.equal(inboxNav(mounted.container).querySelector('b'), null, 'the inbox badge is cleared')
  } finally { await mounted.unmount() }
})

test('the Owner and other Members see a read-only waiting label without the question or an answer box', async () => {
  for (const viewer of ['usr_owner000001', 'usr_alice000001']) {
    const fixture = humanQuestionPageFixture(viewer)
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([fixture.dashboard]) } as never} />)
    const drawer = () => mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
    try {
      await tick(); await tick()
      assert.equal(inboxNav(mounted.container).querySelector('b'), null, 'another reader gets no answer todo')
      await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
      assert.match(mounted.container.querySelector('.collaboration-workspace-main-body')?.textContent ?? '', /等待成员回答/u)
      await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('汇总说明')) as HTMLButtonElement)
      assert.match(drawer().textContent ?? '', /Worker 的 Agent 在等成员回答/u)
      assert.doesNotMatch(drawer().textContent ?? '', new RegExp(humanQuestionPrompt, 'u'), 'the private question is not disclosed to other readers')
      assert.equal(drawer().querySelector(`input[placeholder="输入回答"]`), null)
      assert.equal(drawer().querySelector('.collaboration-workspace-answer-row'), null)
      assert.deepEqual(fixture.calls, [])
    } finally { await mounted.unmount() }
  }
})



test('assigned Member returns a task through the confirmed capability, requiring a reason and preserving failed input for retry', async () => {
  const fixture = humanQuestionPageFixture()
  const calls: Call[] = []
  let rejectReturn!: (error: Error) => void
  let fail = true
  const client = {
    ...createCollaborationRendererClient({ invoke: async (contract: { actionId: string }, input: unknown, options?: unknown) => {
      calls.push({ id: contract.actionId, input, options })
      if (fail) return new Promise((_, reject) => { rejectReturn = reject })
      fixture.dashboard.contractExecution = 'failed'
      return { returned: true }
    } } as never),
    readStatus: async () => snapshot([fixture.dashboard])
  }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.coordinatorClient} collaborationClient={client} />)
  const drawer = () => mounted.container.querySelector('[aria-label="任务详情"]') as HTMLElement
  try {
    await click(inboxNav(mounted.container))
    await click(mounted.container.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)
    await click(buttonByText(drawer(), '无法完成，退回任务'))
    const reason = inputByLabel(drawer(), '退回原因') as HTMLTextAreaElement
    assert.equal(reason.required, true)
    assert.equal(reason.maxLength, 500)
    assert.equal(buttonByText(drawer(), '确认退回任务').disabled, true)
    await setValue(reason, '   ')
    await click(buttonByText(drawer(), '确认退回任务'))
    assert.equal(calls.length, 0)
    await setValue(reason, '  模型服务不可用  ')
    const confirm = buttonByText(drawer(), '确认退回任务')
    await act(async () => { confirm.click(); confirm.click(); await tick() })
    assert.equal(calls.length, 1)
    assert.equal(reason.disabled, true)
    assert.equal(buttonByText(drawer(), '取消').disabled, true)
    await act(async () => { rejectReturn(new Error('退回失败，请重试')); await tick(); await tick() })
    assert.equal(reason.value, '  模型服务不可用  ')
    assert.match(drawer().querySelector('[role="alert"]')?.textContent ?? '', /退回失败，请重试/u)
    fail = false
    await click(buttonByText(drawer(), '确认退回任务'))
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1], {
      id: COLLABORATION_CAPABILITY_IDS.taskReturn,
      input: { projectId: 'prj_demo000001', taskId: humanQuestionTaskId, executionId: humanQuestionExecutionId, reason: '模型服务不可用' },
      options: { approval: { mode: 'confirmation' } }
    })
    assert.match(drawer().textContent ?? '', /待重新派发/u)
    assert.equal(drawer().querySelector('[aria-label="退回原因"]'), null)
    assert.doesNotMatch(drawer().textContent ?? '', /无法完成，退回任务/u)
    await click(inboxNav(mounted.container))
    assert.equal(mounted.container.querySelectorAll('.collaboration-workspace-personal-row').length, 0,
      'an unanswered question on the failed execution is history, not an answer todo')
  } finally { await mounted.unmount() }
})

test('return task is visible only to the assigned Member with a nonterminal execution', async () => {
  for (const state of ['accepted_awaiting_runtime', 'running', 'needs_human', 'failed', 'completed', 'cancelled']) {
    for (const userId of ['usr_worker000001', 'usr_owner000001', 'usr_alice000001']) {
      const fixture = humanQuestionPageFixture(userId)
      fixture.dashboard.contractExecution = state
      const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.coordinatorClient} collaborationClient={{ readStatus: async () => snapshot([fixture.dashboard]) } as never} />)
      try {
        await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
        await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('汇总说明')) as HTMLButtonElement)
        const visible = mounted.container.textContent?.includes('无法完成，退回任务') ?? false
        assert.equal(visible, userId === 'usr_worker000001' && ['accepted_awaiting_runtime', 'running', 'needs_human'].includes(state), `${userId}: ${state}`)
      } finally { await mounted.unmount() }
    }
  }
})


for (const [code, message, reason] of [
  ['upstream_unavailable', 'Upstream returned HTTP 502', '模型服务暂时不可用'],
  ['model_capacity', 'Upstream returned HTTP 429', '模型服务当前繁忙'],
  ['runtime_cancelled', 'Agent turn cancelled.', '本轮执行已取消'],
  ['runtime_interrupted', 'Agent turn interrupted.', '本轮执行已中断']
]) {
test(`${code} Task offers the shared fresh-input action and healthy Task return stays collapsed`, async () => {
  const fixture = humanQuestionPageFixture()
  fixture.workspace.projects[0].pendingHumanNeeded = []
  fixture.workspace.projects[0].tasks[0].task.currentExecutionState = 'running'
  fixture.dashboard.contractExecution = 'running'
  const status = snapshot([fixture.dashboard]) as any
  const local = { taskId: humanQuestionTaskId, executionId: humanQuestionExecutionId,
    workerUserId: 'usr_worker000001', state: 'running', hasDedicatedSession: false,
    failure: { code, message, retryable: code === 'upstream_unavailable' || code === 'model_capacity', retryState: 'available' },
    reexecutionInputId: 'failed-original' }
  status.projects = [{ projectId: 'prj_demo000001', tasks: [local] }]
  const sent: unknown[] = []
  let finish!: (value: { ok: true }) => void
  const pending = new Promise<{ ok: true }>((resolve) => { finish = resolve })
  const opened: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.coordinatorClient}
    collaborationClient={{ readStatus: async () => status, openTaskSession: async (input: unknown) => {
      opened.push(input); return { sessionId: 'worker-session', threadId: 'worker-thread', runtimeId: 'codex', opened: true }
    } } as never}
    workbench={{ sendMessage: async (input: unknown) => { sent.push(input); return pending } } as never} />)
  const drawer = () => mounted.container.querySelector('.collaboration-workspace-task-drawer') as HTMLElement
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-personal-row') as HTMLButtonElement)
    assert.match(drawer().textContent ?? '', /执行失败/u)
    assert.match(drawer().textContent ?? '', new RegExp(reason, 'u'))
    assert.doesNotMatch(drawer().textContent ?? '', /HTTP 502|This input needs/u)
    const button = buttonByText(drawer(), '重新执行')
    await act(async () => { button.click(); button.click(); await tick() })
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0], { sessionId: 'worker-thread', reexecuteInput: { runtimeId: 'codex', clientDirectiveId: 'failed-original' } })
    assert.deepEqual(opened[0], { projectId: 'prj_demo000001', taskId: humanQuestionTaskId, executionId: humanQuestionExecutionId })
    assert.equal(button.disabled, true)
    assert.equal(buttonByText(drawer(), '无法完成，退回任务').disabled, true)
    delete (local as Partial<typeof local>).failure
    delete (local as Partial<typeof local>).reexecutionInputId
    await act(async () => { finish({ ok: true }); await tick(); await tick() })
    assert.equal(drawer().querySelector('[aria-label="执行失败"]'), null)
    assert.equal(drawer().querySelector('[aria-label="无法继续执行"]'), null)
    assert.equal(drawer().querySelector('details')?.hasAttribute('open'), false)
    assert.match(drawer().querySelector('summary')?.textContent ?? '', /遇到问题/u)
  } finally { await mounted.unmount() }
})
}


test('member explanation autosaves locally and submission freezes the edited explanation through one confirmed target', async () => {
  const fixture = deliveryPageFixture()
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={fixture.client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await setValue(mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement, '我检查过数据边界并补充了结论。')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); await tick() })
    assert.equal(fixture.delivery.draft.summary, '我检查过数据边界并补充了结论。')
    assert.match(mounted.container.querySelector('[data-testid="delivery-saved"]')?.textContent ?? '', /已保存/u)
    await confirmDelivery(mounted.container)
    assert.equal(fixture.delivery.candidate.bundle.summary, '我检查过数据边界并补充了结论。')
    assert.equal(fixture.calls.filter((call) => call.id === 'submitWorkerDelivery').length, 1)
  } finally { await mounted.unmount() }
})

test('empty member explanation autosaves but cannot open submission confirmation', async () => {
  const fixture = deliveryPageFixture()
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={fixture.client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await setValue(mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement, '')
    assert.equal((mounted.container.querySelector('[data-testid="delivery-submit"]') as HTMLButtonElement).disabled, true)
    assert.match(mounted.container.textContent ?? '', /请填写结果说明/u)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); await tick() })
    assert.equal(fixture.delivery.draft.summary, '')
    assert.equal(fixture.calls.some((call) => call.id === 'submitWorkerDelivery'), false)
  } finally { await mounted.unmount() }
})

test('autosave rebases a member explanation on a confirmed AI draft revision conflict and keeps the new AI suggestion', async () => {
  const fixture = deliveryPageFixture()
  let conflicting = true
  const client = { ...fixture.client, saveWorkerDeliveryDraft: async (input: any) => {
    if (conflicting) {
      conflicting = false
      fixture.delivery.draft = { ...fixture.delivery.draft, revision: 2, aiSummary: 'AI 新补充的说明', sourceRound: 2, changed: true }
      throw new Error('草稿已有更新')
    }
    assert.equal(input.expectedDraftRevision, 2)
    return fixture.client.saveWorkerDeliveryDraft(input)
  } }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await setValue(mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement, '成员自己的说明')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); await tick() })
    assert.equal((mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement).value, '成员自己的说明')
    assert.equal(fixture.delivery.draft.summary, '成员自己的说明')
    assert.match(mounted.container.querySelector('[data-testid="delivery-ai-update"]')?.textContent ?? '', /AI 新补充的说明/u)
    assert.match(mounted.container.querySelector('[data-testid="delivery-saved"]')?.textContent ?? '', /已保存/u)
  } finally { await mounted.unmount() }
})

test('manual editing within the AI replacement autosave debounce preserves the authored explanation', async () => {
  const fixture = deliveryPageFixture()
  fixture.delivery.draft = { ...fixture.delivery.draft, summary: '成员原来的说明', summaryEdited: true, aiSummary: 'AI 第一版说明', changed: true }
  const client = { ...fixture.client, saveWorkerDeliveryDraft: async (input: Parameters<typeof fixture.client.saveWorkerDeliveryDraft>[0]) => {
    fixture.calls.push({ id: 'saveWorkerDeliveryDraft', input })
    const previous = fixture.delivery.draft
    fixture.delivery.draft = { ...previous, revision: previous.revision + 1,
      summary: input.aiSummaryDecision === 'replace' ? previous.aiSummary ?? input.summary : input.summary,
      summaryEdited: input.aiSummaryDecision !== 'replace',
      aiSummary: input.aiSummaryDecision ? null : previous.aiSummary }
    return { delivery: structuredClone(fixture.delivery) }
  } }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-replace-summary"]') as HTMLButtonElement)
    await setValue(mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement, '用户在替换后继续手工编辑')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); await tick() })
    assert.equal(fixture.delivery.draft.summary, '用户在替换后继续手工编辑')
    assert.equal(fixture.delivery.draft.summaryEdited, true)
    assert.equal(fixture.delivery.draft.aiSummary, null)
    assert.equal((fixture.calls.find((call) => call.id === 'saveWorkerDeliveryDraft')?.input as { aiSummaryDecision?: string }).aiSummaryDecision, 'keep')
    assert.equal((mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement).value, '用户在替换后继续手工编辑')
    assert.match(mounted.container.querySelector('[data-testid="delivery-saved"]')?.textContent ?? '', /已保存/u)
  } finally { await mounted.unmount() }
})

test('a newer AI suggestion arriving during replacement save stays unresolved without overwriting the accepted text', async () => {
  const fixture = deliveryPageFixture()
  fixture.delivery.draft = { ...fixture.delivery.draft, summary: '成员原来的说明', summaryEdited: true, aiSummary: '刚刚确认的 AI 说明', changed: true }
  let conflicting = true
  const client = { ...fixture.client, saveWorkerDeliveryDraft: async (input: Parameters<typeof fixture.client.saveWorkerDeliveryDraft>[0]) => {
    if (conflicting) {
      conflicting = false
      fixture.delivery.draft = { ...fixture.delivery.draft, revision: 2, aiSummary: '确认后新到的 AI 说明', sourceRound: 2 }
      throw new Error('草稿已有更新')
    }
    fixture.calls.push({ id: 'saveWorkerDeliveryDraft', input })
    const previous = fixture.delivery.draft
    fixture.delivery.draft = { ...previous, revision: previous.revision + 1,
      summary: input.aiSummaryDecision === 'replace' ? previous.aiSummary ?? input.summary : input.summary,
      summaryEdited: input.aiSummaryDecision !== 'replace',
      aiSummary: input.aiSummaryDecision ? null : previous.aiSummary }
    return { delivery: structuredClone(fixture.delivery) }
  } }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-replace-summary"]') as HTMLButtonElement)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); await tick() })
    assert.equal(fixture.delivery.draft.summary, '刚刚确认的 AI 说明')
    assert.equal(fixture.delivery.draft.aiSummary, '确认后新到的 AI 说明')
    assert.equal(fixture.delivery.draft.summaryEdited, true)
    assert.equal((mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement).value, '刚刚确认的 AI 说明')
    assert.match(mounted.container.querySelector('[data-testid="delivery-ai-update"]')?.textContent ?? '', /确认后新到的 AI 说明/u)
  } finally { await mounted.unmount() }
})

test('submission refuses an explanation refreshed after confirmation even when all file digests are unchanged', async () => {
  const fixture = deliveryPageFixture()
  let updateOnRead = false
  const client = { ...fixture.client, readWorkerDelivery: async (input: unknown) => {
    if (updateOnRead) {
      updateOnRead = false
      fixture.delivery.draft = { ...fixture.delivery.draft, revision: fixture.delivery.draft.revision + 1, summary: 'AI 刚完成的新说明', changed: true }
      fixture.delivery.confirmationTarget = { ...fixture.target, bundleDigest: 'c'.repeat(64) }
    }
    return fixture.client.readWorkerDelivery(input)
  } }
  const originalOutputs = structuredClone(fixture.delivery.draft.outputs)
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-submit"]') as HTMLButtonElement)
    assert.equal(mounted.container.querySelector('[data-testid="delivery-confirm-summary"]')?.textContent, 'README 已生成并验证')
    updateOnRead = true
    await click(mounted.container.querySelector('[data-testid="delivery-submit-confirm"]') as HTMLButtonElement)
    assert.equal(fixture.calls.some((call) => call.id === 'submitWorkerDelivery'), false)
    assert.deepEqual(fixture.delivery.draft.outputs, originalOutputs)
    assert.match(mounted.container.textContent ?? '', /结果说明有新改动，请检查后再次提交。/u)
    assert.equal((mounted.container.querySelector('[data-testid="delivery-summary"]') as HTMLTextAreaElement).value, 'AI 刚完成的新说明')
    assert.equal(mounted.container.querySelector('[data-testid="delivery-confirm-summary"]')?.textContent, 'AI 刚完成的新说明')
  } finally { await mounted.unmount() }
})


test('production draft persists explicit materials with explanation through the same CAS save before submission', async () => {
  const fixture = deliveryPageFixture()
  const material = { relativePath: 'data/observations.csv', fileName: 'observations.csv', mediaType: 'text/csv', byteCount: 128, source: 'member', role: 'member', sha256: 'c'.repeat(64) }
  fixture.delivery.draft.outputs[0] = { ...fixture.delivery.draft.outputs[0], relativePath: 'README.md', role: 'declared', source: 'ai' }
  fixture.delivery.draft.selectedMaterials = []
  const client = { ...fixture.client,
    listWorkerDeliveryMaterials: async (input: unknown) => { fixture.calls.push({ id: 'listWorkerDeliveryMaterials', input }); return { files: [material], nextCursor: null } },
    saveWorkerDeliveryDraft: async (input: any) => {
      fixture.calls.push({ id: 'saveWorkerDeliveryDraft', input })
      fixture.delivery.draft = { ...fixture.delivery.draft, summary: input.summary, selectedMaterials: input.selectedMaterials ?? fixture.delivery.draft.selectedMaterials,
        outputs: [fixture.delivery.draft.outputs[0], ...(input.selectedMaterials?.length ? [material] : [])], revision: fixture.delivery.draft.revision + 1 }
      return { delivery: structuredClone(fixture.delivery) }
    }
  }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    const add = mounted.container.querySelector('[data-testid="delivery-add-materials"]') as HTMLButtonElement
    assert.ok(add, 'real draft exposes the material capability')
    await click(add)
    await click(mounted.container.querySelector('[data-testid="delivery-material-checkbox"]') as unknown as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-material-confirm"]') as HTMLButtonElement)
    assert.match(mounted.container.querySelector('[data-testid="delivery-additional-files"]')?.textContent ?? '', /observations.csv.*我添加的/su)
    await confirmDelivery(mounted.container)
    const saves = fixture.calls.filter((call) => call.id === 'saveWorkerDeliveryDraft')
    assert.deepEqual((saves.at(-1)?.input as any).selectedMaterials, [{ relativePath: material.relativePath }])
    assert.equal(fixture.calls.filter((call) => call.id === 'submitWorkerDelivery').length, 1)
  } finally { await mounted.unmount() }
})


test('production material import uses exact standard Session and retains partial successes, removal is durable', async () => {
  const fixture = deliveryPageFixture()
  const path = '.sciforge/uploads/session_delivery000001/001-receipt-observations.csv'
  const material = { relativePath: path, fileName: 'observations.csv', mediaType: 'text/csv', byteCount: 4, source: 'member', role: 'member', sha256: 'c'.repeat(64) }
  fixture.delivery.draft.selectedMaterials = []
  const client = { ...fixture.client,
    listWorkerDeliveryMaterials: async () => ({ files: [], nextCursor: null, truncated: false }),
    saveWorkerDeliveryDraft: async (input: any) => {
      fixture.calls.push({ id: 'saveWorkerDeliveryDraft', input })
      fixture.delivery.draft = { ...fixture.delivery.draft, selectedMaterials: input.selectedMaterials ?? fixture.delivery.draft.selectedMaterials,
        outputs: [fixture.delivery.draft.outputs[0], ...(input.selectedMaterials?.length ? [material] : [])], revision: fixture.delivery.draft.revision + 1 }
      return { delivery: structuredClone(fixture.delivery) }
    }
  }
  const imports: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never}
    workspace={{ importAttachments: async (input: any) => {
      imports.push(input)
      if (input.files[0].name === 'broken.csv') throw new Error('文件复制失败')
      return [{ relativePath: path, name: 'observations.csv', mediaType: 'text/csv', byteCount: 4 }]
    }} as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-add-materials"]') as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-material-upload-tab"]') as HTMLButtonElement)
    const input = mounted.container.querySelector('[data-testid="delivery-material-file-input"]') as HTMLInputElement
    assert.match(input.accept, /\.csv/u)
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new browserWindow.File(['data'], 'observations.csv'), new browserWindow.File(['oops'], 'broken.csv')] })
      input.dispatchEvent(new Event('change', { bubbles: true })); await tick(); await tick()
    })
    assert.equal(imports.length, 2)
    assert.deepEqual((imports[0] as any).runtimeId, 'codex')
    assert.deepEqual((imports[0] as any).threadId, 'session_delivery000001')
    assert.match(mounted.container.querySelector('[data-testid="delivery-material-upload-error"]')?.textContent ?? '', /broken.csv.*已选择的资料已保留/su)
    assert.match(mounted.container.querySelector('[data-testid="delivery-material-uploaded-files"]')?.textContent ?? mounted.container.textContent ?? '', /observations.csv.*已勾选/su)
    await click(mounted.container.querySelector('[data-testid="delivery-material-confirm"]') as HTMLButtonElement)
    assert.doesNotMatch(mounted.container.querySelector('[data-testid="delivery-additional-files"]')?.textContent ?? '', /sciforge|001-receipt/u)
    await click(mounted.container.querySelector('[data-testid="delivery-file-remove"]') as HTMLButtonElement)
    await confirmDelivery(mounted.container)
    assert.deepEqual((fixture.calls.filter((call) => call.id === 'saveWorkerDeliveryDraft').at(-1)?.input as any).selectedMaterials, [])
    assert.equal(fixture.calls.filter((call) => call.id === 'submitWorkerDelivery').length, 1)
  } finally { await mounted.unmount() }
})

test('production selected material preview flushes selection then opens exact workspace-relative bytes', async () => {
  const fixture = deliveryPageFixture()
  const material = { relativePath: 'data/README.md', fileName: 'README.md', mediaType: 'text/markdown', byteCount: 128, source: 'member', role: 'member', sha256: 'c'.repeat(64) }
  fixture.delivery.draft.selectedMaterials = []
  const client = { ...fixture.client,
    listWorkerDeliveryMaterials: async () => ({ files: [material], nextCursor: null, truncated: false }),
    saveWorkerDeliveryDraft: async (input: any) => {
      fixture.calls.push({ id: 'saveWorkerDeliveryDraft', input })
      fixture.delivery.draft = { ...fixture.delivery.draft, selectedMaterials: input.selectedMaterials, outputs: [fixture.delivery.draft.outputs[0], material], revision: fixture.delivery.draft.revision + 1 }
      return { delivery: structuredClone(fixture.delivery) }
    }
  }
  const previews: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={client as never} workspacePreview={{ open: (target) => previews.push(target) }} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-add-materials"]') as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-material-checkbox"]') as unknown as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-material-confirm"]') as HTMLButtonElement)
    await click(mounted.container.querySelector('[data-testid="delivery-additional-files"] [data-testid="delivery-file-preview"]') as HTMLButtonElement)
    assert.deepEqual(previews, [{ path: material.relativePath, sessionId: 'session_delivery000001', mimeType: material.mediaType, kind: 'file', integrity: { algorithm: 'sha256', expectedDigest: material.sha256 } }])
    assert.deepEqual((fixture.calls.find((call) => call.id === 'saveWorkerDeliveryDraft')?.input as any).selectedMaterials, [{ relativePath: material.relativePath }])
  } finally { await mounted.unmount() }
})

test('missing selected material stays visible and removable after reopening the production draft', async () => {
  const fixture = deliveryPageFixture()
  fixture.delivery.draft.selectedMaterials = [{ relativePath: 'data/missing.csv' }]
  fixture.delivery.draft.materialError = '文件 missing.csv 不可用，请移除后重新选择。'
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={{ readWorkspace: async () => fixture.workspace } as never} collaborationClient={fixture.client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    const additional = mounted.container.querySelector('[data-testid="delivery-additional-files"]')!
    assert.match(additional.textContent ?? '', /missing.csv.*文件不可用/su)
    assert.equal((additional.querySelector('[data-testid="delivery-file-preview"]') as HTMLButtonElement).disabled, true)
    assert.equal((mounted.container.querySelector('[data-testid="delivery-submit"]') as HTMLButtonElement).disabled, true)
    await click(additional.querySelector('[data-testid="delivery-file-remove"]') as HTMLButtonElement)
    assert.match(mounted.container.querySelector('[data-testid="delivery-materials-empty"]')?.textContent ?? '', /还没有附加资料/u)
  } finally { await mounted.unmount() }
})

test('sealed PDF preview delegates the exact authorized resource to the generic Host without reading bytes in the domain', async () => {
  const fixture = sealedDeliveryPreviewFixture({ mediaType: 'application/pdf', fileName: 'report.pdf' })
  const opened: unknown[] = []
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.client as never} collaborationClient={{ readStatus: async () => fixture.status() } as never} resourcePreview={{ open: (target: unknown) => { opened.push(target); return true } }} />)
  try {
    const files = await openFilesPage(mounted.container)
    await click(previewRow(files, 'report.pdf').querySelector('button') as HTMLButtonElement)
    assert.deepEqual(opened, [{ resource: { token: 'obj_Readme0001' }, file: { name: 'report.pdf', mimeType: 'application/pdf', size: 42 } }])
    assert.equal(fixture.calls.ranges.length, 0)
    assert.equal(fixture.calls.describes, 0)
    assert.equal(mounted.container.querySelector('[aria-label="交付文件预览"]'), null)
  } finally { await mounted.unmount() }
})

test('generic sealed preview rejects object metadata drift before handing a resource to the Host', async () => {
  for (const mismatch of [{ sha256: 'b'.repeat(64) }, { byteCount: 43 }, { mediaType: 'application/pdf' }, { objectId: 'obj_Different0001' }, { projectId: 'prj_Different0001' }, { revision: 2 }]) {
    const fixture = sealedDeliveryPreviewFixture()
    const client = { ...fixture.client, openDeliveryObject: async (input: Parameters<typeof fixture.client.openDeliveryObject>[0]) => {
      const result = await fixture.client.openDeliveryObject(input)
      return { ...result, object: { ...result.object, ...mismatch } }
    } }
    const opened: unknown[] = []
    const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={client as never} collaborationClient={{ readStatus: async () => fixture.status() } as never} resourcePreview={{ open: (target) => { opened.push(target); return true } }} />)
    try {
      const files = await openFilesPage(mounted.container)
      await click(previewRow(files, 'README.md').querySelector('button') as HTMLButtonElement)
      assert.equal(opened.length, 0)
      assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /预览文件与已提交快照不一致/u)
      assert.equal(fixture.calls.ranges.length, 0)
    } finally { await mounted.unmount() }
  }
})

test('unavailable generic preview reports an inline error and opens no parallel viewer', async () => {
  const fixture = sealedDeliveryPreviewFixture()
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={fixture.client as never} collaborationClient={{ readStatus: async () => fixture.status() } as never} />)
  try {
    const files = await openFilesPage(mounted.container)
    await click(previewRow(files, 'README.md').querySelector('button') as HTMLButtonElement)
    assert.match(mounted.container.querySelector('[role="alert"]')?.textContent ?? '', /文件预览暂不可用/u)
    assert.equal(fixture.calls.open.length, 0)
    assert.equal(mounted.container.querySelector('[aria-label="交付文件预览"]'), null)
  } finally { await mounted.unmount() }
})

test('offline Owner review cannot enqueue adoption or revision and becomes available after reconnect', async () => {
  const fixture = deliveryPageFixture('usr_owner000001')
  fixture.task.primaryAction = 'adopt_delivery'
  fixture.task.delivery = 'sealed'
  fixture.task.workflowColumn = 'waiting_result_confirm'
  fixture.workspace.projects[0].tasks = [{ task: { taskId: fixture.task.taskId },
    delivery: { manifest: { deliveryManifestId: 'dm_offline000001', objects: [], sealedAt: '2026-10-18T00:00:00.000Z' } }, executions: [] }]
  let online = true
  let writes = 0
  const coordinator = { readWorkspace: async () => online ? fixture.workspace : {
    connection: { state: 'cloud_unavailable', reason: 'Network unavailable' }, observedAt: '2026-10-27T00:00:00.000Z', availableWorkerUsers: [], projects: []
  }, decideAdoption: async () => { writes += 1 }, requestRevision: async () => { writes += 1 } }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinator as never} collaborationClient={fixture.client as never} />)
  try {
    await click(mounted.container.querySelector('.collaboration-workspace-project-row') as HTMLButtonElement)
    await click([...mounted.container.querySelectorAll('.collaboration-workspace-task-card-button')].find((button) => button.textContent?.includes('本机交付任务')) as HTMLButtonElement)
    assert.ok(buttonByText(mounted.container, '采纳交付'))
    assert.ok(buttonByText(mounted.container, '要求返修'))
    online = false
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.equal([...mounted.container.querySelectorAll('button')].some((button) => ['采纳交付', '要求返修'].includes(button.textContent ?? '')), false)
    assert.equal(writes, 0)
    online = true
    await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick() })
    assert.ok(buttonByText(mounted.container, '采纳交付'))
    assert.equal(writes, 0)
  } finally { await mounted.unmount() }
})

test('recovery and incomplete lists retain the selected Project until an explicit user switch', async () => {
  const oldProject = switchingProject('prj_recoveryOld01', '旧项目', ['usr_owner000001'])
  const selected = switchingProject('prj_recoveryCurrent01', '当前项目', ['usr_owner000001'])
  let mode: 'ready' | 'recovering' | 'missing' = 'ready'
  const requested: Array<string | undefined> = []
  const coordinator = { readWorkspace: async (input: { projectId?: string } = {}) => {
    requested.push(input.projectId)
    return {
      connection: mode === 'recovering'
        ? { state: 'cloud_unavailable', reasonCode: 'authority_unverified', reason: 'Desktop Device authority could not be verified.' }
        : { state: 'ready', userId: 'usr_owner000001', deviceId: 'dev_demo000001' },
      observedAt: '2026-10-27T00:00:00.000Z', availableWorkerUsers: [],
      focusedProjectId: input.projectId,
      projects: mode === 'recovering' ? [] : mode === 'missing' ? [oldProject] : [oldProject, selected]
    }
  } }
  const mounted = await mount(<CollaborationWorkspacePage coordinatorClient={coordinator as never} collaborationClient={{ readStatus: async () => snapshot([], []) } as never} />)
  const row = (name: string) => [...mounted.container.querySelectorAll('.collaboration-workspace-project-row')]
    .find((entry) => entry.textContent?.includes(name)) as HTMLButtonElement
  const refresh = async () => { await act(async () => { window.dispatchEvent(new window.Event('focus')); await tick(); await tick(); await tick() }) }
  try {
    await click(row('当前项目'))
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /当前项目/u)
    const afterSelection = requested.length
    mode = 'recovering'
    await refresh()
    mode = 'missing'
    await refresh()
    assert.doesNotMatch(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /旧项目/u)
    mode = 'ready'
    await refresh()
    assert.ok(requested.slice(afterSelection).every((id) => id === selected.project.projectId))
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /当前项目/u)
    assert.equal(row('当前项目').getAttribute('aria-current'), 'page')
    mode = 'recovering'
    await refresh()
    assert.match(mounted.container.textContent ?? '', /正在重新连接/u)
    assert.doesNotMatch(mounted.container.textContent ?? '', /Desktop Device authority could not be verified/u)
    mode = 'ready'
    await refresh()
    await click(row('旧项目'))
    assert.match(mounted.container.querySelector('.collaboration-workspace-project-header')?.textContent ?? '', /旧项目/u)
  } finally { await mounted.unmount() }
})
