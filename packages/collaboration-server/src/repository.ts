import type {
  InboxRecipient,
  StoredAgent,
  StoredAuditEvent,
  StoredChallenge,
  StoredCredential,
  StoredEndpoint,
  StoredInboxCursor,
  StoredInboxMessage,
  StoredParticipant,
  StoredProject,
  StoredProjectEndpointBinding,
  StoredProjectInput,
  StoredProjectMember,
  StoredProjectRecord,
  StoredProjection,
  StoredReceipt,
  StoredTask,
  StoredUser,
  StoredHumanRequest,
  StoredHumanAnswer,
  StoredManagedContainer,
  StoredManagedContainerJob
} from './model.js'

export interface CollaborationReadRepository {
  getUser(userId: string): Promise<StoredUser | null>
  getEndpoint(humanEndpointId: string): Promise<StoredEndpoint | null>
  getEndpointByProviderIdentity(provider: string, realmId: string, providerUserId: string): Promise<StoredEndpoint | null>
  getAgent(agentId: string): Promise<StoredAgent | null>
  getAgentByInstallation(installationId: string): Promise<StoredAgent | null>
  getParticipant(userId: string): Promise<StoredParticipant | null>
  listEndpointsForUser(userId: string): Promise<StoredEndpoint[]>
  listAgentsForUser(userId: string): Promise<StoredAgent[]>
  getProjection(projectionId: string): Promise<StoredProjection | null>
  getProjectionByLocator(provider: string, realmId: string, containerId: string, topicId: string): Promise<StoredProjection | null>
  listProjectionsForOwner(userId: string): Promise<StoredProjection[]>
  getManagedContainer(managedContainerId: string): Promise<StoredManagedContainer | null>
  getManagedContainerForOwner(ownerUserId: string, provider: string, realmId: string): Promise<StoredManagedContainer | null>
  listManagedContainersForOwner(ownerUserId: string): Promise<StoredManagedContainer[]>
  getProjectEndpointBinding(projectId: string): Promise<StoredProjectEndpointBinding | null>
  getProjectEndpointBindingById(projectEndpointBindingId: string): Promise<StoredProjectEndpointBinding | null>
  getProjectBindingByLocator(provider: string, realmId: string, containerId: string, topicId: string): Promise<StoredProjectEndpointBinding | null>
  getProjectInputByProviderMessage(endpointId: string, providerMessageId: string): Promise<StoredProjectInput | null>
  getHumanRequest(humanRequestId: string): Promise<StoredHumanRequest | null>
  getHumanAnswerForRequest(humanRequestId: string): Promise<StoredHumanAnswer | null>
  getProject(projectId: string): Promise<StoredProject | null>
  listActiveProjectsForCoordinator(agentId: string): Promise<StoredProject[]>
  getProjectMember(projectId: string, userId: string): Promise<StoredProjectMember | null>
  listProjectMembers(projectId: string): Promise<StoredProjectMember[]>
  countProjectTasks(projectId: string, coordinationRound?: number): Promise<number>
  listOpenTasksForAgent(agentId: string): Promise<StoredTask[]>
  getTask(taskId: string): Promise<StoredTask | null>
  getProjectRecord(projectRecordId: string): Promise<StoredProjectRecord | null>
  listProjectRecords(projectId: string, acceptedOnly: boolean): Promise<StoredProjectRecord[]>
  getCredentialByDigest(tokenDigest: string): Promise<StoredCredential | null>
  getReceipt(actorKey: string, idempotencyKey: string): Promise<StoredReceipt | null>
  getReceiptById(receiptId: string): Promise<StoredReceipt | null>
  getInboxCursor(recipient: InboxRecipient): Promise<StoredInboxCursor | null>
  pullInbox(recipient: InboxRecipient, afterSequence: number, limit: number, now: string): Promise<StoredInboxMessage[]>
}

export interface CollaborationTransaction extends CollaborationReadRepository {
  lockIdempotency(actorKey: string, idempotencyKey: string): Promise<void>
  insertUser(user: StoredUser): Promise<void>
  updateUser(user: StoredUser, expectedRevision: number): Promise<void>
  insertChallenge(challenge: StoredChallenge): Promise<void>
  getChallenge(challengeId: string): Promise<StoredChallenge | null>
  getChallengeByCodeDigest(challengeDigest: string): Promise<StoredChallenge | null>
  getChallengeByPollDigest(pollSecretDigest: string): Promise<StoredChallenge | null>
  verifyChallenge(challengeId: string, userId: string, humanEndpointId: string, verifiedAt: string): Promise<boolean>
  consumeChallenge(challengeId: string, consumedAt: string): Promise<boolean>
  insertEndpoint(endpoint: StoredEndpoint): Promise<void>
  updateEndpoint(endpoint: StoredEndpoint, expectedRevision: number): Promise<void>
  insertAgent(agent: StoredAgent): Promise<void>
  updateAgent(agent: StoredAgent, expectedRevision: number): Promise<void>
  insertCredential(credential: StoredCredential): Promise<void>
  revokeCredentials(kind: StoredCredential['kind'], subjectId: string, revokedAt: string): Promise<number>
  upsertParticipant(participant: StoredParticipant, expectedRevision: number | null): Promise<void>
  insertProjection(projection: StoredProjection): Promise<void>
  updateProjection(projection: StoredProjection, expectedRevision: number): Promise<void>
  insertManagedContainer(container: StoredManagedContainer): Promise<void>
  updateManagedContainer(container: StoredManagedContainer, expectedRevision: number): Promise<void>
  insertManagedContainerJob(job: StoredManagedContainerJob): Promise<void>
  upsertProjectEndpointBinding(binding: StoredProjectEndpointBinding, expectedRevision: number | null): Promise<void>
  insertProjectInput(input: Omit<StoredProjectInput, 'sequence'>): Promise<StoredProjectInput>
  insertHumanRequest(request: StoredHumanRequest): Promise<void>
  updateHumanRequest(request: StoredHumanRequest, expectedRevision: number): Promise<void>
  insertHumanAnswer(answer: StoredHumanAnswer): Promise<void>
  insertProject(project: StoredProject, members: StoredProjectMember[]): Promise<void>
  updateProject(project: StoredProject, expectedRevision: number): Promise<void>
  insertTask(task: StoredTask): Promise<void>
  updateTask(task: StoredTask, expectedRevision: number): Promise<void>
  insertProjectRecord(record: StoredProjectRecord): Promise<void>
  updateProjectRecord(record: StoredProjectRecord, expectedRevision: number): Promise<void>
  appendInbox(message: Omit<StoredInboxMessage, 'sequence'>): Promise<StoredInboxMessage>
  ackInbox(recipient: InboxRecipient, throughSequence: number, updatedAt: string): Promise<StoredInboxCursor>
  insertReceipt(receipt: StoredReceipt): Promise<void>
  insertAudit(event: StoredAuditEvent): Promise<void>
}

export interface CollaborationRepository extends CollaborationReadRepository {
  transaction<T>(work: (tx: CollaborationTransaction) => Promise<T>): Promise<T>
  pruneExpired(now: string): Promise<{ inboxMessages: number; receipts: number; challenges: number }>
  claimManagedContainerJobs(workerId: string, now: string, leaseExpiresAt: string, limit: number): Promise<StoredManagedContainerJob[]>
  completeManagedContainerJob(input: {
    jobId: string
    workerId: string
    container: StoredManagedContainer
    expectedContainerRevision: number
    completedAt: string
  }): Promise<void>
  failManagedContainerJob(input: {
    jobId: string
    workerId: string
    safeErrorCode: string
    retryAt?: string
    failedAt: string
    container?: StoredManagedContainer
    expectedContainerRevision?: number
  }): Promise<void>
  close(): Promise<void>
}
