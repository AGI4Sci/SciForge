# SciForge shared HTTPS Keycloak test deployment

This directory is the non-secret, reviewable delivery source for the `a-https-oidc-test` Keycloak environment. Its fixed issuer is:

```text
https://login-test.sciforge.cn/realms/SciForge
```

The deployment was accepted as release `kc-26.7.0-oidc-r1-20260820`. The recorded A-side HTTPS edge release is commit `7ad6d48c3bd4c6eba23c90dda370c912e6950f49` on `hanhuiyang5-web/SciForge:feat/a-cloud-identity-e2e`.

## Ownership boundary

- A owns the single host-published TCP 443 edge for both `cloud-test.sciforge.cn` and `login-test.sciforge.cn`.
- The edge reaches Keycloak only through Docker network `sciforge-keycloak_identity-edge`, service alias `keycloak`, port `8080`.
- Keycloak PostgreSQL is attached only to `sciforge-keycloak_identity-internal`, which is `internal=true`.
- The edge must never join the database network. Keycloak and PostgreSQL publish no host ports.
- This repository records A's fixed edge commit and route contract; it does not duplicate or take ownership of A's Caddy configuration.

## Files

- `Containerfile`: digest-pinned, optimized Keycloak 26.7.0 build.
- `compose.yaml`: production-style test deployment with fixed hostname, trusted proxy address, health checks, resource limits, and network isolation.
- `realm-sciforge.json`: desired-state Realm template. It contains no users or secrets.
- `nbf-mapper.json`: the idempotent direct-client mapper payload used for the live PostgreSQL-backed Realm.
- `compose.restore.yaml`: isolated temporary restore database.
- `scripts/`: backup, isolated restore, restart health capture, HTTPS/JWKS/Token verification, and verifier tests.
- `release.json`: machine-readable, non-secret release facts and recorded runtime evidence.
- `RUNBOOK.md`: deployment, validation, recovery, and rollback procedure.
- `NBF-MAPPER-RUNBOOK.md`: live mapper procedure and recorded result.
- `ACCEPTANCE-RECEIPT.md`: non-secret acceptance result and evidence limits.
- `SHA256SUMS`: hashes for the delivery files in this directory.

`release.json.deployedArtifactSha256` preserves the hashes recorded for the files installed during the maintenance window. `SHA256SUMS` covers the repository copies after Git LF normalization. Keep both: the former identifies the deployed evidence, while the latter protects the current reviewable source.

## Security rules

Never commit or print administrator credentials, database passwords, client secrets, user passwords, Access Tokens, Refresh Tokens, authorization responses, database dumps, private keys, or realm exports containing users. Runtime secrets must come from a root-only environment file with mode `0600`. A fresh Access Token may be supplied to the verifier only through an absolute-path, owner-only `0600` regular file and must be deleted immediately after verification.

The live Realm is backed by PostgreSQL. Installing this template or restarting Keycloak does not update an existing Realm. Apply live mapper changes only through an authorized Admin Console/Admin REST session using the idempotent procedure in `NBF-MAPPER-RUNBOOK.md`; never edit the database directly.

Run the repository contract tests from the repository root:

```sh
npm run identity:keycloak:check
```
