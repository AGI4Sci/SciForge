import { createHash } from 'node:crypto'

import { CollaborationServiceError } from '../../packages/collaboration-server/src/errors.ts'

function copy(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function credentialDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function authenticationFailure(code, message) {
  throw new CollaborationServiceError(code, message)
}

/**
 * Test-only implementation of the public request-actor resolver contract.
 * It returns bounded actor facts while keeping fixture bearer values inside this
 * network-boundary adapter. Production authentication remains server-owned.
 */
export class FakeCollaborationRequestActorResolver {
  constructor({ repository, now = () => new Date(), oidcActors = new Map() }) {
    this.repository = repository
    this.now = now
    this.oidcActors = new Map(oidcActors)
  }

  registerOidcActor(token, actor) {
    this.oidcActors.set(token, copy(actor))
  }

  async resolveRequestActor(request) {
    const header = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization
    const token = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined
    if (!token || token.length < 16 || token.length > 16 * 1024 || /\s/u.test(token)) {
      return authenticationFailure('authentication_required', 'A valid bearer credential is required.')
    }
    const oidcActor = this.oidcActors.get(token)
    if (oidcActor) {
      const [user, identity] = await Promise.all([
        this.repository.getUser(oidcActor.userId),
        this.repository.getOidcIdentity(oidcActor.identityId)
      ])
      if (!user || user.status !== 'active' || !identity || identity.status !== 'active' ||
          identity.userId !== user.userId) {
        return authenticationFailure('credential_revoked', 'The OIDC fixture principal is not active.')
      }
      return copy(oidcActor)
    }
    if (token.length > 512) {
      return authenticationFailure('authentication_required', 'The bearer credential is not recognized.')
    }
    const credential = await this.repository.getCredentialByDigest(credentialDigest(token))
    if (!credential) {
      return authenticationFailure('authentication_required', 'The bearer credential is not recognized.')
    }
    if (credential.revokedAt || (credential.expiresAt && credential.expiresAt <= this.now().toISOString())) {
      return authenticationFailure('credential_revoked', 'The Agent credential has expired or was revoked.')
    }
    const agentId = credential.subjectAgentId
    const [user, agent] = await Promise.all([
      this.repository.getUser(credential.subjectUserId),
      agentId ? this.repository.getAgent(agentId) : Promise.resolve(null)
    ])
    if (!user || user.status !== 'active' || !agent || agent.status !== 'active' ||
        agent.ownerUserId !== user.userId || agent.credentialGeneration !== credential.generation) {
      return authenticationFailure('credential_revoked', 'The Agent machine identity is not active.')
    }
    const device = await this.repository.getDevice(agent.deviceId)
    if (!device || device.status !== 'active' || device.userId !== user.userId) {
      return authenticationFailure('credential_revoked', 'The Agent Device is not active.')
    }
    return {
      kind: 'agent_device',
      actorKey: `agent:${agent.agentId}:credential:${credential.credentialId}`,
      userId: user.userId,
      agentId: agent.agentId,
      deviceId: device.deviceId,
      credentialId: credential.credentialId,
      credentialGeneration: credential.generation,
      assurance: 'device'
    }
  }
}

export function fakeAgentActor(agent) {
  return {
    kind: 'agent_device',
    actorKey: `agent:${agent.agentId}:fixture:generation:${agent.credentialGeneration}`,
    userId: agent.ownerUserId,
    agentId: agent.agentId,
    deviceId: agent.deviceId,
    credentialId: `fixture-${agent.agentId}`,
    credentialGeneration: agent.credentialGeneration,
    assurance: 'device'
  }
}

export function fakeHumanEndpointActor(endpoint) {
  if (!endpoint || endpoint.status !== 'active' || endpoint.assurance === 'basic') {
    return authenticationFailure('authentication_required', 'The provider endpoint is not actively verified.')
  }
  return {
    kind: 'human_endpoint',
    actorKey: `endpoint:${endpoint.humanEndpointId}:revision:${endpoint.revision}`,
    userId: endpoint.userId,
    humanEndpointId: endpoint.humanEndpointId,
    assurance: endpoint.assurance
  }
}

function recipientKey(recipient) {
  return `${recipient.kind}:${recipient.id}`
}

const sensitiveAuditKey = /(?:authorization|credential|secret|token|password|private.?key|challenge)/i
function safeAuditMetadata(input) {
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    if (sensitiveAuditKey.test(key)) return []
    if (typeof value === 'string') return [[key, value.slice(0, 500)]]
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [[key, value]]
    return []
  }))
}

function revisionUpdate(map, id, value, expectedRevision) {
  const current = map.get(id)
  if (!current || current.revision !== expectedRevision || value.revision !== expectedRevision + 1) {
    throw new Error('fake repository revision conflict')
  }
  map.set(id, copy(value))
}

function assertImmutableFields(current, next, fields, resource) {
  for (const field of fields) {
    if (JSON.stringify(current?.[field]) !== JSON.stringify(next[field])) {
      throw new Error(`fake repository immutable ${resource} field changed: ${field}`)
    }
  }
}

export class FakeClock {
  constructor(start = '2026-08-15T00:00:00.000Z') {
    this.value = new Date(start)
  }

  now = () => new Date(this.value)

  tick(milliseconds = 1) {
    this.value = new Date(this.value.getTime() + milliseconds)
  }
}

export class FakeInboxNotifier {
  constructor() {
    this.notifications = []
  }

  notifyInboxAvailable(recipient, latestSequence) {
    this.notifications.push(copy({ recipient, latestSequence }))
  }
}

export class FakeHumanProvider {
  constructor({ provider = 'fake-im', realmId = 'fake-realm' } = {}) {
    this.provider = provider
    this.realmId = realmId
    this.online = true
    this.outbound = []
    this.listeners = new Set()
  }

  onEvent(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async emit(event) {
    for (const listener of this.listeners) await listener(copy(event))
  }

  async send(message) {
    if (!this.online) {
      const error = new Error('fake provider offline')
      error.code = 'resource_offline'
      throw error
    }
    this.outbound.push(copy(message))
    return { remoteMessageId: `fake-outbound-${this.outbound.length}` }
  }

  setOnline(online) {
    this.online = online
  }
}

export class FakeAgentRuntime {
  constructor() {
    this.online = true
    this.started = []
    this.completed = []
  }

  async submitTurn(turn) {
    if (!this.online) {
      const error = new Error('fake runtime offline')
      error.code = 'resource_offline'
      throw error
    }
    this.started.push(copy(turn))
    return { localTurnId: `fake-turn-${this.started.length}` }
  }

  complete(turn) {
    this.completed.push(copy(turn))
  }

  setOnline(online) {
    this.online = online
  }
}

export class FakeAgentExecutionHost {
  constructor() {
    this.requests = []
    this.pending = []
  }

  run = (request) => {
    this.requests.push(copy(request))
    const index = this.requests.length
    return new Promise((resolve, reject) => {
      this.pending.push({ request: copy(request), index, resolve, reject })
    })
  }

  completeNext({ text = 'fake final reply', state = 'completed', runtimeId, threadId } = {}) {
    const pending = this.pending.shift()
    if (!pending) throw new Error('fake execution host has no pending turn')
    pending.resolve({
      runtimeId: runtimeId ?? pending.request.runtimeId ?? 'fake-runtime',
      threadId: threadId ?? pending.request.threadId ?? 'fake-created-thread',
      turnId: `fake-turn-${pending.index}`,
      state,
      text
    })
  }

  failNext(error = new Error('fake execution failure')) {
    const pending = this.pending.shift()
    if (!pending) throw new Error('fake execution host has no pending turn')
    pending.reject(error)
  }
}

export class FakeProjectionOutbox {
  constructor() {
    this.deliveries = []
    this.failure = null
  }

  async enqueueProjectionDelivery(command, idempotencyKey) {
    if (this.failure) throw this.failure
    this.deliveries.push(copy({ command, idempotencyKey }))
  }
}

export class FakeServiceProjectionOutbox {
  constructor({ service, actor }) {
    this.service = service
    this.actor = actor
    this.deliveries = []
  }

  async enqueueProjectionDelivery(command, idempotencyKey) {
    this.deliveries.push(copy({ command, idempotencyKey }))
    return this.service.publishProjectionMessage(this.actor, { ...copy(command), idempotencyKey })
  }
}

export class FakeHumanEndpointDeliveryWorker {
  constructor({ service, actor, provider, afterSequence = 0 }) {
    this.service = service
    this.actor = actor
    this.provider = provider
    this.afterSequence = afterSequence
    this.deliveries = []
  }

  async drain() {
    const page = await this.service.pullInbox(this.actor, {
      afterSequence: this.afterSequence,
      limit: 100
    })
    for (const message of page.messages) {
      const receipt = await this.provider.send(message.payload)
      this.deliveries.push(copy({ message, receipt }))
      this.afterSequence = message.sequence
      await this.service.ackInbox(this.actor, {
        throughSequence: message.sequence,
        idempotencyKey: `fake-endpoint-ack-${message.messageId}`
      })
    }
    return copy(this.deliveries)
  }
}

export class FakeAgentThreadsHost {
  constructor() {
    this.threads = new Map()
  }

  setTurn({ runtimeId, threadId, turnId, messages }) {
    const key = `${runtimeId}:${threadId}`
    const thread = this.threads.get(key) ?? {
      id: threadId,
      runtimeId,
      watermark: '0',
      turns: [],
      artifacts: []
    }
    const existing = thread.turns.findIndex((turn) => turn.id === turnId)
    const turn = { id: turnId, status: 'completed', messages: copy(messages), artifacts: [] }
    if (existing >= 0) thread.turns[existing] = turn
    else thread.turns.push(turn)
    thread.watermark = String(Number(thread.watermark) + 1)
    this.threads.set(key, thread)
  }

  async list() {
    return copy([...this.threads.values()].map(({ turns: _turns, artifacts: _artifacts, watermark: _watermark, ...thread }) => thread))
  }

  async read({ runtimeId, threadId }) {
    const thread = this.threads.get(`${runtimeId}:${threadId}`)
    if (!thread) throw new Error('fake canonical thread was not found')
    return copy(thread)
  }

  async *subscribeMessages() {}

  hasActiveTurns() {
    return false
  }
}

export class FakeCollaborationStateBackend {
  constructor(initial) {
    this.value = copy(initial)
    this.writes = []
  }

  async read() {
    return copy(this.value)
  }

  async write(value) {
    this.value = copy(value)
    this.writes.push(copy(value))
  }
}

export class FakeCapabilityHost {
  constructor() {
    this.requests = []
  }

  async request(input) {
    const request = {
      requestId: `fake-capability-${this.requests.length + 1}`,
      status: 'pending',
      ...copy(input)
    }
    this.requests.push(request)
    return copy(request)
  }
}

export class FakeCollaborationRepository {
  constructor() {
    this.state = this.#emptyState()
    this.closed = false
  }

  #emptyState() {
    return {
      users: new Map(),
      oidcIdentities: new Map(),
      deviceEnrollments: new Map(),
      devices: new Map(),
      challenges: new Map(),
      endpointChallengeRateWindows: new Map(),
      endpoints: new Map(),
      agents: new Map(),
      participants: new Map(),
      projections: new Map(),
      managedContainers: new Map(),
      managedContainerJobs: new Map(),
      projectEndpointBindings: new Map(),
      projectInputs: new Map(),
      humanRequests: new Map(),
      humanAnswers: new Map(),
      remoteApprovals: new Map(),
      projects: new Map(),
      projectMembers: new Map(),
      workerAvailability: new Map(),
      providerDirectoryPrincipalFacts: new Map(),
      projectProviderMembershipObservations: new Map(),
      projectContentReadiness: new Map(),
      taskAuthorities: new Map(),
      projectContentProvisioningIntents: new Map(),
      projectContentProvisioningAttestations: new Map(),
      projectContentBindings: new Map(),
      externalOperationJournal: new Map(),
      visibleRecoveryActions: new Map(),
      cloudResourceRefs: new Map(),
      tasks: new Map(),
      taskExecutions: new Map(),
      taskOffers: new Map(),
      projectPlans: new Map(),
      taskResultSubmissions: new Map(),
      taskResultReviews: new Map(),
      projectFinalSummaries: new Map(),
      projectRecords: new Map(),
      credentials: new Map(),
      receipts: new Map(),
      inboxes: new Map(),
      inboxCursors: new Map(),
      auditEvents: []
    }
  }

  #assertOpen() {
    if (this.closed) throw new Error('fake repository is closed')
  }

  async transaction(work) {
    this.#assertOpen()
    const snapshot = copy(this.state)
    try {
      return await work(this)
    } catch (error) {
      this.state = snapshot
      throw error
    }
  }

  async lockIdempotency() {}
  async lockOidcIdentity() {}

  async getUser(userId) {
    return copy(this.state.users.get(userId) ?? null)
  }

  async getUserForUpdate(userId) {
    return this.getUser(userId)
  }

  async getOidcIdentity(identityId) {
    return copy(this.state.oidcIdentities.get(identityId) ?? null)
  }

  async getOidcIdentityByIssuerSubject(issuer, subject) {
    return copy([...this.state.oidcIdentities.values()].find((value) => (
      value.issuer === issuer && value.subject === subject
    )) ?? null)
  }

  async getOidcIdentityByIssuerSubjectForUpdate(issuer, subject) {
    return this.getOidcIdentityByIssuerSubject(issuer, subject)
  }

  async insertOidcIdentity(identity) {
    if (this.state.oidcIdentities.has(identity.identityId)) throw new Error('fake repository duplicate OIDC identity')
    this.state.oidcIdentities.set(identity.identityId, copy(identity))
  }

  async getDeviceEnrollment(enrollmentId) {
    return copy(this.state.deviceEnrollments.get(enrollmentId) ?? null)
  }

  async getDeviceEnrollmentForUpdate(enrollmentId) {
    return this.getDeviceEnrollment(enrollmentId)
  }

  async insertDeviceEnrollment(enrollment) {
    if (this.state.deviceEnrollments.has(enrollment.enrollmentId)) throw new Error('fake repository duplicate Device enrollment')
    this.state.deviceEnrollments.set(enrollment.enrollmentId, copy(enrollment))
  }

  async consumeDeviceEnrollment(enrollmentId, consumedAt, expectedRevision) {
    const enrollment = this.state.deviceEnrollments.get(enrollmentId)
    if (!enrollment || enrollment.status !== 'pending' || enrollment.revision !== expectedRevision ||
        enrollment.expiresAt <= consumedAt) return false
    this.state.deviceEnrollments.set(enrollmentId, {
      ...enrollment, status: 'consumed', consumedAt, revision: expectedRevision + 1, updatedAt: consumedAt
    })
    return true
  }

  async getDevice(deviceId) {
    return copy(this.state.devices.get(deviceId) ?? null)
  }

  async getDeviceForUpdate(deviceId) {
    return this.getDevice(deviceId)
  }

  async getAgentForUpdate(agentId) {
    return this.getAgent(agentId)
  }

  async listAgentsForDeviceForUpdate(deviceId) {
    return this.listAgentsForDevice(deviceId)
  }

  async getWorkerAvailabilityForUpdate(agentId) {
    return this.getWorkerAvailability(agentId)
  }

  async listWorkerAvailabilityForDeviceForUpdate(deviceId) {
    return copy([...this.state.workerAvailability.values()].filter((item) => item.deviceId === deviceId))
  }

  async getDeviceByInstallation(installationId) {
    return copy([...this.state.devices.values()].find((value) => value.installationId === installationId) ?? null)
  }

  async listDevicesForUser(userId) {
    return copy([...this.state.devices.values()].filter((value) => value.userId === userId))
  }

  async insertDevice(device) {
    if (this.state.devices.has(device.deviceId)) throw new Error('fake repository duplicate Device')
    this.state.devices.set(device.deviceId, copy(device))
  }

  async updateDevice(device, expectedRevision) {
    revisionUpdate(this.state.devices, device.deviceId, device, expectedRevision)
  }

  async insertUser(user) {
    if (this.state.users.has(user.userId)) throw new Error('fake repository duplicate user')
    this.state.users.set(user.userId, copy(user))
  }

  async updateUser(user, expectedRevision) {
    revisionUpdate(this.state.users, user.userId, user, expectedRevision)
  }

  async insertChallenge(challenge) {
    if (this.state.challenges.has(challenge.challengeId)) throw new Error('fake repository duplicate challenge')
    this.state.challenges.set(challenge.challengeId, copy(challenge))
  }

  async getChallenge(challengeId) {
    return copy(this.state.challenges.get(challengeId) ?? null)
  }

  async getEndpointChallengeRateWindow(userId, provider, realmId, windowStartedAt) {
    return copy(this.state.endpointChallengeRateWindows.get(JSON.stringify([
      userId, provider, realmId, windowStartedAt
    ])) ?? null)
  }

  async consumeEndpointChallengeRateWindow(input) {
    const key = JSON.stringify([input.userId, input.provider, input.realmId, input.windowStartedAt])
    const current = this.state.endpointChallengeRateWindows.get(key)
    if (!current) {
      const window = {
        userId: input.userId,
        provider: input.provider,
        realmId: input.realmId,
        windowStartedAt: input.windowStartedAt,
        expiresAt: input.expiresAt,
        attemptCount: 1,
        revision: 1,
        updatedAt: input.updatedAt
      }
      this.state.endpointChallengeRateWindows.set(key, window)
      return copy({ allowed: true, window })
    }
    if (current.attemptCount >= input.maxAttempts || current.expiresAt <= input.updatedAt) {
      return copy({ allowed: false, window: current })
    }
    const window = {
      ...current,
      attemptCount: current.attemptCount + 1,
      revision: current.revision + 1,
      updatedAt: input.updatedAt
    }
    this.state.endpointChallengeRateWindows.set(key, window)
    return copy({ allowed: true, window })
  }

  async getChallengeForUpdate(challengeId) {
    return this.getChallenge(challengeId)
  }

  async getChallengeByCodeDigestForUpdate(challengeDigest) {
    return copy([...this.state.challenges.values()].find((item) => item.challengeDigest === challengeDigest) ?? null)
  }

  async verifyChallenge(challengeId, userId, humanEndpointId, verifiedAt) {
    const challenge = this.state.challenges.get(challengeId)
    if (!challenge || challenge.verifiedAt) return false
    Object.assign(challenge, { verifiedUserId: userId, verifiedEndpointId: humanEndpointId, verifiedAt })
    return true
  }

  async getEndpoint(humanEndpointId) {
    return copy(this.state.endpoints.get(humanEndpointId) ?? null)
  }

  async getEndpointByProviderIdentity(provider, realmId, providerUserId) {
    return copy([...this.state.endpoints.values()].find((item) => (
      item.provider === provider && item.realmId === realmId && item.providerUserId === providerUserId
    )) ?? null)
  }

  async insertEndpoint(endpoint) {
    if (this.state.endpoints.has(endpoint.humanEndpointId)) throw new Error('fake repository duplicate endpoint')
    this.state.endpoints.set(endpoint.humanEndpointId, copy(endpoint))
  }

  async updateEndpoint(endpoint, expectedRevision) {
    revisionUpdate(this.state.endpoints, endpoint.humanEndpointId, endpoint, expectedRevision)
  }

  async getAgent(agentId) {
    return copy(this.state.agents.get(agentId) ?? null)
  }

  async listAgentsForDevice(deviceId) {
    return copy([...this.state.agents.values()].filter((value) => value.deviceId === deviceId))
  }

  async insertAgent(agent) {
    if (this.state.agents.has(agent.agentId)) throw new Error('fake repository duplicate agent')
    this.state.agents.set(agent.agentId, copy(agent))
  }

  async updateAgent(agent, expectedRevision) {
    revisionUpdate(this.state.agents, agent.agentId, agent, expectedRevision)
  }

  async insertCredential(credential) {
    if (this.state.credentials.has(credential.credentialId)) throw new Error('fake repository duplicate credential')
    this.state.credentials.set(credential.credentialId, copy(credential))
  }

  async getCredentialByDigest(tokenDigest) {
    return copy([...this.state.credentials.values()].find((item) => item.tokenDigest === tokenDigest) ?? null)
  }

  async getCredential(credentialId) {
    return copy(this.state.credentials.get(credentialId) ?? null)
  }

  async revokeAgentCredentials(agentId, revokedAt) {
    let updated = 0
    for (const credential of this.state.credentials.values()) {
      if (credential.kind === 'agent_device' && credential.subjectAgentId === agentId && !credential.revokedAt) {
        credential.revokedAt = revokedAt
        updated += 1
      }
    }
    return updated
  }

  async revokeAgentCredentialsForDevice(deviceId, revokedAt) {
    const agentIds = new Set([...this.state.agents.values()].filter((value) => value.deviceId === deviceId)
      .map((value) => value.agentId))
    let updated = 0
    for (const credential of this.state.credentials.values()) {
      if (credential.kind === 'agent_device' && agentIds.has(credential.subjectAgentId) && !credential.revokedAt) {
        credential.revokedAt = revokedAt
        updated += 1
      }
    }
    return updated
  }

  async getParticipant(userId) {
    return copy(this.state.participants.get(userId) ?? null)
  }

  async listEndpointsForUser(userId) {
    return copy([...this.state.endpoints.values()].filter((item) => item.userId === userId))
  }

  async listAgentsForUser(userId) {
    return copy([...this.state.agents.values()].filter((item) => item.ownerUserId === userId))
  }

  async upsertParticipant(participant, expectedRevision) {
    const current = this.state.participants.get(participant.userId)
    if (expectedRevision === null) {
      if (current) throw new Error('fake repository duplicate participant')
    } else if (!current || current.revision !== expectedRevision) {
      throw new Error('fake repository participant revision conflict')
    }
    this.state.participants.set(participant.userId, copy(participant))
  }

  async getProjection(projectionId) {
    return copy(this.state.projections.get(projectionId) ?? null)
  }

  async getProjectionByLocator(provider, realmId, containerId, topicId) {
    return copy([...this.state.projections.values()].find((item) => (
      item.locator.provider === provider &&
      item.locator.realmId === realmId &&
      item.locator.containerId === containerId &&
      item.locator.topicId === topicId
    )) ?? null)
  }

  async listProjectionsForOwner(userId) {
    return copy([...this.state.projections.values()].filter((item) => item.ownerUserId === userId))
  }

  async insertProjection(projection) {
    if (this.state.projections.has(projection.projectionId)) throw new Error('fake repository duplicate projection')
    this.state.projections.set(projection.projectionId, copy(projection))
  }

  async updateProjection(projection, expectedRevision) {
    revisionUpdate(this.state.projections, projection.projectionId, projection, expectedRevision)
  }

  async getManagedContainer(managedContainerId) {
    return copy(this.state.managedContainers.get(managedContainerId) ?? null)
  }

  async getManagedContainerForOwner(ownerUserId, provider, realmId) {
    return copy([...this.state.managedContainers.values()].find((item) => (
      item.ownerUserId === ownerUserId && item.provider === provider && item.realmId === realmId
    )) ?? null)
  }

  async listManagedContainersForOwner(ownerUserId) {
    return copy([...this.state.managedContainers.values()].filter((item) => item.ownerUserId === ownerUserId))
  }

  async insertManagedContainer(container) {
    if (this.state.managedContainers.has(container.managedContainerId)) throw new Error('fake repository duplicate managed container')
    this.state.managedContainers.set(container.managedContainerId, copy(container))
  }

  async updateManagedContainer(container, expectedRevision) {
    revisionUpdate(this.state.managedContainers, container.managedContainerId, container, expectedRevision)
  }

  async insertManagedContainerJob(job) {
    if (this.state.managedContainerJobs.has(job.jobId)) throw new Error('fake repository duplicate managed container job')
    this.state.managedContainerJobs.set(job.jobId, copy(job))
  }

  async claimManagedContainerJobs(workerId, now, leaseExpiresAt, limit) {
    const jobs = [...this.state.managedContainerJobs.values()]
      .filter((job) => ['queued', 'retry_wait', 'running'].includes(job.state) &&
        job.nextAttemptAt <= now && (job.state !== 'running' || job.leaseExpiresAt <= now))
      .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt))
      .slice(0, limit)
    for (const job of jobs) Object.assign(job, {
      state: 'running', leaseOwner: workerId, leaseExpiresAt, attemptCount: job.attemptCount + 1, updatedAt: now
    })
    return copy(jobs)
  }

  async completeManagedContainerJob(input) {
    const job = this.state.managedContainerJobs.get(input.jobId)
    if (!job || job.state !== 'running' || job.leaseOwner !== input.workerId ||
      job.attemptCount !== input.expectedAttemptCount) throw new Error('fake repository job lease lost')
    revisionUpdate(this.state.managedContainers, input.container.managedContainerId, input.container, input.expectedContainerRevision)
    Object.assign(job, { state: 'succeeded', leaseOwner: undefined, leaseExpiresAt: undefined,
      safeErrorCode: undefined, updatedAt: input.completedAt })
  }

  async failManagedContainerJob(input) {
    const job = this.state.managedContainerJobs.get(input.jobId)
    if (!job || job.state !== 'running' || job.leaseOwner !== input.workerId ||
      job.attemptCount !== input.expectedAttemptCount) throw new Error('fake repository job lease lost')
    if (input.container) revisionUpdate(this.state.managedContainers, input.container.managedContainerId,
      input.container, input.expectedContainerRevision)
    Object.assign(job, { state: input.retryAt ? 'retry_wait' : 'failed',
      nextAttemptAt: input.retryAt ?? job.nextAttemptAt, leaseOwner: undefined, leaseExpiresAt: undefined,
      safeErrorCode: input.safeErrorCode, updatedAt: input.failedAt })
  }

  async getProjectEndpointBinding(projectId) {
    return copy(this.state.projectEndpointBindings.get(projectId) ?? null)
  }

  async getProjectBindingByLocator(provider, realmId, containerId, topicId) {
    return copy([...this.state.projectEndpointBindings.values()].find((item) => (
      item.locator.provider === provider &&
      item.locator.realmId === realmId &&
      item.locator.containerId === containerId &&
      item.locator.topicId === topicId
    )) ?? null)
  }

  async upsertProjectEndpointBinding(binding, expectedRevision) {
    const current = this.state.projectEndpointBindings.get(binding.projectId)
    if (expectedRevision === null) {
      if (current) throw new Error('fake repository duplicate project endpoint binding')
    } else if (!current || current.revision !== expectedRevision) {
      throw new Error('fake repository project endpoint revision conflict')
    }
    this.state.projectEndpointBindings.set(binding.projectId, copy(binding))
  }

  async getProjectInputByProviderMessage(endpointId, providerMessageId) {
    return copy([...this.state.projectInputs.values()].find((item) => (
      item.sourceHumanEndpointId === endpointId && item.providerMessageId === providerMessageId
    )) ?? null)
  }

  async insertProjectInput(input) {
    const sequence = [...this.state.projectInputs.values()].filter((item) => item.projectId === input.projectId).length + 1
    const stored = { ...copy(input), sequence }
    this.state.projectInputs.set(stored.projectInputId, stored)
    return copy(stored)
  }

  async getHumanRequest(humanRequestId) {
    return copy(this.state.humanRequests.get(humanRequestId) ?? null)
  }

  async listHumanRequestsByProject(projectId, status, afterHumanRequestId, limit) {
    return copy([...this.state.humanRequests.values()]
      .filter((request) => request.projectId === projectId &&
        (status === null || request.status === status) &&
        (afterHumanRequestId === null || request.humanRequestId.localeCompare(afterHumanRequestId) > 0))
      .sort((left, right) => left.humanRequestId.localeCompare(right.humanRequestId))
      .slice(0, limit))
  }

  async insertHumanRequest(request) {
    if (this.state.humanRequests.has(request.humanRequestId)) throw new Error('fake repository duplicate human request')
    this.state.humanRequests.set(request.humanRequestId, copy(request))
  }

  async updateHumanRequest(request, expectedRevision) {
    revisionUpdate(this.state.humanRequests, request.humanRequestId, request, expectedRevision)
  }

  async getHumanAnswerForRequest(humanRequestId) {
    return copy([...this.state.humanAnswers.values()].find((item) => item.humanRequestId === humanRequestId) ?? null)
  }

  async insertHumanAnswer(answer) {
    if (this.state.humanAnswers.has(answer.humanAnswerId)) throw new Error('fake repository duplicate human answer')
    this.state.humanAnswers.set(answer.humanAnswerId, copy(answer))
  }

  async getRemoteApproval(remoteApprovalId) {
    return copy(this.state.remoteApprovals.get(remoteApprovalId) ?? null)
  }

  async getRemoteApprovalByReferenceDigest(referenceDigest) {
    return copy([...this.state.remoteApprovals.values()].find(
      (approval) => approval.referenceDigest === referenceDigest
    ) ?? null)
  }

  async listExpiredRemoteApprovals(now, limit) {
    return copy([...this.state.remoteApprovals.values()]
      .filter((approval) => approval.status === 'pending' && approval.expiresAt <= now)
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
      .slice(0, limit))
  }

  async insertRemoteApproval(approval) {
    if (this.state.remoteApprovals.has(approval.remoteApprovalId)) {
      throw new Error('fake repository duplicate remote approval')
    }
    this.state.remoteApprovals.set(approval.remoteApprovalId, copy(approval))
  }

  async updateRemoteApproval(approval, expectedRevision) {
    revisionUpdate(this.state.remoteApprovals, approval.remoteApprovalId, approval, expectedRevision)
  }

  async getProject(projectId) {
    return copy(this.state.projects.get(projectId) ?? null)
  }

  async listProjectsForUser(userId, afterProjectId, limit) {
    return copy([...this.state.projects.values()]
      .filter((project) => {
        const membership = this.state.projectMembers.get(`${project.projectId}:${userId}`)
        return (project.ownerUserId === userId ||
          membership?.state === 'active' || membership?.state === 'membership_removal_pending') &&
          (afterProjectId === null || project.projectId.localeCompare(afterProjectId) > 0)
      })
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
      .slice(0, limit))
  }

  async getProjectForUpdate(projectId) {
    return this.getProject(projectId)
  }

  async insertProject(project, members) {
    if (this.state.projects.has(project.projectId)) throw new Error('fake repository duplicate project')
    this.state.projects.set(project.projectId, copy(project))
    for (const member of members) await this.insertProjectMember(member)
  }

  async updateProject(project, expectedRevision) {
    assertImmutableFields(this.state.projects.get(project.projectId), project,
      ['projectId', 'ownerUserId', 'createdAt'], 'Project')
    revisionUpdate(this.state.projects, project.projectId, project, expectedRevision)
  }

  async getProjectMember(projectId, userId) {
    return copy(this.state.projectMembers.get(`${projectId}:${userId}`) ?? null)
  }

  async getProjectMemberForUpdate(projectId, userId) {
    return this.getProjectMember(projectId, userId)
  }

  async insertProjectMember(member) {
    const key = `${member.projectId}:${member.userId}`
    if (this.state.projectMembers.has(key)) throw new Error('fake repository duplicate project member')
    this.state.projectMembers.set(key, copy(member))
  }

  async updateProjectMember(member, expectedRevision) {
    const key = `${member.projectId}:${member.userId}`
    assertImmutableFields(this.state.projectMembers.get(key), member,
      ['projectMembershipId', 'projectId', 'userId', 'createdAt'], 'Project Membership')
    revisionUpdate(this.state.projectMembers, key, member, expectedRevision)
  }

  async listProjectMembers(projectId) {
    return copy([...this.state.projectMembers.values()].filter((item) => item.projectId === projectId))
  }

  async listActiveProjectMembersForUser(userId) {
    return copy([...this.state.projectMembers.values()].filter((item) => (
      item.userId === userId && item.state === 'active'
    )))
  }

  async getWorkerAvailability(agentId) {
    return copy(this.state.workerAvailability.get(agentId) ?? null)
  }

  async listWorkerAvailabilityForUser(userId, now) {
    return copy([...this.state.workerAvailability.values()].filter((item) => (
      item.userId === userId && item.expiresAt > now
    )))
  }

  async listAvailableWorkers(now) {
    return copy([...this.state.workerAvailability.values()].filter((item) => (
      item.expiresAt > now &&
      item.agentActive &&
      item.deviceActive &&
      item.connectionStatus === 'online' &&
      item.runtimeReadiness === 'ready'
    )))
  }

  async upsertWorkerAvailability(availability, expectedRevision) {
    const current = this.state.workerAvailability.get(availability.agentId)
    if (expectedRevision === null) {
      if (current) throw new Error('fake repository duplicate Worker availability')
    } else if (!current || current.revision !== expectedRevision ||
        availability.revision !== expectedRevision + 1) {
      throw new Error('fake repository Worker availability revision conflict')
    }
    if (current) {
      assertImmutableFields(current, availability, ['agentId', 'userId', 'deviceId', 'createdAt'],
        'Worker availability')
    }
    this.state.workerAvailability.set(availability.agentId, copy(availability))
  }

  async getProviderDirectoryPrincipalFact(providerPrincipalFactId) {
    return copy(this.state.providerDirectoryPrincipalFacts.get(providerPrincipalFactId) ?? null)
  }

  #providerDirectoryPrincipalFactForSlot(userId, providerInstance) {
    return [...this.state.providerDirectoryPrincipalFacts.values()].find((fact) => (
      fact.userId === userId &&
      fact.providerPrincipal.providerInstance.authority === providerInstance.authority &&
      fact.providerPrincipal.providerInstance.instanceId === providerInstance.instanceId
    )) ?? null
  }

  async getProviderDirectoryPrincipalFactForSlot(userId, providerInstance) {
    return copy(this.#providerDirectoryPrincipalFactForSlot(userId, providerInstance))
  }

  async getProviderDirectoryPrincipalFactForUpdate(providerPrincipalFactId) {
    return this.getProviderDirectoryPrincipalFact(providerPrincipalFactId)
  }

  async getProviderDirectoryPrincipalFactForSlotForUpdate(userId, providerInstance) {
    return this.getProviderDirectoryPrincipalFactForSlot(userId, providerInstance)
  }

  async listProviderDirectoryPrincipalFacts(input) {
    return copy([...this.state.providerDirectoryPrincipalFacts.values()]
      .filter((fact) => input.userIds.includes(fact.userId))
      .filter((fact) => input.providerInstance === null || (
        fact.providerPrincipal.providerInstance.authority === input.providerInstance.authority &&
        fact.providerPrincipal.providerInstance.instanceId === input.providerInstance.instanceId
      ))
      .filter((fact) => input.includeDegraded || fact.readiness === 'ready')
      .filter((fact) => input.afterFactId === null || fact.providerPrincipalFactId > input.afterFactId)
      .sort((left, right) => left.providerPrincipalFactId.localeCompare(right.providerPrincipalFactId))
      .slice(0, input.limit))
  }

  async insertProviderDirectoryPrincipalFact(fact) {
    if (this.state.providerDirectoryPrincipalFacts.has(fact.providerPrincipalFactId) ||
        this.#providerDirectoryPrincipalFactForSlot(fact.userId, fact.providerPrincipal.providerInstance)) {
      throw new Error('fake repository duplicate Provider directory principal fact')
    }
    this.state.providerDirectoryPrincipalFacts.set(fact.providerPrincipalFactId, copy(fact))
  }

  async updateProviderDirectoryPrincipalFact(fact, expectedRevision) {
    const current = this.state.providerDirectoryPrincipalFacts.get(fact.providerPrincipalFactId)
    if (!current || current.userId !== fact.userId ||
        current.providerPrincipal.providerInstance.authority !== fact.providerPrincipal.providerInstance.authority ||
        current.providerPrincipal.providerInstance.instanceId !== fact.providerPrincipal.providerInstance.instanceId) {
      throw new Error('fake repository immutable Provider directory principal fact slot changed')
    }
    const slot = this.#providerDirectoryPrincipalFactForSlot(fact.userId, fact.providerPrincipal.providerInstance)
    if (slot && slot.providerPrincipalFactId !== fact.providerPrincipalFactId) {
      throw new Error('fake repository duplicate Provider directory principal fact slot')
    }
    revisionUpdate(
      this.state.providerDirectoryPrincipalFacts,
      fact.providerPrincipalFactId,
      fact,
      expectedRevision
    )
  }

  async getProjectProviderMembershipObservation(providerObservationId) {
    return copy(this.state.projectProviderMembershipObservations.get(providerObservationId) ?? null)
  }

  async listProjectProviderMembershipObservations(projectId, userId) {
    return copy([...this.state.projectProviderMembershipObservations.values()].filter((item) => (
      item.projectId === projectId && (userId === undefined || item.userId === userId)
    )))
  }

  async insertProjectProviderMembershipObservation(observation) {
    if (this.state.projectProviderMembershipObservations.has(observation.providerObservationId)) {
      throw new Error('fake repository duplicate Provider membership observation')
    }
    this.state.projectProviderMembershipObservations.set(
      observation.providerObservationId,
      copy(observation)
    )
  }

  async getProjectContentReadiness(projectId, userId) {
    return copy(this.state.projectContentReadiness.get(`${projectId}:${userId}`) ?? null)
  }

  async getProjectContentReadinessForUpdate(projectId, userId) {
    return this.getProjectContentReadiness(projectId, userId)
  }

  async listProjectContentReadiness(projectId) {
    return copy([...this.state.projectContentReadiness.values()].filter((item) => item.projectId === projectId))
  }

  async upsertProjectContentReadiness(readiness, expectedRevision) {
    const key = `${readiness.projectId}:${readiness.userId}`
    const current = this.state.projectContentReadiness.get(key)
    if (expectedRevision === null) {
      if (current) throw new Error('fake repository duplicate content readiness')
    } else if (!current || current.revision !== expectedRevision ||
        readiness.revision !== expectedRevision + 1) {
      throw new Error('fake repository content readiness revision conflict')
    }
    if (current) {
      assertImmutableFields(current, readiness, ['projectId', 'userId', 'createdAt'], 'content readiness')
    }
    this.state.projectContentReadiness.set(key, copy(readiness))
  }

  async getTaskAuthority(projectId, userId, scope) {
    return copy(this.state.taskAuthorities.get(`${projectId}:${userId}:${scope}`) ?? null)
  }

  async getTaskAuthorityForUpdate(projectId, userId, scope) {
    return this.getTaskAuthority(projectId, userId, scope)
  }

  async listTaskAuthorities(projectId) {
    return copy([...this.state.taskAuthorities.values()].filter((item) => item.projectId === projectId))
  }

  async listTaskAuthoritiesForUser(projectId, userId) {
    return copy([...this.state.taskAuthorities.values()].filter((item) => (
      item.projectId === projectId && item.userId === userId
    )))
  }

  async listTaskAuthoritiesForUserForUpdate(projectId, userId) {
    return this.listTaskAuthoritiesForUser(projectId, userId)
  }

  async upsertTaskAuthority(authority, expectedRevision) {
    const key = `${authority.projectId}:${authority.userId}:${authority.scope}`
    const current = this.state.taskAuthorities.get(key)
    if (expectedRevision === null) {
      if (current) throw new Error('fake repository duplicate Task authority')
    } else if (!current || current.revision !== expectedRevision ||
        authority.revision !== expectedRevision + 1) {
      throw new Error('fake repository Task authority revision conflict')
    }
    if (current) {
      assertImmutableFields(current, authority,
        ['taskAuthorityId', 'projectId', 'userId', 'scope', 'createdAt'], 'Task authority')
    }
    this.state.taskAuthorities.set(key, copy(authority))
  }

  async getProjectContentProvisioningIntent(provisioningIntentId) {
    return copy(this.state.projectContentProvisioningIntents.get(provisioningIntentId) ?? null)
  }

  async getProjectContentProvisioningIntentForUpdate(provisioningIntentId) {
    return this.getProjectContentProvisioningIntent(provisioningIntentId)
  }

  async getLatestProjectContentProvisioningIntent(projectId) {
    return copy([...this.state.projectContentProvisioningIntents.values()]
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => right.provisioningRevision - left.provisioningRevision)[0] ?? null)
  }

  async listProjectContentProvisioningIntents(projectId) {
    return copy([...this.state.projectContentProvisioningIntents.values()]
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => left.provisioningRevision - right.provisioningRevision))
  }

  async insertProjectContentProvisioningIntent(intent) {
    if (this.state.projectContentProvisioningIntents.has(intent.provisioningIntentId)) {
      throw new Error('fake repository duplicate provisioning intent')
    }
    this.state.projectContentProvisioningIntents.set(intent.provisioningIntentId, copy(intent))
  }

  async updateProjectContentProvisioningIntent(intent, expectedRevision) {
    const current = this.state.projectContentProvisioningIntents.get(intent.provisioningIntentId)
    for (const key of [
      'projectId', 'provisioningRevision', 'kind', 'createdByOwnerUserId', 'contentOwnerUserId',
      'providerInstance', 'desiredMembers', 'containerDisplayName', 'currentRootLocator',
      'currentBindingRevision', 'intentDigest', 'createdAt'
    ]) {
      if (JSON.stringify(current?.[key]) !== JSON.stringify(intent[key])) {
        throw new Error(`fake repository immutable provisioning intent field changed: ${key}`)
      }
    }
    revisionUpdate(
      this.state.projectContentProvisioningIntents,
      intent.provisioningIntentId,
      intent,
      expectedRevision
    )
  }

  async getProjectContentProvisioningAttestation(provisioningAttestationId) {
    return copy(this.state.projectContentProvisioningAttestations.get(provisioningAttestationId) ?? null)
  }

  async listProjectContentProvisioningAttestations(projectId) {
    return copy([...this.state.projectContentProvisioningAttestations.values()]
      .filter((item) => item.projectId === projectId))
  }

  async insertProjectContentProvisioningAttestation(attestation) {
    if (this.state.projectContentProvisioningAttestations.has(attestation.provisioningAttestationId)) {
      throw new Error('fake repository duplicate provisioning attestation')
    }
    this.state.projectContentProvisioningAttestations.set(attestation.provisioningAttestationId, copy(attestation))
  }

  async getProjectContentSpaceBinding(projectId) {
    return copy(this.state.projectContentBindings.get(projectId) ?? null)
  }

  async getProjectContentSpaceBindingForUpdate(projectId) {
    return this.getProjectContentSpaceBinding(projectId)
  }

  async upsertProjectContentSpaceBinding(binding, expectedRevision) {
    const current = this.state.projectContentBindings.get(binding.projectId)
    if (expectedRevision === null) {
      if (current) throw new Error('fake repository duplicate Project content binding')
    } else if (!current || current.revision !== expectedRevision ||
        binding.revision !== expectedRevision + 1) {
      throw new Error('fake repository Project content binding revision conflict')
    }
    if (current) {
      assertImmutableFields(current, binding,
        ['projectContentBindingId', 'projectId', 'createdAt'], 'Project content binding')
    }
    this.state.projectContentBindings.set(binding.projectId, copy(binding))
  }

  async getExternalOperationJournal(logicalInvocationId) {
    return copy(this.state.externalOperationJournal.get(logicalInvocationId) ?? null)
  }

  async getExternalOperationJournalForUpdate(logicalInvocationId) {
    return this.getExternalOperationJournal(logicalInvocationId)
  }

  async getExternalOperationJournalById(journalEntryId) {
    return copy([...this.state.externalOperationJournal.values()].find((item) => (
      item.contentRecoveryJournalEntryId === journalEntryId
    )) ?? null)
  }

  async getExternalOperationJournalByIdForUpdate(journalEntryId) {
    return this.getExternalOperationJournalById(journalEntryId)
  }

  async listExternalOperationJournal(projectId) {
    return copy([...this.state.externalOperationJournal.values()].filter((item) => item.projectId === projectId))
  }

  async insertExternalOperationJournal(operation) {
    if (this.state.externalOperationJournal.has(operation.logicalInvocationId)) {
      throw new Error('fake repository duplicate external operation')
    }
    this.state.externalOperationJournal.set(operation.logicalInvocationId, copy(operation))
  }

  async updateExternalOperationJournal(operation, expectedRevision) {
    const current = this.state.externalOperationJournal.get(operation.logicalInvocationId)
    assertImmutableFields(current, operation, [
      'contentRecoveryJournalEntryId', 'scope', 'logicalInvocationId', 'projectId', 'taskId',
      'preparedTaskRevision', 'provisioningIntentId', 'provisioningRevision', 'executionId',
      'preparedExecutionRevision', 'operation', 'requestDigest', 'preparedAt', 'createdAt'
    ], 'external operation journal')
    revisionUpdate(this.state.externalOperationJournal, operation.logicalInvocationId, operation, expectedRevision)
  }

  async getVisibleRecoveryAction(recoveryActionId) {
    return copy(this.state.visibleRecoveryActions.get(recoveryActionId) ?? null)
  }

  async getVisibleRecoveryActionForUpdate(recoveryActionId) {
    return this.getVisibleRecoveryAction(recoveryActionId)
  }

  async listVisibleRecoveryActionsByProject(projectId) {
    return copy([...this.state.visibleRecoveryActions.values()]
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => (
        left.availableAt.localeCompare(right.availableAt) ||
        left.recoveryActionId.localeCompare(right.recoveryActionId)
      )))
  }

  async insertVisibleRecoveryAction(action) {
    if (this.state.visibleRecoveryActions.has(action.recoveryActionId)) {
      throw new Error('fake repository duplicate visible recovery action')
    }
    this.state.visibleRecoveryActions.set(action.recoveryActionId, copy(action))
  }

  async updateVisibleRecoveryAction(action, expectedRevision) {
    const current = this.state.visibleRecoveryActions.get(action.recoveryActionId)
    assertImmutableFields(current, action, [
      'recoveryActionId', 'projectId', 'taskId', 'executionId', 'journalEntryId',
      'audience', 'action', 'requiresFreshObservation', 'safeSummary', 'availableAt', 'createdAt'
    ], 'visible recovery action')
    revisionUpdate(this.state.visibleRecoveryActions, action.recoveryActionId, action, expectedRevision)
  }

  async getCloudResourceRef(resourceRefId) {
    return copy(this.state.cloudResourceRefs.get(resourceRefId) ?? null)
  }

  async listCloudResourceRefs(taskId, executionId) {
    return copy([...this.state.cloudResourceRefs.values()].filter((item) => (
      item.taskId === taskId && item.executionId === executionId
    )))
  }

  async insertCloudResourceRefs(resources) {
    for (const resource of resources) {
      if (this.state.cloudResourceRefs.has(resource.resourceRefId)) {
        throw new Error('fake repository duplicate Cloud resource ref')
      }
      this.state.cloudResourceRefs.set(resource.resourceRefId, copy(resource))
    }
  }

  async invalidateCloudResourceRefs(taskId, executionId, invalidatedAt) {
    let count = 0
    for (const resource of this.state.cloudResourceRefs.values()) {
      if (resource.taskId === taskId && resource.executionId === executionId && resource.status === 'available') {
        Object.assign(resource, { status: 'invalidated', invalidatedAt,
          revision: resource.revision + 1, updatedAt: invalidatedAt })
        count += 1
      }
    }
    return count
  }

  async invalidateCloudResourceRefsForBinding(projectId, bindingRevision, invalidatedAt) {
    let count = 0
    for (const resource of this.state.cloudResourceRefs.values()) {
      if (resource.projectId === projectId && resource.bindingRevision === bindingRevision &&
          resource.status === 'available') {
        Object.assign(resource, { status: 'invalidated', invalidatedAt,
          revision: resource.revision + 1, updatedAt: invalidatedAt })
        count += 1
      }
    }
    return count
  }

  async countProjectTasks(projectId, coordinationRound) {
    return [...this.state.tasks.values()].filter((item) => (
      item.projectId === projectId && (coordinationRound === undefined || item.coordinationRound === coordinationRound)
    )).length
  }

  async countOpenFileTasks(projectId) {
    const open = new Set([
      'offered', 'in_progress', 'needs_human', 'awaiting_review',
      'revision_requested', 'manual_recovery_required'
    ])
    return [...this.state.tasks.values()].filter((item) => (
      item.projectId === projectId && item.fileIntent !== null && open.has(item.status)
    )).length
  }

  async listActiveProjectsForCoordinator(agentId) {
    return copy([...this.state.projects.values()].filter((item) => (
      item.coordinatorAgentId === agentId && item.status === 'active'
    )))
  }

  async listOpenTasksForAgent(agentId) {
    const open = new Set([
      'offered', 'in_progress', 'needs_human', 'awaiting_review',
      'revision_requested', 'manual_recovery_required'
    ])
    return copy([...this.state.tasks.values()].filter((task) => {
      const execution = task.currentExecutionId === null
        ? null
        : this.state.taskExecutions.get(task.currentExecutionId)
      return execution?.assigneeAgentId === agentId && open.has(task.status)
    }))
  }

  async getTask(taskId) {
    return copy(this.state.tasks.get(taskId) ?? null)
  }

  async listTasksByProject(projectId, afterTaskId, limit) {
    return copy([...this.state.tasks.values()]
      .filter((task) => task.projectId === projectId &&
        (afterTaskId === null || task.taskId.localeCompare(afterTaskId) > 0))
      .sort((left, right) => left.taskId.localeCompare(right.taskId))
      .slice(0, limit))
  }

  async getTaskForUpdate(taskId) {
    return this.getTask(taskId)
  }

  async insertTask(task) {
    if (this.state.tasks.has(task.taskId)) throw new Error('fake repository duplicate task')
    this.state.tasks.set(task.taskId, copy(task))
  }

  async updateTask(task, expectedRevision) {
    assertImmutableFields(this.state.tasks.get(task.taskId), task, [
      'taskId', 'projectId', 'createdByCoordinatorAgentId', 'title', 'objective',
      'completionCriteria', 'dependencyTaskIds', 'maxRetries', 'coordinationRound', 'createdAt'
    ], 'Task')
    revisionUpdate(this.state.tasks, task.taskId, task, expectedRevision)
  }

  async getTaskExecution(executionId) {
    return copy(this.state.taskExecutions.get(executionId) ?? null)
  }

  async listTaskExecutions(taskId) {
    return copy([...this.state.taskExecutions.values()].filter((item) => item.taskId === taskId))
  }

  async listTaskExecutionsByProject(projectId, afterExecutionId, limit) {
    return copy([...this.state.taskExecutions.values()]
      .filter((execution) => execution.projectId === projectId &&
        (afterExecutionId === null || execution.executionId.localeCompare(afterExecutionId) > 0))
      .sort((left, right) => left.executionId.localeCompare(right.executionId))
      .slice(0, limit))
  }

  #currentTaskExecutions(predicate) {
    const live = new Set(['offered', 'accepted', 'running', 'needs_human'])
    return [...this.state.taskExecutions.values()].filter((execution) => {
      const task = this.state.tasks.get(execution.taskId)
      return task?.currentExecutionId === execution.executionId && live.has(execution.state) && predicate(execution)
    })
  }

  async listCurrentTaskExecutionsForAgent(agentId) {
    return copy(this.#currentTaskExecutions((execution) => execution.assigneeAgentId === agentId))
  }

  async listCurrentTaskExecutionsForDevice(deviceId) {
    return copy(this.#currentTaskExecutions((execution) => execution.assigneeDeviceId === deviceId))
  }

  async listCurrentTaskExecutionsForUser(userId) {
    return copy(this.#currentTaskExecutions((execution) => execution.assigneeUserId === userId))
  }

  async listCurrentTaskExecutionsForAgentForUpdate(agentId) {
    return this.listCurrentTaskExecutionsForAgent(agentId)
  }

  async listCurrentTaskExecutionsForDeviceForUpdate(deviceId) {
    return this.listCurrentTaskExecutionsForDevice(deviceId)
  }

  async listCurrentTaskExecutionsForProjectUserForUpdate(projectId, userId) {
    return copy(this.#currentTaskExecutions((execution) => (
      execution.projectId === projectId && execution.assigneeUserId === userId
    )))
  }

  async listCurrentTaskExecutionsForProjectForUpdate(projectId) {
    return copy(this.#currentTaskExecutions((execution) => execution.projectId === projectId))
  }

  async insertTaskExecution(execution) {
    if (this.state.taskExecutions.has(execution.executionId)) {
      throw new Error('fake repository duplicate Task execution')
    }
    this.state.taskExecutions.set(execution.executionId, copy(execution))
  }

  async getTaskExecutionForUpdate(executionId) {
    return this.getTaskExecution(executionId)
  }

  async updateTaskExecution(execution, expectedRevision) {
    const current = this.state.taskExecutions.get(execution.executionId)
    if (!current || current.stateRevision !== expectedRevision || execution.stateRevision !== expectedRevision + 1) {
      throw new Error('fake repository Task execution state revision conflict')
    }
    assertImmutableFields(current, execution, [
      'executionId', 'taskId', 'projectId', 'attempt', 'offeredByCoordinatorAgentId',
      'assigneeUserId', 'assigneeAgentId', 'assigneeDeviceId', 'fileIntent', 'offeredAt', 'createdAt'
    ], 'Task execution')
    revisionUpdate(this.state.taskExecutions, execution.executionId, execution, expectedRevision)
  }

  async getTaskOffer(taskOfferId) {
    return copy(this.state.taskOffers.get(taskOfferId) ?? null)
  }

  async getTaskOfferForUpdate(taskOfferId) {
    return this.getTaskOffer(taskOfferId)
  }

  async listExpiredTaskOffers(now, limit) {
    return copy([...this.state.taskOffers.values()]
      .filter((offer) => {
        const execution = this.state.taskExecutions.get(offer.executionId)
        const task = this.state.tasks.get(offer.taskId)
        return offer.state === 'pending' && offer.expiresAt <= now &&
          execution?.state === 'offered' && execution.fence.status === 'open' &&
          task?.currentExecutionId === execution.executionId
      })
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt) ||
        left.taskOfferId.localeCompare(right.taskOfferId))
      .slice(0, limit))
  }

  async listTaskOffers(executionId) {
    return copy([...this.state.taskOffers.values()].filter((offer) => offer.executionId === executionId))
  }

  async listTaskOffersByProject(projectId, afterTaskOfferId, limit) {
    return copy([...this.state.taskOffers.values()]
      .filter((offer) => offer.projectId === projectId &&
        (afterTaskOfferId === null || offer.taskOfferId.localeCompare(afterTaskOfferId) > 0))
      .sort((left, right) => left.taskOfferId.localeCompare(right.taskOfferId))
      .slice(0, limit))
  }

  async insertTaskOffer(offer) {
    if (this.state.taskOffers.has(offer.taskOfferId)) {
      throw new Error('fake repository duplicate Task offer')
    }
    this.state.taskOffers.set(offer.taskOfferId, copy(offer))
  }

  async updateTaskOffer(offer, expectedRevision) {
    assertImmutableFields(this.state.taskOffers.get(offer.taskOfferId), offer, [
      'taskOfferId', 'executionId', 'taskId', 'projectId', 'assigneeUserId', 'assigneeAgentId',
      'assigneeDeviceId', 'offeredAt', 'expiresAt', 'createdAt'
    ], 'Task offer')
    revisionUpdate(this.state.taskOffers, offer.taskOfferId, offer, expectedRevision)
  }

  async getProjectPlan(projectPlanId) {
    return copy(this.state.projectPlans.get(projectPlanId) ?? null)
  }

  async getCurrentProjectPlan(projectId) {
    return copy([...this.state.projectPlans.values()]
      .filter((item) => item.projectId === projectId && item.state !== 'superseded')
      .sort((left, right) => right.planRevision - left.planRevision)[0] ?? null)
  }

  async listProjectPlans(projectId) {
    return copy([...this.state.projectPlans.values()].filter((item) => item.projectId === projectId))
  }

  async insertProjectPlan(plan) {
    if (this.state.projectPlans.has(plan.projectPlanId)) throw new Error('fake repository duplicate Project plan')
    this.state.projectPlans.set(plan.projectPlanId, copy(plan))
  }

  async updateProjectPlan(plan, expectedRevision) {
    assertImmutableFields(this.state.projectPlans.get(plan.projectPlanId), plan, [
      'projectPlanId', 'projectId', 'coordinatorAuthorityEpoch', 'planRevision',
      'sourceInputLocators', 'tasks', 'rationale', 'runtimeProvenance', 'planDigest', 'createdAt'
    ], 'Project plan')
    revisionUpdate(this.state.projectPlans, plan.projectPlanId, plan, expectedRevision)
  }

  async getTaskResultSubmission(resultSubmissionId) {
    return copy(this.state.taskResultSubmissions.get(resultSubmissionId) ?? null)
  }

  async listTaskResultSubmissions(taskId) {
    return copy([...this.state.taskResultSubmissions.values()].filter((item) => item.taskId === taskId))
  }

  async listTaskResultSubmissionsByProject(projectId, afterResultSubmissionId, limit) {
    return copy([...this.state.taskResultSubmissions.values()]
      .filter((submission) => submission.projectId === projectId &&
        (afterResultSubmissionId === null ||
          submission.resultSubmissionId.localeCompare(afterResultSubmissionId) > 0))
      .sort((left, right) => left.resultSubmissionId.localeCompare(right.resultSubmissionId))
      .slice(0, limit))
  }

  async insertTaskResultSubmission(submission) {
    if (this.state.taskResultSubmissions.has(submission.resultSubmissionId)) {
      throw new Error('fake repository duplicate Task result submission')
    }
    this.state.taskResultSubmissions.set(submission.resultSubmissionId, copy(submission))
  }

  async listTaskResultReviews(resultSubmissionId) {
    return copy([...this.state.taskResultReviews.values()]
      .filter((item) => item.resultSubmissionId === resultSubmissionId))
  }

  async listTaskResultReviewsByProject(projectId, afterReviewDecisionId, limit) {
    return copy([...this.state.taskResultReviews.values()]
      .filter((review) => review.projectId === projectId &&
        (afterReviewDecisionId === null || review.reviewDecisionId.localeCompare(afterReviewDecisionId) > 0))
      .sort((left, right) => left.reviewDecisionId.localeCompare(right.reviewDecisionId))
      .slice(0, limit))
  }

  async insertTaskResultReview(review) {
    if (this.state.taskResultReviews.has(review.reviewDecisionId)) {
      throw new Error('fake repository duplicate Task result review')
    }
    this.state.taskResultReviews.set(review.reviewDecisionId, copy(review))
  }

  async listProjectFinalSummaries(projectId) {
    return copy([...this.state.projectFinalSummaries.values()].filter((item) => item.projectId === projectId))
  }

  async insertProjectFinalSummary(summary) {
    if (this.state.projectFinalSummaries.has(summary.projectId)) {
      throw new Error('fake repository duplicate Project final summary')
    }
    this.state.projectFinalSummaries.set(summary.projectId, copy(summary))
  }

  async getProjectRecord(projectRecordId) {
    return copy(this.state.projectRecords.get(projectRecordId) ?? null)
  }

  async listProjectRecords(projectId, acceptedOnly) {
    return copy([...this.state.projectRecords.values()].filter((item) => (
      item.projectId === projectId && (!acceptedOnly || item.status === 'accepted')
    )))
  }

  async insertProjectRecord(record) {
    if (this.state.projectRecords.has(record.projectRecordId)) throw new Error('fake repository duplicate record')
    this.state.projectRecords.set(record.projectRecordId, copy(record))
  }

  async appendInbox(message) {
    const key = recipientKey(message.recipient)
    const inbox = this.state.inboxes.get(key) ?? []
    const stored = { ...copy(message), sequence: inbox.length + 1 }
    inbox.push(stored)
    this.state.inboxes.set(key, inbox)
    return copy(stored)
  }

  async pullInbox(recipient, afterSequence, limit, now) {
    return copy((this.state.inboxes.get(recipientKey(recipient)) ?? [])
      .filter((item) => item.sequence > afterSequence && item.expiresAt > now)
      .slice(0, limit))
  }

  async getInboxCursor(recipient) {
    return copy(this.state.inboxCursors.get(recipientKey(recipient)) ?? null)
  }

  async ackInbox(recipient, throughSequence, updatedAt) {
    const key = recipientKey(recipient)
    const inbox = this.state.inboxes.get(key) ?? []
    const current = this.state.inboxCursors.get(key)
    const latestSequence = inbox.at(-1)?.sequence ?? 0
    const cursor = {
      recipient: copy(recipient),
      nextSequence: latestSequence + 1,
      ackedSequence: Math.max(current?.ackedSequence ?? 0, Math.min(throughSequence, latestSequence)),
      updatedAt
    }
    this.state.inboxCursors.set(key, cursor)
    return copy(cursor)
  }

  async getReceipt(actorKey, idempotencyKey) {
    return copy(this.state.receipts.get(`${actorKey}:${idempotencyKey}`) ?? null)
  }

  async insertReceipt(receipt) {
    const key = `${receipt.actorKey}:${receipt.idempotencyKey}`
    if (this.state.receipts.has(key)) throw new Error('fake repository duplicate receipt')
    this.state.receipts.set(key, copy(receipt))
  }

  async insertAudit(event) {
    this.state.auditEvents.push(copy({ ...event, metadata: safeAuditMetadata(event.metadata) }))
  }

  async pruneExpired(now) {
    let inboxMessages = 0
    let receipts = 0
    let challenges = 0
    for (const [key, inbox] of this.state.inboxes) {
      const retained = inbox.filter((item) => item.expiresAt > now)
      inboxMessages += inbox.length - retained.length
      this.state.inboxes.set(key, retained)
    }
    for (const [key, receipt] of this.state.receipts) {
      if (receipt.expiresAt <= now) {
        this.state.receipts.delete(key)
        receipts += 1
      }
    }
    for (const [key, challenge] of this.state.challenges) {
      if (challenge.expiresAt <= now) {
        this.state.challenges.delete(key)
        challenges += 1
      }
    }
    return { inboxMessages, receipts, challenges }
  }

  async close() {
    this.closed = true
  }
}

export function createFakeAdapters(options = {}) {
  return {
    clock: options.clock ?? new FakeClock(),
    repository: options.repository ?? new FakeCollaborationRepository(),
    notifier: options.notifier ?? new FakeInboxNotifier(),
    provider: options.provider ?? new FakeHumanProvider(),
    runtime: options.runtime ?? new FakeAgentRuntime(),
    agentExecution: options.agentExecution ?? new FakeAgentExecutionHost(),
    agentThreads: options.agentThreads ?? new FakeAgentThreadsHost(),
    projectionOutbox: options.projectionOutbox ?? new FakeProjectionOutbox(),
    stateBackend: options.stateBackend ?? new FakeCollaborationStateBackend(),
    capabilityHost: options.capabilityHost ?? new FakeCapabilityHost()
  }
}
