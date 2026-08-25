import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'

import {
  PROJECT_COORDINATOR_I18N_CONTRIBUTION,
  PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  PROJECT_COORDINATOR_PANEL_SECTION_IDS,
  ProjectCoordinatorPanel,
  ProjectCoordinatorPlanSection,
  projectCoordinatorCreatedSelection
} from './ProjectCoordinatorPanel.js'
import { createProjectCoordinatorRendererClient } from './project-coordinator-capability-client.js'
import {
  createDomainRendererEntry,
  createProjectCoordinatorOpenCommand
} from './index.js'

test('renderer entry owns one generic Workbench surface without Identity UI contributions', () => {
  const host = rendererHost([])
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(
    entry.contributions.map(({ id }) => id),
    [
      PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION.id,
      PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION.id,
      PROJECT_COORDINATOR_I18N_CONTRIBUTION.id
    ]
  )
  const panelContribution = entry.contributions.find(
    ({ id }) => id === PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id
  )!
  const panel = panelContribution.value as Readonly<{
    render(input: {
      active: boolean
      focused: boolean
      surfaceId: string
      className: string
      onCollapse(): void
      session: { id: string }
      activation: {
        contributionId: string
        revision: number
        payload: { projectId: string }
      }
    }): ReactElement<Record<string, unknown>>
  }>
  const rendered = panel.render({
    active: true,
    focused: true,
    surfaceId: 'surface-1',
    className: 'fixture-panel',
    onCollapse: () => undefined,
    session: { id: 'session-1' },
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { projectId: 'prj_Project000001' }
    }
  })
  assert.equal(rendered.props.initialProjectId, 'prj_Project000001')
  assert.equal(rendered.props.className, 'fixture-panel')
})

test('panel surface is limited to Plan, Worker selection, Task, review, and provisioning HCI', () => {
  assert.deepEqual(PROJECT_COORDINATOR_PANEL_SECTION_IDS, [
    'plan',
    'workers',
    'tasks',
    'reviews',
    'provisioning'
  ])
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPanel, {
    client: {
      readWorkspace: async () => ({
        connection: { state: 'identity_required' as const },
        observedAt: '2026-08-24T09:00:00.000Z',
        projects: []
      }),
      createProject: async () => { throw new Error('unused') },
      readPlanDraft: async () => null,
      generatePlanDraft: async () => { throw new Error('unused') },
      editPlanDraft: async () => { throw new Error('unused') },
      submitPlanDraft: async () => { throw new Error('unused') },
      confirmPlanAndActivate: async () => { throw new Error('unused') }
    },
    session: { id: 'session-1' }
  }))
  for (const sectionId of PROJECT_COORDINATOR_PANEL_SECTION_IDS) {
    assert.match(markup, new RegExp(`data-coordinator-section="${sectionId}"`, 'u'))
  }
  assert.doesNotMatch(markup, /password|access token|refresh token|register agent|enroll device/iu)
})

test('command focuses an exact Project through the generic panel activation contract', () => {
  const opened: unknown[] = []
  const command = createProjectCoordinatorOpenCommand(rendererHost(opened))
  command.execute({
    sessionId: 'session-1',
    payload: { projectId: 'prj_Project000001' }
  })
  assert.deepEqual(opened, [{
    contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'session-1',
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { projectId: 'prj_Project000001' }
    }
  }])
})

test('renderer Project create applies the exact Cloud-returned workspace focus without guessing latest', async () => {
  const invoked: unknown[] = []
  const returnedWorkspace = {
    connection: {
      state: 'ready' as const,
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    projects: [awaitingConfirmationProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return {
        createdProjectId: 'prj_ProjectCreated01',
        workspace: returnedWorkspace
      } as never
    }
  })
  const result = await client.createProject({
    displayName: 'Meeting',
    goal: 'Run a realistic meeting.',
    coordinatorAgentId: 'agt_Coordinator01',
    expectedCoordinatorAgentRevision: 1,
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    },
    content: { mode: 'none', members: [{ userId: 'usr_Owner0000001' }] }
  })

  assert.deepEqual(projectCoordinatorCreatedSelection(result), {
    workspace: result.workspace,
    selectedProjectId: 'prj_ProjectCreated01'
  })
  assert.deepEqual(invoked, [{
    actionId: 'project-coordinator.project.create',
    effect: 'external-write',
    input: {
      displayName: 'Meeting',
      goal: 'Run a realistic meeting.',
      coordinatorAgentId: 'agt_Coordinator01',
      expectedCoordinatorAgentRevision: 1,
      budget: {
        maxTasks: 4,
        maxTasksPerRound: 4,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      },
      content: { mode: 'none', members: [{ userId: 'usr_Owner0000001' }] }
    }
  }])
})

test('an awaiting-confirmation Plan renders its Owner action as a default-visible card', () => {
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: awaitingConfirmationProjectFixture(),
    draft: null,
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    onConfirmActivate: () => undefined
  }))

  assert.match(markup, /data-default-visible-card="plan-confirmation"/u)
  assert.match(markup, /projectCoordinatorConfirmActivate/u)
})

function rendererHost(opened: unknown[]): DomainRendererHost {
  return {
    capabilityInvoker: {
      observe: async () => { throw new Error('not observed') },
      invoke: async () => { throw new Error('not invoked') }
    },
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input) => opened.push(input)
    }
  }
}

function awaitingConfirmationProjectFixture() {
  const createdAt = '2026-08-25T01:00:00.000Z'
  const updatedAt = '2026-08-25T01:08:00.000Z'
  return {
    project: {
      schemaVersion: 1 as const,
      revision: 2,
      createdAt,
      updatedAt,
      type: 'project' as const,
      projectId: 'prj_ProjectCreated01',
      ownerUserId: 'usr_Owner0000001',
      displayName: 'Created meeting',
      goal: 'Run one realistic multi-user meeting.',
      coordinatorAgentId: 'agt_Coordinator01',
      coordinatorAuthorityEpoch: 1,
      executionAuthorityEpoch: 1,
      contentMode: 'none' as const,
      status: 'paused' as const,
      budget: {
        maxTasks: 4,
        maxTasksPerRound: 4,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      }
    },
    plan: {
      plan: {
        schemaVersion: 1 as const,
        revision: 1,
        createdAt,
        updatedAt,
        type: 'project_plan' as const,
        projectPlanId: 'pln_MeetingPlan001',
        projectId: 'prj_ProjectCreated01',
        state: 'awaiting_confirmation' as const,
        planRevision: 1,
        sourceInputLocators: [],
        tasks: [{
          planItemId: 'item_meeting_summary',
          title: 'Summarize decisions',
          objective: 'Produce a bounded meeting summary.',
          completionCriteria: ['Owner can review it.'],
          dependencyPlanItemIds: [],
          requiredCapabilityTags: ['meeting.review'],
          fileIntent: null
        }],
        rationale: 'One Worker can synthesize the meeting.',
        runtimeProvenance: {
          runtimeId: 'codex-runtime',
          modelId: null,
          generatedByCoordinatorAgentId: 'agt_Coordinator01',
          generatedAt: createdAt
        },
        planDigest: 'a'.repeat(64),
        submittedAt: updatedAt,
        confirmedByUserId: null,
        confirmedAt: null,
        supersededAt: null
      },
      assignments: []
    },
    workerGroups: [],
    tasks: [],
    reviews: [],
    provisioning: {
      intent: null,
      attestation: null,
      binding: null,
      recoveryActions: []
    }
  }
}
