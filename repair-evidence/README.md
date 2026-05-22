# Repair Evidence Store

SciForge writes feedback repair evidence here when screenshot evidence is persisted by the workspace writer.

- `public/` contains scrubbed evidence that can be linked from GitHub markdown or uploaded to a public/object-storage target.
- `private/` is for local-only raw evidence and is ignored by git.

The workspace writer can publish `public/` assets through `/api/sciforge/feedback/issues/:id/evidence/upload`. It supports GitHub Contents upload when a repo and token are provided, or a configured local/static hosting target via `SCIFORGE_REPAIR_EVIDENCE_UPLOAD_DIR` and `SCIFORGE_REPAIR_EVIDENCE_PUBLIC_BASE_URL`.
