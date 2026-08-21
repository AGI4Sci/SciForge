# SciForge Context Map

> Current-state audit: 2026-08-21. This map distinguishes implemented authority, current provider-native capabilities, and deferred provider-neutral targets. It is not a catalog of every SciForge domain or integration package.

## Identity and Access

Owns the desktop Host's current Human Principal and its assurance. The implemented V1 adapter is Local Account selection with `local-selection` assurance. Canonical cloud identity, OIDC login, identity migration, and external-account binding remain separate future changes; external service accounts never become SciForge identity merely because attributes such as email addresses match.

Glossary: `docs/contexts/identity-access/CONTEXT.md`

## Cloud Collaboration

Owns its implemented cloud `UserPrincipal`, verified Human Endpoint Bindings, Agent ownership/device credentials, Participant Profiles, personal Session projections, multi-user Projects, membership and permissions, Coordinator assignment, Tasks, Project Records, inboxes, and receipts. Its current PoC identity is established through provider challenge pairing; it does not currently consume Keycloak/OIDC or silently equate a desktop Local Account with a cloud user.

Glossary: `docs/contexts/cloud-collaboration/CONTEXT.md`

Current product narrative: `docs/SciForge_New_Cloudcolab.md`. The same-named root document is the superseded ADR-0020-era baseline and is historical only.

## Shared Documents

Defines the deferred provider-neutral target for cross-provider collaborative-document identity, structured content operations, authoritative revisions, conditional changes, and browser collaboration. ADR-0030 keeps Shared Documents and DocumentProvider out of the current MDoc delivery: provider-native document operations are activated through Content Space instead.

Glossary: `docs/contexts/shared-documents/CONTEXT.md`

## Content Space

Owns provider-space selection, Content Containers, ordinary-file transfer, fixed provider-backed artifacts, and provider-native document operations declared through the `ContentSpaceProvider` SPI. Provider-declared readiness records evidence, while invocation admission separately evaluates the exact caller, Principal, Broker authority, audience, platform and verification profile; OpenContent is the only current Provider, and Shared Documents does not participate in this delivery.

Glossary: `docs/contexts/content-space/CONTEXT.md`

Architecture and canonical call chain: `docs/content-space-architecture.md`

## Provider Integration Infrastructure

This is shared technical integration infrastructure rather than a business bounded context. It owns provider-neutral instance identity, portable-reference authority resolution, trusted Provider contribution contracts, node-local access bindings, and token-free Provider Binding Attestations. A provider-specific Connector owns one vendor's private endpoint/tenant policy, authentication, credentials, Connection/session state, transport, schema validation, and immediate pre-dispatch re-attestation. Provider integrations consume only Host-authorized narrow Connector facades; business domains consume only their own Provider SPI and never a vendor Connector directly.

Glossary: `docs/contexts/provider-integration/CONTEXT.md`

## Relationships

- Identity and Access is authoritative for the current Human Principal. Shared Documents and Content Space consume that principal but do not create or infer it from a provider account.
- Cloud Collaboration currently owns its collaboration UserPrincipal, endpoint, Agent, and device-credential facts. A future canonical Identity integration must explicitly reconcile these identities; it cannot infer equivalence from Local Account, email, display name, Zulip identity, or installation ID.
- An External Account Binding associates a SciForge User with an external service account; the external provider remains authoritative for that external account and its provider-native permissions.
- Shared Documents and Content Space remain sibling contexts. The current MDoc capability is provider-native Content Space behavior, while a future provider-neutral Shared Documents domain retains its own public contract, readiness, tests, and replacement path.
- Content Space consumes only the ContentSpaceProvider catalog, including any declared provider-native document capability. The DocumentProvider catalog remains reserved for the deferred Shared Documents domain; an installed Provider that does not declare the Content Space capability neither receives it nor falls back to another Provider.
- Provider Integrations are selected at compile time through manifest/generated composition. Host Core owns only generic contribution catalogs and never routes by provider kind, vendor, resource extension, or domain ID.
- When one vendor needs shared authentication or transport, its Provider adapters may consume a provider-specific main-only Connector. The Connector owns no document or file business semantics and is never called directly by Shared Documents, Content Space, renderer, Agent Runtime, or cloud orchestration.
- Provider Binding Attestation is token-free, non-portable evidence for one exact Provider Instance, complete current Principal, opaque external subject, and opaque Connection revision. Admission matches it through the pinned Provider, and the Connector re-attests the actual current session immediately before business dispatch so unbind/rebind drift fails closed.
- A public integration Runtime may execute typed supplier-backed operations only behind the same Provider and Connector path. An optional private supplier overlay changes runtime inventory only; it never becomes a domain package, readiness promotion, Connection, or authorization path.
- A consuming cloud, Project, Task, evidence, or record context owns its business association to a typed resource reference; neither content context imports those consumer models.
- Portable Resource Reference Envelopes are durable, versioned, non-authorizing cross-context values. A receiving full SciForge node validates the registered reference kind, resolves its trusted Provider Instance and current Human Principal's local Provider Connection, reauthorizes with the provider, and only then issues a process-local Broker resource reference.
- Cloud Collaboration owns the Project Content Space Binding and is the sole source of Project shared Content Container provisioning intent: its Project Owner supplies the desired content owner and its explicit Project Members supply the desired member set. Content Space must not import Project or infer owner/member identity from an Agent, requester, prompt, or Provider listing; Project archival/deletion never deletes the Provider Content Container or its content.
- A Personal Session Agent may use only a Human-confirmed, currently enumerable personal or Team root and descendant Broker resources issued by authorized listing. It cannot invoke Human global content capabilities or widen scope with a raw GUID. If Cloud Collaboration later enables Project Task content handoff, a Project Task Agent may use only its bound Project Content Directory and descendants, always through the executing node owner's Provider Connection; the requester cannot select or borrow a connection.
- After the Host delegates an exact Broker resource, an Agent may perform declared resource-scoped writes without a new Human confirmation for each invocation. The resource fixes the target boundary; destructive operations remain separately classified and must name the exact authorized target, while collisions or stale state fail closed rather than implicitly replacing existing content.
- Agent upload/download crosses the Workspace boundary only through bounded one-shot Host transfers using relative paths inside the execution context's authorized Workspace. Existing Workspace authority and the delegated Provider resource remain mandatory, but the Provider write does not require another per-invocation confirmation; transfer never creates a sync, mount, mirror, overwrite fallback, or cascading-delete relationship.
- SciForge Workspace is an execution, filesystem, Runtime, and Git boundary. It owns neither Shared Documents nor Content Space resources.
- A Collaboration Project does not own, upload, or grant access to a Workspace. An Agent Host may use a Workspace for a Task only through the Workspace's local authorization path.
- Each selected Provider remains authoritative for its content and provider-native access control. SciForge Project membership never substitutes for Provider authorization.
- A portable reference pins its Provider Instance. Provider failure never triggers automatic fallback, silent copying, or reinterpretation by another Provider; migration is an explicit governed operation that produces a new reference.
- Development-only OpenContent invocations require a trusted static profile that fixes the Provider Instance, complete Principal/assurance, exact authority, operation, audience, enforced transfer maxima, validity window, and any required opaque external binding. A successful admitted invocation remains `poc_only`; production promotion is a separate per-operation evidence decision, and the Provider-specific track may pause without blocking provider-neutral contracts or UI.
