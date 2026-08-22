BEGIN;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.managed_provider_containers (
  managed_container_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  human_endpoint_id text NOT NULL REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  provider text NOT NULL,
  realm_id text NOT NULL,
  owner_provider_user_id text NOT NULL,
  stable_key text NOT NULL,
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
  UNIQUE (provider, realm_id, external_container_id),
  UNIQUE (stable_key)
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

CREATE INDEX IF NOT EXISTS managed_provider_container_jobs_claim_idx
  ON sciforge_collaboration.managed_provider_container_jobs(state, next_attempt_at, lease_expires_at);

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (3)
ON CONFLICT (version) DO NOTHING;

COMMIT;
