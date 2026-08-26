import type {
  EndpointChallengeRateConsumeResult,
  InboxRecipient,
  StoredAgent,
  StoredAuditEvent,
  StoredChallenge,
  StoredCredential,
  StoredDevice,
  StoredDeviceEnrollment,
  StoredEndpoint,
  StoredInboxCursor,
  StoredInboxMessage,
  StoredParticipant,
  StoredProject,
  StoredProjectContentSpaceBinding,
  StoredProjectEndpointBinding,
  StoredProjectInput,
  StoredProjectMember,
  StoredProjectRecord,
  StoredProjection,
  StoredReceipt,
  StoredTask,
  StoredCloudResourceRef,
  StoredUser,
  StoredHumanRequest,
  StoredHumanAnswer,
  StoredManagedContainer,
  StoredManagedContainerJob,
  StoredOidcIdentity,
  StoredRemoteCapabilityApproval,
  StoredEndpointChallengeRateWindow,
  StoredExternalOperationJournal,
  StoredVisibleRecoveryAction,
  StoredProjectContentProvisioningAttestation,
  StoredProjectContentProvisioningIntent,
  StoredProjectContentReadiness,
  StoredProjectFinalSummary,
  StoredProjectPlan,
  StoredProjectProviderMembershipObservation,
  StoredProviderDirectoryPrincipalFact,
  StoredTaskAuthority,
  StoredTaskExecution,
  StoredTaskOffer,
  StoredTaskResultReview,
  StoredTaskResultSubmission,
  StoredWorkerAvailability
} from './model.js'

export type ProviderDirectoryPrincipalFactListInput = Readonly<{
  userIds: readonly string[]
  providerInstance: StoredProviderDirectoryPrincipalFact['providerPrincipal']['providerInstance'] | null
  includeDegraded: boolean
  afterFactId: string | null
  limit: number
}>

export interface CollaborationReadRepository {
  getUser(userId: string): Promise<StoredUser | null>
  getOidcIdentity(identityId: string): Promise<StoredOidcIdentity | null>
  getOidcIdentityByIssuerSubject(issuer: string, subject: string): Promise<StoredOidcIdentity | null>
  getDeviceEnrollment(enrollmentId: string): Promise<StoredDeviceEnrollment | null>
  getDevice(deviceId: string): Promise<StoredDevice | null>
  getDeviceByInstallation(installationId: string): Promise<StoredDevice | null>
  listDevicesForUser(userId: string): Promise<StoredDevice[]>
  getChallenge(challengeId: string): Promise<StoredChallenge | null>
  getEndpointChallengeRateWindow(
    userId: string,
    provider: string,
    realmId: string,
    windowStartedAt: string
  ): Promise<StoredEndpointChallengeRateWindow | null>
  getEndpoint(humanEndpointId: string): Promise<StoredEndpoint | null>
  getEndpointByProviderIdentity(provider: string, realmId: string, providerUserId: string): Promise<StoredEndpoint | null>
  getAgent(agentId: string): Promise<StoredAgent | null>
  listAgentsForDevice(deviceId: string): Promise<StoredAgent[]>
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
  /** Stable HumanRequest ID seek page; callers pass their public page limit + 1. */
  listHumanRequestsByProject(
    projectId: string,
    status: StoredHumanRequest['status'] | null,
    afterHumanRequestId: string | null,
    limit: number
  ): Promise<StoredHumanRequest[]>
  getHumanAnswerForRequest(humanRequestId: string): Promise<StoredHumanAnswer | null>
  getRemoteApproval(remoteApprovalId: string): Promise<StoredRemoteCapabilityApproval | null>
  getRemoteApprovalByReferenceDigest(referenceDigest: string): Promise<StoredRemoteCapabilityApproval | null>
  listExpiredRemoteApprovals(now: string, limit: number): Promise<StoredRemoteCapabilityApproval[]>
  getProject(projectId: string): Promise<StoredProject | null>
  /**
   * Stable Project ID seek page. Owner and active/removal-pending Memberships
   * remain visible across terminal Project states; pending/removed fail closed.
   */
  listProjectsForUser(userId: string, afterProjectId: string | null, limit: number): Promise<StoredProject[]>
  getWorkerAvailability(agentId: string): Promise<StoredWorkerAvailability | null>
  listWorkerAvailabilityForUser(userId: string, now: string): Promise<StoredWorkerAvailability[]>
  listAvailableWorkers(now: string): Promise<StoredWorkerAvailability[]>
  getProjectContentSpaceBinding(projectId: string): Promise<StoredProjectContentSpaceBinding | null>
  getProviderDirectoryPrincipalFact(
    providerPrincipalFactId: string
  ): Promise<StoredProviderDirectoryPrincipalFact | null>
  getProviderDirectoryPrincipalFactForSlot(
    userId: string,
    providerInstance: StoredProviderDirectoryPrincipalFact['providerPrincipal']['providerInstance']
  ): Promise<StoredProviderDirectoryPrincipalFact | null>
  listProviderDirectoryPrincipalFacts(
    input: ProviderDirectoryPrincipalFactListInput
  ): Promise<StoredProviderDirectoryPrincipalFact[]>
  getProjectProviderMembershipObservation(
    providerObservationId: string
  ): Promise<StoredProjectProviderMembershipObservation | null>
  listProjectProviderMembershipObservations(
    projectId: string,
    userId?: string
  ): Promise<StoredProjectProviderMembershipObservation[]>
  getProjectContentReadiness(projectId: string, userId: string): Promise<StoredProjectContentReadiness | null>
  listProjectContentReadiness(projectId: string): Promise<StoredProjectContentReadiness[]>
  getTaskAuthority(
    projectId: string,
    userId: string,
    scope: StoredTaskAuthority['scope']
  ): Promise<StoredTaskAuthority | null>
  listTaskAuthorities(projectId: string): Promise<StoredTaskAuthority[]>
  listTaskAuthoritiesForUser(projectId: string, userId: string): Promise<StoredTaskAuthority[]>
  getProjectContentProvisioningIntent(
    provisioningIntentId: string
  ): Promise<StoredProjectContentProvisioningIntent | null>
  getLatestProjectContentProvisioningIntent(projectId: string): Promise<StoredProjectContentProvisioningIntent | null>
  listProjectContentProvisioningIntents(projectId: string): Promise<StoredProjectContentProvisioningIntent[]>
  getProjectContentProvisioningAttestation(
    provisioningAttestationId: string
  ): Promise<StoredProjectContentProvisioningAttestation | null>
  listProjectContentProvisioningAttestations(projectId: string): Promise<StoredProjectContentProvisioningAttestation[]>
  getExternalOperationJournal(logicalInvocationId: string): Promise<StoredExternalOperationJournal | null>
  getExternalOperationJournalById(journalEntryId: string): Promise<StoredExternalOperationJournal | null>
  listExternalOperationJournal(projectId: string): Promise<StoredExternalOperationJournal[]>
  getVisibleRecoveryAction(recoveryActionId: string): Promise<StoredVisibleRecoveryAction | null>
  listVisibleRecoveryActionsByProject(projectId: string): Promise<StoredVisibleRecoveryAction[]>
  getCloudResourceRef(resourceRefId: string): Promise<StoredCloudResourceRef | null>
  listCloudResourceRefs(taskId: string, executionId: string): Promise<StoredCloudResourceRef[]>
  listActiveProjectsForCoordinator(agentId: string): Promise<StoredProject[]>
  getProjectMember(projectId: string, userId: string): Promise<StoredProjectMember | null>
  listProjectMembers(projectId: string): Promise<StoredProjectMember[]>
  listActiveProjectMembersForUser(userId: string): Promise<StoredProjectMember[]>
  countProjectTasks(projectId: string, coordinationRound?: number): Promise<number>
  countOpenFileTasks(projectId: string): Promise<number>
  listOpenTasksForAgent(agentId: string): Promise<StoredTask[]>
  getTask(taskId: string): Promise<StoredTask | null>
  /** Stable Task ID seek page including terminal history; callers pass limit + 1. */
  listTasksByProject(projectId: string, afterTaskId: string | null, limit: number): Promise<StoredTask[]>
  getTaskExecution(executionId: string): Promise<StoredTaskExecution | null>
  /** Independent stable execution ID seek page including superseded/terminal attempts. */
  listTaskExecutionsByProject(
    projectId: string,
    afterExecutionId: string | null,
    limit: number
  ): Promise<StoredTaskExecution[]>
  listTaskExecutions(taskId: string): Promise<StoredTaskExecution[]>
  listCurrentTaskExecutionsForAgent(agentId: string): Promise<StoredTaskExecution[]>
  listCurrentTaskExecutionsForDevice(deviceId: string): Promise<StoredTaskExecution[]>
  listCurrentTaskExecutionsForUser(userId: string): Promise<StoredTaskExecution[]>
  getTaskOffer(taskOfferId: string): Promise<StoredTaskOffer | null>
  /** Stable Cloud-owned expiry scan. Desktop clients never report offer timeout. */
  listExpiredTaskOffers(now: string, limit: number): Promise<StoredTaskOffer[]>
  /** Independent stable TaskOffer ID seek page including terminal offers. */
  listTaskOffersByProject(
    projectId: string,
    afterTaskOfferId: string | null,
    limit: number
  ): Promise<StoredTaskOffer[]>
  listTaskOffers(executionId: string): Promise<StoredTaskOffer[]>
  getProjectPlan(projectPlanId: string): Promise<StoredProjectPlan | null>
  getCurrentProjectPlan(projectId: string): Promise<StoredProjectPlan | null>
  listProjectPlans(projectId: string): Promise<StoredProjectPlan[]>
  getTaskResultSubmission(resultSubmissionId: string): Promise<StoredTaskResultSubmission | null>
  /** Independent stable result-submission ID seek page including reviewed results. */
  listTaskResultSubmissionsByProject(
    projectId: string,
    afterResultSubmissionId: string | null,
    limit: number
  ): Promise<StoredTaskResultSubmission[]>
  listTaskResultSubmissions(taskId: string): Promise<StoredTaskResultSubmission[]>
  /** Independent stable review-decision ID seek page including all decisions. */
  listTaskResultReviewsByProject(
    projectId: string,
    afterReviewDecisionId: string | null,
    limit: number
  ): Promise<StoredTaskResultReview[]>
  listTaskResultReviews(resultSubmissionId: string): Promise<StoredTaskResultReview[]>
  listProjectFinalSummaries(projectId: string): Promise<StoredProjectFinalSummary[]>
  getProjectRecord(projectRecordId: string): Promise<StoredProjectRecord | null>
  listProjectRecords(projectId: string, acceptedOnly: boolean): Promise<StoredProjectRecord[]>
  getCredentialByDigest(tokenDigest: string): Promise<StoredCredential | null>
  getCredential(credentialId: string): Promise<StoredCredential | null>
  getReceipt(actorKey: string, idempotencyKey: string): Promise<StoredReceipt | null>
  getReceiptById(receiptId: string): Promise<StoredReceipt | null>
  getInboxCursor(recipient: InboxRecipient): Promise<StoredInboxCursor | null>
  pullInbox(recipient: InboxRecipient, afterSequence: number, limit: number, now: string): Promise<StoredInboxMessage[]>
}

export interface CollaborationTransaction extends CollaborationReadRepository {
  lockIdempotency(actorKey: string, idempotencyKey: string): Promise<void>
  lockOidcIdentity(issuer: string, subject: string): Promise<void>
  getUserForUpdate(userId: string): Promise<StoredUser | null>
  getOidcIdentityByIssuerSubjectForUpdate(issuer: string, subject: string): Promise<StoredOidcIdentity | null>
  getDeviceEnrollmentForUpdate(enrollmentId: string): Promise<StoredDeviceEnrollment | null>
  getDeviceForUpdate(deviceId: string): Promise<StoredDevice | null>
  getAgentForUpdate(agentId: string): Promise<StoredAgent | null>
  listAgentsForDeviceForUpdate(deviceId: string): Promise<StoredAgent[]>
  getWorkerAvailabilityForUpdate(agentId: string): Promise<StoredWorkerAvailability | null>
  listWorkerAvailabilityForDeviceForUpdate(deviceId: string): Promise<StoredWorkerAvailability[]>
  getProjectForUpdate(projectId: string): Promise<StoredProject | null>
  getTaskForUpdate(taskId: string): Promise<StoredTask | null>
  listCurrentTaskExecutionsForAgentForUpdate(agentId: string): Promise<StoredTaskExecution[]>
  listCurrentTaskExecutionsForDeviceForUpdate(deviceId: string): Promise<StoredTaskExecution[]>
  listCurrentTaskExecutionsForProjectUserForUpdate(
    projectId: string,
    userId: string
  ): Promise<StoredTaskExecution[]>
  listCurrentTaskExecutionsForProjectForUpdate(projectId: string): Promise<StoredTaskExecution[]>
  getProjectMemberForUpdate(projectId: string, userId: string): Promise<StoredProjectMember | null>
  getProjectContentSpaceBindingForUpdate(projectId: string): Promise<StoredProjectContentSpaceBinding | null>
  getProviderDirectoryPrincipalFactForUpdate(
    providerPrincipalFactId: string
  ): Promise<StoredProviderDirectoryPrincipalFact | null>
  getProviderDirectoryPrincipalFactForSlotForUpdate(
    userId: string,
    providerInstance: StoredProviderDirectoryPrincipalFact['providerPrincipal']['providerInstance']
  ): Promise<StoredProviderDirectoryPrincipalFact | null>
  getProjectContentReadinessForUpdate(projectId: string, userId: string): Promise<StoredProjectContentReadiness | null>
  getTaskAuthorityForUpdate(
    projectId: string,
    userId: string,
    scope: StoredTaskAuthority['scope']
  ): Promise<StoredTaskAuthority | null>
  listTaskAuthoritiesForUserForUpdate(projectId: string, userId: string): Promise<StoredTaskAuthority[]>
  getTaskExecutionForUpdate(executionId: string): Promise<StoredTaskExecution | null>
  getTaskOfferForUpdate(taskOfferId: string): Promise<StoredTaskOffer | null>
  getProjectContentProvisioningIntentForUpdate(
    provisioningIntentId: string
  ): Promise<StoredProjectContentProvisioningIntent | null>
  getExternalOperationJournalForUpdate(logicalInvocationId: string): Promise<StoredExternalOperationJournal | null>
  getExternalOperationJournalByIdForUpdate(journalEntryId: string): Promise<StoredExternalOperationJournal | null>
  getVisibleRecoveryActionForUpdate(recoveryActionId: string): Promise<StoredVisibleRecoveryAction | null>
  insertUser(user: StoredUser): Promise<void>
  updateUser(user: StoredUser, expectedRevision: number): Promise<void>
  insertOidcIdentity(identity: StoredOidcIdentity): Promise<void>
  insertDeviceEnrollment(enrollment: StoredDeviceEnrollment): Promise<void>
  consumeDeviceEnrollment(enrollmentId: string, consumedAt: string, expectedRevision: number): Promise<boolean>
  insertDevice(device: StoredDevice): Promise<void>
  updateDevice(device: StoredDevice, expectedRevision: number): Promise<void>
  insertChallenge(challenge: StoredChallenge): Promise<void>
  consumeEndpointChallengeRateWindow(input: {
    userId: string
    provider: string
    realmId: string
    windowStartedAt: string
    expiresAt: string
    maxAttempts: number
    updatedAt: string
  }): Promise<EndpointChallengeRateConsumeResult>
  getChallengeForUpdate(challengeId: string): Promise<StoredChallenge | null>
  getChallengeByCodeDigestForUpdate(challengeDigest: string): Promise<StoredChallenge | null>
  verifyChallenge(challengeId: string, userId: string, humanEndpointId: string, verifiedAt: string): Promise<boolean>
  insertEndpoint(endpoint: StoredEndpoint): Promise<void>
  updateEndpoint(endpoint: StoredEndpoint, expectedRevision: number): Promise<void>
  insertAgent(agent: StoredAgent): Promise<void>
  updateAgent(agent: StoredAgent, expectedRevision: number): Promise<void>
  insertCredential(credential: StoredCredential): Promise<void>
  revokeAgentCredentials(agentId: string, revokedAt: string): Promise<number>
  revokeAgentCredentialsForDevice(deviceId: string, revokedAt: string): Promise<number>
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
  insertRemoteApproval(approval: StoredRemoteCapabilityApproval): Promise<void>
  updateRemoteApproval(approval: StoredRemoteCapabilityApproval, expectedRevision: number): Promise<void>
  insertProject(project: StoredProject, members: StoredProjectMember[]): Promise<void>
  updateProject(project: StoredProject, expectedRevision: number): Promise<void>
  insertProjectMember(member: StoredProjectMember): Promise<void>
  updateProjectMember(member: StoredProjectMember, expectedRevision: number): Promise<void>
  upsertWorkerAvailability(availability: StoredWorkerAvailability, expectedRevision: number | null): Promise<void>
  insertProviderDirectoryPrincipalFact(fact: StoredProviderDirectoryPrincipalFact): Promise<void>
  updateProviderDirectoryPrincipalFact(
    fact: StoredProviderDirectoryPrincipalFact,
    expectedRevision: number
  ): Promise<void>
  insertProjectProviderMembershipObservation(observation: StoredProjectProviderMembershipObservation): Promise<void>
  upsertProjectContentReadiness(
    readiness: StoredProjectContentReadiness,
    expectedRevision: number | null
  ): Promise<void>
  upsertTaskAuthority(authority: StoredTaskAuthority, expectedRevision: number | null): Promise<void>
  insertProjectContentProvisioningIntent(intent: StoredProjectContentProvisioningIntent): Promise<void>
  updateProjectContentProvisioningIntent(
    intent: StoredProjectContentProvisioningIntent,
    expectedRevision: number
  ): Promise<void>
  insertProjectContentProvisioningAttestation(attestation: StoredProjectContentProvisioningAttestation): Promise<void>
  upsertProjectContentSpaceBinding(binding: StoredProjectContentSpaceBinding, expectedRevision: number | null): Promise<void>
  insertExternalOperationJournal(operation: StoredExternalOperationJournal): Promise<void>
  updateExternalOperationJournal(operation: StoredExternalOperationJournal, expectedRevision: number): Promise<void>
  insertVisibleRecoveryAction(action: StoredVisibleRecoveryAction): Promise<void>
  /** Only status/completedAt/revision/updatedAt may advance; all action facts stay immutable. */
  updateVisibleRecoveryAction(action: StoredVisibleRecoveryAction, expectedRevision: number): Promise<void>
  insertCloudResourceRefs(resources: StoredCloudResourceRef[]): Promise<void>
  invalidateCloudResourceRefs(taskId: string, executionId: string, invalidatedAt: string): Promise<number>
  invalidateCloudResourceRefsForBinding(projectId: string, bindingRevision: number, invalidatedAt: string): Promise<number>
  insertTask(task: StoredTask): Promise<void>
  updateTask(task: StoredTask, expectedRevision: number): Promise<void>
  insertTaskExecution(execution: StoredTaskExecution): Promise<void>
  /**
   * Service transitions must call this CAS write, insertAudit and appendInbox
   * in the same CollaborationTransaction so the lifecycle remains auditable.
   */
  updateTaskExecution(execution: StoredTaskExecution, expectedRevision: number): Promise<void>
  insertTaskOffer(offer: StoredTaskOffer): Promise<void>
  /** Same atomic audit/Inbox/receipt requirement as updateTaskExecution. */
  updateTaskOffer(offer: StoredTaskOffer, expectedRevision: number): Promise<void>
  insertProjectPlan(plan: StoredProjectPlan): Promise<void>
  updateProjectPlan(plan: StoredProjectPlan, expectedRevision: number): Promise<void>
  insertTaskResultSubmission(submission: StoredTaskResultSubmission): Promise<void>
  insertTaskResultReview(review: StoredTaskResultReview): Promise<void>
  insertProjectFinalSummary(summary: StoredProjectFinalSummary): Promise<void>
  insertProjectRecord(record: StoredProjectRecord): Promise<void>
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
    expectedAttemptCount: number
    container: StoredManagedContainer
    expectedContainerRevision: number
    completedAt: string
  }): Promise<void>
  failManagedContainerJob(input: {
    jobId: string
    workerId: string
    expectedAttemptCount: number
    safeErrorCode: string
    retryAt?: string
    failedAt: string
    container?: StoredManagedContainer
    expectedContainerRevision?: number
  }): Promise<void>
  close(): Promise<void>
}
