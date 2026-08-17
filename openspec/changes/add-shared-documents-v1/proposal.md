## Why

> Status: deferred by ADR-0025. This proposal is retained as the reviewed future domain design and is not an active predecessor of the current OpenContent Content Space delivery.

SciForge needs one provider-neutral Shared Documents capability for live Human-Agent collaboration without embedding a vendor editor, mirroring editable content, or binding Agent Runtime to one service. Provider-specific document APIs, Skills, authentication, evidence, and readiness belong to independently composed DocumentProvider integrations.

## What Changes

- Add the trusted compile-time `shared-documents` domain package with explicit contract, main, and minimal renderer launcher entrypoints.
- Define the DocumentProvider SPI and consume only `main.document-provider-factory` contributions from `add-provider-composition`.
- Define portable live DocumentReference, AuthoritativeRevision, structured snapshot, frozen logical operation, prepared handle, confirmation, conflict, receipt, readiness, and bounded error contracts.
- Route UI and Agent callers through one Capability Broker/domain service and the selected pinned Provider.
- Keep Provider content authoritative and exclude editable mirrors, Workspace/Git projection, raw Provider/Connector access, whole-file fallback, private API, DOM automation, and runtime Provider installation.
- Provide only a generic safe DocumentLaunchTarget path; each Provider owns its browser editor UI.

## Capabilities

### New Capabilities

- `shared-documents`: Provider-neutral live document identity, discovery, safe launch, structured observation, prepare-confirm-apply, revision/conflict/idempotency/audit contracts, readiness, privacy, and bounded errors.

### Modified Capabilities

None in this change. Required generic Broker/trace/confirmation capabilities remain independently owned prerequisites.

## Impact

- Adds `packages/domains/shared-documents` through standard manifest/generated composition.
- Depends on `add-portable-resource-references`, `add-provider-composition`, and the existing governed Broker/trace/confirmation baselines, not on OpenContent or any Provider integration.
- Enables public contracts, mocks, catalog tests, launcher boundaries, and governance tests while real Provider operations remain independently gated.
- OpenContent behavior is owned by `add-opencontent-document-provider-v1` and may pause without blocking this domain.
