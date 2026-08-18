## Context

See `proposal.md` for motivation. Content Space already exposes Agent-safe Provider Instance discovery, a UI-only container listing, and a Human-confirmed Agent root authorization that performs a complete live exact label-and-scope match. The OpenContent Connector and adapter already paginate `Team/GetMyTeamList`, map `teamName` to a provider-neutral label, keep numeric folder IDs private, and map stable folder GUIDs into the Content Space Provider reference. The missing boundary is an Agent-readable projection of labels before authorization.

The Capability Broker treats reads as approval-free, so candidate enumeration is a bounded read rather than a partial authorization. Runtime guidance directs the Agent to use it only for an explicit external Provider intent and to pass a Provider Instance reference returned by native discovery. Machine-enforced admission instead consists of the Agent audience, current Principal, trusted resolvable Provider Instance and readiness policy, bounded input, and label-only non-authorizing output. Exact content authority still begins only with the existing separately confirmed authorization operation.

## Goals / Non-Goals

**Goals:**

- Give the Agent a legal source for a personal or Team library display label without exposing a Provider resource identity.
- Preserve the canonical Broker → Content Space handler → service → catalog → pinned Provider → adapter/Connector path.
- Make the sequence discoverable: list Provider Instances → list redacted root candidates if needed → confirm exact root → use resource-scoped operations.
- Preserve fresh exact matching, Principal/caller/Workspace binding, pagination bounds, and no-guess behavior.
- Make create → re-list exact child → upload the documented resource-safe continuation.

**Non-Goals:**

- Dynamic Human picker UI, authorization from an unspecified root, canonical-duplicate disambiguation, or candidate resources.
- Agent access to the existing Human global `list-containers` output.
- Hiding every provider-neutral reference from all existing Agent output; this change prevents those references from being accepted as authority and keeps the new candidate output identity-free.
- Model-capacity retries, online research Providers, Project binding/Change 2, Shared Documents, DocumentProvider, Provider credentials, OpenContent API changes, or installed packages.

## Decisions

### Add a dedicated Agent-safe projection instead of widening `list-containers`

`content-space.list-agent-root-candidates` is Agent-only, global, read-only, and provider-neutral. Its strict input is `{ providerInstanceRef, scope, page }`. Its output is `{ providerInstanceRef, scope, items: [{ libraryLabel }], nextCursor? }`. The distinct `libraryLabel` field prevents accidental substitution of the Provider Instance `label`. The handler calls the existing service listing once for the requested page, filters by scope, and projects labels; it never serializes the returned references.

Widening `list-containers` was rejected because its public output contains `reference.containerId`. Extending `list-provider-instances` was rejected because that operation is deliberately lazy and must not construct Providers or perform remote listing.

### Treat candidates as display data, never authority

The candidate result has no resource kind, selection handle, connection, or reference. The existing `authorize-agent-root` remains the only global operation that can establish root authority. It receives an exact `libraryLabel` as its existing `label` input, obtains a separate Human confirmation, then re-enumerates all live pages and accepts exactly one canonical label-and-scope match. Candidate output is therefore useful for natural-language selection but cannot create a TOCTOU authorization cache.

Allowing `authorize-agent-root` to omit its label or auto-select the first Team was rejected because Broker confirmation occurs before the handler and would not identify the exact root. A dynamic Human candidate picker was rejected for this focused change because the Broker currently supports a confirmation decision, not a domain-specific selection protocol.

### Keep scope filtering and pagination explicit

The Provider contract lists personal and shared roots in provider-defined pages. The Agent candidate operation filters each page by the requested scope and preserves the Provider-neutral opaque cursor even when the filtered page is empty. The Agent must continue while `nextCursor` exists before treating the observed candidate set as complete. This matches the current OpenContent mapping, where the initial page may contain only the personal root and Team roots begin at a later cursor.

### Encode routing order in package-owned metadata and generic Host guidance

Capability titles, descriptions, and tags will make Provider Instance discovery, candidate listing, exact authorization, and resource-scoped continuation discoverable for the same external Team-library intent. Generic canonical-state guidance may tell an Agent to use a matching native read operation for a missing Human-visible selector and must prohibit substituting a Provider display label or guessing an identity. It will not name Content Space, OpenContent, a package ID, or a Host switch.

### Preserve the existing create-to-upload authority path

This change does not introduce a second create result or make a Provider receipt authoritative. After create-folder succeeds, `agent-list-entries` on the same authorized parent issues an opaque resource for the new child; upload then consumes that child resource. Descriptions and regression coverage will state this sequence explicitly.

Existing global operations that accept a Provider file/container reference for immutable observation or portal navigation remain Human UI-only. The Agent audience has no global raw-reference descendant operation; future Agent support for those behaviors would require a separately specified resource-scoped capability.

## Risks / Trade-offs

- **[Accessible library names become Agent-readable before exact root authorization]** → Guide use from explicit external-Provider intent and a discovered Provider Instance, while enforcing the Agent audience, current Principal, trusted pinned Provider Instance/readiness, bounded pages, safe labels only, and no authority; retain separate Human confirmation for the exact root and every write.
- **[A filtered page can be empty even though later Team pages exist]** → Preserve `nextCursor`, describe complete pagination, and test the OpenContent personal-first shape.
- **[Candidate labels can become stale or canonically ambiguous]** → Never cache them as authority; authorization always performs a fresh complete listing and rejects zero or multiple matches.
- **[The model may confuse Provider and library labels]** → Use the distinct `libraryLabel` field, package-owned prerequisite descriptions, generic runtime guidance, strict schemas, and exact authorization failure.
- **[Create receipts expose descriptive references that are not authority]** → Keep every Agent write target resource-scoped, reject parent/reference/raw identity in Agent inputs, and document the mandatory re-list step before child operations.

## Migration Plan

Add the schema and capability definition without changing existing operation inputs or resource kinds, regenerate capability governance documentation, and update package/runtime tests. Rollback removes the new capability and metadata guidance; existing exact-label authorization and Human/UI Content Space behavior remain unchanged.
