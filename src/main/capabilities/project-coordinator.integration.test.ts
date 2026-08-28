import { describe, expect, it, vi } from 'vitest'
import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  type ProjectCoordinatorProjectCreateResult
} from '@sciforge/domain-project-coordinator/contract'
import {
  createProjectCoordinatorCapabilityFactory
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
  }
}

describe('Project Coordinator Host capability integration', () => {
  it('returns a successful global Project create without claiming a Broker resource revision', async () => {
    const createProject = vi.fn(async () => created)
    const completeProjectCreate = vi.fn(async () => undefined)
    const definitions = createProjectCoordinatorCapabilityFactory<CapabilityDefinition>({
      defineCapability: ({ audiences, tags, producedResourceKinds, ...input }) => defineCapability({
        ...input,
        audiences: [...audiences],
        tags: [...tags],
        ...(producedResourceKinds ? { producedResourceKinds: [...producedResourceKinds] } : {})
      }),
      ports: {
        workspace: {
          readWorkspace: async () => created.workspace,
          createProject,
          completeProjectCreate
        }
      } as never,
      sessions: {} as never
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
    expect(completeProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({ createIntentId: created.createIntentId }),
      created
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
      sessions: {} as never
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
  })
})
