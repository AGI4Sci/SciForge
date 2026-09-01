# Provider Integration Infrastructure

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

**Provider Integration**:
A separately owned domain package that implements one or more Provider Contracts while keeping each implementation independently identifiable and replaceable.
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

**Connector**:
A provider-specific main-process boundary that owns trusted endpoint and tenant policy, enrollment, credentials, Connection/session state, transport, and Provider schema validation. It exposes only narrow token-free facades to Provider Integrations and owns no business-domain semantics.
_Avoid_: Provider Contract, Agent tool, renderer client, Host routing switch

**Provider Deployment Configuration**:
A public package-owned fixed binding between one Provider Instance Reference and the HTTPS origin required to construct its Connector runtime. Callers cannot override it. Its absence or invalidity leaves discovery installed but makes Provider-backed calls unavailable before Connection storage, credentials, network, or supplier execution; confirmed node-local unbind remains available to delete the fixed-slot local credential without a Provider call.
_Avoid_: compiled demo endpoint, environment override, caller-selected URL, package setting, fallback Provider

**Provider Binding Attestation**:
Token-free evidence binding one Provider Instance and complete current Principal to an opaque stable external subject and opaque Connection revision. It is re-attested against the actual current session before business dispatch and is neither a credential, portable authority, Project provisioning fact, nor Provider ACL grant. Provider account and display-name metadata may refresh without changing that stable subject; they never participate in identity continuity.
_Avoid_: Project Content Provisioning Attestation, Host assurance, raw external account ID, cached login claim, portable Connection

**Provider Connection ID**:
The node-local identity of one Provider Connection. It never travels in a portable resource reference.
_Avoid_: Provider Instance Reference, cross-node credential handle

**Provider Credential**:
Secret material associated with one Provider Connection and protected for use only by its trusted local integration owner.
_Avoid_: Provider Connection, Token in public/caller-controlled URL, shared integration key. A verified provider-mandated query Token is permitted only inside the owning main-process Connector's immediate request to a pinned HTTPS target and never becomes a public or durable URL.

**Provider Enrollment**:
A Human-only interaction that proves control of an existing External Account and creates or replaces the current Principal's node-local Provider Connection. Enrollment UI belongs to the Provider Integration while credential use and network transport remain main-process only.
_Avoid_: SciForge login, provider account creation, Content Space operation, Agent-supplied credential

**Provider Enrollment View**:
A Provider Integration-owned Human interface mounted only after a concrete Provider Instance is selected inside the consuming domain's surface. Its placement does not transfer credential or connection ownership to that domain. If Provider status is unavailable, the view may still expose the integration's existing node-local unbind only after explicit Human confirmation and without contacting the Provider.
_Avoid_: plugin configuration, standalone Provider panel, Content Space-owned credential form

**Provider Connection Authority**:
The rule that every Provider operation uses the executing node owner's current Provider Connection. A remote requester, Task, portable reference, Agent prompt, or runtime argument can never nominate, transfer, or borrow another connection.
_Avoid_: caller-selected account, Project credential, Coordinator credential, administrator fallback

**Operation-Time Authorization Check**:
A Connector-owned real Provider check or business operation that evaluates the current re-attested session immediately before a protected read or write. Metadata visibility and a previously observed member list are not substitutes for this check.
_Avoid_: ancestry observation, cached ACL, Cloud Membership, provisioning signature

**Portable Resource Reference Envelope**:
A versioned, bounded, non-secret carrier for one registered logical provider-resource reference. It is durable and cross-node but grants no access by itself.
_Avoid_: Broker Resource, capability handle, arbitrary URI, metadata bag

**Broker Resource**:
A process-local, audience-bound executable reference issued only after a portable reference has been validated, locally resolved, and reauthorized for the current Human Principal.
_Avoid_: portable reference, cloud resource ID, persistent handle

**Supplier-backed Connector Transport**:
Public SciForge-authored wire contracts, reviewed command allowlist, asset verification, and bounded process transport owned by a Connector. Receipt-to-domain semantics remain owned by the consuming Provider integration. It is never a separately versioned feature package, Provider Contract, capability surface, or supplier payload.
_Avoid_: public runtime package, private attachment, Agent runtime, second Connector, vendor SDK passthrough

**Private Supplier Overlay**:
Optional receipt-backed supplier runtime data installed outside the public dependency graph and loaded only from fixed source or packaged locations. Its presence changes candidate runtime inventory, never readiness, admission, identity, or authority.
_Avoid_: private domain package, production switch, `node_modules` fallback, credential bundle

**Provider Migration**:
An explicit governed operation that copies or converts a resource to a different Provider Instance and produces a new reference. It is never an availability fallback.
_Avoid_: automatic failover, reference reinterpretation, silent provider switch
