import assert from 'node:assert/strict'
import test from 'node:test'

import {
  workspaceObservationSchema,
  workspaceStructuredSelectionSchema
} from '../../../../src/shared/workspace-preview/index.js'
import {
  WORKSPACE_BIOIMAGING_MAX_BYTES,
  WorkspaceBioimagingService,
  createWorkspaceBioimagingPreview,
  workspaceBioimagingPreviewInputSchema
} from './index.js'

type TiffTagFixture = {
  tag: number
  type: number
  count: number
  value: number
  extra?: Uint8Array<ArrayBuffer>
}

const textEncoder = new TextEncoder()

test('summarizes TIFF and OME-XML dimensions and channels', () => {
  const bytes = makeCellsOmeTiffBytes()
  const preview = createWorkspaceBioimagingPreview(workspaceBioimagingPreviewInputSchema.parse({
    bytes,
    path: 'cells.ome.tiff',
    mimeType: 'image/tiff'
  }))

  assert.equal(preview.format, 'ome-tiff')
  assert.equal(preview.detectedBy, 'metadata')
  assert.equal(preview.tiff?.byteOrder, 'little')
  assert.equal(preview.tiff?.imageWidth, 512)
  assert.equal(preview.tiff?.imageHeight, 256)
  assert.deepEqual(preview.tiff?.bitsPerSample, [16])
  assert.equal(preview.ome?.imageCount, 1)
  assert.deepEqual(preview.dimensions, { width: 512, height: 256, z: 3, c: 2, t: 5 })
  assert.deepEqual(preview.channels, ['DAPI', 'FITC'])
  assert.equal(preview.tilePlan?.status, 'metadata-only')
  assert.equal(preview.tilePlan?.pixelDecoding, false)
  assert.equal(preview.tilePlan?.tileRendererImplemented, false)
  assert.ok(preview.observation?.actions.includes('bioimaging.annotateRegion'))
  assert.ok(preview.observation?.actions.includes('bioimaging.exportRoiSet'))

  assert.ok(preview.observation)
  const observation = workspaceObservationSchema.parse(preview.observation)
  assert.equal(observation.view.pluginId, 'bioimaging')
  assert.equal(observation.view.modality, 'bioimaging')
  assert.deepEqual(observation.bioimaging?.dimensions, { width: 512, height: 256, z: 3, t: 5 })
  assert.deepEqual(observation.bioimaging?.channels, ['DAPI', 'FITC'])
})

test('generates a safe TIFF tile plan without decoding pixels', () => {
  const bytes = makeClassicLittleEndianTiff([
    inlineLongTag(256, 2048),
    inlineLongTag(257, 1024),
    inlineShortTag(258, 16),
    inlineShortTag(259, 1),
    inlineShortTag(262, 1),
    inlineShortTag(277, 1)
  ])
  const preview = createWorkspaceBioimagingPreview(workspaceBioimagingPreviewInputSchema.parse({
    bytes,
    path: 'large-field.tif',
    mimeType: 'image/tiff'
  }))

  assert.equal(preview.format, 'tiff')
  assert.equal(preview.placeholder, undefined)
  assert.equal(preview.tilePlan?.source, 'tiff-metadata')
  assert.equal(preview.tilePlan?.pixelDecoding, false)
  assert.equal(preview.tilePlan?.levels[0]?.columns, 4)
  assert.equal(preview.tilePlan?.levels[0]?.rows, 2)
  assert.equal(preview.tilePlan?.levels[0]?.tileCount, 8)
  assert.ok((preview.tilePlan?.levels.length ?? 0) > 1)
  assert.match(preview.observation?.visibleText ?? '', /Tile plan: metadata-only/)
  assert.equal(workspaceObservationSchema.parse(preview.observation).view.pluginId, 'bioimaging')
})

test('returns a metadata-only placeholder for proprietary CZI input', () => {
  const service = new WorkspaceBioimagingService()
  const bytes = new Uint8Array(64)
  bytes.set(textEncoder.encode('ZISRAWFILE'))
  const preview = service.preview({
    bytes,
    path: 'experiment.czi'
  })

  assert.equal(preview.format, 'czi')
  assert.equal(preview.detectedBy, 'signature')
  assert.equal(preview.placeholder?.kind, 'proprietary-container')
  assert.equal(preview.placeholder?.tileRendererImplemented, false)
  assert.equal(preview.tilePlan, undefined)
  assert.match(preview.warnings.join('\n'), /metadata-only placeholders/)
  assert.equal(workspaceObservationSchema.parse(preview.observation).view.pluginId, 'bioimaging')
})

test('keeps whole-slide SVS files as safe TIFF metadata placeholders', () => {
  const bytes = makeClassicLittleEndianTiff([
    inlineLongTag(256, 40_000),
    inlineLongTag(257, 20_000),
    inlineShortTag(259, 7),
    asciiTag(270, 'Aperio Image Library v12.0 | AppMag = 20 | MPP = 0.25')
  ])
  const preview = createWorkspaceBioimagingPreview(workspaceBioimagingPreviewInputSchema.parse({
    bytes,
    path: 'slide.svs',
    size: 8_000_000_000
  }))

  assert.equal(preview.format, 'svs')
  assert.equal(preview.detectedBy, 'metadata')
  assert.equal(preview.placeholder?.kind, 'whole-slide')
  assert.equal(preview.tiff?.imageWidth, 40_000)
  assert.equal(preview.tiff?.compression, 'jpeg')
  assert.equal(preview.tilePlan, undefined)
  assert.match(preview.observation?.visibleText ?? '', /tile rendering and pyramid decoding are not implemented/)
  assert.match(preview.warnings.join('\n'), /Analyzed the first/)
})

test('selects ROI and channels from preview metadata in memory', () => {
  const service = new WorkspaceBioimagingService()
  const preview = service.preview({
    bytes: makeCellsOmeTiffBytes(),
    path: 'cells.ome.tiff',
    mimeType: 'image/tiff'
  })

  const region = service.selectRegion({
    preview,
    roiId: 'roi-edge',
    region: {
      x: 500,
      y: 250,
      width: 50,
      height: 20,
      z: 10,
      t: 1
    }
  })

  assert.equal(region.ok, true)
  assert.equal(region.clipped, true)
  assert.deepEqual(region.region, {
    x: 500,
    y: 250,
    width: 12,
    height: 6,
    z: 2,
    t: 1
  })
  assert.deepEqual(region.selection.roiIds, ['roi-edge'])
  assert.deepEqual(region.selection.regions, [region.region])
  assert.match(region.visibleText ?? '', /No pixels were decoded/)
  workspaceStructuredSelectionSchema.parse(region.selection)

  const channels = service.selectChannels({
    preview,
    channels: ['DAPI', 'Missing'],
    channelIndexes: [1]
  })

  assert.deepEqual(channels.channels, ['DAPI', 'FITC'])
  assert.deepEqual(channels.channelIndexes, [0, 1])
  assert.deepEqual(channels.unknownChannels, ['Missing'])
  assert.deepEqual(channels.selection.channels, ['DAPI', 'FITC'])
  assert.match(channels.warnings.join('\n'), /1 requested channel/)
  workspaceStructuredSelectionSchema.parse(channels.selection)
})

test('annotates and exports an OME-TIFF ROI set without pixels', () => {
  const service = new WorkspaceBioimagingService()
  const preview = service.preview({
    bytes: makeCellsOmeTiffBytes(),
    path: 'cells.ome.tiff',
    mimeType: 'image/tiff'
  })

  const annotation = service.annotateRegion({
    preview,
    roiId: 'roi-mitosis-edge',
    label: 'Mitotic focus',
    body: 'Agent-marked ROI for renderer follow-up.',
    region: {
      x: 500,
      y: 250,
      width: 50,
      height: 20,
      z: 5,
      t: 10
    },
    channels: ['DAPI', 'Missing'],
    channelIndexes: [1]
  })

  assert.equal(annotation.ok, true)
  assert.equal(annotation.clipped, true)
  assert.deepEqual(annotation.region, {
    x: 500,
    y: 250,
    width: 12,
    height: 6,
    z: 2,
    t: 4
  })
  assert.deepEqual(annotation.channels, ['DAPI', 'FITC'])
  assert.deepEqual(annotation.unknownChannels, ['Missing'])
  assert.deepEqual(annotation.selection.roiIds, ['roi-mitosis-edge'])
  assert.deepEqual(annotation.selection.channels, ['DAPI', 'FITC'])
  assert.deepEqual(annotation.selection.regions, [annotation.region])
  assert.equal(annotation.annotation.metadataOnly, true)
  assert.equal(annotation.annotation.pixelDecoding, false)
  assert.equal(annotation.annotation.label, 'Mitotic focus')
  assert.equal(annotation.annotation.body, 'Agent-marked ROI for renderer follow-up.')
  assert.match(annotation.visibleText ?? '', /Metadata-only annotation/)
  assert.match(annotation.warnings.join('\n'), /clipped/)
  assert.match(annotation.warnings.join('\n'), /requested channel/)
  workspaceStructuredSelectionSchema.parse(annotation.selection)

  const exported = service.exportRoiSet({
    preview,
    selection: annotation.selection,
    annotations: [annotation.annotation]
  })
  const parsed = JSON.parse(exported.jsonText) as typeof exported.roiSet

  assert.equal(exported.ok, true)
  assert.equal(exported.mimeType, 'application/vnd.sciforge.bioimaging.roi-set+json')
  assert.equal(exported.roiSet.metadataOnly, true)
  assert.equal(exported.roiSet.containsPixels, false)
  assert.equal(exported.roiSet.pixelDecoding, false)
  assert.equal(exported.roiSet.source.format, 'ome-tiff')
  assert.deepEqual(exported.roiSet.selection, annotation.selection)
  assert.equal(exported.roiSet.annotations[0]?.roiId, 'roi-mitosis-edge')
  assert.equal(parsed.containsPixels, false)
  assert.deepEqual(parsed.annotations[0]?.region, annotation.region)
  assert.match(exported.visibleText ?? '', /metadata-only JSON/)
  workspaceStructuredSelectionSchema.parse(exported.roiSet.selection)
})

test('allows metadata-only CZI and SVS ROI annotations with placeholder warnings', () => {
  const service = new WorkspaceBioimagingService()
  const cziBytes = new Uint8Array(64)
  cziBytes.set(textEncoder.encode('ZISRAWFILE'))
  const cziPreview = service.preview({
    bytes: cziBytes,
    path: 'experiment.czi'
  })

  const cziAnnotation = service.annotateRegion({
    preview: cziPreview,
    roiId: 'czi-roi-1',
    label: 'Candidate cell cluster',
    region: { x: 10, y: 20, width: 30, height: 40 }
  })

  assert.equal(cziAnnotation.annotation.metadataOnly, true)
  assert.equal(cziAnnotation.clipped, false)
  assert.deepEqual(cziAnnotation.region, { x: 10, y: 20, width: 30, height: 40 })
  assert.match(cziAnnotation.warnings.join('\n'), /dimensions are unavailable/)
  assert.match(cziAnnotation.warnings.join('\n'), /CZI preview is metadata-only/)

  const cziExport = service.exportRoiSet({
    preview: cziPreview,
    annotations: [cziAnnotation.annotation]
  })
  assert.equal(cziExport.roiSet.containsPixels, false)
  assert.match(cziExport.warnings.join('\n'), /CZI preview is metadata-only/)

  const svsPreview = service.preview({
    bytes: makeClassicLittleEndianTiff([
      inlineLongTag(256, 40_000),
      inlineLongTag(257, 20_000),
      inlineShortTag(259, 7),
      asciiTag(270, 'Aperio Image Library v12.0 | AppMag = 20 | MPP = 0.25')
    ]),
    path: 'slide.svs',
    size: 8_000_000_000
  })
  const svsAnnotation = service.annotateRegion({
    preview: svsPreview,
    roiId: 'slide-roi-edge',
    label: 'Tumor margin',
    region: { x: 39_990, y: 19_995, width: 100, height: 50 }
  })

  assert.equal(svsAnnotation.annotation.metadataOnly, true)
  assert.equal(svsAnnotation.clipped, true)
  assert.deepEqual(svsAnnotation.region, { x: 39_990, y: 19_995, width: 10, height: 5 })
  assert.match(svsAnnotation.warnings.join('\n'), /SVS whole-slide image preview is metadata-only/)
  workspaceStructuredSelectionSchema.parse(svsAnnotation.selection)
})

test('validates bounded byte input with zod contracts', () => {
  const service = new WorkspaceBioimagingService()

  assert.throws(() => {
    service.preview({
      bytes: new Uint8Array(WORKSPACE_BIOIMAGING_MAX_BYTES + 1),
      path: 'too-large.tif'
    })
  }, { name: 'ZodError' })
})

function makeCellsOmeTiffBytes(): Uint8Array<ArrayBuffer> {
  const omeXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">',
    '<Image ID="Image:0" Name="Cells">',
    '<Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint16" SizeX="512" SizeY="256" SizeZ="3" SizeC="2" SizeT="5">',
    '<Channel ID="Channel:0:0" Name="DAPI" Color="-16776961"/>',
    '<Channel ID="Channel:0:1" Name="FITC"/>',
    '</Pixels>',
    '</Image>',
    '</OME>'
  ].join('')
  return makeClassicLittleEndianTiff([
    inlineLongTag(256, 512),
    inlineLongTag(257, 256),
    inlineShortTag(258, 16),
    inlineShortTag(259, 1),
    inlineShortTag(262, 1),
    inlineShortTag(277, 1),
    asciiTag(270, omeXml)
  ])
}

function makeClassicLittleEndianTiff(tags: TiffTagFixture[]): Uint8Array<ArrayBuffer> {
  const entryCount = tags.length
  const ifdOffset = 8
  const ifdByteLength = 2 + entryCount * 12 + 4
  const extraByteLength = tags.reduce((total, tag) => total + (tag.extra?.byteLength ?? 0), 0)
  const bytes = new Uint8Array(ifdOffset + ifdByteLength + extraByteLength)
  const view = new DataView(bytes.buffer)

  bytes[0] = 'I'.charCodeAt(0)
  bytes[1] = 'I'.charCodeAt(0)
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)

  let extraOffset = ifdOffset + ifdByteLength
  for (const [index, tag] of tags.entries()) {
    const entryOffset = ifdOffset + 2 + index * 12
    view.setUint16(entryOffset, tag.tag, true)
    view.setUint16(entryOffset + 2, tag.type, true)
    view.setUint32(entryOffset + 4, tag.count, true)

    if (tag.extra) {
      view.setUint32(entryOffset + 8, extraOffset, true)
      bytes.set(tag.extra, extraOffset)
      extraOffset += tag.extra.byteLength
    } else {
      view.setUint32(entryOffset + 8, tag.value, true)
    }
  }

  return bytes
}

function inlineLongTag(tag: number, value: number): TiffTagFixture {
  return { tag, type: 4, count: 1, value }
}

function inlineShortTag(tag: number, value: number): TiffTagFixture {
  return { tag, type: 3, count: 1, value }
}

function asciiTag(tag: number, value: string): TiffTagFixture {
  const encoded = textEncoder.encode(`${value}\0`)
  return {
    tag,
    type: 2,
    count: encoded.byteLength,
    value: 0,
    extra: encoded
  }
}
