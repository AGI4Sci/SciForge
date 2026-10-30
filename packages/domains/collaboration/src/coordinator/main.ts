import {
  deliveryDriveViewSchema,
  deliveryReadViewSchema,
  deliveryRevisionRecordSchema,
  integrationReceiptSchema,
  projectRequirementsDocumentSchema,
  projectResultSchema
} from '@sciforge/collaboration-contracts'
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
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type {
  DomainMainCapabilityInvocationContext,
  DomainMainHost,
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { DomainCapabilityResourceHandle } from '@sciforge/domain-sdk/renderer-contributions'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { z } from 'zod'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  type CoordinatorCloudCommandService
} from '../coordinator-cloud-command.js'
import {
  WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  WORKER_SESSION_PROJECTION_SERVICE_ID,
  type WorkerSessionProjectionService
} from '../worker-session-projection.js'
import { createDeliveryContentCapabilities } from './delivery-content.js'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorActivationAcknowledgeInputSchema,
  projectCoordinatorActivationAcknowledgeResultSchema,
  projectCoordinatorAdoptionInputSchema,
  projectCoordinatorCompleteInputSchema,
  projectCoordinatorDeliveryReadInputSchema,
  projectCoordinatorDriveListInputSchema,
  projectCoordinatorHumanAnswerInputSchema,
  projectCoordinatorHumanNeededCreateInputSchema,
  projectCoordinatorMembershipAcceptInputSchema,
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorProjectDeleteInputSchema,
  projectCoordinatorProjectDeleteResultSchema,
  projectCoordinatorRequirementsCompleteInputSchema,
  projectCoordinatorRequirementsCompleteResultSchema,
  projectCoordinatorRequirementsConfirmInputSchema,
  projectCoordinatorRequirementsDraftSaveInputSchema,
  projectCoordinatorResultPublishInputSchema,
  projectCoordinatorRevisionRequestInputSchema,
  projectCoordinatorSessionOwnershipReadInputSchema,
  projectCoordinatorSessionOwnershipSchema,
  projectCoordinatorSessionProjectionReadInputSchema,
  projectCoordinatorSessionProjectionSchema,
  projectCoordinatorTaskOfferExtendInputSchema,
  projectCoordinatorTaskOfferReassignInputSchema,
  projectCoordinatorTaskOfferWithdrawInputSchema,
  projectCoordinatorTransferInputSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import {
  domainPackageDefinition,
  PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_COORDINATOR_DOMAIN_MODULE_ID,
  PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRACT,
  PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION
} from './definition.js'
import { createProjectCoordinatorDeliveryPort } from './delivery.js'
import { createProjectCoordinatorMembershipPort } from './membership.js'
import {
  createProjectCoordinatorActionPort,
  createProjectCoordinatorCloudWorkspacePort,
  createProjectCoordinatorRequirementsPort,
  ProjectCoordinatorRequirementsCompletionError,
  type ProjectCoordinatorMainPorts
} from './ports.js'
import { ProjectCreationOrchestrator } from './project-creation-orchestrator.js'
import { createProjectCoordinatorRequirementsDispatchPort } from './requirements-dispatch.js'
import {
  createProjectCoordinatorSessionProjectionPort,
  type ProjectCoordinatorSessionProjectionPort
} from './session-projection.js'
import {
  createProjectCoordinatorStateHost,
  ProjectCoordinatorStateStore
} from './state.js'
import {
  createProjectCoordinatorTaskOfferControlsPort
} from './task-offer-controls.js'
import {
  createProjectCoordinatorTaskOfferReassignmentPort
} from './task-offer-reassignment.js'

export type ProjectCoordinatorCapabilityInvocationContext = DomainMainCapabilityInvocationContext & Readonly<{
  resource?: Readonly<{
    resourceId: string
    resourceKind: string
    semanticRevision: string
  }>
  issueResource?: (registration: Readonly<{
    resourceId: string
    resourceKind: string
    audiences: readonly ['ui']
    semanticRevision: string
    observe(): Promise<Readonly<{ state: DomainPackageJsonValue; semanticRevision: string }>>
    dispose(): void
    contentTransport?: Readonly<{ describeActionId: string; readRangeActionId: string }>
    retireAfterLastHandleExpires: true
  }>) => DomainCapabilityResourceHandle
}>

export type ProjectCoordinatorCapabilityOptions = Readonly<{
  id: string
  version: '1.0.0' | '2.0.0' | '3.0.0'
  title: string
  description: string
  audiences: readonly ('ui' | 'agent')[]
  scope: 'global' | 'resource'
  resourceKinds?: readonly string[]
  effect: 'read' | 'compute' | 'workspace-write' | 'external-write' | 'destructive'
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  producedResourceKinds?: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  /**
   * Coordinator capabilities are global commands. Their effect describes the
   * side effect; Broker `changed` is reserved for an invoked resource handle.
   */
  handler(
    input: unknown,
    context: ProjectCoordinatorCapabilityInvocationContext
  ): Promise<Readonly<{ output: unknown; changed?: never }>>
}>

export type ProjectCoordinatorCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof PROJECT_COORDINATOR_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'collaboration'
    title: 'Collaboration'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions(): readonly CapabilityDefinition[]
}>

export function createProjectCoordinatorCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability(input: ProjectCoordinatorCapabilityOptions): CapabilityDefinition
  ports: ProjectCoordinatorMainPorts
  sessions: ProjectCoordinatorSessionProjectionPort
  projectCreation: ProjectCreationOrchestrator
}>): ProjectCoordinatorCapabilityFactory<CapabilityDefinition> {
  const agentAudiences = Object.freeze(['ui', 'agent'] as const)
  const taskOfferReassignment = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: options.ports.workspace,
    coordinatorCloudCommands: options.ports.coordinatorCloudCommands
  })
  const taskOfferControls = createProjectCoordinatorTaskOfferControlsPort({
    workspace: options.ports.workspace,
    coordinatorCloudCommands: options.ports.coordinatorCloudCommands
  })
  return Object.freeze({
    moduleId: PROJECT_COORDINATOR_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'collaboration' as const,
      title: 'Collaboration' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      ...createDeliveryContentCapabilities({ defineCapability: options.defineCapability, read: (input) => options.ports.delivery.readObject(input) }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.workspaceRead,
        version: '2.0.0',
        title: 'Read Project coordination workspace',
        description: 'Reads the non-secret Project Plan, User-grouped Worker candidates, Tasks, and coordination-center（协同中心）state including formal Deliveries and published Project Results. Pass projectId when targeting one Project; omit it only to read the current scoped workspace.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'coordinator', 'coordination', 'coordination-center', 'overview', 'cloud', 'runtime', 'agent', 'plan', 'task', 'tasks', 'my-tasks', 'worker-selection', 'review', 'reviews', 'decisions', 'files', 'shared-files'],
        inputSchema: projectCoordinatorWorkspaceReadInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          let input = projectCoordinatorWorkspaceReadInputSchema.parse(raw) as
            ProjectCoordinatorWorkspaceReadInput
          if (context.caller.audience === 'agent') {
            context.assertPrincipalCurrent()
            input = await options.sessions.scopeWorkspaceRead(
              input,
              requireOrdinaryAgentSession(context)
            )
            context.assertPrincipalCurrent()
          }
          const output = await options.ports.workspace.readWorkspace(input, { signal: context.signal })
          if (context.caller.audience === 'agent') context.assertPrincipalCurrent()
          return { output }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
        version: '2.0.0',
        title: 'Create Project',
        description: 'Creates one Cloud-authoritative Project and a fresh reviewable Coordinator Session.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'create', 'owner'],
        inputSchema: projectCoordinatorProjectCreateInputSchema,
        outputSchema: projectCoordinatorProjectCreateResultSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorProjectCreateInputSchema.parse(raw)
          const preferredRuntimeId = context.caller.audience === 'agent'
            ? requireOrdinaryAgentSession(context).runtimeId
            : undefined
          return {
            output: await options.projectCreation.create(input, {
              ...(preferredRuntimeId ? { preferredRuntimeId } : {}),
              assertPrincipalCurrent: context.assertPrincipalCurrent
            })
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
        version: '1.0.0',
        title: 'Delete Project',
        description: 'Deletes one Cloud-authoritative Project owned by the current OIDC User and fences its local coordination state.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'delete', 'owner'],
        inputSchema: projectCoordinatorProjectDeleteInputSchema,
        outputSchema: projectCoordinatorProjectDeleteResultSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorProjectDeleteInputSchema.parse(raw)
          context.assertPrincipalCurrent()
          const output = await options.ports.actions.deleteProject(
            input,
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete, context),
            () => authorizeAgentProject(
              options.sessions,
              context,
              input.projectId,
              'coordinator'
            )
          )
          context.assertPrincipalCurrent()
          return { output }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectActivationAcknowledge,
        version: '1.0.0',
        title: 'Acknowledge Project Session activation',
        description: 'Acknowledges local selection and overview opening for an exact created Coordinator Session.',
        audiences: Object.freeze(['ui'] as const),
        scope: 'global',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'session', 'activation', 'acknowledgement'],
        inputSchema: projectCoordinatorActivationAcknowledgeInputSchema,
        outputSchema: projectCoordinatorActivationAcknowledgeResultSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorActivationAcknowledgeInputSchema.parse(raw)
          await options.projectCreation.acknowledgeActivation(
            input.activationRequestId,
            context.assertPrincipalCurrent
          )
          return { output: { acknowledged: true as const } }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.sessionOwnershipRead,
        version: '1.0.0',
        title: 'Read local Project Session ownership',
        description: 'Reads only opaque runtime/thread identities from durable local Project bindings. No Cloud request, Project metadata, or access grant is involved.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'session', 'navigation'],
        inputSchema: projectCoordinatorSessionOwnershipReadInputSchema,
        outputSchema: projectCoordinatorSessionOwnershipSchema,
        handler: async (raw) => {
          projectCoordinatorSessionOwnershipReadInputSchema.parse(raw)
          return { output: await options.sessions.readOwnership() }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
        version: '3.0.0',
        title: 'Read local Project Session projection',
        description: 'Reads current-Principal-filtered ordinary Session bindings derived from durable Coordinator receipts and exact Worker execution journals. This operation takes an empty input object; it is scoped to the calling Session and never accepts projectId.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'session', 'projection', 'principal', 'authority-fence'],
        inputSchema: projectCoordinatorSessionProjectionReadInputSchema,
        outputSchema: projectCoordinatorSessionProjectionSchema,
        handler: async (raw, context) => {
          projectCoordinatorSessionProjectionReadInputSchema.parse(raw)
          context.assertPrincipalCurrent()
          const output = await options.sessions.readProjection(
            context.caller.audience === 'agent'
              ? requireOrdinaryAgentSession(context)
              : undefined
          )
          context.assertPrincipalCurrent()
          return {
            output
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave,
        version: '1.0.0',
        title: 'Save Project requirements draft',
        description: 'The Owner writes all four requirements parts with revision CAS; input references pin exact Drive versions.',
        audiences: Object.freeze(['ui'] as const),
        scope: 'global',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'requirements', 'draft'],
        inputSchema: projectCoordinatorRequirementsDraftSaveInputSchema,
        outputSchema: projectRequirementsDocumentSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorRequirementsDraftSaveInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          const document = await options.ports.requirements.saveDraft(
            input,
            capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsDraftSave, context)
          )
          // Saving returns immediately; the same capability boundary starts the
          // Coordinator completion for the exact saved revision. Failures are
          // persisted as a typed reason by the requirements port.
          void options.ports.requirements.complete({
            projectId: input.projectId,
            expectedRequirementsRevision: document.revision
          }, capabilityIdempotencyKey(
            PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
            context
          )).catch(() => undefined)
          return { output: document }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
        version: '2.0.0',
        title: 'Complete Project requirements',
        description: 'Runs the project-bound local Coordinator Runtime Session to derive 工作模块/验收标准 from the exact current requirements draft and writes the result through the existing Coordinator Agent completion command.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'requirements', 'completion', 'runtime'],
        inputSchema: projectCoordinatorRequirementsCompleteInputSchema,
        outputSchema: projectCoordinatorRequirementsCompleteResultSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorRequirementsCompleteInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          try {
            return {
              output: {
                status: 'completed' as const,
                document: await options.ports.requirements.complete(
                  input,
                  capabilityIdempotencyKey(
                    PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsComplete,
                    context
                  )
                )
              }
            }
          } catch (error) {
            if (!(error instanceof ProjectCoordinatorRequirementsCompletionError)) throw error
            return {
              output: {
                status: 'failed' as const,
                reason: error.reason
              }
            }
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm,
        version: '1.0.0',
        title: 'Confirm Project requirements',
        description: 'The Owner confirms one exact complete requirements version by digest; the confirmation is the only Task dispatch trigger.',
        audiences: Object.freeze(['ui'] as const),
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'requirements', 'confirmation'],
        inputSchema: projectCoordinatorRequirementsConfirmInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorRequirementsConfirmInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.requirements.confirm(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.requirementsConfirm, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
        version: '1.0.0',
        title: 'Withdraw pending Task offer',
        description: 'Closes the exact current pending Task offer and returns the Task to revision requested state.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'task', 'offer', 'withdraw'],
        inputSchema: projectCoordinatorTaskOfferWithdrawInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorTaskOfferWithdrawInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await taskOfferControls.withdraw(
              input,
              capabilityIdempotencyKey(
                PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferWithdraw,
                context
              )
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
        version: '1.0.0',
        title: 'Extend pending Task offer',
        description: 'Extends the acceptance deadline of the exact current pending Task offer.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'task', 'offer', 'deadline'],
        inputSchema: projectCoordinatorTaskOfferExtendInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorTaskOfferExtendInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await taskOfferControls.extend(
              input,
              capabilityIdempotencyKey(
                PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferExtend,
                context
              )
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
        version: '1.0.0',
        title: 'Reassign Task offer',
        description: 'Re-reads the current revision-requested Task and creates one successor User-level offer from package-derived Cloud CAS and file-intent facts.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'task', 'offer', 'reassignment'],
        inputSchema: projectCoordinatorTaskOfferReassignInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const parsedInput = projectCoordinatorTaskOfferReassignInputSchema.parse(raw)
          const input = {
            ...parsedInput,
            nextOutputFileName: parsedInput.nextOutputFileName ?? null
          }
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await taskOfferReassignment.reassign(
              input,
              capabilityIdempotencyKey(
                PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
                context
              )
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
        version: '2.0.0',
        title: 'Invite Project member',
        description: 'Creates an OIDC User invitation; it grants no Task or Team authority before that exact User accepts the current project baseline.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'membership', 'invitation'],
        inputSchema: projectCoordinatorMembershipAddInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorMembershipAddInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.membership.addMember(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
        version: '2.0.0',
        title: 'Accept Project invitation',
        description: 'Lets only the exact invited OIDC User accept the current project baseline before Team readiness.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'membership', 'invitation', 'acceptance'],
        inputSchema: projectCoordinatorMembershipAcceptInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorMembershipAcceptInputSchema.parse(raw)
          if (context.caller.audience === 'agent') {
            context.assertPrincipalCurrent()
            await options.sessions.authorizeInvitationAcceptance(
              input.projectId,
              requireOrdinaryAgentSession(context)
            )
            context.assertPrincipalCurrent()
          }
          return {
            output: await options.ports.membership.acceptInvitation(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
        version: '2.0.0',
        title: 'Fence and remove Project member',
        description: 'Fences Cloud Task Authority first; content-required membership remains removal-pending until Provider absence is observed and signed.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'membership', 'content', 'removal'],
        inputSchema: projectCoordinatorMembershipRemoveInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorMembershipRemoveInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.membership.removeMember(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
        version: '2.0.0',
        title: 'Ask a Project member User',
        description: 'Creates one Project-scoped HumanNeeded for an explicit active member User through the current Coordinator Agent.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'coordinator', 'human-needed'],
        inputSchema: projectCoordinatorHumanNeededCreateInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorHumanNeededCreateInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.actions.createHumanNeeded(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer,
        version: '2.0.0',
        title: 'Answer Project HumanNeeded',
        description: 'Submits the exact target Project member User answer through the OIDC User path.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'human', 'human-answer'],
        inputSchema: projectCoordinatorHumanAnswerInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorHumanAnswerInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'member')
          return {
            output: await options.ports.actions.answerHumanNeeded(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.humanAnswer, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,
        version: '2.0.0',
        title: 'Transfer Project Coordinator',
        description: 'Lets the authenticated Project Owner select another exact ready Agent that they own; main derives all Cloud CAS facts and the old Coordinator is fenced atomically.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'owner', 'coordinator', 'transfer', 'authority-fence'],
        inputSchema: projectCoordinatorTransferInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorTransferInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.actions.transferCoordinator(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer, context)
            )
          }
        }
      }),
      ...[
        { id: PROJECT_COORDINATOR_CAPABILITY_IDS.deliveryRead, title: 'Read sealed Delivery',
          inputSchema: projectCoordinatorDeliveryReadInputSchema, outputSchema: deliveryReadViewSchema,
          run: (raw: unknown) => options.ports.delivery.read(projectCoordinatorDeliveryReadInputSchema.parse(raw)) },
        { id: PROJECT_COORDINATOR_CAPABILITY_IDS.driveList, title: 'Read Project Drive',
          inputSchema: projectCoordinatorDriveListInputSchema, outputSchema: deliveryDriveViewSchema,
          run: (raw: unknown) => options.ports.delivery.listDrive(projectCoordinatorDriveListInputSchema.parse(raw)) }
      ].map((operation) => options.defineCapability({
        id: operation.id, version: '1.0.0', title: operation.title,
        description: 'Reads current member-authorized sealed Delivery and Project Result facts from Cloud.',
        audiences: ['ui'], scope: 'global', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' }, tags: ['project', 'delivery', 'drive'],
        inputSchema: operation.inputSchema, outputSchema: operation.outputSchema,
        handler: async (raw, context) => {
          context.assertPrincipalCurrent()
          const output = await operation.run(raw)
          context.assertPrincipalCurrent()
          return { output }
        }
      })),
      ...[
        { id: PROJECT_COORDINATOR_CAPABILITY_IDS.adoptionDecide, title: 'Decide Delivery adoption',
          inputSchema: projectCoordinatorAdoptionInputSchema, outputSchema: integrationReceiptSchema,
          run: (raw: unknown, key: string) => options.ports.delivery.decideAdoption(projectCoordinatorAdoptionInputSchema.parse(raw), key) },
        { id: PROJECT_COORDINATOR_CAPABILITY_IDS.revisionRequest, title: 'Request Delivery revision',
          inputSchema: projectCoordinatorRevisionRequestInputSchema, outputSchema: deliveryRevisionRecordSchema,
          run: (raw: unknown, key: string) => options.ports.delivery.requestRevision(projectCoordinatorRevisionRequestInputSchema.parse(raw), key) },
        { id: PROJECT_COORDINATOR_CAPABILITY_IDS.resultPublish, title: 'Publish adopted Project Result',
          inputSchema: projectCoordinatorResultPublishInputSchema, outputSchema: projectResultSchema,
          run: (raw: unknown, key: string) => options.ports.delivery.publishResult(projectCoordinatorResultPublishInputSchema.parse(raw), key) },
        { id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete, title: 'Approve Project completion',
          inputSchema: projectCoordinatorCompleteInputSchema, outputSchema: projectCoordinatorWorkspaceSchema,
          run: (raw: unknown, key: string) => options.ports.delivery.completeProject(projectCoordinatorCompleteInputSchema.parse(raw), key) }
      ].map((operation) => options.defineCapability({
        id: operation.id, version: '1.0.0', title: operation.title,
        description: 'Records the human Owner decision for the exact displayed Cloud version.',
        audiences: ['ui'], scope: 'global', effect: 'external-write', approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' }, tags: ['project', 'delivery', 'decision'],
        inputSchema: operation.inputSchema, outputSchema: operation.outputSchema,
        handler: async (raw, context) => {
          if (context.caller.audience !== 'ui') throw new Error('Delivery decisions require the human UI.')
          context.assertPrincipalCurrent()
          return { output: await operation.run(raw, capabilityIdempotencyKey(operation.id, context)) }
        }
      }))
    ]
  })
}

function requireOrdinaryAgentSession(
  context: DomainMainCapabilityInvocationContext
) {
  if (context.caller.audience !== 'agent' || !context.ordinarySession) {
    throw new Error('This Agent operation requires a Host-authenticated ordinary Session.')
  }
  return context.ordinarySession
}

async function authorizeAgentProject(
  sessions: ProjectCoordinatorSessionProjectionPort,
  context: DomainMainCapabilityInvocationContext,
  projectId: string,
  requiredAccess: 'coordinator' | 'member'
): Promise<void> {
  if (context.caller.audience !== 'agent') return
  context.assertPrincipalCurrent()
  await sessions.authorize(
    projectId,
    requireOrdinaryAgentSession(context),
    requiredAccess
  )
  context.assertPrincipalCurrent()
}

function capabilityIdempotencyKey(
  actionId: string,
  context: Readonly<{ invocationId?: string }>
): string {
  if (!context.invocationId?.trim()) throw new Error('A Host invocation ID is required for this write.')
  const digest = createHash('sha256')
    .update(`${actionId}\u0000${context.invocationId}`, 'utf8')
    .digest('hex')
  return `idem_collaboration.${digest.slice(0, 48)}`
}

type CoordinatorRuntime = Readonly<{
  ports: ProjectCoordinatorMainPorts
  sessions: ProjectCoordinatorSessionProjectionPort
  projectCreation: ProjectCreationOrchestrator
  lifecycle: DomainMainRuntimeLifecycleContribution
  dispose(): void
}>

type CoordinatorMainOptions = Readonly<{
  registerConnectionReadySweep?: (sweep: () => Promise<void>) => () => void
}>

function lazyCoordinatorPort<T extends object>(resolve: () => T): T {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'then') return undefined
      return (...args: readonly unknown[]) => {
        const target = resolve()
        const method = Reflect.get(target, property)
        if (typeof method !== 'function') {
          throw new TypeError(`Coordinator dependency ${String(property)} is not callable.`)
        }
        return Reflect.apply(method, target, args)
      }
    }
  }) as T
}

export function createCoordinatorMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost,
  options: CoordinatorMainOptions = {}
): TrustedDomainProcessEntryInput<
  ProjectCoordinatorCapabilityFactory<CapabilityDefinition> |
  DomainMainRuntimeLifecycleContribution
> {
  if (!host.internalServices || !host.packageSettings) {
    throw new Error('Project Coordinator requires internal services and owner-scoped settings.')
  }

  // Collaboration registers these two package-owned services before the
  // deferred Coordinator factory is composed. Identity-owned transport and
  // signing services are acquired only after all domain packages have
  // registered their implementations.
  const coordinatorCloudCommands = host.internalServices.acquire<CoordinatorCloudCommandService>(
    COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
    COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION
  )
  const workerSessionProjection = host.internalServices.acquire<WorkerSessionProjectionService>(
    WORKER_SESSION_PROJECTION_SERVICE_ID,
    WORKER_SESSION_PROJECTION_CONTRACT_VERSION
  )

  let runtime: CoordinatorRuntime | null = null
  let activeDisposer: (() => void) | undefined

  const ensureCoordinator = (): CoordinatorRuntime => {
    if (runtime) return runtime
    const transport = host.internalServices!.acquire<AuthenticatedCloudTransport>(
      AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
      AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION
    )
    const signingService = host.internalServices!.acquire<DeviceFactAttestationSigningService>(
      DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
      DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION
    )
    const state = new ProjectCoordinatorStateStore(
      createProjectCoordinatorStateHost(
        join(host.getUserDataDir(), 'domains', 'collaboration', 'coordinator-state.json'),
        host.packageSettings!
      )
    )
    const workspace = createProjectCoordinatorCloudWorkspacePort({
      transport,
      coordinatorCloudCommands,
      createIntentState: state,
      readCoordinatorTransferFeedback: (projectId) => (
        state.readCoordinatorTransferFeedback(projectId)
      ),
      readRequirementsCompletion: (input) => (
        state.readRequirementsCompletion(input)
      )
    })
    const sessions = createProjectCoordinatorSessionProjectionPort({
      state,
      workspace,
      workers: workerSessionProjection,
      localAgentId: () => coordinatorCloudCommands.localAgentId()
    })
    let agentExecution: DomainMainAgentExecutionHost | undefined
    const projectCreation = new ProjectCreationOrchestrator({
      state,
      workspace,
      getAgentExecution: () => agentExecution,
      currentPrincipalUserId: () => {
        const status = transport.status()
        if (status.state !== 'ready') {
          throw new Error('Project creation requires the current authenticated Principal.')
        }
        return status.userId
      }
    })
    let runtimeLog: DomainMainRuntimeLifecycleContext['log'] | undefined
    const requirements = createProjectCoordinatorRequirementsPort({
      workspace,
      coordinatorCloudCommands,
      transport,
      settings: host.packageSettings!,
      state,
      getAgentExecution: () => agentExecution
    })
    const requirementsDispatch = createProjectCoordinatorRequirementsDispatchPort({
      workspace,
      coordinatorCloudCommands,
      transport
    })
    const actions = createProjectCoordinatorActionPort({
      workspace,
      coordinatorCloudCommands,
      transport,
      state,
      requirementsDispatch,
      log: (entry) => {
        runtimeLog?.(entry)
      }
    })
    const disposeCoordinatorInbox = coordinatorCloudCommands.subscribe((message) => actions.handleInbox(message))
    const membership = createProjectCoordinatorMembershipPort({ workspace, transport })
    const delivery = createProjectCoordinatorDeliveryPort({ workspace, transport, commands: coordinatorCloudCommands,
      signing: signingService,
      humanActions: {
        capture: (input) => {
          if (!host.humanActions) throw new Error('Host human confirmation is unavailable.')
          return host.humanActions.capture(input)
        },
        validate: (input) => {
          if (!host.humanActions) throw new Error('Host human confirmation is unavailable.')
          return host.humanActions.validate(input)
        }
      }
    })
    const ports: ProjectCoordinatorMainPorts = Object.freeze({
      workspace,
      requirements,
      actions,
      membership,
      delivery,
      coordinatorCloudCommands
    })
    const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
      activate: (context) => {
        agentExecution = context.agentExecution
        runtimeLog = context.log
        const runVisibleSweeps = async (): Promise<void> => {
          await Promise.all([
            requirementsDispatch.reconcileVisibleProjects().catch((error: unknown) => {
              context.log({
                level: 'warn',
                message: `Requirements dispatch sweep failed: ${
                  error instanceof Error ? error.message : String(error)
                }`
              })
            })
          ])
        }
        const unregisterConnectionReadySweep = options.registerConnectionReadySweep?.(runVisibleSweeps)
        const disposer = () => {
          unregisterConnectionReadySweep?.()
          agentExecution = undefined
          runtimeLog = undefined
          if (activeDisposer === disposer) activeDisposer = undefined
        }
        activeDisposer = disposer
        void runVisibleSweeps()
        return disposer
      }
    })
    runtime = Object.freeze({
      ports,
      sessions,
      projectCreation,
      lifecycle,
      dispose: () => {
        activeDisposer?.()
        activeDisposer = undefined
        disposeCoordinatorInbox()
      }
    })
    return runtime
  }

  const lazyPorts = Object.freeze({
    workspace: lazyCoordinatorPort(() => ensureCoordinator().ports.workspace),
    requirements: lazyCoordinatorPort(() => ensureCoordinator().ports.requirements),
    actions: lazyCoordinatorPort(() => ensureCoordinator().ports.actions),
    membership: lazyCoordinatorPort(() => ensureCoordinator().ports.membership),
    delivery: lazyCoordinatorPort(() => ensureCoordinator().ports.delivery),
    coordinatorCloudCommands
  }) satisfies ProjectCoordinatorMainPorts
  const lazySessions = lazyCoordinatorPort(
    () => ensureCoordinator().sessions
  ) as ProjectCoordinatorSessionProjectionPort
  const lazyProjectCreation = lazyCoordinatorPort(
    () => ensureCoordinator().projectCreation
  ) as ProjectCreationOrchestrator
  const capabilityFactory = createProjectCoordinatorCapabilityFactory({
    defineCapability: host.defineCapability as (
      input: ProjectCoordinatorCapabilityOptions
    ) => CapabilityDefinition,
    ports: lazyPorts,
    sessions: lazySessions,
    projectCreation: lazyProjectCreation
  })
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: (context) => ensureCoordinator().lifecycle.activate(context)
  })

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PROJECT_COORDINATOR_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRIBUTION,
        contract: PROJECT_COORDINATOR_RUNTIME_LIFECYCLE_CONTRACT,
        value: lifecycle,
        onDispose: () => runtime?.dispose()
      }
    ]
  }
}
