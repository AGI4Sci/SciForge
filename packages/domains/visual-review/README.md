# Visual Review domain

Official SciForge domain package for structured image review. It owns the
`VisualDocument` contract, filesystem-backed revision service, capability
factory, Workbench command, toolbar contribution, right-panel UI, and
annotation interaction.

Consumers open this package through the `visual-review.open` renderer command
with a bounded activation payload. Renderer code invokes all document reads and
writes through package capabilities; there is no package-specific IPC path.

Candidate revisions never overwrite the source artifact until the user accepts
them in the comparison surface. Acceptance first commits the reviewed bytes
through Artifact Versions, then finalizes the local document. A durable receipt
under `acceptance-outbox/` and a deterministic source backup make this boundary
idempotently recoverable if local replacement is interrupted after the shared
version current pointer advances. Rejection leaves the source unchanged and is
blocked while an acceptance receipt is pending.
