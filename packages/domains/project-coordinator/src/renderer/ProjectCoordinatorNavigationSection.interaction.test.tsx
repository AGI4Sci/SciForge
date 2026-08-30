import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { getI18n, setI18n } from 'react-i18next'
import { Window } from 'happy-dom'

import type {
  ProjectCoordinatorPendingActivation,
  ProjectCoordinatorSessionProjection
} from '../contract.js'
import {
  ProjectCoordinatorNavigationSection,
  type ProjectCoordinatorNavigationSectionProps
} from './ProjectCoordinatorNavigationSection.js'
import {
  ProjectCoordinatorPanel,
  type ProjectCoordinatorPanelProps
} from './ProjectCoordinatorPanel.js'
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
    assert.equal(activations.length, 2)
  } finally {
    await mounted.unmount()
  }
})

test('a retained activation does not reset a manually selected Project view on parent rerender', async () => {
  const client = clientFixture({
    readSessionProjection: async () => projection(false),
    acknowledgeProjectActivation: async () => undefined
  })
  const mounted = await mountPanel({
    client,
    session: { id: 'source-session' },
    initialView: 'overview',
    activationRevision: 1,
    workspaceSections: []
  })

  try {
    const projectTab = mounted.container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-controls="project-coordinator-view-projects"]'
    )
    assert.ok(projectTab)
    await act(async () => {
      projectTab.click()
      await tick()
      await tick()
    })
    assert.equal(
      mounted.container.querySelector('[data-domain="project-coordinator"]')
        ?.getAttribute('data-active-workspace-view'),
      'projects'
    )

    // Workbench renders provide a fresh workspace-section array. The retained
    // activation must remain a one-shot intent instead of overriding this
    // explicit user navigation.
    await mounted.rerender({
      client,
      session: { id: 'source-session' },
      initialView: 'overview',
      activationRevision: 1,
      workspaceSections: []
    })
    assert.equal(
      mounted.container.querySelector('[data-domain="project-coordinator"]')
        ?.getAttribute('data-active-workspace-view'),
      'projects'
    )
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
    schemaVersion: 1,
    observedAt,
    bindings: [],
    pendingActivations: pending ? [pendingActivation] : []
  }
}

function clientFixture(overrides: Pick<
  ProjectCoordinatorRendererClient,
  'acknowledgeProjectActivation' | 'readSessionProjection'
>): ProjectCoordinatorRendererClient {
  const unused = async (): Promise<never> => {
    throw new Error('Unused Project Coordinator capability.')
  }
  return {
    readWorkspace: async () => ({
      connection: { state: 'identity_required' },
      observedAt,
      availableWorkerUsers: [],
      providerPrincipalFacts: [],
      projects: []
    }),
    createProject: unused,
    acknowledgeProjectActivation: overrides.acknowledgeProjectActivation,
    readSessionProjection: overrides.readSessionProjection,
    readPlanDraft: unused,
    generatePlanDraft: unused,
    editPlanDraft: unused,
    submitPlanDraft: unused,
    confirmPlan: unused,
    prepareWorkflow: unused,
    continueWorkflow: unused,
    reassignTaskOffer: unused,
    observeAndLinkRecovery: unused,
    abandonRecovery: unused,
    addMember: unused,
    acceptInvitation: unused,
    removeMember: unused,
    createHumanNeeded: unused,
    answerHumanNeeded: unused,
    transferCoordinator: unused,
    prepareArtifactReview: unused,
    reviewResult: unused,
    completeProject: unused
  }
}

async function mountNavigation(
  props: ProjectCoordinatorNavigationSectionProps
): Promise<Readonly<{
  root: Root
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
    rerender: render,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

async function mountPanel(
  props: ProjectCoordinatorPanelProps
): Promise<Readonly<{
  container: HTMLElement
  rerender: (nextProps: ProjectCoordinatorPanelProps) => Promise<void>
  unmount: () => Promise<void>
}>> {
  const { createRoot } = await import('react-dom/client')
  const container = browserWindow.document.createElement('div') as unknown as HTMLElement
  browserWindow.document.body.append(container as never)
  const root = createRoot(container)
  const render = async (nextProps: ProjectCoordinatorPanelProps) => {
    await act(async () => {
      root.render(<ProjectCoordinatorPanel {...nextProps} />)
      await tick()
      await tick()
    })
    await settleReact()
  }
  await render(props)
  return {
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
