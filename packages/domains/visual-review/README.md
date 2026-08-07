# Visual Review domain

Official SciForge domain package for structured image review. It owns the
`VisualDocument` contract, filesystem-backed revision service, capability
factory, Workbench command, toolbar contribution, right-panel UI, and
annotation interaction. The right panel also owns reference-image style
recognition through `visual-review.apply-style-reference`; the extracted
manuscript profile is stored at the canonical workspace style path and linked
to the active `VisualDocument`.

Consumers open this package through the `visual-review.open` renderer command
with a bounded activation payload. Renderer code invokes all document reads and
writes through package capabilities; there is no package-specific IPC path.
Revision requests discover and invoke image-generation MCP operations through
the runtime-neutral SciForge capability broker.

Candidate revisions never overwrite the source artifact until the user accepts
them in the comparison surface. Rejection leaves the source unchanged.
