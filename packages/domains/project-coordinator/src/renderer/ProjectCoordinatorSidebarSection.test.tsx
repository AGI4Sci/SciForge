import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Window } from 'happy-dom'

import type { ProjectCoordinatorWorkspace } from '../contract.js'
import {
  ProjectCoordinatorSidebarView,
  ProjectCoordinatorSidebarSection,
  ProjectSessionAliasRow,
  initialProjectCoordinatorSidebarReadState,
  projectCoordinatorSidebarReadReducer,
  projectCoordinatorSidebarSessionAliases
} from './ProjectCoordinatorSidebarSection.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import {
  projectCoordinatorSidebarBindings
} from './ProjectCoordinatorNavigationSection.js'

test('Cloud Project reads ignore stale completion and replace identity-scoped rows', () => {
  const first = projectCoordinatorSidebarReadReducer(
    initialProjectCoordinatorSidebarReadState,
    { type: 'begin', revision: 1, mode: 'foreground' }
  )
  const second = projectCoordinatorSidebarReadReducer(first, {
    type: 'begin', revision: 2, mode: 'background'
  })
  const staleWorkspace = workspaceFixture('prj_StaleProject001', 'Stale Project')
  const currentWorkspace = workspaceFixture('prj_CurrentProject1', 'Current Project')

  assert.equal(projectCoordinatorSidebarReadReducer(second, {
    type: 'success',
    revision: 1,
    workspace: staleWorkspace
  }), second)
  const current = projectCoordinatorSidebarReadReducer(second, {
    type: 'success',
    revision: 2,
    workspace: currentWorkspace
  })
  assert.equal(current.workspace?.projects[0]?.project.displayName, 'Current Project')

  const signingOut = projectCoordinatorSidebarReadReducer(current, {
    type: 'begin',
    revision: 3,
    mode: 'background'
  })
  const signedOut = projectCoordinatorSidebarReadReducer(signingOut, {
    type: 'success',
    revision: 3,
    workspace: {
      connection: { state: 'identity_required' },
      observedAt: '2026-08-28T00:01:00.000Z',
      availableWorkerUsers: [],
      providerPrincipalFacts: [],
      projects: []
    }
  })
  assert.deepEqual(signedOut.workspace?.projects, [])

  const failing = projectCoordinatorSidebarReadReducer(current, {
    type: 'begin',
    revision: 4,
    mode: 'background'
  })
  const failed = projectCoordinatorSidebarReadReducer(failing, {
    type: 'failure',
    revision: 4,
    error: 'Cloud read failed.'
  })
  assert.equal(failed.workspace, undefined)
  assert.equal(failed.error, 'Cloud read failed.')
})

test('Cloud Projects view renders only canonical Project rows and ordinary tool aliases', () => {
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorSidebarView, {
    state: {
      requestRevision: 1,
      loading: false,
      refreshing: false,
      workspace: workspaceFixture('prj_CurrentProject1', 'Current Project')
    },
    collapsed: false,
    expandedProjectId: 'prj_CurrentProject1',
    onCollapsedChange: () => undefined,
    onExpandedProjectChange: () => undefined,
    onRefresh: () => undefined,
    sessionCatalog: [{
      id: 'thread-project-1',
      runtimeId: 'codex',
      title: 'Review experiment plan',
      updatedAt: '2026-08-28T00:00:00.000Z'
    }],
    sessionBindings: [{
      projectId: 'prj_CurrentProject1',
      runtimeId: 'codex',
      threadId: 'thread-project-1'
    }],
    onSelectSession: () => undefined,
    onCreateProject: () => undefined,
    onOpenProject: () => undefined
  }))

  assert.match(markup, /projectCoordinatorSidebarCloudProjects/u)
  assert.match(markup, /Current Project/u)
  assert.match(markup, /projectCoordinatorSidebarSessions/u)
  assert.match(markup, /projectCoordinatorSidebarTasks/u)
  assert.match(markup, /projectCoordinatorSidebarFiles/u)
  assert.match(markup, /projectCoordinatorSidebarDecisions/u)
  assert.match(markup, /projectCoordinatorSidebarActivityRecovery/u)
  assert.match(markup, /Review experiment plan/u)
  assert.doesNotMatch(markup, /Stale Project/u)
})

test('Cloud Project delete affordances are rendered only for the current Owner', () => {
  const ownerMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorSidebarView, {
    ...sidebarViewProps(workspaceFixture('prj_CurrentProject1', 'Current Project')),
    onDeleteProject: async () => undefined
  }))
  const workerMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorSidebarView, {
    ...sidebarViewProps(workspaceFixture(
      'prj_CurrentProject1',
      'Current Project',
      'usr_ProjectWorker01'
    )),
    onDeleteProject: async () => undefined
  }))

  assert.match(ownerMarkup, /aria-haspopup="menu"/u)
  assert.match(ownerMarkup, /projectCoordinatorSidebarDeleteProjectLabel/u)
  assert.doesNotMatch(workerMarkup, /aria-haspopup="menu"/u)
  assert.doesNotMatch(workerMarkup, /projectCoordinatorSidebarDeleteProjectLabel/u)
})

test('Owner context menu supports secondary click, keyboard access, and focus restoration', async () => {
  const harness = createDomHarness()
  const deleted: string[] = []

  try {
    await harness.render(createElement(ProjectCoordinatorSidebarView, {
      ...sidebarViewProps(workspaceFixture('prj_CurrentProject1', 'Current Project')),
      onDeleteProject: async (projectId) => {
        deleted.push(projectId)
      }
    }))
    const trigger = harness.container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]'
    )
    assert.ok(trigger)
    trigger.focus()

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 24,
        clientY: 32,
        ctrlKey: true
      }))
    })
    const menuItem = harness.container.querySelector<HTMLButtonElement>('[role="menuitem"]')
    assert.ok(menuItem)
    assert.equal(harness.document.activeElement, menuItem)
    await act(async () => menuItem.click())
    const cancelButton = harness.document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button'
    )
    assert.ok(cancelButton)
    assert.deepEqual(deleted, [])
    assert.equal(harness.document.activeElement, cancelButton)
    assert.equal(harness.container.querySelector('[role="menu"]'), null)
    await act(async () => cancelButton.click())
    assert.equal(harness.document.activeElement, trigger)

    const shortcut = harness.container.querySelector<HTMLButtonElement>(
      'button[aria-label="projectCoordinatorSidebarDeleteProjectLabel"]'
    )
    assert.ok(shortcut)
    await act(async () => shortcut.click())
    assert.deepEqual(deleted, [])
    const shortcutCancel = harness.document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button'
    )
    assert.ok(shortcutCancel)
    await act(async () => shortcutCancel.click())
    assert.equal(harness.document.activeElement, shortcut)

    for (const event of [
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'F10',
        shiftKey: true
      }),
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ContextMenu'
      })
    ]) {
      await act(async () => trigger.dispatchEvent(event))
      assert.ok(harness.container.querySelector('[role="menuitem"]'))
      await act(async () => {
        harness.window.dispatchEvent(new harness.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Escape'
        }))
      })
      assert.equal(harness.container.querySelector('[role="menu"]'), null)
      assert.equal(harness.document.activeElement, trigger)
    }

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        button: 2,
        cancelable: true,
        clientX: 24,
        clientY: 32
      }))
    })
    const confirmedMenuItem = harness.container.querySelector<HTMLButtonElement>('[role="menuitem"]')
    assert.ok(confirmedMenuItem)
    const sectionControl = harness.container.querySelector<HTMLButtonElement>('section > header > button')
    assert.ok(sectionControl)
    await act(async () => {
      confirmedMenuItem.click()
      await Promise.resolve()
    })
    const confirmationButtons = harness.document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button'
    )
    assert.equal(confirmationButtons.length, 2)
    await act(async () => {
      confirmationButtons[1]?.click()
      await Promise.resolve()
    })
    assert.deepEqual(deleted, ['prj_CurrentProject1'])
    assert.equal(harness.document.activeElement, sectionControl)
  } finally {
    await harness.dispose()
  }
})

test('Owner context menu restores its Project trigger after scroll or resize dismissal', async () => {
  const harness = createDomHarness()

  try {
    await harness.render(createElement(ProjectCoordinatorSidebarView, {
      ...sidebarViewProps(workspaceFixture('prj_CurrentProject1', 'Current Project')),
      onDeleteProject: async () => undefined
    }))
    const trigger = harness.container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]'
    )
    assert.ok(trigger)

    for (const eventType of ['scroll', 'resize'] as const) {
      trigger.focus()
      await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'F10',
          shiftKey: true
        }))
      })
      assert.ok(harness.container.querySelector('[role="menuitem"]'))

      await act(async () => {
        if (eventType === 'scroll') {
          harness.container.dispatchEvent(new Event('scroll', {
            bubbles: false,
            cancelable: false
          }))
        } else {
          harness.window.dispatchEvent(new harness.window.Event('resize'))
        }
      })

      assert.equal(harness.container.querySelector('[role="menu"]'), null)
      assert.equal(harness.document.activeElement === trigger, true)
    }
  } finally {
    await harness.dispose()
  }
})

test('Owner context menu falls back to the Cloud Projects control after remote deletion', async () => {
  const harness = createDomHarness()
  const onDeleteProject = async (): Promise<void> => undefined

  try {
    await harness.render(createElement(ProjectCoordinatorSidebarView, {
      ...sidebarViewProps(workspaceFixture('prj_CurrentProject1', 'Current Project')),
      onDeleteProject
    }))
    const trigger = harness.container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]'
    )
    const sectionControl = harness.container.querySelector<HTMLButtonElement>(
      'section > header > button'
    )
    assert.ok(trigger)
    assert.ok(sectionControl)

    trigger.focus()
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'F10',
        shiftKey: true
      }))
    })
    assert.ok(harness.container.querySelector('[role="menuitem"]'))

    await harness.render(createElement(ProjectCoordinatorSidebarView, {
      ...sidebarViewProps(workspaceWithoutProjects('usr_ProjectOwner1')),
      onDeleteProject
    }))

    assert.equal(harness.container.querySelector('[role="menu"]'), null)
    assert.equal(trigger.isConnected, false)
    assert.equal(harness.document.activeElement === sectionControl, true)
  } finally {
    await harness.dispose()
  }
})

test('Cloud Project delete is deduplicated while pending and exposes failure state', async () => {
  const harness = createDomHarness()
  const projectId = 'prj_CurrentProject1'
  const workspace = workspaceFixture(projectId, 'Current Project')
  let deleteCalls = 0
  let rejectDelete: ((cause: Error) => void) | undefined
  const pendingDelete = new Promise<never>((_resolve, reject) => {
    rejectDelete = reject
  })
  const client = {
    readWorkspace: async () => workspace,
    deleteProject: async () => {
      deleteCalls += 1
      return pendingDelete
    }
  } as unknown as ProjectCoordinatorRendererClient
  try {
    await harness.render(createElement(ProjectCoordinatorSidebarSection, {
      client,
      context: {
        active: true,
        session: { id: 'session-1' },
        sessions: [],
        selectSession: () => undefined
      } as never,
      onCreateProject: () => undefined,
      onOpenProject: () => undefined
    }))
    const deleteButton = harness.container.querySelector<HTMLButtonElement>(
      'button[aria-label="projectCoordinatorSidebarDeleteProjectLabel"]'
    )
    assert.ok(deleteButton)

    await act(async () => {
      deleteButton.click()
    })
    const confirmationButton = harness.document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button'
    )[1]
    assert.ok(confirmationButton)
    await act(async () => {
      confirmationButton.click()
      confirmationButton.click()
    })
    assert.equal(deleteCalls, 1)
    assert.equal(
      harness.container.querySelector('.group')?.getAttribute('aria-busy'),
      'true'
    )
    assert.equal(deleteButton.disabled, true)
    const busyDialog = harness.document.querySelector<HTMLElement>('[role="dialog"]')
    assert.ok(busyDialog)
    assert.equal(busyDialog.getAttribute('aria-busy'), 'true')
    assert.equal(harness.document.activeElement, busyDialog)

    await act(async () => {
      rejectDelete?.(new Error('Cloud delete failed.'))
      await Promise.resolve()
    })
    assert.match(
      harness.container.querySelector('[role="alert"]')?.textContent ?? '',
      /Cloud delete failed\./u
    )
  } finally {
    await harness.dispose()
  }
})

test('keyboard delete failure restores focus and a later poll clears a lost-response error', async () => {
  const harness = createDomHarness()
  const projectId = 'prj_CurrentProject1'
  const initialWorkspace = workspaceFixture(projectId, 'Current Project')
  let workspaceReads = 0
  const client = {
    readWorkspace: async () => {
      workspaceReads += 1
      return workspaceReads === 1
        ? initialWorkspace
        : workspaceWithoutProjects('usr_ProjectOwner1')
    },
    deleteProject: async () => {
      throw new Error('Cloud response was lost.')
    }
  } as unknown as ProjectCoordinatorRendererClient
  try {
    await harness.render(sidebarSection(client))
    const trigger = harness.container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]'
    )
    assert.ok(trigger)
    trigger.focus()

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'F10',
        shiftKey: true
      }))
    })
    const menuItem = harness.container.querySelector<HTMLButtonElement>('[role="menuitem"]')
    assert.ok(menuItem)
    await act(async () => {
      menuItem.click()
    })
    const confirmationButton = harness.document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button'
    )[1]
    assert.ok(confirmationButton)
    await act(async () => {
      confirmationButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.match(
      harness.container.querySelector('[role="alert"]')?.textContent ?? '',
      /Cloud response was lost\./u
    )
    assert.equal(harness.document.activeElement, trigger)

    await act(async () => {
      harness.document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.equal(workspaceReads, 2)
    assert.equal(harness.container.querySelector('[role="alert"]'), null)
    assert.equal(harness.container.querySelector('button[aria-haspopup="menu"]'), null)
  } finally {
    await harness.dispose()
  }
})

test('an authoritative identity change clears the prior Principal delete error', async () => {
  const harness = createDomHarness()
  const projectId = 'prj_CurrentProject1'
  let workspaceReads = 0
  const client = {
    readWorkspace: async () => {
      workspaceReads += 1
      return workspaceFixture(
        projectId,
        'Current Project',
        workspaceReads === 1 ? 'usr_ProjectOwner1' : 'usr_ProjectWorker01'
      )
    },
    deleteProject: async () => {
      throw new Error('Delete failed for the former identity.')
    }
  } as unknown as ProjectCoordinatorRendererClient
  try {
    await harness.render(sidebarSection(client))
    const deleteButton = harness.container.querySelector<HTMLButtonElement>(
      'button[aria-label="projectCoordinatorSidebarDeleteProjectLabel"]'
    )
    assert.ok(deleteButton)
    await act(async () => {
      deleteButton.click()
    })
    const confirmationButton = harness.document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button'
    )[1]
    assert.ok(confirmationButton)
    await act(async () => {
      confirmationButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.match(
      harness.container.querySelector('[role="alert"]')?.textContent ?? '',
      /former identity/u
    )

    await act(async () => {
      harness.document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.equal(workspaceReads, 2)
    assert.equal(harness.container.querySelector('[role="alert"]'), null)
    assert.equal(harness.container.querySelector('button[aria-haspopup="menu"]'), null)
    assert.equal(
      harness.container.querySelector(
        'button[aria-label="projectCoordinatorSidebarDeleteProjectLabel"]'
      ),
      null
    )
  } finally {
    await harness.dispose()
  }
})

test('ordinary Session aliases require an exact canonical binding projection', () => {
  const catalog = [{
    id: 'thread-project-1',
    runtimeId: 'codex',
    title: 'Review experiment plan',
    updatedAt: '2026-08-28T00:00:00.000Z'
  }]
  assert.deepEqual(projectCoordinatorSidebarSessionAliases(
    'prj_CurrentProject1',
    catalog,
    []
  ), [])
  assert.deepEqual(projectCoordinatorSidebarSessionAliases(
    'prj_CurrentProject1',
    catalog,
    [{
      projectId: 'prj_CurrentProject1',
      runtimeId: 'other-runtime',
      threadId: 'thread-project-1'
    }]
  ), [])
  const bound = projectCoordinatorSidebarSessionAliases(
    'prj_CurrentProject1',
    catalog,
    [{
      projectId: 'prj_CurrentProject1',
      runtimeId: 'codex',
      threadId: 'thread-project-1'
    }]
  )
  assert.deepEqual(bound, catalog)

  const selected: string[] = []
  const row = ProjectSessionAliasRow({
    session: bound[0]!,
    onSelectSession: (sessionId) => selected.push(sessionId)
  })
  const onClick = (row.props as Readonly<{ onClick: () => void }>).onClick
  onClick()
  assert.deepEqual(selected, ['thread-project-1'])
})

test('sidebar projection strips Principal and authority facts before presentation', () => {
  assert.deepEqual(projectCoordinatorSidebarBindings({
    schemaVersion: 1,
    observedAt: '2026-08-28T00:00:00.000Z',
    bindings: [{
      schemaVersion: 1,
      role: 'coordinator',
      projectId: 'prj_CurrentProject1',
      principalUserId: 'usr_ProjectOwner1',
      coordinatorAgentId: 'agt_ProjectOwner1',
      coordinatorAuthorityEpoch: 3,
      runtimeId: 'codex',
      threadId: 'thread-project-1',
      boundAt: '2026-08-28T00:00:00.000Z',
      access: 'coordinator',
      fenceReason: null
    }],
    pendingActivations: []
  }), [{
    projectId: 'prj_CurrentProject1',
    runtimeId: 'codex',
    threadId: 'thread-project-1'
  }])
})

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
    providerPrincipalFacts: [],
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
        contentMode: 'none',
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
    }]
  }
}

function sidebarViewProps(workspace: ProjectCoordinatorWorkspace) {
  return {
    state: {
      requestRevision: 1,
      loading: false,
      refreshing: false,
      workspace
    },
    collapsed: false,
    onCollapsedChange: () => undefined,
    onExpandedProjectChange: () => undefined,
    onRefresh: () => undefined,
    onCreateProject: () => undefined,
    onOpenProject: () => undefined
  } as const
}

function workspaceWithoutProjects(currentUserId: string): ProjectCoordinatorWorkspace {
  return {
    connection: {
      state: 'ready',
      userId: currentUserId,
      deviceId: 'dev_ProjectOwner1'
    },
    observedAt: '2026-08-28T00:01:00.000Z',
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: []
  }
}

function sidebarSection(client: ProjectCoordinatorRendererClient): ReactElement {
  return createElement(ProjectCoordinatorSidebarSection, {
    client,
    context: {
      active: true,
      session: { id: 'session-1' },
      sessions: [],
      selectSession: () => undefined
    } as never,
    onCreateProject: () => undefined,
    onOpenProject: () => undefined
  })
}

function createDomHarness(): Readonly<{
  window: Window
  document: Document
  container: HTMLDivElement
  render(element: ReactElement): Promise<void>
  dispose(): Promise<void>
}> {
  const browserWindow = new Window({ url: 'http://localhost/' })
  const document = browserWindow.document as unknown as Document
  const globals = {
    window: browserWindow,
    self: browserWindow,
    document,
    navigator: browserWindow.navigator,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLButtonElement: browserWindow.HTMLButtonElement,
    Event: browserWindow.Event,
    MouseEvent: browserWindow.MouseEvent,
    KeyboardEvent: browserWindow.KeyboardEvent,
    PointerEvent: browserWindow.PointerEvent,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true
  } as const
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value
    })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)

  return Object.freeze({
    window: browserWindow,
    document,
    container,
    render: async (element) => {
      await act(async () => {
        root.render(element)
        await Promise.resolve()
      })
    },
    dispose: async () => {
      await act(async () => root.unmount())
      browserWindow.close()
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    }
  })
}
