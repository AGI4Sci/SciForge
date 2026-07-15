# Scientific Object Chat Contract

SciForge conversation tools can return structured scientific objects instead of reducing every
result to text or a generic image. The authoritative runtime schema is
`src/shared/scientific-objects.ts`.

## Emission contract

Put one or more strict `ScientificObjectRef` values under either
`scientificObjects` or `scientific_objects` in tool structured output or assistant metadata.
The renderer traverses only explicit scientific-object containers, with bounded depth and item
counts; it does not guess objects from arbitrary Markdown or log text.

```json
{
  "scientificObjects": [
    {
      "schemaVersion": 1,
      "id": "structure-7tim",
      "modality": "molecular",
      "title": "7TIM structure",
      "source": "tool",
      "path": "/workspace/structures/7tim.pdb",
      "workspaceRoot": "/workspace",
      "mimeType": "chemical/x-pdb",
      "hash": {
        "algorithm": "sha256",
        "digest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      },
      "selection": {
        "kind": "molecular",
        "chains": ["A"]
      },
      "provenance": {
        "toolName": "workspace_molecular_preview",
        "toolVersion": "1",
        "createdAt": "2026-07-11T00:00:00.000Z"
      }
    }
  ]
}
```

Supported modalities are `molecular`, `sequence`, `spectra`, `omics`, and `bioimaging`.
Every ref is content-addressed with SHA-256 and includes a workspace path so the card can open the
first-party workspace preview without embedding large payloads in the transcript.

Optional `observation` values use the existing bounded `WorkspaceObservation` contract. Optional
`preview` values reference a workspace image and are loaded through the existing safe image
transport; `file://` and arbitrary raw HTML are not used.

## Comparison and annotation

Explicit comparisons use `scientificObjectComparisons` or
`scientific_object_comparisons`. A comparison embeds at least two distinct refs. When a turn emits
multiple objects without an explicit comparison, the conversation UI can create an on-demand
comparison table from their core facts.

Annotations conform to `ScientificObjectAnnotation`. An annotation targets either the whole object
or a `WorkspaceStructuredSelection`. Conversation-created annotations are persisted locally by the
content-addressed object identity; source annotations in the ref remain part of the immutable tool
result.

## Interaction boundary

- The timeline initially renders a static, accessible card.
- The card has one open action. Supported biology formats route directly to Biology Room;
  other formats use the ordinary workspace preview.
- Opening preserves the structured selection and SHA-256 integrity expectation. Chat does not
  create a second viewer session or maintain a parallel selection state.
- “Ask about current selection” writes a provenance-bound prompt into the composer; it does not
  silently start a turn.
- Remote or text-only surfaces can fall back to the title, modality, path, hash, and observation
  summary without needing WebGL.

## Verification

Run the focused contract and renderer tests:

```bash
npx vitest run \
  src/shared/scientific-objects.test.ts \
  src/renderer/src/components/chat/ScientificObjectCard.test.ts \
  src/renderer/src/components/chat/ScientificObjectComparisonPanel.test.ts \
  src/renderer/src/components/chat/TimelineScientificObjectsPanel.test.ts
```
