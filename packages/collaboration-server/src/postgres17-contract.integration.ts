import assert from 'node:assert/strict'

import { restRequestSchema, type ContentSpaceAuthorizationProof } from '@sciforge/collaboration-contracts'

import type { AgentActor, OidcUserActor } from './auth.js'
import { stableDigest } from './crypto.js'
import { CollaborationServiceError } from './errors.js'
import {
  COLLABORATION_SCHEMA_FINGERPRINT,
  collaborationSchemaFingerprint,
  runCollaborationMigrations
} from './migrations.js'
import { createPostgresPool, PostgresCollaborationRepository } from './postgres.js'
import { CollaborationService } from './service.js'

const connectionString = process.env.SCIFORGE_A_POSTGRES17_TEST_URL
const expectedSource = process.env.SCIFORGE_A_POSTGRES17_SOURCE
if (!connectionString || !expectedSource) {
  throw new Error('SCIFORGE_A_POSTGRES17_TEST_URL and SCIFORGE_A_POSTGRES17_SOURCE are required')
}
if (!['fresh-v4', 'upstream-v4', 'public-v5', 'staging-v9'].includes(expectedSource)) {
  throw new Error('SCIFORGE_A_POSTGRES17_SOURCE must be fresh-v4, upstream-v4, public-v5, or staging-v9')
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

  assert.equal(await sourceRoute(pool), expectedSource)
  assertions += 1
  await runCollaborationMigrations(pool)
  assert.equal(await collaborationSchemaFingerprint(pool), COLLABORATION_SCHEMA_FINGERPRINT)
  assertions += 1

  const existing = await pool.query<{ count: unknown }>(
    'SELECT count(*) AS count FROM sciforge_collaboration.user_principals'
  )
  assert.equal(Number(existing.rows[0]?.count), 0)
  assertions += 1

  const at = new Date('2026-08-24T04:00:00.000Z')
  const timestamp = at.toISOString()
  const ownerUserId = 'usr_PgOwner000001'
  const workerUserId = 'usr_PgWorker00001'
  const ownerIdentityId = 'oid_PgOwner000001'
  const ownerDeviceId = 'dev_PgOwner000001'
  const workerDeviceId = 'dev_PgWorker00001'
  const coordinatorId = 'agt_PgCoord000001'
  const firstWorkerId = 'agt_PgWorker00001'
  const secondWorkerId = 'agt_PgWorker00002'

  for (const [userId, displayName] of [[ownerUserId, 'PG Owner'], [workerUserId, 'PG Worker']]) {
    await pool.query(
      `INSERT INTO sciforge_collaboration.user_principals
       (user_id,display_name,status,revision,created_at,updated_at)
       VALUES ($1,$2,'active',1,$3,$3)`, [userId, displayName, timestamp]
    )
  }
  await pool.query(
    `INSERT INTO sciforge_collaboration.oidc_identities
     (identity_id,user_id,issuer,subject,status,revision,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'active',1,$5,$5)`,
    [ownerIdentityId, ownerUserId, 'https://identity.sciforge.test', 'pg-owner', timestamp]
  )
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
          x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), timestamp]
    )
  }
  for (const [agentId, deviceId, userId, installationId, displayName] of [
    [coordinatorId, ownerDeviceId, ownerUserId, 'ins_PgCoord000001', 'Coordinator'],
    [firstWorkerId, workerDeviceId, workerUserId, 'ins_PgWorkerA0001', 'Worker A'],
    [secondWorkerId, workerDeviceId, workerUserId, 'ins_PgWorkerB0001', 'Worker B']
  ]) {
    await pool.query(
      `INSERT INTO sciforge_collaboration.agent_nodes
       (agent_id,device_id,installation_id,owner_user_id,display_name,node_type,capabilities,status,
        connection_status,credential_generation,revision,updated_at)
       VALUES ($1,$2,$3,$4,$5,'server','["content-space.read","content-space.upload-new"]'::jsonb,
        'active','online',1,1,$6)`,
      [agentId, deviceId, installationId, userId, displayName, timestamp]
    )
  }

  const owner: OidcUserActor = {
    kind: 'user', authentication: 'oidc', actorKey: `oidc:${ownerIdentityId}`, userId: ownerUserId,
    identityId: ownerIdentityId, issuer: 'https://identity.sciforge.test', subject: 'pg-owner',
    authTime: Math.floor(at.getTime() / 1_000), expiresAt: Math.floor(at.getTime() / 1_000) + 3_600,
    assurance: 'verified'
  }
  const coordinator = agentActor(ownerUserId, coordinatorId, ownerDeviceId)
  const workerA = agentActor(workerUserId, firstWorkerId, workerDeviceId)
  const workerB = agentActor(workerUserId, secondWorkerId, workerDeviceId)
  const now = () => new Date(at)
  const service = new CollaborationService({ repository, now, verifyContentSpaceAuthorization: async (input) => ({
    proofId: 'csp_PgProof000001', issuer: input.authorizationProof.issuer,
    proofDigest: stableDigest(input.authorizationProof), principalUserId: input.actorUserId,
    actorPrincipalDigest: stableDigest(input.actorPrincipal),
    principal: { authority: 'sciforge.host.test', subject: input.actorPrincipal.kind === 'oidc'
      ? input.actorPrincipal.subject : input.actorPrincipal.credentialId,
    deviceId: ownerDeviceId, identityVersion: 1 }, rootLocatorDigest: stableDigest(input.rootLocator),
    scopes: ['content-space.read', 'content-space.upload-new'], issuedAt: timestamp,
    expiresAt: '2026-08-24T05:00:00.000Z'
  }) })

  const project = await service.createProject(owner, { displayName: 'PG17 contract', goal: 'Test A fences',
    memberUserIds: [ownerUserId, workerUserId], coordinatorAgentId: coordinatorId,
    idempotencyKey: 'idem_pg17_project_create' })
  const rootLocator = { contractVersion: 1 as const, kind: 'content-space.container-reference' as const,
    authority: 'sciforge.host.test', identity: { containerId: 'pg17-root' } }
  const authorizationProof: ContentSpaceAuthorizationProof = {
    format: 'sciforge.content-space.authorization-proof.v1', issuer: 'sciforge.host.test', payload: 'opaque-proof'
  }
  const concurrent = await Promise.allSettled([
    service.bindProjectContentSpace(owner, { projectId: project.projectId, expectedRevision: project.revision,
      rootLocator, authorizationProof, idempotencyKey: 'idem_pg17_binding_first' }),
    service.bindProjectContentSpace(owner, { projectId: project.projectId, expectedRevision: project.revision,
      rootLocator, authorizationProof, idempotencyKey: 'idem_pg17_binding_second' })
  ])
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(concurrent.filter((result) => result.status === 'rejected' && isCode(result.reason, 'revision_conflict')).length, 1)
  assertions += 2
  const binding = await service.getProjectContentSpaceBinding(owner, project.projectId)
  assert.equal(binding.authorization.principal.subject, owner.subject)
  assert.equal(binding.authorization.actorPrincipalDigest, stableDigest({
    kind: 'oidc', identityId: owner.identityId, issuer: owner.issuer, subject: owner.subject
  }))
  assertions += 2

  const fileIntent = { schemaVersion: 1 as const, bindingRevision: binding.revision, inputs: [{
    kind: 'content-space.input-file' as const,
    locator: { contractVersion: 1 as const, kind: 'content-space.file-reference' as const,
      authority: 'sciforge.host.test', identity: { fileId: 'input-1' } },
    destinationName: 'input.dat', expectedSemanticRevision: 'rev-1'
  }], output: { kind: 'content-space.output-new' as const, target: 'project-binding-root' as const,
    mode: 'upload-new' as const } }
  const currentProject = await repository.getProject(project.projectId)
  assert.ok(currentProject)
  await expectCode(service.createTask(coordinator, { projectId: project.projectId, assigneeAgentId: firstWorkerId,
    title: 'Stale binding', objective: 'Must reject stale binding', completionCriteria: ['rejected'],
    dependencyTaskIds: [], fileIntent: { ...fileIntent, bindingRevision: binding.revision + 1 },
    expectedProjectRevision: currentProject.revision, idempotencyKey: 'idem_pg17_stale_binding' }), 'revision_conflict')
  assertions += 1
  assert.equal(restRequestSchema.safeParse({ protocolVersion: '1.0', requestId: 'req_PgCreateTask001',
    type: 'task.create', idempotencyKey: 'idem_pg17_contract_extra_refs', projectId: project.projectId,
    expectedRevision: currentProject.revision, assigneeAgentId: firstWorkerId, title: 'No caller refs',
    objective: 'Reject caller resource refs', completionCriteria: ['strict'], dependencyTaskIds: [],
    fileIntent, resourceRefIds: ['rrf_CallerSupplied01'] }).success, false)
  assertions += 1

  const task = await service.createTask(coordinator, { projectId: project.projectId, assigneeAgentId: firstWorkerId,
    title: 'File Task', objective: 'Exercise typed file intent', completionCriteria: ['fenced'],
    dependencyTaskIds: [], fileIntent, expectedProjectRevision: currentProject.revision,
    idempotencyKey: 'idem_pg17_file_task' })
  const firstRefs = await repository.listCloudResourceRefs(task.taskId, task.executionFence.executionId)
  assert.equal(firstRefs.length, 2)
  assert.deepEqual(firstRefs.map((resource) => resource.role), ['input-file', 'output-container'])
  assert.ok(firstRefs.every((resource) => resource.intentDigest === task.executionFence.intentDigest))
  assertions += 3

  const accepted = await service.transitionTask(workerA, { taskId: task.taskId,
    executionId: task.executionFence.executionId, expectedRevision: task.revision, status: 'accepted',
    idempotencyKey: 'idem_pg17_task_accept' })
  const running = await service.transitionTask(workerA, { taskId: task.taskId,
    executionId: accepted.executionFence.executionId, expectedRevision: accepted.revision, status: 'in_progress',
    idempotencyKey: 'idem_pg17_task_running' })
  const projectAfterTask = await repository.getProject(project.projectId)
  assert.ok(projectAfterTask)
  await expectCode(service.unbindProjectContentSpace(owner, { projectId: project.projectId,
    expectedRevision: projectAfterTask.revision, expectedBindingRevision: binding.revision,
    idempotencyKey: 'idem_pg17_unbind_open' }), 'invalid_state_transition')
  assertions += 1
  const failed = await service.transitionTask(workerA, { taskId: task.taskId,
    executionId: running.executionFence.executionId, expectedRevision: running.revision, status: 'failed',
    failureSummary: 'bounded failure', idempotencyKey: 'idem_pg17_task_failed' })
  const retried = await service.retryOrReassignTask(coordinator, { taskId: task.taskId,
    previousExecutionId: failed.executionFence.executionId, expectedRevision: failed.revision,
    assigneeAgentId: secondWorkerId, idempotencyKey: 'idem_pg17_task_reassign' })
  assert.notEqual(retried.executionFence.executionId, task.executionFence.executionId)
  assert.equal(retried.executionFence.assigneeAgentId, secondWorkerId)
  assertions += 2
  await expectCode(service.transitionTask(workerB, { taskId: task.taskId,
    executionId: task.executionFence.executionId, expectedRevision: retried.revision, status: 'accepted',
    idempotencyKey: 'idem_pg17_old_execution' }), 'revision_conflict')
  assertions += 1
  const secondRefs = await repository.listCloudResourceRefs(task.taskId, retried.executionFence.executionId)
  assert.equal(secondRefs.length, 2)
  assert.ok((await repository.listCloudResourceRefs(task.taskId, task.executionFence.executionId))
    .every((resource) => resource.status === 'invalidated'))
  assertions += 2
  const secondAccepted = await service.transitionTask(workerB, { taskId: task.taskId,
    executionId: retried.executionFence.executionId, expectedRevision: retried.revision, status: 'accepted',
    idempotencyKey: 'idem_pg17_second_accept' })
  const secondRunning = await service.transitionTask(workerB, { taskId: task.taskId,
    executionId: secondAccepted.executionFence.executionId, expectedRevision: secondAccepted.revision,
    status: 'in_progress', idempotencyKey: 'idem_pg17_second_running' })
  await service.transitionTask(workerB, { taskId: task.taskId,
    executionId: secondRunning.executionFence.executionId, expectedRevision: secondRunning.revision,
    status: 'failed', failureSummary: 'bounded second failure', idempotencyKey: 'idem_pg17_second_failed' })
  const closed = await service.unbindProjectContentSpace(owner, { projectId: project.projectId,
    expectedRevision: projectAfterTask.revision, expectedBindingRevision: binding.revision,
    idempotencyKey: 'idem_pg17_unbind_closed' })
  assert.equal(closed.status, 'closed')
  assert.ok((await repository.listCloudResourceRefs(task.taskId, retried.executionFence.executionId))
    .every((resource) => resource.status === 'invalidated'))
  assertions += 2

  process.stdout.write(JSON.stringify({ ok: true, postgres: 17, source: expectedSource,
    schemaVersion: 11, schemaFingerprint: COLLABORATION_SCHEMA_FINGERPRINT,
    assertions, skipped: 0 }) + '\n')
} finally {
  await repository.close()
}

function agentActor(userId: string, agentId: string, deviceId: string): AgentActor {
  return { kind: 'agent_device', actorKey: `agent:${agentId}:generation:1`, userId, agentId, deviceId,
    credentialId: `credential_${agentId}`, credentialGeneration: 1, assurance: 'device' }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof CollaborationServiceError && error.code === code
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    if (isCode(error, code)) return
    throw error
  }
  throw new Error(`Expected ${code}`)
}

async function sourceRoute(candidatePool: ReturnType<typeof createPostgresPool>): Promise<string> {
  const result = await candidatePool.query<Record<string, unknown>>(
    `SELECT to_regclass('sciforge_collaboration.schema_migrations') AS migration_table,
       to_regclass('sciforge_collaboration.managed_provider_containers') IS NOT NULL AS managed,
       to_regclass('sciforge_collaboration.remote_capability_approvals') IS NOT NULL AS remote,
       to_regclass('sciforge_collaboration.oidc_identities') IS NOT NULL AS oidc,
       to_regclass('sciforge_collaboration.resource_refs') IS NOT NULL AS legacy_refs`
  )
  const row = result.rows[0] ?? {}
  if (row.migration_table == null) return 'fresh-v4'
  const version = Number((await candidatePool.query<{ version: unknown }>(
    'SELECT max(version) AS version FROM sciforge_collaboration.schema_migrations'
  )).rows[0]?.version)
  if (version === 4 && row.managed === true && row.remote === true && row.oidc === false && row.legacy_refs === false) {
    return 'upstream-v4'
  }
  if (version === 5 && row.oidc === true && row.legacy_refs === true) return 'public-v5'
  if (version === 9 && row.managed === true && row.oidc === true && row.legacy_refs === true) return 'staging-v9'
  return `unsupported-${String(version)}`
}
