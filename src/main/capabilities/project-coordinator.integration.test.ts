import { describe, expect, it, vi } from 'vitest'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type {
  DomainMainHost,
  DomainMainInternalServiceHost,
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeLifecycleContribution,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
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
import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorProjectCreateResultSchema,
  type ProjectCoordinatorProjectCreateResult
} from '@sciforge/domain-project-coordinator/contract'
import {
  createDomainMainEntry,
  createProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityOptions
} from '@sciforge/domain-project-coordinator/main'
import {
  TEST_IDS,
  projectFixture
} from '@sciforge/collaboration-contracts/testing'

import type { CapabilityCallerContextInput } from '../../shared/capability-broker'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface
} from './agent-tools'
import { CapabilityBroker } from './broker'
import {
  CapabilityRegistry,
  defineCapability,
  type CapabilityDefinition
} from './registry'
import {
  createRuntimeCapabilityBroker
} from '../runtime/agent-runtime/runtime-capability-broker'
import {
  createRuntimeMcpToolGateway
} from '../runtime/agent-runtime/runtime-mcp-tool-gateway'

const created: ProjectCoordinatorProjectCreateResult = {
  createIntentId: 'pct_HostCreateIntent0001',
  createdProjectId: TEST_IDS.projectId,
  workspace: {
    connection: {
      state: 'ready',
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId
    },
    observedAt: '2026-08-27T01:30:00.000Z',
    focusedProjectId: TEST_IDS.projectId,
    availableWorkerUsers: [],
      providerPrincipalFacts: [],
      projects: [{
      project: projectFixture,
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
  },
  coordinatorSession: {
    projectId: TEST_IDS.projectId,
    runtimeId: 'runtime-project-created',
    threadId: 'thread-project-created'
  },
  activationRequestId: 'pca_HostActivation01'
}

function projectCreationStub(
  create: (
    input: unknown,
    context: unknown
  ) => Promise<ProjectCoordinatorProjectCreateResult> = async () => created
) {
  return {
    create,
    acknowledgeActivation: async () => undefined
  } as never
}

const hostProject = Object.freeze({
  ...projectFixture,
  status: 'draft' as const
})

const hostOwnerMembership = Object.freeze({
  schemaVersion: 1 as const,
  type: 'project_membership' as const,
  projectMembershipId: TEST_IDS.projectMembershipId,
  projectId: TEST_IDS.projectId,
  userId: TEST_IDS.userId,
  state: 'active' as const,
  authorityEpoch: 1,
  activatedAt: projectFixture.createdAt,
  removalRequestedAt: null,
  removalRequestedByUserId: null,
  removedAt: null,
  revision: 1,
  createdAt: projectFixture.createdAt,
  updatedAt: projectFixture.updatedAt
})

describe('Project Coordinator Host capability integration', () => {
  it('persists one fresh Coordinator Session through the real Host entry and replays the same create intent', async () => {
    const settings = inMemorySettings()
    let projectCreated = false
    const cloudRequestTypes: string[] = []
    const cloudExecute: AuthenticatedCloudTransport['execute'] = vi.fn(async (request) => {
      cloudRequestTypes.push(request.payload.type)
      switch (request.payload.type) {
        case 'project.list':
          return cloudResponse({
            protocolVersion: '1.0',
            type: 'rest.project_page',
            requestId: request.payload.requestId,
            limit: request.payload.limit,
            projects: projectCreated ? [hostProject] : [],
            observedAt: projectFixture.updatedAt
          })
        case 'worker.availability.list':
          return cloudResponse({
            protocolVersion: '1.0',
            type: 'rest.worker_availability_page',
            requestId: request.payload.requestId,
            observedAt: projectFixture.updatedAt,
            items: [],
            userLabels: [],
            agentLabels: []
          })
        case 'provider_directory_principal.list':
          return cloudResponse({
            protocolVersion: '1.0',
            type: 'rest.provider_directory_principal_page',
            requestId: request.payload.requestId,
            items: []
          })
        case 'project.coordination.read':
          return cloudResponse({
            protocolVersion: '1.0',
            type: 'rest.project_coordination',
            requestId: request.payload.requestId,
            project: hostProject,
            observedAt: projectFixture.updatedAt,
            pages: [{
              collection: 'memberships',
              limit: request.payload.collections.find(
                (candidate: Readonly<{ collection: string }>) => (
                  candidate.collection === 'memberships'
                )
              )?.limit ?? 250,
              items: [hostOwnerMembership]
            }],
            finalSummary: null
          })
        default:
          throw new Error(`Unexpected authenticated Cloud request ${request.payload.type}.`)
      }
    })
    const transport: AuthenticatedCloudTransport = Object.freeze({
      status: () => ({
        state: 'ready' as const,
        baseUrl: 'https://cloud.host-integration.invalid/',
        userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: cloudExecute
    })
    const coordinatorExecute = vi.fn<CoordinatorCloudCommandService['execute']>(
      async (command) => {
        if (command.type !== 'project.create') {
          throw new Error(`Unexpected Coordinator command ${command.type}.`)
        }
        projectCreated = true
        return {
          protocolVersion: '1.0',
          type: 'rest.project_created',
          requestId: command.requestId,
          project: hostProject,
          memberships: [hostOwnerMembership],
          provisioningIntent: null
        }
      }
    )
    const coordinatorCommands: CoordinatorCloudCommandService = Object.freeze({
      execute: coordinatorExecute,
      resume: async () => null,
      subscribe: () => () => undefined
    })
    const prepareSession = vi.fn<NonNullable<DomainMainAgentExecutionHost['prepareSession']>>(
      async () => ({
        runtimeId: 'runtime-host-project-create',
        threadId: 'thread-host-project-create'
      })
    )
    const run = vi.fn<DomainMainAgentExecutionHost['run']>(async () => {
      throw new Error('Project creation must not dispatch a turn.')
    })
    const agentExecution: DomainMainAgentExecutionHost = Object.freeze({
      prepareSession,
      run
    })
    const host = realProjectCoordinatorHost({
      settings,
      transport,
      coordinatorCommands
    })
    const entry = createDomainMainEntry<CapabilityDefinition>(host)
    const capabilityFactory = entry.contributions.find(
      ({ kind }) => kind === 'main.capability-factory'
    )?.value
    if (!hasCapabilityDefinitions(capabilityFactory)) {
      throw new Error('Project Coordinator capability factory is missing from its main entry.')
    }
    const lifecycleContribution = entry.contributions.find(
      ({ kind }) => kind === 'main.runtime-lifecycle'
    )
    if (!hasRuntimeLifecycle(lifecycleContribution?.value)) {
      throw new Error('Project Coordinator runtime lifecycle is missing from its main entry.')
    }
    const lifecycleDisposer = await lifecycleContribution.value.activate(
      lifecycleContext(agentExecution)
    )

    await vi.waitFor(() => {
      expect(cloudRequestTypes).toEqual([
        'project.list',
        'worker.availability.list',
        'provider_directory_principal.list'
      ])
    })

    const broker = new CapabilityBroker(
      new CapabilityRegistry(capabilityFactory.createDefinitions()),
      { resolveCurrentPrincipal: () => hostPrincipal }
    )
    const input = {
      createIntentId: 'pct_HostRealCreate0001',
      displayName: hostProject.displayName,
      goal: hostProject.goal,
      budget: hostProject.budget
    }
    const firstInvocationId = 'invocation-host-real-project-create-1'
    const first = await broker.invoke(uiCaller(firstInvocationId, true), {
      actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
      invocationId: firstInvocationId,
      input
    })
    const firstOutput = projectCoordinatorProjectCreateResultSchema.parse(first.output)

    expect(first).toMatchObject({ changed: false, replayed: false })
    expect(firstOutput).toMatchObject({
      createIntentId: input.createIntentId,
      createdProjectId: TEST_IDS.projectId,
      coordinatorSession: {
        projectId: TEST_IDS.projectId,
        runtimeId: 'runtime-host-project-create',
        threadId: 'thread-host-project-create'
      }
    })
    expect(coordinatorExecute).toHaveBeenCalledTimes(1)
    expect(prepareSession).toHaveBeenCalledTimes(1)
    expect(prepareSession).toHaveBeenCalledWith({
      interaction: 'reviewable',
      mode: 'agent'
    })
    expect(run).not.toHaveBeenCalled()
    expect(settings.write).toHaveBeenCalledTimes(2)
    expect((await settings.read()).value).toMatchObject({
      schemaVersion: 3,
      coordinatorSessionBindings: [{
        projectId: TEST_IDS.projectId,
        principalUserId: TEST_IDS.userId,
        runtimeId: firstOutput.coordinatorSession.runtimeId,
        threadId: firstOutput.coordinatorSession.threadId
      }],
      projectCreateIntents: [{
        createIntentId: input.createIntentId,
        state: 'succeeded',
        createdProjectId: TEST_IDS.projectId,
        coordinatorSession: {
          runtimeId: firstOutput.coordinatorSession.runtimeId,
          threadId: firstOutput.coordinatorSession.threadId
        },
        activationRequestId: firstOutput.activationRequestId
      }],
      pendingProjectActivations: [{
        activationRequestId: firstOutput.activationRequestId,
        projectId: TEST_IDS.projectId,
        coordinatorSession: {
          runtimeId: firstOutput.coordinatorSession.runtimeId,
          threadId: firstOutput.coordinatorSession.threadId
        }
      }]
    })

    const replayInvocationId = 'invocation-host-real-project-create-2'
    const replay = await broker.invoke(uiCaller(replayInvocationId, true), {
      actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
      invocationId: replayInvocationId,
      input
    })
    expect(projectCoordinatorProjectCreateResultSchema.parse(replay.output)).toEqual(firstOutput)
    expect(replay).toMatchObject({ changed: false, replayed: false })
    expect(coordinatorExecute).toHaveBeenCalledTimes(1)
    expect(prepareSession).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    expect(settings.write).toHaveBeenCalledTimes(2)

    const acknowledgeInvocationId = 'invocation-host-real-project-activation-1'
    await expect(broker.invoke(uiCaller(acknowledgeInvocationId), {
      actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge,
      invocationId: acknowledgeInvocationId,
      input: { activationRequestId: firstOutput.activationRequestId }
    })).resolves.toMatchObject({
      output: { acknowledged: true },
      changed: false,
      replayed: false
    })
    expect((await settings.read()).value).toMatchObject({
      coordinatorSessionBindings: [{
        projectId: TEST_IDS.projectId,
        runtimeId: firstOutput.coordinatorSession.runtimeId,
        threadId: firstOutput.coordinatorSession.threadId
      }],
      pendingProjectActivations: []
    })
    expect(settings.write).toHaveBeenCalledTimes(3)

    await lifecycleDisposer?.()
    await lifecycleContribution.onDispose?.()
  })

  it('returns a successful global Project create without claiming a Broker resource revision', async () => {
    const createProject = vi.fn(async () => created)
    const definitions = createProjectCoordinatorCapabilityFactory<CapabilityDefinition>({
      defineCapability: ({ audiences, tags, producedResourceKinds, ...input }) => defineCapability({
        ...input,
        audiences: [...audiences],
        tags: [...tags],
        ...(producedResourceKinds ? { producedResourceKinds: [...producedResourceKinds] } : {})
      }),
      ports: {} as never,
      sessions: {} as never,
      projectCreation: projectCreationStub(createProject)
    }).createDefinitions()
    const createDefinition = definitions.find(
      ({ descriptor }) => descriptor.id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate
    )
    expect(createDefinition).toBeDefined()

    const broker = new CapabilityBroker(new CapabilityRegistry([createDefinition!]))
    const invocationId = 'invocation-project-create-host-integration-1'
    const caller: CapabilityCallerContextInput = {
      audience: 'ui',
      callerId: 'window-project-coordinator-test',
      workspaceId: 'workspace-project-coordinator-test',
      approvals: [{
        actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
        invocationId,
        mode: 'confirmation'
      }]
    }

    await expect(broker.invoke(caller, {
      actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
      invocationId,
      input: {
        createIntentId: created.createIntentId,
        displayName: 'Meeting',
        goal: 'Run the meeting.',
        budget: {
          maxTasks: 4,
          maxTasksPerRound: 4,
          maxTaskRetries: 1,
          maxCoordinationRounds: 2
        }
      }
    })).resolves.toMatchObject({
      output: created,
      changed: false,
      replayed: false
    })
    expect(createProject).toHaveBeenCalledTimes(1)
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ createIntentId: created.createIntentId }),
      expect.objectContaining({ assertPrincipalCurrent: expect.any(Function) })
    )
  })

  it('exposes the explicit Project capability allowlist through sciforge_discover', async () => {
    const definitions = createProjectCoordinatorCapabilityFactory<CapabilityDefinition>({
      defineCapability: ({ audiences, tags, producedResourceKinds, ...input }) => defineCapability({
        ...input,
        audiences: [...audiences],
        tags: [...tags],
        ...(producedResourceKinds ? { producedResourceKinds: [...producedResourceKinds] } : {})
      }),
      ports: {} as never,
      sessions: {} as never,
      projectCreation: projectCreationStub()
    }).createDefinitions()
    const surface = createCapabilityAgentToolSurface({
      broker: new CapabilityBroker(new CapabilityRegistry(definitions)),
      resolveCaller: () => ({
        audience: 'agent',
        callerId: 'thread-project-discovery',
        approvals: []
      })
    })
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'Project', limit: 50 },
      context: {
        requestId: 'request-project-discovery',
        runtimeId: 'runtime-project-discovery',
        threadId: 'thread-project-discovery'
      }
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) {
      throw new Error('Expected Project capabilities from sciforge_discover.')
    }
    const visibleTitles = discovered.value.map(({ title }) => title)
    expect(visibleTitles).toContain('Read Project coordination workspace')
    expect(visibleTitles).toContain('Create Project')
    expect(visibleTitles).toContain('Continue Project workflow')
    expect(visibleTitles).toContain('Review Task result')
    expect(visibleTitles).toContain('Complete Project with final summary')
    expect(visibleTitles).not.toContain('Bind Project Session')

    const exact = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {
        capabilityId: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
        includeSchema: true,
        limit: 1
      },
      context: {
        requestId: 'request-project-plan-edit-schema',
        runtimeId: 'runtime-project-discovery',
        threadId: 'thread-project-discovery'
      }
    })
    if (exact.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected exact Plan edit discovery.')
    const inputShape = exact.value[0]?.inputShape as {
      properties?: Record<string, { required?: boolean }>
    } | undefined
    expect(inputShape).toMatchObject({ type: 'object' })
    expect(inputShape?.properties).toEqual(expect.objectContaining({
      projectId: expect.objectContaining({ required: true }),
      draftId: expect.objectContaining({ required: true }),
      expectedDraftRevision: expect.objectContaining({ required: true }),
      tasks: expect.objectContaining({ required: true }),
      rationale: expect.objectContaining({ required: true }),
      assignments: expect.objectContaining({ required: true })
    }))

    const localized = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: '协同中心', limit: 5 },
      context: {
        requestId: 'request-project-coordination-center',
        runtimeId: 'runtime-project-discovery',
        threadId: 'thread-project-discovery'
      }
    })
    if (localized.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected localized coordination discovery.')
    expect(localized.value.map(({ title }) => title)).toContain('Read Project coordination workspace')
  })

  it('creates a fresh Coordinator Session through the ordinary Agent Runtime capability route', async () => {
    const createProject = vi.fn(async () => created)
    const definitions = createProjectCoordinatorCapabilityFactory<CapabilityDefinition>({
      defineCapability: ({ audiences, tags, producedResourceKinds, ...input }) => defineCapability({
        ...input,
        audiences: [...audiences],
        tags: [...tags],
        ...(producedResourceKinds ? { producedResourceKinds: [...producedResourceKinds] } : {})
      }),
      ports: {} as never,
      sessions: {} as never,
      projectCreation: projectCreationStub(createProject)
    }).createDefinitions()
    const createDefinition = definitions.find(
      ({ descriptor }) => descriptor.id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate
    )
    expect(createDefinition).toBeDefined()

    const runtimeBroker = createRuntimeCapabilityBroker({
      broker: new CapabilityBroker(new CapabilityRegistry([createDefinition!])),
      managedTools: createRuntimeMcpToolGateway({
        servers: [],
        clientFactory: async () => { throw new Error('unused') }
      })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: runtimeBroker,
      resolveCaller: ({ runtimeId, threadId }) => ({
        audience: 'agent',
        callerId: `${runtimeId}:${threadId ?? 'missing'}`,
        approvals: []
      }),
      requestApproval: async () => 'allowed' as const
    })
    const context = {
      requestId: 'request-project-create-agent-runtime',
      runtimeId: 'runtime-project-coordinator',
      threadId: 'thread-project-coordinator',
      turnId: 'turn-project-create',
      callId: 'call-project-create'
    }
    const discovery = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {
        capabilityId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
        includeSchema: true,
        limit: 1
      },
      context
    })
    if (discovery.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) {
      throw new Error('Expected Project create from sciforge_discover.')
    }
    const operationRef = discovery.value[0]?.operationRef
    expect(operationRef).toBeDefined()

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: {
        operationRef,
        input: {
          createIntentId: created.createIntentId,
          displayName: 'Meeting',
          goal: 'Run the meeting.',
          budget: {
            maxTasks: 4,
            maxTasksPerRound: 4,
            maxTaskRetries: 1,
            maxCoordinationRounds: 2
          }
        }
      },
      context
    })).resolves.toMatchObject({
      tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      value: {
        capabilityId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
        output: created
      }
    })
    expect(createProject).toHaveBeenCalledTimes(1)
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ createIntentId: created.createIntentId }),
      expect.objectContaining({
        preferredRuntimeId: context.runtimeId,
        assertPrincipalCurrent: expect.any(Function)
      })
    )
  })
})

const hostPrincipal = Object.freeze({
  authority: 'sciforge-cloud',
  subject: TEST_IDS.userId,
  assurance: 'cloud-authenticated' as const,
  deviceId: TEST_IDS.deviceId,
  identityVersion: 1
})

function uiCaller(
  invocationId: string,
  approved = false
): CapabilityCallerContextInput {
  return {
    audience: 'ui',
    callerId: 'window-project-coordinator-real-host-test',
    workspaceId: 'workspace-project-coordinator-real-host-test',
    approvals: approved
      ? [{
          actionId: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
          invocationId,
          mode: 'confirmation'
        }]
      : []
  }
}

function cloudResponse(
  body: Awaited<ReturnType<AuthenticatedCloudTransport['execute']>>['body']
): Awaited<ReturnType<AuthenticatedCloudTransport['execute']>> {
  return { contractVersion: 1, status: 200, body }
}

function realProjectCoordinatorHost(input: Readonly<{
  settings: DomainMainPackageSettingsHost
  transport: AuthenticatedCloudTransport
  coordinatorCommands: CoordinatorCloudCommandService
}>): DomainMainHost {
  const signingService: DeviceFactAttestationSigningService = Object.freeze({
    signDeviceFact: async () => {
      throw new Error('Project creation must not request a Device fact signature.')
    }
  })
  const workers: WorkerSessionProjectionService = Object.freeze({
    listBindings: () => []
  })
  const internalServices: DomainMainInternalServiceHost = Object.freeze({
    register: () => undefined,
    acquire: ((serviceId: string, contractVersion: string) => {
      if (
        serviceId === AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID &&
        contractVersion === AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION
      ) return input.transport
      if (
        serviceId === DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID &&
        contractVersion === DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION
      ) return signingService
      if (
        serviceId === COORDINATOR_CLOUD_COMMAND_SERVICE_ID &&
        contractVersion === COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION
      ) return input.coordinatorCommands
      if (
        serviceId === WORKER_SESSION_PROJECTION_SERVICE_ID &&
        contractVersion === WORKER_SESSION_PROJECTION_CONTRACT_VERSION
      ) return workers
      throw new Error(`Unexpected internal service ${serviceId}@${contractVersion}.`)
    }) as DomainMainInternalServiceHost['acquire']
  })
  return Object.freeze({
    getUserDataDir: () => '/tmp/sciforge-project-coordinator-host-integration',
    defineCapability: (input: unknown) => {
      const {
        audiences,
        tags,
        producedResourceKinds,
        ...definition
      } = input as ProjectCoordinatorCapabilityOptions
      return defineCapability({
        ...definition,
        audiences: [...audiences],
        tags: [...tags],
        ...(producedResourceKinds
          ? { producedResourceKinds: [...producedResourceKinds] }
          : {})
      })
    },
    packageSettings: input.settings,
    portableResources: {
      materialize: async () => {
        throw new Error('Project creation must not materialize an artifact.')
      },
      discard: async () => undefined,
      export: async () => {
        throw new Error('Project creation must not export an artifact.')
      }
    },
    internalServices
  })
}

function hasCapabilityDefinitions(value: unknown): value is Readonly<{
  createDefinitions(): readonly CapabilityDefinition[]
}> {
  return typeof value === 'object' && value !== null &&
    'createDefinitions' in value && typeof value.createDefinitions === 'function'
}

function hasRuntimeLifecycle(value: unknown): value is DomainMainRuntimeLifecycleContribution {
  return typeof value === 'object' && value !== null &&
    'activate' in value && typeof value.activate === 'function'
}

function lifecycleContext(
  agentExecution: DomainMainAgentExecutionHost
): DomainMainRuntimeLifecycleContext {
  const capabilities: DomainMainSystemCapabilityInvoker = Object.freeze({
    invoke: async () => {
      throw new Error('The empty activation sweep must not invoke a system capability.')
    },
    createApprovedBatch: () => {
      throw new Error('The empty activation sweep must not create an approved batch.')
    }
  })
  return {
    agentExecution,
    capabilities,
    log: vi.fn()
  } as unknown as DomainMainRuntimeLifecycleContext
}

function inMemorySettings(): DomainMainPackageSettingsHost & Readonly<{
  read: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['read']>>
  write: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['write']>>
  clear: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['clear']>>
}> {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  const read = vi.fn<DomainMainPackageSettingsHost['read']>(async () => ({
    revision,
    value: value === null ? null : structuredClone(value)
  }))
  const write = vi.fn<DomainMainPackageSettingsHost['write']>(async (next, expectedRevision) => {
    if (expectedRevision !== revision) throw new Error('settings revision conflict')
    value = structuredClone(next)
    revision += 1
    return { revision, value: structuredClone(value) }
  })
  const clear = vi.fn<DomainMainPackageSettingsHost['clear']>(async (expectedRevision) => {
    if (expectedRevision !== revision) throw new Error('settings revision conflict')
    value = null
    revision += 1
    return { revision, value }
  })
  return Object.freeze({ read, write, clear })
}
