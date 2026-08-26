# Stage 4 A-host cutover attempt 2 and verified rollback

This receipt records the second explicitly approved OpenSpec 7.4 attempt. The
approval named recovery-branch commit
`7d946636df1005185724dac818b8c9a44024a9fa` and required the revised order:
stop the loopback-bound U0 process, select the same public candidate, then
launch the same packaged executable and profile with the public HTTPS Identity
endpoint. The Edge and Identity recovery gates passed. The packaged Agent
bootstrap then exposed a renderer-only phone-endpoint gate before an Agent
could be registered, so the mandatory rollback was executed and verified.
OpenSpec 7.4 remains incomplete.

No credential, Token, private Provider origin, external account display value,
unredacted User/Device identity or replayable authorization appears here.

## Exact preflight and revised-order cutover

Immediately before mutation:

- local branch, HEAD, pushed origin branch and clean worktree all matched the
  approved commit;
- the old Edge was healthy with zero restarts, exact old revision
  `eaf9925092db2d488fa3dc61ae35ec054c80539a`, immutable old Caddyfile mount and
  SHA-256
  `4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0`;
- the retained candidate image, two isolated networks, loopback listener,
  restart policy, protected cutover assets, approval marker and both retained
  validation containers matched the first-attempt receipt;
- candidate health/readiness returned 200; the database remained ready v14 at
  catalog fingerprint
  `7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d`,
  with 49 tables, 636 columns, 494 constraints, 124 indexes and all five safety
  counters at zero;
- the candidate aggregate remained 7 User principals, 7 OIDC identities, 23
  Devices and 15 Agents; the public old stack returned 200/200/401 and the
  exact frozen issuer.

The loopback-bound U0 process was gracefully stopped without changing its
profile or native secret stores. The candidate was then given only its retained
unique Edge alias and restart policy, and the Edge was recreated through the
same immutable base compose plus the same approved override. On the first
bounded verification pass, Edge health, candidate revision, exact Caddyfile
mount/SHA-256, public health/readiness, unauthenticated `/v1/me` and issuer were
all exact.

## Packaged U0 result

The same executable and U0 profile were launched with Identity Cloud base
`https://cloud-test.sciforge.cn`, the unchanged
`https://login-test.sciforge.cn/realms/SciForge` issuer and browser bridge
disabled. The packaged Identity UI reported that the Desktop was connected.
The candidate aggregate stayed at 23 Devices, proving that the existing Device
was recovered rather than duplicated.

Saving the exact HTTPS Collaboration origin succeeded and persisted the normal
connection setting. The connection remained disconnected because no local
Agent authority existed yet. After a non-secret Agent display name was entered,
the product still disabled `Register this SciForge`. U0 has no verified phone
endpoint, and the renderer had made an active endpoint an extra prerequisite
for Agent registration. An explicit `Connect` attempt could not substitute for
registration and returned the bounded capability-handler failure. No Agent,
Agent credential, endpoint, Project or Provider mutation was created; the
candidate aggregate remained 7/7/23/15.

## Root cause and minimal repair

The Cloud `agent.register` service and Identity-owned Agent runtime implement
the frozen bootstrap order: current OIDC User, ACTIVE Device, configured
Runtime, then one Agent for that Device. They do not require a Human endpoint.
Pairing is an independent optional binding. The renderer nevertheless disabled
the registration button when
`participant.endpoints.some(status === "active")` was false. This was a stale
UI precondition, not a Cloud authorization rule, and it made first Agent
registration impossible for an otherwise valid Connected Desktop.

The minimal general repair removes only that renderer precondition and adds a
public-render test proving that a named Agent can be registered with zero Human
endpoints. It does not bypass OIDC, Device, Runtime, HTTPS, Agent credential or
Cloud authorization gates; it adds no module, provider special case or test-only
production path. Focused Collaboration tests, package typecheck, changed-file
lint, the complete collaboration security suite and the changed-path
architecture-principles gate pass with the repair.

## Verified rollback and local profile restoration

The packaged failure triggered the approved automatic sequence:

1. The public-bound U0 process was gracefully stopped first.
2. Only the Edge service was recreated from the immutable old base compose and
   old revision.
3. The old revision, mount, Caddyfile SHA-256, healthy state, public 200/200/401,
   revision header and frozen issuer all passed on the first bounded poll.
4. Only then was the candidate detached from the Edge network and its restart
   policy restored to `no`.

The successful settings write was the only new local persistent file. Returning
that file unchanged to a protected mode-`0600` rollback-evidence location
(SHA-256
`6a1e6ed3dcd2e4277596922b323568b192e825e0bf8ec16c2e47191b3bbe00d6`)
restored the Collaboration setting to its pre-attempt absence without deleting
evidence. The same U0 profile then restarted against the retained loopback
candidate and recovered its connected Identity state. No native secret store or
OpenContent setting was moved or rewritten.

## Next approval boundary

The retained server candidate, database, cutover assets, validators, approval
marker, old stack and rollback target remain unchanged. A third attempt requires
one newly sealed packaged artifact from the clean pushed repair commit, a fresh
packaged preflight proving the registration control is available without a
phone endpoint, and a new explicit Human approval. The server selection diff
and exact rollback commands remain unchanged. No current approval authorizes a
third Edge mutation, old-stack retirement, evidence cleanup, five-device
completion or an upstream pull request.

Receipt generated at `2026-08-26T10:21:22Z`.
