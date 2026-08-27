BEGIN;

ALTER TABLE sciforge_collaboration.tasks
  ADD COLUMN IF NOT EXISTS progress_percent integer,
  ADD COLUMN IF NOT EXISTS progress_summary text,
  ADD COLUMN IF NOT EXISTS progress_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS safe_failure_code text;

-- failure_summary is a legacy free-text column. It is deliberately retained for
-- forensic compatibility, but it must never become a public machine-readable
-- error. Existing failed rows receive one fixed, non-sensitive code instead.
UPDATE sciforge_collaboration.tasks
SET safe_failure_code = 'task_failed'
WHERE status = 'failed'
  AND safe_failure_code IS NULL;

UPDATE sciforge_collaboration.tasks
SET result_summary = 'Legacy task completed before structured result capture.'
WHERE status = 'completed'
  AND (result_summary IS NULL OR char_length(btrim(result_summary)) = 0);

UPDATE sciforge_collaboration.tasks
SET result_summary = left(btrim(result_summary), 32000)
WHERE status = 'completed'
  AND result_summary IS NOT NULL;

UPDATE sciforge_collaboration.tasks
SET result_summary = NULL
WHERE status <> 'completed'
  AND result_summary IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_progress_percent_range'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_progress_percent_range CHECK (
        progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_progress_summary_length'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_progress_summary_length CHECK (
        progress_summary IS NULL OR char_length(progress_summary) BETWEEN 1 AND 2000
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_progress_complete'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_progress_complete CHECK (
        (progress_percent IS NULL AND progress_summary IS NULL AND progress_reported_at IS NULL)
        OR
        (progress_percent IS NOT NULL AND progress_summary IS NOT NULL AND progress_reported_at IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_result_summary_state'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_result_summary_state CHECK (
        (status = 'completed' AND result_summary IS NOT NULL
          AND result_summary = btrim(result_summary)
          AND char_length(result_summary) BETWEEN 1 AND 32000)
        OR
        (status <> 'completed' AND result_summary IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_safe_failure_code_format'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_safe_failure_code_format CHECK (
        safe_failure_code IS NULL OR safe_failure_code ~ '^[a-z][a-z0-9_.-]{0,63}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_safe_failure_code_state'
      AND conrelid = 'sciforge_collaboration.tasks'::regclass
  ) THEN
    ALTER TABLE sciforge_collaboration.tasks
      ADD CONSTRAINT tasks_safe_failure_code_state CHECK (
        (status = 'failed') = (safe_failure_code IS NOT NULL)
      );
  END IF;
END $$;

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (3)
ON CONFLICT (version) DO NOTHING;

COMMIT;
