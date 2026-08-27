BEGIN;

-- Every Task attempt has a stable execution identity. Existing rows predate
-- executionId, so give them a deterministic, contract-valid legacy identity.
ALTER TABLE sciforge_collaboration.tasks
  ADD COLUMN IF NOT EXISTS execution_id text,
  ADD COLUMN IF NOT EXISTS result_record_id text,
  ADD COLUMN IF NOT EXISTS safe_failure_summary text,
  ADD COLUMN IF NOT EXISTS assignee_user_id text,
  ADD COLUMN IF NOT EXISTS required_capabilities jsonb NOT NULL DEFAULT '{
    "capabilityIds": [],
    "vpnAccessIds": [],
    "slurmClusterIds": [],
    "requiredResourceRefIds": []
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS resource_ref_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS authorization_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE sciforge_collaboration.tasks
SET execution_id = 'exe_' || substr(md5(task_id || ':schema-v4'), 1, 24)
WHERE execution_id IS NULL;

UPDATE sciforge_collaboration.tasks AS task
SET assignee_user_id = agent.owner_user_id
FROM sciforge_collaboration.agent_nodes AS agent
WHERE task.assignee_agent_id = agent.agent_id
  AND task.assignee_user_id IS NULL;

ALTER TABLE sciforge_collaboration.tasks
  ALTER COLUMN execution_id SET NOT NULL,
  ALTER COLUMN assignee_user_id SET NOT NULL;

-- Schema v1 stored criteria as strings. Convert them in place to the public
-- criterion shape without changing their order or text. The generated ID is
-- deterministic for a Task/ordinal pair and satisfies the opaque cri_ format.
UPDATE sciforge_collaboration.tasks AS task
SET completion_criteria = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(item.value) = 'string' THEN jsonb_build_object(
        'criterionId', 'cri_' || substr(md5(task.task_id || ':' || item.ordinality::text), 1, 24),
        'text', item.value #>> '{}'
      )
      ELSE item.value
    END
    ORDER BY item.ordinality
  )
  FROM jsonb_array_elements(task.completion_criteria) WITH ORDINALITY AS item(value, ordinality)
)
WHERE jsonb_typeof(task.completion_criteria) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(task.completion_criteria) AS existing(value)
    WHERE jsonb_typeof(existing.value) = 'string'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_execution_id_format'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_execution_id_format
      CHECK (execution_id ~ '^exe_[A-Za-z0-9]{12,64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_execution_id_unique
  ON sciforge_collaboration.tasks(execution_id);

ALTER TABLE sciforge_collaboration.tasks
  DROP CONSTRAINT IF EXISTS tasks_safe_failure_summary_state,
  DROP CONSTRAINT IF EXISTS tasks_coordination_requirements_shape;

ALTER TABLE sciforge_collaboration.tasks
  ADD CONSTRAINT tasks_safe_failure_summary_state CHECK (
    safe_failure_summary IS NULL
    OR (status = 'failed' AND char_length(safe_failure_summary) BETWEEN 1 AND 2000)
  ),
  ADD CONSTRAINT tasks_coordination_requirements_shape CHECK (
    jsonb_typeof(completion_criteria) = 'array'
    AND jsonb_typeof(required_capabilities) = 'object'
    AND required_capabilities ?& ARRAY[
      'capabilityIds', 'vpnAccessIds', 'slurmClusterIds', 'requiredResourceRefIds'
    ]
    AND jsonb_typeof(required_capabilities->'capabilityIds') = 'array'
    AND jsonb_typeof(required_capabilities->'vpnAccessIds') = 'array'
    AND jsonb_typeof(required_capabilities->'slurmClusterIds') = 'array'
    AND jsonb_typeof(required_capabilities->'requiredResourceRefIds') = 'array'
    AND jsonb_typeof(resource_ref_ids) = 'array'
    AND jsonb_typeof(authorization_requirements) = 'array'
  );

-- A succeeded execution owns one structured candidate result. A later retry
-- may supersede that record, but it must not create a second record for the
-- same immutable execution identity.
ALTER TABLE sciforge_collaboration.project_records
  ADD COLUMN IF NOT EXISTS source_execution_id text,
  ADD COLUMN IF NOT EXISTS criterion_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resource_ref_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS log_summary text;

UPDATE sciforge_collaboration.project_records AS record
SET source_execution_id = task.execution_id
FROM sciforge_collaboration.tasks AS task
WHERE record.source_task_id = task.task_id
  AND record.source_execution_id IS NULL;

UPDATE sciforge_collaboration.project_records AS record
SET source_revision = task.revision
FROM sciforge_collaboration.tasks AS task
WHERE record.source_task_id = task.task_id
  AND record.source_revision IS NULL;

ALTER TABLE sciforge_collaboration.project_records
  DROP CONSTRAINT IF EXISTS project_records_status_check,
  DROP CONSTRAINT IF EXISTS project_records_status_valid,
  DROP CONSTRAINT IF EXISTS project_records_execution_provenance,
  DROP CONSTRAINT IF EXISTS project_records_structured_result_shape;

ALTER TABLE sciforge_collaboration.project_records
  ADD CONSTRAINT project_records_status_valid
    CHECK (status IN ('candidate', 'accepted', 'rejected', 'superseded')),
  ADD CONSTRAINT project_records_execution_provenance CHECK (
    (kind = 'task_result'
      AND source_task_id IS NOT NULL
      AND source_execution_id IS NOT NULL
      AND source_revision >= 1)
    OR
    (kind <> 'task_result'
      AND (source_execution_id IS NULL OR source_task_id IS NOT NULL))
  ),
  ADD CONSTRAINT project_records_structured_result_shape CHECK (
    jsonb_typeof(criterion_evidence) = 'array'
    AND jsonb_typeof(resource_ref_ids) = 'array'
    AND (log_summary IS NULL OR char_length(log_summary) BETWEEN 1 AND 2000)
  );

-- Legacy schemas allowed more than one TaskResult row for the same execution.
-- Accepted Project facts cannot be reconciled without an explicit human
-- decision, so fail closed with a fixed diagnostic that exposes no row data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_records
    WHERE kind = 'task_result'
      AND status = 'accepted'
      AND source_task_id IS NOT NULL
      AND source_execution_id IS NOT NULL
    GROUP BY source_task_id, source_execution_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0004_multiple_accepted_task_results';
  END IF;
END $$;

-- Keep one deterministic canonical row per immutable execution. Historical
-- duplicates remain queryable by ID but no longer compete with the canonical
-- result. CURRENT_TIMESTAMP is the single transaction-scoped migration time.
WITH ranked_task_results AS (
  SELECT
    project_record_id,
    row_number() OVER (
      PARTITION BY source_task_id, source_execution_id
      ORDER BY
        CASE status
          WHEN 'accepted' THEN 0
          WHEN 'candidate' THEN 1
          ELSE 2
        END,
        updated_at DESC,
        project_record_id ASC
    ) AS canonical_rank
  FROM sciforge_collaboration.project_records
  WHERE kind = 'task_result'
    AND source_task_id IS NOT NULL
    AND source_execution_id IS NOT NULL
)
UPDATE sciforge_collaboration.project_records AS record
SET status = 'superseded',
    revision = record.revision + 1,
    updated_at = CURRENT_TIMESTAMP
FROM ranked_task_results AS ranked
WHERE record.project_record_id = ranked.project_record_id
  AND ranked.canonical_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS project_records_task_result_execution_unique
  ON sciforge_collaboration.project_records(source_task_id, source_execution_id)
  WHERE kind = 'task_result' AND status <> 'superseded';

-- Preserve legacy completed Tasks by materializing their previously inline
-- result summary as the canonical execution-scoped ProjectRecord.
INSERT INTO sciforge_collaboration.project_records (
  project_record_id,project_id,kind,status,summary,author_user_id,author_agent_id,
  source_task_id,source_execution_id,source_revision,criterion_evidence,resource_ref_ids,
  log_summary,accepted_by_user_id,accepted_by_agent_id,accepted_at,revision,created_at,updated_at
)
SELECT
  'rec_' || substr(md5(task.task_id || ':schema-v4-result'), 1, 24),
  task.project_id,
  'task_result',
  'candidate',
  task.result_summary,
  NULL,
  task.assignee_agent_id,
  task.task_id,
  task.execution_id,
  task.revision,
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  NULL,
  NULL,
  NULL,
  1,
  task.updated_at,
  task.updated_at
FROM sciforge_collaboration.tasks AS task
WHERE task.status = 'completed'
  AND task.result_record_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_records AS existing
    WHERE existing.kind = 'task_result'
      AND existing.status <> 'superseded'
      AND existing.source_task_id = task.task_id
      AND existing.source_execution_id = task.execution_id
  )
ON CONFLICT DO NOTHING;

UPDATE sciforge_collaboration.tasks AS task
SET result_record_id = record.project_record_id
FROM sciforge_collaboration.project_records AS record
WHERE task.status = 'completed'
  AND task.result_record_id IS NULL
  AND record.kind = 'task_result'
  AND record.status <> 'superseded'
  AND record.source_task_id = task.task_id
  AND record.source_execution_id = task.execution_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_result_record_fk'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_result_record_fk
      FOREIGN KEY (result_record_id)
      REFERENCES sciforge_collaboration.project_records(project_record_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_result_record_unique
  ON sciforge_collaboration.tasks(result_record_id)
  WHERE result_record_id IS NOT NULL;

ALTER TABLE sciforge_collaboration.tasks
  DROP CONSTRAINT IF EXISTS tasks_result_record_state;

ALTER TABLE sciforge_collaboration.tasks
  ADD CONSTRAINT tasks_result_record_state CHECK (
    (status = 'completed' AND result_record_id IS NOT NULL)
    OR (status <> 'completed' AND result_record_id IS NULL)
  );

-- ResourceRef provenance follows an execution, not only a mutable Task
-- revision. Provider lifecycle states remain metadata-only and never contain
-- credentials or content.
ALTER TABLE sciforge_collaboration.resource_refs
  ADD COLUMN IF NOT EXISTS execution_id text,
  ADD COLUMN IF NOT EXISTS status_reason_code text,
  ADD COLUMN IF NOT EXISTS unavailable_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

UPDATE sciforge_collaboration.resource_refs AS resource
SET execution_id = task.execution_id
FROM sciforge_collaboration.tasks AS task
WHERE resource.task_id = task.task_id
  AND resource.execution_id IS NULL;

ALTER TABLE sciforge_collaboration.resource_refs
  DROP CONSTRAINT IF EXISTS resource_refs_status_valid,
  DROP CONSTRAINT IF EXISTS resource_refs_provenance_complete,
  DROP CONSTRAINT IF EXISTS resource_refs_status_timestamp_consistent,
  DROP CONSTRAINT IF EXISTS resource_refs_status_reason_format;

ALTER TABLE sciforge_collaboration.resource_refs
  ADD CONSTRAINT resource_refs_status_valid
    CHECK (status IN ('available', 'unavailable', 'revoked', 'invalidated')),
  ADD CONSTRAINT resource_refs_provenance_complete CHECK (
    (task_id IS NULL AND execution_id IS NULL AND task_revision IS NULL)
    OR
    (task_id IS NOT NULL AND execution_id IS NOT NULL AND task_revision >= 1)
  ),
  ADD CONSTRAINT resource_refs_status_reason_format CHECK (
    status_reason_code IS NULL OR status_reason_code ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  ADD CONSTRAINT resource_refs_status_timestamp_consistent CHECK (
    (status = 'available'
      AND status_reason_code IS NULL
      AND unavailable_at IS NULL AND revoked_at IS NULL AND invalidated_at IS NULL)
    OR
    (status = 'unavailable'
      AND status_reason_code IS NOT NULL
      AND unavailable_at IS NOT NULL AND revoked_at IS NULL AND invalidated_at IS NULL)
    OR
    (status = 'revoked'
      AND status_reason_code IS NOT NULL
      AND unavailable_at IS NULL AND revoked_at IS NOT NULL AND invalidated_at IS NULL)
    OR
    (status = 'invalidated'
      AND status_reason_code IS NULL
      AND unavailable_at IS NULL AND revoked_at IS NULL AND invalidated_at IS NOT NULL)
  );

-- Capability profiles are public, bounded snapshots. They are kept separate
-- from agent_nodes so heartbeat/lifecycle revisions cannot overwrite the
-- latest capability evidence revision.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_nodes_identity_owner_unique'
      AND conrelid = 'sciforge_collaboration.agent_nodes'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.agent_nodes
      ADD CONSTRAINT agent_nodes_identity_owner_unique UNIQUE (agent_id, owner_user_id);
  END IF;
END $$;

DO $$
DECLARE
  current_update_action text;
BEGIN
  SELECT constraint_record.confupdtype::text
  INTO current_update_action
  FROM pg_constraint AS constraint_record
    WHERE conname = 'tasks_assignee_owner_fk'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ;
  IF current_update_action IS DISTINCT FROM 'c' THEN
    ALTER TABLE sciforge_collaboration.tasks
      DROP CONSTRAINT IF EXISTS tasks_assignee_owner_fk;
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_assignee_owner_fk
      FOREIGN KEY (assignee_agent_id, assignee_user_id)
      REFERENCES sciforge_collaboration.agent_nodes(agent_id, owner_user_id)
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.agent_capability_profiles (
  agent_id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  node_type text NOT NULL CHECK (node_type IN ('personal_computer', 'institution_server')),
  os_family text NOT NULL CHECK (os_family IN ('windows', 'macos', 'linux')),
  os_architecture text NOT NULL CHECK (os_architecture IN ('x64', 'arm64')),
  os_version text,
  runtime_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  gpu jsonb NOT NULL DEFAULT '[]'::jsonb,
  vpn_access_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  slurm_cluster_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  accessible_resource_ref_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_return_policy jsonb NOT NULL,
  reported_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT agent_capability_profiles_owner_fk
    FOREIGN KEY (agent_id, owner_user_id)
    REFERENCES sciforge_collaboration.agent_nodes(agent_id, owner_user_id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE,
  CONSTRAINT agent_capability_profiles_shape CHECK (
    jsonb_typeof(runtime_ids) = 'array'
    AND jsonb_typeof(capabilities) = 'array'
    AND jsonb_typeof(gpu) = 'array'
    AND jsonb_typeof(vpn_access_ids) = 'array'
    AND jsonb_typeof(slurm_cluster_ids) = 'array'
    AND jsonb_typeof(accessible_resource_ref_ids) = 'array'
    AND jsonb_typeof(result_return_policy) = 'object'
  ),
  CONSTRAINT agent_capability_profiles_times CHECK (expires_at > reported_at),
  CONSTRAINT agent_capability_profiles_revision CHECK (revision >= 1)
);

-- Capability evidence is owner-bound and must never be re-attributed by an
-- Agent ownership update. Normalize an already-created v4 constraint too,
-- because the migration runner is intentionally idempotent.
DO $$
DECLARE
  current_update_action text;
  current_delete_action text;
BEGIN
  SELECT constraint_record.confupdtype::text, constraint_record.confdeltype::text
  INTO current_update_action, current_delete_action
  FROM pg_constraint AS constraint_record
  WHERE conname = 'agent_capability_profiles_owner_fk'
    AND conrelid = 'sciforge_collaboration.agent_capability_profiles'::regclass;
  IF current_update_action IS DISTINCT FROM 'a' OR current_delete_action IS DISTINCT FROM 'c' THEN
    ALTER TABLE sciforge_collaboration.agent_capability_profiles
      DROP CONSTRAINT IF EXISTS agent_capability_profiles_owner_fk;
    ALTER TABLE sciforge_collaboration.agent_capability_profiles
      ADD CONSTRAINT agent_capability_profiles_owner_fk
      FOREIGN KEY (agent_id, owner_user_id)
      REFERENCES sciforge_collaboration.agent_nodes(agent_id, owner_user_id)
      ON UPDATE NO ACTION
      ON DELETE CASCADE;
  END IF;
END $$;

-- Human requests can originate either from the current Worker execution or
-- from the current Coordinator. Only Coordinator requests may carry an
-- immutable action description that can yield a confirmation.
ALTER TABLE sciforge_collaboration.human_requests
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS execution_id text,
  ADD COLUMN IF NOT EXISTS source_inbox_message_id text,
  ADD COLUMN IF NOT EXISTS confirmable_action jsonb;

UPDATE sciforge_collaboration.human_requests
SET source_kind = 'worker'
WHERE source_kind IS NULL;

UPDATE sciforge_collaboration.human_requests AS request
SET execution_id = task.execution_id
FROM sciforge_collaboration.tasks AS task
WHERE request.task_id = task.task_id
  AND request.execution_id IS NULL;

ALTER TABLE sciforge_collaboration.human_requests
  ALTER COLUMN source_kind SET NOT NULL,
  ALTER COLUMN task_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS human_requests_source_valid,
  DROP CONSTRAINT IF EXISTS human_requests_confirmable_action_shape;

ALTER TABLE sciforge_collaboration.human_requests
  ADD CONSTRAINT human_requests_source_valid CHECK (
    (source_kind = 'worker'
      AND task_id IS NOT NULL
      AND execution_id IS NOT NULL
      AND source_inbox_message_id IS NULL)
    OR
    (source_kind = 'coordinator'
      AND task_id IS NULL
      AND execution_id IS NULL
      AND source_inbox_message_id IS NOT NULL)
  ),
  ADD CONSTRAINT human_requests_confirmable_action_shape CHECK (
    confirmable_action IS NULL
    OR
    (source_kind = 'coordinator'
      AND jsonb_typeof(confirmable_action) = 'object'
      AND confirmable_action->>'kind' IN (
        'tasks.create', 'task.retry_reassign', 'task.cancel', 'project.complete'
      )
      AND confirmable_action ? 'projectId'
      AND confirmable_action->>'projectId' = project_id)
  );

CREATE TABLE IF NOT EXISTS sciforge_collaboration.action_confirmations (
  confirmation_id text PRIMARY KEY,
  human_request_id text NOT NULL UNIQUE
    REFERENCES sciforge_collaboration.human_requests(human_request_id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  target_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  coordinator_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  action jsonb NOT NULL,
  action_digest bytea NOT NULL,
  status text NOT NULL,
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_actor_key text,
  consumed_operation text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT action_confirmations_action_shape CHECK (
    jsonb_typeof(action) = 'object'
    AND action->>'kind' IN (
      'tasks.create', 'task.retry_reassign', 'task.cancel', 'project.complete'
    )
    AND action ? 'projectId'
    AND action->>'projectId' = project_id
    AND octet_length(action_digest) = 32
  ),
  CONSTRAINT action_confirmations_status_valid
    CHECK (status IN ('approved', 'consumed', 'superseded')),
  CONSTRAINT action_confirmations_status_timestamps CHECK (
    (status = 'approved'
      AND consumed_at IS NULL
      AND consumed_by_actor_key IS NULL
      AND consumed_operation IS NULL)
    OR
    (status = 'consumed'
      AND consumed_at IS NOT NULL
      AND consumed_by_actor_key IS NOT NULL
      AND consumed_operation IS NOT NULL)
    OR
    (status = 'superseded'
      AND consumed_at IS NULL
      AND consumed_by_actor_key IS NULL
      AND consumed_operation IS NULL)
  ),
  CONSTRAINT action_confirmations_times CHECK (expires_at > approved_at)
);

ALTER TABLE sciforge_collaboration.human_answers
  ADD COLUMN IF NOT EXISTS execution_id text,
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS confirmation_id text;

UPDATE sciforge_collaboration.human_answers AS answer
SET execution_id = request.execution_id
FROM sciforge_collaboration.human_requests AS request
WHERE answer.human_request_id = request.human_request_id
  AND answer.execution_id IS NULL;

ALTER TABLE sciforge_collaboration.human_answers
  ALTER COLUMN task_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS human_answers_execution_provenance,
  DROP CONSTRAINT IF EXISTS human_answers_decision_confirmation_consistent;

ALTER TABLE sciforge_collaboration.human_answers
  ADD CONSTRAINT human_answers_execution_provenance CHECK (
    (task_id IS NULL) = (execution_id IS NULL)
  ),
  ADD CONSTRAINT human_answers_decision_confirmation_consistent CHECK (
    (decision IS NULL AND confirmation_id IS NULL)
    OR (decision = 'reject' AND confirmation_id IS NULL)
    OR (decision = 'approve' AND confirmation_id IS NOT NULL)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'human_answers_confirmation_fk'
      AND conrelid = 'sciforge_collaboration.human_answers'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.human_answers
      ADD CONSTRAINT human_answers_confirmation_fk
      FOREIGN KEY (confirmation_id)
      REFERENCES sciforge_collaboration.action_confirmations(confirmation_id);
  END IF;
END $$;

-- Superseded messages remain durable tombstones until the cursor passes them,
-- allowing a later ACK to skip only explicitly superseded gaps.
ALTER TABLE sciforge_collaboration.inbox_messages
  ADD COLUMN IF NOT EXISTS disposition text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_message_id text;

ALTER TABLE sciforge_collaboration.inbox_messages
  DROP CONSTRAINT IF EXISTS inbox_messages_disposition_valid,
  DROP CONSTRAINT IF EXISTS inbox_messages_superseded_timestamp;

ALTER TABLE sciforge_collaboration.inbox_messages
  ADD CONSTRAINT inbox_messages_disposition_valid
    CHECK (disposition IN ('active', 'superseded')),
  ADD CONSTRAINT inbox_messages_superseded_timestamp CHECK (
    (disposition = 'active'
      AND superseded_at IS NULL
      AND superseded_by_message_id IS NULL)
    OR
    (disposition = 'superseded' AND superseded_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS inbox_messages_project_active
  ON sciforge_collaboration.inbox_messages(
    recipient_kind, recipient_id, ((payload->>'projectId')), sequence
  )
  WHERE disposition = 'active';

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (4)
ON CONFLICT (version) DO NOTHING;

COMMIT;
