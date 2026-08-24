import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { SqlPool } from './postgres.js'

export const COLLABORATION_SCHEMA_VERSION = 11

export type CollaborationSchemaRoute = 'fresh-v4' | 'upstream-v4' | 'public-v5' | 'staging-v9' | 'current-v11'

export const COLLABORATION_SOURCE_CATALOG_FINGERPRINTS = {
  'upstream-v4': '0577af72da028cee0f45daf6bbf8dad873f9ff2fde578662ffb30d50629b9843',
  'public-v5': '238d1ae31083f9bba86539e1be20630e89614ebf5df304ff7407bc3e40cfbc54',
  'staging-v9': 'd6f1098f4b1fcdaa3524c4d9924068e1073701ea8db6c668a425ee16dc2fcb0f'
} as const

type LineageFacts = Readonly<{
  version: number | null
  managedContainers: boolean
  remoteApprovals: boolean
  oidcIdentities: boolean
  devices: boolean
  legacyResourceRefs: boolean
  taskResourceRefs: boolean
  projectContentSpaceBindings: boolean
}>

const BASELINE_MIGRATIONS = [
  '0001_collaboration_schema.sql',
  '0002_provider_identity_inbox.sql',
  '0003_managed_provider_containers.sql',
  '0004_remote_capability_approvals.sql'
] as const

const FORWARD_MIGRATION = '0011_a_content_space_execution_identity.sql' as const

const exactColumns = {
  oidc_identities: ['identity_id:text:NO', 'user_id:text:NO', 'issuer:text:NO', 'subject:text:NO',
    'email_at_link_time:text:YES', 'status:text:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO',
    'revoked_at:timestamp with time zone:YES'],
  device_enrollments: ['enrollment_id:text:NO', 'user_id:text:NO', 'installation_id:text:NO',
    'nonce_digest:bytea:NO', 'status:text:NO', 'revision:bigint:NO',
    'expires_at:timestamp with time zone:NO', 'consumed_at:timestamp with time zone:YES',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  devices: ['device_id:text:NO', 'user_id:text:NO', 'installation_id:text:NO', 'display_name:text:NO',
    'platform:jsonb:NO', 'public_key_jwk:jsonb:NO', 'capability_summary:jsonb:NO', 'status:text:NO',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO',
    'revoked_at:timestamp with time zone:YES'],
  project_content_space_bindings: ['project_id:text:NO', 'root_locator:jsonb:NO', 'root_locator_digest:text:NO',
    'authorization_proof_id:text:NO', 'authorization_issuer:text:NO', 'authorization_proof_digest:text:NO',
    'authorization_actor_principal_digest:text:NO',
    'principal_authority:text:NO', 'principal_subject:text:NO', 'principal_device_id:text:NO',
    'principal_identity_version:bigint:NO', 'authorization_scopes:jsonb:NO',
    'authorization_issued_at:timestamp with time zone:NO', 'authorization_expires_at:timestamp with time zone:NO',
    'status:text:NO', 'revision:bigint:NO', 'created_at:timestamp with time zone:NO',
    'updated_at:timestamp with time zone:NO'],
  task_resource_refs: ['resource_ref_id:text:NO', 'project_id:text:NO', 'task_id:text:NO', 'execution_id:text:NO',
    'task_revision:bigint:NO', 'binding_revision:bigint:NO', 'intent_digest:text:NO', 'role:text:NO',
    'ordinal:integer:NO', 'locator:jsonb:NO', 'locator_digest:text:NO', 'status:text:NO',
    'invalidated_at:timestamp with time zone:YES', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO']
} as const

const requiredColumns = {
  agent_nodes: ['device_id:text:YES'],
  tasks: ['file_intent:jsonb:YES', 'resource_ref_ids:jsonb:NO', 'execution_id:text:NO',
    'execution_assignee_agent_id:text:NO', 'execution_task_revision:bigint:NO',
    'execution_binding_revision:bigint:YES', 'intent_digest:text:NO'],
  human_requests: ['execution_id:text:NO', 'confirmable_action:jsonb:YES'],
  human_answers: ['execution_id:text:NO', 'answered_from_human_endpoint_id:text:YES',
    'answered_from_oidc_identity_id:text:YES', 'decision:text:YES', 'confirmation_id:text:YES']
} as const

export const COLLABORATION_SCHEMA_DESCRIPTOR = Object.entries({ ...exactColumns, ...requiredColumns })
  .flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`))
  .sort()

export const COLLABORATION_SCHEMA_FINGERPRINT = createHash('sha256')
  .update(COLLABORATION_SCHEMA_DESCRIPTOR.join('\n'), 'utf8').digest('hex')

export async function collaborationCatalogFingerprint(pool: SqlPool): Promise<string> {
  const result = await pool.query<{ descriptor: unknown }>(
    `WITH descriptors AS (
       SELECT 'table|' || table_name AS descriptor
       FROM information_schema.tables
       WHERE table_schema='sciforge_collaboration' AND table_type='BASE TABLE'
       UNION ALL
       SELECT 'column|' || table_name || '|' || lpad(ordinal_position::text,5,'0') || '|' || column_name || '|' ||
              data_type || '|' || udt_name || '|' || is_nullable || '|' || COALESCE(column_default,'')
       FROM information_schema.columns
       WHERE table_schema='sciforge_collaboration'
       UNION ALL
       SELECT 'constraint|' || relation.relname || '|' || constraint_record.conname || '|' ||
              constraint_record.contype::text || '|' || pg_get_constraintdef(constraint_record.oid,true)
       FROM pg_constraint AS constraint_record
       JOIN pg_class AS relation ON relation.oid=constraint_record.conrelid
       JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
       WHERE namespace.nspname='sciforge_collaboration'
       UNION ALL
       SELECT 'index|' || tablename || '|' || indexname || '|' || indexdef
       FROM pg_indexes
       WHERE schemaname='sciforge_collaboration'
       UNION ALL
       SELECT 'migration|' || lpad(version::text,10,'0')
       FROM sciforge_collaboration.schema_migrations
     )
     SELECT descriptor FROM descriptors ORDER BY descriptor`
  )
  const descriptors = result.rows.map((row) => String(row.descriptor))
  return createHash('sha256').update(descriptors.join('\n'), 'utf8').digest('hex')
}

export async function runCollaborationMigrations(
  pool: SqlPool,
  runtime: Readonly<{
    sourceCatalogFingerprint?: (candidate: SqlPool) => Promise<string>
  }> = {}
): Promise<void> {
  let facts = await readLineageFacts(pool)
  if (facts.version === null) {
    for (const name of BASELINE_MIGRATIONS) await applyMigration(pool, name)
    facts = await readLineageFacts(pool)
    assertRoute(facts, 'upstream-v4')
  }
  const route = detectCollaborationSchemaRoute(facts)
  if (route === 'fresh-v4') throw new Error('collaboration_schema_fresh_route_not_materialized')
  if (route !== 'current-v11') {
    const actualSourceFingerprint = await (runtime.sourceCatalogFingerprint ?? collaborationCatalogFingerprint)(pool)
    if (actualSourceFingerprint !== COLLABORATION_SOURCE_CATALOG_FINGERPRINTS[route]) {
      throw new Error(`collaboration_schema_source_fingerprint_mismatch:${route}`)
    }
  }
  if (facts.version !== COLLABORATION_SCHEMA_VERSION) {
    await applyMigration(pool, FORWARD_MIGRATION)
  }
  const current = await readLineageFacts(pool)
  assertRoute(current, 'current-v11')
  const fingerprint = await collaborationSchemaFingerprint(pool)
  if (fingerprint !== COLLABORATION_SCHEMA_FINGERPRINT) {
    throw new Error('collaboration_schema_fingerprint_mismatch')
  }
}

async function applyMigration(pool: SqlPool, name: string): Promise<void> {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
    await pool.query(sql)
}

export async function isCollaborationDatabaseReady(pool: SqlPool): Promise<boolean> {
  try {
    assertRoute(await readLineageFacts(pool), 'current-v11')
    return await collaborationSchemaFingerprint(pool) === COLLABORATION_SCHEMA_FINGERPRINT
  } catch {
    return false
  }
}

export async function collaborationSchemaFingerprint(pool: SqlPool): Promise<string> {
  const result = await pool.query<{
    table_name: unknown
    column_name: unknown
    data_type: unknown
    is_nullable: unknown
  }>(
    `SELECT table_name,column_name,data_type,is_nullable
     FROM information_schema.columns
     WHERE table_schema='sciforge_collaboration'
     ORDER BY table_name,column_name`
  )
  const expectedTables = new Set(Object.keys({ ...exactColumns, ...requiredColumns }))
  const exactTableNames = new Set(Object.keys(exactColumns))
  const required = new Map(COLLABORATION_SCHEMA_DESCRIPTOR.map((descriptor) => [descriptor.split(':')[0]!, descriptor]))
  const actual: string[] = []
  for (const row of result.rows) {
    const table = String(row.table_name)
    if (!expectedTables.has(table)) continue
    const key = `${table}.${String(row.column_name)}`
    const descriptor = `${key}:${String(row.data_type)}:${String(row.is_nullable)}`
    if (exactTableNames.has(table) || required.has(key)) actual.push(descriptor)
  }
  actual.sort()
  return createHash('sha256').update(actual.join('\n'), 'utf8').digest('hex')
}

export function detectCollaborationSchemaRoute(facts: LineageFacts): CollaborationSchemaRoute {
  if (facts.version === null) return 'fresh-v4'
  if (facts.version === 4 && facts.managedContainers && facts.remoteApprovals &&
      !facts.oidcIdentities && !facts.devices && !facts.legacyResourceRefs) return 'upstream-v4'
  if (facts.version === 5 && !facts.managedContainers && !facts.remoteApprovals &&
      facts.oidcIdentities && facts.devices && facts.legacyResourceRefs) return 'public-v5'
  if (facts.version === 9 && facts.managedContainers && !facts.remoteApprovals &&
      facts.oidcIdentities && facts.devices && facts.legacyResourceRefs) return 'staging-v9'
  if (facts.version === 11 && facts.managedContainers && facts.remoteApprovals && facts.oidcIdentities &&
      facts.devices && facts.taskResourceRefs && facts.projectContentSpaceBindings) return 'current-v11'
  throw new Error('collaboration_schema_lineage_unsupported')
}

function assertRoute(facts: LineageFacts, expected: CollaborationSchemaRoute): void {
  if (detectCollaborationSchemaRoute(facts) !== expected) {
    throw new Error(`collaboration_schema_route_mismatch:${expected}`)
  }
}

async function readLineageFacts(pool: SqlPool): Promise<LineageFacts> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT
       to_regclass('sciforge_collaboration.schema_migrations') AS migration_table,
       to_regclass('sciforge_collaboration.managed_provider_containers') IS NOT NULL AS managed_containers,
       to_regclass('sciforge_collaboration.remote_capability_approvals') IS NOT NULL AS remote_approvals,
       to_regclass('sciforge_collaboration.oidc_identities') IS NOT NULL AS oidc_identities,
       to_regclass('sciforge_collaboration.devices') IS NOT NULL AS devices,
       to_regclass('sciforge_collaboration.resource_refs') IS NOT NULL AS legacy_resource_refs,
       to_regclass('sciforge_collaboration.task_resource_refs') IS NOT NULL AS task_resource_refs,
       to_regclass('sciforge_collaboration.project_content_space_bindings') IS NOT NULL AS project_content_space_bindings`
  )
  const row = result.rows[0] ?? {}
  const version = row.migration_table == null
    ? null
    : Number((await pool.query<{ version: unknown }>(
      'SELECT max(version) AS version FROM sciforge_collaboration.schema_migrations'
    )).rows[0]?.version)
  return {
    version,
    managedContainers: Boolean(row.managed_containers),
    remoteApprovals: Boolean(row.remote_approvals),
    oidcIdentities: Boolean(row.oidc_identities),
    devices: Boolean(row.devices),
    legacyResourceRefs: Boolean(row.legacy_resource_refs),
    taskResourceRefs: Boolean(row.task_resource_refs),
    projectContentSpaceBindings: Boolean(row.project_content_space_bindings)
  }
}
