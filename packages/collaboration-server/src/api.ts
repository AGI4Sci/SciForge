import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import {
  createCollaborationError,
  restRequestSchema,
  restResponseSchema,
  type HumanEndpointProviderContract,
  type ProviderLocator,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { ZodError } from 'zod'

import { AuthenticationService, type AgentActor, type AuthContext, type HumanEndpointActor, type UserActor } from './auth.js'
import {
  toAgent,
  toEndpoint,
  toHumanAnswer,
  toHumanNeeded,
  toInboxMessage,
  toManagedContainer,
  toParticipant,
  toProject,
  toProjectEndpointBinding,
  toProjectInput,
  toProjectRecord,
  toProjection,
  toTask,
  toUserPrincipal
} from './contracts.js'
import { stableDigest } from './crypto.js'
import { CollaborationServiceError } from './errors.js'
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
  authentication: AuthenticationService
  readiness: () => Promise<boolean>
  providers?: ProviderDirectory
  resolveProviderActor?: (request: IncomingMessage, command: RestRequest) => Promise<HumanEndpointActor | null>
  basePath?: string
  maxBodyBytes?: number
  now?: () => Date
}

export function createCollaborationHttpServer(options: CollaborationHttpOptions): Server {
  const basePath = normalizeBasePath(options.basePath)
  const maxBodyBytes = Math.max(1_024, Math.min(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, 1024 * 1024))
  const limiter = new AnonymousBootstrapLimiter(options.now)
  return createServer((request, response) => {
    handle(request, response, options, basePath, maxBodyBytes, limiter).catch((error) => sendFailure(response, error))
  })
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: CollaborationHttpOptions,
  basePath: string,
  maxBodyBytes: number,
  limiter: AnonymousBootstrapLimiter
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (request.method === 'GET' && url.pathname === `${basePath}/healthz`) {
    return sendJson(response, 200, { ok: true })
  }
  if (request.method === 'GET' && url.pathname === `${basePath}/readyz`) {
    const ready = await options.readiness().catch(() => false)
    return sendJson(response, ready ? 200 : 503, { ok: ready })
  }
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
  if (isAnonymousBootstrapCommand(command)) {
    limiter.consume(request.socket.remoteAddress ?? 'unknown', command.type)
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

async function resolveActor(
  request: IncomingMessage,
  command: RestRequest,
  options: CollaborationHttpOptions
): Promise<AuthContext | null> {
  if (isAnonymousBootstrapCommand(command)) return null
  if (command.type === 'pairing.verify' || command.type === 'project.input.create' || command.type === 'human.answer') {
    const providerActor = await options.resolveProviderActor?.(request, command)
    if (providerActor) return providerActor
    throw new CollaborationServiceError('permission_denied', 'This command is accepted only from the verified provider gateway.')
  }
  const authorization = firstHeader(request.headers.authorization)
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  return options.authentication.resolveBearer(token)
}

async function dispatch(command: RestRequest, actor: AuthContext | null, options: CollaborationHttpOptions): Promise<RestResponse> {
  const { service } = options
  switch (command.type) {
    case 'pairing.begin': {
      const result = await service.beginPairing(command)
      if (typeof result.challengeCode !== 'string' || typeof result.pollSecret !== 'string') {
        throw new CollaborationServiceError('idempotency_conflict', 'One-time pairing material was already returned; start a new pairing request if it was lost.')
      }
      return response(command, { type: 'pairing.begun', challengeId: result.challengeId,
        challengeCode: result.challengeCode, pollSecret: result.pollSecret, expiresAt: result.expiresAt })
    }
    case 'pairing.verify': {
      throw new CollaborationServiceError('permission_denied',
        'Pairing verification is consumed directly from the authenticated provider event stream.')
    }
    case 'pairing.redeem': {
      const result = await service.redeemPairing(command)
      if (result.type === 'pairing.pending') return response(command, { type: 'pairing.pending',
        challengeId: result.challengeId, retryAfterSeconds: 3 })
      if (typeof result.userCredential !== 'string') {
        throw new CollaborationServiceError('idempotency_conflict', 'The one-time user credential was already returned; restart pairing if it was lost.')
      }
      return response(command, { type: 'pairing.verified', userId: result.userId,
        humanEndpointId: result.humanEndpointId, userCredential: result.userCredential })
    }
    case 'user.create': throw new CollaborationServiceError('permission_denied', 'Users are created only by verified first pairing.')
    case 'user.get': return entityResponse(command, toUserPrincipal(await service.getUser(requiredActor(actor), command.userId)))
    case 'user.update': return entityResponse(command, toUserPrincipal(await service.updateUser(requiredUser(actor), command)))
    case 'endpoint.challenge.create': {
      const user = requiredUser(actor)
      if (user.userId !== command.userId) throw new CollaborationServiceError('permission_denied', 'Cannot create another user endpoint challenge.')
      const result = await service.beginPairing({ provider: command.expectedIdentity.provider,
        realmId: command.expectedIdentity.realmId, requestedDisplayName: (await service.getUser(user, user.userId)).displayName,
        idempotencyKey: command.idempotencyKey, requestedBy: user,
        expectedProviderUserId: command.expectedIdentity.providerUserId })
      if (typeof result.challengeCode !== 'string' || typeof result.pollSecret !== 'string') {
        throw new CollaborationServiceError('idempotency_conflict', 'One-time challenge material was already returned.')
      }
      return response(command, { type: 'pairing.begun', challengeId: result.challengeId,
        challengeCode: result.challengeCode, pollSecret: result.pollSecret, expiresAt: result.expiresAt })
    }
    case 'endpoint.bind': throw new CollaborationServiceError('permission_denied', 'Endpoint binding requires a verified provider event.')
    case 'endpoint.transition': return entityResponse(command, toEndpoint(await service.setEndpointStatus(requiredUser(actor), {
      humanEndpointId: command.humanEndpointId, status: command.status, expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey })))
    case 'endpoint.transfer': return entityResponse(command, toEndpoint(await service.transferEndpoint(requiredUser(actor), command)))
    case 'agent.register': {
      const user = requiredUser(actor)
      if (user.userId !== command.ownerUserId) throw new CollaborationServiceError('permission_denied', 'Cannot register an Agent for another user.')
      const result = await service.registerAgent(user, command)
      if (!result.deviceCredential) throw new CollaborationServiceError('idempotency_conflict', 'The one-time Agent credential was already returned.')
      return response(command, { type: 'agent.registered', agent: toAgent(result.agent), deviceCredential: result.deviceCredential })
    }
    case 'agent.heartbeat': {
      const device = requiredAgent(actor, command.agentId)
      return entityResponse(command, toAgent(await service.heartbeatAgent(device, command)))
    }
    case 'agent.rotate_credential': {
      const result = await service.rotateAgentCredential(requiredUser(actor), { agentId: command.agentId,
        expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey })
      if (!result.deviceCredential) throw new CollaborationServiceError('idempotency_conflict', 'The rotated credential was already returned.')
      return response(command, { type: 'agent.credential_rotated', agent: toAgent(result.agent), deviceCredential: result.deviceCredential })
    }
    case 'agent.revoke': return entityResponse(command, toAgent(await service.revokeAgent(requiredUser(actor), command)))
    case 'agent.owner.transfer': {
      const result = await service.transferAgentOwnership(requiredUser(actor), command)
      if (!result.deviceCredential) throw new CollaborationServiceError('idempotency_conflict', 'The transferred Agent credential was already returned.')
      return response(command, { type: 'agent.owner_transferred', agent: toAgent(result.agent), deviceCredential: result.deviceCredential })
    }
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
    case 'projection.message.publish': {
      const device = requiredAgent(actor)
      await service.publishProjectionMessage(device, command)
      return receiptResponse(command, device)
    }
    case 'project.create': {
      const user = requiredUser(actor)
      if (user.userId !== command.ownerUserId) throw new CollaborationServiceError('permission_denied', 'Cannot create another user Project.')
      const project = await service.createProject(user, { displayName: command.displayName, goal: command.goal,
        memberUserIds: command.memberUserIds, coordinatorAgentId: command.coordinatorAgentId, budgets: command.budget,
        idempotencyKey: command.idempotencyKey })
      const view = await service.getProject(user, project.projectId)
      return entityResponse(command, toProject(project, view.members))
    }
    case 'project.get': {
      const view = await service.getProject(requiredActor(actor), command.projectId)
      return entityResponse(command, toProject(view.project, view.members))
    }
    case 'project.transition': {
      const project = await service.transitionProject(requiredUser(actor), command)
      const view = await service.getProject(requiredActor(actor), project.projectId)
      return entityResponse(command, toProject(project, view.members))
    }
    case 'project.transfer_coordinator': {
      const project = await service.transferCoordinator(requiredUser(actor), command)
      const view = await service.getProject(requiredActor(actor), project.projectId)
      return entityResponse(command, toProject(project, view.members))
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
    case 'task.create': return entityResponse(command, toTask(await service.createTask(requiredAgent(actor), {
      projectId: command.projectId, assigneeAgentId: command.assigneeAgentId, title: command.title,
      objective: command.objective, completionCriteria: command.completionCriteria, dependencyTaskIds: command.dependencyTaskIds,
      expectedProjectRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey })))
    case 'task.get': return entityResponse(command, toTask(await service.getTask(requiredActor(actor), command.taskId)))
    case 'task.transition': {
      const status = command.status === 'running' ? 'in_progress' : command.status === 'succeeded' ? 'completed' : command.status
      if (status === 'offered') throw new CollaborationServiceError('invalid_state_transition', 'Retrying a terminal Task requires explicit Coordinator reassignment.')
      if (status === 'cancelled') return entityResponse(command, toTask(await service.cancelTask(requiredAgent(actor), command)))
      return entityResponse(command, toTask(await service.transitionTask(requiredAgent(actor), {
        taskId: command.taskId, expectedRevision: command.expectedRevision, status,
        resultSummary: command.resultSummary, failureSummary: command.safeFailureCode,
        idempotencyKey: command.idempotencyKey })))
    }
    case 'project_record.submit': return entityResponse(command, toProjectRecord(await service.submitProjectRecord(requiredHumanOrAgent(actor), {
      projectId: command.projectId, kind: command.kind, summary: command.body,
      sourceTaskId: command.sourceTaskId ?? undefined, sourceRevision: command.sourceRevision,
      idempotencyKey: command.idempotencyKey })))
    case 'project_record.accept': return entityResponse(command, toProjectRecord(await service.acceptProjectRecord(requiredHumanOrAgent(actor), command)))
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
      if (actor?.kind !== 'human_endpoint') throw new CollaborationServiceError('permission_denied', 'HumanAnswer requires a verified human endpoint.')
      return entityResponse(command, toHumanAnswer(await service.answerHumanNeeded(actor, command)))
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
  if (actor?.kind !== 'user') throw new CollaborationServiceError('permission_denied', 'A user credential is required.')
  return actor
}
function requiredAgent(actor: AuthContext | null, expectedAgentId?: string): AgentActor {
  if (actor?.kind !== 'agent_device' || (expectedAgentId && actor.agentId !== expectedAgentId)) {
    throw new CollaborationServiceError('permission_denied', 'The matching Agent device credential is required.')
  }
  return actor
}
function requiredHumanOrAgent(actor: AuthContext | null): UserActor | AgentActor {
  if (actor?.kind !== 'user' && actor?.kind !== 'agent_device') {
    throw new CollaborationServiceError('permission_denied', 'A user or Agent credential is required.')
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

type AnonymousBootstrapCommand = Extract<RestRequest, {
  type: 'endpoint.catalog.get' | 'pairing.begin' | 'pairing.redeem'
}>

function isAnonymousBootstrapCommand(command: RestRequest): command is AnonymousBootstrapCommand {
  return command.type === 'endpoint.catalog.get' || command.type === 'pairing.begin' || command.type === 'pairing.redeem'
}

const ANONYMOUS_BOOTSTRAP_LIMITS = {
  'pairing.begin': 10,
  'pairing.redeem': 240,
  'endpoint.catalog.get': 120
} as const

class AnonymousBootstrapLimiter {
  private readonly buckets = new Map<string, { windowStartedAt: number; count: number }>()
  private readonly now: () => Date
  constructor(now: (() => Date) | undefined) { this.now = now ?? (() => new Date()) }
  consume(remoteAddress: string, operation: AnonymousBootstrapCommand['type']): void {
    const current = this.now().getTime()
    const key = `${operation}:${remoteAddress}`
    const bucket = this.buckets.get(key)
    if (!bucket || current - bucket.windowStartedAt >= 10 * 60_000) {
      if (!bucket && this.buckets.size >= 10_000) {
        for (const [candidate, value] of this.buckets) {
          if (current - value.windowStartedAt >= 10 * 60_000) this.buckets.delete(candidate)
        }
        if (this.buckets.size >= 10_000) {
          throw new CollaborationServiceError('rate_limited', 'Too many anonymous bootstrap attempts; retry later.', { retryable: true })
        }
      }
      this.buckets.set(key, { windowStartedAt: current, count: 1 })
      return
    }
    if (bucket.count >= ANONYMOUS_BOOTSTRAP_LIMITS[operation]) {
      throw new CollaborationServiceError('rate_limited', 'Too many anonymous bootstrap attempts; retry later.', { retryable: true })
    }
    bucket.count += 1
  }
}
