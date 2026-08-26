# Stage 4 A-host cutover attempt 1 and verified rollback

This receipt records the first explicitly approved OpenSpec 7.4 attempt against
the packet frozen at recovery-branch commit
`743907e20e8b97560c17ef610c2cd88248dc2dae`. The Edge selection itself passed,
but the required packaged U0 smoke failed before Collaboration settings or an
Agent were created. The mandatory rollback then passed. Therefore 7.4 remains
incomplete and the live status remains `awaiting_candidate`.

No credential, Token, private Provider origin, external account display value,
unredacted User/Device identity or replayable authorization appears here.

## Pre-cutover gates

Immediately before mutation:

- local HEAD, branch, origin branch and clean worktree all matched the exact
  approved commit;
- the old Edge was healthy with zero restarts, revision
  `eaf9925092db2d488fa3dc61ae35ec054c80539a`, the immutable old Caddyfile mount
  and Caddyfile SHA-256
  `4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0`;
- candidate `/healthz` and `/readyz` returned 200;
- candidate database version 14 was ready with fingerprint
  `7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d`
  and 49 tables, 636 columns, 494 constraints and 124 indexes;
- all five migration-safety aggregate invariants were zero;
- public health/readiness returned 200, unauthenticated `/v1/me` returned 401,
  Edge revision was the exact old revision, and OIDC discovery retained the
  sole frozen issuer.

## Prepared assets and validation evidence

The immutable old release file was not edited. Two root-owned mode `0444`
assets were installed only under the protected candidate `cutover` directory:

| Asset | SHA-256 |
| --- | --- |
| `Caddyfile.cloud-test-763cc5a5` | `05b84b2dc234b7bd5ce127ec859e8740ce70aa0a1239a9dbd50dda2f0b292a9d` |
| `compose.edge-override.yml` | `047b582fd6c18055f3b2cd57fd4627a7e858ddf831790b7ded11059dc90fa4b6` |

Their only effective Caddy selection diff remained:

```diff
-		dynamic a app 8787 {
+		dynamic a sciforge-stage4-candidate-763cc5a5 8787 {
```

The first retained validation container used `validate` as its executable and
failed before Caddy started because the pinned image intentionally has no
entrypoint. It remains in `created` state with exit 127. A separately named
retained v2 validation container invoked `/usr/bin/caddy validate` explicitly,
reported `Valid configuration`, and exited zero. Docker Compose `2.26.1` then
rendered the exact candidate revision, Edge networks, `0.0.0.0:443 -> 8443`
port and planned Caddyfile mount. Neither validation container touched the
running Edge.

The candidate restart policy was changed to `unless-stopped`, it was attached
to the existing Edge network under only the unique candidate alias, and the
old Edge obtained candidate health/readiness 200 through that alias. The exact
root-owned mode `0440` candidate-revision approval marker was installed and is
retained.

## Edge cutover result

Only the existing `edge` compose service was recreated. It converged on the
first bounded poll with:

- healthy Edge;
- candidate revision in the Edge environment and image-revision label;
- exact planned Caddyfile mount and SHA-256;
- public health/readiness 200;
- unauthenticated `/v1/me` 401;
- exact unchanged OIDC issuer discovery.

The old Cloud app and database remained running and untouched as the rollback
target. The old Caddyfile, Keycloak, DNS and certificates were not mutated.

## Packaged U0 failure and root cause

The retained packaged U0 profile still showed its real OIDC Desktop as
connected. The Human-independent smoke changed the Collaboration address field
to `https://cloud-test.sciforge.cn` and invoked `Save and connect`. The canonical
capability failed with the bounded renderer message:

`Handler for collaboration.connection.configure failed.`

No Collaboration settings file was written and no Agent was registered. The
candidate aggregate remained exactly 7 User principals, 7 OIDC identities, 23
Devices and 15 Agents.

The root cause is the bootstrap launch boundary, not candidate health or a
production fallback. The same retained packaged process had been intentionally
started for isolated onboarding with non-secret Identity Cloud base
`http://127.0.0.1:18789`. The production `CollaborationConnection.configure`
path requires the normalized Collaboration base URL to equal the active
Identity Cloud endpoint before it writes settings. It therefore correctly
rejected the public HTTPS value before any Cloud command. This is the expected
split-endpoint safety fence; weakening it, admitting HTTP, or adding a fallback
is prohibited.

## Verified automatic rollback

The failure met the packet's mandatory rollback trigger. Only `edge` was
recreated from the immutable old base compose and old revision. The first
bounded verification poll proved:

- Edge healthy with zero restarts and exact old revision;
- exact immutable old Caddyfile mount and SHA-256;
- public health/readiness 200 and unauthenticated `/v1/me` 401;
- exact unchanged OIDC issuer and old Edge revision header.

Only after those checks passed was the candidate detached from the Edge network
and its restart policy restored to `no`. It retains its isolated application and
database networks plus loopback listener. Current database aggregates prove the
rollback boundary: old database version 5 remains at 6 User principals, 6 OIDC
identities, 22 Devices and 15 Agents; candidate remains at 7, 7, 23 and 15.

The candidate, databases, old stack, cutover assets, approval marker and both
validation containers remain retained. Nothing was deleted or down-migrated.

## Revised reattempt boundary

The server selection diff and rollback commands do not change. A reattempt must
change only the packaged smoke ordering:

1. Gracefully stop the loopback-bound packaged U0 process while preserving its
   exact user-data directory and native secret stores.
2. Re-run all preflight gates and the same approved Edge cutover packet.
3. After the public candidate gates pass, launch the same packaged executable
   and same U0 profile with Identity Cloud base
   `https://cloud-test.sciforge.cn`, the same frozen issuer and browser bridge
   disabled.
4. Require Identity to recover the same User and Device through the public
   candidate; it must not create a second Device.
5. Configure Collaboration with the same HTTPS origin, register the real U0
   Agent, connect, and recheck the existing OpenContent binding.
6. If any packaged gate fails, stop the public-bound packaged process before
   restoring the old Edge. After the old public gates pass, relaunch U0 against
   the retained loopback candidate so it cannot accidentally address the old
   database.

This revised order requires a new explicit Human approval before another Edge
mutation. It does not authorize code changes, HTTP/TLS bypass, old-stack
retirement, evidence cleanup, five-device completion or an upstream pull
request.

Receipt generated at `2026-08-26T10:02:21Z`.
