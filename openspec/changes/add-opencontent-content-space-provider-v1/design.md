## Context

Content Space already owns the business contract, service, capabilities, renderer, portable codecs/resolver, and immutable-artifact rules. Provider Composition supplies exact generic main extensions and a trusted non-secret instance directory. The preceding OpenContent Connector contributes each reviewed OpenContent instance and owns vendor connections, credential use, session lifecycle, schema validation, and transport behind a generic Host-mediated owner-scoped token-free facade.

The delivery order is therefore Content Space → Secure Credentials → Connector port → Provider adapter → cloud-space PoC; Shared Documents stays deferred.

## Goals / Non-Goals

**Goals:**

- Implement one bounded OpenContent mapping to ContentSpaceProvider without leaking vendor details.
- Register one exact lazy factory and remain pinned to the resolved OpenContent instance.
- Preserve current Principal, cancellation, invocation identity, conflict, `outcome_unknown`, transfer, portal, and immutable-proof requirements.
- Keep each operation independently readiness-gated and blocked by default.

**Non-Goals:**

- Implementing OpenContent HTTP/authentication/credentials/Token lifecycle in the adapter.
- Owning Content Space UI, codecs/resolver, Host transfer/navigation, or Project/Task semantics.
- Registering DocumentProvider, Document port, universal Provider/client, public capability, renderer, IPC, or MCP.
- Claiming production readiness, running an unbounded/shared-tenant PoC, or falling back.

## Decisions

### Contribute only one exact Content Space factory

The package declares a generic `main.extension` whose location is `main.content-space-provider-factory`. Manifest version, contract version, Provider Kind, trusted owner, and runtime value match exactly. It creates the Provider lazily only after a trusted directory entry pins an OpenContent ProviderInstanceRef. It has no package-load singleton or network side effect during catalog construction.

### Consume only the Host-issued Connector facade

The adapter's trusted main entry asks the package-generic Host mediator for the service identified by the Connector's non-callable descriptor. Host resolves the privately registered Connector factory, derives the adapter main-entry owner, and issues the token-free facade only when the Connector policy allowlists it; raw callable transport is never available from the global contribution list. The adapter cannot request credentials, endpoints, raw HTTP/client/DTOs, another consumer's facade, or login lifecycle. The Connector cannot return business references or Content Space UI data without adapter validation.

### Let Content Space own references and resolution

The adapter returns provider-neutral identity/proof facts to Content Space. It does not contribute Container/File/Artifact codecs or an OpenContent authority resolver. Portable materialization follows Content Space resolver → service → directory → catalog → pinned OpenContent Provider → Host-issued Connector facade, so there is one resolver and one operation path.

### Preserve current Principal and write uncertainty

The Host Principal arrives through the canonical Broker/domain service. For writes, the logical invocation identity is admitted and idempotency-bound by the Broker envelope outside Content Space business input. Adapter/provider input and output cannot replace either value. The adapter binds results to the exact instance, target, resource, and invocation. Collision maps to typed conflict. Timeout, cancellation, session supersession, or ambiguous remote receipt maps to `outcome_unknown`; no blind retry occurs.

### Separate adapter completion from PoC admission

All operations start `blocked_by_contract`. Evidence alone does not make `poc_only` executable through the normal Content Space service. A later cloud-space PoC change must add a trusted policy/audience Gate to that service composition and may admit only exact operations in a dedicated non-production tenant after least-privilege identity, BOLA, schema, transfer, portal, outcome, cancellation, and session coexistence Gates pass. Production remains separately gated.

## Risks / Trade-offs

- **Schema or business-code drift** is closed by Connector validation plus strict adapter mapping.
- **Token-bearing transfer leaks to renderer** keeps download blocked until main-process Host-owned delivery is proven.
- **Upload creates duplicate data** is closed by the Broker-admitted out-of-band invocation identity and `outcome_unknown`, never blind retry.
- **Known-ID metadata survives revocation** blocks reference materialization/readiness until a provider fix or validated oracle.
- **Artifact fields look versioned but are mutable** keeps ArtifactReference blocked until exact immutable identity, retention, version-specific retrieval, instance/file/version binding, and optional-digest matching pass.
- **Adapter pause disrupts generic UI** is avoided because Content Space and other/mock Providers compose independently; pinned OpenContent instances simply report unavailable.

## Migration Plan

1. Complete Content Space V1, Secure Credentials, and Connector port changes.
2. Add package/factory/mapper tests with all operation readiness blocked.
3. Validate exact instance pinning, Principal/connection binding, cancellation, conflicts, uncertain outcomes, transfer, portal, and immutable proof.
4. Regenerate and verify source/packaged composition and boundary/governance scans.
5. In the separate cloud-space PoC change, add the trusted Content Space service policy/audience Gate and admit only evidence-backed exact operations.
6. Remove/pause the package cleanly through standard composition without fallback or compatibility alias.
