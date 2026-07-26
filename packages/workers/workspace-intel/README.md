# @sciforge/workspace-intel

Read-only workspace and visible-GUI intelligence worker for SciForge runtimes.

It exposes guarded workspace listing, tree, file read, bounded reference listing and preview, skill discovery, and visible-context lookup through a pure Node service and an MCP stdio server. Its Model Router adapter is reused by SciForge's Host-owned agent visual runtime.

Agents inspect and persist visuals through the native `sciforge_look` and `sciforge_capture` tools. This worker does not expose a second agent-visible inspection, screenshot, crop, or snapshot-token path.

Host Core resolves the current surface, an opaque visual resource, or a workspace-confined PNG, JPEG, or WebP image, then sends the immutable frame through the Model Router adapter here. Source providers own rendering; the adapter owns only structured visual understanding.

Successful visual tasks return attested generic evidence:

- artifact ids, detected MIME types, and SHA-256 digests;
- claims anchored to an artifact and optionally to normalized image coordinates;
- per-claim confidence, uncertainties, and an optional structured result.

All visual model inference is sent only to a local SciForge Model Router at `http(s)://<loopback>/v1/responses`. Router URLs with a remote host, credentials, query, fragment, or another path fail before network access. This worker contains no provider client, provider endpoint, or provider credential handling.
