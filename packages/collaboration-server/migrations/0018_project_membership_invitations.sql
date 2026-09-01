-- A non-Owner Project Membership begins as an invitation. It has no Task or
-- Team authority until the exact invited OIDC User accepts the confirmed Plan.

BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;

DO $$
DECLARE
  current_version bigint;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 17 THEN
    RAISE EXCEPTION 'migration_0018_requires_v17';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.project_members
  DROP CONSTRAINT project_members_state_check,
  DROP CONSTRAINT project_members_state_time_check,
  ADD CONSTRAINT project_members_state_check CHECK (
    state IN ('invited', 'pending_membership', 'active', 'membership_removal_pending', 'removed')
  ),
  ADD CONSTRAINT project_members_state_time_check CHECK (
    (state IN ('invited', 'pending_membership') AND activated_at IS NULL
      AND removal_requested_at IS NULL AND removal_requested_by_user_id IS NULL AND removed_at IS NULL)
    OR (state = 'active' AND activated_at IS NOT NULL
      AND removal_requested_at IS NULL AND removal_requested_by_user_id IS NULL AND removed_at IS NULL)
    OR (state = 'membership_removal_pending'
      AND removal_requested_at IS NOT NULL AND removal_requested_by_user_id IS NOT NULL AND removed_at IS NULL)
    OR (state = 'removed'
      AND removal_requested_at IS NOT NULL AND removal_requested_by_user_id IS NOT NULL AND removed_at IS NOT NULL)
  );

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (18);

COMMIT;
