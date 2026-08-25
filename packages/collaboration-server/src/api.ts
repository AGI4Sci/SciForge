import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import {
  createCollaborationError,
  deviceCreateRequestSchema,
  deviceEnrollmentCreateRequestSchema,
  deviceRevokeRequestSchema,
  restRequestSchema,
  restResponseSchema,
  type HumanEndpointProviderContract,
  type ProviderLocator,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { ZodError } from 'zod'

import type { AgentActor, AuthContext, OidcUserActor, UserActor } from './actor.js'
import { requireOidcUserActor } from './auth.js'
import {
  toAgent,
  toEndpoint,
  toHumanAnswer,
  toHumanNeeded,
  toInboxMessage,
  toManagedContainer,
  toParticipant,
  toProject,
  toProjectContentProvisioningIntent,
  toProjectContentProvisioningAttestation,
  toProjectContentReadiness,
  toProjectContentSpaceBinding,
  toProjectMembership,
  toProjectProviderMembershipObservation,
  toTaskAuthority,
  toProjectPlan,
  toProjectWorkerAvailabilityView,
  toProviderDirectoryPrincipalFact,
  toTaskExecution,
  toTaskOffer,
  toTaskResultSubmission,
  toTaskReviewDecision,
  toExternalOperationRecoveryJournalEntry,
  toVisibleRecoveryAction,
  toProjectFinalSummary,
  toWorkerAvailability,
  toCloudResourceRef,
  toProjectEndpointBinding,
  toProjectInput,
  toProjectRecord,
  toProjection,
  toTask,
  toUserPrincipal
} from './contracts.js'
import { stableDigest } from './crypto.js'
import { CollaborationServiceError } from './errors.js'
import type { IdentityService } from './identity-service.js'
import type { CollaborationRequestActorResolver } from './network-boundary.js'
import type { CollaborationService } from './service.js'

export const COLLABORATION_SERVER_ID = 'sciforge.collaboration-server'
export const COLLABORATION_SERVER_VERSION = '0.1.0'
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024

export interface ProviderDirectory {
  contracts(): readonly HumanEndpointProviderContract[]
  listLocators(input: {
    actor: AuthContext
    humanEndpointId: string
    query?: string
    cursor?: string
    limit: number
  }): Promise<{ locators: ProviderLocator[]; nextCursor?: string }>
}

export type CollaborationHttpOptions = {
  service: CollaborationService
  authentication: CollaborationRequestActorResolver
  identities?: IdentityService
  readiness: () => Promise<boolean>
  providers?: ProviderDirectory
  basePath?: string
  maxBodyBytes?: number
}

export function createCollaborationHttpServer(options: CollaborationHttpOptions): Server {
  const basePath = normalizeBasePath(options.basePath)
  const maxBodyBytes = Math.max(1_024, Math.min(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, 1024 * 1024))
  return createServer((request, response) => {
    handle(request, response, options, basePath, maxBodyBytes).catch((error) => sendFailure(response, error))
  })
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: CollaborationHttpOptions,
  basePath: string,
  maxBodyBytes: number
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (request.method === 'GET' && url.pathname === `${basePath}/healthz`) {
    return sendJson(response, 200, { ok: true })
  }
  if (request.method === 'GET' && url.pathname === `${basePath}/readyz`) {
    const ready = await options.readiness().catch(() => false)
    return sendJson(response, ready ? 200 : 503, { ok: ready })
  }
  if (await handleIdentityRoute(request, response, url, options, basePath, maxBodyBytes)) return
  if (request.method !== 'POST' || url.pathname !== `${basePath}/v1/commands`) {
    return sendJson(response, 404, { ok: false })
  }
  requireJson(request)
  const raw = await readJson(request, maxBodyBytes)
  const command = restRequestSchema.parse(raw)
  const headerKey = firstHeader(request.headers['idempotency-key'])
  if ('idempotencyKey' in command && headerKey !== command.idempotencyKey) {
    throw new CollaborationServiceError('validation_failed', 'Idempotency-Key header must match the strict command body.')
  }
  const actor = await resolveActor(request, command, options)
  let body: RestResponse
  try {
    body = await dispatch(command, actor, options)
  } catch (error) {
    if (actor && error instanceof CollaborationServiceError && !error.auditRecorded) {
      await options.service.recordRejectedBoundary(actor, command.type, error).catch(() => undefined)
    }
    throw error
  }
  const validated = restResponseSchema.parse(body)
  sendJson(response, 200, validated)
}

async function handleIdentityRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: CollaborationHttpOptions,
  basePath: string,
  maxBodyBytes: number
): Promise<boolean> {
  const path = url.pathname.slice(basePath.length)
  const isIdentityPath = path === '/v1/me' || path === '/v1/device-enrollments' ||
    path === '/v1/devices' || path === '/v1/me/devices' || /^\/v1\/me\/devices\/[^/]+$/u.test(path)
  if (!isIdentityPath) return false
  if (!options.identities) {
    throw new CollaborationServiceError('resource_offline', 'The A identity service is not configured.', { retryable: true })
  }
  const actor = await resolveOidcUserRequest(request, options.authentication)
  try {
    if (request.method === 'GET' && path === '/v1/me') {
      sendJson(response, 200, await options.identities.me(actor))
      return true
    }
    if (request.method === 'POST' && path === '/v1/device-enrollments') {
      requireJson(request)
      const body = deviceEnrollmentCreateRequestSchema.parse(await readJson(request, maxBodyBytes))
      requireMatchingIdempotencyKey(request, body.idempotencyKey)
      sendJson(response, 200, await options.identities.createDeviceEnrollment(actor, body))
      return true
    }
    if (request.method === 'POST' && path === '/v1/devices') {
      requireJson(request)
      const body = deviceCreateRequestSchema.parse(await readJson(request, maxBodyBytes))
      requireMatchingIdempotencyKey(request, body.idempotencyKey)
      sendJson(response, 200, await options.identities.createDevice(actor, body))
      return true
    }
    if (request.method === 'GET' && path === '/v1/me/devices') {
      sendJson(response, 200, await options.identities.listDevices(actor))
      return true
    }
    const deviceMatch = /^\/v1\/me\/devices\/([^/]+)$/u.exec(path)
    if (request.method === 'DELETE' && deviceMatch) {
      requireJson(request)
      const body = deviceRevokeRequestSchema.parse(await readJson(request, maxBodyBytes))
      if (body.deviceId !== deviceMatch[1]) {
        throw new CollaborationServiceError('validation_failed', 'Device path and body IDs must match.')
      }
      requireMatchingIdempotencyKey(request, body.idempotencyKey)
      sendJson(response, 200, await options.identities.revokeDevice(actor, body.deviceId, body.idempotencyKey))
      return true
    }
    sendJson(response, 405, { ok: false })
    return true
  } catch (error) {
    if (error instanceof CollaborationServiceError && !error.auditRecorded) {
      await options.identities.recordRejectedBoundary(actor, `http.${request.method?.toLowerCase() ?? 'unknown'}${path}`, error)
        .catch(() => undefined)
    }
    throw error
  }
}

async function resolveOidcUserRequest(
  request: IncomingMessage,
  authentication: CollaborationRequestActorResolver
): Promise<OidcUserActor> {
  return requireOidcUserActor(await authentication.resolveRequestActor(request))
}

function requireMatchingIdempotencyKey(request: IncomingMessage, bodyKey: string): void {
  if (firstHeader(request.headers['idempotency-key']) !== bodyKey) {
    throw new CollaborationServiceError('validation_failed', 'Idempotency-Key header must match the strict request body.')
  }
}

async function resolveActor(
  request: IncomingMessage,
  command: RestRequest,
  options: CollaborationHttpOptions
): Promise<AuthContext | null> {
  if (command.type === 'project.input.create') {
    throw new CollaborationServiceError('permission_denied', 'This command is accepted only from the verified provider gateway.')
  }
  return options.authentication.resolveRequestActor(request)
}

async function dispatch(command: RestRequest, actor: AuthContext | null, options: CollaborationHttpOptions): Promise<RestResponse> {
  const { service } = options
  switch (command.type) {
    case 'user.get': return entityResponse(command, toUserPrincipal(await service.getUser(requiredActor(actor), command.userId)))
    case 'user.update': return entityResponse(command, toUserPrincipal(await service.updateUser(requiredUser(actor), command)))
    case 'endpoint.challenge.create': {
      const user = requiredUser(actor)
      const result = await service.createEndpointChallenge(user, { provider: command.expectedIdentity.provider,
        realmId: command.expectedIdentity.realmId, idempotencyKey: command.idempotencyKey,
        expectedProviderUserId: command.expectedIdentity.providerUserId })
      if (typeof result.challengeCode !== 'string') {
        throw new CollaborationServiceError('idempotency_conflict', 'One-time challenge material was already returned.')
      }
      return response(command, { type: 'endpoint.challenge.created', challengeId: result.challengeId,
        challengeCode: result.challengeCode, expiresAt: result.expiresAt })
    }
    case 'endpoint.challenge.get': {
      const result = await service.getEndpointChallenge(requiredUser(actor), command.challengeId)
      return response(command, result)
    }
    case 'endpoint.transition': return entityResponse(command, toEndpoint(await service.setEndpointStatus(requiredUser(actor), {
      humanEndpointId: command.humanEndpointId, status: command.status, expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey })))
    case 'endpoint.transfer': return entityResponse(command, toEndpoint(await service.transferEndpoint(requiredUser(actor), command)))
    case 'agent.register': {
      const user = requiredUser(actor)
      const result = await service.registerAgent(user, command)
      if (!result.sealedCredential) throw new CollaborationServiceError('idempotency_conflict', 'The one-time sealed Agent credential was already returned.')
      return response(command, { type: 'agent.registered', agent: toAgent(result.agent), sealedCredential: result.sealedCredential })
    }
    case 'agent.heartbeat': {
      const device = requiredAgent(actor, command.agentId)
      return entityResponse(command, toAgent(await service.heartbeatAgent(device, command)))
    }
    case 'agent.rotate_credential': {
      const result = await service.rotateAgentCredential(requiredUser(actor), { agentId: command.agentId,
        expectedRevision: command.expectedRevision, credentialBootstrapPublicKey: command.credentialBootstrapPublicKey,
        idempotencyKey: command.idempotencyKey })
      if (!result.sealedCredential) throw new CollaborationServiceError('idempotency_conflict', 'The rotated sealed credential was already returned.')
      return response(command, { type: 'agent.credential_rotated', agent: toAgent(result.agent), sealedCredential: result.sealedCredential })
    }
    case 'agent.revoke': return entityResponse(command, toAgent(await service.revokeAgent(requiredUser(actor), command)))
    case 'participant.get': {
      const snapshot = await service.getParticipantSnapshot(requiredActor(actor), command.userId)
      return response(command, { type: 'participant.snapshot', user: toUserPrincipal(snapshot.user),
        participant: toParticipant(snapshot.participant), humanEndpoints: snapshot.humanEndpoints.map(toEndpoint),
        agents: snapshot.agents.map(toAgent) })
    }
    case 'endpoint.catalog.get': {
      const providers = options.providers?.contracts().filter((contract) => !command.provider || contract.provider === command.provider) ?? []
      return response(command, { type: 'endpoint.catalog', providers })
    }
    case 'endpoint.locator.list': {
      if (!options.providers) throw new CollaborationServiceError('resource_offline', 'No provider directory is running.')
      const page = await options.providers.listLocators({ actor: requiredActor(actor), humanEndpointId: command.humanEndpointId,
        query: command.query, cursor: command.cursor, limit: command.limit })
      return response(command, { type: 'endpoint.locator_page', ...page })
    }
    case 'managed_container.ensure': {
      const user = requiredUser(actor)
      return entityResponse(command, toManagedContainer(await service.ensureManagedContainer(user, command)))
    }
    case 'managed_container.get': {
      return entityResponse(command, toManagedContainer(
        await service.getManagedContainer(requiredActor(actor), command.managedContainerId)
      ))
    }
    case 'managed_container.list': {
      return collectionResponse(command, (await service.listManagedContainers(requiredUser(actor))).map(toManagedContainer))
    }
    case 'managed_container.inspect': {
      return entityResponse(command, toManagedContainer(await service.inspectManagedContainer(requiredUser(actor), command)))
    }
    case 'managed_container.reconcile': {
      return entityResponse(command, toManagedContainer(await service.reconcileManagedContainer(requiredUser(actor), command)))
    }
    case 'managed_container.archive': {
      return entityResponse(command, toManagedContainer(await service.archiveManagedContainer(requiredUser(actor), command)))
    }
    case 'participant.update_primary': return entityResponse(command, toParticipant(await service.selectPrimary(requiredUser(actor), {
      primaryHumanEndpointId: command.primaryHumanEndpointId,
      primaryAgentId: command.primaryAgentId, expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey })))
    case 'projection.create': {
      const user = requiredUser(actor)
      if (user.userId !== command.ownerUserId) throw new CollaborationServiceError('permission_denied', 'Cannot create another user projection.')
      return entityResponse(command, toProjection(await service.createProjection(user, command)))
    }
    case 'projection.get': return entityResponse(command, toProjection(await service.getProjection(requiredActor(actor), command.projectionId)))
    case 'projection.list': return collectionResponse(command,
      (await service.listProjections(requiredActor(actor), command.ownerUserId)).map(toProjection))
    case 'projection.update': return entityResponse(command, toProjection(await service.updateProjection(requiredUser(actor), command)))
    case 'capability.approval.create': {
      const created = await service.createRemoteCapabilityApproval(requiredAgent(actor), command)
      return response(command, { type: 'capability.approval.created', approval: created.approval })
    }
    case 'capability.approval.result': {
      const result = await service.reportRemoteCapabilityApprovalResult(requiredAgent(actor), command)
      return response(command, { type: 'rest.entity', entity: result.entity })
    }
    case 'capability.approval.withdraw': {
      const result = await service.withdrawRemoteCapabilityApproval(requiredAgent(actor), command)
      return response(command, { type: 'rest.entity', entity: result.entity })
    }
    case 'projection.message.publish': {
      const device = requiredAgent(actor)
      await service.publishProjectionMessage(device, command)
      return receiptResponse(command, device)
    }
    case 'provider_directory_principal.publish': return entityResponse(
      command,
      toProviderDirectoryPrincipalFact(await service.publishProviderDirectoryPrincipalFact(requiredUser(actor), command))
    )
    case 'provider_directory_principal.list': {
      const page = await service.listProviderDirectoryPrincipalFacts(requiredUser(actor), command)
      return response(command, { type: 'rest.provider_directory_principal_page',
        items: page.items.map(toProviderDirectoryPrincipalFact),
        ...(page.nextFactId ? { nextFactId: page.nextFactId } : {}) })
    }
    case 'project.list': {
      const page = await service.listProjects(requiredUser(actor), command)
      return response(command, { type: 'rest.project_page',
        ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
        limit: command.limit,
        projects: page.projects.map(toProject),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        observedAt: page.observedAt })
    }
    case 'project.coordination.read': {
      const view = await service.readProjectCoordination(requiredUser(actor), command)
      return response(command, { type: 'rest.project_coordination', project: toProject(view.project),
        observedAt: view.observedAt, pages: view.pages,
        finalSummary: view.finalSummary === null ? null : toProjectFinalSummary(view.finalSummary) })
    }
    case 'project.create': {
      const created = await service.createProject(requiredUser(actor), command)
      return response(command, { type: 'rest.project_created', project: toProject(created.project),
        memberships: created.memberships.map(toProjectMembership),
        provisioningIntent: created.provisioningIntent === null
          ? null
          : toProjectContentProvisioningIntent(created.provisioningIntent) })
    }
    case 'project.get': {
      const view = await service.getProject(requiredActor(actor), command.projectId)
      return entityResponse(command, toProject(view.project))
    }
    case 'project.transition': {
      const project = await service.transitionProject(requiredUser(actor), command)
      return entityResponse(command, toProject(project))
    }
    case 'project.transfer_coordinator': {
      const project = await service.transferCoordinator(requiredUser(actor), command)
      return entityResponse(command, toProject(project))
    }
    case 'worker.availability.publish': return entityResponse(
      command,
      toWorkerAvailability(await service.publishWorkerAvailability(requiredAgent(actor), command))
    )
    case 'worker.availability.list': {
      const page = await service.listWorkerAvailability(requiredActor(actor), command)
      if (command.projectId) {
        return response(command, { type: 'rest.project_worker_availability_page', projectId: command.projectId,
          items: page.projectItems.map((item) => toProjectWorkerAvailabilityView({ projectId: command.projectId!, ...item })),
          ...(page.nextAgentId ? { nextAgentId: page.nextAgentId } : {}) })
      }
      return response(command, { type: 'rest.worker_availability_page',
        items: page.items.map(toWorkerAvailability),
        ...(page.nextAgentId ? { nextAgentId: page.nextAgentId } : {}) })
    }
    case 'project.membership.add': {
      const result = await service.addProjectMembership(requiredUser(actor), command)
      return collectionResponse(command, [toProject(result.project), toProjectMembership(result.membership),
        ...result.taskAuthorities.map(toTaskAuthority),
        ...(result.contentReadiness === null ? [] : [toProjectContentReadiness(result.contentReadiness)]),
        ...(result.provisioningIntent === null ? [] : [toProjectContentProvisioningIntent(result.provisioningIntent)])])
    }
    case 'project.membership.remove': {
      const result = await service.removeProjectMembership(requiredUser(actor), command)
      return collectionResponse(command, [toProject(result.project), toProjectMembership(result.membership),
        ...result.taskAuthorities.map(toTaskAuthority),
        ...(result.provisioningIntent === null ? [] : [toProjectContentProvisioningIntent(result.provisioningIntent)])])
    }
    case 'project.membership.list': return collectionResponse(
      command,
      (await service.listProjectMemberships(requiredActor(actor), command)).map(toProjectMembership)
    )
    case 'project.task_authority.list': return collectionResponse(
      command,
      (await service.listProjectTaskAuthorities(requiredActor(actor), command)).map(toTaskAuthority)
    )
    case 'project.content.provisioning_intent.get': return entityResponse(
      command,
      toProjectContentProvisioningIntent(await service.getProjectContentProvisioningIntent(requiredActor(actor), command))
    )
    case 'project.content.attest': {
      const result = await service.attestProjectContent(requiredUser(actor), command)
      return collectionResponse(command, [toProject(result.project),
        toProjectContentProvisioningAttestation(result.attestation),
        toProjectContentSpaceBinding(result.binding),
        ...result.observations.map(toProjectProviderMembershipObservation),
        ...result.readiness.map(toProjectContentReadiness),
        ...result.memberships.map(toProjectMembership)])
    }
    case 'project.content.observation.submit': {
      const result = await service.submitProjectContentObservation(requiredUser(actor), command)
      return collectionResponse(command, [toProject(result.project),
        toProjectProviderMembershipObservation(result.observation),
        toProjectContentReadiness(result.readiness), toProjectMembership(result.membership),
        toProjectContentSpaceBinding(result.binding)])
    }
    case 'project.content.binding.get': return entityResponse(
      command,
      toProjectContentSpaceBinding(await service.getProjectContentBinding(requiredActor(actor), command))
    )
    case 'project.content.binding.close': {
      const result = await service.closeProjectContentBinding(requiredUser(actor), command)
      return collectionResponse(command, [toProject(result.project), toProjectContentSpaceBinding(result.binding)])
    }
    case 'external_operation.prepare': return entityResponse(
      command,
      toExternalOperationRecoveryJournalEntry(
        await service.prepareExternalOperation(requiredHumanOrAgent(actor), command)
      )
    )
    case 'external_operation.dispatch': return entityResponse(
      command,
      toExternalOperationRecoveryJournalEntry(
        await service.dispatchExternalOperation(requiredHumanOrAgent(actor), command)
      )
    )
    case 'external_operation.observe': {
      const result = await service.observeExternalOperation(requiredHumanOrAgent(actor), command)
      return collectionResponse(command, [toExternalOperationRecoveryJournalEntry(result.journal),
        ...(result.recoveryAction === null ? [] : [toVisibleRecoveryAction(result.recoveryAction)]),
        ...(result.task === null ? [] : [toTask(result.task)]),
        ...(result.execution === null ? [] : [toTaskExecution(result.execution)]),
        ...(result.provisioningIntent === null ? [] : [toProjectContentProvisioningIntent(result.provisioningIntent)])])
    }
    case 'project.plan.submit': return entityResponse(
      command,
      toProjectPlan(await service.submitProjectPlan(requiredAgent(actor), command))
    )
    case 'project.plan.confirm': return entityResponse(
      command,
      toProjectPlan(await service.confirmProjectPlan(requiredUser(actor), command))
    )
    case 'task.offer.create': {
      const result = await service.createTaskOffer(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution), toTaskOffer(result.offer)])
    }
    case 'task.offer.accept': {
      const result = await service.acceptTaskOffer(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution), toTaskOffer(result.offer)])
    }
    case 'task.offer.reject': {
      const result = await service.rejectTaskOffer(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution), toTaskOffer(result.offer)])
    }
    case 'task.offer.withdraw': {
      const result = await service.withdrawTaskOffer(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution), toTaskOffer(result.offer)])
    }
    case 'task.offer.reassign': {
      const result = await service.reassignTaskOffer(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution), toTaskOffer(result.offer)])
    }
    case 'task.execution.start': {
      const result = await service.startTaskExecution(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution)])
    }
    case 'task.execution.fail': {
      const result = await service.failTaskExecution(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution)])
    }
    case 'task.execution.preflight.get': return response(command, {
      type: 'rest.task_execution_preflight',
      preflight: await service.getTaskExecutionPreflight(requiredAgent(actor), command)
    })
    case 'task.result.submit': {
      const result = await service.submitTaskResult(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution),
        toTaskResultSubmission(result.submission)])
    }
    case 'task.result.review': {
      const result = await service.reviewTaskResult(requiredAgent(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution),
        toTaskReviewDecision(result.review), ...(result.offer === null ? [] : [toTaskOffer(result.offer)])])
    }
    case 'task.recovery.link_observed_output': {
      const result = await service.linkObservedRecoveryOutput(requiredUser(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution),
        toExternalOperationRecoveryJournalEntry(result.journal),
        toVisibleRecoveryAction(result.recoveryAction), toCloudResourceRef(result.resource)])
    }
    case 'task.recovery.abandon': {
      const result = await service.abandonTaskRecovery(requiredUser(actor), command)
      return collectionResponse(command, [toTask(result.task), toTaskExecution(result.execution),
        toExternalOperationRecoveryJournalEntry(result.journal),
        toVisibleRecoveryAction(result.recoveryAction)])
    }
    case 'project.decision.submit': {
      const result = await service.submitProjectDecision(requiredAgent(actor), command)
      return collectionResponse(command, [toProject(result.project), toProjectRecord(result.record)])
    }
    case 'project.final_summary.submit': {
      const result = await service.submitProjectFinalSummary(requiredAgent(actor), command)
      return collectionResponse(command, [toProject(result.project), toProjectRecord(result.record),
        toProjectFinalSummary(result.finalSummary)])
    }
    case 'project.input.create': {
      if (actor?.kind !== 'human_endpoint' || actor.userId !== command.senderUserId || actor.humanEndpointId !== command.sourceHumanEndpointId) {
        throw new CollaborationServiceError('permission_denied', 'Project input sender identity does not match the verified provider actor.')
      }
      return entityResponse(command, toProjectInput(await service.acceptProjectInput(actor, {
        projectId: command.projectId, providerMessageId: command.providerMessageId, text: command.text,
        occurredAt: command.occurredAt, idempotencyKey: command.idempotencyKey
      })))
    }
    case 'project.endpoint.bind': return entityResponse(command, toProjectEndpointBinding(await service.bindProjectEndpoint(requiredUser(actor), {
      projectId: command.projectId, locator: command.locator, expectedRevision: null, idempotencyKey: command.idempotencyKey })))
    case 'project.endpoint.update': {
      return entityResponse(command, toProjectEndpointBinding(await service.updateProjectEndpointBinding(requiredUser(actor), command)))
    }
    case 'project.endpoint.get': return entityResponse(command,
      toProjectEndpointBinding(await service.getProjectEndpointBinding(requiredActor(actor), command.projectId)))
    case 'task.get': return entityResponse(command, toTask(await service.getTask(requiredActor(actor), command.taskId)))
    case 'resource.get': return entityResponse(command,
      toCloudResourceRef(await service.getCloudResourceRef(requiredActor(actor), command.resourceRefId)))
    case 'inbox.pull': {
      const page = await service.pullInbox(requiredActor(actor), command)
      return response(command, { type: 'rest.inbox_page', messages: page.messages.map(toInboxMessage),
        nextSequence: page.messages.at(-1)?.sequence ?? command.afterSequence })
    }
    case 'inbox.ack': {
      await service.ackInboxMessage(requiredActor(actor), { inboxMessageId: command.inboxMessageId,
        sequence: command.sequence, idempotencyKey: command.idempotencyKey })
      return response(command, { type: 'rest.receipt', receipt: { schemaVersion: 1, type: 'inbox.receipt',
        receiptId: `rcp_${stableDigest({ actorKey: requiredActor(actor).actorKey,
          idempotencyKey: command.idempotencyKey }).slice(0, 24)}`, inboxMessageId: command.inboxMessageId,
        recipientType: actor?.kind === 'agent_device' ? 'agent' : 'user', sequence: command.sequence,
        acknowledgedAt: new Date().toISOString(), createdAt: new Date().toISOString() } })
    }
    case 'human.answer': {
      return entityResponse(
        command,
        toHumanAnswer(await service.answerHumanNeeded(requiredUser(actor), command))
      )
    }
    case 'human.needed.create': return entityResponse(command, toHumanNeeded(await service.createHumanNeeded(requiredAgent(actor), command)))
    case 'receipt.get': {
      const authenticated = requiredActor(actor)
      const receipt = await service.getReceipt(authenticated, command.receiptId)
      if (!receipt) throw new CollaborationServiceError('not_found', 'Receipt was not found.')
      return response(command, { type: 'rest.receipt', receipt: { schemaVersion: 1, type: 'operation.receipt',
        receiptId: receipt.receiptId, actor: contractActor(authenticated), idempotencyKey: receipt.idempotencyKey,
        requestHash: receipt.requestDigest, status: 'succeeded', resultHash: stableDigest(receipt.response),
        createdAt: receipt.createdAt } })
    }
    default: throw new CollaborationServiceError(
      'resource_offline',
      'The requested canonical service path is not installed in this server build.'
    )
  }
}

function response(command: RestRequest, body: Record<string, unknown>): RestResponse {
  return { protocolVersion: '1.0', requestId: command.requestId, ...body } as RestResponse
}
function entityResponse(command: RestRequest, entity: RestResponse extends never ? never : unknown): RestResponse {
  return response(command, { type: 'rest.entity', entity })
}
function collectionResponse(command: RestRequest, items: unknown[]): RestResponse {
  return response(command, { type: 'rest.collection', items })
}
function receiptResponse(command: Extract<RestRequest, { idempotencyKey: string }>, actor: AuthContext): RestResponse {
  return response(command, { type: 'rest.receipt', receipt: { schemaVersion: 1, type: 'operation.receipt',
    receiptId: `rcp_${stableDigest({ actorKey: actor.actorKey, idempotencyKey: command.idempotencyKey }).slice(0, 24)}`,
    actor: contractActor(actor),
    idempotencyKey: command.idempotencyKey, requestHash: stableDigest(command), status: 'succeeded',
    resultHash: stableDigest({ accepted: true }), createdAt: new Date().toISOString() } })
}

function contractActor(actor: AuthContext): Record<string, unknown> {
  switch (actor.kind) {
    case 'system': throw new CollaborationServiceError('permission_denied', 'System actor cannot own a public receipt.')
    case 'user': return { actorType: 'user', userId: actor.userId, assurance: actor.assurance }
    case 'human_endpoint': return { actorType: 'human_endpoint', userId: actor.userId,
      humanEndpointId: actor.humanEndpointId, assurance: actor.assurance }
    case 'agent_device': return { actorType: 'agent', userId: actor.userId, agentId: actor.agentId, assurance: 'strong' }
  }
}

function requiredActor(actor: AuthContext | null): AuthContext {
  if (!actor) throw new CollaborationServiceError('authentication_required', 'Authentication is required.')
  return actor
}
function requiredUser(actor: AuthContext | null): UserActor {
  if (actor?.kind !== 'user') {
    throw new CollaborationServiceError('permission_denied', 'An OIDC User Principal is required.')
  }
  return actor
}
function requiredAgent(actor: AuthContext | null, expectedAgentId?: string): AgentActor {
  if (actor?.kind !== 'agent_device' || (expectedAgentId && actor.agentId !== expectedAgentId)) {
    throw new CollaborationServiceError('permission_denied', 'The matching Agent machine credential is required.')
  }
  return actor
}
function requiredHumanOrAgent(actor: AuthContext | null): UserActor | AgentActor {
  if (actor?.kind !== 'user' && actor?.kind !== 'agent_device') {
    throw new CollaborationServiceError(
      'permission_denied',
      'An OIDC User Principal or Agent machine credential is required.'
    )
  }
  return actor
}

function requireJson(request: IncomingMessage): void {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new CollaborationServiceError('validation_failed', 'Content-Type must be application/json.')
  }
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.byteLength
    if (length > maxBodyBytes) throw new CollaborationServiceError('payload_too_large', 'Command body is too large.')
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new CollaborationServiceError('validation_failed', 'Command body must be valid JSON.') }
}

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === '/') return ''
  const normalized = `/${value.replace(/^\/+|\/+$/g, '')}`
  if (!/^\/[A-Za-z0-9/_-]*$/.test(normalized)) throw new Error('Invalid collaboration server base path.')
  return normalized
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function sendFailure(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const serviceError = error instanceof CollaborationServiceError
    ? error
    : error instanceof ZodError
      ? new CollaborationServiceError('validation_failed', 'The strict collaboration schema rejected this request or response.')
      : new CollaborationServiceError('internal_error', 'The collaboration server could not complete the request.', { retryable: true })
  const codeMap = {
    validation_failed: 'validation_error', budget_exhausted: 'invalid_state_transition',
    resource_offline: 'provider_unavailable', request_expired: 'expired'
  } as const
  const code = codeMap[serviceError.code as keyof typeof codeMap] ?? serviceError.code
  const errorBody = createCollaborationError(code as Parameters<typeof createCollaborationError>[0], serviceError.message)
  sendJson(response, errorBody.httpStatus, { protocolVersion: '1.0', type: 'rest.error',
    requestId: `req_${randomUUID().replaceAll('-', '').slice(0, 24)}`, error: errorBody })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
  response.end(JSON.stringify(body))
}
