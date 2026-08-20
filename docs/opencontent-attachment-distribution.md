# OpenContent attachment distribution boundary

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

The public checkout remains useful without the private overlay:

- Provider discovery and the six ordinary personal/Team-library file operations remain
  `production_ready` / `available`;
- all ten Team Administration operations remain `production_ready` / `available`;
- Project Content Directory provisioning remains `production_ready` / `available`;
- Team member-role change and ownership transfer remain `production_ready` / `available` through
  the public Team Administration path;
- no Team deletion operation exists.

Installing a valid internal overlay additionally enables the supplier-backed native-document and
extended-operation runtime. It does not create a second Agent tool, transport, authorization path,
or Provider contract. The precise readiness matrix is maintained in the
[OpenContent Skill Capability Matrix](./opencontent-skill-capability-matrix.md), and the governing
architecture decision is [ADR-0030](./adr/0030-activate-provider-native-documents-through-content-space.md).

Before publishing, verify that `internal/opencontent/**` is absent and that no public lockfile,
tarball, packaged application, or generated artifact contains the internal asset package or
supplier payload. Do not delete the public OpenContent integration or SDK documentation.
