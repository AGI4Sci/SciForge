import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  type CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'
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
          projects: []
        }),
        createProject: async () => { throw new Error('unused') }
      },
      plan: {
        readDraft: async () => null,
        generateDraft: async () => { throw new Error('unused') },
        editDraft: async () => { throw new Error('unused') },
        submitDraft: async () => { throw new Error('unused') },
        confirmAndActivate: async () => { throw new Error('unused') }
      },
      provisioningAttestationSigning: {
        signFactualPayload: async () => { throw new Error('unused') }
      },
      coordinatorCloudCommands: coordinatorCloudCommandService()
    }
  })
  const definitions = factory.createDefinitions()
  assert.deepEqual(factory.policy.directTransportPrefixes, [])
  assert.deepEqual(factory.policy.allowedDirectTransports, [])
  assert.equal(definitions[0]?.id, PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead)
  assert.equal(definitions[0]?.effect, 'read')
  assert.equal(definitions[0]?.approval, 'none')
  assert.deepEqual(await definitions[0]!.handler({}, {}), {
    output: {
      connection: { state: 'identity_required' },
      observedAt: '2026-08-24T09:00:00.000Z',
      projects: []
    }
  })
})

test('main entry acquires Identity reads/signing and Collaboration Agent command mediation', async () => {
  let executeCalls = 0
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
  const coordinatorService = coordinatorCloudCommandService()
  const host: DomainMainHost = {
    getUserDataDir: () => '/tmp/sciforge-project-coordinator-test',
    defineCapability: (input) => input,
    openPath: async () => undefined,
    packageSettings: {
      read: async () => ({ revision: 0, value: null }),
      write: async (value) => ({ revision: 1, value }),
      clear: async () => ({ revision: 1, value: null })
    },
    internalServices: {
      register: () => undefined,
      acquire: ((serviceId: string, contractVersion: string) => {
        acquired.push({ serviceId, contractVersion })
        if (serviceId === AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID) return transport
        if (serviceId === DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID) return signingService
        if (serviceId === COORDINATOR_CLOUD_COMMAND_SERVICE_ID) return coordinatorService
        throw new Error(`Unexpected internal service ${serviceId}.`)
      }) as NonNullable<DomainMainHost['internalServices']>['acquire']
    }
  }
  const entry = createDomainMainEntry<ProjectCoordinatorCapabilityOptions>(host)
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
    }
  ])
  const factory = entry.contributions[0]!.value as
    ProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>
  assert.deepEqual(factory.createDefinitions().map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirmActivate
  ])
  assert.equal(executeCalls, 0)
})

function coordinatorCloudCommandService(): CoordinatorCloudCommandService {
  return Object.freeze({
    execute: async () => {
      throw new Error('No write capability invoked this test service.')
    }
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
      projects: []
    }
  }
  // The tracer observes only capability policy and delegation. Cloud parsing,
  // pagination, digest and CAS behavior are covered through the public ports.
  const ports = {
    workspace: {
      readWorkspace: async () => ({
        connection: { state: 'identity_required' as const },
        observedAt: '2026-08-25T01:05:00.000Z',
        projects: []
      }),
      createProject: async () => created
    },
    plan: {
      readDraft: async () => null,
      generateDraft: async () => { throw new Error('unused') },
      editDraft: async () => { throw new Error('unused') },
      submitDraft: async () => { throw new Error('unused') },
      confirmAndActivate: async () => { throw new Error('unused') }
    },
    provisioningAttestationSigning: {
      signFactualPayload: async () => { throw new Error('unused') }
    },
    coordinatorCloudCommands: coordinatorCloudCommandService()
  }
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: ports as never
  })
  const definitions = factory.createDefinitions()

  assert.deepEqual(definitions.map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
    PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirmActivate
  ])
  const create = definitions.find(({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate)!
  assert.equal(create.effect, 'external-write')
  assert.equal(create.approval, 'confirmation')
  assert.equal(create.concurrency.idempotency, 'required')
  const generate = definitions.find(
    ({ id }) => id === PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate
  )!
  assert.equal(generate.effect, 'workspace-write')
  assert.deepEqual(await create.handler({
    displayName: 'Meeting',
    goal: 'Run the meeting.',
    coordinatorAgentId: 'agt_Coordinator01',
    expectedCoordinatorAgentRevision: 1,
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    },
    content: { mode: 'none', members: [{ userId: 'usr_Owner0000001' }] }
  }, { invocationId: 'invocation-project-create-1' } as never), {
    output: created,
    changed: true
  })
})
