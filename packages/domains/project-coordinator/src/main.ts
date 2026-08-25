import { createHash } from 'node:crypto'
import type { z } from 'zod'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution,
  DomainMainSystemCapabilityInvoker
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
  projectCoordinatorCompleteInputSchema,
  projectCoordinatorHumanAnswerInputSchema,
  projectCoordinatorHumanNeededCreateInputSchema,
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorPlanConfirmActivateInputSchema,
  projectCoordinatorPlanDraftEditInputSchema,
  projectCoordinatorPlanDraftGenerateInputSchema,
  projectCoordinatorPlanDraftReadInputSchema,
  projectCoordinatorPlanDraftSchema,
  projectCoordinatorPlanDraftSubmitInputSchema,
  projectCoordinatorPlanSubmitResultSchema,
  projectCoordinatorProvisioningApplyInputSchema,
  projectCoordinatorProvisioningPlanInputSchema,
  projectCoordinatorProvisioningPlanSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorResultReviewInputSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import {
  PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_COORDINATOR_DOMAIN_MODULE_ID,
  PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION,
  PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRACT,
  domainPackageDefinition
} from './definition.js'
import {
  createProjectCoordinatorCloudWorkspacePort,
  createProjectCoordinatorActionPort,
  createProjectCoordinatorPlanPort,
  createProjectContentProvisioningAttestationSigningPort,
  type ProjectCoordinatorMainPorts
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'
import { createProjectCoordinatorProvisioningPort } from './provisioning.js'

export type ProjectCoordinatorCapabilityOptions = Readonly<{
  id: string
  version: '1.0.0'
  title: string
  description: string
  audiences: readonly ['ui']
  scope: 'global'
  effect: 'read' | 'compute' | 'workspace-write' | 'external-write' | 'destructive'
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
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.contentProvisioningPlan,
        version: '1.0.0',
        title: 'Preview Project Content provisioning',
        description: 'Reads the exact Cloud intent and returns the Host-canonical complete ordinary Content Space operation plan for Human review.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'content', 'provisioning', 'plan'],
        inputSchema: projectCoordinatorProvisioningPlanInputSchema,
        outputSchema: projectCoordinatorProvisioningPlanSchema,
        handler: async (raw) => ({
          output: await options.ports.provisioning.preview(
            projectCoordinatorProvisioningPlanInputSchema.parse(raw)
          )
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.contentProvisioningApply,
        version: '1.0.0',
        title: 'Apply Project Content provisioning',
        description: 'Executes only the exact Human-confirmed full plan, journals ordinary Provider operations, signs factual observations with the current Device, and submits them to Cloud.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'content', 'provisioning', 'attestation'],
        inputSchema: projectCoordinatorProvisioningApplyInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.provisioning.apply(
            projectCoordinatorProvisioningApplyInputSchema.parse(raw),
            capabilityIdempotencyKey(
              PROJECT_COORDINATOR_CAPABILITY_IDS.contentProvisioningApply,
              context
            )
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
        version: '1.0.0',
        title: 'Add Project member pending Content provisioning',
        description: 'Adds the exact User and Provider fact to Cloud; content-required membership remains pending until a fresh signed Provider observation succeeds.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'membership', 'content', 'pending'],
        inputSchema: projectCoordinatorMembershipAddInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.provisioning.addMember(
            projectCoordinatorMembershipAddInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd, context)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
        version: '1.0.0',
        title: 'Fence and remove Project member',
        description: 'Fences Cloud Task Authority first; content-required membership remains removal-pending until Provider absence is observed and signed.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'membership', 'content', 'removal'],
        inputSchema: projectCoordinatorMembershipRemoveInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.provisioning.removeMember(
            projectCoordinatorMembershipRemoveInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove, context)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
        version: '1.0.0',
        title: 'Ask the Project Owner',
        description: 'Creates one Project-scoped HumanNeeded through the current Coordinator Agent.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'coordinator', 'human-needed'],
        inputSchema: projectCoordinatorHumanNeededCreateInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.actions.createHumanNeeded(
            projectCoordinatorHumanNeededCreateInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate, context)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
        version: '1.0.0',
        title: 'Answer Project HumanNeeded',
        description: 'Submits the current Project Owner answer through the OIDC User path.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'owner', 'human-answer'],
        inputSchema: projectCoordinatorHumanAnswerInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.actions.answerHumanNeeded(
            projectCoordinatorHumanAnswerInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer, context)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview,
        version: '1.0.0',
        title: 'Review Task result',
        description: 'Accepts one immutable result or requests a fresh fenced revision execution.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'coordinator', 'review'],
        inputSchema: projectCoordinatorResultReviewInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.actions.reviewResult(
            projectCoordinatorResultReviewInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview, context)
          ),
          changed: true
        })
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete,
        version: '1.0.0',
        title: 'Complete Project with final summary',
        description: 'Submits the Coordinator final summary and atomically completes the Project.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'coordinator', 'summary', 'completion'],
        inputSchema: projectCoordinatorCompleteInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => ({
          output: await options.ports.actions.completeProject(
            projectCoordinatorCompleteInputSchema.parse(raw),
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete, context)
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
  const actions = createProjectCoordinatorActionPort({
    workspace,
    coordinatorCloudCommands,
    transport
  })
  const disposeCoordinatorInbox = coordinatorCloudCommands.subscribe((message) => (
    actions.handleInbox(message)
  ))
  const provisioningAttestationSigning =
    createProjectContentProvisioningAttestationSigningPort(signingService)
  let systemCapabilities: DomainMainSystemCapabilityInvoker | undefined
  const provisioning = createProjectCoordinatorProvisioningPort({
    workspace,
    transport,
    signing: provisioningAttestationSigning,
    getCapabilities: () => {
      if (!systemCapabilities) {
        throw new Error('The approved Content Space provisioning batch is unavailable.')
      }
      return systemCapabilities
    }
  })
  const ports: ProjectCoordinatorMainPorts = Object.freeze({
    workspace,
    plan,
    actions,
    provisioningAttestationSigning,
    provisioning,
    coordinatorCloudCommands
  })
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: (context) => {
      agentExecution = context.agentExecution
      systemCapabilities = context.capabilities
      return () => {
        agentExecution = undefined
        systemCapabilities = undefined
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
        contract: PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRACT,
        value: lifecycle,
        onDispose: disposeCoordinatorInbox
      }
    ]
  }
}

export * from './ports.js'
