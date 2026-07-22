import { describe, expect, it } from 'vitest'
import {
  biologyRoomFormatFromPath,
  biologyRoomManifestSchema,
  biologyRoomOperationSchema,
  biologyRoomRelativePathSchema,
  biologyRoomSelectionSchema,
  biologyMolecularCameraSchema,
  biologySequenceViewStateSchema,
  normalizeBiologyRoomRelativePath
} from './contract.js'

describe('Biology Room contract', () => {
  it('normalizes portable workspace-relative paths and rejects escapes', () => {
    expect(normalizeBiologyRoomRelativePath('./data\\genome.fa')).toBe('data/genome.fa')
    expect(biologyRoomRelativePathSchema.parse('data//variants.vcf.gz')).toBe('data/variants.vcf.gz')
    expect(() => biologyRoomRelativePathSchema.parse('../outside.fa')).toThrow(/stay within/)
    expect(() => biologyRoomRelativePathSchema.parse('/tmp/outside.fa')).toThrow(/workspace-relative/)
    expect(() => biologyRoomRelativePathSchema.parse('C:\\outside.fa')).toThrow(/workspace-relative/)
  })

  it('recognizes only the supported first-release biology formats', () => {
    expect(biologyRoomFormatFromPath('genome.fna')).toBe('fasta')
    expect(biologyRoomFormatFromPath('protein.faa')).toBe('fasta')
    expect(biologyRoomFormatFromPath('annotations.GFF3.GZ')).toBe('gff3')
    expect(biologyRoomFormatFromPath('variants.vcf.gz')).toBe('vcf')
    expect(biologyRoomFormatFromPath('structure.cif')).toBe('mmcif')
    expect(biologyRoomFormatFromPath('structure.pdb.gz')).toBeNull()
    expect(biologyRoomFormatFromPath('record.gbk.gz')).toBeNull()
    expect(biologyRoomFormatFromPath('reads.fastq')).toBeNull()
    expect(biologyRoomFormatFromPath('alignment.bam')).toBeNull()
  })

  it('enforces zero-based half-open selection ranges', () => {
    expect(biologyRoomSelectionSchema.parse({
      kind: 'sequence',
      assetId: 'asset-1',
      ranges: [{ start: 0, end: 1 }]
    })).toMatchObject({ kind: 'sequence', ranges: [{ start: 0, end: 1 }] })
    expect(() => biologyRoomSelectionSchema.parse({
      kind: 'genomic',
      assetId: 'track-1',
      referenceAssetId: 'reference-1',
      refName: 'chr1',
      start: 10,
      end: 10
    })).toThrow(/greater than start/)
  })

  it('persists the active record for multi-record sequence viewers', () => {
    expect(biologySequenceViewStateSchema.parse({
      assetId: 'multi-fasta',
      sequenceId: 'transcript-2',
      mode: 'linear',
      showTranslations: false
    })).toMatchObject({ sequenceId: 'transcript-2' })
    expect(() => biologySequenceViewStateSchema.parse({
      assetId: 'multi-fasta',
      mode: 'linear',
      showTranslations: false,
      start: 10,
      end: 20
    })).toThrow()
    const camera = {
      mode: 'perspective' as const,
      fov: Math.PI / 4,
      position: [1, 2, 3],
      target: [0, 0, 0],
      up: [0, 1, 0],
      radius: 10,
      radiusMax: 20,
      fog: 50,
      clipFar: true,
      minNear: 5,
      minFar: 0
    }
    expect(biologyMolecularCameraSchema.parse(camera)).toMatchObject(camera)
    expect(() => biologyMolecularCameraSchema.parse({
      ...camera,
      zoom: 2
    })).toThrow()
  })

  it('stores stable molecular locators instead of renderer objects', () => {
    const selection = biologyRoomSelectionSchema.parse({
      kind: 'molecular',
      assetId: 'structure-1',
      locators: [{ modelId: 1, chainId: 'A', residueNumber: 42, insertionCode: 'B', atomName: 'CA' }]
    })
    expect(selection.kind).toBe('molecular')
    expect(biologyRoomSelectionSchema.parse({
      kind: 'molecular',
      assetId: 'structure-1',
      locators: [{ residueName: 'ATP' }]
    })).toMatchObject({
      locators: [{ residueName: 'ATP' }]
    })
    expect(() => biologyRoomSelectionSchema.parse({
      kind: 'molecular',
      assetId: 'structure-1',
      locators: [{}]
    })).toThrow(/identify at least/)
  })

  it('parses the complete operation surface, including internal refresh audit events', () => {
    expect(biologyRoomOperationSchema.parse({
      type: 'setTrackVisibility',
      trackAssetId: 'track-1',
      visible: false
    }).type).toBe('setTrackVisibility')
    expect(biologyRoomOperationSchema.parse({
      type: 'refreshAssets',
      assetIds: ['asset-1'],
      orphanedAnnotationIds: []
    }).type).toBe('refreshAssets')
    expect(biologyRoomOperationSchema.parse({
      type: 'setTrackReference',
      trackAssetId: 'track-1',
      referenceAssetId: 'reference-1'
    }).type).toBe('setTrackReference')
  })

  it('rejects dangling shape fields in persisted manifests', () => {
    const now = '2026-07-11T00:00:00.000Z'
    expect(() => biologyRoomManifestSchema.parse({
      schemaVersion: 1,
      roomId: 'room-1',
      title: 'Room',
      revision: 1,
      assets: [],
      viewerStates: {},
      annotations: [],
      createdAt: now,
      updatedAt: now,
      rendererInternalState: {}
    })).toThrow()
  })
})
