BEGIN;

ALTER TABLE sciforge_collaboration.inbox_cursors
  DROP CONSTRAINT IF EXISTS inbox_cursors_recipient_kind_check;
ALTER TABLE sciforge_collaboration.inbox_cursors
  ADD CONSTRAINT inbox_cursors_recipient_kind_check
  CHECK (recipient_kind IN ('user', 'human_endpoint', 'agent', 'provider_identity'));

ALTER TABLE sciforge_collaboration.inbox_messages
  DROP CONSTRAINT IF EXISTS inbox_messages_recipient_kind_check;
ALTER TABLE sciforge_collaboration.inbox_messages
  ADD CONSTRAINT inbox_messages_recipient_kind_check
  CHECK (recipient_kind IN ('user', 'human_endpoint', 'agent', 'provider_identity'));

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (6)
ON CONFLICT (version) DO NOTHING;

COMMIT;
