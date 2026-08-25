import { createHash } from 'node:crypto'
import type { z } from 'zod'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
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
  projectCoordinatorPlanConfirmActivateInputSchema,
  projectCoordinatorPlanDraftEditInputSchema,
  projectCoordinatorPlanDraftGenerateInputSchema,
  projectCoordinatorPlanDraftReadInputSchema,
  projectCoordinatorPlanDraftSchema,
  projectCoordinatorPlanDraftSubmitInputSchema,
  projectCoordinatorPlanSubmitResultSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import {
  PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_COORDINATOR_DOMAIN_MODULE_ID,
  PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import {
  createProjectCoordinatorCloudWorkspacePort,
  createProjectCoordinatorPlanPort,
  createProjectContentProvisioningAttestationSigningPort,
  type ProjectCoordinatorMainPorts
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

export type ProjectCoordinatorCapabilityOptions = Readonly<{
  id: string
  version: '1.0.0'
  title: string
  description: string
  audiences: readonly ['ui']
  scope: 'global'
  effect: 'read' | 'compute' | 'workspace-write' | 'external-write'
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler(
    input: unknown,
    context: Readonly<{ invocationId?: string }>
  ): Promise<Readonly<{ output: unknown; changed?: boolean }>>
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
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
        version: '1.0.0',
        title: 'Create Project',
        description: 'Creates one Cloud-authoritative Project for the current OIDC Owner and returns exact Desktop focus.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'create', 'owner'],
        inputSchema: projectCoordinatorProjectCreateInputSchema,
        outputSchema: projectCoordinatorProjectCreateResultSchema,
        handler: async (raw, context) => ({
          output: await options.ports.workspace.createProject(
            projectCoordinatorProjectCreateInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate, context)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
        version: '1.0.0',
        title: 'Read local Project Plan draft',
        description: 'Reads the package-owned non-secret draft for one exact Project.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'plan', 'draft'],
        inputSchema: projectCoordinatorPlanDraftReadInputSchema,
        outputSchema: projectCoordinatorPlanDraftSchema.nullable(),
        handler: async (raw) => ({
          output: await options.ports.plan.readDraft(
            projectCoordinatorPlanDraftReadInputSchema.parse(raw)
          )
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
        version: '1.0.0',
        title: 'Generate local Project Plan draft',
        description: 'Runs the configured local Agent Runtime and persists one reviewable non-secret draft.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'runtime'],
        inputSchema: projectCoordinatorPlanDraftGenerateInputSchema,
        outputSchema: projectCoordinatorPlanDraftSchema,
        handler: async (raw) => ({
          output: await options.ports.plan.generateDraft(
            projectCoordinatorPlanDraftGenerateInputSchema.parse(raw)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
        version: '1.0.0',
        title: 'Edit local Project Plan draft',
        description: 'CAS-updates Plan items and exact visible Worker Agent choices.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'worker-selection'],
        inputSchema: projectCoordinatorPlanDraftEditInputSchema,
        outputSchema: projectCoordinatorPlanDraftSchema,
        handler: async (raw) => ({
          output: await options.ports.plan.editDraft(
            projectCoordinatorPlanDraftEditInputSchema.parse(raw)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
        version: '1.0.0',
        title: 'Submit Project Plan',
        description: 'Submits the immutable digest through the current Coordinator Agent durable Cloud command service.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'submit'],
        inputSchema: projectCoordinatorPlanDraftSubmitInputSchema,
        outputSchema: projectCoordinatorPlanSubmitResultSchema,
        handler: async (raw, context) => ({
          output: await options.ports.plan.submitDraft(
            projectCoordinatorPlanDraftSubmitInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit, context)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirmActivate,
        version: '1.0.0',
        title: 'Confirm Plan and activate Project',
        description: 'Confirms the exact immutable Plan as the Coordinator Human and activates from freshly read CAS facts.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'confirmation', 'activation'],
        inputSchema: projectCoordinatorPlanConfirmActivateInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.plan.confirmAndActivate(
            projectCoordinatorPlanConfirmActivateInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirmActivate, context)
          ),
          changed: true
        })
      })
    ]
  })
}

function capabilityIdempotencyKey(
  actionId: string,
  context: Readonly<{ invocationId?: string }>
): string {
  if (!context.invocationId?.trim()) throw new Error('A Host invocation ID is required for this write.')
  const digest = createHash('sha256')
    .update(`${actionId}\u0000${context.invocationId}`, 'utf8')
    .digest('hex')
  return `idem_project-coordinator.${digest.slice(0, 48)}`
}

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<
  ProjectCoordinatorCapabilityFactory<CapabilityDefinition> |
  DomainMainRuntimeLifecycleContribution
> {
  if (!host.internalServices || !host.packageSettings) {
    throw new Error('Project Coordinator requires internal services and owner-scoped settings.')
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
  const state = new ProjectCoordinatorStateStore(host.packageSettings)
  const workspace = createProjectCoordinatorCloudWorkspacePort({
    transport,
    readPlanAssignments: (plan) => state.readPlanAssignments(
      plan.projectPlanId,
      plan.planDigest
    )
  })
  let agentExecution: DomainMainAgentExecutionHost | undefined
  const plan = createProjectCoordinatorPlanPort({
    settings: host.packageSettings,
    state,
    workspace,
    getAgentExecution: () => agentExecution,
    coordinatorCloudCommands,
    transport
  })
  const ports: ProjectCoordinatorMainPorts = Object.freeze({
    workspace,
    plan,
    provisioningAttestationSigning:
      createProjectContentProvisioningAttestationSigningPort(signingService),
    coordinatorCloudCommands
  })
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: (context) => {
      agentExecution = context.agentExecution
      return () => {
        agentExecution = undefined
      }
    }
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createProjectCoordinatorCapabilityFactory({
          defineCapability: host.defineCapability as (
            input: ProjectCoordinatorCapabilityOptions
          ) => CapabilityDefinition,
          ports
        })
      },
      {
        ...PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle
      }
    ]
  }
}

export * from './ports.js'
