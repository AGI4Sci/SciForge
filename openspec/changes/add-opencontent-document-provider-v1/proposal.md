## Why

> Status: deferred by ADR-0025. This adapter follows a completed Shared Documents domain and a separately reviewed Connector Document port; it is not part of the current Content Space track.

OpenContent is the initial DocumentProvider candidate, but its discovery, metadata, browser launch, structured `.mdoc`, concurrency, and Skill evidence have different readiness. A separate adapter package keeps those Gates out of Shared Documents and lets the track pause without blocking the provider-neutral domain.

## What Changes

- Add trusted compile-time main-only `opencontent-document-provider`.
- Implement DocumentProvider for Provider Kind `opencontent` and register `main.document-provider-factory` through generated composition.
- Consume only the composition-bound token-free document port from `opencontent-connector`.
- Define separately gated support for `mdoc`, `docx`, `xlsx`, and `pptx` discovery/reference/metadata/capability/launch.
- Keep structured `.mdoc` read/create/change blocked until the formal Skill/API and security/concurrency contracts pass; Office structured edit remains unsupported.
- Expose no vendor-specific Agent tool, raw Skill, raw Client, private API, DOM automation, whole-file semantic fallback, or editor UI.

## Capabilities

### New Capabilities

- `opencontent-document-provider`: OpenContent implementation of DocumentProvider with independent discovery, launch, structured-content, write, session, privacy, and Skill acceptance Gates.

### Modified Capabilities

None.

## Impact

- Adds one optional integration package; it changes no Host switch, Agent Runtime branch, Shared Documents contract, or renderer editor.
- Depends on the implemented Provider Composition/Portable Resource References foundations, a future completed `add-shared-documents-v1`, and a separate reviewed change that extends `opencontent-connector` with an independently authorized Document port after ADR-0025 permits it.
- May be omitted or paused while Shared Documents mocks and other DocumentProviders continue.
