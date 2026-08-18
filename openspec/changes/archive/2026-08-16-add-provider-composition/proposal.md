## Why

Content Space and later Shared Documents need replaceable Provider implementations without turning Host Core into a vendor router, merging their semantics into a universal optional-method Provider, or relying on package load order. The latest generic main extension host and runtime lifecycle are the canonical composition mechanism.

## What Changes

- Define independent `main.document-provider-factory` and `main.content-space-provider-factory` locations carried by generic `main.extension` declarations.
- Bind declaration/runtime location, version, Provider Kind, contribution owner, and factory exactly.
- Compose separate domain-owned catalogs with duplicate and incompatibility rejection.
- Add trusted non-secret `main.provider-instance-directory-entry` extensions for opaque ProviderInstanceRef resolution.
- Route directory → exact domain catalog → pinned factory → operation, with lazy Provider creation and no startup remote side effects.
- Fail unknown, missing, duplicate, incompatible, unauthorized, unavailable, and uncertain outcomes without defaults or fallback.

## Capabilities

### New Capabilities

- `provider-composition`: Trusted domain-specific Provider factory and Provider Instance contributions with instance-pinned, fail-closed routing.

### Modified Capabilities

None.

## Impact

- Extends public Domain SDK main-extension contracts; Host remains business- and vendor-neutral.
- Content Space owns ContentSpaceProvider catalog/service. DocumentProvider remains a separate later domain concern.
- Uses standard manifests, generated source/packaged composition, and runtime lifecycle rather than a legacy Host provider registry.
- Adds no credentials, login, Provider transport, UI, runtime plugin system, compatibility shim, or fallback.
