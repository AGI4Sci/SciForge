# Stage 4 A-host backup and isolated restore receipt

This receipt records the user-authorized OpenSpec 7.2 rehearsal performed on
the A host at 47.76.230.118. Its scope was only the stack currently selected by
cloud-test.sciforge.cn and login-test.sciforge.cn. Staging, migration, R01 and
detached resources were excluded.

The rehearsal created backups and isolated Docker resources, but it did not
stop, restart, reconfigure or migrate the current Edge, Cloud, Keycloak or
database containers. It did not reload Caddy or change DNS.

## Session and protected evidence

| Field | Value |
| --- | --- |
| Session prefix | sciforge-stage4-20260826T074009Z |
| Completed | 2026-08-26T07:55:44Z |
| Protected backup directory | /srv/sciforge-stage4-20260826T074009Z-backup |
| Backup directory size | 7658818 bytes |
| Free root-filesystem capacity after rehearsal | 29805871104 bytes |
| Evidence manifest SHA-256 | c5a84652e0f0be4984e8347adac6b5f3c46cfc2b54637988070c24314dcbae50 |
| Final receipt SHA-256 | 10e517d5cb80a8447a754a780247ba78a337c1c2ddb5b58499adbfa8653d79eb |

The backup tree is owned by root and inaccessible to other host users. The
manifest covers all evidence except the restore-only secret directory, the
manifest itself and the final receipt. Restore-only credentials were generated
fresh for the isolated databases; no current credential, token, private key or
secret value was copied into this repository.

## Backup artifacts

| Artifact | SHA-256 | Verification |
| --- | --- | --- |
| Cloud PostgreSQL 17.6 custom dump | 1126bbdf59c74fe78ef1356e40ea8a99ac6ebc9e15d0eb58f38ee5c45fc50e3d | pg_restore list parsed; isolated restore passed |
| Keycloak PostgreSQL 17.6 custom dump | 6531ed2e3f0597852f179b167d5df6a0bf2d48d852e21f74e4ad8dc339b8ed59 | pg_restore list parsed; isolated restore passed |
| Caddy/config/data/approval and Keycloak-config archive | a0cc047ff0b946f05a75fc675a554ca51dbca1dbc70d41741461c6d84d77c80e | 35 safe members extracted; expected files and hashes passed |
| Realm exported from the restored Keycloak database | a27ed724822c67ea92fc2d47c49c311768fba7c6f4be89fb7c6a057ebcc67944 | Parsed as SciForge; 9 aggregate users and all 3 expected SciForge clients; fresh-database import passed |

The edge archive contains certificate private-key material and remains only in
the protected host backup tree. The repository records hashes and aggregate
results, not archive contents.

## Isolated restore proof

The Cloud dump was restored into a new PostgreSQL volume on an internal Docker
network with no published ports. All 32 table row counts matched the source
snapshot. The migration ledger remained at version 5 and the mechanically
recomputed catalog fingerprint was exactly
238d1ae31083f9bba86539e1be20630e89614ebf5df304ff7407bc3e40cfbc54,
the admitted frozen public-v5 source.

The Keycloak dump was restored into a separate PostgreSQL volume. The restored
database matched the frozen aggregate contract:

| Contract | Restored value |
| --- | ---: |
| SciForge realms | 1 |
| Expected SciForge clients | 3 |
| Aggregate users | 9 |
| Public Desktop standard-flow client without direct grants | 1 |
| Desktop PKCE S256 attribute | 1 |
| Cloud API audience mapper | 1 |
| Exact loopback redirect | 1 |

The pinned Keycloak image then exported that restored realm. A second new
PostgreSQL volume received the export through the Keycloak import command, and
the same seven database-level contract checks matched again. This proves both
the database dump path and the Realm export/import path independently.

The first isolated Keycloak PostgreSQL container intentionally remains as
failure evidence: dropping every Linux capability prevented the official
entrypoint from changing ownership and switching to its postgres user before
any restore occurred. The successful retry retained no-new-privileges, a
read-only root filesystem, no published ports and the internal network, while
adding only the entrypoint capabilities required for ownership and UID/GID
transition.

## Retained resource ledger

All rehearsal resources are retained for review. Every name uses the exact
session prefix, both networks are internal, every container has zero published
ports, and all six containers are stopped.

| Kind | Exact retained name |
| --- | --- |
| Network | sciforge-stage4-20260826T074009Z-cloud-restore-net |
| Network | sciforge-stage4-20260826T074009Z-keycloak-restore-net |
| Volume | sciforge-stage4-20260826T074009Z-cloud-restore-data |
| Volume | sciforge-stage4-20260826T074009Z-keycloak-restore-data |
| Volume | sciforge-stage4-20260826T074009Z-realm-import-data |
| Container | sciforge-stage4-20260826T074009Z-cloud-restore-db |
| Container | sciforge-stage4-20260826T074009Z-keycloak-restore-db |
| Container | sciforge-stage4-20260826T074009Z-keycloak-restore-db-v2 |
| Container | sciforge-stage4-20260826T074009Z-keycloak-export |
| Container | sciforge-stage4-20260826T074009Z-realm-import-db |
| Container | sciforge-stage4-20260826T074009Z-realm-import |

No wildcard cleanup or evidence deletion was performed. Deleting these
resources or the protected backup directory requires a separate exact-target
authorization.

## Post-rehearsal live-state proof

After all restore containers were stopped, the five current DNS/443 containers
still had the same immutable image IDs, healthy state, zero restarts and
original Caddyfile hash recorded by the 7.1 baseline. The current Cloud database
still had schema version 5, the same catalog cardinalities and the exact
public-v5 fingerprint. The current Keycloak database still matched all seven
aggregate contract checks.

Public checks also remained exact:

- Cloud /healthz and /readyz: HTTP 200 with an ok response;
- unauthenticated Cloud /v1/me: HTTP 401;
- OIDC discovery: HTTP 200 with the frozen issuer, authorization, token and
  JWKS endpoints and PKCE S256;
- both DNS names: 47.76.230.118;
- Cloud and Login TLS certificate fingerprints: unchanged.

## Result and next boundary

OpenSpec 7.2 passed. The old DNS-selected stack now has both protected backup
artifacts and demonstrated isolated restore paths.

The next boundary is 7.3: create an independent candidate from the final,
verified source commit and target Cloud image, copy the old Cloud database into
candidate-only resources, and run migration plus real multi-user smoke there.
No 7.3 candidate was fabricated from an older image. Caddy cutover remains the
separately approval-gated 7.4 action and was not attempted.
