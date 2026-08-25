# Content Space local mock Provider

Deterministic, in-memory, credential-free Content Space Provider used only by
development and contract tests. Its manifest is validated through the same
package path as production domains, but `composition: development-only` keeps
it out of generated application composition.

The Provider implements the Content Space V4 contract, including exact
write-after observation, bounded descendant proof, and one-use download
authorization leases. These are deterministic test behaviors, never a
production fallback or evidence that portable metadata grants Provider access.

All content and version history are process-local and are lost on restart.
Accordingly, this mock never claims the retention guarantee required to issue
an `ArtifactReference`; immutable-version observation reports
`verification_profile_required` instead of manufacturing a durable proof.
