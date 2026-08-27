import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { AgentActor } from './actor.js'
import { createCollaborationServerRuntime } from './bootstrap.js'
import {
  COLLABORATION_CURRENT_CATALOG_FINGERPRINTS,
  COLLABORATION_SCHEMA_FINGERPRINT,
  COLLABORATION_SOURCE_CATALOG_FINGERPRINTS,
  COLLABORATION_TRANSITION_CATALOG_FINGERPRINTS,
  type CollaborationSchemaRoute,
  collaborationCatalogFingerprint,
  collaborationSchemaFingerprint,
  isCollaborationDatabaseReady,
  runCollaborationMigrations
} from './migrations.js'
import { createPostgresPool, PostgresCollaborationRepository } from './postgres.js'
import type { SqlPool } from './postgres.js'
import type { CollaborationRepository, CollaborationTransaction } from './repository.js'
import { CollaborationService } from './service.js'

const connectionString = process.env.SCIFORGE_STAGE3_POSTGRES_TEST_URL

describe.skipIf(connectionString === undefined).sequential(
  'Stage 3 real PostgreSQL migration, transaction, and restart recovery',
  () => {
    it('admits every frozen route, verifies its full catalog, and restarts as a no-op', async () => {
      assertSafeStage3Database(connectionString!)
      const pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 1 })
      try {
        const version = await pool.query<{ server_version: unknown }>('SHOW server_version')
        expect(String(version.rows[0]?.server_version)).toMatch(/^17\./u)

        for (const route of ROUTES) {
          await installRoute(pool, route)
          if (route !== 'fresh-v4') {
            expect(await collaborationCatalogFingerprint(pool), route)
              .toBe(COLLABORATION_SOURCE_CATALOG_FINGERPRINTS[route])
          }

          await runCollaborationMigrations(pool)
          expect(await collaborationSchemaFingerprint(pool), route)
            .toBe(COLLABORATION_SCHEMA_FINGERPRINT)
          expect(await collaborationCatalogFingerprint(pool), route)
            .toBe(expectedCurrentCatalog(route))
          await expect(isCollaborationDatabaseReady(pool), route).resolves.toBe(true)

          const beforeRestart = await migrationRestartSnapshot(pool)
          await runCollaborationMigrations(pool)
          expect(await migrationRestartSnapshot(pool), route).toEqual(beforeRestart)
        }
      } finally {
        await pool.end()
      }
    })

    it('preserves public-v5 Project-scoped HumanNeeded and fences an unsafe Coordinator', async () => {
      assertSafeStage3Database(connectionString!)
      const pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 1 })
      try {
        await installRoute(pool, 'public-v5')
        await seedHistoricalProjectScopedRequests(pool)

        await runCollaborationMigrations(pool)

        const projects = await pool.query(
          `SELECT project_id,status,revision::text AS revision
           FROM sciforge_collaboration.projects
           WHERE project_id IN ('prj_stage3_scope_safe','prj_stage3_scope_unsafe')
           ORDER BY project_id`
        )
        expect(projects.rows).toEqual([
          { project_id: 'prj_stage3_scope_safe', status: 'paused', revision: '1' },
          { project_id: 'prj_stage3_scope_unsafe', status: 'cancelled', revision: '2' }
        ])

        const requests = await pool.query(
          `SELECT human_request_id,status,request_scope,task_id,execution_id,confirmable_action,
                  coordinator_authority_epoch::text AS coordinator_authority_epoch,
                  revision::text AS revision
           FROM sciforge_collaboration.human_requests
           WHERE human_request_id IN ('hrq_stage3_scope_safe','hrq_stage3_scope_unsafe')
           ORDER BY human_request_id`
        )
        expect(requests.rows).toEqual([
          {
            human_request_id: 'hrq_stage3_scope_safe', status: 'answered',
            request_scope: 'coordinator_project', task_id: null, execution_id: null,
            confirmable_action: null, coordinator_authority_epoch: '1', revision: '2'
          },
          {
            human_request_id: 'hrq_stage3_scope_unsafe', status: 'cancelled',
            request_scope: 'coordinator_project', task_id: null, execution_id: null,
            confirmable_action: null, coordinator_authority_epoch: '1', revision: '2'
          }
        ])

        const answers = await pool.query(
          `SELECT human_answer_id,request_scope,task_id,execution_id,
                  coordinator_authority_epoch::text AS coordinator_authority_epoch
           FROM sciforge_collaboration.human_answers
           WHERE human_answer_id = 'han_stage3_scope_safe'`
        )
        expect(answers.rows).toEqual([{
          human_answer_id: 'han_stage3_scope_safe', request_scope: 'coordinator_project',
          task_id: null, execution_id: null, coordinator_authority_epoch: '1'
        }])
        const tasks = await pool.query(
          `SELECT status,current_execution_state,execution_count
           FROM sciforge_collaboration.tasks
           WHERE task_id = 'tsk_stage3_scope_complete'`
        )
        expect(tasks.rows).toEqual([{
          status: 'manual_recovery_required', current_execution_state: 'superseded',
          execution_count: 1
        }])
        await expect(isCollaborationDatabaseReady(pool)).resolves.toBe(true)

        const beforeRestart = await migrationRestartSnapshot(pool)
        await runCollaborationMigrations(pool)
        expect(await migrationRestartSnapshot(pool)).toEqual(beforeRestart)
      } finally {
        await pool.end()
      }
    })

    it('normalizes a retained raw Project creation inbox before the v15 runtime starts', async () => {
      assertSafeStage3Database(connectionString!)
      const pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 1 })
      try {
        await installRoute(pool, 'current-v14')
        await pool.query(
           `INSERT INTO sciforge_collaboration.inbox_messages
             (recipient_kind,recipient_id,sequence,message_id,message_type,payload,
              created_at,expires_at)
           VALUES
             ('agent','agt_Stage4RetainedAgent01',1,'ibx_Stage4RetainedProjectCreated01',
              'project.created',
              jsonb_build_object(
                'protocolVersion','1.0',
                'type','project.created',
                'projectId','prj_Stage4RetainedProject01',
                'ownerUserId','usr_Stage4RetainedOwner01',
                'coordinatorAgentId','agt_Stage4RetainedAgent01',
                'coordinatorAuthorityEpoch',1,
                'executionAuthorityEpoch',1,
                'status','paused',
                'contentMode','none',
                'provisioningIntentId',NULL,
                'revision',1
              ),
              '2026-08-26T17:16:31.470Z','2026-09-25T17:16:31.470Z')`
        )

        await runCollaborationMigrations(pool)

        const normalized = await pool.query<{
          message_type: unknown
          payload: unknown
        }>(
          `SELECT message_type,payload
           FROM sciforge_collaboration.inbox_messages
           WHERE message_id='ibx_Stage4RetainedProjectCreated01'`
        )
        expect(normalized.rows).toEqual([{
          message_type: 'collaboration.state.changed',
          payload: {
            protocolVersion: '1.0',
            type: 'collaboration.state.changed',
            event: {
              protocolVersion: '1.0',
              eventId: 'evt_Stage4RetainedProjectCreated01',
              causedByRequestId: 'req_Stage4RetainedProjectCreated01',
              occurredAt: '2026-08-26T17:16:31.470Z',
              type: 'project.created',
              projectId: 'prj_Stage4RetainedProject01',
              ownerUserId: 'usr_Stage4RetainedOwner01',
              coordinatorAgentId: 'agt_Stage4RetainedAgent01',
              coordinatorAuthorityEpoch: 1,
              executionAuthorityEpoch: 1,
              status: 'paused',
              contentMode: 'none',
              provisioningIntentId: null,
              revision: 1
            }
          }
        }])
        await expect(isCollaborationDatabaseReady(pool)).resolves.toBe(true)
      } finally {
        await pool.end()
      }
    })

    it('resumes public-v5 and staging-v9 after every committed forward boundary', async () => {
      assertSafeStage3Database(connectionString!)
      const pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 1 })
      try {
        for (const sourceRoute of ['public-v5', 'staging-v9'] as const) {
          for (const [version, forwardCount] of [[11, 1], [12, 2], [13, 3]] as const) {
            await installRoute(pool, sourceRoute)
            for (const name of FORWARD_MIGRATIONS.slice(0, forwardCount)) {
              await pool.query(await migrationSource(name))
            }
            const checkpoint = `${sourceRoute}-v${version}` as
              keyof typeof COLLABORATION_TRANSITION_CATALOG_FINGERPRINTS
            expect(await collaborationCatalogFingerprint(pool), checkpoint)
              .toBe(COLLABORATION_TRANSITION_CATALOG_FINGERPRINTS[checkpoint])

            await runCollaborationMigrations(pool)
            expect(await collaborationCatalogFingerprint(pool), checkpoint)
              .toBe(expectedCurrentCatalog(sourceRoute))
            await expect(isCollaborationDatabaseReady(pool), checkpoint).resolves.toBe(true)
            const beforeRestart = await migrationRestartSnapshot(pool)
            await runCollaborationMigrations(pool)
            expect(await migrationRestartSnapshot(pool), checkpoint).toEqual(beforeRestart)
          }
        }
      } finally {
        await pool.end()
      }
    })

    it('rejects unknown source drift before applying any forward migration', async () => {
      assertSafeStage3Database(connectionString!)
      const pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 1 })
      try {
        await installRoute(pool, 'upstream-v4')
        await pool.query('ALTER TABLE sciforge_collaboration.tasks ADD COLUMN stage3_unknown_drift text')
        const before = await migrationRestartSnapshot(pool)

        await expect(runCollaborationMigrations(pool))
          .rejects.toThrow(/source_fingerprint_mismatch:upstream-v4/u)

        expect(await migrationRestartSnapshot(pool)).toEqual(before)
        expect(await currentSchemaVersion(pool)).toBe(4)
        const executionTable = await pool.query<{ table_name: unknown }>(
          `SELECT to_regclass('sciforge_collaboration.task_executions') AS table_name`
        )
        expect(executionTable.rows[0]?.table_name).toBeNull()
      } finally {
        await pool.end()
      }
    })

    it('rolls a failed v12 migration back on the same connection and leaves data unchanged', async () => {
      assertSafeStage3Database(connectionString!)
      const pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 1 })
      try {
        await installRoute(pool, 'current-v12')
        await seedLegacyContentBinding(pool)
        const before = await persistentDatabaseSnapshot(pool)

        await expect(runCollaborationMigrations(pool))
          .rejects.toThrow(/migration_0013_legacy_content_binding_requires_reprovision/u)

        await expect(pool.query('SELECT 1 AS connection_reusable')).resolves.toMatchObject({ rowCount: 1 })
        expect(await persistentDatabaseSnapshot(pool)).toEqual(before)
        expect(await currentSchemaVersion(pool)).toBe(12)
      } finally {
        await pool.end()
      }
    })

    it('atomically claims a User-targeted offer and replays the exact execution across Server restart', async () => {
      assertSafeStage3Database(connectionString!)
      const at = '2026-08-26T04:00:00.000Z'
      const expiresAt = '2026-08-26T05:00:00.000Z'
      const pool = createPostgresPool({ connectionString: connectionString!, maxConnections: 2 })
      await installRoute(pool, 'fresh-v4')
      await runCollaborationMigrations(pool)
      const repository = new PostgresCollaborationRepository(pool)
      await seedUserOffer(pool, repository, at, expiresAt)

      const command = {
        protocolVersion: '1.0' as const,
        type: 'task.offer.accept' as const,
        requestId: 'req_stage3_pg_accept',
        idempotencyKey: 'idem_stage3_pg_accept',
        taskOfferId: IDS.offer,
        taskId: IDS.task,
        expectedTaskRevision: 2,
        expectedOfferRevision: 1
      }
      const worker: AgentActor = {
        kind: 'agent_device',
        actorKey: `agent-device:${IDS.workerAgent}:${IDS.workerDevice}`,
        userId: IDS.workerUser,
        agentId: IDS.workerAgent,
        deviceId: IDS.workerDevice,
        credentialId: 'cred_stage3_pg_worker',
        credentialGeneration: 1,
        assurance: 'device'
      }
      const coordinator: AgentActor = {
        kind: 'agent_device',
        actorKey: `agent-device:${IDS.coordinator}:${IDS.ownerDevice}`,
        userId: IDS.ownerUser,
        agentId: IDS.coordinator,
        deviceId: IDS.ownerDevice,
        credentialId: 'cred_stage3_pg_coordinator',
        credentialGeneration: 1,
        assurance: 'device'
      }

      const failing = new CollaborationService({
        repository: failAtReceipt(repository),
        now: () => new Date(at)
      })
      await expect(failing.acceptTaskOffer(worker, command))
        .rejects.toThrow(/stage3_injected_before_receipt/u)

      expect(await offerState(repository)).toEqual({
        task: ['offered', 2], execution: [undefined, undefined], offer: ['pending', 1]
      })
      expect(await repository.pullInbox({ kind: 'agent', id: IDS.coordinator }, 0, 20, at)).toEqual([])
      expect(await repository.getReceipt(worker.actorKey, command.idempotencyKey)).toBeNull()

      const service = new CollaborationService({ repository, now: () => new Date(at) })
      const committed = await service.acceptTaskOffer(worker, command)
      const committedInbox = await repository.pullInbox(
        { kind: 'agent', id: IDS.coordinator }, 0, 20, at
      )
      const committedReceipt = await repository.getReceipt(worker.actorKey, command.idempotencyKey)
      expect(committedInbox).toHaveLength(1)
      expect(committedInbox[0]?.payload).toMatchObject({
        type: 'task.offer.accepted',
        executionId: committed.execution.executionId
      })
      expect(committedReceipt?.operation).toBe('task.offer.accept')
      const ackCommand = {
        inboxMessageId: committedInbox[0]!.messageId,
        sequence: committedInbox[0]!.sequence,
        idempotencyKey: 'idem_stage3_pg_coordinator_ack'
      }
      const committedAck = await service.ackInboxMessage(coordinator, ackCommand)
      expect(await service.ackInboxMessage(coordinator, ackCommand)).toEqual(committedAck)
      const committedAckReceipt = await repository.getReceipt(coordinator.actorKey, ackCommand.idempotencyKey)
      expect(committedAckReceipt).toMatchObject({
        operation: 'inbox.ack',
        resourceKind: 'inbox_message',
        resourceId: committedInbox[0]!.messageId,
        response: { inboxMessageId: committedInbox[0]!.messageId, acknowledgedAt: at }
      })
      await repository.close()

      const restartPool = createPostgresPool({ connectionString: connectionString!, maxConnections: 2 })
      await runCollaborationMigrations(restartPool)
      const runtime = createCollaborationServerRuntime({
        pool: restartPool,
        host: '127.0.0.1',
        port: 0,
        now: () => new Date(at),
        taskOfferExpiryIntervalMs: 300_000
      })
      await runtime.start()
      const replayed = await runtime.service.acceptTaskOffer(worker, command)
      expect(replayed).toEqual(committed)
      expect(await runtime.service.ackInboxMessage(coordinator, ackCommand)).toEqual(committedAck)
      await runtime.stop()

      const verificationPool = createPostgresPool({ connectionString: connectionString!, maxConnections: 2 })
      const recovered = new PostgresCollaborationRepository(verificationPool)
      try {
        expect(await offerState(recovered)).toEqual({
          task: ['in_progress', 3], execution: ['accepted', 1], offer: ['accepted', 2]
        })
        expect(await recovered.getTaskExecution(committed.execution.executionId)).toMatchObject({
          assigneeUserId: IDS.workerUser,
          assigneeAgentId: IDS.workerAgent,
          assigneeDeviceId: IDS.workerDevice,
          fence: { status: 'open', reason: null }
        })
        const recoveredInbox = await recovered.pullInbox(
          { kind: 'agent', id: IDS.coordinator }, 0, 20, at
        )
        expect(recoveredInbox).toEqual(committedInbox)
        expect(await recovered.getReceipt(worker.actorKey, command.idempotencyKey))
          .toEqual(committedReceipt)
        expect(await recovered.getReceipt(coordinator.actorKey, ackCommand.idempotencyKey))
          .toEqual(committedAckReceipt)
        expect(await recovered.getInboxCursor({ kind: 'agent', id: IDS.coordinator })).toMatchObject({
          ackedSequence: committedInbox[0]!.sequence,
          nextSequence: committedInbox[0]!.sequence + 1
        })
        const counts = await verificationPool.query<{
          inbox_count: unknown
          receipt_count: unknown
          ack_receipt_count: unknown
        }>(
          `SELECT
             (SELECT count(*) FROM sciforge_collaboration.inbox_messages
               WHERE recipient_kind='agent' AND recipient_id=$1) AS inbox_count,
             (SELECT count(*) FROM sciforge_collaboration.receipts
               WHERE actor_key=$2 AND idempotency_key=$3) AS receipt_count,
             (SELECT count(*) FROM sciforge_collaboration.receipts
               WHERE actor_key=$4 AND idempotency_key=$5) AS ack_receipt_count`,
          [IDS.coordinator, worker.actorKey, command.idempotencyKey,
            coordinator.actorKey, ackCommand.idempotencyKey]
        )
        expect(counts.rows[0]).toEqual({
          inbox_count: '1', receipt_count: '1', ack_receipt_count: '1'
        })
      } finally {
        await recovered.close()
      }
    })
  }
)

const ROUTES: readonly CollaborationSchemaRoute[] = [
  'fresh-v4',
  'upstream-v4',
  'public-v5',
  'staging-v9',
  'a-v11',
  'current-v12',
  'current-v13',
  'current-v14',
  'current-v15',
  'current-v16'
]

const BASELINE_MIGRATIONS = [
  '0001_collaboration_schema.sql',
  '0002_provider_identity_inbox.sql',
  '0003_managed_provider_containers.sql',
  '0004_remote_capability_approvals.sql'
] as const

const FORWARD_MIGRATIONS = [
  '0011_a_content_space_execution_identity.sql',
  '0012_oidc_only_endpoint_agent_authority.sql',
  '0013_full_multi_user_loop.sql',
  '0014_pre_provider_provisioning_binding.sql',
  '0015_canonical_project_created_inbox.sql',
  '0016_user_targeted_task_offers.sql'
] as const

const HISTORICAL_MIGRATIONS = [
  '0001_collaboration_schema.sql',
  '0002_resource_refs.sql',
  '0003_task_progress.sql',
  '0004_coordination_contract.sql',
  '0005_unified_identity_device_bindings.sql',
  '0006_provider_identity_inbox.sql',
  '0007_portable_resource_refs.sql',
  '0008_managed_provider_containers.sql',
  '0009_portal_bounded_reads.sql'
] as const

const IDS = {
  ownerUser: 'usr_Stage3PgOwner01',
  workerUser: 'usr_Stage3PgWorker1',
  ownerDevice: 'dev_Stage3PgOwner01',
  workerDevice: 'dev_Stage3PgWorker1',
  coordinator: 'agn_Stage3PgCoord01',
  workerAgent: 'agn_Stage3PgWorker1',
  project: 'prj_Stage3PgProject1',
  task: 'tsk_Stage3PgTask001',
  offer: 'tof_Stage3PgOffer01'
} as const

async function installRoute(pool: SqlPool, route: CollaborationSchemaRoute): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS sciforge_collaboration CASCADE')
  if (route === 'fresh-v4') return
  if (route === 'public-v5' || route === 'staging-v9') {
    const count = route === 'public-v5' ? 5 : 9
    for (const name of HISTORICAL_MIGRATIONS.slice(0, count)) {
      await pool.query(await historicalMigrationSource(name))
    }
    return
  }
  for (const name of BASELINE_MIGRATIONS) await pool.query(await migrationSource(name))
  const forwardCount = {
    'upstream-v4': 0,
    'a-v11': 1,
    'current-v12': 2,
    'current-v13': 3,
    'current-v14': 4,
    'current-v15': 5,
    'current-v16': 6
  }[route]
  for (const name of FORWARD_MIGRATIONS.slice(0, forwardCount)) {
    await pool.query(await migrationSource(name))
  }
}

async function seedHistoricalProjectScopedRequests(pool: SqlPool): Promise<void> {
  await pool.query(
    `INSERT INTO sciforge_collaboration.user_principals
       (user_id,display_name,status,revision,created_at,updated_at)
     VALUES
       ('usr_stage3_scope_owner','Scope owner','active',1,
        '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z'),
       ('usr_stage3_scope_other','Scope other','active',1,
        '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z');

     INSERT INTO sciforge_collaboration.devices
       (device_id,user_id,installation_id,display_name,platform,public_key_jwk,
        capability_summary,status,revision,created_at,updated_at)
     VALUES
       ('dev_stage3_scope_owner','usr_stage3_scope_owner','ins_stage3_scope_owner',
        'Scope owner device','{"os":"linux","arch":"x64","appVersion":"test"}'::jsonb,
        jsonb_build_object('kty','OKP','crv','Ed25519','alg','EdDSA','use','sig',
          'kid','stage3-scope-owner','x',repeat('a',43)),
        '[]'::jsonb,'active',1,'2026-08-26T00:00:00Z','2026-08-26T00:00:00Z'),
       ('dev_stage3_scope_other','usr_stage3_scope_other','ins_stage3_scope_other',
        'Scope other device','{"os":"linux","arch":"x64","appVersion":"test"}'::jsonb,
        jsonb_build_object('kty','OKP','crv','Ed25519','alg','EdDSA','use','sig',
          'kid','stage3-scope-other','x',repeat('b',43)),
        '[]'::jsonb,'active',1,'2026-08-26T00:00:00Z','2026-08-26T00:00:00Z');

     INSERT INTO sciforge_collaboration.agent_nodes
       (agent_id,installation_id,device_id,owner_user_id,display_name,node_type,capabilities,
        status,connection_status,credential_generation,revision,updated_at)
     VALUES
       ('agn_stage3_scope_owner',NULL,'dev_stage3_scope_owner','usr_stage3_scope_owner',
        'Scope owner Agent','desktop','[]'::jsonb,'active','online',1,1,
        '2026-08-26T00:00:00Z'),
       ('agn_stage3_scope_other',NULL,'dev_stage3_scope_other','usr_stage3_scope_other',
        'Scope other Agent','desktop','[]'::jsonb,'active','online',1,1,
        '2026-08-26T00:00:00Z');

     INSERT INTO sciforge_collaboration.human_endpoint_bindings
       (human_endpoint_id,user_id,provider,realm_id,provider_user_id,display_name,assurance,
        status,revision,verified_at,updated_at,created_at)
     VALUES ('hep_stage3_scope_owner','usr_stage3_scope_owner','test','stage3-scope',
       'owner','Scope owner','verified','active',1,'2026-08-26T00:00:00Z',
       '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z');

     INSERT INTO sciforge_collaboration.projects
       (project_id,owner_user_id,display_name,goal,status,coordinator_agent_id,max_tasks,
        max_tasks_per_round,max_task_retries,max_coordination_rounds,coordination_round,
        revision,created_at,updated_at)
     VALUES
       ('prj_stage3_scope_safe','usr_stage3_scope_owner','Safe scope project',
        'Preserve a Project-scoped answer','paused','agn_stage3_scope_owner',10,5,2,4,1,1,
        '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z'),
       ('prj_stage3_scope_unsafe','usr_stage3_scope_owner','Unsafe scope project',
        'Fence a Coordinator ownership mismatch','paused','agn_stage3_scope_other',10,5,2,4,1,1,
        '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z');

     INSERT INTO sciforge_collaboration.project_members
       (project_id,user_id,role,active,created_at)
     VALUES
       ('prj_stage3_scope_safe','usr_stage3_scope_owner','owner',true,
        '2026-08-26T00:00:00Z'),
       ('prj_stage3_scope_unsafe','usr_stage3_scope_owner','owner',true,
        '2026-08-26T00:00:00Z'),
       ('prj_stage3_scope_unsafe','usr_stage3_scope_other','member',true,
        '2026-08-26T00:00:00Z');

     INSERT INTO sciforge_collaboration.tasks
       (task_id,project_id,assignee_agent_id,created_by_agent_id,title,objective,
        completion_criteria,dependency_task_ids,status,retry_count,max_retries,coordination_round,
        revision,created_at,updated_at,execution_id,assignee_user_id)
     VALUES ('tsk_stage3_scope_complete','prj_stage3_scope_safe','agn_stage3_scope_owner',
       'agn_stage3_scope_owner','Historical completed Task','Exercise the v5 result constraint.',
       '[]'::jsonb,'[]'::jsonb,'in_progress',0,2,1,1,'2026-08-26T00:00:00Z',
       '2026-08-26T00:00:00Z','exe_Stage3ScopeComplete01','usr_stage3_scope_owner');

     INSERT INTO sciforge_collaboration.project_records
       (project_record_id,project_id,kind,status,summary,author_agent_id,source_task_id,
        source_revision,revision,created_at,updated_at,source_execution_id,criterion_evidence,
        resource_ref_ids)
     VALUES ('rec_stage3_scope_complete','prj_stage3_scope_safe','task_result','candidate',
       'Historical result','agn_stage3_scope_owner','tsk_stage3_scope_complete',1,1,
       '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z','exe_Stage3ScopeComplete01',
       '[]'::jsonb,'[]'::jsonb);

     UPDATE sciforge_collaboration.tasks
     SET status='completed',result_summary='Historical result',
         result_record_id='rec_stage3_scope_complete',completed_at='2026-08-26T00:05:00Z',
         updated_at='2026-08-26T00:05:00Z',revision=2
     WHERE task_id='tsk_stage3_scope_complete';

     INSERT INTO sciforge_collaboration.human_requests
       (human_request_id,project_id,task_id,target_user_id,requested_by_agent_id,
        required_assurance,prompt,status,revision,expires_at,created_at,updated_at,
        source_kind,execution_id,source_inbox_message_id,confirmable_action)
     VALUES
       ('hrq_stage3_scope_safe','prj_stage3_scope_safe',NULL,'usr_stage3_scope_owner',
        'agn_stage3_scope_owner','verified','Preserve this answer.','answered',1,
        '2026-08-27T00:00:00Z','2026-08-26T00:00:00Z','2026-08-26T00:00:00Z',
        'coordinator',NULL,'inb_stage3_scope_safe',
        jsonb_build_object('kind','project.complete','projectId','prj_stage3_scope_safe')),
       ('hrq_stage3_scope_unsafe','prj_stage3_scope_unsafe',NULL,'usr_stage3_scope_owner',
        'agn_stage3_scope_other','verified','This request must be fenced.','pending',1,
        '2026-08-27T00:00:00Z','2026-08-26T00:00:00Z','2026-08-26T00:00:00Z',
        'coordinator',NULL,'inb_stage3_scope_unsafe',
        jsonb_build_object('kind','project.complete','projectId','prj_stage3_scope_unsafe'));

     INSERT INTO sciforge_collaboration.human_answers
       (human_answer_id,human_request_id,project_id,task_id,request_revision,answered_by_user_id,
        answered_from_human_endpoint_id,assurance,answer,revision,answered_at,created_at,updated_at,
        execution_id,decision,confirmation_id)
     VALUES ('han_stage3_scope_safe','hrq_stage3_scope_safe','prj_stage3_scope_safe',NULL,1,
       'usr_stage3_scope_owner','hep_stage3_scope_owner','verified','Preserved answer.',1,
       '2026-08-26T00:10:00Z','2026-08-26T00:10:00Z','2026-08-26T00:10:00Z',NULL,NULL,NULL)`
  )
}

function expectedCurrentCatalog(route: CollaborationSchemaRoute): string {
  if (route === 'public-v5') return COLLABORATION_CURRENT_CATALOG_FINGERPRINTS['public-v5']
  if (route === 'staging-v9') return COLLABORATION_CURRENT_CATALOG_FINGERPRINTS['staging-v9']
  return COLLABORATION_CURRENT_CATALOG_FINGERPRINTS['base-v4']
}

async function migrationSource(name: string): Promise<string> {
  return await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
}

async function historicalMigrationSource(name: string): Promise<string> {
  return await readFile(new URL(`./test-fixtures/postgres-a-history/${name}`, import.meta.url), 'utf8')
}

function assertSafeStage3Database(value: string): void {
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.slice(1).startsWith('sf_stage3_')) {
    throw new Error(
      'SCIFORGE_STAGE3_POSTGRES_TEST_URL must identify an isolated loopback sf_stage3_* database'
    )
  }
}

async function currentSchemaVersion(pool: SqlPool): Promise<number> {
  const result = await pool.query<{ version: unknown }>(
    'SELECT max(version) AS version FROM sciforge_collaboration.schema_migrations'
  )
  return Number(result.rows[0]?.version)
}

async function migrationRestartSnapshot(pool: SqlPool): Promise<Readonly<{
  catalogFingerprint: string
  migrations: readonly Readonly<{ version: unknown; applied_at: unknown }>[]
}>> {
  const migrations = await pool.query<{ version: unknown; applied_at: unknown }>(
    `SELECT version,applied_at::text AS applied_at
     FROM sciforge_collaboration.schema_migrations ORDER BY version`
  )
  return { catalogFingerprint: await collaborationCatalogFingerprint(pool), migrations: migrations.rows }
}

async function persistentDatabaseSnapshot(pool: SqlPool): Promise<Readonly<{
  catalogFingerprint: string
  tableData: readonly (readonly [string, readonly string[]])[]
}>> {
  const tables = await pool.query<{ table_name: unknown }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='sciforge_collaboration' AND table_type='BASE TABLE'
     ORDER BY table_name`
  )
  const tableData: Array<readonly [string, readonly string[]]> = []
  for (const row of tables.rows) {
    const tableName = String(row.table_name)
    if (!/^[a-z_]+$/u.test(tableName)) throw new Error('stage3_snapshot_invalid_table_name')
    const values = await pool.query<{ value: unknown }>(
      `SELECT to_jsonb(row_value)::text AS value
       FROM sciforge_collaboration.${tableName} AS row_value
       ORDER BY to_jsonb(row_value)::text`
    )
    tableData.push([tableName, values.rows.map(({ value }) => String(value))])
  }
  return { catalogFingerprint: await collaborationCatalogFingerprint(pool), tableData }
}

async function seedLegacyContentBinding(pool: SqlPool): Promise<void> {
  await pool.query(
    `INSERT INTO sciforge_collaboration.user_principals
       (user_id,display_name,status,revision,created_at,updated_at)
     VALUES ('usr_stage3_rollback','Rollback owner','active',1,
       '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z');
     INSERT INTO sciforge_collaboration.devices
       (device_id,user_id,installation_id,display_name,platform,public_key_jwk,capability_summary,
        status,revision,created_at,updated_at)
     VALUES ('dev_stage3_rollback','usr_stage3_rollback','ins_stage3_rollback','Rollback device',
       '{"os":"linux"}'::jsonb,'{"kty":"OKP"}'::jsonb,'[]'::jsonb,
       'active',1,'2026-08-26T00:00:00Z','2026-08-26T00:00:00Z');
     INSERT INTO sciforge_collaboration.agent_nodes
       (agent_id,device_id,owner_user_id,display_name,node_type,capabilities,status,
        connection_status,credential_generation,revision,updated_at)
     VALUES ('agn_stage3_rollback','dev_stage3_rollback','usr_stage3_rollback','Rollback agent',
       'desktop','[]'::jsonb,'active','online',1,1,'2026-08-26T00:00:00Z');
     INSERT INTO sciforge_collaboration.projects
       (project_id,owner_user_id,display_name,goal,status,coordinator_agent_id,max_tasks,
        max_tasks_per_round,max_task_retries,max_coordination_rounds,coordination_round,
        revision,created_at,updated_at)
     VALUES ('prj_stage3_rollback','usr_stage3_rollback','Rollback project','Atomic failure','active',
       'agn_stage3_rollback',10,5,2,4,1,1,'2026-08-26T00:00:00Z','2026-08-26T00:00:00Z');
     INSERT INTO sciforge_collaboration.project_content_space_bindings
       (project_id,root_locator,root_locator_digest,authorization_proof_id,authorization_issuer,
        authorization_proof_digest,authorization_actor_principal_digest,principal_authority,
        principal_subject,principal_device_id,principal_identity_version,authorization_scopes,
        authorization_issued_at,authorization_expires_at,status,revision,created_at,updated_at)
     VALUES ('prj_stage3_rollback','{"provider":"legacy","containerId":"root"}'::jsonb,
       repeat('a',64),'proof-legacy','legacy-issuer',repeat('b',64),repeat('c',64),
       'legacy-authority','legacy-subject','dev_stage3_rollback',1,
       '["content-space.read","content-space.upload-new"]'::jsonb,
       '2026-08-26T00:00:00Z','2026-08-27T00:00:00Z','active',1,
       '2026-08-26T00:00:00Z','2026-08-26T00:00:00Z')`
  )
}

async function seedUserOffer(
  pool: SqlPool,
  repository: PostgresCollaborationRepository,
  at: string,
  expiresAt: string
): Promise<void> {
  for (const [userId, displayName] of [
    [IDS.ownerUser, 'Stage 3 owner'],
    [IDS.workerUser, 'Stage 3 worker']
  ] as const) {
    await pool.query(
      `INSERT INTO sciforge_collaboration.user_principals
       (user_id,display_name,status,revision,created_at,updated_at)
       VALUES ($1,$2,'active',1,$3,$3)`,
      [userId, displayName, at]
    )
  }
  for (const [deviceId, userId, installationId] of [
    [IDS.ownerDevice, IDS.ownerUser, 'ins_Stage3PgOwner01'],
    [IDS.workerDevice, IDS.workerUser, 'ins_Stage3PgWorker1']
  ] as const) {
    await pool.query(
      `INSERT INTO sciforge_collaboration.devices
       (device_id,user_id,installation_id,display_name,platform,public_key_jwk,capability_summary,
        status,revision,created_at,updated_at)
       VALUES ($1,$2,$3,'Stage 3 device','{"os":"linux"}'::jsonb,'{"kty":"OKP"}'::jsonb,
        '[]'::jsonb,'active',1,$4,$4)`,
      [deviceId, userId, installationId, at]
    )
  }
  for (const [agentId, deviceId, userId, displayName] of [
    [IDS.coordinator, IDS.ownerDevice, IDS.ownerUser, 'Stage 3 Coordinator'],
    [IDS.workerAgent, IDS.workerDevice, IDS.workerUser, 'Stage 3 Worker']
  ] as const) {
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
      projectId: IDS.project,
      ownerUserId: IDS.ownerUser,
      displayName: 'Stage 3 recovery project',
      goal: 'Prove atomic durable recovery',
      contentMode: 'none',
      status: 'active',
      coordinatorAgentId: IDS.coordinator,
      coordinatorAuthorityEpoch: 1,
      executionAuthorityEpoch: 1,
      contentOwnerUserId: null,
      budget: { maxTasks: 10, maxTasksPerRound: 5, maxTaskRetries: 2, maxCoordinationRounds: 4 },
      coordinationRound: 1,
      revision: 1,
      createdAt: at,
      updatedAt: at
    }, [
      membership('pmr_Stage3PgOwner01', IDS.ownerUser, at),
      membership('pmr_Stage3PgWorker1', IDS.workerUser, at)
    ])
    await tx.upsertWorkerAvailability({
      agentId: IDS.workerAgent,
      userId: IDS.workerUser,
      deviceId: IDS.workerDevice,
      agentActive: true,
      deviceActive: true,
      connectionStatus: 'online',
      lastHeartbeatAt: at,
      runtimeReadiness: 'ready',
      runtimeCapabilityTags: ['task.execute'],
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: at,
      expiresAt,
      revision: 1,
      createdAt: at,
      updatedAt: at
    }, null)
    await tx.upsertTaskAuthority({
      taskAuthorityId: 'tau_Stage3PgWorker1',
      projectId: IDS.project,
      userId: IDS.workerUser,
      scope: 'text_tasks',
      state: 'eligible',
      authorityEpoch: 1,
      reason: null,
      effectiveAt: at,
      revision: 1,
      createdAt: at,
      updatedAt: at
    }, null)
    await tx.insertTask({
      taskId: IDS.task,
      projectId: IDS.project,
      createdByCoordinatorAgentId: IDS.coordinator,
      title: 'Stage 3 durable offer',
      objective: 'Claim atomically and recover after restart',
      completionCriteria: ['Coordinator observes one durable fact'],
      dependencyTaskIds: [],
      requiredCapabilityTags: ['task.execute'],
      fileIntent: null,
      currentExecutionId: null,
      currentExecutionState: null,
      status: 'planned',
      executionCount: 0,
      maxRetries: 2,
      coordinationRound: 1,
      revision: 1,
      createdAt: at,
      updatedAt: at,
      completedAt: null
    })
    await tx.insertTaskOffer({
      taskOfferId: IDS.offer,
      executionId: null,
      taskId: IDS.task,
      projectId: IDS.project,
      workerUserId: IDS.workerUser,
      state: 'pending',
      offeredAt: at,
      expiresAt,
      respondedAt: null,
      revision: 1,
      createdAt: at,
      updatedAt: at
    })
    await tx.updateTask({
      taskId: IDS.task,
      projectId: IDS.project,
      createdByCoordinatorAgentId: IDS.coordinator,
      title: 'Stage 3 durable offer',
      objective: 'Claim atomically and recover after restart',
      completionCriteria: ['Coordinator observes one durable fact'],
      dependencyTaskIds: [],
      requiredCapabilityTags: ['task.execute'],
      fileIntent: null,
      currentExecutionId: null,
      currentExecutionState: null,
      status: 'offered',
      executionCount: 0,
      maxRetries: 2,
      coordinationRound: 1,
      revision: 2,
      createdAt: at,
      updatedAt: at,
      completedAt: null
    }, 1)
  })
}

function membership(projectMembershipId: string, userId: string, at: string) {
  return {
    projectMembershipId,
    projectId: IDS.project,
    userId,
    state: 'active' as const,
    authorityEpoch: 1,
    activatedAt: at,
    removalRequestedAt: null,
    removalRequestedByUserId: null,
    removedAt: null,
    revision: 1,
    createdAt: at,
    updatedAt: at
  }
}

function failAtReceipt(repository: CollaborationRepository): CollaborationRepository {
  const transaction = async <T>(
    work: (tx: CollaborationTransaction) => Promise<T>
  ): Promise<T> => repository.transaction((tx) => work(new Proxy(tx, {
    get(target, property) {
      if (property === 'insertReceipt') {
        return async () => { throw new Error('stage3_injected_before_receipt') }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })))
  return new Proxy(repository, {
    get(target, property) {
      if (property === 'transaction') return transaction
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

async function offerState(repository: CollaborationRepository): Promise<Readonly<{
  task: readonly [string | undefined, number | undefined]
  execution: readonly [string | undefined, number | undefined]
  offer: readonly [string | undefined, number | undefined]
}>> {
  const task = await repository.getTask(IDS.task)
  const execution = task?.currentExecutionId
    ? await repository.getTaskExecution(task.currentExecutionId)
    : null
  const offer = await repository.getTaskOffer(IDS.offer)
  return {
    task: [task?.status, task?.revision],
    execution: [execution?.state, execution?.revision],
    offer: [offer?.state, offer?.revision]
  }
}
