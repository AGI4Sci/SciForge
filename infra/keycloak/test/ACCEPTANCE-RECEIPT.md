# SciForge Keycloak test acceptance receipt

- Recorded: 2026-08-21 CST
- Environment: `a-https-oidc-test` (test only)
- Keycloak release: `kc-26.7.0-oidc-r1-20260820`
- A live edge/identity release: `7ad6d48c3bd4c6eba23c90dda370c912e6950f49`

## Result

1. **READY** - Keycloak 26.7.0 runs `start --optimized` from a digest-pinned official base; PostgreSQL is digest pinned.
2. **READY** - Public hostname is fixed to `https://login-test.sciforge.cn`; proxy mode is `xforwarded`, trusted proxy is limited to the approved A-edge endpoint, and hostname strictness is not disabled.
3. **READY** - The A edge reaches only Keycloak through `sciforge-keycloak_identity-edge` at fixed alias `keycloak:8080`. PostgreSQL is absent from that network and exists only on `sciforge-keycloak_identity-internal` (`internal=true`).
4. **READY** - Keycloak and PostgreSQL are healthy. Ports 8080, 9000, and 5432 are not host published.
5. **READY** - Trusted public HTTPS Discovery returned HTTP 200 with exact issuer `https://login-test.sciforge.cn/realms/SciForge`; authorization, token, and JWKS endpoints are same-origin HTTPS.
6. **READY** - TLS SAN contains `login-test.sciforge.cn`; certificate issuer and validity are recorded in `release.json`.
7. **READY** - JWKS contains a unique non-empty signing `kid`, RSA is at least 2048 bits, and Access Tokens use RS256.
8. **READY** - The authorized live mapper change left exactly one direct `AUTH_TIME -> nbf` long mapper on each interactive client and none on `sciforge-cloud-api`.
9. **READY** - Two fresh Desktop PKCE Tokens passed signature and non-disclosing gates for `iss`, `sub`, `aud`, `azp`, `exp`, `nbf`, `iat`, and `auth_time`; all NumericDates were integers with valid ordering. Audience and Desktop authorized party matched the frozen contract.
10. **READY** - Both protected accounts passed real Desktop PKCE, `/v1/me`, JIT User, and distinct ACTIVE Device checks. Reusing one installation across owners was safely rejected.
11. **READY** - Controlled restart returned Keycloak to healthy in 32 seconds. Realm, clients, mappers, users, Discovery, and JWKS persisted.
12. **READY** - Pre-change PostgreSQL backup exists with SHA-256 `1d0859cec719d1ae9a11e3950960fd626683a9280faa0eda0239314d667e63b2`; isolated restore and contract-count comparison passed, and temporary resources were removed.

## Immutable/public facts

- Keycloak base: `quay.io/keycloak/keycloak@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13`.
- Recorded optimized image ID: `sha256:9d3a3537cec0553cf96b2d9e8bf3737e9d1bcc4ce8dcd9f36855e0c9507ed921`.
- PostgreSQL: `postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94`.
- Recorded deployed Compose SHA-256: `0dfdf4b4d89ac90d9b2a9d1dd089f637778590f9e90980d1b4f50a386ccea437`.
- Recorded deployed Containerfile SHA-256: `f0f691e6f473663dd5050a02a5e18746685c4bce4aa5bf96f83f1be673e51142`.
- Repository-normalized delivery file hashes: `SHA256SUMS`.
- Backup: `preopt-20260820T095503Z/keycloak-postgresql-17.6.dump`.
- Discovery: `https://login-test.sciforge.cn/realms/SciForge/.well-known/openid-configuration`.
- JWKS: `https://login-test.sciforge.cn/realms/SciForge/protocol/openid-connect/certs`.

## Evidence boundary and follow-up

The fixed HTTPS issuer and joint User-to-Device path passed. Packaged Desktop logout immediately became signed out locally, but remote Refresh Token revocation/end-session completion was not independently proven and remains a separate residual item. Dedicated test-account passwords previously exposed in chat must be rotated by the Keycloak account custodian before later shared use; neither old nor replacement passwords are recorded here.

This receipt contains no Token, authorization response, password, administrator credential, client secret, realm export, database password, private key, user ID, or device ID.
