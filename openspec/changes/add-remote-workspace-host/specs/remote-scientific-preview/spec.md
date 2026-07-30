# Remote Scientific Preview Requirements

## Requirement: Provider execution beside remote data

Remote-capable Workspace Preview providers SHALL execute on the Workspace Host that owns the source
file while their renderer contributions remain in the local Workbench.

### Scenario: Open a remote molecular file

- **WHEN** a remote session opens a supported molecular, sequence, omics, bioimaging, or spectra
  file
- **THEN** the matching package-owned provider SHALL read and parse it on the remote server
- **AND** the local renderer SHALL receive the existing canonical bounded observation.

### Scenario: Provider unavailable remotely

- **WHEN** the active package cohort has no compatible remote provider
- **THEN** the preview SHALL fail visibly as unavailable
- **AND** SHALL NOT download the complete file or invoke the local provider as a fallback.

## Requirement: Matching domain package cohort

Desktop renderer and Workspace Host provider contributions SHALL come from the same compatible
domain package version.

### Scenario: Server has a different Life Science Preview version

- **WHEN** the handshake detects a provider/renderer package mismatch
- **THEN** SciForge SHALL deploy the matching server cohort or reject activation before presenting
  the preview.

## Requirement: Bounded scientific transport

Remote scientific preview SHALL use bounded observations, ranges, thumbnails, tiles, and artifacts
instead of copying large source datasets to the desktop.

### Scenario: Large bioimaging source

- **WHEN** a remote image exceeds the normal observation limit
- **THEN** the provider SHALL read only required metadata/ranges and return bounded
  thumbnail/tile artifacts with truncation metadata.

### Scenario: Large sequence or omics source

- **WHEN** source records exceed provider limits
- **THEN** the observation SHALL report truncation and bounded summaries while preserving source
  revision and provenance.

## Requirement: Remote preview mutations are revision-safe

Preview edits and exports SHALL execute through the owning Workspace Host with the same capability
policy, workspace containment, idempotency, and revision checks as other writes.

### Scenario: Apply molecular selection edit

- **WHEN** a user confirms an edit against the current remote source revision
- **THEN** the remote provider SHALL perform the canonical package operation and publish the new
  revision.

### Scenario: Source changed after observation

- **WHEN** the remote source revision changed before an edit or export
- **THEN** the operation SHALL fail with a conflict and SHALL NOT use a stale local cache.
