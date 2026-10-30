import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCollaborationError,
  projectRequirementsDocumentSchema,
  type Project,
  type ProjectRequirementsDocument,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import type {
  AuthenticatedCloudRequest,
  AuthenticatedCloudResponse,
  AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type {
  DomainMainAgentExecutionHost,
  DomainMainAgentExecutionRequest
} from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import {
  coordinatorCloudCommandSchema,
  type CoordinatorCloudCommand,
  type CoordinatorCloudCommandService
} from '../coordinator-cloud-command.js'
import { DurableCloudOutbox } from '../main/outbox.js'
import { CollaborationLocalStore, EMPTY_COLLABORATION_LOCAL_STATE } from '../main/store.js'
import { createTestAgentCloudRuntime } from '../main/test-agent-cloud-runtime.js'

import {
  createProjectCoordinatorCloudWorkspacePort,
  createProjectCoordinatorRequirementsPort,
  ProjectCoordinatorRequirementsCompletionError,
  type ProjectCoordinatorWorkspacePort
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

const createdAt = '2026-08-25T01:00:00.000Z'
const updatedAt = '2026-08-25T01:05:00.000Z'
const projectId = 'prj_Requirements01'
const ownerUserId = 'usr_Owner0000001'
const coordinatorAgentId = 'agt_Coordinator01'
const workerUserId = 'usr_Worker000001'
const workerAgentId = 'agt_Worker000001'
const workerDeviceId = 'dev_Worker000001'
const workerCapabilityTags = ['agent-runtime.codex', 'model-access.api'] as const

const project = {
  schemaVersion: 1 as const,
  revision: 7,
  createdAt,
  updatedAt,
  type: 'project' as const,
  projectId,
  ownerUserId,
  displayName: 'Requirements meeting',
  goal: 'Run one realistic multi-user meeting.',
  coordinatorAgentId,
  coordinatorAuthorityEpoch: 2,
  executionAuthorityEpoch: 1,
  status: 'active' as const,
  budget: { maxTasks: 8, maxTasksPerRound: 4, maxTaskRetries: 2, maxCoordinationRounds: 4 }
}

function requirementsDocument(input: Readonly<{
  requirementsDocumentId: string
  documentRevision: number
  state: 'draft' | 'confirmed' | 'superseded'
  revision: number
  digest: string
}>) {
  return projectRequirementsDocumentSchema.parse({
    schemaVersion: 1,
    revision: input.revision,
    createdAt,
    updatedAt,
    type: 'project_requirements_document',
    requirementsDocumentId: input.requirementsDocumentId,
    projectId,
    documentRevision: input.documentRevision,
    state: input.state,
    goalsDeliverables: 'Goal: annotated cells. Deliverable: annotation table.',
    inputsBoundaries: 'Input: the exact QC matrix. Boundary: no new sampling.',
    inputReferences: [],
    workModules: [{
      planItemId: 'item_qc', title: 'Quality control',
      objective: 'Run the exact QC pipeline.', dependencyPlanItemIds: []
    }],
    acceptanceCriteria: [
      { target: 'item_qc', criteria: 'The QC report exists.', evidenceMethod: 'Published Drive object.' },
      { target: '$project', criteria: 'Every module accepted.', evidenceMethod: 'Owner review.' }
    ],
    contentDigest: input.digest,
    confirmedByUserId: input.state === 'draft' ? null : ownerUserId,
    confirmedAt: input.state === 'draft' ? null : updatedAt,
    supersededAt: input.state === 'superseded' ? updatedAt : null
  })
}

const draftDocument = requirementsDocument({
  requirementsDocumentId: 'rqd_RequirementsDraft001',
  documentRevision: 2, state: 'draft', revision: 3, digest: 'd'.repeat(64)
})
const completedDocument = projectRequirementsDocumentSchema.parse({
  ...draftDocument, revision: draftDocument.revision + 1, contentDigest: 'e'.repeat(64)
})
const confirmedDocument = requirementsDocument({
  requirementsDocumentId: 'rqd_RequirementsConfirm1',
  documentRevision: 1, state: 'confirmed', revision: 2, digest: 'c'.repeat(64)
})
const supersededDocument = requirementsDocument({
  requirementsDocumentId: 'rqd_RequirementsSupersede',
  documentRevision: 1, state: 'superseded', revision: 3, digest: 'b'.repeat(64)
})

function response(status: number, body: AuthenticatedCloudResponse['body']): AuthenticatedCloudResponse {
  return { contractVersion: 1 as const, status, body }
}

function coordinationResponse(documents: readonly ProjectRequirementsDocument[], currentProject: Project = project): AuthenticatedCloudResponse {
  return response(200, {
    protocolVersion: '1.0',
    type: 'rest.project_coordination',
    requestId: 'req_RequirementsRead01',
    project: currentProject,
    observedAt: updatedAt,
    pages: [{ collection: 'requirements_documents', limit: 250, items: [...documents] }],
    finalSummary: null
  })
}

function transportFixture(
  documents: readonly ProjectRequirementsDocument[] | (() => readonly ProjectRequirementsDocument[]),
  writes: AuthenticatedCloudRequest[],
  writeResponses?: Partial<Record<string, AuthenticatedCloudResponse['body']>>,
  onWrite?: (type: string) => void,
  servedProject: () => Project = () => project
): AuthenticatedCloudTransport {
  const servedDocuments = typeof documents === 'function' ? documents : () => documents
  return {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: ownerUserId,
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
    }),
    execute: async (request) => {
      const payload = request.payload as { type: string, requestId: string }
      switch (payload.type) {
        case 'project.list':
          return response(200, {
            protocolVersion: '1.0', type: 'rest.project_page', requestId: payload.requestId,
            limit: 250, projects: [servedProject()], observedAt: updatedAt
          })
        case 'worker.availability.list':
          return response(200, {
            protocolVersion: '1.0', type: 'rest.worker_availability_page', requestId: payload.requestId,
            observedAt: updatedAt,
            items: [{
              schemaVersion: 1, revision: 1, createdAt, updatedAt,
              type: 'worker_availability_projection', userId: workerUserId,
              agentId: workerAgentId, deviceId: workerDeviceId,
              agentActive: true, deviceActive: true, connectionStatus: 'online',
              lastHeartbeatAt: updatedAt, runtimeReadiness: 'ready',
              runtimeCapabilityTags: [...workerCapabilityTags],
              acceptsNewOffers: true, activeTaskCount: 0,
              observedAt: updatedAt, expiresAt: '2026-08-25T02:00:00.000Z'
            }],
            userLabels: [{
              userId: workerUserId, displayName: 'Worker One',
              status: 'active', revision: 1
            }],
            agentLabels: [{
              agentId: workerAgentId, ownerUserId: workerUserId,
              deviceId: workerDeviceId, displayName: 'Worker Device',
              nodeType: 'desktop', lifecycleStatus: 'active', revision: 1
            }]
          })
        case 'project.coordination.read':
          return coordinationResponse(servedDocuments(), servedProject())
        case 'delivery.drive.list':
          return response(200, {
            protocolVersion: '1.0', type: 'rest.delivery.drive', requestId: payload.requestId,
            drive: { projectId, sharedMaterials: [], taskDeliveries: [], projectResults: [] }
          })
        default: {
          writes.push(request)
          const body = writeResponses?.[payload.type]
          if (!body) throw new Error(`Unexpected Cloud write ${payload.type}.`)
          onWrite?.(payload.type)
          return response(200, body)
        }
      }
    }
  }
}

test('workspace read maps the current draft and confirmed requirements version', async () => {
  const port = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([supersededDocument, confirmedDocument, draftDocument], [])
  })
  const workspace = await port.readWorkspace({ projectId })
  const view = workspace.projects.find((candidate) => candidate.project.projectId === projectId)!
  assert.deepEqual(view.requirementsDraft, draftDocument)
  assert.deepEqual(view.confirmedRequirements, confirmedDocument)
})

test('workspace read rejects more than one current requirements draft', async () => {
  const second = requirementsDocument({
    requirementsDocumentId: 'rqd_RequirementsDraft002',
    documentRevision: 3, state: 'draft', revision: 1, digest: 'e'.repeat(64)
  })
  const port = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([draftDocument, second], [])
  })
  await assert.rejects(
    () => port.readWorkspace({ projectId }),
    /more than one current requirements draft/u
  )
})

test('Owner draft save forwards the exact command and returns the saved document', async () => {
  const writes: AuthenticatedCloudRequest[] = []
  const port = createProjectCoordinatorRequirementsPort({
    workspace: createProjectCoordinatorCloudWorkspacePort({
      transport: transportFixture([draftDocument], [])
    }),
    transport: transportFixture([draftDocument], writes, {
      'project.requirements.draft.save': {
        protocolVersion: '1.0', type: 'rest.entity', requestId: 'req_RequirementsSave01',
        entity: draftDocument
      }
    })
  })
  const input = {
    projectId,
    expectedProjectRevision: project.revision,
    expectedRequirementsRevision: draftDocument.revision,
    goalsDeliverables: draftDocument.goalsDeliverables,
    inputsBoundaries: draftDocument.inputsBoundaries,
    inputReferences: [],
    workModules: draftDocument.workModules,
    acceptanceCriteria: draftDocument.acceptanceCriteria
  }
  const saved = await port.saveDraft(input, 'idem_RequirementsSave01')
  assert.deepEqual(saved, draftDocument)
  assert.equal(writes.length, 1)
  const command = writes[0]!.payload as Record<string, unknown>
  assert.equal(command.type, 'project.requirements.draft.save')
  assert.equal(command.idempotencyKey, 'idem_RequirementsSave01')
  assert.equal(command.projectId, projectId)
  assert.equal(command.expectedRequirementsRevision, draftDocument.revision)
})

test('Owner draft save preserves manually edited punctuation-only module and criterion text', async () => {
  const writes: AuthenticatedCloudRequest[] = []
  const manualDraft = {
    ...draftDocument,
    workModules: draftDocument.workModules.map((module) => ({
      ...module, title: '...', objective: '——'
    })),
    acceptanceCriteria: draftDocument.acceptanceCriteria.map((criterion) => ({
      ...criterion, criteria: '...', evidenceMethod: '…'
    }))
  }
  const port = createProjectCoordinatorRequirementsPort({
    workspace: completionWorkspace(),
    transport: transportFixture([draftDocument], writes, {
      'project.requirements.draft.save': {
        protocolVersion: '1.0', type: 'rest.entity', requestId: 'req_RequirementsSave01',
        entity: manualDraft
      }
    })
  })

  const saved = await port.saveDraft({
    projectId,
    expectedProjectRevision: project.revision,
    expectedRequirementsRevision: draftDocument.revision,
    goalsDeliverables: manualDraft.goalsDeliverables,
    inputsBoundaries: manualDraft.inputsBoundaries,
    inputReferences: manualDraft.inputReferences,
    workModules: manualDraft.workModules,
    acceptanceCriteria: manualDraft.acceptanceCriteria
  }, 'idem_RequirementsManualSave01')
  assert.deepEqual(saved, manualDraft)
  assert.equal(writes.length, 1)
  const command = writes[0]!.payload as Record<string, unknown>
  assert.equal(command.type, 'project.requirements.draft.save')
  assert.deepEqual(command.workModules, manualDraft.workModules)
  assert.deepEqual(command.acceptanceCriteria, manualDraft.acceptanceCriteria)
})

test('Owner confirm requires the exact current draft before any Cloud write', async () => {
  const writes: AuthenticatedCloudRequest[] = []
  const confirmed = requirementsDocument({
    requirementsDocumentId: draftDocument.requirementsDocumentId,
    documentRevision: draftDocument.documentRevision, state: 'confirmed',
    revision: draftDocument.revision + 1, digest: draftDocument.contentDigest
  })
  let servedDocuments: readonly ProjectRequirementsDocument[] = [draftDocument]
  const transport = transportFixture(() => servedDocuments, writes, {
    'project.requirements.confirm': {
      protocolVersion: '1.0', type: 'rest.entity', requestId: 'req_RequirementsConfirm01',
      entity: confirmed
    }
  }, () => {
    servedDocuments = [confirmed]
  })
  const workspace = createProjectCoordinatorCloudWorkspacePort({ transport })
  const port = createProjectCoordinatorRequirementsPort({ workspace, transport })

  await assert.rejects(() => port.confirm({
    projectId,
    requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedProjectRevision: project.revision,
    expectedRequirementsRevision: draftDocument.revision,
    contentDigest: '0'.repeat(64)
  }, 'idem_RequirementsConfirm01'), /exact current requirements draft/u)
  assert.equal(writes.length, 0)

  const result = await port.confirm({
    projectId,
    requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedProjectRevision: project.revision,
    expectedRequirementsRevision: draftDocument.revision,
    contentDigest: draftDocument.contentDigest
  }, 'idem_RequirementsConfirm02')
  assert.equal(writes.length, 1)
  const command = writes[0]!.payload as Record<string, unknown>
  assert.equal(command.type, 'project.requirements.confirm')
  assert.equal(command.requirementsDocumentId, draftDocument.requirementsDocumentId)
  const view = result.projects.find((candidate) => candidate.project.projectId === projectId)!
  assert.equal(view.confirmedRequirements?.requirementsDocumentId, draftDocument.requirementsDocumentId)
  assert.equal(view.requirementsDraft, null)
})

function generatedRequirements(overrides: Readonly<{
  workModules?: unknown[]
  acceptanceCriteria?: unknown[]
}> = {}) {
  return {
    workModules: overrides.workModules ?? [
      {
        planItemId: 'item_qc',
        title: 'Quality control',
        objective: 'Run the exact QC pipeline.',
        dependencyPlanItemIds: [],
        requiredCapabilityTags: ['agent-runtime.codex']
      },
      {
        planItemId: 'item_report',
        title: 'Report',
        objective: 'Write the audited report.',
        dependencyPlanItemIds: ['item_qc'],
        requiredCapabilityTags: []
      }
    ],
    acceptanceCriteria: overrides.acceptanceCriteria ?? [
      {
        target: 'item_qc',
        criteria: 'The QC report exists.',
        evidenceMethod: 'Published Drive object.'
      },
      {
        target: 'item_report',
        criteria: 'The report exists.',
        evidenceMethod: 'Published Drive object.'
      },
      {
        target: '$project',
        criteria: 'Every module is accepted.',
        evidenceMethod: 'Owner review.'
      }
    ]
  }
}

function completionAgent(
  requests: DomainMainAgentExecutionRequest[],
  text: () => string = () => JSON.stringify(generatedRequirements()),
  state: 'completed' | 'failed' = 'completed'
): DomainMainAgentExecutionHost {
  return {
    prepareSession: async () => ({
      runtimeId: 'runtime-requirements',
      threadId: 'thread-requirements'
    }),
    run: async (request) => {
      requests.push(request)
      return {
        runtimeId: 'runtime-requirements',
        threadId: 'thread-requirements',
        turnId: 'turn-requirements',
        state,
        text: state === 'completed' ? text() : ''
      }
    }
  }
}

function inMemorySettings(): DomainMainPackageSettingsHost {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  return {
    read: async () => ({ revision, value: structuredClone(value) }),
    write: async (next, expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('settings revision conflict')
      value = structuredClone(next)
      revision += 1
      return { revision, value: structuredClone(value) }
    },
    clear: async (expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('settings revision conflict')
      value = null
      revision += 1
      return { revision, value }
    }
  }
}

function completionWorkspace() {
  return createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([draftDocument], [])
  })
}

function completionPort(
  options: Readonly<{
    commands: CoordinatorCloudCommand[]
    requests: DomainMainAgentExecutionRequest[]
    text?: () => string
    runState?: 'completed' | 'failed'
    agent?: DomainMainAgentExecutionHost
    workspace?: ProjectCoordinatorWorkspacePort
    state?: ProjectCoordinatorStateStore
    coordinatorCloudCommands?: Omit<CoordinatorCloudCommandService, 'localAgentId'>
    completionResponse?: (command: CoordinatorCloudCommand) => AuthenticatedCloudResponse['body']
  }>
) {
  const settings = inMemorySettings()
  return createProjectCoordinatorRequirementsPort({
    workspace: options.workspace ?? completionWorkspace(),
    settings,
    state: options.state ?? new ProjectCoordinatorStateStore(settings),
    getAgentExecution: () => options.agent ?? completionAgent(
      options.requests,
      options.text,
      options.runState
    ),
    coordinatorCloudCommands: options.coordinatorCloudCommands ?? {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async (command) => {
        options.commands.push(command)
        return options.completionResponse?.(command) ?? {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: command.requestId,
          entity: completedDocument
        }
      },
      subscribe: () => () => undefined
    }
  })
}

test('Coordinator completion derives modules and criteria locally then writes the exact revision', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const port = completionPort({ commands, requests })

  const completed = await port.complete({
    projectId,
    expectedRequirementsRevision: draftDocument.revision
  })

  assert.deepEqual(completed, completedDocument)
  assert.equal(commands.length, 1)
  const command = commands[0] as Extract<
    CoordinatorCloudCommand,
    { type: 'project.requirements.completion.save' }
  >
  assert.equal(command.type, 'project.requirements.completion.save')
  assert.equal(command.expectedRequirementsRevision, draftDocument.revision)
  assert.equal(command.expectedProjectRevision, project.revision)
  assert.equal(command.expectedCoordinatorAuthorityEpoch, project.coordinatorAuthorityEpoch)
  assert.deepEqual(command.workModules.map(({ planItemId }) => planItemId), ['item_qc', 'item_report'])
  assert.deepEqual(command.acceptanceCriteria.map(({ target }) => target), [
    'item_qc', 'item_report', '$project'
  ])
  assert.match(command.idempotencyKey, /^idem_requirements-completion\.[a-f0-9]{48}$/u)
  assert.equal(requests.length, 1)
  assert.match(requests[0]!.title ?? '', /Requirements meeting · 需求补全 v3/u)
  assert.match(requests[0]!.prompt, /Owner goals and deliverables: Goal: annotated cells/u)
  assert.match(requests[0]!.prompt, /Owner inputs and boundaries: Input: the exact QC matrix/u)
  assert.match(requests[0]!.prompt, /at least one project-level criterion.*"\$project"/u)
  assert.match(JSON.stringify(requests[0]!.outputSchema), /"workModules"/u)
  assert.match(JSON.stringify(requests[0]!.outputSchema), /"acceptanceCriteria"/u)
  assert.match(JSON.stringify(requests[0]!.outputSchema), /"requiredCapabilityTags"/u)
})

test('Coordinator completion offers only the exact Worker capability catalog and rejects topical tags', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  let attempt = 0
  const port = completionPort({
    commands,
    requests,
    text: () => JSON.stringify(attempt++ === 0
      ? generatedRequirements({
          workModules: [{
            planItemId: 'item_qc',
            title: 'Quality control',
            objective: 'Run the exact QC pipeline.',
            dependencyPlanItemIds: [],
            requiredCapabilityTags: ['public-data-selection', 'single-cell-rna-seq', 'quality-control', 'documentation']
          }],
          acceptanceCriteria: [
            {
              target: 'item_qc',
              criteria: 'The QC report exists.',
              evidenceMethod: 'Published Drive object.'
            },
            {
              target: '$project',
              criteria: 'Every module is accepted.',
              evidenceMethod: 'Owner review.'
            }
          ]
        })
      : generatedRequirements())
  })

  await assert.rejects(
    () => port.complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'invalid_structured_output' &&
      /no visible Worker runtime provides: public-data-selection/u.test(cause.message)
    )
  )
  assert.equal(commands.length, 0)
  assert.equal(requests.length, 1)
  assert.match(
    requests[0]!.prompt,
    /Worker capability catalog: \["agent-runtime\.codex","model-access\.api"\]/u
  )
  assert.match(requests[0]!.prompt, /never invent tags such as public-data-selection/u)

  const completed = await port.complete({ projectId })
  assert.deepEqual(completed, completedDocument)
  assert.equal(requests.length, 2)
  const command = commands[0] as Extract<
    CoordinatorCloudCommand,
    { type: 'project.requirements.completion.save' }
  >
  assert.deepEqual(command.workModules.map(({ requiredCapabilityTags }) => requiredCapabilityTags), [
    ['agent-runtime.codex'], []
  ])
})

test('Coordinator completion rejects generated criteria without a project-level criterion', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const port = completionPort({
    commands,
    requests,
    text: () => JSON.stringify(generatedRequirements({
      acceptanceCriteria: [
        {
          target: 'item_qc',
          criteria: 'The QC report exists.',
          evidenceMethod: 'Published Drive object.'
        },
        {
          target: 'item_report',
          criteria: 'The report exists.',
          evidenceMethod: 'Published Drive object.'
        }
      ]
    }))
  })

  await assert.rejects(
    () => port.complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'invalid_structured_output'
    )
  )
  assert.equal(commands.length, 0)
  assert.equal(requests.length, 1)
})

for (const field of ['title', 'objective', 'criteria', 'evidenceMethod'] as const) {
  for (const placeholder of ['...', '…', '——', '！？', '🧪', '\u200b']) {
    test(`Coordinator completion rejects placeholder-only ${field} (${placeholder}) without writing or retrying`, async () => {
      const commands: CoordinatorCloudCommand[] = []
      const requests: DomainMainAgentExecutionRequest[] = []
      const content = {
        workModules: [{ ...draftDocument.workModules[0]!, requiredCapabilityTags: [] }],
        acceptanceCriteria: draftDocument.acceptanceCriteria.map((criterion) => ({ ...criterion }))
      }
      if (field === 'title' || field === 'objective') content.workModules[0]![field] = placeholder
      else content.acceptanceCriteria[0]![field] = placeholder
      const port = completionPort({ commands, requests, text: () => JSON.stringify(content) })

      await assert.rejects(
        () => port.complete({ projectId }),
        (cause: unknown) => (
          cause instanceof ProjectCoordinatorRequirementsCompletionError &&
          cause.reason === 'placeholder_generated_content'
        )
      )
      assert.equal(commands.length, 0)
      assert.equal(requests.length, 1)
    })
  }
}

for (const text of ['包含六个栏目', '…包含六个栏目', 'é', '١', '𠮷']) {
  test(`Coordinator completion accepts Unicode letters or numbers in generated text (${text})`, async () => {
    const commands: CoordinatorCloudCommand[] = []
    const requests: DomainMainAgentExecutionRequest[] = []
    const content = {
      workModules: [{
        ...draftDocument.workModules[0]!, title: text, objective: text, requiredCapabilityTags: []
      }],
      acceptanceCriteria: draftDocument.acceptanceCriteria.map((criterion) => ({
        ...criterion, criteria: text, evidenceMethod: text
      }))
    }
    const port = completionPort({ commands, requests, text: () => JSON.stringify(content) })

    await port.complete({ projectId })
    assert.equal(requests.length, 1)
    assert.equal(commands.length, 1)
    const command = commands[0]!
    assert.equal(command.type, 'project.requirements.completion.save')
    if (command.type !== 'project.requirements.completion.save') assert.fail('Unexpected command.')
    assert.deepEqual(command.workModules, content.workModules)
    assert.deepEqual(command.acceptanceCriteria, content.acceptanceCriteria)
  })
}

test('Coordinator completion fences the exact draft revision before and during write-back', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const port = completionPort({ commands, requests })

  await assert.rejects(
    () => port.complete({
      projectId,
      expectedRequirementsRevision: draftDocument.revision + 1
    }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'revision_conflict'
    )
  )
  assert.equal(requests.length, 0)
  assert.equal(commands.length, 0)

  const conflicting = completionPort({
    commands,
    requests,
    completionResponse: (command) => ({
      protocolVersion: '1.0',
      type: 'rest.error',
      requestId: command.requestId,
      error: createCollaborationError(
        'revision_conflict',
        'The resource revision is stale.'
      )
    })
  })
  await assert.rejects(
    () => conflicting.complete({
      projectId,
      expectedRequirementsRevision: draftDocument.revision
    }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'revision_conflict'
    )
  )
  assert.equal(commands.length, 1)
})

test('Coordinator completion surfaces a failed local run as a typed error', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const port = completionPort({ commands, requests, runState: 'failed' })

  await assert.rejects(
    () => port.complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'runtime_execution_failed'
    )
  )
  assert.equal(commands.length, 0)
  assert.equal(requests.length, 1)
})

test('concurrent completion requests share one persisted Runtime directive', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const port = completionPort({ commands, requests })

  const results = await Promise.allSettled([
    port.complete({ projectId }),
    port.complete({ projectId })
  ])

  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.deepEqual(
    (fulfilled[0] as PromiseFulfilledResult<ProjectRequirementsDocument>).value,
    completedDocument
  )
  assert.equal(
    (rejected[0] as PromiseRejectedResult).reason instanceof
      ProjectCoordinatorRequirementsCompletionError &&
      (rejected[0] as PromiseRejectedResult).reason.reason,
    'completion_in_progress'
  )
  assert.equal(requests.length, 1)
  assert.equal(commands.length, 1)
  assert.match(requests[0]!.clientDirectiveId ?? '', /^project-requirements:[a-f0-9]{64}$/u)
})

test('draft revision or Coordinator authority changes during the run are typed revision conflicts', async () => {
  for (const message of [
    'The requirements draft revision changed during completion.',
    'The Coordinator authority epoch changed during completion.'
  ]) {
    const commands: CoordinatorCloudCommand[] = []
    const requests: DomainMainAgentExecutionRequest[] = []
    const port = completionPort({
      commands,
      requests,
      completionResponse: (command) => ({
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: command.requestId,
        error: createCollaborationError('revision_conflict', message)
      })
    })

    await assert.rejects(
      () => port.complete({ projectId }),
      (cause: unknown) => (
        cause instanceof ProjectCoordinatorRequirementsCompletionError &&
        cause.reason === 'revision_conflict'
      )
    )
    assert.equal(requests.length, 1)
    assert.equal(commands.length, 1)
  }
})

test('a stalled Coordinator Runtime run times out as a typed failure', async () => {
  const requests: DomainMainAgentExecutionRequest[] = []
  const settings = inMemorySettings()
  const port = createProjectCoordinatorRequirementsPort({
    workspace: completionWorkspace(),
    settings,
    state: new ProjectCoordinatorStateStore(settings),
    generationTimeoutMs: 20,
    getAgentExecution: () => ({
      prepareSession: async () => ({
        runtimeId: 'runtime-requirements',
        threadId: 'thread-requirements'
      }),
      run: async (request) => {
        requests.push(request)
        return new Promise<never>(() => undefined)
      }
    })
  })

  await assert.rejects(
    () => port.complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'runtime_execution_failed'
    )
  )
  assert.equal(requests.length, 1)
})

test('a Cloud write failure is reported as a typed write failure', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const port = completionPort({
    commands,
    requests,
    completionResponse: () => {
      throw new Error('Cloud connection reset.')
    }
  })

  await assert.rejects(
    () => port.complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'write_failed'
    )
  )
  assert.equal(requests.length, 1)
  assert.equal(commands.length, 1)
})

test('completion binds to the durable Coordinator Session instead of a Plan generation Session', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const settings = inMemorySettings()
  const port = createProjectCoordinatorRequirementsPort({
    workspace: completionWorkspace(),
    settings,
    state: new ProjectCoordinatorStateStore(settings),
    getAgentExecution: () => completionAgent(requests),
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async (command) => {
        commands.push(command)
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: command.requestId,
          entity: completedDocument
        }
      },
      subscribe: () => () => undefined
    }
  })

  await port.complete({ projectId })

  const value = (await settings.read()).value as {
    coordinatorSessionBindings: Array<{ runtimeId: string; threadId: string }>
    planGenerationSessions: unknown[]
  }
  assert.equal('planGenerationSessions' in value, false)
  assert.deepEqual(
    value.coordinatorSessionBindings.map(({ runtimeId, threadId }) => ({ runtimeId, threadId })),
    [{ runtimeId: 'runtime-requirements', threadId: 'thread-requirements' }]
  )
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.runtimeId, 'runtime-requirements')
  assert.equal(requests[0]!.threadId, 'thread-requirements')
  assert.equal(commands.length, 1)
})

test('a terminal completion failure persists the directive and retry ordinal across restarts', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const settings = inMemorySettings()
  const state = new ProjectCoordinatorStateStore(settings)
  let output = JSON.stringify(generatedRequirements({
    acceptanceCriteria: [{
      target: 'item_qc',
      criteria: 'The QC report exists.',
      evidenceMethod: 'Published Drive object.'
    }]
  }))
  const createPort = () => createProjectCoordinatorRequirementsPort({
    workspace: completionWorkspace(),
    settings,
    state,
    getAgentExecution: () => completionAgent(requests, () => output),
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async (command: CoordinatorCloudCommand) => {
        commands.push(command)
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: command.requestId,
          entity: completedDocument
        }
      },
      subscribe: () => () => undefined
    }
  })
  const first = createPort()
  await assert.rejects(
    () => first.complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'invalid_structured_output'
    )
  )
  const failedAttempt = await state.readRequirementsCompletionAttempt({
    projectId,
    requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedRequirementsRevision: draftDocument.revision
  })
  assert.equal(failedAttempt?.failureReason, 'invalid_structured_output')

  output = JSON.stringify(generatedRequirements())
  const restarted = createPort()
  await restarted.complete({ projectId })

  assert.equal(requests.length, 2)
  assert.match(requests[0]!.clientDirectiveId ?? '', /^project-requirements:[a-f0-9]{64}$/u)
  assert.equal(
    requests[1]!.clientDirectiveId,
    `${failedAttempt!.clientDirectiveId}:retry:1`
  )
  assert.equal(commands.length, 1)
})

test('placeholder-only generated criteria fail durably and allow an explicit retry after restart', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const settings = inMemorySettings()
  const state = new ProjectCoordinatorStateStore(settings)
  let content = generatedRequirements({
    acceptanceCriteria: ['item_qc', 'item_report', '$project'].map((target) => ({
      target, criteria: '...', evidenceMethod: '...'
    }))
  })
  const createPort = (store: ProjectCoordinatorStateStore) => completionPort({
    commands, requests, state: store, text: () => JSON.stringify(content)
  })

  await assert.rejects(
    () => createPort(state).complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'placeholder_generated_content'
    )
  )
  assert.equal(commands.length, 0)
  assert.equal(requests.length, 1)
  const restartedState = new ProjectCoordinatorStateStore(settings)
  const workspace = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([draftDocument], []),
    readRequirementsCompletion: (input) => restartedState.readRequirementsCompletion(input)
  })
  const view = (await workspace.readWorkspace({ projectId })).projects[0]!
  assert.equal(view.requirementsCompletion?.state, 'failed')
  assert.equal(
    view.requirementsCompletion?.state === 'failed' && view.requirementsCompletion.reason,
    'placeholder_generated_content'
  )
  assert.deepEqual(view.requirementsDraft, draftDocument)

  content = generatedRequirements()
  assert.deepEqual(await createPort(restartedState).complete({ projectId }), completedDocument)
  assert.equal(commands.length, 1)
  assert.equal(requests.length, 2)
  assert.equal(requests[1]!.clientDirectiveId, `${requests[0]!.clientDirectiveId}:retry:1`)
})

test('workspace exposes running progress and a durable correlated receipt after the single Cloud write', async () => {
  const settings = inMemorySettings()
  const state = new ProjectCoordinatorStateStore(settings)
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const admitted = new Promise<void>((resolve) => { started = resolve })
  const agent = completionAgent(requests)
  const port = completionPort({ commands, requests, state, agent: {
    ...agent,
    run: async (request) => { started(); await gate; return agent.run(request) }
  } })
  const workspace = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([draftDocument], []),
    readRequirementsCompletion: (input) => state.readRequirementsCompletion(input)
  })
  const pending = port.complete({ projectId })
  try {
    await admitted
    const view = (await workspace.readWorkspace({ projectId })).projects[0]!
    assert.equal(view.requirementsCompletion?.state, 'running')
    assert.deepEqual(Object.keys(view.requirementsCompletion!).sort(), ['startedAt', 'state'])
    await assert.rejects(port.complete({ projectId }), (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError && cause.reason === 'completion_in_progress'
    ))
  } finally { release(); await pending }
  assert.equal(requests.length, 1)
  assert.equal(commands.length, 1)
  assert.equal((await workspace.readWorkspace({ projectId })).projects[0]!.requirementsCompletion, undefined, 'the stale source read is not a completion receipt')
  const restarted = new ProjectCoordinatorStateStore(settings)
  const completedWorkspace = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([completedDocument], []),
    readRequirementsCompletion: (input) => restarted.readRequirementsCompletion(input)
  })
  assert.deepEqual((await completedWorkspace.readWorkspace({ projectId })).projects[0]!.requirementsCompletion, {
    state: 'completed', requirementsDocumentId: draftDocument.requirementsDocumentId,
    sourceRevision: draftDocument.revision, sourceContentDigest: draftDocument.contentDigest,
    resultRevision: completedDocument.revision, resultContentDigest: completedDocument.contentDigest
  })
  const visible = { projectId, requirementsDocumentId: completedDocument.requirementsDocumentId,
    expectedRequirementsRevision: completedDocument.revision, contentDigest: completedDocument.contentDigest,
    coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch }
  assert.equal(await restarted.readRequirementsCompletion({ ...visible, contentDigest: 'f'.repeat(64) }), null)
  assert.equal(await restarted.readRequirementsCompletion({ ...visible, expectedRequirementsRevision: completedDocument.revision + 1 }), null)
  assert.equal(await restarted.readRequirementsCompletion({ ...visible, coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch + 1 }), null)
  assert.equal(await restarted.readRequirementsCompletion({ ...visible, requirementsDocumentId: 'rqd_AnotherRequirements01' }), null)
})

test('completion projection filters superseded drafts, authority changes and expired leases', async () => {
  const state = new ProjectCoordinatorStateStore(inMemorySettings())
  const input = {
    projectId,
    requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedRequirementsRevision: draftDocument.revision,
    coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    contentDigest: draftDocument.contentDigest
  }
  const attempt = {
    ...input,
    contentDigest: draftDocument.contentDigest,
    clientDirectiveId: 'project-requirements:projection',
    startedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
  }
  await state.claimRequirementsCompletionAttempt(attempt)
  assert.equal((await state.readRequirementsCompletion(input))?.state, 'running')
  assert.equal(await state.readRequirementsCompletion({ ...input, expectedRequirementsRevision: input.expectedRequirementsRevision + 1 }), null)
  assert.equal(await state.readRequirementsCompletion({ ...input, coordinatorAuthorityEpoch: input.coordinatorAuthorityEpoch + 1 }), null)
  const expired = new ProjectCoordinatorStateStore(inMemorySettings())
  await expired.claimRequirementsCompletionAttempt({ ...attempt, startedAt: createdAt, leaseExpiresAt: updatedAt })
  assert.equal(await expired.readRequirementsCompletion(input), null)
  assert.equal((await expired.claimRequirementsCompletionAttempt(attempt)).claimed, true, 'expired attempts remain retryable')
})

test('a persisted completion failure is visible through the requirements workspace projection', async () => {
  const requests: DomainMainAgentExecutionRequest[] = []
  const settings = inMemorySettings()
  const state = new ProjectCoordinatorStateStore(settings)
  const port = createProjectCoordinatorRequirementsPort({
    workspace: completionWorkspace(),
    settings,
    state,
    getAgentExecution: () => completionAgent(
      requests,
      () => JSON.stringify(generatedRequirements({
        acceptanceCriteria: [{
          target: 'item_qc',
          criteria: 'The QC report exists.',
          evidenceMethod: 'Published Drive object.'
        }]
      }))
    )
  })

  await assert.rejects(
    () => port.complete({ projectId }),
    (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError &&
      cause.reason === 'invalid_structured_output'
    )
  )
  const workspace = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([draftDocument], []),
    readRequirementsCompletion: (input) => state.readRequirementsCompletion(input)
  })
  const view = (await workspace.readWorkspace({ projectId })).projects[0]!
  assert.equal(
    view.requirementsCompletion?.state === 'failed' && view.requirementsCompletion.reason,
    'invalid_structured_output'
  )
  const ordinarySaveWorkspace = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture([{ ...draftDocument, revision: draftDocument.revision + 1 }], []),
    readRequirementsCompletion: (input) => state.readRequirementsCompletion(input)
  })
  assert.equal((await ordinarySaveWorkspace.readWorkspace({ projectId })).projects[0]!.requirementsCompletion, undefined,
    'an absent old-revision failure after an ordinary save is not a success receipt')
})


function completionConflict(command: CoordinatorCloudCommand): RestResponse {
  return {
    protocolVersion: '1.0', type: 'rest.error', requestId: command.requestId,
    error: createCollaborationError('revision_conflict', 'Project revision moved.')
  }
}

function movingCompletionWorkspace() {
  const facts: { project: Project; draft: ProjectRequirementsDocument | null; reads: number } = {
    project: { ...project }, draft: draftDocument, reads: 0
  }
  const workspace = createProjectCoordinatorCloudWorkspacePort({
    transport: transportFixture(() => {
      facts.reads += 1
      return facts.draft ? [facts.draft] : []
    }, [], undefined, undefined, () => facts.project)
  })
  return { facts, workspace }
}

test('Coordinator completion retries a project-only conflict with the same output and a new command key', async () => {
  const { facts, workspace } = movingCompletionWorkspace()
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const completed = projectRequirementsDocumentSchema.parse({
    ...draftDocument, ...generatedRequirements(), revision: draftDocument.revision + 1,
    contentDigest: 'f'.repeat(64)
  })
  const port = completionPort({ commands, requests, workspace, completionResponse: (command) => {
    if (commands.length === 1) {
      facts.project = { ...facts.project, revision: facts.project.revision + 1 }
      return completionConflict(command)
    }
    return { protocolVersion: '1.0', type: 'rest.entity', requestId: command.requestId, entity: completed }
  } })

  assert.deepEqual(await port.complete({ projectId }), completed)
  assert.equal(requests.length, 1)
  assert.equal(facts.reads, 2)
  assert.equal(commands.length, 2)
  const [first, second] = commands.map((command) => {
    assert.equal(command.type, 'project.requirements.completion.save')
    return command as Extract<CoordinatorCloudCommand, { type: 'project.requirements.completion.save' }>
  })
  assert.equal(second!.expectedProjectRevision, first!.expectedProjectRevision + 1)
  assert.notEqual(second!.idempotencyKey, first!.idempotencyKey)
  assert.deepEqual(second!.workModules, first!.workModules)
  assert.deepEqual(second!.acceptanceCriteria, first!.acceptanceCriteria)
  assert.equal(second!.expectedRequirementsRevision, first!.expectedRequirementsRevision)
})

for (const changed of ['document revision', 'document ID', 'digest', 'authority', 'completed', 'cancelled', 'missing draft'] as const) {
  test(`Coordinator completion discards output after a conflict changes ${changed}`, async () => {
    const { facts, workspace } = movingCompletionWorkspace()
    const commands: CoordinatorCloudCommand[] = []
    const state = new ProjectCoordinatorStateStore(inMemorySettings())
    const port = completionPort({ commands, requests: [], workspace, state, completionResponse: (command) => {
      facts.project = { ...facts.project, revision: facts.project.revision + 1 }
      switch (changed) {
        case 'document revision': facts.draft = { ...draftDocument, revision: draftDocument.revision + 1 }; break
        case 'document ID': facts.draft = { ...draftDocument, requirementsDocumentId: 'rqd_RequirementsOther01' }; break
        case 'digest': facts.draft = { ...draftDocument, contentDigest: 'a'.repeat(64) }; break
        case 'authority': facts.project = { ...facts.project, coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch + 1 }; break
        case 'completed': case 'cancelled': facts.project = { ...facts.project, status: changed }; break
        case 'missing draft': facts.draft = null; break
      }
      return completionConflict(command)
    } })

    await assert.rejects(() => port.complete({ projectId }), (error: unknown) => (
      error instanceof ProjectCoordinatorRequirementsCompletionError && error.reason === 'revision_conflict'
    ))
    assert.equal(commands.length, 1)
    assert.equal(facts.reads, 2)
    assert.equal((await state.readRequirementsCompletionAttempt({
      projectId, requirementsDocumentId: draftDocument.requirementsDocumentId,
      expectedRequirementsRevision: draftDocument.revision
    }))?.failureReason, 'revision_conflict')
  })
}

test('Coordinator completion stops after three fresh project revision retries', async () => {
  const { facts, workspace } = movingCompletionWorkspace()
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const port = completionPort({ commands, requests, workspace, completionResponse: (command) => {
    facts.project = { ...facts.project, revision: facts.project.revision + 1 }
    return completionConflict(command)
  } })
  await assert.rejects(() => port.complete({ projectId }), (error: unknown) => (
    error instanceof ProjectCoordinatorRequirementsCompletionError && error.reason === 'revision_conflict'
  ))
  assert.equal(requests.length, 1)
  assert.equal(commands.length, 4)
  assert.equal(facts.reads, 4)
  assert.equal(new Set(commands.map((command) => command.idempotencyKey)).size, 4)
})

test('real DurableCloudOutbox accepts completion retry keys and replays each frozen command', async (t) => {
  const { facts, workspace } = movingCompletionWorkspace()
  let stored: unknown = structuredClone(EMPTY_COLLABORATION_LOCAL_STATE)
  const store = new CollaborationLocalStore({
    read: async () => structuredClone(stored),
    write: async (value) => { stored = structuredClone(value) }
  })
  await store.open()
  const calls: CoordinatorCloudCommand[] = []
  const completed = projectRequirementsDocumentSchema.parse({
    ...draftDocument, ...generatedRequirements(), revision: draftDocument.revision + 1
  })
  const outbox = new DurableCloudOutbox({
    store,
    localAgentId: () => coordinatorAgentId,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready', agentId, userId: ownerUserId, deviceId: 'dev_Device0000001',
        generation: 1, runtimeId: 'codex', capabilityTags: ['agent-runtime.codex']
      }),
      execute: async (_agentId, request) => {
        const command = coordinatorCloudCommandSchema.parse(request)
        calls.push(command)
        if (calls.length === 1) {
          facts.project = { ...facts.project, revision: facts.project.revision + 1 }
          return completionConflict(command)
        }
        return { protocolVersion: '1.0', type: 'rest.entity', requestId: command.requestId, entity: completed }
      }
    })
  })
  outbox.start()
  t.after(() => outbox.stop())
  const port = completionPort({
    commands: [], requests: [], workspace,
    coordinatorCloudCommands: {
      execute: (command) => outbox.enqueueAndWait('coordinator.command', command),
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resume: async () => null, resumeUser: async () => null, subscribe: () => () => undefined
    }
  })
  assert.deepEqual(await port.complete({ projectId }), completed)
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0]!.idempotencyKey, calls[1]!.idempotencyKey)
  assert.deepEqual(store.snapshot().outbox.map((entry) => entry.state), ['delivered', 'delivered'])
  for (const command of calls) {
    const replay = await outbox.enqueueAndWait('coordinator.command', { ...command, requestId: 'req_CompletionReplay01' })
    assert.equal(replay.type, command === calls[0] ? 'rest.error' : 'rest.entity')
  }
  assert.equal(calls.length, 2, 'replay returns the original response without another Cloud write')
})


test('a failed completion conflict can be explicitly retried with an incremented Runtime directive and fresh key', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const state = new ProjectCoordinatorStateStore(inMemorySettings())
  let conflict = true
  const port = completionPort({ commands, requests, state, completionResponse: (command) => (
    conflict ? completionConflict(command) : {
      protocolVersion: '1.0', type: 'rest.entity', requestId: command.requestId, entity: completedDocument
    }
  ) })
  await assert.rejects(() => port.complete({ projectId }), (error: unknown) => (
    error instanceof ProjectCoordinatorRequirementsCompletionError && error.reason === 'revision_conflict'
  ))
  const failed = await state.readRequirementsCompletionAttempt({
    projectId, requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedRequirementsRevision: draftDocument.revision
  })
  assert.equal(failed?.state, 'failed')
  assert.equal(failed?.retryOrdinal, 0)
  conflict = false
  await port.complete({ projectId })
  assert.equal(requests.length, 2)
  assert.equal(requests[1]!.clientDirectiveId, `${failed!.clientDirectiveId}:retry:1`)
  assert.notEqual(commands[0]!.idempotencyKey, commands[1]!.idempotencyKey)
  assert.equal((await state.readRequirementsCompletionAttempt({
    projectId, requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedRequirementsRevision: draftDocument.revision
  }))?.state, 'completed')
})


test('completion receipts reject invalid results and fence stale attempt outcomes', async () => {
  const state = new ProjectCoordinatorStateStore(inMemorySettings())
  const input = { projectId, requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedRequirementsRevision: draftDocument.revision, contentDigest: draftDocument.contentDigest,
    coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    clientDirectiveId: 'project-requirements:receipt-fencing', startedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }
  const first = (await state.claimRequirementsCompletionAttempt(input)).attempt
  for (const bad of [
    { ...completedDocument, projectId: 'prj_AnotherProject01' },
    { ...completedDocument, requirementsDocumentId: 'rqd_AnotherRequirements01' },
    { ...completedDocument, revision: draftDocument.revision },
    { ...completedDocument, revision: draftDocument.revision + 2 }
  ]) await assert.rejects(state.recordRequirementsCompletionSuccess(first, bad))
  await state.recordRequirementsCompletionFailure(first, { reason: 'write_failed', failedAt: updatedAt })
  const retried = (await state.claimRequirementsCompletionAttempt(input)).attempt
  assert.equal(retried.retryOrdinal, 1)
  await state.recordRequirementsCompletionSuccess(first, completedDocument)
  await state.recordRequirementsCompletionFailure(first, { reason: 'runtime_execution_failed', failedAt: updatedAt })
  assert.equal((await state.readRequirementsCompletionAttempt(input))?.state, 'running')
  const currentResult = { ...input, expectedRequirementsRevision: completedDocument.revision, contentDigest: completedDocument.contentDigest }
  assert.equal(await state.readRequirementsCompletion(currentResult), null, 'neither an invalid nor a stale result issues a receipt')
  await state.recordRequirementsCompletionSuccess(retried, completedDocument)
  await state.recordRequirementsCompletionFailure(retried, { reason: 'write_failed', failedAt: updatedAt })
  assert.equal((await state.readRequirementsCompletion(currentResult))?.state, 'completed')
  assert.equal((await state.claimRequirementsCompletionAttempt(input)).claimed, false)
  const newer = (await state.claimRequirementsCompletionAttempt({ ...currentResult, clientDirectiveId: 'project-requirements:next', expectedRequirementsRevision: 5 })).attempt
  await state.recordRequirementsCompletionSuccess(newer, { ...completedDocument, revision: 6 })
  assert.equal(await state.readRequirementsCompletion(currentResult), null, 'only the latest success for a document is retained')
})

for (const revision of [draftDocument.revision, draftDocument.revision + 2]) {
  test(`a Cloud response at unrelated revision ${revision} cannot issue a completion receipt`, async () => {
    const state = new ProjectCoordinatorStateStore(inMemorySettings())
    const port = completionPort({ commands: [], requests: [], state, completionResponse: (command) => ({
      protocolVersion: '1.0', type: 'rest.entity', requestId: command.requestId,
      entity: { ...completedDocument, revision }
    }) })
    await assert.rejects(port.complete({ projectId }), (cause: unknown) => (
      cause instanceof ProjectCoordinatorRequirementsCompletionError && cause.reason === 'write_failed'
    ))
    const status = await state.readRequirementsCompletion({ projectId,
      requirementsDocumentId: completedDocument.requirementsDocumentId,
      expectedRequirementsRevision: revision, contentDigest: completedDocument.contentDigest,
      coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch })
    assert.notEqual(status?.state, 'completed')
  })
}


test('an expired lease cannot overwrite the resumed attempt or issue its success receipt', async () => {
  const state = new ProjectCoordinatorStateStore(inMemorySettings())
  const input = { projectId, requirementsDocumentId: draftDocument.requirementsDocumentId,
    expectedRequirementsRevision: draftDocument.revision, contentDigest: draftDocument.contentDigest,
    coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    clientDirectiveId: 'project-requirements:expired-receipt', startedAt: createdAt, leaseExpiresAt: updatedAt }
  const expired = (await state.claimRequirementsCompletionAttempt(input)).attempt
  const resumed = (await state.claimRequirementsCompletionAttempt({ ...input,
    startedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() })).attempt
  assert.equal(resumed.retryOrdinal, expired.retryOrdinal)
  await state.recordRequirementsCompletionSuccess(expired, completedDocument)
  await state.recordRequirementsCompletionFailure(expired, { reason: 'write_failed', failedAt: updatedAt })
  assert.equal((await state.readRequirementsCompletionAttempt(input))?.state, 'running')
  const visible = { ...input, expectedRequirementsRevision: completedDocument.revision, contentDigest: completedDocument.contentDigest }
  assert.equal(await state.readRequirementsCompletion(visible), null)
  await state.recordRequirementsCompletionSuccess(resumed, completedDocument)
  assert.equal((await state.readRequirementsCompletion(visible))?.state, 'completed')
})
