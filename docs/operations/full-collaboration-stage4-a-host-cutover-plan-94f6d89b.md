# Stage 4 refreshed-candidate cutover and rollback packet

This packet is prepared evidence only. It does not authorize or record another
OpenSpec 7.4 public selection. A separate explicit Human authorization is
required. Formal installer/release work remains deferred.

## Exact selection boundary

The existing DNS, TLS listener, Keycloak issuer, old Cloud application and old
Cloud database remain unchanged. The only Caddy content change from the prior
candidate packet is the unique Cloud upstream alias:

```diff
-		dynamic a sciforge-stage4-candidate-763cc5a5 8787 {
+		dynamic a sciforge-stage4-candidate-94f6d89b 8787 {
```

| Asset | Exact value |
| --- | --- |
| Old Edge | `sciforge-collaboration-a-https-oidc-test-edge-1` |
| Old Edge/app revision | `eaf9925092db2d488fa3dc61ae35ec054c80539a` |
| Old base compose | `/srv/sciforge-collaboration/releases/eaf9925092db2d488fa3dc61ae35ec054c80539a/deploy/collaboration-private/compose.a-https-oidc-test.yml` |
| Old Caddyfile SHA-256 | `4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0` |
| Refreshed candidate app | `sciforge-stage4-20260826T080435Z-candidate-app-94f6d89b` |
| Refreshed candidate image revision | `94f6d89b321b40651ad2febc5bce6524e5765bf8` |
| Refreshed candidate image ID | `sha256:8f50fa710f482fc2085e189a0631aac219ef722cd6e412bbaa8dc0df6342112a` |
| Candidate DB | `sciforge-stage4-20260826T080435Z-candidate-db-v2` |
| Candidate schema | v14, fingerprint `7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d` |
| Candidate Edge alias | `sciforge-stage4-candidate-94f6d89b` |
| Frozen issuer | `https://login-test.sciforge.cn/realms/SciForge` |
| Candidate Caddyfile | `/srv/sciforge-stage4-20260826T080435Z-candidate/cutover/Caddyfile.cloud-test-94f6d89b` |
| Candidate Caddyfile SHA-256 | `da354c0384a3044e80fec91c80036d5b7c6228d60244cc5a5951e585de8fd4e9` |
| Compose override | `/srv/sciforge-stage4-20260826T080435Z-candidate/cutover/compose.edge-override-94f6d89b.yml` |
| Override SHA-256 | `6fbd34de9b365bfa68ce9c0d78b500d4e2b3507cb0674fa43406ec9fe1374f70` |

The refreshed application is currently running only on its two isolated
networks, publishes only `127.0.0.1:18790`, and has `restart=no`. The previous
`763cc5a5` application is retained and stopped. The old public Edge is healthy
and still selects the old stable application. No `approved-94f6d89b...` marker
exists.

## Pre-authorized evidence already frozen

- the exact source commit exists at the head of personal-fork branch
  `codex/full-collaboration-loop-recovery`;
- contracts passed 104 tests, the server passed 147 tests plus 7 explicit
  environment-only skips, and package typecheck/lint passed;
- four image inputs, package lock and SHA-256 ledger passed twice before build;
- the immutable image label, non-root/read-only CLI and bundled availability
  entity union passed retained probes;
- v14 no-op migration, pre/post database check, aggregate safety audit and
  identity counts passed;
- isolated candidate health/readiness/authentication returned `200/200/401`,
  exact issuer discovery passed, and the candidate is not attached to the Edge
  network;
- the new Caddyfile validated in retained container
  `sciforge-stage4-20260826T080435Z-caddy-validate-v2-94f6d89b`, and the exact
  base-plus-override compose render passed;
- the old public Edge was rechecked after all preparation and remained
  `200/200/401` with the exact old revision header and issuer.

## Forward sequence after explicit authorization

Every assertion is fail-fast. No new Project is created: the real U0 path must
reuse `prj_5594a84705a34532b0dd50c3d16911f9`.

1. Require the U0 process to be absent. Recheck origin HEAD/source checkout,
   old Edge revision/mount/hash/health, candidate image/networks/restart policy,
   v14 fingerprint, aggregate safety counters, public old `200/200/401`, and
   exact issuer.
2. Require the two prepared asset hashes, retained Caddy validation exit zero,
   successful compose render, and the explicit approval marker content/mode.
3. Set only the refreshed candidate restart policy to `unless-stopped`, attach
   only it to `sciforge-collaboration-private_private-edge` under unique alias
   `sciforge-stage4-candidate-94f6d89b`, and require Edge-internal candidate
   health/readiness 200 before public selection.
4. Recreate only service `edge` from the immutable old base compose plus the
   refreshed override. Supply revision `94f6d89b...` for the Edge and contract
   labels while reusing the exact existing state directory.
5. Require Edge health, exact candidate mount/revision, public `200/200/401`,
   strict unauthenticated `authentication_required`, exact issuer and no
   redirect/TLS drift.
6. Launch the clean exact-source application at
   `/private/tmp/sciforge-stage4-attempt5-fix.XnHJIR/SciForge-Run0` with the
   retained U0 profile. Require the existing User/Device/Agent with no duplicate,
   a revision-48-or-later Agent heartbeat, current online availability,
   Collaboration `connected`, retained Project focus, and Coordinator-visible
   online User and Agent counts.
7. On success, keep the refreshed candidate publicly selected and preserve the
   old stack, old candidate, database, approval marker, all probes and all
   evidence. Do not retire or delete anything.

The authorized forward mutations are bounded to:

```sh
printf '%s\n' 94f6d89b321b40651ad2febc5bce6524e5765bf8 | \
  sudo install --mode=0440 --owner=root --group=10002 /dev/stdin \
    /srv/sciforge-collaboration/a-https-oidc-test/approval/approved-94f6d89b321b40651ad2febc5bce6524e5765bf8

sudo docker update --restart=unless-stopped \
  sciforge-stage4-20260826T080435Z-candidate-app-94f6d89b

sudo docker network connect \
  --alias sciforge-stage4-candidate-94f6d89b \
  sciforge-collaboration-private_private-edge \
  sciforge-stage4-20260826T080435Z-candidate-app-94f6d89b

sudo docker exec sciforge-collaboration-a-https-oidc-test-edge-1 \
  /bin/sh -eu -c \
  'wget -qO- http://sciforge-stage4-candidate-94f6d89b:8787/healthz; wget -qO- http://sciforge-stage4-candidate-94f6d89b:8787/readyz'

sudo env \
  SCIFORGE_A_HTTPS_OIDC_TEST_COMMIT=94f6d89b321b40651ad2febc5bce6524e5765bf8 \
  SCIFORGE_A_HTTPS_OIDC_TEST_STATE_DIR=/srv/sciforge-collaboration/a-https-oidc-test \
  SCIFORGE_COLLAB_CONTRACT_COMMIT=94f6d89b321b40651ad2febc5bce6524e5765bf8 \
  docker compose \
    --project-name sciforge-collaboration-a-https-oidc-test \
    --file /srv/sciforge-collaboration/releases/eaf9925092db2d488fa3dc61ae35ec054c80539a/deploy/collaboration-private/compose.a-https-oidc-test.yml \
    --file /srv/sciforge-stage4-20260826T080435Z-candidate/cutover/compose.edge-override-94f6d89b.yml \
    up --detach --no-deps --force-recreate edge
```

## Mandatory rollback

Any mismatch or real U0 gate failure requires this order:

1. stop the U0 source application and prove it is absent;
2. recreate only the Edge from the immutable old base compose and old revision;
3. require exact old mount/hash/revision, healthy Edge, public `200/200/401` and
   exact issuer;
4. only after public old gates pass, detach the refreshed candidate from the
   Edge network and restore `restart=no`;
5. retain every resource and record the failure. Never down-migrate either DB.

```sh
sudo env \
  SCIFORGE_A_HTTPS_OIDC_TEST_COMMIT=eaf9925092db2d488fa3dc61ae35ec054c80539a \
  SCIFORGE_A_HTTPS_OIDC_TEST_STATE_DIR=/srv/sciforge-collaboration/a-https-oidc-test \
  SCIFORGE_COLLAB_CONTRACT_COMMIT=eaf9925092db2d488fa3dc61ae35ec054c80539a \
  docker compose \
    --project-name sciforge-collaboration-a-https-oidc-test \
    --file /srv/sciforge-collaboration/releases/eaf9925092db2d488fa3dc61ae35ec054c80539a/deploy/collaboration-private/compose.a-https-oidc-test.yml \
    up --detach --no-deps --force-recreate edge

sudo docker network disconnect \
  sciforge-collaboration-private_private-edge \
  sciforge-stage4-20260826T080435Z-candidate-app-94f6d89b

sudo docker update --restart=no \
  sciforge-stage4-20260826T080435Z-candidate-app-94f6d89b
```

Approval of this packet would not authorize old-stack retirement, database or
evidence deletion, a new DNS/issuer, formal release artifacts, upstream changes
or five-Human acceptance completion.
