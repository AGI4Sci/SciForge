BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;

DO $$
DECLARE
  current_version bigint;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 13 THEN
    RAISE EXCEPTION 'migration_0014_requires_v13';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.project_content_space_bindings
  DROP CONSTRAINT project_content_space_binding_state_shape,
  ADD CONSTRAINT project_content_space_binding_state_shape CHECK (
    (status = 'provisioning' AND status_reason = 'provisioning_incomplete'
      AND attestation_id IS NULL
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

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (14);

COMMIT;
