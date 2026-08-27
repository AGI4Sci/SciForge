BEGIN;

ALTER TABLE sciforge_collaboration.remote_capability_approvals
  ADD COLUMN IF NOT EXISTS interaction_mode text NOT NULL DEFAULT 'command_v1';

ALTER TABLE sciforge_collaboration.remote_capability_approvals
  DROP CONSTRAINT IF EXISTS remote_capability_approvals_interaction_mode_check;

ALTER TABLE sciforge_collaboration.remote_capability_approvals
  ADD CONSTRAINT remote_capability_approvals_interaction_mode_check
  CHECK (interaction_mode IN ('command_v1', 'reaction_v1'));

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (5)
ON CONFLICT (version) DO NOTHING;

COMMIT;
