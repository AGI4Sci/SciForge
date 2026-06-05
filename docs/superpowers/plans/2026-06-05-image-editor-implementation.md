# Image Preview and Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved SciForge common image preview and lightweight editor from `docs/superpowers/specs/2026-06-05-image-editor-design.md`.

**Architecture:** Keep `packages/presentation/components/image-evidence-viewer` presentation-only. Add the editor, annotation model, rasterizer, and workspace-backed save adapter in the UI host layer under `src/ui/src/app/results/`. The editor stores all geometry in source-image pixel coordinates, rasterizes through browser canvas on save, writes PNG + annotation JSON to `.sciforge/artifacts/<session>/<artifactId>/...`, and focuses the right Image pane on the new PNG payload without inserting it into composer or chat references.

**Tech Stack:** React 19, TypeScript, Node test runner, SSR/source component tests, workspace writer `writeWorkspaceFile`, browser canvas, lucide-react icons.

---

## Files

- Create: `src/ui/src/app/results/imageAnnotationModel.ts`
- Create: `src/ui/src/app/results/imageAnnotationModel.test.ts`
- Create: `src/ui/src/app/results/imageAnnotationRasterizer.ts`
- Create: `src/ui/src/app/results/imageAnnotationRasterizer.test.ts`
- Create: `src/ui/src/app/results/imageAnnotationSaveAdapter.ts`
- Create: `src/ui/src/app/results/imageAnnotationSaveAdapter.test.ts`
- Create: `src/ui/src/app/results/ImageAnnotationEditor.tsx`
- Create: `src/ui/src/app/results/ImageAnnotationEditor.test.tsx`
- Modify: `src/ui/src/app/results/imagePaneHostAdapter.tsx`
- Modify: `src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts`
- Modify: `packages/presentation/components/image-evidence-viewer/render.tsx`
- Modify: `packages/presentation/components/image-evidence-viewer/render.test.tsx`
- Modify: `src/ui/src/styles/app-04.css`

## Task 1: Annotation Model

**Files:**
- Create: `src/ui/src/app/results/imageAnnotationModel.ts`
- Create: `src/ui/src/app/results/imageAnnotationModel.test.ts`

- [ ] Write failing tests for schema defaults, coordinate conversion, crop export size, and annotation ordering.
- [ ] Run: `node --import tsx --test src/ui/src/app/results/imageAnnotationModel.test.ts`
- [ ] Implement versioned annotation document types, helpers to create annotations, `screenPointToImagePoint`, `exportSizeForAnnotationDocument`, and deterministic layer ordering.
- [ ] Re-run the same test until it passes.

## Task 2: Rasterizer

**Files:**
- Create: `src/ui/src/app/results/imageAnnotationRasterizer.ts`
- Create: `src/ui/src/app/results/imageAnnotationRasterizer.test.ts`

- [ ] Write failing tests for pure render-plan generation: crop source rect, canvas output size, freehand/arrow/rect/highlight/text/pin/blur-redact command order.
- [ ] Run: `node --import tsx --test src/ui/src/app/results/imageAnnotationRasterizer.test.ts`
- [ ] Implement `buildImageAnnotationRenderPlan()` as a pure function and `rasterizeImageAnnotationToPngBlob()` as browser-only canvas execution.
- [ ] Re-run the same test until it passes.

## Task 3: Workspace-Backed Save Adapter

**Files:**
- Create: `src/ui/src/app/results/imageAnnotationSaveAdapter.ts`
- Create: `src/ui/src/app/results/imageAnnotationSaveAdapter.test.ts`

- [ ] Write failing tests proving save writes exactly two files, uses `.sciforge/artifacts/<session>/<artifactId>/`, uses PNG base64 for the image, writes JSON annotation metadata, returns an `ImageEvidencePayload`, and does not expose composer/chat mutation hooks.
- [ ] Run: `node --import tsx --test src/ui/src/app/results/imageAnnotationSaveAdapter.test.ts`
- [ ] Implement `saveImageAnnotationArtifact()` with dependency-injected writer defaulting to `writeWorkspaceFile`.
- [ ] Re-run the same test until it passes.

## Task 4: Editor UI

**Files:**
- Create: `src/ui/src/app/results/ImageAnnotationEditor.tsx`
- Create: `src/ui/src/app/results/ImageAnnotationEditor.test.tsx`
- Modify: `src/ui/src/styles/app-04.css`

- [ ] Write failing SSR/source tests for Edit/Cancel/Save controls, SVG overlay, tool buttons, selected tool state, inline text label input, keyboard shortcuts, and the absence of Fabric/Konva imports.
- [ ] Run: `node --import tsx --test src/ui/src/app/results/ImageAnnotationEditor.test.tsx`
- [ ] Implement the SVG/DOM overlay editor with tools: select, crop, pen, arrow, rectangle, text, pin, highlight, blur/redact.
- [ ] Add styles for the modal/editor toolbar, stage, overlay, handles, active tools, disabled save, and status messages.
- [ ] Re-run the same test until it passes.

## Task 5: Host Adapter Wiring

**Files:**
- Modify: `src/ui/src/app/results/imagePaneHostAdapter.tsx`
- Modify: `src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts`
- Modify: `packages/presentation/components/image-evidence-viewer/render.tsx`
- Modify: `packages/presentation/components/image-evidence-viewer/render.test.tsx`

- [ ] Write failing tests that the right pane title is Image, read-only image click/open original stays available, the modal has an Edit entry, editing disables image-click original opening, Save focuses the new PNG ref locally, and presentation renderer remains host-policy only.
- [ ] Run: `node --import tsx --test src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts packages/presentation/components/image-evidence-viewer/render.test.tsx`
- [ ] Wire `ImageAnnotationEditor` into the existing original image modal and feed save results back into the local Image pane payload.
- [ ] Keep `renderImageEvidenceViewer()` presentation-only and only add inert `data-` hooks needed by the host editor.
- [ ] Re-run the same tests until they pass.

## Task 6: Verification

**Files:**
- Modify only if tests reveal gaps.

- [ ] Run focused unit/component tests:
  `node --import tsx --test src/ui/src/app/results/imageAnnotationModel.test.ts src/ui/src/app/results/imageAnnotationRasterizer.test.ts src/ui/src/app/results/imageAnnotationSaveAdapter.test.ts src/ui/src/app/results/ImageAnnotationEditor.test.tsx src/ui/src/app/results/rightPaneSurfaceAdapter.test.ts packages/presentation/components/image-evidence-viewer/render.test.tsx`
- [ ] Run broader UI result tests:
  `npm test -- src/ui/src/app/results/imagePaneModel.test.ts src/ui/src/app/results/rightPaneTabController.test.ts`
- [ ] Start or reuse the local dev server and use the in-app Browser to visually verify: Image tab label, uploaded image ref click focuses Image pane, fit does not overflow, Open original works/falls back, Edit mode draws at least a pen line and pin, Save writes a new image ref and displays it.
- [ ] Capture final evidence in the final answer with commands run and browser URL checked.
