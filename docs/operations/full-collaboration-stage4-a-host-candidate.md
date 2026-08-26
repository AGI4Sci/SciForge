# Stage 4 A-host isolated candidate receipt

This receipt records the independently named OpenSpec 7.3 candidate created on
the A host at `47.76.230.118`. The candidate was built from the exact recovery
branch commit, restored from the protected 7.2 Cloud dump, migrated only on its
own database, exposed only on host loopback, and exercised with one real
system-browser OIDC registration/login. No Caddy, DNS, Keycloak issuer, current
Cloud application, or current Cloud database was changed.

## Candidate identity

| Field | Verified value |
| --- | --- |
| Session prefix | `sciforge-stage4-20260826T080435Z` |
| Candidate evidence completed | `2026-08-26T09:07:54Z` |
| Source branch | `codex/full-collaboration-loop-recovery` |
| Source commit | `763cc5a5619cc11cc491e75edb5f04dfb2e4deac` |
| Exact origin branch | Same commit on `origin/codex/full-collaboration-loop-recovery` |
| Candidate bundle SHA-256 | `54460a4a2de578fcdf326f52557e3437a05615de5b3bca39e00f0676b63f2368` |
| Candidate image | `sciforge-stage4-20260826t080435z-candidate-cloud:763cc5a5619cc11cc491e75edb5f04dfb2e4deac` |
| Candidate image ID | `sha256:4b59283c4afad5d8a557d8cdc09fa5a12c95c4df2ae63c87e4724e7ebf89fdcf` |
| Embedded revision label | `763cc5a5619cc11cc491e75edb5f04dfb2e4deac` |
| Runtime identity | Linux/amd64, `10001:10001`, read-only root, all capabilities dropped, no-new-privileges |
| Protected candidate root | `/srv/sciforge-stage4-20260826T080435Z-candidate` |

The bundle contained the exact contract commit, lockfile, package manifest,
SHA-256 ledger and four private runtime tarballs. The outer archive digest,
every inner digest and `CONTRACT_COMMIT` all matched before the image build. A
networkless, read-only retained CLI container exited zero and advertised only
the server start path plus the canonical `migrate` command.

Candidate-only database credentials were rotated before first use after an
earlier candidate-only value appeared in interactive tooling. No current-stack
credential was read. The rotation receipt and current candidate secret files
are root-owned mode `0600`; no value is copied into this repository, terminal
output, migration log, or this receipt.

## Isolated clone and forward migration

The successful candidate database is
`sciforge-stage4-20260826T080435Z-candidate-db-v2` on volume
`sciforge-stage4-20260826T080435Z-candidate-db-data-v2`. It publishes no host
port and is attached only to the internal network
`sciforge-stage4-20260826T080435Z-candidate-db-net`.

The exact 7.2 Cloud dump restored as the admitted `public-v5` source:

| Checkpoint | Version | Catalog fingerprint | Cardinality / readiness |
| --- | ---: | --- | --- |
| Protected source clone | 5 | `238d1ae31083f9bba86539e1be20630e89614ebf5df304ff7407bc3e40cfbc54` | 32 tables, 367 columns, 238 constraints, 70 indexes |
| Committed interrupted checkpoint | 12 | `3ed2b79dd3b18792f828a96a62ccae78156bd38dcac3212aa31fe133eeda1cf2` | 37 tables, 455 columns, 293 constraints, 91 indexes; not ready |
| Final candidate | 14 | `7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d` | 49 tables, 636 columns, 494 constraints, 124 indexes; ready |

Real historical data exposed four migration assumptions. The fixes were made
in the canonical source path, covered by real PostgreSQL regression tests,
committed and pushed before each replacement image was admitted:

- `29a0e5e304c4f8ebeee554d86b09b35f901d711d` preserves exact project-scoped
  HumanNeeded facts without inventing Task/execution identity and fences an
  unsafe non-Owner Coordinator.
- `acfa35ae29c909775721591d76699b94d5c10f42` retires the legacy confirmation
  authority while preserving historical HumanAnswer decisions.
- `757956252a7a2c7f827246f07c2ea8df8cb269cd` retires the obsolete completed-task
  result-summary constraint before fail-safe task conversion.
- `763cc5a5619cc11cc491e75edb5f04dfb2e4deac` admits exact committed v11-v13
  lineage checkpoints so a failed forward run resumes instead of pretending
  that the database is still v5.

The final v12-to-v14 migration container and a second no-op migration container
both exited zero. Their root-owned mode-`0600` logs are empty because the CLI
emits no successful secret-bearing output. A post-no-op check reproduced the
same v14 fingerprint, cardinality and readiness.

The final aggregate audit passed with all safety counters at zero:

- legacy `action_confirmations` tables: `0`;
- unsafe nonterminal Coordinator ownerships: `0`;
- retained historical confirmable actions: `0`;
- invalid HumanNeeded scopes: `0`;
- HumanAnswer/request scope mismatches: `0`.

The preserved historical aggregate is 2 cancelled, 8 completed and 3 paused
Projects; 8 answered, 2 cancelled and 1 expired `coordinator_project`
HumanNeeded requests; 2 cancelled Tasks plus 13
`manual_recovery_required/superseded` Tasks. No task prompt, result body,
display name, username, email, Provider locator or other business content was
read into the audit or receipt.

## Candidate application and restart checks

The candidate application is
`sciforge-stage4-20260826T080435Z-candidate-app`. It is attached to the ordinary
egress network `sciforge-stage4-20260826T080435Z-candidate-app-net` and the
internal candidate database network. Its only published socket is
`127.0.0.1:18789 -> 8787`; it has no public listener and is not a Caddy
upstream.

Before and after multiple explicit stop/start cycles:

- `/healthz` and `/readyz` returned HTTP 200 with `{"ok":true}`;
- unauthenticated `/v1/me` returned HTTP 401;
- the same container and exact image remained selected;
- the root filesystem remained read-only and restart count remained zero;
- the database remained ready v14 with the same catalog and aggregate audit;
- discovery from the running container returned HTTP 200 for the sole frozen
  issuer, with exact issuer match and HTTPS authorization, token and JWKS
  endpoints.

## Real synthetic OIDC persistence smoke

The Human registered and logged in a new synthetic U0 candidate identity only
through the system-browser Authorization Code with PKCE flow at the existing
`https://login-test.sciforge.cn/realms/SciForge` issuer. The smoke verified an
RS256 signature through discovery JWKS, exact issuer, audience
`sciforge-cloud-api` and authorized party `sciforge-desktop`. The Access Token
and PKCE verifier remained only in one local process, were never printed or
persisted, and disappeared when that process exited zero.

An SSH tunnel existed only for the duration of the smoke and mapped local
loopback to candidate loopback. It was closed after the successful run. The
candidate received a real authenticated `/v1/me`, returned the same identity
on a repeat read, was explicitly restarted, and then returned the same User,
OIDC identity and revision under the same in-memory Token:

| Evidence | Before | After |
| --- | ---: | ---: |
| Keycloak aggregate SciForge users | 9 | 10 |
| Candidate User principals | 6 | 7 |
| Candidate OIDC identities | 6 | 7 |
| Candidate Devices | 22 | 22 |
| Candidate Agents | 15 | 15 |
| Authenticated `/v1/me` | HTTP 200 | HTTP 200 after candidate restart |

The redacted stable references are:

- User: `redacted:sha256:53b74dd6505bd476cc30a51f6fbaed3f020e25cf1d50040ea6cf632344f704b3`;
- OIDC identity: `redacted:sha256:7918bd0bad127f2042caeadc96d2e466c92bfe764d3b58daddb57d9d123eb891`.

This 7.3 smoke intentionally created no Device or Agent. Those identities must
come from five real packaged Desktop profiles under OpenSpec 8.6; a server
script is not allowed to impersonate that evidence.

Two non-product attempts remain bounded evidence: one first registration flow
ended before candidate JIT and left all candidate identity counts unchanged;
one successful pre-restart process could not receive its continuation signal
because the local runner lacked a writable PTY. The latter process was stopped,
the candidate was unchanged, and the complete replacement run used a writable
PTY and exited zero. Neither attempt persisted a Token or created a Device,
Agent, Project or Provider write.

## Retained resource and failure ledger

All resources remain retained; no wildcard cleanup or evidence deletion ran.
The core current resources are:

| Kind | Exact name |
| --- | --- |
| Network | `sciforge-stage4-20260826T080435Z-candidate-db-net` (`internal=true`) |
| Network | `sciforge-stage4-20260826T080435Z-candidate-app-net` (`internal=false`) |
| Volume | `sciforge-stage4-20260826T080435Z-candidate-db-data-v2` |
| Database | `sciforge-stage4-20260826T080435Z-candidate-db-v2` |
| Application | `sciforge-stage4-20260826T080435Z-candidate-app` |
| Migration | `sciforge-stage4-20260826T080435Z-candidate-migrate-763cc5a5` |
| No-op migration | `sciforge-stage4-20260826T080435Z-candidate-migrate-noop-763cc5a5` |

The failed first database/volume, all earlier exact-commit candidate images,
failed migration/audit/count containers, successful pre/post/no-op/restart/login
check containers, protected bundles, scripts and receipts remain under the same
session prefix. The failed paths never attached to Caddy or the current Cloud
database. Removing any of these resources requires a separate exact-target
authorization.

## Current-stack non-mutation proof and next boundary

After the authenticated candidate restart, the five DNS/443 stack resources
still had their 7.1 image IDs, healthy state and zero restart counts. The
Caddyfile SHA-256 remained
`4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0`.
The current Cloud database remained version 5 with 32 tables and 367 columns.
Public Cloud health/readiness stayed HTTP 200, unauthenticated `/v1/me` stayed
401, and frozen issuer discovery stayed HTTP 200.

OpenSpec 7.3 is therefore complete. OpenSpec 7.4 was not started: Caddy still
selects the retained old application/database, the candidate is loopback-only,
and no reload, cutover, rollback drill or resource retirement occurred. Any
7.4 action requires a separately presented exact diff/rollback packet and a new
explicit User approval. Packaged artifact and five-real-Human gates remain
independently pending and cannot be replaced by this server smoke.
