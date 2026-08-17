## Why

After Content Space V1, Secure Provider Credentials, and the OpenContent Connector Content Space port are complete, OpenContent needs an optional adapter that implements the provider-neutral ContentSpaceProvider contract. Keeping that mapper/factory in its own package lets the vendor track be paused or fail without changing Content Space, Host Core, its UI, or other Providers.

## What Changes

- Add an optional trusted compile-time, main-only `opencontent-content-space-provider` package.
- Register exactly one generic `main.extension` at `main.content-space-provider-factory` for Provider Kind `opencontent`, with exact declaration/runtime version/location/owner binding.
- Acquire only the Host-issued owner-scoped token-free Content Space facade from `opencontent-connector`; no raw callable port is exposed through the global contribution host.
- Map pinned OpenContent transport facts into strict Content Space references, capabilities, readiness, results, errors, progress, cancellation, and uncertain-write semantics.
- Use the Connector-contributed trusted non-secret OpenContent Provider Instance entry and remain pinned to the selected instance; add no dynamic registration, default, or fallback.
- Register no portable codec/resolver, renderer, public capability, IPC/MCP, credential store, raw client, or DocumentProvider.
- Keep every operation blocked through the normal product path; the following cloud-space PoC change must add a trusted Content Space service policy/audience Gate before any exact evidence-backed `poc_only` operation can execute.

## Capabilities

### New Capabilities

- `opencontent-content-space-provider`: Future optional OpenContent implementation of ContentSpaceProvider with strict mapping and operation-specific readiness.

### Modified Capabilities

None.

## Impact

- Depends in order on Content Space V1, Secure Provider Credentials, and the Connector Content Space port.
- Changes no Host feature switch, Agent branch, Content Space contract/UI, portable resolver, or generated-composition exception.
- Shared Documents, a Document Connector port, and OpenContent DocumentProvider are not prerequisites and remain deferred.
- Cloud-space PoC admission follows this adapter and requires its own exact evidence/environment decision.
