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
import { CapabilityBroker } from './broker'
import {
  CapabilityRegistry,
  defineCapability,
  type CapabilityDefinition
} from './registry'

const created: ProjectCoordinatorProjectCreateResult = {
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
          createProject
        }
      } as never
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
        displayName: 'Meeting',
        goal: 'Run the meeting.',
        budget: {
          maxTasks: 4,
          maxTasksPerRound: 4,
          maxTaskRetries: 1,
          maxCoordinationRounds: 2
        },
        content: { mode: 'none', members: [{ userId: 'usr_Owner0000001' }] }
      }
    })).resolves.toMatchObject({
      output: created,
      changed: false,
      replayed: false
    })
    expect(createProject).toHaveBeenCalledTimes(1)
  })
})
