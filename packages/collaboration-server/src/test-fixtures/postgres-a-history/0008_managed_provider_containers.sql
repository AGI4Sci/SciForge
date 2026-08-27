BEGIN;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.managed_provider_containers (
  managed_container_id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  human_endpoint_id text NOT NULL,
  provider text NOT NULL,
  realm_id text NOT NULL,
  owner_provider_user_id text NOT NULL,
  stable_key text NOT NULL,
  display_name text NOT NULL,
  external_container_id text,
  policy jsonb NOT NULL,
  observed_checks jsonb,
  status text NOT NULL,
  last_verified_at timestamptz,
  safe_error_code text,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT managed_provider_containers_owner_fk
    FOREIGN KEY (owner_user_id) REFERENCES sciforge_collaboration.user_principals(user_id),
  CONSTRAINT managed_provider_containers_endpoint_fk
    FOREIGN KEY (human_endpoint_id) REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  CONSTRAINT managed_provider_containers_status_valid
    CHECK (status IN ('requested', 'provisioning', 'active', 'drifted', 'suspended', 'archived', 'failed')),
  CONSTRAINT managed_provider_containers_revision_valid CHECK (revision >= 1),
  CONSTRAINT managed_provider_containers_owner_realm_unique UNIQUE (owner_user_id, provider, realm_id),
  CONSTRAINT managed_provider_containers_external_unique UNIQUE (provider, realm_id, external_container_id),
  CONSTRAINT managed_provider_containers_stable_key_unique UNIQUE (stable_key)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.managed_provider_container_jobs (
  job_id text PRIMARY KEY,
  managed_container_id text NOT NULL,
  operation text NOT NULL,
  desired_revision bigint NOT NULL,
  state text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  safe_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT managed_provider_container_jobs_container_fk
    FOREIGN KEY (managed_container_id)
    REFERENCES sciforge_collaboration.managed_provider_containers(managed_container_id),
  CONSTRAINT managed_provider_container_jobs_operation_valid
    CHECK (operation IN ('ensure', 'inspect', 'reconcile', 'archive')),
  CONSTRAINT managed_provider_container_jobs_desired_revision_valid CHECK (desired_revision >= 1),
  CONSTRAINT managed_provider_container_jobs_state_valid
    CHECK (state IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed')),
  CONSTRAINT managed_provider_container_jobs_attempt_count_valid CHECK (attempt_count >= 0),
  CONSTRAINT managed_provider_container_jobs_operation_revision_unique
    UNIQUE (managed_container_id, operation, desired_revision)
);

CREATE INDEX IF NOT EXISTS managed_provider_container_jobs_claim_idx
  ON sciforge_collaboration.managed_provider_container_jobs(state, next_attempt_at, lease_expires_at);

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (8)
ON CONFLICT (version) DO NOTHING;

COMMIT;
