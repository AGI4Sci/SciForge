BEGIN;

CREATE TABLE IF NOT EXISTS sciforge_collaboration.resource_refs (
  resource_ref_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES sciforge_collaboration.projects(project_id) ON DELETE CASCADE,
  task_id text REFERENCES sciforge_collaboration.tasks(task_id),
  task_revision bigint,
  created_by_user_id text NOT NULL REFERENCES sciforge_collaboration.user_principals(user_id),
  created_by_agent_id text REFERENCES sciforge_collaboration.agent_nodes(agent_id),
  provider text NOT NULL CONSTRAINT resource_refs_provider_format
    CHECK (provider ~ '^[a-z][a-z0-9.-]{0,63}$'),
  external_id text NOT NULL CONSTRAINT resource_refs_external_id_safe CHECK (
    char_length(external_id) BETWEEN 1 AND 512
    AND external_id !~ '[[:cntrl:]]'
    AND external_id !~* '^(file:|/|~[\\/]|[a-z]:[\\/]|\\\\)'
    AND lower(external_id) !~ '(^|[?&#;,[:space:]])(authorization|credential|password|passphrase|secret|signature|sig|token|api[_-]?key|private[_-]?key|access[_-]?key)[[:space:]]*(=|:)[^[:space:]&#;,]+'
    AND external_id !~* '(^|[^a-z0-9])(bearer|basic)[[:space:]]+[a-z0-9._~+/=-]{6,}'
    AND external_id !~* '-----begin [a-z0-9 ]*private key-----'
    AND external_id !~* '[a-z][a-z0-9+.-]*://[^[:space:]/:]+:[^[:space:]@]+@'
  ),
  kind text NOT NULL CONSTRAINT resource_refs_kind_format
    CHECK (kind ~ '^[a-z][a-z0-9._-]{0,127}$'),
  name text NOT NULL CONSTRAINT resource_refs_name_safe CHECK (
    char_length(name) BETWEEN 1 AND 200
    AND name !~ '[[:cntrl:]]'
    AND lower(name) !~ '(^|[?&#;,[:space:]])(authorization|credential|password|passphrase|secret|signature|sig|token|api[_-]?key|private[_-]?key|access[_-]?key)[[:space:]]*(=|:)[^[:space:]&#;,]+'
    AND name !~* '(^|[^a-z0-9])(bearer|basic)[[:space:]]+[a-z0-9._~+/=-]{6,}'
    AND name !~* '-----begin [a-z0-9 ]*private key-----'
    AND name !~* '[a-z][a-z0-9+.-]*://[^[:space:]/:]+:[^[:space:]@]+@'
  ),
  open_url text NOT NULL CONSTRAINT resource_refs_open_url_safe CHECK (
    char_length(open_url) BETWEEN 1 AND 2048
    AND open_url ~* '^https://[^/?#@[:space:]]+([/?]|$)'
    AND open_url !~* '^https://[^/?#]*@'
    AND position('#' in open_url) = 0
    AND open_url !~ '[[:cntrl:]]'
    AND lower(open_url) !~ '(^|[?&]|%3f|%26)(s|%73)(i|%69)(g|%67)(=|%3d)'
    AND lower(open_url) !~ '(^|[?&])(authorization|credential|password|passphrase|secret|signature|token|api[_-]?key|private[_-]?key|access[_-]?key)='
    AND lower(open_url) !~ '(^|[?&#;,[:space:]])(authorization|credential|password|passphrase|secret|signature|sig|token|api[_-]?key|private[_-]?key|access[_-]?key)[[:space:]]*(=|:)[^[:space:]&#;,]+'
    AND open_url !~* '(^|[^a-z0-9])(bearer|basic)[[:space:]]+[a-z0-9._~+/=-]{6,}'
    AND open_url !~* '-----begin [a-z0-9 ]*private key-----'
  ),
  provider_version text CONSTRAINT resource_refs_provider_version_safe CHECK (
    provider_version IS NULL OR (
      char_length(provider_version) BETWEEN 1 AND 200
      AND provider_version !~ '[[:cntrl:]]'
      AND lower(provider_version) !~ '(^|[?&#;,[:space:]])(authorization|credential|password|passphrase|secret|signature|sig|token|api[_-]?key|private[_-]?key|access[_-]?key)[[:space:]]*(=|:)[^[:space:]&#;,]+'
      AND provider_version !~* '(^|[^a-z0-9])(bearer|basic)[[:space:]]+[a-z0-9._~+/=-]{6,}'
      AND provider_version !~* '-----begin [a-z0-9 ]*private key-----'
      AND provider_version !~* '[a-z][a-z0-9+.-]*://[^[:space:]/:]+:[^[:space:]@]+@'
    )
  ),
  status text NOT NULL CONSTRAINT resource_refs_status_valid
    CHECK (status IN ('available', 'invalidated')),
  invalidated_at timestamptz,
  revision bigint NOT NULL CONSTRAINT resource_refs_revision_valid CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT resource_refs_provenance_complete CHECK (
    (task_id IS NULL) = (task_revision IS NULL)
    AND (task_revision IS NULL OR task_revision >= 1)
  ),
  CONSTRAINT resource_refs_status_timestamp_consistent
    CHECK ((status = 'invalidated') = (invalidated_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS resource_refs_project_task
  ON sciforge_collaboration.resource_refs(project_id, task_id, status);

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (2)
ON CONFLICT (version) DO NOTHING;

COMMIT;
