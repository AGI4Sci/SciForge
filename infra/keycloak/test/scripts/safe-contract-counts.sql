\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT 'realm_count=' || count(*)
FROM realm
WHERE name = 'SciForge';

SELECT 'client_count=' || count(*)
FROM client c
JOIN realm r ON r.id = c.realm_id
WHERE r.name = 'SciForge'
  AND c.client_id IN (
    'sciforge-desktop',
    'sciforge-web-mobile',
    'sciforge-cloud-api'
  );

SELECT 'user_count=' || count(*)
FROM user_entity u
JOIN realm r ON r.id = u.realm_id
WHERE r.name = 'SciForge';

SELECT 'role_count=' || count(*)
FROM keycloak_role kr
JOIN realm r ON r.id = kr.realm_id
WHERE r.name = 'SciForge';

SELECT 'protected_user=' || u.username || '|enabled=' || u.enabled
FROM user_entity u
JOIN realm r ON r.id = u.realm_id
WHERE r.name = 'SciForge'
  AND u.username IN ('sciforge-test-orchestrator', 'sciforge-test-user')
ORDER BY u.username;

SELECT 'client=' || c.client_id
       || '|public=' || c.public_client
       || '|bearer_only=' || c.bearer_only
       || '|standard_flow=' || c.standard_flow_enabled
       || '|direct_grants=' || c.direct_access_grants_enabled
FROM client c
JOIN realm r ON r.id = c.realm_id
WHERE r.name = 'SciForge'
  AND c.client_id IN (
    'sciforge-desktop',
    'sciforge-web-mobile',
    'sciforge-cloud-api'
  )
ORDER BY c.client_id;

SELECT 'pkce_s256_count=' || count(*)
FROM client c
JOIN realm r ON r.id = c.realm_id
JOIN client_attributes ca ON ca.client_id = c.id
WHERE r.name = 'SciForge'
  AND c.client_id IN ('sciforge-desktop', 'sciforge-web-mobile')
  AND ca.name = 'pkce.code.challenge.method'
  AND ca.value = 'S256';

SELECT 'audience_mapper_count=' || count(DISTINCT pm.id)
FROM client c
JOIN realm r ON r.id = c.realm_id
JOIN protocol_mapper pm ON pm.client_id = c.id
WHERE r.name = 'SciForge'
  AND c.client_id IN ('sciforge-desktop', 'sciforge-web-mobile')
  AND pm.protocol_mapper_name = 'oidc-audience-mapper'
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'included.client.audience'
      AND pmc.value = 'sciforge-cloud-api'
  )
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'access.token.claim'
      AND pmc.value = 'true'
  );

SELECT 'nbf_mapper_count=' || count(DISTINCT pm.id)
FROM client c
JOIN realm r ON r.id = c.realm_id
JOIN protocol_mapper pm ON pm.client_id = c.id
WHERE r.name = 'SciForge'
  AND c.client_id IN ('sciforge-desktop', 'sciforge-web-mobile')
  AND pm.protocol_mapper_name = 'oidc-usersessionmodel-note-mapper'
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'user.session.note'
      AND pmc.value = 'AUTH_TIME'
  )
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'claim.name'
      AND pmc.value = 'nbf'
  )
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'jsonType.label'
      AND pmc.value = 'long'
  )
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'access.token.claim'
      AND pmc.value = 'true'
  );

SELECT 'auth_time_mapper_count=' || count(DISTINCT pm.id)
FROM client_scope cs
JOIN realm r ON r.id = cs.realm_id
JOIN protocol_mapper pm ON pm.client_scope_id = cs.id
WHERE r.name = 'SciForge'
  AND cs.name = 'basic'
  AND pm.protocol_mapper_name = 'oidc-usersessionmodel-note-mapper'
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'claim.name'
      AND pmc.value = 'auth_time'
  )
  AND EXISTS (
    SELECT 1
    FROM protocol_mapper_config pmc
    WHERE pmc.protocol_mapper_id = pm.id
      AND pmc.name = 'access.token.claim'
      AND pmc.value = 'true'
  );

SELECT 'access_token_lifespan=' || access_token_lifespan
       || '|registration_allowed=' || registration_allowed
       || '|ssl_required=' || ssl_required
FROM realm
WHERE name = 'SciForge';

SELECT 'default_signature_algorithm=' || ra.value
FROM realm_attribute ra
JOIN realm r ON r.id = ra.realm_id
WHERE r.name = 'SciForge'
  AND ra.name = 'defaultSignatureAlgorithm';
