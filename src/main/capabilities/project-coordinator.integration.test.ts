import {
  TEST_IDS,
  projectFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorProjectCreateResultSchema,
  type ProjectCoordinatorProjectCreateResult
} from '@sciforge/domain-collaboration/contract'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  type CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'
import {
  createDomainMainEntry,
  createProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityOptions
} from '@sciforge/domain-collaboration/main'
import {
  WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  WORKER_SESSION_PROJECTION_SERVICE_ID,
  type WorkerSessionProjectionService
} from '@sciforge/domain-collaboration/worker-session-projection'
import {
  AGENT_CLOUD_RUNTIME_CONTRACT_VERSION,
  AGENT_CLOUD_RUNTIME_SERVICE_ID,
  type AgentCloudRuntime
} from '@sciforge/domain-identity-access/agent-cloud-runtime'
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
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type {
  DomainMainHost,
  DomainMainInternalServiceHost,
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeLifecycleContribution,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  domainMainPackageSettingsSnapshotSchema,
  type DomainMainPackageSettingsHost
} from '@sciforge/domain-sdk/package-storage'
import {
  mkdtemp,
  readFile,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describe,
  expect,
  it,
  vi
} from 'vitest'

import type { CapabilityCallerContextInput } from '../../shared/capability-broker'
import {
  createRuntimeCapabilityBroker
} from '../runtime/agent-runtime/runtime-capability-broker'
import {
  createRuntimeMcpToolGateway
} from '../runtime/agent-runtime/runtime-mcp-tool-gateway'
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
      projects: [{
      project: projectFixture,
      coordinatorTransferFeedback: null,
      plan: null,
      memberUsers: [],
      workerGroups: [],
      tasks: [],
      offers: [],
      requirementsDraft: null,
      confirmedRequirements: null,
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      memberships: [], legacyHistory: { readOnly: true as const, plans: [], tasks: [], executions: [] },
      deliveryDrive: null
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
  it('persists one fresh Coordinator Session through the real Host entry and replays the same create intent', async ({ onTestFinished }) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-project-coordinator-host-integration-'))
    let disposeLifecycle: (() => Promise<void>) | undefined
    onTestFinished(async () => {
      try {
        await disposeLifecycle?.()
      } finally {
        await rm(userDataDir, { recursive: true, force: true })
      }
    })
    const readState = async () => domainMainPackageSettingsSnapshotSchema.parse(
      JSON.parse(await readFile(
        join(userDataDir, 'domains', 'collaboration', 'coordinator-state.json'),
        'utf8'
      ))
    )
    const connectionSettings = {
      schemaVersion: 2,
      baseUrl: 'https://cloud.host-integration.invalid/'
    }
    const settings = inMemorySettings(connectionSettings)
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
        case 'delivery.drive.list':
          return cloudResponse({ protocolVersion: '1.0', type: 'rest.delivery.drive', requestId: request.payload.requestId,
            drive: { projectId: request.payload.projectId, sharedMaterials: [], taskDeliveries: [], projectResults: [] } })
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
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
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
        }
      }
    )
    const coordinatorCommands: CoordinatorCloudCommandService = Object.freeze({
      localAgentId: () => TEST_IDS.agentId,
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
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
      userDataDir,
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
      ({ id }) => id === 'collaboration.coordinator.runtime-lifecycle'
    )
    if (!hasRuntimeLifecycle(lifecycleContribution?.value)) {
      throw new Error('Project Coordinator runtime lifecycle is missing from its main entry.')
    }
    const lifecycleDisposer = await lifecycleContribution.value.activate(
      lifecycleContext(agentExecution, userDataDir)
    )
    disposeLifecycle = async () => {
      await lifecycleDisposer?.()
      await lifecycleContribution.onDispose?.()
    }

    await vi.waitFor(() => {
      // Only the requirements recovery sweep reads the workspace.
      expect(cloudRequestTypes).toEqual([
        'project.list',
        'worker.availability.list'
      ])
    })

    const mergedDefinitions = capabilityFactory.createDefinitions()
    const broker = new CapabilityBroker(
      new CapabilityRegistry(mergedDefinitions),
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
      title: '联合研究项目 · 项目协调',
      interaction: 'reviewable',
      mode: 'agent'
    })
    expect(run).not.toHaveBeenCalled()
    const createdState = await readState()
    expect(createdState.value).toMatchObject({
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
    expect(await readState()).toEqual(createdState)

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
    expect((await readState()).value).toMatchObject({
      coordinatorSessionBindings: [{
        projectId: TEST_IDS.projectId,
        runtimeId: firstOutput.coordinatorSession.runtimeId,
        threadId: firstOutput.coordinatorSession.threadId
      }],
      pendingProjectActivations: []
    })
    expect((await settings.read()).value).toEqual(connectionSettings)
    expect(settings.write).not.toHaveBeenCalled()
    expect(settings.clear).not.toHaveBeenCalled()
  })

  it('returns a successful global Project create without claiming a Broker resource revision', async () => {
    const createProject = vi.fn(async () => created)
    const definitions = createProjectCoordinatorCapabilityFactory<CapabilityDefinition>({
      defineCapability: ({ audiences, tags, resourceKinds, producedResourceKinds, ...input }) => defineCapability({
        ...input,
        audiences: [...audiences],
        tags: [...tags],
        ...(resourceKinds ? { resourceKinds: [...resourceKinds] } : {}),
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
      defineCapability: ({ audiences, tags, resourceKinds, producedResourceKinds, ...input }) => defineCapability({
        ...input,
        audiences: [...audiences],
        tags: [...tags],
        ...(resourceKinds ? { resourceKinds: [...resourceKinds] } : {}),
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
    expect(visibleTitles).toContain('Complete Project requirements')
    expect(visibleTitles).not.toContain('Continue Project workflow')
    expect(visibleTitles).not.toContain('Decide Delivery adoption')
    expect(visibleTitles).not.toContain('Approve Project completion')
    expect(visibleTitles).not.toContain('Bind Project Session')

    const exact = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {
        capabilityId: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
        includeSchema: true,
        limit: 1
      },
      context: {
        requestId: 'request-project-plan-edit-schema',
        runtimeId: 'runtime-project-discovery',
        threadId: 'thread-project-discovery'
      }
    })
    if (exact.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected exact requirements completion discovery.')
    const inputShape = exact.value[0]?.inputShape as {
      properties?: Record<string, { required?: boolean }>
    } | undefined
    expect(inputShape).toMatchObject({ type: 'object' })
    expect(inputShape?.properties).toEqual(expect.objectContaining({
      projectId: expect.objectContaining({ required: true })
    }))
    for (const capabilityId of [
      'collaboration.plan-draft.read', 'collaboration.plan-draft.generate', 'collaboration.plan-draft.edit',
      'collaboration.plan.submit', 'collaboration.plan.confirm', 'collaboration.workflow.prepare', 'collaboration.workflow.continue'
    ]) {
      await expect(surface.call({ name: CAPABILITY_AGENT_TOOL_NAMES.discover,
        arguments: { capabilityId, includeSchema: true, limit: 1 },
        context: { requestId: 'request-retired-schema', runtimeId: 'runtime-project-discovery', threadId: 'thread-project-discovery' } })).rejects.toMatchObject({ code: 'capability_discovery_empty' })
    }

    const localized = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: '协同中心', limit: 50 },
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
      defineCapability: ({ audiences, tags, resourceKinds, producedResourceKinds, ...input }) => defineCapability({
        ...input,
        audiences: [...audiences],
        tags: [...tags],
        ...(resourceKinds ? { resourceKinds: [...resourceKinds] } : {}),
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
      }),
      assertOrdinarySessionAccess: (caller, session, originalContext) => {
        expect(caller.audience).toBe('agent')
        expect(caller.callerId).toBe('runtime-project-coordinator:thread-project-coordinator')
        expect(session).toEqual({ runtimeId: context.runtimeId, threadId: context.threadId })
        expect(originalContext).toEqual(context)
        expect(originalContext).not.toBe(context)
      }
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
  userDataDir: string
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
    listBindings: async () => []
  })
  const agentCloudRuntime = Object.freeze({
    authorityStatus: async (agentId: string) => ({ state: 'agent_required' as const, agentId }),
    ensureAgent: async () => { throw new Error('Agent provisioning is not part of this integration fixture.') },
    rotateAgent: async () => { throw new Error('Agent rotation is not part of this integration fixture.') },
    revokeAgent: async () => { throw new Error('Agent revocation is not part of this integration fixture.') },
    fenceAgent: async () => undefined,
    execute: async () => { throw new Error('Agent execution is not part of this integration fixture.') },
    pullAgentInbox: async () => ({ messages: [], nextSequence: 0 }),
    observeAgentInbox: async function* () {}
  }) as unknown as AgentCloudRuntime
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
        serviceId === AGENT_CLOUD_RUNTIME_SERVICE_ID &&
        contractVersion === AGENT_CLOUD_RUNTIME_CONTRACT_VERSION
      ) return agentCloudRuntime
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
    getUserDataDir: () => input.userDataDir,
    defineCapability: (input: unknown) => {
      const {
        audiences,
        tags,
        resourceKinds,
        producedResourceKinds,
        ...definition
      } = input as ProjectCoordinatorCapabilityOptions
      return defineCapability({
        ...definition,
        audiences: [...audiences],
        tags: [...tags],
        ...(resourceKinds
          ? { resourceKinds: [...resourceKinds] }
          : {}),
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
  agentExecution: DomainMainAgentExecutionHost,
  userDataDir: string
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
    userDataDir,
    capabilities,
    log: vi.fn()
  } as unknown as DomainMainRuntimeLifecycleContext
}

function inMemorySettings(
  initial: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value']
): DomainMainPackageSettingsHost & Readonly<{
  read: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['read']>>
  write: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['write']>>
  clear: ReturnType<typeof vi.fn<DomainMainPackageSettingsHost['clear']>>
}> {
  let revision = 0
  let value = structuredClone(initial)
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
