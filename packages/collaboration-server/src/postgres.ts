import { createRequire } from 'node:module'

import { CollaborationServiceError } from './errors.js'
import { newId, safeAuditMetadata } from './crypto.js'
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
  StoredPrivateContainerClaim,
  StoredPrivateContainerDiscovery,
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
import type {
  CollaborationReadRepository,
  CollaborationRepository,
  CollaborationTransaction,
  ProviderDirectoryPrincipalFactListInput
} from './repository.js'

type SqlRow = Record<string, unknown>
type QueryResult<T extends SqlRow = SqlRow> = { rows: T[]; rowCount: number | null }

export interface SqlConnection {
  query<T extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>
  release(): void
}

export interface SqlPool {
  query<T extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>
  connect(): Promise<SqlConnection>
  end(): Promise<void>
}

export type PostgresRepositoryOptions = {
  connectionString: string
  maxConnections?: number
  statementTimeoutMs?: number
}

export function createPostgresPool(options: PostgresRepositoryOptions): SqlPool {
  const require = createRequire(import.meta.url)
  const postgres = require('pg') as {
    Pool: new (config: Record<string, unknown>) => SqlPool
  }
  return new postgres.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'sciforge-collaboration-server'
  })
}

export class PostgresCollaborationRepository implements CollaborationRepository {
  constructor(private readonly pool: SqlPool) {}

  async transaction<T>(work: (tx: CollaborationTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const result = await work(new PostgresTransaction(connection))
      await connection.query('COMMIT')
      return result
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined)
      throw translateDatabaseError(error)
    } finally {
      connection.release()
    }
  }

  async pruneExpired(now: string): Promise<{ inboxMessages: number; receipts: number; challenges: number }> {
    return this.transaction(async (tx) => {
      const sql = (tx as PostgresTransaction).sql
      const inbox = await sql.query(
        `DELETE FROM sciforge_collaboration.inbox_messages WHERE expires_at < $1`,
        [now]
      )
      const receipts = await sql.query(
        `DELETE FROM sciforge_collaboration.receipts WHERE expires_at < $1`,
        [now]
      )
      const challenges = await sql.query(
        `DELETE FROM sciforge_collaboration.human_endpoint_challenges
         WHERE expires_at < $1`,
        [now]
      )
      return {
        inboxMessages: inbox.rowCount ?? 0,
        receipts: receipts.rowCount ?? 0,
        challenges: challenges.rowCount ?? 0
      }
    })
  }

  close(): Promise<void> {
    return this.pool.end()
  }

  private read(): PostgresReadRepository {
    return new PostgresReadRepository(this.pool)
  }

  getUser(userId: string): Promise<StoredUser | null> { return this.read().getUser(userId) }
  getOidcIdentity(identityId: string): Promise<StoredOidcIdentity | null> { return this.read().getOidcIdentity(identityId) }
  getOidcIdentityByIssuerSubject(issuer: string, subject: string): Promise<StoredOidcIdentity | null> {
    return this.read().getOidcIdentityByIssuerSubject(issuer, subject)
  }
  getDeviceEnrollment(enrollmentId: string): Promise<StoredDeviceEnrollment | null> {
    return this.read().getDeviceEnrollment(enrollmentId)
  }
  getDevice(deviceId: string): Promise<StoredDevice | null> { return this.read().getDevice(deviceId) }
  getDeviceByInstallation(installationId: string): Promise<StoredDevice | null> {
    return this.read().getDeviceByInstallation(installationId)
  }
  listDevicesForUser(userId: string): Promise<StoredDevice[]> { return this.read().listDevicesForUser(userId) }
  getChallenge(challengeId: string): Promise<StoredChallenge | null> { return this.read().getChallenge(challengeId) }
  getEndpointChallengeRateWindow(
    userId: string,
    provider: string,
    realmId: string,
    windowStartedAt: string
  ): Promise<StoredEndpointChallengeRateWindow | null> {
    return this.read().getEndpointChallengeRateWindow(userId, provider, realmId, windowStartedAt)
  }
  getEndpoint(id: string): Promise<StoredEndpoint | null> { return this.read().getEndpoint(id) }
  getEndpointByProviderIdentity(provider: string, realmId: string, providerUserId: string): Promise<StoredEndpoint | null> {
    return this.read().getEndpointByProviderIdentity(provider, realmId, providerUserId)
  }
  getAgent(agentId: string): Promise<StoredAgent | null> { return this.read().getAgent(agentId) }
  listAgentsForDevice(deviceId: string): Promise<StoredAgent[]> { return this.read().listAgentsForDevice(deviceId) }
  getParticipant(userId: string): Promise<StoredParticipant | null> { return this.read().getParticipant(userId) }
  listEndpointsForUser(userId: string): Promise<StoredEndpoint[]> { return this.read().listEndpointsForUser(userId) }
  listAgentsForUser(userId: string): Promise<StoredAgent[]> { return this.read().listAgentsForUser(userId) }
  getProjection(id: string): Promise<StoredProjection | null> { return this.read().getProjection(id) }
  getProjectionByLocator(provider: string, realmId: string, containerId: string, topicId: string): Promise<StoredProjection | null> {
    return this.read().getProjectionByLocator(provider, realmId, containerId, topicId)
  }
  listProjectionsForOwner(userId: string): Promise<StoredProjection[]> { return this.read().listProjectionsForOwner(userId) }
  getManagedContainer(id: string): Promise<StoredManagedContainer | null> { return this.read().getManagedContainer(id) }
  getManagedContainerForOwner(ownerUserId: string, provider: string, realmId: string, installationId: string): Promise<StoredManagedContainer | null> {
    return this.read().getManagedContainerForOwner(ownerUserId, provider, realmId, installationId)
  }
  listManagedContainersForOwner(ownerUserId: string): Promise<StoredManagedContainer[]> {
    return this.read().listManagedContainersForOwner(ownerUserId)
  }
  getPrivateContainerDiscovery(ownerUserId: string, humanEndpointId: string, installationId: string, provider: string, realmId: string, externalContainerId: string): Promise<StoredPrivateContainerDiscovery | null> {
    return this.read().getPrivateContainerDiscovery(ownerUserId, humanEndpointId, installationId, provider, realmId, externalContainerId)
  }
  getPrivateContainerClaim(provider: string, realmId: string, externalContainerId: string): Promise<StoredPrivateContainerClaim | null> {
    return this.read().getPrivateContainerClaim(provider, realmId, externalContainerId)
  }
  getProjectEndpointBinding(projectId: string): Promise<StoredProjectEndpointBinding | null> { return this.read().getProjectEndpointBinding(projectId) }
  getProjectEndpointBindingById(id: string): Promise<StoredProjectEndpointBinding | null> {
    return this.read().getProjectEndpointBindingById(id)
  }
  getProjectBindingByLocator(provider: string, realmId: string, containerId: string, topicId: string): Promise<StoredProjectEndpointBinding | null> {
    return this.read().getProjectBindingByLocator(provider, realmId, containerId, topicId)
  }
  getProjectInputByProviderMessage(endpointId: string, messageId: string): Promise<StoredProjectInput | null> {
    return this.read().getProjectInputByProviderMessage(endpointId, messageId)
  }
  getHumanRequest(id: string): Promise<StoredHumanRequest | null> { return this.read().getHumanRequest(id) }
  listHumanRequestsByProject(
    projectId: string,
    status: StoredHumanRequest['status'] | null,
    afterHumanRequestId: string | null,
    limit: number
  ): Promise<StoredHumanRequest[]> {
    return this.read().listHumanRequestsByProject(projectId, status, afterHumanRequestId, limit)
  }
  getHumanAnswerForRequest(id: string): Promise<StoredHumanAnswer | null> { return this.read().getHumanAnswerForRequest(id) }
  getRemoteApproval(id: string): Promise<StoredRemoteCapabilityApproval | null> { return this.read().getRemoteApproval(id) }
  getRemoteApprovalByReferenceDigest(digest: string): Promise<StoredRemoteCapabilityApproval | null> {
    return this.read().getRemoteApprovalByReferenceDigest(digest)
  }
  getRemoteApprovalByProviderMessage(provider: string, realmId: string, providerMessageId: string): Promise<StoredRemoteCapabilityApproval | null> {
    return this.read().getRemoteApprovalByProviderMessage(provider, realmId, providerMessageId)
  }
  listExpiredRemoteApprovals(now: string, limit: number): Promise<StoredRemoteCapabilityApproval[]> {
    return this.read().listExpiredRemoteApprovals(now, limit)
  }
  getProject(projectId: string): Promise<StoredProject | null> { return this.read().getProject(projectId) }
  listProjectsForUser(userId: string, afterProjectId: string | null, limit: number): Promise<StoredProject[]> {
    return this.read().listProjectsForUser(userId, afterProjectId, limit)
  }
  getWorkerAvailability(agentId: string): Promise<StoredWorkerAvailability | null> {
    return this.read().getWorkerAvailability(agentId)
  }
  listWorkerAvailabilityForUser(userId: string, now: string): Promise<StoredWorkerAvailability[]> {
    return this.read().listWorkerAvailabilityForUser(userId, now)
  }
  listAvailableWorkers(now: string): Promise<StoredWorkerAvailability[]> {
    return this.read().listAvailableWorkers(now)
  }
  getProjectContentSpaceBinding(projectId: string): Promise<StoredProjectContentSpaceBinding | null> {
    return this.read().getProjectContentSpaceBinding(projectId)
  }
  getProviderDirectoryPrincipalFact(id: string): Promise<StoredProviderDirectoryPrincipalFact | null> {
    return this.read().getProviderDirectoryPrincipalFact(id)
  }
  getProviderDirectoryPrincipalFactForSlot(
    userId: string,
    providerInstance: StoredProviderDirectoryPrincipalFact['providerPrincipal']['providerInstance']
  ): Promise<StoredProviderDirectoryPrincipalFact | null> {
    return this.read().getProviderDirectoryPrincipalFactForSlot(userId, providerInstance)
  }
  listProviderDirectoryPrincipalFacts(
    input: ProviderDirectoryPrincipalFactListInput
  ): Promise<StoredProviderDirectoryPrincipalFact[]> {
    return this.read().listProviderDirectoryPrincipalFacts(input)
  }
  getProjectProviderMembershipObservation(id: string): Promise<StoredProjectProviderMembershipObservation | null> {
    return this.read().getProjectProviderMembershipObservation(id)
  }
  listProjectProviderMembershipObservations(
    projectId: string,
    userId?: string
  ): Promise<StoredProjectProviderMembershipObservation[]> {
    return this.read().listProjectProviderMembershipObservations(projectId, userId)
  }
  getProjectContentReadiness(projectId: string, userId: string): Promise<StoredProjectContentReadiness | null> {
    return this.read().getProjectContentReadiness(projectId, userId)
  }
  listProjectContentReadiness(projectId: string): Promise<StoredProjectContentReadiness[]> {
    return this.read().listProjectContentReadiness(projectId)
  }
  getTaskAuthority(
    projectId: string,
    userId: string,
    scope: StoredTaskAuthority['scope']
  ): Promise<StoredTaskAuthority | null> {
    return this.read().getTaskAuthority(projectId, userId, scope)
  }
  listTaskAuthorities(projectId: string): Promise<StoredTaskAuthority[]> {
    return this.read().listTaskAuthorities(projectId)
  }
  listTaskAuthoritiesForUser(projectId: string, userId: string): Promise<StoredTaskAuthority[]> {
    return this.read().listTaskAuthoritiesForUser(projectId, userId)
  }
  getProjectContentProvisioningIntent(id: string): Promise<StoredProjectContentProvisioningIntent | null> {
    return this.read().getProjectContentProvisioningIntent(id)
  }
  getLatestProjectContentProvisioningIntent(projectId: string): Promise<StoredProjectContentProvisioningIntent | null> {
    return this.read().getLatestProjectContentProvisioningIntent(projectId)
  }
  listProjectContentProvisioningIntents(projectId: string): Promise<StoredProjectContentProvisioningIntent[]> {
    return this.read().listProjectContentProvisioningIntents(projectId)
  }
  getProjectContentProvisioningAttestation(id: string): Promise<StoredProjectContentProvisioningAttestation | null> {
    return this.read().getProjectContentProvisioningAttestation(id)
  }
  listProjectContentProvisioningAttestations(projectId: string): Promise<StoredProjectContentProvisioningAttestation[]> {
    return this.read().listProjectContentProvisioningAttestations(projectId)
  }
  getExternalOperationJournal(logicalInvocationId: string): Promise<StoredExternalOperationJournal | null> {
    return this.read().getExternalOperationJournal(logicalInvocationId)
  }
  getExternalOperationJournalById(journalEntryId: string): Promise<StoredExternalOperationJournal | null> {
    return this.read().getExternalOperationJournalById(journalEntryId)
  }
  listExternalOperationJournal(projectId: string): Promise<StoredExternalOperationJournal[]> {
    return this.read().listExternalOperationJournal(projectId)
  }
  getVisibleRecoveryAction(recoveryActionId: string): Promise<StoredVisibleRecoveryAction | null> {
    return this.read().getVisibleRecoveryAction(recoveryActionId)
  }
  listVisibleRecoveryActionsByProject(projectId: string): Promise<StoredVisibleRecoveryAction[]> {
    return this.read().listVisibleRecoveryActionsByProject(projectId)
  }
  getCloudResourceRef(resourceRefId: string): Promise<StoredCloudResourceRef | null> {
    return this.read().getCloudResourceRef(resourceRefId)
  }
  listCloudResourceRefs(taskId: string, executionId: string): Promise<StoredCloudResourceRef[]> {
    return this.read().listCloudResourceRefs(taskId, executionId)
  }
  listActiveProjectsForCoordinator(agentId: string): Promise<StoredProject[]> {
    return this.read().listActiveProjectsForCoordinator(agentId)
  }
  getProjectMember(projectId: string, userId: string): Promise<StoredProjectMember | null> {
    return this.read().getProjectMember(projectId, userId)
  }
  listProjectMembers(projectId: string): Promise<StoredProjectMember[]> { return this.read().listProjectMembers(projectId) }
  listActiveProjectMembersForUser(userId: string): Promise<StoredProjectMember[]> {
    return this.read().listActiveProjectMembersForUser(userId)
  }
  countProjectTasks(projectId: string, round?: number): Promise<number> { return this.read().countProjectTasks(projectId, round) }
  countOpenFileTasks(projectId: string): Promise<number> { return this.read().countOpenFileTasks(projectId) }
  listOpenTasksForAgent(agentId: string): Promise<StoredTask[]> { return this.read().listOpenTasksForAgent(agentId) }
  getTask(taskId: string): Promise<StoredTask | null> { return this.read().getTask(taskId) }
  listTasksByProject(projectId: string, afterTaskId: string | null, limit: number): Promise<StoredTask[]> {
    return this.read().listTasksByProject(projectId, afterTaskId, limit)
  }
  getTaskExecution(executionId: string): Promise<StoredTaskExecution | null> {
    return this.read().getTaskExecution(executionId)
  }
  listTaskExecutionsByProject(
    projectId: string,
    afterExecutionId: string | null,
    limit: number
  ): Promise<StoredTaskExecution[]> {
    return this.read().listTaskExecutionsByProject(projectId, afterExecutionId, limit)
  }
  listTaskExecutions(taskId: string): Promise<StoredTaskExecution[]> { return this.read().listTaskExecutions(taskId) }
  listCurrentTaskExecutionsForAgent(agentId: string): Promise<StoredTaskExecution[]> {
    return this.read().listCurrentTaskExecutionsForAgent(agentId)
  }
  listCurrentTaskExecutionsForDevice(deviceId: string): Promise<StoredTaskExecution[]> {
    return this.read().listCurrentTaskExecutionsForDevice(deviceId)
  }
  listCurrentTaskExecutionsForUser(userId: string): Promise<StoredTaskExecution[]> {
    return this.read().listCurrentTaskExecutionsForUser(userId)
  }
  getTaskOffer(taskOfferId: string): Promise<StoredTaskOffer | null> {
    return this.read().getTaskOffer(taskOfferId)
  }
  listExpiredTaskOffers(now: string, limit: number): Promise<StoredTaskOffer[]> {
    return this.read().listExpiredTaskOffers(now, limit)
  }
  listTaskOffersByProject(
    projectId: string,
    afterTaskOfferId: string | null,
    limit: number
  ): Promise<StoredTaskOffer[]> {
    return this.read().listTaskOffersByProject(projectId, afterTaskOfferId, limit)
  }
  listTaskOffers(executionId: string): Promise<StoredTaskOffer[]> {
    return this.read().listTaskOffers(executionId)
  }
  getProjectPlan(projectPlanId: string): Promise<StoredProjectPlan | null> {
    return this.read().getProjectPlan(projectPlanId)
  }
  getCurrentProjectPlan(projectId: string): Promise<StoredProjectPlan | null> {
    return this.read().getCurrentProjectPlan(projectId)
  }
  listProjectPlans(projectId: string): Promise<StoredProjectPlan[]> { return this.read().listProjectPlans(projectId) }
  getTaskResultSubmission(resultSubmissionId: string): Promise<StoredTaskResultSubmission | null> {
    return this.read().getTaskResultSubmission(resultSubmissionId)
  }
  listTaskResultSubmissionsByProject(
    projectId: string,
    afterResultSubmissionId: string | null,
    limit: number
  ): Promise<StoredTaskResultSubmission[]> {
    return this.read().listTaskResultSubmissionsByProject(projectId, afterResultSubmissionId, limit)
  }
  listTaskResultSubmissions(taskId: string): Promise<StoredTaskResultSubmission[]> {
    return this.read().listTaskResultSubmissions(taskId)
  }
  listTaskResultReviewsByProject(
    projectId: string,
    afterReviewDecisionId: string | null,
    limit: number
  ): Promise<StoredTaskResultReview[]> {
    return this.read().listTaskResultReviewsByProject(projectId, afterReviewDecisionId, limit)
  }
  listTaskResultReviews(resultSubmissionId: string): Promise<StoredTaskResultReview[]> {
    return this.read().listTaskResultReviews(resultSubmissionId)
  }
  listProjectFinalSummaries(projectId: string): Promise<StoredProjectFinalSummary[]> {
    return this.read().listProjectFinalSummaries(projectId)
  }
  getProjectRecord(id: string): Promise<StoredProjectRecord | null> { return this.read().getProjectRecord(id) }
  listProjectRecords(projectId: string, acceptedOnly: boolean): Promise<StoredProjectRecord[]> {
    return this.read().listProjectRecords(projectId, acceptedOnly)
  }
  getCredentialByDigest(digest: string): Promise<StoredCredential | null> { return this.read().getCredentialByDigest(digest) }
  getCredential(credentialId: string): Promise<StoredCredential | null> { return this.read().getCredential(credentialId) }
  getReceipt(actorKey: string, key: string): Promise<StoredReceipt | null> { return this.read().getReceipt(actorKey, key) }
  getReceiptById(receiptId: string): Promise<StoredReceipt | null> { return this.read().getReceiptById(receiptId) }
  getInboxCursor(recipient: InboxRecipient): Promise<StoredInboxCursor | null> { return this.read().getInboxCursor(recipient) }
  pullInbox(recipient: InboxRecipient, after: number, limit: number, now: string): Promise<StoredInboxMessage[]> {
    return this.read().pullInbox(recipient, after, limit, now)
  }

  async claimManagedContainerJobs(
    workerId: string,
    now: string,
    leaseExpiresAt: string,
    limit: number
  ): Promise<StoredManagedContainerJob[]> {
    return this.transaction(async (tx) => {
      const sql = (tx as PostgresTransaction).sql
      const result = await sql.query(
        `WITH candidates AS (
           SELECT job_id
           FROM sciforge_collaboration.managed_provider_container_jobs
           WHERE state IN ('queued', 'retry_wait', 'running')
             AND next_attempt_at <= $2
             AND (state <> 'running' OR lease_expires_at <= $2)
           ORDER BY next_attempt_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $4
         )
         UPDATE sciforge_collaboration.managed_provider_container_jobs AS jobs
         SET state = 'running', lease_owner = $1, lease_expires_at = $3,
             attempt_count = jobs.attempt_count + 1, updated_at = $2
         FROM candidates
         WHERE jobs.job_id = candidates.job_id
         RETURNING jobs.*`,
        [workerId, now, leaseExpiresAt, limit]
      )
      return result.rows.map(mapManagedContainerJob)
    })
  }

  async completeManagedContainerJob(input: {
    jobId: string
    workerId: string
    expectedAttemptCount: number
    container: StoredManagedContainer
    expectedContainerRevision: number
    completedAt: string
  }): Promise<void> {
    await this.transaction(async (tx) => {
      await tx.updateManagedContainer(input.container, input.expectedContainerRevision)
      const sql = (tx as PostgresTransaction).sql
      const result = await sql.query(
        `UPDATE sciforge_collaboration.managed_provider_container_jobs
         SET state = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
             safe_error_code = NULL, updated_at = $3
         WHERE job_id = $1 AND state = 'running' AND lease_owner = $2 AND attempt_count = $4`,
        [input.jobId, input.workerId, input.completedAt, input.expectedAttemptCount]
      )
      if (result.rowCount !== 1) throw new CollaborationServiceError('revision_conflict', 'Managed container job lease was lost.')
      await tx.insertAudit({
        auditEventId: newId('audit'), actorKind: 'system', action: 'managed_container.job.succeeded',
        resourceKind: 'managed_provider_container', resourceId: input.container.managedContainerId,
        outcome: 'accepted', metadata: safeAuditMetadata({ jobId: input.jobId }), createdAt: input.completedAt
      })
    })
  }

  async failManagedContainerJob(input: {
    jobId: string
    workerId: string
    expectedAttemptCount: number
    safeErrorCode: string
    retryAt?: string
    failedAt: string
    container?: StoredManagedContainer
    expectedContainerRevision?: number
  }): Promise<void> {
    await this.transaction(async (tx) => {
      if (input.container && input.expectedContainerRevision !== undefined) {
        await tx.updateManagedContainer(input.container, input.expectedContainerRevision)
      }
      const sql = (tx as PostgresTransaction).sql
      const result = await sql.query(
        `UPDATE sciforge_collaboration.managed_provider_container_jobs
         SET state = $3, next_attempt_at = COALESCE($4, next_attempt_at),
             lease_owner = NULL, lease_expires_at = NULL, safe_error_code = $5, updated_at = $6
         WHERE job_id = $1 AND state = 'running' AND lease_owner = $2 AND attempt_count = $7`,
        [input.jobId, input.workerId, input.retryAt ? 'retry_wait' : 'failed', input.retryAt ?? null,
          input.safeErrorCode, input.failedAt, input.expectedAttemptCount]
      )
      if (result.rowCount !== 1) throw new CollaborationServiceError('revision_conflict', 'Managed container job lease was lost.')
      await tx.insertAudit({
        auditEventId: newId('audit'), actorKind: 'system', action: input.retryAt
          ? 'managed_container.job.retry_scheduled'
          : 'managed_container.job.failed',
        resourceKind: 'managed_provider_container', resourceId: input.container?.managedContainerId,
        outcome: input.retryAt ? 'accepted' : 'rejected',
        metadata: safeAuditMetadata({ jobId: input.jobId, errorCode: input.safeErrorCode }),
        createdAt: input.failedAt
      })
    })
  }
}

class PostgresReadRepository implements CollaborationReadRepository {
  constructor(readonly sql: Pick<SqlPool, 'query'> | Pick<SqlConnection, 'query'>) {}

  async getUser(userId: string): Promise<StoredUser | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.user_principals WHERE user_id = $1`, [userId])
    return result.rows[0] ? mapUser(result.rows[0]) : null
  }

  async getOidcIdentity(identityId: string): Promise<StoredOidcIdentity | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.oidc_identities WHERE identity_id=$1`, [identityId]
    )
    return result.rows[0] ? mapOidcIdentity(result.rows[0]) : null
  }

  async getOidcIdentityByIssuerSubject(issuer: string, subject: string): Promise<StoredOidcIdentity | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.oidc_identities WHERE issuer=$1 AND subject=$2`, [issuer, subject]
    )
    return result.rows[0] ? mapOidcIdentity(result.rows[0]) : null
  }

  async getDeviceEnrollment(enrollmentId: string): Promise<StoredDeviceEnrollment | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.device_enrollments WHERE enrollment_id=$1`, [enrollmentId]
    )
    return result.rows[0] ? mapDeviceEnrollment(result.rows[0]) : null
  }

  async getDevice(deviceId: string): Promise<StoredDevice | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.devices WHERE device_id=$1`, [deviceId])
    return result.rows[0] ? mapDevice(result.rows[0]) : null
  }

  async getDeviceByInstallation(installationId: string): Promise<StoredDevice | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.devices WHERE installation_id=$1`, [installationId]
    )
    return result.rows[0] ? mapDevice(result.rows[0]) : null
  }

  async listDevicesForUser(userId: string): Promise<StoredDevice[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.devices WHERE user_id=$1 ORDER BY created_at,device_id`, [userId]
    )
    return result.rows.map(mapDevice)
  }

  async getChallenge(challengeId: string): Promise<StoredChallenge | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.human_endpoint_challenges WHERE challenge_id=$1`, [challengeId]
    )
    return result.rows[0] ? mapChallenge(result.rows[0]) : null
  }

  async getEndpointChallengeRateWindow(
    userId: string,
    provider: string,
    realmId: string,
    windowStartedAt: string
  ): Promise<StoredEndpointChallengeRateWindow | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.endpoint_challenge_rate_windows
       WHERE user_id=$1 AND provider=$2 AND realm_id=$3 AND window_started_at=$4`,
      [userId, provider, realmId, windowStartedAt]
    )
    return result.rows[0] ? mapEndpointChallengeRateWindow(result.rows[0]) : null
  }

  async getEndpoint(humanEndpointId: string): Promise<StoredEndpoint | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.human_endpoint_bindings WHERE human_endpoint_id = $1`, [humanEndpointId])
    return result.rows[0] ? mapEndpoint(result.rows[0]) : null
  }

  async getEndpointByProviderIdentity(provider: string, realmId: string, providerUserId: string): Promise<StoredEndpoint | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.human_endpoint_bindings
       WHERE provider = $1 AND realm_id = $2 AND provider_user_id = $3`,
      [provider, realmId, providerUserId]
    )
    return result.rows[0] ? mapEndpoint(result.rows[0]) : null
  }

  async getAgent(agentId: string): Promise<StoredAgent | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.agent_nodes WHERE agent_id = $1`, [agentId])
    return result.rows[0] ? mapAgent(result.rows[0]) : null
  }

  async getParticipant(userId: string): Promise<StoredParticipant | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.participant_profiles WHERE user_id = $1`, [userId])
    return result.rows[0] ? mapParticipant(result.rows[0]) : null
  }

  async listEndpointsForUser(userId: string): Promise<StoredEndpoint[]> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.human_endpoint_bindings WHERE user_id=$1 ORDER BY verified_at,human_endpoint_id`, [userId])
    return result.rows.map(mapEndpoint)
  }

  async listAgentsForUser(userId: string): Promise<StoredAgent[]> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.agent_nodes WHERE owner_user_id=$1 ORDER BY updated_at,agent_id`, [userId])
    return result.rows.map(mapAgent)
  }

  async listAgentsForDevice(deviceId: string): Promise<StoredAgent[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.agent_nodes WHERE device_id=$1 ORDER BY updated_at,agent_id`, [deviceId]
    )
    return result.rows.map(mapAgent)
  }

  async getProjection(projectionId: string): Promise<StoredProjection | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.remote_session_projections WHERE projection_id=$1`, [projectionId])
    return result.rows[0] ? mapProjection(result.rows[0]) : null
  }

  async getProjectionByLocator(provider: string, realmId: string, containerId: string, topicId: string): Promise<StoredProjection | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.remote_session_projections
       WHERE locator->>'provider'=$1 AND locator->>'realmId'=$2 AND locator->>'containerId'=$3 AND locator->>'topicId'=$4`,
      [provider, realmId, containerId, topicId]
    )
    return result.rows[0] ? mapProjection(result.rows[0]) : null
  }

  async listProjectionsForOwner(userId: string): Promise<StoredProjection[]> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.remote_session_projections WHERE owner_user_id=$1 ORDER BY created_at,projection_id`, [userId])
    return result.rows.map(mapProjection)
  }

  async getManagedContainer(managedContainerId: string): Promise<StoredManagedContainer | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.managed_provider_containers WHERE managed_container_id=$1`,
      [managedContainerId]
    )
    return result.rows[0] ? mapManagedContainer(result.rows[0]) : null
  }

  async getManagedContainerForOwner(
    ownerUserId: string,
    provider: string,
    realmId: string,
    installationId: string
  ): Promise<StoredManagedContainer | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.managed_provider_containers
       WHERE owner_user_id=$1 AND provider=$2 AND realm_id=$3 AND installation_id=$4`,
      [ownerUserId, provider, realmId, installationId]
    )
    return result.rows[0] ? mapManagedContainer(result.rows[0]) : null
  }

  async listManagedContainersForOwner(ownerUserId: string): Promise<StoredManagedContainer[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.managed_provider_containers
       WHERE owner_user_id=$1 ORDER BY created_at,managed_container_id`,
      [ownerUserId]
    )
    return result.rows.map(mapManagedContainer)
  }

  async getPrivateContainerDiscovery(ownerUserId: string, humanEndpointId: string, installationId: string, provider: string, realmId: string, externalContainerId: string): Promise<StoredPrivateContainerDiscovery | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.provider_private_container_discoveries
       WHERE owner_user_id=$1 AND human_endpoint_id=$2 AND installation_id=$3
         AND provider=$4 AND realm_id=$5 AND external_container_id=$6`,
      [ownerUserId, humanEndpointId, installationId, provider, realmId, externalContainerId]
    )
    return result.rows[0] ? mapPrivateContainerDiscovery(result.rows[0]) : null
  }

  async getPrivateContainerClaim(provider: string, realmId: string, externalContainerId: string): Promise<StoredPrivateContainerClaim | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.provider_private_container_claims
       WHERE provider=$1 AND realm_id=$2 AND external_container_id=$3`,
      [provider, realmId, externalContainerId]
    )
    return result.rows[0] ? mapPrivateContainerClaim(result.rows[0]) : null
  }

  async getProjectBindingByLocator(provider: string, realmId: string, containerId: string, topicId: string): Promise<StoredProjectEndpointBinding | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_endpoint_bindings
       WHERE locator->>'provider'=$1 AND locator->>'realmId'=$2 AND locator->>'containerId'=$3 AND locator->>'topicId'=$4`,
      [provider, realmId, containerId, topicId]
    )
    return result.rows[0] ? mapProjectBinding(result.rows[0]) : null
  }

  async getProjectEndpointBinding(projectId: string): Promise<StoredProjectEndpointBinding | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.project_endpoint_bindings WHERE project_id=$1`, [projectId])
    return result.rows[0] ? mapProjectBinding(result.rows[0]) : null
  }

  async getProjectEndpointBindingById(projectEndpointBindingId: string): Promise<StoredProjectEndpointBinding | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_endpoint_bindings WHERE project_endpoint_binding_id=$1`,
      [projectEndpointBindingId]
    )
    return result.rows[0] ? mapProjectBinding(result.rows[0]) : null
  }

  async getProjectInputByProviderMessage(endpointId: string, providerMessageId: string): Promise<StoredProjectInput | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_inputs WHERE source_human_endpoint_id=$1 AND provider_message_id=$2`,
      [endpointId, providerMessageId]
    )
    return result.rows[0] ? mapProjectInput(result.rows[0]) : null
  }

  async getHumanRequest(humanRequestId: string): Promise<StoredHumanRequest | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.human_requests WHERE human_request_id=$1`, [humanRequestId])
    return result.rows[0] ? mapHumanRequest(result.rows[0]) : null
  }

  async listHumanRequestsByProject(
    projectId: string,
    status: StoredHumanRequest['status'] | null,
    afterHumanRequestId: string | null,
    limit: number
  ): Promise<StoredHumanRequest[]> {
    const result = status === null
      ? await this.sql.query(
        `SELECT * FROM sciforge_collaboration.human_requests
         WHERE project_id=$1 AND human_request_id>COALESCE($2::text,'')
         ORDER BY human_request_id ASC LIMIT $3`, [projectId, afterHumanRequestId, limit]
      )
      : await this.sql.query(
        `SELECT * FROM sciforge_collaboration.human_requests
         WHERE project_id=$1 AND status=$2 AND human_request_id>COALESCE($3::text,'')
         ORDER BY human_request_id ASC LIMIT $4`, [projectId, status, afterHumanRequestId, limit]
      )
    return result.rows.map(mapHumanRequest)
  }

  async getHumanAnswerForRequest(humanRequestId: string): Promise<StoredHumanAnswer | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.human_answers WHERE human_request_id=$1`, [humanRequestId])
    return result.rows[0] ? mapHumanAnswer(result.rows[0]) : null
  }

  async getRemoteApproval(remoteApprovalId: string): Promise<StoredRemoteCapabilityApproval | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.remote_capability_approvals WHERE remote_approval_id=$1`,
      [remoteApprovalId]
    )
    return result.rows[0] ? mapRemoteApproval(result.rows[0]) : null
  }

  async getRemoteApprovalByReferenceDigest(referenceDigest: string): Promise<StoredRemoteCapabilityApproval | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.remote_capability_approvals WHERE reference_digest=$1`,
      [referenceDigest]
    )
    return result.rows[0] ? mapRemoteApproval(result.rows[0]) : null
  }

  async getRemoteApprovalByProviderMessage(provider: string, realmId: string, providerMessageId: string): Promise<StoredRemoteCapabilityApproval | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.remote_capability_approvals
       WHERE locator->>'provider'=$1 AND locator->>'realmId'=$2 AND provider_card_message_id=$3`,
      [provider, realmId, providerMessageId]
    )
    return result.rows[0] ? mapRemoteApproval(result.rows[0]) : null
  }

  async listExpiredRemoteApprovals(now: string, limit: number): Promise<StoredRemoteCapabilityApproval[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.remote_capability_approvals
       WHERE status='pending' AND expires_at <= $1
       ORDER BY expires_at, remote_approval_id LIMIT $2`,
      [now, limit]
    )
    return result.rows.map(mapRemoteApproval)
  }

  async getProject(projectId: string): Promise<StoredProject | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.projects WHERE project_id = $1`, [projectId])
    return result.rows[0] ? mapProject(result.rows[0]) : null
  }

  async listProjectsForUser(
    userId: string,
    afterProjectId: string | null,
    limit: number
  ): Promise<StoredProject[]> {
    const result = await this.sql.query(
      `WITH visible_project_ids AS (
         SELECT owned.project_id
         FROM sciforge_collaboration.projects AS owned
         WHERE owned.owner_user_id=$1 AND owned.project_id>COALESCE($2::text,'')
         UNION
         SELECT member.project_id
         FROM sciforge_collaboration.project_members AS member
         WHERE member.user_id=$1
           AND member.state IN ('invited','active','membership_removal_pending')
           AND member.project_id>COALESCE($2::text,'')
       )
       SELECT project.* FROM sciforge_collaboration.projects AS project
       JOIN visible_project_ids AS visible ON visible.project_id=project.project_id
       ORDER BY project.project_id ASC LIMIT $3`, [userId, afterProjectId, limit]
    )
    return result.rows.map(mapProject)
  }

  async getWorkerAvailability(agentId: string): Promise<StoredWorkerAvailability | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.worker_availability WHERE agent_id=$1`, [agentId]
    )
    return result.rows[0] ? mapWorkerAvailability(result.rows[0]) : null
  }

  async listWorkerAvailabilityForUser(userId: string, now: string): Promise<StoredWorkerAvailability[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.worker_availability
       WHERE user_id=$1 AND expires_at>$2 ORDER BY agent_id`, [userId, now]
    )
    return result.rows.map(mapWorkerAvailability)
  }

  async listAvailableWorkers(now: string): Promise<StoredWorkerAvailability[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.worker_availability
       WHERE expires_at>$1
         AND agent_active=true
         AND device_active=true
         AND connection_status='online'
         AND runtime_readiness='ready'
       ORDER BY user_id,agent_id`, [now]
    )
    return result.rows.map(mapWorkerAvailability)
  }

  async getProjectContentSpaceBinding(projectId: string): Promise<StoredProjectContentSpaceBinding | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_space_bindings WHERE project_id=$1`,
      [projectId]
    )
    return result.rows[0] ? mapProjectContentSpaceBinding(result.rows[0]) : null
  }

  async getProviderDirectoryPrincipalFact(
    providerPrincipalFactId: string
  ): Promise<StoredProviderDirectoryPrincipalFact | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.provider_directory_principal_facts
       WHERE provider_principal_fact_id=$1`, [providerPrincipalFactId]
    )
    return result.rows[0] ? mapProviderDirectoryPrincipalFact(result.rows[0]) : null
  }

  async getProviderDirectoryPrincipalFactForSlot(
    userId: string,
    providerInstance: StoredProviderDirectoryPrincipalFact['providerPrincipal']['providerInstance']
  ): Promise<StoredProviderDirectoryPrincipalFact | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.provider_directory_principal_facts
       WHERE user_id=$1
         AND provider_principal->'providerInstance'->>'providerInstanceRef'=$2`,
      [userId, providerInstance.providerInstanceRef]
    )
    return result.rows[0] ? mapProviderDirectoryPrincipalFact(result.rows[0]) : null
  }

  async listProviderDirectoryPrincipalFacts(
    input: ProviderDirectoryPrincipalFactListInput
  ): Promise<StoredProviderDirectoryPrincipalFact[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.provider_directory_principal_facts
       WHERE user_id=ANY($1::text[])
         AND ($2::text IS NULL OR provider_principal->'providerInstance'->>'providerInstanceRef'=$2)
         AND ($3::boolean OR readiness='ready')
         AND ($4::text IS NULL OR provider_principal_fact_id>$4)
       ORDER BY provider_principal_fact_id LIMIT $5`,
      [input.userIds, input.providerInstance?.providerInstanceRef ?? null,
        input.includeDegraded, input.afterFactId, input.limit]
    )
    return result.rows.map(mapProviderDirectoryPrincipalFact)
  }

  async getProjectProviderMembershipObservation(
    providerObservationId: string
  ): Promise<StoredProjectProviderMembershipObservation | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_provider_membership_observations
       WHERE provider_observation_id=$1`, [providerObservationId]
    )
    return result.rows[0] ? mapProjectProviderMembershipObservation(result.rows[0]) : null
  }

  async listProjectProviderMembershipObservations(
    projectId: string,
    userId?: string
  ): Promise<StoredProjectProviderMembershipObservation[]> {
    const result = await this.sql.query(
      userId === undefined
        ? `SELECT * FROM sciforge_collaboration.project_provider_membership_observations
           WHERE project_id=$1 ORDER BY observed_at,provider_observation_id`
        : `SELECT * FROM sciforge_collaboration.project_provider_membership_observations
           WHERE project_id=$1 AND user_id=$2 ORDER BY observed_at,provider_observation_id`,
      userId === undefined ? [projectId] : [projectId, userId]
    )
    return result.rows.map(mapProjectProviderMembershipObservation)
  }

  async getProjectContentReadiness(
    projectId: string,
    userId: string
  ): Promise<StoredProjectContentReadiness | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_readiness
       WHERE project_id=$1 AND user_id=$2`, [projectId, userId]
    )
    return result.rows[0] ? mapProjectContentReadiness(result.rows[0]) : null
  }

  async listProjectContentReadiness(projectId: string): Promise<StoredProjectContentReadiness[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_readiness
       WHERE project_id=$1 ORDER BY user_id`, [projectId]
    )
    return result.rows.map(mapProjectContentReadiness)
  }

  async getTaskAuthority(
    projectId: string,
    userId: string,
    scope: StoredTaskAuthority['scope']
  ): Promise<StoredTaskAuthority | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_authorities
       WHERE project_id=$1 AND user_id=$2 AND scope=$3`, [projectId, userId, scope]
    )
    return result.rows[0] ? mapTaskAuthority(result.rows[0]) : null
  }

  async listTaskAuthorities(projectId: string): Promise<StoredTaskAuthority[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_authorities WHERE project_id=$1 ORDER BY user_id,scope`, [projectId]
    )
    return result.rows.map(mapTaskAuthority)
  }

  async listTaskAuthoritiesForUser(projectId: string, userId: string): Promise<StoredTaskAuthority[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_authorities
       WHERE project_id=$1 AND user_id=$2 ORDER BY scope`, [projectId, userId]
    )
    return result.rows.map(mapTaskAuthority)
  }

  async getProjectContentProvisioningIntent(
    provisioningIntentId: string
  ): Promise<StoredProjectContentProvisioningIntent | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_provisioning_intents
       WHERE provisioning_intent_id=$1`, [provisioningIntentId]
    )
    return result.rows[0] ? mapProjectContentProvisioningIntent(result.rows[0]) : null
  }

  async getLatestProjectContentProvisioningIntent(
    projectId: string
  ): Promise<StoredProjectContentProvisioningIntent | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_provisioning_intents
       WHERE project_id=$1 ORDER BY provisioning_revision DESC LIMIT 1`, [projectId]
    )
    return result.rows[0] ? mapProjectContentProvisioningIntent(result.rows[0]) : null
  }

  async listProjectContentProvisioningIntents(
    projectId: string
  ): Promise<StoredProjectContentProvisioningIntent[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_provisioning_intents
       WHERE project_id=$1 ORDER BY provisioning_revision`, [projectId]
    )
    return result.rows.map(mapProjectContentProvisioningIntent)
  }

  async getProjectContentProvisioningAttestation(
    provisioningAttestationId: string
  ): Promise<StoredProjectContentProvisioningAttestation | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_provisioning_attestations
       WHERE provisioning_attestation_id=$1`, [provisioningAttestationId]
    )
    return result.rows[0] ? mapProjectContentProvisioningAttestation(result.rows[0]) : null
  }

  async listProjectContentProvisioningAttestations(
    projectId: string
  ): Promise<StoredProjectContentProvisioningAttestation[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_provisioning_attestations
       WHERE project_id=$1 ORDER BY provisioning_revision,created_at`, [projectId]
    )
    return result.rows.map(mapProjectContentProvisioningAttestation)
  }

  async getExternalOperationJournal(
    logicalInvocationId: string
  ): Promise<StoredExternalOperationJournal | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.external_operation_journal
       WHERE logical_invocation_id=$1`, [logicalInvocationId]
    )
    return result.rows[0] ? mapExternalOperationJournal(result.rows[0]) : null
  }

  async getExternalOperationJournalById(
    journalEntryId: string
  ): Promise<StoredExternalOperationJournal | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.external_operation_journal
       WHERE content_recovery_journal_entry_id=$1`, [journalEntryId]
    )
    return result.rows[0] ? mapExternalOperationJournal(result.rows[0]) : null
  }

  async listExternalOperationJournal(projectId: string): Promise<StoredExternalOperationJournal[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.external_operation_journal
       WHERE project_id=$1 ORDER BY created_at,content_recovery_journal_entry_id`, [projectId]
    )
    return result.rows.map(mapExternalOperationJournal)
  }

  async getVisibleRecoveryAction(recoveryActionId: string): Promise<StoredVisibleRecoveryAction | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.visible_recovery_actions
       WHERE recovery_action_id=$1`, [recoveryActionId]
    )
    return result.rows[0] ? mapVisibleRecoveryAction(result.rows[0]) : null
  }

  async listVisibleRecoveryActionsByProject(projectId: string): Promise<StoredVisibleRecoveryAction[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.visible_recovery_actions
       WHERE project_id=$1 ORDER BY available_at,recovery_action_id`, [projectId]
    )
    return result.rows.map(mapVisibleRecoveryAction)
  }

  async getCloudResourceRef(resourceRefId: string): Promise<StoredCloudResourceRef | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_resource_refs WHERE resource_ref_id=$1`,
      [resourceRefId]
    )
    return result.rows[0] ? mapCloudResourceRef(result.rows[0]) : null
  }

  async listCloudResourceRefs(taskId: string, executionId: string): Promise<StoredCloudResourceRef[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_resource_refs
       WHERE task_id=$1 AND execution_id=$2 ORDER BY ordinal,resource_ref_id`,
      [taskId, executionId]
    )
    return result.rows.map(mapCloudResourceRef)
  }

  async listActiveProjectsForCoordinator(agentId: string): Promise<StoredProject[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.projects
       WHERE coordinator_agent_id=$1 AND status='active' ORDER BY created_at,project_id`, [agentId]
    )
    return result.rows.map(mapProject)
  }

  async getProjectMember(projectId: string, userId: string): Promise<StoredProjectMember | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    )
    return result.rows[0] ? mapMember(result.rows[0]) : null
  }

  async listProjectMembers(projectId: string): Promise<StoredProjectMember[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_members WHERE project_id = $1 ORDER BY created_at, user_id`,
      [projectId]
    )
    return result.rows.map(mapMember)
  }

  async listActiveProjectMembersForUser(userId: string): Promise<StoredProjectMember[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_members
       WHERE user_id=$1 AND state='active' ORDER BY project_id`, [userId]
    )
    return result.rows.map(mapMember)
  }

  async countProjectTasks(projectId: string, coordinationRound?: number): Promise<number> {
    const result = await this.sql.query<{ count: unknown }>(
      coordinationRound === undefined
        ? `SELECT count(*) AS count FROM sciforge_collaboration.tasks WHERE project_id = $1`
        : `SELECT count(*) AS count FROM sciforge_collaboration.tasks WHERE project_id = $1 AND coordination_round = $2`,
      coordinationRound === undefined ? [projectId] : [projectId, coordinationRound]
    )
    return number(result.rows[0]?.count)
  }

  async countOpenFileTasks(projectId: string): Promise<number> {
    const result = await this.sql.query<{ count: unknown }>(
      `SELECT count(*) AS count FROM sciforge_collaboration.tasks
       WHERE project_id=$1 AND file_intent IS NOT NULL
         AND status IN ('offered','in_progress','needs_human','awaiting_review','revision_requested','manual_recovery_required')`,
      [projectId]
    )
    return number(result.rows[0]?.count)
  }

  async getTask(taskId: string): Promise<StoredTask | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.tasks WHERE task_id = $1`, [taskId])
    return result.rows[0] ? mapTask(result.rows[0]) : null
  }

  async listTasksByProject(
    projectId: string,
    afterTaskId: string | null,
    limit: number
  ): Promise<StoredTask[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.tasks
       WHERE project_id=$1 AND task_id>COALESCE($2::text,'')
       ORDER BY task_id ASC LIMIT $3`, [projectId, afterTaskId, limit]
    )
    return result.rows.map(mapTask)
  }

  async listOpenTasksForAgent(agentId: string): Promise<StoredTask[]> {
    const result = await this.sql.query(
      `SELECT task.* FROM sciforge_collaboration.tasks AS task
       JOIN sciforge_collaboration.task_executions AS execution
         ON execution.execution_id=task.current_execution_id
       WHERE execution.assignee_agent_id=$1
         AND task.status IN ('offered','in_progress','needs_human','awaiting_review','revision_requested','manual_recovery_required')
       ORDER BY task.created_at,task.task_id`,
      [agentId]
    )
    return result.rows.map(mapTask)
  }

  async getTaskExecution(executionId: string): Promise<StoredTaskExecution | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_executions WHERE execution_id=$1`, [executionId]
    )
    return result.rows[0] ? mapTaskExecution(result.rows[0]) : null
  }

  async listTaskExecutionsByProject(
    projectId: string,
    afterExecutionId: string | null,
    limit: number
  ): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_executions
       WHERE project_id=$1 AND execution_id>COALESCE($2::text,'')
       ORDER BY execution_id ASC LIMIT $3`, [projectId, afterExecutionId, limit]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listTaskExecutions(taskId: string): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_executions
       WHERE task_id=$1 ORDER BY created_at,execution_id`, [taskId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listCurrentTaskExecutionsForAgent(agentId: string): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT execution.* FROM sciforge_collaboration.task_executions AS execution
       JOIN sciforge_collaboration.tasks AS task
         ON task.task_id=execution.task_id AND task.current_execution_id=execution.execution_id
       WHERE execution.assignee_agent_id=$1
         AND execution.state IN ('accepted','running','needs_human')
       ORDER BY execution.created_at,execution.execution_id`, [agentId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listCurrentTaskExecutionsForDevice(deviceId: string): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT execution.* FROM sciforge_collaboration.task_executions AS execution
       JOIN sciforge_collaboration.tasks AS task
         ON task.task_id=execution.task_id AND task.current_execution_id=execution.execution_id
       WHERE execution.assignee_device_id=$1
         AND execution.state IN ('accepted','running','needs_human')
       ORDER BY execution.created_at,execution.execution_id`, [deviceId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listCurrentTaskExecutionsForUser(userId: string): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT execution.* FROM sciforge_collaboration.task_executions AS execution
       JOIN sciforge_collaboration.tasks AS task
         ON task.task_id=execution.task_id AND task.current_execution_id=execution.execution_id
       WHERE execution.assignee_user_id=$1
         AND execution.state IN ('accepted','running','needs_human')
       ORDER BY execution.created_at,execution.execution_id`, [userId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async getTaskOffer(taskOfferId: string): Promise<StoredTaskOffer | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_offers WHERE task_offer_id=$1`, [taskOfferId]
    )
    return result.rows[0] ? mapTaskOffer(result.rows[0]) : null
  }

  async listExpiredTaskOffers(now: string, limit: number): Promise<StoredTaskOffer[]> {
    const result = await this.sql.query(
      `SELECT offer.* FROM sciforge_collaboration.task_offers AS offer
       JOIN sciforge_collaboration.tasks AS task
         ON task.task_id=offer.task_id
       WHERE offer.state='pending' AND offer.expires_at <= $1
         AND offer.execution_id IS NULL AND task.status='offered'
         AND task.current_execution_id IS NULL
       ORDER BY offer.expires_at,offer.task_offer_id LIMIT $2`,
      [now, limit]
    )
    return result.rows.map(mapTaskOffer)
  }

  async listTaskOffersByProject(
    projectId: string,
    afterTaskOfferId: string | null,
    limit: number
  ): Promise<StoredTaskOffer[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_offers
       WHERE project_id=$1 AND task_offer_id>COALESCE($2::text,'')
       ORDER BY task_offer_id ASC LIMIT $3`, [projectId, afterTaskOfferId, limit]
    )
    return result.rows.map(mapTaskOffer)
  }

  async listTaskOffers(executionId: string): Promise<StoredTaskOffer[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_offers
       WHERE execution_id=$1 ORDER BY offered_at,task_offer_id`, [executionId]
    )
    return result.rows.map(mapTaskOffer)
  }

  async getProjectPlan(projectPlanId: string): Promise<StoredProjectPlan | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_plans WHERE project_plan_id=$1`, [projectPlanId]
    )
    return result.rows[0] ? mapProjectPlan(result.rows[0]) : null
  }

  async getCurrentProjectPlan(projectId: string): Promise<StoredProjectPlan | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_plans
       WHERE project_id=$1 AND state<>'superseded' ORDER BY plan_revision DESC LIMIT 1`, [projectId]
    )
    return result.rows[0] ? mapProjectPlan(result.rows[0]) : null
  }

  async listProjectPlans(projectId: string): Promise<StoredProjectPlan[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_plans
       WHERE project_id=$1 ORDER BY created_at,project_plan_id`, [projectId]
    )
    return result.rows.map(mapProjectPlan)
  }

  async getTaskResultSubmission(resultSubmissionId: string): Promise<StoredTaskResultSubmission | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_result_submissions WHERE result_submission_id=$1`,
      [resultSubmissionId]
    )
    return result.rows[0] ? mapTaskResultSubmission(result.rows[0]) : null
  }

  async listTaskResultSubmissionsByProject(
    projectId: string,
    afterResultSubmissionId: string | null,
    limit: number
  ): Promise<StoredTaskResultSubmission[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_result_submissions
       WHERE project_id=$1 AND result_submission_id>COALESCE($2::text,'')
       ORDER BY result_submission_id ASC LIMIT $3`, [projectId, afterResultSubmissionId, limit]
    )
    return result.rows.map(mapTaskResultSubmission)
  }

  async listTaskResultSubmissions(taskId: string): Promise<StoredTaskResultSubmission[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_result_submissions
       WHERE task_id=$1 ORDER BY submitted_at,result_submission_id`, [taskId]
    )
    return result.rows.map(mapTaskResultSubmission)
  }

  async listTaskResultReviews(resultSubmissionId: string): Promise<StoredTaskResultReview[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_result_reviews
       WHERE result_submission_id=$1 ORDER BY created_at,review_decision_id`, [resultSubmissionId]
    )
    return result.rows.map(mapTaskResultReview)
  }

  async listTaskResultReviewsByProject(
    projectId: string,
    afterReviewDecisionId: string | null,
    limit: number
  ): Promise<StoredTaskResultReview[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_result_reviews
       WHERE project_id=$1 AND review_decision_id>COALESCE($2::text,'')
       ORDER BY review_decision_id ASC LIMIT $3`, [projectId, afterReviewDecisionId, limit]
    )
    return result.rows.map(mapTaskResultReview)
  }

  async listProjectFinalSummaries(projectId: string): Promise<StoredProjectFinalSummary[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_final_summaries
       WHERE project_id=$1 ORDER BY created_at,project_record_id`, [projectId]
    )
    return result.rows.map(mapProjectFinalSummary)
  }

  async getProjectRecord(projectRecordId: string): Promise<StoredProjectRecord | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.project_records WHERE project_record_id = $1`, [projectRecordId])
    return result.rows[0] ? mapRecord(result.rows[0]) : null
  }

  async listProjectRecords(projectId: string, acceptedOnly: boolean): Promise<StoredProjectRecord[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_records
       WHERE project_id = $1 AND ($2::boolean = false OR status = 'accepted')
       ORDER BY created_at, project_record_id`,
      [projectId, acceptedOnly]
    )
    return result.rows.map(mapRecord)
  }

  async getCredentialByDigest(tokenDigest: string): Promise<StoredCredential | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.credentials WHERE token_digest = $1`, [Buffer.from(tokenDigest, 'hex')])
    return result.rows[0] ? mapCredential(result.rows[0]) : null
  }

  async getCredential(credentialId: string): Promise<StoredCredential | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.credentials WHERE credential_id=$1`, [credentialId]
    )
    return result.rows[0] ? mapCredential(result.rows[0]) : null
  }

  async getReceipt(actorKey: string, idempotencyKey: string): Promise<StoredReceipt | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.receipts WHERE actor_key = $1 AND idempotency_key = $2`,
      [actorKey, idempotencyKey]
    )
    return result.rows[0] ? mapReceipt(result.rows[0]) : null
  }

  async getReceiptById(receiptId: string): Promise<StoredReceipt | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.receipts WHERE receipt_id = $1`, [receiptId]
    )
    return result.rows[0] ? mapReceipt(result.rows[0]) : null
  }

  async getInboxCursor(recipient: InboxRecipient): Promise<StoredInboxCursor | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.inbox_cursors WHERE recipient_kind = $1 AND recipient_id = $2`,
      [recipient.kind, recipient.id]
    )
    return result.rows[0] ? mapCursor(result.rows[0]) : null
  }

  async pullInbox(recipient: InboxRecipient, afterSequence: number, limit: number, now: string): Promise<StoredInboxMessage[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.inbox_messages
       WHERE recipient_kind = $1 AND recipient_id = $2 AND sequence > $3 AND expires_at >= $4
       ORDER BY sequence ASC LIMIT $5`,
      [recipient.kind, recipient.id, afterSequence, now, limit]
    )
    return result.rows.map(mapInbox)
  }
}

class PostgresTransaction extends PostgresReadRepository implements CollaborationTransaction {
  declare readonly sql: SqlConnection

  constructor(connection: SqlConnection) {
    super(connection)
    this.sql = connection
  }

  async lockIdempotency(actorKey: string, idempotencyKey: string): Promise<void> {
    // PostgreSQL text values cannot contain NUL. JSON encodes this composite key
    // unambiguously without introducing a byte that the wire protocol rejects.
    const lockScope = JSON.stringify([actorKey, idempotencyKey])
    await this.sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockScope])
  }

  async lockOidcIdentity(issuer: string, subject: string): Promise<void> {
    const lockScope = JSON.stringify(['oidc-identity', issuer, subject])
    await this.sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockScope])
  }

  async getUserForUpdate(userId: string): Promise<StoredUser | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.user_principals WHERE user_id=$1 FOR UPDATE`, [userId]
    )
    return result.rows[0] ? mapUser(result.rows[0]) : null
  }

  async getOidcIdentityByIssuerSubjectForUpdate(issuer: string, subject: string): Promise<StoredOidcIdentity | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.oidc_identities WHERE issuer=$1 AND subject=$2 FOR UPDATE`,
      [issuer, subject]
    )
    return result.rows[0] ? mapOidcIdentity(result.rows[0]) : null
  }

  async getDeviceEnrollmentForUpdate(enrollmentId: string): Promise<StoredDeviceEnrollment | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.device_enrollments WHERE enrollment_id=$1 FOR UPDATE`, [enrollmentId]
    )
    return result.rows[0] ? mapDeviceEnrollment(result.rows[0]) : null
  }

  async getDeviceForUpdate(deviceId: string): Promise<StoredDevice | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.devices WHERE device_id=$1 FOR UPDATE`, [deviceId]
    )
    return result.rows[0] ? mapDevice(result.rows[0]) : null
  }

  async getAgentForUpdate(agentId: string): Promise<StoredAgent | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.agent_nodes WHERE agent_id=$1 FOR UPDATE`, [agentId]
    )
    return result.rows[0] ? mapAgent(result.rows[0]) : null
  }

  async listAgentsForDeviceForUpdate(deviceId: string): Promise<StoredAgent[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.agent_nodes
       WHERE device_id=$1 ORDER BY agent_id FOR UPDATE`, [deviceId]
    )
    return result.rows.map(mapAgent)
  }

  async getWorkerAvailabilityForUpdate(agentId: string): Promise<StoredWorkerAvailability | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.worker_availability WHERE agent_id=$1 FOR UPDATE`, [agentId]
    )
    return result.rows[0] ? mapWorkerAvailability(result.rows[0]) : null
  }

  async listWorkerAvailabilityForDeviceForUpdate(deviceId: string): Promise<StoredWorkerAvailability[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.worker_availability
       WHERE device_id=$1 ORDER BY agent_id FOR UPDATE`, [deviceId]
    )
    return result.rows.map(mapWorkerAvailability)
  }

  async getProjectForUpdate(projectId: string): Promise<StoredProject | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.projects WHERE project_id=$1 FOR UPDATE`, [projectId]
    )
    return result.rows[0] ? mapProject(result.rows[0]) : null
  }

  async getTaskForUpdate(taskId: string): Promise<StoredTask | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.tasks WHERE task_id=$1 FOR UPDATE`, [taskId]
    )
    return result.rows[0] ? mapTask(result.rows[0]) : null
  }

  async listCurrentTaskExecutionsForAgentForUpdate(agentId: string): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT execution.* FROM sciforge_collaboration.task_executions AS execution
       JOIN sciforge_collaboration.tasks AS task ON task.current_execution_id=execution.execution_id
       WHERE execution.assignee_agent_id=$1
         AND execution.state IN ('accepted','running','needs_human')
       ORDER BY execution.created_at,execution.execution_id FOR UPDATE OF execution,task`, [agentId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listCurrentTaskExecutionsForDeviceForUpdate(deviceId: string): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT execution.* FROM sciforge_collaboration.task_executions AS execution
       JOIN sciforge_collaboration.tasks AS task ON task.current_execution_id=execution.execution_id
       WHERE execution.assignee_device_id=$1
         AND execution.state IN ('accepted','running','needs_human')
       ORDER BY execution.created_at,execution.execution_id FOR UPDATE OF execution,task`, [deviceId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listCurrentTaskExecutionsForProjectUserForUpdate(
    projectId: string,
    userId: string
  ): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT execution.* FROM sciforge_collaboration.task_executions AS execution
       JOIN sciforge_collaboration.tasks AS task ON task.current_execution_id=execution.execution_id
       WHERE execution.project_id=$1 AND execution.assignee_user_id=$2
         AND execution.state IN ('accepted','running','needs_human')
       ORDER BY execution.created_at,execution.execution_id FOR UPDATE OF execution,task`, [projectId, userId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listCurrentTaskExecutionsForProjectForUpdate(projectId: string): Promise<StoredTaskExecution[]> {
    const result = await this.sql.query(
      `SELECT execution.* FROM sciforge_collaboration.task_executions AS execution
       JOIN sciforge_collaboration.tasks AS task ON task.current_execution_id=execution.execution_id
       WHERE execution.project_id=$1 AND execution.state IN ('accepted','running','needs_human')
       ORDER BY execution.created_at,execution.execution_id FOR UPDATE OF execution,task`, [projectId]
    )
    return result.rows.map(mapTaskExecution)
  }

  async listPendingTaskOffersForProjectForUpdate(
    projectId: string,
    workerUserId?: string
  ): Promise<StoredTaskOffer[]> {
    await this.sql.query(
      `SELECT task.task_id FROM sciforge_collaboration.tasks AS task
       WHERE task.project_id=$1
         AND EXISTS (
           SELECT 1 FROM sciforge_collaboration.task_offers AS offer
           WHERE offer.task_id=task.task_id AND offer.state='pending'
             AND ($2::text IS NULL OR offer.worker_user_id=$2)
         )
       ORDER BY task.task_id FOR UPDATE OF task`,
      [projectId, workerUserId ?? null]
    )
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_offers
       WHERE project_id=$1 AND state='pending'
         AND ($2::text IS NULL OR worker_user_id=$2)
       ORDER BY task_id,task_offer_id FOR UPDATE`,
      [projectId, workerUserId ?? null]
    )
    return result.rows.map(mapTaskOffer)
  }

  async getProjectMemberForUpdate(projectId: string, userId: string): Promise<StoredProjectMember | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_members
       WHERE project_id=$1 AND user_id=$2 FOR UPDATE`, [projectId, userId]
    )
    return result.rows[0] ? mapMember(result.rows[0]) : null
  }

  async getProjectContentSpaceBindingForUpdate(
    projectId: string
  ): Promise<StoredProjectContentSpaceBinding | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_space_bindings
       WHERE project_id=$1 FOR UPDATE`, [projectId]
    )
    return result.rows[0] ? mapProjectContentSpaceBinding(result.rows[0]) : null
  }

  async getProviderDirectoryPrincipalFactForUpdate(
    providerPrincipalFactId: string
  ): Promise<StoredProviderDirectoryPrincipalFact | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.provider_directory_principal_facts
       WHERE provider_principal_fact_id=$1 FOR UPDATE`, [providerPrincipalFactId]
    )
    return result.rows[0] ? mapProviderDirectoryPrincipalFact(result.rows[0]) : null
  }

  async getProviderDirectoryPrincipalFactForSlotForUpdate(
    userId: string,
    providerInstance: StoredProviderDirectoryPrincipalFact['providerPrincipal']['providerInstance']
  ): Promise<StoredProviderDirectoryPrincipalFact | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.provider_directory_principal_facts
       WHERE user_id=$1
         AND provider_principal->'providerInstance'->>'providerInstanceRef'=$2
       FOR UPDATE`, [userId, providerInstance.providerInstanceRef]
    )
    return result.rows[0] ? mapProviderDirectoryPrincipalFact(result.rows[0]) : null
  }

  async getProjectContentReadinessForUpdate(
    projectId: string,
    userId: string
  ): Promise<StoredProjectContentReadiness | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_readiness
       WHERE project_id=$1 AND user_id=$2 FOR UPDATE`, [projectId, userId]
    )
    return result.rows[0] ? mapProjectContentReadiness(result.rows[0]) : null
  }

  async getTaskAuthorityForUpdate(
    projectId: string,
    userId: string,
    scope: StoredTaskAuthority['scope']
  ): Promise<StoredTaskAuthority | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_authorities
       WHERE project_id=$1 AND user_id=$2 AND scope=$3 FOR UPDATE`, [projectId, userId, scope]
    )
    return result.rows[0] ? mapTaskAuthority(result.rows[0]) : null
  }

  async listTaskAuthoritiesForUserForUpdate(
    projectId: string,
    userId: string
  ): Promise<StoredTaskAuthority[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_authorities
       WHERE project_id=$1 AND user_id=$2 ORDER BY scope FOR UPDATE`, [projectId, userId]
    )
    return result.rows.map(mapTaskAuthority)
  }

  async getTaskExecutionForUpdate(executionId: string): Promise<StoredTaskExecution | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_executions WHERE execution_id=$1 FOR UPDATE`, [executionId]
    )
    return result.rows[0] ? mapTaskExecution(result.rows[0]) : null
  }

  async getTaskOfferForUpdate(taskOfferId: string): Promise<StoredTaskOffer | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.task_offers WHERE task_offer_id=$1 FOR UPDATE`, [taskOfferId]
    )
    return result.rows[0] ? mapTaskOffer(result.rows[0]) : null
  }

  async getProjectContentProvisioningIntentForUpdate(
    provisioningIntentId: string
  ): Promise<StoredProjectContentProvisioningIntent | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.project_content_provisioning_intents
       WHERE provisioning_intent_id=$1 FOR UPDATE`, [provisioningIntentId]
    )
    return result.rows[0] ? mapProjectContentProvisioningIntent(result.rows[0]) : null
  }

  async getExternalOperationJournalForUpdate(
    logicalInvocationId: string
  ): Promise<StoredExternalOperationJournal | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.external_operation_journal
       WHERE logical_invocation_id=$1 FOR UPDATE`, [logicalInvocationId]
    )
    return result.rows[0] ? mapExternalOperationJournal(result.rows[0]) : null
  }

  async getExternalOperationJournalByIdForUpdate(
    journalEntryId: string
  ): Promise<StoredExternalOperationJournal | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.external_operation_journal
       WHERE content_recovery_journal_entry_id=$1 FOR UPDATE`, [journalEntryId]
    )
    return result.rows[0] ? mapExternalOperationJournal(result.rows[0]) : null
  }

  async getVisibleRecoveryActionForUpdate(
    recoveryActionId: string
  ): Promise<StoredVisibleRecoveryAction | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.visible_recovery_actions
       WHERE recovery_action_id=$1 FOR UPDATE`, [recoveryActionId]
    )
    return result.rows[0] ? mapVisibleRecoveryAction(result.rows[0]) : null
  }

  async insertUser(user: StoredUser): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.user_principals
       (user_id, display_name, status, revision, created_at, updated_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [user.userId, user.displayName, user.status, user.revision, user.createdAt, user.updatedAt, user.revokedAt ?? null]
    )
  }

  async updateUser(user: StoredUser, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.user_principals
       SET display_name=$2,status=$3,revision=$4,updated_at=$5,revoked_at=$6
       WHERE user_id=$1 AND revision=$7`,
      [user.userId, user.displayName, user.status, user.revision, user.updatedAt, user.revokedAt ?? null, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertOidcIdentity(identity: StoredOidcIdentity): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.oidc_identities
       (identity_id,user_id,issuer,subject,email_at_link_time,status,revision,created_at,updated_at,revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [identity.identityId, identity.userId, identity.issuer, identity.subject, identity.emailAtLinkTime ?? null,
        identity.status, identity.revision, identity.createdAt, identity.updatedAt, identity.revokedAt ?? null]
    )
  }

  async insertDeviceEnrollment(enrollment: StoredDeviceEnrollment): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.device_enrollments
       (enrollment_id,user_id,installation_id,nonce_digest,status,revision,expires_at,consumed_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [enrollment.enrollmentId, enrollment.userId, enrollment.installationId,
        Buffer.from(enrollment.nonceDigest, 'hex'), enrollment.status, enrollment.revision, enrollment.expiresAt,
        enrollment.consumedAt ?? null, enrollment.createdAt, enrollment.updatedAt]
    )
  }

  async consumeDeviceEnrollment(enrollmentId: string, consumedAt: string, expectedRevision: number): Promise<boolean> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.device_enrollments
       SET status='consumed',consumed_at=$2,revision=revision+1,updated_at=$2
       WHERE enrollment_id=$1 AND status='pending' AND revision=$3 AND expires_at>$2`,
      [enrollmentId, consumedAt, expectedRevision]
    )
    return result.rowCount === 1
  }

  async insertDevice(device: StoredDevice): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.devices
       (device_id,user_id,installation_id,display_name,platform,public_key_jwk,capability_summary,status,
        revision,created_at,updated_at,revoked_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12)`,
      [device.deviceId, device.userId, device.installationId, device.displayName, JSON.stringify(device.platform),
        JSON.stringify(device.publicKeyJwk), JSON.stringify(device.capabilitySummary), device.status, device.revision,
        device.createdAt, device.updatedAt, device.revokedAt ?? null]
    )
  }

  async updateDevice(device: StoredDevice, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.devices
       SET display_name=$2,platform=$3::jsonb,public_key_jwk=$4::jsonb,capability_summary=$5::jsonb,
           status=$6,revision=$7,updated_at=$8,revoked_at=$9
       WHERE device_id=$1 AND user_id=$10 AND revision=$11`,
      [device.deviceId, device.displayName, JSON.stringify(device.platform), JSON.stringify(device.publicKeyJwk),
        JSON.stringify(device.capabilitySummary), device.status, device.revision, device.updatedAt,
        device.revokedAt ?? null, device.userId, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertChallenge(challenge: StoredChallenge): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.human_endpoint_challenges
       (challenge_id,requested_user_id,provider,realm_id,expected_provider_user_id,challenge_digest,
        expires_at,verified_user_id,verified_endpoint_id,verified_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [challenge.challengeId, challenge.requestedUserId, challenge.provider, challenge.realmId,
        challenge.expectedProviderUserId, Buffer.from(challenge.challengeDigest, 'hex'), challenge.expiresAt,
        challenge.verifiedUserId ?? null, challenge.verifiedEndpointId ?? null, challenge.verifiedAt ?? null,
        challenge.createdAt]
    )
  }

  async consumeEndpointChallengeRateWindow(input: {
    userId: string
    provider: string
    realmId: string
    windowStartedAt: string
    expiresAt: string
    maxAttempts: number
    updatedAt: string
  }): Promise<EndpointChallengeRateConsumeResult> {
    const consumed = await this.sql.query(
      `INSERT INTO sciforge_collaboration.endpoint_challenge_rate_windows AS rate_window
       (user_id,provider,realm_id,window_started_at,expires_at,attempt_count,revision,updated_at)
       VALUES ($1,$2,$3,$4,$5,1,1,$7)
       ON CONFLICT (user_id,provider,realm_id,window_started_at) DO UPDATE
       SET attempt_count=rate_window.attempt_count+1,
           revision=rate_window.revision+1,
           updated_at=EXCLUDED.updated_at
       WHERE rate_window.attempt_count<$6
         AND rate_window.expires_at>$7
       RETURNING *`,
      [input.userId, input.provider, input.realmId, input.windowStartedAt, input.expiresAt,
        input.maxAttempts, input.updatedAt]
    )
    if (consumed.rows[0]) {
      return { allowed: true, window: mapEndpointChallengeRateWindow(consumed.rows[0]) }
    }
    const existing = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.endpoint_challenge_rate_windows
       WHERE user_id=$1 AND provider=$2 AND realm_id=$3 AND window_started_at=$4 FOR UPDATE`,
      [input.userId, input.provider, input.realmId, input.windowStartedAt]
    )
    if (!existing.rows[0]) {
      throw new CollaborationServiceError('revision_conflict', 'Endpoint challenge rate window changed concurrently.')
    }
    return { allowed: false, window: mapEndpointChallengeRateWindow(existing.rows[0]) }
  }

  async getChallengeForUpdate(challengeId: string): Promise<StoredChallenge | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.human_endpoint_challenges WHERE challenge_id=$1 FOR UPDATE`, [challengeId])
    return result.rows[0] ? mapChallenge(result.rows[0]) : null
  }

  async getChallengeByCodeDigestForUpdate(challengeDigest: string): Promise<StoredChallenge | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.human_endpoint_challenges WHERE challenge_digest=$1 FOR UPDATE`,
      [Buffer.from(challengeDigest, 'hex')]
    )
    return result.rows[0] ? mapChallenge(result.rows[0]) : null
  }

  async verifyChallenge(challengeId: string, userId: string, endpointId: string, verifiedAt: string): Promise<boolean> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.human_endpoint_challenges
       SET verified_user_id=$2, verified_endpoint_id=$3, verified_at=$4
       WHERE challenge_id=$1 AND verified_at IS NULL`,
      [challengeId, userId, endpointId, verifiedAt]
    )
    return result.rowCount === 1
  }

  async insertEndpoint(endpoint: StoredEndpoint): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.human_endpoint_bindings
       (human_endpoint_id,user_id,provider,realm_id,provider_user_id,display_name,assurance,status,revision,verified_at,updated_at,revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [endpoint.humanEndpointId, endpoint.userId, endpoint.provider, endpoint.realmId, endpoint.providerUserId,
        endpoint.displayName ?? null, endpoint.assurance, endpoint.status, endpoint.revision, endpoint.verifiedAt,
        endpoint.updatedAt, endpoint.revokedAt ?? null]
    )
  }

  async updateEndpoint(endpoint: StoredEndpoint, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.human_endpoint_bindings
       SET user_id=$2,display_name=$3,assurance=$4,status=$5,revision=$6,verified_at=$7,updated_at=$8,revoked_at=$9
       WHERE human_endpoint_id=$1 AND revision=$10`,
      [endpoint.humanEndpointId, endpoint.userId, endpoint.displayName ?? null, endpoint.assurance, endpoint.status,
        endpoint.revision, endpoint.verifiedAt, endpoint.updatedAt, endpoint.revokedAt ?? null, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertAgent(agent: StoredAgent): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.agent_nodes
       (agent_id,device_id,owner_user_id,display_name,node_type,capabilities,status,connection_status,
        credential_generation,revision,last_seen_at,updated_at,revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
      [agent.agentId, agent.deviceId, agent.ownerUserId, agent.displayName, agent.nodeType,
        JSON.stringify(agent.capabilities), agent.status, agent.connectionStatus, agent.credentialGeneration,
        agent.revision, agent.lastSeenAt ?? null, agent.updatedAt, agent.revokedAt ?? null]
    )
  }

  async updateAgent(agent: StoredAgent, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.agent_nodes
       SET device_id=$2,owner_user_id=$3,display_name=$4,node_type=$5,capabilities=$6::jsonb,status=$7,connection_status=$8,
           credential_generation=$9,revision=$10,last_seen_at=$11,updated_at=$12,revoked_at=$13
       WHERE agent_id=$1 AND revision=$14`,
      [agent.agentId, agent.deviceId, agent.ownerUserId, agent.displayName, agent.nodeType, JSON.stringify(agent.capabilities),
        agent.status, agent.connectionStatus, agent.credentialGeneration, agent.revision, agent.lastSeenAt ?? null,
        agent.updatedAt, agent.revokedAt ?? null, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertCredential(credential: StoredCredential): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.credentials
       (credential_id,kind,subject_user_id,subject_agent_id,token_digest,assurance,generation,created_at,expires_at,revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [credential.credentialId, credential.kind, credential.subjectUserId, credential.subjectAgentId ?? null,
        Buffer.from(credential.tokenDigest, 'hex'), credential.assurance, credential.generation, credential.createdAt,
        credential.expiresAt ?? null, credential.revokedAt ?? null]
    )
  }

  async revokeAgentCredentials(agentId: string, revokedAt: string): Promise<number> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.credentials SET revoked_at=$2
       WHERE kind='agent_device' AND subject_agent_id=$1 AND revoked_at IS NULL`,
      [agentId, revokedAt]
    )
    return result.rowCount ?? 0
  }

  async revokeAgentCredentialsForDevice(deviceId: string, revokedAt: string): Promise<number> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.credentials AS credential
       SET revoked_at=$2
       FROM sciforge_collaboration.agent_nodes AS agent
       WHERE agent.device_id=$1 AND credential.kind='agent_device'
         AND credential.subject_agent_id=agent.agent_id AND credential.revoked_at IS NULL`,
      [deviceId, revokedAt]
    )
    return result.rowCount ?? 0
  }

  async upsertParticipant(participant: StoredParticipant, expectedRevision: number | null): Promise<void> {
    if (expectedRevision === null) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.participant_profiles
         (user_id,primary_human_endpoint_id,primary_agent_id,status,revision,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [participant.userId, participant.primaryHumanEndpointId ?? null, participant.primaryAgentId ?? null,
          participant.status, participant.revision, participant.updatedAt]
      )
      return
    }
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.participant_profiles
       SET primary_human_endpoint_id=$2,primary_agent_id=$3,status=$4,revision=$5,updated_at=$6
       WHERE user_id=$1 AND revision=$7`,
      [participant.userId, participant.primaryHumanEndpointId ?? null, participant.primaryAgentId ?? null,
        participant.status, participant.revision, participant.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjection(projection: StoredProjection): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.remote_session_projections
       (projection_id,owner_user_id,agent_id,human_endpoint_id,locator,locator_revision,display_name,status,
        allowed_sender_user_ids,last_error_code,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
      [projection.projectionId, projection.ownerUserId, projection.agentId, projection.humanEndpointId,
        JSON.stringify(projection.locator), projection.locatorRevision, projection.displayName, projection.status,
        JSON.stringify(projection.allowedSenderUserIds), projection.lastErrorCode ?? null, projection.revision,
        projection.createdAt, projection.updatedAt]
    )
  }

  async updateProjection(projection: StoredProjection, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.remote_session_projections
       SET locator=$2::jsonb,locator_revision=$3,display_name=$4,status=$5,allowed_sender_user_ids=$6::jsonb,
           last_error_code=$7,revision=$8,updated_at=$9
       WHERE projection_id=$1 AND revision=$10`,
      [projection.projectionId, JSON.stringify(projection.locator), projection.locatorRevision, projection.displayName,
        projection.status, JSON.stringify(projection.allowedSenderUserIds), projection.lastErrorCode ?? null,
        projection.revision, projection.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertManagedContainer(container: StoredManagedContainer): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.managed_provider_containers
       (managed_container_id,owner_user_id,human_endpoint_id,installation_id,provider,realm_id,owner_provider_user_id,
        stable_key,display_name,external_container_id,policy,observed_checks,status,last_verified_at,safe_error_code,revision,
        created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18)`,
      [container.managedContainerId, container.ownerUserId, container.humanEndpointId, container.installationId, container.provider,
        container.realmId, container.ownerProviderUserId, container.stableKey, container.displayName,
        container.externalContainerId ?? null, JSON.stringify(container.policy),
        container.observedChecks ? JSON.stringify(container.observedChecks) : null, container.status,
        container.lastVerifiedAt ?? null, container.safeErrorCode ?? null, container.revision,
        container.createdAt, container.updatedAt]
    )
  }

  async updateManagedContainer(container: StoredManagedContainer, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.managed_provider_containers
       SET human_endpoint_id=$2,owner_provider_user_id=$3,display_name=$4,external_container_id=$5,
           policy=$6::jsonb,observed_checks=$7::jsonb,status=$8,last_verified_at=$9,safe_error_code=$10,
           revision=$11,updated_at=$12
       WHERE managed_container_id=$1 AND revision=$13`,
      [container.managedContainerId, container.humanEndpointId, container.ownerProviderUserId,
        container.displayName, container.externalContainerId ?? null, JSON.stringify(container.policy),
        container.observedChecks ? JSON.stringify(container.observedChecks) : null,
        container.status, container.lastVerifiedAt ?? null, container.safeErrorCode ?? null,
        container.revision, container.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async upsertPrivateContainerDiscovery(discovery: StoredPrivateContainerDiscovery): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.provider_private_container_discoveries
       (owner_user_id,human_endpoint_id,installation_id,provider,realm_id,external_container_id,display_name,observed_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (owner_user_id,human_endpoint_id,installation_id,provider,realm_id,external_container_id)
       DO UPDATE SET display_name=EXCLUDED.display_name,observed_at=EXCLUDED.observed_at,expires_at=EXCLUDED.expires_at`,
      [discovery.ownerUserId, discovery.humanEndpointId, discovery.installationId, discovery.provider,
        discovery.realmId, discovery.externalContainerId, discovery.displayName, discovery.observedAt, discovery.expiresAt]
    )
  }

  async insertPrivateContainerClaim(claim: StoredPrivateContainerClaim): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.provider_private_container_claims
       (claim_id,owner_user_id,human_endpoint_id,installation_id,provider,realm_id,external_container_id,display_name,claimed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [claim.claimId, claim.ownerUserId, claim.humanEndpointId, claim.installationId, claim.provider,
        claim.realmId, claim.externalContainerId, claim.displayName, claim.claimedAt]
    )
  }

  async insertManagedContainerJob(job: StoredManagedContainerJob): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.managed_provider_container_jobs
       (job_id,managed_container_id,operation,desired_revision,state,attempt_count,next_attempt_at,
        lease_owner,lease_expires_at,safe_error_code,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [job.jobId, job.managedContainerId, job.operation, job.desiredRevision, job.state,
        job.attemptCount, job.nextAttemptAt, job.leaseOwner ?? null, job.leaseExpiresAt ?? null,
        job.safeErrorCode ?? null, job.createdAt, job.updatedAt]
    )
  }

  async upsertProjectEndpointBinding(binding: StoredProjectEndpointBinding, expectedRevision: number | null): Promise<void> {
    if (expectedRevision === null) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.project_endpoint_bindings
         (project_endpoint_binding_id,project_id,locator,locator_revision,status,last_error_code,revision,created_at,updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)`,
        [binding.projectEndpointBindingId, binding.projectId, JSON.stringify(binding.locator), binding.locatorRevision,
          binding.status, binding.lastErrorCode ?? null, binding.revision, binding.createdAt, binding.updatedAt]
      )
      return
    }
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.project_endpoint_bindings
       SET locator=$2::jsonb,locator_revision=$3,status=$4,last_error_code=$5,revision=$6,updated_at=$7
       WHERE project_endpoint_binding_id=$1 AND revision=$8`,
      [binding.projectEndpointBindingId, JSON.stringify(binding.locator), binding.locatorRevision, binding.status,
        binding.lastErrorCode ?? null, binding.revision, binding.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjectInput(input: Omit<StoredProjectInput, 'sequence'>): Promise<StoredProjectInput> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_input_cursors(project_id,next_sequence)
       VALUES ($1,1) ON CONFLICT (project_id) DO NOTHING`, [input.projectId]
    )
    const cursor = await this.sql.query<{ sequence: unknown }>(
      `UPDATE sciforge_collaboration.project_input_cursors SET next_sequence=next_sequence+1
       WHERE project_id=$1 RETURNING next_sequence-1 AS sequence`, [input.projectId]
    )
    const sequence = number(cursor.rows[0]?.sequence)
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_inputs
       (project_input_id,project_id,sender_user_id,source_human_endpoint_id,provider_message_id,sequence,text,status,
        revision,occurred_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [input.projectInputId, input.projectId, input.senderUserId, input.sourceHumanEndpointId,
        input.providerMessageId, sequence, input.text, input.status, input.revision, input.occurredAt,
        input.createdAt, input.updatedAt]
    )
    return { ...input, sequence }
  }

  async insertHumanRequest(request: StoredHumanRequest): Promise<void> {
    const workerContext = request.context.scope === 'worker_execution' ? request.context : null
    const coordinatorContext = request.context.scope === 'coordinator_project' ? request.context : null
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.human_requests
       (human_request_id,project_id,request_scope,task_id,execution_id,coordinator_authority_epoch,
        target_user_id,requested_by_agent_id,required_assurance,prompt,confirmable_action,status,revision,
        expires_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [request.humanRequestId, request.projectId, request.context.scope,
        workerContext?.taskId ?? null, workerContext?.executionId ?? null,
        coordinatorContext?.coordinatorAuthorityEpoch ?? null,
        request.targetUserId, request.requestedByAgentId, request.requiredAssurance, request.prompt,
        request.confirmableAction, request.status, request.revision, request.expiresAt, request.createdAt, request.updatedAt]
    )
  }

  async updateHumanRequest(request: StoredHumanRequest, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.human_requests SET status=$2,revision=$3,updated_at=$4
       WHERE human_request_id=$1 AND revision=$5`,
      [request.humanRequestId, request.status, request.revision, request.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertHumanAnswer(answer: StoredHumanAnswer): Promise<void> {
    const workerContext = answer.context.scope === 'worker_execution' ? answer.context : null
    const coordinatorContext = answer.context.scope === 'coordinator_project' ? answer.context : null
    const oidcIdentityId = answer.answeredFrom.type === 'oidc_user' ? answer.answeredFrom.oidcIdentityId : null
    const humanEndpointId = answer.answeredFrom.type === 'human_endpoint' ? answer.answeredFrom.humanEndpointId : null
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.human_answers
       (human_answer_id,human_request_id,project_id,request_scope,task_id,execution_id,
        coordinator_authority_epoch,request_revision,answered_by_user_id,answered_from_oidc_identity_id,
        answered_from_human_endpoint_id,assurance,answer,decision,confirmation_id,
        revision,answered_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [answer.humanAnswerId, answer.humanRequestId, answer.projectId, answer.context.scope,
        workerContext?.taskId ?? null, workerContext?.executionId ?? null,
        coordinatorContext?.coordinatorAuthorityEpoch ?? null, answer.requestRevision,
        answer.answeredByUserId, oidcIdentityId, humanEndpointId,
        answer.assurance, answer.answer, answer.decision, answer.confirmationId,
        answer.revision, answer.answeredAt, answer.createdAt, answer.updatedAt]
    )
  }

  async insertRemoteApproval(approval: StoredRemoteCapabilityApproval): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.remote_capability_approvals
       (remote_approval_id,owner_user_id,agent_id,projection_id,locator,locator_revision,runtime_id,thread_id,
        turn_id,capability_request_id,desktop_approval_id,reference_digest,safe_summary,effect,interaction_mode,remote_eligible,
        status,provider_card_message_id,decision_event_id,decision_id,revision,expires_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [approval.remoteApprovalId, approval.ownerUserId, approval.agentId, approval.projectionId, approval.locator,
        approval.locatorRevision, approval.runtimeId, approval.threadId, approval.turnId,
        approval.capabilityRequestId, approval.desktopApprovalId, approval.referenceDigest, approval.safeSummary,
        approval.effect, approval.interactionMode, approval.remoteEligible, approval.status, approval.providerCardMessageId,
        approval.decisionEventId, approval.decisionId, approval.revision, approval.expiresAt,
        approval.createdAt, approval.updatedAt]
    )
  }

  async updateRemoteApproval(approval: StoredRemoteCapabilityApproval, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.remote_capability_approvals
       SET status=$2,provider_card_message_id=$3,decision_event_id=$4,decision_id=$5,revision=$6,updated_at=$7
       WHERE remote_approval_id=$1 AND revision=$8`,
      [approval.remoteApprovalId, approval.status, approval.providerCardMessageId, approval.decisionEventId,
        approval.decisionId, approval.revision, approval.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProject(project: StoredProject, members: StoredProjectMember[]): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.projects
       (project_id,owner_user_id,display_name,goal,content_mode,status,coordinator_agent_id,coordinator_authority_epoch,
        execution_authority_epoch,content_owner_user_id,max_tasks,max_tasks_per_round,max_task_retries,
        max_coordination_rounds,coordination_round,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [project.projectId, project.ownerUserId, project.displayName, project.goal, project.contentMode,
        project.status, project.coordinatorAgentId,
        project.coordinatorAuthorityEpoch, project.executionAuthorityEpoch, project.contentOwnerUserId, project.budget.maxTasks,
        project.budget.maxTasksPerRound, project.budget.maxTaskRetries, project.budget.maxCoordinationRounds,
        project.coordinationRound, project.revision, project.createdAt, project.updatedAt]
    )
    for (const member of members) await this.insertProjectMember(member)
  }

  async updateProject(project: StoredProject, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.projects
       SET display_name=$2,goal=$3,content_mode=$4,status=$5,coordinator_agent_id=$6,coordinator_authority_epoch=$7,
           execution_authority_epoch=$8,content_owner_user_id=$9,max_tasks=$10,max_tasks_per_round=$11,
           max_task_retries=$12,max_coordination_rounds=$13,coordination_round=$14,revision=$15,updated_at=$16
       WHERE project_id=$1 AND revision=$17 AND $15=$17+1`,
      [project.projectId, project.displayName, project.goal, project.contentMode, project.status, project.coordinatorAgentId,
        project.coordinatorAuthorityEpoch, project.executionAuthorityEpoch, project.contentOwnerUserId, project.budget.maxTasks,
        project.budget.maxTasksPerRound, project.budget.maxTaskRetries,
        project.budget.maxCoordinationRounds, project.coordinationRound, project.revision,
        project.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async deleteProject(projectId: string, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `DELETE FROM sciforge_collaboration.projects
       WHERE project_id=$1 AND revision=$2
       RETURNING project_id`,
      [projectId, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjectMember(member: StoredProjectMember): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_members
       (project_membership_id,project_id,user_id,state,authority_epoch,activated_at,
        removal_requested_at,removal_requested_by_user_id,removed_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [member.projectMembershipId, member.projectId, member.userId, member.state,
        member.authorityEpoch, member.activatedAt, member.removalRequestedAt,
        member.removalRequestedByUserId, member.removedAt, member.revision,
        member.createdAt, member.updatedAt]
    )
  }

  async updateProjectMember(member: StoredProjectMember, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.project_members
       SET state=$3,authority_epoch=$4,activated_at=$5,removal_requested_at=$6,
           removal_requested_by_user_id=$7,removed_at=$8,revision=$9,updated_at=$10
       WHERE project_id=$1 AND user_id=$2 AND revision=$11 AND $9=$11+1`,
      [member.projectId, member.userId, member.state, member.authorityEpoch,
        member.activatedAt, member.removalRequestedAt, member.removalRequestedByUserId,
        member.removedAt, member.revision, member.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async upsertWorkerAvailability(
    availability: StoredWorkerAvailability,
    expectedRevision: number | null
  ): Promise<void> {
    if (expectedRevision === null) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.worker_availability
         (agent_id,user_id,device_id,agent_active,device_active,connection_status,last_heartbeat_at,
          runtime_readiness,runtime_capability_tags,accepts_new_offers,active_task_count,
          observed_at,expires_at,revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)`,
        [availability.agentId, availability.userId, availability.deviceId, availability.agentActive,
          availability.deviceActive, availability.connectionStatus, availability.lastHeartbeatAt,
          availability.runtimeReadiness, JSON.stringify(availability.runtimeCapabilityTags),
          availability.acceptsNewOffers, availability.activeTaskCount,
          availability.observedAt, availability.expiresAt,
          availability.revision, availability.createdAt, availability.updatedAt]
      )
      return
    }
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.worker_availability
       SET user_id=$2,device_id=$3,agent_active=$4,device_active=$5,connection_status=$6,
           last_heartbeat_at=$7,runtime_readiness=$8,runtime_capability_tags=$9::jsonb,
           accepts_new_offers=$10,active_task_count=$11,observed_at=$12,expires_at=$13,
           revision=$14,updated_at=$15
       WHERE agent_id=$1 AND user_id=$2 AND device_id=$3 AND revision=$16 AND $14=$16+1`,
      [availability.agentId, availability.userId, availability.deviceId, availability.agentActive,
        availability.deviceActive, availability.connectionStatus, availability.lastHeartbeatAt,
        availability.runtimeReadiness, JSON.stringify(availability.runtimeCapabilityTags),
        availability.acceptsNewOffers, availability.activeTaskCount,
        availability.observedAt, availability.expiresAt,
        availability.revision, availability.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProviderDirectoryPrincipalFact(fact: StoredProviderDirectoryPrincipalFact): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.provider_directory_principal_facts
       (provider_principal_fact_id,user_id,provider_principal,principal_identity_revision,
        provider_binding_attestation_digest,published_by_device_id,readiness,readiness_reason,
        observed_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [fact.providerPrincipalFactId, fact.userId, JSON.stringify(fact.providerPrincipal),
        fact.principalIdentityRevision, fact.providerBindingAttestationDigest,
        fact.publishedByDeviceId, fact.readiness, fact.readinessReason, fact.observedAt,
        fact.revision, fact.createdAt, fact.updatedAt]
    )
  }

  async updateProviderDirectoryPrincipalFact(
    fact: StoredProviderDirectoryPrincipalFact,
    expectedRevision: number
  ): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.provider_directory_principal_facts
       SET provider_principal=$2::jsonb,principal_identity_revision=$3,
           provider_binding_attestation_digest=$4,published_by_device_id=$5,
           readiness=$6,readiness_reason=$7,observed_at=$8,revision=$9,updated_at=$10
       WHERE provider_principal_fact_id=$1 AND user_id=$11 AND revision=$12
         AND provider_principal->'providerInstance'->>'providerInstanceRef'=
             ($2::jsonb)->'providerInstance'->>'providerInstanceRef'
         AND $9=$12+1`,
      [fact.providerPrincipalFactId, JSON.stringify(fact.providerPrincipal),
        fact.principalIdentityRevision, fact.providerBindingAttestationDigest,
        fact.publishedByDeviceId, fact.readiness, fact.readinessReason, fact.observedAt,
        fact.revision, fact.updatedAt, fact.userId, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjectProviderMembershipObservation(
    observation: StoredProjectProviderMembershipObservation
  ): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_provider_membership_observations
       (provider_observation_id,project_id,user_id,provider_principal,binding_revision,
        provider_principal_fact_id,snapshotted_fact_revision,provisioning_revision,source,outcome,
        observer_user_id,observer_device_id,observer_agent_id,provisioning_attestation_id,
        evidence_digest,observed_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [observation.providerObservationId, observation.projectId, observation.userId,
        JSON.stringify(observation.providerPrincipal), observation.bindingRevision,
        observation.providerPrincipalFactId, observation.snapshottedFactRevision,
        observation.provisioningRevision, observation.source, observation.outcome,
        observation.observerUserId, observation.observerDeviceId, observation.observerAgentId,
        observation.provisioningAttestationId, observation.evidenceDigest, observation.observedAt,
        observation.revision, observation.createdAt, observation.updatedAt]
    )
  }

  async upsertProjectContentReadiness(
    readiness: StoredProjectContentReadiness,
    expectedRevision: number | null
  ): Promise<void> {
    if (expectedRevision === null) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.project_content_readiness
         (project_id,user_id,provider_instance,state,reason,provider_principal,binding_revision,last_observation_id,
          provider_principal_fact_id,snapshotted_fact_revision,effective_at,revision,created_at,updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [readiness.projectId, readiness.userId, JSON.stringify(readiness.providerInstance),
          readiness.state, readiness.reason,
          readiness.providerPrincipal === null ? null : JSON.stringify(readiness.providerPrincipal),
          readiness.bindingRevision, readiness.lastObservationId, readiness.providerPrincipalFactId,
          readiness.snapshottedFactRevision, readiness.effectiveAt,
          readiness.revision, readiness.createdAt, readiness.updatedAt]
      )
      return
    }
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.project_content_readiness
       SET provider_instance=$3::jsonb,state=$4,reason=$5,provider_principal=$6::jsonb,
           binding_revision=$7,last_observation_id=$8,provider_principal_fact_id=$9,
           snapshotted_fact_revision=$10,effective_at=$11,revision=$12,updated_at=$13
       WHERE project_id=$1 AND user_id=$2 AND revision=$14 AND $12=$14+1`,
      [readiness.projectId, readiness.userId, JSON.stringify(readiness.providerInstance),
        readiness.state, readiness.reason,
        readiness.providerPrincipal === null ? null : JSON.stringify(readiness.providerPrincipal),
        readiness.bindingRevision, readiness.lastObservationId, readiness.providerPrincipalFactId,
        readiness.snapshottedFactRevision, readiness.effectiveAt,
        readiness.revision, readiness.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async upsertTaskAuthority(authority: StoredTaskAuthority, expectedRevision: number | null): Promise<void> {
    if (expectedRevision === null) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.task_authorities
         (task_authority_id,project_id,user_id,scope,state,authority_epoch,reason,effective_at,
          revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [authority.taskAuthorityId, authority.projectId, authority.userId, authority.scope,
          authority.state, authority.authorityEpoch, authority.reason, authority.effectiveAt,
          authority.revision, authority.createdAt, authority.updatedAt]
      )
      return
    }
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.task_authorities
       SET state=$4,authority_epoch=$5,reason=$6,effective_at=$7,revision=$8,updated_at=$9
       WHERE project_id=$1 AND user_id=$2 AND scope=$3 AND revision=$10 AND $8=$10+1`,
      [authority.projectId, authority.userId, authority.scope, authority.state,
        authority.authorityEpoch, authority.reason, authority.effectiveAt,
        authority.revision, authority.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjectContentProvisioningIntent(intent: StoredProjectContentProvisioningIntent): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_content_provisioning_intents
       (provisioning_intent_id,project_id,provisioning_revision,kind,state,created_by_owner_user_id,
        content_owner_user_id,provider_instance,desired_members,container_display_name,
        current_root_locator,current_binding_revision,intent_digest,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16)`,
      [intent.provisioningIntentId, intent.projectId, intent.provisioningRevision,
        intent.kind, intent.state, intent.createdByOwnerUserId, intent.contentOwnerUserId,
        JSON.stringify(intent.providerInstance), JSON.stringify(intent.desiredMembers), intent.containerDisplayName,
        intent.currentRootLocator === null ? null : JSON.stringify(intent.currentRootLocator),
        intent.currentBindingRevision, intent.intentDigest, intent.revision, intent.createdAt, intent.updatedAt]
    )
  }

  async updateProjectContentProvisioningIntent(
    intent: StoredProjectContentProvisioningIntent,
    expectedRevision: number
  ): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.project_content_provisioning_intents
       SET state=$2,revision=$3,updated_at=$4
       WHERE provisioning_intent_id=$1 AND revision=$5 AND $3=$5+1`,
      [intent.provisioningIntentId, intent.state, intent.revision, intent.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjectContentProvisioningAttestation(
    attestation: StoredProjectContentProvisioningAttestation
  ): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_content_provisioning_attestations
       (provisioning_attestation_id,provisioning_intent_id,project_id,provisioning_revision,
        owner_user_id,principal_identity_revision,provider_binding_attestation_digest,provider_instance,
        root_locator,root_locator_digest,observed_operations,member_observations,member_set_digest,
        observation_started_at,observation_completed_at,device_signature,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16::jsonb,$17,$18,$19)`,
      [attestation.provisioningAttestationId, attestation.provisioningIntentId,
        attestation.projectId, attestation.provisioningRevision, attestation.ownerUserId,
        attestation.principalIdentityRevision, attestation.providerBindingAttestationDigest,
        JSON.stringify(attestation.providerInstance),
        JSON.stringify(attestation.rootLocator), attestation.rootLocatorDigest,
        JSON.stringify(attestation.observedOperations), JSON.stringify(attestation.memberObservations),
        attestation.memberSetDigest, attestation.observationStartedAt, attestation.observationCompletedAt,
        JSON.stringify(attestation.deviceSignature), attestation.revision,
        attestation.createdAt, attestation.updatedAt]
    )
  }

  async upsertProjectContentSpaceBinding(
    binding: StoredProjectContentSpaceBinding,
    expectedRevision: number | null
  ): Promise<void> {
    if (expectedRevision === null) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.project_content_space_bindings
         (project_content_binding_id,project_id,content_owner_user_id,provider_instance,
          root_locator,root_locator_digest,provisioning_intent_id,provisioning_revision,
          attestation_id,attestation_digest,status,status_reason,activated_at,degraded_at,closed_at,
          revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [binding.projectContentBindingId, binding.projectId, binding.contentOwnerUserId,
          JSON.stringify(binding.providerInstance), binding.rootLocator === null ? null : JSON.stringify(binding.rootLocator),
          binding.rootLocatorDigest, binding.provisioningIntentId, binding.provisioningRevision,
          binding.attestationId, binding.attestationDigest, binding.status, binding.statusReason,
          binding.activatedAt, binding.degradedAt, binding.closedAt,
          binding.revision, binding.createdAt, binding.updatedAt]
      )
      return
    }
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.project_content_space_bindings
       SET content_owner_user_id=$2,provider_instance=$3::jsonb,root_locator=$4::jsonb,
           root_locator_digest=$5,provisioning_intent_id=$6,provisioning_revision=$7,
           attestation_id=$8,attestation_digest=$9,status=$10,status_reason=$11,
           activated_at=$12,degraded_at=$13,closed_at=$14,revision=$15,updated_at=$16
       WHERE project_id=$1 AND revision=$17 AND $15=$17+1`,
      [binding.projectId, binding.contentOwnerUserId, JSON.stringify(binding.providerInstance),
        binding.rootLocator === null ? null : JSON.stringify(binding.rootLocator), binding.rootLocatorDigest,
        binding.provisioningIntentId, binding.provisioningRevision, binding.attestationId,
        binding.attestationDigest, binding.status, binding.statusReason, binding.activatedAt,
        binding.degradedAt, binding.closedAt, binding.revision,
        binding.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertExternalOperationJournal(operation: StoredExternalOperationJournal): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.external_operation_journal
       (content_recovery_journal_entry_id,scope,logical_invocation_id,project_id,task_id,
        prepared_task_revision,provisioning_intent_id,provisioning_revision,execution_id,
        prepared_execution_revision,
        operation,request_digest,state,observation_digest,receipt_digest,safe_failure_code,prepared_at,
        dispatched_at,resolved_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [operation.contentRecoveryJournalEntryId, operation.scope, operation.logicalInvocationId,
        operation.projectId, operation.taskId, operation.preparedTaskRevision,
        operation.provisioningIntentId, operation.provisioningRevision, operation.executionId,
        operation.preparedExecutionRevision,
        operation.operation, operation.requestDigest, operation.state, operation.observationDigest,
        operation.receiptDigest, operation.safeFailureCode, operation.preparedAt, operation.dispatchedAt,
        operation.resolvedAt, operation.revision, operation.createdAt, operation.updatedAt]
    )
  }

  async updateExternalOperationJournal(
    operation: StoredExternalOperationJournal,
    expectedRevision: number
  ): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.external_operation_journal
       SET state=$2,observation_digest=$3,receipt_digest=$4,safe_failure_code=$5,
           dispatched_at=$6,resolved_at=$7,revision=$8,updated_at=$9
       WHERE logical_invocation_id=$1 AND revision=$10 AND $8=$10+1`,
      [operation.logicalInvocationId, operation.state, operation.observationDigest,
        operation.receiptDigest, operation.safeFailureCode, operation.dispatchedAt,
        operation.resolvedAt, operation.revision,
        operation.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertVisibleRecoveryAction(action: StoredVisibleRecoveryAction): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.visible_recovery_actions
       (recovery_action_id,project_id,task_id,execution_id,journal_entry_id,audience,action,status,
        requires_fresh_observation,safe_summary,available_at,completed_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [action.recoveryActionId, action.projectId, action.taskId, action.executionId,
        action.journalEntryId, action.audience, action.action, action.status,
        action.requiresFreshObservation, action.safeSummary, action.availableAt, action.completedAt,
        action.revision, action.createdAt, action.updatedAt]
    )
  }

  async updateVisibleRecoveryAction(
    action: StoredVisibleRecoveryAction,
    expectedRevision: number
  ): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.visible_recovery_actions
       SET status=$2,completed_at=$3,revision=$4,updated_at=$5
       WHERE recovery_action_id=$1 AND revision=$6 AND $4=$6+1`,
      [action.recoveryActionId, action.status, action.completedAt, action.revision,
        action.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertCloudResourceRefs(resources: StoredCloudResourceRef[]): Promise<void> {
    for (const resource of resources) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.task_resource_refs
         (resource_ref_id,project_id,task_id,execution_id,assignment_task_revision,binding_revision,intent_digest,
          role,ordinal,locator,locator_digest,status,invalidated_at,revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)`,
        [resource.resourceRefId, resource.projectId, resource.taskId, resource.executionId,
          resource.assignmentTaskRevision, resource.bindingRevision, resource.intentDigest, resource.role,
          resource.ordinal, JSON.stringify(resource.locator), resource.locatorDigest, resource.status,
          resource.invalidatedAt, resource.revision, resource.createdAt, resource.updatedAt]
      )
    }
  }

  async invalidateCloudResourceRefs(taskId: string, executionId: string, invalidatedAt: string): Promise<number> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.task_resource_refs
       SET status='invalidated',invalidated_at=$3,revision=revision+1,updated_at=$3
       WHERE task_id=$1 AND execution_id=$2 AND status='available'`,
      [taskId, executionId, invalidatedAt]
    )
    return result.rowCount ?? 0
  }

  async invalidateCloudResourceRefsForBinding(
    projectId: string,
    bindingRevision: number,
    invalidatedAt: string
  ): Promise<number> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.task_resource_refs
       SET status='invalidated',invalidated_at=$3,revision=revision+1,updated_at=$3
       WHERE project_id=$1 AND binding_revision=$2 AND status='available'`,
      [projectId, bindingRevision, invalidatedAt]
    )
    return result.rowCount ?? 0
  }

  async insertTask(task: StoredTask): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.tasks
       (task_id,project_id,created_by_coordinator_agent_id,title,objective,completion_criteria,
        dependency_task_ids,required_capability_tags,file_intent,current_execution_id,current_execution_state,status,
        execution_count,max_retries,coordination_round,revision,created_at,updated_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [task.taskId, task.projectId, task.createdByCoordinatorAgentId, task.title, task.objective,
        JSON.stringify(task.completionCriteria), JSON.stringify(task.dependencyTaskIds),
        JSON.stringify(task.requiredCapabilityTags),
        task.fileIntent === null ? null : JSON.stringify(task.fileIntent), task.currentExecutionId,
        task.currentExecutionState, task.status, task.executionCount, task.maxRetries,
        task.coordinationRound, task.revision, task.createdAt, task.updatedAt, task.completedAt]
    )
  }

  async updateTask(task: StoredTask, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.tasks
       SET file_intent=$2::jsonb,current_execution_id=$3,current_execution_state=$4,status=$5,
           execution_count=$6,revision=$7,updated_at=$8,completed_at=$9
       WHERE task_id=$1 AND revision=$10 AND $7=$10+1`,
      [task.taskId, task.fileIntent === null ? null : JSON.stringify(task.fileIntent),
        task.currentExecutionId, task.currentExecutionState, task.status,
        task.executionCount, task.revision, task.updatedAt, task.completedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertTaskExecution(execution: StoredTaskExecution): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.task_executions
       (execution_id,task_id,project_id,attempt,offered_by_coordinator_agent_id,assignee_user_id,
        assignee_agent_id,assignee_device_id,state,state_revision,fence,file_intent,
        current_result_submission_id,offered_at,accepted_at,started_at,terminal_at,
        revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [execution.executionId, execution.taskId, execution.projectId, execution.attempt,
        execution.offeredByCoordinatorAgentId, execution.assigneeUserId, execution.assigneeAgentId,
        execution.assigneeDeviceId, execution.state, execution.stateRevision,
        JSON.stringify(execution.fence), execution.fileIntent === null ? null : JSON.stringify(execution.fileIntent),
        execution.currentResultSubmissionId, execution.offeredAt, execution.acceptedAt,
        execution.startedAt, execution.terminalAt, execution.revision, execution.createdAt,
        execution.updatedAt]
    )
  }

  async updateTaskExecution(execution: StoredTaskExecution, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.task_executions
       SET state=$2,state_revision=$3,fence=$4::jsonb,current_result_submission_id=$5,
           accepted_at=$6,started_at=$7,terminal_at=$8,revision=$9,updated_at=$10
       WHERE execution_id=$1 AND revision=$11 AND state_revision=$11
         AND $9=$11+1 AND $3=$11+1`,
      [execution.executionId, execution.state, execution.stateRevision, JSON.stringify(execution.fence),
        execution.currentResultSubmissionId, execution.acceptedAt, execution.startedAt,
        execution.terminalAt, execution.revision, execution.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertTaskOffer(offer: StoredTaskOffer): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.task_offers
       (task_offer_id,execution_id,task_id,project_id,worker_user_id,
        offered_by_coordinator_agent_id,state,reassignment_task_revision,
        offered_at,expires_at,responded_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [offer.taskOfferId, offer.executionId, offer.taskId, offer.projectId, offer.workerUserId,
        offer.offeredByCoordinatorAgentId, offer.state, offer.reassignmentTaskRevision,
        offer.offeredAt, offer.expiresAt, offer.respondedAt, offer.revision,
        offer.createdAt, offer.updatedAt]
    )
  }

  async updateTaskOffer(offer: StoredTaskOffer, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.task_offers
       SET execution_id=$2,state=$3,reassignment_task_revision=$4,
           responded_at=$5,revision=$6,updated_at=$7
       WHERE task_offer_id=$1 AND revision=$8 AND $6=$8+1`,
      [offer.taskOfferId, offer.executionId, offer.state, offer.reassignmentTaskRevision,
        offer.respondedAt, offer.revision, offer.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjectPlan(plan: StoredProjectPlan): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_plans
       (project_plan_id,project_id,coordinator_authority_epoch,state,plan_revision,
        source_input_locators,tasks,rationale,runtime_provenance,plan_digest,submitted_at,
        confirmed_by_user_id,confirmed_at,superseded_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [plan.projectPlanId, plan.projectId, plan.coordinatorAuthorityEpoch, plan.state,
        plan.planRevision, JSON.stringify(plan.sourceInputLocators), JSON.stringify(plan.tasks),
        plan.rationale, JSON.stringify(plan.runtimeProvenance), plan.planDigest, plan.submittedAt,
        plan.confirmedByUserId, plan.confirmedAt, plan.supersededAt, plan.revision,
        plan.createdAt, plan.updatedAt]
    )
  }

  async updateProjectPlan(plan: StoredProjectPlan, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.project_plans
       SET state=$2,submitted_at=$3,confirmed_by_user_id=$4,confirmed_at=$5,
           superseded_at=$6,revision=$7,updated_at=$8
       WHERE project_plan_id=$1 AND revision=$9 AND $7=$9+1`,
      [plan.projectPlanId, plan.state, plan.submittedAt, plan.confirmedByUserId,
        plan.confirmedAt, plan.supersededAt, plan.revision, plan.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertTaskResultSubmission(submission: StoredTaskResultSubmission): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.task_result_submissions
       (result_submission_id,project_id,task_id,execution_id,submitted_task_revision,
        submitted_execution_revision,
        submitted_by_user_id,submitted_by_agent_id,summary,runtime_provenance,outputs,
        recovery_journal_entry_ids,submission_digest,submitted_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)`,
      [submission.resultSubmissionId, submission.projectId, submission.taskId,
        submission.executionId, submission.submittedTaskRevision, submission.submittedExecutionRevision,
        submission.submittedByUserId, submission.submittedByAgentId, submission.summary,
        JSON.stringify(submission.runtimeProvenance), JSON.stringify(submission.outputs),
        JSON.stringify(submission.recoveryJournalEntryIds), submission.submissionDigest,
        submission.submittedAt, submission.revision, submission.createdAt, submission.updatedAt]
    )
  }

  async insertTaskResultReview(review: StoredTaskResultReview): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.task_result_reviews
       (review_decision_id,result_submission_id,project_id,task_id,execution_id,
        reviewed_result_revision,decided_by_user_id,decided_by_coordinator_agent_id,
        coordinator_authority_epoch,decision,instruction,accepted_project_record_id,
        next_task_offer_id,decided_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [review.reviewDecisionId, review.resultSubmissionId, review.projectId, review.taskId,
        review.executionId, review.reviewedResultRevision, review.decidedByUserId,
        review.decidedByCoordinatorAgentId, review.coordinatorAuthorityEpoch, review.decision,
        review.instruction, review.acceptedProjectRecordId, review.nextTaskOfferId,
        review.decidedAt, review.revision, review.createdAt, review.updatedAt]
    )
  }

  async insertProjectFinalSummary(summary: StoredProjectFinalSummary): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_final_summaries
       (project_id,project_record_id,project_plan_id,confirmed_plan_revision,
        accepted_result_submission_ids,summary,created_by_user_id,
        created_by_coordinator_agent_id,coordinator_authority_epoch,completed_at,
        revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [summary.projectId, summary.projectRecordId, summary.projectPlanId,
        summary.confirmedPlanRevision, JSON.stringify(summary.acceptedResultSubmissionIds),
        summary.summary, summary.createdByUserId,
        summary.createdByCoordinatorAgentId, summary.coordinatorAuthorityEpoch,
        summary.completedAt, summary.revision, summary.createdAt, summary.updatedAt]
    )
  }

  async insertProjectRecord(record: StoredProjectRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_records
       (project_record_id,project_id,kind,status,summary,author_user_id,author_agent_id,source_task_id,
        source_result_submission_id,source_human_answer_id,source_revision,
        accepted_by_user_id,accepted_by_agent_id,accepted_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [record.projectRecordId, record.projectId, record.kind, record.status, record.summary,
        record.authorUserId ?? null, record.authorAgentId ?? null, record.sourceTaskId ?? null,
        record.sourceResultSubmissionId ?? null, record.sourceHumanAnswerId ?? null,
        record.sourceRevision ?? null, record.acceptedByUserId, record.acceptedByAgentId,
        record.acceptedAt, record.revision, record.createdAt, record.updatedAt]
    )
  }

  async appendInbox(message: Omit<StoredInboxMessage, 'sequence'>): Promise<StoredInboxMessage> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.inbox_cursors(recipient_kind,recipient_id,next_sequence,acked_sequence,updated_at)
       VALUES ($1,$2,1,0,$3) ON CONFLICT (recipient_kind,recipient_id) DO NOTHING`,
      [message.recipient.kind, message.recipient.id, message.createdAt]
    )
    const cursor = await this.sql.query<{ next_sequence: unknown }>(
      `UPDATE sciforge_collaboration.inbox_cursors
       SET next_sequence=next_sequence+1,updated_at=$3
       WHERE recipient_kind=$1 AND recipient_id=$2
       RETURNING next_sequence-1 AS next_sequence`,
      [message.recipient.kind, message.recipient.id, message.createdAt]
    )
    const sequence = number(cursor.rows[0]?.next_sequence)
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.inbox_messages
       (recipient_kind,recipient_id,sequence,message_id,message_type,payload,created_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [message.recipient.kind, message.recipient.id, sequence, message.messageId, message.messageType,
        JSON.stringify(message.payload), message.createdAt, message.expiresAt]
    )
    return { ...message, sequence }
  }

  async ackInbox(recipient: InboxRecipient, throughSequence: number, updatedAt: string): Promise<StoredInboxCursor> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.inbox_cursors
       SET acked_sequence=GREATEST(acked_sequence,LEAST($3,next_sequence-1)),updated_at=$4
       WHERE recipient_kind=$1 AND recipient_id=$2
       RETURNING *`,
      [recipient.kind, recipient.id, throughSequence, updatedAt]
    )
    if (!result.rows[0]) {
      throw new CollaborationServiceError('validation_failed', 'Inbox does not exist for this recipient.')
    }
    return mapCursor(result.rows[0])
  }

  async insertReceipt(receipt: StoredReceipt): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.receipts
       (receipt_id,actor_key,idempotency_key,request_digest,operation,resource_kind,resource_id,response,created_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [receipt.receiptId, receipt.actorKey, receipt.idempotencyKey, Buffer.from(receipt.requestDigest, 'hex'),
        receipt.operation, receipt.resourceKind ?? null, receipt.resourceId ?? null, JSON.stringify(receipt.response),
        receipt.createdAt, receipt.expiresAt]
    )
  }

  async insertAudit(event: StoredAuditEvent): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.audit_events
       (audit_event_id,actor_kind,actor_user_id,actor_endpoint_id,actor_agent_id,action,resource_kind,resource_id,
        outcome,metadata,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [event.auditEventId, event.actorKind, event.actorUserId ?? null, event.actorEndpointId ?? null,
        event.actorAgentId ?? null, event.action, event.resourceKind ?? null, event.resourceId ?? null,
        event.outcome, JSON.stringify(safeAuditMetadata(event.metadata)), event.createdAt]
    )
  }
}

function expectRevision(rowCount: number | null): void {
  if (rowCount !== 1) throw new CollaborationServiceError('revision_conflict', 'The resource revision changed before this write.')
}

function translateDatabaseError(error: unknown): unknown {
  if (error instanceof CollaborationServiceError) return error
  const candidate = error as { code?: unknown; constraint?: unknown }
  if (candidate?.code === '23505') {
    return new CollaborationServiceError('identity_conflict', 'A unique collaboration identity is already active.')
  }
  if (candidate?.code === '23503') {
    return new CollaborationServiceError('validation_failed', 'A referenced collaboration resource does not exist.')
  }
  return error
}

function string(row: SqlRow, key: string): string { return String(row[key]) }
function optionalString(row: SqlRow, key: string): string | undefined { return row[key] == null ? undefined : String(row[key]) }
function number(value: unknown): number { return Number(value ?? 0) }
function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString() }
function optionalIso(value: unknown): string | undefined { return value == null ? undefined : iso(value) }
function digest(value: unknown): string { return Buffer.isBuffer(value) ? value.toString('hex') : String(value) }
function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function jsonArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : [] }
function jsonStrings(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : [] }

function mapUser(row: SqlRow): StoredUser {
  return { userId: string(row, 'user_id'), displayName: string(row, 'display_name'), status: string(row, 'status') as StoredUser['status'],
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), revokedAt: optionalIso(row.revoked_at) }
}
function mapOidcIdentity(row: SqlRow): StoredOidcIdentity {
  return {
    identityId: string(row, 'identity_id'), userId: string(row, 'user_id'), issuer: string(row, 'issuer'),
    subject: string(row, 'subject'), emailAtLinkTime: optionalString(row, 'email_at_link_time'),
    status: string(row, 'status') as StoredOidcIdentity['status'], revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), revokedAt: optionalIso(row.revoked_at)
  }
}
function mapDeviceEnrollment(row: SqlRow): StoredDeviceEnrollment {
  return {
    enrollmentId: string(row, 'enrollment_id'), userId: string(row, 'user_id'),
    installationId: string(row, 'installation_id'), nonceDigest: digest(row.nonce_digest),
    status: string(row, 'status') as StoredDeviceEnrollment['status'], revision: number(row.revision),
    expiresAt: iso(row.expires_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    consumedAt: optionalIso(row.consumed_at)
  }
}
function mapDevice(row: SqlRow): StoredDevice {
  return {
    deviceId: string(row, 'device_id'), userId: string(row, 'user_id'),
    installationId: string(row, 'installation_id'), displayName: string(row, 'display_name'),
    platform: jsonRecord(row.platform) as StoredDevice['platform'],
    publicKeyJwk: jsonRecord(row.public_key_jwk) as StoredDevice['publicKeyJwk'],
    capabilitySummary: jsonStrings(row.capability_summary), status: string(row, 'status') as StoredDevice['status'],
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    revokedAt: optionalIso(row.revoked_at)
  }
}
function mapChallenge(row: SqlRow): StoredChallenge {
  return { challengeId: string(row, 'challenge_id'), requestedUserId: string(row, 'requested_user_id'), provider: string(row, 'provider'),
    realmId: string(row, 'realm_id'), expectedProviderUserId: string(row, 'expected_provider_user_id'),
    challengeDigest: digest(row.challenge_digest), expiresAt: iso(row.expires_at), createdAt: iso(row.created_at),
    verifiedUserId: optionalString(row, 'verified_user_id'), verifiedEndpointId: optionalString(row, 'verified_endpoint_id'),
    verifiedAt: optionalIso(row.verified_at) }
}
function mapEndpointChallengeRateWindow(row: SqlRow): StoredEndpointChallengeRateWindow {
  return {
    userId: string(row, 'user_id'), provider: string(row, 'provider'), realmId: string(row, 'realm_id'),
    windowStartedAt: iso(row.window_started_at), expiresAt: iso(row.expires_at),
    attemptCount: number(row.attempt_count), revision: number(row.revision), updatedAt: iso(row.updated_at)
  }
}
function mapEndpoint(row: SqlRow): StoredEndpoint {
  return { humanEndpointId: string(row, 'human_endpoint_id'), userId: string(row, 'user_id'), provider: string(row, 'provider'),
    realmId: string(row, 'realm_id'), providerUserId: string(row, 'provider_user_id'), displayName: optionalString(row, 'display_name'),
    assurance: string(row, 'assurance') as StoredEndpoint['assurance'], status: string(row, 'status') as StoredEndpoint['status'],
    revision: number(row.revision), verifiedAt: iso(row.verified_at), updatedAt: iso(row.updated_at), revokedAt: optionalIso(row.revoked_at) }
}
function mapAgent(row: SqlRow): StoredAgent {
  return { agentId: string(row, 'agent_id'), deviceId: string(row, 'device_id'), ownerUserId: string(row, 'owner_user_id'),
    displayName: string(row, 'display_name'), nodeType: string(row, 'node_type'), capabilities: jsonStrings(row.capabilities),
    status: string(row, 'status') as StoredAgent['status'], connectionStatus: string(row, 'connection_status') as StoredAgent['connectionStatus'],
    credentialGeneration: number(row.credential_generation), revision: number(row.revision), lastSeenAt: optionalIso(row.last_seen_at),
    updatedAt: iso(row.updated_at), revokedAt: optionalIso(row.revoked_at) }
}
function mapCredential(row: SqlRow): StoredCredential {
  return { credentialId: string(row, 'credential_id'), kind: string(row, 'kind') as StoredCredential['kind'],
    subjectUserId: string(row, 'subject_user_id'), subjectAgentId: string(row, 'subject_agent_id'), tokenDigest: digest(row.token_digest),
    assurance: string(row, 'assurance') as StoredCredential['assurance'], generation: number(row.generation), createdAt: iso(row.created_at),
    expiresAt: optionalIso(row.expires_at), revokedAt: optionalIso(row.revoked_at) }
}
function mapParticipant(row: SqlRow): StoredParticipant {
  return { userId: string(row, 'user_id'), primaryHumanEndpointId: optionalString(row, 'primary_human_endpoint_id'),
    primaryAgentId: optionalString(row, 'primary_agent_id'), status: string(row, 'status') as StoredParticipant['status'],
    revision: number(row.revision), updatedAt: iso(row.updated_at) }
}
function mapProject(row: SqlRow): StoredProject {
  return { projectId: string(row, 'project_id'), ownerUserId: string(row, 'owner_user_id'), displayName: string(row, 'display_name'), goal: string(row, 'goal'),
    contentMode: string(row, 'content_mode') as StoredProject['contentMode'],
    status: string(row, 'status') as StoredProject['status'], coordinatorAgentId: string(row, 'coordinator_agent_id'),
    coordinatorAuthorityEpoch: number(row.coordinator_authority_epoch),
    executionAuthorityEpoch: number(row.execution_authority_epoch),
    contentOwnerUserId: optionalString(row, 'content_owner_user_id') ?? null,
    budget: { maxTasks: number(row.max_tasks), maxTasksPerRound: number(row.max_tasks_per_round),
      maxTaskRetries: number(row.max_task_retries), maxCoordinationRounds: number(row.max_coordination_rounds) },
    coordinationRound: number(row.coordination_round), revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapMember(row: SqlRow): StoredProjectMember {
  return {
    projectMembershipId: string(row, 'project_membership_id'), projectId: string(row, 'project_id'),
    userId: string(row, 'user_id'),
    state: string(row, 'state') as StoredProjectMember['state'], authorityEpoch: number(row.authority_epoch),
    activatedAt: optionalIso(row.activated_at) ?? null,
    removalRequestedAt: optionalIso(row.removal_requested_at) ?? null,
    removalRequestedByUserId: optionalString(row, 'removal_requested_by_user_id') ?? null,
    removedAt: optionalIso(row.removed_at) ?? null, revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapWorkerAvailability(row: SqlRow): StoredWorkerAvailability {
  return {
    agentId: string(row, 'agent_id'), userId: string(row, 'user_id'), deviceId: string(row, 'device_id'),
    agentActive: Boolean(row.agent_active), deviceActive: Boolean(row.device_active),
    connectionStatus: string(row, 'connection_status') as StoredWorkerAvailability['connectionStatus'],
    lastHeartbeatAt: optionalIso(row.last_heartbeat_at) ?? null,
    runtimeReadiness: string(row, 'runtime_readiness') as StoredWorkerAvailability['runtimeReadiness'],
    runtimeCapabilityTags: jsonStrings(row.runtime_capability_tags),
    acceptsNewOffers: Boolean(row.accepts_new_offers), activeTaskCount: number(row.active_task_count),
    observedAt: iso(row.observed_at), expiresAt: iso(row.expires_at), revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapProviderDirectoryPrincipalFact(row: SqlRow): StoredProviderDirectoryPrincipalFact {
  return {
    providerPrincipalFactId: string(row, 'provider_principal_fact_id'), userId: string(row, 'user_id'),
    providerPrincipal: jsonRecord(row.provider_principal) as StoredProviderDirectoryPrincipalFact['providerPrincipal'],
    principalIdentityRevision: number(row.principal_identity_revision),
    providerBindingAttestationDigest: string(row, 'provider_binding_attestation_digest'),
    publishedByDeviceId: string(row, 'published_by_device_id'),
    readiness: string(row, 'readiness') as StoredProviderDirectoryPrincipalFact['readiness'],
    readinessReason: (optionalString(row, 'readiness_reason') ?? null) as StoredProviderDirectoryPrincipalFact['readinessReason'],
    observedAt: iso(row.observed_at),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapProjectProviderMembershipObservation(row: SqlRow): StoredProjectProviderMembershipObservation {
  return {
    providerObservationId: string(row, 'provider_observation_id'),
    projectId: string(row, 'project_id'), userId: string(row, 'user_id'),
    providerPrincipalFactId: string(row, 'provider_principal_fact_id'),
    snapshottedFactRevision: number(row.snapshotted_fact_revision),
    providerPrincipal: jsonRecord(row.provider_principal) as StoredProjectProviderMembershipObservation['providerPrincipal'],
    bindingRevision: number(row.binding_revision), provisioningRevision: number(row.provisioning_revision),
    source: string(row, 'source') as StoredProjectProviderMembershipObservation['source'],
    outcome: string(row, 'outcome') as StoredProjectProviderMembershipObservation['outcome'],
    observerUserId: string(row, 'observer_user_id'), observerDeviceId: string(row, 'observer_device_id'),
    observerAgentId: optionalString(row, 'observer_agent_id') ?? null,
    provisioningAttestationId: optionalString(row, 'provisioning_attestation_id') ?? null,
    evidenceDigest: string(row, 'evidence_digest'), observedAt: iso(row.observed_at),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapProjectContentReadiness(row: SqlRow): StoredProjectContentReadiness {
  return {
    projectId: string(row, 'project_id'), userId: string(row, 'user_id'),
    providerInstance: jsonRecord(row.provider_instance) as StoredProjectContentReadiness['providerInstance'],
    state: string(row, 'state') as StoredProjectContentReadiness['state'],
    reason: (optionalString(row, 'reason') ?? null) as StoredProjectContentReadiness['reason'],
    providerPrincipalFactId: optionalString(row, 'provider_principal_fact_id') ?? null,
    snapshottedFactRevision: row.snapshotted_fact_revision == null
      ? null
      : number(row.snapshotted_fact_revision),
    providerPrincipal: row.provider_principal == null
      ? null
      : jsonRecord(row.provider_principal) as Exclude<StoredProjectContentReadiness['providerPrincipal'], null>,
    bindingRevision: row.binding_revision == null ? null : number(row.binding_revision),
    lastObservationId: optionalString(row, 'last_observation_id') ?? null,
    effectiveAt: iso(row.effective_at),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapTaskAuthority(row: SqlRow): StoredTaskAuthority {
  return {
    taskAuthorityId: string(row, 'task_authority_id'), projectId: string(row, 'project_id'),
    userId: string(row, 'user_id'), scope: string(row, 'scope') as StoredTaskAuthority['scope'],
    state: string(row, 'state') as StoredTaskAuthority['state'], authorityEpoch: number(row.authority_epoch),
    reason: (optionalString(row, 'reason') ?? null) as StoredTaskAuthority['reason'],
    effectiveAt: iso(row.effective_at),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapTask(row: SqlRow): StoredTask {
  return { taskId: string(row, 'task_id'), projectId: string(row, 'project_id'),
    createdByCoordinatorAgentId: string(row, 'created_by_coordinator_agent_id'),
    title: string(row, 'title'), objective: string(row, 'objective'),
    completionCriteria: jsonStrings(row.completion_criteria), dependencyTaskIds: jsonStrings(row.dependency_task_ids),
    requiredCapabilityTags: jsonStrings(row.required_capability_tags),
    fileIntent: row.file_intent == null ? null : jsonRecord(row.file_intent) as StoredTask['fileIntent'],
    currentExecutionId: optionalString(row, 'current_execution_id') ?? null,
    currentExecutionState: (optionalString(row, 'current_execution_state') ?? null) as StoredTask['currentExecutionState'],
    status: string(row, 'status') as StoredTask['status'], executionCount: number(row.execution_count),
    maxRetries: number(row.max_retries), coordinationRound: number(row.coordination_round), revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), completedAt: optionalIso(row.completed_at) ?? null }
}
function mapTaskExecution(row: SqlRow): StoredTaskExecution {
  return {
    executionId: string(row, 'execution_id'), taskId: string(row, 'task_id'), projectId: string(row, 'project_id'),
    attempt: number(row.attempt), offeredByCoordinatorAgentId: string(row, 'offered_by_coordinator_agent_id'),
    assigneeUserId: string(row, 'assignee_user_id'), assigneeAgentId: string(row, 'assignee_agent_id'),
    assigneeDeviceId: string(row, 'assignee_device_id'),
    state: string(row, 'state') as StoredTaskExecution['state'], stateRevision: number(row.state_revision),
    fence: jsonRecord(row.fence) as StoredTaskExecution['fence'],
    fileIntent: row.file_intent == null ? null : jsonRecord(row.file_intent) as StoredTaskExecution['fileIntent'],
    currentResultSubmissionId: optionalString(row, 'current_result_submission_id') ?? null,
    offeredAt: iso(row.offered_at), acceptedAt: iso(row.accepted_at),
    startedAt: optionalIso(row.started_at) ?? null, terminalAt: optionalIso(row.terminal_at) ?? null,
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapTaskOffer(row: SqlRow): StoredTaskOffer {
  return {
    taskOfferId: string(row, 'task_offer_id'), executionId: optionalString(row, 'execution_id') ?? null,
    taskId: string(row, 'task_id'), projectId: string(row, 'project_id'),
    workerUserId: string(row, 'worker_user_id'),
    offeredByCoordinatorAgentId: string(row, 'offered_by_coordinator_agent_id'),
    state: string(row, 'state') as StoredTaskOffer['state'],
    reassignmentTaskRevision: row.reassignment_task_revision == null
      ? null
      : number(row.reassignment_task_revision),
    offeredAt: iso(row.offered_at),
    expiresAt: iso(row.expires_at), respondedAt: optionalIso(row.responded_at) ?? null,
    revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapProjectPlan(row: SqlRow): StoredProjectPlan {
  return {
    projectPlanId: string(row, 'project_plan_id'), projectId: string(row, 'project_id'),
    coordinatorAuthorityEpoch: number(row.coordinator_authority_epoch),
    state: string(row, 'state') as StoredProjectPlan['state'], planRevision: number(row.plan_revision),
    sourceInputLocators: jsonArray<StoredProjectPlan['sourceInputLocators'][number]>(row.source_input_locators),
    tasks: jsonArray<StoredProjectPlan['tasks'][number]>(row.tasks), rationale: string(row, 'rationale'),
    runtimeProvenance: jsonRecord(row.runtime_provenance) as StoredProjectPlan['runtimeProvenance'],
    planDigest: string(row, 'plan_digest'), submittedAt: optionalIso(row.submitted_at) ?? null,
    revision: number(row.revision), confirmedByUserId: optionalString(row, 'confirmed_by_user_id') ?? null,
    confirmedAt: optionalIso(row.confirmed_at) ?? null, supersededAt: optionalIso(row.superseded_at) ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}
function mapTaskResultSubmission(row: SqlRow): StoredTaskResultSubmission {
  return {
    resultSubmissionId: string(row, 'result_submission_id'), projectId: string(row, 'project_id'),
    taskId: string(row, 'task_id'), executionId: string(row, 'execution_id'),
    submittedByUserId: string(row, 'submitted_by_user_id'),
    submittedByAgentId: string(row, 'submitted_by_agent_id'),
    submittedTaskRevision: number(row.submitted_task_revision),
    submittedExecutionRevision: number(row.submitted_execution_revision), summary: string(row, 'summary'),
    runtimeProvenance: jsonRecord(row.runtime_provenance) as StoredTaskResultSubmission['runtimeProvenance'],
    outputs: jsonArray<StoredTaskResultSubmission['outputs'][number]>(row.outputs),
    recoveryJournalEntryIds: jsonStrings(row.recovery_journal_entry_ids),
    submissionDigest: string(row, 'submission_digest'), revision: number(row.revision),
    submittedAt: iso(row.submitted_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapTaskResultReview(row: SqlRow): StoredTaskResultReview {
  return {
    reviewDecisionId: string(row, 'review_decision_id'),
    resultSubmissionId: string(row, 'result_submission_id'), projectId: string(row, 'project_id'),
    taskId: string(row, 'task_id'), executionId: string(row, 'execution_id'),
    reviewedResultRevision: number(row.reviewed_result_revision),
    decidedByUserId: string(row, 'decided_by_user_id'),
    decidedByCoordinatorAgentId: string(row, 'decided_by_coordinator_agent_id'),
    coordinatorAuthorityEpoch: number(row.coordinator_authority_epoch),
    decision: string(row, 'decision') as StoredTaskResultReview['decision'],
    instruction: optionalString(row, 'instruction') ?? null,
    acceptedProjectRecordId: optionalString(row, 'accepted_project_record_id') ?? null,
    nextTaskOfferId: optionalString(row, 'next_task_offer_id') ?? null,
    decidedAt: iso(row.decided_at), revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapProjectFinalSummary(row: SqlRow): StoredProjectFinalSummary {
  return {
    projectId: string(row, 'project_id'), projectRecordId: string(row, 'project_record_id'),
    projectPlanId: string(row, 'project_plan_id'), confirmedPlanRevision: number(row.confirmed_plan_revision),
    summary: string(row, 'summary'), acceptedResultSubmissionIds: jsonStrings(row.accepted_result_submission_ids),
    createdByUserId: string(row, 'created_by_user_id'),
    createdByCoordinatorAgentId: string(row, 'created_by_coordinator_agent_id'),
    coordinatorAuthorityEpoch: number(row.coordinator_authority_epoch), completedAt: iso(row.completed_at),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapProjectContentSpaceBinding(row: SqlRow): StoredProjectContentSpaceBinding {
  return {
    projectContentBindingId: string(row, 'project_content_binding_id'), projectId: string(row, 'project_id'),
    contentOwnerUserId: string(row, 'content_owner_user_id'),
    providerInstance: jsonRecord(row.provider_instance) as StoredProjectContentSpaceBinding['providerInstance'],
    rootLocator: row.root_locator == null
      ? null
      : jsonRecord(row.root_locator) as Exclude<StoredProjectContentSpaceBinding['rootLocator'], null>,
    rootLocatorDigest: optionalString(row, 'root_locator_digest') ?? null,
    provisioningIntentId: string(row, 'provisioning_intent_id'),
    provisioningRevision: number(row.provisioning_revision),
    attestationId: optionalString(row, 'attestation_id') ?? null,
    attestationDigest: optionalString(row, 'attestation_digest') ?? null,
    status: string(row, 'status') as StoredProjectContentSpaceBinding['status'],
    statusReason: (optionalString(row, 'status_reason') ?? null) as StoredProjectContentSpaceBinding['statusReason'],
    activatedAt: optionalIso(row.activated_at) ?? null, degradedAt: optionalIso(row.degraded_at) ?? null,
    closedAt: optionalIso(row.closed_at) ?? null,
    revision: number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}
function mapProjectContentProvisioningIntent(row: SqlRow): StoredProjectContentProvisioningIntent {
  return {
    provisioningIntentId: string(row, 'provisioning_intent_id'), projectId: string(row, 'project_id'),
    provisioningRevision: number(row.provisioning_revision),
    kind: string(row, 'kind') as StoredProjectContentProvisioningIntent['kind'],
    state: string(row, 'state') as StoredProjectContentProvisioningIntent['state'],
    createdByOwnerUserId: string(row, 'created_by_owner_user_id'),
    contentOwnerUserId: string(row, 'content_owner_user_id'),
    providerInstance: jsonRecord(row.provider_instance) as StoredProjectContentProvisioningIntent['providerInstance'],
    desiredMembers: jsonArray<StoredProjectContentProvisioningIntent['desiredMembers'][number]>(row.desired_members),
    containerDisplayName: string(row, 'container_display_name'),
    currentRootLocator: row.current_root_locator == null
      ? null
      : jsonRecord(row.current_root_locator) as Exclude<StoredProjectContentProvisioningIntent['currentRootLocator'], null>,
    currentBindingRevision: row.current_binding_revision == null ? null : number(row.current_binding_revision),
    intentDigest: string(row, 'intent_digest'),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapProjectContentProvisioningAttestation(row: SqlRow): StoredProjectContentProvisioningAttestation {
  return {
    provisioningAttestationId: string(row, 'provisioning_attestation_id'),
    provisioningIntentId: string(row, 'provisioning_intent_id'), projectId: string(row, 'project_id'),
    provisioningRevision: number(row.provisioning_revision), ownerUserId: string(row, 'owner_user_id'),
    principalIdentityRevision: number(row.principal_identity_revision),
    providerBindingAttestationDigest: string(row, 'provider_binding_attestation_digest'),
    providerInstance: jsonRecord(row.provider_instance) as StoredProjectContentProvisioningAttestation['providerInstance'],
    rootLocator: jsonRecord(row.root_locator) as StoredProjectContentProvisioningAttestation['rootLocator'],
    rootLocatorDigest: string(row, 'root_locator_digest'),
    observedOperations: jsonArray<StoredProjectContentProvisioningAttestation['observedOperations'][number]>(row.observed_operations),
    memberObservations: jsonArray<StoredProjectContentProvisioningAttestation['memberObservations'][number]>(row.member_observations),
    memberSetDigest: string(row, 'member_set_digest'), observationStartedAt: iso(row.observation_started_at),
    observationCompletedAt: iso(row.observation_completed_at),
    deviceSignature: jsonRecord(row.device_signature) as StoredProjectContentProvisioningAttestation['deviceSignature'],
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapExternalOperationJournal(row: SqlRow): StoredExternalOperationJournal {
  return {
    contentRecoveryJournalEntryId: string(row, 'content_recovery_journal_entry_id'),
    scope: string(row, 'scope') as StoredExternalOperationJournal['scope'],
    logicalInvocationId: string(row, 'logical_invocation_id'), projectId: string(row, 'project_id'),
    taskId: optionalString(row, 'task_id') ?? null,
    preparedTaskRevision: row.prepared_task_revision == null ? null : number(row.prepared_task_revision),
    provisioningIntentId: optionalString(row, 'provisioning_intent_id') ?? null,
    provisioningRevision: row.provisioning_revision == null ? null : number(row.provisioning_revision),
    executionId: optionalString(row, 'execution_id') ?? null,
    preparedExecutionRevision: row.prepared_execution_revision == null
      ? null
      : number(row.prepared_execution_revision),
    operation: string(row, 'operation') as StoredExternalOperationJournal['operation'],
    requestDigest: string(row, 'request_digest'),
    state: string(row, 'state') as StoredExternalOperationJournal['state'],
    observationDigest: optionalString(row, 'observation_digest') ?? null,
    receiptDigest: optionalString(row, 'receipt_digest') ?? null,
    safeFailureCode: optionalString(row, 'safe_failure_code') ?? null,
    preparedAt: iso(row.prepared_at), dispatchedAt: optionalIso(row.dispatched_at) ?? null,
    resolvedAt: optionalIso(row.resolved_at) ?? null, revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapVisibleRecoveryAction(row: SqlRow): StoredVisibleRecoveryAction {
  return {
    recoveryActionId: string(row, 'recovery_action_id'), projectId: string(row, 'project_id'),
    taskId: optionalString(row, 'task_id') ?? null,
    executionId: optionalString(row, 'execution_id') ?? null,
    journalEntryId: string(row, 'journal_entry_id'),
    audience: string(row, 'audience') as StoredVisibleRecoveryAction['audience'],
    action: string(row, 'action') as StoredVisibleRecoveryAction['action'],
    status: string(row, 'status') as StoredVisibleRecoveryAction['status'],
    requiresFreshObservation: Boolean(row.requires_fresh_observation),
    safeSummary: string(row, 'safe_summary'), availableAt: iso(row.available_at),
    completedAt: optionalIso(row.completed_at) ?? null, revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapCloudResourceRef(row: SqlRow): StoredCloudResourceRef {
  return {
    resourceRefId: string(row, 'resource_ref_id'), projectId: string(row, 'project_id'),
    taskId: string(row, 'task_id'), executionId: string(row, 'execution_id'),
    assignmentTaskRevision: number(row.assignment_task_revision), bindingRevision: number(row.binding_revision),
    intentDigest: string(row, 'intent_digest'), role: string(row, 'role') as StoredCloudResourceRef['role'],
    ordinal: number(row.ordinal), locator: jsonRecord(row.locator) as StoredCloudResourceRef['locator'],
    locatorDigest: string(row, 'locator_digest'), status: string(row, 'status') as StoredCloudResourceRef['status'],
    invalidatedAt: optionalIso(row.invalidated_at) ?? null, revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  }
}
function mapRecord(row: SqlRow): StoredProjectRecord {
  return { projectRecordId: string(row, 'project_record_id'), projectId: string(row, 'project_id'),
    kind: string(row, 'kind') as StoredProjectRecord['kind'], status: string(row, 'status') as StoredProjectRecord['status'],
    summary: string(row, 'summary'), authorUserId: string(row, 'author_user_id'), authorAgentId: string(row, 'author_agent_id'),
    sourceTaskId: optionalString(row, 'source_task_id'), sourceRevision: row.source_revision == null ? undefined : number(row.source_revision),
    sourceResultSubmissionId: optionalString(row, 'source_result_submission_id'),
    sourceHumanAnswerId: optionalString(row, 'source_human_answer_id'),
    acceptedByUserId: string(row, 'accepted_by_user_id'), acceptedByAgentId: string(row, 'accepted_by_agent_id'),
    acceptedAt: iso(row.accepted_at), revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapProjection(row: SqlRow): StoredProjection {
  return { projectionId: string(row, 'projection_id'), ownerUserId: string(row, 'owner_user_id'), agentId: string(row, 'agent_id'),
    humanEndpointId: string(row, 'human_endpoint_id'), locator: jsonRecord(row.locator) as StoredProjection['locator'],
    locatorRevision: number(row.locator_revision), displayName: string(row, 'display_name'), status: string(row, 'status') as StoredProjection['status'],
    allowedSenderUserIds: jsonStrings(row.allowed_sender_user_ids), lastErrorCode: optionalString(row, 'last_error_code'),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapManagedContainer(row: SqlRow): StoredManagedContainer {
  return {
    managedContainerId: string(row, 'managed_container_id'),
    ownerUserId: string(row, 'owner_user_id'),
    humanEndpointId: string(row, 'human_endpoint_id'),
    installationId: string(row, 'installation_id'),
    provider: string(row, 'provider'),
    realmId: string(row, 'realm_id'),
    ownerProviderUserId: string(row, 'owner_provider_user_id'),
    stableKey: string(row, 'stable_key'),
    displayName: string(row, 'display_name'),
    externalContainerId: optionalString(row, 'external_container_id'),
    policy: jsonRecord(row.policy) as StoredManagedContainer['policy'],
    observedChecks: row.observed_checks == null
      ? undefined
      : jsonRecord(row.observed_checks) as StoredManagedContainer['observedChecks'],
    status: string(row, 'status') as StoredManagedContainer['status'],
    lastVerifiedAt: optionalIso(row.last_verified_at),
    safeErrorCode: optionalString(row, 'safe_error_code'),
    revision: number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}
function mapPrivateContainerDiscovery(row: SqlRow): StoredPrivateContainerDiscovery {
  return {
    ownerUserId: string(row, 'owner_user_id'), humanEndpointId: string(row, 'human_endpoint_id'),
    installationId: string(row, 'installation_id'), provider: string(row, 'provider'), realmId: string(row, 'realm_id'),
    externalContainerId: string(row, 'external_container_id'), displayName: string(row, 'display_name'),
    observedAt: iso(row.observed_at), expiresAt: iso(row.expires_at)
  }
}
function mapPrivateContainerClaim(row: SqlRow): StoredPrivateContainerClaim {
  return {
    claimId: string(row, 'claim_id'), ownerUserId: string(row, 'owner_user_id'),
    humanEndpointId: string(row, 'human_endpoint_id'), installationId: string(row, 'installation_id'),
    provider: string(row, 'provider'), realmId: string(row, 'realm_id'),
    externalContainerId: string(row, 'external_container_id'), displayName: string(row, 'display_name'),
    claimedAt: iso(row.claimed_at)
  }
}
function mapManagedContainerJob(row: SqlRow): StoredManagedContainerJob {
  return {
    jobId: string(row, 'job_id'),
    managedContainerId: string(row, 'managed_container_id'),
    operation: string(row, 'operation') as StoredManagedContainerJob['operation'],
    desiredRevision: number(row.desired_revision),
    state: string(row, 'state') as StoredManagedContainerJob['state'],
    attemptCount: number(row.attempt_count),
    nextAttemptAt: iso(row.next_attempt_at),
    leaseOwner: optionalString(row, 'lease_owner'),
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    safeErrorCode: optionalString(row, 'safe_error_code'),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}

function mapRemoteApproval(row: SqlRow): StoredRemoteCapabilityApproval {
  return {
    remoteApprovalId: string(row, 'remote_approval_id'),
    ownerUserId: string(row, 'owner_user_id'),
    agentId: string(row, 'agent_id'),
    projectionId: string(row, 'projection_id'),
    locator: jsonRecord(row.locator) as StoredRemoteCapabilityApproval['locator'],
    locatorRevision: number(row.locator_revision),
    runtimeId: string(row, 'runtime_id'),
    threadId: string(row, 'thread_id'),
    turnId: string(row, 'turn_id'),
    capabilityRequestId: string(row, 'capability_request_id'),
    desktopApprovalId: string(row, 'desktop_approval_id'),
    referenceDigest: string(row, 'reference_digest'),
    safeSummary: string(row, 'safe_summary'),
    effect: string(row, 'effect') as StoredRemoteCapabilityApproval['effect'],
    interactionMode: string(row, 'interaction_mode') as StoredRemoteCapabilityApproval['interactionMode'],
    remoteEligible: Boolean(row.remote_eligible),
    status: string(row, 'status') as StoredRemoteCapabilityApproval['status'],
    providerCardMessageId: optionalString(row, 'provider_card_message_id'),
    decisionEventId: optionalString(row, 'decision_event_id'),
    decisionId: optionalString(row, 'decision_id'),
    revision: number(row.revision),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}
function mapProjectBinding(row: SqlRow): StoredProjectEndpointBinding {
  return { projectEndpointBindingId: string(row, 'project_endpoint_binding_id'), projectId: string(row, 'project_id'),
    locator: jsonRecord(row.locator) as StoredProjectEndpointBinding['locator'], locatorRevision: number(row.locator_revision),
    status: string(row, 'status') as StoredProjectEndpointBinding['status'], lastErrorCode: optionalString(row, 'last_error_code'),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapProjectInput(row: SqlRow): StoredProjectInput {
  return { projectInputId: string(row, 'project_input_id'), projectId: string(row, 'project_id'),
    senderUserId: string(row, 'sender_user_id'), sourceHumanEndpointId: string(row, 'source_human_endpoint_id'),
    providerMessageId: string(row, 'provider_message_id'), sequence: number(row.sequence), text: string(row, 'text'),
    status: string(row, 'status') as StoredProjectInput['status'], revision: number(row.revision),
    occurredAt: iso(row.occurred_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapHumanRequest(row: SqlRow): StoredHumanRequest {
  return { humanRequestId: string(row, 'human_request_id'), projectId: string(row, 'project_id'),
    context: mapHumanNeededContext(row),
    targetUserId: string(row, 'target_user_id'), requestedByAgentId: string(row, 'requested_by_agent_id'),
    requiredAssurance: string(row, 'required_assurance') as StoredHumanRequest['requiredAssurance'], prompt: string(row, 'prompt'),
    confirmableAction: row.confirmable_action == null
      ? null
      : jsonRecord(row.confirmable_action) as StoredHumanRequest['confirmableAction'],
    status: string(row, 'status') as StoredHumanRequest['status'], revision: number(row.revision), expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapHumanAnswer(row: SqlRow): StoredHumanAnswer {
  return { humanAnswerId: string(row, 'human_answer_id'), humanRequestId: string(row, 'human_request_id'),
    projectId: string(row, 'project_id'), context: mapHumanNeededContext(row),
    requestRevision: number(row.request_revision),
    answeredByUserId: string(row, 'answered_by_user_id'),
    answeredFrom: mapHumanAnswerSource(row),
    assurance: string(row, 'assurance') as StoredHumanAnswer['assurance'], answer: string(row, 'answer'),
    decision: (optionalString(row, 'decision') ?? null) as StoredHumanAnswer['decision'],
    confirmationId: optionalString(row, 'confirmation_id') ?? null, revision: number(row.revision),
    answeredAt: iso(row.answered_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}

function mapHumanNeededContext(row: SqlRow): StoredHumanRequest['context'] {
  const scope = string(row, 'request_scope')
  if (scope === 'worker_execution') {
    return {
      scope,
      taskId: string(row, 'task_id'),
      executionId: string(row, 'execution_id')
    }
  }
  if (scope === 'coordinator_project') {
    return { scope, coordinatorAuthorityEpoch: number(row.coordinator_authority_epoch) }
  }
  throw new TypeError('HumanNeeded request_scope is invalid.')
}

function mapHumanAnswerSource(row: SqlRow): StoredHumanAnswer['answeredFrom'] {
  const oidcIdentityId = optionalString(row, 'answered_from_oidc_identity_id')
  const humanEndpointId = optionalString(row, 'answered_from_human_endpoint_id')
  if (oidcIdentityId !== undefined && humanEndpointId === undefined) {
    return { type: 'oidc_user', oidcIdentityId }
  }
  if (humanEndpointId !== undefined && oidcIdentityId === undefined) {
    return { type: 'human_endpoint', humanEndpointId }
  }
  throw new TypeError('HumanAnswer must have exactly one authenticated Human source.')
}
function mapCursor(row: SqlRow): StoredInboxCursor {
  return { recipient: { kind: string(row, 'recipient_kind') as InboxRecipient['kind'], id: string(row, 'recipient_id') },
    nextSequence: number(row.next_sequence), ackedSequence: number(row.acked_sequence), updatedAt: iso(row.updated_at) }
}
function mapInbox(row: SqlRow): StoredInboxMessage {
  return { recipient: { kind: string(row, 'recipient_kind') as InboxRecipient['kind'], id: string(row, 'recipient_id') },
    sequence: number(row.sequence), messageId: string(row, 'message_id'), messageType: string(row, 'message_type'), payload: jsonRecord(row.payload),
    createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) }
}
function mapReceipt(row: SqlRow): StoredReceipt {
  return { receiptId: string(row, 'receipt_id'), actorKey: string(row, 'actor_key'), idempotencyKey: string(row, 'idempotency_key'),
    requestDigest: digest(row.request_digest), operation: string(row, 'operation'), resourceKind: optionalString(row, 'resource_kind'),
    resourceId: optionalString(row, 'resource_id'), response: jsonRecord(row.response), createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) }
}
