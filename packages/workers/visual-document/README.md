# SciForge VisualDocument worker

This package owns the single structured storage and revision lifecycle for visual review.

Each document is stored at:

```text
.sciforge/visual-documents/<documentId>/document.json
```

`VisualDocument` contains the canvas, source artifact, semantic nodes, normalized human annotations, truth locks, style profile reference, and revision history. Generated output is first staged as a `candidate`. It never changes the source artifact until a human explicitly accepts it. Acceptance verifies hashes, backs up the previous source, atomically replaces it, and records the accepted revision. Rejection only updates history.

The public API and MCP tools expose one workflow:

1. Open or create a VisualDocument.
2. Insert one source artifact.
3. Update shared semantic/style/truth context.
4. Save normalized annotations.
5. Export a structured review packet.
6. Create a candidate revision.
7. Accept or reject the active candidate.

There is no editor-specific XML or snapshot storage. Rendering and interaction layers consume `VisualDocument` JSON directly.
