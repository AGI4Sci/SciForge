-- Task Executions begin only after an eligible Device Agent wins a User Offer.
-- Delete pre-claim pseudo executions, preserve the Offer as the audit fact, and
-- retain the exact Coordinator Agent that authored every immutable Offer.

BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;

DO $$
DECLARE
  current_version bigint;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 16 THEN
    RAISE EXCEPTION 'migration_0017_requires_v16';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.task_offers
  ADD COLUMN offered_by_coordinator_agent_id text
    REFERENCES sciforge_collaboration.agent_nodes(agent_id);

-- v16-native Offers have an accepted audit event with the exact Agent actor.
-- Older Offers retain the same provenance on their pre-claim execution row.
UPDATE sciforge_collaboration.task_offers AS offer
SET offered_by_coordinator_agent_id = COALESCE(
  (
    SELECT audit.actor_agent_id
    FROM sciforge_collaboration.audit_events AS audit
    WHERE audit.resource_kind = 'task_offer'
      AND audit.resource_id = offer.task_offer_id
      AND audit.action IN ('task.offer.create', 'task.offer.reassign', 'task.result.review')
      AND audit.outcome = 'accepted'
      AND audit.actor_agent_id IS NOT NULL
    ORDER BY audit.created_at DESC, audit.audit_event_id DESC
    LIMIT 1
  ),
  (
    SELECT execution.offered_by_coordinator_agent_id
    FROM sciforge_collaboration.task_executions AS execution
    WHERE execution.execution_id = offer.execution_id
    LIMIT 1
  ),
  (
    SELECT execution.offered_by_coordinator_agent_id
    FROM sciforge_collaboration.task_executions AS execution
    WHERE execution.task_id = offer.task_id
      AND execution.offered_at = offer.offered_at
    ORDER BY execution.attempt DESC, execution.execution_id DESC
    LIMIT 1
  )
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sciforge_collaboration.task_offers
    WHERE offered_by_coordinator_agent_id IS NULL
  ) THEN
    RAISE EXCEPTION 'migration_0017_missing_task_offer_coordinator_provenance';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.task_offers
  ALTER COLUMN offered_by_coordinator_agent_id SET NOT NULL;

-- Inbox rows are delivery state, not audit state. Retired exact-Agent offer
-- messages cannot pass the current strict Inbox contract and must not poison a
-- recipient page after upgrade.
DELETE FROM sciforge_collaboration.inbox_messages
WHERE message_type IN (
  'task.offer.created',
  'task.offer.rejected',
  'task.offer.withdrawn',
  'task.offer.accepted'
);

CREATE TEMP TABLE retired_preclaim_task_executions
ON COMMIT DROP
AS
SELECT execution_id, task_id
FROM sciforge_collaboration.task_executions
WHERE accepted_at IS NULL;

-- The v16 projection constraint requires every terminal Task to retain a
-- current Execution. Drop it before retiring pre-claim rows; the stricter v17
-- projection is installed again after the canonical state has been rebuilt.
ALTER TABLE sciforge_collaboration.tasks
  DROP CONSTRAINT IF EXISTS tasks_current_execution_state_check,
  DROP CONSTRAINT IF EXISTS tasks_execution_projection_check;

ALTER TABLE sciforge_collaboration.task_executions
  DROP CONSTRAINT IF EXISTS task_executions_task_attempt_unique,
  DROP CONSTRAINT IF EXISTS task_executions_attempt_check;

-- A never-claimed execution cannot remain the Task's current execution. Keep
-- an existing terminal Task state; otherwise make the Task reassignable.
UPDATE sciforge_collaboration.tasks AS task
SET current_execution_id = NULL,
    current_execution_state = NULL,
    status = CASE
      WHEN task.status IN ('completed', 'failed', 'cancelled') THEN task.status
      ELSE 'revision_requested'
    END,
    revision = task.revision + 1,
    updated_at = CURRENT_TIMESTAMP
FROM retired_preclaim_task_executions AS retired
WHERE task.current_execution_id = retired.execution_id;

-- Pre-claim rows cannot have produced human decisions, external effects, or
-- results. Fail closed rather than deleting any such contradictory evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sciforge_collaboration.task_offers AS offer
    JOIN retired_preclaim_task_executions AS retired
      ON retired.execution_id = offer.execution_id
  ) OR EXISTS (
    SELECT 1 FROM sciforge_collaboration.human_requests AS request
    JOIN retired_preclaim_task_executions AS retired
      ON retired.execution_id = request.execution_id
  ) OR EXISTS (
    SELECT 1 FROM sciforge_collaboration.human_answers AS answer
    JOIN retired_preclaim_task_executions AS retired
      ON retired.execution_id = answer.execution_id
  ) OR EXISTS (
    SELECT 1 FROM sciforge_collaboration.external_operation_journal AS journal
    JOIN retired_preclaim_task_executions AS retired
      ON retired.execution_id = journal.execution_id
  ) OR EXISTS (
    SELECT 1 FROM sciforge_collaboration.visible_recovery_actions AS recovery
    JOIN retired_preclaim_task_executions AS retired
      ON retired.execution_id = recovery.execution_id
  ) OR EXISTS (
    SELECT 1 FROM sciforge_collaboration.task_result_submissions AS submission
    JOIN retired_preclaim_task_executions AS retired
      ON retired.execution_id = submission.execution_id
  ) OR EXISTS (
    SELECT 1 FROM sciforge_collaboration.task_result_reviews AS review
    JOIN retired_preclaim_task_executions AS retired
      ON retired.execution_id = review.execution_id
  ) THEN
    RAISE EXCEPTION 'migration_0017_preclaim_execution_has_effect_evidence';
  END IF;
END
$$;

DELETE FROM sciforge_collaboration.task_resource_refs AS resource
USING retired_preclaim_task_executions AS retired
WHERE resource.execution_id = retired.execution_id;

DELETE FROM sciforge_collaboration.task_executions AS execution
USING retired_preclaim_task_executions AS retired
WHERE execution.execution_id = retired.execution_id;

-- Retired pre-claim rows do not consume retry attempts. Re-number the claimed
-- immutable attempts in their original order before recomputing the count.
WITH ranked AS (
  SELECT
    execution.execution_id,
    row_number() OVER (
      PARTITION BY execution.task_id
      ORDER BY execution.attempt, execution.created_at, execution.execution_id
    )::integer AS attempt
  FROM sciforge_collaboration.task_executions AS execution
  WHERE execution.task_id IN (
    SELECT DISTINCT task_id FROM retired_preclaim_task_executions
  )
)
UPDATE sciforge_collaboration.task_executions AS execution
SET attempt = ranked.attempt
FROM ranked
WHERE execution.execution_id = ranked.execution_id;

-- execution_count now counts claimed immutable attempts only.
UPDATE sciforge_collaboration.tasks AS task
SET execution_count = counted.execution_count,
    revision = task.revision + 1,
    updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT retired.task_id, count(execution.execution_id)::integer AS execution_count
  FROM (SELECT DISTINCT task_id FROM retired_preclaim_task_executions) AS retired
  LEFT JOIN sciforge_collaboration.task_executions AS execution
    ON execution.task_id = retired.task_id
  GROUP BY retired.task_id
) AS counted
WHERE task.task_id = counted.task_id
  AND task.execution_count IS DISTINCT FROM counted.execution_count;

ALTER TABLE sciforge_collaboration.tasks
  ADD CONSTRAINT tasks_current_execution_state_check CHECK (
    current_execution_state IN (
      'accepted', 'running', 'needs_human', 'result_submitted',
      'manual_recovery_required', 'completed', 'failed', 'cancelled',
      'revoked', 'superseded'
    )
  ),
  ADD CONSTRAINT tasks_execution_projection_check CHECK (
    (current_execution_id IS NULL) = (current_execution_state IS NULL)
    AND (status <> 'planned' OR (current_execution_id IS NULL AND execution_count = 0))
    AND (status <> 'offered' OR current_execution_id IS NULL)
    AND (
      status IN ('planned', 'offered', 'revision_requested', 'cancelled')
      OR current_execution_id IS NOT NULL
    )
  );

ALTER TABLE sciforge_collaboration.task_executions
  DROP CONSTRAINT IF EXISTS task_executions_state_check,
  DROP CONSTRAINT IF EXISTS task_executions_acceptance_shape,
  DROP CONSTRAINT IF EXISTS task_executions_start_shape,
  DROP CONSTRAINT IF EXISTS task_executions_terminal_fence,
  ALTER COLUMN accepted_at SET NOT NULL,
  ADD CONSTRAINT task_executions_attempt_check CHECK (attempt BETWEEN 1 AND 101),
  ADD CONSTRAINT task_executions_task_attempt_unique UNIQUE (task_id, attempt),
  ADD CONSTRAINT task_executions_state_check CHECK (state IN (
    'accepted', 'running', 'needs_human', 'result_submitted',
    'manual_recovery_required', 'completed', 'failed', 'cancelled',
    'revoked', 'superseded'
  )),
  ADD CONSTRAINT task_executions_start_shape CHECK (
    (state IN ('running', 'needs_human', 'result_submitted',
      'manual_recovery_required', 'completed') AND started_at IS NOT NULL)
    OR (state = 'accepted' AND started_at IS NULL)
    OR state IN ('failed', 'cancelled', 'revoked', 'superseded')
  ),
  ADD CONSTRAINT task_executions_terminal_fence CHECK (
    (state IN ('result_submitted', 'manual_recovery_required', 'completed',
      'failed', 'cancelled', 'revoked', 'superseded')
      AND terminal_at IS NOT NULL AND fence ->> 'status' = 'fenced')
    OR (state IN ('accepted', 'running', 'needs_human')
      AND terminal_at IS NULL AND fence ->> 'status' = 'open')
  );

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (17);

COMMIT;
