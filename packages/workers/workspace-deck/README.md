# SciForge Workspace Deck Worker

First-party TypeScript worker package for bounded deck previews.

This package summarizes provided slide metadata into a deck outline and WorkspaceObservation-shaped result. It also performs lightweight `.pptx` OpenXML summaries by reading the package zip for slide count, slide titles/text snippets, speaker notes previews, and bounded text-bearing element summaries.

The deck worker keeps `observation.slides` compatible with the shared WorkspaceObservation contract. Richer PPTX-first data is exposed on the worker result as bounded `elements` entries with `id`, `slideId`, `text`, and `kind` (`title`, `subtitle`, `body`, `notes`, `placeholder`, or `text`). The service also exposes pure in-memory `selectSlide()` and `selectText()` helpers for slide/text-element selection against an existing preview result.

Full rendering, screenshot capture, Office editing kernels, export mutation, and legacy binary `.ppt` parsing are intentionally out of scope for this worker skeleton.

## Scripts

```sh
npm --prefix packages/workers/workspace-deck run typecheck
npm --prefix packages/workers/workspace-deck run test
```
