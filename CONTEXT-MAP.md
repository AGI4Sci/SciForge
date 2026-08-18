# SciForge Context Map

> Current-state audit: 2026-08-17. This map distinguishes implemented authority from deferred identity and document targets. It is not a catalog of every SciForge domain or integration package.

## Identity and Access

Owns the desktop Host's current Human Principal and its assurance. The implemented V1 adapter is Local Account selection with `local-selection` assurance. Canonical cloud identity, OIDC login, identity migration, and external-account binding remain separate future changes; external service accounts never become SciForge identity merely because attributes such as email addresses match.

Glossary: `docs/contexts/identity-access/CONTEXT.md`

## Cloud Collaboration

Owns its implemented cloud `UserPrincipal`, verified Human Endpoint Bindings, Agent ownership/device credentials, Participant Profiles, personal Session projections, multi-user Projects, membership and permissions, Coordinator assignment, Tasks, Project Records, inboxes, and receipts. Its current PoC identity is established through provider challenge pairing; it does not currently consume Keycloak/OIDC or silently equate a desktop Local Account with a cloud user.

Glossary: `docs/contexts/cloud-collaboration/CONTEXT.md`

Current product narrative: `docs/SciForge_New_Cloudcolab.md`. The same-named root document is the superseded ADR-0020-era baseline and is historical only.

## Shared Documents

Defines the deferred provider-neutral target for ongoing collaborative-document identity, structured content operations, authoritative revisions, conditional changes, and provider-native browser collaboration. ADR-0025 keeps this domain and every Document adapter/port after the Content Space OpenContent track.

Glossary: `docs/contexts/shared-documents/CONTEXT.md`

## Content Space

Owns provider-space selection, directories, ordinary-file transfer, and fixed provider-backed artifacts. It does not own collaborative-document semantics.

Glossary: `docs/contexts/content-space/CONTEXT.md`

## Provider Integration Infrastructure

This is shared technical integration infrastructure rather than a business bounded context. It owns provider-neutral instance identity, portable-reference authority resolution, trusted Provider contribution contracts, and node-local access bindings. A provider-specific Connector owns one vendor's private endpoint/tenant policy, authentication, credentials, connection/session state, transport, and schema validation. Provider adapters consume only Host-authorized narrow Connector facades; business domains consume only their own Provider SPI and never a vendor Connector directly.

Glossary: `docs/contexts/provider-integration/CONTEXT.md`

## Relationships

- Identity and Access is authoritative for the current Human Principal. Shared Documents and Content Space consume that principal but do not create or infer it from a provider account.
- Cloud Collaboration currently owns its collaboration UserPrincipal, endpoint, Agent, and device-credential facts. A future canonical Identity integration must explicitly reconcile these identities; it cannot infer equivalence from Local Account, email, display name, Zulip identity, or installation ID.
- An External Account Binding associates a SciForge User with an external service account; the external provider remains authoritative for that external account and its provider-native permissions.
- Shared Documents and Content Space are sibling contexts with separate public capabilities, readiness, tests, and provider-replacement paths.
- Shared Documents consumes only the DocumentProvider catalog; Content Space consumes only the ContentSpaceProvider catalog. A trusted integration package may contribute one or both implementations, but each contribution has an independent contract, readiness, and test suite.
- Provider integration packages are selected at compile time through manifest/generated composition. Host Core owns only generic contribution catalogs and never routes by provider kind, vendor, resource extension, or domain ID.
- When one vendor needs shared authentication or transport, its Provider adapters may consume a provider-specific main-only Connector. The Connector owns no document or file business semantics and is never called directly by Shared Documents, Content Space, renderer, Agent Runtime, or cloud orchestration.
- A consuming cloud, Project, Task, evidence, or record context owns its business association to a typed resource reference; neither content context imports those consumer models.
- Portable Resource Reference Envelopes are durable, versioned, non-authorizing cross-context values. A receiving full SciForge node validates the registered reference kind, resolves its trusted Provider Instance and current Human Principal's local Provider Connection, reauthorizes with the provider, and only then issues a process-local Broker resource reference.
- Change 2 adds a Cloud Collaboration-owned Project Content Space Binding from one Project to one exclusive shared Content Container Reference. Content Space must not import Project or own the association lifecycle; Project archival/deletion never deletes Provider content.
- A Personal Session Agent may use only a Human-confirmed, currently enumerable personal or Team root and descendant Broker resources issued by authorized listing. It cannot invoke Human global content capabilities or widen scope with a raw GUID. A Project Task Agent may use only its Project Content Directory and descendants, always through the executing node owner's Provider Connection; the requester cannot select or borrow a connection.
- Agent upload/download crosses the Workspace boundary only through explicit approved one-shot Host transfers using relative paths inside the execution context's authorized Workspace. It never creates a sync, mount, mirror, or cascading delete relationship.
- SciForge Workspace is an execution, filesystem, Runtime, and Git boundary. It owns neither Shared Documents nor Content Space resources.
- A Collaboration Project does not own, upload, or grant access to a Workspace. An Agent Host may use a Workspace for a Task only through the Workspace's local authorization path.
- Each selected Provider remains authoritative for its content and provider-native access control. SciForge Project membership never substitutes for Provider authorization.
- A portable reference pins its Provider Instance. Provider failure never triggers automatic fallback, silent copying, or reinterpretation by another Provider; migration is an explicit governed operation that produces a new reference.
- Development-only OpenContent capabilities may target a reviewed shared demonstration instance only through a trusted, compile-time profile that fixes the Provider Instance, least-privilege account class, operation set, limits, and audience. Callers cannot promote readiness or select endpoints. Production admission remains a separate decision, and the Provider-specific track may pause without blocking provider-neutral contracts or UI.
