## Why

SciForge needs one provider-neutral Content Space capability and UI for ordinary containers/files, bounded navigation, create-folder, upload-new, download, safe portal launch, portable identity, and evidence-gated immutable artifacts. Those semantics must remain usable with a local mock and independent of OpenContent, credentials, Connector transport, Shared Documents, or cloud collaboration.

## What Changes

- Add trusted compile-time `content-space` and `content-space-mock-provider` packages with standard manifests and separate definition/main/renderer entrypoints.
- Own the strict ContentSpaceProvider contract, domain catalog/service, portable codecs/resolver, capability handlers, and provider-neutral renderer.
- Compose Provider factories and instances through exact generic main extensions and canonical runtime lifecycle.
- Route UI, Agent, and trusted system callers only through Broker → Content Space handler → service → directory → catalog → pinned Provider → operation.
- Require current Principal, explicit targets, bounds, cancellation, a Broker-admitted out-of-band invocation identity, typed conflict, and `outcome_unknown` for writes.
- Keep downloads in a Host-owned destination and provider portal targets behind short-lived opaque main-process grants.
- Issue ArtifactReference only after exact immutable version/retention/retrieval proof.
- Exclude OpenContent APIs, credentials, Connectors/adapters, Shared Documents, collaboration, destructive file lifecycle, migration, and fallback.

## Capabilities

### New Capabilities

- `content-space`: Provider-neutral browsing and V1 ordinary-file operations with portable references and immutable-artifact gates.

### Modified Capabilities

- `provider-composition`: Consume trusted generic Provider Instance directory entries before selecting a domain factory.

## Impact

- Adds two independently owned compile-time domain packages discovered only by standard manifest/generated composition.
- Extends generic Broker transport only where needed to carry admitted invocation context and cancellation, plus Host-owned transfer and opaque portal grants.
- Uses the latest generic renderer contribution host and current application composition; no parallel registry or Host feature switch is added.
- Establishes the prerequisite sequence for Secure Provider Credentials and the later optional OpenContent track.
