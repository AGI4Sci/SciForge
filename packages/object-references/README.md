# @bioagent-ui/object-references

BioAgent object references are the stable memory pointers used by chat, results,
feedback, workbench surfaces, and future timeline/notebook views.

This package owns normalization and conversion only. It does not render chips,
open files, execute tasks, or decide what the agent should do.

## Agent Quick Contract

- Use `objectReferenceForArtifactSummary` for runtime artifacts that should be
  focusable in the right pane.
- Use `referenceForUploadedArtifact` and `objectReferenceForUploadedArtifact`
  after an upload has been persisted as a `RuntimeArtifact`.
- Use `referenceForObjectReference`, `referenceForArtifact`, and
  `referenceForWorkspaceFileLike` when converting an object/file/artifact into a
  chat context reference.
- Use `artifactForObjectReference`, `pathForObjectReference`, and
  `referenceToPreviewTarget` in preview surfaces instead of guessing refs.
- Use `objectReferenceChipModel` to keep trusted references before unverified
  references and to compute hidden chip counts consistently.
- Use `referenceForUiElement`, `referenceForTextSelection`, and
  `stableElementSelector` for DOM/feedback references.

## Human Notes

Object references are long-lived pointers. Prefer workspace paths, artifact ids,
run ids, hashes, and producer metadata over transient DOM labels. UI code may
decorate references, but the reference payload should remain small and portable.

References are trusted when they point to an available artifact/url or include
provenance that can be checked later. AgentServer-only refs without workspace
provenance stay untrusted until the user focuses or validates them.
