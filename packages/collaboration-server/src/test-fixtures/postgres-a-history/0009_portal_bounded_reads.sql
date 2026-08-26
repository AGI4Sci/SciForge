BEGIN;

-- Freeze every relation used by the author reconstruction and Portal hard-cap
-- checks before the first validation snapshot. This prevents a membership,
-- record, HumanNeeded, ownership-transfer, or audit write from racing the
-- validation/backfill while still allowing the old application to serve reads.
LOCK TABLE
  sciforge_collaboration.user_principals,
  sciforge_collaboration.agent_nodes,
  sciforge_collaboration.projects,
  sciforge_collaboration.tasks,
  sciforge_collaboration.project_members,
  sciforge_collaboration.project_records,
  sciforge_collaboration.human_requests,
  sciforge_collaboration.audit_events
IN SHARE ROW EXCLUSIVE MODE;

-- A User-visible Project page is ordered by Project recency, so even an
-- indexed membership lookup must have a fixed input bound. Refuse to bless a
-- historical database that already exceeds the canonical per-User active
-- membership cap; canonical writes serialize and enforce the same limit.
DO $$
BEGIN
  IF EXISTS (
    SELECT member.user_id
    FROM sciforge_collaboration.project_members AS member
    WHERE member.active = true
    GROUP BY member.user_id
    HAVING count(*) > 1000
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0009_active_project_membership_limit_exceeded';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT record.project_id
    FROM sciforge_collaboration.project_records AS record
    GROUP BY record.project_id
    HAVING count(*) > 50000
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0009_project_record_limit_exceeded';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT request.project_id
    FROM sciforge_collaboration.human_requests AS request
    GROUP BY request.project_id
    HAVING count(*) > 10000
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0009_human_needed_limit_exceeded';
  END IF;
END $$;

-- Schema v4 materialized legacy completed-Task results with only the
-- assignee Agent as author. Agent ownership transfer cascades into historical
-- Task assignee_user_id, so the first accepted transfer strictly after the
-- record is the durable evidence of the owner at record creation. Existing
-- non-null authors are immutable history and are never inspected or changed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_records AS record
    LEFT JOIN sciforge_collaboration.agent_nodes AS agent
      ON agent.agent_id = record.author_agent_id
    LEFT JOIN sciforge_collaboration.tasks AS task
      ON task.task_id = record.source_task_id
    WHERE record.author_user_id IS NULL
      AND (
        record.author_agent_id IS NULL
        OR agent.agent_id IS NULL
        OR (
          record.source_task_id IS NOT NULL
          AND (
            task.task_id IS NULL
            OR task.assignee_user_id IS NULL
            OR task.project_id IS DISTINCT FROM record.project_id
            OR record.author_agent_id IS DISTINCT FROM task.assignee_agent_id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0009_project_record_author_source_invalid';
  END IF;
END $$;

-- A transfer at the exact record timestamp has no provable ordering. Transfer
-- audit rows are written by User actors in the same transaction as the owner
-- change, so any malformed identity/resource shape is also unsafe evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_records AS record
    JOIN sciforge_collaboration.audit_events AS transfer
      ON transfer.action = 'agent.owner.transfer'
     AND transfer.outcome = 'accepted'
     AND transfer.resource_id = record.author_agent_id
     AND transfer.created_at >= record.created_at
    LEFT JOIN sciforge_collaboration.user_principals AS transfer_actor
      ON transfer_actor.user_id = transfer.actor_user_id
    WHERE record.author_user_id IS NULL
      AND (
        transfer.created_at = record.created_at
        OR transfer.resource_kind IS DISTINCT FROM 'agent'
        OR transfer.actor_kind IS DISTINCT FROM 'user'
        OR transfer.actor_user_id IS NULL
        OR transfer.actor_endpoint_id IS NOT NULL
        OR transfer.actor_agent_id IS NOT NULL
        OR transfer_actor.user_id IS NULL
        OR transfer_actor.created_at > transfer.created_at
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0009_project_record_author_transfer_invalid';
  END IF;
END $$;

-- Two accepted transfers at one later timestamp cannot be ordered from the
-- audit ledger, even though audit_event_id could provide a lexical tie-break.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_records AS record
    JOIN sciforge_collaboration.audit_events AS transfer
      ON transfer.action = 'agent.owner.transfer'
     AND transfer.outcome = 'accepted'
     AND transfer.resource_kind = 'agent'
     AND transfer.resource_id = record.author_agent_id
     AND transfer.created_at > record.created_at
    WHERE record.author_user_id IS NULL
    GROUP BY record.project_record_id, transfer.created_at
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0009_project_record_author_transfer_ambiguous';
  END IF;
END $$;

-- Without a later transfer, the current Agent owner is the owner at record
-- creation. A later transfer instead contributes its actor, which is the
-- owner immediately before that first transfer.
WITH recovered_authors AS (
  SELECT
    record.project_record_id,
    COALESCE(first_transfer.actor_user_id, agent.owner_user_id) AS author_user_id
  FROM sciforge_collaboration.project_records AS record
  JOIN sciforge_collaboration.agent_nodes AS agent
    ON agent.agent_id = record.author_agent_id
  LEFT JOIN LATERAL (
    SELECT transfer.actor_user_id
    FROM sciforge_collaboration.audit_events AS transfer
    WHERE transfer.action = 'agent.owner.transfer'
      AND transfer.outcome = 'accepted'
      AND transfer.resource_kind = 'agent'
      AND transfer.resource_id = record.author_agent_id
      AND transfer.created_at > record.created_at
    ORDER BY transfer.created_at ASC, transfer.audit_event_id ASC
    LIMIT 1
  ) AS first_transfer ON true
  WHERE record.author_user_id IS NULL
)
UPDATE sciforge_collaboration.project_records AS record
SET author_user_id = recovered.author_user_id
FROM recovered_authors AS recovered
WHERE record.project_record_id = recovered.project_record_id
  AND record.author_user_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sciforge_collaboration.project_records
    WHERE author_user_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'migration_0009_project_record_author_unresolved';
  END IF;
END $$;

ALTER TABLE sciforge_collaboration.project_records
  ALTER COLUMN author_user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_project_task_id_idx
  ON sciforge_collaboration.tasks(project_id, task_id);

CREATE INDEX IF NOT EXISTS project_records_project_record_id_idx
  ON sciforge_collaboration.project_records(project_id, project_record_id);

CREATE INDEX IF NOT EXISTS human_requests_project_target_request_id_idx
  ON sciforge_collaboration.human_requests(project_id, target_user_id, human_request_id);

CREATE INDEX IF NOT EXISTS human_answers_project_created_answer_idx
  ON sciforge_collaboration.human_answers(project_id, created_at, human_answer_id);

CREATE INDEX IF NOT EXISTS tasks_active_assignee_idx
  ON sciforge_collaboration.tasks(assignee_agent_id)
  WHERE status IN ('accepted', 'in_progress', 'needs_human');

CREATE INDEX IF NOT EXISTS oidc_identities_active_user_issuer_idx
  ON sciforge_collaboration.oidc_identities(user_id, issuer)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS project_members_active_user_project_idx
  ON sciforge_collaboration.project_members(user_id, project_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS project_members_active_project_user_idx
  ON sciforge_collaboration.project_members(project_id, user_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS project_records_candidate_task_result_project_idx
  ON sciforge_collaboration.project_records(project_id)
  WHERE kind = 'task_result' AND status = 'candidate';

CREATE INDEX IF NOT EXISTS agent_nodes_active_owner_agent_idx
  ON sciforge_collaboration.agent_nodes(owner_user_id, agent_id)
  WHERE status = 'active';

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (9)
ON CONFLICT (version) DO NOTHING;

COMMIT;
