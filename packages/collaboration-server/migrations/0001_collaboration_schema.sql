BEGIN;

CREATE SCHEMA IF NOT EXISTS sciforge_collaboration;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.user_principals (
  user_id text PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.human_endpoint_challenges (
  challenge_id text PRIMARY KEY,
  requested_user_id text REFERENCES sciforge_collaboration.user_principals(user_id),
  provider text NOT NULL,
  realm_id text NOT NULL,
  expected_provider_user_id text,
  challenge_digest bytea NOT NULL,
  poll_secret_digest bytea NOT NULL UNIQUE,
  requested_display_name text NOT NULL CHECK (char_length(requested_display_name) BETWEEN 1 AND 200),
  expires_at timestamptz NOT NULL,
  verified_user_id text REFERENCES sciforge_collaboration.user_principals(user_id),
  verified_endpoint_id text,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);

ALTER TABLE sciforge_collaboration.human_endpoint_challenges
  ADD COLUMN IF NOT EXISTS expected_provider_user_id text;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.human_endpoint_bindings (
  human_endpoint_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  provider text NOT NULL,
  realm_id text NOT NULL,
  provider_user_id text NOT NULL,
  display_name text,
  assurance text NOT NULL CHECK (assurance IN ('basic', 'verified', 'strong')),
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  revision bigint NOT NULL CHECK (revision >= 1),
  verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (provider, realm_id, provider_user_id)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.agent_nodes (
  agent_id text PRIMARY KEY,
  installation_id text NOT NULL UNIQUE,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  display_name text NOT NULL,
  node_type text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  connection_status text NOT NULL CHECK (connection_status IN ('online', 'offline')),
  credential_generation integer NOT NULL CHECK (credential_generation >= 1),
  revision bigint NOT NULL CHECK (revision >= 1),
  last_seen_at timestamptz,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.credentials (
  credential_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('user', 'agent_device')),
  subject_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  subject_agent_id text REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  token_digest bytea NOT NULL UNIQUE,
  assurance text NOT NULL CHECK (assurance IN ('verified', 'strong', 'device')),
  generation integer NOT NULL CHECK (generation >= 1),
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  CHECK ((kind = 'agent_device') = (subject_agent_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.participant_profiles (
  user_id text PRIMARY KEY REFERENCES sciforge_collaboration.user_principals(user_id),
  primary_human_endpoint_id text REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  primary_agent_id text REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  status text NOT NULL CHECK (status IN ('incomplete', 'complete')),
  revision bigint NOT NULL CHECK (revision >= 1),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.projects (
  project_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  goal text NOT NULL CHECK (char_length(goal) BETWEEN 1 AND 20000),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'failed', 'cancelled')),
  coordinator_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  max_tasks integer NOT NULL CHECK (max_tasks BETWEEN 1 AND 10000),
  max_tasks_per_round integer NOT NULL CHECK (max_tasks_per_round BETWEEN 1 AND 1000),
  max_task_retries integer NOT NULL CHECK (max_task_retries BETWEEN 0 AND 100),
  max_coordination_rounds integer NOT NULL CHECK (max_coordination_rounds BETWEEN 1 AND 1000),
  coordination_round integer NOT NULL DEFAULT 1 CHECK (coordination_round >= 1),
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.project_members (
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  role text NOT NULL CHECK (role IN ('owner', 'member', 'observer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_one_owner
  ON sciforge_collaboration.project_members(project_id)
  WHERE role = 'owner' AND active;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.tasks (
  task_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  assignee_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  created_by_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 1 AND 20000),
  completion_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependency_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('offered', 'accepted', 'rejected', 'in_progress', 'needs_human', 'completed', 'failed', 'cancelled')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer NOT NULL CHECK (max_retries >= 0),
  coordination_round integer NOT NULL CHECK (coordination_round >= 1),
  active_turn_id text,
  result_summary text,
  failure_summary text,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS tasks_project_status
  ON sciforge_collaboration.tasks(project_id, status);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.project_records (
  project_record_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('observation', 'proposal', 'decision', 'summary', 'task_result')),
  status text NOT NULL CHECK (status IN ('candidate', 'accepted', 'rejected')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 50000),
  author_user_id text REFERENCES sciforge_collaboration.user_principals(user_id),
  author_agent_id text REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  source_task_id text REFERENCES sciforge_collaboration.tasks(task_id),
  source_revision bigint,
  accepted_by_user_id text REFERENCES sciforge_collaboration.user_principals(user_id),
  accepted_by_agent_id text REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  accepted_at timestamptz,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (author_user_id IS NOT NULL OR author_agent_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.remote_session_projections (
  projection_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  human_endpoint_id text NOT NULL REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  locator jsonb NOT NULL,
  locator_revision bigint NOT NULL CHECK (locator_revision >= 1),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'error', 'closed')),
  allowed_sender_user_ids jsonb NOT NULL,
  last_error_code text,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS remote_session_projection_locator_unique
  ON sciforge_collaboration.remote_session_projections
  ((locator->>'provider'), (locator->>'realmId'), (locator->>'containerId'), (locator->>'topicId'));

CREATE TABLE IF NOT EXISTS sciforge_collaboration.project_endpoint_bindings (
  project_endpoint_binding_id text PRIMARY KEY,
  project_id text NOT NULL UNIQUE REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  locator jsonb NOT NULL,
  locator_revision bigint NOT NULL CHECK (locator_revision >= 1),
  status text NOT NULL CHECK (status IN ('active', 'error', 'closed')),
  last_error_code text,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS project_endpoint_binding_locator_unique
  ON sciforge_collaboration.project_endpoint_bindings
  ((locator->>'provider'), (locator->>'realmId'), (locator->>'containerId'), (locator->>'topicId'));

CREATE TABLE IF NOT EXISTS sciforge_collaboration.project_input_cursors (
  project_id text PRIMARY KEY REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence >= 1)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.project_inputs (
  project_input_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  sender_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  source_human_endpoint_id text NOT NULL REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  provider_message_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 32000),
  status text NOT NULL CHECK (status IN ('queued', 'processed', 'rejected', 'expired')),
  revision bigint NOT NULL CHECK (revision >= 1),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (source_human_endpoint_id, provider_message_id),
  UNIQUE (project_id, sequence)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.human_requests (
  human_request_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  target_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  requested_by_agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  required_assurance text NOT NULL CHECK (required_assurance IN ('basic', 'verified', 'strong')),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 32000),
  status text NOT NULL CHECK (status IN ('pending', 'answered', 'expired', 'cancelled')),
  revision bigint NOT NULL CHECK (revision >= 1),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.human_answers (
  human_answer_id text PRIMARY KEY,
  human_request_id text NOT NULL UNIQUE REFERENCES sciforge_collaboration.human_requests(human_request_id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  request_revision bigint NOT NULL,
  answered_by_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  answered_from_human_endpoint_id text NOT NULL REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  assurance text NOT NULL CHECK (assurance IN ('basic', 'verified', 'strong')),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 32000),
  revision bigint NOT NULL CHECK (revision >= 1),
  answered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Provider runtime state is kept in PostgreSQL so event claims, cursor checkpoints
-- and outbound delivery reconciliation survive process and host restarts.
CREATE TABLE IF NOT EXISTS sciforge_collaboration.provider_event_claims (
  provider text NOT NULL,
  realm_id text NOT NULL,
  event_id text NOT NULL,
  dedupe_key text NOT NULL,
  event_cursor text NOT NULL,
  state text NOT NULL CHECK (state IN ('claimed', 'processed')),
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  processed_at timestamptz,
  PRIMARY KEY (provider, realm_id, event_id),
  UNIQUE (provider, realm_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS provider_event_claims_lease
  ON sciforge_collaboration.provider_event_claims(state, lease_expires_at);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.provider_event_cursors (
  provider text PRIMARY KEY,
  realm_id text NOT NULL,
  event_cursor text NOT NULL,
  event_id text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.provider_deliveries (
  client_message_id text PRIMARY KEY,
  provider text NOT NULL,
  result jsonb NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 1),
  terminal boolean NOT NULL,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_deliveries_retry
  ON sciforge_collaboration.provider_deliveries(next_attempt_at)
  WHERE terminal = false;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.provider_diagnostics (
  provider text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'unavailable')),
  safe_summary text NOT NULL CHECK (char_length(safe_summary) BETWEEN 1 AND 500),
  checked_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.inbox_cursors (
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('user', 'human_endpoint', 'agent')),
  recipient_id text NOT NULL,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  acked_sequence bigint NOT NULL DEFAULT 0 CHECK (acked_sequence >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_kind, recipient_id)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.inbox_messages (
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('user', 'human_endpoint', 'agent')),
  recipient_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  message_id text NOT NULL UNIQUE,
  message_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_kind, recipient_id, sequence)
);

CREATE INDEX IF NOT EXISTS inbox_messages_retention
  ON sciforge_collaboration.inbox_messages(expires_at);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.receipts (
  receipt_id text PRIMARY KEY,
  actor_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest bytea NOT NULL,
  operation text NOT NULL,
  resource_kind text,
  resource_id text,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (actor_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS receipts_retention
  ON sciforge_collaboration.receipts(expires_at);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.audit_events (
  audit_event_id text PRIMARY KEY,
  actor_kind text NOT NULL,
  actor_user_id text,
  actor_endpoint_id text,
  actor_agent_id text,
  action text NOT NULL,
  resource_kind text,
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;

COMMIT;
