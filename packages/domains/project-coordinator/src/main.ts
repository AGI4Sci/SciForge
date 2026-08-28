import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { z } from 'zod'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type {
  DomainMainCapabilityInvocationContext,
  DomainMainHost,
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeLifecycleContribution,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND
} from '@sciforge/domain-content-space/contract'
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
  projectCoordinatorArtifactReviewPrepareInputSchema,
  projectCoordinatorArtifactReviewPreparedSchema,
  projectCoordinatorCompleteInputSchema,
  projectCoordinatorContentRecoveryAbandonInputSchema,
  projectCoordinatorContentRecoveryObserveLinkInputSchema,
  projectCoordinatorContentRecoveryRetrySuccessorInputSchema,
  projectCoordinatorHumanAnswerInputSchema,
  projectCoordinatorHumanNeededCreateInputSchema,
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipAcceptInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorPlanConfirmInputSchema,
  projectCoordinatorPlanDraftEditInputSchema,
  projectCoordinatorPlanDraftGenerateInputSchema,
  projectCoordinatorPlanDraftGenerateResultSchema,
  projectCoordinatorPlanDraftReadInputSchema,
  projectCoordinatorPlanDraftSchema,
  projectCoordinatorPlanDraftSubmitInputSchema,
  projectCoordinatorPlanSubmitResultSchema,
  projectCoordinatorWorkflowContinueInputSchema,
  projectCoordinatorWorkflowPlanSchema,
  projectCoordinatorWorkflowPrepareInputSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorSessionProjectionReadInputSchema,
  projectCoordinatorSessionProjectionSchema,
  projectCoordinatorResultReviewInputSchema,
  projectCoordinatorTransferInputSchema,
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
  ProjectCoordinatorPlanGenerationError,
  type ProjectCoordinatorMainPorts
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'
import { createProjectCoordinatorProvisioningPort } from './provisioning.js'
import { createProjectCoordinatorRecoveryPort } from './recovery.js'
import { createProjectCoordinatorArtifactReviewPort } from './artifact-review.js'
import { createProjectCoordinatorContinuationPort } from './continuation.js'
import {
  createProjectCoordinatorSessionProjectionPort,
  type ProjectCoordinatorSessionProjectionPort
} from './session-projection.js'

export type ProjectCoordinatorCapabilityOptions = Readonly<{
  id: string
  version: '1.0.0' | '2.0.0'
  title: string
  description: string
  audiences: readonly ('ui' | 'agent')[]
  scope: 'global'
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
    context: DomainMainCapabilityInvocationContext
  ): Promise<Readonly<{ output: unknown; changed?: never }>>
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
  sessions: ProjectCoordinatorSessionProjectionPort
}>): ProjectCoordinatorCapabilityFactory<CapabilityDefinition> {
  const agentAudiences = Object.freeze(['ui', 'agent'] as const)
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
        audiences: agentAudiences,
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'coordinator', 'plan', 'worker-selection', 'review', 'provisioning'],
        inputSchema: projectCoordinatorWorkspaceReadInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          let input = projectCoordinatorWorkspaceReadInputSchema.parse(raw) as
            ProjectCoordinatorWorkspaceReadInput
          if (context.caller.audience === 'agent') {
            input = await options.sessions.scopeWorkspaceRead(
              input,
              requireOrdinaryAgentSession(context)
            )
          }
          return { output: await options.ports.workspace.readWorkspace(input) }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectCreate,
        version: '1.0.0',
        title: 'Create Project',
        description: 'Creates one Cloud-authoritative Project for the current OIDC Owner and returns exact Desktop focus.',
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
          const create = async () => projectCoordinatorProjectCreateResultSchema.parse(
            await options.ports.workspace.createProject(input)
          )
          if (context.caller.audience !== 'agent') {
            const result = await create()
            await options.ports.workspace.completeProjectCreate(input, result)
            return { output: result }
          }
          const session = requireOrdinaryAgentSession(context)
          context.assertPrincipalCurrent()
          return options.sessions.withUnboundSession(session, async () => {
            const result = await create()
            context.assertPrincipalCurrent()
            await options.sessions.bindCreatedProject(result, session, input)
            return { output: result }
          })
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.sessionProjectionRead,
        version: '1.0.0',
        title: 'Read local Project Session projection',
        description: 'Reads current-Principal-filtered ordinary Session bindings derived from durable Coordinator receipts and exact Worker execution journals.',
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
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftRead,
        version: '1.0.0',
        title: 'Read local Project Plan draft',
        description: 'Reads the package-owned non-secret draft for one exact Project.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'plan', 'draft'],
        inputSchema: projectCoordinatorPlanDraftReadInputSchema,
        outputSchema: projectCoordinatorPlanDraftSchema.nullable(),
        handler: async (raw, context) => {
          const input = projectCoordinatorPlanDraftReadInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return { output: await options.ports.plan.readDraft(input) }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftGenerate,
        version: '2.0.0',
        title: 'Generate local Project Plan draft',
        description: 'Runs the configured local Agent Runtime and persists one reviewable non-secret draft.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'runtime'],
        inputSchema: projectCoordinatorPlanDraftGenerateInputSchema,
        outputSchema: projectCoordinatorPlanDraftGenerateResultSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorPlanDraftGenerateInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          try {
            return {
              output: {
                status: 'generated' as const,
                draft: await options.ports.plan.generateDraft(input)
              }
            }
          } catch (error) {
            if (!(error instanceof ProjectCoordinatorPlanGenerationError)) throw error
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
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planDraftEdit,
        version: '1.0.0',
        title: 'Edit local Project Plan draft',
        description: 'CAS-updates Plan items and exact visible Worker Agent choices.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'worker-selection'],
        inputSchema: projectCoordinatorPlanDraftEditInputSchema,
        outputSchema: projectCoordinatorPlanDraftSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorPlanDraftEditInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return { output: await options.ports.plan.editDraft(input) }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit,
        version: '1.0.0',
        title: 'Submit Project Plan',
        description: 'Submits the immutable digest through the current Coordinator Agent durable Cloud command service.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'submit'],
        inputSchema: projectCoordinatorPlanDraftSubmitInputSchema,
        outputSchema: projectCoordinatorPlanSubmitResultSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorPlanDraftSubmitInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.plan.submitDraft(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.planSubmit, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm,
        version: '1.0.0',
        title: 'Confirm Project Plan',
        description: 'Confirms the exact immutable Plan; invitations, Team readiness, activation, and dispatch remain gated by the canonical Project workflow.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'plan', 'confirmation'],
        inputSchema: projectCoordinatorPlanConfirmInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorPlanConfirmInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.plan.confirm(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.planConfirm, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.workflowPrepare,
        version: '1.0.0',
        title: 'Prepare Project workflow',
        description: 'Prepares the only production workflow from confirmed Plan and accepted invitations through finite Team operations, readiness, activation, and Task dispatch.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'workflow', 'team', 'readiness', 'plan'],
        inputSchema: projectCoordinatorWorkflowPrepareInputSchema,
        outputSchema: projectCoordinatorWorkflowPlanSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorWorkflowPrepareInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return { output: await options.ports.provisioning.prepareWorkflow(input) }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
        version: '1.0.0',
        title: 'Continue Project workflow',
        description: 'Executes the exact confirmed workflow, including finite Team operations when required, then verifies readiness before activation and initial Task dispatch.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'workflow', 'team', 'attestation', 'activation', 'dispatch'],
        inputSchema: projectCoordinatorWorkflowContinueInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorWorkflowContinueInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.provisioning.continueWorkflow(
              input,
              capabilityIdempotencyKey(
                PROJECT_COORDINATOR_CAPABILITY_IDS.workflowContinue,
                context
              )
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
        version: '1.0.0',
        title: 'Observe and link exact unknown Task output',
        description: 'Re-reads the current recovery tuple, invokes the canonical Content Space exact observation, and links only the Host-derived portable output facts.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'content', 'recovery', 'outcome-unknown', 'observe-link'],
        inputSchema: projectCoordinatorContentRecoveryObserveLinkInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorContentRecoveryObserveLinkInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.recovery.observeAndLink(
              input,
              capabilityIdempotencyKey(
                PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryObserveLink,
                context
              )
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
        version: '1.0.0',
        title: 'Abandon uncertain Task execution',
        description: 'Fences the unresolved execution permanently from freshly read Cloud CAS facts without manufacturing a successful Provider observation.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'content', 'recovery', 'abandon', 'execution-fence'],
        inputSchema: projectCoordinatorContentRecoveryAbandonInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorContentRecoveryAbandonInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.recovery.abandon(
              input,
              capabilityIdempotencyKey(
                PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryAbandon,
                context
              )
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryRetrySuccessor,
        version: '1.0.0',
        title: 'Approve a freshly named recovery successor',
        description: 'Re-reads the completed abandon facts and asks only the current Coordinator Agent to issue a new fenced execution with a new no-overwrite filename.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'content', 'recovery', 'successor', 'execution-fence'],
        inputSchema: projectCoordinatorContentRecoveryRetrySuccessorInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorContentRecoveryRetrySuccessorInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.recovery.retrySuccessor(
              input,
              capabilityIdempotencyKey(
                PROJECT_COORDINATOR_CAPABILITY_IDS.contentRecoveryRetrySuccessor,
                context
              )
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd,
        version: '1.0.0',
        title: 'Invite Project member',
        description: 'Creates only an OIDC User invitation; it grants no Task or Team authority before that exact User accepts the confirmed Plan.',
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
            output: await options.ports.provisioning.addMember(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAdd, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept,
        version: '1.0.0',
        title: 'Accept Project invitation',
        description: 'Lets only the exact invited OIDC User accept the exact current confirmed Plan before Team readiness.',
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
            output: await options.ports.provisioning.acceptInvitation(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipAccept, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove,
        version: '1.0.0',
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
            output: await options.ports.provisioning.removeMember(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.membershipRemove, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.humanNeededCreate,
        version: '1.0.0',
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
        version: '1.0.0',
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
        version: '1.0.0',
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
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.artifactReviewPrepare,
        version: '1.0.0',
        title: 'Prepare Task result artifact review',
        description: 'Re-reads the exact current Cloud submission and binding before returning one Host-scoped non-authorizing Content Space review reference.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project', 'coordinator', 'review', 'content-space', 'artifact'],
        producedResourceKinds: [CONTENT_FILE_RESOURCE_KIND, ARTIFACT_RESOURCE_KIND],
        inputSchema: projectCoordinatorArtifactReviewPrepareInputSchema,
        outputSchema: projectCoordinatorArtifactReviewPreparedSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorArtifactReviewPrepareInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return { output: await options.ports.artifactReview.prepare(input) }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview,
        version: '1.0.0',
        title: 'Review Task result',
        description: 'Accepts one immutable result or requests a fresh fenced revision execution.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'coordinator', 'review'],
        inputSchema: projectCoordinatorResultReviewInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorResultReviewInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.actions.reviewResult(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.resultReview, context)
            )
          }
        }
      }),
      options.defineCapability({
        id: PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete,
        version: '1.0.0',
        title: 'Complete Project with final summary',
        description: 'Submits the Coordinator final summary and atomically completes the Project.',
        audiences: agentAudiences,
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project', 'coordinator', 'summary', 'completion'],
        inputSchema: projectCoordinatorCompleteInputSchema,
        outputSchema: projectCoordinatorWorkspaceSchema,
        handler: async (raw, context) => {
          const input = projectCoordinatorCompleteInputSchema.parse(raw)
          await authorizeAgentProject(options.sessions, context, input.projectId, 'coordinator')
          return {
            output: await options.ports.actions.completeProject(
              input,
              capabilityIdempotencyKey(PROJECT_COORDINATOR_CAPABILITY_IDS.projectComplete, context)
            )
          }
        }
      })
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
  return `idem_project-coordinator.${digest.slice(0, 48)}`
}

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<
  ProjectCoordinatorCapabilityFactory<CapabilityDefinition> |
  DomainMainRuntimeLifecycleContribution
> {
  if (!host.internalServices || !host.packageSettings || !host.portableResources) {
    throw new Error('Project Coordinator requires internal services, owner-scoped settings, and portable resources.')
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
  const workerSessionProjection = host.internalServices.acquire<WorkerSessionProjectionService>(
    WORKER_SESSION_PROJECTION_SERVICE_ID,
    WORKER_SESSION_PROJECTION_CONTRACT_VERSION
  )
  const state = new ProjectCoordinatorStateStore(host.packageSettings)
  const workspace = createProjectCoordinatorCloudWorkspacePort({
    transport,
    coordinatorCloudCommands,
    createIntentState: state,
    readCoordinatorTransferFeedback: (projectId) => (
      state.readCoordinatorTransferFeedback(projectId)
    )
  })
  const sessions = createProjectCoordinatorSessionProjectionPort({
    state,
    workspace,
    workers: workerSessionProjection
  })
  let agentExecution: DomainMainAgentExecutionHost | undefined
  let runtimeLog: DomainMainRuntimeLifecycleContext['log'] | undefined
  const continuation = createProjectCoordinatorContinuationPort({
    workspace,
    coordinatorCloudCommands
  })
  const plan = createProjectCoordinatorPlanPort({
    settings: host.packageSettings,
    state,
    workspace,
    getAgentExecution: () => agentExecution,
    continuation,
    coordinatorCloudCommands,
    transport
  })
  const actions = createProjectCoordinatorActionPort({
    workspace,
    coordinatorCloudCommands,
    transport,
    state,
    continuation,
    onBackgroundContinuationFailure: (projectId, error) => {
      runtimeLog?.({
        level: 'warn',
        message: `Project continuation failed for ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    }
  })
  const artifactReview = createProjectCoordinatorArtifactReviewPort({
    workspace,
    portableResources: host.portableResources
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
    activateAndReconcile: plan.activateAndReconcile,
    getCapabilities: () => {
      if (!systemCapabilities) {
        throw new Error('The approved Content Space provisioning batch is unavailable.')
      }
      return systemCapabilities
    }
  })
  const recovery = createProjectCoordinatorRecoveryPort({
    workspace,
    transport,
    coordinatorCloudCommands,
    getCapabilities: () => {
      if (!systemCapabilities) {
        throw new Error('The Content Space recovery observation capability is unavailable.')
      }
      return systemCapabilities
    },
    workspaceRoot: () => join(
      host.getUserDataDir(),
      'project-coordinator',
      'content-recovery'
    )
  })
  const ports: ProjectCoordinatorMainPorts = Object.freeze({
    workspace,
    plan,
    artifactReview,
    actions,
    provisioningAttestationSigning,
    provisioning,
    recovery,
    coordinatorCloudCommands
  })
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: (context) => {
      agentExecution = context.agentExecution
      systemCapabilities = context.capabilities
      runtimeLog = context.log
      void continuation.reconcileVisibleProjects().catch((error: unknown) => {
        context.log({
          level: 'warn',
          message: `Project continuation activation sweep failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        })
      })
      return () => {
        agentExecution = undefined
        systemCapabilities = undefined
        runtimeLog = undefined
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
          ports,
          sessions
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
export * from './artifact-review.js'
export * from './continuation.js'
