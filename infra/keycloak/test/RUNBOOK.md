# Keycloak test deployment runbook

This runbook deploys or repairs only the SciForge Keycloak test stack. It does not deploy, replace, stop, or roll back A's HTTPS edge or SciForge Cloud.

## Fixed contract

- Environment: `a-https-oidc-test`, test only.
- Issuer: `https://login-test.sciforge.cn/realms/SciForge`.
- Desktop client: `sciforge-desktop`, public, Authorization Code + PKCE S256.
- Desktop redirect: `http://127.0.0.1:43110/oidc/callback`.
- Web/Mobile client: `sciforge-web-mobile`, public, Authorization Code + PKCE S256.
- Cloud audience: `sciforge-cloud-api`.
- Signature: RS256 with a non-empty, unique signing `kid` and RSA modulus of at least 2048 bits.
- Access Token NumericDates: integer `exp`, `nbf`, `iat`, and `auth_time` with valid ordering.
- Edge route: `sciforge-keycloak_identity-edge` -> `keycloak:8080`.
- Database network: `sciforge-keycloak_identity-internal`, `internal=true`.

## Preconditions

1. Confirm A remains the unique manager of host TCP 443. If another process or an unexpected edge owns 443, stop and coordinate; do not bind a second proxy.
2. Confirm TCP 80, 8080, 8443, 9000, and 5432 are not publicly allowed. This stack publishes none of them.
3. Confirm the root-only runtime environment file exists, is a regular non-symlink file owned by the deployment account, and has mode `0600`. It supplies only `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME`, and `KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD`.
4. Confirm the existing external data volume is `sciforge-keycloak_keycloak-db-data`. Never delete or replace it during an ordinary release.
5. Verify this directory before transfer or use:

   ```sh
   sha256sum -c SHA256SUMS
   ```

## Build the optimized image

Build from the pinned Keycloak base digest and preserve the release labels:

```sh
containerfile_sha=$(sha256sum Containerfile | awk '{print $1}')
docker build \
  --file Containerfile \
  --tag sciforge-keycloak-optimized:26.7.0-f0f691e6f473 \
  --build-arg SCIFORGE_BASE_DIGEST=sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13 \
  --build-arg SCIFORGE_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg SCIFORGE_CONTAINERFILE_SHA256="$containerfile_sha" \
  --build-arg SCIFORGE_RELEASE_ID=kc-26.7.0-oidc-r1-20260820 \
  .
```

Record the resulting immutable image ID in the protected deployment receipt. Do not replace the digest-pinned base with a mutable tag.

## Backup before a change

Create a UTC backup identifier, then run the backup script from this directory under the approved root wrapper:

```sh
backup_id="preopt-$(date -u +%Y%m%dT%H%M%SZ)"
./scripts/backup-db.sh "$backup_id"
```

The script writes a PostgreSQL custom-format dump, SHA-256, non-secret contract counts, image IDs, and a mode-`0600` receipt under the protected backup root. A valid backup must pass `pg_restore --list` before deployment continues.

## Deploy Keycloak and PostgreSQL

Validate Compose first, then deploy only the Keycloak project:

```sh
docker compose --env-file /root-only/path/keycloak.env --file compose.yaml config --quiet
docker compose --env-file /root-only/path/keycloak.env --file compose.yaml up --detach --wait --wait-timeout 240
```

Require both containers to be `healthy`. Confirm Keycloak runs `start --optimized`, its application alias is `keycloak` on the edge network, PostgreSQL is absent from that network, and the edge is absent from the internal database network.

The template Realm is desired-state and bootstrap documentation. Existing PostgreSQL-backed Realm configuration is not replaced by Compose or restart. For a live `nbf` change, follow `NBF-MAPPER-RUNBOOK.md` through an authorized Admin session.

## A edge handoff

A's fixed release owns the single TLS terminator. It must route only `login-test.sciforge.cn` to `keycloak:8080` over `sciforge-keycloak_identity-edge`; the Cloud host route remains owned by A. Never copy or overwrite A's Caddy files from this directory.

## Verify HTTPS, JWKS, and claims

On the ECS, validate the existing host-published 443 with correct SNI and Host without relying on public hairpin routing:

```sh
SCIFORGE_VERIFY_MODE=local-edge ./scripts/verify-edge-contract.sh
```

From an independent external host:

```sh
SCIFORGE_VERIFY_MODE=external-public ./scripts/verify-edge-contract.sh
```

For a fresh real Access Token, place exactly one compact JWT plus an optional final newline in a root-only absolute-path file with mode `0600`, one hard link, and current-user ownership. Then run:

```sh
SCIFORGE_VERIFY_MODE=local-edge \
SCIFORGE_ACCESS_TOKEN_FILE=/root-only/path/fresh-access-token \
./scripts/verify-edge-contract.sh
```

Delete the Token file immediately. The verifier reports only booleans and public endpoints. It verifies the RS256 signature, unique JWKS `kid`, RSA size, exact issuer, audience, authorized party, required claims, NumericDate types/order/current validity, and secure file properties.

## Health and restart evidence

The Keycloak health check is the management readiness endpoint `/health/ready` on unexposed port 9000. PostgreSQL uses `pg_isready`. Record container IDs, start times, restart counts, and recovery duration with:

```sh
./scripts/restart-health.sh
```

After recovery, rerun Discovery/JWKS verification and confirm the Realm, three clients, mappers, user count, and protected test accounts still exist.

## Isolated restore verification

Run restore verification against the protected backup identifier:

```sh
./scripts/restore-verify-db.sh preopt-YYYYMMDDTHHMMSSZ
```

The restore project uses an independent internal network and temporary volume. The script compares the restored non-secret contract counts against the backup baseline, writes a mode-`0600` receipt, and removes the temporary containers, network, and volume. It never mounts or overwrites the live data volume.

## Rollback

1. Stop the candidate Keycloak application only through the approved wrapper if the new application cannot become healthy. Do not stop or alter A's edge or Cloud route.
2. Restore the previous Compose/Containerfile release and the previously recorded immutable Keycloak image ID.
3. Reattach the existing `sciforge-keycloak_keycloak-db-data` volume; do not delete it.
4. Start the previous Keycloak release and require both health checks, exact Discovery issuer, JWKS, clients, mappers, and users to pass.
5. If and only if database rollback is required, preserve the current failed-state volume first, create a new replacement volume, restore the protected dump into that new volume, verify it in isolation, and switch only after explicit approval. Never restore over the sole live volume.
6. For an `nbf` mapper-only rollback, delete only mapper IDs created by that maintenance operation and read back both target clients. Do not restart Keycloak or restore the database.

## Evidence boundary

Never infer public reachability from ECS-local verification alone; record local-edge TLS and external-public results separately. Never infer remote logout revocation from deleting a local profile. Do not mark the issuer ready until HTTPS, PKCE, strict claims, health, port isolation, restart persistence, backup, and isolated restore evidence all pass.
