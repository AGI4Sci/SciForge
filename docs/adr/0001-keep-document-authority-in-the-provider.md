---
status: accepted
---

# Keep document authority in the provider

Shared Document content, revisions, collaboration state, and access control remain solely authoritative in the Document Provider. SciForge retains named Provider Connections, opaque Document References, and audit correlation, but never an editable mirror; this avoids split-brain behavior and a second concurrency model at the cost of offline editing and filesystem projection.
