---
status: accepted
reviewed: 2026-08-17
---

# Compose domain-specific Provider integrations

SciForge exposes separate DocumentProvider and ContentSpaceProvider contracts rather than a universal optional-method Provider. Trusted compile-time integration packages register `main.document-provider-factory` and/or `main.content-space-provider-factory` contributions through manifest/generated composition; each domain owns its catalog and rejects missing, duplicate, or incompatible implementations, while Host Core contains no vendor switch. This adds two explicit extension contracts but lets one vendor implement either or both domains without coupling their semantics, readiness, UI, tests, or replacement paths.

## Current applicability

This decision remains effective. The provider-composition SDK, generated main-extension path, Provider Instance Directory, Content Space catalog, and mock Provider implement the Content Space half. The DocumentProvider location remains reserved for the deferred Shared Documents domain and does not authorize implementing that domain ahead of ADR-0025.
