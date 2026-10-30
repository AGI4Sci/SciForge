# SciForge Workspace Bioimaging Worker

Initial first-party TypeScript worker package for bounded bioimaging metadata previews.

This package currently focuses on safe, dependency-light summaries for:

- `.tif`, `.tiff`, `.ome.tif`, and `.ome.tiff` TIFF-style microscopy files
- `.czi` proprietary Zeiss microscopy containers
- `.svs` and `.ndpi` whole-slide pathology containers

The worker sniffs TIFF headers, extracts first-IFD metadata such as dimensions and selected tags, and performs lightweight OME-XML extraction for image dimensions and channel labels when the XML is present in TIFF metadata. Proprietary and whole-slide formats intentionally return metadata-only placeholders.

For TIFF and OME-TIFF metadata with known dimensions, the preview result also includes a metadata-only pyramid/tile plan. The plan describes nominal 512 x 512 tile coverage and virtual downsampled levels for future range/tile transport, but it does not decode pixels or prove that lower-resolution IFDs exist.

The worker also exposes a pure in-memory ROI annotation/export foundation. `annotateRegion` clamps ROI coordinates to preview metadata dimensions when available, attaches optional label/body/channel metadata, and returns a structured selection plus a metadata-only annotation object. `exportRoiSet` serializes ROI/channel selections and annotations as JSON data with `metadataOnly: true` and `containsPixels: false`.

CZI, SVS, and NDPI remain placeholder-only in this worker. They may expose safe container metadata, but tile rendering, pyramid decoding, and proprietary container parsing are intentionally deferred.

It intentionally does not decode pixels, render tiles, produce screenshots, write files, start an MCP server, or bundle heavy image-format dependencies yet. ROI annotation/export results are coordinate metadata for agent/renderer handoff only and do not include image pixels.

## Scripts

```sh
npm --prefix packages/workers/workspace-bioimaging run typecheck
npm --prefix packages/workers/workspace-bioimaging run test
```

## Example

```ts
import { WorkspaceBioimagingService } from '@sciforge/workspace-bioimaging'

const service = new WorkspaceBioimagingService()
const preview = service.preview({
  bytes: new Uint8Array(await file.arrayBuffer()),
  path: 'cells.ome.tiff',
  mimeType: 'image/tiff'
})

console.log(preview.format, preview.dimensions, preview.channels)
console.log(preview.tilePlan?.levels[0])

const roi = service.selectRegion({
  preview,
  roiId: 'roi-1',
  region: { x: 100, y: 100, width: 256, height: 256 }
})

const channelSelection = service.selectChannels({
  preview,
  channels: ['DAPI']
})

const annotation = service.annotateRegion({
  preview,
  roiId: 'roi-1',
  label: 'Candidate cell cluster',
  body: 'Metadata-only agent annotation; renderer can resolve this later.',
  region: roi.region,
  channels: channelSelection.channels
})

const roiSet = service.exportRoiSet({
  preview,
  selection: annotation.selection,
  annotations: [annotation.annotation]
})

console.log(roi.selection, channelSelection.selection)
console.log(roiSet.roiSet.metadataOnly, roiSet.roiSet.containsPixels)
console.log(roiSet.jsonText)
```
