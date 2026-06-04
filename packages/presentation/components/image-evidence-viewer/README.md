# @sciforge-ui/image-evidence-viewer

Generic refs-first image and evidence viewer for presentation-layer payloads.

## Agent quick contract

- componentId: `image-evidence-viewer`
- accepts: `image-evidence`, `annotation-crop`, `screenshot`, `browser-evidence`, `window-capture`, `screen-region`, `artifact-image`, `replay-frame`
- requires: `imageRef` or `ref`; optional `mime`, `width`, `height`, `sha256`, `createdAt`, `provenanceRef`, `annotationRefs`, `targetRef`, `windowRef`, `browserSessionRef`, `artifactRef`, `redactionRef`, `bounds`, `cropBounds`, `domTarget`, `selector`, `domPath`, `selectedText`, `screenBounds`, `windowBounds`, `windowLocalBounds`, `displayId`, `scale`, `windowBinding`, `status`
- outputs: `image-evidence`
- source kinds: `annotation-crop`, `screenshot`, `browser-evidence`, `window-capture`, `screen-region`, `artifact`, `replay`
- controls: zoom, pan, fit, actual size, copy ref, open original, download image, provenance; all are host-policy view/export requests
- fallback: `generic-artifact-inspector`
- safety: presentation-only; refs, metadata, host preview URLs, and host-policy view/export requests only; no inline bytes, provider controls, rebind controls, or window operation promotion
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`

## Human notes

The component accepts `ImageEvidencePayload` records for `annotation-crop`, `screenshot`, `browser-evidence`, `window-capture`, `screen-region`, `artifact`, and `replay` sources. Image content must arrive through `imageRef` or `ref`; metadata such as provenance, annotations, target, window, browser session, artifact, redaction, bounds, crop bounds, DOM target details, selected text, screen/window bounds, display id, and scale stays as refs or scalar display state.

The renderer is presentation-only. It materializes image refs through the host preview URL and renders metadata rows/chips. Its toolbar emits only host-policy view/export requests such as zoom, pan, fit, copy ref, open original, download image, and provenance. It does not render rebind, provider, window operation, or session promotion controls.

`windowBinding` is explanatory evidence only. Supported fields are `status`, `confidence`, `reason`, `windowRef`, `appName`, `bundleId`, `pid`, `title`, `windowBounds`, `windowLocalBounds`, and a bounded `candidates` summary using the same display fields. `auto-bound` and `manual-bound` may show a binding window ref; `unbound` and `blocked` show status/reason/candidates without promoting any candidate to an active window.

Publish checks:

- `node --import tsx --test packages/presentation/components/image-evidence-viewer/render.test.tsx`
- `npm --workspace @sciforge-ui/components run packages:check`
