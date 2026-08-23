## Purpose

Defines generic isolation, integrity, build, packaging, and public-release behavior for optional internal runtime overlays that must not enter the public source dependency graph.

## ADDED Requirements

### Requirement: Internal overlays remain outside the public dependency graph

The public root workspace and lockfile SHALL exclude every package beneath `internal/**`. Internal overlay packages SHALL be discovered from validated manifests and statically verified from their own package or overlay root without a public workspace link, executable package script, public package dependency, private registry resolution, or package-name lookup through the public `node_modules` tree. A clean public checkout with no internal overlay SHALL install, build, test, and package without a stub or compatibility package.

#### Scenario: Internal overlay is installed after public dependencies

- **WHEN** an approved overlay is placed beneath `internal/**`
- **THEN** SciForge-owned validation SHALL read it from its manifest-discovered local directory and SHALL NOT execute it or modify/invalidate the public root lockfile

#### Scenario: Internal overlay is absent

- **WHEN** the public checkout contains no internal packages
- **THEN** internal composition, build, validation, and resource packaging SHALL be deterministic no-ops

### Requirement: Internal resources require complete static integrity proof

Packaging SHALL include internal resources only when a trusted installation receipt or equivalent package-owned manifest proves the exact overlay identity, version, complete file inventory, per-file digest, containment, and required entrypoints. Validation SHALL use SciForge-owned static reads and hashes and SHALL reject missing, extra, changed, symlink-escaping, mismatched, or unreceipted resources without executing attachment code.

#### Scenario: Installed attachment changes after installation

- **WHEN** any packaged file no longer matches the trusted receipt or complete manifest
- **THEN** packaging SHALL fail before copying or executing that attachment

### Requirement: Official public releases exclude internal resources

Official public release entrypoints SHALL fail closed when internal runtime composition is non-empty. Local or explicitly internal packaging MAY include statically verified internal resources, but installing an overlay SHALL never silently change the contents of an official public release artifact.

#### Scenario: Maintainer starts a public release with an overlay installed

- **WHEN** the public release script detects any internal runtime contribution
- **THEN** it SHALL stop before signing, notarizing, uploading, or publishing an artifact
