---
status: accepted
---

# Exclude document content from Full Trace

Shared Documents telemetry is an allowlist: it records only Document References, operation types, non-content digests, revisions, result codes, and bounded provider audit correlation. Structured bodies, search text/snippets, names/paths, impact previews, and every complete or partial semantic-change payload are excluded from Full Trace and other durable Agent/model capture; an uncertain payload is omitted in full. This sacrifices content-level replay and debugging detail to prevent provider-hosted content from becoming an uncontrolled second copy.
