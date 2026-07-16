# @sciforge/workspace-intel

Read-only workspace and visible-GUI intelligence worker for SciForge runtimes.

It exposes guarded workspace listing, tree, file read, bounded reference listing and preview, skill discovery, visible-context lookup, surface-bound visual understanding, and direct workspace-image understanding through a pure Node service and an MCP stdio server.

`gui_visible_context` returns an opaque snapshot token bound to one window, thread, and revision. `gui_visual_capture` requires that token and accepts either the bound SciForge window or a component target from the same snapshot. The GUI broker never falls back to another window; unsupported surfaces fail explicitly. Its visual task is general, while GUI quality review is only the default when no task is supplied.

`gui_workspace_image_inspect` is the single direct-image understanding path. It accepts a task and one to eight workspace-confined artifacts, each with a stable id and optional normalized regions. Truth locks and output intent can guide description, OCR, comparison, quality review, or structured extraction. Input MIME is detected from PNG, JPEG, or WebP content instead of trusted from a filename.

Successful visual tasks return attested generic evidence:

- artifact ids, detected MIME types, and SHA-256 digests;
- claims anchored to an artifact and optionally to normalized image coordinates;
- per-claim confidence, uncertainties, and an optional structured result.

All visual model inference is sent only to a local SciForge Model Router at `http(s)://<loopback>/v1/responses`. Router URLs with a remote host, credentials, query, fragment, or another path fail before network access. This worker contains no provider client, provider endpoint, or provider credential handling.
