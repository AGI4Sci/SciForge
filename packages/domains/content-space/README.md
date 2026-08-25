# Content Space

Trusted, provider-neutral Content Space domain package. It owns the public
resource and Provider SPI contracts, capability/service/catalog path, portable
reference codecs and resolver, and renderer contribution. Concrete providers
are installed independently through standard domain-package composition.

This package intentionally has no credential, endpoint, connection, Shared
Documents, or OpenContent-specific behavior.

## Readiness and boundaries

Standard composition registers a Provider and its declared operation families;
it does not make an operation `production_ready` or `live_verified`. Provider
readiness is descriptive evidence; current invocation admission separately
evaluates the Principal, Broker authority, audience, platform, transfer and
verification facts. An admitted PoC invocation remains `poc_only`.

A package-owned `main.content-space-verification-profile` extension may
contribute one static, separately reviewed verification profile. Manifest and
runtime values must match exactly, and invalid, drifting, duplicate, or unsafe
profiles fail composition; the contribution declaration must explicitly set
`"publicRelease": "forbidden"`, and omission or `allowed` also fails Content
Space composition. The generic official-release guard rejects that declaration
through standard domain discovery without knowing the Content Space location or
package identity. The default composition installs no profile. Each
profile binds one Provider Instance, the complete Host Principal snapshot
(including assurance), exact authority and operation, audience, bounded
upload/download maxima, and a validity window of at most 24 hours. The matched
maxima are enforced for the invocation. Provider-scoped operations, mutations,
administration, and non-zero transfers additionally require an exact v2
Provider Binding Attestation from the pinned Provider. The attestation binds the
Provider Instance and Principal to an opaque external subject and opaque
Connection revision; the Provider must pass the exact expectation to its
Connector for immediate pre-dispatch re-attestation. Zero-transfer
`list-containers` bootstrap and exact-root reads are the only profiles safe
without it. A profile only narrows one `poc_only` invocation, cannot admit
`blocked_by_contract`, and cannot be installed or widened by caller input,
renderer state, Agent requests, prompts, Tasks, ordinary
environment/configuration, package presence, or a successful sibling
operation.

An `ArtifactReference` requires Provider proof of immutable retention and
version-specific retrieval. A mutable file identity, version number, or digest
is not that proof. The current OpenContent Provider therefore keeps
`observeImmutableVersion` blocked, keeps same-file update blocked until an
atomic exact-version compare-and-update contract exists, and keeps hash-bound
native-document mutations blocked until `baseHash` is compared atomically with
the mutation.

Content Space exposes no Task-specific port. Cloud Task handoff remains owned
by Cloud Collaboration and requires its Project Content Space Binding, typed
Task file intents, and exact Task-turn resource injection and retirement.
Content Space also exposes no Project provisioning capability, operation,
intent/report schema, or Provider port. A future Project-owning integration
must introduce its own authoritative binding and identity contract through a
separately reviewed change rather than reuse ordinary Provider administration.

Ordinary shared-container membership uses a different identity boundary. The
v2 extended contract gives each directory search a literal-kind summary/page
result; typed `searchUsers` therefore returns only non-secret user references containing only
the Provider Instance, principal kind, and opaque Provider principal ID. The
v3 Administration contract uses that reference as the sole add/list/remove
member identity, rejects legacy Host `contentUserId` member payloads, and
requires the root, input member, and Provider output to stay on the same
Provider Instance. Cloud-owned `contentUserId` is not part of this contract,
and ordinary membership cannot create or reconcile Project authority. Member
page items are exactly `{ member }`, and mutation receipts reuse that same
reference with exact root/result fields; no public member-role or
ownership-transfer operation exists. `updateSpace`, `pinSpace`, `unpinSpace`,
`addMember`, and `removeMember` accept no `expectedRevision`, return no
Administration revision, and declare `concurrency.revision: "none"`; this is an
explicit absence of optimistic-concurrency/CAS semantics. An ordinary root
resource is not standing administration approval: each of these five Agent
mutations requires fresh Human confirmation before Provider dispatch, either
for the exact invocation or for one immutable approved provisioning batch.

`content-space.provisioning-batch` is the single delegated path for the typed
authorize/create/list/add/remove/list administration contracts. It does not
expand or weaken the generic Host limit of 64 immutable operations. Initial
provisioning therefore fits only when its exact authorize → create → first
member-list → bounded adds → final member-list plan fits that gate. A member
page `nextCursor` is a factual Provider result, not implicit completeness; if
the newly created root returns one, the Coordinator must fail closed and move
to explicit recovery instead of treating the first page as the full roster.
The public page contract deliberately retains `nextCursor` so no layer can
erase that fact.

Outside that exact approved administration batch, delegated resources
authorize non-destructive ordinary writes only. Every native-document or
extended operation declared `destructive` requires fresh per-invocation Human
confirmation and carries no `autonomousWrite` grant. An ordinary child,
feature-selection, or Provider-administration resource cannot substitute for
that confirmation; the Broker rejects the call before Provider binding or
dispatch.

All ten Administration outputs are strictly bound to the exact request and
Broker authority. Pages must be bounded, unique, and progressing, and an empty
page cannot carry `nextCursor`. Root-scoped results echo the exact root;
create/update/pin/unpin prove their requested label/current owner/pinned state;
member mutation receipts echo the exact root and member. An output mismatch on
a read is `provider_unavailable`; on an external write or destructive operation
it is `outcome_unknown`, and neither result permits automatic retry.

See [the Content Space glossary](../../../docs/contexts/content-space/CONTEXT.md),
[the architecture and canonical call chain](../../../docs/content-space-architecture.md),
[ADR-0030](../../../docs/adr/0030-activate-provider-native-documents-through-content-space.md),
and [the OpenContent capability matrix](../../../docs/opencontent-skill-capability-matrix.md).
