import type { z } from 'zod'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
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

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import {
  PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_COORDINATOR_DOMAIN_MODULE_ID,
  domainPackageDefinition
} from './definition.js'
import {
  createIdentityMediatedProjectCoordinatorWorkspacePort,
  createProjectContentProvisioningAttestationSigningPort,
  type ProjectCoordinatorMainPorts
} from './ports.js'

export type ProjectCoordinatorCapabilityOptions = Readonly<{
  id: string
  version: '1.0.0'
  title: string
  description: string
  audiences: readonly ['ui']
  scope: 'global'
  effect: 'read'
  approval: 'none'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler(input: unknown): Promise<Readonly<{ output: unknown }>>
}>

export type ProjectCoordinatorCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof PROJECT_COORDINATOR_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'project-coordinator'
    title: 'Project Coordinator'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions(): readonly CapabilityDefinition[]
}>

export function createProjectCoordinatorCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability(input: ProjectCoordinatorCapabilityOptions): CapabilityDefinition
  ports: ProjectCoordinatorMainPorts
}>): ProjectCoordinatorCapabilityFactory<CapabilityDefinition> {
  return Object.freeze({
    moduleId: PROJECT_COORDINATOR_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'project-coordinator' as const,
      title: 'Project Coordinator' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
        version: '1.0.0',
        title: 'Read Project coordination workspace',
        description: 'Reads the non-secret Project Plan, User-grouped Worker candidates, Tasks, reviews, and content provisioning state.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'coordinator', 'plan', 'worker-selection', 'review', 'provisioning'],
        inputSchema: projectCoordinatorWorkspaceReadInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw) => ({
          output: await options.ports.workspace.readWorkspace(
            projectCoordinatorWorkspaceReadInputSchema.parse(raw) as ProjectCoordinatorWorkspaceReadInput
          )
        })
      })
    ]
  })
}

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<ProjectCoordinatorCapabilityFactory<CapabilityDefinition>> {
  if (!host.internalServices) {
    throw new Error('Project Coordinator requires Host internal-service mediation.')
  }
  const transport = host.internalServices.acquire<AuthenticatedCloudTransport>(
    AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
    AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION
  )
  const signingService = host.internalServices.acquire<DeviceFactAttestationSigningService>(
    DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
    DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION
  )
  const coordinatorCloudCommands = host.internalServices.acquire<CoordinatorCloudCommandService>(
    COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
    COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION
  )
  const ports: ProjectCoordinatorMainPorts = Object.freeze({
    workspace: createIdentityMediatedProjectCoordinatorWorkspacePort({ transport }),
    provisioningAttestationSigning:
      createProjectContentProvisioningAttestationSigningPort(signingService),
    coordinatorCloudCommands
  })
  return {
    definition: domainPackageDefinition,
    contributions: [{
      ...PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
      value: createProjectCoordinatorCapabilityFactory({
        defineCapability: host.defineCapability as (
          input: ProjectCoordinatorCapabilityOptions
        ) => CapabilityDefinition,
        ports
      })
    }]
  }
}

export * from './ports.js'
