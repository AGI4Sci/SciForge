## Context

The required order is Content Space V1 → Secure Provider Credentials → OpenContent Connector Content Space port → OpenContent ContentSpaceProvider → cloud-space PoC. ADR 0025 records that Shared Documents and all Document adapter/provider work remain later.

Content Space resolves its own portable reference kinds through its domain resolver, trusted Provider Instance Directory, domain catalog, and current Principal. The Connector belongs below the OpenContent adapter: it owns vendor authentication/transport facts but no business-resource semantics.

## Goals / Non-Goals

**Goals:**

- Compose one optional main-only OpenContent infrastructure owner without Host/vendor routing.
- Reuse one per-Principal connection/session path through a least-privilege Content Space adapter port.
- Store/use secrets only through the future owner-scoped Secure Provider Credentials facade.
- Pin and validate every selected request/response and fail closed on session or outcome uncertainty.

**Non-Goals:**

- Implementing this Connector as part of Content Space V1.
- Owning Content Space containers/files/artifacts or Shared Document revisions/edits.
- Contributing a Provider factory, portable codec/resolver, public Broker capability, UI, Agent/MCP surface, raw HTTP client, or Provider DTO.
- Adding a Document port before Shared Documents or adding placeholder/optional methods now.
- Claiming production readiness or enabling an OpenContent cloud-space PoC without a separate Gate decision.

## Decisions

### Use a standard main-only package and exact extension location

The Connector declares only a main entrypoint and generic `main.extension` descriptors plus package runtime lifecycle as needed. Declaration/runtime location, version, owner, and port contract match exactly. No Host-private OpenContent service, package-load singleton, dynamic plugin loader, or OpenContent switch is added.

### Keep directory, connection metadata, and credentials separate

For V1, the Connector package contributes each reviewed OpenContent instance through `main.provider-instance-directory-entry`. The generic entry contains only opaque instance, Provider Kind `opencontent`, safe display name, version, and trusted contribution owner. Connector-private configuration is keyed by that exact ProviderInstanceRef and owns endpoint/tenant/TLS/redirect policy; lifecycle validation rejects a missing, duplicate, wrong-kind, or foreign dynamic registration. Connector-owned local connection metadata then binds one Host Principal to the instance without storing secrets. Secret material stays in the separately reviewed credential store under an owner-scoped facade. Portable and business input can select only a registered reference and never supplies or mutates endpoint policy.

### Acquire one least-privilege adapter port through Host mediation

The current generic contribution host lists installed extensions and is not itself service authorization. This future change SHALL therefore add or reuse a package-generic Host-mediated owner-scoped internal-service contract. The Connector publishes only a validated non-callable service descriptor through `main.extension` and registers its callable internal-service implementation through the private generic mediator exposed on its trusted main-entry Host facade. This facade implementation registration is neither `main.document-provider-factory` nor `main.content-space-provider-factory`. Raw callable transport never appears in the global contribution list. Host closes and validates the complete descriptor/implementation registration set before dependent lifecycle acquisition; missing, duplicate, incompatible, or mismatched ownership fails without priority, last-wins, or package-load-order selection. Host derives the requesting module owner from its trusted main entry and issues the bounded token-free facade only when the descriptor allowlists that exact owner. Runtime input cannot name or impersonate the owner. Content Space never receives this facade and the Broker is not used as a private service bus.

No Document port exists in this milestone. A separate later change may extend the same Connector only after Shared Documents has a reviewed contract, with independent declaration, authorization, readiness, and tests.

### Do not contribute portable reference resolution

Content Space owns the resolver for its Container/File/Artifact kinds and routes it through the pinned ContentSpaceProvider. Adding an OpenContent authority resolver would duplicate ownership and fail composition. The Connector therefore only serves the Host-issued adapter facade; reference materialization reaches it indirectly through Content Space service → pinned OpenContent Provider → Host-mediated Connector facade.

### Treat evidence and sessions as operation-specific

Every transport operation begins `blocked_by_contract`. Formal per-user identity/authentication, Token issue/expiry/renewal/rotation/logout/revocation, API/browser coexistence, schema, metadata authorization, and tenant isolation must pass independently. Evidence may make a Connector operation eligible for a later PoC, but `poc_only` remains non-executable through the normal product path until a separate cloud-space PoC change installs a trusted policy/audience Gate in Content Space service composition. Supersession terminates the current session and uncertain writes return `outcome_unknown`; no automatic login or retry occurs.

## Risks / Trade-offs

- **Provider service differs from documentation** is contained by pinned runtime schemas and fail-closed result mapping.
- **New login invalidates existing work** is represented as superseded and requires Human action.
- **Known-ID metadata bypasses authorization** blocks materialization/readiness until a provider fix or validated oracle exists.
- **Connector becomes a hidden public client** is prevented by Host-mediated owner-scoped facade acquisition and boundary tests forbidding a raw callable port in the global contribution host or UI/Agent/MCP/raw transport exports.
- **Document work blocks Content Space** is prevented by omitting every Document port and placeholder from this milestone.

## Migration Plan

1. Complete Content Space V1 and separately archive Secure Provider Credentials.
2. Add the package-generic Host-mediated owner-scoped service mechanism, non-callable Connector descriptor, privately registered internal-service implementation factory, reviewed non-secret instance entry, and exact adapter facade with all network operations blocked.
3. Implement connection/session state, schema fixtures, redaction, and transport mocks.
4. Mark no operation PoC-eligible until its exact contract/evidence passes; normal Content Space execution remains blocked.
5. Let the later adapter register the OpenContent ContentSpaceProvider factory.
6. In a separate cloud-space PoC change, add the trusted Content Space policy/audience Gate and admit only exact operations after adapter and environment Gates pass.
7. Removing the Connector/adapter leaves generic Content Space and other Providers operational with no shim or fallback.
