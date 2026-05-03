# @sciforge-ui/image-annotation-viewer

## Agent quick contract
- componentId: `image-annotation-viewer`
- accepts: `image-volume`, `image-annotation`, `microscopy-image`, `pathology-image`, `gel-image`, `blot-image`
- requires: one of `imageRef`, `image`, `path`, `filePath`, `annotations`, `regions`, or `masks`
- outputs: `image-volume`, `visual-annotation`
- events: `select-region`, `create-annotation`, `update-annotation`, `open-image-ref`
- fallback: `generic-artifact-inspector`
- safety: sandboxed; external image resources must be declared workspace refs; no code execution
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `image-volume` primitive with `visual-annotation` overlay

## Human notes

### Data schema
Artifacts should carry imageRef/path/filePath, dimensions, channel metadata, and annotations with stable ids. Masks should be compact polygons or refs rather than large inline arrays.

### Interaction/edit output semantics
Selection and annotation events emit region/annotation ids and coordinates. Create/update events are edit intents that should produce visual-annotation patches, not mutate image bytes.

### Performance/resource limits
No deep zoom, segmentation editing, or image decoding is bundled in this skeleton. External image resources must remain declared workspace refs.

### When not to use
Do not use it for molecular structures, spatial omics coordinate maps, generic screenshots, or image sets with no inspectable regions.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`.
