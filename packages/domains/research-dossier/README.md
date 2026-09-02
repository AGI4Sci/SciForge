# Research

Presentation-only SciForge domain that opens an exact artifact version or
scientific compute run and composes owner-provided read models into a
target-appropriate dossier. It stores no records, owns no current pointer, and
never falls back to `latest`.

Research recording starts automatically at the Host pre-turn boundary. The
ordinary chat exposes no recording controls. The dossier recording-status
surface can persistently stop automatic recording and
explicitly start it again through the Research Checkpoints owner capabilities.
The same controls are available before the first record, so a researcher can
opt out before the next completed turn creates v1. Historical turns are never
silently backfilled; an explicit legacy import selects durable turns and
permanently marks the resulting record `legacy/incomplete`. A successful import
opens the exact committed Version ID and digest returned by the owner.

The status response carries the canonical `policyRevision`. Every Start/Stop
request supplies that exact value as `expectedPolicyRevision`; the owner rejects
stale controls instead of applying a lost update. The dossier disables the
control while the request is pending and re-reads canonical status after either
an owner receipt or an owner-reported error. It never advances policy locally
from the button click or receipt alone.

When the exact Artifact is a Research Checkpoint, the dossier calls the public
`research-checkpoints.read` capability with its exact Version ID (and recording
identity when present). It verifies the returned full `ArtifactVersionRefV1`
and immutable recording/turn scope before rendering the narrative, sources,
declared files, Artifact/Compute/Git references, untracked operations,
breakpoints, and applicable trust status. The default view prioritizes research
findings, sources, outputs, version position, reproduction state, and actionable
limitations; raw IDs, digests, receipts, and codes stay in collapsed technical
details, while empty or inapplicable sections are omitted. Owner unavailability
degrades only that projection; an identity or digest mismatch fails closed and
never substitutes a source, current, or latest Version.

Rich Artifact history is requested only through the additive Artifact Versions
`describe-v2`, `list-v2`, and `bundle.export-v2` actions. The dossier does not
add fields to the existing V1 list, export receipt, verification, issue, or
reference wires, preserving strict clients built from `origin/gui`.

## Researcher-facing presentation

The default dossier is a decision surface, not a provenance debugger. It keeps
the research summary, change reason, useful sources, outputs and previews,
version position, reproduction status, and actionable trust limitations visible.
Exact IDs, SHA-256 values, raw receipts, provider revisions, breakpoint codes,
and redundant owner fields remain available under collapsed technical details.
Empty or inapplicable Compute, Evidence, or Review sections are omitted.

Integrity and authorization are never hidden for visual simplicity. Access
denial, expected-content mismatch, exact owner scope/ref mismatch, unavailable
claimed evidence, failed reproduction, and blocking provenance limitations stay
visible and fail closed. The loader never substitutes current or latest data.

The ordinary chat is only an exact navigation surface. A committed turn may
render one neutral “打开科研档案” button bound to the Version ID and expected
digest; the expanded checkpoint, output cards, version badges, warnings, raw
identifiers, and recording status strip do not appear in the transcript or
composer.

Cross-domain callers do not import the dossier activation schema or name its
right-panel contribution. They send the generic renderer Host an exact resource
kind, resource ID, and optional SHA-256 integrity binding. This package owns the
single `renderer.resource-navigation` contribution for supported Artifact and
Compute identities and translates that request into its private panel
activation. Dossier-specific schemas and helpers are published only from the
package-owned `@sciforge/domain-research-dossier/contract` entrypoint.

## Verification

```bash
npm --workspace @sciforge/domain-research-dossier run test
npm --workspace @sciforge/domain-research-dossier run typecheck
```

These package commands are focused gates; repository typecheck, composition,
build, and real Electron checkpoint/Dossier tests remain release gates.

See the Chinese guide:
[产物与版本管理](../../../docs/research/artifact-versioning-and-research-checkpoints.zh-CN.md).
