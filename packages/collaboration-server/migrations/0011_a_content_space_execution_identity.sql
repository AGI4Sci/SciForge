BEGIN;

-- This is the only forward migration after the common schema-v4 baseline.
-- Versions 5 and 9 are recognized historical A deployments with divergent
-- numbering. Their ledgers are inputs, never migration files to replay.
DO $$
DECLARE
  current_version integer;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version NOT IN (4, 5, 9, 11) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0011_unsupported_source_lineage';
  END IF;
END
$$;

LOCK TABLE
  sciforge_collaboration.user_principals,
  sciforge_collaboration.agent_nodes,
  sciforge_collaboration.credentials,
  sciforge_collaboration.projects,
  sciforge_collaboration.tasks,
  sciforge_collaboration.human_requests,
  sciforge_collaboration.human_answers
IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.oidc_identities (
  identity_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  issuer text NOT NULL,
  subject text NOT NULL,
  email_at_link_time text,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT oidc_identities_issuer_subject_unique UNIQUE (issuer, subject),
  CONSTRAINT oidc_identities_state_valid CHECK (
    char_length(issuer) BETWEEN 1 AND 2048
    AND char_length(subject) BETWEEN 1 AND 512
    AND ((status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL))
  )
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.device_enrollments (
  enrollment_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  installation_id text NOT NULL,
  nonce_digest bytea NOT NULL UNIQUE CHECK (octet_length(nonce_digest) = 32),
  status text NOT NULL CHECK (status IN ('pending', 'consumed', 'expired')),
  revision bigint NOT NULL CHECK (revision >= 1),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT device_enrollments_state_valid CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status IN ('pending', 'expired') AND consumed_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.devices (
  device_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  installation_id text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  platform jsonb NOT NULL CHECK (jsonb_typeof(platform) = 'object'),
  public_key_jwk jsonb NOT NULL CHECK (jsonb_typeof(public_key_jwk) = 'object'),
  capability_summary jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capability_summary) = 'array'),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT devices_state_valid CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

ALTER TABLE sciforge_collaboration.agent_nodes
  ADD COLUMN IF NOT EXISTS device_id text,
  ALTER COLUMN installation_id DROP NOT NULL;

-- A legacy installation string is not an E/Host Device authorization. Keep
-- history, but revoke authority that cannot be bound to a verified Device.
UPDATE sciforge_collaboration.credentials AS credential
SET revoked_at = CURRENT_TIMESTAMP
FROM sciforge_collaboration.agent_nodes AS agent
WHERE credential.kind = 'agent_device'
  AND credential.subject_agent_id = agent.agent_id
  AND credential.revoked_at IS NULL
  AND agent.device_id IS NULL;

UPDATE sciforge_collaboration.agent_nodes
SET status = 'revoked', connection_status = 'offline',
    revision = revision + 1, updated_at = CURRENT_TIMESTAMP,
    revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE status = 'active' AND device_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_nodes_device_fk'
      AND conrelid = 'sciforge_collaboration.agent_nodes'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.agent_nodes
      ADD CONSTRAINT agent_nodes_device_fk FOREIGN KEY (device_id)
      REFERENCES sciforge_collaboration.devices(device_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_nodes_active_device_required'
      AND conrelid = 'sciforge_collaboration.agent_nodes'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.agent_nodes
      ADD CONSTRAINT agent_nodes_active_device_required
      CHECK (status <> 'active' OR device_id IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS agent_nodes_device_id
  ON sciforge_collaboration.agent_nodes(device_id, agent_id);

-- execution_id is the only Task assignment epoch. The remaining columns are
-- immutable facts fenced by that ID; no assignmentEpoch synonym is created.
ALTER TABLE sciforge_collaboration.tasks
  ADD COLUMN IF NOT EXISTS file_intent jsonb,
  ADD COLUMN IF NOT EXISTS resource_ref_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_id text,
  ADD COLUMN IF NOT EXISTS execution_assignee_agent_id text,
  ADD COLUMN IF NOT EXISTS execution_task_revision bigint,
  ADD COLUMN IF NOT EXISTS execution_binding_revision bigint,
  ADD COLUMN IF NOT EXISTS intent_digest text;

-- Public schema-v5/staging-v9 carried assignment/result projections that are
-- not authoritative in the common schema-v4 contract. Preserve their values
-- for audit compatibility, but do not let the redundant assignee User or a
-- legacy result-record workflow veto the canonical Agent + execution_id
-- fence. New writes never derive authority from these columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sciforge_collaboration'
      AND table_name = 'tasks'
      AND column_name = 'assignee_user_id'
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ALTER COLUMN assignee_user_id DROP NOT NULL;
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.tasks
  DROP CONSTRAINT IF EXISTS tasks_result_record_state,
  DROP CONSTRAINT IF EXISTS tasks_safe_failure_code_state;

UPDATE sciforge_collaboration.tasks
SET execution_id = 'exe_' || substr(md5(task_id || ':a-schema-11'), 1, 24)
WHERE execution_id IS NULL;

UPDATE sciforge_collaboration.tasks
SET execution_assignee_agent_id = assignee_agent_id,
    execution_task_revision = revision,
    execution_binding_revision = NULL,
    intent_digest = '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
    file_intent = NULL,
    resource_ref_ids = COALESCE(resource_ref_ids, '[]'::jsonb)
WHERE execution_assignee_agent_id IS NULL
   OR execution_task_revision IS NULL
   OR intent_digest IS NULL;

ALTER TABLE sciforge_collaboration.tasks
  ALTER COLUMN execution_id SET NOT NULL,
  ALTER COLUMN execution_assignee_agent_id SET NOT NULL,
  ALTER COLUMN execution_task_revision SET NOT NULL,
  ALTER COLUMN intent_digest SET NOT NULL,
  DROP CONSTRAINT IF EXISTS tasks_execution_fence_shape,
  DROP CONSTRAINT IF EXISTS tasks_file_intent_shape,
  DROP CONSTRAINT IF EXISTS tasks_resource_ref_ids_shape;

ALTER TABLE sciforge_collaboration.tasks
  ADD CONSTRAINT tasks_execution_fence_shape CHECK (
    execution_id ~ '^exe_[A-Za-z0-9][A-Za-z0-9_]{10,62}[A-Za-z0-9]$'
    AND execution_assignee_agent_id = assignee_agent_id
    AND execution_task_revision >= 1
    AND execution_task_revision <= revision
    AND (execution_binding_revision IS NULL OR execution_binding_revision >= 1)
    AND intent_digest ~ '^[a-f0-9]{64}$'
    AND ((file_intent IS NULL AND execution_binding_revision IS NULL)
      OR (file_intent IS NOT NULL AND execution_binding_revision IS NOT NULL))
  ),
  ADD CONSTRAINT tasks_file_intent_shape CHECK (
    file_intent IS NULL OR (
      jsonb_typeof(file_intent) = 'object'
      AND file_intent ?& ARRAY['schemaVersion', 'bindingRevision', 'inputs', 'output']
      AND file_intent - ARRAY['schemaVersion', 'bindingRevision', 'inputs', 'output'] = '{}'::jsonb
      AND file_intent ->> 'schemaVersion' = '1'
      AND jsonb_typeof(file_intent -> 'inputs') = 'array'
      AND jsonb_array_length(file_intent -> 'inputs') BETWEEN 1 AND 100
      AND jsonb_typeof(file_intent -> 'output') = 'object'
      AND file_intent -> 'output' = '{"kind":"content-space.output-new","mode":"upload-new","target":"project-binding-root"}'::jsonb
    )
  ),
  ADD CONSTRAINT tasks_resource_ref_ids_shape CHECK (jsonb_typeof(resource_ref_ids) = 'array');

CREATE UNIQUE INDEX IF NOT EXISTS tasks_execution_id_unique
  ON sciforge_collaboration.tasks(execution_id);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.project_content_space_bindings (
  project_id text PRIMARY KEY REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  root_locator jsonb NOT NULL CHECK (jsonb_typeof(root_locator) = 'object'),
  root_locator_digest text NOT NULL CHECK (root_locator_digest ~ '^[a-f0-9]{64}$'),
  authorization_proof_id text NOT NULL,
  authorization_issuer text NOT NULL,
  authorization_proof_digest text NOT NULL CHECK (authorization_proof_digest ~ '^[a-f0-9]{64}$'),
  authorization_actor_principal_digest text NOT NULL CHECK (authorization_actor_principal_digest ~ '^[a-f0-9]{64}$'),
  principal_authority text NOT NULL,
  principal_subject text NOT NULL,
  principal_device_id text NOT NULL,
  principal_identity_version bigint NOT NULL CHECK (principal_identity_version >= 1),
  authorization_scopes jsonb NOT NULL CHECK (
    authorization_scopes = '["content-space.read","content-space.upload-new"]'::jsonb
  ),
  authorization_issued_at timestamptz NOT NULL,
  authorization_expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'closed')),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_content_space_authorization_time CHECK (
    authorization_expires_at > authorization_issued_at
  )
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.task_resource_refs (
  resource_ref_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  execution_id text NOT NULL,
  task_revision bigint NOT NULL CHECK (task_revision >= 1),
  binding_revision bigint NOT NULL CHECK (binding_revision >= 1),
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  role text NOT NULL CHECK (role IN ('input-file', 'output-container')),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 100),
  locator jsonb NOT NULL CHECK (jsonb_typeof(locator) = 'object'),
  locator_digest text NOT NULL CHECK (locator_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('available', 'invalidated', 'revoked')),
  invalidated_at timestamptz,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT task_resource_refs_status_time CHECK (
    (status = 'available' AND invalidated_at IS NULL)
    OR (status <> 'available' AND invalidated_at IS NOT NULL)
  ),
  CONSTRAINT task_resource_refs_epoch_slot_unique UNIQUE (task_id, execution_id, role, ordinal)
);

CREATE INDEX IF NOT EXISTS task_resource_refs_execution_idx
  ON sciforge_collaboration.task_resource_refs(task_id, execution_id, status);

ALTER TABLE sciforge_collaboration.human_requests
  ADD COLUMN IF NOT EXISTS execution_id text,
  ADD COLUMN IF NOT EXISTS confirmable_action jsonb;

UPDATE sciforge_collaboration.human_requests AS request
SET execution_id = task.execution_id
FROM sciforge_collaboration.tasks AS task
WHERE request.task_id = task.task_id AND request.execution_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sciforge_collaboration.human_requests
    WHERE task_id IS NULL OR execution_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0011_unfenced_human_request';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.human_requests
  ALTER COLUMN task_id SET NOT NULL,
  ALTER COLUMN execution_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS human_requests_confirmable_action_shape;

ALTER TABLE sciforge_collaboration.human_requests
  ADD CONSTRAINT human_requests_confirmable_action_shape CHECK (
    confirmable_action IS NULL OR (
      jsonb_typeof(confirmable_action) = 'object'
      AND confirmable_action ?& ARRAY['actionType', 'safeSummary', 'effect', 'actionDigest']
      AND confirmable_action - ARRAY['actionType', 'safeSummary', 'effect', 'actionDigest'] = '{}'::jsonb
      AND confirmable_action ->> 'effect' IN ('workspace-write', 'external-write', 'destructive')
      AND confirmable_action ->> 'actionDigest' ~ '^[a-f0-9]{64}$'
    )
  );

ALTER TABLE sciforge_collaboration.human_answers
  ADD COLUMN IF NOT EXISTS execution_id text,
  ADD COLUMN IF NOT EXISTS answered_from_oidc_identity_id text,
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS confirmation_id text;

ALTER TABLE sciforge_collaboration.human_answers
  DROP CONSTRAINT IF EXISTS human_answers_confirmation_fk;

UPDATE sciforge_collaboration.human_answers AS answer
SET execution_id = request.execution_id
FROM sciforge_collaboration.human_requests AS request
WHERE answer.human_request_id = request.human_request_id
  AND answer.execution_id IS NULL;

UPDATE sciforge_collaboration.human_answers
SET confirmation_id = 'cfm_' || substr(md5(human_answer_id || ':a-schema-11'), 1, 24)
WHERE decision IS NOT NULL AND confirmation_id IS NULL;

ALTER TABLE sciforge_collaboration.human_answers
  ALTER COLUMN task_id SET NOT NULL,
  ALTER COLUMN execution_id SET NOT NULL,
  ALTER COLUMN answered_from_human_endpoint_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS human_answers_source_xor,
  DROP CONSTRAINT IF EXISTS human_answers_decision_confirmation_consistent;

ALTER TABLE sciforge_collaboration.human_answers
  ADD CONSTRAINT human_answers_source_xor CHECK (
    (answered_from_human_endpoint_id IS NULL) <> (answered_from_oidc_identity_id IS NULL)
  ),
  ADD CONSTRAINT human_answers_decision_confirmation_consistent CHECK (
    (decision IS NULL AND confirmation_id IS NULL)
    OR (decision IN ('approve', 'reject') AND confirmation_id IS NOT NULL)
  ),
  ADD CONSTRAINT human_answers_oidc_identity_fk FOREIGN KEY (answered_from_oidc_identity_id)
    REFERENCES sciforge_collaboration.oidc_identities(identity_id);

CREATE UNIQUE INDEX IF NOT EXISTS human_answers_confirmation_id_unique
  ON sciforge_collaboration.human_answers(confirmation_id)
  WHERE confirmation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.managed_provider_containers (
  managed_container_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  human_endpoint_id text NOT NULL REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  provider text NOT NULL,
  realm_id text NOT NULL,
  owner_provider_user_id text NOT NULL,
  stable_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  external_container_id text,
  policy jsonb NOT NULL,
  observed_checks jsonb,
  status text NOT NULL CHECK (status IN ('requested', 'provisioning', 'active', 'drifted', 'suspended', 'archived', 'failed')),
  last_verified_at timestamptz,
  safe_error_code text,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_user_id, provider, realm_id),
  UNIQUE (provider, realm_id, external_container_id)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.managed_provider_container_jobs (
  job_id text PRIMARY KEY,
  managed_container_id text NOT NULL REFERENCES sciforge_collaboration.managed_provider_containers(managed_container_id),
  operation text NOT NULL CHECK (operation IN ('ensure', 'inspect', 'reconcile', 'archive')),
  desired_revision bigint NOT NULL CHECK (desired_revision >= 1),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  safe_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (managed_container_id, operation, desired_revision)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.remote_capability_approvals (
  remote_approval_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  projection_id text NOT NULL REFERENCES sciforge_collaboration.remote_session_projections(projection_id),
  locator jsonb NOT NULL,
  locator_revision bigint NOT NULL CHECK (locator_revision > 0),
  runtime_id text NOT NULL,
  thread_id text NOT NULL,
  turn_id text NOT NULL,
  capability_request_id text NOT NULL,
  desktop_approval_id text NOT NULL,
  reference_digest text NOT NULL UNIQUE CHECK (reference_digest ~ '^[a-f0-9]{64}$'),
  safe_summary text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('workspace-write', 'external-write', 'destructive')),
  remote_eligible boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'superseded', 'desktop_only', 'delivery_pending', 'completed')),
  provider_card_message_id text,
  decision_event_id text UNIQUE,
  decision_id text UNIQUE,
  revision bigint NOT NULL CHECK (revision > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (agent_id, desktop_approval_id),
  UNIQUE (projection_id, runtime_id, thread_id, turn_id, capability_request_id)
);

ALTER TABLE sciforge_collaboration.inbox_cursors
  DROP CONSTRAINT IF EXISTS inbox_cursors_recipient_kind_check;
ALTER TABLE sciforge_collaboration.inbox_cursors
  ADD CONSTRAINT inbox_cursors_recipient_kind_check
  CHECK (recipient_kind IN ('user', 'human_endpoint', 'agent', 'provider_identity'));
ALTER TABLE sciforge_collaboration.inbox_messages
  DROP CONSTRAINT IF EXISTS inbox_messages_recipient_kind_check;
ALTER TABLE sciforge_collaboration.inbox_messages
  ADD CONSTRAINT inbox_messages_recipient_kind_check
  CHECK (recipient_kind IN ('user', 'human_endpoint', 'agent', 'provider_identity'));

CREATE INDEX IF NOT EXISTS human_requests_project_target_request_id_idx
  ON sciforge_collaboration.human_requests(project_id, target_user_id, human_request_id);
CREATE INDEX IF NOT EXISTS oidc_identities_active_user_issuer_idx
  ON sciforge_collaboration.oidc_identities(user_id, issuer) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS managed_provider_container_jobs_claim_idx
  ON sciforge_collaboration.managed_provider_container_jobs(state, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS remote_capability_approvals_pending_idx
  ON sciforge_collaboration.remote_capability_approvals(status, expires_at)
  WHERE status IN ('pending', 'delivery_pending');

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (11)
ON CONFLICT (version) DO NOTHING;

COMMIT;
