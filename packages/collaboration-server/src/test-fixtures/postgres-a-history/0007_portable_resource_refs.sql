BEGIN;

ALTER TABLE sciforge_collaboration.resource_refs
  ADD COLUMN IF NOT EXISTS portable_reference text;

ALTER TABLE sciforge_collaboration.resource_refs
  ALTER COLUMN open_url DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS resource_refs_open_url_safe,
  DROP CONSTRAINT IF EXISTS resource_refs_portable_reference_safe;

ALTER TABLE sciforge_collaboration.resource_refs
  ADD CONSTRAINT resource_refs_open_url_safe CHECK (
    open_url IS NULL OR (
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
    )
  ),
  ADD CONSTRAINT resource_refs_portable_reference_safe CHECK (
    (
      kind IN (
        'content-space.file-reference',
        'content-space.container-reference',
        'content-space.artifact-reference'
      )
    ) = (portable_reference IS NOT NULL)
    AND (
      portable_reference IS NULL OR (
        octet_length(portable_reference) <= 8192
        AND jsonb_typeof(portable_reference::jsonb) = 'object'
        AND portable_reference::jsonb ?& ARRAY['authority', 'contractVersion', 'identity', 'kind']
        AND portable_reference::jsonb - ARRAY['authority', 'contractVersion', 'identity', 'kind'] = '{}'::jsonb
        AND portable_reference::jsonb ->> 'contractVersion' = '1'
        AND jsonb_typeof(portable_reference::jsonb -> 'identity') = 'object'
        AND portable_reference::jsonb ->> 'kind' = kind
      )
    )
  );

INSERT INTO sciforge_collaboration.schema_migrations(version)
VALUES (7)
ON CONFLICT (version) DO NOTHING;

COMMIT;
