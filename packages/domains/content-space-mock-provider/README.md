# Content Space local mock Provider

Deterministic, in-memory, credential-free Content Space Provider used by the
bundled application and contract tests. It is installed through the same
provider-factory and Provider Instance directory contributions as any other
trusted Provider package.

All content and version history are process-local and are lost on restart.
Accordingly, this mock never claims the retention guarantee required to issue
an `ArtifactReference`; immutable-version observation reports
`verification_profile_required` instead of manufacturing a durable proof.
