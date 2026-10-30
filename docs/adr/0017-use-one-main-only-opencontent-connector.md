---
status: superseded
supersededBy: ADR-0025
reviewed: 2026-08-17
---

# Use one OpenContent Connector beneath separate Provider adapters

OpenContent is an independently pausable V1 adapter track made of a main-only `opencontent-connector`, an `opencontent-content-space-provider`, and an `opencontent-document-provider`. The Connector uniquely owns OpenContent instance configuration, node-local per-user connections, authentication and Token lifecycle, protected credential namespace, schema validation, and narrow typed ports consumed only by the two OpenContent Provider adapters. Each adapter separately satisfies its domain-owned Provider Contract, capabilities, readiness, and tests; Shared Documents and Content Space never call the Connector directly. This avoids duplicated login state and Token mutual invalidation without turning OpenContent into a Host or business-domain dependency.

## Supersession audit

ADR-0025 supersedes this record's milestone scope and ordering. The single main-only Connector and independently composed Provider adapters remain valid principles, but the current delivery sequence exposes only the Content Space adapter port first. Shared Documents, the Document port, and `opencontent-document-provider` remain deferred until their own reviewed domain and predecessor Gates exist.
