BEGIN;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.remote_capability_approvals (
  remote_approval_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  agent_id text NOT NULL REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  projection_id text NOT NULL REFERENCES sciforge_collaboration.remote_session_projections(projection_id),
  locator jsonb NOT NULL,
  locator_revision bigint NOT NULL CHECK (locator_revision > 0),
  runtime_id text NOT NULL,
  thread_id text NOT NULL,
  turn_id text NOT NULL,
  capability_request_id text NOT NULL,
  desktop_approval_id text NOT NULL,
  reference_digest text NOT NULL UNIQUE CHECK (reference_digest ~ '^[a-f0-9]{64}$'),
  safe_summary text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('workspace-write', 'external-write', 'destructive')),
  remote_eligible boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN (
    'pending', 'approved', 'denied', 'expired', 'superseded',
    'desktop_only', 'delivery_pending', 'completed'
  )),
  provider_card_message_id text,
  decision_event_id text UNIQUE,
  decision_id text UNIQUE,
  revision bigint NOT NULL CHECK (revision > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (agent_id, desktop_approval_id),
  UNIQUE (projection_id, runtime_id, thread_id, turn_id, capability_request_id)
);

CREATE INDEX IF NOT EXISTS remote_capability_approvals_pending_idx
  ON sciforge_collaboration.remote_capability_approvals(status, expires_at)
  WHERE status IN ('pending', 'delivery_pending');

CREATE UNIQUE INDEX IF NOT EXISTS remote_capability_approvals_card_ref_unique
  ON sciforge_collaboration.remote_capability_approvals(
    (locator->>'provider'), (locator->>'realmId'), provider_card_message_id
  )
  WHERE provider_card_message_id IS NOT NULL;

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (4)
ON CONFLICT (version) DO NOTHING;

COMMIT;
