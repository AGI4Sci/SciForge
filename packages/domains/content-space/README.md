# Content Space

Trusted, provider-neutral Content Space V1 domain package. It owns the public
resource and Provider SPI contracts, capability/service/catalog path, portable
reference codecs and resolver, and renderer contribution. Concrete providers
are installed independently through standard domain-package composition.

This package intentionally has no credential, endpoint, connection, Shared
Documents, or OpenContent-specific behavior.

## Readiness and boundaries

Standard composition registers a Provider and its declared operation families;
it does not make an operation `production_ready` or `live_verified`. Content
Space checks exact per-operation readiness independently of resource authority,
so a Broker resource alone never makes an operation executable.

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

See [the Content Space glossary](../../../docs/contexts/content-space/CONTEXT.md),
[ADR-0030](../../../docs/adr/0030-activate-provider-native-documents-through-content-space.md),
and [the OpenContent capability matrix](../../../docs/opencontent-skill-capability-matrix.md).
