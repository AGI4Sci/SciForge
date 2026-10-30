import { projectRequirementsDocumentSchema } from '@sciforge/collaboration-contracts'
import type {
  AuthenticatedCloudRequest,
  AuthenticatedCloudResponse
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
  type DeviceFactAttestationSigningService
} from '@sciforge/domain-identity-access/device-fact-attestation-signing'
import type {
  DomainMainCapabilityInvocationContext,
  DomainMainHost
} from '@sciforge/domain-sdk/host'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  type CoordinatorCloudCommandService
} from '../coordinator-cloud-command.js'
import {
  WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  WORKER_SESSION_PROJECTION_SERVICE_ID,
  type WorkerSessionProjectionService
} from '../worker-session-projection.js'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorWorkspaceSchema
} from './contract.js'
import {
  createCoordinatorMainEntry,
  createProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityOptions
} from './main.js'
import {
  ProjectCoordinatorRequirementsCompletionError
} from './ports.js'
import { DELIVERY_CONTENT_ACTIONS } from './delivery-content-contract.js'
import type { ProjectCreationOrchestrator } from './project-creation-orchestrator.js'
import type { ProjectCoordinatorSessionProjectionPort } from './session-projection.js'

test('workspace read remains a strict non-writing coordination capability', async () => {
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      workspace: {
        readWorkspace: async () => ({
          connection: { state: 'identity_required' },
          observedAt: '2026-08-24T09:00:00.000Z',
          availableWorkerUsers: [],
          projects: []
        }),
        createProject: async () => { throw new Error('unused') }
      },
      requirements: {
        saveDraft: async () => { throw new Error('unused') },
        complete: async () => { throw new Error('unused') },
        confirm: async () => { throw new Error('unused') }
      },
      membership: coordinatorMembershipPort(),
      delivery: coordinatorDeliveryPort(),


      coordinatorCloudCommands: coordinatorCloudCommandService(),
      actions: coordinatorActionPort()
    },
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub()
  })
  const definitions = factory.createDefinitions()
  assert.deepEqual(factory.policy.directTransportPrefixes, [])
  assert.deepEqual(factory.policy.allowedDirectTransports, [])
  const workspaceReadDefinition = definitions.find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead
  ))!
  assert.equal(workspaceReadDefinition.effect, 'read')
  assert.equal(workspaceReadDefinition.approval, 'none')
  assert.deepEqual(await workspaceReadDefinition.handler({}, uiInvocationContext()), {
    output: {
      connection: { state: 'identity_required' },
      observedAt: '2026-08-24T09:00:00.000Z',
      availableWorkerUsers: [],
      projects: []
    }
  })
})

test('current capability policies keep human-only actions and confirmed Agent writes explicit', async () => {
  const created = createdProjectResult()
  const definitions = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: projectCreatePorts(async () => createdProjectResult()) as never,
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub(async () => created)
  }).createDefinitions()
  for (const id of [PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionOwnershipRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide,
    PROJECT_COORDINATOR_CAPABILITY_IDS.resultPublish,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete]) {
    assert.deepEqual(definitions.find((definition) => definition.id === id)?.audiences, ['ui'])
  }
  for (const definition of definitions.filter(({ audiences, effect }) => (
    audiences.includes('agent') && ['external-write', 'destructive'].includes(effect)
  ))) {
    assert.equal(definition.approval, 'confirmation', definition.id)
    assert.equal(definition.concurrency.idempotency, 'required', definition.id)
  }
  assert.equal(definitions.find(({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate)?.version, '2.0.0')
  assert.equal(definitions.find(({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete)?.effect, 'destructive')
  assert.equal(definitions.find(({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead)?.version, '3.0.0')
  for (const id of [PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd, PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove, PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer, PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer]) {
    assert.equal(definitions.find((definition) => definition.id === id)?.version, '2.0.0', id)
  }
  const create = definitions.find(({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate)!
  assert.deepEqual(await create.handler({
    createIntentId: 'pct_UiCreateIntent0001', displayName: 'Meeting', goal: 'Run the meeting.',
    budget: { maxTasks: 4, maxTasksPerRound: 4, maxTaskRetries: 1, maxCoordinationRounds: 2 }
  }, uiInvocationContext('invocation-project-create-ui')), { output: created })
})

test('production main assembly wires every requirements capability to its real port', async (t) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-coordinator-composition-'))
  t.after(async () => {
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  })
  const project = createdProjectView().project
  const membership = createdProjectView().memberships[0]!
  const at = '2026-08-25T01:05:00.000Z'
  const draft = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1,
    revision: 1,
    createdAt: at,
    updatedAt: at,
    type: 'project_requirements_document',
    requirementsDocumentId: 'rqd_CompositionDraft0001',
    projectId: project.projectId,
    documentRevision: 1,
    state: 'draft',
    goalsDeliverables: 'Goal: validate the production assembly.',
    inputsBoundaries: 'Input: the exact test fixture.',
    inputReferences: [],
    workModules: [{
      planItemId: 'item_composition',
      title: 'Composition smoke test',
      objective: 'Invoke every requirements capability through the production entry.',
      dependencyPlanItemIds: []
    }],
    acceptanceCriteria: [{
      target: 'item_composition',
      criteria: 'Every requirements handler reaches its real Cloud port.',
      evidenceMethod: 'Composition test.'
    }],
    contentDigest: 'd'.repeat(64),
    confirmedByUserId: null,
    confirmedAt: null,
    supersededAt: null
  })
  const confirmed = projectRequirementsDocumentSchema.parse({
    ...draft,
    revision: 2,
    documentRevision: 2,
    state: 'confirmed',
    confirmedByUserId: project.ownerUserId,
    confirmedAt: at
  })
  let currentDocuments: readonly unknown[] = [draft]
  const response = (body: AuthenticatedCloudResponse['body']): AuthenticatedCloudResponse => ({
    contractVersion: 1,
    status: 200,
    body
  })
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud-run0.sciforge.cn/',
      userId: project.ownerUserId,
      deviceId: 'dev_Composition01',
      deviceRevision: 1
    }),
    execute: async (request: AuthenticatedCloudRequest) => {
      const payload = request.payload
      switch (payload.type) {
        case 'project.list':
          return response({
            protocolVersion: '1.0', type: 'rest.project_page', requestId: payload.requestId,
            limit: 250, projects: [project], observedAt: at
          })
        case 'worker.availability.list':
          return response({
            protocolVersion: '1.0', type: 'rest.worker_availability_page', requestId: payload.requestId,
            observedAt: at, items: [], userLabels: [], agentLabels: []
          })
        case 'project.coordination.read':
          return response({
            protocolVersion: '1.0', type: 'rest.project_coordination', requestId: payload.requestId,
            project, observedAt: at,
            pages: payload.collections.map(({ collection, limit }) => ({
              collection, limit,
              items: collection === 'memberships'
                ? [membership]
                : collection === 'requirements_documents' ? [...currentDocuments] : []
            })) as never,
            finalSummary: null
          })
        case 'delivery.drive.list':
          return response({
            protocolVersion: '1.0', type: 'rest.delivery.drive', requestId: payload.requestId,
            drive: { projectId: payload.projectId, sharedMaterials: [], taskDeliveries: [], projectResults: [] }
          })
        case 'project.requirements.draft.save':
          return response({
            protocolVersion: '1.0', type: 'rest.entity', requestId: payload.requestId, entity: draft
          })
        case 'project.requirements.confirm':
          currentDocuments = [confirmed]
          return response({
            protocolVersion: '1.0', type: 'rest.entity', requestId: payload.requestId, entity: confirmed
          })
        default:
          throw new Error(`Unexpected Cloud request ${payload.type}.`)
      }
    }
  }
  const coordinatorService: CoordinatorCloudCommandService = {
    executeUser: async () => { throw new Error('Unexpected User command.') },
    resumeUser: async () => null,
    localAgentId: () => project.coordinatorAgentId,
    execute: async (command) => response({
      protocolVersion: '1.0', type: 'rest.entity', requestId: command.requestId, entity: draft
    }).body,
    resume: async () => null,
    subscribe: () => () => undefined
  }
  const signingService: DeviceFactAttestationSigningService = {
    signDeviceFact: async () => { throw new Error('Unexpected Device signature.') }
  }
  const workerSessionProjection: WorkerSessionProjectionService = { listBindings: async () => [] }
  const host: DomainMainHost = {
    getUserDataDir: () => userDataDir,
    defineCapability: (input) => input,
    openPath: async () => undefined,
    packageSettings: {
      read: async () => ({ revision: 0, value: null }),
      write: async (value) => ({ revision: 1, value }),
      clear: async () => ({ revision: 1, value: null })
    },
    portableResources: {
      materialize: async () => { throw new Error('Unexpected artifact review.') },
      discard: async () => undefined,
      export: async () => { throw new Error('Unexpected portable export.') }
    },
    internalServices: {
      register: () => undefined,
      acquire: ((serviceId: string) => {
        if (serviceId === AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID) return transport
        if (serviceId === DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID) return signingService
        if (serviceId === COORDINATOR_CLOUD_COMMAND_SERVICE_ID) return coordinatorService
        if (serviceId === WORKER_SESSION_PROJECTION_SERVICE_ID) return workerSessionProjection
        throw new Error(`Unexpected internal service ${serviceId}.`)
      }) as NonNullable<DomainMainHost['internalServices']>['acquire']
    }
  }
  const entry = createCoordinatorMainEntry<ProjectCoordinatorCapabilityOptions>(host)
  const factory = entry.contributions[0]!.value as
    ProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>
  const definitions = factory.createDefinitions()
  const invoke = (id: string) => definitions.find((definition) => definition.id === id)!
  const completeResult = await invoke(PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete).handler({
    projectId: project.projectId,
    expectedRequirementsRevision: draft.revision
  }, agentInvocationContext('composition-requirements-complete'))
  // The composition entry has no activated Agent Runtime, so the real port
  // must fail closed with a bounded typed reason rather than inventing output.
  assert.deepEqual(completeResult.output, {
    status: 'failed',
    reason: 'runtime_unavailable'
  })
  const saveResult = await invoke(PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave).handler({
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    expectedRequirementsRevision: draft.revision,
    goalsDeliverables: draft.goalsDeliverables,
    inputsBoundaries: draft.inputsBoundaries,
    inputReferences: draft.inputReferences,
    workModules: draft.workModules,
    acceptanceCriteria: draft.acceptanceCriteria
  }, uiInvocationContext('composition-requirements-save'))
  assert.equal(
    projectRequirementsDocumentSchema.parse(saveResult.output).requirementsDocumentId,
    draft.requirementsDocumentId
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  const persistedSnapshot = JSON.parse(await readFile(
    join(userDataDir, 'domains', 'collaboration', 'coordinator-state.json'),
    'utf8'
  )) as { value: unknown }
  const persisted = persistedSnapshot.value as {
    requirementsCompletionAttempts?: Array<{ failureReason: string | null }>
  }
  assert.equal(
    persisted.requirementsCompletionAttempts?.at(-1)?.failureReason,
    'runtime_unavailable',
    'an async completion failure remains visible in durable Coordinator state'
  )
  const confirmResult = await invoke(PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm).handler({
    projectId: project.projectId,
    requirementsDocumentId: draft.requirementsDocumentId,
    expectedProjectRevision: project.revision,
    expectedRequirementsRevision: draft.revision,
    contentDigest: draft.contentDigest
  }, uiInvocationContext('composition-requirements-confirm'))
  assert.equal(
    projectCoordinatorWorkspaceSchema.parse(confirmResult.output).projects[0]?.confirmedRequirements?.state,
    'confirmed'
  )
})

function coordinatorCloudCommandService(): CoordinatorCloudCommandService {
  return Object.freeze({
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
    localAgentId: () => 'agt_ProjectCoordinator1',
    execute: async () => {
      throw new Error('No write capability invoked this test service.')
    },
    resume: async () => null,
    subscribe: () => () => undefined
  })
}

test('project.create delegates fresh Session creation to the canonical orchestrator', async () => {
  const result = createdProjectResult()
  const calls: Array<Readonly<{ input: unknown; context: unknown }>> = []
  const successful = projectCreateCapability(async (input, context) => {
    calls.push({ input, context })
    return result
  })
  const invocation = agentInvocationContext('invocation-agent-create-1')
  const input = {
    createIntentId: result.createIntentId,
    displayName: 'Meeting',
    goal: 'Run the meeting.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  }

  assert.deepEqual(await successful.handler(input, invocation), { output: result })
  assert.deepEqual(calls, [{
    input,
    context: {
      preferredRuntimeId: invocation.ordinarySession!.runtimeId,
      assertPrincipalCurrent: invocation.assertPrincipalCurrent
    }
  }])

  const rejected = projectCreateCapability(async () => {
    throw new Error('canonical create rejected')
  })
  await assert.rejects(
    rejected.handler(input, agentInvocationContext('invocation-agent-create-2')),
    /canonical create rejected/u
  )
})

test('membership-inactive Agent scope rejects external writes before the canonical port', async () => {
  let addMemberCalls = 0
  const basePorts = projectCreatePorts(async () => createdProjectResult())
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      ...basePorts,
      membership: {
        ...coordinatorMembershipPort(),
        addMember: async () => {
          addMemberCalls += 1
          throw new Error('must not reach the canonical write port')
        }
      }
    } as never,
    sessions: {
      ...sessionProjectionPort(),
      authorize: async () => {
        throw new Error('The ordinary Session is fenced: membership_inactive.')
      }
    },
    projectCreation: projectCreationStub()
  })
  const addMember = factory.createDefinitions().find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd
  ))!

  await assert.rejects(addMember.handler({
    projectId: 'prj_ProjectCreated01',
    expectedProjectRevision: 1,
    userId: 'usr_ProjectMember001',
  }, agentInvocationContext('invocation-membership-inactive')), /membership_inactive/u)
  assert.equal(addMemberCalls, 0)
})

test('Project delete requires exact Coordinator Session authority and derives a stable invocation key', async () => {
  const projectId = 'prj_ProjectCreated01'
  const calls: Array<Readonly<{ input: unknown; idempotencyKey: string }>> = []
  const authorizations: Array<Readonly<{
    projectId: string
    session: unknown
    access: string
  }>> = []
  const deleted = Object.freeze({ projectId, deleted: true as const })
  let deleteIntentStarted = false
  const basePorts = projectCreatePorts(async () => createdProjectResult())
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      ...basePorts,
      actions: {
        ...coordinatorActionPort(),
        deleteProject: async (
          input: unknown,
          idempotencyKey: string,
          authorizeFirstAttempt: () => Promise<void>
        ) => {
          if (!deleteIntentStarted) {
            await authorizeFirstAttempt()
            deleteIntentStarted = true
          }
          calls.push({ input, idempotencyKey })
          return deleted
        }
      }
    } as never,
    sessions: {
      ...sessionProjectionPort(),
      authorize: async (authorizedProjectId, session, access) => {
        authorizations.push({ projectId: authorizedProjectId, session, access })
        return {
          schemaVersion: 1,
          role: 'coordinator',
          projectId: authorizedProjectId,
          principalUserId: 'usr_Owner0000001',
          coordinatorAgentId: 'agt_Coordinator01',
          coordinatorAuthorityEpoch: 1,
          runtimeId: session.runtimeId,
          threadId: session.threadId,
          boundAt: '2026-08-28T01:00:00.000Z',
          access: 'coordinator',
          fenceReason: null
        }
      }
    },
    projectCreation: projectCreationStub()
  })
  const capability = factory.createDefinitions().find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete
  ))!
  const invocation = agentInvocationContext('invocation-project-delete-1')

  assert.deepEqual(await capability.handler({ projectId }, invocation), { output: deleted })
  assert.deepEqual(await capability.handler({ projectId }, invocation), { output: deleted })
  assert.deepEqual(authorizations, [{
    projectId,
    session: invocation.ordinarySession,
    access: 'coordinator'
  }])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(({ input }) => input), [{ projectId }, { projectId }])
  assert.equal(calls[0]!.idempotencyKey, calls[1]!.idempotencyKey)
  assert.match(calls[0]!.idempotencyKey, /^idem_collaboration\.[a-f0-9]{48}$/u)

  let fencedCalls = 0
  const fenced = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      ...basePorts,
      actions: {
        ...coordinatorActionPort(),
        deleteProject: async (
          _input: unknown,
          _idempotencyKey: string,
          authorizeFirstAttempt: () => Promise<void>
        ) => {
          await authorizeFirstAttempt()
          fencedCalls += 1
          return deleted
        }
      }
    } as never,
    sessions: {
      ...sessionProjectionPort(),
      authorize: async () => {
        throw new Error('The ordinary Session is fenced: membership_inactive.')
      }
    },
    projectCreation: projectCreationStub()
  }).createDefinitions().find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete
  ))!
  await assert.rejects(
    fenced.handler({ projectId }, agentInvocationContext('invocation-project-delete-fenced')),
    /membership_inactive/u
  )
  assert.equal(fencedCalls, 0)

  await assert.rejects(
    capability.handler({ projectId }, uiInvocationContext()),
    /Host invocation ID is required/u
  )
  assert.equal(calls.length, 2)
})

test('main requirements draft save starts Coordinator completion for the saved revision', async () => {
  const at = '2026-08-25T01:05:00.000Z'
  const projectId = 'prj_ProjectCreated01'
  const saved = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1,
    revision: 6,
    createdAt: at,
    updatedAt: at,
    type: 'project_requirements_document',
    requirementsDocumentId: 'rqd_AutoCompletionDraft01',
    projectId,
    documentRevision: 2,
    state: 'draft',
    goalsDeliverables: 'Goal: validate automatic completion.',
    inputsBoundaries: 'Input: the exact test fixture.',
    inputReferences: [],
    workModules: [],
    acceptanceCriteria: [],
    contentDigest: 'a'.repeat(64),
    confirmedByUserId: null,
    confirmedAt: null,
    supersededAt: null
  })
  const completions: Array<{ projectId: string; expectedRequirementsRevision?: number }> = []
  let finish!: () => void
  let completed = false
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      workspace: {
        readWorkspace: async () => ({
          connection: { state: 'identity_required' },
          observedAt: at,
          availableWorkerUsers: [],
          projects: []
        }),
        createProject: async () => { throw new Error('unused') }
      },
      requirements: {
        saveDraft: async () => saved,
        complete: async (input) => {
          completions.push(input)
          await pending
          completed = true
          return saved
        },
        confirm: async () => { throw new Error('unused') }
      },
      membership: coordinatorMembershipPort(),
      delivery: coordinatorDeliveryPort(),


      coordinatorCloudCommands: coordinatorCloudCommandService(),
      actions: coordinatorActionPort()
    },
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub()
  })
  const save = factory.createDefinitions().find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave
  )!
  const response = await save.handler({
    projectId,
    expectedProjectRevision: 5,
    expectedRequirementsRevision: 1,
    goalsDeliverables: saved.goalsDeliverables,
    inputsBoundaries: saved.inputsBoundaries,
    inputReferences: [],
    workModules: [],
    acceptanceCriteria: []
  }, uiInvocationContext('invocation-requirements-save-auto'))
  await Promise.resolve()

  assert.deepEqual(response, { output: saved })
  assert.equal(completed, false, 'save returns while background completion remains pending')
  finish()
  await Promise.resolve()
  assert.deepEqual(completions, [{
    projectId,
    expectedRequirementsRevision: saved.revision
  }])
})

test('requirements completion capability returns only a bounded package-owned failure reason', async () => {
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      workspace: {
        readWorkspace: async () => ({
          connection: { state: 'identity_required' },
          observedAt: '2026-08-25T01:05:00.000Z',
          availableWorkerUsers: [],
          projects: []
        }),
        createProject: async () => { throw new Error('unused') }
      },
      requirements: {
        saveDraft: async () => { throw new Error('unused') },
        complete: async () => {
          throw new ProjectCoordinatorRequirementsCompletionError(
            'runtime_execution_failed',
            'provider-secret: exact upstream diagnostics'
          )
        },
        confirm: async () => { throw new Error('unused') }
      },
      membership: coordinatorMembershipPort(),
      delivery: coordinatorDeliveryPort(),


      coordinatorCloudCommands: coordinatorCloudCommandService(),
      actions: coordinatorActionPort()
    },
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub()
  })
  const generate = factory.createDefinitions().find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete
  )!
  const response = await generate.handler({
    projectId: 'prj_ProjectCreated01'
  }, uiInvocationContext('invocation-requirements-completion-failure'))

  assert.deepEqual(response, {
    output: {
      status: 'failed',
      reason: 'runtime_execution_failed'
    }
  })
  assert.doesNotMatch(JSON.stringify(response), /provider-secret/u)
})

function coordinatorActionPort() {
  return Object.freeze({
    deleteProject: async () => { throw new Error('unused') },
    transferCoordinator: async () => { throw new Error('unused') },
    createHumanNeeded: async () => { throw new Error('unused') },
    answerHumanNeeded: async () => { throw new Error('unused') },
    reviewResult: async () => { throw new Error('unused') },
    completeProject: async () => { throw new Error('unused') },
    handleInbox: async () => { throw new Error('unused') }
  })
}

function coordinatorMembershipPort() {
  return Object.freeze({
    addMember: async () => { throw new Error('unused') },
    acceptInvitation: async () => { throw new Error('unused') },
    removeMember: async () => { throw new Error('unused') }
  })
}

function projectCreateCapability(
  createProject: ProjectCreationOrchestrator['create']
): ProjectCoordinatorCapabilityOptions {
  return createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: projectCreatePorts(async () => { throw new Error('unused') }) as never,
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub(createProject)
  }).createDefinitions().find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate
  ))!
}

function projectCreatePorts(
  createProject: () => Promise<unknown>,
  onWorkspaceRead: () => void = () => undefined
) {
  return {
    workspace: {
      readWorkspace: async () => {
        onWorkspaceRead()
        return createdProjectResult().workspace
      },
      createProject
    },
    membership: coordinatorMembershipPort(),
      delivery: coordinatorDeliveryPort(),


    coordinatorCloudCommands: coordinatorCloudCommandService(),
    actions: coordinatorActionPort()
  }
}

function createdProjectResult() {
  return {
    createIntentId: 'pct_MainCreateIntent001',
    createdProjectId: 'prj_ProjectCreated01',
    workspace: {
      connection: {
        state: 'ready' as const,
        userId: 'usr_Owner0000001',
        deviceId: 'dev_Device0000001'
      },
      observedAt: '2026-08-25T01:05:00.000Z',
      focusedProjectId: 'prj_ProjectCreated01',
      availableWorkerUsers: [],
      projects: [createdProjectView()]
    },
    coordinatorSession: {
      projectId: 'prj_ProjectCreated01',
      runtimeId: 'runtime-created-project',
      threadId: 'thread-created-project'
    },
    activationRequestId: 'pca_MainActivation01'
  }
}

function projectCreationStub(
  create: ProjectCreationOrchestrator['create'] = async () => createdProjectResult()
): ProjectCreationOrchestrator {
  return {
    create,
    acknowledgeActivation: async () => undefined
  } as unknown as ProjectCreationOrchestrator
}

function createdProjectView() {
  const at = '2026-08-25T01:05:00.000Z'
  return {
    project: {
      schemaVersion: 1 as const,
      type: 'project' as const,
      projectId: 'prj_ProjectCreated01',
      ownerUserId: 'usr_Owner0000001',
      displayName: 'Meeting',
      goal: 'Run the meeting.',
      coordinatorAgentId: 'agt_Coordinator01',
      coordinatorAuthorityEpoch: 1,
      executionAuthorityEpoch: 1,
      status: 'draft' as const,
      budget: {
        maxTasks: 4,
        maxTasksPerRound: 4,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      },
      revision: 1,
      createdAt: at,
      updatedAt: at
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
    memberships: [{
        schemaVersion: 1 as const,
        type: 'project_membership' as const,
        projectMembershipId: 'pmb_ProjectOwner001',
        projectId: 'prj_ProjectCreated01',
        userId: 'usr_Owner0000001',
        state: 'active' as const,
        authorityEpoch: 1,
        activatedAt: at,
        removalRequestedAt: null,
        removalRequestedByUserId: null,
        removedAt: null,
        revision: 1,
        createdAt: at,
        updatedAt: at
      }],
      legacyHistory: { readOnly: true as const, plans: [], tasks: [], executions: [] },
      deliveryDrive: null
  }
}

function sessionProjectionPort(): ProjectCoordinatorSessionProjectionPort {
  const sessions: ProjectCoordinatorSessionProjectionPort = {
    readOwnership: async () => [],
    readProjection: async () => ({
      schemaVersion: 2,
      observedAt: '2026-08-28T00:00:00.000Z',
      bindings: [],
      suppressedSessions: [],
      pendingActivations: []
    }),
    scopeWorkspaceRead: async (input) => input,
    authorize: async () => { throw new Error('unused') },
    authorizeInvitationAcceptance: async () => undefined
  }
  return Object.freeze(sessions)
}

function uiInvocationContext(
  invocationId?: string
): DomainMainCapabilityInvocationContext {
  return {
    caller: { audience: 'ui' },
    ...(invocationId ? { invocationId } : {}),
    assertPrincipalCurrent: () => undefined
  }
}

function agentInvocationContext(
  invocationId: string
): DomainMainCapabilityInvocationContext {
  return {
    caller: { audience: 'agent' },
    invocationId,
    ordinarySession: {
      runtimeId: 'runtime-agent',
      threadId: 'thread-agent'
    },
    assertPrincipalCurrent: () => undefined
  }
}


test('navigation ownership capability is UI-only and never enters Cloud authorization', async () => {
  const expected = [{ runtimeId: 'codex', threadId: 'owned-thread' }]
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: input => input,
    ports: {} as never,
    sessions: { ...sessionProjectionPort(), readOwnership: async () => expected },
    projectCreation: {} as never
  })
  const capability = factory.createDefinitions().find(({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.sessionOwnershipRead)!
  assert.deepEqual(capability.audiences, ['ui'])
  assert.equal(capability.effect, 'read')
  assert.deepEqual(await capability.handler({}, uiInvocationContext()), { output: expected })
})

function coordinatorDeliveryPort() {
  return {
    readObject: async () => { throw new Error('unused') },
    read: async () => { throw new Error('unused') },
    listDrive: async () => { throw new Error('unused') },
    decideAdoption: async () => { throw new Error('unused') },
    requestRevision: async () => { throw new Error('unused') },
    publishResult: async () => { throw new Error('unused') },
    completeProject: async () => { throw new Error('unused') }
  }
}


test('main entry acquires Identity reads/signing and Collaboration Agent command mediation', async (t) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-coordinator-main-'))
  t.after(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })
  let executeCalls = 0
  let userDataDirCalls = 0
  const acquired: Array<{ serviceId: string; contractVersion: string }> = []
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud-run0.sciforge.cn/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
    }),
    execute: async () => {
      executeCalls += 1
      throw new Error('The skeleton must not invent a Cloud operation.')
    }
  }
  const signingService: DeviceFactAttestationSigningService = {
    signDeviceFact: async () => {
      throw new Error('A read capability must not request a Device signature.')
    }
  }
  let coordinatorInboxSubscribed = false
  const coordinatorService: CoordinatorCloudCommandService = {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
    localAgentId: () => 'agt_ProjectCoordinator1',
    execute: async () => { throw new Error('No Coordinator write is expected.') },
    resume: async () => null,
    subscribe: () => {
      coordinatorInboxSubscribed = true
      return () => { coordinatorInboxSubscribed = false }
    }
  }
  const workerSessionProjection: WorkerSessionProjectionService = {
    listBindings: async () => []
  }
  const host: DomainMainHost = {
    getUserDataDir: () => {
      userDataDirCalls += 1
      return userDataDir
    },
    defineCapability: (input) => input,
    openPath: async () => undefined,
    packageSettings: {
      read: async () => ({ revision: 0, value: null }),
      write: async (value) => ({ revision: 1, value }),
      clear: async () => ({ revision: 1, value: null })
    },
    portableResources: {
      materialize: async () => { throw new Error('No artifact review is expected.') },
      discard: async () => undefined,
      export: async () => { throw new Error('No portable export is expected.') }
    },
    internalServices: {
      register: () => undefined,
      acquire: ((serviceId: string, contractVersion: string) => {
        acquired.push({ serviceId, contractVersion })
        if (serviceId === AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID) return transport
        if (serviceId === DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID) return signingService
        if (serviceId === COORDINATOR_CLOUD_COMMAND_SERVICE_ID) return coordinatorService
        if (serviceId === WORKER_SESSION_PROJECTION_SERVICE_ID) return workerSessionProjection
        throw new Error(`Unexpected internal service ${serviceId}.`)
      }) as NonNullable<DomainMainHost['internalServices']>['acquire']
    }
  }
  const entry = createCoordinatorMainEntry<ProjectCoordinatorCapabilityOptions>(host)
  assert.equal(userDataDirCalls, 0, 'registry construction must not instantiate recovery Workspace state')
  assert.equal(entry.contributions.length, 2)
  assert.deepEqual(acquired, [
    {
      serviceId: COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
      contractVersion: COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION
    },
    {
      serviceId: WORKER_SESSION_PROJECTION_SERVICE_ID,
      contractVersion: WORKER_SESSION_PROJECTION_CONTRACT_VERSION
    }
  ])
  const factory = entry.contributions[0]!.value as
    ProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>
  assert.deepEqual(factory.createDefinitions().map(({ id }) => id), [
    DELIVERY_CONTENT_ACTIONS.open,
    DELIVERY_CONTENT_ACTIONS.describe,
    DELIVERY_CONTENT_ACTIONS.readRange,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionOwnershipRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,


    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,


    PROJECT_COORDINATOR_CAPABILITY_IDS.deliveryRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.driveList,
    PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide,
    PROJECT_COORDINATOR_CAPABILITY_IDS.revisionRequest,
    PROJECT_COORDINATOR_CAPABILITY_IDS.resultPublish,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete
  ])
  assert.deepEqual(
    (entry.contributions[1] as { contract?: unknown }).contract,
    {
      requestedSystemCapabilityGrants: []
    }
  )
  assert.equal(coordinatorInboxSubscribed, false)
  assert.equal(executeCalls, 0)
  await entry.contributions[1]?.onDispose?.()
  assert.equal(coordinatorInboxSubscribed, false)
})


test('Agent reads target an explicit Project independently of ordinary Session bindings', async () => {
  const seenProjectionSessions: unknown[] = []
  let workspaceReads = 0
  const sessions: ProjectCoordinatorSessionProjectionPort = {
    ...sessionProjectionPort(),
    readOwnership: async () => [],
    readProjection: async (session) => {
      seenProjectionSessions.push(session)
      return {
        schemaVersion: 2,
        observedAt: '2026-08-28T00:00:00.000Z',
        bindings: [],
        suppressedSessions: [],
        pendingActivations: []
      }
    },
    scopeWorkspaceRead: async (input) => input
  }
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: projectCreatePorts(async () => createdProjectResult(), () => {
      workspaceReads += 1
    }) as never,
    sessions,
    projectCreation: projectCreationStub()
  })
  const definitions = factory.createDefinitions()
  assert.equal(definitions.some(({ id }) => id.endsWith('.session.bind')), false)
  assert.deepEqual(definitions.filter(({ audiences }) => (
    audiences.includes('agent')
  )).map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,


    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,


  ])

  const projection = definitions.find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead
  ))!
  const firstSession = agentInvocationContext('invocation-read-session-1')
  await projection.handler({}, firstSession)
  await projection.handler({}, uiInvocationContext())
  assert.deepEqual(seenProjectionSessions, [firstSession.ordinarySession, undefined])

  const workspaceRead = definitions.find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead
  ))!
  const workspaceResult = await workspaceRead.handler({
    projectId: 'prj_ProjectCreated01'
  }, firstSession)
  assert.equal((workspaceResult.output as { focusedProjectId?: string }).focusedProjectId,
    'prj_ProjectCreated01')
  assert.equal(workspaceReads, 1)
})
