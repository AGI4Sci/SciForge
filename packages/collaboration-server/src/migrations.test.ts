import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { visibleRecoveryActionKindSchema } from '@sciforge/collaboration-contracts'

import {
  COLLABORATION_SOURCE_CATALOG_FINGERPRINTS,
  COLLABORATION_SCHEMA_DESCRIPTOR,
  COLLABORATION_SCHEMA_FINGERPRINT,
  COLLABORATION_SCHEMA_VERSION,
  collaborationCatalogFingerprint,
  collaborationSchemaFingerprint,
  detectCollaborationSchemaRoute,
  isCollaborationDatabaseReady,
  runCollaborationMigrations
} from './migrations.js'
import { createPostgresPool } from './postgres.js'
import type { SqlConnection, SqlPool } from './postgres.js'

type Facts = {
  version: number | null
  managedContainers: boolean
  remoteApprovals: boolean
  oidcIdentities: boolean
  devices: boolean
  legacyResourceRefs: boolean
  taskResourceRefs: boolean
  projectContentSpaceBindings: boolean
  taskExecutions: boolean
}

const migrationRollbackDatabaseUrl = process.env.SCIFORGE_A_MIGRATION_ROLLBACK_TEST_URL

describe('collaboration forward-only migration lineage', () => {
  it('routes only admitted historical lineages, v11/v12 predecessors, and current v13', () => {
    expect(detectCollaborationSchemaRoute(facts(null))).toBe('fresh-v4')
    expect(detectCollaborationSchemaRoute(facts(4, { managedContainers: true, remoteApprovals: true })))
      .toBe('upstream-v4')
    expect(detectCollaborationSchemaRoute(facts(5, {
      oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))).toBe('public-v5')
    expect(detectCollaborationSchemaRoute(facts(9, {
      managedContainers: true, oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))).toBe('staging-v9')
    expect(detectCollaborationSchemaRoute(facts(11, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true
    }))).toBe('a-v11')
    expect(detectCollaborationSchemaRoute(facts(12, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true
    }))).toBe('current-v12')
    expect(detectCollaborationSchemaRoute(facts(13, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true, taskExecutions: true
    }))).toBe('current-v13')
    expect(() => detectCollaborationSchemaRoute(facts(10, {
      managedContainers: true, oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))).toThrow(/lineage_unsupported/u)
  })

  it('installs fresh v4 then the 0011, 0012, and full-loop 0013 migrations', async () => {
    const harness = migrationHarness(facts(null))
    await runCollaborationMigrations(harness.pool, { sourceCatalogFingerprint: harness.sourceCatalogFingerprint })
    expect(COLLABORATION_SCHEMA_VERSION).toBe(13)
    expect(harness.migrations).toHaveLength(7)
    expect(harness.migrations[0]).toContain('VALUES (1)')
    expect(harness.migrations[3]).toContain('remote_capability_approvals')
    expect(harness.migrations[4]).toContain('migration_0011_unsupported_source_lineage')
    expect(harness.migrations[4]).not.toContain('assignment_epoch')
    expect(harness.migrations[5]).toContain('migration_0012_unsupported_source_lineage')
    expect(harness.migrations[5]).toContain("kind = 'agent_device'")
    expect(harness.migrations[6]).toContain('migration_0013_unsupported_source_lineage')
    expect(harness.migrations[6]).toContain('migration_0013_legacy_content_binding_requires_reprovision')
    expect(harness.migrations[6]).toContain('human_requests_scope_check')
    expect(harness.migrations[6]).toContain('human_answers_scope_check')
    expect(harness.migrations[6]).toContain('human_answers_source_xor')
    expect(harness.migrations[6]).not.toContain('DROP COLUMN answered_from_human_endpoint_id')
    expect(harness.migrations[6]).toContain('DROP COLUMN authorization_proof_id')
    expect(harness.migrations[6]).toContain('DROP COLUMN role')
    expect(harness.migrations[6]).toContain('CREATE TABLE sciforge_collaboration.provider_directory_principal_facts')
    expect(harness.migrations[6]).toContain('CREATE TABLE sciforge_collaboration.task_executions')
    expect(harness.migrations[6]).toContain('CREATE TABLE sciforge_collaboration.task_offers')
    expect(harness.migrations[6]).toContain('CREATE TABLE sciforge_collaboration.visible_recovery_actions')
    expect(harness.migrations[6]).not.toContain('CREATE TABLE sciforge_collaboration.task_execution_events')
    await expect(isCollaborationDatabaseReady(harness.pool)).resolves.toBe(true)
  })

  it.each([
    ['public-v5', facts(5, { oidcIdentities: true, devices: true, legacyResourceRefs: true })],
    ['staging-v9', facts(9, {
      managedContainers: true, oidcIdentities: true, devices: true, legacyResourceRefs: true
    })]
  ] as const)('upgrades %s without replaying colliding historical migration numbers', async (_route, initial) => {
    const harness = migrationHarness(initial)
    await runCollaborationMigrations(harness.pool, { sourceCatalogFingerprint: harness.sourceCatalogFingerprint })
    expect(harness.migrations).toHaveLength(3)
    expect(harness.migrations[0]).toContain('VALUES (11)')
    expect(harness.migrations[0]).not.toContain('VALUES (10)')
    expect(harness.migrations[1]).toContain('VALUES (12)')
    expect(harness.migrations[2]).toContain('VALUES (13)')
  })

  it('upgrades v12 through only the forward v13 migration', async () => {
    const harness = migrationHarness(facts(12, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true
    }))
    await runCollaborationMigrations(harness.pool)
    expect(harness.migrations).toHaveLength(1)
    expect(harness.migrations[0]).toContain('VALUES (13)')
    expect(harness.migrations[0]).toContain('CREATE TABLE sciforge_collaboration.visible_recovery_actions')
    expect(harness.migrations[0]).not.toContain('integrity_verified')
    expect(harness.migrations[0]).not.toContain('VALUES (11)')
    expect(harness.migrations[0]).not.toContain('VALUES (12)')
  })

  it('computes the same deterministic canonical schema fingerprint used by readiness', async () => {
    const harness = migrationHarness(facts(13, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true, taskExecutions: true
    }))
    await expect(collaborationSchemaFingerprint(harness.pool)).resolves.toBe(COLLABORATION_SCHEMA_FINGERPRINT)
  })

  it('requires a non-null Agent Device and rejects the removed installation identity column', async () => {
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('agent_nodes.device_id:text:NO')
    const legacy = migrationHarness(facts(13, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true, taskExecutions: true
    }))
    const query = legacy.pool.query.bind(legacy.pool)
    legacy.pool.query = async (text, values) => {
      const result = await query(text, values)
      if (!text.includes('SELECT table_name,column_name,data_type,is_nullable')) return result
      return { rows: [...result.rows, { table_name: 'agent_nodes', column_name: 'installation_id',
        data_type: 'text', is_nullable: 'YES' }], rowCount: result.rowCount + 1 }
    }
    await expect(collaborationSchemaFingerprint(legacy.pool)).resolves.not.toBe(COLLABORATION_SCHEMA_FINGERPRINT)
    await expect(isCollaborationDatabaseReady(legacy.pool)).resolves.toBe(false)
  })

  it('fingerprints the strict v13 authority, content, execution, and review tables', async () => {
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('projects.content_mode:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('projects.coordinator_authority_epoch:bigint:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('projects.execution_authority_epoch:bigint:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('worker_availability.agent_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .not.toContain('worker_availability.provider_identity_readiness:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('provider_directory_principal_facts.provider_principal_fact_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_provider_membership_observations.provider_principal_fact_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_provider_membership_observations.snapshotted_fact_revision:bigint:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_content_readiness.provider_instance:jsonb:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('project_content_readiness.binding_revision:bigint:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_content_readiness.provider_principal_fact_id:text:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_content_readiness.snapshotted_fact_revision:bigint:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('project_content_readiness.effective_at:timestamp with time zone:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('task_authorities.user_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('task_executions.fence:jsonb:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('task_offers.task_offer_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('external_operation_journal.content_recovery_journal_entry_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('external_operation_journal.prepared_task_revision:bigint:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('external_operation_journal.prepared_execution_revision:bigint:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('visible_recovery_actions.recovery_action_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('visible_recovery_actions.journal_entry_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('visible_recovery_actions.requires_fresh_observation:boolean:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('visible_recovery_actions.completed_at:timestamp with time zone:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_content_provisioning_intents.desired_members:jsonb:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .not.toContain('project_content_provisioning_intents.content_owner_principal:jsonb:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('project_plans.plan_digest:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('task_resource_refs.assignment_task_revision:bigint:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('task_result_submissions.outputs:jsonb:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('task_result_submissions.submitted_task_revision:bigint:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('task_result_submissions.submitted_execution_revision:bigint:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('task_result_reviews.review_decision_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_records.source_result_submission_id:text:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('project_records.source_human_answer_id:text:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .not.toContain('project_final_summaries.integrity_verified:boolean:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).not.toContain('task_execution_events.event_type:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .not.toContain('project_provider_principal_refs.provider_principal_ref_id:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('human_requests.request_scope:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('human_answers.request_scope:text:NO')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR).toContain('human_answers.answered_from_oidc_identity_id:text:YES')
    expect(COLLABORATION_SCHEMA_DESCRIPTOR)
      .toContain('human_answers.answered_from_human_endpoint_id:text:YES')

    const legacy = migrationHarness(facts(13, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true, taskExecutions: true
    }))
    const query = legacy.pool.query.bind(legacy.pool)
    legacy.pool.query = async (text, values) => {
      const result = await query(text, values)
      if (!text.includes('SELECT table_name,column_name,data_type,is_nullable')) return result
      return { rows: [...result.rows, { table_name: 'project_content_space_bindings',
        column_name: 'authorization_scopes', data_type: 'jsonb', is_nullable: 'NO' }],
      rowCount: result.rowCount + 1 }
    }
    await expect(collaborationSchemaFingerprint(legacy.pool)).resolves.not.toBe(COLLABORATION_SCHEMA_FINGERPRINT)
    await expect(isCollaborationDatabaseReady(legacy.pool)).resolves.toBe(false)
  })

  it('persists exactly the public visible recovery action vocabulary without authority material', async () => {
    const migration = await migrationSource('0013_full_multi_user_loop.sql')
    const start = migration.indexOf('CREATE TABLE sciforge_collaboration.visible_recovery_actions')
    const end = migration.indexOf('CREATE TABLE sciforge_collaboration.project_plans', start)
    const tableAndIndexes = migration.slice(start, end)

    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    for (const action of visibleRecoveryActionKindSchema.options) {
      expect(tableAndIndexes).toContain(`'${action}'`)
    }
    expect(tableAndIndexes).toContain("audience IN ('owner', 'coordinator')")
    expect(tableAndIndexes).toContain("status IN ('available', 'completed', 'withdrawn')")
    expect(tableAndIndexes).toContain('visible_recovery_actions_task_execution_pair CHECK')
    expect(tableAndIndexes).toContain('visible_recovery_actions_completion_shape CHECK')
    expect(tableAndIndexes).toContain('safe_summary = btrim(safe_summary)')
    expect(tableAndIndexes).not.toMatch(/credential|secret|authorization|proof|scope/u)
  })

  it('persists only Coordinator-authored observation, decision and summary records', async () => {
    const migration = await migrationSource('0013_full_multi_user_loop.sql')

    expect(migration).toContain("CHECK (kind IN ('observation', 'decision', 'summary')) NOT VALID")
    expect(migration).toContain("CHECK (status = 'accepted') NOT VALID")
    expect(migration).toContain('author_agent_id = accepted_by_agent_id')
    expect(migration).toContain('author_user_id = accepted_by_user_id')
    expect(migration).toContain('project_records_source_result_submission_fk')
    expect(migration).toContain('project_records_canonical_source_check')
    expect(migration).toContain('project_records_source_result_unique')
    expect(migration).toContain('project_records_source_human_answer_unique')
  })

  it('indexes every canonical stable-ID coordination page without a nested collection scan', async () => {
    const migration = await migrationSource('0013_full_multi_user_loop.sql')
    for (const index of [
      'projects_owner_project_id',
      'project_members_user_visibility_project_id',
      'tasks_project_task_id',
      'human_requests_project_request_id',
      'human_requests_project_status_request_id',
      'task_executions_project_execution_id',
      'task_offers_project_offer_id',
      'task_result_submissions_project_result_id',
      'task_result_reviews_project_review_id'
    ]) {
      expect(migration).toContain(`CREATE INDEX ${index}`)
    }
  })

  it('rejects removed execution-event and project-scoped Provider principal tables', async () => {
    const legacy = migrationHarness(facts(13, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true, taskExecutions: true
    }))
    const query = legacy.pool.query.bind(legacy.pool)
    legacy.pool.query = async (text, values) => {
      const result = await query(text, values)
      if (!text.includes('SELECT table_name,column_name,data_type,is_nullable')) return result
      return { rows: [...result.rows,
        { table_name: 'task_execution_events', column_name: 'event_type',
          data_type: 'text', is_nullable: 'NO' },
        { table_name: 'project_provider_principal_refs', column_name: 'project_id',
          data_type: 'text', is_nullable: 'NO' }],
      rowCount: result.rowCount + 2 }
    }
    await expect(collaborationSchemaFingerprint(legacy.pool)).resolves.not.toBe(COLLABORATION_SCHEMA_FINGERPRINT)
    await expect(isCollaborationDatabaseReady(legacy.pool)).resolves.toBe(false)
  })

  it('fails closed before mutating any v12 catalog that contains a legacy binding', async () => {
    const harness = migrationHarness(facts(12, {
      managedContainers: true, remoteApprovals: true, oidcIdentities: true, devices: true,
      taskResourceRefs: true, projectContentSpaceBindings: true
    }))
    await runCollaborationMigrations(harness.pool)
    const migration = harness.migrations[0]!
    const precondition = migration.indexOf('migration_0013_legacy_content_binding_requires_reprovision')
    const firstSchemaMutation = migration.indexOf('ALTER TABLE sciforge_collaboration.projects')
    const recoveryActionMutation = migration.indexOf(
      'CREATE TABLE sciforge_collaboration.visible_recovery_actions'
    )
    expect(precondition).toBeGreaterThan(0)
    expect(firstSchemaMutation).toBeGreaterThan(precondition)
    expect(recoveryActionMutation).toBeGreaterThan(precondition)
    expect(migration).not.toContain("'legacy.migration'")
    expect(migration).not.toContain("'migration_reprovision_required'")
    expect(migration).toContain("'projectExecutionAuthorityEpoch'")
    expect(migration).toContain("'userTaskAuthorityEpoch'")
    expect(migration).toContain("'assignmentTaskRevision'")
    expect(migration).toContain('task_executions_state_revision_lockstep CHECK (state_revision = revision)')
    expect(migration).toContain('task_executions_acceptance_shape CHECK')
    expect(migration).toContain('task_executions_start_shape CHECK')
    expect(migration).toContain('visible_recovery_actions_task_execution_pair CHECK')
    expect(migration).toContain('visible_recovery_actions_completion_shape CHECK')
    expect(migration).toContain('visible_recovery_actions_available')
    expect(migration).not.toMatch(/visible_recovery_actions[\s\S]{0,1000}(credential|secret|authorization_proof)/u)
    expect(migration).toMatch(
      /status = 'provisioning'[\s\S]+root_locator IS NOT NULL AND attestation_id IS NULL/u
    )
    expect(migration).not.toContain("'projectAuthorityEpoch'")
    expect(migration).not.toContain("'taskRevision'")
    expect(migration).not.toContain("'deviceRevision'")
    expect(migration).not.toContain("'agentRevision'")
  })

  it.skipIf(migrationRollbackDatabaseUrl === undefined)(
    'rolls back schema and data unchanged when real PostgreSQL contains a legacy binding',
    async () => {
      assertSafeMigrationRollbackDatabase(migrationRollbackDatabaseUrl!)
      const pool = createPostgresPool({ connectionString: migrationRollbackDatabaseUrl!, maxConnections: 1 })
      const connection = await pool.connect()
      try {
        await connection.query('DROP SCHEMA IF EXISTS sciforge_collaboration CASCADE')
        for (const migrationName of MIGRATIONS_THROUGH_V12) {
          await connection.query(await migrationSource(migrationName))
        }
        await seedLegacyContentBinding(connection)
        const before = await persistentDatabaseSnapshot(connection)

        await expect(connection.query(await migrationSource('0013_full_multi_user_loop.sql')))
          .rejects.toThrow(/migration_0013_legacy_content_binding_requires_reprovision/u)
        await connection.query('ROLLBACK')

        expect(await persistentDatabaseSnapshot(connection)).toEqual(before)
      } finally {
        await connection.query('ROLLBACK').catch(() => undefined)
        await connection.query('DROP SCHEMA IF EXISTS sciforge_collaboration CASCADE')
          .catch(() => undefined)
        connection.release()
        await pool.end()
      }
    }
  )

  it('fails before 0011 when the admitted source catalog fingerprint drifts', async () => {
    const harness = migrationHarness(facts(5, {
      oidcIdentities: true, devices: true, legacyResourceRefs: true
    }))
    await expect(runCollaborationMigrations(harness.pool, {
      sourceCatalogFingerprint: async () => '0'.repeat(64)
    })).rejects.toThrow(/source_fingerprint_mismatch:public-v5/u)
    expect(harness.migrations).toHaveLength(0)
  })

  it('hashes the ordered full catalog descriptor stream mechanically', async () => {
    const descriptors = ['column|tasks|00001|task_id|text|text|NO|', 'migration|0000000004']
    const pool = { query: async () => ({ rows: descriptors.map((descriptor) => ({ descriptor })),
      rowCount: descriptors.length }) } as unknown as SqlPool
    await expect(collaborationCatalogFingerprint(pool)).resolves.toBe(
      createHash('sha256').update(descriptors.join('\n'), 'utf8').digest('hex')
    )
  })
})

const MIGRATIONS_THROUGH_V12 = [
  '0001_collaboration_schema.sql',
  '0002_provider_identity_inbox.sql',
  '0003_managed_provider_containers.sql',
  '0004_remote_capability_approvals.sql',
  '0011_a_content_space_execution_identity.sql',
  '0012_oidc_only_endpoint_agent_authority.sql'
] as const

function assertSafeMigrationRollbackDatabase(connectionString: string): void {
  const url = new URL(connectionString)
  const databaseName = url.pathname.slice(1)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !databaseName.startsWith('sf_a_migration_rollback_')) {
    throw new Error(
      'SCIFORGE_A_MIGRATION_ROLLBACK_TEST_URL must identify an isolated loopback sf_a_migration_rollback_* database'
    )
  }
}

async function migrationSource(name: string): Promise<string> {
  return await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
}

async function seedLegacyContentBinding(connection: SqlConnection): Promise<void> {
  await connection.query(
    `INSERT INTO sciforge_collaboration.user_principals
       (user_id,display_name,status,revision,created_at,updated_at)
     VALUES ('usr_rollback_owner','Rollback owner','active',1,
       '2026-08-24T00:00:00Z','2026-08-24T00:00:00Z');
     INSERT INTO sciforge_collaboration.devices
       (device_id,user_id,installation_id,display_name,platform,public_key_jwk,capability_summary,
        status,revision,created_at,updated_at)
     VALUES ('dev_rollback_owner','usr_rollback_owner','ins_rollback_owner','Rollback device',
       '{"os":"linux"}'::jsonb,'{"kty":"OKP"}'::jsonb,'[]'::jsonb,
       'active',1,'2026-08-24T00:00:00Z','2026-08-24T00:00:00Z');
     INSERT INTO sciforge_collaboration.agent_nodes
       (agent_id,device_id,owner_user_id,display_name,node_type,capabilities,status,
        connection_status,credential_generation,revision,updated_at)
     VALUES ('agn_rollback_owner','dev_rollback_owner','usr_rollback_owner','Rollback agent',
       'desktop','[]'::jsonb,'active','online',1,1,'2026-08-24T00:00:00Z');
     INSERT INTO sciforge_collaboration.projects
       (project_id,owner_user_id,display_name,goal,status,coordinator_agent_id,max_tasks,
        max_tasks_per_round,max_task_retries,max_coordination_rounds,coordination_round,
        revision,created_at,updated_at)
     VALUES ('prj_rollback','usr_rollback_owner','Rollback project','Prove atomic rejection','active',
       'agn_rollback_owner',10,5,2,4,1,1,'2026-08-24T00:00:00Z','2026-08-24T00:00:00Z');
     INSERT INTO sciforge_collaboration.project_content_space_bindings
       (project_id,root_locator,root_locator_digest,authorization_proof_id,authorization_issuer,
        authorization_proof_digest,authorization_actor_principal_digest,principal_authority,
        principal_subject,principal_device_id,principal_identity_version,authorization_scopes,
        authorization_issued_at,authorization_expires_at,status,revision,created_at,updated_at)
     VALUES ('prj_rollback','{"provider":"legacy","containerId":"root"}'::jsonb,
       repeat('a',64),'proof-legacy','legacy-issuer',repeat('b',64),repeat('c',64),
       'legacy-authority','legacy-subject','dev_rollback_owner',1,
       '["content-space.read","content-space.upload-new"]'::jsonb,
       '2026-08-24T00:00:00Z','2026-08-25T00:00:00Z','active',1,
       '2026-08-24T00:00:00Z','2026-08-24T00:00:00Z')`
  )
}

async function persistentDatabaseSnapshot(connection: SqlConnection): Promise<Readonly<{
  catalogFingerprint: string
  tableData: readonly (readonly [string, readonly string[]])[]
}>> {
  const catalogFingerprint = await collaborationCatalogFingerprint(connection as unknown as SqlPool)
  const tables = await connection.query<{ table_name: unknown }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='sciforge_collaboration' AND table_type='BASE TABLE'
     ORDER BY table_name`
  )
  const tableData: Array<readonly [string, readonly string[]]> = []
  for (const row of tables.rows) {
    const tableName = String(row.table_name)
    if (!/^[a-z_]+$/u.test(tableName)) throw new Error('migration_snapshot_invalid_table_name')
    const values = await connection.query<{ value: unknown }>(
      `SELECT to_jsonb(row_value)::text AS value
       FROM sciforge_collaboration.${tableName} AS row_value
       ORDER BY to_jsonb(row_value)::text`
    )
    tableData.push([tableName, values.rows.map((value) => String(value.value))])
  }
  return { catalogFingerprint, tableData }
}

function facts(version: number | null, overrides: Partial<Facts> = {}): Facts {
  return {
    version, managedContainers: false, remoteApprovals: false, oidcIdentities: false,
    devices: false, legacyResourceRefs: false, taskResourceRefs: false,
    projectContentSpaceBindings: false, taskExecutions: false, ...overrides
  }
}

function migrationHarness(initial: Facts): {
  pool: SqlPool
  migrations: string[]
  sourceCatalogFingerprint: () => Promise<string>
} {
  let current = { ...initial }
  const migrations: string[] = []
  const pool: SqlPool = {
    query: async (text) => {
      if (text.includes('SELECT table_name,column_name,data_type,is_nullable')) {
        return { rows: COLLABORATION_SCHEMA_DESCRIPTOR.map((descriptor) => {
          const [qualified, data_type, is_nullable] = descriptor.split(':')
          const separator = qualified!.indexOf('.')
          return { table_name: qualified!.slice(0, separator), column_name: qualified!.slice(separator + 1),
            data_type, is_nullable }
        }), rowCount: COLLABORATION_SCHEMA_DESCRIPTOR.length }
      }
      if (text.includes("to_regclass('sciforge_collaboration.schema_migrations')")) {
        return { rows: [{ migration_table: current.version === null ? null : 'schema_migrations',
          managed_containers: current.managedContainers,
          remote_approvals: current.remoteApprovals, oidc_identities: current.oidcIdentities,
          devices: current.devices, legacy_resource_refs: current.legacyResourceRefs,
          task_resource_refs: current.taskResourceRefs,
          project_content_space_bindings: current.projectContentSpaceBindings,
          task_executions: current.taskExecutions }], rowCount: 1 }
      }
      if (text.trim() === 'SELECT max(version) AS version FROM sciforge_collaboration.schema_migrations') {
        return { rows: [{ version: current.version }], rowCount: 1 }
      }
      migrations.push(text)
      if (text.includes('VALUES (4)')) {
        current = { ...current, version: 4, managedContainers: true, remoteApprovals: true }
      }
      if (text.includes('VALUES (11)')) {
        current = { ...current, version: 11, managedContainers: true, remoteApprovals: true,
          oidcIdentities: true, devices: true, taskResourceRefs: true,
          projectContentSpaceBindings: true }
      }
      if (text.includes('VALUES (12)')) {
        current = { ...current, version: 12, managedContainers: true, remoteApprovals: true,
          oidcIdentities: true, devices: true, taskResourceRefs: true,
          projectContentSpaceBindings: true }
      }
      if (text.includes('VALUES (13)')) {
        current = { ...current, version: 13, managedContainers: true, remoteApprovals: true,
          oidcIdentities: true, devices: true, taskResourceRefs: true,
          projectContentSpaceBindings: true, taskExecutions: true }
      }
      return { rows: [], rowCount: 0 }
    },
    connect: async () => { throw new Error('migration unit harness does not acquire clients') },
    end: async () => undefined
  }
  return { pool, migrations, sourceCatalogFingerprint: async () => {
    const route = detectCollaborationSchemaRoute(current)
    if (route === 'upstream-v4' || route === 'public-v5' || route === 'staging-v9') {
      return COLLABORATION_SOURCE_CATALOG_FINGERPRINTS[route]
    }
    throw new Error(`unexpected source route in migration harness: ${route}`)
  } }
}
