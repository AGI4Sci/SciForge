# Content Space local mock Provider

Deterministic, in-memory, credential-free Content Space Provider used only by
development and contract tests. Its manifest is validated through the same
package path as production domains, but `composition: development-only` keeps
it out of generated application composition.

All content and version history are process-local and are lost on restart.
Accordingly, this mock never claims the retention guarantee required to issue
an `ArtifactReference`; immutable-version observation reports
`verification_profile_required` instead of manufacturing a durable proof.
