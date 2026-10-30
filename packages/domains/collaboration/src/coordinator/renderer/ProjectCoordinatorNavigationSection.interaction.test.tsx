import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import {
  after,
  before,
  test
} from 'node:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { getI18n, setI18n } from 'react-i18next'

import type {
  ProjectCoordinatorPendingActivation,
  ProjectCoordinatorSessionProjection,
  ProjectCoordinatorWorkspace
} from '../contract.js'
import {
  ProjectCoordinatorNavigationSection,
  type ProjectCoordinatorNavigationSectionProps
} from './ProjectCoordinatorNavigationSection.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'

const observedAt = '2026-08-29T00:00:00.000Z'
const pendingActivation: ProjectCoordinatorPendingActivation = {
  activationRequestId: 'pca_ActivationRequest01',
  projectId: 'prj_Project000001',
  coordinatorSession: {
    runtimeId: 'codex',
    threadId: 'thread-coordinator'
  },
  requestedAt: observedAt
}

const browserWindow = new Window({ url: 'https://sciforge.test/' })
const globalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()
const previousI18n = getI18n()

before(() => {
  setI18n({
    isInitialized: true,
    language: 'en',
    languages: ['en'],
    options: {
      defaultNS: 'common',
      ns: ['common'],
      react: { bindI18n: '', bindI18nStore: '', useSuspense: false }
    },
    getFixedT: () => (key: string | readonly string[]) => (
      typeof key === 'string' ? key : key.at(-1) ?? ''
    ),
    hasLoadedNamespace: () => true
  } as never)
  const browserGlobals: Readonly<Record<string, unknown>> = {
    window: browserWindow,
    self: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    SVGElement: browserWindow.SVGElement,
    Event: browserWindow.Event,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    requestAnimationFrame: browserWindow.requestAnimationFrame.bind(browserWindow),
    cancelAnimationFrame: browserWindow.cancelAnimationFrame.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true
  }
  for (const [key, value] of Object.entries(browserGlobals)) {
    globalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})

after(() => {
  setI18n(previousI18n)
  for (const [key, descriptor] of globalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  browserWindow.close()
})

test('pending Project activation waits for the exact runtime and thread before activation and ack', async () => {
  let activationPending = true
  const acknowledgements: Array<Readonly<{ activationRequestId: string }>> = []
  const activations: Array<Readonly<{ projectId: string; sessionId: string }>> = []
  const client = clientFixture({
    readSessionOwnership: async () => [],
    readSessionProjection: async () => projection(activationPending),
    acknowledgeProjectActivation: async (input) => {
      acknowledgements.push(input)
      activationPending = false
    }
  })
  const mounted = await mountNavigation({
    client,
    context: navigationContext([
      session('thread-coordinator', 'claude-code'),
      session('thread-other', 'codex')
    ]),
    onCreateProject: () => undefined,
    onOpenProject: () => undefined,
    onActivateProject: (projectId, sessionId) => activations.push({ projectId, sessionId })
  })

  try {
    assert.equal(activations.length, 0)
    assert.equal(acknowledgements.length, 0)

    await mounted.rerender({
      client,
      context: navigationContext([
        session('thread-coordinator', 'claude-code'),
        session('thread-other', 'codex'),
        session('thread-coordinator', 'codex')
      ]),
      onCreateProject: () => undefined,
      onOpenProject: () => undefined,
      onActivateProject: (projectId, sessionId) => activations.push({ projectId, sessionId })
    })

    assert.deepEqual(activations, [{
      projectId: pendingActivation.projectId,
      sessionId: pendingActivation.coordinatorSession.threadId
    }])
    assert.deepEqual(acknowledgements, [{
      activationRequestId: pendingActivation.activationRequestId
    }])
  } finally {
    await mounted.unmount()
  }
})

test('a failed Project activation ack remains retryable after an immediate catalog refresh', async () => {
  let activationPending = true
  const acknowledgements: Array<Readonly<{ activationRequestId: string }>> = []
  const activations: Array<Readonly<{ projectId: string; sessionId: string }>> = []
  const client = clientFixture({
    readSessionOwnership: async () => [],
    readSessionProjection: async () => projection(activationPending),
    acknowledgeProjectActivation: async (input) => {
      acknowledgements.push(input)
      if (acknowledgements.length === 1) throw new Error('Transient ack failure.')
      activationPending = false
    }
  })
  const onActivateProject = (projectId: string, sessionId: string) => {
    activations.push({ projectId, sessionId })
  }
  const mounted = await mountNavigation({
    client,
    context: navigationContext([session('thread-coordinator', 'codex')]),
    onCreateProject: () => undefined,
    onOpenProject: () => undefined,
    onActivateProject
  })

  try {
    assert.equal(acknowledgements.length, 1)

    await mounted.rerender({
      client,
      context: navigationContext([
        session('thread-coordinator', 'codex', '2026-08-29T00:00:01.000Z')
      ]),
      onCreateProject: () => undefined,
      onOpenProject: () => undefined,
      onActivateProject
    })

    assert.deepEqual(acknowledgements, [
      { activationRequestId: pendingActivation.activationRequestId },
      { activationRequestId: pendingActivation.activationRequestId }
    ])
    assert.equal(activations.length, 1)
  } finally {
    await mounted.unmount()
  }
})

function navigationContext(
  sessions: ProjectCoordinatorNavigationSectionProps['context']['sessions']
): ProjectCoordinatorNavigationSectionProps['context'] {
  return {
    active: true,
    className: 'fixture-navigation',
    session: { id: 'source-session' },
    sessions,
    selectSession: () => undefined
  }
}

function session(
  id: string,
  runtimeId: string,
  updatedAt = observedAt
): ProjectCoordinatorNavigationSectionProps['context']['sessions'][number] {
  return {
    id,
    runtimeId,
    title: `${runtimeId}:${id}`,
    updatedAt
  }
}

function projection(pending: boolean): ProjectCoordinatorSessionProjection {
  return {
    schemaVersion: 2,
    observedAt,
    bindings: [],
    suppressedSessions: [],
    pendingActivations: pending ? [pendingActivation] : []
  }
}

function clientFixture(overrides: Pick<
  ProjectCoordinatorRendererClient,
  'acknowledgeProjectActivation' | 'readSessionProjection'
> & Partial<Pick<ProjectCoordinatorRendererClient, 'readSessionOwnership'>>): ProjectCoordinatorRendererClient {
  const unused = async (): Promise<never> => {
    throw new Error('Unused Project Coordinator capability.')
  }
  return {
    readWorkspace: async () => ({
      connection: { state: 'identity_required' },
      observedAt,
      availableWorkerUsers: [],
      projects: []
    }),
    createProject: unused,
    deleteProject: unused,
    acknowledgeProjectActivation: overrides.acknowledgeProjectActivation,
    readSessionOwnership: overrides.readSessionOwnership ?? (async () => []),
    readSessionProjection: overrides.readSessionProjection,
    openDeliveryObject: unused,
    describeDeliveryObject: unused,
    readDeliveryObjectRange: unused,
    readDelivery: unused,
    listDrive: unused,
    decideAdoption: unused,
    requestRevision: unused,
    publishResult: unused,
    saveRequirementsDraft: unused,
    completeRequirements: unused,
    confirmRequirements: unused,
    withdrawTaskOffer: unused,
    extendTaskOffer: unused,
    reassignTaskOffer: unused,
    addMember: unused,
    acceptInvitation: unused,
    removeMember: unused,
    createHumanNeeded: unused,
    answerHumanNeeded: unused,
    transferCoordinator: unused,
    completeProject: unused
  }
}

async function mountNavigation(
  props: ProjectCoordinatorNavigationSectionProps
): Promise<Readonly<{
  root: Root
  container: HTMLElement
  rerender: (nextProps: ProjectCoordinatorNavigationSectionProps) => Promise<void>
  unmount: () => Promise<void>
}>> {
  const { createRoot } = await import('react-dom/client')
  const container = browserWindow.document.createElement('div') as unknown as HTMLElement
  browserWindow.document.body.append(container as never)
  const root = createRoot(container)
  const render = async (nextProps: ProjectCoordinatorNavigationSectionProps) => {
    await act(async () => {
      root.render(<ProjectCoordinatorNavigationSection {...nextProps} />)
      await tick()
      await tick()
    })
    await settleReact()
  }
  await render(props)
  return {
    root,
    container,
    rerender: render,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

async function settleReact(): Promise<void> {
  await act(async () => {
    await tick()
    await tick()
  })
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function workspaceFixture(
  projectId: string,
  displayName: string,
  currentUserId = 'usr_ProjectOwner1'
): ProjectCoordinatorWorkspace {
  return {
    connection: {
      state: 'ready',
      userId: currentUserId,
      deviceId: 'dev_ProjectOwner1'
    },
    observedAt: '2026-08-28T00:00:00.000Z',
    focusedProjectId: projectId,
    availableWorkerUsers: [],
    projects: [{
      project: {
        type: 'project',
        schemaVersion: 1,
        projectId,
        ownerUserId: 'usr_ProjectOwner1',
        displayName,
        goal: 'Coordinate one exact Project.',
        coordinatorAgentId: 'agt_ProjectOwner1',
        coordinatorAuthorityEpoch: 1,
        executionAuthorityEpoch: 1,
        status: 'active',
        budget: {
          maxTasks: 8,
          maxTasksPerRound: 2,
          maxCoordinationRounds: 4,
          maxTaskRetries: 1
        },
        revision: 1,
        createdAt: '2026-08-28T00:00:00.000Z',
        updatedAt: '2026-08-28T00:00:00.000Z'
      },
      coordinatorTransferFeedback: null,
      requirementsDraft: null, confirmedRequirements: null,
      plan: null,
      memberUsers: [],
      workerGroups: [],
      tasks: [],
      offers: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      deliveryDrive: null,
      memberships: [],
      legacyHistory: { readOnly: true as const, plans: [], tasks: [], executions: [] }
    }]
  }
}


test('Cloud project clicks select their own session, publish ownership, and isolate empty projects', async () => {
  const projectId = 'prj_CurrentProject1'
  const workspace = workspaceFixture(projectId, 'Protein research')
  const empty = workspaceFixture('prj_EmptyProject001', 'Empty project')
  const selected: string[] = []
  const opened: unknown[] = []
  const overviews: string[] = []
  const ownership: unknown[] = []
  let failProjection = false
  const binding = { projectId, runtimeId: 'codex', threadId: 'worker-thread' } as ProjectCoordinatorSessionProjection['bindings'][number]
  const client = { ...clientFixture({ readSessionOwnership: async () => [{ runtimeId: binding.runtimeId, threadId: binding.threadId }], readSessionProjection: async () => { if (failProjection) throw new Error('Offline'); return { ...projection(false), bindings: [binding] } }, acknowledgeProjectActivation: async () => {} }), readWorkspace: async () => ({ ...workspace, projects: [...workspace.projects, ...empty.projects] }) }
  const context = {
    ...navigationContext([session('local-thread', 'codex'), session('worker-thread', 'codex')]),
    session: { id: 'local-thread', runtimeId: 'codex' },
    selectSession: (id: string) => { selected.push(id) },
    showOverview: (title: string) => { overviews.push(title) },
    publishSessionOwnership: (value: unknown) => { ownership.push(value) }
  }
  const mounted = await mountNavigation({ client, context, onCreateProject: () => {}, onOpenProject: (...args) => { opened.push(args) }, onActivateProject: () => {} })
  try {
    const clickProject = async (title: string) => {
      const button = [...mounted.container.querySelectorAll('button')].find(button => button.textContent?.includes(title))
      assert.ok(button)
      await act(async () => { button.click() })
    }
    await clickProject('Protein research')
    assert.deepEqual(selected, ['worker-thread'])
    assert.deepEqual(opened[0], [projectId, 'dashboard', 'worker-thread'])
    assert.deepEqual(ownership.at(-1), [{ runtimeId: 'codex', threadId: 'worker-thread', scopeLabel: 'Protein research' }])
    await clickProject('Empty project')
    assert.deepEqual(selected, ['worker-thread'])
    assert.deepEqual(overviews, ['Empty project'])
    failProjection = true
    await mounted.rerender({ client, context: { ...context, sessions: [session('worker-thread', 'codex', '2026-09-17T00:00:00Z')] }, onCreateProject: () => {}, onOpenProject: () => {}, onActivateProject: () => {} })
    assert.deepEqual(ownership.at(-1), [{ runtimeId: 'codex', threadId: 'worker-thread' }])
    assert.deepEqual(selected, ['worker-thread'])
  } finally { await mounted.unmount() }
})

test('Cloud navigation preserves content titles and restores the last available project session', async () => {
  const projectId = 'prj_CurrentProject1'
  const first = { ...session('worker-first', 'codex'), title: 'Analyze protein structure' }
  const latest = session('worker-latest', 'codex', '2026-09-17T00:00:00Z')
  const selected: string[] = []
  const client = {
    ...clientFixture({
      readSessionOwnership: async () => [],
      readSessionProjection: async () => ({
        ...projection(false),
        bindings: [first, latest].map(({ id, runtimeId }) => ({
          projectId, runtimeId, threadId: id
        })) as ProjectCoordinatorSessionProjection['bindings']
      }),
      acknowledgeProjectActivation: async () => {}
    }),
    readWorkspace: async () => workspaceFixture(projectId, 'Protein research')
  }
  const props: ProjectCoordinatorNavigationSectionProps = {
    client,
    context: {
      ...navigationContext([first, latest]),
      session: { id: first.id, runtimeId: first.runtimeId },
      selectSession: id => { selected.push(id) }
    },
    onCreateProject: () => {},
    onOpenProject: () => {},
    onActivateProject: () => {}
  }
  const mounted = await mountNavigation(props)
  const openProject = async () => {
    const button = [...mounted.container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Protein research'))
    assert.ok(button)
    await act(async () => { button.click() })
  }
  try {
    assert.equal(mounted.container.querySelector('[aria-current="page"]')?.textContent, first.title)
    await mounted.rerender({ ...props, context: { ...props.context, session: { id: 'local-thread' } } })
    await openProject()
    assert.deepEqual(selected, [first.id])
    await mounted.rerender({
      ...props,
      context: { ...props.context, sessions: [{ ...first, archived: true }, latest] }
    })
    await openProject()
    assert.deepEqual(selected, [first.id, latest.id])
  } finally {
    await mounted.unmount()
  }
})


test('completed projects open archived conversation history without requiring an active session', async () => {
  const projectId = 'prj_CurrentProject1'
  const history = { ...session('archived-history', 'codex'), archived: true }
  const workspace = workspaceFixture(projectId, 'Completed research')
  workspace.projects[0]!.project.status = 'completed'
  const selected: string[] = []
  const client = {
    ...clientFixture({
      readSessionOwnership: async () => [],
      readSessionProjection: async () => ({ ...projection(false), bindings: [{ projectId, runtimeId: 'codex', threadId: history.id, access: 'read_only', fenceReason: 'project_terminal' }] as ProjectCoordinatorSessionProjection['bindings'] }),
      acknowledgeProjectActivation: async () => {}
    }),
    readWorkspace: async () => workspace
  }
  const mounted = await mountNavigation({ client, context: { ...navigationContext([history]), selectSession: id => { selected.push(id) } }, onCreateProject: () => {}, onOpenProject: () => {}, onActivateProject: () => {} })
  try {
    const button = [...mounted.container.querySelectorAll('button')].find(button => button.textContent?.includes('Completed research'))
    assert.ok(button)
    await act(async () => button.click())
    assert.deepEqual(selected, [history.id])
  } finally { await mounted.unmount() }
})


for (const cloudState of ['offline', 'pending'] as const) {
  test(`local ownership is published when the first Cloud projection is ${cloudState}`, async () => {
    const claims = [{ runtimeId: 'codex', threadId: 'cloud-thread' }]
    const reports: unknown[] = []
    const client = clientFixture({
      readSessionOwnership: async () => claims,
      readSessionProjection: async () => {
        if (cloudState === 'offline') throw new Error('Cloud unavailable')
        return new Promise(() => {})
      },
      acknowledgeProjectActivation: async () => {}
    })
    const mounted = await mountNavigation({
      client,
      context: {
        ...navigationContext([session('local-thread', 'codex'), session('cloud-thread', 'codex')]),
        publishSessionOwnership: value => { reports.push(value) }
      },
      onCreateProject: () => {}, onOpenProject: () => {}, onActivateProject: () => {}
    })
    try { assert.deepEqual(reports.at(-1), claims) }
    finally { await mounted.unmount() }
  })
}
