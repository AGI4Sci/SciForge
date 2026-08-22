# Live Access Token `nbf` mapper

Recorded status: **EXECUTED AND VERIFIED** during the 2026-08-21 test acceptance. The procedure remains here for audit, idempotent repair, and rollback.

## Scope and semantics

- Realm: `SciForge`.
- Target clients only: `sciforge-desktop`, `sciforge-web-mobile`.
- Direct mapper name: `sciforge-access-token-not-before`.
- Mapper: `oidc-usersessionmodel-note-mapper`.
- Semantics: map the real user-session note `AUTH_TIME` to Access Token claim `nbf` as JSON `long`.
- Excluded: Realm import, Keycloak restart, direct database writes, script mappers, hardcoded values, static zero, client-secret changes, and user/password changes.

Keycloak 26.7.0 does not emit `nbf` by default. The frozen SciForge Cloud/Desktop contract requires it. Mapping `AUTH_TIME` produces a real NumericDate and preserves `nbf <= auth_time <= iat < exp` without inventing a constant.

The exact non-secret payload is `nbf-mapper.json`.

## Authorized idempotent procedure

For each target client, an authorized credential custodian uses a protected Admin Console or Admin REST session:

1. Resolve `GET /admin/realms/SciForge/clients?clientId=<client-id>&exact=true` and require exactly one result.
2. Save the complete current direct mapper response in a root-only change directory for rollback. Never publish that protected response or authentication material.
3. Select direct mappers whose name is `sciforge-access-token-not-before` or whose `config["claim.name"]` is `nbf`.
4. If there are zero matches, POST `nbf-mapper.json` and record the new mapper ID only in the protected change record.
5. If there is one exact match, do not write and record `ALREADY_CONFIGURED`.
6. If there is more than one match or a non-exact match, stop with `MAPPER_CONFLICT`; do not delete or replace anything.
7. Read the created/existing mapper by ID without a lossy field projection. Require all fields in `nbf-mapper.json` and allow only harmless server-added defaults.
8. Require exactly one matching mapper on each target client. Confirm `sciforge-cloud-api` has no direct `nbf` mapper and was not modified.

Do not place credentials, cookies, administrator Tokens, realm exports, or client secrets in shell history, logs, Git, or chat.

## Fresh-token gate

Old Tokens do not count. Both protected test accounts must complete new Desktop Authorization Code + PKCE S256 logins. Verify each new Access Token with `scripts/verify-edge-contract.sh` using a secure temporary file. Require:

- valid RS256/JWKS signature and non-empty `kid`;
- exact issuer;
- `aud` contains `sciforge-cloud-api`;
- Desktop `azp` is `sciforge-desktop`;
- `sub` exists;
- `exp`, `nbf`, `iat`, and `auth_time` are non-negative integers;
- `nbf <= auth_time <= iat < exp` and current-time checks pass;
- Desktop login, `/v1/me`, JIT User, and a distinct ACTIVE Device pass for both accounts.

Only boolean summaries may leave the protected verifier. Delete Token files immediately.

## Recorded outcome

The live PostgreSQL-backed Realm had zero direct `nbf` mappers before the authorized change. The exact mapper was added idempotently to both interactive clients and read back as exactly one per client. `sciforge-cloud-api` remained unchanged. Two fresh Desktop Tokens passed all strict claim/signature gates, and both accounts passed `/v1/me`, JIT, and distinct ACTIVE Device acceptance. No Realm import, Keycloak restart, or database edit was used.

## Mapper-only rollback

If a mapper created by a future maintenance operation fails readback or fresh-token acceptance, delete only that operation's recorded mapper ID through the Admin API. Read both clients again and compare their non-secret summaries to the protected pre-change backup. Do not restart Keycloak and do not restore or alter the database volume for this mapper-only rollback.
