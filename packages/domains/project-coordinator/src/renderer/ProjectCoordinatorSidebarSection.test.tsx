import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ProjectCoordinatorWorkspace } from '../contract.js'
import {
  ProjectCoordinatorSidebarView,
  ProjectSessionAliasRow,
  initialProjectCoordinatorSidebarReadState,
  projectCoordinatorSidebarReadReducer,
  projectCoordinatorSidebarSessionAliases
} from './ProjectCoordinatorSidebarSection.js'
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
  displayName: string
): ProjectCoordinatorWorkspace {
  return {
    connection: {
      state: 'ready',
      userId: 'usr_ProjectOwner1',
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
