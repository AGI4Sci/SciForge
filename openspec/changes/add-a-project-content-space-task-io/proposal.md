# Change proposal: bind Projects to authorized ContentSpace locations and type Task file intent

## Why

Cloud Collaboration currently has no canonical contract connecting a Project to a ContentSpace location, and a Task cannot state its file inputs and outputs without treating provider-specific resource identifiers as caller-authored truth. That makes authorization, reassignment fencing, and result provenance ambiguous.

This change gives A ownership of the Cloud collaboration facts while preserving E/Host ownership of ContentSpace access. A stores an opaque portable locator and a separately verified authorization-proof binding; the locator never grants access. Each Task stores one typed `fileIntent`, and Cloud derives every `resourceRefId` from that intent. One `executionId` is the only execution epoch and is fenced by the assignee, Task revision, Project binding revision, and intent digest.

The collaboration database also has three deployed ancestries that reused migration numbers with different SQL: the common upstream schema v4, the former public A schema v5, and isolated staging schema v9. This change freezes a forward-only lineage classifier and converges fresh/v4/v5/v9 through the new schema-v11 migration.

## Scope

- Rewrite `ProjectContentSpaceBinding`, provider-neutral Cloud `ResourceRef`, and typed `TaskFileIntent` contracts.
- Make `fileIntent` the sole client-authored file truth; create and persist `resourceRefIds` only inside the service transaction.
- Use `executionId` as the sole execution epoch and persist its complete fence tuple.
- Require an E/Host authorization proof for the current Principal when creating or revising a Project binding.
- Port only A-owned OIDC, Device, Agent, and governed human-approval server semantics needed by the canonical collaboration service.
- Converge the three known PostgreSQL ancestries through one forward-only migration and one final schema fingerprint.
- Extend only the canonical collaboration deployment and OpenSpec contracts.

## Explicit exclusions

- B WorkerRunner behavior or implementation.
- C identity or collaboration UI.
- E ContentSpace provider/host implementation.
- A second deployment tree or compatibility runtime.
- Treating a portable envelope, resource locator, provider display name, or caller-supplied `resourceRefId` as authorization.
- Introducing `assignmentEpoch` or any execution-epoch alias.
- Public deployment in this change.

## Compatibility and rollout

The migration is forward-only. A database is admitted only when its migration rows and catalog fingerprint match exactly one frozen source route. Unknown, mixed, partially copied, or already-mutated layouts fail before DDL or data writes. All accepted routes converge to one exact final fingerprint and retain their existing collaboration data.

The first checkpoint froze the lineage without allocating a number. After the checkpoint, PostgreSQL 17 source classifiers were proved and version `11` was selected. No historical migration number was reused. Public deployment remains explicitly out of scope.
