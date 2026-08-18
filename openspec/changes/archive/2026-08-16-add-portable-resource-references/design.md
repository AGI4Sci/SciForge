## Context

Capability Broker resources are executable process-local bindings with audience, scope, expiry, observation, content transport, governance, and retirement. Portable references are durable, non-authorizing identity only and are never reinterpreted as those local bindings. The latest generic `main.extension` host and package runtime lifecycle provide the composition boundary.

## Goals / Non-Goals

**Goals:**

- Provide one canonical parse, materialize, observe, export, and retirement path.
- Reject malformed or untrusted identity before authority, credential, factory, or network access.
- Reauthorize with the Host Principal at materialization and later observation.
- Keep identity schemas and immutable proof rules with resource-owning domains.

**Non-Goals:**

- Making Broker or capability handles durable.
- Defining Content Space, Document, Project, Task, Provider, or vendor payload unions in Host.
- Selecting accounts, storing credentials, opening resources, or implementing Provider transport.
- Adding a parallel IPC, MCP, service facade, registry, or compatibility decoder.

## Decisions

### Use exact bounded envelopes and canonical JSON

The envelope has exactly version, kind, authority, and identity. Parsing accepts only bounded plain JSON data, protects against prototype pollution, and rejects sensitive/local fields. Codecs validate the domain-owned identity and safe export projection.

### Compose codecs and resolvers as generic main extensions

Declarations and runtime values at `main.portable-resource-codec` and `main.portable-authority-resolver` bind location, version, contribution owner, portable kind, local resource kind, and resolver identifier. The Host selects the codec by kind and only its declared resolver; it never scans resolvers or routes by Provider Kind, domain, MIME, extension, or vendor.

### Keep authority and Principal inside trusted Host context

Local Provider Instance lookup precedes provider work. The owner-scoped facade received by the trusted package main entry derives the package owner and current Broker invocation; its lifecycle/capability implementation captures that facade rather than publishing it as a global contribution. Callers cannot inject Principal, audience, consumer, or resolver. The Principal lease is checked again before issue and on later observations.

### Reuse Broker resource issuance and lifecycle

Materialization registers a provider-owned observer through the existing Broker resource path. Derived local identity includes trusted codec owner, envelope identity, and Principal lease. Export registration and cleanup are atomic with Broker issuance, retirement, expiry, and disposal.

### Make Artifact proof a domain responsibility

The generic service knows no Artifact schema. A Content Space resolver must revalidate immutable version identity, retention, version-specific retrieval, and exact instance/file/version proof before a Broker resource is issued; when the reference carries a digest, the current proof must match it exactly.

## Risks / Trade-offs

- **Prototype or canonicalization ambiguity** is closed by strict plain-object parsing, exact keys, bounds, and adversarial tests.
- **Codec/resolver squatting** is closed by exact owner/version/location binding and duplicate rejection before lifecycle activation.
- **Cross-Principal resource reuse** is closed by Principal-lease binding and fresh observation authorization.
- **Export state leakage or growth** is closed by owner-derived authorization, bounded state, atomic collision handling, and Broker retirement cleanup.
- **Future Provider integration duplicates resolution** is closed by resource-kind ownership: the Content Space resolver owns its kinds and later adapters operate beneath its pinned Provider catalog.

## Migration Plan

1. Extend the generic Domain SDK contracts and contribution projection.
2. Add the Host portable-resource service around existing Broker issuance/retirement.
3. Add fail-before-network, Principal-change, export, collision, and lifecycle tests.
4. Register Content Space codecs/resolver from its package lifecycle.
5. Regenerate and validate both source and packaged composition with no legacy contribution kinds or compatibility path.
