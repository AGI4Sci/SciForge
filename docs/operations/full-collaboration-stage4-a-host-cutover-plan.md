# Stage 4 A-host cutover and rollback packet

This packet is prepared evidence only. It does not authorize or record an
OpenSpec 7.4 cutover. No command in the forward or rollback sequence below has
been executed. A separate, explicit Human approval is required before any
listed A-host mutation.

## Frozen selection boundary

The public DNS, TLS listener, Keycloak issuer, old Cloud application and old
Cloud database remain unchanged. The only intended public-selection change is
the Cloud upstream used by the existing Edge:

```diff
 	reverse_proxy {
 		lb_try_duration 5s
 		lb_try_interval 250ms
-		dynamic a app 8787 {
+		dynamic a sciforge-stage4-candidate-763cc5a5 8787 {
 			refresh 5s
 			resolvers 127.0.0.11
 			versions ipv4
```

All other Caddyfile bytes remain identical. The observed and planned digests
are:

| Asset | SHA-256 |
| --- | --- |
| Retained old Caddyfile | `4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0` |
| Planned one-line cutover Caddyfile | `05b84b2dc234b7bd5ce127ec859e8740ce70aa0a1239a9dbd50dda2f0b292a9d` |

The planned Caddyfile and compose override will be installed only under
`/srv/sciforge-stage4-20260826T080435Z-candidate/cutover`. The immutable old
release file under
`/srv/sciforge-collaboration/releases/eaf9925092db2d488fa3dc61ae35ec054c80539a`
will not be edited.

## Exact retained and candidate identities

| Role | Exact identity |
| --- | --- |
| Edge | `sciforge-collaboration-a-https-oidc-test-edge-1` |
| Old Cloud app | `sciforge-collaboration-private-app-1` |
| Old Cloud DB | `sciforge-collaboration-private-postgres-1` |
| Old app revision | `eaf9925092db2d488fa3dc61ae35ec054c80539a` |
| Candidate app | `sciforge-stage4-20260826T080435Z-candidate-app` |
| Candidate DB | `sciforge-stage4-20260826T080435Z-candidate-db-v2` |
| Candidate app revision | `763cc5a5619cc11cc491e75edb5f04dfb2e4deac` |
| Candidate image ID | `sha256:4b59283c4afad5d8a557d8cdc09fa5a12c95c4df2ae63c87e4724e7ebf89fdcf` |
| Existing Edge network | `sciforge-collaboration-private_private-edge` |
| Planned unique candidate alias | `sciforge-stage4-candidate-763cc5a5` |
| Frozen issuer | `https://login-test.sciforge.cn/realms/SciForge` |

The old app remains attached to the Edge network with alias `app`; it is not
stopped, disconnected, renamed or recreated. The old database is never
migrated. The candidate keeps its two isolated networks and loopback listener,
and receives only the additional unique Edge-network alias.

## Prepared compose override

The sole override is:

```yaml
services:
  edge:
    volumes:
      - type: bind
        source: /srv/sciforge-stage4-20260826T080435Z-candidate/cutover/Caddyfile.cloud-test-763cc5a5
        target: /etc/caddy/Caddyfile
        read_only: true
```

Docker Compose `2.26.1` rendered this merge without mutation. The rendered Edge
keeps the same image, state/config/approval mounts, two networks, security
settings and `0.0.0.0:443 -> 8443` publication. Only the Caddyfile bind source,
`SCIFORGE_EDGE_COMMIT`, and `org.opencontainers.image.revision` change to the
candidate revision.

## Admission evidence immediately before approval

- Candidate `/healthz` and `/readyz` both return HTTP 200.
- Candidate schema v14 fingerprint is
  `7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d`.
- Current aggregate candidate counts are 7 User principals, 7 OIDC identities,
  23 Devices and 15 Agents. The retained U0 packaged profile's one-way
  principal digest matches exactly one User, one Device and zero Agents.
- U0 is signed in through the frozen real OIDC issuer, its packaged Desktop is
  connected, its real local Runtime is configured, and its OpenContent account
  passed live token/account re-observation through the canonical Connector
  service. No credential or Token is present in this packet.
- The packaged Collaboration UI correctly refuses the loopback candidate URL
  because the production contract requires HTTPS. No HTTP or TLS bypass is
  proposed. U0 Agent registration is therefore the immediate post-cutover
  packaged smoke.

## Forward sequence after a separate approval

Every assertion is fail-fast. A failed assertion stops before the next
mutation; any failure after Edge recreation invokes the rollback sequence.

1. Recheck old Edge/Caddyfile/image/network identities, candidate image,
   candidate v14 fingerprint, both candidate health endpoints, public old-stack
   health/readiness, unauthenticated `/v1/me` = 401, and exact issuer discovery.
2. Install the planned Caddyfile and compose override under the protected
   candidate `cutover` directory; require the exact digests recorded above.
3. Retain a stopped, session-prefixed Caddy validation container after it exits
   zero, and require `docker compose config` to reproduce the prepared render.
4. Change only the candidate app restart policy from `no` to
   `unless-stopped`, then connect only that app to
   `sciforge-collaboration-private_private-edge` with alias
   `sciforge-stage4-candidate-763cc5a5`.
5. From the existing Edge container, resolve the unique alias and require HTTP
   200 from its candidate `/healthz` and `/readyz` before public selection.
6. Install the non-secret, root-owned mode `0440` approval marker
   `approved-763cc5a5619cc11cc491e75edb5f04dfb2e4deac` in the existing approval
   directory.
7. Recreate only service `edge`, under the existing compose project name, from
   the immutable old base compose plus the prepared override. Supply the exact
   candidate revision for `SCIFORGE_EDGE_COMMIT` and the contract revision;
   reuse the exact existing state directory.
8. Require the new Edge to be healthy, its Caddyfile mount to name the prepared
   file, its Edge/contract revision to equal the candidate revision, and public
   health/readiness plus issuer discovery to pass. Require unauthenticated
   `/v1/me` to remain 401.
9. Through the retained U0 packaged profile, set only
   `https://cloud-test.sciforge.cn`, refresh Identity, register its real Agent,
   and require `oidc_user_ready -> device_active -> runtime_configured ->
   agent_registered -> collaboration_connected`. Recheck the already-connected
   OpenContent account without exposing credentials.
10. Preserve the old app, old DB, candidate, validation container, approval
    marker, plan assets and all earlier evidence. No resource is retired or
    deleted during 7.4.

After the two prepared files have been installed and their digests admitted,
the exact mutation commands are:

```sh
sudo docker create \
  --name sciforge-stage4-20260826T080435Z-caddy-validate-763cc5a5 \
  --network none \
  --read-only \
  --tmpfs /config:rw,nosuid,nodev,noexec,size=4m \
  --tmpfs /data:rw,nosuid,nodev,noexec,size=4m \
  --env SCIFORGE_EDGE_COMMIT=763cc5a5619cc11cc491e75edb5f04dfb2e4deac \
  --volume /srv/sciforge-stage4-20260826T080435Z-candidate/cutover/Caddyfile.cloud-test-763cc5a5:/etc/caddy/Caddyfile:ro \
  caddy:2.11.4-alpine@sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker start --attach \
  sciforge-stage4-20260826T080435Z-caddy-validate-763cc5a5

sudo env \
  SCIFORGE_A_HTTPS_OIDC_TEST_COMMIT=763cc5a5619cc11cc491e75edb5f04dfb2e4deac \
  SCIFORGE_A_HTTPS_OIDC_TEST_STATE_DIR=/srv/sciforge-collaboration/a-https-oidc-test \
  SCIFORGE_COLLAB_CONTRACT_COMMIT=763cc5a5619cc11cc491e75edb5f04dfb2e4deac \
  docker compose \
    --project-name sciforge-collaboration-a-https-oidc-test \
    --file /srv/sciforge-collaboration/releases/eaf9925092db2d488fa3dc61ae35ec054c80539a/deploy/collaboration-private/compose.a-https-oidc-test.yml \
    --file /srv/sciforge-stage4-20260826T080435Z-candidate/cutover/compose.edge-override.yml \
    config --quiet

sudo docker update --restart=unless-stopped \
  sciforge-stage4-20260826T080435Z-candidate-app
sudo docker network connect \
  --alias sciforge-stage4-candidate-763cc5a5 \
  sciforge-collaboration-private_private-edge \
  sciforge-stage4-20260826T080435Z-candidate-app
sudo docker exec sciforge-collaboration-a-https-oidc-test-edge-1 \
  /bin/sh -eu -c \
  'wget -qO- http://sciforge-stage4-candidate-763cc5a5:8787/healthz; wget -qO- http://sciforge-stage4-candidate-763cc5a5:8787/readyz'

printf '%s\n' 763cc5a5619cc11cc491e75edb5f04dfb2e4deac | \
  sudo install --mode=0440 --owner=root --group=10002 /dev/stdin \
    /srv/sciforge-collaboration/a-https-oidc-test/approval/approved-763cc5a5619cc11cc491e75edb5f04dfb2e4deac

sudo env \
  SCIFORGE_A_HTTPS_OIDC_TEST_COMMIT=763cc5a5619cc11cc491e75edb5f04dfb2e4deac \
  SCIFORGE_A_HTTPS_OIDC_TEST_STATE_DIR=/srv/sciforge-collaboration/a-https-oidc-test \
  SCIFORGE_COLLAB_CONTRACT_COMMIT=763cc5a5619cc11cc491e75edb5f04dfb2e4deac \
  docker compose \
    --project-name sciforge-collaboration-a-https-oidc-test \
    --file /srv/sciforge-collaboration/releases/eaf9925092db2d488fa3dc61ae35ec054c80539a/deploy/collaboration-private/compose.a-https-oidc-test.yml \
    --file /srv/sciforge-stage4-20260826T080435Z-candidate/cutover/compose.edge-override.yml \
    up --detach --no-deps --force-recreate edge
```

## Automatic rollback packet

Rollback is mandatory if Edge health does not converge within 120 seconds, a
public health/readiness or issuer check fails, unauthenticated `/v1/me` is not
401, the U0 packaged authenticated smoke fails, or any selected identity/image/
mount differs from this packet.

1. Recreate only service `edge` from the immutable old base compose without the
   override, with the exact old revision
   `eaf9925092db2d488fa3dc61ae35ec054c80539a` and the exact existing state
   directory.
2. Require the Edge mount source and Caddyfile SHA-256 to return to the retained
   old values, the Edge/contract revision to return to the old revision, the
   Edge to become healthy, public `/healthz` and `/readyz` to return 200,
   unauthenticated `/v1/me` to return 401, and issuer discovery to remain exact.
3. Disconnect only the candidate app from the existing Edge network and restore
   its restart policy to `no`. Its isolated networks, loopback listener,
   database, volumes and all evidence remain retained.
4. Record the rollback reason and checks. Do not delete the cutover assets,
   approval marker, candidate or stopped validation container without a later
   exact-target authorization.

The exact rollback mutations are:

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
  sciforge-stage4-20260826T080435Z-candidate-app
sudo docker update --restart=no \
  sciforge-stage4-20260826T080435Z-candidate-app
```

The rollback never down-migrates either database and never changes Keycloak,
DNS, certificates, the old app, the old DB, or the frozen issuer.

## Approval scope

Approval of this packet would authorize only the exact forward sequence,
immediate packaged U0 smoke, and mandatory exact rollback above. It would not
authorize old-stack retirement, database deletion, evidence cleanup, a new DNS
name/issuer, five-Human acceptance completion, or an upstream pull request.
