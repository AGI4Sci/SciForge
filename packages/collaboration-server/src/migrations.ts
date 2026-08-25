import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { SqlPool } from './postgres.js'

export const COLLABORATION_SCHEMA_VERSION = 14

export type CollaborationSchemaRoute =
  | 'fresh-v4'
  | 'upstream-v4'
  | 'public-v5'
  | 'staging-v9'
  | 'a-v11'
  | 'current-v12'
  | 'current-v13'
  | 'current-v14'

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
  taskExecutions: boolean
}>

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
  '0014_pre_provider_provisioning_binding.sql'
] as const

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
  projects: ['project_id:text:NO', 'owner_user_id:text:NO', 'display_name:text:NO', 'goal:text:NO',
    'status:text:NO', 'coordinator_agent_id:text:NO', 'max_tasks:integer:NO', 'max_tasks_per_round:integer:NO',
    'max_task_retries:integer:NO', 'max_coordination_rounds:integer:NO', 'coordination_round:integer:NO',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO',
    'content_mode:text:NO', 'coordinator_authority_epoch:bigint:NO', 'execution_authority_epoch:bigint:NO',
    'content_owner_user_id:text:YES'],
  project_members: ['project_id:text:NO', 'user_id:text:NO', 'created_at:timestamp with time zone:NO',
    'project_membership_id:text:NO', 'state:text:NO', 'authority_epoch:bigint:NO',
    'activated_at:timestamp with time zone:YES', 'removal_requested_at:timestamp with time zone:YES',
    'removal_requested_by_user_id:text:YES', 'removed_at:timestamp with time zone:YES',
    'revision:bigint:NO', 'updated_at:timestamp with time zone:NO'],
  worker_availability: ['agent_id:text:NO', 'user_id:text:NO', 'device_id:text:NO', 'agent_active:boolean:NO',
    'device_active:boolean:NO', 'connection_status:text:NO', 'last_heartbeat_at:timestamp with time zone:YES',
    'runtime_readiness:text:NO', 'runtime_capability_tags:jsonb:NO', 'accepts_new_offers:boolean:NO',
    'active_task_count:integer:NO', 'observed_at:timestamp with time zone:NO',
    'expires_at:timestamp with time zone:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  provider_directory_principal_facts: ['provider_principal_fact_id:text:NO', 'user_id:text:NO',
    'provider_principal:jsonb:NO', 'principal_identity_revision:bigint:NO',
    'provider_binding_attestation_digest:text:NO', 'published_by_device_id:text:NO',
    'readiness:text:NO', 'readiness_reason:text:YES', 'observed_at:timestamp with time zone:NO',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  project_provider_principal_refs: [],
  task_authorities: ['task_authority_id:text:NO', 'project_id:text:NO', 'user_id:text:NO', 'scope:text:NO',
    'state:text:NO', 'authority_epoch:bigint:NO', 'reason:text:YES', 'effective_at:timestamp with time zone:NO',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  project_content_provisioning_intents: ['provisioning_intent_id:text:NO', 'project_id:text:NO',
    'provisioning_revision:bigint:NO', 'kind:text:NO', 'state:text:NO', 'created_by_owner_user_id:text:NO',
    'content_owner_user_id:text:NO', 'provider_instance:jsonb:NO', 'desired_members:jsonb:NO',
    'container_display_name:text:NO', 'current_root_locator:jsonb:YES',
    'current_binding_revision:bigint:YES', 'intent_digest:text:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  project_content_provisioning_attestations: ['provisioning_attestation_id:text:NO',
    'provisioning_intent_id:text:NO', 'project_id:text:NO', 'provisioning_revision:bigint:NO',
    'owner_user_id:text:NO', 'principal_identity_revision:bigint:NO',
    'provider_binding_attestation_digest:text:NO', 'provider_instance:jsonb:NO',
    'root_locator:jsonb:NO', 'root_locator_digest:text:NO', 'observed_operations:jsonb:NO',
    'member_observations:jsonb:NO', 'member_set_digest:text:NO',
    'observation_started_at:timestamp with time zone:NO',
    'observation_completed_at:timestamp with time zone:NO', 'device_signature:jsonb:NO',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO',
    'updated_at:timestamp with time zone:NO'],
  project_content_space_bindings: ['project_id:text:NO', 'root_locator:jsonb:YES', 'root_locator_digest:text:YES',
    'status:text:NO', 'revision:bigint:NO', 'created_at:timestamp with time zone:NO',
    'updated_at:timestamp with time zone:NO', 'project_content_binding_id:text:NO',
    'content_owner_user_id:text:NO', 'provider_instance:jsonb:NO', 'provisioning_intent_id:text:NO',
    'provisioning_revision:bigint:NO', 'attestation_id:text:YES', 'attestation_digest:text:YES',
    'status_reason:text:YES', 'activated_at:timestamp with time zone:YES',
    'degraded_at:timestamp with time zone:YES', 'closed_at:timestamp with time zone:YES'],
  project_provider_membership_observations: ['provider_observation_id:text:NO', 'project_id:text:NO',
    'user_id:text:NO', 'provider_principal_fact_id:text:NO', 'snapshotted_fact_revision:bigint:NO',
    'provider_principal:jsonb:NO', 'binding_revision:bigint:NO', 'provisioning_revision:bigint:NO',
    'source:text:NO', 'outcome:text:NO',
    'observer_user_id:text:NO', 'observer_device_id:text:NO', 'observer_agent_id:text:YES',
    'provisioning_attestation_id:text:YES', 'evidence_digest:text:NO',
    'observed_at:timestamp with time zone:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  project_content_readiness: ['project_id:text:NO', 'user_id:text:NO', 'provider_instance:jsonb:NO',
    'state:text:NO', 'reason:text:YES',
    'provider_principal_fact_id:text:YES', 'snapshotted_fact_revision:bigint:YES',
    'provider_principal:jsonb:YES', 'binding_revision:bigint:YES', 'last_observation_id:text:YES',
    'effective_at:timestamp with time zone:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  tasks: ['task_id:text:NO', 'project_id:text:NO', 'title:text:NO', 'objective:text:NO',
    'completion_criteria:jsonb:NO', 'dependency_task_ids:jsonb:NO', 'status:text:NO',
    'max_retries:integer:NO', 'coordination_round:integer:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO',
    'completed_at:timestamp with time zone:YES', 'file_intent:jsonb:YES',
    'created_by_coordinator_agent_id:text:NO', 'current_execution_id:text:YES',
    'current_execution_state:text:YES', 'execution_count:integer:NO'],
  task_executions: ['execution_id:text:NO', 'task_id:text:NO', 'project_id:text:NO', 'attempt:integer:NO',
    'offered_by_coordinator_agent_id:text:NO', 'assignee_user_id:text:NO', 'assignee_agent_id:text:NO',
    'assignee_device_id:text:NO', 'state:text:NO', 'state_revision:bigint:NO', 'fence:jsonb:NO',
    'file_intent:jsonb:YES', 'current_result_submission_id:text:YES',
    'offered_at:timestamp with time zone:NO', 'accepted_at:timestamp with time zone:YES',
    'started_at:timestamp with time zone:YES', 'terminal_at:timestamp with time zone:YES',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO',
    'updated_at:timestamp with time zone:NO'],
  task_offers: ['task_offer_id:text:NO', 'execution_id:text:NO', 'task_id:text:NO', 'project_id:text:NO',
    'assignee_user_id:text:NO', 'assignee_agent_id:text:NO', 'assignee_device_id:text:NO',
    'state:text:NO', 'offered_at:timestamp with time zone:NO', 'expires_at:timestamp with time zone:NO',
    'responded_at:timestamp with time zone:YES', 'rejection_reason:text:YES', 'safe_reason_detail:text:YES',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO',
    'updated_at:timestamp with time zone:NO'],
  task_execution_events: [],
  external_operation_journal: ['content_recovery_journal_entry_id:text:NO', 'scope:text:NO',
    'logical_invocation_id:text:NO', 'project_id:text:NO', 'task_id:text:YES',
    'prepared_task_revision:bigint:YES', 'provisioning_intent_id:text:YES',
    'provisioning_revision:bigint:YES', 'execution_id:text:YES',
    'prepared_execution_revision:bigint:YES', 'operation:text:NO',
    'request_digest:text:NO', 'state:text:NO', 'observation_digest:text:YES',
    'receipt_digest:text:YES', 'safe_failure_code:text:YES', 'prepared_at:timestamp with time zone:NO',
    'dispatched_at:timestamp with time zone:YES', 'resolved_at:timestamp with time zone:YES',
    'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  visible_recovery_actions: ['recovery_action_id:text:NO', 'project_id:text:NO',
    'task_id:text:YES', 'execution_id:text:YES', 'journal_entry_id:text:NO',
    'audience:text:NO', 'action:text:NO', 'status:text:NO',
    'requires_fresh_observation:boolean:NO', 'safe_summary:text:NO',
    'available_at:timestamp with time zone:NO', 'completed_at:timestamp with time zone:YES',
    'revision:bigint:NO', 'created_at:timestamp with time zone:NO',
    'updated_at:timestamp with time zone:NO'],
  project_plans: ['project_plan_id:text:NO', 'project_id:text:NO', 'coordinator_authority_epoch:bigint:NO',
    'state:text:NO', 'plan_revision:bigint:NO', 'source_input_locators:jsonb:NO', 'tasks:jsonb:NO',
    'rationale:text:NO', 'runtime_provenance:jsonb:NO', 'plan_digest:text:NO',
    'submitted_at:timestamp with time zone:YES', 'confirmed_by_user_id:text:YES',
    'confirmed_at:timestamp with time zone:YES', 'superseded_at:timestamp with time zone:YES',
    'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  task_result_submissions: ['result_submission_id:text:NO', 'project_id:text:NO', 'task_id:text:NO',
    'execution_id:text:NO', 'submitted_task_revision:bigint:NO',
    'submitted_execution_revision:bigint:NO',
    'submitted_by_user_id:text:NO', 'submitted_by_agent_id:text:NO', 'summary:text:NO',
    'runtime_provenance:jsonb:NO', 'outputs:jsonb:NO', 'recovery_journal_entry_ids:jsonb:NO',
    'submission_digest:text:NO', 'submitted_at:timestamp with time zone:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  task_result_reviews: ['review_decision_id:text:NO', 'result_submission_id:text:NO', 'project_id:text:NO',
    'task_id:text:NO', 'execution_id:text:NO', 'reviewed_result_revision:bigint:NO',
    'decided_by_user_id:text:NO', 'decided_by_coordinator_agent_id:text:NO',
    'coordinator_authority_epoch:bigint:NO', 'decision:text:NO', 'instruction:text:YES',
    'accepted_project_record_id:text:YES', 'next_execution_id:text:YES',
    'decided_at:timestamp with time zone:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  project_final_summaries: ['project_id:text:NO', 'project_record_id:text:NO', 'project_plan_id:text:NO',
    'confirmed_plan_revision:bigint:NO', 'accepted_result_submission_ids:jsonb:NO', 'summary:text:NO',
    'created_by_user_id:text:NO', 'created_by_coordinator_agent_id:text:NO',
    'coordinator_authority_epoch:bigint:NO',
    'completed_at:timestamp with time zone:NO', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  project_records: ['project_record_id:text:NO', 'project_id:text:NO', 'kind:text:NO', 'status:text:NO',
    'summary:text:NO', 'author_user_id:text:YES', 'author_agent_id:text:YES', 'source_task_id:text:YES',
    'source_revision:bigint:YES', 'accepted_by_user_id:text:YES', 'accepted_by_agent_id:text:YES',
    'accepted_at:timestamp with time zone:YES', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO',
    'source_result_submission_id:text:YES', 'source_human_answer_id:text:YES'],
  endpoint_challenge_rate_windows: ['user_id:text:NO', 'provider:text:NO', 'realm_id:text:NO',
    'window_started_at:timestamp with time zone:NO', 'expires_at:timestamp with time zone:NO',
    'attempt_count:integer:NO', 'revision:bigint:NO', 'updated_at:timestamp with time zone:NO'],
  task_resource_refs: ['resource_ref_id:text:NO', 'project_id:text:NO', 'task_id:text:NO', 'execution_id:text:NO',
    'assignment_task_revision:bigint:NO', 'binding_revision:bigint:NO', 'intent_digest:text:NO', 'role:text:NO',
    'ordinal:integer:NO', 'locator:jsonb:NO', 'locator_digest:text:NO', 'status:text:NO',
    'invalidated_at:timestamp with time zone:YES', 'revision:bigint:NO',
    'created_at:timestamp with time zone:NO', 'updated_at:timestamp with time zone:NO'],
  human_endpoint_challenges: ['challenge_id:text:NO', 'requested_user_id:text:NO', 'provider:text:NO',
    'realm_id:text:NO', 'expected_provider_user_id:text:NO', 'challenge_digest:bytea:NO',
    'expires_at:timestamp with time zone:NO', 'verified_user_id:text:YES', 'verified_endpoint_id:text:YES',
    'verified_at:timestamp with time zone:YES', 'created_at:timestamp with time zone:NO']
} as const

const requiredColumns = {
  agent_nodes: ['device_id:text:NO'],
  human_requests: ['request_scope:text:NO', 'execution_id:text:YES',
    'coordinator_authority_epoch:bigint:YES', 'confirmable_action:jsonb:YES'],
  human_answers: ['request_scope:text:NO', 'execution_id:text:YES',
    'coordinator_authority_epoch:bigint:YES', 'answered_from_oidc_identity_id:text:YES',
    'answered_from_human_endpoint_id:text:YES', 'decision:text:YES', 'confirmation_id:text:YES']
} as const

const forbiddenColumns = {
  agent_nodes: ['installation_id'],
  projects: ['coordinator_epoch'],
  project_members: ['role', 'active'],
  tasks: ['assignee_agent_id', 'created_by_agent_id', 'retry_count', 'active_turn_id',
    'result_summary', 'failure_summary', 'resource_ref_ids', 'execution_id',
    'execution_assignee_agent_id', 'execution_task_revision', 'execution_binding_revision',
    'intent_digest', 'assignee_user_id', 'result_record_id', 'safe_failure_code'],
  project_content_space_bindings: ['authorization_proof_id', 'authorization_issuer',
    'authorization_proof_digest', 'authorization_actor_principal_digest', 'principal_authority',
    'principal_subject', 'principal_device_id', 'principal_identity_version', 'authorization_scopes',
    'authorization_issued_at', 'authorization_expires_at', 'provider_instance_ref',
    'provisioning_attestation_id', 'safe_error_code'],
  human_answers: []
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
  if (route === 'upstream-v4' || route === 'public-v5' || route === 'staging-v9') {
    const actualSourceFingerprint = await (runtime.sourceCatalogFingerprint ?? collaborationCatalogFingerprint)(pool)
    if (actualSourceFingerprint !== COLLABORATION_SOURCE_CATALOG_FINGERPRINTS[route]) {
      throw new Error(`collaboration_schema_source_fingerprint_mismatch:${route}`)
    }
  }
  if (![11, 12, 13, COLLABORATION_SCHEMA_VERSION].includes(facts.version ?? -1)) {
    await applyMigration(pool, FORWARD_MIGRATIONS[0])
    facts = await readLineageFacts(pool)
  }
  if (![12, 13, COLLABORATION_SCHEMA_VERSION].includes(facts.version ?? -1)) {
    await applyMigration(pool, FORWARD_MIGRATIONS[1])
    facts = await readLineageFacts(pool)
  }
  if (![13, COLLABORATION_SCHEMA_VERSION].includes(facts.version ?? -1)) {
    await applyMigration(pool, FORWARD_MIGRATIONS[2])
    facts = await readLineageFacts(pool)
  }
  if (facts.version !== COLLABORATION_SCHEMA_VERSION) {
    await applyMigration(pool, FORWARD_MIGRATIONS[3])
  }
  const current = await readLineageFacts(pool)
  assertRoute(current, 'current-v14')
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
    assertRoute(await readLineageFacts(pool), 'current-v14')
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
  const forbidden = new Set(Object.entries(forbiddenColumns)
    .flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`)))
  const actual: string[] = []
  for (const row of result.rows) {
    const table = String(row.table_name)
    if (!expectedTables.has(table)) continue
    const key = `${table}.${String(row.column_name)}`
    const descriptor = `${key}:${String(row.data_type)}:${String(row.is_nullable)}`
    if (exactTableNames.has(table) || required.has(key) || forbidden.has(key)) actual.push(descriptor)
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
      facts.devices && facts.taskResourceRefs && facts.projectContentSpaceBindings && !facts.taskExecutions) return 'a-v11'
  if (facts.version === 12 && facts.managedContainers && facts.remoteApprovals && facts.oidcIdentities &&
      facts.devices && facts.taskResourceRefs && facts.projectContentSpaceBindings && !facts.taskExecutions) return 'current-v12'
  if (facts.version === 13 && facts.managedContainers && facts.remoteApprovals && facts.oidcIdentities &&
      facts.devices && facts.taskResourceRefs && facts.projectContentSpaceBindings && facts.taskExecutions) {
    return 'current-v13'
  }
  if (facts.version === 14 && facts.managedContainers && facts.remoteApprovals && facts.oidcIdentities &&
      facts.devices && facts.taskResourceRefs && facts.projectContentSpaceBindings && facts.taskExecutions) {
    return 'current-v14'
  }
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
       to_regclass('sciforge_collaboration.project_content_space_bindings') IS NOT NULL AS project_content_space_bindings,
       to_regclass('sciforge_collaboration.task_executions') IS NOT NULL AS task_executions`
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
    projectContentSpaceBindings: Boolean(row.project_content_space_bindings),
    taskExecutions: Boolean(row.task_executions)
  }
}
