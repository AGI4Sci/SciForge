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
import type { ProjectCoordinatorSessionProjectionPort } from './session-projection.js'
import {
  createProjectContentProvisioningAttestationSigningPort
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
    sessions: sessionProjectionPort()
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
      deviceId: 'dev_Device0000001'
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
    execute: async () => { throw new Error('No Coordinator write is expected.') },
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
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryRetrySuccessor,
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
    execute: async () => {
      throw new Error('No write capability invoked this test service.')
    },
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
    }
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
    sessions: sessionProjectionPort()
  })
  const definitions = factory.createDefinitions()

  assert.deepEqual(definitions.map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryRetrySuccessor,
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
  assert.equal(create.effect, 'external-write')
  assert.equal(create.approval, 'confirmation')
  assert.equal(create.concurrency.idempotency, 'required')
  const generate = definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate
  )!
  assert.equal(generate.effect, 'workspace-write')
  const transfer = definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer
  )!
  assert.equal(transfer.effect, 'external-write')
  assert.equal(transfer.approval, 'confirmation')
  assert.equal(transfer.concurrency.idempotency, 'required')
  assert.deepEqual(await create.handler({
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

test('Agent project.create binds only after an exact successful canonical receipt', async () => {
  const result = createdProjectResult()
  const successfulSessions = trackingSessionProjectionPort()
  const successful = projectCreateCapability(async () => result, successfulSessions.port)
  const context = agentInvocationContext('invocation-agent-create-1')

  assert.deepEqual(await successful.handler({
    displayName: 'Meeting',
    goal: 'Run the meeting.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  }, context), { output: result })
  assert.deepEqual(successfulSessions.boundSessions, [context.ordinarySession])

  const rejectedSessions = trackingSessionProjectionPort()
  const rejected = projectCreateCapability(async () => {
    throw new Error('canonical create rejected')
  }, rejectedSessions.port)
  await assert.rejects(() => rejected.handler({
    displayName: 'Rejected',
    goal: 'Remain unbound.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  }, agentInvocationContext('invocation-agent-create-2')), /canonical create rejected/u)
  assert.deepEqual(rejectedSessions.boundSessions, [])

  for (const failure of [
    Object.assign(new Error('Project create was cancelled.'), { name: 'AbortError' }),
    Object.assign(new Error('Project create timed out.'), { name: 'TimeoutError' })
  ]) {
    const interruptedSessions = trackingSessionProjectionPort()
    const interrupted = projectCreateCapability(async () => {
      throw failure
    }, interruptedSessions.port)
    await assert.rejects(() => interrupted.handler({
      displayName: failure.name,
      goal: 'Remain unbound after an interrupted create.',
      budget: {
        maxTasks: 4,
        maxTasksPerRound: 4,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      }
    }, agentInvocationContext(`invocation-agent-${failure.name.toLowerCase()}`)), failure)
    assert.deepEqual(interruptedSessions.boundSessions, [])
  }

  const invalidSessions = trackingSessionProjectionPort()
  const invalid = projectCreateCapability(async () => ({
    createdProjectId: result.createdProjectId,
    workspace: {
      connection: { state: 'identity_required' },
      observedAt: '2026-08-25T01:05:00.000Z',
      focusedProjectId: result.createdProjectId,
      availableWorkerUsers: [],
      providerPrincipalFacts: [],
      projects: []
    }
  }) as never, invalidSessions.port)
  await assert.rejects(() => invalid.handler({
    displayName: 'Invalid receipt',
    goal: 'Remain unbound after response drift.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  }, agentInvocationContext('invocation-agent-create-3')))
  assert.deepEqual(invalidSessions.boundSessions, [])

  let alreadyBoundCloudCreates = 0
  const alreadyBoundSessions = trackingSessionProjectionPort({ alreadyBound: true })
  const alreadyBound = projectCreateCapability(async () => {
    alreadyBoundCloudCreates += 1
    return result
  }, alreadyBoundSessions.port)
  await assert.rejects(() => alreadyBound.handler({
    displayName: 'Second Project',
    goal: 'Fail before a second Cloud create.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  }, agentInvocationContext('invocation-agent-create-bound')), /already bound/u)
  assert.equal(alreadyBoundCloudCreates, 0)
  assert.deepEqual(alreadyBoundSessions.boundSessions, [])
})

test('Agent reads require exact ordinary Session scope and cannot enumerate sibling Sessions', async () => {
  const seenProjectionSessions: unknown[] = []
  let workspaceReads = 0
  const sessions: ProjectCoordinatorSessionProjectionPort = {
    ...sessionProjectionPort(),
    readProjection: async (session) => {
      seenProjectionSessions.push(session)
      return {
        schemaVersion: 1,
        observedAt: '2026-08-28T00:00:00.000Z',
        bindings: []
      }
    },
    scopeWorkspaceRead: async () => {
      throw new Error('The ordinary Session is not bound to a Cloud Project.')
    }
  }
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: projectCreatePorts(async () => createdProjectResult(), () => {
      workspaceReads += 1
    }) as never,
    sessions
  })
  const definitions = factory.createDefinitions()
  assert.equal(definitions.some(({ id }) => id.endsWith('.session.bind')), false)
  assert.deepEqual(definitions.filter(({ audiences }) => (
    audiences.includes('agent')
  )).map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowPrepare,
    PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
    PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryRetrySuccessor,
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
  await assert.rejects(
    workspaceRead.handler({}, firstSession),
    /not bound to a Cloud Project/u
  )
  assert.equal(workspaceReads, 0)
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
    }
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

function coordinatorActionPort() {
  return Object.freeze({
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
    abandon: async () => { throw new Error('unused') },
    retrySuccessor: async () => { throw new Error('unused') }
  })
}

function projectCreateCapability(
  createProject: () => Promise<unknown>,
  sessions: ProjectCoordinatorSessionProjectionPort
): ProjectCoordinatorCapabilityOptions {
  return createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: projectCreatePorts(createProject) as never,
    sessions
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
    }
  }
}

function trackingSessionProjectionPort(
  input: Readonly<{ alreadyBound?: boolean }> = {}
) {
  const boundSessions: unknown[] = []
  let bound = input.alreadyBound ?? false
  const port: ProjectCoordinatorSessionProjectionPort = {
    ...sessionProjectionPort(),
    withUnboundSession: async (_session, operation) => {
      if (bound) throw new Error('The ordinary Session is already bound to a Cloud Project.')
      return operation()
    },
    bindCreatedProject: async (result, session) => {
      boundSessions.push(session)
      bound = true
      return {
        schemaVersion: 1,
        role: 'coordinator',
        projectId: result.createdProjectId,
        principalUserId: 'usr_Owner0000001',
        coordinatorAgentId: 'agt_Coordinator01',
        coordinatorAuthorityEpoch: 1,
        runtimeId: session.runtimeId,
        threadId: session.threadId,
        boundAt: '2026-08-25T01:05:00.000Z',
        access: 'coordinator',
        fenceReason: null
      }
    }
  }
  return { port, boundSessions }
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
      schemaVersion: 1,
      observedAt: '2026-08-28T00:00:00.000Z',
      bindings: []
    }),
    scopeWorkspaceRead: async (input) => input,
    withUnboundSession: async (_session, operation) => operation(),
    bindCreatedProject: async () => { throw new Error('unused') },
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
