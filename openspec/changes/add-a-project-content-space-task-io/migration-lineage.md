# Forward-only collaboration migration lineage checkpoint

Status: **schema v11 allocated; all accepted routes proved on PostgreSQL 17 with zero skips**.

## Invariants

1. Existing migration rows are immutable facts. The migrator never edits, renumbers, or deletes them.
2. A numeric version is not sufficient identity because historical deployments reused versions `2` through `9` for different SQL.
3. Admission requires both an exact ordered migration-version set and an exact catalog fingerprint made from tables, columns, nullability, types, primary/foreign/unique/check constraints, and required indexes.
4. The classifier runs under an advisory migration lock and read-only inspection before any DDL or data mutation.
5. Exactly one route must match. Zero or multiple matches fail closed as `collaboration_schema_lineage_unknown`.
6. The convergence migration is forward-only and idempotent only for its exact target fingerprint. It is never a compatibility facade.
7. All routes must end with the same authoritative schema descriptor fingerprint and recorded target version. Historical non-authoritative columns/tables MAY remain for audit compatibility, but SHALL NOT enter current authorization or execution decisions.

## Frozen source routes

### Route `upstream-v4`

- Provenance commit: `941dafba5f9b94ecd2afedb4a50a804f10f35dd8`.
- Ordered migration set: `1,2,3,4`.
- Migration identities:
  - `0001_collaboration_schema.sql`: `1f5eb0be06ff6b9eaa6e1d7e2080b19af8b2472723a9f5647e1842825537576e`
  - `0002_provider_identity_inbox.sql`: `b6165f6ef946a979c3bb27f521e43ad18e6fb66d02f1489ebc82e1be9997e517`
  - `0003_managed_provider_containers.sql`: `39ed7fc08c3643d92990084be1c12d5fb46d63f400380b7efd43f0e307fc9345`
  - `0004_remote_capability_approvals.sql`: `5d98dda3322fc821cc121b45fec391e2b2108c6f33ece395dd2011941ee61b0a`
- Source catalog fingerprint: `0577af72da028cee0f45daf6bbf8dad873f9ff2fde578662ffb30d50629b9843`.

### Route `public-a-v5`

- Provenance commit: `eaf9925092db2d488fa3dc61ae35ec054c80539a` (`feat(collaboration): enable OIDC human approval`).
- Ordered migration set: `1,2,3,4,5`.
- Migration identities:
  - `0001_collaboration_schema.sql`: `1f5eb0be06ff6b9eaa6e1d7e2080b19af8b2472723a9f5647e1842825537576e`
  - `0002_resource_refs.sql`: `5c0686123c92adf96e5d148a2ab4563c055a8a21f8be505817eb7be30bc5a235`
  - `0003_task_progress.sql`: `42a61c8ef8252c9522effefc83b81c949cedf474017ab9066b0f56850d883442`
  - `0004_coordination_contract.sql`: `34bc9ec114689805a0e27b8d9bb6b87c799e063068fa5a3890e00001704037fc`
  - `0005_unified_identity_device_bindings.sql`: `454dddbe063a0023f8d9b9942b8bb6468218eeaba3850fea7b6171ba185b3261`
- Source catalog fingerprint: `238d1ae31083f9bba86539e1be20630e89614ebf5df304ff7407bc3e40cfbc54`.
- Existing OIDC, Device, Agent, and human-approval rows are retained; only A-owned semantics are normalized.

### Route `isolated-a-v9`

- Source provenance commit: `910ef7e318bcd5c3306f8e42c38b8cfc624a86f3`.
- Source tree: `3629bbc0c0fdf57504008381725a429c33ce12c9`.
- Parent: `59713927367f65e02e5b5bf8c3652cddf48feff3`.
- Ordered migration set: `1,2,3,4,5,6,7,8,9`.
- Migration identities:
  - versions `1..5`: exact `public-a-v5` identities above
  - `0006_provider_identity_inbox.sql`: `e2ea263c4f943bf15e02820dc33d2d8ba878504b50a6c9d7ccc83590743c57a6`
  - `0007_portable_resource_refs.sql`: `1773351f19ef7e70bfdce01428d14e4889d31187fd2b506bdaf8ab80a1861b60`
  - `0008_managed_provider_containers.sql`: `0944dc35b43fd8a6c69ab040e933804dc080979e6d59b5e5c8cad552539b5d7a`
  - `0009_portal_bounded_reads.sql`: `ed5ed45d301c63de01547de007f715ff87e422f987ab470b2169e60618bb97da`
- Source catalog fingerprint: `d6f1098f4b1fcdaa3524c4d9924068e1073701ea8db6c668a425ee16dc2fcb0f`.
- Candidate eligibility: **withdrawn**. The running isolated instance is retained only as a donor/staging observation; it is not descended from the common base and cannot be promoted or deployed by this branch. See `staging-provenance.md`.

## Convergence contract

`0011_a_content_space_execution_identity.sql` is the only convergence migration after the reused historical numbers. It:

- preserve canonical users, identities, devices, agents, projects, memberships, tasks, records, inboxes, receipts, human requests/answers, provider identities, managed providers, and remote approvals where present;
- create or normalize only A-owned collaboration structures;
- add canonical Project ContentSpace binding, authorization-proof metadata, Cloud ResourceRef, Task file intent, and execution-fence storage;
- reject ambiguous duplicate identities, invalid foreign references, unfenced active executions, caller-authored resource references, and data that cannot be represented without guessing;
- acquire deterministic relation locks before validation/backfill and publish the final schema version only after all constraints and indexes validate;
- verify the final catalog fingerprint in the same transaction and again at readiness.

## Allocation and verification result

- Target version: `11`, strictly greater than every historical reused number.
- Migration file: `0011_a_content_space_execution_identity.sql`; no `0002`–`0010` file was added or replayed from the donor branch.
- Canonical authoritative schema fingerprint: `2edbeb3a49ae2ece3cac3a1bdb21ec2579f240cbbaebf5ae8cf5606fac166223`.
- PostgreSQL: `17.6`.
- Routes: fresh-v4, upstream-v4, public-v5, and isolated-v9.
- Result: every route reached schema v11 and the same canonical fingerprint with zero skipped assertions.
