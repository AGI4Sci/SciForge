BEGIN;

DO $$
DECLARE
  current_version integer;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version <> 12 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0013_unsupported_source_lineage';
  END IF;
END
$$;

-- A v12 content binding contains authorization-proof material that cannot be
-- reinterpreted as a v13 Provider Directory identity or Device attestation.
-- Refuse the whole transaction before any schema or data mutation.
LOCK TABLE sciforge_collaboration.project_content_space_bindings
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sciforge_collaboration.project_content_space_bindings
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0013_legacy_content_binding_requires_reprovision';
  END IF;
END
$$;

LOCK TABLE
  sciforge_collaboration.projects,
  sciforge_collaboration.project_members,
  sciforge_collaboration.tasks,
  sciforge_collaboration.task_resource_refs,
  sciforge_collaboration.human_requests,
  sciforge_collaboration.human_answers
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sciforge_collaboration.tasks
    WHERE retry_count > 100 OR max_retries > 100 OR retry_count > max_retries
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0013_task_retry_budget_out_of_range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.tasks AS task
    LEFT JOIN sciforge_collaboration.agent_nodes AS agent
      ON agent.agent_id = task.execution_assignee_agent_id
    LEFT JOIN sciforge_collaboration.project_members AS member
      ON member.project_id = task.project_id AND member.user_id = agent.owner_user_id
    WHERE agent.agent_id IS NULL OR agent.device_id IS NULL OR member.user_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0013_task_execution_identity_missing';
  END IF;
END
$$;

-- These public-v5/staging-v9 tables predate the frozen v14 contracts. Their
-- replacement facts already live in the canonical Device/Agent authority,
-- task_resource_refs, HumanAnswer, and Provider binding models created by the
-- admitted forward path. No legacy facade or parallel write path survives v14.
DROP TABLE IF EXISTS sciforge_collaboration.action_confirmations;
DROP TABLE IF EXISTS sciforge_collaboration.agent_capability_profiles;
DROP TABLE IF EXISTS sciforge_collaboration.resource_refs;
DROP TABLE IF EXISTS sciforge_collaboration.zulip_binding_requests;

ALTER TABLE sciforge_collaboration.project_records
  ADD COLUMN source_result_submission_id text,
  ADD COLUMN source_human_answer_id text REFERENCES sciforge_collaboration.human_answers(human_answer_id),
  ALTER COLUMN author_user_id DROP NOT NULL,
  DROP COLUMN IF EXISTS source_execution_id,
  DROP COLUMN IF EXISTS criterion_evidence,
  DROP COLUMN IF EXISTS resource_ref_ids,
  DROP COLUMN IF EXISTS log_summary,
  ADD CONSTRAINT project_records_canonical_kind_check
    CHECK (kind IN ('observation', 'decision', 'summary')) NOT VALID,
  ADD CONSTRAINT project_records_canonical_status_check
    CHECK (status = 'accepted') NOT VALID,
  ADD CONSTRAINT project_records_coordinator_writer_check
    CHECK (
      author_agent_id IS NOT NULL
      AND author_user_id IS NOT NULL
      AND accepted_by_agent_id IS NOT NULL
      AND accepted_by_user_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND author_agent_id = accepted_by_agent_id
      AND author_user_id = accepted_by_user_id
    ) NOT VALID;

-- Projects own three distinct revision domains: the entity revision,
-- Coordinator plan/review authority, and execution-fence authority.
ALTER TABLE sciforge_collaboration.projects
  ADD COLUMN content_mode text,
  ADD COLUMN coordinator_authority_epoch bigint,
  ADD COLUMN execution_authority_epoch bigint,
  ADD COLUMN content_owner_user_id text;

UPDATE sciforge_collaboration.projects AS project
SET status = CASE WHEN project.status = 'failed' THEN 'cancelled' ELSE project.status END,
    content_mode = CASE WHEN EXISTS (
      SELECT 1
      FROM sciforge_collaboration.project_content_space_bindings AS binding
      WHERE binding.project_id = project.project_id
    ) THEN 'required' ELSE 'none' END,
    coordinator_authority_epoch = 1,
    execution_authority_epoch = 1,
    content_owner_user_id = CASE WHEN EXISTS (
      SELECT 1
      FROM sciforge_collaboration.project_content_space_bindings AS binding
      WHERE binding.project_id = project.project_id
    ) THEN project.owner_user_id ELSE NULL END;

ALTER TABLE sciforge_collaboration.projects
  ALTER COLUMN content_mode SET NOT NULL,
  ALTER COLUMN coordinator_authority_epoch SET NOT NULL,
  ALTER COLUMN execution_authority_epoch SET NOT NULL,
  DROP CONSTRAINT IF EXISTS projects_status_check,
  ADD CONSTRAINT projects_status_check CHECK (
    status IN ('draft', 'active', 'paused', 'completed', 'cancelled')
  ),
  ADD CONSTRAINT projects_content_mode_check CHECK (content_mode IN ('none', 'required')),
  ADD CONSTRAINT projects_content_mode_owner_check CHECK (
    (content_mode = 'required') = (content_owner_user_id IS NOT NULL)
  ),
  ADD CONSTRAINT projects_coordinator_authority_epoch_check
    CHECK (coordinator_authority_epoch >= 1),
  ADD CONSTRAINT projects_execution_authority_epoch_check
    CHECK (execution_authority_epoch >= 1),
  ADD CONSTRAINT projects_content_owner_fk FOREIGN KEY (content_owner_user_id)
    REFERENCES sciforge_collaboration.user_principals(user_id);

-- Owner authority now lives only on projects.owner_user_id. Membership is a
-- state machine and no longer duplicates owner/member/observer roles.
DROP INDEX IF EXISTS sciforge_collaboration.project_one_owner;

ALTER TABLE sciforge_collaboration.project_members
  ADD COLUMN project_membership_id text,
  ADD COLUMN state text,
  ADD COLUMN authority_epoch bigint,
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN removal_requested_at timestamptz,
  ADD COLUMN removal_requested_by_user_id text,
  ADD COLUMN removed_at timestamptz,
  ADD COLUMN revision bigint,
  ADD COLUMN updated_at timestamptz;

UPDATE sciforge_collaboration.project_members AS member
SET project_membership_id = 'pmb_' || substr(md5(
      member.project_id || ':' || member.user_id || ':schema-13'
    ), 1, 24),
    state = CASE WHEN member.active THEN 'active' ELSE 'removed' END,
    authority_epoch = 1,
    -- Every state after pending retains its activation time, including removed.
    activated_at = member.created_at,
    removal_requested_at = CASE WHEN member.active THEN NULL ELSE member.created_at END,
    removal_requested_by_user_id = CASE WHEN member.active THEN NULL ELSE project.owner_user_id END,
    removed_at = CASE WHEN member.active THEN NULL ELSE member.created_at END,
    revision = 1,
    updated_at = member.created_at
FROM sciforge_collaboration.projects AS project
WHERE project.project_id = member.project_id;

ALTER TABLE sciforge_collaboration.project_members
  ALTER COLUMN project_membership_id SET NOT NULL,
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN authority_epoch SET NOT NULL,
  ALTER COLUMN revision SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  DROP COLUMN role,
  DROP COLUMN active,
  ADD CONSTRAINT project_members_membership_id_unique UNIQUE (project_membership_id),
  ADD CONSTRAINT project_members_state_check CHECK (
    state IN ('pending_membership', 'active', 'membership_removal_pending', 'removed')
  ),
  ADD CONSTRAINT project_members_authority_epoch_check CHECK (authority_epoch >= 1),
  ADD CONSTRAINT project_members_revision_check CHECK (revision >= 1),
  ADD CONSTRAINT project_members_removal_requester_fk FOREIGN KEY (removal_requested_by_user_id)
    REFERENCES sciforge_collaboration.user_principals(user_id),
  ADD CONSTRAINT project_members_state_time_check CHECK (
    (state = 'pending_membership' AND activated_at IS NULL
      AND removal_requested_at IS NULL AND removal_requested_by_user_id IS NULL AND removed_at IS NULL)
    OR (state = 'active' AND activated_at IS NOT NULL
      AND removal_requested_at IS NULL AND removal_requested_by_user_id IS NULL AND removed_at IS NULL)
    OR (state = 'membership_removal_pending' AND activated_at IS NOT NULL
      AND removal_requested_at IS NOT NULL AND removal_requested_by_user_id IS NOT NULL AND removed_at IS NULL)
    OR (state = 'removed' AND activated_at IS NOT NULL
      AND removal_requested_at IS NOT NULL AND removal_requested_by_user_id IS NOT NULL AND removed_at IS NOT NULL)
  );

CREATE INDEX project_members_project_state
  ON sciforge_collaboration.project_members(project_id, state);

-- Availability is global by exact Agent. Project eligibility composes it with
-- membership, content readiness and Task Authority instead of duplicating it.
CREATE TABLE sciforge_collaboration.worker_availability (
  agent_id text PRIMARY KEY REFERENCES sciforge_collaboration.agent_nodes(agent_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  device_id text NOT NULL REFERENCES sciforge_collaboration.devices(device_id),
  agent_active boolean NOT NULL,
  device_active boolean NOT NULL,
  connection_status text NOT NULL CHECK (connection_status IN ('online', 'offline')),
  last_heartbeat_at timestamptz,
  runtime_readiness text NOT NULL CHECK (runtime_readiness IN ('ready', 'unavailable')),
  runtime_capability_tags jsonb NOT NULL CHECK (jsonb_typeof(runtime_capability_tags) = 'array'),
  accepts_new_offers boolean NOT NULL,
  active_task_count integer NOT NULL CHECK (active_task_count BETWEEN 0 AND 10000),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT worker_availability_observation_time CHECK (expires_at > observed_at),
  CONSTRAINT worker_availability_online_heartbeat CHECK (
    connection_status <> 'online' OR last_heartbeat_at IS NOT NULL
  ),
  CONSTRAINT worker_availability_acceptance_check CHECK (
    NOT accepts_new_offers OR (
      agent_active AND device_active AND connection_status = 'online' AND runtime_readiness = 'ready'
    )
  )
);

CREATE INDEX worker_availability_user_expires
  ON sciforge_collaboration.worker_availability(user_id, expires_at);

-- Provider principals are global descriptive, Device-published facts. A
-- Project atomically snapshots exact ready fact revisions into its intent; no
-- legacy authorization proof is promoted into this table.
CREATE TABLE sciforge_collaboration.provider_directory_principal_facts (
  provider_principal_fact_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  provider_principal jsonb NOT NULL CHECK (jsonb_typeof(provider_principal) = 'object'),
  principal_identity_revision bigint NOT NULL CHECK (principal_identity_revision >= 1),
  provider_binding_attestation_digest text NOT NULL
    CHECK (provider_binding_attestation_digest ~ '^[a-f0-9]{64}$'),
  published_by_device_id text NOT NULL REFERENCES sciforge_collaboration.devices(device_id),
  readiness text NOT NULL CHECK (readiness IN ('ready', 'degraded')),
  readiness_reason text CHECK (readiness_reason IN (
    'provider_binding_changed', 'provider_unavailable', 'provider_unauthorized'
  )),
  observed_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT provider_directory_principal_facts_readiness_shape CHECK (
    (readiness = 'ready') = (readiness_reason IS NULL)
  ),
  CONSTRAINT provider_directory_principal_facts_instance_shape CHECK (
    provider_principal #>> '{providerInstance,providerInstanceRef}' IS NOT NULL
  )
);

CREATE UNIQUE INDEX provider_directory_principal_facts_user_instance
  ON sciforge_collaboration.provider_directory_principal_facts(
    user_id,
    (provider_principal #>> '{providerInstance,providerInstanceRef}')
  );

CREATE TABLE sciforge_collaboration.task_authorities (
  task_authority_id text NOT NULL UNIQUE,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  scope text NOT NULL CHECK (scope IN ('text_tasks', 'file_tasks')),
  state text NOT NULL CHECK (state IN ('eligible', 'suspended', 'fenced')),
  authority_epoch bigint NOT NULL CHECK (authority_epoch >= 1),
  reason text CHECK (reason IN (
    'project_paused', 'project_terminal', 'membership_pending',
    'membership_removal_pending', 'membership_removed', 'content_identity_missing',
    'content_not_ready', 'content_binding_degraded'
  )),
  effective_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, user_id, scope),
  CONSTRAINT task_authorities_state_reason_check CHECK (
    (state = 'eligible') = (reason IS NULL)
  )
);

INSERT INTO sciforge_collaboration.task_authorities
  (task_authority_id,project_id,user_id,scope,state,authority_epoch,reason,effective_at,
   revision,created_at,updated_at)
SELECT
  'tau_' || substr(md5(
    member.project_id || ':' || member.user_id || ':' || authority_scope.scope || ':schema-13'
  ), 1, 24),
  member.project_id,
  member.user_id,
  authority_scope.scope,
  CASE
    WHEN member.state = 'removed' THEN 'fenced'
    WHEN member.state = 'membership_removal_pending' THEN 'fenced'
    WHEN member.state = 'pending_membership' THEN 'suspended'
    WHEN project.status IN ('completed', 'cancelled') THEN 'fenced'
    WHEN project.status = 'paused' THEN 'suspended'
    WHEN authority_scope.scope = 'file_tasks' THEN 'fenced'
    ELSE 'eligible'
  END,
  member.authority_epoch,
  CASE
    WHEN member.state = 'removed' THEN 'membership_removed'
    WHEN member.state = 'membership_removal_pending' THEN 'membership_removal_pending'
    WHEN member.state = 'pending_membership' THEN 'membership_pending'
    WHEN project.status IN ('completed', 'cancelled') THEN 'project_terminal'
    WHEN project.status = 'paused' THEN 'project_paused'
    WHEN authority_scope.scope = 'file_tasks' THEN 'content_identity_missing'
    ELSE NULL
  END,
  member.updated_at,
  1,
  member.created_at,
  member.updated_at
FROM sciforge_collaboration.project_members AS member
JOIN sciforge_collaboration.projects AS project ON project.project_id = member.project_id
CROSS JOIN (VALUES ('text_tasks'), ('file_tasks')) AS authority_scope(scope);

CREATE TABLE sciforge_collaboration.project_content_provisioning_intents (
  provisioning_intent_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  provisioning_revision bigint NOT NULL CHECK (provisioning_revision >= 1),
  kind text NOT NULL CHECK (kind IN (
    'initial_provisioning', 'membership_change', 'reconcile', 'rebind', 'content_owner_transfer'
  )),
  state text NOT NULL CHECK (state IN (
    'pending', 'in_progress', 'awaiting_attestation', 'manual_recovery_required',
    'completed', 'superseded', 'cancelled'
  )),
  created_by_owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  content_owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  provider_instance jsonb NOT NULL CHECK (jsonb_typeof(provider_instance) = 'object'),
  desired_members jsonb NOT NULL CHECK (
    jsonb_typeof(desired_members) = 'array' AND jsonb_array_length(desired_members) BETWEEN 1 AND 1000
  ),
  container_display_name text NOT NULL CHECK (char_length(container_display_name) BETWEEN 1 AND 200),
  current_root_locator jsonb CHECK (current_root_locator IS NULL OR jsonb_typeof(current_root_locator) = 'object'),
  current_binding_revision bigint CHECK (current_binding_revision >= 1),
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_content_provisioning_intent_revision_unique
    UNIQUE (project_id, provisioning_revision),
  CONSTRAINT project_content_provisioning_intent_current_binding_pair CHECK (
    (current_root_locator IS NULL) = (current_binding_revision IS NULL)
  )
);

CREATE TABLE sciforge_collaboration.project_content_provisioning_attestations (
  provisioning_attestation_id text PRIMARY KEY,
  provisioning_intent_id text NOT NULL
    REFERENCES sciforge_collaboration.project_content_provisioning_intents(provisioning_intent_id),
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  provisioning_revision bigint NOT NULL CHECK (provisioning_revision >= 1),
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  principal_identity_revision bigint NOT NULL CHECK (principal_identity_revision >= 1),
  provider_binding_attestation_digest text NOT NULL
    CHECK (provider_binding_attestation_digest ~ '^[a-f0-9]{64}$'),
  provider_instance jsonb NOT NULL CHECK (jsonb_typeof(provider_instance) = 'object'),
  root_locator jsonb NOT NULL CHECK (jsonb_typeof(root_locator) = 'object'),
  root_locator_digest text NOT NULL CHECK (root_locator_digest ~ '^[a-f0-9]{64}$'),
  observed_operations jsonb NOT NULL CHECK (jsonb_typeof(observed_operations) = 'array'),
  member_observations jsonb NOT NULL CHECK (jsonb_typeof(member_observations) = 'array'),
  member_set_digest text NOT NULL CHECK (member_set_digest ~ '^[a-f0-9]{64}$'),
  observation_started_at timestamptz NOT NULL,
  observation_completed_at timestamptz NOT NULL,
  device_signature jsonb NOT NULL CHECK (jsonb_typeof(device_signature) = 'object'),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT provisioning_attestation_intent_revision_unique
    UNIQUE (provisioning_intent_id, provisioning_revision),
  CONSTRAINT provisioning_attestation_observation_time CHECK (
    observation_completed_at >= observation_started_at
  )
);

ALTER TABLE sciforge_collaboration.project_content_space_bindings
  ALTER COLUMN root_locator DROP NOT NULL,
  ALTER COLUMN root_locator_digest DROP NOT NULL,
  ADD COLUMN project_content_binding_id text,
  ADD COLUMN content_owner_user_id text,
  ADD COLUMN provider_instance jsonb,
  ADD COLUMN provisioning_intent_id text,
  ADD COLUMN provisioning_revision bigint,
  ADD COLUMN attestation_id text,
  ADD COLUMN attestation_digest text,
  ADD COLUMN status_reason text,
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN degraded_at timestamptz,
  ADD COLUMN closed_at timestamptz;

ALTER TABLE sciforge_collaboration.project_content_space_bindings
  DROP CONSTRAINT IF EXISTS project_content_space_bindings_status_check,
  DROP CONSTRAINT IF EXISTS project_content_space_authorization_time;

ALTER TABLE sciforge_collaboration.project_content_space_bindings
  ALTER COLUMN project_content_binding_id SET NOT NULL,
  ALTER COLUMN content_owner_user_id SET NOT NULL,
  ALTER COLUMN provider_instance SET NOT NULL,
  ALTER COLUMN provisioning_intent_id SET NOT NULL,
  ALTER COLUMN provisioning_revision SET NOT NULL,
  DROP COLUMN authorization_proof_id,
  DROP COLUMN authorization_issuer,
  DROP COLUMN authorization_proof_digest,
  DROP COLUMN authorization_actor_principal_digest,
  DROP COLUMN principal_authority,
  DROP COLUMN principal_subject,
  DROP COLUMN principal_device_id,
  DROP COLUMN principal_identity_version,
  DROP COLUMN authorization_scopes,
  DROP COLUMN authorization_issued_at,
  DROP COLUMN authorization_expires_at,
  ADD CONSTRAINT project_content_space_binding_id_unique UNIQUE (project_content_binding_id),
  ADD CONSTRAINT project_content_space_binding_owner_fk FOREIGN KEY (content_owner_user_id)
    REFERENCES sciforge_collaboration.user_principals(user_id),
  ADD CONSTRAINT project_content_space_binding_intent_fk FOREIGN KEY (provisioning_intent_id)
    REFERENCES sciforge_collaboration.project_content_provisioning_intents(provisioning_intent_id),
  ADD CONSTRAINT project_content_space_binding_attestation_fk FOREIGN KEY (attestation_id)
    REFERENCES sciforge_collaboration.project_content_provisioning_attestations(provisioning_attestation_id),
  ADD CONSTRAINT project_content_space_binding_status_check CHECK (
    status IN ('provisioning', 'active', 'degraded', 'closed')
  ),
  ADD CONSTRAINT project_content_space_binding_status_reason_check CHECK (status_reason IN (
    'provisioning_incomplete', 'provider_unavailable', 'owner_access_lost', 'rebind_required',
    'content_owner_transfer_pending', 'project_archived', 'project_deleted', 'owner_requested'
  )),
  ADD CONSTRAINT project_content_space_binding_revision_check CHECK (provisioning_revision >= 1),
  ADD CONSTRAINT project_content_space_binding_root_pair CHECK (
    (root_locator IS NULL) = (root_locator_digest IS NULL)
  ),
  ADD CONSTRAINT project_content_space_binding_attestation_pair CHECK (
    (attestation_id IS NULL) = (attestation_digest IS NULL)
  ),
  ADD CONSTRAINT project_content_space_binding_state_shape CHECK (
    (status = 'provisioning' AND status_reason = 'provisioning_incomplete'
      AND root_locator IS NOT NULL AND attestation_id IS NULL
      AND activated_at IS NULL AND degraded_at IS NULL AND closed_at IS NULL)
    OR (status = 'active' AND status_reason IS NULL
      AND root_locator IS NOT NULL AND attestation_id IS NOT NULL
      AND activated_at IS NOT NULL AND degraded_at IS NULL AND closed_at IS NULL)
    OR (status = 'degraded' AND status_reason IS NOT NULL
      AND status_reason IN ('provider_unavailable', 'owner_access_lost', 'rebind_required',
        'content_owner_transfer_pending')
      AND root_locator IS NOT NULL AND attestation_id IS NOT NULL
      AND activated_at IS NOT NULL AND degraded_at IS NOT NULL AND closed_at IS NULL)
    OR (status = 'closed'
      AND status_reason IN ('project_archived', 'project_deleted', 'owner_requested')
      AND closed_at IS NOT NULL
      AND (activated_at IS NULL OR (root_locator IS NOT NULL AND attestation_id IS NOT NULL))
      AND (degraded_at IS NULL OR activated_at IS NOT NULL))
  );

CREATE TABLE sciforge_collaboration.project_provider_membership_observations (
  provider_observation_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  provider_principal_fact_id text NOT NULL
    REFERENCES sciforge_collaboration.provider_directory_principal_facts(provider_principal_fact_id),
  snapshotted_fact_revision bigint NOT NULL CHECK (snapshotted_fact_revision >= 1),
  provider_principal jsonb NOT NULL CHECK (jsonb_typeof(provider_principal) = 'object'),
  binding_revision bigint NOT NULL CHECK (binding_revision >= 1),
  provisioning_revision bigint NOT NULL CHECK (provisioning_revision >= 1),
  source text NOT NULL CHECK (source IN (
    'provisioning_attestation', 'explicit_reconcile', 'download_check', 'upload_new'
  )),
  outcome text NOT NULL CHECK (outcome IN ('present', 'absent', 'unauthorized', 'unavailable')),
  observer_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  observer_device_id text NOT NULL REFERENCES sciforge_collaboration.devices(device_id),
  observer_agent_id text REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  provisioning_attestation_id text
    REFERENCES sciforge_collaboration.project_content_provisioning_attestations(provisioning_attestation_id),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_provider_observation_attestation_source CHECK (
    (source = 'provisioning_attestation') = (provisioning_attestation_id IS NOT NULL)
  )
);

CREATE INDEX project_provider_membership_observations_project_user_time
  ON sciforge_collaboration.project_provider_membership_observations(project_id, user_id, observed_at DESC);

CREATE TABLE sciforge_collaboration.project_content_readiness (
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  provider_instance jsonb NOT NULL CHECK (jsonb_typeof(provider_instance) = 'object'),
  state text NOT NULL CHECK (state IN ('missing_identity', 'pending', 'ready', 'degraded')),
  reason text CHECK (reason IN (
    'identity_missing', 'provisioning_pending', 'provider_member_absent', 'provider_unavailable',
    'provider_unauthorized', 'binding_degraded', 'content_owner_lost_root'
  )),
  provider_principal_fact_id text
    REFERENCES sciforge_collaboration.provider_directory_principal_facts(provider_principal_fact_id),
  snapshotted_fact_revision bigint CHECK (snapshotted_fact_revision >= 1),
  provider_principal jsonb CHECK (
    provider_principal IS NULL OR jsonb_typeof(provider_principal) = 'object'
  ),
  binding_revision bigint CHECK (binding_revision >= 1),
  last_observation_id text
    REFERENCES sciforge_collaboration.project_provider_membership_observations(provider_observation_id),
  effective_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_content_readiness_state_reason CHECK (
    (state = 'ready') = (reason IS NULL)
  ),
  CONSTRAINT project_content_readiness_principal_shape CHECK (
    (state = 'missing_identity' AND provider_principal_fact_id IS NULL
      AND snapshotted_fact_revision IS NULL AND provider_principal IS NULL)
    OR (state <> 'missing_identity' AND provider_principal_fact_id IS NOT NULL
      AND snapshotted_fact_revision IS NOT NULL AND provider_principal IS NOT NULL)
  ),
  CONSTRAINT project_content_readiness_ready_evidence CHECK (
    state <> 'ready' OR (binding_revision IS NOT NULL AND last_observation_id IS NOT NULL)
  )
);

-- Each v12 assignment becomes one durable execution and one durable offer.
-- Legacy file declarations and completed result projections are not promoted:
-- they lack the strict v13 execution file intent / immutable submission facts.
CREATE TABLE sciforge_collaboration.task_executions (
  execution_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 101),
  offered_by_coordinator_agent_id text NOT NULL
    REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  assignee_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  assignee_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  assignee_device_id text NOT NULL REFERENCES sciforge_collaboration.devices(device_id),
  state text NOT NULL CHECK (state IN (
    'offered', 'accepted', 'rejected', 'running', 'needs_human', 'result_submitted',
    'manual_recovery_required', 'completed', 'failed', 'cancelled', 'timed_out',
    'revoked', 'superseded'
  )),
  state_revision bigint NOT NULL CHECK (state_revision >= 1),
  fence jsonb NOT NULL CHECK (jsonb_typeof(fence) = 'object'),
  file_intent jsonb CHECK (file_intent IS NULL OR jsonb_typeof(file_intent) = 'object'),
  current_result_submission_id text,
  offered_at timestamptz NOT NULL,
  accepted_at timestamptz,
  started_at timestamptz,
  terminal_at timestamptz,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT task_executions_task_attempt_unique UNIQUE (task_id, attempt),
  CONSTRAINT task_executions_state_revision_lockstep CHECK (state_revision = revision),
  CONSTRAINT task_executions_fence_identity CHECK (
    fence ->> 'executionId' = execution_id
    AND fence ->> 'assigneeUserId' = assignee_user_id
    AND fence ->> 'assigneeAgentId' = assignee_agent_id
    AND fence ->> 'assigneeDeviceId' = assignee_device_id
  ),
  CONSTRAINT task_executions_file_binding_pair CHECK (
    (file_intent IS NULL) = ((fence ->> 'bindingRevision') IS NULL)
  ),
  CONSTRAINT task_executions_acceptance_shape CHECK (
    (state IN ('accepted', 'running', 'needs_human', 'result_submitted',
      'manual_recovery_required', 'completed', 'failed') AND accepted_at IS NOT NULL)
    OR (state IN ('offered', 'rejected', 'timed_out') AND accepted_at IS NULL)
    OR state IN ('cancelled', 'revoked', 'superseded')
  ),
  CONSTRAINT task_executions_start_shape CHECK (
    (state IN ('running', 'needs_human', 'result_submitted',
      'manual_recovery_required', 'completed') AND started_at IS NOT NULL)
    OR (state IN ('offered', 'accepted', 'rejected', 'timed_out') AND started_at IS NULL)
    OR state IN ('failed', 'cancelled', 'revoked', 'superseded')
  ),
  CONSTRAINT task_executions_terminal_fence CHECK (
    (state IN ('rejected', 'result_submitted', 'manual_recovery_required', 'completed',
      'failed', 'cancelled', 'timed_out', 'revoked', 'superseded')
      AND terminal_at IS NOT NULL AND fence ->> 'status' = 'fenced')
    OR (state IN ('offered', 'accepted', 'running', 'needs_human')
      AND terminal_at IS NULL AND fence ->> 'status' = 'open')
  )
);

WITH migrated_execution AS (
  SELECT
    task.*,
    project.execution_authority_epoch,
    agent.owner_user_id AS migrated_assignee_user_id,
    agent.device_id AS assignee_device_id,
    authority.authority_epoch AS user_task_authority_epoch,
    CASE
      WHEN task.file_intent IS NOT NULL OR task.status = 'completed' THEN 'superseded'
      WHEN task.status = 'offered' THEN 'offered'
      WHEN task.status = 'accepted' THEN 'accepted'
      WHEN task.status = 'rejected' THEN 'rejected'
      WHEN task.status = 'in_progress' THEN 'running'
      WHEN task.status = 'needs_human' THEN 'needs_human'
      WHEN task.status = 'failed' THEN 'failed'
      WHEN task.status = 'cancelled' THEN 'cancelled'
    END AS migrated_state,
    CASE
      WHEN task.file_intent IS NOT NULL OR task.status = 'completed' THEN 'manual_recovery_required'
      WHEN task.status = 'rejected' THEN 'offer_rejected'
      WHEN task.status = 'failed' THEN 'execution_failed'
      WHEN task.status = 'cancelled' THEN 'execution_cancelled'
      ELSE NULL
    END AS fence_reason
  FROM sciforge_collaboration.tasks AS task
  JOIN sciforge_collaboration.projects AS project ON project.project_id = task.project_id
  JOIN sciforge_collaboration.agent_nodes AS agent
    ON agent.agent_id = task.execution_assignee_agent_id
  JOIN sciforge_collaboration.devices AS device ON device.device_id = agent.device_id
  JOIN sciforge_collaboration.task_authorities AS authority
    ON authority.project_id = task.project_id
   AND authority.user_id = agent.owner_user_id
   AND authority.scope = 'text_tasks'
)
INSERT INTO sciforge_collaboration.task_executions
  (execution_id,task_id,project_id,attempt,offered_by_coordinator_agent_id,
   assignee_user_id,assignee_agent_id,assignee_device_id,state,state_revision,fence,file_intent,
   current_result_submission_id,offered_at,accepted_at,started_at,terminal_at,
   revision,created_at,updated_at)
SELECT
  execution_id,
  task_id,
  project_id,
  retry_count + 1,
  created_by_agent_id,
  migrated_assignee_user_id,
  execution_assignee_agent_id,
  assignee_device_id,
  migrated_state,
  1,
  jsonb_build_object(
    'schemaVersion', 1,
    'executionId', execution_id,
    'assigneeUserId', migrated_assignee_user_id,
    'assigneeAgentId', execution_assignee_agent_id,
    'assigneeDeviceId', assignee_device_id,
    'assignmentTaskRevision', revision + 1,
    'projectExecutionAuthorityEpoch', execution_authority_epoch,
    'userTaskAuthorityEpoch', user_task_authority_epoch,
    'bindingRevision', NULL,
    'status', CASE WHEN fence_reason IS NULL THEN 'open' ELSE 'fenced' END,
    'reason', fence_reason,
    'fencedAt', CASE WHEN fence_reason IS NULL THEN NULL ELSE updated_at END
  ),
  NULL,
  NULL,
  created_at,
  CASE WHEN status IN ('accepted', 'in_progress', 'needs_human', 'completed', 'failed')
    THEN created_at ELSE NULL END,
  CASE WHEN status IN ('in_progress', 'needs_human', 'completed') THEN created_at ELSE NULL END,
  CASE WHEN migrated_state IN ('rejected', 'superseded', 'failed', 'cancelled')
    THEN updated_at ELSE NULL END,
  1,
  created_at,
  updated_at
FROM migrated_execution;

CREATE TABLE sciforge_collaboration.task_offers (
  task_offer_id text PRIMARY KEY,
  execution_id text NOT NULL REFERENCES sciforge_collaboration.task_executions(execution_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  assignee_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  assignee_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  assignee_device_id text NOT NULL REFERENCES sciforge_collaboration.devices(device_id),
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'withdrawn', 'timed_out')),
  offered_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  rejection_reason text CHECK (rejection_reason IN (
    'runtime_not_ready', 'provider_not_ready', 'device_inactive', 'membership_not_active',
    'content_not_ready', 'capacity_reached', 'unsupported_capability', 'human_rejected', 'other'
  )),
  safe_reason_detail text CHECK (
    safe_reason_detail IS NULL OR char_length(safe_reason_detail) BETWEEN 1 AND 500
  ),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT task_offers_execution_unique UNIQUE (execution_id),
  CONSTRAINT task_offers_expiry_check CHECK (expires_at > offered_at),
  CONSTRAINT task_offers_response_check CHECK (
    (state = 'pending') = (responded_at IS NULL)
  ),
  CONSTRAINT task_offers_rejection_check CHECK (
    (state = 'rejected') = (rejection_reason IS NOT NULL)
    AND (state = 'rejected' OR safe_reason_detail IS NULL)
    AND (rejection_reason <> 'other' OR safe_reason_detail IS NOT NULL)
  )
);

INSERT INTO sciforge_collaboration.task_offers
  (task_offer_id,execution_id,task_id,project_id,assignee_user_id,assignee_agent_id,
   assignee_device_id,state,offered_at,expires_at,responded_at,rejection_reason,
   safe_reason_detail,revision,created_at,updated_at)
SELECT
  'ofr_' || substr(md5(task.execution_id || ':schema-13'), 1, 24),
  task.execution_id,
  task.task_id,
  task.project_id,
  agent.owner_user_id,
  task.execution_assignee_agent_id,
  agent.device_id,
  CASE
    WHEN task.status = 'offered' AND task.file_intent IS NOT NULL THEN 'withdrawn'
    WHEN task.status = 'offered' THEN 'pending'
    WHEN task.status = 'rejected' THEN 'rejected'
    WHEN task.status = 'cancelled' THEN 'withdrawn'
    ELSE 'accepted'
  END,
  task.created_at,
  task.created_at + INTERVAL '24 hours',
  CASE WHEN task.status = 'offered' AND task.file_intent IS NULL THEN NULL ELSE task.updated_at END,
  CASE WHEN task.status = 'rejected' THEN 'other' ELSE NULL END,
  CASE WHEN task.status = 'rejected' THEN 'schema_13_legacy_rejection' ELSE NULL END,
  1,
  task.created_at,
  task.updated_at
FROM sciforge_collaboration.tasks AS task
JOIN sciforge_collaboration.agent_nodes AS agent
  ON agent.agent_id = task.execution_assignee_agent_id;

DROP INDEX IF EXISTS sciforge_collaboration.tasks_execution_id_unique;

ALTER TABLE sciforge_collaboration.tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check,
  DROP CONSTRAINT IF EXISTS tasks_execution_fence_shape,
  DROP CONSTRAINT IF EXISTS tasks_file_intent_shape,
  DROP CONSTRAINT IF EXISTS tasks_resource_ref_ids_shape,
  ADD COLUMN created_by_coordinator_agent_id text,
  ADD COLUMN current_execution_id text,
  ADD COLUMN current_execution_state text,
  ADD COLUMN execution_count integer;

UPDATE sciforge_collaboration.tasks
SET created_by_coordinator_agent_id = created_by_agent_id,
    current_execution_id = execution_id,
    current_execution_state = CASE
      WHEN file_intent IS NOT NULL OR status = 'completed' THEN 'superseded'
      WHEN status = 'offered' THEN 'offered'
      WHEN status = 'accepted' THEN 'accepted'
      WHEN status = 'rejected' THEN 'rejected'
      WHEN status = 'in_progress' THEN 'running'
      WHEN status = 'needs_human' THEN 'needs_human'
      WHEN status = 'failed' THEN 'failed'
      WHEN status = 'cancelled' THEN 'cancelled'
    END,
    status = CASE
      WHEN file_intent IS NOT NULL OR status = 'completed' THEN 'manual_recovery_required'
      WHEN status = 'offered' THEN 'offered'
      WHEN status IN ('accepted', 'in_progress') THEN 'in_progress'
      WHEN status IN ('rejected', 'failed') THEN 'failed'
      WHEN status = 'needs_human' THEN 'needs_human'
      WHEN status = 'cancelled' THEN 'cancelled'
    END,
    execution_count = retry_count + 1,
    file_intent = NULL,
    completed_at = CASE
      WHEN status IN ('rejected', 'failed', 'cancelled') THEN COALESCE(completed_at, updated_at)
      ELSE NULL
    END,
    revision = revision + 1;

ALTER TABLE sciforge_collaboration.tasks
  ALTER COLUMN created_by_coordinator_agent_id SET NOT NULL,
  ALTER COLUMN execution_count SET NOT NULL,
  DROP COLUMN assignee_agent_id,
  DROP COLUMN created_by_agent_id,
  DROP COLUMN retry_count,
  DROP COLUMN active_turn_id,
  DROP COLUMN result_summary,
  DROP COLUMN failure_summary,
  DROP COLUMN resource_ref_ids,
  DROP COLUMN execution_id,
  DROP COLUMN execution_assignee_agent_id,
  DROP COLUMN execution_task_revision,
  DROP COLUMN execution_binding_revision,
  DROP COLUMN intent_digest,
  DROP COLUMN IF EXISTS assignee_user_id,
  DROP COLUMN IF EXISTS result_record_id,
  DROP COLUMN IF EXISTS safe_failure_code,
  DROP COLUMN IF EXISTS required_capabilities,
  DROP COLUMN IF EXISTS authorization_requirements,
  DROP COLUMN IF EXISTS progress_percent,
  DROP COLUMN IF EXISTS progress_summary,
  DROP COLUMN IF EXISTS progress_reported_at,
  DROP COLUMN IF EXISTS safe_failure_summary,
  ADD CONSTRAINT tasks_created_by_coordinator_fk FOREIGN KEY (created_by_coordinator_agent_id)
    REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  ADD CONSTRAINT tasks_current_execution_fk FOREIGN KEY (current_execution_id)
    REFERENCES sciforge_collaboration.task_executions(execution_id),
  ADD CONSTRAINT tasks_status_check CHECK (status IN (
    'planned', 'offered', 'in_progress', 'needs_human', 'awaiting_review',
    'revision_requested', 'manual_recovery_required', 'completed', 'failed', 'cancelled'
  )),
  ADD CONSTRAINT tasks_current_execution_state_check CHECK (current_execution_state IN (
    'offered', 'accepted', 'rejected', 'running', 'needs_human', 'result_submitted',
    'manual_recovery_required', 'completed', 'failed', 'cancelled', 'timed_out',
    'revoked', 'superseded'
  )),
  ADD CONSTRAINT tasks_execution_count_check CHECK (
    execution_count BETWEEN 0 AND 101 AND execution_count <= max_retries + 1
  ),
  ADD CONSTRAINT tasks_execution_projection_check CHECK (
    (current_execution_id IS NULL) = (current_execution_state IS NULL)
    AND ((status = 'planned') = (current_execution_id IS NULL AND execution_count = 0))
  ),
  ADD CONSTRAINT tasks_terminal_time_check CHECK (
    (status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT tasks_file_intent_shape CHECK (
    file_intent IS NULL OR jsonb_typeof(file_intent) = 'object'
  );

-- Old ResourceRefs remain immutable audit facts but cannot stay available
-- after their authorization-style binding has been retired.
UPDATE sciforge_collaboration.task_resource_refs
SET status = 'invalidated',
    invalidated_at = CURRENT_TIMESTAMP,
    revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'available';

ALTER TABLE sciforge_collaboration.task_resource_refs
  RENAME COLUMN task_revision TO assignment_task_revision;

ALTER TABLE sciforge_collaboration.task_resource_refs
  DROP CONSTRAINT IF EXISTS task_resource_refs_role_check,
  ADD CONSTRAINT task_resource_refs_role_check CHECK (
    role IN ('input-file', 'output-container', 'output-file')
  ),
  ADD CONSTRAINT task_resource_refs_execution_fk FOREIGN KEY (execution_id)
    REFERENCES sciforge_collaboration.task_executions(execution_id);

-- HumanNeeded is one contract with two exact scopes. Existing v12 requests are
-- all execution-bound; Coordinator-Project requests are introduced only after
-- this migration and deliberately carry no synthetic Task/execution identity.
ALTER TABLE sciforge_collaboration.human_requests
  ADD COLUMN request_scope text,
  ADD COLUMN coordinator_authority_epoch bigint,
  ALTER COLUMN task_id DROP NOT NULL,
  ALTER COLUMN execution_id DROP NOT NULL;

UPDATE sciforge_collaboration.human_requests
SET request_scope = 'worker_execution';

ALTER TABLE sciforge_collaboration.human_requests
  ALTER COLUMN request_scope SET NOT NULL,
  ADD CONSTRAINT human_requests_scope_check CHECK (
    (request_scope = 'worker_execution' AND task_id IS NOT NULL
      AND execution_id IS NOT NULL AND coordinator_authority_epoch IS NULL)
    OR
    (request_scope = 'coordinator_project' AND task_id IS NULL
      AND execution_id IS NULL AND coordinator_authority_epoch >= 1)
  );

ALTER TABLE sciforge_collaboration.human_answers
  ADD COLUMN request_scope text,
  ADD COLUMN coordinator_authority_epoch bigint,
  ALTER COLUMN task_id DROP NOT NULL,
  ALTER COLUMN execution_id DROP NOT NULL;

UPDATE sciforge_collaboration.human_answers
SET request_scope = 'worker_execution';

ALTER TABLE sciforge_collaboration.human_answers
  ALTER COLUMN request_scope SET NOT NULL,
  ADD CONSTRAINT human_answers_scope_check CHECK (
    (request_scope = 'worker_execution' AND task_id IS NOT NULL
      AND execution_id IS NOT NULL AND coordinator_authority_epoch IS NULL)
    OR
    (request_scope = 'coordinator_project' AND task_id IS NULL
      AND execution_id IS NULL AND coordinator_authority_epoch >= 1)
  );

ALTER TABLE sciforge_collaboration.human_requests
  ADD CONSTRAINT human_requests_execution_fk FOREIGN KEY (execution_id)
    REFERENCES sciforge_collaboration.task_executions(execution_id);

ALTER TABLE sciforge_collaboration.human_answers
  ADD CONSTRAINT human_answers_execution_fk FOREIGN KEY (execution_id)
    REFERENCES sciforge_collaboration.task_executions(execution_id);

CREATE TABLE sciforge_collaboration.external_operation_journal (
  content_recovery_journal_entry_id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN (
    'project_provisioning', 'project_membership', 'task_content_transfer'
  )),
  logical_invocation_id text NOT NULL UNIQUE,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  prepared_task_revision bigint CHECK (prepared_task_revision >= 1),
  provisioning_intent_id text
    REFERENCES sciforge_collaboration.project_content_provisioning_intents(provisioning_intent_id),
  provisioning_revision bigint CHECK (provisioning_revision >= 1),
  execution_id text REFERENCES sciforge_collaboration.task_executions(execution_id),
  prepared_execution_revision bigint CHECK (prepared_execution_revision >= 1),
  operation text NOT NULL CHECK (operation IN (
    'create_shared_container', 'list_members', 'add_member', 'remove_member',
    'observe_root', 'download', 'upload_new', 'observe_output'
  )),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN (
    'prepared', 'dispatched', 'observed_success', 'observed_failure', 'outcome_unknown', 'abandoned'
  )),
  observation_digest text CHECK (observation_digest ~ '^[a-f0-9]{64}$'),
  receipt_digest text CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
  safe_failure_code text,
  prepared_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  resolved_at timestamptz,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT external_operation_scope_shape CHECK (
    (scope = 'task_content_transfer' AND task_id IS NOT NULL AND prepared_task_revision IS NOT NULL
      AND execution_id IS NOT NULL AND prepared_execution_revision IS NOT NULL
      AND provisioning_intent_id IS NULL AND provisioning_revision IS NULL)
    OR (scope <> 'task_content_transfer' AND task_id IS NULL AND prepared_task_revision IS NULL
      AND execution_id IS NULL AND prepared_execution_revision IS NULL
      AND provisioning_intent_id IS NOT NULL AND provisioning_revision IS NOT NULL)
  ),
  CONSTRAINT external_operation_dispatch_shape CHECK (
    (state <> 'prepared') = (dispatched_at IS NOT NULL)
  ),
  CONSTRAINT external_operation_resolution_shape CHECK (
    (state IN ('observed_success', 'observed_failure', 'abandoned')) = (resolved_at IS NOT NULL)
  ),
  CONSTRAINT external_operation_failure_shape CHECK (
    (state IN ('observed_failure', 'outcome_unknown')) = (safe_failure_code IS NOT NULL)
  ),
  CONSTRAINT external_operation_success_evidence CHECK (
    state <> 'observed_success' OR (receipt_digest IS NOT NULL AND observation_digest IS NOT NULL)
  )
);

CREATE INDEX external_operation_journal_recovery
  ON sciforge_collaboration.external_operation_journal(project_id, state, updated_at)
  WHERE state IN ('outcome_unknown', 'observed_failure');

CREATE TABLE sciforge_collaboration.visible_recovery_actions (
  recovery_action_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text REFERENCES sciforge_collaboration.tasks(task_id),
  execution_id text REFERENCES sciforge_collaboration.task_executions(execution_id),
  journal_entry_id text NOT NULL
    REFERENCES sciforge_collaboration.external_operation_journal(content_recovery_journal_entry_id),
  audience text NOT NULL CHECK (audience IN ('owner', 'coordinator')),
  action text NOT NULL CHECK (action IN (
    'resume_provisioning', 'reconcile_provider_membership', 'reconcile_exact_output',
    'link_observed_output', 'abandon_execution', 'rebind_content_root',
    'reprovision_content_root', 'change_content_owner'
  )),
  status text NOT NULL CHECK (status IN ('available', 'completed', 'withdrawn')),
  requires_fresh_observation boolean NOT NULL,
  safe_summary text NOT NULL CHECK (
    char_length(safe_summary) BETWEEN 1 AND 500 AND safe_summary = btrim(safe_summary)
  ),
  available_at timestamptz NOT NULL,
  completed_at timestamptz,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT visible_recovery_actions_task_execution_pair CHECK (
    (task_id IS NULL) = (execution_id IS NULL)
  ),
  CONSTRAINT visible_recovery_actions_completion_shape CHECK (
    (status = 'completed') = (completed_at IS NOT NULL)
  )
);

CREATE INDEX visible_recovery_actions_available
  ON sciforge_collaboration.visible_recovery_actions(
    project_id, audience, available_at, recovery_action_id
  )
  WHERE status = 'available';

CREATE INDEX visible_recovery_actions_project
  ON sciforge_collaboration.visible_recovery_actions(project_id, available_at, recovery_action_id);

CREATE INDEX visible_recovery_actions_journal
  ON sciforge_collaboration.visible_recovery_actions(journal_entry_id, status);

CREATE TABLE sciforge_collaboration.project_plans (
  project_plan_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  coordinator_authority_epoch bigint NOT NULL CHECK (coordinator_authority_epoch >= 1),
  state text NOT NULL CHECK (state IN ('draft', 'awaiting_confirmation', 'confirmed', 'superseded')),
  plan_revision bigint NOT NULL CHECK (plan_revision >= 1),
  source_input_locators jsonb NOT NULL CHECK (jsonb_typeof(source_input_locators) = 'array'),
  tasks jsonb NOT NULL CHECK (jsonb_typeof(tasks) = 'array' AND jsonb_array_length(tasks) >= 1),
  rationale text NOT NULL CHECK (char_length(rationale) >= 1),
  runtime_provenance jsonb NOT NULL CHECK (jsonb_typeof(runtime_provenance) = 'object'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  submitted_at timestamptz,
  confirmed_by_user_id text REFERENCES sciforge_collaboration.user_principals(user_id),
  confirmed_at timestamptz,
  superseded_at timestamptz,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_plans_revision_unique UNIQUE (project_id, plan_revision),
  CONSTRAINT project_plans_submission_shape CHECK (
    (state = 'draft' AND submitted_at IS NULL)
    OR (state IN ('awaiting_confirmation', 'confirmed') AND submitted_at IS NOT NULL)
    OR state = 'superseded'
  ),
  CONSTRAINT project_plans_confirmation_pair CHECK (
    (confirmed_by_user_id IS NULL) = (confirmed_at IS NULL)
  ),
  CONSTRAINT project_plans_confirmation_state CHECK (
    (state = 'confirmed' AND confirmed_by_user_id IS NOT NULL)
    OR (state IN ('draft', 'awaiting_confirmation') AND confirmed_by_user_id IS NULL)
    OR state = 'superseded'
  ),
  CONSTRAINT project_plans_supersession_shape CHECK (
    (state = 'superseded') = (superseded_at IS NOT NULL)
  )
);

CREATE INDEX project_plans_project_state
  ON sciforge_collaboration.project_plans(project_id, state, plan_revision DESC);

CREATE TABLE sciforge_collaboration.task_result_submissions (
  result_submission_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  execution_id text NOT NULL REFERENCES sciforge_collaboration.task_executions(execution_id),
  submitted_task_revision bigint NOT NULL CHECK (submitted_task_revision >= 1),
  submitted_execution_revision bigint NOT NULL CHECK (submitted_execution_revision >= 1),
  submitted_by_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  submitted_by_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 50000),
  runtime_provenance jsonb NOT NULL CHECK (jsonb_typeof(runtime_provenance) = 'object'),
  outputs jsonb NOT NULL CHECK (jsonb_typeof(outputs) = 'array'),
  recovery_journal_entry_ids jsonb NOT NULL CHECK (jsonb_typeof(recovery_journal_entry_ids) = 'array'),
  submission_digest text NOT NULL CHECK (submission_digest ~ '^[a-f0-9]{64}$'),
  submitted_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE sciforge_collaboration.project_records
  ADD CONSTRAINT project_records_source_result_submission_fk
    FOREIGN KEY (source_result_submission_id)
    REFERENCES sciforge_collaboration.task_result_submissions(result_submission_id),
  ADD CONSTRAINT project_records_canonical_source_check
    CHECK (
      (kind = 'observation' AND source_task_id IS NOT NULL
        AND source_result_submission_id IS NOT NULL AND source_human_answer_id IS NULL)
      OR
      (kind = 'decision' AND source_result_submission_id IS NULL
        AND source_human_answer_id IS NOT NULL)
      OR
      (kind = 'summary' AND source_task_id IS NULL
        AND source_result_submission_id IS NULL AND source_human_answer_id IS NULL)
    ) NOT VALID;

CREATE UNIQUE INDEX project_records_source_result_unique
  ON sciforge_collaboration.project_records(source_result_submission_id)
  WHERE source_result_submission_id IS NOT NULL;

CREATE UNIQUE INDEX project_records_source_human_answer_unique
  ON sciforge_collaboration.project_records(source_human_answer_id)
  WHERE source_human_answer_id IS NOT NULL;

ALTER TABLE sciforge_collaboration.task_executions
  ADD CONSTRAINT task_executions_current_result_fk FOREIGN KEY (current_result_submission_id)
    REFERENCES sciforge_collaboration.task_result_submissions(result_submission_id),
  ADD CONSTRAINT task_executions_result_state_check CHECK (
    (state IN ('result_submitted', 'completed')) = (current_result_submission_id IS NOT NULL)
    OR (state = 'superseded' AND current_result_submission_id IS NOT NULL)
  );

CREATE TABLE sciforge_collaboration.task_result_reviews (
  review_decision_id text PRIMARY KEY,
  result_submission_id text NOT NULL
    REFERENCES sciforge_collaboration.task_result_submissions(result_submission_id),
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  execution_id text NOT NULL REFERENCES sciforge_collaboration.task_executions(execution_id),
  reviewed_result_revision bigint NOT NULL CHECK (reviewed_result_revision >= 1),
  decided_by_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  decided_by_coordinator_agent_id text NOT NULL
    REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  coordinator_authority_epoch bigint NOT NULL CHECK (coordinator_authority_epoch >= 1),
  decision text NOT NULL CHECK (decision IN ('accept', 'request_revision')),
  instruction text,
  accepted_project_record_id text REFERENCES sciforge_collaboration.project_records(project_record_id),
  next_execution_id text REFERENCES sciforge_collaboration.task_executions(execution_id),
  decided_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT task_result_reviews_decision_shape CHECK (
    (decision = 'accept' AND instruction IS NULL
      AND accepted_project_record_id IS NOT NULL AND next_execution_id IS NULL)
    OR (decision = 'request_revision' AND instruction IS NOT NULL
      AND accepted_project_record_id IS NULL AND next_execution_id IS NOT NULL)
  )
);

CREATE TABLE sciforge_collaboration.project_final_summaries (
  project_id text PRIMARY KEY REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  project_record_id text NOT NULL UNIQUE
    REFERENCES sciforge_collaboration.project_records(project_record_id),
  project_plan_id text NOT NULL REFERENCES sciforge_collaboration.project_plans(project_plan_id),
  confirmed_plan_revision bigint NOT NULL CHECK (confirmed_plan_revision >= 1),
  accepted_result_submission_ids jsonb NOT NULL CHECK (
    jsonb_typeof(accepted_result_submission_ids) = 'array'
    AND jsonb_array_length(accepted_result_submission_ids) >= 1
  ),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 50000),
  created_by_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  created_by_coordinator_agent_id text NOT NULL
    REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  coordinator_authority_epoch bigint NOT NULL CHECK (coordinator_authority_epoch >= 1),
  completed_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Every Project coordination collection owns an independent stable-ID cursor.
-- These indexes keep limit+1 reads bounded without deriving one page from
-- another collection or scanning terminal history in application memory.
CREATE INDEX projects_owner_project_id
  ON sciforge_collaboration.projects(owner_user_id, project_id);

CREATE INDEX project_members_user_visibility_project_id
  ON sciforge_collaboration.project_members(user_id, state, project_id);

CREATE INDEX tasks_project_task_id
  ON sciforge_collaboration.tasks(project_id, task_id);

CREATE INDEX human_requests_project_request_id
  ON sciforge_collaboration.human_requests(project_id, human_request_id);

CREATE INDEX human_requests_project_status_request_id
  ON sciforge_collaboration.human_requests(project_id, status, human_request_id);

CREATE INDEX task_executions_project_execution_id
  ON sciforge_collaboration.task_executions(project_id, execution_id);

CREATE INDEX task_offers_project_offer_id
  ON sciforge_collaboration.task_offers(project_id, task_offer_id);

CREATE INDEX task_result_submissions_project_result_id
  ON sciforge_collaboration.task_result_submissions(project_id, result_submission_id);

CREATE INDEX task_result_reviews_project_review_id
  ON sciforge_collaboration.task_result_reviews(project_id, review_decision_id);

CREATE TABLE sciforge_collaboration.endpoint_challenge_rate_windows (
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id) ON DELETE CASCADE,
  provider text NOT NULL,
  realm_id text NOT NULL,
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  revision bigint NOT NULL CHECK (revision >= 1),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, provider, realm_id, window_started_at),
  CONSTRAINT endpoint_challenge_rate_window_time CHECK (expires_at > window_started_at)
);

ALTER TABLE sciforge_collaboration.human_answers
  DROP CONSTRAINT IF EXISTS human_answers_source_xor,
  ALTER COLUMN answered_from_oidc_identity_id DROP NOT NULL,
  ALTER COLUMN answered_from_human_endpoint_id DROP NOT NULL,
  ADD CONSTRAINT human_answers_source_xor CHECK (
    (answered_from_human_endpoint_id IS NULL) <> (answered_from_oidc_identity_id IS NULL)
  );

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (13);

COMMIT;
