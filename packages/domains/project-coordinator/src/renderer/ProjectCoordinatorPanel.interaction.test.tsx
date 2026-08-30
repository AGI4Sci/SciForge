import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { getI18n, setI18n } from 'react-i18next'
import { Window } from 'happy-dom'

import type {
  ProjectCoordinatorPlanDraft,
  ProjectCoordinatorWorkspace
} from '../contract.js'
import { ProjectCoordinatorPanel } from './ProjectCoordinatorPanel.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import { publishProjectCoordinatorWorkspaceInvalidation } from './workspace-invalidation.js'

const observedAt = '2026-08-30T00:00:00.000Z'
const emptyWorkspaceSections = Object.freeze([])
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

test('deleted initial Project is not reused by later live refreshes', async () => {
  const deletedProjectId = 'prj_ProjectDeleted01'
  const initialWorkspace = workspaceFixture([
    projectFixture(deletedProjectId, 'Deleted Project'),
    projectFixture('prj_ProjectRemain001', 'Remaining Project')
  ], deletedProjectId)
  const afterDeleteWorkspace = workspaceFixture([
    projectFixture('prj_ProjectRemain001', 'Remaining Project'),
    projectFixture('prj_ProjectRemain002', 'Second Project')
  ])
  const workspaceInputs: unknown[] = []
  const client = {
    readWorkspace: async (input = {}) => {
      workspaceInputs.push(input)
      return workspaceInputs.length === 1 ? initialWorkspace : afterDeleteWorkspace
    },
    readSessionProjection: async () => sessionProjectionFixture(),
    readPlanDraft: async () => null
  } as unknown as ProjectCoordinatorRendererClient
  const mounted = await mountPanel(client, deletedProjectId)

  try {
    assert.deepEqual(workspaceInputs, [{ projectId: deletedProjectId }])

    await act(async () => {
      publishProjectCoordinatorWorkspaceInvalidation()
      await tick()
      await tick()
    })
    await settleReact()
    assert.deepEqual(workspaceInputs.at(-1), {})
    assert.equal(projectPicker(mounted.container).value, '')

    await act(async () => {
      browserWindow.document.dispatchEvent(new browserWindow.Event('visibilitychange'))
      await tick()
      await tick()
    })
    await settleReact()

    assert.deepEqual(workspaceInputs.at(-1), {})
    assert.equal(
      workspaceInputs.some((input, index) => (
        index > 0 &&
        (input as Readonly<{ projectId?: string }>).projectId === deletedProjectId
      )),
      false
    )
  } finally {
    await mounted.unmount()
  }
})

test('external deletion of another Project preserves the selected Project and its draft', async () => {
  const deletedProjectId = 'prj_ProjectDeleted02'
  const selectedProjectId = 'prj_ProjectSelected01'
  const remainingProjectId = 'prj_ProjectRemain003'
  const selectedDraft = planDraftFixture(
    selectedProjectId,
    'Keep the selected Project draft visible.'
  )
  const initialWorkspace = workspaceFixture([
    projectFixture(deletedProjectId, 'Deleted Project'),
    projectFixture(selectedProjectId, 'Selected Project'),
    projectFixture(remainingProjectId, 'Remaining Project')
  ], deletedProjectId)
  const afterDeleteWorkspace = workspaceFixture([
    projectFixture(selectedProjectId, 'Selected Project'),
    projectFixture(remainingProjectId, 'Remaining Project')
  ], remainingProjectId)
  const workspaceInputs: unknown[] = []
  const draftInputs: Array<Readonly<{ projectId: string }>> = []
  const client = {
    readWorkspace: async (input = {}) => {
      workspaceInputs.push(input)
      return workspaceInputs.length === 1 ? initialWorkspace : afterDeleteWorkspace
    },
    readSessionProjection: async () => sessionProjectionFixture(),
    readPlanDraft: async (input: Readonly<{ projectId: string }>) => {
      draftInputs.push(input)
      return input.projectId === selectedProjectId ? selectedDraft : null
    }
  } as unknown as ProjectCoordinatorRendererClient
  const mounted = await mountPanel(client, selectedProjectId, 'tasks')

  try {
    assert.equal(projectPicker(mounted.container).value, selectedProjectId)
    assert.equal(planRationale(mounted.container).value, selectedDraft.rationale)

    await act(async () => {
      publishProjectCoordinatorWorkspaceInvalidation()
      await tick()
      await tick()
    })
    await settleReact()

    assert.deepEqual(workspaceInputs, [{ projectId: selectedProjectId }, {}])
    assert.deepEqual(draftInputs, [
      { projectId: selectedProjectId },
      { projectId: selectedProjectId }
    ])
    assert.equal(projectPicker(mounted.container).value, selectedProjectId)
    assert.equal(planRationale(mounted.container).value, selectedDraft.rationale)
  } finally {
    await mounted.unmount()
  }
})

test('create invalidation cannot overwrite the Cloud-returned Project selection and draft', async () => {
  const initialProjectId = 'prj_ProjectInitial001'
  const createdProjectId = 'prj_ProjectCreated001'
  const initialWorkspace = workspaceFixture([
    projectFixture(initialProjectId, 'Initial Project')
  ], initialProjectId)
  const createdWorkspace = workspaceFixture([
    projectFixture(initialProjectId, 'Initial Project'),
    projectFixture(createdProjectId, 'Created Project')
  ], createdProjectId)
  const initialDraft = planDraftFixture(initialProjectId, 'Initial Project draft.', 1)
  const createdDraft = planDraftFixture(createdProjectId, 'Created Project draft.', 2)
  const workspaceInputs: unknown[] = []
  const draftInputs: Array<Readonly<{ projectId: string }>> = []
  let createResultReady = false
  let staleReadStarted = false
  let resolveStaleWorkspace: ((workspace: ProjectCoordinatorWorkspace) => void) | undefined
  const staleWorkspace = new Promise<ProjectCoordinatorWorkspace>((resolve) => {
    resolveStaleWorkspace = resolve
  })
  const client = {
    readWorkspace: async (input = {}) => {
      workspaceInputs.push(input)
      if (workspaceInputs.length === 1) return initialWorkspace
      if (createResultReady) return createdWorkspace
      staleReadStarted = true
      return staleWorkspace
    },
    readSessionProjection: async () => sessionProjectionFixture(),
    readPlanDraft: async (input: Readonly<{ projectId: string }>) => {
      draftInputs.push(input)
      return input.projectId === createdProjectId ? createdDraft : initialDraft
    },
    createProject: async (input: Readonly<{ createIntentId: `pct_${string}` }>) => {
      publishProjectCoordinatorWorkspaceInvalidation()
      await tick()
      createResultReady = true
      return {
        createIntentId: input.createIntentId,
        createdProjectId,
        workspace: createdWorkspace
      }
    }
  } as unknown as ProjectCoordinatorRendererClient
  const mounted = await mountPanel(client, initialProjectId, 'create')

  try {
    const nameInput = requiredElement<HTMLInputElement>(
      mounted.container.querySelector('input[placeholder="projectCoordinatorProjectNamePlaceholder"]')
    )
    const goalInput = requiredElement<HTMLTextAreaElement>(
      mounted.container.querySelector('textarea[placeholder="projectCoordinatorProjectGoalPlaceholder"]')
    )
    await act(async () => {
      setNativeValue(nameInput, 'Created Project')
      setNativeValue(goalInput, 'Coordinate the newly created Project.')
      await tick()
    })
    const form = requiredElement<HTMLFormElement>(nameInput.closest('form'))
    await act(async () => {
      form.dispatchEvent(new browserWindow.Event('submit', {
        bubbles: true,
        cancelable: true
      }) as unknown as Event)
      await tick()
      await tick()
    })
    await settleReact()

    if (staleReadStarted) {
      await act(async () => {
        resolveStaleWorkspace?.(initialWorkspace)
        await tick()
        await tick()
      })
      await settleReact()
    }

    assert.equal(projectPicker(mounted.container).value, createdProjectId)
    assert.equal(planRationale(mounted.container).value, createdDraft.rationale)
    assert.equal(draftInputs.at(-1)?.projectId, createdProjectId)
    assert.deepEqual(workspaceInputs, [{ projectId: initialProjectId }, {}])
  } finally {
    resolveStaleWorkspace?.(initialWorkspace)
    await mounted.unmount()
  }
})

test('a Sidebar deletion broadcast during a local action is refreshed after the late action result', async () => {
  const deletedProjectId = 'prj_ProjectActionDelete1'
  const remainingProjectId = 'prj_ProjectActionRemain1'
  const staleWorkspace = workspaceFixture([
    awaitingConfirmationProjectFixture(deletedProjectId, 'Deleted During Action'),
    projectFixture(remainingProjectId, 'Remaining Project')
  ], deletedProjectId)
  const deletedWorkspace = workspaceFixture([
    projectFixture(remainingProjectId, 'Remaining Project')
  ], remainingProjectId)
  const workspaceInputs: unknown[] = []
  let resolveConfirmation: ((workspace: ProjectCoordinatorWorkspace) => void) | undefined
  const confirmation = new Promise<ProjectCoordinatorWorkspace>((resolve) => {
    resolveConfirmation = resolve
  })
  const client = {
    readWorkspace: async (input = {}) => {
      workspaceInputs.push(input)
      return workspaceInputs.length === 1 ? staleWorkspace : deletedWorkspace
    },
    readSessionProjection: async () => sessionProjectionFixture(),
    readPlanDraft: async () => null,
    confirmPlan: async () => confirmation
  } as unknown as ProjectCoordinatorRendererClient
  const mounted = await mountPanel(client, deletedProjectId, 'tasks')

  try {
    const confirmButton = requiredElement<HTMLButtonElement>(
      [...mounted.container.querySelectorAll('button')].find((button) => (
        button.textContent === 'projectCoordinatorConfirmPlan'
      )) ?? null
    )
    await act(async () => {
      confirmButton.click()
      await tick()
    })

    await act(async () => {
      publishProjectCoordinatorWorkspaceInvalidation()
      await tick()
    })
    assert.deepEqual(workspaceInputs, [{ projectId: deletedProjectId }])

    await act(async () => {
      resolveConfirmation?.(staleWorkspace)
      await tick()
      await tick()
    })
    await settleReact()

    assert.deepEqual(workspaceInputs, [{ projectId: deletedProjectId }, {}])
    assert.equal(projectPicker(mounted.container).value, '')
    assert.equal(
      [...projectPicker(mounted.container).options].some(({ value }) => (
        value === deletedProjectId
      )),
      false
    )
  } finally {
    resolveConfirmation?.(staleWorkspace)
    await mounted.unmount()
  }
})

async function mountPanel(
  client: ProjectCoordinatorRendererClient,
  initialProjectId: string,
  initialView?: 'tasks' | 'create'
): Promise<Readonly<{ root: Root; container: HTMLElement; unmount(): Promise<void> }>> {
  const { createRoot } = await import('react-dom/client')
  const container = browserWindow.document.createElement('div') as unknown as HTMLElement
  browserWindow.document.body.append(container as never)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <ProjectCoordinatorPanel
        client={client}
        session={{ id: 'session-1' }}
        initialProjectId={initialProjectId}
        initialView={initialView}
        workspaceSections={emptyWorkspaceSections}
      />
    )
    await tick()
    await tick()
  })
  await settleReact()
  return {
    root,
    container,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

function sessionProjectionFixture() {
  return {
    schemaVersion: 1 as const,
    observedAt,
    bindings: [],
    pendingActivations: []
  }
}

function planDraftFixture(
  projectId: string,
  rationale: string,
  draftRevision = 1
): ProjectCoordinatorPlanDraft {
  const planItemId = 'item_interaction_test'
  return {
    draftId: 'draft_interaction_test',
    draftRevision,
    projectId,
    expectedProjectRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks: [{
      planItemId,
      title: 'Interaction test task',
      objective: 'Exercise the selected Project draft.',
      completionCriteria: ['The selected draft remains visible.'],
      dependencyPlanItemIds: [],
      requiredCapabilityTags: [],
      fileIntent: null
    }],
    rationale,
    runtimeProvenance: {
      runtimeId: 'runtime-interaction-test',
      modelId: null,
      generatedByCoordinatorAgentId: 'agt_InteractionTest01',
      generatedAt: observedAt
    },
    assignments: [{
      planItemId,
      workerUserId: null,
      recommendationReason: null
    }],
    createdAt: observedAt,
    updatedAt: observedAt
  }
}

function projectPicker(container: HTMLElement): HTMLSelectElement {
  return requiredElement(container.querySelector('.project-coordinator-project-picker select'))
}

function planRationale(container: HTMLElement): HTMLTextAreaElement {
  return requiredElement(container.querySelector('textarea[name="plan-rationale"]'))
}

function requiredElement<T extends Element>(value: Element | null): T {
  assert.ok(value)
  return value as T
}

function setNativeValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const prototype = control.tagName === 'INPUT'
    ? browserWindow.HTMLInputElement.prototype
    : browserWindow.HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  assert.ok(setter)
  setter.call(control, value)
  control.dispatchEvent(
    new browserWindow.Event('input', { bubbles: true }) as unknown as Event
  )
}

function workspaceFixture(
  projects: ProjectCoordinatorWorkspace['projects'],
  focusedProjectId?: string
): ProjectCoordinatorWorkspace {
  return {
    connection: {
      state: 'ready',
      userId: 'usr_ProjectOwner1',
      deviceId: 'dev_ProjectOwner1'
    },
    observedAt,
    ...(focusedProjectId ? { focusedProjectId } : {}),
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects
  }
}

function projectFixture(
  projectId: string,
  displayName: string
): ProjectCoordinatorWorkspace['projects'][number] {
  return {
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
      contentMode: 'none',
      status: 'active',
      budget: {
        maxTasks: 8,
        maxTasksPerRound: 2,
        maxCoordinationRounds: 4,
        maxTaskRetries: 1
      },
      revision: 1,
      createdAt: observedAt,
      updatedAt: observedAt
    },
    coordinatorTransferFeedback: null,
    plan: null,
    memberUsers: [],
    workerGroups: [],
    tasks: [],
    offers: [],
    reviews: [],
    pendingHumanNeeded: [],
    records: [],
    finalSummary: null,
    provisioning: {
      intent: null,
      attestation: null,
      binding: null,
      memberships: [],
      providerPrincipalFacts: [],
      contentReadiness: [],
      providerMembershipObservations: [],
      externalOperationJournal: [],
      recoveryActions: []
    }
  }
}

function awaitingConfirmationProjectFixture(
  projectId: string,
  displayName: string
): ProjectCoordinatorWorkspace['projects'][number] {
  const project = projectFixture(projectId, displayName)
  return {
    ...project,
    project: {
      ...project.project,
      status: 'draft'
    },
    plan: {
      plan: {
        type: 'project_plan',
        schemaVersion: 1,
        projectPlanId: 'pln_InteractionTest01',
        projectId,
        state: 'awaiting_confirmation',
        planRevision: 1,
        revision: 1,
        sourceInputLocators: [],
        tasks: [{
          workerUserId: project.project.ownerUserId,
          planItemId: 'item_interaction_test',
          title: 'Interaction test task',
          objective: 'Exercise invalidation ordering.',
          completionCriteria: ['The authoritative refresh wins.'],
          dependencyPlanItemIds: [],
          requiredCapabilityTags: [],
          fileIntent: null
        }],
        rationale: 'Keep the action bounded.',
        runtimeProvenance: {
          runtimeId: 'runtime-interaction-test',
          modelId: null,
          generatedByCoordinatorAgentId: project.project.coordinatorAgentId,
          generatedAt: observedAt
        },
        planDigest: 'a'.repeat(64),
        submittedAt: observedAt,
        confirmedByUserId: null,
        confirmedAt: null,
        supersededAt: null,
        createdAt: observedAt,
        updatedAt: observedAt
      }
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
