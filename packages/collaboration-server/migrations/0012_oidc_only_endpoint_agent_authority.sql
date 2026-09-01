BEGIN;

DO $$
DECLARE
  current_version integer;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version NOT IN (11, 12) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0012_unsupported_source_lineage';
  END IF;
END
$$;

LOCK TABLE
  sciforge_collaboration.human_endpoint_challenges,
  sciforge_collaboration.credentials,
  sciforge_collaboration.agent_nodes
IN SHARE ROW EXCLUSIVE MODE;

-- Endpoint binding is an authenticated OIDC User operation. Anonymous
-- challenges and their bearer-style poll credentials have no authority in
-- schema v12 and are removed instead of migrated into a second login path.
DELETE FROM sciforge_collaboration.human_endpoint_challenges
WHERE requested_user_id IS NULL OR expected_provider_user_id IS NULL;

ALTER TABLE sciforge_collaboration.human_endpoint_challenges
  ALTER COLUMN requested_user_id SET NOT NULL,
  ALTER COLUMN expected_provider_user_id SET NOT NULL,
  DROP COLUMN IF EXISTS poll_secret_digest,
  DROP COLUMN IF EXISTS requested_display_name,
  DROP COLUMN IF EXISTS consumed_at;

-- OIDC is the sole Human/User authentication path. Only Device-bound Agent
-- machine credentials remain in this table.
DELETE FROM sciforge_collaboration.credentials
WHERE kind <> 'agent_device' OR subject_agent_id IS NULL;

ALTER TABLE sciforge_collaboration.credentials
  DROP CONSTRAINT IF EXISTS credentials_kind_check,
  DROP CONSTRAINT IF EXISTS credentials_assurance_check,
  DROP CONSTRAINT IF EXISTS credentials_check,
  DROP CONSTRAINT IF EXISTS agent_credentials_shape;

ALTER TABLE sciforge_collaboration.credentials
  ADD CONSTRAINT credentials_kind_check CHECK (kind = 'agent_device'),
  ADD CONSTRAINT credentials_assurance_check CHECK (assurance = 'device'),
  ADD CONSTRAINT agent_credentials_shape CHECK (subject_agent_id IS NOT NULL);

-- A Run-0 Agent is a Device-owned identity. Refuse to reinterpret historical
-- installation-only rows as Device authority; operators must start the
-- isolated Run-0 database or explicitly retire those rows first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sciforge_collaboration.agent_nodes WHERE device_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0012_device_bound_agents_required';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.agent_nodes
  ALTER COLUMN device_id SET NOT NULL,
  DROP COLUMN installation_id;

CREATE UNIQUE INDEX IF NOT EXISTS agent_nodes_one_active_per_device
  ON sciforge_collaboration.agent_nodes(device_id)
  WHERE status = 'active';

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (12)
ON CONFLICT (version) DO NOTHING;

COMMIT;
