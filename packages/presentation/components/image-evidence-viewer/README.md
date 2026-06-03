# @sciforge-ui/image-evidence-viewer

Generic refs-first image and evidence viewer for presentation-layer payloads.

## Agent quick contract

- componentId: `image-evidence-viewer`
- accepts: `image-evidence`, `annotation-crop`, `screenshot`, `browser-evidence`, `window-capture`, `screen-region`, `artifact-image`, `replay-frame`
- requires: `imageRef` or `ref`; optional `mime`, `width`, `height`, `sha256`, `createdAt`, `provenanceRef`, `annotationRefs`, `targetRef`, `windowRef`, `browserSessionRef`, `artifactRef`, `redactionRef`, `bounds`, `cropBounds`, `status`
- outputs: `image-evidence`
- source kinds: `annotation-crop`, `screenshot`, `browser-evidence`, `window-capture`, `screen-region`, `artifact`, `replay`
- controls: zoom, pan, fit, actual size, copy ref, open original, download image, provenance, annotation overlays, crop highlight
- fallback: `generic-artifact-inspector`
- safety: presentation-only; refs and host preview URLs only; no inline bytes or session control
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`

## Human notes

The component accepts `ImageEvidencePayload` records for `annotation-crop`, `screenshot`, `browser-evidence`, `window-capture`, `screen-region`, `artifact`, and `replay` sources. Image content must arrive through `imageRef` or `ref`; metadata such as provenance, annotations, target, window, browser session, artifact, redaction, bounds, and crop bounds stays as refs or scalar display state.

The renderer is presentation-only. It materializes image refs through the host preview URL, exposes host-policy request controls for zoom, pan, fit, actual size, copy ref, open original, download image, provenance, overlays, and crop highlighting, and leaves all effects to host policy.

Publish checks:

- `node --import tsx --test packages/presentation/components/image-evidence-viewer/render.test.tsx`
- `npm --workspace @sciforge-ui/components run packages:check`
