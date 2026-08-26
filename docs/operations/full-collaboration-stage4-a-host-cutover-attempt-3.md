# Stage 4 A-host cutover attempt 3 and verified rollback

This receipt records the third explicitly approved OpenSpec 7.4 attempt. The
approval named clean, pushed source commit
`ac5c96561f2a2551eaa17a723a988a65a921870a`, authorized stopping the
default-profile application, selecting only the retained candidate through the
existing public Edge, and required the exact frozen rollback after any failed
gate. Public Identity, the existing Device and sole U0 Agent, and Collaboration
all recovered through the candidate. Project Coordinator then failed before
Project creation because its renderer invocation omitted the confirmation
approval required by its main capability definition. U0 was stopped and the
exact old public Edge was restored. OpenSpec 7.4 therefore remains incomplete.

No credential, Token, private Provider origin, external account value,
unredacted Human identity or replayable authorization appears here.

## Preflight and public selection

Immediately before mutation:

- the approved branch, local HEAD and personal-fork branch matched
  `ac5c96561f2a2551eaa17a723a988a65a921870a`;
- the default-profile SciForge process was closed through the normal application
  quit path and released its Identity database locks;
- the retained old Edge revision, immutable Caddyfile mount and SHA-256 matched
  the frozen rollback packet;
- the candidate image revision remained
  `763cc5a5619cc11cc491e75edb5f04dfb2e4deac`;
- the candidate v14 catalog remained 49 tables, 636 columns, 494 constraints
  and 124 indexes at fingerprint
  `7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d`;
- all five candidate safety invariants were zero and the aggregate remained 7
  User principals, 7 OIDC identities, 24 Devices and 16 Agents; and
- public old-stack health/readiness, unauthenticated `/v1/me` and the exact
  frozen issuer passed.

The candidate received only its retained unique Edge alias and the approved
restart policy. Only the Edge service was recreated from the immutable base
compose plus the frozen one-line override. Public `/healthz`, `/readyz`,
unauthenticated `/v1/me`, the candidate revision header, exact Caddyfile mount
and digest, and OIDC discovery passed. The old app and database remained
running and untouched.

## Source U0 live result

The exact source application and retained U0 profile were launched with
Identity and Collaboration both using `https://cloud-test.sciforge.cn` and the
unchanged issuer. The live UI proved:

- the same OIDC User and Desktop Device were connected without creating a
  duplicate Device;
- the one existing `Stage4-U0` Agent remained active and online without
  creating a duplicate Agent;
- Collaboration reported `Connected`; and
- the candidate aggregate remained 7/7/24/16 with exactly one U0 availability
  projection.

Project Coordinator needed one real Project before it could display the
Project-scoped online User and Agent projection. The Owner supplied the exact
visible U0 Agent and current revision in the create form. The application
returned:

`Capability project-coordinator.project.create requires confirmation approval for this invocation.`

A forced read-only database check proved that the U0 Owner still owned zero
Projects. No Project, membership, Plan, Provider, Task or content write occurred.

## Root cause and minimal repair

The main Project Coordinator capability factory declares 14 external or
destructive UI actions with `approval: 'confirmation'`. The renderer client
invoked all 14 without the Host confirmation option, while its four read and
two local-draft actions correctly required no approval. The failure was
therefore a package-internal renderer/main contract drift, not an OIDC, Cloud,
Alibaba Cloud, Agent HTTP/WSS, profile or Provider failure.

Commit `bc702433` adds the standard renderer confirmation option to those 14
existing calls and adds one contract-alignment test that derives the expected
approval mode directly from the real main capability definitions. It adds no
module, bypass, compatibility path, provider special case or test-only
production behavior.

Validation after the repair passed:

- the red/green renderer/main approval matrix: 1/1;
- Project Coordinator package tests: 62/62;
- Project Coordinator typecheck and changed-file lint;
- Host renderer approval and IPC tests through the repository Vitest entry:
  19/19;
- capability governance: 292 actions, fresh generated composition, no bypass;
- domain package/tarball boundary tests: 17/17.

## Verified rollback

The failed Coordinator gate triggered the approved sequence:

1. The public U0 source process was stopped first and its profile was retained.
2. Only the Edge service was recreated from the immutable old base compose and
   exact old revision.
3. The first verification wrapper mistakenly queried non-contract `/health`
   and `/ready` paths and stopped before candidate detachment. Read-only
   inspection showed the restored old app correctly serving the frozen
   `/healthz` and `/readyz` paths. No additional server mutation occurred while
   resolving that checker error.
4. The frozen checks then passed with old revision
   `eaf9925092db2d488fa3dc61ae35ec054c80539a`, exact old mount, Caddyfile
   SHA-256
   `4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0`,
   public 200/200/401 and the unchanged issuer.
5. Only then was the candidate detached from the Edge network and its restart
   policy restored to `no`.

The old app, old database and candidate all remain running. Candidate data,
cutover assets, approval marker, validation/audit containers and every earlier
evidence artifact remain retained. Nothing was deleted or down-migrated.

## Next approval boundary

The existing authorization ended at mandatory rollback and does not authorize
another public selection. A later attempt must use a fresh clone of the exact
pushed personal-fork source containing `bc702433`, re-run the unchanged
candidate/old-stack preflight, receive a new explicit Human cutover approval,
then repeat the U0 source smoke through Project creation and the Coordinator
online User/Agent count. It must retain the same rollback-on-any-failure rule.

No upstream operation, old-stack retirement, evidence cleanup, formal release
artifact, or five-Human completion was performed.

Receipt generated at `2026-08-27T00:43:18+08:00`.
