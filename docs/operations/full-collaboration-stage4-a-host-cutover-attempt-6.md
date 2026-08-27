# Stage 4 A-host cutover attempt 6, exact rollback, and refreshed candidate

This receipt records the sixth explicitly approved OpenSpec 7.4 operation. It
used the clean personal-fork source application at
`ea25eba0f605c37325793d255afe2a247912bc9e`, selected the retained Cloud
candidate `763cc5a5619cc11cc491e75edb5f04dfb2e4deac`, and exercised the real U0
profile. A successful Worker-availability database commit was followed by an
HTTP response-validation failure in that old candidate image. U0 was stopped
before the immutable old Edge was restored and the candidate was detached.
OpenSpec 7.4 therefore remains incomplete.

No credential, Token, authorization header, private Provider origin, external
account value, unredacted Human identity, prompt or business content appears in
this receipt.

## Approved public window

Immediately before selection, the old public Edge was healthy at revision
`eaf9925092db2d488fa3dc61ae35ec054c80539a`; its immutable Caddyfile mount and
SHA-256 matched the frozen rollback packet. The retained candidate was ready at
schema v14 with catalog fingerprint
`7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d`,
all five aggregate safety counters were zero, and identity counts were
7 Users, 7 OIDC identities, 24 Devices and 16 Agents. Three attempt-prefixed
read-only check containers were retained with exit code zero.

The first Caddy validation container retained exit 127 because the command
omitted the image's explicit executable. A corrected, separately named
container invoked `/usr/bin/caddy validate` and exited zero before any network
or Edge mutation. Compose rendering and the exact prior approval marker then
passed. The candidate received only the unique Edge alias and internal
health/readiness returned 200 before only the Edge service was recreated.

The public candidate window passed all frozen gates:

- `/healthz` and `/readyz` returned 200;
- unauthenticated `/v1/me` returned 401;
- the strict unauthenticated `worker.availability.list` probe returned
  `authentication_required`;
- the public revision header and Edge Caddyfile mount selected
  `763cc5a5619cc11cc491e75edb5f04dfb2e4deac`;
- OIDC discovery retained the sole issuer
  `https://login-test.sciforge.cn/realms/SciForge`;
- the exact-source guard passed personal Fork, branch, commit, production build,
  public Provider reachability and `privateSkillRequired: false`.

## Real U0 result and decisive chronology

The real Identity UI showed the existing U0 User and Desktop Device connected;
no reauthentication or duplicate identity was required. On opening
Collaboration, startup recovery immediately reached an error before any manual
Connect click. The local durable state and candidate audit/receipt tables agree
on the exact sequence:

| Time (UTC) | Fact |
| --- | --- |
| `2026-08-26T18:32:46.558Z` | existing U0 Agent heartbeat accepted; Agent revision advanced to 47 |
| `2026-08-26T18:32:47.568Z` | current online Worker availability accepted and persisted; availability revision advanced to 45 |
| after the commit | old candidate failed to encode the successful entity in its strict REST response and returned `validation_failed` |
| shutdown | a later offline observation was correctly rejected because it did not match the still-online exact heartbeat fact |

The accepted availability contained the exact revision-47 heartbeat time and
Runtime capability tags. The server receipt stored the successful canonical
`worker.availability.changed` entity, while the Desktop retained the same
command as failed with `The strict collaboration schema rejected this request
or response.` This proves the failure happened after the Cloud business commit,
not in OIDC, Agent authentication, PostgreSQL, Caddy, TLS, Alibaba Cloud
networking, Content Space, OpenContent Provider code or the optional private
Skill ZIP.

The root cause is version skew in the selected Cloud image. Its service already
returned `worker_availability_projection`, but its bundled `restEntitySchema`
did not include that entity. Commit `f89b8180fff3e721e5e8aae36174f96443701700`
had already corrected the shared schema and Desktop supersession path; it had
not yet been rebuilt into the retained `763cc5a5` Cloud image. Commit
`94f6d89b321b40651ad2febc5bce6524e5765bf8`, pushed only to the personal Fork,
adds a real HTTP regression that performs Agent heartbeat followed by
availability publish and requires a strict HTTP 200 entity response. Contracts
passed 104 tests; the server passed 147 tests with 7 environment-only skips;
both package typechecks and changed-file lint passed.

## Mandatory exact rollback

The U0 source process was stopped first. Only the Edge service was recreated
from the immutable old base compose and exact old revision. Public
health/readiness/authentication returned `200/200/401`, the revision header
returned to `eaf9925092db2d488fa3dc61ae35ec054c80539a`, the Edge became healthy
on the exact old Caddyfile mount, and issuer discovery remained exact. Only then
was the selected candidate detached from the Edge network and restored to
`restart=no` with its two isolated networks. No old stack, candidate, database,
Project or evidence resource was deleted.

## Refreshed isolated Cloud candidate

After the sixth authorization had ended at rollback, a new isolated candidate
was prepared without selecting it publicly:

| Field | Verified value |
| --- | --- |
| Source / image revision | `94f6d89b321b40651ad2febc5bce6524e5765bf8` |
| Bundle SHA-256 | `c99a0897a656c2ab2717da934b07817292172d9a0a2b20dd7c0d1d9702a6bfff` |
| Image | `sciforge-stage4-20260826t080435z-candidate-cloud:94f6d89b321b40651ad2febc5bce6524e5765bf8` |
| Image ID | `sha256:8f50fa710f482fc2085e189a0631aac219ef722cd6e412bbaa8dc0df6342112a` |
| Application | `sciforge-stage4-20260826T080435Z-candidate-app-94f6d89b` |
| Loopback listener | `127.0.0.1:18790 -> 8787` |
| Isolated alias | `sciforge-stage4-candidate-94f6d89b` |
| Database | retained isolated `sciforge-stage4-20260826T080435Z-candidate-db-v2` |

The exact personal-fork commit was rebuilt into four npm tarballs and an
immutable lockfile/ledger. The image label, non-root user, read-only CLI and
bundled strict entity union passed retained probes. A v14 no-op migration
exited zero and reproduced the same schema fingerprint and 49/636/494/124
catalog cardinality. Pre/post application aggregate audits retained all five
safety counters at zero, 2 cancelled/8 completed/4 paused Projects, and the
same 7/7/24/16 identity counts. The new app passes isolated `200/200/401`, exact
issuer discovery and the strict unauthenticated contract probe. It has only the
two candidate networks and `restart=no`.

The old `763cc5a5` image, application container, database, failed/successful
probes and all earlier evidence remain retained. The old application container
is stopped rather than deleted. The refreshed candidate has never joined the
public Edge network. The public Edge remains on the old stable stack.

Prepared cutover assets differ from the previous packet only in the unique
candidate alias and immutable bind path. Their SHA-256 values are:

- Caddyfile: `da354c0384a3044e80fec91c80036d5b7c6228d60244cc5a5951e585de8fd4e9`;
- compose override: `6fbd34de9b365bfa68ce9c0d78b500d4e2b3507cb0674fa43406ec9fe1374f70`.

A retained corrected Caddy validation container exited zero and compose config
rendering passed. No approval marker exists for revision `94f6d89b`; selecting
this refreshed candidate requires a new explicit Human authorization under the
new exact packet. The next real gate must reuse the retained U0 Project, prove
the revision-48-or-later heartbeat and current online availability through the
real source app, reach Collaboration connected, focus the Project, and render
Coordinator online User and Agent counts.

Receipt generated at `2026-08-27T02:51:36+08:00`.
