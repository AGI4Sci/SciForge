import { createRequire } from 'node:module'

import { CollaborationServiceError } from './errors.js'
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
  StoredHumanAnswer
} from './model.js'
import type {
  CollaborationReadRepository,
  CollaborationRepository,
  CollaborationTransaction
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
  getEndpoint(id: string): Promise<StoredEndpoint | null> { return this.read().getEndpoint(id) }
  getEndpointByProviderIdentity(provider: string, realmId: string, providerUserId: string): Promise<StoredEndpoint | null> {
    return this.read().getEndpointByProviderIdentity(provider, realmId, providerUserId)
  }
  getAgent(agentId: string): Promise<StoredAgent | null> { return this.read().getAgent(agentId) }
  getAgentByInstallation(id: string): Promise<StoredAgent | null> { return this.read().getAgentByInstallation(id) }
  getParticipant(userId: string): Promise<StoredParticipant | null> { return this.read().getParticipant(userId) }
  listEndpointsForUser(userId: string): Promise<StoredEndpoint[]> { return this.read().listEndpointsForUser(userId) }
  listAgentsForUser(userId: string): Promise<StoredAgent[]> { return this.read().listAgentsForUser(userId) }
  getProjection(id: string): Promise<StoredProjection | null> { return this.read().getProjection(id) }
  getProjectionByLocator(provider: string, realmId: string, containerId: string, topicId: string): Promise<StoredProjection | null> {
    return this.read().getProjectionByLocator(provider, realmId, containerId, topicId)
  }
  listProjectionsForOwner(userId: string): Promise<StoredProjection[]> { return this.read().listProjectionsForOwner(userId) }
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
  getHumanAnswerForRequest(id: string): Promise<StoredHumanAnswer | null> { return this.read().getHumanAnswerForRequest(id) }
  getProject(projectId: string): Promise<StoredProject | null> { return this.read().getProject(projectId) }
  listActiveProjectsForCoordinator(agentId: string): Promise<StoredProject[]> {
    return this.read().listActiveProjectsForCoordinator(agentId)
  }
  getProjectMember(projectId: string, userId: string): Promise<StoredProjectMember | null> {
    return this.read().getProjectMember(projectId, userId)
  }
  listProjectMembers(projectId: string): Promise<StoredProjectMember[]> { return this.read().listProjectMembers(projectId) }
  countProjectTasks(projectId: string, round?: number): Promise<number> { return this.read().countProjectTasks(projectId, round) }
  listOpenTasksForAgent(agentId: string): Promise<StoredTask[]> { return this.read().listOpenTasksForAgent(agentId) }
  getTask(taskId: string): Promise<StoredTask | null> { return this.read().getTask(taskId) }
  getProjectRecord(id: string): Promise<StoredProjectRecord | null> { return this.read().getProjectRecord(id) }
  listProjectRecords(projectId: string, acceptedOnly: boolean): Promise<StoredProjectRecord[]> {
    return this.read().listProjectRecords(projectId, acceptedOnly)
  }
  getCredentialByDigest(digest: string): Promise<StoredCredential | null> { return this.read().getCredentialByDigest(digest) }
  getReceipt(actorKey: string, key: string): Promise<StoredReceipt | null> { return this.read().getReceipt(actorKey, key) }
  getReceiptById(receiptId: string): Promise<StoredReceipt | null> { return this.read().getReceiptById(receiptId) }
  getInboxCursor(recipient: InboxRecipient): Promise<StoredInboxCursor | null> { return this.read().getInboxCursor(recipient) }
  pullInbox(recipient: InboxRecipient, after: number, limit: number, now: string): Promise<StoredInboxMessage[]> {
    return this.read().pullInbox(recipient, after, limit, now)
  }
}

class PostgresReadRepository implements CollaborationReadRepository {
  constructor(readonly sql: Pick<SqlPool, 'query'> | Pick<SqlConnection, 'query'>) {}

  async getUser(userId: string): Promise<StoredUser | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.user_principals WHERE user_id = $1`, [userId])
    return result.rows[0] ? mapUser(result.rows[0]) : null
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

  async getAgentByInstallation(installationId: string): Promise<StoredAgent | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.agent_nodes WHERE installation_id = $1`, [installationId])
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

  async getHumanAnswerForRequest(humanRequestId: string): Promise<StoredHumanAnswer | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.human_answers WHERE human_request_id=$1`, [humanRequestId])
    return result.rows[0] ? mapHumanAnswer(result.rows[0]) : null
  }

  async getProject(projectId: string): Promise<StoredProject | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.projects WHERE project_id = $1`, [projectId])
    return result.rows[0] ? mapProject(result.rows[0]) : null
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

  async countProjectTasks(projectId: string, coordinationRound?: number): Promise<number> {
    const result = await this.sql.query<{ count: unknown }>(
      coordinationRound === undefined
        ? `SELECT count(*) AS count FROM sciforge_collaboration.tasks WHERE project_id = $1`
        : `SELECT count(*) AS count FROM sciforge_collaboration.tasks WHERE project_id = $1 AND coordination_round = $2`,
      coordinationRound === undefined ? [projectId] : [projectId, coordinationRound]
    )
    return number(result.rows[0]?.count)
  }

  async getTask(taskId: string): Promise<StoredTask | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.tasks WHERE task_id = $1`, [taskId])
    return result.rows[0] ? mapTask(result.rows[0]) : null
  }

  async listOpenTasksForAgent(agentId: string): Promise<StoredTask[]> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.tasks
       WHERE assignee_agent_id=$1 AND status IN ('offered','accepted','in_progress','needs_human')
       ORDER BY created_at,task_id`,
      [agentId]
    )
    return result.rows.map(mapTask)
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

  async insertChallenge(challenge: StoredChallenge): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.human_endpoint_challenges
       (challenge_id,requested_user_id,provider,realm_id,expected_provider_user_id,challenge_digest,poll_secret_digest,
        requested_display_name,expires_at,verified_user_id,verified_endpoint_id,verified_at,consumed_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [challenge.challengeId, challenge.requestedUserId ?? null, challenge.provider, challenge.realmId,
        challenge.expectedProviderUserId ?? null,
        Buffer.from(challenge.challengeDigest, 'hex'), Buffer.from(challenge.pollSecretDigest, 'hex'),
        challenge.requestedDisplayName, challenge.expiresAt, challenge.verifiedUserId ?? null,
        challenge.verifiedEndpointId ?? null, challenge.verifiedAt ?? null, challenge.consumedAt ?? null, challenge.createdAt]
    )
  }

  async getChallenge(challengeId: string): Promise<StoredChallenge | null> {
    const result = await this.sql.query(`SELECT * FROM sciforge_collaboration.human_endpoint_challenges WHERE challenge_id=$1 FOR UPDATE`, [challengeId])
    return result.rows[0] ? mapChallenge(result.rows[0]) : null
  }

  async getChallengeByCodeDigest(challengeDigest: string): Promise<StoredChallenge | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.human_endpoint_challenges WHERE challenge_digest=$1 FOR UPDATE`,
      [Buffer.from(challengeDigest, 'hex')]
    )
    return result.rows[0] ? mapChallenge(result.rows[0]) : null
  }

  async getChallengeByPollDigest(pollSecretDigest: string): Promise<StoredChallenge | null> {
    const result = await this.sql.query(
      `SELECT * FROM sciforge_collaboration.human_endpoint_challenges WHERE poll_secret_digest=$1 FOR UPDATE`,
      [Buffer.from(pollSecretDigest, 'hex')]
    )
    return result.rows[0] ? mapChallenge(result.rows[0]) : null
  }

  async verifyChallenge(challengeId: string, userId: string, endpointId: string, verifiedAt: string): Promise<boolean> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.human_endpoint_challenges
       SET verified_user_id=$2, verified_endpoint_id=$3, verified_at=$4
       WHERE challenge_id=$1 AND verified_at IS NULL AND consumed_at IS NULL`,
      [challengeId, userId, endpointId, verifiedAt]
    )
    return result.rowCount === 1
  }

  async consumeChallenge(challengeId: string, consumedAt: string): Promise<boolean> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.human_endpoint_challenges SET consumed_at=$2
       WHERE challenge_id=$1 AND verified_at IS NOT NULL AND consumed_at IS NULL`,
      [challengeId, consumedAt]
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
       (agent_id,installation_id,owner_user_id,display_name,node_type,capabilities,status,connection_status,
        credential_generation,revision,last_seen_at,updated_at,revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
      [agent.agentId, agent.installationId, agent.ownerUserId, agent.displayName, agent.nodeType,
        JSON.stringify(agent.capabilities), agent.status, agent.connectionStatus, agent.credentialGeneration,
        agent.revision, agent.lastSeenAt ?? null, agent.updatedAt, agent.revokedAt ?? null]
    )
  }

  async updateAgent(agent: StoredAgent, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.agent_nodes
       SET owner_user_id=$2,display_name=$3,node_type=$4,capabilities=$5::jsonb,status=$6,connection_status=$7,
           credential_generation=$8,revision=$9,last_seen_at=$10,updated_at=$11,revoked_at=$12
       WHERE agent_id=$1 AND revision=$13`,
      [agent.agentId, agent.ownerUserId, agent.displayName, agent.nodeType, JSON.stringify(agent.capabilities),
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

  async revokeCredentials(kind: StoredCredential['kind'], subjectId: string, revokedAt: string): Promise<number> {
    const result = await this.sql.query(
      kind === 'user'
        ? `UPDATE sciforge_collaboration.credentials SET revoked_at=$3 WHERE kind=$1 AND subject_user_id=$2 AND revoked_at IS NULL`
        : `UPDATE sciforge_collaboration.credentials SET revoked_at=$3 WHERE kind=$1 AND subject_agent_id=$2 AND revoked_at IS NULL`,
      [kind, subjectId, revokedAt]
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
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.human_requests
       (human_request_id,project_id,task_id,target_user_id,requested_by_agent_id,required_assurance,prompt,status,
        revision,expires_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [request.humanRequestId, request.projectId, request.taskId, request.targetUserId, request.requestedByAgentId,
        request.requiredAssurance, request.prompt, request.status, request.revision, request.expiresAt,
        request.createdAt, request.updatedAt]
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
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.human_answers
       (human_answer_id,human_request_id,project_id,task_id,request_revision,answered_by_user_id,
        answered_from_human_endpoint_id,assurance,answer,revision,answered_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [answer.humanAnswerId, answer.humanRequestId, answer.projectId, answer.taskId, answer.requestRevision,
        answer.answeredByUserId, answer.answeredFromHumanEndpointId, answer.assurance, answer.answer,
        answer.revision, answer.answeredAt, answer.createdAt, answer.updatedAt]
    )
  }

  async insertProject(project: StoredProject, members: StoredProjectMember[]): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.projects
       (project_id,owner_user_id,display_name,goal,status,coordinator_agent_id,max_tasks,max_tasks_per_round,max_task_retries,
        max_coordination_rounds,coordination_round,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [project.projectId, project.ownerUserId, project.displayName, project.goal, project.status, project.coordinatorAgentId,
        project.budgets.maxTasks, project.budgets.maxTasksPerRound, project.budgets.maxTaskRetries,
        project.budgets.maxCoordinationRounds, project.coordinationRound, project.revision, project.createdAt, project.updatedAt]
    )
    for (const member of members) {
      await this.sql.query(
        `INSERT INTO sciforge_collaboration.project_members(project_id,user_id,role,active,created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [member.projectId, member.userId, member.role, member.active, member.createdAt]
      )
    }
  }

  async updateProject(project: StoredProject, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.projects
       SET display_name=$2,goal=$3,status=$4,coordinator_agent_id=$5,max_tasks=$6,max_tasks_per_round=$7,max_task_retries=$8,
           max_coordination_rounds=$9,coordination_round=$10,revision=$11,updated_at=$12
       WHERE project_id=$1 AND revision=$13`,
      [project.projectId, project.displayName, project.goal, project.status, project.coordinatorAgentId, project.budgets.maxTasks,
        project.budgets.maxTasksPerRound, project.budgets.maxTaskRetries, project.budgets.maxCoordinationRounds,
        project.coordinationRound, project.revision, project.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertTask(task: StoredTask): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.tasks
       (task_id,project_id,assignee_agent_id,created_by_agent_id,title,objective,completion_criteria,dependency_task_ids,status,retry_count,
        max_retries,coordination_round,active_turn_id,result_summary,failure_summary,revision,created_at,updated_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [task.taskId, task.projectId, task.assigneeAgentId, task.createdByAgentId, task.title, task.objective,
        JSON.stringify(task.completionCriteria), JSON.stringify(task.dependencyTaskIds), task.status, task.retryCount,
        task.maxRetries, task.coordinationRound, task.activeTurnId ?? null, task.resultSummary ?? null,
        task.failureSummary ?? null, task.revision, task.createdAt, task.updatedAt, task.completedAt ?? null]
    )
  }

  async updateTask(task: StoredTask, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.tasks
       SET assignee_agent_id=$2,title=$3,objective=$4,completion_criteria=$5::jsonb,dependency_task_ids=$6::jsonb,status=$7,retry_count=$8,
           max_retries=$9,coordination_round=$10,active_turn_id=$11,result_summary=$12,failure_summary=$13,revision=$14,updated_at=$15,completed_at=$16
       WHERE task_id=$1 AND revision=$17`,
      [task.taskId, task.assigneeAgentId, task.title, task.objective, JSON.stringify(task.completionCriteria),
        JSON.stringify(task.dependencyTaskIds), task.status, task.retryCount, task.maxRetries, task.coordinationRound,
        task.activeTurnId ?? null, task.resultSummary ?? null, task.failureSummary ?? null, task.revision,
        task.updatedAt, task.completedAt ?? null, expectedRevision]
    )
    expectRevision(result.rowCount)
  }

  async insertProjectRecord(record: StoredProjectRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO sciforge_collaboration.project_records
       (project_record_id,project_id,kind,status,summary,author_user_id,author_agent_id,source_task_id,source_revision,
        accepted_by_user_id,accepted_by_agent_id,accepted_at,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [record.projectRecordId, record.projectId, record.kind, record.status, record.summary,
        record.authorUserId ?? null, record.authorAgentId ?? null, record.sourceTaskId ?? null,
        record.sourceRevision ?? null, record.acceptedByUserId ?? null, record.acceptedByAgentId ?? null,
        record.acceptedAt ?? null, record.revision, record.createdAt, record.updatedAt]
    )
  }

  async updateProjectRecord(record: StoredProjectRecord, expectedRevision: number): Promise<void> {
    const result = await this.sql.query(
      `UPDATE sciforge_collaboration.project_records
       SET kind=$2,status=$3,summary=$4,accepted_by_user_id=$5,accepted_by_agent_id=$6,accepted_at=$7,revision=$8,updated_at=$9
       WHERE project_record_id=$1 AND revision=$10`,
      [record.projectRecordId, record.kind, record.status, record.summary, record.acceptedByUserId ?? null,
        record.acceptedByAgentId ?? null, record.acceptedAt ?? null, record.revision, record.updatedAt, expectedRevision]
    )
    expectRevision(result.rowCount)
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
        event.outcome, JSON.stringify(event.metadata), event.createdAt]
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
function jsonStrings(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : [] }

function mapUser(row: SqlRow): StoredUser {
  return { userId: string(row, 'user_id'), displayName: string(row, 'display_name'), status: string(row, 'status') as StoredUser['status'],
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), revokedAt: optionalIso(row.revoked_at) }
}
function mapChallenge(row: SqlRow): StoredChallenge {
  return { challengeId: string(row, 'challenge_id'), requestedUserId: optionalString(row, 'requested_user_id'), provider: string(row, 'provider'),
    realmId: string(row, 'realm_id'), expectedProviderUserId: optionalString(row, 'expected_provider_user_id'),
    challengeDigest: digest(row.challenge_digest), pollSecretDigest: digest(row.poll_secret_digest),
    requestedDisplayName: string(row, 'requested_display_name'), expiresAt: iso(row.expires_at), createdAt: iso(row.created_at),
    verifiedUserId: optionalString(row, 'verified_user_id'), verifiedEndpointId: optionalString(row, 'verified_endpoint_id'),
    verifiedAt: optionalIso(row.verified_at), consumedAt: optionalIso(row.consumed_at) }
}
function mapEndpoint(row: SqlRow): StoredEndpoint {
  return { humanEndpointId: string(row, 'human_endpoint_id'), userId: string(row, 'user_id'), provider: string(row, 'provider'),
    realmId: string(row, 'realm_id'), providerUserId: string(row, 'provider_user_id'), displayName: optionalString(row, 'display_name'),
    assurance: string(row, 'assurance') as StoredEndpoint['assurance'], status: string(row, 'status') as StoredEndpoint['status'],
    revision: number(row.revision), verifiedAt: iso(row.verified_at), updatedAt: iso(row.updated_at), revokedAt: optionalIso(row.revoked_at) }
}
function mapAgent(row: SqlRow): StoredAgent {
  return { agentId: string(row, 'agent_id'), installationId: string(row, 'installation_id'), ownerUserId: string(row, 'owner_user_id'),
    displayName: string(row, 'display_name'), nodeType: string(row, 'node_type'), capabilities: jsonStrings(row.capabilities),
    status: string(row, 'status') as StoredAgent['status'], connectionStatus: string(row, 'connection_status') as StoredAgent['connectionStatus'],
    credentialGeneration: number(row.credential_generation), revision: number(row.revision), lastSeenAt: optionalIso(row.last_seen_at),
    updatedAt: iso(row.updated_at), revokedAt: optionalIso(row.revoked_at) }
}
function mapCredential(row: SqlRow): StoredCredential {
  return { credentialId: string(row, 'credential_id'), kind: string(row, 'kind') as StoredCredential['kind'],
    subjectUserId: string(row, 'subject_user_id'), subjectAgentId: optionalString(row, 'subject_agent_id'), tokenDigest: digest(row.token_digest),
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
    status: string(row, 'status') as StoredProject['status'], coordinatorAgentId: string(row, 'coordinator_agent_id'),
    budgets: { maxTasks: number(row.max_tasks), maxTasksPerRound: number(row.max_tasks_per_round),
      maxTaskRetries: number(row.max_task_retries), maxCoordinationRounds: number(row.max_coordination_rounds) },
    coordinationRound: number(row.coordination_round), revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapMember(row: SqlRow): StoredProjectMember {
  return { projectId: string(row, 'project_id'), userId: string(row, 'user_id'), role: string(row, 'role') as StoredProjectMember['role'],
    active: Boolean(row.active), createdAt: iso(row.created_at) }
}
function mapTask(row: SqlRow): StoredTask {
  return { taskId: string(row, 'task_id'), projectId: string(row, 'project_id'), assigneeAgentId: string(row, 'assignee_agent_id'),
    createdByAgentId: string(row, 'created_by_agent_id'), title: string(row, 'title'), objective: string(row, 'objective'),
    completionCriteria: jsonStrings(row.completion_criteria), dependencyTaskIds: jsonStrings(row.dependency_task_ids),
    status: string(row, 'status') as StoredTask['status'], retryCount: number(row.retry_count), maxRetries: number(row.max_retries),
    coordinationRound: number(row.coordination_round), activeTurnId: optionalString(row, 'active_turn_id'),
    resultSummary: optionalString(row, 'result_summary'), failureSummary: optionalString(row, 'failure_summary'), revision: number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), completedAt: optionalIso(row.completed_at) }
}
function mapRecord(row: SqlRow): StoredProjectRecord {
  return { projectRecordId: string(row, 'project_record_id'), projectId: string(row, 'project_id'),
    kind: string(row, 'kind') as StoredProjectRecord['kind'], status: string(row, 'status') as StoredProjectRecord['status'],
    summary: string(row, 'summary'), authorUserId: optionalString(row, 'author_user_id'), authorAgentId: optionalString(row, 'author_agent_id'),
    sourceTaskId: optionalString(row, 'source_task_id'), sourceRevision: row.source_revision == null ? undefined : number(row.source_revision),
    acceptedByUserId: optionalString(row, 'accepted_by_user_id'), acceptedByAgentId: optionalString(row, 'accepted_by_agent_id'),
    acceptedAt: optionalIso(row.accepted_at), revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapProjection(row: SqlRow): StoredProjection {
  return { projectionId: string(row, 'projection_id'), ownerUserId: string(row, 'owner_user_id'), agentId: string(row, 'agent_id'),
    humanEndpointId: string(row, 'human_endpoint_id'), locator: jsonRecord(row.locator) as StoredProjection['locator'],
    locatorRevision: number(row.locator_revision), displayName: string(row, 'display_name'), status: string(row, 'status') as StoredProjection['status'],
    allowedSenderUserIds: jsonStrings(row.allowed_sender_user_ids), lastErrorCode: optionalString(row, 'last_error_code'),
    revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
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
  return { humanRequestId: string(row, 'human_request_id'), projectId: string(row, 'project_id'), taskId: string(row, 'task_id'),
    targetUserId: string(row, 'target_user_id'), requestedByAgentId: string(row, 'requested_by_agent_id'),
    requiredAssurance: string(row, 'required_assurance') as StoredHumanRequest['requiredAssurance'], prompt: string(row, 'prompt'),
    status: string(row, 'status') as StoredHumanRequest['status'], revision: number(row.revision), expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function mapHumanAnswer(row: SqlRow): StoredHumanAnswer {
  return { humanAnswerId: string(row, 'human_answer_id'), humanRequestId: string(row, 'human_request_id'),
    projectId: string(row, 'project_id'), taskId: string(row, 'task_id'), requestRevision: number(row.request_revision),
    answeredByUserId: string(row, 'answered_by_user_id'), answeredFromHumanEndpointId: string(row, 'answered_from_human_endpoint_id'),
    assurance: string(row, 'assurance') as StoredHumanAnswer['assurance'], answer: string(row, 'answer'), revision: number(row.revision),
    answeredAt: iso(row.answered_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
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
