# Design: A-owned ContentSpace collaboration contract

## Context

Cloud collaboration must coordinate file-bearing Tasks without becoming a second ContentSpace implementation. E/Host owns decoding locators and deciding whether the current Principal may read or upload. A owns Projects, Tasks, execution fencing, derived Cloud references, OIDC/Device/Agent identity, and governed human approval.

Three database ancestries exist: common upstream v4, old public A v5, and isolated A v9. Their reused migration numbers have different SQL, so version alone cannot select a migration path.

## Decisions

### Locator and authorization are separate facts

`PortableContentSpaceLocator` is a bounded opaque locator. It never grants authority. A calls a configured E/Host verifier with the current exact actor Principal, locator, and opaque proof. The verifier returns a sanitized authorization record. A cross-checks its proof digest, locator digest, current `userId`, and `actorPrincipalDigest`, then stores only those verified facts.

Changing from one OIDC identity or credential Principal to another changes `actorPrincipalDigest`; a proof verified under the former Principal cannot be replayed under the latter.

### `fileIntent` is the only caller file truth

A caller may submit only typed `TaskFileIntent`: one to 100 input-file locators plus an upload-new output at the active Project binding root. The request schema is strict and rejects `resourceRefIds`. Inside the same database transaction, A derives one input `CloudResourceRef` per input and one output-container reference. Returned IDs are projections, never caller authority.

### `executionId` is the only epoch

Each assignment/reassignment creates one new `executionId`. Its persisted fence contains assignee Agent, Task revision, Project binding revision, and intent digest. Accept/progress/result/failure/HumanNeeded paths require the current tuple. Reassignment invalidates prior ResourceRefs; unbinding is rejected while a file Task execution remains open. No `assignmentEpoch` alias exists.

### Forward-only lineage converges at v11

The migrator first classifies the exact source through migration facts and a full PostgreSQL catalog fingerprint. Only fresh, v4, v5, and v9 are accepted. One new `0011` migration normalizes A-owned structures and records version 11. Readiness recomputes the authoritative schema descriptor fingerprint. Unknown, mixed, or partially copied ancestry fails before DDL.

Historical non-authoritative columns may remain to preserve audit data, but service writes and authorization never read them as truth.

## Scope controls

The implementation modifies only collaboration contracts, canonical collaboration server, domain-collaboration adapter, canonical server deployment templates, OpenSpec, and mechanical package metadata. It does not port WorkerRunner, identity UI, ContentSpace materialization, or a parallel deployment tree.

## Verification

PostgreSQL 17 integration runs each of the four routes against isolated loopback databases and asserts zero skips, the same schema fingerprint, concurrent binding fencing, current-Principal proof binding, server-derived typed ResourceRefs, unbind/reassign fencing, and stale execution rejection. The branch does not deploy public infrastructure.
