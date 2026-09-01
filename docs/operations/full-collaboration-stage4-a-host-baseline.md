# Stage 4 A-host read-only baseline receipt

This receipt records only values observed through the user-authorized SSH
session to A host `47.76.230.118`. The first pass was non-privileged; after a
separate explicit authorization, the second pass used non-interactive `sudo`
only for read-only Docker metadata, Caddy configuration metadata, filesystem
capacity, and PostgreSQL `SELECT`/catalog queries. No database mutation,
container mutation, Caddy mutation, migration, backup, candidate, reload or
cutover command was executed.

## Observation identity

| Field | Observed value |
| --- | --- |
| First successful SSH observation | `2026-08-26T07:09:55Z` |
| Privileged read-only audit authorized | `2026-08-26` |
| Host | `47.76.230.118` |
| SSH user | `ares` (`uid=1002`, groups `ares,wheel`) |
| Hostname | `iZj6c9249u1rydd8f9ir2rZ` |
| OS | Alibaba Cloud Linux `4.0.5` (OpenAnolis Edition) |
| Kernel / architecture | Linux `6.6.102-7.alnx4`, `x86_64` |
| Uptime at resource observation | 10 days, 19 hours |

The user supplied the SSH identity and login method for this host. The receipt
does not copy, inspect or record private-key material.

## Resource and public-edge observations

| Surface | Observation |
| --- | --- |
| Root filesystem | 40 GiB total, 9.2 GiB used, 29 GiB available (25%) |
| Memory | 7456 MiB total, 4418 MiB available; no swap |
| DNS | Both frozen hostnames resolved on A to `47.76.230.118` |
| Listening TCP | Public `22`, `443`; loopback `8787`, `8788`, `46537` |
| Cloud public health | `/healthz` and `/readyz` returned HTTP 200 and `{"ok":true}` |
| OIDC public discovery | Exact frozen issuer and same-origin authorization/token/JWKS endpoints |
| Cloud TLS | SAN `cloud-test.sciforge.cn`; Let's Encrypt `YE2`; valid `2026-08-20T10:30:37Z` through `2026-11-18T10:30:36Z` |
| Login TLS | SAN `login-test.sciforge.cn`; Let's Encrypt `YE2`; valid `2026-08-20T10:30:36Z` through `2026-11-18T10:30:35Z` |
| OIDC cryptography | One signing key; `RS256`; minimum RSA size 2048 bits |
| Desktop login boundary | Exact `sciforge-desktop` client, loopback callback and PKCE S256 reached the real `Sign in to SciForge` page with no invalid-client or invalid-redirect response |

Both loopback ports `8787` and `8788` returned HTTP 200 with 11-byte bodies for
`/healthz` and `/readyz`; both returned HTTP 404 for the Keycloak discovery
route. Port `46537` returned HTTP 404 for all three probes. These observations
do not identify which Cloud listener is current, old, candidate or selected by
Caddy, so no role is inferred from the port numbers.

## Exact DNS/443 stack

The user directed the privileged audit to the stack that actually owns the
frozen DNS and host-published TCP 443. Other staging, migration, R01 acceptance
and detached PostgreSQL resources were observed but excluded from this receipt
and left untouched.

| Role | Exact active resource | Immutable observation |
| --- | --- | --- |
| Public edge | `sciforge-collaboration-a-https-oidc-test-edge-1` | healthy; zero restarts; Caddy image ID `sha256:af555904a0961945f16bb323a501457b13a4f7e9bde969b145b97da80b38ecbe`; configured image manifest `caddy@sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a` |
| Cloud app | `sciforge-collaboration-private-app-1` | healthy; zero restarts; image `sciforge-collaboration-runtime:eaf9925092db2d488fa3dc61ae35ec054c80539a`, ID `sha256:9162557ea77a4b08d8a50bb41e23c65de645418d864e058b5ec6d209f7825e6a`; embedded revision label `eaf9925092db2d488fa3dc61ae35ec054c80539a` |
| Cloud DB | `sciforge-collaboration-private-postgres-1` | healthy; zero restarts; PostgreSQL `17.6`; image ID `sha256:d741b376874687de90374fd34f55c6b2760e8f7bd7e4ae5cd47f50757fc08cf8`; manifest `postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94` |
| Keycloak | `sciforge-keycloak-keycloak-1` | healthy; zero restarts; image `sciforge-keycloak-optimized:26.7.0-f0f691e6f473`, ID `sha256:9d3a3537cec0553cf96b2d9e8bf3737e9d1bcc4ce8dcd9f36855e0c9507ed921` |
| Keycloak DB | `sciforge-keycloak-keycloak-db-1` | healthy; zero restarts; PostgreSQL `17.6`; same pinned PostgreSQL image ID and manifest as the Cloud DB |

Docker context is `default`; Docker Engine is `24.0.9` on Linux/amd64 with
`overlay2` and systemd cgroups. All 15 observed containers were running at the
audit instant, but only the five resources above form the current DNS/443
stack.

### Edge routing and rollback identity

The active Caddyfile is the read-only bind mount from release
`eaf9925092db2d488fa3dc61ae35ec054c80539a`. Its exact SHA-256 is
`4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0`.
The adapted source contract uses Docker DNS with five-second refresh:

- `cloud-test.sciforge.cn:8443` -> dynamic A record `app`, port `8787`;
- `login-test.sciforge.cn:8443` -> dynamic A record `keycloak`, port `8080`.

The edge shares only the current Cloud private-edge network and the current
Keycloak identity-edge network. The current Cloud image, Cloud DB volume,
Keycloak image, Keycloak DB volume, edge container and Caddyfile therefore form
the exact retained rollback target for any later candidate cutover.

### Database and OIDC contract

The current Cloud database is `sciforge_collaboration` on PostgreSQL `17.6`.
It has migration ledger `1,2,3,4,5`, 32 tables, 367 columns, 238 constraints and
70 indexes. Its mechanically recomputed catalog fingerprint is
`238d1ae31083f9bba86539e1be20630e89614ebf5df304ff7407bc3e40cfbc54`,
an exact match for the frozen `public-v5` source route. This proves that the DNS
database remains an admitted pre-migration source and has not been migrated in
place.

The current Keycloak database contains exactly one `SciForge` realm and all
three frozen clients. The `sciforge-desktop` client is exactly one public
standard-flow client with direct grants and service accounts disabled; its
PKCE-S256 attribute, `sciforge-cloud-api` access-token audience mapper and exact
`http://127.0.0.1:43110/oidc/callback` redirect each matched once. Only the
aggregate current user count (`9`) was recorded; no username, credential,
session, token or identity row was read into this receipt.

### Capacity for the next gate

| Resource | Observed bytes |
| --- | ---: |
| Cloud PostgreSQL volume | `143110144` |
| Keycloak PostgreSQL volume | `71602176` |
| Caddy config/data/approval directories combined | `131072` |
| Root filesystem available | `30130819072` |

The host has sufficient local capacity for bounded backups and isolated restore
resources. This is capacity evidence only; it does not authorize or satisfy the
backup/restore gate.

No process arguments, secret-valued environment variables, database connection
strings, user rows, tokens, credentials or unredacted private data were
collected. Database sessions enforced `default_transaction_read_only=on` and
executed catalog/count `SELECT` statements only.

## Result and next boundary

OpenSpec 7.1 is satisfied by this fresh, exact and non-mutating observation.
The observed current state is internally consistent with the frozen public
Cloud/OIDC contract: the old Cloud remains on admitted `public-v5`, the issuer
and Desktop client are exact, and Caddy still selects the retained old stack.

OpenSpec 7.2 remains untouched. Its next boundary is explicitly mutating:
creating protected backup files and exact session-prefixed isolated restore
resources. No such resource may be created until that bounded plan and target
names are reviewed and authorized.
