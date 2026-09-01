-- Close the v19 collaboration pipeline: upgrade Plan file declarations and
-- retained receipts, normalize Agent receipt ownership across credential
-- rotation, and make User-level rejection/reassignment durable.

BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;
LOCK TABLE
  sciforge_collaboration.agent_nodes,
  sciforge_collaboration.credentials,
  sciforge_collaboration.inbox_cursors,
  sciforge_collaboration.inbox_messages,
  sciforge_collaboration.project_plans,
  sciforge_collaboration.receipts,
  sciforge_collaboration.task_authorities,
  sciforge_collaboration.tasks,
  sciforge_collaboration.task_offers
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  current_version bigint;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 18 THEN
    RAISE EXCEPTION 'migration_0019_requires_v18';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_plans AS project_plan
    CROSS JOIN LATERAL jsonb_array_elements(project_plan.tasks) AS plan_task(value)
    WHERE jsonb_typeof(plan_task.value) IS DISTINCT FROM 'object'
      OR NOT (plan_task.value ? 'fileIntent')
      OR (
        plan_task.value->'fileIntent' IS DISTINCT FROM 'null'::jsonb
        AND (
          jsonb_typeof(plan_task.value->'fileIntent') IS DISTINCT FROM 'object'
          OR (
            plan_task.value#>>'{fileIntent,schemaVersion}' = '1'
            AND plan_task.value->'fileIntent' ? 'dependencyInputs'
          )
          OR (
            plan_task.value#>>'{fileIntent,schemaVersion}' = '2'
            AND jsonb_typeof(
              plan_task.value#>'{fileIntent,dependencyInputs}'
            ) IS DISTINCT FROM 'array'
          )
          OR COALESCE(
            plan_task.value#>>'{fileIntent,schemaVersion}',
            ''
          ) NOT IN ('1', '2')
        )
      )
  ) THEN
    RAISE EXCEPTION 'migration_0019_requires_migratable_plan_file_declarations';
  END IF;
END
$$;

-- A retained Plan receipt is an idempotent response checkpoint. It must name
-- the same Plan and carry the same historical Task declarations before the
-- declaration and its replay response can be upgraded together.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.receipts AS receipt
    LEFT JOIN sciforge_collaboration.project_plans AS project_plan
      ON project_plan.project_plan_id = receipt.resource_id
    WHERE receipt.operation IN ('project.plan.submit', 'project.plan.confirm')
      AND (
        receipt.resource_kind IS DISTINCT FROM 'project_plan'
        OR project_plan.project_plan_id IS NULL
        OR jsonb_typeof(receipt.response) IS DISTINCT FROM 'object'
        OR receipt.response->>'protocolVersion' IS DISTINCT FROM '1.0'
        OR receipt.response->>'type' IS DISTINCT FROM CASE receipt.operation
          WHEN 'project.plan.submit' THEN 'project.plan.submitted'
          WHEN 'project.plan.confirm' THEN 'project.plan.confirmed'
        END
        OR jsonb_typeof(receipt.response->'entity') IS DISTINCT FROM 'object'
        OR receipt.response#>>'{entity,projectPlanId}' IS DISTINCT FROM receipt.resource_id
        OR receipt.response#>>'{entity,projectId}' IS DISTINCT FROM project_plan.project_id
        OR receipt.response#>>'{entity,planDigest}' IS DISTINCT FROM project_plan.plan_digest
        OR jsonb_typeof(receipt.response#>'{entity,tasks}') IS DISTINCT FROM 'array'
        OR receipt.response#>'{entity,tasks}' IS DISTINCT FROM project_plan.tasks
      )
  ) THEN
    RAISE EXCEPTION 'migration_0019_requires_migratable_plan_receipts';
  END IF;
END
$$;

-- v18 persisted the then-canonical v1 declaration. Adding an empty symbolic
-- dependency list is semantics-preserving, so retain the historical plan
-- digest and every receipt/inbox reference to it while upgrading the stored
-- declaration to the only v19 shape. New v19 plans digest the explicit list.
UPDATE sciforge_collaboration.project_plans AS project_plan
SET tasks = migrated.tasks
FROM (
  SELECT
    source.project_plan_id,
    jsonb_agg(
      CASE
        WHEN plan_task.value#>>'{fileIntent,schemaVersion}' = '1' THEN
          jsonb_set(
            jsonb_set(
              plan_task.value,
              '{fileIntent,schemaVersion}',
              '2'::jsonb,
              false
            ),
            '{fileIntent,dependencyInputs}',
            '[]'::jsonb,
            true
          )
        ELSE plan_task.value
      END
      ORDER BY plan_task.ordinal
    ) AS tasks
  FROM sciforge_collaboration.project_plans AS source
  CROSS JOIN LATERAL jsonb_array_elements(source.tasks)
    WITH ORDINALITY AS plan_task(value, ordinal)
  GROUP BY source.project_plan_id
) AS migrated
WHERE migrated.project_plan_id = project_plan.project_plan_id
  AND project_plan.tasks IS DISTINCT FROM migrated.tasks;

UPDATE sciforge_collaboration.receipts AS receipt
SET response = jsonb_set(
  receipt.response,
  '{entity,tasks}',
  project_plan.tasks,
  false
)
FROM sciforge_collaboration.project_plans AS project_plan
WHERE receipt.operation IN ('project.plan.submit', 'project.plan.confirm')
  AND receipt.resource_kind = 'project_plan'
  AND receipt.resource_id = project_plan.project_plan_id
  AND receipt.response#>'{entity,tasks}' IS DISTINCT FROM project_plan.tasks;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_plans AS project_plan
    CROSS JOIN LATERAL jsonb_array_elements(project_plan.tasks) AS plan_task(value)
    WHERE plan_task.value->'fileIntent' IS DISTINCT FROM 'null'::jsonb
      AND (
        plan_task.value#>>'{fileIntent,schemaVersion}' IS DISTINCT FROM '2'
        OR jsonb_typeof(
          plan_task.value#>'{fileIntent,dependencyInputs}'
        ) IS DISTINCT FROM 'array'
      )
  ) THEN
    RAISE EXCEPTION 'migration_0019_failed_plan_file_declaration_upgrade';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.receipts AS receipt
    JOIN sciforge_collaboration.project_plans AS project_plan
      ON project_plan.project_plan_id = receipt.resource_id
    WHERE receipt.operation IN ('project.plan.submit', 'project.plan.confirm')
      AND receipt.response#>'{entity,tasks}' IS DISTINCT FROM project_plan.tasks
  ) THEN
    RAISE EXCEPTION 'migration_0019_failed_plan_receipt_upgrade';
  END IF;
END
$$;

-- Agent credentials are replaceable authenticators for one stable Agent
-- principal. v18 included the credential row in the receipt actor namespace,
-- which made an exact response-loss replay disappear after credential
-- rotation. Resolve every historical namespace through the credential table;
-- never infer an Agent from untrusted string segments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.receipts AS receipt
    WHERE receipt.actor_key LIKE 'agent:%'
      AND NOT EXISTS (
        SELECT 1
        FROM sciforge_collaboration.agent_nodes AS agent
        WHERE receipt.actor_key = 'agent:' || agent.agent_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM sciforge_collaboration.credentials AS credential
        WHERE credential.kind = 'agent_device'
          AND credential.subject_agent_id IS NOT NULL
          AND receipt.actor_key =
            'agent:' || credential.subject_agent_id ||
            ':credential:' || credential.credential_id
      )
  ) THEN
    RAISE EXCEPTION 'migration_0019_agent_receipt_actor_unmappable';
  END IF;
END
$$;

CREATE TEMP TABLE migration_0019_agent_receipt_targets (
  receipt_id text PRIMARY KEY,
  target_actor_key text NOT NULL
) ON COMMIT DROP;

INSERT INTO migration_0019_agent_receipt_targets(receipt_id, target_actor_key)
SELECT
  receipt.receipt_id,
  'agent:' || agent.agent_id
FROM sciforge_collaboration.receipts AS receipt
JOIN sciforge_collaboration.agent_nodes AS agent
  ON receipt.actor_key = 'agent:' || agent.agent_id
UNION ALL
SELECT
  receipt.receipt_id,
  'agent:' || credential.subject_agent_id
FROM sciforge_collaboration.receipts AS receipt
JOIN sciforge_collaboration.credentials AS credential
  ON credential.kind = 'agent_device'
  AND credential.subject_agent_id IS NOT NULL
  AND receipt.actor_key =
    'agent:' || credential.subject_agent_id ||
    ':credential:' || credential.credential_id;

-- Credential-scoped namespaces previously allowed the same idempotency key
-- to name multiple receipts for one Agent. Most outcomes must remain
-- byte-for-byte equivalent. inbox.ack is the narrow exception: re-executing
-- the same acknowledgement after credential rotation can observe a later
-- monotonic Inbox cursor even though the acknowledged message is unchanged.
-- Keep the first response as the durable idempotency result and use the
-- current Inbox cursor only to prove that historical cursor snapshots are
-- valid; never write a receipt cursor back into Inbox state.
CREATE TEMP TABLE migration_0019_agent_ack_receipt_snapshots
ON COMMIT DROP
AS
WITH candidates AS (
  SELECT
    receipt.receipt_id,
    receipt.response,
    receipt.resource_kind,
    receipt.resource_id,
    agent.agent_id,
    cursor.acked_sequence AS current_acked_sequence,
    cursor.next_sequence AS current_next_sequence,
    receipt.response->>'ackedSequence' AS acked_sequence_text,
    receipt.response->>'nextSequence' AS next_sequence_text,
    receipt.response->>'sequence' AS message_sequence_text
  FROM migration_0019_agent_receipt_targets AS target
  JOIN sciforge_collaboration.receipts AS receipt
    ON receipt.receipt_id = target.receipt_id
  JOIN sciforge_collaboration.agent_nodes AS agent
    ON target.target_actor_key = 'agent:' || agent.agent_id
  LEFT JOIN sciforge_collaboration.inbox_cursors AS cursor
    ON cursor.recipient_kind = 'agent'
    AND cursor.recipient_id = agent.agent_id
  WHERE receipt.operation = 'inbox.ack'
), parsed AS (
  SELECT
    candidate.*,
    CASE
      WHEN candidate.acked_sequence_text ~ '^(0|[1-9][0-9]{0,15})$'
        THEN candidate.acked_sequence_text::numeric
    END AS acked_sequence,
    CASE
      WHEN candidate.next_sequence_text ~ '^(0|[1-9][0-9]{0,15})$'
        THEN candidate.next_sequence_text::numeric
    END AS next_sequence,
    CASE
      WHEN candidate.message_sequence_text ~ '^[1-9][0-9]{0,15}$'
        THEN candidate.message_sequence_text::numeric
    END AS message_sequence
  FROM candidates AS candidate
)
SELECT
  parsed.receipt_id,
  parsed.response - 'ackedSequence' - 'nextSequence' - 'acknowledgedAt'
    AS response_identity,
  parsed.acked_sequence,
  parsed.next_sequence,
  COALESCE(
    jsonb_typeof(parsed.response) = 'object'
    AND parsed.response->>'protocolVersion' = '1.0'
    AND parsed.response->>'type' = 'inbox.acked'
    AND jsonb_typeof(parsed.response->'ackedSequence') = 'number'
    AND jsonb_typeof(parsed.response->'nextSequence') = 'number'
    AND (
      NOT (parsed.response ? 'acknowledgedAt')
      OR (
        jsonb_typeof(parsed.response->'acknowledgedAt') = 'string'
        AND parsed.response->>'acknowledgedAt' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      )
    )
    AND parsed.acked_sequence BETWEEN 0 AND 9007199254740991
    AND parsed.next_sequence BETWEEN 1 AND 9007199254740991
    AND parsed.acked_sequence < parsed.next_sequence
    AND parsed.current_acked_sequence::numeric >= parsed.acked_sequence
    AND parsed.current_next_sequence::numeric >= parsed.next_sequence
    AND (
      (
        parsed.resource_kind = 'inbox'
        AND parsed.resource_id = parsed.agent_id
      )
      OR (
        parsed.resource_kind = 'inbox_message'
        AND parsed.response->>'inboxMessageId' = parsed.resource_id
      )
    )
    AND CASE
      WHEN parsed.response ? 'inboxMessageId' THEN
        jsonb_typeof(parsed.response->'inboxMessageId') = 'string'
        AND EXISTS (
          SELECT 1
          FROM sciforge_collaboration.inbox_messages AS message
          WHERE message.recipient_kind = 'agent'
            AND message.recipient_id = parsed.agent_id
            AND message.message_id = parsed.response->>'inboxMessageId'
            AND (
              NOT (parsed.response ? 'sequence')
              OR (
                jsonb_typeof(parsed.response->'sequence') = 'number'
                AND parsed.message_sequence BETWEEN 1 AND 9007199254740991
                AND message.sequence::numeric = parsed.message_sequence
              )
            )
        )
      ELSE NOT (parsed.response ? 'sequence')
    END,
    false
  ) AS valid_snapshot
FROM parsed;

-- A divergent request, resource identity, or non-cursor response field is an
-- integrity conflict that needs operator resolution, not an automatic rename
-- or a second compatibility path. Cursor pairs must also be comparable under
-- the Inbox's monotonic (ackedSequence, nextSequence) progression.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM migration_0019_agent_receipt_targets AS left_target
    JOIN sciforge_collaboration.receipts AS left_receipt
      ON left_receipt.receipt_id = left_target.receipt_id
    JOIN migration_0019_agent_receipt_targets AS right_target
      ON right_target.target_actor_key = left_target.target_actor_key
      AND right_target.receipt_id > left_target.receipt_id
    JOIN sciforge_collaboration.receipts AS right_receipt
      ON right_receipt.receipt_id = right_target.receipt_id
      AND right_receipt.idempotency_key = left_receipt.idempotency_key
    LEFT JOIN migration_0019_agent_ack_receipt_snapshots AS left_ack
      ON left_ack.receipt_id = left_receipt.receipt_id
    LEFT JOIN migration_0019_agent_ack_receipt_snapshots AS right_ack
      ON right_ack.receipt_id = right_receipt.receipt_id
    WHERE left_receipt.request_digest IS DISTINCT FROM right_receipt.request_digest
      OR left_receipt.operation IS DISTINCT FROM right_receipt.operation
      OR left_receipt.resource_kind IS DISTINCT FROM right_receipt.resource_kind
      OR left_receipt.resource_id IS DISTINCT FROM right_receipt.resource_id
      OR (
        left_receipt.response IS DISTINCT FROM right_receipt.response
        AND NOT COALESCE(
          left_receipt.operation = 'inbox.ack'
          AND left_ack.valid_snapshot
          AND right_ack.valid_snapshot
          AND left_ack.response_identity IS NOT DISTINCT FROM right_ack.response_identity
          AND (
            (
              left_ack.acked_sequence <= right_ack.acked_sequence
              AND left_ack.next_sequence <= right_ack.next_sequence
            )
            OR (
              right_ack.acked_sequence <= left_ack.acked_sequence
              AND right_ack.next_sequence <= left_ack.next_sequence
            )
          ),
          false
        )
      )
  ) THEN
    RAISE EXCEPTION 'migration_0019_agent_receipt_idempotency_conflict';
  END IF;
END
$$;

CREATE TEMP TABLE migration_0019_agent_receipt_winners
ON COMMIT DROP
AS
SELECT DISTINCT ON (target.target_actor_key, receipt.idempotency_key)
  target.target_actor_key,
  receipt.idempotency_key,
  receipt.receipt_id,
  max(receipt.expires_at) OVER (
    PARTITION BY target.target_actor_key, receipt.idempotency_key
  ) AS merged_expires_at
FROM migration_0019_agent_receipt_targets AS target
JOIN sciforge_collaboration.receipts AS receipt
  ON receipt.receipt_id = target.receipt_id
ORDER BY
  target.target_actor_key,
  receipt.idempotency_key,
  receipt.created_at,
  receipt.receipt_id;

DELETE FROM sciforge_collaboration.receipts AS receipt
USING
  migration_0019_agent_receipt_targets AS target,
  migration_0019_agent_receipt_winners AS winner
WHERE receipt.receipt_id = target.receipt_id
  AND winner.target_actor_key = target.target_actor_key
  AND winner.idempotency_key = receipt.idempotency_key
  AND winner.receipt_id <> receipt.receipt_id;

UPDATE sciforge_collaboration.receipts AS receipt
SET
  actor_key = winner.target_actor_key,
  expires_at = winner.merged_expires_at
FROM migration_0019_agent_receipt_winners AS winner
WHERE receipt.receipt_id = winner.receipt_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.receipts AS receipt
    WHERE receipt.actor_key LIKE 'agent:%'
      AND NOT EXISTS (
        SELECT 1
        FROM sciforge_collaboration.agent_nodes AS agent
        WHERE receipt.actor_key = 'agent:' || agent.agent_id
      )
  ) THEN
    RAISE EXCEPTION 'migration_0019_failed_agent_receipt_actor_upgrade';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.task_authorities
  DROP CONSTRAINT task_authorities_reason_check,
  ADD CONSTRAINT task_authorities_reason_check CHECK (reason IN (
    'project_paused', 'project_terminal', 'invitation_pending', 'membership_pending',
    'membership_removal_pending', 'membership_removed', 'content_identity_missing',
    'content_not_ready', 'content_binding_degraded'
  ));

ALTER TABLE sciforge_collaboration.task_offers
  DROP CONSTRAINT task_offers_v16_state_check,
  DROP CONSTRAINT task_offers_v16_claim_shape,
  ADD COLUMN reassignment_task_revision bigint
    CHECK (reassignment_task_revision >= 1),
  ADD CONSTRAINT task_offers_v19_state_check CHECK (
    state IN ('pending', 'accepted', 'rejected', 'withdrawn', 'timed_out')
  ),
  ADD CONSTRAINT task_offers_v19_claim_shape CHECK (
    (state = 'pending' AND execution_id IS NULL AND responded_at IS NULL)
    OR (state = 'accepted' AND execution_id IS NOT NULL AND responded_at IS NOT NULL)
    OR (state IN ('rejected', 'withdrawn', 'timed_out')
      AND execution_id IS NULL AND responded_at IS NOT NULL)
  ),
  ADD CONSTRAINT task_offers_v19_reassignment_revision_shape CHECK (
    reassignment_task_revision IS NULL
    OR (
      state IN ('rejected', 'withdrawn', 'timed_out')
      AND execution_id IS NULL
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.tasks AS task
    WHERE task.status = 'revision_requested'
      AND task.current_execution_id IS NULL
      AND (
        SELECT count(*)
        FROM sciforge_collaboration.task_offers AS offer
        WHERE offer.task_id = task.task_id
          AND offer.execution_id IS NULL
          AND offer.state IN ('withdrawn', 'timed_out')
          AND offer.updated_at = task.updated_at
      ) <> 1
  ) THEN
    RAISE EXCEPTION 'migration_0019_requires_unique_current_terminal_task_offer';
  END IF;
END
$$;

UPDATE sciforge_collaboration.task_offers AS offer
SET reassignment_task_revision = task.revision
FROM sciforge_collaboration.tasks AS task
WHERE task.task_id = offer.task_id
  AND task.status = 'revision_requested'
  AND task.current_execution_id IS NULL
  AND offer.execution_id IS NULL
  AND offer.state IN ('withdrawn', 'timed_out')
  AND offer.updated_at = task.updated_at;

CREATE UNIQUE INDEX task_offers_reassignment_task_revision_unique
  ON sciforge_collaboration.task_offers(task_id, reassignment_task_revision)
  WHERE reassignment_task_revision IS NOT NULL;

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (19);

COMMIT;
