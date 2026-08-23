# OpenContent attachment distribution boundary

团队成员的中文安装、启动和故障处理流程见
[《SciForge OpenContent 私有附件技能安装与运行手册》](./opencontent-private-attachment-runbook.zh-CN.md)。

SciForge's OpenContent integration is public source. The non-public deployment inputs are the
Connector deployment sidecar and the supplier attachment delivered separately to the team. This boundary applies to source archives, npm
packages, application bundles, CI artifacts, pull requests, and release uploads.

## Keep public

The following are normal SciForge source and may remain in the open-source project:

- `packages/domains/opencontent-connector/`;
- `packages/domains/opencontent-content-space-provider/`;
- `docs/OpenContent SDK离线文档v9.0.0.0.md` and other OpenContent integration documentation;
- provider-neutral Content Space contracts, Host/Broker routing, tests, and generated capability
  descriptions.

OpenContent is one Content Space Provider. Keeping this integration public does not make it a Host
dependency or prevent SciForge from replacing the Provider in a future release.
The Connector domain package owns supplier wire contracts, asset loading, process isolation, and
transport. The Provider domain package owns receipt normalization and Content Space semantics.
There is no separately versioned OpenContent runtime feature package.

## Keep private

Only these items must be excluded from every public distribution:

- `.sciforge/private/deployments/opencontent-connector.json`, which binds the fixed Provider
  Instance to one private deployment HTTPS origin;
- the original supplier attachment archive and its byte-for-byte extracted files;
- the internal asset package, supplier-derived patch data, complete receipt/provenance inventory,
  and group-distribution metadata stored under `internal/opencontent/**`;
- any group-only archive and checksum sidecar generated from that internal overlay.

The public Connector package retains only the minimal immutable trust anchors required to reject a
forged or byte-drifted installation: the expected overlay identity and the SHA-256/size of the five
executable contract files it can load. These anchors disclose no attachment bytes and are not a
replacement for the private complete receipt, inventory, archive, or checksum sidecar.

The complete repository-relative private inputs are the declared deployment sidecar and
`internal/opencontent/**`. They are ignored by Git and managed independently: the sidecar controls
Connector runtime availability, while the overlay adds supplier runtime inventory. Do not move copies
into public fixtures, generated documentation, package tarballs, application resources, or release
artifacts.

## Runtime behavior with and without the attachment

The Connector manifest declares deployment contract version `1`, source path
`.sciforge/private/deployments/opencontent-connector.json`, packaged path
`domain-deployments/opencontent-connector.json`, a `4096`-byte limit, and
`publicRelease: forbidden`. Generic packaging preserves every declaration,
captures one immutable composition, and copies only an existing source as an opaque private
resource with an exact size and SHA-256 receipt. After pack, the same captured composition requires
each active target to match and every inactive target to be absent; it is never recomputed from a
possibly changed source tree.
The Connector then accepts only strict JSON for the fixed Provider Instance and an absolute HTTPS
origin with no userinfo, path, query, fragment, or extra fields. Missing or invalid configuration
keeps discovery registered but returns `provider_unavailable` before storage, credentials, network,
or supplier execution. Resolution requests no-follow semantics where available, binds the opened
descriptor to the pre-open regular-file identity, performs one bounded read, verifies identity, size,
modification time, change time, and birth time before and after the read, and closes the descriptor.
It never falls back to environment, argv, caller, renderer, or package settings. The
isolated `resources/domain-deployments/**` target does not create the separately verified
`resources/opencontent/**` supplier overlay.

Installing an attachment changes runtime inventory, not per-operation live evidence, readiness, or
production admission. The exact packaged outcomes are maintained only in the
[OpenContent capability matrix](./opencontent-skill-capability-matrix.md); the currently verified
ordinary-operation subset remains `poc_only`, no native-document operation has a live-success claim,
and OpenContent has zero `production_ready` operations:

- Provider discovery can enumerate the installed Provider Instance but admits no Provider business
  operation;
- the six ordinary personal/Team-library operations and all ten Team Administration operations are
  `poc_only` / `verification_profile_required`;
- session-backed `getCurrentPrincipal` is PoC-only and dispatches no supplier command, so it remains
  the sole extended PoC candidate without the attachment; the other 49 extended operations remain
  blocked until their required overlay-backed contract is available;
- Team Administration membership represents member identity only through the typed `member` reference; no public member-role
  or ownership-transfer delegate exists, and its five root/member mutations declare
  `concurrency.revision: "none"` because the supplier exposes no Administration CAS field;
- Content Space and the OpenContent Provider expose no Project-provisioning capability,
  operation, intent/report schema, or Provider port; a future Project-owning integration requires
  a separately reviewed authoritative contract;
- no Team deletion operation exists.

Installing a valid internal overlay additionally enables the supplier-backed native-document and
extended-operation mechanism. Nine safely contract-shaped native-document operations and 40 of 50 extended
operations remain PoC-only. Native `edit`, the other nine hash-bound native mutations, and import
without a source/content postcondition remain blocked. The exact extended blocked set, in catalog
order, is `resolveInternalLink`, `listMetadataChoices`, `updateFileVersion`, `searchUsers`,
`searchDepartments`, `searchPositions`, `searchGroups`, `resolveCollaborationInvitation`,
`listKnowledgeCollections`, and `searchKnowledgeCollections`;
attachment presence cannot admit them. Immutable
version observation is also blocked, so OpenContent cannot issue an `ArtifactReference`.

The Connector-owned static characterization freezes 86 supplier inventory commands and an exact
50-command admitted adapter union. The supplier `download`, `file-list`, `kbox-list`,
`file-internal-link`, `meta-modeldata`, and `collab-link` commands remain inventory-only; ordinary
`listEntries` and download use the typed Connector path, while native PDF export remains
`native-document:export`. Inventory presence is not packaged callability or live evidence.

A PoC invocation requires a separately reviewed package-owned Content Space profile that matches
the exact Provider Instance, complete Host Principal snapshot and assurance, authority, operation,
audience, bounded upload/download maxima, and validity window of at most 24 hours. The matched byte
maxima are enforced for the invocation. Provider-scoped operations, mutations, administration, and
non-zero transfers additionally require a v2 Provider Binding Attestation containing the exact
Provider Instance and Principal plus an opaque external subject and opaque Connection revision.

Content Space obtains the attestation only through the pinned Provider. Immediately before each
business dispatch, the Provider passes the exact expectation to the Connector, which reauthenticates
the actual current session and requires a recomputed exact match; unbind/rebind drift therefore fails
before supplier dispatch. The attestation is token-free and non-portable, and raw account identifiers
do not enter caller input. Zero-transfer `list-containers` bootstrap and exact-root reads remain the
only operations profile-safe without it. The default composition installs no active profile, and
caller input, renderer/Agent state, ordinary configuration, or attachment presence cannot install
or widen one.

The overlay does not create a second Agent tool, transport, authorization path, or Provider
contract. The precise readiness matrix and packaged evidence are maintained in the
[OpenContent Skill Capability Matrix](./opencontent-skill-capability-matrix.md), and the governing
architecture decision is [ADR-0030](./adr/0030-activate-provider-native-documents-through-content-space.md).
The complete module boundary and canonical call chain are in the
[Content Space architecture guide](./content-space-architecture.md).

## Installation and resolution contract

The public root workspace and `package-lock.json` exclude `internal/**`. Install public
dependencies from the repository root, then verify and install the approved archive with the
SciForge-owned installer documented in the Chinese runbook. Installation writes only:

- the overlay under `internal/opencontent/**`; and
- its trusted complete-inventory receipt under `.sciforge/internal-overlays/**`.

Do not run a root `npm install` to create a private workspace link, and do not copy the private
package into `node_modules`. The source application resolves assets only below the absolute
Host-injected repository root at
`internal/opencontent/packages/opencontent-skill-assets/assets/opencontent-base-1.0.1`.
Source activation itself revalidates the exact overlay identity, root, receipt version, complete
inventory, and digests through the same public generic integrity implementation used by packaging.
The packaged application resolves them only from
`resources/opencontent/opencontent-base-1.0.1`; neither mode falls back to the other or searches
`node_modules`.

Source activation, build, and packaging validate the complete receipt, containment, required entrypoints, and per-file
digests with SciForge-owned static code. They reject missing, changed, extra, escaping, or
unreceipted bytes and do not execute the supplier CLI. Supplier code runs only through the
Connector-owned main-process transport after normal Broker, Principal, readiness/verification, and
resource admission.

Official public release entrypoints fail closed when internal runtime composition is non-empty or
when any active deployment configuration declares `publicRelease: forbidden`.
An explicitly internal/local package may include the verified overlay for acceptance, but merely
installing an overlay must never change an official public release artifact.

Before publishing, use the official public release entrypoint and verify that
the deployment sidecar and `internal/opencontent/**` are absent and that no public lockfile, tarball, packaged application, or
generated artifact contains the internal asset package or supplier payload. Do not delete the
public OpenContent integration or SDK documentation.
