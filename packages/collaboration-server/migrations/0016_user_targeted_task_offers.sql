-- Task assignment is User-targeted. An immutable execution is created only
-- when one of that User's eligible Agent/Device runtimes wins the Cloud claim.

BEGIN;

LOCK TABLE sciforge_collaboration.schema_migrations IN EXCLUSIVE MODE;

DO $$
DECLARE
  current_version bigint;
BEGIN
  SELECT max(version) INTO current_version
  FROM sciforge_collaboration.schema_migrations;
  IF current_version IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'migration_0016_requires_v15';
  END IF;
END
$$;

ALTER TABLE sciforge_collaboration.tasks
  ADD COLUMN required_capability_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  DROP CONSTRAINT IF EXISTS tasks_execution_projection_check,
  ADD CONSTRAINT tasks_required_capability_tags_shape CHECK (
    jsonb_typeof(required_capability_tags) = 'array'
  );

-- Preserve the old exact-Agent pending attempts as fenced history. They can no
-- longer be accepted after this contract becomes active.
UPDATE sciforge_collaboration.task_executions AS execution
SET state = 'cancelled',
    state_revision = execution.state_revision + 1,
    fence = jsonb_set(
      jsonb_set(
        jsonb_set(execution.fence, '{status}', '"fenced"'::jsonb),
        '{reason}',
        '"offer_withdrawn"'::jsonb
      ),
      '{fencedAt}',
      to_jsonb(CURRENT_TIMESTAMP::text)
    ),
    terminal_at = CURRENT_TIMESTAMP,
    revision = execution.revision + 1,
    updated_at = CURRENT_TIMESTAMP
FROM sciforge_collaboration.task_offers AS offer
WHERE offer.execution_id = execution.execution_id
  AND offer.state = 'pending'
  AND execution.state = 'offered';

UPDATE sciforge_collaboration.tasks AS task
SET current_execution_id = NULL,
    current_execution_state = NULL,
    status = 'revision_requested',
    revision = task.revision + 1,
    updated_at = CURRENT_TIMESTAMP
FROM sciforge_collaboration.task_offers AS offer
WHERE offer.task_id = task.task_id
  AND offer.state = 'pending'
  AND task.current_execution_id = offer.execution_id;

ALTER TABLE sciforge_collaboration.tasks
  ADD CONSTRAINT tasks_execution_projection_check CHECK (
    (current_execution_id IS NULL) = (current_execution_state IS NULL)
    AND (status <> 'planned' OR (current_execution_id IS NULL AND execution_count = 0))
    AND (status <> 'offered' OR current_execution_id IS NULL)
    AND (
      status IN ('planned', 'offered', 'revision_requested')
      OR current_execution_id IS NOT NULL
    )
  );

ALTER TABLE sciforge_collaboration.task_result_reviews
  ADD COLUMN next_task_offer_id text;

UPDATE sciforge_collaboration.task_result_reviews AS review
SET next_task_offer_id = offer.task_offer_id
FROM sciforge_collaboration.task_offers AS offer
WHERE review.next_execution_id = offer.execution_id;

ALTER TABLE sciforge_collaboration.task_result_reviews
  DROP CONSTRAINT IF EXISTS task_result_reviews_decision_shape,
  DROP COLUMN next_execution_id;

DROP INDEX IF EXISTS sciforge_collaboration.task_offers_project_offer_id;

CREATE TABLE sciforge_collaboration.task_offers_v16 (
  task_offer_id text PRIMARY KEY,
  execution_id text UNIQUE
    REFERENCES sciforge_collaboration.task_executions(execution_id),
  task_id text NOT NULL REFERENCES sciforge_collaboration.tasks(task_id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  worker_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'withdrawn', 'timed_out')),
  offered_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT task_offers_v16_expiry CHECK (expires_at > offered_at),
  CONSTRAINT task_offers_v16_claim_shape CHECK (
    (state = 'pending' AND execution_id IS NULL AND responded_at IS NULL)
    OR (state = 'accepted' AND execution_id IS NOT NULL AND responded_at IS NOT NULL)
    OR (state IN ('withdrawn', 'timed_out') AND execution_id IS NULL AND responded_at IS NOT NULL)
  )
);

INSERT INTO sciforge_collaboration.task_offers_v16
  (task_offer_id,execution_id,task_id,project_id,worker_user_id,state,
   offered_at,expires_at,responded_at,revision,created_at,updated_at)
SELECT
  task_offer_id,
  CASE WHEN state = 'accepted' THEN execution_id ELSE NULL END,
  task_id,
  project_id,
  assignee_user_id,
  CASE
    WHEN state = 'accepted' THEN 'accepted'
    WHEN state = 'timed_out' THEN 'timed_out'
    ELSE 'withdrawn'
  END,
  offered_at,
  expires_at,
  CASE WHEN state = 'pending' THEN CURRENT_TIMESTAMP ELSE COALESCE(responded_at, updated_at) END,
  revision + CASE WHEN state = 'pending' THEN 1 ELSE 0 END,
  created_at,
  CASE WHEN state = 'pending' THEN CURRENT_TIMESTAMP ELSE updated_at END
FROM sciforge_collaboration.task_offers;

DROP TABLE sciforge_collaboration.task_offers;
ALTER TABLE sciforge_collaboration.task_offers_v16 RENAME TO task_offers;

CREATE INDEX task_offers_project_offer_id
  ON sciforge_collaboration.task_offers(project_id, task_offer_id);

ALTER TABLE sciforge_collaboration.task_result_reviews
  ADD CONSTRAINT task_result_reviews_next_offer_fk
    FOREIGN KEY (next_task_offer_id)
    REFERENCES sciforge_collaboration.task_offers(task_offer_id),
  ADD CONSTRAINT task_result_reviews_decision_shape CHECK (
    (decision = 'accept' AND instruction IS NULL
      AND accepted_project_record_id IS NOT NULL AND next_task_offer_id IS NULL)
    OR (decision = 'request_revision' AND instruction IS NOT NULL
      AND accepted_project_record_id IS NULL AND next_task_offer_id IS NOT NULL)
  );

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (16);

COMMIT;
