# @sciforge/workspace-intel

Read-only workspace and visible-GUI intelligence worker for SciForge runtimes.

It exposes guarded workspace listing, tree, file read, bounded reference listing and preview, skill discovery, visible-context lookup, surface-bound visual understanding, and direct workspace-image understanding through a pure Node service and an MCP stdio server.

Surface and artifact inspection are registered app capabilities. Agents discover and invoke `surface.inspect` or `artifact.inspect` through SciForge's stable discover/observe/invoke/events meta-tools; this worker does not expose a second GUI tool surface or snapshot-token protocol.

`surface.inspect` accepts an opaque stable target reference and resolves the latest layout atomically in the canonical provider. `artifact.inspect` accepts one to eight workspace-confined PNG, JPEG, or WebP artifacts with optional normalized regions. Both use Model Router visual inspection and return structured, attested evidence.

Successful visual tasks return attested generic evidence:

- artifact ids, detected MIME types, and SHA-256 digests;
- claims anchored to an artifact and optionally to normalized image coordinates;
- per-claim confidence, uncertainties, and an optional structured result.

All visual model inference is sent only to a local SciForge Model Router at `http(s)://<loopback>/v1/responses`. Router URLs with a remote host, credentials, query, fragment, or another path fail before network access. This worker contains no provider client, provider endpoint, or provider credential handling.
