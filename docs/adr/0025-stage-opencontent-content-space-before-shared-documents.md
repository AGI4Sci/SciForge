---
status: accepted
supersedes: ADR-0017 milestone scope
reviewed: 2026-08-17
---

# Stage OpenContent Content Space before Shared Documents

## Context

Ordinary files and immutable artifacts are a separate domain from collaborative-document revisions and edits. Durable portable identity is non-authorizing and remains separate from process-local Broker authority. Content Space and a later Shared Documents domain own independent Provider contracts rather than a universal optional-method Provider. The current application composes trusted packages through standard manifests/generated composition, generic `main.extension` values, owner-scoped main-entry Host facades, package runtime lifecycle, the Capability Broker, and generic renderer contributions.

The OpenContent transport/authentication track has additional credential, session, schema, authorization, and tenant-isolation risks. None of those risks is a reason to couple provider-neutral Content Space to Shared Documents or to put OpenContent behavior in Host Core.

## Decision

SciForge will deliver milestones in this order:

1. Provider-neutral Content Space V1, including the required generic Principal, Portable Resource References, and domain-specific Provider Composition foundations.
2. Secure Provider Credentials as a separate reviewed change. It is not implemented by Content Space V1.
3. One main-only OpenContent Connector with only the least-privilege Content Space adapter port.
4. An independently composed OpenContent ContentSpaceProvider adapter.
5. A separate OpenContent cloud-space PoC change after exact operation, tenant, identity, authorization, transfer, and uncertain-write Gates pass. That change must add a trusted policy/audience Gate to Content Space service composition; `poc_only` is not executable through the normal product path without it.
6. Shared Documents remains deferred. Only after that domain exists may a later change add an independently declared Document adapter port to the same Connector and a separate DocumentProvider.

The Content Space domain owns its portable Container/File/Artifact codecs and its exact authority resolver. A future OpenContent Connector does not register a second resolver for those kinds; the OpenContent adapter participates only behind the ContentSpaceProvider catalog. The Connector contributes each reviewed non-secret OpenContent Provider Instance entry and owns private endpoint/tenant policy, connections, credentials, and vendor transport below that adapter.

The current global main-extension contribution host is discovery, not service authorization. The future Connector change must add or reuse a package-generic Host-mediated owner-scoped internal-service contract: only a non-callable descriptor is globally discoverable, the callable internal-service implementation is registered privately through the trusted main-entry Host, and Host issues a token-free facade only to the allowlisted adapter owner. This internal-service/facade implementation registration is neither `main.document-provider-factory` nor `main.content-space-provider-factory`.

The first Connector milestone therefore defines no Document port, optional Document methods, placeholder DocumentProvider, universal Provider, compatibility alias, dual registration, default Provider, fallback, or Host/vendor switch. Portable Resource Open Routing and collaborative-document launch/edit remain separate deferred work.

## Consequences

- Content Space and its mock Provider remain buildable, testable, and useful when every OpenContent package is absent or paused.
- Secure credentials can be reviewed without conflating secret storage with business-domain semantics.
- This Content Space branch does not restore or implement the planned `add-secure-provider-credentials` change; it records that change only as a mandatory future predecessor to Connector network work.
- The Connector remains the single owner of OpenContent connection/authentication/transport state while exposing independently authorized narrow adapter ports.
- An OpenContent failure or unavailable instance returns the pinned outcome; it never routes to the mock or another Provider.
- Source and packaged application discovery continue to use the same standard manifest/generated composition path.
