## ADDED Requirements

### Requirement: Optional supplier assets have one resolution path per application mode

The Connector SHALL load optional supplier assets in source mode only from the fixed internal overlay beneath the absolute Host-injected application repository root after a shared public generic verifier proves the exact overlay identity, root, receipt version, complete inventory, and per-file digests, and in packaged mode only from the fixed after-pack-verified Electron resources location. It SHALL NOT resolve a private package through `node_modules`, ancestor lookup, another checkout, a package-manager workspace link, source fallback from a packaged application, or packaged fallback from source. The public SciForge-authored runtime SHALL be bundled into the main application artifact through generic package-owned/generated build metadata and SHALL NOT require private source code or TypeScript package entrypoints at runtime.

#### Scenario: Shadow private package exists in node_modules

- **WHEN** source mode has no fixed repository overlay but an ancestor or local `node_modules` contains a matching private package name
- **THEN** the optional runtime SHALL remain unavailable and SHALL NOT load the shadow package

#### Scenario: Fixed source overlay lacks current integrity evidence

- **WHEN** the fixed source overlay is present but its receipt is missing, wrong-version, malformed, changed, or has missing/extra/escaping files
- **THEN** Connector activation SHALL fail closed before it publishes or invokes the supplier runtime

#### Scenario: Packaged resources omit the supplier assets

- **WHEN** a packaged application lacks the fixed verified resource directory
- **THEN** the optional runtime SHALL remain unavailable without consulting the source tree or `node_modules`

### Requirement: Supplier code executes only through the canonical Connector transport

Install, dependency resolution, build, packaging, validation, and public release SHALL NOT execute supplier attachment code. Executable supplier assets SHALL run only after packaged/source integrity validation inside the Connector-owned main-process transport with the current Principal-bound credential session, bounded command allowlist, cancellation, and redaction.

#### Scenario: Packaging validates an attachment

- **WHEN** a build or after-pack hook checks installed supplier assets
- **THEN** it SHALL use SciForge-owned static inventory and digest validation and SHALL NOT invoke the supplier CLI or inherit release credentials into supplier code
