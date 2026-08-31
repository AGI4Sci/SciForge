import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainMainCapabilityInvocationContext,
  DomainMainHost
} from '@sciforge/domain-sdk/host'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  type CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'
import {
  WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  WORKER_SESSION_PROJECTION_SERVICE_ID,
  type WorkerSessionProjectionService
} from '@sciforge/domain-collaboration/worker-session-projection'
import {
  AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
  AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION,
  DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
  type DeviceFactAttestationSigningService
} from '@sciforge/domain-identity-access/device-fact-attestation-signing'

import { PROJECT_COORDINATOR_CAPABILITY_IDS } from './contract.js'
import {
  createDomainMainEntry,
  createProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityOptions
} from './main.js'
import type { ProjectCreationOrchestrator } from './project-creation-orchestrator.js'
import type { ProjectCoordinatorSessionProjectionPort } from './session-projection.js'
import {
  createProjectContentProvisioningAttestationSigningPort,
  ProjectCoordinatorPlanGenerationError
} from './ports.js'

test('workspace read remains a strict non-writing coordination capability', async () => {
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      workspace: {
        readWorkspace: async () => ({
          connection: { state: 'identity_required' },
          observedAt: '2026-08-24T09:00:00.000Z',
          availableWorkerUsers: [],
          providerPrincipalFacts: [],
          projects: []
        }),
        createProject: async () => { throw new Error('unused') }
      },
      plan: {
        readDraft: async () => null,
        generateDraft: async () => { throw new Error('unused') },
        editDraft: async () => { throw new Error('unused') },
        submitDraft: async () => { throw new Error('unused') },
        confirm: async () => { throw new Error('unused') },
        activateAndReconcile: async () => { throw new Error('unused') }
      },
      provisioningAttestationSigning: {
        signFactualPayload: async () => { throw new Error('unused') }
      },
      provisioning: coordinatorProvisioningPort(),
      recovery: coordinatorRecoveryPort(),
      artifactReview: coordinatorArtifactReviewPort(),
      coordinatorCloudCommands: coordinatorCloudCommandService(),
      actions: coordinatorActionPort()
    },
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub()
  })
  const definitions = factory.createDefinitions()
  assert.deepEqual(factory.policy.directTransportPrefixes, [])
  assert.deepEqual(factory.policy.allowedDirectTransports, [])
  assert.equal(definitions[0]?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead)
  assert.equal(definitions[0]?.effect, 'read')
  assert.equal(definitions[0]?.approval, 'none')
  assert.deepEqual(await definitions[0]!.handler({}, uiInvocationContext()), {
    output: {
      connection: { state: 'identity_required' },
      observedAt: '2026-08-24T09:00:00.000Z',
      availableWorkerUsers: [],
      providerPrincipalFacts: [],
      projects: []
    }
  })
})

test('main entry acquires Identity reads/signing and Collaboration Agent command mediation', async () => {
  let executeCalls = 0
  let userDataDirCalls = 0
  const acquired: Array<{ serviceId: string; contractVersion: string }> = []
  const transport: AuthenticatedCloudTransport = {
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
    localAgentId: () => 'agt_ProjectCoordinator1',
    execute: async () => { throw new Error('No Coordinator write is expected.') },
    resume: async () => null,
    subscribe: () => {
      coordinatorInboxSubscribed = true
      return () => { coordinatorInboxSubscribed = false }
    }
  }
  const workerSessionProjection: WorkerSessionProjectionService = {
    listBindings: () => []
  }
  const host: DomainMainHost = {
    getUserDataDir: () => {
      userDataDirCalls += 1
      return '/tmp/sciforge-project-coordinator-test'
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
  const entry = createDomainMainEntry<ProjectCoordinatorCapabilityOptions>(host)
  assert.equal(userDataDirCalls, 0, 'registry construction must not instantiate recovery Workspace state')
  assert.equal(entry.contributions.length, 2)
  assert.deepEqual(acquired, [
    {
      serviceId: AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
      contractVersion: AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION
    },
    {
      serviceId: DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
      contractVersion: DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION
    },
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
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.artifactReviewPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete
  ])
  assert.deepEqual(
    (entry.contributions[1] as { contract?: unknown }).contract,
    {
      requestedSystemCapabilityGrants: [
        'content-space.provisioning-batch',
        'content-space.recovery-observation'
      ]
    }
  )
  assert.equal(coordinatorInboxSubscribed, true)
  assert.equal(executeCalls, 0)
  await entry.contributions[1]?.onDispose?.()
  assert.equal(coordinatorInboxSubscribed, false)
})

function coordinatorCloudCommandService(): CoordinatorCloudCommandService {
  return Object.freeze({
    localAgentId: () => 'agt_ProjectCoordinator1',
    execute: async () => {
      throw new Error('No write capability invoked this test service.')
    },
    resume: async () => null,
    subscribe: () => () => undefined
  })
}

test('provisioning signing port locks Identity delegation to factual Project content attestations', async () => {
  let received: unknown
  const port = createProjectContentProvisioningAttestationSigningPort({
    signDeviceFact: async (request) => {
      received = request
      throw new Error('captured')
    }
  })
  await assert.rejects(
    port.signFactualPayload({
      factDigest: 'a'.repeat(64),
      factRevision: 5,
      observedAt: '2026-08-24T09:00:00.000Z'
    }),
    /captured/u
  )
  assert.deepEqual(received, {
    purpose: 'project-content-provisioning-attestation',
    factDigest: 'a'.repeat(64),
    factRevision: 5,
    observedAt: '2026-08-24T09:00:00.000Z'
  })
})

test('governed UI capabilities expose Project create and the local-to-Cloud Plan workflow', async () => {
  const created = {
    createIntentId: 'pct_UiCreateIntent0001',
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
      providerPrincipalFacts: [],
      projects: [createdProjectView()]
    },
    coordinatorSession: {
      projectId: 'prj_ProjectCreated01',
      runtimeId: 'runtime-created-project',
      threadId: 'thread-created-project'
    },
    activationRequestId: 'pca_UiActivation001'
  }
  // The tracer observes only capability policy and delegation. Cloud parsing,
  // pagination, digest and CAS behavior are covered through the public ports.
  const ports = {
    workspace: {
      readWorkspace: async () => ({
        connection: { state: 'identity_required' as const },
        observedAt: '2026-08-25T01:05:00.000Z',
        availableWorkerUsers: [],
        providerPrincipalFacts: [],
        projects: []
      }),
      createProject: async () => created
    },
    plan: {
      readDraft: async () => null,
      generateDraft: async () => { throw new Error('unused') },
      editDraft: async () => { throw new Error('unused') },
      submitDraft: async () => { throw new Error('unused') },
      confirm: async () => { throw new Error('unused') },
      activateAndReconcile: async () => { throw new Error('unused') }
    },
    provisioningAttestationSigning: {
      signFactualPayload: async () => { throw new Error('unused') }
    },
    provisioning: coordinatorProvisioningPort(),
    recovery: coordinatorRecoveryPort(),
    artifactReview: coordinatorArtifactReviewPort(),
    coordinatorCloudCommands: coordinatorCloudCommandService(),
    actions: coordinatorActionPort()
  }
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: ports as never,
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub(async () => created)
  })
  const definitions = factory.createDefinitions()

  assert.deepEqual(definitions.map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.artifactReviewPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete
  ])
  const create = definitions.find(({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate)!
  assert.equal(create.version, '2.0.0')
  assert.equal(create.effect, 'external-write')
  assert.equal(create.approval, 'confirmation')
  assert.equal(create.concurrency.idempotency, 'required')
  const projectDelete = definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete
  )!
  assert.equal(projectDelete.version, '1.0.0')
  assert.equal(projectDelete.effect, 'destructive')
  assert.equal(projectDelete.approval, 'confirmation')
  assert.equal(projectDelete.concurrency.idempotency, 'required')
  const generate = definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate
  )!
  assert.equal(generate.version, '3.0.0')
  assert.equal(generate.effect, 'workspace-write')
  for (const id of [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete
  ]) {
    assert.equal(definitions.find((definition) => definition.id === id)?.version, '2.0.0')
  }
  assert.equal(definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead
  )?.version, '3.0.0')
  const activation = definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge
  )!
  assert.deepEqual(activation.audiences, ['ui'])
  const transfer = definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer
  )!
  assert.equal(transfer.effect, 'external-write')
  assert.equal(transfer.approval, 'confirmation')
  assert.equal(transfer.concurrency.idempotency, 'required')
  assert.deepEqual(await create.handler({
    createIntentId: 'pct_UiCreateIntent0001',
    displayName: 'Meeting',
    goal: 'Run the meeting.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  }, uiInvocationContext('invocation-project-create-1')), {
    output: created
  })
})

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

test('Agent reads target an explicit Project independently of ordinary Session bindings', async () => {
  const seenProjectionSessions: unknown[] = []
  let workspaceReads = 0
  const sessions: ProjectCoordinatorSessionProjectionPort = {
    ...sessionProjectionPort(),
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
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
    PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,
    PROJECT_COORDINATOR_CAPABILITY_IDS.artifactReviewPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete
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

test('membership-inactive Agent scope rejects external writes before the canonical port', async () => {
  let addMemberCalls = 0
  const basePorts = projectCreatePorts(async () => createdProjectResult())
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      ...basePorts,
      provisioning: {
        ...coordinatorProvisioningPort(),
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
    providerPrincipalFactId: null,
    expectedProviderPrincipalFactRevision: null
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
  assert.match(calls[0]!.idempotencyKey, /^idem_project-coordinator\.[a-f0-9]{48}$/u)

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

test('Plan generation capability returns only a bounded package-owned failure reason', async () => {
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      workspace: {
        readWorkspace: async () => ({
          connection: { state: 'identity_required' },
          observedAt: '2026-08-25T01:05:00.000Z',
          availableWorkerUsers: [],
          providerPrincipalFacts: [],
          projects: []
        }),
        createProject: async () => { throw new Error('unused') }
      },
      plan: {
        readDraft: async () => null,
        generateDraft: async () => {
          throw new ProjectCoordinatorPlanGenerationError(
            'invalid_structured_output',
            'provider-secret: exact upstream schema diagnostics'
          )
        },
        editDraft: async () => { throw new Error('unused') },
        submitDraft: async () => { throw new Error('unused') },
        confirm: async () => { throw new Error('unused') },
        activateAndReconcile: async () => { throw new Error('unused') }
      },
      provisioningAttestationSigning: {
        signFactualPayload: async () => { throw new Error('unused') }
      },
      provisioning: coordinatorProvisioningPort(),
      recovery: coordinatorRecoveryPort(),
      artifactReview: coordinatorArtifactReviewPort(),
      coordinatorCloudCommands: coordinatorCloudCommandService(),
      actions: coordinatorActionPort()
    },
    sessions: sessionProjectionPort(),
    projectCreation: projectCreationStub()
  })
  const generate = factory.createDefinitions().find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate
  )!
  const response = await generate.handler({
    projectId: 'prj_ProjectCreated01',
    instruction: 'Create a bounded plan.',
    sourceInputLocators: [],
    modelId: null
  }, uiInvocationContext('invocation-plan-generation-failure'))

  assert.deepEqual(response, {
    output: {
      status: 'failed',
      reason: 'invalid_structured_output'
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

function coordinatorArtifactReviewPort() {
  return Object.freeze({
    prepare: async () => { throw new Error('unused') }
  })
}

function coordinatorProvisioningPort() {
  return Object.freeze({
    prepareWorkflow: async () => { throw new Error('unused') },
    continueWorkflow: async () => { throw new Error('unused') },
    addMember: async () => { throw new Error('unused') },
    acceptInvitation: async () => { throw new Error('unused') },
    removeMember: async () => { throw new Error('unused') }
  })
}

function coordinatorRecoveryPort() {
  return Object.freeze({
    observeAndLink: async () => { throw new Error('unused') },
    abandon: async () => { throw new Error('unused') }
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
    plan: {
      readDraft: async () => null,
      generateDraft: async () => { throw new Error('unused') },
      editDraft: async () => { throw new Error('unused') },
      submitDraft: async () => { throw new Error('unused') },
      confirm: async () => { throw new Error('unused') },
      activateAndReconcile: async () => { throw new Error('unused') }
    },
    provisioningAttestationSigning: {
      signFactualPayload: async () => { throw new Error('unused') }
    },
    provisioning: coordinatorProvisioningPort(),
    recovery: coordinatorRecoveryPort(),
    artifactReview: coordinatorArtifactReviewPort(),
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
      providerPrincipalFacts: [],
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
      contentMode: 'none' as const,
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
      providerPrincipalFacts: [],
      contentReadiness: [],
      providerMembershipObservations: [],
      externalOperationJournal: [],
      recoveryActions: []
    }
  }
}

function sessionProjectionPort(): ProjectCoordinatorSessionProjectionPort {
  const sessions: ProjectCoordinatorSessionProjectionPort = {
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
