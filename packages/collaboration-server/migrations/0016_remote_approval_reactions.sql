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

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (16)
ON CONFLICT (version) DO NOTHING;

COMMIT;
