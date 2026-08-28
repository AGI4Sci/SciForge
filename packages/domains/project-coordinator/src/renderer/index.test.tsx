import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  DomainRendererContribution,
  DomainRendererHost
} from '@sciforge/domain-sdk/host'
import {
  RENDERER_EXTENSION_CONTRIBUTION_KIND,
  WORKBENCH_WORKSPACE_SECTION_CONTRACT_VERSION,
  WORKBENCH_WORKSPACE_SECTION_LOCATION
} from '@sciforge/domain-sdk/renderer'
import type { ProjectCoordinatorProject } from '../contract.js'

import {
  PROJECT_COORDINATOR_COMPOSER_CONTEXT_CONTRIBUTION,
  PROJECT_COORDINATOR_I18N_CONTRIBUTION,
  PROJECT_COORDINATOR_NAVIGATION_SECTION_CONTRIBUTION,
  PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  PROJECT_COORDINATOR_PANEL_SECTION_IDS,
  ProjectCreateForm,
  ProjectCoordinatorDecisionSection,
  ProjectCoordinatorPanel,
  ProjectCoordinatorPlanSection,
  ProjectCoordinatorProvisioningSection,
  ProjectCoordinatorTransferSection,
  WorkersSection,
  formatRelativeTime,
  projectCoordinatorAgentOperationalState,
  projectCoordinatorActivationTarget,
  projectCoordinatorAttentionSummary,
  projectCoordinatorCompletionInput,
  projectCoordinatorCreatedSelection,
  projectCoordinatorFlowStages,
  projectCoordinatorMeetingPackageSummary,
  projectCoordinatorResultReviewInput,
  projectCoordinatorTransferCandidates,
  projectCoordinatorWorkspaceNavigationItems,
  projectCoordinatorWorkerPresenceSummary
} from './ProjectCoordinatorPanel.js'
import { createProjectCoordinatorRendererClient } from './project-coordinator-capability-client.js'
import {
  createDomainRendererEntry,
  createProjectCoordinatorNavigationSectionContribution,
  createProjectCoordinatorOpenCommand,
  createProjectCoordinatorRightPanelContribution
} from './index.js'
import {
  SCIFORGE_COLLABORATION_CENTER_WORKSPACE_ID,
  collectProjectCoordinatorWorkspaceSections,
  type ProjectCoordinatorWorkspaceSection
} from './workspace-sections.js'

test('renderer entry owns one generic Workbench surface without Identity UI contributions', () => {
  const opened: unknown[] = []
  const host = rendererHost(opened)
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(
    entry.contributions.map(({ id }) => id),
    [
      PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION.id,
      PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION.id,
      PROJECT_COORDINATOR_NAVIGATION_SECTION_CONTRIBUTION.id,
      PROJECT_COORDINATOR_COMPOSER_CONTEXT_CONTRIBUTION.id,
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
        payload: { projectId: string; view: 'tasks' }
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
      payload: { projectId: 'prj_Project000001', view: 'tasks' }
    }
  })
  assert.equal(rendered.props.initialProjectId, 'prj_Project000001')
  assert.equal(rendered.props.initialView, 'tasks')
  assert.equal(rendered.props.activationRevision, 1)
  assert.equal(rendered.props.className, 'fixture-panel')

  const navigationContribution = entry.contributions.find(
    ({ id }) => id === PROJECT_COORDINATOR_NAVIGATION_SECTION_CONTRIBUTION.id
  )!
  const navigation = navigationContribution.value as ReturnType<
    typeof createProjectCoordinatorNavigationSectionContribution
  >
  const selectSession = () => undefined
  const context = {
    active: true,
    className: 'fixture-navigation',
    session: { id: 'session-1' },
    sessions: [{
      id: 'session-1',
      title: 'Ordinary Agent Session',
      updatedAt: '2026-08-28T00:00:00.000Z'
    }],
    selectSession
  }
  const renderedNavigation = navigation.render(context) as ReactElement<{
    context: typeof context
    onCreateProject: () => void
    onOpenProject: (projectId: string, view: 'files') => void
  }>
  assert.equal(renderedNavigation.props.context, context)
  assert.equal(renderedNavigation.props.context.selectSession, selectSession)
  renderedNavigation.props.onCreateProject()
  renderedNavigation.props.onOpenProject('prj_Project000001', 'files')
  assert.deepEqual(opened.slice(-2), [{
    contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'session-1',
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { view: 'create' }
    }
  }, {
    contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'session-1',
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 2,
      payload: { projectId: 'prj_Project000001', view: 'files' }
    }
  }])
})

test('Project activation intents resolve only to package-owned safe views', () => {
  const withoutFiles = new Set(['overview', 'projects', 'reviews'])
  const withFiles = new Set([...withoutFiles, 'files'])
  assert.deepEqual(projectCoordinatorActivationTarget('overview', withoutFiles), {
    workspaceView: 'overview'
  })
  assert.deepEqual(projectCoordinatorActivationTarget('tasks', withoutFiles), {
    workspaceView: 'projects',
    sectionId: 'tasks'
  })
  assert.deepEqual(projectCoordinatorActivationTarget('files', withoutFiles), {
    workspaceView: 'overview'
  })
  assert.deepEqual(projectCoordinatorActivationTarget('files', withFiles), {
    workspaceView: 'files'
  })
  assert.deepEqual(projectCoordinatorActivationTarget('decisions', withoutFiles), {
    workspaceView: 'reviews'
  })
  assert.deepEqual(projectCoordinatorActivationTarget('recovery', withoutFiles), {
    workspaceView: 'projects',
    sectionId: 'provisioning'
  })
  assert.deepEqual(projectCoordinatorActivationTarget('create', withoutFiles), {
    workspaceView: 'projects',
    sectionId: 'create',
    requestCreate: true
  })
})

test('Cloud Projects create reuses a draft presentation Session without inventing a Thread', () => {
  const opened: unknown[] = []
  const navigation = createProjectCoordinatorNavigationSectionContribution(
    rendererHost(opened)
  )
  const rendered = navigation.render({
    active: true,
    className: 'fixture-navigation',
    session: { id: 'draft:/workspace', workspaceRoot: '/workspace' },
    sessions: [],
    selectSession: () => undefined
  }) as ReactElement<{ onCreateProject: () => void }>
  rendered.props.onCreateProject()
  assert.deepEqual(opened, [{
    contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'draft:/workspace',
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { view: 'create' }
    }
  }])
})

test('Collaboration Center keeps package-owned HCI behind one ordered workspace navigation', () => {
  assert.deepEqual(PROJECT_COORDINATOR_PANEL_SECTION_IDS, [
    'coordinator',
    'plan',
    'workers',
    'tasks',
    'reviews',
    'provisioning'
  ])
  const workspaceSections = [
    workspaceSection('fixture.my-work', 'fixture.collaboration', {
      sectionId: 'my-work',
      label: 'collaborationWorkspaceMyWork',
      description: 'collaborationWorkspaceMyWorkDescription',
      placement: 'navigation',
      order: 30
    }),
    workspaceSection('fixture.files', 'fixture.content-space', {
      sectionId: 'files',
      label: 'contentSpaceWorkspaceFiles',
      description: 'contentSpaceWorkspaceFilesDescription',
      placement: 'navigation',
      order: 50
    }),
    workspaceSection('fixture.connections', 'fixture.collaboration', {
      sectionId: 'connections',
      label: 'collaborationWorkspaceSettings',
      description: 'collaborationWorkspaceSettingsDescription',
      placement: 'settings',
      order: 10
    })
  ] satisfies readonly ProjectCoordinatorWorkspaceSection[]
  assert.deepEqual(
    projectCoordinatorWorkspaceNavigationItems(workspaceSections).map(({ id, source }) => ({
      id,
      source
    })),
    [
      { id: 'overview', source: 'built-in' },
      { id: 'projects', source: 'built-in' },
      { id: 'my-work', source: 'extension' },
      { id: 'reviews', source: 'built-in' },
      { id: 'files', source: 'extension' }
    ]
  )
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPanel, {
    client: {
      readWorkspace: async () => ({
        connection: { state: 'identity_required' as const },
        observedAt: '2026-08-24T09:00:00.000Z',
        availableWorkerUsers: [],
        providerPrincipalFacts: [],
        projects: []
      }),
      createProject: async () => { throw new Error('unused') },
      readSessionProjection: async () => ({
        schemaVersion: 1 as const,
        observedAt: '2026-08-24T09:00:00.000Z',
        bindings: []
      }),
      readPlanDraft: async () => null,
      generatePlanDraft: async () => { throw new Error('unused') },
      editPlanDraft: async () => { throw new Error('unused') },
      submitPlanDraft: async () => { throw new Error('unused') },
      confirmPlan: async () => { throw new Error('unused') },
      prepareWorkflow: async () => { throw new Error('unused') },
      continueWorkflow: async () => { throw new Error('unused') },
      addMember: async () => { throw new Error('unused') },
      acceptInvitation: async () => { throw new Error('unused') },
      removeMember: async () => { throw new Error('unused') },
      observeAndLinkRecovery: async () => { throw new Error('unused') },
      abandonRecovery: async () => { throw new Error('unused') },
      retryRecoverySuccessor: async () => { throw new Error('unused') },
      createHumanNeeded: async () => { throw new Error('unused') },
      answerHumanNeeded: async () => { throw new Error('unused') },
      transferCoordinator: async () => { throw new Error('unused') },
      prepareArtifactReview: async () => { throw new Error('unused') },
      reviewResult: async () => { throw new Error('unused') },
      completeProject: async () => { throw new Error('unused') }
    },
    session: { id: 'session-1' },
    workspaceSections
  }))
  assert.match(markup, /data-active-workspace-view="overview"/u)
  assert.match(markup, /id="project-coordinator-tab-overview"/u)
  assert.match(markup, /id="project-coordinator-tab-projects"/u)
  assert.match(markup, /id="project-coordinator-tab-my-work"/u)
  assert.match(markup, /id="project-coordinator-tab-reviews"/u)
  assert.match(markup, /id="project-coordinator-tab-files"/u)
  assert.doesNotMatch(markup, /id="project-coordinator-tab-connections"/u)
  assert.doesNotMatch(markup, /password|access token|refresh token|register agent|enroll device/iu)
})

test('New Project creates only the draft Project before Team/content selection', () => {
  const markup = renderToStaticMarkup(createElement(ProjectCreateForm, {
    defaultExpanded: true,
    busy: false,
    displayName: '',
    goal: '',
    onDisplayName: () => undefined,
    onGoal: () => undefined,
    onSubmit: () => undefined
  }))

  assert.match(markup, /projectCoordinatorCreatorRole/u)
  assert.doesNotMatch(markup, /type="checkbox"|projectCoordinatorContentMode/u)
  assert.doesNotMatch(markup, /type="number"/u)
})

test('workspace section collector discovers package-neutral sections and fails closed on duplicates', () => {
  const files = rendererContribution('fixture.files', 'fixture.content-space', {
    sectionId: 'files',
    label: 'contentSpaceWorkspaceFiles',
    placement: 'navigation',
    order: 50
  })
  const work = rendererContribution('fixture.my-work', 'fixture.collaboration', {
    sectionId: 'my-work',
    label: 'collaborationWorkspaceMyWork',
    placement: 'navigation',
    order: 30
  })
  const settings = rendererContribution('fixture.settings', 'fixture.collaboration', {
    sectionId: 'connections',
    label: 'collaborationWorkspaceSettings',
    placement: 'settings',
    order: 10
  })
  const unrelated = rendererContribution('fixture.unrelated', 'fixture.other', {
    workspaceId: 'fixture.other-workspace',
    sectionId: 'other',
    label: 'otherSection',
    placement: 'navigation',
    order: 1
  })
  const host = rendererHostWithContributions([files, work, settings, unrelated])

  const sections = collectProjectCoordinatorWorkspaceSections(host)
  assert.deepEqual(sections.map(({ sectionId, ownerId }) => ({ sectionId, ownerId })), [
    { sectionId: 'connections', ownerId: 'fixture.collaboration' },
    { sectionId: 'my-work', ownerId: 'fixture.collaboration' },
    { sectionId: 'files', ownerId: 'fixture.content-space' }
  ])
  assert.ok(Object.isFrozen(sections))
  assert.equal(sections[0]?.render({
    active: true,
    className: 'fixture-section',
    session: { id: 'session-1' }
  }).type, 'div')

  const duplicate = rendererContribution('fixture.files-duplicate', 'fixture.other', {
    sectionId: 'files',
    label: 'duplicateFiles',
    placement: 'navigation',
    order: 60
  })
  assert.throws(
    () => collectProjectCoordinatorWorkspaceSections(
      rendererHostWithContributions([files, duplicate])
    ),
    /navigation\/files is duplicated/u
  )
})

test('Coordinator transfer HCI is Owner-only, exact-Agent, and shows the old authority fence', () => {
  const project = coordinatorTransferProjectFixture()
  assert.deepEqual(
    projectCoordinatorTransferCandidates(project).map(({ projectAvailability }) => (
      projectAvailability.agentId
    )),
    ['agt_OwnerSuccessor1']
  )
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorTransferSection, {
    project,
    canTransfer: true,
    busy: false,
    onTransfer: () => undefined
  }))
  assert.match(markup, /projectCoordinatorTransferTitle/u)
  assert.match(markup, /agt_OwnerSuccessor1/u)
  assert.match(markup, /projectCoordinatorAuthorityTransferredOut/u)
  assert.doesNotMatch(markup, /agt_MemberAgent001/u)
})

test('Worker HCI renders only User-level online and readiness state', () => {
  const project = coordinatorTransferProjectFixture()
  const offlineMember = {
    ...project,
    workerGroups: project.workerGroups.map((group) => group.userId === 'usr_ProjectMember01'
      ? {
          ...group,
          agents: group.agents.map((agent) => ({
            ...agent,
            projectAvailability: {
              ...agent.projectAvailability,
              availability: {
                ...agent.projectAvailability.availability,
                connectionStatus: 'offline' as const
              }
            }
          }))
        }
      : group)
  } as ProjectCoordinatorProject

  assert.deepEqual(projectCoordinatorWorkerPresenceSummary(offlineMember), {
    onlineUsers: 1,
    readyUsers: 0,
    visibleUsers: 2
  })
  const markup = renderToStaticMarkup(createElement(WorkersSection, { project: offlineMember }))
  assert.match(markup, /data-project-online-users="1"/u)
  assert.match(markup, /data-project-visible-users="2"/u)
  assert.match(markup, /data-project-ready-users="0"/u)
  assert.match(markup, /projectCoordinatorOnlineMembers/u)
  assert.match(markup, /projectCoordinatorWorkerUsersReadyShort/u)
  assert.match(markup, /Project Owner/u)
  assert.match(markup, /Project Member/u)
  assert.doesNotMatch(markup, /Current Coordinator Desktop/u)
  assert.doesNotMatch(markup, /Owner Successor Desktop/u)
  assert.doesNotMatch(markup, /Member Desktop/u)
  assert.doesNotMatch(markup, /data-agent-/u)

  assert.deepEqual(
    projectCoordinatorWorkerPresenceSummary(
      offlineMember,
      '2026-08-25T03:00:00.000Z'
    ),
    {
      onlineUsers: 0,
      readyUsers: 0,
      visibleUsers: 2
    }
  )
})

test('operational Agent state never collapses online presence into Project eligibility', () => {
  const project = coordinatorTransferProjectFixture()
  const agent = project.workerGroups[0]!.agents[0]!
  const onlineWithoutAuthority = projectCoordinatorAgentOperationalState(agent)
  assert.deepEqual(onlineWithoutAuthority, {
    state: 'blocked',
    online: true,
    fresh: true,
    runtimeReady: true,
    acceptsNewOffers: true,
    projectMember: true,
    textAuthority: false,
    fileAuthority: false,
    contentReady: null
  })

  const eligibleAgent = {
    ...agent,
    projectAvailability: {
      ...agent.projectAvailability,
      taskAuthorities: [{ scope: 'text_tasks', state: 'eligible' }]
    }
  } as unknown as typeof agent
  assert.equal(projectCoordinatorAgentOperationalState(eligibleAgent).state, 'ready')
  assert.equal(projectCoordinatorAgentOperationalState({
    ...eligibleAgent,
    projectAvailability: {
      ...eligibleAgent.projectAvailability,
      availability: {
        ...eligibleAgent.projectAvailability.availability,
        acceptsNewOffers: false
      }
    }
  } as never).state, 'busy')
  assert.equal(projectCoordinatorAgentOperationalState(
    eligibleAgent,
    '2026-08-25T03:00:00.000Z'
  ).state, 'offline')
})

test('workflow signal and attention derive only from canonical Project facts', () => {
  const project = awaitingConfirmationProjectFixture() as ProjectCoordinatorProject
  assert.deepEqual(projectCoordinatorAttentionSummary(project), {
    planConfirmation: 1,
    humanAnswers: 0,
    resultReviews: 0,
    recoveryActions: 0,
    revisionTasks: 0,
    total: 1
  })
  assert.deepEqual(projectCoordinatorFlowStages(project).map(({ id, state }) => ({ id, state })), [
    { id: 'plan', state: 'attention' },
    { id: 'dispatch', state: 'pending' },
    { id: 'execute', state: 'pending' },
    { id: 'review', state: 'pending' },
    { id: 'record', state: 'pending' },
    { id: 'complete', state: 'pending' }
  ])
  assert.notEqual(formatRelativeTime(
    '2026-08-25T01:07:45.000Z',
    Date.parse('2026-08-25T01:08:00.000Z'),
    'en'
  ), '—')
})

test('completed Project meeting package includes only accepted records and artifact refs', () => {
  const base = decisionProjectFixture('completion')
  const acceptedResultId = base.reviews[0]!.submission.resultSubmissionId
  const acceptedArtifactRef = 'a'.repeat(64)
  const completed = {
    ...base,
    project: { ...base.project, status: 'completed' },
    finalSummary: {
      acceptedResultSubmissionIds: [acceptedResultId],
      summary: 'Final bounded summary.'
    },
    reviews: [{
      ...base.reviews[0],
      submission: {
        ...base.reviews[0]!.submission,
        outputs: [{ locatorDigest: acceptedArtifactRef }]
      }
    }],
    records: [{ kind: 'observation' }, { kind: 'observation' }, { kind: 'decision' }]
  } as unknown as ProjectCoordinatorProject
  assert.deepEqual(projectCoordinatorMeetingPackageSummary(completed), {
    acceptedResults: 1,
    observations: 2,
    decisions: 1,
    artifactRefs: [acceptedArtifactRef]
  })
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
    availableWorkerUsers: [],
    projects: [awaitingConfirmationProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return {
        createIntentId: 'pct_RendererCreateIntent1',
        createdProjectId: 'prj_ProjectCreated01',
        workspace: returnedWorkspace
      } as never
    }
  })
  const result = await client.createProject({
    createIntentId: 'pct_RendererCreateIntent1',
    displayName: 'Meeting',
    goal: 'Run a realistic meeting.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  })

  assert.deepEqual(projectCoordinatorCreatedSelection(result), {
    workspace: result.workspace,
    selectedProjectId: 'prj_ProjectCreated01'
  })
  assert.deepEqual(invoked, [{
    actionId: 'project-coordinator.project.create',
    effect: 'external-write',
    input: {
      createIntentId: 'pct_RendererCreateIntent1',
      displayName: 'Meeting',
      goal: 'Run a realistic meeting.',
      budget: {
        maxTasks: 4,
        maxTasksPerRound: 4,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      }
    }
  }])
})

test('renderer Coordinator transfer invokes one governed Owner command without caller-authored CAS facts', async () => {
  const invoked: unknown[] = []
  const workspace = {
    connection: {
      state: 'ready' as const,
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    availableWorkerUsers: [],
    projects: [awaitingConfirmationProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return workspace as never
    }
  })

  await client.transferCoordinator({
    projectId: 'prj_ProjectCreated01',
    coordinatorAgentId: 'agt_OwnerSuccessor1'
  })

  assert.deepEqual(invoked, [{
    actionId: 'project-coordinator.coordinator.transfer',
    effect: 'external-write',
    input: {
      projectId: 'prj_ProjectCreated01',
      coordinatorAgentId: 'agt_OwnerSuccessor1'
    }
  }])
})

test('result artifact navigation materializes through main and opens the generic Content Space resource owner', async () => {
  const invoked: unknown[] = []
  const opened: unknown[] = []
  const host: DomainRendererHost = {
    capabilityInvoker: {
      observe: async () => { throw new Error('not observed') },
      invoke: async (contract, input, options) => {
        invoked.push({ actionId: contract.actionId, effect: contract.effect, input, options })
        return {
          ...input as object,
          resource: {
            kind: 'content-space.file',
            resourceRef: 'res_artifact-review-resource-001'
          }
        } as never
      }
    },
    openExternal: () => undefined,
    workbench: {
      canOpenResource: (kind) => kind === 'content-space.file',
      openResource: (input) => {
        opened.push(input)
        return true
      },
      openRightPanel: () => undefined
    }
  }
  const rendered = createProjectCoordinatorRightPanelContribution(host).render({
    active: true,
    focused: true,
    surfaceId: 'project-coordinator-panel',
    className: 'host-panel',
    onCollapse: () => undefined,
    session: { id: 'session-artifact-review', workspaceRoot: '/workspace/review' }
  }) as ReactElement<{
    onOpenArtifact(input: {
      projectId: string
      taskId: string
      executionId: string
      resultSubmissionId: string
      submissionDigest: string
      outputIndex: number
      locatorDigest: string
    }): Promise<void>
  }>
  const selection = {
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    submissionDigest: 'b'.repeat(64),
    outputIndex: 0,
    locatorDigest: 'c'.repeat(64)
  }

  await rendered.props.onOpenArtifact(selection)

  assert.deepEqual(invoked, [{
    actionId: 'project-coordinator.artifact-review.prepare',
    effect: 'read',
    input: selection,
    options: { workspaceId: '/workspace/review' }
  }])
  assert.equal('locator' in (invoked[0] as { input: object }).input, false)
  assert.deepEqual(opened, [{
    sessionId: 'session-artifact-review',
    placement: 'new',
    resource: {
      resourceKind: 'content-space.file',
      resourceId: 'res_artifact-review-resource-001',
      resourceRef: 'res_artifact-review-resource-001'
    }
  }])
})

test('renderer decision HCI invokes only the four governed canonical actions', async () => {
  const invoked: unknown[] = []
  const workspace = {
    connection: { state: 'ready' as const, userId: 'usr_Owner0000001', deviceId: 'dev_Device0000001' },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    availableWorkerUsers: [],
    projects: [awaitingConfirmationProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return workspace as never
    }
  })

  await client.createHumanNeeded({
    projectId: 'prj_ProjectCreated01',
    targetUserId: 'usr_Owner0000001',
    expectedProjectRevision: 2,
    expectedCoordinatorAuthorityEpoch: 1,
    requiredAssurance: 'verified',
    prompt: 'Choose the lower-risk training direction.',
    expiresAt: '2026-08-26T01:08:00.000Z'
  })
  await client.answerHumanNeeded({
    projectId: 'prj_ProjectCreated01',
    humanRequestId: 'hrq_OwnerDecision01',
    requestRevision: 1,
    answer: 'Use the lower-risk direction.'
  })
  await client.reviewResult({
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    expectedProjectRevision: 2,
    expectedTaskRevision: 3,
    expectedExecutionRevision: 4,
    expectedResultRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    decision: 'accept',
    instruction: null,
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  })
  await client.completeProject({
    projectId: 'prj_ProjectCreated01',
    expectedProjectRevision: 3,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: 'pln_MeetingPlan001',
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: ['rsu_MeetingResult01'],
    summary: 'Resolved the work, recorded the decision, and assigned the next step.'
  })

  assert.deepEqual(invoked.map((entry) => (
    entry as { actionId: string; effect: string }
  )).map(({ actionId, effect }) => ({ actionId, effect })), [
    { actionId: 'project-coordinator.human-needed.create', effect: 'external-write' },
    { actionId: 'project-coordinator.human-needed.answer', effect: 'external-write' },
    { actionId: 'project-coordinator.result.review', effect: 'external-write' },
    { actionId: 'project-coordinator.project.complete', effect: 'external-write' }
  ])
})

test('renderer client carries the reviewed full workflow through its canonical continuation', async () => {
  const invoked: unknown[] = []
  const plan = workflowPlanFixture()
  const workspace = {
    connection: { state: 'ready' as const, userId: 'usr_Owner0000001', deviceId: 'dev_Device0000001' },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: [contentProvisioningProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return (contract.actionId === 'project-coordinator.workflow.prepare'
        ? plan
        : workspace) as never
    }
  })

  const reviewed = await client.prepareWorkflow({ projectId: plan.projectId })
  await client.continueWorkflow(reviewed)
  await client.addMember({
    projectId: plan.projectId,
    expectedProjectRevision: 3,
    userId: 'usr_NewWorker00001',
    providerPrincipalFactId: 'ppf_NewWorker00001',
    expectedProviderPrincipalFactRevision: 2
  })
  await client.acceptInvitation({
    projectId: plan.projectId,
    projectMembershipId: 'pmb_InvitedMember01',
    expectedProjectRevision: 3,
    expectedMembershipRevision: 1,
    projectPlanId: plan.projectPlanId,
    expectedPlanRevision: plan.expectedPlanRevision,
    planDigest: plan.planDigest
  })
  await client.removeMember({
    projectId: plan.projectId,
    projectMembershipId: 'pmb_WorkerMember01',
    expectedProjectRevision: 4,
    expectedMembershipRevision: 2
  })
  await client.observeAndLinkRecovery({
    projectId: plan.projectId,
    recoveryActionId: 'rca_TaskRecovery001'
  })
  await client.abandonRecovery({
    projectId: plan.projectId,
    recoveryActionId: 'rca_TaskRecovery001',
    reason: 'The exact output cannot be verified.'
  })
  await client.retryRecoverySuccessor({
    projectId: plan.projectId,
    recoveryActionId: 'rca_TaskRecovery001',
    workerUserId: 'usr_Worker000001',
    nextOutputFileName: 'meeting-summary.recovery-2.md',
    offerExpiresAt: '2026-08-27T01:08:00.000Z'
  })

  assert.deepEqual(invoked, [
    {
      actionId: 'project-coordinator.workflow.prepare',
      effect: 'read',
      input: { projectId: plan.projectId }
    },
    {
      actionId: 'project-coordinator.workflow.continue',
      effect: 'external-write',
      input: plan
    },
    {
      actionId: 'project-coordinator.membership.add',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        expectedProjectRevision: 3,
        userId: 'usr_NewWorker00001',
        providerPrincipalFactId: 'ppf_NewWorker00001',
        expectedProviderPrincipalFactRevision: 2
      }
    },
    {
      actionId: 'project-coordinator.membership.accept',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        projectMembershipId: 'pmb_InvitedMember01',
        expectedProjectRevision: 3,
        expectedMembershipRevision: 1,
        projectPlanId: plan.projectPlanId,
        expectedPlanRevision: plan.expectedPlanRevision,
        planDigest: plan.planDigest
      }
    },
    {
      actionId: 'project-coordinator.membership.remove',
      effect: 'destructive',
      input: {
        projectId: plan.projectId,
        projectMembershipId: 'pmb_WorkerMember01',
        expectedProjectRevision: 4,
        expectedMembershipRevision: 2
      }
    },
    {
      actionId: 'project-coordinator.content-recovery.observe-link',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        recoveryActionId: 'rca_TaskRecovery001'
      }
    },
    {
      actionId: 'project-coordinator.content-recovery.abandon',
      effect: 'destructive',
      input: {
        projectId: plan.projectId,
        recoveryActionId: 'rca_TaskRecovery001',
        reason: 'The exact output cannot be verified.'
      }
    },
    {
      actionId: 'project-coordinator.content-recovery.retry-successor',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        recoveryActionId: 'rca_TaskRecovery001',
        workerUserId: 'usr_Worker000001',
        nextOutputFileName: 'meeting-summary.recovery-2.md',
        offerExpiresAt: '2026-08-27T01:08:00.000Z'
      }
    }
  ])
  assert.deepEqual((invoked[1] as { input: object }).input, plan)
})

test('content-required provisioning, membership fences, and root recovery are default-visible HCI', () => {
  const project = contentProvisioningProjectFixture()
  const pendingMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorProvisioningSection, {
    project,
    plan: null,
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onPrepareWorkflow: () => undefined,
    onContinueWorkflow: () => undefined,
    onAddMember: () => undefined,
    onAcceptInvitation: () => undefined,
    onRemoveMember: () => undefined,
    onObserveAndLinkRecovery: () => undefined,
    onAbandonRecovery: () => undefined,
    onRetryRecoverySuccessor: () => undefined
  }))
  assert.match(pendingMarkup, /data-default-visible-card="project-workflow"/u)
  assert.match(pendingMarkup, /projectCoordinatorPrepareWorkflow/u)
  assert.match(pendingMarkup, /pending_membership/u)
  assert.match(pendingMarkup, /membership_removal_pending/u)
  assert.match(pendingMarkup, /projectCoordinatorTaskAuthoritySuspended/u)
  assert.match(pendingMarkup, /projectCoordinatorContentReadinessPending/u)
  assert.doesNotMatch(pendingMarkup, />not_applicable</u)
  assert.match(pendingMarkup, /projectCoordinatorAddMember/u)
  assert.match(pendingMarkup, /projectCoordinatorRemoveMember/u)

  const reviewedMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorProvisioningSection, {
    project,
    plan: workflowPlanFixture(),
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onPrepareWorkflow: () => undefined,
    onContinueWorkflow: () => undefined,
    onAddMember: () => undefined,
    onAcceptInvitation: () => undefined,
    onRemoveMember: () => undefined,
    onObserveAndLinkRecovery: () => undefined,
    onAbandonRecovery: () => undefined,
    onRetryRecoverySuccessor: () => undefined
  }))
  assert.match(reviewedMarkup, /data-default-visible-card="project-workflow-confirmation"/u)
  assert.match(reviewedMarkup, /content-space\.authorize-provider-administration/u)
  assert.match(reviewedMarkup, /content-space\.agent-admin-add-member/u)
  assert.match(reviewedMarkup, /projectCoordinatorContinueWorkflow/u)
  assert.match(reviewedMarkup, new RegExp(workflowPlanFixture().workflowDigest, 'u'))

  const contentFreeMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorProvisioningSection, {
    project: awaitingConfirmationProjectFixture(),
    plan: null,
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onPrepareWorkflow: () => undefined,
    onContinueWorkflow: () => undefined,
    onAddMember: () => undefined,
    onAcceptInvitation: () => undefined,
    onRemoveMember: () => undefined,
    onObserveAndLinkRecovery: () => undefined,
    onAbandonRecovery: () => undefined,
    onRetryRecoverySuccessor: () => undefined
  }))
  assert.match(contentFreeMarkup, /projectCoordinatorContentNotRequired/u)
  assert.doesNotMatch(contentFreeMarkup, />not_applicable</u)

  const degraded = {
    ...project,
    provisioning: {
      ...project.provisioning,
      binding: {
        provisioningRevision: 1,
        status: 'degraded',
        statusReason: 'owner_access_lost'
      },
      recoveryActions: [{
        recoveryActionId: 'rca_RootRecovery001',
        projectId: project.project.projectId,
        taskId: null,
        executionId: null,
        journalEntryId: 'crj_RootRecovery001',
        audience: 'owner',
        action: 'rebind_content_root',
        status: 'available',
        requiresFreshObservation: true,
        safeSummary: 'Re-authorize the exact shared root before retrying membership changes.'
      }]
    }
  } as never
  const recoveryMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorProvisioningSection, {
    project: degraded,
    plan: null,
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onPrepareWorkflow: () => undefined,
    onContinueWorkflow: () => undefined,
    onAddMember: () => undefined,
    onAcceptInvitation: () => undefined,
    onRemoveMember: () => undefined,
    onObserveAndLinkRecovery: () => undefined,
    onAbandonRecovery: () => undefined,
    onRetryRecoverySuccessor: () => undefined
  }))
  assert.match(recoveryMarkup, /data-default-visible-card="content-recovery"/u)
  assert.match(recoveryMarkup, /owner_access_lost/u)
  assert.match(recoveryMarkup, /Re-authorize the exact shared root/u)
  assert.match(recoveryMarkup, /projectCoordinatorPrepareReconcileWorkflow/u)

  const taskRecovery = {
    ...project,
    provisioning: {
      ...project.provisioning,
      recoveryActions: [{
        recoveryActionId: 'rca_TaskRecovery001',
        projectId: project.project.projectId,
        taskId: 'tsk_RecoveryTask001',
        executionId: 'exe_RecoveryExec001',
        journalEntryId: 'crj_TaskRecovery001',
        audience: 'coordinator',
        action: 'link_observed_output',
        status: 'available',
        requiresFreshObservation: true,
        safeSummary: 'Observe the exact output or abandon this execution.'
      }]
    }
  } as never
  const taskRecoveryMarkup = renderToStaticMarkup(createElement(
    ProjectCoordinatorProvisioningSection,
    {
      project: taskRecovery,
      plan: null,
      currentUserId: 'usr_Owner0000001',
      busy: false,
      onPrepareWorkflow: () => undefined,
      onContinueWorkflow: () => undefined,
      onAddMember: () => undefined,
      onAcceptInvitation: () => undefined,
      onRemoveMember: () => undefined,
      onObserveAndLinkRecovery: () => undefined,
      onAbandonRecovery: () => undefined,
      onRetryRecoverySuccessor: () => undefined
    }
  ))
  assert.match(taskRecoveryMarkup, /data-task-recovery-action="rca_TaskRecovery001"/u)
  assert.match(taskRecoveryMarkup, /projectCoordinatorObserveAndLinkOutput/u)
  assert.match(taskRecoveryMarkup, /projectCoordinatorAbandonExecution/u)
  assert.match(taskRecoveryMarkup, /projectCoordinatorAbandonReason/u)

  const abandonedTaskRecovery = {
    ...project,
    workerGroups: [{
      userId: 'usr_Worker00000001',
      displayName: 'Worker User',
      agents: [{
        displayName: 'Worker Desktop',
        projectAvailability: {
          agentId: 'agt_WorkerAgent001',
          availability: { revision: 7 }
        }
      }]
    }],
    tasks: [{
      task: {
        taskId: 'tsk_RecoveryTask001',
        currentExecutionId: 'exe_RecoveryExec001',
        status: 'revision_requested',
        fileIntent: {
          schemaVersion: 1,
          bindingRevision: 3,
          inputs: [],
          output: {
            kind: 'content-space.output-new',
            target: 'project-binding-root',
            mode: 'upload-new',
            fileName: 'meeting-summary.recovery-1.md',
            mediaType: 'text/markdown',
            maxBytes: 65_536
          }
        }
      },
      executions: [{
        executionId: 'exe_RecoveryExec001',
        state: 'cancelled',
        fence: { reason: 'manual_recovery_abandoned' }
      }]
    }],
    provisioning: {
      ...project.provisioning,
      recoveryActions: [{
        recoveryActionId: 'rca_TaskRecovery001',
        projectId: project.project.projectId,
        taskId: 'tsk_RecoveryTask001',
        executionId: 'exe_RecoveryExec001',
        journalEntryId: 'crj_TaskRecovery001',
        audience: 'coordinator',
        action: 'link_observed_output',
        status: 'completed',
        requiresFreshObservation: true,
        safeSummary: 'The uncertain execution was abandoned and requires a fresh successor.'
      }]
    }
  } as never
  const successorMarkup = renderToStaticMarkup(createElement(
    ProjectCoordinatorProvisioningSection,
    {
      project: abandonedTaskRecovery,
      plan: null,
      currentUserId: 'usr_Owner0000001',
      busy: false,
      onPrepareWorkflow: () => undefined,
      onContinueWorkflow: () => undefined,
      onAddMember: () => undefined,
      onAcceptInvitation: () => undefined,
      onRemoveMember: () => undefined,
      onObserveAndLinkRecovery: () => undefined,
      onAbandonRecovery: () => undefined,
      onRetryRecoverySuccessor: () => undefined
    }
  ))
  assert.match(successorMarkup, /data-default-visible-card="content-recovery-successor"/u)
  assert.match(successorMarkup, /name="next-output-file-name"/u)
  assert.match(successorMarkup, /projectCoordinatorApproveRecoveryRetry/u)
})

test('an awaiting-confirmation Plan renders its Owner action as a default-visible card', () => {
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: awaitingConfirmationProjectFixture(),
    draft: null,
    observedAt: '2026-08-25T01:08:00.000Z',
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    canConfirm: true,
    currentUserId: 'usr_Owner0000001',
    providerPrincipalFacts: [],
    initialContentMode: 'none',
    initialProviderFactId: '',
    onInitialContentMode: () => undefined,
    onInitialProviderFactId: () => undefined,
    onConfirm: () => undefined
  }))

  assert.match(markup, /data-default-visible-card="plan-confirmation"/u)
  assert.match(markup, /projectCoordinatorConfirmPlan/u)
})

test('a local Plan draft exposes full content editing before immutable submit', () => {
  const project = planningProjectFixture('draft')
  const task = project.plan.plan.tasks[0]!
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: { ...project, plan: null },
    draft: {
      draftId: 'draft_MeetingPlan01',
      draftRevision: 1,
      projectId: project.project.projectId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      supersedesProjectPlanId: null,
      sourceInputLocators: [],
      tasks: [task],
      rationale: project.plan.plan.rationale,
      runtimeProvenance: project.plan.plan.runtimeProvenance,
      assignments: [{
        planItemId: task.planItemId,
        workerUserId: null,
        recommendationReason: null
      }],
      createdAt: project.project.createdAt,
      updatedAt: project.project.updatedAt
    },
    observedAt: '2026-08-25T01:08:00.000Z',
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    canConfirm: false,
    currentUserId: 'usr_Owner0000001',
    providerPrincipalFacts: [],
    initialContentMode: 'none',
    initialProviderFactId: '',
    onInitialContentMode: () => undefined,
    onInitialProviderFactId: () => undefined,
    onConfirm: () => undefined
  }))

  assert.match(markup, /name="plan-rationale"/u)
  assert.match(markup, /name="plan-item-title-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-objective-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-criteria-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-dependencies-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-capabilities-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-user-item_meeting_summary"/u)
  assert.match(markup, /data-planning-eligible="true"/u)
  assert.match(markup, /projectCoordinatorSavePlanEdits/u)
})

test('a paused Project keeps a Worker option enabled for project_paused prospective authority', () => {
  const project = planningProjectFixture('paused')
  const task = project.plan.plan.tasks[0]!
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: { ...project, plan: null },
    draft: {
      draftId: 'draft_MeetingReplan01',
      draftRevision: 1,
      projectId: project.project.projectId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      supersedesProjectPlanId: project.plan.plan.projectPlanId,
      sourceInputLocators: [],
      tasks: [task],
      rationale: project.plan.plan.rationale,
      runtimeProvenance: project.plan.plan.runtimeProvenance,
      assignments: [{
        planItemId: task.planItemId,
        workerUserId: null,
        recommendationReason: null
      }],
      createdAt: project.project.createdAt,
      updatedAt: project.project.updatedAt
    },
    observedAt: '2026-08-25T01:08:00.000Z',
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    canConfirm: false,
    currentUserId: 'usr_Owner0000001',
    providerPrincipalFacts: [],
    initialContentMode: 'none',
    initialProviderFactId: '',
    onInitialContentMode: () => undefined,
    onInitialProviderFactId: () => undefined,
    onConfirm: () => undefined
  }))

  assert.match(markup, /value="usr_ProjectMember01" data-planning-eligible="true"/u)
})

test('file Plan editing can clear the logical declaration and confirmation requires Team content', () => {
  const draftProject = planningProjectFixture('draft')
  const logicalFileTask = {
    ...draftProject.plan.plan.tasks[0]!,
    fileIntent: {
      schemaVersion: 1 as const,
      inputs: [],
      output: {
        kind: 'content-space.output-new' as const,
        target: 'project-binding-root' as const,
        mode: 'upload-new' as const,
        fileName: 'meeting-summary.md',
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    }
  }
  const draftMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: { ...draftProject, plan: null },
    draft: {
      draftId: 'draft_FilePlan001',
      draftRevision: 1,
      projectId: draftProject.project.projectId,
      expectedProjectRevision: draftProject.project.revision,
      expectedCoordinatorAuthorityEpoch: draftProject.project.coordinatorAuthorityEpoch,
      supersedesProjectPlanId: null,
      sourceInputLocators: [],
      tasks: [logicalFileTask],
      rationale: draftProject.plan.plan.rationale,
      runtimeProvenance: draftProject.plan.plan.runtimeProvenance,
      assignments: [{
        planItemId: logicalFileTask.planItemId,
        workerUserId: null,
        recommendationReason: null
      }],
      createdAt: draftProject.project.createdAt,
      updatedAt: draftProject.project.updatedAt
    },
    observedAt: draftProject.project.updatedAt,
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    canConfirm: false,
    currentUserId: draftProject.project.ownerUserId,
    providerPrincipalFacts: [],
    initialContentMode: 'none',
    initialProviderFactId: '',
    onInitialContentMode: () => undefined,
    onInitialProviderFactId: () => undefined,
    onConfirm: () => undefined
  }))
  assert.match(draftMarkup, /name="plan-item-file-enabled-item_meeting_summary"/u)
  assert.match(draftMarkup, /projectCoordinatorKeepFileDeclaration/u)

  const confirmationProject = {
    ...draftProject,
    plan: {
      ...draftProject.plan,
      plan: {
        ...draftProject.plan.plan,
        tasks: [logicalFileTask]
      }
    }
  }
  const confirmationMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: confirmationProject,
    draft: null,
    observedAt: draftProject.project.updatedAt,
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    canConfirm: true,
    currentUserId: draftProject.project.ownerUserId,
    providerPrincipalFacts: [],
    initialContentMode: 'none',
    initialProviderFactId: '',
    onInitialContentMode: () => undefined,
    onInitialProviderFactId: () => undefined,
    onConfirm: () => undefined
  }))
  assert.match(confirmationMarkup, /data-content-required-by-plan="true"/u)
  assert.match(confirmationMarkup, /<select[^>]*disabled[^>]*data-content-required-by-plan="true"/u)
})

test('pending HumanNeeded, result review, and eligible completion are default-visible decision cards', () => {
  const pendingMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: decisionProjectFixture('pending-human'),
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(pendingMarkup, /data-default-visible-card="human-needed"/u)
  assert.match(pendingMarkup, /projectCoordinatorSubmitHumanAnswer/u)

  const reviewMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: decisionProjectFixture('review'),
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(reviewMarkup, /data-default-visible-card="result-review"/u)
  assert.match(reviewMarkup, /projectCoordinatorAcceptResult/u)
  assert.match(reviewMarkup, /projectCoordinatorRequestRevision/u)

  const artifactProject = decisionProjectFixture('review')
  artifactProject.reviews[0]!.submission.outputs.push({
    executionId: 'exe_MeetingExec001',
    assignmentTaskRevision: 3,
    locator: {
      contractVersion: 1,
      kind: 'content-space.file-reference',
      authority: 'opencontent.run0',
      identity: { fileId: 'provider-file-output-001' }
    },
    locatorDigest: 'c'.repeat(64),
    rootLocatorDigest: 'd'.repeat(64),
    bindingRevision: 4,
    transferReceiptDigest: 'e'.repeat(64),
    observationDigest: 'f'.repeat(64),
    preflightObservationDigest: 'a'.repeat(64)
  })
  const artifactMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: artifactProject,
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onOpenArtifact: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(artifactMarkup, /data-artifact-review-output="0"/u)
  assert.match(artifactMarkup, /projectCoordinatorOpenArtifactInContentSpace/u)

  const askMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: {
      ...decisionProjectFixture('completion'),
      records: []
    } as never,
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(askMarkup, /data-default-visible-card="human-needed-create"/u)
  assert.match(askMarkup, /name="target-user"/u)
  assert.match(askMarkup, /value="usr_ProjectMember01"/u)
  assert.match(askMarkup, /projectCoordinatorAskMember/u)

  const completionMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: decisionProjectFixture('completion'),
    currentUserId: 'usr_Owner0000001',
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(completionMarkup, /data-default-visible-card="project-completion"/u)
  assert.match(completionMarkup, /projectCoordinatorCompleteProject/u)
})

test('decision HCI derives exact review and completion CAS facts from the visible Cloud snapshot', () => {
  const reviewProject = decisionProjectFixture('review')
  const accepted = projectCoordinatorResultReviewInput(
    reviewProject,
    'rsu_MeetingResult01',
    'accept',
    {
      instruction: '',
      nextWorkerUserId: '',
      nextOfferExpiresAt: '',
      nextOutputFileName: ''
    }
  )
  const fileIntent = {
    schemaVersion: 1 as const,
    bindingRevision: 3,
    inputs: [],
    output: {
      kind: 'content-space.output-new' as const,
      target: 'project-binding-root' as const,
      mode: 'upload-new' as const,
      fileName: 'training-plan-comparison.revision-1.md',
      mediaType: 'text/markdown',
      maxBytes: 65_536
    }
  }
  const fileReviewProject = {
    ...reviewProject,
    tasks: [{
      ...reviewProject.tasks[0],
      task: { ...reviewProject.tasks[0]!.task, fileIntent }
    }],
    workerGroups: [{
      userId: 'usr_Worker0000002',
      displayName: 'Worker User 2',
      agents: [{
        projectAvailability: {
          agentId: 'agt_Worker0000002',
          availability: { revision: 7 }
        }
      }]
    }]
  } as never
  const revised = projectCoordinatorResultReviewInput(
    fileReviewProject,
    'rsu_MeetingResult01',
    'request_revision',
    {
      instruction: 'Re-run with the confirmed assumptions.',
      nextWorkerUserId: 'usr_Worker0000002',
      nextOfferExpiresAt: '2026-08-26T01:08:00.000Z',
      nextOutputFileName: 'training-plan-comparison.revision-2.md'
    }
  )
  assert.deepEqual(accepted, {
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    expectedProjectRevision: 8,
    expectedTaskRevision: 3,
    expectedExecutionRevision: 4,
    expectedResultRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    decision: 'accept',
    instruction: null,
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  })
  assert.equal(revised?.nextWorkerUserId, 'usr_Worker0000002')
  assert.deepEqual(revised?.nextFileIntent, {
    ...fileIntent,
    output: {
      ...fileIntent.output,
      fileName: 'training-plan-comparison.revision-2.md'
    }
  })
  assert.equal(projectCoordinatorResultReviewInput(
    fileReviewProject,
    'rsu_MeetingResult01',
    'request_revision',
    {
      instruction: 'Re-run with the confirmed assumptions.',
      nextWorkerUserId: 'usr_Worker0000002',
      nextOfferExpiresAt: '2026-08-26T01:08:00.000Z',
      nextOutputFileName: fileIntent.output.fileName
    }
  ), null)

  const completionProject = decisionProjectFixture('completion')
  assert.deepEqual(projectCoordinatorCompletionInput(completionProject, 'Final bounded summary.'), {
    projectId: 'prj_ProjectCreated01',
    expectedProjectRevision: 8,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: 'pln_MeetingPlan001',
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: ['rsu_MeetingResult01'],
    summary: 'Final bounded summary.'
  })
  assert.equal(projectCoordinatorCompletionInput({
    ...completionProject,
    records: []
  } as never, 'Final bounded summary.'), null)
})

function workspaceSection(
  contributionId: string,
  ownerId: string,
  contract: Readonly<{
    workspaceId?: string
    sectionId: string
    label: string
    description?: string
    placement: 'navigation' | 'settings'
    order: number
  }>
): ProjectCoordinatorWorkspaceSection {
  return Object.freeze({
    location: WORKBENCH_WORKSPACE_SECTION_LOCATION,
    contractVersion: WORKBENCH_WORKSPACE_SECTION_CONTRACT_VERSION,
    workspaceId: contract.workspaceId ?? SCIFORGE_COLLABORATION_CENTER_WORKSPACE_ID,
    sectionId: contract.sectionId,
    label: contract.label,
    ...(contract.description ? { description: contract.description } : {}),
    placement: contract.placement,
    order: contract.order,
    contributionId,
    ownerId,
    render: ({ className }) => createElement('div', { className })
  })
}

function rendererContribution(
  contributionId: string,
  ownerId: string,
  contract: Readonly<{
    workspaceId?: string
    sectionId: string
    label: string
    description?: string
    placement: 'navigation' | 'settings'
    order: number
  }>
): DomainRendererContribution {
  const section = workspaceSection(contributionId, ownerId, contract)
  return Object.freeze({
    id: contributionId,
    kind: RENDERER_EXTENSION_CONTRIBUTION_KIND,
    packageName: `@fixture/${ownerId}`,
    owner: Object.freeze({ moduleId: ownerId, moduleVersion: '1.0.0' }),
    contract: Object.freeze({
      location: section.location,
      contractVersion: section.contractVersion,
      workspaceId: section.workspaceId,
      sectionId: section.sectionId,
      label: section.label,
      ...(section.description ? { description: section.description } : {}),
      placement: section.placement,
      order: section.order
    }),
    value: Object.freeze({ render: section.render })
  })
}

function rendererHostWithContributions(
  contributions: readonly DomainRendererContribution[]
): DomainRendererHost {
  return {
    ...rendererHost([]),
    contributions: {
      list: (kind) => kind === RENDERER_EXTENSION_CONTRIBUTION_KIND
        ? contributions
        : []
    }
  }
}

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

function coordinatorTransferProjectFixture(): ProjectCoordinatorProject {
  const base = awaitingConfirmationProjectFixture()
  const availability = (userId: string, agentId: string, revision: number) => ({
    schemaVersion: 1 as const,
    type: 'project_worker_availability_view' as const,
    projectId: base.project.projectId,
    userId,
    agentId,
    revision,
    availability: {
      schemaVersion: 1 as const,
      type: 'worker_availability_projection' as const,
      userId,
      agentId,
      deviceId: `dev_${agentId.slice(4)}`,
      agentActive: true,
      deviceActive: true,
      connectionStatus: 'online' as const,
      lastHeartbeatAt: base.project.updatedAt,
      runtimeReadiness: 'ready' as const,
      runtimeCapabilityTags: ['research.execute'],
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: base.project.updatedAt,
      expiresAt: '2026-08-25T02:08:00.000Z',
      revision,
      createdAt: base.project.createdAt,
      updatedAt: base.project.updatedAt
    },
    membership: {
      schemaVersion: 1 as const,
      type: 'project_membership' as const,
      projectMembershipId: userId === base.project.ownerUserId
        ? 'pmb_OwnerMember001'
        : 'pmb_OtherMember001',
      projectId: base.project.projectId,
      userId,
      state: 'active' as const,
      authorityEpoch: 1,
      activatedAt: base.project.createdAt,
      removalRequestedAt: null,
      removalRequestedByUserId: null,
      removedAt: null,
      revision: 1,
      createdAt: base.project.createdAt,
      updatedAt: base.project.updatedAt
    },
    taskAuthorities: [],
    providerPrincipalFact: null,
    providerPrincipalSnapshotStatus: 'not_applicable' as const,
    contentReadiness: null,
    observedAt: base.project.updatedAt
  })
  return {
    ...base,
    coordinatorTransferFeedback: {
      projectId: base.project.projectId,
      inboxMessageId: 'ibx_TransferInbox01',
      recipientAgentId: 'agt_PreviousCoord01',
      previousCoordinatorAgentId: 'agt_PreviousCoord01',
      coordinatorAgentId: base.project.coordinatorAgentId,
      coordinatorAuthorityEpoch: base.project.coordinatorAuthorityEpoch,
      projectRevision: 1,
      disposition: 'authority_transferred_out',
      observedAt: base.project.updatedAt
    },
    workerGroups: [{
      userId: base.project.ownerUserId,
      displayName: 'Project Owner',
      agents: [{
        displayName: 'Current Coordinator Desktop',
        projectAvailability: availability(
          base.project.ownerUserId,
          base.project.coordinatorAgentId,
          6
        )
      }, {
        displayName: 'Owner Successor Desktop',
        projectAvailability: availability(
          base.project.ownerUserId,
          'agt_OwnerSuccessor1',
          7
        )
      }]
    }, {
      userId: 'usr_ProjectMember01',
      displayName: 'Project Member',
      agents: [{
        displayName: 'Member Desktop',
        projectAvailability: availability(
          'usr_ProjectMember01',
          'agt_MemberAgent001',
          9
        )
      }]
    }]
  } as ProjectCoordinatorProject
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
    memberUsers: [{
      schemaVersion: 1 as const,
      type: 'project_user_label_fact' as const,
      projectId: 'prj_ProjectCreated01',
      userId: 'usr_Owner0000001',
      displayName: 'Project Owner',
      status: 'active' as const,
      revision: 1,
      observedAt: updatedAt
    }, {
      schemaVersion: 1 as const,
      type: 'project_user_label_fact' as const,
      projectId: 'prj_ProjectCreated01',
      userId: 'usr_ProjectMember01',
      displayName: 'Project Member',
      status: 'active' as const,
      revision: 1,
      observedAt: updatedAt
    }],
    workerGroups: [],
    tasks: [],
    offers: [],
    reviews: [],
    pendingHumanNeeded: [],
    records: [],
    finalSummary: null,
    coordinatorTransferFeedback: null,
    provisioning: {
      intent: null,
      attestation: null,
      binding: null,
      memberships: [{
        schemaVersion: 1 as const,
        type: 'project_membership' as const,
        projectMembershipId: 'pmb_ProjectOwner001',
        projectId: 'prj_ProjectCreated01',
        userId: 'usr_Owner0000001',
        state: 'active' as const,
        authorityEpoch: 1,
        activatedAt: createdAt,
        removalRequestedAt: null,
        removalRequestedByUserId: null,
        removedAt: null,
        revision: 1,
        createdAt,
        updatedAt
      }, {
        schemaVersion: 1 as const,
        type: 'project_membership' as const,
        projectMembershipId: 'pmb_ProjectMember001',
        projectId: 'prj_ProjectCreated01',
        userId: 'usr_ProjectMember01',
        state: 'active' as const,
        authorityEpoch: 1,
        activatedAt: createdAt,
        removalRequestedAt: null,
        removalRequestedByUserId: null,
        removedAt: null,
        revision: 1,
        createdAt,
        updatedAt
      }],
      providerPrincipalFacts: [],
      contentReadiness: [],
      providerMembershipObservations: [],
      externalOperationJournal: [],
      recoveryActions: []
    }
  }
}

function planningProjectFixture(
  status: 'draft' | 'paused'
): ProjectCoordinatorProject & {
  plan: NonNullable<ProjectCoordinatorProject['plan']>
} {
  const base = awaitingConfirmationProjectFixture()
  const userId = 'usr_ProjectMember01'
  const agentId = 'agt_MemberAgent001'
  return {
    ...base,
    project: {
      ...base.project,
      status
    },
    workerGroups: [{
      userId,
      displayName: 'Project Member',
      agents: [{
        displayName: 'Member Desktop',
        projectAvailability: {
          schemaVersion: 1,
          type: 'project_worker_availability_view',
          projectId: base.project.projectId,
          userId,
          agentId,
          revision: 1,
          availability: {
            schemaVersion: 1,
            type: 'worker_availability_projection',
            userId,
            agentId,
            deviceId: 'dev_MemberDevice001',
            agentActive: true,
            deviceActive: true,
            connectionStatus: 'online',
            lastHeartbeatAt: base.project.updatedAt,
            runtimeReadiness: 'ready',
            runtimeCapabilityTags: ['meeting.review'],
            acceptsNewOffers: true,
            activeTaskCount: 0,
            observedAt: base.project.updatedAt,
            expiresAt: '2026-08-25T02:08:00.000Z',
            revision: 1,
            createdAt: base.project.createdAt,
            updatedAt: base.project.updatedAt
          },
          membership: status === 'draft'
            ? null
            : {
                ...base.provisioning.memberships[1]!,
                state: 'active'
              },
          taskAuthorities: status === 'draft'
            ? []
            : [{
                schemaVersion: 1,
                type: 'task_authority',
                taskAuthorityId: 'tau_MemberText001',
                projectId: base.project.projectId,
                userId,
                scope: 'text_tasks',
                state: 'suspended',
                authorityEpoch: 1,
                reason: 'project_paused',
                effectiveAt: base.project.createdAt,
                revision: 1,
                createdAt: base.project.createdAt,
                updatedAt: base.project.updatedAt
              }],
          providerPrincipalFact: null,
          providerPrincipalSnapshotStatus: 'not_applicable',
          contentReadiness: null,
          observedAt: base.project.updatedAt
        }
      }]
    }]
  } as ProjectCoordinatorProject & {
    plan: NonNullable<ProjectCoordinatorProject['plan']>
  }
}

function workflowPlanFixture() {
  const provisioning = finiteProvisioningPlanFixture()
  return {
    projectId: provisioning.projectId,
    projectPlanId: 'pln_MeetingPlan001',
    expectedProjectRevision: provisioning.expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    expectedPlanRevision: 2,
    planDigest: 'a'.repeat(64),
    purpose: 'launch' as const,
    provisioning,
    workflowDigest: 'f'.repeat(64)
  }
}

function finiteProvisioningPlanFixture() {
  return {
    projectId: 'prj_ProjectCreated01',
    provisioningIntentId: 'pvi_ContentIntent001',
    expectedProjectRevision: 3,
    expectedProvisioningRevision: 2,
    expectedProvisioningIntentRevision: 1,
    intentDigest: 'c'.repeat(64),
    attemptId: 'attempt_Provisioning001',
    rootStrategy: 'create' as const,
    providerInstance: {
      schemaVersion: 1 as const,
      type: 'provider_instance_reference' as const,
      providerInstanceRef: 'opencontent.run0'
    },
    containerDisplayName: 'Meeting Project',
    currentRootLocator: null,
    operations: [{
      operationId: 'authorize-provider',
      actionId: 'content-space.authorize-provider-administration',
      kind: 'authorize_provider' as const,
      userId: null
    }, {
      operationId: 'add-member-worker',
      actionId: 'content-space.agent-admin-add-member',
      kind: 'add_member' as const,
      userId: 'usr_Worker00000001'
    }],
    confirmedPlanDigest: 'd'.repeat(64)
  }
}

function contentProvisioningProjectFixture(): ProjectCoordinatorProject {
  const base = awaitingConfirmationProjectFixture()
  const timestamp = base.project.updatedAt
  const membership = (
    userId: string,
    projectMembershipId: string,
    state: 'active' | 'pending_membership' | 'membership_removal_pending'
  ) => ({
    schemaVersion: 1 as const,
    type: 'project_membership' as const,
    projectMembershipId,
    projectId: base.project.projectId,
    userId,
    state,
    authorityEpoch: 1,
    activatedAt: state === 'pending_membership' ? null : timestamp,
    removalRequestedAt: state === 'membership_removal_pending' ? timestamp : null,
    removalRequestedByUserId: state === 'membership_removal_pending'
      ? base.project.ownerUserId
      : null,
    removedAt: null,
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  const principalFact = (userId: string, providerPrincipalFactId: string) => ({
    schemaVersion: 1 as const,
    type: 'provider_directory_principal_fact' as const,
    providerPrincipalFactId,
    userId,
    providerPrincipal: {
      schemaVersion: 1 as const,
      type: 'provider_directory_principal_reference' as const,
      providerInstance: 'opencent-run0',
      principalKind: 'user' as const,
      principalId: `principal-${userId}`
    },
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: 'e'.repeat(64),
    publishedByDeviceId: 'dev_Device0000001',
    readiness: 'ready' as const,
    readinessReason: null,
    observedAt: timestamp,
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  return {
    ...base,
    project: {
      ...base.project,
      contentMode: 'required',
      revision: 3
    },
    plan: {
      ...base.plan,
      plan: {
        ...base.plan.plan,
        state: 'confirmed' as const,
        revision: 2,
        confirmedByUserId: base.project.ownerUserId,
        confirmedAt: timestamp
      }
    },
    provisioning: {
      intent: {
        state: 'pending',
        provisioningRevision: 2
      },
      attestation: null,
      binding: null,
      memberships: [
        membership(base.project.ownerUserId, 'pmb_OwnerMember001', 'active'),
        membership('usr_Worker00000001', 'pmb_WorkerMember01', 'pending_membership'),
        membership('usr_RemoveWorker001', 'pmb_RemoveMember001', 'membership_removal_pending')
      ],
      providerPrincipalFacts: [
        principalFact(base.project.ownerUserId, 'ppf_OwnerFact00001'),
        principalFact('usr_Worker00000001', 'ppf_WorkerFact0001'),
        principalFact('usr_NewWorker00001', 'ppf_NewWorker00001')
      ],
      contentReadiness: [],
      providerMembershipObservations: [],
      externalOperationJournal: [],
      recoveryActions: []
    }
  } as never
}

function decisionProjectFixture(
  state: 'pending-human' | 'review' | 'completion'
): ProjectCoordinatorProject {
  const base = awaitingConfirmationProjectFixture()
  const timestamp = base.project.updatedAt
  const task = {
    schemaVersion: 1 as const,
    revision: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task' as const,
    taskId: 'tsk_MeetingTask001',
    projectId: base.project.projectId,
    createdByCoordinatorAgentId: base.project.coordinatorAgentId,
    title: 'Compare training plans',
    objective: 'Compare cost and risk.',
    completionCriteria: ['Provide a bounded comparison.'],
    dependencyTaskIds: [],
    fileIntent: null,
    currentExecutionId: 'exe_MeetingExec001',
    currentExecutionState: state === 'completion' ? 'completed' as const : 'result_submitted' as const,
    status: state === 'completion' ? 'completed' as const : 'awaiting_review' as const,
    executionCount: 1,
    maxRetries: 2,
    completedAt: state === 'completion' ? timestamp : null
  }
  const execution = {
    schemaVersion: 1 as const,
    revision: 4,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task_execution' as const,
    projectId: base.project.projectId,
    taskId: task.taskId,
    executionId: task.currentExecutionId,
    attempt: 1,
    offeredByCoordinatorAgentId: base.project.coordinatorAgentId,
    assigneeUserId: 'usr_Worker00000001',
    assigneeAgentId: 'agt_Worker0000001',
    assigneeDeviceId: 'dev_Worker0000001',
    state: task.currentExecutionState,
    stateRevision: 4,
    fence: {},
    fileIntent: null,
    currentResultSubmissionId: 'rsu_MeetingResult01',
    offeredAt: timestamp,
    acceptedAt: timestamp,
    startedAt: timestamp,
    terminalAt: timestamp
  }
  const submission = {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task_result_submission' as const,
    resultSubmissionId: 'rsu_MeetingResult01',
    projectId: base.project.projectId,
    taskId: task.taskId,
    executionId: task.currentExecutionId,
    submittedTaskRevision: 3,
    submittedExecutionRevision: 4,
    submittedByUserId: execution.assigneeUserId,
    submittedByAgentId: execution.assigneeAgentId,
    summary: 'The lower-cost plan has bounded operational risk.',
    runtimeProvenance: {},
    outputs: [],
    recoveryJournalEntryIds: [],
    submittedAt: timestamp,
    submissionDigest: 'b'.repeat(64)
  }
  const acceptedDecision = state === 'completion' ? {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task_review_decision' as const,
    reviewDecisionId: 'rvw_MeetingReview01',
    projectId: base.project.projectId,
    taskId: task.taskId,
    executionId: task.currentExecutionId,
    resultSubmissionId: submission.resultSubmissionId,
    reviewedResultRevision: 1,
    decidedByUserId: base.project.ownerUserId,
    decidedByCoordinatorAgentId: base.project.coordinatorAgentId,
    decision: 'accept' as const,
    instruction: null,
    acceptedProjectRecordId: 'rec_Observation0001',
    nextTaskOfferId: null,
    decidedAt: timestamp
  } : null
  return {
    ...base,
    project: { ...base.project, status: 'active' as const, revision: 8 },
    plan: {
      ...base.plan,
      plan: {
        ...base.plan.plan,
        state: 'confirmed' as const,
        revision: 2,
        confirmedByUserId: base.project.ownerUserId,
        confirmedAt: timestamp
      }
    },
    tasks: state === 'pending-human' ? [] : [{ task, executions: [execution] }],
    reviews: state === 'pending-human' ? [] : [{ submission, decision: acceptedDecision }],
    pendingHumanNeeded: state === 'pending-human' ? [{
      schemaVersion: 1 as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      type: 'human_needed' as const,
      humanRequestId: 'hrq_OwnerDecision01',
      projectId: base.project.projectId,
      context: { scope: 'coordinator_project' as const, coordinatorAuthorityEpoch: 1 },
      targetUserId: base.project.ownerUserId,
      requestedByAgentId: base.project.coordinatorAgentId,
      requiredAssurance: 'verified' as const,
      prompt: 'Choose the lower-risk direction.',
      confirmableAction: null,
      status: 'pending' as const,
      expiresAt: '2026-08-26T01:08:00.000Z'
    }] : [],
    records: state === 'completion' ? [{
      kind: 'decision' as const,
      projectId: base.project.projectId
    }] : []
  } as unknown as ProjectCoordinatorProject
}
