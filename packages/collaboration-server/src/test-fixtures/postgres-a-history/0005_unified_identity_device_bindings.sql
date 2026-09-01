BEGIN;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.oidc_identities (
  identity_id text PRIMARY KEY,
  user_id text NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  email_at_link_time text,
  status text NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT oidc_identities_user_fk FOREIGN KEY (user_id)
    REFERENCES sciforge_collaboration.user_principals(user_id),
  CONSTRAINT oidc_identities_issuer_subject_unique UNIQUE (issuer, subject),
  CONSTRAINT oidc_identities_identity_owner_unique UNIQUE (identity_id, user_id),
  CONSTRAINT oidc_identities_identity_shape CHECK (
    char_length(issuer) BETWEEN 1 AND 2048
    AND char_length(subject) BETWEEN 1 AND 512
    AND (email_at_link_time IS NULL OR char_length(email_at_link_time) BETWEEN 3 AND 320)
  ),
  CONSTRAINT oidc_identities_status_valid CHECK (status IN ('active', 'revoked')),
  CONSTRAINT oidc_identities_status_timestamps CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT oidc_identities_revision_valid CHECK (revision >= 1),
  CONSTRAINT oidc_identities_times CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.device_enrollments (
  enrollment_id text PRIMARY KEY,
  user_id text NOT NULL,
  installation_id text NOT NULL,
  nonce_digest bytea NOT NULL,
  status text NOT NULL,
  revision bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT device_enrollments_user_fk FOREIGN KEY (user_id)
    REFERENCES sciforge_collaboration.user_principals(user_id),
  CONSTRAINT device_enrollments_nonce_digest_unique UNIQUE (nonce_digest),
  CONSTRAINT device_enrollments_status_valid CHECK (status IN ('pending', 'consumed', 'expired')),
  CONSTRAINT device_enrollments_consumption_state CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status IN ('pending', 'expired') AND consumed_at IS NULL)
  ),
  CONSTRAINT device_enrollments_revision_valid CHECK (revision >= 1),
  CONSTRAINT device_enrollments_times CHECK (
    expires_at > created_at
    AND updated_at >= created_at
    AND (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at))
  )
);

CREATE INDEX IF NOT EXISTS device_enrollments_owner_installation
  ON sciforge_collaboration.device_enrollments(user_id, installation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sciforge_collaboration.devices (
  device_id text PRIMARY KEY,
  user_id text NOT NULL,
  installation_id text NOT NULL,
  display_name text NOT NULL,
  platform jsonb NOT NULL,
  public_key_jwk jsonb NOT NULL,
  capability_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT devices_user_fk FOREIGN KEY (user_id)
    REFERENCES sciforge_collaboration.user_principals(user_id),
  CONSTRAINT devices_installation_unique UNIQUE (installation_id),
  CONSTRAINT devices_identity_owner_unique UNIQUE (device_id, user_id),
  CONSTRAINT devices_display_name_valid CHECK (char_length(display_name) BETWEEN 1 AND 200),
  CONSTRAINT devices_platform_shape CHECK (
    jsonb_typeof(platform) = 'object'
    AND platform ?& ARRAY['os', 'arch', 'appVersion']
    AND (platform->>'os') IN ('windows', 'macos', 'linux')
    AND (platform->>'arch') IN ('x64', 'arm64')
    AND char_length(platform->>'appVersion') BETWEEN 1 AND 200
    AND (NOT (platform ? 'osVersion') OR char_length(platform->>'osVersion') BETWEEN 1 AND 200)
    AND (platform - ARRAY['os', 'arch', 'osVersion', 'appVersion']) = '{}'::jsonb
  ),
  CONSTRAINT devices_public_key_shape CHECK (
    jsonb_typeof(public_key_jwk) = 'object'
    AND public_key_jwk ?& ARRAY['kty', 'crv', 'alg', 'use', 'kid', 'x']
    AND public_key_jwk->>'kty' = 'OKP'
    AND public_key_jwk->>'crv' = 'Ed25519'
    AND public_key_jwk->>'alg' = 'EdDSA'
    AND public_key_jwk->>'use' = 'sig'
    AND char_length(public_key_jwk->>'kid') BETWEEN 1 AND 128
    AND char_length(public_key_jwk->>'x') BETWEEN 42 AND 128
    AND (public_key_jwk - ARRAY['kty', 'crv', 'alg', 'use', 'kid', 'x']) = '{}'::jsonb
  ),
  CONSTRAINT devices_capability_summary_shape CHECK (jsonb_typeof(capability_summary) = 'array'),
  CONSTRAINT devices_status_valid CHECK (status IN ('active', 'revoked')),
  CONSTRAINT devices_status_timestamps CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT devices_revision_valid CHECK (revision >= 1),
  CONSTRAINT devices_times CHECK (updated_at >= created_at)
);

-- Evolve the existing endpoint table into the single authoritative Zulip
-- external-identity history. No second ACTIVE identity table is introduced.
ALTER TABLE sciforge_collaboration.human_endpoint_bindings
  DROP CONSTRAINT IF EXISTS human_endpoint_bindings_provider_realm_id_provider_user_id_key,
  ADD COLUMN IF NOT EXISTS external_identity_id text,
  ADD COLUMN IF NOT EXISTS realm_url text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE sciforge_collaboration.human_endpoint_bindings
SET created_at = verified_at
WHERE created_at IS NULL;

ALTER TABLE sciforge_collaboration.human_endpoint_bindings
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Legacy Zulip pairing rows have no explicit OIDC mapping. Preserve them as
-- revoked history instead of guessing a new User or blocking an explicit bind.
UPDATE sciforge_collaboration.human_endpoint_bindings
SET status = 'revoked',
    revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP,
    revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE provider = 'zulip'
  AND external_identity_id IS NULL
  AND status <> 'revoked';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'human_endpoint_bindings_external_identity_unique'
      AND conrelid = 'sciforge_collaboration.human_endpoint_bindings'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.human_endpoint_bindings
      ADD CONSTRAINT human_endpoint_bindings_external_identity_unique UNIQUE (external_identity_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'human_endpoint_bindings_external_identity_shape'
      AND conrelid = 'sciforge_collaboration.human_endpoint_bindings'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.human_endpoint_bindings
      ADD CONSTRAINT human_endpoint_bindings_external_identity_shape CHECK (
        external_identity_id IS NULL
        OR (
          provider = 'zulip'
          AND realm_url IS NOT NULL
          AND char_length(realm_url) BETWEEN 1 AND 2048
          AND status IN ('active', 'revoked')
          AND ((status = 'active' AND revoked_at IS NULL)
            OR (status = 'revoked' AND revoked_at IS NOT NULL))
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS human_endpoint_bindings_zulip_provider_identity_active_unique
  ON sciforge_collaboration.human_endpoint_bindings(realm_id, provider_user_id)
  WHERE provider = 'zulip' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS human_endpoint_bindings_zulip_user_realm_active_unique
  ON sciforge_collaboration.human_endpoint_bindings(user_id, realm_id)
  WHERE provider = 'zulip' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS human_endpoint_bindings_other_provider_identity_active_unique
  ON sciforge_collaboration.human_endpoint_bindings(provider, realm_id, provider_user_id)
  WHERE provider <> 'zulip' AND status = 'active';

CREATE TABLE IF NOT EXISTS sciforge_collaboration.zulip_binding_requests (
  binding_request_id text PRIMARY KEY,
  user_id text NOT NULL,
  realm_url text NOT NULL,
  code_digest bytea NOT NULL,
  status text NOT NULL,
  revision bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  external_identity_id text,
  service_actor_id text,
  provider_event_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT zulip_binding_requests_user_fk FOREIGN KEY (user_id)
    REFERENCES sciforge_collaboration.user_principals(user_id),
  CONSTRAINT zulip_binding_requests_code_digest_unique UNIQUE (code_digest),
  CONSTRAINT zulip_binding_requests_provider_event_unique UNIQUE (provider_event_id),
  CONSTRAINT zulip_binding_requests_external_identity_fk FOREIGN KEY (external_identity_id)
    REFERENCES sciforge_collaboration.human_endpoint_bindings(external_identity_id),
  CONSTRAINT zulip_binding_requests_status_valid CHECK (status IN ('pending', 'confirmed', 'expired')),
  CONSTRAINT zulip_binding_requests_confirmation_state CHECK (
    (status = 'confirmed'
      AND confirmed_at IS NOT NULL
      AND external_identity_id IS NOT NULL
      AND service_actor_id IS NOT NULL
      AND provider_event_id IS NOT NULL)
    OR (status IN ('pending', 'expired')
      AND confirmed_at IS NULL
      AND external_identity_id IS NULL
      AND service_actor_id IS NULL
      AND provider_event_id IS NULL)
  ),
  CONSTRAINT zulip_binding_requests_revision_valid CHECK (revision >= 1),
  CONSTRAINT zulip_binding_requests_times CHECK (
    expires_at > created_at
    AND updated_at >= created_at
    AND (confirmed_at IS NULL OR (confirmed_at >= created_at AND confirmed_at < expires_at))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS zulip_binding_requests_pending_user_realm_unique
  ON sciforge_collaboration.zulip_binding_requests(user_id, realm_url)
  WHERE status = 'pending';

ALTER TABLE sciforge_collaboration.agent_nodes
  ADD COLUMN IF NOT EXISTS device_id text,
  ALTER COLUMN installation_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS agent_nodes_installation_id_key;

-- There is no trustworthy Ed25519 Device for historical Agents. Revoke their
-- credentials and node authority while retaining every historical row.
UPDATE sciforge_collaboration.credentials AS credential
SET revoked_at = CURRENT_TIMESTAMP
FROM sciforge_collaboration.agent_nodes AS agent
WHERE credential.kind = 'agent_device'
  AND credential.subject_agent_id = agent.agent_id
  AND credential.revoked_at IS NULL
  AND agent.status = 'active'
  AND agent.device_id IS NULL;

UPDATE sciforge_collaboration.agent_nodes
SET status = 'revoked',
    connection_status = 'offline',
    revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP,
    revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE status = 'active'
  AND device_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_nodes_active_device_required'
      AND conrelid = 'sciforge_collaboration.agent_nodes'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.agent_nodes
      ADD CONSTRAINT agent_nodes_active_device_required
      CHECK (status <> 'active' OR device_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_nodes_device_owner_fk'
      AND conrelid = 'sciforge_collaboration.agent_nodes'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.agent_nodes
      ADD CONSTRAINT agent_nodes_device_owner_fk
      FOREIGN KEY (device_id, owner_user_id)
      REFERENCES sciforge_collaboration.devices(device_id, user_id)
      ON UPDATE NO ACTION ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_nodes_device_id
  ON sciforge_collaboration.agent_nodes(device_id);

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (5)
ON CONFLICT (version) DO NOTHING;

COMMIT;
