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
  type ProjectCoordinatorCapabilityOptions
} from './main.js'
import {
  createProjectContentProvisioningAttestationSigningPort,
  defineProjectCoordinatorWorkspacePort
} from './ports.js'

test('main capability exposes only the strict coordination read model', async () => {
  const factory = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (input) => input,
    ports: {
      workspace: defineProjectCoordinatorWorkspacePort({
        readWorkspace: async () => ({
          connection: { state: 'identity_required' },
          observedAt: '2026-08-24T09:00:00.000Z',
          projects: []
        })
      }),
      provisioningAttestationSigning: {
        signFactualPayload: async () => { throw new Error('unused') }
      },
      coordinatorCloudCommands: coordinatorCloudCommandService()
    }
  })
  const definitions = factory.createDefinitions()
  assert.deepEqual(factory.policy.directTransportPrefixes, [])
  assert.deepEqual(factory.policy.allowedDirectTransports, [])
  assert.deepEqual(definitions.map(({ id }) => id), [
    PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead
  ])
  assert.equal(definitions[0]?.effect, 'read')
  assert.equal(definitions[0]?.approval, 'none')
  assert.deepEqual(await definitions[0]!.handler({}), {
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
  const factory = entry.contributions[0]!.value
  const result = await factory.createDefinitions()[0]!.handler({})
  assert.equal(executeCalls, 0)
  assert.deepEqual(result.output, {
    connection: {
      state: 'coordination_protocol_unavailable',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      reason: 'The versioned Project coordination read model is not available.'
    },
    observedAt: (result.output as { observedAt: string }).observedAt,
    projects: []
  })
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
