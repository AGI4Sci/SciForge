import assert from 'node:assert/strict'

import {
  COLLABORATION_SCHEMA_FINGERPRINT,
  COLLABORATION_SCHEMA_VERSION,
  collaborationSchemaFingerprint,
  runCollaborationMigrations
} from './migrations.js'
import { createPostgresPool, PostgresCollaborationRepository } from './postgres.js'

const connectionString = process.env.SCIFORGE_A_POSTGRES17_TEST_URL
const expectedSource = process.env.SCIFORGE_A_POSTGRES17_SOURCE
if (!connectionString || !expectedSource) {
  throw new Error('SCIFORGE_A_POSTGRES17_TEST_URL and SCIFORGE_A_POSTGRES17_SOURCE are required')
}
if (!['fresh-v4', 'upstream-v4', 'public-v5', 'staging-v9', 'a-v11', 'current-v12'].includes(expectedSource)) {
  throw new Error('SCIFORGE_A_POSTGRES17_SOURCE names an unsupported forward-upgrade source')
}
const url = new URL(connectionString)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.slice(1).startsWith('sf_a_contract_')) {
  throw new Error('The PostgreSQL 17 integration test requires an isolated loopback sf_a_contract_* database')
}

const pool = createPostgresPool({ connectionString, maxConnections: 8, statementTimeoutMs: 15_000 })
const repository = new PostgresCollaborationRepository(pool)
let assertions = 0

try {
  const version = await pool.query<{ server_version: unknown }>('SHOW server_version')
  assert.match(String(version.rows[0]?.server_version), /^17\./u)
  assertions += 1

  assert.equal(await sourceRoute(), expectedSource)
  assertions += 1
  await runCollaborationMigrations(pool)
  assert.equal(await collaborationSchemaFingerprint(pool), COLLABORATION_SCHEMA_FINGERPRINT)
  assertions += 1

  const existing = await pool.query<{ count: unknown }>(
    'SELECT count(*) AS count FROM sciforge_collaboration.user_principals'
  )
  assert.equal(Number(existing.rows[0]?.count), 0)
  assertions += 1

  const at = '2026-08-24T04:00:00.000Z'
  const expiresAt = '2026-08-24T05:00:00.000Z'
  const ownerUserId = 'usr_PgOwner000001'
  const workerUserId = 'usr_PgWorker00001'
  const ownerDeviceId = 'dev_PgOwner000001'
  const workerDeviceId = 'dev_PgWorker00001'
  const coordinatorId = 'agn_PgCoord000001'
  const workerAgentId = 'agn_PgWorker00001'
  const projectId = 'prj_PgProject00001'
  const taskId = 'tsk_PgTask0000001'
  const executionId = 'exe_PgExecution001'

  for (const [userId, displayName] of [[ownerUserId, 'PG Owner'], [workerUserId, 'PG Worker']]) {
    await pool.query(
      `INSERT INTO sciforge_collaboration.user_principals
       (user_id,display_name,status,revision,created_at,updated_at)
       VALUES ($1,$2,'active',1,$3,$3)`, [userId, displayName, at]
    )
  }
  for (const [deviceId, userId, installationId] of [
    [ownerDeviceId, ownerUserId, 'ins_PgOwner000001'],
    [workerDeviceId, workerUserId, 'ins_PgWorker00001']
  ]) {
    await pool.query(
      `INSERT INTO sciforge_collaboration.devices
       (device_id,user_id,installation_id,display_name,platform,public_key_jwk,capability_summary,status,
        revision,created_at,updated_at)
       VALUES ($1,$2,$3,'PG17 Device',$4::jsonb,$5::jsonb,'[]'::jsonb,'active',1,$6,$6)`,
      [deviceId, userId, installationId,
        JSON.stringify({ os: 'linux', arch: 'x64', appVersion: 'pg17-test' }),
        JSON.stringify({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: deviceId,
          x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), at]
    )
  }
  for (const [agentId, deviceId, userId, displayName] of [
    [coordinatorId, ownerDeviceId, ownerUserId, 'Coordinator'],
    [workerAgentId, workerDeviceId, workerUserId, 'Worker']
  ]) {
    await pool.query(
      `INSERT INTO sciforge_collaboration.agent_nodes
       (agent_id,device_id,owner_user_id,display_name,node_type,capabilities,status,
        connection_status,credential_generation,revision,updated_at)
       VALUES ($1,$2,$3,$4,'desktop','["task.execute"]'::jsonb,'active','online',1,1,$5)`,
      [agentId, deviceId, userId, displayName, at]
    )
  }

  await repository.transaction(async (tx) => {
    await tx.insertProject({
      projectId, ownerUserId, displayName: 'PG17 v13 persistence', goal: 'Exercise canonical durable facts',
      contentMode: 'none',
      status: 'paused', coordinatorAgentId: coordinatorId, coordinatorAuthorityEpoch: 1,
      executionAuthorityEpoch: 1, contentOwnerUserId: null,
      budget: { maxTasks: 20, maxTasksPerRound: 5, maxTaskRetries: 2, maxCoordinationRounds: 4 },
      coordinationRound: 0, revision: 1, createdAt: at, updatedAt: at
    }, [
      { projectMembershipId: 'pmr_PgOwner000001', projectId, userId: ownerUserId, state: 'active',
        authorityEpoch: 1, activatedAt: at, removalRequestedAt: null, removalRequestedByUserId: null,
        removedAt: null, revision: 1, createdAt: at, updatedAt: at },
      { projectMembershipId: 'pmr_PgWorker00001', projectId, userId: workerUserId, state: 'active',
        authorityEpoch: 1, activatedAt: at, removalRequestedAt: null, removalRequestedByUserId: null,
        removedAt: null, revision: 1, createdAt: at, updatedAt: at }
    ])
    for (const scope of ['text_tasks', 'file_tasks'] as const) {
      await tx.upsertTaskAuthority({
        taskAuthorityId: `tau_PgWorker_${scope}`, projectId, userId: workerUserId, scope,
        state: 'suspended', authorityEpoch: 1, reason: 'project_paused', effectiveAt: at,
        revision: 1, createdAt: at, updatedAt: at
      }, null)
    }
    await tx.updateProject({
      projectId, ownerUserId, displayName: 'PG17 v13 persistence', goal: 'Exercise canonical durable facts',
      contentMode: 'none', status: 'active', coordinatorAgentId: coordinatorId,
      coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 2, contentOwnerUserId: null,
      budget: { maxTasks: 20, maxTasksPerRound: 5, maxTaskRetries: 2, maxCoordinationRounds: 4 },
      coordinationRound: 0, revision: 2, createdAt: at, updatedAt: at
    }, 1)
    for (const scope of ['text_tasks', 'file_tasks'] as const) {
      await tx.upsertTaskAuthority({
        taskAuthorityId: `tau_PgWorker_${scope}`, projectId, userId: workerUserId, scope,
        state: 'eligible', authorityEpoch: 2, reason: null, effectiveAt: at,
        revision: 2, createdAt: at, updatedAt: at
      }, 1)
    }
    await tx.upsertWorkerAvailability({
      agentId: workerAgentId, userId: workerUserId, deviceId: workerDeviceId,
      agentActive: true, deviceActive: true, connectionStatus: 'online', lastHeartbeatAt: at,
      runtimeReadiness: 'ready', runtimeCapabilityTags: ['task.execute'], acceptsNewOffers: true,
      activeTaskCount: 0, observedAt: at, expiresAt,
      revision: 1, createdAt: at, updatedAt: at
    }, null)
    await tx.insertTask({
      taskId, projectId, createdByCoordinatorAgentId: coordinatorId, title: 'Text task',
      objective: 'Exercise immutable assignment attempts', completionCriteria: ['result reviewed'],
      dependencyTaskIds: [], fileIntent: null, currentExecutionId: null, currentExecutionState: null,
      status: 'planned', executionCount: 0, maxRetries: 2, coordinationRound: 1,
      revision: 1, createdAt: at, updatedAt: at, completedAt: null
    })
    await tx.insertTaskExecution({
      executionId, taskId, projectId, attempt: 1, offeredByCoordinatorAgentId: coordinatorId,
      assigneeUserId: workerUserId, assigneeAgentId: workerAgentId, assigneeDeviceId: workerDeviceId,
      state: 'offered', stateRevision: 1, fence: {
        schemaVersion: 1, executionId, assigneeUserId: workerUserId, assigneeAgentId: workerAgentId,
        assigneeDeviceId: workerDeviceId, assignmentTaskRevision: 2, projectExecutionAuthorityEpoch: 2,
        userTaskAuthorityEpoch: 2, bindingRevision: null, status: 'open', reason: null, fencedAt: null
      }, fileIntent: null, currentResultSubmissionId: null, offeredAt: at, acceptedAt: null,
      startedAt: null, terminalAt: null, revision: 1, createdAt: at, updatedAt: at
    })
    await tx.insertTaskOffer({
      taskOfferId: 'tof_PgOffer000001', executionId, taskId, projectId, assigneeUserId: workerUserId,
      assigneeAgentId: workerAgentId, assigneeDeviceId: workerDeviceId, state: 'pending',
      offeredAt: at, expiresAt, respondedAt: null, rejectionReason: null, safeReasonDetail: null,
      revision: 1, createdAt: at, updatedAt: at
    })
    await tx.updateTask({
      taskId, projectId, createdByCoordinatorAgentId: coordinatorId, title: 'Text task',
      objective: 'Exercise immutable assignment attempts', completionCriteria: ['result reviewed'],
      dependencyTaskIds: [], fileIntent: null, currentExecutionId: executionId,
      currentExecutionState: 'offered', status: 'offered', executionCount: 1, maxRetries: 2,
      coordinationRound: 1, revision: 2, createdAt: at, updatedAt: at, completedAt: null
    }, 1)
    await tx.insertExternalOperationJournal({
      contentRecoveryJournalEntryId: 'crj_PgRecovery0001', scope: 'task_content_transfer',
      logicalInvocationId: 'pg17-visible-recovery-observation', projectId, taskId,
      preparedTaskRevision: 2, provisioningIntentId: null, provisioningRevision: null,
      executionId, preparedExecutionRevision: 1, operation: 'observe_output',
      requestDigest: '5'.repeat(64), state: 'outcome_unknown', observationDigest: null,
      receiptDigest: null, safeFailureCode: 'provider_observation_unavailable', preparedAt: at,
      dispatchedAt: at, resolvedAt: null, revision: 1, createdAt: at, updatedAt: at
    })
    await tx.insertVisibleRecoveryAction({
      recoveryActionId: 'rca_PgRecovery0001', projectId, taskId, executionId,
      journalEntryId: 'crj_PgRecovery0001', audience: 'coordinator',
      action: 'reconcile_exact_output', status: 'available', requiresFreshObservation: true,
      safeSummary: 'Reconcile the exact Provider output before choosing a terminal action.',
      availableAt: at, completedAt: null, revision: 1, createdAt: at, updatedAt: at
    })
  })

  assert.equal((await repository.getProject(projectId))?.executionAuthorityEpoch, 2)
  assert.equal((await repository.getTaskExecution(executionId))?.assigneeDeviceId, workerDeviceId)
  assert.equal((await repository.listTaskOffers(executionId)).length, 1)
  assert.deepEqual((await repository.listTaskAuthorities(projectId)).map(({ scope }) => scope).sort(),
    ['file_tasks', 'text_tasks'])
  assert.equal((await repository.getExternalOperationJournalById('crj_PgRecovery0001'))
    ?.logicalInvocationId, 'pg17-visible-recovery-observation')
  assert.equal((await repository.getVisibleRecoveryAction('rca_PgRecovery0001'))?.status, 'available')
  assert.equal((await repository.listVisibleRecoveryActionsByProject(projectId)).length, 1)
  assert.deepEqual((await repository.listProjectsForUser(ownerUserId, null, 2))
    .map(({ projectId: id }) => id), [projectId])
  assert.deepEqual((await repository.listProjectsForUser(workerUserId, null, 2))
    .map(({ projectId: id }) => id), [projectId])
  assert.deepEqual((await repository.listTasksByProject(projectId, null, 2))
    .map(({ taskId: id }) => id), [taskId])
  assert.equal((await repository.listTasksByProject(projectId, taskId, 2)).length, 0)
  assert.deepEqual((await repository.listTaskExecutionsByProject(projectId, null, 2))
    .map(({ executionId: id }) => id), [executionId])
  assert.equal((await repository.listTaskOffersByProject(projectId, null, 2)).length, 1)
  assert.equal((await repository.listHumanRequestsByProject(projectId, 'pending', null, 2)).length, 0)
  assert.equal((await repository.listTaskResultSubmissionsByProject(projectId, null, 2)).length, 0)
  assert.equal((await repository.listTaskResultReviewsByProject(projectId, null, 2)).length, 0)
  assertions += 16

  const currentForDevice = await repository.transaction((tx) => (
    tx.listCurrentTaskExecutionsForDeviceForUpdate(workerDeviceId)
  ))
  assert.deepEqual(currentForDevice.map(({ executionId: id }) => id), [executionId])
  assertions += 1

  const firstRate = await repository.transaction((tx) => tx.consumeEndpointChallengeRateWindow({
    userId: ownerUserId, provider: 'opencontent', realmId: 'run0', windowStartedAt: at,
    expiresAt, maxAttempts: 2, updatedAt: at
  }))
  assert.equal(firstRate.allowed, true)
  assert.equal(firstRate.window.attemptCount, 1)
  assertions += 2

  process.stdout.write(JSON.stringify({ ok: true, postgres: 17, source: expectedSource,
    schemaVersion: COLLABORATION_SCHEMA_VERSION, schemaFingerprint: COLLABORATION_SCHEMA_FINGERPRINT,
    assertions, skipped: 0 }) + '\n')
} finally {
  await repository.close()
}

async function sourceRoute(): Promise<string> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT to_regclass('sciforge_collaboration.schema_migrations') AS migration_table,
       to_regclass('sciforge_collaboration.managed_provider_containers') IS NOT NULL AS managed,
       to_regclass('sciforge_collaboration.remote_capability_approvals') IS NOT NULL AS remote,
       to_regclass('sciforge_collaboration.oidc_identities') IS NOT NULL AS oidc,
       to_regclass('sciforge_collaboration.resource_refs') IS NOT NULL AS legacy_refs`
  )
  const row = result.rows[0] ?? {}
  if (row.migration_table == null) return 'fresh-v4'
  const version = Number((await pool.query<{ version: unknown }>(
    'SELECT max(version) AS version FROM sciforge_collaboration.schema_migrations'
  )).rows[0]?.version)
  if (version === 4 && row.managed === true && row.remote === true && row.oidc === false && row.legacy_refs === false) {
    return 'upstream-v4'
  }
  if (version === 5 && row.oidc === true && row.legacy_refs === true) return 'public-v5'
  if (version === 9 && row.managed === true && row.oidc === true && row.legacy_refs === true) return 'staging-v9'
  if (version === 11) return 'a-v11'
  if (version === 12) return 'current-v12'
  return `unsupported-${String(version)}`
}
