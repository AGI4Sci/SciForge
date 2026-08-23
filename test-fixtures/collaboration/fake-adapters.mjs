function copy(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function recipientKey(recipient) {
  return `${recipient.kind}:${recipient.id}`
}

function revisionUpdate(map, id, value, expectedRevision) {
  const current = map.get(id)
  if (!current || current.revision !== expectedRevision) throw new Error('fake repository revision conflict')
  map.set(id, copy(value))
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
      challenges: new Map(),
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
      tasks: new Map(),
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

  async getUser(userId) {
    return copy(this.state.users.get(userId) ?? null)
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

  async getChallengeByCodeDigest(challengeDigest) {
    return copy([...this.state.challenges.values()].find((item) => item.challengeDigest === challengeDigest) ?? null)
  }

  async getChallengeByPollDigest(pollSecretDigest) {
    return copy([...this.state.challenges.values()].find((item) => item.pollSecretDigest === pollSecretDigest) ?? null)
  }

  async verifyChallenge(challengeId, userId, humanEndpointId, verifiedAt) {
    const challenge = this.state.challenges.get(challengeId)
    if (!challenge || challenge.verifiedAt || challenge.consumedAt) return false
    Object.assign(challenge, { verifiedUserId: userId, verifiedEndpointId: humanEndpointId, verifiedAt })
    return true
  }

  async consumeChallenge(challengeId, consumedAt) {
    const challenge = this.state.challenges.get(challengeId)
    if (!challenge || challenge.consumedAt) return false
    challenge.consumedAt = consumedAt
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

  async getAgentByInstallation(installationId) {
    return copy([...this.state.agents.values()].find((item) => item.installationId === installationId) ?? null)
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

  async revokeCredentials(kind, subjectId, revokedAt) {
    let updated = 0
    for (const credential of this.state.credentials.values()) {
      const matches = credential.kind === kind && (
        kind === 'user' ? credential.subjectUserId === subjectId : credential.subjectAgentId === subjectId
      )
      if (matches && !credential.revokedAt) {
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

  async insertProject(project, members) {
    if (this.state.projects.has(project.projectId)) throw new Error('fake repository duplicate project')
    this.state.projects.set(project.projectId, copy(project))
    for (const member of members) this.state.projectMembers.set(`${member.projectId}:${member.userId}`, copy(member))
  }

  async updateProject(project, expectedRevision) {
    revisionUpdate(this.state.projects, project.projectId, project, expectedRevision)
  }

  async getProjectMember(projectId, userId) {
    return copy(this.state.projectMembers.get(`${projectId}:${userId}`) ?? null)
  }

  async listProjectMembers(projectId) {
    return copy([...this.state.projectMembers.values()].filter((item) => item.projectId === projectId))
  }

  async countProjectTasks(projectId, coordinationRound) {
    return [...this.state.tasks.values()].filter((item) => (
      item.projectId === projectId && (coordinationRound === undefined || item.coordinationRound === coordinationRound)
    )).length
  }

  async listActiveProjectsForCoordinator(agentId) {
    return copy([...this.state.projects.values()].filter((item) => (
      item.coordinatorAgentId === agentId && item.status === 'active'
    )))
  }

  async listOpenTasksForAgent(agentId) {
    const closed = new Set(['rejected', 'completed', 'failed', 'cancelled'])
    return copy([...this.state.tasks.values()].filter((item) => item.assigneeAgentId === agentId && !closed.has(item.status)))
  }

  async getTask(taskId) {
    return copy(this.state.tasks.get(taskId) ?? null)
  }

  async insertTask(task) {
    if (this.state.tasks.has(task.taskId)) throw new Error('fake repository duplicate task')
    this.state.tasks.set(task.taskId, copy(task))
  }

  async updateTask(task, expectedRevision) {
    revisionUpdate(this.state.tasks, task.taskId, task, expectedRevision)
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

  async updateProjectRecord(record, expectedRevision) {
    revisionUpdate(this.state.projectRecords, record.projectRecordId, record, expectedRevision)
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
    this.state.auditEvents.push(copy(event))
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
