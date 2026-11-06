# Shared tool result delivery

`withBoundedToolResults` wraps the composed Host tool surface once. Codex,
Claude Code and DSH consume the same `modelContent`; adapters do not own
independent truncation policies. Small results and owner-prepared bounded
receipts are preserved exactly.

A result above the 4 KiB serialized delivery budget is persisted before its
continuation is returned. `AgentRuntimeHost.persistToolResult` uses the selected
adapter's existing durable journal, not a second result cache. The preview
includes `_delivery.status`, original byte count, SHA-256 and a
`sciforge_read_history` call. Previews prioritize operation references, atomic
schemas, status, recovery and continuation fields. Omitted schemas are retrieved
from the stored result instead of repeating discovery. Saving failure is
non-retryable: the original tool has already returned and must not be replayed.
Restricted tool scopes do not acquire permission to read history implicitly.

History accepts an optional RFC 6901 `jsonPointer` with `artifactRef`, such as
`/operations/0/inputShape`. Follow `nextOffset` until null, keeping the same
artifact reference and pointer. Pages account for the final JSON envelope,
escaping and UTF-8, preserving exact text. The returned hash describes the whole
selected value. Journal reads remain bound to the calling session and Principal.

Capability observations always fetch fresh authorized state. Identical state and
operations within a turn receive an `unchanged` progress receipt and an explicit
instruction not to repeat observations to recover omitted output. Comparison is
bounded, isolated by caller and turn, and excludes the observation timestamp.
It neither caches execution results nor blocks legitimate polling or mutations.

Runtime-native tool results are outside the Host tool execution surface. The
shared model router preserves bounded structured receipts; for oversized native
outputs it points to the original call's history only when a history tool is
exposed. This cannot restore bytes already discarded by a runtime or process.
No automatic tool replay is performed. Image-budget failures likewise explain
that the identical request cannot recover missing visual evidence.
