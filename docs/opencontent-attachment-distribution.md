# OpenContent attachment distribution boundary

团队成员的中文安装、启动和故障处理流程见
[《SciForge OpenContent 私有附件技能安装与运行手册》](./opencontent-private-attachment-runbook.zh-CN.md)。

SciForge's OpenContent integration is public source. The only non-public material is the supplier
attachment delivered separately to the team. This boundary applies to source archives, npm
packages, application bundles, CI artifacts, pull requests, and release uploads.

## Keep public

The following are normal SciForge source and may remain in the open-source project:

- `packages/domains/opencontent-connector/`;
- `packages/domains/opencontent-content-space-provider/`;
- `packages/opencontent-skill-runtime/`, which contains SciForge-authored contracts, adapters,
  process isolation, and asset-loading code, but no supplier payload;
- `docs/OpenContent SDK离线文档v9.0.0.0.md` and other OpenContent integration documentation;
- provider-neutral Content Space contracts, Host/Broker routing, tests, and generated capability
  descriptions.

OpenContent is one Content Space Provider. Keeping this integration public does not make it a Host
dependency or prevent SciForge from replacing the Provider in a future release.

## Keep private

Only these items must be excluded from every public distribution:

- the original supplier attachment archive and its byte-for-byte extracted files;
- the internal asset package, supplier-derived patch data, provenance, file inventory, checksums,
  and group-distribution metadata stored under `internal/opencontent/**`;
- any group-only archive and checksum sidecar generated from that internal overlay.

`internal/opencontent/**` is the complete repository-relative hide/delete list. It is ignored by
Git and is installed or removed as one optional internal overlay. Do not move copies of its payload
into public fixtures, generated documentation, package tarballs, application resources, or release
artifacts.

## Runtime behavior with and without the attachment

Installing an attachment changes runtime inventory, not per-operation live evidence, readiness, or
production admission. The exact packaged outcomes are maintained only in the
[OpenContent capability matrix](./opencontent-skill-capability-matrix.md); the currently verified
ordinary-operation subset remains `poc_only`, no native-document operation has a live-success claim,
and OpenContent has zero `production_ready` operations:

- Provider discovery can enumerate the installed Provider Instance but admits no Provider business
  operation;
- the six ordinary personal/Team-library operations and all ten Team Administration operations are
  `poc_only` / `verification_profile_required`;
- the public Team member-role and ownership-transfer delegates are also PoC-only;
- Content Space exposes no generic Agent Project-provisioning capability; the provider-neutral
  provisioning port is dormant and Provider operation `provision-project` is blocked until a
  Project-owning consumer supplies an authoritative binding;
- no Team deletion operation exists.

Installing a valid internal overlay additionally enables the supplier-backed native-document and
extended-operation runtime. Nine safely contract-shaped native-document operations and 53 extended
operations remain PoC-only. Native `edit`, the other nine hash-bound native mutations, import
without a source/content postcondition, and `updateFileVersion` remain `blocked_by_contract`;
attachment presence cannot admit them. Immutable
version observation is also blocked, so OpenContent cannot issue an `ArtifactReference`.

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

Official public release entrypoints fail closed when internal runtime composition is non-empty.
An explicitly internal/local package may include the verified overlay for acceptance, but merely
installing an overlay must never change an official public release artifact.

Before publishing, use the official public release entrypoint and verify that
`internal/opencontent/**` is absent and that no public lockfile, tarball, packaged application, or
generated artifact contains the internal asset package or supplier payload. Do not delete the
public OpenContent integration or SDK documentation.
