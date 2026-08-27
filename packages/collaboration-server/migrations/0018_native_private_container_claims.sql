BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;

DO $$
DECLARE current_version bigint;
BEGIN
  SELECT max(version) INTO current_version FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 17 THEN
    RAISE EXCEPTION 'migration_0018_requires_v17';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.provider_private_container_discoveries (
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  human_endpoint_id text NOT NULL REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  installation_id text NOT NULL,
  provider text NOT NULL,
  realm_id text NOT NULL,
  external_container_id text NOT NULL,
  display_name text NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, human_endpoint_id, installation_id, provider, realm_id, external_container_id)
);

CREATE INDEX IF NOT EXISTS provider_private_container_discoveries_expiry_idx
  ON sciforge_collaboration.provider_private_container_discoveries(expires_at);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.provider_private_container_claims (
  claim_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  human_endpoint_id text NOT NULL REFERENCES sciforge_collaboration.human_endpoint_bindings(human_endpoint_id),
  installation_id text NOT NULL,
  provider text NOT NULL,
  realm_id text NOT NULL,
  external_container_id text NOT NULL,
  display_name text NOT NULL,
  claimed_at timestamptz NOT NULL,
  UNIQUE (provider, realm_id, external_container_id)
);

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (18)
ON CONFLICT (version) DO NOTHING;

COMMIT;
