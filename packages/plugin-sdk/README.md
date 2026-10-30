# `@sciforge/plugin-sdk`

This package is the first PR-1 slice for external SciForge plugins. It provides
host-independent manifest parsing, Host API compatibility checks, independent
directory discovery, and a fail-closed lifecycle state machine.

It deliberately does not execute arbitrary plugin code. A host must supply an
isolated adapter and register lifecycle hooks explicitly. The SDK is therefore
safe to use for discovery and migration fixtures before the extension host is
connected.

## Workspace-preview contribution channel (gap-1b, reference implementation)

`workspace-preview-channel.ts` adds a fifth contribution kind:
`sciforge.adapter.json` may declare `kind: "workspace-preview"` with a
`previewSlots` allowlist (slotId + artifactKinds). A plugin entry exposes its
providers through the named export `getWorkspacePreviewProviders()` — the same
named-export pattern as `getCapabilityDefinitions()`. The Host then invokes
those providers during rendering over the `sciforge-preview.v1` wire
(`observe` / `invokeAction` / `prepareArtifact` / `applyEdit` /
`exportPreview`), which is the **reverse direction** of the HOST-PORTS bridge:
host-initiated instead of plugin-initiated.

Governance mirrors the HOST-PORTS three-layer model: (1) the declaration's
slot allowlist is matched exactly and artifact kinds are checked per call;
(2) packageName@version identity is bound by the runtime, never
plugin-supplied; (3) every call carries an explicit render-target
`workspaceRoot`, which the runner re-checks against the request's own
`file.workspaceRoot`. Artifact bytes cross the wire as base64
(`bytesBase64`), capped at 8 MiB encoded; requests use a 30s timeout (the
HOST-PORTS budget; render-time preview calls are bounded pure compute plus
local reads).

Status: **reference implementation for the SDK maintainer to ratify.** Open
decisions: whether the contribution-kind enum generalizes to an open list;
whether this channel and HOST-PORTS later unify into one bidirectional
invocation protocol; whether base64 gives way to a binary transport
(advanced-serialization whitelist).

