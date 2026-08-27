BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;

DO $$
DECLARE
  current_version bigint;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'migration_0015_requires_v14';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.inbox_messages
    WHERE recipient_kind = 'agent'
      AND message_type = 'project.created'
      AND (
        payload ->> 'type' IS DISTINCT FROM 'project.created'
        OR message_id !~ '^ibx_[A-Za-z0-9][A-Za-z0-9_]{10,62}[A-Za-z0-9]$'
      )
  ) THEN
    RAISE EXCEPTION 'migration_0015_invalid_project_created_inbox';
  END IF;
END
$$;

UPDATE sciforge_collaboration.inbox_messages
SET message_type = 'collaboration.state.changed',
    payload = jsonb_build_object(
      'protocolVersion', '1.0',
      'type', 'collaboration.state.changed',
      'event', payload || jsonb_build_object(
        'protocolVersion', '1.0',
        'eventId', 'evt_' || substring(message_id FROM 5),
        'causedByRequestId', 'req_' || substring(message_id FROM 5),
        'occurredAt', to_char(
          created_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
    )
WHERE recipient_kind = 'agent'
  AND message_type = 'project.created'
  AND payload ->> 'type' = 'project.created';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.inbox_messages
    WHERE recipient_kind = 'agent'
      AND message_type = 'project.created'
  ) THEN
    RAISE EXCEPTION 'migration_0015_project_created_inbox_not_normalized';
  END IF;
END
$$;

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (15);

COMMIT;
