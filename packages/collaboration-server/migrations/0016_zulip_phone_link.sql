BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;

DO $$
DECLARE current_version bigint;
BEGIN
  SELECT max(version) INTO current_version FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'migration_0016_requires_v15';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.remote_capability_approvals
  ADD COLUMN IF NOT EXISTS interaction_mode text NOT NULL DEFAULT 'command_v1';

ALTER TABLE sciforge_collaboration.remote_capability_approvals
  DROP CONSTRAINT IF EXISTS remote_capability_approvals_interaction_mode_check;

ALTER TABLE sciforge_collaboration.remote_capability_approvals
  ADD CONSTRAINT remote_capability_approvals_interaction_mode_check
  CHECK (interaction_mode IN ('command_v1', 'reaction_v1'));

ALTER TABLE sciforge_collaboration.managed_provider_containers
  ADD COLUMN IF NOT EXISTS installation_id text;

UPDATE sciforge_collaboration.managed_provider_containers AS container
SET installation_id = COALESCE(
  (
    SELECT device.installation_id
    FROM sciforge_collaboration.remote_session_projections AS projection
    JOIN sciforge_collaboration.agent_nodes AS agent ON agent.agent_id = projection.agent_id
    JOIN sciforge_collaboration.devices AS device ON device.device_id = agent.device_id
    WHERE projection.owner_user_id = container.owner_user_id
      AND projection.human_endpoint_id = container.human_endpoint_id
      AND projection.locator->>'provider' = container.provider
      AND projection.locator->>'realmId' = container.realm_id
      AND projection.locator->>'containerId' = container.external_container_id
    ORDER BY CASE projection.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
      projection.created_at, projection.projection_id
    LIMIT 1
  ),
  (
    SELECT device.installation_id
    FROM sciforge_collaboration.participant_profiles AS participant
    JOIN sciforge_collaboration.agent_nodes AS agent ON agent.agent_id = participant.primary_agent_id
    JOIN sciforge_collaboration.devices AS device ON device.device_id = agent.device_id
    WHERE participant.user_id = container.owner_user_id
  ),
  'ins_legacy' || substr(md5(container.managed_container_id), 1, 24)
)
WHERE installation_id IS NULL;

ALTER TABLE sciforge_collaboration.managed_provider_containers
  ALTER COLUMN installation_id SET NOT NULL;

ALTER TABLE sciforge_collaboration.managed_provider_containers
  DROP CONSTRAINT IF EXISTS managed_provider_containers_owner_user_id_provider_realm_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS managed_provider_container_owner_installation_unique
  ON sciforge_collaboration.managed_provider_containers(owner_user_id, provider, realm_id, installation_id);

UPDATE sciforge_collaboration.remote_session_projections AS projection
SET status = 'paused', last_error_code = 'managed_container_installation_mismatch',
    revision = projection.revision + 1, updated_at = CURRENT_TIMESTAMP
FROM sciforge_collaboration.agent_nodes AS agent
JOIN sciforge_collaboration.devices AS device ON device.device_id = agent.device_id,
     sciforge_collaboration.managed_provider_containers AS container
WHERE projection.agent_id = agent.agent_id
  AND projection.owner_user_id = container.owner_user_id
  AND projection.human_endpoint_id = container.human_endpoint_id
  AND projection.locator->>'provider' = container.provider
  AND projection.locator->>'realmId' = container.realm_id
  AND projection.locator->>'containerId' = container.external_container_id
  AND device.installation_id <> container.installation_id
  AND projection.status = 'active';

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
VALUES (16)
ON CONFLICT (version) DO NOTHING;

COMMIT;
