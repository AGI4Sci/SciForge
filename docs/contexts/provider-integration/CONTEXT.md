# Provider Integration Infrastructure

> Current-state audit: 2026-08-17. Content Space and Provider Composition are implemented. OpenContent enrollment, credentials, Connector, and adapter form active Change 1 under ADR-0025 and ADRs 0026–0027.

Provider Integration Infrastructure is SciForge's shared language for portable provider identity, trusted Provider composition, and node-local authenticated access. It is technical integration infrastructure used by business contexts, not a business bounded context or an Agent capability.

## Language

**Provider Instance**:
One concrete external-provider deployment and tenant that is independently authoritative for its resources.
_Avoid_: Provider Instance Reference, Provider Connection, endpoint URL

**Provider Instance Reference**:
A stable non-secret portable value that identifies one Provider Instance without containing its endpoint, tenant configuration, or a user's credential.
_Avoid_: endpoint URL, Provider Connection ID, bearer token

**Provider Instance Directory**:
The trusted non-secret catalog that associates a Provider Instance Reference with its Provider Kind, safe display name, contract version, and trusted contribution owner. It contains no endpoint, tenant policy, Human-specific access binding, connection, or credential; provider-private endpoint and tenant policy remain keyed to the same reference inside the owning Connector.
_Avoid_: connection registry, credential store, endpoint from a reference

**Provider Contract**:
A domain-specific interface that defines one coherent family of provider-backed semantics. Shared Documents owns DocumentProvider; Content Space owns ContentSpaceProvider.
_Avoid_: universal Provider, vendor SDK, raw Client

**Provider Integration Package**:
A separately owned integration unit that implements one or more Provider Contracts while keeping each implementation independently identifiable and replaceable.
_Avoid_: Host feature, runtime marketplace plugin, vendor switch

**Provider Contribution**:
One independently validated implementation registration for exactly one Provider Contract and Provider Kind. A package that supports two domains contributes twice rather than exposing an optional-method union.
_Avoid_: universal adapter, central registration entry, provider bundle implies capabilities

**Provider Catalog**:
A domain-owned runtime view of compatible installed Provider Contributions. It rejects missing, duplicate, or incompatible ownership and does not select another Provider as fallback.
_Avoid_: Host provider map, service locator, fallback chain

**Provider Kind**:
The stable non-secret identity of one Provider implementation family, used to select a compatible installed contribution after a trusted Provider Instance is resolved.
_Avoid_: Provider Instance, package path, endpoint hostname

**Provider Access Binding**:
A provider-owned node-local binding that lets the current Human Principal access one Provider Instance. An external Provider may use an enrolled Provider Connection; a first-party Provider may derive access from the current SciForge Cloud Session.
_Avoid_: portable credential, shared administrator session, universal connection model

**Provider Connection**:
A named node-local Provider Access Binding used when a Provider requires separate enrollment and credentials. V1 permits at most one active connection for each `(Human Principal, Provider Instance)` on one Agent Host.
_Avoid_: Provider Instance, mandatory first-party login, portable credential, shared administrator session

**Provider Connection ID**:
The node-local identity of one Provider Connection. It never travels in a portable resource reference.
_Avoid_: Provider Instance Reference, cross-node credential handle

**Provider Credential**:
Secret material associated with one Provider Connection and protected for use only by its trusted local integration owner.
_Avoid_: Provider Connection, Token in public/caller-controlled URL, shared integration key. A verified provider-mandated query Token is permitted only inside the owning main-process Connector's immediate request to a pinned HTTPS target and never becomes a public or durable URL.

**Provider Enrollment**:
A Human-only interaction that proves control of an existing External Account and creates or replaces the current Principal's node-local Provider Connection. Enrollment UI belongs to the Provider Integration Package while credential use and network transport remain main-process only.
_Avoid_: SciForge login, provider account creation, Content Space operation, Agent-supplied credential

**Provider Enrollment View**:
A Provider Integration-owned Human interface mounted only after a concrete Provider Instance is selected inside the consuming domain's surface. Its placement does not transfer credential or connection ownership to that domain.
_Avoid_: plugin configuration, standalone Provider panel, Content Space-owned credential form

**Provider Connection Authority**:
The rule that every Provider operation uses the executing node owner's current Provider Connection. A remote requester, Task, portable reference, Agent prompt, or runtime argument can never nominate, transfer, or borrow another connection.
_Avoid_: caller-selected account, Project credential, Coordinator credential, administrator fallback

**Portable Resource Reference Envelope**:
A versioned, bounded, non-secret carrier for one registered logical provider-resource reference. It is durable and cross-node but grants no access by itself.
_Avoid_: Local Broker Resource Reference, capability handle, arbitrary URI, metadata bag

**Local Broker Resource Reference**:
A process-local, audience-bound executable reference issued only after a portable reference has been validated, locally resolved, and reauthorized for the current Human Principal.
_Avoid_: portable reference, cloud resource ID, persistent handle

**Capability Readiness**:
The explicit state of one provider-backed operation: `poc_only`, `blocked_by_contract`, or `production_ready`.
_Avoid_: feature flag, demo success, endpoint exists

**Provider Migration**:
An explicit governed operation that copies or converts a resource to a different Provider Instance and produces a new reference. It is never an availability fallback.
_Avoid_: automatic failover, reference reinterpretation, silent provider switch

**OpenContent Verification Profile**:
A trusted development-only policy binding an exact Provider Instance, least-privilege account class, operation set, limits, and permitted UI/Agent audiences. The current shared demonstration instance may be used only through this profile; callers cannot select endpoints or promote readiness, and production admission remains separate.
_Avoid_: production fallback, shared-tenant security boundary, caller-selected mode
